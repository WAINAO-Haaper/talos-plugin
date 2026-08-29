export type LocalPreviewFormatId =
	| "markdown" | "text" | "json" | "csv" | "tsv"
	| "png" | "jpeg" | "gif" | "webp" | "pdf";

export type LocalPreviewMode = "plain-text" | "table" | "image" | "pdf";

export interface LocalPreviewFormatPolicy {
	id: LocalPreviewFormatId;
	extensions: readonly string[];
	mode: LocalPreviewMode;
	mimeType: string;
	maxBytes: number;
	renderer: "textContent" | "bounded-table" | "local-blob";
}

export const LOCAL_PREVIEW_PRIVACY_BOUNDARY = "vault-local-no-egress" as const;
export const LOCAL_PREVIEW_MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const LOCAL_PREVIEW_MAX_BINARY_BYTES = 10 * 1024 * 1024;
export const LOCAL_PREVIEW_MAX_RENDERED_CHARACTERS = 200_000;
export const LOCAL_PREVIEW_MAX_TABLE_ROWS = 100;
export const LOCAL_PREVIEW_MAX_TABLE_COLUMNS = 20;
export const LOCAL_PREVIEW_MAX_CELL_CHARACTERS = 500;

const FORMAT_ROWS = [
	["markdown", [".md", ".markdown"], "plain-text", "text/markdown", LOCAL_PREVIEW_MAX_TEXT_BYTES, "textContent"],
	["text", [".txt", ".log", ".yaml", ".yml", ".toml"], "plain-text", "text/plain", LOCAL_PREVIEW_MAX_TEXT_BYTES, "textContent"],
	["json", [".json"], "plain-text", "application/json", LOCAL_PREVIEW_MAX_TEXT_BYTES, "textContent"],
	["csv", [".csv"], "table", "text/csv", LOCAL_PREVIEW_MAX_TEXT_BYTES, "bounded-table"],
	["tsv", [".tsv"], "table", "text/tab-separated-values", LOCAL_PREVIEW_MAX_TEXT_BYTES, "bounded-table"],
	["png", [".png"], "image", "image/png", LOCAL_PREVIEW_MAX_BINARY_BYTES, "local-blob"],
	["jpeg", [".jpg", ".jpeg"], "image", "image/jpeg", LOCAL_PREVIEW_MAX_BINARY_BYTES, "local-blob"],
	["gif", [".gif"], "image", "image/gif", LOCAL_PREVIEW_MAX_BINARY_BYTES, "local-blob"],
	["webp", [".webp"], "image", "image/webp", LOCAL_PREVIEW_MAX_BINARY_BYTES, "local-blob"],
	["pdf", [".pdf"], "pdf", "application/pdf", LOCAL_PREVIEW_MAX_BINARY_BYTES, "local-blob"],
] as const satisfies readonly (readonly [
	LocalPreviewFormatId,
	readonly string[],
	LocalPreviewMode,
	string,
	number,
	LocalPreviewFormatPolicy["renderer"],
])[];

export const LOCAL_PREVIEW_FORMAT_MATRIX: readonly LocalPreviewFormatPolicy[] = FORMAT_ROWS.map(
	([id, extensions, mode, mimeType, maxBytes, renderer]) => ({ id, extensions, mode, mimeType, maxBytes, renderer }),
);

export interface LocalPreviewRejected {
	status: "rejected";
	reason: "unsupported-format" | "file-too-large" | "invalid-content";
	message: string;
	policy?: LocalPreviewFormatPolicy;
	privacyBoundary: typeof LOCAL_PREVIEW_PRIVACY_BOUNDARY;
}

interface LocalPreviewReadyBase {
	status: "ready";
	policy: LocalPreviewFormatPolicy;
	privacyBoundary: typeof LOCAL_PREVIEW_PRIVACY_BOUNDARY;
}

export type LocalPreviewReady =
	| (LocalPreviewReadyBase & { mode: "plain-text"; text: string; truncated: boolean })
	| (LocalPreviewReadyBase & { mode: "table"; rows: string[][]; truncated: boolean })
	| (LocalPreviewReadyBase & { mode: "image" | "pdf"; bytes: Uint8Array; mimeType: string });

export type LocalPreviewResult = LocalPreviewReady | LocalPreviewRejected;

function reject(
	reason: LocalPreviewRejected["reason"],
	message: string,
	policy?: LocalPreviewFormatPolicy,
): LocalPreviewRejected {
	return { status: "rejected", reason, message, policy, privacyBoundary: LOCAL_PREVIEW_PRIVACY_BOUNDARY };
}

function fileExtension(fileName: string): string {
	const leaf = fileName.replaceAll("\\", "/").split("/").at(-1) ?? "";
	const index = leaf.lastIndexOf(".");
	return index > 0 ? leaf.slice(index).toLocaleLowerCase() : "";
}

export function getLocalPreviewPolicy(fileName: string): LocalPreviewFormatPolicy | null {
	const extension = fileExtension(fileName);
	return LOCAL_PREVIEW_FORMAT_MATRIX.find((entry) => entry.extensions.includes(extension)) ?? null;
}

export function evaluateDeclaredLocalPreview(
	fileName: string,
	declaredBytes: number,
): LocalPreviewFormatPolicy | LocalPreviewRejected {
	const policy = getLocalPreviewPolicy(fileName);
	if (!policy) return reject("unsupported-format", "该格式不在 TALOS 本地安全预览白名单中。");
	if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0 || declaredBytes > policy.maxBytes) {
		return reject("file-too-large", `文件超过 ${Math.round(policy.maxBytes / 1024 / 1024)} MB 预览上限。`, policy);
	}
	return policy;
}

function utf8(bytes: Uint8Array): string | null {
	if (bytes.some((value) => value === 0)) return null;
	try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""); }
	catch { return null; }
}

function bounded(value: string): { text: string; truncated: boolean } {
	if (value.length <= LOCAL_PREVIEW_MAX_RENDERED_CHARACTERS) return { text: value, truncated: false };
	return { text: `${value.slice(0, LOCAL_PREVIEW_MAX_RENDERED_CHARACTERS)}\n\n[预览已截断]`, truncated: true };
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function signatureIsValid(id: LocalPreviewFormatId, bytes: Uint8Array): boolean {
	if (id === "png") return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
	if (id === "jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
	if (id === "gif") return bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6));
	if (id === "webp") return bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
	if (id === "pdf") return bytes.length >= 5 && ascii(bytes, 0, 5) === "%PDF-";
	return true;
}

function delimited(source: string, separator: "," | "\t"): { rows: string[][]; truncated: boolean } | null {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	let truncated = false;
	const pushCell = () => {
		if (row.length < LOCAL_PREVIEW_MAX_TABLE_COLUMNS) {
			row.push(cell.slice(0, LOCAL_PREVIEW_MAX_CELL_CHARACTERS));
			truncated ||= cell.length > LOCAL_PREVIEW_MAX_CELL_CHARACTERS;
		} else truncated = true;
		cell = "";
	};
	const pushRow = () => {
		pushCell();
		if (rows.length < LOCAL_PREVIEW_MAX_TABLE_ROWS) rows.push(row);
		else truncated = true;
		row = [];
	};
	for (let index = 0; index < source.length; index += 1) {
		const character = source[index];
		if (character === '"') {
			if (quoted && source[index + 1] === '"') { cell += '"'; index += 1; }
			else if (quoted || cell.length === 0) quoted = !quoted;
			else cell += character;
		} else if (!quoted && character === separator) pushCell();
		else if (!quoted && character === "\n") pushRow();
		else if (character !== "\r") cell += character;
	}
	if (quoted) return null;
	if (cell.length || row.length) pushRow();
	return { rows, truncated };
}

export function buildLocalFilePreview(fileName: string, bytes: Uint8Array): LocalPreviewResult {
	const declared = evaluateDeclaredLocalPreview(fileName, bytes.byteLength);
	if ("status" in declared) return declared;
	const policy = declared;
	if (policy.mode === "image" || policy.mode === "pdf") {
		if (!signatureIsValid(policy.id, bytes)) return reject("invalid-content", "扩展名与文件字节签名不匹配。", policy);
		return { status: "ready", mode: policy.mode, bytes: Uint8Array.from(bytes), mimeType: policy.mimeType, policy, privacyBoundary: LOCAL_PREVIEW_PRIVACY_BOUNDARY };
	}
	const text = utf8(bytes);
	if (text === null) return reject("invalid-content", "文件不是有效的 UTF-8 文本。", policy);
	if (policy.id === "json") {
		try {
			const result = bounded(JSON.stringify(JSON.parse(text), null, 2));
			return { status: "ready", mode: "plain-text", ...result, policy, privacyBoundary: LOCAL_PREVIEW_PRIVACY_BOUNDARY };
		} catch { return reject("invalid-content", "JSON 内容格式错误。", policy); }
	}
	if (policy.mode === "table") {
		const result = delimited(text, policy.id === "csv" ? "," : "\t");
		return result
			? { status: "ready", mode: "table", ...result, policy, privacyBoundary: LOCAL_PREVIEW_PRIVACY_BOUNDARY }
			: reject("invalid-content", "表格包含未闭合的引号。", policy);
	}
	return { status: "ready", mode: "plain-text", ...bounded(text), policy, privacyBoundary: LOCAL_PREVIEW_PRIVACY_BOUNDARY };
}

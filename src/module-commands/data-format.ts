/** Local, dependency-free data interchange. No filesystem or network access. */
export const DATA_PACKAGE_SCHEMA = 'talos.data-package' as const;
export const DATA_PACKAGE_VERSION = 1 as const;

export type DataFormatErrorCode = 'unsafe-path' | 'invalid-package' | 'duplicate-path'
	| 'limit-exceeded' | 'invalid-content' | 'unsupported-format';

const ERROR_MESSAGES: Record<DataFormatErrorCode, string> = {
	'unsafe-path': '资料路径不符合 Vault 相对路径要求。',
	'invalid-package': '数据包损坏，或其结构、版本不受支持。',
	'duplicate-path': '数据包包含重复或冲突的文件路径。',
	'limit-exceeded': '资料超过文件数或大小限制。',
	'invalid-content': '资料内容或编码无效。',
	'unsupported-format': '暂不支持此格式转换。',
};

/** Errors deliberately never include supplied paths, content, or parser details. */
export class DataFormatError extends Error {
	constructor(public readonly code: DataFormatErrorCode) {
		super(ERROR_MESSAGES[code]);
		this.name = 'DataFormatError';
	}
}

export interface DataPackageFile {
	path: string;
	encoding: 'text' | 'base64';
	content: string;
}

export interface DataPackage {
	schema: typeof DATA_PACKAGE_SCHEMA;
	version: typeof DATA_PACKAGE_VERSION;
	files: DataPackageFile[];
}

export interface DataPackageLimits {
	maxFiles: number;
	/** Total UTF-8 text bytes plus decoded binary bytes, not base64 characters. */
	maxTotalBytes: number;
	/** Bounds JSON input before parsing, independently of decoded content. */
	maxSerializedBytes: number;
}

export const DEFAULT_DATA_PACKAGE_LIMITS: Readonly<DataPackageLimits> = Object.freeze({
	maxFiles: 1_000,
	maxTotalBytes: 50 * 1024 * 1024,
	maxSerializedBytes: 80 * 1024 * 1024,
});

const encoder = new TextEncoder();
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function fail(code: DataFormatErrorCode): never {
	throw new DataFormatError(code);
}

function isWellFormed(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const unit = value.charCodeAt(index);
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = value.charCodeAt(++index);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
		} else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
	}
	return true;
}

/**
 * Accept only plain, portable relative paths. URL-encoded names and all hidden
 * segments are intentionally excluded; callers must not decode/normalize again.
 * This lexical check cannot establish whether an on-disk path traverses a symlink.
 */
export function validateVaultRelativePath(path: string): string {
	if (typeof path !== 'string' || !path || path.length > 1024 || !isWellFormed(path)) {
		return fail('unsafe-path');
	}
	const normalized = path.normalize('NFC');
	// NFKC also catches full-width separators/dots without rewriting the stored name.
	for (const candidate of [normalized, normalized.normalize('NFKC')]) {
		if (/[\\:%<>"|?*]/u.test(candidate) || /[\p{Cc}\p{Cf}]/u.test(candidate)) {
			return fail('unsafe-path');
		}
		for (const segment of candidate.split('/')) {
			if (!segment || segment.startsWith('.') || segment === '..'
				|| segment !== segment.trim() || segment.endsWith('.')
				|| segment === '~' || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment)
				|| segment.toLowerCase() === 'node_modules') {
				return fail('unsafe-path');
			}
		}
	}
	return normalized;
}

function resolveLimits(overrides: Partial<DataPackageLimits> = {}): DataPackageLimits {
	const limits = { ...DEFAULT_DATA_PACKAGE_LIMITS, ...overrides };
	for (const value of Object.values(limits)) {
		if (!Number.isSafeInteger(value) || value < 0) fail('limit-exceeded');
	}
	return limits;
}

function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const ownKeys = Object.keys(value);
	return ownKeys.length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function binarySize(content: string): number {
	if (content.length % 4 !== 0 || /[^A-Za-z0-9+/=]/u.test(content)) {
		return fail('invalid-content');
	}
	const padding = content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0;
	const firstPadding = content.indexOf('=');
	if (firstPadding !== -1 && firstPadding !== content.length - padding) return fail('invalid-content');
	// Reject noncanonical padding bits, so every byte sequence has one encoding.
	if (padding === 2 && (BASE64.indexOf(content[content.length - 3]) & 15) !== 0) fail('invalid-content');
	if (padding === 1 && (BASE64.indexOf(content[content.length - 2]) & 3) !== 0) fail('invalid-content');
	return content.length / 4 * 3 - padding;
}

function toBase64(bytes: Uint8Array): string {
	const parts: string[] = [];
	let part = '';
	for (let index = 0; index < bytes.length; index += 3) {
		const a = bytes[index];
		const b = bytes[index + 1] ?? 0;
		const c = bytes[index + 2] ?? 0;
		part += BASE64[a >> 2] + BASE64[((a & 3) << 4) | (b >> 4)]
			+ (index + 1 < bytes.length ? BASE64[((b & 15) << 2) | (c >> 6)] : '=')
			+ (index + 2 < bytes.length ? BASE64[c & 63] : '=');
		if (part.length >= 16_384) { parts.push(part); part = ''; }
	}
	parts.push(part);
	return parts.join('');
}

function validateFile(value: unknown, maxBytes: number): { file: DataPackageFile; bytes: number } {
	if (!exactKeys(value, ['path', 'encoding', 'content']) || typeof value.path !== 'string'
		|| typeof value.content !== 'string' || (value.encoding !== 'text' && value.encoding !== 'base64')) {
		return fail('invalid-package');
	}
	const path = validateVaultRelativePath(value.path);
	let bytes: number;
	if (value.encoding === 'text') {
		if (value.content.length > maxBytes) return fail('limit-exceeded');
		if (!isWellFormed(value.content)) return fail('invalid-content');
		bytes = encoder.encode(value.content).byteLength;
	} else {
		if (value.content.length > Math.ceil(maxBytes / 3) * 4) return fail('limit-exceeded');
		bytes = binarySize(value.content);
	}
	if (bytes > maxBytes) return fail('limit-exceeded');
	return { file: { path, encoding: value.encoding, content: value.content }, bytes };
}

export function encodeDataPackageFile(path: string, content: string | Uint8Array): DataPackageFile {
	const safePath = validateVaultRelativePath(path);
	if (typeof content === 'string') {
		if (!isWellFormed(content)) return fail('invalid-content');
		return { path: safePath, encoding: 'text', content };
	}
	if (!(content instanceof Uint8Array)) return fail('invalid-content');
	return { path: safePath, encoding: 'base64', content: toBase64(content) };
}

export function decodeDataPackageFile(file: DataPackageFile): Uint8Array {
	const validated = validateFile(file, DEFAULT_DATA_PACKAGE_LIMITS.maxTotalBytes);
	if (validated.file.encoding === 'text') return encoder.encode(validated.file.content);
	const bytes = new Uint8Array(validated.bytes);
	const content = validated.file.content;
	let offset = 0;
	for (let index = 0; index < content.length; index += 4) {
		const a = BASE64.indexOf(content[index]);
		const b = BASE64.indexOf(content[index + 1]);
		const c = content[index + 2] === '=' ? 0 : BASE64.indexOf(content[index + 2]);
		const d = content[index + 3] === '=' ? 0 : BASE64.indexOf(content[index + 3]);
		bytes[offset++] = (a << 2) | (b >> 4);
		if (offset < bytes.length) bytes[offset++] = ((b & 15) << 4) | (c >> 2);
		if (offset < bytes.length) bytes[offset++] = ((c & 3) << 6) | d;
	}
	return bytes;
}

export function createDataPackage(
	files: readonly DataPackageFile[], overrides?: Partial<DataPackageLimits>,
): DataPackage {
	const limits = resolveLimits(overrides);
	if (!Array.isArray(files)) return fail('invalid-package');
	if (files.length > limits.maxFiles) return fail('limit-exceeded');
	const paths = new Set<string>();
	const directories = new Set<string>();
	const safeFiles: DataPackageFile[] = [];
	let totalBytes = 0;
	for (const value of files) {
		const { file, bytes } = validateFile(value, limits.maxTotalBytes - totalBytes);
		const key = file.path.normalize('NFKC').toLowerCase();
		if (paths.has(key) || directories.has(key)) return fail('duplicate-path');
		const segments = key.split('/');
		for (let length = 1; length < segments.length; length++) {
			const parent = segments.slice(0, length).join('/');
			if (paths.has(parent)) return fail('duplicate-path');
			directories.add(parent);
		}
		paths.add(key);
		totalBytes += bytes;
		safeFiles.push(file);
	}
	return { schema: DATA_PACKAGE_SCHEMA, version: DATA_PACKAGE_VERSION, files: safeFiles };
}

export function serializeDataPackage(
	files: readonly DataPackageFile[], overrides?: Partial<DataPackageLimits>,
): string {
	const limits = resolveLimits(overrides);
	const serialized = JSON.stringify(createDataPackage(files, limits));
	if (encoder.encode(serialized).byteLength > limits.maxSerializedBytes) return fail('limit-exceeded');
	return serialized;
}

/** JSON.parse validates syntax; this pass additionally rejects duplicate keys. */
function rejectDuplicateJsonKeys(serialized: string): void {
	const objects: Set<string>[] = [];
	for (let index = 0; index < serialized.length; index++) {
		const character = serialized[index];
		if (character === '{') { objects.push(new Set()); continue; }
		if (character === '}') { objects.pop(); continue; }
		if (character !== '"') continue;
		const start = index++;
		while (index < serialized.length && serialized[index] !== '"') {
			if (serialized[index] === '\\') index++;
			index++;
		}
		let next = index + 1;
		while (/\s/u.test(serialized[next] ?? '') && next < serialized.length) next++;
		if (serialized[next] !== ':') continue;
		const key = JSON.parse(serialized.slice(start, index + 1)) as string;
		const keys = objects[objects.length - 1];
		if (!keys || keys.has(key)) return fail('invalid-package');
		keys.add(key);
	}
}

export function parseDataPackage(serialized: string, overrides?: Partial<DataPackageLimits>): DataPackage {
	const limits = resolveLimits(overrides);
	if (typeof serialized !== 'string') return fail('invalid-package');
	if (serialized.length > limits.maxSerializedBytes
		|| encoder.encode(serialized).byteLength > limits.maxSerializedBytes) return fail('limit-exceeded');
	let value: unknown;
	try { value = JSON.parse(serialized) as unknown; } catch { return fail('invalid-package'); }
	if (!exactKeys(value, ['schema', 'version', 'files'])
		|| value.schema !== DATA_PACKAGE_SCHEMA || value.version !== DATA_PACKAGE_VERSION
		|| !Array.isArray(value.files)) return fail('invalid-package');
	const result = createDataPackage(value.files as DataPackageFile[], limits);
	rejectDuplicateJsonKeys(serialized);
	return result;
}

export interface ConversionSupport {
	supported: boolean;
	reason?: 'unsupported-format';
}

function formatName(format: string): string {
	return typeof format === 'string' ? format.trim().toLowerCase().replace(/^\./u, '') : '';
}

export function getConversionSupport(from: string, to: string): ConversionSupport {
	const source = formatName(from);
	const target = formatName(to);
	const supported = (['txt', 'md', 'json', 'csv'].includes(source) && ['md', 'txt'].includes(target))
		|| (['md', 'txt'].includes(source) && target === 'html');
	return supported ? { supported: true } : { supported: false, reason: 'unsupported-format' };
}

function escapeHtml(text: string): string {
	return text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
		.replace(/"/gu, '&quot;').replace(/'/gu, '&#39;');
}

function fenced(text: string, language: string): string {
	const runs = text.match(/`+/gu) ?? [];
	let fenceLength = 3;
	for (const run of runs) fenceLength = Math.max(fenceLength, run.length + 1);
	const fence = '`'.repeat(fenceLength);
	return `${fence}${language}\n${text}\n${fence}\n`;
}

/** Strict quoted-field CSV parser; values remain strings and formulas are inert. */
function parseCsv(input: string): string[][] {
	if (!input) return [];
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;
	let closed = false;
	for (let index = 0; index < input.length; index++) {
		const character = input[index];
		if (quoted) {
			if (character === '"') {
				if (input[index + 1] === '"') { cell += '"'; index++; }
				else { quoted = false; closed = true; }
			} else cell += character;
			continue;
		}
		if (character === ',') { row.push(cell); cell = ''; closed = false; continue; }
		if (character === '\n' || character === '\r') {
			row.push(cell); rows.push(row); row = []; cell = ''; closed = false;
			if (character === '\r' && input[index + 1] === '\n') index++;
			continue;
		}
		if (closed) return fail('invalid-content');
		if (character === '"') {
			if (cell) return fail('invalid-content');
			quoted = true;
		} else cell += character;
	}
	if (quoted) return fail('invalid-content');
	if (row.length > 0 || cell || closed || input.endsWith(',')) { row.push(cell); rows.push(row); }
	if (rows.some(candidate => candidate.length !== rows[0].length)) return fail('invalid-content');
	return rows;
}

function markdownToText(input: string): string {
	// Deliberately a basic text extraction, not a complete CommonMark renderer.
	return input.replace(/^\s*(`{3,}|~{3,})[^\n]*$/gmu, '')
		.replace(/^ {0,3}#{1,6}\s+/gmu, '').replace(/^\s*>\s?/gmu, '')
		.replace(/^\s*[-+*]\s+(?:\[[ xX]\]\s*)?/gmu, '')
		.replace(/!\[([^\]]*)\]\([^\n)]*\)/gu, '$1')
		.replace(/\[([^\]]+)\]\(([^\n)]*)\)/gu, '$1 ($2)')
		.replace(/(\*\*|__)([^\n]+?)\1/gu, '$2')
		.replace(/(?<!\w)(\*|_)([^\n]+?)\1(?!\w)/gu, '$2')
		.replace(/`([^`\n]+)`/gu, '$1');
}

/** HTML output preserves source as escaped preformatted text, never active HTML. */
export function convertBasicFormat(input: string, from: string, to: string): string {
	if (!getConversionSupport(from, to).supported) return fail('unsupported-format');
	if (typeof input !== 'string' || !isWellFormed(input) || input.includes('\0')) return fail('invalid-content');
	if (input.length > 5 * 1024 * 1024 || encoder.encode(input).byteLength > 5 * 1024 * 1024) return fail('limit-exceeded');
	const source = formatName(from);
	const target = formatName(to);
	if (target === 'html') {
		return '<!doctype html>\n<html><head><meta charset="utf-8">'
			+ '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; base-uri \'none\'; form-action \'none\'">'
			+ '<title>资料导出</title></head><body><pre>' + escapeHtml(input) + '</pre></body></html>\n';
	}
	if (source === 'json') {
		try { JSON.parse(input); } catch { return fail('invalid-content'); }
		// Preserve source numeric precision rather than reserializing parsed numbers.
		return target === 'md' ? fenced(input, 'json') : input;
	}
	if (source === 'csv') {
		const rows = parseCsv(input.replace(/^\uFEFF/u, ''));
		if (target === 'txt') return rows.map(row => row.join('\t')).join('\n');
		if (!rows.length) return '';
		const render = (row: string[]): string => '| ' + row.map(cell => escapeHtml(cell)
			.replace(/([\\`*_[\]{}()!|])/gu, '\\$1').replace(/\r\n|\r|\n/gu, '<br>')).join(' | ') + ' |';
		return [render(rows[0]), '| ' + rows[0].map(() => '---').join(' | ') + ' |', ...rows.slice(1).map(render)].join('\n') + '\n';
	}
	if (source === 'md') return target === 'txt' ? markdownToText(input) : input;
	return target === 'md' ? fenced(input, 'text') : input;
}

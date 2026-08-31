import path from "node:path";
import type { App } from "obsidian";
import { CANONICAL_REGISTRY_PATH } from "../canonical/registry-reader";

export interface VaultBootstrapHost {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	createFolder(path: string): Promise<void>;
	create(path: string, content: string): Promise<void>;
}

export interface VaultBootstrapResult {
	created: string[];
	preserved: string[];
	invalidExisting: string[];
	skippedPrimaryForFallback: boolean;
}

const PERSONA_TEMPLATE = `<!-- talos-bootstrap schema=1 template=persona-v1 -->
# TALOS 默认人格

你是 TALOS 的中性协作助手。在用户补充人格设定前，不虚构用户身份、经历、偏好或授权；高风险动作继续请求明确确认。
`;

const PERSONA_MEMORY_TEMPLATE = `<!-- talos-bootstrap schema=1 template=persona-memory-v1 -->
# persona-memory

尚无经过用户确认的长期记忆。只记录用户明确要求长期保留的偏好，不要填写密码、API Key 或其他凭据。
`;

const CONTEXT_TEMPLATE = `<!-- talos-bootstrap schema=1 template=context-v1 -->
# CONTEXT

尚未配置长期用户上下文。仅使用当前对话和用户明确提供的资料，不把推断写成事实。
`;

export const CANONICAL_REGISTRY_TEMPLATE = `${JSON.stringify({
	schema_version: 1,
	commands: [{
		id: "talos-ask",
		obsidian_command_id: "talos-ask",
		request_path: ".talos/command-requests/talos-ask.json",
		summary: "TALOS 原生全库问答入口",
		engine_asset: "TALOS中枢/引擎/00-系统种子/.claude/commands/talos-ask.md",
		claude_wrapper: "vault-template/.claude/commands/talos-ask.md",
	}],
}, null, 2)}\n`;

export const TALOS_BOOTSTRAP_TEMPLATES = {
	persona: PERSONA_TEMPLATE,
	personaMemory: PERSONA_MEMORY_TEMPLATE,
	context: CONTEXT_TEMPLATE,
	registry: CANONICAL_REGISTRY_TEMPLATE,
} as const;

export function normalizeBootstrapPath(value: string): string {
	if (!value || value.includes("\0") || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
		throw new Error(`bootstrap 路径必须是 Vault 相对路径：${value}`);
	}
	const normalized = value.replace(/\\/g, "/");
	if (
		!normalized
		|| normalized === "."
		|| normalized.startsWith("/")
		|| normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
	) {
		throw new Error(`bootstrap 路径越过 Vault 边界：${value}`);
	}
	return normalized;
}

async function readNonBlank(host: VaultBootstrapHost, file: string): Promise<boolean> {
	if (!(await host.exists(file))) return false;
	try {
		return (await host.read(file)).trim().length > 0;
	} catch {
		return false;
	}
}

async function completeGroup(host: VaultBootstrapHost, files: readonly string[]): Promise<boolean> {
	const states = await Promise.all(files.map((file) => readNonBlank(host, file)));
	return states.every(Boolean);
}

async function ensureDirectory(host: VaultBootstrapHost, file: string): Promise<void> {
	const directory = path.posix.dirname(file);
	if (directory === ".") return;
	let current = "";
	for (const segment of directory.split("/")) {
		current = current ? `${current}/${segment}` : segment;
		if (await host.exists(current)) continue;
		try {
			await host.createFolder(current);
		} catch (error) {
			if (!(await host.exists(current))) throw error;
		}
	}
}

async function ensureFile(
	host: VaultBootstrapHost,
	file: string,
	content: string,
	result: VaultBootstrapResult,
): Promise<void> {
	if (await host.exists(file)) {
		const valid = await readNonBlank(host, file);
		(valid ? result.preserved : result.invalidExisting).push(file);
		return;
	}
	await ensureDirectory(host, file);
	try {
		await host.create(file, content);
		result.created.push(file);
	} catch (error) {
		if (!(await host.exists(file))) throw error;
		result.preserved.push(file);
	}
	if (!(await readNonBlank(host, file))) {
		throw new Error(`bootstrap 创建后验证失败：${file}`);
	}
}

export async function bootstrapTalosVault(input: {
	host: VaultBootstrapHost;
	primaryPersonaPaths: readonly [string, string, string];
	fallbackPersonaPaths: readonly [string, string, string];
}): Promise<VaultBootstrapResult> {
	const primary = input.primaryPersonaPaths.map(normalizeBootstrapPath) as [string, string, string];
	const fallback = input.fallbackPersonaPaths.map(normalizeBootstrapPath) as [string, string, string];
	const result: VaultBootstrapResult = {
		created: [],
		preserved: [],
		invalidExisting: [],
		skippedPrimaryForFallback: false,
	};
	const primaryComplete = await completeGroup(input.host, primary);
	const fallbackComplete = await completeGroup(input.host, fallback);
	if (!primaryComplete && fallbackComplete) {
		result.skippedPrimaryForFallback = true;
	} else if (!primaryComplete) {
		await ensureFile(input.host, primary[0], PERSONA_TEMPLATE, result);
		await ensureFile(input.host, primary[1], PERSONA_MEMORY_TEMPLATE, result);
		await ensureFile(input.host, primary[2], CONTEXT_TEMPLATE, result);
	}
	await ensureFile(
		input.host,
		normalizeBootstrapPath(CANONICAL_REGISTRY_PATH),
		CANONICAL_REGISTRY_TEMPLATE,
		result,
	);
	return result;
}

export function createObsidianVaultBootstrapHost(app: App): VaultBootstrapHost {
	return {
		exists: (file) => app.vault.adapter.exists(file),
		read: (file) => app.vault.adapter.read(file),
		createFolder: async (directory) => {
			await app.vault.createFolder(directory);
		},
		create: async (file, content) => {
			await app.vault.create(file, content);
		},
	};
}

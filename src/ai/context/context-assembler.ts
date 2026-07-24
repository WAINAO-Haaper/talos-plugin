import {
	inspectVaultContent,
} from "./secret-policy";
import type {
	BlockedRetrieval,
	RetrievalHit,
	VaultRetrievalResult,
} from "./vault-retrieval";

export interface AssembledContext {
	text: string;
	usedPaths: string[];
	blocked: BlockedRetrieval[];
}

export interface ContextAssemblerOptions {
	maxChars?: number;
	configDir?: string;
}

function statusLabel(hit: RetrievalHit): string {
	if (hit.reasons.includes("candidate-context")) return "候选";
	if (hit.reasons.includes("inferred-context")) return "推断";
	return "库内资料";
}

export function assembleVaultContext(
	query: string,
	retrieval: VaultRetrievalResult,
	options: ContextAssemblerOptions = {}
): AssembledContext {
	const maxChars = Math.max(1, options.maxChars ?? 24_000);
	const usedPaths: string[] = [];
	const blocked = [...retrieval.blocked];
	const fragments: string[] = [];
	let length = 0;

	for (const hit of retrieval.hits) {
		const inspection = inspectVaultContent(hit.path, hit.excerpt, {
			configDir: options.configDir,
		});
		if (inspection.blocked) {
			blocked.push({
				path: hit.path,
				reasons: inspection.reasons,
			});
			continue;
		}
		const header = `[${statusLabel(hit)} | ${hit.source} | ${hit.path}]`;
		const fragment = `${header}\n${hit.excerpt}`;
		const remaining = maxChars - length;
		if (remaining <= 0) break;
		const accepted = fragment.slice(0, remaining);
		fragments.push(accepted);
		usedPaths.push(hit.path);
		length += accepted.length;
	}

	const context = fragments.length
		? fragments.join("\n\n---\n\n")
		: "（没有找到可安全发送的库内上下文）";
	return {
		text: [
			"以下内容来自当前 Vault。候选与推断仅作为带状态的参考，不得冒充已确认事实；不要泄露或猜测任何被拦截的密钥。",
			"",
			context,
			"",
			`用户问题：${query}`,
		].join("\n"),
		usedPaths,
		blocked,
	};
}

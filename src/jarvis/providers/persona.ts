import { App } from "obsidian";
import type { TalosSettings } from "../../settings";

// ============================================================
// 人格注入 · 直连通道共享（Anthropic / OpenAI 都用）
//   SDK/CLI 通道靠 settingSources 白送 CLAUDE.md/PERSONA；
//   直连通道没有 SDK，必须手动把库的人格层读进 system prompt，
//   否则屈原会退化成干净的 Claude/GPT（差异化②的保命闸）。
// ============================================================

export const DEFAULT_PERSONA =
	"你是屈原，外脑玩家 Haaper 的知识伙伴与战略参谋。回答简洁、口语化、可直接朗读；不要用 Markdown 标题或列表符号，用自然短句。";

const PERSONA_SOURCES = ["灵魂/PERSONA.md", ".claude/CLAUDE.md"];
const CAP = 8000; // 每个来源截断上限，防 system 过长

export async function buildSystemPrompt(app: App, settings: TalosSettings): Promise<string> {
	const parts: string[] = [settings.voicePersona.trim() || DEFAULT_PERSONA];
	for (const p of PERSONA_SOURCES) {
		try {
			if (await app.vault.adapter.exists(p)) {
				const text = await app.vault.adapter.read(p);
				parts.push(`# 来自 ${p}\n${text.slice(0, CAP)}`);
			}
		} catch {
			/* 读不到就跳过，至少保底 DEFAULT_PERSONA */
		}
	}
	return parts.join("\n\n---\n\n");
}

export function hasChildProcess(): boolean {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-nodejs-modules
		require("child_process");
		return true;
	} catch {
		return false;
	}
}

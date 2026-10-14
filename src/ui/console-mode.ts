// 控制台双模式（D-TLP-072）：「个人体系」沿用主线页面；「超级大脑框架」以 C01–C15 / M01–M10 五组为主导航。
// 同一插件、同一份数据与对话 / 审批能力，只是导航与首页不同。框架部署包的库自动进入超级大脑模式。
import { SUPERBRAIN_CATALOG_PATH } from "../module-commands/superbrain-catalog";

export type ConsoleMode = "personal" | "superbrain";

export function normalizeConsoleMode(value: unknown): ConsoleMode {
	return value === "superbrain" ? "superbrain" : "personal";
}

/** 框架部署包自带工作流目录（catalog.json）；有它即视为框架库。 */
export async function detectConsoleMode(exists: (path: string) => Promise<boolean> | boolean): Promise<ConsoleMode> {
	return (await exists(SUPERBRAIN_CATALOG_PATH)) ? "superbrain" : "personal";
}

export type ModuleInvocation =
	| { kind: "home" }
	| { kind: "detail"; id: string }
	| { kind: "invalid" }
	| { kind: "action"; invocation: string };

const SUPERBRAIN_ENTRY_ID = /^(?:C(?:0[1-9]|1[0-5])|M(?:0[1-9]|10))$/;

/** 模块命令路由：`superbrain` 开首页，`superbrain:C02` 开固定 C/M 详情，其余交给模块操作。 */
export function parseModuleInvocation(invocation: string): ModuleInvocation {
	if (invocation === "superbrain") return { kind: "home" };
	if (!invocation.startsWith("superbrain:")) return { kind: "action", invocation };
	const id = invocation.slice("superbrain:".length);
	return SUPERBRAIN_ENTRY_ID.test(id) ? { kind: "detail", id } : { kind: "invalid" };
}

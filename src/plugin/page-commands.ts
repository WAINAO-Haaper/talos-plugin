// 每个控制台页面一条 Obsidian 命令，从同一张导航注册表生成（与 Lens 的模块搜索同理：
// 侧栏、二级页签与命令面板共用一处定义）。已有独立命令的页面不重复注册。
import { navigationFor } from "../ui/navigation-model";
import type { ConsoleMode } from "../ui/console-mode";

export interface PageCommand {
	id: string;
	name: string;
	pageKey: string;
}

/** 已由其他命令覆盖的页面：AI 对话（open-quyuan-v2）。 */
const COVERED_PAGES = new Set(["chat"]);

export function pageCommands(mode: ConsoleMode = "personal", hasSuperbrainCatalog = false): PageCommand[] {
	return navigationFor(mode, hasSuperbrainCatalog).flatMap((group) =>
		group.children
			.filter((child) => !COVERED_PAGES.has(child.key))
			.map((child) => ({
				id: `open-page-${child.key}`,
				name: child.label === group.label ? `打开${child.label}` : `打开${child.label}（${group.label}）`,
				pageKey: child.key,
			}))
	);
}

interface CommandHost {
	addCommand(command: { id: string; name: string; callback: () => void }): unknown;
}

export function registerPageCommands(host: CommandHost, open: (pageKey: string) => Promise<void>, mode: ConsoleMode = "personal", hasSuperbrainCatalog = false): void {
	for (const command of pageCommands(mode, hasSuperbrainCatalog)) {
		host.addCommand({
			id: command.id,
			name: command.name,
			callback: () => void open(command.pageKey),
		});
	}
}

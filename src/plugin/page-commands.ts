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
	const commands = navigationFor(mode, hasSuperbrainCatalog).flatMap((group) =>
		group.children
			.filter((child) => !COVERED_PAGES.has(child.key))
			.map((child) => ({
				id: `open-page-${child.key}`,
				name: child.label === group.label ? `打开${child.label}` : `打开${child.label}（${group.label}）`,
				pageKey: child.key,
			}))
	);
	// 已保存的快捷键可能仍引用历史页面命令；保留命令 ID，并沿旧路由落到新主场。
	if (mode === "personal") commands.push(
		{ id: "open-page-daily", name: "打开任务与待决策（旧入口）", pageKey: "daily" },
		{ id: "open-page-talos", name: "打开项目（旧入口）", pageKey: "talos" },
		{ id: "open-page-vault", name: "打开资料统计（旧入口）", pageKey: "vault" },
	);
	return commands;
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

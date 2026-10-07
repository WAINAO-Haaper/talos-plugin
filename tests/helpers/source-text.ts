import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 源码文本合同测试的统一读取入口。TalosView 的页面、图表、审批区等已拆到
// src/ui 下的独立模块；按整体读取，"包含 / 不包含" 断言不会因代码换文件而失效。

const root = fileURLToPath(new URL("../../", import.meta.url));

function read(path: string): string {
	return readFileSync(`${root}${path}`, "utf8");
}

function modulesIn(dir: string): string[] {
	return readdirSync(`${root}${dir}`)
		.filter((name) => name.endsWith(".ts"))
		.sort()
		.map((name) => `${dir}/${name}`);
}

export const VIEW_SOURCE_FILES: readonly string[] = [
	"src/view.ts",
	"src/ui/talos-view-model.ts",
	"src/ui/view-chrome.ts",
	"src/ui/view-approvals.ts",
	"src/ui/view-cosmos.ts",
	"src/ui/view-modules.ts",
	...modulesIn("src/ui/pages"),
	...modulesIn("src/ui/charts"),
];

/** TalosView 及其拆分模块的完整源码。 */
export function viewSource(): string {
	return VIEW_SOURCE_FILES.map(read).join("\n");
}

/** 取出一个导出函数的完整源码（到下一个顶层 export 为止）。 */
export function functionSource(source: string, name: string): string {
	const start = source.search(new RegExp(`^export (?:async )?function\\*? ${name}\\(`, "m"));
	if (start < 0) throw new Error(`function not found: ${name}`);
	const next = source.slice(start + 1).search(/^export /m);
	return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}

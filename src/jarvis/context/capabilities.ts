import { App } from "obsidian";

// ============================================================
// 能力透出 · 读 .claude/agents + .mcp.json 做可视清单
//   SDK/CLI 通道：这些由 settingSources 自动继承，此处仅列出让用户看见。
//   直连通道：斜杠命令展开可用；子智能体编排 / MCP 执行暂为 SDK-only（透明声明）。
// ============================================================

export interface Capabilities {
	commands: string[];
	agents: string[];
	mcp: string[];
}

export async function readCapabilities(app: App, commandNames: string[]): Promise<Capabilities> {
	return {
		commands: commandNames,
		agents: await listMdNames(app, ".claude/agents"),
		mcp: await readMcpServers(app),
	};
}

async function listMdNames(app: App, dir: string): Promise<string[]> {
	try {
		if (!(await app.vault.adapter.exists(dir))) return [];
		const listing = await app.vault.adapter.list(dir);
		return listing.files
			.filter((f) => f.endsWith(".md"))
			.map((f) => (f.split("/").pop() ?? f).replace(/\.md$/, ""));
	} catch {
		return [];
	}
}

async function readMcpServers(app: App): Promise<string[]> {
	for (const p of [".mcp.json", ".claude/mcp.json"]) {
		try {
			if (!(await app.vault.adapter.exists(p))) continue;
			const raw = await app.vault.adapter.read(p);
			const j = JSON.parse(raw) as { mcpServers?: Record<string, unknown>; servers?: Record<string, unknown> };
			const servers = j.mcpServers ?? j.servers ?? {};
			return Object.keys(servers);
		} catch {
			/* 下一个候选 */
		}
	}
	return [];
}

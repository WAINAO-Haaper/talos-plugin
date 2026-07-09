import { App } from "obsidian";

// ============================================================
// 斜杠命令注册表 · 扫 .claude/commands/*.md → /name 展开
//   纯前端模板展开，三通道通用（SDK/直连都生效）。
//   /name args → 命令正文（$ARGUMENTS 替换为 args），作为 prompt 发出。
// ============================================================

export interface SlashCommand {
	name: string;
	description: string;
	body: string;
}

export class CommandRegistry {
	private cmds: SlashCommand[] = [];

	constructor(private app: App) {}

	async load(): Promise<void> {
		this.cmds = [];
		const dir = ".claude/commands";
		try {
			if (!(await this.app.vault.adapter.exists(dir))) return;
			const listing = await this.app.vault.adapter.list(dir);
			for (const f of listing.files) {
				if (!f.endsWith(".md")) continue;
				const raw = await this.app.vault.adapter.read(f);
				const name = (f.split("/").pop() ?? f).replace(/\.md$/, "");
				const parsed = parseCommand(raw);
				this.cmds.push({ name, description: parsed.description, body: parsed.body });
			}
		} catch {
			/* 读不到就空表 */
		}
	}

	list(): SlashCommand[] {
		return this.cmds;
	}

	suggest(query: string, limit = 8): SlashCommand[] {
		const q = query.toLowerCase();
		return this.cmds.filter((c) => c.name.toLowerCase().includes(q)).slice(0, limit);
	}

	get(name: string): SlashCommand | undefined {
		return this.cmds.find((c) => c.name === name);
	}

	// /name args → 展开后的 prompt；命令不存在返回 null（按原文发送）
	expand(name: string, args: string): string | null {
		const c = this.get(name);
		if (!c) return null;
		if (c.body.includes("$ARGUMENTS")) return c.body.replace(/\$ARGUMENTS/g, args);
		return args ? `${c.body}\n\n${args}` : c.body;
	}
}

function parseCommand(raw: string): { description: string; body: string } {
	let body = raw;
	let description = "";
	const fm = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (fm) {
		const front = fm[1] ?? "";
		body = fm[2] ?? "";
		const d = front.match(/description:\s*(.+)/);
		if (d && d[1]) description = d[1].trim().replace(/^["']|["']$/g, "");
	}
	if (!description) {
		const firstLine = body.split("\n").find((l) => l.trim());
		description = (firstLine ?? "").replace(/^#+\s*/, "").slice(0, 60);
	}
	return { description, body: body.trim() };
}

import { App, FileSystemAdapter } from "obsidian";
import type { JarvisEvents } from "../engine-types";

// ============================================================
// VaultToolHost · 直连通道的工具执行层 + 权限网关
//   SDK/CLI 通道由 claude-agent-sdk 跑工具；直连通道没有 SDK，
//   就靠这里把 Read/Write/Edit/Glob/Grep/Bash 落到 vault 上，
//   每次执行前过 gate() —— 复用面板既有的权限审批卡片（onPermissionRequest）。
// ============================================================

export interface ToolCall {
	id: string;
	name: string;
	input: Record<string, unknown>;
}

export interface ToolResult {
	id: string;
	content: string;
	isError: boolean;
}

export interface ToolOutcome {
	content: string;
	isError: boolean;
}

export interface ToolHostOpts {
	permissionMode: () => string; // default | acceptEdits | plan | bypassPermissions
	supportsBash: boolean; // 移动端 / 无 child_process 时为 false
}

const MAX_OUT = 8000; // 单次工具输出上限，防爆 context

export class VaultToolHost {
	constructor(private app: App, private ev: JarvisEvents, private opts: ToolHostOpts) {}

	async run(call: ToolCall): Promise<ToolOutcome> {
		const gate = await this.gate(call);
		if (!gate.allow) return { content: gate.message ?? "已拒绝", isError: true };
		try {
			switch (call.name) {
				case "Read": return await this.read(call.input);
				case "Write": return await this.write(call.input);
				case "Edit": return await this.edit(call.input);
				case "Glob": return await this.glob(call.input);
				case "Grep": return await this.grep(call.input);
				case "Bash":
					return this.opts.supportsBash
						? await this.bash(call.input)
						: { content: "此端不支持 Bash（无 child_process）", isError: true };
				default:
					return { content: `未知工具 ${call.name}`, isError: true };
			}
		} catch (e) {
			return { content: e instanceof Error ? e.message : String(e), isError: true };
		}
	}

	// 权限网关：与 SDK 通道四档语义对齐
	private async gate(call: ToolCall): Promise<{ allow: boolean; message?: string }> {
		const mode = this.opts.permissionMode();
		const isWrite = call.name === "Write" || call.name === "Edit" || call.name === "Bash";
		if (mode === "bypassPermissions") return { allow: true };
		if (mode === "plan" && isWrite) return { allow: false, message: "计划模式：只读，不落地写操作" };
		if (mode === "acceptEdits" && call.name !== "Bash") return { allow: true };
		if (!this.ev.onPermissionRequest) return { allow: true };
		const res = await this.ev.onPermissionRequest({
			toolUseID: call.id,
			toolName: call.name,
			input: call.input,
		});
		if (res.behavior === "allow") return { allow: true };
		return { allow: false, message: (res as { message?: string }).message ?? "用户拒绝了此操作" };
	}

	private basePath(): string {
		const a = this.app.vault.adapter;
		if (!(a instanceof FileSystemAdapter)) throw new Error("仅桌面端可用文件系统工具");
		return a.getBasePath();
	}

	// ---- 工具实现（用 vault.adapter，覆盖 dotfiles）----
	private async read(i: Record<string, unknown>): Promise<ToolOutcome> {
		const path = String(i.file_path ?? "");
		if (!(await this.app.vault.adapter.exists(path))) return { content: "文件不存在：" + path, isError: true };
		const text = await this.app.vault.adapter.read(path);
		return { content: text.length > MAX_OUT ? text.slice(0, MAX_OUT) + "\n…（已截断）" : text, isError: false };
	}

	private async write(i: Record<string, unknown>): Promise<ToolOutcome> {
		const path = String(i.file_path ?? "");
		const content = String(i.content ?? "");
		const slash = path.lastIndexOf("/");
		if (slash > 0) {
			const dir = path.slice(0, slash);
			if (!(await this.app.vault.adapter.exists(dir))) await this.app.vault.adapter.mkdir(dir);
		}
		await this.app.vault.adapter.write(path, content);
		return { content: `已写入 ${path}（${content.length} 字符）`, isError: false };
	}

	private async edit(i: Record<string, unknown>): Promise<ToolOutcome> {
		const path = String(i.file_path ?? "");
		const oldStr = String(i.old_string ?? "");
		const newStr = String(i.new_string ?? "");
		if (!(await this.app.vault.adapter.exists(path))) return { content: "文件不存在：" + path, isError: true };
		const src = await this.app.vault.adapter.read(path);
		const idx = src.indexOf(oldStr);
		if (idx < 0) return { content: "未找到 old_string，未改动", isError: true };
		const next = src.slice(0, idx) + newStr + src.slice(idx + oldStr.length);
		await this.app.vault.adapter.write(path, next);
		return { content: `已编辑 ${path}`, isError: false };
	}

	private async glob(i: Record<string, unknown>): Promise<ToolOutcome> {
		const re = globToRegex(String(i.pattern ?? "**/*"));
		const hits = this.app.vault.getFiles().map((f) => f.path).filter((p) => re.test(p)).slice(0, 200);
		return { content: hits.join("\n") || "（无匹配）", isError: false };
	}

	private async grep(i: Record<string, unknown>): Promise<ToolOutcome> {
		let re: RegExp;
		try { re = new RegExp(String(i.pattern ?? ""), "i"); } catch (e) { return { content: "正则非法：" + String(e), isError: true }; }
		const globRe = i.glob ? globToRegex(String(i.glob)) : null;
		const files = this.app.vault.getFiles().filter((f) => !globRe || globRe.test(f.path));
		const out: string[] = [];
		for (const f of files) {
			if (out.length >= 200) break;
			let text: string;
			try { text = await this.app.vault.cachedRead(f); } catch { continue; }
			const lines = text.split("\n");
			for (let n = 0; n < lines.length; n++) {
				const line = lines[n];
				if (line !== undefined && re.test(line)) {
					out.push(`${f.path}:${n + 1}: ${line.trim().slice(0, 200)}`);
					if (out.length >= 200) break;
				}
			}
		}
		return { content: out.join("\n") || "（无命中）", isError: false };
	}

	private async bash(i: Record<string, unknown>): Promise<ToolOutcome> {
		const command = String(i.command ?? "");
		const cwd = this.basePath();
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const cp = require("child_process") as {
			spawn: (c: string, a: string[], o: { cwd: string; shell: boolean }) => {
				stdout: { on(ev: "data", cb: (d: Buffer) => void): void } | null;
				stderr: { on(ev: "data", cb: (d: Buffer) => void): void } | null;
				on(ev: "close" | "error", cb: (a: unknown) => void): void;
			};
		};
		// 跨平台：Windows 走 cmd.exe（/d 跳过 AutoRun，/s 保留引号语义），POSIX 走登录 shell
		const isWin = process.platform === "win32";
		const shell = isWin
			? process.env.ComSpec || "cmd.exe"
			: process.env.SHELL || "/bin/zsh";
		const shellArgs = isWin ? ["/d", "/s", "/c", command] : ["-lc", command];
		return new Promise<ToolOutcome>((resolve) => {
			let out = "";
			const child = cp.spawn(shell, shellArgs, { cwd, shell: false });
			child.stdout?.on("data", (d) => (out += d.toString()));
			child.stderr?.on("data", (d) => (out += d.toString()));
			child.on("error", (e) => resolve({ content: String(e), isError: true }));
			child.on("close", (code) =>
				resolve({ content: (out || "（无输出）").slice(0, MAX_OUT), isError: Number(code) !== 0 })
			);
		});
	}
}

// 极简 glob→正则：支持 ** / * / ?。
// 逐字符扫描：让 "**/" 匹配零层或多层目录，否则 "**/*.md" 匹配不到根目录文件。
function globToRegex(glob: string): RegExp {
	let out = "";
	for (let i = 0; i < glob.length; i++) {
		const ch = glob[i];
		if (ch === "*") {
			if (glob[i + 1] === "*") {
				if (glob[i + 2] === "/") {
					out += "(?:.*/)?"; // **/ ：任意层目录，含零层
					i += 2;
				} else {
					out += ".*"; // ** ：任意字符（可跨目录）
					i += 1;
				}
			} else {
				out += "[^/]*"; // * ：单层内任意字符
			}
		} else if (ch === "?") {
			out += ".";
		} else if (ch) {
			out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
		}
	}
	return new RegExp("^" + out + "$", "i");
}

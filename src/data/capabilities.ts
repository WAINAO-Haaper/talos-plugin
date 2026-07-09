import { App } from "obsidian";

export interface CapabilityItem {
	name: string; // 显示名，如 /morning 或 health-scanner
	invoke: string; // 点击复制的调用文本
	desc: string;
	path?: string;
}

export interface CapabilityGroup {
	key: string;
	label: string;
	meta: string;
	items: CapabilityItem[];
}

// 解析 md 文本的描述：优先 frontmatter description，其次首个 # 标题
function parseDesc(text: string): string {
	const fm = text.match(/^description:\s*["']?(.+?)["']?\s*$/m);
	if (fm && fm[1]) return fm[1].trim();
	const h = text.match(/^#\s+(.+)$/m);
	if (h && h[1]) {
		// "# /morning - 晨间简报与任务启动" → 取破折号后
		const parts = h[1].split(/\s*[-—]\s*/);
		return (parts.length > 1 ? parts.slice(1).join(" ") : h[1]).trim();
	}
	return "";
}

// 命令兜底描述（.claude/commands 读不到时用；与 CLAUDE.md 命令索引一致）
const COMMAND_FALLBACK: Record<string, string> = {
	morning: "晨间简报与任务启动",
	retrieval: "知识检索与主动关联",
	memory: "记忆三层模型与偏好管理",
	maintain: "回环检查、播种、健康扫描",
	intake: "收件箱智能归档",
	digest: "偏好候选池整理与晋升",
	create: "内容创作工作流",
	output: "输出统一处理器",
	"full-cycle": "一键全量归档+偏好消化+碎片保存",
	"weekly-reset": "周度系统重置",
	"mine-rules": "规则挖掘：从历史提炼操作规则",
	brand: "给 Kit/repo 打个人标签",
};

interface ListedFiles {
	files: string[];
	folders: string[];
}

async function safeList(app: App, path: string): Promise<ListedFiles | null> {
	try {
		const adapter = app.vault.adapter;
		if (!(await adapter.exists(path))) return null;
		return await adapter.list(path);
	} catch {
		return null;
	}
}

async function safeRead(app: App, path: string): Promise<string> {
	try {
		return await app.vault.adapter.read(path);
	} catch {
		return "";
	}
}

function baseName(p: string): string {
	const n = p.split("/").pop() || p;
	return n.replace(/\.md$/, "");
}

export async function collectCapabilities(app: App): Promise<CapabilityGroup[]> {
	// ---- 命令 ----
	const cmdItems: CapabilityItem[] = [];
	const cmdDir = await safeList(app, ".claude/commands");
	if (cmdDir) {
		for (const f of cmdDir.files.filter((x) => x.endsWith(".md")).sort()) {
			const name = baseName(f);
			const desc = parseDesc(await safeRead(app, f)) || COMMAND_FALLBACK[name] || "";
			cmdItems.push({ name: `/${name}`, invoke: `/${name}`, desc, path: f });
		}
	}
	if (cmdItems.length === 0) {
		for (const [name, desc] of Object.entries(COMMAND_FALLBACK)) {
			cmdItems.push({ name: `/${name}`, invoke: `/${name}`, desc });
		}
	}

	// ---- Agents ----
	const agentItems: CapabilityItem[] = [];
	const agentDir = await safeList(app, ".claude/agents");
	if (agentDir) {
		for (const f of agentDir.files.filter((x) => x.endsWith(".md")).sort()) {
			const name = baseName(f);
			agentItems.push({
				name,
				invoke: name,
				desc: parseDesc(await safeRead(app, f)),
				path: f,
			});
		}
	}
	// .agents/skills 下每个文件夹一个 SKILL.md
	const agentSkills = await safeList(app, ".agents/skills");
	if (agentSkills) {
		for (const folder of agentSkills.folders.sort()) {
			const name = baseName(folder);
			let desc = "";
			let itemPath = "";
			for (const cand of [`${folder}/SKILL.md`, `${folder}/README.md`]) {
				const t = await safeRead(app, cand);
				if (t) {
					desc = parseDesc(t);
					itemPath = cand;
					break;
				}
			}
			agentItems.push({ name, invoke: name, desc: desc || "agent skill", path: itemPath || undefined });
		}
	}

	// ---- 工作流 ----
	const wfItems: CapabilityItem[] = [];
	const wfDir = await safeList(app, ".claude/workflows");
	if (wfDir) {
		for (const f of wfDir.files.filter((x) => x.endsWith(".md")).sort()) {
			const name = baseName(f);
			wfItems.push({
				name,
				invoke: name,
				desc: parseDesc(await safeRead(app, f)),
				path: f,
			});
		}
		for (const folder of wfDir.folders.sort()) {
			wfItems.push({ name: baseName(folder), invoke: baseName(folder), desc: "工作流" });
		}
	}

	const groups: CapabilityGroup[] = [
		{ key: "commands", label: "命令", meta: "点击复制 · 在对话中调用", items: cmdItems },
		{ key: "agents", label: "Agents", meta: "子代理 / agent skills", items: agentItems },
	];
	if (wfItems.length > 0) {
		groups.push({ key: "workflows", label: "工作流", meta: ".claude/workflows", items: wfItems });
	}
	return groups;
}

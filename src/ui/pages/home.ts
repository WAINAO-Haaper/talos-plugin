// 首页三视图：系统体检（V1）/ 今日处理（V2）/ 数据画像（V3）。
// 只读数据来自 Collected；V2 的「收下」复用 triage-inbox-note 受控动作。
import { Notice } from "obsidian";
import { openFile } from "../../actions";
import type { TalosView } from "../../view";
import type { Collected } from "../talos-view-model";
import { SCHEMA_LABELS } from "../../data/schema";
import { TRIAGE_TARGET_KEYS, inboxMoveRequest, suggestInboxTriage, type TriageTargetKey } from "../../inbox-triage";
import { evaluateActionRisk } from "../../action-core/risk-policy";
import { readInboxBody, readInboxPreview } from "../../data/inbox-preview";
import { summarizeInboxText } from "../../ai/summarize-inbox";

export type HomeTabKey = "organs" | "triage" | "insight";

const SVG_NS = "http://www.w3.org/2000/svg";
const TABS: ReadonlyArray<{ key: HomeTabKey; label: string; hint: string }> = [
	{ key: "organs", label: "系统体检", hint: "身份、灵魂与六个器官" },
	{ key: "triage", label: "今日处理", hint: "今天进来的东西逐条归位" },
	{ key: "insight", label: "数据画像", hint: "长期结构、关键词与短板" },
];

function num(value: string | undefined): number {
	const parsed = Number(String(value ?? "").replace(/[^\d.]/g, ""));
	return Number.isFinite(parsed) ? parsed : 0;
}

function svg(doc: Document, tag: string, attrs: Record<string, string>): SVGElement {
	const node = doc.createElementNS(SVG_NS, tag);
	for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
	return node;
}

/** 首页三视图的外壳；页签选择在会话内保留。 */
export function renderHomePage(view: TalosView, page: HTMLElement, d: Collected): void {
	const state = view as unknown as { homeTab?: HomeTabKey };
	const active: HomeTabKey = state.homeTab ?? "organs";
	const root = page.createDiv({ cls: "hm-home" });

	const tabs = root.createDiv({ cls: "hm-tabs" });
	tabs.setAttribute("role", "tablist");
	tabs.setAttribute("aria-label", "首页视图");
	const body = root.createDiv({ cls: "hm-body" });

	const draw = (key: HomeTabKey): void => {
		state.homeTab = key;
		for (const button of Array.from(tabs.querySelectorAll<HTMLButtonElement>(".hm-tab"))) {
			const on = button.dataset.tab === key;
			button.classList.toggle("is-active", on);
			button.setAttribute("aria-selected", String(on));
		}
		body.empty();
		if (key === "organs") renderOrgans(view, body, d);
		else if (key === "triage") renderTriage(view, body, d);
		else renderInsight(view, body, d);
	};

	for (const tab of TABS) {
		const button = tabs.createEl("button", { cls: "hm-tab", text: tab.label, attr: { type: "button", role: "tab" } });
		button.dataset.tab = tab.key;
		button.title = tab.hint;
		button.addEventListener("click", () => draw(tab.key));
	}

	draw(active);
}

// ───────────────────────────── V1 · 系统体检 ─────────────────────────────

interface OrganSpec {
	icon: string;
	name: string;
	core?: boolean;
	state: "ok" | "warn" | "bad";
	value: string;
	unit: string;
	verdict: string;
	note: string;
	chart: HTMLElement | SVGElement;
	ctx: "organs" | "triage" | "insight";
}

function stackBar(doc: Document, parts: Array<[number, string]>): HTMLElement {
	const bar = doc.createElement("div");
	bar.className = "hm-bar";
	const total = parts.reduce((sum, [v]) => sum + v, 0) || 1;
	for (const [value, color] of parts) {
		const seg = doc.createElement("i");
		seg.style.width = `${Math.round((value / total) * 100)}%`;
		seg.style.background = color;
		bar.appendChild(seg);
	}
	return bar;
}

function dots(doc: Document, filled: number, total = 8, tone = "#d52b32"): HTMLElement {
	const row = doc.createElement("div");
	row.className = "hm-dots";
	for (let i = 0; i < total; i++) {
		const dot = doc.createElement("i");
		if (i < filled) dot.style.background = tone;
		row.appendChild(dot);
	}
	return row;
}

function ring(doc: Document, percent: number): SVGElement {
	const size = 44;
	const radius = 17;
	const circumference = 2 * Math.PI * radius;
	const node = svg(doc, "svg", { viewBox: `0 0 ${size} ${size}`, class: "hm-ring" });
	node.appendChild(svg(doc, "circle", { cx: "22", cy: "22", r: String(radius), fill: "none", stroke: "#ddd8cc", "stroke-width": "5" }));
	node.appendChild(svg(doc, "circle", {
		cx: "22", cy: "22", r: String(radius), fill: "none", stroke: "#158b69", "stroke-width": "5",
		"stroke-linecap": "round",
		"stroke-dasharray": `${Math.round((Math.max(0, Math.min(100, percent)) / 100) * circumference)} ${Math.round(circumference)}`,
		transform: "rotate(-90 22 22)",
	}));
	return node;
}

function folderExists(view: TalosView, path: string | undefined): boolean {
	if (!path) return false;
	return !!view.app.vault.getAbstractFileByPath(path);
}

function renderOrgans(view: TalosView, host: HTMLElement, d: Collected): void {
	const doc = host.ownerDocument;
	const ins = d.insights;
	const identityFiles = [view.paths.telosFile, view.paths.contextFile, view.paths.profileFile, view.paths.decisionsFile];
	const identityReady = identityFiles.filter((path) => folderExists(view, path)).length;
	const soulFiles = [view.paths.personaFile, view.paths.personaMemoryFile];
	const soulReady = soulFiles.filter((path) => folderExists(view, path)).length;
	const insightCount = num(d.knowledge.metrics.find((m) => m.label === "原创洞察")?.value);
	const materialCount = num(d.knowledge.metrics.find((m) => m.label === "外部素材")?.value);
	const pending = d.approvals.length + d.candidates.length;
	const health = d.healthTrend.at(-1);
	const anomalies = (d.healthDigest?.errors.length ?? 0) + (d.healthDigest?.loopStatus.length ?? 0);

	const head = host.createDiv({ cls: "hm-head" });
	head.createDiv({ cls: "hm-eyebrow", text: "超级大脑 · 系统面板" });
	head.createEl("h1", { cls: "hm-title", text: "身份、灵魂与六器官" });
	head.createEl("p", { cls: "hm-lede", text: `身份 ${identityReady}/4 就绪 · 灵魂 ${soulReady}/2 · 记忆 ${insightCount + materialCount} 篇 · 待决策 ${pending} 项 · 健康 ${health ? health.score : "—"} 分` });

	const specs: OrganSpec[] = [
		{
			icon: "🧬", name: "身份", core: true, state: identityReady === 4 ? "ok" : "warn",
			value: `${identityReady}/4`, unit: "就绪", verdict: `焦点 ${d.focus.length} 条 · 只读锁定`,
			note: "TELOS · PROFILE · CONTEXT", chart: dots(doc, identityReady, 4, "#2052b8"), ctx: "organs",
		},
		{
			icon: "🕯️", name: "灵魂", core: true, state: soulReady === 2 ? "ok" : "warn",
			value: `${soulReady}/2`, unit: "文件", verdict: "人格与人格记忆", note: "PERSONA · persona-memory",
			chart: dots(doc, soulReady, 2, "#6366f1"), ctx: "organs",
		},
		{
			icon: "🐘", name: "记忆", state: ins?.orphans ? "warn" : "ok",
			value: String(insightCount + materialCount), unit: "篇",
			verdict: `原创 ${insightCount} · 外部 ${materialCount}`,
			note: "象群五层 · 权重", chart: stackBar(doc, [[insightCount, "#158b69"], [Math.max(0, materialCount), "#a78bfa"]]), ctx: "insight",
		},
		{
			icon: "🛡️", name: "安全", state: pending > 0 ? "warn" : "ok",
			value: String(pending), unit: "项待批", verdict: "Identity 只读 · 变更需审批",
			note: "洋葱六环 · git-crypt", chart: dots(doc, Math.min(8, pending), 8, "#f59e0b"), ctx: "triage",
		},
		{
			icon: "🕸️", name: "联结", state: (ins?.broken ?? 0) > 0 ? "warn" : "ok",
			value: String(d.knowledge.mocs.length), unit: "个 MOC",
			verdict: `断链 ${ins?.broken ?? 0} · 孤儿 ${ins?.orphans ?? 0}`,
			note: "菌丝网络 · 母树", chart: dots(doc, d.knowledge.mocs.length, 8, "#2052b8"), ctx: "insight",
		},
		{
			icon: "🍽️", name: "摄取", state: d.inbox.count > 0 ? "warn" : "ok",
			value: String(d.inbox.count), unit: "条积压",
			verdict: d.inbox.count ? `最老 ${d.inbox.oldestDays} 天` : "收件箱已清空",
			note: "觅食闸 · 分类 · 排泄", chart: stackBar(doc, d.inbox.ageBuckets.map((b) => [b.count, b.tone === "hot" ? "#e34250" : b.tone === "warn" ? "#f59e0b" : b.tone === "good" ? "#34d399" : "#4d8dff"])), ctx: "triage",
		},
		{
			icon: "🌱", name: "输出", state: "ok",
			value: String(d.output.queueTotal ?? d.output.queue.length), unit: "条待处理",
			verdict: `平台稿件 ${d.output.platforms.length}`,
			note: "r/K 配比 · 一源多态", chart: stackBar(doc, [[d.output.queueTotal ?? 0, "#fb7185"], [Math.max(1, d.output.metrics.length), "#34d399"]]), ctx: "triage",
		},
		{
			icon: "⚙️", name: "自检", state: anomalies > 0 ? "warn" : "ok",
			value: String(health?.score ?? "—"), unit: "分",
			verdict: `错误 ${d.healthDigest?.errors.length ?? 0} · 循环 ${d.healthDigest?.loopStatus.length ?? 0}`,
			note: "自我耐受 · 分级告警", chart: ring(doc, health?.score ?? 0), ctx: "insight",
		},
	];

	const grid = host.createDiv({ cls: "hm-organs" });
	for (const spec of specs) {
		const tile = grid.createEl("button", { cls: "hm-organ", attr: { type: "button" } });
		tile.dataset.state = spec.state;
		if (spec.core) tile.dataset.core = "true";
		const headRow = tile.createDiv({ cls: "hm-organ-head" });
		headRow.createSpan({ cls: "hm-organ-icon", text: spec.icon });
		headRow.createSpan({ cls: "hm-organ-name", text: spec.name });
		if (spec.core) headRow.createSpan({ cls: "hm-core-tag", text: "内核 · 只读" });
		headRow.createSpan({ cls: "hm-organ-state", text: spec.state === "ok" ? "正常" : spec.state === "bad" ? "异常" : "注意" });
		tile.createDiv({ cls: "hm-organ-value", text: spec.value }).createEl("small", { text: spec.unit });
		tile.appendChild(spec.chart);
		tile.createDiv({ cls: "hm-organ-verdict", text: spec.verdict });
		const foot = tile.createDiv({ cls: "hm-organ-foot" });
		foot.createSpan({ cls: "hm-organ-note", text: spec.note });
		foot.createSpan({ cls: "hm-organ-go", text: "详情 →" });
		tile.addEventListener("click", () => {
			stateTab(spec.ctx);
		});
	}

	function stateTab(key: HomeTabKey): void {
		const button = host.parentElement?.querySelector<HTMLButtonElement>(`.hm-tab[data-tab="${key}"]`);
		button?.click();
	}

	// 治理 + 流动
	const row = host.createDiv({ cls: "hm-row" });
	const gov = row.createDiv({ cls: "hm-block" });
	const govHead = gov.createDiv({ cls: "hm-block-head" });
	govHead.createEl("h2", { text: "治理与安全" });
	govHead.createSpan({ text: "A 自动 · B/C 必须审批 · Identity 只读" });
	const govRows: Array<[string, string]> = [
		["A 自动", `${d.healthTrend.length ? "运行中" : "无记录"}`],
		["B/C 待批", `${pending} 项`],
		["Identity", "只读锁定"],
		["数据分级", "按目录约定"],
	];
	for (const [label, value] of govRows) {
		const line = gov.createDiv({ cls: "hm-gov-row" });
		line.createSpan({ cls: "hm-tag", text: label });
		line.createSpan({ cls: "hm-gov-value", text: value });
	}

	const flow = row.createDiv({ cls: "hm-block" });
	const flowHead = flow.createDiv({ cls: "hm-block-head" });
	flowHead.createEl("h2", { text: "知识资产流动" });
	flowHead.createSpan({ text: "摄取 → 洞察/素材 → 项目 → 输出 → 归档" });
	const pipe = flow.createDiv({ cls: "hm-pipe" });
	const stages: Array<[number, string, string]> = [
		[d.inbox.count, "收件", "#f97316"],
		[insightCount + materialCount, "洞察/素材", "#158b69"],
		[d.projects.length, "项目", "#a78bfa"],
		[d.output.queueTotal ?? 0, "输出", "#fb7185"],
		[ins?.stale ?? 0, "长期未动", "#b3ab9c"],
	];
	stages.forEach(([count, label, color], index) => {
		if (index > 0) pipe.createSpan({ cls: "hm-arrow", text: "→" });
		const node = pipe.createDiv({ cls: "hm-node" });
		const top = node.createDiv({ cls: "hm-node-top" });
		top.createEl("b", { text: String(count) });
		top.createSpan({ text: label });
		const bar = node.createDiv({ cls: "hm-bar" });
		const fill = bar.createEl("i");
		fill.style.width = `${Math.min(100, count === 0 ? 0 : 24 + index * 8)}%`;
		fill.style.background = color;
	});

	// 底部折叠：运行入口
	const details = host.createDiv({ cls: "hm-details" });
	for (const [label, target] of [["全部项目", "projects"], ["最近洞察", "knowledge"], ["能力与身份", "identity"]] as const) {
		const item = details.createEl("details", { cls: "hm-detail" });
		item.createEl("summary", { text: label });
		const go = item.createEl("button", { cls: "hm-link", text: "打开 →", attr: { type: "button" } });
		go.addEventListener("click", () => view.navigateToPage(target));
	}
}

// ───────────────────────────── V2 · 今日处理 ─────────────────────────────

function renderTriage(view: TalosView, host: HTMLElement, d: Collected): void {
	const queue = d.inbox.queue ?? [];
	const head = host.createDiv({ cls: "hm-head" });
	head.createDiv({ cls: "hm-eyebrow", text: "超级大脑 · 今日处理" });
	head.createEl("h1", { cls: "hm-title", text: "今日采集处理" });
	head.createEl("p", { cls: "hm-lede", text: queue.length ? `收件箱 ${d.inbox.count} 条，最老 ${d.inbox.oldestDays} 天。逐条归位，或进完整分诊。` : "收件箱没有待分诊条目。" });

	const progress = host.createDiv({ cls: "hm-progress" });
	const progressNum = progress.createDiv({ cls: "hm-progress-num", text: `${queue.length} / ${d.inbox.count}` });
	progressNum.createEl("small", { text: "待处理" });
	const track = progress.createDiv({ cls: "hm-bar" });
	const fill = track.createEl("i");
	fill.style.width = `${d.inbox.count === 0 ? 0 : Math.round((queue.length / d.inbox.count) * 100)}%`;
	fill.setCssProps({ background: "#f59e0b" });
	progress.createDiv({ cls: "hm-progress-note", text: `最老 ${d.inbox.oldestDays} 天` });

	if (!queue.length) {
		const empty = host.createDiv({ cls: "hm-block hm-empty", text: "收件箱已清空，今天没有需要处理的条目。" });
		void empty;
		return;
	}

	const grid = host.createDiv({ cls: "hm-triage" });
	const left = grid.createDiv({ cls: "hm-block hm-queue" });
	left.createDiv({ cls: "hm-block-head" }).createEl("h2", { text: "队列" });
	const list = left.createDiv({ cls: "hm-qlist" });
	const center = grid.createDiv({ cls: "hm-block hm-detail" });
	const right = grid.createDiv({ cls: "hm-block hm-actions" });
	right.createDiv({ cls: "hm-block-head" }).createEl("h2", { text: "处理" });

	let selected = 0;
	const selectedPath = (): string => queue[selected]?.path ?? "";
	const drawDetail = (): void => {
		center.empty();
		right.empty();
		const item = queue[selected];
		if (!item) return;

		const headRow = center.createDiv({ cls: "hm-block-head" });
		headRow.createEl("h2", { text: "当前条目" });
		headRow.createSpan({ text: `第 ${selected + 1} / ${queue.length} 条` });
		center.createEl("h3", { cls: "hm-detail-title", text: item.title });
		const meta = center.createDiv({ cls: "hm-detail-meta" });
		for (const text of [`进入 ${item.ageDays} 天`, item.tags.length ? `标签 ${item.tags.map((t) => `#${t}`).join(" ")}` : "无标签", item.linked.length ? `相关 ${item.linked.length} 篇` : "无相关笔记"]) {
			meta.createSpan({ text });
		}
		const ai = center.createDiv({ cls: "hm-ai" });
		const aiHead = ai.createDiv({ cls: "hm-ai-head" });
		aiHead.createSpan({ cls: "hm-ai-tag", text: "AI 预处理" });
		const aiRun = aiHead.createEl("button", { cls: "hm-ai-run", text: "AI 摘要", attr: { type: "button" } });
		aiRun.title = "把正文发给已配置的模型，生成更凝练的摘要";
		const aiMeta = aiHead.createSpan({ cls: "hm-ai-meta", text: "本地摘要 · 未调用模型" });
		const aiBody = ai.createDiv({ cls: "hm-ai-body" });
		aiBody.createDiv({ cls: "hm-ai-line", text: "正在生成摘要…" });
		const wanted = item.path;
		aiRun.addEventListener("click", () => {
			aiRun.disabled = true;
			aiMeta.textContent = "模型生成中…";
			void (async () => {
				try {
					const body = await readInboxBody(view.app, wanted);
					if (!body) throw new Error("无法读取正文");
					const result = await summarizeInboxText(view.app, view.plugin.talosSettings, body);
					if (!ai.isConnected || selectedPath() !== wanted) return;
					aiBody.empty();
					aiBody.createEl("p", { cls: "hm-ai-para", text: result.summary });
					if (result.points.length) {
						const points = aiBody.createDiv({ cls: "hm-ai-points" });
						result.points.forEach((point, index) => {
							const chip = points.createSpan({ cls: "hm-chip" });
							chip.createSpan({ cls: "hm-ai-index", text: String(index + 1) });
							chip.createSpan({ text: point });
						});
					}
					aiMeta.textContent = `AI 生成 · ${result.provider}`;
				} catch (error) {
					if (!ai.isConnected || selectedPath() !== wanted) return;
					aiBody.createDiv({ cls: "hm-ai-error", text: `AI 摘要失败：${error instanceof Error ? error.message : String(error)}` });
					aiMeta.textContent = "已回退本地摘要";
				} finally {
					aiRun.disabled = false;
				}
			})();
		});

		void readInboxPreview(view.app, item.path).then((preview) => {
			if (!ai.isConnected || selectedPath() !== wanted) return;
			aiBody.empty();
			if (!preview) {
				aiMeta.textContent = "无法读取正文";
				aiBody.createDiv({ cls: "hm-ai-line", text: "这条笔记可能不是 Markdown，或内容为空。" });
				return;
			}
			aiMeta.textContent = `${preview.kind} · ${preview.chars.toLocaleString()} 字 · 约 ${preview.readingMinutes} 分钟 · 链接 ${preview.links}`;
			if (preview.summary) {
				for (const paragraph of preview.summary.split("\n\n")) {
					aiBody.createEl("p", { cls: "hm-ai-para", text: paragraph });
				}
			} else {
				aiBody.createDiv({ cls: "hm-ai-line", text: "没有可提取的正文段落。" });
			}
			if (preview.headings.length) {
				aiBody.createDiv({ cls: "hm-ai-section", text: `内容结构 · ${preview.headings.length} 节` });
				const points = aiBody.createDiv({ cls: "hm-ai-points" });
				preview.headings.forEach((heading, index) => {
					const chip = points.createSpan({ cls: "hm-chip" });
					chip.createSpan({ cls: "hm-ai-index", text: String(index + 1) });
					chip.createSpan({ text: heading });
				});
			}
		});

		const suggestion = suggestInboxTriage(item.title, item.tags);
		const tags = center.createDiv({ cls: "hm-chips" });
		tags.createSpan({ cls: "hm-chip", text: `建议目录 ${suggestion.target ? SCHEMA_LABELS[suggestion.target] : "需人工选择"}` });
		for (const tag of suggestion.tags.slice(0, 4)) tags.createSpan({ cls: "hm-chip", text: `#${tag}` });

		if (item.linked.length) {
			center.createDiv({ cls: "hm-section-label", text: "相关笔记" });
			const links = center.createDiv({ cls: "hm-links" });
			for (const path of item.linked.slice(0, 3)) {
				const link = links.createEl("button", { cls: "hm-link", text: `↗ ${path.split("/").pop() ?? path}`, attr: { type: "button" } });
				link.addEventListener("click", () => void openFile(view.app, path));
			}
		}

		// 动作
		right.createDiv({ cls: "hm-block-head" }).createSpan({ text: "收下走 A 类动作 · 自动刷新 _README" });
		const field = right.createDiv({ cls: "hm-field" });
		field.createDiv({ cls: "hm-field-label", text: "归到目录" });
		const select = field.createEl("select", { cls: "hm-select" });
		for (const key of TRIAGE_TARGET_KEYS) {
			const option = select.createEl("option", { text: `${SCHEMA_LABELS[key]} · ${view.paths.dir(key)}`, attr: { value: key } });
			if (suggestion.target === key) option.selected = true;
		}
		if (!suggestion.target) select.value = "assets";

		const actions = right.createDiv({ cls: "hm-action-list" });
		const accept = actions.createEl("button", { cls: "hm-btn primary", text: "收下并归位", attr: { type: "button" } });
		accept.addEventListener("click", () => {
			void moveItem(item.path, (select.value as TriageTargetKey) ?? "assets");
		});
		const later = actions.createEl("button", { cls: "hm-btn", text: "稍后再说", attr: { type: "button" } });
		later.addEventListener("click", () => {
			selected = Math.min(selected + 1, queue.length - 1);
			drawDetail();
			markQueue();
		});
		const open = actions.createEl("button", { cls: "hm-btn quiet", text: "打开原文", attr: { type: "button" } });
		open.addEventListener("click", () => void openFile(view.app, item.path));
		const keys = right.createDiv({ cls: "hm-keys" });
		keys.createSpan({ text: "收下 = 移动 + 打标签 + 刷新 _README" });

		const goTriage = right.createEl("button", { cls: "hm-link", text: "进入完整分诊 →", attr: { type: "button" } });
		goTriage.addEventListener("click", () => view.navigateToPage("inbox"));
	};

	const markQueue = (): void => {
		for (const button of Array.from(list.querySelectorAll<HTMLButtonElement>(".hm-qitem"))) {
			const index = Number(button.dataset.index ?? "0");
			button.dataset.active = String(index === selected);
		}
	};

	queue.forEach((item, index) => {
		const button = list.createEl("button", { cls: "hm-qitem", attr: { type: "button" } });
		button.dataset.index = String(index);
		button.dataset.active = String(index === selected);
		const dot = button.createSpan({ cls: "hm-qdot" });
		dot.style.background = item.tags.length ? "#f97316" : "#b3ab9c";
		const copy = button.createDiv({ cls: "hm-qcopy" });
		copy.createSpan({ cls: "hm-qtitle", text: item.title });
		copy.createSpan({ cls: "hm-qmeta", text: `${item.ageDays} 天 · ${item.tags.length ? item.tags.slice(0, 2).map((t) => `#${t}`).join(" ") : "无标签"}` });
		button.addEventListener("click", () => {
			selected = index;
			drawDetail();
			markQueue();
		});
	});

	drawDetail();

	async function moveItem(path: string, targetKey: TriageTargetKey): Promise<void> {
		const runtime = view.plugin.getConsoleActionRuntime();
		const definition = runtime.registry.get("triage-inbox-note");
		const name = path.split("/").pop() ?? path;
		const plan = { from: path, to: `${view.paths.dir(targetKey)}/${name}`, targetKey };
		const request = inboxMoveRequest(plan);
		if (definition) evaluateActionRisk(definition, request);
		const task = await runtime.runner.run({
			actionId: "triage-inbox-note",
			idempotencyKey: `home-triage:${path}->${plan.to}:${Date.now()}`,
			input: { from: plan.from, to: plan.to },
			request,
			approvalGranted: true,
		});
		new Notice(task.state === "completed" ? `已归档到 ${plan.to}` : `未完成：${task.error ?? task.state}`);
		if (task.state === "completed") await view.refresh();
	}
}

// ───────────────────────────── V3 · 数据画像 ─────────────────────────────

function renderInsight(view: TalosView, host: HTMLElement, d: Collected): void {
	const doc = host.ownerDocument;
	const ins = d.insights;
	const total = ins?.total ?? 0;
	const tagCount = ins?.tagCount ?? 0;
	const density = ins?.density ?? 0;
	const compliance = ins?.compliance ?? 0;

	const head = host.createDiv({ cls: "hm-head" });
	head.createDiv({ cls: "hm-eyebrow", text: "知识资产 · 长期画像" });
	head.createEl("h1", { cls: "hm-title", text: "你的数据长什么样" });
	head.createEl("p", { cls: "hm-lede", text: `${total} 篇笔记 · ${ins?.folders.length ?? 0} 个内容域 · ${tagCount} 个标签 · 断链 ${ins?.broken ?? 0} · 孤儿 ${ins?.orphans ?? 0} · 未打标签 ${ins?.untagged ?? 0} · 90 天未动 ${ins?.stale ?? 0}` });

	const kpis = host.createDiv({ cls: "hm-kpis" });
	const kpi = (label: string, value: string, unit: string, sub: string): void => {
		const card = kpis.createDiv({ cls: "hm-kpi" });
		card.createDiv({ cls: "hm-kpi-label", text: label });
		const v = card.createDiv({ cls: "hm-kpi-value", text: value });
		v.createEl("small", { text: unit });
		card.createDiv({ cls: "hm-kpi-sub", text: sub });
	};
	const recent = ins?.months.at(-1)?.count ?? 0;
	kpi("笔记总量", String(total), "篇", `本月新增 ${recent}`);
	kpi("标签体系", String(tagCount), "个", ins?.topTags.length ? `高频 ${ins.topTags.length} 个` : "未识别到标签");
	kpi("连接密度", String(density), "条/篇", `双链 ${ins?.links ?? 0} · 孤儿 ${ins?.orphans ?? 0}`);
	kpi("结构完整度", String(compliance), "分", `frontmatter 必填齐全`);

	const grid = host.createDiv({ cls: "hm-grid" });

	// 图谱
	const graphCard = grid.createDiv({ cls: "hm-block hm-graph-card" });
	const gHead = graphCard.createDiv({ cls: "hm-block-head" });
	gHead.createEl("h2", { text: "知识图谱" });
	gHead.createSpan({ text: "节点大小 = 笔记量 · 连线 = 从属" });
	const graph = svg(doc, "svg", { viewBox: "0 0 720 330", class: "hm-graph", role: "img" });
	const folders = ins?.folders ?? [];
	const max = Math.max(1, ...folders.map((f) => f.count));
	const cx = 360, cy = 165, rx = 230, ry = 118;
	const points = folders.map((folder, index) => {
		const angle = -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(folders.length, 1);
		return { folder, x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry, r: 10 + Math.sqrt(folder.count / max) * 22, angle };
	});
	for (const point of points) {
		graph.appendChild(svg(doc, "line", { x1: String(cx), y1: String(cy), x2: String(point.x), y2: String(point.y), stroke: "rgba(16,16,16,.2)", "stroke-width": "1.4" }));
	}
	for (let i = 1; i < points.length; i++) {
		graph.appendChild(svg(doc, "line", { x1: String(points[i - 1].x), y1: String(points[i - 1].y), x2: String(points[i].x), y2: String(points[i].y), stroke: "rgba(16,16,16,.08)" }));
	}
	const colors = ["#158b69", "#a78bfa", "#2052b8", "#f59e0b", "#b3ab9c", "#f97316"];
	points.forEach((point, index) => {
		graph.appendChild(svg(doc, "circle", { cx: String(point.x), cy: String(point.y), r: String(point.r), fill: colors[index % colors.length] }));
		const label = svg(doc, "text", { x: String(point.x), y: String(point.y - point.r - 8), "text-anchor": "middle" });
		label.textContent = point.folder.name;
		graph.appendChild(label);
		const count = svg(doc, "text", { x: String(point.x), y: String(point.y + point.r + 14), "text-anchor": "middle" });
		count.textContent = String(point.folder.count);
		count.setAttribute("fill", "#716b60");
		graph.appendChild(count);
	});
	graph.appendChild(svg(doc, "circle", { cx: String(cx), cy: String(cy), r: "36", fill: "#101010" }));
	const coreLabel = svg(doc, "text", { x: String(cx), y: String(cy - 2), "text-anchor": "middle", fill: "#f5f2ea", "font-size": "12" });
	coreLabel.textContent = "全库";
	graph.appendChild(coreLabel);
	const coreCount = svg(doc, "text", { x: String(cx), y: String(cy + 13), "text-anchor": "middle", "fill": "rgba(245,242,234,.7)", "font-size": "10" });
	coreCount.textContent = String(total);
	graph.appendChild(coreCount);
	graphCard.appendChild(graph);

	// 关键词
	const tagCard = grid.createDiv({ cls: "hm-block" });
	const tHead = tagCard.createDiv({ cls: "hm-block-head" });
	tHead.createEl("h2", { text: "高频关键词" });
	tHead.createSpan({ text: "标签 + frontmatter 词频" });
	const tags = tagCard.createDiv({ cls: "hm-words" });
	const top = ins?.topTags ?? [];
	const maxTag = Math.max(1, ...top.map((t) => t.count));
	if (!top.length) tags.createDiv({ cls: "hm-empty", text: "未识别到标签" });
	for (const tag of top) {
		const row = tags.createDiv({ cls: "hm-word" });
		row.createSpan({ text: `#${tag.tag}` });
		const track = row.createDiv({ cls: "hm-bar" });
		const fill = track.createEl("i");
		fill.style.width = `${Math.round((tag.count / maxTag) * 100)}%`;
		fill.setCssProps({ background: "#2052b8" });
		row.createEl("b", { text: String(tag.count) });
	}

	// 增长 / 短板 / 常用
	const row = host.createDiv({ cls: "hm-trow" });
	const growth = row.createDiv({ cls: "hm-block" });
	growth.createDiv({ cls: "hm-block-head" }).createEl("h2", { text: "增长趋势" });
	const months = ins?.months ?? [];
	const maxMonth = Math.max(1, ...months.map((m) => m.count));
	const chart = growth.createDiv({ cls: "hm-months" });
	for (const month of months) {
		const col = chart.createDiv({ cls: "hm-month" });
		const bar = col.createDiv({ cls: "hm-month-bar" });
		const fill = bar.createEl("i");
		fill.style.height = `${Math.round((month.count / maxMonth) * 100)}%`;
		if (month.current) fill.setCssProps({ background: "#158b69" });
		col.createSpan({ text: month.label });
	}

	const gaps = row.createDiv({ cls: "hm-block" });
	gaps.createDiv({ cls: "hm-block-head" }).createEl("h2", { text: "需要弥补" });
	const gapList = gaps.createDiv({ cls: "hm-gaps" });
	const gapSpecs: Array<[number, string, string, string]> = [
		[ins?.untagged ?? 0, "无标签笔记", "检索时找不到", "triage"],
		[ins?.orphans ?? 0, "孤儿笔记", "没有任何双链指向", "insight"],
		[ins?.broken ?? 0, "断链", "指向的目标已不存在", "insight"],
		[ins?.stale ?? 0, "90 天未更新", "可能已经过期", "insight"],
		[ins?.missingReadme ?? 0, "目录缺说明", "新人/AI 无处读规则", "settings"],
	];
	for (const [count, label, hint, target] of gapSpecs) {
		if (count <= 0) continue;
		const line = gapList.createDiv({ cls: "hm-gap" });
		line.dataset.tone = count >= 20 ? "bad" : "warn";
		line.createSpan({ cls: "hm-gap-dot" });
		const copy = line.createDiv({ cls: "hm-gap-copy" });
		copy.createSpan({ cls: "hm-gap-label", text: label });
		copy.createSpan({ cls: "hm-gap-hint", text: hint });
		line.createSpan({ cls: "hm-gap-num", text: String(count) });
		const go = line.createEl("button", { cls: "hm-link", text: "去修 →", attr: { type: "button" } });
		go.addEventListener("click", () => view.navigateToPage(target));
	}
	if (!gapList.childElementCount) gapList.createDiv({ cls: "hm-empty", text: "没有识别到结构性缺口" });

	const foldersCard = row.createDiv({ cls: "hm-block" });
	foldersCard.createDiv({ cls: "hm-block-head" }).createEl("h2", { text: "常用数据" });
	const folderList = foldersCard.createDiv({ cls: "hm-words" });
	const maxFolder = Math.max(1, ...folders.map((f) => f.count));
	for (const folder of folders) {
		const line = folderList.createDiv({ cls: "hm-word" });
		line.createSpan({ text: folder.name });
		const track = line.createDiv({ cls: "hm-bar" });
		const fill = track.createEl("i");
		fill.style.width = `${Math.round((folder.count / maxFolder) * 100)}%`;
		fill.setCssProps({ background: "#a78bfa" });
		line.createEl("b", { text: String(folder.count) });
	}
	if (!folders.length) folderList.createDiv({ cls: "hm-empty", text: "目录未识别" });
}

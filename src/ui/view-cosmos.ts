// TALOS 控制台像素巡逻与宇宙状态区；由 TalosView 委托调用。
import type { Collected } from "./talos-view-model";
import { primaryPage } from "./navigation-model";
import { setIcon } from "obsidian";
import type { TalosView } from "../view";

export function updateCosmosHeader(view: TalosView): void {
	if (!view.cosmosTitleEl || !view.cosmosSubEl || !view.cosmosStatusTextEl) return;
	const route = view.pageRouter.current();
	const primary = primaryPage(route.primary);
	const secondary = primary.children.find(
		(child) => child.key === route.secondary
	);
	const isWorkbench = route.primary === "workbench";
	view.cosmosTitleEl.setText(
		isWorkbench
			? view.plugin.talosSettings.mainTitle
			: secondary?.label || primary.label
	);
	view.cosmosSubEl.setText(primary.subtitle);
	view.cosmosStatusTextEl.setText(
		isWorkbench ? "系统运行中" : primary.label
	);
}

/**
 * 像素小人舞台（design-system/talos/pixel-bot-system.md）。
 * 同一个 DOM 用于两处：共享 Hero（总览页巡航）与各业务页的
 * module-hero（场景皮肤按 data-talos-page 切换）。道具常驻 DOM、
 * 默认隐藏，显隐/位置由 syncPixelScene 在渲染后一次性写入。
 */
export function buildPixelPatrol(view: TalosView, parent: HTMLElement): HTMLElement {
	const patrol = parent.createDiv({ cls: "talos-pixel-patrol" });
	patrol.setAttribute("aria-hidden", "true");
	patrol.createDiv({ cls: "talos-pixel-track" });
	const bot = patrol.createDiv({ cls: "talos-pixel-bot" });
	bot.createSpan({ cls: "talos-pixel-shadow" });
	bot.createSpan({ cls: "talos-pixel-antenna" });
	const head = bot.createSpan({ cls: "talos-pixel-head" });
	head.createSpan({ cls: "talos-pixel-eye left" });
	head.createSpan({ cls: "talos-pixel-eye right" });
	head.createSpan({ cls: "talos-pixel-mark" });
	head.createSpan({ cls: "pixel-prop bandage" });
	bot.createSpan({ cls: "talos-pixel-body" });
	const parcelRack = patrol.createDiv({ cls: "pixel-props pixel-props-parcels" });
	for (let i = 0; i < 6; i++) {
		parcelRack.createSpan({ cls: "pixel-prop parcel" });
	}
	const flagLine = patrol.createDiv({ cls: "pixel-props pixel-props-flags" });
	for (let i = 0; i < view.dailyTimeline().length; i++) {
		flagLine.createSpan({ cls: "pixel-prop flag" });
	}
	patrol.createSpan({ cls: "pixel-prop zzz", text: "Zzz" });
	// 批次 2 道具：health 心电脉冲 / talos 闸门 / output 火箭 + 停止牌
	const ecgLine = patrol.createDiv({ cls: "pixel-props pixel-props-ecg" });
	for (let i = 0; i < 5; i++) {
		ecgLine.createSpan({ cls: "pixel-prop pulse" });
	}
	const gateLine = patrol.createDiv({ cls: "pixel-props pixel-props-gates" });
	for (let i = 0; i < 3; i++) {
		gateLine.createSpan({ cls: "pixel-prop gate" });
	}
	const rocketRack = patrol.createDiv({ cls: "pixel-props pixel-props-rockets" });
	for (let i = 0; i < 5; i++) {
		rocketRack.createSpan({ cls: "pixel-prop rocket" });
	}
	patrol.createSpan({ cls: "pixel-prop sign" });
	// 批次 3 道具：projects 安全帽 + 集装箱 / knowledge 悬浮岛 + 幼苗 /
	// vault 雷达盘 + 热力 blip（zzz 复用 daily 的元素）
	head.createSpan({ cls: "pixel-prop helmet" });
	const crateLine = patrol.createDiv({ cls: "pixel-props pixel-props-crates" });
	for (let i = 0; i < 3; i++) {
		crateLine.createSpan({ cls: "pixel-prop crate" });
	}
	const isleLine = patrol.createDiv({ cls: "pixel-props pixel-props-isles" });
	for (let i = 0; i < 5; i++) {
		isleLine.createSpan({ cls: "pixel-prop isle" });
	}
	const sproutLine = patrol.createDiv({ cls: "pixel-props pixel-props-sprouts" });
	for (let i = 0; i < 3; i++) {
		sproutLine.createSpan({ cls: "pixel-prop sprout" });
	}
	patrol.createSpan({ cls: "pixel-prop radar" });
	const blipLine = patrol.createDiv({ cls: "pixel-props pixel-props-blips" });
	for (let i = 0; i < 5; i++) {
		blipLine.createSpan({ cls: "pixel-prop blip" });
	}
	// 批次 4 道具：identity 镜厅（镜框 + 刻痕 + 镜像小人，全系统唯一双 bot）/
	// capability 接线员（交换机 + 插线，线缆挂在板内定位）
	const mirror = patrol.createSpan({ cls: "pixel-prop mirror" });
	for (let i = 0; i < 4; i++) {
		mirror.createSpan({ cls: "notch" });
	}
	const reflection = patrol.createDiv({ cls: "talos-pixel-bot reflection" });
	reflection.createSpan({ cls: "talos-pixel-shadow" });
	reflection.createSpan({ cls: "talos-pixel-antenna" });
	const rHead = reflection.createSpan({ cls: "talos-pixel-head" });
	rHead.createSpan({ cls: "talos-pixel-eye left" });
	rHead.createSpan({ cls: "talos-pixel-eye right" });
	rHead.createSpan({ cls: "talos-pixel-mark" });
	reflection.createSpan({ cls: "talos-pixel-body" });
	const board = patrol.createSpan({ cls: "pixel-prop board" });
	for (let i = 0; i < 6; i++) {
		board.createSpan({ cls: "pixel-prop cord" });
	}
	return patrol;
}

export function renderCosmosStats(view: TalosView, d: Collected): void {
	if (!view.cosmosNodesEl) return;
	view.cosmosNodesEl.empty();
	const capCount = d.capGroups.reduce((sum, g) => sum + g.items.length, 0);
	const nodes = [
		{ page: "output", icon: "send", label: "输出", value: d.output.metrics[0]?.value ?? String(d.warRoom.published), sub: "今日输出", ac: "#FB7185" },
		{ page: "inbox", icon: "inbox", label: "收件箱", value: String(d.inbox.count), sub: "待处理", ac: "#FBBF24" },
		{ page: "health", icon: "activity", label: "健康", value: d.overview.health.value, sub: "系统分", ac: "#34D399" },
		{ page: "projects", icon: "folder", label: "项目", value: String(d.projects.length), sub: "进行中", ac: "#F59E0B" },
		{ page: "capability", icon: "box", label: "能力", value: String(capCount), sub: "能力模块", ac: "#14B8A6" },
		{ page: "knowledge", icon: "book-open", label: "知识", value: d.overview.totalNotes.value, sub: "知识节点", ac: "#A78BFA" },
	];
	nodes.forEach((item, i) => {
		const node = view.cosmosNodesEl.createDiv({ cls: `cosmos-node n${i + 1}` });
		node.setCssProps({ "--node-ac": item.ac });
		const icon = node.createDiv({ cls: "cosmos-node-icon" });
		setIcon(icon, item.icon);
		const copy = node.createDiv({ cls: "cosmos-node-copy" });
		copy.createEl("b", { text: item.label });
		copy.createEl("strong", { text: item.value });
		copy.createSpan({ text: item.sub });
		const arrow = node.createDiv({ cls: "cosmos-node-arrow" });
		setIcon(arrow, "chevron-right");
		node.addEventListener("click", () => {
			view.activePage = item.page;
			view.renderNav();
			view.renderPage();
		});
	});
}

/**
 * 像素小人场景数据契约（design-system/talos/pixel-bot-system.md §1.2）。
 * 只在渲染/刷新时写 CSS 变量与道具内联样式，动画全部交给 CSS steps()，
 * 不引入任何 JS 帧循环。批次 1：inbox 搬运工 + daily 通勤者；
 * 批次 2：health 心电监护 + talos 闸门守卫 + output 发射指挥；
 * 批次 3：projects 工地巡视 + knowledge 星图园丁 + vault 雷达守夜人；
 * 批次 4：identity 镜厅（双 bot 镜像）+ capability 接线员。
 */
export function syncPixelScene(view: TalosView, d: Collected): void {
	// 总览页舞台在共享 Hero；业务页舞台在该页 module-hero 内（每次渲染重建，需重新查询）
	const patrol = view.activePage === "overview"
		? view.patrolEl
		: view.pageEl?.querySelector<HTMLElement>(".talos-pixel-patrol");
	if (!patrol) return;
	const parcels = Array.from(patrol.querySelectorAll<HTMLElement>(".pixel-prop.parcel"));
	const flags = Array.from(patrol.querySelectorAll<HTMLElement>(".pixel-prop.flag"));
	const zzz = patrol.querySelector<HTMLElement>(".pixel-prop.zzz");
	// inbox 搬运工：包裹数 = min(count, 6)，最老 ≥14d 时末尾包裹落灰抖动；
	// 清空时回到普通巡航（data-scene-empty 还原步态）
	const parcelCount = Math.min(d.inbox.count, parcels.length);
	parcels.forEach((el, i) => {
		el.classList.toggle("is-on", i < parcelCount);
		el.classList.toggle(
			"is-stale",
			i === parcelCount - 1 && parcelCount > 0 && d.inbox.oldestDays >= 14
		);
	});
	patrol.dataset.sceneEmpty = String(d.inbox.count === 0);
	// daily 通勤者：小人位置 = 当前时刻在骨架窗口中的进度；里程碑旗按时段分布
	// （--scene-progress 的语义按页不同，只在 daily 页写时间进度，避免污染其他场景）
	if (view.activePage === "daily") {
		const timeline = view.dailyTimeline();
		const dayStart = timeline[0]?.mins ?? 510;
		const lastSlot = timeline[timeline.length - 1];
		const dayEnd = (lastSlot?.mins ?? 1020) + (lastSlot?.dur ?? 20);
		const now = new Date();
		const minsNow = now.getHours() * 60 + now.getMinutes();
		const progress = Math.min(1, Math.max(0, (minsNow - dayStart) / (dayEnd - dayStart)));
		// --scene-progress = 真实时间进度（轨道色带/旗帜用）；
		// --bot-progress = 小人通勤终点，保底 15%——早于首时段时终点=起点
		// 会原地不动（2026-07-20 07:58 实机反馈），给一段可见行程
		patrol.setCssProps({
			"--scene-progress": progress.toFixed(3),
			"--bot-progress": Math.max(progress, 0.15).toFixed(3),
		});
		flags.forEach((el, i) => {
			const slot = timeline[i];
			if (!slot) {
				el.removeClass("is-on");
				return;
			}
			el.addClass("is-on");
			el.style.left = `${(((slot.mins - dayStart) / (dayEnd - dayStart)) * 100).toFixed(1)}%`;
			el.classList.toggle("is-done", minsNow >= slot.mins + slot.dur);
			el.classList.toggle("is-now", minsNow >= slot.mins && minsNow < slot.mins + slot.dur);
		});
		zzz?.classList.toggle("is-visible", progress >= 1);
	}
	// 批次 2 · health 心电监护：健康分 <90 → 创可贴 + 步频减半（tone=hurt）；
	// 断链 >0 → 心电图纸带毛刺抖动
	if (view.activePage === "health") {
		const score = Number.parseInt(
			d.healthDigest.metrics.find((m) => m.label === "健康分")?.value ?? "",
			10
		);
		const broken = Number.parseInt(
			d.healthDigest.metrics.find((m) => m.label === "断链")?.value ?? "",
			10
		) || 0;
		patrol.dataset.sceneTone = Number.isFinite(score) && score < 90 ? "hurt" : "";
		patrol.dataset.sceneGlitch = String(broken > 0);
	}
	// 批次 2 · talos 闸门守卫：闸门位置均布轨道，done=常开绿灯 / ready=闪烁 /
	// blocked=红灯闭合；--scene-progress = 当前闸门前站位（已过闸门比例推算）
	if (view.activePage === "talos") {
		const gateEls = Array.from(patrol.querySelectorAll<HTMLElement>(".pixel-prop.gate"));
		const gates = d.warRoom.gates.slice(0, gateEls.length);
		const doneCount = gates.filter((g) => g.state === "done").length;
		gateEls.forEach((el, i) => {
			const gate = gates[i];
			el.classList.toggle("is-on", Boolean(gate));
			if (!gate) return;
			el.style.left = `${(((i + 1) / (gates.length + 1)) * 100).toFixed(1)}%`;
			el.classList.toggle("is-open", gate.state === "done");
			el.classList.toggle("is-now", gate.state === "ready");
			el.classList.toggle("is-blocked", gate.state === "blocked");
		});
		const progress = gates.length > 0
			? (doneCount + 0.7) / (gates.length + 1)
			: 0.4;
		patrol.setCssProps({ "--scene-progress": progress.toFixed(3) });
	}
	// 批次 2 · output 发射指挥：待发队列 = 排队火箭（cap 5）；published 增加时
	// 队首火箭一次性点火升空；stopTriggered → 红灯 + 小人举停止牌静止。
	// lastPublished 只在 output 页更新，「发布后再进作战室」同样能看到升空。
	if (view.activePage === "output") {
		const rockets = Array.from(patrol.querySelectorAll<HTMLElement>(".pixel-prop.rocket"));
		const queued = Math.min(d.output.queue.length, rockets.length);
		rockets.forEach((el, i) => el.classList.toggle("is-on", i < queued));
		patrol.dataset.sceneTone = d.warRoom.stopTriggered ? "hot" : "";
		const published = d.warRoom.published;
		if (view.lastPublished !== undefined && published > view.lastPublished) {
			const top = rockets.find((el) => el.classList.contains("is-on"));
			top?.classList.add("is-launch");
		}
		view.lastPublished = published;
	}
	// 批次 3 · projects 工地巡视：P0 项目 = 发光集装箱（cap 3），小人戴安全帽巡检
	if (view.activePage === "projects") {
		const crates = Array.from(patrol.querySelectorAll<HTMLElement>(".pixel-prop.crate"));
		const p0Count = d.projects.filter((p) => p.priority === "p0").length;
		const shown = Math.min(p0Count, crates.length);
		crates.forEach((el, i) => el.classList.toggle("is-on", i < shown));
	}
	// 批次 3 · knowledge 星图园丁：MOC = 悬浮岛（cap 5），近期洞察 = 岛间幼苗（cap 3）
	if (view.activePage === "knowledge") {
		const isles = Array.from(patrol.querySelectorAll<HTMLElement>(".pixel-prop.isle"));
		const isleCount = Math.min(d.knowledge.mocs.length, isles.length);
		isles.forEach((el, i) => el.classList.toggle("is-on", i < isleCount));
		const sprouts = Array.from(patrol.querySelectorAll<HTMLElement>(".pixel-prop.sprout"));
		const sproutCount = Math.min(d.knowledge.recentInsights.length, sprouts.length);
		sprouts.forEach((el, i) => el.classList.toggle("is-on", i < sproutCount));
	}
	// 批次 3 · vault 雷达守夜人：热力密集天数 → 雷达 blip（cap 5）；
	// 小人全程打盹，zzz 常显（复用 daily 的 zzz 元素）
	if (view.activePage === "vault") {
		let hotCells = 0;
		for (const month of d.heatmap.months) {
			for (const week of month.weeks) {
				for (const cell of week) {
					if (cell.date !== "" && cell.level >= 3) hotCells++;
				}
			}
		}
		const blips = Array.from(patrol.querySelectorAll<HTMLElement>(".pixel-prop.blip"));
		const blipCount = Math.min(hotCells, blips.length);
		blips.forEach((el, i) => el.classList.toggle("is-on", i < blipCount));
		zzz?.classList.add("is-visible");
	}
	// 批次 4 · identity 镜厅：Identity/灵魂文件数 → 镜框刻痕（cap 4）；
	// 镜像小人为纯 CSS 实例，无需 JS 写入
	if (view.activePage === "identity") {
		const notches = Array.from(patrol.querySelectorAll<HTMLElement>(".pixel-prop.mirror .notch"));
		const shown = Math.min(view.moduleCount(d, "identity") + view.moduleCount(d, "soul"), notches.length);
		notches.forEach((el, i) => el.classList.toggle("is-on", i < shown));
	}
	// 批次 4 · capability 接线员：可用命令数 = 已插线缆数（cap 6）
	if (view.activePage === "capability") {
		const cords = Array.from(patrol.querySelectorAll<HTMLElement>(".pixel-prop.board .cord"));
		const commandCount = d.capGroups.find((g) => g.key === "commands")?.items.length ?? 0;
		const shown = Math.min(commandCount, cords.length);
		cords.forEach((el, i) => el.classList.toggle("is-on", i < shown));
	}
}

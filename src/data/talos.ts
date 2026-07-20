import { App, TFile, normalizePath } from "obsidian";
import type { TalosSettings } from "../settings";
import type { GateItem, ReleaseWarRoom } from "../types";

const DAY = 86400000;

function stripMd(s: string): string {
	return (s || "")
		.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
		.replace(/\[\[([^\]]+)\]\]/g, (_m, p: string) => p.split("/").pop() || p)
		.replace(/\*\*/g, "")
		.replace(/→.*$/, "")
		.replace(/`/g, "")
		.trim();
}

function gateState(mark: string, body: string): GateItem["state"] {
	if (mark === "x") return "done";
	if (mark === "~") return "ready";
	// 视图与像素小人场景都为 blocked 准备了样式；正文出现卡点/阻塞措辞时标记为 blocked
	if (/卡点|卡住|阻塞|受阻|blocked/i.test(body)) return "blocked";
	return "todo";
}

function firstWikiPath(body: string): string | undefined {
	const m = body.match(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/);
	return m?.[1] ? `${m[1]}.md` : undefined;
}

export async function collectWarRoom(
	app: App,
	settings: TalosSettings
): Promise<ReleaseWarRoom> {
	const empty: ReleaseWarRoom = {
		published: 0,
		totalPub: 3,
		frozenDays: 0,
		stopTriggered: false,
		gates: [],
		pubActions: [],
	};

	const file = app.vault.getAbstractFileByPath(
		normalizePath(settings.talosTasksPath)
	);
	if (!(file instanceof TFile)) return empty;
	const raw = await app.vault.cachedRead(file);
	const lines = raw.split("\n");

	const gates: GateItem[] = [];
	const pubActions: GateItem[] = [];

	for (const ln of lines) {
		const g = ln.match(/^-\s*\[([ x~])\]\s*\*\*(G\d)\*\*\s*(.*)$/);
		if (g) {
			const mark = g[1] || " ";
			const id = g[2] || "";
			const body = g[3] || "";
			gates.push({
				id,
				title: stripMd(body).slice(0, 60),
				state: gateState(mark.trim() || " ", body),
				path: firstWikiPath(body) || file.path,
			});
			continue;
		}
		const p = ln.match(/^-\s*\[([ x~])\]\s*\*\*(PUB-W\s*[ABC])\*\*\s*(.*)$/);
		if (p) {
			const mark = (p[1] || " ").trim();
			const id = (p[2] || "").replace(/\s+/g, " ");
			const body = p[3] || "";
			pubActions.push({
				id,
				title: stripMd(body).slice(0, 60),
				state: mark === "x" ? "done" : "todo",
				path: firstWikiPath(body) || file.path,
			});
		}
	}

	const published = pubActions.filter((p) => p.state === "done").length;

	// 冻结天数
	let frozenDays = 0;
	const fd = settings.freezeStartDate.match(/(\d{4})-(\d{2})-(\d{2})/);
	if (fd) {
		const start = new Date(
			Number(fd[1]),
			Number(fd[2]) - 1,
			Number(fd[3])
		).getTime();
		frozenDays = Math.max(0, Math.floor((Date.now() - start) / DAY));
	}

	const stopTriggered =
		(/停止条件/.test(raw) && /触发/.test(raw)) || (published === 0 && frozenDays >= 14);

	return {
		published,
		totalPub: pubActions.length || 3,
		frozenDays,
		stopTriggered,
		gates,
		pubActions,
	};
}

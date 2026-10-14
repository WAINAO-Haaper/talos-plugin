export const SUPERBRAIN_CANVAS_CARDS = [
	"focus", "inbox", "pending", "quick", "recent", "runs", "recovery",
] as const;

export type SuperbrainCanvasCard = typeof SUPERBRAIN_CANVAS_CARDS[number];

export interface SuperbrainCanvasTab {
	id: string;
	label: string;
	cards: SuperbrainCanvasCard[];
}

export interface SuperbrainCanvasLayout {
	version: 1;
	activeTabId: string;
	tabs: SuperbrainCanvasTab[];
}

export const DEFAULT_SUPERBRAIN_CANVAS_LAYOUT: SuperbrainCanvasLayout = {
	version: 1,
	activeTabId: "home",
	tabs: [
		{ id: "home", label: "主页", cards: ["focus", "inbox", "pending", "quick", "recent"] },
		{ id: "knowledge", label: "资料", cards: ["inbox", "recent", "quick"] },
		{ id: "creative", label: "创作", cards: ["focus", "recent", "quick"] },
	],
};

const CARD_SET = new Set<string>(SUPERBRAIN_CANVAS_CARDS);
const MAX_TABS = 8;
const MAX_CARDS = SUPERBRAIN_CANVAS_CARDS.length;

function cleanLabel(value: unknown): string {
	return typeof value === "string" ? value.trim().slice(0, 24) : "";
}

function copy(layout: SuperbrainCanvasLayout): SuperbrainCanvasLayout {
	return {
		version: 1,
		activeTabId: layout.activeTabId,
		tabs: layout.tabs.map(tab => ({ id: tab.id, label: tab.label, cards: [...tab.cards] })),
	};
}

export function normalizeSuperbrainCanvasLayout(value: unknown): SuperbrainCanvasLayout {
	if (!value || typeof value !== "object" || Array.isArray(value)) return copy(DEFAULT_SUPERBRAIN_CANVAS_LAYOUT);
	const source = value as Record<string, unknown>;
	if (source.version !== 1 || !Array.isArray(source.tabs)) return copy(DEFAULT_SUPERBRAIN_CANVAS_LAYOUT);
	const tabs: SuperbrainCanvasTab[] = [];
	const seenIds = new Set<string>();
	for (const raw of source.tabs.slice(0, MAX_TABS)) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
		const tab = raw as Record<string, unknown>;
		const id = typeof tab.id === "string" && /^[a-z][a-z0-9-]{0,39}$/.test(tab.id) ? tab.id : "";
		const label = cleanLabel(tab.label);
		if (!id || !label || seenIds.has(id) || !Array.isArray(tab.cards)) continue;
		seenIds.add(id);
		const cards = [...new Set(tab.cards.filter((card): card is SuperbrainCanvasCard =>
			typeof card === "string" && CARD_SET.has(card)
		))].slice(0, MAX_CARDS);
		tabs.push({ id, label, cards });
	}
	if (!tabs.length) return copy(DEFAULT_SUPERBRAIN_CANVAS_LAYOUT);
	const activeTabId = typeof source.activeTabId === "string" && tabs.some(tab => tab.id === source.activeTabId)
		? source.activeTabId : tabs[0].id;
	return { version: 1, activeTabId, tabs };
}

export function selectSuperbrainCanvasTab(layout: SuperbrainCanvasLayout, id: string): SuperbrainCanvasLayout {
	const next = copy(layout);
	if (next.tabs.some(tab => tab.id === id)) next.activeTabId = id;
	return next;
}

export function addSuperbrainCanvasTab(layout: SuperbrainCanvasLayout): SuperbrainCanvasLayout {
	const next = copy(layout);
	if (next.tabs.length >= MAX_TABS) return next;
	let number = 1;
	while (next.tabs.some(tab => tab.id === `custom-${number}`)) number++;
	const id = `custom-${number}`;
	next.tabs.push({ id, label: `新页签 ${number}`, cards: [] });
	next.activeTabId = id;
	return next;
}

export function renameSuperbrainCanvasTab(layout: SuperbrainCanvasLayout, id: string, label: string): SuperbrainCanvasLayout {
	const next = copy(layout);
	const tab = next.tabs.find(item => item.id === id);
	const cleaned = cleanLabel(label);
	if (tab && cleaned) tab.label = cleaned;
	return next;
}

export function removeSuperbrainCanvasTab(layout: SuperbrainCanvasLayout, id: string): SuperbrainCanvasLayout {
	const next = copy(layout);
	if (next.tabs.length <= 1) return next;
	next.tabs = next.tabs.filter(tab => tab.id !== id);
	if (!next.tabs.some(tab => tab.id === next.activeTabId)) next.activeTabId = next.tabs[0].id;
	return next;
}

export function moveSuperbrainCanvasTab(layout: SuperbrainCanvasLayout, id: string, step: -1 | 1): SuperbrainCanvasLayout {
	const next = copy(layout);
	const from = next.tabs.findIndex(tab => tab.id === id);
	const to = from + step;
	if (from >= 0 && to >= 0 && to < next.tabs.length) {
		[next.tabs[from], next.tabs[to]] = [next.tabs[to], next.tabs[from]];
	}
	return next;
}

export function addSuperbrainCanvasCard(layout: SuperbrainCanvasLayout, tabId: string, card: SuperbrainCanvasCard): SuperbrainCanvasLayout {
	const next = copy(layout);
	const tab = next.tabs.find(item => item.id === tabId);
	if (tab && CARD_SET.has(card) && !tab.cards.includes(card) && tab.cards.length < MAX_CARDS) tab.cards.push(card);
	return next;
}

export function removeSuperbrainCanvasCard(layout: SuperbrainCanvasLayout, tabId: string, card: SuperbrainCanvasCard): SuperbrainCanvasLayout {
	const next = copy(layout);
	const tab = next.tabs.find(item => item.id === tabId);
	if (tab) tab.cards = tab.cards.filter(item => item !== card);
	return next;
}

export function moveSuperbrainCanvasCard(layout: SuperbrainCanvasLayout, tabId: string, card: SuperbrainCanvasCard, step: -1 | 1): SuperbrainCanvasLayout {
	const next = copy(layout);
	const tab = next.tabs.find(item => item.id === tabId);
	if (!tab) return next;
	const from = tab.cards.indexOf(card);
	const to = from + step;
	if (from >= 0 && to >= 0 && to < tab.cards.length) {
		[tab.cards[from], tab.cards[to]] = [tab.cards[to], tab.cards[from]];
	}
	return next;
}

/** Move a known card to a drop position without touching another saved page. */
export function reorderSuperbrainCanvasCard(layout: SuperbrainCanvasLayout, tabId: string, card: SuperbrainCanvasCard, targetIndex: number): SuperbrainCanvasLayout {
 const next = copy(layout);
 const tab = next.tabs.find(item => item.id === tabId);
 if (!tab || !Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= tab.cards.length) return next;
 const from = tab.cards.indexOf(card);
 if (from < 0 || from === targetIndex) return next;
 tab.cards.splice(from, 1);
 tab.cards.splice(targetIndex, 0, card);
 return next;
}

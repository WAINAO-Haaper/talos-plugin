import {
	defaultRouteForPrimary,
	primaryPage,
	resolvePageRoute,
	type TalosPageRoute,
	type TalosPrimaryPageKey,
	type TalosSecondaryPageKey,
} from "./navigation-model";

type RouteSubscriber = (route: TalosPageRoute) => void;

export const TALOS_VIEW_STATE_SCHEMA_VERSION = 1 as const;

export interface TalosViewState {
	schemaVersion: typeof TALOS_VIEW_STATE_SCHEMA_VERSION;
	page: string;
}

function renderKeyForRoute(route: TalosPageRoute): string {
	if (route.secondary) return route.secondary;
	if (route.primary === "workbench") return "overview";
	if (route.primary === "voice") return "jarvis";
	return route.primary;
}

export function encodeTalosViewState(pageKey: string): TalosViewState {
	const route = resolvePageRoute(pageKey) ?? { primary: "workbench" };
	return {
		schemaVersion: TALOS_VIEW_STATE_SCHEMA_VERSION,
		page: renderKeyForRoute(route),
	};
}

export function decodeTalosViewState(state: unknown): string {
	if (!state || typeof state !== "object" || Array.isArray(state)) return "overview";
	const record = state as Record<string, unknown>;
	if (
		record.schemaVersion !== TALOS_VIEW_STATE_SCHEMA_VERSION
		|| typeof record.page !== "string"
	) {
		return "overview";
	}
	const route = resolvePageRoute(record.page);
	return route ? renderKeyForRoute(route) : "overview";
}

export class TalosPageRouter {
	private route: TalosPageRoute;
	private readonly subscribers = new Set<RouteSubscriber>();

	constructor(initialPageKey = "overview") {
		this.route = resolvePageRoute(initialPageKey) ?? { primary: "workbench" };
	}

	current(): TalosPageRoute {
		return { ...this.route };
	}

	navigate(pageKey: string): TalosPageRoute {
		const route = resolvePageRoute(pageKey);
		if (!route) throw new Error(`未知页面：${pageKey}`);
		return this.update(route);
	}

	selectPrimary(primary: TalosPrimaryPageKey): TalosPageRoute {
		return this.update(defaultRouteForPrimary(primary));
	}

	selectSecondary(secondary: TalosSecondaryPageKey): TalosPageRoute {
		const page = primaryPage(this.route.primary);
		if (!page.children.some((child) => child.key === secondary)) {
			throw new Error(`${secondary} 不属于 ${this.route.primary}`);
		}
		return this.update({ primary: this.route.primary, secondary });
	}

	renderKey(): string {
		return renderKeyForRoute(this.route);
	}

	subscribe(subscriber: RouteSubscriber): () => void {
		this.subscribers.add(subscriber);
		return () => this.subscribers.delete(subscriber);
	}

	private update(route: TalosPageRoute): TalosPageRoute {
		this.route = { ...route };
		for (const subscriber of this.subscribers) subscriber(this.current());
		return this.current();
	}
}

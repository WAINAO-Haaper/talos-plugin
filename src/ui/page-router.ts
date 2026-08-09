import {
	defaultRouteForPrimary,
	primaryPage,
	resolvePageRoute,
	type TalosPageRoute,
	type TalosPrimaryPageKey,
	type TalosSecondaryPageKey,
} from "./navigation-model";

type RouteSubscriber = (route: TalosPageRoute) => void;

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
		if (this.route.secondary) return this.route.secondary;
		if (this.route.primary === "workbench") return "overview";
		if (this.route.primary === "voice") return "jarvis";
		return this.route.primary;
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

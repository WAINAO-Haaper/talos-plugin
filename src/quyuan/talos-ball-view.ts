import { OrbRuntime } from "./talos-ball/runtime/orb-runtime";
import type {
	MotionPreference,
	OrbController,
	OrbOptions,
	OrbState,
	OrbThemeInput,
} from "./talos-ball/semantics/types";


export type TalosBallState =
	| "waiting"
	| "receiving"
	| "busy"
	| "thinking"
	| "searching"
	| "replying"
	| "done"
	| "error"
	| "restricted"
	| "stop";

export const TALOS_BALL_STATE_MAP: Readonly<Record<TalosBallState, OrbState>> = {
	waiting: "idle",
	receiving: "listening",
	busy: "receiving",
	thinking: "thinking",
	searching: "searching",
	replying: "responding",
	done: "success",
	error: "error",
	restricted: "restricted",
	stop: "stopped",
};

const STATE_LABELS: Readonly<Record<TalosBallState, string>> = {
	waiting: "等待输入",
	receiving: "正在收音",
	busy: "正在转写",
	thinking: "正在思考",
	searching: "正在检索",
	replying: "正在播报",
	done: "已完成",
	error: "出现错误",
	restricted: "能力受限",
	stop: "已停止",
};

export interface TalosBallTheme {
	id: string;
	mode: OrbThemeInput;
}

export type TalosBallController = Pick<
	OrbController,
	"setState" | "setActive" | "renderStatic" | "setTheme" | "destroy"
>;

export type TalosBallFactory = (
	host: HTMLElement,
	options: OrbOptions
) => TalosBallController;

let runtimeInstanceCount = 0;

const defaultFactory: TalosBallFactory = (host, options) => {
	const element = host.ownerDocument.createElement("div");
	element.className = "tq-talos-ball-runtime";
	const rawSize = options.size ?? "100%";
	const size = typeof rawSize === "number" ? rawSize + "px" : rawSize;
	element.style.setProperty("--talos-orb-size", size);
	host.appendChild(element);
	const shadowRoot = element.attachShadow({ mode: "open" });
	const runtime = new OrbRuntime(element, shadowRoot, {
		state: options.state ?? "idle",
		active: options.active ?? true,
		motion: options.motion ?? "system",
		theme: options.theme ?? "light",
		ariaLabel: options.ariaLabel,
		seed: options.seed ?? 0x54414c4f,
		idPrefix: "talos-ball-instance-" + ++runtimeInstanceCount,
	});
	return {
		setState: (state) => runtime.setState(state),
		setActive: (active) => runtime.setActive(active),
		renderStatic: () => runtime.renderStatic(),
		setTheme: (theme) => runtime.setTheme(theme),
		destroy: () => {
			runtime.destroy();
			element.remove();
		},
	};
};

/**
 * Presentation-only adapter around the TALOS-owned orb runtime.
 * It consumes normalized voice state and never receives provider, permission,
 * approval, credential, Vault content, or tool-execution capabilities.
 */
export class TalosBallView {
	private host: HTMLElement | null = null;
	private engineHost: HTMLElement | null = null;
	private fallbackCopy: HTMLElement | null = null;
	private engine: TalosBallController | null = null;
	private state: TalosBallState = "waiting";
	private theme: TalosBallTheme = { id: "aurora:dark", mode: "dark" };
	private mediaQuery: MediaQueryList | null = null;
	private reducedMotion = false;
	private readonly motionListener = (event: MediaQueryListEvent): void => {
		this.reducedMotion = event.matches;
		this.applyMotionPreference();
	};

	constructor(private readonly factory: TalosBallFactory = defaultFactory) {}

	mount(host: HTMLElement, theme: TalosBallTheme): void {
		this.destroy();
		this.host = host;
		this.theme = theme;
		host.replaceChildren();
		host.classList.add("tq-talos-ball");
		host.setAttribute("data-talos-ball-state", this.state);

		const document = host.ownerDocument;
		this.engineHost = document.createElement("div");
		this.engineHost.className = "tq-talos-ball__engine";
		this.engineHost.setAttribute("aria-hidden", "true");
		host.appendChild(this.engineHost);

		const fallback = document.createElement("div");
		fallback.className = "tq-talos-ball__fallback";
		fallback.setAttribute("role", "img");
		fallback.setAttribute("aria-label", "TALOS Ball 静态降级");
		const eyes = document.createElement("span");
		eyes.className = "tq-talos-ball__fallback-eyes";
		eyes.setAttribute("aria-hidden", "true");
		fallback.appendChild(eyes);
		this.fallbackCopy = document.createElement("span");
		this.fallbackCopy.className = "tq-talos-ball__fallback-copy";
		fallback.appendChild(this.fallbackCopy);
		host.appendChild(fallback);

		this.mediaQuery = document.defaultView?.matchMedia?.(
			"(prefers-reduced-motion: reduce)"
		) ?? null;
		this.reducedMotion = this.mediaQuery?.matches ?? false;
		this.mediaQuery?.addEventListener("change", this.motionListener);
		this.applyTheme();
		this.createEngine();
	}

	updateState(state: TalosBallState): void {
		this.state = state;
		this.host?.setAttribute("data-talos-ball-state", state);
		this.updateFallbackCopy();
		if (!this.engine) return;
		try {
			this.engine.setState(TALOS_BALL_STATE_MAP[state]);
			this.setFallback(false);
			if (this.reducedMotion) this.engine.renderStatic();
		} catch (error) {
			console.error("TALOS Ball state update failed", error);
			this.setFallback(true);
		}
	}

	updateTheme(theme: TalosBallTheme): void {
		this.theme = theme;
		this.applyTheme();
	}

	destroy(): void {
		this.mediaQuery?.removeEventListener("change", this.motionListener);
		this.mediaQuery = null;
		try {
			this.engine?.destroy();
		} catch (error) {
			console.error("TALOS Ball destroy failed", error);
		}
		this.engine = null;
		if (this.host) {
			this.host.replaceChildren();
			this.host.classList.remove("tq-talos-ball");
			this.host.removeAttribute("data-talos-ball-state");
			this.host.removeAttribute("data-talos-ball-theme");
			this.host.removeAttribute("data-talos-ball-fallback");
			this.host.removeAttribute("data-talos-ball-motion");
		}
		this.host = null;
		this.engineHost = null;
		this.fallbackCopy = null;
	}

	private createEngine(): void {
		if (!this.engineHost) return;
		this.engineHost.replaceChildren();
		try {
			const motion: MotionPreference = this.reducedMotion
				? "reduced"
				: "system";
			this.engine = this.factory(this.engineHost, {
				state: TALOS_BALL_STATE_MAP[this.state],
				size: "100%",
				active: !this.reducedMotion,
				motion,
				theme: this.theme.mode,
				ariaLabel: "TALOS Ball · " + STATE_LABELS[this.state],
				seed: 0x54414c4f,
			});
			this.setFallback(false);
			this.applyTheme();
			this.applyMotionPreference();
		} catch (error) {
			console.error("TALOS Ball failed to mount", error);
			this.engine = null;
			this.setFallback(true);
		}
	}

	private applyTheme(): void {
		this.host?.setAttribute("data-talos-ball-theme", this.theme.id);
		try {
			this.engine?.setTheme(this.theme.mode);
			if (this.reducedMotion) this.engine?.renderStatic();
		} catch (error) {
			console.error("TALOS Ball theme update failed", error);
			this.setFallback(true);
		}
	}

	private applyMotionPreference(): void {
		if (!this.engine) return;
		try {
			this.engine.setActive(!this.reducedMotion);
			if (this.reducedMotion) this.engine.renderStatic();
			this.host?.setAttribute(
				"data-talos-ball-motion",
				this.reducedMotion ? "reduced" : "full"
			);
		} catch (error) {
			console.error("TALOS Ball motion update failed", error);
			this.setFallback(true);
		}
	}

	private setFallback(fallback: boolean): void {
		this.host?.setAttribute("data-talos-ball-fallback", String(fallback));
		this.updateFallbackCopy();
	}

	private updateFallbackCopy(): void {
		if (this.fallbackCopy) {
			this.fallbackCopy.textContent =
				"静态状态 · " + STATE_LABELS[this.state];
		}
	}
}

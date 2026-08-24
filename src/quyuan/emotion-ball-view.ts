export const EMOTION_BALL_STATE_IDS = {
	waiting: "35",
	receiving: "31",
	busy: "32",
	thinking: "30",
	searching: "40",
	replying: "39",
	done: "33",
	error: "34",
	restricted: "38",
	stop: "41",
} as const;

export type EmotionBallState = keyof typeof EMOTION_BALL_STATE_IDS;

const STATE_LABELS: Record<EmotionBallState, string> = {
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

export interface EmotionBallTheme {
	id: string;
	sketch: boolean;
}

export interface EmotionBallEngineOptions {
	emotion: string;
	shape: "blob";
	idle: false;
	autostart: boolean;
	lite: boolean;
	fallbackId: string;
	color: "#FFFFFF";
	eyeColor: "#1A1A1A";
}

export interface EmotionBallEngine {
	setEmotion(id: string): boolean;
	setStyle?(style: { sketch: number }): void;
	setActive?(active: boolean): void;
	renderStatic?(): void;
	destroy(): void;
}

export type EmotionBallFactory = (
	host: HTMLElement,
	options: EmotionBallEngineOptions
) => EmotionBallEngine;

/**
 * Local presentation-only adapter around the pinned Emotion Ball runtime.
 * It consumes normalized view state and never receives provider, permission,
 * approval, credential, or tool-execution capabilities.
 */
export class EmotionBallView {
	private host: HTMLElement | null = null;
	private engineHost: HTMLElement | null = null;
	private fallbackCopy: HTMLElement | null = null;
	private engine: EmotionBallEngine | null = null;
	private state: EmotionBallState = "waiting";
	private theme: EmotionBallTheme = { id: "default", sketch: false };
	private mediaQuery: MediaQueryList | null = null;
	private reducedMotion = false;
	private readonly motionListener = (event: MediaQueryListEvent): void => {
		this.reducedMotion = event.matches;
		this.applyMotionPreference();
	};

	constructor(private readonly factory: EmotionBallFactory) {}

	mount(host: HTMLElement, theme: EmotionBallTheme): void {
		this.destroy();
		this.host = host;
		this.theme = theme;
		host.replaceChildren();
		host.classList.add("tq-emotion-ball");
		host.setAttribute("data-emotion-ball-state", this.state);

		const document = host.ownerDocument;
		this.engineHost = document.createElement("div");
		this.engineHost.className = "tq-emotion-ball__engine";
		this.engineHost.setAttribute("aria-hidden", "true");
		host.appendChild(this.engineHost);

		const fallback = document.createElement("div");
		fallback.className = "tq-emotion-ball__fallback";
		fallback.setAttribute("role", "img");
		fallback.setAttribute("aria-label", "Emotion Ball 静态降级");
		const eyes = document.createElement("span");
		eyes.className = "tq-emotion-ball__fallback-eyes";
		eyes.setAttribute("aria-hidden", "true");
		fallback.appendChild(eyes);
		this.fallbackCopy = document.createElement("span");
		this.fallbackCopy.className = "tq-emotion-ball__fallback-copy";
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

	updateState(state: EmotionBallState): void {
		this.state = state;
		this.host?.setAttribute("data-emotion-ball-state", state);
		this.updateFallbackCopy();
		if (!this.engine) return;
		try {
			const accepted = this.engine.setEmotion(EMOTION_BALL_STATE_IDS[state]);
			if (!accepted) {
				this.setFallback(true);
				return;
			}
			this.setFallback(false);
			if (this.reducedMotion) this.engine.renderStatic?.();
		} catch (error) {
			console.error("TALOS Emotion Ball state update failed", error);
			this.setFallback(true);
		}
	}

	updateTheme(theme: EmotionBallTheme): void {
		this.theme = theme;
		this.applyTheme();
	}

	destroy(): void {
		this.mediaQuery?.removeEventListener("change", this.motionListener);
		this.mediaQuery = null;
		try {
			this.engine?.destroy();
		} catch (error) {
			console.error("TALOS Emotion Ball destroy failed", error);
		}
		this.engine = null;
		if (this.host) {
			this.host.replaceChildren();
			this.host.classList.remove("tq-emotion-ball");
			this.host.removeAttribute("data-emotion-ball-state");
			this.host.removeAttribute("data-emotion-ball-theme");
			this.host.removeAttribute("data-emotion-ball-fallback");
			this.host.removeAttribute("data-emotion-ball-motion");
		}
		this.host = null;
		this.engineHost = null;
		this.fallbackCopy = null;
	}

	private createEngine(): void {
		if (!this.engineHost) return;
		this.engineHost.replaceChildren();
		try {
			this.engine = this.factory(this.engineHost, {
				emotion: EMOTION_BALL_STATE_IDS[this.state],
				shape: "blob",
				idle: false,
				autostart: !this.reducedMotion,
				lite: this.reducedMotion,
				fallbackId: EMOTION_BALL_STATE_IDS.waiting,
				color: "#FFFFFF",
				eyeColor: "#1A1A1A",
			});
			this.setFallback(false);
			this.applyTheme();
			this.applyMotionPreference();
		} catch (error) {
			console.error("TALOS Emotion Ball failed to mount", error);
			this.engine = null;
			this.setFallback(true);
		}
	}

	private applyTheme(): void {
		this.host?.setAttribute("data-emotion-ball-theme", this.theme.id);
		try {
			this.engine?.setStyle?.({ sketch: this.theme.sketch ? 1 : 0 });
			if (this.reducedMotion) this.engine?.renderStatic?.();
		} catch (error) {
			console.error("TALOS Emotion Ball theme update failed", error);
			this.setFallback(true);
		}
	}

	private applyMotionPreference(): void {
		if (!this.engine) return;
		try {
			this.engine.setActive?.(!this.reducedMotion);
			if (this.reducedMotion) this.engine.renderStatic?.();
			this.host?.setAttribute(
				"data-emotion-ball-motion",
				this.reducedMotion ? "reduced" : "full"
			);
		} catch (error) {
			console.error("TALOS Emotion Ball motion update failed", error);
			this.setFallback(true);
		}
	}

	private setFallback(fallback: boolean): void {
		this.host?.setAttribute("data-emotion-ball-fallback", String(fallback));
		this.updateFallbackCopy();
	}

	private updateFallbackCopy(): void {
		if (this.fallbackCopy) {
			this.fallbackCopy.textContent = `静态状态 · ${STATE_LABELS[this.state]}`;
		}
	}
}

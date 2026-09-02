import { BlinkTimeline } from "../kinetics/blink";
import { sampleMotion } from "../kinetics/motion";
import { MOTION_TIMINGS, transitionDuration } from "../kinetics/timings";
import {
  createReducedMotionQuery,
  effectiveMotion,
  type EffectiveMotion
} from "../platform/motion-preference";
import { TransitionEngine } from "../orchestration/transition-engine";
import { STATE_DESCRIPTIONS } from "../semantics/descriptions";
import type {
  GazePoint,
  MotionPreference,
  OrbActivityDetail,
  OrbEventMap,
  OrbEventName,
  OrbState,
  OrbThemeInput
} from "../semantics/types";
import { SvgScene } from "../scene/svg-scene";
import { sharedFrameScheduler } from "./shared-scheduler";

export const TALOS_ORB_EVENT_PREFIX = "talos-";

export interface RuntimeOptions {
  state: OrbState;
  active: boolean;
  motion: MotionPreference;
  theme: OrbThemeInput;
  ariaLabel: string | undefined;
  seed: number;
  idPrefix: string;
}

interface ActiveWindow extends Window {
  readonly IntersectionObserver?: typeof IntersectionObserver;
  readonly CustomEvent: typeof CustomEvent;
}

interface GazeTransition {
  from: GazePoint;
  to: GazePoint;
  startedAt: number;
  duration: number;
}

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
}

function smoothStep(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

export class OrbRuntime {
  readonly #host: HTMLElement;
  readonly #activeDocument: Document;
  readonly #activeWindow: ActiveWindow;
  readonly #scene: SvgScene;
  readonly #transition: TransitionEngine;
  readonly #blink: BlinkTimeline;
  readonly #mediaQuery: MediaQueryList | null;
  readonly #onFrameBound: (timestamp: number) => void;
  readonly #onVisibilityBound: () => void;
  readonly #onMotionBound: () => void;
  readonly #onKeyDownBound: (event: KeyboardEvent) => void;
  #observer: IntersectionObserver | null = null;
  #unsubscribeFrame: (() => void) | null = null;
  #state: OrbState;
  #requestedActive: boolean;
  #manualPaused = false;
  #pageVisible = true;
  #inViewport = true;
  #destroyed = false;
  #motionPreference: MotionPreference;
  #logicalTime = 0;
  #stateStartedAt = 0;
  #lastTimestamp: number | null = null;
  #gaze: GazePoint = { x: 0, y: 0 };
  #gazeTransition: GazeTransition | null = null;
  #settledEmitted = true;
  #customAriaLabel: string | undefined;
  #lastActivityKey = "";

  constructor(host: HTMLElement, shadowRoot: ShadowRoot, options: RuntimeOptions) {
    this.#host = host;
    this.#activeDocument = host.ownerDocument;
    const activeWindow = host.ownerDocument.defaultView as ActiveWindow | null;
    if (!activeWindow) throw new Error("TALOS Ball requires an active window");
    this.#activeWindow = activeWindow;
    this.#state = options.state;
    this.#requestedActive = options.active;
    this.#motionPreference = options.motion;
    this.#customAriaLabel = options.ariaLabel;
    this.#transition = new TransitionEngine(options.state);
    this.#blink = new BlinkTimeline(options.seed);
    this.#scene = new SvgScene(
      shadowRoot,
      options.state,
      options.theme,
      options.idPrefix
    );
    this.#mediaQuery = createReducedMotionQuery(this.#activeWindow);
    this.#pageVisible = this.#activeDocument.visibilityState !== "hidden";
    this.#onFrameBound = (timestamp) => this.#onFrame(timestamp);
    this.#onVisibilityBound = () => this.#onVisibilityChange();
    this.#onMotionBound = () => this.#onMotionPreferenceChange();
    this.#onKeyDownBound = (event) => this.#onKeyDown(event);

    this.#host.setAttribute("role", "img");
    this.#host.setAttribute("aria-live", "polite");
    if (!this.#host.hasAttribute("tabindex")) {
      this.#host.setAttribute("tabindex", "0");
    }
    this.#updateAria();
    this.#host.addEventListener("keydown", this.#onKeyDownBound);
    this.#activeDocument.addEventListener(
      "visibilitychange",
      this.#onVisibilityBound
    );
    this.#mediaQuery?.addEventListener("change", this.#onMotionBound);
    const Observer = this.#activeWindow.IntersectionObserver;
    if (typeof Observer === "function") {
      const observer = new Observer(
        (entries) => {
          const entry = entries[entries.length - 1];
          if (!entry) return;
          const visible = entry.isIntersecting && entry.intersectionRatio > 0;
          if (visible === this.#inViewport) return;
          this.#inViewport = visible;
          this.#emit("visibilitychange", { visible });
          this.#lastTimestamp = null;
          this.#updateScheduling();
        },
        { threshold: 0.01 }
      );
      this.#observer = observer;
      observer.observe(host);
    }

    this.#applyFrame();
    this.#updateScheduling();
  }

  get state(): OrbState {
    return this.#state;
  }

  get active(): boolean {
    return this.#requestedActive && !this.#manualPaused;
  }

  setState(state: OrbState): void {
    if (this.#destroyed || state === this.#state) return;
    const previous = this.#state;
    const motion = this.#effectiveMotion();
    this.#state = state;
    this.#stateStartedAt = this.#logicalTime;
    this.#scene.state = state;
    this.#transition.retarget(
      state,
      this.#logicalTime,
      transitionDuration(state, motion)
    );
    this.#settledEmitted = this.#transition.settled;
    this.#blink.reset(this.#logicalTime);
    this.#updateAria();
    this.#emit("statechange", { previous, current: state });
    if (this.#transition.settled) {
      this.#emit("settled", { state });
    }
    this.#applyFrame();
    this.#updateScheduling();
  }

  setGaze(x: number, y: number): void {
    if (this.#destroyed) return;
    const motion = this.#effectiveMotion();
    const current = this.#sampleGaze();
    const duration =
      motion === "none"
        ? 0
        : motion === "reduced"
          ? MOTION_TIMINGS.reducedMaximum
          : MOTION_TIMINGS.gazeSettle;
    this.#gazeTransition = {
      from: current,
      to: { x: clampUnit(x), y: clampUnit(y) },
      startedAt: this.#logicalTime,
      duration
    };
    if (duration === 0) {
      this.#gaze = { ...this.#gazeTransition.to };
      this.#gazeTransition = null;
    }
    this.#applyFrame();
    this.#updateScheduling();
  }

  setActive(active: boolean): void {
    if (this.#destroyed || this.#requestedActive === active) return;
    this.#requestedActive = active;
    this.#lastTimestamp = null;
    this.#updateScheduling();
  }

  pause(): void {
    if (this.#destroyed || this.#manualPaused) return;
    this.#manualPaused = true;
    this.#lastTimestamp = null;
    this.#updateScheduling();
  }

  resume(): void {
    if (this.#destroyed || !this.#manualPaused) return;
    this.#manualPaused = false;
    this.#lastTimestamp = null;
    this.#updateScheduling();
  }

  setMotion(preference: MotionPreference): void {
    if (this.#destroyed || preference === this.#motionPreference) return;
    this.#motionPreference = preference;
    this.#lastTimestamp = null;
    this.#applyFrame();
    this.#updateScheduling();
  }

  setTheme(theme: OrbThemeInput): void {
    if (this.#destroyed) return;
    this.#scene.setTheme(theme);
  }

  setAriaLabel(label?: string): void {
    this.#customAriaLabel = label;
    this.#updateAria();
  }

  renderStatic(): string {
    return this.#scene.renderStatic();
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#unsubscribe();
    this.#observer?.disconnect();
    this.#observer = null;
    this.#activeDocument.removeEventListener(
      "visibilitychange",
      this.#onVisibilityBound
    );
    this.#mediaQuery?.removeEventListener("change", this.#onMotionBound);
    this.#host.removeEventListener("keydown", this.#onKeyDownBound);
    this.#scene.destroy();
  }

  #effectiveMotion(): EffectiveMotion {
    return effectiveMotion(this.#motionPreference, this.#mediaQuery);
  }

  #sampleGaze(): GazePoint {
    const transition = this.#gazeTransition;
    if (!transition) return { ...this.#gaze };
    if (transition.duration === 0) {
      this.#gaze = { ...transition.to };
      this.#gazeTransition = null;
      return { ...this.#gaze };
    }
    const progress =
      (this.#logicalTime - transition.startedAt) / transition.duration;
    if (progress >= 1) {
      this.#gaze = { ...transition.to };
      this.#gazeTransition = null;
      return { ...this.#gaze };
    }
    const amount = smoothStep(progress);
    return {
      x: transition.from.x + (transition.to.x - transition.from.x) * amount,
      y: transition.from.y + (transition.to.y - transition.from.y) * amount
    };
  }

  #applyFrame(): void {
    const motionMode = this.#effectiveMotion();
    const stateElapsed = Math.max(0, this.#logicalTime - this.#stateStartedAt);
    const vector = this.#transition.sample(this.#logicalTime);
    const motion = sampleMotion(
      this.#state,
      stateElapsed,
      motionMode !== "full"
    );
    const gaze = this.#sampleGaze();
    const blink =
      motionMode === "full" &&
      this.#state !== "restricted" &&
      this.#state !== "stopped" &&
      this.#state !== "error"
        ? this.#blink.sample(this.#logicalTime)
        : 0;
    this.#scene.apply(vector, motion, gaze, blink);

    if (this.#transition.settled && !this.#settledEmitted) {
      this.#settledEmitted = true;
      this.#emit("settled", { state: this.#state });
    }
  }

  #onFrame(timestamp: number): void {
    if (this.#destroyed || !this.#shouldRun()) {
      this.#updateScheduling();
      return;
    }
    if (this.#lastTimestamp === null) {
      this.#lastTimestamp = timestamp;
    } else {
      const delta = Math.max(0, Math.min(50, timestamp - this.#lastTimestamp));
      this.#logicalTime += delta;
      this.#lastTimestamp = timestamp;
    }
    this.#applyFrame();
    this.#updateScheduling();
  }

  #hasTransientMotion(): boolean {
    if (!this.#transition.settled || this.#gazeTransition !== null) return true;
    const elapsed = this.#logicalTime - this.#stateStartedAt;
    return (
      (this.#state === "success" &&
        elapsed < MOTION_TIMINGS.successGesture) ||
      (this.#state === "error" &&
        elapsed <
          MOTION_TIMINGS.errorImbalance + MOTION_TIMINGS.errorRecovery)
    );
  }

  #hasAmbientMotion(): boolean {
    if (this.#effectiveMotion() !== "full") return false;
    return !["success", "error", "restricted", "stopped"].includes(this.#state);
  }

  #shouldRun(): boolean {
    return (
      !this.#destroyed &&
      this.#requestedActive &&
      !this.#manualPaused &&
      this.#pageVisible &&
      this.#inViewport &&
      (this.#hasTransientMotion() || this.#hasAmbientMotion())
    );
  }

  #updateScheduling(): void {
    const shouldRun = this.#shouldRun();
    if (shouldRun && this.#unsubscribeFrame === null) {
      this.#unsubscribeFrame = sharedFrameScheduler.subscribe(this.#onFrameBound, this.#activeWindow);
    } else if (!shouldRun) {
      this.#unsubscribe();
      this.#lastTimestamp = null;
    }

    const detail = this.#activityDetail();
    const key = `${detail.active}:${detail.reason}`;
    if (key !== this.#lastActivityKey) {
      this.#lastActivityKey = key;
      this.#emit("activitychange", detail);
    }
  }

  #unsubscribe(): void {
    this.#unsubscribeFrame?.();
    this.#unsubscribeFrame = null;
  }

  #activityDetail(): OrbActivityDetail {
    if (!this.#requestedActive) return { active: false, reason: "api" };
    if (this.#manualPaused) return { active: false, reason: "paused" };
    if (!this.#pageVisible) return { active: false, reason: "page-hidden" };
    if (!this.#inViewport) return { active: false, reason: "offscreen" };
    if (this.#state === "stopped" && !this.#hasTransientMotion()) {
      return { active: false, reason: "stopped" };
    }
    return { active: true, reason: "api" };
  }

  #onVisibilityChange(): void {
    this.#pageVisible = this.#activeDocument.visibilityState !== "hidden";
    this.#lastTimestamp = null;
    this.#updateScheduling();
  }

  #onMotionPreferenceChange(): void {
    if (this.#motionPreference !== "system") return;
    this.#lastTimestamp = null;
    this.#applyFrame();
    this.#updateScheduling();
  }

  #onKeyDown(event: KeyboardEvent): void {
    const step = event.shiftKey ? 0.5 : 0.25;
    const current = this.#sampleGaze();
    if (event.key === "ArrowLeft") this.setGaze(current.x - step, current.y);
    else if (event.key === "ArrowRight") this.setGaze(current.x + step, current.y);
    else if (event.key === "ArrowUp") this.setGaze(current.x, current.y - step);
    else if (event.key === "ArrowDown") this.setGaze(current.x, current.y + step);
    else if (event.key === "Home") this.setGaze(0, 0);
    else return;
    event.preventDefault();
  }

  #updateAria(): void {
    this.#host.setAttribute(
      "aria-label",
      this.#customAriaLabel ?? STATE_DESCRIPTIONS[this.#state].label
    );
  }

  #emit<K extends OrbEventName>(name: K, detail: OrbEventMap[K]): void {
    this.#host.dispatchEvent(
      new this.#activeWindow.CustomEvent(`${TALOS_ORB_EVENT_PREFIX}${name}`, {
        detail,
        bubbles: true,
        composed: true
      })
    );
  }
}

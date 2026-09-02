import {
  emotionIdForState,
  type TalosBallState,
} from "./state-contract";
import { createTalosBallRuntime } from "./runtime";
import type {
  TalosBallEngine,
  TalosBallEngineOptions,
  TalosBallEvent,
  TalosBallListener,
} from "./talos-ball-runtime-types";

export interface TalosBallOptions
  extends Omit<TalosBallEngineOptions, "emotion"> {
  state?: TalosBallState;
  emotion?: string;
}

export interface TalosBallTheme {
  bodyColor?: string;
  eyeColor?: string;
  sketch?: boolean;
}

export class TalosBall {
  private engine: TalosBallEngine;
  private readonly listeners = new Map<
    TalosBallEvent,
    Set<TalosBallListener>
  >();
  private options: TalosBallOptions;
  private currentEmotion: string;
  private active: boolean;
  private sketch = false;
  private destroyed = false;

  constructor(
    private readonly host: HTMLElement,
    options: TalosBallOptions = {}
  ) {
    this.options = { ...options };
    this.currentEmotion =
      options.emotion ??
      emotionIdForState(options.state ?? "idle");
    this.active = options.autostart !== false;
    this.engine = this.createEngine();
  }

  get emotionId(): string | null {
    return this.engine.emotionId;
  }

  setState(state: TalosBallState): boolean {
    return this.setEmotion(emotionIdForState(state));
  }

  setEmotion(emotionId: string): boolean {
    this.assertAlive();
    const accepted = this.engine.setEmotion(emotionId);
    if (accepted) this.currentEmotion = emotionId;
    return accepted;
  }

  handleAIMessage(message: string | { emotionId: string; tips?: string }): boolean {
    this.assertAlive();
    const accepted = this.engine.handleAIMessage(message);
    if (accepted) this.currentEmotion = this.engine.emotionId ?? this.currentEmotion;
    return accepted;
  }

  setGaze(x: number, y: number): this {
    this.assertAlive();
    this.engine.setGaze(x, y);
    return this;
  }

  clearGaze(): this {
    this.assertAlive();
    this.engine.clearGaze();
    return this;
  }

  setActive(active: boolean): this {
    this.assertAlive();
    this.active = active;
    this.engine.setActive(active);
    return this;
  }

  pause(): this {
    return this.setActive(false);
  }

  resume(): this {
    return this.setActive(true);
  }

  renderStatic(): this {
    this.assertAlive();
    this.engine.renderStatic();
    return this;
  }

  replay(): this {
    this.assertAlive();
    this.engine.replay();
    return this;
  }

  spin(turns = 1, direction?: -1 | 1): this {
    this.assertAlive();
    this.engine.spin(turns, direction);
    return this;
  }

  bounce(): this {
    this.assertAlive();
    this.engine.bounce();
    return this;
  }

  burst(count = 20): this {
    this.assertAlive();
    this.engine.burst(count);
    return this;
  }

  startTour(ids: string[], interval?: number): this {
    this.assertAlive();
    this.engine.startTour(ids, interval);
    return this;
  }

  stopTour(): this {
    this.assertAlive();
    this.engine.stopTour();
    return this;
  }

  setTheme(theme: TalosBallTheme): this {
    this.assertAlive();
    const colorChanged =
      (theme.bodyColor !== undefined && theme.bodyColor !== this.options.color) ||
      (theme.eyeColor !== undefined && theme.eyeColor !== this.options.eyeColor);
    if (theme.bodyColor !== undefined) this.options.color = theme.bodyColor;
    if (theme.eyeColor !== undefined) this.options.eyeColor = theme.eyeColor;
    if (theme.sketch !== undefined) this.sketch = theme.sketch;

    if (colorChanged) this.rebuild();
    this.engine.setStyle({ sketch: this.sketch ? 1 : 0 });
    if (!this.active) this.engine.renderStatic();
    return this;
  }

  on(event: TalosBallEvent, listener: TalosBallListener): () => void {
    this.assertAlive();
    const bucket = this.listeners.get(event) ?? new Set<TalosBallListener>();
    bucket.add(listener);
    this.listeners.set(event, bucket);
    this.engine.on(event, listener);
    return () => this.off(event, listener);
  }

  off(event: TalosBallEvent, listener: TalosBallListener): this {
    this.listeners.get(event)?.delete(listener);
    if (!this.destroyed) this.engine.off(event, listener);
    return this;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.engine.destroy();
    this.listeners.clear();
    this.host.replaceChildren();
  }

  private createEngine(): TalosBallEngine {
    const upstream = { ...this.options };
    delete upstream.state;
    delete upstream.emotion;
    const engine = createTalosBallRuntime(this.host, {
      ...upstream,
      emotion: this.currentEmotion,
      autostart: this.active,
    });
    if (this.sketch) engine.setStyle({ sketch: 1 });
    for (const [event, listeners] of this.listeners) {
      for (const listener of listeners) engine.on(event, listener);
    }
    return engine;
  }

  private rebuild(): void {
    this.engine.destroy();
    this.host.replaceChildren();
    this.engine = this.createEngine();
    if (!this.active) this.engine.renderStatic();
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("TalosBall instance has been destroyed");
    }
  }
}

export function createTalosBall(
  container: HTMLElement,
  options: TalosBallOptions = {}
): TalosBall {
  return new TalosBall(container, options);
}

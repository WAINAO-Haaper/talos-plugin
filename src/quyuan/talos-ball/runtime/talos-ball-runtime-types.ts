export type TalosBallShape = "blob" | "wedge" | "gem";

export interface TalosBallIdleOptions {
  standbyAfter?: number;
  sleepAfter?: number;
  standbyId?: string;
  sleepId?: string;
}

export interface TalosBallEngineOptions {
  emotion?: string;
  shape?: TalosBallShape;
  idle?: boolean | TalosBallIdleOptions;
  autostart?: boolean;
  lite?: boolean;
  fallbackId?: string;
  color?: string;
  eyeColor?: string;
  eyeScale?: number;
  label?: string;
}

export type TalosBallEvent = "change" | "tips" | "error";
export type TalosBallListener = (payload: unknown) => void;

export interface TalosBallRegistrationResult {
  ok: boolean;
  id?: string;
  errors?: string[];
}

export interface TalosBallDefinition {
  id: string;
  name: string;
  group: string;
  desc: string;
  en: { name: string; desc: string } | null;
  raw: Record<string, unknown>;
}

export interface TalosBallEngine {
  readonly emotionId: string | null;
  readonly touring: boolean;
  setEmotion(id: string, options?: { auto?: boolean }): boolean;
  handleAIMessage(message: string | { emotionId: string; tips?: string }): boolean;
  on(event: TalosBallEvent, listener: TalosBallListener): this;
  off(event: TalosBallEvent, listener: TalosBallListener): this;
  startTour(ids: string[], interval?: number): void;
  stopTour(): void;
  resetIdle(): void;
  setGaze(x: number, y: number): this;
  clearGaze(): this;
  setStyle(style: { sketch?: number }): this;
  spin(turns?: number, direction?: -1 | 1): this;
  burst(count?: number): this;
  bounce(): this;
  registerEmotion(config: Record<string, unknown>): TalosBallRegistrationResult;
  setActive(active: boolean): void;
  replay(): void;
  renderStatic(): void;
  destroy(): void;
}

export interface TalosBallConfigRegistry {
  get(id: string): TalosBallDefinition | null;
  list(group?: string): TalosBallDefinition[];
  groups(): Array<{ key: string; name: string; en: string }>;
  exportConfig(): string;
  importConfig(input: unknown): {
    ok: boolean;
    added: number;
    errors: string[];
  };
}

export interface TalosBallRuntimeNamespace {
  version: string;
  config: TalosBallConfigRegistry;
  create(host: HTMLElement, options?: TalosBallEngineOptions): TalosBallEngine;
}

declare global {
  interface Window {
    TalosBallRuntime?: TalosBallRuntimeNamespace;
  }
}

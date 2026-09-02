export const ORB_STATES = [
  "idle",
  "listening",
  "receiving",
  "working",
  "thinking",
  "searching",
  "responding",
  "success",
  "warning",
  "error",
  "restricted",
  "stopped"
] as const;

export type OrbState = (typeof ORB_STATES)[number];
export type MotionPreference = "system" | "full" | "reduced" | "none";
export type OrbThemeName = "light" | "dark";

export interface GazePoint {
  x: number;
  y: number;
}

export interface OrbTheme {
  name: string;
  background: string;
  surface: string;
  ink: string;
  cloudBlue: string;
  signalYellow: string;
}

export type OrbThemeInput = OrbThemeName;

export interface OrbOptions {
  state?: OrbState;
  size?: number | string;
  active?: boolean;
  gaze?: Partial<GazePoint>;
  motion?: MotionPreference;
  theme?: OrbThemeInput;
  ariaLabel?: string;
  seed?: number;
}

export interface StaticOrbOptions {
  state?: OrbState;
  theme?: OrbThemeInput;
  title?: string;
  size?: number;
  idPrefix?: string;
}

export type OrbEventName =
  | "statechange"
  | "settled"
  | "activitychange"
  | "visibilitychange";

export interface OrbStateChangeDetail {
  previous: OrbState;
  current: OrbState;
}

export interface OrbSettledDetail {
  state: OrbState;
}

export interface OrbActivityDetail {
  active: boolean;
  reason: "api" | "paused" | "page-hidden" | "offscreen" | "stopped";
}

export interface OrbVisibilityDetail {
  visible: boolean;
}

export interface OrbEventMap {
  statechange: OrbStateChangeDetail;
  settled: OrbSettledDetail;
  activitychange: OrbActivityDetail;
  visibilitychange: OrbVisibilityDetail;
}

export type OrbEventCallback<K extends OrbEventName> = (
  detail: Readonly<OrbEventMap[K]>
) => void;

export interface OrbController {
  readonly state: OrbState;
  readonly active: boolean;
  setState(state: OrbState): void;
  setGaze(x: number, y: number): void;
  setActive(active: boolean): void;
  pause(): void;
  resume(): void;
  renderStatic(): string;
  setTheme(theme: OrbThemeInput): void;
  subscribe<K extends OrbEventName>(
    event: K,
    callback: OrbEventCallback<K>
  ): () => void;
  destroy(): void;
}

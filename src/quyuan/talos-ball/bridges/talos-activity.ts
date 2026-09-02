import type { OrbState } from "../semantics/types";

export const TALOS_ACTIVITY_SIGNALS = [
  "ready",
  "attending",
  "ingesting",
  "executing",
  "deliberating",
  "exploring",
  "delivering",
  "complete",
  "attention",
  "failed",
  "denied",
  "halted"
] as const;

export type TalosActivitySignal = (typeof TALOS_ACTIVITY_SIGNALS)[number];

export const TALOS_ACTIVITY_STATE_MAP: Readonly<
  Record<TalosActivitySignal, OrbState>
> = {
  ready: "idle",
  attending: "listening",
  ingesting: "receiving",
  executing: "working",
  deliberating: "thinking",
  exploring: "searching",
  delivering: "responding",
  complete: "success",
  attention: "warning",
  failed: "error",
  denied: "restricted",
  halted: "stopped"
};

export function adaptTalosActivity(signal: TalosActivitySignal): OrbState {
  return TALOS_ACTIVITY_STATE_MAP[signal];
}

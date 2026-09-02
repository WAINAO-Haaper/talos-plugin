import type { MotionPreference, OrbState } from "../semantics/types";

export const MOTION_TIMINGS = Object.freeze({
  idleCycle: 4400,
  blinkClose: 72,
  blinkHold: 40,
  blinkOpen: 96,
  blinkIntervalMin: 3200,
  blinkIntervalMax: 7100,
  gazeSettle: 240,
  transition: 440,
  workingCycle: 1840,
  searchingCycle: 2720,
  searchingPause: 640,
  searchingSweep: 210,
  successGesture: 760,
  warningGesture: 520,
  errorImbalance: 160,
  errorRecovery: 680,
  restrictedSettle: 320,
  reducedMaximum: 120
});

const stateDurations: Readonly<Partial<Record<OrbState, number>>> = {
  success: MOTION_TIMINGS.successGesture,
  warning: MOTION_TIMINGS.warningGesture,
  error: MOTION_TIMINGS.errorImbalance + MOTION_TIMINGS.errorRecovery,
  restricted: MOTION_TIMINGS.restrictedSettle,
  stopped: MOTION_TIMINGS.restrictedSettle
};

export function transitionDuration(
  state: OrbState,
  preference: Exclude<MotionPreference, "system">
): number {
  if (preference === "none") return 0;
  const full = stateDurations[state] ?? MOTION_TIMINGS.transition;
  return preference === "reduced"
    ? Math.min(MOTION_TIMINGS.reducedMaximum, full)
    : full;
}

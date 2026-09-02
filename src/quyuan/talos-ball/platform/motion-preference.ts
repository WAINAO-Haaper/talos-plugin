import type { MotionPreference } from "../semantics/types";

export type EffectiveMotion = "full" | "reduced" | "none";

export function effectiveMotion(
  preference: MotionPreference,
  mediaQuery: MediaQueryList | null
): EffectiveMotion {
  if (preference === "none") return "none";
  if (preference === "full") return "full";
  if (preference === "reduced") return "reduced";
  return mediaQuery?.matches ? "reduced" : "full";
}

export function createReducedMotionQuery(
  activeWindow: Window
): MediaQueryList | null {
  return activeWindow.matchMedia("(prefers-reduced-motion: reduce)");
}

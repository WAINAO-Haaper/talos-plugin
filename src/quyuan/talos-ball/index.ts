export {
  adaptTalosActivity,
  TALOS_ACTIVITY_SIGNALS,
  TALOS_ACTIVITY_STATE_MAP
} from "./bridges/talos-activity";
export type { TalosActivitySignal } from "./bridges/talos-activity";
export {
  CROWN_KEEL_FORM,
  generateCrownKeelPath,
  generateCrownKeelPoints,
  generateOrbitPath
} from "./form/crown-keel";
export {
  generateValveEyes,
  VALVE_EYE_FORM
} from "./expression/valve-eye";
export { MOTION_TIMINGS, transitionDuration } from "./kinetics/timings";
export { TransitionEngine } from "./orchestration/transition-engine";
export {
  isOrbState,
  renderLogoSvg,
  renderStaticSvg
} from "./scene/static-svg";
export { STATE_DESCRIPTIONS } from "./semantics/descriptions";
export {
  STATE_VECTORS,
  interpolateVector
} from "./semantics/state-vectors";
export type { VisualVector } from "./semantics/state-vectors";
export {
  ORB_STATES
} from "./semantics/types";
export type {
  GazePoint,
  MotionPreference,
  OrbController,
  OrbEventCallback,
  OrbEventMap,
  OrbEventName,
  OrbOptions,
  OrbState,
  OrbTheme,
  OrbThemeInput,
  OrbThemeName,
  StaticOrbOptions,
} from "./semantics/types";
export { TALOS_COLORS } from "./surface/tokens";

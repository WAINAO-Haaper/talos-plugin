import type { OrbState } from "../semantics/types";
import { MOTION_TIMINGS } from "./timings";

export interface MotionSample {
  breathX: number;
  breathY: number;
  lift: number;
  lean: number;
  orbitAngle: number;
  auraPulse: number;
  corePulse: number;
  errorJitter: number;
}

const TAU = Math.PI * 2;

function phase(time: number, duration: number): number {
  return ((time % duration) / duration) * TAU;
}

function pulse(time: number, duration: number): number {
  return 0.5 - Math.cos(phase(time, duration)) * 0.5;
}

export function sampleMotion(
  state: OrbState,
  time: number,
  reduced: boolean
): MotionSample {
  if (reduced || state === "stopped" || state === "restricted") {
    return {
      breathX: 0,
      breathY: 0,
      lift: 0,
      lean: 0,
      orbitAngle: 0,
      auraPulse: 0.5,
      corePulse: state === "success" ? 0.72 : 0,
      errorJitter: 0
    };
  }

  const breath = Math.sin(phase(time, MOTION_TIMINGS.idleCycle));
  const working = Math.sin(phase(time, MOTION_TIMINGS.workingCycle));
  const searchingPeriod =
    MOTION_TIMINGS.searchingCycle + MOTION_TIMINGS.searchingPause;
  const searchProgress = (time % searchingPeriod) / MOTION_TIMINGS.searchingCycle;
  const orbitProgress = Math.max(0, Math.min(1, searchProgress));
  const successProgress = Math.min(1, time / MOTION_TIMINGS.successGesture);
  const errorWindow = time % 920;
  const errorJitter =
    state === "error" && errorWindow < MOTION_TIMINGS.errorImbalance
      ? Math.sin((errorWindow / MOTION_TIMINGS.errorImbalance) * Math.PI * 5) *
        (1 - errorWindow / MOTION_TIMINGS.errorImbalance)
      : 0;

  return {
    breathX: breath * (state === "working" ? 0.006 : 0.004),
    breathY: -breath * (state === "working" ? 0.009 : 0.006),
    lift:
      state === "success"
        ? -Math.sin(successProgress * Math.PI) * 1.4
        : working * (state === "responding" ? 0.35 : 0.18),
    lean: state === "thinking" ? Math.sin(phase(time, 3600)) * 0.8 : 0,
    orbitAngle:
      state === "searching"
        ? orbitProgress * MOTION_TIMINGS.searchingSweep
        : state === "working"
          ? (time / MOTION_TIMINGS.workingCycle) * 120
          : 0,
    auraPulse: pulse(
      time,
      state === "warning" ? MOTION_TIMINGS.warningGesture : MOTION_TIMINGS.idleCycle
    ),
    corePulse:
      state === "success"
        ? Math.sin(successProgress * Math.PI)
        : state === "warning"
          ? pulse(time, MOTION_TIMINGS.warningGesture)
          : 0,
    errorJitter
  };
}

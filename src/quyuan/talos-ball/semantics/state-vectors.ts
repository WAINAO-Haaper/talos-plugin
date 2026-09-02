import type { OrbState } from "./types";

export interface VisualVector {
  bodyScaleX: number;
  bodyScaleY: number;
  crown: number;
  keel: number;
  lean: number;
  lift: number;
  aperture: number;
  eyeTilt: number;
  eyeTension: number;
  eyeSpread: number;
  gazeX: number;
  gazeY: number;
  blueAura: number;
  yellowAura: number;
  orbit: number;
  core: number;
  inkEcho: number;
  crownSignal: number;
  constraintGate: number;
  surfaceTension: number;
  stillness: number;
}

const base = {
  bodyScaleX: 1,
  bodyScaleY: 1,
  crown: 1,
  keel: 1,
  lean: 0,
  lift: 0,
  aperture: 1,
  eyeTilt: 0,
  eyeTension: 0,
  eyeSpread: 1,
  gazeX: 0,
  gazeY: 0,
  blueAura: 0,
  yellowAura: 0,
  orbit: 0,
  core: 0,
  inkEcho: 0,
  crownSignal: 0,
  constraintGate: 0,
  surfaceTension: 0,
  stillness: 0
} satisfies VisualVector;

function vector(overrides: Partial<VisualVector>): VisualVector {
  return { ...base, ...overrides };
}

export const STATE_VECTORS: Readonly<Record<OrbState, Readonly<VisualVector>>> = {
  idle: vector({ aperture: 0.92, blueAura: 0.08 }),
  listening: vector({
    bodyScaleX: 1.015,
    bodyScaleY: 1.022,
    crown: 1.05,
    aperture: 1.12,
    eyeSpread: 1.04,
    gazeY: -0.08,
    blueAura: 0.42,
    surfaceTension: 0.08
  }),
  receiving: vector({
    bodyScaleX: 1.025,
    bodyScaleY: 0.992,
    aperture: 1.06,
    gazeY: 0.08,
    blueAura: 0.58,
    orbit: 0.26,
    surfaceTension: 0.16
  }),
  working: vector({
    bodyScaleX: 1.018,
    bodyScaleY: 0.986,
    aperture: 0.82,
    eyeTilt: -0.08,
    eyeTension: 0.22,
    blueAura: 0.64,
    orbit: 0.72,
    surfaceTension: 0.28
  }),
  thinking: vector({
    bodyScaleX: 0.988,
    bodyScaleY: 1.018,
    crown: 1.08,
    lean: -1.4,
    lift: -0.7,
    aperture: 0.68,
    eyeTilt: 0.16,
    eyeTension: 0.32,
    eyeSpread: 0.96,
    gazeX: -0.2,
    gazeY: -0.12,
    blueAura: 0.24,
    surfaceTension: 0.22
  }),
  searching: vector({
    bodyScaleX: 1.006,
    bodyScaleY: 1.008,
    aperture: 0.9,
    eyeSpread: 1.06,
    gazeX: 0.22,
    blueAura: 0.72,
    orbit: 1,
    surfaceTension: 0.18
  }),
  responding: vector({
    bodyScaleX: 1.02,
    bodyScaleY: 0.99,
    lift: -0.45,
    aperture: 1.02,
    eyeTilt: -0.05,
    gazeY: 0.06,
    blueAura: 0.48,
    orbit: 0.38,
    surfaceTension: 0.2
  }),
  success: vector({
    bodyScaleX: 1.035,
    bodyScaleY: 1.028,
    crown: 1.1,
    lift: -1.15,
    aperture: 0.78,
    eyeTilt: -0.12,
    eyeTension: -0.16,
    yellowAura: 0.9,
    core: 1,
    crownSignal: 0.18,
    surfaceTension: -0.18
  }),
  warning: vector({
    bodyScaleX: 1.024,
    bodyScaleY: 0.982,
    crown: 1.13,
    aperture: 0.74,
    eyeTension: 0.52,
    eyeSpread: 1.02,
    yellowAura: 0.76,
    core: 0.38,
    crownSignal: 1,
    surfaceTension: 0.54
  }),
  error: vector({
    bodyScaleX: 0.974,
    bodyScaleY: 1.012,
    crown: 0.93,
    keel: 1.08,
    lean: 3.2,
    lift: 0.9,
    aperture: 0.58,
    eyeTilt: 0.22,
    eyeTension: 0.78,
    eyeSpread: 0.94,
    inkEcho: 0.62,
    surfaceTension: 0.82
  }),
  restricted: vector({
    bodyScaleX: 0.982,
    bodyScaleY: 1.006,
    crown: 0.96,
    aperture: 0.34,
    eyeTension: 0.84,
    eyeSpread: 0.92,
    yellowAura: 0.44,
    orbit: 0.12,
    constraintGate: 1,
    surfaceTension: 0.9,
    stillness: 1
  }),
  stopped: vector({
    bodyScaleX: 0.99,
    bodyScaleY: 0.99,
    crown: 0.98,
    aperture: 0.22,
    eyeTension: 0.68,
    blueAura: 0,
    yellowAura: 0,
    orbit: 0,
    core: 0,
    constraintGate: 0.64,
    surfaceTension: 0.72,
    stillness: 1
  })
};

export const VISUAL_VECTOR_KEYS = Object.freeze(
  Object.keys(base) as Array<keyof VisualVector>
);

export function copyVector(source: Readonly<VisualVector>): VisualVector {
  return { ...source };
}

export function interpolateVector(
  from: Readonly<VisualVector>,
  to: Readonly<VisualVector>,
  amount: number
): VisualVector {
  const clamped = Math.max(0, Math.min(1, amount));
  const output = {} as VisualVector;
  for (const key of VISUAL_VECTOR_KEYS) {
    output[key] = from[key] + (to[key] - from[key]) * clamped;
  }
  return output;
}

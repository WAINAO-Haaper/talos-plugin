import type { VisualVector } from "../semantics/state-vectors";
import type { GazePoint } from "../semantics/types";

export const VALVE_EYE_FORM = Object.freeze({
  leftCenterX: 37.2,
  rightCenterX: 62.8,
  centerY: 48.3,
  width: 10.4,
  aperture: 5.6,
  gazeRangeX: 2.15,
  gazeRangeY: 1.7
});

export interface ValvePaths {
  left: string;
  right: string;
  transform: string;
}

function n(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function valvePath(
  centerX: number,
  centerY: number,
  aperture: number,
  tilt: number,
  tension: number,
  widthScale: number,
  side: -1 | 1
): string {
  const width = VALVE_EYE_FORM.width * widthScale;
  const halfWidth = width / 2;
  const height = Math.max(0.42, VALVE_EYE_FORM.aperture * aperture);
  const top = height * (0.49 + tension * 0.08);
  const bottom = height * (0.51 - tension * 0.05);
  const leftY = centerY - tilt * 1.2;
  const rightY = centerY + tilt * 1.2;
  const innerBias = side * tension * 0.38;
  const leftX = centerX - halfWidth;
  const rightX = centerX + halfWidth;

  return [
    `M ${n(leftX)} ${n(leftY)}`,
    `C ${n(centerX - width * 0.29)} ${n(centerY - top - innerBias)}`,
    `${n(centerX + width * 0.18)} ${n(centerY - top + innerBias * 0.35)}`,
    `${n(rightX)} ${n(rightY)}`,
    `C ${n(centerX + width * 0.22)} ${n(centerY + bottom + innerBias)}`,
    `${n(centerX - width * 0.32)} ${n(centerY + bottom - innerBias * 0.25)}`,
    `${n(leftX)} ${n(leftY)} Z`
  ].join(" ");
}

export function generateValveEyes(
  vector: Readonly<VisualVector>,
  gaze: Readonly<GazePoint>,
  blinkAmount = 0
): ValvePaths {
  const gazeX = Math.max(-1, Math.min(1, gaze.x + vector.gazeX));
  const gazeY = Math.max(-1, Math.min(1, gaze.y + vector.gazeY));
  const xShift = gazeX * VALVE_EYE_FORM.gazeRangeX;
  const yShift = gazeY * VALVE_EYE_FORM.gazeRangeY;
  const blinkScale = 1 - Math.max(0, Math.min(1, blinkAmount)) * 0.94;
  const aperture = vector.aperture * blinkScale;
  const focusBias = gazeX * 0.045;

  return {
    left: valvePath(
      VALVE_EYE_FORM.leftCenterX + xShift,
      VALVE_EYE_FORM.centerY + yShift,
      aperture * (1 - focusBias),
      vector.eyeTilt - gazeY * 0.08,
      vector.eyeTension,
      vector.eyeSpread,
      -1
    ),
    right: valvePath(
      VALVE_EYE_FORM.rightCenterX + xShift,
      VALVE_EYE_FORM.centerY + yShift,
      aperture * (1 + focusBias),
      -vector.eyeTilt - gazeY * 0.08,
      vector.eyeTension,
      vector.eyeSpread,
      1
    ),
    transform: `rotate(${n(vector.lean * 0.16)} 50 49)`
  };
}

import type { VisualVector } from "../semantics/state-vectors";

export const CROWN_KEEL_FORM = Object.freeze({
  exponentX: 2.4,
  exponentY: 2.18,
  eccentricity: 0.062,
  crownLift: 0.055,
  floorStart: 0.76,
  floorY: 0.94,
  radiusX: 38.8,
  radiusY: 38,
  centerX: 50,
  centerY: 49,
  samples: 48
});

interface Point {
  x: number;
  y: number;
}

function signedPower(value: number, power: number): number {
  return Math.sign(value) * Math.pow(Math.abs(value), power);
}

function smoothStep(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function pointAt(angle: number, vector: Readonly<VisualVector>): Point {
  const form = CROWN_KEEL_FORM;
  let unitX = signedPower(Math.cos(angle), 2 / form.exponentX);
  let unitY = signedPower(Math.sin(angle), 2 / form.exponentY);

  const crownWeight =
    Math.max(0, -unitY) *
    Math.exp(-Math.pow(unitX / 0.46, 2));
  unitY -= form.crownLift * vector.crown * crownWeight;
  unitX +=
    form.eccentricity *
    vector.crown *
    Math.max(0, -unitY) *
    Math.max(0, 1 - Math.abs(unitX));

  if (unitY > form.floorStart) {
    const floorProgress = smoothStep(
      (unitY - form.floorStart) / (1 - form.floorStart)
    );
    const keelExponent = Math.max(0.72, Math.min(1.35, 1 / vector.keel));
    const shapedFloor = Math.pow(floorProgress, keelExponent);
    unitY =
      form.floorStart +
      (form.floorY - form.floorStart) *
        shapedFloor;
  }

  const tensionX = 1 + vector.surfaceTension * 0.018 * (1 - unitY * unitY);
  const tensionY = 1 - vector.surfaceTension * 0.012 * (1 - unitX * unitX);

  return {
    x:
      form.centerX +
      unitX * form.radiusX * vector.bodyScaleX * tensionX,
    y:
      form.centerY +
      vector.lift +
      unitY * form.radiusY * vector.bodyScaleY * tensionY
  };
}

function rounded(value: number): string {
  return Number(value.toFixed(3)).toString();
}

export function generateCrownKeelPoints(
  vector: Readonly<VisualVector>,
  sampleCount = CROWN_KEEL_FORM.samples
): ReadonlyArray<Readonly<Point>> {
  const count = Math.max(16, Math.round(sampleCount / 4) * 4);
  return Array.from({ length: count }, (_, index) =>
    pointAt((index / count) * Math.PI * 2, vector)
  );
}

export function generateCrownKeelPath(
  vector: Readonly<VisualVector>,
  sampleCount = CROWN_KEEL_FORM.samples
): string {
  const points = generateCrownKeelPoints(vector, sampleCount);
  const count = points.length;
  const first = points[0];
  if (!first) return "";

  let path = `M ${rounded(first.x)} ${rounded(first.y)}`;
  for (let index = 0; index < count; index += 1) {
    const p0 = points[(index - 1 + count) % count];
    const p1 = points[index];
    const p2 = points[(index + 1) % count];
    const p3 = points[(index + 2) % count];
    if (!p0 || !p1 || !p2 || !p3) continue;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    path += ` C ${rounded(c1x)} ${rounded(c1y)} ${rounded(c2x)} ${rounded(c2y)} ${rounded(p2.x)} ${rounded(p2.y)}`;
  }
  return `${path} Z`;
}

export function generateOrbitPath(
  startDegrees = -126,
  sweepDegrees = 210
): string {
  const radiusX = 44.5;
  const radiusY = 43.2;
  const centerX = CROWN_KEEL_FORM.centerX;
  const centerY = CROWN_KEEL_FORM.centerY;
  const start = (startDegrees * Math.PI) / 180;
  const end = ((startDegrees + sweepDegrees) * Math.PI) / 180;
  const startX = centerX + Math.cos(start) * radiusX;
  const startY = centerY + Math.sin(start) * radiusY;
  const endX = centerX + Math.cos(end) * radiusX;
  const endY = centerY + Math.sin(end) * radiusY;
  const largeArc = Math.abs(sweepDegrees) > 180 ? 1 : 0;
  const sweep = sweepDegrees >= 0 ? 1 : 0;
  return `M ${rounded(startX)} ${rounded(startY)} A ${radiusX} ${radiusY} 0 ${largeArc} ${sweep} ${rounded(endX)} ${rounded(endY)}`;
}

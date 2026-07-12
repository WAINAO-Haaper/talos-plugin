export interface TalosMarkPoint {
	x: number;
	y: number;
}

// Official Modular T-Shield geometry used by the TALOS navigation icon.
const OUTER_MARK: ReadonlyArray<readonly [number, number]> = [
	[180, 247], [249, 247], [249, 286], [304, 286], [304, 247],
	[374, 247], [374, 286], [405, 286], [405, 411], [374, 411],
	[374, 460], [306, 460], [306, 496], [247, 496], [247, 460],
	[180, 460], [180, 411], [148, 411], [148, 286], [180, 286],
];

const INNER_T: ReadonlyArray<readonly [number, number]> = [
	[199, 326], [353, 326], [353, 373], [306, 373],
	[306, 460], [247, 460], [247, 373], [199, 373],
];

// Voice-stage variant: a larger negative space makes the solid side bands half
// as wide, gives the eyes more room, and carries the mouth opening to the bottom.
const SLIM_INNER_T: ReadonlyArray<readonly [number, number]> = [
	[174, 310], [379, 310], [379, 390], [322, 390],
	[322, 496], [232, 496], [232, 390], [174, 390],
];

const MARK_CENTER_X = 276.5;
const MARK_CENTER_Y = 371.5;
const MARK_SCALE = 257;

export const TALOS_ICON_SVG =
	'<rect x="6" y="6" width="88" height="88" rx="20" fill="#005CFF"/>' +
	'<g transform="translate(-27.5 -54.1) scale(0.2802)">' +
	'<path fill="#FFFFFF" d="M180 247H249V286H304V247H374V286H405V411H374V460H306V496H247V460H180V411H148V286H180V247Z"/>' +
	'<path fill="#005CFF" d="M199 326H353V373H306V460H247V373H199V326Z"/>' +
	'</g>';

function pointInPolygon(
	x: number,
	y: number,
	polygon: ReadonlyArray<readonly [number, number]>
): boolean {
	let inside = false;
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const [xi, yi] = polygon[i];
		const [xj, yj] = polygon[j];
		const crosses = (yi > y) !== (yj > y)
			&& x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
		if (crosses) inside = !inside;
	}
	return inside;
}

function distanceToSegment(
	x: number,
	y: number,
	ax: number,
	ay: number,
	bx: number,
	by: number
): number {
	const abX = bx - ax;
	const abY = by - ay;
	const lengthSquared = abX * abX + abY * abY;
	const position = lengthSquared === 0
		? 0
		: Math.max(0, Math.min(1, ((x - ax) * abX + (y - ay) * abY) / lengthSquared));
	return Math.hypot(x - (ax + abX * position), y - (ay + abY * position));
}

function distanceToPolygonEdge(
	x: number,
	y: number,
	polygon: ReadonlyArray<readonly [number, number]>
): number {
	let distance = Number.POSITIVE_INFINITY;
	for (let index = 0; index < polygon.length; index++) {
		const [ax, ay] = polygon[index];
		const [bx, by] = polygon[(index + 1) % polygon.length];
		distance = Math.min(distance, distanceToSegment(x, y, ax, ay, bx, by));
	}
	return distance;
}

function pointInRoundedRect(
	x: number,
	y: number,
	left: number,
	top: number,
	right: number,
	bottom: number,
	radius: number
): boolean {
	if (x < left || x > right || y < top || y > bottom) return false;
	const nearestX = Math.max(left + radius, Math.min(right - radius, x));
	const nearestY = Math.max(top + radius, Math.min(bottom - radius, y));
	return Math.hypot(x - nearestX, y - nearestY) <= radius;
}

/** Deterministically samples the official mark while preserving its negative-space T. */
export function generateTalosMarkPoints(step = 4): TalosMarkPoint[] {
	const safeStep = Math.max(2, Math.min(12, Math.round(step)));
	const points: TalosMarkPoint[] = [];
	for (let y = 247; y <= 496; y += safeStep) {
		for (let x = 148; x <= 405; x += safeStep) {
			if (!pointInPolygon(x, y, OUTER_MARK) || pointInPolygon(x, y, INNER_T)) continue;
			points.push({
				x: (x - MARK_CENTER_X) / MARK_SCALE,
				y: (y - MARK_CENTER_Y) / MARK_SCALE,
			});
		}
	}
	return points;
}

/** Samples only the outer and negative-T edges, producing a narrow high-density frame. */
export function generateTalosMarkOutlinePoints(step = 2, edgeWidth = 13): TalosMarkPoint[] {
	const safeStep = Math.max(1, Math.min(8, Math.round(step)));
	const safeWidth = Math.max(4, Math.min(32, edgeWidth));
	const points: TalosMarkPoint[] = [];
	for (let y = 247; y <= 496; y += safeStep) {
		for (let x = 148; x <= 405; x += safeStep) {
			if (!pointInPolygon(x, y, OUTER_MARK) || pointInPolygon(x, y, INNER_T)) continue;
			const distance = Math.min(
				distanceToPolygonEdge(x, y, OUTER_MARK),
				distanceToPolygonEdge(x, y, INNER_T)
			);
			if (distance > safeWidth) continue;
			points.push({
				x: (x - MARK_CENTER_X) / MARK_SCALE,
				y: (y - MARK_CENTER_Y) / MARK_SCALE,
			});
		}
	}
	return points;
}

/** Solid, narrow T-Shield bands with a larger eye bay and an open lower mouth. */
export function generateTalosSlimMarkPoints(step = 2): TalosMarkPoint[] {
	const safeStep = Math.max(1, Math.min(8, Math.round(step)));
	const points: TalosMarkPoint[] = [];
	for (let y = 247; y <= 496; y += safeStep) {
		for (let x = 148; x <= 405; x += safeStep) {
			if (!pointInPolygon(x, y, OUTER_MARK) || pointInPolygon(x, y, SLIM_INNER_T)) continue;
			points.push({
				x: (x - MARK_CENTER_X) / MARK_SCALE,
				y: (y - MARK_CENTER_Y) / MARK_SCALE,
			});
		}
	}
	return points;
}

/** Rounded voice-stage silhouette: solid narrow bands, large eye bay, open mouth. */
export function generateTalosRoundedMarkPoints(step = 2): TalosMarkPoint[] {
	const safeStep = Math.max(1, Math.min(8, Math.round(step)));
	const points: TalosMarkPoint[] = [];
	for (let y = 247; y <= 480; y += safeStep) {
		for (let x = 148; x <= 405; x += safeStep) {
			const outer = pointInRoundedRect(x, y, 148, 282, 405, 430, 26)
				|| pointInRoundedRect(x, y, 180, 247, 249, 334, 21)
				|| pointInRoundedRect(x, y, 304, 247, 374, 334, 21)
				|| pointInRoundedRect(x, y, 180, 378, 248, 466, 20)
				|| pointInRoundedRect(x, y, 305, 378, 374, 466, 20);
			const eyeBay = pointInRoundedRect(x, y, 174, 306, 379, 394, 29);
			const openMouth = pointInRoundedRect(x, y, 232, 368, 322, 484, 25);
			if (!outer || eyeBay || openMouth) continue;
			points.push({
				x: (x - MARK_CENTER_X) / MARK_SCALE,
				y: (y - MARK_CENTER_Y) / MARK_SCALE,
			});
		}
	}
	return points;
}

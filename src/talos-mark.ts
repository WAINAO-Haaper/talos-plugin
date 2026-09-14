export interface TalosMarkPoint {
	x: number;
	y: number;
}

// Legacy TALOS mark geometry used by the voice-particle fallback below.
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

// TalosBall 0.3.0's generated default blob pose, normalized into Obsidian's
// 0 0 100 100 custom-icon viewBox. Keep the body and eye paths in lockstep
// with the pinned runtime's static logo instead of approximating the mark.
export const TALOS_ICON_SVG =
	'<title>TalosBall</title>' +
	'<defs><radialGradient id="talos-ball-icon-body" cx="38%" cy="32%" r="75%">' +
	'<stop offset="0%" stop-color="#f6f3ef"/>' +
	'<stop offset="62%" stop-color="#F3F0EA"/>' +
	'<stop offset="100%" stop-color="#d6d3ce"/>' +
	'</radialGradient></defs>' +
	'<g transform="translate(5.791506 5.791506) scale(0.3861003861)">' +
	'<g transform="translate(114.27 113.8) rotate(0) scale(0.99) translate(-114.27 -114.27)">' +
	'<path d="M228.54 114.27L228.29 121.74L227.55 129.18L226.32 136.56L224.62 143.84L222.45 150.99L219.82 157.99L216.73 164.80L213.20 171.39L209.25 177.73L204.89 183.81L200.15 189.59L195.04 195.04L189.59 200.15L183.81 204.89L177.73 209.24L171.38 213.19L164.78 216.70L157.97 219.78L150.98 222.40L143.82 224.56L136.54 226.25L129.17 227.46L121.74 228.19L114.27 228.44L106.80 228.20L99.37 227.48L91.99 226.27L84.71 224.58L77.56 222.42L70.56 219.79L63.75 216.71L57.16 213.18L50.81 209.24L44.74 204.89L38.96 200.15L33.50 195.04L28.39 189.59L23.65 183.81L19.29 177.73L15.35 171.38L11.82 164.79L8.73 157.99L6.09 150.99L3.92 143.84L2.21 136.56L0.99 129.18L0.25 121.74L0.00 114.27L0.25 106.80L0.98 99.36L2.20 91.98L3.90 84.70L6.06 77.54L8.69 70.54L11.78 63.73L15.30 57.13L19.25 50.78L23.61 44.70L28.35 38.92L33.46 33.46L38.91 28.34L44.69 23.59L50.77 19.24L57.12 15.29L63.72 11.77L70.54 8.69L77.54 6.07L84.70 3.90L91.98 2.21L99.36 1.00L106.80 0.26L114.27 0.01L121.74 0.25L129.19 0.98L136.57 2.19L143.85 3.88L151.01 6.04L158.01 8.68L164.82 11.76L171.42 15.29L177.77 19.24L183.84 23.60L189.62 28.35L195.08 33.46L200.20 38.92L204.94 44.70L209.29 50.78L213.23 57.13L216.76 63.73L219.84 70.54L222.48 77.54L224.65 84.70L226.34 91.98L227.56 99.36L228.29 106.80Z" fill="url(#talos-ball-icon-body)" stroke="none" stroke-width="2"/>' +
	'<path fill="#1A1A1A" stroke="none" stroke-width="1.6" d="M130.36 45.98L132.71 46.19L134.98 46.81L137.11 47.83L138.97 49.28L140.47 51.09L141.68 53.12L142.73 55.23L143.76 57.36L144.78 59.49L145.79 61.62L146.79 63.76L147.76 65.91L148.71 68.07L149.63 70.25L150.52 72.43L151.37 74.63L151.99 76.91L152.10 79.26L151.64 81.57L150.59 83.68L149.04 85.45L147.10 86.78L144.90 87.62L142.56 87.93L140.22 87.71L137.98 86.99L135.93 85.82L134.17 84.24L132.78 82.34L131.69 80.25L130.77 78.08L129.87 75.89L128.94 73.72L128.00 71.56L127.03 69.40L126.05 67.26L125.05 65.12L124.03 62.99L122.93 60.90L121.87 58.79L121.03 56.59L120.72 54.26L121.10 51.93L122.15 49.83L123.75 48.10L125.76 46.89L128.01 46.19Z" transform="translate(134.64 69.41) scale(0.98 0.99) translate(-136.62 -66.73)"/>' +
	'<path fill="#1A1A1A" stroke="none" stroke-width="1.6" d="M176.61 37.08L178.72 37.59L180.70 38.48L182.52 39.65L184.20 41.03L185.71 42.59L187.03 44.31L188.20 46.14L189.26 48.03L190.27 49.96L191.26 51.89L192.23 53.84L193.16 55.80L194.05 57.78L194.92 59.77L195.74 61.78L196.53 63.80L197.27 65.84L197.97 67.90L198.47 70.01L198.63 72.18L198.40 74.33L197.58 76.33L195.95 77.72L193.83 78.08L191.71 77.65L189.76 76.69L188.03 75.38L186.53 73.82L185.28 72.05L184.25 70.13L183.40 68.14L182.63 66.11L181.87 64.07L181.07 62.05L180.25 60.04L179.39 58.05L178.49 56.07L177.57 54.10L176.61 52.15L175.62 50.22L174.59 48.31L173.53 46.41L172.54 44.48L171.86 42.42L171.76 40.26L172.62 38.30L174.45 37.19Z" transform="translate(178.34 59.56) scale(0.76 0.98) translate(-185.69 -57.21)"/>' +
	'</g></g>';

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

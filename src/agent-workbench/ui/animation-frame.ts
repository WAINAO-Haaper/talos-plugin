export interface ScheduledAnimationFrame {
	kind: "raf" | "timeout";
	id: number;
	ownerWindow: Window | null;
}

function rendererWindow(): Window | null { return typeof window === "undefined" ? null : window; }

export function scheduleAnimationFrame(callback: () => void, ownerWindow: Window | null = rendererWindow()): ScheduledAnimationFrame {
	const target = ownerWindow ?? rendererWindow();
	if (!target) { callback(); return { kind: "timeout", id: 0, ownerWindow: null }; }
	if (typeof target.requestAnimationFrame === "function") {
		return { kind: "raf", id: target.requestAnimationFrame(callback), ownerWindow: target };
	}
	return { kind: "timeout", id: target.setTimeout(callback, 16), ownerWindow: target };
}

export function cancelScheduledAnimationFrame(frame: ScheduledAnimationFrame): void {
	const target = frame.ownerWindow ?? rendererWindow();
	if (!target) return;
	if (frame.kind === "raf" && typeof target.cancelAnimationFrame === "function") target.cancelAnimationFrame(frame.id);
	else target.clearTimeout(frame.id);
}

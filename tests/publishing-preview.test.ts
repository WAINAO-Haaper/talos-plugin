import { describe, expect, it, vi } from "vitest";
import { PreviewController, type PreviewState, type PreviewTimerPort } from "../src/publishing/preview-controller";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
	return { promise, resolve, reject };
}
function timers() {
	let sequence = 0;
	const callbacks = new Map<number, () => void>();
	const port: PreviewTimerPort = {
		setTimeout: vi.fn((callback: () => void, delayMs: number) => {
			expect(delayMs).toBe(350);
			const id = ++sequence;
			callbacks.set(id, callback);
			return id;
		}),
		clearTimeout: (handle) => { callbacks.delete(handle as number); },
	};
	return { port, fire: () => { const due = [...callbacks.values()]; callbacks.clear(); due.forEach((callback) => callback()); }, count: () => callbacks.size };
}
async function settle() { for (let index = 0; index < 8; index++) await Promise.resolve(); }
function setup() {
	const timer = timers();
	const calls: Array<{ input: string; revision: number; work: ReturnType<typeof deferred<string>> }> = [];
	const states: PreviewState<string>[] = [];
	const prepare = vi.fn((input: string, revision: number) => {
		const work = deferred<string>();
		calls.push({ input, revision, work });
		return work.promise;
	});
	const controller = new PreviewController({ prepare, onState: (state) => states.push(state), timers: timer.port });
	return { controller, timer, calls, states, prepare };
}

describe("local publishing preview revision controller", () => {
	it("debounces continuous input at 350 ms and prepares only the latest snapshot", async () => {
		const fixture = setup();
		fixture.controller.update("first");
		fixture.controller.update("second");
		const current = fixture.controller.update("latest");
		expect(fixture.controller.getState()).toEqual({ phase: "pending", revision: current });
		expect(fixture.timer.count()).toBe(1);
		expect(fixture.prepare).not.toHaveBeenCalled();
		fixture.timer.fire();
		await settle();
		expect(fixture.calls.map((call) => call.input)).toEqual(["latest"]);
		fixture.calls[0].work.resolve("latest preview");
		await settle();
		expect(fixture.controller.getState()).toEqual({ phase: "ready", revision: current, result: "latest preview" });
		expect(fixture.controller.isCurrentReady(current)).toBe(true);
	});
	it("invalidates approval eligibility immediately and keeps lastGood visible during updates and errors", async () => {
		const fixture = setup();
		const original = fixture.controller.refresh("original");
		await settle();
		fixture.calls[0].work.resolve("good preview");
		await settle();
		expect(fixture.controller.isCurrentReady(original)).toBe(true);
		const next = fixture.controller.update("changed");
		expect(fixture.controller.isCurrentReady(original)).toBe(false);
		expect(fixture.controller.isCurrentReady(next)).toBe(false);
		expect(fixture.controller.getState()).toEqual({ phase: "updating", revision: next, result: "good preview" });
		fixture.timer.fire();
		await settle();
		fixture.calls[1].work.reject(new Error("invalid cover"));
		await settle();
		expect(fixture.controller.getState()).toEqual({ phase: "error", revision: next, result: "good preview", error: "invalid cover" });
		expect(fixture.controller.isCurrentReady(next)).toBe(false);
	});
	it("allows at most one inflight prepare and coalesces queued work into the newest input", async () => {
		const fixture = setup();
		fixture.controller.refresh("running");
		await settle();
		fixture.controller.update("dropped");
		fixture.timer.fire();
		const current = fixture.controller.update("newest");
		fixture.timer.fire();
		await settle();
		expect(fixture.calls.map((call) => call.input)).toEqual(["running"]);
		fixture.calls[0].work.resolve("obsolete success");
		await settle();
		expect(fixture.calls.map((call) => call.input)).toEqual(["running", "newest"]);
		expect(fixture.states.some((state) => state.result === "obsolete success")).toBe(false);
		fixture.calls[1].work.resolve("current result");
		await settle();
		expect(fixture.controller.getState()).toEqual({ phase: "ready", revision: current, result: "current result" });
	});
	it("discards an obsolete error before the newer revision becomes ready", async () => {
		const fixture = setup();
		fixture.controller.refresh("old");
		await settle();
		const latest = fixture.controller.refresh("new");
		fixture.calls[0].work.reject(new Error("obsolete error"));
		await settle();
		expect(fixture.states.some((state) => state.phase === "error")).toBe(false);
		fixture.calls[1].work.resolve("new ready");
		await settle();
		expect(fixture.controller.getState()).toEqual({ phase: "ready", revision: latest, result: "new ready" });
	});
	it("flushes the newest pending input immediately and explicit refresh gets a fresh revision", async () => {
		const fixture = setup();
		const first = fixture.controller.update("first");
		fixture.controller.flush();
		expect(fixture.timer.count()).toBe(0);
		await settle();
		expect(fixture.calls).toHaveLength(1);
		fixture.calls[0].work.resolve("ready");
		await settle();
		fixture.controller.flush();
		await settle();
		expect(fixture.calls).toHaveLength(1);
		const second = fixture.controller.refresh("first");
		expect(second).toBeGreaterThan(first);
		expect(fixture.controller.isCurrentReady(first)).toBe(false);
		await settle();
		expect(fixture.calls).toHaveLength(2);
	});
	it("clear removes the last result, drops pending work, and ignores late success", async () => {
		const fixture = setup();
		fixture.controller.refresh("running");
		await settle();
		fixture.controller.update("queued");
		const empty = fixture.controller.clear();
		expect(fixture.timer.count()).toBe(0);
		expect(fixture.controller.getState()).toEqual({ phase: "empty", revision: empty });
		fixture.calls[0].work.resolve("late result");
		await settle();
		expect(fixture.calls).toHaveLength(1);
		expect(fixture.controller.getState()).toEqual({ phase: "empty", revision: empty });
		expect(fixture.controller.isCurrentReady(empty)).toBe(false);
	});
	it.each(["success", "failure"] as const)("dispose clears timers and suppresses late %s callbacks", async (outcome) => {
		const fixture = setup();
		fixture.controller.refresh("running");
		await settle();
		fixture.controller.update("pending");
		const count = fixture.states.length;
		fixture.controller.dispose();
		expect(fixture.timer.count()).toBe(0);
		if (outcome === "success") fixture.calls[0].work.resolve("late");
		else fixture.calls[0].work.reject(new Error("late"));
		await settle();
		fixture.timer.fire();
		fixture.controller.refresh("after disposal");
		fixture.controller.clear();
		await settle();
		expect(fixture.states).toHaveLength(count);
		expect(fixture.calls).toHaveLength(1);
		expect(fixture.controller.isCurrentReady(fixture.controller.getState().revision)).toBe(false);
	});
	it("does not start an invalidated request when a newer input arrives before the prepare microtask", async () => {
		const fixture = setup();
		fixture.controller.refresh("obsolete");
		fixture.controller.update("latest");
		await settle();
		expect(fixture.prepare).not.toHaveBeenCalled();
		fixture.timer.fire();
		await settle();
		expect(fixture.calls.map((call) => call.input)).toEqual(["latest"]);
	});
});

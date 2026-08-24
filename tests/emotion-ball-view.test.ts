import { describe, expect, it, vi } from "vitest";
import {
	EMOTION_BALL_STATE_IDS,
	EmotionBallView,
	type EmotionBallEngine,
	type EmotionBallEngineOptions,
	type EmotionBallFactory,
} from "../src/quyuan/emotion-ball-view";
import { createMiniHost } from "./helpers/mini-dom";

function fakeEngine(overrides: Partial<EmotionBallEngine> = {}): EmotionBallEngine {
	return {
		setEmotion: vi.fn(() => true),
		setStyle: vi.fn(),
		setActive: vi.fn(),
		renderStatic: vi.fn(),
		destroy: vi.fn(),
		...overrides,
	};
}

describe("EmotionBallView", () => {
	it("pins the accepted state ids and mounts the local blob runtime", () => {
		expect(EMOTION_BALL_STATE_IDS).toEqual({
			waiting: "35",
			receiving: "31",
			busy: "32",
			thinking: "30",
			searching: "40",
			replying: "39",
			done: "33",
			error: "34",
			restricted: "38",
			stop: "41",
		});
		const engine = fakeEngine();
		let mountCount = 0;
		let mountedOptions: EmotionBallEngineOptions | undefined;
		const factory: EmotionBallFactory = (_host, options) => {
			mountCount += 1;
			mountedOptions = options;
			return engine;
		};
		const { host, element } = createMiniHost();
		const view = new EmotionBallView(factory);

		view.mount(host, { id: "aurora:dark", sketch: false });

		expect(mountCount).toBe(1);
		expect(mountedOptions).toMatchObject({
			emotion: "35",
			shape: "blob",
			idle: false,
			autostart: true,
			lite: false,
			fallbackId: "35",
		});
		expect(element.classList.contains("tq-emotion-ball")).toBe(true);
		expect(element.getAttribute("data-emotion-ball-state")).toBe("waiting");
		expect(element.getAttribute("data-emotion-ball-theme")).toBe("aurora:dark");
		expect(element.getAttribute("data-emotion-ball-fallback")).toBe("false");
		expect(element.children).toHaveLength(2);
	});

	it("updates normalized state and theme without exposing business capabilities", () => {
		const setEmotion = vi.fn((_id: string) => true);
		const setStyle = vi.fn((_style: { sketch: number }) => undefined);
		const engine = fakeEngine({ setEmotion, setStyle });
		const { host, element } = createMiniHost();
		const view = new EmotionBallView(() => engine);
		view.mount(host, { id: "aurora:dark", sketch: false });

		view.updateState("searching");
		view.updateTheme({ id: "geometric-modern-xuan-paper:light", sketch: true });

		expect(setEmotion).toHaveBeenCalledWith("40");
		expect(setStyle).toHaveBeenLastCalledWith({ sketch: 1 });
		expect(element.getAttribute("data-emotion-ball-state")).toBe("searching");
		expect(element.getAttribute("data-emotion-ball-theme")).toBe(
			"geometric-modern-xuan-paper:light"
		);
	});

	it("destroys the previous engine on repeated mount and fully cleans the host", () => {
		const destroyFirst = vi.fn(() => undefined);
		const destroySecond = vi.fn(() => undefined);
		const first = fakeEngine({ destroy: destroyFirst });
		const second = fakeEngine({ destroy: destroySecond });
		let factoryCall = 0;
		const factory: EmotionBallFactory = () => {
			factoryCall += 1;
			return factoryCall === 1 ? first : second;
		};
		const firstHost = createMiniHost();
		const secondHost = createMiniHost();
		const view = new EmotionBallView(factory);

		view.mount(firstHost.host, { id: "aurora:dark", sketch: false });
		view.mount(secondHost.host, { id: "aurora:light", sketch: false });
		expect(destroyFirst).toHaveBeenCalledTimes(1);
		expect(firstHost.element.children).toHaveLength(0);
		expect(firstHost.element.classList.contains("tq-emotion-ball")).toBe(false);

		view.destroy();
		expect(destroySecond).toHaveBeenCalledTimes(1);
		expect(secondHost.element.children).toHaveLength(0);
		expect(secondHost.element.getAttribute("data-emotion-ball-state")).toBeNull();
	});

	it("falls back to a local static visual when creation or state update fails", () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const failedMount = createMiniHost();
		const view = new EmotionBallView(() => {
			throw new Error("runtime unavailable");
		});
		view.mount(failedMount.host, { id: "aurora:dark", sketch: false });
		expect(failedMount.element.getAttribute("data-emotion-ball-fallback")).toBe("true");
		expect(failedMount.element.textContent).toContain("静态状态 · 等待输入");

		const rejectedState = createMiniHost();
		const rejectingEngine = fakeEngine({ setEmotion: vi.fn(() => false) });
		const stateView = new EmotionBallView(() => rejectingEngine);
		stateView.mount(rejectedState.host, { id: "aurora:dark", sketch: false });
		stateView.updateState("error");
		expect(rejectedState.element.getAttribute("data-emotion-ball-fallback")).toBe("true");
		expect(rejectedState.element.textContent).toContain("静态状态 · 出现错误");
		log.mockRestore();
	});

	it("uses a static frame and unregisters media listeners for reduced motion", () => {
		const { host, element } = createMiniHost();
		const add = vi.fn();
		const remove = vi.fn();
		(element.ownerDocument as unknown as { defaultView: unknown }).defaultView = {
			matchMedia: () => ({
				matches: true,
				addEventListener: add,
				removeEventListener: remove,
			}),
		};
		const setActive = vi.fn((_active: boolean) => undefined);
		const renderStatic = vi.fn(() => undefined);
		const engine = fakeEngine({ setActive, renderStatic });
		let mountedOptions: EmotionBallEngineOptions | undefined;
		const factory: EmotionBallFactory = (_host, options) => {
			mountedOptions = options;
			return engine;
		};
		const view = new EmotionBallView(factory);

		view.mount(host, { id: "aurora:dark", sketch: false });
		expect(mountedOptions).toMatchObject({ autostart: false, lite: true });
		expect(setActive).toHaveBeenCalledWith(false);
		expect(renderStatic).toHaveBeenCalled();
		expect(element.getAttribute("data-emotion-ball-motion")).toBe("reduced");
		expect(add).toHaveBeenCalledWith("change", expect.any(Function));

		view.destroy();
		expect(remove).toHaveBeenCalledWith("change", expect.any(Function));
		expect(element.getAttribute("data-emotion-ball-motion")).toBeNull();
	});
});

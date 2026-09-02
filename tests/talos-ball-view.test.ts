import { describe, expect, it, vi } from "vitest";
import {
	TALOS_BALL_STATE_MAP,
	TalosBallView,
	type TalosBallController,
	type TalosBallFactory,
} from "../src/quyuan/talos-ball-view";
import { createMiniHost } from "./helpers/mini-dom";

function fakeController(
	overrides: Partial<TalosBallController> = {}
): TalosBallController {
	return {
		setState: vi.fn(),
		setActive: vi.fn(),
		renderStatic: vi.fn(() => "<svg/>"),
		setTheme: vi.fn(),
		destroy: vi.fn(),
		...overrides,
	};
}

describe("TalosBallView", () => {
	it("maps the voice states to the TALOS-owned twelve-state runtime", () => {
		expect(TALOS_BALL_STATE_MAP).toEqual({
			waiting: "idle",
			receiving: "listening",
			busy: "receiving",
			thinking: "thinking",
			searching: "searching",
			replying: "responding",
			done: "success",
			error: "error",
			restricted: "restricted",
			stop: "stopped",
		});

		const controller = fakeController();
		let mountCount = 0;
		let mountedOptions: Parameters<TalosBallFactory>[1] | undefined;
		const factory: TalosBallFactory = (_host, options) => {
			mountCount += 1;
			mountedOptions = options;
			return controller;
		};
		const { host, element } = createMiniHost();
		const view = new TalosBallView(factory);

		view.mount(host, { id: "aurora:dark", mode: "dark" });

		expect(mountCount).toBe(1);
		expect(mountedOptions).toMatchObject({
			state: "idle",
			size: "100%",
			active: true,
			motion: "system",
			theme: "dark",
			seed: 0x54414c4f,
		});
		expect(element.classList.contains("tq-talos-ball")).toBe(true);
		expect(element.getAttribute("data-talos-ball-state")).toBe("waiting");
		expect(element.getAttribute("data-talos-ball-theme")).toBe("aurora:dark");
		expect(element.getAttribute("data-talos-ball-fallback")).toBe("false");
		expect(element.children).toHaveLength(2);
	});

	it("updates normalized state and theme without business capabilities", () => {
		const setState = vi.fn();
		const setTheme = vi.fn();
		const controller = fakeController({ setState, setTheme });
		const { host, element } = createMiniHost();
		const view = new TalosBallView(() => controller);
		view.mount(host, { id: "aurora:dark", mode: "dark" });

		view.updateState("searching");
		view.updateTheme({ id: "geometric-modern:light", mode: "light" });

		expect(setState).toHaveBeenCalledWith("searching");
		expect(setTheme).toHaveBeenLastCalledWith("light");
		expect(element.getAttribute("data-talos-ball-state")).toBe("searching");
		expect(element.getAttribute("data-talos-ball-theme")).toBe(
			"geometric-modern:light"
		);
	});

	it("destroys the previous controller and fully cleans the host", () => {
		const destroyFirst = vi.fn();
		const destroySecond = vi.fn();
		const first = fakeController({ destroy: destroyFirst });
		const second = fakeController({ destroy: destroySecond });
		let factoryCall = 0;
		const factory: TalosBallFactory = () => {
			factoryCall += 1;
			return factoryCall === 1 ? first : second;
		};
		const firstHost = createMiniHost();
		const secondHost = createMiniHost();
		const view = new TalosBallView(factory);

		view.mount(firstHost.host, { id: "aurora:dark", mode: "dark" });
		view.mount(secondHost.host, { id: "aurora:light", mode: "light" });
		expect(destroyFirst).toHaveBeenCalledTimes(1);
		expect(firstHost.element.children).toHaveLength(0);
		expect(firstHost.element.classList.contains("tq-talos-ball")).toBe(false);

		view.destroy();
		expect(destroySecond).toHaveBeenCalledTimes(1);
		expect(secondHost.element.children).toHaveLength(0);
		expect(secondHost.element.getAttribute("data-talos-ball-state")).toBeNull();
	});

	it("falls back to the local TALOS static visual on runtime failure", () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const failedMount = createMiniHost();
		const view = new TalosBallView(() => {
			throw new Error("runtime unavailable");
		});
		view.mount(failedMount.host, { id: "aurora:dark", mode: "dark" });
		expect(failedMount.element.getAttribute("data-talos-ball-fallback")).toBe("true");
		expect(failedMount.element.textContent).toContain("静态状态 · 等待输入");

		const failedState = createMiniHost();
		const controller = fakeController({
			setState: vi.fn(() => {
				throw new Error("state failed");
			}),
		});
		const stateView = new TalosBallView(() => controller);
		stateView.mount(failedState.host, { id: "aurora:dark", mode: "dark" });
		stateView.updateState("error");
		expect(failedState.element.getAttribute("data-talos-ball-fallback")).toBe("true");
		expect(failedState.element.textContent).toContain("静态状态 · 出现错误");
		log.mockRestore();
	});

	it("uses a static frame and unregisters listeners for reduced motion", () => {
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
		const setActive = vi.fn();
		const renderStatic = vi.fn(() => "<svg/>");
		const controller = fakeController({ setActive, renderStatic });
		let mountedOptions: Parameters<TalosBallFactory>[1] | undefined;
		const factory: TalosBallFactory = (_host, options) => {
			mountedOptions = options;
			return controller;
		};
		const view = new TalosBallView(factory);

		view.mount(host, { id: "aurora:dark", mode: "dark" });
		expect(mountedOptions).toMatchObject({
			active: false,
			motion: "reduced",
		});
		expect(setActive).toHaveBeenCalledWith(false);
		expect(renderStatic).toHaveBeenCalled();
		expect(element.getAttribute("data-talos-ball-motion")).toBe("reduced");
		expect(add).toHaveBeenCalledWith("change", expect.any(Function));

		view.destroy();
		expect(remove).toHaveBeenCalledWith("change", expect.any(Function));
		expect(element.getAttribute("data-talos-ball-motion")).toBeNull();
	});
});

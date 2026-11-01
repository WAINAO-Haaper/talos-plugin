import { describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => ({ setIcon: vi.fn() }));
vi.mock("../src/actions", () => ({ openFile: vi.fn() }));
vi.mock("../src/ui/console-action-panel", () => ({ ConsoleActionPanel: class {} }));
vi.mock("../src/ui/quick-note", () => ({ QuickNote: class {} }));
vi.mock("../src/ui/view-modules", () => ({ moduleHero: vi.fn() }));
import { pickTodaySlots, type TodayTimelineSlot } from "../src/ui/pages/today-page";

const slot = (time: string, mins: number, dur: number): TodayTimelineSlot => ({ time, mins, dur, title: time, starter: "", path: `${time}.md` });
const slots = [slot("08:30", 510, 15), slot("09:00", 540, 120), slot("14:00", 840, 120)];

describe("historical timeline helper", () => {
	it("returns running and next slots without treating an end time as active", () => {
		expect(pickTodaySlots(slots, 600).current?.time).toBe("09:00");
		expect(pickTodaySlots(slots, 600).next?.time).toBe("14:00");
		expect(pickTodaySlots(slots, 525).current).toBeNull();
		expect(pickTodaySlots(slots, 1200)).toEqual({ current: null, next: null });
	});
});

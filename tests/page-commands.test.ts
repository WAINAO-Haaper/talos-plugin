import { describe, expect, it, vi } from "vitest";
import { pageCommands, registerPageCommands } from "../src/plugin/page-commands";
import { PRIMARY_NAVIGATION, navigationFor } from "../src/ui/navigation-model";

describe("page commands", () => {
	it("uses the personal catalog navigation without duplicate assistant or settings commands", () => {
		const commands = pageCommands("personal", true);
		const expected = navigationFor("personal", true).flatMap((group) => group.children.map((child) => child.key)).filter((key) => key !== "chat");
		expect(commands.map((command) => command.pageKey)).toEqual([...expected, "daily", "talos", "vault"]);
		expect(new Set(commands.map((command) => command.id)).size).toBe(commands.length);
		expect(commands.filter((command) => command.pageKey.startsWith("sb-"))).toHaveLength(5);
		expect(commands.filter((command) => command.pageKey === "settings")).toHaveLength(1);
		expect(pageCommands("personal", false)).toEqual(pageCommands());
		expect(pageCommands("superbrain", true)).toEqual(pageCommands("superbrain"));
	});

	it("registers and opens each C/M group in personal mode when the catalog is present", () => {
		const commands: Array<{ id: string; callback: () => void }> = [];
		const open = vi.fn(async () => undefined);
		registerPageCommands({ addCommand: (command) => commands.push(command) }, open, "personal", true);
		for (const group of navigationFor("personal", true).filter((page) => page.key.startsWith("sb-"))) {
			commands.find((command) => command.id === `open-page-${group.key}`)?.callback();
			expect(open).toHaveBeenLastCalledWith(group.key);
		}
		expect(open).toHaveBeenCalledTimes(5);
	});

	it("registers one command per navigable page except pages that already have one", () => {
		const keys = PRIMARY_NAVIGATION.flatMap((group) => group.children.map((child) => child.key)).filter((key) => key !== "chat");
		expect(pageCommands().map((command) => command.pageKey)).toEqual([...keys, "daily", "talos", "vault"]);
		expect(new Set(pageCommands().map((command) => command.id)).size).toBe(keys.length + 3);
	});

	it("names commands by page and group so the palette search finds either", () => {
		const byKey = Object.fromEntries(pageCommands().map((command) => [command.pageKey, command.name]));
		expect(byKey.inbox).toBe("打开收件箱（工作台）");
		expect(byKey.today).toBe("打开系统总览");
		expect(byKey.settings).toBe("打开设置");
	});

	it("opens the matching page when a command runs", () => {
		const commands: Array<{ id: string; callback: () => void }> = [];
		const open = vi.fn(async () => undefined);
		registerPageCommands({ addCommand: (command) => commands.push(command) }, open);
		commands.find((command) => command.id === "open-page-health")?.callback();
		expect(open).toHaveBeenCalledWith("health");
	});
});

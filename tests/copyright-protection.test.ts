import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	TALOS_COPYRIGHT_NOTICE,
	TALOS_LICENSE_NOTICE,
	TALOS_SETTINGS_COPYRIGHT_DESC,
} from "../src/legal";

const root = fileURLToPath(new URL("../", import.meta.url));

describe("TALOS personal-use source license notice", () => {
	it("keeps one exact user-facing notice across code, settings, and README", () => {
		expect(TALOS_COPYRIGHT_NOTICE).toBe(
			"Copyright © 2026 外脑玩家 Haaper."
		);
		expect(TALOS_LICENSE_NOTICE).toBe(
			"源码对个人非商业用途开放；商业使用须事先获得书面授权。"
		);
		expect(TALOS_SETTINGS_COPYRIGHT_DESC).toBe(
			TALOS_COPYRIGHT_NOTICE + " " + TALOS_LICENSE_NOTICE
		);

		const settings = readFileSync(root + "src/settings.ts", "utf8");
		const readme = readFileSync(root + "README.md", "utf8");
		expect(settings).toContain("TALOS_SETTINGS_COPYRIGHT_DESC");
		expect(settings).toContain("版权与授权");
		expect(readme).toContain(TALOS_COPYRIGHT_NOTICE);
		expect(readme).toContain(TALOS_LICENSE_NOTICE);
	});

	it("grants personal use while preserving the commercial authorization gate", () => {
		const license = readFileSync(root + "LICENSE", "utf8");
		for (const clause of [
			"Personal Non-Commercial Use",
			"Commercial Use",
			"repackaging",
			"resale",
			"white-label",
			"hosted service",
			"THIRD-PARTY-NOTICES.md",
		]) {
			expect(license).toContain(clause);
		}
		expect(license).toContain(
			"No Commercial Use is permitted under this License"
		);
		expect(license).toMatch(/not\s+an Open Source Initiative approved/);
	});
});

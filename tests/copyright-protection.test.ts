import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	TALOS_COPYRIGHT_NOTICE,
	TALOS_PROHIBITED_USE_NOTICE,
	TALOS_SETTINGS_COPYRIGHT_DESC,
} from "../src/legal";

const root = fileURLToPath(new URL("../", import.meta.url));

describe("TALOS copyright protection notice", () => {
	it("keeps one exact user-facing notice across code, settings, and README", () => {
		expect(TALOS_COPYRIGHT_NOTICE).toBe(
			"Copyright © 2026 外脑玩家 Haaper. All rights reserved."
		);
		expect(TALOS_PROHIBITED_USE_NOTICE).toContain(
			"不得复制、修改、重新打包、分发、转售、白标、托管或用于商业服务"
		);
		expect(TALOS_SETTINGS_COPYRIGHT_DESC).toBe(
			TALOS_COPYRIGHT_NOTICE + " " + TALOS_PROHIBITED_USE_NOTICE
		);

		const settings = readFileSync(root + "src/settings.ts", "utf8");
		const readme = readFileSync(root + "README.md", "utf8");
		expect(settings).toContain("TALOS_SETTINGS_COPYRIGHT_DESC");
		expect(settings).toContain("版权与授权");
		expect(readme).toContain(TALOS_COPYRIGHT_NOTICE);
		expect(readme).toContain(TALOS_PROHIBITED_USE_NOTICE);
	});

	it("lists prohibited uses and preserves mandatory-law exceptions", () => {
		const license = readFileSync(root + "LICENSE", "utf8");
		for (const clause of [
			"repackage",
			"resell",
			"white-label",
			"hosted service",
			"derivative product",
		]) {
			expect(license).toContain(clause);
		}
		expect(license).toMatch(/license or entitlement\s+control/);
		expect(license).toContain("rights that cannot lawfully be waived");
		expect(license).toContain(
			"Any use outside an applicable written license is unauthorized"
		);
	});
});

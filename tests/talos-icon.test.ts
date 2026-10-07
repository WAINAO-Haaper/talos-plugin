import { describe, expect, it } from "vitest";
import { TALOS_ICON_SVG } from "../src/talos-mark";

describe("TALOS plugin icon", () => {
	it("uses the current TalosBall static pose", () => {
		expect(TALOS_ICON_SVG).toContain("<title>TalosBall</title>");
		expect(TALOS_ICON_SVG).toContain('id="talos-ball-icon-body"');
		expect(TALOS_ICON_SVG).toContain('fill="#1A1A1A"');
		expect(TALOS_ICON_SVG).not.toContain("M180 247H249");
	});
});

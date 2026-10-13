import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 审批卡不能被输入框盖住：审批区不参与压缩、限高滚动，参数块单独限高（2026-10-08 真机发现）。
const root = fileURLToPath(new URL("../", import.meta.url));
const css = readFileSync(`${root}styles.ui-v2.css`, "utf8");

function rule(selector: string): string {
	const start = css.indexOf(`${selector} {`);
	expect(start, `missing rule: ${selector}`).toBeGreaterThan(-1);
	return css.slice(start, css.indexOf("}", start));
}

describe("approval card layout", () => {
	it("keeps the approval region from being squeezed under the composer", () => {
		const region = rule(".talos-native-chat .talos-native-approval-region");
		expect(region).toContain("flex: 0 0 auto");
		expect(region).toContain("overflow-y: auto");
		expect(region).toMatch(/max-height: \d+%/);
	});

	it("caps the raw parameter block so the action buttons stay on screen", () => {
		const desc = rule(".talos-native-chat .talos-native-approval-region .claudian-ask-approval-desc");
		expect(desc).toContain("max-height: 10em");
		expect(desc).toContain("overflow: auto");
		expect(rule(".talos-native-chat .talos-native-approval-region .claudian-input-nav-actions")).toContain("display: flex");
	});

	it("folds code and technical details so long requests cannot push the buttons away", () => {
		const view = readFileSync(`${root}src/agent-workbench/ui/native-conversation-view.ts`, "utf8");
		expect(view).toContain('code.className = "talos-approval-code"');
		expect(view).toContain('technical.className = "talos-approval-technical"');
		expect(view).toContain("card.append(title, facts, reason, ...folds, actions);");
		const code = rule(".talos-native-chat .talos-native-approval-region .talos-approval-code > pre");
		expect(code).toContain("max-height: 12em");
		expect(code).toContain("overflow: auto");
	});
});

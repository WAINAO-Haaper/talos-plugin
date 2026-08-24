import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const projectRoot = new URL("../", import.meta.url).pathname;
const inputController = readFileSync(
	`${projectRoot}src/quyuan/claudian/features/chat/controllers/InputController.ts`,
	"utf8"
);
const mainSource = readFileSync(`${projectRoot}src/main.ts`, "utf8");

describe("chat egress wiring", () => {
	it("audits normal and steered messages before they reach the Provider", () => {
		const queryAudit = inputController.indexOf(
			"await this.auditTalosChatEgress({"
		);
		const querySend = inputController.indexOf(
			"for await (const chunk of agentService.query"
		);
		const contextSent = inputController.indexOf(
			"fileContextManager?.markCurrentNoteSent();"
		);
		const steerAudit = inputController.lastIndexOf(
			"await this.auditTalosChatEgress({"
		);
		const steerSend = inputController.indexOf(
			"const accepted = await agentService.steer"
		);

		expect(queryAudit).toBeGreaterThan(-1);
		expect(contextSent).toBeGreaterThan(queryAudit);
		expect(querySend).toBeGreaterThan(queryAudit);
		expect(steerAudit).toBeGreaterThan(queryAudit);
		expect(steerSend).toBeGreaterThan(steerAudit);
	});

	it("fails closed when the TALOS egress audit bridge is missing", () => {
		// D-WP7 安全合同：审计桥缺失必须抛错阻断，不得静默放行。
		expect(inputController).not.toContain(
			"if (!bridge.auditQuyuanChatEgress) return;"
		);
		const guard = inputController.indexOf(
			"if (!bridge.auditQuyuanChatEgress) {"
		);
		const thrower = inputController.indexOf(
			"失败关闭策略阻止发送"
		);
		expect(guard).toBeGreaterThan(-1);
		expect(thrower).toBeGreaterThan(guard);
		const auditCall = inputController.indexOf(
			"bridge.auditQuyuanChatEgress({"
		);
		expect(auditCall).toBeGreaterThan(thrower);
	});

	it("persists metadata-only chat audits through the shared audit store", () => {
		expect(mainSource).toContain("preflightChatProviderEgress");
		expect(mainSource).toContain("createVaultProviderEgressAuditStore");
		expect(mainSource).toContain('namespace: "chat"');
	});
});

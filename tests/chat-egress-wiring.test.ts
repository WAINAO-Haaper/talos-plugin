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

	it("persists metadata-only chat audits through the shared audit store", () => {
		expect(mainSource).toContain("preflightChatProviderEgress");
		expect(mainSource).toContain("createVaultProviderEgressAuditStore");
		expect(mainSource).toContain('namespace: "chat"');
	});
});

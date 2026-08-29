import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const projectRoot = new URL("../", import.meta.url).pathname;
const inputController = readFileSync(
	`${projectRoot}src/agent-workbench/core/agent-execution-coordinator.ts`,
	"utf8"
);
const mainSource = readFileSync(`${projectRoot}src/main.ts`, "utf8");

describe("chat egress wiring", () => {
	it("audits normal and steered messages before they reach the Provider", () => {
		const queryAudit = inputController.indexOf("await this.options.preflightEgress?.({");
		const querySend = inputController.indexOf(
			"for await (const nativeEvent of lease.runtime.send(turn))"
		);
		const contextSent = inputController.indexOf(
			"await this.options.ledger.stage(staged);"
		);
		const steerAudit = inputController.lastIndexOf(
			"await this.options.preflightEgress?.({"
		);
		const steerSend = inputController.indexOf(
			"await runtime.steer({ turnId: active.turnId, text });"
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
		const guard = inputController.indexOf("if (preflight && !preflight.allowed)");
		const thrower = inputController.indexOf("Provider 出库隐私审计未通过");
		expect(guard).toBeGreaterThan(-1);
		expect(thrower).toBeGreaterThan(guard);
		expect(inputController).toContain("preflightEgress?");
	});

	it("persists metadata-only chat audits through the shared audit store", () => {
		expect(mainSource).toContain("preflightChatProviderEgress");
		expect(mainSource).toContain("createVaultProviderEgressAuditStore");
		expect(mainSource).toContain('namespace: "chat"');
		expect(mainSource).toContain("auditQuyuanProviderEgress");
		expect(mainSource).toContain("editorSourcePaths,");
		expect(mainSource).toContain("canvasSourcePaths,");
		expect(mainSource).toContain("hasBrowserContext:");
	});
});

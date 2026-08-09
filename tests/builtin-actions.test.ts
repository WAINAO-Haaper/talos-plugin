import { describe, expect, it, vi } from "vitest";
import { createBuiltinActionRegistry } from "../src/action-core/builtin-actions";
import type { TalosActionContext } from "../src/action-core/types";

function context(): TalosActionContext {
	return {
		signal: new AbortController().signal,
		taskId: "task-1",
	};
}

describe("createBuiltinActionRegistry", () => {
	it("registers the first stable action set with explicit risks", () => {
		const registry = createBuiltinActionRegistry({
			refreshStats: vi.fn(),
			vaultLint: vi.fn(),
			deepResearch: vi.fn(),
			createNote: vi.fn(),
			publishBackfill: vi.fn(),
			decideApproval: vi.fn(),
			decidePreference: vi.fn(),
		});

		expect(
			registry.list().map(({ id, risk }) => ({ id, risk }))
		).toEqual([
			{ id: "refresh-stats", risk: "A" },
			{ id: "vault-lint", risk: "A" },
			{ id: "deep-research", risk: "C" },
			{ id: "create-note", risk: "B" },
			{ id: "publish-backfill", risk: "C" },
			{ id: "decide-approval", risk: "C" },
			{ id: "decide-preference", risk: "C" },
		]);
	});

	it("delegates execution to injected existing behavior", async () => {
		const refreshStats = vi.fn().mockResolvedValue({ refreshed: true });
		const registry = createBuiltinActionRegistry({
			refreshStats,
			vaultLint: vi.fn(),
			deepResearch: vi.fn(),
			createNote: vi.fn(),
			publishBackfill: vi.fn(),
			decideApproval: vi.fn(),
			decidePreference: vi.fn(),
		});

		const result = await registry
			.get("refresh-stats")
			?.execute(context(), undefined);

		expect(refreshStats).toHaveBeenCalledOnce();
		expect(result).toEqual({ refreshed: true });
	});

	it("uses the configured note scope for the reversible create action", () => {
		const registry = createBuiltinActionRegistry(
			{
				refreshStats: vi.fn(),
				vaultLint: vi.fn(),
				deepResearch: vi.fn(),
				createNote: vi.fn(),
				publishBackfill: vi.fn(),
				decideApproval: vi.fn(),
				decidePreference: vi.fn(),
			},
			{ noteWriteScopes: ["00 收件箱/**", "01 日志/**"] }
		);

		const create = registry.get("create-note");
		expect(create?.reversible).toBe(true);
		expect(create?.writeScope).toEqual(["00 收件箱/**", "01 日志/**"]);
	});
});

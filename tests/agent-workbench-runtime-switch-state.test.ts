import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ProviderRegistry } from "../src/quyuan/claudian/core/providers/ProviderRegistry";
import type { ProviderId } from "../src/quyuan/claudian/core/providers/types";
import { getTabProviderId } from "../src/quyuan/claudian/features/chat/tabs/providerResolution";

const root = fileURLToPath(new URL("../", import.meta.url));

describe("TALOS blank-tab runtime switching", () => {
	beforeAll(() => {
		vi.spyOn(ProviderRegistry, "getRegisteredProviderIds").mockReturnValue(["claude", "codex", "ohmypi"]);
		vi.spyOn(ProviderRegistry, "isEnabled").mockReturnValue(true);
	});

	it.each(["claude", "codex", "ohmypi"] as ProviderId[])(
		"keeps the explicit %s runtime when its native model id is ambiguous",
		(providerId) => {
			const tab = {
				conversationId: null,
				service: null,
				providerId,
				lifecycleState: "blank" as const,
				draftModel: "default",
			};
			const plugin = {
				settings: { providerConfigs: { codex: { enabled: true } } },
				getConversationSync: () => null,
			};

			expect(getTabProviderId(tab, plugin as never)).toBe(providerId);
		},
	);

	it("persists the explicit runtime beside the runtime-native draft model", () => {
		const manager = readFileSync(`${root}src/quyuan/claudian/features/chat/tabs/TabManager.ts`, "utf8");
		const storage = readFileSync(`${root}src/quyuan/claudian/app/storage/SharedStorageService.ts`, "utf8");

		expect(manager).toContain("providerId: getTabProviderId(tab, this.plugin)");
		expect(manager).toContain("tabState.providerId");
		expect(storage).toContain("providerId?: ProviderId");
		expect(storage).toContain("const tabManagerState = this.readOnly");
	});
});

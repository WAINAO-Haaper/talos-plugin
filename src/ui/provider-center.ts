import type { ProviderConfigFile } from "../ai/provider/provider-config-store";
import type { ProviderFacade } from "../ai/provider/provider-facade";
import type { ProviderSecretStore } from "../ai/provider/provider-secret-store";
import type {
	ProviderCapability,
	TalosProviderKind,
} from "../ai/provider/types";

export type ProviderConnectionState =
	| "configured"
	| "missing-secret"
	| "local";

export interface ProviderCenterItem {
	id: string;
	name: string;
	kind: TalosProviderKind;
	model: string;
	capabilities: ProviderCapability[];
	connection: ProviderConnectionState;
	selected: boolean;
}

export interface ProviderCenterSnapshot {
	providers: ProviderCenterItem[];
}

export function providerIdForEngineSetting(engineProvider: string): string {
	if (engineProvider === "claude-cli") return "claude";
	if (engineProvider === "codex") return "openai-compatible";
	return engineProvider;
}

export function engineProviderSettingForProvider(providerId: string): string {
	if (providerId === "claude") return "claude-cli";
	if (providerId === "openai-compatible") return "codex";
	return providerId;
}

export function buildProviderCenterSnapshot(input: {
	facade: ProviderFacade;
	config: ProviderConfigFile;
	secrets: ProviderSecretStore | null;
}): ProviderCenterSnapshot {
	const available = new Set(
		input.facade.listProviders().map((provider) => provider.id)
	);
	return {
		providers: input.config.providers
			.filter((provider) => available.has(provider.id))
			.map((provider) => {
				const availability = input.facade.getAvailability(
					provider.id,
					provider.capabilities
				);
				const missing = new Set(availability.missing);
				return {
					id: provider.id,
					name: provider.name,
					kind: provider.kind,
					model: provider.model,
					capabilities: provider.capabilities.filter(
						(capability) => !missing.has(capability)
					),
					connection:
						provider.kind === "cli"
							? "local"
							: input.secrets?.has(provider.secretRef)
								? "configured"
								: "missing-secret",
					selected: provider.isDefault,
				};
			}),
	};
}

export interface ProviderCenterOptions {
	parent: HTMLElement;
	snapshot: ProviderCenterSnapshot;
	onSelectProvider(providerId: string): void | Promise<void>;
	onChangeModel(providerId: string, model: string): void | Promise<void>;
}

const CONNECTION_LABELS: Record<ProviderConnectionState, string> = {
	configured: "已配置",
	"missing-secret": "未配置密钥",
	local: "本机可用",
};

export class ProviderCenter {
	private root: HTMLElement | null = null;

	constructor(private readonly options: ProviderCenterOptions) {}

	mount(): HTMLElement {
		if (this.root) return this.root;
		const document = this.options.parent.ownerDocument;
		const root = document.createElement("section");
		root.className = "talos-provider-center";
		root.setAttribute("aria-label", "TALOS Provider 中心");

		for (const provider of this.options.snapshot.providers) {
			const row = document.createElement("article");
			row.className = "talos-provider-center__provider";
			row.setAttribute("data-provider-id", provider.id);
			if (provider.selected) row.setAttribute("data-selected", "true");

			const heading = document.createElement("h3");
			heading.textContent = provider.name;
			row.appendChild(heading);
			const status = document.createElement("p");
			status.textContent = `${provider.kind} · ${
				CONNECTION_LABELS[provider.connection]
			}${provider.selected ? " · 当前 Provider" : ""}`;
			row.appendChild(status);

			const capabilities = document.createElement("ul");
			capabilities.setAttribute("aria-label", `${provider.name} 能力`);
			for (const capability of provider.capabilities) {
				const item = document.createElement("li");
				item.textContent = capability;
				capabilities.appendChild(item);
			}
			row.appendChild(capabilities);

			const model = document.createElement("input");
			model.type = "text";
			model.value = provider.model;
			model.setAttribute("data-provider-model", provider.id);
			model.setAttribute("aria-label", `${provider.name} 模型`);
			row.appendChild(model);

			const saveModel = document.createElement("button");
			saveModel.type = "button";
			saveModel.textContent = "保存模型";
			saveModel.setAttribute("data-provider-model-save", provider.id);
			saveModel.addEventListener("click", () => {
				void this.options.onChangeModel(provider.id, model.value.trim());
			});
			row.appendChild(saveModel);

			const select = document.createElement("button");
			select.type = "button";
			select.textContent = provider.selected ? "当前使用" : "切换到此 Provider";
			select.disabled = provider.selected;
			select.setAttribute("data-provider-select", provider.id);
			select.addEventListener("click", () => {
				void this.options.onSelectProvider(provider.id);
			});
			row.appendChild(select);
			root.appendChild(row);
		}

		this.options.parent.appendChild(root);
		this.root = root;
		return root;
	}

	unmount(): void {
		this.root?.remove();
		this.root = null;
	}
}

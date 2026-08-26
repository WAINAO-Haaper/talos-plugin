import type { PermissionMode, WorkflowMode } from "../contracts/approval";
import type { ProviderProfile, RuntimeProfile } from "../contracts/provider-profile";
import { validateProviderProfile } from "../contracts/provider-profile";
import type { RuntimeId } from "../contracts/runtime-adapter";

export interface RuntimeSelection {
	runtimeId: RuntimeId;
	providerProfileId?: string;
	model?: string;
}

export interface WorkbenchSettings {
	schemaVersion: 1;
	runtimes: RuntimeProfile[];
	providers: ProviderProfile[];
	selection: RuntimeSelection;
	workflow: WorkflowMode;
	permission: PermissionMode;
}

export interface WorkbenchSettingsHost {
	read(): Promise<unknown>;
	write(value: WorkbenchSettings): Promise<void>;
}

export interface SecretReferenceStatus { has(secretRef: string): boolean; }

const SECRET_REF = /^[a-z0-9][a-z0-9-]{1,63}$/;
const SENSITIVE_KEY = /(?:api.?key|token|password|authorization|cookie|secret(?!Ref))/i;
const SENSITIVE_VALUE = /(?:bearer\s+|sk-[a-z0-9_-]{12,}|authorization\s*:)/i;

export function assertSafeWorkbenchSettings(value: unknown, key = ""): void {
	if (SENSITIVE_KEY.test(key)) throw new Error(`设置包含禁止字段：${key}`);
	if (typeof value === "string" && SENSITIVE_VALUE.test(value)) throw new Error("设置包含疑似明文凭据");
	if (Array.isArray(value)) for (const item of value) assertSafeWorkbenchSettings(item, key);
	else if (value && typeof value === "object") for (const [childKey, child] of Object.entries(value)) assertSafeWorkbenchSettings(child, childKey);
}

function defaults(): WorkbenchSettings {
	return { schemaVersion: 1, runtimes: [], providers: [], selection: { runtimeId: "codex" }, workflow: "plan", permission: "ask" };
}

function normalizeSelection(selection: RuntimeSelection, providers: ProviderProfile[]): RuntimeSelection {
	if (!selection || !["claude", "codex", "ohmypi"].includes(selection.runtimeId)) throw new Error("runtime selection 无效");
	if (!selection.providerProfileId) {
		return {
			runtimeId: selection.runtimeId,
			...(selection.model ? { model: selection.model } : {}),
		};
	}
	const provider = providers.find((candidate) => candidate.enabled && candidate.id === selection.providerProfileId && candidate.runtimeId === selection.runtimeId);
	if (!provider) return { runtimeId: selection.runtimeId };
	return {
		runtimeId: selection.runtimeId,
		providerProfileId: provider.id,
		...(selection.model && provider.models.includes(selection.model) ? { model: selection.model } : {}),
	};
}

export class WorkbenchSettingsStore {
	constructor(private readonly host: WorkbenchSettingsHost, private readonly secrets: SecretReferenceStatus) {}

	async load(): Promise<WorkbenchSettings> {
		const raw = await this.host.read();
		if (!raw) return defaults();
		assertSafeWorkbenchSettings(raw);
		const value = raw as WorkbenchSettings;
		if (value.schemaVersion !== 1 || !Array.isArray(value.runtimes) || !Array.isArray(value.providers)) throw new Error("工作台设置 schema 无效");
		const providers = value.providers.map((profile) => validateProviderProfile(profile));
		for (const profile of providers) {
			if (profile.secretRef && !SECRET_REF.test(profile.secretRef)) throw new Error("secretRef 无效");
		}
		return { ...value, providers, selection: normalizeSelection(value.selection, providers) };
	}

	async save(settings: WorkbenchSettings): Promise<void> {
		assertSafeWorkbenchSettings(settings);
		const providers = settings.providers.map((profile) => validateProviderProfile(profile));
		for (const profile of providers) if (profile.secretRef && !SECRET_REF.test(profile.secretRef)) throw new Error("secretRef 无效");
		await this.host.write({ ...settings, providers, selection: normalizeSelection(settings.selection, providers) });
	}

	authenticationStatus(profile: ProviderProfile): "not-required" | "configured" | "missing" {
		if (!profile.secretRef) return "not-required";
		return this.secrets.has(profile.secretRef) ? "configured" : "missing";
	}
}

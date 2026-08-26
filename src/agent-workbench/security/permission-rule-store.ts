import type { ActionKind } from "../contracts/approval";
import type { RuntimeId } from "../contracts/runtime-adapter";

export interface PermissionRule {
	id: string;
	runtimeId: RuntimeId;
	kind: ActionKind;
	target: string;
	scope: "conversation" | "persistent";
	conversationId?: string;
	createdAt: string;
}

export interface PermissionRuleHost {
	read(): Promise<unknown>;
	write(rules: PermissionRule[]): Promise<void>;
}

export class PermissionRuleStore {
	private rules: PermissionRule[] | null = null;
	constructor(private readonly host: PermissionRuleHost) {}

	private async load(): Promise<PermissionRule[]> {
		if (this.rules) return this.rules;
		const value = await this.host.read();
		this.rules = Array.isArray(value) ? value.filter((item): item is PermissionRule => Boolean(
			item && typeof item === "object" && typeof (item as PermissionRule).id === "string",
		)) : [];
		return this.rules;
	}

	async list(): Promise<PermissionRule[]> { return [...await this.load()]; }

	async add(rule: PermissionRule): Promise<void> {
		const rules = await this.load();
		const next = [...rules.filter((item) => item.id !== rule.id), rule];
		await this.host.write(next);
		this.rules = next;
	}

	async revoke(id: string): Promise<void> {
		const next = (await this.load()).filter((item) => item.id !== id);
		await this.host.write(next);
		this.rules = next;
	}

	async reset(): Promise<void> { await this.host.write([]); this.rules = []; }

	async match(input: { runtimeId: RuntimeId; kind: ActionKind; target: string; conversationId?: string }): Promise<PermissionRule | undefined> {
		return (await this.load()).find((rule) => rule.runtimeId === input.runtimeId
			&& rule.kind === input.kind
			&& rule.target === input.target
			&& (rule.scope === "persistent" || rule.conversationId === input.conversationId));
	}
}

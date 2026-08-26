import type { NativeSessionBinding, RuntimeId } from "../contracts/runtime-adapter";

export interface HostScopedStore {
	read(): Promise<Record<string, unknown> | null>;
	write(value: Record<string, unknown>): Promise<void>;
}

export class RuntimeBindingStore {
	constructor(private readonly store: HostScopedStore) {}

	async get(conversationId: string, runtimeId: RuntimeId): Promise<NativeSessionBinding | null> {
		const state = await this.store.read();
		const bindings = state?.bindings;
		if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) return null;
		const value = (bindings as Record<string, unknown>)[`${conversationId}:${runtimeId}`];
		if (!value || typeof value !== "object" || Array.isArray(value)) return null;
		return value as NativeSessionBinding;
	}

	async set(conversationId: string, binding: NativeSessionBinding): Promise<void> {
		const state = (await this.store.read()) ?? {};
		const current = state.bindings;
		const bindings = current && typeof current === "object" && !Array.isArray(current)
			? { ...(current as Record<string, unknown>) }
			: {};
		bindings[`${conversationId}:${binding.runtimeId}`] = binding;
		await this.store.write({ ...state, bindings });
	}
}

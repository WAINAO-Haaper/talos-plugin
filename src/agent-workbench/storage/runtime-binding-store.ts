import type { NativeSessionBinding, RuntimeId } from "../contracts/runtime-adapter";

export interface HostScopedStore {
	read(): Promise<Record<string, unknown> | null>;
	write(value: Record<string, unknown>): Promise<void>;
}

function bindingKey(
	conversationId: string,
	runtimeId: RuntimeId,
	providerProfileId?: string
): string {
	return `${conversationId}:${runtimeId}:${providerProfileId ?? "native"}`;
}

const BINDING_COORDINATION = new WeakMap<HostScopedStore, { tail: Promise<void> }>();

export class RuntimeBindingStore {
	private readonly coordination: { tail: Promise<void> };

	constructor(private readonly store: HostScopedStore) {
		let coordination = BINDING_COORDINATION.get(store);
		if (!coordination) {
			coordination = { tail: Promise.resolve() };
			BINDING_COORDINATION.set(store, coordination);
		}
		this.coordination = coordination;
	}

	private mutate(operation: () => Promise<void>): Promise<void> {
		const result = this.coordination.tail.then(operation);
		this.coordination.tail = result.then(() => undefined, () => undefined);
		return result;
	}

	async get(
		conversationId: string,
		runtimeId: RuntimeId,
		providerProfileId?: string
	): Promise<NativeSessionBinding | null> {
		await this.coordination.tail;
		const state = await this.store.read();
		const bindings = state?.bindings;
		if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) return null;
		const entries = bindings as Record<string, unknown>;
		const value =
			entries[bindingKey(conversationId, runtimeId, providerProfileId)]
			?? (!providerProfileId
				? entries[`${conversationId}:${runtimeId}`]
				: undefined);
		if (!value || typeof value !== "object" || Array.isArray(value)) return null;
		return value as NativeSessionBinding;
	}

	async set(conversationId: string, binding: NativeSessionBinding): Promise<void> {
		return this.mutate(async () => {
			const state = (await this.store.read()) ?? {};
			const current = state.bindings;
			const bindings = current && typeof current === "object" && !Array.isArray(current)
				? { ...(current as Record<string, unknown>) }
				: {};
			bindings[bindingKey(conversationId, binding.runtimeId, binding.providerProfileId)] = binding;
			await this.store.write({ ...state, bindings });
		});
	}

	async remove(
		conversationId: string,
		runtimeId: RuntimeId,
		providerProfileId?: string
	): Promise<void> {
		return this.mutate(async () => {
			const state = (await this.store.read()) ?? {};
			const current = state.bindings;
			if (!current || typeof current !== "object" || Array.isArray(current)) return;
			const bindings = { ...(current as Record<string, unknown>) };
			delete bindings[bindingKey(conversationId, runtimeId, providerProfileId)];
			await this.store.write({ ...state, bindings });
		});
	}
}

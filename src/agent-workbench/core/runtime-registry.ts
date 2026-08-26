import type { AgentRuntimeAdapter, RuntimeId } from "../contracts/runtime-adapter";

export class RuntimeRegistry {
	private readonly adapters = new Map<RuntimeId, AgentRuntimeAdapter>();

	constructor(adapters: AgentRuntimeAdapter[] = []) {
		for (const adapter of adapters) this.register(adapter);
	}

	get size(): number {
		return this.adapters.size;
	}

	register(adapter: AgentRuntimeAdapter): void {
		if (this.adapters.has(adapter.id)) {
			throw new Error(`重复注册智能体运行时：${adapter.id}`);
		}
		this.adapters.set(adapter.id, adapter);
	}

	has(id: RuntimeId): boolean {
		return this.adapters.has(id);
	}

	get(id: RuntimeId): AgentRuntimeAdapter {
		const adapter = this.adapters.get(id);
		if (!adapter) throw new Error(`智能体运行时未注册：${id}`);
		return adapter;
	}

	values(): AgentRuntimeAdapter[] {
		return [...this.adapters.values()];
	}
}

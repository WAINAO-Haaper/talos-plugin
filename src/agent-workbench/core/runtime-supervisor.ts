import type { AgentRuntimeAdapter, RuntimeHealth, RuntimeId, RuntimeProbe } from "../contracts/runtime-adapter";

export class RuntimeSupervisor {
	private readonly states = new Map<RuntimeId, RuntimeProbe>();

	async probe(adapter: AgentRuntimeAdapter, signal?: AbortSignal): Promise<RuntimeProbe> {
		this.states.set(adapter.id, { runtimeId: adapter.id, status: "probing" });
		try {
			const result = await adapter.probe(signal);
			this.states.set(adapter.id, result);
			return result;
		} catch (error) {
			const result: RuntimeProbe = {
				runtimeId: adapter.id,
				status: "crashed",
				reason: error instanceof Error ? error.message : String(error),
			};
			this.states.set(adapter.id, result);
			return result;
		}
	}

	status(id: RuntimeId): RuntimeHealth {
		return this.states.get(id)?.status ?? "unknown";
	}
}

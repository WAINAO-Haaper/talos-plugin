import type { ActionRequest } from "../contracts/approval";
import type { RuntimeId } from "../contracts/runtime-adapter";

export class ProviderEgressBridge {
	create(runtimeId: RuntimeId, endpoint: string, actionId: string): ActionRequest {
		const url = new URL(endpoint);
		if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
			throw new Error("Provider endpoint 不安全");
		}
		return {
			actionId,
			runtimeId,
			kind: "network",
			targets: [],
			network: { protocol: url.protocol.slice(0, -1), host: url.hostname, port: url.port ? Number(url.port) : undefined },
			reason: "provider-egress",
			destructive: false,
		};
	}
}

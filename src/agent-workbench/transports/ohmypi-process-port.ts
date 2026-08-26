import type { RuntimeProbe } from "../contracts/runtime-adapter";
import type { OhMyPiRpcPort } from "../adapters/ohmypi/ohmypi-rpc-adapter";
import type { ProtocolFrame } from "../adapters/shared/protocol-frame";
import type { OmpRpcConnection, OmpRpcFrame } from "./omp-rpc-connection";

function protocolFrame(frame: OmpRpcFrame): ProtocolFrame {
	return { id: frame.id, method: frame.type, params: frame };
}

export class OhMyPiProcessPort implements OhMyPiRpcPort {
	constructor(private readonly connection: OmpRpcConnection, private readonly probeRuntime: (signal?: AbortSignal) => Promise<RuntimeProbe>) {}
	probe(signal?: AbortSignal) { return this.probeRuntime(signal); }
	request<T>(method: string, params: Record<string, unknown>) { return this.connection.request<T>(method, params); }
	async *prompt(params: Record<string, unknown>, signal?: AbortSignal): AsyncIterable<ProtocolFrame> {
		const frames = this.connection.subscribe();
		await this.connection.request("prompt", { message: params.text, streamingBehavior: params.streamingBehavior });
		for await (const frame of frames) {
			if (signal?.aborted) break;
			yield protocolFrame(frame);
			if (frame.type === "agent_end") break;
		}
	}
	async respond(requestId: string, response: Record<string, unknown>) { await this.connection.respond(requestId, response); }
	async abort() { await this.connection.request("abort"); }
	close() { return this.connection.close(); }
}

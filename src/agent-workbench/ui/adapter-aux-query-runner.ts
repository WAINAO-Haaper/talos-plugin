import type { AgentRuntimeAdapter, RuntimeId } from "../contracts/runtime-adapter";
import type { AgentWorkbenchService } from "../core/agent-workbench-service";
import type { AuxQueryConfig, AuxQueryRunner } from "../../quyuan/claudian/core/auxiliary/AuxQueryRunner";

export class AdapterAuxQueryRunner implements AuxQueryRunner {
	private adapter: AgentRuntimeAdapter | null = null;
	private sessionId: string | null = null;
	constructor(private readonly service: AgentWorkbenchService, private readonly runtimeId: RuntimeId, private readonly vaultRoot: string) {}
	async query(config: AuxQueryConfig, prompt: string): Promise<string> {
		this.adapter ??= await this.service.createRuntime(this.runtimeId, { vaultRoot: this.vaultRoot, permissionMode: "ask", approve: async () => "deny" });
		if (!this.sessionId) this.sessionId = (await this.adapter.createSession({ conversationId: crypto.randomUUID(), vaultRoot: this.vaultRoot, model: config.model, initialContext: config.systemPrompt })).sessionId;
		let text = "";
		for await (const event of this.adapter.send({ conversationId: this.sessionId, turnId: crypto.randomUUID(), text: `${config.systemPrompt}\n\n${prompt}`, model: config.model, workflow: "plan", signal: config.abortController?.signal })) {
			if (event.type === "assistant.delta") { text += typeof event.payload.text === "string" ? event.payload.text : typeof event.payload.delta === "string" ? event.payload.delta : ""; config.onTextChunk?.(text); }
			if (event.type === "assistant.final" && !text) { text = typeof event.payload.text === "string" ? event.payload.text : ""; config.onTextChunk?.(text); }
			if (event.type === "error") throw new Error(typeof event.payload.message === "string" ? event.payload.message : "辅助任务失败");
		}
		return text;
	}
	reset(): void { void this.adapter?.dispose(); this.adapter = null; this.sessionId = null; }
}

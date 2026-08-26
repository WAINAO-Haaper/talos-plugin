import { describe, expect, it } from "vitest";
import { createAgentEvent } from "../src/agent-workbench/contracts/agent-events";
import type {
	AgentRuntimeAdapter,
	CreateSessionInput,
	NativeSessionBinding,
	RuntimeTurn,
} from "../src/agent-workbench/contracts/runtime-adapter";
import { unavailableCapabilities } from "../src/agent-workbench/contracts/runtime-capabilities";
import { ConversationService } from "../src/agent-workbench/core/conversation-service";
import { RuntimeRegistry } from "../src/agent-workbench/core/runtime-registry";
import { WorkbenchController } from "../src/agent-workbench/core/workbench-controller";
import {
	PortableConversationStore,
	type PortableFileAdapter,
} from "../src/agent-workbench/storage/portable-conversation-store";
import { RuntimeBindingStore } from "../src/agent-workbench/storage/runtime-binding-store";

class MemoryFiles implements PortableFileAdapter {
	files = new Map<string, string>(); folders = new Set<string>();
	async exists(p: string) { return this.files.has(p) || this.folders.has(p); }
	async read(p: string) { const value = this.files.get(p); if (value === undefined) throw new Error("missing"); return value; }
	async write(p: string, v: string) { this.files.set(p, v); }
	async rename(a: string, b: string) { this.files.set(b, await this.read(a)); this.files.delete(a); }
	async replace(a: string, b: string) { await this.rename(a, b); }
	async remove(p: string) { this.files.delete(p); }
	async mkdir(p: string) { this.folders.add(p); }
	async list(p: string) {
		const prefix = `${p}/`; const files = new Set<string>(); const folders = new Set<string>();
		for (const key of [...this.files.keys(), ...this.folders]) {
			if (!key.startsWith(prefix)) continue;
			const suffix = key.slice(prefix.length); const slash = suffix.indexOf("/");
			if (slash < 0 && this.files.has(key)) files.add(suffix); else if (slash >= 0) folders.add(suffix.slice(0, slash)); else if (suffix) folders.add(suffix);
		}
		return { files: [...files], folders: [...folders] };
	}
}

class FakeRuntime implements AgentRuntimeAdapter {
	readonly resumed: NativeSessionBinding[] = [];
	readonly created: CreateSessionInput[] = [];
	readonly synchronized: string[] = [];
	constructor(readonly id: "claude" | "codex" | "ohmypi") {}
	async probe() { return { runtimeId: this.id, status: "ready" as const }; }
	async listModels() { return []; }
	async createSession(input: CreateSessionInput) {
		this.created.push(input);
		return { runtimeId: this.id, sessionId: `${this.id}-session` };
	}
	async resumeSession(binding: NativeSessionBinding) { this.resumed.push(binding); }
	async synchronizeContext(input: { context: string }) { this.synchronized.push(input.context); }
	async *send(turn: RuntimeTurn) {
		const duplicate = createAgentEvent({
			eventId: `${turn.turnId}:final`, conversationId: turn.conversationId,
			turnId: turn.turnId, runtimeId: this.id, type: "assistant.final",
			timestamp: "2026-08-26T00:00:00.000Z", payload: { text: this.id },
		});
		yield duplicate;
		yield duplicate;
	}
	async cancel() {}
	async dispose() {}
	capabilities() { return unavailableCapabilities(); }
}

describe("WorkbenchController", () => {
	it("creates isolated native bindings, handoffs once and resumes on return", async () => {
		const files = new MemoryFiles();
		let sequence = 0;
		const conversations = new ConversationService(
			new PortableConversationStore(files),
			{ now: () => `2026-08-26T00:00:0${sequence}.000Z`, id: () => `id-${++sequence}` },
		);
		const codex = new FakeRuntime("codex");
		const claude = new FakeRuntime("claude");
		const ohmypi = new FakeRuntime("ohmypi");
		const runtimes = new RuntimeRegistry([codex, claude, ohmypi]);
		let hostState: Record<string, unknown> | null = null;
		const bindings = new RuntimeBindingStore({
			read: async () => hostState,
			write: async (value) => { hostState = value; },
		});
		const manifest = await conversations.create("handoff", "codex");
		const controller = new WorkbenchController(
			conversations,
			runtimes,
			bindings,
			{ vaultRoot: async () => "/isolated/test-vault" },
		);
		await controller.open(manifest);
		expect(codex.created).toHaveLength(1);
		expect(await controller.send("first", "plan")).toHaveLength(1);
		await controller.switchRuntime("claude");
		expect(claude.created).toHaveLength(1);
		expect(claude.created[0]?.vaultRoot).toBe("/isolated/test-vault");
		expect(await controller.send("second", "execute")).toHaveLength(1);
		await controller.switchRuntime("ohmypi");
		expect(ohmypi.created).toHaveLength(1);
		expect(await controller.send("third", "plan")).toHaveLength(1);
		await controller.switchRuntime("codex");
		expect(codex.resumed).toHaveLength(1);
		expect(codex.synchronized).toHaveLength(1);
		await controller.switchRuntime("claude");
		expect(claude.resumed).toHaveLength(1);
		const projection = await conversations.store.load(manifest.conversationId);
		expect(projection.events.filter((item) => item.type === "handoff.created")).toHaveLength(4);
		expect(projection.events.filter((item) => item.type === "assistant.final")).toHaveLength(3);
	});
});

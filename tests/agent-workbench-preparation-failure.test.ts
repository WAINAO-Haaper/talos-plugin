import { describe, expect, it } from "vitest";
import { AgentWorkbenchService } from "../src/agent-workbench/core/agent-workbench-service";
import { ConversationService } from "../src/agent-workbench/core/conversation-service";
import { WorkbenchConversationCoordinator } from "../src/agent-workbench/core/workbench-conversation-coordinator";
import { ConversationInputLedger } from "../src/agent-workbench/storage/conversation-input-ledger";
import {
	PortableConversationStore,
	type PortableFileAdapter,
} from "../src/agent-workbench/storage/portable-conversation-store";
import { RuntimeBindingStore } from "../src/agent-workbench/storage/runtime-binding-store";

class MemoryFiles implements PortableFileAdapter {
	readonly files = new Map<string, string>();
	readonly folders = new Set<string>();
	async exists(target: string) { return this.files.has(target) || this.folders.has(target); }
	async read(target: string) {
		const value = this.files.get(target);
		if (value === undefined) throw new Error(`missing: ${target}`);
		return value;
	}
	async write(target: string, value: string) { this.files.set(target, value); }
	async rename(from: string, to: string) {
		const value = await this.read(from);
		this.files.set(to, value);
		this.files.delete(from);
	}
	async replace(from: string, to: string) { await this.rename(from, to); }
	async remove(target: string) { this.files.delete(target); }
	async rmdir(target: string, recursive: boolean) {
		const prefix = `${target}/`;
		const children = [...this.files.keys(), ...this.folders]
			.filter((candidate) => candidate.startsWith(prefix));
		if (!recursive && children.length > 0) throw new Error("directory not empty");
		for (const child of children) {
			this.files.delete(child);
			this.folders.delete(child);
		}
		this.folders.delete(target);
	}
	async mkdir(target: string) { this.folders.add(target); }
	async list(target: string) {
		const prefix = `${target}/`;
		const files = new Set<string>();
		const folders = new Set<string>();
		for (const candidate of [...this.files.keys(), ...this.folders]) {
			if (!candidate.startsWith(prefix)) continue;
			const suffix = candidate.slice(prefix.length);
			const slash = suffix.indexOf("/");
			if (slash < 0) {
				if (this.files.has(candidate)) files.add(suffix);
				else folders.add(suffix);
			} else {
				folders.add(suffix.slice(0, slash));
			}
		}
		return { files: [...files], folders: [...folders] };
	}
}

describe("Agent workbench preparation failures", () => {
	it("persists an actionable pre-acceptance error without storing the rejected prompt", async () => {
		const files = new MemoryFiles();
		const conversations = new ConversationService(new PortableConversationStore(files));
		let bindings: Record<string, unknown> | null = null;
		let ledgerState: unknown = null;
		const coordinator = new WorkbenchConversationCoordinator(
			conversations,
			new RuntimeBindingStore({
				read: async () => bindings,
				write: async (value) => { bindings = structuredClone(value); },
			}),
		);
		const service = new AgentWorkbenchService({
			conversationCoordinator: coordinator,
			inputLedger: new ConversationInputLedger({
				read: async () => ledgerState,
				write: async (value) => { ledgerState = structuredClone(value); },
			}),
			vaultRoot: "/synthetic/vault",
			createRuntime: async () => {
				throw new Error("Windows 当前缺少可验证的 CLI 隔离，本机智能体 Execute 已失败关闭。请配置 API Provider。");
			},
		});
		await service.initialize();
		const conversation = await service.createConversation();
		const events = [];
		for await (const event of service.executeConversationTurn(
			conversation.conversationId,
			{
				input: [{ type: "text", text: "do not lose this draft" }],
				toolPolicy: { kind: "read-only" },
			},
		)) events.push(event);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "error",
			payload: {
				accepted: false,
				recoverable: true,
				action: "检查当前 Provider 配置后重试",
			},
		});
		const stored = await service.loadConversation(conversation.conversationId);
		expect(stored.events.map((event) => event.type)).toEqual(["error"]);
		expect(JSON.stringify(stored.events)).not.toContain("do not lose this draft");
	});
});

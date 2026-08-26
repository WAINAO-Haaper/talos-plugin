import { projectMessages } from "../storage/conversation-projection";
import { ConversationService } from "./conversation-service";

export interface VaultExportHost { write(relativePath: string, content: string): Promise<void>; }

export class ConversationManagementService {
	constructor(private readonly conversations: ConversationService, private readonly exports: VaultExportHost) {}

	async search(query: string) {
		const needle = query.trim().toLocaleLowerCase();
		const output = [];
		for (const manifest of await this.conversations.store.list()) {
			if (!needle || manifest.title.toLocaleLowerCase().includes(needle)) { output.push(manifest); continue; }
			const projection = await this.conversations.store.load(manifest.conversationId);
			if (projectMessages(projection.events).some((message) => message.text.toLocaleLowerCase().includes(needle))) output.push(manifest);
		}
		return output;
	}

	async exportPreview(conversationId: string, relativePath: string): Promise<void> {
		if (!relativePath || relativePath.startsWith("/") || relativePath.includes("..") || !relativePath.endsWith(".md")) throw new Error("导出目标必须是 Vault 内 Markdown 相对路径");
		const projection = await this.conversations.store.load(conversationId);
		const lines = [`# ${projection.manifest.title}`, ""];
		for (const message of projectMessages(projection.events)) {
			lines.push(`## ${message.role}`, "", message.text, "");
		}
		await this.exports.write(relativePath, `${lines.join("\n")}\n`);
	}
}

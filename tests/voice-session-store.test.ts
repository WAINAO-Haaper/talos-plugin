import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	VoiceSessionStore,
	type VoiceSessionPersistence,
	type VoiceSessionSnapshot,
} from "../src/quyuan/voice-session-store";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const voicePanelSource = readFileSync(
	`${projectRoot}src/quyuan/voice-panel.ts`,
	"utf8"
);
const voiceDriverSource = readFileSync(
	`${projectRoot}src/quyuan/native-voice-driver.ts`,
	"utf8"
);
const viewSource = readFileSync(`${projectRoot}src/view.ts`, "utf8");

function memoryPersistence(
	initial = ""
): VoiceSessionPersistence & { value: string } {
	return {
		value: initial,
		read() {
			return this.value;
		},
		write(value) {
			this.value = value;
		},
	};
}

describe("VoiceSessionStore", () => {
	it("uses only the voice namespace and ignores chat history", async () => {
		const persistence = memoryPersistence(
			JSON.stringify({
				version: 1,
				namespace: "chat",
				messages: [
					{
						id: "chat-1",
						role: "user",
						text: "文字工作台里的问题",
						modality: "text",
						createdAt: 1,
					},
				],
				taskEvidence: [],
				updatedAt: 1,
			})
		);
		const store = new VoiceSessionStore(persistence);

		await store.load();

		expect(store.namespace).toBe("voice");
		expect(store.snapshot().messages).toEqual([]);
		expect(store.contextMessages()).toEqual([]);
	});

	it("persists voice-page text and speech in one isolated voice session", async () => {
		const persistence = memoryPersistence();
		const store = new VoiceSessionStore(persistence, () => 100);

		await store.appendMessage({
			id: "voice-user",
			role: "user",
			text: "语音识别内容",
			modality: "speech",
			createdAt: 90,
		});
		await store.appendMessage({
			id: "voice-assistant",
			role: "assistant",
			text: "语音页的文字回复",
			modality: "text",
			createdAt: 100,
		});

		expect(JSON.parse(persistence.value)).toMatchObject({
			namespace: "voice",
			messages: [
				{ id: "voice-user", modality: "speech" },
				{ id: "voice-assistant", modality: "text" },
			],
		});
		expect(store.contextMessages()).toEqual([
			{ role: "user", text: "语音识别内容" },
			{ role: "assistant", text: "语音页的文字回复" },
		]);
	});

	it("shares only task ids and audit evidence, never task bodies", async () => {
		const persistence = memoryPersistence();
		const store = new VoiceSessionStore(persistence);

		await store.recordTaskEvidence({
			taskId: "task-42",
			state: "succeeded",
			auditEvidence: "audit:sha256:abc",
			taskBody: "绝不能注入语音上下文的私有任务正文",
		});

		const snapshot = store.snapshot();
		expect(snapshot.taskEvidence).toEqual([
			{
				taskId: "task-42",
				state: "succeeded",
				auditEvidence: "audit:sha256:abc",
			},
		]);
		expect(persistence.value).not.toContain("私有任务正文");
		expect(JSON.stringify(store.contextMessages())).not.toContain("task-42");
	});

	it("recovers the voice session after a plugin restart", async () => {
		const persistence = memoryPersistence();
		const beforeRestart = new VoiceSessionStore(persistence);
		await beforeRestart.appendMessage({
			id: "voice-1",
			role: "user",
			text: "继续上一次语音任务",
			modality: "speech",
			createdAt: 1,
		});
		await beforeRestart.setTranscriptDraft("尚未发送的字幕");

		const afterRestart = new VoiceSessionStore(persistence);
		await afterRestart.load();

		expect(afterRestart.snapshot()).toMatchObject({
			namespace: "voice",
			transcriptDraft: "尚未发送的字幕",
			messages: [{ id: "voice-1", text: "继续上一次语音任务" }],
		});
	});

	it("serializes snapshot writes so an older slow write cannot overwrite a newer state", async () => {
		const writes: string[] = [];
		let activeWrites = 0;
		let maxActiveWrites = 0;
		let releaseFirst: (() => void) | null = null;
		const firstBlocked = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const store = new VoiceSessionStore({
			read: () => "",
			write: async (value) => {
				activeWrites += 1;
				maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
				writes.push(value);
				if (writes.length === 1) await firstBlocked;
				activeWrites -= 1;
			},
		});

		const first = store.appendMessage({
			id: "first",
			role: "user",
			text: "first",
			modality: "speech",
			createdAt: 1,
		});
		await Promise.resolve();
		const second = store.appendMessage({
			id: "second",
			role: "assistant",
			text: "second",
			modality: "speech",
			createdAt: 2,
		});
		await Promise.resolve();

		expect(writes).toHaveLength(1);
		expect(maxActiveWrites).toBe(1);
		releaseFirst?.();
		await Promise.all([first, second]);
		expect(writes).toHaveLength(2);
		expect(maxActiveWrites).toBe(1);
		const persisted = JSON.parse(writes[1] ?? "{}") as VoiceSessionSnapshot;
		expect(persisted.messages.map((message) => message.id)).toEqual(["first", "second"]);
	});

	it("migrates only explicitly namespaced legacy voice data", async () => {
		const persistence = memoryPersistence() as VoiceSessionPersistence & {
			value: string;
			readLegacy(): string;
		};
		persistence.readLegacy = () =>
			JSON.stringify({
				version: 1,
				namespace: "voice",
				messages: [
					{
						id: "legacy-voice",
						role: "user",
						text: "旧语音页内容",
						modality: "speech",
						createdAt: 1,
					},
				],
				taskEvidence: [],
				updatedAt: 1,
			});
		const store = new VoiceSessionStore(persistence);

		await store.load();

		expect(store.snapshot().messages[0]?.text).toBe("旧语音页内容");
		expect(persistence.value).toContain('"namespace":"voice"');
	});

	it("does not migrate a legacy chat tab into voice", async () => {
		const persistence = memoryPersistence() as VoiceSessionPersistence & {
			value: string;
			readLegacy(): string;
		};
		persistence.readLegacy = () =>
			JSON.stringify({
				version: 1,
				namespace: "chat",
				messages: [
					{
						id: "legacy-chat",
						role: "user",
						text: "旧文字 tab 内容",
						modality: "text",
						createdAt: 1,
					},
				],
				taskEvidence: [],
				updatedAt: 1,
			});
		const store = new VoiceSessionStore(persistence);

		await store.load();

		expect(store.snapshot().messages).toEqual([]);
		expect(persistence.value).toBe("");
	});

	it("keeps the shipped voice page on the isolated store and shared gateway", () => {
		expect(voicePanelSource).toContain(
			'root.setAttribute("data-session-namespace", "voice")'
		);
		expect(voicePanelSource).toContain(
			"readLegacy: () => this.settings.jarvisTabsJson"
		);
		expect(voicePanelSource).toContain("fallbackToPushToTalk");
		expect(voiceDriverSource).toContain("evaluateVoiceToolRisk");
		expect(voiceDriverSource).toContain("resolveVoiceToolApproval");
		expect(voiceDriverSource).not.toContain(
			"histories: Record<InteractionChannel"
		);
		expect(viewSource).toContain("new QuyuanVoicePanel");
	});
});

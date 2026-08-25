export const VOICE_SESSION_NAMESPACE = "voice" as const;

export type VoiceSessionRole = "user" | "assistant";
export type VoiceInputModality = "speech" | "text";

export interface VoiceSessionMessage {
	id: string;
	role: VoiceSessionRole;
	text: string;
	modality: VoiceInputModality;
	createdAt: number;
}

export interface VoiceTaskEvidence {
	taskId: string;
	state: string;
	auditEvidence: string;
}

export interface VoiceTaskEvidenceInput extends VoiceTaskEvidence {
	/**
	 * Callers may receive a task body from the shared task core, but the voice
	 * session deliberately never stores or injects it.
	 */
	taskBody?: string;
}

export interface VoiceSessionSnapshot {
	version: 1;
	namespace: typeof VOICE_SESSION_NAMESPACE;
	messages: VoiceSessionMessage[];
	transcriptDraft: string;
	taskEvidence: VoiceTaskEvidence[];
	updatedAt: number;
}

export interface VoiceSessionPersistence {
	read(): string | Promise<string>;
	write(value: string): void | Promise<void>;
	readLegacy?(): string | Promise<string>;
}

const MAX_MESSAGES = 40;
const MAX_TASK_EVIDENCE = 50;

function emptySnapshot(now: number): VoiceSessionSnapshot {
	return {
		version: 1,
		namespace: VOICE_SESSION_NAMESPACE,
		messages: [],
		transcriptDraft: "",
		taskEvidence: [],
		updatedAt: now,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMessage(value: unknown): VoiceSessionMessage | null {
	if (!isRecord(value)) return null;
	if (
		typeof value.id !== "string" ||
		(value.role !== "user" && value.role !== "assistant") ||
		typeof value.text !== "string" ||
		(value.modality !== "speech" && value.modality !== "text") ||
		typeof value.createdAt !== "number"
	) {
		return null;
	}
	return {
		id: value.id,
		role: value.role,
		text: value.text,
		modality: value.modality,
		createdAt: value.createdAt,
	};
}

function parseTaskEvidence(value: unknown): VoiceTaskEvidence | null {
	if (!isRecord(value)) return null;
	if (
		typeof value.taskId !== "string" ||
		typeof value.state !== "string" ||
		typeof value.auditEvidence !== "string"
	) {
		return null;
	}
	return {
		taskId: value.taskId,
		state: value.state,
		auditEvidence: value.auditEvidence,
	};
}

function parseSnapshot(raw: string, now: number): VoiceSessionSnapshot {
	if (!raw.trim()) return emptySnapshot(now);
	try {
		const parsed: unknown = JSON.parse(raw);
		if (
			!isRecord(parsed) ||
			parsed.version !== 1 ||
			parsed.namespace !== VOICE_SESSION_NAMESPACE
		) {
			return emptySnapshot(now);
		}
		const messages = Array.isArray(parsed.messages)
			? parsed.messages
					.map(parseMessage)
					.filter((message): message is VoiceSessionMessage => message !== null)
					.slice(-MAX_MESSAGES)
			: [];
		const taskEvidence = Array.isArray(parsed.taskEvidence)
			? parsed.taskEvidence
					.map(parseTaskEvidence)
					.filter((evidence): evidence is VoiceTaskEvidence => evidence !== null)
					.slice(-MAX_TASK_EVIDENCE)
			: [];
		return {
			version: 1,
			namespace: VOICE_SESSION_NAMESPACE,
			messages,
			transcriptDraft:
				typeof parsed.transcriptDraft === "string"
					? parsed.transcriptDraft
					: "",
			taskEvidence,
			updatedAt:
				typeof parsed.updatedAt === "number" ? parsed.updatedAt : now,
		};
	} catch {
		return emptySnapshot(now);
	}
}

function isVoiceEnvelope(raw: string): boolean {
	if (!raw.trim()) return false;
	try {
		const parsed: unknown = JSON.parse(raw);
		return (
			isRecord(parsed) &&
			parsed.version === 1 &&
			parsed.namespace === VOICE_SESSION_NAMESPACE
		);
	} catch {
		return false;
	}
}

export class VoiceSessionStore {
	readonly namespace = VOICE_SESSION_NAMESPACE;
	private state: VoiceSessionSnapshot;
	private writeTail: Promise<void> = Promise.resolve();

	constructor(
		private readonly persistence: VoiceSessionPersistence,
		private readonly now: () => number = Date.now
	) {
		this.state = emptySnapshot(this.now());
	}

	async load(): Promise<VoiceSessionSnapshot> {
		await this.writeTail;
		const current = await this.persistence.read();
		if (current.trim()) {
			this.state = parseSnapshot(current, this.now());
			return this.snapshot();
		}
		const legacy = this.persistence.readLegacy
			? await this.persistence.readLegacy()
			: "";
		if (isVoiceEnvelope(legacy)) {
			this.state = parseSnapshot(legacy, this.now());
			await this.persist();
		} else {
			this.state = emptySnapshot(this.now());
		}
		return this.snapshot();
	}

	snapshot(): VoiceSessionSnapshot {
		return {
			...this.state,
			messages: this.state.messages.map((message) => ({ ...message })),
			taskEvidence: this.state.taskEvidence.map((evidence) => ({
				...evidence,
			})),
		};
	}

	contextMessages(): Array<{ role: VoiceSessionRole; text: string }> {
		return this.state.messages.map(({ role, text }) => ({ role, text }));
	}

	async appendMessage(message: VoiceSessionMessage): Promise<void> {
		this.state.messages = [...this.state.messages, { ...message }].slice(
			-MAX_MESSAGES
		);
		await this.persist();
	}

	async setTranscriptDraft(transcriptDraft: string): Promise<void> {
		this.state.transcriptDraft = transcriptDraft;
		await this.persist();
	}

	async recordTaskEvidence(input: VoiceTaskEvidenceInput): Promise<void> {
		const evidence: VoiceTaskEvidence = {
			taskId: input.taskId,
			state: input.state,
			auditEvidence: input.auditEvidence,
		};
		this.state.taskEvidence = [
			...this.state.taskEvidence.filter(
				(item) => item.taskId !== evidence.taskId
			),
			evidence,
		].slice(-MAX_TASK_EVIDENCE);
		await this.persist();
	}

	async clear(): Promise<void> {
		this.state = emptySnapshot(this.now());
		await this.persist();
	}

	private async persist(): Promise<void> {
		this.state.updatedAt = this.now();
		const payload = JSON.stringify(this.state);
		const write = async (): Promise<void> => {
			await this.persistence.write(payload);
		};
		const task = this.writeTail.then(write, write);
		this.writeTail = task.catch(() => {});
		await task;
	}
}

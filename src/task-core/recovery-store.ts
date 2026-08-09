export interface RecoveryCaptureInput {
	taskId: string;
	actionId: string;
	targetPaths: string[];
	createdAt: string;
}

export interface RecoveryRecord extends RecoveryCaptureInput {
	id: string;
}

export interface RecoveryStore {
	capture(input: RecoveryCaptureInput): Promise<string>;
	has?(id: string): boolean;
	restore?(id: string): Promise<void>;
}

export class MemoryRecoveryStore implements RecoveryStore {
	private readonly records = new Map<string, RecoveryRecord>();
	private sequence = 0;

	constructor(
		private readonly onCapture?: (record: RecoveryRecord) => void,
		private readonly onRestore?: (record: RecoveryRecord) => void
	) {}

	async capture(input: RecoveryCaptureInput): Promise<string> {
		this.sequence++;
		const id = `recovery-${input.taskId}-${this.sequence}`;
		const record: RecoveryRecord = {
			id,
			taskId: input.taskId,
			actionId: input.actionId,
			targetPaths: [...input.targetPaths],
			createdAt: input.createdAt,
		};
		this.records.set(id, record);
		this.onCapture?.(record);
		return id;
	}

	get(id: string): RecoveryRecord | undefined {
		return this.records.get(id);
	}

	has(id: string): boolean {
		return this.records.has(id);
	}

	async restore(id: string): Promise<void> {
		const record = this.records.get(id);
		if (!record) throw new Error(`未找到恢复点：${id}`);
		this.onRestore?.(record);
	}
}

export interface RecoveryFileAdapter {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, value: string): Promise<void>;
	remove(path: string): Promise<void>;
}

interface VaultRecoverySnapshot {
	record: RecoveryRecord;
	files: Array<{
		path: string;
		existed: boolean;
		content?: string;
	}>;
}

function recoveryPath(path: string): string {
	const normalized = path.trim().replace(/\\/g, "/");
	if (!normalized || (normalized.startsWith("<") && normalized.endsWith(">"))) {
		return normalized;
	}
	const segments = normalized.split("/");
	if (
		normalized.startsWith("/") ||
		/^[a-zA-Z]:\//.test(normalized) ||
		normalized.includes("\0") ||
		segments.some(
			(segment, index) =>
				segment === "." ||
				segment === ".." ||
				(segment === "" && index > 0)
		)
	) {
		throw new Error(`RecoveryStore 禁止不安全路径：${normalized}`);
	}
	return normalized;
}

export class VaultRecoveryStore implements RecoveryStore {
	private readonly snapshots = new Map<string, VaultRecoverySnapshot>();
	private sequence = 0;

	constructor(private readonly adapter: RecoveryFileAdapter) {}

	async capture(input: RecoveryCaptureInput): Promise<string> {
		const paths = input.targetPaths.map(recoveryPath);
		const privatePath = paths.find(
			(path) => {
				const lower = path.toLowerCase();
				return (
					lower === ".talos/private" ||
					lower.startsWith(".talos/private/")
				);
			}
		);
		if (privatePath) {
			throw new Error(`RecoveryStore 禁止读取 private 路径：${privatePath}`);
		}
		this.sequence++;
		const id = `recovery-${input.taskId}-${this.sequence}`;
		const record: RecoveryRecord = {
			id,
			taskId: input.taskId,
			actionId: input.actionId,
			targetPaths: [...input.targetPaths],
			createdAt: input.createdAt,
		};
		const files: VaultRecoverySnapshot["files"] = [];
		for (const path of paths) {
			if (!path || (path.startsWith("<") && path.endsWith(">"))) continue;
			const existed = await this.adapter.exists(path);
			files.push({
				path,
				existed,
				content: existed ? await this.adapter.read(path) : undefined,
			});
		}
		this.snapshots.set(id, { record, files });
		return id;
	}

	has(id: string): boolean {
		return this.snapshots.has(id);
	}

	async restore(id: string): Promise<void> {
		const snapshot = this.snapshots.get(id);
		if (!snapshot) throw new Error(`未找到恢复点：${id}`);
		for (const file of [...snapshot.files].reverse()) {
			if (file.existed) {
				await this.adapter.write(file.path, file.content ?? "");
				continue;
			}
			if (await this.adapter.exists(file.path)) {
				await this.adapter.remove(file.path);
			}
		}
	}
}

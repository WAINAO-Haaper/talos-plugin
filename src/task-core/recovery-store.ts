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
}

export class MemoryRecoveryStore implements RecoveryStore {
	private readonly records = new Map<string, RecoveryRecord>();
	private sequence = 0;

	constructor(private readonly onCapture?: (record: RecoveryRecord) => void) {}

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
}

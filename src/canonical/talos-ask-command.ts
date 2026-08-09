import type { TalosAskService } from "../ai/ask-service";
import type { VaultRetrievalInput } from "../ai/context/vault-retrieval";
import type { AskEvent } from "../ai/provider/types";
import type { WritebackIntent } from "../ai/writeback-policy";
import type {
	CanonicalAskChannel,
	CanonicalApprovalState,
	CanonicalRequestInput,
	CanonicalRequestWriteResult,
} from "./request-writer";
import type { CanonicalRegistry } from "./registry-reader";

export interface TalosAskCommandInput extends Partial<VaultRetrievalInput> {
	channel: CanonicalAskChannel;
	providerId: string;
	query: string;
	writebackIntent: WritebackIntent;
	approvalState: CanonicalApprovalState;
}

export interface TalosAskCommandOptions {
	registryReader: { read(): Promise<CanonicalRegistry> };
	requestWriter: {
		write(input: CanonicalRequestInput): Promise<CanonicalRequestWriteResult>;
	};
	askService: Pick<TalosAskService, "ask">;
	now?: () => Date;
	requestId?: () => string;
}

export class TalosAskCommand {
	constructor(private readonly options: TalosAskCommandOptions) {}

	async *execute(input: TalosAskCommandInput): AsyncIterable<AskEvent> {
		await this.options.registryReader.read();
		const requestId = (this.options.requestId ?? defaultRequestId)();
		const timestamp = (this.options.now ?? (() => new Date()))().toISOString();
		await this.options.requestWriter.write({
			requestId,
			commandId: "talos-ask",
			timestamp,
			channel: input.channel,
			providerId: input.providerId,
			query: input.query,
			writebackIntent: input.writebackIntent,
			approvalState: input.approvalState,
		});
		yield* this.options.askService.ask({
			sessionId: "canonical",
			namespace: "command",
			runId: requestId,
			turnId: `${requestId}:turn`,
			providerId: input.providerId,
			query: input.query,
			attachmentPaths: input.attachmentPaths,
			currentPath: input.currentPath,
			engineResultPaths: input.engineResultPaths,
			recentConfirmedPaths: input.recentConfirmedPaths,
		});
	}
}

let requestSequence = 0;

function defaultRequestId(): string {
	requestSequence += 1;
	return `talos-ask-${Date.now()}-${requestSequence}`;
}

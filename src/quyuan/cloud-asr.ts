import type { TalosSettings } from "../settings";
import { VadMic, type VadMicHandlers } from "./vad-mic";

export const CLOUD_ASR_DISABLED =
	"安全策略已禁用云端 ASR；请使用经审计的本地 ASR 资产包";

/**
 * Compatibility stub for legacy imports. It intentionally contains no URL,
 * credential callback, encoder, or network client and fails before mic access.
 */
export class CloudAsr extends VadMic {
	constructor(
		settings: TalosSettings,
		handlers: VadMicHandlers,
		_getApiKey: () => string | null = () => null
	) {
		super(settings, handlers);
	}

	protected preflight(): string | null {
		return CLOUD_ASR_DISABLED;
	}

	protected async transcribe(): Promise<string> {
		throw new Error(CLOUD_ASR_DISABLED);
	}
}

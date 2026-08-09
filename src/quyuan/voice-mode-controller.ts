export type VoiceInputMode = "continuous" | "push-to-talk";
export type VoiceAsrStatus = "ready" | "fallback";
export type VoiceTtsStatus = "idle" | "speaking" | "failed" | "stopped";

export interface CompletedVoiceTool {
	taskId: string;
	toolName: string;
	auditEvidence: string;
}

export interface VoiceModeSnapshot {
	inputMode: VoiceInputMode;
	transcript: string;
	asrStatus: VoiceAsrStatus;
	fallbackReason: string;
	replyText: string;
	ttsStatus: VoiceTtsStatus;
	ttsError: string;
	completedTools: CompletedVoiceTool[];
}

export class VoiceModeController {
	private state: VoiceModeSnapshot = {
		inputMode: "continuous",
		transcript: "",
		asrStatus: "ready",
		fallbackReason: "",
		replyText: "",
		ttsStatus: "idle",
		ttsError: "",
		completedTools: [],
	};

	snapshot(): VoiceModeSnapshot {
		return {
			...this.state,
			completedTools: this.state.completedTools.map((tool) => ({
				...tool,
			})),
		};
	}

	setInputMode(inputMode: VoiceInputMode): void {
		this.state.inputMode = inputMode;
		if (inputMode === "continuous") {
			this.state.asrStatus = "ready";
			this.state.fallbackReason = "";
		}
	}

	setTranscript(transcript: string): void {
		this.state.transcript = transcript;
	}

	onAsrFailure(reason: string): void {
		this.state.inputMode = "push-to-talk";
		this.state.asrStatus = "fallback";
		this.state.fallbackReason = reason;
	}

	setReplyText(replyText: string): void {
		this.state.replyText = replyText;
	}

	setTtsSpeaking(): void {
		this.state.ttsStatus = "speaking";
		this.state.ttsError = "";
	}

	onTtsFailure(reason: string): void {
		this.state.ttsStatus = "failed";
		this.state.ttsError = reason;
	}

	recordCompletedTool(tool: CompletedVoiceTool): void {
		this.state.completedTools = [
			...this.state.completedTools.filter(
				(item) => item.taskId !== tool.taskId
			),
			{ ...tool },
		];
	}

	bargeIn(): void {
		if (this.state.ttsStatus === "speaking") {
			this.state.ttsStatus = "stopped";
		}
	}
}

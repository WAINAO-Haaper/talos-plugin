import { describe, expect, it } from "vitest";
import { VoiceModeController } from "../src/quyuan/voice-mode-controller";
import {
	evaluateVoiceToolRisk,
	resolveVoiceToolApproval,
} from "../src/quyuan/voice-tool-gateway";

describe("VoiceModeController", () => {
	it("starts in continuous mode and supports push-to-talk", () => {
		const controller = new VoiceModeController();

		expect(controller.snapshot().inputMode).toBe("continuous");
		controller.setInputMode("push-to-talk");
		expect(controller.snapshot().inputMode).toBe("push-to-talk");
	});

	it("preserves the transcript and falls back after ASR failure", () => {
		const controller = new VoiceModeController();
		controller.setTranscript("保留这段已识别字幕");

		controller.onAsrFailure("麦克风权限被拒绝");

		expect(controller.snapshot()).toMatchObject({
			inputMode: "push-to-talk",
			transcript: "保留这段已识别字幕",
			asrStatus: "fallback",
			fallbackReason: "麦克风权限被拒绝",
		});
	});

	it("keeps the text reply when TTS fails", () => {
		const controller = new VoiceModeController();
		controller.setReplyText("答案已经生成");
		controller.onTtsFailure("朗读服务不可用");

		expect(controller.snapshot()).toMatchObject({
			replyText: "答案已经生成",
			ttsStatus: "failed",
			ttsError: "朗读服务不可用",
		});
	});

	it("barge-in stops TTS but retains completed tool evidence", () => {
		const controller = new VoiceModeController();
		controller.setTtsSpeaking();
		controller.recordCompletedTool({
			taskId: "task-7",
			toolName: "Write",
			auditEvidence: "audit:write:7",
		});

		controller.bargeIn();

		expect(controller.snapshot().ttsStatus).toBe("stopped");
		expect(controller.snapshot().completedTools).toEqual([
			{
				taskId: "task-7",
				toolName: "Write",
				auditEvidence: "audit:write:7",
			},
		]);
	});
});

describe("voice tool gateway", () => {
	it("uses the shared A/B/C risk core for model tool calls", () => {
		expect(evaluateVoiceToolRisk("Read", { file_path: "30 洞察/a.md" }).decision)
			.toBe("allow");
		expect(evaluateVoiceToolRisk("Write", { file_path: "30 洞察/a.md" }).decision)
			.toBe("snapshot-and-run");
		expect(evaluateVoiceToolRisk("Delete", { file_path: "30 洞察/a.md" }).decision)
			.toBe("propose");
		expect(evaluateVoiceToolRisk("Bash", { command: "pwd" }).decision)
			.toBe("propose");
	});

	it("asks for every policy proposal instead of maintaining a destructive-only rule", async () => {
		let confirmations = 0;
		const confirm = async (): Promise<boolean> => {
			confirmations += 1;
			return true;
		};

		await expect(
			resolveVoiceToolApproval(
				{ decision: "ask", reason: "B 类写入等待用户批准" },
				confirm
			)
		).resolves.toBe("allow");
		await expect(
			resolveVoiceToolApproval(
				{ decision: "allow", reason: "A 类只读" },
				confirm
			)
		).resolves.toBe("allow");
		await expect(
			resolveVoiceToolApproval(
				{ decision: "deny", reason: "治理硬闸" },
				confirm
			)
		).resolves.toBe("deny");
		expect(confirmations).toBe(1);
	});
});

import { setIcon } from "obsidian";
import {
	QuyuanVoiceParticleField,
	type ParticleVoiceState,
} from "./voice-particle-field";

export type CharacterVoiceState = ParticleVoiceState;

/**
 * 屈原语音舞台的 TALOS Logo 粒子磁场适配器。
 *
 * 面板只与稳定的六态、输入音量和输出音量交互；内部 Canvas 将
 * 官方 TALOS Modular T-Shield 作为磁吸目标，不读取静态人物图片。
 */
export class QuyuanVoiceCharacterStage {
	private readonly root: HTMLElement;
	private readonly field: QuyuanVoiceParticleField | null;
	private disposed = false;

	constructor(host: HTMLElement) {
		this.root = host.createDiv({
			cls: "tq-pixel-head-scene",
			attr: { "aria-hidden": "true" },
		});

		const backCanvas = this.root.createEl("canvas", {
			cls: "tq-pixel-head-canvas tq-pixel-head-canvas--back",
			attr: { "aria-hidden": "true" },
		});
		const frontCanvas = this.root.createEl("canvas", {
			cls: "tq-pixel-head-canvas tq-pixel-head-canvas--front",
			attr: { "aria-hidden": "true" },
		});

		let field: QuyuanVoiceParticleField | null = null;
		try {
			field = new QuyuanVoiceParticleField(this.root, backCanvas, frontCanvas);
			this.root.addClass("is-ready");
		} catch (error) {
			this.root.addClass("is-fallback");
			console.error("TALOS Quyuan antigravity mark failed to start", error);
		}
		this.field = field;

		const fallback = this.root.createDiv({ cls: "tq-pixel-head-fallback" });
		setIcon(fallback, "talos-logo");
	}

	setState(state: CharacterVoiceState, awake: boolean): void {
		if (this.disposed) return;
		this.root.setAttribute("data-character-state", state);
		this.root.setAttribute("data-character-awake", String(awake));
		this.field?.setAwake(awake);
		this.field?.setState(state);
	}

	setInputLevel(level: number): void {
		if (this.disposed) return;
		this.field?.setAudioLevel(level);
	}

	setOutputLevel(level: number): void {
		if (this.disposed) return;
		this.field?.setOutputLevel(level);
	}

	destroy(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.field?.destroy();
		this.root.remove();
	}
}

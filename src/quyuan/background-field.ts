/**
 * 屈原语音舞台背景层——统一接口 + 策略模式。
 *
 * voice-panel.ts 只跟 QuyuanBackgroundField 打交道，不需要知道底层用 LetterGlitch
 * 还是 GridScan。switchTo() 负责销毁旧 field、创建新 field、启动。
 */

import { LetterGlitchField } from "./letter-glitch-field";
import { GridScanField } from "./grid-scan-field";

export type QuyuanBackgroundType = "letter-glitch" | "grid-scan";
export type BackgroundVoiceState = "sleep" | "idle" | "listen" | "reco" | "think" | "speak";

export interface IBackgroundField {
	start(): void;
	setState(state: BackgroundVoiceState): void;
	destroy(): void;
	onResize(): void;
}

export class QuyuanBackgroundField {
	private canvas: HTMLCanvasElement;
	private current: IBackgroundField | null = null;
	private currentType: QuyuanBackgroundType | null = null;

	constructor(canvas: HTMLCanvasElement) {
		this.canvas = canvas;
	}

	/** 当前背景类型（null = 未启动） */
	get type(): QuyuanBackgroundType | null {
		return this.currentType;
	}

	/** 启动指定类型的背景。重复调用同一类型不会重建；类型不同则走完整切换（销毁旧实例）。 */
	start(type: QuyuanBackgroundType): void {
		if (this.current) {
			if (this.currentType === type) {
				this.current.start();
				return;
			}
			// 已有其他类型的实例在跑：必须经 switchTo 销毁旧 field + 重建 canvas，
			// 直接覆盖 this.current 会让旧实例的 rAF 循环泄漏。
			this.switchTo(type);
			return;
		}
		this.createField(type).start();
	}

	/** 切换背景类型。销毁旧 field → 重建 canvas → 创建新 field → 启动 → 保留 state。 */
	switchTo(type: QuyuanBackgroundType, state?: BackgroundVoiceState): void {
		if (this.currentType === type && this.current) return;
		this.destroyCurrent();
		this.recreateCanvas();
		this.createField(type);
		this.current?.start();
		if (state) this.current?.setState(state);
	}

	setState(state: BackgroundVoiceState): void {
		this.current?.setState(state);
	}

	onResize(): void {
		this.current?.onResize();
	}

	destroy(): void {
		this.destroyCurrent();
	}

	/**
	 * 重建 canvas 元素。
	 *
	 * 必要性：同一个 canvas 一旦获取了某种 context（如 2d），浏览器就不允许再获取
	 * 另一种 context（如 webgl2）——getContext 会返回 null，导致 GridScan 静默失败。
	 * 所以切换背景类型时必须销毁旧 canvas、创建全新 canvas，让新 field 拿到干净 context。
	 */
	private recreateCanvas(): void {
		const old = this.canvas;
		const fresh = activeDocument.createElement("canvas");
		fresh.className = old.className;
		// 清掉可能残留的 interactive 标记（createField 会按需重新加）
		fresh.classList.remove("tq-bg--interactive");
		fresh.setAttribute("aria-hidden", "true");
		old.parentElement?.replaceChild(fresh, old);
		this.canvas = fresh;
	}

	private createField(type: QuyuanBackgroundType): IBackgroundField {
		// GridScan 需要鼠标交互（mousemove 驱动透视倾斜）；LetterGlitch 不需要
		this.canvas.classList.toggle("tq-bg--interactive", type === "grid-scan");
		const field: IBackgroundField =
			type === "letter-glitch"
				? new LetterGlitchField(this.canvas)
				: new GridScanField(this.canvas);
		this.current = field;
		this.currentType = type;
		return field;
	}

	private destroyCurrent(): void {
		if (this.current) {
			try {
				this.current.destroy();
			} catch (error) {
				console.error("TALOS background field destroy failed", error);
			}
			this.current = null;
			this.currentType = null;
		}
	}
}

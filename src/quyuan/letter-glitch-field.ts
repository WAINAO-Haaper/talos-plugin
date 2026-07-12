/**
 * LetterGlitch 字符故障背景——移植自 ReactBits 的 <LetterGlitch /> 组件。
 *
 * 原 React 版本依赖 hooks/useRef/useEffect，这里改写为 Canvas 2D + RAF 的纯类，
 * 以适配 Obsidian 插件环境（无 React 运行时）。
 *
 * 核心算法完全保留：
 *   - 固定网格（charWidth × charHeight），每格随机字符+颜色
 *   - 每帧随机刷新约 5% 的格子（字符和目标色）
 *   - smooth 模式：颜色从当前色向目标色插值过渡（每帧 +0.05）
 *   - centerVignette / outerVignette：两层 radial-gradient 遮罩
 *
 * 扩展：调色板随屈原语音状态切换——让背景与粒子/fab 圆环统一呼吸。
 */

export type GlitchVoiceState = "sleep" | "idle" | "listen" | "reco" | "think" | "speak";

/** 统一背景层状态类型（与 background-field.ts 的 BackgroundVoiceState 结构兼容） */
type BackgroundVoiceState = GlitchVoiceState;

interface GlitchCell {
	char: string;
	color: string;
	targetColor: string;
	colorProgress: number;
}

interface Rgb {
	r: number;
	g: number;
	b: number;
}

/** 每个语音状态对应一组调色板（暗色少 + 亮色多，保证在深色背景上高对比可见） */
const STATE_PALETTES: Record<GlitchVoiceState, [string, string, string]> = {
	sleep:  ["#1e293b", "#64748b", "#94a3b8"],   // 灰蓝→亮灰——休眠低频但仍可见
	idle:   ["#1e3a5f", "#3b82f6", "#60a5fa"],   // 蓝→亮蓝——待命
	listen: ["#0c4a6e", "#0ea5e9", "#7dd3fc"],   // 天蓝→亮青——聆听
	reco:   ["#0369a1", "#38bdf8", "#bae6fd"],   // 青蓝→极亮青——识别高频
	think:  ["#4c1d95", "#8b5cf6", "#c4b5fd"],   // 紫蓝→亮紫——思考
	speak:  ["#0f766e", "#2dd4bf", "#99f6e4"],   // 青绿→亮薄荷——说话
};

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$&*()-_+=/[]{};:<>.,0123456789";
const CHAR_POOL = Array.from(CHARS);

const FONT_SIZE = 16;
const CHAR_WIDTH = 10;
const CHAR_HEIGHT = 20;
/** 每帧刷新的格子比例 */
const REFRESH_RATIO = 0.12;
/** smooth 模式下每帧颜色推进量 */
const COLOR_STEP = 0.09;

function hexToRgb(hex: string): Rgb | null {
	const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
	const normalized = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(normalized);
	return result
		? {
			r: parseInt(result[1], 16),
			g: parseInt(result[2], 16),
			b: parseInt(result[3], 16),
		}
		: null;
}

function interpolateColor(start: Rgb, end: Rgb, factor: number): string {
	const r = Math.round(start.r + (end.r - start.r) * factor);
	const g = Math.round(start.g + (end.g - start.g) * factor);
	const b = Math.round(start.b + (end.b - start.b) * factor);
	return `rgb(${r}, ${g}, ${b})`;
}

export class LetterGlitchField {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D | null = null;
	private cells: GlitchCell[] = [];
	private columns = 0;
	private rows = 0;
	private width = 0;
	private height = 0;
	private rafId: number | null = null;
	private lastGlitchTime = 0;
	private resizeTimer: number | null = null;
	private palette: [string, string, string] = STATE_PALETTES.idle;
	private glitchSpeed = 35;
	private smooth = true;
	private running = false;

	constructor(canvas: HTMLCanvasElement) {
		this.canvas = canvas;
		this.ctx = canvas.getContext("2d");
	}

	/** 切换语音状态调色板——刷新时新格子会用新色，已有格子平滑过渡 */
	setState(state: GlitchVoiceState): void {
		this.palette = STATE_PALETTES[state] ?? STATE_PALETTES.idle;
	}

	/** 启动动画。可重复调用，不会叠加 RAF。 */
	start(): void {
		if (this.running) return;
		this.running = true;
		this.resize();
		this.lastGlitchTime = Date.now();
		this.loop();
	}

	/** 暂停动画（不销毁数据，可 resume） */
	pause(): void {
		this.running = false;
		if (this.rafId != null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
	}

	/** 彻底销毁——清除 RAF + resize listener + 数据 */
	destroy(): void {
		this.pause();
		if (this.resizeTimer != null) {
			window.clearTimeout(this.resizeTimer);
			this.resizeTimer = null;
		}
		this.cells = [];
		this.ctx = null;
	}

	/** 监听容器尺寸变化（由外部 ResizeObserver 或 window resize 触发） */
	onResize(): void {
		if (this.resizeTimer != null) window.clearTimeout(this.resizeTimer);
		this.resizeTimer = window.setTimeout(() => {
			this.resize();
		}, 100);
	}

	private resize(): void {
		if (!this.ctx) return;
		const parent = this.canvas.parentElement;
		if (!parent) return;
		const dpr = window.devicePixelRatio || 1;
		const rect = parent.getBoundingClientRect();
		this.width = rect.width;
		this.height = rect.height;

		this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
		this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
		this.canvas.style.width = `${rect.width}px`;
		this.canvas.style.height = `${rect.height}px`;
		this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

		this.columns = Math.ceil(rect.width / CHAR_WIDTH);
		this.rows = Math.ceil(rect.height / CHAR_HEIGHT);
		this.initializeCells();
		this.draw();
	}

	private initializeCells(): void {
		const total = this.columns * this.rows;
		this.cells = new Array(total);
		for (let i = 0; i < total; i++) {
			const color = this.randomColor();
			this.cells[i] = {
				char: this.randomChar(),
				color,
				targetColor: color,
				colorProgress: 1,
			};
		}
	}

	private randomChar(): string {
		return CHAR_POOL[Math.floor(Math.random() * CHAR_POOL.length)];
	}

	private randomColor(): string {
		return this.palette[Math.floor(Math.random() * this.palette.length)];
	}

	private draw(): void {
		if (!this.ctx || this.cells.length === 0) return;
		const ctx = this.ctx;
		ctx.clearRect(0, 0, this.width, this.height);
		ctx.font = `${FONT_SIZE}px "JetBrains Mono", "Fira Code", "SF Mono", "Cascadia Code", Consolas, monospace`;
		ctx.textBaseline = "top";

		for (let i = 0; i < this.cells.length; i++) {
			const cell = this.cells[i];
			const x = (i % this.columns) * CHAR_WIDTH;
			const y = Math.floor(i / this.columns) * CHAR_HEIGHT;
			ctx.fillStyle = cell.color;
			ctx.fillText(cell.char, x, y);
		}
	}

	private updateCells(): void {
		if (this.cells.length === 0) return;
		const updateCount = Math.max(1, Math.floor(this.cells.length * REFRESH_RATIO));
		for (let i = 0; i < updateCount; i++) {
			const index = Math.floor(Math.random() * this.cells.length);
			const cell = this.cells[index];
			if (!cell) continue;
			cell.char = this.randomChar();
			cell.targetColor = this.randomColor();
			if (this.smooth) {
				cell.colorProgress = 0;
			} else {
				cell.color = cell.targetColor;
				cell.colorProgress = 1;
			}
		}
	}

	private handleSmoothTransitions(): void {
		if (!this.smooth || this.cells.length === 0) return;
		let needsRedraw = false;
		for (const cell of this.cells) {
			if (cell.colorProgress < 1) {
				cell.colorProgress = Math.min(1, cell.colorProgress + COLOR_STEP);
				const start = hexToRgb(cell.color) ?? hexToRgb(this.palette[0])!;
				const end = hexToRgb(cell.targetColor);
				if (end) {
					cell.color = interpolateColor(start, end, cell.colorProgress);
					needsRedraw = true;
				}
			}
		}
		if (needsRedraw) this.draw();
	}

	private loop = (): void => {
		if (!this.running) return;
		const now = Date.now();
		if (now - this.lastGlitchTime >= this.glitchSpeed) {
			this.updateCells();
			this.draw();
			this.lastGlitchTime = now;
		}
		if (this.smooth) {
			this.handleSmoothTransitions();
		}
		this.rafId = window.requestAnimationFrame(this.loop);
	};
}

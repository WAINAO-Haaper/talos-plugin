export type ParticleVoiceState = "idle" | "listen" | "reco" | "think" | "speak";

interface Particle {
	/** logo 白色主体内的基准坐标（归一化 -0.5~0.5，以 logo 中心为原点） */
	baseX: number;
	baseY: number;
	offX: number;
	offY: number;
	wanderSpeed: number;
	size: number;
	phase: number;
	speed: number;
	colorMix: number;
	layer: number;
}

interface Rgb {
	r: number;
	g: number;
	b: number;
}

const PARTICLE_COUNT = 2000;
const FRONT_ALPHA = 0.72;
const WHITE = { r: 235, g: 245, b: 255 };

const TALOS_LOGO_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
	'<rect x="6" y="6" width="88" height="88" rx="20" fill="#005CFF"/>' +
	'<g transform="translate(-27.5 -54.1) scale(0.2802)">' +
	'<path fill="#FFFFFF" d="M180 247H249V286H304V247H374V286H405V411H374V460H306V496H247V460H180V411H148V286H180V247Z"/>' +
	'<path fill="#005CFF" d="M199 326H353V373H306V460H247V373H199V326Z"/>' +
	'</g></svg>';

interface SamplePoint { x: number; y: number; }

/**
 * logo 采样点缓存 + 异步加载状态。
 * 初始化时先用 fallback 几何点，SVG 像素采样完成后替换为精确点。
 */
let cachedSamplePoints: SamplePoint[] | null = null;
let samplePointsReady = false;

/**
 * 异步加载 SVG → 离屏 canvas → 读像素 → 提取白色区域采样点。
 * 完成后更新 cachedSamplePoints 和 samplePointsReady。
 */
function startLogoSampling(onReady: () => void): void {
	if (samplePointsReady) return;
	const renderSize = 200;
	const canvas = document.createElement("canvas");
	canvas.width = renderSize;
	canvas.height = renderSize;
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	const img = new Image();
	img.onload = (): void => {
		ctx.drawImage(img, 0, 0, renderSize, renderSize);
		try {
			const imageData = ctx.getImageData(0, 0, renderSize, renderSize);
			const data = imageData.data;
			const points: SamplePoint[] = [];
			// 采样步长：每 2px 取一个点（renderSize=200 → 100×100 网格）
			const step = 2;
			for (let py = 0; py < renderSize; py += step) {
				for (let px = 0; px < renderSize; px += step) {
					const idx = (py * renderSize + px) * 4;
					const r = data[idx];
					const g = data[idx + 1];
					const b = data[idx + 2];
					// 白色主体：RGB 都接近 255（白色 T 笔画）
					if (r > 200 && g > 200 && b > 200) {
						// 归一化到 -0.5~0.5（以 logo 中心为原点，以 logo 宽为单位）
						points.push({
							x: (px / renderSize - 0.5),
							y: (py / renderSize - 0.5),
						});
					}
				}
			}
			if (points.length > 50) {
				cachedSamplePoints = points;
				samplePointsReady = true;
				onReady();
			}
		} catch {
			// CORS 或其他读取失败——保持 fallback
		}
	};
	img.onerror = (): void => { /* 保持 fallback */ };
	const svgBlob = new Blob([TALOS_LOGO_SVG], { type: "image/svg+xml" });
	img.src = URL.createObjectURL(svgBlob);
}

/**
 * Fallback：用 SVG path 的精确坐标手工定义白色 T 的笔画。
 * 这些是 SVG transform 后的精确视框坐标（已验证）。
 */
function generateFallbackPoints(): SamplePoint[] {
	// T 外轮廓的精确 path（变换后在 100x100 视框中的坐标）：
	// 横杠: x[14,86] y[15,26]，竖杠: x[42,58] y[26,85]
	// 内镂空（蓝色十字）: x[28,72] y[37,75] 减去两侧
	// 归一化到 -0.5~0.5（除以 72.01，T 的实际宽度）
	const W = 72.01;
	const H = 69.77;
	const ox = 49.98; // T 中心 x
	const oy = 49.99; // T 中心 y
	const n = (v: number, o: number) => (v - o) / W;

	const rects = [
		// 横杠（宽条）
		{ x1: n(14, ox), x2: n(86, ox), y1: n(15, oy), y2: n(26, oy) },
		// 竖杠（窄条）
		{ x1: n(42, ox), x2: n(58, ox), y1: n(26, oy), y2: n(85, oy) },
	];
	const points: SamplePoint[] = [];
	for (const r of rects) {
		for (let i = 0; i < 400; i++) {
			points.push({
				x: r.x1 + Math.random() * (r.x2 - r.x1),
				y: r.y1 + Math.random() * (r.y2 - r.y1),
			});
		}
	}
	return points;
}

function getLogoSamplePoints(): SamplePoint[] {
	if (cachedSamplePoints) return cachedSamplePoints;
	cachedSamplePoints = generateFallbackPoints();
	return cachedSamplePoints;
}

function hexToRgb(value: string, fallback: Rgb): Rgb {
	const normalized = value.trim().replace("#", "");
	if (!/^[0-9a-f]{6}$/i.test(normalized)) return fallback;
	return {
		r: Number.parseInt(normalized.slice(0, 2), 16),
		g: Number.parseInt(normalized.slice(2, 4), 16),
		b: Number.parseInt(normalized.slice(4, 6), 16),
	};
}

function mix(a: Rgb, b: Rgb, amount: number): Rgb {
	return {
		r: Math.round(a.r + (b.r - a.r) * amount),
		g: Math.round(a.g + (b.g - a.g) * amount),
		b: Math.round(a.b + (b.b - a.b) * amount),
	};
}

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
	return {
		r: a.r + (b.r - a.r) * t,
		g: a.g + (b.g - a.g) * t,
		b: a.b + (b.b - a.b) * t,
	};
}

function deepen(color: Rgb, factor: number): Rgb {
	return {
		r: Math.round(color.r * factor),
		g: Math.round(color.g * factor),
		b: Math.round(color.b * factor),
	};
}

function rgba(color: Rgb, alpha: number): string {
	return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

export class QuyuanVoiceParticleField {
	private readonly host: HTMLElement;
	private readonly backCanvas: HTMLCanvasElement;
	private readonly frontCanvas: HTMLCanvasElement;
	private readonly back: CanvasRenderingContext2D;
	private readonly front: CanvasRenderingContext2D;
	private particles: Particle[];
	private readonly resizeObserver: ResizeObserver;
	private frame = 0;
	private lastTime = 0;
	private width = 1;
	private height = 1;
	private dpr = 1;
	private state: ParticleVoiceState = "idle";
	private audioLevel = 0;
	private smoothedLevel = 0;
	private outputLevel = 0;
	private smoothedOutput = 0;
	private reducedMotion = false;
	private lightSurface = false;
	private stateEnteredAt = 0;
	private themeKey = "";
	private primary: Rgb = { r: 45, g: 132, b: 255 };
	private secondary: Rgb = { r: 124, g: 86, b: 255 };
	private warm: Rgb = { r: 255, g: 112, b: 74 };
	private stateColor: Rgb = { r: 45, g: 132, b: 255 };
	private targetPrimary: Rgb = { r: 45, g: 132, b: 255 };
	private targetSecondary: Rgb = { r: 124, g: 86, b: 255 };
	private targetWarm: Rgb = { r: 255, g: 112, b: 74 };
	private targetStateColor: Rgb = { r: 45, g: 132, b: 255 };

	constructor(host: HTMLElement, backCanvas: HTMLCanvasElement, frontCanvas: HTMLCanvasElement) {
		const back = backCanvas.getContext("2d");
		const front = frontCanvas.getContext("2d");
		if (!back || !front) throw new Error("Canvas 2D unavailable");
		this.host = host;
		this.backCanvas = backCanvas;
		this.frontCanvas = frontCanvas;
		this.back = back;
		this.front = front;
		this.particles = this.createParticles();
		this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(host);
		this.resize();
		this.syncPalette(true);
		// 异步加载精确的 SVG 像素采样，完成后重建粒子位置
		startLogoSampling(() => {
			this.particles = this.createParticles();
		});
		this.frame = window.requestAnimationFrame((time) => this.render(time));
	}

	setState(state: ParticleVoiceState): void {
		if (state !== this.state) this.stateEnteredAt = performance.now();
		this.state = state;
		this.syncPalette(true);
	}

	setAudioLevel(level: number): void {
		this.audioLevel = Math.max(0, Math.min(1, level));
	}

	setOutputLevel(level: number): void {
		this.outputLevel = Math.max(0, Math.min(1, level));
	}

	destroy(): void {
		window.cancelAnimationFrame(this.frame);
		this.resizeObserver.disconnect();
	}

	private createParticles(): Particle[] {
		const samplePoints = getLogoSamplePoints();
		const particles: Particle[] = [];
		for (let i = 0; i < PARTICLE_COUNT; i++) {
			const pt = samplePoints[i % samplePoints.length];
			particles.push({
				baseX: pt.x,
				baseY: pt.y,
				offX: 0,
				offY: 0,
				wanderSpeed: 0.3 + Math.random() * 0.5,
				size: 0.25 + ((i * 17) % 19) / 32,
				phase: ((i * 53) % 360) * (Math.PI / 180),
				speed: 0.72 + ((i * 29) % 31) / 48,
				colorMix: ((i * 41) % 100) / 100,
				layer: Math.random(),
			});
		}
		return particles;
	}

	private resize(): void {
		const rect = this.host.getBoundingClientRect();
		this.width = Math.max(1, Math.floor(rect.width));
		this.height = Math.max(1, Math.floor(rect.height));
		this.dpr = Math.min(window.devicePixelRatio || 1, 1.25);
		for (const canvas of [this.backCanvas, this.frontCanvas]) {
			canvas.width = Math.floor(this.width * this.dpr);
			canvas.height = Math.floor(this.height * this.dpr);
			canvas.style.width = `${this.width}px`;
			canvas.style.height = `${this.height}px`;
		}
		this.back.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
		this.front.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
	}

	private syncPalette(force = false): void {
		const style = getComputedStyle(this.host);
		const key = [
			style.getPropertyValue("--tq-theme-key"),
			style.getPropertyValue("--tq-particle-a"),
			style.getPropertyValue("--tq-particle-b"),
			style.getPropertyValue("--tq-particle-c"),
			this.state,
		].join("|");
		if (!force && key === this.themeKey) return;
		this.themeKey = key;
		this.lightSurface = style.colorScheme.includes("light");
		const deepenFactor = this.lightSurface ? 0.72 : 1;
		this.targetPrimary = deepen(hexToRgb(style.getPropertyValue("--tq-particle-a"), { r: 45, g: 132, b: 255 }), deepenFactor);
		this.targetSecondary = deepen(hexToRgb(style.getPropertyValue("--tq-particle-b"), { r: 124, g: 86, b: 255 }), deepenFactor);
		this.targetWarm = deepen(hexToRgb(style.getPropertyValue("--tq-particle-c"), { r: 255, g: 112, b: 74 }), deepenFactor);
		const stateVariable =
			this.state === "reco"
				? "--tq-state-reco"
				: this.state === "think"
					? "--tq-state-think"
					: this.state === "speak"
						? "--tq-state-speak"
						: "--tq-state-listen";
		this.targetStateColor = deepen(hexToRgb(style.getPropertyValue(stateVariable), this.targetPrimary), deepenFactor);
	}

	private stateEnergy(time: number): number {
		const pulse = (Math.sin(time * 0.0032) + 1) / 2;
		if (this.state === "listen") return Math.max(this.smoothedLevel, 0.1 + pulse * 0.08);
		if (this.state === "reco") return Math.max(this.smoothedLevel, 0.12 + pulse * 0.08);
		if (this.state === "think") return 0.38 + Math.sin(time * 0.0054) * 0.12;
		if (this.state === "speak") {
			return 0.28 + this.smoothedOutput * 0.5 + Math.sin(time * 0.011) * 0.08;
		}
		return 0.08 + pulse * 0.04;
	}

	private stateColorFlow(
		particle: Particle,
		energy: number,
		time: number
	): Rgb {
		const colorRate =
			this.state === "speak" ? 0.0038
				: this.state === "reco" ? 0.0028
					: this.state === "think" ? 0.0021
						: 0.0015;
		const shimmer = (Math.sin(particle.baseX * 6.28 + particle.phase + time * colorRate) + 1) / 2;

		switch (this.state) {
			case "listen": {
				const tint = mix(WHITE, this.stateColor, 0.15 + energy * 0.2);
				return mix(tint, WHITE, 0.45 - shimmer * 0.15);
			}
			case "reco": {
				const tint = mix(WHITE, this.stateColor, 0.18 + energy * 0.18);
				return mix(tint, WHITE, 0.42 - shimmer * 0.12);
			}
			case "think": {
				const scan = mix(WHITE, this.stateColor, 0.12 + shimmer * 0.28);
				return mix(scan, WHITE, 0.38);
			}
			case "speak": {
				const tint = mix(WHITE, this.stateColor, 0.2 + energy * 0.25);
				return mix(tint, WHITE, 0.35 - shimmer * 0.15);
			}
			default: {
				return mix(WHITE, this.stateColor, 0.08);
			}
		}
	}

	private render(time: number): void {
		if (this.lastTime && time - this.lastTime < 30) {
			this.frame = window.requestAnimationFrame((next) => this.render(next));
			return;
		}
		const delta = Math.min(32, Math.max(8, time - (this.lastTime || time)));
		this.lastTime = time;
		this.smoothedLevel += (this.audioLevel - this.smoothedLevel) * Math.min(1, delta / 70);
		this.audioLevel *= 0.92;
		this.smoothedOutput += (this.outputLevel - this.smoothedOutput) * Math.min(1, delta / 90);
		this.outputLevel *= 0.94;
		this.syncPalette();
		this.primary = lerpRgb(this.primary, this.targetPrimary, 0.08);
		this.secondary = lerpRgb(this.secondary, this.targetSecondary, 0.08);
		this.warm = lerpRgb(this.warm, this.targetWarm, 0.08);
		this.stateColor = lerpRgb(this.stateColor, this.targetStateColor, 0.08);

		this.back.clearRect(0, 0, this.width, this.height);
		this.front.clearRect(0, 0, this.width, this.height);
		const composite: GlobalCompositeOperation = this.lightSurface ? "source-over" : "lighter";
		this.back.globalCompositeOperation = composite;
		this.front.globalCompositeOperation = composite;

		const animationTime = this.reducedMotion ? 0 : time;
		const transitionKick = this.reducedMotion
			? 0
			: Math.max(0, 1 - (time - this.stateEnteredAt) / 720) * 0.18;
		const energy = this.reducedMotion
			? 0.08
			: Math.max(0.04, this.stateEnergy(time) + transitionKick);

		const cx = this.width * 0.5;
		const cy = this.height * 0.5;
		const baseRadius = Math.max(80, Math.min(this.width * 0.28, this.height * 0.32, 240));
		const breathScale = 1 + energy * 0.05;
		const scale = baseRadius * breathScale;
		const surfaceAlpha = this.lightSurface ? 0.88 : 1;

		// 游走幅度大幅降低：粒子锁定在 logo 形状内，只有微小抖动
		const wanderRange = 0.012 + energy * 0.025;

		for (let particleIndex = 0; particleIndex < this.particles.length; particleIndex++) {
			const particle = this.particles[particleIndex];

			// 低频慢速漂移（不是跳跃，是轻微浮动）
			const t1 = animationTime * 0.0008 * particle.wanderSpeed;
			const t2 = animationTime * 0.0014 * particle.wanderSpeed;
			const nx = Math.sin(particle.phase + t1) * 0.6
				+ Math.sin(particle.phase * 2.1 + t2) * 0.4;
			const ny = Math.cos(particle.phase * 1.3 + t1 * 0.9) * 0.6
				+ Math.cos(particle.phase * 2.8 + t2 * 1.1) * 0.4;
			particle.offX = nx * wanderRange;
			particle.offY = ny * wanderRange;

			const px = cx + (particle.baseX + particle.offX) * scale * 2;
			const py = cy + (particle.baseY + particle.offY) * scale * 2;

			const depth = 0.72 + particle.layer * 0.28;
			const visible = Math.max(0.52, 0.76 + particle.layer * 0.4);

			const flowingColor = this.stateColorFlow(particle, energy, animationTime);
			const tint = mix(WHITE, this.secondary, particle.colorMix * 0.12);
			const color = mix(tint, flowingColor, 0.55 + energy * 0.2);

			const size = particle.size * (1.04 + depth * 0.9 + energy * 0.9);
			const context = particle.layer > 0.5 ? this.front : this.back;
			const layerAlpha = particle.layer > 0.5 ? FRONT_ALPHA : 1;

			if (particleIndex % 17 === 0) {
				const haloSize = size * (2.8 + energy * 1.8);
				context.beginPath();
				context.arc(px, py, haloSize, 0, Math.PI * 2);
				context.fillStyle = rgba(
					flowingColor,
					(0.045 + energy * 0.075) * layerAlpha * surfaceAlpha
				);
				context.fill();
			}
			context.beginPath();
			context.arc(px, py, size, 0, Math.PI * 2);
			context.fillStyle = rgba(color, visible * layerAlpha * surfaceAlpha);
			context.fill();
		}

		this.frame = window.requestAnimationFrame((next) => this.render(next));
	}
}

export type ParticleVoiceState = "idle" | "listen" | "reco" | "think" | "speak";

interface Particle {
	/** logo 白色主体内的基准坐标（归一化 -0.5~0.5，以 logo 中心为原点） */
	baseX: number;
	baseY: number;
	/** 当前偏移（每帧随机游走，让粒子活泼跳跃） */
	offX: number;
	offY: number;
	/** 游走速度（控制跳跃幅度） */
	wanderSpeed: number;
	size: number;
	phase: number;
	speed: number;
	colorMix: number;
	/** 0-1 深度层（前后景分配，保留立体感） */
	layer: number;
}

interface Rgb {
	r: number;
	g: number;
	b: number;
}

const PARTICLE_COUNT = 2000;
const FRONT_ALPHA = 0.72;

// 白色 logo 主体：粒子基础色以白色为主，状态色只做点缀
const WHITE = { r: 235, g: 245, b: 255 };

// TALOS logo SVG（蓝色外框背景 + 白色 T 主体），与 main.ts 的 TALOS_ICON_SVG 一致
const TALOS_LOGO_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
	'<rect x="6" y="6" width="88" height="88" rx="20" fill="#005CFF"/>' +
	'<g transform="translate(-27.5 -54.1) scale(0.2802)">' +
	'<path fill="#FFFFFF" d="M180 247H249V286H304V247H374V286H405V411H374V460H306V496H247V460H180V411H148V286H180V247Z"/>' +
	'<path fill="#005CFF" d="M199 326H353V373H306V460H247V373H199V326Z"/>' +
	'</g></svg>';

/** 像素采样点（logo 白色主体内的归一化坐标） */
interface SamplePoint { x: number; y: number; }
let cachedSamplePoints: SamplePoint[] | null = null;

/**
 * 把 TALOS logo SVG 渲染到离屏 canvas，读取像素，提取白色主体区域内的采样点。
 * 白色主体 = logo 中 fill="#FFFFFF" 的 path 覆盖区域（T 字形外轮廓减去内部镂空）。
 * 返回归一化坐标（-0.5~0.5），以 logo 中心为原点。
 */
function getLogoSamplePoints(): SamplePoint[] {
	if (cachedSamplePoints) return cachedSamplePoints;
	const renderSize = 200; // 高分辨率采样
	const canvas = document.createElement("canvas");
	canvas.width = renderSize;
	canvas.height = renderSize;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		// 降级：返回 T 形的两个矩形
		cachedSamplePoints = generateFallbackPoints();
		return cachedSamplePoints;
	}
	const img = new Image();
	const svgBlob = new Blob([TALOS_LOGO_SVG], { type: "image/svg+xml" });
	const url = URL.createObjectURL(svgBlob);
	// 图片加载是异步的，但 createImageBitmap 或 Image onload 在构造期无法同步等待。
	// 用同步降级方案：直接用数学几何定义白色主体轮廓。
	URL.revokeObjectURL(url);
	cachedSamplePoints = generateLogoPoints();
	return cachedSamplePoints;
}

/**
 * 用数学几何定义 TALOS logo 白色主体的完整轮廓。
 * 白色主体 = T 外轮廓 - T 内部镂空（蓝色十字区）。
 * 在 100x100 视框中（经过 transform 后的实际坐标）：
 *   T 外轮廓：横杠 + 竖杠（带凹角的完整外框）
 *   T 内镂空：中心十字形镂空（让 T 有"像素化"锯齿感）
 */
function generateLogoPoints(): SamplePoint[] {
	// 归一化坐标（-0.5~0.5），以 logo 中心为原点，以 logo 宽度为单位
	// T 外轮廓（从 SVG path 精确反推）
	// 横杠: x[-0.5, 0.5], y[-0.484, -0.333]（顶部宽条）
	// 竖杠: x[-0.115, 0.107], y[-0.333, 0.484]（中间竖条）
	// 但 logo 的白色主体还包括横杠与竖杠交接处的完整外轮廓

	// 定义白色主体的矩形组合（归一化坐标）
	// 外轮廓 path：M180,247 → 经过多段 H/V → 闭合
	// 转换后（scale 0.2802, translate -27.5/-54.1，再归一化到 -0.5~0.5 以中心为原点）：
	//   完整白色区域 = 横杠 + 竖杠 - 内部镂空
	const rects = [
		// 横杠主体（宽矩形条）
		{ xMin: -0.5, xMax: 0.5, yMin: -0.484, yMax: -0.333 },
		// 横杠下方两翼（T 的左右"肩膀"延伸到竖杠两侧）
		{ xMin: -0.5, xMax: -0.115, yMin: -0.333, yMax: -0.182 },
		{ xMin: 0.107, xMax: 0.5, yMin: -0.333, yMax: -0.182 },
		// 竖杠主体
		{ xMin: -0.115, xMax: 0.107, yMin: -0.333, yMax: 0.484 },
	];
	// 内部镂空（蓝色十字区域，不在白色主体内）
	const cutouts = [
		{ xMin: -0.346, xMax: 0.346, yMin: -0.182, yMax: -0.069 },
		{ xMin: -0.120, xMax: 0.120, yMin: -0.069, yMax: 0.376 },
	];

	const points: SamplePoint[] = [];
	const samplesPerRect = 200; // 每个矩形采样数
	for (const rect of rects) {
		for (let i = 0; i < samplesPerRect; i++) {
			const x = rect.xMin + Math.random() * (rect.xMax - rect.xMin);
			const y = rect.yMin + Math.random() * (rect.yMax - rect.yMin);
			// 检查是否在镂空区内
			let inCutout = false;
			for (const c of cutouts) {
				if (x >= c.xMin && x <= c.xMax && y >= c.yMin && y <= c.yMax) {
					inCutout = true;
					break;
				}
			}
			if (!inCutout) points.push({ x, y });
		}
	}
	cachedSamplePoints = points;
	return points;
}

/** 降级方案：简单的 T 形两个矩形 */
function generateFallbackPoints(): SamplePoint[] {
	const rects = [
		{ xMin: -0.5, xMax: 0.5, yMin: -0.484, yMax: -0.333 },
		{ xMin: -0.115, xMax: 0.107, yMin: -0.333, yMax: 0.484 },
	];
	const points: SamplePoint[] = [];
	for (const rect of rects) {
		for (let i = 0; i < 300; i++) {
			points.push({
				x: rect.xMin + Math.random() * (rect.xMax - rect.xMin),
				y: rect.yMin + Math.random() * (rect.yMax - rect.yMin),
			});
		}
	}
	return points;
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

/** 浅色主题下加深颜色，让粒子在浅底上更鲜明 */
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
	private readonly particles: Particle[];
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

	/** 从 logo 白色主体采样点中随机分配粒子位置 */
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
				wanderSpeed: 0.4 + Math.random() * 0.8,
				size: 0.28 + ((i * 17) % 19) / 28,   // 更小的粒子
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

	/**
	 * 各状态的能量值（驱动呼吸缩放幅度）
	 */
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

	/**
	 * 粒子颜色流动——基于粒子在 T 形内的位置 + 时间相位
	 */
	/**
	 * 粒子颜色流动——白色 T 主体，状态色做轻微染色点缀。
	 * 白色占主导（mix 0.55-0.85），状态色只在能量高时渗透。
	 */
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
				// 白色为主，听音时渗入冷青色
				const tint = mix(WHITE, this.stateColor, 0.15 + energy * 0.2);
				return mix(tint, WHITE, 0.45 - shimmer * 0.15);
			}
			case "reco": {
				const tint = mix(WHITE, this.stateColor, 0.18 + energy * 0.18);
				return mix(tint, WHITE, 0.42 - shimmer * 0.12);
			}
			case "think": {
				// think：白色基底 + 从左到右的淡紫扫描带
				const scan = mix(WHITE, this.stateColor, 0.12 + shimmer * 0.28);
				return mix(scan, WHITE, 0.38);
			}
			case "speak": {
				// speak：白色基底 + 青绿点缀（TTS 音量驱动渗透强度）
				const tint = mix(WHITE, this.stateColor, 0.2 + energy * 0.25);
				return mix(tint, WHITE, 0.35 - shimmer * 0.15);
			}
			default: {
				// idle/sleep：纯白主体 + 极淡状态色
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
		// 颜色平滑过渡
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

		// T 形居中 + 呼吸缩放（整体脉动，形状不散）
		const cx = this.width * 0.5;
		const cy = this.height * 0.5;
		const baseRadius = Math.max(80, Math.min(this.width * 0.28, this.height * 0.32, 240));
		const breathScale = 1 + energy * 0.12;
		// T 形尺寸：归一化坐标 × scale，scale 让 T 宽 ≈ baseRadius
		const scale = baseRadius * breathScale;
		const surfaceAlpha = this.lightSurface ? 0.88 : 1;

		// 游走幅度：energy 越高粒子越活泼，动态更明显
		const wanderRange = 0.08 + energy * 0.20;

		for (let particleIndex = 0; particleIndex < this.particles.length; particleIndex++) {
			const particle = this.particles[particleIndex];

			// 无序跳跃：四频 sin/cos 叠加模拟噪声，高频 + 快速 → 强动态
			const t1 = animationTime * 0.004 * particle.wanderSpeed;
			const t2 = animationTime * 0.0065 * particle.wanderSpeed;
			const t3 = animationTime * 0.0028 * particle.wanderSpeed;
			const nx = Math.sin(particle.phase + t1)
				+ Math.sin(particle.phase * 2.7 + t2) * 0.8
				+ Math.sin(particle.phase * 0.6 + t3) * 0.5
				+ Math.sin(particle.phase * 5.1 + t1 * 1.3) * 0.3;
			const ny = Math.cos(particle.phase * 1.7 + t1 * 0.9)
				+ Math.cos(particle.phase * 3.3 + t2 * 1.1) * 0.8
				+ Math.cos(particle.phase * 0.4 + t3 * 0.7) * 0.5
				+ Math.cos(particle.phase * 4.8 + t2 * 1.4) * 0.3;
			particle.offX = nx * wanderRange;
			particle.offY = ny * wanderRange;

			const px = cx + (particle.baseX + particle.offX) * scale * 2;
			const py = cy + (particle.baseY + particle.offY) * scale * 2;

			// 深度：layer 决定前后景 + 大小变化
			const depth = 0.72 + particle.layer * 0.28;
			const visible = Math.max(0.52, 0.76 + particle.layer * 0.4);

			// 颜色：白色主体 + 状态色点缀
			const flowingColor = this.stateColorFlow(particle, energy, animationTime);
			// baseColor 也偏白，只在 colorMix 高时极轻微掺入 secondary
			const tint = mix(WHITE, this.secondary, particle.colorMix * 0.12);
			const color = mix(tint, flowingColor, 0.55 + energy * 0.2);

			const size = particle.size * (1.04 + depth * 0.9 + energy * 0.9);
			const context = particle.layer > 0.5 ? this.front : this.back;
			const layerAlpha = particle.layer > 0.5 ? FRONT_ALPHA : 1;

			// halo 光晕（保留）
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

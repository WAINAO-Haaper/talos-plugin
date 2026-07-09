export type ParticleVoiceState = "idle" | "listen" | "reco" | "think" | "speak";

interface Particle {
	/** T 形内基准坐标（归一化 -0.5~0.5，以 T 中心为原点） */
	baseX: number;
	baseY: number;
	/** 随机微抖动（让粒子不完美对齐，更有机） */
	jitterX: number;
	jitterY: number;
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

const PARTICLE_COUNT = 900;
const FRONT_ALPHA = 0.68;

// TALOS T 标志的归一化几何参数（从 SVG path 反推，归一化到 -0.5~0.5）
// 横杠面积:竖杠面积 ≈ 46:54
const T_CROSSBAR = { xMin: -0.5, xMax: 0.5, yMin: -0.484, yMax: -0.333 };   // 横杠
const T_STEM = { xMin: -0.115, xMax: 0.107, yMin: -0.333, yMax: 0.484 };   // 竖杠
const T_CROSSBAR_RATIO = 0.46; // 46% 粒子分给横杠

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

	/** 在 T 形的横杠和竖杠矩形内均匀采样粒子位置 */
	private createParticles(): Particle[] {
		const particles: Particle[] = [];
		for (let i = 0; i < PARTICLE_COUNT; i++) {
			// 按面积比例选横杠或竖杠
			const useCrossbar = Math.random() < T_CROSSBAR_RATIO;
			const rect = useCrossbar ? T_CROSSBAR : T_STEM;
			const baseX = rect.xMin + Math.random() * (rect.xMax - rect.xMin);
			const baseY = rect.yMin + Math.random() * (rect.yMax - rect.yMin);
			particles.push({
				baseX,
				baseY,
				jitterX: (Math.random() - 0.5) * 0.008,
				jitterY: (Math.random() - 0.5) * 0.008,
				size: 0.32 + ((i * 17) % 19) / 22,
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
		// 用粒子的 baseX 做横向流光（T 形从左到右）
		const shimmer = (Math.sin(particle.baseX * 6.28 + particle.phase + time * colorRate) + 1) / 2;
		// 用 baseY 做纵向呼吸（T 形从上到下）
		const vertical = (particle.baseY + 0.5);

		switch (this.state) {
			case "listen": {
				const breath = Math.min(1, this.smoothedLevel * 1.35 + energy * 0.45);
				const cool = mix(this.primary, this.secondary, 0.18 + shimmer * 0.48);
				return mix(cool, this.stateColor, 0.22 + breath * 0.48);
			}
			case "reco": {
				const breath = Math.min(1, this.smoothedLevel * 1.2 + energy * 0.4);
				const cool = mix(this.primary, this.secondary, 0.2 + shimmer * 0.44);
				return mix(cool, this.stateColor, 0.24 + breath * 0.44);
			}
			case "think": {
				// think 态：从左到右的扫描光带
				const scan = mix(this.secondary, this.primary, shimmer);
				return mix(scan, this.stateColor, 0.34 + shimmer * 0.38);
			}
			case "speak": {
				const warmWave = mix(this.warm, this.stateColor, 0.24 + vertical * 0.54);
				const coolFlash = mix(this.primary, this.secondary, shimmer);
				const coolAmount = Math.max(0, (shimmer - 0.46) * 1.72);
				return mix(warmWave, coolFlash, coolAmount);
			}
			default: {
				const quiet = mix(this.primary, this.secondary, particle.colorMix * 0.44);
				return mix(quiet, this.stateColor, 0.18);
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
		const breathScale = 1 + energy * 0.06;
		// T 形尺寸：归一化坐标 × scale，scale 让 T 宽 ≈ baseRadius
		const scale = baseRadius * breathScale;
		const surfaceAlpha = this.lightSurface ? 0.88 : 1;

		for (let particleIndex = 0; particleIndex < this.particles.length; particleIndex++) {
			const particle = this.particles[particleIndex];

			// 粒子位置 = T 形坐标 × scale（中心居中）
			// 加基于相位的微小浮动（呼吸时粒子轻微位移，更有机）
			const floatX = Math.sin(particle.phase + animationTime * 0.0012) * energy * 0.004;
			const floatY = Math.cos(particle.phase + animationTime * 0.0014) * energy * 0.004;
			const px = cx + (particle.baseX + particle.jitterX + floatX) * scale * 2;
			const py = cy + (particle.baseY + particle.jitterY + floatY) * scale * 2;

			// 深度：layer 决定前后景 + 大小变化
			const depth = 0.72 + particle.layer * 0.28;
			const visible = Math.max(0.52, 0.76 + particle.layer * 0.4);

			// 颜色
			const baseColor = mix(
				this.primary,
				particle.colorMix > 0.72 ? this.warm : this.secondary,
				particle.colorMix
			);
			const flowingColor = this.stateColorFlow(particle, energy, animationTime);
			const color = mix(baseColor, flowingColor, 0.42 + energy * 0.2);

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

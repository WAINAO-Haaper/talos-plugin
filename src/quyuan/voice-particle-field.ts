export type ParticleVoiceState = "idle" | "listen" | "reco" | "think" | "speak";

interface Particle {
	/** T 形内基准坐标（归一化 -0.5~0.5，以 T 中心为原点） */
	baseX: number;
	baseY: number;
	/** 当前偏移（每帧随机游走，让粒子活泼跳跃） */
	offX: number;
	offY: number;
	/** 游走目标和速度（控制跳跃幅度） */
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

const PARTICLE_COUNT = 1600;
const FRONT_ALPHA = 0.72;

// 白色 T 主体：粒子基础色以白色为主，状态色只做点缀
const WHITE = { r: 235, g: 245, b: 255 };

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
				offX: 0,
				offY: 0,
				wanderSpeed: 0.3 + Math.random() * 0.7,
				size: 0.18 + ((i * 17) % 19) / 30,
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
		const wanderRange = 0.06 + energy * 0.14;

		for (let particleIndex = 0; particleIndex < this.particles.length; particleIndex++) {
			const particle = this.particles[particleIndex];

			// 无序跳跃：三频 sin 叠加模拟噪声，更快频率 → 更明显的动态
			const nx = Math.sin(particle.phase + animationTime * 0.0028 * particle.wanderSpeed)
				+ Math.sin(particle.phase * 2.3 + animationTime * 0.0041 * particle.wanderSpeed) * 0.7
				+ Math.sin(particle.phase * 0.7 + animationTime * 0.0019 * particle.wanderSpeed) * 0.4;
			const ny = Math.cos(particle.phase * 1.7 + animationTime * 0.0024 * particle.wanderSpeed)
				+ Math.cos(particle.phase * 3.1 + animationTime * 0.0037 * particle.wanderSpeed) * 0.7
				+ Math.cos(particle.phase * 0.5 + animationTime * 0.0015 * particle.wanderSpeed) * 0.4;
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

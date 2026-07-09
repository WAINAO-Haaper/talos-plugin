export type ParticleVoiceState = "idle" | "listen" | "reco" | "think" | "speak";

interface Particle {
	theta: number;
	phi: number;
	shell: number;
	size: number;
	phase: number;
	speed: number;
	colorMix: number;
}

interface Rgb {
	r: number;
	g: number;
	b: number;
}

interface StateMotion {
	rotationRate: number;
	xScale: number;
	yScale: number;
	deformation: number;
	waveRate: number;
	twist: number;
	orbitCount: number;
	orbitSquash: number;
	pulseCount: number;
}

const PARTICLE_COUNT = 900;
const FRONT_ALPHA = 0.68;

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
	// 目标色（syncPalette 设置，render 里每帧 lerp 靠近，实现平滑过渡）
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

	private createParticles(): Particle[] {
		const particles: Particle[] = [];
		const golden = Math.PI * (3 - Math.sqrt(5));
		for (let i = 0; i < PARTICLE_COUNT; i++) {
			const y = 1 - (i / (PARTICLE_COUNT - 1)) * 2;
			particles.push({
				theta: golden * i,
				phi: Math.acos(y),
				shell: 0.58 + ((i * 37) % 100) / 310,
				size: 0.32 + ((i * 17) % 19) / 22,
				phase: ((i * 53) % 360) * (Math.PI / 180),
				speed: 0.72 + ((i * 29) % 31) / 48,
				colorMix: ((i * 41) % 100) / 100,
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

	private stateMotion(): StateMotion {
		switch (this.state) {
			case "listen":
				return {
					rotationRate: 0.00009,
					xScale: 1.02,
					yScale: 1,
					deformation: 0.14,
					waveRate: 0.005,
					twist: 0.08,
					orbitCount: 3,
					orbitSquash: 0.38,
					pulseCount: 3,
				};
			case "reco":
				return {
					rotationRate: 0.00012,
					xScale: 0.98,
					yScale: 1.02,
					deformation: 0.15,
					waveRate: 0.006,
					twist: 0.12,
					orbitCount: 3,
					orbitSquash: 0.36,
					pulseCount: 3,
				};
			case "think":
				return {
					rotationRate: 0.00025,
					xScale: 1.08,
					yScale: 0.82,
					deformation: 0.22,
					waveRate: 0.009,
					twist: 0.8,
					orbitCount: 6,
					orbitSquash: 0.2,
					pulseCount: 2,
				};
			case "speak":
				return {
					rotationRate: 0.00019,
					xScale: 1.14,
					yScale: 0.94,
					deformation: 0.28,
					waveRate: 0.018,
					twist: 0.34,
					orbitCount: 5,
					orbitSquash: 0.34,
					pulseCount: 4,
				};
			default:
				return {
					rotationRate: 0.000045,
					xScale: 0.94,
					yScale: 0.94,
					deformation: 0.1,
					waveRate: 0.003,
					twist: 0,
					orbitCount: 3,
					orbitSquash: 0.4,
					pulseCount: 2,
				};
		}
	}

	private stateEnergy(time: number): number {
		const pulse = (Math.sin(time * 0.0032) + 1) / 2;
		if (this.state === "listen") return Math.max(this.smoothedLevel, 0.1 + pulse * 0.08);
		if (this.state === "reco") return Math.max(this.smoothedLevel, 0.12 + pulse * 0.08);
		if (this.state === "think") return 0.38 + Math.sin(time * 0.0054) * 0.12;
		if (this.state === "speak") {
			// TTS 输出音量直接驱动粒子能量，加装饰性 sin 波动
			return 0.28 + this.smoothedOutput * 0.5 + Math.sin(time * 0.011) * 0.08;
		}
		return 0.08 + pulse * 0.04;
	}

	private stateColorFlow(
		particle: Particle,
		theta: number,
		voiceBand: number,
		flow: number,
		energy: number,
		time: number
	): Rgb {
		const colorRate =
			this.state === "speak" ? 0.0038
				: this.state === "reco" ? 0.0028
					: this.state === "think" ? 0.0021
						: 0.0015;
		const shimmer =
			(Math.sin(particle.phase + theta * 2.4 + time * colorRate) + 1) / 2;
		const band = (voiceBand + 1) / 2;
		const stream = (flow + 1) / 2;

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
				const vortex = mix(this.secondary, this.primary, stream);
				return mix(vortex, this.stateColor, 0.34 + shimmer * 0.38);
			}
			case "speak": {
				const warmWave = mix(this.warm, this.stateColor, 0.24 + band * 0.54);
				const coolFlash = mix(this.primary, this.secondary, stream);
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
		// 颜色平滑过渡：每帧向目标色 lerp 8%（借鉴 ElevenLabs Orb 的 color.lerp）
		this.primary = lerpRgb(this.primary, this.targetPrimary, 0.08);
		this.secondary = lerpRgb(this.secondary, this.targetSecondary, 0.08);
		this.warm = lerpRgb(this.warm, this.targetWarm, 0.08);
		this.stateColor = lerpRgb(this.stateColor, this.targetStateColor, 0.08);

		this.back.clearRect(0, 0, this.width, this.height);
		this.front.clearRect(0, 0, this.width, this.height);
		const composite: GlobalCompositeOperation = this.lightSurface ? "source-over" : "lighter";
		this.back.globalCompositeOperation = composite;
		this.front.globalCompositeOperation = composite;

		const motion = this.stateMotion();
		const animationTime = this.reducedMotion ? 0 : time;
		const transitionKick = this.reducedMotion
			? 0
			: Math.max(0, 1 - (time - this.stateEnteredAt) / 720) * 0.18;
		const energy = this.reducedMotion
			? 0.08
			: Math.max(0.04, this.stateEnergy(time) + transitionKick);
		const cx = this.width * 0.5;
		const cy = this.height * 0.5;
		const radius = Math.max(88, Math.min(this.width * 0.32, this.height * 0.36, 280));
		const rotation = this.reducedMotion ? 0.22 : animationTime * motion.rotationRate;
		const tilt = -0.18;

		for (let particleIndex = 0; particleIndex < this.particles.length; particleIndex++) {
			const particle = this.particles[particleIndex];
			const baseY = Math.cos(particle.phi);
			const theta =
				particle.theta
				+ rotation * particle.speed
				+ baseY * motion.twist
				+ Math.sin(particle.phase + animationTime * motion.waveRate * 0.28) * energy * 0.12;
			const sinPhi = Math.sin(particle.phi);
			let x = Math.cos(theta) * sinPhi;
			let y = baseY;
			let z = Math.sin(theta) * sinPhi;
			const y2 = y * Math.cos(tilt) - z * Math.sin(tilt);
			const z2 = y * Math.sin(tilt) + z * Math.cos(tilt);
			y = y2;
			z = z2;

			const bandFrequency =
				this.state === "reco" ? 18 : this.state === "speak" ? 11 : 8;
			const voiceBand = Math.sin(
				particle.phi * bandFrequency + particle.phase - animationTime * motion.waveRate
			);
			const flow = Math.sin(theta * (this.state === "think" ? 7 : 4) + animationTime * motion.waveRate * 0.64 + particle.phase);
			const speakWave = this.state === "speak"
				? Math.sin(particle.phi * 7 - animationTime * 0.031) * 0.11
				: 0;
			const deformation =
				1
				+ energy * (motion.deformation + voiceBand * 0.15 + flow * 0.08)
				+ speakWave * energy;
			x *= deformation * motion.xScale;
			y *= deformation * motion.yScale;
			const depth = 0.72 + (z + 1) * 0.18;
			const px = cx + x * radius * particle.shell * depth;
			const py = cy + y * radius * particle.shell * depth;
			const visible = Math.max(0.52, 0.76 + z * 0.4);
			const baseColor = mix(
				this.primary,
				particle.colorMix > 0.72 ? this.warm : this.secondary,
				particle.colorMix
			);
			const flowingColor = this.stateColorFlow(
				particle,
				theta,
				voiceBand,
				flow,
				energy,
				animationTime
			);
			const color = mix(baseColor, flowingColor, 0.42 + energy * 0.2);
			const size = particle.size * (1.04 + depth * 0.9 + energy * 0.9);
			const context = z >= 0.08 ? this.front : this.back;
			const layerAlpha = z >= 0.08 ? FRONT_ALPHA : 1;
			const surfaceAlpha = this.lightSurface ? 0.88 : 1;
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

		this.drawPulse(this.back, cx, cy, radius, energy, animationTime, motion);
		this.drawOrbits(this.back, cx, cy, radius, energy, animationTime, motion);
		this.frame = window.requestAnimationFrame((next) => this.render(next));
	}

	private drawPulse(
		context: CanvasRenderingContext2D,
		cx: number,
		cy: number,
		radius: number,
		energy: number,
		time: number,
		motion: StateMotion
	): void {
		context.beginPath();
		context.arc(cx, cy, radius * (0.56 + energy * 0.04), 0, Math.PI * 2);
		const centerAlpha = this.lightSurface ? 0.04 : 0.018;
		context.fillStyle = rgba(this.primary, centerAlpha + energy * 0.022);
		context.fill();
		context.strokeStyle = rgba(this.stateColor, (this.lightSurface ? 0.14 : 0.09) + energy * 0.12);
		context.lineWidth = 1.2;
		context.stroke();

		const count = motion.pulseCount;
		const pulsePalette = [this.stateColor, this.primary, this.secondary, this.warm];
		for (let i = 0; i < count; i++) {
			const pulseRate = this.state === "speak" ? 0.00055 : this.state === "reco" ? 0.00038 : 0.00024;
			const phase = ((time * pulseRate + i / count) % 1);
			const pulseRadius = radius * (0.45 + phase * 0.72);
			context.beginPath();
			context.arc(cx, cy, pulseRadius, 0, Math.PI * 2);
			const pulseColor = mix(
				pulsePalette[i % pulsePalette.length],
				this.stateColor,
				0.34 + Math.sin(time * 0.002 + i) * 0.18
			);
			context.strokeStyle = rgba(
				pulseColor,
				Math.max(0, (1 - phase) * (0.055 + energy * 0.15))
			);
			context.lineWidth = 1;
			context.stroke();
		}
	}

	private drawOrbits(
		context: CanvasRenderingContext2D,
		cx: number,
		cy: number,
		radius: number,
		energy: number,
		time: number,
		motion: StateMotion
	): void {
		context.save();
		context.translate(cx, cy);
		for (let i = 0; i < motion.orbitCount; i++) {
			context.save();
			const direction = this.state === "think" && i % 2 ? -1 : 1;
			context.rotate(
				time * direction * (motion.rotationRate * 0.36 + i * 0.000004) + i * 0.63
			);
			context.beginPath();
			context.ellipse(
				0,
				0,
				radius * (0.68 + i * 0.045),
				radius * (motion.orbitSquash + i * 0.018),
				0,
				0,
				Math.PI * 2
			);
			const orbitBase = i % 3 === 2 ? this.warm : i % 2 === 0 ? this.primary : this.secondary;
			const color = mix(
				orbitBase,
				this.stateColor,
				0.18 + ((Math.sin(time * 0.0017 + i * 0.9) + 1) / 2) * 0.42
			);
			const surfaceAlpha = this.lightSurface ? 0.85 : 1;
			context.strokeStyle = rgba(color, (0.13 + energy * 0.2) * surfaceAlpha);
			context.lineWidth = 1 + energy * 1.55;
			context.stroke();
			context.restore();
		}
		context.restore();
	}
}

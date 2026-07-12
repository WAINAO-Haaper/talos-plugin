import { generateTalosRoundedMarkPoints } from "../talos-mark";

export type ParticleVoiceState = "sleep" | "idle" | "listen" | "reco" | "think" | "speak";

interface Particle {
	logoX: number;
	logoY: number;
	freeRadius: number;
	freeAngle: number;
	freeSpeed: number;
	currentX: number;
	currentY: number;
	phase: number;
	size: number;
	layer: number;
	colorMix: number;
}

interface EyeParticle {
	side: -1 | 1;
	baseX: number;
	baseY: number;
	phase: number;
	size: number;
}

interface Rgb {
	r: number;
	g: number;
	b: number;
}

const ACTIVE_FRAME_INTERVAL = 26;
const SLEEP_FRAME_INTERVAL = 42;
const REDUCED_MOTION_FRAME_INTERVAL = 180;
const WHITE: Rgb = { r: 235, g: 245, b: 255 };
const TALOS_MARK_POINTS = generateTalosRoundedMarkPoints(2);
const EYE_PARTICLES_PER_SIDE = 240;

function createSeededRandom(seed: number): () => number {
	let value = seed >>> 0;
	return () => {
		value += 0x6D2B79F5;
		let next = value;
		next = Math.imul(next ^ (next >>> 15), next | 1);
		next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
		return ((next ^ (next >>> 14)) >>> 0) / 4_294_967_296;
	};
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

function lerpRgb(a: Rgb, b: Rgb, amount: number): Rgb {
	return {
		r: a.r + (b.r - a.r) * amount,
		g: a.g + (b.g - a.g) * amount,
		b: a.b + (b.b - a.b) * amount,
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
	return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${alpha})`;
}

/**
 * Antigravity-inspired magnetic particle field.
 *
 * React Bits' ring destination is replaced by the official TALOS mark samples:
 * sleeping particles only weakly reveal the mark, while wake states increase the
 * magnetic attraction until the negative-space T becomes unmistakable.
 */
export class QuyuanVoiceParticleField {
	private readonly host: HTMLElement;
	private readonly backCanvas: HTMLCanvasElement;
	private readonly frontCanvas: HTMLCanvasElement;
	private readonly back: CanvasRenderingContext2D;
	private readonly front: CanvasRenderingContext2D;
	private readonly activeDocument: Document;
	private readonly activeWindow: Window;
	private readonly particles: Particle[];
	private readonly eyeParticles: EyeParticle[];
	private readonly resizeObserver: ResizeObserver;
	private frame = 0;
	private lastTime = 0;
	private lastPaletteCheck = 0;
	private width = 1;
	private height = 1;
	private dpr = 1;
	private state: ParticleVoiceState = "sleep";
	private awake = false;
	private disposed = false;
	private audioLevel = 0;
	private smoothedLevel = 0;
	private outputLevel = 0;
	private smoothedOutput = 0;
	private reducedMotion = false;
	private documentVisible = true;
	private lightSurface = false;
	private stateEnteredAt = 0;
	private attraction = 0.08;
	private pointerX = 0;
	private pointerY = 0;
	private pointerInside = false;
	private themeKey = "";
	private primary: Rgb = { r: 45, g: 132, b: 255 };
	private secondary: Rgb = { r: 124, g: 86, b: 255 };
	private warm: Rgb = { r: 0, g: 245, b: 212 };
	private stateColor: Rgb = { r: 45, g: 132, b: 255 };
	private targetPrimary: Rgb = { r: 45, g: 132, b: 255 };
	private targetSecondary: Rgb = { r: 124, g: 86, b: 255 };
	private targetWarm: Rgb = { r: 0, g: 245, b: 212 };
	private targetStateColor: Rgb = { r: 45, g: 132, b: 255 };

	private readonly handleVisibilityChange = (): void => {
		this.documentVisible = !this.activeDocument.hidden;
		this.lastTime = 0;
	};

	private readonly handlePointerMove = (event: PointerEvent): void => {
		const rect = this.host.getBoundingClientRect();
		this.pointerInside = event.clientX >= rect.left && event.clientX <= rect.right
			&& event.clientY >= rect.top && event.clientY <= rect.bottom;
		if (!this.pointerInside) return;
		this.pointerX = (event.clientX - rect.left) / Math.max(1, rect.width) - 0.5;
		this.pointerY = (event.clientY - rect.top) / Math.max(1, rect.height) - 0.5;
	};

	private readonly handlePointerLeave = (): void => {
		this.pointerInside = false;
	};

	constructor(host: HTMLElement, backCanvas: HTMLCanvasElement, frontCanvas: HTMLCanvasElement) {
		const back = backCanvas.getContext("2d");
		const front = frontCanvas.getContext("2d");
		if (!back || !front) throw new Error("Canvas 2D unavailable");
		this.host = host;
		this.backCanvas = backCanvas;
		this.frontCanvas = frontCanvas;
		this.back = back;
		this.front = front;
		this.activeDocument = host.ownerDocument;
		const activeWindow = this.activeDocument.defaultView;
		if (!activeWindow) throw new Error("Window unavailable");
		this.activeWindow = activeWindow;
		this.particles = this.createParticles();
		this.eyeParticles = this.createEyeParticles();
		this.reducedMotion = activeWindow.matchMedia("(prefers-reduced-motion: reduce)").matches;
		this.documentVisible = !this.activeDocument.hidden;
		this.activeDocument.addEventListener("visibilitychange", this.handleVisibilityChange);
		this.activeDocument.addEventListener("pointermove", this.handlePointerMove, { passive: true });
		this.activeDocument.addEventListener("pointerleave", this.handlePointerLeave, { passive: true });
		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(host);
		this.resize();
		this.syncPalette(true);
		this.stateEnteredAt = this.activeWindow.performance.now();
		this.frame = this.activeWindow.requestAnimationFrame((time) => this.render(time));
	}

	setAwake(awake: boolean): void {
		if (awake !== this.awake) this.stateEnteredAt = this.activeWindow.performance.now();
		this.awake = awake;
	}

	setState(state: ParticleVoiceState): void {
		if (state !== this.state) this.stateEnteredAt = this.activeWindow.performance.now();
		this.state = state;
		this.syncPalette(true);
	}

	setAudioLevel(level: number): void {
		this.audioLevel = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
	}

	setOutputLevel(level: number): void {
		this.outputLevel = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
	}

	destroy(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.activeWindow.cancelAnimationFrame(this.frame);
		this.resizeObserver.disconnect();
		this.activeDocument.removeEventListener("visibilitychange", this.handleVisibilityChange);
		this.activeDocument.removeEventListener("pointermove", this.handlePointerMove);
		this.activeDocument.removeEventListener("pointerleave", this.handlePointerLeave);
	}

	private createParticles(): Particle[] {
		const random = createSeededRandom(0x54414C4F);
		const points = [...TALOS_MARK_POINTS];
		for (let i = points.length - 1; i > 0; i--) {
			const swapIndex = Math.floor(random() * (i + 1));
			[points[i], points[swapIndex]] = [points[swapIndex], points[i]];
		}
		return points.map((point) => {
			const angle = random() * Math.PI * 2;
			const radius = 0.08 + Math.sqrt(random()) * 0.72;
			return {
				logoX: point.x + (random() - 0.5) * 0.006,
				logoY: point.y + (random() - 0.5) * 0.006,
				freeRadius: radius,
				freeAngle: angle,
				freeSpeed: 0.5 + random() * 0.9,
				currentX: Math.cos(angle) * radius,
				currentY: Math.sin(angle) * radius,
				phase: random() * Math.PI * 2,
				size: 0.62 + random() * 1.12,
				layer: random(),
				colorMix: random(),
			};
		});
	}

	/** 两组粒子眼位于官方标志的负形 T 横栏内，不回退为实心图形。 */
	private createEyeParticles(): EyeParticle[] {
		const random = createSeededRandom(0x45594553);
		const eyes: EyeParticle[] = [];
		for (const side of [-1, 1] as const) {
			for (let index = 0; index < EYE_PARTICLES_PER_SIDE; index++) {
				const angle = random() * Math.PI * 2;
				const radius = Math.sqrt(random());
				eyes.push({
					side,
					baseX: side * 0.155 + Math.cos(angle) * radius * 0.055,
					baseY: -0.095 + Math.sin(angle) * radius * 0.055,
					phase: random() * Math.PI * 2,
					size: 0.62 + random() * 0.9,
				});
			}
		}
		return eyes;
	}

	private resize(): void {
		const rect = this.host.getBoundingClientRect();
		const width = Math.max(1, Math.floor(rect.width));
		const height = Math.max(1, Math.floor(rect.height));
		const dpr = Math.min(this.activeWindow.devicePixelRatio || 1, 1.25);
		if (width === this.width && height === this.height && dpr === this.dpr) return;
		this.width = width;
		this.height = height;
		this.dpr = dpr;
		for (const canvas of [this.backCanvas, this.frontCanvas]) {
			canvas.width = Math.floor(width * dpr);
			canvas.height = Math.floor(height * dpr);
			canvas.style.width = `${width}px`;
			canvas.style.height = `${height}px`;
		}
		this.back.setTransform(dpr, 0, 0, dpr, 0, 0);
		this.front.setTransform(dpr, 0, 0, dpr, 0, 0);
	}

	private syncPalette(force = false): void {
		const style = this.activeWindow.getComputedStyle(this.host);
		const key = [
			style.getPropertyValue("--tq-theme-key"),
			style.getPropertyValue("--tq-particle-a"),
			style.getPropertyValue("--tq-particle-b"),
			style.getPropertyValue("--tq-particle-c"),
			style.getPropertyValue("--tq-state"),
			this.state,
		].join("|");
		if (!force && key === this.themeKey) return;
		this.themeKey = key;
		this.lightSurface = style.colorScheme.includes("light");
		const factor = this.lightSurface ? 0.72 : 1;
		this.targetPrimary = deepen(hexToRgb(style.getPropertyValue("--tq-particle-a"), { r: 45, g: 132, b: 255 }), factor);
		this.targetSecondary = deepen(hexToRgb(style.getPropertyValue("--tq-particle-b"), { r: 124, g: 86, b: 255 }), factor);
		this.targetWarm = deepen(hexToRgb(style.getPropertyValue("--tq-particle-c"), { r: 0, g: 245, b: 212 }), factor);
		this.targetStateColor = deepen(hexToRgb(style.getPropertyValue("--tq-state"), this.targetPrimary), factor);
	}

	private targetAttraction(): number {
		if (this.reducedMotion) return this.awake ? 1 : 0.08;
		if (!this.awake) return this.state === "idle" ? 0.055 : 0.08;
		if (this.state === "reco") return 0.99;
		if (this.state === "listen") return 0.96;
		if (this.state === "think") return 0.95;
		if (this.state === "speak") return 0.97;
		return 0.92;
	}

	private stateEnergy(time: number): number {
		const pulse = (Math.sin(time * 0.0032) + 1) / 2;
		if (this.state === "listen") return Math.max(this.smoothedLevel, 0.1 + pulse * 0.08);
		if (this.state === "reco") return 0.2 + pulse * 0.1;
		if (this.state === "think") return 0.38 + Math.sin(time * 0.0054) * 0.12;
		if (this.state === "speak") return 0.28 + this.smoothedOutput * 0.5 + Math.sin(time * 0.011) * 0.08;
		return 0.05 + pulse * 0.03;
	}

	private neonCloudColor(seed: number, time: number): Rgb {
		const palette: Rgb[] = [
			{ r: 0, g: 255, b: 210 },
			{ r: 45, g: 225, b: 255 },
			{ r: 65, g: 125, b: 255 },
			{ r: 154, g: 88, b: 255 },
			{ r: 255, g: 72, b: 210 },
			{ r: 255, g: 184, b: 64 },
		];
		const phase = ((seed + time * 0.000018) % 1 + 1) % 1;
		const position = phase * palette.length;
		const index = Math.floor(position) % palette.length;
		return mix(palette[index], palette[(index + 1) % palette.length], position - Math.floor(position));
	}

	private particleColor(particle: Particle, energy: number, time: number): Rgb {
		const shimmer = (Math.sin(particle.phase + time * 0.0028 + particle.logoX * 8) + 1) / 2;
		if (!this.awake) return mix(this.neonCloudColor(particle.colorMix, time), WHITE, shimmer * 0.08);
		const electricCyan: Rgb = { r: 72, g: 224, b: 255 };
		const electricViolet: Rgb = { r: 174, g: 104, b: 255 };
		const spectral = particle.colorMix < 0.34
			? mix(this.primary, electricCyan, 0.58)
			: particle.colorMix < 0.68
				? mix(this.primary, this.secondary, 0.4 + shimmer * 0.32)
				: mix(electricCyan, electricViolet, shimmer * 0.72);
		let color: Rgb = spectral;
		if (this.state === "listen") color = mix(spectral, this.targetWarm, 0.28 + energy * 0.42);
		else if (this.state === "reco") color = mix(spectral, WHITE, 0.18 + shimmer * 0.32);
		else if (this.state === "think") color = mix(spectral, electricViolet, 0.36 + shimmer * 0.42);
		if (this.state === "speak") {
			const cycle = (Math.sin(time * 0.0036 + particle.phase) + 1) / 2;
			color = mix(mix(this.warm, electricCyan, cycle), electricViolet, Math.max(0, cycle - 0.58));
		}
		else if (this.state !== "listen" && this.state !== "reco" && this.state !== "think") {
			color = mix(spectral, this.stateColor, 0.5);
		}
		return this.lightSurface ? color : mix(color, WHITE, 0.12);
	}

	private eyeColor(time: number): Rgb {
		if (!this.awake || this.state === "sleep") return mix(this.primary, WHITE, 0.16);
		if (this.state === "idle") return mix(this.primary, WHITE, 0.28);
		if (this.state === "listen") return mix(this.warm, WHITE, 0.14 + this.smoothedLevel * 0.22);
		if (this.state === "reco") return mix(this.stateColor, WHITE, 0.46);
		if (this.state === "think") return mix(this.secondary, this.stateColor, 0.34);
		const cycle = (Math.sin(time * 0.0042) + 1) / 2;
		return cycle < 0.5
			? mix(this.warm, this.primary, cycle * 2)
			: mix(this.primary, this.secondary, (cycle - 0.5) * 2);
	}

	/** 圆形粒子主体 + 小范围高光；避免每点创建渐变，保持 6k+ 粒子的实时性能。 */
	private drawSphereParticle(
		context: CanvasRenderingContext2D,
		x: number,
		y: number,
		radius: number,
		color: Rgb,
		alpha: number,
		highlight: boolean
	): void {
		const safeRadius = Math.max(0.62, radius);
		context.beginPath();
		context.arc(x, y, safeRadius, 0, Math.PI * 2);
		context.fillStyle = rgba(color, alpha);
		context.fill();
		if (!highlight) return;
		context.beginPath();
		context.arc(
			x - safeRadius * 0.28,
			y - safeRadius * 0.32,
			Math.max(0.3, safeRadius * 0.24),
			0,
			Math.PI * 2
		);
		context.fillStyle = rgba(WHITE, Math.min(0.72, alpha * 0.62));
		context.fill();
	}

	private drawParticleEyes(
		centerX: number,
		centerY: number,
		scale: number,
		energy: number,
		time: number
	): void {
		const stateEyeColor = this.eyeColor(time);
		const blinkCycle = this.awake ? 5200 : 6400;
		const blinkPhase = time % blinkCycle;
		const blink = (this.state === "sleep" || this.state === "listen") && blinkPhase < 170
			? Math.sin((blinkPhase / 170) * Math.PI)
			: 0;
		const verticalScale = Math.max(0.12, 1 - blink * 0.9);
		const baseAlpha = !this.awake ? 0.5
			: this.state === "idle" ? 0.62
				: 0.82 + Math.max(this.smoothedLevel, this.smoothedOutput) * 0.16;

		for (let index = 0; index < this.eyeParticles.length; index++) {
			const particle = this.eyeParticles[index];
			const eyeColor = this.awake
				? stateEyeColor
				: this.neonCloudColor(particle.phase / (Math.PI * 2), time);
			const eyeCenterX = particle.side * 0.155;
			let localX = particle.baseX;
			let localY = -0.095 + (particle.baseY + 0.095) * verticalScale;
			const eyeOrbit = particle.phase + time * 0.00014;
			const eyeFreeX = Math.cos(eyeOrbit) * (0.2 + (index % 17) * 0.018);
			const eyeFreeY = Math.sin(eyeOrbit * 0.83) * (0.14 + (index % 13) * 0.016);
			const eyeAttraction = this.awake ? Math.min(1, this.attraction + 0.04) : this.attraction * 0.75;
			localX = eyeFreeX + (localX - eyeFreeX) * eyeAttraction;
			localY = eyeFreeY + (localY - eyeFreeY) * eyeAttraction;
			let stateAlpha = baseAlpha;
			if (!this.reducedMotion && this.state === "reco") {
				const alternate = (Math.sin(time * 0.011 + (particle.side > 0 ? Math.PI : 0)) + 1) / 2;
				stateAlpha *= 0.58 + alternate * 0.42;
				localX += Math.sin(particle.phase + time * 0.012) * 0.004;
			} else if (!this.reducedMotion && this.state === "think") {
				const dx = localX - eyeCenterX;
				const dy = localY + 0.095;
				const turn = Math.sin(time * 0.003 + particle.phase) * 0.08;
				localX = eyeCenterX + dx * Math.cos(turn) - dy * Math.sin(turn);
				localY = -0.095 + dx * Math.sin(turn) + dy * Math.cos(turn);
			} else if (!this.reducedMotion && this.state === "speak") {
				localY += Math.sin(time * 0.014 + particle.phase) * (0.002 + this.smoothedOutput * 0.006);
			}

			const px = centerX + localX * scale * 2;
			const py = centerY + localY * scale * 2;
			const pulse = this.reducedMotion ? 1 : 0.82 + (Math.sin(time * 0.006 + particle.phase) + 1) * 0.16;
			const size = Math.max(0.72, particle.size * pulse * (1 + energy * 0.38));
			if (index % 20 === 0) {
				this.front.beginPath();
				this.front.arc(px, py, size * 3.2, 0, Math.PI * 2);
				this.front.fillStyle = rgba(eyeColor, stateAlpha * 0.12);
				this.front.fill();
			}
			this.drawSphereParticle(
				this.front,
				px,
				py,
				size,
				eyeColor,
				stateAlpha,
				index % 10 === 0
			);
		}
	}

	private render(time: number): void {
		if (this.disposed) return;
		if (!this.documentVisible || this.width <= 1 || this.height <= 1) {
			this.frame = this.activeWindow.requestAnimationFrame((next) => this.render(next));
			return;
		}
		const frameInterval = this.reducedMotion
			? REDUCED_MOTION_FRAME_INTERVAL
			: !this.awake ? SLEEP_FRAME_INTERVAL : ACTIVE_FRAME_INTERVAL;
		if (this.lastTime && time - this.lastTime < frameInterval) {
			this.frame = this.activeWindow.requestAnimationFrame((next) => this.render(next));
			return;
		}
		const delta = Math.min(180, Math.max(8, time - (this.lastTime || time)));
		this.lastTime = time;
		this.smoothedLevel += (this.audioLevel - this.smoothedLevel) * Math.min(1, delta / 70);
		this.audioLevel *= Math.pow(0.92, delta / ACTIVE_FRAME_INTERVAL);
		this.smoothedOutput += (this.outputLevel - this.smoothedOutput) * Math.min(1, delta / 90);
		this.outputLevel *= Math.pow(0.94, delta / ACTIVE_FRAME_INTERVAL);
		if (time - this.lastPaletteCheck >= 1000) {
			this.lastPaletteCheck = time;
			this.syncPalette();
		}
		this.primary = lerpRgb(this.primary, this.targetPrimary, 0.08);
		this.secondary = lerpRgb(this.secondary, this.targetSecondary, 0.08);
		this.warm = lerpRgb(this.warm, this.targetWarm, 0.08);
		this.stateColor = lerpRgb(this.stateColor, this.targetStateColor, 0.08);
		const attractionEase = 1 - Math.pow(1 - (this.awake ? 0.22 : 0.07), delta / 16.67);
		this.attraction += (this.targetAttraction() - this.attraction) * attractionEase;

		this.back.clearRect(0, 0, this.width, this.height);
		this.front.clearRect(0, 0, this.width, this.height);
		const composite: GlobalCompositeOperation = this.lightSurface ? "source-over" : "lighter";
		this.back.globalCompositeOperation = composite;
		this.front.globalCompositeOperation = composite;

		const animationTime = this.reducedMotion ? 0 : time;
		const energy = this.reducedMotion ? 0.06 : this.stateEnergy(time);
		const centerX = this.width * 0.5;
		const centerY = this.height * (this.width <= 620 ? 0.43 : 0.46);
		const baseRadius = Math.max(100, Math.min(this.width * (this.awake ? 0.31 : 0.285), this.height * 0.35, 340));
		const scale = baseRadius * (1 + energy * (this.awake ? 0.045 : 0.018));
		const pointerNormX = this.pointerX * (this.width / Math.max(1, scale * 2));
		const pointerNormY = this.pointerY * (this.height / Math.max(1, scale * 2));
		const particleEase = 1 - Math.pow(1 - (this.awake ? 0.22 : 0.085), delta / 16.67);

		for (let index = 0; index < this.particles.length; index++) {
			const particle = this.particles[index];
			const orbit = particle.freeAngle + animationTime * 0.000085 * particle.freeSpeed;
			const freeBreath = 1 + Math.sin(animationTime * 0.0007 + particle.phase) * 0.18;
			const freeX = Math.cos(orbit) * particle.freeRadius * freeBreath
				+ Math.sin(animationTime * 0.00034 + particle.phase) * 0.11;
			const freeY = Math.sin(orbit * 0.87) * particle.freeRadius * 0.72 * freeBreath
				+ Math.cos(animationTime * 0.00031 + particle.phase) * 0.09;

			let logoX = particle.logoX;
			let logoY = particle.logoY;
			const radius = Math.max(0.001, Math.hypot(logoX, logoY));
			if (!this.reducedMotion) {
				const ambient = Math.sin(animationTime * 0.0008 + particle.phase + radius * 9)
					* (this.awake ? 0.012 + particle.layer * 0.007 : 0.024);
				logoX += (logoX / radius) * ambient;
				logoY += (logoY / radius) * ambient;
				if (this.awake) {
					logoX += Math.sin(animationTime * 0.0017 + particle.phase * 1.7) * 0.009;
					logoY += Math.cos(animationTime * 0.0015 + particle.phase * 1.3) * 0.009;
				}
				if (this.state === "listen" && this.awake) {
					const breath = this.smoothedLevel * (0.024 + particle.layer * 0.016);
					logoX *= 1 + breath;
					logoY *= 1 + breath;
				} else if (this.state === "reco" && this.awake) {
					const scanY = ((animationTime - this.stateEnteredAt) % 720) / 720 - 0.5;
					const push = Math.max(0, 1 - Math.abs(logoY - scanY) / 0.09) * 0.021;
					logoX += Math.sin(particle.phase + animationTime * 0.008) * push;
				} else if (this.state === "think" && this.awake) {
					const swirl = Math.sin(animationTime * 0.0027 + radius * 12 + particle.phase) * 0.017;
					logoX += -particle.logoY * swirl;
					logoY += particle.logoX * swirl;
				} else if (this.state === "speak" && this.awake) {
					const wave = Math.sin(animationTime * 0.012 - radius * 18 + particle.phase)
						* (0.006 + this.smoothedOutput * 0.018);
					logoX *= 1 + wave;
					logoY *= 1 + wave;
				}
			}

			// 休眠时全部粒子脱离形状进入无序轨道；唤醒后快速磁吸，但保留边缘流动。
			const particleAttraction = this.awake
				? Math.min(1, this.attraction + particle.layer * 0.035)
				: this.attraction * (0.62 + particle.layer * 0.22);
			let targetX = freeX + (logoX - freeX) * particleAttraction;
			let targetY = freeY + (logoY - freeY) * particleAttraction;
			if (this.pointerInside && !this.reducedMotion) {
				const dx = targetX - pointerNormX;
				const dy = targetY - pointerNormY;
				const distance = Math.max(0.025, Math.hypot(dx, dy));
				const influence = Math.max(0, 1 - distance / 0.3) * (this.awake ? 0.026 : 0.072);
				targetX += (dx / distance) * influence;
				targetY += (dy / distance) * influence;
			}
			if (!this.reducedMotion) {
				const flow = (this.awake ? 0.003 : 0.008) + particle.layer * (this.awake ? 0.003 : 0.005);
				targetX += Math.sin(animationTime * 0.0015 + particle.phase * 1.9) * flow;
				targetY += Math.cos(animationTime * 0.0013 + particle.phase * 1.6) * flow;
			}

			particle.currentX += (targetX - particle.currentX) * particleEase;
			particle.currentY += (targetY - particle.currentY) * particleEase;
			const px = centerX + particle.currentX * scale * 2;
			const py = centerY + particle.currentY * scale * 2;
			const color = this.particleColor(particle, energy, animationTime);
			const twinkle = this.reducedMotion ? 0.82 : 0.68 + (Math.sin(animationTime * 0.0016 + particle.phase) + 1) * 0.15;
			const logoClarity = 0.18 + particleAttraction * 0.72;
			const alpha = this.awake
				? logoClarity * twinkle * (0.56 + particle.layer * 0.5) * (this.lightSurface ? 0.88 : 1)
				: (0.42 + particle.layer * 0.34) * twinkle * (this.lightSurface ? 0.9 : 1);
			const spherePulse = this.reducedMotion
				? 1
				: 0.88 + (Math.sin(animationTime * 0.0038 + particle.phase * 1.4) + 1) * 0.12;
			const size = Math.max(
				0.7,
				particle.size * (0.76 + particle.layer * 0.54 + energy * 0.3)
					* (this.awake ? 1.08 : 1.22) * spherePulse
			);
			const context = particle.layer > 0.48 ? this.front : this.back;

			if (index % (this.awake ? 24 : 14) === 0) {
				context.beginPath();
				context.arc(px, py, size * (2.1 + energy), 0, Math.PI * 2);
				context.fillStyle = rgba(color, alpha * (this.awake ? 0.08 : 0.16));
				context.fill();
			}
			this.drawSphereParticle(
				context,
				px,
				py,
				size,
				color,
				alpha,
				index % 11 === 0
			);
		}

		this.drawParticleEyes(centerX, centerY, scale, energy, animationTime);

		if (!this.disposed) {
			this.frame = this.activeWindow.requestAnimationFrame((next) => this.render(next));
		}
	}
}

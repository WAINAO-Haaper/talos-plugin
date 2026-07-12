/**
 * GridScan 3D 网格扫描背景——移植自 ReactBits 的 <GridScan /> 组件。
 *
 * 原 React 版本依赖 three.js + postprocessing + face-api.js（合计 ~1MB），
 * 这里改写为纯原生 WebGL2，零外部依赖。
 *
 * 保留的核心效果：
 *   - raymarching 透视网格（solid / dashed / dotted 三种线型）
 *   - 扫描线脉冲（pingpong 方向，定期掠过）
 *   - 鼠标移动驱动 3D 透视倾斜（smoothDamp 平滑）
 *   - 网格线抖动（jitter）
 *   - 胶片噪声（film grain）
 *
 * 去掉的部分（过于重或有隐私顾虑）：
 *   - 摄像头人脸追踪（face-api.js）
 *   - 陀螺仪方向感应
 *   - bloom / 色差后处理（postprocessing 库）
 *   - click 触发额外扫描
 *
 * 调色板随屈原语音状态切换——网格线色 + 扫描线色协调变化。
 */

export type GridScanVoiceState = "sleep" | "idle" | "listen" | "reco" | "think" | "speak";

interface Palette {
	lines: [number, number, number]; // sRGB linear
	scan: [number, number, number];
}

/** 每个语音状态对应网格线色 + 扫描线色（提亮版本，保证深色背景上高对比可见） */
const STATE_PALETTES: Record<GridScanVoiceState, Palette> = {
	sleep:  { lines: hexToLinear("#475569"), scan: hexToLinear("#94a3b8") },
	idle:   { lines: hexToLinear("#3b82f6"), scan: hexToLinear("#60a5fa") },
	listen: { lines: hexToLinear("#0ea5e9"), scan: hexToLinear("#7dd3fc") },
	reco:   { lines: hexToLinear("#38bdf8"), scan: hexToLinear("#bae6fd") },
	think:  { lines: hexToLinear("#8b5cf6"), scan: hexToLinear("#c4b5fd") },
	speak:  { lines: hexToLinear("#2dd4bf"), scan: hexToLinear("#99f6e4") },
};

/** hex → 原始 sRGB 归一化值（不做 gamma 转换，保证颜色数值足够大，在深色背景上可见） */
function hexToLinear(hex: string): [number, number, number] {
	const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
	const normalized = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(normalized);
	if (!result) return [0, 0, 0];
	// 直接归一化到 0~1（不做 gamma 转换），保持色值足够大
	return [
		parseInt(result[1], 16) / 255,
		parseInt(result[2], 16) / 255,
		parseInt(result[3], 16) / 255,
	];
}

// ============================================================
// Shaders（WebGL2 `#version 300 es`）
// ============================================================

const VERT_SRC = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main(){
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;
uniform vec3 iResolution;
uniform float iTime;
uniform vec2 uSkew;
uniform float uTilt;
uniform float uYaw;
uniform float uLineThickness;
uniform vec3 uLinesColor;
uniform vec3 uScanColor;
uniform float uGridScale;
uniform float uLineStyle;
uniform float uLineJitter;
uniform float uScanOpacity;
uniform float uScanDirection;
uniform float uNoise;
uniform float uBloomOpacity;
uniform float uScanGlow;
uniform float uScanSoftness;
uniform float uPhaseTaper;
uniform float uScanDuration;
uniform float uScanDelay;
in vec2 vUv;
out vec4 fragColor;

float smoother01(float a, float b, float x){
  float t = clamp((x - a) / max(1e-5, (b - a)), 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

void main(){
  vec2 fragCoord = vUv * iResolution.xy;
  vec2 p = (2.0 * fragCoord - iResolution.xy) / iResolution.y;

  vec3 ro = vec3(0.0);
  vec3 rd = normalize(vec3(p, 2.0));

  float cR = cos(uTilt), sR = sin(uTilt);
  rd.xy = mat2(cR, -sR, sR, cR) * rd.xy;

  float cY = cos(uYaw), sY = sin(uYaw);
  rd.xz = mat2(cY, -sY, sY, cY) * rd.xz;

  vec2 skew = clamp(uSkew, vec2(-0.7), vec2(0.7));
  rd.xy += skew * rd.z;

  vec3 color = vec3(0.0);
  float minT = 1e20;
  float gridScale = max(1e-5, uGridScale);
  float fadeStrength = 0.8;
  vec2 gridUV = vec2(0.0);
  float hitIsY = 1.0;

  for (int i = 0; i < 4; i++) {
    float isY = float(i < 2);
    float pos = mix(-0.2, 0.2, float(i)) * isY + mix(-0.5, 0.5, float(i - 2)) * (1.0 - isY);
    float num = pos - (isY * ro.y + (1.0 - isY) * ro.x);
    float den = isY * rd.y + (1.0 - isY) * rd.x;
    float t = num / den;
    vec3 h = ro + rd * t;
    float depthBoost = smoothstep(0.0, 3.0, h.z);
    h.xy += skew * 0.15 * depthBoost;
    bool use = t > 0.0 && t < minT;
    gridUV = use ? mix(h.zy, h.xz, isY) / gridScale : gridUV;
    minT = use ? t : minT;
    hitIsY = use ? isY : hitIsY;
  }

  vec3 hit = ro + rd * minT;
  float dist = length(hit - ro);

  float jitterAmt = clamp(uLineJitter, 0.0, 1.0);
  if (jitterAmt > 0.0) {
    vec2 j = vec2(
      sin(gridUV.y * 2.7 + iTime * 1.8),
      cos(gridUV.x * 2.3 - iTime * 1.6)
    ) * (0.15 * jitterAmt);
    gridUV += j;
  }
  float fx = fract(gridUV.x);
  float fy = fract(gridUV.y);
  float ax = min(fx, 1.0 - fx);
  float ay = min(fy, 1.0 - fy);
  float wx = fwidth(gridUV.x);
  float wy = fwidth(gridUV.y);
  float halfPx = max(0.0, uLineThickness) * 0.5;
  float tx = halfPx * wx;
  float ty = halfPx * wy;
  float aax = wx;
  float aay = wy;
  float lineX = 1.0 - smoothstep(tx, tx + aax, ax);
  float lineY = 1.0 - smoothstep(ty, ty + aay, ay);
  if (uLineStyle > 0.5) {
    float dashRepeat = 4.0;
    float dashDuty = 0.5;
    float vy = fract(gridUV.y * dashRepeat);
    float vx = fract(gridUV.x * dashRepeat);
    float dashMaskY = step(vy, dashDuty);
    float dashMaskX = step(vx, dashDuty);
    if (uLineStyle < 1.5) {
      lineX *= dashMaskY;
      lineY *= dashMaskX;
    } else {
      float dotRepeat = 6.0;
      float dotWidth = 0.18;
      float cy = abs(fract(gridUV.y * dotRepeat) - 0.5);
      float cx = abs(fract(gridUV.x * dotRepeat) - 0.5);
      float dotMaskY = 1.0 - smoothstep(dotWidth, dotWidth + fwidth(gridUV.y * dotRepeat), cy);
      float dotMaskX = 1.0 - smoothstep(dotWidth, dotWidth + fwidth(gridUV.x * dotRepeat), cx);
      lineX *= dotMaskY;
      lineY *= dotMaskX;
    }
  }
  float primaryMask = max(lineX, lineY);

  vec2 gridUV2 = (hitIsY > 0.5 ? hit.xz : hit.zy) / gridScale;
  if (jitterAmt > 0.0) {
    vec2 j2 = vec2(
      cos(gridUV2.y * 2.1 - iTime * 1.4),
      sin(gridUV2.x * 2.5 + iTime * 1.7)
    ) * (0.15 * jitterAmt);
    gridUV2 += j2;
  }
  float fx2 = fract(gridUV2.x);
  float fy2 = fract(gridUV2.y);
  float ax2 = min(fx2, 1.0 - fx2);
  float ay2 = min(fy2, 1.0 - fy2);
  float wx2 = fwidth(gridUV2.x);
  float wy2 = fwidth(gridUV2.y);
  float tx2 = halfPx * wx2;
  float ty2 = halfPx * wy2;
  float aax2 = wx2;
  float aay2 = wy2;
  float lineX2 = 1.0 - smoothstep(tx2, tx2 + aax2, ax2);
  float lineY2 = 1.0 - smoothstep(ty2, ty2 + aay2, ay2);
  if (uLineStyle > 0.5) {
    float dashRepeat2 = 4.0;
    float dashDuty2 = 0.5;
    float vy2m = fract(gridUV2.y * dashRepeat2);
    float vx2m = fract(gridUV2.x * dashRepeat2);
    float dashMaskY2 = step(vy2m, dashDuty2);
    float dashMaskX2 = step(vx2m, dashDuty2);
    if (uLineStyle < 1.5) {
      lineX2 *= dashMaskY2;
      lineY2 *= dashMaskX2;
    } else {
      float dotRepeat2 = 6.0;
      float dotWidth2 = 0.18;
      float cy2 = abs(fract(gridUV2.y * dotRepeat2) - 0.5);
      float cx2 = abs(fract(gridUV2.x * dotRepeat2) - 0.5);
      float dotMaskY2 = 1.0 - smoothstep(dotWidth2, dotWidth2 + fwidth(gridUV2.y * dotRepeat2), cy2);
      float dotMaskX2 = 1.0 - smoothstep(dotWidth2, dotWidth2 + fwidth(gridUV2.x * dotRepeat2), cx2);
      lineX2 *= dotMaskY2;
      lineY2 *= dotMaskX2;
    }
  }
  float altMask = max(lineX2, lineY2);

  float edgeDistX = min(abs(hit.x - (-0.5)), abs(hit.x - 0.5));
  float edgeDistY = min(abs(hit.y - (-0.2)), abs(hit.y - 0.2));
  float edgeDist = mix(edgeDistY, edgeDistX, hitIsY);
  float edgeGate = 1.0 - smoothstep(gridScale * 0.5, gridScale * 2.0, edgeDist);
  altMask *= edgeGate;

  float lineMask = max(primaryMask, altMask);
  float fade = exp(-dist * fadeStrength);

  float dur = max(0.05, uScanDuration);
  float del = max(0.0, uScanDelay);
  float scanZMax = 2.0;
  float widthScale = max(0.1, uScanGlow);
  float sigma = max(0.001, 0.18 * widthScale * uScanSoftness);
  float sigmaA = sigma * 2.0;

  float combinedPulse = 0.0;
  float combinedAura = 0.0;

  float cycle = dur + del;
  float tCycle = mod(iTime, cycle);
  float scanPhase = clamp((tCycle - del) / dur, 0.0, 1.0);
  float phase = scanPhase;
  if (uScanDirection > 0.5 && uScanDirection < 1.5) {
    phase = 1.0 - phase;
  } else if (uScanDirection > 1.5) {
    float t2 = mod(max(0.0, iTime - del), 2.0 * dur);
    phase = (t2 < dur) ? (t2 / dur) : (1.0 - (t2 - dur) / dur);
  }
  float scanZ = phase * scanZMax;
  float dz = abs(hit.z - scanZ);
  float lineBand = exp(-0.5 * (dz * dz) / (sigma * sigma));
  float taper = clamp(uPhaseTaper, 0.0, 0.49);
  float headW = taper;
  float tailW = taper;
  float headFade = smoother01(0.0, headW, phase);
  float tailFade = 1.0 - smoother01(1.0 - tailW, 1.0, phase);
  float phaseWindow = headFade * tailFade;
  float pulseBase = lineBand * phaseWindow;
  combinedPulse += pulseBase * clamp(uScanOpacity, 0.0, 1.0);
  float auraBand = exp(-0.5 * (dz * dz) / (sigmaA * sigmaA));
  combinedAura += (auraBand * 0.25) * phaseWindow * clamp(uScanOpacity, 0.0, 1.0);

  float lineVis = lineMask;
  vec3 gridCol = uLinesColor * lineVis * fade * 4.0;
  vec3 scanCol = uScanColor * combinedPulse;
  vec3 scanAura = uScanColor * combinedAura;
  color = gridCol + scanCol + scanAura;

  float n = fract(sin(dot(gl_FragCoord.xy + vec2(iTime * 123.4), vec2(12.9898, 78.233))) * 43758.5453123);
  color += (n - 0.5) * uNoise;
  color = clamp(color, 0.0, 1.0);
  float alpha = clamp(max(lineVis, combinedPulse), 0.0, 1.0);
  float gx = 1.0 - smoothstep(tx * 2.0, tx * 2.0 + aax * 2.0, ax);
  float gy = 1.0 - smoothstep(ty * 2.0, ty * 2.0 + aay * 2.0, ay);
  float halo = max(gx, gy) * fade;
  alpha = max(alpha, halo * clamp(uBloomOpacity, 0.0, 1.0));
  fragColor = vec4(color, alpha);
}
`;

// ============================================================
// smoothDamp（移植自原版，用于鼠标平滑跟踪）
// ============================================================

function smoothDampFloat(current: number, target: number, velRef: { v: number }, smoothTime: number, maxSpeed: number, dt: number): number {
	smoothTime = Math.max(0.0001, smoothTime);
	const omega = 2 / smoothTime;
	const x = omega * dt;
	const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
	let change = current - target;
	const maxChange = maxSpeed * smoothTime;
	change = Math.sign(change) * Math.min(Math.abs(change), maxChange);
	target = current - change;
	const temp = (velRef.v + omega * change) * dt;
	velRef.v = (velRef.v - omega * temp) * exp;
	let out = target + (change + temp) * exp;
	const origMinusCurrent = target - current;
	const outMinusOrig = out - target;
	if (origMinusCurrent * outMinusOrig > 0) {
		out = target;
		velRef.v = 0;
	}
	return out;
}

// ============================================================
// GridScanField
// ============================================================

export class GridScanField {
	private canvas: HTMLCanvasElement;
	private gl: WebGL2RenderingContext | null = null;
	private program: WebGLProgram | null = null;
	private vao: WebGLVertexArrayObject | null = null;
	private uniforms: Record<string, WebGLUniformLocation | null> = {};
	private rafId: number | null = null;
	private running = false;

	// 鼠标跟踪状态
	private lookTarget = { x: 0, y: 0 };
	private lookCurrent = { x: 0, y: 0 };
	private lookVelX = 0;
	private lookVelY = 0;
	private tiltCurrent = 0;
	private tiltVel = { v: 0 };
	private yawCurrent = 0;
	private yawVel = { v: 0 };
	private leaveTimer: number | null = null;

	// 灵敏度参数（对应原版 sensitivity=0.55）
	private readonly skewScale = 0.14;   // lerp(0.06, 0.2, 0.55)
	private readonly tiltScale = 0.21;   // lerp(0.12, 0.3, 0.55)
	private readonly yawScale = 0.19;    // lerp(0.1, 0.28, 0.55)
	private readonly yBoost = 1.42;      // lerp(1.2, 1.6, 0.55)
	private readonly smoothTime = 0.285; // lerp(0.45, 0.12, 0.55)

	private palette: Palette = STATE_PALETTES.idle;
	private lastTime = 0;

	// 可调参数（提亮版，保证深色背景上高对比可见）
	private readonly gridScale = 0.1;
	private readonly lineThickness = 2;
	private readonly lineStyle = 0; // solid
	private readonly lineJitter = 0.1;
	private readonly scanOpacity = 0.75;
	private readonly scanDirection = 2; // pingpong
	private readonly noiseIntensity = 0.01;
	private readonly bloomOpacity = 0.3; // 线条光晕
	private readonly scanGlow = 0.7;
	private readonly scanSoftness = 2;
	private readonly scanPhaseTaper = 0.9;
	private readonly scanDuration = 1.5;
	private readonly scanDelay = 1.5;

	constructor(canvas: HTMLCanvasElement) {
		this.canvas = canvas;
	}

	setState(state: GridScanVoiceState): void {
		this.palette = STATE_PALETTES[state] ?? STATE_PALETTES.idle;
	}

	start(): void {
		if (this.running) return;
		const gl = this.canvas.getContext("webgl2", { antialias: true, alpha: true, premultipliedAlpha: false });
		if (!gl) {
			console.error("TALOS GridScan: WebGL2 not supported");
			return;
		}
		this.gl = gl;
		if (!this.initGL()) return;
		this.resize();
		this.attachMouse();
		this.running = true;
		this.lastTime = performance.now();
		this.loop();
	}

	destroy(): void {
		this.running = false;
		if (this.rafId != null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
		this.detachMouse();
		const gl = this.gl;
		if (gl) {
			if (this.program) gl.deleteProgram(this.program);
			if (this.vao) gl.deleteVertexArray(this.vao);
			gl.getExtension("WEBGL_lose_context")?.loseContext();
		}
		this.gl = null;
		this.program = null;
		this.vao = null;
	}

	onResize(): void {
		if (this.running) this.resize();
	}

	// ---------- GL 初始化 ----------

	private compileShader(type: number, src: string): WebGLShader | null {
		const gl = this.gl!;
		const shader = gl.createShader(type);
		if (!shader) return null;
		gl.shaderSource(shader, src);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			console.error("TALOS GridScan shader compile error:", gl.getShaderInfoLog(shader));
			gl.deleteShader(shader);
			return null;
		}
		return shader;
	}

	private initGL(): boolean {
		const gl = this.gl!;
		const vs = this.compileShader(gl.VERTEX_SHADER, VERT_SRC);
		const fs = this.compileShader(gl.FRAGMENT_SHADER, FRAG_SRC);
		if (!vs || !fs) return false;
		const program = gl.createProgram();
		if (!program) return false;
		gl.attachShader(program, vs);
		gl.attachShader(program, fs);
		gl.linkProgram(program);
		gl.deleteShader(vs);
		gl.deleteShader(fs);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			console.error("TALOS GridScan program link error:", gl.getProgramInfoLog(program));
			gl.deleteProgram(program);
			return false;
		}
		this.program = program;
		gl.useProgram(program);

		// 全屏 quad（两个三角形）
		const vao = gl.createVertexArray();
		gl.bindVertexArray(vao);
		const buf = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
		const posLoc = gl.getAttribLocation(program, "aPos");
		gl.enableVertexAttribArray(posLoc);
		gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
		this.vao = vao;

		// 缓存 uniform locations
		const uniNames = [
			"iResolution", "iTime", "uSkew", "uTilt", "uYaw",
			"uLineThickness", "uLinesColor", "uScanColor", "uGridScale",
			"uLineStyle", "uLineJitter", "uScanOpacity", "uScanDirection",
			"uNoise", "uBloomOpacity", "uScanGlow", "uScanSoftness",
			"uPhaseTaper", "uScanDuration", "uScanDelay",
		];
		for (const name of uniNames) {
			this.uniforms[name] = gl.getUniformLocation(program, name);
		}

		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		return true;
	}

	private resize(): void {
		const gl = this.gl;
		if (!gl) return;
		const parent = this.canvas.parentElement;
		if (!parent) return;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const w = Math.max(1, Math.floor(parent.clientWidth * dpr));
		const h = Math.max(1, Math.floor(parent.clientHeight * dpr));
		this.canvas.width = w;
		this.canvas.height = h;
		this.canvas.style.width = `${parent.clientWidth}px`;
		this.canvas.style.height = `${parent.clientHeight}px`;
		gl.viewport(0, 0, w, h);
	}

	// ---------- 鼠标跟踪 ----------

	private onMouseMove = (e: MouseEvent): void => {
		if (this.leaveTimer != null) {
			window.clearTimeout(this.leaveTimer);
			this.leaveTimer = null;
		}
		const rect = this.canvas.getBoundingClientRect();
		const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
		const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
		this.lookTarget.x = nx;
		this.lookTarget.y = ny;
	};

	private onMouseLeave = (): void => {
		if (this.leaveTimer != null) window.clearTimeout(this.leaveTimer);
		this.leaveTimer = window.setTimeout(() => {
			this.lookTarget.x = 0;
			this.lookTarget.y = 0;
		}, 250);
	};

	private attachMouse(): void {
		this.canvas.addEventListener("mousemove", this.onMouseMove);
		this.canvas.addEventListener("mouseleave", this.onMouseLeave);
	}

	private detachMouse(): void {
		this.canvas.removeEventListener("mousemove", this.onMouseMove);
		this.canvas.removeEventListener("mouseleave", this.onMouseLeave);
		if (this.leaveTimer != null) {
			window.clearTimeout(this.leaveTimer);
			this.leaveTimer = null;
		}
	}

	// ---------- 渲染循环 ----------

	private loop = (): void => {
		if (!this.running || !this.gl || !this.program) return;
		const gl = this.gl;
		gl.useProgram(this.program);
		const now = performance.now();
		const dt = Math.max(0, Math.min(0.1, (now - this.lastTime) / 1000));
		this.lastTime = now;

		// smoothDamp 鼠标位置
		this.lookCurrent.x = smoothDampFloat(this.lookCurrent.x, this.lookTarget.x, { v: this.lookVelX }, this.smoothTime, Infinity, dt);
		this.lookCurrent.y = smoothDampFloat(this.lookCurrent.y, this.lookTarget.y, { v: this.lookVelY }, this.smoothTime, Infinity, dt);
		this.tiltCurrent = smoothDampFloat(this.tiltCurrent, this.lookTarget.x * 0.4, this.tiltVel, this.smoothTime, Infinity, dt);
		this.yawCurrent = smoothDampFloat(this.yawCurrent, this.lookTarget.y * 0.3, this.yawVel, this.smoothTime, Infinity, dt);

		const skewX = this.lookCurrent.x * this.skewScale;
		const skewY = -this.lookCurrent.y * this.yBoost * this.skewScale;
		const tilt = this.tiltCurrent * this.tiltScale;
		const yaw = Math.max(-0.6, Math.min(0.6, this.yawCurrent * this.yawScale));

		// 上传 uniforms
		const u = this.uniforms;
		gl.uniform3f(u.iResolution, this.canvas.width, this.canvas.height, Math.min(window.devicePixelRatio || 1, 2));
		gl.uniform1f(u.iTime, now / 1000);
		gl.uniform2f(u.uSkew, skewX, skewY);
		gl.uniform1f(u.uTilt, tilt);
		gl.uniform1f(u.uYaw, yaw);
		gl.uniform1f(u.uLineThickness, this.lineThickness);
		gl.uniform3f(u.uLinesColor, this.palette.lines[0], this.palette.lines[1], this.palette.lines[2]);
		gl.uniform3f(u.uScanColor, this.palette.scan[0], this.palette.scan[1], this.palette.scan[2]);
		gl.uniform1f(u.uGridScale, this.gridScale);
		gl.uniform1f(u.uLineStyle, this.lineStyle);
		gl.uniform1f(u.uLineJitter, this.lineJitter);
		gl.uniform1f(u.uScanOpacity, this.scanOpacity);
		gl.uniform1f(u.uScanDirection, this.scanDirection);
		gl.uniform1f(u.uNoise, this.noiseIntensity);
		gl.uniform1f(u.uBloomOpacity, this.bloomOpacity);
		gl.uniform1f(u.uScanGlow, this.scanGlow);
		gl.uniform1f(u.uScanSoftness, this.scanSoftness);
		gl.uniform1f(u.uPhaseTaper, this.scanPhaseTaper);
		gl.uniform1f(u.uScanDuration, this.scanDuration);
		gl.uniform1f(u.uScanDelay, this.scanDelay);

		// 渲染
		if (this.vao) gl.bindVertexArray(this.vao);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.drawArrays(gl.TRIANGLES, 0, 6);

		this.rafId = window.requestAnimationFrame(this.loop);
	};
}

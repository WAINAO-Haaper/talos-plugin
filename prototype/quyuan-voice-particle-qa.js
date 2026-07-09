"use strict";
(() => {
  // src/quyuan/voice-particle-field.ts
  var PARTICLE_COUNT = 840;
  var FRONT_ALPHA = 0.72;
  function hexToRgb(value, fallback) {
    const normalized = value.trim().replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(normalized)) return fallback;
    return {
      r: Number.parseInt(normalized.slice(0, 2), 16),
      g: Number.parseInt(normalized.slice(2, 4), 16),
      b: Number.parseInt(normalized.slice(4, 6), 16)
    };
  }
  function mix(a, b, amount) {
    return {
      r: Math.round(a.r + (b.r - a.r) * amount),
      g: Math.round(a.g + (b.g - a.g) * amount),
      b: Math.round(a.b + (b.b - a.b) * amount)
    };
  }
  function rgba(color, alpha) {
    return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
  }
  var QuyuanVoiceParticleField = class {
    host;
    backCanvas;
    frontCanvas;
    back;
    front;
    particles;
    resizeObserver;
    frame = 0;
    lastTime = 0;
    width = 1;
    height = 1;
    dpr = 1;
    state = "idle";
    audioLevel = 0;
    smoothedLevel = 0;
    reducedMotion = false;
    lightSurface = false;
    stateEnteredAt = 0;
    themeKey = "";
    primary = { r: 45, g: 132, b: 255 };
    secondary = { r: 124, g: 86, b: 255 };
    warm = { r: 255, g: 112, b: 74 };
    stateColor = { r: 45, g: 132, b: 255 };
    constructor(host, backCanvas, frontCanvas) {
      const back2 = backCanvas.getContext("2d");
      const front2 = frontCanvas.getContext("2d");
      if (!back2 || !front2) throw new Error("Canvas 2D unavailable");
      this.host = host;
      this.backCanvas = backCanvas;
      this.frontCanvas = frontCanvas;
      this.back = back2;
      this.front = front2;
      this.particles = this.createParticles();
      this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(host);
      this.resize();
      this.syncPalette(true);
      this.frame = window.requestAnimationFrame((time) => this.render(time));
    }
    setState(state) {
      if (state !== this.state) this.stateEnteredAt = performance.now();
      this.state = state;
      this.syncPalette(true);
    }
    setAudioLevel(level) {
      this.audioLevel = Math.max(0, Math.min(1, level));
    }
    destroy() {
      window.cancelAnimationFrame(this.frame);
      this.resizeObserver.disconnect();
    }
    createParticles() {
      const particles = [];
      const golden = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const y = 1 - i / (PARTICLE_COUNT - 1) * 2;
        particles.push({
          theta: golden * i,
          phi: Math.acos(y),
          shell: 0.68 + i * 37 % 100 / 310,
          size: 0.55 + i * 17 % 19 / 14,
          phase: i * 53 % 360 * (Math.PI / 180),
          speed: 0.72 + i * 29 % 31 / 48,
          colorMix: i * 41 % 100 / 100
        });
      }
      return particles;
    }
    resize() {
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
    syncPalette(force = false) {
      const style = getComputedStyle(this.host);
      const key = [
        style.getPropertyValue("--tq-theme-key"),
        style.getPropertyValue("--tq-particle-a"),
        style.getPropertyValue("--tq-particle-b"),
        style.getPropertyValue("--tq-particle-c"),
        this.state
      ].join("|");
      if (!force && key === this.themeKey) return;
      this.themeKey = key;
      this.primary = hexToRgb(style.getPropertyValue("--tq-particle-a"), { r: 45, g: 132, b: 255 });
      this.secondary = hexToRgb(style.getPropertyValue("--tq-particle-b"), { r: 124, g: 86, b: 255 });
      this.warm = hexToRgb(style.getPropertyValue("--tq-particle-c"), { r: 255, g: 112, b: 74 });
      this.lightSurface = style.colorScheme.includes("light");
      const stateVariable = this.state === "reco" ? "--tq-state-reco" : this.state === "think" ? "--tq-state-think" : this.state === "speak" ? "--tq-state-speak" : "--tq-state-listen";
      this.stateColor = hexToRgb(style.getPropertyValue(stateVariable), this.primary);
    }
    stateMotion() {
      switch (this.state) {
        case "listen":
          return {
            rotationRate: 9e-5,
            xScale: 1.02,
            yScale: 1,
            deformation: 0.22,
            waveRate: 7e-3,
            twist: 0.12,
            orbitCount: 5,
            orbitSquash: 0.38,
            pulseCount: 4
          };
        case "reco":
          return {
            rotationRate: 15e-5,
            xScale: 0.84,
            yScale: 1.08,
            deformation: 0.28,
            waveRate: 0.019,
            twist: 0.38,
            orbitCount: 4,
            orbitSquash: 0.24,
            pulseCount: 5
          };
        case "think":
          return {
            rotationRate: 25e-5,
            xScale: 1.08,
            yScale: 0.82,
            deformation: 0.32,
            waveRate: 0.013,
            twist: 1.35,
            orbitCount: 9,
            orbitSquash: 0.2,
            pulseCount: 3
          };
        case "speak":
          return {
            rotationRate: 19e-5,
            xScale: 1.14,
            yScale: 0.94,
            deformation: 0.42,
            waveRate: 0.026,
            twist: 0.52,
            orbitCount: 7,
            orbitSquash: 0.34,
            pulseCount: 6
          };
        default:
          return {
            rotationRate: 45e-6,
            xScale: 0.94,
            yScale: 0.94,
            deformation: 0.1,
            waveRate: 3e-3,
            twist: 0,
            orbitCount: 3,
            orbitSquash: 0.4,
            pulseCount: 2
          };
      }
    }
    stateEnergy(time) {
      const pulse = (Math.sin(time * 32e-4) + 1) / 2;
      if (this.state === "listen") return Math.max(this.smoothedLevel, 0.1 + pulse * 0.08);
      if (this.state === "reco") return 0.3 + pulse * 0.16;
      if (this.state === "think") return 0.38 + Math.sin(time * 54e-4) * 0.12;
      if (this.state === "speak") {
        return 0.42 + Math.sin(time * 0.011) * 0.16 + Math.sin(time * 0.019) * 0.08;
      }
      return 0.08 + pulse * 0.04;
    }
    stateColorFlow(particle, theta, voiceBand, flow, energy, time) {
      const colorRate = this.state === "speak" ? 38e-4 : this.state === "reco" ? 28e-4 : this.state === "think" ? 21e-4 : 15e-4;
      const shimmer = (Math.sin(particle.phase + theta * 2.4 + time * colorRate) + 1) / 2;
      const band = (voiceBand + 1) / 2;
      const stream = (flow + 1) / 2;
      switch (this.state) {
        case "listen": {
          const breath = Math.min(1, this.smoothedLevel * 1.35 + energy * 0.45);
          const cool = mix(this.primary, this.secondary, 0.18 + shimmer * 0.48);
          return mix(cool, this.stateColor, 0.22 + breath * 0.48);
        }
        case "reco": {
          const scan = mix(this.primary, this.stateColor, 0.34 + band * 0.58);
          return mix(scan, this.secondary, (1 - band) * 0.34 + shimmer * 0.12);
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
    render(time) {
      if (this.lastTime && time - this.lastTime < 30) {
        this.frame = window.requestAnimationFrame((next) => this.render(next));
        return;
      }
      const delta = Math.min(32, Math.max(8, time - (this.lastTime || time)));
      this.lastTime = time;
      this.smoothedLevel += (this.audioLevel - this.smoothedLevel) * Math.min(1, delta / 70);
      this.audioLevel *= 0.92;
      this.syncPalette();
      this.back.clearRect(0, 0, this.width, this.height);
      this.front.clearRect(0, 0, this.width, this.height);
      const composite = this.lightSurface ? "source-over" : "lighter";
      this.back.globalCompositeOperation = composite;
      this.front.globalCompositeOperation = composite;
      const motion = this.stateMotion();
      const animationTime = this.reducedMotion ? 0 : time;
      const transitionKick = this.reducedMotion ? 0 : Math.max(0, 1 - (time - this.stateEnteredAt) / 720) * 0.18;
      const energy = this.reducedMotion ? 0.08 : Math.max(0.04, this.stateEnergy(time) + transitionKick);
      const cx = this.width * 0.5;
      const cy = this.height * 0.5;
      const radius = Math.max(88, Math.min(this.width * 0.405, this.height * 0.43));
      const rotation = this.reducedMotion ? 0.22 : animationTime * motion.rotationRate;
      const tilt = -0.18;
      for (let particleIndex = 0; particleIndex < this.particles.length; particleIndex++) {
        const particle = this.particles[particleIndex];
        const baseY = Math.cos(particle.phi);
        const theta = particle.theta + rotation * particle.speed + baseY * motion.twist + Math.sin(particle.phase + animationTime * motion.waveRate * 0.28) * energy * 0.12;
        const sinPhi = Math.sin(particle.phi);
        let x = Math.cos(theta) * sinPhi;
        let y = baseY;
        let z = Math.sin(theta) * sinPhi;
        const y2 = y * Math.cos(tilt) - z * Math.sin(tilt);
        const z2 = y * Math.sin(tilt) + z * Math.cos(tilt);
        y = y2;
        z = z2;
        const bandFrequency = this.state === "reco" ? 18 : this.state === "speak" ? 11 : 8;
        const voiceBand = Math.sin(
          particle.phi * bandFrequency + particle.phase - animationTime * motion.waveRate
        );
        const flow = Math.sin(theta * (this.state === "think" ? 7 : 4) + animationTime * motion.waveRate * 0.64 + particle.phase);
        const speakWave = this.state === "speak" ? Math.sin(particle.phi * 7 - animationTime * 0.031) * 0.11 : 0;
        const deformation = 1 + energy * (motion.deformation + voiceBand * 0.15 + flow * 0.08) + speakWave * energy;
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
        const surfaceAlpha = this.lightSurface ? 0.82 : 1;
        if (particleIndex % 19 === 0) {
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
    drawPulse(context, cx, cy, radius, energy, time, motion) {
      context.beginPath();
      context.arc(cx, cy, radius * (0.56 + energy * 0.04), 0, Math.PI * 2);
      context.fillStyle = rgba(this.primary, 0.018 + energy * 0.022);
      context.fill();
      context.strokeStyle = rgba(this.stateColor, 0.09 + energy * 0.12);
      context.lineWidth = 1.2;
      context.stroke();
      const count = motion.pulseCount;
      const pulsePalette = [this.stateColor, this.primary, this.secondary, this.warm];
      for (let i = 0; i < count; i++) {
        const pulseRate = this.state === "speak" ? 55e-5 : this.state === "reco" ? 38e-5 : 24e-5;
        const phase2 = (time * pulseRate + i / count) % 1;
        const pulseRadius = radius * (0.45 + phase2 * 0.72);
        context.beginPath();
        context.arc(cx, cy, pulseRadius, 0, Math.PI * 2);
        const pulseColor = mix(
          pulsePalette[i % pulsePalette.length],
          this.stateColor,
          0.34 + Math.sin(time * 2e-3 + i) * 0.18
        );
        context.strokeStyle = rgba(
          pulseColor,
          Math.max(0, (1 - phase2) * (0.055 + energy * 0.15))
        );
        context.lineWidth = 1;
        context.stroke();
      }
    }
    drawOrbits(context, cx, cy, radius, energy, time, motion) {
      context.save();
      context.translate(cx, cy);
      for (let i = 0; i < motion.orbitCount; i++) {
        context.save();
        const direction = this.state === "think" && i % 2 ? -1 : 1;
        context.rotate(
          time * direction * (motion.rotationRate * 0.36 + i * 4e-6) + i * 0.63
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
          0.18 + (Math.sin(time * 17e-4 + i * 0.9) + 1) / 2 * 0.42
        );
        const surfaceAlpha = this.lightSurface ? 0.78 : 1;
        context.strokeStyle = rgba(color, (0.13 + energy * 0.2) * surfaceAlpha);
        context.lineWidth = 1 + energy * 1.55;
        context.stroke();
        context.restore();
      }
      context.restore();
    }
  };

  // prototype/quyuan-voice-particle-qa.ts
  var consoleRoot = document.querySelector(".talos-console");
  var voice = document.querySelector(".tq-voice");
  var stage = document.querySelector(".tq-stage");
  var back = document.querySelector(".tq-particles-back");
  var front = document.querySelector(".tq-particles-front");
  var cap = document.querySelector(".tq-cap");
  var sub = document.querySelector(".tq-sub");
  var dot = document.querySelector(".tq-dot");
  var themeSelect = document.querySelector(".qa-theme");
  var meter = document.querySelector(".tq-meter");
  var body = document.querySelector(".tq-body");
  var resizer = document.querySelector(".tq-side-resizer");
  var panelToggle = document.querySelector(".qa-panel-toggle");
  var collapseSide = document.querySelector(".qa-collapse-side");
  var openSession = document.querySelector(".qa-open-session");
  var sessionInput = document.querySelector(".tq-side-composer textarea");
  var sendButton = document.querySelector(".tq-send-btn");
  var clearSession = document.querySelector(".qa-clear-session");
  var conversation = document.querySelector(".tq-convo");
  if (!consoleRoot || !voice || !stage || !back || !front || !cap || !sub || !dot || !themeSelect || !meter || !body || !resizer || !panelToggle || !collapseSide || !openSession || !sessionInput || !sendButton || !clearSession || !conversation) {
    throw new Error("Missing Quyuan QA surface");
  }
  for (let i = 0; i < 18; i++) {
    const bar = document.createElement("i");
    bar.style.setProperty("--bar", `${6 + i * 7 % 11}px`);
    meter.appendChild(bar);
  }
  var field = new QuyuanVoiceParticleField(stage, back, front);
  var copy = {
    idle: ["\u51C6\u5907\u8FDE\u63A5", "\u6B63\u5728\u5F00\u542F\u9EA6\u514B\u98CE"],
    listen: ["\u6211\u5728\u542C", "\u8BF4\u5B8C\uFF0C\u6211\u4F1A\u63A5\u4F4F\u3002"],
    reco: ["\u6B63\u5728\u8BC6\u522B", "\u628A\u4F60\u7684\u58F0\u97F3\u53D8\u6210\u6E05\u6670\u610F\u56FE"],
    think: ["\u6B63\u5728\u60F3\u900F", "\u6309\u8D85\u7EA7\u5927\u8111\u89C4\u5219\u7406\u89E3\u610F\u56FE"],
    speak: ["\u5C48\u539F\u5728\u56DE\u7B54", "\u5F00\u53E3\u5373\u53EF\u6253\u65AD"]
  };
  function setState(state) {
    voice?.setAttribute("data-voice-state", state);
    voice?.style.setProperty(
      "--tq-state",
      state === "reco" ? "#1D9E75" : state === "think" ? "#7F77DD" : state === "speak" ? "#D85A30" : "#378ADD"
    );
    field.setState(state);
    const stateCopy = copy[state];
    if (stateCopy && cap && sub && dot) {
      cap.textContent = stateCopy[0];
      sub.textContent = stateCopy[1];
      dot.textContent = stateCopy[0];
    }
    document.querySelectorAll(".tq-flow-state").forEach((item) => {
      const activeState = state === "idle" ? "listen" : state;
      if (item.dataset.state === activeState) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
    });
  }
  document.querySelectorAll(".qa-state").forEach((button) => {
    button.addEventListener("click", () => setState(button.dataset.state || "listen"));
  });
  document.querySelectorAll(".tq-side-tab").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.tab;
      document.querySelectorAll(".tq-side-tab").forEach((tab) => {
        const active = tab === button;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", String(active));
      });
      document.querySelectorAll(".tq-side-panel").forEach((panel) => {
        panel.classList.toggle("is-active", panel.dataset.panel === key);
      });
    });
  });
  function activatePanel(key) {
    document.querySelector(`.tq-side-tab[data-tab="${key}"]`)?.click();
  }
  function setPanelCollapsed(collapsed) {
    body.classList.toggle("is-side-collapsed", collapsed);
    panelToggle.setAttribute("aria-expanded", String(!collapsed));
    panelToggle.setAttribute(
      "aria-label",
      collapsed ? "\u5C55\u5F00 TALOS \u4EA4\u4E92\u9762\u677F" : "\u6536\u8D77 TALOS \u4EA4\u4E92\u9762\u677F"
    );
  }
  panelToggle.addEventListener("click", () => {
    setPanelCollapsed(!body.classList.contains("is-side-collapsed"));
  });
  collapseSide.addEventListener("click", () => setPanelCollapsed(true));
  openSession.addEventListener("click", () => {
    setPanelCollapsed(false);
    activatePanel("session");
    window.setTimeout(() => sessionInput.focus(), 0);
  });
  resizer.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = Number.parseFloat(
      getComputedStyle(body).getPropertyValue("--tq-side-size")
    ) || 360;
    resizer.classList.add("is-dragging");
    const move = (moveEvent) => {
      const max = Math.max(280, Math.min(560, body.clientWidth - 460));
      const next = Math.min(max, Math.max(280, startWidth - (moveEvent.clientX - startX)));
      body.style.setProperty("--tq-side-size", `${Math.round(next)}px`);
    };
    const stop = () => {
      resizer.classList.remove("is-dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  });
  resizer.addEventListener("dblclick", () => body.style.setProperty("--tq-side-size", "360px"));
  resizer.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const current = Number.parseFloat(
      getComputedStyle(body).getPropertyValue("--tq-side-size")
    ) || 360;
    const next = Math.min(560, Math.max(280, current + (event.key === "ArrowLeft" ? 20 : -20)));
    body.style.setProperty("--tq-side-size", `${next}px`);
  });
  function submitMessage() {
    const text = sessionInput.value.trim();
    if (!text) return;
    const bubble = document.createElement("div");
    bubble.className = "tq-bub tq-me";
    const role = document.createElement("span");
    role.className = "tq-bub-role";
    role.textContent = "\u4F60";
    const copy2 = document.createElement("div");
    copy2.textContent = text;
    bubble.append(role, copy2);
    conversation.appendChild(bubble);
    conversation.scrollTop = conversation.scrollHeight;
    sessionInput.value = "";
    sendButton.disabled = true;
  }
  sendButton.addEventListener("click", submitMessage);
  sessionInput.addEventListener("input", () => {
    sendButton.disabled = !sessionInput.value.trim();
  });
  sessionInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submitMessage();
  });
  clearSession.addEventListener("click", () => conversation.replaceChildren());
  themeSelect.addEventListener("change", () => {
    for (const className of Array.from(consoleRoot.classList)) {
      if (className.startsWith("theme-")) consoleRoot.classList.remove(className);
    }
    consoleRoot.classList.add(`theme-${themeSelect.value}`);
    consoleRoot.dataset.talosTheme = themeSelect.value;
    document.body.dataset.talosVaultTheme = themeSelect.value;
  });
  var requestedTheme = new URLSearchParams(location.search).get("theme");
  if (requestedTheme) {
    themeSelect.value = requestedTheme;
    themeSelect.dispatchEvent(new Event("change"));
  }
  var requestedSide = Number(new URLSearchParams(location.search).get("side"));
  if (Number.isFinite(requestedSide) && requestedSide >= 280 && requestedSide <= 560) {
    body.style.setProperty("--tq-side-size", `${requestedSide}px`);
  }
  var phase = 0;
  function animateLevel() {
    phase += 0.055;
    const level = Math.max(0.06, (Math.sin(phase) + Math.sin(phase * 2.7) * 0.42 + 1) / 2.4);
    voice?.style.setProperty("--tq-level", level.toFixed(3));
    field.setAudioLevel(level);
    requestAnimationFrame(animateLevel);
  }
  var requestedState = new URLSearchParams(location.search).get("state");
  setState(
    requestedState === "idle" || requestedState === "listen" || requestedState === "reco" || requestedState === "think" || requestedState === "speak" ? requestedState : "listen"
  );
  if (new URLSearchParams(location.search).get("motion") === "0") {
    voice.style.setProperty("--tq-level", "0.72");
    field.setAudioLevel(0.72);
    window.setTimeout(() => field.destroy(), 420);
  } else {
    animateLevel();
  }
  window.addEventListener("beforeunload", () => field.destroy());
})();

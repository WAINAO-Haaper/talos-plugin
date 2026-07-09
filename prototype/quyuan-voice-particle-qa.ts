import {
	QuyuanVoiceParticleField,
	type ParticleVoiceState,
} from "../src/quyuan/voice-particle-field";

const consoleRoot = document.querySelector<HTMLElement>(".talos-console");
const voice = document.querySelector<HTMLElement>(".tq-voice");
const stage = document.querySelector<HTMLElement>(".tq-stage");
const back = document.querySelector<HTMLCanvasElement>(".tq-particles-back");
const front = document.querySelector<HTMLCanvasElement>(".tq-particles-front");
const cap = document.querySelector<HTMLElement>(".tq-cap");
const sub = document.querySelector<HTMLElement>(".tq-sub");
const dot = document.querySelector<HTMLElement>(".tq-dot");
const themeSelect = document.querySelector<HTMLSelectElement>(".qa-theme");
const meter = document.querySelector<HTMLElement>(".tq-meter");
const body = document.querySelector<HTMLElement>(".tq-body");
const resizer = document.querySelector<HTMLElement>(".tq-side-resizer");
const panelToggle = document.querySelector<HTMLButtonElement>(".qa-panel-toggle");
const collapseSide = document.querySelector<HTMLButtonElement>(".qa-collapse-side");
const openSession = document.querySelector<HTMLButtonElement>(".qa-open-session");
const sessionInput = document.querySelector<HTMLTextAreaElement>(".tq-side-composer textarea");
const sendButton = document.querySelector<HTMLButtonElement>(".tq-send-btn");
const clearSession = document.querySelector<HTMLButtonElement>(".qa-clear-session");
const conversation = document.querySelector<HTMLElement>(".tq-convo");

if (
	!consoleRoot || !voice || !stage || !back || !front || !cap || !sub || !dot
	|| !themeSelect || !meter || !body || !resizer || !panelToggle || !collapseSide
	|| !openSession || !sessionInput || !sendButton || !clearSession || !conversation
) {
	throw new Error("Missing Quyuan QA surface");
}

for (let i = 0; i < 18; i++) {
	const bar = document.createElement("i");
	bar.style.setProperty("--bar", `${6 + ((i * 7) % 11)}px`);
	meter.appendChild(bar);
}

const field = new QuyuanVoiceParticleField(stage, back, front);
const copy: Record<ParticleVoiceState, [string, string]> = {
	idle: ["准备连接", "正在开启麦克风"],
	listen: ["我在听", "说完，我会接住。"],
	reco: ["正在识别", "把你的声音变成清晰意图"],
	think: ["正在想透", "按超级大脑规则理解意图"],
	speak: ["屈原在回答", "开口即可打断"],
};

function setState(state: ParticleVoiceState): void {
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
	document.querySelectorAll<HTMLElement>(".tq-flow-state").forEach((item) => {
		const activeState = state === "idle" ? "listen" : state;
		if (item.dataset.state === activeState) item.setAttribute("aria-current", "step");
		else item.removeAttribute("aria-current");
	});
}

document.querySelectorAll<HTMLButtonElement>(".qa-state").forEach((button) => {
	button.addEventListener("click", () => setState((button.dataset.state || "listen") as ParticleVoiceState));
});

document.querySelectorAll<HTMLButtonElement>(".tq-side-tab").forEach((button) => {
	button.addEventListener("click", () => {
		const key = button.dataset.tab;
		document.querySelectorAll<HTMLButtonElement>(".tq-side-tab").forEach((tab) => {
			const active = tab === button;
			tab.classList.toggle("is-active", active);
			tab.setAttribute("aria-selected", String(active));
		});
		document.querySelectorAll<HTMLElement>(".tq-side-panel").forEach((panel) => {
			panel.classList.toggle("is-active", panel.dataset.panel === key);
		});
	});
});

function activatePanel(key: "session" | "context" | "ability"): void {
	document.querySelector<HTMLButtonElement>(`.tq-side-tab[data-tab="${key}"]`)?.click();
}

function setPanelCollapsed(collapsed: boolean): void {
	body.classList.toggle("is-side-collapsed", collapsed);
	panelToggle.setAttribute("aria-expanded", String(!collapsed));
	panelToggle.setAttribute(
		"aria-label",
		collapsed ? "展开 TALOS 交互面板" : "收起 TALOS 交互面板"
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
	const move = (moveEvent: PointerEvent): void => {
		const max = Math.max(280, Math.min(560, body.clientWidth - 460));
		const next = Math.min(max, Math.max(280, startWidth - (moveEvent.clientX - startX)));
		body.style.setProperty("--tq-side-size", `${Math.round(next)}px`);
	};
	const stop = (): void => {
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

function submitMessage(): void {
	const text = sessionInput.value.trim();
	if (!text) return;
	const bubble = document.createElement("div");
	bubble.className = "tq-bub tq-me";
	const role = document.createElement("span");
	role.className = "tq-bub-role";
	role.textContent = "你";
	const copy = document.createElement("div");
	copy.textContent = text;
	bubble.append(role, copy);
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

const requestedTheme = new URLSearchParams(location.search).get("theme");
if (requestedTheme) {
	themeSelect.value = requestedTheme;
	themeSelect.dispatchEvent(new Event("change"));
}

const requestedSide = Number(new URLSearchParams(location.search).get("side"));
if (Number.isFinite(requestedSide) && requestedSide >= 280 && requestedSide <= 560) {
	body.style.setProperty("--tq-side-size", `${requestedSide}px`);
}

let phase = 0;
function animateLevel(): void {
	phase += 0.055;
	const level = Math.max(0.06, (Math.sin(phase) + Math.sin(phase * 2.7) * 0.42 + 1) / 2.4);
	voice?.style.setProperty("--tq-level", level.toFixed(3));
	field.setAudioLevel(level);
	requestAnimationFrame(animateLevel);
}
const requestedState = new URLSearchParams(location.search).get("state");
setState(
	requestedState === "idle"
		|| requestedState === "listen"
		|| requestedState === "reco"
		|| requestedState === "think"
		|| requestedState === "speak"
		? requestedState
		: "listen"
);
if (new URLSearchParams(location.search).get("motion") === "0") {
	voice.style.setProperty("--tq-level", "0.72");
	field.setAudioLevel(0.72);
	window.setTimeout(() => field.destroy(), 420);
} else {
	animateLevel();
}

window.addEventListener("beforeunload", () => field.destroy());

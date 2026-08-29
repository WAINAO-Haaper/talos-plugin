import { Component, MarkdownRenderer, setIcon, type App } from "obsidian";
import type { AgentEvent } from "../contracts/agent-events";
import { hasMeaningfulHandoffContext } from "../storage/conversation-projection";
import { StreamRenderScheduler } from "./stream-render-scheduler";

interface TurnRenderState {
	message: HTMLElement;
	content: HTMLElement;
	text: string;
	scheduler: StreamRenderScheduler;
}

function stringValue(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function recordValue(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
}

function displayJson(value: unknown): string {
	try { return JSON.stringify(value, null, 2); }
	catch { return String(value); }
}

function eventText(event: AgentEvent): string {
	return stringValue(event.payload.text)
		|| stringValue(event.payload.delta)
		|| stringValue(event.payload.message)
		|| stringValue(recordValue(event.payload.error).message);
}

function toolId(event: AgentEvent): string {
	return stringValue(event.payload.id) || event.nativeId || event.eventId;
}

/** TALOS incremental renderer preserving the frozen conversation visual ABI. */
export class NativeEventRenderer {
	private readonly component = new Component();
	private readonly assistantTurns = new Map<string, TurnRenderState>();
	private readonly thinkingTurns = new Map<string, HTMLElement>();
	private readonly tools = new Map<string, HTMLElement>();
	private pendingUser: HTMLElement | null = null;
	private renderVersion = 0;
	private loaded = false;

	constructor(
		private readonly container: HTMLElement,
		private readonly app: App,
		private readonly sourcePath: () => string,
	) {
		this.component.load();
		this.loaded = true;
	}

	private resetContents(): void {
		for (const state of this.assistantTurns.values()) state.scheduler.cancel();
		this.container.replaceChildren();
		this.assistantTurns.clear();
		this.thinkingTurns.clear();
		this.tools.clear();
		this.pendingUser = null;
	}

	clear(): void {
		this.renderVersion++;
		this.resetContents();
	}

	async render(events: AgentEvent[]): Promise<void> {
		const version = ++this.renderVersion;
		this.resetContents();
		if (events.length === 0) this.renderWelcome();
		for (const event of events) {
			if (version !== this.renderVersion) return;
			await this.append(event, false);
		}
	}

	private renderWelcome(): void {
		const welcome = this.container.ownerDocument.createElement("div");
		welcome.className = "claudian-welcome";
		const greeting = welcome.ownerDocument.createElement("div");
		greeting.className = "claudian-welcome-greeting";
		greeting.textContent = "今天想和 TALOS 一起完成什么？";
		welcome.appendChild(greeting);
		this.container.appendChild(welcome);
	}

	private ensureAssistant(turnId: string): TurnRenderState {
		let state = this.assistantTurns.get(turnId);
		if (state) return state;
		this.container.querySelector(".claudian-welcome")?.remove();
		const message = this.container.ownerDocument.createElement("article");
		message.className = "claudian-message claudian-message-assistant";
		message.dataset.turnId = turnId;
		const content = message.ownerDocument.createElement("div");
		content.className = "claudian-message-content claudian-text-block";
		message.appendChild(content);
		this.container.appendChild(message);
		state = {
			message,
			content,
			text: "",
			scheduler: new StreamRenderScheduler({
				getTargetEl: () => content.isConnected ? content : null,
				getContent: () => this.assistantTurns.get(turnId)?.text ?? "",
				doRender: (target, markdown) => this.renderMarkdown(target, markdown),
				afterRender: () => this.container.scrollTo({ top: this.container.scrollHeight }),
				getWindow: () => content.ownerDocument.defaultView,
			}),
		};
		this.assistantTurns.set(turnId, state);
		return state;
	}

	private renderUser(event: AgentEvent, target?: HTMLElement): HTMLElement {
		this.container.querySelector(".claudian-welcome")?.remove();
		const message = target ?? this.container.ownerDocument.createElement("article");
		message.className = "claudian-message claudian-message-user";
		message.dataset.turnId = event.turnId;
		message.dataset.eventId = event.eventId;
		message.replaceChildren();
		const content = message.ownerDocument.createElement("div");
		content.className = "claudian-message-content";
		content.textContent = eventText(event);
		message.appendChild(content);
		const images = Array.isArray(event.payload.images) ? event.payload.images : [];
		if (images.length) {
			const imageRow = message.ownerDocument.createElement("div");
			imageRow.className = "claudian-message-images";
			for (const raw of images) {
				const image = recordValue(raw);
				const chip = imageRow.ownerDocument.createElement("span");
				chip.className = "claudian-image-chip";
				chip.textContent = stringValue(image.name) || "图片";
				imageRow.appendChild(chip);
			}
			message.appendChild(imageRow);
		}
		if (!target) this.container.appendChild(message);
		return message;
	}

	appendPendingUser(event: AgentEvent): void {
		this.pendingUser?.remove();
		this.pendingUser = this.renderUser(event);
		this.pendingUser.classList.add("talos-native-user-pending");
		this.container.scrollTo({ top: this.container.scrollHeight, behavior: "smooth" });
	}

	markPendingUserFailed(): void {
		if (!this.pendingUser) return;
		this.pendingUser.classList.remove("talos-native-user-pending");
		this.pendingUser.classList.add("talos-native-user-failed");
		this.pendingUser = null;
	}

	private async renderMarkdown(target: HTMLElement, markdown: string): Promise<void> {
		target.replaceChildren();
		try {
			await MarkdownRenderer.render(
				this.app,
				markdown,
				target,
				this.sourcePath(),
				this.component,
			);
		} catch {
			target.textContent = markdown;
		}
	}

	private renderThinking(event: AgentEvent): void {
		let body = this.thinkingTurns.get(event.turnId);
		if (!body) {
			const details = this.container.ownerDocument.createElement("details");
			details.className = "claudian-thinking claudian-thinking--compact";
			const summary = details.ownerDocument.createElement("summary");
			summary.textContent = "思考过程";
			body = details.ownerDocument.createElement("div");
			body.className = "claudian-thinking-content";
			details.append(summary, body);
			this.container.appendChild(details);
			this.thinkingTurns.set(event.turnId, body);
		}
		body.textContent = `${body.textContent ?? ""}${eventText(event)}`;
	}

	private renderPlan(event: AgentEvent): void {
		const details = this.container.ownerDocument.createElement("details");
		details.className = "claudian-plan-approval-inline";
		details.open = true;
		const summary = details.ownerDocument.createElement("summary");
		summary.textContent = "执行计划";
		const content = details.ownerDocument.createElement("pre");
		content.className = "claudian-plan-content-preview";
		content.textContent = eventText(event) || displayJson(event.payload);
		details.append(summary, content);
		this.container.appendChild(details);
	}

	private renderTool(event: AgentEvent): void {
		const id = toolId(event);
		let card = this.tools.get(id);
		if (!card) {
			card = this.container.ownerDocument.createElement("details");
			card.className = "claudian-tool-call";
			card.dataset.toolId = id;
			const summary = card.ownerDocument.createElement("summary");
			card.dataset.turnId = event.turnId;
			summary.className = "claudian-tool-header";
			const icon = summary.ownerDocument.createElement("span");
			icon.className = "claudian-tool-icon";
			setIcon(icon, "wrench");
			const label = summary.ownerDocument.createElement("strong");
			label.textContent = stringValue(event.payload.name) || stringValue(event.payload.tool) || "工具";
			summary.append(icon, label);
			const body = card.ownerDocument.createElement("pre");
			body.className = "claudian-tool-content";
			card.append(summary, body);
			this.container.appendChild(card);
			this.tools.set(id, card);
		}
		card.dataset.status = event.type === "tool.finished" ? (event.payload.error ? "failed" : "succeeded") : "running";
		const body = card.querySelector<HTMLElement>(".claudian-tool-content");
		if (body) {
			const value = event.type === "tool.started"
				? event.payload.input
				: event.payload.output ?? event.payload.result ?? event.payload;
			body.textContent = typeof value === "string" ? value : displayJson(value);
		}
	}

	private clearTransientTurn(turnId: string): void {
		const thinking = this.thinkingTurns.get(turnId);
		thinking?.parentElement?.remove();
		this.thinkingTurns.delete(turnId);
		for (const [id, card] of this.tools) {
			if (card.dataset.turnId !== turnId) continue;
			card.remove();
			this.tools.delete(id);
		}
	}

	private renderDiff(event: AgentEvent): void {
		const block = this.container.ownerDocument.createElement("pre");
		block.className = "claudian-diff-block";
		block.textContent = eventText(event) || displayJson(event.payload);
		this.container.appendChild(block);
	}

	private renderStatus(event: AgentEvent, tone = "info"): void {
		const text = eventText(event);
		if (!text) return;
		const row = this.container.ownerDocument.createElement("div");
		row.className = `claudian-status-message talos-native-event-${tone}`;
		row.dataset.eventType = event.type;
		row.textContent = text;
		this.container.appendChild(row);
	}

	private renderTask(event: AgentEvent): void {
		const row = this.container.ownerDocument.createElement("div");
		row.className = event.type === "subagent.updated" ? "claudian-subagent-block" : "claudian-todo-list";
		row.textContent = eventText(event) || displayJson(event.payload);
		this.container.appendChild(row);
	}

	async append(event: AgentEvent, scroll = true): Promise<void> {
		if (!this.loaded) return;
		if (event.type === "user.message") {
			if (this.pendingUser) {
				const pending = this.pendingUser;
				this.pendingUser = null;
				this.renderUser(event, pending);
			} else this.renderUser(event);
		}
		else if (event.type === "assistant.start") this.container.querySelector(".claudian-welcome")?.remove();
		else if (event.type === "assistant.delta") {
			const state = this.ensureAssistant(event.turnId);
			state.text += eventText(event);
			void state.scheduler.schedule();
		}
		else if (event.type === "assistant.final") {
			const state = this.ensureAssistant(event.turnId);
			const finalText = eventText(event);
			if (finalText) state.text = finalText;
			void state.scheduler.schedule();
			await state.scheduler.flush();
		}
		else if (event.type === "thinking.delta") this.renderThinking(event);
		else if (event.type === "plan.updated") this.renderPlan(event);
		else if (event.type === "tool.started" || event.type === "tool.updated" || event.type === "tool.finished") this.renderTool(event);
		else if (event.type === "file.diff") this.renderDiff(event);
		else if (event.type === "task.progress" || event.type === "subagent.updated") this.renderTask(event);
		// Usage belongs to the context meter/state model, never to the transcript.
		else if (event.type === "usage.updated") { /* intentionally not rendered */ }
		else if (event.type === "context.compacted") this.renderStatus({ ...event, payload: { message: "上下文已压缩" } });
		else if (event.type === "handoff.created" && hasMeaningfulHandoffContext(event)) this.renderStatus({ ...event, payload: { message: "已切换智能体并交接当前上下文" } });
		else if (event.type === "error") {
			this.clearTransientTurn(event.turnId);
			this.renderStatus(event, "error");
		}
		else if (event.type === "notice" || event.type === "runtime.status") this.renderStatus(event, "notice");
		else if (event.type === "approval.resolved") this.renderStatus({ ...event, payload: { message: `审批结果：${stringValue(event.payload.decision)}` } });
		else if (event.type === "user.question") this.renderStatus({ ...event, payload: { message: eventText(event) || "智能体需要补充信息" } });
		else if (event.type === "turn.finished") this.clearTransientTurn(event.turnId);
		if (scroll) this.container.scrollTo({ top: this.container.scrollHeight, behavior: "smooth" });
	}

	destroy(): void {
		this.loaded = false;
		this.component.unload();
		this.clear();
	}
}

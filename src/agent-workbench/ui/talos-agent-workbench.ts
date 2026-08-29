import { setIcon, type WorkspaceLeaf } from "obsidian";
import type { ChatSurfaceWorkbench } from "../../quyuan/chat-surface";
import type { AgentWorkbenchService } from "../core/agent-workbench-service";
import type { PermissionMode } from "../contracts/approval";
import type { ModelDescriptor, RuntimeHealth, RuntimeId } from "../contracts/runtime-adapter";
import {
	CLAUDE_PROVIDER_ICON,
	OPENAI_PROVIDER_ICON,
	PI_PROVIDER_ICON,
	createProviderIconSvg,
} from "./provider-icons";
import { NativeConversationView } from "./native-conversation-view";
import { automaticModelPresentation, explicitDefaultModel, presentRuntimeModel, reasoningForModel } from "./model-switcher-presentation";

export interface TalosAgentWorkbenchOptions {
	leaf: WorkspaceLeaf;
	service: AgentWorkbenchService;
}

const NATIVE_PROVIDER_LABELS: Record<RuntimeId, string> = {
	claude: "Claude 本机登录",
	codex: "Codex 本机登录",
	ohmypi: "OhMyPi 原生 Provider",
};

const RUNTIME_PRESENTATION = [
	{ id: "claude", label: "Claude", icon: CLAUDE_PROVIDER_ICON },
	{ id: "codex", label: "Codex", icon: OPENAI_PROVIDER_ICON },
	{ id: "ohmypi", label: "OhMyPi", icon: PI_PROVIDER_ICON },
] as const;

const RUNTIME_HEALTH_LABELS: Record<RuntimeHealth, string> = {
	unknown: "状态未知",
	probing: "检测中",
	"not-installed": "未安装",
	incompatible: "版本不兼容",
	unauthenticated: "未登录",
	ready: "已就绪",
	degraded: "部分可用",
	crashed: "启动失败",
};

const PERMISSION_PRESENTATION: Record<PermissionMode, {
	label: string;
	description: string;
	icon: string;
}> = {
	ask: {
		label: "请求批准",
		description: "修改文件、运行命令或访问额外网络时先询问",
		icon: "hand",
	},
	scoped: {
		label: "帮我批准",
		description: "已授权的安全操作自动继续，仅风险操作询问",
		icon: "shield-check",
	},
	"vault-full": {
		label: "完全访问权限",
		description: "当前 Vault 普通读写自动，高风险与外部目标仍受保护",
		icon: "shield-alert",
	},
};

function nativeProviderLabel(runtimeId: RuntimeId): string {
	return NATIVE_PROVIDER_LABELS[runtimeId];
}

export class TalosAgentWorkbench implements ChatSurfaceWorkbench {
	private readonly native: NativeConversationView;
	private root: HTMLElement | null = null;
	private body: HTMLElement | null = null;
	private status: HTMLElement | null = null;
	private model: HTMLSelectElement | null = null;
	private modelControl: HTMLElement | null = null;
	private modelTrigger: HTMLButtonElement | null = null;
	private modelTriggerIcon: HTMLElement | null = null;
	private modelTriggerLabel: HTMLElement | null = null;
	private modelTriggerMeta: HTMLElement | null = null;
	private modelMenu: HTMLElement | null = null;
	private modelAnnouncement: HTMLElement | null = null;
	private modelDescriptors: ModelDescriptor[] = [];
	private modelRuntimeId: RuntimeId = "codex";
	private reasoningControl: HTMLElement | null = null;
	private reasoning: HTMLSelectElement | null = null;
	private serviceTierControl: HTMLElement | null = null;
	private serviceTier: HTMLButtonElement | null = null;
	private provider: HTMLSelectElement | null = null;
	private readonly runtimeButtons = new Map<RuntimeId, HTMLButtonElement>();
	private install: HTMLAnchorElement | null = null;
	private refreshVersion = 0;
	private outsideModelMenuListener: ((event: PointerEvent) => void) | null = null;
	private permissionControl: HTMLElement | null = null;
	private permissionTrigger: HTMLButtonElement | null = null;
	private permissionTriggerLabel: HTMLElement | null = null;
	private permissionMenu: HTMLElement | null = null;
	private outsidePermissionMenuListener: ((event: PointerEvent) => void) | null = null;
	private handoffToast: HTMLElement | null = null;
	private handoffDismissTimer: number | null = null;
	private handoffRemovalTimer: number | null = null;

	constructor(private readonly options: TalosAgentWorkbenchOptions) {
		this.native = new NativeConversationView({
			leaf: options.leaf,
			service: options.service,
			onSelectionChanged: (runtimeId, modelId) => {
			const current = this.options.service.getSelection();
			this.options.service.selectRuntime(
				runtimeId,
				modelId !== undefined ? modelId : current.runtimeId === runtimeId ? undefined : null,
			);
			this.updateRuntimeButtons(runtimeId);
			void this.refreshRuntime(runtimeId);
			},
		});
	}

	async mount(container: HTMLElement, namespace: "chat"): Promise<void> {
		if (namespace !== "chat") throw new Error("TALOS 智能体只允许 chat 命名空间");
		if (!this.root) this.build(container.ownerDocument);
		if (!this.root || !this.body) throw new Error("TALOS 智能体展示层未建立");
		if (this.root.parentElement !== container) container.appendChild(this.root);
		await this.native.mount(this.body, namespace);
	}

	private build(doc: Document): void {
		const root = doc.createElement("section");
		root.className = "talos-agent-workbench";
		root.dataset.talosComponent = "agent-workbench";
		const controls = doc.createElement("div");
		controls.className = "talos-agent-controls";
		controls.setAttribute("role", "group");
		controls.setAttribute("aria-label", "TALOS 智能体运行时与模型");

		const runtimeSwitcher = doc.createElement("div");
		runtimeSwitcher.className = "talos-agent-runtime-switcher";
		runtimeSwitcher.setAttribute("role", "radiogroup");
		runtimeSwitcher.setAttribute("aria-label", "选择智能体");
		for (const runtime of RUNTIME_PRESENTATION) {
			const button = doc.createElement("button");
			button.type = "button";
			button.className = "talos-agent-runtime-button";
			button.dataset.runtime = runtime.id;
			button.title = `切换到 ${runtime.label}`;
			button.setAttribute("role", "radio");
			button.setAttribute("aria-label", `切换到 ${runtime.label}`);
			button.appendChild(createProviderIconSvg(runtime.icon, {
				className: "talos-agent-runtime-logo",
				dataProvider: runtime.id,
				height: 20,
				ownerDocument: doc,
				width: 20,
			}));
			button.addEventListener("click", () => {
				const previous = this.options.service.getSelectedRuntimeId();
				if (previous === runtime.id) return;
				this.updateRuntimeButtons(runtime.id);
				this.setRuntimeButtonsDisabled(true);
				void this.native.selectRuntime(runtime.id).then((handoffCreated) => {
					if (handoffCreated) this.appendHandoffMarker(root, previous, runtime.id);
				}).catch((error: unknown) => {
					this.updateRuntimeButtons(previous);
					if (this.status) {
						this.status.dataset.state = "error";
						this.status.textContent = `切换失败 · ${error instanceof Error ? error.message : String(error)}`;
					}
				}).finally(() => this.setRuntimeButtonsDisabled(false));
			});
			this.runtimeButtons.set(runtime.id, button);
			runtimeSwitcher.appendChild(button);
		}
		this.updateRuntimeButtons(this.options.service.getSelectedRuntimeId());
		controls.appendChild(runtimeSwitcher);

		const provider = doc.createElement("select");
		provider.className = "talos-agent-provider-picker";
		provider.setAttribute("aria-label", "认证或 API");
		const native = doc.createElement("option");
		native.value = "native";
		native.textContent = nativeProviderLabel(this.options.service.getSelectedRuntimeId());
		provider.appendChild(native);
		this.provider = provider;
		provider.addEventListener("change", () => {
			const previous = this.options.service.getSelection();
			void (async () => {
				this.options.service.selectProviderProfile(provider.value === "native" ? undefined : provider.value);
				this.options.service.selectModel(undefined);
				await this.native.persistCurrentSelection();
				await this.refreshRuntime(this.options.service.getSelectedRuntimeId());
			})().catch((error: unknown) => {
				this.options.service.restoreSelection(previous);
				provider.value = previous.providerProfileId ?? "native";
				if (this.status) this.status.textContent = `Provider 切换失败 · ${error instanceof Error ? error.message : String(error)}`;
			});
		});
		controls.appendChild(provider);

		const modelControl = doc.createElement("div");
		modelControl.className = "talos-agent-model-control";
		this.modelControl = modelControl;
		const modelTrigger = doc.createElement("button");
		modelTrigger.type = "button";
		modelTrigger.className = "talos-agent-model-trigger";
		modelTrigger.setAttribute("aria-haspopup", "listbox");
		modelTrigger.setAttribute("aria-expanded", "false");
		modelTrigger.setAttribute("aria-label", "切换模型");
		const triggerIcon = doc.createElement("span");
		triggerIcon.className = "talos-agent-model-trigger-icon";
		this.modelTriggerIcon = triggerIcon;
		modelTrigger.appendChild(triggerIcon);
		const triggerCopy = doc.createElement("span");
		triggerCopy.className = "talos-agent-model-trigger-copy";
		const triggerLabel = doc.createElement("strong");
		triggerLabel.textContent = "自动选择";
		this.modelTriggerLabel = triggerLabel;
		const triggerMeta = doc.createElement("small");
		triggerMeta.textContent = "终端默认";
		this.modelTriggerMeta = triggerMeta;
		triggerCopy.append(triggerLabel, triggerMeta);
		modelTrigger.appendChild(triggerCopy);
		const triggerChevron = doc.createElement("span");
		triggerChevron.className = "talos-agent-model-trigger-chevron";
		triggerChevron.setAttribute("aria-hidden", "true");
		triggerChevron.textContent = "⌄";
		modelTrigger.appendChild(triggerChevron);
		modelControl.appendChild(modelTrigger);
		this.modelTrigger = modelTrigger;

		const modelMenu = doc.createElement("div");
		modelMenu.className = "talos-agent-model-menu";
		modelMenu.setAttribute("role", "listbox");
		modelMenu.setAttribute("aria-label", "可用模型");
		modelMenu.hidden = true;
		modelControl.appendChild(modelMenu);
		this.modelMenu = modelMenu;

		const announcement = doc.createElement("span");
		announcement.className = "talos-agent-model-announcement";
		announcement.setAttribute("aria-live", "polite");
		modelControl.appendChild(announcement);
		this.modelAnnouncement = announcement;

		const model = doc.createElement("select");
		model.className = "talos-agent-model-picker";
		model.setAttribute("aria-label", "模型兼容选择器");
		model.tabIndex = -1;
		model.hidden = true;
		const automatic = doc.createElement("option");
		automatic.value = "";
		automatic.textContent = "运行时默认模型";
		model.appendChild(automatic);
		modelControl.appendChild(model);
		controls.appendChild(modelControl);
		this.model = model;
		model.addEventListener("change", () => void this.selectModel(model.value));
		modelTrigger.addEventListener("click", () => this.setModelMenuOpen(modelMenu.hidden));
		modelTrigger.addEventListener("keydown", (event) => {
			if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				this.setModelMenuOpen(true, true);
			}
		});
		modelMenu.addEventListener("keydown", (event) => this.handleModelMenuKeydown(event));

		const reasoningControl = doc.createElement("div");
		reasoningControl.className = "claudian-thinking-selector talos-agent-reasoning-control";
		const reasoningLabel = doc.createElement("span");
		reasoningLabel.className = "claudian-thinking-label-text";
		reasoningLabel.textContent = "思考";
		const reasoning = doc.createElement("select");
		reasoning.className = "talos-agent-reasoning-picker";
		reasoning.setAttribute("aria-label", "思考强度");
		reasoning.addEventListener("change", () => void this.selectReasoning(reasoning.value));
		reasoningControl.append(reasoningLabel, reasoning);
		reasoningControl.hidden = true;
		controls.appendChild(reasoningControl);
		this.reasoningControl = reasoningControl;
		this.reasoning = reasoning;

		const serviceTierControl = doc.createElement("div");
		serviceTierControl.className = "claudian-service-tier-toggle talos-agent-service-tier-control";
		const serviceTier = doc.createElement("button");
		serviceTier.type = "button";
		serviceTier.className = "claudian-service-tier-button";
		serviceTier.setAttribute("aria-label", "快速服务层");
		const serviceTierIcon = doc.createElement("span");
		serviceTierIcon.className = "claudian-service-tier-icon";
		setIcon(serviceTierIcon, "zap");
		serviceTier.appendChild(serviceTierIcon);
		serviceTier.addEventListener("click", () => void this.toggleServiceTier());
		serviceTierControl.appendChild(serviceTier);
		serviceTierControl.hidden = true;
		controls.appendChild(serviceTierControl);
		this.serviceTierControl = serviceTierControl;
		this.serviceTier = serviceTier;

		const workflow = doc.createElement("div");
		workflow.className = "talos-agent-workflow";
		workflow.setAttribute("role", "group");
		workflow.setAttribute("aria-label", "工作流模式");
		for (const [value, label, description] of [
			["plan", "只规划", "只分析和给方案，不执行修改"],
			["execute", "可执行", "在当前授权范围内执行可恢复操作"],
		] as const) {
			const button = doc.createElement("button");
			button.type = "button";
			button.textContent = label;
			button.dataset.value = value;
			button.title = description;
			button.setAttribute("aria-pressed", String(this.options.service.getWorkflowMode() === value));
			button.addEventListener("click", () => {
				this.options.service.setWorkflowMode(value);
				for (const sibling of Array.from(workflow.querySelectorAll("button"))) sibling.setAttribute("aria-pressed", String((sibling as HTMLElement).dataset.value === value));
			});
			workflow.appendChild(button);
		}
		controls.appendChild(workflow);

		const permissionControl = doc.createElement("div");
		permissionControl.className = "talos-agent-permission-control talos-agent-permission-picker";
		const permissionTrigger = doc.createElement("button");
		permissionTrigger.type = "button";
		permissionTrigger.className = "talos-agent-permission-trigger";
		permissionTrigger.setAttribute("aria-haspopup", "listbox");
		permissionTrigger.setAttribute("aria-expanded", "false");
		const permissionIcon = doc.createElement("span");
		permissionIcon.className = "talos-agent-permission-trigger-icon";
		setIcon(permissionIcon, "shield-check");
		const permissionLabel = doc.createElement("span");
		permissionLabel.className = "talos-agent-permission-trigger-label";
		const permissionChevron = doc.createElement("span");
		permissionChevron.className = "talos-agent-permission-trigger-chevron";
		permissionChevron.setAttribute("aria-hidden", "true");
		permissionChevron.textContent = "⌄";
		permissionTrigger.append(permissionIcon, permissionLabel, permissionChevron);
		permissionControl.appendChild(permissionTrigger);
		const permissionMenu = doc.createElement("div");
		permissionMenu.className = "talos-agent-permission-menu";
		permissionMenu.setAttribute("role", "listbox");
		permissionMenu.setAttribute("aria-label", "授权模式");
		permissionMenu.hidden = true;
		permissionMenu.addEventListener("keydown", (event) => this.handlePermissionMenuKeydown(event));
		permissionControl.appendChild(permissionMenu);
		this.permissionControl = permissionControl;
		this.permissionTrigger = permissionTrigger;
		this.permissionTriggerLabel = permissionLabel;
		this.permissionMenu = permissionMenu;
		this.updatePermissionTrigger();
		this.renderPermissionMenu();
		permissionTrigger.addEventListener("click", () => this.setPermissionMenuOpen(permissionMenu.hidden));
		permissionTrigger.addEventListener("keydown", (event) => {
			if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				this.setPermissionMenuOpen(true, true);
			}
		});
		controls.appendChild(permissionControl);

		const status = doc.createElement("span");
		status.className = "talos-agent-runtime-status";
		status.setAttribute("role", "status");
		status.setAttribute("aria-live", "polite");
		status.dataset.state = "checking";
		status.textContent = "等待无付费运行时探测";
		controls.appendChild(status);
		this.status = status;

		const install = doc.createElement("a");
		install.className = "talos-agent-install-link";
		install.textContent = "查看安装说明";
		install.target = "_blank";
		install.rel = "noreferrer";
		install.hidden = true;
		controls.appendChild(install);
		this.install = install;
		root.appendChild(controls);

		const approval = doc.createElement("div");
		approval.className = "talos-agent-approval-region";
		approval.setAttribute("aria-live", "assertive");
		approval.hidden = true;
		root.appendChild(approval);

		const body = doc.createElement("div");
		body.className = "talos-agent-compatibility-body";
		root.appendChild(body);
		this.root = root;
		this.body = body;
		void this.refreshRuntime(this.options.service.getSelectedRuntimeId());
	}

	private appendHandoffMarker(root: HTMLElement, from: RuntimeId, to: RuntimeId): void {
		if (from === to) return;
		const marker = this.handoffToast ?? root.ownerDocument.createElement("div");
		if (this.handoffDismissTimer) window.clearTimeout(this.handoffDismissTimer);
		if (this.handoffRemovalTimer) window.clearTimeout(this.handoffRemovalTimer);
		marker.className = "talos-agent-handoff-marker";
		marker.setAttribute("role", "status");
		marker.setAttribute("aria-live", "polite");
		marker.textContent = `${from} → ${to} · 下一回合将恢复目标会话`;
		marker.style.top = `${(root.querySelector<HTMLElement>(".talos-agent-controls")?.offsetHeight ?? 52) + 8}px`;
		if (!marker.parentElement) root.appendChild(marker);
		this.handoffToast = marker;
		window.requestAnimationFrame(() => marker.classList.add("is-visible"));
		this.handoffDismissTimer = window.setTimeout(() => {
			marker.classList.remove("is-visible");
			this.handoffRemovalTimer = window.setTimeout(() => {
				marker.remove();
				if (this.handoffToast === marker) this.handoffToast = null;
			}, 220);
		}, 3200);
	}

	private clearHandoffToast(): void {
		if (this.handoffDismissTimer) window.clearTimeout(this.handoffDismissTimer);
		if (this.handoffRemovalTimer) window.clearTimeout(this.handoffRemovalTimer);
		this.handoffDismissTimer = null;
		this.handoffRemovalTimer = null;
		this.handoffToast?.remove();
		this.handoffToast = null;
	}

	private updateRuntimeButtons(runtimeId: RuntimeId): void {
		for (const [id, button] of this.runtimeButtons) {
			const selected = id === runtimeId;
			button.setAttribute("aria-checked", String(selected));
			button.classList.toggle("is-active", selected);
		}
	}

	private setRuntimeButtonsDisabled(disabled: boolean): void {
		for (const button of this.runtimeButtons.values()) button.disabled = disabled;
	}

	private runtimePresentation(runtimeId: RuntimeId) {
		return RUNTIME_PRESENTATION.find((runtime) => runtime.id === runtimeId) ?? RUNTIME_PRESENTATION[1];
	}

	private renderModelTriggerIcon(runtimeId: RuntimeId): void {
		if (!this.modelTriggerIcon) return;
		this.modelTriggerIcon.replaceChildren(createProviderIconSvg(this.runtimePresentation(runtimeId).icon, {
			className: "talos-agent-model-provider-logo",
			dataProvider: runtimeId,
			height: 18,
			ownerDocument: this.modelTriggerIcon.ownerDocument,
			width: 18,
		}));
	}

	private updateModelTrigger(): void {
		if (!this.model || !this.modelTriggerLabel || !this.modelTriggerMeta) return;
		const descriptor = this.modelDescriptors.find((candidate) => candidate.id === this.model?.value);
		const presentation = descriptor
			? presentRuntimeModel(this.modelRuntimeId, descriptor)
			: automaticModelPresentation(this.modelRuntimeId);
		this.modelTriggerLabel.textContent = presentation.label;
		this.modelTriggerMeta.textContent = presentation.kicker;
		this.modelTrigger?.setAttribute("aria-label", `切换模型，当前 ${presentation.label}`);
	}

	private renderModelMenu(): void {
		if (!this.modelMenu || !this.model) return;
		this.modelMenu.replaceChildren();
		const doc = this.modelMenu.ownerDocument;
		const heading = doc.createElement("div");
		heading.className = "talos-agent-model-menu-heading";
		const title = doc.createElement("strong");
		title.textContent = `选择 ${this.runtimePresentation(this.modelRuntimeId).label} 模型`;
		const hint = doc.createElement("small");
		hint.textContent = this.modelRuntimeId === "codex"
			? "模型来自 Codex 终端；5.6 按 Sol／Terra／Luna 分档"
			: this.modelRuntimeId === "claude"
				? "使用 Claude Code 官方模型别名或当前 API 目录"
				: "模型来自当前 OhMyPi Provider";
		heading.append(title, hint);
		this.modelMenu.appendChild(heading);

		const options: Array<{ id: string; presentation: ReturnType<typeof presentRuntimeModel> }> = [
			{ id: "", presentation: automaticModelPresentation(this.modelRuntimeId) },
			...this.modelDescriptors.map((descriptor) => ({ id: descriptor.id, presentation: presentRuntimeModel(this.modelRuntimeId, descriptor) })),
		];
		for (const option of options) {
			const button = doc.createElement("button");
			button.type = "button";
			button.className = "talos-agent-model-option";
			button.dataset.model = option.id;
			button.setAttribute("role", "option");
			button.setAttribute("aria-selected", String(this.model.value === option.id));
			button.tabIndex = -1;
			const copy = doc.createElement("span");
			copy.className = "talos-agent-model-option-copy";
			const line = doc.createElement("span");
			line.className = "talos-agent-model-option-line";
			const label = doc.createElement("strong");
			label.textContent = option.presentation.label;
			const kicker = doc.createElement("span");
			kicker.className = "talos-agent-model-option-kicker";
			kicker.textContent = option.presentation.kicker;
			line.append(label, kicker);
			if (option.presentation.badge) {
				const badge = doc.createElement("span");
				badge.className = "talos-agent-model-option-badge";
				badge.textContent = option.presentation.badge;
				line.appendChild(badge);
			}
			const description = doc.createElement("small");
			description.textContent = option.presentation.description;
			copy.append(line, description);
			const check = doc.createElement("span");
			check.className = "talos-agent-model-option-check";
			check.setAttribute("aria-hidden", "true");
			check.textContent = "✓";
			button.append(copy, check);
			button.addEventListener("click", () => void this.selectModel(option.id));
			this.modelMenu.appendChild(button);
		}
	}

	private setModelMenuOpen(open: boolean, focusFirst = false): void {
		if (!this.modelMenu || !this.modelTrigger || !this.modelControl) return;
		this.modelMenu.hidden = !open;
		this.modelTrigger.setAttribute("aria-expanded", String(open));
		this.modelControl.classList.toggle("is-open", open);
		if (open) {
			this.setPermissionMenuOpen(false);
			this.renderModelMenu();
			this.outsideModelMenuListener ??= (event: PointerEvent) => {
				if (!this.modelControl?.contains(event.target as Node)) this.setModelMenuOpen(false);
			};
			this.modelControl.ownerDocument.addEventListener("pointerdown", this.outsideModelMenuListener, true);
			const selected = this.modelMenu.querySelector<HTMLElement>('[aria-selected="true"]');
			if (focusFirst) (selected ?? this.modelMenu.querySelector<HTMLElement>(".talos-agent-model-option"))?.focus();
		} else {
			if (this.outsideModelMenuListener) this.modelControl.ownerDocument.removeEventListener("pointerdown", this.outsideModelMenuListener, true);
			if (focusFirst) this.modelTrigger.focus();
		}
	}

	private updatePermissionTrigger(): void {
		if (!this.permissionTrigger || !this.permissionTriggerLabel) return;
		const presentation = PERMISSION_PRESENTATION[this.options.service.getPermissionMode()];
		this.permissionTriggerLabel.textContent = presentation.label;
		this.permissionTrigger.title = presentation.description;
		this.permissionTrigger.setAttribute("aria-label", `授权模式，当前 ${presentation.label}`);
		const icon = this.permissionTrigger.querySelector<HTMLElement>(".talos-agent-permission-trigger-icon");
		if (icon) setIcon(icon, presentation.icon);
	}

	private renderPermissionMenu(): void {
		if (!this.permissionMenu) return;
		this.permissionMenu.replaceChildren();
		const doc = this.permissionMenu.ownerDocument;
		const heading = doc.createElement("div");
		heading.className = "talos-agent-permission-menu-heading";
		const title = doc.createElement("strong");
		title.textContent = "应如何批准智能体操作？";
		const hint = doc.createElement("small");
		hint.textContent = "同一授权标准用于 Claude、Codex 与 OhMyPi";
		heading.append(title, hint);
		this.permissionMenu.appendChild(heading);
		const current = this.options.service.getPermissionMode();
		for (const mode of ["ask", "scoped", "vault-full"] as const) {
			const presentation = PERMISSION_PRESENTATION[mode];
			const button = doc.createElement("button");
			button.type = "button";
			button.className = "talos-agent-permission-option";
			button.dataset.permission = mode;
			button.setAttribute("role", "option");
			button.setAttribute("aria-selected", String(mode === current));
			button.tabIndex = -1;
			const icon = doc.createElement("span");
			icon.className = "talos-agent-permission-option-icon";
			setIcon(icon, presentation.icon);
			const copy = doc.createElement("span");
			copy.className = "talos-agent-permission-option-copy";
			const label = doc.createElement("strong");
			label.textContent = presentation.label;
			const description = doc.createElement("small");
			description.textContent = presentation.description;
			copy.append(label, description);
			const check = doc.createElement("span");
			check.className = "talos-agent-permission-option-check";
			check.setAttribute("aria-hidden", "true");
			check.textContent = "✓";
			button.append(icon, copy, check);
			button.addEventListener("click", () => this.selectPermissionMode(mode));
			this.permissionMenu.appendChild(button);
		}
	}

	private selectPermissionMode(mode: PermissionMode): void {
		this.options.service.setPermissionMode(mode);
		this.updatePermissionTrigger();
		this.renderPermissionMenu();
		this.setPermissionMenuOpen(false);
	}

	private setPermissionMenuOpen(open: boolean, focusFirst = false): void {
		if (!this.permissionMenu || !this.permissionTrigger || !this.permissionControl) return;
		this.permissionMenu.hidden = !open;
		this.permissionTrigger.setAttribute("aria-expanded", String(open));
		this.permissionControl.classList.toggle("is-open", open);
		if (open) {
			this.setModelMenuOpen(false);
			this.renderPermissionMenu();
			this.outsidePermissionMenuListener ??= (event: PointerEvent) => {
				if (!this.permissionControl?.contains(event.target as Node)) this.setPermissionMenuOpen(false);
			};
			this.permissionControl.ownerDocument.addEventListener("pointerdown", this.outsidePermissionMenuListener, true);
			const selected = this.permissionMenu.querySelector<HTMLElement>('[aria-selected="true"]');
			if (focusFirst) (selected ?? this.permissionMenu.querySelector<HTMLElement>(".talos-agent-permission-option"))?.focus();
		} else {
			if (this.outsidePermissionMenuListener) this.permissionControl.ownerDocument.removeEventListener("pointerdown", this.outsidePermissionMenuListener, true);
			if (focusFirst) this.permissionTrigger.focus();
		}
	}

	private handlePermissionMenuKeydown(event: KeyboardEvent): void {
		if (!this.permissionMenu) return;
		const options = Array.from(this.permissionMenu.querySelectorAll<HTMLButtonElement>(".talos-agent-permission-option"));
		const index = options.indexOf(event.target as HTMLButtonElement);
		if (event.key === "Escape") {
			event.preventDefault();
			this.setPermissionMenuOpen(false, true);
			return;
		}
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		event.preventDefault();
		const delta = event.key === "ArrowDown" ? 1 : -1;
		options[(index + delta + options.length) % options.length]?.focus();
	}

	private handleModelMenuKeydown(event: KeyboardEvent): void {
		if (!this.modelMenu) return;
		const options = Array.from(this.modelMenu.querySelectorAll<HTMLButtonElement>(".talos-agent-model-option"));
		const index = options.indexOf(event.target as HTMLButtonElement);
		if (event.key === "Escape") {
			event.preventDefault();
			this.setModelMenuOpen(false, true);
			return;
		}
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		event.preventDefault();
		const delta = event.key === "ArrowDown" ? 1 : -1;
		options[(index + delta + options.length) % options.length]?.focus();
	}

	private async selectModel(value: string): Promise<void> {
		if (!this.model || !this.modelTrigger || this.modelTrigger.disabled) return;
		const runtimeId = this.options.service.getSelectedRuntimeId();
		const previous = this.options.service.getSelection();
		const descriptor = this.modelDescriptors.find((candidate) => candidate.id === value);
		const label = descriptor ? presentRuntimeModel(runtimeId, descriptor).label : "自动选择";
		try {
			this.options.service.selectModel(value || undefined);
			this.reconcileReasoningForActiveModel();
		} catch (error) {
			if (this.status) this.status.textContent = `模型切换失败 · ${error instanceof Error ? error.message : String(error)}`;
			return;
		}
		this.model.value = value;
		this.model.disabled = true;
		this.modelTrigger.disabled = true;
		this.modelControl?.setAttribute("data-state", "switching");
		if (this.modelAnnouncement) this.modelAnnouncement.textContent = `正在切换到 ${label}`;
		this.updateModelTrigger();
		try {
			await this.native.selectRuntime(runtimeId, value || undefined);
			this.modelControl?.setAttribute("data-state", "selected");
			if (this.modelAnnouncement) this.modelAnnouncement.textContent = `已选择 ${label}，从下一回合生效`;
			this.renderModelMenu();
			this.renderExecutionOptions();
			this.setModelMenuOpen(false);
		} catch (error) {
			this.options.service.restoreSelection(previous);
			this.model.value = previous.model ?? "";
			this.modelControl?.setAttribute("data-state", "error");
			this.updateModelTrigger();
			if (this.status) this.status.textContent = `模型切换失败 · ${error instanceof Error ? error.message : String(error)}`;
			if (this.modelAnnouncement) this.modelAnnouncement.textContent = `模型切换失败，已恢复 ${this.modelTriggerLabel?.textContent ?? "原模型"}`;
		} finally {
			this.model.disabled = false;
			this.modelTrigger.disabled = false;
		}
	}

	private activeModelDescriptor(): ModelDescriptor | undefined {
		const selected = this.options.service.getSelection().model;
		if (selected) return this.modelDescriptors.find((candidate) => candidate.id === selected);
		return this.modelDescriptors.find((candidate) => candidate.isDefault);
	}

	private reconcileReasoningForActiveModel(): boolean {
		const selection = this.options.service.getSelection();
		const reasoning = reasoningForModel(this.activeModelDescriptor(), selection.reasoning);
		if (reasoning === selection.reasoning) return false;
		this.options.service.selectReasoning(reasoning);
		return true;
	}

	private renderExecutionOptions(): void {
		if (!this.reasoningControl || !this.reasoning || !this.serviceTierControl || !this.serviceTier) return;
		const descriptor = this.activeModelDescriptor();
		const selection = this.options.service.getSelection();
		const reasoningOptions = descriptor?.reasoningOptions ?? [];
		this.reasoning.replaceChildren();
		const automatic = this.reasoning.ownerDocument.createElement("option");
		automatic.value = "";
		automatic.textContent = descriptor?.defaultReasoning ? `默认 · ${descriptor.defaultReasoning}` : "运行时默认";
		this.reasoning.appendChild(automatic);
		for (const option of reasoningOptions) {
			const item = this.reasoning.ownerDocument.createElement("option");
			item.value = option.value;
			item.textContent = option.label;
			item.title = option.description ?? "";
			this.reasoning.appendChild(item);
		}
		this.reasoning.value = selection.reasoning && reasoningOptions.some((option) => option.value === selection.reasoning)
			? selection.reasoning
			: "";
		this.reasoningControl.hidden = reasoningOptions.length === 0;

		const fastTier = descriptor?.serviceTiers?.find((tier) => tier.label.trim().toLowerCase() === "fast")
			?? descriptor?.serviceTiers?.find((tier) => tier.id.trim().toLowerCase() === "fast");
		this.serviceTierControl.hidden = !fastTier;
		this.serviceTier.classList.toggle("active", Boolean(fastTier && selection.serviceTier === fastTier.id));
		this.serviceTier.setAttribute("aria-pressed", String(Boolean(fastTier && selection.serviceTier === fastTier.id)));
		this.serviceTier.title = fastTier
			? `${fastTier.label}：${fastTier.description ?? "切换快速服务层"}`
			: "当前模型不提供快速服务层";
	}

	private async selectReasoning(value: string): Promise<void> {
		const previous = this.options.service.getSelection().reasoning;
		try {
			this.options.service.selectReasoning(value || undefined);
			await this.native.persistCurrentSelection();
		} catch (error) {
			this.options.service.selectReasoning(previous);
			if (this.reasoning) this.reasoning.value = previous ?? "";
			if (this.status) this.status.textContent = `思考强度切换失败 · ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	private async toggleServiceTier(): Promise<void> {
		const descriptor = this.activeModelDescriptor();
		const fastTier = descriptor?.serviceTiers?.find((tier) => tier.label.trim().toLowerCase() === "fast")
			?? descriptor?.serviceTiers?.find((tier) => tier.id.trim().toLowerCase() === "fast");
		if (!fastTier) return;
		const previous = this.options.service.getSelection().serviceTier;
		try {
			const fallback = descriptor?.defaultServiceTier && descriptor.defaultServiceTier !== fastTier.id
				? descriptor.defaultServiceTier
				: undefined;
			this.options.service.selectServiceTier(previous === fastTier.id ? fallback : fastTier.id);
			await this.native.persistCurrentSelection();
			this.renderExecutionOptions();
		} catch (error) {
			this.options.service.selectServiceTier(previous);
			if (this.status) this.status.textContent = `服务层切换失败 · ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	private async refreshRuntime(runtimeId: RuntimeId): Promise<void> {
		if (!this.status || !this.model || !this.provider || !this.install) return;
		const refreshVersion = ++this.refreshVersion;
		this.updateRuntimeButtons(runtimeId);
		this.modelRuntimeId = runtimeId;
		this.modelDescriptors = [];
		this.renderExecutionOptions();
		this.setModelMenuOpen(false);
		this.renderModelTriggerIcon(runtimeId);
		this.status.dataset.state = "checking";
		this.status.textContent = `${RUNTIME_PRESENTATION.find((runtime) => runtime.id === runtimeId)?.label ?? runtimeId} · 检测中`;
		this.install.hidden = true;
		this.provider.replaceChildren();
		const native = this.provider.ownerDocument.createElement("option"); native.value = "native"; native.textContent = nativeProviderLabel(runtimeId); this.provider.appendChild(native);
		for (const profile of this.options.service.getProviderProfiles(runtimeId)) {
			const option = this.provider.ownerDocument.createElement("option"); option.value = profile.id; option.textContent = profile.displayName;
			this.provider.appendChild(option);
		}
		const selection = this.options.service.getSelection();
		this.provider.value = selection.providerProfileId ?? "native";
		const probe = await this.options.service.probeRuntime(runtimeId);
		if (refreshVersion !== this.refreshVersion || !this.status || !this.model || !this.provider || !this.install) return;
		this.status.dataset.state = probe.status;
		this.status.textContent = `${RUNTIME_PRESENTATION.find((runtime) => runtime.id === runtimeId)?.label ?? runtimeId} · ${RUNTIME_HEALTH_LABELS[probe.status]}${probe.version ? ` · ${probe.version}` : ""}${probe.reason ? ` · ${probe.reason}` : ""}`;
		this.install.hidden = probe.status !== "not-installed" && probe.status !== "incompatible";
		if (!this.install.hidden) {
			const urls: Record<RuntimeId, string> = { claude: "https://docs.anthropic.com/en/docs/claude-code/setup", codex: "https://developers.openai.com/codex/cli", ohmypi: "https://github.com/can1357/oh-my-pi" };
			this.install.href = urls[runtimeId];
		}
		this.model.replaceChildren();
		const automatic = this.model.ownerDocument.createElement("option"); automatic.value = ""; automatic.textContent = "运行时默认模型"; this.model.appendChild(automatic);
		if (probe.status === "ready") {
			try {
				const descriptors = await this.options.service.listModels(runtimeId);
				if (refreshVersion !== this.refreshVersion) return;
				this.modelDescriptors = descriptors;
				for (const descriptor of descriptors) {
					const option = this.model.ownerDocument.createElement("option"); option.value = descriptor.id; option.textContent = descriptor.label; this.model.appendChild(option);
				}
				let selectionChanged = false;
				const defaultModel = explicitDefaultModel(runtimeId, descriptors, this.options.service.getSelection().model);
				if (defaultModel !== this.options.service.getSelection().model) {
					this.options.service.selectModel(defaultModel);
					selectionChanged = true;
				}
				if (this.reconcileReasoningForActiveModel()) selectionChanged = true;
				if (selectionChanged) await this.native.persistCurrentSelection();
				const selectedModel = this.options.service.getSelection().model;
				if (selectedModel && Array.from(this.model.options).some((option) => option.value === selectedModel)) this.model.value = selectedModel;
				this.updateModelTrigger();
				this.renderModelMenu();
				this.renderExecutionOptions();
			} catch (error) {
				this.status.dataset.state = "degraded";
				this.status.textContent = `${RUNTIME_PRESENTATION.find((runtime) => runtime.id === runtimeId)?.label ?? runtimeId} · 模型列表不可用 · ${error instanceof Error ? error.message : "unknown"}`;
			}
		}
		this.updateModelTrigger();
		this.renderExecutionOptions();
	}

	async suspend(): Promise<void> {
		this.setModelMenuOpen(false);
		this.setPermissionMenuOpen(false);
		this.clearHandoffToast();
		await this.native.suspend();
		this.root?.remove();
	}
	focusComposer(): void { this.native.focusComposer(); }
	async destroy(): Promise<void> {
		this.setModelMenuOpen(false);
		this.setPermissionMenuOpen(false);
		this.clearHandoffToast();
		this.outsideModelMenuListener = null;
		this.outsidePermissionMenuListener = null;
		await this.native.destroy();
		this.root?.remove();
		this.root = null;
		this.body = null;
		this.status = null;
		this.model = null;
		this.modelControl = null;
		this.modelTrigger = null;
		this.modelTriggerIcon = null;
		this.modelTriggerLabel = null;
		this.modelTriggerMeta = null;
		this.modelMenu = null;
		this.modelAnnouncement = null;
		this.modelDescriptors = [];
		this.reasoningControl = null;
		this.reasoning = null;
		this.serviceTierControl = null;
		this.serviceTier = null;
		this.permissionControl = null;
		this.permissionTrigger = null;
		this.permissionTriggerLabel = null;
		this.permissionMenu = null;
		this.provider = null;
		this.runtimeButtons.clear();
		this.install = null;
	}
}

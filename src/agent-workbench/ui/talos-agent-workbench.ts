import type { WorkspaceLeaf } from "obsidian";
import type { ChatSurfaceWorkbench } from "../../quyuan/chat-surface";
import type { AgentWorkbenchService } from "../core/agent-workbench-service";
import type { RuntimeHealth, RuntimeId } from "../contracts/runtime-adapter";
import {
	CLAUDE_PROVIDER_ICON,
	OPENAI_PROVIDER_ICON,
	PI_PROVIDER_ICON,
	createProviderIconSvg,
} from "../../quyuan/claudian/shared/icons";
import type { ClaudianCompatibilityHost } from "./claudian-compatibility-host";
import { CompatibilityChatView } from "./compatibility-chat-view";

export interface TalosAgentWorkbenchOptions {
	leaf: WorkspaceLeaf;
	service: AgentWorkbenchService;
	compatibility: ClaudianCompatibilityHost;
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

function nativeProviderLabel(runtimeId: RuntimeId): string {
	return NATIVE_PROVIDER_LABELS[runtimeId];
}

export class TalosAgentWorkbench implements ChatSurfaceWorkbench {
	private readonly compatibility: CompatibilityChatView;
	private root: HTMLElement | null = null;
	private body: HTMLElement | null = null;
	private status: HTMLElement | null = null;
	private model: HTMLSelectElement | null = null;
	private provider: HTMLSelectElement | null = null;
	private readonly runtimeButtons = new Map<RuntimeId, HTMLButtonElement>();
	private install: HTMLAnchorElement | null = null;
	private refreshVersion = 0;

	constructor(private readonly options: TalosAgentWorkbenchOptions) {
		this.compatibility = new CompatibilityChatView(options.leaf, options.compatibility);
		this.compatibility.onRuntimeChanged((runtimeId) => {
			this.options.service.selectRuntime(runtimeId);
			this.updateRuntimeButtons(runtimeId);
			void this.refreshRuntime(runtimeId);
		});
	}

	async mount(container: HTMLElement, namespace: "chat"): Promise<void> {
		if (namespace !== "chat") throw new Error("TALOS 智能体只允许 chat 命名空间");
		if (!this.root) this.build(container.ownerDocument);
		if (!this.root || !this.body) throw new Error("TALOS 智能体展示层未建立");
		if (this.root.parentElement !== container) container.appendChild(this.root);
		await this.compatibility.mount(this.body, namespace);
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
				this.setRuntimeButtonsDisabled(true);
				void this.compatibility.selectRuntime(runtime.id).then(() => {
					this.appendHandoffMarker(root, previous, runtime.id);
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
			try {
				this.options.service.selectProviderProfile(provider.value === "native" ? undefined : provider.value);
				this.options.service.selectModel(undefined);
				void this.refreshRuntime(this.options.service.getSelectedRuntimeId());
			} catch (error) {
				provider.value = this.options.service.getSelection().providerProfileId ?? "native";
				if (this.status) this.status.textContent = `Provider 切换失败 · ${error instanceof Error ? error.message : String(error)}`;
			}
		});
		controls.appendChild(provider);

		const model = doc.createElement("select");
		model.className = "talos-agent-model-picker";
		model.setAttribute("aria-label", "模型");
		const automatic = doc.createElement("option");
		automatic.value = "";
		automatic.textContent = "运行时默认模型";
		model.appendChild(automatic);
		controls.appendChild(model);
		this.model = model;
		model.addEventListener("change", () => {
			const runtimeId = this.options.service.getSelectedRuntimeId();
			const previous = this.options.service.getSelection().model;
			try {
				this.options.service.selectModel(model.value || undefined);
			} catch (error) {
				if (this.status) this.status.textContent = `模型切换失败 · ${error instanceof Error ? error.message : String(error)}`;
				return;
			}
			model.disabled = true;
			void this.compatibility.selectRuntime(runtimeId, model.value || undefined).catch((error: unknown) => {
				this.options.service.selectModel(previous); model.value = previous ?? "";
				if (this.status) this.status.textContent = `模型切换失败 · ${error instanceof Error ? error.message : String(error)}`;
			}).finally(() => { model.disabled = false; });
		});

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

		const permission = doc.createElement("select");
		permission.className = "talos-agent-permission-picker";
		permission.setAttribute("aria-label", "授权模式");
		for (const [value, label] of [
			["ask", "每次询问"],
			["scoped", "仅已授权范围"],
			["vault-full", "Vault 普通写入自动"],
		] as const) {
			const option = doc.createElement("option"); option.value = value; option.textContent = label; permission.appendChild(option);
		}
		permission.value = this.options.service.getPermissionMode();
		permission.addEventListener("change", () => this.options.service.setPermissionMode(permission.value as "ask" | "scoped" | "vault-full"));
		controls.appendChild(permission);

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
		const marker = root.ownerDocument.createElement("div");
		marker.className = "talos-agent-handoff-marker";
		marker.setAttribute("role", "status");
		marker.textContent = `${from} → ${to} · 将在下一回合注入增量上下文并恢复目标原生会话`;
		root.insertBefore(marker, this.body);
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

	private async refreshRuntime(runtimeId: RuntimeId): Promise<void> {
		if (!this.status || !this.model || !this.provider || !this.install) return;
		const refreshVersion = ++this.refreshVersion;
		this.updateRuntimeButtons(runtimeId);
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
				for (const descriptor of descriptors) {
					const option = this.model.ownerDocument.createElement("option"); option.value = descriptor.id; option.textContent = descriptor.label; this.model.appendChild(option);
				}
				const selectedModel = this.options.service.getSelection().model;
				if (selectedModel && Array.from(this.model.options).some((option) => option.value === selectedModel)) this.model.value = selectedModel;
			} catch (error) {
				this.status.dataset.state = "degraded";
				this.status.textContent = `${RUNTIME_PRESENTATION.find((runtime) => runtime.id === runtimeId)?.label ?? runtimeId} · 模型列表不可用 · ${error instanceof Error ? error.message : "unknown"}`;
			}
		}
	}

	async suspend(): Promise<void> {
		await this.compatibility.suspend();
		this.root?.remove();
	}
	focusComposer(): void { this.compatibility.focusComposer(); }
	async destroy(): Promise<void> {
		await this.compatibility.destroy();
		this.root?.remove();
		this.root = null;
		this.body = null;
		this.status = null;
		this.model = null;
		this.provider = null;
		this.runtimeButtons.clear();
		this.install = null;
	}
}

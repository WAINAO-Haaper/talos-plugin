import type { WorkspaceLeaf } from "obsidian";
import type { ChatSurfaceWorkbench } from "../../quyuan/chat-surface";
import type { AgentWorkbenchService } from "../core/agent-workbench-service";
import type { RuntimeId } from "../contracts/runtime-adapter";
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
	private runtime: HTMLSelectElement | null = null;
	private install: HTMLAnchorElement | null = null;
	private refreshVersion = 0;

	constructor(private readonly options: TalosAgentWorkbenchOptions) {
		this.compatibility = new CompatibilityChatView(options.leaf, options.compatibility);
		this.compatibility.onRuntimeChanged((runtimeId) => {
			this.options.service.selectRuntime(runtimeId);
			if (this.runtime) this.runtime.value = runtimeId;
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

		const runtime = doc.createElement("select");
		runtime.className = "talos-agent-runtime-picker";
		runtime.setAttribute("aria-label", "智能体");
		for (const [id, label] of [["claude", "Claude"], ["codex", "Codex"], ["ohmypi", "OhMyPi"]] as const) {
			const option = doc.createElement("option");
			option.value = id;
			option.textContent = label;
			runtime.appendChild(option);
		}
		runtime.value = this.options.service.getSelectedRuntimeId();
		this.runtime = runtime;
		runtime.addEventListener("change", () => {
			const previous = this.options.service.getSelectedRuntimeId();
			const next = runtime.value as RuntimeId;
			runtime.disabled = true;
			void this.compatibility.selectRuntime(next).then(() => {
				this.appendHandoffMarker(root, previous, next);
			}).catch((error: unknown) => {
				runtime.value = previous;
				if (this.status) this.status.textContent = `切换失败 · ${error instanceof Error ? error.message : String(error)}`;
			}).finally(() => { runtime.disabled = false; });
		});
		controls.appendChild(runtime);

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
				void this.refreshRuntime(runtime.value as RuntimeId);
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
			const runtimeId = runtime.value as RuntimeId;
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
		for (const [value, label] of [["plan", "Plan"], ["execute", "Execute"]] as const) {
			const button = doc.createElement("button");
			button.type = "button";
			button.textContent = label;
			button.dataset.value = value;
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
		for (const [value, label] of [["ask", "Ask"], ["scoped", "Scoped"], ["vault-full", "Vault Full"]] as const) {
			const option = doc.createElement("option"); option.value = value; option.textContent = label; permission.appendChild(option);
		}
		permission.value = this.options.service.getPermissionMode();
		permission.addEventListener("change", () => this.options.service.setPermissionMode(permission.value as "ask" | "scoped" | "vault-full"));
		controls.appendChild(permission);

		const status = doc.createElement("span");
		status.className = "talos-agent-runtime-status";
		status.setAttribute("role", "status");
		status.setAttribute("aria-live", "polite");
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

	private async refreshRuntime(runtimeId: RuntimeId): Promise<void> {
		if (!this.status || !this.model || !this.provider || !this.install) return;
		const refreshVersion = ++this.refreshVersion;
		this.status.textContent = `${runtimeId} · 检测中`;
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
		this.status.textContent = `${runtimeId} · ${probe.status}${probe.version ? ` · ${probe.version}` : ""}${probe.reason ? ` · ${probe.reason}` : ""}`;
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
				this.status.textContent = `${runtimeId} · degraded · 模型目录不可用：${error instanceof Error ? error.message : "unknown"}`;
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
		this.runtime = null;
		this.install = null;
	}
}

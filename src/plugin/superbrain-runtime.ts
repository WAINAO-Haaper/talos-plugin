// 超级大脑框架运行层（D-TLP-072，移植自超级大脑分支线 branch-convergence-v0.5 的 main.ts）：
// 模块命令、本地工具 / 工作流 / 定时入口的受控执行、官方 API 直写执行与收据、C/M 详情页端口、画布布局保存。
// 安全边界原样保留：本地执行只在既有确认窗口点击后经 TALOS runner 运行；API 只发往 Anthropic / OpenAI 官方端点，
// 经出库审计；资料读写拒绝凭据、系统规则与运行收据，并在写入时复核秘密内容与版本条件。
import { FileSystemAdapter, TFile } from "obsidian";
import type TalosPlugin from "../main";
import type { TalosSettings } from "../settings";
import { TalosView, VIEW_TYPE_TALOS } from "../view";
import { normalizeSuperbrainCanvasLayout } from "../ui/superbrain-canvas-layout";
import { ModuleCommandController } from "../module-commands/controller";
import { LocalMediaRecognition } from "../module-commands/media-recognition";
import type { SuperbrainWorkflowSlug } from "../module-commands/superbrain-catalog";
import { LocalSuperbrainRunner, SuperbrainToolService, SuperbrainScheduleService, type SuperbrainToolPlan, type SuperbrainSchedulePlan } from "../module-commands/superbrain-tool-service";
import { SuperbrainApiWorkflowService, SuperbrainWorkflowService, type SuperbrainDirectApiPlan, type SuperbrainWorkflowPlan } from "../module-commands/superbrain-workflow-service";
import { SuperbrainDirectApiExecution, type ApiWorkflowExecutionResult } from "../module-commands/superbrain-api-execution";
import type { SuperbrainDirectVaultHost } from "../module-commands/superbrain-direct-vault-tools";
import type { SuperbrainDetailPorts } from "../ui/superbrain-detail-page";
import type { ApiToolRunner } from "../ai/provider/api-agent-runtime";
import type { AskEvent, TalosProvider } from "../ai/provider/types";
import { inspectVaultContent, inspectVaultPath } from "../ai/context/secret-policy";
import { auditProviderEgress } from "../ai/privacy/provider-egress-gate";
import { createVaultProviderEgressAuditStore } from "../ai/privacy/provider-egress-audit-store";
import { AnthropicApiProvider } from "../ai/provider/anthropic-api-provider";
import { OpenAiCompatibleProvider } from "../ai/provider/openai-compatible-provider";
import { providerSecretStoreFromApp } from "../ai/provider/secret-storage-runtime";
import { validateVaultRelativePath } from "../module-commands/data-format";
import { createModuleBoundaryCheck, preserveCreatedFileOnRecovery } from "../module-commands/vault-access";
import { completedTaskResult, partialTaskResult } from "../task-core/task-runner";
import { isRecord, TRUSTED_PROVIDER_FETCH } from "./plugin-support";
import { getTalosAskCommand } from "./provider-runtime";
import { ensureVaultFolder } from "./quyuan-diagnostics";

export class SuperbrainRuntime {
	readonly moduleCommands: ModuleCommandController;
	private superbrainServices: { tool: SuperbrainToolService; workflow: SuperbrainWorkflowService; schedule: SuperbrainScheduleService } | null = null;
	private canvasSettingsSave: Promise<void> = Promise.resolve();

	constructor(private readonly plugin: TalosPlugin) {
		this.moduleCommands = this.createModuleCommandController();
	}

	private createModuleCommandController(): ModuleCommandController {
		const adapter = this.plugin.app.vault.adapter;
		const basePath = typeof (adapter as { getBasePath?: unknown }).getBasePath === "function"
			? (adapter as FileSystemAdapter).getBasePath() : null;
		const check = basePath ? createModuleBoundaryCheck(basePath, this.plugin.app.vault.configDir) : null;
		const assertPath = async (path: string): Promise<void> => {
			if (!check) throw new Error("当前存储环境无法验证文件边界，写入与内容读取暂不可用");
			await check(path);
		};
		return new ModuleCommandController({
			app: this.plugin.app, runtime: this.plugin.getConsoleActionRuntime(), refresh: () => this.plugin.refreshViews(),
			mediaRecognition: () => basePath ? new LocalMediaRecognition({
				vaultRoot: basePath,
				whisperCli: this.plugin.talosSettings.mediaWhisperCliPath.trim() || undefined,
				whisperModel: this.plugin.talosSettings.mediaWhisperModelPath.trim() || undefined,
				ffmpegCli: this.plugin.talosSettings.mediaFfmpegCliPath.trim() || undefined,
			}) : undefined,
			host: {
				roots: () => ({ inbox: this.plugin.paths.dir("inbox"), logs: this.plugin.paths.dir("logs"), insights: this.plugin.paths.dir("insights"), assets: this.plugin.paths.dir("assets"), projects: this.plugin.paths.dir("projects"), archive: this.plugin.paths.dir("archive"), identity: this.plugin.paths.dir("identity"), output: this.plugin.paths.dir("output"), system: this.plugin.paths.dir("system") }),
				files: () => this.plugin.app.vault.getFiles().map(file => ({ path: file.path, extension: file.extension, size: file.stat.size, mtime: file.stat.mtime })),
				exists: path => adapter.exists(path),
				assertPath,
				read: async path => { await assertPath(path); return new Uint8Array(await adapter.readBinary(path)); },
				write: async (path: string, bytes: Uint8Array, expected?: Uint8Array | null) => {
					await assertPath(path);
					const folder = path.slice(0, path.lastIndexOf("/"));
					if (folder) await ensureVaultFolder(this.plugin, folder);
					await assertPath(path);
					const file = this.plugin.app.vault.getAbstractFileByPath(path);
					const buffer = new Uint8Array(bytes).buffer;
					if (expected === null) {
						if (file) throw new Error("目标已变化，不能覆盖");
						await this.plugin.app.vault.createBinary(path, buffer);
					} else if (expected !== undefined) {
						if (!(file instanceof TFile)) throw new Error("目标已变化，请重新预览");
						const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
						await this.plugin.app.vault.process(file, current => {
							const currentBytes = new TextEncoder().encode(current);
							if (currentBytes.length !== expected.length || !currentBytes.every((v, i) => v === expected[i])) throw new Error("预览后文件发生变化，请重新预览");
							return text;
						});
					} else throw new Error("写入缺少版本条件");
				},
				remove: preserveCreatedFileOnRecovery,
				conditionalDelete: false,
				now: () => new Date(),
			},
			ask: async (query, signal) => {
				const text: string[] = []; let failure = "";
				for await (const event of getTalosAskCommand(this.plugin).execute({ channel: "obsidian", providerId: this.plugin.selectedTalosAskProviderId(), query, signal, writebackIntent: "display-only", approvalState: "not-required" })) {
					if (signal.aborted) throw new Error("已取消接收问答结果");
					if (event.type === "text") text.push(event.text);
					if (event.type === "error") failure = event.message;
				}
				if (failure) throw new Error(failure);
				if (!text.join("").trim()) throw new Error("模型未返回回答");
				return text.join("");
			},
		});
	}

	private superbrainRuntimeServices(vaultRoot: string) {
		if (this.superbrainServices) return this.superbrainServices;
		const runner = new LocalSuperbrainRunner(vaultRoot);
		const tool = new SuperbrainToolService(runner, vaultRoot);
		const workflow = new SuperbrainWorkflowService(runner, path => this.plugin.app.vault.adapter.exists(path));
		const schedule = new SuperbrainScheduleService(runner);
		const registry = this.plugin.getConsoleActionRuntime().registry;
		const signalOf = (inner: AbortSignal, outer?: AbortSignal) => outer ? AbortSignal.any([inner, outer]) : inner;
		registry.register({
			id: "superbrain-tool-write", label: "超级大脑本地工具", description: "执行已预览的本地工具",
			risk: "C", readScope: ["**"], writeScope: ["**"], timeoutMs: 600_000,
			cancelable: true, reversible: false,
			execute: async (context, value) => {
				const input = value as { plan: SuperbrainToolPlan; signal?: AbortSignal };
				const result = await tool.run(input.plan, signalOf(context.signal, input.signal));
				const failed = result && typeof result === "object" && (result as Record<string, unknown>).process_exit_code !== 0;
				return failed ? partialTaskResult({ result, error: "本地工具报告失败", changes: [] }) : completedTaskResult(result, []);
			},
		});
		registry.register({
			id: "superbrain-workflow-run", label: "超级大脑本机工作流", description: "调用已预览的本机智能体工作流",
			risk: "C", readScope: ["**"], writeScope: ["**"], timeoutMs: 7_300_000,
			cancelable: true, reversible: false,
			execute: async (context, value) => {
				const input = value as { plan: SuperbrainWorkflowPlan; signal?: AbortSignal };
				const result = await workflow.run(input.plan, signalOf(context.signal, input.signal));
				return result.status === "completed" || result.status === "no_change"
					? completedTaskResult(result, [])
					: partialTaskResult({ result, error: result.reason ?? "工作流未完成", changes: [] });
			},
		});
		registry.register({
			id: "superbrain-scheduled-run", label: "超级大脑可选任务", description: "运行已启用且已预览的本机任务",
			risk: "C", readScope: ["**"], writeScope: ["**"], timeoutMs: 7_300_000,
			cancelable: true, reversible: false,
			execute: async (context, value) => {
				const input = value as { plan: SuperbrainSchedulePlan; signal?: AbortSignal };
				const result = await schedule.run(input.plan, signalOf(context.signal, input.signal));
				const status = result && typeof result === "object" ? (result as Record<string, unknown>).status : undefined;
				return status === "completed" || status === "no_change" || status === "already-ran-in-period"
					? completedTaskResult(result, [])
					: partialTaskResult({ result, error: "可选任务未完成", changes: [] });
			},
		});
		return this.superbrainServices = { tool, workflow, schedule };
	}

	private async runConfirmedSuperbrainAction(actionId: "superbrain-tool-write" | "superbrain-workflow-run" | "superbrain-scheduled-run", plan: SuperbrainToolPlan | SuperbrainWorkflowPlan | SuperbrainSchedulePlan, signal?: AbortSignal): Promise<unknown> {
		// This is called only after the existing modal's explicit Confirm button is clicked.
		const task = await this.plugin.getConsoleActionRuntime().runner.run({
			actionId, idempotencyKey: `superbrain:${actionId}:${crypto.randomUUID()}`,
			input: { plan, signal }, approvalGranted: true,
			request: { readPaths: ["System/WORKFLOWS.md"], writePaths: [], effects: ["shell", "write"] },
		});
		if ((task.state === "completed" || task.state === "partial") && task.result !== undefined) return task.result;
		throw new Error(task.error ?? `任务状态：${task.state}`);
	}

	private async saveApiWorkflowReceipt(result: ApiWorkflowExecutionResult, vaultRoot: string): Promise<string> {
		const runId = crypto.randomUUID();
		const parent = "System/working-memory/workflow-runs/receipts";
		const path = `${parent}/api-${runId}.json`;
		const check = createModuleBoundaryCheck(vaultRoot, this.plugin.app.vault.configDir);
		await check(path);
		if (await this.plugin.app.vault.adapter.exists(path)) throw new Error("API 收据目标已存在");
		await ensureVaultFolder(this.plugin, parent);
		await check(path);
		await this.plugin.app.vault.create(path, JSON.stringify({
			schema_version: 1, run_id: runId, workflow_id: result.workflow_id, host: "api",
			provider_id: result.providerId, status: result.status, evidence: result.evidence,
			reason: result.reason, task_ids: result.taskIds, model_called: result.model_called,
			changed_files: result.changedFiles ?? [],
		}, null, 2) + "\n");
		return path;
	}

	private async readSuperbrainWorkflowRule(slug: SuperbrainWorkflowSlug): Promise<string> {
		const raw = await this.plugin.app.vault.adapter.read("System/WORKFLOWS.md");
		const heading = `## /${slug} `;
		const start = raw.indexOf(heading);
		if (start < 0) throw new Error(`工作流 /${slug} 规则缺失`);
		const next = raw.indexOf("\n## ", start + heading.length);
		return raw.slice(start, next < 0 ? undefined : next).slice(0, 12_000);
	}

	/** Every IO method enforces the non-secret content boundary, including at write time. */
	private superbrainDirectVaultHost(vaultRoot: string): SuperbrainDirectVaultHost {
		const check = createModuleBoundaryCheck(vaultRoot, this.plugin.app.vault.configDir);
		const contentPath = (raw: string): string => {
			const path = validateVaultRelativePath(raw);
			if (inspectVaultPath(path, { configDir: this.plugin.app.vault.configDir }).blocked
				|| /(?:^|\/)(?:AGENTS|CLAUDE|GEMINI)\.md$/i.test(path)
				|| path.toLocaleLowerCase("en-US").startsWith("system/working-memory/workflow-runs/")) {
				throw new Error("模型 API 不可访问凭据、系统规则或运行收据");
			}
			return path;
		};
		const safeText = (path: string, content: string): string => {
			if (inspectVaultContent(path, content, { configDir: this.plugin.app.vault.configDir }).blocked) {
				throw new Error("文件含秘密内容，模型 API 不可读取或覆盖");
			}
			return content;
		};
		const checkedFile = (path: string): TFile => {
			const file = this.plugin.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) throw new Error("当前库文件不存在");
			return file;
		};
		return {
			files: () => this.plugin.app.vault.getFiles().map(file => file.path).filter(path => {
				try { contentPath(path); return true; } catch { return false; }
			}),
			assertPath: async raw => { const path = contentPath(raw); await check(path); },
			exists: async raw => { const path = contentPath(raw); await check(path); return this.plugin.app.vault.getAbstractFileByPath(path) instanceof TFile; },
			read: async raw => {
				const path = contentPath(raw);
				await check(path);
				return safeText(path, await this.plugin.app.vault.read(checkedFile(path)));
			},
			write: async (raw, content, expected) => {
				const path = contentPath(raw);
				safeText(path, content);
				await check(path);
				if (expected === null) {
					if (this.plugin.app.vault.getAbstractFileByPath(path)) throw new Error("目标文件已存在，请重新读取");
					const slash = path.lastIndexOf("/");
					if (slash > 0) await ensureVaultFolder(this.plugin, path.slice(0, slash));
					await check(path);
					if (this.plugin.app.vault.getAbstractFileByPath(path)) throw new Error("目标文件已变化，请重新读取");
					await this.plugin.app.vault.create(path, content);
					return;
				}
				const file = checkedFile(path);
				await this.plugin.app.vault.process(file, current => {
					safeText(path, current);
					if (current !== expected) throw new Error("文件在读取后发生变化，请重新核对");
					return content;
				});
			},
		};
	}

	/** Only the two user-authorized official API destinations can receive tool results. */
	private async *chatSuperbrainDirectApi(input: { providerId: string; prompt: string; toolRunner: ApiToolRunner; signal?: AbortSignal }): AsyncIterable<AskEvent> {
		const secrets = providerSecretStoreFromApp(this.plugin.app);
		if (!secrets) throw new Error("当前 Obsidian 缺少安全凭据存储，模型 API 不可运行");
		const runId = crypto.randomUUID();
		let auditSequence = 0;
		const auditStore = createVaultProviderEgressAuditStore(this.plugin.app);
		const approvedText = async (text: string, paths: string[], sourceKind: "prompt" | "tool-result"): Promise<string> => {
			const result = await auditProviderEgress({
				providerId: input.providerId, vaultAccess: "full", paths, text,
				sourceKinds: [sourceKind], configDir: this.plugin.app.vault.configDir,
			});
			await auditStore.append({
				runId: `superbrain-api-${runId}`, turnId: `egress-${++auditSequence}`,
				sessionId: `superbrain-api:${runId}`, namespace: "command", audit: result.audit,
			});
			if (!result.allowed) throw new Error(`模型 API 出库审计未通过：${result.audit.blockedReasons.join("、")}`);
			return result.redactedText;
		};
		const prompt = await approvedText(input.prompt, ["System/WORKFLOWS.md"], "prompt");
		const auditedRunner: ApiToolRunner = {
			run: async call => {
				const outcome = await input.toolRunner.run(call);
				if (outcome.isError) return outcome;
				const path = call.input.file_path;
				const paths = typeof path === "string" ? [path] : [];
				return { ...outcome, content: await approvedText(outcome.content, paths, "tool-result") };
			},
		};
		let provider: TalosProvider;
		if (input.providerId === "claude-api") {
			provider = new AnthropicApiProvider({
				id: "claude-api", endpoint: "https://api.anthropic.com",
				model: this.plugin.talosSettings.jarvisModel.trim() || "claude-sonnet-4-6",
				systemPrompt: "按当前资料库工作流执行本次任务；工具结果才是文件事实。",
				secretRef: this.plugin.talosSettings.providerSecretRefs.anthropicApiKey || "talos-anthropic-api-key",
				secrets, toolRunner: auditedRunner,
				thinkingLevel: this.plugin.talosSettings.jarvisThinkingLevel,
				fetcher: TRUSTED_PROVIDER_FETCH,
			});
		} else if (input.providerId === "openai-compatible") {
			provider = new OpenAiCompatibleProvider({
				id: "openai-compatible", endpoint: "https://api.openai.com",
				model: this.plugin.talosSettings.openaiModel.trim() || "gpt-4o",
				systemPrompt: "按当前资料库工作流执行本次任务；工具结果才是文件事实。",
				secretRef: this.plugin.talosSettings.providerSecretRefs.openaiApiKey || "talos-openai-api-key",
				secrets, toolRunner: auditedRunner,
				thinkingLevel: this.plugin.talosSettings.jarvisThinkingLevel,
				fetcher: TRUSTED_PROVIDER_FETCH,
			});
		} else throw new Error("本轮仅授权 Anthropic 和 OpenAI 官方 API");
		const cancel = () => { void provider.cancel(runId); };
		input.signal?.addEventListener("abort", cancel, { once: true });
		try {
			for await (const event of provider.chat({ runId, turnId: crypto.randomUUID(), text: prompt, toolsAllowed: true })) {
				if (input.signal?.aborted) throw new Error("模型 API 工作流已取消");
				yield event;
			}
		} finally { input.signal?.removeEventListener("abort", cancel); }
	}

	/** The new C/M pages reuse the existing local preview, runner, and receipt path. */
	getSuperbrainDetailPorts(): SuperbrainDetailPorts {
		const adapter = this.plugin.app.vault.adapter as FileSystemAdapter;
		const vaultRoot = typeof adapter.getBasePath === "function" ? adapter.getBasePath() : null;
		const services = vaultRoot ? this.superbrainRuntimeServices(vaultRoot) : null;
		const officialProviders = (): string[] => {
			if (!providerSecretStoreFromApp(this.plugin.app)) return [];
			const anthropicEndpoint = this.plugin.talosSettings.anthropicBaseUrl.trim().replace(/\/+$/, "");
			const openaiEndpoint = this.plugin.talosSettings.openaiBaseUrl.trim().replace(/\/+$/, "");
			return [
				(!anthropicEndpoint || anthropicEndpoint === "https://api.anthropic.com") && this.plugin.readProviderSecret("anthropicApiKey") ? "claude-api" : "",
				(!openaiEndpoint || openaiEndpoint === "https://api.openai.com") && this.plugin.readProviderSecret("openaiApiKey") ? "openai-compatible" : "",
			].filter(Boolean);
		};
		const directPlanner = new SuperbrainApiWorkflowService(async () => { throw new Error("直写入口不使用动作提案"); });
		type Prepared = { kind: "local"; plan: SuperbrainWorkflowPlan } | { kind: "api"; plan: SuperbrainDirectApiPlan };
		return {
			moduleRoots: () => ({ ...this.plugin.paths.schema }),
			listFiles: () => this.plugin.app.vault.getFiles().map(file => file.path),
			fileExists: path => this.plugin.app.vault.getAbstractFileByPath(path) instanceof TFile,
			openFile: async path => {
				const file = this.plugin.app.vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile)) throw new Error("资料文件已变化，请刷新后重试");
				await this.plugin.app.workspace.getLeaf(true).openFile(file);
			},
			apiProviders: () => officialProviders().map(id => ({ id, label: id === "claude-api" ? "Claude API" : "OpenAI API" })),
			previewWorkflow: async (slug, engine, instruction, signal) => {
				if (!services) return { status: "unconfigured", summary: "当前宿主不支持本机资料库工作流" };
				if (engine.startsWith("api:")) {
					const providerId = engine.slice(4);
					if (!officialProviders().includes(providerId)) return { status: "unconfigured", summary: "仅已配置的 Anthropic/OpenAI 官方 API 可处理当前库非秘密内容文件" };
					const rule = await this.readSuperbrainWorkflowRule(slug);
					if (signal.aborted) throw new Error("工作流已取消");
					const plan = directPlanner.prepareDirect(slug, providerId, rule, instruction);
					return { status: "ready", summary: "点击运行后，模型可按需读取并修改当前库的非秘密内容文件", preview: { workflow: slug, provider: providerId, scope: "current-vault-non-secret-content" }, token: { kind: "api", plan } satisfies Prepared };
				}
				if (engine !== "codex" && engine !== "claude") return { status: "unconfigured", summary: "智能体入口未登记" };
				const plan = await services.workflow.preview(slug, engine, instruction, signal);
				const state = plan.preview && typeof plan.preview === "object" ? plan.preview as Record<string, unknown> : {};
				return { status: state.status === "ready" ? "ready" : "unconfigured", summary: state.status === "ready" ? `本机 ${engine} 已就绪` : "本机智能体尚未就绪，请检查安装与配置", preview: plan.preview, token: { kind: "local", plan } satisfies Prepared };
			},
			runWorkflow: (token, signal) => {
				const prepared = token as Prepared;
				if (prepared.kind === "local") return this.runConfirmedSuperbrainAction("superbrain-workflow-run", prepared.plan, signal);
				if (prepared.kind !== "api" || !vaultRoot || !officialProviders().includes(prepared.plan.providerId)) throw new Error("模型 API 工作流计划无效或未获当前授权");
				return new SuperbrainDirectApiExecution({
					vault: this.superbrainDirectVaultHost(vaultRoot),
					chat: request => this.chatSuperbrainDirectApi(request),
					evidenceExists: path => this.plugin.app.vault.adapter.exists(path),
					saveReceipt: result => this.saveApiWorkflowReceipt(result, vaultRoot),
				}).run({ plan: prepared.plan, signal });
			},
			previewTool: async (tool, input, signal) => {
				if (!services) throw new Error("当前宿主不支持本地工具");
				const plan = await services.tool.preview(tool, input, signal);
				return { preview: plan.preview, writes: plan.writes, token: plan };
			},
			runTool: (token, signal) => this.runConfirmedSuperbrainAction("superbrain-tool-write", token as SuperbrainToolPlan, signal),
			previewSchedule: async (job, signal) => {
				if (!services) throw new Error("当前宿主不支持本机定时入口");
				const plan = await services.schedule.preview(job, signal);
				return { preview: plan.preview, enabled: plan.enabled, token: plan };
			},
			runSchedule: (token, signal) => this.runConfirmedSuperbrainAction("superbrain-scheduled-run", token as SuperbrainSchedulePlan, signal),
			openPreferenceReview: () => {
				const view = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_TALOS)[0]?.view;
				if (view instanceof TalosView) view.openPreferenceReview();
			},
			openSettings: () => {
				const view = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_TALOS)[0]?.view;
				if (view instanceof TalosView) view.openSettingsPage();
			},
			openPublishing: () => this.plugin.openPublishing(),
			hostStatus: () => ({ codex: "按需预检", claude: "按需预检", api: officialProviders().length ? "官方 API 已配置" : "未配置官方 API" }),
		};
	}

	/** Persist only the user-arranged canvas; Markdown and workflow results stay in the vault. */
	saveSuperbrainCanvasLayout(layout: TalosSettings["superbrainCanvasLayout"]): Promise<void> {
		this.plugin.talosSettings.superbrainCanvasLayout = normalizeSuperbrainCanvasLayout(layout);
		this.canvasSettingsSave = this.canvasSettingsSave.catch(() => {}).then(async () => {
			const loaded: unknown = await this.plugin.loadData();
			const stored = isRecord(loaded) ? loaded : {};
			const namespaced = isRecord(stored.talos) ? stored.talos : {};
			await this.plugin.saveData({
				...stored,
				talos: { ...namespaced, superbrainCanvasLayout: this.plugin.talosSettings.superbrainCanvasLayout },
			});
		});
		return this.canvasSettingsSave;
	}
}

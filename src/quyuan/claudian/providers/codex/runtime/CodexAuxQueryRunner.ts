import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import type {
  AuxQueryConfig,
  AuxQueryRunner,
} from '../../../core/auxiliary/AuxQueryRunner';
import type ClaudianPlugin from '../../../main';
import {
  assertTalosCodexPermissionProfile,
  TALOS_CODEX_PERMISSION_PROFILE_ID,
} from '../../../../codex-permission-profile';
import { toCodexRuntimeModelId } from '../modelSelection';
import { DEFAULT_CODEX_PRIMARY_MODEL } from '../types/models';
import { CodexAppServerProcess } from './CodexAppServerProcess';
import { resolveCodexAppServerLaunchSpec } from './codexAppServerSupport';
import type {
  AgentMessageDeltaNotification,
  ErrorNotification,
  InitializeResult,
  ThreadStartResult,
  TurnCompletedNotification,
  TurnStartResult,
} from './codexAppServerTypes';
import type { CodexLaunchSpec } from './codexLaunchTypes';
import { CodexRpcTransport } from './CodexRpcTransport';
import { createCodexRuntimeContext } from './CodexRuntimeContext';

/**
 * Runs ephemeral Codex app-server queries for auxiliary tasks
 * (title generation, instruction refinement, inline edit).
 * Manages its own process lifecycle, separate from the main chat runtime.
 * Supports multi-turn conversations within a single thread.
 */
export class CodexAuxQueryRunner implements AuxQueryRunner {
  private process: CodexAppServerProcess | null = null;
  private transport: CodexRpcTransport | null = null;
  private threadId: string | null = null;
  private launchSpec: CodexLaunchSpec | null = null;
  private scopedPlugin: ClaudianPlugin | null = null;

  constructor(private readonly plugin: ClaudianPlugin) {}

  async query(config: AuxQueryConfig, prompt: string): Promise<string> {
    await this.auditEgress(config, prompt);
    if (!this.process || !this.transport) {
      await this.startProcess();
    }

    if (!this.threadId) {
      const model = toCodexRuntimeModelId(config.model ?? this.resolveProviderModel());
      const result = await this.transport!.request<ThreadStartResult>('thread/start', {
        model,
        cwd: this.launchSpec?.targetCwd ?? process.cwd(),
        approvalPolicy: 'never',
        permissions: TALOS_CODEX_PERMISSION_PROFILE_ID,
        runtimeWorkspaceRoots: this.launchSpec?.targetCwd
          ? [this.launchSpec.targetCwd]
          : undefined,
        baseInstructions: config.systemPrompt,
        experimentalRawEvents: true,
        persistExtendedHistory: false,
      });
      assertTalosCodexPermissionProfile(result);
      this.threadId = result.thread.id;
    }

    let accumulatedText = '';
    let turnError: string | null = null;
    let resolveWait: (() => void) | null = null;

    const donePromise = new Promise<void>((resolve) => {
      resolveWait = resolve;
    });

    this.transport!.onNotification('item/agentMessage/delta', (params) => {
      const p = params as AgentMessageDeltaNotification;
      accumulatedText += p.delta;
      config.onTextChunk?.(accumulatedText);
    });

    this.transport!.onNotification('turn/completed', (params) => {
      const p = params as TurnCompletedNotification;
      if (p.turn.status === 'failed' && p.turn.error) {
        turnError = p.turn.error.message;
      }
      resolveWait?.();
    });

    this.transport!.onNotification('error', (params) => {
      const p = params as ErrorNotification;
      if (!p.willRetry) {
        turnError = p.error.message;
        resolveWait?.();
      }
    });

    // Resolve if process dies unexpectedly to avoid hanging forever
    const exitHandler = (): void => {
      if (!turnError) turnError = 'Codex app-server process exited unexpectedly';
      resolveWait?.();
    };
    this.process!.onExit(exitHandler);

    // Register abort handler before turn/start to avoid race condition
    let turnId: string | null = null;
    const abortHandler = (): void => {
      if (this.transport && this.threadId && turnId) {
        this.transport.request('turn/interrupt', {
          threadId: this.threadId,
          turnId,
        }).catch(() => {});
      }
      resolveWait?.();
    };

    config.abortController?.signal.addEventListener('abort', abortHandler, { once: true });

    // Check if already aborted before starting the turn
    if (config.abortController?.signal.aborted) {
      config.abortController.signal.removeEventListener('abort', abortHandler);
      this.process?.offExit(exitHandler);
      throw new Error('Cancelled');
    }

    const turnResult = await this.transport!.request<TurnStartResult>('turn/start', {
      threadId: this.threadId,
      input: [{ type: 'text', text: prompt }],
      model: config.model ? toCodexRuntimeModelId(config.model) : undefined,
      permissions: TALOS_CODEX_PERMISSION_PROFILE_ID,
      runtimeWorkspaceRoots: this.launchSpec?.targetCwd
        ? [this.launchSpec.targetCwd]
        : undefined,
    });
    turnId = turnResult.turn.id;

    try {
      await donePromise;
    } finally {
      config.abortController?.signal.removeEventListener('abort', abortHandler);
      this.process?.offExit(exitHandler);
    }

    if (config.abortController?.signal.aborted) {
      throw new Error('Cancelled');
    }

    if (turnError) {
      throw new Error(turnError);
    }

    return accumulatedText;
  }

  reset(): void {
    this.threadId = null;
    this.launchSpec = null;
    if (this.transport) {
      this.transport.dispose();
      this.transport = null;
    }
    if (this.process) {
      this.process.shutdown().catch(() => {});
      this.process = null;
    }
  }

  private resolveProviderModel(): string {
    const providerSettings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      'codex',
    );
    const model = providerSettings.model;
    return typeof model === 'string' ? toCodexRuntimeModelId(model) : DEFAULT_CODEX_PRIMARY_MODEL;
  }

  private async auditEgress(config: AuxQueryConfig, prompt: string): Promise<void> {
    const bridge = this.plugin as ClaudianPlugin & {
      auditQuyuanProviderEgress?: (input: {
        namespace: 'auxiliary';
        kind: typeof config.auditKind;
        providerId: string;
        prompt: string;
        sourcePaths?: string[];
        sourceKinds: Array<'prompt' | typeof config.auditKind>;
        sessionId?: string;
      }) => Promise<{ allowed: boolean; message?: string }>;
    };
    if (!bridge.auditQuyuanProviderEgress) {
      throw new Error('TALOS 外发审计桥缺失，已按失败关闭策略阻止辅助模型调用');
    }
    const result = await bridge.auditQuyuanProviderEgress({
      namespace: 'auxiliary',
      kind: config.auditKind,
      providerId: 'codex',
      prompt: `${config.systemPrompt}\n\n${prompt}`,
      sourcePaths: config.sourcePaths,
      sourceKinds: ['prompt', config.auditKind],
      sessionId: this.threadId ?? config.auditKind,
    });
    if (!result.allowed) {
      throw new Error(result.message ?? 'Provider 出库隐私审计未通过');
    }
  }

  private auxiliaryPlugin(): ClaudianPlugin {
    if (this.scopedPlugin) return this.scopedPlugin;
    const baseSettings = this.plugin.settings;
    const scopedSettings = {
      ...baseSettings,
      talosRuntimeChannel: 'auxiliary',
      permissionMode: 'normal',
      savedProviderPermissionMode: {
        ...baseSettings.savedProviderPermissionMode,
        codex: 'normal',
      },
    };
    this.scopedPlugin = new Proxy(this.plugin, {
      get(target, property, receiver) {
        if (property === 'settings') return scopedSettings;
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    return this.scopedPlugin;
  }

  private async startProcess(): Promise<void> {
    this.launchSpec = resolveCodexAppServerLaunchSpec(this.auxiliaryPlugin(), 'codex');
    this.process = new CodexAppServerProcess(this.launchSpec);
    this.process.start();

    this.transport = new CodexRpcTransport(this.process);
    this.transport.start();

    const initializeResult = await this.transport.request<InitializeResult>('initialize', {
      clientInfo: { name: 'claudian-aux', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    });

    createCodexRuntimeContext(this.launchSpec, initializeResult);
    this.transport.notify('initialized');
  }
}

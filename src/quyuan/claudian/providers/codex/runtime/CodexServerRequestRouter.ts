import type {
  ApprovalCallback,
  ApprovalDecisionOption,
  AskUserQuestionCallback,
} from '../../../core/runtime/types';
import type { ApprovalDecision } from '../../../core/types';
import { normalizeCodexToolName } from '../normalization/codexToolNormalization';
import {
  type EffectiveRuntimePolicy,
  evaluateRuntimeToolBoundary,
  resolveEffectiveRuntimePolicy,
} from '../../../../runtime-policy';
import type {
  CommandApprovalRequest,
  CommandExecutionApprovalDecision,
  CommandExecutionApprovalResponse,
  FileChangeApprovalDecision,
  FileChangeApprovalRequest,
  FileChangeApprovalResponse,
  PermissionsApprovalRequest,
  PermissionsApprovalResponse,
  RequestId,
  UserInputRequest,
  UserInputResponse,
} from './codexAppServerTypes';

export class CodexServerRequestRouter {
  private approvalCallback: ApprovalCallback | null = null;
  private runtimePolicy = resolveEffectiveRuntimePolicy({
    channel: 'chat',
    permissionMode: 'normal',
  });
  private askUserCallback: AskUserQuestionCallback | null = null;
  private pendingApprovalRequests = new Map<RequestId, string>();
  private fileChangeInputs = new Map<string, Record<string, unknown>>();
  private askUserAbortController: AbortController | null = null;
  private pendingAskUserRequestId: RequestId | null = null;
  private pendingAskUserThreadId: string | null = null;

  setApprovalCallback(callback: ApprovalCallback | null): void {
    this.approvalCallback = callback;
  }

  setRuntimePolicy(policy: EffectiveRuntimePolicy): void {
    this.runtimePolicy = policy;
    this.fileChangeInputs.clear();
  }

  rememberFileChangeInput(itemId: string, input: Record<string, unknown>): void {
    this.fileChangeInputs.set(itemId, input);
  }

  setAskUserCallback(callback: AskUserQuestionCallback | null): void {
    this.askUserCallback = callback;
  }

  async handleServerRequest(
    requestIdOrMethod: RequestId | string,
    methodOrParams: unknown,
    maybeParams?: unknown,
  ): Promise<unknown> {
    const hasExplicitRequestId = maybeParams !== undefined;
    const requestId = hasExplicitRequestId ? requestIdOrMethod : undefined;
    const method = (hasExplicitRequestId ? methodOrParams : requestIdOrMethod) as string;
    const params = (hasExplicitRequestId ? maybeParams : methodOrParams);

    switch (method) {
      case 'item/commandExecution/requestApproval':
        return this.handleCommandApproval(requestId, params as CommandApprovalRequest);

      case 'item/fileChange/requestApproval':
        return this.handleFileChangeApproval(requestId, params as FileChangeApprovalRequest);

      case 'item/permissions/requestApproval':
        return this.handlePermissionsApproval(requestId, params as PermissionsApprovalRequest);

      case 'item/tool/requestUserInput':
        return this.handleUserInputRequest(requestId, params as UserInputRequest);

      default:
        throw new Error(`Unsupported server request: ${method}`);
    }
  }

  hasPendingApprovalRequest(requestId: RequestId, threadId: string): boolean {
    return this.pendingApprovalRequests.get(requestId) === threadId;
  }

  private async handleCommandApproval(
    requestId: RequestId | undefined,
    params: CommandApprovalRequest,
  ): Promise<CommandExecutionApprovalResponse> {
    if (!this.approvalCallback) return { decision: 'decline' };

    if (evaluateRuntimeToolBoundary(this.runtimePolicy, 'Bash') === 'deny') {
      return { decision: 'decline' };
    }
    if (
      params.additionalPermissions
      || params.networkApprovalContext
      || (params.proposedNetworkPolicyAmendments?.length ?? 0) > 0
    ) {
      return { decision: 'decline' };
    }
    const command = params.command ?? '';
    const toolName = normalizeCodexToolName('command_execution');
    const input = {
      command,
      cwd: params.cwd ?? null,
      reason: params.reason ?? null,
      commandActions: params.commandActions ?? null,
      approvalId: params.approvalId ?? null,
      networkApprovalContext: params.networkApprovalContext ?? null,
      additionalPermissions: params.additionalPermissions ?? null,
      skillMetadata: params.skillMetadata ?? null,
      proposedExecpolicyAmendment: params.proposedExecpolicyAmendment ?? null,
      proposedNetworkPolicyAmendments: params.proposedNetworkPolicyAmendments ?? null,
    };
    const description = describeCommandApproval(params);

    if (requestId !== undefined) {
      this.pendingApprovalRequests.set(requestId, params.threadId);
    }

    try {
      const decision = await this.approvalCallback(toolName, input, description, {
        ...(params.reason ? { decisionReason: params.reason } : {}),
        ...(params.networkApprovalContext ? { networkApprovalContext: params.networkApprovalContext } : {}),
        ...(params.additionalPermissions ? { additionalPermissions: params.additionalPermissions } : {}),
        decisionOptions: buildCommandApprovalDecisionOptions(params),
      });
      return { decision: mapCommandApprovalDecision(decision) };
    } finally {
      if (requestId !== undefined) {
        this.pendingApprovalRequests.delete(requestId);
      }
    }
  }

  private async handleFileChangeApproval(
    requestId: RequestId | undefined,
    params: FileChangeApprovalRequest,
  ): Promise<FileChangeApprovalResponse> {
    if (!this.approvalCallback) return { decision: 'decline' };

    if (evaluateRuntimeToolBoundary(this.runtimePolicy, 'apply_patch') === 'deny') {
      return { decision: 'decline' };
    }
    const reason = params.reason ?? undefined;
    const toolName = normalizeCodexToolName('file_change');
    const observedInput = this.fileChangeInputs.get(params.itemId);
    const input: Record<string, unknown> = {
      ...observedInput,
      reason: reason ?? null,
    };
    const description = reason ? `File change: ${reason}` : 'File change';

    if (requestId !== undefined) {
      this.pendingApprovalRequests.set(requestId, params.threadId);
    }

    try {
      const decision = await this.approvalCallback(toolName, input, description, {});
      return { decision: mapFileChangeApprovalDecision(decision) };
    } finally {
      this.fileChangeInputs.delete(params.itemId);
      if (requestId !== undefined) {
        this.pendingApprovalRequests.delete(requestId);
      }
    }
  }

  private async handlePermissionsApproval(
    requestId: RequestId | undefined,
    params: PermissionsApprovalRequest,
  ): Promise<PermissionsApprovalResponse> {
    if (!this.approvalCallback) return { permissions: {}, scope: 'turn' };

    if (evaluateRuntimeToolBoundary(this.runtimePolicy, 'permissions') === 'deny') {
      return { permissions: {}, scope: 'turn' };
    }
    const requestedPermissions = params.permissions as Record<string, unknown> | undefined ?? {};
    const reason = params.reason ?? undefined;
    const toolName = 'permissions';
    const description = reason ? `Permission request: ${reason}` : 'Permission request';

    if (requestId !== undefined) {
      this.pendingApprovalRequests.set(requestId, params.threadId);
    }

    let decision: ApprovalDecision;
    try {
      decision = await this.approvalCallback(toolName, requestedPermissions, description, {});
    } finally {
      if (requestId !== undefined) {
        this.pendingApprovalRequests.delete(requestId);
      }
    }

    if (decision === 'allow') {
      return { permissions: requestedPermissions, scope: 'turn' };
    }
    if (decision === 'allow-always') {
      return { permissions: requestedPermissions, scope: 'session' };
    }

    return { permissions: {}, scope: 'turn' };
  }

  abortPendingAskUser(requestId?: RequestId, threadId?: string): boolean {
    if (!this.askUserAbortController) {
      return false;
    }

    if (requestId !== undefined && requestId !== this.pendingAskUserRequestId) {
      return false;
    }

    if (threadId !== undefined && threadId !== this.pendingAskUserThreadId) {
      return false;
    }

    this.askUserAbortController.abort();
    this.askUserAbortController = null;
    this.pendingAskUserRequestId = null;
    this.pendingAskUserThreadId = null;
    return true;
  }

  private async handleUserInputRequest(
    requestId: RequestId | undefined,
    params: UserInputRequest,
  ): Promise<UserInputResponse> {
    if (!this.askUserCallback) return { answers: {} };

    const questions = params.questions ?? [];
    const input: Record<string, unknown> = { questions };

    this.askUserAbortController = new AbortController();
    this.pendingAskUserRequestId = requestId ?? null;
    this.pendingAskUserThreadId = params.threadId;

    let userAnswers: Record<string, string | string[]> | null;
    try {
      userAnswers = await this.askUserCallback(input, this.askUserAbortController.signal);
    } finally {
      this.askUserAbortController = null;
      this.pendingAskUserRequestId = null;
      this.pendingAskUserThreadId = null;
    }

    if (!userAnswers) return { answers: {} };

    const answers: Record<string, { answers: string[] }> = {};
    for (const [key, value] of Object.entries(userAnswers)) {
      answers[key] = { answers: normalizeAnswers(value) };
    }

    return { answers };
  }
}

function describeCommandApproval(params: CommandApprovalRequest): string {
  const networkContext = params.networkApprovalContext;
  if (networkContext) {
    return `Allow ${networkContext.protocol} access to ${networkContext.host}`;
  }

  const command = params.command ?? '';
  return command ? `Execute: ${command}` : 'Execute command';
}

function buildCommandApprovalDecisionOptions(
  params: CommandApprovalRequest,
): ApprovalDecisionOption[] {
  const availableDecisions = params.availableDecisions ?? ['accept', 'acceptForSession', 'decline'];

  return availableDecisions
    .filter((decision) => (
      decision === 'accept'
      || decision === 'decline'
      || decision === 'cancel'
    ))
    .map((decision) => mapDecisionOption(decision, params));
}

function mapDecisionOption(
  decision: CommandExecutionApprovalDecision,
  params: CommandApprovalRequest,
): ApprovalDecisionOption {
  if (decision === 'accept') {
    return { label: 'Allow once', value: 'allow-once', decision: 'allow' };
  }
  if (decision === 'acceptForSession') {
    return { label: 'Always allow', value: 'allow-always', decision: 'allow-always' };
  }
  if (decision === 'decline') {
    return { label: 'Deny', value: 'deny', decision: 'deny' };
  }
  if (decision === 'cancel') {
    return { label: 'Cancel', value: 'cancel', decision: 'cancel' };
  }
  if ('acceptWithExecpolicyAmendment' in decision) {
    return {
      label: 'Allow similar commands',
      description: 'Approve and store an exec policy amendment.',
      value: encodeCommandApprovalDecision(decision),
    };
  }

  const networkPolicyAmendment = decision.applyNetworkPolicyAmendment.network_policy_amendment;
  const host = networkPolicyAmendment.host || params.networkApprovalContext?.host || 'host';
  const action = networkPolicyAmendment.action === 'deny' ? 'Deny' : 'Allow';
  return {
    label: `${action} ${host} for this session`,
    description: `Apply a ${networkPolicyAmendment.action} rule for ${host}.`,
    value: encodeCommandApprovalDecision(decision),
  };
}

function normalizeAnswers(value: string | string[]): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item : String(item)))
      .filter((item) => item.trim().length > 0);
  }

  return [value];
}

function mapCommandApprovalDecision(decision: ApprovalDecision): CommandExecutionApprovalDecision {
  switch (decision) {
    case 'allow':
      return 'accept';
    case 'allow-always':
      return 'accept';
    case 'deny':
      return 'decline';
    case 'cancel':
      return 'cancel';
    default:
      return 'decline';
  }
}

function mapFileChangeApprovalDecision(decision: ApprovalDecision): FileChangeApprovalDecision {
  switch (decision) {
    case 'allow':
      return 'accept';
    case 'allow-always':
      return 'accept';
    case 'deny':
      return 'decline';
    case 'cancel':
      return 'cancel';
    default:
      return 'decline';
  }
}

function encodeCommandApprovalDecision(decision: CommandExecutionApprovalDecision): string {
  return JSON.stringify(decision);
}

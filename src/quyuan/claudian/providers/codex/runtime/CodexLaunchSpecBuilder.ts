import {
  resolveEffectiveRuntimePolicy,
  runtimeChannelFromSettings,
} from '../../../../runtime-policy';
import {
  buildTalosCodexPermissionProfileArgs,
} from '../../../../codex-permission-profile';
import { getCodexProviderSettings } from '../settings';
import {
  inferWslDistroFromWindowsPath,
  resolveCodexExecutionTarget,
} from './CodexExecutionTargetResolver';
import type { CodexLaunchSpec } from './codexLaunchTypes';
import { createCodexPathMapper } from './CodexPathMapper';

export interface BuildCodexLaunchSpecOptions {
  settings: Record<string, unknown>;
  resolvedCliCommand: string | null;
  hostVaultPath: string | null;
  env: Record<string, string>;
  configDir: string;
  hostPlatform?: NodeJS.Platform;
  resolveDefaultWslDistro?: () => string | undefined;
}

export function buildCodexAppServerArgs(
  settings: Record<string, unknown>,
  configDir: string,
): string[] {
  const channel = runtimeChannelFromSettings(settings);
  const policy = resolveEffectiveRuntimePolicy({
    channel,
    permissionMode: settings.permissionMode,
    sandboxMode: channel === 'chat'
      ? getCodexProviderSettings(settings).safeMode
      : 'read-only',
  });
  const args = [
    'app-server',
    ...buildTalosCodexPermissionProfileArgs(policy, configDir),
  ];
  if (!policy.allowShell) {
    args.push('--disable', 'shell_tool', '--disable', 'unified_exec');
  }
  if (!policy.networkAccess) {
    args.push('-c', 'web_search="disabled"');
  }
  args.push('--listen', 'stdio://');
  return args;
}

export function buildCodexLaunchSpec(
  options: BuildCodexLaunchSpecOptions,
): CodexLaunchSpec {
  const target = resolveCodexExecutionTarget({
    settings: options.settings,
    hostPlatform: options.hostPlatform,
    hostVaultPath: options.hostVaultPath,
    resolveDefaultWslDistro: options.resolveDefaultWslDistro,
  });
  const pathMapper = createCodexPathMapper(target);
  const spawnCwd = options.hostVaultPath ?? process.cwd();

  const workspaceDistro = inferWslDistroFromWindowsPath(options.hostVaultPath);
  if (
    target.method === 'wsl'
    && target.distroName
    && workspaceDistro
    && target.distroName.toLowerCase() !== workspaceDistro.toLowerCase()
  ) {
    throw new Error(
      `WSL distro override "${target.distroName}" does not match workspace distro "${workspaceDistro}"`,
    );
  }

  if (target.method === 'wsl' && !target.distroName) {
    throw new Error(
      'Unable to determine the WSL distro. Set WSL distro override or configure a default WSL distro.',
    );
  }

  const targetCwd = pathMapper.toTargetPath(spawnCwd);

  if (!targetCwd) {
    throw new Error('WSL mode only supports Windows drive paths and \\\\wsl$ workspace paths');
  }

  const resolvedCliCommand = options.resolvedCliCommand?.trim() || 'codex';
  const appServerArgs = buildCodexAppServerArgs(
    options.settings,
    options.configDir,
  );
  if (target.method === 'wsl') {
    const args = [
      ...(target.distroName ? ['--distribution', target.distroName] : []),
      '--cd',
      targetCwd,
      resolvedCliCommand,
      ...appServerArgs,
    ];

    return {
      target,
      command: 'wsl.exe',
      args,
      spawnCwd,
      targetCwd,
      env: options.env,
      pathMapper,
    };
  }

  return {
    target,
    command: resolvedCliCommand,
    args: [...appServerArgs],
    spawnCwd,
    targetCwd,
    env: options.env,
    pathMapper,
  };
}

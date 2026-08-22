import { ProviderRegistry } from '../core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '../core/providers/ProviderWorkspaceRegistry';
import { codexWorkspaceRegistration } from './codex/app/CodexWorkspaceServices';
import { codexProviderRegistration } from './codex/registration';

let builtInProvidersRegistered = false;

// D-TLP-011/D-TLP-013：替换而非并存——只注册 Codex harness；
// claude/opencode/pi 旧链路已删除，直连通道在 TALOS 外层 facade（非本注册表）。
export function registerBuiltInProviders(): void {
  if (builtInProvidersRegistered) {
    return;
  }

  ProviderRegistry.register('codex', codexProviderRegistration);
  ProviderWorkspaceRegistry.register('codex', codexWorkspaceRegistration);
  builtInProvidersRegistered = true;
}

registerBuiltInProviders();

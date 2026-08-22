import type { ProviderConfigMap } from '../core/types/settings';
import { DEFAULT_CODEX_PROVIDER_SETTINGS } from './codex/settings';

// D-TLP-011/D-TLP-013：Codex harness 是唯一大模型运行时，默认配置只保留 codex，
// 且作为唯一 harness 默认启用（否则 resolveSettingsProviderId 无可用 provider）。
export function getBuiltInProviderDefaultConfigs(): ProviderConfigMap {
  return {
    codex: { ...DEFAULT_CODEX_PROVIDER_SETTINGS, enabled: true },
  };
}

export type AuxiliaryEgressKind =
  | 'title-generation'
  | 'instruction-refine'
  | 'inline-edit';

export interface AuxQueryConfig {
  auditKind: AuxiliaryEgressKind;
  sourcePaths?: string[];
  systemPrompt: string;
  model?: string;
  abortController?: AbortController;
  onTextChunk?: (accumulatedText: string) => void;
}

export interface AuxQueryRunner {
  query(config: AuxQueryConfig, prompt: string): Promise<string>;
  reset(): void;
}

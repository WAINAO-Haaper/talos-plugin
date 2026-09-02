import type { OrbState } from "./types";

export interface StateDescription {
  label: string;
  announcement: string;
}

export const STATE_DESCRIPTIONS: Readonly<Record<OrbState, StateDescription>> = {
  idle: { label: "AI is ready", announcement: "TALOS is ready." },
  listening: { label: "AI is listening", announcement: "TALOS is listening." },
  receiving: { label: "AI is receiving input", announcement: "TALOS is receiving input." },
  working: { label: "AI is working", announcement: "TALOS is working." },
  thinking: { label: "AI is thinking", announcement: "TALOS is thinking." },
  searching: { label: "AI is searching", announcement: "TALOS is searching." },
  responding: { label: "AI is responding", announcement: "TALOS is responding." },
  success: { label: "Task succeeded", announcement: "TALOS completed the task." },
  warning: { label: "Attention is needed", announcement: "TALOS needs your attention." },
  error: { label: "A problem occurred", announcement: "TALOS encountered a problem." },
  restricted: { label: "Action is restricted", announcement: "This action is restricted." },
  stopped: { label: "AI is stopped", announcement: "TALOS is stopped." }
};

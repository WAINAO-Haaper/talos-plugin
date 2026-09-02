import {
  copyVector,
  interpolateVector,
  STATE_VECTORS,
  type VisualVector
} from "../semantics/state-vectors";
import type { OrbState } from "../semantics/types";

function smootherStep(amount: number): number {
  const t = Math.max(0, Math.min(1, amount));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export class TransitionEngine {
  #from: VisualVector;
  #to: VisualVector;
  #startedAt = 0;
  #duration = 0;
  #state: OrbState;
  #settled = true;

  constructor(initial: OrbState) {
    this.#state = initial;
    this.#from = copyVector(STATE_VECTORS[initial]);
    this.#to = copyVector(STATE_VECTORS[initial]);
  }

  get state(): OrbState {
    return this.#state;
  }

  get settled(): boolean {
    return this.#settled;
  }

  retarget(state: OrbState, now: number, duration: number): void {
    this.#from = this.sample(now);
    this.#to = copyVector(STATE_VECTORS[state]);
    this.#state = state;
    this.#startedAt = now;
    this.#duration = Math.max(0, duration);
    this.#settled = this.#duration === 0;
    if (this.#settled) this.#from = copyVector(this.#to);
  }

  sample(now: number): VisualVector {
    if (this.#settled) return copyVector(this.#to);
    const progress =
      this.#duration === 0 ? 1 : (now - this.#startedAt) / this.#duration;
    if (progress >= 1) {
      this.#settled = true;
      this.#from = copyVector(this.#to);
      return copyVector(this.#to);
    }
    return interpolateVector(this.#from, this.#to, smootherStep(progress));
  }
}

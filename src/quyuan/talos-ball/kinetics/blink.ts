import { MOTION_TIMINGS } from "./timings";

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

export class BlinkTimeline {
  readonly #random: () => number;
  #nextStart = 0;

  constructor(seed = 0x54414c4f) {
    this.#random = mulberry32(seed);
    this.reset(0);
  }

  reset(now: number): void {
    const span =
      MOTION_TIMINGS.blinkIntervalMax - MOTION_TIMINGS.blinkIntervalMin;
    this.#nextStart =
      now + MOTION_TIMINGS.blinkIntervalMin + this.#random() * span;
  }

  sample(now: number): number {
    if (now < this.#nextStart) return 0;
    const elapsed = now - this.#nextStart;
    const closeEnd = MOTION_TIMINGS.blinkClose;
    const holdEnd = closeEnd + MOTION_TIMINGS.blinkHold;
    const openEnd = holdEnd + MOTION_TIMINGS.blinkOpen;

    if (elapsed <= closeEnd) return elapsed / closeEnd;
    if (elapsed <= holdEnd) return 1;
    if (elapsed <= openEnd) return 1 - (elapsed - holdEnd) / MOTION_TIMINGS.blinkOpen;
    this.reset(now);
    return 0;
  }
}

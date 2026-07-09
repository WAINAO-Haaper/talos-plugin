import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '../../../utils/animationFrame';

/**
 * Coalesces rapid stream increments into a single animation-frame render pass.
 *
 * Text and thinking blocks both receive many small content deltas per second.
 * Rendering each delta synchronously would thrash the DOM. This scheduler
 * batches them: the first delta schedules a render frame; subsequent deltas
 * just accumulate. The render pass reads the latest accumulated content,
 * renders it, and — if more content arrived during the render — schedules
 * another pass. Callers can await `schedule()` to know when all pending
 * content has been flushed (used by finalize methods).
 *
 * Extracted from StreamController where Text and Thinking maintained two
 * identical copies of this state machine.
 */
export class StreamRenderScheduler {
  private frame: ScheduledAnimationFrame | null = null;
  private promise: Promise<void> | null = null;
  private resolve: (() => void) | null = null;
  private isRunning = false;

  constructor(
    private readonly options: {
      /** Returns the element to render into, or null if the block was cleared. */
      getTargetEl: () => HTMLElement | null;
      /** Returns the accumulated content to render. */
      getContent: () => string;
      /** Renders the content into the target element. */
      doRender: (el: HTMLElement, content: string) => Promise<void>;
      /** Called after a successful render (e.g. to scroll to bottom). */
      afterRender?: () => void;
      /** Returns the window that owns the target element (for RAF scheduling). */
      getWindow: () => Window | null;
    },
  ) {}

  /**
   * Schedules a coalesced render of accumulated content.
   * Returns a promise that resolves once all content queued so far is rendered.
   */
  schedule(): Promise<void> {
    if (!this.promise) {
      this.promise = new Promise((resolve) => {
        this.resolve = resolve;
      });
    }

    if (this.frame === null && !this.isRunning) {
      this.frame = scheduleAnimationFrame(() => {
        this.frame = null;
        void this.runRender();
      }, this.options.getWindow());
    }

    return this.promise;
  }

  /** Renders all pending content now (cancelling any scheduled frame) and awaits completion. */
  async flush(): Promise<void> {
    const pending = this.promise;
    if (!pending) return;

    if (this.frame !== null) {
      cancelScheduledAnimationFrame(this.frame);
      this.frame = null;
      void this.runRender();
    }

    await pending;
  }

  /** Cancels any pending render and resolves the waiter (if any) immediately. */
  cancel(): void {
    if (this.frame !== null) {
      cancelScheduledAnimationFrame(this.frame);
      this.frame = null;
    }
    this.settle();
  }

  private async runRender(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    const el = this.options.getTargetEl();
    const content = this.options.getContent();

    try {
      if (el) {
        await this.options.doRender(el, content);
        this.options.afterRender?.();
      }
    } catch {
      // MessageRenderer owns user-visible render fallback; keep stream state moving.
    } finally {
      this.isRunning = false;
    }

    // If content changed during our render, schedule another pass.
    if (this.options.getTargetEl() === el && this.options.getContent() !== content) {
      this.frame = scheduleAnimationFrame(() => {
        this.frame = null;
        void this.runRender();
      }, this.options.getWindow());
      return;
    }

    this.settle();
  }

  private settle(): void {
    const resolve = this.resolve;
    this.promise = null;
    this.resolve = null;
    resolve?.();
  }
}

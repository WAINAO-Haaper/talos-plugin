import { cancelScheduledAnimationFrame, scheduleAnimationFrame, type ScheduledAnimationFrame } from "./animation-frame";

/** Coalesces rapid streaming increments into one animation-frame render pass. */
export class StreamRenderScheduler {
	private frame: ScheduledAnimationFrame | null = null;
	private promise: Promise<void> | null = null;
	private resolve: (() => void) | null = null;
	private running = false;

	constructor(private readonly options: {
		getTargetEl(): HTMLElement | null;
		getContent(): string;
		doRender(el: HTMLElement, content: string): Promise<void>;
		afterRender?(): void;
		getWindow(): Window | null;
	}) {}

	schedule(): Promise<void> {
		if (!this.promise) this.promise = new Promise((resolve) => { this.resolve = resolve; });
		if (!this.frame && !this.running) {
			this.frame = scheduleAnimationFrame(() => { this.frame = null; void this.run(); }, this.options.getWindow());
		}
		return this.promise;
	}

	async flush(): Promise<void> {
		const pending = this.promise;
		if (!pending) return;
		if (this.frame) {
			cancelScheduledAnimationFrame(this.frame);
			this.frame = null;
			void this.run();
		}
		await pending;
	}

	cancel(): void {
		if (this.frame) cancelScheduledAnimationFrame(this.frame);
		this.frame = null;
		this.settle();
	}

	private async run(): Promise<void> {
		if (this.running) return;
		this.running = true;
		const target = this.options.getTargetEl();
		const content = this.options.getContent();
		try {
			if (target) { await this.options.doRender(target, content); this.options.afterRender?.(); }
		} catch {
			// The renderer owns its visible fallback; never strand stream waiters.
		} finally { this.running = false; }
		if (this.options.getTargetEl() === target && this.options.getContent() !== content) {
			this.frame = scheduleAnimationFrame(() => { this.frame = null; void this.run(); }, this.options.getWindow());
			return;
		}
		this.settle();
	}

	private settle(): void {
		const finish = this.resolve;
		this.promise = null;
		this.resolve = null;
		finish?.();
	}
}

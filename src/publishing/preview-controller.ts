export type PreviewPhase = "empty" | "pending" | "updating" | "ready" | "error";

export interface PreviewState<TResult> {
	phase: PreviewPhase;
	revision: number;
	/** The last successful result may remain visible while its sending eligibility is invalid. */
	result?: TResult;
	error?: string;
}

export interface PreviewTimerPort {
	setTimeout(callback: () => void, delayMs: number): unknown;
	clearTimeout(handle: unknown): void;
}

export interface PreviewControllerOptions<TInput, TResult> {
	prepare(input: TInput, revision: number): Promise<TResult>;
	onState(state: PreviewState<TResult>): void;
	debounceMs?: number;
	timers?: PreviewTimerPort;
}

interface Request<TInput> { input: TInput; revision: number; ready: boolean; }
type Outcome<TResult> = { ok: true; result: TResult } | { ok: false; error: unknown };

const defaultTimers: PreviewTimerPort = {
	setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
	clearTimeout: (handle) => window.clearTimeout(handle as number),
};

/** Local preview scheduling only. The caller supplies immutable input snapshots and handles approvals. */
export class PreviewController<TInput, TResult> {
	private revision = 0;
	private state: PreviewState<TResult> = { phase: "empty", revision: 0 };
	private lastGood?: TResult;
	private hasLastGood = false;
	private pending?: Request<TInput>;
	private running?: Request<TInput>;
	private timer?: { handle: unknown };
	private disposed = false;
	private readonly timers: PreviewTimerPort;
	private readonly debounceMs: number;

	constructor(private readonly options: PreviewControllerOptions<TInput, TResult>) {
		this.timers = options.timers ?? defaultTimers;
		this.debounceMs = options.debounceMs ?? 350;
		if (!Number.isFinite(this.debounceMs) || this.debounceMs < 0) throw new Error("Preview debounce must be a non-negative finite duration");
	}

	/** Invalidates ready eligibility synchronously, before the debounce or preparation begins. */
	update(input: TInput): number {
		if (this.disposed) return this.revision;
		this.clearTimer();
		const request: Request<TInput> = { input, revision: ++this.revision, ready: false };
		this.pending = request;
		this.timer = { handle: this.timers.setTimeout(() => {
			if (this.disposed || this.pending !== request || request.revision !== this.revision) return;
			this.timer = undefined;
			request.ready = true;
			this.pump();
		}, this.debounceMs) };
		this.emit(this.hasLastGood ? "updating" : "pending");
		return request.revision;
	}

	/** Starts the newest pending revision now, or immediately after the sole running preparation. */
	flush(): void {
		if (this.disposed || !this.pending) return;
		this.clearTimer();
		this.pending.ready = true;
		this.pump();
	}

	/** Explicit refresh always creates a new revision, even if the previous result was ready. */
	refresh(input: TInput): number {
		const revision = this.update(input);
		this.flush();
		return revision;
	}

	clear(): number {
		if (this.disposed) return this.revision;
		this.clearTimer();
		this.pending = undefined;
		this.lastGood = undefined;
		this.hasLastGood = false;
		this.revision++;
		this.emit("empty");
		return this.revision;
	}

	getState(): PreviewState<TResult> { return { ...this.state }; }

	isCurrentReady(revision: number): boolean {
		return !this.disposed && revision === this.revision && this.state.revision === revision && this.state.phase === "ready";
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.clearTimer();
		this.pending = undefined;
		this.lastGood = undefined;
		this.hasLastGood = false;
		this.state = { phase: "empty", revision: ++this.revision };
	}

	private clearTimer(): void {
		if (this.timer) this.timers.clearTimeout(this.timer.handle);
		this.timer = undefined;
	}

	private pump(): void {
		if (this.disposed || this.running || !this.pending?.ready) return;
		const request = this.pending;
		this.pending = undefined;
		this.running = request;
		// The microtask also routes a synchronous prepare exception through the same revision gate.
		void Promise.resolve().then(() => {
			if (this.disposed || request.revision !== this.revision) return undefined;
			return this.options.prepare(request.input, request.revision);
		}).then(
			(result) => this.complete(request, { ok: true, result: result as TResult }),
			(error: unknown) => this.complete(request, { ok: false, error }),
		);
	}

	private complete(request: Request<TInput>, outcome: Outcome<TResult>): void {
		if (this.running !== request) return;
		this.running = undefined;
		if (this.disposed) return;
		if (request.revision === this.revision) {
			if (outcome.ok) {
				this.lastGood = outcome.result;
				this.hasLastGood = true;
				this.emit("ready");
			} else this.emit("error", outcome.error instanceof Error ? outcome.error.message : String(outcome.error));
		}
		this.pump();
	}

	private emit(phase: PreviewPhase, error?: string): void {
		if (this.disposed) return;
		this.state = { phase, revision: this.revision, ...(this.hasLastGood ? { result: this.lastGood } : {}), ...(error !== undefined ? { error } : {}) };
		this.options.onState(this.getState());
	}
}

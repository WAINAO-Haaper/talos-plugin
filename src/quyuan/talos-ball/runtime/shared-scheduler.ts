export type FrameSubscriber = (timestamp: number) => void;

interface FrameBucket {
	readonly subscribers: Set<FrameSubscriber>;
	requestId: number | null;
}

export class SharedFrameScheduler {
	readonly #buckets = new Map<Window, FrameBucket>();

	get subscriberCount(): number {
		let count = 0;
		for (const bucket of this.#buckets.values()) {
			count += bucket.subscribers.size;
		}
		return count;
	}

	subscribe(
		subscriber: FrameSubscriber,
		activeWindow: Window
	): () => void {
		const bucket = this.#buckets.get(activeWindow) ?? {
			subscribers: new Set<FrameSubscriber>(),
			requestId: null,
		};
		this.#buckets.set(activeWindow, bucket);
		bucket.subscribers.add(subscriber);
		this.#schedule(activeWindow, bucket);
		return () => {
			bucket.subscribers.delete(subscriber);
			if (bucket.subscribers.size === 0) {
				this.#cancel(activeWindow, bucket);
				this.#buckets.delete(activeWindow);
			}
		};
	}

	#schedule(activeWindow: Window, bucket: FrameBucket): void {
		const window = activeWindow;

		if (bucket.requestId !== null || bucket.subscribers.size === 0) return;
		bucket.requestId = window.requestAnimationFrame((timestamp) => {
			bucket.requestId = null;
			const snapshot = Array.from(bucket.subscribers);
			for (const subscriber of snapshot) subscriber(timestamp);
			this.#schedule(activeWindow, bucket);
		});
	}

	#cancel(activeWindow: Window, bucket: FrameBucket): void {
		const window = activeWindow;

		if (bucket.requestId !== null) {
			window.cancelAnimationFrame(bucket.requestId);
		}
		bucket.requestId = null;
	}
}

export const sharedFrameScheduler = new SharedFrameScheduler();

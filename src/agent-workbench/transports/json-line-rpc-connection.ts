import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { clearTimeout as cancelTimeout, setTimeout as scheduleTimeout } from "node:timers";
import type { SandboxLaunchSpec } from "../security/process-sandbox";
import type { ProtocolFrame } from "../adapters/shared/protocol-frame";

interface PendingRequest {
	timer: ReturnType<typeof scheduleTimeout>;
	resolve(value: unknown): void;
	reject(error: Error): void;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

interface FrameWaiter {
	resolve(result: IteratorResult<ProtocolFrame>): void;
	reject(error: Error): void;
}

class FrameSubscription implements AsyncIterable<ProtocolFrame> {
	private queue: ProtocolFrame[] = [];
	private waiters: FrameWaiter[] = [];
	private ended = false;
	private endedError: Error | null = null;
	constructor(private readonly onDispose: () => void) {}
	push(frame: ProtocolFrame): void {
		if (this.ended) return;
		const waiter = this.waiters.shift();
		if (waiter) waiter.resolve({ value: frame, done: false });
		else this.queue.push(frame);
	}
	end(error?: Error): void {
		if (this.ended) return;
		this.ended = true;
		this.endedError = error ?? null;
		this.queue = [];
		this.onDispose();
		for (const waiter of this.waiters.splice(0)) {
			if (error) waiter.reject(error);
			else waiter.resolve({ value: undefined, done: true });
		}
	}
	[Symbol.asyncIterator](): AsyncIterator<ProtocolFrame> {
		return {
			next: async () => {
				const frame = this.queue.shift();
				if (frame) return { value: frame, done: false };
				if (this.endedError) throw this.endedError;
				if (this.ended) return { value: undefined, done: true };
				return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
			},
			return: async () => {
				this.end();
				return { value: undefined, done: true };
			},
		};
	}
}

export interface JsonRpcConnection {
	request<T>(method: string, params: Record<string, unknown>): Promise<T>;
	notify(method: string, params?: Record<string, unknown>): Promise<void>;
	respond(id: string | number, result: unknown): Promise<void>;
	subscribe(): AsyncIterable<ProtocolFrame>;
	close(): Promise<void>;
}

export class JsonLineRpcConnection implements JsonRpcConnection {
	private nextId = 0;
	private buffer = "";
	private closed = false;
	private closePromise: Promise<void> | null = null;
	private readonly pending = new Map<number, PendingRequest>();
	private readonly subscribers = new Set<FrameSubscription>();

	constructor(private readonly child: ChildProcessWithoutNullStreams, private readonly requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
		if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1) throw new Error("RPC request timeout 无效");
		child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => this.accept(chunk));
		child.stderr.on("data", () => { /* stderr is intentionally not persisted */ });
		child.once("error", (error) => this.fail(error));
		child.once("close", (code) => this.fail(new Error(`RPC 进程退出：${code ?? "unknown"}`)));
	}

	request<T>(method: string, params: Record<string, unknown>): Promise<T> {
		if (this.closed) return Promise.reject(new Error("RPC transport 已关闭"));
		const id = ++this.nextId;
		return new Promise<T>((resolve, reject) => {
			const timer = scheduleTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`RPC 请求超时：${method}`));
			}, this.requestTimeoutMs);
			this.pending.set(id, { timer, resolve: (value) => resolve(value as T), reject });
			this.write({ jsonrpc: "2.0", id, method, params }).catch((error: unknown) => { const pending = this.pending.get(id); if (pending) cancelTimeout(pending.timer); this.pending.delete(id); reject(error instanceof Error ? error : new Error("RPC 请求写入失败")); });
		});
	}

	async notify(method: string, params: Record<string, unknown> = {}): Promise<void> { await this.write({ jsonrpc: "2.0", method, params }); }

	async respond(id: string | number, result: unknown): Promise<void> { await this.write({ jsonrpc: "2.0", id, result }); }

	subscribe(): AsyncIterable<ProtocolFrame> {
		let subscription!: FrameSubscription;
		subscription = new FrameSubscription(() => this.subscribers.delete(subscription));
		this.subscribers.add(subscription);
		return subscription;
	}

	private async write(value: unknown): Promise<void> {
		if (this.closed) throw new Error("RPC transport 已关闭");
		await new Promise<void>((resolve, reject) => this.child.stdin.write(`${JSON.stringify(value)}\n`, (error) => error ? reject(error instanceof Error ? error : new Error("RPC stdin 写入失败")) : resolve()));
	}

	private accept(chunk: string): void {
		this.buffer += chunk;
		for (;;) {
			const newline = this.buffer.indexOf("\n"); if (newline < 0) break;
			const line = this.buffer.slice(0, newline).trim(); this.buffer = this.buffer.slice(newline + 1);
			if (!line) continue;
			let value: unknown;
			try { value = JSON.parse(line); } catch { this.fail(new Error("RPC 收到损坏 JSONL 帧")); return; }
			if (!value || typeof value !== "object") { this.fail(new Error("RPC 帧 schema 无效")); return; }
			const record = value as Record<string, unknown>;
			if (typeof record.id === "number" && !record.method) {
				const pending = this.pending.get(record.id); if (!pending) continue; this.pending.delete(record.id);
				cancelTimeout(pending.timer); if (record.error) pending.reject(new Error(`RPC error: ${JSON.stringify(record.error)}`)); else pending.resolve(record.result);
				continue;
			}
			if (typeof record.method !== "string" || !record.params || typeof record.params !== "object") { this.fail(new Error("RPC notification schema 无效")); return; }
			const frame: ProtocolFrame = { method: record.method, params: record.params as Record<string, unknown> };
			if (typeof record.id === "number" || typeof record.id === "string") frame.id = record.id;
			for (const subscriber of this.subscribers) subscriber.push(frame);
		}
	}

	private fail(error: Error): void {
		if (this.closed) return; this.closed = true;
		for (const pending of this.pending.values()) { cancelTimeout(pending.timer); pending.reject(error); } this.pending.clear();
		for (const subscriber of this.subscribers) subscriber.end(error); this.subscribers.clear();
	}

	async close(): Promise<void> {
		this.closePromise ??= this.terminate();
		return this.closePromise;
	}

	private async terminate(): Promise<void> {
		this.closed = true;
		this.child.stdin.end();
		if (!this.child.killed) this.child.kill("SIGTERM");
		await new Promise<void>((resolve) => { if (this.child.exitCode !== null) resolve(); else { const timer = scheduleTimeout(() => { if (!this.child.killed) this.child.kill("SIGKILL"); resolve(); }, 2_000); this.child.once("close", () => { cancelTimeout(timer); resolve(); }); } });
		for (const pending of this.pending.values()) { cancelTimeout(pending.timer); pending.reject(new Error("RPC transport 已关闭")); } this.pending.clear();
		for (const subscriber of this.subscribers) subscriber.end(); this.subscribers.clear();
	}
}

export function spawnJsonLineRpc(spec: SandboxLaunchSpec, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): JsonLineRpcConnection {
	const child = spawn(spec.executable, spec.args, {
		cwd: spec.cwd, env: spec.environment ?? { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TMPDIR: process.env.TMPDIR ?? "", LANG: process.env.LANG ?? "" },
		shell: false, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
	});
	return new JsonLineRpcConnection(child, requestTimeoutMs);
}

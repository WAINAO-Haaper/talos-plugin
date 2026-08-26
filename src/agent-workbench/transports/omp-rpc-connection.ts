import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { clearTimeout as cancelTimeout, setTimeout as scheduleTimeout } from "node:timers";
import type { SandboxLaunchSpec } from "../security/process-sandbox";

export type OmpRpcFrame = Record<string, unknown> & { type: string; id?: string };

interface PendingRequest {
	command: string;
	timer: ReturnType<typeof scheduleTimeout>;
	resolve(value: unknown): void;
	reject(error: Error): void;
}

interface PendingChunks { chunkId: string; count: number; byteLength: number; nextIndex: number; chunks: Buffer[]; receivedBytes: number; }
const MAX_REASSEMBLED_BYTES = 64 * 1024 * 1024;
const CHUNK_PAYLOAD_BYTES = 256 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

interface FrameWaiter {
	resolve(result: IteratorResult<OmpRpcFrame>): void;
	reject(error: Error): void;
}

class FrameSubscription implements AsyncIterable<OmpRpcFrame> {
	private queue: OmpRpcFrame[] = [];
	private waiters: FrameWaiter[] = [];
	private ended = false;
	private endedError: Error | null = null;
	push(frame: OmpRpcFrame): void { const waiter = this.waiters.shift(); if (waiter) waiter.resolve({ value: frame, done: false }); else this.queue.push(frame); }
	end(error?: Error): void {
		this.ended = true;
		this.endedError = error ?? null;
		for (const waiter of this.waiters.splice(0)) {
			if (error) waiter.reject(error);
			else waiter.resolve({ value: undefined, done: true });
		}
	}
	[Symbol.asyncIterator](): AsyncIterator<OmpRpcFrame> {
		return { next: async () => {
			const frame = this.queue.shift(); if (frame) return { value: frame, done: false };
			if (this.endedError) throw this.endedError;
			if (this.ended) return { value: undefined, done: true };
			return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
		} };
	}
}

export interface OmpRpcConnection {
	ready(): Promise<void>;
	request<T>(command: string, params?: Record<string, unknown>): Promise<T>;
	respond(id: string, response: Record<string, unknown>): Promise<void>;
	subscribe(): AsyncIterable<OmpRpcFrame>;
	close(): Promise<void>;
}

export class OmpJsonLineConnection implements OmpRpcConnection {
	private nextId = 0;
	private buffer = "";
	private closed = false;
	private closePromise: Promise<void> | null = null;
	private readonly pending = new Map<string, PendingRequest>();
	private readonly subscribers = new Set<FrameSubscription>();
	private pendingChunks: PendingChunks | null = null;
	private readonly readyPromise: Promise<void>;
	private resolveReady: (() => void) | null = null;
	private rejectReady: ((error: Error) => void) | null = null;
	private readyTimer: ReturnType<typeof scheduleTimeout> | null = null;

	constructor(private readonly child: ChildProcessWithoutNullStreams, private readonly requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
		if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1) throw new Error("OhMyPi RPC request timeout 无效");
		this.readyPromise = new Promise<void>((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
		this.readyTimer = scheduleTimeout(() => this.fail(new Error("OhMyPi RPC ready 超时")), requestTimeoutMs);
		child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => this.accept(chunk));
		child.stderr.on("data", () => { /* stderr is intentionally not persisted */ });
		child.once("error", (error) => this.fail(error));
		child.once("close", (code) => this.fail(new Error(`OhMyPi RPC 进程退出：${code ?? "unknown"}`)));
	}

	ready(): Promise<void> { return this.readyPromise; }

	request<T>(command: string, params: Record<string, unknown> = {}): Promise<T> {
		if (this.closed) return Promise.reject(new Error("OhMyPi RPC transport 已关闭"));
		const id = `talos-${++this.nextId}`;
		return new Promise<T>((resolve, reject) => {
			const timer = scheduleTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`OhMyPi RPC 请求超时：${command}`));
			}, this.requestTimeoutMs);
			this.pending.set(id, { command, timer, resolve: (value) => resolve(value as T), reject });
			this.write({ id, type: command, ...params }).catch((error: unknown) => {
				const pending = this.pending.get(id);
				if (pending) cancelTimeout(pending.timer);
				this.pending.delete(id);
				reject(error instanceof Error ? error : new Error("OhMyPi RPC 请求写入失败"));
			});
		});
	}

	async respond(id: string, response: Record<string, unknown>): Promise<void> {
		await this.write({ type: "extension_ui_response", id, ...response });
	}

	subscribe(): AsyncIterable<OmpRpcFrame> { const subscription = new FrameSubscription(); this.subscribers.add(subscription); return subscription; }

	private async write(value: OmpRpcFrame): Promise<void> {
		if (this.closed) throw new Error("OhMyPi RPC transport 已关闭");
		await new Promise<void>((resolve, reject) => this.child.stdin.write(`${JSON.stringify(value)}\n`, (error) => error ? reject(error instanceof Error ? error : new Error("OhMyPi RPC stdin 写入失败")) : resolve()));
	}

	private accept(chunk: string): void {
		this.buffer += chunk;
		for (;;) {
			const newline = this.buffer.indexOf("\n"); if (newline < 0) break;
			const line = this.buffer.slice(0, newline).trim(); this.buffer = this.buffer.slice(newline + 1);
			if (!line) continue;
			let value: unknown;
			try { value = JSON.parse(line); } catch { this.fail(new Error("OhMyPi RPC 收到损坏 JSONL 帧")); return; }
			let frame: OmpRpcFrame | null;
			try { frame = this.decode(value); } catch (error) { this.fail(error instanceof Error ? error : new Error("OhMyPi RPC chunk 解码失败")); return; }
			if (!frame) continue;
			if (typeof frame.type !== "string") { this.fail(new Error("OhMyPi RPC 帧缺少 type")); return; }
			if (frame.type === "ready") {
				const versions = Array.isArray(frame.supportedProtocolVersions) ? frame.supportedProtocolVersions : [];
				if (frame.protocolVersion !== 1 || !versions.includes(1)) { this.fail(new Error("OhMyPi RPC 协议版本不兼容")); return; }
				if (this.readyTimer) cancelTimeout(this.readyTimer); this.readyTimer = null; this.resolveReady?.(); this.resolveReady = null; this.rejectReady = null; continue;
			}
			if (frame.type === "response" && typeof frame.id === "string") {
				const pending = this.pending.get(frame.id); if (!pending) continue; this.pending.delete(frame.id); cancelTimeout(pending.timer);
				if (frame.command !== pending.command) { pending.reject(new Error("OhMyPi RPC 响应命令不匹配")); continue; }
				if (frame.success === false) { pending.reject(new Error(typeof frame.error === "string" ? frame.error : "OhMyPi RPC 请求失败")); continue; }
				pending.resolve(frame.data ?? {}); continue;
			}
			for (const subscriber of this.subscribers) subscriber.push(frame);
		}
	}

	private decode(value: unknown): OmpRpcFrame | null {
		if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("OhMyPi RPC 帧 schema 无效");
		const frame = value as OmpRpcFrame;
		if (frame.type !== "rpc_chunk") {
			if (this.pendingChunks) throw new Error("OhMyPi RPC chunk 序列被中断");
			return frame;
		}
		const { chunkId, index, count, byteLength, data } = frame;
		if (typeof chunkId !== "string" || !Number.isSafeInteger(index) || !Number.isSafeInteger(count) || !Number.isSafeInteger(byteLength) || typeof data !== "string") throw new Error("OhMyPi RPC chunk metadata 无效");
		const chunkIndex = index as number; const chunkCount = count as number; const totalBytes = byteLength as number;
		if (chunkIndex < 0 || chunkCount < 2 || chunkIndex >= chunkCount || totalBytes < 1 || totalBytes > MAX_REASSEMBLED_BYTES || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw new Error("OhMyPi RPC chunk 边界无效");
		const bytes = Buffer.from(data, "base64");
		if (bytes.toString("base64") !== data || bytes.byteLength > CHUNK_PAYLOAD_BYTES) throw new Error("OhMyPi RPC chunk payload 无效");
		this.pendingChunks ??= { chunkId, count: chunkCount, byteLength: totalBytes, nextIndex: 0, chunks: [], receivedBytes: 0 };
		const pending = this.pendingChunks;
		if (pending.chunkId !== chunkId || pending.count !== chunkCount || pending.byteLength !== totalBytes || pending.nextIndex !== chunkIndex) throw new Error("OhMyPi RPC chunk 序列不匹配");
		pending.chunks.push(bytes); pending.receivedBytes += bytes.byteLength; pending.nextIndex += 1;
		if (pending.receivedBytes > pending.byteLength) throw new Error("OhMyPi RPC chunk 超出声明长度");
		if (pending.nextIndex < pending.count) return null;
		if (pending.receivedBytes !== pending.byteLength) throw new Error("OhMyPi RPC chunk 长度不匹配");
		this.pendingChunks = null;
		const decoded = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(pending.chunks));
		const logical: unknown = JSON.parse(decoded);
		if (!logical || typeof logical !== "object" || Array.isArray(logical)) throw new Error("OhMyPi RPC logical frame 无效");
		return logical as OmpRpcFrame;
	}

	private fail(error: Error): void {
		if (this.closed) return; this.closed = true;
		if (this.readyTimer) cancelTimeout(this.readyTimer); this.readyTimer = null; this.rejectReady?.(error); this.resolveReady = null; this.rejectReady = null;
		for (const pending of this.pending.values()) { cancelTimeout(pending.timer); pending.reject(error); } this.pending.clear();
		for (const subscriber of this.subscribers) subscriber.end(error); this.subscribers.clear();
		this.pendingChunks = null;
	}

	async close(): Promise<void> { this.closePromise ??= this.terminate(); return this.closePromise; }

	private async terminate(): Promise<void> {
		this.closed = true;
		this.child.stdin.end();
		if (!this.child.killed) this.child.kill("SIGTERM");
		await new Promise<void>((resolve) => {
			if (this.child.exitCode !== null) { resolve(); return; }
			const timer = scheduleTimeout(() => { if (!this.child.killed) this.child.kill("SIGKILL"); resolve(); }, 2_000);
			this.child.once("close", () => { cancelTimeout(timer); resolve(); });
		});
		if (this.readyTimer) cancelTimeout(this.readyTimer); this.readyTimer = null; this.rejectReady?.(new Error("OhMyPi RPC transport 已关闭")); this.resolveReady = null; this.rejectReady = null;
		for (const pending of this.pending.values()) { cancelTimeout(pending.timer); pending.reject(new Error("OhMyPi RPC transport 已关闭")); } this.pending.clear();
		for (const subscriber of this.subscribers) subscriber.end(); this.subscribers.clear();
		this.pendingChunks = null;
	}
}

export function spawnOmpRpc(spec: SandboxLaunchSpec, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): OmpRpcConnection {
	const child = spawn(spec.executable, spec.args, {
		cwd: spec.cwd, env: spec.environment ?? { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TMPDIR: process.env.TMPDIR ?? "", LANG: process.env.LANG ?? "" },
		shell: false, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
	});
	return new OmpJsonLineConnection(child, requestTimeoutMs);
}

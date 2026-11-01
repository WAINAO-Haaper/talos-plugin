import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { JsonLineRpcConnection, spawnJsonLineRpc } from "../src/agent-workbench/transports/json-line-rpc-connection";
import { OmpJsonLineConnection, spawnOmpRpc } from "../src/agent-workbench/transports/omp-rpc-connection";

const reverseResponder = String.raw`
const readline = require('node:readline');
const lines = [];
readline.createInterface({ input: process.stdin }).on('line', line => {
  const value = JSON.parse(line); lines.push(value);
  if (lines.length === 2) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: lines[1].id, result: { order: 2 } }) + '\n');
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'message.delta', params: { text: 'synthetic' } }) + '\n');
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: lines[0].id, result: { order: 1 } }) + '\n');
  }
});
`;

const ompResponder = String.raw`
const readline = require('node:readline');
process.stdout.write(JSON.stringify({ type: 'ready', protocolVersion: 1, supportedProtocolVersions: [1, 2], maxFrameBytes: 1024, maxReassembledFrameBytes: 4096 }) + '\n');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const value = JSON.parse(line);
  if (value.type === 'get_state') {
    process.stdout.write(JSON.stringify({ type: 'notice', level: 'info', message: 'synthetic' }) + '\n');
    process.stdout.write(JSON.stringify({ type: 'response', id: value.id, command: value.type, success: true, data: { sessionId: 'omp-1' } }) + '\n');
  }
	if (value.type === 'negotiate_protocol') process.stdout.write(JSON.stringify({ type: 'response', id: value.id, command: value.type, success: true, data: { protocolVersion: 2 } }) + '\n');
});
`;

describe("OmpJsonLineConnection", () => {
	it("waits for the native ready frame and correlates type/id responses", async () => {
		const connection = spawnOmpRpc({ executable: process.execPath, args: ["-e", ompResponder], cwd: process.cwd() });
		await connection.ready();
		expect(await connection.request("negotiate_protocol", { protocolVersion: 2 })).toEqual({ protocolVersion: 2 });
		const frames = connection.subscribe()[Symbol.asyncIterator]();
		expect(await connection.request("get_state")).toEqual({ sessionId: "omp-1" });
		expect((await frames.next()).value).toMatchObject({ type: "notice", message: "synthetic" });
		await connection.close();
	});

	it("removes a frame subscription when its consumer returns", async () => {
		const connection = spawnOmpRpc({ executable: process.execPath, args: ["-e", ompResponder], cwd: process.cwd() });
		await connection.ready();
		const retired = connection.subscribe()[Symbol.asyncIterator]();
		await retired.return?.();
		const active = connection.subscribe()[Symbol.asyncIterator]();
		expect(await connection.request("get_state")).toEqual({ sessionId: "omp-1" });
		expect((await active.next()).value).toMatchObject({ type: "notice", message: "synthetic" });
		expect(await retired.next()).toEqual({ value: undefined, done: true });
		await connection.close();
	});

	it("fails closed on a corrupt native frame", async () => {
		const script = "process.stdout.write('{broken\\n'); setInterval(() => {}, 1000);";
		const connection = spawnOmpRpc({ executable: process.execPath, args: ["-e", script], cwd: process.cwd() });
		await expect(connection.ready()).rejects.toThrow("损坏 JSONL");
		await connection.close();
	});

	it("times out both startup and unanswered requests", async () => {
		const noReady = spawnOmpRpc({ executable: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"], cwd: process.cwd() }, 100);
		await expect(noReady.ready()).rejects.toThrow("ready 超时");
		await noReady.close();
		// Allow a real child process enough time to start under the full test suite.
		const noResponse = spawnOmpRpc({ executable: process.execPath, args: ["-e", ompResponder], cwd: process.cwd() }, 1000);
		await noResponse.ready();
		await expect(noResponse.request("never_responds")).rejects.toThrow("请求超时");
		await noResponse.close();
	});
});

describe("JsonLineRpcConnection", () => {
	it("matches out-of-order responses and streams notifications", async () => {
		const connection = spawnJsonLineRpc({ executable: process.execPath, args: ["-e", reverseResponder], cwd: process.cwd() });
		const frames = connection.subscribe()[Symbol.asyncIterator]();
		const first = connection.request<{ order: number }>("first", {});
		const second = connection.request<{ order: number }>("second", {});
		expect(await second).toEqual({ order: 2 });
		expect(await first).toEqual({ order: 1 });
		expect((await frames.next()).value).toMatchObject({ method: "message.delta", params: { text: "synthetic" } });
		await connection.close();
	});

	it("removes a Codex frame subscription when its turn consumer returns", async () => {
		const connection = spawnJsonLineRpc({ executable: process.execPath, args: ["-e", reverseResponder], cwd: process.cwd() });
		const retired = connection.subscribe()[Symbol.asyncIterator]();
		await retired.return?.();
		const active = connection.subscribe()[Symbol.asyncIterator]();
		const first = connection.request<{ order: number }>("first", {});
		const second = connection.request<{ order: number }>("second", {});
		await Promise.all([first, second]);
		expect((await active.next()).value).toMatchObject({ method: "message.delta" });
		expect(await retired.next()).toEqual({ value: undefined, done: true });
		await connection.close();
	});

	it("fails pending work on a corrupt frame and still terminates the process", async () => {
		const script = "process.stdout.write('{broken\\n'); setInterval(() => {}, 1000);";
		const connection = spawnJsonLineRpc({ executable: process.execPath, args: ["-e", script], cwd: process.cwd() });
		await expect(connection.request("ready", {})).rejects.toThrow("损坏 JSONL");
		await connection.close();
		await expect(connection.request("after-close", {})).rejects.toThrow("关闭");
	});

	it("times out unanswered requests and propagates process crashes to streams", async () => {
		const hung = spawnJsonLineRpc({ executable: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"], cwd: process.cwd() }, 100);
		await expect(hung.request("never", {})).rejects.toThrow("请求超时");
		await hung.close();
		const script = "process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'notice', params: { message: 'before crash' } }) + '\\n', () => process.exit(3));";
		const crashed = spawnJsonLineRpc({ executable: process.execPath, args: ["-e", script], cwd: process.cwd() });
		const frames = crashed.subscribe()[Symbol.asyncIterator]();
		expect((await frames.next()).value).toMatchObject({ method: "notice" });
		await expect(frames.next()).rejects.toThrow("退出：3");
		await crashed.close();
	});
});


describe("RPC child termination", () => {
	it.each(["codex", "ohmypi"] as const)("closes an already failed %s spawn without hanging", async (runtime) => {
		const child = spawn("/synthetic/nonexistent-talos-runtime", [], { stdio: ["pipe", "pipe", "pipe"] });
		const connection = runtime === "codex" ? new JsonLineRpcConnection(child) : new OmpJsonLineConnection(child);
		const failure = connection instanceof OmpJsonLineConnection ? expect(connection.ready()).rejects.toThrow() : Promise.resolve();
		await new Promise<void>((resolve) => child.once("close", () => resolve()));
		await failure;
		await connection.close();
	});

	it.each(["codex", "ohmypi"] as const)("reports a %s child that never confirms termination", async (runtime) => {
		const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["pipe", "pipe", "pipe"] });
		const originalKill = child.kill.bind(child);
		const connection = runtime === "codex" ? new JsonLineRpcConnection(child) : new OmpJsonLineConnection(child);
		const readyFailure = connection instanceof OmpJsonLineConnection ? expect(connection.ready()).rejects.toThrow("关闭") : Promise.resolve();
		child.kill = () => true;
		try {
			await expect(connection.close()).rejects.toThrow("SIGKILL 后仍未退出");
			await readyFailure;
			await expect(connection.request("after-close", {})).rejects.toThrow("关闭");
		} finally {
			originalKill("SIGKILL");
		}
	}, 7_000);

	it.skipIf(process.platform === "win32").each(["codex", "ohmypi"] as const)(
		"waits for the %s process to exit even when it ignores SIGTERM",
		async (runtime) => {
			const ready = runtime === "codex"
				? { jsonrpc: "2.0", method: "ready", params: {} }
				: { type: "ready", protocolVersion: 1, supportedProtocolVersions: [1] };
			const script = `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); process.stdout.write(${JSON.stringify(JSON.stringify(ready) + "\n")});`;
			const child = spawn(process.execPath, ["-e", script], { stdio: ["pipe", "pipe", "pipe"] });
			const connection = runtime === "codex" ? new JsonLineRpcConnection(child) : new OmpJsonLineConnection(child);
			try {
				if (connection instanceof OmpJsonLineConnection) await connection.ready();
				else await connection.subscribe()[Symbol.asyncIterator]().next();
				await connection.close();
				expect(child.signalCode).toBe("SIGKILL");
				expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
				await connection.close();
			} finally {
				if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
				await connection.close();
			}
		},
	);
});

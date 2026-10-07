import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { DshLoopbackGateway, DSH_HEALTH_PRODUCT, DSH_HEALTH_PROTOCOL_VERSION } from "../src/harness/dsh-gateway";
import { dshBaseUrl, parseDshWebToken } from "../src/harness/dsh-runtime";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
});

async function listen(server: http.Server): Promise<number> {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
	return (server.address() as AddressInfo).port;
}

function request(port: number, headers: http.OutgoingHttpHeaders = {}, upgrade = false): Promise<number> {
	return new Promise((resolve, reject) => {
		const req = http.get({ host: "127.0.0.1", port, path: "/api/test", headers: {
			...headers,
			...(upgrade ? { Connection: "Upgrade", Upgrade: "websocket" } : {}),
		} }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
		req.on("upgrade", (res, socket) => { socket.destroy(); resolve(res.statusCode ?? 0); });
		req.on("error", reject);
		req.setTimeout(2000, () => req.destroy(new Error("test request timed out")));
	});
}

async function fixture(handshakeStatus = 303, cookies = ["dsh-auth-test=SESSION; Path=/; HttpOnly"]) {
	const seen: http.IncomingHttpHeaders[] = [];
	const backend = http.createServer((req, res) => {
		if (req.url?.startsWith("/?token=")) {
			res.writeHead(handshakeStatus, { "set-cookie": cookies });
			res.end();
			return;
		}
		seen.push(req.headers);
		res.writeHead(200);
		res.end("ok");
	});
	backend.on("upgrade", (req, socket) => {
		seen.push(req.headers);
		socket.end("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
	});
	const backendPort = await listen(backend);
	const reservation = http.createServer();
	const publicPort = await listen(reservation);
	await cleanup.pop()?.();
	const gateway = new DshLoopbackGateway(publicPort, backendPort, {
		product: DSH_HEALTH_PRODUCT, protocolVersion: DSH_HEALTH_PROTOCOL_VERSION,
		harnessVersion: "0.1.2", instanceNonce: "synthetic-nonce", workspaceId: "synthetic-workspace",
	});
	await gateway.start();
	cleanup.push(() => gateway.close());
	await gateway.tryTokenHandshake("synthetic-token", dshBaseUrl(backendPort));
	gateway.setReady(true);
	return { gateway, publicPort, backendPort, seen };
}

describe("Harness authenticated gateway regression coverage", () => {
	it.each([false, true])("rejects foreign origins before attaching credentials (upgrade=%s)", async (upgrade) => {
		const f = await fixture();
		expect(await request(f.publicPort, { Origin: "https://untrusted.example" }, upgrade)).toBe(403);
		expect(f.seen).toHaveLength(0);
	});
	it("rejects foreign Host headers before attaching credentials", async () => {
		const f = await fixture();
		expect(await request(f.publicPort, { Host: "untrusted.example" })).toBe(403);
		expect(f.seen).toHaveLength(0);
	});
	it.each([false, true])("rewrites trusted requests and replaces stale browser cookies (upgrade=%s)", async (upgrade) => {
		const f = await fixture();
		expect(await request(f.publicPort, { Origin: dshBaseUrl(f.publicPort), Cookie: "dsh-auth-test=STALE" }, upgrade)).toBe(upgrade ? 101 : 200);
		expect(f.seen.at(-1)?.host).toBe(`127.0.0.1:${f.backendPort}`);
		expect(f.seen.at(-1)?.origin).toBe(dshBaseUrl(f.backendPort));
		expect(f.seen.at(-1)?.cookie).toBe("dsh-auth-test=SESSION");
	});
	it("ignores cookies returned by a failed authentication response", async () => {
		const f = await fixture(401);
		expect(f.gateway.hasAuthCookie).toBe(false);
	});
	it("finds the auth cookie after unrelated cookies and clears it on close", async () => {
		const f = await fixture(303, ["theme=dark", "dsh-auth-test=SESSION; Path=/; HttpOnly"]);
		await request(f.publicPort);
		expect(f.seen.at(-1)?.cookie).toBe("dsh-auth-test=SESSION");
		await f.gateway.close();
		expect(f.gateway.hasAuthCookie).toBe(false);
	});
	it("does not treat an incomplete stdout token or unrelated log URL as a launch token", () => {
		expect(parseDshWebToken("dsh web: http://127.0.0.1:3180/?token=part")).toBeNull();
		expect(parseDshWebToken("request: http://127.0.0.1:3180/?token=unrelated\n")).toBeNull();
		expect(parseDshWebToken("dsh web: http://127.0.0.1:3180/?token=part-complete\n")).toBe("part-complete");
	});
});

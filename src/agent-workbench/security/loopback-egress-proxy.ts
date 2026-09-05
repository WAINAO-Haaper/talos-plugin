import http, { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect } from "node:net";
import type { Duplex } from "node:stream";

export interface EgressDestination {
	host: string;
	port: number;
}

export type EgressAuthorization = boolean | "allow" | "allow-always" | "deny";
export type EgressAuthorizer = (destination: EgressDestination) => Promise<EgressAuthorization>;

function parseAuthority(authority: string | undefined): EgressDestination {
	if (!authority || authority.length > 512) throw new Error("代理目标无效");
	const url = new URL("http://" + authority);
	if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("代理目标格式无效");
	const host = url.hostname.toLowerCase().replace(/\.$/, "");
	const port = url.port ? Number(url.port) : 443;
	if (!host || !Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("代理目标边界无效");
	return { host, port };
}

/**
 * A content-blind egress bridge. Sandboxed runtimes can reach only this
 * loopback listener; every destination is authorized before TALOS opens the
 * upstream socket. Request bodies and response bytes are never persisted.
 *
 * 支持两类代理请求：
 * - CONNECT（HTTPS 隧道）：原始终端字节直通。
 * - absolute-form HTTP（`POST http://host:port/path`，plain-HTTP 客户端在
 *   设置 http_proxy 后使用，如 codex CLI 的 wire_api=responses + http:// 网关）：
 *   以隧道方式直通——保留原始请求头/方法/路径，仅把 Host 改写为上游权威，
 *   不做任何内容解析或改写。
 */
export class LoopbackEgressProxy {
	private server: Server | null = null;
	private readonly sockets = new Set<Duplex>();
	private readonly pendingAuthorizations = new Map<string, Promise<boolean>>();
	private readonly rememberedDestinations = new Set<string>();

	constructor(private readonly authorize: EgressAuthorizer) {}

	async start(): Promise<number> {
		if (this.server) throw new Error("egress proxy 已启动");
		const server = createServer((request, response) => {
			void this.forwardHttp(request, response);
		});
		server.on("connect", (request, client, head) => {
			void this.connectTunnel(request.url, client, head);
		});
		this.server = server;
		await new Promise<void>((resolve, reject) => {
			const fail = (error: Error) => { server.off("listening", ready); reject(error); };
			const ready = () => { server.off("error", fail); resolve(); };
			server.once("error", fail);
			server.once("listening", ready);
			server.listen(0, "127.0.0.1");
		});
		const address = server.address();
		if (!address || typeof address === "string") { await this.close(); throw new Error("egress proxy 端口不可用"); }
		return address.port;
	}

	private track(socket: Duplex): void {
		this.sockets.add(socket);
		socket.on("error", () => { /* tunnel handlers own close/502 behavior */ });
		socket.once("close", () => this.sockets.delete(socket));
	}

	private authorizeDestination(destination: EgressDestination): Promise<boolean> {
		const key = destination.host + ":" + destination.port;
		if (this.rememberedDestinations.has(key)) return Promise.resolve(true);
		const pending = this.pendingAuthorizations.get(key);
		if (pending) return pending;
		const authorization = Promise.resolve()
			.then(() => this.authorize(destination))
			.then((decision) => {
				if (decision === "allow-always") this.rememberedDestinations.add(key);
				return decision === true || decision === "allow" || decision === "allow-always";
			})
			.finally(() => {
				if (this.pendingAuthorizations.get(key) === authorization) this.pendingAuthorizations.delete(key);
			});
		this.pendingAuthorizations.set(key, authorization);
		return authorization;
	}

	private async forwardHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
		let url: URL;
		try {
			url = new URL(request.url ?? "");
		} catch {
			response.writeHead(400, { connection: "close" });
			response.end();
			return;
		}
		if (url.protocol !== "http:") {
			// 仅支持 absolute-form HTTP 代理；CONNECT 走独立隧道；相对路径直接请求不是代理语义
			response.writeHead(405, { connection: "close" });
			response.end();
			return;
		}
		const destination = { host: url.hostname.toLowerCase().replace(/\.$/, ""), port: url.port ? Number(url.port) : 80 };
		if (!destination.host || !Number.isSafeInteger(destination.port) || destination.port < 1 || destination.port > 65_535) {
			response.writeHead(400, { connection: "close" });
			response.end();
			return;
		}
		let authorized: boolean;
		try {
			authorized = await this.authorizeDestination(destination);
		} catch {
			authorized = false;
		}
		if (!authorized) {
			response.writeHead(403, { connection: "close" });
			response.end();
			return;
		}
		const headers: Record<string, string | string[] | number | undefined> = { ...request.headers };
		delete headers.host;
		delete headers["proxy-connection"];
		const upstream = http.request({
			host: destination.host,
			port: destination.port,
			path: url.pathname + url.search,
			method: request.method,
			headers,
		});
		upstream.on("error", (error) => {
			if (!response.headersSent) {
				response.writeHead(502, { connection: "close" });
				response.end("egress proxy 上游错误: " + error.message);
			} else {
				response.destroy();
			}
		});
		upstream.on("response", (upstreamRes) => {
			try {
				response.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
			} catch {
				response.destroy();
				return;
			}
			upstreamRes.pipe(response);
			upstreamRes.on("error", () => response.destroy());
		});
		response.on("close", () => upstream.destroy());
		request.on("error", () => upstream.destroy());
		request.pipe(upstream);
	}

	private async connectTunnel(authority: string | undefined, client: Duplex, head: Buffer): Promise<void> {
		this.track(client);
		let destination: EgressDestination;
		try {
			destination = parseAuthority(authority);
			if (!(await this.authorizeDestination(destination))) throw new Error("目标未授权");
		} catch {
			client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
			return;
		}
		const upstream = connect({ host: destination.host, port: destination.port });
		this.track(upstream);
		upstream.once("connect", () => {
			client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
			if (head.length > 0) upstream.write(head);
			client.pipe(upstream);
			upstream.pipe(client);
		});
		upstream.once("error", () => client.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n"));
		client.once("error", () => upstream.destroy());
	}

	async close(): Promise<void> {
		this.pendingAuthorizations.clear();
		this.rememberedDestinations.clear();
		for (const socket of this.sockets) socket.destroy();
		this.sockets.clear();
		const server = this.server;
		this.server = null;
		if (!server) return;
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
}

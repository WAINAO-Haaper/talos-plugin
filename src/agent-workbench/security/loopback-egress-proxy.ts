import { createServer, type Server } from "node:http";
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
 * A content-blind CONNECT bridge. Sandboxed runtimes can reach only this
 * loopback listener; every destination is authorized before TALOS opens the
 * upstream socket. Request bodies and response bytes are never persisted.
 */
export class LoopbackEgressProxy {
	private server: Server | null = null;
	private readonly sockets = new Set<Duplex>();
	private readonly pendingAuthorizations = new Map<string, Promise<boolean>>();
	private readonly rememberedDestinations = new Set<string>();

	constructor(private readonly authorize: EgressAuthorizer) {}

	async start(): Promise<number> {
		if (this.server) throw new Error("egress proxy 已启动");
		const server = createServer((_request, response) => {
			response.writeHead(405, { connection: "close" });
			response.end();
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

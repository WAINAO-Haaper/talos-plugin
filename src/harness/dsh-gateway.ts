import * as http from "http";
import { connect, type Socket } from "net";

import { DSH_HOST } from "./dsh-runtime";

export const DSH_HEALTH_PATH = "/__talos/harness-health";
export const DSH_HEALTH_PRODUCT = "talos-deepseek-harness";
export const DSH_HEALTH_PROTOCOL_VERSION = 1;

export interface DshHealthIdentity {
	product: typeof DSH_HEALTH_PRODUCT;
	protocolVersion: typeof DSH_HEALTH_PROTOCOL_VERSION;
	harnessVersion: string;
	instanceNonce: string;
	workspaceId: string;
	ready: boolean;
}

export type DshHealthProbe =
	| { reachable: false }
	| { reachable: true; identity: DshHealthIdentity | null; error: string };

export interface DshGateway {
	readonly identity: Omit<DshHealthIdentity, "ready">;
	start(): Promise<void>;
	setReady(ready: boolean): void;
	close(): Promise<void>;
}

function isHealthIdentity(value: unknown): value is DshHealthIdentity {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<DshHealthIdentity>;
	return (
		candidate.product === DSH_HEALTH_PRODUCT &&
		candidate.protocolVersion === DSH_HEALTH_PROTOCOL_VERSION &&
		typeof candidate.harnessVersion === "string" &&
		candidate.harnessVersion.length > 0 &&
		typeof candidate.instanceNonce === "string" &&
		/^[a-zA-Z0-9-]{16,160}$/.test(candidate.instanceNonce) &&
		typeof candidate.workspaceId === "string" &&
		/^[a-f0-9]{64}$/.test(candidate.workspaceId) &&
		typeof candidate.ready === "boolean"
	);
}

export function assertDshHealthIdentity(
	probe: DshHealthProbe,
	expected: Omit<DshHealthIdentity, "ready">,
	requireReady: boolean
): DshHealthIdentity {
	if (!probe.reachable) {
		throw new Error("Harness 专用健康接口不可达");
	}
	if (!probe.identity) {
		throw new Error(`端口上的服务不是受管 Harness：${probe.error}`);
	}
	const actual = probe.identity;
	if (actual.product !== expected.product) {
		throw new Error("Harness 产品身份不匹配");
	}
	if (
		actual.protocolVersion !== expected.protocolVersion ||
		actual.harnessVersion !== expected.harnessVersion
	) {
		throw new Error("Harness 版本身份不匹配");
	}
	if (actual.instanceNonce !== expected.instanceNonce) {
		throw new Error("Harness 实例 nonce 不匹配");
	}
	if (actual.workspaceId !== expected.workspaceId) {
		throw new Error("Harness 工作区身份不匹配");
	}
	if (requireReady && !actual.ready) {
		throw new Error("Harness 身份已确认，但后端尚未就绪");
	}
	return actual;
}

export function probeDshHealth(
	baseUrl: string,
	timeoutMs = 1500
): Promise<DshHealthProbe> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (result: DshHealthProbe): void => {
			if (settled) return;
			settled = true;
			resolve(result);
		};
		const request = http.get(
			`${baseUrl}${DSH_HEALTH_PATH}`,
			{ headers: { Accept: "application/json" } },
			(response) => {
				let body = "";
				response.setEncoding("utf8");
				response.on("data", (chunk: string) => {
					body += chunk;
					if (body.length > 8192) request.destroy();
				});
				response.on("end", () => {
					if (body.length > 8192) {
						finish({
							reachable: true,
							identity: null,
							error: "健康响应过大",
						});
						return;
					}
					if (response.statusCode !== 200) {
						finish({
							reachable: true,
							identity: null,
							error: `健康接口返回 HTTP ${response.statusCode ?? "?"}`,
						});
						return;
					}
					try {
						const parsed: unknown = JSON.parse(body);
						finish({
							reachable: true,
							identity: isHealthIdentity(parsed) ? parsed : null,
							error: isHealthIdentity(parsed) ? "" : "健康响应身份字段无效",
						});
					} catch {
						finish({
							reachable: true,
							identity: null,
							error: "健康响应不是 JSON",
						});
					}
				});
			}
		);
		request.on("error", () => finish({ reachable: false }));
		request.setTimeout(timeoutMs, () => {
			request.destroy();
			finish({ reachable: false });
		});
	});
}

export class DshLoopbackGateway implements DshGateway {
	private server: http.Server | null = null;
	private ready = false;
	private readonly sockets = new Set<Socket>();

	constructor(
		private readonly publicPort: number,
		private readonly backendPort: number,
		readonly identity: Omit<DshHealthIdentity, "ready">
	) {}

	setReady(ready: boolean): void {
		this.ready = ready;
	}

	async start(): Promise<void> {
		if (this.server) return;
		const server = http.createServer((request, response) => {
			this.handleHttp(request, response);
		});
		server.on("connection", (socket) => {
			this.sockets.add(socket);
			socket.once("close", () => this.sockets.delete(socket));
		});
		server.on("upgrade", (request, socket, head) => {
			if (!this.ready || request.url?.startsWith(DSH_HEALTH_PATH)) {
				socket.destroy();
				return;
			}
			const upstream = connect(this.backendPort, DSH_HOST, () => {
				const requestLine =
					`${request.method ?? "GET"} ${request.url ?? "/"} HTTP/${request.httpVersion}\r\n`;
				const headers: string[] = [];
				for (let index = 0; index < request.rawHeaders.length; index += 2) {
					headers.push(
						`${request.rawHeaders[index]}: ${request.rawHeaders[index + 1] ?? ""}`
					);
				}
				upstream.write(`${requestLine}${headers.join("\r\n")}\r\n\r\n`);
				if (head.length > 0) upstream.write(head);
				socket.pipe(upstream).pipe(socket);
			});
			upstream.on("error", () => socket.destroy());
			socket.on("error", () => upstream.destroy());
		});
		this.server = server;
		await new Promise<void>((resolve, reject) => {
			const onError = (error: Error): void => {
				server.off("listening", onListening);
				reject(error);
			};
			const onListening = (): void => {
				server.off("error", onError);
				resolve();
			};
			server.once("error", onError);
			server.once("listening", onListening);
			server.listen(this.publicPort, DSH_HOST);
		});
	}

	async close(): Promise<void> {
		const server = this.server;
		this.server = null;
		this.ready = false;
		if (!server) return;
		await new Promise<void>((resolve) => {
			server.close(() => resolve());
			for (const socket of this.sockets) socket.destroy();
			this.sockets.clear();
		});
	}

	private handleHttp(
		request: http.IncomingMessage,
		response: http.ServerResponse
	): void {
		const path = new URL(
			request.url ?? "/",
			`http://${DSH_HOST}:${this.publicPort}`
		).pathname;
		if (path === DSH_HEALTH_PATH) {
			response.writeHead(200, {
				"Cache-Control": "no-store",
				"Content-Type": "application/json; charset=utf-8",
			});
			response.end(JSON.stringify({ ...this.identity, ready: this.ready }));
			return;
		}
		if (!this.ready) {
			response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("Harness backend is not ready");
			return;
		}
		const upstream = http.request(
			{
				host: DSH_HOST,
				port: this.backendPort,
				method: request.method,
				path: request.url,
				headers: request.headers,
			},
			(upstreamResponse) => {
				response.writeHead(
					upstreamResponse.statusCode ?? 502,
					upstreamResponse.headers
				);
				upstreamResponse.pipe(response);
			}
		);
		upstream.on("error", () => {
			if (!response.headersSent) response.writeHead(502);
			response.end();
		});
		request.pipe(upstream);
	}
}

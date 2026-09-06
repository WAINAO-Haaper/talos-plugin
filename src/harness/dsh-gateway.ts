import * as http from "http";
import { connect, type Socket } from "net";

import { DSH_HOST, dshBaseUrl } from "./dsh-runtime";

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
	/**
	 * dsh >= 0.1.2 web 服务带 token 认证：启动时在 stdout 打印
	 * `dsh web: http://127.0.0.1:<port>/?token=...`。一次性访问该 URL 换取
	 * session cookie（HttpOnly，长有效期），后续转发自动携带。
	 * dsh <= 0.1.0（无 token 认证）时后端不要求 cookie，本方法可安全跳过
	 * （注入未知 cookie 对无认证服务无副作用）。
	 */
	tryTokenHandshake(token: string | null, backendBaseUrl: string): Promise<void>;
	/** token 握手是否已拿到 session cookie（dsh >= 0.1.2 的就绪信号）。 */
	readonly hasAuthCookie: boolean;
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

function backendAuthority(baseUrl: string): { host: string; port: number } {
	const parsed = new URL(baseUrl);
	return { host: parsed.hostname, port: parsed.port ? Number(parsed.port) : 80 };
}

export class DshLoopbackGateway implements DshGateway {
	private server: http.Server | null = null;
	private ready = false;
	/** dsh >= 0.1.2 web token 认证换取的 session cookie（无 token 时为空）。 */
	private cookie = "";
	private readonly sockets = new Set<Socket>();

	constructor(
		private readonly publicPort: number,
		private readonly backendPort: number,
		readonly identity: Omit<DshHealthIdentity, "ready">
	) {}

	setReady(ready: boolean): void {
		this.ready = ready;
	}

	private cookieHeader(): Record<string, string> {
		return this.cookie ? { cookie: this.cookie } : {};
	}

	private isTrustedRequest(request: http.IncomingMessage): boolean {
		// Check the public authority before rewriting it or attaching backend credentials.
		// In particular, never turn a foreign browser Origin into a trusted loopback Origin.
		return request.headers.host === `${DSH_HOST}:${this.publicPort}` &&
			(request.headers.origin === undefined || request.headers.origin === dshBaseUrl(this.publicPort));
	}

	get hasAuthCookie(): boolean {
		return this.cookie.length > 0;
	}

	async tryTokenHandshake(token: string | null, backendBaseUrl: string): Promise<void> {
		if (!token) return;
		if (backendBaseUrl !== dshBaseUrl(this.backendPort)) return;
		const { host, port } = backendAuthority(backendBaseUrl);
		try {
			const sessionCookie = await this.exchangeSessionCookie(host, port, token);
			if (sessionCookie) this.cookie = sessionCookie;
		} catch {
			// token 交换失败时保持无 cookie 状态：probeBackend 轮询会暴露真实的
			// 就绪失败原因，这里静默以免掩盖后端日志。
		}
	}

	/**
	 * 访问 token URL 触发 303 + Set-Cookie，提取 session cookie 值。
	 * 独立请求（不复用 socket 池），只取 cookie 不读取后续资源。
	 */
	private exchangeSessionCookie(host: string, port: number, token: string): Promise<string | null> {
		return new Promise((resolve) => {
			const request = http.get(
				{ host, port, path: "/?token=" + encodeURIComponent(token), headers: { Accept: "text/html" } },
				(response) => {
					const setCookies = response.headers["set-cookie"];
					const first = response.statusCode === 303
						? setCookies?.find((value) => /^dsh-auth-[^=;\s]+=[^;\s]+/.test(value))
						: undefined;
					if (first) {
						// "name=value; Max-Age=...; Path=/; HttpOnly; ..." → 取 name=value
						const pair = first.split(";", 1)[0].trim();
						const eq = pair.indexOf("=");
						if (eq > 0 && pair.length > eq + 1) {
							response.resume();
							resolve(pair);
							return;
						}
					}
					response.resume();
					resolve(null);
				}
			);
			request.on("error", () => resolve(null));
			request.setTimeout(3000, () => {
				request.destroy();
				resolve(null);
			});
		});
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
			if (!this.isTrustedRequest(request)) {
				socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
				return;
			}
			if (!this.ready || request.url?.startsWith(DSH_HEALTH_PATH)) {
				socket.destroy();
				return;
			}
			const upstream = connect(this.backendPort, DSH_HOST, () => {
				const requestLine =
					`${request.method ?? "GET"} ${request.url ?? "/"} HTTP/${request.httpVersion}\r\n`;
				const headers: string[] = [];
				for (let index = 0; index < request.rawHeaders.length; index += 2) {
					const key = request.rawHeaders[index];
					const value = request.rawHeaders[index + 1] ?? "";
					// dsh >= 0.1.2 browser-trust fence 校验 Host/Origin：重写为后端权威
					if (key.toLowerCase() === "host" || key.toLowerCase() === "origin" ||
						(this.cookie && key.toLowerCase() === "cookie")) continue;
					headers.push(`${key}: ${value}`);
				}
				headers.push(`Host: ${DSH_HOST}:${this.backendPort}`);
				if (request.headers.origin !== undefined) headers.push(`Origin: ${dshBaseUrl(this.backendPort)}`);
				const cookie = this.cookieHeader();
				if (cookie.cookie) headers.push(`Cookie: ${cookie.cookie}`);
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
		this.cookie = "";
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
		if (!this.isTrustedRequest(request)) {
			response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("Untrusted Harness request origin");
			return;
		}
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
		const upstreamHost = DSH_HOST + ":" + this.backendPort;
		const upstream = http.request(
			{
				host: DSH_HOST,
				port: this.backendPort,
				method: request.method,
				path: request.url,
				// dsh >= 0.1.2 的 browser-trust fence 校验 Host 与 Origin：
				// 入站两值均指向本网关（publicPort），必须重写为后端权威，否则 403/401。
				headers: {
					...request.headers,
					host: upstreamHost,
					...(request.headers.origin !== undefined ? { origin: "http://" + upstreamHost } : {}),
					...this.cookieHeader(),
				},
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

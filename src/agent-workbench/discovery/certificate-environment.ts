import { realpath } from "node:fs/promises";
import path from "node:path";

// 沙箱化运行时只继承用户显式配置的 CA 相关键：代理键由 TALOS 独占，
// 用户环境不得覆盖 loopback egress 的目的地。
const INHERITED_CERTIFICATE_KEYS = [
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
	"REQUESTS_CA_BUNDLE",
	"CURL_CA_BUNDLE",
	"NODE_EXTRA_CA_CERTS",
] as const;

const DIRECTORY_CERTIFICATE_KEYS = new Set<string>(["SSL_CERT_DIR"]);

/**
 * Resolves user-configured CA material into an environment slice plus the
 * sandbox read roots that make it reachable. Entries that do not resolve on
 * disk are dropped: injecting a dangling bundle path breaks OpenSSL clients
 * that would otherwise fall back to the platform trust store.
 */
export async function resolveCertificateEnvironment(
	source: NodeJS.ProcessEnv = process.env,
	resolvePath: (value: string) => Promise<string> = realpath
): Promise<{ environment: Record<string, string>; readRoots: string[] }> {
	const environment: Record<string, string> = {};
	const readRoots = new Set<string>();
	for (const key of INHERITED_CERTIFICATE_KEYS) {
		const raw = source[key];
		if (typeof raw !== "string" || !raw.trim() || raw.includes("\0")) continue;
		const isDirectory = DIRECTORY_CERTIFICATE_KEYS.has(key);
		const entries = (isDirectory ? raw.split(path.delimiter) : [raw])
			.map((entry) => entry.trim());
		if (entries.some((entry) => !entry || !path.isAbsolute(entry))) continue;
		const kept: string[] = [];
		const roots: string[] = [];
		for (const entry of entries) {
			let resolved: string;
			try { resolved = await resolvePath(entry); } catch { break; }
			kept.push(entry);
			roots.push(isDirectory ? resolved : path.dirname(resolved));
		}
		if (kept.length !== entries.length) continue;
		environment[key] = kept.join(isDirectory ? path.delimiter : "");
		for (const root of roots) readRoots.add(root);
	}
	return { environment, readRoots: [...readRoots] };
}

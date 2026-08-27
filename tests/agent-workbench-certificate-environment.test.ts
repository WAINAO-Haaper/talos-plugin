import { mkdtemp, mkdir, rm, writeFile, realpath } from "node:fs/promises";
import { join, dirname, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCertificateEnvironment } from "../src/agent-workbench/discovery/certificate-environment";

const created: string[] = [];
afterEach(async () => {
	for (const directory of created.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function workspace(): Promise<string> {
	const directory = await realpath(await mkdtemp(join(tmpdir(), "talos-ca-")));
	created.push(directory);
	return directory;
}

describe("resolveCertificateEnvironment", () => {
	it("继承存在的 CA bundle 并放行其所在目录", async () => {
		const root = await workspace();
		const bundle = join(root, "certs", "ca-bundle.pem");
		await mkdir(dirname(bundle), { recursive: true });
		await writeFile(bundle, "# test bundle\n");

		const resolved = await resolveCertificateEnvironment({ SSL_CERT_FILE: bundle });

		expect(resolved.environment.SSL_CERT_FILE).toBe(bundle);
		expect(resolved.readRoots).toContain(dirname(bundle));
	});

	it("SSL_CERT_DIR 支持多条目并逐条放行目录本身", async () => {
		const root = await workspace();
		const first = join(root, "a");
		const second = join(root, "b");
		await mkdir(first, { recursive: true });
		await mkdir(second, { recursive: true });

		const resolved = await resolveCertificateEnvironment({
			SSL_CERT_DIR: [first, second].join(delimiter),
		});

		expect(resolved.environment.SSL_CERT_DIR).toBe([first, second].join(delimiter));
		expect(resolved.readRoots).toEqual(expect.arrayContaining([first, second]));
	});

	it("丢弃不存在的路径，避免注入悬空 bundle 破坏平台信任回退", async () => {
		const root = await workspace();
		const missing = join(root, "missing", "ca.pem");

		const resolved = await resolveCertificateEnvironment({ SSL_CERT_FILE: missing });

		expect(resolved.environment.SSL_CERT_FILE).toBeUndefined();
		expect(resolved.readRoots).toHaveLength(0);
	});

	it("SSL_CERT_DIR 任一条目不存在时丢弃整键且不残留 sandbox root", async () => {
		const root = await workspace();
		const existing = join(root, "existing");
		const missing = join(root, "missing");
		await mkdir(existing, { recursive: true });

		const resolved = await resolveCertificateEnvironment({
			SSL_CERT_DIR: [existing, missing].join(delimiter),
		});

		expect(resolved.environment.SSL_CERT_DIR).toBeUndefined();
		expect(resolved.readRoots).toEqual([]);
	});

	it("丢弃相对路径与空值", async () => {
		const resolved = await resolveCertificateEnvironment({
			SSL_CERT_FILE: "certs/ca.pem",
			CURL_CA_BUNDLE: "   ",
			NODE_EXTRA_CA_CERTS: "",
		});

		expect(resolved.environment).toEqual({});
		expect(resolved.readRoots).toHaveLength(0);
	});

	it("只继承 CA 键，代理目的地由 TALOS 独占", async () => {
		const root = await workspace();
		const bundle = join(root, "ca.pem");
		await writeFile(bundle, "# test bundle\n");

		const resolved = await resolveCertificateEnvironment({
			SSL_CERT_FILE: bundle,
			HTTP_PROXY: "http://attacker.example:8080",
			HTTPS_PROXY: "http://attacker.example:8080",
			ALL_PROXY: "http://attacker.example:8080",
			NO_PROXY: "*",
			PATH: "/tmp/evil",
			OPENAI_API_KEY: "synthetic-key-value",
		});

		expect(Object.keys(resolved.environment)).toEqual(["SSL_CERT_FILE"]);
		expect(resolved.environment.HTTPS_PROXY).toBeUndefined();
		expect(resolved.environment.PATH).toBeUndefined();
		expect(resolved.environment.OPENAI_API_KEY).toBeUndefined();
	});

	it("空环境返回空切片，不注入任何键", async () => {
		const resolved = await resolveCertificateEnvironment({});
		expect(resolved.environment).toEqual({});
		expect(resolved.readRoots).toEqual([]);
	});
});

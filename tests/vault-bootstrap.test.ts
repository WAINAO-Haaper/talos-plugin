import { describe, expect, it } from "vitest";
import {
	bootstrapTalosVault,
	CANONICAL_REGISTRY_TEMPLATE,
	type VaultBootstrapHost,
} from "../src/bootstrap/vault-bootstrap";
import {
	CANONICAL_REGISTRY_PATH,
	CanonicalRegistryReader,
} from "../src/canonical/registry-reader";
import { loadQuyuanSoulContextWithFallback } from "../src/quyuan/persona-context";

const PRIMARY = [
	"灵魂/PERSONA.md",
	"灵魂/persona-memory.md",
	"Identity/CONTEXT.md",
] as const;
const FALLBACK = [
	"Identity/身份.md",
	"Identity/偏好与边界.md",
	"Identity/目标.md",
] as const;

class MemoryBootstrapHost implements VaultBootstrapHost {
	readonly files = new Map<string, string>();
	readonly folders = new Set<string>();
	readonly created: string[] = [];

	async exists(target: string): Promise<boolean> {
		return this.files.has(target) || this.folders.has(target);
	}

	async read(target: string): Promise<string> {
		const value = this.files.get(target);
		if (value === undefined) throw new Error(`missing: ${target}`);
		return value;
	}

	async createFolder(target: string): Promise<void> {
		if (await this.exists(target)) throw new Error(`exists: ${target}`);
		this.folders.add(target);
	}

	async create(target: string, content: string): Promise<void> {
		if (await this.exists(target)) throw new Error(`exists: ${target}`);
		this.files.set(target, content);
		this.created.push(target);
	}

	asApp() {
		return {
			vault: {
				adapter: {
					exists: (target: string) => this.exists(target),
					read: (target: string) => this.read(target),
				},
			},
		};
	}
}

describe("TALOS Vault bootstrap", () => {
	it("creates the minimum scaffold once and validates both persona and registry contracts", async () => {
		const host = new MemoryBootstrapHost();
		const first = await bootstrapTalosVault({
			host,
			primaryPersonaPaths: PRIMARY,
			fallbackPersonaPaths: FALLBACK,
		});
		expect(first.created).toEqual([...PRIMARY, CANONICAL_REGISTRY_PATH]);
		expect(first.invalidExisting).toEqual([]);
		expect(await loadQuyuanSoulContextWithFallback(
			host.asApp() as never,
			PRIMARY,
			FALLBACK,
		)).toMatchObject({
			sources: PRIMARY.map((path) => ({ path })),
		});
		await expect(new CanonicalRegistryReader({
			read: (target) => host.read(target),
		}).read()).resolves.toMatchObject({
			talosAsk: {
				id: "talos-ask",
				obsidianCommandId: "talos-ask",
				requestPath: ".talos/command-requests/talos-ask.json",
			},
		});

		const created = [...host.created];
		const second = await bootstrapTalosVault({
			host,
			primaryPersonaPaths: PRIMARY,
			fallbackPersonaPaths: FALLBACK,
		});
		expect(host.created).toEqual(created);
		expect(second.created).toEqual([]);
		expect(second.preserved).toEqual([CANONICAL_REGISTRY_PATH]);
	});

	it("does not create generic primary files over a complete fallback identity", async () => {
		const host = new MemoryBootstrapHost();
		for (const target of FALLBACK) host.files.set(target, `confirmed ${target}`);
		const result = await bootstrapTalosVault({
			host,
			primaryPersonaPaths: PRIMARY,
			fallbackPersonaPaths: FALLBACK,
		});
		expect(result.skippedPrimaryForFallback).toBe(true);
		expect(PRIMARY.some((target) => host.files.has(target))).toBe(false);
		expect(result.created).toEqual([CANONICAL_REGISTRY_PATH]);
	});

	it("preserves blank or invalid existing files instead of overwriting user bytes", async () => {
		const host = new MemoryBootstrapHost();
		host.files.set(PRIMARY[0], "custom persona");
		host.files.set(PRIMARY[1], "   ");
		const result = await bootstrapTalosVault({
			host,
			primaryPersonaPaths: PRIMARY,
			fallbackPersonaPaths: FALLBACK,
		});
		expect(host.files.get(PRIMARY[0])).toBe("custom persona");
		expect(host.files.get(PRIMARY[1])).toBe("   ");
		expect(result.invalidExisting).toEqual([PRIMARY[1]]);
		await expect(loadQuyuanSoulContextWithFallback(
			host.asApp() as never,
			PRIMARY,
			FALLBACK,
		)).rejects.toThrow("屈原人格启动失败");
	});

	it("preserves an existing canonical registry and rejects path escapes", async () => {
		const host = new MemoryBootstrapHost();
		host.files.set(CANONICAL_REGISTRY_PATH, CANONICAL_REGISTRY_TEMPLATE);
		const result = await bootstrapTalosVault({
			host,
			primaryPersonaPaths: PRIMARY,
			fallbackPersonaPaths: FALLBACK,
		});
		expect(result.preserved).toContain(CANONICAL_REGISTRY_PATH);
		expect(host.files.get(CANONICAL_REGISTRY_PATH)).toBe(CANONICAL_REGISTRY_TEMPLATE);
		await expect(bootstrapTalosVault({
			host: new MemoryBootstrapHost(),
			primaryPersonaPaths: ["../escape.md", PRIMARY[1], PRIMARY[2]],
			fallbackPersonaPaths: FALLBACK,
		})).rejects.toThrow("越过 Vault 边界");
		await expect(bootstrapTalosVault({
			host: new MemoryBootstrapHost(),
			primaryPersonaPaths: ["C:\\escape.md", PRIMARY[1], PRIMARY[2]],
			fallbackPersonaPaths: FALLBACK,
		})).rejects.toThrow("Vault 相对路径");
	});
});

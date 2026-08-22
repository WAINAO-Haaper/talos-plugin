import { createHash } from "node:crypto";
import {
	cpSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderSecretStore } from "../src/ai/provider/provider-secret-store";
import type { LegacySecretSettings } from "../src/ai/provider/settings-migration";
import { migrateWp7Data } from "../src/migrations/wp7-migration";

const fixtureRoot = fileURLToPath(
	new URL("../fixtures/wp6-vault/", import.meta.url)
);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const configDir = ".wp6-config";
const pluginRoot = `${configDir}/plugins/talos`;
const customerModules = [
	"00 收件箱",
	"10 身份",
	"20 日志",
	"30 洞察",
	"40 素材",
	"50 项目",
	"60 工作流",
	"70 输出",
	"90 归档",
] as const;
const pluginFiles = [
	`${pluginRoot}/main.js`,
	`${pluginRoot}/manifest.json`,
	`${pluginRoot}/styles.css`,
	`${pluginRoot}/data.json`,
] as const;
const temporaryRoots: string[] = [];

type FixtureSettings = LegacySecretSettings & {
	engineProvider: string;
	jarvisTabsJson: string;
	quyuanVoiceSessionJson: string;
	jarvisVoiceEnabled: boolean;
	jarvisSttEngine: string;
	ttsEngine: string;
	vaultSchema: Record<string, string>;
};

class MemorySecrets {
	readonly values = new Map<string, string>();
	readonly operations: string[] = [];

	setSecret(id: string, value: string): void {
		this.operations.push(`set:${id}`);
		this.values.set(id, value);
	}

	getSecret(id: string): string | null {
		this.operations.push(`get:${id}`);
		return this.values.get(id) ?? null;
	}

	listSecrets(): string[] {
		return [...this.values.keys()];
	}
}

function read(path: string): string {
	return readFileSync(path, "utf8");
}

function writeJson(path: string, value: unknown): void {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function digestCustomerModules(vaultRoot: string): string {
	const hash = createHash("sha256");
	const visit = (directory: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
			(left, right) => left.name.localeCompare(right.name)
		)) {
			const absolute = join(directory, entry.name);
			if (entry.isDirectory()) {
				visit(absolute);
				continue;
			}
			const path = relative(vaultRoot, absolute).replaceAll("\\", "/");
			hash.update(path);
			hash.update("\0");
			hash.update(readFileSync(absolute));
			hash.update("\0");
		}
	};
	for (const module of customerModules) visit(join(vaultRoot, module));
	return hash.digest("hex");
}

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe("WP6 to WP7 upgrade and rollback preflight", () => {
	it("preserves settings and histories, migrates fake secrets, restores WP6, and leaves customer modules byte-identical", async () => {
		const vaultRoot = mkdtempSync(join(tmpdir(), "talos-wp7-upgrade-"));
		temporaryRoots.push(vaultRoot);
		cpSync(fixtureRoot, vaultRoot, { recursive: true });
		for (const filename of ["main.js", "styles.css", "data.json"]) {
			renameSync(
				join(vaultRoot, `${pluginRoot}/${filename}.fixture`),
				join(vaultRoot, `${pluginRoot}/${filename}`)
			);
		}

		const customerDigestBefore = digestCustomerModules(vaultRoot);
		const backups = new Map(
			pluginFiles.map((path) => [path, read(join(vaultRoot, path))])
		);
		const dataPath = join(vaultRoot, `${pluginRoot}/data.json`);
		const stored = JSON.parse(read(dataPath)) as Record<string, unknown> & {
			talos: FixtureSettings;
		};
		const secretAdapter = new MemorySecrets();
		const secretStore = new ProviderSecretStore(secretAdapter);

		const migrated = await migrateWp7Data({
			stored,
			settings: stored.talos,
			secretStore,
			persist(data) {
				writeJson(dataPath, data);
			},
		});

		writeFileSync(
			join(vaultRoot, `${pluginRoot}/main.js`),
			"/* synthetic WP7 candidate */\n",
			"utf8"
		);
		writeJson(join(vaultRoot, `${pluginRoot}/manifest.json`), {
			id: "talos",
			version: "2.0.0-rc.1",
			minAppVersion: "1.11.4",
		});
		writeFileSync(
			join(vaultRoot, `${pluginRoot}/styles.css`),
			"/* synthetic WP7 candidate */\n",
			"utf8"
		);

		expect(migrated.status).toBe("complete");
		expect(migrated.data).toMatchObject({
			claudian: {
				model: "claude-sonnet",
				locale: "zh-CN",
			},
			tabManagerState: {
				openTabs: [
					{ tabId: "wp6-tab", conversationId: "wp6-conversation" },
				],
				activeTabId: "wp6-tab",
			},
			talos: {
				engineProvider: "claude-api",
				jarvisTabsJson: '{"tabs":["wp6-text"]}',
				quyuanVoiceSessionJson:
					'{"version":1,"namespace":"voice","tabs":["wp6-voice"]}',
				jarvisVoiceEnabled: true,
				jarvisSttEngine: "webspeech",
				ttsEngine: "system",
				vaultSchema: {
					inbox: "00 收件箱",
					identity: "10 身份",
					output: "70 输出",
				},
				anthropicApiKey: "",
				providerSecretRefs: {
					anthropicApiKey: "talos-anthropic-api-key",
				},
			},
		});
		expect(JSON.stringify(migrated.data)).not.toContain(
			"fixture-anthropic-key"
		);
		expect(secretAdapter.operations).toEqual([
			"set:talos-anthropic-api-key",
			"get:talos-anthropic-api-key",
		]);
		expect(digestCustomerModules(vaultRoot)).toBe(customerDigestBefore);

		const mainSource = read(join(projectRoot, "src/main.ts"));
		expect(mainSource).toContain('id: "open-quyuan-v2"');
		// C-3b（D-TLP-016）：旧右侧栏 JarvisView 与 open-jarvis 回滚命令随旧引擎栈移除
		expect(mainSource).not.toContain('id: "open-jarvis"');
		expect(mainSource).toContain("VIEW_TYPE_CLAUDIAN");

		for (const [path, content] of backups) {
			writeFileSync(join(vaultRoot, path), content, "utf8");
		}

		for (const [path, content] of backups) {
			expect(read(join(vaultRoot, path))).toBe(content);
		}
		expect(
			JSON.parse(
				read(join(vaultRoot, `${pluginRoot}/manifest.json`))
			)
		).toMatchObject({ id: "talos", version: "0.4.0" });
		expect(read(join(vaultRoot, `${pluginRoot}/main.js`))).toContain(
			"open-quyuan-v2"
		);
		expect(digestCustomerModules(vaultRoot)).toBe(customerDigestBefore);
	});
});

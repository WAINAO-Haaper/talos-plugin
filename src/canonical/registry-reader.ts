import type { App } from "obsidian";

export const CANONICAL_REGISTRY_PATH =
	"TALOS中枢/适配器/runtime-command-registry.json";
const SUPPORTED_SCHEMA_VERSION = 1;
const TALOS_ASK_REQUEST_PATH =
	".talos/command-requests/talos-ask.json";
const REGISTRY_KEYS = new Set(["schema_version", "commands"]);
const COMMAND_KEYS = new Set([
	"id",
	"obsidian_command_id",
	"request_path",
	"summary",
	"engine_asset",
	"claude_wrapper",
]);

export interface CanonicalRegistryPersistence {
	read(path: string): string | Promise<string>;
}

export interface CanonicalCommandEntry {
	id: string;
	obsidianCommandId: string;
	requestPath: string;
	summary: string;
	engineAsset: string;
	claudeWrapper: string;
}

export interface CanonicalRegistry {
	schemaVersion: 1;
	commands: CanonicalCommandEntry[];
	talosAsk: CanonicalCommandEntry;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(
	value: Record<string, unknown>,
	allowed: ReadonlySet<string>,
	label: string
): void {
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) {
			throw new Error(`Canonical registry ${label} unknown field: ${key}`);
		}
	}
}

function requiredString(
	value: Record<string, unknown>,
	key: string,
	label: string
): string {
	const candidate = value[key];
	if (typeof candidate !== "string" || candidate.trim() === "") {
		throw new Error(`Canonical registry ${label} ${key} must be a string`);
	}
	return candidate;
}

function assertManagedRelativePath(path: string, label: string): void {
	const normalized = path.replace(/\\/g, "/");
	if (
		normalized.startsWith("/") ||
		normalized.startsWith("//") ||
		/^[a-zA-Z]:\//.test(normalized)
	) {
		throw new Error(`Canonical registry ${label} contains an absolute path`);
	}
	if (
		normalized.split("/").some((segment) => segment === "..")
	) {
		throw new Error(`Canonical registry ${label} contains a path escape`);
	}
	if (
		normalized.includes("\0") ||
		normalized.split("/").some((segment) => segment === "")
	) {
		throw new Error(`Canonical registry ${label} contains an invalid path`);
	}
}

function parseCommand(value: unknown, index: number): CanonicalCommandEntry {
	if (!isRecord(value)) {
		throw new Error(`Canonical registry command #${index + 1} must be an object`);
	}
	assertExactKeys(value, COMMAND_KEYS, `command #${index + 1}`);
	const id = requiredString(value, "id", `command #${index + 1}`);
	const obsidianCommandId = requiredString(
		value,
		"obsidian_command_id",
		`command ${id}`
	);
	const requestPath = requiredString(value, "request_path", `command ${id}`);
	const summary = requiredString(value, "summary", `command ${id}`);
	const engineAsset = requiredString(value, "engine_asset", `command ${id}`);
	const claudeWrapper = requiredString(
		value,
		"claude_wrapper",
		`command ${id}`
	);
	assertManagedRelativePath(requestPath, `${id}.request_path`);
	assertManagedRelativePath(engineAsset, `${id}.engine_asset`);
	assertManagedRelativePath(claudeWrapper, `${id}.claude_wrapper`);
	return {
		id,
		obsidianCommandId,
		requestPath,
		summary,
		engineAsset,
		claudeWrapper,
	};
}

export class CanonicalRegistryReader {
	constructor(private readonly persistence: CanonicalRegistryPersistence) {}

	async read(): Promise<CanonicalRegistry> {
		const raw = await this.persistence.read(CANONICAL_REGISTRY_PATH);
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			throw new Error("Canonical registry must be valid JSON");
		}
		if (!isRecord(parsed)) {
			throw new Error("Canonical registry must be an object");
		}
		assertExactKeys(parsed, REGISTRY_KEYS, "root");
		if (parsed.schema_version !== SUPPORTED_SCHEMA_VERSION) {
			throw new Error(
				`Canonical registry schema_version must be ${SUPPORTED_SCHEMA_VERSION}`
			);
		}
		if (!Array.isArray(parsed.commands)) {
			throw new Error("Canonical registry commands must be an array");
		}
		const commands = parsed.commands.map(parseCommand);
		const ids = new Set<string>();
		for (const command of commands) {
			if (ids.has(command.id)) {
				throw new Error(
					`Canonical registry duplicate command id: ${command.id}`
				);
			}
			ids.add(command.id);
		}
		const talosAsk = commands.find((command) => command.id === "talos-ask");
		if (!talosAsk) {
			throw new Error("Canonical registry must contain talos-ask");
		}
		if (talosAsk.obsidianCommandId !== "talos-ask") {
			throw new Error(
				"Canonical talos-ask obsidian command id must be talos-ask"
			);
		}
		if (talosAsk.requestPath !== TALOS_ASK_REQUEST_PATH) {
			throw new Error(
				`Canonical talos-ask canonical request path must be ${TALOS_ASK_REQUEST_PATH}`
			);
		}
		return {
			schemaVersion: SUPPORTED_SCHEMA_VERSION,
			commands,
			talosAsk,
		};
	}
}

export function createVaultCanonicalRegistryReader(
	app: App
): CanonicalRegistryReader {
	return new CanonicalRegistryReader({
		read: (path) => app.vault.adapter.read(path),
	});
}

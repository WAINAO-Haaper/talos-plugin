import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
import type { ActionRequest, ActionTarget } from "../contracts/approval";

export interface BoundaryTarget extends ActionTarget {
	canonical: string;
	insideVault: boolean;
	permanentlyDenied: boolean;
	reason?: string;
}

export interface BoundaryAssessment {
	targets: BoundaryTarget[];
	hasExternalTarget: boolean;
	hasPermanentDenial: boolean;
	bulkDestructive: boolean;
}

export interface CanonicalPathHost {
	realpath(candidate: string): Promise<string>;
	exists(candidate: string): Promise<boolean>;
	resolve(...parts: string[]): string;
	dirname(candidate: string): string;
	relative(from: string, to: string): string;
	isAbsolute(candidate: string): boolean;
	separator: string;
	caseSensitive: boolean;
}

export class NodeCanonicalPathHost implements CanonicalPathHost {
	readonly separator = path.sep;
	readonly caseSensitive = process.platform !== "darwin" && process.platform !== "win32";
	realpath(candidate: string) { return realpath(candidate); }
	async exists(candidate: string) { try { await lstat(candidate); return true; } catch { return false; } }
	resolve(...parts: string[]) { return path.resolve(...parts); }
	dirname(candidate: string) { return path.dirname(candidate); }
	relative(from: string, to: string) { return path.relative(from, to); }
	isAbsolute(candidate: string) { return path.isAbsolute(candidate); }
}

const PERMANENT_SEGMENTS = new Set([
	".talos/private", ".talos/secrets", ".git", "credentials", "secrets",
]);
const SECRET_FILE = /(?:^|\/)(?:\.env(?:\..*)?|credentials?(?:\..*)?|.*\.(?:pem|key|p12))$/i;
const PATH_ARG = /^(?:\.{0,2}[\\/]|~[\\/]|[A-Za-z]:[\\/]|\/)/;

function comparable(value: string, caseSensitive: boolean): string {
	const normalized = value.normalize("NFC");
	return caseSensitive ? normalized : normalized.toLocaleLowerCase("en-US");
}

export class VaultBoundary {
	private root: string | null = null;

	constructor(
		private readonly vaultRoot: string,
		private readonly paths: CanonicalPathHost = new NodeCanonicalPathHost(),
		private readonly bulkThreshold = 20,
		private readonly configDir?: string,
	) {}

	private async canonicalRoot(): Promise<string> {
		if (!this.root) this.root = await this.paths.realpath(this.vaultRoot);
		return this.root;
	}

	private async canonicalize(raw: string): Promise<string> {
		if (!raw || raw.includes("\0")) throw new Error("目标路径无效");
		const root = await this.canonicalRoot();
		const resolved = this.paths.resolve(this.paths.isAbsolute(raw) ? raw : this.paths.resolve(root, raw));
		let parent = resolved;
		const tail: string[] = [];
		while (!(await this.paths.exists(parent))) {
			const next = this.paths.dirname(parent);
			if (next === parent) throw new Error("无法解析目标路径");
			tail.unshift(this.paths.relative(next, parent));
			parent = next;
		}
		const realParent = await this.paths.realpath(parent);
		return this.paths.resolve(realParent, ...tail);
	}

	private inside(root: string, candidate: string): boolean {
		const relative = comparable(this.paths.relative(root, candidate), this.paths.caseSensitive);
		return relative === "" || (relative !== ".." && !relative.startsWith(`..${this.paths.separator}`) && !this.paths.isAbsolute(relative));
	}

	private permanent(relative: string): boolean {
		const portable = relative.split(this.paths.separator).join("/").normalize("NFC").toLocaleLowerCase("en-US");
		if (SECRET_FILE.test(portable)) return true;
		const segments = this.configDir ? [...PERMANENT_SEGMENTS, this.configDir.toLocaleLowerCase("en-US")] : [...PERMANENT_SEGMENTS];
		return segments.some((segment) => portable === segment || portable.startsWith(`${segment}/`));
	}

	async inspect(target: ActionTarget): Promise<BoundaryTarget> {
		const root = await this.canonicalRoot();
		const canonical = await this.canonicalize(target.raw);
		const insideVault = this.inside(root, canonical);
		const relative = insideVault ? this.paths.relative(root, canonical) : "";
		const permanentlyDenied = insideVault && this.permanent(relative);
		return {
			...target,
			canonical,
			insideVault,
			permanentlyDenied,
			reason: permanentlyDenied ? "目标属于永久禁区" : undefined,
		};
	}

	async assess(request: ActionRequest): Promise<BoundaryAssessment> {
		const targets = [...request.targets];
		if (request.command) {
			targets.push({ raw: request.command.cwd, role: "source" });
			for (const arg of request.command.args.filter((value) => PATH_ARG.test(value))) {
				targets.push({ raw: arg, role: "source" });
			}
		}
		const inspected = await Promise.all(targets.map((target) => this.inspect(target)));
		return {
			targets: inspected,
			hasExternalTarget: inspected.some((target) => !target.insideVault),
			hasPermanentDenial: inspected.some((target) => target.permanentlyDenied),
			bulkDestructive: request.destructive && inspected.length >= this.bulkThreshold,
		};
	}
}

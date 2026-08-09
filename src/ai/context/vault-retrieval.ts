import {
	inspectVaultContent,
	inspectVaultPath,
	type SecretBlockReason,
} from "./secret-policy";

export interface VaultDocumentPort {
	listPaths(): Promise<string[]>;
	read(path: string): Promise<string>;
}

export type RetrievalSource =
	| "attachment"
	| "current"
	| "engine"
	| "keyword"
	| "recent-confirmed";

export interface RetrievalHit {
	path: string;
	excerpt: string;
	truncated: boolean;
	source: RetrievalSource;
	score: number;
	reasons: string[];
}

export interface BlockedRetrieval {
	path: string;
	reasons: SecretBlockReason[];
}

export interface VaultRetrievalInput {
	query: string;
	attachmentPaths?: string[];
	currentPath?: string;
	engineResultPaths?: string[];
	recentConfirmedPaths?: string[];
}

export interface VaultRetrievalResult {
	hits: RetrievalHit[];
	blocked: BlockedRetrieval[];
}

export interface VaultRetrieverOptions {
	maxExcerptChars?: number;
	maxHits?: number;
	configDir?: string;
}

interface Candidate {
	path: string;
	source: RetrievalSource;
	priority: number;
	order: number;
	reasons: Set<string>;
}

const SOURCE_PRIORITY: Record<RetrievalSource, number> = {
	attachment: 500,
	current: 400,
	engine: 300,
	keyword: 200,
	"recent-confirmed": 100,
};

function queryTerms(query: string): string[] {
	return [
		...new Set(
			query
				.toLowerCase()
				.split(/[\s,，。！？!?；;：:、()[\]{}"'`]+/)
				.map((term) => term.trim())
				.filter(Boolean)
		),
	];
}

function matchesQuery(path: string, content: string, terms: string[]): boolean {
	if (terms.length === 0) return false;
	const haystack = `${path}\n${content}`.toLowerCase();
	return terms.every((term) => haystack.includes(term));
}

function contextReasons(path: string): string[] {
	const lower = path.toLowerCase();
	const reasons: string[] = [];
	if (lower.includes("候选") || lower.includes("candidate")) {
		reasons.push("candidate-context");
	}
	if (lower.includes("推断") || lower.includes("inferred")) {
		reasons.push("inferred-context");
	}
	return reasons;
}

export class VaultRetriever {
	private readonly maxExcerptChars: number;
	private readonly maxHits: number;
	private readonly configDir?: string;

	constructor(
		private readonly vault: VaultDocumentPort,
		options: VaultRetrieverOptions = {}
	) {
		this.maxExcerptChars = Math.max(1, options.maxExcerptChars ?? 6000);
		this.maxHits = Math.max(1, options.maxHits ?? 80);
		this.configDir = options.configDir;
	}

	async retrieve(input: VaultRetrievalInput): Promise<VaultRetrievalResult> {
		const listed = [...new Set(await this.vault.listPaths())].sort((a, b) =>
			a.localeCompare(b)
		);
		const allPaths = new Set(listed);
		for (const path of [
			...(input.attachmentPaths ?? []),
			input.currentPath,
			...(input.engineResultPaths ?? []),
			...(input.recentConfirmedPaths ?? []),
		]) {
			if (path) allPaths.add(path);
		}

		const blocked: BlockedRetrieval[] = [];
		const readable = new Map<string, string>();
		for (const path of [...allPaths].sort((a, b) => a.localeCompare(b))) {
			const pathInspection = inspectVaultPath(path, {
				configDir: this.configDir,
			});
			if (pathInspection.blocked) {
				blocked.push({
					path,
					reasons: pathInspection.reasons,
				});
				continue;
			}
			const content = await this.vault.read(path);
			const contentInspection = inspectVaultContent(path, content, {
				configDir: this.configDir,
			});
			if (contentInspection.blocked) {
				blocked.push({
					path,
					reasons: contentInspection.reasons,
				});
				continue;
			}
			readable.set(path, content);
		}

		const candidates = new Map<string, Candidate>();
		let order = 0;
		const add = (
			path: string | undefined,
			source: RetrievalSource,
			reason: string
		): void => {
			if (!path || !readable.has(path)) return;
			const existing = candidates.get(path);
			if (existing) {
				existing.reasons.add(reason);
				return;
			}
			candidates.set(path, {
				path,
				source,
				priority: SOURCE_PRIORITY[source],
				order: order++,
				reasons: new Set([reason, ...contextReasons(path)]),
			});
		};

		for (const path of input.attachmentPaths ?? []) {
			add(path, "attachment", "explicit-attachment");
		}
		add(input.currentPath, "current", "current-note");
		for (const path of input.engineResultPaths ?? []) {
			add(path, "engine", "engine-result");
		}

		const terms = queryTerms(input.query);
		for (const path of listed) {
			const content = readable.get(path);
			if (content !== undefined && matchesQuery(path, content, terms)) {
				add(path, "keyword", "keyword-match");
			}
		}
		for (const path of input.recentConfirmedPaths ?? []) {
			add(path, "recent-confirmed", "recent-confirmed");
		}

		const hits = [...candidates.values()]
			.sort(
				(left, right) =>
					right.priority - left.priority ||
					left.order - right.order ||
					left.path.localeCompare(right.path)
			)
			.slice(0, this.maxHits)
			.map((candidate, index): RetrievalHit => {
				const content = readable.get(candidate.path) ?? "";
				return {
					path: candidate.path,
					excerpt: content.slice(0, this.maxExcerptChars),
					truncated: content.length > this.maxExcerptChars,
					source: candidate.source,
					score: candidate.priority - index,
					reasons: [...candidate.reasons],
				};
			});
		return { hits, blocked };
	}
}

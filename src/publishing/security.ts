import { inspectVaultContent } from "../ai/context/secret-policy";
import type { ArticleInput } from "./types";

export class PublishingCheckError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PublishingCheckError";
	}
}

/** This is a credential check for explicit publication, not model-prompt policy. */
export function assertPublishingContentSafe(input: Pick<ArticleInput, "sourcePath" | "title" | "markdown" | "digest" | "author">): void {
	const text = [input.title, input.markdown, input.digest, input.author].join("\n");
	const inspection = inspectVaultContent(input.sourcePath, text);
	if (inspection.blocked || /\b(?:appsecret|access_token|api[_-]?key|password)\s*[:=]\s*["']?[^\s"']{12,}/i.test(text)) {
		throw new PublishingCheckError("待发送内容或来源含凭据或受保护内容，请先移除后重新预览。");
	}
}

/** Never persist arbitrary transport errors: they can contain credential URLs. */
export function publishingErrorMessage(error: unknown, fallback: string): string {
	return error instanceof PublishingCheckError ? error.message : fallback;
}

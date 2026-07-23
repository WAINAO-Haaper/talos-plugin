import type {
	RiskDecision,
	TalosActionDefinition,
	TalosActionRequest,
} from "./types";

const HIGH_RISK_EFFECTS = new Set([
	"delete",
	"move",
	"external-publish",
	"shell",
]);

function normalizePath(path: string): string {
	return path
		.trim()
		.replace(/\\/g, "/")
		.replace(/^\.\//, "")
		.replace(/^\/+/, "")
		.replace(/\/+/g, "/");
}

function matchesScope(path: string, scope: string): boolean {
	const normalizedPath = normalizePath(path);
	const normalizedScope = normalizePath(scope);
	if (normalizedScope === "**") return true;
	if (normalizedScope.endsWith("/**")) {
		const base = normalizedScope.slice(0, -3);
		return normalizedPath === base || normalizedPath.startsWith(`${base}/`);
	}
	return normalizedPath === normalizedScope;
}

function outsideScope(paths: string[], scopes: string[]): string | undefined {
	return paths.find((path) => !scopes.some((scope) => matchesScope(path, scope)));
}

export function evaluateActionRisk(
	definition: TalosActionDefinition,
	request: TalosActionRequest
): RiskDecision {
	if (definition.risk === "C") {
		return { decision: "propose", reason: "C 类动作必须先展示提案" };
	}

	if (
		request.touchesIdentity ||
		request.touchesTopLevelStructure ||
		request.effects.some((effect) => HIGH_RISK_EFFECTS.has(effect))
	) {
		return {
			decision: "propose",
			reason: "请求包含身份、顶层结构或其他高风险影响",
		};
	}

	const unexpectedRead = outsideScope(request.readPaths, definition.readScope);
	if (unexpectedRead) {
		return {
			decision: "propose",
			reason: `读取路径超出动作声明范围：${unexpectedRead}`,
		};
	}

	const unexpectedWrite = outsideScope(
		request.writePaths,
		definition.writeScope
	);
	if (unexpectedWrite) {
		return {
			decision: "propose",
			reason: `写入路径超出动作声明范围：${unexpectedWrite}`,
		};
	}

	if (
		definition.risk === "A" &&
		(request.writePaths.length > 0 ||
			request.effects.some((effect) => effect !== "read"))
	) {
		return {
			decision: "propose",
			reason: "A 类只读动作请求了写入或外部影响",
		};
	}

	if (definition.risk === "B") {
		return {
			decision: "snapshot-and-run",
			reason: "B 类动作范围固定且可恢复，点击即构成本次授权",
		};
	}

	return { decision: "allow", reason: "A 类只读操作可直接执行" };
}

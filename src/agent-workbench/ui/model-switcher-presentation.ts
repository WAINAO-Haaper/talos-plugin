import type { ModelDescriptor, RuntimeId } from "../contracts/runtime-adapter";

export interface ModelSwitchPresentation {
	label: string;
	kicker: string;
	description: string;
	badge?: string;
}

const CLAUDE_LABELS: Record<string, string> = {
	sonnet: "Sonnet",
	opus: "Opus",
	haiku: "Haiku",
	fable: "Fable",
};

function claudePresentation(model: ModelDescriptor): ModelSwitchPresentation {
	const normalized = model.id.toLowerCase();
	const alias = Object.keys(CLAUDE_LABELS).find((candidate) => normalized.includes(candidate));
	const label = alias && normalized === alias ? CLAUDE_LABELS[alias] : model.label;
	if (alias === "sonnet") return { label, kicker: "均衡", description: "日常编程、工具调用与复杂任务", badge: "推荐" };
	if (alias === "opus") return { label, kicker: "深度", description: "高难度推理、大型改造与长任务" };
	if (alias === "haiku") return { label, kicker: "快速", description: "低延迟、轻量修改与高频问答" };
	if (alias === "fable") return { label, kicker: "新模型", description: "Claude Code 官方别名，是否可用取决于当前账号" };
	return { label, kicker: "Claude", description: "由当前 Claude Code 配置提供" };
}

function codexPresentation(model: ModelDescriptor): ModelSwitchPresentation {
	const normalized = model.id.toLowerCase();
	if (normalized === "gpt-5.6" || normalized.includes("gpt-5.6-sol")) {
		return { label: model.label, kicker: "旗舰", description: "复杂推理、编程与专业工作", badge: "推荐" };
	}
	if (normalized.includes("gpt-5.6-terra")) {
		return { label: model.label, kicker: "均衡", description: "智能、速度与成本之间取得平衡" };
	}
	if (normalized.includes("gpt-5.6-luna")) {
		return { label: model.label, kicker: "高效", description: "低成本、高吞吐与轻量任务" };
	}
	if (normalized.includes("gpt-5.5")) {
		return { label: model.label, kicker: "经典", description: "复杂专业工作与工具型任务" };
	}
	if (normalized.includes("gpt-5.2")) {
		return { label: model.label, kicker: "兼容", description: "旧会话与既有工作流兼容" };
	}
	return { label: model.label, kicker: "Codex", description: "由当前 Codex 运行时提供" };
}

export function presentRuntimeModel(runtimeId: RuntimeId, model: ModelDescriptor): ModelSwitchPresentation {
	if (runtimeId === "claude") return claudePresentation(model);
	if (runtimeId === "codex") return codexPresentation(model);
	return { label: model.label, kicker: "OhMyPi", description: model.providerProfileId ? `来自 ${model.providerProfileId}` : "由当前运行时提供" };
}

export function automaticModelPresentation(runtimeId: RuntimeId): ModelSwitchPresentation {
	const runtime = runtimeId === "claude" ? "Claude Code" : runtimeId === "codex" ? "Codex" : "OhMyPi";
	return {
		label: "自动选择",
		kicker: "终端默认",
		description: `跟随 ${runtime} 当前配置，不覆盖原生默认模型`,
	};
}

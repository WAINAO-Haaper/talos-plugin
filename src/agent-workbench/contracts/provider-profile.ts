import type { RuntimeId } from "./runtime-adapter";

export type ProviderProtocol =
	| "anthropic-agent"
	| "openai-responses"
	| "openai-chat"
	| "ohmypi-native";

export interface RuntimeProfile {
	id: string;
	runtimeId: RuntimeId;
	executablePath?: string;
	args?: string[];
}

export interface ProviderProfile {
	id: string;
	displayName: string;
	runtimeId: RuntimeId;
	protocol: ProviderProtocol;
	endpoint?: string;
	models: string[];
	headerNames?: string[];
	secretRef?: string;
	enabled: boolean;
}

export function validateProviderProfile(profile: ProviderProfile): ProviderProfile {
	if (!/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(profile.id)) {
		throw new Error("Provider profile id 无效");
	}
	if (profile.endpoint) {
		const url = new URL(profile.endpoint);
		if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
			throw new Error("Provider endpoint 必须使用 HTTPS 或 loopback");
		}
		profile = { ...profile, endpoint: url.toString().replace(/\/$/, "") };
	}
	if (profile.runtimeId === "codex" && profile.protocol !== "openai-responses") {
		throw new Error("Codex 自定义 Provider 必须兼容 OpenAI Responses");
	}
	if (profile.runtimeId === "claude" && profile.protocol !== "anthropic-agent") {
		throw new Error("Claude runtime 必须使用 anthropic-agent 协议");
	}
	if (profile.runtimeId === "ohmypi" && !["ohmypi-native", "openai-chat", "openai-responses", "anthropic-agent"].includes(profile.protocol)) {
		throw new Error("OhMyPi Provider 协议不兼容");
	}
	return profile;
}

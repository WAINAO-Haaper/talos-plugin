import type { RuntimeId, RuntimeProbe } from "../contracts/runtime-adapter";

export interface RuntimeInstallCardModel {
	runtimeId: RuntimeId;
	title: string;
	status: RuntimeProbe["status"];
	detail: string;
	installUrl?: string;
	canRetry: boolean;
}

const LABEL: Record<RuntimeId, string> = { claude: "Claude", codex: "Codex", ohmypi: "OhMyPi" };

export function runtimeInstallCard(probe: RuntimeProbe, installUrl: string): RuntimeInstallCardModel {
	const unavailable = ["not-installed", "incompatible"].includes(probe.status);
	return {
		runtimeId: probe.runtimeId,
		title: `${LABEL[probe.runtimeId]} 运行时`,
		status: probe.status,
		detail: probe.reason ?? (probe.version ? `版本 ${probe.version}` : "等待检测"),
		installUrl: unavailable ? installUrl : undefined,
		canRetry: probe.status !== "probing",
	};
}

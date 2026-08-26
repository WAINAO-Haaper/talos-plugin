import type { RuntimeHealth, RuntimeId, RuntimeProbe } from "../contracts/runtime-adapter";
import type { RuntimeProfile } from "../contracts/provider-profile";

export interface ProbeCommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export type ProtocolHandshake = "ready" | "unauthenticated" | "degraded";

export interface RuntimeProbeHost {
	resolve(candidates: string[]): Promise<string | null>;
	run(executable: string, args: string[], timeoutMs: number): Promise<ProbeCommandResult>;
	handshake(runtimeId: RuntimeId, executable: string, timeoutMs: number): Promise<ProtocolHandshake>;
}

interface RuntimeSpecification {
	command: string;
	fixedPaths: string[];
	versionArgs: string[];
	minimum: [number, number, number];
	installUrl: string;
}

const SPECIFICATIONS: Record<RuntimeId, RuntimeSpecification> = {
	claude: {
		command: "claude", fixedPaths: ["/opt/homebrew/bin/claude", "/usr/local/bin/claude"],
		versionArgs: ["--version"], minimum: [1, 0, 0], installUrl: "https://docs.anthropic.com/en/docs/claude-code/setup",
	},
	codex: {
		command: "codex", fixedPaths: ["/opt/homebrew/bin/codex", "/usr/local/bin/codex"],
		versionArgs: ["--version"], minimum: [0, 122, 0], installUrl: "https://developers.openai.com/codex/cli",
	},
	ohmypi: {
		command: "omp", fixedPaths: ["/opt/homebrew/bin/omp", "/usr/local/bin/omp"],
		versionArgs: ["--version"], minimum: [0, 1, 0], installUrl: "https://github.com/can1357/oh-my-pi",
	},
};

function parseVersion(value: string): [number, number, number] | null {
	const match = value.match(/(?:^|[\s/v])(\d+)\.(\d+)(?:\.(\d+))?/i);
	return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : null;
}

function atLeast(actual: [number, number, number], minimum: [number, number, number]): boolean {
	for (let index = 0; index < 3; index += 1) {
		if (actual[index] > minimum[index]) return true;
		if (actual[index] < minimum[index]) return false;
	}
	return true;
}

export class RuntimeDiscoveryService {
	constructor(private readonly host: RuntimeProbeHost, private readonly timeoutMs = 4_000) {}

	installUrl(runtimeId: RuntimeId): string { return SPECIFICATIONS[runtimeId].installUrl; }

	async probe(runtimeId: RuntimeId, profile?: RuntimeProfile): Promise<RuntimeProbe> {
		const specification = SPECIFICATIONS[runtimeId];
		const candidates = [profile?.executablePath, specification.command, ...specification.fixedPaths].filter((item): item is string => Boolean(item));
		const executable = await this.host.resolve(candidates);
		if (!executable) return { runtimeId, status: "not-installed", reason: "未找到可执行文件" };
		let versionResult: ProbeCommandResult;
		try {
			versionResult = await this.host.run(executable, specification.versionArgs, this.timeoutMs);
		} catch (error) {
			return { runtimeId, status: "crashed", executable, reason: error instanceof Error ? error.message : "版本探测失败" };
		}
		if (versionResult.exitCode !== 0) return { runtimeId, status: "degraded", executable, reason: "版本命令失败" };
		const versionTuple = parseVersion(`${versionResult.stdout}\n${versionResult.stderr}`);
		if (!versionTuple) return { runtimeId, status: "degraded", executable, reason: "无法解析版本" };
		const version = versionTuple.join(".");
		if (!atLeast(versionTuple, specification.minimum)) {
			return { runtimeId, status: "incompatible", executable, version, reason: `最低版本 ${specification.minimum.join(".")}` };
		}
		let handshake: ProtocolHandshake;
		try {
			handshake = await this.host.handshake(runtimeId, executable, this.timeoutMs);
		} catch (error) {
			return { runtimeId, status: "degraded", executable, version, reason: error instanceof Error ? error.message : "协议握手失败" };
		}
		const status: RuntimeHealth = handshake === "ready" ? "ready" : handshake;
		return { runtimeId, status, executable, version, reason: status === "unauthenticated" ? "运行时未认证" : status === "degraded" ? "协议握手降级" : undefined };
	}
}

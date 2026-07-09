import type { App } from "obsidian";
import {
	checkQuyuanCapabilityContract,
	type QuyuanContractResult,
} from "./contract";
import {
	evaluateQuyuanGovernance,
	type QuyuanGovernanceResult,
	type QuyuanToolRequest,
} from "./governance";
import {
	loadQuyuanSoulContext,
	type QuyuanSoulContext,
} from "./persona-context";
import {
	snapshotAdapterCapabilities,
	type QuyuanWorkbenchAdapter,
} from "./workbench-adapter";

export class QuyuanModule {
	private soul: QuyuanSoulContext | null = null;

	constructor(
		private readonly app: App,
		private readonly workbench: QuyuanWorkbenchAdapter
	) {}

	async initialize(): Promise<void> {
		this.soul = await loadQuyuanSoulContext(this.app);
		await this.workbench.start();
	}

	isSoulReady(): boolean {
		return this.soul !== null;
	}

	getSoulContext(): QuyuanSoulContext {
		if (!this.soul) throw new Error("屈原人格尚未完成启动");
		return this.soul;
	}

	checkCapabilities(): QuyuanContractResult {
		return checkQuyuanCapabilityContract(
			snapshotAdapterCapabilities(this.workbench)
		);
	}

	evaluateTool(request: QuyuanToolRequest): QuyuanGovernanceResult {
		return evaluateQuyuanGovernance(request);
	}

	dispose(): void {
		this.workbench.dispose();
		this.soul = null;
	}
}


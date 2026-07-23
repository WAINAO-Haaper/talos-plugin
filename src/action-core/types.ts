export type TalosActionRisk = "A" | "B" | "C";

export type TalosActionEffect =
	| "read"
	| "write"
	| "delete"
	| "move"
	| "external-publish"
	| "shell";

export interface TalosActionContext {
	signal: AbortSignal;
	taskId: string;
	providerId?: string;
}

export interface TalosActionDefinition<Input = unknown, Output = unknown> {
	id: string;
	label: string;
	description: string;
	risk: TalosActionRisk;
	readScope: string[];
	writeScope: string[];
	timeoutMs: number;
	cancelable: boolean;
	reversible: boolean;
	execute(context: TalosActionContext, input: Input): Promise<Output>;
}

export interface TalosActionRequest {
	readPaths: string[];
	writePaths: string[];
	effects: TalosActionEffect[];
	touchesIdentity?: boolean;
	touchesTopLevelStructure?: boolean;
}

export interface RiskDecision {
	decision: "allow" | "snapshot-and-run" | "propose";
	reason: string;
}

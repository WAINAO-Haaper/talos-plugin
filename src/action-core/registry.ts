import type { TalosActionDefinition } from "./types";

function requiredText(value: string, label: string): void {
	if (!value.trim()) throw new Error(`${label}不能为空`);
}

export function validateActionDefinition(
	definition: TalosActionDefinition
): void {
	requiredText(definition.id, "动作 ID");
	requiredText(definition.label, "动作名称");
	requiredText(definition.description, "动作说明");

	if (!Number.isFinite(definition.timeoutMs) || definition.timeoutMs <= 0) {
		throw new Error("动作超时必须是正数");
	}
	if (definition.risk === "A" && definition.writeScope.length > 0) {
		throw new Error("A 类动作不能声明写入范围");
	}
	if (definition.risk === "B") {
		if (!definition.reversible) throw new Error("B 类动作必须可恢复");
		if (definition.writeScope.length === 0) {
			throw new Error("B 类动作必须声明写入范围");
		}
	}
	if (definition.risk === "C" && definition.writeScope.length === 0) {
		throw new Error("C 类动作必须声明影响范围");
	}
	if (typeof definition.execute !== "function") {
		throw new Error("动作必须提供执行器");
	}
}

export class TalosActionRegistry {
	private readonly definitions = new Map<string, TalosActionDefinition>();

	constructor(initial: TalosActionDefinition[] = []) {
		for (const definition of initial) this.register(definition);
	}

	register(definition: TalosActionDefinition): void {
		validateActionDefinition(definition);
		if (this.definitions.has(definition.id)) {
			throw new Error(`重复动作 ID：${definition.id}`);
		}
		this.definitions.set(definition.id, definition);
	}

	get(id: string): TalosActionDefinition | undefined {
		return this.definitions.get(id);
	}

	list(): readonly TalosActionDefinition[] {
		return Object.freeze(Array.from(this.definitions.values()));
	}
}

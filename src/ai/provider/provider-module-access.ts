import type { TalosSchemaKey } from "../../data/schema";

export type ProviderModuleAccessMatrix = Record<
	string,
	Partial<Record<TalosSchemaKey, boolean>>
>;

export function isProviderModuleAllowed(
	matrix: ProviderModuleAccessMatrix,
	providerId: string,
	module: TalosSchemaKey
): boolean {
	return matrix[providerId]?.[module] !== false;
}

export function setProviderModuleAllowed(
	matrix: ProviderModuleAccessMatrix,
	providerId: string,
	module: TalosSchemaKey,
	allowed: boolean
): ProviderModuleAccessMatrix {
	return {
		...matrix,
		[providerId]: {
			...(matrix[providerId] ?? {}),
			[module]: allowed,
		},
	};
}

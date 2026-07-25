export function createConstructorIsolatedProxy<T extends object>(
	host: T,
	overrides: Record<PropertyKey, unknown> = {}
): T {
	const writes = new Map<PropertyKey, unknown>(Reflect.ownKeys(overrides).map(
		(property) => [property, overrides[property]]
	));
	return new Proxy(host, {
		get(target, property): unknown {
			if (writes.has(property)) return writes.get(property);
			const value: unknown = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
		set(_target, property, value) {
			writes.set(property, value);
			return true;
		},
		defineProperty(_target, property, descriptor) {
			if ("value" in descriptor) writes.set(property, descriptor.value);
			return true;
		},
		deleteProperty(_target, property) {
			writes.delete(property);
			return true;
		},
	});
}

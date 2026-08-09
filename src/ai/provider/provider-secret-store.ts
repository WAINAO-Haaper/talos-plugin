export interface SecretStoragePort {
	setSecret(id: string, secret: string): void;
	getSecret(id: string): string | null;
	listSecrets(): string[];
}

export interface ProviderSecretReference {
	secretRef: string;
}

const SECRET_ID = /^[a-z0-9][a-z0-9-]*$/;

export class ProviderSecretStore {
	constructor(private readonly storage: SecretStoragePort) {}

	set(id: string, value: string): void {
		this.assertId(id);
		if (!value) throw new Error(`Secret "${id}" cannot be empty`);
		this.storage.setSecret(id, value);
	}

	get(id: string): string | null {
		this.assertId(id);
		return this.storage.getSecret(id);
	}

	has(id: string): boolean {
		this.assertId(id);
		return this.storage.listSecrets().includes(id);
	}

	reference(id: string): ProviderSecretReference {
		this.assertId(id);
		return { secretRef: id };
	}

	private assertId(id: string): void {
		if (!SECRET_ID.test(id)) {
			throw new Error(`Invalid SecretStorage id: ${id}`);
		}
	}
}

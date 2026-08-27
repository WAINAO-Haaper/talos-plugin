import type { ActionKind } from "../contracts/approval";

export interface ExternalAccessGrant {
	id: string;
	type: "path" | "host";
	value: string;
	direction: Extract<ActionKind, "read" | "write" | "export" | "network">;
	actionId: string;
	lifetime: "once" | "conversation";
	conversationId?: string;
}

export class ExternalAccessGrantStore {
	private readonly grants = new Map<string, ExternalAccessGrant>();
	add(grant: ExternalAccessGrant): void { this.grants.set(grant.id, grant); }
	revoke(id: string): void { this.grants.delete(id); }
	clearConversation(conversationId: string): void {
		for (const [id, grant] of this.grants) if (grant.conversationId === conversationId) this.grants.delete(id);
	}
	consume(input: { type: "path" | "host"; value: string; direction: ExternalAccessGrant["direction"]; actionId: string; conversationId?: string }): ExternalAccessGrant | undefined {
		const grant = [...this.grants.values()].find((candidate) => candidate.type === input.type
			&& candidate.value === input.value && candidate.direction === input.direction
			&& (candidate.lifetime === "once"
				? candidate.actionId === input.actionId
				: candidate.conversationId === input.conversationId));
		if (grant?.lifetime === "once") this.grants.delete(grant.id);
		return grant;
	}
}

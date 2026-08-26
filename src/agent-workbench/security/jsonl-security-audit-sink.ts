import path from "node:path";
import { appendFile, mkdir } from "node:fs/promises";
import type { SecurityAuditRecord, SecurityAuditSink } from "./security-audit";

export class JsonlSecurityAuditSink implements SecurityAuditSink {
	constructor(private readonly vaultRoot: string) {}
	async append(record: SecurityAuditRecord): Promise<void> {
		const directory = path.join(this.vaultRoot, ".talos", "agent-workbench", "v1");
		await mkdir(directory, { recursive: true });
		await appendFile(path.join(directory, "security-audit.jsonl"), `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
	}
}

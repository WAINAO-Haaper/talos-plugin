import { Modal, requestUrl } from "obsidian";
import { createRequestUrlFetch } from "../ai/provider/request-url-fetch";

export const QUYUAN_RUNTIME_ERROR_LIMIT = 24;
export const TRUSTED_PROVIDER_FETCH = createRequestUrlFetch((input) => requestUrl(input));

export type QuyuanRuntimeErrorRecord = {
	at: string;
	scope: string;
	message: string;
	stack: string;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

export function formatError(error: unknown): { message: string; stack: string } {
	if (error instanceof Error) {
		return {
			message: error.message || error.name || "Unknown Error",
			stack: error.stack || "",
		};
	}
	if (typeof error === "string") return { message: error, stack: "" };
	try {
		return { message: JSON.stringify(error), stack: "" };
	} catch {
		return { message: String(error), stack: "" };
	}
}

export function timestampForPath(date = new Date()): string {
	const pad = (value: number): string => String(value).padStart(2, "0");
	return [
		date.getFullYear(),
		pad(date.getMonth() + 1),
		pad(date.getDate()),
		"-",
		pad(date.getHours()),
		pad(date.getMinutes()),
		pad(date.getSeconds()),
	].join("");
}

export class TalosAskPromptModal extends Modal {
	private resolveResult: ((value: string | null) => void) | null = null;
	private settled = false;

	openAndWait(): Promise<string | null> {
		this.open();
		return new Promise((resolve) => {
			this.resolveResult = resolve;
		});
	}

	onOpen(): void {
		this.titleEl.setText("TALOS 全库问答");
		const textarea = this.contentEl.createEl("textarea", {
			attr: {
				rows: "6",
				placeholder: "输入要向当前 Vault 提问的内容",
			},
		});
		textarea.setCssProps({ width: "100%" });
		const actions = this.contentEl.createDiv({ cls: "modal-button-container" });
		const cancel = actions.createEl("button", { text: "取消" });
		const submit = actions.createEl("button", {
			text: "提问",
			cls: "mod-cta",
		});
		const finish = (value: string | null): void => {
			if (this.settled) return;
			this.settled = true;
			this.resolveResult?.(value);
			this.close();
		};
		cancel.addEventListener("click", () => finish(null));
		submit.addEventListener("click", () => {
			const query = textarea.value.trim();
			if (query) finish(query);
		});
		textarea.addEventListener("keydown", (event) => {
			if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				const query = textarea.value.trim();
				if (query) finish(query);
			}
		});
		textarea.focus();
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.settled) {
			this.settled = true;
			this.resolveResult?.(null);
		}
	}
}

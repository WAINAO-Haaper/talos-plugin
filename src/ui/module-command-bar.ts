export interface ModuleCommandEntry {
	id: string;
	label: string;
	description: string;
	disabled?: boolean;
	disabledReason?: string;
}

export interface ModuleCommandBar {
	unmount(): void;
}

export function renderModuleCommandBar(
	parent: HTMLElement,
	entries: readonly ModuleCommandEntry[],
	onInvoke: (id: string) => void | Promise<unknown>
): ModuleCommandBar {
	const document = parent.ownerDocument;
	const root = document.createElement("section");
	root.className = "panel talos-ui-panel talos-module-command-bar";
	root.setAttribute("aria-label", "模块操作");
	const actions = document.createElement("div");
	actions.className = "module-hero-actions talos-ui-page-header__actions";
	root.appendChild(actions);
	const status = document.createElement("p");
	status.className = "talos-module-command-status";
	status.setAttribute("role", "status");
	status.setAttribute("aria-live", "polite");
	status.setAttribute("aria-atomic", "true");
	root.appendChild(status);
	parent.appendChild(root);

	let mounted = true;
	let pending = false;
	const controls: Array<{
		button: HTMLButtonElement;
		disabled: boolean;
		onClick: (event: MouseEvent) => void;
	}> = [];

	const updateDisabled = () => {
		for (const control of controls) {
			control.button.disabled = pending || control.disabled;
		}
	};

	const invoke = async (entry: ModuleCommandEntry): Promise<void> => {
		if (!mounted || pending || entry.disabled) return;
		pending = true;
		updateDisabled();
		root.setAttribute("aria-busy", "true");
		status.textContent = `正在处理：${entry.label}…`;
		try {
			await onInvoke(entry.id);
			if (mounted) status.textContent = "";
		} catch (error) {
			if (mounted) {
				const message = error instanceof Error
					? error.message
					: typeof error === "string" ? error : "请重试。";
				status.textContent = `${entry.label}未完成：${message}`;
			}
		} finally {
			if (mounted) {
				pending = false;
				updateDisabled();
				root.removeAttribute("aria-busy");
			}
		}
	};

	for (const input of entries) {
		const entry = { ...input };
		const button = document.createElement("button");
		button.type = "button";
		button.className = "module-hero-action talos-ui-page-header__action";
		button.setAttribute("data-module-command", entry.id);
		const description = [
			entry.description,
			entry.disabled ? entry.disabledReason : undefined,
		].filter(Boolean).join("；");
		button.setAttribute("title", description);
		button.setAttribute("aria-label", `${entry.label}：${description}`);
		const label = document.createElement("span");
		label.textContent = entry.label;
		button.appendChild(label);
		if (entry.disabled && entry.disabledReason) {
			const reason = document.createElement("small");
			reason.textContent = entry.disabledReason;
			button.appendChild(reason);
		}
		const onClick = (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			void invoke(entry);
		};
		button.addEventListener("click", onClick);
		controls.push({ button, disabled: entry.disabled === true, onClick });
		actions.appendChild(button);
	}
	updateDisabled();

	return {
		unmount() {
			if (!mounted) return;
			mounted = false;
			for (const control of controls) {
				control.button.removeEventListener("click", control.onClick);
			}
			root.remove();
		},
	};
}

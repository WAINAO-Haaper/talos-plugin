// 页面缺失提示：本页依赖的数据文件缺失或缺少插件需要的分区时，在页头下方给一条单行说明，
// 带「补齐库结构」与「文件位置」两个入口。全部就位时不渲染，不占页面高度。
import { VAULT_FILE_SPECS, type AnyFileKey, type FileStatus } from "../data/vault-files";

export interface SetupHintActions {
	onScaffold(): void;
	onSettings(): void;
}

export interface SetupProblem {
	key: AnyFileKey;
	label: string;
	status: Exclude<FileStatus, "ok">;
	personal: boolean;
}

export function setupProblems(pageKey: string, status: Partial<Record<AnyFileKey, FileStatus>> | undefined): SetupProblem[] {
	if (!status) return [];
	return VAULT_FILE_SPECS.filter((spec) => spec.pages.includes(pageKey))
		.flatMap((spec) => {
			const value = status[spec.key];
			if (!value || value === "ok") return [];
			return [{ key: spec.key, label: spec.label, status: value, personal: Boolean(spec.personal) }];
		});
}

export function renderSetupHint(parent: HTMLElement, problems: SetupProblem[], actions: SetupHintActions): HTMLElement | null {
	if (problems.length === 0) return null;
	const doc = parent.ownerDocument;
	const onlyPersonal = problems.every((problem) => problem.personal);
	const hint = doc.createElement("section");
	hint.className = `talos-setup-hint${onlyPersonal ? " is-optional" : ""}`;
	hint.setAttribute("role", "note");
	const text = doc.createElement("span");
	text.className = "talos-setup-hint__text";
	const describe = (problem: SetupProblem) =>
		`${problem.label}${problem.status === "missing" ? "（缺失）" : "（缺少分区）"}${problem.personal ? "·可选" : ""}`;
	text.textContent = onlyPersonal
		? `这一页面向 TALOS 产品发布流程，没有以下内容可以忽略：${problems.map(describe).join("、")}`
		: `这一页的数据来源还没就位：${problems.map(describe).join("、")}`;
	hint.appendChild(text);
	if (!onlyPersonal) {
		const scaffold = doc.createElement("button");
		scaffold.type = "button";
		scaffold.className = "talos-setup-hint__action";
		scaffold.setAttribute("data-action", "scaffold");
		scaffold.textContent = "补齐库结构";
		scaffold.addEventListener("click", () => actions.onScaffold());
		hint.appendChild(scaffold);
	}
	const settings = doc.createElement("button");
	settings.type = "button";
	settings.className = "talos-setup-hint__action";
	settings.setAttribute("data-action", "settings");
	settings.textContent = "文件位置";
	settings.addEventListener("click", () => actions.onSettings());
	hint.appendChild(settings);
	parent.appendChild(hint);
	return hint;
}

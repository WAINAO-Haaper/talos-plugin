import { FuzzySuggestModal, type App, type TFile } from "obsidian";

/** The host owns filtering and source validation; this modal only selects supplied metadata. */
class PublishingFilePicker extends FuzzySuggestModal<TFile> {
	constructor(app: App, private readonly files: readonly TFile[], private readonly selectFile: (file: TFile) => void, placeholder: string) {
		super(app);
		this.setPlaceholder(placeholder);
	}
	getItems(): TFile[] { return [...this.files]; }
	getItemText(file: TFile): string { return `${file.basename} · ${file.path}`; }
	onChooseItem(file: TFile): void { this.selectFile(file); }
}

export function choosePublishingNote(app: App, files: readonly TFile[], onSelect: (file: TFile) => void): void {
	new PublishingFilePicker(app, files, onSelect, "搜索文章名称或路径").open();
}

export function choosePublishingImage(app: App, files: readonly TFile[], onSelect: (file: TFile) => void): void {
	new PublishingFilePicker(app, files, onSelect, "搜索封面名称或路径").open();
}

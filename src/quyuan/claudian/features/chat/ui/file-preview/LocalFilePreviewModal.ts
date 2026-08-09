import type { App } from 'obsidian';
import { FuzzySuggestModal, Modal, TFile } from 'obsidian';

import {
  buildLocalFilePreview,
  evaluateDeclaredLocalPreview,
  type LocalPreviewRejected,
  type LocalPreviewResult,
} from './LocalFilePreviewPolicy';

function byteLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export class LocalFilePreviewModal extends Modal {
  private readonly file: TFile;
  private objectUrl: string | null = null;
  private closed = false;

  constructor(app: App, file: TFile) {
    super(app);
    this.file = file;
  }

  onOpen(): void {
    this.closed = false;
    this.modalEl.addClass('claudian-local-file-preview-modal');
    this.titleEl.setText(`Local preview · ${this.file.name}`);
    void this.loadPreview();
  }

  onClose(): void {
    this.closed = true;
    this.revokeObjectUrl();
    this.contentEl.empty();
  }

  private revokeObjectUrl(): void {
    if (!this.objectUrl) return;
    URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  private async loadPreview(): Promise<void> {
    this.contentEl.empty();
    const metadataCheck = evaluateDeclaredLocalPreview(this.file.name, this.file.stat.size);
    if ('status' in metadataCheck) {
      this.renderRejected(metadataCheck);
      return;
    }

    const loadingEl = this.contentEl.createDiv({
      cls: 'claudian-local-file-preview-status',
      text: 'Reading local Vault bytes…',
    });

    let result: LocalPreviewResult;
    try {
      const buffer = await this.app.vault.readBinary(this.file);
      result = buildLocalFilePreview(this.file.name, new Uint8Array(buffer));
    } catch {
      result = {
        status: 'rejected',
        reason: 'invalid-content',
        message: 'The local file could not be read. Check that it still exists and is accessible.',
        policy: metadataCheck,
        privacyBoundary: 'vault-local-no-egress',
      };
    }
    if (this.closed) return;
    loadingEl.remove();
    this.renderResult(result);
  }

  private renderResult(result: LocalPreviewResult): void {
    if (result.status === 'rejected') {
      this.renderRejected(result);
      return;
    }

    const metaEl = this.contentEl.createDiv({ cls: 'claudian-local-file-preview-meta' });
    metaEl.createSpan({ text: result.policy.id.toUpperCase() });
    metaEl.createSpan({ text: byteLabel(this.file.stat.size) });
    metaEl.createSpan({ text: 'Vault local · no egress' });

    if (result.mode === 'plain-text') {
      const preEl = this.contentEl.createEl('pre', { cls: 'claudian-local-file-preview-text' });
      preEl.setText(result.text);
      if (result.truncated) this.renderTruncationNotice();
      return;
    }

    if (result.mode === 'table') {
      const scrollEl = this.contentEl.createDiv({ cls: 'claudian-local-file-preview-table-wrap' });
      const tableEl = scrollEl.createEl('table', { cls: 'claudian-local-file-preview-table' });
      for (const [rowIndex, row] of result.rows.entries()) {
        const rowEl = tableEl.createEl('tr');
        for (const cell of row) {
          const cellEl = rowEl.createEl(rowIndex === 0 ? 'th' : 'td');
          cellEl.setText(cell);
        }
      }
      if (result.truncated) this.renderTruncationNotice();
      return;
    }

    const blobBytes = Uint8Array.from(result.bytes).buffer;
    const blob = new Blob([blobBytes], { type: result.mimeType });
    this.objectUrl = URL.createObjectURL(blob);
    if (result.mode === 'image') {
      const imageEl = this.contentEl.createEl('img', {
        cls: 'claudian-local-file-preview-image',
        attr: {
          alt: this.file.name,
          src: this.objectUrl,
          referrerpolicy: 'no-referrer',
        },
      });
      imageEl.addEventListener('error', () => {
        this.revokeObjectUrl();
        imageEl.remove();
        this.renderRejected({
          status: 'rejected',
          reason: 'invalid-content',
          message: 'The image decoder rejected this file.',
          policy: result.policy,
          privacyBoundary: result.privacyBoundary,
        });
      }, { once: true });
      return;
    }

    const frameEl = this.contentEl.createEl('iframe', {
      cls: 'claudian-local-file-preview-pdf',
      attr: {
        src: this.objectUrl,
        title: `PDF preview · ${this.file.name}`,
        sandbox: '',
        referrerpolicy: 'no-referrer',
      },
    });
    frameEl.addEventListener('error', () => {
      this.revokeObjectUrl();
      frameEl.remove();
      this.renderRejected({
        status: 'rejected',
        reason: 'invalid-content',
        message: 'The sandboxed PDF renderer rejected this file.',
        policy: result.policy,
        privacyBoundary: result.privacyBoundary,
      });
    }, { once: true });
  }

  private renderRejected(result: LocalPreviewRejected): void {
    const statusEl = this.contentEl.createDiv({ cls: 'claudian-local-file-preview-fallback' });
    statusEl.createEl('strong', { text: 'Preview unavailable' });
    statusEl.createEl('p', { text: result.message });
    statusEl.createEl('small', { text: 'No file content was sent outside this Vault.' });
  }

  private renderTruncationNotice(): void {
    this.contentEl.createDiv({
      cls: 'claudian-local-file-preview-truncated',
      text: 'Preview is bounded. Open the file to inspect the remaining content.',
    });
  }
}

export class LocalFilePreviewPicker extends FuzzySuggestModal<TFile> {
  constructor(app: App) {
    super(app);
    this.setPlaceholder('Choose a Vault file for safe local preview');
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles().sort((left, right) => left.path.localeCompare(right.path));
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    new LocalFilePreviewModal(this.app, file).open();
  }
}

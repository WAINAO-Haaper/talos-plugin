import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  buildLocalFilePreview,
  evaluateDeclaredLocalPreview,
  getLocalPreviewPolicy,
  LOCAL_PREVIEW_FORMAT_MATRIX,
  LOCAL_PREVIEW_MAX_BINARY_BYTES,
  LOCAL_PREVIEW_MAX_RENDERED_CHARACTERS,
  LOCAL_PREVIEW_MAX_TABLE_COLUMNS,
  LOCAL_PREVIEW_MAX_TABLE_ROWS,
  LOCAL_PREVIEW_MAX_TEXT_BYTES,
} from '../src/agent-workbench/ui/file-preview/local-preview-policy';

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const modalSource = readFileSync(
  `${projectRoot}src/agent-workbench/ui/file-preview/local-preview-modal.ts`,
  'utf8',
);
const fileContextSource = readFileSync(
  `${projectRoot}src/agent-workbench/ui/native-composer.ts`,
  'utf8',
);
const styleIndex = readFileSync(
  `${projectRoot}src/agent-workbench/ui/styles/index.css`,
  'utf8',
);

describe('G3 local multi-format preview matrix', () => {
  it('defines the complete release matrix with bounded renderers', () => {
    expect(LOCAL_PREVIEW_FORMAT_MATRIX.map(entry => entry.id)).toEqual([
      'markdown',
      'text',
      'json',
      'csv',
      'tsv',
      'png',
      'jpeg',
      'gif',
      'webp',
      'pdf',
    ]);
    expect(getLocalPreviewPolicy('README.MD')?.renderer).toBe('textContent');
    expect(getLocalPreviewPolicy('table.csv')?.renderer).toBe('bounded-table');
    expect(getLocalPreviewPolicy('photo.webp')?.renderer).toBe('local-blob');
    expect(getLocalPreviewPolicy('document.pdf')?.renderer).toBe('local-blob');
  });

  it('rejects active or unknown formats instead of invoking a browser interpreter', () => {
    for (const name of ['page.html', 'vector.svg', 'sheet.xlsx', 'archive.zip', 'no-extension']) {
      const result = evaluateDeclaredLocalPreview(name, 12);
      expect('status' in result && result.reason).toBe('unsupported-format');
    }
  });

  it('enforces declared size limits before a Vault content read', () => {
    const textResult = evaluateDeclaredLocalPreview('large.md', LOCAL_PREVIEW_MAX_TEXT_BYTES + 1);
    const binaryResult = evaluateDeclaredLocalPreview('large.pdf', LOCAL_PREVIEW_MAX_BINARY_BYTES + 1);
    expect('status' in textResult && textResult.reason).toBe('file-too-large');
    expect('status' in binaryResult && binaryResult.reason).toBe('file-too-large');
    expect(evaluateDeclaredLocalPreview('edge.md', LOCAL_PREVIEW_MAX_TEXT_BYTES)).toMatchObject({
      id: 'markdown',
    });
  });
});

describe('G3 safe text and structured preview', () => {
  it('keeps Markdown and HTML-shaped input as inert text', () => {
    const payload = '# Title\n<script src="https://invalid.example/x.js"></script>';
    const result = buildLocalFilePreview('unsafe.md', encode(payload));
    expect(result).toMatchObject({
      status: 'ready',
      mode: 'plain-text',
      text: payload,
      privacyBoundary: 'vault-local-no-egress',
    });
  });

  it('formats valid JSON and visibly rejects malformed JSON', () => {
    const ready = buildLocalFilePreview('data.json', encode('{"safe":true,"n":2}'));
    expect(ready).toMatchObject({
      status: 'ready',
      mode: 'plain-text',
      text: '{\n  "safe": true,\n  "n": 2\n}',
    });
    expect(buildLocalFilePreview('data.json', encode('{'))).toMatchObject({
      status: 'rejected',
      reason: 'invalid-content',
    });
  });

  it('parses bounded CSV and TSV cells without executing spreadsheet formulas', () => {
    const csv = buildLocalFilePreview(
      'data.csv',
      encode('name,note\nalpha,"a,b"\nbeta,=IMPORTXML("https://invalid.example")'),
    );
    expect(csv).toMatchObject({
      status: 'ready',
      mode: 'table',
      rows: [
        ['name', 'note'],
        ['alpha', 'a,b'],
        ['beta', '=IMPORTXML("https://invalid.example")'],
      ],
    });

    const tsv = buildLocalFilePreview('data.tsv', encode('a\tb\n1\t2'));
    expect(tsv).toMatchObject({
      status: 'ready',
      mode: 'table',
      rows: [['a', 'b'], ['1', '2']],
    });
  });

  it('bounds DOM-facing text, rows and columns', () => {
    const longText = buildLocalFilePreview(
      'long.txt',
      encode('x'.repeat(LOCAL_PREVIEW_MAX_RENDERED_CHARACTERS + 1)),
    );
    expect(longText).toMatchObject({ status: 'ready', mode: 'plain-text', truncated: true });

    const manyColumns = Array.from(
      { length: LOCAL_PREVIEW_MAX_TABLE_COLUMNS + 2 },
      (_, index) => `c${index}`,
    ).join(',');
    const manyRows = Array.from(
      { length: LOCAL_PREVIEW_MAX_TABLE_ROWS + 2 },
      () => manyColumns,
    ).join('\n');
    const table = buildLocalFilePreview('wide.csv', encode(manyRows));
    expect(table).toMatchObject({ status: 'ready', mode: 'table', truncated: true });
    if (table.status === 'ready' && table.mode === 'table') {
      expect(table.rows).toHaveLength(LOCAL_PREVIEW_MAX_TABLE_ROWS);
      expect(table.rows[0]).toHaveLength(LOCAL_PREVIEW_MAX_TABLE_COLUMNS);
    }
  });

  it('rejects invalid UTF-8, binary nulls and unterminated CSV quotes', () => {
    expect(buildLocalFilePreview('bad.txt', Uint8Array.of(0xC3, 0x28))).toMatchObject({
      status: 'rejected',
      reason: 'invalid-content',
    });
    expect(buildLocalFilePreview('bad.md', Uint8Array.of(0x61, 0x00, 0x62))).toMatchObject({
      status: 'rejected',
      reason: 'invalid-content',
    });
    expect(buildLocalFilePreview('bad.csv', encode('a,"unfinished'))).toMatchObject({
      status: 'rejected',
      reason: 'invalid-content',
    });
  });
});

describe('G3 binary validation and privacy boundary', () => {
  it.each([
    ['image.png', Uint8Array.of(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A), 'image'],
    ['image.jpg', Uint8Array.of(0xFF, 0xD8, 0xFF), 'image'],
    ['image.gif', encode('GIF89a'), 'image'],
    ['image.webp', encode('RIFF0000WEBP'), 'image'],
    ['document.pdf', encode('%PDF-1.7\n'), 'pdf'],
  ])('accepts matching local signatures for %s', (name, bytes, mode) => {
    expect(buildLocalFilePreview(name, bytes)).toMatchObject({
      status: 'ready',
      mode,
      privacyBoundary: 'vault-local-no-egress',
    });
  });

  it.each(['png', 'jpg', 'gif', 'webp', 'pdf'])(
    'rejects extension spoofing for .%s',
    extension => {
      expect(buildLocalFilePreview(`spoof.${extension}`, encode('not-the-format'))).toMatchObject({
        status: 'rejected',
        reason: 'invalid-content',
      });
    },
  );

  it('wires the picker into the product UI and keeps rendering local-only', () => {
    expect(fileContextSource).toContain('new LocalFilePreviewPicker(this.options.app).open()');
    expect(styleIndex).toContain('@import "./features/file-preview.css";');
    expect(modalSource).toContain('evaluateDeclaredLocalPreview(this.file.name, this.file.stat.size)');
    expect(modalSource.indexOf('evaluateDeclaredLocalPreview')).toBeLessThan(
      modalSource.indexOf('this.app.vault.readBinary'),
    );
    expect(modalSource).toContain('sandbox: ""');
    expect(modalSource).toContain('referrerpolicy: "no-referrer"');
    expect(modalSource).toContain('URL.revokeObjectURL');
    expect(modalSource).toContain('preEl.setText(result.text)');
    expect(modalSource).toContain('cellEl.setText(cell)');
    expect(modalSource).not.toContain('innerHTML');
    expect(modalSource).not.toMatch(/\bfetch\s*\(/);
    expect(modalSource).not.toMatch(/https?:\/\//);
  });
});

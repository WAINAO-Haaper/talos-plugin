export type LocalPreviewFormatId =
  | 'markdown'
  | 'text'
  | 'json'
  | 'csv'
  | 'tsv'
  | 'png'
  | 'jpeg'
  | 'gif'
  | 'webp'
  | 'pdf';

export type LocalPreviewMode = 'plain-text' | 'table' | 'image' | 'pdf';

export interface LocalPreviewFormatPolicy {
  id: LocalPreviewFormatId;
  extensions: readonly string[];
  mode: LocalPreviewMode;
  mimeType: string;
  maxBytes: number;
  renderer: 'textContent' | 'bounded-table' | 'local-blob';
}

export const LOCAL_PREVIEW_PRIVACY_BOUNDARY = 'vault-local-no-egress' as const;
export const LOCAL_PREVIEW_MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const LOCAL_PREVIEW_MAX_BINARY_BYTES = 10 * 1024 * 1024;
export const LOCAL_PREVIEW_MAX_RENDERED_CHARACTERS = 200_000;
export const LOCAL_PREVIEW_MAX_TABLE_ROWS = 100;
export const LOCAL_PREVIEW_MAX_TABLE_COLUMNS = 20;
export const LOCAL_PREVIEW_MAX_CELL_CHARACTERS = 500;

/**
 * G3 release matrix. Unknown extensions and active document formats (including
 * HTML and SVG) intentionally have no entry and must use the unsupported
 * fallback instead of a browser interpreter.
 */
export const LOCAL_PREVIEW_FORMAT_MATRIX: readonly LocalPreviewFormatPolicy[] = [
  {
    id: 'markdown',
    extensions: ['.md', '.markdown'],
    mode: 'plain-text',
    mimeType: 'text/markdown',
    maxBytes: LOCAL_PREVIEW_MAX_TEXT_BYTES,
    renderer: 'textContent',
  },
  {
    id: 'text',
    extensions: ['.txt', '.log', '.yaml', '.yml', '.toml'],
    mode: 'plain-text',
    mimeType: 'text/plain',
    maxBytes: LOCAL_PREVIEW_MAX_TEXT_BYTES,
    renderer: 'textContent',
  },
  {
    id: 'json',
    extensions: ['.json'],
    mode: 'plain-text',
    mimeType: 'application/json',
    maxBytes: LOCAL_PREVIEW_MAX_TEXT_BYTES,
    renderer: 'textContent',
  },
  {
    id: 'csv',
    extensions: ['.csv'],
    mode: 'table',
    mimeType: 'text/csv',
    maxBytes: LOCAL_PREVIEW_MAX_TEXT_BYTES,
    renderer: 'bounded-table',
  },
  {
    id: 'tsv',
    extensions: ['.tsv'],
    mode: 'table',
    mimeType: 'text/tab-separated-values',
    maxBytes: LOCAL_PREVIEW_MAX_TEXT_BYTES,
    renderer: 'bounded-table',
  },
  {
    id: 'png',
    extensions: ['.png'],
    mode: 'image',
    mimeType: 'image/png',
    maxBytes: LOCAL_PREVIEW_MAX_BINARY_BYTES,
    renderer: 'local-blob',
  },
  {
    id: 'jpeg',
    extensions: ['.jpg', '.jpeg'],
    mode: 'image',
    mimeType: 'image/jpeg',
    maxBytes: LOCAL_PREVIEW_MAX_BINARY_BYTES,
    renderer: 'local-blob',
  },
  {
    id: 'gif',
    extensions: ['.gif'],
    mode: 'image',
    mimeType: 'image/gif',
    maxBytes: LOCAL_PREVIEW_MAX_BINARY_BYTES,
    renderer: 'local-blob',
  },
  {
    id: 'webp',
    extensions: ['.webp'],
    mode: 'image',
    mimeType: 'image/webp',
    maxBytes: LOCAL_PREVIEW_MAX_BINARY_BYTES,
    renderer: 'local-blob',
  },
  {
    id: 'pdf',
    extensions: ['.pdf'],
    mode: 'pdf',
    mimeType: 'application/pdf',
    maxBytes: LOCAL_PREVIEW_MAX_BINARY_BYTES,
    renderer: 'local-blob',
  },
] as const;

export type LocalPreviewRejectedReason =
  | 'unsupported-format'
  | 'file-too-large'
  | 'invalid-content';

export interface LocalPreviewRejected {
  status: 'rejected';
  reason: LocalPreviewRejectedReason;
  message: string;
  policy?: LocalPreviewFormatPolicy;
  privacyBoundary: typeof LOCAL_PREVIEW_PRIVACY_BOUNDARY;
}

interface LocalPreviewReadyBase {
  status: 'ready';
  policy: LocalPreviewFormatPolicy;
  privacyBoundary: typeof LOCAL_PREVIEW_PRIVACY_BOUNDARY;
}

export interface LocalPreviewTextReady extends LocalPreviewReadyBase {
  mode: 'plain-text';
  text: string;
  truncated: boolean;
}

export interface LocalPreviewTableReady extends LocalPreviewReadyBase {
  mode: 'table';
  rows: string[][];
  truncated: boolean;
}

export interface LocalPreviewBinaryReady extends LocalPreviewReadyBase {
  mode: 'image' | 'pdf';
  bytes: Uint8Array;
  mimeType: string;
}

export type LocalPreviewReady =
  | LocalPreviewTextReady
  | LocalPreviewTableReady
  | LocalPreviewBinaryReady;

export type LocalPreviewResult = LocalPreviewReady | LocalPreviewRejected;

function extensionOf(fileName: string): string {
  const normalized = fileName.replace(/\\/g, '/').split('/').pop() ?? fileName;
  const dot = normalized.lastIndexOf('.');
  return dot > 0 ? normalized.slice(dot).toLowerCase() : '';
}

export function getLocalPreviewPolicy(fileName: string): LocalPreviewFormatPolicy | null {
  const extension = extensionOf(fileName);
  return LOCAL_PREVIEW_FORMAT_MATRIX.find(policy => policy.extensions.includes(extension)) ?? null;
}

function reject(
  reason: LocalPreviewRejectedReason,
  message: string,
  policy?: LocalPreviewFormatPolicy,
): LocalPreviewRejected {
  return {
    status: 'rejected',
    reason,
    message,
    policy,
    privacyBoundary: LOCAL_PREVIEW_PRIVACY_BOUNDARY,
  };
}

/** Run this check against Vault metadata before any content read. */
export function evaluateDeclaredLocalPreview(
  fileName: string,
  declaredBytes: number,
): LocalPreviewFormatPolicy | LocalPreviewRejected {
  const policy = getLocalPreviewPolicy(fileName);
  if (!policy) {
    return reject(
      'unsupported-format',
      'This format is not in the safe local preview matrix. Open it with its owning application.',
    );
  }
  if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0 || declaredBytes > policy.maxBytes) {
    return reject(
      'file-too-large',
      `File exceeds the ${formatByteLimit(policy.maxBytes)} ${policy.id} preview limit.`,
      policy,
    );
  }
  return policy;
}

function formatByteLimit(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function decodeUtf8(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    return null;
  }
}

function truncateText(text: string): { text: string; truncated: boolean } {
  if (text.length <= LOCAL_PREVIEW_MAX_RENDERED_CHARACTERS) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, LOCAL_PREVIEW_MAX_RENDERED_CHARACTERS)}\n\n[Preview truncated]`,
    truncated: true,
  };
}

function signatureMatches(id: LocalPreviewFormatId, bytes: Uint8Array): boolean {
  switch (id) {
    case 'png':
      return bytes.length >= 8
        && [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
          .every((value, index) => bytes[index] === value);
    case 'jpeg':
      return bytes.length >= 3
        && bytes[0] === 0xFF
        && bytes[1] === 0xD8
        && bytes[2] === 0xFF;
    case 'gif': {
      if (bytes.length < 6) return false;
      const header = String.fromCharCode(...bytes.subarray(0, 6));
      return header === 'GIF87a' || header === 'GIF89a';
    }
    case 'webp':
      return bytes.length >= 12
        && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
        && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';
    case 'pdf':
      return bytes.length >= 5
        && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-';
    default:
      return true;
  }
}

function parseDelimitedPreview(
  text: string,
  delimiter: ',' | '\t',
): { rows: string[][]; truncated: boolean } | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let truncated = false;

  const pushCell = () => {
    if (row.length < LOCAL_PREVIEW_MAX_TABLE_COLUMNS) {
      row.push(cell.slice(0, LOCAL_PREVIEW_MAX_CELL_CHARACTERS));
      if (cell.length > LOCAL_PREVIEW_MAX_CELL_CHARACTERS) truncated = true;
    } else {
      truncated = true;
    }
    cell = '';
  };
  const pushRow = () => {
    pushCell();
    if (rows.length < LOCAL_PREVIEW_MAX_TABLE_ROWS) {
      rows.push(row);
    } else {
      truncated = true;
    }
    row = [];
  };

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === delimiter) {
      pushCell();
    } else if (character === '\n') {
      pushRow();
    } else if (character !== '\r') {
      cell += character;
    }
  }
  if (quoted) return null;
  if (cell.length > 0 || row.length > 0) pushRow();
  return { rows, truncated };
}

/**
 * Builds a render model from already-local Vault bytes. It does not accept a
 * URL and contains no I/O, so the caller cannot accidentally turn preview into
 * an egress path.
 */
export function buildLocalFilePreview(fileName: string, inputBytes: Uint8Array): LocalPreviewResult {
  const declared = evaluateDeclaredLocalPreview(fileName, inputBytes.byteLength);
  if ('status' in declared) return declared;
  const policy = declared;

  // Re-check actual bytes even when Vault metadata already passed.
  if (inputBytes.byteLength > policy.maxBytes) {
    return reject(
      'file-too-large',
      `File exceeds the ${formatByteLimit(policy.maxBytes)} ${policy.id} preview limit.`,
      policy,
    );
  }

  if (policy.mode === 'image' || policy.mode === 'pdf') {
    if (!signatureMatches(policy.id, inputBytes)) {
      return reject(
        'invalid-content',
        `File bytes do not match the .${policy.id === 'jpeg' ? 'jpg' : policy.id} format.`,
        policy,
      );
    }
    return {
      status: 'ready',
      mode: policy.mode,
      bytes: Uint8Array.from(inputBytes),
      mimeType: policy.mimeType,
      policy,
      privacyBoundary: LOCAL_PREVIEW_PRIVACY_BOUNDARY,
    };
  }

  const decoded = decodeUtf8(inputBytes);
  if (decoded === null) {
    return reject('invalid-content', 'File is not valid UTF-8 text.', policy);
  }

  if (policy.id === 'json') {
    try {
      const formatted = JSON.stringify(JSON.parse(decoded), null, 2);
      const bounded = truncateText(formatted);
      return {
        status: 'ready',
        mode: 'plain-text',
        text: bounded.text,
        truncated: bounded.truncated,
        policy,
        privacyBoundary: LOCAL_PREVIEW_PRIVACY_BOUNDARY,
      };
    } catch {
      return reject('invalid-content', 'JSON is malformed and cannot be previewed.', policy);
    }
  }

  if (policy.mode === 'table') {
    const table = parseDelimitedPreview(decoded, policy.id === 'csv' ? ',' : '\t');
    if (!table) {
      return reject('invalid-content', `${policy.id.toUpperCase()} contains an unterminated quote.`, policy);
    }
    return {
      status: 'ready',
      mode: 'table',
      rows: table.rows,
      truncated: table.truncated,
      policy,
      privacyBoundary: LOCAL_PREVIEW_PRIVACY_BOUNDARY,
    };
  }

  const bounded = truncateText(decoded);
  return {
    status: 'ready',
    mode: 'plain-text',
    text: bounded.text,
    truncated: bounded.truncated,
    policy,
    privacyBoundary: LOCAL_PREVIEW_PRIVACY_BOUNDARY,
  };
}

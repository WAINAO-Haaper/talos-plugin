# G3 Multi-format Preview Acceptance Contract

Status: implementation candidate; release evidence is valid only after the full Plugin and
Standard binding gates pass for the same immutable Plugin revision.

## Product surface

The Quyuan action row exposes `Preview`. It opens a Vault file picker and previews exactly one
local file. Preview is a display action only: it does not attach the file to a provider request,
change chat state, or authorize later egress.

## Formal format matrix

| Family | Extensions | Renderer | Limit | Validation |
|---|---|---|---:|---|
| Markdown | `.md`, `.markdown` | inert plain text | 2 MB | strict UTF-8, no null bytes |
| Text | `.txt`, `.log`, `.yaml`, `.yml`, `.toml` | inert plain text | 2 MB | strict UTF-8, no null bytes |
| JSON | `.json` | bounded pretty text | 2 MB | strict UTF-8 and JSON parse |
| Table | `.csv`, `.tsv` | bounded DOM table | 2 MB | strict UTF-8 and closed quotes |
| Raster image | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` | local Blob image | 10 MB | extension-specific magic bytes plus decoder fallback |
| PDF | `.pdf` | sandboxed local Blob frame | 10 MB | `%PDF-` signature plus frame fallback |

HTML, SVG, Office documents, archives and unknown extensions are intentionally unsupported.
They receive an explicit fallback instead of being passed to an active browser interpreter.

## Security and privacy invariants

- The declared Vault size is checked before `readBinary`; actual byte length is checked again.
- Text is rendered with `setText`. Markdown, HTML-shaped text and spreadsheet formulas are not
  interpreted as markup or commands.
- Table output is limited to 100 rows, 20 columns and 500 characters per cell.
- Text output is limited to 200,000 characters.
- Images and PDFs use only in-memory Blob URLs. PDF uses an empty sandbox and all binary previews
  use `no-referrer`.
- Blob URLs are revoked on close and on decoder failure.
- Preview accepts no remote URL and invokes no network API. Its privacy boundary is
  `vault-local-no-egress`.
- Unsupported, oversized, invalid UTF-8, malformed JSON/CSV, signature mismatch, read failure and
  decoder failure all produce a visible fallback.

## Verification

Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run licenses:check` and `npm run build`.
The G3 regression includes the exact matrix, upper bounds, active-format rejection, markup/formula
inertness, malformed inputs, extension spoofing, local-only rendering and UI wiring. G3 must remain
open until Standard binds the tested Plugin revision and its release tree passes the full gate.

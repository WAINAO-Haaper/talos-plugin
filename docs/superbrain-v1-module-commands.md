# Superbrain V1 module commands — local development candidate

Updated: 2026-09-05. This is a local candidate deployed only to an isolated synthetic Obsidian test Vault, not to the personal Vault or a release.

## Entry points

Ten command groups share one catalog: setup, capture, library, search, project, profile, flow, media, convert, system. The Obsidian command palette registers the groups and 32 individual actions. Existing module headers, daily actions and command capability cards use the same router. Non-command agents/skills keep their original copy/open behavior. Optional marketing, publishing and brand commands do not silently route to unrelated operations.

Module panels show compact group buttons; the modal selects an action, collects inputs, previews exact file targets/content, confirms writes and displays the shared task result. Input changes invalidate prior confirmation. Unknown invocations and missing capabilities never execute arbitrary shell text.

## Working native operations

- Inspect mapped data roots; initialize missing README files for eight data modules and confirmed identity scaffolding without overwriting existing files.
- Capture notes/logs/tasks; create project records and append progress; show identity files and append explicitly confirmed profile content.
- Search supported local text with source links and stated scan limits; existing canonical ask/egress pipeline handles provider-backed questions.
- Import selected files preserving byte-identical originals; create inert standard text for MD/TXT/JSON/CSV, with honest warnings for unsupported parsing.
- Create a classification copy without removing the source; mark selected Markdown archived without breaking its location/links.
- Export or back up explicitly selected data into a versioned JSON package; restore it beneath a new folder, never onto existing files. The package includes media bytes but does not claim to back up credentials or the installed plugin.
- Browse media and open the original through Obsidian; inspect basic file information.
- Convert supported text/Markdown/JSON/CSV inputs to supported text/Markdown/escaped HTML outputs, preserving original files.
- Generate bounded activity review drafts and check supported Markdown metadata. These do not claim that work has been completed.

## Explicitly unavailable

OCR, audio/video transcription, complex Office/PDF/image/video conversion, the complete autonomous cycle, and automatic repair are not implemented by this command wiring. Missing engine actions are visibly disabled; unsupported conversion fails clearly. AI questions need a configured/authorized existing provider. Original binary files can still be imported and packaged without understanding their contents.

## Data safety and recovery

Only configured data roots are accepted; identity writes are limited to explicit setup/profile operations. Root-internal and external symlink aliases are rejected. Imports do not execute scripts, macros, imported instructions or HTML. Plans retain private snapshots, reject tampering, recheck sources and targets, and use conditionally checked writes. Existing text updates use Obsidian's atomic `Vault.process` callback.

Obsidian does not expose an atomic compare-and-delete API. This candidate therefore never automatically deletes newly created files on failure, cancellation or undo. It keeps them for inspection and reports incomplete recovery. This limitation is shown before confirmation. Existing text modifications can be conditionally undone if unchanged since the action; snapshots and task state are session-local, not restart-persistent recovery.

No production Vault, provider request or real user data was exercised during automated tests. Native Obsidian layout/user acceptance and installation remain separate checks.

## Source boundaries

The candidate starts from the deployed 0.4.5 peer-status source and retains two pre-existing approval-broker repair files from parallel work. Those baseline changes are not attributed to module-command implementation. The older 0.4.0 checkout is not used as the implementation base. Existing branch, release, version number and installed data are not changed.

## Isolated host validation

Obsidian 1.13.7: 36 automated host checks passed across 11 module pages; 42 command entries recovered after cold start and 35 data file hashes were unchanged. Host testing fixed review-output priority and missing completed-task change records. The updated candidate passes 985 unit tests, type/lint/build and three self-tests. Real providers and human first-use acceptance remain untested.

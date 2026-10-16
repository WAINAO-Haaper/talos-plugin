# Native article drafts

Status: local implementation candidate, based on TALOS 0.4.16. Updated: 2026-10-17.

## Scope

Reuse SerenaPost 1.1.5 source to prepare one Obsidian note and create editable WeChat Official Account and X Article drafts. Publication stays manual in each platform. Both TALOS console modes share the same service: the personal Output Room and the framework C09 page open the same modal. The command palette also provides “排版与平台草稿”. No AI runtime or API model is needed for formatting or delivery.

The first version includes one configured WeChat account and one user-confirmed X account per Vault, title/author/summary/cover fields, separate platform previews and durable delivery receipts. The editing workspace adds local font-size, line-height and accent controls for WeChat; X keeps its platform-native format. It does not synchronize platform edits back into the source note. It does not install browser extensions or run external media converters.

## Use

1. Open the draft workspace from Output Room or C09. Configure WeChat AppID/AppSecret and the X username.
2. For WeChat, grant the account the required draft/material API permissions and configure its outbound IP allowlist on the official developer console. AppSecret is stored only in Obsidian SecretStorage.
3. For X, install Kaitox Chrome extension 0.6.3 or newer, log into the intended account with Articles access, set the relay URL to `http://127.0.0.1:8765`, and copy the TALOS pairing code into the extension’s relay token setting. The pairing code is held in SecretStorage. TALOS cannot verify the Chrome account; the confirmation explicitly asks the user to check it.
4. Use the native file chooser to select a Markdown note and a local cover image (required for WeChat). The current Markdown note is selected on opening when available. Title, metadata, cover and WeChat typography changes update the previews locally after a short debounce; “刷新正文” refreshes immediately.
5. Check the rendered content, warnings, media and destinations. Confirm creation of the selected drafts. X opens the system browser; keep the article editor and extension running while the receipt is pending.
6. Open the resulting drafts and review them before publishing manually. A successful draft receipt is never counted as a publicly published article.

## Media and preview boundaries

The editing column and preview column scroll independently on wide windows. Narrow windows stack them while retaining the confirmation area. Preview platform tabs switch between both platforms or a single larger preview without changing the approved content. Source-note modifications trigger a refresh; renaming follows the new path and retains a custom title. Closing the modal removes listeners and pending timers.

Every content change immediately revokes the old confirmation and releases its retained media snapshot. While a new preview is pending or fails, the last good image may remain visible with a stale-state label, but cannot be sent. Only one content preparation runs at a time; rapid edits coalesce to the latest input, and late results/errors or account proposals cannot restore old approval. Submission locks editing; a source change during delivery is refreshed afterwards. No automatic preview starts a relay, reads a platform secret, or sends content.

WeChat controls accept font sizes 14–20 px, line heights 1.5/1.75/2/2.25, and six-digit hex accents. Defaults preserve the previous neutral output. Values are validated before media reads and converted to inline CSS; the resulting HTML is part of the existing snapshot fingerprint. There is no arbitrary CSS or remote font input. Both previews show the actual draft title separately from the unchanged body; a body H1 is not silently removed.

Local image and MP4/MOV attachments are frozen into the approved snapshot. WeChat uses compressed PNG/JPEG images, static GIF frames, and explicit video placeholders; X retains GIF and MP4/MOV subject to platform limits. Unsupported formats and missing images produce actionable errors. Remote images must first be saved locally: preview does not download external resources. Note transclusions are not expanded, and ordinary wiki links become text. Raw HTML outside code blocks is rejected to prevent hidden network resources.

Original and platform-specific media, rendered content and all sending fields contribute to the snapshot fingerprint. Editing the form invalidates confirmation. The host blocks configuration/private paths and files whose real paths escape the current Vault. No automatic network call occurs during preview or on plugin startup.

## Execution and recovery

`PublishingHost` binds a confirmed snapshot and destination accounts to the existing TALOS C-risk task runner. `PublicationService` records each destination separately. Receipts contain metadata, hashes and remote identifiers, not article bodies, keys or arbitrary transport errors. Private records and relay bundles live under `.talos/private/publishing/` in the current Vault; they should be included only in trusted personal backups.

The local relay listens only on loopback and starts on demand for an approved X delivery. It requires an in-memory pairing token, uses its explicit private directory, and never reads shared Kaitox home/config files. An occupied port fails explicitly; TALOS does not terminate or take over another process. Unloading the plugin cancels waits and closes only its own server. It cannot retract requests that have already reached a platform.

States are `pending`, `sending`, `queued`, `draft-created`, `failed` and `unknown`. Enqueueing is not remote success. A draft-created receipt requires the remote ID. If a request or local receipt write has an uncertain outcome, the original delivery remains blocked from resubmission; the user can query the original X relay ID or manually inspect the WeChat draft box. “核对原草稿结果” never creates a new draft. Known successful targets are retained when another target fails.

The service prevents in-process double clicks and consults durable records after restart. This is not a cross-process or server-side exactly-once guarantee. Only one TALOS publishing instance should operate a Vault at a time. Account changes require a new confirmation; platform credentials are not exposed as generic AI tools.

## Source and validation

Pinned source and original file hashes: [SerenaPost provenance](../vendor/serena-post/SOURCE.md). Borrowed source keeps its MIT licenses; author portraits and icons are excluded. Dependencies are pinned in the lockfile and included in the normal license audit. TALOS adapters replace the upstream UI and integrate approval, privacy, account configuration and result handling.

Focused tests exercise the real formatting modules, frozen media, WeChat transport boundaries, local relay wire protocol, persistent receipts, host approvals and DOM interactions using synthetic data. Real WeChat account permissions, X extension/account behavior and end-user Obsidian installation are separate acceptance checks; local tests do not claim that those live checks passed.

The feature is a local development candidate. It does not change the installed plugin, the release version or repository remotes.

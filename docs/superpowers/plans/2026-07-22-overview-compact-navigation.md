# Overview Compact Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the TALOS overview use the same collapsed icon rail and hover/focus overlay navigation as every detail page.

**Architecture:** Keep navigation CSS-only and reuse the existing shell contract in `styles.quyuan-shell.css`. Generalize only the shell, navigation-card, and responsive selectors; retain page-specific main-content padding and Jarvis height rules unchanged.

**Tech Stack:** CSS, Node.js assertion self-test, Vitest, TypeScript/esbuild production build.

## Global Constraints

- Desktop resting width is 72px and expanded width is 296px.
- At 1080px and below, expanded width is 260px; at 760px and below, resting width is 54px.
- Expansion overlays the main workspace and must not resize it.
- Hover and `:focus-within` both expand the navigation.
- Do not add dependencies, change Vault data, or persist navigation state.
- Do not create a Git commit unless the user explicitly requests one.

---

### Task 1: Navigation Contract Regression

**Files:**
- Modify: `quyuan-v2.selftest.mjs`
- Test: `quyuan-v2.selftest.mjs`

**Interfaces:**
- Consumes: the complete source text of `styles.quyuan-shell.css` already loaded as `quyuanShellCss`.
- Produces: assertions that require the compact shell selectors to include overview while preserving detail-only main padding.

- [ ] **Step 1: Write the failing assertions**

Replace the current overview-excluding shell assertion with generic shell checks and add a negative check:

```js
assert.match(
  quyuanShellCss,
  /\.talos-console \.app\s*\{[\s\S]*grid-template-columns:\s*72px minmax\(0,\s*1fr\) !important/
);
assert.match(
  quyuanShellCss,
  /\.talos-console \.sidebar\s*\{[\s\S]*width:\s*72px/
);
assert.doesNotMatch(
  quyuanShellCss,
  /:not\(\[data-talos-page="overview"\]\) \.app\s*\{/
);
assert.match(
  quyuanShellCss,
  /:not\(\[data-talos-page="overview"\]\):not\(\[data-talos-page="jarvis"\]\)[\s\S]*\.main[\s\S]*padding:\s*18px !important/
);
```

- [ ] **Step 2: Verify the test fails for the missing overview behavior**

Run: `npm run test:quyuan`

Expected: FAIL because `.talos-console .app` and `.talos-console .sidebar` generic compact selectors do not yet exist.

### Task 2: Shared Compact Overlay Shell

**Files:**
- Modify: `styles.quyuan-shell.css:850-995`
- Modify: `styles.quyuan-shell.css:3488-3565`
- Test: `quyuan-v2.selftest.mjs`

**Interfaces:**
- Consumes: the regression assertions from Task 1 and existing `.app`, `.sidebar`, `.pagenav-card`, `.nav-group`, `.command`, `.nav-label`, and `.nav-meta` markup.
- Produces: a shared CSS-only compact navigation contract for overview, detail, and Jarvis pages.

- [ ] **Step 1: Generalize the shell and navigation selectors**

For the existing compact-navigation block only, replace selectors shaped like:

```css
.talos-console:not([data-talos-page="overview"]) .app
.talos-console:not([data-talos-page="overview"]) .sidebar
.talos-console:not([data-talos-page="overview"]) .pagenav-card
```

with:

```css
.talos-console .app
.talos-console .sidebar
.talos-console .pagenav-card
```

Apply the same generalization to hover/focus expansion, collapsed card chrome, labels, metadata, groups, and commands. Do not change selectors ending in `:not([data-talos-page="jarvis"]) .main`.

- [ ] **Step 2: Generalize responsive rail geometry**

Inside the existing `@media (max-width: 1080px)` and `@media (max-width: 760px)` blocks, apply the same selector generalization to `.app`, `.sidebar`, hover/focus width, and `.pagenav-card .command`. Keep detail-page main padding selectors unchanged.

- [ ] **Step 3: Respect reduced motion**

Add:

```css
@media (prefers-reduced-motion: reduce) {
  .talos-console .sidebar {
    transition: none;
  }
}
```

- [ ] **Step 4: Verify the focused regression passes**

Run: `npm run test:quyuan`

Expected: PASS with all self-test assertions satisfied.

### Task 3: Full Verification and Deployment

**Files:**
- Modify: `docs/design-qa.md`
- Generated: `main.js`, `styles.css`
- Backup: `backups/obsidian-sync-20260722-nav-before/`

**Interfaces:**
- Consumes: production build artifacts `main.js`, `manifest.json`, and `styles.css`.
- Produces: an installed TALOS build whose three files exactly match the verified workspace artifacts.

- [ ] **Step 1: Run repository verification**

Run: `npm test && npm run test:quyuan && npm run lint && npm run build && git diff --check`

Expected: 0 failing Vitest files, self-test exit 0, lint exit 0, production build exit 0, and no whitespace errors.

- [ ] **Step 2: Visually verify the prototype**

At 1600×1000, 1024×768, and 390×844, confirm:

```text
resting rail = 72px / 72px / 54px
expanded overlay = 296px / 260px / <=260px
overview main left edge is unchanged during expansion
12 navigation commands remain reachable
document scrollWidth equals clientWidth
```

- [ ] **Step 3: Record QA evidence**

Append a dated `Overview Compact Overlay Navigation QA` section to `docs/design-qa.md` with measured widths, accessibility checks, overflow result, and any patch made during QA.

- [ ] **Step 4: Back up and deploy**

Copy the installed `main.js`, `manifest.json`, and `styles.css` into `backups/obsidian-sync-20260722-nav-before/`, verify the backup with `cmp`, then copy the fresh artifacts to `/Users/apple/Documents/obsidian/超级大脑/.obsidian/plugins/talos/`.

- [ ] **Step 5: Verify installed artifacts**

Run `cmp -s` for each of the three workspace/installed file pairs and print SHA-256 hashes.

Expected: every pair is byte-for-byte identical and each pair has matching hashes.

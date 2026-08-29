# TALOS Agent Workbench CSS Contract

This directory is the TALOS-owned build location for the current, user-validated
conversation UI. The stylesheet modules preserve the existing visual result while
the runtime, state, rendering, provider, and interaction implementations live in
TALOS native TypeScript modules.

The `.claudian-*` selector prefix is a frozen visual ABI only. It is intentionally
kept so existing themes, snapshots, and DOM/CSS bindings do not regress; it does
not identify a runtime dependency or authorize importing retired Claudian code.

## Structure

```
src/agent-workbench/ui/styles/
├── base/           # container, animations (@keyframes), variables
├── components/     # header, history, messages, code, thinking, toolcalls, status-panel, subagent, input, context-footer, tabs, nav-sidebar
├── toolbar/        # model-selector, thinking-selector, permission-toggle, service-tier-toggle, external-context, mcp-selector
├── features/       # file-context, image-context, image-modal, inline-edit, diff, slash-commands, file-link, image-embed, plan-mode, ask-user-question, resume-session
├── modals/         # instruction, mcp-modal, fork-target
├── settings/       # base (shared .claudian-sp-* panel layout), env-snippets, slash-settings, mcp-settings, plugin-settings, agent-settings
├── accessibility.css
└── index.css       # Build order (@import list)
```

## Build

CSS is built into root `styles.css` via `npm run build:css`. It is invoked by both `npm run dev` and `npm run build`.

**Adding new modules**: Register in `index.css` via `@import` or the CSS build will fail.

## Conventions

- **Frozen compatibility prefix**: Keep existing `.claudian-*` selectors stable when changing behavior; new TALOS-only surfaces should use a `.talos-*` prefix
- **BEM-lite**: Prefer `.talos-{block}`, `.talos-{block}-{element}`, `.talos-{block}--{modifier}` for new selectors
- **No `!important`**: Avoid unless overriding Obsidian defaults
- **CSS variables**: Use Obsidian's `--background-*`, `--text-*`, `--interactive-*` tokens

Do not copy behavior, component ownership, or module structure from retired
Claudian versions into this directory. Functional architecture research is pinned
to the latest reviewed upstream commit documented in the repository README.

## Naming Patterns

| Pattern | Examples |
|---------|----------|
| Layout | `-container`, `-header`, `-messages`, `-input` |
| Messages | `-message`, `-message-user`, `-message-assistant` |
| Tool calls | `-tool-call`, `-tool-header`, `-tool-content`, `-tool-status` |
| Thinking | `-thinking-block`, `-thinking-header`, `-thinking-content` |
| Panels | `-todo-list`, `-todo-item`, `-subagent-list`, `-subagent-header` |
| Context | `-file-chip`, `-image-chip`, `-mention-dropdown` |
| Plan mode | `-plan-approval-inline`, `-plan-content-preview`, `-plan-permissions`, plus shared `-ask-*` classes for approval/revision controls |
| Ask user | `-ask-list`, `-ask-item`, `-ask-cursor`, `-ask-hints` |
| Command panel | `-status-panel-bash`, `-status-panel-bash-header`, `-status-panel-bash-entry`, `-status-panel-bash-actions` |
| Modals | `-instruction-modal`, `-mcp-modal`, `-fork-target-*` |

## Gotchas

- Obsidian uses `body.theme-dark` / `body.theme-light` for theme detection
- Modal z-index must be > 1000 to overlay Obsidian UI
- Use `var(--font-monospace)` for code blocks, not hardcoded fonts

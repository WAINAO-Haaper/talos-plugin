# TALOS Unified Interface Language

**version:** 2.0
**status:** accepted direction
**last_updated:** 2026-08-24
**classification:** PUBLIC
**decision:** D-TLP-019

This file is the single master specification for TALOS interface work. Page-level files may
specialize content and data, but must not create a separate color, spacing, component, or
interaction language. This specification supersedes the generated 2026-07-19 dark
Cybersecurity template.

## 1. Product outcome

TALOS is an Obsidian-native dashboard and workbench. It should let the user understand
the current situation, identify attention items, approve recoverable work, and make small
contextual edits without leaving the current page.

Unified language does not mean identical page layouts. Every page shares foundations,
component anatomy, interaction semantics, and responsive behavior; each page uses the
archetype that best serves its job.

## 2. Non-negotiable constraints

- Preserve the existing geometric-modern / Bauhaus character and established motion.
- Keep tasks in the left navigation. Do not restore a permanent right task rail.
- Share only the outer page canvas. Never force page-content or its last business child to
  stretch, fill remaining height, or use a page-wide fixed height.
- Keep the DeepSeek Harness and Codex workbench as two retained AI surfaces.
- Keep voice operations read-only. A requested write returns to text confirmation.
- Preserve existing routes, commands, approval handlers, provider behavior, and settings
  persistence while visual restructuring is underway.
- Use Obsidian and Lucide-native facilities. Do not load external fonts or add a chart
  dependency unless a later page proves that native SVG or DOM is insufficient.
- The vault-theme blanket important rule remains a known cascade constraint. New
  interaction overrides must be narrowly scoped and documented.

## 3. Complete interface map

| Archetype | Pages | Primary job |
|---|---|---|
| Data dashboard | Workbench, System Health, Vault View | Situation, trend, anomaly, attention |
| Execution workbench | Daily Execution, Inbox, Output Room, Project Scenes, TALOS Product | Queue, decision, approval, next action |
| Knowledge and capability | Knowledge Hub, Identity Context, Capability Center | Structure, coverage, relationship, access |
| Specialized workspace | AI Chat, Voice Assistant | Sustained conversation and operation |
| Configuration center | Settings and its six sections | Find, understand, change, verify configuration |

The seven primary navigation entries and ten secondary business routes remain the
information architecture. A group entry may lead to its first child; it is not an extra
business page.

## 4. Theme contract

### 4.1 Reference theme

Geometric Modernism is the reference implementation:

- canvas: warm paper #f1ede3;
- ink: #101010;
- primary geometry: red #d52b32, yellow #f5c518, blue #2052b8;
- positive accent: green #158b69;
- panels: paper surfaces with a 2px ink outline;
- elevation: a 6px hard ink shadow, never a soft glass shadow;
- geometry: square by default, with circles and triangles used as deliberate accents;
- motion: clear but restrained translation, color, and opacity changes with no layout shift.

The reference theme keeps the current visual identity. It is not converted into a generic
dark SaaS dashboard.

### 4.2 All-theme compatibility

The structural language applies to aurora, cosmos-dark, animal-island, system-classic,
data-stream, soft-relief, geometric-modern, executive-brief, paper-ink, and swiss-modern.
The other nine themes remap semantic tokens; they are not independently redesigned in
this pass.

Canonical semantic tokens:

| Role | Token |
|---|---|
| Canvas | --talos-ui-canvas |
| Base surface | --talos-ui-surface |
| Raised surface | --talos-ui-surface-raised |
| Primary text | --talos-ui-ink |
| Secondary text | --talos-ui-muted |
| Hairline / grid | --talos-ui-line-subtle |
| Structural outline | --talos-ui-line |
| Primary accent | --talos-ui-accent |
| Secondary accent | --talos-ui-accent-2 |
| Tertiary accent | --talos-ui-accent-3 |
| Success | --talos-ui-success |
| Warning | --talos-ui-warning |
| Danger | --talos-ui-danger |
| Information | --talos-ui-info |
| Text on accent | --talos-ui-on-accent |
| Keyboard focus | --talos-ui-focus |
| Panel radius | --talos-ui-radius-panel |
| Control radius | --talos-ui-radius-control |
| Panel shadow | --talos-ui-shadow-panel |

Existing theme variables remain implementation inputs during migration. Shared components
consume the semantic tokens; page components must not branch on theme names for ordinary
color and spacing decisions.

## 5. Foundation scales

### 5.1 Spacing

Use a 4px base rhythm.

| Token | Value | Typical use |
|---|---:|---|
| space-1 | 4px | icon and label gap |
| space-2 | 8px | compact internal gap |
| space-3 | 12px | row and control padding |
| space-4 | 16px | card padding and grid gap |
| space-6 | 24px | section separation |
| space-8 | 32px | major page separation |

Do not introduce isolated 5px, 7px, 13px, 18px, or 22px spacing to visually repair a
single page. Choose the nearest shared step or change the component contract.

### 5.2 Typography

| Level | Reference size | Use |
|---|---:|---|
| Metadata | 11px | eyebrow, timestamp, source, badge |
| Supporting | 12px | descriptions, legends, helper text |
| Body | 14px | list rows, controls, values with labels |
| Module title | 15px | panel and card headings |
| Page title | clamp(24px, 2.2cqw, 32px) | compact page heading |
| Display value | clamp(24px, 2.6cqw, 40px) | one important metric only |

Keep the established 15 / 14 / 12 / 11 hierarchy. Use weight and whitespace before
inventing extra sizes. Use the existing system font stack and tabular numerals for metrics.

### 5.3 Lines, radius, and elevation

- structural modules and controls: 2px;
- metadata pills and internal rows: 1.5px;
- chart grid and heatmap cells: 1px;
- geometric-modern panel radius: 0;
- geometric-modern panel shadow: 6px 6px 0 current ink;
- nested cards do not each receive a full hard shadow;
- hover may change color or shadow offset but must not reflow surrounding content.

### 5.4 Motion and state

- quick feedback: 160ms;
- normal transition: 240ms;
- page or panel entrance: at most 420ms;
- loading, disabled, success, and error states are visible and text-labelled;
- focus-visible is always present;
- prefers-reduced-motion removes decorative movement and preserves state feedback.

## 6. Layout system

### 6.1 Shared shell

The existing left navigation, main canvas, secondary tabs, command access, and footer form
the product shell. Pages own only their content inside the main canvas.

Every page begins with a compact page header containing:

1. eyebrow or location;
2. page title and one-line purpose;
3. freshness or source status;
4. up to three page-level actions;
5. filters only when they affect multiple modules.

A decorative hero must not consume the first screen. Pixel-bot scenes may remain as a
small identity accent or empty-state illustration, not as a full-width repeated module.
In the unified v2 business-page header, that identity accent owns an 86px clipped safe
stage at `--pixel-scale: 1.25`; the bot baseline and track must be positioned inside that
stage rather than relying on visible overflow. The overview scene keeps its established
dimensions. Page-specific poses, props, theme colors, and `steps()` motion remain
unchanged.

### 6.2 Business-page first screen

At wide widths, dashboard and execution pages use a 12-column grid:

- columns 1–6: core data and a maximum of four high-value metrics;
- columns 7–12: approvals, anomalies, attention items, or executable next actions.

This is a functional 50 / 50 contract. When no real approval exists, the right side shows
real attention or action items; it must not invent an approval queue.

Below the first screen, modules use 4 / 8, 8 / 4, or 4 / 4 / 4 compositions according to
content. A full-width strip is reserved for a real timeline, hierarchy, or table that
benefits from the width.

### 6.3 Responsive behavior

- wide container, 1180px and above: 12 columns, 24px major gap;
- medium container, 760–1179px: 8 columns, 16px gap, balanced 4 / 4 first screen;
- narrow container, below 760px: one column, no horizontal scrolling;
- use component container queries before viewport-wide patches;
- approvals and blocking attention move before secondary statistics on narrow layouts;
- lists show a useful preview and a clear “view all” route instead of arbitrary fixed
  page heights or nested scroll traps.

## 7. Page archetypes

### 7.1 Data dashboard

Applies to Workbench, System Health, and Vault View.

Order:

1. compact header;
2. core metric strip;
3. 50 / 50 data-and-attention region;
4. one primary trend or distribution;
5. detail modules and drill-down.

The Workbench is the reference page for shared components. It must not repeat the same
module as both a navigation launcher and a content card.

### 7.2 Execution workbench

Applies to Daily Execution, Inbox, Output Room, Project Scenes, and TALOS Product.

Order:

1. compact header and current operating context;
2. throughput, age, progress, or gate metrics;
3. 50 / 50 status-and-action region;
4. prioritized queue;
5. schedule, platform, project, or release detail.

The primary action stays close to the item it affects. Avoid a separate generic action
card when the action belongs on a queue row.

### 7.3 Knowledge and capability

Applies to Knowledge Hub, Identity Context, and Capability Center.

Order:

1. compact header;
2. coverage and freshness summary;
3. hierarchy, relationship, or source map;
4. gaps and recommended actions;
5. searchable detail list.

These pages emphasize understanding and navigation. They use approvals only when a real
change or access decision is pending.

### 7.4 Specialized workspace

AI Chat keeps the DeepSeek and Codex surfaces mounted and switchable. The shared language
controls outer chrome, surface boundaries, tabs, buttons, status, and empty/error states;
it does not force conversation content into a dashboard grid.

AI Chat does not repeat an identity/title header inside the conversation surface. The
shared `chat-channel-switch` is mounted at the bottom of the primary navigation card
and is present only while the AI Chat route is active. Its labels, switch track, focus
state, motion, and compact reflow use the same navigation and control tokens. Expanded
labels receive content-aware asymmetric columns and must never be clipped; collapsed
navigation keeps only the compact track. Removing the duplicate header must not destroy
or remount either channel session.

Voice keeps its immersive stage, transcript, radial controls, and three-tab side panel.
It shares semantic state colors and component anatomy while retaining a local immersive
palette where needed. Read-only behavior is never weakened for visual convenience.

### 7.5 Configuration center

Settings uses a searchable two-pane workbench:

- persistent section navigation;
- section title, impact summary, and save state;
- related controls grouped into bounded sections;
- credentials and advanced options progressively disclosed;
- connection tests and validation next to the field they verify.

Settings does not use decorative charts. Dense provider and voice settings are split by
task, not merely by implementation module.

## 8. Shared component contracts

### Page shell and header

One DOM and class contract across business pages. Header height is content-driven and
compact; page identity never relies only on accent color.

### Metric card

Shows label, exact value, comparison or delta when real, timeframe, and data source or
freshness. A metric without a meaningful denominator is not rendered as a percentage.

### Chart panel

Contains title, one-sentence question, timeframe/filter, visualization, legend, source,
empty state, and drill-down action. Tooltip content is keyboard reachable.

### Approval row

Shows object, proposed effect, source, age, risk class, reversibility, and explicit
actions. Approval is item-local; a page-wide approve button is forbidden.

### Action queue

Uses clear priority, owner or source, due/age, status, and next action. Status color is
always paired with text or an icon label.

### Quick note

Provides a small persistent writing surface, visible save state, and a route to the full
note. Local drafts survive accidental navigation. It is not a decorative sticky note.

### Inline editor

Edits low-risk fields in context, supports cancel, validates before save, and reports the
result. Protected or high-impact content opens a proposal/diff flow instead.

### Detail drawer

Provides context, history, and advanced actions without expanding every card. It preserves
the page context and restores focus to the triggering control when closed.

### System states

Loading uses stable skeleton dimensions. Empty states explain why no data exists and
offer a real next step. Errors identify the failed operation and a safe retry or recovery.

## 9. Data visualization grammar

Use charts only when they answer a named question.

| Visualization | Use | Guardrail |
|---|---|---|
| Bar / column | compare categories, queues, throughput | sort intentionally; normally no more than 8 categories |
| Line / area | change over time | use a real time range and readable axis |
| Donut / pie | small composition | no more than 5 slices; show total and exact values |
| Tree / treemap | project, knowledge, or capability hierarchy | preserve labels and provide drill-down |
| Heatmap | activity, freshness, workload, or incidents over time | include legend and non-color status |
| Progress / gate | bounded completion with a real denominator | show numerator and denominator |
| KPI | one current value | include timeframe and context |

Forbidden:

- arbitrary percentages such as item-count divided by a visually convenient constant;
- charts whose values cannot be traced to collected data;
- 3D charts, ornamental gauges, unlabeled color blocks, or duplicate views of one metric;
- rendering zero when the correct state is unknown or unavailable.

Prefer accessible native SVG or DOM for the initial shared primitives. Add a chart library
only after a page requires interaction or scale that the primitives cannot safely provide.

## 10. Approval and editing behavior

Risk rules remain authoritative:

- A: read-only; execute directly and show the result.
- B: fixed scope and recoverable; clicking Approve authorizes that exact action. Show
  progress, result, and Undo when recovery is reliable.
- C: high impact; show proposal or diff first, then require an independent approval.

Every destructive-looking action states its target and effect. Buttons use explicit verbs,
not “OK”. Repeated clicks are prevented while an action is running. A failed action returns
to a retryable state and never displays success optimistically.

Small edits are allowed only for fields whose write contract is known. Project facts,
protected JSON, credentials, provider changes, and other governed content retain their
existing validation and confirmation paths.

## 11. Implementation order

0. Foundation: semantic tokens, shared primitives, archetype shells, responsive contract.
1. Workbench: reference implementation and component proof.
2. Workflow: Daily Execution, Inbox, Output Room, Project Scenes.
3. Knowledge Assets: Knowledge Hub, Identity Context, TALOS Product.
4. System Center: System Health, Capability Center, Vault View.
5. AI Chat: outer chrome and two-surface consistency.
6. Voice Assistant: stage, controls, side panel, and theme-state consistency.
7. Settings: information architecture, disclosure, validation, and save feedback.

For every page:

1. record the page question, real data, pending decisions, and allowed writes;
2. remove duplicate modules and decorative metrics;
3. restructure with the matching archetype and shared components;
4. map the page to semantic tokens without a page-specific theme fork;
5. run focused tests, typecheck, lint, and production build;
6. inspect at narrow, medium, and wide Obsidian pane widths;
7. visually verify geometric-modern and smoke-test the other nine themes;
8. record evidence before moving to the next page.

## 12. Acceptance checklist

A page is not complete until:

- its first screen has a clear situation and next action;
- business pages honor the data-and-attention 50 / 50 contract at wide width;
- no repeated giant hero or duplicate module launcher remains;
- every chart has a real source, timeframe, legend, empty state, and readable values;
- every visible approval or edit control calls a real handler and exposes outcome state;
- keyboard navigation, focus, contrast, and reduced motion work;
- 375px, 768px, 1024px, and 1440px content widths have no overlap or horizontal scroll;
- geometric-modern passes full visual review and all themes pass structural smoke review;
- page-content and business children are not height-forced;
- new hardcoded colors and broad important declarations are absent or explicitly justified;
- the production style bundle contains the intended source changes.

## 13. Anti-patterns

- one layout copied onto every page;
- a full-width hero repeated on every business route;
- long strips containing unrelated information;
- more than four equally prominent KPIs;
- cards nested three levels deep with borders on every level;
- charts used as decoration or as a substitute for exact values;
- approval controls separated from their target;
- hidden save state, optimistic success, or silent failure;
- hover-only meaning, invisible focus, color-only status, or layout-shifting motion;
- page-specific CSS appended merely to defeat an earlier page-specific override.

## 14. Professional references

- Carbon dashboards and chart selection:
  https://carbondesignsystem.com/data-visualization/dashboards/
- Grafana dashboard hierarchy and maintenance:
  https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/best-practices/
- SAP Fiori My Home task and approval workspace:
  https://experience.sap.com/fiori-design-web/explore_category/sap-s-4hana/
- Linear dashboard filtering and drill-down:
  https://linear.app/docs/dashboards

Adopt the information and interaction principles, not the visual skin. TALOS keeps its own
Bauhaus identity and Obsidian-native behavior.

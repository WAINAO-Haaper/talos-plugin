# TALOS Theme Design QA

## WP7 Task 15R Unified Console QA · 2026-07-25

- Result: passed. Task 16 was not started.
- Production composition: the unified console, approval actions and Provider tool
  proposals share one builtin action registry, `TalosTaskRunner`,
  `MemoryTaskStore` and `VaultRecoveryStore`.
- Task controls: fresh Obsidian evidence covers completed, structured partial,
  cancelled and reverted states. A running C-class task stayed running while all
  six primary pages were activated.
- Proposal safety: C-class actions expose steps, targets, key diffs and
  recoverability before a separate approval. The synthetic report hash stayed
  unchanged before approval and after cancellation.
- Provider center: the settings route now renders Provider, model, capability,
  connection and selected-state data without reading or displaying secret
  values. A local `mock-acceptance` provider was selected through the production
  control with no network request.
- Voice: the voice page exposes its independent history namespace and safely
  falls back to push-to-talk when continuous listening cannot start. No real
  microphone, TTS or network Provider was used.
- Visual evidence: six screenshots under `docs/qa/screenshots/` were captured
  from the temporary synthetic Vault or the read-only deployment check. Each
  screenshot was accepted only when its Vault title and visible state matched
  the accessibility tree returned by the same capture.
- Responsive/layout observation: the task drawer remained available without
  preventing navigation or obscuring the inspected action, Provider and system
  surfaces. The deployment system-center screenshot verifies the installed
  build in the real test Vault without exercising B/C writes.
- Automated regression: 46 test files / 245 tests, typecheck, lint, build,
  approval self-tests, Quyuan self-test and the 108-package license audit all
  passed.

final result: passed

## Comparison Target

- Source visual truth:
  - `https://novusgfx.github.io/retro-design-system/styles/32-matrix-rain/`
  - `https://novusgfx.github.io/retro-design-system/styles/37-neumorphism/`
  - `https://novusgfx.github.io/retro-design-system/styles/42-bauhaus/`
- Implementation:
  - `http://127.0.0.1:8765/theme-preview.html?theme=data-stream`
  - `http://127.0.0.1:8765/theme-preview.html?theme=soft-relief`
  - `http://127.0.0.1:8765/theme-preview.html?theme=geometric-modern`
- Combined comparison evidence:
  - `/private/tmp/talos-compare-32.png`
  - `/private/tmp/talos-compare-37.png`
  - `/private/tmp/talos-compare-42.png`
- Viewport: desktop 1280 x 720; responsive overflow check at 390 x 844.
- State: overview page, default interaction state after entrance animations settle.

## Findings

- No actionable P0/P1/P2 mismatch remains.
- Typography: each implementation preserves the reference hierarchy and category-appropriate fallback family. TALOS copy replaces reference demo copy intentionally.
- Spacing and layout: reference surface treatments are carried into the existing TALOS sidebar, hero, cards, grids and progress modules without changing the product information architecture.
- Colors and tokens: Data Stream retains black/green terminal contrast, Soft Relief retains the blue-gray single-material palette, and Geometric Modernism retains paper/black/red/yellow/blue primary geometry.
- Image and asset fidelity: the selected references are code-native CSS systems with no required bitmap imagery. Existing TALOS Lucide icons and logo remain intact.
- Copy: movie-specific Matrix copy and Bauhaus institutional labeling were intentionally removed for commercial safety; only the generic visual languages remain.
- Responsive: all three themes report equal client and scroll widths at 390 px. Data Stream reduces from 20 to 10 visible streams on small screens.
- Accessibility: text remains readable in the light themes; all three honor `prefers-reduced-motion`.

## Focused Region Comparison

- Hero, navigation controls, repeated metric cards and progress bars were inspected at desktop size.
- No additional crop was required because these elements are legible in the combined 1280 x 720 comparisons.

## Patches Made

- Added page-specific color temperatures for all ten TALOS routes.
- Limited Data Stream to 20 compositor-transformed columns and 10 on mobile.
- Replaced source-specific movie language with neutral TALOS data terminology.
- Added responsive single-column layouts and reduced-motion fallbacks.

## Follow-up Polish

- P3: validate final font rendering inside the user's Obsidian theme, because installed system fonts can vary.

## Module Selection QA

- Scope: atomic modules across overview, output, TALOS, inbox, health, projects, knowledge, capability and vault pages.
- Behavior: page modules now match navigation feedback: hover/focus changes color immediately; only one module remains selected inside each page/capability tab after click, with Enter/Space support.
- Theme coverage: Aurora, Nebula, Animal Island, Macintosh, Data Stream, Soft Relief and Geometric Modernism.
- Browser checks: all seven themes exposed a distinct background/border/text treatment; browser parsed the shared hover/focus/selected selector for every module class. Data Stream matched the requested bright fill with dark text; no theme introduced horizontal overflow.
- Accessibility: selected modules expose `role="button"`, `tabindex="0"` and `aria-pressed`; focus-visible and reduced-motion fallbacks are present.

## Jarvis Single-Page QA

- Reference: `/var/folders/k7/dshjdcm57656hcry_w22_w8c0000gn/T/TemporaryItems/NSIRD_screencaptureui_1PCwn7/截屏2026-06-28 03.12.23.png`.
- Prototype: `http://127.0.0.1:8765/theme-preview.html?theme=geometric-modern&page=jarvis`.
- Combined comparison: `/private/tmp/talos-jarvis-qa/combined.png`.
- Scope: Jarvis page only. Sidebar navigation remains; the persistent TALOS Hero and footer are removed from this page.
- Desktop result: at the reference viewport, the Jarvis panel fills the right column from 22px below the top to 22px above the bottom. The log expands to 951–979px across all seven themes, with the input bar anchored at the panel bottom.
- Responsive result: at 390x844, there is no horizontal overflow; the root becomes vertically scrollable so sidebar and conversation remain reachable.
- Regression check: selectors are scoped to `[data-talos-page="jarvis"]`; the other nine pages retain their existing Hero and flow layout.

## Daily Cockpit QA

- Source truth: this plugin's native "每日执行舱" page (the former standalone HTML and its migration markdown `每日操作系统.md` were both retired/removed on 2026-06-28 once native feature parity was verified).
- Prototype: `http://127.0.0.1:8765/theme-preview.html?theme=geometric-modern&page=daily`.
- Information parity: unique victory condition, start/finish commands, two deep-work blocks, fixed timeline, three rails, anti-choice protocol, weekday router and live file map are represented.
- Native integration: focus and `done_when` are parsed from `System/working-memory/tasks.md`; command controls copy their real invocation; all operational cards open their source file.
- Navigation: “每日执行舱” is the third item, directly below “屈原”.
- Theme coverage: `daily` variables exist for Nebula, Animal Island, Macintosh, Data Stream, Soft Relief and Geometric Modernism; Aurora inherits the base multicolor panel system.
- Responsive: two-column work area collapses at 1100px; command/protocol/week/map grids collapse progressively at 1100px and 680px.
- Browser check: daily route loaded with the Hero preserved, 4 command controls, timeline and 7-day router present, and no horizontal overflow at the desktop preview viewport.

## Full-Width And Output QA

- Source visual truth:
  - `/Users/apple/Desktop/截屏2026-06-28 04.02.56.png`
  - `/Users/apple/Desktop/截屏2026-06-28 04.03.07.png`
- Implementation screenshots:
  - `/private/tmp/talos-overview-fullwidth.png`
  - `/private/tmp/talos-output-fullwidth.png`
- Full-view comparison evidence:
  - `/private/tmp/talos-overview-comparison.jpg`
  - `/private/tmp/talos-output-comparison.jpg`
- Viewport and state: 1728×1084, Geometric Modern theme, overview and output routes; responsive regression at 390×844.
- Layout: the app spans exactly 1728px from left to right; root `clientWidth` equals `scrollWidth`, so the removed max-width does not create horizontal scrolling.
- Output grid: both panels remain inside the 1394px main column at equal widths; all 9 long rows report `scrollWidth <= clientWidth`.
- Content: output titles and status lines wrap instead of truncating; platform distribution remains inside the same main column.
- Responsive: at 390px the output grid resolves to one 370px track, root width remains 390px and no detail row overflows.
- Typography, colors, imagery and copy: existing theme typography/tokens and UI copy are preserved; this change only corrects frame sizing, grid contraction and text wrapping. No image assets were added or replaced.
- Patches made: removed all desktop app width caps, added `min-width:0` ownership boundaries, converted shared two-column tracks to `minmax(0,1fr)`, and enabled output-only multiline wrapping.

final result: passed

## Overview Compact Overlay Navigation QA · 2026-07-22

- Source visual: user-supplied Obsidian screenshot `截屏2026-07-22 07.24.44.png`.
- Implementation surface: `prototype/overview-operations-qa.html?theme=geometric-modern&page=overview`.
- Viewports: 1600×1000, 1024×768 and 390×844.
- Interaction states: resting rail, keyboard-focus expansion and focus-leave collapse.

**Findings**

- Desktop geometry: 72px resting rail expands to a 296px overlay; main remains x=72px / 1528px wide.
- Intermediate geometry: 72px resting rail expands to 260px; main remains x=72px / 952px wide.
- Narrow geometry: 54px resting rail expands to 260px; main remains x=54px / 336px wide.
- All three viewports keep `document.scrollWidth === document.clientWidth` (1600, 1024 and 390 respectively).
- All 12 commands are present. Resting state hides all labels; focus expansion exposes all 12 labels. At 390px every command remains horizontally contained and the expanded rail scrolls vertically when needed.
- Keyboard focus triggers the same overlay as pointer hover, and moving focus into main content restores the compact rail.
- Browser console reported no warning or error.

**Patches made**

- Generalized the existing compact shell/navigation selectors from detail-only to every TALOS page.
- Kept detail-page main padding and Jarvis height/scroll selectors page-scoped.
- Removed the retired overview-only horizontal mobile navigation rules that would override the shared 54px rail below 680px.
- Generalized the existing reduced-motion sidebar rule so overview width transitions are also disabled when requested.
- Added red/green self-test coverage for the shared shell contract and the removal of the overview horizontal-nav exception.

final result: passed

## Overview Approval Compatibility QA

- Date: 2026-07-22.
- Source: `src/view.ts`, `src/actions.ts`, `src/data/stats.ts`, `src/candidate-actions.ts`, and `styles.talos.css`.
- Harness: `prototype/overview-approval-compat-qa.html` using the generated production `styles.css`.
- Scope: independent pending-approval and preference-approval modules, compact health summary, complete long titles, action wrapping, and container-aware Obsidian pane reflow.
- Widths: approximately 900px, 700px, and 390px of requested pane space while the browser viewport remained 1500px wide, plus a real 390×844 mobile viewport.
- Themes: Aurora, Nebula, Animal Island, Macintosh, Data Stream, Soft Relief, Geometric Modern, Executive Brief, Paper Ink, and Swiss Modern.

**Findings**

- All 30 theme × pane-width combinations kept every approval item and action group inside its card (`clientWidth === scrollWidth` and action bounds inside item bounds).
- At approximately 900px, the operations area reflowed to one column while pending and preference approval remained side by side.
- At approximately 700px and below, pending approval stacked above preference approval.
- At approximately 390px, the health summary used one column, its ring remained 104px, and the stat wall reflowed without covering either approval module.
- The health summary desktop height is 132px, reduced from 170px without removing score, source count, refresh time, or broken-link data.
- Macintosh reports a theme-wide 2px scroll extent from its existing panel drop shadow. The approval titles, cards, and buttons still fit; the decorative shadow is not a content overflow and was left unchanged.
- The mobile visual inspection confirmed that pending approval shows all three actions and preference approval shows both actions without clipping or overlap.

**Automated checks**

- `tests/candidate-actions.test.ts`: preference approval/rejection write-back, target-section creation, failure immutability, and long-title exact matching.
- `tests/overview-layout.test.ts`: independent approval modules, full candidate titles, container queries, removal of the incompatible fixed minimum column pair, and wrapped action groups.

**Rollback**

- Original files are preserved under `backups/overview-approval-layout-20260722-before/` with a file-by-file restore checklist.

final result: passed

## TALOS Overview Operations Layout QA · 2026-07-04

- Source visual truth:
  - `prototype/overview-reference-option3.png` — 运行态势骨架。
  - `prototype/overview-reference-option2.png` — 待处理队列与详情工作区。
- Implementation screenshots:
  - `prototype/overview-operations-aurora-1440.jpg`
  - `prototype/overview-operations-geometric-1440.jpg`
  - `prototype/overview-operations-aurora-mobile-390.jpg`
  - `prototype/overview-hero-restored-geometric-1440.jpg`
- Full-view comparison evidence: `prototype/overview-operations-comparison.jpg`.
- Viewport/state: 1440×1024 desktop and 390×844 responsive; overview route; first exception selected.
- Focused comparison evidence: the full-view comparison keeps reference 2 and the implementation queue/detail region readable in the same frame, so no separate crop is required.

**Findings**

- No actionable P0/P1/P2 issue remains.
- Information architecture: option 3 supplies the sequence “verdict → three outcomes → attention → trust”; option 2 supplies the selectable exception list and recommendation detail. The implementation intentionally omits invented seven-day charts because the plugin has no equivalent trustworthy time series.
- Fonts and typography: the existing theme typography remains authoritative. Headline, metric, label and supporting-copy hierarchy are consistent across dark and light themes without introducing a new display family.
- Spacing and layout: desktop keeps a 236px navigation column and a two-column exception workspace. At 390px, the navigation becomes a horizontal rail and the verdict begins around 125px from the top instead of below a 593px navigation stack.
- Colors and tokens: all new surfaces consume existing `--surface`, `--surface-2`, `--line`, `--ink`, semantic color and component classes. Aurora, Nebula, Animal Island, Macintosh, Data Stream, Soft Relief and Geometric Modern retain distinct computed backgrounds, text and borders.
- Copy and content: progress, exception, focus and freshness values map to the existing task flow, publication room, health log, approval pool, inbox and preference candidates. No placeholder graph or decorative KPI was added.
- Icons: production uses the existing Obsidian icon system. The static QA harness leaves icon mounts empty rather than substituting emoji, inline SVG or CSS art.
- States and interaction: mouse selection and Enter-key selection both update the recommendation title/action; the verdict control scrolls to the exception area. Rows receive button semantics and keyboard focus.
- Responsiveness: all seven themes report equal client and scroll widths at 1440px; the 390px route also has no horizontal page overflow. Progress, exception detail, focus and trust grids collapse to one column.
- Accessibility: selected rows remain keyboard reachable, text wraps without clipping, and existing theme focus/reduced-motion behavior is preserved.

**Patches made**

- Replaced the old overview card collection with a decision-first operations layout.
- Added real-data helpers for outcome percentages, prioritized attention items and data-source freshness.
- Preserved the existing overview Hero after the user identified it as a required control-console module; only clock, shortcut and approval sidebar cards remain hidden on overview.
- Added the 680px horizontal navigation rail after responsive QA exposed excessive first-screen navigation height.
- Added a seven-theme interaction harness and same-input comparison evidence.

final result: passed

## Quyuan Four-State Particle Motion + Stage Layout QA

- Source visual truth: `/Users/apple/Documents/obsidian/超级大脑/04-项目/TALOS系统/07-控制台/talos-plugin/prototype/quyuan-particle-state-source.png`
- Implementation screenshot: `/Users/apple/Documents/obsidian/超级大脑/04-项目/TALOS系统/07-控制台/talos-plugin/prototype/quyuan-particle-state-speak-implementation.png`
- Viewport/state: 1280×720 implementation, Geometric Modern / Xuan-Paper theme, `speak` state.
- Full-view comparison evidence: `/Users/apple/Documents/obsidian/超级大脑/04-项目/TALOS系统/07-控制台/talos-plugin/prototype/quyuan-particle-state-comparison.png`
- Focused stage comparison evidence: `/Users/apple/Documents/obsidian/超级大脑/04-项目/TALOS系统/07-控制台/talos-plugin/prototype/quyuan-particle-state-stage-comparison.png`

**Findings**

- No actionable P0/P1/P2 issue remains.
- Fonts and typography: the four-step status flow increases from 12px to an 18–22px desktop scale and moves to the upper-left scanning origin. The Ma Shan Zheng answer headline remains the dominant display face and is anchored to the lower-right response zone.
- Spacing and layout rhythm: the particle/core center is now exactly 50%/50% of the stage. Status, particle and answer layers form three independent anchors; the footer remains clear and the functional side panel is unchanged.
- Colors and visual tokens: the Xuan-Paper light surface uses source-over particle compositing so mineral blue, moss and cinnabar remain legible instead of washing toward white. Dark themes retain additive lighter compositing.
- Image quality and asset fidelity: the centerpiece remains a real Canvas field. Particle count increases from 720 to 840 and no placeholder, CSS drawing or substitute image asset was introduced.
- Copy and content: the requested “聆听 / 识别 / 思考 / 回答” labels remain unchanged; “屈原在回答”, the interruption hint and live reply now occupy the lower-right response zone.
- Behavior and accessibility: listen/reco/think/speak use distinct motion profiles (RMS breathing, scanning convergence, counter-rotating vortex, outward answer waves), a 720ms state-entry energy transition and `aria-current="step"`. `prefers-reduced-motion` freezes time-driven deformation and disables the answer entrance animation.

**Patches made**

- Separated `.tq-flow` from `.tq-copy` in production and prototype DOM.
- Repositioned flow, core and response copy to upper-left, center and lower-right respectively.
- Added four state-motion configurations, light/dark compositing strategy and stronger particle/orbit visibility.
- Added state query support to the QA prototype and regression assertions for center coordinates, motion profiles and layout anchors.

**Follow-up polish**

- P3: a future TTS analyser could drive answer-wave amplitude from actual output audio; the current answer state uses a deterministic speech-like oscillator because the existing TTS layer does not expose playback RMS.

final result: passed

## Quyuan Resizable TALOS Interaction Panel QA

- Source visual truth: `/var/folders/k7/dshjdcm57656hcry_w22_w8c0000gn/T/TemporaryItems/NSIRD_screencaptureui_UUXi5r/截屏2026-07-01 03.19.50.png`.
- Implementation screenshot: `/private/tmp/quyuan-interaction-panel-final-stable-1440x1024.png`.
- Responsive screenshot: `/private/tmp/quyuan-interaction-panel-final-stable-390x844.png`.
- Viewport: 1440×1024 desktop; 390×844 responsive regression.
- State: Nebula, listening, session tab active, 380px interaction panel.
- Full-view comparison evidence: blocked. Browser security policy rejected the local file comparison page before capture.
- Focused right-panel comparison evidence: blocked by the same policy.

**Findings**

- Separate captures show no actionable P0/P1/P2 implementation defect, but visual equivalence cannot be passed without the required combined comparison input.
- Fonts and typography: the listening hierarchy is unchanged; right-panel labels use the existing TALOS UI stack. Long assistant output now renders through Obsidian MarkdownRenderer instead of exposing raw Markdown punctuation.
- Spacing and layout rhythm: the desktop grid measured `984px / 8px / 380px`; the panel has no internal horizontal overflow. At 390px, document, voice root, header and body all report equal client and scroll widths.
- Colors and visual tokens: buttons, segmented tabs, message bubbles and composer use the existing Quyuan theme variables, so all seven TALOS themes continue to own their colors.
- Image quality and asset fidelity: no new bitmap imagery or replacement logo was added. Production controls use Obsidian’s icon set.
- Copy and content: the right side is now a TALOS interaction surface rather than a raw transcript column—conversation is first, with context and capability tabs, quick prompts, status and a fixed composer.
- Interaction: collapse/expand passed; separator keyboard resize changed 360px to 380px; message submission cleared the composer and added a user bubble; context/session tab switching passed; browser console had no warning/error.
- Accessibility: the resize handle is a labelled vertical separator with keyboard support; collapse, clear, workbench and send controls have accessible names.

**Patches Made**

- Rebuilt header, dock, tabs and utility buttons with consistent translucent surfaces, state color, focus ring and press feedback.
- Added a persistent 280–560px panel width, pointer dragging, keyboard resizing, double-click reset and collapse/restore.
- Added the fixed conversation composer, quick prompts, default session tab and full workbench shortcut.
- Added Markdown rendering at the end of streamed responses and separated tool activity from streamed text.
- Removed the final 390px header clipping by compacting the title and hiding only the redundant settings shortcut at that breakpoint.

**Blocking Item**

- Product Design QA requires source and implementation in one comparison input. The in-app browser blocked the local comparison page by security policy, so this report cannot honestly be marked passed. The source changes remain undeployed.

final result: blocked

## Quyuan Xuan-Paper Background + TALOS Header QA

- Source visual truth: `prototype/quyuan-background-xuan-paper-target.png` (selected concept 3, “宣纸晨雾”).
- User header evidence: `/var/folders/k7/dshjdcm57656hcry_w22_w8c0000gn/T/TemporaryItems/NSIRD_screencaptureui_gUMGpK/截屏2026-07-03 09.26.58.png`.
- Approved logo source: `../../02-品牌资产/TALOS-Favicon-64-v1.png`.
- Implementation screenshot: `prototype/quyuan-background-xuan-paper-implementation.png`.
- Full-view comparison evidence: `prototype/quyuan-background-xuan-paper-comparison.png`.
- Focused header comparison evidence: `prototype/quyuan-background-xuan-paper-header-comparison.png`.
- Viewport: 1586×992 desktop; responsive regression at 390×844.
- State: Geometric Modern theme. The concept image shows the waiting/empty state while the implementation evidence shows listening with sample conversation content; comparison therefore treats content/state as intentional and checks palette, typography, surface hierarchy, header structure, logo fidelity and fit.

**Findings**

- No actionable P0/P1/P2 issue remains.
- Fonts and typography: the Ma Shan Zheng display face remains limited to the voice-state headline; interface copy stays on the existing PingFang/SF stack. Primary text `#25231f` on `#f1ebdd` reaches 13.20:1 contrast.
- Spacing and layout rhythm: the header is a 72px brand/action bar with a 42px logo tile, grouped status controls and unchanged body geometry. At 390×844, brand and actions remain on one row with no horizontal overflow.
- Colors and tokens: Geometric Modern now maps to warm paper `#f1ebdd`, soft paper `#f7f2e8`, panel `rgba(236,227,210,.94)`, deep ink `#25231f`, muted ink `#5f5a52` and faint ink `#70695f`. Muted and faint text reach 5.75:1 and 4.56:1 respectively. Mineral blue, moss, cinnabar and ochre particles remain subordinate to copy.
- Image quality and asset fidelity: the former “屈” text badge is replaced by the approved TALOS Modular T-Shield favicon asset, not a recreated glyph, CSS drawing or approximate icon. The 64px source is rendered at an effective crisp symbol size inside a 42px tile.
- Copy and content: all product wording, status text, buttons, tabs and conversation content remain unchanged.
- Interaction: the existing Uiverse black-pill button system, selected states, side-panel controls and responsive behavior are preserved. The concept’s cream action buttons were intentionally not copied because the user had explicitly standardized these controls as black pills in the preceding iteration.

**Patches Made**

- Replaced Geometric Modern’s dark Quyuan tokens with the selected xuan-paper light palette and added a matching light navigation rail.
- Removed dark text shadows, softened the footer elevation and remapped particle/state colors for a light surface.
- Grouped the top bar into brand and action clusters; replaced the “屈” badge with the approved TALOS favicon and added responsive logo sizing.
- Darkened the faint-text token from `#756e63` to `#70695f` after contrast review.
- Added desktop and 390px regression assertions; typecheck, focused lint, 62/62 self-tests and production build pass.

**Follow-up Polish**

- No blocking polish remains. Conversation-state differences between concept and QA evidence are functional content differences, not visual-system drift.

final result: passed

## Quyuan Particle Voice Workspace QA

- Source visual truth: `/Users/apple/.codex/generated_images/019f1673-18fc-7800-8178-d8574756bb80/call_54mRWON9o66czZgU9J7NBSPc.png`.
- Implementation screenshot: `/private/tmp/quyuan-particle-nebula-final-verified-v3.png`.
- Viewport: 1440×1024 desktop; responsive regression at 390×844.
- State: Nebula theme, listening state, microphone level fixed for deterministic capture.
- Full-view comparison evidence: `/private/tmp/quyuan-particle-final-comparison.png`.
- Focused region comparison evidence:
  - `/private/tmp/quyuan-particle-final-central-comparison.png`
  - `/private/tmp/quyuan-particle-final-sidebar-comparison.png`
  - `/private/tmp/quyuan-particle-narrow-final-stable-390x844.png`

**Findings**

- No actionable P0/P1/P2 mismatch remains.
- Fonts and typography: the implementation preserves the mock's dominant listening copy hierarchy with an 82px desktop headline, high-contrast white foreground and a localized copy shield. Supporting text remains readable while front-layer particles pass over it at reduced opacity.
- Spacing and layout rhythm: the selected three-part composition is preserved—narrow navigation rail, full-height voice stage and 330px functional sidebar. Root and document both report `clientWidth === scrollWidth === 1440px`; the 390px view also reports equal client and scroll widths.
- Colors and visual tokens: Quyuan owns independent surface, text, border and particle variables for Aurora, Nebula, Animal Island, Macintosh, Data Stream, Soft Relief and Geometric Modernism. Theme switching changes tokens without changing structure.
- Image quality and asset fidelity: the central visual is a real animated Canvas particle field rather than a placeholder image. Production navigation and controls use Obsidian's icon library; no fake raster logo or handcrafted replacement icon was introduced.
- Copy and content: the prominent listening copy, five-stage voice flow and current transcript are product-specific and legible. The right sidebar is functionally distinct, exposing real context files, runtime capabilities and session state.
- Interaction and accessibility: microphone RMS drives particle displacement; idle/listen/reco/think/speak states change semantic color and motion. Sidebar tabs, settings, engine, interruption and workbench controls are wired. Focus-visible and reduced-motion fallbacks remain present.
- Responsive behavior: at 390×844 the stage and sidebar stack vertically, the 54px rail remains fixed, and the three bottom controls plus meter fit without clipping or overlap.

**Patches Made**

- Removed the inherited theme root pseudo-element and background effect from the Quyuan route, eliminating the final 29px horizontal overflow and redundant animation work.
- Rebalanced the mobile voice controls to three shrinkable 68px targets plus the live level meter.
- Removed an unnecessary type assertion and completed targeted lint cleanup.

**Follow-up Polish**

- P3: the source mock uses richer volumetric ribbon lighting; the implementation intentionally uses a performance-safe Canvas particle/orbit system to protect Obsidian responsiveness while retaining the same futuristic voice-first hierarchy.

final result: passed

## Quyuan Fixed Single-Row Controls QA

- Source visual truth: `/Users/apple/Desktop/截屏2026-06-29 13.57.23.png`.
- Implementation screenshot: `/private/tmp/quyuan-fixed-single-row-final-405x990.png`.
- Full-view comparison evidence: `/private/tmp/quyuan-control-row-comparison.png`.
- Focused region comparison evidence:
  - `/private/tmp/quyuan-control-row-top-comparison.png`
  - `/private/tmp/quyuan-control-row-bottom-comparison.png`
- Viewport and state: source normalized from 810×1980 to 405×990; implementation captured at 405×990, new conversation, permission “每次询问”, voice off. Additional no-overflow regression at 320×800.

**Findings**

- No actionable P0/P1/P2 issue remains.
- Fonts and typography: “权限” is preserved in full at 405px and 320px; no breakpoint substitutes it with a one-character abbreviation. All bottom labels remain visible on one line.
- Spacing and layout rhythm: the top status bar remains a three-column single row (`待命 / 权限+选择框 / 能力`) at every tested width. The bottom toolbar remains a single flex row; 405px reports `clientWidth === scrollWidth === 365px`, and 320px reports `clientWidth === scrollWidth === 285px`.
- Colors and visual tokens: existing paper, ink, red, cyan, orange and green TALOS tokens are unchanged.
- Image quality and asset fidelity: no image or icon substitutions were introduced; production continues to use Obsidian’s icon set.
- Copy and content: permission, capability, model, effort, context/MCP, YOLO and voice controls remain present. No control is hidden to make the row fit.
- Interaction: the voice control now uses a real label/input/track structure instead of a pseudo-element on a replaced input. Browser interaction toggled it successfully, moved the knob 16px and produced no console warning/error.
- Responsive behavior: at 405px all four action buttons share identical top/bottom coordinates; top and bottom control groups stay in their original order. At 320px the root, status bar, action row and toolbar have no horizontal overflow.

**Patches Made**

- Removed the 440px breakpoint that moved capability and voice controls onto second rows.
- Kept the status bar on three shrinkable grid tracks and restored the complete “权限” label.
- Forced the bottom workbench to one non-wrapping row with proportionally shrinking text, spacing, icons and switches.
- Rebuilt the voice switch with a stable hidden checkbox plus visible track/knob, including checked and focus-visible states.
- Added a 360px compact scale without reordering, wrapping or hiding controls.
- Expanded Quyuan regression coverage from 19 to 22 assertions.

**Follow-up Polish**

- P3: at extremely narrow widths below 320px, readable text and complete v2 option coverage become physically constrained; 320px is the verified minimum supported panel width.

final result: passed

## Quyuan v2 · v1 Shell Responsive QA

- Source visual truth: `/var/folders/k7/dshjdcm57656hcry_w22_w8c0000gn/T/TemporaryItems/NSIRD_screencaptureui_dXviTs/截屏2026-06-29 13.23.40.png`.
- Implementation screenshot: `/private/tmp/quyuan-v2-responsive-504x1000.png`.
- Full-view comparison evidence: `/private/tmp/quyuan-responsive-comparison.png`.
- Focused control comparison evidence: `/private/tmp/quyuan-responsive-controls-comparison.png`.
- Viewport and state: source normalized from 1006×1996 to 504×1000; implementation captured at 504×1000, new conversation, light v1 shell. Responsive regressions also checked at 788×1200 and 390×844.

**Findings**

- No actionable P0/P1/P2 mismatch remains.
- Fonts and typography: the v1 Kaiti/Songti welcome hierarchy is preserved. The main greeting now uses container-relative sizing and `nowrap`, so “来，落一笔。” remains one line at all tested widths.
- Spacing and layout rhythm: fixed-pixel controls were replaced with continuous container-relative dimensions. At 504px, the status bar, input, four equal action buttons and bottom toolbar all remain inside their frame; at 390px the capability control and dense toolbar use compact second rows rather than clipping.
- Colors and visual tokens: the existing TALOS paper, ink, red, cyan, orange and green tokens are unchanged.
- Image quality and asset fidelity: no new image assets, approximate logos or replacement icons were introduced. Production continues to use Obsidian’s icon library.
- Copy and content: v1 shell wording and every v2 option remain present. Permission, capability panel, image, voice, stop, send, model, thinking, context, MCP and YOLO controls are not hidden.
- Interaction: capability panel opens, permission selection changes, and voice toggle state changes in the browser harness. The page reported no console warnings/errors.
- Responsiveness: root `clientWidth === scrollWidth` at 788, 504 and 390px. The 504px footer toolbar reports `clientWidth === scrollWidth` (458px), and the welcome greeting remains a single line.

**Patches Made**

- Added a named inline-size container for the embedded Quyuan shell.
- Converted header, status, welcome, composer, action row and toolbar sizes from fixed pixels/viewport units to `clamp()` plus container-query units.
- Replaced the action-row flex layout with four equal shrinkable grid tracks.
- Added 620px compact and 440px ultra-narrow container layouts without removing v2 controls.
- Expanded the Quyuan self-test from 14 to 19 assertions to protect container responsiveness, greeting wrapping and four-button grid behavior.

**Follow-up Polish**

- P3: exact Kaiti glyph rendering remains dependent on the macOS font fallback available inside the user’s Obsidian installation.

final result: passed

## Dark Theme Settings Modal QA

- Source visual truth:
  - `/Users/apple/Desktop/截屏2026-06-28 18.35.19.png`
  - `/Users/apple/Desktop/截屏2026-06-28 18.35.24.png`
  - `/Users/apple/Desktop/截屏2026-06-28 18.35.41.png`
- Test surface: `prototype/vault-theme-sync-qa.html?settings=1&theme=<theme>`.
- Viewport: default 1280×720; Aurora, Nebula and Data Stream states.
- Root cause: the whole-vault dark themes supplied light interface text while Obsidian’s nested settings panes retained a white background.
- Layout: settings header, navigation and content remain inside the modal with no horizontal overflow.
- Colors: settings content and sidebar now inherit dedicated dark theme surfaces. Primary text contrast is 19.45:1 / 19.13:1 / 19.13:1; description contrast is 11.60:1 / 10.04:1 / 11.05:1; inactive navigation contrast is 11.20:1 / 9.80:1 / 10.76:1.
- Interaction: hover and active navigation states use each theme’s native accent and remain visually distinct.
- Typography and copy: existing font stacks and wording are unchanged; only background, foreground, border and state colors were corrected.
- Patches made: scoped explicit settings-modal variables and surfaces to the three dark themes; covered nested panes, navigation, titles, descriptions, controls, close button and TALOS settings tabs.

final result: passed

## Jarvis Text-Only Welcome + Voice Toggle QA

- Source visual truth: `/private/tmp/talos-welcome-comparison.png` (previous black-card welcome state).
- Implementation screenshot: `/private/tmp/talos-welcome-voice-final.png`.
- Full-view comparison evidence: `/private/tmp/talos-welcome-voice-final-comparison.png`.
- Focused responsive evidence: `/private/tmp/talos-welcome-voice-narrow-final.png`.
- Viewport: 545×981 standard sidebar; 390×844 narrow-sidebar regression.
- State: Geometric Modern theme, new conversation, voice switch tested off then on.

**Findings**

- No actionable P0/P1/P2 issue remains.
- Typography: the Kaiti headline and Songti subtitle are preserved; only foreground colors changed.
- Spacing and layout: the welcome treatment has transparent background, `0px` border and no shadow. The 390px layout remains free of horizontal overflow; the bottom control row wraps safely.
- Colors and tokens: on the `#f1ede3` page background, the title `#a8232f` reaches 6.10:1 contrast, eyebrow `#625d55` reaches 5.59:1 and subtitle `#292622` reaches 12.88:1.
- Image and asset fidelity: no new imagery or icon asset was introduced.
- Copy: welcome wording is unchanged.
- Interaction: voice defaults off and the microphone control is disabled. Switching voice on turns the control green and enables the microphone. Production code also gates automatic TTS, stops STT/TTS immediately when switched off, persists `jarvisVoiceEnabled`, and makes the Stop action end microphone capture.

**Patches Made**

- Removed welcome background, border, radius and shadow; retained only font-family, size and foreground-color hierarchy.
- Added the persistent `jarvisVoiceEnabled` setting and bottom-bar voice switch.
- Gated live answer narration and permission narration behind the voice switch.
- Synchronized the compiled plugin and stylesheet to `.obsidian/plugins/talos/`.

final result: passed

## Jarvis New-Conversation Welcome QA

- Source visual truth: `/Users/apple/Desktop/截屏2026-06-28 16.47.25.png`.
- Implementation screenshot: `/private/tmp/talos-welcome-implementation.png`.
- Full-view comparison evidence: `/private/tmp/talos-welcome-comparison.png`.
- Focused responsive evidence: `/private/tmp/talos-welcome-narrow.png`.
- Viewport: 545×981 sidebar comparison; 390×844 narrow-sidebar regression.
- State: source shows an active conversation; implementation intentionally shows the new-conversation empty state. Comparison therefore checks design-system continuity, hierarchy and fit rather than identical content.

**Findings**

- No actionable P0/P1/P2 issue remains.
- Typography: the headline resolves through the available `"Kaiti SC" → "STKaiti" → "KaiTi" → Songti` stack at 36px desktop and 26px narrow width. The smaller subtitle uses a Songti/serif stack. Both remain on one line in the tested widths without clipping.
- Spacing and layout: the desktop card is 440×165.6px and centered inside the 513×613.9px message area. At 390px viewport it becomes 310×140.6px, stays fully inside the frame and introduces no horizontal overflow.
- Colors and tokens: Geometric Modern uses `#101010` card, `#f1ede3` text and `#d52b32` accent edge/shadow, preserving the source screen’s warm paper, black and red language while creating materially stronger contrast than the former muted empty text.
- Image and asset fidelity: the empty state introduces no imagery, logo replacement, icon approximation or generated asset. Existing controls and theme materials remain unchanged.
- Copy: the former operational paragraph is reduced to “屈原 · 新对话 / 来，落一笔。/ 剩下的，我们一起想透。” The wording is short, specific to the product voice and contains no implementation instructions.

**Patches Made**

- Replaced the plain empty-state string with structured welcome markup in `src/jarvis/panel.ts`.
- Added high-contrast welcome-card styling, artistic Chinese system-font fallbacks and a 420px responsive rule.
- Added `prototype/sidebar-welcome-qa.html` and synchronized the production build to `.obsidian/plugins/talos/`.

**Follow-up Polish**

- P3: the exact glyph shape varies slightly if the operating system lacks Kaiti SC and falls back to Songti; the hierarchy and dimensions remain safe.

final result: passed

## Quyuan Dynamic Particle Color QA

- Source visual truth: `/Users/apple/Documents/obsidian/超级大脑/04-项目/TALOS系统/07-控制台/talos-plugin/prototype/quyuan-particle-state-speak-implementation.png`
- Implementation screenshots:
  - `/Users/apple/Documents/obsidian/超级大脑/04-项目/TALOS系统/07-控制台/talos-plugin/prototype/quyuan-particle-color-speak-final.png`
  - `/Users/apple/Documents/obsidian/超级大脑/04-项目/TALOS系统/07-控制台/talos-plugin/prototype/quyuan-particle-color-listen-final.png`
- Viewport/state: 1280×720, Geometric Modern / Xuan-Paper theme, `speak` and `listen`.
- Full-view comparison evidence: `/Users/apple/Documents/obsidian/超级大脑/04-项目/TALOS系统/07-控制台/talos-plugin/prototype/quyuan-particle-color-comparison.png`
- Focused stage comparison evidence: `/Users/apple/Documents/obsidian/超级大脑/04-项目/TALOS系统/07-控制台/talos-plugin/prototype/quyuan-particle-color-stage-comparison.png`

**Findings**

- No actionable P0/P1/P2 issue remains.
- Fonts and typography: unchanged from the passed stage-layout QA; particle color remains behind the display copy and does not reduce title or supporting-text legibility.
- Spacing and layout rhythm: unchanged. The upper-left flow, centered field, lower-right response copy, footer and functional side panel retain their previous geometry.
- Colors and visual tokens: particles now interpolate per particle from phase, orbit angle, state wave and energy. Listen is mineral-blue dominant, recognition is blue/green, thinking is blue/violet, and speaking alternates cinnabar, mineral blue and moss. The first warm-heavy speaking pass was rejected and patched with lower state-color coverage plus cool-color flashes.
- Image quality and asset fidelity: the effect remains a real Canvas particle system. One in 19 particles receives a low-alpha dynamic halo; pulse rings and orbit paths use animated palette interpolation. No raster placeholder, CSS illustration or substitute visual asset was introduced.
- Copy and content: unchanged.
- Behavior and accessibility: reduced-motion fixes animation time at zero, so color placement remains static with motion disabled. State color remains semantically dominant without collapsing every particle to one hue.

**Patches made**

- Added `stateColorFlow()` with dedicated listen/reco/think/speak color motion.
- Added sparse particle halos and animated pulse/orbit color interpolation.
- Deepened the Xuan-Paper mineral palette while keeping the paper surface and typography unchanged.
- Reduced speaking-state warm-color dominance after the first visual pass.

final result: passed

## TALOS Grouped Navigation QA · 2026-07-04

- Structural truth: the vault's current top-level responsibilities and the plugin's runtime collectors (`src/data/stats.ts`, `src/data/navigation.ts`).
- Visual source: `prototype/overview-operations-aurora-1440.jpg` (previous flat navigation using the existing Aurora theme).
- Implementation screenshots:
  - `prototype/navigation-grouped-aurora-1440.jpg`
  - `prototype/navigation-grouped-mobile-390.jpg`
- Same-input comparison: `prototype/navigation-comparison.jpg`.
- Viewports: 1440×1024 desktop and 390×844 responsive.

**Findings**

- No actionable P0/P1/P2 issue remains.
- Information architecture: 12 pages are grouped into four actual work domains—Now, Flow, Assets and System—instead of presenting 11 unrelated peers. Logs, archives, templates, automation, config, deployment templates and attachments remain discoverable through aggregate system/vault pages rather than competing for first-level space.
- Real data: navigation metadata is computed from current focus, overview attention, inbox, output queue, project folders, insight/material counts, Identity/Soul modules, TALOS assets, health score, capabilities and the six-directory knowledge total.
- New coverage: “身份上下文” exposes the previously invisible `Identity/`, `灵魂/` and `System/working-memory/` layer using real file actions and current focus/governance counts.
- Typography and spacing: group labels add hierarchy without increasing command density. All 12 desktop rows fit their containers; Data Stream's 2px parent scroll difference is caused by its border treatment, while every command reports equal client and scroll width.
- Theme fidelity: Aurora, Nebula, Animal Island, Macintosh, Data Stream, Soft Relief and Geometric Modern retain their existing active borders, surfaces and text treatment. The new badges only consume existing semantic tokens.
- Interaction: pointer selection and Enter-key selection both leave exactly one active navigation item.
- Responsive: at 390px, groups use `display: contents`, group labels hide and all commands remain reachable in the existing horizontal rail. The page client/scroll widths remain 390px and the overview starts at 122px.
- Accessibility: production entries retain Lucide icons, accessible labels, `aria-current` and keyboard activation; alert badges are supplemental text rather than color-only signals.

**Patches made**

- Added grouped `PageDef` metadata and real-time status badges.
- Reordered pages to follow present work → flow → assets → system.
- Added the Identity Context page and renamed “TALOS 漏斗” to “TALOS 产品”.
- Updated the navigation regression self-test for grouped Lucide icons.

final result: passed

## TALOS Navigation Scale QA · 2026-07-04

- Source visual truth: `prototype/navigation-scale-source-geometric.png` (Obsidian Geometric Modern screenshot).
- Implementation screenshot: `prototype/navigation-scale-geometric-1440.png`.
- Viewports: 1440×1024 desktop across all seven themes; 390×844 responsive regression.

**Findings**

- No actionable P0/P1/P2 issue remains.
- Proportion: the overview navigation rail is 296px on desktop. Geometric Modern commands measure 52px rendered height, with a 30px icon; other themes resolve to 48–52px according to their existing border treatment.
- Typography: group labels measure 12px, page labels 15px and status badges 10.5px. Macintosh's theme-specific 12.5px page-label override is deliberately normalized to 15px without changing its font, color or material treatment.
- Theme fidelity: Aurora, Nebula, Animal Island, Macintosh, Data Stream, Soft Relief and Geometric Modern retain their existing surfaces, borders, shadows, active states and semantic colors. Only dimensions and type scale changed.
- Responsive: at 390×844, commands remain in the existing horizontal rail; page labels resolve to 14px, icons to 26px and rendered rows to 46px. The document client and scroll widths both remain 390px.
- Overflow: all seven desktop themes report equal 1440px client and document scroll width.

**Patches made**

- Increased desktop overview navigation width to 296px.
- Increased group labels, page labels, status badges, command height, padding, spacing and icon scale as one proportional system.
- Added a compact mobile scale so the larger desktop dimensions do not consume the narrow-screen first view.

final result: passed

## TALOS Light Navigation + Unified Hero QA · 2026-07-04

- Source screenshots:
  - `prototype/nav-contrast-source-geometric.png`
  - `prototype/hero-unified-source-system-classic.png`
- Implementation screenshots:
  - `prototype/nav-contrast-geometric-1440.png`
  - `prototype/hero-unified-system-classic-1440.png`
- Viewports: 1440×1024 across all seven themes; 390×844 responsive regression.

**Findings**

- No actionable P0/P1/P2 issue remains.
- Navigation contrast: light-theme non-active labels no longer inherit Aurora's white gradient. Animal Island is the limiting case; its amber-group labels now measure 4.74:1 against the card surface. Soft Relief measures at least 4.59:1, Geometric Modern at least 8.30:1 and Macintosh 18.88:1.
- Shared Hero contract: every theme now renders the same brand eyebrow, title, subtitle, Logo module and TALOS proposition card. Desktop title size is 57.6px and Logo modules measure 112×100px in all themes.
- Hero proportion: Aurora, Nebula, Animal Island, Data Stream and Soft Relief measure 260px; Geometric Modern measures 266px; Macintosh measures 267px because its authentic 22px window title bar requires extra inset.
- Theme fidelity: each theme retains its own colors, background treatment, borders, radii, shadows, Logo treatment and animation. Nebula keeps orbital/starfield decoration as the shared Hero's background instead of replacing the Hero with a second content structure.
- Responsive: all seven themes report equal 390px client and document scroll widths. Titles resolve to 31px and remain inside the Hero.

**Patches made**

- Removed gradient text fill from non-active navigation labels in four light themes and mixed group accents into each theme's ink color.
- Added one overview Hero geometry contract after theme-specific skins.
- Returned Nebula from its separate cosmos scene to the common Hero content structure while preserving cosmic decoration.
- Expanded the overview QA harness to include the real Hero hierarchy and packaged TALOS icon asset.

final result: passed

## Quyuan Full Navigation Recovery QA · 2026-07-05

- Source visual truth: user-supplied Obsidian screenshot `截屏2026-07-05 01.16.56.png`.
- Implementation surface: `prototype/quyuan-voice-particle-qa.html?layoutOnly=1`.
- Viewport: 1600×1000, Geometric Modern, Quyuan voice page.

**Findings**

- No actionable P0/P1/P2 issue remains.
- Root cause: the Quyuan shell still forced the app grid to a legacy 68px icon rail after navigation had evolved into four groups and twelve labeled pages.
- Restored geometry: desktop navigation is 296px; the main Quyuan workspace receives the remaining 1304px. The document client and scroll widths both measure 1600px.
- Content visibility: all 12 page labels are present and visible. Labels render at 15px, marks at 30px and metadata badges at 10.5px.
- Active state: the Geometric Modern “屈原” label resolves to `rgb(37,35,31)` on its pale active surface instead of inheriting the former light gradient.
- Scope: the voice stage, particle scene, footer controls and TALOS interaction panel were not structurally changed.

**Patches made**

- Removed Quyuan-only rules that hid section titles and marks or forced every navigation command into a 50px square.
- Restored the shared grouped navigation component at 296px desktop and 260px intermediate width.
- Kept the existing 54px compact rail only below the established 760px breakpoint.
- Updated the Quyuan regression fixture and self-test to encode the full-navigation contract.

final result: passed

## Quyuan Overlay Navigation QA · 2026-07-05

- Source visual truth: user-supplied Obsidian screenshot `截屏2026-07-05 02.26.18.png`.
- Implementation surface: `prototype/quyuan-voice-particle-qa.html?layoutOnly=1`.
- Viewport: 1600×1000, Geometric Modern, Quyuan voice page.

**Findings**

- No actionable P0/P1/P2 issue remains.
- Resting state: the navigation occupies 72px and the Quyuan workspace occupies the remaining 1528px. All 12 marks stay visible while labels and badges are intentionally hidden.
- Expanded state: pointer hover or keyboard focus opens a 296px overlay with all four group labels and all 12 page labels visible.
- Stable workspace: expansion overlays the first 224px of the stage instead of changing grid tracks; the workspace stays at x=72px and 1528px wide.
- Overflow: document client and scroll widths both measure 1600px in collapsed and expanded states.
- Accessibility: navigation entries expose button semantics, enter the Tab order, and activate with Enter or Space.
- Scope: theme materials, voice stage, footer controls and TALOS interaction panel remain unchanged.

**Patches made**

- Replaced the always-open Quyuan sidebar with a 72px resting rail and 296px hover/focus overlay.
- Added a 260px intermediate expanded width and retained the established 54px compact breakpoint.
- Added reduced-motion handling and keyboard activation.
- Updated the Quyuan regression contract.

final result: passed

## Quyuan Collapsed Rail Clipping QA · 2026-07-05

- Source visual truth: user-supplied Obsidian screenshot `截屏2026-07-05 03.11.00.png`.
- Implementation surface: `prototype/quyuan-voice-particle-qa.html?layoutOnly=1`.
- Viewport: 1600×1000, Geometric Modern, Quyuan voice page.

**Findings**

- No actionable P0/P1/P2 issue remains.
- Root cause: Geometric Modern's full navigation card retained its 14px padding, 2px border, shadow and decorative pseudo-elements inside the 72px rail.
- Collapsed geometry: the card chrome resolves to zero padding, zero border and no shadow; both pseudo-elements are hidden.
- Button containment: all 12 commands fit inside the rail. Their combined horizontal bounds are x=10.5–60.5px inside the 0–72px sidebar.
- Expanded fidelity: keyboard focus restores the 296px sidebar, 14px card padding, 2px theme border, four group labels and all 12 page labels.
- Overflow: document client and scroll widths both measure 1600px.

**Patches made**

- Removed full-card chrome only while the sidebar is neither hovered nor focus-within.
- Centered 50px commands and groups in the collapsed rail.
- Restored normal theme geometry automatically in the expanded state.

final result: passed

## All Detail Pages Compact Navigation QA · 2026-07-05

- Source visuals: user-supplied Obsidian screenshots `截屏2026-07-05 12.11.42.png` and `截屏2026-07-05 12.05.09.png`.
- Implementation surface: `prototype/overview-operations-qa.html?page=vault`.
- Viewports: 1600×1000, 1024×768 and 390×844.
- Themes: Aurora, Nebula, Animal Island, Macintosh, Data Stream, Soft Relief and Geometric Modern.

**Findings**

- No actionable P0/P1/P2 issue remains.
- Scope: overview remains a 296px full navigation page with all 12 labels visible. Every non-overview page uses the compact navigation contract.
- Desktop detail geometry: 72px rail + 1528px main at 1600px. Focus expansion is a 296px overlay and leaves the main at x=72px / 1528px wide.
- Intermediate geometry: 72px rail + 952px main at 1024px. Expansion resolves to 260px without changing the main track.
- Narrow geometry: 54px rail + 336px main at 390px; all 12 command boxes stay within the rail.
- Sidebar focus: clock, action and approval cards are hidden on detail pages, leaving one navigation surface.
- Theme regression: all seven themes render 12 contained commands, zero collapsed labels, a 72px rail and zero horizontal overflow.
- Content proportion: detail-page main padding scales 18px → 14px → 10px across desktop, intermediate and narrow widths.

**Patches made**

- Generalized the Quyuan compact navigation contract to `:not([data-talos-page="overview"])`.
- Preserved Quyuan's zero-padding voice workspace while assigning normal content padding to the other detail pages.
- Added page switching to the overview QA fixture for overview/detail regression checks.
- Updated the navigation regression contract.

final result: passed

## Latest QA Status

- Current build: All Detail Pages Compact Navigation QA.
- Evidence: the user-supplied overview/detail screenshots and the page-aware QA fixture.
- Result: no actionable P0/P1/P2 issue remains. Overview keeps the full navigation; all eleven detail pages share the compact overlay navigation.
- Layout result: desktop 72+1528, intermediate 72+952 and narrow 54+336; expansion never changes the main track.
- Scope: detail-page content modules, theme materials and page behavior remain unchanged.
- Deployment: completed. Source and installed `main.js`, `manifest.json` and `styles.css` checksums match; the deployment path does not copy `data.json`.

final result: passed

## Project Scenes Compact Layout QA · 2026-07-22

- Source visual: user-supplied Obsidian screenshot `截屏2026-07-22 07.38.37.png`.
- Implementation surface: `prototype/project-scenes-compact-qa.html` using the generated `styles.css`.
- Viewports: 1600×1000, 1024×768 and 390×844; Geometric Modern theme.

**Findings**

- Desktop: the 1492px work area resolves to a 1085px project map and 395px entry panel (approximately 73/27). The entry panel is 209px high versus the 639px map and no longer stretches to the map height.
- Both entry rows remain exactly 64px high and vertically ordered.
- Project cards resolve to 3 columns at 1600px, 2 columns at 1024px and 1 column at 390px.
- All 12 project cards keep their full content inside 132–135px card heights; no card reports horizontal or vertical content clipping.
- `document.scrollWidth === clientWidth` and TALOS root width equals the viewport at all three widths (1600, 1024 and 390).
- Browser console reported no warning or error.

**Patches made**

- Added `project-scene-layout`, `project-map-panel` and `project-entry-panel` hooks in the existing projects renderer.
- Scoped the 70/30 desktop grid, content-height entry rows, compact project-card spacing and 3/2/1 responsive card columns to the projects page.
- Left generic `.panel-grid`, other pages, project data and click handlers unchanged.
- Added a focused red/green Vitest regression and a project-page QA fixture.

final result: passed

## WP7 Obsidian 人工视觉与交互 QA · 2026-07-25

- 完整记录：`docs/qa/wp7-obsidian-acceptance.md`。
- 部署备份、三产物同步和逐文件校验通过；部署 canonical registry 保持 12 条。
- 六个一级页面、三组二级页和跨页任务抽屉可由 Obsidian 可访问性树确认；Voice 独立 namespace 与持续监听失败后降级为点击说话通过。
- 生产组合层没有把现有 `ActionButton`、`TalosTaskRunner`、内建 A/B/C 动作、取消和恢复/撤销控制接入统一工作台；系统中心的 Provider 设置仍是占位引导。
- Obsidian 截图缓冲与当前可访问性树不一致，无法提供可信的宽/窄窗口视觉证据；真实 Vault 截图未写入仓库。
- 新鲜定向验证：5 files、20 tests 通过，但该结果只证明核心/组件与 Task 14 合成链路，不能替代生产点击验收。

final result: failed

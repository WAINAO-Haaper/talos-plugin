# TalosBall 0.3.0 Integration Provenance

**classification:** PUBLIC
**integrated:** 2026-09-02
**status:** authorized TalosBall integration candidate; external release gates remain separate
**release_candidate:** v0.4.4

## Product identity

The production voice-stage visual is TalosBall 0.3.0. The local directory, runtime
global, TypeScript API, DOM attributes, tests and bundle-facing identifiers use the
TalosBall name. The integration does not expose the previous product identity through
production APIs.

## Source and attribution boundary

TalosBall 0.3.0 is an authorized derivative of a fixed source implementation. The
repository owner confirmed authorization for this engineering use. Original source
license, commercial terms, Notice and source attribution remain under
`src/quyuan/talos-ball/runtime/vendor/talos-ball-runtime/` and are summarized in
`THIRD-PARTY-NOTICES.md`.

The TalosBall wrapper, ten voice-state adapter, lifecycle integration, tests, CSS and
Plugin host code are TALOS project additions. This record does not claim independent
original authorship of the source geometry, state data, renderer or animation engine.

## Animation-equivalence contract

The integration preserves the fixed source geometry, 32 state definitions, SVG render
math, animation primitives, springs, transition timings, random strategy and default
visual parameters. Local changes are limited to TalosBall identifiers, module paths,
logging and a `globalThis` host adaptation for browser and Node test compatibility.

The locked regression samples all 32 states at 9 fixed timestamps with a seeded random
source. All 288 deterministic pose traces must match the existing baseline exactly.
Runtime files and attribution materials also have pinned SHA-256 checks.

## Plugin integration

- `src/quyuan/talos-ball/runtime/` contains the embedded TalosBall runtime and state contract.
- `src/quyuan/talos-ball-view.ts` maps normalized voice states to TalosBall states.
- page visibility, viewport suspension, reduced-motion, static rendering and destroy cleanup remain active.
- Provider, credential, Vault, approval and tool-execution capabilities never enter the visual layer.

## Release boundary

This change does not publish, push, merge, tag, install or deploy a Release. Before an
external commercial release, the product must still pass its registered build, license,
real Obsidian, visual acceptance and applicable rights/legal gates.

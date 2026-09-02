# TALOS Ball provenance

**classification:** PUBLIC
**created:** 2026-08-30
**integrated:** 2026-09-02
**status:** TALOS-owned implementation candidate; independent legal review remains required

## Ownership boundary

TALOS Ball is the production replacement for the previously vendored Emotion Ball
runtime, state data and character visual. The implementation in
`src/quyuan/talos-ball/` was created for the TALOS product line from an abstract
functional brief and TALOS brand constraints.

The production implementation contains no third-party character source, copied SVG,
bitmap, font, audio, model, pose table, expression ID table, body coordinate array or
animation configuration.

## Original design system

- Body: mathematically generated Crown-Keel superellipse with an elevated crown and
  soft short floor.
- Eyes: pupil-free flexible valve paths generated from aperture, tension, tilt and
  gaze vectors.
- States: twelve named TALOS states mapped to continuous visual vectors.
- Motion: independent timing constants, deterministic seeded blink, interruptible
  interpolation and a shared requestAnimationFrame scheduler.
- Palette: Apple White, Deep Ink, Cloud Blue and Signal Yellow.
- Accessibility: named state labels, reduced-motion, page/viewport suspension,
  static fallback and deterministic destroy cleanup.

## Clean-room record

The original creation stream recorded that it did not access third-party character
source, assets, screenshots, measurements, coordinates, parameters, naming or page
layout. It used only the requested product behavior, common mathematical methods and
TALOS brand colors. The implementation and previews were generated from the recorded
formulas and state vectors.

AI assistance was used to draft code and documentation. The repository owner directed
the product requirements and explicitly requested integration of the TALOS-owned
implementation. This record does not replace an independent copyright, trademark,
design or commercial-dress review.

## Removed dependency

The integration deletes the prior `src/quyuan/vendor/emotion-ball/` snapshot,
its runtime adapter, numeric state data and public visual screenshot. Production source,
bundle and distribution notices must remain free of that dependency and identity.

## Release gate

Before a commercial Release:

1. run the complete test, type, lint, license and production-build gates;
2. prove the generated bundle contains no removed runtime or vendor identity;
3. generate a real Obsidian screenshot of the TALOS-owned visual;
4. complete human visual review at 48, 96 and full workspace sizes;
5. obtain independent legal review of copyright ownership, trademark naming and
   visual similarity for the intended markets.

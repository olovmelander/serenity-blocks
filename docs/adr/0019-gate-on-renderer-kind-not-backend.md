# 0019 — Themes gate material and post-processing choices on renderer kind, not backend

- **Status:** accepted
- **Date:** 2026-08-21
- **Plan hook:** THREE_UPGRADE_RESEARCH_R181_TO_R185_2026-08.md §12 (WebGL-fallback lane smoke) and
  ADR-0008 (hybrid renderer and WebGL holdouts)

## Context

A `WebGPURenderer` has two backends: WebGPU and, on machines without it, a WebGL2 fallback.
**Both run the node system** — `*NodeMaterial`, TSL, `RenderPipeline`. A classic
`THREE.WebGLRenderer` is a different renderer kind entirely and is the only thing that can
run classic `ShaderMaterial` / `EffectComposer` chains.

Themes had been gating on the *backend* (`this.isWebGPU = backend.isWebGPUBackend`), with the
`false` branch choosing classic `ShaderMaterial`s and an `EffectComposer` — code written for a
classic renderer the theme no longer constructs. On any non-WebGPU machine the node builder
rejected those materials ("`Material "ShaderMaterial" is not compatible`") and **neon-district
rendered black**. It had done so since before the upgrade; nothing in CI exercised the lane.

## Decision

- **Material and post-processing selection keys on renderer kind**:
  `usesNodeMaterials = renderer.isWebGPURenderer === true` (true on both backends) chooses node
  materials and the TSL `RenderPipeline`; a classic `WebGLRenderer` is the only case that
  selects classic materials/composers.
- **Backend flags (`isWebGPU` / `isWebGL`) are reserved for genuine backend capabilities**:
  MRT and per-attachment blending, GPU timestamp queries, compute, WebGPU-only texture
  formats, and per-backend calibration (light intensities, pixel-ratio caps) that was
  deliberately measured per backend.
- The WebGL2-backend lane is a **supported player surface** (ADR-0008), so it is part of the
  validation matrix: `?forceWebGL` in the real game, console-error-free, for every theme that
  reads the flag.

## Consequences

- Classic-material "fallback twins" inside WebGPURenderer themes are dead code; they may be
  kept for a future classic path but must not be reachable from a backend flag.
- New themes start from the node path for both backends; a classic branch needs a classic
  renderer construction to justify it.
- Some MRT-dependent features degrade gracefully on WebGL2 (full-scene bloom instead of
  selective) — that is the backend gate doing its job, not a bug.

## Enforcement

- `neon-district-theme.js` / `neon-district-assets.js` carry the reference implementation
  (`usesNodeMaterials` beside `isWebGPU`, with a per-site classification).
- Review rule: any `isWebGPU ? nodeMaterial : new THREE.ShaderMaterial(...)` is a defect.
- The forceWebGL lane smoke is part of the upgrade checklist (ADR-0018 §5); a future fitness
  check may assert that no `ShaderMaterial` is constructed on a `WebGPURenderer` code path.

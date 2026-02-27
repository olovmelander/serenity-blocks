# Nimbus Veil Art Direction Packet (Sky-Inspired, Nimbus-Original)

## North Star

Nimbus Veil should feel like a sacred, high-altitude atmosphere where light guides attention, clouds feel traversable, and gameplay reactions read as spiritual weather.

This packet locks visual direction for Phase 0 and is the source of truth for baseline acceptance.

## Inspiration Guardrail

Use Sky: Children of the Light as a mood reference only.

- Keep Nimbus palette, motion language, and composition identity original.
- Do not copy characters, symbols, camera staging, iconography, or signature set pieces.
- Emulate softness, serenity, and benevolent lighting, not asset-level likeness.

## Visual Pillars

1. Volumetric softness over card-like cloud layers.
2. Guiding moon-light direction over diffuse full-screen haze.
3. Fluid spirit movement over noisy random jitter.
4. Calm continuity under stress over aggressive spectacle.
5. Board readability is non-negotiable.

## Palette Lock

| Role | Hex |
|---|---|
| Abyss Shadow | `#0B1020` |
| Deep Veil | `#15233A` |
| Far Vapor | `#1D2A46` |
| Mid Cloud | `#4E6F97` |
| Moonlit Cyan | `#88BFD0` |
| Silver Rim | `#DCEAF4` |
| Divine White | `#F7F5EE` |
| Sacred Gold (event only) | `#F3D8A2` |
| Veil Haze | `#A7B9CF` |

## Composition Locks

- Three depth bands must stay readable in all hero frames:
  - near veil: 20-35% occupancy
  - mid cloud body: 35-55% occupancy
  - far atmosphere/void: 20-35% occupancy
- Guiding light anchor stays in the upper third (left or right), never centered on the board.
- Active-board window must preserve negative space and contrast.
- No camera acceleration spikes or abrupt directional reversals.

## Motion Grammar

- Macro cloud drift loop: 30-90 seconds.
- Spirit flow: curl-like, low-frequency directional change.
- Event cadence:
  - `LINE_CLEAR`: internal cloud charge + gentle ring pulse
  - `COMBO`: wider turbulence, controlled bloom lift
  - `PIECE_LOCK`: vertical pillar and soft decay

## Hero Frames (Locked)

1. Shot A: `idle-serenity` (8s, no gameplay events)
2. Shot B: `line-clear-4`
3. Shot C: `combo-10-chain`
4. Shot D: `low-tier-parity`
5. Shot E: `force-webgl-parity`

## Readability ROI + Histogram Targets

- Board ROI contrast under stress: `>= 4.5:1`.
- Highlight clipping continuity: `<= 0.5s`.
- Dark-value dominance in hero frames: 40-65% of frame.
- Non-emissive bloom leakage outside approved glow ROI: `<= 3.0%`.

Approved glow ROI:
- cloud rim highlights
- pillar core
- pulse-wave fringes

## Sky Fidelity Rubric (Signoff Sheet)

Score each category 1-5 for `High`, `Ultra`, and `WebGL fallback`.

| Category | Target |
|---|---|
| Sacred Atmosphere | Calm, expansive, contemplative |
| Cloud Presence | Volumetric and traversable |
| Light Spirituality | Benevolent guidance, no harsh clipping |
| Motion Grace | Wind-driven, no jitter/strobe |
| Event Poetry | Weather-like, not UI-explosive |
| Readability Safety | Board remains clear at combo peaks |

Gate:
- no category below `4`
- average `>= 4.4`

## Deterministic Review Workflow

Flags:
- `nimbusBaseline=1`
- `nimbusSeed=1234`
- `nimbusFixedDt=16.666`
- optional fallback: `forceWebGL=1`

Helper API:
- `window.nimbusBaseline.capturePack(...)`
- `window.nimbusBaseline.captureReadability(...)`
- `window.nimbusBaseline.play('default' | 'stress', ...)`
- `window.nimbusBaseline.report()`

Harness:
- `tests/performance/benchmark-nimbus-veil-phase0.html`

## Phase 2 Art-Safety Guardrails

To keep Sky-inspired calm and Nimbus identity intact during render-path refactor:

- Material factories must preserve existing shader behavior and palette lock values.
- `nimbus-veil-shaders.js` remains the fallback source of truth until TSL migration.
- Post abstraction must not introduce extra grading or contrast pumping in Phase 2.
- Tone-mapping ownership stays single-path and explicit in runtime logs/snapshots.
- Any render-path fallback must keep board readability and calm motion grammar unchanged.

## Phase 3 Material Migration Guardrails

To keep migration quality high while moving active FX to TSL:

- Preserve Nimbus palette lock values and soft atmospheric luminance ratios in WebGPU node paths.
- Keep twinkle and pulse motion calm; avoid high-frequency strobing in stars/dust/pulse timing.
- Hero glow roles (`mist`, `pulse`, `light-burst`) stay quad-based and must not depend on oversized point sprites.
- Bloom-class weights and MRT role metadata must remain explicit per material for deterministic audits.
- WebGL fallback remains visual-reference truth for parity checks until full Phase 3 signoff.

## Phase 4 Volumetric Cloud Guardrails

To preserve Sky-inspired serenity while adding true cloud depth:

- Keep macro cloud motion slow and breathable; volumetric richness must not become noisy shimmer.
- Preserve moon-guided highlight direction so rim response reads as guidance, not random hotspots.
- Gameplay reactivity should boost density/emissive gently and decay smoothly; avoid abrupt flashes.
- `nimbusNoVolumetrics` and `nimbusNoReprojection` must remain reliable debug safety switches.
- If tier fallback triggers, silhouette readability and board contrast take priority over depth complexity.

## Phase 5 Spirit Swarm Guardrails

To keep spirit motion poetic while scaling to compute-driven density:

- Spirit motes should move as coherent wind currents with soft cohesion, never as noisy random jitter.
- Event bursts (`LINE_CLEAR`, `COMBO`, `PIECE_LOCK`) must read as breathable ripples, not explosive shrapnel.
- Keep additive glow restrained so spirits support cloud depth instead of overpowering board readability.
- Compute failure fallback to CPU dust must preserve calm motion grammar and palette lock.
- High/Ultra scale targets (`60000`/`90000`) are technical ceilings, not permission for visual clutter.

## Phase 6 Divine Lighting and Post Guardrails

To preserve Nimbus serenity while adding cinematic finish:

- Post stack must stay board-safe first: bloom, rays, and grading must be attenuated inside the board-safe mask window.
- God rays must follow moon direction and cloud-density rhythm; rays should fade under dense cloud cover rather than clip.
- MRT emissive isolation should remain optional and auto-downgrade cleanly when material audit or capability checks fail.
- No-MRT and no-post fallback routes must preserve mood continuity and keep readability thresholds intact.
- Combo-driven intensity lifts should feel breathable, capped, and quickly recover to calm baseline.

## Phase 7 Reactive Feel and Readability Guardrails

To keep gameplay response alive while preserving clarity under stress:

- All gameplay reactivity must flow through one unified envelope model (no independent cloud/bloom/particle write paths).
- Quality tiers must tune impulse scale, caps, and decay rates so higher tiers feel richer without breaking readability.
- Board-safe intensity clamps are mandatory: bloom, cloud opacity/density, and god-ray lift must stay under explicit readability caps.
- Sustained combo chains (`10+`) must retain board-legibility targets and avoid strobe-like luminance pumping.
- Calm mode and reduced-motion preference must enforce stricter caps and faster return-to-calm decay behavior.

## Phase 8 Performance and Thermal Guardrails

To keep Nimbus stable over long sessions without visual identity collapse:

- Dynamic resolution scaling must be hysteresis-driven and bounded; avoid visible resolution pumping.
- Prewarm should reduce first-event hitching; no obvious stutter on first combo/piece-lock after load.
- When timestamp query is unavailable, CPU pass timing fallback is mandatory for perf diagnostics.
- Thermal hardening must prioritize motion continuity and board readability over peak effect density.
- 30-minute and 2-hour soak runs must not show escalating stutter, runaway memory drift, or repeated runtime fallback churn.

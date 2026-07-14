# Summer Midsummer Combo + Lock Effects — Research and Implementation Plan

- **Status:** Research and design decision complete; implementation not started
- **Scope:** `src/themes/summer/` combo and piece-lock reactions only
- **Governance:** `ARCHITECTURAL_REMEDIATION_PLAN.md`, ADR-0007, ADR-0009, ADR-0011, and `WEBGPU_THREEJS_WORKFLOW.md` govern execution
- **Visual thesis:** **Midsummer Promise — Dewprint → Ring Dance → Seven-Flower Crown → Midnight-Sun Exhale**

This is the implementation companion to `SUMMER_MIDSUMMER_MASTERPIECE_PLAN.md`. It does not reopen the theme composition or rendering architecture. The Summer scene is already the artwork; these effects should make gameplay feel as if it briefly awakens that artwork.

---

## 1. Decision

Build one connected effect language rather than unrelated lock and combo bursts:

1. **Press:** a locked tetromino leaves a small, pearly dewprint in its exact four-cell silhouette.
2. **Gather:** a few petals, fresh birch leaves, and dew glints lift from that last lock origin.
3. **Circle:** combo waves guide those elements along paired, board-safe arcs like a ring dance.
4. **Bloom:** each combo count completes another flower/sprig position in a seven-lobed wreath.
5. **Exhale:** the rare upper tier completes the crown and produces one restrained midnight-sun halo behind it.

The hierarchy must remain clear:

- Piece lock is immediate, small, frequent, and finished in roughly half a second.
- Combo is structurally richer and lasts roughly 0.8–1.2 seconds.
- The highest tier is wider and more complete, not a full-screen flash or an uncontrolled increase in brightness.

The suite is called **Midsummer Promise** in this plan. Production names can remain technical.

### Non-negotiable art constraints

- Preserve the clear central playfield and piece contrast.
- Use recognizable dew, petal, fresh leaf, and five-petal flower silhouettes; Summer already has hundreds of generic glowing motes.
- Keep the palette pearly dew, warm sunlight, fresh green/silver birch, and the meadow's existing flower colors.
- No fireworks, embers, flame burst, confetti cannon, neon magic, camera shake, exposure punch, or strobe.
- The core effects must look complete in direct rendering. The currently disabled MRT bloom path is not a dependency.
- The maypole may answer a high combo, but it cannot carry the signal by itself: it is small, right-weighted, and already owns Tetris/perfect-clear hero beats.

---

## 2. Evidence behind the direction

### Cultural and natural references

This direction is not “generic summer particles.” It uses recurring Swedish Midsummer forms:

- The maypole is dressed with leaves and flowers and followed by ring dances. That supports circles, paired chase motion, garlands, and fresh greenery rather than explosions. See the [Swedish Institute](https://sweden.se/culture/celebrations/swedish-midsummer), [Skansen](https://www.skansen.se/en/see-and-do/holidays-and-traditions/midsummer-tradition/), and [Nordiska museet](https://www.nordiskamuseet.se/utforska/livet-i-norden/midsommarfirande-och-traditioner/).
- Midsummer-night folklore connects dew, springs, flowers, and divination. Dew therefore gives a lock reaction a culturally grounded, serene material. See [ISOF](https://www.isof.se/utforska/kunskapsbanker/lar-dig-mer-om-arets-namn-och-handelser/handelser/midsommar) and [Nordiska museet's folklore overview](https://www.nordiskamuseet.se/utforska/livet-i-norden/folktro-om-midsommarnattens-magi/).
- Sources describe both seven- and nine-flower variants, and regional flower lists differ. Seven is a strong visual milestone, not a claim that one bouquet is nationally canonical. See [ISOF](https://www.isof.se/utforska/kunskapsbanker/lar-dig-mer-om-arets-namn-och-handelser/handelser/midsommar) and [Lund University](https://www.lu.se/artikel/sju-sorters-blommor-det-har-kan-du-plocka-till-midsommar-och-samtidigt-bota-din-artblindhet).
- Wood cranesbill, *Geranium sylvaticum*, is known as `midsommarblomster` and is a suitable five-petal hero silhouette. See the [Swedish Museum of Natural History](https://www.nrm.se/fakta-om-naturen/vaxter/landvaxter/junivaxter/skogsnava).
- Grass pollen is seasonally appropriate, but visible grains would read as dust. Keep airborne warm motes sparse and abstract. See the [Swedish Museum of Natural History pollen overview](https://www.nrm.se/natur--och-miljoovervakning/pollenovervakning/pollenrapporten/allergiframkallande-pollen/gras).

### Gameplay VFX and accessibility references

- Effect impact should match gameplay impact, preserve clarity, and have an anticipation/main/dissipation shape. The lock is therefore smaller than the combo, and combo tiers change form/completeness rather than merely brightness. See Riot's [VFX style guide overview](https://nexus.leagueoflegends.com/en-us/2017/10/dev-leagues-vfx-style-guide/) and [original guide PDF](https://nexus.leagueoflegends.com/wp-content/uploads/2017/10/VFX_Styleguide_final_public_hidpjqwx7lqyx0pjj3ss.pdf).
- Reduced-motion handling is a designed form, not just lower opacity. Avoid camera shake, motion blur, repetitive screen movement, and color-only meaning. See Microsoft's [XAG 117](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/117), [XAG 118](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/118), and [XAG 103](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/103).
- The design intentionally contains no flashing sequence; it must remain within [WCAG flash guidance](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html).

### Version-correct rendering references

The repository pins Three.js r181. Relevant primary examples are the r181 [WebGPU compute particles](https://github.com/mrdoob/three.js/blob/r181/examples/webgpu_compute_particles.html), [storage-texture ping-pong](https://github.com/mrdoob/three.js/blob/r181/examples/webgpu_compute_texture_pingpong.html), and [`THREE.PostProcessing` bloom](https://github.com/mrdoob/three.js/blob/r181/examples/webgpu_postprocessing_bloom.html). They prove those techniques are available; they do not make them the right first implementation here.

---

## 3. Current-state audit

### What exists

`summer-theme.js` is a thin wrapper over the production-mounted `summer-meadow.effect.js`. `SeasonDirector` supplies calm global envelopes:

| Signal | Actual visible use |
|---|---|
| `warmth` | Grass backlight and ambient mote opacity |
| `breeze` | Water ripples, vegetation motion, and maypole wreath sway |
| `sparkle` | Sky shafts, water glitter, motes, and god-rays |
| `raise` + `accent` | Maypole lift and glow |
| `bloom` | **No visual consumer** |
| `breezeDir` | **Not forwarded to the effect** |

The current piece lock calls `SeasonDirector.onPieceLock()` without its event payload. It produces a tiny warmth bump and a larger `bloom` bump, but `uBloom` is only declared and assigned. It drives no node or material. Summer therefore has no real piece-lock effect.

The current combo response is a broad breeze/sparkle change. It has no discrete visual, no origin, and no visible chain progression.

### Event-contract findings

- Canonical `PIECE_LOCK` already contains a copied oriented `piece.shape`, `piece.x`, and `piece.y`. Summer currently discards all of it.
- In normal cascade play, `COMBO` is emitted from cascade count 2 upward, immediately before the corresponding `LINE_CLEAR`. `comboCount` is the cascade wave number, so the visual ladder should begin at 2.
- Serenity interaction mode emits the inverse order, `LINE_CLEAR` then `COMBO`, and has no preceding `PIECE_LOCK`. Manual Odyssey celebrations can also emit a combo without a lock. Correlation and fallback placement must therefore be order-independent rather than tailored only to normal physics.
- `COMBO` normally has no position. The effect must retain the most recent lock origin, use optional canonical `position` when provided, and have a deterministic fallback.
- Summer currently bumps the director once for `COMBO` and again for its following `LINE_CLEAR`. Some modes also put `comboCount` on `LINE_CLEAR`. Without correlation, the same gameplay wave double-stacks atmosphere.
- In standard play, a new `PIECE_LOCK` starts a new visual wreath sequence. Non-lock sources use their event stream plus a short inactivity reset; this is cosmetic correlation, not a new gameplay combo system.

### Exact lock origin

Average the occupied cell centers of the oriented piece:

```text
cellX = piece.x + localX + 0.5
cellY = piece.y + localY + 0.5
normalizedX = centroidX / COLS
normalizedY = (centroidY - HIDDEN_ROWS) / ROWS
```

Current constants are `COLS=10`, `ROWS=20`, and `HIDDEN_ROWS=4`. Clamp malformed or hidden results, retain `player`, `source`, `levelId`, and optional `position`, and cover this pure mapping with unit tests.

### Existing rendering risks

- Selective MRT bloom is disabled by default because it can black out most of the frame and leave a thin right strip. `?bloom` is diagnostic only.
- Summer is already `heavy-gpu`: approximately 11,000 grass instances, about 9,000 flowers, 720 motes, a 0.45-scale reflector, and a DPR cap of 1.5.
- There is no production graphics/effects quality table, no live settings listener, and no Summer-specific unit test suite.
- `SeasonDirector.getState()` allocates a new object every frame.
- The baseline console contains a deprecated `renderAsync()` warning and repeated missing vertex-normal warnings. They are not WebGPU validation failures, but they should be cleaned or explicitly baselined before final composite acceptance.

---

## 4. Live composition review

A phase-locked playground audit was performed on `summer-meadow` at `t=8` and `t=20` after all major composition assets settled. The session used WebGPU at a 1440 × 901 CSS viewport, DPR 1.5, renderer pixel ratio 1.25, and a 1800 × 1126 canvas. There were no WebGPU validation errors or device loss.

Preserved evidence:

- [`t=8` clean WebGPU capture](../artifacts/themes/summer/research-2026-07-13/summer-meadow-t08-webgpu-1440x900-clean.png)
- [`t=20` clean WebGPU capture](../artifacts/themes/summer/research-2026-07-13/summer-meadow-t20-webgpu-1440x900-clean.png)
- [`t=8` reference split](../artifacts/themes/summer/research-2026-07-13/summer-meadow-t08-reference-split.png)

The captures confirm:

- The lower half is a dense, high-frequency meadow. Tiny multicolored particles disappear there unless they have a distinct silhouette and pearly rim.
- The lake/shore band has calmer values and is the best visual travel corridor for gathering petals.
- The upper-right sun is nearly white. Fine gold lines and additive particles wash out there.
- The standard single-player board footprint inferred from production CSS is approximately 300 × 600 CSS pixels at `x≈570–870`, `y≈150–750` in this viewport. Its upper sky corridor is stable but bright, so larger coral, lupine-violet, and fresh-green forms can read where white/gold motes cannot.
- The cottage, maypole, sun reflection, and moving foreground trees make the right third visually busy; a maypole-only response would be easy to miss.
- The broad sky has room but is too bright for thin pale particles. Wreath elements need fresh-green mass, a soft dark underside, or a higher-contrast outline.
- Existing motes already read as fireflies/pollen. New gameplay particles must be petals, leaves, droplets, or flowers—not more dots.
- Camera motion changes edge occlusion, especially on the right. Event particles should live on a camera-facing FX layer with deliberate depth/render ordering, not be accidentally hidden behind a foreground trunk.

The production layout must be captured with the actual playfield overlay before finalizing wreath radius. The isolated scene proves palette and background contrast, not final UI clearance.

---

## 5. Effect specification

### 5.1 Piece lock — Dew-Pressed Lock Seal

**Purpose:** acknowledge every lock without competing with line clears or masking the next piece.

**Form**

- Four pearly dew beads reproduce the occupied cells of the locked tetromino as a compact side-lane seal.
- A very shallow surface-tension outline expands no more than about one mini-cell beyond the silhouette.
- Six to twelve micro petals/seed wisps lift from exposed corners. They are the material that a following combo appears to gather.
- Dew bodies are cool pearl/aqua; the smallest glint catches the existing warm sun color.
- The seal is a complementary theme reaction outside the active cells. The board renderer remains responsible for exact gameplay-local confirmation.

**Timing hypothesis to validate**

| Age | Visual |
|---:|---|
| 0–70 ms | Four-cell contact/press; immediate confirmation |
| 70–260 ms | Beads lift slightly; outline relaxes; sparse wisps separate |
| 260–520 ms | Settle and dissolve into the ambient meadow direction |

**Spatial behavior**

- Preserve the piece centroid's vertical position.
- Move central origins into the nearer safe gutter beside the board; alternate sides when equally close.
- Clamp to a visible ceremonial band and avoid the sun/maypole collision mask at narrow layouts.
- Keep the seal readable across bright sky and dense meadow with shape, rim, and value—not additive intensity alone.

**Do not do**

- No blue splash, water jet, shockwave, screen shake, exposure change, or maypole lift.
- No post-bloom dependency.

### 5.2 Combo — Seven-Flower Ring Dance

**Purpose:** make every cascade wave visibly build on the last lock while retaining a calm Midsummer character.

The last lock's droplets and wisps gather onto two opposed curves around the board. Each successive combo wave weaves another flower/sprig into a partial wreath. Two streams chase in opposite directions like a ring dance, meet at the new lobe, and exhale a few fresh birch leaves.

Use a five-petal wood-cranesbill-inspired blossom as the signature lobe, mixed with the theme's existing white, buttercup-yellow, lupine-violet, and restrained coral palette. It should feel grown from the meadow, not pasted on as a UI badge.

| `comboCount` | Structural read | Motion and scene response | Target duration |
|---:|---|---|---:|
| 2 | Two opposed flowers/sprigs; unmistakable first combo | Short paired gather arcs; small breeze/sparkle answer | 0.70–0.85 s |
| 3–4 | Three/four lobes and the first readable partial garland | One incomplete orbit; a few silver-green leaves | 0.80–0.95 s |
| 5–6 | Five/six lobes; near-complete wreath | Stronger but still localized ring dance; restrained water-glitter echo | 0.90–1.05 s |
| 7–9 | Complete seven-lobed crown | One gentle full orbit; maypole wreaths answer subtly; long soft settle | 1.00–1.20 s |
| 10+ | Same crown, refreshed rather than stacked | One localized midnight-sun halo behind the crown; transparent center; no exposure jump | 1.10–1.30 s |

Tier meaning is carried by lobe count, circumference completion, paired motion, and duration. Hue and brightness are supporting cues only. All quality tiers retain the same milestone structure.

### 5.3 High tier — Midnight-Sun Exhale

This is not a third unrelated effect. It is the completed wreath's final breath:

- One broad translucent golden ellipse opens behind the wreath.
- The middle remains transparent so board contrast is unchanged.
- Existing water glitter, grass rim light, and maypole wreath swing can answer through small bounded envelopes.
- It peaks once, then decays slowly. Repeated 10+ waves refresh the envelope; they do not accumulate more halos.
- No full-screen grade, global exposure change, flash sequence, camera movement, or motion blur.

---

## 6. Spatial contract

The design needs a stable relationship to the playfield without coupling rendering back into simulation.

1. The wrapper extracts the pure normalized lock centroid from the canonical event payload.
2. The runtime retains the last valid origin and piece silhouette for the current cascade sequence.
3. Resolve the visible player board using the proven selector order: `#p${player}-phaser-container canvas`, then `#phaser-game-container canvas`, `#main-game-canvas`, and `#single-player-game-canvas`. Reject hidden/tiny rectangles. Cache the result, but refresh it with `ResizeObserver` and mode/layout-change events as well as viewport resize.
4. A cached ray/plane transform maps the NDC anchor to a camera-facing FX plane; do not allocate vectors per event or frame.
5. The lock seal is shifted into the closest board gutter. Combo paths occupy the outer wreath band, never the active grid.
6. A layout collision mask protects the upper-right sun/maypole/cottage cluster and viewport edges. Narrow layouts use a smaller lower arc rather than clipping.
7. If the event supplies a screen-space `position` (as Serenity does), map it directly after validation. If board bounds and position are both unavailable, use a deterministic centered-board fallback and record that fallback in diagnostics.

The FX plane should render after the 3D scene with intentional ordering and no world-depth occlusion, while remaining behind the actual game board/UI. This keeps a foreground tree from hiding a gameplay cue and keeps the board itself authoritative.

Track transient reaction state by bounded `(source, levelId, player)` stream key, not globally. Cap the map at four active streams (the supported local-board count) and reclaim the least-recently-active entry. A new lock resets that stream; a non-monotonic combo count or a provisional 2.25-second inactivity timeout also starts a fresh sequence. This covers Serenity and manual Odyssey combos that lack a lock while preventing one local-multiplayer board from advancing another board's wreath. If the Summer scene is shared, assign stable player gutters and enforce the same global pool/frequency caps.

---

## 7. Technical design

### 7.1 Use fixed instanced billboards first, not compute

The expected active count is a few dozen to a few hundred short-lived elements. A preallocated CPU-triggered/GPU-animated billboard pool is the right first implementation:

- It works on the pinned r181 WebGPU renderer and its `forceWebGL=1` fallback.
- Events only write spawn attributes; TSL derives trajectory, tumble, scale, and fade from time.
- It avoids compute dispatch, storage-buffer complexity, and a second implementation path for a count that does not justify them.
- It follows proven repository patterns and is easier to screenshot deterministically.

Do not use `PointsMaterial` for visible petals: WebGPU points are effectively one pixel. Wave 1 should use the repository's r181-proven Winter billboard path: `THREE.InstancedMesh` + `PlaneGeometry` + `MeshBasicNodeMaterial`, with `material.vertexNode` constructing the camera-facing clip-space quad from a per-instance center and rotated `positionLocal.xy`. For this CPU-authored pool, instance attributes replace Winter's storage reads. Do not assume `SpriteNodeMaterial` can simply be placed on an ordinary `InstancedMesh`. Never collapse every instance by replacing its position with one buffer element; add the local quad to the per-instance center.

Compute becomes an option only if a measured prototype requires thousands of persistent simulated elements. If that happens, build compute nodes once, skip dispatch while idle, dispose storage explicitly, and validate both backends before porting.

### 7.2 Pool and material shape

Provisional active budgets, to be reduced after capture rather than automatically filled:

| Tier | Active dew/seal budget | Active petal/leaf/wisp budget | Crown lobes per stream | Visible semantics |
|---|---:|---:|---:|---|
| Minimal | 24 | 48 | 7 | Full shape/tier read, no travel loop |
| Low | 32 | 80 | 7 | Short gather arcs |
| Medium | 40 | 144 | 7 | Full paired arcs, reduced trail |
| High | 48 | 224 | 7 | Full authored flourish |
| Ultra | 48 | 272 | 7 | Extra secondary petals/leaves |
| Extreme | 48 | 320 | 7 | Maximum secondary density only |

Allocate the small Extreme maximum once; quality changes only adjust active/spawn ceilings and never rebuild a pool. Reserve 28 crown slots once (seven for each of four bounded streams) within the same instanced draw. Use the shared quality normalization contract for `Minimal`, `Low`, `Medium`, `High`, `Ultra`, and `Extreme`. The UI can expose `Custom`; under today's shared `normalizeQuality()` behavior it resolves to the High structural budget, while its individual settings gates still apply. Do not invent a Summer-only interpretation of Custom.

Use a ring allocator with oldest-slot reclamation. Preallocate typed arrays and instance attributes for center, birth time, lifetime, seed, velocity/control points, rotation, scale, color, and glyph/species. No geometry, material, pipeline, or JS object creation is allowed on an event.

Target no more than three incremental draw calls:

1. Dew bodies and tiny glints.
2. A shared petal/leaf/flower atlas billboard pool.
3. The crown/halo plane.

Normal alpha blending should carry colored petals and leaves. Reserve additive blending for pin-sized dew glints. Use `depthWrite=false`, deliberate render order, and alpha-to-coverage or clean alpha/SDF edges where supported. Favor fewer authored silhouettes over more dots.

The atlas may be a tiny authored or deterministic canvas texture containing a dew bead, petal, fresh birch leaf, and five-petal flower. It must be created once, tracked, and disposed. A fully analytic TSL shape is acceptable only if it is clearer and cheaper after measurement.

### 7.3 Animation data flow

- CPU/event time: normalize payload, choose deterministic seed, reserve slots, and write immutable spawn parameters.
- GPU/frame time: derive eased age, Bézier/orbit path, flutter/tumble, scale, opacity, warm/cool rim, and dissipation.
- Crown state: retain one seven-slot crown per active stream and retarget its desired lobe count. Do not respawn every already-completed lobe on every wave.
- Burst pressure: allow at most two gather packets concurrently across the shared scene. Coalesce faster cascade waves into the newest target count while preserving the immediate structural lobe update. Normal cascades can arrive only about 35–56 ms apart, much faster than a 0.8–1.3 second flourish.
- Idle: hide meshes or set instance count to zero; no compute dispatch and no per-frame scan beyond a cheap `activeUntil` test.
- Determinism: replace `Math.random()` in effect-critical director paths with an event-sequence hash. A fixed scene `t` plus fixed `fxAge` must reproduce the same frame.

### 7.4 Separate discrete effects from ambient direction

Create a small Summer-specific gameplay FX controller and keep `SeasonDirector` responsible for atmosphere.

Recommended ownership:

- `src/themes/summer/rendering/summer-gameplay-fx.js` — pools, spawn/update/dispose, deterministic curves, quality, and reduced-motion form.
- `src/themes/summer/composition/summer-gameplay-routing.js` — pure payload normalization, origin mapping, combo correlation/milestones, and settings gates. This can be folded into the FX module if it stays small.
- `src/themes/summer/composition/season-director.js` — allocation-free global envelopes only.
- `src/playground/effects/summer-meadow.effect.js` — construct the controller, call `update`, expose `runtime.pulse(kind, payload)`, and dispose it.
- `src/themes/summer/summer-theme.js` — pass complete canonical payloads and live settings to `runtime.pulse`.

This is an explicit authored helper, not a new cross-theme framework.

### 7.5 Correlate `COMBO` and `LINE_CLEAR`

Use one semantic owner per reaction and make event correlation order-independent:

- `PIECE_LOCK`: store/reset origin and emit the dew seal.
- `COMBO`: progress the wreath milestone and emit gather/ring motion.
- `LINE_CLEAR`: retain the existing line/breeze response; do not emit the same combo particles again.
- `COMBO` records the milestone immediately and cancels any matching line-clear fallback for the same stream.
- An unseen `LINE_CLEAR.comboCount` schedules a generation-guarded microtask fallback. If a matching `COMBO` arrives synchronously before that microtask, cancel/no-op the fallback; otherwise emit it once. This handles both normal `COMBO → LINE_CLEAR` and Serenity's `LINE_CLEAR → COMBO` order.
- Expire bounded per-stream state on new lock, non-monotonic count, inactivity, reset, and disposal. A missing preceding lock uses the validated event position or deterministic safe fallback.
- Compose shared warmth/sparkle targets with `max`/bounded targets, not two additive bumps for the same cascade wave.

Remove or rename the current no-op `bloom` channel. Do not leave a field whose name implies functional post-processing.

### 7.6 Settings and reduced motion

- Lock requires both `backgroundComboEffects !== false` and `pieceLockRipple !== false`.
- Combo requires `backgroundComboEffects !== false`.
- Honor OS reduced motion and `window.settings.reducedMotion`.
- Listen for live settings/media-query changes; setup-time intensity alone is insufficient.

Reduced-motion form:

- Lock: the four-cell dew shape appears and fades in place in about 180–240 ms; no lifted beads or traveling wisps.
- Combo: the correct number of crown lobes fades directly into its slots; no orbit, chase, or screen-crossing travel.
- High tier: a short, low-opacity static halo fade; no pulsing.

Disabling an effect stops new spawns and clears/fades active cosmetic state without affecting gameplay.

---

## 8. Performance budget

These are acceptance targets to verify on the development iGPU, not claims about the current build:

- Zero additional idle draw calls when no Summer gameplay FX is active, where the renderer API permits instance count zero.
- No idle compute dispatch.
- At most three active draw calls for the complete suite.
- Event routing/spawn work target: at most 0.25 ms CPU at p95 in a rapid-event stress sample.
- Active FX GPU delta target: at most 0.5 ms p95 over the settled Summer baseline on the development iGPU.
- First record the settled Summer baseline. If it already meets 16.6 ms p95 at the supported default profile, the candidate must remain within that target. If it does not, this feature must still stay within the 0.5 ms incremental GPU budget and introduce no material p95 regression; unrelated inherited baseline debt is not part of this effect scope.
- No per-frame allocations in the director or gameplay FX update; verify with a short allocation profile.
- Pool saturation must reclaim the oldest cosmetic slot predictably, never grow memory, and never delay gameplay.

If Summer's existing scene cannot meet the frame target, reduce secondary petals first. Never remove the four-cell lock read or the structural combo-lobe count on low quality.

---

## 9. Playground-first execution plan

Each wave is a separate, small visual session. Do not capture a full journey on this iGPU.

### Wave 0 — Freeze the baseline and event contract

- Preserve phase-locked baseline captures at `t=8` and `t=20` plus the reference split.
- Add pure tests for oriented-piece centroid, hidden-row handling, fallback origin, per-stream combo milestone/reset, and both `COMBO`→`LINE_CLEAR` and `LINE_CLEAR`→`COMBO` deduplication.
- Add deterministic diagnostic payload fixtures for `T`, `I`, and `O` locks and combos 2, 4, 7, and 10.
- Make `SeasonDirector.getState(out)` allocation-free and replace effect-critical random direction with a deterministic hash.
- Resolve or explicitly baseline the deprecated `renderAsync()` and missing-normal warnings in their own small cleanup pass.

**Gate:** event fixtures repeat exactly; no source visual change yet.

### Wave 1 — Isolated Dewprint

- Create `src/playground/effects/summer-dew-lock.effect.js` with only a small meadow/shore proxy and the lock pool.
- Diagnostic contract example:
  `playground.html?effect=summer-dew-lock&t=8&piece=T&col=4&row=17&fxAge=0.22`
- Capture `T`, `I`, and `O` shapes at left/center/right origins and ages approximately 0.06, 0.22, and 0.50 seconds.
- Validate direct-render WebGPU first, then `forceWebGL=1`, Minimal quality, and reduced motion.
- Iterate until the effect reads as sunlit dew rather than splash, spark, or generic dots.

**Gate:** clean screenshots and no WebGPU/TSL validation errors. Do not port before this gate.

### Wave 2 — Isolated Ring Dance

- Create `src/playground/effects/summer-ring-dance.effect.js` with a board-safe frame and small meadow/maypole proxy.
- Diagnostic contract example:
  `playground.html?effect=summer-ring-dance&t=8&combo=7&fxAge=0.55`
- Capture combos 2, 4, 7, and 10 at gather, orbit, bloom, and settle phases.
- Use reference-split mode for palette/silhouette judgment.
- Validate that a viewer can order the tiers in grayscale and at Minimal quality.
- Stress repeated milestones and verify that 10+ refreshes rather than stacks the halo.

**Gate:** every tier is structurally distinct, board center stays clear, direct rendering is complete, and console is clean.

### Wave 3 — Production controller and routing

- Port the proven pools/materials into `summer-gameplay-fx.js`; do not duplicate playground code blindly.
- Expose `runtime.pulse(kind, payload)` from `summer-meadow.effect.js`.
- Pass the full canonical payload from `summer-theme.js`.
- Add live settings, quality, reduced motion, disposal, and generation fencing.
- Add a phase-locked production pulse harness such as `summerPulse`, `summerPulseAge`, and a serialized deterministic payload.

**Gate:** unit tests pass; theme switching leaves no listeners, resources, active slots, or async callbacks behind.

### Wave 4 — Scene symbiosis

- Connect bounded envelopes to the existing breeze, sparkle, water glitter, grass rim, and maypole wreath swing.
- Remove the no-op `bloom` signal and prevent combo/line-clear double bumps.
- Either wire `breezeDir` to an intentional scene response or remove the dead director state.
- Tune against the actual game board overlay at representative viewport sizes.
- Keep the maypole Tetris/perfect-clear lift exclusive; ordinary combo only adds a subtle wreath response at 7+.

**Gate:** the effects feel grown from the scene but remain readable if all secondary scene responses are disabled.

### Wave 5 — Quality, accessibility, and fallback

- Tune Minimal/Low/Medium/High/Ultra/Extreme active budgets using captures and timing, not the provisional maximums; verify the existing Custom-to-High normalization explicitly.
- Validate OS and in-game reduced motion, settings toggles, `forceWebGL=1`, resize, pause/resume, and hidden-tab recovery.
- Validate local multiplayer scoping/frequency or explicitly fence it if the layout contract is not ready.

**Gate:** semantic parity across quality tiers and no motion-only or color-only information.

### Wave 6 — Short production validation

- Capture individual real-game events only: lock, combo 2, combo 4, combo 7, combo 10, and rapid-cascade stress.
- Run a short rapid-lock/event storm and a repeated theme-switch test.
- Record GPU timestamps, CPU event cost, active draw delta, pool high-water marks, and console output. Use `?trackTimestamp=1` so the playground constructs `WebGPURenderer({ trackTimestamp: true })`; it cannot be enabled retrospectively. Resolve timestamp queries during a short isolated measurement session so they do not accumulate.
- Save final evidence under `artifacts/themes/summer/combo-lock/` with the URL, renderer, viewport, DPR, phase, settings, and commit SHA.

**Gate:** every item in the acceptance matrix passes. Only then call the visual work done.

### Optional later session — selective bloom diagnosis

Diagnose the current MRT thin-strip/black-frame regression in a separate isolated playground effect. If fixed and screenshot-verified, allow only tiny dew glints and the crown rim to feed selective bloom. The effect suite must still pass with bloom disabled.

---

## 10. Acceptance matrix

| Dimension | Required cases |
|---|---|
| Piece shape | `T`, `I`, `O`; occupied-cell silhouette remains recognizable |
| Horizontal origin | Columns near 0, 4/5, and 9; safe gutter mapping is stable |
| Vertical origin | Top, middle, bottom; no off-screen/clipped seal |
| Combo | 2, 4, 7, 10; correct lobe count and tier structure |
| Phase | Contact/gather, orbit, bloom, settle via fixed `fxAge` |
| Renderer | WebGPU and `forceWebGL=1` fallback |
| Viewport | 16:9, 16:10, ultrawide, and one narrow supported layout |
| Quality | Minimal and highest supported tier; semantic parity |
| Motion | Normal, OS reduced motion, in-game reduced motion |
| Settings | Lock off, combo off, toggled off/on live |
| Load | Rapid locks, cascade storm, pool saturation, combo 10 refresh |
| Event order | `COMBO`→`LINE_CLEAR`, `LINE_CLEAR`→`COMBO`, and combo without lock |
| Lifecycle | Resize, pause/resume, hidden tab, repeated theme switch/dispose |
| Multiplayer | Local/other-player payload routing or an explicit tested fence |

For every visual case:

1. Run `npm run dev:playground`.
2. Open the phase-locked URL and wait for `window.__PLAYGROUND_READY__ === true` plus effect-specific readiness.
3. Capture the canvas with Chrome DevTools.
4. Read the full console; accept no WebGPU validation, device-loss, or new TSL compile errors/warnings.
5. Record renderer, viewport, DPR, quality, reduced-motion state, `t`, `fxAge`, and payload.
6. Compare direct WebGPU, fallback, and the intended reference—not only a clean build.

### Visual pass/fail questions

- Does the lock read in under 100 ms without looking like a splash or spark hit?
- Can the player identify the tetromino silhouette without looking away from the board?
- Can combos 2, 4, 7, and 10 be ordered from a still frame without relying only on hue?
- Does the ring dance remain outside active cells at every supported layout?
- Are petals/leaves distinct from existing motes and meadow noise?
- Is the maypole response supportive rather than the only readable cue?
- Does combo 10 feel exceptional without washing out the sunlit scene?
- When motion is reduced, is the same event hierarchy still obvious?
- Under rapid events, does the suite settle gracefully rather than becoming a particle cloud?

---

## 11. Tests to add

Suggested Summer-focused unit coverage:

- `summer-gameplay-routing.test.js`
  - oriented piece centroid and hidden rows
  - precise, optional, and fallback origins
  - side-lane/layout clamp determinism
  - isolated state for two `(source, levelId, player)` streams
  - new lock, non-monotonic combo, and inactivity reset the visual wreath sequence
  - both event orders emit one combo milestone
  - `LINE_CLEAR.comboCount` fallback works when `COMBO` is absent
  - player/source/position survive routing
- `summer-gameplay-fx.test.js`
  - quality capacities and structural parity
  - oldest-slot reclamation and no dynamic growth
  - persistent crown retargeting and two-packet gather cap under 35 ms waves
  - repeated combo milestone deduplication
  - combo 10 halo refreshes rather than stacks
  - settings/reduced-motion changes clear or transform active state
  - idempotent disposal and no updates/spawns after dispose
- `season-director.test.js`
  - bounded/max-composed envelopes
  - no combo/line double bump
  - deterministic direction/seed
  - allocation-free output object reuse

Add a source-contract test for the diagnostic query/pulse mapping if it cannot be exercised renderer-free.

---

## 12. Rejected directions

| Direction | Reason |
|---|---|
| Fireworks, embers, bonfire burst | Generic festival/Valborg language; too loud for this meadow |
| More glowing dots/fireflies | The scene already has 720 motes; no semantic distinction |
| Water splash on every lock | Risks reading as Ocean theme and fights the dew material |
| Full-screen radial shockwave | Obscures play, breaks calm atmosphere, poor reduced-motion behavior |
| Maypole lift on every combo | Steals the existing Tetris/perfect-clear hero beat and is too peripheral |
| Brightness-only combo tiers | Weak hierarchy in a scene already dominated by a white-gold sun |
| Load-bearing bloom | Current MRT path is broken/disabled; fallback would lose the effect |
| GPU compute from the first prototype | Unnecessary complexity and dispatch overhead for the expected count |
| Persistent feedback/dew texture | Extra storage/feedback complexity without a proven visual need |
| Dynamic custom tube/garland geometry per event | Allocation/pipeline risk; billboard curves are proven and easier to validate |
| One universal “authentic seven-flower bouquet” | Regional and source traditions vary; reuse the theme's own meadow language |

---

## 13. Definition of done

This work is complete only when:

- The canonical lock payload drives a recognizable four-cell dewprint.
- Combo counts 2–10 progress one coherent wreath/crown system from the last lock origin.
- `COMBO` and `LINE_CLEAR` cannot duplicate the same combo reaction.
- The suite remains structurally readable on Minimal quality, reduced motion, WebGPU, and the renderer's WebGL2 fallback.
- Direct rendering looks intentional with bloom disabled.
- No gameplay/UI contrast regression, camera shake, exposure flash, or central-board obstruction is present.
- Pools are bounded, idle work is zero/near-zero, disposal is clean, and the measured budgets pass.
- Phase-locked playground and short production captures exist for the acceptance matrix.
- The console has no WebGPU validation/device-loss errors and no new TSL warnings.
- The final screenshots—not merely build/test output—support the claim that the effects are done.

Until those captures exist, the design is approved for implementation but the visual feature is not finished.

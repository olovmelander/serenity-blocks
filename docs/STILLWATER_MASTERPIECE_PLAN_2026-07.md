# Stillwater — “The Pool Remembers” Masterpiece Plan

**Status:** Waves 0–8 implemented; current-source immutable v6 validation passes within
the rerun scope documented below

**Date:** 2026-07-13

**Updated:** 2026-07-26

**Scope:** \`src/themes/stillwater/\`, its shared-renderer residue, gameplay reactions,
tetromino presentation, assets, lifecycle, and performance.

**Current evidence:**
[`STILLWATER_WAVES_4_8_EVIDENCE_2026-07.md`](STILLWATER_WAVES_4_8_EVIDENCE_2026-07.md)

**Production renderer decision:**
[`STILLWATER_PRODUCTION_RENDERER_DECISION_2026-07.md`](STILLWATER_PRODUCTION_RENDERER_DECISION_2026-07.md)

## Governance and definition of done

This plan is subordinate to
[ARCHITECTURAL_REMEDIATION_PLAN.md](ARCHITECTURAL_REMEDIATION_PLAN.md) and the accepted
ADRs. In particular:

- [ADR-0007](adr/0007-webgpu-tsl-definition-of-done.md): every visual change needs a
  playground-first screenshot, a console/WebGPU validation check, and a final capture in
  the real theme.
- [ADR-0008](adr/0008-hybrid-renderer-and-webgl-holdouts.md): Stillwater began as an
  intentional WebGL island. Its WebGPU/TSL port required an explicit per-theme product
  decision rather than cleanup for its own sake.
- [ADR-0009](adr/0009-theme-codegen-pipeline-removed.md): author the theme and small shared
  helpers directly; do not reintroduce theme code generation.
- The one-effect-per-session iGPU/TDR rule applies. Each visual pilot below is a separate,
  short playground session.

This document recommends a **proof-gated WebGPU-primary conversion**, because true lake
reflection, integrated surface wakes, selective emissive bloom, a unified grade, and
GPU-scaled particles are material improvements to Stillwater’s central idea. The
conversion only proceeds if the TSL pilot passes the visual and performance gate in
§12. The integrated implementation has now earned the Stillwater-specific opt-in recorded
in
[`STILLWATER_PRODUCTION_RENDERER_DECISION_2026-07.md`](STILLWATER_PRODUCTION_RENDERER_DECISION_2026-07.md):
native WebGPU is primary and forced WebGL2 runs the same TSL graph. The separate Wave 8
lifecycle evidence passes for its explicitly measured populations. The current v6
comprehensive High/WebGPU run and genuine Page Visibility drill are all-pass. The broader
hardware/backend, live-layout, device-loss, and retention matrix remains historical v5
evidence and is never presented as current-v6 authority; §15 records both scopes.

## 1. Executive verdict

At the 2026-07-13 baseline audit, Stillwater had the right fantasy but not yet the right
picture. “A quiet Nordic forest whose lake remembers the player” was distinctive and
worth preserving, while the audited scene still read as an early procedural blockout:

- repeated trunk pillars instead of an ancient canopy;
- stretched spheres instead of a designed shoreline and landscape;
- nearly black water with a bright 2D spirit blob instead of a reflective hero surface;
- a clipped-white central spirit where the board needs calm negative space;
- a high-detail troll that is dark, floating, late-loading, and crossing the board;
- tiny, evenly scattered mushrooms rather than authored bioluminescent clusters;
- several overlapping particle vocabularies with no depth or ownership;
- raw scene reactions that allocate new geometry and mostly look the same at every tier.

The upgrade should not add more independent motifs. It should establish one visual
hierarchy:

> **Board first → lake second → spirit/troll story beat third → atmosphere last.**

The creative north star is **“The Pool Remembers.”** Routine play makes precise dimples
and wakes. Strong play gradually wakes mycelium, moon paths, the spirit, and the troll.
When the action settles, the glade exhales back to stillness.

## 2. Evidence baseline

Baseline capture:
[baseline-idle.png](../artifacts/themes/stillwater/audit-2026-07-13/baseline-idle.png)
(local ignored artifact; standalone Stillwater WebGL surface, boardless, 1920×1080).

The Chrome DevTools MCP successfully opened the project playground, reported the WebGPU
backend and \`window.__PLAYGROUND_READY__ === true\`, captured the phase-locked
\`vesper-lake&t=8\` reference, and found no shader/validation errors. Full-app Stillwater
activation then closed the shared automation target, so the theme baseline was isolated
from boot/Phaser and captured in a dedicated browser surface. This is an audit baseline,
not final visual validation.

### 2.1 Measured standalone scene

At 1904×985, DPR 1, in a warmed local Chrome run:

| Metric | Idle Stillwater |
|---|---:|
| Three draw calls | 67 |
| Triangles | 77,137 |
| Scene position vertices | 190,966 |
| Geometries | 63 |
| Shader programs | 17 |
| Meshes / point systems | 67 / 4 |
| Real lights | 14 |
| Transparent materials | 28 |
| Local ambient points | 350 |
| rAF p50 / p95 / p99 | 4.2 / 4.3 / 4.5 ms |

The high refresh result is useful only as a same-machine structural baseline. It excludes
the shared WebGL background, Phaser board, UI, production build behavior, and target iGPU.
The shipping gate must use production preview/Electron and the matrix in §13.

### 2.2 Reaction stress evidence

A deterministic synthetic burst of 48 piece locks plus a Tetris and combo 10 produced:

| Metric | Idle | Stress peak |
|---|---:|---:|
| Draw calls | 67 | 167 |
| Geometries | 63 | 163 |
| rAF p99 | 4.5 ms | 37.7 ms |
| Maximum interval | 4.7 ms | 104.5 ms |
| Live event objects at trigger | 0 | 50 ripples, 48 bursts, 6 beams |

This is direct evidence that event-time geometry/material creation is a frame-pacing
problem. It also proves that “the scene is fast while idle” is not a sufficient acceptance
criterion.

### 2.3 Hidden work not included above

\`BaseTheme.start()\` also loads Stillwater into the shared WebGL1 renderer. Its
Stillwater branch creates seven more CPU-updated particle systems totaling 275 points,
with dynamic position and alpha \`bufferData\` uploads every update. Production therefore
has two canvases/contexts and duplicate mist, spores, and fireflies before Phaser or UI.
The existing overlay reports the shared renderer’s roughly seven calls and misses the
dedicated Three renderer’s 67 calls.

### 2.4 Hero asset inspection

\`troll.glb\` is one uncompressed, unquantized skinned primitive:

| Property | Current |
|---|---:|
| File / estimated mesh upload size | 10.8 MB / 10.77 MB |
| Triangles | 59,853 |
| Uploaded position vertices | 179,467 |
| Animation | 1 s Walk, 39 channels |
| Texture payload | none; vertex colors |
| Compression extensions | none |

This is disproportionate for a small, dark midground character and creates visible-load,
decode, upload, and lifecycle risk.

## 3. P0 correctness and performance blockers

These land before any visual enrichment.

1. **One ambient owner.** Delete Stillwater’s seven-system branch in
   [renderer.js](../src/rendering/renderer.js) and let the dedicated theme own all ambient
   atmosphere. Do not add a third overlay or duplicate TSL/GLSL runtime.
2. **Repair the frame loop.** Bind once, schedule safely, call
   \`shouldRenderFrame()\`, clamp delta to 0.1 s, and register/cancel exactly one rAF.
   Hidden, paused, suspended, and reduced-quality states must skip update and render work.
3. **Prove pause/resume.** Twenty suspend/resume cycles must still produce one render per
   browser frame. A hidden theme must approach zero draws and dispatches.
4. **Split persistent and transient shafts.** Four ambient beams currently share the
   transient array without \`userData.life\`; the first update writes NaN opacity and they
   never retire. Give ambient shafts their own fixed collection and pool transient slots.
5. **Fix shader math.** Remove all reversed-edge \`smoothstep\` calls before any TSL port.
   Use explicit one-minus masks. Remove the unused water ripple calculation or make it
   actually displace/normal-modulate the water. Correct lily bobbing in the water-normal
   direction.
6. **Unify output semantics.** Most raw \`ShaderMaterial\` surfaces do not participate in
   scene lighting, fog, tone mapping, or output color conversion, while the troll does.
   Establish one fog/tone/grade contract before color tuning.
7. **Make time behavior frame-rate independent.** Replace per-frame \`*= 0.95\` decay with
   exponential half-lives based on clamped delta.
8. **Guard asynchronous assets.** Use awaited/prewarmed loading, a lifecycle generation
   token, stale-result disposal, and a controlled fade-in. A stopped theme must never
   receive a late GLB callback.
9. **Make captures deterministic.** Seed layout, particle phases, troll personalities, and
   event placement. Fixed \`?t=\` shots must not change after reload.
10. **Repair disposal.** Dispose the sky \`CanvasTexture\`, mixer/actions, pools, storage
    resources, and \`spiritBursts\`; confirm memory returns after repeated switches.
11. **Instrument the real surface.** Aggregate dedicated \`renderer.info\` counters with
    the shared/Phaser surface. Record internal resolution, draw calls, triangles,
    programs, geometries, textures, CPU frame percentiles, and GPU timestamps when the
    WebGPU pilot is active.

## 4. Art direction bible

### 4.1 Emotional target

A wet Swedish forest at the last blue-green light of evening. The glade is old, quiet,
and watchful. Warm ivory magic is rare, precious, and localized. The picture should feel
painted and deep without becoming noisy or photoreal.

### 4.2 Palette hierarchy

Use an approximate **70 / 20 / 10** balance:

| Role | Candidate | Use |
|---|---|---|
| Teal-black mass | \`#071713\`, \`#0B2420\` | trunks, deep water, board aperture |
| Moss and mist | \`#2B4A3B\`, \`#78958A\` | land mids, aerial perspective |
| Moon cyan | \`#9CCFD0\` | water edge, far fog, restrained rim |
| Spirit ivory | \`#FFF1C9\` | one focal practical light |
| Foxfire amber | \`#E9A650\` | troll eyes, high-combo accents |
| Heather violet | \`#8E78A8\` | T-spin/special-only counterpoint |

Black must remain colored. Do not crush terrain and the troll into featureless zero.
Ivory highlights must retain an internal core; selective bloom should surround the spirit,
not replace it with a white cutout.

### 4.3 Composition contract

- Reserve a calm central gameplay aperture approximately 36% of frame width and 82% of
  frame height at 16:9. No persistent bright focal object crosses it.
- Put the spirit on the left third near the far shoreline; put the hero troll on the
  right third, partially revealed by a root or rock.
- Shape the shoreline as a shallow S leading from the lower corners toward the spirit.
- Keep water in the lower 35–42% of frame so it reads as a lake and a visual runway.
- Use canopy mass at the top and large root/trunk silhouettes at the extreme sides as
  repoussoir, leaving deliberate sky gaps.
- Build near/mid/far value bands: near deep and detailed, mid colored and readable, far
  lifted into mist.
- Camera parallax gets a dead zone around the board and never moves a focal anchor through
  gameplay UI.
- Author responsive compositions for 16:9, 16:10, ultrawide, solo, 2-player, 4-player,
  and Odyssey presentation. A layout that only works in the boardless playground is not
  accepted.

## 5. Environment upgrade

### 5.1 Landscape and shoreline

Replace five stretched spheres with one designed terrain language:

- an asymmetric heightfield/ribbon defining the lake edge and S-curve;
- two or three instanced/batched root-buttress and boulder families;
- reeds, wet stones, fallen wood, and moss skirts concentrated at contact zones;
- height-based colored fill and aerial perspective rather than black-on-black layers;
- a quiet, low-detail center behind the board and richer corners.

The scene must read in flat silhouette before texture, particles, bloom, or the troll are
enabled.

### 5.2 Trees and canopy

Current “ancient trees” are 21 independent cylinders. Replace them with:

- 2–3 hero edge trees with root flare, bends, large branch forks, moss, and readable
  silhouette;
- 3 authored mid-tree variants instanced into depth/color buckets;
- a batched far forest and canopy-card mass that creates gaps instead of a picket fence;
- per-instance phase/rate attributes for branch-tip motion only; trunks do not breathe;
- frozen transforms for static trees and camera-based drift instead of moving the entire
  world group every frame.

Target: tree/canopy system in 4–7 draws, not 21+, with stronger visual identity.

### 5.3 Mushrooms and small flora

Replace eight isolated cap/stem/light triplets with 3–4 authored clusters:

- 1–2 instanced species, varied scale/tilt/cap shape and seeded phase;
- terrain-sampled grounding and placement beside roots, not on the lake;
- emissive gills/spots and a cheap projected/fake ground-light pool;
- no per-mushroom \`PointLight\`;
- cluster activation used as a combo relay from shore to shore.

Target: 2–4 draws, zero real mushroom lights, and an intentional foreground rhythm.

## 6. The lake — hero surface and renderer decision pilot

The lake is the centerpiece and the proof-of-value surface.

Create \`src/playground/effects/stillwater-water.effect.js\` with:

1. A restrained domain-warped flow normal; use the pinned r181 MaterialX noise nodes
   before hand-rolled noise.
2. Fresnel reflection with a roughness/blur gradient: crisp at grazing angles, dark and
   soft toward the viewer.
3. A reduced-resolution \`reflector({ resolutionScale })\` on High+, culled to only
   composition-relevant layers. Minimal/Low use an analytic sky/spirit reflection.
4. A board-center calm mask that suppresses high-frequency reflection and wakes behind
   the playfield.
5. Shore depth tint, submerged shapes, a few restrained caustic veins, and contact
   darkening around lilies/roots/troll.
6. Eight to twelve fixed wake slots integrated into the water displacement/emissive
   graph. No event-created ring meshes.
7. True spirit/troll reflection where the tier permits it; never a clamped circular color
   blob.
8. A phase-locked grade preview matching the in-game ACES/exposure/post transform.

Capture at \`t=4\`, \`t=8\`, and \`t=12\`, with native WebGPU and
\`forceWebGL=1\`. Compare reflection on/off and High/Low. Check the console after each
short session.

An Extreme-only ping-pong feedback texture for persistent interference is optional and
may be attempted only after fixed wake slots pass the visual target. It must dispatch
only while active and must beat the simpler version perceptually within budget.

## 7. Characters and story

### 7.1 The spirit

Replace the clipped additive billboard with a layered, pre-exposed focal:

- a readable ivory core, translucent body, and separate low-opacity aura;
- 3–5 sparse hair/ribbon filaments or a low-cost crossed-billboard silhouette;
- selective emissive bloom only on core/filaments;
- practical-light response on nearby water, root, and mist via fake bounce or one
  controlled light;
- authored on-screen spawn anchors; no offscreen teleport destinations;
- slow state transitions: observe → approach water → respond → withdraw.

The spirit remains off-center and never becomes a persistent screen-space flash.

### 7.2 The hero troll

Keep one narrative hero, not one hero plus nine equally important billboard creatures.

- Ground the root from its measured bounding box and add contact AO/shadow.
- Replace constant left-right patrol across the board with a short peripheral reveal
  path: lean out, listen, step to water, look at spirit, retreat.
- Add authored reactions: glance for lock, pause/turn for line clear, delighted or wary
  beat for high combo, bow/look-up for perfect clear.
- Give the material moon-cyan rim, mossy colored fill, and warm spirit bounce while
  preserving vertex-color character.
- Restore tested skinned frustum bounds/culling.
- Produce visual LODs: roughly 30–35k triangles on Ultra/Extreme, 15–20k High,
  8–12k Medium, and 3–5k or an impostor on Low/Minimal.
- Quantize first; use meshopt only with the required shared decoder wired and verified.
  Do not add texture compression to a textureless asset.
- Load a small critical LOD before reveal, then cross-fade a higher LOD after warmup.

Reduce the nine procedural billboard trolls to 3–5 distant eye/silhouette accents in one
instanced draw, or remove them if the hero tells the story alone.

### 7.3 Provenance

Expand \`assets/ATTRIBUTION.md\` with:

- the source-photo owner/license or an explicit self-owned source statement;
- TRELLIS model/version, generation settings, rigging/animation steps, and derivative
  asset ownership;
- icon source/generation provenance;
- optimization command and retained original location.

## 8. Atmosphere, lighting, particles, and grade

### 8.1 Atmosphere

- Replace three expensive full-width dual-FBM fog cards with analytic distance + height
  fog and at most one or two bounded drifting low-mist layers.
- Far geometry fades upward toward sage/cyan mist rather than downward into black.
- Use soft-particle depth fade so mist/motes do not cut against terrain.
- Keep aurora/violet out of the default picture unless it earns a rare special-event
  role.

### 8.2 Particle ownership

Delete the shared-renderer Stillwater particles. Consolidate local systems into:

1. far fireflies/stars;
2. near pollen/spores/mist motes;
3. spirit-orbit motes.

Use one fixed buffer or instanced renderer per role, deterministic phase/rate attributes,
GPU vertex motion, soft depth intersections, and tiered active counts. Prefer fewer,
brighter, smaller particles over layered dim additive overdraw.

### 8.3 Lighting

Most scene materials are currently unlit, making 14 real lights largely wasted.

- Use a cheap moon/ground hemisphere or analytic colored fill for the forest.
- Keep one controlled moon key and, if the troll remains PBR, one spirit practical.
- Replace mushroom point lights with emissive/fake pools.
- Use local colored bounce in material graphs so magic visibly belongs to the world.

### 8.4 Post and color grade

If the TSL gate passes, add one \`THREE.PostProcessing\` pipeline:

1. scene pass with MRT emissive output;
2. reduced-resolution selective bloom;
3. ACES exposure;
4. a small 3D LUT or equivalent nonlinear teal-shadow / warm-highlight grade;
5. restrained vignette and dither/grain.

Do not use bloom as fog or depth of field. Non-emissive sky/fog/water must not bloom just
because it is bright. Gate the bloom graph in JavaScript on tiers where it is disabled.

## 9. Gameplay reactions — “The Pool Remembers”

Add a dependency-free \`StillwaterReactionDirector\` with one continuous
\`enchantmentTide\` and fixed transient channels such as \`dimple\`, \`wake\`,
\`twist\`, \`echo\`, \`miracle\`, \`spiritAttention\`, and \`trollCue\`.

The director must:

- normalize full canonical event payloads;
- compute the exact filled-cell lock centroid;
- preserve the COMBO-before-LINE_CLEAR callback ordering without double-spawning;
- use \`clearedRows\` and \`cascadeCount\` for spatial/depth sequencing;
- treat B2B as a short echo TTL, not a persistent boolean;
- filter local/remote ownership correctly in multiplayer;
- honor \`backgroundComboEffects\` and reduced motion;
- use clamped-delta half-lives;
- drive prebuilt uniforms/pools without rebuilding material graphs.

| Event | Environmental response |
|---|---|
| Piece lock | **Rune Dimple:** one exact, quiet water dimple and 3–5 ivory motes |
| Single | **Reed Whisper:** narrow lateral wake; one nearby cluster answers |
| Double | **Twin Current:** paired wakes and a small shore-spore lift |
| Triple | **Moon Path:** broad silver path and one soft shaft |
| Tetris | **The Lake Opens:** four row/depth wakes converge into one mirror swell |
| Combo 2–3 | Tide begins; mushrooms breathe |
| Combo 4–6 | Mycelium relay moves along the bank; motes orbit |
| Combo 7–9 | Tree rims lift; troll/spirit notice; peripheral echo wakes |
| Combo 10+ | **Forest Remembers:** short inhale, warm bloom, firefly wreath, slow exhale |
| Cascade | Each wave travels deeper and alternates shore direction |
| T-spin | **Näck’s Turn:** inward lavender/cyan counter-rotating whirlpool rune |
| B2B | **Echo Across the Mere:** faint replay of the last special after 160–200 ms |
| Perfect clear | **Stillwater Awakening:** dark inhale, aligned reflection, radial mycelium, calm gold release |
| Hard drop | Heavier local dimple and a short reed gust |
| Level up | Slow enrichment of moonlight, reflection warmth, and ambient density |

The shared Phaser layer already owns board-space flashes, banners, shake, and hit-stop.
Stillwater should answer environmentally rather than duplicating those effects.

### Fixed budgets

- 8–12 integrated water wake slots;
- one fixed mote/burst buffer;
- 3–4 transient shaft slots;
- one special-event slot with priority over routine locks;
- no geometry, material, or shader creation from gameplay events;
- no increase in `renderer.info.programs` where a backend exposes it; otherwise record it
  as unavailable and gate event-time geometry/material object allocation directly.

## 10. Tetromino presentation

The current palette over-concentrates I/S/Z/L around cyan-blue and configures several
fields that the active Phaser renderer does not consume. Move to a readable folklore
palette and supported gradient/rim/gloss properties:

| Piece | Target |
|---|---|
| I | moonlit cyan \`#6CC7C6\` |
| O | foxfire gold \`#F2D68A\` |
| T | heather violet \`#9A7FB7\` |
| S | moss green \`#5F9B72\` |
| Z | lingonberry rose \`#C36F73\` |
| J | twilight indigo \`#537E9F\` |
| L | amber \`#D99A5E\` |
| Garbage | wet bark \`#273631\` |
| Clean garbage | mist sage \`#98B5A9\` |

Validate active, ghost, hold, next, garbage, and multiplayer presentation on the supported
Phaser WebGL board. A Phaser Canvas board fallback is unsupported and is not an acceptance
surface. The pieces must remain instantly distinguishable without relying on glow.

## 11. Quality tiers and resource targets

Extend the existing six quality levels rather than inventing a second settings system.
Final counts are tuned from timestamps, but the target shape is:

| Feature | Minimal | Low | Medium | High | Ultra | Extreme |
|---|---:|---:|---:|---:|---:|---:|
| Reflector scale | 0 | 0 | 0 | 0.30 | 0.48 | 0.50 |
| Selective bloom source scale | off | off | off | 0.45 | 0.69 | 0.72 |
| Bounded mist layers | 0 | 0 | 1 | 1 | 2 | 2 |
| Ambient motes | 40 | 90 | 180 | 280 | 540 | 700 |
| Troll LOD triangles | 3,690 | 3,690 | 9,765 | 17,081 | 32,378 | 32,378 |
| Wake slots | 0 | 4 | 4 | 10 | 12 | 12 |
| Transient shaft slots | 0 | 1 | 2 | 3 | 4 | 4 |
| Noise octaves | 1 | 2 | 2 | 2 | 3 | 4 |

Reapply \`computeScenePixelRatio\` on activation, quality change, display/DPR change, and
resize. Never let a quality-disabled shader subgraph continue executing behind a zero
uniform.

The implemented reaction-rune contract is likewise structural: Minimal constructs no rune
geometry, material, or draw (`disabled-minimal`); Low and Medium construct the bounded
`etched-lean` rune; High, Ultra, and Extreme construct the bloom-capable
`mycelial-premium` rune. Quality changes rebuild the runtime, so lower atmosphere tiers
allocate only their 40/90/180 mote capacity rather than retaining Extreme's 700-slot
buffers.

### Structural targets

- standalone static theme: ≤32 draws High/Extreme, ≤22 Medium, ≤15 Low;
- reaction storm: no more than +4 draws and no geometry-count growth after warmup;
- ≤3 ambient particle draws;
- ≤3 real lights;
- ≤6 large transparent layers;
- ≤30 live geometries at clean idle after warmup, excluding backend-owned render targets;
  the one-time visible reaction/post warmup may raise the accepted event lane to 31, but
  repeated events must not grow it;
- hidden/paused: approximately zero theme update/render work;
- no browser LongTask overlapping the DOM canvas reveal or finalized post-reveal window;
  GPU upload and hardware presentation require separate instrumentation.

**2026-07-26 immutable measurement note:** the implementation records direct scene
structure and aggregate renderer submissions separately. The canonical Minimal/Low,
Medium, and High idle graphs are 15, 22, and 45 aggregate submissions respectively.
The immutable High idle capture reports 85,739 triangles. A visible fixed-pool reaction
can add up to three submissions; those transient submissions are not folded into the idle
number. Clean idle records 28 geometries/18 textures; after one-time reaction, post, and
screenshot visibility warmup, every event checkpoint is stable at 31/24. These totals
disclose the reflector/selective-post and fixed-pool hero-capability trades and are never
presented as an aggregate High result at or below 32 or an event-warmed result at or below
30 geometries.

## 12. Renderer proof gate

Compare three matched candidates:

1. repaired/optimized current WebGL;
2. TSL on native WebGPU;
3. the same TSL graphs on \`WebGPURenderer\`’s forced WebGL2 backend.

The TSL route passes when all are true:

- the lake/reflection/height-fog/selective-bloom target is visibly superior in matched
  phase-locked screenshots;
- native WebGPU and forced WebGL2 are console-clean and visually equivalent within the
  agreed tolerance;
- p95 is within the §13 budgets, with no p99 hitch regression;
- startup and VRAM proxies regress by less than 10%, or the cost is explicitly traded for
  the agreed hero capability;
- device-loss teardown/rebuild and all compute/storage disposal are owned;
- no raw GLSL twin is retained. One TSL graph serves both backends.

A measured ≥15% frame-time improvement beyond run variance is sufficient on its own.
Otherwise the conversion must earn its place through the agreed hero capabilities while
still meeting budget. If the pilot fails, keep the WebGL island and do not force the port.

## 13. Performance and validation matrix

Measure production preview (\`:4173\`) or packaged Electron, not dev-server FPS. Disable
adaptive resolution/DRS, pin quality and pixel ratio, use the same seed/camera/time, and
separate cold and warm runs.

### Scenarios

1. 20 s warmed idle.
2. Deterministic 2 Hz piece locks.
3. Line/Tetris/combo 10 storm and a perfect clear.
4. Cold activation through troll readiness.
5. 1080p → 1440p → capped 4K resize/DPR transition.
6. Hidden for 20 s, then resume.
7. Twenty pause/resume cycles.
8. Thirty theme switches and one simulated context-loss recovery.
9. Solo, 2-player, 4-player, and Odyssey layout captures.

### Lanes

- target iGPU: Minimal, Medium, High at 1080p;
- representative discrete GPU: High and Extreme at 1080p/1440p;
- backend comparison: optimized WebGL, WebGPU/TSL, forced WebGL2/TSL.

### Record

- CPU-submission and renderer GPU-timestamp p50/p95/p99 for the isolated manual
  production-frame workload; configured target frequency is not observed display FPS;
- browser LongTask entries, allocation/GC diagnostics, and heap trend. LongTask coverage
  does not include sub-50 ms frame hitches, GPU/compositor stalls, or every GC pause;
- combined draw calls, triangles, geometries, textures, and internal resolution.
  `renderer.info.programs` is recorded as unavailable where the r181 renderer does not
  expose it, never inferred as zero;
- shared buffer upload bytes/frame until the old branch is deleted;
- hero GLTF combined load + parse/attach time. GPU upload is not measured separately;
- warm-render CPU-call return and DOM canvas-opacity reveal. Neither milestone proves GPU
  queue completion, compositor presentation, or first visible display scanout;
- active pool counts and return-to-baseline time;
- hidden/paused frames and duplicate-loop count;
- visual screenshots and console/validation output.

The cold-activation LongTask check is complete only when the browser observer is supported,
has stopped, and covers at least 200 ms after canvas reveal; the immutable runs use 250 ms.
It rejects tasks overlapping reveal or beginning afterward, while pre-reveal masked tasks
remain diagnostic. The aggregate page-load timer is not substituted for
`activationToRevealMs`.

### Frame budgets

- 60 Hz lane: total p95 ≤16.6 ms, CPU ≤6 ms, GPU ≤9 ms, p99 ≤20.8 ms;
- 120 Hz lane: p95 ≤8.3 ms;
- 144 Hz lane: p95 ≤6.9 ms;
- warmed gameplay reaction: ≤0.25 ms CPU and ≤0.75 ms GPU incremental target;
- no single warmed reaction should create a >16.6 ms compile/allocation hitch.

These become calibrated per-surface entries in \`perf-budgets.json\`; null baselines are
not treated as success.

## 14. Playground-first execution roadmap

Each numbered visual pilot is one small effect/session. Port only after its own
phase-locked screenshot and clean console.

### Wave 0 — truth and correctness

- Capture current real-game idle, lock, single, Tetris, combo 4/7/10, T-spin, B2B, and
  perfect-clear states.
- Land the P0 frame-loop, beam, shader-math, loading, disposal, deterministic RNG, and
  instrumentation repairs.
- Delete the shared Stillwater ambient branch.
- Re-run idle and the 48-lock stress baseline.

**Exit:** one loop after 20 resumes; hidden work near zero; counters honest; no NaNs;
deterministic screenshots; no late GLB attachment.

### Wave 1 — composition blockout

Create \`stillwater-composition.effect.js\`: camera, sky, S shoreline, terrain masses,
canopy gaps, board-safe overlay, spirit/troll placeholder anchors. No particles or post.
Use a licensed/generated 16:9 concept in split-reference mode.

**Exit:** the picture reads in silhouette and the board is dominant in every target
layout.

**Completed 2026-07-13:** six layout captures and projection diagnostics passed. See
[`STILLWATER_RENDERER_DECISION_2026-07.md`](STILLWATER_RENDERER_DECISION_2026-07.md#wave-1--composition-exit).

### Wave 2 — lake proof

Create \`stillwater-water.effect.js\` with reflection, flow normal, Fresnel, shore depth,
calm center mask, and grade preview. Capture WebGPU/WebGL2, reflection on/off, High/Low.

**Exit:** §12 renderer decision recorded.

**Completed 2026-07-13:** the isolated lake matrix passed on native WebGPU and forced
WebGL2. The recorded decision is a provisional TSL integration go with production
conversion deferred; see
[`STILLWATER_RENDERER_DECISION_2026-07.md`](STILLWATER_RENDERER_DECISION_2026-07.md#section-12-decision).

### Wave 3 — integrated water response

Add one fixed-slot dimple/wake system to the lake pilot. Trigger routine lock, Tetris, and
T-spin variants through deterministic playground controls.

**Exit:** response hierarchy reads without new meshes, programs, or geometry growth.

**Completed 2026-07-25:** High uses 10 preallocated response slots and Low uses 4, with a
reserved special channel for four converging Tetris wakes or the cyan/violet T-spin turn.
The fixed-time hierarchy passed native WebGPU and forced-WebGL2 inspection, and a warmed
48-event storm left render/resource counters and backing identities unchanged. See
[`STILLWATER_WAVE3_RESPONSE_EVIDENCE_2026-07.md`](STILLWATER_WAVE3_RESPONSE_EVIDENCE_2026-07.md).
That Wave 3 pilot did not obtain incremental GPU timestamp attribution after its capture
target closed, so the historical pilot never treated the reaction as zero-cost. The Wave 8
production harness now measures the warmed idle-to-reaction GPU-timestamp delta and gates
it at +0.75 ms. The final production graph replaces four repeated full-lake Tetris
branches with one construction-time-selected periodic signed-distance field while
preserving four converging ivory wakes. The
[historical v5 native-WebGPU Tetris capture](../artifacts/themes/stillwater/wave8/final-playground/water-high-tetris-lean-periodic-webgpu-v5.png)
reports `lean-four-wake`, ten fixed slots, one active reserved special slot, four depth
wakes, one canvas, and no shader/pipeline failure.

### Wave 4 — forest and flora

In separate short sessions, prove the instanced tree/canopy language, then the mushroom
cluster/material. Port terrain, trees, roots, reeds, lilies, and clusters.

**Exit:** target draw counts and board-safe values hold without particles.

**Completed 2026-07-25:** separate historical forest and flora playground sessions
established the
hero/mid/far tree language, canopy gaps, shoreline dressing, lilies, and clustered
mushrooms before integration. The final High forest reports five tree, three dressing,
and three flora draws; the board aperture has zero focal intrusions and mushrooms use no
real point lights. A historical v5 production Medium retest confirms the complete 22-draw
integrated structural graph; current source retains that tier construction, while a new
board-safe Medium acceptance capture remains pending. See
[`STILLWATER_WAVES_4_8_EVIDENCE_2026-07.md`](STILLWATER_WAVES_4_8_EVIDENCE_2026-07.md#wave-4--forest-and-flora).

### Wave 5 — spirit and troll

Prove the spirit material/aura as one object-material pilot. Separately optimize and
stage troll LOD/material/ground contact in an asset pilot. Then port the authored state
machines.

**Exit:** both characters are readable, grounded, off-board, warm-loaded, and tiered.

**Completed 2026-07-25:** the spirit now has layered internal form and authored
observe/respond/withdraw states; the grounded troll uses peripheral
listen/react/retreat beats. Four quantized animated troll LODs cover 32,378 to 3,690
triangles and total 889,792 bytes, 91.75% below the retained source. See
[`STILLWATER_WAVES_4_8_EVIDENCE_2026-07.md`](STILLWATER_WAVES_4_8_EVIDENCE_2026-07.md#wave-5--spirit-and-troll).

### Wave 6 — atmosphere and post

Prove height fog/soft motes, then selective bloom + LUT/grade. Add only what survives
High and Low screenshots without flattening the composition.

**Exit:** colored depth, controlled ivory highlights, no hard particle intersections,
and clean post graph.

**Completed 2026-07-25:** analytic distance/height fog, bounded mist, soft motes, MRT
emissive isolation, selective bloom, a 16³ LUT, and one ACES output transform form the
integrated grade. The six atmosphere capacities are 40/90/180/280/540/700 from Minimal
through Extreme, with each runtime allocating only its tier capacity. Medium and lean
tiers structurally omit the expensive post graph. See
[`STILLWATER_WAVES_4_8_EVIDENCE_2026-07.md`](STILLWATER_WAVES_4_8_EVIDENCE_2026-07.md#wave-6--atmosphere-and-post).

### Wave 7 — gameplay director and pieces

Implement the reaction director, fixed pools, full event coverage, multiplayer filters,
reduced motion, and tetromino pass. Capture each event separately; never run a full GPU
journey capture.

**Exit:** no duplicate COMBO/LINE_CLEAR spawn, no event allocations, complete hierarchy,
readable pieces, and no shared-board effect duplication.

**Completed and current-source verified 2026-07-26:** the fixed reaction director covers
11 canonical production inputs: lock, hard drop, line clear, Tetris, combo 4/7/10, T-spin,
B2B, perfect clear, and level up, plus reduced motion and multiplayer ownership filtering.
B2B reaches the dedicated echo route 4, hard drop reaches route 8, and level up reaches
route 9. The troll's authored reactions are lock glance, line turn/pause, combo wary,
combo delight, and the perfect-clear bow/look-up sentence. Canonical reactions add no
event-time resources and at most three draws; Minimal structurally omits the rune while
Low and above retain a tier-appropriate rune. The folklore tetromino palette is visible on
the real production board. See
[`STILLWATER_WAVES_4_8_EVIDENCE_2026-07.md`](STILLWATER_WAVES_4_8_EVIDENCE_2026-07.md#wave-7--reactions-and-pieces).

### Wave 8 — production polish and ship gate

Tune quality tiers, reflection/bloom scales, LOD transitions, asset compression, exposure,
and final palette. Run the complete §13 matrix and lifecycle soak.

**Exit:** all §15 acceptance gates pass.

**Evidence scope note:** implementation is complete and §15 passes within the current-v6
rerun scope. Hardware/backend, live-layout, retention, and recovery cells not repeated
against the current fingerprint remain explicitly historical or pending rather than being
folded into that result.

**Implementation completed and current source revalidated 2026-07-26:** the authoritative
current-source directory is
[`immutable-build-final-20260726-1800-v6`](../artifacts/themes/stillwater/wave8/immutable-build-final-20260726-1800-v6/)
with local build-content fingerprint
`267e6556dc09a9f1df8ad92612de20ad945c6798704348da84f83edbe42c1e70`.
Its manifest hash is
`ba47ea361bfa09bd8f57ab7d60bcc8b021a2a37f9e9fad8d970f0776a412b36a`,
its Stillwater theme-chunk hash is
`428f1a114a973c37a66dfa1b095c378d6ffe29aee7377cb29e2f3e150346d932`,
and its 12-file Stillwater manifest-closure hash is
`752e6c0bb628e6462f62046589c659312f4010d0d96dc672577c2649d0949d6a`.
The v6 provenance scope remains a local content identity:
`cryptographicAttestation=false`, `servedBytesVerified=false`, and
`gitContextIncludedInFingerprint=false`.

The [v6 comprehensive production report](../artifacts/themes/stillwater/wave8/v6-comprehensive-wave0-8/stillwater-wave8-summary.json)
passes its High/WebGPU Wave 0–8 scope, including 11/11 production event captures, the
20-cycle pause soak, 20-second explicit app-pause hidden interval, layout and resize
matrices, 2 Hz lock stress, mixed-reaction stress, fixed-resource identities, frame
budgets, strict production-board/modal checks, and a clean console. The separate
[v6 genuine Page Visibility report](../artifacts/themes/stillwater/wave8/v6-page-visibility-direct-smoke2/stillwater-wave8-summary.json)
also passes without invoking explicit pause/resume hooks.

The earlier v5 dossier is historical evidence only. It records the broader AMD/RTX
quality/backend matrix, real two-/four-player layouts, thirty-switch retention, and
deliberate device-loss recovery, but none of those results is promoted to current-v6
authority without a same-fingerprint rerun. See
[`STILLWATER_WAVES_4_8_EVIDENCE_2026-07.md`](STILLWATER_WAVES_4_8_EVIDENCE_2026-07.md#wave-8--quality-and-production-performance).

## 15. Final acceptance gates

**Acceptance status, 2026-07-26:** Waves 0–8 are implemented. The current immutable v6
High/WebGPU comprehensive run and the separate genuine Page Visibility drill pass. The
historical v5 dossier remains useful evidence for the broader hardware/backend,
live-multiplayer, switch-retention, and device-loss matrix, but it is not current-source
authority. Repository command records remain separate from both build-content identities
and are not promoted into an attestation.

### Visual

- The lake, shoreline, canopy, spirit, troll, mushrooms, and particles read as one scene.
- Board readability passes the current-v6 synthetic solo/duo/quad/Odyssey policy matrix.
  Every accepted current-v6 capture is additionally gated on—and visually checked for—the
  real single-player Phaser board being running and visible, one Stillwater canvas, no
  Serenity board mode, no blocking modal, and visible board container/stage dimensions.
  Historical v5 evidence separately covers real two- and four-player local layouts;
  synthetic overrides are never called live multiplayer evidence.
- The spirit has internal form and controlled bloom; the troll is grounded and visible.
- Water reflects and responds without looking like a mirror sheet or a 2D glow blob.
- Near/mid/far layers remain separable without relying on particles.
- Lock, hard drop, line clear, Tetris, combo 4/7/10, T-spin, B2B, perfect clear, and
  level up have distinct, serene, folklore-native responses.
- Tetrominoes are immediately distinguishable in motion and in next/hold/ghost views.

### Technical

- One ambient renderer owner and one theme rAF.
- No event-time geometry/material object creation in the instrumented fixed pools;
  shader-program population is unavailable.
- The v6 comprehensive and genuine-visibility reports have zero console errors and zero
  shader/pipeline or renderer-process failures.
- Forced WebGL2 means `WebGPURenderer`'s WebGL2 backend running the same TSL graph. It is
  not Phaser Canvas. The production board hardcodes `Phaser.WEBGL`, Phaser 4 supplies no
  Canvas renderer, and a genuine Canvas 2D board fallback is unsupported.
- Minimal omits the rune graph and premium post graph structurally; Low and Medium use
  the lean rune without bloom/LUT; quality-disabled work is absent from construction.
- Normal Stillwater eviction releases the runtime into one reusable renderer pool after
  queue drain and transient-cache retirement. Only full `ThemeManager.cleanup()` calls
  the registered terminal shared-resource disposer, which stops the renderer, calls its
  terminal `dispose()`, detaches the canvas, and destroys an owned WebGPU device.
- Stillwater explicitly owns Three r181's private `renderer._animation` callback while
  pausing, validating, pooling, and resuming. That private dependency is tested and
  diagnosed because stopping only the theme rAF would leave renderer-owned callbacks
  alive.
- Asset readiness and stale-load disposal are current-source tested. Device loss,
  current-fingerprint switch retention, forced-WebGL2 parity, reduced-motion capture, and
  live local multiplayer retain historical v5 evidence pending same-v6 reruns.
- Attribution and source ownership are complete.

### Performance

- The current immutable v6 High/WebGPU 1920×1080/60 Hz comprehensive lane passes:
  idle total p95/p99 2.031/2.262 ms, reaction total p95 1.997 ms, reaction CPU/GPU p95
  1.800/0.328 ms, and warmed reaction delta −0.100/+0.066 ms CPU/GPU.
- The same v6 run passes the 20-second 2 Hz lock lane at 2.062 ms total p95 and the
  30-second mixed-reaction storm at 2.097 ms total p95. It records 1,200 idle,
  1,200 reaction, 1,200 lock-stress, and 1,800 storm samples.
- These values are CPU submission plus renderer GPU timestamp for
  `isolated-manual-production-frame`; 60 Hz is target pacing, not observed display FPS.
  Queue-drain cadence/latency and scheduler pacing remain diagnostics and are not display
  FPS.
- High idles at 45 aggregate draws and 85,739 triangles. Canonical reactions use at most
  three additional draws. After the one-time fixed-pool warmup, every event capture keeps
  the same resource identities and renderer memory, with
  `perEventResourceCreation=0`. `renderer.info.programs` is unavailable and is never
  inferred as zero.
- The v6 comprehensive run passes 20 pause/resume cycles and a 20-second explicit
  app-pause interval with zero hidden update/render delta. The separate headed
  Page Visibility run passes a native visible→hidden→visible cycle with
  `document.hidden` and application pause state changing naturally, no explicit
  pause/resume hooks, zero hidden update/render delta, and one canvas after resume.
- Current-v6 cold activation reaches DOM canvas reveal 513 ms after scene start with zero
  LongTasks overlapping reveal or beginning during the 250 ms post-reveal window. This
  does not prove GPU/compositor presentation or the absence of every shorter hitch or GC
  pause.
- The six historical v5 hardware lanes all passed their recorded budgets, but their exact
  AMD/RTX values remain historical and are not substituted for an unrecorded v6 hardware
  matrix. The historical v5 thirty-switch census is likewise not a current-v6 leak claim.
- Attempted v6 AMD lanes remain rejected diagnostics: visual review found their
  reaction/final screenshots behind `#game-over-modal` after the recovery gate had
  false-passed. They require a hardened gate, a new immutable fingerprint, and clean
  board-visible reruns before any metric can enter acceptance evidence.

### Repository verification

- Current-source focused Stillwater Vitest: pass on 2026-07-26, 18 files / 183 tests.
- Current-source affected-test selection: pass on 2026-07-26, 236 / 236 tests.
- Current-source lifecycle and terminal-ownership selection: pass on 2026-07-26,
  45 / 45 tests.
- Historical repository-wide `npm test` record: one unrelated Koi Pond assertion failed
  (`Extreme` DPR expected `1.5`, implementation returned `1.4`); 2,747 / 2,748 tests and
  711 / 713 suite units passed. This record predates the final current-source fixes and is
  not relabeled as a v6 run.
- Current working-tree gates also pass typecheck; the lint ratchet with 1,429 errors
  against its 1,443 ceiling, 985 warnings, and zero fatal errors; boundaries across 815
  modules and 2,469 dependencies with zero violations; and the theme lifecycle CLI audit.
  The raw lint inventory remains governed debt rather than a clean-lint claim.
- Historical dated records separately show a passing production build and
  `git diff --check`. No working-tree command record is promoted into the v6 content
  identity.
- The final custom-output-directory hygiene rebuild/recheck is intentionally not claimed
  here until its manifest and closure hashes are reverified against the v6 identity.

These working-tree/source command records are not cryptographically attested and do not
prove they ran against served v6 bytes. Conversely, the v6 local build-content identity
includes selected build and validation inputs but does not attest unrelated repository
commands.

## 16. Proposed module boundaries

Split only where ownership and disposal become clearer; do not perform a mechanical
directory rewrite:

\`\`\`text
src/themes/stillwater/
  stillwater-theme.js                 thin lifecycle/event wrapper
  stillwater-quality.js               tier table and live application
  stillwater-tetrominos.js
  composition/stillwater-composition.js
  rendering/stillwater-water.js
  rendering/stillwater-forest.js
  rendering/stillwater-characters.js
  rendering/stillwater-particles.js
  sim/stillwater-reaction-director.js
  post/stillwater-pipeline.js
  assets/ATTRIBUTION.md
\`\`\`

The boundaries above landed selectively to clarify ownership and disposal. This document
is now the implemented art-direction reference and the live Wave 8 validation ledger.
Current-source authority is the immutable v6 build and its passing comprehensive
High/WebGPU and genuine Page Visibility reports. Broader v5 matrix results remain
explicitly historical until repeated against that current identity.

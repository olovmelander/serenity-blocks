# Chiral Gold — visual overhaul, October 2026

Status: implemented and freshly verified on native WebGPU and node WebGL2,
including the production theme's gameplay event path and portrait/landscape Low
composition. This is an implementation record, not an independent architecture
roadmap. ADR-0007, ADR-0018, ADR-0019 and ADR-0020 remain the governing rendering
and validation contracts.

## Art direction

Chiral Gold now frames the playfield with two oppositely handed sculptures made
of intertwined, bevelled gold ribbons. Broad reflective faces, narrow ivory
glints and fine flowing filaments make their volume readable. Amber atmospheric
pools sit behind each sculpture, a faint distant gold orbit connects the upper
frame, and the center remains an obsidian void for the board.

The centerpiece is procedural geometry and TSL material code. It does not need
downloaded images, textures, Blender assets or an environment-map fetch. Its
metallic appearance is an authored analytic reflection model in unlit node
materials, rather than a physical metal material dependent on scene lighting.
The same reflection, sheen and event fronts therefore survive on both supported
renderer backends.

Camera movement is restrained to keep both sculptures in frame: slow orbit,
breathing, pointer parallax and event nudges remain, with substantially smaller
excursions than the former wandering camera. Portrait layout compresses the
sculptures into slender edge columns. Low and Minimal retain the ribbon
silhouette instead of losing the centerpiece when post-processing or compute
is disabled.

## Runtime ownership

| Module | Responsibility |
| --- | --- |
| `src/themes/chiral-gold/chiral-gold-theme.js` | Renderer selection, quality, scene lifecycle, audio channels, gameplay event routing, particles, resize and warmup |
| `src/themes/chiral-gold/chiral-gold-sculpture.js` | Baked chiral ribbons and filaments, amber atmosphere, distant orbit, four traveling front channels and pooled reaction coronas |
| `src/themes/chiral-gold/chiral-gold-particles.js` | Instanced sprite geometry for node particles and the canonical CPU position attribute accessor |
| `src/themes/chiral-gold/chiral-gold-materials.js` | Sized dust, wisps, strands and velocity-shaped spark materials using TSL |
| `src/themes/chiral-gold/chiral-gold-compute.js` | Native compute compilation, ready-state dispatch, renderer/generation ownership and retirement |
| `src/themes/chiral-gold/chiral-gold-post.js` | RenderPipeline, bloom, warm filmic grade, restrained chromatic offset, grain and dither |
| `src/playground/effects/chiral-gold.effect.js` | Isolated production sculpture and post with deterministic seeking and optional board placement guide |

The sculpture interface is `createChiralGoldSculpture({ scene, quality, random })`.
Its controller owns `resize(width, height, cameraDistance = 1520)`,
`update(time, delta, { pulse, energy, beat })`,
`trigger(kind, strength, position)`, `resetReactions()`, `diagnostics()` and
idempotent `dispose()`. Geometry is baked at creation. Per-frame movement uses
time-based group transforms and a fixed collection of uniforms; normals are not
rebuilt every frame. All sculpture materials and geometries are disposed once,
including shared foil, filament and halo geometry.

The existing theme's dust, wisps, particle strands and burst choreography remain
as secondary layers. Persistent volumetric beams are disabled in the quality
presets so the paired ribbon structure remains the dominant silhouette.

## Event language

| Trigger | Result |
| --- | --- |
| Piece lock | A localized spark reaction at the projected locking position, one restrained peripheral corona and an ivory pulse front launched at the lock's height on the ribbons |
| Line clear | Stronger ribbon travel and a gold corona, layered with the existing clear bursts and shockwave choreography |
| Four-line clear | A `tetris` sculpture reaction with opposing coronas and a stronger traveling front |
| Combo | A paired gold response on both sculptures, warmer highlights, stronger travel and the existing bounded staged burst/strand choreography |
| Audio beat and energy | Gentle continuous shimmer, foil lift and atmospheric breathing through shared uniforms |

Traveling fronts are distinct from overall brightness. Each front expands away
from its initiating ribbon height in both directions, fades over two seconds,
and is reused through a four-entry round-robin pool. Foil fronts are amber/ivory;
the same pulse catches the hairline filaments more brightly. The ambient sheen
continues to circulate even when there are no gameplay events.

Reaction coronas expand, drift outward and fade with time. A normal reaction uses
one slot with a 1.55-second lifetime; a hero reaction uses two slots with a
2.15-second lifetime. Same-frame event storms reuse slots without allocating new
geometry or materials. Event positions inside the central board region are
redirected to a peripheral sculpture for its corona; lock spark positions retain
their gameplay projection.

Cleared-row dissolve emission now escapes from two edge columns as sparse,
short-lived gold flecks. The same reduced density, size and lifetime apply to
native compute and CPU fallback. This preserves the row-clear connection while
keeping the middle readable instead of accumulating bright white strips.

## Quality and bounded effects

The sculpture budgets below are counts across both sides. Ribbon segment count
is per ribbon. Fine filament geometry uses a reduced segment count with a floor
of 80. Four traveling front channels are present at every quality tier.

| Quality | Foil ribbons | Ribbon segments | Fine filaments | Corona pool |
| --- | ---: | ---: | ---: | ---: |
| Extreme | 6 | 280 | 20 | 8 |
| Ultra | 6 | 240 | 16 | 8 |
| High | 6 | 192 | 12 | 6 |
| Medium | 6 | 152 | 8 | 4 |
| Low | 4 | 112 | 6 | 4 |
| Minimal | 4 | 80 | 4 | 2 |

The retained particle systems have separate budgets. GPU burst capacity and the
CPU fallback pool are alternative burst paths. Native compute must be ready
before it is dispatched; WebGL2 and failed/unavailable native burst compute use
the CPU pool.

| Quality | Dust | Wisps | GPU burst capacity | CPU burst pool × particles | Persistent particle strands |
| --- | ---: | ---: | ---: | --- | --- |
| Extreme | 14,000 | 1,000 | 24,000 | 10 × 1,400 | 6 × 4,200 |
| Ultra | 10,000 | 700 | 18,000 | 8 × 1,100 | 4 × 3,200 |
| High | 6,000 | 500 | 12,000 | 6 × 900 | 3 × 2,600 |
| Medium | 3,800 | 300 | 8,000 | 10 × 700 | 2 × 1,800 |
| Low | 1,800 | 150 | 0 | 6 × 900 | 0 |
| Minimal | 900 | 0 | 0 | 3 × 400 | 0 |

Temporary particle strand segments are capped at eight, and transient shockwaves
at twelve. Displaced effects release their geometry and materials. CPU burst
pools are hidden when empty, upload their final expiry frame, and retain the
same arrays when another burst reuses them. These are ownership and workload
bounds, not measured frame-rate improvements.

## Renderer parity and corrections

Both native WebGPU and the WebGL2 backend of `WebGPURenderer` use node materials
and the TSL scene. Material/post selection keys on renderer kind; backend checks
are used for compute and MRT capabilities. Native WebGPU can use explicit
emissive MRT bloom with the shared emissive material blending helper. WebGL2
uses full-scene bloom at the configured threshold. Low and Minimal render the
same artwork directly without the post stack.

Sized dust, wisps, strand particles and burst sparks now use instanced sprite
quads. Native WebGPU point primitives
are one pixel, so a point-only implementation cannot reproduce the sized bokeh
and streaks of the WebGL path. Particle positions live in `aParticlePosition`,
separate from the immutable sprite quad's `position` attribute. CPU wisp,
persistent strand, temporary strand and burst updates all use the canonical
attribute accessor; moving particles cannot accidentally deform the quad.
Storage-backed material access uses `instanceIndex` for this geometry.

Particle materials have radial alpha masks and warm, controlled highlights.
Velocity stretching has bounded extent and a stable direction for stationary
sparks. The post grade preserves more amber/copper color in highlights, uses a
much lower black-floor cutoff, and applies the vignette to the combined scene
and bloom. Chromatic offsets sample the scene texture directly, avoiding the
extra intermediate pass caused by applying the addon to an already graded
expression. Grain and dither use pixel coordinates. Renderer tone mapping is
disabled while the post stack owns the filmic grade.

Scene composition leaves burst objects at unit scale, preserving the projected
piece-lock origin through viewport changes. Pending combo state is consumed
even when a clear carries its own explicit combo count.

The frame loop schedules its next frame before checking `document.hidden`, the
global rendering pause flag and `shouldRenderFrame()`. Hidden and globally
paused frames reset the timer and skip compute, reaction advancement and
rendering. Paced frames skip the work while retaining elapsed time for the next
rendered frame. The theme uses `THREE.Timer`; delta remains clamped. Async compute
initialization checks actual pipeline readiness and the
owning renderer/generation. Retired systems cannot be revived by stale compile
completion, and obsolete scene initialization cannot reveal a retired canvas.
If native dust, burst or wisp compilation fails, only that layer is rebuilt on
the CPU; successful native systems remain available.

Warmup temporarily reveals hidden pooled drawables, renders through the actual
shipping post/target configuration, waits for submitted GPU work within its
bounded fence, then restores visibility. This includes the event corona and
burst pipelines. A bare target-less `compileAsync(scene, camera)` would skip
hidden pools and can warm the wrong MRT configuration, so it is not used here.

## Validation record

Fresh capture evidence is recorded alongside per-state diagnostics and an
aggregate `*-validation.json` report for each run:

| Capture set | Result |
| --- | --- |
| `playground-webgpu-desktop-high-*` | Native WebGPU, 1440 × 900, `t=8`; zero console errors or warnings |
| `playground-webgl2-desktop-high-*` | Node WebGL2, 1440 × 900, `t=8`; zero console errors or warnings |
| `theme-webgpu-desktop-high-*` | Production theme idle / lock / clear / combo; zero errors or warnings, MRT enabled and all three compute systems ready |
| `theme-webgl2-desktop-high-*` | Production theme idle / lock / clear / combo; zero errors and four ANGLE performance warnings |
| `theme-webgl2-phone-low-*` | Production theme portrait idle / lock / clear / combo and landscape; zero errors and four ANGLE performance warnings |

All five aggregate validation records pass. The three integrated runs retire
with `active: false` and zero canvases remaining in the theme container. Native
idle/clear/combo, WebGL2 idle/clear and phone idle/combo/landscape screenshots were
visually inspected after the final dissolve refinement. The ANGLE warnings say
the software driver exhausted reserved `outsideRenderPass queueSerial` capacity
and ended a render pass; they are recorded as performance diagnostics, not
hidden or counted as shader/validation failures.

The native adapter is a software Google SwiftShader adapter, and the WebGL2
captures also use software rendering. The isolated playground holds `t=8` with
zero simulation delta. The theme harness advances fixed 1/60-second steps,
draws the final scene once, and drains submitted native GPU work before readback.
These captures demonstrate rendering correctness and bounded scene ownership.
They do not establish hardware FPS, latency, battery cost or physical-phone
performance.

An earlier session included a before-image check of the previous shipping
WebGL2 artwork. That image has not been regenerated in this fresh evidence set;
it is not linked or counted as current acceptance.

Focused tests cover all six sculpture tiers, finite geometry, desktop/portrait/
landscape projection, bounded reuse and decay, deterministic reset, exact-once
disposal, particle/quad array separation, projected lock placement, final CPU
expiry upload, transient effect caps, frame gating, stale activation and checked
compute readiness. Additional regressions cover native compute failure recovery,
renderer-bound compilation, paused frame timing and dissolve sparsity on both
particle paths. The focused validation set passes 136 tests. The final
integrated-main full suite passes all 536 test files and 5,778 tests in 141.71
seconds.

| Final acceptance item | Status |
| --- | --- |
| Isolated desktop WebGPU / WebGL2 | Passed |
| Integrated desktop native WebGPU idle / lock / clear / combo | Passed |
| Integrated desktop node WebGL2 idle / lock / clear / combo | Passed |
| Integrated portrait node WebGL2 Low and landscape | Passed |
| Integrated teardown ownership diagnostics | Passed: inactive, zero remaining theme canvases |
| Final full suite | Passed: 536 files, 5,778 tests, 141.71 seconds |
| Typecheck | Passed on integrated main |
| Production build and boot closure | Passed on integrated main in 21.88 seconds |
| Scoped sculpture/playground lint and lint ratchet | Passed; error ceiling lowered to 1,115 |
| Dependency boundaries, theme lifecycle, TypeScript ratchet, architecture fitness | Passed |
| Structural performance and release gates | Passed |
| Physical GPU and physical-phone acceptance | Not measured |

Reproduction commands and the software-browser adapter flags are recorded in
`reports/chiral-gold-overhaul/README.md`. The isolated board overlay is only a
placement guide. The theme capture harness mounts the production theme and
canonical event bus, but it does not run a full gameplay session or verify a
real gameplay board/HUD.

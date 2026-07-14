# Starlight Masterpiece Review and Upgrade Plan

**Date:** 2026-07-13

**Status:** Reference — evidence and art direction for umbrella Phase 7; not an
independent architecture backlog

**Scope:** `src/themes/starlight/`, its playground effects, tetromino styling,
reactive gameplay effects, and Starlight-specific performance

**Governance:** [ARCHITECTURAL_REMEDIATION_PLAN.md](ARCHITECTURAL_REMEDIATION_PLAN.md),
[ADR-0007](adr/0007-webgpu-tsl-definition-of-done.md),
[ADR-0008](adr/0008-hybrid-renderer-and-webgl-holdouts.md), and
[WEBGPU_THREEJS_WORKFLOW.md](WEBGPU_THREEJS_WORKFLOW.md) win if this plan conflicts
with them.

This plan consolidates and replaces the execution guidance in
[STARLIGHT_WEBGPU_MASTERPIECE_PLAN.md](STARLIGHT_WEBGPU_MASTERPIECE_PLAN.md) and
[STARLIGHT_COMBO_LOCK_EFFECTS_PLAN.md](STARLIGHT_COMBO_LOCK_EFFECTS_PLAN.md). Those
documents remain useful historical art-direction sources, but their implementation
status is stale: post-processing, compute stardust, aurora, meteors, shockwaves, and
constellations now exist.

## 1. Executive decision

Starlight already has a strong technical skeleton. The next level is not more
always-on layers. It is stronger visual hierarchy, physically believable sky cues,
one coherent response to each gameplay resolution, and enough GPU headroom that the
rare spectacles feel effortless.

The recommended north star is:

> **Starlight — the living observatory. The sky quietly remembers how the player
> plays, then turns mastery into one earned celestial event.**

The upgrade has four priorities, in order:

1. Establish deterministic visual and performance truth in the playground.
2. Remove correctness and silent-cost defects before changing the art.
3. Recompose the resting sky and gameplay reactions around a strict intensity
   hierarchy.
4. Integrate only screenshot-proven effects, then gate the result with p95 frame
   time, GPU timing, accessibility, fallback, and lifecycle tests.

### Scope clarification: Starlight is not the black-hole theme

The request links `src/themes/starlight/`, while the repository also has a distinct
`src/themes/black-hole/`. Existing Starlight direction deliberately avoids a
permanent black hole, accretion disc, and lensing centerpiece so its identity does
not collapse into Black Hole or Cosmic Noir. This plan therefore treats **Starlight**
as the target.

Black-hole research is still useful for an optional, brief **gravitational-wish
apex** at a very high combo: a dark micro-shadow, asymmetric photon arc, and local
star lensing that resolves into a constellation. It must remain rare, small,
quality-gated, and disabled by reduced motion. If the intended target was literally
`src/themes/black-hole/`, stop after Phase 0 and re-baseline that theme rather than
porting this plan blindly.

## 2. Evidence-based review

### What is already good

- The scene is modular: sky, starfield, stardust, meteors, shockwaves,
  constellations, camera, and post are independently testable.
- The star palette, magnitude hierarchy, crisp pixel-size floor, restrained base
  chromatic aberration, and selective-MRT bloom direction fit the theme.
- Particle and effect pools are bounded. Compute nodes are created once rather than
  rebuilt per frame.
- `safeAnimate` supplies the theme-level render gate, and WebGPU/WebGL2 fallback is
  routed through `WebGPURenderer({ forceWebGL: true })` rather than a second theme.
- Quality tiers already control star and stardust counts and disable several layers
  at lower settings.

### Highest-impact findings

| Finding | Player-visible consequence | Required response |
|---|---|---|
| The resting nebula is nearly uniform purple in the playground, despite two very expensive domain-warped FBM evaluations per full-screen fragment. Aurora adds another full-screen FBM layer on High+. | The most expensive background work has weak composition and limited depth. | Replace it with an art-directed, asymmetric sky solution and measure before/after GPU time. |
| Many masks use reversed-edge `smoothstep`, including sky, stars, dust, meteors, shockwaves, constellations, aurora, and post. The pinned r181 guidance treats this as undefined/unsafe. | A driver change can alter masks, rings, fades, or spikes; visual tuning rests on unstable math. | Rewrite as `1.0 - smoothstep(low, high, x)` or equivalent, one isolated effect at a time, with screenshots. |
| The post graph always performs three scene samples for chromatic aberration, even where the strength is zero. It also carries an unused board-halo SDF and two full-screen sine hashes; bloom has no explicit downsample policy. | Low-tier and idle frames pay for invisible work. Fill cost grows sharply with DPR. | Build static post graph variants by tier/capability and remove nodes, not just zero their uniforms. |
| Stardust evaluates the distance/falloff for all eight impulse slots every particle, every dispatch, including idle. Damping is frame-rate dependent. | Compute cost is paid at rest; motion changes at 60/120/144 Hz. | Build idle/reactive compute variants once, use time-normalized damping, and switch only at safe graph boundaries. |
| The stardust renderer allocates an `InstancedMesh` transform buffer that its vertex graph does not consume. | Wasted storage/VRAM and lifecycle surface. | Use an instanced-buffer geometry/mesh contract that contains only consumed data. |
| Meteor, shockwave, and constellation renderers upload dynamic attributes and stay draw-visible even when no slot is active. | Idle work and avoidable queue traffic hurt frame-time tails. | Dirty-gate uploads, hide empty meshes, and use active draw ranges where useful. |
| Active quality/render-scale changes are sampled mainly during scene creation or resize rather than applied as a complete live Starlight policy. | Adaptive shedding can lag or fail to change active resources, while benchmark configuration becomes ambiguous. | Wire a single live quality/DPR contract; rebuild tier resources only at explicit boundaries and pin it off during measurement. |
| The starfield has one wave uniform. Multiple reactions overwrite one another. Constellations can have 12 ambient signs, and combo handlers can add several more. | The sky becomes a clipped star map instead of one earned memory; stacked reactions lose causality. | Make one authored celestial beat dominant and cap persistent signs aggressively. |
| Event handlers react independently to `PIECE_LOCK`, `LINE_CLEAR`, `COMBO`, `TSPIN`, `B2B`, and `PERFECT_CLEAR`. | One resolution can unleash rings, impulses, waves, meteors, signs, post pulses, and delayed echoes at once. | Add a Starlight reaction director that coalesces one resolution into one dominant beat plus bounded modifiers. |
| The current `COMBO` callback represents cascade-wave depth and fires before the following `LINE_CLEAR`; `LINE_CLEAR.cascadeCount` already carries the relationship. | Treating `COMBO` as a separate spectacle double-fires the same wave and makes the apparent combo ladder semantically wrong. | Store it as pending per-player resonance and let the following clear own the geometry. |
| `HARD_DROP` and `LEVEL_UP` are listened for but are not canonically emitted on this bus. `B2B` arrives after its qualifying special and the delayed callback captures shared mutable position. | Some authored effects are dead; B2B can echo the wrong event or position. | Do not invent theme-local emits. Repair canonical contracts in the umbrella event phase, or remove dead claims. Clone delayed state and use the resolved action cue. |
| Several animation decays and camera lerps are fixed per frame, and delayed choreography uses wall-clock `setTimeout`. | Effect duration, camera feel, and timing vary with refresh rate and can continue while paused/hidden. | Use a theme-time timeline and exponential, delta-time-normalized decay. |
| Board location is approximated rather than projected. Stars reject a rough central strip, dust ignores the board, and center reactions are moved to side lanes. | Effects do not appear to originate from the locked piece and can compete with playfield readability. | Project the live board DOM rect into the scene and maintain a single board-space contract on resize/layout change. |

The shader expansion explains why optimization must start with pixels, not headline
particle counts. A nebula fragment currently expands to roughly 256 `hash3` plus eight
`hash2` evaluations before its remaining color work; the High+ aurora adds roughly 64
more `hash3` evaluations over another screen-covering layer. These are static code-cost
estimates, not measured GPU duration. Three r181's default five-mip bloom contributes
about twelve full-screen bloom draws before Starlight's final post draw, while Medium+
MRT adds another full-resolution color attachment. The plan must A/B bloom resolution,
MRT, MSAA, and sky composition on the target GPU instead of assuming any one is the
sole bottleneck.

### Playground/Chrome baseline from this review

- `starlight-starfield` reached `window.__PLAYGROUND_READY__ === true` under WebGPU.
  At a 2137×1167 drawing buffer it reported four draws and 64,721 triangles. The
  captured frame was clean and readable but compositionally flat: sparse stars over
  a mostly uniform violet sky, without a convincing Milky Way hero or dust-lane
  depth.
- A short timestamp sample was around 1.2–1.4 ms for the render section, but this is
  **diagnostic only**, not a baseline. DevTools, development-server overhead,
  timestamp quantization, and the current query lifecycle make it unsuitable for an
  acceptance claim.
- `?trackTimestamp=1` currently accumulates unresolved queries until Three warns that
  the maximum query count was exceeded. A subsequent stardust timestamp session
  destabilized the automation/GPU browser and produced a black capture. This is a
  measurement-harness and device-stability finding, not proof that one Starlight
  shader caused the failure.
- The playground calls `update(time)` while stateful effects implement
  `update(time, dt)`; several fall back to `0.016`. Combined with `Math.random`
  catalogs, `?t=` is not truly phase-locked for those effects today.

No production visual change should use these diagnostic timings as a win. Phase 0
must make captures deterministic and timestamp queries bounded first.

## 3. Research translated into art direction

The research is useful only where it produces a concrete design rule:

| Source observation | Starlight design consequence |
|---|---|
| ESA Gaia maps show that the Milky Way is a dominant, asymmetric density structure with bright concentrations and dark foreground dust lanes. | The resting sky needs one readable galactic flow with negative-space dust cuts, not uniform purple FBM everywhere. |
| Real stars span a restrained temperature family rather than arbitrary rainbow colors. | Keep the existing blue-white, warm-white, amber, and rare red hierarchy; reserve violet/cyan saturation for magical energy, not every star. |
| NASA black-hole visualizations emphasize a dark shadow, bent background light, a lensed secondary view, hotter inner disc, and an asymmetrically brighter approaching side. EHT observations likewise resolve a persistent bright ring around a dark shadow. | If the optional combo apex is approved, avoid a generic symmetrical neon donut. Use a brief asymmetric arc and local background-star displacement, then resolve it into Starlight's constellation language. |
| High-quality real-time black-hole work can use precomputed lookup tables and constant-time per-pixel beam intersection rather than iterative ray marching. | A literal lensing branch must prototype a LUT/analytic warp and strict screen-space bounds; no full-screen iterative ray march in gameplay. |
| WebGPU timestamp queries are optional and commonly quantized for security. | Treat GPU timings as same-device relative evidence, resolve queries deliberately, and pair them with throughput/frame-time measurements. |
| WCAG's flash guidance limits dangerous rapid flashing. | No repeated full-screen white/chromatic flashes; cap cadence, area, and contrast, and provide reduced-motion/reduced-effects behavior. |

Research references:

- [ESA Gaia EDR3 all-sky colour map](https://sci.esa.int/web/gaia/-/the-colour-of-the-sky-from-gaia-s-early-data-release-3)
- [NASA: stars and stellar color](https://science.nasa.gov/exoplanets/stars/)
- [NASA black hole with accretion disc visualization](https://svs.gsfc.nasa.gov/14619/)
- [Event Horizon Telescope: first M87 black-hole image](https://eventhorizontelescope.org/press-release-april-10-2019-astronomers-capture-first-image-black-hole)
- [Bruneton: Real-time High-Quality Rendering of Non-Rotating Black Holes](https://arxiv.org/abs/2010.08735)
- [WebGPU timing and timestamp-query caveats](https://webgpufundamentals.org/webgpu/lessons/webgpu-timing.html)
- [WCAG 2.2: Three Flashes or Below Threshold](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html)

## 4. The visual system

### 4.1 Intensity hierarchy

Every layer must have a role and an intensity ceiling.

| State | Visual promise | Relative energy |
|---|---|---:|
| Rest | Deep indigo-black observatory, one Milky Way flow, sparse hero stars, slow coherent dust current | 1 |
| Move/rotate | Almost subliminal local twinkle or dust response; never a camera event | 1–2 |
| Ordinary lock | Cell-accurate inward breath, stellar seal, and one shallow sky ripple | 3 |
| Line clear | Row-aligned light travel with meteor punctuation proportional to clear count | 4–6 |
| Tetris/T-spin/B2B | One dominant authored gesture with restrained modifiers | 6–8 |
| High combo/perfect clear | Rare celestial memory: constellation birth or optional gravitational wish | 9–10 |

Rules:

- A higher state replaces or absorbs lower-state spectacles; it does not simply add
  all of them.
- At rest, at least 70% of the image should be quiet enough that stars and the board
  retain silhouette.
- The board pocket is protected negative space. Bloom, dust, star density, and camera
  parallax reduce there rather than relying on the UI to overpower the scene.
- Long-lived visual memory is one earned sign, not twelve competing ambient figures.

### 4.2 Resting sky: from expensive fog to authored galaxy

Prototype three approaches in `starlight-starfield.effect.js`, then keep the cheapest
one that reaches the reference:

1. **Recommended:** a small, authored equirectangular/KTX2 sky texture or baked
   low-frequency lookup, sampled once, with a cheap analytic drift and a separate
   sparse star layer. This gives art direction and stable cost.
2. A half/quarter-resolution procedural sky target refreshed slowly, composited into
   the full-resolution scene. This is acceptable only if texture allocation and
   refresh cadence are stable.
3. A simplified analytic band with two-dimensional noise and a few octave/ridge
   samples. Do not retain nested 3D domain-warped FBM merely because it is procedural.

Composition target:

- Near-black upper-left and lower-right voids create dynamic range.
- A diagonal/off-axis Milky Way band crosses behind, not through, the primary board.
- Warm stellar density accumulates on one side; blue-white anchors balance it.
- Irregular dark dust lanes cut through the band and remain visible after bloom.
- Aurora becomes a rare, slow High+ accent or is folded into the sky lookup. It must
  justify a separate full-screen pass with measured visual gain.

### 4.3 Starfield

- Seed catalogs from a documented constant so fixed-time captures are reproducible.
- Keep a magnitude-heavy distribution: many subpixel/one-pixel stars, fewer medium
  anchors, and extremely rare diffraction heroes.
- Replace reversed smoothsteps and validate spike/halo falloff at native DPR.
- Move expensive per-fragment blackbody/twinkle work to precomputed attributes or
  vertex varyings where it survives visual comparison.
- Add subtle density clusters and dust-lane occlusion so the star map belongs to the
  galaxy, rather than a uniform box distribution.
- Replace the single overwritten reaction wave with either a tiny bounded wave pool
  or, preferably, the reaction director's single resolved wave.

### 4.4 Stardust

- Shape the idle field into two or three broad coherent currents separated by quiet
  lanes. Random sparkle is texture; flow is composition.
- Give particles a screen-space minimum and maximum size so the field survives DPR
  without becoming expensive fog.
- Precompute the immutable color/seed payload. Update only position, velocity, and
  event energy that actually change.
- Build idle and reactive compute variants once. Idle must not evaluate eight inactive
  impulse falloffs.
- Measure a cheaper analytic curl field or sampled flow texture against the six-noise
  curl before adopting it. Particle-count cuts come after per-particle waste removal.

### 4.5 Constellations and meteors

- At rest, allow zero or one faint unfinished trace. Disable the current ambient-sign
  accumulation by default.
- A persistent constellation is earned by an apex event, holds long enough to read,
  then dissolves into the same dust current. One persistent sign at a time is the
  default; two is the hard maximum only if side-by-side captures remain clean.
- Build constellation line width in view space so camera/pointer parallax cannot skew
  it. Dirty-upload only active nodes and edges.
- Meteors must have a meaningful radiant and trajectory. Implement `spread` or remove
  the option; a lock/combo cue must look spatially caused by the board event.
- Reserve the hero fireball for Tetris/perfect clear/high-combo milestones. Ordinary
  locks receive no meteor.

### 4.6 Camera and post

- Normalize camera easing, FOV impulse, and shake decay to delta time. Clamp event
  movement more tightly than idle drift.
- Reduced motion removes camera shake, FOV punch, pointer parallax, star displacement,
  and gravitational lensing while preserving a static luminance cue.
- Build static post graphs for `off`, `basic`, and `selective` instead of executing
  invisible nodes with zero uniforms.
- The basic graph has tone/color, vignette, and optional one-sample grain/dither. It
  has no chromatic side taps or board-halo SDF.
- The selective graph adds measured, downsampled bloom. Chromatic aberration is a rare
  resolved-cue modifier, not an always-paid graph feature.
- Replace the two sine hashes with one validated cheap noise source. Never use CPU
  dispatch duration as a proxy for GPU post cost.
- Derive a board mask from the live board rectangle for bloom/dust/sky attenuation.

### 4.7 Tetromino and lock-piece language

The piece should feel made from the same stellar material as the sky, while remaining
clearer and more solid than background effects:

- Resting blocks: dark crystalline body, hot compact stellar core, cool rim, and one
  restrained temperature accent per piece. Reduce simultaneous pulse, shimmer, glow,
  and trail frequencies so the silhouette reads first.
- Ghost piece: faint outline and sparse dust only; no competing core.
- Lock anticipation (0–80 ms): cells inhale surrounding motes and cool slightly at
  the rim.
- Stellar seal (80–220 ms): the locked cells ignite from their actual cell centers,
  compress to a crisp hot core, and emit one thin connected outline/ripple.
- Release (220–500 ms): one shallow wave transfers energy into the sky. A line clear
  redirects that energy along the cleared rows instead of adding a second full lock
  spectacle.

This must use the board renderer's existing piece/material contract or an approved
shared hook. Do not build a second gameplay renderer inside the theme.

## 5. Gameplay reaction director

Add a Starlight-local **reaction director**, not a new global event bus. It receives
canonical events, groups events belonging to one lock resolution, and emits one cue:

```text
canonical events
    -> resolution window / action identity
    -> dominant cue + bounded modifiers
    -> one theme-time timeline
    -> sky, dust, meteor, constellation, camera, and post adapters
```

The director may begin with a short same-turn coalescing window while canonical action
identity is unavailable. Its final contract should consume the resolved per-wave/action
payload planned by the umbrella gameplay-event work; theme-local re-emission is
forbidden. Pending cue, origin, resonance, milestone, and last-signature state is keyed
by `player`; a single global last origin is not multiplayer-safe. Under today's event
contract, `COMBO` sets the pending cascade resonance and the immediately following
`LINE_CLEAR` consumes it. It does not launch geometry on its own.

### Cue grammar

| Resolved action | Dominant cue | Allowed modifiers |
|---|---|---|
| Lock, no clear | Cell-centered stellar seal + one shallow wave | Tiny dust inhale |
| Single/double/triple | Row-aligned horizon sweep; length/brightness scales with rows | 0/1/2 small meteors; no constellation |
| Tetris | Four linked row sweeps resolving bottom-to-top, then one hero meteor | One camera/FOV breath; combo color tint |
| T-spin | Compact rotating vortex around the piece centroid | Thin counter-rotating ring; no large chromatic split |
| B2B | The qualifying Tetris/T-spin remains dominant | One timeline-owned echo 160–220 ms later |
| Resonance/combo 1–3 | Warmer seal and slightly longer dust gather | None |
| Resonance/combo 4–6 | One clean expanding ring and visible sky current | One small sign seed, not persistent |
| Resonance/combo 7–9 | Brief nova inhale/release and hero meteor | One readable constellation trace |
| Resonance/combo 10+ | Earned constellation birth; optional approved micro-lensing apex | Strongest bloom within flash limit; cooldown/hysteresis |
| Perfect clear | Quiet half-beat, then full-field constellation reveal | No stacked T-spin/B2B spectacle beyond color/shape modifiers |

Implementation rules:

- Dominance order: perfect clear > combo apex > Tetris/T-spin > ordinary line clear >
  lock.
- T-spin, B2B, combo, cascade depth, and clear count are modifiers on the dominant
  cue, not independent shows.
- B2B schedules a copied half-strength replay of the special just recorded when the
  B2B event arrives; it does not arm a timer hoping to recognize a future event.
- Store all delayed positions by value. Replace `setTimeout` with update-driven theme
  time so pause, visibility, and disposal are deterministic.
- Give each expensive subsystem a per-cue budget: active impulses, rings, meteors,
  signs, camera displacement, post intensity, and duration. Pool exhaustion must
  degrade predictably rather than recycle visible objects arbitrarily.
- `HARD_DROP`, `LEVEL_UP`, and game-over reactions remain out of scope until a
  canonical payload exists. The theme must not infer gameplay truth from DOM events.

## 6. Performance and measurement plan

### 6.1 Phase-0 harness contract

Before optimizing, make the playground capable of proving a result:

- Pass `(time, dt)` consistently; add deterministic `reset(seed)` and `seek(time)` for
  stateful Starlight effects.
- Resolve render/compute timestamps on a bounded cadence/ring. Never accumulate a
  query per frame indefinitely.
- Separate **capture mode** from **performance mode**. Capture mode is fixed-time and
  deterministic; performance mode runs an update/render loop and exports metrics.
- Pin quality tier, effect scale, DPR, dynamic-resolution state, viewport, backend,
  and seed in every artifact.
- Add isolated effects for `starlight-shockwave`, `starlight-post`, and
  `starlight-lock-combo`; existing shared-module effects remain the test bed for sky,
  dust, meteor, and constellation work.
- Run one WebGPU effect per browser session on the constrained iGPU. A screenshot run
  and a timestamp run are separate sessions. Device loss or black capture aborts the
  session and is recorded; it is not retried in a full-journey loop.

### 6.2 Test matrix

Use the umbrella 20-second scripted loop shape and emit at least
`{p50,p95,p99,gpuRender,gpuCompute,drawCalls,triangles,textures,geometries}`.

| Axis | Required values |
|---|---|
| Backend | WebGPU; WebGL2 through `forceWebGL` |
| Viewport | 1920×1080; 2560×1440 where hardware permits |
| DPR | 1.0; 1.25; 1.5. Test 2.0 only as an explicit stress case, not an unconditional target. |
| Tier | Low; High; Extreme, with tier and effect scale pinned |
| Scenario | 20 s idle; 60 ordinary locks; repeated Tetris; combo-10 apex; pause/hidden resume; resize |
| Accessibility | default; reduced motion/effects |
| Lifecycle | 60 activate/deactivate cycles; renderer/device-loss recovery path |

Perform one half-resolution A/B early. A large GPU improvement identifies a fill/ALU
bottleneck; little improvement shifts attention to compute, CPU uploads, or queue
behavior.

### 6.3 Budgets

These inherit the umbrella source of truth rather than creating a competing budget:

| Lane | Total frame p95 | CPU p95 | GPU p95 | Role |
|---|---:|---:|---:|---|
| 60 Hz floor | ≤16.6 ms | ≤6.0 ms | ≤9.0 ms | Required on the named baseline hardware/tier |
| 120 Hz | ≤8.3 ms | Scale proportionally | Scale proportionally | Performance-tier target at pinned 1080p/DPR |
| 144 Hz | ≤6.9 ms | Scale proportionally | Scale proportionally | Stretch target; never claimed without named hardware |

Also require:

- p99 is reported and investigated; a good average cannot hide lock/combo spikes.
- No WebGPU validation errors, uncaptured errors, black frames, timestamp-query
  exhaustion, or device loss in the release run.
- The incremental GPU cost of the most expensive approved cue is baselined and fits
  inside the target lane without exceeding its p95 frame budget.
- Idle dynamic uploads/draws for empty meteor, shockwave, and constellation pools are
  zero or explicitly justified.
- Hidden/paused render work follows the shared theme contract, and state resumes
  without a time jump.

Hosted CI gates correctness only. Real timing gates run on a named self-hosted GPU;
same-device before/after deltas are evidence, cross-device timestamps are not.

### 6.4 Optimization order

1. **Correctness and invisible work:** defined smoothsteps; fix `0 || fallback`
   configuration mistakes; remove dead post nodes/taps; normalize delta-time decay;
   clone delayed state; seed randomness.
2. **Idle work:** hide empty meshes; dirty-gate attributes; avoid inactive impulse
   math; update slow ambient systems at justified cadence.
3. **Fill rate:** downsample bloom; replace/merge full-screen procedural sky and
   aurora; reduce additive quad overdraw; use measured DPR caps by tier.
4. **Compute/storage:** idle/reactive compute variants, cheaper measured flow field,
   immutable color data, consumed buffers only, stable dispatch cadence if visual
   A/B supports it.
5. **Shader hot paths:** move invariant color/twinkle work out of fragments, replace
   `pow(x, 2)` with multiplication, use one cheap noise source, and remove unused
   double-sided rendering after screenshot comparison.
6. **Adaptive safety net:** only after fixed-quality baselines, allow tier-aware DPR/
   effect scaling to react to measured frame pressure. It must not mask regressions in
   benchmark mode.
7. **Lifecycle:** warm pipelines deliberately; dispose post targets, compute/storage
   buffers, geometries, timers, and listeners; validate device-loss recovery and VRAM
   proxy gauges.

## 7. Delivery phases and exit gates

### Phase 0 — Truth before beauty

**Work:** repair deterministic playground time/seed/seek, bounded timestamp resolution,
Starlight diagnostics, and the missing isolated effects. Record baseline artifacts for
rest, lock, Tetris, and combo-10 on WebGPU and forceWebGL.

**Exit:** fixed inputs reproduce the same frame; console is clean without timestamp
overflow; performance JSON includes pinned environment metadata; no full-theme art
change has started.

### Phase 1 — Correctness and free headroom

**Work:** convert reversed smoothsteps one effect at a time; remove invisible post
work; fix Low-tier chroma fallback; delta-normalize camera/FX; dirty-gate idle pools;
remove unused instancing storage; fix meteor spread and delayed-state ownership.

**Exit:** each touched effect has a before/after screenshot and clean console; the
look is intentionally matched or improved; idle p95 and resource counts do not
regress; WebGPU and forceWebGL compile.

### Phase 2 — Resting-sky composition

**Work:** prototype the Gaia-inspired galaxy, dust lanes, hero-star hierarchy, board
pocket, deterministic catalog, and aurora decision in the starfield playground only.

**Exit:** the chosen screenshot reads as Starlight without UI, the board pocket stays
quiet with UI overlaid, High/Low variants feel like the same artwork, and the chosen
sky is materially cheaper or delivers an explicitly accepted GPU cost.

### Phase 3 — Lock piece and reaction grammar

**Work:** build the cell-centered stellar seal and `StarlightReactionDirector` in
`starlight-lock-combo.effect.js`. Author ordinary lock, line counts, Tetris, T-spin,
B2B, combo tiers, and perfect-clear dominance on one theme-time timeline.

**Exit:** a scripted resolution emits one dominant cue; no pool thrash or independent
effect storm; every cue originates from actual cells/rows; 60/120/144 Hz captures have
matching duration; reduced motion remains expressive and safe.

### Phase 4 — Stardust, meteor, and constellation memory

**Work:** compose dust currents/negative space; split idle/reactive compute; establish
causal meteor radiants; replace ambient constellation clutter with one earned sign.

**Exit:** idle compute/render timings improve or remain inside budget with a clearly
approved visual gain; no empty-pool uploads; one apex sign is readable at gameplay
scale; fixed seed/time is reproducible.

### Phase 5 — Post, accessibility, and tier parity

**Work:** static post graph variants, bloom scale, single noise/dither solution,
board mask, restrained chroma, reduced-effects behavior, and optional micro-lensing
decision spike.

**Exit:** post cost is measured by GPU timestamps; Low pays for no invisible premium
nodes; flash guidance and reduced motion pass; optional lensing is either approved by
a screenshot/perf gate or deleted cleanly.

### Phase 6 — Integration and release proof

**Work:** port only proven playground effects into `createScene()`/materials; run the
full matrix, lifecycle/device-loss checks, and 20-second scripted perf loop; capture
release artifacts for both backends.

**Exit:** all masterpiece criteria below pass. A clean build alone is not completion.

## 8. Prioritized backlog

| Priority | Change | Primary files | Visual value | Performance value | Risk |
|---|---|---|---|---|---|
| P0 | Deterministic dt/seed/seek and bounded timestamps | `src/playground/main.js`, Starlight playground effects | Enables honest iteration | Enables honest profiling | Medium; harness is shared |
| P0 | Replace reversed smoothsteps, effect by effect | Starlight renderers, sky, post | Stable masks/fades | Driver correctness | Medium; screenshot-sensitive |
| P0 | Static post variants; remove zero-strength CA/halo work | `post/render-pipeline.js` | Cleaner, more intentional post | High fill-rate win | Medium |
| P0 | Reaction director and one-action cue dominance | `sim/starlight-emitters.js`, new local director | Very high | Prevents event spikes | Medium; event ordering |
| P0 | Delta-time/theme-time choreography | camera, theme FX state, director | Consistent feel | Stable tails/pause behavior | Low–medium |
| P1 | Gaia-inspired authored sky and board pocket | `nebula-sky.js`, `aurora-band.js`, `deep-starfield.js` | Very high | Potentially very high | Medium; art direction |
| P1 | Cell-accurate stellar-seal lock | tetrominos + board-compatible hook + playground | Very high | Bounded if local | Medium; renderer contract |
| P1 | Idle/reactive dust compute and storage trim | stardust sim/renderer | High | High | Medium–high; compute validation |
| P1 | Idle mesh/upload gating | meteor/shockwave/constellation systems/renderers | Neutral | Medium | Low |
| P1 | One-earned-sign constellation grammar | constellation sim/renderer | High | Medium | Low–medium |
| P1 | Causal meteor radiant and `spread` | meteor sim/renderer | Medium–high | Neutral | Low |
| P2 | Optional gravitational-wish apex spike | isolated playground/post | Potentially high | Must be bounded | High; identity/fill/accessibility |
| P2 | Tier-aware adaptive DPR/effect scaling | shared quality/perf integration | Preserves intent under load | High resilience | High; must not mask baselines |

## 9. Masterpiece acceptance criteria

The theme is ready only when all of the following are true:

### Visual

- A rest screenshot has clear near/mid/far depth, intentional negative space, a
  recognizable galactic flow, and readable star-temperature hierarchy.
- The playfield is the highest-priority object at all tiers and common aspect ratios.
- An ordinary lock is precise, satisfying, and local. Tetris, T-spin, B2B, combo tiers,
  and perfect clear are distinct without becoming unrelated visual languages.
- One resolution never produces an accidental stack of independent spectacles.
- The apex is rare enough to feel earned and leaves one readable visual memory.
- Low, High, and Extreme look like one art direction, not progressively unrelated
  feature piles.

### Performance and correctness

- The named device/tier/resolution matrix meets the inherited p95 frame-time budget;
  p99 and GPU render/compute timing are recorded.
- No empty effect pool draws/uploads, unbounded timestamp queries, per-frame shader
  graph construction, or benchmark-time adaptive masking remains.
- WebGPU and forceWebGL screenshots are clean; console has no WGSL, validation,
  uncaptured, allocation, or resource-leak errors.
- Resize, DPR changes, hidden/resume, 60 activation/deactivation cycles, and
  device-loss recovery meet shared renderer contracts.

### Feel and accessibility

- Cue duration and damping match at 60, 120, and 144 Hz.
- Reduced motion/effects preserves gameplay confirmation without camera shake,
  lensing, rapid flash, or large chromatic displacement.
- No cue obscures active cells, ghost position, incoming garbage, or UI status.

## 10. Recommended first implementation slice

Keep the first session intentionally small:

1. Repair deterministic `dt`/seed/seek and timestamp resolution without disturbing
   unrelated playground work.
2. Add `starlight-lock-combo.effect.js` with a static board mock and scripted action
   sequence.
3. Correct only the lock shockwave/stellar-seal smoothsteps and author the ordinary
   lock cue.
4. Capture fixed-time WebGPU and forceWebGL screenshots, read the console, and record
   a short bounded timestamp run in separate browser sessions.
5. Port nothing into the production theme until that isolated cue passes.

This slice establishes the visual grammar and the proof loop while carrying far less
TDR and integration risk than changing the whole sky, compute field, and reaction
stack at once.

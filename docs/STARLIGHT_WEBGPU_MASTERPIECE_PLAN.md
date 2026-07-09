# Starlight — WebGPU/TSL Masterpiece Plan

**Theme id:** `starlight` · **Group:** `cosmic` · **Tech:** Three.js r181 WebGPU/TSL (WebGL2 fallback) · **Profile:** `heavy-gpu`
**Author target:** rebuild `src/themes/starlight/` mirroring `src/themes/electric-dreams-v3/`.
**Status:** Phase 0+1 implemented and playground-validated for the deep starfield + nebula base. Later compute/post/magic layers remain plan-only and must stay playground-screenshot-gated.

**Decisions locked (2026-06-15):** aurora = thin restrained whisper, High+ only, droppable · constellation = ONE signature figure always on GAME_OVER (combos roll varied) · idle ambient meteors = YES, rare hash-gated drift · tetromino palette = refresh to star-temperature · diffraction spikes = hero-only (~1.5–2%) · audio reactivity = deferred past v1.

**Key build learning:** node-material colors are **LINEAR** (sRGB-encoded only at output) — a `0.3` linear cap displayed as ~0.58 sRGB (far too bright). The backdrop now caps ambient at ~0.085 linear; the dark near-black sky + dense crisp canopy is achieved via additive star brightness over the capped sky. **Watch:** confirm 60fps on the real target GPU (additive sprite fill-rate is the limiter — shrink sprite px before cutting count). Per-tier star counts tuned conservative for the iGPU (Minimal 4k → Extreme 32k).

---

## 0. The decision, in one line

**Chosen direction: "STARLIGHT — Constellation Dreamscape" (Concept B's soul) running on Concept C's living curl-noise engine, sitting on Concept A's instanced-sprite deep-field base, with A's rare-spectacle punctuation grafted in.**

This is the hybrid every judge converged on independently:

- **Wonder & Magic lens — Winner: B (9.0)**, explicit recommendation: *"B's emotional architecture grafted with C's living-motion engine … borrows A's fireball terminal-flash + 20s game-over comet."*
- **Technical Feasibility lens — Winner: C (9.0)**, recommendation: *"build A's instanced-sprite deep-starfield as the always-on, fallback-safe BASE layer, then layer C's forked-compute curl-noise dust river + shape-formations constellation/combo morphs + impulse-driven reactions on top as the capability-gated hero."*
- **Performance & Differentiation lens — Winner: A (8.0)**, hard requirement: *"the HERO layer (instanced deep starfield) must NOT be a per-frame compute dispatch … compute should be the separable, capability-gated add-on (the dust), never the subject."*

The three winners are not in conflict — they describe the same machine from three angles:

> **A's instanced-sprite starfield is the always-on, fallback-safe SUBJECT. C's forked-compute curl-noise stardust + shape-formations constellation morph + impulse reactions is the capability-gated living HERO LAYER. B's storybook emotional beats (self-drawing game-over constellation, event-bound wishing stars, warm-gold-on-cool-calm) are the SOUL. A's fireball terminal-flash + 20s farewell comet are the rare APEX punctuation.**

The name **"Starlight — Constellation Dreamscape"** keeps the registry id `starlight` and the calm "wish/dream/wonder" register, but its load-bearing differentiator is the **event-triggered self-drawing constellation** (never static, distinct from `astral-weave`) and the **living curl-noise current** (distinct from the inert old CSS starfield and from every hero-object cosmic theme).

---

## 1. Vision & Mood

A still, breathing twilight canopy you could wish upon. You are at a 3 a.m. dark-sky observatory: the universe is quietly enormous, and the **sky itself is the subject** — no planet, no black hole, no exploding star. Thousands of color-temperature-true stars recede through parallax depth into true black and twinkle in incoherent, organic waves under a slow global "sky breath." Between them, faint fairy-dust motes drift on a coherent, divergence-free curl-noise current — never random shimmer, a living river of light caught in a cosmic moonbeam. A faint Milky Way band glows diagonally; a thin, restrained aurora whispers near the top. The board floats in a clean dark pocket so gameplay always reads first.

The magic is **earned, not constant**. Shooting stars are strictly event-bound and rare — each one feels like a genuine wish, not wallpaper. On big moments, unseen constellations draw themselves: dots pop, then luminous silver-cyan lines stitch a figure together (Sky/Spiritfarer), warm-gold against the cool field, before dissolving back into stardust. On game over the dust **coalesces into a reserved constellation**, holds, and a slow comet drifts past as it dissolves — a reverent two-part farewell that turns a failure state into a gift.

Emotional register: **Alto's dusk + Sky's luminism + Gris's restraint.** Wonder over spectacle. Cool = calm, warm = magic. Every element whispers rather than shouts.

### Palette (hex)

| Role | Hex | Notes |
|---|---|---|
| Void base | `#05060F` | true black-ish backdrop |
| Deep night (continuity w/ old Starlight) | `#0C0A1A` | |
| Zenith indigo | `#0B0E24` | sky-sphere top |
| Violet glow | `#3D2E6B` | nebula mid |
| Rose horizon (restrained) | `#5A3A5E` | desaturated from B's `#7A4A6E` to protect board |
| Milky Way warm core (low-lum) | `#C9B68C` | luminance-capped |
| OIII teal accent | `#2FD4C8` | nebula/aurora accent |
| Hα magenta (sparse, desaturated) | `#C84A9E` | low-density only |
| Star — hot blue-white | `#CFE0FF` | high temperature |
| Star — white | `#FFF6E8` | |
| Star — warm gold | `#FFD9A8` | |
| Star — cool red (rare) | `#FFB48A` | low temperature |
| Aurora — soft cyan | `#6FE3D2` | |
| Aurora — lavender | `#9D8CE0` | |
| Constellation line | `#9FE8FF` | silver-cyan |
| Constellation / hero-star dot | `#FFCE7A` | warm gold = "this is special" |
| Fairy dust warm-cream | `#FFE9C2` | |
| Fairy dust cool | `#BFD8FF` | |
| Meteor heat ramp | `#EAF4FF` → `#FFE9B0` → `#FF8A4A` → `#9A1F1F` → transparent | head→tail |
| Comet ion tail | `#86B7FF` | |
| Wishing star core | `#FFF3D6` | white-gold |

Deliberately avoids: galaxy pink-magenta core, void-ember/supernova/solar-eclipse magma, chiral-gold gold, blood-moon crimson, cosmic-noir grayscale.

---

## 2. Chosen Direction & Why (citing the judges)

### Why a hybrid and not a single concept

| Concept | Wonder | Feasibility | Perf/Diff | Fatal flaw if shipped alone |
|---|---|---|---|---|
| **A** Deep-Field Voyager | 6.5 | 8 | 8 | "Awe of accuracy, not enchantment"; rarity means magic is mostly ABSENT in a 3-min session; muted warm/cool contrast → "will not make a casual player whisper 'whoa'." Reads STATIC at idle. |
| **B** Constellation Dreamscape | **9** | 6 | 5 | Highest surface area; rebuilds a bespoke SDF line engine ignoring the proven `shape-formations` morph; aurora is the prime board-washing offender; strips ALL magic at Minimal. |
| **C** Stellar Particle Symphony | 7.5 | **9** | 6 | Makes COMPUTE the load-bearing hero → "whole subject vanishes if compute is unavailable"; 220k count is 2.4× edv3's proven 90k ceiling; "screensaver-ish at idle"; "edv3-in-blue" overlap risk. |

The hybrid takes each concept's **strength** and uses the other two to patch its **fatal flaw**:

- **B gives the soul** (the Wonder winner; the only concept that treats MAGIC as the goal). Its self-drawing game-over constellation is "the single most emotionally resonant beat across all three." We keep it.
- **C's curl-noise current is the idle-motion fix** for B's "feels static" risk and A's "reads STATIC at idle" risk: *"a slow living river reads dreamlike where random twinkle alone reads inert."* It is also the truest delivery on the user's stated electric-dreams-v3 particle love.
- **A's instanced-sprite starfield is the architectural backbone** the Perf judge demanded: the hero (the canopy) is NOT a compute dispatch, so it degrades cleanly Minimal→Extreme and survives weak/non-WebGPU GPUs. This kills C's "whole subject vanishes" flaw AND B's "strips all magic at Minimal" flaw at once.
- **A's fireball + 20s farewell comet** are the rare apex punctuation "B's reaction set slightly lacks."

### Grafted ideas the judges flagged (all integrated below)

1. **B — self-drawing constellation on GAME_OVER** (signature; MUST be in). → §7, §8.
2. **B — strictly event-bound wishing stars** (never timer; hash-gated, long quiet gaps). → §6, §8.
3. **C — coherent curl-noise stardust current as baseline idle motion** (divergence-free `mx_noise_vec3` finite-difference, octaves 1→4 by tier). → §5.
4. **All — slow global "sky breath" twinkle envelope** (hashed per-star phase/freq under a slow global inhale/exhale; keep at EVERY tier). → §3 starfield, §5.
5. **A — fireball/bolide terminal flash** (one-frame additive screen flash + bloom spike, white→warm ~0.2s) on Tetris/big combo. → §6, §8, §9.
6. **A — game-over comet** (drifts across 15–20s) paired WITH B's constellation coalesce → two-part reverent sign-off. → §6, §7, §8.
7. **B+C — warm-gold-against-cool-calm** contrast lever. → palette, §3.
8. **B — staggered, arc-length-masked LINE GROWTH** for constellation segments (dots pop ~150ms cascade, then lines grow via per-segment `progress` 0→1, lerped). → §7.
9. **A — diffraction-spike glints on only the brightest ~1.5–2%** as an emotional sparkle device. → §3, §9.
10. **A — wonder-budget tiering rule**: never strip ALL magic at low tiers; keep wishing star + sky-breath twinkle + a few hero glints even at Minimal. → §11.
11. **Feasibility — route the constellation through `shape-formations.js` + target-buffer morph**, NOT a from-scratch SDF line engine. (The Wonder judge wants B's *look*; the Feasibility judge wants C's *plumbing*. We get both: particles GATHER into the figure via the proven morph, then a thin SDF line-glow draws BETWEEN the settled star nodes. Hybrid resolves the conflict — see §7.)
12. **Perf — reduce star/particle density AND brightness in the central board column** (bias spawn away from the board footprint, not just vignette over it). → §5, §10.
13. **Perf — bake faint procedural dust-salt micro-stars into the sky-sphere shader** (zero geometry, helps low tiers). → §3 layer 1/2.
14. **Perf — cap Extreme at edv3's proven ~90k**, not A's 130k or C's 220k. → §11.
15. **Feasibility/Perf — hard ~1.3px on-screen size floor with faintness in `opacityNode`**, derivative-AA soft sprites, Karis-average bloom, soft-knee, SMAA/FXAA over TAA. Build & screenshot-prove this FIRST. → §3, §9.
16. **All — registry contract**: add `starlight` to `HEAVY_GPU_THEME_IDS`; idempotent `createScene`; `_computeAvailable`/`_computeFailedOnce` one-shot gating; remove dead DOM/CSS. → §13.

### Differentiation guardrail (surfaced by the Wonder judge)

`aurora` and `astral-weave` themes already exist (astral-weave draws constellation `LineSegments`; aurora draws curtains). To stay magical AND novel: the constellation MUST be the **event-triggered self-draw** (not static ambient lines), and the aurora is a **thin, restrained, luminance-capped whisper** clearly distinct from the dedicated aurora theme — and is the **first layer dropped** below High in favor of the curl-noise river as the signature.

---

## 3. Visual Layer Stack

Rendered back → front. Each layer lists: technique · TSL/three approach · edv3 pattern reused · per-tier budget. The **bloom contract is load-bearing**: sky/aurora are `emitsBloom=false` + luminance-capped (≤0.3 linear); stars/dust/constellation/meteors are `emitsBloom=true` with HDR emissive >1.0. Post uses `mrt({output, emissive})` so only the latter glow.

### Layer 1 — Backdrop nebula (sky-sphere color field)
- **Technique:** inverted `SphereGeometry(180, 24, 16)`, `BackSide`, `renderOrder:-1000`, `fog:false`, `frustumCulled:false`. 4-octave domain-warped FBM on `normalize(positionWorld)` painted with an Inigo-Quilez **cosine palette** indexed by the warp components (chosen along a harmony curve → never muddy): indigo void → violet glow → faint OIII teal, sparse desaturated Hα magenta. Vertical `elevation = worldDir.y` 3-stop gradient (zenith indigo → violet → rose horizon) anchors a calm dark band behind the board.
- **TSL:** `MeshBasicNodeMaterial.colorNode`; `warpedFbm3(worldDir*1.8 + vec3(0,0,uTime*0.01))` (inner warp offset time-driven only → breathes over ~60s, never churns). Cosine palette `a + b*cos(6.283*(c*t+d))` with modest `b` to stay subtle. Output **hard-capped ≤0.3 linear**, slightly desaturated/cooled. `emissiveNode = vec3(0)`, `userData.emitsBloom = false`.
- **edv3 reuse:** fork `rendering/nebula-volume.js` verbatim; swap the 5 color constants + add the cosine palette; reuse `warpedFbm3`/`fbm3` from `tsl-noise-lib.js` unchanged.
- **Budget:** ~0.2 ms, all tiers. Octaves 3 (Minimal/Low) → 4 (Medium+).

### Layer 2 — Procedural micro-star "dust salt" + Milky Way band (in the same sky shader)
- **Technique:** zero-geometry faint stars: `valueNoise2(starUv)` thresholded `smoothstep(0.985, 1.0, …)`, **density-biased toward a soft FBM galactic band** (dot of `worldDir` with a tilted ~25° plane normal, `smoothstep`-feathered). A second darker noise mask SUBTRACTS dust-lane filaments so the band reads as 3D occlusion. This is the Perf-judge graft: it fills perceived depth with ZERO extra draw calls/fill when instanced counts are cut on Minimal/Low.
- **TSL:** added to the Layer-1 `colorNode`; `valueNoise2` from `tsl-noise-lib.js`. Stays under the 0.3 luminance cap; NOT bloom-eligible.
- **edv3 reuse:** same nebula material; `valueNoise2` unchanged.
- **Budget:** negligible, all tiers. The Milky Way band orientation is steered to NOT cross the play column.

### Layer 3 — Deep starfield w/ parallax (THE SUBJECT — instanced sprites, no compute)
- **Technique:** 3–4 parallax depth shells of instanced `Sprite` quads via `instancedBufferAttribute` (NOT `THREE.Points` — WebGPU caps it at 1px; NOT the compute sim — this must survive no-compute fallback). Per-star attrs: position-on-shell, `temperature` (B−V→Ballesteros→Tanner-Helland RGB via 1D LUT), `magnitude`, `twinklePhase`, `twinkleFreq`, `flareRot`. Star DENSITY biased toward the Milky Way band (sample same FBM at CPU spawn) and **reduced in the central board column** (Perf graft). Far shells dimmed + desaturated (atmospheric perspective).
- **TSL:** `SpriteNodeMaterial` (camera billboard + `sizeAttenuation` built-in). `material.positionNode = instancedBufferAttribute(posAttr)`; `colorNode` = LUT(temperature) × twinkle term; `sizeNode = clamp(minPx(1.3) + k*log(flux), minPx, maxPx)` with a **HARD 1.3px floor** (kills sub-pixel shimmer); faintness lives in `opacityNode`, never sub-pixel size. Soft Gaussian/SDF radial sprite with derivative-AA edge (`clamp(0.5 + 0.7*d/fwidth(d),0,1)`), `AdditiveBlending`, `alphaToCoverage:true`. Twinkle: `base + amp·sin(time·twinkleFreq + twinklePhase)`, hashed per star, UNDER a slow global "sky breath" envelope (very-low-freq sine on the whole field). `emissiveNode = color·(>1.0)`, `emitsBloom=true`.
- **edv3 reuse:** none structurally (this is the net-new fallback-safe base the Perf judge mandates) — but reuse the bloom contract pattern (`emissiveNode` + `userData.emitsBloom=true`) verbatim from `fluid-particles-renderer.js`.
- **Budget (star count per tier, current validated cap):** Minimal 4k · Low 8k · Medium 12k · High 16k · Ultra 24k · Extreme 32k. Revisit upward only after clean playground captures on the target iGPU.

### Layer 4 — GPU stardust particles (the living curl-noise current — capability-gated)
- **Technique:** fork edv3's `FluidParticleSim` compute spine → `StardustSim`. Replace the 3-sine turbulence with **divergence-free curl noise** (finite-difference of `mx_noise_vec3`) so motes swirl in coherent eddies and never clump, under a slow global breeze + faint buoyancy. Per-particle `hash(index)` twinkle (`pow(sin,3)` sharp peaks) into size + HDR emissive. A ~2% "star-role" subset renders larger with a 4-point glint-cross mask. Reuses the target-buffer morph for constellation/combo assembly.
- **TSL:** see §5. Rendered via forked `fluid-particles-renderer.js`; swap `iridescentRamp` for a new `starlightRamp(t)` (cool blue-white → warm gold). `emitsBloom=true`.
- **edv3 reuse:** fork `sim/fluid-particles.js` (one structural edit at L372–381) + `rendering/fluid-particles-renderer.js` + `sim/shape-formations.js` (verbatim) + impulse system (verbatim).
- **Budget (dust count per tier):** Minimal 0 (dropped) · Low 6k · Medium 18k · High 40k · Ultra 65k · Extreme 90k. Curl octaves 1→4 by tier; substeps 1→3.

### Layer 5 — Shooting stars / meteors (compute-driven, event-bound)
- **Technique:** GPU instanced `instancedArray` compute particles; velocity-stretched billboard streaks (orient quad to view-space velocity, length ∝ speed), head→tail heat-ramp gradient. Spawned from a **radiant point** above the board so showers fan out. Rare tiers: faint → bright → fireball/bolide → (game-over) comet. Hash-gated Poisson with long quiet gaps; STRICTLY event-bound (never a timer). See §6.
- **TSL:** a small ring buffer of spawn requests consumed by free (expired) instance slots in the compute `Fn`; `positionNode` stretches the quad; `colorNode` = heat ramp by UV.y × glow halo × age-fade. `AdditiveBlending`, `depthWrite:false`, `emitsBloom=true`.
- **edv3 reuse:** the streak renderer does NOT exist in edv3 — net-new, validated as its own isolated playground effect first (one-effect-per-session). Reuses the compute-spine idioms (`storage`, `instanceIndex`, `.compute(count)`).
- **Budget (max simultaneous meteor instances):** Minimal 4 (faint only, no fireball) · Low 8 · Medium 16 · High 24 · Ultra 32 · Extreme 48.

### Layer 6 — Constellations / aurora magic layer
- **Constellations (signature):** particles gather into the figure's star NODES via the `shape-formations` target-buffer morph (per-particle staggered arrival ~1s), THEN a thin SDF line-glow draws BETWEEN the settled nodes with per-segment arc-length `progress` 0→1 (lerped, never snaps), dots pop first in a ~150ms cascade. Lines silver-cyan, nodes warm gold; emissive → bloom carries the magic. See §7.
- **Aurora (restrained whisper):** a second additive sky-band: 3-octave FBM scrolled vertically, **noise-difference curtain folds** (`smoothstep(-s, s, n1 - n2)`), `1 − y·k` vertical falloff (thin band near top), `mix` of soft cyan→lavender→pale-rose. Slow multi-second drift, low contrast, **luminance-capped, emitsBloom=false**. Distinct from the dedicated aurora theme by being a thin restrained band, NOT full curtains. First layer dropped below High.
- **TSL:** constellation lines = SDF distance-to-segment `smoothstep(width, 0, dist)` over a small uniform array of node positions; aurora = FBM (`valueNoise2`/`fbm3`) + height falloff.
- **edv3 reuse:** `shape-formations.js` + morph (verbatim) for the gather; aurora is a small new sky-band material (cheap, fork nebula structure).
- **Budget:** constellation ~0.3 ms when active (else free); aurora ~0.4 ms (large additive surface — High/Ultra/Extreme only).

### Layer 7 — Foreground motes (will-o'-wisp orbs)
- **Technique:** a handful (6–16) of larger, slower wisp orbs wandering on `sin/cos`+phase paths with a soft halo — intimacy / Outer-Wilds campfire scale cue. Cheap CPU-positioned sprites, additive.
- **TSL:** `SpriteNodeMaterial`, radial halo `colorNode`, `emitsBloom=true`.
- **edv3 reuse:** trivial; positions on CPU, no compute.
- **Budget:** Minimal 0 · Low 6 · Medium 8 · High 10 · Ultra 12 · Extreme 16.

### Layer 8 — Post
- MRT selective bloom (`mrt({output, emissive})`) → optional blue anamorphic streak on hero stars → ACES tonemap → cool-shadow/warm-highlight grade → gentle vignette darkening the board footprint → film grain (hides dark-gradient banding). Chromatic aberration near-zero (cleaner than edv3). Soft-knee threshold + Karis-average downsample (anti-firefly on tiny stars). See §9.
- **edv3 reuse:** fork `post/render-pipeline.js` (`V3PostPipeline` + `V3_POST_PROFILES`) → `StarlightPostPipeline`.
- **Budget:** per-tier profile, §11.

---

## 4. Architecture & File Structure

Mirror `electric-dreams-v3/`. The orchestrator is a thin conductor with zero visual math; all visual logic lives in subsystems. Files under `src/themes/starlight/`:

```
src/themes/starlight/
├── starlight-theme.js                 # orchestrator (rewrite of current DOM theme; extends BaseTheme)
├── starlight-tetrominos.js            # KEEP AS-IS (getTetrominoConfig); refresh palette to match (§13)
├── starlight-theme-icon.png           # KEEP (registry icon)
│
├── sim/
│   ├── stardust-particles.js          # fork of edv3 sim/fluid-particles.js → StardustSim
│   │                                  #   (curl-noise swap, twinkle, star-role, STARDUST_BUDGETS)
│   ├── shape-formations.js            # COPY VERBATIM from edv3 (+ add fillConstellation, fillSpiral)
│   ├── shape-formations.test.js       # COPY + extend tests for new generators
│   ├── meteor-system.js               # NET-NEW: instancedArray compute meteors + radiant + ring buffer
│   └── stardust-emitters.js           # fork of edv3 sim/fluid-emitters.js (event→impulse wiring)
│
├── rendering/
│   ├── nebula-sky.js                  # fork of edv3 rendering/nebula-volume.js (palette + Milky Way + salt)
│   ├── deep-starfield.js              # NET-NEW: instanced-Sprite parallax shells (the SUBJECT)
│   ├── stardust-renderer.js           # fork of edv3 rendering/fluid-particles-renderer.js (starlightRamp, glint-cross)
│   ├── meteor-renderer.js             # NET-NEW: velocity-stretched billboard streaks
│   ├── aurora-band.js                 # NET-NEW (small): thin folded-noise aurora band
│   ├── constellation-lines.js         # NET-NEW (small): SDF line-glow between settled star nodes
│   └── wisp-orbs.js                   # NET-NEW (small): will-o'-wisp foreground sprites
│
├── post/
│   └── render-pipeline.js             # fork of edv3 post/render-pipeline.js → StarlightPostPipeline + STARLIGHT_POST_PROFILES
│
├── composition/
│   └── camera-director.js             # COPY VERBATIM from edv3 (tune REST_POSITION + per-event magnitudes only)
│
└── materials/
    ├── tsl-noise-lib.js               # COPY VERBATIM from edv3 (+ add curlNoise3, starlightRamp, blackbodyLut helper)
    └── star-data.js                   # NET-NEW: CPU star catalog generator (temperature/magnitude distribution, Milky-Way bias, board-column avoidance)
```

**File responsibilities (one line each):**

- `starlight-theme.js` — owns Three core (`scene`/`camera`/`renderer`/`Clock`), WebGPU-init+fallback, idempotent `createScene`, the `safeAnimate` loop (frame order: decay fxState → camera → meteors → stardust compute → renderers → post), event wiring, board-zone projection, teardown. Copy edv3 orchestrator structure; change name string, shape pool, fog/camera constants, per-event numbers, debug namespace → `window.starlight`.
- `sim/stardust-particles.js` — the curl-noise compute sim (storage buffers, compute `Fn`, impulses, target morph, `STARDUST_BUDGETS`).
- `sim/shape-formations.js` — pure-CPU target generators (+ `fillConstellation`, `fillSpiral`); fills the target buffer.
- `sim/meteor-system.js` — meteor compute sim + radiant + spawn-request ring buffer + rarity roll.
- `sim/stardust-emitters.js` — translates game events into `pushImpulse` calls + meteor spawn requests + fxState bumps.
- `rendering/nebula-sky.js` — sky-sphere color field + Milky Way + dust-salt micro-stars (bloom-excluded).
- `rendering/deep-starfield.js` — the always-on instanced-sprite parallax canopy (the subject; no compute).
- `rendering/stardust-renderer.js` — billboards the stardust compute buffers (additive, glint-cross, `starlightRamp`).
- `rendering/meteor-renderer.js` — velocity-stretched streak billboards.
- `rendering/aurora-band.js` — thin folded-noise aurora.
- `rendering/constellation-lines.js` — SDF line-glow drawn between the settled gather nodes.
- `rendering/wisp-orbs.js` — foreground will-o'-wisp sprites.
- `post/render-pipeline.js` — MRT selective bloom + ACES + grade + vignette + grain + anamorphic; profile-driven static, `updateDynamic` for event boosts.
- `composition/camera-director.js` — Lissajous idle float + spring + pointer parallax + event impulses.
- `materials/tsl-noise-lib.js` — shared noise + curl + ramps + blackbody LUT helper.
- `materials/star-data.js` — CPU catalog generator (the only CPU-heavy spawn step; runs once).

---

## 5. GPU Compute Particle System design (`StardustSim`)

Fork of `sim/fluid-particles.js`. Keep the spine verbatim: `StorageBufferAttribute(data,4)` → `storage(buf,'vec4',count)` → `.element(instanceIndex)` → `Fn(...).compute(count)` → billboard `InstancedMesh`. Keep the impulse system (`MAX_IMPULSES=8`, RADIAL/VORTEX/ATTRACTOR, `pushImpulse`/`decayImpulses`), the target-buffer morph (`setShape`/`setShapeStrength`/`setShapeOverride`), the shape-mode dimmers, and the age/respawn machinery — all unchanged.

### Buffers (4 × vec4 × count, identical layout to edv3)
- `positions`: xyz + age (0..1)
- `velocities`: xyz + lifetime (seconds)
- `colors`: rgb + energy (0..1 → drives bloom)
- `targets`: xyz target + per-particle attraction weight w (set by `shape-formations`)

CPU-seeded in `_initParticleState()`: spawn on a wide flat-ish slab (sky canopy, not a focal ellipsoid), per-particle `hash(index)` twinkle phase/freq packed (reuse the unused bits of energy/age seeding or add a 5th `attrs` vec4 if needed), color from the `starlightRamp` endpoints (cool/warm mix), **density reduced in the central board column** (skip-or-dim seed positions whose projected x is near the board).

### Compute Fn forces (assembled per particle, replacing the edv3 fluid model)

1. **Curl-noise flow field (the core — replaces 3-sine turbulence at L372–381).** Add `curlNoise3` to `tsl-noise-lib.js`:
   ```js
   import { mx_noise_vec3 } from 'three/tsl';
   export const curlNoise3 = Fn(([p, t]) => {
     const eps = float(0.35);
     const s = (q) => mx_noise_vec3(q.mul(0.18).add(vec3(0, 0, t.mul(0.05))));
     const dx = s(p.add(vec3(eps,0,0))).sub(s(p.sub(vec3(eps,0,0))));
     const dy = s(p.add(vec3(0,eps,0))).sub(s(p.sub(vec3(0,eps,0))));
     const dz = s(p.add(vec3(0,0,eps))).sub(s(p.sub(vec3(0,0,eps))));
     return vec3(dy.z.sub(dz.y), dz.x.sub(dx.z), dx.y.sub(dy.x)).div(eps.mul(2));
   });
   ```
   In the kernel: `vXYZ.addAssign(curlNoise3(pXYZ, time).mul(uFlowStrength).mul(turbDimmer).mul(dt))`. Higher tiers swap the single `mx_noise_vec3` tap for `mx_fractal_noise_vec3(q, octaves)` (octaves 1→4 by tier). Curl substeps 1→3 by tier.
2. **Slow global breeze + faint buoyancy** under the curl so the whole cloud has lazy coherent motion: `vXYZ.addAssign(vec3(uBreezeX, uBuoyancy, 0).mul(dt))`.
3. **Twinkle** (read by renderer, computed here for cheapness): per-particle `tw = pow(sin(time·twFreq + twPhase)·0.5+0.5, 3.0)` stored into a spare channel; drives renderer size + HDR emissive. Under a global `uSkyBreath` low-freq envelope.
4. **Formations (constellation/spiral morph).** Keep edv3 shape attraction (`toTarget · shapeStr · tgt.w · 11.0`) verbatim; per-particle staggered arrival via `smoothstep(hash(index)·spread, …, time − morphStart)` so the figure GATHERS over ~1s instead of snapping. Critically-damped spring optional refinement.
5. **Shooting-star burst impulses** map onto the EXISTING impulse system 1:1 (zero new plumbing): RADIAL ripple on line clear, VORTEX swirl on Tetris, ATTRACTOR ping on piece-lock. (The visible meteor streaks themselves are Layer 5 / `meteor-system.js`; the dust REACTION to them uses impulses here.)
6. Damping (`uDamping≈0.985`), speed cap (`uMaxSpeed≈8`), integrate, age/respawn, energy←speed — all unchanged from edv3.

### `STARDUST_BUDGETS` (per tier)
```
Minimal:  { count: 0,     octaves: 0, substeps: 0 }   // dust dropped; starfield + wishing star carry magic
Low:      { count: 6000,  octaves: 1, substeps: 1 }
Medium:   { count: 18000, octaves: 2, substeps: 1 }
High:     { count: 40000, octaves: 3, substeps: 2 }
Ultra:    { count: 65000, octaves: 3, substeps: 2 }
Extreme:  { count: 90000, octaves: 4, substeps: 3 }   // capped at edv3's proven 90k ceiling
```
Per-frame `update(delta, time, {...})` caps `uDelta` at 0.033, calls `decayImpulses(delta)`, decays `morphStrength`. Compute dispatch is capability-gated (`_computeAvailable`) and one-shot try/catch (`_computeFailedOnce`) exactly like edv3 — on failure the theme degrades to starfield + sky only (still valid, per the no-compute fallback design).

---

## 6. Shooting Stars / Meteors design (`meteor-system.js` + `meteor-renderer.js`)

**Architecture (net-new, validated in isolation first):** `instancedArray(COUNT, 'vec4')` for position+age and a second for velocity+seed; a per-frame compute `Fn` advances `pos += vel·dt`, increments age, and on expiry consumes the next spawn request from a small CPU-side **ring buffer** `{pos, tier, dirSeed, velocity}`. This decouples gameplay (CPU events) from sim/render (GPU) and reuses the compute-spine idioms.

### Spawn cadence — STRICTLY event-bound (the B graft)
- **Never a timer.** Hash-gated Poisson with long quiet gaps drives only a *very* rare ambient drift at idle (one faint streak every tens of seconds). Everything else is pushed by game events (§8).
- **Rarity roll per spawn:** faint streak (common) → bright streak (uncommon) → colored streak (rare) → fireball/bolide (very rare; Tetris/big combo only) → comet (ultra-rare; game-over only). Bias hard toward gaps so each event lands as "did you see that?!".

### Trail rendering
- **Head + streak:** velocity-stretched billboard (single quad). In the `positionNode`: orient local +Y to `normalize(velocity)` in view space (basis from camera-forward × velocity), scale that axis by `clamp(length(velocity)·kStretch, minLen, maxLen)`. Fragment uses `uv.y` as the tail parameter for the **heat gradient** (white-blue core → gold → deep red → transparent), × inverse-distance head glow `clamp(k/d,0,1)`, × age-fade. `AdditiveBlending`, `depthWrite:false`. Bloom carries the brightness.
- **Showers fan from a radiant** point above the board: each meteor's direction = `normalize(spawnPos − R)` + small jitter (the single most important "real shower" cue).

### Rare fireball / bolide
- Larger head, fatter/longer trail, more saturated heat ramp, a few child sparks mid-flight (optional). **Terminal flash:** at end-of-life, spike head emissive + a one-frame additive screen flash + momentary bloom-strength spike, white→warm decaying over ~0.2s (drives `fxState.bloomPunch`/a `flashPunch` scalar). This is A's "lit up the whole sky" apex moment (Tetris/big combo).

### Comet (game-over only)
- Slow drift across the backdrop over 15–20s; a glowing coma head (inverse-distance glow + bloom) + a straight tapering ion tail (blue `#86B7FF`); paired WITH the game-over constellation coalesce (§7) for a two-part reverent sign-off.

### Event tie-ins (summary; full map §8)
single LINE_CLEAR → 1 faint streak from cleared-row sky region · COMBO/multi-line → radiant shower (N∝lines) · HARD_DROP → 1 fast bright streak down the drop column · TETRIS/big combo → fireball + terminal flash · GAME_OVER → comet + constellation.

---

## 7. The Magic Layer

### Constellations that draw themselves (the signature, hybrid technique resolving the judges' conflict)
The Wonder judge wants B's connect-the-dots *look*; the Feasibility judge insists on routing it through the proven `shape-formations` morph, NOT a from-scratch SDF line engine. **We do both, in two phases:**

1. **Gather (proven plumbing):** call `setShape('constellation')` / `setShape('spiral')` on `StardustSim`. A new `fillConstellation(arr, n, opts)` generator in `shape-formations.js` writes target positions: a few bright "star NODES" (large `w`, high energy) at the figure's vertices, plus faint "connector" dust along the lines between them (low `w`). Per-particle **staggered arrival** (`hash(index)` morph-start offset) makes the figure assemble over ~1s — "summoned," not snapped.
2. **Draw the lines (thin new SDF layer):** `constellation-lines.js` holds the same node positions in a small uniform array and renders soft line-glow between settled nodes via `smoothstep(width, 0, distToSegment)`, masked by a **per-segment `progress` uniform 0→1** along arc-length (`step(uvAlongSeg, progress)` with a soft leading edge) so each line GROWS. Dots pop first in a ~150ms cascade (per-node scale+bloom ease), then lines draw with ~100–200ms stagger between segments. **All reveal uniforms lerped** (≈20% new / 80% old) so nothing snaps. Lines silver-cyan `#9FE8FF`, nodes warm gold `#FFCE7A`; emissive → bloom. Reverse the same uniforms to dissolve.

A **reserved figure** (e.g. a small star/lotus/heart-equivalent) is excluded from the random/combo pool and used only on GAME_OVER — the emotional anchor.

### Aurora ribbons (restrained whisper — §3 Layer 6)
Thin folded-noise band: 3-octave FBM scrolled vertically + noise-difference curtain folds `smoothstep(-s, s, n1−n2)` + `1−y·k` vertical falloff + cyan→lavender→rose `mix`. Slow multi-second drift, low contrast, **luminance-capped, emitsBloom=false**, steered off the play column. Deliberately a thin band (not full curtains) to stay distinct from the dedicated aurora theme. High/Ultra/Extreme only.

### Wishing star (B graft — strictly event-bound)
A single bright `meteor-system` streak (white-gold core `#FFF3D6`) with an elongated additive trail, optionally spawning a short-lived dust-particle sub-trail (impulse into `StardustSim`) so the tail dissolves into fairy dust. A soft "ping" of bloom at the arc apex (the "wish" instant). Triggered on milestones (single line clear, level-up), never on a timer — earned rarity is what makes it magical.

---

## 8. Game-event Reactivity Map

Architecture (verbatim from edv3, the Feasibility judge's explicit "keep exactly"): events bump **fxState scalars** (`comboPulse`, `bloomPunch`, `flashPunch`, `vignettePunch`, `twinkleAmp`, `skyBreath`…); the loop multiplies each by a fixed factor per frame (`comboPulse *= 0.95`, `flashPunch *= 0.80`…) and maps them to dynamic post boosts + sim uniforms via a **single reused `_dynPostParams` object**. NO per-event `setTimeout`. Subscribe via `eventBus.on(EVENTS.X, …)`; stash unsubs in `this.eventUnsubscribers`. Event ids confirmed in `src/events/event-bus.js`: `LINE_CLEAR='lineClear'`, `COMBO='combo'`, `PIECE_LOCK='pieceLock'`, `HARD_DROP='hardDrop'`, plus game over/start.

| Event | Stardust (impulse) | Meteor | Starfield/twinkle | Camera | Post |
|---|---|---|---|---|---|
| **GAME_START** | gentle inhale → calm drift; `snapToRest` camera | rare ambient only | full sky-breath twinkle on | slow Lissajous float | baseline |
| **PIECE_LOCK** | tiny ATTRACTOR ping at lock site | — | brief local twinkle bump near board | — | near-zero (never nags) |
| **LINE_CLEAR (1)** | RADIAL ripple near cleared row | 1 faint streak / wishing star from cleared-row sky region | global breath inhales + brief twinkle amp | — | small `bloomPunch` tick |
| **LINE_CLEAR (multi) / COMBO** | outward impulse; trail color teal→gold as chain climbs | radiant shower, N∝lines/combo, brighter tier with combo | twinkle freq climbs, decays on break | slight dolly | bloom + vignette rise then decay |
| **HARD_DROP** | downward curl gust along drop column | 1 fast bright streak down the column | one bright glint | micro `dolly`/`vertigo` settle (clamped) | additive luminance ping at impact |
| **TETRIS / big combo** | VORTEX swirl; big combo → constellation/spiral morph holds then dissolves | **FIREBALL/BOLIDE + terminal flash** | — | `fovPunch` (clamped) | one-frame screen flash + bloom-strength spike, white→warm ~0.2s |
| **GAME_OVER** | dust loses buoyancy, settles, desaturates → **coalesces into reserved constellation** (staggered self-draw), holds, dissolves | **slow comet** drifts across 15–20s as it dissolves | twinkle calms to low breath | gentle `pullBack` | global dim + cool-grade shift |

---

## 9. Post-processing Stack

Fork `V3PostPipeline` → `StarlightPostPipeline` (theme-agnostic; reuse the MRT-selective-bloom path, the cached `_dynPostParams` discipline, `setProfile`/`updateDynamic`/`setBoardHalo`). Pipeline order (light effects before tonemap; sensor effects after):

1. `scenePass = pass(scene, camera)` to HDR float; `scenePass.setMRT(mrt({ output, emissive }))` (try/catch → fallback `getTextureNode('output')` if MRT fails).
2. **Selective bloom** `bloom(scenePass.getTextureNode('emissive'), strength, radius, threshold)` — only stars/dust/constellation/meteors glow; sky/aurora stay calm. **Soft-knee threshold + Karis-average (luma-weighted) downsample** to kill 1px-star firefly pulsing.
3. **Anamorphic blue streak** (optional, High+) on hero stars only — `anamorphic(emissiveTex, threshold, scale, samples)`, `colorNode=vec3(0.4,0.7,1.0)`, `resolutionScale 0.5`. Gate to brightest ~1.5%.
4. **Diffraction-spike glints** are per-sprite (Layer 3/4), not a post pass — 4-point starburst on brightest ~1.5–2% only, as an emotional warm-hero device.
5. Composite (`scene + bloom + streak`).
6. **ACES tonemap** (Narkowicz fit, `renderer.toneMapping = ACESFilmicToneMapping` or inline) — smooth filmic rolloff on clipped star cores.
7. **Color grade** — cool shadows (teal/indigo), warm near-white star highlights; luma-preserving saturation + contrast around 0.5.
8. **Vignette** — gentle, **darkening the projected board footprint** so the play area sits on the calmest region (`setBoardHalo`).
9. **Chromatic aberration** — near-zero (cleaner than edv3; `chromaticStrength` ≈ 0–0.0015).
10. **Film grain** (last) + dither — hides dark-gradient banding in the nebula.
11. **AA:** rely on MSAA + `alphaToCoverage`; prefer SMAA/FXAA over TAA (TAA ghosts on tiny bright points).

`flashPunch` (fireball terminal flash) spikes `bloomStrength` + adds a white→warm additive screen tint for ~0.2s via `updateDynamic`.

`STARLIGHT_POST_PROFILES` per tier — fork edv3's numbers, raise bloom slightly for the twinkle look, drop chromatic. See §11 table.

---

## 10. Camera & Composition

Copy `composition/camera-director.js` verbatim (pure-CPU, no theme coupling). Tune only constants from the orchestrator:

- **REST_POSITION** for a wide calm canopy view (pull the camera back vs edv3's board-centric mass; e.g. `(0, 0.4, 14)`), `fov≈40`.
- **Idle:** slow Lissajous figure-8 float (periods ~18s/27s, modest amps) + pointer parallax so the sky floats in 3D (depth shells parallax against each other). `snapToRest()` on theme start to skip the spring-in.
- **Board-zone awareness:** `_updateBoardZone` projects `#game-canvas/#game-board` rect → UV + world-space at focal depth; pushes to post (`setBoardHalo` vignette) and informs the starfield/dust **central-column density reduction** (Perf graft — bias spawn away from the footprint at setup + resize, not just vignette over it). Re-run on resize only (cached scratch vectors).
- **Play vs idle:** event handlers nudge with clamped `dolly`/`vertigo`/`fovPunch`/`shake`/`pullBack` (motion-sickness clamped: `MAX_FOV_DELTA≈6°`, `MAX_OFFSET_LEN≈0.5u`).

---

## 11. Quality Tiers & Performance Budget

Driven by `window.settings.effectQuality`, normalized to High default. Pixel ratio ALWAYS via `this.getEffectivePixelRatio(maxRatio, 'theme')` (never raw `devicePixelRatio`), re-applied in `resize()`.

| Tier | Stars (sprites) | Stardust (compute) | Meteors (max) | Aurora | Wisps | Post features | px-ratio cap (`theme`) |
|---|---|---|---|---|---|---|---|
| **Minimal** | 4k | 0 (off) | 4 (faint, no fireball) | off | 0 | bloom off; ACES+vignette only | 0.9 |
| **Low** | 8k | 6k (oct1) | 8 | off | 6 | bloom (dual-Kawase), no MRT | 1.0 |
| **Medium** | 12k | 18k (oct2) | 16 | off | 8 | MRT bloom + grain + CA(low) | 1.15 |
| **High** | 16k | 40k (oct3) | 24 | on (thin) | 10 | + anamorphic + lensflare(hero) | 1.25 |
| **Ultra** | 24k | 65k (oct3) | 32 | on | 12 | + higher bloom mips | 1.35 |
| **Extreme** | 32k | 90k (oct4) | 48 | on | 16 | full stack | 1.5 |

`STARLIGHT_POST_PROFILES` (fork of `V3_POST_PROFILES`): Minimal `{enabled:false}`; Low bloom 0.34 / vignette 0.30 / chroma 0; Medium 0.46 / 0.44 / 0.0008; High 0.56 / 0.54 / 0.0010; Ultra 0.62 / 0.60 / 0.0012; Extreme 0.70 / 0.66 / 0.0015. (exposure 1.0→0.92, contrast 1.02→1.20, saturation 1.0→1.18 across tiers.)

**Wonder-budget rule (A graft, non-negotiable):** never strip ALL magic at low tiers. Even Minimal keeps the **wishing star + sky-breath twinkle + a few hero glints**. Only the expensive layers drop (aurora → dust → 2nd particle effects), in that order.

**Adaptive downscale:** on `EVENTS.PERFORMANCE_DOWNSCALE` BaseTheme auto-decrements global render scale by 0.25 (floor 0.5). `renderScale` rides between the cap and `MIN_RENDER_SCALE=0.5`. GPU-health auto-degrade drops the tier (`degraded` −1, `unsafe` −2) and clamps render scale. **Design to read correctly at a dropped tier + ~0.65 render scale** — lean on the lower caps and let grade/grain hide it (don't push pixels). **Fill-rate, not count, is the limiter** at downscaled ratios — shrink sprite px before cutting count.

**WebGPU fallback:** WebGPU init with WebGL2 fallback (mirror `stellar-drift` `initRenderer`): `new WebGPURenderer({antialias, powerPreference:'high-performance', alpha:false})`, `await Promise.race([renderer.init(), 4s])`, assert `renderer.backend?.isWebGPUBackend`. On failure → `THREE.WebGLRenderer`. **Compute is capability-gated** (`_computeAvailable = typeof renderer.compute === 'function'`) with one-shot try/catch teardown (`_computeFailedOnce`): if compute is unavailable, the theme runs **starfield + sky + a few wisps** (still valid and magical — the whole point of the instanced-sprite base). `setupRendererResilience` + `monitorWebGPU(onDeviceLost)` mandatory.

---

## 12. Differentiation vs existing cosmic themes

| Existing theme | Owns | Starlight stays clear by… |
|---|---|---|
| galaxy | spiral disk + pink-magenta core | no hero disk; no pink-magenta; cool indigo/teal |
| supernova / void-ember | exploding/glowing single star; magma | no hero star; no magma palette |
| black-hole | lensing + accretion disk + void | no lensing, no accretion, no hero void |
| blood-moon / lunara / solar-eclipse | moon(s)/sun bodies; crimson/warm-fire | no celestial body; no crimson |
| stellar-drift | planet + forward meteor flythrough | meteors are rare, lateral, wish-like; no planet |
| stellar-velocity | warp-streak tunnel rushing the camera | stars calm, distant, parallax-slow |
| astral-weave | woven ribbons + STATIC constellation LineSegments | NO ribbons; constellations are **event-triggered self-draw**, never static ambient |
| **aurora** (dedicated) | full flowing curtains | aurora is a **thin, restrained, luminance-capped band**, dropped below High |
| nebula-flow / aether-tides | fluid-paint swirl as the medium | nebula is a STATIC FBM surface; motion is discrete particles on a flow field |
| cosmic-noir | grayscale noir | full cool color, never grayscale |
| chiral-gold | gold-on-black choreography | gold reserved for sparkle accents only, on a cool field |
| electric-dreams-v3 | dense warm magenta/cyan board-centric fluid mass | calm cool deep-field canopy; stardust is a thin drifting river, not a focal mass |

**Owned niche:** the calm star CANOPY itself as the subject (no hero object — a niche none of the 18 claim), with the **event-triggered self-drawing constellation** + **living curl-noise river** + **earned-rarity wishing stars** as the unique signature. The astrophotography cues (B−V color-temperature stars, Milky Way band, diffraction spikes, true deep-field count distribution) are unclaimed register.

---

## 13. Integration & Migration

1. **Registry entry — keep id `starlight`** (`theme-registry.js` ~L156–162): keep `displayName:'Starlight'`, `group:'cosmic'`, `icon`. Module stays `./starlight/starlight-theme.js` (rewriting in place keeps switcher/prefs/`loadTheme('starlight')`/`#starlight-theme` stable).
2. **Add `'starlight'` to `HEAVY_GPU_THEME_IDS`** (`theme-registry.js` ~L431–477) — MANDATORY. Flips `resourceProfile→'heavy-gpu'` (manager injects it at `theme-manager.js:266`, enabling `releaseManagedGpuResources()` deep disposal on deactivate), `performanceClass→'heavy'`, `startupEligible→false`. Without this → GPU memory leak.
3. **Tetromino config — KEEP** `starlight-tetrominos.js` + `getTetrominoConfig()` (independent of the renderer). Optionally refresh `colors` to the new star-temperature palette (blue-white/gold/white) and `glowColor:'auto'` so pieces echo the sky.
4. **Remove dead DOM** in `index.html` (~L312–316): delete the four inner divs `#starlight-nebula`, `#starlights-back/mid/front`, `#starlight-shooting-stars`. **Keep `#starlight-theme`** wrapper (BaseTheme toggles `.active`; canvas mounts there).
5. **CSS cleanup** in `public/styles/main.css` (~L9625–9716): keep `#starlight-theme` but adapt to host a canvas (mirror `#singing-bowl-theme` `canvas{position:absolute;top:0;left:0;width:100%;height:100%}` at L9611–9622). **Delete** `#starlight-nebula`, `.starlight-layer`, `#starlights-back/mid/front`, `.starlight`, `@keyframes starlight-pulse-deep`, `#starlight-shooting-stars`, `.shooting-star-starlight`, `@keyframes shoot-starlight`.
6. **`createScene()` must be idempotent** (BaseTheme re-invokes on `EVENTS.CONTEXT_RESTORED`): dispose prior renderer/canvas/scene + remove stale canvas children before rebuilding. Mount canvas into `#starlight-theme`, give it id + absolute-fill cssText, `registerContainer(container)`. Use `safeAnimate` for the loop; `registerEventListener` for resize; override `resize()` (camera aspect + `getEffectivePixelRatio` + `setSize` + post `setSize`).

**What to keep:** registry id, `group:'cosmic'`, icon, `starlight-tetrominos.js`, the `#starlight-theme` wrapper, BaseTheme lifecycle/helpers, all edv3 reusable modules.

---

## 14. Playground-first Validation Plan

Per `CLAUDE.md`: author each effect as `src/playground/effects/<id>.effect.js` (auto-registers, HMR), screenshot via chrome-devtools MCP at `?effect=<id>&t=<sec>`, wait for `window.__PLAYGROUND_READY__`, read console for WebGPU validation errors, THEN port. **One small effect per session** (iGPU TDR history). TDR-safe order — cheapest/most-load-bearing first:

1. **`starlight-starfield.effect.js`** — instanced-Sprite parallax shells + temperature LUT + twinkle + **the 1.3px size floor + faintness-in-opacity + derivative-AA** (the linchpin anti-shimmer fix the Perf judge says to "build and screenshot-prove FIRST"). Checkpoint: crisp non-shimmering stars at `?t=2` and `?t=7`, realistic color mix, no console errors. Starter: copy `pulse-sphere.effect.js` (object material) structure.
2. **`starlight-nebula.effect.js`** — sky-sphere cosine-palette nebula + Milky Way band + dust-salt micro-stars; verify luminance cap (must read DARKER than a test bright block). Starter: `nebula-dome.effect.js`.
3. **`starlight-stardust.effect.js`** — forked compute sim with curl-noise drift + twinkle + glint-cross; verify coherent swirl (not clumping), no compute validation errors, fps headroom at High count.
4. **`starlight-meteor.effect.js`** — velocity-stretched streak + radiant fan + heat ramp + fireball terminal flash. Verify head-to-tail gradient and stretch ∝ speed.
5. **`starlight-constellation.effect.js`** — `shape-formations` gather into nodes + SDF line-glow staggered reveal (lerped, no snap). Verify dots-then-lines cascade.
6. **`starlight-aurora.effect.js`** — thin folded-noise band + luminance cap (must stay a whisper). Starter: `winter-aurora.effect.js` (but keep it 2D/thin, NOT raymarched).
7. **`starlight-post.effect.js`** — MRT selective bloom + Karis + soft-knee + ACES + grade on a scene with the proven starfield; verify only emissive glows, no firefly pulsing.

Only after each is a clean screenshot + zero console errors, port into the real `createScene()`/materials. The full assembled board is captured by the user in their desktop session (not headless) — batch all changes, then request ONE per-chapter-style capture.

---

## 15. Phased Implementation Roadmap

Each milestone is independently shippable/verifiable.

- **Phase 0 — Scaffold & contract.** Copy edv3 reusable modules into `src/themes/starlight/` (camera-director, tsl-noise-lib + curl/ramps, shape-formations + test, post pipeline fork, nebula fork). Add `starlight` to `HEAVY_GPU_THEME_IDS`. Rewrite `starlight-theme.js` as a thin orchestrator that just builds the sky-sphere + WebGPU-init+fallback + idempotent createScene + safeAnimate loop. Remove dead DOM/CSS. **Verify:** theme switches in, shows the nebula sky, disposes cleanly, no leak.
- **Phase 1 — The subject (starfield).** Build `deep-starfield.js` + `star-data.js` (the playground-proven effect). Wire parallax + sky-breath twinkle + board-column density reduction. **Verify:** crisp deep-field canopy, no shimmer, board reads first. This phase alone is already a shippable upgrade over the old CSS theme and is the no-compute fallback.
- **Phase 2 — Post.** Port `StarlightPostPipeline` + profiles; MRT selective bloom + ACES + grade + vignette + grain. **Verify:** stars glow, sky doesn't; board footprint vignette.
- **Phase 3 — Living current (stardust).** Port `StardustSim` (curl-noise) + `stardust-renderer.js` behind `_computeAvailable`/`_computeFailedOnce`. **Verify:** coherent drift at idle, graceful no-compute fallback to Phase 1.
- **Phase 4 — Events + meteors.** Port `stardust-emitters.js` (impulse map) + `meteor-system.js`/`meteor-renderer.js` (event-bound, radiant, fireball flash) + camera event hooks. **Verify:** each event response from §8; wishing star on line clear; fireball on Tetris.
- **Phase 5 — Magic layer.** Add `constellation-lines.js` + `fillConstellation` + the GAME_OVER coalesce + farewell comet; add thin `aurora-band.js` (High+) + `wisp-orbs.js`. **Verify:** self-drawing constellation on game over (the signature beat); aurora stays a whisper.
- **Phase 6 — Tiering & polish.** Wire all `*_BUDGETS`/profiles, adaptive downscale, GPU-health degrade; enforce the wonder-budget rule; tune per-event magnitudes; refresh tetromino palette. **Verify:** reads correctly Minimal→Extreme and at 0.65 render scale; magic survives down-tiers.

---

## 16. Open Questions / Decisions for the user

1. **Constellation figure(s):** which reserved figure for GAME_OVER (a simple star, a lotus, a "wish" rune)? And should combos roll random constellations or always the same signature one for identity?
2. **Aurora: keep or cut?** The Wonder judge flags overlap with the dedicated `aurora` theme and lists it as the prime board-washing risk. Default plan: keep as a thin High+-only whisper, droppable. Confirm, or cut it entirely in favor of the curl-noise river as the sole signature.
3. **Idle ambient meteors:** strictly zero (pure event-bound, maximally "earned") or a *very* rare hash-gated drift (one every ~30–60s) so a player who never clears a line still glimpses one? Plan leans rare-drift; confirm.
4. **Tetromino palette:** refresh `starlight-tetrominos.js` to the new star-temperature palette (recommended for cohesion), or leave the existing glow config untouched?
5. **Extreme ceiling:** starfield is currently held at 32k until higher counts are validated on the target iGPU; future stardust caps still need their own isolated playground proof.
6. **Diffraction spikes everywhere vs hero-only:** plan gates to brightest ~1.5–2% as an emotional device. Confirm you don't want a denser "telescope photo" spike field (which trends toward A's documentary register).
7. **Audio reactivity (out of scope for v1):** the magic-layer research notes a clean AudioAnalyser→uniform path. Defer to a later phase, or want it considered in Phase 5?

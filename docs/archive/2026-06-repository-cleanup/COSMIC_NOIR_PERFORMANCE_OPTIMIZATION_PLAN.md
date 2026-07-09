# Cosmic Noir — Performance Optimization Plan

**Goal:** make Cosmic Noir cheaper to render **without changing how it looks or feels.**
Every change below is either provably visual‑neutral (removes work that produces no
visible pixels) or gated behind an explicit A/B so we can prove parity before shipping.

The theme is already a mature WebGPU/WebGL hybrid with an adaptive budget system,
quality presets, MRT bloom, and GPU compute sparks. So this is **not** a rewrite — it's
surgical removal of wasted work plus a couple of optional fill‑rate trims if we still
need headroom after the free wins.

---

## 1. How we measure (do this first — don't optimize blind)

The theme ships its own instrumentation. Use it; don't guess.

- **Baseline capture flag:** load with `?cosmicNoirBaseline` (alias `?baseline`). This
  installs `window.cosmicNoirBaseline` with `capture(label)`, `report()`,
  `downloadReport()`, `reset()`. See [cosmic-noir-theme.js:1032](../src/themes/cosmic-noir/cosmic-noir-theme.js#L1032).
- **Deterministic runs:** add `&cosmicNoirSeed=1&cosmicNoirFixedDeltaMs=16.67&cosmicNoirFixedPixelRatio=1.25`
  so before/after captures are comparable frame‑for‑frame.
- **Report fields that matter:** `avgFps`, `low1Fps`, `p95FrameMs`, `p99FrameMs`,
  `avgPoints`, `peakPoints`, `avgDrawCalls`, `avgTriangles`
  ([getBaselineReport](../src/themes/cosmic-noir/cosmic-noir-theme.js#L883)).
- **Full harness:** `npm run validate:cosmic-noir:phase6` runs idle/combat/soak across
  `webgpu_high`, `webgpu_high_no_compute`, `webgl_high_force_webgl` and checks
  `p95 <= 16.7ms`, draw‑call reduction, and soak memory stability
  (`docs/COSMIC_NOIR_PHASE6_VALIDATION_PROTOCOL.md`).

**Capture two profiles before touching code:** (a) *idle* (menu, no combos — this is the
screenshot's state) and (b) *combat* (sustained combos). The idle number is what the user
sees most of the time, and it's where the biggest free win is hiding.

### Expected idle "smoking gun"
In the **idle** report, look at `avgPoints`. It will be roughly
`starfield (~30k @ High) + ambientDust + voidSparks (~26k @ High)`. The void‑spark
contribution should be **zero when idle** — but it isn't (see §3.1). That single line in
the report confirms the headline optimization is real before we write any code.

---

## 2. Per‑frame cost model (what actually costs us)

Always‑on, every frame (these define "the look" — trim only with A/B):

| System | Cost driver | Notes |
|---|---|---|
| Atmosphere ×2 spheres (detail 64) | **Fragment fill + overdraw**, 3 noise samples + heavy math each, additive transparent, big screen coverage, camera flies *inside* them | [createAtmosphereNodeMaterial](../src/themes/cosmic-noir/cosmic-noir-materials.js#L298) |
| Accretion disk (Ring 128×64, outer r=1200) | **Fragment fill**, `DoubleSide` (2× fragments), 2 noise samples, huge | [createAccretionDiskNodeMaterial](../src/themes/cosmic-noir/cosmic-noir-materials.js#L872) |
| Nebula ×4 planes (14k–16k units) | **Fragment fill**, 3 noise + 2 texture samples = 5 fetches/pixel each, additive | [createNebulaNodeMaterial](../src/themes/cosmic-noir/cosmic-noir-materials.js#L420) |
| Planet sphere (detail 64) | `tslFbm` (4 octaves = 4×4 hashes w/ `sin`) computed for **every** fragment, then mostly multiplied to 0 by `coreMask` | [createPlanetNodeMaterial](../src/themes/cosmic-noir/cosmic-noir-materials.js#L122) |
| Starfield 30k points ×3 layers | Vertex + additive overdraw | fine, leave it |
| **Void‑spark compute + draw (~26k–50k)** | **Compute dispatch + full vertex draw every frame, even idle** | [animate](../src/themes/cosmic-noir/cosmic-noir-theme.js#L3205) — **the free win** |
| Post stack (bloom + chroma + lensing + grade) | Bloom mip blur is the bulk; already adaptively downsampled | [cosmic-noir-post.js](../src/themes/cosmic-noir/cosmic-noir-post.js) |

Transient (combo‑only, already well gated): gas swirl (24k, `setDrawRange`/`visible`
managed), cosmic waves (pooled), combo flash/flare.

Grounding from current Three.js WebGPU guidance: CPU particle updates bottleneck ~50k and
compute fixes that (we already use compute); **transparent/additive overdraw is fill‑rate
bound** so the wins are "draw fewer transparent pixels" and "don't dispatch/draw work that
makes no pixels"; **half‑res post can ~2× framerate** (we already downsample bloom);
frustum culling only helps with correct bounds; and avoid redundant per‑frame work.

---

## 3. Tier 1 — Zero visual change (pure wasted‑work removal). Ship these.

### 3.1 Gate the void‑spark compute **and** draw on active state  ⭐ headline
**Problem.** On the WebGPU compute path, `createVoidSparks()` builds the points system but
**never** calls `setDrawRange(0,0)` and never toggles `visible`
([cosmic-noir-theme.js:2690](../src/themes/cosmic-noir/cosmic-noir-theme.js#L2690)). The
animate loop dispatches the compute over **all** particles every frame and `continue`s past
the visibility logic ([:3205](../src/themes/cosmic-noir/cosmic-noir-theme.js#L3205),
[:3219](../src/themes/cosmic-noir/cosmic-noir-theme.js#L3219)). Result: at High, ~26k
compute invocations **+** 26k vertex‑shader invocations every frame even when **no spark is
visible** (Extreme: 50k). The unified WebGL fallback already does this correctly with
`activeWindows` + `setDrawRange` ([:2922](../src/themes/cosmic-noir/cosmic-noir-theme.js#L2922)) —
the compute path just never got the same treatment.

**Fix (visual‑neutral because nothing is on screen when idle):**
1. Track a `lastActiveUntil` timestamp in `CosmicNoirSparkCompute.triggerBurst()` —
   `time + maxDelay + maxLife` covers the longest‑lived particle in the batch.
2. In `animate()`, only call `renderer.compute(...)` while `this.time <= sparkCompute.lastActiveUntil`
   (plus one trailing dispatch so the `Else` branch parks particles at `z=-9999`).
3. Give the compute‑backed points a high‑water‑mark `setDrawRange` and `visible=false` when
   inactive — mirror `updateUnifiedVoidSparks`. When a burst fires, set `visible=true` and
   `drawRange(0, highWaterMark)`.

**Payoff:** idle frames drop ~26k–50k compute + 26k–50k vertex ops and one transparent draw
call. This is the biggest single win and it cannot change the picture (the sparks are
invisible at idle). Verify with idle `avgPoints` dropping by the spark count and idle
`avgDrawCalls` dropping by 1.

### 3.2 Skip combo‑flash / lens‑flare matrix work when intensity ≈ 0
`comboFlash` and `comboLensFlare` run `getWorldDirection`, vector copies, `quaternion.copy`,
`lookAt`, and scale writes **every frame** even though both are `visible=false` until a
≥6 combo ([:3326](../src/themes/cosmic-noir/cosmic-noir-theme.js#L3326)–[:3359](../src/themes/cosmic-noir/cosmic-noir-theme.js#L3359)).
Wrap each block in `if (this.comboLensFlareIntensity > 0.001)` / `if (this.comboFlashIntensity > 0.001)`.
Pure CPU, pure win, identical output (they're hidden when the guard is false).

### 3.3 Don't recompute the black‑hole screen projection when post can't use it
The `bhScreenPos` projection (`getWorldPosition` → `project`) runs every frame inside the
post‑update block ([:3452](../src/themes/cosmic-noir/cosmic-noir-theme.js#L3452)). That's
correct *when post is on*, but it's already inside the `usePost` guard, so this is minor —
note it only, leave it. (Listed so we don't "rediscover" it later.)

**Tier 1 risk:** none. Output is pixel‑identical. These are the "ship now" items.

---

## 4. Tier 2 — Imperceptible change, real fragment savings (A/B to confirm)

These touch shaders, so each one ships **only** after an idle+combat A/B screenshot diff at
fixed seed/delta shows no perceptible difference.

### 4.1 Planet: stop paying for FBM where `coreMask` is 0
The photon ring is only visible at the rim: `coreMask = smoothstep(0.85, 0.98, fresnel)` is
**0 across ~85% of the sphere**, yet `ringNoise = tslFbm(..., 4 octaves)` and the fracture
noise are evaluated for every fragment, then multiplied away
([materials.js:146](../src/themes/cosmic-noir/cosmic-noir-materials.js#L146)).
Option A (safest): wrap the ring/fracture computation in a TSL `Fn` with an `If(fresnel > 0.7)`
guard so center fragments skip the noise entirely — same output, far fewer noise evals on the
big black interior. Option B: this is also the one place a 4→3 octave drop is *least*
perceptible (it's multiplied by `coreMask` then by ring power), but A is preferred because it
keeps octaves identical and only removes evaluations that contribute nothing.

### 4.2 Atmosphere inner layer — confirm it earns its pixels
The inner atmosphere shell (opacity 0.18) is a **second full pass** of the expensive
3‑noise‑sample atmosphere shader over a near‑fullscreen sphere
([createAtmosphere](../src/themes/cosmic-noir/cosmic-noir-theme.js#L2323)). A/B with it
removed at High: if the diff is imperceptible, drop it to `atmosphereLayers: 1` on the
preset that's hurting and keep both layers only on Ultra/Extreme. (Medium already runs
2 layers — that's the suspicious one to test first.) **Only ship if the A/B is clean.**

### 4.3 Disable MSAA on the scene pass when post is active
The renderer is created with `antialias` on ([:1584](../src/themes/cosmic-noir/cosmic-noir-theme.js#L1584),
[:1619](../src/themes/cosmic-noir/cosmic-noir-theme.js#L1619)) while the WebGPU `pass()` also
resolves its own target — MSAA on the offscreen scene pass is largely wasted under
post‑processing (standard guidance: "disable multisampling when using post‑processing").
Test the scene‑pass `sampleCount` at 1 with bloom/grade on; edges are softened by bloom + the
dither/grade already. A/B the planet/disk rim for shimmer before shipping.

### 4.4 Nebula: collapse the soft double‑tap if imperceptible
Each nebula fragment samples the texture **twice** (`distortedUv` + `softUv`, mixed 0.42) for
a softening blur ([materials.js:467](../src/themes/cosmic-noir/cosmic-noir-materials.js#L467)).
Across 4 huge additive quads that's a lot of fill. A/B a single tap (or pre‑blur the source
texture offline so one tap reproduces the soft look). Ship only if diff is clean.

**Tier 2 risk:** low, but non‑zero — every item is A/B‑gated. Pixel diff at fixed seed must be
imperceptible or it doesn't ship. None of these change motion, color grade, or composition.

---

## 5. Tier 3 — Only if Tiers 1–2 don't hit target (adaptive, still no *perceived* change)

The adaptive budget system ([updateAdaptiveBudgetState](../src/themes/cosmic-noir/cosmic-noir-theme.js#L621))
already scales pixel ratio, bloom downsample, spark/wave/gas counts, and chromatic under load.
If we still miss `p95 ≤ 16.7ms` on target hardware:

- **Tune the existing pressure thresholds**, don't add new systems — e.g., let
  `bloomDownsample` start trimming a touch earlier, or lower the High `ADAPTIVE_PIXEL_RATIO_CAPS`
  by 0.05. These already exist and are designed to be invisible.
- **Accretion disk `DoubleSide` → `FrontSide`** only if A/B proves the back‑face additive
  contribution is invisible at the fixed camera tilt (it may not be — test, don't assume).
- Leave starfield/nebula counts to the quality presets; don't hand‑cut them.

---

## 6. Sequencing & validation

1. **Capture baselines** (idle + combat, fixed seed/delta) → record `avgFps`, `low1Fps`,
   `p95`, `avgPoints`, `avgDrawCalls`.
2. **Tier 1** (3.1 → 3.2). Re‑capture. Expect idle `avgPoints` to fall by the spark count,
   idle draw calls −1, and idle frame time to drop with **zero** pixel difference. This alone
   may be enough for the menu/idle case in the screenshot.
3. **Tier 2**, one item at a time, each behind an idle+combat screenshot A/B at fixed
   seed/delta. Keep anything with a clean diff; revert anything perceptible.
4. **Run** `npm run validate:cosmic-noir:phase6` — confirm `p95 ≤ 16.7ms`, burst draw‑call
   reduction still ≥ 70%, soak memory stable, WebGL parity intact.
5. **Tier 3** only if step 4 still misses, using existing adaptive knobs.

**Rollback:** Tier 1 is independent and safe to keep regardless. Each Tier 2/3 item is a
standalone change reverted by a single edit; none depend on each other.

---

## 7. Summary

- **Biggest, safest win:** stop dispatching + drawing the idle void‑spark system (§3.1).
  It's invisible when idle, so removing the work is literally invisible — ~26k–50k
  compute+vertex ops/frame back, every idle frame.
- **Free CPU cleanup:** guard the combo flash/flare per‑frame transforms (§3.2).
- **Fragment savings, A/B‑gated:** skip planet FBM on the black interior (§4.1), prune the
  redundant atmosphere/nebula passes if imperceptible (§4.2, §4.4), drop wasted MSAA under
  post (§4.3).
- **Lever of last resort:** tune the adaptive thresholds that already exist (§5).

Nothing here changes composition, motion, color, or the noir mood. We're deleting work that
produces no pixels, and trimming fill‑rate only where a fixed‑seed A/B proves the image is the
same.

---

### Sources (online research)
- [100 Three.js Tips That Actually Improve Performance (2026) — utsubo](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- [Field Guide to TSL and WebGPU — Maxime Heckel](https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/)
- [GPGPU particles with TSL & WebGPU — Wawa Sensei](https://wawasensei.dev/courses/react-three-fiber/lessons/tsl-gpgpu)
- [Three.js WebGPURenderer manual](https://threejs.org/manual/en/webgpurenderer.html)
- [Migrate Three.js to WebGPU (2026) — utsubo](https://www.utsubo.com/blog/webgpu-threejs-migration-guide)
</content>
</invoke>

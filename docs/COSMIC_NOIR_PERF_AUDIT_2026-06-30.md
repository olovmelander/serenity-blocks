# Cosmic Noir — Performance Audit & Optimization Plan (2026-06-30)

Goal: raise and stabilize FPS for the `cosmic-noir` theme **without altering the rendered
visuals, atmosphere, or feel**. Produced by a multi-agent audit (6 parallel finders → adversarial
per-finding visual-invariance verification). 54 candidates checked, 32 survived verification.

## Realistic in-game path (what actually runs)

- **WebGPU**, with **MRT force-disabled on Windows** (`shouldGuardMrtOnPlatform`). So bloom runs on
  the full scene color thresholded ~0.88, *not* an emissive buffer. `emissiveNode` math is computed
  by materials but the no-MRT bloom path does not consume it.
- Default quality **High**: starfield 30k (3 additive Points draws), **4 large additive nebula
  quads** (hardcoded — `nebulaCount` preset is dead), **2 atmosphere shells 48²** (3 noise taps each),
  accretion ring 64 seg (2 noise taps), planet sphere 48² (FBM gated behind fresnel>0.8), compute
  sparks 26k (idle-gated), gas swirl 24k (idle-gated).
- The scene is **fill-rate / overdraw bound**: large additive transparent surfaces (nebula,
  atmosphere, accretion, glow) stacked over the whole screen dominate.

## Tier 0 — pixel-identical (implemented; safe, zero visual change)

### GPU (cosmic-noir-materials.js)
- **atmo-shockwave-gate** — the explosion shockwave chain (`explosionIn/Out`, `shockPhase` sin,
  `shockwave`) is computed per fragment on both atmosphere shells every frame, but multiplies to
  exactly 0 whenever `uExplosionTimer <= 0` (the idle case, ~99% of frames). Gate it behind
  `If(explosionAge > 0)`. Coherent branch on a sphere shell (all fragments same side) → no
  divergence cost. Pixel-identical. *GPU-fill, medium.*
- **pow(x, 2.0) → x·x** at 4 sites (atmosphere fresnel, cosmic-wave intensity, anamorphic-flare
  core glow, accretion intensity gradient). `x*x` is exact and strictly cheaper than the
  `exp2/log2` pow lowering. *GPU-fill, low; trivially safe.*

### CPU / GC stability (cosmic-noir-theme.js) — fewer per-frame allocations ⇒ fewer GC hitches ⇒ smoother frametimes
- **updateReactiveEnvelope** allocated a fresh `decayRates` object + `Object.keys().forEach`
  closure every frame → hoisted to module constants + fixed-key loop.
- **applyAdaptiveLodState** built/compared a string key (`[...].map(toFixed).join(':')`) every
  frame → numeric dirty-compare against stored scalars.
- **getAdaptivePostParams** + **post.update payload** allocated object literals every frame →
  reuse pre-allocated scratch objects.
- **starfield** uniform/layer updates used `forEach` (closure alloc ×2/frame) → indexed `for`.
- **gas-swirl** `updateGasSwirlParticles` ran `filter()`+`reduce()` (array+closure alloc) every
  frame even when idle → early-out when no active windows.
- Cached **renderer pixel ratio** and **target frame ms** (re-derived every frame from
  `window.devicePixelRatio` / `window.settings`) — recompute only on resize / settings change.
- Removed dead field `lastPostUpdateSignature` (written, never read).

### Dead code (no FPS, reduces compile/memory/bundle)
- Removed 2 never-instantiated GPU-compute classes (`CosmicNoirStarTwinkleCompute`,
  `CosmicNoirAtmosphereFlowCompute`) — only `CosmicNoirSparkCompute` is imported. Also dropped the
  now-unused `sin`/`cos` TSL imports and the `max-classes-per-file` eslint disable from that file.
- Removed dead field `lastPostUpdateSignature` (written, never read).

Left in place (flagged, zero runtime cost — not worth the churn): dead preset fields `glowLayers`,
`ambientParticles`, `nebulaCount` (read by nothing — glow is a single hardcoded sprite, dust uses
`dustParticles`, nebula count is hardcoded 4); the dead GPU-twinkle branch in
`createStarfieldNodeMaterial` (its `starCompute` arg is never passed, so the branch is
const-folded out of the node graph at build time and never reaches the GPU); the unused `uTime`
uniform on the cosmic-wave material (write is guarded and only runs during transient line-clear waves).

## Tier 1 — imperceptible in motion (IMPLEMENTED, user-approved 2026-06-30)

These hit the big additive nebula fill and over-tessellated shells — the largest raw GPU savings.
Each was judged imperceptible-in-motion by the adversarial verifier; they change pixels by a
sub-visible amount.

- **nebula 2-tap → 1-tap** (`createNebulaNodeMaterial`) — was `mix(sample(distortedUv),
  sample(softUv), 0.42)`. Now a single tap at the blend-weighted UV
  `0.58·distortedUv + 0.42·softUv` (the texture is locally smooth, so one sample at the average
  location ≈ the averaged samples). Removes a texture fetch on the 4 largest additive quads —
  **the highest Tier-1 fill win**, plus a `dot` and a `mix`.
- **nebula `pow(edge, 0.9)` → `edge`** — exponent ~1.0 over [0,1]; drops a transcendental/fragment.
- **tessellation cuts (gentle, rim-safe)** — chose conservative values rather than the max, since
  the atmosphere fresnel rim is the most-scrutinized edge and the FPS delta of an aggressive cut is
  negligible on a fill-bound scene:
  - atmosphere shells: Extreme/Ultra 64→48, High 48→40, Medium 40→36 (Low/Minimal unchanged).
  - accretion ring: Extreme 128→96, Ultra 96→72, High 64→48, Medium 48→40.
  - planet 48² left alone (hero close-up, faceting risk; FBM already fresnel-gated).

## Round 2 — structural post-pipeline win (IMPLEMENTED 2026-06-30)

- **Eliminated the forced chromatic-aberration RTT** (`cosmic-noir-post.js`). `chromaticAberration(node)`
  calls `convertToTexture(node)` on its input; since the input was a *math expression* (lensed +
  vignetted scene), that forced a full-screen render-to-texture pass **every frame** purely so the
  R/G/B split could sample it. Replaced the node with an inlined manual CA that samples the scene
  texture directly at the lensed+CA-offset UVs (lensing + vignette folded into each of the 3 taps,
  mirroring `ChromaticAberrationNode`'s stepped-scale + radial-offset math exactly). **Two post
  passes → one**, pixel-identical (it even avoids the intermediate RTT's requantization). Net per
  output pixel: 3 direct scene samples in one pass instead of 1 RTT-write sample + 4 RTT reads
  across two passes — fewer texture ops *and* one less full-screen pass on a bandwidth-bound scene.
  This is the largest single GPU win of the whole effort.

## Round 2b — first fidelity-trading lever (IMPLEMENTED 2026-06-30, user-delegated)

- **Inner atmosphere shell dropped on High** (`atmosphereLayers 2→1`). Removes one full additive
  sphere (3 noise taps) of near-planet overdraw. Localized win (planet's screen region, not
  full-screen). Subtle loss of atmospheric depth/glow. **A/B + reversible** via
  `?cosmicNoirAtmoShells=2` (restores the double shell) / `=1` to force single on any preset.
  Extreme/Ultra keep 2 shells (max-fidelity tiers); Medium left at 2.

## Round 2c — baseline scene render scale (IMPLEMENTED 2026-06-30, user-delegated)

- **Scene buffer rendered at 0.92× on High, then upscaled** (`postRenderScale` preset field →
  `this.baseRenderScale`, multiplied into the adaptive resolution scale in `getAdaptivePostParams`,
  so load-shedding stacks on top). Cuts fill across the *entire* scene pass (nebula, atmosphere,
  accretion, starfield) — the broadest single GPU lever; the post composite stays at full res.
  ~15% fewer scene-buffer fragments. Cost: marginal global softening, well-masked by bloom +
  vignette + dither. **A/B + reversible** via `?cosmicNoirRenderScale=1` (native) / any value in
  [0.5, 2.0]. Only High ships <1.0; Extreme/Ultra/Medium stay native.

## Remaining levers (require a visual-fidelity call — NOT yet applied)

Further GPU savings keep trading fidelity. Pick from once a measurement identifies the dominant cost:
- **Push the render scale lower** (`?cosmicNoirRenderScale=0.85`) — biggest dial, more softening.
- **Lower the High pixel-ratio cap** (1.35→1.2) — same family as render scale, at the renderer level;
  large win on high-DPI displays, softer image.
- **Bloom** — raise `bloomDownsample` (0.8→~0.6) or trim mips: softer glow.
- **Nebula count 4→3** — drops one large additive quad: less cloud depth/coverage.
- **Atmosphere/accretion noise-tap or FBM-octave reduction** — less gas micro-detail.

## Chrome-DevTools review (2026-06-30) — visuals + profiling, 244 FPS target

Driven live via the chrome-devtools MCP (booted into cosmic-noir, WebGPU/High confirmed:
baseRenderScale 0.92, single atmosphere shell, useMRT false, useCompute true).

- **Visuals: excellent.** Black singularity + brilliant white photon ring + volumetric grayscale
  gas, deep noir blacks. No artifacts from any optimization. (Camera z-breathing brings it to a
  dramatic close-up = also peak overdraw.)
- **CPU dispatch ≈ 0.7 ms/frame** — negligible; rounds 1–3 made the CPU side trivial.
- **The theme is the GPU bottleneck for 244.** Isolated via `isRenderingPaused`: app with theme
  paused hit **237.5 FPS** (a ~240 Hz panel — the target is real); with the theme rendering it
  dropped to **~104 FPS** → theme ≈ **5.4 ms/frame**, almost all GPU.

⚠️ **Measurement caveats (numbers above are NOT authoritative for real gameplay):**
1. Measured inside the **Serenity Hub**, which renders a full theme-preview gallery → GPU contention
   + bogus draw-call counts (~71–98k; cosmic-noir alone is ~15 draws + bloom/post passes). Real
   single-player gameplay has no such contention.
2. The **chrome-devtools MCP Chrome's WebGPU was unstable** — repeated device losses under automation
   (navigator.gpu disappeared after a GPU-process crash; needs a browser restart). WebGL is hardware
   (RTX 5080 / ANGLE-D3D11), and WebGPU worked initially, but the absolute FPS may be degraded vs a
   stable session. **Re-measure in real single-player gameplay on the RTX 5080.**

**Adaptive-controller defect found (real, code-level):** `updateAdaptiveBudgetState` was fed the CPU
dispatch span (~0.7 ms) instead of the real frame interval, so the load-shedder is blind to
GPU-bound conditions and never engages; and `getAdaptiveTargetFrameMs` clamps the budget to
[8.33, 16.67] ms = max 120 FPS ambition, so a 240 Hz target can't be represented. A fix (feed
`measuredDelta`, relax clamp) was prototyped and **confirmed engaging** (target→4.1 ms, EMA→8.46 ms,
max-shed active) but **reverted**: driving the controller off the vsync-capped real interval would
falsely shed quality on displays whose refresh is below the target (e.g. default 90 FPS target on a
60 Hz panel), and in-browser you can't distinguish vsync-cap from GPU-bound without GPU timestamp
queries / a closed-loop probe. Proper fix needs real-hardware testing. **Kept** one safe piece: the
baseline report now records the **real frame interval**, so `window.cosmicNoirBaseline.report()`
shows true FPS instead of the misleading CPU-dispatch number.

**Path to 244 (pending a reliable hardware measurement):** even max adaptive shed only reached
~114–122 FPS *in the contaminated hub*, suggesting a GPU cost floor that resolution scaling alone
won't clear; a locked 240+ likely needs the static levers below (render scale↓, pixel-ratio cap↓,
nebula 4→3, cheaper bloom) and/or a purpose-built low-fidelity "performance" variant — i.e. a real
fidelity tradeoff. Confirm against a clean single-player measurement first.

## Rejected / out of scope
- Lensing no-op bypass — `lensingStrength` is never actually 0.
- Nebula/accretion `DoubleSide → FrontSide` — camera z-breathing/disk tilt can see back faces → alters.
- Removing planet key/fill/ambient lights — `MeshStandardNodeMaterial` shades on them → alters.
- Chromatic-aberration node bypass when disabled — pixel-identical when off, but requires rebuilding
  the post node graph on toggle, which would hitch exactly under load. Net-negative for stability.

## Validation
Per project rule (WebGPU/TSL changes need a screenshot): Tier 0 is pixel-identical by construction
and verified by a clean build + lint. A visual smoke check in-game is still recommended before
shipping Tier 1.

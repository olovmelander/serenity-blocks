# Koi Pond — "Moonwake Sanctuary" Masterpiece Plan (2026-07)

> Status: **Wave 1 (keystone) SHIPPED to production; Waves 0, 2–6 remain.** Grounded in a
> 7-agent subsystem analysis, live playground captures (idle / lock / combo, WebGPU High),
> and a full source read of the production `rendering/` subsystems. Governs the visual +
> performance upgrade of `src/themes/koi-pond/`.

## Progress log

- **2026-07-26 — Wave 1 keystone (S1 + S2 + S3) DONE, playground-verified, ported to prod.**
  - New `rendering/koi-pond-post.js` (`KoiPondPost`): `PostProcessing` → output-threshold
    `bloom` (added in linear, pre-grade) → **AgX** in-graph (holds jade/violet) →
    cool-shadow/warm-highlight split-tone → vignette → dither/grain, per-quality profiles
    (off on Minimal/Low), modeled on `wolfhour-post.js`, shared `disposeBloomNodeDeep`.
  - Wired into `koi-pond-theme.js` lifecycle: `createPost()` after runtime (overrides water's
    ACES with `NoToneMapping` so AgX runs once), warmup renders through post (dodges the
    black-hole first-frame black screen), `renderFrame()` in the RAF loop, resize + ordered
    dispose (post RTs freed before renderer — SB-15 discipline).
  - **S2/S3 HDR heroes:** moon disc pushed to HDR cool-white with corona bloom + moonwash
    (`koi-pond-water.js` moonBase); troll eye pushed to HDR ember so it clears the bloom
    threshold at rest (`koi-pond-landscape.js` eyeMaterial).
  - **Result:** flat ACES diorama → luminous nocturnal painting. Moon corona, glowing
    snake/lantern/eye, luminous rim. **~174–178 fps at High (from 240), 0 console errors.**
    Proof effect: `?effect=koi-pond-graded&quality=High&orbit=0&t=13` (`&post=0` = A/B off).
  - Wave 0 perf headroom was not needed to fund bloom (ample margin remained).

- **2026-07-26 — Wave 4 · A1 (koi spine undulation) DONE, verified.** `koi-pond-water.js`
  koi body material gained a `positionNode` lateral traveling wave (bodyReach envelope
  head→peduncle) phase-matched to the existing tail sway (1.62 Hz, `x·−0.72`) so torso +
  caudal fin read as one continuous swimming wave. Fish now bend in gentle S-curves instead
  of rigid ovals. Free (vertex-only), ~181 fps, 0 errors.

- **2026-07-26 — Wave 5 (partial) reaction cleanup DONE, verified; deep ripple rework still
  pending.** `koi-pond-gameplay-fx.js`: lock seals are now bold solid HDR-jade scales (body
  fill 0.50→0.92, enlarged 0.54→0.66, jade dominates the pearl rim) so they glow as a "chi
  seal" and bloom instead of reading as hollow debug rings (cross-theme lesson from Serenity
  Warp / Summer: bold solid stamp beats tiny hollow shapes); meniscus rings de-dashed
  (`bristle` 0.56→0.82, `meniscusBreaks` 0.46→0.78); combo ring alpha floor raised
  (`0.14+tier·0.015` → `0.34+tier·0.05`). **Still TODO (the real Wave 5):** inject real
  expanding ripples into the water surface normal so reactions bend the moon/caustics, and
  anchor the lock seal to the board footprint.

- **2026-07-26 — Wave 2 (backlit moon-rim) + Wave 3 (prop life) DONE, verified.**
  - **Wave 2 · A4 backlit moonlit rim** (`koi-pond-landscape.js`): tree crowns, grass tips,
    and the troll now emit a cool HDR edge rim keyed on `pow(1-dot(N,viewDir),k)·moonFacing`
    (feeds bloom) — the Ghibli-night motif; foliage/silhouettes read as moonlit instead of
    flat dark masses. (Full unified depth-fog B1 still deferred; existing FogExp2 carries
    depth for now.)
  - **Wave 3 prop life:** lantern → HDR flame with low-freq flicker + warm-bounce pool
    breathing in sync (`koi-pond-water.js` lanternGlow + `warmBounce.intensity` in update);
    spirit snake → HDR violet-teal body that blooms + stronger swim undulation
    (`koi-pond-landscape.js`); troll → moonlit rim + brighter moss; petals → pinker
    cherry-blossom color + gentle tumble wobble.
  - **~182 fps, 0 errors.**

- **2026-07-26 — Wave 5 DEEP (water-ripple injection) DONE, verified.** Lock/combo now
  physically disturb the pond. Added a 6-slot ripple pool in `koi-pond-water.js`
  (`uniformArray('vec4')`, packed origin/birth/strength, the shipped Stillwater pattern) and
  a **branchless** `makeRippleTerms` that sums expanding ring wavelets into `makeWaveField`'s
  height **and** analytic normal — so the mirrored moon, caustics and refraction bend outward
  from the impact. `water.injectRipple(...)` is called from `koi-pond-runtime.js`
  drainGameplayCommands per lock (side origin, strength 0.78) / combo (pond center, strength
  scales with tier). **Gotcha paid:** TSL imperative `If` needs an active `Fn` builder stack;
  at top-level graph-build time it throws `Cannot read properties of null (reading 'If')` —
  so the loop is branchless (idle slots fall out via `energy=0` from birth=-1000). **240 fps,
  0 errors** — 6 always-summed slots is free ALU.
  - **Remaining:** Wave 4·B2 (Gerstner + tier-gated FBM detail-normal — TDR-sensitive,
    deferred pending in-game review), Wave 6 (foreground repoussoir bough), Wave 2·B1 (unified
    depth-fog), Wave 0 (perf constants). Optional Wave 5 polish: anchor the lock seal to the
    board footprint (currently the x=±10.9 side-lane) so the seal + ripple sit over the board.

- **2026-07-26 — Camera re-framed (cinematic); foreground bough ATTEMPTED then REVERTED.**
  - **Camera (KEPT):** `koi-pond-layout.js` camera pose changed from eye `(0,20.5,25.5)` /
    target `(0,-1.5,-5.5)` (≈35° top-down) → eye `(0,17.6,27.4)` / target `(0,1.2,-5.5)`
    (≈28° shallower). Gives the moon/troll/snake/lantern/trees real vertical presence and a
    proper foreground→mid→background depth read while the pond still anchors the lower-centre.
    ⚠️ **Verify in-game that the 2D board overlay still sits nicely over the pond water** —
    the pond dropped a little in frame. Revert values are the old pose above if it clashes.
  - **Wave 6 bough (REVERTED):** first attempt (arching TubeGeometry + icosphere "leaf"
    clusters) rendered the leaves as giant foreground boulders (scale ~2.4–3.0 at z≈14, far
    too close/big). Removed. A willow bough needs thin drooping leaf-*strand* geometry (small
    planes/tubes forming a curtain silhouette), not spheres — a focused iteration for later.

- **2026-07-26 — Remaining waves batch DONE (verified). Two items deferred with reasons.**
  - **Wave 0 (perf):** reflection scale 0.4→0.34, Ultra/Extreme pixel cap 1.5→1.4, Medium
    refraction→analytic (drops a full-screen copy+depth resolve from the common tier),
    reflection off under reduced-motion, and a ~32 fps present gate for reduced-motion idle
    frames (uses the runtime activity bool; snaps to full rate on any reaction).
  - **Wave 4·B2 (detail normal):** tier-gated FBM detail normal folded into `makeWaveField`
    (forward-difference gradient, 3 taps/octave; High 1, Ultra/Extreme 2, else 0) → moon
    glints scintillate. **First pass (amp 0.55/0.32) was too choppy — lost the zen calm; dialed
    to 0.20/0.12 for a subtle shimmer.** Free at High (240 fps). Full Gerstner horizontal
    displacement intentionally skipped (coarse water mesh would read chunky).
  - **Wave 2·B1 (fog):** `FogExp2` lifted to `0x061a22 @ 0.0116` for atmospheric perspective
    on the distant mountains/trees now that the shallower camera shows more depth.
  - **Wave 6 bough (ATTEMPTED AGAIN → REVERTED):** thin drooping-strand version placed
    upper-left; read as an awkward dark diagonal bar (strands too thin/dark) + dropped fps to
    183 for marginal value. Composition is stronger without it; two attempts confirm a foreground
    repoussoir needs dedicated iteration and isn't worth the crowding/artifact risk here.
  - **Seal board-anchor (DEFERRED):** genuinely needs the live game board to verify board-cell
    → pond-position alignment; changing `mapKoiPondSideLaneToWorld` blind risks worse than the
    current functional side-lane placement. Do it with the board visible.
  - **Final state: 239 fps, 0 console errors, all lint-clean.**

- **2026-07-26 — Moon reposition (follow-up to the camera re-frame).** The moon was authored
  at `y=-8` (below ground) to project into the sky under the *old* steep top-down camera; the
  shallower cinematic camera landed it on the mountain ridgeline ("moon in the mountains").
  Repositioned to `{x:-14, y:6, z:-66}` (radius 2.9, glowScale 11.5) — upper-left-of-centre,
  full moon in the sky. (`y=20` overshot off-frame, `y=8.5` hugged the top corner; `y≈6` is
  the sweet spot.) Vertical framing is aspect-stable — fixed vertical FOV.
  - **Moon depth fix (in front → behind the mountains):** the moon disc had `depthTest=false`
    + `renderOrder=-60`, so it painted *over* the ridge (renderOrder -70) despite being farther
    (`z=-66` vs ridge `z=-35`) — it read as pasted in front of the mountains. Changed
    `moon.renderOrder` → `-75` (before the ridge) so the mountain silhouette + trees occlude
    the moon: it now sits *behind* the mountains, base cradled by the ridgeline — a natural
    moonrise. (`koi-pond-water.js`.)

## TL;DR — the diagnosis

**This theme is a beautifully-engineered nocturne that was authored for a bloom pass that
was never built.** All seven analyses converged on the same #1 finding independently. The
geometry and detail are genuinely ship-grade — Gerstner-ish analytic water, worley
caustics, depth-aware refraction, a 12-mass authored troll sculpture, a sky that *already
contains* stars, drifting clouds, twinkle and a moon halo. But the production runtime
renders through a bare `renderer.render()` with `NoToneMapping` and **no post-processing at
all**. Every glow (moon, lantern, spirit snake, koi gills, troll eye, motes, pond rim) is a
`toneMapped=false` accent clamped ≤ 1.0, waiting for a threshold bloom that does not exist.

The gap is **purely the final ~15% of technical art** — grade, glow, motion, atmosphere —
riding on an already-excellent scaffold. Almost every fix is ALU / vertex / uniform work.

## Evidence (current state, measured)

- **Backend / perf:** WebGPU, High. **240 fps, 33 draw calls, ~38k triangles, 5 koi.**
  Scene is fill/shader-bound, not draw-bound; hot paths are already zero-alloc. There is
  *enormous* headroom to fund the masterpiece features.
- **Rendering:** `koi-pond-theme.js:348` sets `NoToneMapping`; `:615` calls
  `renderer.render()` directly. No `PostProcessing`, no bloom, no grade in production.
  (The old `koi-pond-composition.effect.js` proof used ACES + fog, but the shipped runtime
  does not.)
- **Lock reaction reads as debug bubbles:** the "jade scale seals" are four tiny
  hollow-rim `MeshBasicNodeMaterial` quads (`koi-pond-gameplay-fx.js:265-314`); the
  "meniscus rings" are a doubly angular-gated dashed circle (`:420-428`). Both are flat
  NORMAL-alpha decals pasted *over* the water — they never disturb the surface.
- **`computeRipples` is a permanent `false`** (`koi-pond-water.js:1381`) — there is no
  ripple-injection system; reactions can't move the water.
- **Water reads matte:** great caustics, but no organic detail-normal, no moon-tracking
  glint field, no shoreline foam; the fish "wake" is a hard `RingGeometry` annulus that
  also reads as a gizmo.
- **Crushed-flat sky:** stars/clouds/halo authored at ~0.003–0.38 luminance
  (`koi-pond-landscape.js:453-533`) are invisible with no tone-map/bloom to lift them.
- Troll is a muddy dark blob (needs moon rim + brighter eye); grass is sparse flat
  triangles; near-foreground depth band is empty (no repoussoir).

## Reference

**Copy, don't invent.** `src/themes/wolfhour/wolfhour-post.js` already implements exactly the
MRT-emissive bloom + AgX/split-tone + vignette + grain + dither + per-tier profiles +
shared `disposeBloomNodeDeep` (`src/themes/shared/bloom-dispose.js`) this theme needs.
`bloom` is `three/addons/tsl/display/BloomNode.js`; `AgXToneMapping = 6`
(`three/src/constants.js:464`). Wave 1 is largely a port, not R&D.

---

## Wave plan (playground-first, TDR-safe, one small effect per session)

> **Contract on every wave:** iterate in isolation in `koi-pond-*.effect.js` → screenshot
> with chrome-devtools MCP at a phase-locked `?t=<s>` → check console for WebGPU validation
> errors → only then port into the theme. **Never** batch a full-journey capture on the iGPU.

### Wave 0 — Perf headroom (do BEFORE bloom; funds it). No visual change.
1. **30 fps present gate on reduced-motion / low tiers** in `animate()` using the activity
   bool the runtime already returns and currently discards (`koi-pond-runtime.js:234` →
   `koi-pond-theme.js:614`). Uniforms still advance by real delta; force full-rate on active
   lock/combo frames. ~2× headroom on those tiers.
2. **Pixel-ratio cap 1.5 → 1.4** (`koi-pond-layout.js:73`) and **reflection scale 0.4 →
   0.34** (`koi-pond-water.js:61`). ~13% + ~28% fewer fragments.
3. **Demote Medium refraction → analytic fallback** (`koi-pond-water.js:96`) — removes a
   full-screen framebuffer copy + depth resolve from the commonest laptop tier.
4. **Disable planar reflection under reduced-motion** (`createWaterParams`,
   `koi-pond-runtime.js:29`).

### Wave 1 — FOUNDATION: grade + bloom + HDR (the keystone; unifies everything)
- **S1.** New `src/themes/koi-pond/rendering/koi-pond-post.js` modeled on `wolfhour-post.js`:
  `PostProcessing(renderer)` → `pass(scene,camera)` → MRT `{output, emissive}` →
  `bloom(emissive, strength~0.5, radius~0.4, threshold~0.7)`, composited additively, **AgX**
  tone-map *inside* the node graph (holds the saturated jade/violet ACES yellow-skews). Swap
  `koi-pond-theme.js:615` `renderer.render` → `post.render()`; move tone mapping out of the
  renderer/reflector. Warm via a real `post.render()` in the `compileAsync` warmup
  (`:390`) to dodge the MRT-compile black-screen gotcha. Extend resize + `disposeRuntime`
  to own the post RTs (SB-15 leak discipline). Gate `enabled=false` on Minimal/Low.
- **Gotcha:** marquee glows are `MeshBasicNodeMaterial` (colorNode only) and write nothing
  to the emissive MRT — give them an `emissiveNode` or use **threshold bloom on the
  composited output**. Getting this wrong = glows silently miss bloom.
- **S2.** Push hero emissives to true HDR (> 1.0), zero cost once S1 lands: troll eye ~3–5×,
  koi gill ~2–3×, spirit eye ~2×, lantern aperture → emissive ~2–4×, moon core ~2–4×, add an
  emissive rim to the pond shoreline. Keep ambient/stone/canopy sub-1.0 so only accents cross
  threshold.
- **S3.** Moon → luminous hero: near-white core with cool-limb/warm-core gradient, crater FBM
  as darkening only, two-stop radial corona on the halo sprite.
- Ship S1+S2+S3 together (HDR bumps are inert without the pass). Validate every glow actually
  blooms in a capture before proceeding.

### Wave 2 — ATMOSPHERE: unified fog + backlit moon-rim
- **B1.** Shared TSL depth-fog helper applied to all color nodes (replaces per-material
  `farHaze` opt-outs that leave water/motes/spirit uncovered) + a height-fog term over the
  water; apply as color-lerp, not alpha, on additives.
- **A4.** Backlit moon-rim: `pow(saturate(dot(-normalWorld, moonDir)), k)` masked by
  distance/silhouette, added as a cool emissive rim (feeds bloom) on trees / grass tips / koi
  / troll — the defining Ghibli-night motif.
- Add vignette + blue-noise dither in the same post pass (kills near-black sky banding).

### Wave 3 — HERO PROP LIFE (each its own session)
- **A3.** Lantern flame flicker driving a live warm pool: `uLanternFlicker` low-freq noise
  → lantern emissive + `warmBounce.intensity` + lantern water-lane, guarded by `uMotion`.
- **B3.** Spirit snake becomes a *swimming* spirit: travelling body wave along arc length
  (not a standing S), a 12–20pt additive HDR wisp `Points` shed off the tail, second soft
  halo for volumetric bloom.
- **B5.** Living troll moss: wrap/translucency term + fuzz micro-normal + subtle full-body
  breath scale.
- **S3 polish** (moon corona) + **B6** (dual-rim shore rocks + tumbling pink petals).

### Wave 4 — WATER FIDELITY & KOI LIFE
- **A1.** Whole-body koi spine undulation — `koiMaterial.positionNode` lateral traveling
  wave, phase-matched to the existing tail sway (1.62 Hz, `koi-pond-water.js:771-775`). Free,
  the single biggest "these are props" fix.
- **B2.** Gerstner crest pinch + tier-gated FBM detail normal (octave-gate **0/0/1/2–3** across
  tiers — the TDR-sensitive fill path; iterate exclusively in `koi-pond-water.effect.js`),
  scintillating moon glints off the detail normal.
- **B4.** Shoreline foam / wet meniscus (thin, low-alpha).

### Wave 5 — GAMEPLAY-FX INTEGRATION ("ripples of chi")
- **A2 (full).** Kill the dashed meniscus (delete `meniscusBreaks`, tame `bristle`, raise
  combo alpha floor `koi-pond-gameplay-fx.js:830`). Add ~8 `vec4` ripple-source uniforms to
  `makeWaveField` and **feed their gradient into the analytic normal** so the mirrored moon
  and caustics actually bend; expose `water.injectRipple(...)` called from the runtime. Anchor
  the lock seal to the **board footprint** (not the x = ±10.9 side-lane); let combo crests
  bloom via a dedicated layer excluded from the reflection camera mask; give seals a
  calligraphic write-on + settle ease. This *replaces* overlay draws — cheaper than what it
  removes. Depends on Waves 1 + 4.

### Wave 6 — COMPOSITION & FINISH
- **A5.** Foreground repoussoir: overhanging willow bough + near reeds in the empty near band
  (z ≈ +8..+14), outside `boardSanctuary`, fog=true, cheap height-masked wind sway.
- Hero depth stagger + right-side luminance rebalance + camera idle Lissajous breath.
- Reconcile the playground study with production layout so the isolation proof finally vets
  the shipped frame.
- Tier-C polish as budget allows: crisp point-stars + Milky-Way band, depth-scaled chromatic
  refraction (High+, ≤ 0.004), true reflected-moon glint field, living lily pads
  (veins/rim-curl/bob/lotus), geometry-based god-ray shafts (never screen-space), distant
  mountain layer, per-instance koi palette families (kohaku/ogon/bekko/asagi).

---

## Perf budget

- **Reclaim first (Wave 0), in order:** (1) 30 fps present gate on reduced-motion/low tiers
  (~2×); (2) pixel 1.5→1.4 + reflection 0.34; (3) Medium refraction → analytic; (4)
  reflection off under reduced-motion.
- **New spend:** bloom ≈ 0.4–0.9 ms @ half-res, High+ only, threshold ≥ 0.7, off on
  Minimal/Low. FBM detail normal (B2) is the other real cost — octave-gate hard and iterate
  on the iGPU with captures (the machine has TDR-bluescreened on this path before). Everything
  else (fog, rim, flicker, spine, foam, moss, petals, ripple injection) is effectively free.
- **Net:** Wave 0 frees more than Waves 1–5 spend. The push should end up **faster and more
  stable than today** while looking dramatically better — provided god-rays stay
  geometry-based and FBM stays tier-gated.

## Cross-cutting through-line

The *engineering* is ship-grade everywhere (zero-alloc hot paths, aggressive static-freeze,
disciplined instancing, tier-gated counts, transactional teardown). The masterpiece is
almost entirely additive technical-art work on top of it — a very favorable position.

# Odyssey "Feel As One" Improvement Backlog (2026-08-10)

*Synthesized from an 8-chapter parallel audit (perf + visual + seam continuity). Target: 200+ FPS
RTX 5080, one continuous journey. Tags: [PERF] frame-cost, [VISUAL] look, [SEAM] continuity. Capture
any chapter/seam on the dGPU via `scripts/odyssey-chapter-capture.mjs --chapter N` / `--seam N-M`.*

## Top 10 (ranked by impact ÷ effort)

1. **[VISUAL] Ch4: retime the night transition** — `MOUNTAIN_TRANSITION_START/END` 0.08/0.28 →
   ~0.72/0.98 (mountain-peaks.js:117-118). Today `oneMinus(uTransition)`=0 for the last 72%, so
   summit-ignite/sun disc/ray fan/alpenglow **never render** and the dusk sky shows only in the first
   quarter. Resurrects the entire climax. Highest ratio.
2. **[PERF][SEAM] Ch1: consolidate 3× `isColumn=true` molten + dup selenite pocket** (earth-core.js
   ~1009/1066/1544/1578/1603/1784). Removes ~3-5 heavy cold compiles (~2.7s each) = the boot-warp
   BeginFrame-starvation freeze root. Hoist shared column/pocket materials, thread as params.
3. **[VISUAL] Ch7+Ch8: kill FogExp2 washout on finale heroes** — `material.fog=false` on space/
   backdrop materials (copy deep-ocean.tsl.js:124), and/or profile fogDensity 0.012→~0.0008/0.0035.
   At 0.012 the hero (900u) collapses to a flat violet blob.
4. **[SEAM] Ch7+Ch8: thread `uOpacity` into every `opacityNode`** + `material.uniforms={uOpacity}`.
   In r181 an authored opacityNode REPLACES material.opacity → the manager crossfade is a no-op →
   heroes hard-pop at the boundary. Earth-core/deep-ocean already do it right.
5. **[PERF] Ch2: DoubleSide→FrontSide billboards + god-ray shaftCaustic 2→1 snoise3** (deep-ocean.tsl
   .js:619 creature, :383 seabed, ~:198/:204). ~2× fragment saving, zero visual change.
6. **[SEAM] 6→7: converge Ch6's omen black hole onto Ch7's hero coords** (bhXb~0, bhYb~120, z−900,
   rot.x−1.05). Today two offset holes co-exist through the ecotone. Pure coordinate change.
7. **[SEAM][VISUAL] 5→6: wire the dead `createAuroraFilamentBridge` into Ch6** (cosmic-expanse.js
   ~:995 def, never `group.add`ed). The designed green→crimson handoff simply doesn't exist.
8. **[VISUAL] Ch3: align the global key light with SURFACE_SUN_DIR** (chapter-profile.js Ch3
   `atmosphere.lightDir` `[0.4,0.8,0.45]`→`[-0.48,0.18,-0.86]`). The global key overpowers the local
   sun + front-lights the hero tree, contradicting the sun disc/god-rays/glitter.
9. **[SEAM] add SEAM_12 (steam-quench) + SEAM_23 (wet-dawn) bridges** (seam-bridges.js + manager +
   director). The two most chromatically extreme handoffs (red→teal; indigo→gold) have no bridge →
   muddy midpoints. Mirror the 3→4 branch.
10. **[PERF][VISUAL] Ch6: bake the void-sky dome to a static texture** (cosmic-expanse.tsl.js
    createVoidSkyTSL). Full-screen ~6-noise backdrop shaded every pixel every frame; drift is
    imperceptible (time*0.008).

## Cross-cutting waves

- **A. Material/pipeline consolidation** (per chapter, the recurring perf lever — each distinct
  material = a first-visit compile = a transition hitch): Ch1 (~5 heavy), Ch2 bubbles+plankton→1,
  Ch4 aurora 4→1, Ch5 aurora 6→1, Ch6 stars/dust scalars→uniform, Ch7 disk/shell 3→1, Ch8 signs
  4→2/curtain/skyline. Use the `createSharedCloudMaterialTSL`/`createGodRayFanMaterial` pattern.
- **B. `opacityNode`.mul(uOpacity)** house convention (Ch7/Ch8 miss it → hard-pops).
- **C. `material.fog=false`** on backdrops/space surfaces (Ch7/Ch8 miss it).
- **D. Missing seam bridges**: only SEAM_34/56 exist — build SEAM_12, SEAM_23, SEAM_45, SEAM_67.
- **E. Per-frame array-clone alloc**: `getActiveOdysseyChapterPositions()` (path-utils.js:53) called
  via default args every frame (Ch3 5×, Ch4 2×, Ch5 1×) → fetch once at top of update().
- **F. Unclamped `delta`**: Ch2/3/6/7/8 integrate raw delta → tab-refocus spike. Add
  `const d = Math.min(delta, 1/30)` at the top of every chapter update().
- **G. Additive-overdraw tier-scaling** behind the quality preset (Ch1 ~2400 quads, Ch5 curtains,
  Ch7 ~2350 sprites + oversized halos, Ch8 7-curtain haze). Gate counts AND coverage; `.visible=false`
  on veils whose reveal gate is 0.
- **H. Key-light azimuth continuity per act** (Ch3 tree, Ch3→4 shadow flip, Ch5 summit vs sun, Ch6
  gas-giant lit away from the hole).
- **I. Dead/unwired authored beats**: Ch4 climax gate (#1), Ch4 cloud-sea `uReveal` (defaults 1),
  Ch5/6 filament bridge (#7).

## Per-seam biggest discontinuity

- **1→2**: warm-red→indigo, no bridge → muddy brown. Add SEAM_12. (Light-dir flip below→above is
  intentional — camera pierces the surface.)
- **2→3**: indigo→warm-gold on the default narrow lerp → muddy olive. Add SEAM_23 wet-dawn bridge
  (aqua-foam midpoint). Water membrane already aligned (Fix A) — don't touch.
- **3→4**: key-light azimuth flip (Ch3 low-left-back vs Ch4 `[0.7,0.25,0.4]` right-front) → shadows
  flip L→R. Reconcile the act's sun azimuth; wire cloud-sea uReveal.
- **4→5**: grade pop on the shared hero peaks (Ch4 exits uTransition≈1 cool, Ch5 rebuilds with static
  `uTransition:uniform(0.55)` warm). Drive Ch5 summit-ring uTransition from the dusk scalar starting
  ~1.0; add SEAM_45; fade Ch4 mainPeakOpacity by chapterOpacity.
- **5→6**: dead `createAuroraFilamentBridge` (#7).
- **6→7**: two offset black holes (#6) + fogDensity snaps 0.0006→0.012 (~20×). Converge + SEAM_67.
- **7→8**: opacityNode hard-pop (#4). Atmosphere already aligned — only align the hardcoded
  `AmbientLight(0x101a2a,0.45)` to the profile ambient.

## Execution order (capture-driven; each wave TDR-safe, one chapter/seam capture per step)

- **Wave 0** — global hardening (E array-alloc + F delta-clamp) across Ch2-8; no capture, de-noises
  every later capture.
- **Wave 1** — Ch1 consolidation (#2) → `--chapter 1`; SEAM_12 (#9a) → `--seam 1-2`.
- **Wave 2** — Ch4 climax retime + cloud-sea uReveal + aurora 4→1 (#1) → `--chapter 4` @0.75-0.90 +
  `--seam 3-4`.
- **Wave 3** — Ch7 fog+uOpacity (#3/#4) → `--chapter 7`; Ch8 fog+uOpacity+ambient+haze (#3/#4/G) →
  `--chapter 8` + `--seam 7-8`; Ch6 omen→hero + SEAM_67 (#6) → `--seam 6-7`.
- **Wave 4** — aurora bridge (#7) → `--seam 5-6`; Ch3 light + declutter (#8) → `--chapter 3` +
  re-check `--seam 3-4`; SEAM_23 (#9b) → `--seam 2-3`; Ch2 FrontSide+caustic+bubbles merge (#5) →
  `--chapter 2`; Ch6 void-sky bake (#10) → `--chapter 6`; Ch5 aurora 6→1 + dusk gate + summit-ring
  continuity → `--chapter 5` + `--seam 4-5`.

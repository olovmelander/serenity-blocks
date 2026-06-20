# Summer theme — swaying low-poly vegetation plan

Goal: replace the summer theme's flowers, grass, and (distant) trees with the new
low-poly swaying assets we built, add coherent wind, and push the composition toward
`src/themes/summer/reference/reference_swedish_midsummer_theme.png`.

## Key findings (from the research map)

- **The scene IS a playground effect.** `src/themes/summer/summer-theme.js` is a thin
  `BaseTheme` wrapper that delegates the whole 3D scene to
  `src/playground/effects/summer-meadow.effect.js` (`createSummerMeadowScene`, ~906 lines).
  **Improving the effect improves the theme.** I can iterate at
  `http://localhost:5173/playground.html?effect=summer-meadow` and screenshot-verify.
- **Renderer:** WebGPU (WebGL2 fallback), `NoToneMapping`, SRGB. **Playground color ==
  in-game color** (no WinterPipeline-style hidden grade), so the playground is faithful.
- **One shared wind clock already exists:** `uTime` uniform (effect:90, set each frame at
  effect:817) and a gameplay-reactive `uBreeze` (effect:92, from `SeasonDirector`). All new
  wind must reuse these — never add a second clock.
- **Art direction is UNLIT.** Everything except the GLB trees uses `MeshBasicNodeMaterial`
  shaded manually via `shade()` + `distFog()` (effect:125–146). The new vegetation must match
  this (unlit MeshBasic + the same helpers), NOT the lit `MeshStandardNodeMaterial` from the
  `wind-sway` prototype — we port the prototype's `positionNode` math, not its material class.
- **Current vegetation:**
  - Grass — 26k instanced `PlaneGeometry(0.11×1)` blades, TSL wind already
    (sway+gust+turb × heightFrac², `uBreeze`-driven), front wedge `z +9..-16` (effect:342–404).
  - Flowers — 4.2k instanced **flat alpha-cards** with an 8-lobe daisy silhouette in-shader,
    per-instance color from `[daisy×3, cornflower, lupine, buttercup, poppy]` (effect:406–470).
    **Lupines are flat cards, not spikes** — the main fidelity gap.
  - Distant trees — procedural stacked cones in `summer-trees.js` (`buildConifer`/`spawnProc`),
    plain **`three`** `MeshBasicMaterial`, **CPU `rotation` sway** (not TSL).
  - Near/hero trees — `summer_spruce/birch/aspen.glb` (MeshStandard, lit), **baked 60-frame
    armature wind** via `AnimationMixer`.

## Load-bearing constraints (do not violate)

1. **Instancing gotcha:** TSL `positionNode` runs **before** `instanceMatrix`, and
   `instanceMatrixNode` isn't exposed. Instanced wind must bend in **local** space; world-coherent
   gusts sample noise at a per-instance **`aWorldXZ`** attribute (grass already does this). The
   prototype's `positionWorld` phase only works for **non-instanced** meshes.
2. **Stay opaque.** Transparent/alpha-blended materials black the WebGPU MRT bloom pass — use
   `alphaTest`/`alphaToCoverage`, never `transparent:true`.
3. **`summer-trees.js` imports plain `three`** (no NodeMaterial). To give trees TSL wind, switch
   its import to `three/webgpu` + `three/tsl` (keeps one THREE instance), and remove the CPU sway.
4. **Don't double-animate** hero GLBs (baked armature) with shader wind.
5. New GLB assets under `src/themes/summer/assets/` must be **explicitly `git add`**ed.
6. Screenshot-verify in the playground; keep captures short (iGPU TDR risk).

## Decisions (recommended)

- **Unlit MeshBasic + shared wind.** New `windBasicMat()` helper = `MeshBasicNodeMaterial` whose
  `positionNode` is the prototype's height-mask × layered-sway × gust + flutter, but: bends in
  local space, samples gust from `aWorldXZ`, multiplies by `uBreeze`, and wraps `colorNode` in
  `shade()`/`distFog()`. One helper for grass, flowers, and trees → one coherent wind field.
- **Flowers = per-species 3D instanced meshes** (daisy, buttercup, lupine-spike, cornflower-spike,
  poppy) ported from our Blender generators to Three `BufferGeometry`. ~5 draw calls, opaque,
  per-instance matrix + color/scale jitter. Real petals + domed centers + true vertical spikes.
- **Grass = low-poly tufts** (a few merged blades per instance), denser, widened toward a
  full-width carpet to match the reference foreground.
- **Distant trees = low-poly spruce/pine/birch generators** (our tiered-cone builders) on
  `windBasicMat`, replacing the cone builders + CPU sway; add scattered golden deciduous crowns.

## Phased implementation (each phase = playground screenshot-verified)

- **Phase 0 — wind helper.** Add `windBasicMat()` (+ instanced `aWorldXZ` variant) inside the
  effect, reusing `uTime`/`uBreeze`/`shade`/`distFog`. Unit-check on grass first (swap its
  bespoke wind to the helper, confirm identical look).
- **Phase 1 — flowers (biggest visible win).** Replace the alpha-card block with per-species
  low-poly instanced flowers; tune palette/counts to the reference mix (daisies, buttercups,
  blue cornflowers, purple **lupine spikes**, red poppies); widen scatter. Verify + ref-split.
- **Phase 2 — grass.** Swap blades for low-poly tufts; richen color (root→tip), widen the wedge
  toward full width; keep `aWorldXZ` gust. Verify.
- **Phase 3 — distant trees.** Port `summer-trees.js` to `three/webgpu`; replace cone builders
  with low-poly spruce/pine/birch; apply `windBasicMat` (`positionWorld` phase OK — non-instanced);
  delete CPU rotation sway; add a few golden crowns. Verify treeline vs reference.
- **Phase 4 — near/hero trees (scope-dependent).** Either keep the GLBs + baked sway (lowest
  risk), or swap them for new low-poly trees. Decide via the scope question below.
- **Phase 5 — reference-composition polish.** Full-width meadow carpet, shoreline reeds/cattails,
  warmer rolling-pasture hills. Verify against the reference in `refMode=split`.

## Verification

`?effect=summer-meadow` + chrome-devtools MCP, **one MCP call per message** (wedge mitigation),
`?ref=/themes/summer/reference/...png&refMode=split` overlay, per-element captures, no parallel
browser calls. Pin frames with `__PLAYGROUND__.setTime`.

# Odyssey Rework — Underwater Ascent → Breach → Surface World → Mountains (Ch2→Ch3→Ch4)

*One continuous world. Playground-first, one piece per session. Governing roadmap for the
Ch2→Ch3→Ch4 composition rework. Synthesized 2026-08-10 from a 6-agent analysis workflow.*

## 1. The unifying vision

The camera rises through cathedral god-rays in the deep, and the **same body of water** it was
gliding beneath simply turns over above it — caustic-lit teal underside becoming low-sun gold
topside across one membrane, not a material swap. It crests a **level horizon** into an open,
golden-hour valley of **real rolling grass hills** that undulate right up to the flight corridor —
clean and uncluttered, a few saturated flower drifts and a single hero tree, not a diorama. A
golden river threads the valley as a leading line, past one hero lake, up through a **continuous
climbing slope** — meadow → foothill skirt → the **locked hero peak chain** that was already
visible on the horizon the whole time — so the mountains *grow* rather than pop.

Four shared through-lines honored at every seam:
- **One water surface, one Y.** Ch2 underside and Ch3 sea/river/lake resolve to the *same* world
  plane at **Y 287.3** and wear the *same* view-dependent look.
- **One horizon/fog ramp.** A single global `FogExp2` eased through a breach midpoint (indigo →
  aqua-gold → gold), height-aware at the waterline, then shared golden-hour scatter unbroken
  meadow → foothill → peak.
- **One light.** The sun the diver rises toward underwater (god-rays / `SURFACE_SUN_DIR`) *is* the
  sun that rakes the sea, lights the hills, and alpenglows the peaks — direction rotates, never snaps.
- **One continuous terrain slope + one locked horizon.** Hills → foothill bridge → shared canonical
  peak chain, co-registered in world-Y so the ground never steps and the peaks never move.

## 2. Fix A — Unified water surface (complaint #1: "water looks different under vs above")

**Root causes (three, stacked):**
- (a) Ch2 ceiling and Ch3 surface are *unrelated* materials — additive cyan caustic sheet vs
  normal-blended warm-gold fresnel water (`deep-ocean.tsl.js:143-206` vs `surface-world.tsl.js:531-620`).
- (b) The two planes float **3.0–3.4u apart** so the camera breaches *twice*
  (`CH3_WATER_READABILITY_SETTINGS.seaYOffset=3.0`).
- (c) **BUG:** the foreground SEA still wears the **stale disposed Ch2 additive material** because
  `seaPart.mesh.material` is never reassigned (`surface-world.tsl.js:654,659,660` — the reassignment
  targets the dict handle `seaPart.material`, not `mesh.material`), so sea=cyan while river/lake=gold
  in the *same* frame.

### The change — one shared view-dependent builder
Author **`buildOdysseyWaterSurface(uTime, opts)`** in a new shared module
(`chapter-environments/shared/odyssey-water-surface.tsl.js`). Both `createWaterSurfaceTSL` (Ch2) and
`createOceanSurfaceTSL`/`createGoldenLakeTSL` (Ch3) call it.

Facing branch (core mechanism):
```
up      = surfaceNormal (analytic wave normal, computed ONCE)
facing  = smoothstep(0.0, 0.15, dot(eyeDir, up))   // 0 = seen from below, 1 = from above
color   = mix(belowColor, aboveColor, facing)
```
- **belowColor** = caustic path from `createWaterSurfaceTSL`: `mix(uDeepColor 0x062a55,
  uSurfaceColor 0x0a9bb8, …)` + caustic veins `vec3(0.55,0.95,1.0)*pow(noise,4)*approach`, folded
  into `color.add(...)` (additive-**in-color**) so **one NormalBlending pass serves both sides**.
- **aboveColor** = golden path from `buildGoldenWaterMaterial`: reduced-fresnel warm reflectance
  (`rf0≈0.09`) mixing cool-teal body → warm-gold `skyRefl` + camera-relative sun-glitter
  `vec3(1.0,0.72,0.34)*pow(specDot,90)`.
- **Palette from the contract:** drive `uDeepColor`/`uSurfaceColor`/crest from
  `CH3_WATER_READABILITY_SETTINGS` on BOTH sides so `0x062a55`/`0x0a9bb8` finally reach pixels.
- **Shared normal + eased displacement:** one displacement fn with `uDepth`/`uSeason`-eased
  amplitude — full Gerstner (~2–3u) deep in Ch2 easing to the ~0.1u lake ripple once well above
  water. **Keep the `vElev` clamp** (`deep-ocean.tsl.js:184`) when the shared normal feeds the
  topside fresnel, or Gerstner folds sparkle the sun-glitter.
- **Bloom gate:** `emitsBloom` only on the caustic underside / glitter (a `facing`-gated
  `emissiveNode`) so the ecotone crossfade doesn't flicker bloom on/off.

### Collapse the double surface + fix the bug (paired, mandatory together)
- Set **`seaYOffset = 0`** (river/lake keep +0.4 as renderOrder/polygon-offset only). Both planes
  sit at exactly **waterSurfaceY 287.3**, inside the existing visibility ramp `[275.3, 289.3]` — gate
  math untouched (ramp is relative to `waterSurfaceY`, not `seaYOffset`; `odyssey-path-layout.test.js`
  stays green, no expectation change).
- Fix the material bug: **`seaPart.mesh.material = sharedWater.material`**. Set
  **`sharedWater.material.userData.emitsBloom = true`** and re-stamp `userData.readability` on the
  material the mesh actually uses.
- **Exclusive opacity handoff at the crossing** (mirror the existing 5-6 special case in
  `ChapterEnvironmentManager.updateVisibility`): as `cameraY` rises past 287.3, ramp Ch2 water
  opacity 1→0 and Ch3 sea 0→1 over the ecotone. Key off the *manager*, not the chapter's own
  `waterCrossingOpacity` (test pins local 0.28→0.52).
- **Co-register footprints:** extend/relocate the Ch3 sea so its XZ footprint covers the Ch2
  ceiling's footprint at the boundary progress, gated to the ecotone window only.

### Test contract to preserve (`surface-world-environment.test.js`)
- `sea.material.userData.emitsBloom === true` (:123) — set on the new shared material (bug-fix
  breaks it otherwise; today only the stale material satisfies it).
- `readability.sourceBuilder === 'createWaterSurfaceTSL'` (:107) — keep stamping this string.
- Don't disturb frozen `CH3_WATER_READABILITY_SETTINGS` numbers except `seaYOffset`.
- Preserve names `surface-chapter-02-water-foreground` / `-water-river` + renderOrders (sea −7,
  river −6 < landscape).
- Leave the chapter's `waterCrossingOpacity` local 0.28→0.52; add exclusive handoff on the manager.
- Ch2 side (`deep-ocean-environment.test.js`) — keep `uDepth`/`uOpacity` hooks +
  `group.userData.waterSurfaceY`. Underwater material comparatively free to change.

**Fallback** if shared branch too costly in playground: keep two materials but (a) warm Ch2 ceiling
toward gold over `uDepth 0.85→1`, (b) cool the first ~10% of Ch3 toward teal, (c) still collapse
`seaYOffset` + fix the mesh.material bug. Strictly weaker — prefer the shared builder.

## 3. Fix B — Real grass hills (complaint #2: "grass hills do not exist")

**Root cause:** all rolling noise gated OFF within `d<50` of origin via `smoothstepCPU(50,100,d)`
(`surface-world.tsl.js:337`), so the whole flight corridor (camera x≈−18) flies over pure `baseH`;
the only tall band (ridgeline amp 22) is parked at `d>120` behind fog. Compounded by unlit
`MeshBasicNodeMaterial` (weak `dot()` key) + golden-hour ACES grade flattening value.

### Heightfield rework — `getTerrainHeight(x,z)`
- **Remove the `d<50` dead-zone.** Replace `smoothstepCPU(50,100,d)` with a **corridor-only
  flatten**: a narrow ±~24u band around `surfaceCorridorCenter(z)` (reuse the channel mask) — hills
  engage everywhere except the lane.
- **Add a MID octave the camera reads:** `sin(x·0.06)·cos(z·0.05)·9 + cross-roll(·0.045)` →
  λ≈100–140u, amp 7–10, on the kept broad valley swell.
- **Flank-biased crests:** raise amplitude with `|x − corridorCentre|` → the path threads a green
  valley between shoulders.
- **KEEP load-bearing carves:** `h<-2 → -15` water clamp, lake basin (·34), river channel
  (14→26), knoll(+16)/outcrop(+22), ridgeline notch.
- **Byte-identical corridor-centre at BOTH sites** (`:106` and `:316`) or carve/keep-out desync.
- Geometry `PlaneGeometry(400,400,96,96)`; bump to 128 only if crest facets show.

### Shading rework — landscape `colorNode`
- Steepen `dot()` normal-key response (crest→trough contrast). Add curvature/valley darkening
  (troughs cooler+darker). Push fog onset 250→~320. Overshoot value contrast but cap peak channel
  <0.78; keep `grassColorLow/High` saturation (green not grey).

## 4. Fix C — Strip the foliage (complaint #3: "remove trees/grass/flowers")

**Constraint:** tests pin many by name/existence/metadata → **cannot delete keys** — keep as empty
groups / count-0 instanced meshes with metadata preserved (like the gated-off Quaternius layer).

| Builder | Action | Reason |
|---|---|---|
| `createWildflowers` (800) | Cut → count 0 (or one tiny hero drift) | Not name-pinned |
| `createReeds` (130) | Cut → count 0 | Not pinned |
| `createTrees` (12 deciduous) | Keep object, count → 0 | metadata pinned |
| `createGreatTree` (1 hero) | **KEEP** single landmark | scale/cc0 pinned |
| Both conifer belts (115+≤90) | Cut → count 0, keep key | name pinned |
| `createFallingLeaves` (90) | Keep object (truthy), count → 0 | truthy pinned |
| `createPollen` (300) | Cut → count 0 | Not pinned |
| `createSnowMotes` (160) | Keep object, count → 0, keep key | name pinned |
| `createForegroundLayer` (~120) | Keep object, count → 0, keep key | name pinned |
| `createBirds` (8/3) | **KEEP** (calm sky-life) | flock/crosser/vertex/cc0 pinned |
| 5 GLB flying-bird flights | Cut | not count-pinned; silhouettes cover it |

Preserve: snow-blend collection order (landscape `uSnowBlend` first), CC0 asserts, season sun-rig.

## 5. Fix D — Composition + alignment (complaints #4/#5)

### Ch2 | Ch3 seam
1. Water Y → one plane (Fix A).
2. Add **`SEAM_23_BREACH_BRIDGE`** to `seam-bridges.js` (mirror SEAM_34/56): half-width ~0.045,
   midpoint fog aqua-gold ~`0x5f7d78`, density ~0.0026, `boundary23` block in
   `updateGlobalEnvironment`. **Height-aware:** drive blend by `smoothstep(cameraY over 287.3±6)` so
   fog stays indigo below the plane, warm above. Guard headless/no-camera → progress fallback.
3. Widen the breach beat: Ch2 transition `seamWidth 0.018 → ~0.026` (`chapter-profile.js`).
4. Light: warm god-rays at breach (`breachWarm` 0.6→~0.85 toward `0xffc26a`); lean top 1-2 shafts
   toward `SURFACE_SUN_DIR` (static `rotZ/rotX` bias in `placeGodRaysAlongCorridor`).
5. Sky dome pre-stage: mix Ch2 apex teal `0x149aae` toward Ch3 zenith blue as `ascent→1`.

### Ch3 | Ch4 seam
1. Close the ~10.6u ground step: raise `foothillBaseY` (Ch3 meadow ~Y294 vs Ch4 ~Y283.7).
2. Continuous slope: build a NEW Ch4 foothill skirt at the Ch3 bridge's world coords (separate mesh
   from the canonical chain; carve a ±~60 corridor).
3. Raise Ch4 snow floor + seam conifers from Y247/248 to peaks'-feet ~Y300-320; sink the cloud-sea
   deck below them (or confine to first ~15% via `uReveal`).
4. Match peak lighting across the seam: pass the canonical range a **dedicated peak-transition
   uniform** holding the same seam value on both sides (alpenglow ON) so `alpenScale` matches.
5. Ch4 ground entry ramp: wire `uReveal` + `uOpacity` entry multiply on snowFloor + skirt to a
   `resolveMountainPeaksEntryState`-style ramp on a **NEW target list** (NOT
   `mainPeakOpacityUniformTargets`, pinned to 3).
6. Sky horizon reconcile: nudge the two dome horizon temperatures toward a shared seam value.

### The locked peaks
3 hero peaks = ONE canonical chain rendered by BOTH chapters at identical world coords. **Never
move geometry** — alignment is lighting + ground only. Keep `distantMountains` in
`distantMountainElements`; all new terrain placed relative to the peaks' fixed feet as SEPARATE
meshes. Optional dedup: cross-fade so only one is fully opacity-up mid-seam.

## 6. Implementation sequence — playground-first, screenshot-verified, one small effect per session

**TDR discipline:** one small effect per session; per-chapter short captures; never a full-journey
WebGPU capture.

| # | Session | Harness | Verify | Port to |
|---|---|---|---|---|
| 1 | **Unified water — biggest lever** | `surface-world-emergence` (below→above pass) + `golden-forest-water` + `ocean-surface-cathedral` | below=caustic teal (bloom), above=golden fresnel+glitter, no hard band; one NormalBlending pass; palette from readability tokens | `buildOdysseyWaterSurface` → both builders; fix `seaPart.mesh.material`, `emitsBloom`, `seaYOffset→0`, reflector target Y |
| 2 | **Water breach in-context** (Y collapse + handoff + SEAM_23 fog) | `deep-ocean` + `ch3-ch4-seam` | one membrane at 287.3; one plane opacity-up; fog flips at cameraY≈287.3 | `seam-bridges.js` SEAM_23 + `updateGlobalEnvironment` |
| 3 | **Rolling hills** | `ch3-surface-world` + `surface-world-hero-meadow` | hills undulate to corridor, lit form; lake/river fill; fog onset ~320 | `getTerrainHeight` + landscape `colorNode` |
| 4 | **Strip foliage** (JS wiring) | `ch3-surface-world` | hero tree + few drifts + distant birds only | `surface-world.js` count-0 placeholders |
| 5 | **God-rays warm+lean + sky-dome pre-stage** | `deep-ocean` | shafts warm+rake toward Ch3 sun; dome apex pre-stages Ch3 blue+gold | `createGodRaysTSL` + `createOceanGradientTSL` |
| 6 | **Continuous slope into Ch4** | `seam-34-landscape` + `ch4-mountain-peaks` | skirt continues bridge climb, no ground step; snow floor at feet, cloud sea sunk | NEW Ch4 skirt + `foothillBaseY`/snowFloorY raise |
| 7 | **Peak-lighting match + Ch4 ground entry ramp** | `ch4-mountain-peaks` | locked chain keeps alpenglow across seam; ground cross-dissolves | peak-transition uniform + new ground-entry target list |
| 8 | **Full-seam A/B** short per-chapter captures | `ch3-ch4-seam` + deep-ocean+surface | both seams one world; no double-draw darkening; horizon level | — |

### Key sequencing rule
Fix A (sessions 1–2) unlocks the "one water" read + carries the highest test-interaction risk
(`emitsBloom`/mesh.material coupling) — do it first and prove green before touching terrain. Fixes
B/C are largely independent and low-risk. Fix D's seam work depends on water+terrain unified first.

### Tests that must stay green
`surface-world-environment.test.js` · `deep-ocean-environment.test.js` ·
`mountain-peaks-environment.test.js` · `odyssey-path-layout.test.js` ·
`chapter-environment-manager.test.js` · `odyssey-p4-environments.test.js` ·
`OdysseyDirector.test.js` / `chapter-registry-consistency.test.js`.

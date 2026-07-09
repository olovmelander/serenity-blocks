# Odyssey Visual Upgrade Plan (Wave VI)

Source: a 12-agent review of all 8 chapters against the `artifacts/odyssey/wave-v` captures + full
environment code, plus three deep-dives (mountains, the ch3→ch4 seam, ch3 tree grounding).
Visual claims are bounded by capture coverage — see the capture checklist. The live WebGPU board
**cannot** be screenshotted headlessly (TDR/iGPU risk); the **playground** (`npm run dev:playground`)
is the headless-safe fast-iteration path and is the vehicle for the mountains + tree work.

## The one finding that matters most

**The universal failure is value structure, not feature count.** Seven of eight chapters share the
same symptom: a flat, single-value, often over-saturated wash with no figure/ground separation. The
set pieces, shader detail, and lighting are already authored and AAA-ambitious — they're just not
surviving to screen because the value ladder (dark anchor → mid hero → light atmosphere) is collapsed.

Two systemic suspects to check **before** per-chapter tuning:
1. **Global post-chain** (bloom threshold / exposure / tonemap in `OdysseyAtmosphere`) may be lifting
   authored blacks and washing mids — Ch2 authors a `0x020510` abyss and Ch6/7 author deep voids, yet
   all render bright-flat or near-black-empty. If exposure/bloom is the culprit, per-chapter constant
   edits keep getting defeated downstream.
2. **No dark foreground anchor** in any chapter except Ch3. The cheapest universal upgrade is a
   near-camera dark silhouette/flank giving every frame a true black point.

## Per-chapter scorecard

| Ch | Environment | Top issues | Priority |
|----|-------------|-----------|----------|
| 1 | earth-core (Molten Cathedral) | Flat high-sat red wash (no 70/30 dark target); no directional key/rim on rock; weak aerial perspective kills pillar scale; one-frequency crust stipple; value cliff + bokeh blobs at seam | **H** |
| 2 | deep-ocean | Flat bright-cyan field ~60% of chapter; no dark abyss-below gradient; hero manta/leviathan/reef invisible; unlit black level-node reads as a hole. Suspect bloom/exposure defeating the `0x020510` abyss | **H** |
| 3 | surface-world | Ghost see-through transparent-triangle mountains; giant chartreuse god-ray beam dead-center; flat pale sky; top-heavy washed value, no dark foreground; **GLB trees buried 15u** | **H** |
| 4 | mountain-peaks | Near-monochrome pale blue-grey wash; single smooth-cone silhouettes (no ridgelines); stacked fog erases contrast; visible hard plane-edge seams; depth tiers OFF; snow/rock + alpenglow collapse | **H** |
| 5 | sky-drift | Warm cloud-cathedral hero invisible (sun dies ~55%); aurora reads as a hard rainbow stripe not a cool curtain; Ch4 summit-ring mountain dominates as a white wall; dutch-tilt framing | **H** |
| 6 | cosmic-expanse | Nebula smoke is the protagonist ~60%; black hole = flat concentric bullseye (no lensing arc); flat ambient; gas giant under-scaled; **high-webgpu capture MISSING** | **M** |
| 7 | black-hole-transcendence | Great entry-hero frame thrown away by 25% fade window; locked hero occluded by void dome+ambient; flat bullseye; near-black low-contrast midsection | **M** |
| 8 | urban-dreams | Camera framing failure — `computeCorridorOrientation` mis-aligns the -Z vista so hero sun/spire/road are off-frame; 50–70% dead-black; no ground/scale anchor | **M** |

### Cross-chapter consistency (this is what makes connections read intentional)
- **Tone/temperature arc** must be deliberate: Ch1 warm molten → Ch2 cool cyan → Ch3 warm meadow →
  Ch4 cold dusk peaks → Ch5 dusk sky → Ch6/7 cool void w/ warm accretion → Ch8 neon. The two hardest
  jumps are **3→4** (warm-saturated day → cold-desaturated dusk) and the warm→cool key-light handoffs.
- **Seam colour vs ecotone mismatch is systemic**: env-group *opacity* crossfades use the wide ecotone
  (±~0.055) but fog/sky/ambient *colour* uses the narrow per-seam window (3→4 = 0.03), so both biomes
  are co-present under the old palette, then the grade snaps. Widen colour+density ramps to the ecotone
  (the `SEAM_56_*` machinery is the proven template to copy).
- **Geometry continuity is already solved** — `shared/canonical-mountain-range.js` is byte-identical and
  world-locked across Ch3/4/5, so silhouettes never pop. Preserve it; the work is the colour/value/light bridge.
- **Black holes (Ch6+Ch7) share one flaw** — coplanar additive rings read as a 2D bullseye. Fix once
  (soft radial halo + a lensed top-arc) and apply to both.

---

## Workstream A — World-class mountains (Ch4)

Materials are `MeshBasicNodeMaterial`, so scene `DirectionalLight`s do nothing — all shading is in `colorNode`.

1. **(L) Ridged multifractal silhouette** — `shared/mountain-language.js` (`MOUNTAIN_DISPLACEMENT` /
   `mountainCpuDisplacement`): keep a gentle base cone for mass, **add** a ridged-noise term
   (`(1-abs(noise))^2` over octaves) for crest lines + spurs; add a low-freq rotated FBM warp for
   subsidiary summits/asymmetric shoulders; **stop** multiplying detail by `(1-normDist)` to zero —
   keep ridge energy out to ~0.85 radius then feather. Raise `detailAmplitude` ~0.4→0.6, add octaves.
2. **(M) De-wash the atmosphere** — lower `fogMax` 0.58→~0.38, push `fogNear` 620→~900; grade fog by
   **altitude** not just distance. In `mountain-peaks.tsl.js createMountainSkyTSL` deepen the silver band
   `0xaac6e0`→~`0x8fb0cf` and start the richer alpine band at h~0.18 so peaks silhouette against a darker sky.
3. **(S) Turn ON depth tiers** — at the `createCanonicalMountainRangeTSL` call (`mountain-peaks.js:195`)
   pass `includeFarRange:true` (evaluate `includeForeground:true`). The far-range (z -1120/-1180) and
   foreground specs already exist; three bands = real parallax/scale.
4. **(S) Kill plane-edge seams** — widen `createFBMMountainTSL` `sideFade` (0..0.08→0..0.18 etc.), gate
   alpha by a height/dist falloff, and set `depthWrite=true` when opaque. Raise the Ch3 preview range
   `SURFACE_DISTANT_MOUNTAIN_PREVIEW_OPACITY` toward opaque + push into haze (fixes the ghost triangles).
5. **(M) Snow/rock believability** — with ridges in place, lower `slopeSnowMax` so steep faces expose rock;
   raise rock↔snow value contrast; drive the snow-line jitter from the **same** ridge noise (snowline follows gullies).
6. **(M) Key/rim + god-ray read** — raise `rimStrength`/`alpenStrength`; widen the summit ignite
   (`crown smoothstep 0.7,0.97 → 0.55,0.97`); longer/softer `createMountainSunTSL` rays; keep additive energy bloom-capped.
7. **(S) Bigger hero framing** — pull `ch4-center-hero` nearer (z -680→~-560) / taller so the Gipfelkreuz reads.

## Workstream B — World-class ch3→ch4 connection (the seam)

Geometry slides through fine (shared canonical chain); the problem is the **colour/value/density bridge**
crammed into `seamWidth=0.03` while opacity uses the wider ecotone.

1. **(S) Capture seam-3-4 FIRST** (missing) — add `seam-3-4-high-webgpu/` straddling
   `chapterPositions[3]=0.352` at the seam-6-7 cadence. Cannot tune confidently without real frames.
2. **(M, core) Wide colour+density bridge** — mirror `SEAM_56_*` (`ChapterEnvironmentManager.js:170-252`):
   add `SEAM_34_COLOUR_HALF_WIDTH (~0.06)`, lerp fog/sky/ambient colour + intensity across that window,
   and ease `fogDensity` with `densityBlend = blend**~1.6` (0.0016→0.005 is ~3.1x and currently snaps).
3. **(M) Gilt bridge constant** — route the midpoint through a warm hazy ridge tone (e.g. fog `0x9fb0bf`,
   sky `0x6f86a0`, ambient `0xd8d2c4`), like `SEAM_56_AURORA_BRIDGE`, so warmth doesn't evaporate at the cut.
4. **(M) Warm + contrast Ch4's opening** — `uTransition`-keyed warm gilt bias early-chapter; nudge Ch4
   ambient cooler+darker in `chapter-profile.js` so it stops floating at mid-grey.
5. **(M) Dark foreground anchor for Ch4** — add a near-camera dark ridge flank (analogous to Ch3's
   `createForegroundPassByTSL`) for a true black point that keeps the value language continuous across the boundary.
6. **(S) Shared warm→cool key-light ramp** across the ecotone (Ch3 departing gold → Ch4 moonlight target).
7. **(S) Ecotone preload** — keep the canonical chain near-opaque to the boundary so the cross-dissolve is invisible.

## Workstream C — Ch3 trees grounded on the grass

- ✅ **DONE — root cause** (`surface-world.js:551`): removed the extra `-15` on the GLB `groundLayer`
  (props sample `getTerrainHeight` directly and bake no -15, so the offset buried them ~15u).
- ✅ **DONE — pivot-safe seating** (`addQuaterniusGroundModel`): seat each model's **lowest vertex** on
  the sampled ground via a `Box3` measure (robust to center-pivoted models).
- ✅ **DONE — Great Tree** (`surface-world.tsl.js:1258`): dropped the matching `-15`.
- ☐ **(M) Slope-aware `resolveGroundPoint`** — sample cardinal neighbours, reject/nudge on steep slope,
  keep the original x/z when valid (today it can teleport a tree off its composed spot).
- ☐ **(S) River/water exclusion** — reject points inside the carved channel (`SURFACE_RIVER_CENTER_X`).
- ☐ **(S) Per-instance variation** — seeded yaw + slight scale jitter (only after confirming it doesn't
  break the 23 hand-authored placements; verify in the playground first).
- ☐ **(M) Contact shadow** — enable `castShadow` for tree/bush roles, or a cheap soft contact-shadow
  decal at each base (strongest "sits on the grass" cue). Watch iGPU perf.

---

## Playground-first sequence (one small effect per session, screenshot-verify each)

1. **`mountain-range.effect.js`** — import the real builders (`createMountainSkyTSL`, `createFBMMountainTSL`,
   `createCloudSeaDeckTSL`, `createMountainSunTSL`, displacement/shading from `mountain-language.js`,
   specs from `getCanonicalMountainRangeWorldSpecs`). Iterate the **ridged displacement** first (HMR is live).
   Drop `chapter-04-motion-01.png` into `public/playground-refs/` and use `?ref=...&refMode=split`.
2. **`ch3-tree-scatter.effect.js`** — import `getTerrainHeight`, displace a plane = the chapter terrain,
   scatter trees with the shipping seat math (verify the fix above), add a contact disc to read grounding.
3. **black-hole lensing** — prototype a soft radial halo + lensed top-arc once; port to Ch6 + Ch7.

Because these import the real builders, accepted changes are already in the shipping path — no separate port step.

## Capture checklist (user, desktop session, TDR-safe short sessions)
- **seam-3-4-high-webgpu** (MISSING) — straddle progress 0.352 + a held frame at exactly 0.352.
- **chapter-06-high-webgpu** (MISSING — only minimal exists).
- **chapter-03 re-capture** after the trees fix — frames 04/05/06 + a grazing-angle still showing trunk
  **bases** meeting the grass (confirm trees no longer float at the horizon).
- **chapter-04 re-capture** after ridged displacement + de-wash + foreground anchor.
- Ch1/2/5/8 re-captures after their value-ladder + framing fixes.
- Capture-config hygiene: every frame `0000` is the global ODYSSEY title splash — start each chapter's
  capture after the intro so the "start frame" shows the environment.

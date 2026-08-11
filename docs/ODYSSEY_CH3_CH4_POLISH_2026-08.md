# Odyssey Ch3→Ch4 polish — one landscape, not stacked environments (2026-08-11)

**SHIPPED + capture-verified.** Four user-reported issues at the end of Ch3 / start of Ch4
(pop-in, distant-range intersection, grass/water blending, pixelated meadow), all diagnosed
to verified root causes before editing. 310 test files green; before/after captures in
`artifacts/odyssey/wave-v/seam-3-4-high-webgpu/` (+ `chapter-03`/`chapter-04`).

## The unifying root cause (issues 1+2)

The "second environment layered over the first" band the user circled was **Chapter 4's own
ground kit** — foothill apron, cloud-sea deck, snow floor, seam conifer belt, spindrift —
snapping to full presence the frame the 3→4 ecotone opened (~p 0.371), in front of a hero
chain whose feet were transparent at exactly rail eye height. Mechanism, in three parts:

1. **r181 `opacityNode` blocks the manager's crossfade.** `ChapterEnvironmentManager`'s
   QW5 fade drives `material.opacity`, which a NodeMaterial with an authored `opacityNode`
   ignores. Every Ch4 element except cloudSea/snowFloor/mainPeaks lacked a chapter-weight
   factor in its own alpha path.
2. **Async loads miss `_collectOpacityTargets`.** The conifer belt's materials are minted
   inside its GLB `loadPromise` — after the manager collected targets — so no fade path
   existed at all. (Generic hardening — re-collect after `loadPromise`s settle — was noted
   but deliberately NOT shipped: the per-element fixes cover the live pops and a global
   forced-`transparent` sweep isn't capture-verifiable across 8 chapters in TDR-safe
   sessions. Revisit if another async-loaded chapter asset pops.)
3. **The hero chain floated.** `MAIN_PEAK_BASE` baseFade 0.02→0.1 of a 720u-tall hero put
   its alpha-cut at world y≈374 — rail eye height for the whole approach — and the baseMist
   band (0.15) washed fog up to y≈410. Everything behind showed through the gap at its feet.

### Fixes

| What | Where |
|---|---|
| Apron/plume/flags/cairns: `× mpChapterOpacity` folded into the uOpacity loop (=1 mid-chapter, so the 4→5 exit fade is unchanged) | `mountain-peaks.js` update |
| Conifer belt: authored `uOpacity` opacityNode (+ transparent, depthWrite toggled at ≥0.98) driven by chapter weight | `snow-conifer-belt.js`, `mountain-peaks.js` |
| Spindrift field: `streak.mul(0.55).mul(uFieldOpacity)` driven by chapter weight | `mountain-peaks.js` |
| Cloud-sea deck: purpose-built `uReveal` hook finally wired — sunk through the approach, surfaces over local 0→0.25 as the camera climbs above it | `mountain-peaks.js` |
| Apron pushed BEHIND the hero plane (z −600/−710/−860 → −1350/−1450/−1600, dropped 28u) — background fill on the flanks, never a band across the hero | `mountain-peaks.js` |
| Belt reach clamped 560→320 so no trees stand in front of the chain's feet | `mountain-peaks.js` |
| Hero chain grounded: baseFade 0.02/0.1 → 0.005/0.035 (opaque from ~y 327, meeting the snow-floor datum ~302); baseMist band 0.15 → 0.07 (caps ~352, below the rail) | `canonical-mountain-range.js`, `mountain-peaks.tsl.js` |
| L5 dedup verdict made **sticky** (`userData.rangeAuthority`) and honoured by surface-world's per-frame visible write — the two coplanar chain copies no longer co-draw (z-fight) between the 0.389 authority flip and Ch3's group hide (~0.419) | `ChapterEnvironmentManager.js`, `surface-world.js` |

The apron-depth pin in `chapter-environment-manager.test.js` was updated to the new
composition (old pin encoded the bug).

## Issue 3 — grass/terrain mismatch + hard water line

- **`MOUNTAIN_SKIRT_MEADOW` 0x3f7a33 → 0x83c26e**: the constant predated the Wave-A
  repalette; after the skirt's own diffuse it landed 2.7–4.6× darker than the meadow it
  seats onto. New value = the landscape's flat-lit product (0.161, 0.383, 0.111 linear)
  divided back out by the skirt's flat diffuse — skirt-after-lighting == meadow-after-lighting.
- **Altitude-darkening ramp (5,30)→(12,42)**: relHeight = h+7, so the walkable meadow was
  already 10–30% toward the near-black pole while its vegetation kept constant bright greens.
- **Wildflower stems root-tied**: lower stem blends from the exact lit-meadow colour up into
  the baked species colour (`positionGeometry.y / aSway.w` — NOT positionLocal; r181
  InstanceNode reassigns it before positionNode). Heads keep their vivid baked colour.
- **Shore blend (the sharp-line fix)**: `buildOdysseyWaterSurface` gained an optional
  `shore` config — the terrain heightfield is **baked** (512², half-float R — float32
  filtering is optional in WebGPU, float16 is core) from the SAME `getTerrainHeight` that
  displaces the terrain mesh, sampled in the water shader by world XZ. Alpha dissolves over
  2.6u of true depth; colour lifts toward a lagoon tint over ~8u. Topside-only (`facing`),
  plate-gated, **omitted by Ch2 → its breach ceiling is byte-identical**. Alignment
  uniforms (`uShoreOriginXZ`/`uShoreBaseY`) driven from the live group placement.
- The terrain-side "crisp dark line" wet band was softened (navy 0.96 → wet-earth 0.45,
  band 1–2.8 → 0.5–5) and the sand retinted warm — the water now owns the boundary, so the
  old authored crispness double-painted it. Deliberate deviation from the frozen
  `CH3_WATER_READABILITY_SETTINGS`; the env test pins only deepColor + shelf-fade signs.

## Issue 4 — "pixelated" meadow (not a texture problem)

- **The ground itself was per-fragment WHITE NOISE**: `fract(sin(dot(...)*43758.5453))` at
  26% mix — unfilterable by construction, and the sin() arg reached ~1800 rad (WGSL only
  guarantees accuracy on [−π,π]). Replaced with two octaves of the module's band-limited
  `landscapeNoise` (~4.5u + ~1.1u wavelengths) — same painterly mottling, filters correctly.
- **Scene-pass MSAA, tier-gated**: the flower carpet is thousands of 1–3px vertex-coloured
  petals with zero scene samples (QW1 dropped renderer MSAA). r181 `pass(scene, camera,
  { samples })` honours per-pass samples independently of the renderer flag — 4× on
  High/Ultra/Extreme only; lower tiers keep QW1's zero-sample pass.
- **Odyssey DRS floor 0.5 → 0.65** (clamped in `_applyRenderScale`, Odyssey-only): at the
  global 0.5 floor the browser upscale turned every artifact into visible blocks. When
  pinned, the adaptive ladder escalates to bloom-shed/post-soften instead.
- Dormant grass CanvasTexture got colorSpace/anisotropy hygiene for if it's ever restored.
- NOT touched: `MIN_RENDER_SCALE` global (themes keep 0.5).

## Verification

- Baseline vs after at the same progresses (eased pan — read `currentPosition` from the
  JSON sidecars): `seam-3-4-*.png`. At p≈0.35 the band (dark ridge + mist shelf + floating
  miniature trees) is gone; the massif meets the ground. At p≈0.30 shorelines shallow
  softly, the meadow mottling is smooth, hills+meadow read as one green field.
- Perf note: 4× MSAA on the High-tier scene pass + the 0.65 DRS floor are real GPU cost on
  weak iGPUs — worth a lane on the RTX perf harness (`perf:odyssey:nightly`) before the
  next release cut.
- Known cosmetic remainder: the hero chain's newly-opaque lower body reads flatter/darker
  than before (it used to be semi-transparent there). Acceptable in capture; a low-altitude
  rock-tone lift is a possible follow-up.

## Round 6: the massif must be SOLID the instant you surface

Report: "the mountains are transparent when we come up into chapter three and become solid
after a short while along the path — I want them solid directly."

The chain's alpha was `surfaceGate` = `surfaceOpacity × entryOpacity`. Measured across the breach:

| p | path y | old alpha | new alpha | |
|---|---|---|---|---|
| 0.192 | 287.5 | 0.000 | 0.000 | Ch3 group first becomes visible |
| 0.195 | 290.5 | 0.000 | 0.292 | |
| 0.200 | 294.2 | 0.000 | **0.999** | |
| 0.204 | 297.3 | **0.126** | 1.000 | Ch3 START |
| 0.217 | 306.4 | 1.000 | 1.000 | old ramp finally completes (~7% into Ch3) |

`surfaceOpacity` was never the culprit — it is already 1.0 at path y ≈ 289, *before* Ch3 begins.
`entryOpacity` was: a chapter-progress ramp that is only **0.126 at the chapter start** and does
not finish until ~7% in, so the massif sat see-through for the whole opening stretch.

That ramp is correct for what it was authored for — the NEAR surface elements (the landscape slab
and petals that popped/leaked at the breach). The canonical chain is not one of those: it is a
world-locked landmark already on the horizon, so it should be revealed by the camera clearing the
water, not by an alpha ramp measured in chapter progress. It now gets its own short probe-height
reveal (`waterSurfaceY + 1 → +7`) which:

- is **0 while the 2→3 ecotone opens** (p ≈ 0.192), so it cannot pop in when the group appears;
- reaches **~1.0 at p = 0.200, before Ch3 nominally starts**, so the player never sees it partial;
- is still 0 through deep Chapter 2 — the original "alpine peaks + translucent slab during Deep
  Ocean" leak stays fixed.

Note the gate reads the PATH point (`getOdysseyPathPointAt(progress).y`), while the follow camera
trails behind and below it — so the chain is solid well before the camera itself breaches.
Capture confirms: the first above-water frame shows a fully opaque, snow-capped massif.

The foothill bridge/skirt still rides the slower alpine ramp (0→1 over 4%→52% of Ch3) — left as
is, since it is distant ground rather than the silhouette, but it is the next thing to revisit if
the skirt reads thin behind a now-solid range.

## Round 7: the skirt read flat and disconnected — measured, then welded

Two independent causes, both quantified before touching anything.

**"Disconnected" — the two heightfields disagreed.** The landscape plate (worldZ −200..+200) and
the skirt plane (worldZ −100..−980) OVERLAP, and in that band `getTerrainHeight` and
`foothillBridgeHeight` differed by a **mean of 17.5u, max 61u**. At x=+120 the meadow rises to +36
while the skirt sat at −5 — the skirt sliced straight through the hills. Two surfaces at different
heights pretending to be one landscape.

Fix: through the hand-off band the skirt now converges onto `getTerrainHeight` itself, sitting
0.5u below it. Draw order makes that seamless — the skirt is renderOrder −2 (drawn first) and the
meadow paints over it while opaque, so as the meadow's own rim melts (its `farMelt`, rimDist
172→250) the skirt emerges at the same height and *continues* the surface. The weld is damped
outside the plate in x, because `getTerrainHeight` keeps returning values where no meadow mesh
exists and matching it there would sculpt the skirt to an invisible surface. **Mismatch after:
mean 1.5u, max 7.8u** (the residual is the intentional offset + weld feather).

**"Flat" — it had an eighth of the meadow's relief.** Peak-to-peak across 300u of x: meadow
**60.2u**, skirt **7.3u**. Its three analytic octaves are all ~45–110u wavelength, so it carried no
detail at the scale the eye reads as ground. Added two finer octaves and raised the amplitude
(4/6 → 13/10), damped along the flight corridor so the lane the camera rides stays smooth. Relief
after: **60.2u at the join** (welded), 35.5u at z=−250, ~21–25u higher up — undulating, tapering
naturally as it climbs.

**Atmosphere parity.** The skirt was the ONLY one of the three surfaces still taking the scene
FogExp2 — the landscape it grows out of and the range it climbs into both opted out in earlier
rounds and carry their own authored haze. So the single surface bridging them was getting a pale
wash the other two didn't, flattening its contrast into a separate hazier layer. `material.fog =
false`, matching its neighbours.

`foothillBridgeHeight` stays a pure exported function — the snow-conifer belt seats its props by
calling it, so the trees follow the new relief automatically.

### Round 7b — sun-ray clutter removed, and a self-inflicted artifact on the hills

**Sun rays cut.** `createSunRaysTSL` put 7 additive gold beams (1.0, 0.86, 0.56), bloom-tagged,
in front of the massif — they read as pale streaky veiling over the mountain rather than as
atmosphere. Removed from the live Ch3 scene (with its two registrations in `surfaceElements` and
the uOpacity collector, plus the now-dead `createSunRays` wrapper and its import). The TSL builder
stays exported — the `ch3-surface-world` and `ch3-hero-sun` playground probes still use it. The sun
DISC is kept; that is the actual light source.

**"Something sticks up on the right hill" — my own regression from round 7.** The meadow's alpha
melts over rimDist 172→250, but the weld I added released from 170/−190 — i.e. it let go exactly
where the meadow turns semi-transparent. So in that band the skirt diverged from the terrain by up
to 27u, and because round 7 had just tripled its relief amplitude, its ridges showed THROUGH the
fading meadow as dark angular shapes poking out of the hills. (Confirmed it was not props: both Ch3
conifer belts are `count: 0`, reeds 0, fgPlacements empty — nothing is seated on
`foothillBridgeHeight`.)

Fix: hold the weld at full strength across the meadow's entire melt band and release only past
rimDist 250 (`weldZ` −360→−255, `weldX` out to 255/340). Divergence anywhere the meadow can still
be seen is now a constant **0.50u** — exactly the intentional offset, mean = max — so nothing can
show through, while the skirt keeps 21–25u of real relief beyond the meadow where it is the only
surface.

Lesson worth keeping: a weld/blend band must be aligned to the ALPHA band of the surface it hands
off to. Releasing a geometry blend inside a fade window makes the hidden surface visible exactly
where it disagrees most.

### Round 6b — the foothill skirt was the same bug, and it WAS visible

Flagged as "probably fine" in round 6; validated with numbers + capture, and it was not fine.
The skirt rode `surfaceGate × alpineRampState.rampOpacity` — the entry ramp TIMES a second ramp
that only completed **52% into Ch3**:

| p | skirt alpha | chain alpha |
|---|---|---|
| 0.220 | 0.026 | 1.000 |
| 0.235 | 0.174 | 1.000 |
| 0.250 | 0.403 | 1.000 |
| 0.300 | 1.000 | 1.000 |

Capture at p=0.25 confirmed it: a fully solid massif sitting over a pale haze band instead of
rising ground — the "floating range" read again, arriving by a different route.

Both alpine pieces now share ONE `alpineBreachReveal` (the probe-height gate from round 6), so
the chain and the ground ramp to it appear together, solid, as the camera surfaces. The old
`resolveSurfaceWorldAlpineRampState` is kept and still exported — its unit test pins the ramp and
it documents the original "no alpine pieces during Deep Ocean" contract — but is no longer
consumed by the live env, exactly as `resolveSurfaceWorldSeamRecedeState` was retired earlier.
The Deep-Ocean contract is preserved: the probe-height gate is 0 throughout Chapter 2.

Also removed a genuinely dead expression while here: `distantMountainOpacity` used
`Math.max(SURFACE_DISTANT_MOUNTAIN_PREVIEW_OPACITY, rampOpacity)` where the constant is 1.0 — so
the max could never select the ramp.

## Round 4: the massif's lighting was in the WRONG SPACE (and back-lit)

A 3-agent parallel investigation confirmed the fog diagnosis above and found two deeper causes
I had missed. Both were *masked* by the fog bug, so each only became visible after the previous
fix — the reason this took several capture cycles rather than one.

1. **Mixed-space lighting — the dominant "changes shape" cause.** `mountainColorNode` shaded a
   VIEW-space normal (`vNormal = normalView`, a mechanical GLSL→TSL port artefact — the original
   varying was a world normal) against WORLD-space constants: the key light, the snow slope gate
   and the rim. The lighting was therefore **glued to the camera** — the terminator swept across
   the massif as the rail moved and the snow slope-gate re-cut where snow could sit. Fixed to
   `normalWorld` in the peaks, the snow floor and the foothill skirt (which must share the frame
   or it de-syncs from the range it ramps into).
2. **The heroes were BACK-LIT.** They overrode the key with `MOUNTAIN_LIGHT_DIR` (= `ODYSSEY_SUN`,
   ≈(0.35, 0.62, **−0.70**)) — the sun sits *behind* the range, so every camera-facing slope had
   ndl = 0. Measured: camera-facing slope ndl 0.00 under the hero key vs **0.67** under the shared
   `MOUNTAIN_SHADING.keyDir`. This is why the far-range flank (which uses the shared key, being
   `isHero: false`) read correctly while the heroes went navy the moment the normals were fixed.
   The override is removed — the heroes now share one key with every other alpine surface, which
   is what "ONE mountain language" is meant to mean. The summit ignite still keys off the real sun.
3. **Aerial-perspective window widened** (`fogNear/fogFar/fogMax` 620/1500/0.58 → 260/2600/0.62):
   the old knee sat *inside* the hero's own 1206u body, so the haze ramp slid along the mountain
   during the approach. The flank is numerically unchanged (0.573–0.599 vs 0.58).
4. **Hero-only fog pole** (`MAIN_PEAK_TREATMENT.fog = 0x7d9ec2`). Round 3 lightened the *shared*
   poles, which washed out the far-range flank — the one asset that already read correctly.
   Reverted; only the hero's haze destination is overridden now.

**Three peaks → one massif.** The "hero chain" sat on three different ground levels
(chapter3Center.y −10/−20/−30, a 20u spread) at three depths (140u), so each had its own foot
line and its own haze layer — three models standing near each other. They now share one base
datum (which is also the Ch4 snow-floor datum, ~world 302) with a tight 80u depth stagger, hero
deepest, so the two mains read as its forward shoulders. Peak-clearance test still green.

**Dead code removed:** `ch4-foreground-ridge` spec + the `includeForeground` parameter (zero
consumers repo-wide), and `isSingleHeroChain` (meaningless once the flanks joined the canonical
set, and unread). `foregroundRidge` handle + its test assertion dropped. A stale comment block in
`surface-world.js` still claimed Ch3 built its own distant peaks — corrected to point at the
canonical builder. **NOT removed:** `createDistantMountainsTSL`/`createDistantMountainTSL`/
`createMountainMistTSL` *look* dead from the live path but are reachable via
`createSurfaceWorldPilotTSL`, which the WebGPU pilot loads — they are dev tooling, not dead code.

**Known same-class issue, deliberately not changed:** the Ch3 landscape ground
(`surface-world.tsl.js:911`) has the identical view-space-normal bug. Its shading was tuned
against that behaviour and the user is happy with the ground, so fixing it is a separate change
that needs its own re-tune and capture pass.

## Round 3: the hero massif — washed out AND "changes shape / many different mountains"

The user's own control made this diagnosable: the newly-enabled far-range flank (SAME builder,
SAME geometry pipeline) read "not washed out", "totally like ONE asset", "the same as we move
along the path" — while the hero massif read washed and shape-shifting. The only material
difference was that the flank had `material.fog = false` and the hero did not.

**Both symptoms were ONE bug: the hero was double-fogged by the scene FogExp2.** Measured across
the center-hero's own 1340u plane, the surviving true colour ran:

| | near rim | cone centre | far rim |
|---|---|---|---|
| p=0.30 | 95% | 41% | 8% |
| p=0.39 | 99% | 56% | 11% |

So the scene fog (a) bleached the massif toward PALE MINT (#c8e6c9 in Ch3 / #95a5a6 in Ch4) and
(b) painted a huge ramp ACROSS the mesh that SLID as the rail moved (41%→56% at the cone centre)
— repainting which ridges read as form frame to frame. That is precisely "washed out" plus "feels
like many different modelled big mountains". Geometry was never the issue: `buildMountainGeometry`
is fully seeded with zero `Math.random`, so all three L5 host copies are byte-identical.

Fixes, in the order they were forced by capture (each one exposed the next):

1. **`material.fog = false` on the whole canonical chain** (was far-range only). Third instance of
   this repo's "#1 de-wash lever" (sky dome, landscape ground). → revealed #2.
2. **Fog poles were INVERTED for daylight.** `MOUNTAIN_PALETTE.fogNeutral/fogCool` were
   0x7fa4cf/0x33506e — a DARK navy, a leftover of the day→night beat Wave B dropped. Since
   `mountainSurfaceColorNode` does `mix(color, uFog, fogFactor)`, distance made the massif DARKER
   while the Ch3 sky horizon is #bfe4f2 — receding away from the sky. Un-fogging exposed it as a
   navy blob. Lightened to 0xb2d4ea/0x9dc3e0 so distance lifts toward the sky and depth order is
   preserved (further = hazier = lighter). → revealed #3.
3. **Shadow poles were tuned against the fog crutch.** An A/B capture of Ch4's interior at the
   pre-fix state proved the regression was real, not assumed: unlit faces crushed from #4b5e72 to
   #2a4463 — losing form exactly like the washout, at the other end. `mountainSurfaceColorNode`
   builds an unlit face as `mix(rock * keyAmbient, uShadow, 0.6)`, so 60% of it IS the shadow
   pole; the scene fog had been standing in for ambient sky bounce. Solved the pole back to the
   brightness the fogged version actually had (0x3c506c/0x33547a → 0x6a7f96/0x5e758d) but as REAL
   ambient — which, unlike fog, does not vary with camera distance and so cannot reintroduce the
   sliding gradient. `keyAmbient` was deliberately NOT raised (it also scales the lit snow term,
   which is already near-white and would clip/over-bloom).

Verified: Ch3 approach reads as a solid modelled massif consistent with the flank; Ch4 interior
matches its pre-fix brightness with saturation intact (A/B captures). 310 test files green.

**Remaining, judged acceptable:** Ch3's 15 cumulus banks sit at world z −241..−511, i.e. between
the camera and the massif at −967, so they drift across its lower third. With the massif now
reading solid that looks like weather against a mountain rather than a shape-changing mountain —
but it IS the remaining source of apparent silhouette change, and it is the thing to revisit if
the perception persists.

## Round 2 (same day, from in-game feedback): waterline, ground connection, left flank

1. **Waterline v2** — the first shore blend read as mush: the shore terrain slopes are so
   shallow (the wade ramp) that a 2.6u depth band smeared across tens of horizontal units.
   Band tightened to 1.1u, the terrain's half-transparent shelf cut tightened
   (waterShelfFade −5.5/1.5 → −2.6/0.9), wet rim firmed (0.8–3.4 @ 0.55), and a **noise-
   broken FOAM RIM** added just offshore (depth 0.15–1.7u, where the alpha ramp is already
   mostly opaque) — the defined waterline that makes a shoreline read as natural.
2. **Ground de-wash** — the landscape was DOUBLE-fogged: its authored haze PLUS the scene
   FogExp2 (~30% wash at 250u, ~60% at 400u), whitening every hill base into a pale halo so
   hills read as pasted behind mist. `material.fog = false` on the landscape (the repo's
   established "#1 de-wash lever" — sky dome precedent) + a replacement authored haze:
   fog-family blue-grey, 220–560u, HEIGHT-WEIGHTED so crests shed the haze valleys hold.
3. **Left-flank far range** — the canonical module's far-range silhouettes were fully
   plumbed but never enabled by any host. Enabled in ALL THREE L5 hosts (ch3 preview / ch4
   mainPeaks / ch5 summitRing — they must agree or the authority hand-offs pop). Two
   placement traps cost a capture cycle each: (a) at ~1700u the scene FogExp2 fogs the
   chain to ~100% → far-range materials need `fog = false` (their treatment already carries
   the far-atmosphere language); (b) angular thinking, not world offsets: −780 world-x hid
   the chain BEHIND the massif (same lateral offset subtends half the angle at double the
   distance) — the left flank needs **−1710** to land in the empty left third. Far-right at
   +560/−1320 balances the right. Test pins updated: specIds/children include the two far
   ids; entry-fade targets 3→5.

---

## Round 8 — "why can I see straight through the hero mountain?"

In-game report: background ridges visible *inside* the Ch4 massif, the mountains reading
transparent rather than solid, plus "if there are mountains to the right far back behind we
need to remove that far back mountain". The user asked directly whether this was a
timing / fade-in-out problem.

**It was not timing.** `resolveMountainPeaksEntryState` smoothsteps `entryOpacity` to 1 at
`ch4Start` and it stays there — `uOpacity` is a hard 1 for 100% of Chapter 4, hero peaks
and far-range flanks alike. The transparency was structural.

1. **The rim fade was eating the mountain.** `createFBMMountainTSL` faded alpha with a
   RECTANGULAR per-axis ramp over uv 0→0.16 and 0.84→1.0, but the displaced silhouette is a
   CIRCULAR cone that stops at `MOUNTAIN_DISPLACEMENT.coneRadiusFrac` = 0.45 of the plane.
   The ratio 0.45/0.5 is size-invariant, so on *every* peak at *every* size the cone's own
   rim landed 69% of the way through the fade band — alpha 0.232 at the silhouette edge,
   and the outer 24% of the cone's radius left as a blend ramp. On the 1340u hero that is
   147u of standing mountain per side: measured, a flank still rising 227u was 89% opaque
   and one rising 121u was 59%. Those fragments pass `alphaTest` and write depth, but they
   still *blend* with whatever was drawn earlier — the far-range flanks (renderOrder −3) and
   the foothill apron (−2) were being composited permanently into the massif.

   The fade protected nothing: beyond the cone the bake returns a hard 0, so `baseFade`
   already takes alpha to 0 there. Replaced with a **radial** fade keyed to the cone's own
   footprint (`MOUNTAIN_RIM_FADE`, start `coneRadiusFrac + 0.012`, end `+ 0.055`), which
   only ever acts on the dead flat margin out toward the plane's corners. Body alpha is now
   1 everywhere the eye reads mountain.

2. **The footprint had to be made to close first.** Pushing the fade outside the cone
   exposed a latent bug: `cone` and `crest` both feather to the rim but the fine `detail`
   term did not — it carried ~0.08 × height right up to `normDist` 1.0 and then dropped to
   exactly 0 outside, a hard circular scarp 58u tall on the hero, previously swallowed by
   the over-wide alpha fade. Added `detailFeatherStart` (0.86) so the geometry closes on its
   own. The first guard draft caught this: the ridged crest still carried 8.7% of height
   where the fade had been placed.

3. **`ch4-far-right` removed.** At only +560 off-centre it projected *inside* the massif's
   own span rather than beyond it, so it never balanced the composition — it drew a second
   ridgeline behind the hero's right shoulder, and that is exactly what was showing through
   the semi-transparent flank. `ch4-far-left` works because −1710 clears the massif
   angularly; there is no symmetric room on the right and the composition wants open sky.

4. **The veil rectangle.** With the massif finally opaque, a hard-edged bright RECTANGLE
   appeared hanging in it — reading exactly like a transparent window. It was the breach
   veil (`odyssey-threshold-director/threshold-veil`), an additive quad at renderOrder 0
   drawn in front of the mountain, whose radial feather `1 − smoothstep(0.78, 1.28, r)` with
   `r = length(uv·2−1)` never reached zero on its own boundary (r = 1 at the edge midpoints)
   — the whole edge still carried 59% of the veil's weight, so the quad drew its own
   outline. Feather end pulled to 1.0; core size unchanged. Measured: the hard step at the
   veil's top edge fell from **114 luma to 15** (ordinary gradient).

Guards: `mountain-peaks-solidity.test.js` (the fade may never start inside the displaced
footprint; every ring carrying >3% relief must be inside the opaque region; the dissolve
band must exceed its own noise wobble) and `chapter-threshold-veil.test.js` (zero weight
everywhere on the quad boundary, walked, not sampled at midpoints). Both carry falsification
cases pinned against the pre-fix values.

**Open / not addressed:** the hero's shaded flank measures luma **30/255 with a stddev of
5.6** — a near-flat dark mass — against 200 for the far-left flank and 144 for the sky in
the same frame. The authored shading predicts ~(54,78,105); the grade (global saturation
1.15 × Ch4 sat 1.10, contrast 1.07 × 1.04, cool toe tint + `blackCrush`) drives it to
(15,27,98). Not a lighting bug and not caused by this round — solidity simply removed the
accidental washing that partial alpha was providing. The lever, if the massif should hold
more form in shadow, is `MOUNTAIN_SHADING.keyAmbient` (0.18) or a hero-only shadow-pole
override — NOT the shared fog poles, which washed out the far-range flank last time.

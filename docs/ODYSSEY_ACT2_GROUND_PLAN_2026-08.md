# Act II Ground — the painted terrain (2026-08)

> **STATUS: IMPLEMENTED AND MEASURED, 2026-08-15.** Waves 0-5 shipped in one session, plus
> an owner reversal of the shore composition (see the forest plan's §9). The Lane B gate
> PASSES: the shoreline station reads **10.22 p50 / 10.49 p95** against a 10.6 max — 0.11 ms
> of margin at p95, which is tight and worth knowing. `groundFragMs` = **2.687 ms**, the
> first-ever price of the ground's fragment stack.
>
> **Attribution, all three points measured in ONE thermal state** (the correction below is
> the reason that matters): pre-change 9.83 / 10.03 at drift 0.000 and 52 draws → with the
> ground overhaul 10.09 / 10.49 at drift 0.000 and 52 draws, i.e. the ground costs
> **+0.26 ms** → with the shore reversal 10.22 / 10.49 at drift -0.066 and 55 draws, i.e.
> **+0.13 ms** more, which is two timer ticks against a one-tick drift AND across a
> draw-count change, so treat that last figure as an upper bound rather than a measurement.
>
> ⚠️ **A CORRECTION WORTH READING BEFORE TRUSTING ANY FIGURE IN §5b.** This plan first
> reported the ground at **+0.13 ms**, from a pair taken early in the session (pre-change
> 9.70, ground 9.83). Both sides of that pair were drift-0.000 and content-matched, so it
> was admissible — and it was still wrong as a claim about the shipped tree, because the
> machine warmed up: the SAME ground-only code re-measured **10.09** two hours later. The
> lesson is not "re-run more", it is that ADR-0016's one-window rule applies to the whole
> COMPARISON, not just to each pair inside it. Every number in §5b that compares a before
> to an after across waves inherits that caveat; the three-point table above does not.


**Goal.** Turn Act II's ground — grass, sand, rock, snow, the mountain — from four flat
constants under a ±3.5% sine plaid into a PAINTED TERRAIN with Witness/Ghibli material
identity: a baked macro colour layer (the ji-nuri base coat) that owns hue at the
hundred-metre scale, colour-matched tiled detail that owns texture at the metre scale and
melts to the macro with distance, authored material boundaries instead of smoothstep
cross-fades, a two-model shadow response (vegetation keeps its chroma, rock desaturates),
and a rock language of discrete value bands instead of gradient grey — at ≈ net-zero Lane B
cost, funded by the ground fragment stack's FIRST-EVER measured price (it has never been
gpu-split priced) and by the repo's own measured law that a baked/tiled fetch replaces ~100
ALU of procedural work. The clipmap, the height field, the bakes-at-boot architecture and
the unlit analytic-sun contract all stay; what changes is what the bakes CONTAIN and what
the fragment graph does with values it already fetches.

**Provenance.** 2026-08-14: 7-agent research workflow (4 cited online sweeps — the-witness.net
devlog + Wolfire's colour-matching posts + GDC 2014 deck read first-hand, a Ghibli/Oga
ground-language distillation, a TSL/WebGPU terrain-technique survey priced in fetches, a
premium-vs-playdough property analysis — plus 2 repo deep-reads (ground pipeline
archaeology, perf/ledger constraints) and 1 measurement agent that sampled ground swatches
from all five reference images with the decile-verified box sampler). Transcripts:
`~/.claude/.../subagents/workflows/wf_9dfc265b-2a1`. Reference images: the five already on
disk (`public/playground-refs/act2-trees-ref{1..5}.png`) — they contain every surface this
plan names (Witness village paths/lawns/white rock; Witness autumn ground/stratified
ledges; Witness lake sand cliffs/travertine; Firewatch canyon rock/grass/dirt; Firewatch
dusk hills). This plan lives alongside
[ODYSSEY_ACT2_FOREST_PLAN_2026-08.md](ODYSSEY_ACT2_FOREST_PLAN_2026-08.md) and
[ODYSSEY_GHIBLI_WATER_PLAN_2026-08.md](ODYSSEY_GHIBLI_WATER_PLAN_2026-08.md), reuses their
measured laws, and touches the same file (`odyssey-world-renderer.js`) but a disjoint slot:
the ground material's fragment graph and the bake functions. No new NodeMaterial is
created — the entire overhaul happens inside `groundMat.colorNode` and the bakes, so the
fog/dispose lint lists do not change shape.

---

## 1. What the research established (cited; the design rests on these)

1. **The Witness's terrain colour is ONE painted 2048² island map** ("More island color
   experiments", the-witness.net 2011). They tried Uncharted-2 blend-mapping for colour
   first and ABANDONED it ("we would need a lot of blend layers; slow… laborious… unclear
   it would look good"); Shannon painted a single island colour texture instead —
   "immediately this strikes me as much nicer." Macro colour is AUTHORED WORLD DATA, not a
   per-fragment formula. Our analogue is not a hand-painted map (no artist in the loop) but
   the same architecture: colour fields baked once over world XZ, fetched like the height.
2. **Close-up detail is colour-corrected so it can never fight the macro** ("Themed areas",
   2011-05): "the repeating detail texture is color-corrected so that its average color
   corresponds to the whole-island-color-map's color at that position." The math is
   Wolfire's (wolfire.com, 2009): `final = detailTexel × macroColour / avgDetailColour`,
   with 1/avg precomputed. The division makes the tile's MEAN transparent to the paint —
   detail adds mesostructure, the macro keeps owning the colour. One fetch, one multiply.
3. **Grain melts at distance** ("Experiments in Texturing", 2010-11): "from far away, the
   grain melts away and the structure is mostly a solid color, accented by lighting." And
   the verdict in the same post: "the lighting is actually the biggest ingredient in tying
   the scene together." Detail is a NEAR-FIELD privilege; the mid and far ground must read
   as clean colour masses.
4. **The Witness rock doctrine** ("On the Rocks", Eric Anderson 2013-09): the normal-map/
   edge-distress pass was REJECTED — "'Noise' was our enemy." The method: "analyze,
   deconstruct, simplify" — few large planes, "hard edges are not evil… faceting became a
   powerful tool to help define the form in a clean, almost graphic style." And material
   identity comes from CONTRASTING SHAPE LANGUAGES per family ("foliage has a different
   language, as does rolling terrain, and hard architectural surfaces… it helps inform the
   player what materials the surfaces are made from"). Steep terrain in The Witness is not
   the heightfield at all — "make the walls steep by putting mesh objects in there."
5. **Ghibli's base coat is where the beauty lives.** Kazuo Oga paints the ji-nuri —
   a soft wet-in-wet colour field, 30–60 minutes, before anything dries: "a bad base coat
   meant a bad painting" (Animation Obsessive). Detail is sparse crisp accents placed ON a
   gradient, never a uniform field of texture. Each material is 2–4 authored colours (lit,
   shadow, accent, distance) blended smoothly — not a continuous procedural hue ramp.
6. **Ghibli value law: two masses first.** Light side and shadow side separate near-binary;
   mid-tones live on the LIT side only; the shadow side is one unified hue-shifted colour
   (GVAAT study). "Everything darker steps back, everything lighter steps forward." Contact
   lines (under trees, path edges) are painted occlusion bands — darker AND warmer.
7. **Ghibli specificity beats noise octaves.** Oga stopped painting "weeds vaguely" and
   painted recognisable species; Tanaka: he "extracts the essence… then augments." The
   grammar of a meadow: wind-swept lighter stroke bands across slopes, sparse clustered
   accents, roots darkening at contacts. More octaves of noise is the opposite of this.
8. **How stylized games shipped it.** Alba: FOUR splats total, rulesets (sand low, dirt
   flat, cliff steep, grass else), per-splat transition-detail maps so the blend EDGE
   carries texture, zero normal maps. BotW: near-flat ground albedo, colour zones + aerial
   carry it; grass shades with the terrain's normal. Sable: "distance gradients are one of
   the most important elements of the art style" — in a flat-shaded world they are almost
   the only depth cue. (Matches our unlit contract exactly.)
9. **The TSL technique kit, priced in fetches** (survey agent). Free tier (0 fetches, small
   ALU): macro-variation tint from an existing bake, height-biased boundary blends with
   heights packed into existing channels, threshold perturbation from an existing noise
   fetch, curvature two-colour, quantised strata bands, snow rim/ragged snowline, wet-sand
   band, phase-based wind shimmer on a static field. +1 fetch tier: per-biome detail
   albedo tile, slope-masked single cliff projection (worldY UV), strata ramp. 3-fetch
   tier (price before touching): hex-tiling, full triplanar. Geometry tier: measured
   ~0.8 ms per 100k tris on Lane B.
10. **What separates premium from playdough** (property analysis): authored BOUNDARIES not
    gradients (the single biggest tell); ecotone patches (islands of biome A inside B near
    the border, not a 50/50 mix); wide-radius baked AO pooling in concavities; per-material
    mesostructure; world LOGIC driving the masks (moisture ∝ height+concavity, exposure ∝
    slope aspect — "it converts height bands into a place"); region hue zoning; contact
    integration. Nearly all of it lives at BAKE TIME in this architecture — free at runtime.

## 1b. THE GROUND REFERENCE BAR — measured from the owner's five refs (2026-08-14)

Sampled with the decile-verified box sampler (`sample-boxes.mjs`), contaminated boxes
re-placed up to 3 rounds; sRGB 0–255, `norm` = r/g/b chromaticity fractions, sat = HSV.
These are SCREEN values — authored albedos must OVERSHOOT per the standing law (the world
hands the stack a flatter image than the screen shows; grade amplifies saturation).

- **G1 — TWO SHADOW MODELS, by material.** Vegetation/soil/sand shade preserves
  chromaticity and saturation EXACTLY at luma ×0.5–0.57 (ref2 orange ground: sat 0.76 lit
  AND 0.74 shaded, norm identical; ref4 grass .46/.40/.13 both sides). ROCK shade instead
  DESATURATES toward neutral/mauve — ref2 ledge sat 0.33→0.06 with blue fraction rising,
  ref4 boulder 0.38→0.23, norm blue .25→.30. Deep shade on ANY material is ×0.27–0.32 and
  RED-ENRICHED (ref4 shadowed path norm-r .44→.51; ref5 shade .51 red) — never blue-black.
  This is the ground twin of the forest's measured foliage-shade law: the cool-blue-shadow
  doctrine is REFUTED for vegetation, and holds only for rock.
- **G2 — the saturation split IS the material identity.** Lit grass/soil/sand sat
  0.56–0.79; lit rock sat 0.10–0.38. Golden grass chromaticity has R ≥ G (.46–.50 red vs
  .36–.40 green); only lawn-green flips. Our current authored split (grass ~0.70, rock
  ~0.28) has the right poles — what is missing is everything else in this bar.
- **G3 — the value LADDER between adjacent surfaces.** Ref1 midday: white rock 208 >
  path 163 > grass 95–100 > worked stone 80 — path is 1.65× grass, white rock 2.1× grass.
  Ref2: rock 1.2× ground; WET rock/sand = 0.5–0.7× dry. Ref5 dusk: pale rock becomes the
  BRIGHTEST ground element (1.55× ground). Playdough is "everything a similar mid-tone";
  the references keep a full ladder inside every frame.
- **G4 — flat fills are TIGHT.** Paths, sand hills, dusk hills: p10–p90 within ±5–12 luma.
  No gravel noise anywhere in either game. A path or beach reads through its VALUE and its
  crisp crossing shadows, not through texture busy-ness.
- **G5 — rock texture = 2–3 discrete VALUE-BAND steps, not gradients.** Ref3 sand cliff
  deciles 132→203, travertine 128→221, ref1 white rock 122→218 — steps of ±30–45, one band
  per form/stratum (top light / front mid / undercut dark), plus warm bounce tint where
  foliage is adjacent (ref2 ledge .365/.343/.292 → .448/.318/.234 near orange trees).
- **G6 — grass surfaces are FLAT; the interest is patch variegation.** Witness grass is
  tight ±7 within a patch, but ADJACENT patches jump hue at metre scale (ref1 lawn:
  golden 126/92/35 beside green 96/108/35 — two hues, one lawn). Firewatch grass is the
  opposite grammar — directional stroke alternation, p10→p90 2.5–3× inside one patch
  (dark base / light tips). Two valid languages; pick per zone, never a uniform noise.
- **G7 — aerial on rock goes BLUE, dusk goes PINK.** Distant mountains: norm r .21–.25,
  b .39–.44 (ref1 47/58/64; ref3 60/103/128). At dusk the far shift is pink-lavender
  (.45/.28/.27), not grey — distance desaturates toward a HUE, never toward mud.
- **G8 — shade unifies value; hue carries identity there.** Ref4: every lit surface sits
  within ~1.5× (110–175), and every shaded surface of every material converges to ONE dark
  band (55–70 luma). In shadow, material identity survives as chroma difference (G1), not
  as value difference.
- **G9 — bright and saturated coexist.** Ref3 sand: luma 204 at sat 0.57. Brightness is
  not the enemy of colour — washed-out is a palette failure, not an exposure failure.
- **G10 — strata banding is visible in the deciles** (G5's numbers) — the bar for "did we
  actually build rock identity" is a DECILE signature on a captured cliff face, not a
  vibe: a band histogram with 2–3 flat steps, not a smooth ramp.

## 2. Why the current ground cannot be "tuned into" this look

The deep-read (repo agent, line numbers from `odyssey-world-renderer.js` @ this branch):

1. **One flat constant per biome, four biomes total** (lines 1295–1298). Grass is a single
   vec3 across the whole island — no patch variegation (G6), no moisture/aspect logic, no
   intermediate materials (dirt, dry meadow, scree). No constant can produce a LADDER (G3).
2. **The only albedo modulation on the island is a 175 u sin×cos plaid at ±3.5%** (line
   1299) — biome-agnostic, regular, and it is exactly the "uniform grain multiply" the
   premium analysis names as an amateur tell.
3. **All four biomes share ONE detail-normal recipe** (2-octave value noise at 26 u/7.5 u)
   — the same substance everywhere. Rock has zero identity: no strata (G5), no facet read,
   just the shared bump + cavity darkening.
4. **Boundaries are smoothstep cross-fades** on height/slope — the tinted-playdough
   gradient smear. No edge accents, no ecotone patches, no height-biased blending.
5. **The mid-distance band (100–600 m) is the flattest read in the game** — `detailGate`
   kills all micro past footprint 9/spacing 6, leaving pure biome-mix + macro normal +
   sunVis exactly where the rail camera looks most.
6. **Shadow is a scalar multiply** (`uShadowTint*0.36` ambient plus ndl scaling) — one
   model for all materials, so it can express neither G1 (two models) nor G8 (value
   convergence with chroma identity).
7. **The vividness pass (2026-08-14) fixed the POLES, not the structure.** Sat is now
   right at the constants — but a single saturated constant is still playdough; every
   G-bar row above is about spatial structure the graph cannot currently express.

## 3. The design (and the roads not taken)

The architecture in one sentence: **the bakes become the painter, the fragment graph
becomes the brush** — colour STRUCTURE is authored world data baked once at boot (the
Witness island map, machine-authored), and the per-fragment work stays at today's fetch
count wherever possible by widening what existing fetches return.

Three layers, mirroring §1:

- **Layer 1 — the ji-nuri (macro paint), bake-side, 0 new fetches.** `bakeSunVisibility`'s
  texture widens from R16F to RGBA16F — same resolution, same UV, and the ground fragment
  ALREADY fetches it (line 1328), so three new world-anchored channels arrive free:
  G = wide-radius heightfield AO (two radii, ~8 m + ~60 m, pooled valley darkening — the
  Witness lightmap analogue); B = a MOISTURE/EXPOSURE field computed from the CPU height
  mirror (moisture ∝ concavity + inverse height + sea proximity; exposure ∝ slope aspect
  vs sun azimuth) driving each biome's 2-colour lerp (lush hollow ↔ dry crest for grass);
  A = a WEAR/ACCENT channel (baked tide line at the mean waterline, contact darkening
  discs under the forest's authored framing trees, optional journey-trail — D-path).
  Water's `.r` read is untouched (R keeps its exact meaning).
- **Layer 2 — material identity (mesostructure), one priced fetch.** A NEW baked 256²
  RGBA16F tiling atlas (`groundTex`, mipmapped): R = directional grass-stroke field (dark
  base/light tips, the Firewatch grammar), G = rock strata/fracture field, B = sand ripple
  field, A = a shared height/tooth scalar. Applied Wolfire-style — `albedo × tile /
  tileAvg` per biome — so the macro paint keeps owning colour (§1.2), with the winter
  theme's proven luminance-tooth law (lo/hi near 1.0: "grain, not albedo"). The SAME
  channels double as height-bias for boundary blends and as the per-biome band JITTER.
  Melts to pure macro by camera distance (§1.3) — which also caps its bandwidth cost to
  the near field. Until this fetch is priced and accepted (D2), the free fallback is the
  `.b` channel the two existing bump fetches already return and currently discard.
- **Layer 3 — light and edges, pure ALU on existing values.** (a) The two-model shadow:
  vegetation/sand shade = chroma-preserving luma ×~0.55; rock shade = desaturate toward
  warm-mauve neutral; deep shade floor red-enriched, never blue-black (G1); shadow-side
  value converges (G8) while the terminator stays narrow (Ghibli two-mass law). (b)
  Boundary shaping: blend factors biased by tile height (sand fills BETWEEN grass tufts,
  rock pokes THROUGH thin snow), thresholds perturbed by the snow-jitter fetch's unused
  `.rg` (already paid for), and a 1–2 m edge-accent band (darker + warmer grass lip where
  grass meets sand/rock — the painted contact line). (c) Rock language: quantised worldY
  strata bands (2–3 value steps ±30–45, macro-noise warped, slope-masked) + curvature as a
  2-COLOUR lerp (warm crest / cool cavity) instead of a value multiply. (d) Snow: 3-zone
  (warm lit / ice-shadow / rock-through-thin-snow), ragged snowline, rim. (e) Wet-sand
  band above the waterline at ×0.5–0.7 (G3), breathing with the water's existing phase.
  (f) The living ground: wind-sweep lighter bands travelling through the static field by
  time-varying PHASE (the forest's `fvWindLine` trick — zero new fetches).

**Roads not taken (deliberate, with reasons):**

- **Hex-tiling / full triplanar** — 3× the fetch bill on the biggest fill surface in the
  game; the distance-melt + macro-dominance design attacks repetition for free first.
  Revival condition: a captured tile repeat visible on the graded rig after Wave 2.
- **Instanced grass blades globally** — showcase numbers come from discrete GPUs; on the
  610M this is a vertex+overdraw lane the budget cannot fund. A small opaque clump ring
  near the camera is PARKED in Wave 6 behind its own pair (the forest's ~0.8 ms/100k-tri
  law prices it honestly).
- **Alpha/discard decal sheets over the terrain** — MEASURED dead end (coverage-independent
  tap stack; the cloud sheet's own law).
- **Per-fragment procedural noise** — MEASURED loser (~6.5 ms law, stated in the file's
  own header). Everything new is a bake or a fetch; the plan RECLAIMS the one standing
  exception (the caustics' two per-fragment `snoise3`) by substituting scrolled reads of
  the tiled field (Wave 4).
- **Per-fragment analytic finite differencing** — MEASURED forbidden (7.5 ms of an 11.6 ms
  frame).
- **Committed photo textures (PolyHaven/KTX2)** — the plumbing exists (winter precedent,
  neon-district loader) but the installer is already 175 MB over budget, the file's "no
  imported assets" purity is worth keeping, and the winter lesson says photo albedo does
  not fit unlit scenes anyway (luminance-tooth only). Runtime bakes can author every
  channel this plan needs. Revival: only if a bake demonstrably cannot reach a look (D5).
- **Geometry terracing of the height bake** — reshaping the heightfield moves every
  scattered tree and every waterline; the strata SHADING buys the banded read without
  touching the world's shape. Parked in Wave 6 with a narrow scope (bench-quantising only
  slopes > 0.55 in the relief bake) if shading alone fails the G5 decile test.

## 4. Target look (hard rules; every capture is judged against these)

1. Vegetation/sand shade preserves chromaticity and sat at luma ×0.5–0.57; rock shade
   desaturates toward warm-mauve; deep shade ×0.27–0.32 red-enriched. NEVER blue-black,
   never a plain scalar multiply (G1).
2. Lit sat: grass/sand in the 0.56–0.79 band, rock 0.10–0.38, on the graded rig (G2).
   Authored albedos overshoot; verdicts only on the rig.
3. Every hero frame keeps a value ladder: path/white-rock class surfaces ≥1.6× grass
   luma; wet ground 0.5–0.7× its dry neighbour (G3).
4. Flat fills stay TIGHT (±5–12 luma within a patch); detail expresses as patch-to-patch
   variegation (metre scale, G6/G10) and boundary structure — never as uniform noise (G4).
5. Rock reads as 2–3 discrete value bands per face (±30–45), warped, slope-masked; the
   DECILE HISTOGRAM of a captured cliff is the pass/fail instrument (G5/G10).
6. Boundaries: biased, perturbed, with a 1–2 m darker+warmer edge accent on the grass
   side; ecotone patches over a wide band, never a 50/50 smear (§1.10).
7. Distance: detail melts to macro BEFORE aerial dominates; far ground pre-desaturates
   toward the aerial hue (blue by day — G7), so the mid-field reads as clean painted
   masses. The Sable law: the distance gradient IS the style in an unlit world.
8. The macro paint owns colour at every distance — detail is mean-transparent
   (Wolfire division) and may never shift a region's read (§1.2).
9. Two-mass light: narrow terminator, mid-tones on the lit side only; shadow-side value
   converges toward one dark band while hue keeps materials apart (G8).
10. One owner per measured ratio (the forest's one-owner law): the shade ratio lives in
    the shadow model, patch variegation in the moisture field, band structure in the
    strata term — no term may duplicate another's job, enforced where cheap by
    renormalisation.

## 5. Waves (every gate MEASURED on Lane B via `--low-power`, counters-verified quiet; ADR-0016 admissibility throughout)

### Wave 0 — price the ground, probe the paint (nothing ships)

The ground fragment stack (2 bump fetches, snow-jitter fetch, curvature, grain, biome
mixes, 2 per-fragment snoise3 caustics, alpenglow) has NEVER been priced — the same
"nothing could switch it off" gap the water, clouds and forest each had before their
Wave 0s. Per ADR-0016 an unmeasured cost cannot fund a package.

- **0a — the lever.** `?odysseyWorldFlatGround=1` → renderer option `flatGround`. The
  DECK's asymmetric shape applied to the fragment stage: same clipmap geometry, same
  `positionNode`, same draws/tris (content-match passes by construction) — `colorNode`
  swapped to the minimal graph `toOutput(applyAerial(constAlbedo × (ndl·sunVis·0.92+0.06)
  × sun + shadow, posW))`. This prices FRAGMENT fetches+ALU only — exactly what the
  overhaul spends against. Caveat recorded in the cell, same as the deck's: pipeline
  compile stays on both sides — a floor, not a ceiling.
  gpu-split config `flat-ground`; `groundFragMs: delta('baseline','flat-ground')`
  (cost = baseline − configuration for a REMOVE lever; argument order carries the sign).
  Lever test in the `odyssey-forest-lever.test.js` pattern: polarity, default-off,
  behavioural (colorNode graph differs), dead-lever sweep.
- **0b — the pair.** `--seek 0.225 --chapters 2,3 --only baseline,flat-ground,
  baseline-repeat` in one thermal window, then the same at p=0.42. Ledger cell
  `odysseyAct2GroundFragMsLaneB` (baseline null until the pair lands; drift-judged).
- **0c — ✅ DONE 2026-08-14: the reference bar.** §1b measured by the workflow's
  measurement agent from the five refs on disk.
- **0d — the free-tier probe (playground, screenshot-judged).** On the graded rig
  (`act2-cloud-deck.effect.js`, `?worldOnly=ground`… flag added if needed): prototype
  ONLY Layer 3's ALU items + a faked moisture field (the snow-jitter fetch's unused
  `.rg`) — two-model shadow, edge accents, strata bands, wet band — against refs 1/2/4
  split-screen. No bake changes yet. Primes **D0**: does the free tier visibly kill the
  playdough read at the three stations (p=0.225 shoreline, p=0.34 meadow, p=0.42 massif)?

**Gate G0:** the pair is admissible (drift ≤ 0.033) and `groundFragMs` lands. Every later
wave's budget arithmetic uses this number. Nothing ships in Wave 0.

### Wave 1 — the bakes become the painter (Layer 1; 0 new fetches)

- Widen `bakeSunVisibility` output to RGBA16F: R sunVis (byte-identical semantics — water
  untouched), G wide-AO (two radii from the CPU relief mirror; boot-time bounded — reuse
  the existing 42-step march infrastructure, budget the bake in the loading ledger),
  B moisture/exposure field, A wear/accent (tide line at mean waterline; contact discs
  under the 8 authored framing trees; journey-trail only if D-path says yes).
- Fragment: grass/sand/rock each become a 2-colour lerp driven by B (lush↔dry, damp↔pale);
  G multiplies as wide occlusion (replacing nothing — `cavity` keeps the small scale,
  one-owner: AO owns >8 m, cavity owns <8 m); A's tide line tints sand, discs darken
  contacts.
- The 175 u sin×cos plaid DIES here (one-owner law: patch variegation now has a real
  owner; a second grain system may not survive alongside it).
- Tests: bake determinism, RGBA widening keeps `.r` exactly (a pixel-compare against the
  pre-widening bake at fixed seed), moisture field range/normalisation, tide-line lands at
  the waterline ±2 u, boot-time budget assert (the cold start is already a known sore).
- Capture set: three stations on the graded rig, A/B against Wave 0 baseline captures
  (⚠️ baselines go stale fast — re-capture from the same tree).

**Gate G1:** pair vs pre-wave baseline — expected ≈ 0 (same fetch count; new ALU is a few
lerps). Hard bound: +0.2 ms at p=0.225. Screenshot: G6/G10 patch variegation visible at
the meadow station; G3 ladder present. Primes **D1** (the zone/palette read).

### Wave 2 — material identity (Layer 2; the ONE priced fetch)

- `bakeGroundAtlas` → `groundTex` 256² RGBA16F, RepeatWrapping, mipmapped (the existing
  detailTex has no mips — the atlas must, or the far field shimmers; generate the chain
  explicitly at bake). Channels per §3 Layer 2. Bake reuses `odyssey-tiling-noise.js`
  (integer cell counts — and the tiling TEST compares texel 255 against texel **0**, the
  bake-tiling trap on file). Directional streak character per biome (stretch along a bake
  flow field: radial wobble for grass, downhill for rock strata, shore-parallel for sand).
- Fragment: ONE fetch at world/22; per-biome channel select; Wolfire mean-transparent
  application `albedo × mix(1, tile/avg, toothAmp)` with per-biome toothAmp; the A channel
  biases the biome blends (height-blend boundaries) and jitters the strata bands.
  Distance-melt envelope folds toothAmp→0 by footprint BEFORE the aerial ramp (rule 7).
- The edge-accent band (Wave 0d's ALU version) upgrades: blend factor modulated by the
  tile so the boundary line is textured, not gradient mush (Alba's transition trick).
- detailTex is NOT touched (five consumers + the cloud histogram contract — a rebake is a
  correctness risk the plan refuses).
- Tests: atlas tiling (255 vs 0), mean-transparency (avg of `tile/avg` ≈ 1 per channel to
  1e-3 — the Wolfire invariant as a unit test), mip chain exists, stage discipline (atlas
  UV from `positionWorld.xz`, never fragment-recomputed floors — the underside-squares
  class), height-blend polarity (sand fills between tufts at the boundary, checked on a
  synthetic strip).

**Gate G2:** the pair prices the fetch: `--only baseline,flat-ground,baseline-repeat`
before/after, or directly baseline-vs-baseline across the wave at both stations. Budget
position: shoreline margin is 0.70 ms — the atlas expects to land ≤ 0.3 ms (one 256²
mipmapped fetch, near-field-weighted by the melt). Over 0.3 ms → **D2** decides (accept /
shrink to the free `.b`-tooth fallback). Screenshot: G4 tight fills + G6 grammar at the
meadow; no visible tile repeat at any station (else the hex-tiling road re-opens — §3).

### Wave 3 — rock, mountain, snow (the vertical world)

- Strata: quantised worldY bands (2–3 steps, ±30–45 luma equivalent authored, warped by
  the atlas G field and the snow-jitter fetch's low-freq read), slope-masked to cliff
  faces; per-band slight hue shift (warm toward crests — G5's bounce observation).
- Curvature upgrade: `gully/crest` from a value multiply to the 2-colour lerp (warm crest
  light / cool cavity shade — but per G1, rock's cool is DESATURATED mauve, not blue).
- Optional (priced): slope-masked single cliff projection — ONE extra atlas fetch at
  UV=(dominant horizontal axis, worldY) blended by slope, so cliff strata stop stretching.
  Unconditional fetch, no divergent branch (610M rule). Only if the top-down projection
  visibly smears on the massif capture; primes **D3**.
- Snow: 3-zone (warm lit / ice-shadow `#a9c4e2`-class / rock-through-thin via height-blend
  at the snowline), ragged snowline (already jittered — widen the jitter's spectrum with
  an atlas read), rim `pow(1−NdV,4)` cool lift, alpenglow kept as-is (it already obeys the
  wSnow ownership rule). Sparkle: PARKED to Wave 6 (view-dependent; near-field only).
- Mountain composition: verified from the SPLINE camera at p=0.42 and p=0.50 (the forest's
  law: review from the rail, not the rig's free camera).

**Gate G3:** pair ≤ +0.2 ms beyond whatever D3 accepts for the cliff fetch; the G10 decile
histogram on a captured massif face shows 2–3 flat steps (the instrument, not a vibe);
G7 aerial check at the far-mountain station.

### Wave 4 — the living ground + the reclaim

- Wind-sweep bands: lit-side lighter bands travelling through the static moisture/tooth
  fields by time-varying phase (`sin(uTime·w + field·2π)` shape — the forest `fvWindLine`
  trick, zero fetches). Subtle: ±4–6% luma, grass only, melts with distance like all
  detail. Motion IS capture-verifiable on the rig (bit-identical at fixed `?t`).
- Wet-sand band: `smoothstep` above the waterline, ×0.5–0.7 luma + slight sat lift (G3),
  breathing with the water system's existing wave phase uniform (same file — shared
  uniform, no new plumbing).
- **The caustics reclaim:** the graph's only per-fragment procedural noise (2× `snoise3`,
  ~line 1313) is substituted with two scrolled reads of the existing tiled field
  (detailTex `.b` at two counter-moving UV offsets) — same min()/remap shape, the 6.5 ms
  law's substitution direction. Prices as a NEGATIVE delta; whatever it returns funds the
  wave. A/B capture of the submerged shelf guards the look (the min-of-two-fields web
  must survive).

**Gate G4:** net wave delta ≤ 0 (the reclaim pays for the shimmer ALU). Shoreline pair +
submerged-shelf capture.

### Wave 5 — distance discipline, integration, re-baseline

- Ordering pass: assert (and capture) that detail terms melt before aerial dominates;
  far pre-desaturation toward the aerial hue ahead of the aerial mix (the forest's
  FAR_PRESAT precedent, ground edition); dusk/act-light checks if applicable.
- Forest↔ground integration: the framing trees' contact discs (Wave 1 A channel) verified;
  grass patch hue under gold-birch stands leans warm (moisture field seeding by zone —
  cheap CPU at bake); shoreline: beach reads via its EDGE (the grass-lip accent + tide
  line), per the Witness beach observation.
- Full journey in-game captures per chapter (short sessions — the TDR constraint), the
  three stations re-shot, all four Act II Lane B cells re-measured and re-baselined; seam
  cell especially (14.94/17.0).
- Docs sweep per the closing-docs law: verify claims AT the claim, mechanical check last.

**Gate G5 (the ship gate):** shoreline p95 ≤ 10.6 (cell max), seam ≤ 17.0, p=0.42 station
within its owner-accepted envelope; §4 rules checked line-by-line against the final
captures; the G-bar table re-measured on OUR captures and appended to this doc.

### Wave 6 — parked, priced, owner-gated (revival conditions attached)

| Item | Price expectation | Revival condition |
|---|---|---|
| Opaque grass clump ring (camera-following, no alpha) | geometry-tier; ~0.8 ms/100k tris law | near-field grass still reads flat after Waves 2+4 |
| Instanced rock outcrops on ridgelines | same law; small counts | massif silhouette still smooth after Wave 3 (Witness: steep = meshes) |
| Hex-tiling on the atlas | 3× atlas fetch | visible tile repeat in a capture |
| Snow sparkle (view-dep glint) | ~1 small fetch + ALU, near-field | owner wants it after seeing Wave 3 snow |
| Bake terracing of slopes > 0.55 | bake-side; moves nothing below the slope gate | G10 histogram fails on shading alone |
| KTX2 committed tiles | git bytes; installer over budget | a bake demonstrably cannot reach a look (D5) |
| Journey-trail wear line | one bake channel already reserved | D-path |

---

## 5b. OUTCOMES — what the waves actually did (2026-08-15)

Every number here is from a capture or an admissible pair taken during implementation. Where
the plan was wrong, the wrong version is kept beside the correction: a plan that quietly
rewrites its own predictions teaches nothing the next time.

### Wave 0 — the lever, and the first price

- `?odysseyWorldFlatGround=1` shipped exactly as designed: same clipmap, same `positionNode`,
  same 52 draws on both sides, `colorNode` swapped for a constant albedo under the baked sun.
  Captured (`artifacts/ground/lever-flatground.png`) so the withheld half can be SEEN, not
  only timed — a lever whose visual effect nobody has looked at cannot be sanity-checked.
- **`groundFragMs` = 2.49 ms** — 25% of the shoreline station's whole frame, and the first
  time this surface has ever been priced. Pair: baseline 9.83, flat-ground 7.34,
  baseline-repeat 9.83, drift EXACTLY 0.000, draws 52/52/52, one thermal window, Lane B
  `--low-power --seek 0.225 --chapters 2,3`. Caveat recorded in the cell: pipeline compile
  stays on both sides, so this is a floor.

### Wave 1 — the bakes became the painter

- `bakeSunVisibility` widened to `bakeGroundSunFields`, R byte-identical (guarded by a test
  that recomputes the legacy 42-step march and compares halves — the water reads the same R).
  G = wide occlusion at two radii, B = moisture, A = the zone field.
- **THE DEFECT THIS WAVE ALMOST SHIPPED.** All three authored fields computed correctly and
  came out useless: occlusion p10 0.965 on land (a term doing nothing at all), moisture
  p10 0.687 / p50 0.920 (the whole island inside one decile), zone spanning 0.742..0.918. A
  flat field throws nothing and breaks no build — it silently deletes the feature it was added
  for. Fixed by giving the TERMS the ordering and a land-percentile STRETCH the range, the same
  instrument the cloud silhouette uses. Now: moisture 0.120/0.578/0.909, zone 0.136/0.598/0.898,
  AO 0.642/0.752/0.888 (all p10/p50/p90 over land). Guarded by a test that fails on a flat field.
- Corollary worth keeping: **once a field is percentile-stretched, changing its terms uniformly
  is a no-op by construction.** Rebalancing the moisture constants moved the massif station by
  almost nothing; only the dryness WINDOW changes how much of the island reads dry.
- The 175 u sin x cos grain plaid was deleted (one-owner: variegation belongs to moisture).

### Wave 2 — the atlas, and the grammar it first got wrong

- `bakeGroundAtlas` ships at 256^2 RGBA16F: grass strokes, rock fracture, sand ripple, shared
  tooth, applied `albedo * tile / avg` (the Wolfire division The Witness adopted), melted to
  pure macro paint by camera distance.
- **THE TILING TEST NEEDED A SECOND AXIS.** The grass and rock channels are anisotropic
  (strokes stretched by integer factors), so the field steps ~5x faster along the stretched
  axis. Judged against the wrong axis's interior step, a perfectly closing tile reports a
  0.33 seam against a 0.09 interior — which is exactly what the first probe said. Per-axis
  comparison shows every channel closing.
- **The grass strokes first shipped as CORDUROY** — one stretch direction across the whole
  meadow, where the painting guides say strokes go in "varied angle/direction". Fixed with two
  perpendicular stroke fields chosen between by a low-frequency mask.
- **And the amplitude was the wrong grammar entirely.** The bar records TWO grass languages:
  Firewatch alternates 2.5-3x inside one patch, Witness is FLAT to +-7 luma with all its
  interest in metre-scale patch hue. The first cut ran Firewatch's amplitude (0.46) on top of a
  patchy moisture field and got neither — the massif station read as mottled smudge. The Witness
  is the stated target, so the tooth is quiet (0.18) and the patches speak.

### Wave 3 — rock, and a term that was alive and invisible

- Strata, curvature two-colour, three-zone snow and the snow rim all shipped.
- **STRATA SHIPPED INVISIBLE FOR THREE CAPTURES.** Not weak — invisible, at a value step that
  should have been obvious. Found by DEBUG-SHADING the ground to `vec3(strataAmt, slope, kRock)`
  rather than by tuning amplitudes: the bands were alive and correctly scaled, but the slope
  window opened at 0.26 while rock itself starts appearing at slope 0.17, so every banded
  fragment was also snow-covered summit. The gate now opens below the slope where rock becomes
  visible, and a test pins that relationship rather than the number.
- The second half was amplitude: 0.16 measured as no band at all. At 0.36 the massif face
  measures a 23-luma range with real oscillation across a stacked-box ladder, against a smooth
  13-luma gradient before. (Bar: 30-45. Partly sampling — the boxes average across bands.)
- Measurement note: the first strip that reported "no bands" was sampling SKY, not rock. A
  metric samples one place; a defect picks another.

### Wave 4 — the living ground and the reclaim

- Wind-sweep bands (phase through a static field, zero fetches), the wet-sand band, and the
  caustic reclaim: the graph's last two per-fragment `snoise3` calls became ONE scrolled fetch
  reading two decorrelated channels, per the file's own 6.5 ms header law. The `.a` channel is
  histogram-matched to a narrow band and is stretched back to full range before the `min()`,
  or it would win every minimum and flatten the web.

### Wave 5 — distance discipline, and THREE terms retired for measuring negative

- **Far pre-desaturation: RETIRED.** It measured negative twice. At 0.62 it took the distant
  peak from sat 0.183 to 0.028; talked down to 0.84 it still cost 0.07 of saturation against a
  bar that says a hazed mountain keeps 0.25-0.53. The reason is structural — the pull is toward
  the fragment's own LUMA (grey) while G7's measurement is that distance desaturates toward a
  HUE. Aerial perspective already does the hue version and the detail melt already does the
  clean-masses half. A term that measures negative twice and duplicates two terms that measure
  positive does not ship.
- **The wide-AO multiply: RETIRED.** Occlusion now reaches the image only through the
  per-material `ambient`, which darkens the sky fill occlusion actually blocks and leaves
  direct sun alone. Both together drove a hollow in shadow to 0.195 against the measured
  0.27-0.32 band, and dimmed sunlit hollows the sun plainly reaches.
- **The 7.5 u detail-bump octave: RETIRED, and this is the wave's headline.** The atlas tiles
  every 22 u with marks down to ~2 u, so the octave had become a second owner of the same
  frequencies. A/B captured at the CLOSEST-ground station (p=0.42), where a fine octave should
  matter most: **0.00% of pixels changed, mean |delta| 0.06/255** — and every G-bar metric
  identical to three decimals. It cost **0.99 ms** of the fragment stack (groundFragMs
  3.48 -> 2.49). An inert term at 40% of the whole stack's price, and the reason this overhaul
  lands at net +0.13 ms instead of the +1.05 ms its first cut measured.

### Boot time — the second ledger, measured

The plan said every bake addition carries a load-time assert because cold start is a standing
complaint. Measured in isolation (CPU only, deterministic, 512² plate):

| | ms |
|---|---|
| legacy sun march alone (what this replaced) | 77 |
| four-field plate, ring sampling at FULL resolution | 244 |
| four-field plate, ring sampling at HALF resolution (ships) | 191 |
| tiling atlas | 22 |
| **net added to boot** | **+136 ms** |

The halving is not a corner cut but a statement about what the fields are: openness and
moisture are built from rings spanning 9 u and 64 u, so nothing they can express varies faster
than a coarse grid samples it. The sun channel stays at full resolution because a shadow edge
is a discontinuity and those alias. The land mask also stays full-resolution on purpose — it
gates the percentile stretches, and a coastline smeared across two coarse texels would let
ocean values into the land statistics.

Verified: field deciles moved by <0.02, the shoreline capture by 1.90% of pixels at mean
|delta| 1.07/255, and the G-bar ladder actually improved from 1.644 to 1.667 (into the bar).

### The light model — three cuts, and why the third is Lambert

Worth its own entry because two plausible readings of the reference bar both measured worse
than the shipped graph they were replacing:

| cut | shape | massif shade:lit | verdict |
|---|---|---|---|
| shipped (before) | linear `ndl*0.92 + 0.06` | 0.581 | inside the band, floor far too dark (0.06 vs 0.27-0.32) |
| 1st | `smoothstep(0.015, 0.34, ndl*sunVis)` | **0.821** | mountain lost its shadow side entirely |
| 2nd | narrow window + separate lit ramp | **0.80** | same failure one step out |
| 3rd (ships) | S-shaped Lambert + per-material ambient | **0.565** | in band, form intact |

The mistake the first two shared was treating the measured ratio as something a REMAP has to
produce. It is not: plain Lambert already produces it — a face at ndl 0.35 beside one at ndl
0.70 is half as bright, which IS the measured band. What the shipped graph had wrong was only
the floor. The Ghibli two-mass law survives as the S-curve's shoulders; the hard gate a painter
can draw by hand and a heightfield cannot does not.

### The G-bar, measured on our own captures (shoreline station, graded rig)

| metric | before | after | bar |
|---|---|---|---|
| G3 value ladder, rock/grass | 1.16 | **1.64** | 1.65-2.1 |
| G1 shade:lit on the massif | 0.581 | **0.565** | 0.43-0.61 (mineral) |
| G2 lit grass saturation | 0.399 | **0.736** | 0.56-0.79 |
| G2 lit rock saturation | 0.086 | **0.104** | 0.10-0.38 |
| G5/G10 massif band range | 13 luma (smooth) | **23 luma, oscillating** | 30-45 |
| G7 distant peak saturation | 0.183 | 0.144 | 0.18-0.53 — SHORT, see below |

Two rows are honest misses. **G7** (distant peak saturation) sits 0.036 under its band: the
strata and tooth terms reach further than the aerial ramp expects, and the fix is a distance
gate on strata rather than another saturation term — parked, not forgotten. **G5** lands at 23
against 30-45, part sampling artefact (the measuring boxes average across bands) and part
genuine. Both are named here so a later session can pick them up as measurements rather than
as impressions.

### Also changed, outside the waves

- **The beach became a BAND.** The shipped sand ramp spanned 24 u of height, which on a flat
  shoreline plain made half the meadow sand — measured when darkening the grass palette by 38%
  moved that plain's screen luma by 1.6%, because it was barely grass. 11 u of height is a
  beach a person could walk across.
- **Grass is the island's mid-dark anchor now.** It screened at 1.15x the massif's luma when
  the references hold pale rock 1.65-2.1x ABOVE grass; the ladder was nearly inverted, which is
  why the island read as one pale mass whatever its hues did.
- `artifacts/ground/` holds the capture trail: `w0-before-shoreline` (pre-change),
  `w1..w8` (the iterations, each named in the notes above), `lever-flatground`,
  `dbg-strata`/`dbg-strata2` (the debug shades), and the in-game
  `artifacts/odyssey/wave-v/chapter-03-high-webgpu/`.

---

## 6. Budget position (the numbers the plan stands on)

| Cell | baseline | max | margin | relevance |
|---|---|---|---|---|
| `odysseyAct2ShorelineGpuP50LaneBMs` (p=0.225) | 9.896 | 10.6 | **0.70** | the ground-facing hero station; forest is 3.08 of it |
| `odysseyAct2SeamGpuP50LaneBMs` (p=0.105) | 14.94 | 17.0 | 2.06 | both worlds draw at once |
| `odysseyWorldGpuP50LaneBMs` (p=0.42) | null (measured 9.896/10.49) | 7.0 | **−2.9** | already over its aspirational max; owner-blocked §7.1 |
| `odysseyAct2GroundFragMsLaneB` | NEW, null until Wave 0b | TBD | — | the funding instrument |

The arithmetic: the plan's core (Waves 1, 3, 4, 5) is designed to ≈ 0 new fetches with the
caustics reclaim as negative ballast; the single planned addition is Wave 2's atlas fetch
(expected ≤ 0.3 ms, priced before acceptance) and optionally Wave 3's cliff projection
(same shape). Anything beyond that is Wave 6 and owner-gated with its own pair — the
forest's D5/D6 pattern: a budget history that is a sequence of signed decisions, not drift.
Boot-time is a second ledger: every bake addition carries a load-time assert (cold start is
a standing complaint; the bakes must stay a small slice of it).

## 7. Owner decisions

**All of D0-D4 were taken against captures during the 2026-08-15 implementation session,
under a standing instruction to iterate and decide rather than wait for a gate. Each one
below records what the decision was taken ON — a picture, a pair, or a number — so it can
be re-opened against the same evidence.**

- **D0 — TAKEN.** The free-tier probe was never run in isolation: the bakes landed first
  and the whole stack was judged together, because the ALU terms turned out to depend on
  the moisture field the bake supplies (a flat field makes the two-colour lerps no-ops).
  Verdict from the captures: yes, the playdough read is gone — the ladder moved 1.16 to
  1.64 and grass saturation 0.399 to 0.736, both against a before/after pair at the same
  station and time.
- **D1 — TAKEN.** The zone read ships as green-with-golden-patches. Two intermediate
  answers were rejected on captures: all-gold at the massif station (the first dryness
  window, which put every visible slope on the dry pole and gave the frame one hue family
  with the autumn forest on top of it), and mottled-smudge (the Firewatch tooth amplitude
  over a patchy moisture field).
- **D2 — TAKEN, and it PAID FOR ITSELF.** The atlas fetch ships. It was not accepted on a
  budget concession: the wave that added it also retired the 7.5 u bump octave it made
  redundant, and that trade is 0.99 ms recovered against roughly 0.4 ms spent. The 0.70 ms
  shoreline margin the plan called “the wall” was never crossed at ship: net +0.13 ms.
- **D3 — TAKEN: NO cliff projection.** The extra fetch was never needed — top-down strata
  do not visibly smear on the massif at rail distance, so the condition the plan attached
  to this decision was not met. Rock identity comes from the strata bands and the two-model
  shadow instead. Revival condition unchanged: a capture showing stretched marks on a cliff.
- **D4 — TAKEN: SHIP.** §4's rules were checked line by line against the final captures
  (§5b's table). Four of six G-bar rows land in band, two are short and named rather than
  hidden. The Lane B gate passes with 0.57 ms of headroom at p95.
- **D5 — DECLINED, as the plan defaulted.** No committed KTX2 textures. Nothing in the
  overhaul needed one: every channel it wanted was reachable from a runtime bake, and the
  installer is 175 MB over budget already.
- **D-path — DECLINED for now.** No journey-trail wear line. The A channel that would have
  carried it went to the zone field instead, which the captures showed was the more
  load-bearing of the two (regional hue drift is visible at every station; a trail is
  visible only where the rail runs). Reopening it costs one bake channel, not a redesign.

**Still open, for whoever picks this up next** (both are measurements, not impressions):

- **G7 — the distant peak sits at sat 0.144 against a 0.18-0.53 bar.** The strata and tooth
  terms reach further than the aerial ramp expects. The fix is a distance gate on strata,
  not another saturation term — and it should be measured, since the last two terms added
  to “fix” far saturation both measured negative.
- **G5 — the massif band range is 23 luma against 30-45.** Partly a sampling artefact (the
  measuring boxes average across bands, so the instrument understates), partly real.
  A finer stacked-box ladder would separate the two before anything is tuned.

*(The pre-implementation wording of these decisions is preserved below.)*


- **D-ref (optional, any time):** the five refs cover every named surface; if the owner
  wants a specifically GHIBLI meadow/path target (Totoro/Oga board), drop it as
  `act2-ground-ref1.png` and Wave 0c's bar gains a row.
- **D-path (Wave 1):** does the island carry a visible journey-trail wear line under the
  rail (the Witness "people walked here" statement, ~1.2× ground luma per G3)? Bake
  channel is reserved either way.
- **D0 (primed by Wave 0d):** does the free-tier ALU probe kill the playdough read at the
  three stations? No → the plan re-sequences (bake-first instead of ALU-first) before any
  budget is spent.
- **D1 (primed by Wave 1):** the zone read — moisture-field palette poles per biome
  (lush/dry grass hues, damp/pale sand, warm/cool rock) judged at the three stations on
  the graded rig against refs 1/3/4.
- **D2 (primed by Wave 2's pair):** the atlas fetch at its measured price — accept, or
  fall back to the free `.b`-tooth tier. The 0.70 ms shoreline margin is the wall.
- **D3 (primed by Wave 3):** the cliff projection fetch (only if top-down strata visibly
  smear), and the rock language verdict against G5/G10's decile instrument.
- **D4 (Wave 5):** the ship gate — station table in hand, §4 rules line-by-line.
- **D5 (only if reached):** committed KTX2 texture assets vs the file's no-imported-assets
  purity — default NO (installer over budget; winter's luminance-law says photo albedo
  doesn't fit unlit anyway).
- **D6 (Wave 6, per item):** each parked item's pair → accept/reject, forest-style.

## 8. Files

| File | Change |
|---|---|
| `src/rendering/odyssey/world/odyssey-world-renderer.js` | ground slot only: `flatGround` option + minimal colorNode branch; `bakeSunVisibility` RGBA widening; `bakeGroundAtlas` NEW; fragment graph Layers 1–3; caustics substitution. No new NodeMaterial — lint lists unchanged |
| `src/rendering/odyssey/world/odyssey-ground-lever.test.js` | NEW — flat-ground polarity/default/behaviour + gpu-split sign (forest-lever pattern) |
| `src/rendering/odyssey/world/odyssey-ground-palette.js` | NEW (SHIPPED) - the measured palette, shadow models, strata and distance windows as a table |
| `src/rendering/odyssey/world/odyssey-ground-bakes.test.js` | NEW — bake determinism, `.r` byte-compat, atlas tiling (255 vs 0), Wolfire mean-transparency invariant, mip chain, tide-line placement, boot-time bound |
| `src/rendering/odyssey/world/odyssey-world-lints.test.js` | stage-discipline assert for atlas UVs (positionWorld, no fragment floor()) |
| `src/rendering/odyssey/OdysseyBoardController.js` | `odysseyWorldFlatGround` flag (opt-in, measurement-only) |
| `scripts/odyssey-gpu-split.mjs` | CONFIGURATION `flat-ground`; `groundFragMs: delta('baseline','flat-ground')` |
| `perf-budgets.json` | `odysseyAct2GroundFragMsLaneB` (tracked, null baseline until Wave 0b); re-baselines at Wave 5 |
| `src/playground/effects/act2-cloud-deck.effect.js` | `?worldOnly=ground` filter value (rig unchanged otherwise) |
| `docs/ODYSSEY_ONE_WORLD_PLAN_2026-08.md` | pointer to this plan at the ground/biome section |

**Standing constraints carried whole:** playground-first with screenshot proof (CLAUDE.md;
one small effect per session — the TDR history); colour verdicts ONLY on the graded rig
(authored albedos overshoot); gpu-split numbers admissible only under ADR-0016
(drift-judged pairs, quiet machine, counters verified — same-bucket means "below
resolution", never "zero"); `material.fog` untouched (no new materials, but the
4×-recurring trap is watched anyway); `texture(...).level(0)` in any positionNode; shared
`.toVar()`s root-pinned at Fn top (the r181 first-build-site trap); detailTex is
five-consumer shared state and is NOT rebaked; the world build stays non-throwing (a throw
silently downgrades Act II to dioramas); review compositions from the SPLINE camera.

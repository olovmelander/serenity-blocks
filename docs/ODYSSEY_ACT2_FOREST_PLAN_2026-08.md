# Act II Forest — the painted island (2026-08)

**Goal.** Replace Act II's single-species programmer conifer (one 30-tri cone-stack repeated
15,427 times) with a SMALL AUTHORED ROSTER of sculpted, opaque, Witness-grade tree species —
hue-zoned across the island, painted with a 2–3-band Ghibli ramp on blob normals, moved by
travelling gusts — at ≈ net-zero Lane B cost, funded by the forest's FIRST-EVER measured
price (it has never been gpu-split priced) and a load-bearing LOD + bucketing discipline.
The forest keeps its proven plumbing: chunked InstancedMeshes, CPU visible gates, one
pipeline, scatter on the CPU height mirror. What changes is geometry, paint and scatter —
the three things every reference says carry the look.

**Provenance.** 2026-08-14: 8-agent research workflow (5 cited online sweeps — the-witness.net
devlog + Luis Antonio's GDC 2014 slides read first-hand, Jane Ng's GDC/NYU talk transcripts
pulled from captions, the fluffytree repo source, a TSL-feasibility technique survey, a
Ghibli/Oga art-rules distillation — plus 3 repo deep-reads: current system, prior art,
harness/ledger). Transcripts: `~/.claude/.../subagents/workflows/wf_73636721-8f0`. Reference
images: the owner's three screenshots (Firewatch backlit conifers; The Witness village
variety; The Witness lake zones) — to be dropped as `public/playground-refs/act2-trees-ref{1,2,3}.png`
(§7 D-ref). This plan lives alongside
[ODYSSEY_ACT2_CLOUD_FIELD_PLAN_2026-08.md](ODYSSEY_ACT2_CLOUD_FIELD_PLAN_2026-08.md) and
reuses its measured laws; it touches the same file (`odyssey-world-renderer.js`) but a
disjoint slot (the `── forest ──` section).

---

## 1. What the research established (cited; the design rests on these)

1. **The Witness's canopy is "a ton of triangles sitting in a bowl"** (Shannon Galvin,
   the-witness.net 2011-06) — the bowl "simplif[ies] the bottom and hide[s] the triangle
   nature of the triangles". The technique PREDATES their alpha support: the tree read as
   leafy from **silhouette + colour alone, with zero alpha**. Poly budget: a 40k-tri hero was
   rejected, 12k was "too heavy", shipped ~6k which "looked better up close" — leaf-plane
   density saturates fast. The solid simplified underside is load-bearing.
2. **The smooth painted-blob shading is edited normals, not lighting tech**: canopy normals
   are transferred from an enclosing blob so the whole crown lights as one convex mass
   (polycount/habrador reproductions of the shipped look; Witness posts name the
   `normal_thief` workflow). The same trick is named independently by BotW/Europa foliage
   analyses, by Alba (ustwo shipped a whole game with ZERO normal maps — "normal transfer
   from smooth temporary meshes"), and by every community Ghibli-tree recipe (Lightning Boy,
   Mistwork, Kids With Sticks, aVersionofReality, Alisavakis). **It is the single
   non-negotiable trick, and it works identically on opaque geometry.**
3. **Witness colour design = hue zoning at the island scale.** Palettes were painted over
   greybox screenshots FIRST ("Autumnal / Desert / Foresty"); the mechanism is ONE painted
   2048² colour map over the whole island (they abandoned multi-layer blend mapping);
   species identity is the SQUINT TEST — "a birch is a yellow body with splotches"; trunk
   colour + canopy hue + silhouette, details deleted. Species come as sets of ~3 growth
   stages (Orsi Spanyol). Pines must avoid Christmas-tree regularity — saggy, irregular
   branches. And the GDC vegetation slides' reference images are **literally Ghibli/Shinkai
   background paintings** — "Witness + Ghibli" is one lineage, not two targets.
4. **Firewatch is the roster law**: 23 hand-made trees, ~14 workhorses + 9 specials + one
   one-off, placed ~4,600 times, **rotation-only variation** ("you don't even scale it that
   much"), repetition hidden by density. "If you can get away with 23 trees, don't make 25"
   — every asset gets retouched 1–2× in production, so roster size is iteration cost.
   Authoring is **silhouette-first**: detail budget goes to the lower-branch band at eye
   level; everything above is distant-silhouette work.
5. **Firewatch's "puffing" is silhouette inflation, not intrinsically alpha**: the foliage
   shader lowers the alpha-test cutoff with camera distance so ragged edges fuse into solid
   graphic blobs. On an opaque stack the same read is distance-driven vertex inflation
   along normals and/or a blobbier far LOD. Its colour layering is "stylistic fog" — a
   depth-indexed RGBA colour strip (two strips blended by view·sun at sunset) — which in
   this world is `applyAerial`'s job; fog also *flattens* distant texture noise ("which is
   actually what we want").
6. **The Ghibli value structure (Oga)**: a canopy is split EARLY into a lit crown mass and a
   dark interior mass, 2–3 value steps total; the dark mass is **sky-occlusion, not N·L**
   ("blocked from the light of the sky"); shadows stay **saturated and shift cool**
   (blue/teal), never desaturated black; highlights shift warm toward sun-yellow; dapple is
   sparse, placed at the terminator, added LAST. Motion is clump-level and tiny; wind reads
   as waves crossing the forest (phase by world position) — never per-leaf noise, never
   silhouette boil.
7. **The fluffytree look the owner loves decomposes cleanly — source read line-by-line**
   (leoawen/fluffytree-threejs: one 584-line index.html, three r164 WebGL, **MIT** — the
   shader logic may be copied outright with attribution; geometry is a committed 11.8 MB
   Blender GLB, ~2,937 alpha-tested quads PER CANOPY BLOB, 20k+ tris per tree). The colour
   comes from NEITHER mesh normals NOR the texture: the fragment shader computes an
   **analytic sphere normal** `normalize(worldPos − uTreeCenter)`, dots it with the sun,
   and drives a **3-stop ramp** — shadow `#001d33` (near-black BLUE-TEAL, not dark green) →
   lit saturated green via `smoothstep(−1.0, 2.7, d)` → warm chartreuse highlight via
   `smoothstep(0.5, 1.8, d)`. **The ramp ends extend far OUTSIDE the dot's [−1,1] range —
   the gradient never saturates, and that over-extension is the single most important
   tuning decision** (the softness that reads airbrushed instead of CG). Real normals are
   overwritten to constant world-up so Lambert contributes nothing; the leaf texture is
   alpha-ONLY (silhouette fringe, zero colour). Verdict: **steal the shader, not the
   geometry** — the ramp + analytic sphere normal port losslessly to opaque lobed hulls
   (per-instance centre as an attribute — literally the cloud field's `aMassCentre`), the
   height-weighted noise wind ports to `positionNode`, and the only alpha-dependent part is
   the card fringe, which at 15,400 trees would be ~45M alpha-tested quads against the 20×
   law. Its substitute is vertex-level silhouette scallop on the opaque hulls (+ at most a
   hero-tier card skirt, parked). Lineage for citation: Pontus Karlsson's Stylized Fluffy
   Trees → douges.dev three.js port → Blender DataTransfer-normals family
   (simonschreibt.de's Airborn trees is the grand-daddy writeup).
8. **This stack's own measured laws already picked the geometry class.** Opaque geometry
   beat alpha/transparent sheets ~20× on the fill/blend-limited 610M (six opaque hero masses
   ≈ 0.066–0.131 ms vs the sheet's 1.18–2.03 ms, and sheet cost was COVERAGE-INDEPENDENT);
   alpha-to-coverage is a **silent no-op in-game** (verified in r181 source: engages only at
   `samples > 1`; the game runs `antialias: false`); `discard` kills early-Z on integrated
   GPUs; octahedral impostors are alpha-clipped quads again and earn their keep at 100k+
   unique trees, not 15k. The forest's own header law: **"Trees are CHUNKED. Their cost is
   vertex, not fill"** — and the field probe's cost curve (0.131 ms fixed + 0.0094 ms/mass,
   sublinear) says per-draw constants dominate, which makes DRAW COUNT and LOD the two
   levers that matter.
9. **The repo already owns the hard parts.** The cloud-field sculptor
   (`odyssey-cloud-field.js`) IS the Witness-blob technique: smin-union of authored lobes,
   smax base fillet (= the bowl), sphere-traced polygonisation, **SDF-gradient normals**
   (continuous across joins — the melt no shader-side blend can fake), baked AO/height/seed
   in vertex colour. `framing-spruces.js` (winter, currently dead code, no importers) IS the
   Firewatch conifer lathe: stacked drooping jittered cone-tiers, 3 seeded parametric
   variants, snow shells, the constant-per-tree wind-phase rule.
   `surface-world-hero-trees.effect.js` already playground-proved the canopy paint (wrap
   diffuse + cool sky fill + warm rim + edge-weighted backlit gold). Ch3's
   `surface-world.tsl.js` holds `backlitSSSNode` and the per-instance-params
   pipeline-consolidation trick (`aSway` vec4; the belt's `aMaxY`).
10. **The forest has NEVER been priced.** No `no-forest` lever, no forestMs in any report.
   What exists: at p=0.16 submerged, 11 of 45 draws were forest (fixed by the CPU gate,
   which forced a re-baseline — precedent that gate changes are content changes); forest
   build time 0.02 s of the 156 s world build; Lane B has **zero headroom** (p=0.42 measured
   9.9 ms vs a 7.0 budget, owner-blocked re-budget; shoreline p=0.225 at 9.63/10.6).

## 1b. THE REFERENCE BAR — from the owner's screenshots (2026-08-14)

> **D-ref EXECUTED 2026-08-14 — the owner delivered FIVE refs, two beyond the ask.** Roster
> as committed: `act2-trees-ref1.png` = Witness village view (blossom/lime/deep-green/
> autumn-orange canopies), `ref2` = Witness autumn pond (the cleanest big lit/shade canopy
> pairs: gold aspen, deep-red maple, orange, green), `ref3` = Witness lake aerial (THE zone
> shot: mustard→pink→cypress→green→orange), `ref4` = Firewatch daylight pines (measurable
> conifer tier banding, trunk/canopy contrast), `ref5` = Firewatch dusk vista (the
> distance-layering shot: forest depth bands stepping into orange hills). The original
> backlit-conifer close-up was not among them; R7's backlit judgement leans on ref5's dusk
> layering plus a graded-rig toward-sun station.

Qualitative bars locked at authoring; **Wave 0c measures the numeric bands from the files on
disk** (same protocol as the cloud plan's §1b: hand-masked boxes per band, decile-checked;
judged against numbers, not vibes).

| # | metric | qualitative bar from the refs | numeric band — **MEASURED 2026-08-14 (Wave 0c)** |
|---|---|---|---|
| R1 | value steps per canopy | 2–3 quantised steps, each a connected mass — never facet noise | steps = 2–3; band interiors are FLAT painted fields (a Firewatch shade mass measured a **1-luma spread over 12,750 px**) |
| R2 | shade/lit luminance ratio within one canopy | clearly darker but never black; the shadow is a COLOUR | **THREE-TIER, by species value-role** (15 genuine pairs): workhorse canopies **0.43–0.78**; pastel/blossom **0.83–0.94** (blossoms shade by hue/sat shift, almost no darkening); dark-anchor species **0.22–0.34**. One fleet-wide ratio is WRONG — value identity is per-species (ref3's ladder: cypress 18 ≪ green 79 ≪ mustard 137 < orange 149 < pink 162) |
| R3 | shadow hue vs lit hue | ~~shadow shifts COOL (B↑ R↓)~~ **OVERTURNED BY MEASUREMENT — see the 0c outcome.** Shade goes DEEPER + MORE SATURATED along the canopy's OWN hue axis, never toward blue/grey | ΔnormB **−0.005..−0.115** (negative in 14/15 pairs); ΔnormR **+0.01..+0.10** on warm species (cool greens deepen green, ΔnormR slightly −); Δsat **+0.03..+0.33** (positive in 14/15). Constraint: Δsat ≥ 0 AND ΔnormB ≤ 0 |
| R4 | silhouette scallop | canopy outline is a scalloped union of convex lobes; conifers = visibly drooping tiers | conifer tiers measured **5–7** on near heroes, 3–5 distant (inside the assumed 5–9 — author to 5–7); scallop wavelength ≈ ⅙–¼ canopy width (geometry constraint, test-assertable) |
| R5 | hue zoning | one dominant hue per tree; readable zone boundaries (ref3: mustard→pink→cypress→green→orange) | zone widths measured **2–10 canopy diameters** (mustard 8–10, pink 3–4, orange ~3, giant-green 2–3, cypress a 1-deep screen row); zones must ALSO separate by VALUE (the ladder above). Firewatch conifer belts are the complement: ONE hue family, VALUE-varied trees |
| R6 | trunks | thin, visible, opposed to the canopy | opposition is **HUE-first** (Firewatch trunk normR 0.57 vs canopy 0.42), value-second (trunk/canopy luma 0.31 Witness dark – 0.62 Firewatch red); "pale" trunks are canopy-TINTED (peach under orange), never neutral white |
| R7 | backlit / dusk read (ref5) | toward the sun, layers step through a warm ramp; crown edges catch rim light | dusk banding is MILD (genuine pair ratio 0.67, hue shift tiny); the drama is the AERIAL INVERSION — far = brighter + redder + MORE saturated (luma 51→80→108→129, sat 0.69→0.81), green holds flat then flips HARD at the valley line; zenith darker than horizon; horizon is MAUVE, not orange |
| R8 | interior detail | none — silhouette + 2–3 masses (Witness "squint test") | confirmed, with the mechanism: conifer "brightness" is **sparse tip dusting** (tips 130–153 over an olive-70 base) — a large flat bright lit face does not exist on the Firewatch pines |
| R9 | daylight distance flattening (new, measured) | far trees flatten toward sky | sat drops **2–3×** (0.67→0.28; 0.48→0.17), luma LIFTS **+22..+51** (distant pines end BRIGHTER than the sky's 138), normB rises toward sky/teal (+0.14; ref3 far foliage hits normB≈normG) — the numeric target `applyAerial` must reproduce for trees |

**The gap, located precisely (why §2 says the incumbent cannot be tuned into this):** the
current forest fails R1 (facet normals → per-face noise, not 2–3 masses), R4 (perfect cones,
zero scallop, one silhouette), R5 (monochrome two-green ramp, no zones), R6 (trunk nearly
invisible at 0.10 radius, same-value), R7 (no backlit/rim terms). It *passes* R8 trivially
and half of R2 (the wrap term exists). Geometry, scatter and paint all have to move; the
architecture underneath them does not.

## 2. Why the current forest cannot be "tuned into" this look

The 30-tri cone-stack has **per-face normals** — and finding 2 says the entire painted-blob
read is normals. It has **one silhouette** — and findings 3–4 say species variety is roster +
silhouette, which colour jitter cannot fake. Its colour is a single two-green vertical ramp
— finding 3's zoning happens at island scale, upstream of the shader, in the scatter. None
of these are slider fixes; geometry (new builders), scatter (zone field + species + LOD
binning) and paint (band stack) each need real work. What survives unchanged is everything
the file's header calls paid-for: chunked InstancedMeshes with hand bounding spheres, the
CPU submerged + 1450 u rail-distance gates, scatter on `relief.sample` (floating/buried
trees structurally impossible), one shared material, `fog=false`, `toOutput(applyAerial(…))`.

## 3. The design (and the roads not taken)

**Chosen: a sculpted roster on the cloud-field idiom.** Two procedural builders feed a
frozen specs module (the cloud field's specs/builder split, reused as a pattern):

- **Conifer lathe** — `framing-spruces.js` evolved: stacked drooping N-gon tiers with
  jittered sagging rims (R4's 5–9 tiers), thin trunk, unit-height; normals TRANSFERRED from
  the enveloping cone/teardrop (not per-facet, not per-tier-cone) so the whole tree shades
  as one soft volume with tier scallops living only in the silhouette. Snow dusting for the
  subalpine variant is baked per-vertex colour on the SAME shell (the belt GLBs' approach —
  no second snow shell, no z-fight, the multi-shell wind rule never triggers).
- **Broadleaf sculptor** — `odyssey-cloud-field.js`'s grammar at tree scale: 3–8 authored
  lobes per crown → smin union (melt) → **smax BOWL underside** (finding 1 — the same fillet
  that gives clouds flat bases gives canopies their solid underbelly) → silhouette crinkle →
  sphere-traced polygonisation → SDF-gradient normals, baked AO (`color.r`), height-in-crown
  (`color.g`), per-tree seed (`color.b`). Trunk: 6–8-sided cylinder with a root flare
  (stillwater's `appendTreeSegments` precedent), pale or dark albedo per species (R6).

**Roster (D1 picks from the audition board): 5 archetypes × 3 growth stages.**
S1 shore/lowland broadleaf (olive-green lump-cluster — ref2's rounded masses); S2 workhorse
pine (mid slopes, saggy irregular tiers — finding 3's anti-Christmas-tree rule); S3
subalpine spruce/fir (blue-green, snow-dusted above y≈560, thinning toward the 640 tree
line); S4 gold accent birch/aspen (pale trunk + light canopy, placed as STANDS by the zone
field, not as jitter); S5 vertical cypress/poplar spike (ref2's dark exclamation marks,
sparse). Growth stages are mostly proportion changes (finding 3) — cheap params, not new
builders. A pink-blossom zone (ref2/ref3's showpiece) is authored as an S1 palette variant
but **owner-gated (D4)** — it is an art-direction statement, not a default.

**Scatter v2 (same jittered grid, three additions):** (a) a deterministic ZONE FIELD —
altitude bands × ~500 u low-frequency hue-patch noise — selects species and a per-zone
palette (the analytic stand-in for The Witness's painted island map; the existing 140 u
density mask stays as the clump texture); (b) **per-instance albedo pair baked on the CPU**
(crown + shade colours as instanced attributes) — colours stay LIVE against `uSunColour` /
`uShadowTint` at shade time, so time-of-day re-drives the whole forest and zero fragment
cost buys the zoning; (c) **LOD binned at scatter time by distance to the rail's ground
track** (the camera is a known spline — no runtime LOD logic at all): hero ≤ ~150 u
(~200–400 tris), mid ≤ ~700 u (~60–90 tris), far beyond (~12–18 tris, bands collapse to 1–2
values per Hoa's law, no wind). **Bucketing law: one InstancedMesh per (420 u chunk ×
geometry variant), and the zone field is REQUIRED to keep variants-per-chunk ≤ 2** so draw
count stays ~1.5× today's, inside Lane A's 90-draw cell (test-asserted).

**Paint (one material, all species; per-instance attributes carry what differs — the
`aSway`/`aMaxY` consolidation trick):** wrap diffuse on the baked normals (w ≈ 0.7),
quantised to 2–3 bands; **AO shifts the band THRESHOLD, not the colour** (the field's
grammar); shadow band = mix toward a cool saturated shade albedo (R3's sign constraint);
underside dark mass keyed to baked height-in-crown (finding 6: sky occlusion, not N·L);
backlit gold `pow(max(dot(V,−sunDir),0),~2.5)` weighted to crown edges
(`surface-world-hero-trees` + `backlitSSSNode` precedents); subtle fresnel rim; hemisphere
sky fill by bent `N.y`; then `toOutput(applyAerial(…))`, authored OVERSHOT for the 0.82/0.72
grade contract. Trees may additionally read the baked `sunVisTex` (one fetch — the ground
already does; grove-scale light pooling) — **priced in Wave 3, kept only if ≤ 1 tick.**

**Wind:** pivot-weighted lean (`heightFrac²`), amplitude tiny (motion you feel, not see),
phase CONSTANT per tree from instance origin (the framing-spruces shear rule), decorated by
a travelling gust front — two summed directional sines over instance world-XZ (pure ALU, no
vertex fetch, no `.level()` lint exposure) so gusts CROSS the forest instead of pulsing it
(the cloud plan's "rhythm, not pulse" law). Far tier: no wind.

**Roads not taken (kept results only):**
- **Alpha-card fluffy canopies (the fluffytree geometry, Witness leaf planes):** loses to
  the measured 20× law; A2C is a no-op at `antialias:false`; discard kills early-Z on the
  610M. The look's identity (bent normals + ramp) ports without the cards. Killed.
- **GLB species kits:** the Quaternius manifest is binaries-deleted; the committed conifer
  GLBs (`fir/pine/spruce_lod.glb`) are real but ~1.6 u single-LOD assets authored for the
  belts — kept as **fallback F5** (audition them; if a sculpted archetype fails its bar, an
  instanced GLB species is legal since they ARE in git). Procedural stays the charter.
- **Octahedral impostors:** overkill at 15k trees / ~460k tris; alpha-clipped quads again;
  WebGL-oriented library. Killed (revisit only if a far-ring forest at 10× count is ever
  wanted — §5 Wave 6).
- **One merged static geometry per chunk (no instancing):** kills matrix overhead and
  bucketing complexity, but ~15k trees × unique verts ≈ tens of MB of VRAM and it forfeits
  per-instance palette reuse. Killed for hero/mid; **far tier MAY merge** (it is the tier
  where per-draw constants dominate and verts are trivial) — Wave 2 decides with numbers.

## 4. Target look (hard rules; the audition and every capture are judged against these)

- Canopy = **cluster of 3–8 convex lobes** (broadleaf) or **5–9 drooping scalloped tiers**
  (conifer); solid bowl underside; scallop wavelength ⅙–¼ canopy width; NO interior detail —
  the read lives in silhouette + 2–3 value masses (R1/R4/R8).
- Normals: SDF-gradient (broadleaf) / envelope-transferred (conifer). **Facet normals on a
  canopy are a defect**, full stop.
- Bands: 2–3, wrap w≈0.7, thresholds 8%-soft; ~~shadow band saturated and cool (B↑ R↓)~~
  **CORRECTED by Wave 0c measurement: shadow band goes DEEPER + MORE SATURATED along the
  canopy's own hue axis (Δsat ≥ 0, ΔnormB ≤ 0)** — golden→amber, green→deeper green,
  orange→maroon; never blue-shifted, never desaturated (the cool-blue shadow was the
  community-recipe assumption; 14/15 measured reference pairs refute it for foliage —
  cool-shift remains the CLOUD law only). Crown warm toward `uSunColour`; never white,
  never black. **The softness knob is the fluffytree over-extension: band/ramp ends may
  run past the dot's [−1,1] range** (their shipped values: gradient end 2.7, highlight
  window 0.5→1.8) — tune between "banded Witness" (tight ends) and "airbrushed Ghibli"
  (over-extended) per species; the audition decides where each archetype sits. (The
  fluffytree blue-teal shadow STOP itself is a non-Witness variant — an art lever, not
  the bar.)
- The dark underside is one CONNECTED mass driven by baked height-in-crown; AO moves band
  thresholds only.
- Hue zoning: one dominant hue per tree; zones 3–10 canopy diameters; palettes authored
  against the LIVE colour-script uniforms, never copied constants (the cloudPalette law).
- Trunks value-opposed to crowns (R6); visible at hero/mid LOD.
- Wind: clump-level, tiny, constant phase per tree, gust fronts travel; **silhouettes never
  boil** (no vertex noise at silhouette frequency); far tier static.
- Everything opaque FrontSide, `fog=false`, ends in `toOutput(applyAerial(…))`, colours
  overshot for the grade, tuned ONLY on the graded rig (the navy-shards law).

## 5. Waves (every gate MEASURED on Lane B via `--low-power`, counters-verified quiet; ADR-0016 admissibility throughout)

### Wave 0 — price the incumbent, falsify the paint (2–3 sessions, nothing ships)
- **0a — the first forestMs.** Add `forest: true` option to `createOdysseyWorld`
  (`if (forest)` around renderer :2520–2601, the `no-water` build-gate shape — prices
  draws+fill+vertex+pipeline); board flag
  `forest: !readBooleanUrlFlag('odysseyWorldNoForest')`; gpu-split CONFIGURATION
  `{ id: 'no-forest', flags: { odysseyWorldNoForest: '1' } }`;
  `forestMs: delta('baseline','no-forest')` — **argument order carries the sign, never also
  negate** (the heroes double-flip law). Pairs at **p=0.225** (`--chapters 2,3` — the
  forest-facing shoreline cell, 9.63/10.6) and **p=0.42** (`--chapters 3,4,5`), plus Lane A
  for the draw count. `--only baseline,no-forest,baseline-repeat`, `--out
  gpu-split-laneb-forest-*.json` (never clobber canonical baselines). Ledger cell
  `odysseyAct2ForestMsLaneB` (tracked, baseline null — the cloud-field cell is the
  template). Policy test à la `odyssey-cloud-swap.test.js` pinning defaults + both
  polarities. **This number funds everything; no gate yet — it IS the budget's x-axis.**

> **OUTCOME — WAVE 0a INSTRUMENT LANDED 2026-08-14; THE MEASUREMENT HAS NOT RUN.** The lever
> exists and is verified; `odysseyAct2ForestMsLaneB` is declared with a NULL baseline. Nothing
> is claimed about the forest's cost — deliberately, because the two pairs need a quiet
> machine and the Lane B iGPU, and ADR-0016's fourth admissibility condition is exactly that.
>
> **SHIPPED:** `forest = true` option on `createOdysseyWorld` gating the SCATTER (renderer
> :2520); board flag `forest: !readBooleanUrlFlag('odysseyWorldNoForest')`; gpu-split
> `no-forest` configuration + `forestMs: delta('baseline','no-forest')`; the ledger cell;
> `odyssey-forest-lever.test.js` (11 tests).
>
> **THE GATE IS THE `no-water` BUILD SHAPE, AND THAT CHOICE IS LOAD-BEARING.** The deck's
> asymmetric "built but withheld" shape would have left 40 InstancedMeshes constructed and
> merely hidden — which prices fill and draws while leaving vertex work and the pipeline on
> both sides. This file's own measured header law is that tree cost is **vertex, not fill**,
> so that gate would have priced the wrong half of the system. Gating the scatter instead
> makes everything downstream degrade to a no-op through an empty array (empty bucket Map,
> empty `treeMeshes`, the update-loop gate iterating nothing), and `treeMat` is still built
> on both sides — required, because the fog opt-out lint demands the fog list equal the set
> of `const` NodeMaterials exactly, and `dispose()` calls `treeMat.dispose()` unconditionally.
>
> **VERIFIED BEHAVIOURALLY, NOT JUST FROM SOURCE.** `createOdysseyWorld` builds headless
> (only rendering needs a device), so the test constructs both worlds and measures:
> forest on = 6,028 trees / 39 chunks / 39 meshes in the group at `low`; forest off = 0/0/0;
> `dispose()` throws on neither (the falsifiable form of "treeMat is built on both sides").
> **Mutation-checked with four defects, each caught, tree restored green after each:**
> board polarity flipped; renderer default flipped to `false`; `forestMs` arguments swapped
> (the heroes' double-flip); and the gate wired to the wrong option (`water`) — the last one
> caught independently by BOTH the source assertion and the behavioural test.
>
> ⚠️ **A COUNT CORRECTION, PROPAGATED.** The plan was authored quoting 15,412 trees / 6,020 /
> 462,360 tris from a hand-recomputation. Reading `stats` off the live build gives
> **15,427 / 40 chunks / 462,810 tris (high)** and **6,028 / 39 (low)** — which matches the
> independent count taken when this work started, so the hand-recomputation was the outlier.
> Corrected at every claim (this plan ×2, the renderer JSDoc, the board comment, the ledger
> cell, which also records the supersession). Small numbers, but a ledger cell is permanent.
>
> **NOT DONE, AND NOT ESTIMATED:** the two pairs. Run on a quiet machine, judging each pair
> by `baselineDriftMs` BEFORE quoting its delta:
> `--lane B --low-power --seek 0.225 --chapters 2,3 --only baseline,no-forest,baseline-repeat
> --out gpu-split-laneb-forest-shore-p225.json`, then the same at `--seek 0.42 --chapters
> 3,4,5`. Expect a large draw-call delta between baseline and `no-forest` — that IS the
> signal, and `contentMismatch` only voids the baseline/baseline-repeat pair.
- **0b — the paint probe on the OLD geometry (cheapest falsifier).** Zero new geometry
  files: (1) in `buildTreeGeometry()`, replace the hand-authored facet normals with
  **envelope-transferred normals** (per-vertex `normalize(v − crownCentroid)`, y-biased
  +0.3) — a bake-time change; (2) in `treeMat`, the band stack (wrap → 2–3 bands, cool
  shade band, backlit gold, rim). Judge on the **graded rig** (`act2-cloud-deck.effect.js`,
  `?p=0.225 / 0.30 / 0.42`, `?worldOnly=forest` for isolation shots and full-frame for
  cohesion) against §1b. **Owner decision D0: does banded paint on blob normals transform
  even the primitive cones?** Expected yes (every reference says normals+ramp is the
  identity); if no, the sculptor is still justified by R4/R5 but the paint stack gets
  redesigned before any geometry is built. Fallback F1: if the overhaul stalls after 0b,
  the normal bake + band paint alone is a shippable mini-win (owner call, priced by 0a's
  instrument).

> **OUTCOME — WAVE 0b BUILT AND CAPTURED 2026-08-14; D0 IS NOW THE OWNER'S CALL.** Opt-in and
> shipping nothing: `?forestPaint=1` on the graded rig, `?odysseyWorldForestPaint=1` in-game.
> Evidence: `artifacts/odyssey/act2-forest-w0b/w0b-{A-incumbent,D-probe-v3}-p{030,042}.png`
> (+ the two superseded probe versions, kept because the defect they caught is the finding).
> Clean WebGPU build, no validation errors, RTX lane.
>
> **SHIPPED:** `forestPaint` option; `buildTreeGeometry(blobNormals)` baking per-vertex normals
> radiating from a crown blob centre (y 1.95, +0.30 up-bias, guarded normalize); a band stack
> of wrap diffuse (w 0.70) → one soft band (0.40..0.58) → measured-law shade colour →
> quantised sky-occlusion skirt → two light colours by band → rim-weighted backlit gold with
> the field's documented sign discipline; a hue-opposed red-brown trunk below the y=0.9 seam.
> All plain expressions, no `.toVar()` shared with `positionNode`.
>
> ⚠️ **THE PROBE'S FIRST CUT FAILED THE BAR, AND THE BAR CAUGHT IT IN ONE CAPTURE — this is
> the most useful thing the wave produced.** v1 measured **p10 = 0.0 in the near canopy**:
> literal black shade, distant forest broken into speckle. Cause: the measured shade/lit ratio
> is a FINAL-PIXEL ratio, and v1 spent it THREE TIMES — a 0.55 albedo scale × a 0.62 occlusion
> floor × a dim ambient ≈ 0.11, then the grade's black crush finished it. Fixed by giving the
> ratio exactly ONE owner (the ambient's magnitude relative to the sun); the constant's comment
> now carries the lesson. **Law worth keeping: a measured ratio may be produced in one term
> only — compounding three "reasonable" factors is how a stack lands an order of magnitude out
> while every individual constant looks defensible.**
>
> **MEASURED, near-canopy / mid-canopy shade-lit ratio (p10/p90 within one canopy mass),
> target band 0.43–0.78:**
>
> | version | near | mid | verdict |
> |---|---|---|---|
> | incumbent | 0.523 | 0.517 | **already in band** |
> | probe v1 | 0.000 | 0.006 | FAIL — black clipping |
> | probe v2 (ratio given one owner) | 0.670 | 0.711 | in band |
> | probe v3 (occlusion quantised) | 0.666 | 0.740 | in band |
>
> **AND THE FINDING THAT RE-AIMS THE PLAN: the incumbent's value ratio was NEVER the defect.**
> At 0.52 it already sat inside the band measured from the references. So the forest's problem
> is not its contrast — it is exactly what §1b's gap analysis said: facet normals (noise, not
> masses), one silhouette, one hue. The paint stack's job is therefore to hold the ratio it
> already had while replacing the NORMALS and the colour architecture — not to add contrast.
>
> **HONEST VERDICT ON WHAT THE PROBE ACHIEVES.** It does what it was built to test: the crown
> now shades as a smooth volume with a connected dark skirt, trunks read as hue-opposed marks,
> and the forest stays coherent at distance. It does NOT by itself look Witness-grade — the
> silhouette is still a perfect cone and the palette is still monochrome green, which are
> precisely Wave 1's and Wave 2's jobs. **D0 is therefore not "is this beautiful yet" but "is
> the normals+ramp direction confirmed enough to fund the sculptor".** The plan's own §1b
> predicted this split; the capture is consistent with it.
>
> **CARRIED INTO WAVE 1/3:** the one-owner ratio law (above) becomes a review question for
> every future paint term; the quantised occlusion skirt (edge 0.10..0.38 of crown height)
> reads better than the ramp it replaced and should survive into the species material; the
> per-instance crown-hue mix is a placeholder for Wave 2's zone field, not a design.
> **R7 CLOSED, and a saturation regression caught and fixed with it.** The into-sun yaw is
> computable, not guessable: `yaw = atan2(sunZ, sunX) − atan2(tangentZ, tangentX)`, giving
> −115.9° at p=0.30 and −128.4° at p=0.42. At full into-sun yaw p=0.30 looks out to SEA (the
> sun renders, no forest — recorded so it is not re-attempted), so R7 is judged at p=0.42
> `yaw=-70` (58° off-sun), where the forest fills the frame:
>
> | metric | incumbent | probe v3 | probe v4 (shipped) | reference band |
> |---|---|---|---|---|
> | near-canopy sat | 0.461 | 0.372 ✗ | **0.481** | 0.46–0.75 |
> | near-canopy normR (warmth toward sun) | 0.3461 | 0.3631 | **0.3725** | higher = backlit firing |
> | near-canopy shade/lit | 0.640 | 0.644 | **0.653** | 0.43–0.78 |
> | p=0.30 near-canopy sat | 0.553 | 0.491 | **0.621** | 0.46–0.75 |
>
> v3 measured BELOW the references' saturation band while running 35% brighter than the
> incumbent — the wrong trade for a palette whose stated rule is that saturation never
> collapses. Fixed by deepening the crown albedo's blue channel and easing `FOREST_SUN_GAIN`
> 0.95→0.88: **saturation, not value, is the lever.** All four metrics are now in band, and
> the probe is measurably warmer than the incumbent toward the sun, which is the backlit term
> doing its job. Evidence: `w0b-R7-sunward-{incumbent,probe}-p042.png`.
- **0c — the numeric reference bar.** Owner drops the refs into
  `public/playground-refs/`; measure R2/R3 bands from the files (cloud-plan §1b protocol);
  write the numbers into §1b's table. Blocked only on the file drop.

> **OUTCOME — WAVE 0c COMPLETE, 2026-08-14.** Owner delivered FIVE refs (roster in §1b's
> note); 5 measurement agents (one per ref), zlib box sampler on the
> `act1-value-gate.mjs` decoder precedent, every box decile-verified single-band, rejected
> boxes documented per ref (sky bleed caught at normB>0.31, trunk bleed at normR≥0.49,
> rock/ground by hue family). Full data: workflow `wf_e2659785-870` journal. §1b's table
> now carries the measured bands. The headline results:
>
> **1. THE ASSUMED SHADOW RULE WAS WRONG, AND THE PLAN IS CORRECTED.** The authored bar
> said "shadow shifts cool (B↑ R↓)" — the Ghibli-community-recipe rule, and the fluffytree
> repo's blue-teal shadow stop. The pixels refuse: across 15 genuine lit/shade pairs in
> four images, **ΔnormB is NEGATIVE in 14/15 and saturation RISES in shade in 14/15**
> (up to +0.33). Witness/Firewatch foliage shade goes **deeper and more saturated along
> the canopy's own hue axis** — golden→amber, orange→maroon, green→deeper green — never
> toward blue, never toward grey. (The clouds measured the opposite — cool-shift — and
> both agree on the real invariant: **shadow is a hue statement, saturation never
> collapses.**) §4's band rule is corrected at the claim; the fluffytree cool-teal stop is
> hereby a NON-Witness stylisation variant, available as an art lever, not the bar.
> **2. There is no single shade/lit ratio — value identity is per-species.** Workhorse
> 0.43–0.78; pastels 0.83–0.94 (ref3's blossom has NO dark mass at all — it shades by a
> magenta/sat shift, ratio 0.94); dark anchors 0.22–0.34. Ref3's zone VALUE ladder
> (18/79/137/149/162) says zones are value-separated as much as hue-separated — the specs
> module must assign each species a value ROLE, not just a hue.
> **3. Firewatch conifers are hue-uniform and value-varied** (all near canopies norm
> ≈[0.42,0.43,0.14], differing by VALUE only), tiers 5–7, lit faces are dappled — an
> olive base with sparse bright TIP dusting (130–153 over ~70), and shade masses are
> astonishingly flat (1-luma spread over 12,750 px). Paint consequence: conifer lit band =
> flat base + sparse vertex-tip highlights, NOT a bright face gradient; broadleaf zones
> carry the hue variety, conifer belts carry value variety.
> **4. Daylight aerial is lift+desat+blue (R9: sat ÷2–3, luma +22..+51 — far pines end
> brighter than the sky), and dusk INVERTS it** (far = brighter+redder+MORE saturated,
> with a HARD flip at the valley line, not a gradient; horizon mauve, zenith darker than
> horizon). `applyAerial`+colour script must reproduce R9 for trees in daylight stations;
> the dusk inversion is a colour-script statement, checked at the toward-sun station.
> **5. Trunk opposition is hue-first** (red-brown vs olive), value-second; "white" trunks
> are canopy-tinted, not neutral.
> **CONFESSIONS:** ref5's first two "pairs" are depth PSEUDO-pairs by instruction (near
> band vs far band), not canopy pairs — only its third is genuine; ref3's pink-zone
> swatch includes ground gaps (that mix IS the zone read; stated); ref1's orange shade may
> be an adjacent crimson maple reading as under-canopy (two independent boxes agree, so
> the value stands); no clean neutral birch trunk exists at ref resolution.
> **CARRIED INTO WAVES 1–3:** species specs get a value-role axis (dark-anchor /
> workhorse / pastel) alongside hue; conifer paint gets a tip-dusting term instead of a
> lit-face gradient; the shadow band's sign constraint in the material is Δsat ≥ 0,
> ΔnormB ≤ 0 (test-assertable against the palette maths); Wave 3's graded-rig judgement
> uses §1b's measured bands as written.

### Wave 1 — the species sculptor (the audition)
`odyssey-forest-species.js` (frozen, import-free specs: 5 archetypes × 3 stages, lobe/tier
tables, palettes as ROLES not RGB — resolved against colour-script uniforms at material
build) + `odyssey-forest-geometry.js` (the two builders). Bake: normals, AO→`color.r`,
height-in-crown→`color.g`, seed→`color.b`. Budgets test-asserted: hero ≤ 400 tris, mid ≤ 90,
far ≤ 24 (raised from 18 in Wave 1 — see its outcome); whole-roster bake ≤ 300 ms (the field's 162/250 precedent; forest build today is
0.02 s). Carry the cloud sculptor's paid-for lessons as tests: exhausted-trace bisection
(never collapse to centre), `!(d < 0)` NaN guard, `IcosahedronGeometry(r, detail)` =
20·(detail+1)² faces, guarded normalize (zero-vector const-folds to a WGSL compile failure).
New playground effect `act2-tree-audition` (the `koi-tree-audition` side-by-side board
pattern): all archetypes × stages, orbitable, `?ref=` split against the three refs.
**Owner decision D1: the roster** — which archetypes ship, which stage proportions read
right, judged against R4/R6/R8. Nothing mounts in the world yet.

> **OUTCOME — WAVE 1 SCULPTOR BUILT, 2026-08-14. The audition board is up and D1 is ready to
> take.** Nothing mounts in the world: this wave produces geometry and a board to judge it on.
> Evidence: `artifacts/odyssey/act2-forest-w1/w1-audition-{hero,mid,far}.png`.
>
> **SHIPPED:** `odyssey-forest-species.js` (5 archetypes × 3 growth stages, frozen,
> import-free) + `odyssey-forest-geometry.js` (conifer lathe + broadleaf sphere-traced smin
> sculptor, blob normals + analytic AO + height-in-crown + per-tree seed baked to vertex
> colour) + `odyssey-forest.test.js` (20 tests) + `act2-tree-audition.effect.js`
> (`?lod=`/`?species=`/`?spin=`). Budgets: hero 332/400, mid 88/90, far 12 (conifer) / 20
> (broadleaf) / 24 budget. Whole-roster bake well inside the 300 ms budget.
>
> **THE VALUE-ROLE AXIS FROM WAVE 0c IS NOW STRUCTURAL.** Species carry `anchor` / `workhorse`
> / `pastel` roles with the measured shade/lit bands attached, and a species carries ONE crown
> colour plus a shade RECIPE (saturation gain > 1, value ratio < 1) rather than two authored
> colours — because a hand-authored shade colour is exactly where a cool or desaturated shadow
> would creep back in. Tests pin the three classes as separated and forbid a desaturating
> recipe.
>
> ⚠️ **THE FAR TIER TOOK THREE ATTEMPTS, AND THE AUDITION BOARD'S `?lod=far` CAUGHT EVERY ONE
> — which is the strongest argument for having built the board before the scatter.**
> 1. *A 12-triangle bespoke bipyramid* met the 18-tri budget and read as a flat **KITE**.
> 2. *Re-proportioned* (short top cone, long taper) it became a **funnel**. The lesson is
>    geometric, not parametric: **a bipyramid's profile is a diamond at any facet count**, so
>    no amount of tuning makes one round.
> 3. *The traced hull at `detail 0`* — 20 faces, the same builder as hero/mid — is round, and
>    the far tier now shares the hero/mid silhouette family instead of being a different object
>    that happens to be small. **The BUDGET moved 18 → 24 rather than the shape being bent to
>    fit it**, because an icosahedron is the cheapest genuinely round closed hull that exists
>    and 18 came from the research's "8–12-tri cone/teardrop", which describes a CONIFER. The
>    far conifer still costs 12.
>
> ⚠️ **AND A SECOND REVERSAL, ON WHAT "SEATED" MEANS.** Dropping the far trunk floats the
> crown, so a first fix lowered the far conifer's whole stack to the ground and absorbed the
> trunk height into the crown. That trades a float for a **crown shift** — measured at 12.8% of
> tree height, i.e. a visible downward jump as a tree crosses 700 u. At that range a 6 cm trunk
> is under a tenth of a pixel, so **a missing trunk is unobservable and a moving canopy is
> not.** The far tier is now crown-only, left exactly where the mid tier put it, and the test
> that pinned "seated at y≈0" was replaced by the invariant that actually matters: the far
> crown's centroid must sit within 12% of tree height of the mid crown's. Both builders share
> one rule.
>
> **TESTS ARE THE CLOUD SCULPTOR'S PAID-FOR DEFECTS, PORTED:** exhausted-trace bisection (never
> collapse to centre), the `!(d > 0)` NaN guard, the `20·(detail+1)²` face formula, guarded
> normalize, determinism, and per-LOD budgets. Two of them had to be re-scoped after firing on
> CORRECT geometry (the collapse test is about the crown's blob centre, not the world origin,
> and applies only to the traced broadleaf — a conifer's tier apexes legitimately sit on the
> axis at every height). **A test that fails on correct geometry teaches the wrong lesson**, so
> both were narrowed with the reason written at the assertion.
>
> **HONEST READ OF THE BOARD.** Five archetypes are distinguishable at a glance; the pine has a
> genuine drooping scallop rather than a cone (the "stay away from Christmas-tree shaped" rule
> is met); the broadleaf is a melted multi-lobe mass, not a bag of balls; the birch's pale
> trunk and the cypress's dark column both read. Weaker: S2 and S3 differ mainly in width from
> some angles, and the far board looks odd because it shows the far tier far closer than the
> 700 u where it is ever used. **CARRIED INTO WAVE 2:** species `weight`, `band` and `snow` are
> authored but NOT yet consumed — they are the zone field's inputs, and until Wave 2 reads them
> they are declared-not-wired (this repo's own logged bisect failure mode; stated here so the
> gap is visible rather than assumed).

> **OUTCOME — WAVE 1 ADVERSARIAL REVIEW, 2026-08-14. 14 findings confirmed, all fixed; 3
> rejected. One was a rendering defect that had ALSO been shipping in the incumbent forest.**
> 3 review lenses (r181 traps / geometry math / contracts), every claim independently verified
> before acceptance. Workflow `wf_bbec49e5-d16`.
>
> **1. WINDING — HIGH, and the most valuable finding of the whole plan so far.** Every
> hand-emitted triangle in the new sculptor was wound CLOCKWISE: both trunks and all conifer
> tiers. three's WebGPU backend sets `frontFace: CCW` + `cullMode: Back` for any
> non-DoubleSide material and node materials default to FrontSide, so those triangles were
> **back-face culled and the GPU rasterised the far interior instead** — whose interpolated
> blob normal points away from the viewer, putting the shade tone where the lit tone belongs.
> Verified independently by signed volume (divergence theorem): conifers measured NEGATIVE
> against positive for `ConeGeometry` and `IcosahedronGeometry`. **And the incumbent
> `buildTreeGeometry` in the renderer had the identical inversion — it has been shipping.** It
> was survivable while the normals were flat per-face; it was not survivable once Wave 0b
> baked blob normals and banded on them. Fixed in all four emitters plus the incumbent, and
> the incumbent's `aShade` push had to be reordered with it or the winding swap would have
> silently inverted the shipped forest's vertical gradient.
>
> ⚠️ **THE CONSEQUENCE THAT MATTERS MOST: WAVE 0b's PALETTE TUNING WAS CALIBRATED ON THE BUG.**
> The saturation "fix" recorded in the 0b outcome deepened the crown albedo because the
> capture measured 0.372 against a 0.46–0.75 band — but that capture was of the far interior
> surface. With winding fixed the same albedo measured **0.867, well above the band**: the
> deepening had been compensating for a rendering defect. The crowns are back near their
> authored values and re-measured in band (near ratio 0.676 / sat 0.703 at p=0.30; ratio 0.621
> / sat 0.702 / normR 0.382 at the sunward station). **Standing lesson: a measurement is only
> as good as the geometry beneath it, and a tuning pass done on top of a rendering defect
> encodes that defect into the palette.** All Wave 0b/0c captures were re-taken.
>
> **2. THREE TESTS COULD NOT FAIL** — the finding class that matters most in a suite whose
> whole purpose is to pin paid-for lessons. The collapse test's filter excluded vertices near
> the crown centre, i.e. *exactly* the collapsed ones. The scallop test measured the tier
> taper, which dominates the rim jitter it claimed to check — it passed with the jitter
> deleted. The melt test bounded radius steps, which a plain `Math.min` union satisfies
> unchanged. All three rewritten to target the mechanism (traced-vertex range by
> `hullTriangles`; two-seed jitter comparison; `smoothMin` exported and tested for undercutting
> `min` inside the blend width and equalling it outside), plus a NEW winding test.
> **Mutation-checked: re-inverting the winding, deleting the jitter, swapping `smoothMin` for
> `Math.min`, and collapsing a traced vertex are each now caught.**
>
> **3. `color.g === 0` DOES NOT MEAN "TRUNK" — HIGH.** Height-in-crown is legitimately 0 along
> every canopy's underside (the broadleaf bowl, the conifer's lowest rim), so the audition
> board painted the whole underside of every canopy with the TRUNK colour. Because those are
> exactly the surfaces meant to read dark, it looked like a shading choice rather than a bug.
> Fixed with a dedicated `aIsCrown` attribute.
>
> **4. Far conifers were 11–13% SHORT** while `userData.totalH` and the comment both claimed
> exact height preservation (apex height depends on tier count). Fixed by rescaling the stack,
> and the tier floor raised 3 → 4 because the 5-tier cypress — the anchor species — drifted
> 12.7% in crown centroid at 3 tiers. Both invariants now hold: height parity exact, drift
> ≤ 6%. **5.** The NaN guard had the OPPOSITE polarity to the one its own comment described
> (`!(d > 0)` admits NaN as *inside*); every inside-test is now `Number.isFinite(d) && d <= 0`,
> and `SMIN_K` is floored so a degenerate spec cannot produce NaN in the first place. **6.**
> The conifer docstring claimed snow was baked into vertex colour; it is not implemented at
> all, and the docstring now says so. **7.** The far budget was raised in code but still read
> 18 in two places in this plan — corrected.
>
> **REJECTED (3), recorded so they are not re-litigated:** a `crownW` under-report that is
> internal-only; a non-unit trunk normal that requires `trunkR === 0`, which no spec has; and a
> duplicate of the NaN-polarity finding.

### Wave 2 — the zoned scatter
`scatterTrees` v2 (stays exported; same jittered grid + rejection rules — sea+3 / snow 640 /
slope 0.62 / 140 u clump mask all preserved): adds the zone field (altitude bands × ~500 u
patch noise), species pick, growth stage, per-instance crown/shade albedo bake, LOD bin by
rail distance (the spline sampled by the CALLER, as `railSamples` already is for shafts).
Bucketing: (chunk × variant) InstancedMeshes, name still containing `forest`
(`?worldOnly=forest` contract), hand bounding spheres, `frustumCulled=true`,
`userData.centre` for the CPU gate. **Gates (all test-asserted, no GPU needed):**
determinism (same seed → same forest); variants-per-chunk ≤ 2 (the zone field's structural
obligation); projected draw count at 3 stations ≤ 1.6× incumbent chunks-visible;
count parity with today ±15% per quality lane (density is an art lever, not a perf
regression channel); every instance above y=560 snow-dusted, none above 640. Far-tier
merge-vs-instance decided here with a vertex/VRAM ledger written into the wave outcome.

> **OUTCOME — WAVE 2 SCATTER BUILT, 2026-08-14.** `odyssey-forest-scatter.js` +
> `odyssey-forest-scatter.test.js` (19 gates, mutation-checked ×4). Nothing mounts in the
> world yet; the scatter is a pure function returning placements and buckets, so every gate
> runs device-free against the REAL height field and the REAL rail.
>
> ⚠️ **THE TERRAIN IS NOT THE ISLAND I AUTHORED BANDS FOR, AND MEASURING IT CHANGED THE
> DESIGN.** The altitude distribution of sites that actually survive the slope and density
> rejections is:
>
> `n=15,412 · p10 303 · p25 318 · p50 348 · p75 379 · p90 390 · p97 396 · max 613`
>
> **97% of the forest lives below y=396.** The massif flanks above that are steeper than the
> 0.62 slope cap, so Act II's forest is a coastal-and-lowland forest whatever the tree line
> says. The bands in §3 were authored across 290–640 and gave the upper two species NO GROUND
> AT ALL — the subalpine fir scattered **0.0%** of the island and the cypress **0.1%**, while
> both table entries looked perfectly reasonable. Re-cut to the measured range (shore 288–325,
> lowland 315–358, slope 348–390, subalpine 380–460) all five species place with workable
> shares (S1 23% / S2 29% / S3 30% / S4 9% / S5 8.5%). **The same correction applied to snow:**
> a 560 onset dusted nothing, and its gate passed vacuously on zero instances.
>
> ⚠️ **WEIGHT MUST BE AN ADDITIVE BIAS, NOT A MULTIPLIER.** Multiplying a species' score by a
> 0.18 weight does not make it rare — it makes it **impossible**, because it can never
> out-score a weight-1.0 neighbour at any patch value anywhere. That is how the anchor species
> (the composition's black notes) reached 0% while its `weight: 0.18` read as "sparse".
>
> **THE ≤2-VARIANTS-PER-CHUNK GATE IS RETIRED, AND REPLACED BY THE THING IT WAS A PROXY FOR.**
> It was written before a scatter existed to report draws. Under the shipped bucketing it is
> also not meaningful: a far "chunk" is a 1,680 u square and five species sharing one is
> expected. The budget is now **measured directly** — and the measurement drove a real design
> change. Uniform 420 u buckets gave 92 total / **42–57 visible** at stations against an
> incumbent ~15 and a Lane A ceiling of 90 for the whole world. Making the bucket edge a
> function of LOD (hero 420 / mid 840 / far 1680) lands **37 total buckets — fewer than the
> incumbent's 40 — and 25–27 visible at p=0.225 / 0.30 / 0.42.** That is the far-tier
> merge-vs-instance decision the wave was asked to take: *coarsen, do not merge* — the far tier
> is 73% of the trees at 12–20 triangles each, so what it loses in culling precision it more
> than refunds in draws, while staying cullable.
>
> **TWO STRUCTURAL DECISIONS WORTH KEEPING:** growth stages ride the INSTANCE MATRIX, not the
> geometry (a stage is pure height/width multipliers, so building at stage S is exactly
> equivalent to building at `mature` and scaling — baking them would triple variants for no
> visual difference); and LOD is a property of the CHUNK, not the tree, because the chunk is
> the batching unit and a square straddling a tier boundary would otherwise need two draws.
>
> **`weight`, `band` and `snow` are now consumed** — the declared-not-wired set from Wave 1 is
> closed, and a test asserts the zone field responds to `zoneCell` so it cannot silently
> detach again. Mutation-checked: reverting weight to a multiplier, uniform bucket edges,
> per-tree species randomness, and a desaturating shade recipe are each caught.
> **NOT DONE:** the scatter does not yet build meshes — that is Wave 3, with the paint.

### Wave 3 — the paint (on the new geometry) + the price gate
The §3 paint stack lands in the (still ONE) forest material; species differences ride
instanced attributes. Tuned on the graded rig at p=0.225 / 0.30 / 0.42 / one toward-sun
station for R7, judged against §1b's measured bands; one low-tier sanity capture
(`?worldQuality=low`). `sunVisTex` grove-shadow probe: one fetch, priced by the 0a
instrument — kept only if ≤ 1 tick (0.066 ms) at p=0.225. **Perf gates:** new-forest config
`forest-v2` (opt-in flag `odysseyWorldForestV2=1` while migrating) priced **against
`no-forest`, not baseline** (the cloud-field-half polarity law):
`forestV2Ms = delta('forest-v2','no-forest')`. **Gate F2: forestV2Ms ≤ forestMs + 0.30 ms at
p=0.225 Lane B** (aspire ≤ +0.15); Lane A draws ≤ 90 total. Compile: forest pipeline count
stays ≤ 2; keep node fan-out low (the water material's 129 s is the cautionary tale; the
forest's 0.02 s is the standard). r181 discipline: positionNode built from `positionLocal`
(instance matrix), local masks from `positionGeometry`, NO shared `.toVar()` across
positionNode/varyings (root-pin at Fn top; prove with a constant), any vertex-stage texture
`.level(0)` (lint-enforced), material added to BOTH the fog-false forEach and dispose lists
(lint-enforced), stats keys `trees`/`forestChunks` preserved.

> **OUTCOME — WAVE 3 MOUNTED AND CAPTURED, 2026-08-14. The zoned five-species forest renders
> through the real grade.** Opt-in: `?odysseyWorldForestV2=1` in-game, `?forestV2=1` on the
> graded rig. Evidence: `artifacts/odyssey/act2-forest-w3/w3-v2-p{030,042}.png`.
>
> **SHIPPED:** the v2 build block in the renderer (one material, per-instance species data),
> the `forest-v2` gpu-split configuration with `forestV2Ms = delta('forest-v2','no-forest')`,
> and the board/rig flags. The two forests are **alternatives, not additive** — a first cut
> built both, which would have made the gpu-split pair price the pair rather than the new
> system, quietly answering a different question than its name.
>
> ⚠️ **A HARD DEVICE LIMIT, FOUND ONLY BY CAPTURE: WEBGPU ALLOWS 8 VERTEX BUFFERS AND THE FIRST
> CUT NEEDED TEN.** `position, normal, color, aIsCrown, aHeight01, aCrown, aShade, aTrunk,
> aSnow, aPhase` → *"Vertex buffer count (10) exceeds the maximum number of vertex buffers
> (8)"*, every pipeline failed to create, **the frame rendered BLACK**. Not a budget — a limit.
> Nothing headless can see it; 149 green tests said nothing. Fixed by packing: `aVert` (vec4:
> AO / height-in-crown / crown mask / height-above-ground) per vertex, `aCrownSnow` and
> `aShadePhase` (vec4 each) plus `aTrunk` per instance — six buffers plus the instance matrix.
> **This is why the plan's playground-first rule exists, and it is worth adding to the standing
> traps: attribute count is a device limit, and only a capture reports it.**
>
> ⚠️ **AND THE PACKING EXPOSED A SECOND BUG.** `color.b` was documented as "a per-tree random,
> constant across the whole tree" — but geometry is built once per (species, LOD) and SHARED by
> every instance using it, so the value was constant per GEOMETRY and delivered exactly ZERO
> per-tree variation. Anything genuinely per-tree must be an instanced attribute. Removed.
>
> **THE GRADE AMPLIFIES SATURATION, MEASURED — the same lesson Wave 0b learned, re-learned
> because the species crowns were authored fresh.** Authored at HSV ~0.65 they came back
> through the real pipeline at **0.89** against a 0.46–0.75 band, with the forest reading dark
> (near-canopy luma 84 vs the probe's 127). Master 1.15× and the chapter's further ~1.10× more
> than undo the world's own 0.72 pull toward luma. Crowns re-authored paler and less saturated
> than the intended screen result — counter-intuitive, and now stated at the palette itself.
>
> **MEASURED AFTER THE FIX** (canopy-only bands, so trunk pixels cannot contaminate the read —
> checked rather than assumed, and it made no material difference: 0.451 vs 0.435):
>
> | | canopy ratio | canopy sat | luma | band |
> |---|---|---|---|---|
> | incumbent | 0.527 / 0.504 | 0.698 / 0.794 | 91 / 85 | sat partly OVER |
> | Wave 0b probe | 0.739 / 0.683 | 0.640 / 0.725 | 137 / 128 | in band |
> | **Wave 3 v2** | **0.463 / 0.451** | **0.584 / 0.709** | 111 / 99 | **in band, contrasty end** |
>
> Nuance recorded rather than smoothed over: the effective canopy ratio is `role.value × occ`,
> not `role.value` exactly — the occlusion skirt spends a little of it. The scatter test asserts
> `shadeColourFor` reproduces `role.value` on the ALBEDO, which is the term it owns.
>
> **THE TRIANGLE LEDGER, and the LOD distances set from it** (against the incumbent's 462,810):
> `hero≤150/mid≤700` → 609,144 (1.32×); **`hero≤120/mid≤520` → 526,630 (1.14×) ← shipped**;
> `hero≤110/mid≤420` → 483,806 (1.05×); `hero≤100/mid≤340` → 476,412 (1.03×). 1.14× is inside
> the ≤1.25× target while keeping a mid tier worth having; the cheaper rows buy a few percent by
> collapsing the middle distance into the 12–20-triangle far tier, which is where a forest
> starts reading as cardboard.
>
> **NOT DONE:** Gate F2 is unmeasured — `forestV2Ms` needs the same quiet machine as Wave 0a's
> `forestMs`, and both must come from ONE run (`--only baseline,no-forest,forest-v2,baseline-repeat`)
> or they are not comparable. Wind is wired but unverified: cross-run captures have a ~23% pixel
> noise floor and `?t=` freezes dt, so it needs two captures at different `t`.

### Wave 4 — wind
The travelling-gust vertex stack (§3), per-species amplitude via the instanced params.
Verification is at SOURCE (lint-style regex on the phase-from-instance-origin term) plus two
graded captures at DIFFERENT `?t` — the ~23% cross-run pixel noise floor makes motion
capture-unverifiable, and `?t=` freezes `update()` dt (both documented capture laws).
**Gate: ΔforestV2Ms ≤ 2 ticks (0.131 ms) vs Wave 3.** Far tier asserted wind-free at source.

> **OUTCOME — WAVE 4 WIND VERIFIED, 2026-08-14. Proven by capture, not asserted.** Evidence:
> `artifacts/odyssey/act2-forest-w4/{wind,far-only,hero-only}-t{8,14}.png`.
>
> ⚠️ **THE ~23% CROSS-RUN PIXEL NOISE FLOOR DOES NOT APPLY TO THIS RIG, AND THAT CHANGES WHAT
> IS VERIFIABLE.** The plan inherited "motion is not capture-verifiable" from the cloud work
> and planned to assert wind at source instead. Measured with a proper control — the same
> station captured twice at the identical `?t`, in two separate Electron runs — the graded
> playground rig comes back **0.00% of pixels changed, mean |delta| 0.00: bit-identical.** The
> 23% floor is a property of the IN-GAME chapter capture (a live director, a breathing focal
> length), not of this rig. **Motion on the playground rig is therefore capture-verifiable, and
> future motion work should measure rather than assert.**
>
> | comparison | pixels changed |
> |---|---|
> | control: same `t=8`, two runs | **0.00%** (bit-identical) |
> | whole frame: `t=8` vs `t=14` | 4.40% |
> | `?worldOnly=forest-v2-hero`: `t=8` vs `t=14` | **5.37%** — the crowns move |
> | `?worldOnly=forest-v2-far`: `t=8` vs `t=14` | **0.00%** — the far tier is static |
>
> **FAR-TIER STILLNESS IS STRUCTURAL, NOT A SHADER BRANCH.** The roster shares one material by
> design, so the tier cannot be branched in the shader; instead the far bake zeroes the wind
> MASK (`aVert.w`) and the gust multiplies to nothing. Motive is quality, not cost: at 700+ u
> the 0.085-unit sway is well under a pixel, so it can never read as motion — only as shimmer.
>
> ⚠️ **AND THE ISOLATION EXPOSED A LEVER THAT HAD BEEN SILENTLY LYING.** The first attempt to
> capture one tier failed because **every per-frame `.visible` write in `update()` overrode the
> `?worldOnly=` mesh filter** — the sky and ground obeyed it (no per-frame write) while the
> forest, the cloud deck, the heroes and the cloud field came straight back on the next frame.
> So `?worldOnly=<anything>` had never been able to hide those systems, and any compile-bisect
> run that believed it had was measuring a frame that still contained them. This is precisely
> the repo's own worst failure mode — a lever that reports innocence rather than absence, the
> same shape as the `odysseyWorldNoHeroes` bisect that produced a confident wrong answer. Fixed
> by AND-ing an authored `userData.filterVisible` into all four gates; the rig now records
> intent as well as writing `.visible`. Two source-assertion tests that pinned the old line
> shape were updated to pin the LAW (a CPU `.visible` write driven by `uSubmerged`/`heroes`)
> rather than the operand order — a correct refactor should not fail them.
>
> **NOT DONE:** the wave's perf gate (ΔforestV2Ms ≤ 2 ticks). Wind is vertex ALU on hero and mid
> only, so the expectation is "below the timer's resolution", but that is a prediction and not
> a measurement until the quiet-machine run happens.

> **OUTCOME — IN-GAME VERIFICATION, 2026-08-14. The v2 forest runs in the REAL GAME behind its
> flag, and the game's camera found something no playground shot could.** Captured with
> `node scripts/run-electron.mjs scripts/odyssey-chapter-capture.mjs --chapter 3 --time 9
> --url-flag odysseyWorldForestV2=1`. Evidence: `artifacts/odyssey/act2-forest-ingame-{v1,v2}/`.
>
> **CLEAN INTEGRATION.** Manifest confirms the flag reached the board (`odysseyWorldForestV2: 1`),
> **zero console errors**, no pipeline failures, and the world did NOT fall back to the legacy
> dioramas (the board's try/catch would have swallowed a throw silently). The 4×-recurring
> `scene.fog` trap did not bite — the new material is in the lint-enforced opt-out list.
> *(Harness note: the docstring's `npx electron scripts/…` resolves to plain node and dies on
> `app.commandLine`; it has to be run through `scripts/run-electron.mjs`.)*
>
> ⚠️ **THE GAME'S CAMERA LOOKS DOWN AT THE FOREST, SO THE CANOPY TOP IS THE DOMINANT SURFACE —
> AND ON A BLOB NORMAL FIELD EVERY TOP FACES UP, LANDS IN THE SAME LIT BAND, AND THE FOREST
> READS AS ONE FLAT GREEN SHEET.** Every playground capture in this plan is at eye level, where
> a canopy shows its SIDE and the sun band does the work; that view flattered the paint. This is
> the aerial equivalent of the "playground vs in-game grade" law already in this repo, and it
> generalises: **a shading term keyed to sun direction says nothing about the surface the camera
> actually sees most of.** The reference island's own aerial frame (§1b ref3) answers it with a
> MOSAIC of near-tones rather than a uniform canopy.
>
> **OUTCOME — D5 EXECUTED: THE BEAUTY PASS (2026-08-14).** The owner accepted +1.11 ms and
> asked for "more beautiful trees"; the budget being settled, this pass spends COLOUR and
> COMPOSITION only — zero new geometry. Evidence:
> `artifacts/odyssey/act2-forest-journey/beauty-p{030,050}.png`.
>
> **1. THE DISTANCE COLLAPSE (§1b R9 + Hoa's law).** Distant trees now drop BANDS, not just
> polygons: past FLAT_NEAR=220 u the three-tone structure folds toward the species' mid tone,
> reaching one tone by 950 u, with the light term flattening on the same ramp — the paint's
> half of what the LOD chain does for geometry, and Firewatch's own stated intent ("it
> flattens the shapes too… which is actually what we want").
>
> **2. PRE-SATURATION, because the downstream desaturators cannot be retuned from here.**
> Measured against R9 the far forest first came back at **4.5–4.6× desaturation** versus the
> references' 2–3×, and softening the flatten's own sky pull moved it by NOISE (4.51 → 4.61)
> — `applyAerial` and the grade's 0.72 were the desaturators all along. The far tone now
> leans AWAY from its luma before the haze leans it back (the overshoot-for-the-grade law, in
> saturation). Swept 1.75 → 2.4 → 3.0 → settled **2.0**:
>
> | metric | reference band | shipped |
> |---|---|---|
> | far/near saturation ratio | 2–3× | **3.54×** — above band, deliberately |
> | far−near luma | +22..+51 | **+41.6** ✓ |
> | far−near normB | ~+0.14 | **+0.153** ✓ |
>
> ⚠️ **THE EYE OUTRANKED THE METRIC, and the reason is recorded:** at presat 3.0 the sat ratio
> measured a perfect 3.06 — and the capture showed a **NEON-GREEN RIDGE LINE** where distant
> trees sit against sky: the haze that presat exists to cancel is weakest exactly there, so
> the compensation overshoots on ridge silhouettes first. The measurement box (mid-slope
> forest) could not see it. Settled one step back: sat modestly above band, no neon.
> *A metric samples one place; a defect picks another.*
>
> **3. THE BLACK NOTES RETURNED.** The anchor cypress had fallen to ~2% spread thin — no
> punctuation at all. A concentrated boost inside the top slice of its own patch field
> (`patch > 0.78 → +0.85`) plants it as tight STANDS instead: share 2.0 → 2.6%, and **100% of
> anchors now stand within 40 u of another** — rare almost everywhere, decisive in rows, the
> way ref3 plants them. The <12% rarity gate still holds.

> **OUTCOME — THE DIAGNOSIS, THE CUT, AND THE RE-MEASURE (2026-08-14, same session).**
>
> ⚠️ **THE OBVIOUS SUSPECT WAS INNOCENT, AND THE RECOMMENDATION BUILT ON IT WAS WRONG.** The
> far tier — 13,069 trees, named in this plan as "where any real saving lives" — measured
> already lean: 18 tris/tree against the incumbent's 30. The CPU breakdown of visible
> triangles at p=0.225 found the real shape: **the HERO FRINGE was 45% of the forest's visible
> triangles on 3% of its trees** (524 trees × ~460), and the mid tier ran 88 tris/tree.
> Diagnose before surgery; the patient's chart said the other leg.
>
> **THE CUT:** fringe plates 300 → 140, sprigs 190 → 85, and `midLean` — the mid tier drops to
> the far tier's detail-0 hull (still crinkled, still lobed; the far tier proved the form)
> keeping its trunk. Swept on the CPU ledger to ~1.44× incumbent visible triangles, exposed as
> `setForestFringe` — the sweep instrument doubling as the future quality-lane lever.
>
> **RE-MEASURED, Lane B, drift 0.066 (one tick), draws content-matched:**
>
> | | before | after |
> |---|---|---|
> | forestV2Ms | 3.998 | **2.621** (−1.377) |
> | station p50 | 10.813 (over max) | **9.437** vs max 10.6 — fits, 1.16 margin |
> | station p95 | 20.185 (blowout) | **9.765** — gone |
>
> ⚠️ The CPU triangle model under-predicted by ~0.4 ms (est 2.21): vertex count is the dominant
> term but not the only one. Estimates steer; only pairs decide.
>
> **GATE F2 AS AUTHORED STILL FAILS** (2.621 vs ≤ 1.807), **and revising it is D5, an owner
> decision** — F2's "+0.30 ms" was authored before any number existed. The question it now
> asks precisely: is the five-species zoned roster worth a net **+1.11 ms** over the incumbent
> on Lane B (inside the cell max with margin), or must it cost no more than +0.30, which the
> sweep suggests means giving up most of the hero fringe? The look at the lean shape holds
> (`artifacts/odyssey/act2-forest-journey/lean-p{030,050}.png`).

> **OUTCOME — GATE F2 MEASURED ON LANE B, 2026-08-14: THE ROSTER FAILS IT BY 2.191 ms.**
> Owner authorised the iGPU run knowing the TDR history. Lane B, Radeon 610M (amd/rdna-2),
> 1280×720, Medium, `--low-power --seek 0.225 --chapters 2,3`, all four configurations in ONE
> window. **ADMISSIBLE: `baselineDriftMs` EXACTLY 0.000**, draws content-matched min==max in
> every window (46/32/50/46), and the two baselines returned an identical p50 of 8.323072.
> Report: `gpu-split-laneb-forest-shore-p225.json`.
>
> | configuration | p50 | p95 | draws | triangles |
> |---|---|---|---|---|
> | baseline (incumbent) | 8.323072 | 8.716288 | 46 | 679,799 |
> | no-forest | 6.815744 | 7.012352 | 32 | 519,809 |
> | forest-v2 (roster) | **10.81344** | **20.185088** | 50 | 998,866 |
> | baseline-repeat | 8.323072 | 8.519680 | 46 | 679,799 |
>
> **`forestMs` = 1.507 ms** — the incumbent forest is **15.7% of this station's entire frame**,
> the first time that has ever been known. **`forestV2Ms` = 3.998 ms**, i.e. the roster costs
> **2.65× the incumbent**. Gate F2 (`≤ forestMs + 0.30`) reads **3.998 ≤ 1.807: FAILS by
> 2.191 ms.** The roster as built would take the shoreline station from 8.32 to 10.81 p50
> against a 10.6 max, with p95 blowing out to 20.19 against the incumbent's 8.72.
>
> ⚠️ **LANE A FLATTERED IT BY A FACTOR OF ~19, AND THIS IS THE SHARPEST EVIDENCE IN THE LEDGER
> FOR WHY LANE B IS THE DECISION LANE.** The identical pair on the RTX at 1080p measured a
> 2-timer-tick delta and PASSED with room. On the 4-ROP part the same delta is 2.491 ms. A
> system 2.2–3.0× the triangles costs 2 ticks on a roomy GPU and a third of the frame on the
> budget one — so a Lane A pass says nothing whatsoever about Lane B, and any future wave that
> reads one as reassurance about the other is repeating this.
>
> **DRAWS ARE NOT THE PROBLEM — TRIANGLES ARE.** 14 forest draws incumbent vs 18 roster, both
> far under the ceiling; the per-LOD bucket grid did its job. But drawn triangles go 159,990 →
> 479,057 (3.0×) at this station. The forest's own header law says its cost is VERTEX, and this
> pair finally quantifies that on the lane that matters.
>
> **WHAT THIS MEANS FOR THE PLAN.** The roster cannot ship as built — not the paint, not the
> zoning, not the species: the GEOMETRY BUDGET. The levers, cheapest first: the far tier is
> 13,069 trees and the dominant triangle mass, so it is where any real saving lives; the hero
> fringe (300 plates + 190 sprigs) is the most expensive per tree; and the mid/far LOD
> boundaries move triangles in bulk (the ledger already shows hero≤110/mid≤420 at 1.05×
> incumbent versus today's 1.36×). **The mid-tier fringe extension is now definitively off the
> table** at 1.70× — it was parked for want of a number and the number has arrived saying no.

> **OUTCOME — THE FOREST HAS A MEASURED PRICE, 2026-08-14. First one in the project's life.**
>
> Lane A, RTX 5080, 1080p, High, `--seek 0.42 --chapters 3,4,5`, warm-up discarded,
> `--only baseline,no-forest,forest-v2,baseline-repeat` in ONE window so the two forests are
> comparable to each other. **ADMISSIBLE: `baselineDriftMs` EXACTLY 0.000** — the gold standard
> this repo only sees on a genuinely quiet machine — with draw calls content-matched min==max
> in all four windows. Report: `gpu-split-lanea-forest-p042.json`.
>
> | configuration | p50 | draws | triangles |
> |---|---|---|---|
> | baseline (incumbent forest) | 0.393216 | 47 | 756,501 |
> | no-forest | 0.327680 | 28 | 517,761 |
> | forest-v2 (zoned roster) | 0.524288 | 47 | 1,044,078 |
> | baseline-repeat | 0.393216 | 47 | 756,501 |
>
> **`forestMs` = 0.066 ms · `forestV2Ms` = 0.197 ms.** Wave 0a's cell is filled at last, and
> Gate F2 (`forestV2Ms ≤ forestMs + 0.30`) reads **0.197 ≤ 0.366 — PASSES on Lane A with room.**
>
> **THE DRAW COUNT IS IDENTICAL, WHICH IS THE STRUCTURAL RESULT.** Both forests cost 19 visible
> draws at this station (47 − 28), and the whole world sits at 47 against the Lane A ceiling of
> 90. The per-LOD bucket grid is what bought that: a uniform 420 u grid projected 42–57 visible
> buckets, and coarsening mid to 840 and far to 1,680 brought it back under the incumbent's own
> count. The roster draws **2.2× the triangles** (526,317 vs 238,740) for **2 extra timer
> ticks** — the file's own "tree cost is VERTEX, not fill" law behaving exactly as written.
>
> ⚠️ **THIS IS NOT THE GATED NUMBER, AND MUST NOT BE QUOTED AS ONE.** The gate is specified on
> **LANE B** (Radeon 610M, 720p) at **p=0.225** — the lane with no headroom (9.9 ms against a
> 7.0 budget). Lane A is the roomy lane. Lane B was NOT run because that is the iGPU which has
> TDR-bluescreened this machine during WebGPU capture, and choosing to risk that is the owner's
> call, not an agent's.
>
> ⚠️ **QUANTISATION IS PART OF THE READING.** 0.066 is EXACTLY one 65.536 µs tick and 0.197
> exactly three. Read them as **1 tick and 3 ticks** — the incumbent forest sits at Lane A's
> resolution floor, which is the documented Lane A trap (at 720p everything hides inside a
> tick; at 1080p a system this size only just resolves).
>
> **WHAT THIS UNPARKS:** the fringe extension to the mid tier, declined earlier for having no
> number to fund it, now has one — on the wrong lane. If Lane B confirms the shape, 1.70×
> triangles for two more ticks is a defensible trade; if it does not, the parked plan stands.

> **THE CANOPY-TOP FLATNESS, ADDRESSED — and the first attempt at it measured NOTHING, which
> is the useful part (2026-08-14).**
>
> **THE COST DECISION FIRST.** The obvious next move was extending the leaf fringe past the
> hero tier. Measured, both routes land at **1.70x** the incumbent's triangles (hero radius
> 120 -> 190, or a reduced fringe across mid), against 1.36x today. **That work was declined,
> deliberately:** the forest has grown 462,810 -> 627,990 triangles across five waves with
> **not one measured millisecond**, on the lane with no headroom (9.9 ms against a 7.0
> budget). ADR-0016 exists precisely so unmeasured cost cannot fund more unmeasured cost. The
> fringe extension is parked behind `forestMs`, and the effort went to the open item that
> costs ZERO geometry and touches all 15,412 trees instead of 520.
>
> ⚠️ **ATTEMPT 1 — PER-TREE BAND-THRESHOLD JITTER — MEASURED NOTHING, AND THE REASON GENERALISES.**
> Nudging each tree's threshold along the ramp moved the crown-scale mosaic metric from **28.75
> to 29.03: inside noise.** The diagnosis was in the numbers all along: at the authored sun
> angle a canopy TOP computes wrap ~0.66 while the band ENDED at 0.58, so every top was already
> past the ramp and pinned to the lit tone. **Moving a threshold the pixels have already passed
> changes nothing — the band was SATURATED, not misplaced.** Worth stating as a rule, because
> the failure is invisible in code review and the fix looks identical to the bug.
>
> **ATTEMPT 2 — A THIRD TONE, PLACED WHERE CANOPY TOPS ACTUALLY SIT.** §1b R1 asks for 2-3
> quantised steps and this is the third: the lower pair (0.34..0.52) turns shade into a mid tone
> across the crown's flank, and the upper pair (0.60..0.78) straddles where tops genuinely
> compute — the only place a threshold can still do work when the camera looks down. The
> per-tree jitter now rides the UPPER edge, so it decides how much of each crown reaches full
> light. Mid tone is DERIVED from the species' own two colours, not authored a third time, so a
> palette edit cannot desynchronise three colours.
>
> **Measured, in-game, crown-scale mosaic (block-average at crown size, then spread BETWEEN
> blocks — tree-vs-gap contrast averages away inside a block, so what survives is
> crown-vs-crown):** two-tone **28.75** -> threshold jitter **29.03** -> three-tone **30.01**.
> A real but modest gain, and crowns now carry visible light/dark structure rather than one
> flat tone. **The flat-sheet problem is improved, not solved** — stated plainly because the
> metric says so.
>
> ⚠️ **AND A MEASUREMENT CAVEAT: the incumbent scores HIGHER on this metric (37.38) than any v2
> variant.** That is not the incumbent being better — its dark cones against pale ground carry
> big tree-vs-gap contrast that survives block averaging. The metric compares v2 variants to
> each other honestly; it does NOT rank v1 against v2.

> **OWNER REVIEW 3 — "what about the other tree types?" and "moving along the island it will
> be different trees closest to the camera" (2026-08-14). Both were right, and the second
> exposed a design inversion the first would have hidden.**
>
> **THE SPECIES GAP.** `appendLeafPlates` was called in the BROADLEAF builder only — so two of
> five species had a fringe and the three conifers were bare lathe cones. Fixed with drooping
> needle SPRIGS seeded on the tier rims (where a conifer's silhouette actually lives), sharing
> the same opaque emitter with a `droop` term: the reference pines are "saggy, irregularly
> spaced branches", and sprigs radiating straight out of a cone read as a bottle brush. Pine
> 72 → 262 tris, fir 81 → 271; forest 1.29× → 1.32× incumbent.
>
> ⚠️ **THE INVERSION: THE JOURNEY WAS SHOWING ONE SPECIES.** Measuring what stands nearest the
> rail along the path found the hero tier **81% a single species**, and from **p=0.28 to p=0.42
> the near field was 100% shore broadleaf** — a five-species roster that the player walks past
> and sees as one tree. Cause: the zone field made ALTITUDE primary, and `bandFit` returned a
> hard ZERO outside a species' band, so no region patch however strong could put a fir where
> the rail was low.
>
> **The reference island is the corrective, and it is a composition rule, not a tuning value:
> The Witness's zones are REGIONAL, not altitudinal** — ref3 has mustard, pink, cypress and
> deep-green stands side by side at much the same height. Altitude should say "firs prefer it
> up here", never "nothing else may grow here".
>
> **THREE ATTEMPTS, AND THE FIRST TWO FAILED FOR THE SAME REASON.** Adding a floor to `bandFit`
> (0 → 0.42) barely moved it; raising the patch's range barely moved it. **The multiply was the
> problem, not the floor's height** — while `fit` multiplied the whole score, an in-band species
> out-scored an out-of-band one at every patch value that mattered. Making it a SUM
> (`patch + fit × 0.45 + weightBias`) put the region in charge and left altitude worth about a
> quarter of the decision. Measured after:
>
> | station | before | after |
> |---|---|---|
> | p=0.28 | S1 100% | S1 100% |
> | p=0.42 | S1 100% | S1 84% · S4 14% · S2 2% |
> | p=0.50 | S1 68% | S1 51% · S2 27% · S4 22% |
> | p=0.57 | S1 52% | **S2 40%** · S1 36% · S4 24% |
> | p=0.64 | S3 31% | **S2 55%** · S4 35% · S1 9% |
>
> The journey now changes species under the camera, which is the thing the owner's observation
> was actually about. **Pure stands survive at some stations and that is CORRECT** — walking
> through the reference island's pink grove you see mostly pink; the defect was one species
> owning the whole path, not a species owning a stretch of it. Draws also fell 37 → 32.
> Evidence: `artifacts/odyssey/act2-forest-journey/p{034,050,057}.png`.
>
> **STILL OPEN, and it is the next thing the eye will find:** the fringe is HERO-TIER ONLY —
> 520 trees of 15,412 (3%). Mid (1,814) and far (13,069) have none, which is why conifers
> upslope still read as bare cones at any station. Extending to mid is ~3.5× the fringe
> geometry (~1.6× incumbent triangles) and wants the unmeasured `forestMs` first.

> **OWNER REVIEW 2 — "they don't have leaves like in The Witness and the fluffy trees"
> (2026-08-14). Alpha leaf cards were BUILT, JUDGED AND REVERTED at the owner's call.**
>
> The owner asked for the alpha route to be measured rather than assumed, and the reason was
> sound: **§1 finding 8 ruled alpha out on a BORROWED NUMBER.** The measured "opaque beats
> alpha ~20×" law came from a FULL-SCREEN TRANSPARENT SHEET whose cost was proven
> COVERAGE-INDEPENDENT — a different cost shape entirely from small cards on the ~520 trees
> nearest the rail. **Reusing a measurement across a change of cost shape is an assumption
> wearing a number's clothes**; the honest label was "unpriced", not "ruled out". That
> correction stands whatever the art verdict turned out to be.
>
> **BUILT:** alpha-tested leaf quads on the hero tier, a procedurally baked leaf-cluster alpha
> (no imported asset), a SEPARATE material so the hull kept early-Z, cards tilted 30–80° out of
> the tangent plane, random UV mirroring, and a `forest-v2-leaves` gpu-split configuration
> priced against `forest-v2` so the delta would isolate the fringe.
>
> **REVERTED, before pricing, on the LOOK.** The owner judged the result and rejected it, which
> makes the measurement moot — a number cannot fund a look nobody wants. All of it is removed:
> geometry emitter, baked alpha, material, meshes, board and rig flags, harness configuration
> and its polarity test. The tree is back to the opaque plates, verified by capture:
> `w3-reverted-p030.png` is **0.00% different** from the plates frame the owner had approved.
>
> **WHAT THE ATTEMPT IS WORTH KEEPING FOR** (so it is not re-litigated from scratch): the alpha
> route is now known to be *reachable* — it renders clean, with zero pipeline errors, and it
> does hit a finer leaf texture than opaque plates can. It was rejected on ART, not on cost or
> feasibility, and it was never priced. Four tuning lessons survive it, and they apply to any
> future fringe: cards in the hull's TANGENT plane read as painted rosettes (**a leaf card
> earns its alpha-test by breaking the OUTLINE**); one baked cluster on every card reads as a
> repeated STAMP without random UV mirroring; and across four passes the through-line was that
> **a leafy read is the DENSITY of the outline, not the size of its pieces** (170×0.30 = spikes,
> 300×0.135 = invisible).

> **OWNER REVIEW — "the canopy looks far from the style in The Witness" (2026-08-14). Correct,
> and the cause was three defects in the sculptor, not a tuning gap.** A single-species
> close-up (`?effect=act2-tree-audition&species=S1`) showed the diagnosis immediately: **a
> smooth dome on a stick**, where the reference is a countable cluster of rounded lumps.
>
> 1. **THE LOBES WERE PLACED INSIDE EACH OTHER.** Each lobe sat 0.18–0.48 crown-widths from the
>    axis with a RADIUS of 0.46–0.70 — so every lobe contained the axis and the union was one
>    sphere. **Placement distance must exceed lobe radius or a cluster cannot read as a
>    cluster.** Now 0.46–0.80 out, radius 0.34–0.50, and 7 lobes rather than 5.
> 2. **`SMIN_K` WAS 0.34 × crown width** — a blend wider than the lobes themselves, dissolving
>    what little separation remained. Now 0.13. The cloud field logged the identical tuning
>    ("SMIN_K melts generously"); the blend must JOIN masses, not erase them.
> 3. **THE SILHOUETTE CRINKLE THIS FILE'S HEADER PROMISED WAS NEVER IMPLEMENTED** — a comment
>    describing unwritten code, the same defect class as the snow flag. Now a real 3-D value
>    noise on the FIELD (so the traced surface gains bumps rather than the shading faking them),
>    amplitude bound to vertex density per the cloud sculptor's rule.
>
> ⚠️ **AND THE ONE THAT MATTERED MOST: A PURE BLOB NORMAL MAKES SCULPTING INVISIBLE.** The bake
> replaced each vertex's true normal with a direction radiating from the crown centre — smooth
> by construction — so every lobe and every crinkle vanished from the SHADING and survived only
> in silhouette. The canopy was a flat cutout with a ragged edge. The cloud field had already
> settled this: `FIELD_CENTROID_BEND = 0.30`, i.e. keep most of the real surface and *lean* it
> toward the mass. The broadleaf now bakes the **SDF gradient bent 30% toward the blob**, which
> is why the smooth-min union exists at all — a gradient is continuous across a smin join and
> is not across a plain min. Crown normals now span the full −1.0…1.0 in `.y` where the pure
> blob field was smooth. **Standing law: bending normals 100% toward a centroid does not soften
> a shape, it deletes it.**
>
> Also flattened the broadleaf crowns (wider than tall, as the references are) and softened the
> first crinkle pass, which at 0.115 out-ran the hull's facet size and read as CRUMPLED PAPER —
> *a displacement finer than the mesh can round adds facets, not form.*
> Measured after (canopy-only bands, graded rig): ratio **0.444 / 0.425**, sat **0.524 / 0.672**
> — in band, and the incumbent's over-saturated 0.698/0.794 is now behind us. Evidence:
> `artifacts/odyssey/act2-forest-w1/canopy-{before,after}.png`.
>
> **PARTIAL FIX APPLIED, HONESTLY REPORTED.** Per-tree value jitter widened ±6% → ±14% (a
> uniform scale, so hue is preserved exactly and a tree cannot leave its species). It visibly
> breaks the sheet up, but measured canopy tone SPREAD is essentially unchanged (v1 119.6 → v2
> 113.0 at the same box), because the spread in an aerial box is dominated by inter-tree gaps,
> not by canopy tone. **The canopy-top flatness is NOT solved and is carried as an open item**
> — the likely fix is a per-tree band-threshold offset so crowns sit at different points on the
> ramp, which is a Wave 3 paint change and wants an owner look first.
>
> ⚠️ **AND A MEASUREMENT CAVEAT WORTH KEEPING: THE §1b RATIO BAR DOES NOT TRANSFER TO AN AERIAL
> BOX.** In-game the near-canopy ratio measures 0.295 (v1) / 0.328 (v2), both below the
> 0.43–0.78 band, while the same forest on the eye-level rig measures 0.451–0.463. The box is
> not measuring canopy shade from above — it is catching the gaps between trees. The references
> are eye-level or low-aerial canopy shots, so the eye-level rig is the apples-to-apples
> comparison; an aerial bar would need its own reference and its own boxes.

### Wave 5 — the atomic swap (executes D3; NOTHING ships before the owner signs)
One commit: `forest-v2` becomes the default; the incumbent forest is RETAINED behind
`?odysseyWorldForestV1=1` (ADR-0015 — material + geometry still built on demand, one flag
from restoration); the migration flag `odysseyWorldForestV2` is **retired from the read
path entirely** (a dead lever reports innocence, not absence — the `odysseyWorldNoHeroes`
bisect law); `?odysseyWorldNoForest=1` keeps working against the new forest. Ledger closure:
re-baseline `odysseyAct2ShorelineGpuP50LaneBMs` (p=0.225), the STALE seam cell (p=0.105 —
already flagged "the forest gate … change[s] this station's content"), p=0.42 Lane A ms +
draws, and p=0.16 if draw counts moved (the gate-change precedent). ~10% ratchet convention
on re-baselined cells. Acceptance: graded captures at 4 stations + one low-tier + cold boot
×4 (the boot-warp/compile stall history) + dispose audit (`treeGeo` clones, both material
list memberships). The swap wave's outcome block records the before/after station table and
retires 0a's cell into a v2 note.

> **OUTCOME — WAVE 5 EXECUTED: THE SWAP, 2026-08-14.** The owner reviewed captures at every
> wave, accepted the price at D5, and directed the swap. **The zoned five-species roster is
> the shipped Act II forest.**
>
> **THE ATOMIC CHANGE:** `forestV2 = true` in the renderer; the incumbent cone forest RETAINED
> per ADR-0015 behind `?odysseyWorldForestV1=1` (verified restorable headless: 6,028 trees, no
> v2 stats, clean dispose); the migration flag `odysseyWorldForestV2` **retired from every
> read path** and its absence test-enforced (a dead lever reports innocence, not absence);
> gpu-split polarity flipped — `forestMs` now prices the SHIPPED roster, `forest-v1` is the
> opt-in lever for the retired forest, and the `forest-v2` configuration id is retired WITH
> its flag. Proven in-game with ZERO flags (manifest carries neither forest flag; the roster
> renders): `artifacts/odyssey/act2-forest-swapped/`.
>
> **LEDGER CLOSED, all pairs drift-admissible (0.000 / −0.066):**
>
> | cell | before | after |
> |---|---|---|
> | Lane A p=0.42 p50 | 0.39 | **0.46** (max 1.5) |
> | Lane A draws | 53 | **47** — the roster draws FEWER calls than the incumbent |
> | Lane B shoreline p50 | 9.63 | **9.50** (max 10.6, margin 1.10) |
> | seam p=0.105 | STALE | still stale, doubly annotated — needs its own pair |
>
> The p=0.16 underwater cell was NOT re-run, with the reasoning recorded: the forest is fully
> hidden there by the CPU submerged gate in both forests, so drawn content is unchanged; if a
> future pair at that station contradicts this, the reasoning was wrong, not the station.
>
> **What shipped, summarised for the reader who arrives here first:** five species × three
> growth stages, regional hue zoning that changes the trees under the camera along the journey,
> sculpted lobed crowns with SDF-gradient normals bent 30%, an opaque leaf/needle fringe on the
> hero tier, three-tone banding with per-tree variation, the measured R9 distance signature
> (band collapse + far pre-saturation), cypress black-note stands, travelling wind verified by
> capture — at a D5-accepted 2.621 ms on Lane B against the incumbent's 1.507, inside every
> ledger wall. The plan's remaining §5 items (Wave 6) stay parked with their revival
> conditions.

> **OUTCOME — THE VIVIDNESS PASS (owner direction, 2026-08-14, post-swap).** "I want the
> colors to pop like they do in The Witness" — trees (the yellows and oranges named
> specifically) AND the ground: grass, snow, stone, beach, sand, mountain. Zero geometry;
> palette only. Evidence: `artifacts/odyssey/act2-forest-{vivid/,journey/vivid-p*.png}`.
>
> **MEASURED FIRST (ref2 vs our frame), because the gap turned out to be structural, not a
> saturation slider:**
>
> | surface | Witness | ours before | defect |
> |---|---|---|---|
> | gold tree | rgb(158,125,48) sat 0.70 | rgb(137,149,92) sat 0.38 | **G ABOVE R — not gold at all** |
> | golden ground | sat 0.75 | sand sat 0.29 | washed tan |
> | rock | warm, sat ~0.65 (golden-lit) | sat 0.15 | authored GREY: (0.36,0.34,0.33) is sat 0.08 by construction |
> | grass slope | rich | sat 0.20 | pale |
>
> ⚠️ **TWO LAWS OUT OF THIS.** (1) **GOLD MEANS R ABOVE G** — a yellow that keeps green on top
> reads as chartreuse wash at any saturation; the birch's hue was wrong, not its intensity.
> (2) **NO GRADE CAN PUT BACK WHAT THE PALETTE NEVER HAD** — the rock's authored sat was 0.08;
> the washout was in the albedos, not the pipeline. Foliage/ground chroma lives in the R:G
> ratio and the ABSENCE of blue.
>
> **CHANGED:** grass (0.30,0.44,0.22)→(0.26,0.44,0.13) warm lime, authored sat 0.50→0.70;
> sand →(0.80,0.62,0.30) golden amber; rock →(0.47,0.41,0.34) warm cream-grey; snow
> →(0.97,0.96,0.93) sunlit rather than glacial; S4 birch crown →(0.430,0.310,0.085) — actual
> gold, R:G 1.39; S1 shore broadleaf leaned to the Witness lime-chartreuse. Measured after:
> sand sat 0.29→0.47, near canopy 0.68→0.85+, and the birch stands read as amber against the
> lime — the ref2 relationship.
>
> **A MEASUREMENT CAVEAT RECORDED:** box-sampling SPARSE SMALL CROWNS is unreliable — the gold
> stand's boxes kept reading G>R because green slope bleeds through the gaps between crowns.
> The frame shows gold; the box shows the slope. Sparse-object colour verdicts belong to the
> eye or to a mask, never to a rectangle.
>
> **OPEN, for the owner's eye:** S1's lime now measures sat ~0.93 — ABOVE the reference lime's
> ~0.66. It reads strong rather than neon in the graded frame, but it is the most saturated
> surface in the world now and one step past the reference; pulling it back is a one-number
> change if it tips. The reference's near-field HUE MIX (gold/orange/red interleaved with the
> greens by the water) is a zoning question, not a palette one — that is ref2's composition
> and our shore is deliberately the green chapter; the autumn mix lives upslope.

> **OUTCOME — PER-TREE HUE RAMPS (owner direction, 2026-08-14): "the yellow trees need
> different tones like the yellow, orange, red trees in The Witness".**
>
> ⚠️ **A UNIFORM VALUE JITTER STRUCTURALLY CANNOT DO THIS, and that is why the stands looked
> monotone.** Per-tree variation was `crown.map(c => c * jitter)` — a uniform SCALE, which
> moves lightness and preserves hue EXACTLY. Every gold tree was therefore the same gold at a
> different brightness. A test even enforced it ("jitters hue... without ever leaving its
> identity", asserting hue constant to 5 decimals) — correct for what the code did, and
> pinning the defect in place. **The reference grove's read is a hue RAMP tree by tree**:
> pale-yellow → gold → orange → deep red, all within one stand.
>
> **SHIPPED:** an optional `crownAlt` per species — a second authored end — with each tree
> picking a point along the ramp from its own hash. S4 birch now runs pale yellow
> (0.520,0.435,0.125) → deep red (0.395,0.105,0.040); the greens and conifers get quieter
> ramps of their own so no species is one flat tone. The distribution is skewed toward the
> bright end (`FOREST_HUE_SKEW` 1.7) because ref2 is gold-dominant with red PUNCTUATING —
> evenly spread it reads as fruit salad. Measured across 1,471 birches: **pale yellow 23% ·
> gold/amber 43% · orange 20% · deep red 14%.**
>
> ⚠️ **THE FIRST RAMP HAD NO BRIGHT END.** It started at the existing amber and ran to red, so
> the stand gained oranges and reds but no light notes — the reference's pale yellows were
> missing entirely. Widening the bright end is what made it read as autumn rather than as a
> rust stand. *A ramp is defined by BOTH ends; extending one is half a fix.*
>
> **The test was rewritten rather than deleted**, and the distinction is the point: what it was
> really protecting is "one authored identity, never a rainbow", which now means every tree's
> chromaticity must lie ON the segment between its species' two ends. It also asserts the ramp
> is genuinely USED (a species with two ends whose trees all sit at one of them is the same
> defect wearing a new face) and that the far end stays a minority.

> **OUTCOME — WAVE 6 UNPARKED: THE AUTUMN ROSTER (owner-requested, 2026-08-14).** Three parked
> items shipped as data, exactly as the machinery promised: **S6 red maple**, **S7 pink
> blossom** (D4 executed), and the **waterline autumn mix**. Evidence:
> `artifacts/odyssey/act2-forest-journey/autumn-p030.png`, `act2-forest-autumn/`.
>
> **Both species are authored against their own measured reference trees**: the maple against
> ref2's crimson (lit rgb 100.7/18.6/9.3 — R:G ≈ 5.4, the vividness law's extreme case), the
> blossom against ref3's pink (B ≈ R — the roster's one legitimate blue crown; and the pastel
> role's 0.88/1.45 recipe WAS this tree's measurement all along). The blossom groves reuse the
> anchor's concentrated-slice clause; the waterline clause boosts `waterline`-flagged species
> below y=325. Measured composition: **waterline = gold 65% / maple 23% / green 12%** — ref2's
> own mix — and **110 blossoms at 95% tight-clustering**: a destination, not confetti.
>
> ⚠️ **THE BLOSSOM FORCED A REAL LAW REFINEMENT: BLUE MAY DEEPEN, NEVER BRIGHTEN.** The shade
> recipe amplifies channels away from luma; pink's blue sits ABOVE luma, so the uniform gain
> pushed blue up and the derived shade drifted VIOLET — where every measured reference pink
> shades toward ROSE. Two wrong fixes first (a flat blue cap made the greens' normB rise,
> because holding B still while R falls moves the ratio the wrong way), then the correct form:
> blue takes the full gain only downward. The luma ratio is then enforced EXACTLY by a final
> renormalisation — the one-owner law by construction rather than approximation. The presence
> gate also split into presence-vs-share: a grove at 0.7% of the island is ~110 trees, which is
> a real grove and its design, not a dead species.
>
> **BUDGET: PASSES WITH ROOM.** Pair re-run at drift 0.000: forestMs **2.949 ≤ 3.3** — cheaper
> than the five-species 3.211, because the mix shifted toward lighter broadleaf geometry.
> Station 9.765 vs max 10.6. Draws 49.

> **OUTCOME — WAVE 6 CLOSED, AND WITH IT THE PLAN (owner-directed finalisation, 2026-08-14).**
>
> **SHIPPED — the two unconditional items:**
> - **Framing trees**: 8 authored old-stage hero trees at 4 stations (`ODYSSEY_FOREST_FRAMING`,
>   the cloud field's FRAMING-role pattern) — a red maple over the water approach at p≈0.34,
>   gold-against-green at 0.42, the autumn pair at 0.50, two big conifers gating the climb at
>   0.57. Positions are real rail-adjacent coordinates; **Y is never frozen** — each tree seats
>   on the height mirror at build, and a site the terrain drowns is DROPPED, not floated
>   (test-enforced, including the drowning case). The two waterline stations (p≈0.28–0.30)
>   were surveyed and excluded: the ground beside the rail there measured 232–280 against the
>   290.3 planting floor — the rail is crossing water.
> - **Wind-lines**: the gust front expressed in LIGHTING as well as displacement — a slow
>   ripple of the upper band threshold travelling with the sway gusts, amplitude a fraction of
>   the band jitter so it can never flip a crown across a whole tone. Three ALU.
>   **Capture-verified**: forest-only diff between two `t` values rose 5.37% (sway alone) →
>   6.51% (sway + lines).
>
> **CLOSED AGAINST THEIR OWN TRIGGERS — the three conditional items, evaluated rather than
> silently dropped:**
> - **Understory** (trigger: "hero interiors read hollow from the rail") — NOT TRIGGERED. The
>   deciding evidence is the reference itself: ref2's ground beneath its autumn trees is OPEN
>   GOLD, and since the vividness pass ours carries the same read. Planting scrub would move
>   us AWAY from the reference.
> - **Far-ring silhouette forest** (trigger: "bare-slope reads beyond the 1450 u gate") — NOT
>   TRIGGERED. The terrain answers it: 97% of plantable ground sits below y≈396, and the
>   slopes beyond the gate are slope-capped rock and snow by altitude — there is no bare
>   forest band out there to fill.
> - **Terminator dapple** (trigger: "hero crowns read flat") — NOT TRIGGERED. Crowns carry
>   three tones, per-tree hue ramps, band jitter, wind-lines and an opaque fringe; flat is the
>   one thing they no longer are.
>
> **THE LEDGER, FULLY CLOSED, every pair drift-0.000:** final forestMs **3.08 ≤ 3.3** (framing
> + wind-lines cost 2 ticks over the 7-species 2.949); shoreline re-baselined **9.90** (margin
> 0.70); and the SEAM CELL — stale since before this plan began — un-staled at **14.94**
> against its 17.0 max, BETTER than its stale 15.4 despite the richer forest.
>
> **THE PLAN IS COMPLETE.** Every wave executed and measured, every owner decision taken
> (D-ref, D0–D6), every reversal recorded in place. What the incumbent's 30-triangle cone
> forest became: seven species with measured value roles and per-tree hue ramps, regional
> zoning that changes the trees under the camera, forked limbed trunks with three mesh
> variants and per-tree lean, sculpted crowns with an opaque fringe, the reference's measured
> distance signature, vivid ground, blossom groves, red maples at an autumn waterline, framing
> heroes at the journey's beats, and wind you can see in both the branches and the light — at
> 3.08 ms on the lane with no headroom, every millisecond of it signed for.

### Wave 6 — parked, priced, owner-gated (revival conditions attached)
- **Pink blossom zone (D4)** — S1 palette variant + zone-field patch near the Ch3 lake
  basin; pure data; revive when the owner wants ref2's showpiece note.
- **Authored framing trees** — a small owner-approved spec list at named stations (the
  cloud field's FRAMING-roles pattern; hero-LOD regardless of distance bin).
- **Wind-lines** — gust fronts expressed in the LIGHTING (band-threshold ripple riding the
  same gust field; the 80.lv Ghibli-island trick). One uniform + 3 ALU; probe behind a flag.
- **Understory band** — low opaque scrub/"vegetation wall" masses at forest interiors
  (finding 3's density illusion) — only if hero-LOD interiors read hollow from the rail.
- **Far-ring silhouette forest** — beyond the 1450 u gate the slopes are bare today; a
  merged static lump-forest (stillwater's 15-vert ShapeGeometry far-tree precedent, 2–3
  draws, no wind) if station reviews show bare-slope reads. Priced by the 0a instrument.
- **Terminator dapple at hero LOD** — Oga's detail-last rule; only after D3, only if hero
  crowns read flat in review.

## 6. Budget position (the numbers the plan stands on)

| Item | Value | Class |
|---|---|---|
| Whole Act II world, Lane A p=0.42 | 0.393 ms / 53 draws (max 1.5 / 90) | MEASURED |
| Lane B p=0.42 | 9.9 ms vs 7.0 budget — zero headroom, owner-blocked re-budget | MEASURED |
| Lane B shoreline p=0.225 (forest-facing cell) | 9.63 / max 10.6 | MEASURED |
| Incumbent forest cost | **UNKNOWN — Wave 0a's whole point** | — |
| Incumbent forest content | 15,427 trees / 40 chunks / 462,810 tris (high); 6,028 / 39 chunks (low) | MEASURED (read from the live build, Wave 0a) |
| Cloud-field calibration | 0.131 ms fixed + 0.0094 ms/mass, sublinear; 52 masses ≈ 0.197 ms | MEASURED |
| Opaque-vs-alpha | ~20× in opaque's favour; sheet cost coverage-independent | MEASURED |
| Timer quantum | 65.536 µs/tick — same-bucket = "below resolution", never zero | LAW |
| New-forest tri budgets | hero ≤ 400 / mid ≤ 90 / far ≤ 24; resident total target ≤ 1.25× incumbent per lane | BUDGET |
| Bake budget | roster ≤ 300 ms, test-asserted | BUDGET |
| Gate F2 | forestV2Ms ≤ forestMs + 0.30 ms (p=0.225, Lane B); draws ≤ 90 Lane A | GATE |
| Reserve levers, ordered | far-tier tri cut → mid-tier tri cut → hero band narrowing → count −15% (art lever last) | RESERVE |
| Dead levers, named | "reduce coverage/foliage to save fill" (coverage-independence law); "multiply by zero uniform" gating | DEAD |

## 7. Owner decisions

- **D-ref (now):** drop the reference screenshots into `public/playground-refs/` as
  `act2-trees-ref*.png` so Wave 0c can measure §1b's numeric bands.
  **✅ DONE 2026-08-14 — five refs delivered (see §1b's roster note).**
- **D0 (primed by Wave 0b):** does banded paint on blob normals clear the bar on the OLD
  geometry? Gates all geometry work. No → paint redesign first; the sunk cost is 2 sessions.
- **D1 (primed by Wave 1):** the roster — which of the 5 archetypes (+stages) ship; judged
  on the audition board against the refs. Also: are the committed conifer GLBs auditioned
  alongside (fallback F5)?
- **D2 (primed by Wave 2/3):** the zone map — per-zone palettes at the three stations on the
  graded rig; where the gold-birch stands sit; snow-dusting onset.
- **D3 (executes as Wave 5):** the swap. Judged against the §1b bar and the F2 gate,
  station table in hand.
- **D4 (Wave 6):** pink blossom zone — yes/where/no.
- **D5 — DECIDED 2026-08-14: "I accept the +1.11 and more beautiful trees."** Gate F2 is
  revised to **forestV2Ms ≤ 2.7 ms at p=0.225** (measured 2.621 + one tick), recorded in the
  ledger cell's max. The roster's budget is settled at the lean shape; remaining beauty work
  spends COLOUR and COMPOSITION, not triangles.
- **D6 — DECIDED 2026-08-14: "accept."** The forked limbs stay at their measured 3.211 ms;
  the ledger max moves to 3.3 and the shoreline cell re-baselines to 10.03. The shipped
  forest's full price is a net **+1.70 ms over the retired incumbent, accepted in two explicit
  owner steps** (D5 +1.11, D6 +0.59), each against a drift-0.000 pair — the plan's budget
  history is therefore a sequence of signed decisions, not drift.
- *(superseded)* **D6 (OPEN, primed by the limb pairs):** the fork vs the budget. The owner asked for varied
  trunk forms and branches; forked limbs carrying the crown lobes measure **forestMs 3.211**
  (4-limb cut, drift 0.000) against D5's 2.7 — over by 0.511 with the station still inside its
  outer wall (10.03 p50 / 10.35 p95 vs max 10.6). Intermediate cuts land ~2.85–3.0, still
  over: **the choice is nearly binary — limbs at ~3.2, or no limbs at 2.62.** Free variety
  (3 seeded mesh variants per species×LOD, per-tree lean) stays either way. Owner picks:
  accept ~3.2 (revise D5), or revert the limbs.

## 8. Files

| File | Change |
|---|---|
| `src/rendering/odyssey/world/odyssey-world-renderer.js` | forest slot: `forest`/`forestV2` options, builders imported, scatter v2 call, paint stack, gate loop untouched in shape; fog-false + dispose lists |
| `src/rendering/odyssey/world/odyssey-forest-species.js` | NEW — frozen specs (archetypes × stages, lobe/tier tables, palette roles) |
| `src/rendering/odyssey/world/odyssey-forest-geometry.js` | NEW — conifer lathe + broadleaf sculptor + bakes; lessons-as-tests |
| `src/rendering/odyssey/world/odyssey-forest.test.js` | NEW — determinism, budgets, variants-per-chunk, snow band, bake time, NaN/normalize guards |
| `src/rendering/odyssey/world/odyssey-world-lints.test.js` | list memberships auto-cover the new material; add far-tier wind-free + phase-from-origin source asserts |
| `src/rendering/odyssey/OdysseyBoardController.js` | `odysseyWorldNoForest` / migration `odysseyWorldForestV2` flags (retired at swap) |
| `scripts/odyssey-gpu-split.mjs` | CONFIGURATIONS `no-forest`, `forest-v2`; `forestMs`, `forestV2Ms` (polarity per §5) |
| `perf-budgets.json` | `odysseyAct2ForestMsLaneB` (tracked, null baseline); re-baselines at swap: shoreline, seam (stale), p=0.42, draws |
| `src/rendering/odyssey/world/odyssey-forest-flags.test.js` | NEW — policy test pinning flag defaults + polarities + gpu-split lever signs |
| `src/playground/effects/act2-tree-audition.effect.js` | NEW — roster audition board (koi pattern), `?ref=` splits |
| `src/playground/effects/act2-cloud-deck.effect.js` | unchanged — THE graded review rig (`?p`, `?worldOnly=forest`) |
| `public/playground-refs/act2-trees-ref{1,2,3}.png` | NEW — owner drop (D-ref) |
| `docs/ODYSSEY_ONE_WORLD_PLAN_2026-08.md` | annotate the "single hard-coded 1,450 u forest gate" note with a pointer here |

**Standing constraints carried whole:** playground-first with screenshot proof (CLAUDE.md;
one small effect per session — the TDR history); colour verdicts ONLY on the graded rig;
gpu-split numbers admissible only under ADR-0016 (drift-judged pairs, quiet machine,
counters verified); `material.fog=false` (the 4×-recurring trap); scatter never leaves the
±4500 bake interior (r=1750 is safe); the world build stays non-throwing (a throw silently
downgrades Act II to dioramas).

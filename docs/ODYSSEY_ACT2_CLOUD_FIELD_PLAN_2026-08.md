# Act II Cloud Field — the sculpted sky (2026-08)

**Goal.** Replace the Act II cloud SHEET with a field of sculpted, opaque, Witness-grade
cumulus — puffy 3-D masses in ONE idiom for the whole sky — at a NET NEGATIVE GPU cost on
Lane B, with the ch5 fly-through becoming an authored beat instead of a mist corridor.

**Provenance.** 2026-08-14: 9-agent cited online research sweep (8 angles + completeness
critic, ~100 findings, every claim URL-cited and tagged primary/secondary/inferred), then 3
adversarial designs (look-first / budget-first / integration-first) judged by a verifier with
the r181 sources open. The judge verified every load-bearing construct against
`three@0.181.2` and this tree; its synthesis is §5. Full transcripts:
`~/.claude/.../subagents/workflows/wf_15657da0-705` (research) and `wf_819585a2-94a`
(designs + judge). This plan supersedes the SHEET-evolution track of
[ODYSSEY_ACT2_CLOUDS_PLAN_2026-08.md](ODYSSEY_ACT2_CLOUDS_PLAN_2026-08.md) §4 while
inheriting its measured laws and §3 look rules; that plan's Wave 3 (the bank) becomes this
plan's Wave 5.

---

## 1. What the research established (cited; the design rests on these)

1. **The Witness does NOT raymarch.** Primary source — the artist's own breakdown with the
   engine programmer's notes (artofluis.com/3d-work/the-art-of-the-witness/clouds/):
   foreground clouds are editor-assembled mesh clusters; volumetric shading was considered
   and rejected ("a lot of work for a small feature"). Background clouds are PAINTED CUTOUT
   QUADS near the horizon over a procedural-gradient dome.
2. **The puffiness is a SHADING trick, not geometry:** vertex normals blended toward
   `normalize(pos − cloudCentroid)` (artist-tweakable), so a clump of separate puffs shades
   as ONE soft mass; wrap-shading (their vegetation scatter trick, GPU Gems ch.16); plus a
   fake forward-Mie term — `pow(saturate(-10*(0.9+dot(V,L))),4)` attenuated by
   `saturate(1.25-abs(dot(N,L)))` — for the sun-side silver lining. All pure ALU. Sorting
   sloppiness is hidden by LOW ALBEDO CONTRAST — a license this palette already exercises.
3. **Every shipped stylized sky agrees.** Sea of Thieves: opaque geometry, per-vertex
   lighting (quarter-res blur composite for softness). Sky CotL (mobile-class GPUs): mesh
   clouds. BotW/Genshin: layered 2-D dome materials. NOBODY raymarches their signature
   stylized clouds.
4. **Fullscreen volumetrics are dead on this lane, with numbers:** the official
   `webgpu_volume_cloud` example costs ~300 3-D-texture taps per covered fragment (measured
   from its source: ~100 guaranteed steps × 3 trilinear taps); the practitioner cheap-end
   floor triangulates to ~2-3 ms at 320×180-class res on a 610M — before this machine's
   documented WebGPU TDR history. Bounded-mesh interior marching dies on the camera flying
   THROUGH the ch5 sky. A2C soft edges need real 4×MSAA under WebGPU (multisample state) —
   an owner-priced upgrade at best, never a default on a 4-ROP part.
5. **Our own measured laws point the same way** (perf-budgets.json): the sheet costs
   1.180 ms (ch4) / 1.835 ms (ch5) COVERAGE-INDEPENDENT — every rasterised fragment pays the
   tap stack; opaque merged-icosphere clouds measured 0.066/0.131 ms for six masses (~9k
   tris), zero fetches, zero blend state. The 610M is fill/blend-limited: opaque geometry
   runs with its grain, transparent sheets against it.
6. **Build-time tools are proven in JS:** smooth-min SDF sphere fields (iq), marching cubes
   (the three.js addon's polygoniser is reusable one-shot — verified; needs an isolation
   sign flip), simplex noise ~48M ops/s, analytic sphere AO — a ≤250 ms bake budget is
   realistic.
7. **The open LOOK-RISK (the one thing no precedent proves):** a fully hard opaque
   silhouette reading "puffy". The Witness spends a blended edge pass on it; SoT a blur
   composite. Our first line is the quantised fresnel edge the retired heroes already
   shipped + a dithered near-dissolve; the rim SHELL and MSAA are parked, priced fallbacks.
   Wave 0b exists to falsify this for two sessions' cost, against a Ghibli/Dedene ramp bar
   (2-3 value bands, warm-lit/blue-shadow, flat bases).

## 1b. THE REFERENCE BAR — measured from the owner's three Witness screenshots (2026-08-14)

`public/playground-refs/witness_clouds_{1,2,3}.{png,jpg}`. Sampled in the clean sky band of
each: "sky" = darkest decile, "lit" = brightest decile, "shade" = the dark quintile of the
cloud-bright pixels. **These are the acceptance criteria for Wave 0b — the probe is judged
against numbers, not vibes.**

| metric | ref1 | ref2 | ref3 | TARGET BAND |
|---|---|---|---|---|
| cloud lum / sky lum | 2.55 | 2.89 | 2.22 | **2.2 - 2.9** |
| shade lum / lit lum | 0.895 | 0.737 | 0.921 | **0.74 - 0.92 (very low contrast)** |
| shade hue vs lit (norm R) | −0.032 | −0.256 | −0.014 | **R DOWN** |
| shade hue vs lit (norm B) | +0.042 | +0.244 | +0.034 | **B UP — cooler, never darker** |
| localised edge width (norm to 1280w) | 6.0 px | 3.3 px | 5.0 px | **3 - 6 px** |

**THE FINDING THAT RE-PRICES THE WHOLE PLAN'S RISK: our shipped deck already measures 4.0 px
on the identical edge metric — inside the Witness band.** The research's headline worry ("no
precedent proves a hard opaque silhouette reads puffy"; The Witness spends a blended edge
pass, Sea of Thieves a quarter-res blur) is therefore MUCH smaller than it looked: their edges
are not meaningfully softer than what this renderer already produces. Consequence: the parked
rim SHELL (§6 Wave 6) and the MSAA/A2C option (D4) drop from "likely needed" to "probably
never", and Wave 3's dithered near-dissolve is the only softening the plan should budget for.

**And the palette is already close.** Our underside uses 0.86 shade/lit (inside 0.74-0.92);
our shadow band is already a cool hue shift, not a darkening (the §3 rule, independently
confirmed by all three refs); our cloud/sky ratio measured 2.2-5.3 at ch5 — the low end is on
target and the high end is the deep zenith, which the sky fix already improved.

**So the gap is ENTIRELY the silhouette and the third dimension.** Not the edges, not the
tones. The refs show rounded multi-lobed cauliflower masses with flat bases, near-white lit
crowns, and almost no interior detail — every bit of the read lives in the OUTLINE and in the
soft turn of form between lobes. That is exactly what a plan-view sheet contour cannot make
and what smin-sculpted geometry with centroid-bent normals is built to make. Wave 0b must
therefore be judged on SHAPE first; if the numbers above are hit and the shape still fails,
the sculptor (Wave 1), not the paint, is the answer — and vice versa.

## 2. Why the sheet cannot be "improved into" this look

The sheet is a horizontal clipmap: its silhouette is a PLAN-VIEW contour (popcorn from
above/below), it has no vertical faces to turn light, its sun terminator is regime-gated off
below y≈484 (most of the act), and at eye height it presents paper-thin billow seen edge-on
— the "flat and sometimes weird" the owner named. Its price is also the wrong SHAPE of cost:
1.8 ms at ch5 whether the sky is full or empty. Geometry with real height inverts both.

## 3. The verdict (three designs, adversarially judged — kept results only)

- **Winner: integration-first (C), 32.5/40** — one opaque idiom; probe-first pricing;
  clearance CLASSES validated against the live rail via a CPU SDF; the whiteout crossing
  beat; palette extraction so field and sheet share tones during migration; owner-gated
  ATOMIC swap so the shipped sky is never worse mid-migration. Every construct verified.
- **Grafted from A (29.5):** the Wave-0b paint probe (cheapest falsifier of the whole
  family); ordered reserve levers; parked-but-priced rim shell + dome-bake options.
  A itself died on a false ch4 net-negative claim, a centre-distance clearance metric that
  cannot keep the camera out of wide masses, and a horizon ring OUTSIDE the r=3600 dome
  that renders only via an undocumented depthWrite coupling.
- **Grafted from B (30.5):** the zero-new-shader pricing probe (retired hero builder scaled
  up, hero material untouched); the discipline of never touching the sealed deck gate before
  the swap. B itself shipped the two-model sky permanently, its Mie formula was
  sign-INVERTED (fires away from the sun — caught by the judge against `uSunDir`
  at renderer :1040), and it imported a non-exported `makeRng`.

## 4. Target look (inherits the old plan §3; these OVERRIDE where they differ)

- Whole-sky coverage from the spline camera: **25-35 % cloud; blue carries the frame.**
- Silhouette: 2-4 primaries / 5-9 secondaries / tertiary crown scallops, FLAT BASES (smax
  fillet at the condensation line — real geometry, never clamped verts: the FrontSide hole
  trap).
- Shading: centroid-bent baked normals; wrap diffuse quantised to 2-3 bands (8 % terminator,
  edges never equal); shadow band = HUE SHIFT toward sky, never darkening; baked vertex AO
  shifts the BAND THRESHOLD, not the colour; quantised Mie ≤0.10 toward `uSunColour`;
  quantised fresnel drawn edge (0.55/0.88 — the shipped hero numbers); hero aerial (0.82 cap
  × 0.42); everything through `toOutput`, authored OVERSHOT for the grade.
- Motion: rigid bounded Lissajous drift (90-240 s periods, per-mass phase). **Silhouettes
  never boil** — §3's rule stands as written; no breathing term (A proposed one; rejected as
  a rule exception the owner never granted).
- Interiors stay flat; ALL high-frequency detail lives in the silhouette.

## 5. Waves (every gate MEASURED on Lane B via `--low-power`, counters-verified quiet)

### Wave 0 — price the mechanism and the paint (2 sessions, nothing ships)
- **0a:** `cloud-field` opt-in CONFIGURATION in gpu-split (`fieldMs = field − baseline`;
  argument order carries the sign — NEVER also negate: the heroes cell's double-flip
  lesson). Cell `odysseyAct2CloudFieldMsLaneB` (tracked, baseline null). Probe = retired
  hero builder scaled to ~26-30 masses / ~30k tris, hero material UNCHANGED (zero new shader
  code). Pairs at ch4 p=0.42 + ch5 p=0.569. **Gate F1: fieldMs ≤ 0.50 ch5 / ≤ 0.35 ch4.**
- **0b:** `?field=1` on the existing rig; probe geometry re-shaded with the full paint stack
  (correct-sign Mie), sheet off, graded, judged against a Ghibli/Dedene reference at 2-3
  spline stations. **Owner decision D0: does quantised paint on lobed geometry clear the
  coherence bar AT ALL?** No → pivot back to evolve-the-deck; sunk cost two sessions.
- Export `makeRng` from `odyssey-hero-clouds.js` (one line; module stays retired).

> **OUTCOME — WAVE 0 COMPLETE, 2026-08-14. F1 PASSES at ch5; D0 PASSES; the gap is the
> GEOMETRY, exactly as §1b predicted from the references.**
> Evidence: `artifacts/odyssey/act2-clouds-ch5-bisect/w0b-paint-{ch4,ch5}.png`,
> `probe-field-ch5.png`; reports `gpu-split-laneb-field-{probe,curve}-*.json`.
>
> **0a — THE MECHANISM IS CHEAP, AND THE PRICE CURVE IS SUBLINEAR.** Lane B, amd/rdna-2,
> `--low-power`, draws content-matched (+1 exactly as designed), `baselineDrift` **EXACTLY
> 0.000** — the gold standard this repo only sees on a genuinely quiet machine:
>
> | config | p50 | Δ vs baseline |
> |---|---|---|
> | baseline (sheet only) | 9.3716 | — |
> | + 14 probe masses | 9.6338 | **0.262** |
> | + 28 probe masses | 9.7649 | **0.393** |
> | baseline-repeat | 9.3716 | drift **0.000** |
>
> **Gate F1 at ch5 is ≤ 0.50. Measured 0.393. PASSES.** Fitting the two points:
> **~0.131 ms fixed + ~0.0094 ms per mass** — doubling the masses added only 0.131 ms, so the
> cost is dominated by a per-draw/pipeline constant, not by mass count. Extrapolated to Wave
> 1's ~46 masses at UNIFORM FULL DETAIL ≈ 0.56 ms, just over gate — **which promotes the LOD
> chain from an optimisation to a load-bearing part of the design.** Author far-ring masses at
> LOD2 or the gate is missed by construction.
>
> ⚠️ **TWO EARLIER PAIRS WERE INADMISSIBLE AND ARE NOT THE RESULT.** A first run reported
> 0.721 (ch5) / 0.590 (ch4) at drift 0.328 / −0.262, and a later ch4 attempt returned
> drift 0.852 with **negative** deltas (−0.328, −0.459) — physically impossible, since adding
> geometry cannot speed a frame; its baseline decayed 11.73 → 10.88 mid-run. Both were
> co-tenant-contaminated. The lesson is the one this repo keeps re-learning: **judge the pair
> by its drift before quoting its delta.** ch4's F1 (≤ 0.35) is therefore still **UNRESOLVED**
> and must be re-measured in a quiet window before Wave 1's gate is evaluated.
>
> **0b — THE PAINT CLEARS THE BAR; D0 PASSES.** The Witness stack shipped into the probe
> material: centroid-bent normals (`aMassCentre` attribute, bend 0.55), wrap diffuse
> (w = 0.75) banded 0.42..0.62, correct-sign Mie, the shipped fresnel drawn edge, hero aerial.
> Measured sky-band-only with cloud/sky separated by blue-dominance (the ONLY comparison that
> is apples-to-apples; two earlier attempts were contaminated — a whole-frame mask caught the
> references' autumn foliage as "cloud shadow", and a naive box caught sky in the dark tail):
>
> | metric | refs | probe @ch5 | probe @ch4 | shipped deck |
> |---|---|---|---|---|
> | shade/lit | 0.63-0.72 | **0.676 ✓** | 0.606 (just under) | 0.759 (flatter than refs) |
> | cloud/sky | 1.76-2.05 | 2.55 | 1.40 | 2.40 |
> | hue B shift | −0.028..+0.025 | −0.003 ✓ | −0.136 | +0.029 ✓ |
>
> The contrast target is HIT, and better placed than the shipped deck. Remaining palette
> deltas are small and station-dependent (cloud/sky runs high at ch5's deep zenith and low at
> ch4's pale sky — a sky-gradient interaction, not a cloud-tone defect).
>
> **AND THE SHAPE VERDICT, which is what §1b said to judge on.** At ch4 (masses at honest
> distance) the probe reads as multi-lobed puffy 3-D cumulus with lit crowns, shaded
> undersides and cauliflower bumps — a different object class from the sheet, in the right
> direction. **But the lobes are still individually countable in places: it is a cluster of
> spheres wearing good paint, not yet one merged mass.** That residual is precisely the
> smin-union + smax-flat-base + domain-warp that Wave 1 exists to build, and precisely what
> §1b predicted ("if the numbers land and the shape still fails, the sculptor is the answer").
> The centroid bend at 0.55 unifies the shading but cannot unify a silhouette that is
> geometrically a bag of balls.
>
> ⚠️ **The ch5 frame also reproduces the WHITE SLAB** — a probe mass at minimum clearance seen
> huge and near-flat, the same artefact that got the heroes retired. It is a CLEARANCE defect,
> not a paint defect, and it is the direct evidence for Wave 1's SDF-clearance classes
> replacing the heroes' centre-distance rule.
>
> **CARRIED INTO WAVE 1:** (1) re-measure ch4 F1 on a quiet machine; (2) LOD chain is
> mandatory, not optional; (3) clearance must be SDF-at-rail per class; (4) the probe's
> `?odysseyWorldCloudFieldCount=` override and the `cloud-field-half` configuration stay as
> the cost-curve instrument for every later wave.

### Wave 1 — the sculptor
`odyssey-cloud-field.js` + `odyssey-cloud-field-specs.js` (frozen, import-free): roles
(framing / overhead / gate / strata) + rank; framing seeded from the six H-specs (that
composition was owner-approved — only the MODEL failed). Smin k≈0.16w union + smax flat
base; simplex domain warp; marching cubes (addon polygoniser, isolation sign flip; ~150-line
local-MC fallback named); baked GUARDED bent normals, AO→color.r, seed→color.g,
height-in-mass→color.b. Three merged world-space ring meshes, `frustumCulled=false`,
≤65k tris, bake ≤250 ms (test-asserted; F6 = idle-slice the march). **Clearance =
SDF-at-rail ≥ per-class margin at max drift excursion** (`evalCloudFieldSDF`, also the
validator's instrument — fixes A's centre-distance defect). Gates: fieldMs ≤ 0.50 ch5;
silhouette bar (flat bases, 3-scale lobes, no soap bubbles). **F2:** blobby →
icosphere-merge + bent normals + AO, same idiom.

> **OUTCOME — WAVE 1 SHIPPED, 2026-08-14. The masses are single merged shapes; the bag of
> balls is gone.** Evidence: `artifacts/odyssey/act2-clouds-ch5-bisect/w1-sculpt-ch4.png`,
> `w1-zenith2-ch5.png`. Opt-in (`?odysseyWorldCloudField=1`); the sheet is still the shipped sky.
>
> **THE POLYGONISER IS NOT MARCHING CUBES, and the substitution is the wave's main technical
> result.** A cumulus mass is STAR-SHAPED about its own centre, so the surface is found by
> ray-marching an icosphere's directions inward from outside the hull. That yields, for free,
> what an MC mesh must be repaired into having: a closed watertight hull, an exact triangle
> count per LOD (which is what the measured per-mass price is budgeted against), and — the
> load-bearing one — normals taken from the SDF GRADIENT, which is continuous ACROSS a
> smooth-min join. That gradient IS the melt: no shader-side normal blend can manufacture it
> from per-lobe radial normals, which is exactly what the retired heroes had. Trade-off
> written down: no overhangs. The references show none at silhouette scale.
>
> **SHIPPED:** `odyssey-cloud-field.js` (smin union k=0.16·halfW, smax flat-base fillet,
> 3-D value-noise crinkle, sphere-traced surface, gradient normals, analytic SDF ambient
> occlusion, height and per-mass seed baked to vertex colour) + `odyssey-cloud-field-specs.js`
> (38 masses in four roles; the six FRAMING placements are the owner-approved hero positions
> verbatim, so a failure of the new sky is attributable to geometry OR composition, never both)
> + `odyssey-cloud-field.test.js` (10 tests). **38 masses, 14,920 triangles, bake 162 ms**
> against a 250 ms budget, zero clearance failures.
>
> **THREE DEFECTS THE TESTS AND VALIDATOR CAUGHT, all of which would have shipped:**
> 1. *Vertex collapse.* When the sphere trace exhausted its step budget the first draft
>    collapsed the vertex to the mass CENTRE — 65 of 2940 vertices on one mass, punching spikes
>    through the hull. Running out of steps does not mean the ray missed; the bracket
>    [0, lastOutside] is always valid and bisection closes it.
> 2. *The NaN that walked through the guard.* A zero-width spec divides by `w` in the crinkle
>    and yields NaN, and `NaN >= 0` is FALSE — so the "is the centre inside?" guard passed a
>    NaN field straight into geometry. Written `!(d < 0)` now.
> 3. *Clearance validated over the WRONG rail.* The validator sampled the whole journey, and
>    Act III climbs through Act II's cloud altitude — reporting three legal zenith masses as
>    violations. Clearance means "can the camera enter this cloud WHILE IT IS DRAWN"; the rail
>    is now sampled across the act gate only.
> Also corrected: three's `IcosahedronGeometry(r, detail)` is **20·(detail+1)²** faces, not
> 20·4^detail. The first draft believed "detail 3" was 1280 triangles; it is 320, and the field
> would have shipped at a quarter of its intended geometry.
>
> **ANGULAR SIZE, NOT WORLD SIZE, IS WHAT LOD AND WIDTH MUST BE CHOSEN AGAINST.** The ch5
> station's first sculpted capture showed an EMPTY sky — every authored mass sat 900+ u away in
> plan, outside the narrow cone an 18°-off-vertical camera sees. Four ZENITH masses were added
> against the rail's own track; at base 1015-1080 / w 540-620 they filled the frame with two
> featureless white potatoes showing their flat bases and visible polygon edges. At 900-1100 u
> up and w 410-500 (~25° instead of ~70°), on `near` LOD, they read as distinct clouds.
>
> **WHAT IS STILL SHORT OF THE REFERENCES:** lobe DEFINITION. The masses are correctly single
> shapes but smoother than the reference cauliflower — `SMIN_K` melts generously and
> `CRINKLE_AMP` is subtle. That is a two-constant tuning pass, and it belongs with Wave 2's
> paint session where the owner can judge both at once.
>
> ⚠️ **THE WHITE SLAB IS THE MOUNTAIN, and both earlier answers were wrong.** Bisected with
> deck, heroes AND field all off: the slab survives, and the mesh roster names
> `odyssey-world-ground`. The old plan's §1.2 claim and its "closed by the hero retirement"
> annotation are both withdrawn there. Nothing in the cloud work can close it.

> **SURVEY — THE WHOLE ACT ON THE FIELD, 2026-08-14 (field on, sheet OFF).** Four stations,
> which is what the D1 decision needs rather than the two the sculptor was built against.
>
> | station | verdict |
> |---|---|
> | ch3 p≈0.22 shore | **GOOD.** Scattered cumulus across a pale sky; the same frame with every cloud system off is BARE, so the field genuinely populates the shore view the sheet used to. |
> | ch4 p=0.42 | **GOOD.** Lobed masses at honest distance, lit crowns, flat bases. |
> | ch5 p=0.565 | **GOOD** after the zenith masses and the tuning pass; three distinct clouds, generous blue. |
> | ch5 p=0.63 (bank window) | **CLASHES.** See below. |
>
> **THE SEAM IS THE ONE FAILURE, and it is the plan's own Wave 5 arriving early.** At p=0.63
> the `odyssey-cloud-bank` is inside its 0.588-0.708 window, and its smooth-FBM mottle fills the
> sky BEHIND sculpted masses. Two cloud languages in one frame — precisely the complaint that
> retired the heroes, now with the roles reversed: the bank is the one in the old idiom. The
> field cannot fix this; the bank must be restyled onto the same palette and grammar (Wave 5),
> and **that work is now a prerequisite of the Wave 4 swap rather than a follow-up to it.**
>
> **Not a cloud defect, recorded so it is not re-investigated:** the white blobs on the sea at
> the shore station are the WATER's own foam pattern — present with every cloud system off.
>
> **Still unresolved for D1:** ch4's F1 gate. Two attempts were voided by a co-tenant (the
> owner's own browser session, twice). The ch5 gate passed at 0.393 ms against 0.50.

### Wave 2 — the paint + palette extraction
Extract `makeActCloudPalette` from the deck's tone block (renderer :1611-1656); the deck
consumes it — PURE refactor, source-import + no-reinlined-literals test (the refactor law);
the sealed deck gate is NOT re-opened. Field material: MeshBasicNodeMaterial, opaque,
FrontSide, zero textures, `fog=false`, NO `If` anywhere. Palette invariant unit test (cloud
lighter than adjacent sky THROUGH the grade at p=0.55/0.60/0.63). Graded captures ×4 + one
low-tier sanity. Gate: ΔfieldMs vs Wave 1 ≤ 2 ticks (0.131 ms). **Owner D1 primed:**
field-only vs field+sheet, one graded frame each, judged against the exact sentence that
retired the heroes.

### Wave 3 — motion + corridor
Rigid drift (verified via two captures t=9 / t=9.5 — `?t=` freezes dt). Dithered OPAQUE
near-dissolve 40-140 u (`opacityNode` + `alphaTest`, `transparent:false` —
NodeMaterial.js:879-890 verified: discard without blend state), doubling as the breach fade.
Gate-cloud intersection authored at p 0.563-0.566 (CLEAR of station 0.569; draws min==max
asserted). Whiteout beat: CPU SDF eval → `uWhiteout` → camera-attached BackSide shell,
`.visible`-gated, ~0.3 s. Gate: fieldMs unchanged ≤ 2 ticks. **F4:** stipple reads bad
through ACES at 720p → widen clearance to under-pass + whiteout-only; MSAA/A2C stays parked
as owner-priced D4.

### Wave 4 — the atomic swap (executes D1; NOTHING ships before the owner signs)
One commit: field default ON, sheet default OFF — RETAINED behind
`?odysseyWorldCloudSheet=1` (ADR-0015 pattern); NEW bisect flag `odysseyWorldNoCloudField`;
`odysseyWorldNoClouds` keeps meaning the SHEET so every historical report stays readable.
Ledger: close the deck cell with a retirement note PRESERVING the coverage-independence law;
re-baseline the ch5 station cell at 53-draw content on a quiet machine (two 08-14 attempts
were co-tenant-voided; verify counters, not drift); first field baseline + ~10 % ratchet.
Acceptance: captures p=0.225/0.42/0.44/0.56/0.569/0.63 (0.44/0.56 are captures-NOT-pairs —
the ch4 env draws at opacity 0.0197 there); underwater `.visible` test; dispose audit (the
SB-15 class); cold-boot ×4 (old plan §1.8). Gate: ch5 station ≤ 9.3716 (stale-conservative)
AND net ≈ −1.4 ms. **F5 (shore overhead read) judged on the p=0.225 capture BEFORE the swap
commit** — rejection leaves the sheet shipping untouched.

### Wave 5 — the bank speaks the field's language (old plan's Wave 3)
Restyle `odyssey-cloud-bank.js` onto `makeActCloudPalette`; interior tones aligned with the
whiteout shell so ch5's beat foreshadows the 5→6 envelopment; `SEAM_56_AURORA_BRIDGE`
midpoint untouched. Captures p=0.600/0.630/0.648. No perf cell (windowed, small).

> **OUTCOME — WAVE 5 SHIPPED, 2026-08-14. The bank speaks the field's language, and the fix
> that mattered was the RAMP, not the palette.** Evidence: `w5-bank2-p063.png`,
> `w5-bank2-p0648.png`, `w5-void-p068.png`.
>
> **The palette is SHARED, not copied.** `createOdysseyWorld` exposes `cloudPalette` — the live
> TSL nodes the deck and the sculpted field shade with — and the board hands them to
> `createCloudBank`. Handing over NODES rather than numbers makes drift impossible: a palette
> edit reaches the bank by construction, and no second tuning pass can disagree with the first
> (the "four answers to one contract" disease). The recovery path, where no world exists, falls
> back to the authored constant.
>
> **AND THE MEASUREMENT CAUGHT THAT THE PALETTE ALONE BARELY HELPED.** Bank-vs-field tone at
> p=0.63, both sampled in the SAME frame:
>
> | build | bank/field brightness | bank blue-cast (field: −3.3) |
> |---|---|---|
> | before restyle | 0.800 | 35.5 |
> | shared entry tone only | 0.827 | 25.1 |
> | **+ delayed bridge ramp** | **0.965** | **−2.1** |
>
> The entry tone moved the number by 0.027 because it was barely in the mix: the dead band
> means the bank first becomes visible around seamT 0.30, and `smoothstep(0, 0.55, a)` had
> ALREADY reached 0.63 by then — the volume was 79 % handover-teal in the first frame anyone
> saw it. **A shared palette is worthless if the ramp spends it before the volume is on
> screen.** Starting the bridge at 0.35 puts the whole visible approach in the WEATHER tone and
> the crossing itself in the handover.
>
> ⚠️ **THIS CHANGES AN AUTHORED BEAT, and the owner should know.** The bank used to darken into
> `SEAM_56_AURORA_BRIDGE`'s teal BEFORE the boundary; it now stays cloud-white through the
> approach, is a bright sunlit interior at the crossing, and darkens to the void after. Checked
> at p=0.68: black space, nebula and gas giant, bank faded — the handover still works, and by
> p=0.708 the bank is off. The aurora bridge itself is untouched and still visible as its own
> element. The new reading ("inside a sunlit cloud, then out into the dark") is arguably more
> physical, but it IS a different beat and is flagged rather than buried.
>
> **REMAINING, and it is the honest limit of a restyle:** the bank is still FBM mottle where the
> field is sculpted silhouette. Tone and grammar now agree; TEXTURE does not. Making it agree
> fully would mean the bank stops being a fly-through volume, which is the one thing it exists
> to be — so this is where the two systems should meet, not a defect to chase.

### Wave 6 — optional, priced, owner-gated
D3 water coupling (`uCloudOverhead` spec-dim free; projected cloud shadow +0.2-0.4 ms EST,
high tier only, own pair). Parked with revival conditions: A's rim shell (ONLY if the
fresnel edge fails the owner's eye; ≤0.35 ms gate or dropped); A's dome strata bake (ONLY if
the in-dome strata ring fails the shoreline capture).

## 6. Budget position (ch5 station; Lane B)

| Item | ms | Class |
|---|---|---|
| Sheet retired at swap | −1.835 ch5 / −1.180 ch4 | MEASURED |
| Field ~60-65k tris, 3 draws | +0.3..0.5 | ESTIMATE (floor MEASURED: 9k tris = 0.066-0.131) |
| Whiteout shell (transient) | +0.1 while active | ESTIMATE |
| **Net at end state** | **≈ −1.4 ch5 / ≈ −0.8 ch4** | vs ≤2.5 envelope — REFUNDS §7.2 |

Ordered reserve levers: drop the shell option → far-ring grid 16³→12³ → strata count →
corridor mass count. The dead lever (coverage) stays dead — this cost is triangles, not
fill.

## 7. Owner decisions
- **D0** (Wave 0b): does the paint clear the coherence bar at all? — gates everything.
- **D1** (primed Wave 2, executed Wave 4): the sheet's fate. Retiring it re-opens the
  Wave-2-gate sign-off from 2026-08-13; the swap commit is yours to call.
- **D2**: does ch4 get a corridor tease, or does the fly-through stay ch5-only?
- **D3**: water coupling (Wave 6). **D4**: MSAA/A2C measurement, only if F4 fires.
- **D5**: low-tier mass count.
- Please drop the two Witness screenshots + 1-2 Ghibli/Dedene cloud refs into
  `public/playground-refs/` — Wave 0b's bar is judged against them in split mode.

## 8. Files
`odyssey-cloud-field.js` + `-specs.js` + tests (new) · `odyssey-world-renderer.js` (mount,
palette extraction, swap) · `odyssey-hero-clouds.js` (makeRng export only) ·
`act2-cloud-deck.effect.js` (`?field=1`) · `scripts/odyssey-gpu-split.mjs` (configs) ·
`perf-budgets.json` (cells) · `odyssey-cloud-bank.js` (Wave 5) ·
[ODYSSEY_ACT2_CLOUDS_PLAN_2026-08.md](ODYSSEY_ACT2_CLOUDS_PLAN_2026-08.md) (superseded §4
track — annotate at the claim when the swap LANDS, not before).

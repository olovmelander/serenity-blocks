# Odyssey — the Ghibli Water (plan, 2026-08-13)

**Brief (user, verbatim):** *"Now we need to work on the water surface using water shaders from
threejs webgpu r183 (i think r183 is the correct one, right me if i am wrong). I want the water
to have this studio ghibli style. Do research online, investigate, plan and help me improve the
water surface in act II."*

**Status: PLAN ONLY. No production code has been written for it.**

---

## 0. How this plan was made

Six research agents ran in parallel (Ghibli visual anatomy, portable stylized-water technique,
the r181 TSL water sources, a line-verified audit of the shipped water material, the
visibility/budget map, and a critic that READ the fresh captures), then a completeness critic
audited every finding against the tree. The critic **confirmed every code anchor**, refuted two
evidence claims, and found six gaps this plan folds in. Tags as ever:

- **MEASURED** — a number from a capture, a harness report, or an instrument.
- **VERIFIED** — read at a named `file:line` or source and re-confirmed by the critic.
- **ESTIMATE** — a desk figure. **Nothing in the wave plan may be funded by an ESTIMATE.**

---

## 1. The version question, answered first

**You do not need r183 — and should not upgrade.** The repo pins **three 0.181.2**
(VERIFIED, `node_modules/three/package.json`), and the TSL water you are thinking of is already
in it: `examples/jsm/objects/WaterMesh.js` (the `webgpu_ocean` sunset ocean) and
`Water2Mesh.js` (the `webgpu_water` flow-map pool). The r182/r183 release notes contain **no new
water material** — r182 fixes a mobile water-sim bug, r183 only re-tunes the *existing*
WaterMesh toward realism (Schlick F0 0.3 → 0.02, haze removed, Lambert base dropped)
(VERIFIED against release notes; flagged for one re-check if an upgrade is ever proposed for
other reasons). Meanwhile this codebase carries four documented r181-specific behaviours that
new versions would re-litigate. **Decision: stay on r181.2, harvest, don't upgrade.**

**And neither addon is the Ghibli look.** Both are realism machines — planar `reflector()`
mirrors, photographic normal maps, physical fresnel; Water2 adds true screen-space refraction
(VERIFIED `WaterMesh.js:160-176`, `Water2Mesh.js:159-175`). Ghibli water is matte painted
colour with hard-edged painted light. What we take from them is **parts** (§4), not the look.

---

## 2. Evidence — what is actually on screen today

Fresh captures (2026-08-13, phase-locked `--time 9`): chapter 3 at 4 stations; chapter 2 and
seam sets carried from the same day. The look-critic's ranked deficiencies, area-ordered
(MEASURED = it looked at the PNGs; its embedded percentages are eyeball reads, not instruments —
do not copy them into gates):

1. **The topside is a single flat steel-blue sheet.** No wave detail, no glints, no value
   variation, no motion cue. It reads as vinyl flooring (`chapter-03-01-local-0000.png`).
2. **Nothing reflects.** Shoreline trees stop dead at the waterline; the sky leaves no trace.
   The water is chromatically disconnected from the scene above it.
3. **The shoreline is a razor cut.** No foam, no turquoise shallows, no wet sand — a vector
   edge, systemic across stations (`chapter-03-02-local-0333.png`).
4. **Colour count is 1–2 flat blues** — no shallows-to-deep hue story.
5. Chapter 3's water all lives in the chapter's **first third**; later stations have none.

Why the sheet is flat **by construction** (all VERIFIED, confirmed by the critic):

- The swell is `sin(x·0.010+t·0.55)·cos(z·0.013−t·0.4)·0.55` — amplitude 0.55 u over ~500–630 u
  wavelengths → max slope ~0.007 rad. Invisible from every real camera. Its shading normal
  tilts from the swell **value**, not its gradient — ±0.0275 (`odyssey-world-renderer.js:754-769`).
- The water clipmap is 32-grid at 6.4 u/cell — finest geometric wave ≈ 13 u wavelength
  (`:479-482, :752`). Fine chop must be a **normal/colour** effect, not displacement.
- The only foam is a static brightening band at bed depth −0.4..2.6 u (`:777-780`) — and the
  critic flags it may be a **no-op**: its `smoothstep(2.6, 0.15, depth)` is edges-reversed, the
  exact idiom this repo's memory records as "reversed smoothstep = 0" (Halcyon). Whether it
  renders at all is UNPROVEN. Either way, at the real shore slope (~0.7–1.1) the whole band is
  3–5 m wide seen from a rail ~33 m up — a few pixels.
- The topside body colours are **hardcoded vec3s**, divorced from the script-driven
  `uWaterShallow/Mid/Deep` plates the rest of the ocean uses (`:764-768` vs `:518-520`).
- The glint is a real term but near-static (threshold on a near-constant normal, `:773-776`).

**Two evidence corrections from the critic (both accepted):**
- The chapter-2 underside captures used to judge "no Snell's window" were shot minutes before
  the Wave 5 commit landed; the working tree carried the feature but provenance is murky —
  **re-capture ch2 before spending anything on the underside**.
- The Wave 1 seam capture set (`0.105/0.115/0.185/0.194/0.201`) was **clobbered** by later
  lake-level runs — the harness wipes its folder unless `--keep`/`ODYSSEY_CAPTURE_KEEP=1`.
  Instrument scar, recorded: evidence-bearing captures must use `--keep` or be copied out.

**A layout landmine (critic, VERIFIED):** `chapterPositions` is *derived at runtime*
(`odyssey-layout.js:228,264`), and today's boot manifests say ch3 ends at **0.352** while a
test's "live layout" says **0.389**. Ch2 (0.093–0.204) and the breach constant (0.20023) are
stable; every ch3+ station in this plan is written as "resolve first" until Wave 0 pins which
layout the shipped game derives.

---

## 3. The target, distilled from the reference research

What "Ghibli water" concretely is (all sourced; the anatomy agent's URLs are in §9):

- **Matte paint, zero gloss.** Every Ghibli background is opaque poster colour (Nicker); every
  "shine" is a painted opaque shape. → No PBR specular lobe anywhere. Painted glints only.
- **A narrow, nameable palette.** The sea ramp is 4-ish pigment stops on a teal/slate axis —
  cerulean light → cobalt mid → Prussian/ultramarine deep, viridian for shallows — never pure
  saturated blue, always against a warm accent (Ponyo's coral/gold). Film-derived anchors:
  `#278B9A` teal, `#5A6F80` slate.
- **Foam is flat white with a drawn edge.** Two-material logic: blue coat + white coat and a
  mask. Shoreline grammar = a nearly-static solid band hugging the shore contour + 1–2
  outward/inward-travelling ripple rings that **break into segments** via noise and die before
  open water. No gradients inside the foam.
- **Specular is discrete painted cells** confined to a mid/far distance band toward the sun —
  never continuous gloss.
- **Reflections are a soft additive colour wash** over flat paint (Spirited Away composited a
  separately-rendered reflection component *onto* painted water) — never a mirror image.
- **The horizon nearly dissolves** — far sea blends to sky colour; silhouettes carry the line.
  In Ponyo the horizon *itself* undulates ("get rid of straight lines" — Miyazaki's written
  mandate).
- **The two signature motions:** line boil (contours wobble constantly, hand-drawn, effectively
  time-stepped ~8–12 fps) and wave crests as authored curved silhouettes, not wave-spectrum
  noise.
- **Underwater goes MORE saturated, not murkier** — a direct tension with the shipped Wave 5
  per-channel grey-down. That conflict is an owner decision (§7.1), not something this plan
  decides by default.

## 4. The technique kit (the funded harvest)

Everything below is single-pass, no reflector, no new render targets, one draw (constraints
VERIFIED against the material's own rules — `.toVar()` fan-out, no analytic folds, `.level(0)`
in vertex fetches, `opacityNode`-only fades, CPU `visible` gates):

| # | Technique | Source | Cost class (ESTIMATE — gate on measurement) |
|---|---|---|---|
| K1 | Wind-Waker dual-sample foam: ONE baked voronoi-line texture, white sample + dark sample at offset UVs, sine-sum UV warp | gordonnl WW breakdown; Ilett dark-offset trick | 2–3 fetches, trivial ALU |
| K2 | `WaterMesh.getNoise()` 4-tap prime-scrolled ripple normal, then **quantised** for toon | `WaterMesh.js:115-136` harvest verbatim | 4 fetches of one small texture |
| K3 | Painted sun-glint: WaterMesh's reflect/pow glint with the pow replaced by a hard threshold, masked to a mid/far distance band | `WaterMesh.js:141-144` + Blender-recipe sparkle-band rule | ~10 ALU |
| K4 | Schlick fresnel two-tone (deep colour ↔ sky colour), rf0 harvested | `WaterMesh.js:168-171` | ~6 ALU |
| K5 | Water2 flow ping-pong cross-fade for hand-painted streak/foam scrolling with zero visible loop | `Water2Mesh.js:87-109,145-153` (port to pure-TSL fract ping-pong) | 2 fetches |
| K6 | Roystan toon-water formulas with **bed depth from our bake** instead of scene depth (the AA'd `smoothstep(cutoff−ε,cutoff+ε,noise)` edge) | roystan.net + our `depth` toVar (`:758-763`) | ~15 ALU |
| K7 | Cyanilux scrolling breaker bands: `fract((depth+noise−t)·n)` thinned by smoothstep — travelling shore rings with no depth texture | cyanilux shoreline breakdown | ~20 ALU |
| K8 | Alisavakis 3-level shore/mid/deep colour architecture + `exp2` Beer-absorption ramp | halisavakis + halfpastyellow | ~10 ALU |
| K9 | Crest mask as a vertex varying (wave height / steepness) thresholded in fragment | GPU Gems ch.1 | ~5 ALU |
| K10 | 2–3 Gerstner waves (Q-sharpened crests) + reference-point subtraction so the play area never bobs | GPU Gems ch.1; gordonnl anchor trick | vertex-only |
| K11 | Line boil: time-quantised contour jitter `hash(floor(t·10))` on foam/crest masks | gap the critic flagged; playground spike first | ~8 ALU |
| K12 | Legacy-membrane ports: decoupled ripple normal, tight ~1 u shore alpha + foam rim whose noise modulates **brightness never alpha** (thresholds are METRES — rescale for the One World slope) | `odyssey-water-surface.tsl.js:126-132,213-251` (dormant file, free harvest) | known-good |

**Rejected, stay rejected:** the `reflector()` mirror pass (a second scene render on an iGPU
already 2.9 ms over at ch4), screen-space refraction, FFT ocean, the fully-procedural WW shader
(hundreds of ALU/fragment vs one 256² texture fetch), per-fragment 3D voronoi glitter
(~519-instruction class), and any scene-depth-texture technique (we have bed depth baked).

---

## 5. Budgets and instruments (the part that bites)

| Station | Cell | Baseline / max | Headroom | Governs |
|---|---|---|---|---|
| p=0.115 deep ch2 | `odysseyAct2DeepOceanGpuP50LaneBMs` | 13.11 / 14.2 | **1.09 ms** | underside full-frame (MEASURED) |
| p=0.16 upper column | `odysseyAct1UnderwaterGpuP50LaneBMs` | 6.16 / 8.5 | **2.34 ms** | ascent/breach zone (MEASURED) |
| p=0.105 seam | `odysseyAct2SeamGpuP50LaneBMs` | 15.4 / 17.0 | STALE — Wave 2 re-baselines; **no spend against it** |
| p=0.42 ch4 world | `odysseyWorldGpuP50LaneBMs` | null / 7.0, measured **9.90** | **−2.9 ms** | every topside frame at altitude — already over; owner decision pending (One World §7.1) |
| ch3 shoreline | **does not exist** | — | — | the exact frames this plan targets |

Three hard facts (critic-verified):

1. **The water's own total cost has never been measured.** No `worldNoWater` lever exists —
   the renderer reads no flags at all. Everything we know is Wave 5's increment (~2–3 timer
   ticks). Step zero builds the lever and prices the plate.
2. **The water draws in every frame of p 0.063–0.678** — one ungated clipmap mesh, DoubleSide,
   transparent, `frustumCulled=false` — including ch4/ch5 where the cloud deck hides it.
   A distance/altitude LOD is a candidate *funding source*.
3. **Colour must be calibrated through the grade, not the playground.** The board hands the
   world `applyExposure:false` + output scale/saturation; repo memory: playground tuning must
   overshoot. Palette acceptance is judged on **in-game AAA captures** with the histogram
   instrument (`act1-value-gate.mjs` precedent), never on playground stills.

---

## 6. Waves

### Wave 0 — Make it falsifiable (blocking; near-zero GPU)
- Add `worldNoWater` bisect flag (the `earth-core.js:908-921` pattern; CPU `visible` gate).
  Cooled Lane B pairs with/without at p=0.115, p=0.16, p=0.42, and the new ch3 shoreline
  station → **the water's first measured total cost**, and a new
  `odysseyAct2ShorelineGpuP50LaneBMs` cell (baseline-null until its first admissible pair).
- Resolve the **chapterPositions derivation** (0.352 vs 0.389 for ch3-end) and pin the
  shoreline station's p in this file.
- **Prove or refute the reversed-smoothstep foam band** (`:777-780`) with a minimal A/B
  capture; record which way TSL emits it — this decides whether today's shore has zero foam or
  invisible foam.
- Re-capture with `--keep`: ch2 underside set + the seam water-entry set (0.185/0.194/0.201) —
  the evidence this plan diffs against currently does not exist on disk.
- Measure **pixels-per-metre at the shoreline station** (project the shore band into screen
  space) — every foam width in Waves 2–3 is derived from it.
- **Acceptance:** the cost table above filled with admissible pairs; one paragraph in this
  file stating the resolved layout + px/m; captures on disk under `--keep`.

### Wave 1 — The painted sea (colour architecture; biggest look-per-ms)
- One table owns the sea: rewire the hardcoded topside ramp (`:764-768`) to the script plates,
  then author the plates' water keyframes to the pigment ramp (viridian shallows → cerulean →
  cobalt → Prussian deep), quantised to ~4 stops (K8 + ramp quantisation), `exp2` absorption.
- Fresnel two-tone toward sky colour (K4) — the "soft additive reflection wash", no mirror.
- Horizon dissolve: far water blends to sky colour (the aerial already converges — verify the
  seam line vanishes at the shoreline station).
- **Acceptance:** in-game captures at the ch3 shoreline + breach stations show ≥3 distinct
  water hue-bands (histogram instrument, exact gate values set in Wave 0); Lane B within every
  cell in §5; playground/game palette delta documented.

### Wave 2 — Motion (the sheet becomes liquid)
- K2 ripple normal (prefer `detailTex` — already resident, repeat-wrapped, currently unused by
  the water) driving glint + subtle colour modulation; quantised.
- K3 painted glint band, distance-masked, animated by the ripple normal.
- Swell decision by capture: 2–3 Gerstner waves with Q-crests + K9 crest varying, amplitude
  chosen at the 13 u geometric floor, reference-point anchored (K10) — or, if the capture says
  displacement stays invisible from the rail, spend the budget on normals only.
- **Acceptance:** two motion-burst captures 0.5 s apart show the glint field visibly moving;
  crest mask visible in stills; pairs at p=0.16 + shoreline within budget.

### Wave 3 — The shore grammar (the Totoro edge)
- Scalloped foam: static shore band + 1–2 travelling rings (K7), broken by noise (K6's AA'd
  threshold), thresholded to flat white, widths from Wave 0's px/m; dark-offset second sample
  (K1) as the drawn edge's shadow.
- Wet-sand darkening strip below the waterline; animated waterline (the foam/opacity inputs
  gain the time-phase the critic found missing — today they are static against a displacing
  sheet).
- The One World shore slope note: rescale the legacy rim's metre thresholds (K12); a dissolve
  band must be wider than its noise swing (Ch3 lesson).
- **Acceptance:** the shoreline capture reads a scalloped, segmented, *moving* foam edge at
  rail distance; no return of the "2.6 u band reads as fog" failure; pairs hold.

### Wave 4 — The signatures (what makes it Ghibli, not just toon)
- K11 line boil on foam contours + crest lines (playground spike first: stepped-time jitter at
  8–12 fps equivalents, screenshots at two time steps to prove the boil).
- K1 third-sample painted sparkle cells in the far band.
- OPTIONAL, owner-gated: the Ponyo undulating horizon (vertex swell amplification confined to
  the far rings, or a painted horizon band) — spike before commitment (§7.4).
- **Acceptance:** boil visible across two captures at different `--time`; sparkle band reads
  as discrete cells; budgets hold.

### Wave 5 — The underside (owner-gated, see §7.1)
- Whatever §7.1 decides: either freeze (only re-capture to update evidence) or a saturation-up
  re-grade of the submerged path (raise blues/greens saturation, keep the Snell window/TIR
  staging) — scoped after the decision, priced at the p=0.115 cell's 1.09 ms.

---

## 6b. Wave tracker

- [ ] **Wave 0** — falsifiable: worldNoWater pairs, shoreline cell, layout + px/m resolved, smoothstep proof, evidence re-captured
- [ ] **Wave 1** — painted sea: script-plate unification, 4-stop pigment ramp, fresnel two-tone, horizon dissolve
- [ ] **Wave 2** — motion: ripple normal, painted glint band, swell/crest decision by capture
- [ ] **Wave 3** — shore grammar: scalloped travelling foam, wet sand, animated waterline
- [ ] **Wave 4** — signatures: line boil, sparkle cells, (optional) Ponyo horizon
- [ ] **Wave 5** — underside per §7.1 decision

## 7. Decisions needed from the owner

1. **The underside conflict.** Wave 5 of the seam plan shipped a measured, capture-verified
   underside (Snell window, TIR, per-channel grey-down with depth). The Ghibli mandate says
   underwater goes *more saturated*, and the look-critic ranks the (stale-captured) underside
   a top-3 defect. Freeze it, or re-grade it Ghibli-ward? Fresh ch2 captures land in Wave 0 to
   inform this.
2. **The ch3 basin lake holds no water** — its floor is above sea level, so the sea plate
   cannot fill it. Shoreline-only Ghibli water, lower the basin, or a dedicated lake sheet
   (the dormant legacy membrane's radial-edge lake is a ready harvest)? Affects scope of every
   topside wave.
3. **The ch4 world Lane B lane is 2.9 ms over its aspirational max** with a deliberately-null
   baseline (One World plan §7.1's pending optimize-vs-re-budget call). Topside water spend at
   altitude lands in that lane. This plan treats ch4/ch5 as no-spend until that call is made —
   confirm, or make the call.
4. **How bold is Ponyo mode?** Line boil and an undulating horizon are strong flavours.
   Ship-default, or behind a per-chapter stylization dial (the Spirited Away production itself
   varied water style per sequence)?

## 8. Open questions this plan will not pretend to answer

- Whether TSL's `smoothstep` emits WGSL-native (reversed-edges-undefined) or its own
  polynomial — Wave 0's A/B answers it with pixels, not opinion.
- Whether any displacement amplitude visible from the rail stays inside the 13 u geometric
  floor without re-speccing the water clipmap (a ring-0 densify is a real cost lever nobody
  has priced).
- Whether the sparkle band survives 720p without shimmer (the AA'd threshold is the tool; the
  capture decides).
- Reference imagery: Ghibli stills stay **local-only** (not committed) — same ruling as the
  seam plan.

## 9. Provenance

Workflow `ghibli-water-research` (wf_98fa5f93-3e0), 7 agents, 2026-08-13; full findings in the
session task output. Key sources: gordonnl "The Ocean" (Wind Waker), roystan.net toon water,
cyanilux shoreline breakdown, halisavakis stylized water, halfpastyellow water, GPU Gems ch.1,
nightshift glitter guide, jpanuelos Ghibli water (Totoro shoreline), xrender Ghibli sea recipe,
hyperallergic Ponyo exhibition (Miyazaki's straight-lines mandate), xsisupport (Spirited Away
CG supervisor), mlecznymlecz Ghibli colour analysis, ghibli R palettes, Clip Studio anime-water
tutorial. Local anchors: `odyssey-world-renderer.js:754-822` (the shipped water),
`WaterMesh.js:115-176`, `Water2Mesh.js:87-175`, `odyssey-water-surface.tsl.js:62-251` (legacy
harvest), `perf-budgets.json:68-122`. Captures: `artifacts/odyssey/wave-v/chapter-03-high-webgpu/`
(2026-08-13, post-Wave-5 tree).

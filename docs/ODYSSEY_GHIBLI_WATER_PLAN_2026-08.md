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

> **OUTCOME — Wave 0, 2026-08-13. Four of five items closed; the perf table is the last.**
>
> **The lever exists and is capture-proven.** `?odysseyWorldNoWater=1` (board flag → the
> renderer's new `water` option, the `clouds` pattern) skips building the sea mesh entirely —
> draws, fill, vertex and pipeline. gpu-split gained a `no-water` configuration so the
> differential and its drift bound come from ONE cooled session, reported as `waterMs`.
> Verified at the ch3 station p=0.22: water on = blue sea across the lower frame; water off =
> bare seabed. (A rename was forced: the local clipmap `water` became `waterGeo`, matching
> `cloudGeo`.)
>
> **INSTRUMENT SCAR — the capture harness's `render.*` metrics do not measure the scene.**
> The same two frames above reported **byte-identical** `drawCalls: 30, calls: 42,
> triangles: 214134` with the water demonstrably present in one and absent in the other (the
> `visibleMeshes` roster, a scene traverse, correctly showed `odyssey-world-water: 1` vs
> absent). The water geometry is 15,296 triangles, so a truthful counter could not have missed
> it. **Do not attribute cost from `capture-manifest`/station-JSON `render.*` numbers** — use
> gpu-split's sampler (ADR-0016's verified instrument, whose draw counts *did* track the
> ceiling-slab removal 92→90). The roster stays trustworthy.
>
> **THE FOAM BAND IS ALIVE, AND THE RULE THAT SAID OTHERWISE IS FALSE (PROVEN by GPU probe).**
> §2 suspected `smoothstep(2.6, 0.15, depth)` was a reversed-edge no-op. It is not. TSL emits
> the WGSL builtin verbatim (`MathNode.js:387/1018`; no polyfill or method-table entry, so
> `WGSLNodeBuilder.getMethod` falls through to the literal name), and a Dawn/Chrome 151 probe
> compiled it clean and returned a **descending ramp exactly `1 − smoothstep(0.15, 2.6, d)`**
> at all 32 samples. The shipped product `smoothstep(2.6,0.15,d)·smoothstep(−0.4,0.5,d)·0.55`
> measures 0.417 at depth 0, **peaks 0.945 at depth 0.5**, and decays to 0 by 2.6 — a
> correctly-shaped, land-masked shore band doing exactly what its author intended.
> **So the razor shoreline is a SCALE problem, not a dead shader** — that band is ~3–5 m wide
> against a shore slope of 0.7–1.1, seen from 96–180 m away. Wave 3 sizes foam in metres
> against px/m, and must not "fix" the smoothstep.
>
> The false rule ("reversed smoothstep returns 0 in WGSL") had propagated from
> `HALCYON_APEX_COMBO_LOCK_PLAN.md:11` into the **auto-activating `webgpu-threejs-tsl` skill's
> gotcha table** (all three copies) and three other plans — and was self-refuted by its own
> theme, whose sun, halo, cloud band and horizon haze are four reversed-edge smoothsteps
> (`halcyon-apex.effect.js:187/188/202/208`). Corrected at the skill and annotated at the
> Halcyon claim. The three REAL traps it had conflated are now stated separately: the **JS**
> `THREE.MathUtils.smoothstep` genuinely early-outs to 0 on reversed edges; **equal** edges are
> a hard WGSL compile error that kills the whole module; and three.js #30593's Tint validation
> error on const reversed edges (since removed at spec level). *Not swept:* the Stillwater and
> Starlight plans and their `findReversedNumericSmoothsteps` tests still enforce the
> non-requirement — out of scope here, flagged for their owners.
>
> **The layout ambiguity is settled: ch3 = p 0.204 → 0.352** (PROVEN by importing the real
> modules and running the derivation; `chapterRanges[2] = {startPosition 0.204, endPosition
> 0.352}`). The capture manifests were right and the test constant was stale. Cause:
> `LEVEL_PHASE2_OVERRIDES` re-chapters five levels *after* the base literals are written (20/21
> into ch4, 28/29/30 into ch5), moving each chapter's opening level — so 0.389/0.556 are the
> pre-Phase-2 numbers and are **dead**. The test now imports `deriveOdysseyChapterPositions()`
> instead of restating it, and one of its samples moved 0.58 → 0.52: under the true layout 0.58
> is 54% into ch5 and cleared the 0.5814 ignite start by 0.0014, so it would have passed while
> no longer testing "early Ch5".
>
> **The shoreline station is p = 0.225, and it comes with an unwelcome measurement.** It is the
> first p that is outside the 2→3 seam window ([0.186, 0.222] at seamWidth 0.018), above water
> (eye +20.3 m; p=0.200 is +0.71 m, independently reproducing `ODYSSEY_BREACH_P`), and still
> shows a full-width waterline. **But water is only ~10.7% of that frame** — a lower-left wedge
> — because ch3's framing pitches the camera +17.7° up. px/m = 623.538/D: **3.6 px/m** at the
> shoreline down frame-centre (D=172.6 m), 6.5 px/m at the nearest visible water (95.9 m), 1.7
> px/m at frame-left (366.8 m). **A 1 m wave crest is ~3.6 pixels.** Also corrected: the
> shoreline is at **z ≈ −203**, not the z ≈ −250 written in `odyssey-world-height.js:131` —
> that is where the *rail* is at p≈0.344, by which point the shore is behind you.
>
> **Consequence for the plan's shape (honest, and it demotes a wave).** Wave 1's "biggest
> look-per-ms" premise assumed the ch3 topside was the big canvas. It is not: at the shipped
> framing it is a tenth of one frame at 3.6 px/m, while the **ch2 underside is the full frame
> for 0.11 of the journey**. Waves are NOT re-ordered here (that is §7 owner territory), but
> Wave 1 must be judged at the breach/underside stations too, and the fine-grain Ghibli
> devices — scalloped foam, sparkle cells, line boil — are worth less at 3.6 px/m than the
> colour architecture is. A fresh ch2 capture (post-Wave-5, `--keep`) also **refutes
> look-critic rank 3**: the Snell window is plainly visible as a bright disc overhead, so that
> defect convicted a pre-Wave-5 build, exactly as the completeness critic warned.
>
> **Evidence now on disk under `--keep`:** `chapter-02-high-webgpu/` (4 stations, post-Wave-5)
> and `seam-1-2-high-webgpu/` at 0.185/0.194/0.201 (+0.16). The `--keep` flag is mandatory for
> evidence runs — the previous set was destroyed by an ordinary re-run.

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

> **OUTCOME — Wave 1, code landed 2026-08-13, PERF UNMEASURED. Stays UNCHECKED.**
>
> **The ramp is re-aimed at the depths that are actually on screen.** Ray-casting the real
> height field through the real camera (CPU, no GPU needed) gives the visible bed-depth
> distribution the old ramp was never checked against: at the shoreline station the median is
> **49.6 m** (p25 27.2, p75 70.5) with **59% of water pixels in one band**, and just past the
> breach — the journey's largest water view at **29.3% of frame** — the median is **133 m**,
> beyond the old ramp's 103 m top, so essentially every pixel was pinned at the deep colour.
> Both medians sat in the old ramp's flat upper region. That is the measured, sufficient
> explanation for "a single flat steel-blue sheet"; it was never a missing feature.
>
> Replaced with `t = 1 − exp2(−depth · 0.02)` — chosen so 50 m lands at exactly t=0.5, 10 m at
> 0.13 and 133 m at 0.84, i.e. the measured range spans the whole ramp — quantised into 4 flat
> plates with a smoothstep-resolved edge (a bare `floor()` posterise aliases at 720p on a
> surface this size), over a 4-stop pigment ramp: viridian → cerulean → cobalt → Prussian.
>
> **One table owns the sea.** The three hardcoded `vec3`s are gone; the stops live in
> `odyssey-colour-script.js` as `ODYSSEY_WATER_RAMP` beside the rest of the palette, with the
> absorption coefficient and band count as data. Also fixed by the same move: the script's
> water plates DEGENERATE topside (`uWaterMid` is clamped to the last water keyframe, which at
> ch3 equals `uWaterShallow`), so feeding the topside from the plates directly would have given
> two identical stops — the very "1–2 flat blues" being fixed.
>
> **Fresnel two-tone + horizon dissolve.** The sky arrives as a colour wash (no reflector, no
> image — Spirited Away's sea was painted flat with a reflection composited *over* it), and the
> far water then converges on the sky: 80% by 1.2 km, capped below 1 so the horizon never
> becomes a hard line of its own.
>
> **Capture-verified** at p=0.210 and p=0.225 (`--keep`): a teal shallows band, a deeper blue
> beyond it, and the far water dissolving into the sky — against one flat hue before.
>
> **NOT MEASURED, and therefore NOT claimed.** Wave 1 is a pure-ALU change on an existing
> material (no new draws, fetches or pipelines) so the expected delta is small, but **no number
> is asserted and the wave stays unchecked.**
>
> **THREE MEASUREMENT ATTEMPTS WERE MADE AND ALL THREE WERE VOIDED — the machine, not the
> harness.** Recorded because "we tried and failed" is information, and because the failure
> mode is one this project should recognise:
>
> | attempt | settle/sample | result | why void |
> |---|---|---|---|
> | 1 | 9 s / 14 s | 11.53 / 11.60 / 13.63 | content guard: baseline 47 draws vs repeat 75 — the first window latched a still-warming scene |
> | 2 | 16 s / 14 s | 15.60 / 18.15 / 20.45 | content guard: repeat fell to 51 draws; p50 climbing monotonically ~5 ms across the run |
> | 3 | 12 s / 9 s, +90 s cooldown | 15.14 / 18.68 / 24.12 | draws matched 75/75, but **baselineDrift −8.98 ms** — 2.5× the figure being measured, and only 8 frames in the first window |
>
> The tell is the monotonic climb *within* each run and *across* runs at a station that
> measured **13.11 ms this morning**: the adapter is heat-saturated after a full day of
> captures, suites and a parallel session, so every window is slower than the one before.
> GPU *idleness* was verified before each attempt — idle is not the same as cool, and the
> quiet-gate this project uses cannot see temperature. A drift bound larger than the signal
> means the number is noise; publishing `waterMs = −3.5` would have been exactly the failure
> ADR-0016 exists to prevent. **Take these pairs on a cold machine** (first run of a session,
> browsers closed), and prefer `--only baseline,no-water,baseline-repeat` in ONE session so the
> differential and its drift bound stay coupled.

> **OUTCOME — Waves 0+1+2 MEASURED AND CLOSED, 2026-08-13 (cold-machine session after the
> user's restart). The full ledger:**
>
> | station | pre-Ghibli | waves 1+2 ungated | + regime branch | max | waterMs total |
> |---|---|---|---|---|---|
> | deep p=0.115 | 13.11 | 15.47/15.47 (**over max**) | **12.909/12.982**, drift −0.066 | 14.2 ✓ | 4.52 → **2.03** |
> | shallows p=0.16 | 6.16 | 7.80/8.19 | **6.030/6.030**, drift 0.000 | 8.5 ✓ | 3.54 → **1.77** |
> | shoreline p=0.225 | (no cell) | 9.437/9.634, drift −0.197 | not re-measured (branch direction: saving) | 10.6 | ~0.26 (draw-mismatch caveat) |
> | ch1 p=0.051 | — | 30.80/29.56, drift 1.245 | water never draws (act gate) | 35.0 ✓ | 0 |
> | ch4 p=0.42 | 9.90 | 10.16/10.16, drift 0.000 | — | 7.0 aspirational (pre-existing over, §7.3) | 0.066 |
>
> **The water's total cost is measured for the first time** (the Wave 0 lever): ~2 ms where
> it fills the frame, one timer tick at ch4 under the cloud deck, zero in Act I.
>
> **The ungated Ghibli package initially BLEW the deep budget (+2.36 ms), and the fix was
> structural, not a downgrade.** Both hot stations are underwater frames, and every submerged
> pixel was paying for the full topside stack — quantised ramp, fresnel, glint, whitecaps and
> their noise, horizon dissolve, shore band — then discarding it in the final mix, because a
> multiply-by-uniform is not dead code (the repo's logged lesson). `uSubmerged` is a uniform
> the CPU writes each frame, so the colour graph now forks on `If(uSubmerged...)` — uniform
> control flow, coherently skipped — with both branches alive only inside the 14 u breach
> band. Result: **both hot stations now render the complete wave package CHEAPER than the
> flat water they replaced.** Nothing was visually cut; captures verified both regimes
> through the branch.
> ⚠️ **CORRECTED 2026-08-13 (same day, user report):** the branch verification above was
> WRONG — the branch was silently starving the untaken side's inputs. r181's WGSL builder
> hoists var declarations to function scope but emits each ASSIGNMENT at first build site;
> the shared terms (depth/wN/spec/grazing) were first built inside the topside `If`, so on
> submerged frames the underside read ZERO-filled vars: Snell window collapsed to uniform
> `tirBody`, `opacityNode` read depth 0 (semi-clear sea). The deep/shallows numbers in the
> table therefore measured a visually broken underside and are STALE. Fix: root-pin block at
> the top of the `Fn` (bare `.toVar()` calls — `toStack()` runs at creation) building every
> shared term before either branch. Proven by an always-true-conditions probe (identical
> formulas, branches forced on → ceiling returned), then re-verified with real conditions.
>
> **The LOD-seam defect (user report: "square sections with gaps") is fixed and
> capture-verified.** Cause: the new 19–54 m waves were displacing a lattice whose cells
> double every ring — in the morph zones the waves were sampled below Nyquist and the rings
> tore. Fix: each wave's *geometric* amplitude fades as the local cell size approaches its
> wavelength (full below len/5, gone past len/2.5), driven by the clipmap's own
> morph-adjusted `spacing`, which is continuous across ring boundaries so the fade cannot
> seam. The fragment field keeps full amplitude — the look loses nothing near the camera.
> ⚠️ **CORRECTED 2026-08-13 (same day, user report: squares now visible from ABOVE):** the
> spacing-fade was continuous in VALUE but its change concentrates inside the narrow morph
> bands at ring edges, so amplitude dropped in RECTANGULAR terraces — and it gutted the near
> field (ring 0's 6.4 m cells sat inside the 19 m wave's fade window: ~60 % faded
> everywhere). Replaced by per-wave CAMERA-DISTANCE envelopes (full inside 4.5·len, gone by
> 6.2·len — just inside the lattice's ~6.4·len 2.5-samples/cycle limit): radial, no ring
> shapes possible, near field back at full amplitude. The far-ceiling A/B against an
> e29cfe3c reference capture also proved the underside's plate-mottling is the displaced
> geometry self-occluding at glancing angles — the envelopes must run as wide as sampling
> allows. Verified at 0.185 (underside), 0.206 (glancing topside), 0.225 (shoreline).
>
> **Instrument notes for the next session:** the first configuration of the first run after
> boot carries cold-compile contamination (26.8 ms vs 15.5 warm — void and re-run once warm);
> and the earlier three voided attempts stand as the thermal record — idle is not cool.

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

- [x] **Wave 0** — falsifiable: worldNoWater pairs, shoreline cell, layout + px/m resolved, smoothstep proof, evidence re-captured
- [x] **Wave 1** — painted sea: script-plate unification, 4-stop pigment ramp, fresnel two-tone, horizon dissolve
- [x] **Wave 2** — motion: 3-wave analytic swell + per-fragment field, whitecaps, camera-distance envelopes (replaced the terracing spacing-fade), root-pinned regime branch (ledger STALE — see the corrections in the OUTCOME; re-measure on a quiet machine)
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

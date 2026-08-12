# Odyssey — the Act I→II seam and the Deep Ocean (plan, 2026-08-13)

**Brief (user, verbatim):** *"the transition seam does not feel tight and right and needs to feel
and be much much better. In deep ocean, the fishes are badly modelled, the atmosphere under water
is not great … so that we have a mesmerizing journey from earth core, deep ocean up to the surface
world … But we need to have good performance also that meets the standard of ms loadtimes and
framerate as the Act II world."*

**Status: PLAN ONLY. No production code has been written for it.**

---

## 0. How this plan was made, and the one warning that shaped it

Nine agents read the code and the web in parallel; a completeness critic then audited them against
the tree. **The critic's headline finding is that the research pass diagnosed the code and never
looked at the image**, and it caught the pass inventing numbers: four of eight findings priced the
god-ray system at **22 cones when there are 9** (`Math.min(22, sunkPoints.length)`, and
`sunkPoints` is 9); three repeated a stale source comment ("3.5:1 fish", "6 triangles") instead of
counting the seven `push()` calls; one built a proposal on a `smoothstep` whose edge order it had
read backwards.

So every claim below is tagged:

- **MEASURED** — a number from a capture, a harness run, or a live probe in this session.
- **VERIFIED** — read at a named `file:line` and confirmed by the critic against the tree.
- **ESTIMATE** — a desk figure. **Nothing in the wave plan may be funded by an ESTIMATE.**

Captures taken for this plan (2026-08-13): `--seam 1-2`, `--chapter 2 --frames 4 --time 9`, plus a
manual pinned-station walk of p 0.070→0.130. They are the first images ever taken of this seam.

---

## 1. Evidence — what the captures actually show

### 1.1 The seam capture harness does not sample the seam (MEASURED — fix this first)

`--seam 1-2` is supposed to pan across the boundary over 3000 ms. It does not. Per-frame metrics:

| shutter | `currentPosition` | chapter | `inSeam` |
|---|---|---|---|
| 0 ms | 0.05301 | 1 | false |
| 300 ms | **0.13249** | 2 | false |
| 600 ms | 0.13302 | 2 | false |
| … | creeps to 0.13399 | 2 | false |

The camera **teleports past the 0.093 boundary between the first and second shutter** and every
later frame samples the far side. `inSeam` is false in all eight, `seamProgress` 0 throughout.

**Consequence: nobody has ever seen this transition, and ADR-0017's "capture-verified" claim for
the crossing is not supported by any capture between p=0.053 and p=0.093.** The pan itself
(`panToPosition` → `travelToPosition` → `updatePathTravel`) reads correct on inspection, so
something cancels or overrides it; root-causing that is Wave 0.

### 1.2 The ocean leaks through the curtain (MEASURED, manual stations)

Pinning stations manually (travel + drift zeroed) and shooting p=0.086 and p=0.100: the frame is
the full steam wall, **and the Deep Ocean's fish are drawn on top of it at full opacity**, while
the camera is still in Act I. The occlusion meant to hide the act swap is being painted over by
the thing it exists to hide.

The code explains it exactly (VERIFIED): the world's act gate is a plain boolean that flips at
`0.093 − 0.03 = 0.063`, where the quench is only **18–47%** opaque; and the ocean's population is
seeded from `sunkPoints`, of which **5 of 9 lie inside the Earth Core shaft** (p = 0, 0.021, 0.043,
0.064, 0.085). The fish are opaque and depth-writing, so they punch holes through the magma vault.

### 1.3 The quench is opaque for 8% of its own window (VERIFIED)

Solving the shipped alpha (`opacity = clamp(alphaShape · d · 1.25)`) against the density curve
(`tri = 1−|2t−1|`, `d = t<0.5 ? tri^1.4 : tri²`, window p ∈ [0.033, 0.153]):

> genuinely opaque only across **p ∈ [0.0874, 0.0970]** — ~8% of its window, ~17 world units.

Meanwhile Earth Core does not get occluded at all: it **alpha-dissolves over p 0.063→0.123**, six
times wider than the window that could hide it. That is a crossfade — the exact thing ADR-0015/16/17
and the One World rule ban, and which the dive harness's own header claims was replaced. It was
not replaced; the quench was added *on top of* the dissolve.

### 1.4 The "underwater atmosphere" is an air sky with a forest in it (MEASURED — the big one)

Chapter-2 capture, station p=0.130. Metrics report `submerged: 1`, script `luminous-mid-water`.
The visible-mesh roster is:

```
odyssey-world-sky 1 · odyssey-world-water 1 · odyssey-world-ground 1
odyssey-world-godrays 1 · odyssey-world-motes 1 · odyssey-world-fish 1
odyssey-world-forest-chunk 16          <-- sixteen chunks of FOREST, underwater
odyssey-steam-quench 1                 <-- still drawing, 0.037 past the boundary
odyssey-path-{outer,core,glow}-tsl
```

and the image is **a blue sky with white cumulus clouds**. That is the single clearest answer to
"the atmosphere under water is not great": at the deep station the frame is not water at all. The
value gate agrees — **midWash 0.283 at p=0.130 and 0.894 at p=0.167**, i.e. at the upper station
89% of pixels sit in one mid band. There is no value structure: no dark, no light, just mid-blue.

This is precisely the class of defect eight desk reads missed and one screenshot found.

### 1.5 The fish (VERIFIED + MEASURED)

Verified in code: a hand-built **7-triangle open spindle** — 7 of the 9 triangles a closed shape
needs, so the rear top and bottom are simply absent. Nominally "3.5:1"; actually a **14:1 needle
that is wider (0.32 u) than it is tall (0.26 u)** over a 3.7 u body, i.e. flattened along the wrong
axis. Instance scale 1.2–2.8 makes them **5.0–11.8 units long**.

Measured from the seeding hash: **40 of 110 (36%) are seeded below the seabed** and are permanently
invisible; only 37 of 110 sit within 80 u of the surface where the code's own backlight comment
says the light is.

The captures settle the critic's open question **M14 — are the fish even on screen?** Yes: they
dominate the frame's visual noise at both p=0.130 and p=0.167, as flat black hard-edged darts at
random angles. **The hull rebuild is visible work, not invisible work.**

### 1.6 A fifth of the chapter renders as air (VERIFIED)

`uSubmerged` is computed from `railPoint.y + 16` while the eye sits below the rail, so across
~~p 0.180 → 0.203 (21% of chapter 2)~~ **[CORRECTED Wave 0, MEASURED: p 0.18141 → 0.20023, 0.0188
of progress = 17% of chapter 2; the eye/rail offset is −22.6 u at p=0.15 easing to −7.2 at p=0.20,
not a flat 23–39]** — **the entire final ascent to the breach — the camera is under water
while the world renders air**: air sky dome, air aerial perspective, rays/motes/fish switched off,
cloud deck on, water plane showing its topside from below.

Three different "the surface" constants exist in the tree (rail crossing, `uSubmerged` zero, eye
crossing). The plan must publish **one** number, recomputed from the spline.

---

## 2. Root causes, ranked

| # | Defect | Root cause | Class |
|---|---|---|---|
| 1 | Act II appears inside the magma cathedral | act gate opens at p=0.063 on a constant margin, not on the occluder's cover | placement |
| 2 | Earth Core crossfades out | 0.06-wide `progressOpacity` dissolve, six times wider than the opaque window | architecture violation |
| 3 | Ocean life seeded in the shaft | `sunkPoints` spans the whole journey; 5 of 9 are in chapter 1 | placement |
| 4 | Deep frames read as sky | the underwater sky dome carries an air-sky cloud pattern; 16 forest chunks drawn | coherence |
| 5 | Final ascent renders as air | `uSubmerged` uses the rail, not the eye | coherence |
| 6 | Fish read as debris | open 7-triangle hull, inverted proportions, no fins, no swim wave, no shading, no fade | modelling |
| 7 | Nothing converges at infinity | seabed → near-black vs sky dome 6–11× brighter; scene fog ~19× thinner than the water | coherence |
| 8 | No red loss with distance | extinction is a single grey scalar | physical model |

**Almost all of this is coherence and placement, not missing features** — which is why it can be
fixed cheaply. The ocean already owns god rays, caustics, motes, depth bands, an SSS ceiling and a
crest. They are pointed at the wrong places.

---

## 3. What the research actually supports

Full digest: session scratchpad `research-digest.md`. Condensed, with the critic's corrections
already applied:

**Converged across four independent findings — the strongest signal in the pass:**
**Snell's window + total internal reflection on the water underside.** ~6–14 ALU on an existing
material, no new draw, no new pass. The water surface is a 16-level clipmap (VERIFIED), so it is
geometrically viable at depth. It is the breach's only payoff image. Use `smoothstep`, not `step`
(aliases at 720p).

**Per-channel Beer–Lambert extinction.** Replace the single grey scalar with a vec3 so red dies
first — the one change that makes water read as water rather than as blue fog. Subnautica's trick
of decoupling the absorption used for *colour* from the one used for *fade* is what lets a stylised
palette survive a physical ramp. Ponyo's banded sea is then a quantisation of that ramp, not a
different model.

**Fish swim.** The standard travelling-sine along the body axis with amplitude growing toward the
tail, tail-beat frequency coupled to forward speed, plus banking into turns. Measured today:
0.06–0.21 body-lengths/second against a 0.8–1.1 Hz beat — the loudest "not alive" signal there is,
and one token to fix.

**God rays are inverted** (`vFade = (1−uv.y)^1.15` with the cone's `uv.y = 0` at the base), so the
shafts are brightest at their deep end, with the bright ~21 u buried in the seabed. And there are
**9**, not 22 — which is also why they read as pins rather than as light.

**Rejected outright** (keep them rejected): GPU boids, VAT, impostors, screen-space god rays,
raymarched volumetrics, `reflector()`, FFT ocean, refraction-map caustics, worley caustics
(ALU-worse by its author's own admission), `bayer16` dithering (nobody has seen banding),
silhouette-only far tier (the world ships six materials and they are already unlit — there is
nothing to collapse), per-layer mip-blur on parallax layers (no such layers exist).

**Stale figure to stop citing:** the "43 MB of uncompressed GLBs" constraint. The live payload is
**4.1 MB across 7 meshopt GLBs** (VERIFIED); the underwater stretch's own payload is zero.

---

## 4. The performance envelope (MEASURED)

The Deep Ocean is the **cheapest measured frame in the journey**: **Lane B 5.96 ms p50 / Lane A
0.197 ms p50 at p=0.16**, 45 draws, 594,689 tris, both content-matched with drift ≤ one timer tick.
The governing cell is `odysseyAct1UnderwaterGpuP50LaneBMs` (baseline 5.96, max 8.5) → a nominal
**2.54 ms Lane B envelope**. Lane B costs ~30× Lane A here, so **Lane B is the only lane that can
arbitrate**; most single features will measure 0.000 on Lane A.

Three hard rules follow:

0. **[CORRECTED Wave 0, MEASURED] The envelope above is measured at the wrong station.** The
   p=0.16 cell reads 5.96 ms because it is the *cheapest* frame in the chapter. The deep half
   (p=0.115) measures **14.48 ms** and the seam (p=0.105) **15.40 ms**, both admissible pairs. Work
   landing at p 0.10–0.15 must be budgeted against those, not against 5.96. The original ~~"2.54 ms
   Lane B envelope"~~ stands only for the shallows.
1. **No ESTIMATE may fund another ESTIMATE.** The pass tried to pay for the whole package with an
   unmeasured −0.4 to −0.9 ms from deleting two noise calls, on a surface **whose screen coverage
   nobody measured**. At p=0.16 the eye is ~130 u above the seabed climbing near-vertically; if the
   seabed covers 8% of the frame instead of the assumed ~54%, that saving is ~0.1 ms and the
   package has no funding. **A URL-lever differential must price it before anything spends it.**
2. **The governing station may not govern the changed frames.** The cell is measured at p=0.16, in
   `shallows`, near the top. Most of this work lands at p 0.10–0.15. **Add a deep station (p≈0.115)
   and a seam station before spending.**
3. **+1 draw is not cheap.** `contentMismatch()` voids a pair if draw calls differ at all, so any
   new drawable destroys the 45-draw content match and forces a re-baseline on a TDR-risky lane.
   Kelp, a hero creature and any new material are therefore second-wave items by process cost, not
   by taste.

---

## 5. The journey, as a beat sheet (design target)

One continuous rise, p 0.093 → 0.204. Beats, not set pieces:

| p | beat | image | device |
|---|---|---|---|
| 0.087–0.097 | **the quench** | white-out; fire's warmth carried into water's cool | opaque plateau (§6 W2) |
| 0.097–0.110 | **the dark** | near-black abyss, one cold key from above | reclaimed abyss keyframe |
| 0.110–0.135 | **first life** | ignition wake: bioluminescence answering the traveller | darkness-gated emissive on existing motes |
| 0.135–0.160 | **the column** | shafts resolve; the school crosses once, banking | fixed god rays + swimming fish |
| 0.160–0.180 | **the shallows** | colour returns, red last; caustics on up-faces | per-channel extinction |
| 0.181–0.190 | **Snell's window** | the circle of sky opens overhead | TIR on the underside |
| 0.190–0.204 | **the breach** | one surface, one moment, audio released | unified breach constant |

The rest beats between them are deliberate: **stop filling the frame at the node dwells.** Emptiness
is the scale cue, and it is free.

---

## 6. Waves

Each wave states a premise to verify first, acceptance criteria, and a budget. **A wave whose
premise is measured false is rescoped in this file, annotated at the claim, original preserved.**

### Wave 0 — Make it falsifiable (blocking; zero GPU)
- Root-cause and fix the `--seam` pan so the harness samples the seam; re-run `--seam 1-2`.
- Unify the **three** playground eye-height contracts (`+16` renderer, `+16` world effect, `+8` dive
  effect) with the real camera, or every capture is of a fourth scene.
- Publish **one** breach constant, recomputed from the spline: rail crossing, `uSubmerged` zero and
  eye crossing are three different numbers today.
- State the **world unit → metre scale** in one line of documentation. Fish are 5.0–11.8 u; if
  1 u = 1 m every fish is a whale shark. Every absorption coefficient and creature size depends on
  this and nobody has ever written it down.
- Add gpu-split stations at **p≈0.105 (seam)** and **p≈0.115 (deep)**; take Lane B baselines.
- **Acceptance:** a seam capture that actually contains the seam; two new admissible baselines.

> **OUTCOME — Wave 0, DONE 2026-08-13.**
>
> **The seam harness now samples the seam (MEASURED).** Root cause: the old scheme started a
> `panToPosition(end, 3000)` and shuttered at wall-clock offsets `0,300,600,…`, but one shutter
> (HIDE_OVERLAYS + collectMetrics + capturePage over IPC) costs far more than the ~300 ms between
> offsets, so the schedule slipped past the entire pan. The pan itself is innocent — instrumented
> live in a browser it eases correctly (progress 0 → 0.183 over 1.1 s). Fixed by sampling the seam
> **by position, the way chapter stations already work**: pin, settle, shoot. Nine stations now
> land exactly on request (`actual == requested` to 4 dp) across p 0.063 → 0.123, crossing the
> boundary. `--offsets` still overrides, now in progress units rather than milliseconds.
>
> **And the first frames of this seam ever taken immediately convicted it.** At p=0.063 — a full
> 0.030 *before* the boundary, inside Act I — the capture shows the magma cathedral with **a blue
> sky and white clouds behind its columns and black fish swimming through it**. The metrics agree
> at every station from 0.063 on: `worldVisible: true`, `submerged: 1`, and all five Act II mesh
> groups (sky, water, fish, motes, god-rays) drawing. The plan's §1.2 leak is no longer an
> inference from code; it is a photograph.
>
> **One breach constant, computed not asserted (MEASURED).** Bisected against the shipped spline
> and the real `computeFollowFrame` eye: the RAIL crosses sea level at p=0.19182, the **EYE at
> p=0.20023**, and `uSubmerged` (rail + 16) reaches zero at p=0.18141. `ODYSSEY_BREACH_P = 0.20023`
> is now published as the single authority, with the other two recorded beside it. The gap between
> the last two is the Wave 1 defect, and it is **0.0188 of progress = 17% of chapter 2**, not the
> 21% §1.6 estimated from source arithmetic — corrected in place below.
>
> **The eye/rail offset is a range, not a number.** MEASURED across the ascent: −22.6 u at p=0.15,
> −15.6 at p=0.17, −11.5 at p=0.19, −7.2 at p=0.20. So the three playground contracts (+16, +16,
> +8) were not merely inconsistent with each other, they had the **wrong sign** — the eye trails
> *below* its rail point, because `computeFollowFrame` pulls it backwards along a climbing tangent.
> All three now import one `ODYSSEY_EYE_RAIL_OFFSET_Y = -16` (documented as a mid-span stand-in,
> not a definition; Wave 1 replaces the renderer's use of it with the real eye).
>
> **The world's unit scale is now written down: 1 world unit = 1 metre** (`ODYSSEY_METRES_PER_UNIT`),
> fixed by geometry that already ships and is test-pinned — the abyss at 207 u below the surface is
> a shelf depth at 1 m/u and an implausible 52 m at 0.25. Consequence recorded rather than hidden:
> the Deep Ocean fish are 5.0–11.8 u, so **every fish in the chapter is currently 5–12 m long**.
> That is a Wave 3 sizing fix.
>
> **Two measurement stations added** (`odysseyAct2SeamGpuP50LaneBMs` at p=0.105,
> `odysseyAct2DeepOceanGpuP50LaneBMs` at p=0.115), both baseline-null with provisional maxima until
> their first admissible cooled pair, because the only shipped underwater cell is measured at p=0.16
> in `shallows` — near the top of the ascent, and not the frames this work changes.
>
> **Two stations measured, and the second one corrects this plan's budget section.**
> `odysseyAct2SeamGpuP50LaneBMs` = **15.401/15.073 ms** p50 (drift 0.328, 82 draws matched) and
> `odysseyAct2DeepOceanGpuP50LaneBMs` = **14.483/14.090 ms** p50 (drift 0.393, 80 draws matched),
> both admissible. The deep half of chapter 2 is therefore **2.4x the cost of the p=0.16 cell that
> was supposed to govern it**, and the seam is 2.6x - the second-worst frame in the journey after
> Earth Core. §4's "2.54 ms envelope" was computed against the cheapest frame in the chapter and is
> corrected in place below.
>
> **A mechanism found in the images that the code read had missed.** At the boundary (p=0.093) the
> curtain DOES cover Earth Core - the plateau exists - yet the fish are drawn over it in force. The
> reason is not render order: the fish are **opaque and depth-writing** and are seeded INSIDE the
> quench's 110-radius shell, so they write depth in front of it and the curtain's own fragments
> then fail the depth test. They punch holes through the veil. This means Wave 2's reseeding is not
> cosmetic tidying - it is the fix for the leak, and it works even before the gate is retimed.
>
> **A hypothesis for Wave 1, not yet a finding.** The mottled "cumulus" that makes the deep ocean
> read as sky appears at every station inside the quench's window (p 0.033-0.153: cream at 0.086,
> grey at 0.093, blue-white at 0.123 and 0.130) and is **absent at p=0.167, exactly where that
> window ends**. The prime suspect for "the atmosphere under water is not great" is therefore the
> steam quench itself, washing 0.12 of the journey at 18-47% opacity - and the same veil is the
> likely author of Earth Core's long-noted "cream vault" at p=0.062. **Not asserted: Wave 1 settles
> it with a hide-the-quench capture A/B.**


### Wave 1 — Coherence (zero-to-negative GPU, biggest look-per-ms)
- `uSubmerged` from the real eye, and widen the 9-unit ramp.
- Stop drawing an air sky and 16 forest chunks underwater.
- One convergence colour at infinity: seabed, sky dome and scene fog agree.
- Water plates stop inheriting the `breach` keyframe's AIR colour.
- **Acceptance:** at p 0.115/0.130/0.167 no cloud reads as cloud; midWash at p=0.167 falls from
  **0.894** toward a structured frame; Lane B not worse than 5.96 (expect better — this removes draws).

> **WAVE 1 — ROOT CAUSE FOUND, FIX BLOCKED (MEASURED 2026-08-13). Wave 1 stays UNCHECKED.**
>
> **The "air sky with cumulus" underwater is the STEAM QUENCH.** Force-hidden at p=0.130 the
> mottled cloud field disappears completely and the frame becomes what it should be: a clean blue
> water column with legible god-ray shafts and mote specks. Nothing else accounts for it - the One
> World group, the whole Earth Core chapter, the r=4000 atmosphere backstop, the point cloud and
> the chapter-1 corridor were each force-hidden in turn and the clouds survived all of them.
>
> The mechanism is the window, not the shader: the quench spans **p 0.033 → 0.153**, so its billowy
> veil is still ~18% opaque at p=0.130 and paints a cumulus wash over **a fifth of two chapters**.
> It is the same veil that produces Earth Core's long-noted "cream vault" at p=0.062, and it is why
> the value gate reads midWash 0.283 there - the frame is a low-contrast wash, exactly as reported.
>
> **INSTRUMENT SCAR (recorded because it nearly produced a false finding).** The first four A/Bs of
> this hunt were INVALID and one of them refuted the correct answer. Setting `mesh.visible = false`
> does not hold: the board's live rAF loop rewrites visibility every frame from the environment
> manager, so the hide was reverted before the shutter. Every "still there" result up to that point
> was an artefact. The working method is to pin the flag against all writers -
> `Object.defineProperty(obj, 'visible', {get: () => false, set: () => {}})` - and only then shoot.
> Any future mesh-attribution A/B in this project must use it.
>
> **Why Wave 1 cannot close here.** The fix is to narrow the quench's window, which is a re-timing
> of the quench curve - and that is Wave 2's `§7.2` decision (plateau vs three beats), which is
> **blocked on the owner**. Doing it now would pre-empt a decision the plan reserves. The remaining
> Wave 1 items (eye-driven `uSubmerged`, the 16 forest chunks drawn underwater, one convergence
> colour) are independent of it and stay open.
>
> **Consequence for §7.2: the decision is now better informed.** Whatever shape is chosen, the
> window must be narrow. A veil wide enough to cover the act swap is ~0.01 of progress; the shipped
> one is 0.12, i.e. **twelve times wider than the job requires**, and everything it touches outside
> the crossing is collateral wash.

### Wave 2 — The seam (needs an owner decision first, see §7)
- Give the quench a **plateau** rather than an apex, centred on the boundary.
- Bind the act gate to the occluder's cover instead of the constant 0.03 margin.
- Reseed the ocean's population from Act II's submerged span so nothing spawns in the shaft.
- End Earth Core by occlusion inside the plateau, not by a 0.06-wide dissolve.
- **Acceptance:** a seam capture across p 0.063→0.123 in which no Act II element is visible before
  the plateau and no Act I element after it; Lane B at the new seam station **improves** (today both
  worlds draw at once).

### Wave 3 — The fish
- Travelling-wave swim + speed coupling + banking **first** (30 minutes, may change how much hull
  work is warranted).
- Then close the hull, correct the proportions, add fins and taper.
- Reseat out of the rock — **priced honestly as a fill *increase*** (40 fish and 267 motes are
  currently early-Z rejected behind opaque seabed), bundled with a mote screen-space size clamp.
- Shading: world normal from derivatives, dorsal backlight, distance fade to the water colour.
- **Acceptance:** stills at p 0.130/0.167 in which no fish reads as a flat dart; Lane B within budget.

### Wave 4 — The water itself
- Per-channel Beer–Lambert extinction, decoupled colour/fade coefficients, quantised into bands.
- God rays: correct the count to 9, flip them right way up, lift them out of the seabed.
- Caustics: `min()` not `add()`, `max(normalWorld.y, 0)` up-face mask; the noise→texture
  substitution **only after** the coverage differential funds it.
- **Acceptance:** red demonstrably dies with distance; caustics only on up-faces.

### Wave 5 — The breach
- Snell's window + TIR on the underside; meniscus line; audio released on the same constant.
- **Acceptance:** the window is legible from p≈0.181 and the breach lands as one event.

---

## 6b. Wave tracker (the /goal hook loops on this)

Check a wave off ONLY when its acceptance criteria are met and its OUTCOME block is written into
this file. `grep -c '^- \[ \]' docs/ODYSSEY_ACT_II_SEAM_AND_OCEAN_PLAN_2026-08.md` is the remaining count.

- [x] **Wave 0** — Make it falsifiable (seam harness, eye-height contracts, one breach constant, unit scale, two new stations)
- [ ] **Wave 1** — Coherence (eye-driven uSubmerged, no air sky / forest underwater, one convergence colour)
- [ ] **Wave 2** — The seam (quench plateau, cover-bound act gate, reseeded population, occlusion not dissolve) — BLOCKED on the §7.1 owner decision
- [ ] **Wave 3** — The fish (swim wave first, then hull, then reseat + shading)
- [ ] **Wave 4** — The water (per-channel extinction, god rays upright and counted 9, caustics min+up-face)
- [ ] **Wave 5** — The breach (Snell's window + TIR, meniscus, audio on the same constant)

## 7. Decisions needed from the owner

1. **§3.6 of the Act I plan forbids Wave 2's core change** — verbatim: *"No changes to
   `ONE_WORLD_CHAPTERS`, the act-gate margin, the registry, or the escape hatch (ADR-0015)"*, and
   the act-gate file carries a DO-NOT comment on the constant. Binding the gate to the occluder is
   the single best fix in this plan and it needs an **ADR-0017 amendment**. This has the longest
   lead time — decide it first.
2. **Quench re-shape: plateau or three beats?** Two research findings proposed incompatible
   re-timings of the same curve (a plateau centred on the boundary vs. a hard vapour flash →
   boiling → long convection settle). Wave 2 assumes the plateau; the three-beat version is the more
   dramatic and the more expensive.
3. **World unit scale** (see Wave 0) — a one-line ruling that unblocks every physical coefficient.

---

## 8. Open questions this plan will not pretend to answer

- Seabed screen coverage at p 0.115/0.16 — the load-bearing unknown behind the caustic funding.
- Whether raising scene fog underwater (~19×) helps or empties the deep half: the orbs and the path
  ribbon are the only content there, and the beat sheet relies on them as the metronome.
- Whether the act-gate change interacts with cold-compile/boot-warp (the repo has a documented
  `compileAsync`-under-live-loop poisoning trap).
- Reference images are **not** committed. Ghibli's "free-use within the bounds of common sense" is
  not a licence, and Steam press stills are no different; local iteration only, nothing in the repo.

---

## 9. Provenance

Captures: `artifacts/odyssey/wave-v/seam-1-2-high-webgpu/`,
`artifacts/odyssey/wave-v/chapter-02-high-webgpu/`, session scratchpad `seam-p086.png`,
`seam-p100.png`. Research digest and the full critic: session scratchpad `research-digest.md`.
Measured perf: `reports/odyssey-perf/` and `perf-budgets.json`.

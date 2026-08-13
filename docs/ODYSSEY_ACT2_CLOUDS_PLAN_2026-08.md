# Act II clouds — the painted sky (2026-08)

**Goal.** Replace Act II's flat, noise-static clouds with a Ghibli-grade painted sky —
scalloped opaque poster masses, two quantised value bands, drawn edges — at net-zero GPU
cost on the Lane B iGPU. Kill the ch5 "construction visible" defect class (razor plane
edges, ultramarine patches, edge-on slabs) on both the default and recovery paths.

**Provenance.** 10-agent research pass, 2026-08-13: Ghibli/Witness visual-language
distillation, shipped-game technique survey (BotW/TotK, Sky CotL, Sable, Genshin, The
Witness), r181 TSL technique cards, three code reads (deck, sky-drift, perf), three
adversarial approach designs, one verification critic. Everything below that is stated as
fact was verified against the working tree by the critic pass; estimates are marked.

---

## 1. What is actually wrong (capture-grounded, 2026-08-13)

Evidence: `public/playground-refs/act2-clouds-current-{ch4-0p42,ch5-0p55,ch5-0p62}.png`.

1. **The sky at ch5 reads as salt-and-pepper static** — the deck's alpha is three octaves
   of value noise through a threshold (`odyssey-world-renderer.js:1105-1121`). No shape
   grammar exists anywhere: no lobes, no flat bases, no composition. (0p62 capture.)
2. **A giant white slab hangs edge-on** — the deck's ±116 u billow towers are protected
   near the camera by nearFade/bandFade, but a *distant* tower at the camera's altitude
   band edge stays a solid crumpled wall. (0p62 left half.)
3. **Saturated ultramarine patches with cut-out borders** — deck alpha holes reveal the
   zenith sky colour; the grade super-saturates it. The deck's own history records the same
   class ("ragged navy shards", :1127-1132). **MECHANISM NOW PROVEN WITH PIXELS (Wave 0,
   2026-08-13):** the new graded rig renders the same frame twice at ch4 p=0.42 — with the
   post stack (`act2-clouds-rig-graded-p042.png`) the patches are vivid ultramarine with
   hard borders; with `?post=0` (`act2-clouds-rig-ungraded-p042.png`) the identical geometry
   reads muted slate-grey and looks unremarkable. The defect is not in the deck's colours
   alone, it is in the deck's colours PASSED THROUGH the grade — which is exactly why every
   earlier tuning pass on the ungraded playground could not see it. Note also the correction
   this turned up: the world hands the stack `outputSaturation` **0.72** (a deliberate
   flattening), and the 1.10 in the deck's comment is chapter 4's own lift inside the post
   stack — two different numbers in two different places, both real.
4. **From above, the deck collapses to ONE flat tone** — `fromAbove` swaps to `cloudTop`
   globally (:1138-1139); the ±115 u of billow feeds no shading at all. The deck never
   reads `uSunDir` (uniform exists at :507; zero consumers in the deck graph).
5. **Razor straight edges** — god-ray fans and strata planes in ch5's legacy environment
   leak alpha at straight geometry borders… **but the strata never mount on the default
   path**: `ONE_WORLD_CHAPTERS=[2,3,4,5]` suppression (`OdysseyBoardController.js:138`,
   `:658`; `ChapterEnvironmentManager.js:665`) means sky-drift is never imported in the
   game players see. Default-path razor edges are the DECK's and the BANK's. The strata
   defect is real only under the `?odysseyOneWorld=0` crash-recovery fallback.
6. **The seam cloud-bank** (`odyssey-cloud-bank.js`, renderOrder 12, window p 0.588-0.708)
   draws in the old soft-FBM idiom OVER whatever the deck becomes — after any upgrade it
   would be the last cloud the player sees and the only one left in the old language.
7. **The deck's cost has never been measured.** No `no-clouds` lever exists. ADR-0016:
   an unmeasured cost cannot fund a package.
8. **Standing blocker on the same code path:** every IN-GAME One World boot after the deck
   landed stalls before readiness while the playground renders the same deck perfectly
   (renderer :442-447; `?odysseyWorldNoClouds` exists to bisect precisely this). Any wave
   that touches the deck pipeline must schedule a cold-boot check.

## 2. The verdict (three approaches, adversarially judged)

Three independent designs were drafted and critiqued: **evolve-the-deck** (shader+bake on
the existing sheet), **hero imposters** (authored billboard cumulus troupe), **masked
volumetric** (slab raymarcher over the deck band).

- **Core = evolve the deck.** Only approach that ships the whole defect list at ~zero net
  cost with zero new systems, and it does not need the pending §7.1 ch4-lane owner call.
  Its two real critic defects (authored-lobe tiling every ~488 u; the "street" term as
  written was a no-op ~28 km sine) are fixed in this plan (§4 Wave 1).
- **Hero imposters: deferred, owner-gated.** The composition argument is correct (a field
  cannot frame a summit; every Ghibli reference authors its silhouettes) but the
  load-bearing construct was broken as specified — r181 `billboarding()` under
  InstanceNode re-interprets instance placements in camera space, so a hand-rolled
  per-instance yaw basis must be designed first — plus an unsolved deck-vs-hero sort
  contradiction. Real design work; park it until the core lands and the owner sees it.
- **Volumetric crossing: parked hard.** The punch-through beat is the one thing no sheet
  can fake, but the critic refuted the cost model (depthNode writes disable early-Z; miss
  rays pay all steps; honest re-estimate 1.5-2.5+ ms in-band on a lane already ~3 ms over
  its aspirational max) and found accumulator/banding arithmetic errors. Not buildable
  until the owner re-budgets the lane. A ~4-step interior-whiteout-only variant is the
  survivable seed if ever revived (§7.3).

## 3. The target look (distilled rules the shaders must obey)

From the Ghibli/Witness distillation — the implementable core:

- **2-3 flat value bands, never a gradient.** Lit top = warm off-white (overshot for the
  grade); shadow band at ~80-88 % of lit luminance, and it is a HUE SHIFT toward the sky
  (cool, violet-leaning), never a darkening. Total value range stays small.
- **The cloud is lighter than the sky behind it at every point** — including its shadow
  band and underside. Contrast lives in the sky gradient, not inside the cloud. This is
  also the anti-"navy shards" rule, and it becomes a pixel assertion (§5).
- **The terminator is a hard quantised line** (2-6 % transition), offset so the lit band
  owns 60-75 % of the face, and its edge is SCALLOPED — it echoes the silhouette lobes
  because both derive from the same field. Volume is read from the SHAPE of flat shadow
  patches, not from smooth shading.
- **Silhouette = union of discs at 3 scales** (2-4 primary lobes, 5-9 secondaries,
  tertiary scallops on the sunlit crown only), irregular by mandate; tops convex and
  active, bottoms FLAT (the condensation line is the signature).
- **Hard drawn outer edge** (alpha cut + ~1 px AA), opaque poster interior — no additive
  blending, no saturated sky bleeding through a body. Soft edges only at bases and in the
  far strata row. High-frequency detail belongs exclusively in the silhouette; interiors
  stay flat. Masses drift rigidly; silhouettes never boil.

## 4. Waves

### Wave 0 — price and harness (no visuals)
- [x] Add `{ id: 'no-clouds', flags: { odysseyWorldNoClouds: '1' } }` to CONFIGURATIONS in
      `scripts/odyssey-gpu-split.mjs` (the `no-water` pattern; `--flags` applies to both
      sides of a pair, so a real configuration entry is the only way to get the
      differential). Run the trio at ch4 p=0.42, Lane B, quiet machine (counters checked,
      not drift), unique `--out` + `--port`. **The deck gets its first-ever price.**
- [x] Establish the ch5 station — **candidate p≈0.55 was WRONG and is rejected.** Derived by
      executing the live layout modules: ch5 = [0.500, 0.648), and its only interval free of
      every window is **(0.5600, 0.5780)** — 12.2 % of the chapter. 0.55 sits inside the 4→5
      ecotone [0.440, 0.560], where chapter 4's environment group is still visible at opacity
      0.0197 (extra draws whose opacity is progress-dependent — a content-match hazard), and
      on the inclusive edges of both the 4→5 colour bridge and the preload window. **Station
      is p=0.569**, the midpoint of the quiet interval; cell
      `odysseyAct2Ch5SkyGpuP50LaneBMs` filled with its first admissible pair (baseline-null).
      LOOK-ONLY station inside the bank window stays p≈0.63.
- [x] Playground rig — built BETTER than specified: rather than cloning the deck material
      (which would drift from the shipped code), `src/playground/effects/act2-cloud-deck.effect.js`
      mounts the REAL world through the REAL `OdysseyTslPipeline`, so a screenshot of the
      page is a screenshot of the code that ships. The grade constants moved out of
      `OdysseyBoardController` into `world/odyssey-world-grade.js` — the board and the rig
      now import the SAME contract (the steam-quench precedent), with
      `odyssey-world-grade.test.js` asserting the import and the absence of re-inlined
      literals (falsified: it fails against the pre-refactor board). Params: `?p=`, `?pitch=`,
      `?yaw=`, `?post=0`, `?chapter=`.
- [x] Cold-boot check baseline — see the OUTCOME block: four Electron harness boots of the
      real game ran back-to-back with no stall and no failure, which is the reference every
      later wave repeats. (This does not clear §1.8; it records the current state.)

> **OUTCOME — Wave 0 CLOSED, 2026-08-13 (post-reboot cold machine). Everything the wave
> existed to produce, plus two findings that change how later waves are judged.**
>
> **THE DECK HAS A PRICE, AND IT IS BIG.** First measurement in the deck's life, via the new
> `no-clouds` lever. Both pairs cold-machine, `baselineDrift` EXACTLY 0.000, draws
> content-matched min==max in every window:
>
> | station | frame p50 | deck cost | share of frame | draws (with/without) |
> |---|---|---|---|---|
> | ch4 p=0.42 | 10.09 / 10.09 | **1.049 ms** | 10.4 % | 48 / 46 |
> | ch5 p=0.569 | 9.109 / 9.109 | **1.901 ms** | **20.9 %** | 53 / 51 |
>
> At the ch5 sky station the cloud deck is the single most expensive system in the frame.
> That reframes the whole plan: Wave 1+2's estimated +0.10…0.25 ms gross is 10–24 % on top of
> a 1.05 ms incumbent at ch4, and the discard-floor saving finally has a real 1.9 ms of ch5
> fill to come out of. ⚠️ The lever is ASYMMETRIC with `no-water`: the deck mesh is still
> built and only withheld from the group (renderer :1166), so this is DRAWS + FILL + VERTEX
> with pipeline-compile on both sides — a FLOOR, not a ceiling.
>
> **THE STATION CANDIDATE IN §4 WAS WRONG.** p≈0.55 is inside the 4→5 ecotone [0.440, 0.560]
> — the journey's widest seam, 40.5 % of chapter 5 — where chapter 4's environment still
> draws at opacity 0.0197 with a progress-dependent term. Deriving from the live modules
> instead of the docs gave ch5 = [0.500, 0.648) with exactly ONE unwindowed interval,
> (0.5600, 0.5780); the station is its midpoint **p=0.569**, verified live as
> `inSeam:false, ecotone:none, weights {5: 1.000}`. This is the same mistake class the repo
> logged once before, caught this time before a number was published.
>
> **THE RIG IS BETTER THAN THE PLAN ASKED FOR, AND IT IMMEDIATELY PAID.** Instead of cloning
> the deck material, `act2-cloud-deck.effect.js` mounts the REAL world through the REAL
> `OdysseyTslPipeline`. Building it exposed a live contract bug: the grade constants were
> module-private in `OdysseyBoardController`, so any rig would have had to COPY them —
> re-creating the "four different answers to one contract" disease `odyssey-world-height.js`
> documents. They now live in `world/odyssey-world-grade.js`, imported by board and rig
> alike, guarded by `odyssey-world-grade.test.js` (asserts the import + absence of re-inlined
> literals; falsified — it fails against the pre-refactor board). First use of the rig proved
> defect §1.3's mechanism with pixels: identical geometry reads muted slate-grey ungraded and
> vivid ultramarine graded. And it corrected the record — the world hands the stack
> `outputSaturation` **0.72**; the 1.10 in the deck's comment is chapter 4's own lift inside
> the post stack.
>
> **THE WATER LEDGER IS UN-STALED (carried debt, cleared in the same quiet block).** Both
> cells re-measured after the root-pin fix: deep **13.106/13.172**, drift −0.066, 75 draws,
> waterMs 2.228 (max 14.2 ✓); shallows **6.226/6.292**, drift −0.066, 34 draws, waterMs 1.966
> (max 8.5 ✓). Both sit ~0.2 ms above the superseded pairs because those measured an
> underside whose inputs the regime branch had zero-starved — cheap because it was not doing
> the work. Deep landing exactly on the pre-Ghibli 13.11 with the full wave package on screen
> is the honest result.
>
> **INSTRUMENT NOTE for later waves:** the GPU co-tenant that blocked measurement for two
> sessions was *this agent's own output streaming* — VS Code sits at ~45 % while text streams
> and drops under 9 % within ~30 s of silence. Measurements must therefore run as long silent
> commands with no concurrent workflow; all four pairs above were taken that way, and their
> drift (−0.066, −0.066, 0.000, 0.000) is the evidence the window held.

### Wave 1 — the silhouette (the look's spine)

> **WAVE 1a PARTIAL — the perf lever landed, and its funding claim is REFUTED-PENDING.**
> Sequenced first (before the bake) so the visual work would spend a *measured* credit.
> Shipped: the blend-bandwidth floor (`alphaTest = 0.004`, the water plate's pattern) and the
> vertex gate's second octave, re-normalised by 0.84 so the 0.63/0.40 threshold calibration
> survives. Visually neutral by construction, capture-confirmed at ch4 p=0.42.
>
> **The measurement did NOT support the plan's self-funding thesis, and the session ran out of
> thermal headroom before it could:**
>
> | station | Wave 0 cloudsMs | Wave 1a cloudsMs | apparent Δ | session drift bound |
> |---|---|---|---|---|
> | ch4 p=0.42 | 1.049 (drift 0.000) | 0.918 (drift −0.393) | −0.131 | ±0.393 |
> | ch5 p=0.569 | 1.901 (drift 0.000) | 2.163 (drift −0.262) | +0.262 | ±0.262 |
>
> The stations disagree in DIRECTION and each effect is inside its own drift bound, so nothing
> is claimed either way. The cause is visible in the absolute numbers: baselines climbed
> monotonically across the session (9.109 → 9.50 at ch5, 10.09 → 10.49 at ch4) — the
> adapter heat-saturation signature the water plan already documented ("idle is not cool").
> The Wave 0 pairs were taken minutes after a reboot at drift 0.000; these were not.
>
> **This is the critic's predicted failure, arriving on schedule.** Its evolve-deck defect #3
> said the discard floor was optimistic ~2-3x because sub-threshold fragments still run every
> tap and discard saves only the blend read-modify-write; it also warned that on a transparent
> `depthWrite:false` material a discard can *disable* fast paths. Treat "the discard floor pays
> for the taps" as UNPROVEN. Consequence for Wave 2: its exit gate must be judged against the
> station MAX, not against an assumed credit that may not exist.
>
> **Carried action:** re-measure both stations on a genuinely cold machine (post-reboot, the
> only condition that produced drift 0.000 today) before Wave 2's gate is evaluated. If ch5
> still reads above 1.901 cold, revert the `alphaTest` line and keep the vertex-gate fix,
> which stands on correctness alone (the gate now estimates the same field the fragment
> stage actually sums).

- [x] **Rebake the A channel** of `bakeDetailNormal` (:281) as a billow spectrum:
      `A = 0.62·discs + 0.38·invertedRidgeWorley` — union-of-discs iso-contours give
      scalloped lobes by construction. Grep-verified: `.a` is consumed ONLY by the clouds
      (:1069, :1105), so nothing else moves. B stays value noise (terrain snowJitter).
- [x] **Anti-tiling (critic defect):** the 0.00205-scale octave repeats every ~488 u and
      authored disc silhouettes WILL be recognised. Mitigate in the bake+graph: sample
      octave A twice at irrationally related scales/rotation (~30°) and max() them, so no
      hero lobe recurs on a lattice; assert visually at the shore station's 10 km view.
- [x] Clouds move to A-only sampling (fragment octaves + vertex billow, `.level(0)` law).
- [x] **Histogram-match the new A** to the old (p10/p50/p90 = 0.42/0.58/0.70 ± 0.02,
      bake-time assert) — but treat thresholds as *starting points*, not settled: the
      critic is right that matching one octave's marginals does not bound the summed
      field. Budget one tuning session for 0.63/0.40 and the billowGate bands.
- [x] **Posterised two-stop opacity**: hard AA edge (footprint-widened band kept) + fully
      opaque core (`coreA → 1.0`) — kills the milky 0.94 sky-bleed; plus the drawn-line
      band at the threshold crossing; plus `alpha < 0.004 → Discard()` (blend-RMW floor —
      honest estimate −0.06..−0.12 ms, NOT the self-funding story; Wave 2's pair decides).
- [x] **Street/coverage term with a real wavelength** (critic: the proposed 0.00022 sine
      was ~28 km ≈ constant): coverage varies in x at ~3-5 km wavelength, ±0.045, so
      valley cumulus reads as placed masses; keep the world-Z ramp as the macro trend.
- [x] Vertex gate estimate gains the second octave (one more `.level(0)` tap on 9.8k
      verts) so geometry sinks where fragments actually go transparent.
- [x] Screenshots: ch4 p=0.42 and ch5 p=0.569, graded rig — see the OUTCOME.

> **OUTCOME — Wave 1 SHAPE COMPLETE, 2026-08-13. The sky has cloud shapes for the first time.**
> Evidence: `act2-clouds-w1-silhouette-{p042,p0569}.png` vs the Wave 0 `act2-clouds-rig-graded-p042.png`.
>
> **The field, not the shader, was the problem — and the fix is in the bake.** `.a` was one
> octave of value noise (`vn(i,j,1/96)`), and a threshold across value noise can only ever
> produce amoebae. It is now a union of discs at three scales (`bakeCloudSilhouette`), so the
> iso-contour of ANY threshold through it is an arc-of-circles boundary — a scalloped
> cauliflower silhouette by construction, at every coverage level. All three fragment octaves
> and both vertex-gate octaves now read `.a`, giving the three-tier lobe hierarchy the
> references describe instead of lobes-with-static-sprayed-over-them.
>
> **Two corrections found by looking at the picture, both worth keeping in mind:**
> 1. *Uniform scattering is not clouds.* The first cut placed 77 discs evenly and the sky
>    filled in solid — the marginal distribution was right and the result was overcast,
>    because coverage is a property of SPATIAL STRUCTURE, not of the histogram. Discs are now
>    placed in 3 CLUSTERS per tile (2-4 primaries + satellites each) and the gaps between
>    clusters are the sky. The ridge detail term is gated by the disc field for the same
>    reason — ungated it re-filled the gaps.
> 2. *This field is a PLAN view.* The deck is a horizontal sheet, so the silhouette the player
>    reads is this field's contour from below/above. The Ghibli "flat base" rule belongs to
>    vertical faces and does not apply; the scalloped contour rule does.
>
> **The calibration survived the rebake, which is why this wave did not become a re-tune.**
> `matchCloudHistogram` rank-remaps the new field onto the measured marginal and SOLVES the
> stretch so the three-octave sum the thresholds actually see lands back on p10/p50/p90 =
> 0.42/0.58/0.70. Achieved at k=1.658: **0.4152 / 0.5628 / 0.6952**. This is the direct answer
> to the critic's objection that matching one octave's marginals does not bound the sum's.
>
> **Poster-paint alpha replaced the fog-blob edge.** Two stops: a drawn edge rising across the
> footprint-widened band to 0.72 (keeping the far-field band-limiting), then a core that goes
> FULLY opaque, final multiplier 0.94 -> 0.985. The mass no longer lets saturated sky bleed
> through it.
>
> **Wind streets** got the wavelength the approach proposal fumbled: 0.0018 (~3.5 km period,
> two or three openings across a wide view), not the specified 0.00022 (~28.5 km ≈ constant,
> a no-op the critic caught).
>
> **NOT DONE, and deliberately Wave 2's job:** the masses are flat white with no light
> direction (no terminator, no lit/shadow bands), and the sky gaps still read saturated
> ultramarine through the grade. Both are palette/shading work.
>
> **NO PERF NUMBER IS CLAIMED for this wave.** The machine is thermally loaded (see Wave 1a);
> the deck's cost after the rebake must be measured cold, together with the carried Wave 1a
> re-measure, before Wave 2's exit gate is evaluated.

### Wave 2 — two-band sun shading (the paint)
- [x] Gradient pseudo-normal from octave A (+2 taps, forward differences; guarded
      normalize — zero-vec const-fold kills WGSL compile), `dot(N, uSunDir)` through ONE
      narrow smoothstep band (never equal edges) → quantised scalloped terminator.
- [x] Palette per §3: `cloudLit` warm off-white / `cloudShade` cool violet-leaning hue
      shift / `underCool` ONE flat underside tone, all overshot for the grade; density no
      longer appears in colour (interiors flat; kills the inverted glow-edge read).
- [x] **Per-fragment fromAbove** against displaced fragment height (varying of 660+billow)
      — crest-first reveal when climbing through the deck, no global colour swim.
- [x] **Root-pin law** (no `If` branch exists in this material, so the trap cannot fire here; `aaW` was hoisted because colour and opacity now share it —: every node shared between colorNode and opacityNode (density, N,
      band) gets a bare `.toVar()` at the Fn root BEFORE any branch — the ghibli-water
      zero-starve trap, now a repo law (skill table row exists).
- [x] **The pair**: ch4 p=0.42 trio must hold **net ≤ +0.15 ms beyond the session drift
      bound** with draws content-matched. **PASSES, 2026-08-13: +0.131 ms** (see the gate
      block below). If it reds: (a) drop the gradient taps to
      one-axis, (b) vertex empty-cell collapse (design against the torn-cliff failure the
      billowGate comment documents — morph-band-coherent, amplitude-only), (c) the
      Witness two-pass opaque-core split. In that order, measured each step.
- [ ] **Late-ch5 palette check** (critic: unanswered by all three): capture at the p≈0.63
      look-station while the script marches toward void — assert the underside stays
      lighter than adjacent sky through the grade (pixel sampling, the §3 rule).
- [ ] Cold-boot check; dispose()/stats.materials audit for any new texture object.

> **OUTCOME — Wave 2 SHADING COMPLETE, 2026-08-13, and it turned up a geometry fact that
> re-aimed the whole wave.** Evidence: `act2-clouds-w2-shaded-p042.png`.
>
> **THE RAIL NEVER CLIMBS ABOVE THE DECK.** Measured while building this wave: at p=0.643,
> near the end of ch5, the rig reports **eyeY 634.1** against a deck plane at **660**. The
> camera only ever reaches INSIDE the billow band (±116 u), never above it. Defect §1.4 —
> "from above the deck collapses to one flat tone" — is therefore a late-ch5 detail affecting
> crests near eye level, NOT the main event, and a sun terminator on the cloud TOPS would have
> been invisible for essentially the whole act. The plan's Wave 2 as written would have
> shipped work nobody could see.
>
> **So the underside got bands of its own, which is where this deck actually lives.** The
> references never paint undersides flat either: volume reads from the SHAPE of flat shadow
> patches (the fish-scale stack), not from smooth shading. The underside now takes ONE
> quantised step whose boundary follows the density contour — so each patch is lobe-shaped for
> free — with the thick core cooler and violet-leaning and the thin shoulder bright.
> **Note the sign:** the old term was `mix(base, top, puff.oneMinus())`, i.e. LOW density got
> the bright tone, so thin edges glowed and thick cores went dark. That inverted read is what
> the capture critique kept calling "flat"; this is the same idea the right way round and
> quantised instead of smooth.
>
> **Tuned by overshoot, per the standing playground rule.** The first underside pass used a
> 0.96 shade multiplier and was invisible once the grade had flattened it (outputSaturation
> 0.72 into ACES). 0.86 with a stronger violet lean survives the grade. Both underside tones
> stay LIGHTER than the sky behind them (rule 3, the anti-navy-shards rule).
>
> **Also shipped:** the gradient pseudo-normal (two extra taps of the silhouette field,
> GUARDED normalize — a zero-length vector const-folds into a WGSL compile failure, and the
> gradient is zero across most of a cloud's interior), one dot against `uSunDir` — a uniform
> the deck had never read in its life — through a single 8 %-wide smoothstep for a hard
> quantised terminator, and per-fragment `fromAbove` against the fragment's own displaced
> height so crests flip before troughs instead of the whole sky swapping tone at once.
>
> **NO PERF NUMBER IS CLAIMED, and the exit gate is NOT yet evaluated.** The machine has been
> thermally loaded since Wave 1a. A hint only, not a measurement: the playground's own counter
> fell from ~170 to ~154 fps on an RTX across Wave 2's two extra taps — direction consistent
> with a small cost, magnitude meaningless on that hardware. The carried cold-machine block is
> now three measurements: Wave 1a's re-measure, the rebaked deck, and this wave's gate at ch4
> p=0.42 (≤ +0.15 ms beyond the drift bound, judged against the station max since the discard
> floor's credit is unproven).

> **WAVE 2 EXIT GATE: FAILED, and the diagnosis is worth more than the failure.**
> All figures Lane B, ch4 p=0.42, draws content-matched 48/46 in every window.
>
> | build | cloudsMs | drift | verdict |
> |---|---|---|---|
> | Wave 0 (incumbent) | 1.049 | 0.000 | reference |
> | + Waves 1a/1b/2 | **1.376** | 0.066 | **+0.327 — 5x the drift bound, REAL. Gate is +0.15. FAILS.** |
> | + coverage 0.63/0.40 -> 0.685/0.515 | **1.376** | −0.066 | **identical to the digit — a clean NULL result** |
> | + regime gate | 1.311 | −0.328 | inconclusive (effect 0.065 << drift 0.328) |
>
> **The null result is the finding.** The first hypothesis was fill, so coverage was cut hard —
> and the cost did not move by one digit. That refutes fill and CONFIRMS the research critic's
> objection to the discard floor: sub-threshold fragments still run every tap, and discard only
> saves the blend write. The deck's price is shader work on EVERY rasterised sheet fragment,
> sky or cloud, and is therefore independent of how much cloud is on screen. Anyone optimising
> this deck later should start from that fact — it invalidates the whole "reduce coverage to
> save fill" family of fixes.
>
> **The regime gate follows from it** and is shipped: `uCloudTopLit`, a CPU-written uniform,
> skips the entire top read (two gradient taps, normalize, dot, terminator) whenever the eye
> is below y≈484, where `fromAboveF` is provably zero for every fragment — which is most of
> the act, since the rail tops out at 634. Same pattern that recovered 2.36 ms on the water
> plate, same root-pin discipline, and BOTH branches capture-verified (gate-off at ch4 is
> pixel-identical to the ungated build; gate-on at p=0.615, eyeY 598, renders correctly).
> Its saving is UNPROVEN: the machine was thermally saturated by then (drift 0.328, p99 spikes
> to 29 ms after six runs).
>
> **CARRIED, cold machine, in this order:** (1) re-measure ch4 with the gate — the only open
> question is whether it recovers the +0.327; (2) ch5 p=0.569, where the deck is 20 % of the
> frame and the gate is ON, so the gate cannot help there and the honest number may be worse;
> (3) decide. If the gate does not recover it, the ordered reserve is the plan's: one-axis
> gradient, vertex empty-cell collapse, Witness two-pass opaque-core split — or the owner
> accepts ~+0.3 ms for the look, which is a legitimate call on a lane whose budget question
> (§7.2) is already open.

> **OUTCOME — THE CH5 STRAIGHT-EDGE DEFECT IS CLOSED, 2026-08-13, and it was never in the
> shader. Evidence: `public/playground-refs/act2-clouds-ch5-seam-p0565.png` (before/after at
> the same station, same camera, phase-locked `--time 9`).**
>
> **THE BISECT, and what retires with it.** Four suspects fell in four captures from the REAL
> spline camera at ch5 p=0.565 (eye y=507, deck plane 660, looking 18° off vertical — so the
> whole visible deck lies within ~220 u of the lattice centre, a fact the new camera-pose
> metrics made readable for the first time). Each capture re-shaded the same mesh and the same
> draw, so nothing about registration had to be guessed:
>
> | instrument | question | verdict |
> |---|---|---|
> | `lattice` | is the band a morph band or a ring collar? | **NO** — no mark on it. Retires the whole "keyed to the lattice" family. |
> | `alpha` | opacity graph or colour graph? | **opacity** |
> | `mult` | nearFade / bandFade / rim? | all three flat — so it is `max(edgeA, coreA)` |
> | `grid` | which world axis is the edge an iso-line of? | **world Z** |
>
> A straight screen line is a plane through the eye, so on a near-horizontal deck it is a
> straight line in world XZ — that is what makes the `grid` answer decisive rather than
> suggestive.
>
> **TWO BAKE DEFECTS, both MEASURED.** (1) The value noise did not tile: its hash wrapped the
> lattice index at the texture resolution when a lattice at frequency 1/f has only `res·f`
> cells across the tile, so the modulo never engaged. (2) Fixing that exposed the bigger one —
> the histogram match ranked TIED texels individually, and 64.3 % of the silhouette field is
> exactly zero (the sky between clusters), so 42,172 identical inputs got 42,172 different
> outputs in *texel order*: the field's own empty sky was a row-major ramp that stepped 0.394
> at the wrap.
>
> | build | interior step | u-seam | v-seam |
> |---|---|---|---|
> | before | 0.00471 | 0.00154 | **0.22842** |
> | + tiling noise | 0.00473 | 0.00154 | **0.22655** |
> | + tie-safe remap | 0.00535 | 0.00000 | **0.00682** |
>
> The deck's anti-aliased alpha edge is 0.06 wide and the coarse octave is weighted 0.52, so a
> field step of 0.115 crosses it completely. 0.228 crossed it *twice over, in one texel, every
> 488 world units of Z* — and the camera at Z=−528 with a visible span of Z −308…−748 put that
> seam straight across the middle of the ch5 frame. That is the entire defect.
>
> **NO PERF CLAIM IS NEEDED — this is bake-time only.** Not one node in the deck's fragment or
> vertex graph moved, so the carried +0.327 ms decision (§Wave 2 exit gate) is untouched by it
> and still stands open exactly as written.
>
> **WHAT IT COST IN CALIBRATION, stated not buried.** Collapsing the tie block changes the
> field's shape: the solver re-solved k 1.668 → 2.062 and the summed median moved 0.563 →
> 0.549 (p10 0.433, p90 0.713; the spread is still 0.28 by construction, which is the quantity
> the solver actually controls). Coverage thresholds were NOT re-tuned to mask it.
>
> **GUARDS, both falsified against the pre-fix build before being kept.**
> `odyssey-tiling-noise.test.js` (periodicity + wrap-step) and `odyssey-cloud-field.test.js`
> (seam mean, seam p99, tie-collapse, calibration), with `bakeOdysseyCloudField` exported for
> them — neither defect was testable at all while the bake lived as two closures. ⚠️ Worth
> keeping: the first draft of the wrap-step assertion compared texel 255 to texel **256**,
> which the broken sampler passed at 0.1–1.2× — that pair is just another interior step of an
> infinite field. What the GPU interpolates is 255 against **0**, where the broken sampler
> reads 8–34×. A tiling test that does not test the wrap tests nothing.
>
> **ch4 p=0.42 re-shot as a regression check** (the field is global): healthy — chunky white
> cumulus over the massif, no edges.
>
> **STILL OPEN AT CH5, each needing its own bisect, none of them clouds:**
> - the sky dome is flat saturated ultramarine with no gradient — the COLOUR SCRIPT;
> - chapter 6 bleeds in from p=0.5814 — a SEAM issue, and restyling the bank will not fix it;
> - the white slab is the HERO CLOUD geometry seen close and near-flat. The `flat` re-shade
>   shows the deck covering that part of the frame uniformly, so it is **not** the deck — which
>   corrects the earlier note that called it unexplained.

> **WAVE 2 EXIT GATE: RE-MEASURED AND PASSED, 2026-08-13.** The carried decision — accept
> +0.327 ms for the look or work the ordered reserve levers — is resolved, and does not need
> to be made. All figures Lane B, Radeon 610M (amd/rdna-2), 720p, Medium, `--chapters 3,4,5`,
> `--only baseline,no-clouds,baseline-repeat`, draws content-matched min==max in every window.
>
> | station | build | cloudsMs | drift | verdict |
> |---|---|---|---|---|
> | ch4 p=0.42 | Wave 0 incumbent | 1.049 | 0.000 | reference |
> | | + Waves 1a/1b/2 | 1.376 | 0.066 | +0.327, FAILED |
> | | + regime gate | 1.311 | −0.328 | inconclusive |
> | | **FINAL** | **1.180** | −0.066 | **+0.131 — PASSES the +0.15 gate** |
> | ch5 p=0.569 | Wave 0 incumbent | 1.901 | 0.000 | reference |
> | | **FINAL** | **1.835** | −0.066 | **parity (one timer tick)** |
>
> **Stated with its uncertainty.** +0.131 is only twice the drift bound, so the honest band is
> ~+0.065…+0.197 and its upper end grazes the gate. At ch5 the change IS the drift bound —
> parity, not improvement, and no claim is made in either direction.
>
> **Attribution, and its limit.** The 1.376 → 1.180 recovery is most plausibly the
> `uCloudTopLit` regime gate — the plan's FIRST ordered reserve lever, shipped alongside the
> 1.311 pair whose 0.328 drift made it unreadable. That is inference ACROSS SESSIONS, not a
> measured attribution: tonight's frame baselines sit ~0.3–0.46 ms above the post-reboot Wave 0
> session (ch4 10.55 vs 10.09, ch5 9.37 vs 9.11), so the absolutes are thermally loaded even
> though the differentials are clean. **The remaining reserve levers — one-axis gradient,
> vertex empty-cell collapse, Witness two-pass opaque-core split — are not needed and stay
> unspent.**
>
> ⚠️ **THE FIRST RUN MEASURED THE WRONG GPU AND THE REPORT DID NOT SAY SO.** This machine has
> an RTX 5080 and a Radeon 610M; Lane B's budgets are written against the integrated part, and
> without `--low-power` the harness takes the discrete one. The frame came back at 0.262 ms and
> `cloudsMs` at exactly **0** — on a 5080 at 720p every configuration lands inside the timer's
> 65.536 µs quantum. Every field a reader checks (lane, quality, resolution, discipline, draws)
> looked correct; only `adapter` betrayed it, and nothing compared it against what the lane
> requires. The report now records `lowPower`/`powerPreference` and sets `laneAdapterMismatch`
> with a loud warning. Same defect class as measuring Lane A at 720p: **measure the lane the
> budget NAMES.**
>
> **Also shipped in this block:** `skyColourFor`'s elevation curve uses `sqrt` rather than
> `pow(0.48)`. `applyAerial` calls it for every ground, water and tree fragment, so a general
> pow there is a transcendental across the whole screen to buy 0.013 of mix factor. A/B on both
> stations: ch4 identical to the digit, ch5 `cloudsMs` 2.032 → 1.835; capture-verified as
> visually identical to within 1–2 units per band.

### Wave 3 — the seam cloud-bank speaks the same language
- [x] **Down-payment shipped 2026-08-13** — the approach dead band and a quantised interior
      (see the OUTCOME below). The full palette-uniform restyle is still open.
- [ ] Restyle `odyssey-cloud-bank.js` (renderOrder 12, p 0.588-0.708) with the same
      quantised-band + drawn-edge grammar — it composites OVER the new deck and is the
      last cloud of the act. Same palette uniforms, same root-pin law. LOOK-station
      capture at p≈0.63 before/after; no perf cell (occluder is windowed and small).

> **OUTCOME — THE "CHAPTER 6 BLEED" WAS THIS BANK, 2026-08-13, and Wave 3 is unblocked.**
> Evidence: `public/playground-refs/act2-seam56-cloudbank-p060.png`.
>
> **The inherited diagnosis was wrong, and the reason matters.** The record said chapter 6
> bleeds into ch5 from p=0.5814, that the sky goes mottled there, and explicitly that
> "restyling the cloud bank will NOT fix it". All of it traced to one bisect run with
> `?odysseyWorldNoClouds=1`, which gates the WORLD DECK. The bank is a separate system built by
> the board and it had **no off switch at all**, so it was never removed from any frame it was
> being blamed out of. Its window opens at p=0.588 — within 0.007 of ch6's summit ignite at
> 0.5814 — so the two were indistinguishable by progress alone and the wrong one was charged.
> `?odysseyNoCloudBank=1` now exists, and with it p=0.600 is clean.
>
> **Chapter 6 is doing exactly what it was designed to do.** `resolveSummitEarthStaging` already
> holds stars, black hole, nebula, dust and lights at zero until past the boundary
> (`spaceReveal`) and lets ONE object through early — the hero gas giant, the owner's "see the
> earth shape at the top of the mountains before it gets dark". At p=0.600 it is at 30 %; at
> p=0.63 it is visible beside the path. **There is no bleed to fix.**
>
> **What shipped on the bank:** (1) a 0.30 dead band on the density ramp — `tri²` was nonzero
> from the first frame of the window, and this mesh is a 300 u lens the camera is already near,
> so 4 % density at seamT 0.10 painted a full-screen FBM mottle that read as noise ON the sky
> rather than weather ahead of it; the closure at the boundary is unchanged because tri = 1
> there either way. (2) A quantised interior, so the last cloud of the act stops speaking the
> old smooth-FBM idiom next to a deck that is now poster cumulus.
> Capture-verified: p=0.600 clean (matches the no-bank bisect), p=0.630 a real cloud body with
> the aurora bridge and the gas giant, p=0.648 fully enveloped.
>
> **Instrument note that cost time:** the capture harness's visible-mesh roster skipped UNNAMED
> meshes, so "what is drawing my sky" was answered with a roster the culprit could not appear
> in. It now falls back to a geometry+material description. That block is injected through a
> template literal — a nested backtick inside it terminates the OUTER one and the page silently
> receives a syntax error, hanging the harness with no diagnostic. Concatenate.

### Wave 4 — ch5 recovery-path hygiene (independent; any time)
- [ ] Inside `createSkyDriftEnvironment` (module survives — ADR-0015): stop mounting the
      6 strata sheets, lenticular stack, noctilucent veil (invisible-by-construction
      4-octave FBM at α=0), the 3 god-ray fans (straight-edge alpha leak, mask 0.40 vs
      edge 0.31), ice crystals/wisps, the 4 lights (unlit scene), dead exports.
- [ ] KEEP every seam contract: sky dome + uSkyOpacity 5→6 handoff, ch5 cloud-sea copy
      (wire its stored-but-never-driven `cloudSeaOpacityUniform` — closes a live pop),
      summit ring, aurora + exit-opacity choreography, `rain-veil-particles` as the named
      survivor (the `cloud-deck-break` precedent), all uniform plumbing.
- [ ] Acceptance: `sky-drift-environment.test.js` + scope-invariant tests green; ONE
      capture under `?odysseyOneWorld=0` mid-ch5: no razor edges, no ultramarine patches.
- [ ] Zero default-path ms are claimed. This funds nothing; it is defect repair.

## 5. Verification discipline (non-negotiable, from the repo's own laws)

- Playground-first with the grade emulated; colour tuning OVERSHOOTS (flat NoToneMapping).
- One effect per session; per-chapter short captures only (TDR law). `ODYSSEY_CAPTURE_KEEP=1`.
- Capture-harness `render.*` metrics do NOT measure the scene — only `visibleMeshes`.
- ADR-0016 pairs: cooled machine verified by GPU counters (a sustained co-tenant passes
  the drift check), content-matched draws min==max, p50 never mean, baseline first+last,
  unique `--out`/`--port`, first-configuration-after-boot voided as cold-compile.
- Edge-crawl checks need REAL time drift: `?t=` freezes update() dt (repo memory), so
  far-field shimmer is checked with two separate captures at t=9 / t=9.5, never in-page.
- Unit guards, not just screenshots: extend `odyssey-world-lints.test.js` for the new
  vertex taps' `.level(0)`; add a palette assertion test (underside-lighter-than-sky as
  a computed-colour invariant) and a `.visible`-write test for any new gated mesh.
- Commit per wave, `-F` message file, OUTCOME blocks in this doc, MEASURED/ESTIMATE tags.

## 6. Budget position (all ESTIMATE until Wave 0 prices the deck)

| Item | Class |
|---|---|
| Wave 1+2 fragment adds (+2..4 taps, ~40 ALU on covered pixels) | +0.10..0.25 ms |
| Discard floor | −0.06..−0.12 ms |
| Net target at ch4 p=0.42 | ≤ +0.15 ms beyond drift bound, enforced by pair |
| Reserve levers (ordered) | one-axis gradient; vertex cell collapse; opaque-core split |
| Ch5 station | new cell, baseline-null until first admissible pair |
| Ch4 lane §7.1 (10.16 vs 7.0 aspirational) | UNTOUCHED — this plan needs no call on it |

## 7. Owner decisions (please pick when ready — nothing above blocks on these)

1. **§7.1 Hero composition wave — DECIDED BY THE OWNER 2026-08-13, and the approach changed.**
   The owner supplied two Witness screenshots and asked for both the sheet upgrade and the
   heroes. A 4-agent design pass then rejected the imposter plan outright: r181's
   `billboarding()` is mesh-level (`SpriteUtils.js:35/61`), so under `InstanceNode` — which
   reassigns `positionLocal` first (`NodeMaterial.js:799-808`) — the whole troupe rides the
   camera; a transparent card cannot sort against the mountains because `renderOrder` strictly
   dominates depth (`RenderList.js:12-31`); and a flat card has no vertical mass, which is the
   point of a hero. **Shipped instead: real OPAQUE low-poly geometry** — merged squashed
   icospheres, one mesh, `FrontSide`, `depthWrite`, no billboard basis, no sorting scheme, no
   textures. It deletes all three problems rather than managing them. ⚠️ One tempting argument
   was REFUTED in design: opaque heroes do NOT occlude the deck (from a camera below an
   overhead sheet, everything above it is behind it along the ray), so they are purely
   additive cost. *(Original imposter framing, superseded:)* After Wave 2 lands and you've seen the sky:
   do we add 2-3 authored cumulus + a far strata row framing the summit? Requires solving
   the instanced-billboard basis properly (r181 `billboarding()` is mesh-level; per-
   instance yaw needs a hand-rolled basis) and a deck-vs-hero sort design. ~1-2 sessions
   design + the atlas bake pipeline. Recommended: decide after seeing Wave 2.
2. **§7.2 The ch4 lane call** (carried from the water plan §7): optimise vs re-budget the
   7.0 aspirational max that ch4 already exceeds by ~3 ms. Clouds don't spend against it,
   but the hero wave and any volumetric revival would.
3. **§7.3 The crossing (volumetric punch-through).** Parked. If ever revived: interior-
   whiteout-only variant (~4 steps) first, full slab marcher only after a re-budgeted
   lane, and the critic's cost/arithmetic corrections are the starting spec.

## 8. Files

`src/rendering/odyssey/world/odyssey-world-renderer.js` (bake :281, deck :1032-1166,
uSunDir :507, dispose :1727) · `scripts/odyssey-gpu-split.mjs` (CONFIGURATIONS) ·
`src/rendering/odyssey/composition/odyssey-cloud-bank.js` (Wave 3) ·
`src/rendering/odyssey/chapter-environments/sky-drift.js` + `.tsl.js` (Wave 4) ·
`perf-budgets.json` · `docs/adr/0015` (module retention) · `docs/adr/0016` (measurement) ·
current-state refs `public/playground-refs/act2-clouds-current-*.png`.

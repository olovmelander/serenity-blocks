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
   zenith sky colour; the grade (outputScale 0.82, ACES, sat 1.10) super-saturates it.
   The deck's own history records the same class ("ragged navy shards", :1127-1132).
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
- [ ] Add `{ id: 'no-clouds', flags: { odysseyWorldNoClouds: '1' } }` to CONFIGURATIONS in
      `scripts/odyssey-gpu-split.mjs` (the `no-water` pattern; `--flags` applies to both
      sides of a pair, so a real configuration entry is the only way to get the
      differential). Run the trio at ch4 p=0.42, Lane B, quiet machine (counters checked,
      not drift), unique `--out` + `--port`. **The deck gets its first-ever price.**
- [ ] Establish the ch5 station: candidate p≈0.55 — prove it sits outside the 4→5 ecotone,
      outside the bank window (0.588-0.708), before ch6 ignite presence; first admissible
      baseline into a new `odysseyAct2Ch5SkyGpuP50LaneBMs` cell, baseline-null convention
      (the shoreline precedent). Plus one LOOK-ONLY station inside the bank window
      (p≈0.63) for §1.6/late-palette checks — no perf cell.
- [ ] Playground rig: clone the deck material into
      `src/playground/effects/odyssey-cloud-deck.effect.js` with the in-game grade
      emulated (`outputColorTransform=false` + `renderOutput`) — the deck's one recorded
      colour disaster came from tuning without the grade. Refs via `?ref=…&refMode=split`.
- [ ] Cold-boot check baseline: time one in-game One World boot (the §1.8 stall is a
      standing defect on this path; every later wave repeats this check).

### Wave 1 — the silhouette (the look's spine)
- [ ] **Rebake the A channel** of `bakeDetailNormal` (:281) as a billow spectrum:
      `A = 0.62·discs + 0.38·invertedRidgeWorley` — union-of-discs iso-contours give
      scalloped lobes by construction. Grep-verified: `.a` is consumed ONLY by the clouds
      (:1069, :1105), so nothing else moves. B stays value noise (terrain snowJitter).
- [ ] **Anti-tiling (critic defect):** the 0.00205-scale octave repeats every ~488 u and
      authored disc silhouettes WILL be recognised. Mitigate in the bake+graph: sample
      octave A twice at irrationally related scales/rotation (~30°) and max() them, so no
      hero lobe recurs on a lattice; assert visually at the shore station's 10 km view.
- [ ] Clouds move to A-only sampling (fragment octaves + vertex billow, `.level(0)` law).
- [ ] **Histogram-match the new A** to the old (p10/p50/p90 = 0.42/0.58/0.70 ± 0.02,
      bake-time assert) — but treat thresholds as *starting points*, not settled: the
      critic is right that matching one octave's marginals does not bound the summed
      field. Budget one tuning session for 0.63/0.40 and the billowGate bands.
- [ ] **Posterised two-stop opacity**: hard AA edge (footprint-widened band kept) + fully
      opaque core (`coreA → 1.0`) — kills the milky 0.94 sky-bleed; plus the drawn-line
      band at the threshold crossing; plus `alpha < 0.004 → Discard()` (blend-RMW floor —
      honest estimate −0.06..−0.12 ms, NOT the self-funding story; Wave 2's pair decides).
- [ ] **Street/coverage term with a real wavelength** (critic: the proposed 0.00022 sine
      was ~28 km ≈ constant): coverage varies in x at ~3-5 km wavelength, ±0.045, so
      valley cumulus reads as placed masses; keep the world-Z ramp as the macro trend.
- [ ] Vertex gate estimate gains the second octave (one more `.level(0)` tap on 9.8k
      verts) so geometry sinks where fragments actually go transparent.
- [ ] Screenshots: shore station pitched up (below), summit (above), 0p55 (in-sky).

### Wave 2 — two-band sun shading (the paint)
- [ ] Gradient pseudo-normal from octave A (+2 taps, forward differences; guarded
      normalize — zero-vec const-fold kills WGSL compile), `dot(N, uSunDir)` through ONE
      narrow smoothstep band (never equal edges) → quantised scalloped terminator.
- [ ] Palette per §3: `cloudLit` warm off-white / `cloudShade` cool violet-leaning hue
      shift / `underCool` ONE flat underside tone, all overshot for the grade; density no
      longer appears in colour (interiors flat; kills the inverted glow-edge read).
- [ ] **Per-fragment fromAbove** against displaced fragment height (varying of 660+billow)
      — crest-first reveal when climbing through the deck, no global colour swim.
- [ ] **Root-pin law**: every node shared between colorNode and opacityNode (density, N,
      band) gets a bare `.toVar()` at the Fn root BEFORE any branch — the ghibli-water
      zero-starve trap, now a repo law (skill table row exists).
- [ ] **The pair**: ch4 p=0.42 trio must hold **net ≤ +0.15 ms beyond the session drift
      bound** with draws content-matched. If it reds: (a) drop the gradient taps to
      one-axis, (b) vertex empty-cell collapse (design against the torn-cliff failure the
      billowGate comment documents — morph-band-coherent, amplitude-only), (c) the
      Witness two-pass opaque-core split. In that order, measured each step.
- [ ] **Late-ch5 palette check** (critic: unanswered by all three): capture at the p≈0.63
      look-station while the script marches toward void — assert the underside stays
      lighter than adjacent sky through the grade (pixel sampling, the §3 rule).
- [ ] Cold-boot check; dispose()/stats.materials audit for any new texture object.

### Wave 3 — the seam cloud-bank speaks the same language
- [ ] Restyle `odyssey-cloud-bank.js` (renderOrder 12, p 0.588-0.708) with the same
      quantised-band + drawn-edge grammar — it composites OVER the new deck and is the
      last cloud of the act. Same palette uniforms, same root-pin law. LOOK-station
      capture at p≈0.63 before/after; no perf cell (occluder is windowed and small).

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

1. **§7.1 Hero composition wave (imposters).** After Wave 2 lands and you've seen the sky:
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

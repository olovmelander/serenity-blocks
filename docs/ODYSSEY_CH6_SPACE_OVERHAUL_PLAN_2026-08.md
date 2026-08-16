# Odyssey Ch6 "Cosmic Expanse" — the Painted Cosmos overhaul (2026-08)

**Status: ~~PLANNED 2026-08-15. No wave has started.~~ → Waves 0/1/2/3/4/5 plus the
§3b re-composition SHIPPED 2026-08-15/16.** See the WAVE OUTCOME blocks in §5 and
`git log -- src/rendering/odyssey/chapter-environments/cosmic-expanse.js`
(`960335d3`, `dff08702`, `e9ccc0f6`, `c5f8b66d`, `98704055`, `ef19f9b4`), plus
`ca0ed7de` (Wave 1, 13 levels). **OPEN:** Wave 6 (grade / seams), owner D1's remaining
half (lever-C spline growth), D3 (budget cell maxima, still `null`), D4 (reference-set
blessing), and the owner's own in-game look verdicts. This header was missed in the
`f9d4fba8` annotation pass that added the outcome blocks — found by the §7 sweep.
Owner asks: (1) significantly longer, grander space sequence before the black hole;
(2) planets / stars / auroras / nebulas / cosmic phenomena redesigned to the Act I/II
stylized direction (Ghibli, The Witness, Firewatch, Europa, Journey); (3) more vivid,
atmospheric, "alive" lighting and composition; (4) a smoother, more cohesive journey
from atmosphere into deep space.

This plan covers **ch6 `cosmic-expanse` (p 0.648–0.815)**, the **5→6 ascent seam**, and
the **6→7 handoff**. Ch7 `black-hole-transcendence` itself is out of scope except where
ch6's black-hole *omen* foreshadows it; the journey does not end at the black hole
(ch8 `urban-dreams` follows).

Sibling plans this document deliberately mirrors (structure and laws):
`ODYSSEY_ACT2_CLOUD_FIELD_PLAN_2026-08.md` (the closest technical precedent),
`ODYSSEY_ACT2_FOREST_PLAN_2026-08.md` (the paint model),
`ODYSSEY_ACT_I_REBIRTH_PLAN_2026-08.md` (the diorama-rebuild-in-place precedent —
ch6 is, like ch1, a diorama outside the One World by decision:
`ODYSSEY_ONE_WORLD_PLAN_2026-08.md` §3.0.1, do-not-"fix" note).

---

## 0. Orientation — what ch6 is today

### 0.1 Architecture facts (verified 2026-08-15)

| Fact | Value | Source |
|---|---|---|
| Chapter id / module | 6 → `cosmic-expanse` | `chapter-environments/registry.js:28` |
| Span | p 0.648 → 0.815 (0.167 — already the longest chapter; ~~9 levels~~ **13 levels, ids 36–48, since Wave 1 `ca0ed7de` — the p-window is UNCHANGED, the levels are packed denser**) | derived, ~~`odyssey-layout.js:223-250`~~ **now `:238-265`; `ca0ed7de` added +15 lines inside `DEFAULT_LEVEL_POSITIONS_BY_ID` above it. The old range was exact at this doc's own commit `a3fffd3c`.** |
| Neighbours | ch5 `sky-drift` (bright daylight after Wave C) · ch7 `black-hole-transcendence` | registry |
| One World | **NOT a member** — ch2–5 only; ch6 owns its frame as a diorama | `OdysseyBoardController.js:145`; One World plan §3.0.1 |
| World act gate | world stops drawing at p ≈ 0.678 (margin **0.03 — do NOT raise to 0.06**) | `world/odyssey-world-act-gate.js:29,37-44` |
| Group anchor | `getChapterPathRange(6).center` ≈ (−74.6, 723.3, −663.7) | One World plan :122 |
| Spline | CatmullRom tension 0.3; **total arc length pinned 1767.58** by test | `path-utils.js:65-88`, `odyssey-path-layout.test.js:119` |
| Camera | act BEYOND profile (followDistance 42, fov 66) + `CHAPTER_FRAMING_OVERRIDES[6]` (`worldUp 0.55`) | `chapter-profile.js:100-102`, `OdysseyCameraController.js:141-153` |
| Draws | ~24–26 (env) + 4 (corridor field) | code audit 2026-08-15 |
| First-visit hitch | 560 ms (RTX 5080) | `ODYSSEY_AAA_PERF_FINDINGS_2026-07.md:256` |
| Lane B cost | ~~UNMEASURED~~ **MEASURED 2026-08-15 (Wave 0): 17.04 ms p50 / p95 26.35 at reef p=0.73** — the worst station in the journey outside ch1 | `gpu-split-ch6-reef-laneB.json` |

### 0.2 Visual inventory (the incumbent)

All of it `MeshBasicNodeMaterial`, almost all of it **AdditiveBlending + depthWrite:false**:

- **Void sky dome** — SphereGeometry(2400), per-fragment FBM galactic backdrop, every frame (`cosmic-expanse.tsl.js:59-162`).
- **Hero triad**, NDC-solved against a camera replay, marching A→B by `uApproach`
  (`cosmic-expanse.js:115-138`, `:1398-1465`): black hole omen (~~~7 meshes~~ **6
  meshes with TWO glow rings, not 3 — ⚠️ this was WRONG THE DAY IT WAS TYPED, not
  overhaul drift: `createBlackHoleTSL()` performs exactly six adds and
  `const glowColors = [0xff7b3a, 0x7f3cff]` has always had two entries (verified at
  `a3fffd3c~1`, and `git log -S glowColors` returns only the file's creation). The "3"
  was probably copied from the gas giant's "3 ring belts" later in this same
  sentence, which IS correct.**: horizon sphere, Keplerian ring disk, fresnel shell,
  photon ring, 2 glow rings), gas giant
  "the earth" (banded storm sphere + fresnel halo + 3 ring belts, one material via
  `aRingColor`), distant galaxy (1 additive spiral billboard).
- **Nebula tiers** — 110 near + 90 far instanced billboard quads, each running
  **domain-warped `fbm3` + `ridged3` per fragment** (`:661-804`).
- **Dust tiers** — 200 + 250 iridescent motes; **suction debris** 500; **streak motes** 90;
  **asteroid garland** 12 (the one on-law surface: `createAsteroidRockTSL`, wrapped
  view-space key + warm bounce + fresnel rim + never-black shadow floor).
- **Nebula pillar** — 1 tall additive plane, `uApproach`-gated.
- **Aurora→filament bridge** — 3 additive curtains, green→crimson by `uApproach`.
- Lights: ambient 0x141425 + orange accretion point + violet directional rim.
- Machinery that is **solved and fragile**: `resolveCosmicEntryContinuity` reveal
  buckets, `resolveSummitEarthStaging` (`spaceReveal` holds all deep-space clutter at 0
  pre-boundary so only the earth enters the daylight frame — owner-praised, protected),
  the corridor group frame, `material.fog=false` on everything (guarded by
  `tests/unit/odyssey-chapter-fog-optout.test.js`), hero off-axis <40° and asteroid
  count asserted by `cosmic-expanse-environment.test.js`.

### 0.3 The 5→6 seam (shipped; extend, never rebuild)

Seven interlocking mechanisms (`ChapterEnvironmentManager.js`, `sky-drift.js:489-543`,
`seam-bridges.js:37-43`, `odyssey-cloud-bank.js`, `ChapterThresholdDirector.js:79-93`):
ecotone crossfade (seamWidth 0.03), the long ch5 carry (`SEAM_56_CARRY_HOLD_BAND 0.4`,
aurora carry to 0.85), the decoupled dark-space backdrop fade (first 12 % of the span),
the wide ±0.07 colour bridge through deep teal, the cloud-bank occlusion lens the camera
flies through, the "Atmosphere Edge" threshold veil, and the earth early-ignite across
the last 43 % of ch5. **Act edges are occlusion moments, never crossfades.** The plan
builds *on top of* this machinery; no wave may rewrite it wholesale.

---

## 1. What the research established (2026-08-15, three-agent sweep, cited)

### 1.1 What stylized games actually do in space

- **Nobody raymarches.** The Witness's signature sky is opaque sculpted meshes with
  centroid-bent normals, wrap diffuse and a fake-Mie silver lining
  (artofluis.com/3d-work/the-art-of-the-witness/clouds/ — primary source). Outer Wilds'
  sky is baked skybox art; Dark Bramble's "nebula" is distance fog inside an enclosed
  volume plus staged silhouettes. Journey and Sky CotL use painted domes. Raymarched
  nebulas (Duke's Shadertoy lineage, Gaia Sky's post-process volumes) are photoreal
  tools with an iGPU-hostile floor, and Shadertoy code defaults to **CC BY-NC-SA — 
  reference the look, never port the code**.
- **The canonical open procedural space skybox is wwwtyro/space-3d**
  (github.com/wwwtyro/space-3d, **Unlicense — safe to port**): seeded point-star +
  FBM-nebula layers rendered once into a cubemap. Spacescape (alexcpeterson.com/spacescape)
  is the offline equivalent; its layer-stack recipe (point stars → billboard star layer →
  smooth+ridged FBM nebula layers) is the authoring model to copy.
- **Stylized planets** converge on banded `dot(N,L)` terminator paint + an analytic
  fresnel rim, plus one backside-rendered halo shell — no scattering integral
  (Zylann/godot_atmosphere_shader's "fake colors" variant; dgreenheck/threejs-procedural-planets
  for geometry; GPU Gems 2 ch16 cited only as the road not taken).
- **Atmosphere→space** in stylized games is altitude-keyed authored ramps: dome colour
  and opacity keyed to altitude, stars always present behind and revealed as the dome
  thins (Outer Wilds, observationally — no public writeup exists, verified). The
  one-step-more-physical upgrade path is Sebastian Lague's baked optical-depth LUT
  (github.com/SebLague/Solar-System, **MIT**) — still no per-frame marching.
- **Starfields at production scale** are instanced quads with per-star colour from a
  blackbody table and vertex-stage twinkle (threejs.org/examples/webgpu_tsl_galaxy —
  our exact stack; jorenjoestar.github.io "Rendering Astronomic Stars" for spectral→RGB;
  ef-map.com's 200k-system three.js starfield for the engineering discipline).
  Warp streaks = stretch the same instanced quads along velocity in the vertex stage —
  no post pass, no new draws.
- **Auroras from orbit** read as an **oval crown around the pole**, not a wall (NASA
  ISS photography: nasa.gov/image-article/aurora-from-space, svs.gsfc.nasa.gov/31281).
  Curtain meshes read flat under a free camera (tonisagrista.com/blog/2024/rendering-aurorae-nebulae)
  — **neutralized by our rails camera**, which never orbits them.
- **Stylized black holes** converge on: sculpted opaque accretion disc with the
  relativistic Doppler asymmetry *painted* as an authored gradient, black sphere
  horizon, and (optionally) one gated radial screen-space distortion pass with an
  Einstein-ring annulus (creotiv/three-js-black-hole-simulation, Scenes3D/black-hole,
  kelvinvanhoorn.com supermassive-black-hole-tutorial). Full geodesic integration
  (oseiskar.github.io/black-hole) ran 30 fps on a GTX 750 Ti — an iGPU non-starter.

### 1.2 What this project has already measured (the laws that bind this plan)

- **Opaque geometry beats transparent billboards ~20×**, and a transparent sheet's cost
  is **coverage-independent** (cloud plan, both measured). Ch6 is currently ~1,500
  additive billboard instances plus a full-screen FBM dome — the exact family Act II
  retired.
- **A per-fragment-FBM backdrop dome is the whale.** Act I's dome cost 15–19 ms on
  Lane B until its noise was baked (`odyssey-act1` §10). Ch6's void dome is the same
  pattern, ~~unmeasured~~ **MEASURED 2026-08-15 (Wave 0) and the law CONFIRMED: 13.37
  of 17.04 ms Lane B at reef p=0.73 — 78 % of the frame, and it owned the tail
  (p95 26.35 → 3.80 without it; drift 0.000, draws constant per configuration).
  RETIRED in Wave 2 for the baked equirect backdrop, re-baselining the cell to
  4.13 ms; the FBM path survives only behind `?odysseyCh6ProceduralDome=1`.**
- **The cloud-field idiom is proven**: 52 sculpted opaque masses, SDF-gradient normals,
  baked AO/seed in vertex colour, 2–3 band wrap paint, quantised Mie, dithered opaque
  dissolve, rigid seeded drift — **one draw, 0.197 ms**.
- Fades that must stay in the opaque queue are **dither** (`opacityNode` + `alphaTest`,
  `transparent:false`).
- The winter theme's aurora is **capture-verified against the owner's reference photos**
  (emerald 133.9°–145.3°, teal-end yellow 1.1 %) — its palette and shading port.

### 1.3 Reference set for the bar (owner to bless — D4)

Drop into `public/playground-refs/ch6-*` for `?ref=…&refMode=split`:

- Ghibli official stills (ghibli.jp/works — free archive): *Castle in the Sky* Laputa
  night reveal + Levistone glow; *Howl's Moving Castle* star-catching scene.
- The Witness clouds page (artofluis.com) — band structure and silhouette discipline.
- Eyvind Earle (wikiart.org/en/eyvind-earle) — hard-edged colour bands, rim-lit
  silhouettes: practically a spec for banded space art. Roger Dean
  (sci-fi-o-rama.com Roger Dean galleries) — hero silhouettes against gradient voids.
- NASA ISS aurora-from-orbit set (luminance/shape reference only, repainted to palette).
- Outer Wilds concept compilation (tumblr sayonarawildhearts 693413915501232128);
  Journey GDC "Art of Journey" (gdcvault.com/play/1017799).

Once blessed, sample a **numeric bar** with the decile box sampler (forest-plan
method): nebula band count and shade/lit ratios, void floor luma (never pure black),
star colour gamut, aurora hue window. Verdicts are judged against numbers, not vibes,
**through the grade** (playground is NoToneMapping — tuning must overshoot).

---

## 2. Why the incumbent cannot be tuned into the target

1. **Wrong cost family.** ~1,500 additive, depthWrite-off billboard instances (200 of
   them running domain-warped FBM per fragment) plus a per-fragment-FBM fullscreen dome.
   Both of Act II's measured laws say this is the most expensive possible way to draw a
   sky, and the coverage-independence law says trimming counts will not buy it back —
   the fix is architectural (bake + sculpt), not tuning.
2. **Wrong light statement.** Additive glow everywhere is Act I's named failure: "ember
   glow is everywhere, so light is nowhere." The direction demands ONE readable key
   (the accretion key / the sun behind the summit earth) with darkness-gated emission.
3. **No silhouettes.** Additive FBM wisps cannot hold a silhouette; the direction is
   silhouette-first with flat band interiors (the squint test). A nebula in this art
   style is a *sculpted thing with edges*, i.e. a cloud with an emissive interior.
4. **Palette drift.** The violet/orange sci-fi default ignores the limited-palette,
   declared-collision law (warm and cool never mix in one frame except at an authored
   collision — which here is the black-hole approach, not every sprite).
5. **Pure-black void.** "Nothing in a Ghibli frame is ever pure black" — the void needs
   the Act I black lift family (≈ 0.017, 0.021, 0.036) and stacked hue bands for depth,
   not RGB-zero.
6. **Scale is authored short.** The owner wants grander and longer; the chapter's
   staging (reveal buckets, hero march, pillar window) is all tuned to the current
   0.167 span and NDC-fitted to the current spline — extension is a re-solve, not a
   stretch.

---

## 3. Design — "The Painted Cosmos"

One sentence: **bake the deep cosmos once, sculpt the near cosmos opaque, paint both
in 2–3 quantised bands from the colour script, and spend the savings on a longer,
staged voyage with one key light.**

### 3.1 Layer architecture (far → near)

| Layer | Technique | Draws | Frame cost target |
|---|---|---|---|
| **Deep backdrop** | Seeded TSL bake → cubemap RT at chapter load (space-3d recipe, restyled): quantised 2–3-band nebula fields, painted milky-way band, far stars, void floor ≥ black-lift | 1 (dome/box) | ~texture fetch |
| **Mid cosmos** | 3–5 authored **sculpted nebula masses** + rebuilt pillar: cloud-field idiom (smin-union hulls, SDF-gradient normals, baked AO/seed vertex colour, wrap 2-band paint + emissive interior gradient, fresnel drawn edge, dithered opaque dissolve, rigid Lissajous drift) | 1–2 (merged) | ≤ 0.35 ms Lane A-class |
| **Near field** | ONE instanced-quad star batch (quantised 5–7-entry blackbody ramp, hashed vertex twinkle, velocity-stretch streaks), trimmed dust motes, asteroid garland (kept as-is) | 3–4 | measured Wave 0 |
| **Heroes** | Gas giant repaint (banded terminator + warm terminator band + fresnel rim + backside halo shell), BH omen repaint (sculpted opaque disc, painted Doppler asymmetry, never-black shadow floor), galaxy repaint (banded spiral, single quad stays) | ~12 | measured Wave 0 |
| **Phenomena** | Aurora as polar **oval crown** on the gas giant (2–3 vertex-swayed ribbon strips, winter-verified emerald palette); comet with sculpted tail as a mid-chapter authored moment | 2–3 | ≤ 1 tick each |

The retired systems (FBM dome, additive nebula tiers) stay restorable behind flags,
ADR-0015 pattern, with **live polarity** (a dead lever reports innocence, not absence —
cloud-flag lesson).

### 3.2 The voyage (composition over the lengthened span)

Beats along the rail, replacing "one room of sprites" with authored movements —
pacing per the cinematic plan: *accelerando toward Space, slow & vast inside it*:

1. **The Threshold (entry, ~first 15 %)** — the shipped seam, extended: sky runs the
   altitude ramp lit-blue → indigo → void; **stars ignite while the sky is still lit**
   (the overlap is the magic moment); the summit earth hangs as the sole hero; horizon
   curvature and limb rim grow.
2. **The Shallows (15–40 %)** — quiet, near-empty vastness: baked backdrop + near
   stars + the earth receding; the aurora oval crowns its pole (the emerald cycle's
   last appearance — a callback to ch5's aurora carry, now seen *from above*).
3. **The Reef (40–70 %)** — the sculpted nebula archipelago: the rail threads between
   opaque masses (clearance = SDF-at-rail, cloud-plan rule), asteroid garland,
   the comet moment, the rebuilt pillar as the far landmark.
4. **The Fall (70–100 %)** — declared warm/cool collision: the BH omen looms
   (existing `uApproach` march, retimed over the longer span), palette narrows,
   streak stretch rises, the 6→7 "Lensing Engage" threshold takes over.

### 3.3 Lengthening the chapter (owner D1)

Three levers, in increasing risk (all verified against current code):

- **A. Re-space `levelPositionsById`** (`odyssey-layout.js:60-116`) so ch6's levels
  occupy more of 0..1. Cheapest; validated by `validateOdysseyLayoutData`; but every
  chapter's p→world shifts (arc-length mapping), so all chapter anchors and stations move.
- **B. Add levels to ch6** (`levels.js` `chapter: 6` + positions) — touches difficulty
  model, LevelRegistry, HUD; gives real played time, not just spline share.
- **C. Extend the ch6 spline corridor** (control points 17–19, the re-authored helical
  sweep) — ⚠️ "ARC LENGTH IS LOAD-BEARING" (`odyssey-layout.js:41-46`); total is pinned
  1767.58 by test; the 6→7 hairpin fix must survive (rail turn 17.1°, aim-pitch floor).

**Recommendation: A + B together** (spline untouched): re-space so ch6 spans ~0.22–0.24
of the journey and add 3–4 levels so the space act is also *played* longer. Whatever is
chosen: **re-solve the hero `APPROACH` NDC fits** with the existing least-squares
camera-replay tooling ("re-solve the fit whenever the spline moves" — and a p-range
change moves the replay), re-pin `odyssey-path-layout.test.js`, re-check
`SUMMIT_EARTH_REVEAL.spaceGateBand` (chapter-fractional → its absolute window widens)
and every `SEAM_56_*` band, and re-run the framing assertions (<40° off-axis).

### 3.4 Lighting & atmosphere

- **One key**: the accretion point light stays the chapter's key; the violet
  directional rim becomes the *fill statement* (cool axis), ambient carries the black
  lift. Everything emissive must justify itself against "glow everywhere = light
  nowhere". Surfaces follow the asteroid template (wrapped view-space key + warm
  bounce + fresnel rim + never-black floor) — it is already the chapter's proven
  banded-space-shading recipe and is immune to instanced-normal handling.
- **Aerial-in-space**: depth = stacked hue bands (Ponyo law), authored into the
  backdrop bake and the nebula band palette — not fog (`material.fog=false` everywhere,
  test-guarded; the trap has recurred 4×).
- **Ascent ramps**: two small altitude-keyed ramps (zenith, horizon) drive the 5→6
  colour bridge's endpoints instead of new machinery; star/backdrop alpha keyed off the
  same scalar, igniting before full dark. Lague's baked optical-depth LUT is the
  documented upgrade path if one more step of fidelity is ever wanted (MIT), still
  no marching.
- **Grade**: ch6's entry in the per-chapter grade table gets its pass *last* (Wave 6),
  judged from the **spline camera via `scripts/odyssey-chapter-capture.mjs`** — never
  from a synthetic rig alone (the rig misled a whole cloud session).

### 3.5 Alive, not boiling

Motion laws carried over: rigid per-mass Lissajous drift with seeded phase (masses),
hashed twinkle in the vertex stage (stars), velocity-keyed streak stretch (travel),
slow Keplerian swirl (disc), aurora sway at clump level. **No silhouette-frequency
noise, no breathing terms, far tiers static.**

---

## 3b. THE COMPOSITION CONTRACT (added 2026-08-15 eve — second research round, cited)

The first research round settled *how to draw things cheaply*; this one settles *where
things go*. Sources: Bungie sky artist Tony Arechiga (80.lv), Jesse van Dijk (Destiny),
Jenova Chen + Matt Nava (Journey GDC), Alex Beachum (Outer Wilds), Chesley Bonestell /
John Harris / Moebius / Roger Dean, James Gurney's scale writing, NASA/ESA pillar
science, Uncharted 2 pacing, roller-coaster sequencing theory. Full citations in the
research transcript; the twelve rules, binding on the Wave 1 re-composition:

1. **One dominant mass per view, never two rivals** (Bonestell's invariant).
2. **One always-visible north star that grows only with progress** — the black hole is
   Journey's mountain.
3. **Every major object visible SMALL and EARLY from far away** before its close
   encounter (Outer Wilds sightline funneling).
4. **Three value bands checked in grayscale**: dome / sculpted masses / near objects
   must occupy separable value ranges (Arechiga). The dome must be DIMMER, cooler,
   simpler than the masses — today they compete.
5. **Prove the dome is behind something**: ≥1 mass and the asteroid stream must
   overlap dome features in-ride (the only cure for wallpaper syndrome).
6. **Big+soft vs tiny+sharp — delete the middle** (Gurney): haze and soft edges on
   giants only, crisp detail on near asteroids only, no mid-scale detail band.
7. **Asteroids are witnesses, not filler**: uneven clusters sweeping near-camera;
   the parallax-speed ratio IS the scale statement.
8. **One causal light unifies the nebulas**: every dense head points at one
   illuminator, wisps streaming away (real pillars all point at their ionizing star).
9. **Hang the giant low + diagonal, framed under a passable nebula arch**
   (Bonestell × Roger Dean's proscenium).
10. **Heartbeat pacing with authored emptiness**: density peaks alternate with
    genuinely sparse drift; the quiet leg after a peak is load-bearing.
11. **Save one element and one palette state for the finale, keep the finale SHORT**
    (Chen cut Journey's ending to a third; maximalist stacking = anticlimax).
12. **Break even spacing**: masses distributed 1 hero / 2 medium / 2 small at
    irregular intervals with varied silhouettes (the "cosmic corridor" failure is
    equal-size equal-space stations).

**Verdict on the shipped Wave 3 layout against this contract:** same-size masses
(breaks 12), same paint roles (needs the forest's species-role system), dome competes
with masses in hue+value (breaks 4), BH swallowed between two friendly masses at the
reef (breaks 1+2), no quiet beat reads (breaks 10), asteroids evenly-spaced grey
filler (breaks 7). **The re-composition executes WITH Wave 1** — beats are placed
along the FINAL path length, so specs are re-authored once, not twice.
New refs for `?ref=` use: Webb Pillars weic2216b, Cosmic Cliffs weic2205a, Hubble
Mystic Mountain heic1007a, Orion heic0601a (ESA/NASA image pages).

> **RE-COMPOSITION OUTCOME (2026-08-15, `185aca0b` + `e9ccc0f6`, ledger `29001cd8`).**
> Specs re-authored against all twelve rules: **1 colossal cool HERO VEIL** (980 u,
> far right at z −1390 — it never rivals the upper-left black hole), 2 warm medium
> reef masses, **2 small sharp witnesses** near the rail, and the pillar re-aimed at
> the black hole as the causal light; irregular depths, **8.5× size spread**. Paint
> split into two ROLES — warm workhorse vs the dim, wide-banded, low-ember cool giant
> (Gurney's big+soft against tiny+sharp) — as two materials, **two draws**. The baked
> dome dropped a grayscale value band (×0.62) so depth stops collapsing. The asteroid
> garland became **three uneven SEEDED clusters** (the old even-lerp diagonal was the
> documented cosmic-corridor failure; the old `Math.random` seats also re-rolled every
> build, making capture A/Bs incomparable), and the pillar moved off the veil's
> sightline. Measured perf-neutral: **2.82/2.56 ms, 63 draws** (drift 0.262 — quote as
> a band, not a point). Rail clearance is a CI assertion (SDF-at-rail ≥ 120 u).
> ⚠️ The dome's ×0.62 later proved **insufficient in-game** — see the ground-truth
> pass in §5's Wave 6 note.

## 4. Hard look rules (the checklist every wave's screenshots answer to)

1. Never pure black — void floor at the black-lift family; shadow floors non-black.
2. One key light; emission is darkness-gated; no additive glow without a job.
3. Shade = hue shift (cool toward void / warm toward key), saturation never collapses.
4. 2–3 value bands, ~8 % soft thresholds, band interiors FLAT; over-extended ramp ends
   are the softness dial (Witness↔Ghibli).
5. Silhouette-first: every nebula/mass/disc reads as a shape at squint; detail lives at
   edges; silhouettes never boil.
6. Limited palette from the colour script (roles/slots, shared NODES not copied hex —
   "four answers to one contract" disease); warm/cool collide only at the declared
   collision (the Fall).
7. Regions, not bands: hue zoning of the cosmos is placed (which masses are rose, which
   teal), not striped.
8. `material.fog = false` on every new mesh (join the optout test); dither fades, not
   transparency, wherever the mesh is opaque-class.
9. Judge through the grade, from the spline camera, at pinned stations, `?t=` phase-locked.

---

## 5. Waves

Every wave ends with: playground screenshot(s) clean console → real-capture verdict at
the pinned stations → tests green → ledger updated. Perf deltas admissible per
ADR-0016 only (content-matched pairs, drift-judged, one thermal window per comparison,
warm-up discarded, Lane B via `--low-power` with adapter recorded — the 65.536 µs tick
means same-bucket = "below resolution", never "zero").

### Wave 0 — Price the incumbent, falsify the paint (no product code)
- Add ch6 gpu-split stations (proposed: entry p≈0.665, reef p≈0.73, fall p≈0.80) and
  bisect flags per tier (`?odysseyCh6NoDome/NoNebula/NoDust/NoHeroes=1` — live levers,
  verified to change draws). Measure Lane A + Lane B. **Distinct `--port` per run**
  (orphaned-Vite trap); never edit the tree mid-harness.
- Fill the reference bar: owner blesses refs (D4), decile sampler produces numbers.
- **Paint probe** in the playground (`ch6-painted-cosmos.effect.js`): ONE sculpted
  nebula mass (cloud-field builder scaled up, zero new shader concepts) + the banded
  gas giant + a baked-backdrop swatch, against refs in split mode.
- **Gate D0**: does the core trick clear the bar at all? Owner verdict on the probe
  shots before any sculptor/bake code lands.

> **WAVE 0 OUTCOME (2026-08-15, same day).** Five levers shipped + a fifth added
> (`odysseyCh6NoStars`), all proven LIVE by `cosmic-expanse-bisect-levers.test.js`
> (functional builds under each flag + harness-id pinning, 8 tests). **Fall station
> moved 0.80 → 0.78**: 0.80 sits inside the 6→7 ecotone (0.785–0.845, co-presence).
> All four runs admissible (drift 0.000 / −0.066 / 0.000 / 0.000, draws min==max):
>
> | Station · lane | baseline p50 | dome | nebula | dust | stars | heroes |
> |---|---|---|---|---|---|---|
> | reef 0.73 · A (1080p High) | 0.72 ms / 69 draws | **0.52** | 0.06 | 0.00 | 0.00 | 0.00 (−20 draws) |
> | entry 0.665 · A | 0.39 ms / 93 draws | 0.00* | 0.00 | 0.00 | 0.00 | 0.00 (−18 draws) |
> | fall 0.78 · A | 0.79 ms / 75 draws | **0.53** | 0.13 | 0.00 | 0.00 | 0.00 (−20 draws) |
> | reef 0.73 · **B** (610M 720p Med, adapter verified) | **17.04 ms** / 69 draws | **13.37 (78%)** | 1.70 | 0.00 | ~0 | 0.13 |
>
> \* the dome is NOT VISIBLE at entry by design (`nebulaReveal` holds `voidSkyOpacity`
> at 0 that early) — real absence, not a dead lever (reef proves liveness).
> **Two findings that reshape the funding thesis (§6): (1) the dome IS the frame on
> Lane B — 13.37 of 17.04 ms — and it also owns the frame tail (p95 26.35 → 3.80 with
> it removed), so the Wave 2 bake is no longer merely art-enabling, it is the single
> largest perf lever in the whole journey outside ch1; (2) the hero triad is
> draw-heavy (20 of 69) but time-cheap on both lanes — Wave 4's repaint need not
> reduce its mesh count for perf, only for the one-key light statement.**
> Cells created in `perf-budgets.json` (LaneA 0.72 / LaneB 17.04 / draws 69; max NULL
> pending D3). Probe BUILT and screenshot-verified (console clean, three iterations:
> sun moved lateral for the terminator read, star salt remapped to 0..1, band edges
> tightened); split-vs-howl044 verdict shots in the session scratchpad await D0.
> Reports: `gpu-split-ch6-{reef,entry,fall}-laneA.json`, `gpu-split-ch6-reef-laneB.json`.

### Wave 1 — Scope: the longer voyage (owner D1 first)
- Execute the chosen length lever(s); re-solve hero APPROACH fits via the replay
  tooling; re-pin path tests; re-tune `SEAM_56_*` bands, `spaceGateBand`,
  entry-continuity ramps; re-run framing/staging assertions.
- Gate: capture sweep of 5→6→7 shows no pops, heroes framed, earth beat intact
  (owner-praised — protected); all layout tests green. No look changes yet.

> **WAVE 1 OUTCOME (2026-08-15, `ae95c622` scout + `ca0ed7de` ship).** Lever A was
> tried FIRST and reverted on evidence (see D1) — the cheap re-space is measured dead.
> Shipped lever B: **ch6 = 13 levels (ids 36–48), 59 total**, four new levels between
> Stellar Shockwave and the finale trilogy — *Nebula Reef*, *Pillars of Creation*,
> *Comet Chase*, *Silent Drift* — named for the re-composed environment's beats, with
> the trilogy renumbered 46–48 so it still closes the chapter beside the dive. The
> owner's constraint (**nobody else shrinks**) is honoured: ch7/ch8 keep their exact
> path positions under new ids 49–59, and ch6's p-window is untouched, so no APPROACH
> re-solve or seam retune was needed after all. **Save compatibility is the real work
> here:** `SAVE_VERSION` 2 with an exported pure migration (ids ≥42 shift +4 across
> *numeric* `unlockedLevels`, *string-keyed* `completedLevels`, and `currentLevel`),
> called at BOTH steam-cloud-sync sites — a v1 cloud doc merged raw would alias old
> ch7 arrivals onto the new ch6 levels, and the merge spread inherited `version` from
> the cloud side (double-migration). Leaderboard prefix bumped `_v1_`→`_v2_`.
> `MAIN_ARC_LAST_LEVEL` 51→55 with `LOGISTIC_MIDPOINT` held at 34 so ids 1–41 keep
> their exact macro difficulty. **3388/3388 tests green** — 6 audit-predicted pins
> re-baselined, 5 new migration tests. Full blast-radius audit: session transcript,
> agent `afbe0c93336c74878`.

### Wave 2 — The baked backdrop
- `odyssey-cosmic-backdrop.js`: seeded TSL bake to a cubemap RT at chapter load
  (space-3d recipe: star layers + posterized FBM nebula bands + painted milky-way
  band), palette from colour-script slots. Bake budget ≤ 150 ms inside the existing
  warmup plan (Act II world bake precedent 312/400 ms); no bake work on the rAF path.
- Void dome switches to sampling the cubemap; per-frame FBM retired behind
  `?odysseyCh6ProceduralDome=1`. Far starfield (1200 quads) folds into the bake;
  the *near* batch stays live for twinkle.
- Gate: A/B captures at stations; Lane B delta ≤ 0 expected (this wave should *fund*
  the plan); bake time measured in the startup trace; no first-visit hitch regression.

> **WAVE 2 OUTCOME (2026-08-15, same day, owner GO'd the recommended path).**
> Shipped as `odyssey-cosmic-backdrop.js`: a seeded **CPU** bake (equirect 512×256
> RGBA8 DataTexture, ~65 ms at shipped resolution — the codegen-bomb rule, no
> renderer plumbing, unit-testable) rather than a GPU cubemap RT; the dome samples it
> with a slow seamless uv drift, RepeatWrapping-S so bilinear blends the seam pair.
> **The far starfield was NOT folded into the bake — deliberate deviation:** Wave 0
> measured both star tiers at 0.00 ms, and baking them would push their reveal from
> the early star window into the dome's later `nebulaReveal` window, costing the
> "stars ignite while the sky is still lit" beat to save nothing.
> **Exit gate MEASURED (Lane B reef, one thermal window, drift 0.131, draws 69==69):
> baked baseline 4.13/4.00 ms vs FBM-restored 17.10 ms — the swap recovers ~13.0 ms
> (17.04 → 4.13, −76%) and deletes the tail (p95 26.35 → 4.26, max 31.85 → 4.39).**
> Field look was tuned against a 1024×512 review render of the bake itself (three
> rounds: pocket thresholds up to restore the deep-vacuum share, lane 2.0 → 4.2
> ridged frequency because low-frequency crests read as solid salmon columns, rust
> weights halved); guarded by 9 tests in `odyssey-cosmic-backdrop.test.js`
> (determinism, seam texel-255-meets-0, 8-bit never-black floor, pocket/void shares,
> bake-time class, swap polarity + escape hatch + NoDome precedence, harness id).
> Lane B cell re-baselined 17.04 → 4.13. Report: `gpu-split-ch6-reef-laneB-dome-swap.json`.

### Wave 3 — The sculpted nebulas (atomic swap, owner D2)
- `odyssey-nebula-field.js` + `-specs.js` (frozen specs module, import-free): 3–5
  authored masses + the rebuilt pillar, merged to 1–2 draws, cloud-field idiom
  end-to-end (SDF normals, vertex-colour AO/seed, wrap 2-band + emissive interior,
  fresnel edge, dithered dissolve, rigid drift). Rail clearance = SDF-at-rail, test-asserted.
- Atomic swap: additive nebula tiers (110+90) retire behind `?odysseyCh6NebulaSprites=1`;
  dust tiers trimmed to the counts the look needs (coverage is a free art lever — set
  counts on look, price the draws).
- Gate: bar numbers met at the reef station through the grade; Lane B net vs Wave 0
  within the budget cell; swap is single-commit revertable.

> **WAVE 3 OUTCOME (2026-08-15, same day, owner delegated the sequencing).** Shipped:
> `odyssey-nebula-field-specs.js` (frozen, import-free: 5 masses — reef pair, vault,
> deep anchor, and the PILLAR rebuilt as real sculpted geometry) +
> `odyssey-nebula-field.js` (the Act II cloud sculptor re-used verbatim, merged to
> ONE draw, ~3.9k faces; probe paint ported: 2-band wrap, ember crevices, drawn edge,
> Mie lining). **Two integration findings:** (1) `setOpacityScale` force-flips
> materials `transparent=true` AND writes `material.opacity` — hostile twice over to
> an opaque dithered material — so the field stages OUTSIDE the entryContinuity
> buckets via its own `uReveal` (same staging product, test-asserted); (2) the swap
> lever is a TRUE swap (sprites on ⇒ field off), so one differential prices the whole
> swap — the cloud-sheet add-back's ESTIMATE caveat does not recur here.
> **Exit gate MEASURED (Lane B reef, drift EXACTLY 0.000, 66 draws min==max):
> field 2.62/2.62 ms vs sprites-restored 4.00 ms = −1.38 ms; draws 69 → 66; and the
> sprites row cross-checks the dome-swap run's baseline to the tick. Day ledger for
> the station: 17.04 → 4.13 → 2.62 (−85%).** Visual: capture-verified in the
> composition rig — dither speckle appears ONLY mid-dissolve (uReveal 0.805 pinned by
> the rig; forced to 1.0 the masses render clean, solid, banded). Rail clearance is a
> CI assertion (`validateNebulaFieldClearance`, SDF-at-rail ≥ 120 u over the travel
> window). NOTE for a later wave: the corridor-field's own additive FBM backdrop
> sheets (`odyssey-corridor-field.js`) still wash the rig frame — a separate system
> with no ch6 lever; candidate for the same retirement treatment.
> **DISCHARGED FOUR MINUTES LATER (`dff08702`):** ch6's corridor sheets are retired —
> the cosmic branch yields `sheets: []` for chapter 6, restorable with
> `?odysseyCh6CorridorSheets=1`. Ch7 keeps its deep-violet wash; the pinpoint mote
> starfield stays for both. ⚠️ The restore flag is a LOCAL escape hatch only — it was
> never registered as a gpu-split configuration, so the corridor field remains
> UNPRICED for ch6 (the one system in this chapter still carrying no measurement).
> Suites: 91/91 chapter-environment tests green (3 old sprite-contract assertions
> updated to the new shipped system). Report: `gpu-split-ch6-reef-laneB-nebula-swap.json`.

### Wave 4 — Heroes repainted
- Gas giant: 2–3 band terminator with thin warm terminator band, fresnel rim tinted by
  sun angle, backside additive halo shell (+1 draw), rings joining the band paint.
- BH omen: disc repaint — banded hot palette, painted Doppler asymmetry, never-black
  floor; glow-ring count re-justified against the one-key rule.
- Galaxy: banded spiral repaint in place (single quad stays).
- Gate: hero close-ups at `?t=` phase-locked stations vs refs; framing tests green;
  `uApproach` march re-verified after Wave 1's retiming.

> **WAVE 4 OUTCOME (2026-08-15, `eadc915e`).** Gas giant: the continuous diffuse ramp
> became THREE flat value bands with ~8 % soft thresholds plus a thin warm terminator
> line; the night side is a cool-indigo HUE shift with a non-black floor, never a
> multiply toward black. The world-space sun stays, so the terminator-swim fix is
> preserved. Accretion disc: the radial hot→cool gradient became three flat painted
> rings, Doppler asymmetry kept as an authored brightness statement. Same draws,
> trivial ALU delta, 87/87 chapter tests green at the time. **NOT shipped from this
> wave's bullets:** the galaxy repaint (still the original spiral billboard), and the
> glow-ring count was never re-justified against the one-key rule — the sweep found
> the doc's own count was wrong anyway (2 rings, not 3; see §0.2).

### Wave 5 — Alive: stars, streaks, aurora, comet
- Near-star batch: quantised blackbody ramp, hashed twinkle (vertex stage),
  velocity-keyed streak stretch replacing the separate streak-mote system where it can
  (fewer draws, same read).
- Aurora oval crown on the gas giant: 2–3 ribbon strips, winter-verified emerald
  palette ported, sway at clump level; the aurora→filament bridge recolours from the
  same nodes (shared contract).
- The comet moment (sculpted head + dithered tail) placed in the Reef.
- Gate: motion verified at source (wiring/uniforms), not by frame-diffing captures
  (~23 % pixel noise floor between runs); overdraw of ribbons measured.

> **WAVE 5 OUTCOME (2026-08-15/16, `98704055` + `96d69938`).** Shipped: **the comet**
> (sculpted opaque ice head, 2-band paint on the causal key + drawn edge, with a
> dithered opaque cone tail) sweeping a 70 s chord through the reef window,
> dither-faded at the chord ends so it enters and leaves as a distant glint — staged
> like the nebula field, outside the entryContinuity buckets on its own `uReveal`.
> And **the dive stretch**: the streak motes elongate ~2.3× and brighten as the BH
> dive begins. That is deliberately a LENGTH change, not a speed change —
> `mod(time*speed(t))` phase-jumps when speed varies.
> ⚠️ **The comet's tail shipped with BOTH gradients inverted** and was fixed the next
> morning: `ConeGeometry`'s `uv.y` is 0 at the BASE (hugging the head) and 1 at the
> TIP — *measured, not assumed* — so the first draft dissolved the tail at the nucleus
> and went solid-bright at its trailing end. The geometry assumption is now pinned by
> a test so a three.js change fails loudly. **NOT shipped from this wave's bullets:**
> the near-star quantised-blackbody batch with hashed twinkle, and the aurora oval
> crown on the gas giant (the aurora work that DID happen was the misplacement fix in
> `dff08702` — re-parenting the bridge to the corridor).

### Wave 6 — Light, grade, and the seams
- Lighting audit to the one-key statement; ascent altitude ramps wired into the 5→6
  bridge endpoints; 6→7 handoff retimed (BH loom curve over the longer span, threshold
  veil untouched); ch6 grade-table pass.
- Gate: full 5→6→7 per-chapter capture review (⚠️ **short per-chapter sessions only —
  full-journey capture TDR-bluescreens this machine**); value-share checks at stations;
  fog-optout + framing + staging + layout suites green.

> **WAVE 6 PARTIAL — the GROUND-TRUTH pass (2026-08-16, `ef19f9b4`).** A real-board
> ch6 capture WITH the post stack found two defects the flat NoToneMapping rig is
> structurally incapable of showing, both fixed and re-verified by a second capture:
> **(1) the dissolve read as TV STATIC.** A pure screen-space hash covered every
> silhouette in crawling noise, and the chapter sits at partial reveal across stations
> 7–11 and again at the ch7 handoff — invisible in the rig because `uReveal` was
> pinned to 1 there. The threshold is now mostly the sculptor's per-vertex HEIGHT
> (`colour.g`) plus 25 % grain, so masses materialise base-upward with a grainy
> leading edge. **(2) the baked dome came back vivid magenta.** The post stack lifts
> saturation twice over a black crush, so ×0.62 was nowhere near enough; now
> desaturated 34 % toward its own luma and dimmed to ×0.45.
> **MEASURED value bands after the fix, at the hero station: void 0.8 / dome 7.0–22.8
> / masses 75.4** — rule 4 satisfied with the void floor above pure black.
> ⚠️ **Two harness invalidation traps paid for here** (both now in project memory):
> editing the tree mid-capture lets HMR tear the board down — the output is N good
> stations then BYTE-IDENTICAL frames with all-null sidecar metadata, and the tell is
> station mtimes collapsing from ~10 s apart to 1–3 s; and `--keep` + `--times` leaves
> stale SUFFIXED frames that a later glob will happily measure instead of the new run.
> A near-miss "ch6 renders nothing in-game" report came from exactly this.
> `scripts/odyssey-ch6-visibility-probe.mjs` (new) settles such questions in one run —
> it reported 31 draws / 229 k tris at the supposedly dead station.
> **STILL OPEN in this wave:** the lighting audit to the one-key statement, the ascent
> altitude ramps into the 5→6 bridge, the 6→7 retime, and the ch6 grade-table pass —
> plus the owner's own in-game verdicts, which no capture can substitute for.

### Wave 7 — Ledger close-out
- Final gpu-split ledger (both lanes, one thermal window per comparison), budget cell
  ratchet proposal, flags documented, plan annotated **at the claim** with outcomes
  (originals preserved), then the mechanical stale-claim sweep (closing-docs rule:
  sweep and verify — memory shows ~46 % of "obviously stale" annotations are false
  positives without it).

---

## 6. Budget

No ch6 cell exists in `perf-budgets.json`. Wave 0 creates it with NULL baseline until
measured (playbook rule: nothing funded by an ESTIMATE).

| Cell | Baseline | Max | Note |
|---|---|---|---|
| ch6 Lane A (entry/reef/fall stations) | ~~NULL~~ **0.72 ms (reef, Wave 0)** | owner D3 | RTX 5080 1080p |
| ch6 Lane B (same stations, `--low-power`, 720p) | ~~NULL~~ **17.04 ms (reef, Wave 0)** — dome 13.37 of it | owner D3 | the lane that matters; Act II shoreline p95 is already brushing its max — ch6 must be self-funding. **Wave 0 shows it will be: the bake alone recovers ~13 ms Lane B.** |
| ch6 draws | 69 measured (reef; 20 = hero triad) | ≤ today | sculpt merges + sprite retirement vs new halo/aurora draws |
| Backdrop bake | — | ~~≤ 150 ms~~ **≤ 300 ms** | inside warmup plan; startup-trace measured. **CEILING RAISED `dff08702` for a LOOK reason, not a perf one: at 512×256 one texel spanned ~4.7° of longitude and the dome read as blurry blobs. Measured here: 1024×512 = 226–260 ms CPU once at chapter creation, vs ~58 ms at 512×256. World-bake precedent for this class is 400 ms. The test bound (`bakeMs < 2000`) is a resolution/octave-explosion guard, NOT a budget gate.** |
| First-visit hitch | 560 ms (5080) | ≤ 560 ms | bake must not regress it |

**CLOSING LEDGER (2026-08-16).** Lane B, the lane that matters, across the whole
overhaul at the reef station p=0.73: **17.04 → 4.13 (dome bake) → 2.62 (sprite→sculpt
swap) → 2.82 (re-composition, drift 0.262)**, and the shipped final state measured at
the fall station p=0.78: **3.28/3.28 ms, drift EXACTLY 0.000, 69 draws min==max**
(`gpu-split-ch6-fall-laneB-closeout.json`). The chapter began the week as the worst
frame in the journey outside ch1 and ends it at roughly a third of the Act II
shoreline cell — while gaining a baked sky, six sculpted masses, a comet, repainted
heroes and four more levels. Cell maxima remain `null` pending owner D3.

Funding thesis (to be proven in Wave 0/2/3, not assumed): retiring the per-frame FBM
dome + 200 per-fragment-FBM additive sprites pays for the sculpted masses, halo shell
and aurora, with the Act I dome-bake (15–19 ms → baked) and cloud-field (0.197 ms sky)
precedents as the reason to believe.

## 7. Owner decisions

- **D0 (gates all sculpt/bake code):** does the Wave 0 paint probe clear the blessed
  reference bar? (Cheapest falsifier first.)
- **D1 (gates Wave 1):** length lever — A re-space / B add levels / A+B (recommended) /
  C spline edit; and the target span (proposal: ch6 ≈ 0.22–0.24 of the journey).
  > **DECIDED 2026-08-15 — lever B ALONE, and the owner ruled out shrinking anyone
  > else.** Lever A was attempted and REVERTED as *measured dead* (`ae95c622`, which
  > landed comment-only): the 6→7 helical sweep begins immediately after 0.815, so a
  > widened window catches a 25.6° rail turn against the corridor test's 3° max and
  > throws the BH hero to ndcX −1.70 by p=0.829. The finding is pinned at
  > `odyssey-layout.js:103-106` — **do not re-try the cheap re-space.** `ca0ed7de`
  > shipped B alone: 13 levels (36–48) packed inside the UNCHANGED 0.648–0.815 window,
  > ids ≥42 renumbered +4 behind a SAVE_VERSION 2 migration, so no boundary, seam
  > band, station or camera fit moved. **STILL OPEN:** the 0.22–0.24 target span was
  > NOT reached (the span is still 0.167 — B adds played time, not traversal length),
  > and lever C (re-authoring cp17–20 under the pinned arc length) is the only route
  > left and is untaken; the control points are byte-identical. Note `c5f8b66d` moved
  > the black-hole HERO onto the camera exit axis — it did not move the rail.
- **D2 (gates Wave 3 swap):** retire the additive nebula tiers + procedural dome once
  the sculpted field + bake meet the bar and the cell — atomic, flagged, revertable.
- **D3 (gates the budget):** ch6 Lane A/B cell maxima after Wave 0's measurement.
- **D4:** bless the reference set (§1.3) so the bar can be sampled to numbers.

## 8. Files

| File | Role |
|---|---|
| `src/rendering/odyssey/chapter-environments/cosmic-expanse.js` / `.tsl.js` | incumbent; staged retirements + hero repaints in place |
| `src/rendering/odyssey/chapter-environments/odyssey-cosmic-backdrop.js` (new) | seeded cubemap bake |
| `src/rendering/odyssey/chapter-environments/odyssey-nebula-field.js` / `-specs.js` (new) | sculpted masses (frozen specs) |
| `src/playground/effects/ch6-painted-cosmos.effect.js` (new) | probe + iteration rig |
| `src/core/odyssey/data/odyssey-layout.js`, `levels.js` | Wave 1 lengthening |
| `chapter-environments/shared/seam-bridges.js`, `ChapterEnvironmentManager.js` | band retimes only |
| `scripts/odyssey-gpu-split.mjs` stations, `perf-budgets.json` | Wave 0 |
| `tests/unit/` — path-layout, fog-optout, framing, staging, + new SDF-clearance & flag-polarity tests | guards |
| `public/playground-refs/ch6-*` | blessed refs |

## 9. Trap register (paid-for lessons this plan must not re-buy)

r181: shared `.toVar()` across build roots reads zero — root-pin at Fn top, prove with
a constant · `material.opacity` is a dead write where `opacityNode` exists (the ecotone
uses `uOpacity` bridges — ch7 has 7; never delete them) · instanced local-space masks
read `positionGeometry`; positions build from `positionLocal` · vertex-stage texture
reads need `.level(0)` · high fan-out TSL through varyings explodes build time (the
129 s codegen bomb) — bake, don't graph · never bind a post target for `compileAsync`
under a live rAF loop; MRT `compileAsync(scene)` poisons the pipeline cache — warm via
`postProcessing.render()` · `smoothstep` equal edges are a WGSL hard error.
Process: capture harness first frame is the menu; `--variant` overwrites; `cd` out of
artifact dirs (EBUSY); a stray browser rendering WebGPU 3×'d a measurement — close
everything, then measure; stay on r181.2 (r186 upgrade is its own scheduled project).

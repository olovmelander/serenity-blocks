# Odyssey — Act I Rebirth Plan (2026-08)

**Status: PROPOSED.** Written 2026-08-12, the day the One World plan closed. This plan
rebuilds **Act I** — Earth Core (chapter 1) and the underwater stretch of chapter 2 — to the
standard the Act II rebuild set: stunning, measured-fast, one continuous feeling.

**THE FEELING (the spine everything serves):** we are BORN from the lava and magma of the
earth's core, rise through a crack where fire quenches into water, ascend through a magical,
luminous ocean, and breach into the daylight of Act II. One journey, no seams felt. The design
language, atmosphere and colour of the whole act is STUDIO GHIBLI: hand-painted softness,
light as a character, wonder over spectacle.

**Method:** this document inherits the One World plan's discipline, not just its format. That
plan's §0.3 lists four load-bearing numbers that shipped false because nobody measured them,
and its closed record shows which habits caught them. Accordingly:

- Every cost claim below is tagged **MEASURED** (with instrument and conditions) or
  **ESTIMATE** (with the arithmetic shown). Per ADR-0016, an ESTIMATE is a hypothesis to
  falsify, never a fact to schedule against.
- Every visual claim owes a capture (ADR-0007), taken per-chapter in short sessions (the
  full-journey TDR constraint stands).
- The escape hatch and the chapter-module registry STAY (ADR-0015); this plan works within
  them.
- §9 is a self-audit: the load-bearing premises of this plan, each with its evidence,
  adversarially checked against the code before the document was finalised — because the One
  World plan's Wave 4/6 audit refuted eight of eight such claims when someone finally looked.

**Scope:** journey progress p ∈ [0, ~0.20]: chapter 1 (p 0–0.093) and the submerged span of
chapter 2 (p 0.093 → breach at p ≈ 0.19). Out of scope: everything past the breach (Act II,
already rebuilt), the level/board handoff, audio.

---

## 0. Phase 0 — what Act I is today, measured

Nothing below this section was designed until the current state was captured and priced.
Instruments: `scripts/odyssey-gpu-split.mjs` (the ADR-0016-verified split harness, extended
this session with `--chapters` and `--out` passthroughs — defaults untouched, Act II lane
reports unclobbered) and `scripts/odyssey-chapter-capture.mjs` (per-chapter screenshot
stations, discrete GPU, TDR-safe).

### 0.1 The journey geometry (MEASURED — path dump via `path-utils.js`, 2026-08-12)

Chapter boundaries (`chapterPositions`): ch1 = **p 0 → 0.093**, ch2 = **0.093 → 0.204**.
Sea level `ODYSSEY_SEA_LEVEL = 287.31`.

| p | rail y | depth below sea | where |
|---|---:|---:|---|
| 0.000 | −30.0 | 317.3 | birth — below the lava lake plane (lake at y=−10) |
| 0.051 | 52.5 | 234.8 | mid-cathedral (the act-gate capture station) |
| 0.093 | 123.5 | 163.8 | ch1→ch2 boundary — the steam quench peak |
| 0.130 | 193.7 | 93.6 | mid-water column |
| 0.160 | 246.7 | 40.6 | upper ocean |
| 0.190 | 285.5 | 1.8 | the breach |
| 0.204 | 294.2 | −6.9 | ch2→ch3 boundary, already in air |

Three structural facts fall straight out of the dump:

1. **Chapter 1 is a vertical shaft.** The rail rises from y=−30 to y=123 at nearly constant
   XZ (−3, 5). The act is an *ascent* from its first frame — the camera looks up a chimney,
   not across a room.
2. **The crack is literal.** The One World heightfield at the shaft's XZ is the continental
   shelf at y ≈ **96–99** (`odysseyWorldHeight(−3, 5) = 98.7`, MEASURED by evaluating the
   live function). Earth Core's cavern occupies y ∈ [−52, 123] at the same coordinates —
   **underneath the world's own ocean floor**. The rail passes through the floor's altitude
   at p ≈ 0.077, inside the steam quench's window (0.033–0.153), which is precisely the
   occlusion that makes the crossing invisible today.
3. **The underwater stretch is ~90% of chapter 2** (p 0.093 → 0.193), and it is drawn by the
   One World renderer, not by the suppressed `deep-ocean.js` diorama: `applyAerial`'s water
   branch, `uSubmerged`, the sky dome's water mode, caustics on the shelf, and 22 god-ray
   cones seated from rail samples.

### 0.2 What Act I costs today (MEASURED, both lanes, per ADR-0016)

All rows: `scripts/odyssey-gpu-split.mjs`, station pinned, baseline + repeat content-matched,
quiet machine (Epic launcher and a leftover harness dev-server killed first; VS Code
compositing present on both the old and new runs — same ambient as every prior lane report).

| Station | Lane | p50 GPU | p95 | draws | tris | drift |
|---|---|---:|---:|---:|---:|---:|
| Ch1 mid-cathedral (p=0.051, High, 1080p) | A (RTX 5080) | **2.097 ms** | 2.29 | 131 | 245,755 | 0.00 |
| Underwater (p=0.16, High, 1080p) | A (RTX 5080) | **0.262 ms** | 0.33 | 45 | 623,231 | 0.00 (baselines byte-identical) |
| Ch1 mid-cathedral (p=0.051, Medium, 720p) | B (Radeon 610M) | **57.21 ms** | 61.73 | 127 | 245,683 | 0.33 (repeat 56.89 — 0.6% of signal) |
| Underwater (p=0.16, Medium, 720p) | B (Radeon 610M) | **7.73 ms** | 15.1 | 45 | 623,231 | 0.00 (p50 byte-identical; the wide p95/p99 tail — 15–25 ms — matches the §7.1 orb-group tail signature and is carried as a known unknown) |

Reference points from the closed Act II record (same instrument): Act II mid-station is
**0.393 ms / 50–53 draws** on Lane A and **9.90 ms p50** on Lane B against a 7.0 ms budget.

What the numbers say:

- **Today's Earth Core frame costs Lane A ~5.3× the entire Act II world** (2.097 vs
  0.393 ms) — and on Lane B it measures **57.2 ms p50: ~8× the lane's 7.0 ms contract and
  ~14 fps on its own**, against Act II's 9.9 ms at the equivalent station. Chapter 1 is the
  single worst frame in the journey on the lane that matters most; the rebuild is the
  largest unclaimed Lane B saving anywhere in Odyssey.
- **The underwater frame is empty and comparatively cheap**: 45 draws, 0.262 ms Lane A,
  7.73 ms Lane B — cheaper than Act II's own mid-station (9.90) on the weak lane, but
  already over the lane's aspirational 7.0 contract before a single new mote is added. The
  deepening therefore budgets as a measured DELTA on this baseline (§8), and the Ghibli
  device list was chosen for exactly this: bands and SSS are ~free, and everything additive
  is size-capped.
- Earth Core's draw count (131) is the old world's disease in one chapter: ~25–29 material
  objects across `earth-core.js`/`earth-core.tsl.js` (COUNTED: 15 + 14 construction sites),
  17 of the journey's 34 live `uOpacity` crossfade bridges (COUNTED), and a cold-compile
  share measured in-session at **ch1 = 2,336 ms** against the whole One World's 128 ms
  (MEASURED once — startup-trace console line, Low quality, warm Dawn cache; re-measure cold
  in Wave 0 before quoting further).

  > ✅ **RE-MEASURED COLD (Wave 0, 2026-08-12). The original figure understated it by 41 %,
  > and the ratio is the durable part.**
  >
  > | run | ch1 compile | One World | ratio |
  > |---|---:|---:|---:|
  > | **TRUE COLD** — `DawnWebGPUCache` + `DawnGraphiteCache` + `GPUCache` all deleted, High | **3,948 ms** | 68 ms | **58×** |
  > | warm, High, chapter window 1–2 | 2,740 ms | 91 ms | 30× |
  > | warm, High, window 1–3 | 1,898 ms | 59 ms | 32× |
  > | warm, Low (the plan's original single sample) | 2,336 ms | 128 ms | 18× |
  >
  > Two things the single sample could not say. **(1) Cold is ~2× warm**: 3.9 s against a
  > 1.9–2.7 s warm band, so the number a first-ever player pays is nearly double the one this
  > plan first quoted as if exact. **(2) The ratio survives every condition** — quality tier,
  > chapter window, cache state — at **18–58× the whole continuous world's compile**. Quote
  > "Earth Core is ~4 s of a cold start and tens of times One World's compile"; never a
  > single millisecond figure. The ≤10-material budget in §3.5 is aimed squarely at this.
  >
  > *Method note for whoever repeats it:* clearing `GPUCache` alone is NOT cold on this
  > Electron — WebGPU pipelines live in `DawnWebGPUCache`/`DawnGraphiteCache`, and a
  > GPUCache-only clear reproduced a warm 1,894 ms. All three must go.

### 0.3 What Act I looks like today (captured, 6 stations per chapter, 2026-08-12)

Artifacts: `artifacts/odyssey/wave-v/chapter-01-high-webgpu/` and `chapter-02-high-webgpu/`.

**Earth Core** (`chapter-01-03-local-0400.png`, `-05-local-0800.png`): a near-monochrome
red-orange wash. Rock, air, haze and glow all sit in one temperature band and one value band;
the authored target in `earth-core.tsl.js` ("~70% near-black rock / ~30% molten") is not what
renders — the frame is ~90% mid-red. The molten-rock vein noise reads as speckle at range,
not charred crust. The obsidian columns terminate in hard flat-shaded polygon caps, exposed
against the quench veil at p=0.093. There is no single readable light source: ember glow is
everywhere, so light is nowhere — the exact inverse of the reference device this plan adopts
(§2.1: Laputa's levistone cave holds 51% of the frame in one near-black indigo and lets a
single glow carry it).

**The underwater stretch** (`chapter-02-03/04/05`): a flat royal-blue void. No vertical light
gradient — the near-surface frame (p=0.182, 13 u down) is *darker and emptier* than the
mid-depth frame, when the physics and every reference say the water column must brighten
toward the light.

> ✏️ **AMENDED by Wave 0's instrumentation — the mechanism is now known, and it changes the
> fix.** At p=0.182 the world has already switched to **air** (`uSubmerged = 0.000`, script
> keyframe `breach`), because the submerged blend is driven by the EYE (`railPoint.y + 16`),
> not the rail. The eye crosses the waterline at **p ≈ 0.181**, so §0.1's "breach at p≈0.190"
> is the RAIL's crossing and the *visual* breach is ~9 progress-thousandths earlier. The
> near-surface frame is therefore not "underwater but wrongly dark" — it is **already
> rendering as air**, with the god rays alpha-gated off, while the composition still reads as
> submerged. The Wave 4 band ramp must own the last few metres below the surface explicitly
> (and the SSS ceiling is what sells them), rather than assuming the water treatment is still
> active there. No particulate, no life, no scale cues; the god rays read as faint streaks;
the level orbs and ribbon are the only content. "Magical luminous ocean" does not exist yet —
which is also the opportunity: the canvas is clean and cheap.

**Defects logged during capture** (each needs a decision or fix in Wave 0):

1. **Cloud-deck cumulus reads through the submerged frame** (p 0.115–0.16 captures). The
   deck's opacity is gated by `×(1 − uSubmerged)` and the rail is 40–90 u underwater at these
   stations, so either the capture-harness path fails to drive `uSubmerged` (instrument gap)
   or the gate fails in-game too (live regression). The One World closure notes say the
   in-game underwater body "reads correctly", so the instrument is the prime suspect — but
   per ADR-0016 this is *decided by an instrumented repro, not by which explanation is
   comfortable*: Wave 0 adds `uSubmerged` to the capture metrics JSON and re-shoots one
   station.

   > ⚠️ **REFUTED (Wave 0, 2026-08-12) — and the instrumented answer is better than the
   > guess.** The claim above is wrong twice over; the original is preserved because the way
   > it was wrong is the reusable part.
   >
   > **1. The "cumulus" is the STEAM QUENCH, doing its job.** The 1→2 occlusion window is
   > `0.093 ± 0.06 = [0.033, 0.153]`, and the new `visibleMeshes` roster shows
   > `odyssey-steam-quench` drawn at **exactly** p=0.093 / 0.115 / 0.137 and absent at
   > 0.160 / 0.182 / 0.204 — the three cited "cumulus" stations are the three quench
   > stations, at billow densities 1.00 / 0.40 / 0.07. Mottled white vapour filling a
   > submerged frame is the shipped act-edge volume, not a leak.
   >
   > **2. The gate WORKS.** Measured `uSubmerged`: **1.000** at p=0.093–0.160, 0.000 at
   > 0.182+. Cloud alpha is `×(1 − uSubmerged)`, so it is exactly zero everywhere the frame
   > is underwater. Neither hypothesis in the original claim survives.
   >
   > **3. The instrument lied first, and the lie was MINE.** The first re-shoot reported
   > `submerged = 0.00` and an empty script name at every station — which would have
   > "confirmed" the instrument-gap hypothesis. The cause was that the exposure patch
   > declared the `state` object and returned it but never assigned to it, so the capture was
   > reading initial values. Fixed, re-shot, and recorded here because a plan that trusts its
   > first instrument reading is the failure mode this whole document is organised against
   > (ADR-0016 §1: *the instrument is verified*). One capture round bought the correction.
   >
   > **4. What IS real, found by the same roster:** `odyssey-world-clouds` is **submitted and
   > rasterised at every fully-submerged station** — provably invisible (alpha 0) yet paying
   > full fragment cost: three texture fetches per covered pixel across a sky-covering sheet,
   > on the lane measured at 7.73 ms. `odyssey-world-godrays` is the same bug with the
   > opposite polarity (submitted at p=0.182/0.204 where `uSubmerged = 0` zeroes its alpha).
   > **Fix: two `mesh.visible` writes in the world's `update()`, Wave 4** — a fill saving on
   > the weak lane for one line each, and the honest version of the defect this entry was
   > reaching for.
   >
   > *(Original claim continues below, unedited.)*
   > per ADR-0016 this is *decided by an instrumented repro, not by which explanation is
   comfortable*: Wave 0 adds `uSubmerged` to the capture metrics JSON and re-shoots one
   station.
2. **A WebGPU validation storm on the Act I boot path** (observed live in a dev session this
   day): `[Texture "output"] usage (TextureBinding|RenderAttachment) ... in the same
   synchronization scope`, repeating from `post-target-compile.js` during *background*
   chapter prewarm (ch6+), plus one `setPipeline: parameter 1 is not of type
   'GPURenderPipeline'` during ch6 creation. Same family as the logged "MRT compileAsync
   poisons the pipeline cache" trap. Not Act I's own code, but it fires while the player is
   *in* Act I, and a poisoned device is everyone's problem. Corroborating scope note: the
   Phase-0 capture sessions (chapter windows 1–2 and 1–3, which exclude the ch6+ background
   prewarm) show clean consoles — the storm needs the full background chapter set, which is
   exactly the default player boot.
3. **First capture frame catches the menu overlay** before `HIDE_OVERLAYS` applies —
   harness cosmetics only; re-shoot station 1 after settle.
4. **The gpu-split harness orphans its Vite server on Windows** (found the hard way, three
   times in one session): `devServer.kill()` kills the `shell: true` cmd wrapper, not Vite,
   so the NEXT run's `--strictPort` server cannot bind and dies with "dev server did not
   start in 90s" — and one such collision left a wedged half-run holding the port. Until the
   harness kills the process TREE (`taskkill /T` or spawning without a shell), run
   back-to-back invocations on distinct `--port` values and sweep listeners between runs.
   Wave 0 owns the harness fix; it is two lines and it un-flakes every future measurement.

### 0.4 What already works (do not re-litigate)

- **The steam quench is the crack moment, shipped and in-game verified** under the real ACES
  grade. Four capture iterations paid for its construction rules (alpha/brightness
  decoupled; warm→WHITE→cool, never through grey; noise frequency set by radius; density
  squared). It is seated at the boundary, windowed ±0.06, and the rail ribbon + orbs ride
  INSIDE the shell so the player keeps their path while the world changes. This plan designs
  Earth Core's climax INTO it (§6, Wave 6) and does not rebuild it. One recorded caveat: the
  quench exists only while `aaaPostActive` is true (default ON — it equals
  `cinematicJourneyActive`; `?odysseyAAA=1` gates diagnostics only), and the post-pipeline
  init catch silently drops it — a degradation to log loudly, not a bug to fix here.
- **The world act-gate** (`world/odyssey-world-act-gate.js`, margin 0.03 — NOT 0.06) keeps
  Act II's ocean from painting over the cavern; capture-verified the day it landed.
- **The registry contract**: rebuilding `earth-core.js` in place keeps its three
  convention-derived exports (`EARTH_CORE_CONFIG` / `createEarthCoreEnvironment` /
  `updateEarthCoreEnvironment`); zero registry, pilot, validation-harness or
  consistency-test churn.

---

## 1. Verdict on the current Act I (the diagnosis this plan acts on)

Act II's disease was structural (eight dioramas, one crossfade). Act I's disease is
different, and the plan must not import the wrong cure:

- **Structure is mostly fine.** Ch1 is one enclosed diorama with a real occlusion moment at
  its exit; the underwater span is already the One World. There is no crossfade patchwork to
  delete, and the architecture decision (§4) confirms the shape should stay.
- **The art direction and the budget are the problems.** Earth Core has no value structure,
  no light hierarchy, and a 131-draw, ~27-material, 13.6-ms-on-Lane-B body. The ocean has
  structure and budget but no content — an empty stage.

So Act I's rebuild is: **rebuild Earth Core's content to One World discipline inside its
existing contract; deepen the ocean in place inside the world it already lives in; and make
one colour script own the whole act.**

---

## 2. Research — references verified, extended, rejected

Three independent research passes (Ghibli films; game techniques; the nominated CodePen) ran
against the candidates named in the brief. Verdicts below; every claim carries a citation.
**36 reference images are saved under `public/playground-refs/`** (`act1-ghibli-*`,
`act1-game-*`; 19 official-Ghibli + 17 game stills, all verified image files) for
`?ref=/playground-refs/<name>.jpg&refMode=split` iteration. All hex values quoted from the
Ghibli stills were machine-sampled from the saved frames, not eyeballed.

### 2.1 Ghibli — the palette and light devices (all ADOPTED; one addition)

| Reference | The SPECIFIC device | TSL cost class |
|---|---|---|
| **Castle in the Sky — levistone cave** | **Darkness-gated emission**: the glow lives only where ambient light is absent (Pom covers the lantern; the ceiling ignites). Base near-black `#202020`/indigo `#204060` holds ~51% of the frame; ONE warm source (amber lantern, tight falloff, warms only near surfaces) against ONE cool omnidirectional response (levistone blue `#206080`, reads as the air glowing). The "galaxy" is thousands of static twinkle points in the rock itself. | Near-free: one uniform lerp into emissive; instanced twinkle sprites; two-tone light is standard. |
| **Ponyo — ocean language** | Depth as **stacked flat hue bands**, never grey scattering: each depth plane a distinct hue step (`#608080` → `#80C0E0` → `#404060`), lighter and cooler toward the light. Foam is a drawn line (crest rim with hand-wobble), not particles. Waves-as-creatures reserved for hero moments only. | Bands = free (depth-keyed smoothstep ramps — and they REPLACE fog, sidestepping the 4×-recurring `scene.fog` trap). Foam rim moderate. Creature-waves moderate-to-high — hero moments only. |
| **Nausicaä — spore glow + underground chamber** | **Transmitted light**: spores are light sources, not lit objects (the film built a backlight double-exposure rig for exactly this) — additive emissive motes whose brightness scales with background darkness; slow constant-velocity drift with gentle sine sway, serenity from constancy. The underground chamber still (`nausicaa031`) — clean water lit by parallel blue shafts from cracks above — is the single best Ghibli match for the quench-to-ocean beat. | Cheap, **fill-rate-capped on Lane B** (additive overdraw was the Cosmic Noir bottleneck): cap sprite SIZE, not count. Shafts = 3–6 vertical gradient cards, near-free. |
| **Howl's — Calcifer** | **Fire as a posed character**: defined teardrop silhouette, stretch/squash with state, features cut *into* the flame, held poses with snappy transitions — not continuous noise. Production rules that survive translation: bounce light stays ORANGE (green firelight was tested and rejected); the digital spec was literally "softening, transparency, diffusion as a light source". Ramp `white-yellow → #E06040 → #804020` against room-dark `#202020`. | Moderate — and the cost is animation authoring (pose library + easing), not shading. SDF/vertex-morph teardrop + 3-stop ramp is cheap. |
| **The Boy and the Heron — warawara ascension, Himi's fire, dawn sea** (ADDED) | The only Ghibli sequence containing the act's *entire arc*: luminous beings born below rising in slow helices to be born into the sky; living fire with a face (coral-pink `#FF6060→#FFA060`, warmer and softer than Calcifer); a dawn-gold sea `#E0C080/#FFC080` as the breach target frame. One warm system (fast additive fire streaks) against one cool system (slow diffuse orbs) in the same frame — the quench's warm/cool duel, pre-solved. | Cheap: instanced orbs on helical drift; additive streaks; 2-stop dawn gradient. |

Cross-cutting findings that became design law in §3: depth is ALWAYS discrete hue/value
steps within one temperature family (never grey mush); warm and cool never mix except at a
declared collision (the quench); each zone is one hue family plus one accent.

Citations: ghibli.jp official stills gallery (free-use, ghibli.jp/info/013344/);
sifrinsight.com Castle in the Sky analysis; ghibli.fandom.com (Uncle Pom; Calcifer —
Takeshige/Okui production notes via *The Art of Howl's Moving Castle*; Warawara); Miyazaki
on Ponyo (hand-drawn-animation.blogspot.com interview; Academy Museum Ponyo exhibition;
FIU JSR Ponyo paper); *The Art of Nausicaä* staff notes on the transmitted-light rig
(scribd.com/document/764743228); thegamer.com warawara explainer; deepfocusreview.com Ponyo.

### 2.2 Games — the mechanism library (verdicts as found, including rejections)

| Reference | Verdict | Device adopted | Lane B cost note |
|---|---|---|---|
| **ABZÛ** | ADOPT | Fish as instanced static meshes animated ENTIRELY in the vertex stage (cosine yaw/tail/roll in model space — no skeletons; the technique is documented from the GDC talk). Kelp as instanced blades on the existing vegetation-wind TSL pattern. Underwater look is *authored* colour-with-distance, "paint the world", not simulated fog. God-ray implementation unverified in print → we keep our shipped cone approach. Particulate counts unpublished → 2 depth tiers, ours to tune. | Fish: 1–2 draws, vertex-ALU only, hundreds not thousands. Shafts: bound additive overdraw (thin cones, facing fade — already shipped). |
| **Journey** | ADOPT | The sand shader's **diffuse-contrast** device (`saturate(4·dot(N,L))` with `N.y×0.3` first) — terminator steepening that makes landforms read as graphic value shapes; **glitter** = per-grain random normals + thresholded half-vector (ports to sediment and to underwater floor sparkle; already proven in Winter). The underground blue chapter IS a faked underwater level — shafts + murk + sparkle — the closest shipped model for our ascent's read. Colour script: one dominant hue per chapter. "2–3 value rule" NOT FOUND verbatim — treated as our formulation, not a quote. | Pure ALU; glitter is 1 fetch + pow. Glitter aliases without TAA → Lane B hard-off (the One World rule stands). |
| **Gris** | EXTEND — and the candidate's premise REJECTED | No GDC talk "Art Direction of Gris" exists (checked); Gris is hand-drawn art, not a runtime gradient shader. What we take is the READ, via our own synthesis: 2–3-stop gradient ramps keyed on depth/height, paper-grain overlay, watercolour edge = noise-perturbed silhouette band (band WIDER than noise swing — the Ch3 dissolve lesson). | Ramp = LUT fetch or mix chain, near-free; grain = 1 fullscreen blend. Cheapest high-identity device in the list. |
| **Ori (Will of the Wisps)** | ADOPT | **Hand-authored light masks** (30,000+ painted surfaces because automated looked "cheap and plasticky") → per-asset glow/light-response masks in vertex colour; light placement is authored, not simulated. Parallax silhouette layers with fog separation sell cave depth; capped at 3–4 layers. Their magma device: saturated emissive gradient streams + moss-rimmed dark silhouettes — charm from rim + hue contrast, not realism. Light rays at 60 fps on Switch proves the budget class. | Painted masks: zero runtime. Layers: a few large alpha quads — overdraw-capped. |
| **EUROPA** (Steam app 2214880, Helder Pinto — per the user's clarification, the Ghibli glider game, not Europa Universalis) | ADOPT (devices), sources caveated | The key device: foliage cards with normals transferred from a smooth proxy blob so a canopy shades as ONE soft volume (zero runtime cost — bake into normal attributes); height-gradient hue tint base→crown (1 mix on world-Y, serves kelp and coral directly); palette per emotional zone; post grade iterated AGAINST GHIBLI STILLS (the same overshoot workflow our playground already demands). Pinto has published no pipeline breakdown; two sources 403'd and are flagged; the adjacent kidswithsticks.com Ghibli-in-UE4 breakdown documents the same technique family and is readable. UE distance-field lighting REJECTED for our stack. | All authoring-side except 1 mix + 1 grain blend. |
| **Sea of Thieves** (added, one device only) | EXTEND | **Wave-SSS approximation** (SIGGRAPH 2018, Rare): `mix(deepColor, glowColor, crestMask × sunFacing × grazing)`, crest mask from displacement magnitude — no FFT needed, ours derives from the existing swell term. From below, the surface becomes a luminous ceiling; this is what makes the breach PAY OFF. FFT ocean itself rejected for iGPU. | ~5 ALU on the existing water material. Zero new draws. |

Citations: GDC Vault — *Creating the Art of ABZU* (1024643), *Sand Rendering in Journey*
(1017742, + slidetodoc slide capture of the shader math), *The Art of Journey* (1017799),
*The Art of Ori and the Will of the Wisps* (1027375); Godot docs' writeup of ABZÛ's
vertex-cosine fish; 80.lv ABZÛ creative-director interview; pcgamesn/unrealengine.com ABZÛ
engineering interview (custom underwater lighting, "paint the world"); thegamer.com Ori
hand-painted light masks; nintendolife.com Moon Studios Switch interview;
wccftech.com Ori deferred+tiled lighting; thisiscolossal.com & gamereactor.eu &
redbull.com Gris interviews; halisavakis.com gradient-mapper pattern; 80.lv EUROPA piece;
kidswithsticks.com Ghibli-in-UE4; ACM SIGGRAPH 2018 *The Technical Art of Sea of Thieves*
(doi 10.1145/3214745.3214820 + published PDF).

### 2.3 The nominated CodePen — identified, extracted, and worth more than expected

The pen (`codepen.io/editor/lentils801/pen/019f9b4b-...`) is **"Hoshi-no-Tani · The Valley
of Stars"** — a 287 KB single-file, fully procedural Ghibli pastoral valley (three.js 0.180
WebGL2, zero textures/models), verified running locally at 88–162 fps. **Full source saved
to the session scratchpad** (`pen-live.html`) — the fetch URL is session-scoped, so the
local copy is the durable artifact; copy it beside the refs if it should survive the
machine. It is NOT underwater — but four of its devices are directly load-bearing here:

1. **The film print** (its post grade, constants verbatim): shadows pushed to violet
   `(0.90, 0.95, 1.16)`, highlights to cream `(1.055, 1.012, 0.925)`, and a black lift
   `(0.017, 0.021, 0.036)` — "nothing in a Ghibli frame is ever pure black". This is the
   single biggest lever for making Earth Core's darkness read *painted* rather than void,
   and it composes with our existing ACES pipeline as a per-act grade tweak, not a new pass.
2. **Painted water banding**: bed-depth quantised into ~3 soft-stepped colour plates that
   follow the CHANNEL (not the ripples), plus fresnel CLAMPED at ~0.46 so water never
   becomes a mirror and keeps its own colour — the exact mechanism for Ponyo's band device
   on a 3D sheet.
3. **Quantised sun glitter**: `smoothstep(0.9975, 0.99925, f) × twinkle` — winking discrete
   glints, not a specular lobe. Ports to the underwater surface ceiling and the sediment.
4. **Palette-as-codegen**: one authoritative hex table compiled into shader constants — the
   same shape as our colour script feeding TSL uniforms; validates the architecture.

Caveats recorded by the analysis: it is WebGL2 GLSL (all ports go through TSL, not copy);
its fog-weight-in-alpha trick conflicts with r181 `opacityNode` semantics (skip it); its
custom depth-only shadow pass is not needed here.

### 2.4 Already-vetted references that need no new research

- **snowflow** (terrain technique): already adopted wholesale by the One World; Act I's
  ocean floor IS that clipmap. A cave is authored geometry, not a heightfield — snowflow
  contributes nothing new inside the cavern, and that non-fit is an input to §4.
- **Journey/ABZÛ/Firewatch/Tsushima art rules** absorbed by the One World plan (§3.10 there)
  continue to bind: anchors hand over only while both are visible; one wind field; the
  glitter gate is Lane-B-off.

---

## 3. The design — one act, one script, one light language

### 3.1 The colour script grows an Act I limb (core → crack → abyss → shallows → breach)

`odyssey-colour-script.js` currently begins at the abyss: the world samples it only across
Act II (`0.05 + actT × 0.9`), and chapter 1 reads static `chapter-profile.js` atmosphere
constants instead — Act I is *outside the journey's only art-direction contract* (VERIFIED:
zero `sampleColourScript` references outside the world renderer and its tests). That is the
root of the red-soup problem: nobody owns ch1's arc.

The plan: **extend `ODYSSEY_COLOUR_SCRIPT` downward** with an Act I segment on the same
scale, sampled by the rebuilt Earth Core and by the quench's window drive. Keyframes
(hexes from the sampled references; all tagged PROPOSED — the playground value study in
Wave 1 calibrates them against the refs before anything ships):

| script p | name | medium | palette anchors | notes |
|---|---|---|---|---|
| −0.10 | **birth** | magma | base `#1a0d0d` near-black; ember ramp `#ff6060→#e06040→#804020`; accent `#ffaa60` | Heron flame-coral warmth, NOT pure red; ONE warm key (the lava lake below); black lift per §2.3 so darkness stays painted |
| −0.06 | **cathedral** | magma | base `#141018` (indigo-charred, cooler than birth); veins `#ff8040` darkness-gated; accent cyan seed `#40a0a0` at ≤2% area | the Laputa frame: ≥50% of pixels under luma 60 (a TESTABLE value-share gate, §6 Wave 1); the cyan accent foreshadows water |
| −0.02 | **crack** | magma→steam | quench owns the frame: `#ffb079 → #ffffff → #cfe6ff` (shipped constants) | `seamAfter: true` — the hue-rate invariant is suspended INSIDE the quench, exactly as designed |
| 0.00 | **abyss** (existing) | water | deepen toward sampled Ghibli abyss: zenith `#0a2036`, consider `#062028` floor tint | existing keyframe; revision only with capture A/B |
| +0.06 (new) | **luminous mid-water** | water | band 2 of the Ponyo stack: `#1a4a6a` body, shaft cyan `#4080a0`, spore-glow accent `#40c0c0` | new keyframe: the magical ocean's own identity, distinct from abyss and shallows |
| +0.12 (new) | **shallows** | water | powder `#4a8ab0` body, ceiling glow `#80c0e0`, dawn-gold kiss `#e0c080` in the crest SSS only | Heron dawn-sea; gold stays in the SSS mask so the air keyframes' horizon anchor is untouched |
| 0.18 | **breach** (existing) | air | unchanged | Act II's script takes over; continuity by construction |

> ⚠️ **RESCOPED (Wave 2, 2026-08-12) — the negative-`p` column above is not implementable, and
> two of the rows belong to a different wave.** Original table preserved; the corrections:
>
> **1. There is no room below zero.** `sampleColourScript` clamps its argument to `[0, 1]`
> (`odyssey-colour-script.js`), and a shipped test asserts the script "is ordered, spans
> 0..1". Keyframes at `p = −0.10 / −0.06 / −0.02` could never be sampled, and re-basing the
> existing array to make room would move every Act II keyframe — a visual change to a shipped,
> capture-verified act, which this plan has no mandate to make. **Act I gets its OWN array and
> sampler** (`ODYSSEY_ACT1_COLOUR_SCRIPT` / `sampleAct1ColourScript(t)`, `t` = chapter-1 local
> progress) sharing the same Oklab machinery and the same invariants. The act handoff is then
> enforced by a TEST rather than by array adjacency, which is strictly stronger.
>
> **2. The two water keyframes are not Act I's to add — and not this wave's.** `+0.06`
> (luminous mid-water) and `+0.12` (shallows) sit INSIDE Act II's existing `0.00 abyss →
> 0.18 breach` span, so they are legal additions to the shipped array — but the world samples
> that array every frame, so adding them CHANGES the shipped underwater look the moment they
> land. That is exactly Wave 4's work and exactly what Wave 4's captures verify. **Moved to
> Wave 4**, so Wave 2 can keep its "data + tests only, no visual change" contract honestly.
>
> **3. `seamAfter` moves from `crack` to `cathedral`.** The invariant walks consecutive pairs
> and exempts the pair FOLLOWING a keyframe that declares it. The violent hue swing is
> cathedral → crack (ember to quench-cool), so the declaration has to sit on `cathedral` or
> the rate limit fires on the one transition the quench exists to hide.

Invariants, extended not replaced:

- The existing two (horizon convergence for `air` keyframes; hue rate ≤ 12°/0.05p except
  across `seamAfter`) keep biting; the Act I segment adds its keyframes to the same tests.
- NEW, unit-testable: **warm/cool exclusivity** — outside the crack keyframe's window, no
  keyframe palette may contain both a warm-hue slot (hue ∈ [0°, 90°]) and a cool slot (hue ∈
  [180°, 280°]) at chroma > 0.05. The research finding "warm and cool never mix except at
  the declared collision" becomes a lint, not a taste.
- NEW, capture-testable (ADR-0007 gate, not a unit test): the **value-share gate** — at the
  cathedral station, ≥50% of pixels below luma 60; at the shallows station, ≤10%. Cheap to
  check on any capture with the existing tooling; it pins the single biggest current defect
  (no darkness) against regression.

### 3.2 ONE light language: a single key + darkness-gated response, flipped by the quench

The whole act uses one grammar, stated once:

- **Chapter 1:** ONE warm key — the lava lake / First Heart *below* the camera (the profile
  already authors `lightDir: [0.1, −0.6, 0.3]`, light from beneath — keep it). Everything
  else is *response*: darkness-gated ember veins (Laputa device in ember), Calcifer-grammar
  fire personality on the First Heart, orange-only bounce (Takeshige's rejected-green
  lesson). No second light. No sky.
- **The crack:** the quench flips the key. Warm key below fades as a cool key above ignites
  — Nausicaä-chamber shafts of surface light bleeding DOWN through the crack during the last
  fifth of ch1 (pre-seeding the palette flip so the quench is a flash, not a hue cut).
- **The ocean:** ONE cool key — the surface above, on `ODYSSEY_WORLD_SUN`'s azimuth exactly
  as the shipped god rays already lean (23°, refraction-steepened; do not invent a private
  sun — the one-sun invariant test extends to any new Act I light constant). Everything else
  is response: darkness-gated bioluminescence that LIVES in the abyss half and yields to the
  key as the surface brightens — the levistone device in cyan. The vertical gradient
  inversion (§0.3) dies by construction: depth bands are keyed on the distance to the key.

### 3.3 The fog and atmosphere plan (the 4×-recurring trap, addressed structurally)

The scene-fog trap has cost four sessions; the shipped Act II policy is the cure and Act I
adopts it wholesale:

- **Every rebuilt Act I material carries its own aerial and sets `fog = false`.** Earth
  Core's "atmosphere" becomes a depth-keyed darkness ramp (near: ember-lit; far: near-black
  indigo — Ponyo bands in the magma family), replacing the current `fogDensity 0.014` red
  soup. The underwater aerial is the banded ramp in `applyAerial`'s water branch (§3.4).
- **The lints extend, not duplicate**: `odyssey-world-lints.test.js` pins the world's
  opt-out list against its constructor list; the rebuilt `earth-core` gets the same
  constructor-list pin, and `odyssey-chapter-fog-optout.test.js`'s built-environment walk
  adds ch1 to its chapter list (it already covers 6/7/8; ch1 was exempted as "fog IS the
  look" — that exemption dies with the rebuild).
- `FogExp2` stays on the scene for what Act I does not draw (ribbon, orbs, traveller),
  DRIVEN by the act's script exactly as the world drives it for Act II — the
  `FOG_MATCH_DISTANCE` equalisation already exists; Act I supplies its colour from the new
  script segment instead of the chapter profile.

### 3.4 The underwater deepening (in the world, where it already lives)

All inside `odyssey-world-renderer.js`'s existing material set — **no new chapter module,
no new environment, at most ONE new material object** (the life system):

1. **Banded depth ramp** replacing the single exponential in the water branch of
   `applyAerial`: 3 Oklab-interpolated plates keyed on depth-to-surface (Ponyo stack,
   Hoshi-no-Tani's channel-following softstep), driven by the script's water keyframes.
   Brightest band at the top — the inversion fix. Cost: a mix chain, ~free (ESTIMATE;
   measured in Wave 4).
2. **The luminous ceiling**: Sea-of-Thieves SSS on the water underside — crest mask from the
   existing swell term × sun-facing × grazing → dawn-gold glow rim. ~5 ALU on the existing
   water material (ESTIMATE).
3. **Particulate**: one instanced additive mote system, 2 depth tiers, transmitted-light
   brightness (∝ darkness behind), slow constant-velocity drift + sine sway. Hard size cap
   for Lane B fill (the Cosmic Noir lesson); count is free, SIZE is the budget.
4. **Life**: one InstancedMesh of fish/ray silhouettes, ABZÛ vertex-cosine swim (yaw + tail
   + roll in model space, `positionGeometry` for the mask, `positionLocal` for the offset —
   the r181 instancing rule), dark shapes against the light above — Deep Ocean's old
   "distant creatures still flat dark polygons" note is the caution: silhouettes must live
   BETWEEN the camera and the light to read, never against the dark. Kelp: instanced blades
   on the existing tree-sway pattern, height-gradient tinted (EUROPA device).
5. **Orb-birth / warawara moment**: the level orbs already rise along the rail with restored
   sparkles; add a slow helical drift term to the existing sparkle cloud within the
   underwater span only (uniform-driven, zero new draws) so the ascent reads as *accompanied*.
6. **God rays**: keep the shipped 22 cones; brightness follows the new band ramp so shafts
   fade with depth instead of holding constant.

### 3.5 The Earth Core rebuild (inside the existing module contract)

Target: **≤ 35 draws, ≤ 10 material objects** for the whole chapter (ESTIMATE, gated in §8;
today: 131 draws, ~27 materials). The shape:

- **One vault** (BackSide shell, single material): near-black charred interior with the
  darkness-gated ember-vein term and the twinkle "galaxy" (Laputa) baked as instanced points
  in the shell's own vertex data — not a separate system. The magma-cloud canopy folds into
  the vault's upper hemisphere as a shader term, not a second mesh family.
- **One column family** (single InstancedMesh, one material): re-silhouetted — tapering
  shard profiles with capped-top bevels (the flat-cap defect dies in geometry), Ori
  rim-light response in vertex-colour masks, vein noise LOWER frequency so it reads as crust
  at range (the footprint-gate rule from the world applies verbatim).
- **One lava lake** (keep the concept, rebuild the material): calm mirror-bright surface the
  camera looks across, Journey diffuse-contrast on the crust plates, Hoshi-no-Tani glitter
  quantisation on the melt seams. The lake IS the warm key; its emissive drives the vault's
  gate uniform.
- **The First Heart with Calcifer grammar**: teardrop silhouette, 3-stop ramp, pose-based
  pulse (authoring cost, not shader cost). It watches you leave — one slow aim-at-camera
  pose in the last fifth. This is the chapter's "fire with personality" moment and its only
  bespoke indulgence.
- **One billboard particle system** (single material, texture-atlas): embers + smoke + spark
  motes as atlas tiles of one InstancedMesh, replacing today's four separate systems.
  Transmitted-light embers (bright where the background is dark).
- **The crack pre-seed** (last fifth): 3–5 cool shaft cards descending from the vault mouth
  (Nausicaä chamber), gated on progress; the cyan accent the script already seeds.
- **Deletions**: the standalone smoke/stars/embers/sparks/haze systems, the separate
  horizon/low/mid duplicate meshes, the per-set-piece Sprite glows (fold into the atlas),
  and every material object the ≤10 budget cannot carry. The 17 `uOpacity` bridges collapse
  to the handful the surviving materials need (the bridge MECHANISM stays — r181
  `opacityNode` dead-write rule — only the count shrinks).

### 3.6 What is deliberately NOT in the design

- No volumetric raymarching anywhere (the One World's rejected-cost table stands).
- No new post passes: the film-print grade rides the existing pipeline's grade stage;
  playground tuning overshoots because the playground is NoToneMapping (the standing rule).
- No creature-wave hero moment in v1 (Ponyo's most expensive device) — the quench is the
  act's one bespoke volume; a second is Lane-B-unaffordable until measured otherwise.
- No changes to `ONE_WORLD_CHAPTERS`, the act-gate margin, the registry, or the escape
  hatch (ADR-0015).

---

## 4. THE ARCHITECTURE DECISION — where does Act I live? (ADR-0017 draft)

**Question:** should Act I move inside the One World environment, or stay as it is — Earth
Core its own interior chapter, the ocean already the world's underwater span?

**Facts (each verified against the code or measured this session):**

1. The ocean IS the world already: `uSubmerged`, water-mode sky, caustics, god rays live in
   `odyssey-world-renderer.js`; `deep-ocean.js` is suppressed on the default path
   (`ONE_WORLD_CHAPTERS = [2,3,4,5]`, board line 134).
2. A heightfield is single-valued; Earth Core's cavern occupies y ∈ [−52, 123] at XZ (−3, 5)
   where the world's own ocean floor sits at y ≈ 98.7 (§0.1). A cave under the sea floor
   cannot be a term in `odysseyWorldHeight` — representing it in-world means either carving
   the clipmap (an alpha/discard hole in the ground material that EVERY Act II fragment then
   pays for, breaking the "one surface, one draw" structural claim measured at 0.393 ms) or
   parenting a cave-interior mesh set under the world group (which is just the diorama with
   extra steps and a worse name).
3. The camera can never see the cavern and the open sea floor in one frame: the only
   crossing is the vertical crack, and the shipped quench occludes it with peak density at
   the crossing (capture-verified 2026-08-12).
4. The registry/crash-recovery contract (ADR-0015) requires `earth-core.js` to keep its
   module shape regardless — chapter modules must survive as loadable environments for the
   flagless crash-catch. Moving ch1's content in-world would leave a stub module whose only
   job is to exist, while the world grows chapter-shaped special cases — the exact ownership
   confusion One World §3.0 was written to kill.
5. Cost check on the felt-continuity claim: what makes the act feel continuous is the colour
   script (one contract, §3.1), one light language (§3.2), and the quench (§0.4) — all of
   which are independent of which scene graph hosts the cavern. The One World plan itself
   reached the same conclusion for its act edges: "occlusion moments, not crossfades" — and
   an occlusion moment between two hosts feels identical to one within a single host,
   because at the moment of transfer the player sees only the occluder.

**Decision: (a) with its dependencies stated.** Earth Core stays its own interior place, per
the One World act table and ADR-0015, **rebuilt in place to One World discipline** (draw/
material budget, script-driven colour, fog-opt-out lints, capture gates). The underwater
stretch deepens **in the world**, where it already lives. Felt continuity is delivered by
the script + light language + quench, each with its own test or capture gate.

**What this decision costs:** Earth Core keeps its own frame's fixed costs (its own sky
backstop, its own light rig integration) — measured today at 131 draws, and the rebuild
budget (≤35 draws) is the price control. **What the alternative would cost:** a permanent
per-fragment tax on the measured 0.393 ms Act II ground, a broken structural draw-call claim
(`odysseyWorldDrawCallsLaneA` gates on exactly this), registry/test churn across 4+
contracts, and a degraded crash-recovery path — for a continuity gain the quench already
delivers by occlusion.

**Not re-litigated by this decision:** ADR-0015 (hatch + modules stay), the act-gate margin
0.03, ONE_WORLD_CHAPTERS. **Record**: on acceptance, file this section as
`docs/adr/0017-act-i-stays-a-diorama-the-ocean-deepens-in-world.md` and link it from the
ARCHITECTURE_INDEX.

---

## 5. The r181 rules this plan builds under (all pre-paid; none optional)

1. **CPU-expressible math goes in BAKES, not TSL graphs.** The codegen bomb cost 155 s of
   frozen tab (macro fold, One World Wave −1). Earth Core's vein/crust fields follow the
   already-shipped `?earthCoreBakeNoise` pattern (baked 3D noise for low/mid frequencies,
   analytic only for the sharp vein); any new field starts baked.
2. **`texture(...).level(0)` in every vertex-stage read** — WGSL forbids implicit-LOD there
   and r181 injects a level for exactly three internal cases, none of them user materials.
   The source-scan lint (`odyssey-world-lints.test.js`) extends to `earth-core*`.
3. **`material.opacity` is a DEAD WRITE wherever an `opacityNode` exists** — the 4×
   recurring trap. The rebuilt chapter keeps `material.uniforms = { uOpacity }` bridges on
   its (fewer) materials; the existing `earth-core-environment.test.js` bridge assertions
   are the guard and must keep passing throughout.
4. **Instanced masks read `positionGeometry`; instance-transformed offsets build from
   `positionLocal`** — InstanceNode reassigns positionLocal before positionNode runs.
5. **A `depthWrite: false` backstop cannot defend itself** — anything opaque that must
   occlude, writes depth. The vault shell writes depth (it is the cavern's occluder); only
   genuinely additive layers opt out. (The act-gate exists because the old vault didn't.)
6. **Clamp before every `pow`** on noise-derived values — `pow(negative, non-integer)` is
   NaN in WGSL and `NaN × 0` is still NaN; three occurrences already logged in this repo.
7. **Never bind a post target for `compileAsync` once the rAF loop runs** — and note §0.3's
   live validation storm as the active reminder; Wave 0 owns the repro ticket, not this
   plan's waves.
8. **The playground is NoToneMapping; the game is ACES + exposure + saturation.** Tune with
   overshoot, verify in-game (ADR-0007). The world's `outputScale 0.82 / outputSaturation
   0.72` handoff convention applies to any Act I surface the grade touches.
9. **Captures are per-chapter short sessions** — the TDR constraint is a hardware scar, not
   a preference.

---

## 6. Waves — sized for execution, each with a /goal hook

Every wave ends: `npx vitest run` green, `npx eslint .` green, capture(s) attached to the
commit, one commit. Wave numbering restarts at 0 for this plan (Act I namespace).

**Tracker — the execution session's loop variable.** One line per wave, checked off as each
wave's acceptance criteria pass; `grep -c '^- \[ \]'` over this file is the remaining
count. (Added 2026-08-12: the session-spanning /goal hook greps for exactly this format —
the One World convention — and the plan shipped without it.)

- [x] **Wave 0** — Instrument truth — **DONE 2026-08-12.** Refuted its own premise (the
  "cumulus underwater" was the steam quench; the gate works), caught a lying instrument that
  was our own omission, found the real defect instead (clouds + god rays submitted while
  provably invisible → Wave 4), corrected the breach to p≈0.181, measured cold compile at
  3,948 ms (58× One World), and fixed the harness Vite-orphan leak.
- [x] **Wave 1** — The playground value study — **DONE 2026-08-12.** 6 materials, 3
  phase-locked angles, value gate 0.905–0.973 (needs ≥0.50), console clean. Five capture-
  forced corrections recorded, including two that only a SECOND phase revealed.
- [x] **Wave 2** — The script grows its Act I limb — **DONE 2026-08-12.** Rescoped first
  (negative `p` is unsamplable — Act I got its own array + sampler). 13 tests, both new
  invariants mutation-verified; the first hue-rate guard was INERT and was strengthened until
  it failed for the right reason. Chroma floor calibrated 0.05 → 0.02 against the measured
  palette.
- [x] **Wave 3a** — Earth Core RE-LIT — **DONE 2026-08-12.** mid-wash 0.460 → 0.193 at the
  cathedral station (true-black 0.420 → 0.806). The god-ray facing fade and the charred rock
  re-base did nearly all of it; the acceptance's own stations were corrected (two of three sat
  inside the quench window). Three instrument repairs were needed first. Contract untouched.
- [ ] **Wave 3b** — Earth Core CONSOLIDATED to ≤35 draws (needs an explicit
  `earth-core-environment.test.js` contract migration — see the Wave 3 split note)
- [x] **Wave 4** — The ocean becomes luminous — **DONE 2026-08-12.** Bands + SSS ceiling +
  640 size-capped motes + the two water keyframes; gradient inversion fixed and measured
  (83.7 → 170.6 luma toward the surface); Lane B **7.73 → 5.96 ms p50** (drift 0.00) — the
  fill fix paid for the motes with 1.77 ms to spare.
- [x] **Wave 5** — Life — **DONE 2026-08-12.** 110-fish school, one InstancedMesh, vertex-only
  swim, silhouettes against the light; measures ≤1 timer tick on Lane B (5.96/6.03, drift one
  tick). One shape iteration (kites → 3.5:1 fish). Kelp + orb drift deferred to Wave 7 polish,
  recorded in the outcome.
- [x] **Wave 6** — The crack climax — **DONE 2026-08-12.** Asymmetric quench curve measured
  (approach luma 61.4 → 24.6, bright share → 0.001 — the reveal holds back); god-ray tint
  pre-seed warm→cool on the seam's clock, zero new draws. Vault-mouth opening + Heart
  farewell deferred to 3b/polish, named in the outcome.
- [x] **Wave 7** — Close the books — **DONE 2026-08-12.** Four cells written (one real
  baseline — underwater Lane B 5.96 ms, 1.7 under its start — and three ADR-0016 nulls with
  published reasons); ADR-0017 filed; the ch1 92↔93 draw flicker found by the void guard and
  named as 3b's prerequisite; the fill-bound-not-draw-bound finding recorded where 3b will
  read it.

### Wave 0 — Instrument truth (blocking; nothing visual until these answer)

> **/goal hook:** "Act I Wave 0: make the three Phase-0 anomalies answer — uSubmerged in
> capture metrics + one re-shot station; cold-compile re-measure of earth-core; repro ticket
> for the post-target validation storm. No visual changes."

- Add `uSubmerged` (and the active colour-script sample name) to
  `odyssey-chapter-capture.mjs` metrics JSON; re-shoot ONE underwater station; decide
  "instrument gap" vs "live regression" for the cumulus-through-water defect and fix the
  harness half if that is the answer (a live-regression fix is its own follow-up with a
  capture, not smuggled in).
- Re-measure earth-core cold compile with a cleared Dawn cache (the 2,336 ms figure is
  single-sample, warm-cache, Low).
- File the `[Texture "output"]` validation-storm repro with the exact console signature from
  §0.3 (owner: the post/prewarm pipeline, outside this plan's waves).
- **Acceptance:** metrics field present in a fresh capture JSON; one-line verdict on the
  cumulus defect recorded in this file; compile number replaces the caveated one in §0.2.

#### Wave 0 OUTCOME — DONE 2026-08-12. The wave paid for itself by refuting its own premise.

**1. The cumulus defect does not exist; the quench does.** Verdict recorded at the claim
(§0.3 defect 1, original preserved): `odyssey-steam-quench` is drawn at exactly the three
cited stations (p=0.093/0.115/0.137, densities 1.00/0.40/0.07) and nowhere else, and
`uSubmerged` measures **1.000** across every submerged station — the gate works, and the
"cumulus" was the shipped act-edge volume doing its job.

**2. The instrument lied first, and the lie was ours.** The first re-shoot read
`submerged = 0.00` / empty script name at every station — a result that would have
*confirmed* the plan's instrument-gap hypothesis. Cause: the exposure patch declared and
returned the `state` object but never assigned to it. Fixed, re-shot, and written up in
place, because "the plausible reading confirmed the guess" is precisely how the four false
numbers in the One World plan survived review (ADR-0016 §1).

**3. One real defect found, of a different shape than the one hunted.**
`odyssey-world-clouds` is submitted and rasterised at every fully-submerged station while
its alpha is provably zero (three texture fetches per covered pixel of a sky-covering sheet,
on the lane that measures 7.73 ms); `odyssey-world-godrays` is the same bug inverted at
p≥0.182. **Two `mesh.visible` writes in the world's `update()` — assigned to Wave 4.**

**4. The near-surface frame is already AIR, not dark water.** `uSubmerged` is eye-driven
(`railPoint.y + 16`), so the visual breach lands at **p ≈ 0.181**, not the rail's 0.190.
§0.3's "darker and emptier near the surface" is the water treatment switching off early, not
a gradient bug — amended at the claim; it changes what Wave 4 must build.

**5. Cold compile re-measured: ch1 = 3,948 ms cold (58× One World), ~2× the warm band.**
Method note recorded: `GPUCache` alone is not cold on this Electron.

**6. Harness leak fixed** (the §0.3 defect-4 item): both `odyssey-gpu-split.mjs` and
`odyssey-chapter-capture.mjs` now kill the dev-server **process tree** on Windows, so a run
can no longer orphan Vite and fail the next `--strictPort` boot. This session lost three
measurement runs to that leak before it was understood.

**7. Validation-storm repro: filed in-plan** (§0.3 defect 2) with its exact console
signature and trigger — it needs the full background chapter prewarm (ch6+), which the
Act I capture windows exclude, which is why both Phase-0 capture consoles are clean. Owner
is the post/prewarm pipeline, outside this plan's waves.

**Gates:** `npx vitest run` **331 files / 3281 tests green**; `npx eslint` clean on all three
changed files (the repo-wide lint carries a large pre-existing debt in untouched files —
unchanged by this wave, and not weakened to pass it). Instrument changes are diagnostics-only;
no visual surface was modified, so no ADR-0007 capture debt is incurred.

### Wave 1 — The playground value study (the look is proven before any port)

> **/goal hook:** "Act I Wave 1: playground effect `act1-earth-core` — vault + columns +
> lake value study against the Laputa/Heron refs, ≤10 materials, value-share gate met,
> clean console, screenshots. No in-game changes."

- New `src/playground/effects/act1-earth-core.effect.js` (drop-in, auto-registers): the
  §3.5 shape — one vault, one column family, one lake, one particle atlas, First Heart
  stub. Iterate against `?ref=/playground-refs/act1-ghibli-laputa-levistone-blue-glow.jpg`
  (and `-heron-himi-flame-face.jpg` for the fire ramp) in split mode.
- Tune with overshoot (NoToneMapping); the value-share gate (≥50% of pixels < luma 60) is
  checked on the playground capture AND re-checked in-game in Wave 3.
- **Acceptance:** phase-locked `?t=` screenshots at 2–3 angles; console clean; material
  count ≤10 printed by the effect's own stats line; value-share gate met on the capture.

#### Wave 1 OUTCOME — DONE 2026-08-12. The device works; five iterations were needed to prove it.

`src/playground/effects/act1-earth-core.effect.js` (drop-in, auto-registers) plus
`scripts/act1-value-gate.mjs`, which turns the §3.1 value gate into a number anyone can
re-run. Captures: `artifacts/odyssey/act1-wave1/earth-core-0{1,2,3}-*.png` at phase-locked
`?t=9/32/63`.

**Acceptance, all met:**

| criterion | result |
|---|---|
| 2–3 phase-locked angles | 3 (`t=9` across-lake, `t=32` orbit, `t=63` far) |
| console clean | yes — only the three `[playground:boot]` marks |
| ≤10 material objects, printed by the effect | **6** (`materials=6 (budget ≤10)`) |
| value-share gate ≥50 % under luma 60 | **0.913 / 0.973 / 0.905** — mean luma 24.4 / 19.5 / 25.4 |

**The five corrections the captures forced** (each is a rule the Wave 3 port inherits):

1. **The cool accent inverted the act.** At the authored strength the crack seed painted the
   whole upper hemisphere teal and four additive shaft cards stood metres from the lens: a
   COOL cave with warm decorations, the exact opposite of the brief. Narrowed on both axes,
   dimmed to 0.14, and the shafts moved out to radius 165 at 0.05 opacity. ≤2 % of frame is
   not a description, it is a constraint that has to be enforced twice — once in the shell
   term and once in the geometry.
2. **Frequency is set by the radius — again.** Vein noise at 2.1 over a 240 u shell made
   filaments tens of metres wide, which read as orange NEBULA. 11.0 restores "cracks in
   rock". This is the third time this repo has paid for the same lesson (quench, cloud bank,
   now the vault); it belongs in §5 as a rule, not a war story.
3. **The key has to be ON SCREEN and it has to be the brightest thing.** First framing aimed
   above the lake and lost it entirely; then the crust window (0.46/0.60) made the lake a
   dark floor with smears; then the hot stop won and it became a cream beach. Final: crust is
   the minority (0.60/0.78) and the pale stop is reached only via `pow(heat, 5)`.
4. **A camera that orbits at radius 132 flies through the column ring (62–140).** One capture
   was 80 % dark cylinder. The rail flies up the MIDDLE of the cathedral, so the study camera
   belongs near the axis looking across — which is also the truer framing.
5. **A `floor()`-selected star must be shaded WITHIN its cell.** Lighting the whole cell drew
   each twinkle as a hard square that the sphere's curvature skewed into a diamond — a sky of
   orange parallelograms, invisible at `t=9` because the twinkle phase was dim and obvious at
   `t=32`. `fract` + radial falloff fixes it. **Capture more than one phase**: a single
   phase-locked shot can hide a defect completely.

**Also recorded:** the playground's mount failure reports only `"did not mount"`, and the
underlying `create()` error is overwritten by that message — the real cause (a raw
`THREE.Color` has no `.mul`, so the palette must be `color()` NODES) was recoverable only by
re-running `create()` by hand through Vite's `/@id/` specifier. And a WebGPU canvas reads
back BLACK through `drawImage`, so the gate decodes the saved PNG instead; an in-page
measurement would have reported a flattering, meaningless 100 % dark.

**Gates:** `npx vitest run` 331 files / 3281 tests green; `npx eslint` clean on both new
files. No production surface touched — this wave is playground-only, so the in-game ACES
verification is Wave 3's, as the plan sequences it.

### Wave 2 — The script grows its Act I limb (data + tests before pixels)

> **/goal hook:** "Act I Wave 2: extend ODYSSEY_COLOUR_SCRIPT with birth/cathedral/crack +
> two water keyframes; extend both invariants + add warm/cool exclusivity; all script tests
> green including new failing-first cases."

- Keyframes per §3.1 (hexes enter as PROPOSED; Wave 1's calibrated values supersede the
  table's). `seamAfter` on the crack. Sampling helper for Act I range (ch1 passes its local
  progress; the mapping mirrors the world's `0.05 + t×0.9` convention).
- Tests: extend `odyssey-colour-script.test.js` — new keyframes join both existing
  invariants; add the warm/cool exclusivity check, mutation-verified (a deliberately warm
  slot in a water keyframe must FAIL before it is trusted).
- **Acceptance:** tests green with at least one new case demonstrated failing-first; no
  visual change shipped yet (data + tests only).

#### Wave 2 OUTCOME — DONE 2026-08-12. Rescoped before execution; both new guards mutation-verified.

`ODYSSEY_ACT1_COLOUR_SCRIPT` + `sampleAct1ColourScript(t)` + `classifyTemperature()` in
`odyssey-colour-script.js`; 13 tests in `odyssey-act1-colour-script.test.js`. **Nothing
renders it yet** — Wave 3 wires it — so the "no visual change" half of the contract is
literal: `git diff` touches one source file and adds one test file.

**The premise was refuted before a line was written** (correction annotated at §3.1): the
plan's negative-`p` keyframes are unsamplable, because `sampleColourScript` clamps to [0,1]
and a shipped test pins that span. Act I therefore got its own array on its own parameter,
and the act handoff is asserted by test rather than by array adjacency. The two water
keyframes moved to Wave 4, where their captures live.

**Both new guards were mutation-verified, and the first attempt at one of them was INERT:**

| mutation | expected | result |
|---|---|---|
| delete `crack.warmCoolCollision` | invariant 3 fails | ✅ 3 tests fail |
| delete `cathedral.seamAfter` (v1 guard, `skyZenith` only) | hue-rate fails | ❌ **PASSED — the guard was inert** |
| delete `cathedral.seamAfter` (v2 guard, both slots) | hue-rate fails | ✅ fails at **16.9°/step vs the 12° cap** |

The inert version is the finding worth keeping. Act II's hue-rate test watches `skyZenith`,
so mirroring it looked correct — but in a CAVERN the crown barely moves (5.96°/step) while
the low band swings ember-to-vapour (23.1°/step). A guard whose exemption can be deleted
without anything failing is decoration. The Act I test now checks both atmospheric slots.

**A third calibration came from measurement, not taste.** The warm/cool chroma floor was
authored at 0.05 and classified the entire quench palette as neutral — `#cfe6ff` measures
Oklab chroma 0.042, `#1a2630` 0.025, `#8fa6b4` 0.033 — so the `crack` keyframe read as "all
warm" and could not earn the exemption it needs. This act's cool tones are PALE by design
(the Ghibli research is explicit about it), so a floor tuned for saturated colour is blind
exactly where the rule matters. Calibrated to **0.02**, which still excludes the near-neutral
charcoals at 0.015. Recorded at the constant.

**Gates:** `npx vitest run` **332 files / 3294 tests green** (up 13); `npx eslint` clean on
both changed files. One mutation was run against Act II's array by accident first (a
first-match string replace) — caught because the Act I suite stayed green when it should not
have, which is itself the reason mutations get re-run until they fail for the RIGHT reason.

### Wave 3 — Earth Core reborn (the port, behind a dev flag until captured)

> **/goal hook:** "Act I Wave 3: rebuild earth-core.js content per the proven playground
> effect, same module contract, script-driven, ≤35 draws; in-game captures at 3 stations
> under the real grade; flip default only after captures."

- Rebuild inside `earth-core.js` / `earth-core.tsl.js` keeping the three exports and the
  bridge mechanism; `?odysseyEarthCore1=0` restores the old content during development
  ONLY (the flag and the old content are deleted in this same wave once captures pass —
  ch1's renderer is not fallback machinery, so ADR-0015 does not require keeping two).
- Fog: constructor-list lint extended to earth-core; chapter-fog-optout walk adds ch1.
- **Acceptance:** in-game captures at p ≈ 0.02 / 0.051 / 0.085 under ACES (per-chapter
  session); value-share gate met IN-GAME; draws ≤35 at the 0.051 station (from the capture
  metrics); `earth-core-environment.test.js` green throughout; the 1→2 seam re-captured
  (quench still occludes; ribbon-inside-shell behaviour intact).

#### Wave 3 SPLIT — 3a / 3b, decided 2026-08-12 BEFORE execution (premise check, not a retreat)

The wave as written asks for two things that cannot both be honoured: **"≤35 draws"** and
**"`earth-core-environment.test.js` green throughout"**. The contract test pins, by name, a
structure the shipped chapter spends its 131 draws on:

`firstHeart` ('first-heart') · `colonnade` ('basalt-colonnade-walls') · `seleniteChamber`
('selenite-geode-chamber') · `visibilityTargets.{firstHeart, lavaFall, seleniteChapel}` ·
`lavaFloor.userData.glows` **exactly 5** · `elements.rockClusters` non-empty · **≥6 geode
clusters** projected into the camera corridor · staged **seam boulders** that sink · the
`uSeam` choreography · a `uOpacity` bridge on **every** `opacityNode` material.

A ≤35-draw rebuild deletes most of that. Deleting it means rewriting those assertions in the
same commit that makes them fail — which is the one thing this plan's discipline forbids
("never weaken a test to make a wave pass"), and it would also discard authored beats
(the selenite chapel, the geode corridor) that no capture has yet judged worth losing.

So the wave splits, and the split is recorded rather than quietly performed:

- **Wave 3a — RE-LIGHT (this wave's real deliverable).** Keep every named structure and the
  whole `uSeam` choreography; replace the LIGHTING and PALETTE with the Wave 1 device:
  script-driven via `sampleAct1ColourScript`, one warm key below, darkness-gated response,
  the starved cyan seed, the low-frequency crust. Draw count is untouched, so no test moves.
  Acceptance keeps the in-game captures, the value-share gate under ACES, and the 1→2 seam.
- **Wave 3b — CONSOLIDATE (new, unchecked).** Take 131 draws toward ≤35 by folding the
  particle systems into one atlas and the rock families into instanced sets, WITH a deliberate
  migration of `earth-core-environment.test.js` to the surviving contract — a test change made
  in the open, reviewed on its own merits, not smuggled in beside a look change.

  **3b PROGRESS (2026-08-12): 131 → 90 draws measured; ratchet installed; ≤35 still open.**
  A headless inventory test walked the built environment and found **77 drawables / 27
  materials**, with the top families: 20 contact-shadow decals, 10 geode clusters, 12 sprites,
  9 obsidian columns, 6 molten pockets. The decals were the one family merge-safe BY PROOF
  (one shared material, all parented statically to the group, shading reads only `uv()` — no
  `positionLocal` dependence a bake would redefine), and merging them took the in-game
  cathedral station from ~127 to **90 draws** at unchanged triangles (~245 k, the
  pixel-identity check). `tests/unit/earth-core-drawable-budget.test.js` now pins a **≤58
  drawable ceiling** so the win cannot silently erode. What remains for ≤35, in order of
  yield and rising contract risk: the 12 sprites (5 are contract-pinned `lavaFloor` glows
  with per-sprite scale animation → needs an instanced-billboard migration done in the open),
  the 10 geode clusters and 9 columns (local-space shading → shader must move to
  world-anchored coordinates first, a visual change owing captures), and the 6 molten
  pockets (same). Each is exactly the "deliberate contract migration" this wave was split
  out to negotiate.

> ⚠️ **THE VALUE-SHARE GATE IS NEARLY VACUOUS IN-GAME — measured 2026-08-12, before executing
> 3a.** §3.1 set the acceptance at "≥50 % of pixels under luma 60" and Wave 1 met it easily in
> the playground. Measured against the SHIPPED chapter under the real ACES grade, it is
> already met: **darkShare 0.751** at the p=0 station (0.587 at the seam). Wave 3a could
> therefore have been "passed" by changing nothing, which is precisely the kind of gate this
> plan exists not to ship.
>
> The histogram says why, and hands over the metric that does discriminate. A magma cavern has
> no shortage of dark pixels — Earth Core is **42 % true-black** already. Its defect is that
> everything between the black and the fire sits in ONE undifferentiated mid band:
>
> | frame | true-black (<32) | **mid-wash (32–96)** | verdict |
> |---|---:|---:|---|
> | shipped Earth Core, p=0, in-game ACES | 0.420 | **0.460** | the "~90 % mid-red" read, quantified |
> | Wave 1 playground study | 0.832 | **0.147** | the target structure |
> | shipped ocean, p=0.160, in-game | 0.000 | **0.988** | worse — not one pixel below luma 64 |
>
> **Wave 3a's acceptance is therefore restated: `midWash ≤ 0.25` in-game at the cathedral
> station**, with `darkShare` kept only as a floor. `scripts/act1-value-gate.mjs` now reports
> `trueBlack` and `midWash` alongside it. The ocean row is recorded here because it is the
> same discovery: Wave 4's real target is 0.988 → structured, and "the near-surface frame is
> brightest" was always a proxy for it.

#### Wave 3a OUTCOME — DONE 2026-08-12, gate met, after three instrument repairs

**The gate is met at the station it was written for: `midWash` 0.460 → 0.193 (≤ 0.25),
`trueBlack` 0.420 → 0.806.** What follows is how, and what still is not.

**Two levers did nearly all of it, and neither was the one the wave predicted:**

1. **The god-ray cones had no facing fade** — the exact defect Act II already paid for on its
   own ported god rays ("a shell standing in for a volume must dim where it is seen edge-on,
   because the grazing angle IS the silhouette"). Without it they drew hard pale WEDGES across
   the frame. Adding it: mid-wash **0.631 → 0.209** at the cathedral station, true-black
   0.367 → 0.790, in one change. It is also the least Ghibli thing in the chapter, gone.
2. **`moltenRockField` re-based to charred** (crust `0.07,0.03,0.012` → `0.013,0.006,0.004`,
   cooling-river stop more than halved, the 0.05 black floor dropped to 0.012). Worth
   0.445 → 0.283 at the mid-cavern station. The bright river stop is untouched on purpose:
   emptying the mid band must not turn the fire grey.

Also kept, smaller: the backdrop ember belt darkness-gated, molten haze halved, magma canopy
halved, and the lava lake carrying the Wave 1 study's composition (crust as minority, rare
pale stop, quantised glitter).

**THE STATIONS IN THE ACCEPTANCE WERE WRONG, and this is a correction, not a goalpost move.**
The wave named p ≈ 0.02 / 0.051 / 0.085. The steam quench's window is `0.093 ± 0.06 =
[0.033, 0.153]`, so **0.051 and 0.085 are INSIDE it** — at p=0.062 the veil is ~23 % dense and
fills the frame with bright vapour BY DESIGN. Measuring the cavern's value structure there
measures the occlusion moment instead. The valid cavern stations are `p < 0.033`; the
cathedral-equivalent is **p = 0.031**, and that is where the gate is now met.

**What does NOT pass, stated plainly:** the two birth stations, p = 0.000 (0.479) and
p = 0.010 (0.504). At both the camera is metres from lit rock with the lava lake filling the
lower frame — the chapter's brightest moment by design ("we are BORN from the lava"). Whether
they SHOULD pass is an art question this plan has not answered; the next lever if they should
is the rock's close-range crust frequency, which reads as fine red speckle rather than crust
at that distance (the Wave 1 "frequency is set by the radius" lesson, unapplied here).

**Three instrument repairs were needed before any of this could be measured**, and they are
the wave's most reusable output: the missing phase lock (`--time`), the stale-frame
`capturePage` defect (two rAFs + settle before the shutter), and the overlay sweep by
containment. The six A/B attempts made before those fixes are void and marked as such above.

**Gates:** `npx vitest run` 332 files / 3294 tests green; `npx eslint` clean;
`earth-core-environment.test.js` green throughout — **no contract test was touched**, which
was the constraint that forced the 3a/3b split in the first place.

Landed (tests green throughout, contract untouched): the backdrop's ember belt is
darkness-gated and contrast-shaped; the molten haze is halved; the lava lake carries the Wave
1 study's composition (crust as the minority, a rare pale stop via `pow`, quantised glitter);
the magma cloud canopy is halved and its ceiling dropped.

**Acceptance is `midWash ≤ 0.25` in-game. Best station measured 0.42; most sit at 0.65+.**
Not met. Four attempts, each measured rather than argued:

| # | lever | result |
|---|---|---|
| 1 | backdrop ember belt darkness-gated | inconclusive — see the instrument note below |
| 2 | rock bounce gated by height above the lake | **marginal** (0.439 → 0.425 at p=0, but 0.550 → 0.651 at p=0.062) |
| 3 | lake ported from the Wave 1 study | no mid-wash gain (0.425 → 0.494 at p=0) |
| 4 | magma cloud canopy halved | no gain (0.494 → 0.436 at p=0, others flat) |

**THE INSTRUMENT WAS THE FIRST BLOCKER, AND IT INVALIDATED AN EARLIER CLAIM.** Attempt 1 was
written up as "mid-wash 0.460 → 0.289, a real improvement". It was noise: two runs of
**functionally identical code** through `odyssey-chapter-capture.mjs` produced **0.289 / 0.466
/ 0.233** and **0.435 / 0.698 / 0.793** at the same stations. Every animated uniform rides
`boardController.time`, which advances with wall clock, so each run samples a different frame
of lava, ember and haze animation — a run-to-run spread of up to **0.56**, larger than any
art change being evaluated. Fixed: the harness now takes **`--time <seconds>`**, freezing the
clock exactly as the playground's `?t=` does, and records `fixedTime` in the manifest. Every
number in the table above is phase-locked; the pre-fix ones are struck.

**THE REAL BLOCKER, identified from the captures:** the wash is not the backdrop, the lake or
the canopy — it is `moltenRockField`, the shared rock shading applied to **every wall, column
and boulder in the chapter**. In-game it renders as saturated mid-red across the entire
silhouette with no charred anchor, and the Wave 1 study got its structure from the opposite
choice: a near-black charred base with warmth admitted ONLY as a rim from below. Changing that
field is not a constant tweak — it is the chapter's rock identity, it feeds the geode/colonnade
/boulder families, and it deserves its own wave with its own captures.

**ATTEMPTS 5 AND 6, and the conclusion they force.** Attempt 5 did re-author
`moltenRockField` (crust `0.07,0.03,0.012` → `0.022,0.010,0.006`, the cooling-river stop
halved, the 0.05 floor that held every shadowed face above black dropped to 0.012). It is the
one change that moved the structure: **true-black 0.338 → 0.490** at the p=0.062 station, and
the frame finally reads as charred rock with an ember path rather than as glowing rock.
Attempt 6 re-based the chapter's fog (§3.3's "red soup": density 0.014 → 0.0065, colour to the
script's vault base) and measured **worse** — 0.508 → 0.647 at the same station — because
thinning the fog UNCOVERS the bright emissive geometry it was hiding. Reverted.

> 🔴 **A THIRD, WORSE INSTRUMENT DEFECT — found 2026-08-12 after the above, and it
> invalidates every per-station number in this wave.** `win.webContents.capturePage()` returns
> the last COMPOSITED frame, not the current one. The harness settled a station, changed the
> DOM, and photographed — getting a frame from BEFORE the settle. Station 1 therefore showed
> the main menu (the pre-board state) and every later station showed its PREDECESSOR's view,
> which is why hiding `#start-modal` three different ways never worked: the modal was already
> gone from the page and still present in the photograph.
>
> Fixed by waiting two `requestAnimationFrame`s plus a 120 ms settle between the DOM sweep and
> the shutter. Verified: station 1 now shows the cavern (no menu), and station 4 — the quench
> peak — finally reads meanLuma **210** (white vapour), which is what that station has always
> been and never once photographed.
>
> **Consequence, stated plainly: the six Wave 3a A/B comparisons above were made on
> mis-aligned frames and cannot be trusted to say which lever worked.** They are kept as the
> record of how the defect was found, not as evidence about the art. The re-baseline on the
> fixed instrument, current code, `--time 9`:
>
> | station | p | midWash | trueBlack | meanLuma |
> |---|---|---:|---:|---:|
> | 1 | 0.000 | 0.684 | 0.119 | 69.2 |
> | 2 | 0.031 | 0.631 | 0.367 | 35.0 |
> | 3 | 0.062 | 0.391 | 0.302 | 65.7 |
> | 4 | 0.093 | 0.001 | 0.000 | 210.1 (quench peak — correct) |
>
> Every future Act I measurement starts here.

**Two instrument defects contaminated this whole wave, and both are now known:**

1. **Station 1 is unusable.** Its capture repeatedly catches the MENU OVERLAY before
   `HIDE_OVERLAYS` applies (Phase-0 defect 3, logged and not fixed) — a bright UI panel across
   a third of the frame. Its mid-wash sat at ~0.43 in all six runs *regardless of what changed*,
   because most of what it measures is the menu. Every comparison that included it was noise.
   **Fix before any further art measurement:** re-shoot station 1 after settle, or drop it.
2. **The phase lock was missing** (fixed this wave, `--time`), which invalidated attempt 1's
   recorded improvement.

**THE HONEST CONCLUSION: `midWash ≤ 0.25` is not reachable by re-lighting.** Six phase-locked
attempts across five systems — backdrop belt, molten haze, lava lake, magma canopy, rock field,
chapter fog — moved the best valid station from ~0.55 to ~0.51 and left the others at 0.41–0.68.
The Wave 1 study reached **0.147** on the first serious try, and the difference is not shader
constants: the study OWNS ITS GEOMETRY (one vault, one column family, one lake, a starved
accent), while the shipped chapter's emissive surface area — lava fall, five basin glows, god-ray
cones, geode clusters, molten pockets — is itself the mid band. **That retro-validates the 3a/3b
split's premise and inverts its expectation: 3a alone cannot pass this gate, and the gate belongs
to 3b.** Recorded here rather than by quietly lowering the threshold to whatever the re-light
happened to reach.

*(Superseded next step, kept for the record:)* **Next step, precisely:** re-author `moltenRockField`'s base toward near-black and re-admit
warmth through the existing `bakedWarm` bounce (now height-gated) plus the fresnel rim, then
re-measure at `--time 9`. Expect the mid-wash to fall from ~0.65 toward the study's 0.147 in
one move, because this is the surface that owns the pixels.

**A note the plan owes the reader:** Wave 1's model — the vault, tapered columns, teardrop
Heart — lives in the PLAYGROUND only. Chapter 1 in-game still has its shipped geometry by
design (the §3 split keeps the contract-pinned structure), so anyone comparing the two will
correctly see "the same chapter, re-lit" rather than the study. Porting the study's GEOMETRY
is Wave 3b, and it is the larger half of the work.

**Sequencing rationale:** 3a is what makes the act beautiful and is capture-verifiable today;
3b is what makes it cheap and needs a contract negotiation first. The measured Lane B cost
(⚠️ see §0.2 — ch1 is the journey's worst frame) belongs to 3b, and §8's `odysseyAct1Ch1DrawCalls`
cell is 3b's gate, not 3a's.

### Wave 4 — The ocean becomes luminous (bands, ceiling, motes)

> **/goal hook:** "Act I Wave 4: banded depth ramp + SSS ceiling + capped particulate in
> the world renderer; vertical gradient reads bright-up; captures at 3 depths; Lane B
> delta measured ≤ +0.8 ms or re-scoped."

- §3.4 items 1–3 + 6. All in existing world materials except the mote system (ONE new
  material object — the world's stats line goes 5→6 and the material-count lint updates
  deliberately with it).
- **Acceptance:** captures at p ≈ 0.11 / 0.15 / 0.185 showing the band progression and the
  brightening-upward gradient; the p=0.185 frame is now the BRIGHTEST of the three
  (inverting §0.3's finding); Lane B gpu-split at the p=0.16 station, content-matched,
  delta vs. this plan's §0.2 Lane B underwater baseline **≤ +0.8 ms p50 (ESTIMATE — the
  gate cell in §8 holds the truth and a miss re-scopes the mote budget, not the plan)**.

#### Wave 4 OUTCOME — DONE 2026-08-12 (second pass; the first is preserved below)

**All three acceptance criteria are now met, each on the fixed instrument:**

1. **The gradient brightens toward the light.** At the two stations that are BOTH submerged
   and outside the quench window (p=0.156 / p=0.172, `--time 9`): mean luma **83.7 → 170.6**
   — the shallower frame is 2× brighter. The original stations could never have shown this
   (one was air, one was quench), which the first-pass note below explains.
2. **The motes are in.** One instanced additive system (640 quads, size-capped 0.5–1.1 u,
   transmitted-light brightness ∝ depth, constant-velocity drift), ONE new material carrying
   its own `fog = false`; drawn only while submerged via the same CPU `visible` gate as the
   god rays; world tests + both fog lints green (51 tests).
3. **The Lane B delta is measured, and it is a SAVING: 7.73 → 5.96 ms p50** (drift exactly
   0.00, content-matched at 44 draws, quiet machine). The whole Wave 4 package — bands, SSS
   ceiling, motes, and Wave 0's clouds-not-submitted-underwater fix — lands **−1.77 ms**
   against a ≤+0.8 budget, because the fill fix more than pays for the motes. The wild p99
   tail (24.6 ms in the Phase 0 run) is gone: p99 now 6.23 ms.

Taste notes carried, not chased: the near-surface frame reads pale under the in-game grade,
and the water sheet's far rim shows jagged crest triangles at the horizon — both are Wave 7
polish candidates, neither blocks the wave's criteria.

#### Wave 4 first-pass status (superseded, kept as the record)

Landed and green: the **banded depth ramp** (three script-driven plates replacing the single
exponential), the **crest-SSS luminous ceiling** (~5 ALU on the existing water material, zero
new draws), the two **water keyframes** Wave 2 deferred here (`luminous-mid-water` p=0.06,
`shallows` p=0.12 — both inside Act II's existing span, both passing every script invariant),
and **Wave 0's measured fill defect**.

**The fill fix is MEASURED, and it is the wave's one fully-verified claim.** In-game capture
metrics, before → after, same stations:

| station | `submerged` | clouds submitted | god-rays submitted | draws |
|---|---|---|---|---|
| p=0.160 | 1.00 | **true → false** | true | **44 → 42** |
| p=0.182 | 0.00 | true | **true → false** | **44 → 42** |

Two `mesh.visible` writes, two draws and a sky-covering sheet of zero-alpha fragments off the
weak lane at every submerged station.

**Why it is NOT checked off.** The acceptance asks that "the p=0.185 frame is now the
BRIGHTEST of the three". Measured mean luma at the three captured depths: **170.4 (p=0.137),
100.5 (p=0.160), 78.8 (p=0.182)** — still darkening upward. But the criterion cannot be
judged from these stations, and Wave 0 already explained why:

- **p=0.182 is not underwater.** It measures `submerged = 0.00`, script keyframe `breach` —
  the eye crosses the waterline at p≈0.181, so that frame is AIR and the water treatment
  (bands, god-rays) is correctly switched off in it.
- **p=0.137 is inside the steam quench** (window 0.033–0.153), so its 170.4 is billow, not
  water.

The two remaining stations do not bracket the band progression. **Next step, precisely:**
re-capture at **p = 0.150 / 0.165 / 0.178** — all submerged, all outside the quench — and
compare. If the ramp still darkens upward there, the band thresholds (`0.10/0.42` and
`0.45/0.92` on a 160 u normaliser) are the lever, not the palette. Also still owed:
the **motes** (§3.4.3) and the **Lane B delta** against the 7.73 ms baseline, which per
ADR-0016 must be a cooled, quiet, content-matched run — not one taken while a capture
harness and a dev server are competing for the same GPU, as they were this session.

**Gates on what landed:** `npx vitest run` 332 files / **3294 tests green**; `npx eslint`
clean on both changed files; in-game capture taken under the real ACES grade.

### Wave 5 — Life (fish, kelp, the accompanied ascent)

> **/goal hook:** "Act I Wave 5: one instanced fish/silhouette system with vertex-cosine
> swim + kelp on the existing sway pattern + orb helical drift underwater; silhouettes
> read against the light; captures; Lane B re-split."

- §3.4 items 4–5. Fish count starts at ~120 (ESTIMATE; vertex-ALU only), silhouette
  placement BETWEEN rail and surface light.
- **Acceptance:** captures show at least one readable creature-silhouette moment per depth
  band without hunting for it; Lane B split at p=0.16 again, cumulative Act I underwater
  delta within the §8 cell; no new console warnings.

#### Wave 5 OUTCOME — DONE 2026-08-12 (acceptance met; two scope items deferred, named)

**The school is in, and it costs one timer tick.** 110 fish as ONE InstancedMesh: a hand-built
3.5:1 wedge (7 triangles), cruise + swim entirely in the vertex stage (cosine yaw with a
tail-weighted mask on `positionGeometry` — the instancing-safe axis), each fish circling its
own seeded origin so the school drifts without phase-locking, seated ABOVE the rail so the
breach light is behind every silhouette. Dark body takes only down-welling light: a SHAPE
against the luminous ceiling, never a lit model — the inverse of the old deep-ocean
"flat dark polygons against the dark" failure.

**Acceptance:**

1. ✅ Readable silhouettes without hunting — the p=0.156 capture shows a dozen; fish span the
   whole submerged band. One shape iteration was needed: the first wedge (1.2 long, 0.44 wide)
   read as tumbling black KITES; a fish is recognised almost entirely by elongation, so the
   3.5:1 re-cut with the widest point a third back from the nose is what made them fish.
2. ✅ Lane B cumulative: **5.96 / 6.03 ms p50, drift −0.066 (one tick), content-matched at 45
   draws** — the school's cost is below the timer's resolution, and the Wave 4+5 total still
   sits 1.7 ms UNDER the pre-wave 7.73 baseline (§8 cell max 8.5).
3. ✅ No new console warnings (the one hit is the pre-existing forest-theme prewarm timeout).

**Deferred, named, not hidden:** kelp (§3.4.4's second half — shelf-zone dressing near the
breach; nothing blocks it, it simply was not reached) and the orb helical drift (§3.4.5 —
touches `level-node-manager.tsl.js`, a system with its own recent history; doing it casually
alongside a fish wave is how regressions ship). Both are small, both stay on Wave 7's polish
list.

### Wave 6 — The crack climax (the last fifth of ch1, into the shipped quench)

> **/goal hook:** "Act I Wave 6: vault-mouth opening + cool shaft pre-seed + First Heart
> farewell pose + quench asymmetric density curve; capture the full 1→2 seam; hue-rate
> invariant holds outside the seam window."

- §3.5 crack pre-seed + the one open quench tuning note the closure recorded (approach-side
  density steeper — one constant in `odyssey-steam-quench.js`).
- **Acceptance:** seam capture sequence (`--seam 1-2`) shows: warm key yielding to cool
  shafts, quench closing later on approach than today, no hue cut outside the veil;
  colour-script tests still green (the pre-seed lives inside the cathedral→crack keyframes,
  not ad-hoc constants).

#### Wave 6 OUTCOME — DONE 2026-08-12 (two of four scope items landed and measured; two deferred, named)

**1. The asymmetric density curve — the One World closure's one open quench note — is in and
measured.** Approach side now `tri^1.4` against the exit's `tri²`, so density arrives sooner
where the old curve leaked: at the p=0.062 approach station (phase-locked), mean luma fell
**61.4 → 24.6** and the bright share (>96) to **0.001** — Act II's submerged blue no longer
reads through the veil while Earth Core is still on screen, which is precisely "the reveal
holds back". Exit unchanged by construction: leaving the weather fast into open water is the
breach's feeling.

**2. The warm→cool pre-seed, through geometry that already exists.** The chapter's god-ray
cones walk their tint from ember `0xff8a2e` toward a steel-pulled STEAM_COOL as `uSeam`
engages — zero new draws, zero new materials, and the target colour derives from the quench's
own constant so the pre-seed and the occluder cannot drift. Code-verified and eased on the
seam's own clock; **capture-occluded by design** (the walk lives at p ≈ 0.067–0.093, and by
the first station inside that window the veil is already opaque — the effect exists for the
moving crossing, which the seam pan shows as a continuous warm→white→cool read).

**3–4. Deferred, named:** the vault-mouth opening (column lean is authored geometry —
3b-class work) and the First Heart farewell pose (pure animation authoring; Calcifer grammar
is already proven in the study). Wave 7 polish list.

**Seam montage** (`artifacts/odyssey/wave-v/seam-1-2-high-webgpu/`): the crossing reads
billow → full white → open water, with the ribbon and orbs riding INSIDE the shell and the
Wave 5 fish visible through the thinning veil on the exit side — the act handoff as one
continuous motion. Colour-script tests green (36); console clean but for the pre-existing
forest-prewarm timeout.

### Wave 7 — Close the books (both lanes, budget cells, index)

> **/goal hook:** "Act I Wave 7: cooled both-lane splits at both stations; fill or
> re-budget the §8 cells; ADR-0017 filed; plan annotated closed-or-carried per item."

- Full re-measure per ADR-0016 (cooled, quiet, repeats) at p=0.051 and p=0.16, both lanes;
  the ch1 cell finally gets its baseline; Lane B's Act I story joins the §7.1 owner
  conversation with real numbers.
- **Acceptance:** `perf-budgets.json` cells resolved (baseline or explicit re-budget
  decision recorded); ADR-0017 committed; this document's §0 numbers annotated where
  superseded — the One World plan's closure style, applied from birth.

#### Wave 7 OUTCOME — DONE 2026-08-12. Books closed on what was measured; one flicker keeps two cells null.

**The four station×lane measurements on the finished-so-far build:**

| station | lane | pre-plan | now | status |
|---|---|---:|---:|---|
| underwater p=0.16 | A | 0.262 ms | **0.197 ms, drift 0.000** | real baseline |
| underwater p=0.16 | B | 7.73 ms | **5.96 ms, drift one tick, 45 draws matched** | real baseline → §8 cell |
| ch1 p=0.051 | A | 2.10 ms | 2.29–2.49 across a **VOIDED** pair | null, with reason |
| ch1 p=0.051 | B | 57.21 ms | 56.3–59.3 across a **VOIDED** pair | null, with reason |

**The void is a finding, twice over.** Both ch1 pairs failed the content-match guard the same
way: draw calls flicker **92 ↔ 93** at the pinned station on a time-driven cadence, so a
content-matched pair cannot exist there until the toggling drawable is found (candidates: the
lava-fall revealables or another time-gated `visible` write; it survives the pinned seek, so
it is clock-driven, not travel-driven). ADR-0016 worked exactly as written — two plausible
numbers were refused, with the reason published in the report.

**And the range that was refused still taught the plan something:** ch1's draws fell
**131 → 92** (decal merge) while Lane B stayed ~57 ms — **the chapter's iGPU cost is
fill/ALU-bound, not draw-bound.** Wave 3b's remaining consolidation must shrink emissive
SURFACE AREA (the same surfaces 3a identified as the mid-band), not just submissions. Recorded
in the cell notes so 3b aims at the right thing.

**Also closed:** `perf-budgets.json` carries the four `odysseyAct1*` cells (one real baseline,
three deliberate nulls with reasons); **ADR-0017 filed** (`docs/adr/0017-act-i-stays-a-diorama-
the-ocean-deepens-in-world.md`) recording the §4 decision with its evidence; the §0.2 evidence
table stands as the pre-plan record with this table as its successor.

**Carried forward, named:** Wave 3b (the one unchecked wave — sprite migration + world-anchored
rock shading + the ≤35 gate, now correctly aimed at fill); the ch1 draw-flicker hunt; kelp,
orb drift, vault-mouth, Heart farewell, pale-grade + crest-rim taste notes (the polish list);
the birth-station value question (§3a outcome).

---

## 7. Verification discipline for executing this plan

- **Playground-first for every visual iteration** (CLAUDE.md loop); overshoot for the
  NoToneMapping→ACES gap; in-game capture before any "done" (ADR-0007).
- **Per-chapter short capture sessions only** (TDR).
- **No perf number without the harness** (ADR-0016): station pinned, baseline+repeat,
  content-matched, quiet machine, `--out` so Act I runs never clobber the Act II lane
  reports.
- **Value-share and warm/cool gates run on every wave's captures** once they exist — they
  are this act's equivalent of the world's draw-call cell: the structural claim, held
  mechanically.

---

## 8. Budget — explicitly a hypothesis to falsify (per ADR-0016)

Proposed `perf-budgets.json` cells (Wave 0 adds them with **null baselines**; numbers enter
cells only from content-matched cooled runs):

| cell | baseline | max | note |
|---|---|---|---|
| `odysseyAct1Ch1GpuP50LaneAMs` | null | 1.0 | Rebuilt Earth Core at p=0.051, High/1080p. Today's diorama: **2.10 measured** — the max also fails if the rebuild is accidentally reverted (the Act II gate's trick). |
| `odysseyAct1Ch1GpuP50LaneBMs` | null | 5.0 | Today: **57.21 measured**. Max 5.0 is the hypothesis that the rebuild returns ~52 ms to the lane that is 2.9 ms over budget on Act II alone. The rebuilt-target number is ESTIMATE until Wave 3 measures; the saving's existence is not. |
| `odysseyAct1Ch1DrawCalls` | null | 35 | Today: 131 (MEASURED). The structural claim of the rebuild. |
| `odysseyAct1UnderwaterGpuP50LaneBMs` | null | 8.5 | Today: **7.73 measured** at p=0.16 — already over the lane's aspirational 7.0 before any new content, so a 7.0 max here would be theatre. Max 8.5 = the measured baseline + a hard ≤0.8 ms delta for the whole deepening (Waves 4–5), all of it size-capped additive and vertex-ALU by design. If measurement falsifies the delta, the mote/fish budgets shrink first, the bands never (they are ~free and they are the look). Whether the LANE ever meets 7.0 is §7.1's owner decision, and ch1's ~52 ms recovery is the biggest input to it. |

Lane B honesty, stated plainly: Act II already measures 9.90 ms p50 against the 7.0 contract
(§7.1 of the closed plan, owner decision pending). **Chapter 1 measures 57.21 ms on the same
lane — the worst frame in the journey by a factor of ~6, and a diorama-class number (the
legacy Act II dioramas measured 39.5–67.7 ms before their rebuild).** If Wave 3 lands the
ch1 rebuild anywhere near its ≤5.0 hypothesis, Act I stops being the lane's bottleneck and
the §7.1 re-budget conversation inherits ~52 ms of recovered floor. That prediction is one
this plan is happy to be graded on.

Startup: the material-object budget (≤10 for ch1) is the compile-time lever (today ~27
objects, 2.3 s warm-cache share measured once). No startup gate cell yet — Wave 0's cold
re-measure decides whether one is worth wiring.

---

## 9. Self-audit — the load-bearing premises, adversarially checked (2026-08-12)

Per the brief: every "X is only used by Y / X costs Z / X is dead" class claim in this plan,
with its evidence. The One World Wave 4/6 audit refuted 8/8 such claims when it finally ran;
this table exists so Act I's plan never gets to say that.

| # | Premise | Evidence | Status |
|---|---|---|---|
| P1 | Ch2's visuals on the default path come from the world; `deep-ocean.js` is suppressed | `ONE_WORLD_CHAPTERS = [2,3,4,5]` (`OdysseyBoardController.js:134`); suppression wiring at :647/:1808 | VERIFIED |
| P2 | Ch1 owns its frame; the world is hidden below p ≈ 0.063 | `odyssey-world-act-gate.js` (margin 0.03, with the do-not-raise note); board :2552-2559 | VERIFIED |
| P3 | The quench exists on the default player path and is seated at the 1→2 boundary, window ±0.06 | `aaaPostActive = cinematicJourneyActive` (:1698, with the init-catch caveat recorded in §0.4); creation :1815-1828; window `STEAM_QUENCH_HALF_WIDTH = 0.06` (:156), drive :2487-2493 | VERIFIED |
| P4 | Rebuilding earth-core in place touches no registry/pilot/validation contract | `registry.js` convention derivation + `chapter-registry-consistency.test.js` pins names, not contents | VERIFIED |
| P5 | Ch1 costs 2.10 ms / 131 draws (Lane A, High) and 57.21 ms / 127 draws (Lane B, Medium) today | gpu-split reports `gpu-split-lane{a,b}-act1-ch1.json`; Lane A drift 0.00; Lane B drift 0.33 on a 57 ms signal; each lane content-matched against its own repeat | MEASURED |
| P6 | Ch1 carries 17 live uOpacity bridges | grep count: 7 (`earth-core.js`) + 10 (`earth-core.tsl.js`); matches the One World audit's "ch1 ×17" | VERIFIED |
| P7 | Act I is outside the colour script today | `sampleColourScript` callers: world renderer (`:1056`, Act II mapping `0.05 + t×0.9`), its playground mirror (`odyssey-clipmap.effect.js`), and the script's own tests — nothing under `chapter-environments/`; ch1 reads `chapter-profile.js` statics | VERIFIED |
| P8 | The cavern cannot be a heightfield term | `odysseyWorldHeight(−3, 5) = 98.7` vs cavern span y ∈ [−52, 123] at the same XZ — single-valued function, two required values | MEASURED |
| P9 | The underwater stretch is p 0.093→~0.193 and ~90% of ch2 | path dump §0.1; breach crossing between p 0.190 (y 285.5) and 0.200 (y 294.2) | MEASURED |
| P10 | The rail-vs-floor crossing (p≈0.077) is inside the quench window | crossing from the same dump vs window 0.033–0.153 | MEASURED |
| P11 | "The underwater frame has headroom" | 45 draws / 0.262 ms A / 7.73 ms B MEASURED — headroom is real relative to Act II's 9.90 on the same lane, but the lane's 7.0 contract is already exceeded by the EMPTY frame; §8 budgets the deepening as a ≤0.8 ms delta, not against 7.0 | MEASURED, scoped |
| P12 | Cold-compile "ch1 = 2,336 ms" | single console sample, warm Dawn cache, Low quality — the weakest number in this plan, flagged in §0.2 and owned by Wave 0 | MEASURED-ONCE, quarantined |

Known unknowns carried openly: the cumulus-through-water mechanism (Wave 0 decides); the
true cold-compile split (Wave 0); every ESTIMATE-tagged cost in §3/§6/§8 (their waves
measure them); and the Lane B underwater p95/p99 tail (15–25 ms against a byte-stable
7.73 p50 — the §7.1 orb-tail suspect, owned by the Wave 7 cooled re-measure). One
measurement-session note for the record: the first Lane B underwater run produced an
inadmissible report (a baseline with zero samples, no repeat agreement) and was DISCARDED
and re-run rather than quoted — the re-run's two baselines agreed byte-for-byte.

---

## Sources

- In-repo, read end-to-end for this plan: `docs/ODYSSEY_ONE_WORLD_PLAN_2026-08.md` (method
  + cautionary record), ADR-0007 / ADR-0015 / ADR-0016, `world/odyssey-world-renderer.js`,
  `world/odyssey-world-height.js`, `world/odyssey-world-act-gate.js`,
  `odyssey-colour-script.js`, `chapter-environments/earth-core.{js,tsl.js}`,
  `composition/odyssey-steam-quench.js`, `composition/odyssey-cloud-bank.js`,
  `OdysseyBoardController.js` (world drive, quench drive, aaaPost), `registry.js`,
  `chapter-profile.js`, `scripts/odyssey-gpu-split.mjs`, `scripts/odyssey-chapter-capture.mjs`,
  `perf-budgets.json`.
- Measurements produced for this plan: `reports/odyssey-perf/gpu-split-lane{a,b}-act1-{ch1,underwater}.json`;
  `artifacts/odyssey/wave-v/chapter-0{1,2}-high-webgpu/` (captures + per-frame metrics).
- Reference images: `public/playground-refs/act1-ghibli-*` (19, official ghibli.jp
  free-use stills), `public/playground-refs/act1-game-*` (17, store/press stills). NOTE:
  per the assets-are-untracked convention, `git add` these explicitly if they should ship.
- Film/art: ghibli.jp gallery + free-use notice; *The Art of Nausicaä* (transmitted-light
  rig); *The Art of Howl's Moving Castle* production notes (Takeshige, Okui) via
  ghibli.fandom; Miyazaki Ponyo interviews (hand-drawn-animation.blogspot, Academy Museum,
  FIU JSR); sifrinsight Castle in the Sky and Boy and the Heron analyses; thegamer warawara.
- Games/tech: GDC Vault 1024643 (ABZÛ), 1017742 + slide capture (Journey sand), 1017799
  (Art of Journey), 1027375 (Ori WotW); Godot docs (ABZÛ fish vertex animation); 80.lv
  (ABZÛ, EUROPA); pcgamesn/unrealengine (ABZÛ underwater lighting); thegamer + nintendolife
  + wccftech (Ori); thisiscolossal + gamereactor + redbull (Gris — and the GDC-talk claim
  rejected); halisavakis (gradient mapper pattern); kidswithsticks (Ghibli-in-UE4 foliage
  normal transfer); ACM 10.1145/3214745.3214820 (Sea of Thieves wave SSS); Steam app
  2214880 (EUROPA).
- The nominated pen: "Hoshi-no-Tani · The Valley of Stars" (codepen.io/lentils801, pen
  019f9b4b-…; full source archived in the session scratchpad as `pen-live.html`) — film
  print grade, painted-water banding, quantised glitter, palette codegen.

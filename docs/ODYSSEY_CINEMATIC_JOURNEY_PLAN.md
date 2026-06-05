# Odyssey — One Cohesive Cinematic Journey: Path · Camera · Travel · Themes · Transitions

> **Goal.** The chapters are implemented. Now make the *whole* Odyssey ascent feel like **one deliberate, cinematic journey** — not eight good scenes assembled behind a glowing ribbon. Five things get refined, and — equally — **made to align with each other**: (1) the **path** layout and how it threads through each world, (2) the **camera** angles and framing around the path, (3) the **travel** — how the camera flows down the path across the whole journey, (4) the **chapter themes** redesigned to fit *into* the path-travel journey, and (5) the **transitions & timing** — seamless, well-timed hand-offs between worlds.
>
> **Method.** Work from **screenshots**. Capture a baseline reel of every chapter and every seam, **lock the design against what we actually see**, then change things one dimension at a time and re-capture. Plan first; no ad-hoc tweaks.
>
> **Relationship to [ODYSSEY_MODE_AAA_OVERHAUL_PLAN.md](ODYSSEY_MODE_AAA_OVERHAUL_PLAN.md).** That plan built the machinery (director spine, diegetic path, per-act camera, threshold breaches, atmosphere rig, audio reactor). This plan is the **finish-and-align pass**: it assumes that machinery exists (it does — see §1), turns it on, removes the seams *between the systems*, and tunes the five dimensions into one journey. It supersedes that plan's stale "current state" claims (§9).
>
> **North star (unchanged): Tetris Effect: Connected — Journey Mode.** One unbroken, breathing ascent where the path belongs to each world, the camera flows continuously, and the worlds dissolve seamlessly into one another with the music.

---

## 1. Plan from reality — where the code actually is today

A grounded survey of the current code (post-chapter-implementation) found the build is **much further along than the old plan's checklist says**, but the journey is **gated, half-wired, and unsynchronized**. The honest starting point:

| System | What actually exists today | The catch |
|---|---|---|
| **Conductor** (`OdysseyDirector`) | Real, allocation-free spine: blends 8 chapter atmospheres + per-act camera by `seamProgress`, smooths audio energy/beat, broadcasts post/path/node emphasis. [composition/OdysseyDirector.js](../src/rendering/odyssey/composition/OdysseyDirector.js) | **Dark by default.** Every consumer is fed `aaaPostActive ? directorState : null`, and `aaaPostActive` = `?odysseyAAA=1` only. In a normal session the conductor computes state nobody reads. ([OdysseyBoardController.js:1129-1197](../src/rendering/odyssey/OdysseyBoardController.js#L1129)) |
| **Diegetic path** | Per-chapter base/emissive color **and** 8 animated surface styles (lavaCrust…neonDataLine) via injected GLSL, director-driven flow + beat. [OdysseyPathRenderer.js](../src/rendering/odyssey/OdysseyPathRenderer.js) | Geometry is **identical for all 8 worlds** — one constant tube radius, no banking, no twist; the declared `path.widthScale` (0.9–1.05) is **dead data**. The path floats *in front of* each backdrop; nodes are even pushed +1 Z so it passes behind them. |
| **Per-act camera** | `ODYSSEY_CAMERA_PROFILES` (Origin 14/FOV58 · Living 18/60 · Beyond 24/66 · Transcendence 20/64), blended by the director; `triggerVistaBeat` pull-back/lift; seam beat; portal approach. | Per-**act** (4), not per-**chapter** (8). The follow offset is **world-axis fixed** `(0,−1,18)` and `camera.up` is forced world-up — the camera never rides the path frame. And it's gated: default FOV is a flat **60** for the whole climb. |
| **Threshold transitions** | `ChapterThresholdDirector` is **fully built and wired** — 7 named breach profiles (Steam Quench…Neon Snap), veil+ring+particles, sin envelope, billboarded to the boundary path point, fired from `_handleChapterSeam`. [transitions/ChapterThresholdDirector.js](../src/rendering/odyssey/transitions/ChapterThresholdDirector.js) | Gated behind `?odysseyAAA=1`. And the breach fires on a **different clock** than the music cut, the env crossfade, the path band, and the post flash (see §4). |
| **Chapter themes** | 8 rich environments. 5/8 anchor to the real spline via `getChapterPathRange()`. Ch5–8 use shared noise + audio reactivity. | **Two-tier split:** Ch1–4 use private noise and ignore the director (no reactivity); Ch5–8 react. **Ch1/Ch5/Ch6 are vertically detached** from the path (env centered 185 above / 231 below the camera). Heroes sit at z=−600…−900 as backdrops, not corridors. |
| **Travel** | Input-scrubbed (wheel/touch) + timed node-hops (`computeTravelDuration = 900 + |Δt|·2600`). Position smoothing is frame-rate-correct. | **No continuous flight.** Nothing advances on its own; the journey freezes the instant you stop scrolling. Pace never adapts per world. Magnetic friction is mistuned to **near-permanent**. Music drives sway/bloom but **never forward motion**. |
| **Atmosphere / sources of truth** | `OdysseyAtmosphere` = one graded dome + fog==horizon + light rig, director-driven. | A world's look/timing lives in **three+ ledgers** that can drift: `chapters.js environment{}` (legacy) vs `chapter-profile.atmosphere{}` (AAA); seam *timing* in `chapters.js boardTransition` vs seam *look* in `ODYSSEY_THRESHOLD_PROFILES` vs `profile.transitionOut` (a dead string). |
| **Capture harness** | [scripts/odyssey-aaa-board-capture.mjs](../scripts/odyssey-aaa-board-capture.mjs) (Electron, **WebGL**, drives `panToChapter`) + [scripts/odyssey-portal-transition-validation.mjs](../scripts/odyssey-portal-transition-validation.mjs) (timed reel + luma metrics). Board is plain `WebGLRenderer`. | No npm script, **no committed baseline**, captures **chapter starts only** (can't shoot mid-seam), fixed sleeps (can photograph half-loaded worlds), unpinned FOV. The old WSL/WebGPU capture caveats **do not apply** here (Windows + Chrome/Electron is enough). |

**Thesis.** Odyssey already has all the parts of one cinematic journey — it just doesn't run them as one. The work is **unification, not construction**: turn the conductor on, give the five dimensions a *single* shared frame/clock/source-of-truth so they move together, and shape the path/camera/travel/themes around the act of *traveling the route*.

---

## 2. The organizing idea — Four Unifications + One Current

Everything below serves one structure. These are the five levers that make path + camera + travel + themes + transitions cohere; each one is a place the dimensions currently **disagree**, made into a place they **agree**.

| # | Unification | What it aligns | One-line statement |
|---|---|---|---|
| **U1** | **One spine, always on** | themes ↔ camera ↔ path ↔ transitions ↔ audio | The director drives the **default** experience, not a `?odysseyAAA=1` preview. Nothing cohesive is possible while the conductor is muted. |
| **U2** | **One source of truth per world** | themes ↔ transitions ↔ path ↔ camera | A world's palette, path style, camera framing, atmosphere **and** its outgoing transition are authored in **one place** (`chapter-profile.js`), so a designer changes a world once and every system follows. |
| **U3** | **One path frame** | path ↔ camera ↔ travel | The camera rides the **path's own frame** (tangent/normal, stable up-vector, authored banking). As the spline turns, the path always recedes ahead instead of sliding across the screen. |
| **U4** | **One seam clock** | transitions ↔ travel ↔ path ↔ themes ↔ music | At a boundary, the env crossfade, the breach veil, the path color band, the post flash, the camera beat **and** the music crossfade are all driven by a single **position-based** `seamPhase` — they peak together, on the boundary, immune to scrub speed. |
| **U5** | **One living current** | travel ↔ camera ↔ themes ↔ transitions ↔ music | The journey **moves on its own** — a continuous, momentum-bearing, music-aware forward drift whose pace breathes per act (intimate in the core, slow & vast in space) and **ritardandos into each seam**. |

If U1–U5 hold, the five dimensions are no longer five — they're one ascent expressed five ways.

---

## 3. The five dimensions — current reality → target design → how it aligns

Each dimension states the **target design** (framed around the path-travel journey) and, explicitly, **how it stays in lockstep** with the others.

### 3.1 The Path — *the route that belongs to each world*

**Reality.** A 28-point Catmull-Rom spline (y −30→960, tension 0.3, arc ≈1633u). Climb profile: a **vertical launch** (Ch1/2, tangent.y≈1.0), a **long shallow diagonal** across the entire middle (Surface→Space, tangent.y dips to **0.10–0.51** for ~45% of the run), then a **vertical finale** (Ch7/8). One constant tube radius for all worlds; per-chapter expression is shader-only. Urban is the shortest world (~5–6% of arc) and a dead-straight column. ([odyssey-layout.js:13-42](../src/core/odyssey/data/odyssey-layout.js#L13))

**Target.**
- **Re-author the spline into 8 deliberate gestures with a climb that never flatlines.** Keep the vertical launch; give Surface a rolling undulation that still nets +y; make Mountains a **switchback ridgeline** (lateral zig-zag, steady rise) instead of a flat diagonal; make Sky a buoyant rising sweep; keep Space's grand lateral arc-over **but add y-rise so it climbs while it curves**; spiral Black Hole inward; **expand Urban** from ~5% to ~12% with a banked neon on-ramp finale. Target `tangent.y ≥ ~0.30` everywhere in the mid chapters. Author it live in [OdysseyLayoutEditor](../src/rendering/odyssey/OdysseyLayoutEditor.js) and serialize back — no hand-editing control-point literals.
- **Make the geometry per-world.** Consume the already-declared `path.widthScale`; add an **authored, stable banking frame** (parallel-transport up-vector seeded per segment) so the path presents its surface, not its edge, through the Space arc; optionally vary cross-section per style (faceted cairnRidge, ribbon-flat jetStream).
- **Thread *through*, not in front of.** Author 2–4 anchored set-pieces per chapter that intersect/frame the spline at known path-`t` (lava arches you pass under, kelp/light-shafts you weave between, a cloud bank you pierce, an asteroid you curve around) sampled via `getPointAt`/`getTangentAt`. Reconsider the node `+1 Z` rule so foreground occluders can pass *in front* for parallax.

**Alignment.** Spline shape is the substrate **camera** frames and **travel** paces, so it's locked early and everything calibrates to it (U3). `path.widthScale`/banking must agree with the **camera**'s path-relative offset (U3). The per-chapter set-pieces are authored by the **themes** dimension against the same `getChapterPathRange()` (U2). Re-author **keeps the level `t`-spacing even** so **travel** pace and node spacing stay predictable unless deliberately re-tuned.

### 3.2 The Camera — *framing that stays glued to the route*

**Reality.** Follow position = path point + a **world-axis** offset `(0,−1,18)`; `camera.up` forced to world-up; aim = path point ~0.02 ahead. Per-act distance/FOV exist but are **null unless `?odysseyAAA=1`**, so default FOV is a flat 60 and distance 18 for the whole climb. No banking into curves. The only upward bias is — backwards — a chapter-1 look-*down* (0,−26,0). Vista "arrival" beat is gated off and is a small pull-back, not a held reveal. ([OdysseyCameraController.js:1021-1058](../src/rendering/odyssey/OdysseyCameraController.js#L1021))

**Target.**
- **Ride the path frame.** Offset the camera behind/below along **−tangent** (+ path normal), and set `camera.up` from a **parallel-transported** frame (with a "gravity blend" so low chapters stay world-up-ish and near-vertical sections track the path). The path now recedes ahead through every turn instead of sliding across frame.
- **Un-gate per-act framing and make distance/FOV breathe** the close→vast→kinetic arc; consider promoting to **optional per-chapter overrides** so Earth Core ≠ Deep Ocean.
- **Bank into curves and look up the climb.** Derive a small roll from path lateral acceleration; add a **vertical look-bias** that grows with local pitch and act, so the aim tilts *up toward the goal* — replacing the chapter-1 look-down with a per-act vertical aim curve.
- **Calibrate FOV/distance to the path's physical scale** (the ~0.4–0.6u tube reads tiny at FOV 60/18u) and to each chapter's fog density so worlds are neither fogged-out nor empty.
- **Author a real arrival vista** composed on the chapter's **hero anchor** (magmaVault/heroSummit/heroPlanet/accretionDisk/citySpire): pull back, widen, **hold ~0.6–0.9s on the anchor**, then settle to follow — co-timed with the breach.

**Alignment.** Path-relative offset + banking require a **stable path frame** (U3) — couples to the Path dimension's authored up-vector. FOV/distance per act must agree with **themes** fog density (so the world is visible) and with **travel** so distance changes don't read as lurches across act seams (U1, U5). The arrival vista needs the **theme's** anchor world-position and must fire on the **seam clock** (U4).

### 3.3 The Travel — *a living current, not a scrollbar*

**Reality.** No auto-drive at all — pure wheel/touch scrub + timed node-hops; the journey freezes when input stops. Pace is world-uniform (never slow & vast vs tight & quick). Magnetic friction (radius 0.015 vs node spacing 0.0185) engages across **almost the whole path**, making everything feel sticky. Music never touches forward motion. Camera-pose blends are frame-rate-dependent. ([OdysseyCameraController.js:848-858](../src/rendering/odyssey/OdysseyCameraController.js#L848))

**Target.**
- **A unified `TravelModel` with velocity + momentum** (single source of forward motion): a smoothed speed in **world units/sec** (so the 10× arc-length disparity between worlds stops translating to 10× pace), an input impulse with inertia + clamp, optional **idle auto-drift** so the journey breathes even at rest. Node-select `pathTravel` becomes an override layer on top.
- **Per-act travel speed** blended by the director alongside `followDistance`: Origin brisk-but-intimate, Beyond **slow & majestic**, Transcendence kinetic — so vast worlds literally move slower.
- **Seam ritardando:** ease speed down into `seamStart`, push through with the existing forward dolly, settle past `seamEnd` — the camera *leads* the breach (U4).
- **Beat-synced drift:** a small clamped forward surge on the beat + energy-scaled sustained drift, so the soundtrack carries you upward.
- **Retune friction** to a true per-node ease (radius ~0.004 or a soft speed-well), and make camera-pose blends + FOV pulse **dt-corrected** so feel is identical at 60/120/144 Hz. Make same-chapter selection a short glide, not a jump-cut.

**Alignment.** Travel speed must co-vary with the **camera**'s per-act framing (wide framing + slow pace = vastness; U5). Seam ritardando duration must equal the **transition**'s `beatDurationMs` and span the **path**'s seam window (U4). Speed-coupled look-ahead couples to the **camera**. Beat drift reads the same director energy the **themes** and **transitions** react to (U1).

### 3.4 The Chapter Themes — *worlds the path travels through*

**Reality.** Strong content, but cohesion-breaking placement and a two-tier authoring split. **Ch1/Ch5/Ch6 are vertically detached** (sky-drift centers y≈625 vs path ≈440; cosmic-expanse y≈364 vs path ≈595; earth-core hardcodes center −30 vs path span −30…116). Heroes parked at z=−600…−900 as a proscenium with **empty foreground** — zero parallax. Ch1–4 use private noise and **ignore the director** (no reactivity); Ch5–8 react — the journey starts breathing only at the midpoint. Two atmosphere ledgers (`chapters.js` vs `chapter-profile.js`). ([sky-drift.js:687](../src/rendering/odyssey/chapter-environments/sky-drift.js#L687), [cosmic-expanse.js:368](../src/rendering/odyssey/chapter-environments/cosmic-expanse.js#L368))

**Target.**
- **Path-anchor every chapter.** Adopt the proven `getChapterPathRange(chapterId)` pattern for the three stragglers (Ch1/Ch5/Ch6) so the world re-marries the camera — the highest-leverage, lowest-risk cohesion fix.
- **Add a path-hugging mid-layer per world** (the literal answer to "fit *into* the journey"): corridor geometry built **along the spline frame** within ~30–80u of the route — ridge walls/cairns (Ch4), cloud banks you thread (Ch5), a debris/lens-gate gauntlet (Ch6), building faces + neon arches straddling the route (Ch8, by promoting the existing neon torus rings to true path-gates). Keep the distant heroes as silhouette backdrops; add the near layer for parallax on **both** sides. Templates already exist: Ch1's crater ring and Ch8's neon rail.
- **Unify the fidelity bar:** migrate Ch1–4 onto shared `odyssey-noise.js` and give them the same `directorState` reactivity hooks (lava on bass, caustics on energy, snow/aurora on mid) so the **whole** ascent breathes with the music, not just the back half.
- **One time-of-day arc:** collapse the two atmosphere ledgers into `chapter-profile.atmosphere` (U2) and author intermediate fog/horizon values across the two risky jumps (Ch3 daylight→Ch4 dusk; pre/post Ch6 black) so aerial perspective carries the eye continuously.
- **Scale density/extent to each chapter's real arc length** and act camera profile so long worlds don't feel sparse and short ones busy at constant travel speed.

**Alignment.** Env placement must match the **path**'s real world position (U3) — the ch1/5/6 fix *is* a path-alignment fix. The mid-layer is authored on the **path** frame and framed by the **camera**'s composition (U3). Reactivity reads the same spine the **transitions** and **travel** use (U1). The anchor world-positions feed the **camera**'s arrival vista (U4). Density couples to **travel** pace.

### 3.5 The Transitions & Timing — *one synchronized threshold*

**Reality.** The breach exists and is good — but it's split across **four+ clocks**. The threshold veil + camera dolly + path band + stinger + post flash fire at **`seamStart`** (time-based, `performance.now`); the **music hard-cuts** and the **vista beat** fire at the **midpoint** (`seamProgress≥0.5`); the env crossfade is **position-based** (`seamProgress`); the post flash decays on a **frame-rate-dependent** `×0.92` curve. The path color band uses a **different, wider, off-center footprint** (width 0.08–0.12 / head offset −0.35×0.18) than both the path-shader color seam (**hardcoded 0.012 t**) and the env crossfade (`seamWidth` 0.018–0.06). Declared `crossfadeDuration`/`transitionOutStinger` are **never consumed**. ([OdysseyBoardController.js:1344-1389](../src/rendering/odyssey/OdysseyBoardController.js#L1344))

**Target.**
- **One position-driven `seamPhase ∈ [−1,+1]`** = `(progress − boundaryPosition)/seamWidth`, and drive **all** levers from it — threshold `uProgress`, path band head/width, post boost, camera dolly+FOV, **and** music crossfade gain — so they peak together at the boundary (phase 0), share one footprint, and are **immune to scrub/reverse/slow travel**. A time fallback only when the player is stationary.
- **Real music crossfade bridge** synchronized to the seam (begin out-fade at `seamStart`, 50/50 at the boundary, complete at `seamEnd`), with the 0.4s procedural stinger as the accent on the peak. Consume — or delete — the dead `crossfadeDuration`.
- **Lock the path band footprint** to the env crossfade window (width ≈ 2·`seamWidth`, centered, symmetric) and **unify the path-shader color seam** to the same per-boundary `seamWidth` instead of the hardcoded 0.012.
- **Duration-lock the post flash** to `beatDurationMs` (sin in-out), not frame-decay.
- **Author one camera beat:** merge the breach-push (seam entry) and the arrival-vista (seam exit) into **two phases of one timeline** whose length = `beatDurationMs`, not a midpoint-fired hardcoded 1450ms.
- **Normalize seam rhythm:** derive `beatDurationMs` from `seamWidth` + local travel speed so the (breach time)/(crossfade distance) ratio is held constant — then *intentionally* bend it (accelerando toward Space, time-dilation at the Black Hole).
- **Promote the breach to canonical** (run regardless of `?odysseyAAA=1`, quality-scaled) so there's one hand-off experience.

**Alignment.** The seam clock **is** the **travel** position (U4) — requires the `TravelModel`'s seam ritardando. The band footprint = the **path**'s `seamWidth` (U4). Breach colors must pull from the incoming **chapter theme**'s key palette so the breach previews the next world (U2). The camera beat is the **camera** dimension's vista, on the seam clock. Music crossfade reads the **theme**'s declared durations.

---

## 4. The alignment matrix — where the dimensions disagree today, and the fix

This is the heart of the brief ("how they all align with each other"). Each row is a concrete, measured place two-or-more dimensions currently contradict each other, with the resolution and the unification it belongs to.

| # | Dimensions | The disagreement (measured) | Resolution | U | Pri |
|---|---|---|---|---|---|
| **A1** | all five ↔ glue | The entire spine (atmosphere, path style, node shells, reactivity, breaches, vista, filmic grade) is **off unless `?odysseyAAA=1`** — consumers get `null` ([:1129-1197](../src/rendering/odyssey/OdysseyBoardController.js#L1129)). | Make the conductor **default-on**; demote `?odysseyAAA=1` to the debug overlay only. *Precondition for everything else.* | U1 | **P0** |
| **A2** | themes ↔ transitions ↔ glue | A world's look lives in **two ledgers** (`chapters.js environment` vs `chapter-profile.atmosphere`) and a seam in **three** (`boardTransition` timing / `ODYSSEY_THRESHOLD_PROFILES` look / dead `transitionOut`). Kept in sync only by hand. | Collapse to **one** per-world object in `chapter-profile.js` (atmosphere + a rich `transitionOut{seamWidth,beatDurationMs,fxPreset,breach{…},stinger}`); legacy derives or asserts-equal via test. | U2 | **P0** |
| **A3** | path ↔ camera | Camera offset is **world-axis** `(0,−1,18)` + forced world-up while the spline heading rotates **~250°**; through the Space arc the path slides across/out of frame. | Path-relative offset (−tangent + normal) + parallel-transport up-vector. Camera rides the route. | U3 | P1 |
| **A4** | path ↔ camera ↔ themes | `path.widthScale` (0.9–1.05) is **declared but unused**; one constant tube radius through lava, ocean, and a black hole; no banking. | Wire `widthScale`; add authored banking; the camera presents the surface, not the edge. | U3 | P2 |
| **A5** | travel ↔ transitions ↔ themes ↔ camera | **No continuous motion**; pace is world-uniform; the per-act profile (Beyond `followDistance` 24 = "vast") is contradicted by constant scrub speed. | `TravelModel` with momentum + **per-act world-unit speed** blended by the director. | U5 | P3 |
| **A6** | travel ↔ transitions | Breach/stinger/post are **time-driven from `seamStart`**; env crossfade is **position-driven**; music + vista fire at the **midpoint**; post flash decays **frame-rate-dependently**. Four clocks. At `seamWidth` 0.06 (Ch4) the breach leads the music cut by up to seconds; a fast hop blows the 0.036 seam in ~3 frames while the 850ms beat just started. | One **position-driven `seamPhase`** drives every lever + a seam **ritardando** in the `TravelModel`. | U4 | P4 |
| **A7** | path ↔ transitions ↔ themes | Path-shader color seam = **hardcoded 0.012 t** (≈20u everywhere); env crossfade = `seamWidth` **0.018–0.06** (58–196u); path *band* = **0.08–0.12 / off-center**. At seam 3-4 the path recolors ~10× sooner than the world dissolves. | Single per-boundary `seamWidth` feeds path shader seam **and** band **and** env crossfade. One footprint. | U4 | P4 |
| **A8** | themes ↔ path ↔ camera | **Ch1/Ch5/Ch6 env geometry is vertically detached** from the path: +185u (Sky), −231u (Space), and Ch1 content sits far below its upper run. The path floats through empty space. | Path-anchor all three via `getChapterPathRange()`; audit `yStart/yEnd` to the true spline span. | U3/U2 | P2 |
| **A9** | themes ↔ path | Heroes at **z=−600…−900** are backdrops with empty foreground; **no parallax** either side of the route. | Path-hugging **mid-layer** per world (corridor geometry on the spline frame). | U3 | P5 |
| **A10** | themes ↔ glue ↔ transitions | **Ch1–4 ignore the director** (no reactivity, private noise); Ch5–8 react. The journey starts breathing at the ch4→ch5 seam — render *rules* change at a seam, not just content. | Migrate Ch1–4 to shared noise + `directorState` hooks; standardize the `update()` signature across all 8. | U1 | P5 |
| **A11** | transitions ↔ music | Music is a **hard cut at the midpoint**; declared `crossfadeDuration` 3000–6000ms is **dead**. A pop lands exactly when the visuals are doing a smooth crossfade. | Equal-power music crossfade on the `seamPhase` clock; stinger as the accent. | U4 | P4 |
| **A12** | camera ↔ travel ↔ all | Camera-pose blends (`0.1`), FOV pulse, and magnetic friction are **per-frame constants** (not dt-corrected); 144 Hz feels twitchy, 60 Hz mushy. | dt-correct all smoothers; retune friction radius 0.015→~0.004. | U5 | P3 |
| **A13** | path ↔ travel ↔ themes | **Urban is ~5–6% of arc** (a straight column); mid worlds are the longest; density is authored as fixed constants regardless of arc length, so long chapters feel sparse, short ones busy. | Rebalance arc spans in the re-author; scale per-chapter density to arc length + act. | U2 | P1/P5 |
| **A14** | glue (perf/correctness) | `resolveChapterBlendState` is computed **3× per frame** from 3 entry points; `director.update` runs **2× per frame**. Off-by-a-frame seam disagreement is possible at the most fragile moment. | Compute blendState **once** after `cameraController.update`, broadcast it; consumers stop recomputing. | U4 | P4 |
| **A15** | path ↔ transitions ↔ themes | Three different chapter color tables disagree (marker rings vs `getChapterColor` vs profile emissive); breach `primary/secondary` are hand-authored constants that will drift when themes are recolored. | One per-chapter color constant in the profile; breach colors derive from the incoming chapter key. | U2 | P5 |

---

## 5. Screenshot methodology — *work from what we see*

The platform reality: the Odyssey board is a plain `THREE.WebGLRenderer`, captured fine headless by Electron and **identical in Chrome on Windows 11 / PowerShell**. The old WSL/WebGPU caveats don't apply.

### 5.1 What exists to build on
- **[scripts/odyssey-aaa-board-capture.mjs](../scripts/odyssey-aaa-board-capture.mjs)** — boots `npm run dev`, opens a 1600×900 Electron window at `?…`, drives `boardController.panToChapter(id,1200)`, dumps `artifacts/odyssey/aaa-board/<variant>/chapter-<n>.png`. Env-parameterized (`AAA_FLAGS/VARIANT/PORT/CHAPTERS`). *No npm script yet; chapter-starts only.*
- **[scripts/odyssey-portal-transition-validation.mjs](../scripts/odyssey-portal-transition-validation.mjs)** — proves the **timed-reel** pattern: fly the camera, dump ~27 PNGs at `[0,40,…,4800]ms`, compute `meanLuma`/`blackCoverage` per frame. The model to copy for mid-seam shots.
- **Window hooks (all present):** `window.serenityBlocks.gameModeManager`; `odysseyMode.boardController.panToChapter(id,dur)`; `cameraController.panToPosition(0..1,dur)` for sub-chapter precision; `getCurrentPosition()` to read back exact progress.
- **`?odysseyAAA=1` debug overlay** — a live HUD stamping `ascentProgress / activeChapter / act / boundaryId+seamProgress / energy+bass+beat / camera dist+fov / post bloom+grade / path flow+glow` into the frame. Every screenshot self-documents.
- **`?odysseyEditor=1`** (DEV) — free-fly camera + transform handles for bespoke framings the scripted pass can't reach.
- `jimp@0.16` is already a dependency (montage/contact-sheet assembly is free). Dev server: `npm run dev` → Vite **5173**.

### 5.2 Harness upgrades to make (small, do first)
1. **`npm run capture:odyssey`** script + drive `panToPosition(pos, ~2200ms)` so **any** normalized 0..1 target is reachable (not just chapter starts). Always include `odysseyAAA=1` so atmosphere + thresholdDirector exist.
2. **Mid-seam reel mode:** for each boundary, position ~0.03 before it, `panToPosition(seamPos+0.03, 3000ms)` to cross, capture at a dense interval set straddling the breach peak; reuse the luma metrics to flag a black-frame gap.
3. **Gate on "environment ready,"** not a fixed 1700ms sleep (expose/await an env-ready signal) so heavy late chapters aren't shot half-loaded.
4. **Pin framing per shot:** 1920×1080, FOV-pulse frozen to a known value (e.g. `fov=60`, pulse off) for diff-comparability, plus an optional "pulse-peak" variant for camera-feel; stamp resolved `fov/followDistance` into a sidecar `metrics.json`.

### 5.3 The deterministic shot list (the baseline reel)

Computed from `chapterPositions` so a "chapter 5" shot is *exactly* the path's chapter-5 start.

| Kind | Targets (normalized progress) |
|---|---|
| **Chapter mids** | `0.046, 0.148, 0.278, 0.426, 0.574, 0.731, 0.879, 0.972` (Ch1…Ch8) |
| **Chapter starts** | `0.000, 0.093, 0.204, 0.352, 0.500, 0.648, 0.815, 0.944` |
| **Seam reels** (7) | each boundary above, reel at `0/300/600/850/1200ms` (and longer for the 1100ms Ch6 / 900ms Ch7 presets) across the crossing |
| **Whole-climb pan** | `panToPosition 0.0 → 1.0` over ~30s, sample every ~0.5s — evaluates continuous **travel** + path-through-world threading |
| **Diagnostics** | side-elevation of the entire spline (climb profile); top-down XZ plan (the arc-over); each chapter mid **twice** (FOV-pinned + pulse-peak); one "look back down the path" per act via `?odysseyEditor=1`; AAA-on vs default at the same point (to show how much the spine adds) |

### 5.4 Storage convention
- **Curated, committed** comparison sets under **`docs/odyssey-screenshots/`** (mirrors the committed `docs/theme-screenshots/` precedent) — `baseline/` for the first pass, `<phase>/` per iteration, + an `index.md` contact sheet (jimp montage).
- **Raw, regenerable** reels stay in `artifacts/odyssey/aaa-board/` (gitignored).
- Naming: `chapter-<n>-<slug>-{start,mid}.png`, `seam-<n>-<n+1>-<ms>ms.png`.

**Rule:** every dimension change is bracketed by **before/after** captures of the relevant shots; the contact sheet is the review artifact in the PR.

---

## 6. Phased roadmap — screenshot-first, design-before-change

Each phase is independently shippable and **opens and closes with screenshots**. Order respects dependencies: turn on the spine → settle the substrate (spline) → frame it (camera) → move through it (travel) → synchronize the seams → make the worlds fit → polish.

| Phase | Goal | Work | Screenshots / acceptance |
|---|---|---|---|
| **P0 — Baseline & harness** | A reproducible evidence base; **zero gameplay change**. | Harness upgrades §5.2 (npm script, `panToPosition` targets, mid-seam reel, env-ready gate, pinned framing). Capture the full §5.3 baseline reel to `docs/odyssey-screenshots/baseline/`. | The baseline contact sheet exists and is committed; every chapter & seam is captured fully-loaded; FOV-pinned shots are diff-comparable. |
| **P1 — Turn on the conductor + one source of truth** | Make the journey run through the spine **by default** (A1) and end ledger-drift (A2, A15). *Biggest single visible jump.* | Default-on director/atmosphere/threshold; `?odysseyAAA=1` → overlay only. Collapse atmosphere + seam timing/look into `chapter-profile.js`; legacy derives/asserts via test. Compute blendState once, broadcast (A14). | Default build now shows path styles, node shells, filmic grade, breaches, reactivity. AAA-on vs default captures **converge**. No regression on legacy. |
| **P2 — Lock & re-author the path** | The deliberate 8-gesture spline with a sustained climb (§3.1, A13); fix vertical detachment (A8). | **Design lock against baseline.** Re-shape control points in the editor; keep level `t`-spacing even; rebalance Urban; path-anchor Ch1/Ch5/Ch6 to the new spline. Keep `odyssey-path-layout.test.js` green. | Side-elevation shows `tangent.y ≥ ~0.30` through the mids; Urban lengthened; Ch5/Ch6 worlds now sit *around* the camera (re-capture chapter mids). |
| **P3 — Path + camera as one frame** | Camera rides the route (A3); geometry per world (A4); scale/look calibrated. | Path-relative offset + parallel-transport up + banking; wire `path.widthScale`; un-gate per-act framing (optional per-chapter); FOV/distance calibration; upward look-bias; dt-correct camera smoothers (A12). | Upper-spiral captures: path recedes ahead, doesn't slide across frame. Path reads as the screen's hero. Each act's framing is visibly distinct. |
| **P4 — Travel as a living current + one seam clock** | Continuous, paced, music-aware motion (A5, A12) and a synchronized hand-off (A6, A7, A11, A14). | `TravelModel` (momentum, per-act world-unit speed, idle drift, beat drift, friction retune, same-chapter glide). Position-driven `seamPhase` drives every lever; seam ritardando; music crossfade; post envelope; path band/shader-seam footprint = `seamWidth`; merge breach+vista into one beat; normalize seam rhythm. | Whole-climb pan shows pace breathing per act and slowing into seams. Slow-scrub vs fast-hop seam reels: breach, crossfade, path band, music **peak together**; no black-frame gap. |
| **P5 — Themes that fit the journey** | Worlds the path travels *through* (A9), one fidelity bar (A10), one time-of-day arc. | Path-hugging mid-layer per chapter; migrate Ch1–4 to shared noise + reactivity, standardize `update()` signature; author intermediate fog/horizon across the two risky jumps; density-to-arc scaling; arrival vista composed on hero anchors. | Chapter mids show parallax both sides of the route. Vertical horizon montage reads as one continuous gradient. The whole ascent breathes with music (not just the back half). |
| **P6 — Polish & calibrate** | Lock the feel; final per-chapter tuning. | Per-chapter camera/exposure/grade calibration; preset (Low→High) ladder for the new geometry/mid-layer/breach; final rhythm bend (accelerando to Space, dilation at the Black Hole); 60 fps verification. | Final contact sheet vs baseline, side-by-side, all 8 + 7 seams. Locked 60 fps at High. Sign-off. |

**Critical path:** P0 → **P1** → P2 → P3 → P4. P5 can begin once P2's spline is locked. P1 is the linchpin — **nothing cohesive ships until the conductor is default-on.**

---

## 7. Per-chapter cohesion notes

For each world: the one move that most makes it *belong to the traveled journey*, and its biggest current cohesion gap.

| Ch | World | Make it belong | Biggest gap today |
|----|-------|----------------|-------------------|
| **1** | Earth Core | Keep the crater-ring envelopment + look-into-the-bowl (the gold standard); extend lava-arch set-pieces up the path. | Content sits far below the **upper** run (env center −30 vs path to +116); not director-reactive. |
| **2** | Deep Ocean | Light-shafts the path **weaves between**; the surface ceiling tracks the real spline (already does). | Jellies/bubbles biased ahead/around, less below — partial envelopment; private noise. |
| **3** | Surface World | It's the model seam-author (foothill bridge + aurora preview into Ch4) — preserve and replicate that hand-off pattern. | Short/dense vs its long neighbors; bright daylight sky jumps to Ch4 dusk. |
| **4** | Mountains | **Switchback** the path through a ridge corridor with cairn markers either side; aim the arrival vista at the hero summit. | Peaks are a **far proscenium** (z=−650…−900); empty foreground; flat diagonal climb. |
| **5** | Sky & Drift | Thread the path **between cloud banks**; aurora rakes across the route. | **Env hangs ~185u above the camera** (A8) — top priority fix; flat traverse. |
| **6** | Space | A debris/lens-gate **gauntlet** the path curves through; add y-rise so it climbs while it arcs. | **Env sinks ~231u below; void dome barely reaches the camera** (A8); pure-black sky jump. |
| **7** | Black Hole | Spiral the path inward toward the lensed horizon; the breach dilates time here (rhythm bend). | Strong already; ensure the spiral reads as descent-into vs drift-past. |
| **8** | Urban Encore | Promote neon rings to **path-straddling gates**; building faces line the route; banked neon on-ramp. | **Shortest world (~5–6% arc), straight column**; city is a distant skyline, not a corridor. |

---

## 8. Risks & gotchas

- **P1 is load-bearing and the highest-risk change.** Default-on deletes the legacy atmosphere branch. Stage it: land the default-on flip behind a quick internal toggle, screenshot-diff AAA-on vs new-default to prove convergence, *then* remove the legacy branch. Keep the level-entry warp (`OrbPortalTransitionDirector`) and `odyssey-path-layout.test.js` green throughout.
- **Spline re-author touches the layout editor (2266 lines) and tests** that assert exact point positions. Positions are frame-independent, but any UV/normal-dependent visual baseline shifts with a new banking frame — re-baseline screenshots after P2/P3.
- **Two-tier chapter migration (Ch1–4) is shader work.** Match the shared-noise vocabulary exactly or the grain will *change* at the very seam we're trying to smooth. Migrate one chapter, screenshot-diff, then proceed.
- **Don't desync the seam clock during the transition.** While converting levers to `seamPhase`, keep a stationary-player time fallback or a lingering scrub will freeze the breach mid-envelope.
- **Performance:** the path-hugging mid-layer + banking + always-on breach add draw cost. Gate by the existing quality ladder (mid-layer LOD, particle counts, banking segments). The single-atmosphere consolidation is a net *reduction*; spend that budget on the mid-layer.
- **Capture fidelity:** always capture transitions with the breach **active** (it only exists when the spine is on); a "baseline variant" run silently omits seams. Gate on env-ready, not sleeps.
- **Audio-off must look right:** the macro arc can't depend on music. Add an **authored progress→intensity curve** (origin ~0.25 → transcendence ~0.85) combined with audio energy (`max` or weighted) so the ascent escalates act-to-act even in silence.

---

## 9. Stale claims this plan corrects (supersedes the AAA plan's checklist)

Verified against current code; the older plan's "current state" is out of date after the chapter reimplementation:

- ❌ "`transitions/ChapterThresholdDirector.js` — not done." → **Fully implemented** (7 breach profiles, veil+ring+particles, envelope, energy/beat reactive) and **wired** into `_handleChapterSeam` + `renderFrame`. Gated behind `?odysseyAAA=1`.
- ❌ "Uniform camera — one `followOffset`, one FOV for all chapters." → **Per-act `followDistance` (14/18/24/20) and `fovBase` (58/60/66/64)** exist and are director-blended; uniformity is a *gate* (default FOV 60), not a missing capability.
- ❌ "All 8 chapters set `music.track:'Ambient'`; zero audio-visual synergy; the board never touches the analyzer." → **Distinct per-chapter tracks** assigned; `OdysseyAudioReactor` drives bloom/grade/godray, path flow/glow, camera breathing, atmosphere light, breach intensity — **behind the flag**.
- ❌ "The diegetic path is a fixed orange→purple gradient." → **Per-chapter base/emissive + 8 animated surface styles** via injected GLSL.
- ❌ "WSL/Electron/WebGPU constraints block capturing the board on this machine." → The board is **plain WebGL**; it captures headless in Electron and renders identically in Chrome on Windows 11. No WebGPU, no WSL.
- ❌ "Ch5–8 are the thin placeholders; Ch1–4 are the rich baseline." → After reimplementation the consistency split is **the opposite**: Ch5–8 are the shared-noise, audio-reactive modules; **Ch1–4** are the private-noise, non-reactive legacy ones.
- ⚠️ Plan line references (e.g. camera seam-beat at `:740`) are **stale** after the reimplementation; use the refs in this document.

---

## 10. Open decisions to confirm before P1

These genuinely change the plan; recommended defaults in **bold**.

1. **Ship the conductor on by default?** **Yes — demote `?odysseyAAA=1` to the debug overlay.** Everything cohesive depends on it (A1). *If "keep as preview," the rest of this plan is moot.*
2. **Camera granularity — per-act (4) or per-chapter (8)?** **Per-act now, with optional per-chapter overrides** so Earth Core can differ from Deep Ocean without authoring 8 full profiles.
3. **Travel model — true continuous auto-ascent, or momentum-on-scrub?** **A living current: a gentle idle auto-drift + momentum + music drift, with wheel/stick nudging speed.** Closest to the Journey-mode north star; the alternative (scrub + momentum only) is the fallback if auto-motion tests poorly.
4. **Spline pacing — keep arc-uniform travel (even `t`-spacing) or hand-tune dwell time per world?** **Keep even `t`-spacing** (predictable pace + node spacing) and express per-world *feel* through per-act travel speed, not uneven node spacing.
5. **Atmosphere ledger — collapse to `chapter-profile.js`?** **Yes**, with a unit test asserting the legacy `chapters.js` values match (or are generated). One place to recolor a world.
6. **"Thread through" vs readability — may foreground geometry occlude the path/nodes for parallax?** **Allow brief, partial occlusion** of the path by mid-layer set-pieces, but keep the **current/next node** always readable (it's the interactive target).

---

### Appendix — key constants & positions (verified, for implementers)

- **Spline:** 28 control points, y −30→960, Catmull-Rom tension 0.3, arc ≈1633u. Climb `tangent.y`: ≈1.0 (Ch1/2) → **0.10–0.51** (Surface→Space, ~45% of run) → 0.74–1.0 (Ch7/8).
- **`chapterPositions`** = `[0, 0.093, 0.204, 0.352, 0.500, 0.648, 0.815, 0.944, 1]`. Ranges: C1 L1–5 · C2 6–11 · C3 12–19 · C4 20–27 · C5 28–35 · C6 36–44 · C7 45–51 · C8 52–55. Levels evenly spaced ~0.0185 in `t`.
- **Camera:** `followOffset (0,−1,18)` (z ignored; distance from `directorCamera.followDistance`, default 18). Per-act: Origin 14/FOV58 · Living 18/60 · Beyond 24/66 · Transcendence 20/64. FOV clamp [48,74], pulse ±8°. lookAhead `t+0.02`. Chapter-1 look-down `(0,−26,0)` faded over 0.035.
- **Travel:** `computeTravelDuration = 900 + |Δt|·2600` ms. `followLerpSpeed 0.03` (dt-correct). `positionBlend/lookBlend 0.1` (**not** dt-correct). `magneticRadius 0.015` (node spacing 0.0185 → near-permanent). No auto-drive.
- **Transitions:** `beatDurationMs` default 850 (Ch6 1100 heavy, Ch7 900 neon). `seamWidth` default 0.018 (Ch3 0.03, Ch4 0.06, Ch6 0.03, Ch7 0.022). Path-shader color seam **hardcoded 0.012**. Path band width 0.08–0.12, head offset −0.35×0.18. Music = hard cut at midpoint; `crossfadeDuration` 3000–6000ms declared, **unused**. Post flash = frame-rate-dependent `×0.92` decay.
- **Theme detachment:** sky-drift center y≈625 vs path ≈440 (+185); cosmic-expanse y≈364 vs path ≈595 (−231); earth-core center −30 vs path span −30…+116. Heroes z=−600…−900.
- **Capture:** dev server `npm run dev` → Vite **5173**. Hooks: `window.serenityBlocks.gameModeManager`, `odysseyMode.boardController.panToChapter(id,dur)`, `cameraController.panToPosition(0..1,dur)`, `getCurrentPosition()`. Overlay `?odysseyAAA=1`; free-fly `?odysseyEditor=1`. `jimp@0.16` available. Mid positions `[0.046,0.148,0.278,0.426,0.574,0.731,0.879,0.972]`.

# Odyssey — Best-in-Class Masterplan (2026-07-05)

> **This is the live umbrella plan for Odyssey.** It supersedes the planning function of the 20 prior
> `docs/ODYSSEY_*.md` documents (ledger in §10) while keeping two of them as standing references:
> **ODYSSEY_PERFORMANCE_MASTERPLAN_2026-06-22.md** (perf law — but see §1 for what has shipped since it
> was written) and **ODYSSEY_JOURNEY_CREATIVE_IMPLEMENTATION_PLAN.md** (art-direction law).
>
> **Provenance:** 6 parallel deep code-review agents (mode/gameplay, journey rendering core, per-chapter
> visual census, loading/warmup, perf-current-state, docs ledger) + 2 online research agents (2024–26
> three.js WebGPU engineering practice; journey-mode art direction: Journey, Sky, GRIS, Monument Valley,
> Alto's, Firewatch, Mario Odyssey, Peggle, saga-map research), all findings anchored to file:line in the
> current tree, cross-checked against commits `71f1a76` / `18bde04` and the live docs.

---

## 0.0 LIVE DIAGNOSIS + FIXES — "slow to start / low-res / less stunning than the theme" (2026-07-05)

User report (dev localhost:5173, browser, RTX 5080, DPR 1.5). 5-lens verify workflow + live chrome-devtools capture on the running board. **All root causes confirmed; resolution + fidelity fixes SHIPPED + live-validated.**

- **"30+s to start" = post-reveal background jank, not startup.** Board is visible in **~6s** (`[OdysseyStartup] total 5052ms | board visible 5921ms`; fast-start builds only focus±1 = ch1-2). Then chapters 3-8 stream module-load + cold compile + render-warm on the **main thread** for ~45s → the visible board stutters/feels frozen. Browser amplifiers: no persistent Dawn/GPUCache (every reload = full cold compile; Electron caches across runs), ~74 unbundled dev ES modules (build-only chunking). Root causes now **FIXED** (2026-07-05, verified vs three r181 source + live):
  1. **render-warm setPipeline race (the biggest waste)** — `_renderWarmChapterOffscreen` did a SYNCHRONOUS `renderer.render()` while the chapter's `compileAsync` (prewarm) was still building pipelines; the cache holds the pipeline object synchronously but `.pipeline` stays `undefined` until the promise resolves, and `WebGPUBackend.draw` only guards the error (not pending) case → `setPipeline(undefined)` throws. **FIXED**: gate the warm on `env.prewarmed===true` (bounded 6s grace) → warm never beats compile. Live: zero `render-warm failed` / zero `WARM-PROBE`.
  2. **the probe storm** — on each throw, `_probeWarmFailure` re-rendered the WHOLE scene once PER chapter drawable (~46/chapter × ch3/5/8 ≈ 138 stray full-scene main-thread renders) and ran UNGATED in normal play. **FIXED**: gated behind `debugOverlayActive` (`?odysseyAAA=1`).
  3. **no frame-health backpressure** — the single background gate `_canRunBackgroundTask` only checked interaction-idle + camera-settled, so 6 synchronous ~200-500ms chapter builds fired back-to-back at 60ms spacing while the board was already janking. **FIXED**: a cheap always-on RAW-delta frame-time EMA (`frameMsEma`, 33ms budget) added to the gate — a heavy build spikes the EMA → the gate closes → builds self-space until frames recover (with an 8s starvation escape + hidden-tab skip). Creation/prewarm/render-warm all funnel through this one gate.
  4. **the eviction `onRecreated` warm race** — the re-approach hook (default-OFF eviction path) queued the async prewarm then render-warmed SYNCHRONOUSLY in the same tick = a *guaranteed* (not merely racy) `setPipeline(undefined)` throw on every re-approach. **FIXED**: new `_deferRenderWarm` helper (bounded prewarmed-poll) replaces the immediate warm.
  Theme is ~1s because it's one scene, no 8-chapter background build. **STILL OPEN**: the monolithic per-chapter `def.create()` (splitting it to yield mid-build is the last, higher-risk lever).
- **"low resolution" = three stacked causes, ALL FIXED:** (1) `odyssey` pixel-ratio cap was the lowest scene type (High **1.1** vs theme 1.25) + extra `ODYSSEY_MAX_PIXEL_RATIO=1.2` → **raised to theme parity** (High 1.25 … Extreme 1.5) + MAX→1.5. (2) the 3 `computeScenePixelRatio` calls omitted `qualityTier` → browser locked to the High cap (Ultra/Extreme unreachable) → **now pass `this.qualityName`**. (3) ⭐ **the hidden killer**: `OdysseyAdaptiveQuality` recorded the main-thread-blocked background-load frames, misread them as GPU pressure, and **collapsed renderScale to 0.6** (pixelRatio 0.75, *below* the original 1.1) with an ~84s recovery climb → board read low-res **even at 222fps** → **now frozen until `_bgRenderWarmComplete` + skipped when `document.hidden`, with a `resetFrameWindow()` clean-restart.** Live-verified: pixelRatio **1.1→1.25**, backing 1881×1027→**2137×1167** (83% native), and it now **holds at full renderScale post-load**.
- **"less stunning" = the cinematic post stack the theme deliberately omits.** Manual ACES tonemap (compresses highlights, cool toe) + value-aware vignette + film grain + CA, vs summer's NoToneMapping/no-grade. **SHIPPED de-haze**: grain 0.022→0.012, vignette 0.40→0.30, CA 0.0015→0.0009 (crisper/cleaner, live-confirmed). **SHIPPED vividness pass**: master saturation 1.06→1.15 (counters the ACES desaturation; display-space + clamped = no blowout; hot chapters protected by their lower per-chapter `uChapterSat`) + warmed the cool teal-indigo shadow toe (0.06,0.10,0.16→0.09,0.10,0.13). Live-confirmed rich + clean on Earth Core (ch1, hottest) + Deep Ocean (ch2). **Still left** (bigger/riskier): softening the ACES curve itself (washes BRIGHT chapters like ch4 mountains toward beige — per-chapter exposure/grade tuning) + enabling MRT selective emissive bloom (`useMRT` never enabled).

Files: `desktop-performance-policy.js`, `OdysseyBoardController.js`, `OdysseyAdaptiveQuality.js`, `odyssey-post/odyssey-tsl-pipeline.js`. Build + lint + 17 board/policy/camera tests green. Memory: `odyssey-lowres-slowstart-diagnosis`.

---

## 0. Executive verdict

**Odyssey is far closer to best-in-class than the documentation trail suggests.** The subsystem has
already absorbed several disciplined engineering passes, and most of the "known problems" in project
memory are stale:

| Axis | Verdict |
|---|---|
| **Loading** | Mostly solved. Fast-start focus warm (default ON) replaced the ~21s full-journey warm; board is parked, not disposed (return-to-map ≈ instant); blackouts are readiness-gated; GLBs are meshopt-compressed (43MB → **4.2MB live across 7 files**). Three structural levers remain (§3). |
| **Performance** | Warm framerate was never the problem (~149fps). June's Waves 0–1 are DONE, Wave 2 is ~60% done (instanced cores default-ON, dome cull wired, LRU eviction **built but default-OFF**). The open core is GPU **fill** (path O(8)/pixel, ch6/ch7 noise domes) + compile breadth (§4). |
| **Visuals** | **The live capture (§0.5) is more sobering than the code census:** of 8 chapters, only **ch4 is unambiguously strong**; ch2 & ch7 are decent-but-flawed; **ch1, ch3, ch5, ch6, ch8 read weak** in-frame. The content mostly *exists* — it is undercut by camera framing, path over-luminance, flat billboards, and a few broken elements (dark node orbs, floating vegetation, hard-clipped auroras). So the AAA lift is mostly framing + figure-ground + fixing broken things, **not rebuilding chapters.** The per-chapter progress-scalar light narrative (uDepth/uSeason/uDusk/…) is still an unusually strong spine to build on (§6). |
| **Gameplay** | Two **real bugs** (double garbage seeding guts every dig/boss level; the level clock counts paused time and can insta-fail timed levels on resume) and a variety illusion: 3 of 8 victory types and effectively **2 of 7 modifiers** actually function across the 55-level campaign (§5). |
| **Structure** | Two god objects (OdysseyMode.js 5,834 lines with ~1,400 lines of inline DOM/CSS; OdysseyBoardController 2,656), a dead parallel UI component set (1,006 lines), duplicated seam-bridge tables in two files, and 20 overlapping plan docs (§7). |

**The doctrine for AAA:** stop polishing eight separate scenes. Author **one journey** — one intensity
curve, one color script, one protagonist (the journey-light), one motion tempo per biome, ceremonies at
thresholds, celebrations at completions — fix the correctness bugs, **flip ON the structural levers that
are already built**, and concentrate the freed budget into **one wonder per chapter**.

---

## 0.5 Empirical audit — live capture (2026-07-05, Chrome/WebGPU/RTX 5080)

Driven the real board via `window.odysseyMode.boardController.cameraController.setCurrentPosition(pos)` +
`renderOnce()` (the same path the live scroll uses), at discrete stations (TDR-safe — no continuous
journey scroll), with screenshots + geometry extraction. **This section is ground truth; where it
conflicts with the reviews above, this wins.**

### Measured facts
- **Cold start (warm Dawn cache):** activate→board-ready **6.3s**; fast-start correctly revealed with only
  chapters **[1,2]** resident (confirms fast-start works). First-run/cold-cache will be higher — a fresh
  baseline is still Wave-1 A7 work.
- **Chapter progress widths** (`chapterPositions = [0, .093, .204, .352, .5, .648, .815, .944, 1]`):
  ch1 **9.3%**, ch2 11.1%, ch3 14.8%, ch4 14.8%, ch5 14.8%, ch6 16.7%, ch7 12.9%, **ch8 5.6%**. The
  **finale (ch8) gets the least scroll of any chapter** and ch1 the second-least — the journey rushes its
  bookends.
- **Residency:** all 8 chapters loaded = **330 geometries + 24 textures** resident (the monotonic
  footprint eviction would cap — A6).
- **Path world extent:** y −30 → 1000, weaving X/Z. Progress→world mapping is **very non-uniform**: ch3/ch4
  the camera moves mostly sideways/into-Z (rising only ~60 world-y over a whole chapter) while ch5 climbs
  ~230. Uniform scroll speed therefore produces wildly different *felt* travel per chapter.

### The "path ends before the content" problem — quantified
For each chapter, world-Y content extent vs the path's Y coverage of that chapter's span
(`contentAbovePathEnd` = content top − path end):

| Ch | content Y | path Y (span) | content **above** path end | reading |
|----|-----------|---------------|-----|---------|
| 1 | −47…170 | −30…128 | +42 | fine (minor) |
| 2 | 118…287 | 128…297 | −10 | path covers it ✓ |
| 3 | 290…327 (Z to −1059) | 297…358 | −31 | fine vertically; deep Z backdrop ✓ |
| 4 | 264…**1191** | 358…424 | **+767** | peaks tower far above — intended distant, but camera is flat (3°) through the body |
| 5 | 297…**1149** | 424…655 | **+494** | much sky content above the path |
| 6 | 718…968 | 655…781 | +187 | moderate |
| 7 | 779…1034 | 781…917 | +117 | moderate |
| 8 | 958…**1671** | 917…1000 | **+671** | **finale spires tower 671u above where the journey ends, in 5.6% scroll** |

Content above the path is not automatically *unseen* (you look up at peaks/spires) — but it is only seen
if the camera pitch frames it, which leads to the next finding.

### Camera pitch is a rollercoaster (the user's "camera angle" concern, measured)
Pitch (vertical look angle) at entry/body/exit per chapter:

| Ch | entry | body | exit | note |
|----|-------|------|------|------|
| 1 | 82° | 82° | 85° | **stares nearly straight up the whole chapter** → the authored lava-basin *floor* (contentY −47) is never framed; we see the dark chimney ceiling |
| 2 | 87° | 77° | 29° | up→forward (dive to ocean) ✓ |
| 3 | 17° | 4° | 3° | flat across the meadow ✓ |
| 4 | 3° | 3° | 44° | **flat through the body**, only tilts up to the peaks at the very exit — the +767 hero peaks are under-framed mid-chapter |
| 5 | 69° | 69° | 40° | steep up at billboard sky |
| 6 | 29° | 35° | −3° | ends looking **down** |
| 7 | 8° | 80° | 76° | flat→straight up at the hole |
| 8 | 53° | 79° | 64° | steep up at spires (correct target) but rushed |

The swing (3°→87°) is partly intentional cinematography, but the **discontinuities at seams** (ch6 exits
−3° down → ch7 whips to 80° up; ch4 flat 3° → ch5 69° up) are a concrete source of the "seams feel like
theme changes, not one continuous world" complaint. And ch1's locked 82–85° up-stare + ch4's flat body
are cases where **the camera angle misses the chapter's own authored content**.

### Screenshot verdicts (all 8 chapters + a seam, representative stations)
> **Meta-finding (the most important line in this section):** the census scored the *code* (assets that
> exist in each chapter file → 4–4.5/5 for most). The captures score the *framed experience*, and it is
> markedly weaker: **only ch4 is unambiguously strong; ch2 and ch7 are decent-but-flawed; ch1, ch3, ch5,
> ch6, ch8 read weak.** The gap is not missing content — it is that **camera framing + path luma + flat
> billboards + a few broken elements (dark node orbs, floating vegetation, hard-clipped auroras) undercut
> content that is already authored.** That is *good news for scope*: the AAA lift is mostly framing (D9),
> luma/figure-ground (D2), and fixing a handful of broken things — **not rebuilding eight chapters.**

- **Ch1 Earth Core** — cluttered lower-left with **flat, untextured white obsidian crystals** + soft dark
  sphere-glows (the legacy Sprite/Points tech the census flagged); no clear hero; the up-stare wastes the
  lava floor. *Weak.*
- **Ch2 Deep Ocean** — clean and pleasant: bright caustic-lit surface seen from the deep, a glossy
  **bubble-pearl node that reads correctly** (highlight + speckle — unlike ch5's dark orb), a framing ring.
  *Decent* — but at the 81°-up body station its famed **manta/whale heroes are not in frame** (we see the
  ceiling). Even the benchmark chapter under-frames its own hero (a D9 case, not an asset gap).
- **Ch3 Surface World** — **weaker than the census's 3.5** (added after a follow-up capture): the
  **lime-green path is the single worst figure-ground offender in the journey** — a neon slab reading as a
  green wall, not a trail. Vegetation is cheap and partly broken: flowers render as thin white/pink/yellow
  *streaks*, low-poly conifers repeat, and **dark-green "lollipop" bushes + grass blades float
  disconnected in mid-air** near the path (placeholder/broken placement). Washed-out hazy yellow lighting,
  low contrast, vertical mist-streak artifacts — the old CH3-composition "washed/flat/focal-less" problem
  is **unresolved**. No prominent hero (the GLB nature-layer removal left it thin). *Weak tier — belongs
  with ch5/ch1.*
- **Ch4 Mountains** — **the model chapter**: atmospheric layered peaks receding into fog (natural
  distance-as-color), Tibetan prayer flags strung across the trail as a diegetic detail, clean leading
  line. *Strong* — but the white path is the brightest element in frame.
- **Ch5 Sky Drift** — **the messiest**: a huge **dark/black level-node orb** dominates center-right looking
  broken, **hard rectangular billboard clipping** (cloud sheets seen edge-on show their quad edges), a
  garish flat aurora band, doubled bright paths. *Broken/cluttered — confirms weakest-chapter verdict.*
- **Ch6 Cosmic Expanse** — **weak on capture (below its 4 census)**: a garish rainbow smear (the ch5
  aurora carry and/or a flat nebula) fills the left half, near-black void on the right, bright zigzagging
  path ribbons, dark node specks — and **no cosmic hero in frame** (no planet/black-hole/structured
  nebula). Reads as "flat rainbow + black space + zigzag path," not deep-space awe. *Weak — wants a framed
  hero (D1-ch6 supernova beat) and the nebula to have structure, not be a gradient smear.*
- **Ch7 Black Hole** — decent centered read (dark void + soft glow ring + magenta path spiralling into the
  singularity), but **the starfield is NOT lensed** — the defining phenomenon is still the deferred hook.
  *OK, wants its real hero.*
- **Ch8 Urban (finale)** — **anticlimactic**: ~60% near-black void, city is distant flat window-lit boxes
  clustered to one side, no towering hero despite 671u of spires above, and the shortest scroll of the
  journey. *The ending underdelivers.*
- **Seam 5→6** — **chaotic**: a rainbow aurora billboard with a **hard rectangular clip edge** ("square
  fake aurora", confirmed live), angular bright mountain shards intruding, dark blocky shapes, **multiple
  dark/black node orbs**, a bright splitting path. Many competing elements, hard edges, no hierarchy.

### Seam-by-seam transition audit (all 7 boundaries, live)
The crossfade **mechanics are sound** — every boundary does a clean symmetric weight blend (0.96→0.5→0.04
between the two adjacent chapters; no hard environment cut in the blend itself). The seam *system* works.
What varies is whether **content carries across, the color shifts cleanly, and the camera flows** — and
that splits the seven sharply:

| Seam | Grade | What the capture shows |
|------|-------|------------------------|
| **1→2** earth→ocean | **good** | manta heroes framed against the bright surface, warm ember-glow carries in from earth-core on the left, marine-snow atmosphere. (Minor: a hard diagonal dome-edge artifact top-left.) |
| **2→3** ocean→surface | **mediocre** | the "emerge from water onto shore" idea is there but reads as a **hazy overlay of 3 environments stacked** (ocean surface + meadow + translucent mountains), washed-out, floating vegetation, green path dominates, and a visible soft **circular "seam ghost"** (the crossfade envelope vignette). |
| **3→4** surface→mountain | **good (best)** | textbook ecotone: warm meadow → cool misty peaks (real color-script shift), path visibly crossfades **green→white**, snow-conifer + prayer flags **carry across** the boundary. The model to replicate. |
| **4→5** mountain→sky | **ok, camera tilts hard** | wide ecotone (blend starts early), but the camera ramps **3°→70° up** across it — a big, only-partly-motivated tilt. |
| **5→6** sky→cosmic | **poor/chaotic** | the worst — rectangular-clipped rainbow aurora, angular mountain shards, dark orbs, splitting path (above). |
| **6→7** cosmic→black hole | **dramatic but disorienting** | a hot-magenta path loops around the dark void + glow ring (striking), **but the camera yaw-whips ~127°** (71°→117°→−116°) *and* then tilts to 80° up at the ch7 body — a big turn-and-tilt reorientation, and the path is overwhelmingly the brightest thing; still no real lensing. |
| **7→8** black hole→city (finale) | **muddy** | more immersive than the ch8 body (a neon canyon between lit towers), but **dark-on-dark** (both chapters dark) so the arrival reads muddy, not climactic; the circular seam-ghost vignette recurs; fast crossfade into the 5.6%-wide finale = rushed. |

**Seam takeaways for the plan:** (1) the two *good* seams both **carry a physical element + shift color** —
that is the proven, cheap recipe (D3) to apply to the weak four. (2) The dominant transition failure is
**camera reorientation** (6→7 yaw-whip, 4→5 tilt), not the environment blend — a D9 concern. (3) A soft
**circular "seam ghost"** vignette from the crossfade envelope is visible at 2→3 and 7→8 — a concrete
artifact to soften/mask. (4) **Seam widths are inconsistent** (2→3 and 7→8 fast, 4→5 wide); the fast 7→8
into the compressed finale is the most cut-like. (5) The path out-brightens the world at every seam too.

### Three journey-wide findings the captures make undeniable
1. **The path/rail is the brightest, most saturated object in every chapter** (white in ch4, blue in ch5,
   cyan in ch8, magenta in ch7, and a **garish neon-green slab in ch3 — the worst of all**). The chronic
   "world > path > orb" luma-cap gap (D2) is not theoretical — it is visible in every frame, and in ch3 it
   actively breaks the scene. **Elevated to a Wave-2 must-fix; ch3's green path is the canonical test case.**
2. **Level-node cores render as dark/black spheres** in ch5 and at the 5→6 seam (should be glowing biome
   wisps). This is a real rendering bug, not art direction — a new P1 item (§2 #11).
3. **The bookend chapters are rushed** (ch1 9.3%, ch8 5.6% scroll) *and* under-composed (cheap ch1, empty
   ch8), so the journey opens and closes on its weakest frames. Rebalancing chapter widths + reframing the
   camera to catch each chapter's authored content is a new Pillar-D workstream (D9).

---

## 1. Verified baseline — what has ALREADY shipped (do not re-plan)

The single biggest planning hazard is re-proposing finished work from stale docs. Verified in the current
tree (July 5):

**Loading / lifecycle (shipped):**
- Fast-start focus-chapter warm, default ON (`OdysseyBoardController.js:284–296`; `?odysseyFastStartOff=1` reverts). Replaced the ~21s full pre-reveal warm (~5.5s/chapter through the post MRT).
- Compile-through-post-target (`_beginPostTargetCompile`, OBC:1139–1181): compileAsync bound to the live PassNode HalfFloat/MRT target — the canvas-format-pipeline trap is fixed and documented.
- Board **parked, not disposed** across level entry/return (OdysseyMode.js:191, 721–727, 3703–3720). Return = `resumeRendering()`. `?odysseyKeepBoard=0` reverts.
- Entry/return blackouts readiness-gated (`JourneyEntryTransition.js:357–386`); `maxBlackoutHoldMs` is an abort cap, not dead air.
- 17-sample seam-aware warm plan (`odyssey-warmup-plan.js`, pure + unit-tested) + background nearest-first offscreen render-warm (default ON, OBC:977).
- Persistent light rig: all chapter lights live in one never-hidden rig crossfaded by intensity → **no per-seam LightsNode pipeline recompile** (CEM:482–704). A genuine innovation; preserve.

**Assets (shipped — the "43MB uncompressed / 33.8MB dead" story is over):**
- Dead ~25–33MB ch3 Quaternius GLBs deleted (`chapter-03-quaternius-assets.js` → `ASSET_MODULES = {}`).
- Live payload: **7 meshopt-compressed textureless GLBs, ~4.2MB** (manta 4.52→0.86MB, whale→0.81MB, goldfinch 854KB, swallow 778KB, 3 conifer LODs ~950KB), lazy `?url` fetch, parallel manta+whale load. KTX2 loader wired (moot while GLBs are textureless). `_originals/` = 19MB local-only, un-globbed.

**Perf (shipped since the June-22 masterplan, commits `71f1a76` + `18bde04`):**
- **L6** 55 inner orb cores → one InstancedMesh + DataArrayTexture icon atlas, **default-ON** (−54 cold-start pipelines; LevelNodeManager.js:44–50). Whole 55-node orb field ≈ **6 draw calls**.
- **L8** global-dome cull wired (OBC:1898–1903, seam-safe, `?odysseyDomeCullOff=1`).
- **Chapter LRU eviction fully built** incl. shared-GLB-cache-aware disposal + `onRecreated` re-warm hook (CEM:802/888) — **but default OFF** (`?odysseyChapterEvict=1`).
- Earth-core: 11 byte-identical obsidian column materials → 1 shared (`earth-core.js:1053–1057`).
- rAF delta clamp 0.05s; 30Hz position-work throttle when settled; visibility-gated ch2 bubble upload; quarter-res 3-mip bloom; ch6/ch7 octave trims to 3–4; sparkle cloud 128→96/node (**5280**, not the remembered 7040) with dirty-gated uploads; dead post files deleted.

**Corrected numbers for all future planning:** campaign = **55 levels** (not 56) · sparkle cloud = 5280 ·
live GLBs = 4.2MB / 7 files · cold-start frame-spike baseline p95 3406ms / p99 8281ms (pre-fast-start
measurement; **no post-fast-start baseline exists — capturing one is Wave-1 work**).

---

## 2. P0 — Correctness defects (fix before any polish)

| # | Defect | Evidence | Fix |
|---|---|---|---|
| 1 | **Starting garbage rows seeded TWICE** — engine `seedStartingRows()` (GameplayHybridEngine.js:114/127–153) *and* `OdysseyMode._addStartingRows` (OdysseyMode.js:2317–2319/2330–2377) both run; hole patterns intersect so ~90% of seeded rows start **full** → first lock mass-clears them, gutting every dig/boss level (6/26/38 + hybrids). | critical, code-confirmed | Delete the mode-side call + dead method; keep the deterministic engine path. One live run to confirm. |
| 2 | **Level clock counts paused time** — `elapsed = Date.now() − levelStartTime` (OdysseyMode.js:5318–5330); `levelStartTime` never rebased on resume → silently costs time-star tiers everywhere and **insta-fails** the 17 `failure.type:'time'` levels after a long pause. | major | Accumulate `pausedMs` on resume (or tick only while unpaused). |
| 3 | **Modifier illusion** — `combo-multiplier` advertised on 33/55 levels is a **scoring no-op** (ModifierStack.js:46–66 sets flags nobody reads); `speed-up`, `mirror`, `invisible` defined but never consumed. Real pool: gravity-cascade + time-attack. | major | ✅ **RESOLVED 2026-07-05** — combo-multiplier/speed-up/mirror WIRED (gated in shared physics + input choke point), invisible RETIRED. Tested + build/lint green. See §5 C2 STATUS. Back-half authoring still open. |
| 4 | **Dev backdoor ships to prod** — `window.testOdysseyLevel` (persists unlocks to the real save) + `window.odysseyMode` defined unconditionally (OdysseyMode.js:339–345) while `_syncSteamStats` uploads total stars → leaderboard console-gameable. | major | Gate behind `import.meta.env.DEV` (the `odysseyEditor` flag at :58–69 is the template). |
| 5 | Stats integrity — `totalPlayTime` double-counted (per-level + whole-session, OdysseyStateManager.js:349/445); failed attempts never persisted (`recordAttempt` write-only). | minor | Pick one accounting; persist attempts. |
| 6 | Camera roll is a **dead feature** — breathing roll + authored portal-approach roll write `camera.rotation.z` *before* the trailing `lookAt()` rebuilds the quaternion (OdysseyCameraController.js:1099 vs :1134/:1873). Already-authored AAA polish, currently invisible. | minor | Apply roll as a quaternion multiply about the view axis *after* `lookAt`. |
| 7 | `ChapterEnvironmentManager.dispose()` skips textures/uniform-textures/RTs (CEM:1554–1587) — the eviction path's own teardown is the correct superset; adopt it for full dispose too. | minor | ✅ **RESOLVED 2026-07-05** — extracted the eviction walk into `_freeEnvironmentResources(env)`; both `disposeChapterEnvironment` and `dispose()` call it. Full teardown now frees textures/uniform-textures/RTs it leaked AND skips `fromSharedGltfCache` (was disposing the shared manta/whale/conifer cache → broke them on next entry). Build green, CEM suite unchanged. |
| 8 | Results modal is mouse-only (`Continue`, OdysseyMode.js:5062) while the failure modal has full keyboard support. Most-pressed button in the mode. | minor | Enter/Space/Esc parity. |
| 9 | Untracked 1200ms park `setTimeout` in entry transition (OdysseyMode.js:721–727) can race a fast return; `_getPhysicsCallbacks()` rebuilds the whole wrapped-callback graph on **every** hard/soft-drop keypress (:5374–5388). | minor | Track + guard the timer; build callbacks once per level. |
| 10 | `LevelRegistry.validateLevel` omits `'tetrises'` from validTypes (LevelRegistry.js:397) though the evaluator supports it. | minor | Add it (enables §5 variety work). |
| 11 | **Level-node cores render as dark/black spheres** — captured live in ch5 body and the 5→6 seam: node inner cores show as large dark spheres instead of glowing biome wisps, wrecking focal hierarchy (a dark blob becomes the biggest object on screen). Likely the instanced-core atlas (`?odysseyCoreInstanced`, default-ON) or node glass at certain chapter light states. | **major, capture-confirmed** | Repro at ch5 (pos≈0.574) with `?odysseyCoreInstanced=0` to isolate the atlas vs the glass; fix the dark path. Retest all 8 chapters' node cores. |

---

## 3. Pillar A — The Instant Journey (loading & warmup)

Cold start is now dominated by three **structural** issues, not raw asset weight:

- **A1 — Focus-centered eager window** *(high/small)*. `_computeEagerStartupChapters` returns the PREFIX
  `1..furthest+1` (OdysseyMode.js:3409–3431) — a chapter-7 player creates AND compiles **all 8 chapters
  before reveal**. Change to `focus−1..focus+1` (clamped); the existing background loader handles the
  rest. Cold start currently *regresses with player progression* — this kills that.
- **A2 — Lights BEFORE the compile pool** *(high/small — potentially the single biggest cold-start lever)*.
  `setupLighting()`/`setupDirector()` run at OBC:680–681, **after** every chapter `compileAsync` captured
  its render state (:568–584). WebGPU pipelines specialize on the light-set hash — the pooled compiles
  likely build the *wrong* pipeline variants, which explains why first-render warm stayed ~5.5s/chapter.
  Reorder, then re-measure.

  > **STATUS (2026-07-05 — IMPLEMENTED behind a flag, awaiting cold-boot A/B):** Shipped opt-in via
  > **`?odysseyLightsFirst=1`** (default OFF → shipped path byte-identical). Two coupled reorders, both
  > required because the persistent rig only "keeps the light set constant" once *every* chapter is built:
  > (1) **hoist the atmosphere light rig** — `new OdysseyAtmosphere` (1 ambient + 2 directional globals)
  > now created *before* the chapter compile loop via the new `_createAtmosphereLightRig()`; `setupDirector()`
  > reuses it if present. (2) **two-pass loop** — create ALL chapter environments first (reparenting every
  > chapter's 2–4 lights into the rig), THEN launch all `_prewarmChapterEnvironment` compiles, so each
  > pipeline specializes on the final ~23-light set it actually renders with (a single interleaved pass
  > compiles ch1 before ch2..8's lights exist → first render re-specializes on the grown hash). Verified
  > safe solo: `createChapterEnvironment` never reads `atmosphereOwned` (only update-time fog/clear at
  > CEM:1368/1546), and the atmosphere constructor adds only a dome + 3 lights (no `scene.fog`) → hoisting
  > doesn't perturb chapter creation. Build + lint + board/camera suites green. **NEEDS: a true COLD Electron
  > boot A/B** — warm Dawn cache hides the compile cost. Protocol: boot baseline (no flag) and
  > `?odysseyLightsFirst=1` back-to-back, compare the `[OdysseyStartup] … | compiles X | warmup Y` line
  > (hypothesis: `warmup` drops sharply; `compiles` may rise as the correct-hash pipelines pay their cost
  > up front; `total`/board-visible nets lower). If confirmed → flip the flag default-ON.
- **A3 — Barrier only on the focus chapter** *(high/small)*. `await Promise.all(compilePool)` (OBC:697–700)
  gates reveal on ALL eager chapters, but fast-start only warm-renders the focus sample — the non-focus
  compiles are pure pre-reveal wait. Await focus(±1); drain the rest into the existing background queue.
- **A4 — Dawn-cache-aware warm gating** *(medium/small)*. Chromium/Electron's Dawn disk cache makes
  pipeline compilation largely a **first-run** cost. Persist a flag keyed on app version + GPU adapter;
  on warm runs shrink the warm replay (fewer samples / lower res) instead of paying full price every boot.
- **A5 — Low-res warm renders** *(medium/small)*. Warm passes exist to *compile pipelines*, not to look at
  — render warm samples at tiny resolution (e.g. 32×32 offscreen) where the target permits.
- **A6 — Flip chapter LRU eviction default-ON** *(transformative/small — the #1 residency lever)*. The
  machinery is complete, careful (1-evict/1-create per tick, seam-protected, shared-GLB-safe, re-warm
  hook) and capture-confirmed — and helps **no real player** while default-OFF. A/B live with
  `?odysseyChapterEvict=1` (verify no re-approach hitch), then default ON with a VRAM/GPU-class gate.
  Also close the June "1b vs 1c" decision: capture real VRAM parked-during-gameplay on the iGPU with a
  heavy theme; if pressured, add the 1c partial-dispose (post RT chain + chapter textures on park).
- **A7 — Measured baselines in-repo** *(medium/small, do FIRST in the wave)*. No post-fast-start cold-start
  capture exists anywhere; OBC:2123 still says "~22s". Two cold boots (fresh save; chapter-7 save) →
  paste `[OdysseyStartup]` summaries into `docs/perf-captures/odyssey-startup-2026-07.md`. Every lever
  above gets ranked by real numbers; the stale loading doc gets corrected in the same edit.
- **A8 — (Later, large)** Single shared WebGPURenderer across board + gameplay themes — kills the second
  device/swapchain, shares the pipeline cache, and removes the dual-residency TDR exposure. Sequence after
  A1–A6 prove insufficient; high-risk change.
- **A9 — Trim the 1.5s overlay floor** (`minOverlayDisplayMs`, OdysseyMode.js:3370–3375) to ~700–800ms —
  on warm re-entries the floor IS the wait.

**Targets:** cold start (fresh save) reveal < 3s on the RTX 5080 / < 6s cold-cache; chapter-7 save within
0.5s of fresh-save; return-to-map < 1.5s perceived; zero visible-frame compile hitches on first scroll.

---

## 4. Pillar B — The Flawless Frame (runtime perf)

Open items, ranked (draws from the June-22 plan §8 minus what shipped):

- **B1 — Path O(8)/pixel → per-segment gate or 1-D LUT** *(high/medium)*. The always-visible path outer
  tube evaluates `chapterAt()` (7-step crossfade over 8 chapters) + `stylePattern()` (builds all 8 style
  expressions) **per fragment** (odyssey-path-renderer.tsl.js:343–344, also :453/:532) — in every chapter,
  the only cost that grows with chapter count. Preserve the seam crossfade band (only 1–2 chapters are
  ever co-visible).
- **B2 — Bake ch6 void dome + static far starfield → cubemaps** *(high/medium)*. ~26 octaves ≈ 208
  hash/px on a full-screen r2400 backstop → one texture sample. The single biggest fill win. Minor-visual;
  capture-gated.
- **B3 — Ch7: fold `ambientWash` into `voidDome`** *(high/small)*. Two stacked full-screen noise domes
  (black-hole-transcendence.js:571/578) ≈ 30 oct/px; the fold removes an entire full-screen additive pass.
  Ch7 is also the additive-overdraw champion (17 additive systems, ~2,350 live additive quads) — add a
  device-safety cap on its additive tier count.
  > **ATTEMPTED + REVERTED 2026-07-05 (capture-caught regression).** Merging the wash's floor+fresnel into
  > the void dome and deleting the wash mesh **regressed the corridor to RGB-black** at the frame edges —
  > because the `ambientWash` is *re-centred on the camera every frame* to always fill the screen, while
  > the `voidDome` is *world-anchored* (fixed z), so where the fixed dome doesn't cover the corners those
  > pixels fell back to black (the exact crush the wash exists to prevent). The two domes serve different
  > roles and can't be merged as-is. A real B3 requires making the **void dome itself camera-enveloping**
  > (reposition on the camera each frame) so one enveloping dome can carry both the world-anchored nebula
  > structure and the anti-black floor — or, cheaper, just reduce the wash's octaves/geometry rather than
  > removing the pass. Screenshot-verified the regression; reverted (functional code restored, note left in
  > both files).
- **B4 — Ch5 collapse: 6 cloud strata→1, 6 aurora curtains→1, 3 god-ray fans→1 (instanced)** *(high/medium)*.
  sky-drift.tsl.js still builds ~10 individual Mesh+material pairs → ~13 fewer compiles, ~12 fewer draws,
  zero-visual. Same pattern later for ch8 traffic/rails/signs and ch3 birds/butterflies.
- **B5 — Selective emissive-MRT bloom** *(medium/medium — chronic gap, proposed in 5 docs)*. `useMRT`
  defaults false and is never passed (odyssey-tsl-pipeline.js:162) though the branch is plumbed; the ~9
  per-chapter `emitsBloom` tags are dead. try/catch with threshold fallback (e-d-v3 pattern). Also alloc
  BloomNode at `_nMips=3` (kills the 4 dead 1×1 RTs) and re-tune additive brightnesses after.
- **B6 — Scroll/seam-aware pre-shed** *(medium/small)*. Adaptive quality is reactive-only (1Hz, 6/12s
  hysteresis) — feed it `cameraProgress` velocity + `blendState.inSeam` (both already computed at
  OBC:1917) so it sheds BEFORE the seam double-render spike. Wire the orphaned
  `corridorField.setQualityScale` (odyssey-corridor-field.js:650, zero callers) + dome cull as tier knobs.
- **B7 — Zero-alloc patches** *(low/small)*: board-owned `getBlendState` scratch (OBC:1870 → CEM:1157);
  scratch vectors for `getPathDataAt`/clones in `computeFollowFrame` (OCC:1649–1674); throttle free-cam
  `findNearestPathPosition` (241-sample scan **per mouse event**, OCC:1492–1523) to once/frame.
  > **STATUS 2026-07-05 — `computeFollowFrame` scratch SHIPPED** (build + lint + 12 camera/board tests green;
  > byte-identical → no capture needed). The always-on camera follow no longer allocates ~6 `Vector3`/frame:
  > `cameraUp`/`camPos` clones now reuse `this._frameCameraUp`/`_frameCamPos`, and the look-ahead
  > `getPathDataAt(lookAheadT, …)` now writes its position into `_frameLookTarget` + sinks its 3 unused
  > tangent/normal/right into one shared `_frameThrow` (all four were fresh allocs). Aliasing-verified safe:
  > `updateFollowPosition` (the sole caller) copies/lerps the returned vectors into persistent targets
  > synchronously and never retains them, and the reused scratch stays distinct from the live `_frame*`
  > frame vectors. STILL OPEN in B7: `getBlendState` board-owned scratch (memory flags a real aliasing
  > risk — result is threaded to multiple consumers; needs care) + the free-cam `findNearestPathPosition`
  > throttle (free-cam is a niche/debug mode, low value in normal play).
- **B8 — Node buffer per-node indirection** *(medium/medium)*. Idle auto-drift advances progress every
  frame, so the QW11 upload gate re-flushes 5280 particles × 3 attributes every 1–3 frames. Store per-node
  data once (55-entry vec4 array / DataTexture) indexed by a per-particle node-index attribute; move the
  bob into TSL. Idle upload → 55 vec4s.
- **B9 — Culling hygiene + progress-gated system sleep** *(medium/medium)*. ~100 `frustumCulled=false`
  sites (surface-world.tsl.js 20, earth-core.js 17) vs 2–3 per reference theme. Re-enable on bounded
  set-pieces. Chapters already compute a local progress scalar — use it to `visible=false` systems outside
  their authored window (ch2 vent glow, ch4 aurora pre-reveal, ch2 skylight panes…).
- **B10 — Finish the archetype-material registry** *(medium/medium)*: ch1 molten pockets (~20 → 2), ch3
  conifer mats 6→3, ch4 hero peaks 3→1, ch6 rings. Target < 60 cold-start compiles (from ~150+). Audit
  duplicate compute pipelines per three.js bug **#32735** (compute cache keyed by node instance —
  structurally identical per-chapter kernels compile twice).
- **B11 — Evaluate (don't commit): TRAA + continuous DRS during scroll** — official TRAA node exists
  (r180+); DRS during scroll (motion hides softness) recovering at rest, composited with TRAA. Also
  per-object occlusion queries (`object.occlusionTest`, shipped in WebGPURenderer) for dense in-view
  subsystems. **Watch upstream, don't build on:** indirect draws.

**Do NOT:** collapse the 4 post output variants (shipped optimization); full-journey headless captures
(TDR); TAA on the gameplay board.

---

## 5. Pillar C — A Correct, Varied Game (gameplay & progression)

- **C1** Fix §2 items 1–2 first (they gut level design today).
- **C2 — Make the variety real** *(transformative/medium — mostly data + small wiring)*. The
  tags→difficulty-model→derived-tuning pipeline is excellent and test-guarded; the content on top is thin:
  primary victory = 3 of 8 supported types (lines 22 / score 20 / cascade 14); working modifiers = 2 of 7.
  Wire `combo-multiplier` into scoring; implement `invisible` (renderer honors `piece.fadeOutTime`),
  `mirror` (input map), `speed-up` (gravity scale) — or delete them from 33 levels' data. Then author the
  back half of the campaign to actually use combo/tetrises/time-survival primaries and the richer pool.
  Add `'tetrises'` to LevelRegistry validTypes (§2#10).

  > **STATUS (2026-07-05 — wiring SHIPPED, authoring still open):** The four dead modifiers are now
  > resolved. The wire points were mapped by an adversarial multi-agent pass (all recs verified):
  > - **`combo-multiplier` WIRED** (flagship, 33 levels). Root cause was two gaps: nothing multiplied
  >   score by `comboMultiplier`, **and** `comboCount` was never maintained (the old ModifierStack
  >   wrapper read an always-unset field and ran after the clear). Fixed in shared `physics.js`, all
  >   gated on the Odyssey-only `comboMultiplierEnabled` flag: score award (~L813) and perfect-clear
  >   bonus (~L935) multiply by `comboMultiplier`; a per-lock counter block (~L974, after the cascade
  >   loop so it runs on non-clearing locks too) does `comboCount = clears>0 ? comboCount+1 : 0;
  >   comboMultiplier = 1 + comboCount*0.5` (classic-combo feel — bonus from the 2nd consecutive clear).
  >   `ModifierStack` `apply` seeds `comboCount=0`; wrapper is now a no-op.
  > - **`speed-up` WIRED.** `apply` sets `speedMultiplier=1.5` **and** shortens `dropInterval` now
  >   (covers fixed-speed levels that never hit the level-up recompute); `physics.js` level-up (~L797)
  >   honours `speedMultiplier` so the 1.5× persists through progression.
  > - **`mirror` WIRED.** `OdysseyMode.window.move` negates `dir` when `gameState.mirrorControls` — the
  >   single input choke point (keyboard tap, DAS auto-repeat, gamepad all route through it). Rotation
  >   intentionally not mirrored (standard mirror-mode).
  > - **`invisible` RETIRED** (definition deleted, NOTE left). Double-dead (no level used it AND no
  >   renderer read `piece.fadeOutTime`) and a correct wire touches SHARED single-player board render
  >   plus threads `fadeOutTime` through the gravity-cascade rebuild where it's lost. Re-add + wire if wanted.
  >
  > **Safety:** every `physics.js` edit is gated on Odyssey-only flags never set by single-player/MP
  > callers → byte-identical normal play. Proven by tests: `tests/unit/odyssey-modifiers.test.js`
  > drives real `processPhysics` (`isSeeking=true`) to assert exact ×2 scaling, an **unscaled baseline
  > equal to raw `calculateQuadraLineScore`** (the gate), and the chain 1.5→2.0→reset; the FFA
  > cascade/attack suites (same shared physics) still pass. Build + lint green.
  >
  > **STILL OPEN (the transformative half):** author the back-half campaign to actually *use*
  > combo/tetrises/time-survival primaries + the now-live modifier pool. That's level-data design, not code.
- **C3 — Ceremonies for the authored-but-silent content** *(high/medium)*. `isChapterEnd`/`isFinalLevel`
  are never referenced; chapter `narrative.intro/outro` and `victoryLapPolicy` "showcase" tags are dead
  data. Build: chapter-completion ceremony (chapter environment does a one-shot bloom-surge/palette-
  saturation beat; next threshold gate visibly ignites up the corridor), campaign finale at 55, and surface
  the narrative lines in the chapter-arrival card. (Visual side in §6 D4.)
- **C4 — Difficulty rhythm audit** *(medium/small)*. Audit the derived 55-level curve against the
  peak-valley pattern (per-chapter ramp → spike near the gate → relief opener next chapter — saga-map
  research). Fix tags, not the model. Delete or wire the dead `chapters.js` curve so it stops misleading.
- **C5** Save robustness: §2 #4–5 + real content in `migrateSaveData` before SAVE_VERSION ever bumps.
- **C6** Keyboard parity (§2 #8) + input-model cleanup (the global `window.move/rotate/...` hijack →
  scoped handler owned by the mode).

---

## 6. Pillar D — The Visual Masterpiece (one journey, not eight scenes)

### D0 — The Journey Score (the keystone artifact)
One authored document + one data table (extend `chapter-profile.js` — already the per-chapter source of
truth) assigning every chapter: **intensity** (0–1 emotional curve across the whole scroll — Journey's
three-act chart), **dominant hue + value + saturation** (8-swatch color script, GRIS-style: warm-green →
deep blue → alpine → twilight → violet → void→white transcendence), **motion tempo** (one signature
at-rest motion per biome, ≤3 desynced depth layers, midground calms when camera rests on a node cluster),
and **the protected focal hero**. Everything in D1–D8 executes against this score.

### D1 — One wonder per chapter (Mario Odyssey's rule: exactly ONE)
Prototype each in the playground first (`npm run dev:playground` → screenshot-verify → port), per the
established workflow. Deep-ocean proves the formula: *1 skinned GLB hero + 1 on-rail threshold object +
1 progress-scripted atmosphere scalar = strongest chapter at 1.7MB.*

| Ch | Today (ambition /5) | The wonder |
|---|---|---|
| 1 Earth Core | 4 census / **weak on capture** — flat untextured white crystals + soft blob-glows, and the 82° up-stare wastes the floor | Finish TSL conversion of the 5 sprite coronas + Points systems (removes the soft-blob ceiling + the flat crystals); **reframe the camera onto the lava floor / First Heart** (D9-1) so the hero is actually seen; lava-fall stays |
| 2 Deep Ocean | 4.5 — benchmark (mantas confirmed framed at the 1→2 seam/entry, though not at the body station) | Whale close-pass scripted beat; a body-station reframe so the mantas are the sustained read, not just the entry (D9-1); **distance-as-color ramp** (D7) fixes the last flat distant silhouettes |
| 3 Surface World | **weak on capture (below its 3.5 census)** — worst path-read in the journey (neon-green slab), flower "streaks", **floating disconnected bushes/grass**, washed-out hazy lighting, no visible hero | Fix the floating-vegetation placement + re-ground it; **hard-cap the green path luma** (D2 — it's the worst offender); de-haze / add value contrast (the old CH3-composition fix, still open); **re-enable the 2 flying birds NOW** (GLBs + wing-rig on disk, one-line restore, ground placements gated off) → then the asset redo: great-tree hero + murmuration |
| 4 Mountain Peaks | 4 — **model chapter on capture** (atmospheric peaks, prayer flags) | Convert the shared aurora to its TSL twin (last raw-ShaderMaterial holdout); **tilt the body framing up to the peaks earlier** (D9-1); cap the white path luma (D2) — it out-reads the peaks |
| 5 Sky Drift | **3 — weakest; capture shows it BROKEN**: dark-orb node (§2 #11), hard rectangular billboard clipping, garish flat aurora band | Fix the node-core bug + soften/round the cloud-sheet billboards (kill the edge-on rectangles) + the aurora hard clip; then a creature/object **with mass** (sky-whale or colossal cloud-arch the camera passes THROUGH — its pearl-gate moment) |
| 6 Cosmic Expanse | **weak on capture (below its 4 census)** — flat rainbow-smear nebula + black void + zigzag path, no framed hero | Give the nebula *structure* (not a gradient smear) + **frame a hero** (planet/supernova) via D9; slow supernova ignition beat (one-shot, progress-gated) on the baked-dome backdrop (B2); tame the aurora-carry bleed so it doesn't read as a garish smear |
| 7 Black Hole | 3.5 — capture: decent read, but lensing hero is a **deferred hook** (`lensWorldPos` maintained every frame, consumed by nothing) | **Ship the gravitational-lensing post node** — the finale phenomenon, already plumbed; the boot-warp compute-streak tech is reusable here |
| 8 Urban Dreams | 3.5 census / **anticlimactic finale on capture** — ~60% black void, distant flat boxes, no hero, shortest scroll (5.6%) | One silhouette-rich hero (spire/gate-bridge) + **widen the chapter scroll + reframe** (D9-3) + the D4 finale ceremony — the ending must be the climax, not the emptiest frame |

### D2 — Focal hierarchy enforcement (world > path > orb)
The one chronic *visual* gap (4 docs, never shipped): **journey-wide luma caps** so the rail/orbs never
out-read the world hero. Add `lumaCap`/`emissiveCap` to chapter-profile path/node styles; verify with the
station audit: 3–4 canonical camera stations per chapter (entry / body / node cluster / threshold
approach), screenshot each against the checklist (hero recognizable without the path; one dominant light
direction; foreground anchor present). The spline is deterministic — every station is reproducible.

### D3 — Threshold ceremonies (the 7 seams as rites of passage)
**Grounded in the §0.5 seam audit.** The crossfade mechanics already work; the job is to make every seam
do what **1→2 and 3→4 already prove** — *carry a physical element across + shift color cleanly + keep the
camera flowing.* Template per boundary (Journey/Sky "airlock" pattern), building on ChapterThresholdDirector
+ the authored breaches: **compression** (1.5–2s: fog thickens toward outgoing chapter color, motion/music
thin, FOV −5°) → **the moment** (signature scripted element per boundary — waterline swallow, canopy
break, radial star-ignition, light-bend) → **reveal** (new hero guaranteed in frame, music layer fades in).
The compression window is where residency work hides: evict outgoing / warm incoming **inside the
ceremony**. Flow doctrine (Alto's): ceremonies never take input, never hitch — if the player keeps
scrolling, the ceremony compresses; one-shot ceremony effects MUST be in the warm replay or they hitch on
first fire.

Priority fixes the seam audit surfaced, worst-first:
- **5→6 (worst):** kill the hard-rectangular aurora clip + angular shard intrusion; carry a real element
  (let the ch5 aurora dissolve *into* ch6 star-ignition instead of a billboard smear).
- **6→7 camera whip:** blend the ~127° yaw turn + tilt across the compression window (D9-2) so the camera
  *turns to the black hole* as a move, not a snap; restore camera roll (§2 #6) to sell the banking.
- **2→3 & 7→8:** soften/mask the circular **"seam-ghost" vignette** (the crossfade envelope rendering
  visibly); de-haze 2→3; light the 7→8 arrival so the finale isn't dark-on-dark.
- **Seam-width normalization:** the fast 2→3 and 7→8 crossfades read as cuts — widen them (and widen the
  ch8 finale scroll, D9-3) so the last transition doesn't rush.

### D4 — Celebration tiers (Peggle ROI: over-reward the instant)
1. **Level complete** (map return is already instant — infrastructure shipped): completed node erupts
   (1.5s TSL burst in chapter accent), path segment to the next node **draws itself in**, camera eases a
   few units up-spline — progress you *feel*.
2. **Stars**: pitch-stepped chime per star; constellation-crest stars (1=anchor, 2=+arc, 3=triangle crest)
   instead of three flat sprites; distant completed nodes fade stars before orbs.
3. **Chapter complete**: the C3 ceremony — chapter-wide one-shot bloom surge + palette saturation, next
   gate ignites (destination pull).
   All bursts are time-boxed one-shots (no persistent sims), frame-budget-gated via AdaptiveQuality.

### D5 — Map toys (Monument Valley/Sky reciprocity)
Pointer emits a small chapter-colored light with an **attractor uniform** into existing particle systems
(fireflies gather, fish scatter, dust swirls); 1–2 tappable one-shot responders per chapter (bell-flower
chime, jelly pulse, bird-flock lift, star twinkle-note); node hover = bloom + chime, press-and-hold =
charge glow. Event-driven one-shots only — protect the fill budget.

### D6 — Progress mirror + destination pull
Completed corridor stretches visibly transformed (path lit behind you, color-accumulated); frontier node
is the loudest object on the map; a **summit glow** far up-corridor visible from chapter 1 (Journey's
mountain) — as a cheap billboard/glow, not real geometry. Replicate the canonical-mountain-range
continuity device (world-positioned, seen from ch3 / climbed in ch4 / receding in ch5) for: black hole as
a pinprick from late ch5, ch8 retrosun through ch7's horizon, First Heart glow refracted into early ch2.

### D7 — Distance-as-color, not distance-as-darkness (Firewatch)
Per-chapter TSL depth ramp toward the chapter fog/accent with boosted rim, so distant creatures/props read
as luminous graphic shapes, not flat dark polygons (fixes the last ch2 complaint; cheapens far-field
materials).

### D8 — Music as the journey's second spline
Scroll position already drives camera/fog/light — let it drive **audio**: per-chapter track/stem
crossfaded by progress (the 36-song library may supply the 8 variations; a single evolving motif is the
stretch goal), AudioReactor then couples world-pulse to what's audible. Pentatonic per-node hover chimes
in the chapter key. SFX via the local Stable Audio wrapper.

### D9 — Camera framing + path coverage pass (from the §0.5 live audit — the user's core concern)
The spline is deterministic, so every "screen" is auditable and fixable. Three coupled problems, all
measured in §0.5:

1. **Reframe the chapters whose camera misses their own content.** Ch1 stares 82–85° up the whole chapter
   → retarget the look toward the lava-basin floor / First Heart caldera (the authored hero at contentY
   −47) for at least the entry/body beats; it's currently pointed at an empty dark chimney.
   > **CH1 FINDING (live experiment 2026-07-05):** the ch1 framing already RESOLVES to a strong down-bias
   > at body (`lookUp −2.67, downLookScale 1.03`) yet still renders at +77° up — the near-vertical spline
   > tangent overwhelms the bias. And when forced to crane down (~−70°), it reveals **more red rock walls +
   > dark void + the flat white crystals, NOT a molten-caldera hero** — the lava-basin/First-Heart floor
   > isn't a readable landmark from the spline. So **ch1 is content-blocked: it needs its D1 work (finish
   > the sprite/Points→TSL conversion + make the lava floor read as a hero) BEFORE a reframe helps.** A
   > reframe alone would just point at rock-and-void. Confirms the meta-finding: some chapters need content,
   > not framing. Ch4 is flat 3°
   through the body while its hero peaks tower at +767 → tilt the body framing up earlier so the peaks are
   the sustained read, not a 44°-exit afterthought. Use the per-chapter "shot beats" hook the visual-review
   doc specifies (OdysseyCameraController already has chapter framing overrides + staged act arcs) to
   author **entry/body/node-cluster/threshold** pitch+yaw targets against the D2 station checklist.
2. **Smooth the pitch discontinuities at seams.** The −3°→80° (6→7) and 3°→69° (4→5) whip-arounds read as
   hard cuts. Blend the outgoing chapter's exit framing into the incoming entry across the threshold
   compression window (D3) so the camera *turns to the new hero* as a move, not a snap. (Restore the dead
   camera roll, §2 #6, at the same time — it's the missing micro-motion that makes these turns feel
   intentional.)
3. **Rebalance chapter scroll widths + decide "extend path vs reframe" per over-content chapter.** Ch8 at
   5.6% and ch1 at 9.3% rush the bookends; widen them in `presentationLayout.chapterPositions` (and/or add
   spline length) so the finale and opening breathe. For the big content-above-path chapters (ch4 +767,
   ch8 +671, ch5 +494), decide per chapter: either **extend the path's coverage of that chapter** so the
   camera physically travels past more of the content, or **confirm the content is intentional distant
   backdrop and reframe the camera to feature it**. Ch8 specifically needs both — more scroll *and* a
   hero framing (ties to the D1-ch8 spire/gate hero and D4 finale ceremony); the ending currently opens on
   a near-black void.

Acceptance: the D2 station audit passes for all 8 chapters (hero framed at entry/body/exit without relying
on the path); no seam has a pitch discontinuity > ~25° that isn't an authored, roll-supported turn; the
finale reads as a climax, not the shortest, darkest chapter.

---

## 7. Pillar E — Structural Excellence

- **E1 — Extract the UI layer from OdysseyMode** *(high/large)*: ~1,400 lines of inline DOM/CSS (results
  modal :4895–5070, failure modal :5111–5290, board info overlay :3768–4011, legacy navigator :4354–4805,
  goal overlay, veils) → `src/ui/odyssey/` components. **One implementation must win**: revive or delete
  the dead parallel set (LevelSelectUI 451 + LevelResultsModal 285 + LevelPreviewPanel 270 lines, only
  referenced by the never-imported `ui/odyssey/index.js`).
  > **STATUS 2026-07-05 — WELL UNDERWAY (build + lint + up to 36 odyssey tests green at each step):**
  > ✅ **Dead parallel set DELETED** (the "one implementation wins" call): `ui/odyssey/index.js` (never
  > imported) + `LevelSelectUI.js` + `LevelResultsModal.js` + `LevelPreviewPanel.js` = **1,015 lines**
  > removed after verifying zero live refs (the `_showLevelSelectUI` hits are OdysseyMode's own inline
  > methods, not the file; `OdysseyHUD` is imported directly so it's unaffected).
  > ✅ **FIVE view clusters EXTRACTED** to `src/ui/odyssey/`, each pure-view (deps threaded explicitly →
  > unit-testable) with OdysseyMode keeping a thin wrapper so **every caller contract is unchanged**:
  > `ResultsModal.js` (`createResultsModal`), `FailureModal.js` (`createFailureModal`),
  > `GoalCompleteOverlay.js` (`createGoalCompleteOverlay`, dep-free), `BoardInfoOverlay.js`
  > (`createBoardInfoOverlay` → `{overlay, style}`; wrapper keeps the play-btn→launch wiring +
  > `_updateHeaderProgress`), `LevelSelectOverlay.js` (`createLevelSelectOverlay`; wrapper keeps the
  > back-btn→`_exitToMenu` wiring). Big static blocks moved via a uniform 4-space dedent (HTML/CSS
  > whitespace-insignificant → functionally identical). **OdysseyMode.js 5,915 → 4,962 lines** (−953,
  > below 5k). ⏳ REMAINING (state-coupled, stay as data/logic in OdysseyMode for now): `_updateLevelSelectUI`
  > (populates chapters/levels/progress into the extracted shell), `_updateHeaderProgress`, veils/misc.
  > E2 (OdysseyBoardController orchestrators) is the next god-object. Target: OdysseyMode < ~2,500.
  > **LIVE SMOKE-TEST PASSED (2026-07-05, dev:5173):** re-entered Odyssey — board visible ~4.5s, the
  > extracted BoardInfoOverlay renders correctly (header "Odyssey Mode" + "⭐ 0/168" + "Progress: 0%" +
  > level panel), board renders vivid+crisp (pixelRatio 1.25, masterSaturation 1.15 live), and the
  > console is CLEAN (zero errors/warnings except the harmless Windows powerPreference notice — no
  > missed-`this.` crashes from any extraction, no WARM-PROBE spam). The whole session's changes run
  > together live with no regressions.
- **E2 — Extract WarmupOrchestrator + SeamCoordinator** from OdysseyBoardController (~600 self-contained
  lines: warmup flags/queues/render-warm state machine; `_handleChapterSeam` + music bridge + stingers).
  Exactly where Pillar A and D3 work lands — extract before building on it.
  > **STATUS 2026-07-05 — STARTED with the safe, decoupled piece:** ✅ the post-target **compile
  > mechanics** (`beginPostTargetCompile`/`endPostTargetCompile`/`compileGroupThroughPost`) extracted to
  > `warmup/post-target-compile.js` — pure renderer/render-target manipulation, no board state, so it
  > lifts byte-identically; OBC keeps thin wrappers (internal callers untouched). Now has **6 isolation
  > unit tests** (`odyssey-post-target-compile.test.js`) for logic that previously needed a live WebGPU
  > board. ⚠️ **The rest of E2 is deliberately NOT rushed:** by reading the code, `_handleChapterSeam`
  > orchestrates across 6+ subsystems (camera/director/post/threshold/path/env) and the warm-up state
  > machine (`_startBackgroundRenderWarm`/`_deferRenderWarm`/`_prewarm*`/`_canRunBackgroundTask` + the
  > frame-health backpressure just shipped) is deeply board-coupled + load-bearing for cold-start. A
  > full class extraction is behavior-preserving-by-construction but needs a live warm-up/seam
  > smoke-test to validate — best done as its own focused, stable session, not at the tail of a batch.
- **E3 — One per-boundary transition profile table.** The 3→4 alpine and 5→6 aurora bridge tables exist
  TWICE with copy-pasted constants (CEM:171–184 + OdysseyDirector:32–45 — live drift risk), plus corridor
  SEAM_CARRY, threshold profiles, and camera framing overrides in separate files. Collapse into one table
  keyed by `boundaryId` — `ODYSSEY_THRESHOLD_PROFILES` (ChapterThresholdDirector.js:32–116) is the right
  shape. This is also the data home for D3 ceremonies. Remove inline `chapterId === 5/6/8` special-casing
  from generic managers (CEM:1073–1120, :1019).
  > **STATUS 2026-07-05 — the copy-paste drift risk is CLOSED:** the byte-identical `SEAM_34_ALPINE_BRIDGE`
  > + `SEAM_56_AURORA_BRIDGE` + their `*_COLOUR_HALF_WIDTH`s now live once in
  > `chapter-environments/shared/seam-bridges.js`; `ChapterEnvironmentManager` and `OdysseyDirector` both
  > import them (Director aliases the half-width names to keep its local usage unchanged). Byte-identical
  > (same hex/values) → the `resolveChapterBlendState` seam tests still pass, build/lint green. ⏳ The
  > FULL E3 (fold corridor SEAM_CARRY + threshold profiles + framing overrides into one boundaryId-keyed
  > table + strip the `chapterId === 5/6/8` special-casing) is a larger data-consolidation still open.
- **E4 — Per-chapter quality tiers** in chapter-profile.js replacing the single `particleCount: 500`
  (chapters interpret it inconsistently; sky-drift's authored 280 wisps silently become 500). Table:
  `{ particles, sheets, heroFx }` per tier — also the D1 wonders' scaling contract.
- **E5 — Dead-code decision list** (wire-or-delete, one PR): victoryLapPolicy tags (wire into D4) ·
  chapter narrative (wire into C3) · `unlockRequirement` blocks (delete — unlocking is linear) ·
  `estimatedTime` (delete) · `'height'` victory + `updateHeight` (delete or author one level) ·
  `hybridEngine.reset()` never called (call it on level exit) · `_meetsCondition` deprecated ·
  `_handleGameOver` identical branches · tall-board camera/minimap duplicated from InfinityMode
  (:5613–5793 — extract shared helper).
  > **STATUS 2026-07-05 — the pure DELETIONS done (verified zero live reads first, build + 29 tests green):**
  > ✅ `estimatedTime` removed (68 lines across levels.js — never read anywhere). ✅ `unlockRequirement`
  > removed (8 chapter blocks in chapters.js — never read; unlocking is linear). ✅ deprecated
  > `OdysseyMode._meetsCondition` deleted (defined-but-never-called; the live copies are in
  > VictoryConditionEvaluator + OdysseyHUD). ✅ `_handleGameOver` identical-branch merge — the
  > `failureType` if/else both arms called `failLevel('top-out')`, so it collapses to one call
  > (behaviour-identical). ⏳ REMAINING (need a decision/wiring, not a delete): victoryLapPolicy→D4,
  > chapter narrative→C3, `'height'` victory (delete or author a level), `hybridEngine.reset()` on
  > level exit (behaviour change — verify side effects), tall-board camera/minimap shared-helper
  > extraction (large, gameplay UI — capture-soft-gated).
- **E6 — Doc consolidation** — see §10.
- **E7 — Move `_originals/` (19MB) out of `src/`** to a top-level asset-sources dir or git-lfs.

---

## 8. Roadmap — five waves, each independently shippable

Validation protocol for every wave: `npm run build` + lint + unit green · playground screenshot per new
effect · **short per-chapter captures only** (full-journey captures have TDR-crashed this machine) ·
`[OdysseyStartup]` trace + perfMonitor p50/p95/p99 pasted into `docs/perf-captures/` · per-chapter hero
list is the acceptance test (the look, not the framerate).

**Wave 1 — Truth & correctness (small diffs, big wins)**
A7 baselines FIRST → §2 bugs #1–#4 + **#11 dark node-orb** (capture-confirmed, wrecks ch5/seam hierarchy)
(+ quick #6 camera roll, #8 keyboard) → A1 focus window → A2 lights reorder (re-measure!) → A3 barrier
split → A9 overlay floor → D1-ch3 birds re-enable (one line) → stale-doc corrections (loading plan status
block).
*Exit: cold start measured & improved on both save tiers; dig levels play as designed; timed levels can't
insta-fail; node cores glow (no dark blobs); birds fly in ch3.*

> **STATUS 2026-07-05 — most of Wave 1 SHIPPED** (build + lint + 43 odyssey unit + 13 TSL-build tests green):
> ✅ #1 double garbage-seeding removed (`OdysseyMode._addStartingRows` deleted; engine `seedStartingRows`
> is the single source). ✅ #2 paused-time clock (paused-ms accumulator + `_elapsedLevelMs()`; excludes
> pause-menu time). ✅ #4 dev backdoor gated (`isOdysseyDebugExposureEnabled()` — DEV or capture-flag only).
> ✅ #8 results-modal keyboard (Enter/Space/Esc, single-fire, capture-phase). ✅ #10 `'tetrises'` added to
> validTypes. ✅ #6 camera roll restored (deferred `_pendingViewRoll`, applied via `rotateZ` after `lookAt`
> in OdysseyCameraController). ✅ #11 dark node-orb — **root cause found + fixed live via chrome-devtools**:
> the instanced-core locked treatment was ×0.45 brightness + 45% desaturation → dark theme icons rendered
> near-black; softened to ×0.60 + 30% desat + a biome-tint glow floor in BOTH core paths
> (level-node-manager.tsl.js); screenshot-verified locked orbs now read as dim "sealed gems", unlocked
> nodes byte-identical (no regression). ✅ D1-ch3 birds re-enabled (`loadFlyingBirdsOnly` — 10 bird meshes /
> 5 animated flights; ground props stay off pending redo). ✅ A1 eager window is now **focus-centred**
> (`focusChapter±1`) instead of the progression-scaling prefix `1..furthest+1`.
> ✅ **#9** physics callbacks cached per-level (were rebuilt on every drop keypress — ~15 closures +
> hybridEngine wrapper) + the untracked 1200ms post-entry board-park `setTimeout` is now tracked/guarded
> (`_cancelBoardParkTimer` on reveal/deactivate + an `isInBoardView` bail so a fast return can't re-park a
> resumed board). ✅ **#5** stats integrity — `totalPlayTime` double-count fixed (`endSession` session
> duration is the single source; dropped the per-level add) + new persisted `statistics.totalAttempts` so
> FAILED attempts aren't lost.
> ⏳ REMAINING in Wave 1: A2 lights-before-compile reorder, A3 barrier split (both need a true cold-cache
> boot to measure — deferred to a dedicated measured pass), loading-doc status correction. Remaining §2:
> **#3** modifier illusion (→ C2, transformative), **#7** dispose-textures (higher risk — needs the same
> shared-GLB-cache care the eviction path has).

> **STATUS 2026-07-05 (batch 2) — A9 + the top Wave-2 visual SHIPPED** (build + lint + 13 TSL-build tests
> green): ✅ **A9** overlay floor 1500→800ms. ✅ **A7** baseline recorded (activate→ready ~6.3s warm cache;
> 318 geometries + 23 textures resident all-8, eviction OFF). ✅ **D2 path/orb luma cap (first pass,
> live-verified)** — the path was the brightest object in every captured frame; dropped the path-renderer
> emissive ceilings ~25–35% (`emission 1.35→1.0`, `coreBrightness 1.45→1.05`, `glowAlphaPeak 0.14→0.09`,
> etc.) so it recedes below the world hero (verified on ch4: white path now a soft leading trail, peaks
> hold the frame), PLUS a ch3-specific dim of its neon-green path emissive (`0x96a842→0x687d31`, the worst
> offender — verified it now reads as a muted moss leyline). ⏳ DEFERRED (need cold-cache/weak-GPU
> measurement I can't create on a warm RTX session; memory hard-warns against auto-enabling eviction on
> RTX/keep-alive): **A2/A3** loading reorder, **A6** eviction default-ON. ⏳ ch5 aurora/cloud hard-edge:
> both obvious candidates (aurora ribbon, cloud strata) already carry radial feathering, so the "square
> fake" edge needs a focused live re-capture to pinpoint the exact mesh (lenticular/noctilucent plane or a
> grazing-angle artifact) — not the simple missing-feather it looked like.

**Wave 2 — Memory & frame (the June-22 remainder) + the journey-wide figure-ground fix**
A6 eviction default-ON (+VRAM capture decision) → **D2 path/orb luma caps (elevated — the path is the
brightest object in EVERY captured frame)** → B1 path LUT/gate → B3 ch7 fold → B2 ch6 bakes →
B4 ch5 collapse (+ round the billboard cloud sheets so they stop showing rectangular edges) →
B5 MRT bloom → B6 pre-shed + hooks → B7/B8 alloc+upload hygiene → B9 culling/sleep → B10 registry
completion.
*Exit: flat idle memory; the path no longer out-reads the world; zero seam spikes at Extreme; cold-start
compiles < 60; all captures pass hero lists.*

**Wave 3 — The Journey Score + camera/coverage (the seamless-continuity wave)**
D0 score authored → E3 boundary table + E4 quality tiers (enablers) → **D9 camera framing + path coverage
pass** (reframe ch1 onto the floor + ch4 up to the peaks; smooth the seam pitch whip-arounds; widen the
ch1/ch8 bookend scroll; extend-path-vs-reframe decisions for ch4/5/8) → D2 station audit → D6 progress
mirror + summit glow → D7 distance ramps → C4 difficulty rhythm audit.
*Exit: 8-swatch strip + intensity curve committed; every station screenshot passes the hierarchy
checklist; no seam pitch discontinuity reads as a cut; the finale breathes; corridor reads as ONE
journey.*

**Wave 4 — Wonders & ceremonies**
D1 wonders (playground-first, one at a time: ch5 → ch7 lensing → ch3 redo → ch8 hero → ch1 TSL finish →
ch2/4/6 beats) → D3 threshold ceremonies (fused with eviction windows) → C3+D4 celebrations →
D5 toys → D8 music spline.
*Exit: every chapter has its postcard wonder; all 7 seams are ceremonies; completions feel like Peggle.*

**Wave 5 — Structure at scale**
E1 UI extraction (one implementation wins) → E2 orchestrator extraction → C2 variety authoring across the
back half → E5 dead-code sweep → C5 save robustness → E7 asset-sources move.
*Exit: OdysseyMode < ~2,500 lines; no dead parallel UI; ≥5 primary victory types + ≥5 real modifiers live
in the campaign.*

---

## 9. Targets

| Metric | Baseline (measured 2026-07-05 unless noted) | Target |
|---|---|---|
| Cold start → board ready (warm Dawn cache, RTX 5080) | **6.3s measured** (fast-start, reveal with ch1+2) | **< 3s** RTX 5080 / < 6s cold cache |
| Cold start (chapter-7 save) | scales with progression (eager prefix window) | within **0.5s** of fresh-save |
| Return-to-map | ~instant + transition | < 1.5s perceived, zero rebuild |
| First-scroll-into-chapter hitch | possible if bg-warm out-scrolled | **0 visible-frame compiles** |
| Cold-start pipeline compiles | ~150+ materials | **< 60** |
| Scroll frame-time p95 @ Extreme (ch5/6/7) | seam spikes present | < 8.3ms sustained, no seam spike |
| Idle memory (60s in-mode) | monotonic; **330 geometries + 24 textures resident** (all 8 ch, eviction off) | **flat** (eviction windowed) |
| Warm steady-state fps | ~149 | ≥ 149 (no regression) |
| Chapter scroll balance | ch8 **5.6%**, ch1 9.3% (bookends rushed) | no chapter < ~9%; finale ≥ ~10% |
| Camera framing | pitch 3°–87° rollercoaster; ch1/ch4 miss their own hero; seams whip | hero framed at every station; no unintended seam pitch jump > ~25° |
| Path figure-ground | **path is the brightest object in every captured frame** | path/orb luma capped below the chapter hero (D2 audit passes) |
| Node cores | **render as dark/black spheres in ch5 + seam** (bug) | glow as biome wisps in all 8 chapters |
| Visual | ch5 broken, ch8 anticlimactic finale, ch1 cheap; ch2/ch4 strong | every chapter ≥ 4/5 vs its postcard; station audit passes |
| Gameplay | 3 victory types, 2 real modifiers, 2+ live bugs | 0 known bugs; ≥ 5 types + ≥ 5 modifiers in campaign |

---

## 10. Doc ledger (what this plan supersedes)

**Standing references:** `ODYSSEY_PERFORMANCE_MASTERPLAN_2026-06-22.md` (perf law; §1 updates its
DONE table), `ODYSSEY_JOURNEY_CREATIVE_IMPLEMENTATION_PLAN.md` (art law; D0–D2 operationalize it).

**Superseded** (proposals absorbed or shipped; keep for history): PERFORMANCE_OPTIMIZATION_PLAN,
PERFORMANCE_MASTERPLAN_2026-06, CHAPTER_PERF_PLAN, VISUAL_COHESION_MASTER_PLAN, EARTH_CORE_AAA_PLAN,
CH3_CH4_SEAM_PLAN, CH5_SKY_DRIFT_COMPOSITION_PLAN, CREATIVE_DIRECTOR_IMPLEMENTATION_PROMPT,
WAVE_V_CAPTURE_REPORT (capture-truth record).

**Partially live** (open items absorbed into this plan's pillars): AAA_MASTER_PLAN (hero effects → D1),
CINEMATIC_JOURNEY_PLAN (U1–U5 mostly shipped), CHAPTER_MASTERPIECE_PLAN (Wave M moments → D1/D3),
AAA_VISUAL_EXPERIENCE_REVIEW (contract → D2; orb/star direction → D4), CHAPTER_BY_CHAPTER_IMPROVEMENT_PLAN
(remaining batches → D1), DEEP_OCEAN_VIBRANCY_PLAN (Tier-2 → D7), CH3_COMPOSITION_PLAN (→ D1-ch3),
VISUAL_UPGRADE_PLAN (value-structure fix → B5+D2), LOADING_OPTIMIZATION_PLAN (**status block is stale —
correct in Wave 1**; remaining items → A6).

**Chronic gaps** (proposed ≥3 times, never shipped — now first-class items): selective MRT bloom (B5),
path O(8) (B1), journey-wide luma caps (D2), KTX2 (moot — GLBs textureless; revisit only if textures land).

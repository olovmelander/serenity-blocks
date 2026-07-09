# Odyssey Mode — Loading-Time Optimization Plan

**Date:** 2026-06-17
**Status:** Phase 0 (instrumentation) + Phase 1b (board keep-alive) **IMPLEMENTED, default ON, flag-gated** (`?odysseyKeepBoard=0` reverts). Awaiting in-session VRAM/timing capture to decide whether to keep full keep-alive (1b) or move to the partial-dispose hybrid (1c). Phases 2–5 not started.
**Scope:** Cut the two long waits in Odyssey mode: (a) cold start (entering the mode), and (b) return-to-map (leaving a level). Level *entry* blackout is in scope as a secondary win.

### Implementation status
- ✅ **Phase 0** — `performance.mark/measure` around return-to-map (`odyssey-return-board-ready` logs ms) + `renderer.info` snapshot (`OdysseyBoardController.getMemorySnapshot()`, logged as `[OdysseyPerf] board-parked/board-resumed — geometries/textures/renderCalls`).
- ✅ **Phase 1b** — board is now **parked** (kept resident) instead of disposed on level entry (`_parkOdysseyBoard()` replaces `_disposeOdysseyBoard()` at the entry `onComplete`, gated by `this._keepBoardAlive`). Return resumes it (`_revealOdysseyBoard()` resets `display` + `resumeRendering()`). The board's `document` wheel listener stays inert while parked (`shouldRouteOdysseyWheel` guards on `isRenderingPaused`). True mode-exit (`onDeactivate`) and startup-error paths still fully dispose.
- ⏳ **Decision pending:** capture `[OdysseyPerf]` logs in a live session. If VRAM (textures/geometries held during gameplay) is safe on the iGPU → keep 1b. If it pressures toward TDR → implement **1c partial-dispose** (free chapter textures + composer render targets, keep geometry+pipelines) and/or ship Phase 4 KTX2 first.

> Grounded in a code profile of `OdysseyMode.js` + `OdysseyBoardController.js` and a web-research sweep of current (2024–2026) Three.js/WebGPU loading techniques (sources cited inline). Verified against the live code — line numbers are real.

---

## TL;DR — the one insight that explains both waits

**Cold start and return-to-map are the *same* cost, paid twice.** On level entry the board is **fully disposed** 1.2 s after the transition completes:

```js
// OdysseyMode.js:687  (inside JourneyEntryTransition onComplete)
setTimeout(() => this._disposeOdysseyBoard(), 1200);
```

`_disposeOdysseyBoard()` ([OdysseyMode.js:3489](../src/core/game-modes/OdysseyMode.js#L3489)) calls `boardController.dispose()`, nulls the controller, and removes the DOM container. So when you return, `_buildOdysseyBoard()` sees `boardController === null` ([OdysseyMode.js:3346](../src/core/game-modes/OdysseyMode.js#L3346)) and **rebuilds everything from scratch** — a brand-new `OdysseyBoardController`, all 8 chapter environments, the full `compileAsync` pass, the 17-sample `_warmUpJourney()`, **and** `renderer.dispose()`/`composer.dispose()` which throws away the entire compiled-pipeline cache.

Yet the board was **already paused and fully warm** before it was disposed — `pauseRendering()` ([OdysseyBoardController.js:1655](../src/rendering/odyssey/OdysseyBoardController.js#L1655)) just cancels the animation frame; everything stays GPU-resident. **The dispose is the only reason return is slow.** It exists purely to free VRAM during gameplay.

Second, the cinematic transitions run on **fixed blackout timers**, not on real readiness:

- entry base **6800 ms** (`_buildJourneyEntryTimings`), up to ~9800 ms with modifiers
- return base **7200 ms** (`_buildJourneyReturnTimings`), up to ~9800 ms

These are hard durations — even a fully-warm level waits out the whole budget. (Source: *Promise.race "flash of loading state"*, Kent C. Dodds; *p-min-delay*, sindresorhus.)

So the smart fix is two-pronged: **(1) stop throwing the board away**, and **(2) make the blackout end when work is actually done.**

---

## Measured cost breakdown

| Path | Wall-clock | Where it goes |
|---|---|---|
| **Cold start** | ~8–13 s | compileAsync barrier **2.5–5 s** · 8× chapter create **0.6–1.2 s** · `renderer.init()` **0.5–1.2 s** · `_warmUpJourney` 17 renders **0.5–1.2 s** · GLB asset load (ch3 = 18 files, ~23 MB **uncompressed**) **0.3–1.2 s** · rAF yields ~160 ms — all behind the loading overlay |
| **Return-to-map** | ~5–7 s | **full board rebuild 3.5–4.2 s** (identical to cold start) + fixed transition animation ~1.6 s, paced by the 7200 ms blackout |
| **Level entry** | 6.8–9.8 s | **fixed blackout budget** — actual work (theme switch + `prepareLevelStart`) is only ~0.8–1.0 s; the rest is dead air |

The single biggest controllable cost is the **board rebuild on every return**, and the biggest *perceived* waste is the **fixed blackout** sitting on top of work that's often already done.

---

## Root causes (ranked)

1. **Board is disposed on entry → rebuilt on return** (`OdysseyMode.js:687`, `:3489`, `:3346`). Pays full cold-start every level exit.
2. **`renderer.dispose()` / `composer.dispose()` in the teardown** ([OdysseyBoardController.js:1977](../src/rendering/odyssey/OdysseyBoardController.js#L1977)) blows the WebGPU **pipeline cache**, which is *why* a full `_warmUpJourney` replay is needed again on return. (Source: three.js *Tips to pre-compile shaders*; W3C WebGPU §2.2.4 UA pipeline cache.)
3. **Blackout is a hard timer, not a readiness gate.** Warm = 6 s of dead air. (Source: False Earth / Codrops; Kent C. Dodds Promise.race.)
4. **All 8 chapters built + warmed before first reveal** (`OdysseyBoardController.js:454–469`, `:564`, `:1558`) instead of progressively.
5. **No GLB compression** — `odyssey-gltf-loader.js` registers **no KTX2Loader and no MeshoptDecoder**, so every chapter ships raw PNG/JPG (decoded to full RGBA in VRAM) + uncompressed geometry. This is also the most likely root cause of the full-journey **TDR bluescreens**. (Source: Don McCurdy texture-formats; gltf-transform; 100 Three.js Tips.)
6. **`setupLighting()` runs *after* the chapter compile pool.** Docs require lighting/env final *before* `compileAsync`, or the pipeline specializes wrong and recompiles on the warm-up render. (Source: three.js `Renderer.compileAsync` docs.)

---

## The plan — phased, highest-ROI first

### Phase 0 — Instrument before touching anything (½ day, zero risk) ⭐ do first

You cannot tune a VRAM-vs-speed tradeoff by guessing — and the TDR risk means we must *measure* what the iGPU can hold.

- Add `performance.mark()` / `performance.measure()` around: click → theme-activate → `prepareLevelStart` → first reveal → transition-end, on both entry and return.
- Add a `renderer.info` probe (`{memory.geometries, memory.textures, programs}`) logged **immediately before** `_disposeOdysseyBoard`, **right after**, and **after rebuild**. This (a) proves repeated journeys return to baseline (no leak) and (b) measures exactly how many **pipelines** the warm-up recompiles — the number Phase 1 saves.
- Collect in **short per-chapter sessions** (the iGPU TDR capture constraint — full-journey capture has bluescreened the dev machine).

*Sources: User Timing API (web.dev, DebugBear); `renderer.info` (100 Three.js Tips); note `info` is counts-not-bytes — cross-check `chrome://gpu` for real VRAM.*

**Deliverable:** a one-screen table of real per-phase ms + resident pipeline/texture counts. Everything below is sized from it.

---

### Phase 1 — Stop throwing the board away (the big win) ⭐⭐⭐

**Target: return-to-map drops from ~5–7 s to ~1–2 s (animation only).** Eliminates the rebuild entirely.

The fix is a spectrum; pick the safe point using Phase 0's VRAM data. **Recommended: start at 1a (free, low-risk), then 1c (the hybrid).**

**1a. Share ONE renderer; never dispose the pipeline cache across the map↔level cycle.**
Verify the board and the gameplay theme use a single `WebGPURenderer`. If the board owns one that gets `dispose()`d and recreated each cycle, you re-pay `await renderer.init()` **and** lose every compiled pipeline. Stop calling `renderer.dispose()`/`composer.dispose()` in the per-level teardown — only on true mode exit (`onDeactivate`). *(Source: three.js Multiple Scenes / one renderer; 100 Three.js Tips.)*

**1b. Park instead of dispose (keep-alive).**
On entry: `pauseRendering()` (already exists) + hide the container (`visible=false` / `setAnimationLoop(null)`), **skip `_disposeOdysseyBoard`**. On return: un-hide + `resumeRendering()` — no rebuild, no warm-up. *(Source: three.js Tips "consider not disposing… use `object.visible=false`"; r3f frameloop=demand.)*
⚠️ Holds the full 8-chapter board in VRAM during gameplay → **TDR risk on the 16 GB iGPU**. Only ship this unguarded if Phase 0 shows headroom; otherwise →

**1c. Partial-dispose hybrid (recommended endpoint).**
VRAM is overwhelmingly **textures** (a 4K texture ≈ 64 MB; even a 200 KB PNG ≈ 20 MB decompressed) and **render targets**; geometry and pipelines are *cheap in bytes but expensive in time*. So on entry free **only** chapter textures + the composer's render targets (relieves the VRAM that risks TDR) while **keeping** geometry + node materials + **compiled pipelines** resident. On return, re-upload textures (async; trivial once Phase 4's KTX2 lands) and **skip the warm-up replay**. Bounds peak VRAM *and* kills the rebuild hitch — the best memory-vs-speed point for two heavy scenes. *(Source: three.js How-to-dispose; 100 Three.js Tips cost hierarchy; texture.dispose vs renderer.info thread.)*

Flag-gate the chosen strategy (e.g. `effectQuality` tier or a `?odysseyKeepBoard=` escape hatch) so the iGPU can fall back to today's full-dispose if VRAM is tight.

---

### Phase 2 — Make the blackout end when work is done ⭐⭐

**Target: warm entries/returns collapse to a ~300–500 ms floor instead of 7 s.**

Flip `_buildJourneyEntryTimings` / `_buildJourneyReturnTimings` from "fixed duration" to a **readiness gate**:

```
blackout = max(minFloor ~300–500ms, warmReadinessPromise)   capped at maxBlackoutHoldMs
```

- `Promise.all([readiness, minDelay])` → ends early when warm, never flash-cuts when instant.
- The existing per-theme/per-row budgets (`+900`/`+500`/…) become the **max cap / stall-abort safety net**, not the target. `Promise.race` against the cap → a hung warm renders anyway with a small stutter instead of an infinite blackout.
- Make **readiness honest** with the False Earth 3-stage state machine (idle→compiled→uploading→done): `compileAsync` in parallel, then stagger VRAM upload one component per frame. Because Odyssey's known first-visit hitch proved `compileAsync` misses the post-PassNode path (see `odyssey-first-visit-hitch` memory), readiness **must** include one real render of the target chapter's PassNode chain, not just `compileAsync`.

*Sources: False Earth (Codrops 2026); Kent C. Dodds Promise.race; p-min-delay; TanStack min-loading discussion.*

Pair with **pipeline-warm on hover**: upgrade the existing `_prefetchLikelyLevelThemes` (currently data-only) to also `compileAsync` + one hidden warm render of the hovered chapter, scheduled via `requestIdleCallback`/`scheduler.yield()` so it never janks the map. The player's dwell time on a node becomes free warm runway — by click, the level is "done" and the blackout is just the floor. *(Source: scheduler.yield (web.dev); skeleton/predictive-prefetch (LogRocket, NN/g).)*

---

### Phase 3 — Progressive cold start ⭐

**Target: first interactive board in ~2–4 s instead of ~8–13 s.**

- **Build + reveal chapter 1 (+ neighbors) immediately; warm chapters 2..8 in the background.** Background loading already exists (`loadChaptersInBackground`, gated on a 700 ms quiet window) — extend it so the *initial reveal* gates on only the near chapters, not all 8. Prioritize by player progress (nearest unlocked level ± neighbors). *(Source: progressive mesh streaming; KTX2; 100 Three.js Tips.)*
- **Fix lighting order:** move `setupLighting()`/env-map finalization **before** the compile pool so prewarm pipelines aren't recompiled during `_warmUpJourney`. *(Source: three.js `compileAsync` docs.)*
- **Time-slice the heavy init** (theme activation, board teardown/rebuild) with `scheduler.yield()` (`setTimeout(0)` fallback) so the warp/breach animation keeps rendering at 60 fps — masking only works if the mask is actually moving. *(Source: web.dev scheduler.yield; Scheduler API.)*

---

### Phase 4 — Asset pipeline: KTX2 + meshopt (the enabler) ⭐⭐

**Target: ~60–75 % smaller GLBs, ~10× less texture VRAM, fewer main-thread decode stalls — and very likely removes the TDR crashes.** This is what makes Phase 1b/1c *affordable*.

- **Wire `KTX2Loader` + `MeshoptDecoder` into the shared `odyssey-gltf-loader.js`** (both absent today). KTX2 stays GPU-compressed end-to-end (no client-side RGBA decode); call `detectSupport(renderer)` on the WebGPU renderer.
- **Use meshopt, NOT Draco.** The repo's GLBs are heavily rigged/animated (troll, hero fish, birds, *-rigged coral) — Draco silently **discards morph/animation data**; meshopt (`EXT_meshopt_compression` + `KHR_mesh_quantization`) preserves it, decodes faster, needs no separate WASM fetch.
- **Add a build-time `gltf-transform optimize`** npm script (dedup/prune → quantize → KTX2: ETC1S for albedo, UASTC for normals → meshopt) over the chapter GLB sources; commit the optimized artifacts. ⚠️ Lossy passes need a visual re-check — re-run the per-chapter TDR-safe captures per `CLAUDE.md` after.
- Extend Vite `manualChunks`: give each heavy `ChapterEnvironment` its own chunk + explicit prefetch of the next chapter's JS chunk **and** GLBs (since `modulePreload` is intentionally off for the Electron `file://` path).

*Sources: Don McCurdy web texture formats; Khronos KTX 2.0; gltf-transform.dev; egjs-view3d Meshopt; Vite features.*

---

### Phase 5 (later, profile-driven) — instancing / atlasing
Array-textures + `BatchedMesh` for the dense reef/foliage/flock sets. Real TSL work, must be screenshot-verified; only worth it if draw-call profiling shows binding-bound frames. Lower priority than 1–4.

---

## Recommended "smart path" (sequencing)

```
Phase 0 (instrument)              ← do first, decides everything
  └─> Phase 1a (one renderer, never dispose pipeline cache)   ← free, low-risk, big
        └─> Phase 1c (partial-dispose hybrid)   ← the return-to-map win
  └─> Phase 2 (readiness-gated blackout + hover pipeline-warm) ← the perceived-speed win
        └─> Phase 3 (progressive cold start + lighting-order fix + time-slice)
  └─> Phase 4 (KTX2 + meshopt)   ← enables 1b/1c headroom + likely fixes TDR; can run in parallel
```

**Expected end state:** return-to-map ~1–2 s (down from 5–7 s), warm entry ~0.5–1 s (down from 7+ s), cold start ~2–4 s to first interaction (down from 8–13 s), and a bounded VRAM ceiling that should stop the iGPU TDR crashes.

---

## Risks & open decisions

- **VRAM ceiling / TDR (load-bearing).** Phase 1b/1c hold board GPU state during gameplay. The 16 GB iGPU has already bluescreened on full-journey WebGPU work. **Phase 0 instrumentation gates the decision**; ship Phase 1 behind a quality-tier flag with full-dispose fallback. Phase 4 (KTX2) is what makes holding the board affordable.
- **WebGPU persistent pipeline cache is a *bonus*, not a strategy** — automatic, origin-partitioned, cold on first visit, uncontrollable from JS. Keep TSL output deterministic to maximize second-visit hits, but the in-session keep-pipelines (Phase 1) is the real lever. *(W3C WebGPU §2.2.4; three.js issue #32735.)*
- **Verification constraint.** The WebGPU board can't be auto-screenshotted headless and full-journey capture TDR-crashes the iGPU. Verify via Phase 0 `performance.mark` numbers + short per-chapter sessions captured by the user, not a single end-to-end run.
- **Decision needed:** Phase 1 endpoint — full keep-alive (1b, simplest, riskiest on VRAM) vs partial-dispose hybrid (1c, more code, safest). Recommend deciding **after** Phase 0 measures resident VRAM.

---

## Key source references

- three.js `Renderer.compileAsync` (lighting/env before compile; resolves when render won't stall) — threejs.org/docs
- three.js *Tips to pre-compile shaders* / *Reducing shader compile time* — discourse.threejs.org
- W3C WebGPU spec §2.2.4 (UA pipeline cache) + `createRenderPipelineAsync` (parallel compile) — w3.org / MDN
- *False Earth: From WebGL Limits to a WebGPU-Driven World* (3-stage warm state machine) — Codrops 2026
- *100 Three.js Tips That Actually Improve Performance (2026)* (VRAM cost hierarchy, KTX2 ~10×, LOD, keep-alive) — utsubo.com
- Don McCurdy — web texture formats + gltf-transform — donmccurdy.com / gltf-transform.dev
- `scheduler.yield()` / time-slicing — web.dev/blog
- Promise.race "flash of loading state" (Kent C. Dodds) + p-min-delay — readiness-gated transitions

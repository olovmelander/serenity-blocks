# Odyssey startup compile-cost — scoping (Batch 1 / OD-04·OD-05)

> **Goal.** Cut the ~2.86 s of shader compiles that dominate Odyssey's ~6.6 s
> cold start (board-visible). Grounded in the first committed real-GPU baseline
> (`reports/odyssey-perf/baseline-rtx5080-cold-fresh-load.json`) and a 5-reader
> code investigation (2026-07-26). This is a **scoping** doc: anatomy + ranked
> levers + a recommended sequence, not an execution plan.

## 0. The number

The `[OdysseyStartup]` trace on the RTX 5080 cold-fresh load:

```
total 6633ms | renderer 616 | creates 964 | path 26 | nodes 1057 | post+director 398 | compiles 2864 | warmup 443
board visible 7501ms
```

**`compiles` (≈2.86 s) is the single dominant bucket.** `warmup` (≈0.45 s) is
second and is *not* a good cut target (see §1.4).

### 0.1 MEASURED 2026-07-26 — this rewrites the plan
Per-item compile instrumentation (`b8ab70dd`, `[OdysseyStartup] compile-breakdown`)
on the RTX 5080 cold-fresh boot:

```
ch1=4388  ch2=750  corridor=309  breach=303   (ms, push→resolve)
```

**The FOCUS chapter (ch1 = earth-core) dominates at 4388 ms — 6× everything else.**
The barrier is `Promise.all` (bounded by the **max**), so ch2/corridor/breach all
resolve long before earth-core. **⇒ the OD-05 focus-only barrier split (§2 Tier 1)
is a NO-OP for the cold fresh start** — you cannot defer the focus chapter, and the
neighbor isn't the long pole. *(It may still help a mid-game boot whose focus chapter
is cheap and whose neighbors are heavy — re-measure per focus before assuming.)*

**The win is entirely earth-core compile reduction (Tier 2).** earth-core compiles
via one `_compileGroupThroughPost(group)` (OdysseyBoardController.js:1336) — ~12
materials through the post pass, dominated by the shared `moltenRockField` graph
(~40 `mx_noise_float`), serialized in Dawn's pipeline queue (not parallelizable by us).

## 1. Anatomy (verified in code)

### 1.1 It's one all-or-nothing barrier
The `compiles` bucket is literally one line —
`await Promise.all(compilePool)` at
[OdysseyBoardController.js:760](../src/rendering/odyssey/OdysseyBoardController.js#L760).
The pool holds one `compileAsync` per chapter in the **eager window** (pushed at
:624/:637) plus the corridor + seam-breach prewarms (:1568). Nothing in the pool
is tagged by chapter, so the barrier can only wait for the **whole set — one slow
member delays reveal.** That is exactly **OD-05**.

### 1.2 The eager window is focus±1
`OdysseyMode._computeEagerStartupChapters` ([:3375-3383](../src/core/game-modes/OdysseyMode.js#L3375))
is `lo=focus-1 … hi=focus+1`. For a **fresh player (focus=1) that is chapters
[1,2]** — earth-core + deep-ocean — plus corridor + breach. Mid-game it's 3 chapters.

### 1.3 The mismatch: we compile the neighbor but never render it pre-reveal
Fast-start is **default ON** (`warmupMode==='current'`, :306) and the warm-up
([:768 `_warmUpJourney`](../src/rendering/odyssey/OdysseyBoardController.js#L768))
renders **only the focus chapter** (single sample, :2279-2281). So the barrier
**blocks reveal on chapter 2's `compileAsync` even though chapter 2 is never
rendered before reveal.** Its only purpose is to pre-empt a first-scroll hitch —
which the post-reveal background render-warm (`_startBackgroundRenderWarm`, :786)
already handles for chapters 3–8. **The neighbor compile is pure critical-path
cost with no pre-reveal benefit.**

### 1.4 Why warm-up (~0.45 s) is off-limits
The warm-up is the genuine first-compile-through-post + GPU upload of the *focus*
chapter. Deferring it (:2351-2357 comment) just moves a multi-second compile onto
the first visible frames. Leave it — but it *can* be overlapped (§2, lever 3).

### 1.5 Where the cost concentrates (heaviest graphs)
No chapter uses shader `Loop()` — all heaviness is **JS-unrolled FBM octaves**
(each `valueNoise3` = 8 hashes; each `snoise3` = one heavy MaterialX gradient
node). By call-site density (in-window chapters):
- **earth-core = 44 noise call-sites / 12 materials** — the heaviest. `moltenRockField`
  alone chains ~10 `fbm()` @4 octaves (≈40 `mx_noise_float`), **shared** across
  rock-cluster / molten-pocket / column materials (the audit's "12→1" dedup).
- **deep-ocean = 13 / 10.**
- surface-world (28 materials) and cosmic-expanse are heavier by count but are
  ch3/ch6 — **off the fresh-load window** (only paid for a mid/late-game player).

There is **no runtime quality-tier gating of octave counts** — the Extreme baseline
and Low both compile the full-fat 4–5 octave graph (octaves are build-time JS consts).

### 1.6 Honest finding: no shipped flag cuts the barrier
`odysseyFastStartOff` / `odysseyEagerWindowOff` / `odysseySerialInit` are **reverts**
(they make startup *slower*; OFF is already the fast default). `odysseyChapterEvict`
is orthogonal (post-reveal VRAM; when ON it *disables* bg loading/warm) and blocked
by OD-11 anyway. **The cut requires the unflagged OD-05 barrier split.**

## 2. Ranked levers

### Tier 1 — the headline (OD-05 barrier split) · code-only, measure-gated
1. **Focus-only reveal barrier** — split `compilePool` into per-chapter tracked
   promises; at :760 `await Promise.all([focusCompile, corridorWarm, breachWarm])`
   only; push neighbor prewarms to the **existing** post-reveal queue (`_queueChapterPrewarm(2)`
   :774, `_startBackgroundRenderWarm` :786, which already sorts nearest-first at :1080-1083).
   **Saving: ~0.8–1.4 s** off board-visible for a fresh boot (removes ~half the
   barrier; unknown exact split until per-chapter timed). **Risk: med** (first-scroll-into-ch2
   hitch). *Blocked by:* per-chapter pool timing on the perf lane + lever 2.
2. **Prewarmed-gate on live visibility** *(de-risker + hardens today's ch3–8 path)* —
   in `ChapterEnvironmentManager.updateVisibility` ([:1069](../src/rendering/odyssey/ChapterEnvironmentManager.js#L1069))
   keep a group hidden (weight 0) when it would become visible but
   `env.prewarmed !== true`; re-run visibility when the prewarm resolves (the manager
   already re-calls after lazy-create at :862/:915). Converts the
   `setPipeline(undefined)` throw (warned at :657-662/:1128-1139) into a one-frame
   pop-in. **Risk: low. Prerequisite for lever 1.**
3. **Overlap focus warm-up with neighbor drain** — start `_warmUpJourney` as soon
   as the focus compile resolves; let the neighbor compile continue concurrently.
   **Saving: up to ~0.4 s.** **Risk: low.** *Blocked by:* the same pool split.

### Tier 2 — per-chapter graph cuts (broaden coverage + help Extreme)
4. **earth-core body materials 4→3 octaves** — `moltenRockField`'s `fbm()` default
   4 octaves ([earth-core.tsl.js:88](../src/rendering/odyssey/chapter-environments/earth-core.tsl.js#L88));
   the lake/canopy/backstop were already cut to 3 (:255,536,587). Drop the shared
   rock/column/pocket bodies too — **~25 % off the heaviest single graph,
   unconditional. Risk: low** (one playground screenshot to confirm the 4th octave
   is haze/ACES-eaten).
5. **Tier-gate octave counts by quality** — thread `qualitySettings` into
   `createChapterEnvironment` and pass an octave budget to the unrolled builders
   ([odyssey-tsl-noise.js:106,119](../src/rendering/odyssey/chapter-environments/shared/odyssey-tsl-noise.js#L106)).
   Low/Med compile 2–3 octaves. **Risk: low.** Helps weak GPUs' cold start; does
   *not* move the Extreme baseline number.
6. **earth-core molten-rock FBM → baked noise texture** — replace the ~40
   `mx_noise_float` chain with 1–2 `texture()` samples baked once. **Saving: ~0.5–0.9 s**
   on earth-core + a steady-state fill win. **Risk: HIGH** (changes the molten look
   — needs the playground screenshot loop + reference compare).

### Tier 3 — protect the post-reveal scroll budget (OD-04)
7. **Frame-health-gate the bg render-warm** — three tweaks in
   `_canRunBackgroundTask`/`_startBackgroundRenderWarm`: tighten `frameHealthBudgetMs`
   33→~20 (or derive from target fps); make the 8 s starvation escape (:956-960)
   force only a cheap `compileAsync` unit, not a synchronous offscreen render;
   adaptive inter-step spacing (:1148) that backs off after a warm exceeds budget.
   **No cold-start saving — protects post-reveal scroll.** **Risk: med.** *Blocked by:*
   the 60 s LoAF/long-task trace while fast-traversing (the OD-04 verdict).

## 3. Open questions (the two readers that failed to return)
- **Pipeline-cache persistence** — does r181 `WebGPURenderer`/Dawn persist a
  pipeline cache **across sessions**, or is every cold start a full recompile? If a
  persistent cache is reachable (Electron/Dawn level), it could dwarf every lever
  above by eliminating cold compiles entirely. **Unresolved — investigate before
  committing to the barrier split as the ceiling.** (Note the known gotcha: MRT-path
  `compileAsync(scene)` poisoned the pipeline cache → black screen on the black-hole
  theme; warm via `postProcessing.render()` instead.)
- **compileAsync concurrency** — `Promise.all(compilePool)` already *issues* the
  focus±1 compiles concurrently; the barrier just waits for the slowest. So the win
  is not "parallelize" (already done) but "stop waiting for the neighbor" (lever 1).

## 4. Recommended sequence (revised after §0.1)

~~Barrier split first~~ — **killed by the measurement** for the cold fresh start
(earth-core focus dominates; the neighbor isn't the long pole). The order is now:

1. ✅ **DONE — per-item compile instrumentation** (`b8ab70dd`). It's what produced §0.1.
2. **Pinpoint the monster inside earth-core (measure-only, safe to land):** extend the
   instrumentation to time per-material (or per-sub-group) compile inside
   `_compileGroupThroughPost`, so we know whether the 4388 ms is ONE material
   (`moltenRockField` → bake it, lever 6) or spread across the 12 (→ octave-cut all,
   lever 4). Zero visual risk; decides between lever 4 and lever 6.
3. **earth-core graph reduction** — the actual win. Lever 4 (4→3 octaves on the heavy
   bodies) first if spread; lever 6 (bake `moltenRockField` to a noise texture) if it's
   one monster. **Both are visual changes** → require the playground screenshot loop
   (CLAUDE.md) on the owner machine to verify no look regression, then re-measure the
   `compile-breakdown` ch1 number to confirm the cut.
4. **Broaden:** lever 5 (tier-gate octaves) so Low/Med also shrink.
5. **Protect scroll:** lever 7 (OD-04 bg-warm health gating), gated on the 60 s trace.
6. **Barrier split — only if re-measured worthwhile for mid-game** focus chapters whose
   neighbors dominate (levers 1+2+3, with `odysseySerialInit` as revert). Not the
   cold-fresh win.

**What needs the owner GPU:** all *validation* — per-chapter compile split,
before/after board-visible, first-scroll regression, the 60 s LoAF trace. The
**code** for levers 1–5 can be written and unit-tested now; only the numbers need
the RTX/iGPU machines (the perf lane from Batch 0 is ready for exactly this).

## 5. Status
- ✅ Per-chapter compile instrumentation landed (`b8ab70dd`) → §0.1 measurement,
  which **killed the barrier-split hypothesis** and pointed the work at earth-core.
- **Next:** per-material instrumentation inside `_compileGroupThroughPost` to decide
  bake (lever 6) vs octave-cut (lever 4), then the earth-core reduction itself
  (owner playground-verified + re-measured). See §4.

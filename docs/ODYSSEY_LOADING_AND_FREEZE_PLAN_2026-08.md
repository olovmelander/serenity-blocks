# Odyssey — loading time & freeze remediation plan (2026-08-17)

**Status:** investigation complete. **Wave 1 implemented and verified (§8).** Waves 2–4 open.
**Scope:** cold start, drop-in freeze, micro-stutters, per-chapter transition freezes.
**Method:** production build (`npm run build` + `vite preview :4173`), Electron shell, rAF-gap
recorder + `longtask` PerformanceObserver injected pre-page-script. Five boot runs and one
bounded forward/backward scroll pass. Raw probe JSON is in the session scratchpad.

> A multi-second rAF gap with **no** matching longtask is GPU/compositor BeginFrame starvation,
> not JS. That single discriminator is what separates the four root causes below. (Same
> diagnostic as the boot-warp stall work.)

---

## 1. What the player experiences, and what actually happens

| Symptom (reported) | Measured | Root cause |
|---|---|---|
| Long initial load | 6.3 s to board visible (warm), 7.7 s (first launch after an update) | RC-3, RC-4 |
| Frozen a couple of seconds after dropping in | 3.4 s stall @ ~10.8 s, 3.7 s @ ~15.0 s, 1.1 s @ ~16.3 s | RC-2 |
| Micro-stutters during play | 0.4–0.6 s gaps at ~35 s and ~43 s | RC-2, RC-5 |
| Freezes right before a new act/chapter | forward scroll: 8 gaps >100 ms, worst 586 ms | **RC-1** |
| Backtracking is smooth | backward scroll: **0 gaps >50 ms** | confirms first-visit cost |

The forward-vs-backward result is the cleanest evidence in the whole investigation:

```
forward  0 → 0.80   13 gaps >50ms   8 gaps >100ms   worst 586ms   total stall 2841ms
backward 0.80 → 0    0 gaps >50ms   0 gaps >100ms   worst   0ms   total stall    0ms
```

Identical geometry, identical camera speed, identical draw load. The only difference is whether
the content had been touched before. **Every forward hitch is a first-visit cost, not a rendering
limit.** This matches the report exactly and means the fix is scheduling, not budget-cutting.

---

## 2. Measured startup breakdown

`[OdysseyStartup] total 3911ms | renderer 734 | creates 727 | path 15 | nodes 600 | post+director 302 | compiles 27 | warmup 227`

| Phase | ms | Notes |
|---|---|---|
| App boot → board init starts | ~1 550 | module load, ThemeManager, LevelRegistry, mode activation |
| `renderer` | 611–734 | WebGPU device + TSL pipeline |
| `creates` | 727–849 | ch1 environment (~180 ms) + One World build |
| **One World build (synchronous)** | **~1 220** | single blocking JS chunk — see RC-3 |
| `nodes` | 600–749 | 59 level nodes |
| `post+director` | 302–338 | |
| `compiles` (barrier) | 27–54 warm / 1 136–1 160 stale | see RC-4 |
| `warmup` | 225–274 | fast-start: one sample, focus chapter only |
| Overlay fade-out | 865 | fixed `fadeOutMs: 800` contract |
| **Total to board visible** | **~6 300** | ~7 700 on first launch after an app update |

### The pipeline cache does work — but only until you ship an update

An initial cold-vs-warm A/B appeared to show the Dawn cache buying nothing. That was
confounded: the "warm" run's cache was stale, left over from a pre-rebuild session. Re-running
against a cache populated by the *same* build settles it:

| Dawn cache state | board init | ch1 compile |
|---|---|---|
| Stale (previous build) | 5 241 ms | 2 385 ms |
| Cold (deleted) | 5 306 ms | 2 405 ms |
| **Valid (same build)** | **3 911 ms** | **46 ms** |

Electron already persists this at `%APPDATA%/serenity-blocks/DawnWebGPUCache` (76 MB on this
machine), so **no cache wiring work is needed**. The consequence to plan around is narrower: every
shipped update invalidates it, so the *first* launch after each patch costs ~1.4 s extra. That is a
first-run-after-patch cost, not a permanent one — worth covering with UI, not engineering.

---

## 3. Root causes

### RC-1 — The anti-freeze mechanism spends its first 36 seconds waiting for chapters that will never exist ⚠️ **primary**

`_startBackgroundRenderWarm()` ([OdysseyBoardController.js:1330](../src/rendering/odyssey/OdysseyBoardController.js#L1330))
builds its sweep order as every chapter `1..total`:

```js
for (let ch = 1; ch <= total; ch += 1) order.push(ch);
```

But One World is the default path, and it **suppresses chapters 2–5**
([OdysseyBoardController.js:149](../src/rendering/odyssey/OdysseyBoardController.js#L149)):
`ONE_WORLD_CHAPTERS = [2, 3, 4, 5]`. Confirmed live — the board only ever holds
`environments: [1, 6, 7, 8]`.

So the sweep reaches chapter 2, finds no environment, and takes the "not created yet, wait for the
background loader" branch — **30 retries × 300 ms = 9 s per missing chapter**. Chapters 2, 3, 4 and
5 each burn the full 9 s: **~36 seconds of dead waiting** before chapter 6 is even considered.

Measured consequence: after 48 s of idle, `_bgRenderWarmPending` was still **6** and
`_bgRenderWarmCurrent` still **2**. After a full ~60 s session including two scroll passes,
`_bgRenderWarmComplete` was still **false**. Chapters 6, 7 and 8 — the Act II→space material the
player is scrolling toward — are **never render-warmed before arrival**, so they compile and upload
on a visible frame. That is the transition freeze.

This also invalidates the fast-start trade. Fast-start (default ON) deliberately warms only the
focus chapter pre-reveal, reveals ~15 s sooner, and *borrows against the post-reveal sweep to repay
it*. The sweep never repays. **We are currently paying fast-start's cost without receiving its
benefit.**

### RC-1b — …and even when it reached a chapter, the warm rendered nothing ⚠️ **found while fixing RC-1**

Fixing RC-1 alone changed nothing a player could feel, which exposed a second defect underneath it.

`_renderWarmChapterOffscreen` opens with `const saved = this._beginPostTargetCompile(); if (!saved) return false;`.
`_beginPostTargetCompile()` forwards `this._renderLoopActive()`, and `beginPostTargetCompile`
**returns null whenever the render loop is live** — correctly, because binding the scene-pass target
under a live loop aliases a texture as both sampled binding and render attachment and permanently
poisons the device (documented at length in `warmup/post-target-compile.js`).

The post-reveal sweep runs *after* `animate()`. So it always got `null`, always returned `false`,
and **never rendered anything at all**. It then re-queued each chapter up to 5 times, so it burned
retries as well as time. Measured after the RC-1 fix, with the sweep now completing cleanly:

```
renderWarmed:  {1: true, 6: false, 7: false, 8: false}
bgWarmRetries: {6: 6, 7: 6, 8: 6}      ← every single attempt failed
```

The guard was right; the missing piece was a fallback. See §5 W1.3 for the fix.

### RC-2 — Background loading is atomic and unbounded, so it lands as multi-second GPU stalls

`loadChaptersInBackground()`
([ChapterEnvironmentManager.js:888](../src/rendering/odyssey/ChapterEnvironmentManager.js#L888))
checks `canRunTask()` **only between chapters**. A single `createChapterEnvironment()` is one
indivisible unit — all geometry, all materials, all uploads — with only a 60 ms gap after it. Each
completion then fires `_queueChapterPrewarm`, and the prewarm drain deliberately fires the whole
pending set of `compileAsync` calls **concurrently**.

Then `_renderWarmChapterOffscreen()`
([OdysseyBoardController.js:1487](../src/rendering/odyssey/OdysseyBoardController.js#L1487)) does a
**synchronous full-scene `renderer.render()`** with `frustumCulled = false` forced on every drawable
in the group — the most expensive possible way to touch a chapter.

Measured: 3 435 ms stall at 10.8 s (during ch7/ch8 creation), 3 663 ms at 15.0 s (during the ch6/ch7
compile burst), 1 121 ms at 16.3 s. Longtask attribution for the 15.0 s stall is only 767 ms — the
remaining ~2.9 s is GPU starvation, i.e. upload + compile, not JS.

A/B confirms it: with `?odysseyBgWarm=0&odysseyDisableBackgroundLoading=1` the 15.0 s stall collapses
from 3 923 ms to 433 ms.

### RC-3 — Board init is a serial main-thread chain with one 1.2 s blocking bake

`createOdysseyWorld()` runs `bakeGroundSunFields` + `bakeGroundAtlas` + the cloud-field bake
synchronously ([odyssey-world-renderer.js:1179](../src/rendering/odyssey/world/odyssey-world-renderer.js#L1179)).
Measured as a single 1 220 ms rAF gap with a matching 1 195 ms longtask — purely JS-bound, and it
blocks the loading screen's own animation. `nodes` (600 ms) and `renderer` (700 ms) are likewise
serial where they could overlap.

### RC-4 — First launch after an update pays ~1.4 s of pipeline compile
Covered in §2. No wiring work needed; it is a UI/communication problem.

### RC-5 — The forest theme pre-warm lands inside the play window
`[Main] First-entry theme warm-up complete: forest` arrives at ~17.5 s — after the player is already
on the board — and contributes to the late stutters. It is warming a whole second WebGPU scene while
the player is scrolling.

---

## 4. Best practice this should converge on

Standard practice for streaming open-world content, and what the fixes below implement:

1. **Never let a background task exceed a frame budget.** Background work runs in a single queue
   with a hard per-frame ms cap (~2–4 ms), yielding via rAF. Not `setTimeout` chains, which cannot
   preempt a unit already in flight.
2. **Make units of work resumable.** A task that cannot be paused mid-way will eventually land on a
   visible frame. `createChapterEnvironment` must become a sequence of steps, not one call.
3. **Bound GPU concurrency.** Firing N `compileAsync` calls at once converts a scheduling problem
   into a GPU stall. 1–2 in flight, prioritised by distance along the path.
4. **Prioritise by travel direction, and only over content that exists.** Warm what the player is
   about to reach; never poll for content the configuration excludes.
5. **Warm by replaying the real render path — but time-sliced.** The existing insight (warming must
   go through the post `PassNode`, not `compileAsync`) is correct and stays; only its scheduling is
   wrong.
6. **Decouple create → upload → compile → warm** so each can be budgeted separately.
7. **Gate the loading screen on real readiness**, not a timer.

---

## 5. Plan

### Wave 1 — Surgical, high value, low risk (do first)

**1.1 Restrict the warm sweep to chapters that can exist.** Build `order` from the environment
manager's non-suppressed chapter set instead of `1..total`. Directly removes ~36 s of dead waiting.
*Expected: chapters 6/7/8 warmed within a few seconds of reveal instead of never; most transition
freezes gone.*

**1.2 Make the "not created yet" wait event-driven.** Replace the 30 × 300 ms poll with a
notification from `loadChaptersInBackground`'s `onEnvironmentCreated`, keeping a much shorter poll
as a backstop. Removes the remaining dead time when a chapter genuinely is still loading.

**1.3 Give the warm its own render target** (this is the load-bearing fix — see RC-1b, and it
delivers the small-target win at the same time). The warm cannot bind the live scene-pass target,
so give it a **private 320×180 clone**: `RenderTarget.copy` reproduces every attachment texture,
the depth texture and `samples`, and the live post graph never touches it, so the aliasing hazard
is gone by construction.

This still warms the *right* pipelines, which is the part worth checking rather than assuming.
`WebGPUBackend.getRenderCacheKey` (three r181) hashes
`getSampleCountRenderContext` / `getCurrentColorSpace` / `getCurrentColorFormat` /
`getCurrentDepthStencilFormat` — **formats, not texture identity** — so a format-matched clone
produces identical pipeline cache keys, and programmable stages are cached by shader source. (The
`texture.id`-based key in `RenderContext.getCacheKey` governs attachment descriptors, not the
pipeline cache.) Resolution never enters a pipeline key, so 320×180 warms exactly what
full-resolution would.

**1.4 Add a regression test** asserting the sweep never enqueues a suppressed chapter — this bug
was invisible precisely because nothing asserted the sweep's *input set*.

*Wave 1 is the bulk of the perceived win and touches scheduling only — no visual surface changes,
so it needs no capture verification.*

### Wave 2 — Budgeted, interruptible background work

**2.1 One frame-budget scheduler.** A single priority queue drained from the render loop with a hard
per-frame budget, replacing the three independent `setTimeout` chains (creation, prewarm,
render-warm). Keep the existing `_canRunBackgroundTask` predicates as *priority inputs* rather than
hard gates, so work still trickles during slow scrolling instead of stalling entirely and then
dumping.

**2.2 Split `createChapterEnvironment` into resumable steps.** Yield between sub-builds so no single
unit exceeds the budget. This is the structural fix for the 3.4 s drop-in stall.

**2.3 Bound compile concurrency to 1–2**, ordered by path distance from the player.

*Wave 2 removes the residual drop-in freeze and micro-stutters. Higher risk than Wave 1 — it
restructures the loader — so land Wave 1 first and re-measure.*

### Wave 3 — Cut the 6.3 s initial load

**3.1 Move the One World bakes off the blocking path.** Options, cheapest first: (a) time-slice the
bake across frames so the loading screen keeps animating; (b) precompute to an asset at build time;
(c) move to a worker. (b) is the largest win and removes ~1.2 s outright.

**3.2 Overlap `renderer` init with `creates`/`nodes`** rather than running them strictly serially.

**3.3 Reconsider the 865 ms overlay fade** — overlap it with the first warm samples instead of
paying it after them.

### Wave 4 — Polish

**4.1 Move the forest theme pre-warm** before reveal or well after the player settles (RC-5).
**4.2 Cover the first-launch-after-update compile** with honest loading UI (§2) rather than
engineering.

---

## 6. Targets & verification

Re-run the same two probes after each wave and compare against these measured baselines:

| Metric | Baseline | Target after W1 | Target after W2+W3 |
|---|---|---|---|
| Board visible | 6.3 s | 6.3 s (unchanged) | ≤ 4.0 s |
| Post-reveal stall total (first 45 s) | ~9.7 s | ≤ 4 s | ≤ 1 s |
| Worst single post-reveal stall | 3 663 ms | ≤ 1 500 ms | ≤ 250 ms |
| Forward scroll gaps >100 ms | 8 | ≤ 2 | 0 |
| Worst forward scroll gap | 586 ms | ≤ 250 ms | ≤ 120 ms |
| `bgRenderWarmComplete` reached | **never** | < 15 s | < 10 s |

`bgRenderWarmComplete` reaching `true` at all is the single clearest pass/fail signal for Wave 1.

**Measurement discipline** (learned the hard way on this codebase): close every other GPU client
before measuring; compare only runs from the same build *and* the same Dawn cache state; treat any
"warm" cache from a previous build as cold.

---

## 7. Explicitly not the problem

Ruled out by measurement, to save re-litigating:

- **Asset payload.** 4.1 MB across 7 GLBs — down from the 43 MB the 2026-06 audit found. Not a lever.
- **Pipeline cache wiring.** Already persists correctly in Electron userData (§2).
- **Rendering/draw budget.** The backward pass over identical content is perfectly smooth.
- **Slicing chapters differently.** Residency is not the issue; *when* the work runs is.

---

## 8. Wave 1 — implemented and verified (2026-08-17)

**Changed**
- `odyssey-warmup-plan.js` — new pure `buildRenderWarmOrder({total, focus, suppressed})`: skips
  suppressed chapters, orders nearest-the-player first (W1.1).
- `OdysseyBoardController._startBackgroundRenderWarm` — uses it, and short-circuits to complete on
  an empty order. A chapter that is not ready now **rotates to the back** instead of sleeping in
  place, so it can never block a chapter that IS ready (W1.2). Bound raised to 40 rotations, which
  is safe precisely because a rotation no longer costs anyone else time. Logs
  `render-warmed chapter N in Xms` — the signal that matters is *when a chapter became safe to
  enter*, not that the sweep finished.
- `warmup/post-target-compile.js` — new `createWarmRenderTarget` + `beginWarmTargetRender`, and
  `_renderWarmChapterOffscreen` now falls back to the private target when the loop is live (W1.3).
  Disposed with the board.
- Tests (W1.4): 6 unit tests on the order builder, plus `odyssey-render-warm-sweep.test.js`
  asserting the **call site** — the helper tests alone cannot detect a revert to an inline loop,
  which is exactly how the original bug was written. Mutation-checked: reverting the order build
  fails 2 of them.

**Measured (production build, same machine, same Dawn cache state)**

| Metric | Before | After |
|---|---|---|
| `bgRenderWarmComplete` | **never** | true |
| `renderWarmed` ch 6/7/8 | false / false / false | **true / true / true** |
| `bgWarmRetries` | `{6:6, 7:6, 8:6}` (all failed) | none |
| Forward gaps >50 ms | 13 | **9** |
| Forward gaps >100 ms | 8 | **5** |
| Forward total stall | 2 841 ms | **2 212 ms** |
| Hitches at ch6/ch7 approach (p≈0.70, 0.80) | 120 ms, 140 ms | **gone** |
| Backward pass | 0 gaps | 0 gaps (unchanged) |
| Board init | 3 859–3 911 ms | 3 840 ms (no regression) |
| WebGPU validation errors | — | **none** |
| Test suite | — | 3 573 passing / 357 files |

Each warm render now costs **4–5 ms** of CPU, against a full-resolution full-scene pass before.

### What Wave 1 did NOT fix, and what that tells us

Every surviving forward hitch is now clustered at **p = 0.03–0.14** — chapter 1 and the ch1→world
seam — and none remain in the Act II→space stretch. So the *chapter* first-visit cost is addressed;
what is left is a different root cause:

**RC-6 (new) — first-MOVEMENT cost in the early world.** Fast-start's pre-reveal warm renders a
single sample at `p = 0` (`buildPointWarmSamples`). Anything that only happens once the camera
*moves* — clipmap ring updates, forest chunk visibility stamps, LOD switches — is therefore never
warmed. This is the same class of bug the original journey-replay warm-up existed to prevent: a
static warm cannot cover motion-triggered work. Fix by warming a short *motion* sample set (a few
positions across the opening stretch) rather than a single point.

**RC-7 (new) — the background gate is now over-conservative.** `_canRunBackgroundTask` blocks all
warming while the camera is moving. Chapter 8 was therefore only warmed at **50 s**, because the
probe scrolled continuously from 12 s. That gate was calibrated when a warm meant a
full-resolution full-scene render; at **5 ms** the trade has changed, and warming during slow
scroll is now clearly worth it. A player who scrolls straight from the reveal still out-runs the
sweep today.

### Revised next step

Do **RC-6 + RC-7 before Wave 2** — they are small, they target the hitches that actually remain,
and RC-7 in particular is now just a re-calibration justified by a measured 5 ms. Wave 2's
scheduler remains the right structural answer for the drop-in freeze (RC-2), which Wave 1 did not
touch.

---

## 9. Session 2 (2026-08-17) — what shipped, what was reverted, and the real throttle

### Shipped on top of Wave 1

**9.1 Background compiles now build POST-format pipelines, asynchronously.** The module header
documented a known limitation: under a live loop the scene-pass target cannot be bound, so
background `compileAsync` fell back to building *canvas-format* pipelines. The post-format ones
were therefore never compiled off-thread — they compiled **synchronously inside the render-warm**.
Measured directly, and reproducibly, across four runs:

| When the render-warm ran | Cost |
|---|---|
| Before the chapter's compile landed | **482 / 560 / 489 ms** (synchronous pipeline creation) |
| After it landed | **3 / 4 / 5 ms** |

The hazard was never "a render target" — it was specifically the *shared* one. Routing background
compiles through the same private target as the warm (§5 W1.3) makes them genuinely async and
correctly specialised. Warms are now consistently **3–5 ms**.

**9.2 The background gate's starvation escape now covers both block reasons.** It previously
covered only frame health; the "player is busy" branch was a hard `return false`.

### Reverted: RC-7 (the lax warm gate)

Implemented, measured, **reverted**. Letting the warm run during scroll made things worse
(forward stall 2 212 → 3 980 ms), because it warmed chapters *before* their compile had landed and
so paid the 490 ms synchronous path mid-scroll. The premise was wrong: the "5 ms warm" I based it
on was a hollow warm that ran before compilation and did nothing.

### RC-8 (new, unfixed) — the camera never reports "settled", so ALL background work is throttled ⚠️

This is the real limiter, and it is a hair-trigger. On a board with **zero input for 25 seconds**:

```
isAnimating: false
current: 0.030799   target: 0.031684   delta: 0.000885
cameraSettledThreshold: 0.0008                        → settled: FALSE
```

Idle drift leaves a permanent residual **11% above** the settle threshold. `_canRunBackgroundTask`
gates chapter creation, prewarm compiles *and* the render-warm on that predicate, so the entire
background pipeline is throttled to whatever brief windows dip under the threshold. Chapters 6 and
7 were compiled and ready at **15.9 s** but not render-warmed until **44 s**.

With 9.2's escape that improves to 24.8 s, but everything now advances at exactly **one item per
8 s** — the escape interval — because the gate is *always* blocked. The escape is a safety net,
not the cure.

**This needs an owner decision, which is why it is not fixed here.** The drift is plausibly
deliberate (the shared camera rig does idle breathing/parallax). So either:
- **(a)** `_isCameraSettled` should ignore intentional idle motion — compare against the drift
  envelope rather than raw `|target − current|`; or
- **(b)** the threshold is simply mis-set for this rig and should be widened (~0.002).

(a) is correct if the drift is by design; (b) is a one-line change if it is not. Whichever is
chosen, **this is the highest-value remaining fix** — it paces every background path in the mode.

### ⚠️ Measurement caveat — read before trusting any small delta above

Late in the session, run-to-run variance on the scroll probe reached **2 212–9 473 ms** of forward
stall across configurations on the same machine and build, including one 4 680 ms single-frame
outlier. Effect sizes below roughly 1 s are **not resolvable with n=1 runs**, and the timing deltas
in §8 should be read with that in mind.

The Wave 1 conclusions do not rest on timing — they rest on **state assertions**, which are binary
and robust: `bgRenderWarmComplete` never→true, `renderWarmed` all-false→all-true, `bgWarmRetries`
6-each→none, WebGPU validation errors 0. Those are what justify Wave 1.

**Before tuning anything further, build a repeated-measures harness** (n≥5 per configuration,
interleaved A/B, reporting median and IQR). `scripts/odyssey-perf-session.mjs --runs N` already
does this shape for boot; the scroll pass needs the same treatment. Continuing to tune against
single runs will produce confident, wrong conclusions.

---

## 10. RC-8 fixed — the background gate now asks the right question

### Root cause, precisely

`updateTravelCurrent` advances `targetPosition` continuously by design (`idleAutoDrift`, default
on — the journey's gentle cinematic forward travel). `updateFollow` then lerps `currentPosition`
toward it at `followLerpSpeed`. **A lerp chasing a constant-velocity target settles at a constant
steady-state lag** — it is a structural property of the control loop, not a transient. Measured on
an idle board: lag `0.000885` vs `cameraSettledThreshold = 0.0008`.

So `_isCameraSettled()` could never return true while the journey drifted, and it was **not** a
tuning slip in the usual sense — the predicate was measuring the wrong quantity. The distance
between a moving target and its follower says nothing about whether the *player* is doing
anything.

### Fix

New `_isScrollIdle()`, used **only** by `_canRunBackgroundTask`. The travel model already separates
the player's contribution: `travelModel.inputVelocity` holds only input-driven velocity and decays
as `exp(-dt * 2.4)`, so one wheel notch (~0.216) falls below the 0.004 threshold after ~1.7 s of
coasting — the backpressure the positional test was reaching for. `_isCameraSettled()` is
deliberately left untouched for its other consumer.

### Measured (idle boot, production build)

| | Before RC-8 | After |
|---|---|---|
| `canRunBackgroundTask` on an idle board | **false** | **true** |
| Render-warm sweep completes | 44 s (and originally: never) | **18.7 s** |
| Per-chapter warm cost | — | 480 / 4 / 4 ms |
| Startup | 3 859–3 960 ms | 3 960 ms (unchanged) |
| WebGPU validation errors | — | 0 |

Guarded by 4 new source assertions, mutation-checked. Suite: **3 579 passing / 357 files**, lint at
baseline.

The first warm of a session still cost 480 ms here while the other two cost 4 ms. That is the
private target's first use (its own allocation + first render-context setup) rather than the
compile-ordering law from §9.1 — in the §8 run all three were 4–5 ms. Worth one cheap follow-up:
touch the warm target once behind the loading overlay so its first use is not paid on a live frame.

### RC-9 (new, unfixed) — the 30 Hz position-work throttle is dead for the same reason

`OdysseyBoardController.js:2675` throttles position-derived work (corridor parallax,
visibility/blend state, boundary preload, global-environment grade) to ~30 Hz when
`_isCameraSettled() && !inSeam`. That predicate is false for the whole journey, so **the throttle
has never engaged** — this work runs every frame, always.

I did not enable it, deliberately: unlike the background gate, this one genuinely wants "is the
camera position static?", and the camera *is* moving during auto-drift. Making it fire during
drift changes the update cadence of visible effects, so it needs capture verification rather than
a predicate swap. Flagged as a real, measurable perf opportunity with a visual risk attached.

### ⚠️ Harness caveat introduced by this fix

The scroll probe drives `cameraController.targetPosition` directly, which **bypasses
`inputVelocity`**. Under RC-8 that now reads as "player idle", so the probe no longer models real
backpressure and its forward-scroll numbers are not comparable across the RC-8 boundary. A faithful
harness must drive `cameraController.scroll(delta)` (the real entry point, line 764) and mark
interaction. Fold this into the repeated-measures harness recommended in §9.

---

## 11. The measurement harness (`scripts/odyssey-hitch-harness.mjs`)

Built because §9 established that single runs cannot adjudicate changes of this size. Four things
it does that the ad-hoc probe did not:

1. **Real input.** It dispatches synthetic `wheel` events at the canvas, so the whole path runs:
   `shouldRouteOdysseyWheel` → `normalizeOdysseyWheelDelta` → `_markInteraction()` →
   `cameraController.scroll()`. A proportional controller sizes each event from the error between
   a position ramp and the camera's actual position, emulating a user scrolling steadily. **This
   matters now**: the old probe assigned `targetPosition` directly, which bypasses
   `travelModel.inputVelocity` — the very signal RC-8 made the background gate read. A
   direct-assignment probe reports "player idle" through an entire scroll and silently measures
   the wrong scheduling behaviour.
2. **Interleaved** variants (A,B,A,B…), not blocked (A,A,B,B), so machine warm-up/throttling
   over a session hits every variant equally.
3. **A discarded warm-up run per variant**, because the first run after a build has a stale
   pipeline cache and behaves like a cold one (§2).
4. **Median + IQR, never the mean** — and it prints an explicit **RESOLVED / NOT RESOLVED** verdict
   per metric from an IQR-overlap test, so nobody eyeballs two medians and declares a win.

```
node scripts/run-electron.mjs scripts/odyssey-hitch-harness.mjs --runs 5 \
  --variant "base=" --variant "noBgWarm=odysseyBgWarm=0"
```

Run it against a **production** build (`npm run build` + `vite preview --port 4173`).

The statistics (`scripts/lib/hitch-stats.mjs`) are a separate module with 10 unit tests
(`tests/unit/odyssey-hitch-stats.test.js`) — deliberately, because the harness itself can only be
exercised on a working WebGPU device, and that device is exactly what becomes unreliable when perf
work goes wrong. One test pins the property that matters most: a failed run's missing metric is
**dropped**, never coerced to 0, so a broken build cannot masquerade as a fast one.

### Status: code-complete, lint-clean, NOT yet validated end-to-end ⚠️

`--help`, syntax, lint and the statistics tests all pass. The full A/B loop has **not** completed a
real run. Two attempts wedged after Chromium logged `GPU state invalid after
WaitForGetOffsetInRange`, and this machine has a recorded history of TDR under repeated WebGPU
sessions, so I stopped rather than risk a crash — this session had already driven a great many
WebGPU boots.

That failure did produce one real improvement: each run is now time-boxed (`--run-timeout-ms`,
default 240 s) and a wedged run is torn down, recorded as `failed`, and excluded from the medians,
instead of hanging the session silently. Before that, a wedged GPU hung the harness indefinitely.

**First action next session, on a fresh boot:** `--runs 2 --settle-ms 6000 --scroll-ms 12000` as a
smoke test, then a real `--runs 5`. Until that passes, treat the harness as unproven.

---

## 12. The One World build, profiled — and a golden suite so it can be moved safely

### It reproduces headless, with no GPU at all

`createOdysseyWorld({ quality: 'high' })` runs to completion in plain Node — these are pure CPU
texture and geometry generators. That makes the largest block on the critical path measurable and
verifiable **without** a working WebGPU device, which matters because that device is exactly what
becomes unreliable when perf work goes wrong.

```
createOdysseyWorld TOTAL      1419.0 ms
  reported bakeMs.relief       711.1 ms   <- the five texture bakes
  remainder                   ~706   ms   <- clipmap + water/cloud lattices, forest scatter,
                                             cloud-field geometry
```

So the ~1220 ms loading-screen longtask from §3 (RC-3) splits almost exactly in half: **half is
texture painting, half is geometry construction.** Both are deterministic — repeated invocations
are byte-identical.

### Why that matters more than it looks

The fix for RC-3 is to move this work either **off the main thread** (a worker: the bakes touch no
GPU and no DOM, so they are worker-safe by construction) or **off runtime entirely** (precompute to
an asset at build time). Both are ordinary engineering. The hard part was never the move — it is
proving the pixels did not shift, on a codebase where the bakes paint the colour structure of two
thirds of the journey.

Determinism turns that into a solved problem: **a byte-identical hash is a stronger guarantee than
a screenshot**, because it admits no tolerance at all. So the prerequisite for the load-time fix is
a golden suite, not a capture rig.

### `tests/unit/odyssey-world-bakes-golden.test.js` (9 tests, added)

Pins `bakeGroundAtlas`, `bakeGroundSunFields` and `bakeOdysseyCloudField` by SHA, plus the
structural invariants that a hash alone would not explain (no channel flat or blown; the sun plate
contains both lit and shadowed texels; the cloud histogram stays ordered — the deck's coverage
bands are calibrated against those deciles).

Until now **nothing asserted these bakes' output at all**, on a codebase that has already been
bitten twice by exactly that gap: the ch5 "razor edges" were two defects in the BAKE (noise that
never tiled, and a rank-remap of tied texels), not in the shader, and were only found by
hand-shading a comparison deck.

Mutation-checked: perturbing one grass term by 0.0001 fails the atlas hash. (A first attempt
mutated `GROUND_ATLAS_WORLD` and correctly did *not* fail — that constant is the shader's tiling
scale, not a bake input.)

The sun-fields test uses a synthetic relief rather than the real one, deliberately, so it pins the
shadowing LOGIC independently of the terrain. Two constraints make that relief non-arbitrary: the
bake spans 9000 units over `shadowRes` texels (~141 units/texel at res 64), so features must be far
coarser than that; and `ODYSSEY_WORLD_SUN` sits ~25° above the horizon, so slopes must exceed ~25°
or nothing self-shadows. A gentler first draft produced a uniformly lit plate — correctly, which is
why the test now documents both bounds.

### Recommended next step for load time

With the goldens in place, take RC-3 in this order:

1. **Split `computeX(res) -> TypedArray` from the `DataTexture` wrapping** in the five bakes. Pure
   extraction; the goldens prove byte-identity.
2. **Move the compute into a worker**, main thread wraps the returned arrays. ~711 ms leaves the
   critical path and the loading screen stops freezing (it currently cannot animate through a
   1220 ms longtask). Keep a synchronous fallback.
3. **Then consider the geometry half** (~706 ms) the same way, which is the larger and more
   invasive job — forest scatter and clipmap construction.

Precomputing to a shipped asset is the alternative to (2). It saves the same time but adds binary
assets and a code/asset drift risk; the worker keeps one source of truth. Prefer the worker unless
the asset is wanted for other reasons.

---

## 13. THE GALAXY GUARANTEE — a travel frontier (opt-in: `?odysseyTravelGate=1`)

### What "do it the Galaxy way" should NOT mean

The naive reading is "hold the loading screen until everything is ready". That is the wrong trade
here and would make the loudest complaint worse: preparation completes around 18.7 s, so it buys a
~19 s loading screen.

Galaxy does not preload the whole game either. It loads the *current galaxy*, and the launch-star
flight between galaxies is a loading cover wearing a costume. **Its guarantee is not "everything is
loaded" — it is "you cannot get to anything unfinished."** Odyssey broke exactly that guarantee,
because it is one continuous scrollable world with no loading covers.

### The rule

`odyssey-travel-frontier.js` computes how far the player may travel right now: to the end of the
last **contiguous** prepared chapter, and no further. Travel eases to a hold just short of an
unprepared boundary and releases the moment it is ready.

Applied to the two continuous-travel paths only — manual scroll and the cinematic auto-drift.
`travelToPosition`/focus are deliberate navigation (entering a level) and are never gated.

Two rules the module will not bend:

- **Fail open.** Malformed positions, a missing predicate, a throwing predicate, a NaN margin — all
  return "no limit". A bug in a perf optimisation must never trap the player behind an invisible
  wall: a stutter is a bad frame, being stuck is a broken game.
- **Contiguous only.** Readiness is scanned forward and stops at the first gap. Under One World,
  chapters 6/7/8 can be ready while an earlier one is not; a prepared 8 must not entitle anyone to
  cross an unprepared 4.

Plus an **anti-softlock release** in the board: a hold outlasting 2.5 s releases and takes the
hitch, and logs — a release means the warm pipeline failed to keep ahead of the player, which is
the most useful diagnostic this system can emit.

### Verified in the real app

Frontier sampled every 250 ms through a real boot with the gate on:

```
t= 6.0s  frontier=0.7503   reveal — Acts I+II open, held at the start of chapter 6
t=16.8s  frontier=0.8669   chapter 6 ready  -> opens to chapter 7
t=18.7s  frontier=0.9569   chapter 7 ready  -> opens to chapter 8
t=19.0s  frontier=1        all ready, no limit
```

`0.7503` is the Act II→space boundary (0.7543) minus the 0.004 margin — it holds exactly where it
should. The camera reached only p=0.019 in that window, so **the gate was never actually felt**: it
is invisible in normal play while making it impossible to outrun preparation. No errors, no
anti-softlock releases fired.

16 unit tests cover the logic, weighted toward the fail-open cases.

### Why it is still opt-in, and what to feel-test before flipping it

The mechanism is verified; the **feel** of an actual hold is not, and that needs human eyes. The
risk case is a player who flicks hard from the reveal: `maxScrollVelocity` 0.15/s means ~5 s of
sustained flicking reaches 0.75, where they would meet the frontier and — worst case — wait out the
2.5 s release. Whether that reads as "a beat at a vista" or "the game is stuck" is a judgement call
this measurement cannot make.

To decide: run with `?odysseyTravelGate=1`, scroll forward as fast as you can from the reveal, and
watch what happens around p≈0.75. If it reads as a natural pause, make it the default (same path
One World took). If it reads as a wall, the fix is to make the hold *expressive* rather than to
abandon it — ease the camera to rest and let the vista breathe, which is precisely what the
launch-star flight is doing.

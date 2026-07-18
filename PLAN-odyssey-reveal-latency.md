# PLAN-odyssey-reveal-latency — stop the loading overlay and camera travel from hiding a ready board

**Rank: 4 of 5.**
Source of truth: `ODYSSEY_MODE_PERFORMANCE_AUDIT.md` findings **OD-07** and **OD-08** (§6.1
and §13), optional stretch **OD-05**. Read those entries first.

## Goal

Two code-verified (`MEASURED_FACT` / `CODE_SUPPORTED_HYPOTHESIS`) defects delay the moment
an Odyssey board becomes visible even when it is already ready:

1. **(OD-07)** Every overlay-shown entry pays **≥ ~2.8 s** before the board appears:
   `OdysseyMode._dismissCinematicLoadingOverlay()` calls
   `dismissCinematicLoadingOverlay(800)` — and the **number form sets only `fadeOutMs`**,
   leaving `minVisibleMs` at the module's `GLOBAL_MIN_VISIBLE_MS = 2000`
   (`src/ui/cinematic-loading-overlay.js:8,204-217`). So even a parked, instantly-resumable
   board waits 2000 ms + 800 ms fade. The masterplan's intended floor was 800 ms. This
   defeats the parked-board fast re-entry the project already built.
2. **(OD-08)** On saves with progress, `_focusBoardLevelForLaunch(levelId, {settle:true})`
   **awaits** `boardController.travelToLevel(...)` — seconds of camera animation —
   serialized *before* the overlay dismiss (`src/core/game-modes/OdysseyMode.js:2385-2404`,
   awaited from the startup path at ~3300-3305). Late-save players wait behind an animation
   they cannot see (it plays under the overlay).

Target experience: parked-board re-entry reveals in < 1.5 s; late-save first entry reveals
in roughly the same time as a fresh save (±0.5 s), with the camera either pre-placed or
traveling visibly after reveal.

## Files to touch

| File | What changes |
|---|---|
| `src/core/game-modes/OdysseyMode.js` | `_dismissCinematicLoadingOverlay()` (~3256): options-object call; pass a context so the parked-resume path can use a lower/zero floor. Startup sequence (~3300–3345): stop awaiting full camera travel pre-reveal |
| `src/ui/cinematic-loading-overlay.js` | No behavior change required (the options form already exists). Only touch if a comment/doc needs correcting |
| `src/rendering/odyssey/OdysseyBoardController.js` | Add an instant camera-placement option: either an `{ instant: true }` option on `travelToLevel` (~1936) or reuse the existing `focusOnLevel` (non-animated) — read both and pick the one that already snaps without animation |
| `tests/unit/cinematic-loading-overlay.test.js` | Extend (it exists) |
| `tests/unit/` new `odyssey-launch-focus.test.js` | Pins the no-await-travel behavior |
| `ODYSSEY_MODE_PERFORMANCE_AUDIT.md` | Tick OD-07/OD-08 with dated notes |

## Guardrails

- Gates after every commit: `npm test`, `npm run typecheck`, `npm run lint:ci`,
  `npm run check:boundaries`, `node scripts/architecture-fitness-check.mjs`.
- **Do not change `GLOBAL_MIN_VISIBLE_MS` itself** — other overlay users (non-Odyssey
  paths, e.g. the caller at `OdysseyMode.js:398` and any other `dismissCinematicLoadingOverlay`
  callers found by grep) keep their current behavior. Change only the Odyssey call sites'
  arguments.
- No new flags. Two commits: (1) OD-07 overlay floor, (2) OD-08 travel.
- OD-05 (reveal-barrier split in `OdysseyBoardController.js:759-762`) is explicitly **out
  of scope** — it changes compile scheduling and needs the perf lane from
  PLAN-odyssey-perf-lane-honesty to prove no first-scroll regression. Do not attempt it
  here.
- This plan does not change shaders/materials, so the WebGPU screenshot rule is not
  triggered; still, if a dev server + browser is available, do one Odyssey entry smoke and
  confirm no flash of unstyled/empty scene (see acceptance 5).

## Steps

### Step 1 — Fix the overlay floor (OD-07)
1. Read `dismissCinematicLoadingOverlay` (`src/ui/cinematic-loading-overlay.js:204-242`)
   until you can state in one sentence what the number form vs options form does. The
   bug: number `800` = `fadeOutMs: 800, minVisibleMs: 2000`.
2. Grep ALL callers of `dismissCinematicLoadingOverlay(`. For each caller decide:
   - Odyssey mode's wrapper `_dismissCinematicLoadingOverlay()` (~3256): change to
     `dismissCinematicLoadingOverlay({ fadeOutMs: 800, minVisibleMs })` where
     `minVisibleMs` comes from a parameter (default `800`).
   - Non-Odyssey callers: leave untouched.
3. Thread the context: the startup sequence around ~3324–3339 already computes its own
   `minOverlayDisplayMs`-based wait (`this._overlayShownAt` / `remaining`) **before**
   calling dismiss — meaning the mode already owns the display-floor policy and the
   overlay's internal 2000 ms floor is double-imposed on top. Find where
   `minOverlayDisplayMs` is set (grep `minOverlayDisplayMs` — sites at ~1386 and ~2351 pass
   `0`) and pass the same value through to the wrapper:
   `this._dismissCinematicLoadingOverlay({ minVisibleMs: minOverlayDisplayMs })` (wrapper
   default stays 800 for callers that pass nothing, e.g. line 398 — inspect that path and
   keep its effective feel: it's a failure/exit path, a shorter floor is fine but must not
   flash; give it the 800 default).
4. Update/extend `tests/unit/cinematic-loading-overlay.test.js`: options form with
   `minVisibleMs: 0` dismisses after only the fade; the Odyssey wrapper passes an options
   object (pin by spying on the imported function via vi.mock, or by exporting the wrapper
   behavior — follow the existing test file's mocking pattern).

**Edge cases a weaker model would miss:**
- The overlay records `shownAt` internally; `minVisibleMs` counts from overlay-show, not
  from dismiss-call. A parked-resume that shows the overlay for 100 ms and passes
  `minVisibleMs: 0` reveals immediately — that is desired, but confirm the fade itself
  (800 ms) still runs so there is no hard cut.
- If the overlay was never shown (some entries skip it — `showLoadingOverlay` false branch
  ~3323), dismiss must remain a harmless no-op. Don't touch that branch's logic.
- `_overlayShownAt` and the overlay module's internal shownAt are two different clocks
  measuring the same thing; don't try to unify them in this plan.

### Step 2 — Stop awaiting camera travel before reveal (OD-08)
1. In the startup path (~3300–3305), `_focusBoardLevelForLaunch(focusLevelId,
   { settle: true })` awaits the full `travelToLevel` animation under the overlay. Change
   the **startup call site only** to pre-place the camera instantly instead:
   - Read `OdysseyBoardController.focusOnLevel` (the `settle:false` branch already calls
     it, ~2402–2404) and `travelToLevel` (~1936–1968). If `focusOnLevel` snaps the camera
     without animation, the startup site simply passes `settle: false` — that may be the
     whole fix. Verify what `focusOnLevel` does to camera position vs only selection
     highlight; if it does NOT move the camera, add an `{ instant: true }` fast path to
     `travelToLevel` that sets the final camera transform without tweening and resolves
     immediately, and call that from the startup site.
2. Keep `settle: true` behavior for interactive navigation
   (`_launchLevelFromNavigator`, ~2414–2425) — a player clicking a level SHOULD see the
   travel animation; only the under-overlay startup path changes.
3. New `tests/unit/odyssey-launch-focus.test.js`: with a stubbed board controller whose
   `travelToLevel` returns a promise that resolves after a fake 3 s timer, the startup
   focus path resolves without advancing the fake timer (i.e. it did not await the
   animation), and the camera-placement method was called with the requested level.

**Edge cases:**
- `travelToLevel` may have side effects beyond the tween (chapter blend weights, level
  selection state, preview updates). The instant path must produce the same **end state**
  — diff what it sets at completion (~1962–1968 region) and replicate exactly; missing a
  chapter-blend update leaves the wrong chapter environment visible on reveal.
- Guard against a null/absent `boardController` exactly as the current code does
  (`this.boardController?.`).
- The existing `catch` + `console.warn` on travel failure must remain — reveal proceeds on
  focus failure today, and must continue to.

### Step 3 — Close the loop
Update `ODYSSEY_MODE_PERFORMANCE_AUDIT.md` §13 rows OD-07/OD-08 with dated "landed" notes
and the new effective floors.

## Acceptance criteria

1. All gates green after both commits.
2. Overlay test proves: options form respected; Odyssey wrapper no longer triggers the
   2000 ms global floor; non-Odyssey callers unchanged (grep list in the commit message).
3. Launch-focus test proves the startup path does not await the travel animation.
4. Code-derived timing claim, stated in the commit message with arithmetic: parked-resume
   reveal floor drops from ~2800 ms (2000 min-visible + 800 fade) to ≤ 800 ms fade (+
   actual readiness time); late-save entry no longer serializes camera-travel seconds
   before reveal.
5. If a browser is available: one manual/scripted Odyssey entry (`npm run dev`, enter
   Odyssey, exit to menu, re-enter) confirming the board appears promptly with no
   flash-of-empty-scene; note the observed `[OdysseyStartup] board visible … ms` console
   line before/after. If no browser/GPU is available in the environment, state that this
   check is deferred to the owner and cite the console line to watch for.

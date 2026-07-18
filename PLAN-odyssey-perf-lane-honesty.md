# PLAN-odyssey-perf-lane-honesty — make the Odyssey perf harness trustworthy (Batch 0)

**Rank: 3 of 5.**
Source of truth: `ODYSSEY_MODE_PERFORMANCE_AUDIT.md` findings **OD-01, OD-02, OD-14,
OD-15** (§13 ranked-findings register) and §3.2/§4.2. Read those sections first. The
audit's central verdict: *no trustworthy Odyssey performance measurement exists* — every
future Odyssey perf decision (fast-start levers, eviction, streaming-tail work) is blocked
on this. This plan is pure tooling + hygiene: **zero rendering-behavior changes**, so no
screenshot validation is required.

## Goal

1. **(OD-02)** `scripts/odyssey-perf-session.mjs` violates the project's own pinning rule:
   adaptive quality and pixel ratio float unless flags are passed, so p95/p99 tails are
   contaminated by the adaptive controller. Pin them **by default** (the screenshot harness
   `scripts/odyssey-chapter-capture.mjs:113-126` already does it — copy its pattern).
2. **(OD-01)** The lane discards evidence: no long-task/memory collection, no multi-run
   aggregation, no machine manifest, output gitignored, and `perf-budgets.json` has no
   consumer. Six small edits fix all of it.
3. **(OD-14)** All `odyssey*` flags are read from URL/localStorage at hardcoded-default
   call sites, never via the registry (`src/core/flags.js:139-172`) — registry defaults can
   silently drift from code. Add a drift-pinning unit test.
4. **(OD-15)** Dead/stale code confuses future work: uncalled
   `ChapterEnvironmentManager.initialize()`, unreferenced `transitionToChapter()` on the
   render path, never-invoked `setCinematicLoadingOverlayBuilding` on the Odyssey path, a
   stale "~22s warm-up" comment (`OdysseyBoardController.js:2306`), and the misnamed
   `odyssey-performance-flags.js`. Delete/rename/correct.

The **real-GPU baseline capture itself (OD-01 acceptance, OD-03) is owner work** — it needs
the RTX/iGPU dev machines. This plan's deliverable is that the owner can produce a
committed, comparable baseline by running two commands.

## Files to touch

| File | What changes |
|---|---|
| `scripts/odyssey-perf-session.mjs` | Default pins; result collection; `--runs N`; machine manifest; output dir |
| `scripts/odyssey-perf-compare.mjs` | Budget check against `perf-budgets.json` (`--fail-on-regression`) |
| `reports/odyssey-perf/` | New committed directory with `README.md`; un-ignore it |
| `.gitignore` | Un-ignore `reports/odyssey-perf/` if a rule covers it (check `git check-ignore -v reports/odyssey-perf/x 2>/dev/null`) |
| `tests/unit/odyssey-flag-registry-drift.test.js` | New (OD-14) |
| `src/rendering/odyssey/ChapterEnvironmentManager.js` | Delete dead `initialize()` / `transitionToChapter()` (verify first) |
| `src/rendering/odyssey/OdysseyBoardController.js` | Fix stale comment (~2306) |
| `src/core/game-modes/OdysseyMode.js` or wherever `setCinematicLoadingOverlayBuilding` should be wired | Delete the dead export or wire it — decide by evidence (see step 5) |
| `src/rendering/odyssey/odyssey-performance-flags.js` (locate with glob) | Rename to match contents, update importers |
| `ODYSSEY_MODE_PERFORMANCE_AUDIT.md` | Tick OD-01/02/14/15 statuses with a dated note |

## Guardrails

- Gates after every commit: `npm test`, `npm run typecheck`, `npm run lint:ci`,
  `npm run check:boundaries`, `node scripts/architecture-fitness-check.mjs`.
- **Never delete code on the audit's word alone** — the audit is 2 commits old. Re-verify
  each OD-15 item with grep at HEAD before deleting; if anything now has a caller, skip it
  and note why.
- The perf scripts must keep working with NO new npm dependencies.
- Commit order: (1) OD-02 pins, (2) OD-01 collection/aggregation/manifest/compare,
  (3) OD-14 test, (4) OD-15 hygiene. Four commits.

## Steps

### Step 1 — Default pins (OD-02)
In `odyssey-perf-session.mjs` `makeUrl()` (~lines 65–85): today
`odysseyDisableAdaptiveQuality` and `odysseyPixelRatio` are only set when CLI args are
passed. Make the pinned configuration the default:
- Always set `odysseyDisableAdaptiveQuality=1` unless a new `--allowAdaptive` arg is given.
- Always set `odysseyPixelRatio=1` unless `--pixelRatio <v>` overrides it.
Record both effective values in the session manifest (step 2). Mirror exactly what
`odyssey-chapter-capture.mjs` pins (`odysseyPixelRatio: '1'`,
`odysseyDisableAdaptiveQuality: '1'`); do NOT copy its
`odysseyDisableBackgroundLoading: '1'` — background loading is part of what the perf lane
measures (the audit only faults adaptive+DPR pinning).

### Step 2 — Evidence collection, aggregation, manifest, committed output, budget consumer (OD-01)
All in `odyssey-perf-session.mjs` unless noted. Read the whole script first; it already has
a `collectResult`-style step harvesting in-page data.
1. **Collect more:** in the in-page collection step, also pull (when the page exposes
   them): `getLongTaskSummary()`, `performance.memory` (usedJSHeapSize etc.), and
   `getReleaseGateSnapshot()`. Grep `src/` for those function names first to get the exact
   window-scoped names; guard each with existence checks so a missing hook records `null`,
   never throws.
2. **`--runs N` aggregation:** add a `--runs` arg (default 1). Loop the existing
   single-run flow N times (fresh page each run), then emit an aggregate block: per-metric
   median, p95, min/max across runs. Keep individual run payloads in the output.
3. **Machine manifest:** each output file gets a `manifest` object: `os.platform()`,
   `os.release()`, `os.cpus()[0].model`, total RAM, the GPU adapter info as reported by the
   page (grep for how the page exposes `adapter.info` / renderer name; `null` if absent),
   the full effective URL/flag set, script args, commit hash (`git rev-parse HEAD` via
   `child_process`), and ISO date.
4. **Committed output dir:** write results to `reports/odyssey-perf/` (create it with a
   `README.md` explaining: what a baseline is, the two commands to produce one, and that
   `artifacts/` remains gitignored scratch). If `.gitignore` covers the path, add a
   negation rule. Baseline naming: `baseline-<machine-tag>-<cold|warm>-<fresh|late>.json`.
5. **Budget consumer:** in `odyssey-perf-compare.mjs`, add `--fail-on-regression`: load
   `perf-budgets.json`, and for any metric present in both the comparison result and the
   budgets file (e.g. `frameP95Ms.perSurface.odyssey` once a baseline exists), exit
   non-zero when the candidate exceeds `max` (or exceeds baseline by >10% where only a
   baseline exists). Print a table of metric/baseline/candidate/verdict. Metrics with
   `null` baselines are reported as `SKIPPED (no baseline)` — never a failure.

**Edge cases:** (a) don't call `Date.now()`-dependent naming inside any code path that
lands in the manifest twice with different values — stamp once per run; (b) aggregation
with `--runs 1` must produce the same file shape (aggregate of one), so `compare` handles
both; (c) `performance.memory` is Chromium-only and may be absent — `null`, not crash.

### Step 3 — Flag-registry drift test (OD-14)
New `tests/unit/odyssey-flag-registry-drift.test.js`. Approach: for each `odyssey*` flag in
`src/core/flags.js` (~139–172) that declares a default, assert the registry default equals
the hardcoded default at its call site. Implementation that avoids brittle line references:
export (or read via the existing registry API) the flag names + defaults, then for each
flag, grep-free assertion by importing the module that owns the call-site default IF it
exports it; where the default is buried in a non-exported literal, fall back to reading the
source file as text in the test and matching the documented pattern (e.g.
`readOdysseyFlag('odysseyFastStart', true)` style). Read `src/core/flags.js` first — if it
already exposes a `describeFlags()`/registry map, prefer asserting against that. The test's
purpose is to FAIL when someone changes a call-site default without updating the registry
(or vice versa). Keep it to the `odyssey*` namespace.

**Edge case:** do not "fix" OD-14 by rerouting Odyssey reads through `readFlag()` in this
plan — that is a behavior change touching startup paths; the audit explicitly allows the
test-only remediation.

### Step 4 — Dead/stale code hygiene (OD-15)
For each item, verify at HEAD, then act:
1. `ChapterEnvironmentManager.initialize()` — `grep -rn "\.initialize(" src | grep -i chapter`
   plus a search for dynamic calls. If uncalled: delete the method. Run the
   ChapterEnvironmentManager tests.
2. `transitionToChapter()` — same verification; the audit says unreferenced on the render
   path. If any test references it, delete the test with it (it pins dead code).
3. `setCinematicLoadingOverlayBuilding` — grep callers. If never invoked on the Odyssey
   path and nowhere else: delete the export and its implementation from
   `src/ui/cinematic-loading-overlay.js`. If invoked elsewhere (non-Odyssey), leave it and
   only note it.
4. Stale "~22s warm-up" comment at `OdysseyBoardController.js:2306` (find by grepping
   `22s\|22 s\|~22`): rewrite the comment to describe current behavior (read the
   surrounding code; if you cannot determine current behavior confidently, replace the
   number with "historical figure — re-measure via scripts/odyssey-perf-session.mjs").
5. `odyssey-performance-flags.js` (locate with `Glob src/**/odyssey-performance-flags.js`):
   read it; rename to describe its actual contents (audit: "contains no flags"), update all
   importers, run `npm run check:boundaries`.

### Step 5 — Close the loop on the audit doc
Edit `ODYSSEY_MODE_PERFORMANCE_AUDIT.md` §13: mark OD-02 as landed (pins default-on),
OD-01 as "harness landed — baseline capture pending (owner, RTX + iGPU machines)", OD-14
as landed (drift test), OD-15 as landed (list what was actually deleted vs skipped-with-
reason). Date each note.

## Acceptance criteria

1. `node scripts/odyssey-perf-session.mjs --help` (or running with a bogus URL) shows the
   new args; a run against the dev server produces a JSON containing: pinned
   `adaptive:disabled`, `dpr:1` (or explicit override), the machine manifest, long-task/
   memory/release-gate fields (nullable), and — with `--runs 3` — an aggregate block with
   median and p95 per metric. (In a headless/software-GPU environment Odyssey may
   device-lose before start — audit OD-03. If so, verify to the point of page launch +
   manifest emission and state that limitation explicitly in the commit message.)
2. `node scripts/odyssey-perf-compare.mjs --fail-on-regression` exits 0 with all-null
   baselines (all rows SKIPPED) and exits non-zero when fed a fixture candidate exceeding a
   fixture baseline by >10% (add a tiny fixture-based unit or script self-test proving
   both).
3. `reports/odyssey-perf/README.md` exists, is committed, and documents the exact
   owner-run commands for the four baseline cells (cold/warm × fresh/late).
4. The drift test fails when an odyssey flag registry default is flipped locally (prove
   once by temporary mutation, then revert) and passes at HEAD.
5. All OD-15 deletions verified by grep at HEAD before removal; `npm test`,
   `npm run typecheck`, `npm run lint:ci`, `npm run check:boundaries` green after every
   commit.
6. Zero changes under `src/` that alter runtime rendering behavior (OD-15's deletions are
   dead paths; the diff proves it).

# reports/odyssey-perf — committed Odyssey performance baselines

This directory is the **committed** home for Odyssey perf-lane results
(audit `ODYSSEY_MODE_PERFORMANCE_AUDIT.md` finding OD-01: the lane previously
wrote only to the gitignored `artifacts/`, so **no committed baseline ever
existed**). `artifacts/` remains gitignored scratch for exploratory runs; a
result that a future decision will be measured against belongs **here**, in git.

## GPU-time splits (Wave −1)

Frame-time from `rAF` presentation deltas — what a *baseline* records — is **not GPU time**.
§2.5 of `docs/ODYSSEY_ONE_WORLD_PLAN_2026-08.md` says so explicitly, and the existing
`baseline-rtx5080-*` files are exactly that metric. Wave −1 exists to add the missing one.

```sh
node scripts/run-electron.mjs scripts/odyssey-gpu-split.mjs --lane A
node scripts/run-electron.mjs scripts/odyssey-gpu-split.mjs --lane B --low-power
#   → reports/odyssey-perf/gpu-split-lane{a,b}.json
```

Two things to know before reading one of these files:

**It is differential, not per-pass.** three r181's WebGPU backend exposes one timestamp scope
per render type, and `PostProcessing` renders its whole graph inside a single call, so there is
nowhere to hang a per-pass query without forking the renderer. Each configuration instead
removes one system and the delta against baseline is attributed to it. Overlapping cost lands
on whichever system is removed first, so the figures do not have to sum to the baseline.

**Read `baselineDriftMs` first.** Baseline runs first and last. Any delta smaller than the
drift between them is noise, not a measurement — thermal throttling on a laptop is easily
worth more than a whole system's cost.

Discipline, enforced in `src/utils/perf-ring.js` and covered by tests: p50/p95/p99 from a
fixed-size ring, **no mean is recorded anywhere**, and startup samples are discarded before the
sampling window opens so a cold pipeline compile cannot be laundered into steady state.

## What a baseline is

A baseline is one session JSON produced by `scripts/odyssey-perf-session.mjs`
on a **named machine** with the **pinned configuration** (adaptive quality
disabled + devicePixelRatio 1 — the script pins both by default since
2026-07-18), containing:

- `manifest` — machine identity (OS/CPU/RAM/GPU adapter), commit hash, the
  full effective URL/flag set, and the recorded pins (`adaptive: disabled`,
  `dpr: 1`).
- `runs[]` — every raw run payload (frame-time summary, long tasks, heap,
  release gates, spikes, counters, startup lines).
- `aggregate` — per-metric median/p95/min/max across `--runs N` (use
  `--runs 5` for baselines; single runs are anecdotes, not baselines).

`scripts/odyssey-perf-compare.mjs --fail-on-regression` consumes
`perf-budgets.json` against a candidate session: exceeding a declared `max`
fails, exceeding a declared baseline by >10% fails, and null baselines are
reported `SKIPPED (no baseline)` — never a failure.

## Producing a baseline — one command (committed mode)

> ⚠️ **`npm run perf:odyssey:baseline` on its own is NOT a committed baseline.**
> Without `--committed` it runs an *exploratory* sweep (cache × scenario, single
> run) into gitignored `artifacts/` — useful for smoke/exploration, but it leaves
> this directory empty and the budget SKIPPING. For the OD-01 committed baseline
> pass `--committed`.

```sh
# starts + stops its own dev server; runs the pinned cells into THIS dir.
npm run perf:odyssey:baseline -- --committed --tag <machine-tag>
#   → reports/odyssey-perf/baseline-<tag>-cold-fresh-load.json
#   → reports/odyssey-perf/baseline-<tag>-warm-fresh-load.json
#   → reports/odyssey-perf/baseline-<tag>-index.json
```

`--tag` is required (e.g. `--tag rtx5080` / `--tag igpu`) so cells are named
`baseline-<tag>-<cache>-<save>-<scenario>.json`. Preview the exact plan without
spawning a dev server or Electron with `--dry-run`. Add `--caches cold` to do
only one cache.

> **Which scenario feeds the frame budget?** `--scenario idle` (steady-state).
> The default `load` scenario's `frame.p95` includes board-activation and
> shader-compile hitches — a useful *startup* diagnostic (see also `boardVisibleMs`
> / `startup.totalMs`), but far above steady-state, so it must NOT seed
> `frameP95Ms.perSurface.odyssey`. Capture the budget seed with:
> `... --committed --tag <tag> --caches cold --scenario idle`.
>
> **On finicky GPUs, use `--runs 1`.** Multiple in-process page reloads
> (`--runs N`) can crash the GPU process on some adapters (`GPU state invalid`
> → `ERR_FAILED` on the 2nd load). One page-load per process is safe; get
> multi-sample stability from separate invocations instead.
>
> The `manifest.backend` field records whether frames were served by `webgpu` or
> a `webgl2` fallback — check it, since a null `gpu.adapter` alone can't tell them
> apart and the two aren't perf-comparable.
>
> **Which physical GPU?** On a hybrid-graphics laptop, always confirm
> `manifest.webglRenderer` names the discrete adapter (e.g. an NVIDIA/RTX string),
> not the iGPU (`AMD Radeon 610M`). The harness applies `force_high_performance_gpu`
> (matching `electron/main.js`), but Windows' **per-app graphics preference can
> still override it**. If a capture shows the iGPU: Settings → System → Display →
> Graphics → *Add desktop app* → `node_modules/electron/dist/electron.exe` →
> Options → **High performance**, then re-run. Do the same for the packaged game
> exe. Tag the file for the GPU that actually rendered (`--tag rtx5080` only if
> `webglRenderer` confirms it).

**Late-save cells** (`cold-late` / `warm-late`) can't be fully automated — a late
save only exists after playing to a late chapter once. Prime a dedicated profile
by playing to chapter 7–8, then:

```sh
npm run perf:odyssey:baseline -- --committed --tag <tag> \
  --late-profile-dir artifacts/odyssey/perf-profiles/late-save
```

For a *true* cold cache on the late cell, delete that profile's `GPUCache/`
subdir (keep `Local Storage/`) before the run.

### Or run a single cell by hand

```sh
# 1. dev server (leave running)
npm run dev -- --host 127.0.0.1 --port 4177 --strictPort

# 2. the pinned, aggregated session (repeat per cell, see naming below)
node scripts/run-electron.mjs scripts/odyssey-perf-session.mjs \
  --runs 5 --cache cold --scenario load --reset-profile \
  --output reports/odyssey-perf/baseline-<machine-tag>-cold-fresh.json
```

Real-GPU baselines are **owner work** (RTX + iGPU dev machines — audit OD-03:
this repo's CI/container environment device-loses under SwiftShader before
Odyssey starts, so no meaningful frame data can be captured there).

## Baseline naming: the four cells

`baseline-<machine-tag>-<cold|warm>-<fresh|late>.json`, e.g.
`baseline-rtx5080-cold-fresh.json`, `baseline-igpu-warm-late.json`.

| Cell | Cache | Save state | How |
|---|---|---|---|
| cold-fresh | cold Dawn/GPU cache | fresh save (chapter 1) | `--cache cold --reset-profile` on a profile with no Odyssey save |
| cold-late | cold Dawn/GPU cache | late save (chapter 7–8) | `--cache cold --profile-dir <dir-with-late-save> ` (do **not** `--reset-profile`; prime the save once by playing to a late chapter in that profile) |
| warm-fresh | warm Dawn/GPU cache | fresh save | `--cache warm --profile-dir artifacts/odyssey/perf-profiles/warm` after one throwaway priming run in the same profile |
| warm-late | warm Dawn/GPU cache | late save | `--cache warm` against the primed late-save profile |

Cache-state definitions: audit §6.3. Cold multi-run caveat: within one
invocation, `--runs` 2..N reuse the Electron profile (Dawn cache goes warm) —
for strict cold cells run N separate invocations and aggregate, or accept the
recorded `coldCacheCaveat` note in the manifest.

## Comparing / gating

```sh
node scripts/odyssey-perf-compare.mjs \
  --before reports/odyssey-perf/baseline-<tag>-cold-fresh.json \
  --after  artifacts/odyssey/perf/<candidate>.json \
  --fail-on-regression            # budget check vs perf-budgets.json
node scripts/odyssey-perf-compare.mjs --self-test   # proves both exit behaviors
```

Once a real baseline lands here, copy its aggregate `frame.p95` median into
`perf-budgets.json` → `budgets.frameP95Ms.perSurface.odyssey` so the budget
check stops SKIPPING and starts gating.

## The two standing lanes (audit SB-09)

**Per-PR (hosted CI, no measurement)** — `npm run perf:budgets:gate`
(`scripts/perf-budgets-gate.mjs`, wired into `pages.yml`): compare-tool
self-test + `perf-budgets.json` structural lint + every committed
`baseline-*-idle.json` re-checked against the declared budgets. Catches
budget/baseline drift (tightening a budget below committed evidence, or
committing a regressed baseline) without pretending hosted runners can render.

**Nightly (real hardware)** — `npm run perf:odyssey:nightly`
(`scripts/odyssey-perf-nightly.mjs`): captures a fresh pinned cold/idle cell
into `artifacts/odyssey/perf-nightly/<stamp>/` (own dev server, single run —
see the `--runs 1` GPU note above), then runs
`odyssey-perf-compare --fail-on-regression` against the newest committed idle
baseline (override with `--baseline <file>`). Exit code is the verdict.
Schedule on the capture machine (adjust path/time):

```bat
schtasks /Create /TN "SerenityBlocksPerfNightly" /SC DAILY /ST 03:30 ^
  /TR "cmd /c cd /d C:\Users\olovm\serenity-blocks && npm run perf:odyssey:nightly >> artifacts\odyssey\perf-nightly\nightly.log 2>&1"
```

Do **not** run it `--hide` (hidden windows throttle to 1 fps) and confirm
`manifest.webglRenderer` names the intended GPU (per-app graphics preference
gotcha above).

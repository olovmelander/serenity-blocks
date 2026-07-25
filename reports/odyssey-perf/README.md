# reports/odyssey-perf — committed Odyssey performance baselines

This directory is the **committed** home for Odyssey perf-lane results
(audit `ODYSSEY_MODE_PERFORMANCE_AUDIT.md` finding OD-01: the lane previously
wrote only to the gitignored `artifacts/`, so **no committed baseline ever
existed**). `artifacts/` remains gitignored scratch for exploratory runs; a
result that a future decision will be measured against belongs **here**, in git.

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
# starts + stops its own dev server; runs the pinned, --runs 5 cells into THIS dir.
npm run perf:odyssey:baseline -- --committed --tag <machine-tag>
#   → reports/odyssey-perf/baseline-<tag>-cold-fresh.json   (feeds the budget)
#   → reports/odyssey-perf/baseline-<tag>-warm-fresh.json
#   → reports/odyssey-perf/baseline-<tag>-index.json
```

`--tag` is required (e.g. `--tag rtx5080` / `--tag igpu`) so cells are named
`baseline-<tag>-<cache>-<save>.json`. Preview the exact plan without spawning a
dev server or Electron with `--dry-run`. Add `--caches cold` to do only the
budget-feeding cell.

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

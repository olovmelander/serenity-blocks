# Theme bench tools

Runners and printers around `scripts/theme-fleet-bench.mjs`. Every tool reads the results directory
from `BENCH_OUT` (the `--out` the bench wrote to). Cells live in `$BENCH_OUT/<tag>/cells/<theme>.json`,
with `summary.json` and `table.md` beside them.

| Tool | Use |
|---|---|
| `ab.sh <tag> <themes> <rounds> <urlA> <urlB>` | interleaved A/B of two served builds, uncapped (frame rate) |
| `ab-table.mjs <tag> <rounds>` | its table: rest and worst-storm fps per arm |
| `ab-load.sh <tag> <themes> <rounds> <urlA> <urlB>` | interleaved load A/B at the panel's cadence (vsync on, second visits) |
| `ab-load-table.mjs <tag> <rounds>` | its table: shown/running ms cold and warm, GPU device time, freezes |
| `tier-matrix.mjs [High=<tag>] …` | each theme's worst-window frame time per tier relative to its own High, with out-of-step flags (defaults: tags `tier-<Tier>`) |
| `tier-compare.mjs <high summary.json> <tier summary.json> <label>` | one tier against High, sorted by cost |
| `cadence-table.mjs <summary.json>` | a `--vsync=1` run: late frames, loads and freezes per theme |
| `cell-print.mjs <cell.json>` | one cell: load marks and long frames, window stats |
| `console-print.mjs <cell.json>` | a cell's console warnings/errors grouped by bench phase |
| `census-print.mjs <cells…>` / `passes-print.mjs <cells…>` | output of the census / pass-profile snippets |

Rules that cost a day to learn (docs/THEME_FLEET_240_2026-10.md §3):

- **Compare only runs made close together in time.** On 2026-10-27 the same High build read 35-50 % slower
  in the morning than in the afternoon for some themes. Interleave arms, take two rounds or more.
- **Read loads from `--vsync=1` runs.** An uncapped anchor starves the incoming theme's pipelines.
- **Leave the machine alone during a run.** No vitest, no builds, no other GPU work.

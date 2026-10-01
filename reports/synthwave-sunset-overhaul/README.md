# Synthwave Sunset overhaul — evidence (2026-10-01)

Before: `origin/main` 6bed3920. After: branch `feature/synthwave-sunset-visual-overhaul`.

## Look

| File | What it shows |
| --- | --- |
| `before-ingame-high-t12.jpg` | Old theme in the real app (perf-lane window, High) |
| `after-ingame-high-noboard.jpg` | New theme, same capture state (no board on screen → centred sun) |
| `after-playground-menu-centred.jpg` | `?effect=synthwave-sunset&board=0` — the centred "menu" shot |
| `after-playground-game.jpg` | Mock board + HUD: the sun is solved into the free zone left of the board |
| `after-playground-game-combo.jpg` | Combo ×4: grid shifts to violet, sun corona sparks |
| `after-playground-tetris-clear.jpg` | Tetris: sun flare, corona, sonar ring on the grid, horizon flash |
| `after-playground-piece-lock.jpg` | Piece locks: neon tetromino cells on the grid |
| `after-playground-low-tier.jpg` | `quality=Low` (no bloom) |
| `after-playground-webgl2-menu.jpg` | `forceWebGL=1` — the WebGL2 backend renders the same node path |

## Performance (theme perf lane, ADR-0016)

Instrument: `node scripts/validate-all-themes.mjs --perf --theme synthwave-sunset --skip-build
--port 4185 --perf-idle-ms 10000 --perf-settle-ms 12000`, RTX 3070 (`force_high_performance_gpu`),
quality High, window 1584×787 at pixel ratio 1. Arms INTERLEAVED (before, after, before, …)
from two worktrees with pre-built `dist/`; no contending GPU/CPU jobs (checked before each run).
Raw cells: `perf-cells/{before,after}-{1..4}.json`.

The 12 s settle is deliberate: with the default 4 s, the app's startup pixel-ratio
recommendation (0.9) lands inside the idle window of the FASTER-switching theme only, so the
after arm measured fewer pixels than the before arm. `after-4` still caught it (ratio 0.9) and is
excluded from the GPU comparison below; every other cell held ratio 1.0 for the whole window.

| Median | Before (n=4) | After (n=3) |
| --- | --- | --- |
| GPU p50 | 0.59 ms | 0.39 ms |
| GPU p95 | 0.72 ms | 0.72 ms |
| CPU submit p50 / p95 | 3.25 / 5.1 ms | 1.8 / 3.1 ms |
| Draw calls | 111 | 22 |
| Theme switch (wall) | 392 ms | 266 ms |
| First frame GPU-complete | 2.46 s | 2.53 s |
| Pipelines (all synchronous) | 23 | 17 |

GPU timestamps resolve in 0.0655 ms quanta: p50 differs by three quanta, p95 by none. Every
cell is flagged inadmissible by the lane for one reason — "the theme also resets renderer.info —
latched draw counts are a partial frame" — which concerns the draw-count latch, not the timing
fields; it applies to both arms.

The first frame is still dominated by synchronous pipeline compilation on a hub switch (~2.2 s
between the first render call and GPU completion, before and after). A
`compileGroupThroughPost` warm (see `src/rendering/odyssey/warmup/post-target-compile.js`) is
the documented lever if that gap is to be cut; it was not attempted here.

## Tooling note

`scripts/capture-theme-screenshots.mjs`: `--perf` hung silently on this machine for every theme
(Electron 38's CDP `Page.enable` never resolves on a webContents that has not navigated). The
worker now commits `about:blank` before attaching the debugger.

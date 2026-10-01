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

Measured on the shipped code (scene-pass 4x MSAA on High, box-filtered windows).

Instrument: `node scripts/validate-all-themes.mjs --perf --theme synthwave-sunset --skip-build
--port 4185 --perf-idle-ms 10000 --perf-settle-ms 12000`, RTX 3070 (`force_high_performance_gpu`),
quality High, window 1584x787 at pixel ratio 1. Arms INTERLEAVED (before, after, before, ...)
from two worktrees with pre-built `dist/`. A sampler polled for contending jobs every 2 s during
each run (a peer project's Playwright suite runs SwiftShader headless Chrome in bursts on this
machine); runs that saw one were discarded, and runs only started after 15 s of quiet. Raw clean
cells: `perf-cells/{before,after}-{1..3}.json`; every cell held pixel ratio 1.0 for its window.

The 12 s settle is deliberate: with the default 4 s, the app's startup pixel-ratio
recommendation (0.9) lands inside the idle window of the FASTER-switching theme only, so the
after arm would measure fewer pixels than the before arm.

| Median (n=3 each) | Before | After |
| --- | --- | --- |
| GPU p50 / p95 | 0.59 / 0.72 ms | 0.39 / 0.59 ms |
| CPU submit p50 / p95 | 2.6 / 3.3 ms | 1.6 / 2.0 ms |
| Wall p95 | 8.4 ms | 8.2 ms |
| Draw calls | 111 | 22 |
| Theme switch (wall) | 378 ms | 224 ms |
| First frame GPU-complete | 2.46 s | 2.43 s |
| Pipelines (all synchronous) | 23 | 17 |

GPU timestamps resolve in 0.0655 ms quanta. Every cell is flagged inadmissible by the lane for
one reason - "the theme also resets renderer.info - latched draw counts are a partial frame" -
which concerns the draw-count latch, not the timing fields; it applies to both arms.

The first frame is still dominated by synchronous pipeline compilation on a hub switch (~2.2 s
between the first render call and GPU completion, before and after). A
`compileGroupThroughPost` warm (see `src/rendering/odyssey/warmup/post-target-compile.js`) is
the documented lever if that gap is to be cut; it was not attempted here.

## Window shimmer fix (follow-up)

`city-closeup-3x-{before,after}-aa-fix.jpg` (downtown, 3x nearest-neighbour). Not z-fighting:
a scan of the generated city found no near-coplanar faces (<0.08 u) among 250 boxes. The
"glitching" was aliasing under camera motion (pointer parallax, the composition pan):
- windows are box-filtered over the pixel footprint (`swFilteredPulse`), and per-cell random
  choices blend to their expected value (per floor across edge-on faces) once a pixel spans cells
- neon roof bands and corner strips use the energy-conserving line AA instead of thresholds
  (they no longer break into dashes)
- scene-pass MSAA 4x is back on High and up for geometric silhouettes (box edges, palm trunks,
  ridges) - still cheaper than the old MRT + 4x MSAA pass, per the table above
- dynamic resolution judges frame time against the player's Target Frame Rate (never faster
  than 60 Hz); before, a 30 FPS cap read as overload and one hitch at 60 Hz lowered the
  resolution for the rest of the session, re-sampling every window at each step

## Tooling note

`scripts/capture-theme-screenshots.mjs`: `--perf` hung silently on this machine for every theme
(Electron 38's CDP `Page.enable` never resolves on a webContents that has not navigated). The
worker now commits `about:blank` before attaching the debugger.

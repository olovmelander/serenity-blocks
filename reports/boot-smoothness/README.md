# Boot / loading smoothness evidence (ADR-0020)

Measured 2026-09-29/30 on the dev machine (Electron 38 / Chromium 140, D3D12, RTX via
`force_high_performance_gpu`), fresh cold profile per run, one Electron process at a time, no
workflows or vitest running. Instrument: `scripts/boot-smoothness-probe.mjs` (ADR-0016).

- **visibleFrozenMs**: frame gaps ≥ 150 ms not covered by renderer-main-thread work. That work is
  GPU-process starvation, which freezes everything on screen, CSS loading screens included.
- **mainThreadOnlyMs**: gaps covered by long-animation-frame blocking time. These stall rAF canvases
  (the intro, the warp), but the compositor keeps CSS animations moving.

| Run | File | On screen | Frozen (visible) | Sync / async pipelines |
|---|---|---|---|---|
| Default cold boot, before | `baseline-default-cold.json` | ident 14.0 s | 9.9 s total (split not recorded) | 40 / 0 |
| Default cold boot, after | `r3-default-cold.json` | ident 10.1 s | 2.7 s total, 1.8 s visible; warp window 0 | 5 / 35 |
| neon-district cold boot, before | `baseline-neon-cold.json` | ident 22.6 s | 18.5 s total | 198 / 31 |
| neon-district cold boot, after | `r2-neon-cold.json` | ident 33.2 s | 13.3 s total, 2.9 s visible; warp window 0 | 15 / 211 |
| Cold neon-district mode entry, legacy (`?themeWarmAsync=0`) | `step5-legacy.json` | overlay motion hidden (calm-hold) | 8.4 s total behind it | 102 / 2 |
| Cold neon-district mode entry, after | `r3-neon-coldentry.json` | overlay moving throughout, reveals the built city ~11.5 s after the click | 4.1 s total, 0.3 s visible | 10 / 185 |

Before, the default boot's visible freezes came mostly from the intro's first frame, its PMREM
bake and the boot-warp prime. Neon's came from the prewarm's live render frames. What still
freezes after the change:
- the early page-load stall (~0.9 s before the game starts);
- the exempt synchronous creates: the final composite and PMREM bakes.

The neon boot is longer because the warp waits for neon's own progressive shader prewarm. That
prewarm now shares Dawn's worker pool with the theme's async live pipelines. The ident keeps moving
throughout. Run-to-run variance on neon is large.

Contact sheets:

- `r3-handoff-sheet.png`: default boot at `boot-warp:play-start` +0 / +90 / +300 ms. The first
  frame is the moving ident hold. The second is the match-cut: the GPU replica of the ident, with
  the flare starting. The third is the flare.
- `r3-entry-sheet.png`: cold neon-district entry at +1.2 / 3 / 6 / 9 / 11.5 / 14 s. The first frame is
  under the calm-hold (motion hidden). The motion is back once the build proves async, and the
  overlay reveals onto the built city.
- `step5-ab-sheet.png`: the legacy calm-hold entry against the first async entry.
- `../playground/boot-warp-final-sheet.png`: the warp at t = 0.1 / 0.6 / 4.5 / 5.2 / 6.5 s
  (`scripts/playground-phase-capture.mjs --effect=logo-warp-transition`).
- `../playground/warp-final-gpu.png` / `warp-final-css.png`: the match-cut check
  (`--ident-compare=1`). The first is the warp's first frame alone (GPU); the second has the real
  CSS ident drawn on top. Apart from the wordmark, which the GPU does not draw (it dissolves on
  its own), they match: median difference 2/255, 0.9 % of pixels over 8/255 (the wordmark). The
  capture log recorded no WebGPU validation errors.

Reproduce (Vite dev server on :5173):

```sh
node scripts/run-electron.mjs scripts/boot-smoothness-probe.mjs --port 5173 --duration 40000 \
  --out reports/boot-smoothness/<tag>.json
node scripts/run-electron.mjs scripts/boot-smoothness-probe.mjs --port 5173 --duration 45000 \
  --theme neon-district --out reports/boot-smoothness/<tag>.json
node scripts/run-electron.mjs scripts/boot-smoothness-probe.mjs --port 5173 --duration 70000 \
  --theme neon-district --url-params=noThemeWarm=1 --scenario=mode-entry --mode=single \
  --entry-offsets=1200,3000,6000,9000,11500,14000 --out reports/boot-smoothness/<tag>.json
```

Pass URL-like values inline (`--key=value`); Chromium treats a loose `a:b` argument as a URL.

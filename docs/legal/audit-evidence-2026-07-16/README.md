# Rendered-product evidence — preliminary Tetris IP audit (2026-07-16)

Captured for `tetris_legal_review.md` (v4.0). Method and environment:

- **Commit:** `853d40e17e8ce25e6fab9786a151e5f41e30acd5` (repo HEAD at audit time)
- **Build:** Vite dev server (`npm run dev`), web target, no Electron shell
- **Browser:** Playwright-driven Chromium 1194, headless, 1600×900
- **GPU:** software rendering only — ANGLE/Vulkan on SwiftShader (see `gpu-caps.json`);
  **WebGPU unavailable**, so Three.js surfaces ran their WebGL2 fallbacks and the
  WebGPU intro path (`threejs-intro-renderer-webgpu.js`) did not execute
- **Theme:** default first-entry theme (`forest`); no other theme was captured
- **Input:** synthetic keyboard/mouse (arrows, rotate, Space hard-drop, Escape)

## Captures

| File | What it shows |
|---|---|
| `01-startup-ident.png` | Startup ident: diamond logo + `SERENITY BLOCKS` wordmark (~6 s after load) |
| `02-startup-or-menu.png` | "Press any key / click / tap to begin" screen (~12 s) |
| `03-main-menu.png` | Main menu, six mode cards; Single Player shows the person-in-ring "solo focus" icon |
| `04-single-player-early.png` | Single-player start: bordered 10×20 field, 3-slot top preview row, ghost silhouette, stats cards |
| `05-gameplay-stack.png` | Mid-game stack after scripted hard drops (no line clear occurred) |
| `06-pause.png` | Escape during play opens the Settings panel (DAS/soft-drop sliders) |
| `07-late-stack-or-gameover.png` | Tall central stack immediately before top-out |
| `08-gameover.png` | Game-over: custom "The cycle ends." statistics modal (no board-fill animation) |
| `09-menu-after-20s.png` / `10-menu-after-40s.png` | Main menu after 20 s / 40 s idle — no drifting intro tetrominoes appeared in this software-rendered environment (the source spawns them; see review §Copyright) |

## Known gaps (material limitations)

- No line-clear, cascade, garbage, or multiplayer capture
- No WebGPU rendering (intro/Odyssey chapters unverified as rendered)
- Only the default theme; none of the ~60 selectable themes captured
- Web dev build only — no packaged Electron/Steam artifact, store page, or marketing assets

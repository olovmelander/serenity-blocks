# Neon District rendering evidence

`final/report.json` records the six production-theme capture profiles. Each profile
includes ambient, piece-lock, four-line clear and combo frames, backend identity,
effect-pool budgets, finite geometry/transform checks and graphics console output.

| Profile | Native WebGPU | Forced WebGL2 |
| --- | --- | --- |
| High desktop, 1280×720 | [Ambient](final/webgpu-desktop-ambient.png) · [Combo](final/webgpu-desktop-combo.png) | [Ambient](final/webgl2-desktop-ambient.png) · [Combo](final/webgl2-desktop-combo.png) |
| Low portrait, 390×844 | [Ambient](final/webgpu-mobile-ambient.png) · [Combo](final/webgpu-mobile-combo.png) | [Ambient](final/webgl2-mobile-ambient.png) · [Combo](final/webgl2-mobile-combo.png) |
| Low landscape, 844×390 | [Ambient](final/webgpu-mobile-landscape-ambient.png) · [Combo](final/webgpu-mobile-landscape-combo.png) | [Ambient](final/webgl2-mobile-landscape-ambient.png) · [Combo](final/webgl2-mobile-landscape-combo.png) |

To reproduce, install Playwright or provide `PLAYWRIGHT_MODULE` and
`PLAYWRIGHT_EXECUTABLE_PATH`, then run from the repository root:

```sh
node scripts/neon-district-visual-validation.mjs --lane both --offscreen \
  --out reports/neon-district-overhaul/final
```

These bounded software-browser captures exercise the isolated shipping theme and
canonical gameplay events. Native WebGPU uses target/readback because software
canvas presentation is unavailable in this environment. They do not measure
physical-device frame rates or verify full game boot.

Intermediate local studies and Vite caches are excluded from this evidence set.

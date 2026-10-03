# Neon Dusk overhaul — evidence (2026-10-03)

Before: `origin/main` 3d50d88e (WebGPU with a GLSL/EffectComposer twin, TSL materials + compute,
56 draws). After: branch `feature/neon-dusk-overhaul` — rebuilt as one TSL node-material path on
three r186 `WebGPURenderer` (ADR-0019; WebGPU and WebGL2 backends). The theme leaves the
dual-state allowlist (`tests/unit/dual-state-theme-tripwire.test.js`).

## Look

The great sun sinks into a pass between three neon mountain ranges, over a glass floor.

- **Sun** — a saturated gold → orange → pink disc with the classic slits widening toward its base,
  a magenta-gold glow and a hot band along the horizon. The camera yaws so it sits in the free
  zone left of the board (centred with no board on screen).
- **Mountains** — three ridged-multifractal ranges (one merged mesh, one draw), art-directed: one
  fixed terrain (`TERRAIN_SEED`), identical for every player, as the old theme's was. Near peaks frame
  the pass as a V and burn with a gold rim where they turn edge-on to the low sun; neon
  **scan lines** (cross-sections at fixed distances) trace every ridge's real profile, magenta at
  the feet turning cyan at the crests; the far range recedes in violet haze; luminous mist pools
  at their feet. (Height contours were tried first: from a camera this low they read as
  horizontal stripes.)
- **Glass floor** — a planar `reflector()` mirrors the sun, the ranges and their scan lines at
  reduced resolution, read a mip down (a slightly rough glass) through screen-space wind ripples
  that break the reflected sun into bars; a scrolling pristine-AA neon grid sits on top. Low and
  Minimal mirror analytically (sky, sun, and a fitted silhouette of the pass) with no second
  render.
- **Sky** — dusk gradient, twinkling hashed stars, and long stratus bars above the ridgeline:
  burning pink and gold beside the sun, dark plum farther out, thinned over the disc itself so the
  sun keeps its clean silhouette.
- **Post** — hue-preserving bloom, neutral tone map, dusk split-tone, vignette, dither, and the
  theme's VHS signature: a whisper of chroma at the screen edges and a real tape glitch on combos.
- **Gameplay** — a piece lock lights its tetromino as neon tiles in the glass beside the board
  (left of it for pieces that landed in the board's left half) with a ripple ring; line clears
  roll a wave of light through the ranges' scan lines and then across the floor; multi-line
  clears, big combos and level-ups add dashed hologram halos out of the sun; combos shift the
  grid's hue and send a burst of neon pixels from the sun across the whole screen, a shooting star
  and the tape glitch.

| File | What it shows |
| --- | --- |
| `before-ingame-high.jpg` | Old theme in the real app (perf-lane window, High) |
| `after-ingame-high.jpg` | New theme, same capture state |
| `after-playground-menu-centred.jpg` | `?effect=neon-dusk&t=20&board=0` — the centred menu shot |
| `after-playground-game.jpg` | Mock board + HUD: the sun solved into the free zone left of the board |
| `after-playground-lock.jpg` | A T piece locked in the board's left half: its tiles light in the glass |
| `after-playground-tetris.jpg` | Tetris: hologram halos, pixel burst, the wave rolling in |
| `after-playground-combo.jpg` | Combo ×5: neon pixels from the sun across the screen, grid hue shift, glitch |
| `after-playground-low-tier.jpg` | `quality=Low` — analytic mirror (no second render), no bloom |
| `after-playground-webgl2-menu.jpg` | `forceWebGL=1` — the WebGL2 backend renders the same node path |
| `pass-closeup-2x.jpg` | The pass at 2x: rims, scan lines, slits |

The theme's menu thumbnail (`src/themes/neon-dusk/neon-dusk-theme-icon.png`, and its copy under
`public/assets/themes/`) is now a circular render of the new world, and
`docs/theme-screenshots/neon-dusk.png` is the real-app capture of it.

## Performance (theme perf lane, ADR-0016)

Instrument: `node scripts/validate-all-themes.mjs --perf --theme neon-dusk --skip-build --port 4293
--perf-idle-ms 10000 --perf-settle-ms 12000`, RTX 3070 Laptop (`force_high_performance_gpu`), quality
High, window 1584x787. Arms INTERLEAVED (before, after, before, after) from two worktrees with
pre-built `dist/`, each run behind the shared GPU lock, started only after 15 s with no contending
jobs and sampled for contention throughout (a run that saw contention was discarded and repeated).
Every run: PASS, 0 console errors. Two series, because the machine's power state changed between
them:

### On mains power (2026-10-03, night) — the build before the final sky polish

Identical to the shipped build except that the stratus layer sat lower (mostly hidden behind the
ranges) and the terrain was not yet pinned to its seed. Raw cells: `perf-cells/mains-prior-build/`.

| n=2 each | Before | After |
| --- | --- | --- |
| Pixel ratio rendered | 0.8 (the old theme scales its own resolution down; 0.75–0.8 seen) | 1.0 |
| GPU p50 / p95 | 0.59 / 0.66–0.72 ms | 0.39 / 0.66 ms |
| CPU submit p50 / p95 | 1.8–1.9 / 2.1 ms | 1.9 / 2.3 ms |
| Wall p50 / p95 | 7.6 / 8.2 ms | 7.6 / 8.1–8.2 ms |
| Frames over 16.7 ms (10 s) | 0 | 0 |
| Draw calls | 56 | 21 |
| Triangles | 563k | 194k |
| Render pipelines (all synchronous) | 28 | 17 |
| Theme switch (wall) | 550 ms | 252–265 ms |
| Second visit switch | 375–403 ms | 131–140 ms |
| First frame GPU-complete | 2.57–2.66 s | 2.37–2.46 s |
| JS heap p50 | 51 MB | 32–33 MB |

### On battery (2026-10-03, afternoon) — the shipped build

The laptop was discharging: the GPU is power-throttled and frames are capped at 60 Hz, so every
number is slower for both arms and "frames over 16.7 ms" is not meaningful (the cap sits on the
budget). Raw cells: `perf-cells/battery-final-build/`.

| n=2 each | Before | After |
| --- | --- | --- |
| Pixel ratio rendered | 0.8 falling to 0.7 during the window | 1.0 (held) |
| GPU p50 / p95 | 4.13–4.26 / 5.4–5.5 ms | 1.38 / 1.5–2.3 ms |
| CPU submit p50 / p95 | 3.5–3.6 / 5.5–5.6 ms | 3.3–3.4 / 4.7–5.2 ms |
| Wall p50 / p95 | 16.5–16.6 / 18.6–32.7 ms | 16.7 / 18.0–18.2 ms |
| Draw calls | 56 | 21 |
| Theme switch (wall) | 1035–1126 ms | 506–531 ms |
| Second visit switch | 706–737 ms | 246–321 ms |
| First frame GPU-complete | 3.13–3.27 s | 2.77–2.84 s |
| JS heap p50 | 48–50 MB | 32 MB |

Reading it: on mains, a third less GPU time per frame while drawing 56 % more pixels (full
resolution instead of 0.8), CPU submit equal at the median and ~0.2 ms higher at p95 (the
reflector's second scene pass); on a throttled GPU the gap widens to a third of the old theme's GPU
time, with the old theme also shedding resolution. Theme switches are twice as fast, the heap is a
third lighter and there are fewer pipelines in both series. The shipped build has no mains-power
measurement of its own: the only difference from the measured one is where the cloud layer sits.
GPU timestamps resolve in 0.0655 ms quanta. Every cell is flagged inadmissible for the lane reason
"the theme also resets renderer.info — latched draw counts are a partial frame" (the draw-count
latch, not the timing fields; both arms), and the battery "before" cells also for the pixel ratio
moving during the window.

## Measurement notes

- An earlier build (16-tap god rays, mirror at 0.5 scale) measured GPU 0.92–0.98 / 1.6–1.8 ms —
  worse than the old theme. A visual A/B showed the god rays changed nothing visible next to a sun
  this large, so they were removed; the mirror dropped to 0.4 scale (read at mip 1.6, same look),
  bloom to 0.35, the sky's event layers (hologram halos, shooting stars) sit behind a uniform
  branch, so the idle sky skips them, and the fx (dust, burst pixels, tiles) stay out of the
  mirror's pass.
- The playground profiler (`?profile=1&trackTimestamp=1`) could not price features: its GPU
  sample covers an arbitrary subset of a frame's passes (identical runs differed by 0.2 ms; no-post
  read slower than the full stack). All GPU numbers above come from the perf lane.

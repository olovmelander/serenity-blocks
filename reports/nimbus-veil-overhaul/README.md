# Nimbus Veil overhaul — evidence (2026-10-01)

Before: `origin/main` 43bada18 (classic `THREE.WebGLRenderer`, GLSL `ShaderMaterial` cloud planes,
dust sprites, glow sprites). After: branch `feature/nimbus-veil-overhaul` — rebuilt on three r186
`WebGPURenderer` + TSL node materials (ADR-0019 single node path, WebGPU and WebGL2 backends).

## Look

A golden-hour flight over a sea of clouds:

- **Cloud sea** — a polar grid displaced by a billowy, slope-eroded fbm (analytic derivatives, one
  noise evaluation per octave), wrap-lit gold toward the low sun, lavender in the valleys, silver
  linings looking into the sun, valley mist, and a Gaussian haze that meets the sky's horizon colour.
- **Cumulus towers** — instanced sprite puffs lit by the tower's form (outward from its axis, domed
  at the crown) with each puff's sphere as relief, billow undersides in shade, forward-scattered
  glow on the silhouette when back-lit, frayed noise edges. One draw for every tower.
- **Sky** — gradient, limb-darkened sun with wide/core glow and a horizon band, high cirrus.
- **Post** — bloom (hue-preserving soft knee), crepuscular rays from the sun, neutral tone map,
  split-tone grade, vignette, dither; 4x MSAA scene pass on High and up.
- **Composition** — the camera yaws so the sun lands in the free zone left of the board, centred
  when no board is on screen (menus).
- **Gameplay** — piece locks pulse the sun, line clears roll a light ring over the cloud sea and
  send rising glints, combos burst glints out of the sun across the whole screen, level-ups do all
  of it at full strength.

| File | What it shows |
| --- | --- |
| `before-ingame-high.jpg` | Old theme in the real app (perf-lane window, High) |
| `after-ingame-high.jpg` | New theme, same capture state (no board on screen → centred sun) |
| `after-playground-menu-centred.jpg` | `?effect=nimbus-veil&t=20&board=0` |
| `after-playground-game.jpg` | Mock board + HUD: sun solved into the free zone left of the board |
| `after-playground-combo.jpg` | Combo ×5: glints burst from the sun across the screen |
| `after-playground-low-tier.jpg` | `quality=Low` (no bloom, no rays, fewer towers) |
| `after-playground-webgl2-menu.jpg` | `forceWebGL=1` — the WebGL2 backend renders the same node path |
| `cumulus-crop-2x-{before,after}-tower-lighting.jpg` | Per-puff sphere lighting read as stacked balls; tower-form lighting reads as one billowing mass |

## Performance (theme perf lane, ADR-0016)

Instrument: `node scripts/validate-all-themes.mjs --perf --theme nimbus-veil --skip-build
--port 4288 --perf-idle-ms 10000 --perf-settle-ms 12000`, RTX 3070, quality High, window 1584x787
at pixel ratio 1.0 (held for every cell). Arms interleaved (before, after, before, after) from two
worktrees with pre-built `dist/`; each run started after 15 s with no contending jobs and was
sampled for contention throughout. Raw cells: `perf-cells/{before-1,before-3,after-2,after-4}.json`.

| n=2 each | Before | After |
| --- | --- | --- |
| Frames rendered | every vsync (~127 Hz here), ignores Target Frame Rate | capped to Target Frame Rate (60) |
| GPU p50 / p95 | not measurable (classic WebGLRenderer has no timestamps) | 0.66–0.72 / 0.98–1.18 ms |
| CPU submit p50 / p95 | 0.3 / 0.4 ms | 1.5 / 1.9–2.1 ms |
| Wall p95 (rAF interval) | 9.7–9.8 ms | 8.7–8.8 ms |
| Frames over 16.7 ms (10 s) | 0–2 | 0 |
| Draw calls | not latched by the lane | 20 |
| Theme switch (wall) | 385–410 ms | 204 ms |
| Second visit switch | 152–161 ms | 68–79 ms |
| First frame GPU-complete | 2.47 s | 2.40 s |
| JS heap p50 | 25.5–27.0 MB | 30.6–31.6 MB |

Reading it:
- The old theme rendered a full frame at every display refresh; the new one honours the player's
  Target Frame Rate (`shouldRenderFrame()` → theme frame pacer), so it renders about half as many
  frames on this 120+ Hz display, each costing ~0.7 ms of GPU.
- CPU submit per frame is higher (1.5 vs 0.3 ms): the WebGPU node renderer's per-draw overhead.
  It is in line with the merged Synthwave Sunset rebuild (1.6 ms, 22 draws, same instrument).
- Frame pacing is steadier (wall p95 down ~1 ms, no over-budget frames) and theme switches are
  twice as fast.
- Cells are flagged inadmissible for one lane reason each — before: "draw calls unavailable in one
  visit" (classic renderer); after: "the theme also resets renderer.info — latched draw counts are a
  partial frame" — both about the draw-count latch, not the timing fields.

Discarded data, for the record: an earlier interleaved series ran while a peer project's
Playwright suite kept up to 15 SwiftShader headless-Chrome processes busy (CPU p95 of both arms
inflated 10–100x, dynamic resolution dropped the new theme to 0.7). A later series overlapped
orphaned capture loops from this session; one of its runs measured the old build through a
stale preview server on the lane port (`shots-*/preview.log`: "Port 4186 is already in use").

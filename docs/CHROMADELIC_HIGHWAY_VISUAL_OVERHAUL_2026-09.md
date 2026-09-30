# Chromadelic Highway — visual overhaul (2026-09)

Status: **Reference** (shipped design + evidence). Supersedes the rendering/composition parts of
[CHROMADELIC_HIGHWAY_WEBGPU_UPGRADE_PLAN.md](CHROMADELIC_HIGHWAY_WEBGPU_UPGRADE_PLAN.md); the art
direction in [CHROMADELIC_HIGHWAY_ART_DIRECTION.md](CHROMADELIC_HIGHWAY_ART_DIRECTION.md) still
holds and is sharpened here.

Evidence (before/after captures, false-colour view, event beats):
[reports/chromadelic-highway-overhaul/](../reports/chromadelic-highway-overhaul/).

## 1. What changed and why

The old theme (5.4k lines, a GLSL `WebGLRenderer` twin, compute particles, a 16-tap post quad)
had three kinds of problems:

- **Composition.** The 80° lens put the hero planet's journey corridor *behind* the gameplay
  board, stretched the side planets into ellipses, and filled the bottom of the frame with a
  blown-out road slab. Near-camera torus rings smeared across the lens.
- **Value and colour.** A luminance bloom threshold bloomed green/cyan/yellow but never
  magenta/blue (the teal washout at event peaks); ACES skewed the neon hues; large additive
  planes (nebula, haze, glow) lifted the whole frame; stars were 1-px points (r185 draws
  `THREE.Points` at 1 px on WebGPU).
- **Runtime.** Motion was frame-rate dependent, every shooting star minted a new material and
  compute node, and the adaptive resolution scaler read the cumulative `info.render.calls`
  counter, so it pinned the theme to its resolution floor within a second of starting.

The rewrite is built around one idea: **the board is the sun.** The card hides the vanishing
point, and everything radiates from it — the only key light sits behind it at the highway core,
every lit limb faces it, rings and speed streaks emerge from its edges, event light bursts out of
it toward the player, and the planets own the visible side zones.

## 2. Architecture

| Module | Role |
|---|---|
| `chromadelic-highway-theme.js` | BaseTheme lifecycle; `WebGPURenderer` on both backends (`antialias:false, depth:false`); renderer candidates WebGPU → WebGL2 with rethrow on owned failure; device-loss rebuild on either backend (WebGPU `device.lost` and WebGL2 `webglcontextlost` both arrive at `renderer.onDeviceLost`; rebuilt on WebGL2, at most twice per session, then `onRuntimeFailure`); observer-driven DOM layout watch (paused themes do not watch); reactive envelope; adaptive scaler; baseline tooling (kept verbatim). |
| `chromadelic-highway-world.js` | `ChromadelicWorld`: builds and animates all content, camera rig, event choreography, wave slots (resolved on the CPU + governor), ring cascade, level palette, moon orbit, meteors. Shared with the playground effect. |
| `chromadelic-highway-composition.js` | CPU-only composition solver: reads the live card/HUD rects (or evaluates the stylesheet's own formulas), solves screen anchors through the rest camera, outputs world positions, sky mask directions, `zEntry`/`dEmerge` and the veil rects. Runs on resize/layout/level change only. |
| `chromadelic-highway-sky.js` | Opaque sky dome (gradient, core radiance, warm/cool/band nebula masses, screen-space calm zone) + instanced starfield with the binary pair. |
| `chromadelic-highway-planets.js` | Analytic planet impostors (one quad each) on a world-space basis. |
| `chromadelic-highway-road.js` | The road (stained-glass lanes, seams, curbs, gates, glitter) and the two rail curtains. |
| `chromadelic-highway-fx.js` | Tunnel rings, speed streaks, motes, pooled meteors. |
| `chromadelic-highway-post.js` | One `RenderPipeline`: scene pass → bloom (Medium+) → one output pass. Pass-through pipeline for the no-post path. |
| `chromadelic-highway-tsl.js` | Shared TSL helpers (all `setLayout`-wrapped), the travel clock constants. |

Playground: `playground.html?effect=chromadelic-highway` mounts the same world and post
(`quality=`, `board=1`, `event=…&eventAge=…`, `parts=…`, `falseColor=1`, `msaa=`, `noPost=1`).

**One travel clock.** Everything that moves along the road reads one `uTravel`, accumulated on the
CPU in double precision and wrapped at `TRAVEL_WRAP = 84000` (a multiple of every period used:
350 ring spacing × every tier's ring count, dashes, rail packets at 1.6×, the 2800 particle span
at k/30 speeds, glitter). All motion is closed-form in (time, travel): frame-rate independent and
seekable (`?chromadelicTime=<s>` freezes a deterministic frame). Motes ride their own clock so
envelopes scale their speed, never their phase.

## 3. Composition

- **Lens:** 60° vertical, Hor+, horizontal FOV capped at 104°. Rest pose (0, 84, 280) looking at
  (0, 36, −720): the vanishing point sits at sy ≈ 0.458, always behind the card. Pace widens the
  FOV (Medium+) and a Tetris surges it +1.6°.
- **Anchors** (in viewport heights from the centre, pushed outward on wide screens): hero
  (−0.50, +0.19) at depth 3600, Ø 0.27 H growing 0.004 H per level; moon orbiting it (transits
  every 96 s); ringed ice giant (+0.63, +0.31) at 5200, raised above the HUD when needed; binary
  star pair 0.2 H left of it in the top strip; witness body (Ultra+) on slow passes.
- **Layout-aware:** the solver reads the gameplay boards (`.player-card[data-player]`; the lobby's
  avatar cards reuse `.player-card` without it) and `.single-player-stats-bar` (resize observers,
  window resizes via `resize()` and a 1 s timer, debounced 120 ms, committed after 0.5 s of
  stability — never from the frame loop). The masks' screen fractions are derived from the
  centre-anchored rects at the current aspect, so a width-only resize never keeps stale ones. With no board on screen it evaluates the CSS formulas
  (`board = min(clamp(220, 22vw, 300), (100vh − 250)/2)` …). Mirrors the bodies when only the
  right zone is free (the ice giant is solved on the free side too, and hidden when its zone cannot
  hold it); shrinks/reduces when no zone is wide enough. `boardClear` is unit-tested at
  4:3, 16:10, 16:9, 1600×769 and 21:9.

## 4. Elements

- **Sky:** zenith #080516 → horizon #160A2C, never black; a glowing magenta-violet emission mass
  wraps the hero's night limb (the planet reads as a silhouette against it), a teal mass around the
  ice giant, the galactic band from the top-left corner. The nebula texture is used as density
  only (max channel; its luma median is ~0.08). A screen-space calm zone hugs the card.
- **Stars:** instanced quads with pixel sizes (1.3 px floor), three brightness tiers that never
  straddle the bloom knee, blackbody classes, denser along the band, a twinkle wave from the
  vanishing point on clears; a gold/cyan binary with thin achromatic six-arm spikes.
- **Planets:** one camera-plane quad each; perfectly round at any aspect; shaded on a basis built
  from the camera→centre direction (no swim); point key light at the highway core (0, 60, −4000)
  so the hero is gibbous (62–68 % lit) with its lit limb toward the card; band-luminance
  equalisation from a coarse tap (the rainbow texture no longer reads yellow-lime), zonal jets,
  polar hoods, the moon's transit shadow and cyan storm flashes on clears; every body spins in
  closed form on the world clock. The moon orbits on a 14°-tilted circle in the hero's
  line-of-sight frame (always outside the hero; the transit at t = 40 s, 136 s, … crosses the
  disc as a half-lit lavender moon) and goes ember-dark in the hero's shadow; the ice giant carries a pale lavender ring lit through by the
  binary, with mutual planet/ring shadows and front/back compositing.
- **Road:** stained-glass lanes in the tetromino colours (I O T S Z J L = ROYGBIV, left → right),
  luminance-normalised; energy-conserving anti-aliased seams and curbs (Golus); brightness
  anchored to the card edge in screen space (brightest where the wedges meet the board, calm
  behind it, a dimmed launch apron under the board on tall layouts); a gate line and light pool in
  each ring's colour under every ring (same ring id as the ring shader); lane-hued glitter.
- **Rails:** pink (I) and violet (L) light curtains with a pixel-floored hot tube and packets.
- **Rings:** pixel-clamped neon strips on a 16-step palette (cyan, violet, azure, magenta
  downbeat; walked per phrase, stepped +30° per level). They emerge at the card edge (collapsed to
  zero area while hidden behind it), sweep outward, drop to a dim glass line over the hero, and
  dissolve before the lens. The ring id is rounded in the vertex stage (no colour flicker).
- **Streaks / motes / meteors:** side-coherent pastel streaks (warm left, cool right) thinned in
  the hero's window; lavender motes (High+); rare meteors that fly outward and never cross the
  planets, one comet per long combo grazing the hero's lit limb. The meteor pool is gated by
  `instanceCount`, never `visible`, so it compiles with the scene.

## 5. Event language

Events never touch exposure. Each gameplay event launches light waves just behind where the road
slides under the card (`zEntry − 40`) that run **toward the player** through the lanes and rails
(per-event decay τ, resolved on the CPU; one `exp` per fragment per slot). A governor scales back
pile-ups; the shader caps the wave sum.

| Event | Response |
|---|---|
| Piece lock | faint cyan band + rail tick (rate-limited to one per 0.35 s) |
| Combo c | a band climbing magenta → violet → blue → azure; meteors at c = 3, 6, 9…; one comet per chain at c ≥ 5 (re-armed by every new chain, ≥ 20 s apart) |
| Line clear (n ≤ 3) | n orange bands, star twinkle wave, hero storm flashes |
| Tetris | three staggered beats: bands out of the card (0–150 ms), white-hot ring cascade (150–550 ms), streak warp (300–1100 ms); FOV surge; a light contrast dip |
| Level up | violet band + violet cascade, binary flare, nebula breath, twinkle wave; the ring palette steps +30° (easing the short way round the wheel; a lower level = a new game snaps it) and the nebula swings, persistently; the hero grows a little |

## 6. Post and grade

One scene pass (MSAA only at Ultra/Extreme — every thin element is anti-aliased analytically and
4× MSAA was indistinguishable at High), bloom at Medium+ with a **max-channel soft-knee prefilter**
over 4 taps (threshold 1.0, knee 0.4: every hue blooms alike, thin lines do not flicker), and one
output pass: value-aware board veil (what shows through the translucent card/HUD is soft-clipped,
hue-preserving) → luminance contrast 1.12 around 0.18 (floor untouched) → **neon-neutral** tone
map (Khronos Neutral with startComp 0.72, desat 0.32, quarter toe: hue-faithful, cores roll to
white) → vibrance, violet floor, event dip → top/bottom value-aware vignette → sRGB → floor-only
grain (High+) → triangular dither. No chromatic aberration, wormhole, god rays, anamorphic or lens
dirt. `?chromadelicFalseColor=1` bands the pre-tone-map max channel (blue < 0.1 < green < 0.6 <
yellow < 1 < orange < 2.5 < red).

## 7. Tiers

| | Minimal | Low | Medium | High | Ultra | Extreme |
|---|---|---|---|---|---|---|
| Stars | 600 | 1000 | 1800 | 3000 | 4500 | 6000 |
| Sky nebula taps | 0 | 1 | 2 | 2 | 2 | 2 |
| Bodies | hero | + moon | + ice giant & ring | + fill light, transit, storms, ring shadows | + witness | + witness |
| Road segments / glitter | 30 / – | 40 / – | 70 / – | 100 / ✓ | 150 / ✓ | 200 / ✓ |
| Rings (arc segments) | 3 (64) | 4 (64) | 6 (80) | 8 (96) | 10 (112) | 12 (112) |
| Streaks / motes | 0 / 0 | 48 / 0 | 120 / 0 | 240 / 120 | 360 / 200 | 480 / 300 |
| Bloom (strength @ scale) | – | – | 0.62 @ 0.25 | 0.70 @ 0.325 | 0.75 @ 0.375 | 0.80 @ 0.40 |
| Scene MSAA | 0 | 0 | 0 | 0 | 4 | 4 |

The adaptive scaler keeps the resolution role: it steps down on a sustained overrun or a missed-
frame rate above 2 %, probes up after 6 s at target, and a failed probe returns to the last good
scale with exponential backoff (30 s → 8 min), so a GPU-bound machine settles instead of cycling
through resizes. Frames right after a (re)start are ignored; the budget never asks for more than
the display can present. `effectScale` drives star/streak/mote instance counts.

## 8. Performance

Same instrument as the theme perf lane (`scripts/lib/theme-perf-instrument.mjs`, injected in
Chrome with the lane's bootstrap/pins/visit), idle window 10 s, `chromadelicFixedDt=16.666`,
`chromadelicSeed=1234`, quality High, WebGPU, RTX-class GPU. Old = `dd60c6c1`, new = this branch.
GPU timestamps are quantised to 65.5 µs; runs overlapping a peer GPU job were discarded or rerun.

**Default load** (1600×769, DPR 1, renderer ratio 0.98, 60 fps cap):

| | Old | New |
|---|---|---|
| GPU p50 / p95 | 0.393 / 0.590 ms (4 runs) | 0.393 / 0.590 ms (2 runs) |
| GPU per-frame mean | 0.374–0.421 ms | 0.397–0.433 ms |
| rAF cadence p50 | 14.8–14.9 ms | 7.6 ms (display rate) |
| CPU submit p50 / p95 | 2.6–2.9 / 3.1–4.5 ms | 1.6 / 1.9–2.5 ms |
| Draw calls / triangles | 71 / 55,751 | 23 / 11,087 |

**Heavier load** (DPR 2 → 1960×942, uncapped; new measured with 4× MSAA still on at High, i.e.
conservatively): GPU mean 0.543 / 0.538 ms (old) vs 0.518 / 0.497 ms (new); p95 0.721 / 0.655 vs
0.655 / 0.655; the old theme's main thread capped it at ~66 fps (rAF 15.1 ms) while the new one
kept the display rate (7.6 ms); CPU submit 2.7–2.8 vs 1.5 ms.

Result: GPU the same at the default load (at ~3 % GPU utilisation clock state dominates the
per-frame mean) and lower under load; CPU ~40 % lower; 3× fewer draws; the main thread no longer
drops frames. Caveats (ADR-0016): measured on the Vite dev build in Chrome, not the packaged
Electron lane, and the old theme in practice shipped at its resolution floor because of the
scaler bug (0.68 at High) — the new theme runs at full resolution and lets the fixed scaler lower
it only when the frame budget is actually missed. Re-run `node scripts/validate-all-themes.mjs
--perf --theme chromadelic-highway --skip-build --perf-idle-ms 10000` on a quiet machine before a
release claim.

## 9. Validation

- Playground (WebGPU) and in-game captures at 1600×769 and 1920×1080, WebGPU and WebGL2 backends,
  Low / High / Extreme tiers; Tetris beats at +0.2 s / +0.4 s; false-colour view (1.5 % of the
  visible frame above the bloom threshold at rest, all thin emitters). Zero console errors or
  WebGPU validation messages.
- Unit tests: `tests/unit/chromadelic-highway-world.test.js` (composition at five aspects, CSS
  fallback, event launch point, travel-wrap safety for every tier, world speed, adaptive-scaler
  settling / compile-stall / high-refresh cases) plus the theme lifecycle/registry suites.
- Three adversarial code-review passes (lifecycle, TSL/r185 on both backends, logic, performance,
  regressions); confirmed findings fixed. The last pass found: a second raw window `resize`
  listener (architecture-fitness ratchet 52 > 51), no handling of a WebGL2 context loss, `pow()`
  of a negative base at MSAA quad edges (NaN → hot pixels on D3D), the hero mask sized by distance
  instead of view depth (15–20 % small), planets not spinning in live play, stale mask fractions
  after a width-only resize, the layout watch polling while parked, the board veil snapping off
  instead of fading, a once-per-session chain comet, ghost meteors after a seek, the ice giant's
  radius frozen at its 16:9 value, and the mirrored layout putting the ice giant on the card. All
  fixed; the WebGL2 recovery was exercised with `WEBGL_lose_context` (restore, timeout and
  over-the-cap paths).
- CI gates run locally: typecheck, ts-ratchet, lint ratchet (1352 ≤ 1404), architecture fitness,
  theme-lifecycle audit, dependency boundaries, perf-budget and release gates, full vitest suite.

## 10. Follow-ups

- Run the packaged Electron perf lane (see §8). (The production-bundle Electron capture,
  `node scripts/validate-all-themes.mjs --theme chromadelic-highway`, passes with zero console
  errors and refreshed `docs/theme-screenshots/chromadelic-highway.png`.)
- Optional: bake the sky's static terms into a cube map on each solve if the dome ever shows up
  in a GPU-bound profile.

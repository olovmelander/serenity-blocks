# Theme fleet at 240 fps on High (2026-10-27)

The owner's ask: audit every theme's load time and frame rate across the graphics settings, aim for
**240 fps on High on this laptop**, align the other tiers to that benchmark, and keep the themes'
look and effects. This is the record of the first pass: the instrument, the fleet at High, what
limits the slow themes, a ceiling that sits below the game, what changed, and the queue.

## 1. Outcome

- **The display path caps every Chromium app on this laptop at ~178 fps.**
  - The game, Edge and Chrome all present at 177-181 fps, while Windows composites the 240 Hz panel
    at 237.6 Hz (DWM `rateRefresh` 10000000/42093). Chromium draws on three refreshes of four.
  - It is the same windowed and fullscreen, on the NVIDIA and on the AMD GPU.
  - Until that changes (§6), no theme can be *seen* at 240 fps here, however fast it renders.
- **Headroom at High (vsync off, uncapped):** 59 of 63 themes render faster than 240 fps in every
  window; the median theme does 616 fps at rest.
  - Four do not: Verdant Hills (203 fps at rest), Grainfields (212 in storms), Spring (207 in
    storms) and Thermal Bloom (175 in storms).
  - Summer (244) and Kaleidosonic (249 in storms) are at the line.
  - All six are GPU-bound.
- **At the panel's real cadence** (vsync on, target 240): 60 of 63 themes hold 177-180 fps in
  every window with at most 0.43 % late frames. Thermal Bloom (1.4 %), Spring (0.9 %) and Verdant
  Hills (0.8 %) drop frames in storms.
- **Loading:** an in-play switch shows the new theme after 0.79 s cold and 0.57 s warm at the
  median, then crossfades. Seven themes still freeze one frame for 110-360 ms during the switch
  (§7).
- **Conditions:** the laptop ran in Lenovo's Balanced mode, which holds the RTX 5080 at an
  80-95 W power limit (it can take 175 W).
  - The GPU sat at that cap in nearly every theme, so GPU-bound numbers here are conservative.
  - Re-measure in Performance mode before judging the GPU-bound six.

## 2. Machine

- **Hardware:** Lenovo 83RU with a Ryzen 9 9955HX3D, an RTX 5080 Laptop (driver 573.24) and a
  Radeon 610M, in hybrid mode (the panel is on the AMD GPU).
- **Display:** 2560×1600 at 150 % (1707×1067 CSS px), 240 Hz.
- **Power:** on AC, Windows Balanced. Lenovo mode Balanced: GPU limit 80 W by default, 85-95 W
  under load, with "SW Power Cap" active.
- **Software:** Electron 44.9.3, three 0.186.1, and a production build made with
  `VITE_DEV_HARNESS=1`.
- Other Claude sessions may have used the machine during the runs, so the A/B claims below come
  from interleaved rounds.

What High renders here: 42 themes cap High at a pixel ratio of 1.15 (1964×1227) and 17 at 1.25
(2135×1334). Waves and Koi Pond use 1.2, Chromadelic Highway its own adaptive ~1.17, and Black Hole
1.0 × its own dynamic scale (§8).

## 3. The instrument

`scripts/theme-fleet-bench.mjs` (`npm run perf:themes:bench`), with its worker
`scripts/theme-fleet-bench-worker.mjs` and its page code and reducers in
`scripts/lib/theme-fleet-bench-page.mjs` (tests: `tests/unit/theme-fleet-bench.test.js`).

Each theme gets one fresh Electron and a fresh profile, then:
1. **Boot.**
   - `/?skipIntro=1&unlockAll=1` in a window the size of the display at its scale factor, shown
     inactive off-screen.
   - Quality, target fps and Specific background mode set.
   - Single Player started on an anchor theme (Nimbus Veil), then 12 s for the intro card.
2. **Load, cold.** The theme is picked through the settings, the path a level-up or a pick in play
   takes: built hidden behind the playing theme, then crossfaded.
   - Marks: running, first frame on the theme's canvas, shown, fully shown.
   - Also recorded: the longest frame, long tasks and long animation frames, and the pipelines,
     network and GPU device requests in the window.
3. **Rest (6 s), then storm 1 and storm 2 (8 s each).**
   - The storms fire an event every 350 ms: locks, drops, clears of one to four lines, combos,
     T-spins, back-to-backs, perfect clears, level-ups.
   - Measured: frame rate and frame-time percentiles from rAF, presents on the theme's canvas,
     main-thread ms inside animation frames, nvidia-smi GPU utilisation (GPU-busy ms ≈
     utilisation × frame time), and CPU per process.
4. **Load, warm.** Back to the anchor and to the theme again (second visit).

Switches:
- `--vsync=0` (default) turns Chromium's vsync and frame-rate limit off, so headroom past the panel
  is visible.
- `--vsync=1 --target-fps=240` measures what the player sees.
- `--quality=<tier>`.
- `--switches=` adds Chromium switches for an A/B.
- `--eval-file=` runs a probe (below).
- `--profile=1` takes a CPU profile of storm 1, `--profile-load=1` of the cold load.

Probes in `scripts/lib/theme-bench-snippets/` (README there):
- **Cost census:** hides each part of the scene in turn and measures the frame time it saves. The
  frame with the whole scene hidden is what the post chain, the clears, the board and the
  compositor cost.
- **Pass profile:** GPU ms per render pass from three's timestamp queries, at a 60 fps cap.

Instrument notes (ADR-0016):
- **GPU timestamps are off in the fps windows.** At 300-1000 fps three's 2048-query pool fills and
  resets between resolves, so a per-frame GPU figure undercounts. Arming timestamps on a revisit
  also raised cross-device QuerySet errors.
- **Pass profile keys:** three reuses render-context ids across passes, so the pass profile keys by
  target label, not by id.
- **The lane's "CPU in render" double-counts.** It times nested `render()` calls twice: a post
  pipeline's quad and the scene pass inside it.
- **Uncapped loads starve.** With vsync off, an anchor drawing at 450 fps saturates the GPU process
  and starves the incoming theme's async pipelines. Spring and Wolfhour then took 9-10 s to show,
  against 2.1 s and 0.8 s at the real cadence. Read load numbers from vsync runs only; §7 has the
  real-world lesson.

## 4. The fleet at High

Rest and storm fps, GPU ms and draws are from the uncapped run. Late frames, shown times and the
longest frame of the switch are from the run at the panel's cadence. Sorted by the worst window. Raw
summaries: `reports/theme-fleet-bench/2026-10-27-base-high/` and `…-base-high-vsync/`.

| Theme | Rest fps | Worst storm fps | GPU ms (rest) | Draws | Pixel ratio | Late frames at 178 Hz | Shown cold / warm (s) | Longest frame in switch cold / warm (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| thermal-bloom | 262 | 175 | 3.74 | 33 | 1.15 | 1.40 % | 1.21 / 0.72 | 87 / 65 |
| verdant-hills | 203 | 213 | 4.85 | 58 | 1.25 | 0.82 % | 1.27 / 0.85 | 67 / 61 |
| spring | 278 | 207 | 3.51 | 74 | 1.15 | 0.90 % | 2.15 / 1.70 ¹ | 247 / 248 ¹ |
| grainfields | 224 | 212 | 4.39 | 56 | 1.15 | 0.18 % | 1.23 / 1.01 | 80 / 49 |
| summer | 253 | 244 | 3.84 | 129 | 1.25 | 0.20 % | 1.55 / 1.45 | 79 / 80 |
| kaleidosonic | 377 | 249 | 2.54 | 15 | 1.15 | 0.25 % | 0.69 / 0.52 | 66 / 32 |
| moonlit-greenhouse | 296 | 266 | 3.29 | 51 | 1.15 | 0.18 % | 1.33 / 0.98 | 72 / 60 |
| sunfall | 283 | 275 | 3.43 | 38 | 1.15 | 0.20 % | 0.84 / 0.62 | 144 / 113 |
| high-coast | 278 | 293 | 3.52 | 43 | 1.15 | 0.10 % | 1.27 / 1.14 | 105 / 89 |
| murmuration | 325 | 292 | 2.91 | 16 | 1.25 | 0.18 % | 0.76 / 0.53 | 124 / 59 |
| fluid-dreams | 616 | 298 | 1.47 | 17 | 1.15 | 0.13 % | 0.82 / 0.64 | 58 / 73 |
| sunbraid | 318 | 314 | 3.04 | 26 | 1.15 | 0.28 % | 0.79 / 0.63 | 87 / 60 |
| cosmic-noir | 474 | 323 | 2.11 | 3 | 1.15 | 0.08 % | 0.59 / 0.42 | 54 / 28 |
| crystal-cave | 338 | 327 | 2.82 | 36 | 1.25 | 0.33 % | 0.82 / 0.59 | 49 / 43 |
| neon-district | 334 | 333 | 2.87 | 76 | 1.15 | 0.28 % | 1.69 / 1.01 | 357 / 163 |
| sakura-twilight | 384 | 351 | 2.40 | 96 | 1.25 | 0.13 % | 1.20 / 1.00 | 89 / 55 |
| bioluminescence | 388 | 355 | 2.51 | 50 | 1.15 | 0.28 % | 0.96 / 0.83 | 89 / 53 |
| forest | 380 | 359 | 2.49 | 61 | 1.25 | 0.20 % | 1.09 / 0.82 | 64 / 34 |
| rainbow-terraces | 392 | 375 | 2.47 | 28 | 1.15 | 0.43 % | 1.28 / 0.76 | 87 / 45 |
| fall | 447 | 433 | 2.14 | 55 | 1.25 | 0.15 % | 0.85 / 0.68 | 254 / 183 |
| painted-ages | 520 | 447 | 1.84 | 21 | 1.15 | 0.23 % | 1.18 / 0.99 | 96 / 94 |
| nebula-flow | 692 | 454 | 1.32 | 24 | 1.15 | 0.15 % | 0.76 / 0.58 | 86 / 79 |
| luminous-tides | 620 | 458 | 1.55 | 24 | 1.15 | 0.15 % | 0.87 / 0.53 | 56 / 56 |
| rainbark | 516 | 469 | 1.88 | 24 | 1.15 | 0.28 % | 1.72 / 1.10 | 133 / 95 |
| golden-forest | 490 | 471 | 1.88 | 87 | 1.25 | 0.10 % | 1.00 / 0.81 | 49 / 54 |
| winter | 568 | 473 | 1.71 | 40 | 1.15 | 0.08 % | 0.84 / 0.61 | 72 / 43 |
| nimbus-veil | 476 | 474 | 2.01 | 21 | 1.25 | 0.05 % | 0.81 / 0.47 | 94 / 29 |
| pyrestorm | 580 | 478 | 1.66 | 36 | 1.15 | 0.28 % | 1.15 / 0.61 | 104 / 55 |
| stillwater | 531 | 487 | 1.84 | 75 | 1.15 | 0.23 % | 0.94 / 0.66 | 101 / 61 |
| halcyon-apex | 543 | 489 | 0.81 | 52 | 1.15 | 0.31 % | 0.75 / 0.58 | 83 / 72 |
| waves | 578 | 491 | 1.66 | 26 | 1.20 | 0.26 % | 0.64 / 0.52 | 107 / 74 |
| ocean | 517 | 499 | 0.97 | 43 | 1.15 | 0.20 % | 0.89 / 0.52 | 96 / 45 |
| stellar-velocity | 614 | 516 | 1.57 | 20 | 1.15 | 0.20 % | 0.66 / 0.46 | 73 / 28 |
| koi-pond | 555 | 537 | 1.70 | 46 | 1.20 | 0.18 % | 1.02 / 0.60 | 49 / 38 |
| ice-temple | 704 | 557 | 1.34 | 31 | 1.15 | 0.31 % | 0.92 / 0.52 | 114 / 68 |
| void-ember | 804 | 557 | 1.19 | 27 | 1.15 | 0.05 % | 0.76 / 0.52 | 208 / 54 |
| galaxy | 659 | 558 | 1.42 | 25 | 1.15 | 0.15 % | 0.57 / 0.50 | 67 / 52 |
| starlight | 1106 | 582 | 0.78 | 30 | 1.15 | 0.08 % | 0.64 / 0.55 | 118 / 112 |
| himalayan-peak | 617 | 592 | 1.58 | 26 | 1.15 | 0.08 % | 0.92 / 0.78 | 101 / 122 |
| neon-dusk | 639 | 610 | 0.63 | 22 | 1.25 | 0.08 % | 0.62 / 0.52 | 71 / 49 |
| voltage-storm | 922 | 612 | 1.01 | 23 | 1.15 | 0.00 % | 0.72 / 0.50 | 70 / 44 |
| supernova | 837 | 626 | 1.11 | 22 | 1.15 | 0.20 % | 0.57 / 0.45 | 76 / 34 |
| cinder-drift | 791 | 656 | 1.18 | 26 | 1.15 | 0.18 % | 0.73 / 0.53 | 82 / 34 |
| sunset | 728 | 666 | 1.20 | 20 | 1.15 | 0.05 % | 0.75 / 0.53 | 75 / 51 |
| synthwave-sunset | 705 | 681 | 1.20 | 44 | 1.25 | 0.23 % | 0.75 / 0.50 | 72 / 40 |
| lunara | 794 | 682 | 1.19 | 40 | 1.15 | 0.15 % | 0.72 / 0.54 | 77 / 54 |
| geode | 900 | 723 | 1.03 | 22 | 1.15 | 0.08 % | 0.69 / 0.53 | 94 / 83 |
| chiral-gold | 741 | 751 | 0.99 | 62 | 1.15 | 0.13 % | 0.77 / 0.52 | 83 / 45 |
| shifting-sands | 784 | 755 | 1.20 | 19 | 1.25 | 0.08 % | 0.71 / 0.58 | 69 / 60 |
| vesper-chrysalis | 852 | 797 | 0.97 | 55 | 1.15 | 0.28 % | 0.71 / 0.50 | 79 / 33 |
| tornado | 903 | 808 | 1.03 | 30 | 1.15 | 0.31 % | 0.61 / 0.50 | 78 / 50 |
| serenity-warp | 980 | 818 | 0.87 | 26 | 1.15 | 0.20 % | 0.77 / 0.46 | 81 / 33 |
| solar-eclipse | 1108 | 842 | 0.78 | 18 | 1.15 | 0.18 % | 0.80 / 0.60 | 124 / 87 |
| aether-tides | 992 | 844 | 0.80 | 20 | 1.15 | 0.25 % | 0.71 / 0.58 | 59 / 55 |
| aurora | 853 | 846 | 1.02 | 30 | 1.25 | 0.33 % | 0.78 / 0.61 | 165 / 155 |
| black-hole | 945 | 892 | 0.90 | 15 | 1.00 | 0.18 % | 0.67 / 0.48 | 79 / 45 |
| parhelion | 1029 | 914 | 0.81 | 21 | 1.25 | 0.08 % | 0.54 / 0.52 | 63 / 44 |
| chromatic-impasto | 1075 | 954 | 0.81 | 17 | 1.15 | 0.10 % | 0.57 / 0.44 | 59 / 28 |
| wolfhour | 1058 | 965 | 0.53 | 49 | 1.25 | 0.18 % | 0.85 / 0.57 | 76 / 34 |
| stellar-drift | 1126 | 968 | 0.67 | 20 | 1.15 | 0.03 % | 0.75 / 0.55 | 133 / 52 |
| astral-weave | 1060 | 982 | 0.87 | 26 | 1.25 | 0.00 % | 0.57 / 0.46 | 54 / 33 |
| blood-moon | 1541 | 1184 | 0.65 | 2 | 1.25 | 0.00 % | 0.79 / 0.57 | 77 / 23 |
| chromadelic-highway | 1243 | 1232 | 0.44 | 24 | 1.17 | 0.03 % | 0.59 / 0.51 | 61 / 34 |

¹ Spring's load in the cadence run overlapped a test-suite run; these are its two clean A/B rounds.

## 5. What limits the slow themes

All the themes under or at the line are GPU-bound: 91-98 % GPU-busy uncapped.

**Per pass**, theme renderer only, at a 60 fps cap, in ms of GPU per frame:

| Theme | Scene pass (4× MSAA at High) | Other passes over 0.1 ms |
|---|---:|---|
| Spring | 3.08 | output 0.10 |
| Verdant Hills | 2.97 | cumulus march 0.57 (½ res), sun shafts 0.11 |
| Grainfields | 2.76 | air march 0.53 (½ res), clouds 0.35 |
| Summer | 2.35 | god rays 0.23, lake mirror 0.18 (½ res, 4×) |
| Sunfall | 2.47 | full-resolution post target 0.54 |
| High Coast | 2.14 | output 0.95 (a 14-step sun-shaft march at full resolution) |
| Moonlit Greenhouse | 1.15 | air march 1.06 (½ res, 24 steps), FXAA 0.18 |

The bloom chain (12 small passes at ½ resolution) costs 0.10-0.17 ms everywhere.

**Cost census** (uncapped, ms of frame time saved by hiding a part):

| Theme | Biggest parts | Empty scene / whole frame (ms) |
|---|---|---:|
| High Coast | far pines 0.40, sea 0.37, far spruces 0.19, pine shadow 0.16 | 1.32 / 3.49 |
| Sunfall | six jungle tree batches 0.16-0.29 each, cave 0.43 | 1.24 / 3.54 |
| Moonlit Greenhouse | glass 0.22 (rest is its air march and FXAA) | 1.84 / 3.37 |
| Thermal Bloom, in a storm | basin 0.82, steam 0.39 | 2.23 / 4.97 |
| Kaleidosonic, in a storm | the raymarched shape 2.39 | – / 3.26 |
| Fluid Dreams, in a storm | the liquid shell 1.34 | – / 2.15 |

A light theme's empty frame is about 0.8 ms: the board, the compositor and the canvas copy to the
panel's GPU.

What this means:
- Most of this cost is the effect itself, not waste. The look-safe wins left are per shader, theme
  by theme (§10).
- The Balanced-mode power cap makes these themes look heavier than they are, so re-measure them in
  Performance mode first.

## 6. The ~178 fps ceiling

- **A bare Electron page measures 177-181 fps of rAF** in every combination tried:
  - on-screen or off;
  - windowed or fullscreen;
  - with `force_high_performance_gpu`, `force_low_power_gpu` or neither.
- **Other browsers:** Edge and Chrome on the same laptop measure 177.6 and 178.1 fps.
- **Windows:** DWM reports 237.6 Hz for both refresh and composition.
- **So Chromium's frame clock on this machine ticks at three-quarters of the panel.** Even with
  vsync off it ticks every 5.5 ms, so Chromium reads the display interval wrongly. The game never
  sees a faster cadence.

Tried and rejected:
- **`--disable-features=UseCompositorClockVSyncInterval` and `--disable-features=DelegatedCompositing`:**
  no change.
- **`--disable-direct-composition`:** 237.6 fps on a bare page, but the game drops to ~29 fps
  because WebGPU canvases lose their presentation path. Not shippable.
- **`--disable-gpu-vsync --disable-frame-rate-limit` with the game's own 240 cap:** the frame rate
  goes up, but pacing falls apart (p50 0.8 ms, p95 17.5 ms, the theme presenting 185-318 frames a
  second). Not shippable without a real frame limiter.

To try next (machine-side; each needs a reboot or a driver setting):
- the Legion's dGPU-only display mode (MUX), which drives the panel from the NVIDIA GPU;
- the Windows dynamic-refresh setting;
- AMD's variable-refresh setting.

After each change, re-run the bench with `--vsync=1 --target-fps=240`. A theme at rest should
then read ~237 fps.

## 7. Loading

At the panel's cadence, an in-play switch shows the theme after 0.79 s cold and 0.57 s warm at the
median, then crossfades for 2.5 s (`THEME_CROSSFADE_MS`, a design choice, left alone). The slowest
to show:
- Spring 2.1 s: 79 pipelines and a 250 ms frame.
- Neon District 1.7 s.
- Rainbark 1.7 s.
- Summer 1.5 s.

The longest single frame while the switch runs, during which the outgoing theme and the board stop:

| Theme | Cold / warm (ms) | What it is |
|---|---:|---|
| Neon District | 357 / 163 | two render-callback tasks of 150-190 ms on both visits: single heavy materials building their node graphs |
| Fall | 254 / 183 | an unattributed 190-255 ms frame, plus 83-91 ms of GLTF parsing re-run on every visit |
| Spring | 247 / 248 | a 240-310 ms task on both visits |
| Void Ember | 208 / 54 | a 188 ms task, first visit only |
| Aurora | 165 / 155 | a ~90-98 ms render-callback task on both visits |
| Sunfall | 144 / 113 | 97-132 ms of GLTF parsing on every visit |
| Starlight | 118 / 112 | a ~97 ms render-callback task |

**Starvation under a saturated GPU.** The vsync-off runs showed the build-behind switch's weakness.
When the outgoing theme keeps the GPU process saturated, the incoming theme's async pipelines and
its device request starve: one pipeline every ~500 ms, and 9-10 s to show. At the real cadence the
outgoing theme leaves room, but a GPU-bound theme (Thermal Bloom in a storm) is close to that case.

**Spare GPU device (changed).** Each theme start used to begin with `requestAdapter` +
`requestDevice` inside `renderer.init()`. That took 30-70 ms at the panel's cadence, and 150-500 ms
with the GPU saturated. `src/rendering/theme-device-spare.js` now keeps one device ready (§9).

## 8. Graphics tiers

Survey of all 63 themes (read in code). The measured tier-by-tier ratios are pending (§10).

**Pixel ratio.** The tier's real pixel ratio is `min(DPR, theme cap, policy cap) × renderScale`. The
policy caps are Minimal 0.9 / Low 1.0 / Medium 1.15 / High 1.25 / Ultra 1.35 / Extreme 1.5.
- Most themes carry their own table (0.7 / 0.85 / 1.0 / 1.15 / 1.35 / 1.6), so High is not one
  resolution across the fleet.
- Their Extreme 1.6 is dead: DPR 1.5 clamps it.

**Antialiasing:**
- **Toggle ignored.** About twenty themes hard-code 4× MSAA from their look table and ignore the
  game's antialiasing setting: Halcyon Apex, Himalayan Peak, Ice Temple, Ocean, Winter, Tornado,
  Rainbark, Serenity Warp, Geode, Bioluminescence, Voltage Storm, Lunara, Moonlit Greenhouse, Void
  Ember, Chiral Gold, Rainbow Terraces, Cinder Drift, Neon District, Stillwater, Stellar Drift and
  Vesper Chrysalis.
- **The tier never controls MSAA.** Parhelion and Murmuration inherit the canvas's 4× in their scene
  pass on every tier.
- **Not monotonic:**
  - Golden Forest, Crystal Cave and Aurora draw Low/Minimal to a multisampled canvas while their
    Medium has no antialiasing at all.
  - Moonlit Greenhouse stacks 4× MSAA and FXAA.
  - Galaxy, Aether Tides, Supernova, Astral Weave, Stellar Velocity, Cosmic Noir and Painted Ages
    have none on any tier.
- **MSAA only at Ultra.** Chromadelic Highway and Thermal Bloom switch on 4× MSAA there.

**Steps between tiers:**
- **Big jumps:**
  - Cosmic Noir's and Stellar Velocity's volumes cost about 2.4× High at Ultra and 4.8× at Extreme.
  - Fluid Dreams adds a third bounce at Ultra.
  - Golden Forest's shadow map goes from 2048 to 4096 at Ultra.
- **Identical tiers:**
  - Ultra and Extreme share the same post chain in about thirteen themes.
  - Blood Moon and Stellar Drift draw the same shader from Medium to Extreme.

**Dead code:**
- Nimbus Veil, Neon Dusk and Synthwave Sunset have their own dynamic resolution, floored at
  16.6 ms, which never acts at 240 fps. The same three index their tier tables with the raw setting
  (no `normalizeQuality`).
- Unused tier fields: seven in Sunfall, Cosmic Noir's bloom parameters, and the `pixelRatioCap` in
  Painted Ages and Parhelion.

**The packaged app's dynamic resolution.** In Electron, `startDynamicResolutionMonitoring` lowers
`renderScale` (to 0.5 at worst) whenever frame p95 exceeds 1.14× the target budget.
- With a 240 target and the ~178 Hz display cadence, every frame is 5.6 ms against a 4.17 ms budget.
- Read in code, not yet observed: a packaged game set to 240 here would keep lowering the
  resolution. Check that in the packaged app before recommending a 240 target on this laptop.

## 9. What changed in this pass

Branch `perf/theme-fleet-240`.

**The fleet bench and its probes** (§3).

**Spare GPU device for theme starts.**
- What: `src/rendering/theme-device-spare.js`, wired in `BaseTheme.initializeRendererCandidate`.
- How:
  - It requests a device with three r186's own descriptor and hands it to the renderer through the
    backend's `parameters.device` before `init()`.
  - The renderer's `dispose()` destroys it, as three destroys a device it made itself.
  - A refill follows 4 s after each hand-over. Rollback: `?themeDeviceSpare=0`.
- Measured:
  - No adapter or device request left inside the switch; renderer creation went from 30-45 ms to
    under 1 ms after `createScene` starts.
  - Over eight in-play switches, the live device count stays at the playing theme's plus the one
    spare (no leak).

**The canvas is multisampled only where the scene is drawn to it.**
- Which themes: Forest, Fall, Summer, Sakura Twilight, Verdant Hills, Golden Forest and Aurora
  (`shared/scene-antialias.js` `canvasAntialias`).
- Why: from Medium up their 4× canvas held only the post stack's output quad, whose four samples
  are always equal.
- Measured:
  - No pixel changes, by construction.
  - About 90 MB less VRAM per running theme at 2134×1334.
  - Frame rate: no measurable change on the RTX (interleaved A/B, two rounds).

**`window.__serenityGameplayEvents` in the console harness**, in dev and `VITE_DEV_HARNESS=1` builds
only, for the bench's storms.

## 10. Queue

1. **Re-measure in Lenovo Performance mode** (GPU limit up to 175 W), then decide which GPU-bound
   themes still need work.
2. **The ~178 fps ceiling (§6):**
   - Try dGPU-only display mode and the refresh-rate settings.
   - Check the packaged app's dynamic resolution against a 240 target (§8).
3. **Load freezes (§7):**
   - Fall and Sunfall: cache the parsed GLTF data for the session. Check first that their worlds
     never change it.
   - Neon District, Aurora, Starlight: profile which materials build in one task, then make the node
     graphs smaller (`Fn().setLayout`) or split the build.
   - Spring's long task.
4. **Starvation under a saturated outgoing theme.** While a build-behind is starved (no pipeline
   progress for 250 ms), cap the outgoing theme's frame rate. Measure with a GPU-bound anchor first.
5. **GPU-bound themes, look-safe shader work.** Each needs a before/after screenshot:
   - High Coast's full-resolution shaft march (0.95 ms);
   - Moonlit Greenhouse's air march (1.06 ms);
   - Sunfall's full-resolution post target (0.54 ms);
   - the scene passes of Spring, Verdant Hills and Grainfields (2.8-3.1 ms, foliage under 4× MSAA);
   - Thermal Bloom's storm effects.
6. **Tier alignment.**
   - Measured per-tier ratios against each theme's own High: runs at Ultra, Medium, Low, Extreme and
     Minimal are in progress.
   - Then align the tiers:
     - one rule for High's pixel ratio;
     - MSAA that follows the antialiasing setting;
     - monotonic antialiasing;
     - Ultra and Extreme steps of a consistent size.

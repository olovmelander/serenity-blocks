# Theme fleet at 240 fps on High (2026-10-27)

The owner's ask: audit every theme's load time and frame rate across the graphics settings, aim for
**240 fps on High on this laptop**, align the other tiers to that benchmark, and keep the themes'
look and effects. This is the record of the first pass: the instrument, the fleet at High, what
limits the slow themes, a ceiling that sits below the game, what changed, and the queue. §11 is the
night pass of 2026-10-28 → 29.

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
  median, then crossfades. Seven themes froze one frame for 110-360 ms during the switch (§7);
  the night pass (§11) took out the main-thread work behind those freezes.
- **Conditions:** the laptop ran in Lenovo's Balanced mode, which holds the RTX 5080 at an
  80-95 W power limit (it can take 175 W).
  - The GPU sat at that cap in nearly every theme, so GPU-bound numbers here are conservative.
  - Re-measure in Performance mode before judging the GPU-bound six.
- **Re-measured 2026-10-29 (§13), after the night pass, the shader-build round and round three.**
  At the median a theme now shows in 0.75 s on a first visit and 0.52 s on a revisit. The longest
  frame in a switch is 63 / 44 ms at the median (was 80 / 54). No revisit freezes over 110 ms (was
  seven themes). Thermal Bloom's storms are the one window under 175 fps.
- **Round four (§14):** seven more first-visit freezes cut by 35-95 ms (Sunfall 152 → 59 ms the
  largest). In dGPU-only mode the game ran at 240 fps until the lid was closed.

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
- Re-read on the night pass: the monitor ticks only while `performanceMonitor` is enabled, which is
  when the FPS counter is shown (`showFPSCounter`). It recovers only when p95 is under 0.9× the
  budget (3.75 ms at 240), which a 178 Hz cadence never allows. So with the counter on, a 240
  target would step down to the floor and stay there. A fix would judge headroom at the display's
  achieved cadence, as Odyssey's caller does (`upscaleThresholdMs`). It is app-level, so it was
  left for a session that can verify it in the packaged app.
- **Confirmed and fixed (2026-10-29), §13.** In the dev desktop app, FPS counter on, target 240,
  Single Player: 1.0 → 0.5 in 45 s and never back. Fixed, the scale holds 1.0 through two minutes
  of play, the game's start and its game over; a load the display does not explain still steps it
  down.

## 8b. Tiers measured (2026-10-27 afternoon)

All 63 themes were run at Minimal, Low, Medium, Ultra and Extreme on 2026-10-27 afternoon, and at
High again on 2026-10-28 morning on the same build:
- Conditions: uncapped, Balanced mode, 4 s at rest and two 4 s storms, no second visit.
- Summaries: `reports/theme-fleet-bench/2026-10-27-tier-*` and `2026-10-28-tier-High`.
- The matrix, built by `scripts/lib/theme-bench-tools/tier-matrix.mjs High=tier-High-final`:
  `reports/theme-fleet-bench/2026-10-28-tier-matrix.md`.

**Median cost of a tier against each theme's own High** (worst window, frame time):

| Minimal | Low | Medium | High | Ultra | Extreme |
|---:|---:|---:|---:|---:|---:|
| 0.22× | 0.32× | 0.67× | 1.00× | 1.41× | 1.69× |

How the tiers hold 240 fps:
- **Minimal, Low and Medium:** every theme stays above 240 fps everywhere.
- **High:** three themes go below 240 fps somewhere: Thermal Bloom 181, Verdant Hills 203,
  Grainfields 205. Summer sits at 240. The median theme does 635 fps at rest.
- **Ultra:** 15 themes dip below 240 fps somewhere.
- **Extreme:** 20 themes dip below 240 fps somewhere.

**Drift.** The first matrix compared the tiers with the 2026-10-27 morning High baseline, and half of
its outliers were drift, not tiers. An interleaved re-check (two rounds each, same afternoon) gave:

| Theme | Morning High | Afternoon High | Afternoon Ultra |
|---|---:|---:|---:|
| Neon Dusk | 639 | ~985 | ~900 |
| Halcyon Apex | 543 | ~835 | ~590 |

Both are in step against the 2026-10-28 High.

**Out of step against the 2026-10-28 High** (13 themes flagged):
- **Most flags are noise.** Minimal ≈ Low, or Low a hair cheaper than Minimal, in Aether Tides,
  Chiral Gold, Ocean, Summer, Vesper Chrysalis and Voltage Storm. Frames there run at 2000-4000 fps,
  and steps under ~0.1 ms are noise.
- **Cinder Drift** reads Ultra 2.97× against Extreme 1.70×, from one slow storm window in the Ultra
  run. Its interleaved re-check gave Ultra storms ~460 fps against High ~660: about 1.4×.

The real outliers:

| Theme | Flag | Next step |
|---|---|---|
| Golden Forest | Medium 1.15× High (in both High baselines) | read its Medium row: FXAA, god rays at 16 steps ½ res, the MSAA-less pass; something there costs more than High's set |
| Chromadelic Highway | Medium 0.99× High | Medium changes little besides 0.9 resolution and bloom 0.25 |
| Wolfhour | Medium 0.94× High | forest and mist tiers are the same from Medium to Extreme |
| Black Hole | Low 0.68× High | Low's pixel ratio equals Minimal's; the march steps carry the cost |
| Parhelion | Low 0.61× High | Low still blooms (0.25, 3 mips); 4× MSAA on every tier |
| Cosmic Noir | Ultra 2.38×, Extreme 4.13× High | the volume (below) |

The Ultra/Extreme jumps below are real and match the code survey:

| Theme | Ultra / Extreme vs High | Why |
|---|---|---|
| Cosmic Noir | 2.3× / 4.0× | the volume's march steps and target scale |
| Stellar Velocity | 1.75× / 2.8× | the same |
| Thermal Bloom | 1.9× / 2.8-3.2× | adds 4× MSAA at Ultra |
| Voltage Storm | 1.65× / 2.7× | – |
| Aurora | 1.4× / 2.6× | – |

Medium-to-Low and Low-to-Minimal steps under ~0.1 ms are noise at 2000-4000 fps.

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
   - ~~Check the packaged app's dynamic resolution against a 240 target (§8).~~ Fixed (§13).
3. **Load freezes (§7):** done in the night pass (§11). What is left is node-graph builds inside
   frames: Neon District's shop material is built twice (81 ms each).
4. **Starvation under a saturated outgoing theme.** While a build-behind is starved (no pipeline
   progress for 250 ms), cap the outgoing theme's frame rate. Measure with a GPU-bound anchor first.
5. **GPU-bound themes, look-safe shader work.** Each needs a before/after screenshot:
   - High Coast's full-resolution shaft march (0.95 ms);
   - Moonlit Greenhouse's air march (1.06 ms);
   - Sunfall's full-resolution post target (0.54 ms);
   - the scene passes of Spring, Verdant Hills and Grainfields (2.8-3.1 ms, foliage under 4× MSAA);
   - Thermal Bloom's storm effects.
6. **Tier alignment.**
   - The tiers are measured (§8b). The flagged outliers were re-checked by GPU ms per pass (§11):
     only Cosmic Noir's Ultra/Extreme were real, and they are trimmed.
   - Then align the tiers:
     - one rule for High's pixel ratio;
     - MSAA that follows the antialiasing setting;
     - monotonic antialiasing;
     - Ultra and Extreme steps of a consistent size.

## 11. Night pass (2026-10-28 → 29)

The owner's rules for the night:
- every tier keeps the best look it can;
- **High stays identical**;
- lower tiers may lose detail, and Ultra/Extreme may be trimmed where they cost far more than High;
- fixes that change no pixel come first, then visually equivalent ones, and trims last.

Every change was checked with same-frame playground shots (`?t=18`, High, 2562×1601) against the
base `ce047c73`. The load caches were also checked with a second mount in the same page, which is
what a revisit draws. Still in Balanced mode (GPU 80-95 W).

### Loads: main-thread stalls removed (no pixel changes)

| Theme | What stalled the switch | Change |
|---|---|---|
| Neon District | Chromium decoded two atlases again, synchronously, inside the first WebGPU upload (`copyExternalImageToTexture`): 224 + 204 ms. `img.decode()` beforehand does not help. | `shared/decoded-texture.js` `loadBitmapTexture`: `createImageBitmap` on the fetched file decodes on a worker thread, unpremultiplied and flipped at decode. Upload now 20 ms per image. |
| Fall, Sunfall | GLB parsing, 83-132 ms on every visit | The parsed assets are kept for the session. `shared/attribute-floats.js` reads attributes straight from their arrays, bit-identical to the getters. |
| Spring | land, river, waterfall pour and step face rebuilt on every visit, 75-360 ms each | `shared/session-geometry.js`: on a second build, land 360 → 15 ms, river 308 → 0.1 ms |
| Starlight | noise and star catalogue, 85-100 ms on every visit | baked once a session |
| Aurora | the shared noise tile, ~85 ms on every visit | baked once a session |
| Forest | 63 ms laying out the firefly animals (first visit) | build steps of up to 24 ms; none on a revisit |
| Void Ember | the crust's plates bake, 174 ms (first visit) | baked in a module worker (the shared bake-worker client) while the renderer comes up |
| Himalayan Peak | reading the baked massif and deriving its shade, horizon and shadow maps and mesh: ~0.4 s in steps of up to 110 ms, every visit | read and derived once a session (per stride); half-float copies kept per map |
| Halcyon Apex | noise field and its half-float mip chain, ~30 ms every visit | kept for the session |
| Ice Temple | noise texture bake, 24 ms every visit | kept for the session |

The commits, in order:
- `8ca09778`: attribute reader; Fall and Sunfall asset caches.
- `8976700a`: Spring's session geometry.
- `dc1d131c`: Neon District bitmaps.
- `c3f2042a`: Starlight and Aurora bakes; Forest steps.
- `3aac9254`: Cosmic Noir and Aurora tiers.
- `f420d750`: fresh geometry per start.
- `b32a218b`: Void Ember worker.
- `8e4e6560`: Halcyon; the Forest step budget.
- `001e74aa`: Himalayan Peak.
- `d97b74ff`: Ice Temple.

**A trap the second mount caught.** three r186 cannot upload an interleaved attribute again after
its geometry is disposed. `destroyAttribute` destroys the InterleavedBuffer's GPU buffer but forgets
only the attribute's record.
- The first version of the Fall/Sunfall cache handed the next start the same attribute objects.
- A second start in one renderer then drew black ("used in submit while destroyed").
- Every start now gets geometry objects of its own over the kept arrays (`shared/fresh-geometry.js`,
  `f420d750`). Spring's session geometry always did.
- Any future session cache of GLB geometry should go through `freshGeometry`.

**Measured.** Interleaved A/B, two rounds per arm, at the panel's cadence (`ab-load.sh`, vsync on,
target 240, second visit on).
- A is the base build (`ce047c73`); B is tonight's build (`b32a218b`, before Halcyon and the
  Forest budget).
- "Freeze" is the longest frame while the switch runs, during which the outgoing theme and the board
  stop. Mean of two rounds, ms:

| Theme | Freeze cold | Freeze warm | Shown cold | Shown warm |
|---|---:|---:|---:|---:|
| Spring | 255 → 254 | **241 → 42** | 2105 → 2155 | **1620 → 1162** |
| Starlight | 122 → 121 | **108 → 22** | 632 → 628 | **523 → 445** |
| Neon District | 370 → 386 | **169 → 73** | 1723 → 1687 | **973 → 874** |
| Void Ember | **203 → 92** | 42 → 44 | 720 → 735 | 456 → 462 |
| Sunfall | 185 → 159 | 119 → 88 | 894 → 802 | 614 → 561 |
| Aurora | 173 → 164 | 152 → 138 | 742 → 751 | 581 → 562 |
| Fall | 250 → 248 | 184 → 183 | 823 → 850 | 640 → 589 |
| Forest | 71 → 50 | 62 → 40 | 1080 → 1155 | 921 → 908 |

How to read it:
- The revisits gain most, which is where the session caches act: Spring, Starlight, Neon District.
- Void Ember's first visit loses its plates bake.
- Cold shown times are within ±50 ms, which is noise at this cadence.
- What still freezes a switch is mostly not the theme's own CPU work.
  - Neon District's ~380 ms cold frame and Aurora's ~150 ms are node-graph builds (TSL → WGSL)
    inside render callbacks.
  - Fall's 250/183 ms frame did not move with its parse cached. It is a node-graph build too
    (see below).
- **Forest** first laid its animals out one per build step. Each step costs the outgoing theme a
  frame, so the show came 75 ms later for a 21 ms smaller freeze.
  - It now yields only when 24 ms of layout is spent: two or three steps on a first visit, none on
    a revisit.

A second A/B on the later build (`001e74aa`; same method, two rounds):

| Theme | Freeze cold | Freeze warm | Shown cold | Shown warm |
|---|---:|---:|---:|---:|
| Himalayan Peak | 113 → 119 | **124 → 48** | 954 → 926 | **774 → 481** |
| Halcyon Apex | 83 → 84 | **68 → 47** | 729 → 730 | 537 → 516 |
| Forest (24 ms budget) | 62 → 51 | 46 → 45 | 1080 → 1082 | 845 → 844 |

Ice Temple's noise cache (`d97b74ff`) came last. It has playground shots but no A/B; the profile
put it at 24 ms per visit.

### Tiers

- **Cosmic Noir Ultra/Extreme:** the smoke's `scale` went 0.65 → 0.52 (Ultra) and 0.75 → 0.48
  (Extreme).
  - Why: the drawing buffer already grows with the tier's pixel ratio, and the smoke's own scale
    compounded on top of it (2.4× / 4.1-4.8× High).
  - The extra march steps stay, and the smoke's resolution still rises a step per tier.
  - Shots: PSNR 50 dB; 0.15-0.18 % of pixels change by more than 8 levels; High is identical.
- **Aurora Medium:** FXAA on the graded output.
  - Why: its scene pass is single-sampled, and its canvas is no longer multisampled under the post,
    so Medium had no antialiasing at all, worse than Low.
  - Shots: the tree edges are smoothed; High is identical.

**Measured.** Interleaved A/B, two rounds per arm, uncapped (`ab.sh`). Base `ce047c73`, then
tonight's build:

| Theme, tier | Rest fps | Worst storm fps | Rest frame ms |
|---|---:|---:|---:|
| Cosmic Noir, Ultra | 228 → **331** | 147 → **218** | 4.39 → 3.02 |
| Cosmic Noir, Extreme | 131 → **279** | 80 → **179** | 7.65 → 3.59 |
| Aurora, Medium | 1036 → 991 | 1011 → 988 | 0.97 → 1.01 (FXAA ≈ 0.04 ms) |

Cosmic Noir's Ultra and Extreme now cost about 1.4× and 1.66× its High (462 fps in
`2026-10-28-tier-High`). That is the fleet's median step (1.41× / 1.69×).

**The flagged tier outliers, re-checked by GPU ms per pass** (`pass-profile.js`, 60 fps cap):

| Theme | High | Medium | Low | Verdict |
|---|---:|---:|---:|---|
| Golden Forest | 1.04 | 0.52 | – | Medium is half of High. The 1.15× frame-time ratio was drift on a ~480 fps theme. |
| Chromadelic Highway | 0.29 | 0.22 | 0.07 | in order |
| Black Hole | 0.63 | 0.51 | 0.35 | in order |
| Parhelion | 0.46 | 0.39 | 0.27 | in order |
| Wolfhour | 0.30 | 0.41 | 0.12 | Medium's one full-screen pass costs more than High's. Both are under 0.5 ms (at ~1000 fps) and within clock noise at this load, so left. |

### Not changed: High stays identical

- **Verdant Hills** (196 fps in the census): near grass 1.97 ms and far grass 0.79 ms of a 5.1 ms
  frame. That is ~2 million thin blade triangles under 4× MSAA. The census put each of a dozen small
  parts at ~0.5 ms, which is its noise floor at this frame rate.
- **Grainfields** (215 fps): the near barley's ears and stems ~2 ms; its empty scene (post chain)
  2.07 ms.
- What is left for these is visual: fewer near clumps, or blade LOD. That is the owner's call, after a
  Performance-mode re-measure.

### Findings left for later

- **Neon District** compiles its shop material (81 ms, 106 KB) twice: the 4× scene pass and the
  single-sampled street reflector need two pipelines. Matching them would change the reflection.
- **Fall's 250 ms switch frame** is a node-graph build. Before it comes a 96 ms world build
  (`buildScene`: the squirrel 26 ms, trunk measuring), which could be split into build steps.
- **Node-graph builds** are now the largest switch freezes. Rainbark has a 189 ms frame, Neon
  District ~380 ms cold and Aurora ~150 ms. They need smaller graphs (`Fn().setLayout`) or
  materials compiled across frames: work on three's side of the line.
- **A small per-visit bake still left:** Murmuration's particle state (34 ms).
- **Once, under load:** with the full test suite running, one Spring playground capture came out
  upside down (the water mirror's view on screen) and logged "used in submit while destroyed". Two
  later captures were clean, and the base build has the same reflector. Watch for it.
- **The playground's `?t=`** captures are reproducible across builds: unchanged themes matched within
  one level. Sunfall is the exception: its vine leaves are placed afresh on each mount. So the pairs
  above are a usable regression check.

## 12. Switch freezes: shader builds and the GPU process (2026-10-29)

Branch `perf/shader-build-freezes`, still in Balanced mode. Two new bench instruments:
- `--build-trace=1` records each first-time render-object build of a switch: its cost, and whether
  the build budget charged, deferred or exempted it.
- `--trace-load=1` / `--trace-gpu=1` record Chrome traces through Electron's `contentTracing`, so the
  GPU process is visible too.

**What the switch freezes left after §11 were.**
- **Single heavy materials.** The budget can't split one material.
  - Aurora's curtain march: 122 ms.
  - Rainbark's sky, near trunks, far trunks and post: 58–84 ms each.
  - Neon District's shop material: 77 + 62 ms (scene and reflection).
- **GPU-process stalls with the main thread idle:**
  - Neon District's 380 ms frame was the post chain's final composite compiled synchronously, 356 ms
    of DXC on the GPU process's main thread.
  - Fall's late 240 ms frame was its squirrel's pipelines (plume hair 140 ms, fur 84 ms). They
    compiled synchronously on the frame it first showed, after the switch's async window had closed.
- **Spring's first-visit build steps** (186 and 243 ms). Split in round three (§13): 50 ms.

**Changed:**

| Change | Measured (interleaved, main → branch, panel cadence) |
|---|---|
| Aurora marches its arcs in a TSL `Loop` over a uniform table of each arc's constants: one copy of the march, not four. Every constant reaches the shader as the same float. | Node build 133 → 45 ms, WGSL 75 → 27 KB. Switch freeze 167 → 106 ms (first visit), 138 → 75 ms (revisit). fps unchanged. Shots identical on WebGPU (max difference 0, 7 scenes incl. a storm). |
| A theme still built hidden (an in-play switch) creates its final composite async too (`asyncCompositeWhileHidden`). Once revealed, a composite is synchronous again. | Neon District 385 → 83 ms, shown 1686 → 1360 ms. Cosmic Noir 54 → 20 ms, Winter 76 → 45 ms. Five other themes unchanged. Hidden frames only. |
| Fall warms its parked squirrel at the end of `createScene`, alone (`warmParkedDrawablesAlone`: every other drawable sits the warm frame out, so the budget-free frame builds only the squirrel). | Fall 240 → 142 ms (first visit), 183 → 107 ms (revisit), shown 41–59 ms later. No synchronous pipeline over 20 ms from the switch through two storms. |

**Tried and left:**
- **three's own async node build** (`buildAsync`, `getForRenderDeferred`) yields between build
  stages. But the first chunk (graph construction and setup) is ~75 % of a heavy build, so the worst
  chunk only drops ~25 %.
- **Rainbark:** its shaders are big by design. Only 24–41 % of their code repeats, and its own rule
  keeps helpers that read uniforms inline (r186 cannot lay out a function that captures uniforms or
  textures). A restructure would save about a third.

**Effects that compiled mid-play.** A light GPU trace (`--trace-gpu`, switch plus two storms, all
63 themes) found seven themes whose effects stay out of sight until play calls them up. Their
pipelines then compiled synchronously on the GPU process's main thread on the first gameplay frame
that showed them:

| Theme | Before |
|---|---|
| Black Hole | infall 63, ejecta 59, jets 37 ms |
| Wolfhour | 24-31 ms × 4 |
| Tornado | 46 + 31 + 21 ms |
| Winter | the fox of light 72 ms |
| Sunfall | the Exhale cloud 37 ms |
| Grainfields | the locks' sunbeams 27 ms |
| Chiral Gold | a reflection-map bake at load, 62 ms (synchronous by design, left) |

Fall's squirrel (above) was the same case. Tornado, Wolfhour and Black Hole already had a warm
frame, but it did nothing. Two traps, both fixed in `shared/warm-hidden-drawables.js`
`warmParkedSoon`:
- **The build budget deferred the warm frame's builds.** The warm now lets only the parked drawables
  past the budget (`withBuildBudgetExemptFor`, which counts them). It runs in a task of its own just
  after the build, with every other drawable sitting it out. It retries a frame apart until one frame
  has built them.
  - Turning the budget fully off instead built the whole post chain in one task: Sunfall's switch
    freeze grew 147 → 199 ms.
- **A post chain's scene pass runs once per node frame.** A theme that draws its first frame inside
  its build had spent that frame's pass, so a later warm render drew nothing. Each warm render now
  advances the node frame first, as three's `compileAsync` does.

Also changed:
- Winter draws the fox of light dark for 120 frames after it arrives, not 4: with 4, the budget's
  queue still held it.
- The warm helper also gives an `InstancedBufferGeometry` with no instances one instance for the
  warm frame (Grainfields' beams).

Result: no synchronous pipeline over 20 ms in any of the seven, from the switch through two storms.

## 13. Round three (2026-10-29)

### The desktop app's dynamic resolution

**Before.** Dev desktop app (`electron/main.js` against a dev server), FPS counter on, target 240,
Single Player, Balanced mode: the scale went 1.0 → 0.5 in 45 s and stayed there. Two causes:
- **The judgement.** Frame times are presentation gaps, and Chromium presents this 240 Hz panel at
  ~178 fps. Every frame read 4.9–6.8 ms against a 4.17 ms budget: pressure on every tick. Recovery
  needed p95 under 3.75 ms, which this display never delivers.
- **The window.** Each 5 s tick read the monitor's last 60 frames, a third of a second at 178 fps.
  Its p99 is that window's one slowest frame, so one 8 ms frame was enough.

**The fix** (`desktop-performance-policy.js`, `performance-monitor.js`, the tick in `main.js`):
- Each tick reads every frame of the last 5 s (`getRecentFrameTimePercentiles`, ~900 frames).
- `displayBoundCadence`: the display sets the pace when even the quick frames (p10) are slower
  than the budget and the typical frame (p50) is within 1.45 refresh intervals. Chromium delivers
  1.25–1.35 here and on the 165 Hz laptop. Then pressure is p95 over 1.5× that pace or p99 over
  2.2×, and headroom (a lowered scale climbs back) is p95 under 1.3×.
  - A GPU that misses vblanks lands on whole intervals and still reads as pressure: quick frames
    on the refresh with a slow tail, or every frame at 2×. So does a p50 slower than the display
    ever delivers.
  - With no refresh rate known, or from Odyssey's caller, nothing changes.
- Pressure steps down only when two ticks in a row read it. The first 5 s of a game hold the
  board's start frames (p99 20 ms), and those stepped the scale down on the first tick.

**After**, same run:

| Run | Scale over two minutes | 5 s windows, p10 / p50 / p95 / p99 (ms) |
|---|---|---|
| main | 1.0 → 0.5 by 45 s, never back | |
| fixed | 1.0 throughout, through the start and the game over | 4.9 / 5.5 / 6.6–6.9 / 7.6–10.8 |
| fixed, 8 ms busy wait per frame | 1.0 → 0.6 in 40 s, one step per 10 s | 11.9 / 12.3 / 13.5 / 16 |

### Spring's first visit

**Before.** A session's first Spring froze the switch for ~250 ms. Two build steps were one long
task each (`--profile-load=1` on an unminified build, then the same in Node):
- **Land + step face:** 185 ms (land 110, face 74).
- **River + waterfall pour:** 166 ms (river 94, pour 140).

All four are session geometry (§11): a revisit already skipped them.

**Why the pour and the face were slow.** `pourPath` traces one column of water down the fall in
4 ms steps, up to 1,150 of them. Every step asks `faceAlong` (and `faceSlope`, two more calls)
where the rock is. Each call recomputed what depends only on the column: `lipDepth` (21 sines over
the seven tongues), the lip's line, the zones, the face's lean, the ribs and the layers' fold.

**Changed** (`f391211b`):
- **The fall plan keeps the last column's terms** (`spring-fall-plan.js`: `lipDepth`'s last answer,
  `columnAt`, `foldAt`). Each is the same expression in the same order, so the same float.
  - Pour 140 → 62 ms, face 74 → 55 ms.
  - The plan's import (its landing and burst tables trace 123 paths) 96 → 46 ms.
- **The four geometries are built ahead in steps of ~24 ms.** `prepareSessionGeometry` fills the
  session memo from a generator, and `stepClock` (`shared/build-steps.js`) yields from the row
  loops. `createLand`, `createStepFace`, `createRiver` and `createPour` are unchanged and find their
  geometry kept. A revisit has it kept already and takes no extra step.

**Checked:**
- **Geometry:** every attribute and index hashes the same as main on Low, High and Ultra.
- **Shots:** six same-frame playground shots (rest, level 3 and a four-line clear on High; rest on
  Low and Ultra; a remount). Branch against main differs exactly as main differs from itself: at
  most 1/255 on 0.01 % of pixels with MSAA, nothing on Low.
- **Steps (Node, High):** the longest first-visit step is 40 ms (the first, with the noise
  textures), the rest 24–27 ms.

Interleaved load A/B, 3 rounds, panel cadence (`ab-load.sh`), ms:

| | First visit: freeze | First visit: shown | Revisit: freeze | Revisit: shown |
|---|---:|---:|---:|---:|
| main | 248 / 257 / 272 | 2237 (mean) | 27 / 34 / 33 | 1214 (mean) |
| branch | 51 / 51 / 49 | 1919 (mean) | 50 / 34 / 32 | 1141 (mean) |

- The first visit shows ~320 ms sooner despite more breaths: less work in all.
- The revisit's one 50 ms round did not repeat.

### The fleet re-measured after rounds two and three

The whole fleet at the panel's cadence on `f391211b` (main `38ce04bb` + this round): High,
`--vsync=1 --target-fps=240`, the same windows as §4. Balanced mode (power limit 95 W), nothing
else running. Raw: `reports/theme-fleet-bench/2026-10-29-round3-high-vsync/`, with
`vs-2026-10-27.md` (every theme against §4's run) and `table-cadence.md`.

The two runs are two days apart, so main's own theme work since 2026-10-27 is in the comparison
too (Golden Forest's cranes, Forest's owl, Winter's bear, Fall's squirrel, Verdant Hills' flock,
Sunset's gulls). Single cells drift; read the fleet, not one theme.

| All 63 themes | 2026-10-27 | 2026-10-29 |
|---|---:|---:|
| Shown, first visit (median / mean, s) | 0.79 / 0.89 | **0.75 / 0.84** |
| Shown, revisit (median / mean, s) | 0.57 / 0.68 | **0.52 / 0.60** |
| Longest frame in the switch, first visit (median / mean, ms) | 80 / 96 | **63 / 66** |
| Longest frame in the switch, revisit (median / mean, ms) | 54 / 69 | **44 / 47** |
| Late frames (median / mean) | 0.18 / 0.21 % | 0.15 / 0.18 % |
| Themes with a window under 175 fps | Spring, Thermal Bloom, Rainbark | Thermal Bloom |
| First-visit freezes over 110 ms | 12 themes | 6 |
| Revisit freezes over 110 ms | 7 themes | **none** |

The largest switch freezes, ms (first visit / revisit):

| Theme | 2026-10-27 | 2026-10-29 |
|---|---:|---:|
| Neon District | 357 / 163 | 78 / 62 |
| Spring | 259 / 542 | 51 / 41 |
| Fall | 254 / 183 | 96 / 72 |
| Void Ember | 208 / 54 | 57 / 39 |
| Aurora | 165 / 155 | 106 / 80 |
| Himalayan Peak | 101 / 122 | 107 / 52 |
| Starlight | 118 / 112 | 113 / 22 |

**Left over 110 ms** (first visit only): Sunfall 149, Rainbark 131, Stellar Drift 123, Solar
Eclipse 119, Starlight 113, Ice Temple 112. §12 named most of them: a single heavy material, or
first-visit bakes.

**Frames:** Thermal Bloom's storms are the one window under 175 fps (170, 1.96 % late). This is the
GPU-bound look (§11), the owner's call. Spring's storms, 174 with 0.90 % late on 2026-10-27, read
179 and 0.10 %.

## 14. Round four: first-visit freezes (2026-10-29 evening)

Branch `perf/first-visit-freezes`. Balanced mode; the laptop's lid was closed for most of it, so
everything here was measured at the ~178 fps cadence. Load A/Bs compare main and branch interleaved
under the same conditions, so they hold.

### The 240 Hz ceiling, found and lost

- After a reboot into **dGPU-only mode** (Legion Space → GPU-arbetsläge → dGPU-läge, so Windows
  lists only the RTX 5080; NVIDIA G-SYNC on for windowed and fullscreen):
  - a bare page presented at 240 fps (4.2 ms frames);
  - the game ran at 240: Nimbus Veil 240 at rest and 239 in storms; Spring 240 at rest, 237 and
    201 in its storms (the GPU at Balanced's power limit);
  - the first four themes of a whole-fleet run read 240.
- About 8 minutes later everything read ~178 again, the bare page too, still in dGPU mode, on mains
  power. The owner had closed the lid. With the built-in panel off, nothing paces frames at 240 Hz.
- **Next:** the whole fleet at 240 Hz in dGPU mode with the lid open. Check the bare page first
  (`vsync-probe.cjs`: 240 means the ceiling is gone).

### What the profiles found

`--profile-load=1` on an unminified build, split into tasks. The six themes still over 110 ms on a
first visit after §13, then the next five by freeze:

| Theme | First-visit freeze (§13 run) | What it was |
|---|---:|---|
| Sunfall | 149 ms | lattice, fBm and oculus baked on every visit (~60-90 ms) |
| Rainbark | 131 ms | three single heavy materials: sky 124, near trunks 120, far trunks 80 ms of node build |
| Stellar Drift | 123 ms | lattice, clouds, rings and bands (~60 ms at High); then its space material (66 ms) |
| Solar Eclipse | 119 ms | noise and ranges (~35 ms) baked on every visit; then its sky (100 ms of node build) |
| Starlight | 113 ms | noise and star catalogue (85-100 ms), first visit |
| Ice Temple | 112 ms | architecture geometry (30-50 ms) every visit, noise mips first visit; then node builds |
| Fall | 96 ms | the grove built in one ~80 ms call, then the post and the squirrel's warm frame |
| Summer | 78 ms | its lake map (512 × 384 samples), one 70-90 ms step every visit |
| Geode, Chiral Gold, Aurora | 93-106 ms | no single main-thread task that long: the worst frame is CPU work and rendering back to back, or a GPU stall |

**The big single materials are mostly unique code.** In Solar Eclipse's sky, one range instead of six
saves ~7 KB of WGSL and a few ms of the ~70 ms build; one cloud row instead of three ~8 KB. Drawing
no sun takes it to 26 ms: the corona, prominences, beads and glare are one-off code. Stellar Drift's
space material is the same. So the Aurora-style loop rewrite (§12) gains little here; what is left is
on three's side (one material's node build cannot be split across frames).

### Changed

| Theme | Change |
|---|---|
| Starlight | noise and star catalogue bake in a module Worker while the renderer comes up (`starlight-bakes.js`) |
| Solar Eclipse | noise and ranges kept for the session; a first visit's bake in a worker (`solar-eclipse-bakes.js`) |
| Stellar Drift | lattice, clouds, rings and bands in a worker, priming the bake cache under the world's own keys (`stellar-drift-bakes.js`) |
| Sunfall | lattice, fBm and oculus kept for the session (bake cache) and baked in a worker while the GLBs load; the pure bakes moved to the three-free `sunfall-bake-data.js` |
| Ice Temple | architecture geometry kept for the session (`sessionGeometry`, keyed by the plan's seed) |
| Fall | `FallWorld.buildSteps`: a part or two to a step; a start builds it breathing, then the post, then the squirrel's warm frame, each in a task of its own |
| Summer | the lake map kept for the session; a first visit bakes it in row steps of ~24 ms |

- Each worker's output is checked byte for byte against the page's bake (tests).
- The stepped grove equals the one-call grove, part for part and draw for draw (test).
- Same-frame playground shots at High and Low, plus a remount: identical to main within run-to-run
  noise. Sunfall's vines are placed afresh on each mount, so main differs from itself as much as
  from the branch.

### Measured

Interleaved load A/B, 3 rounds, panel cadence, main → branch, ms:

| Theme | Freeze, first visit | Freeze, revisit | Shown, first visit |
|---|---:|---:|---:|
| Sunfall | 152 → **59** | 90 → **45** | 760 → 721 |
| Starlight | 123 → **40** | 25 → 25 | 594 → 616 |
| Stellar Drift | 129 → **71** | 51 → 47 | 719 → 726 |
| Solar Eclipse | 126 → **88** | 102 → **78** | 816 → 789 |
| Ice Temple | 89 → 90 | 45 → **22** | 801 → 786 |
| Fall | 100 → **60** | 72 → **30** | 813 → 853 |
| Summer | 78 → **49** | 77 → **38** | 1484 → 1452 |

- Starlight shows ~20 ms later: the build waits for the worker, which starts a little behind the
  renderer.
- Fall shows ~40 ms later: each breath costs the theme still playing a frame.

### Left

- **Single heavy materials:** Rainbark (131 ms), Solar Eclipse's sky and Stellar Drift's space (the
  rest of their 88 and 71 ms), Aurora's curtain. Smaller graphs would need the shaders restructured
  (a third at most for Rainbark, §12) or three building one material across frames.
- **Ice Temple's first visit** (90 ms): the architecture and the noise mips could bake in a worker.
- **Geode, Chiral Gold, Aurora** (93-106 ms): find out which frame it is (a GPU trace).

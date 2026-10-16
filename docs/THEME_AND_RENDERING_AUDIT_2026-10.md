# Serenity Blocks — theme and rendering audit

**Date:** 2026-10-14 · **Tree:** `main` @ `cde601f8` (branch `audit/theme-rendering-2026-10`) ·
**Scope:** the 64 theme folders in `src/themes/` plus `src/themes/shared/`, the theme pipeline
(theme manager, base theme, frame pacer, prewarm, handoff, async pipelines, GPU-loss handling),
Odyssey rendering (`src/rendering/odyssey/`), and hardware verification of the GPU-dependent
items the [2026-10-13 audit](REPOSITORY_AUDIT_2026-10-13.md) left for this machine.

> **Status: a record, not a backlog — and IN PROGRESS.** Per [ARCHITECTURE_INDEX.md](ARCHITECTURE_INDEX.md),
> harvest items into [ARCHITECTURAL_REMEDIATION_PLAN.md](ARCHITECTURAL_REMEDIATION_PLAN.md) before
> executing them. Line numbers describe `cde601f8`; re-verify before acting. This audit changes no
> application code. The [Progress tracker](#progress-tracker) at the end says what is done and
> what the next session should pick up. The fixes merged after it, the open queue and how to
> continue are in [THEME_AUDIT_HANDOVER_2026-10.md](THEME_AUDIT_HANDOVER_2026-10.md).

> **Main moved after this audit (noted at merge time, 2026-10-14).** Everything here was read and
> measured on `cde601f8`. Before this document merged, main gained the menu stage art (`b6e2e5bb`)
> and `09d0bdfb` "Give every theme's camera a shared breath" (merged as `e43a6428`). That commit
> touches 60 theme folders and adds `src/themes/shared/camera-breath.js`, so `file:line` citations
> in those themes can be off by a few lines. It also changes what reduced motion does. 58 themes
> now call `applyCameraBreath`; the six that do not are aether-tides, blood-moon, nebula-flow,
> parhelion, sky-children-v2 and wolfhour. Every caller sets the breath's scale to 0 under
> reduced motion:
> - themes with their own flag use that flag;
> - the eight OS-only themes and the nine that read neither input use `prefersReducedMotion()`,
>   which is true when either `settings.reducedMotion` or the OS query is set. Moonlit-forest and
>   moonrise-summit use it alone; the others combine it with their own flag.
>
> So the reduced-motion counts below (46 / 8 / 9) and the "reads neither" or "OS query only"
> findings still hold for each theme's **own** motion, but not for the new shared camera breath.
> Among the 17 themes listed as "OS query only" or "neither", either input now stills that breath
> (wolfhour has no breath). The runtime
> reduced-motion rows were measured before the change. Nothing else here was re-checked against
> the new main.

> **Fixed since this audit (2026-10-14, branch `fix/theme-suspend-and-device-loss`; umbrella plan
> §0b rows T1 and T2).**
> - **PIPE-01:** `suspendThemes()` now leaves a parked theme alone
>   (`ThemeManager.isParkedThemeInstance()`; activations in flight are counted per instance, so a
>   queued start is still cancelled). Packaged Windows before startup completes still releases it,
>   because its policy keeps no suspended runtimes. The R-session re-run on the RTX (seen in Quiet
>   mode) showed:
>   - no cancellation at boot or on exit;
>   - the second entry quick-resumes instead of loading a fresh theme identity;
>   - 3 GPU devices per session instead of 5.
>
>   Side effect: on the menu, the intro canvas now presents at 131/s instead of 98.6/s, because
>   nothing rebuilds behind it any more. The uncapped intro renderer (P4) is now the whole cost
>   there.
> - **PIPE-09:** a device the app destroyed is broadcast with `destroyed: true`. It is not counted
>   as a loss, and the coordinator never recovers it.
> - **PIPE-22:** a duplicate WebGL monitor gets a no-op unsubscribe.
>
> Still open from C1 and C4: PIPE-02/03/05/19, the THM-33 family, THM-228, PIPE-10 and ODYR-17.
>
> **Also fixed (2026-10-14, branch `fix/theme-warm-parked-fx`; plan §0b row T3): the first-combo
> stalls (P1).** Tornado (THM-70), wolfhour (THM-227) and cosmic-noir (THM-118, render pipelines
> only) declare their parked FX and draw them once at the end of the build through their own post
> path, using the shared `warmParkedDrawables()`. Re-run of the leak harness on the RTX, same
> settings as batch 1 and batch 3, seen in Quiet mode:
>
> | Theme | First-burst sync pipelines, before → after | Frame gaps in the first burst, before → after | Sync pipelines at switch-in, before → after |
> |---|---|---|---|
> | tornado | 5 → **0** | 97 and 271 ms → **none** | 26 → 31 |
> | wolfhour | 14 → **2** | 75 and 91 ms → **none** | 16 → 32 |
> | cosmic-noir | 5 → **2** | 89 ms → **none** | 16 → 19 |
>
> There were no GPU errors and no driver events, and the idle screenshots match the pre-fix ones.
> The two pipelines left in wolfhour and cosmic-noir cause no gap; they were not identified.
> Not done: the manager still never reads `getWarmupRoots()` (THM-137/179/244), and
> himalayan-peak's late eagle (THM-100) measured 0 pipelines and was left alone.
>
> **Also fixed (2026-10-14, branch `fix/theme-reduced-motion-setting`; plan §0b row T4): the
> in-game Reduce motion setting in the eight "OS query only" themes** (THM-54, THM-77, THM-94,
> THM-155, THM-192, THM-233, THM-235 and fall). They now read the setting as well as the OS
> query, live. A toggle made while the theme is parked is kept. Moonrise-summit also stills its
> camera when reduced motion is already on at start. What these themes calm is unchanged: mostly
> the pointer lean, plus main's shared camera breath. Leak-harness re-run on the RTX (seen in
> Quiet mode), motion energy as default / setting live / setting rebuilt / OS live / OS rebuilt:
> - **moonrise-summit:** 2.33 / 2.18 / 2.19 / 2.18 / 2.20. That is about −6 % in all four
>   reduced states; at audit time all five were 2.21 / 2.18 / 2.21 / 2.19 / 2.22.
> - **forest:** 8.71 / 6.74 / 6.03 / 6.95 / 6.14. Most of that drop is the shared breath, which
>   already obeyed both inputs.
>
> No GPU errors. One new finding came out of this check: THM-264.
>
> **Also fixed (2026-10-14, branch `fix/theme-resume-rebuild-guard`; plan §0b row T5): the
> double build after a quality change made behind the menu** (THM-33, THM-47, THM-50, THM-55,
> THM-67, THM-93, THM-183 and every other copy, 47 in all). `BaseTheme.resume()` refuses a theme
> with a rebuild pending, the manager restarts it once, and a start clears the flag. The
> per-theme "resume, then queue a rebuild" branches are deleted. The hidden-tab resume (moved from
> `main.js` to `ThemeManager.resumeActiveThemeAfterHiddenTab()`) restarts a theme that refused
> instead of kicking its loop. A new probe
> (`.cache/theme-audit/resume-probe.mjs`) plays, exits to the menu, sets Effect Quality to Low
> and re-enters. On the RTX, seen in Quiet mode:
>
> | Theme | Before: GPU devices built, createScene() calls, "produced no frames" | After |
> |---|---|---|
> | verdant-hills | 2, 2, 1 | **1, 1, 0** |
> | tornado | 2, 2, 1 | **1, 1, 0** |
> | high-coast | 2, 2, 1 | **1, 1, 0** |
>
> That confirms the THM-93 trace at runtime. All three came back running at Low quality with no
> errors. As before, the restart does not carry the theme's clock (only sky-children keeps its run).
>
> **Also fixed (2026-10-14, branch `fix/theme-flashes-and-moonrise-rays`): the photosensitive
> flashes under reduced motion, and moonrise-summit's god rays.**
> - **neon-district (THM-35):** under reduced motion every lightning is one soft swell. The storm
>   light loses its 13.7 Hz flicker, the 31 s sheet lightning (11.8 Hz) becomes one gentle rise and
>   fall, and the 0.2 s blackout and the glitch steps are skipped. Unit tests check that the storm
>   only ever fades and that the sheet lightning turns once.
> - **rainy-window (THM-236):** it reads Reduce motion now (setting or OS, live). Lightning becomes
>   one soft sky glow, with no bolt and no strobing lights. The camera ramps to its rest pose over
>   1.5 s and stops diving. Its roll was also wrong (THM-265, fixed).
> - **moonrise-summit (THM-264):** the rays start at the moon and fade out before the quad's
>   edges.
>
> Leak harness on the RTX, seen in Quiet mode: no GPU errors. Neon-district's motion energy drops
> 64-78 % under reduced motion. Rainy-window's drops in every run (6.7-10.6 against 10.7, and
> 5.6-7.2 against 14.3 in an earlier run), noisy because rain, waves and the soft glow still move.
> Screenshots show the rays coming from the moon with no rectangle, and a level rainy-window
> horizon. Not done: in every other theme the shared camera breath still switches on or off in
> one frame when the setting flips (THM-266); eight themes still read no reduced-motion input for their own motion.
>
> **Also fixed (2026-10-14, branch `fix/theme-lifecycle-restart-warm-pause`; plan §0b row T5):
> the restart leak, the uncancellable warm-up and drawing behind the menu.**
> - **THM-228 / PIPE-19:** `start()` now also releases a runtime that a *stopped* theme still
>   holds (renderer, scene, bus subscriptions).
> - **PIPE-02 / PIPE-03:** every activation cancels a background pre-warm. A warm never starts
>   while an activation is building, and one already running stands down without parking or
>   disposing the instance being entered.
> - **THM-182 / THM-21:** the shared frame loop ends instead of drawing while the theme is
>   paused. Moonlit-forest and wolfhour defer a quality rebuild made while paused to the
>   one-restart path, and parhelion starts its loop only when not paused.
>
> A new probe (`.cache/theme-audit/lifecycle-probe.mjs`) runs three exit/enter cycles with
> suspended runtimes not kept, then changes quality behind the menu. On the RTX, seen in Quiet
> mode:
>
> | Theme | Before: canvases / bus listeners / live GPU devices after cycles 1-3; frames drawn behind the menu in 3 s | After |
> |---|---|---|
> | wolfhour | 2-3-4 / 24-28-32 / 2-3-4; **187** | 1-1-1 / 20-20-20 / 1-1-1; **0** |
> | moonrise-summit | 2-3-4 / 19 / 0 (WebGL); 0 | 1-1-1 / 19 / 0; 0 |
> | moonlit-forest | 1-1-1 / 22 / 1; **116** | 1-1-1 / 22 / 1; **0** |
>
> All three re-entered at the new quality and rendered, with no errors. The pre-warm race is
> covered by unit tests only: its timing window is too narrow to hit on purpose.
>
> **Also fixed (2026-10-14, branch `fix/theme-reduced-motion-batch-a`): reduced motion in four
> themes that read neither input** (THM-232 wolfhour, THM-191 misty-lake, THM-147 crystal-cave,
> THM-122 cosmic-noir). A new `src/themes/shared/reduced-motion.js` holds
> `prefersReducedMotion()` and `easedMotion()`, a 0..1 factor that follows the setting over 1.5 s
> so nothing jumps when it flips; `camera-breath.js` re-exports both. Under Settings > Reduce motion
> or the system preference:
> - **wolfhour:** both camera paths hold still (pan, pointer, breath zoom, and the 8-13 Hz
>   shake), and no ambient meteors cross the sky.
> - **misty-lake:** the camera sway stops, and the combo light burst is a soft glow.
> - **crystal-cave:** the camera drift and pointer stop, the board flash is halved, and the
>   4.8 Hz and 2.7 Hz spark shimmer is steady.
> - **cosmic-noir:** the orbit, dolly, look drift, parallax and rig float stop; impact shake is
>   skipped; the combo flash and lens flare stop flickering; the per-lock star flash is softer.
>   The scene's own drift (disk, nebula, dust, star layers, composition) runs at 15 % through a
>   CPU-integrated lag.
>
> Each theme's shared breath follows the same ease (THM-266 for these themes). Leak harness on the
> RTX, seen in Quiet mode, motion energy as default / setting live / setting rebuilt / OS live / OS
> rebuilt, against "no reduction" at audit time for all four:
>
> | Theme | Motion energy | Change |
> |---|---|---|
> | wolfhour | 5.95 / 0.06 / 0.12 / 0.06 / 0.13 | −98 % |
> | crystal-cave | 7.98 / 2.17 / 2.25 / 2.17 / 2.26 | −72 % |
> | cosmic-noir | 14.80 / 7.56 / 8.28 / 8.24 / 6.93 | −44 to −53 % |
> | misty-lake | 2.32 / 2.24 / 2.21 / 2.23 / 2.22 | −4 %: its motion is water and mist, the camera sway was small |
>
> No GPU errors and no driver events.
>
> **Also fixed (2026-10-14, branch `fix/theme-reduced-motion-batch-b`): the other four**
> (THM-175 nimbus-veil, THM-190 neon-dusk, THM-61 synthwave-sunset, THM-129
> chromadelic-highway). Each world eases `motion` in `updateCamera()` and scales its own
> motion by it:
> - **All four:** camera drift and pointer parallax stop.
> - **nimbus-veil:** the cloud sea drifts at 30 %, sun pulses stay soft, and there are a third
>   as many glints.
> - **neon-dusk:** the VHS glitch (18 Hz) never shows, the floor runs at 30 %, sun pulses stay
>   soft, and there are a third as many pixels.
> - **synthwave-sunset:** the cells stop twinkling (about 5 Hz), the grid runs at 30 %, the
>   horizon flash and sun pulses stay soft, no ambient shooting stars cross the sky, and there
>   are a third as many sparks.
> - **chromadelic-highway:** the float, bank, look-ahead, pace FOV widening and Tetris surge stop;
>   the road runs at a quarter of its speed; the 2-10 Hz storm strobe is a steady glow; there
>   are no idle meteors and less streak warp.
>
> The scroll slowdowns are CPU-integrated lags, so a seek of the clock still lands. Leak harness
> on the RTX, seen in Quiet mode, against "no reduction" at audit time for all four:
>
> | Theme | Motion energy (default / setting live / setting rebuilt / OS live / OS rebuilt) | Change |
> |---|---|---|
> | synthwave-sunset | 7.62 / 2.19 / 2.13 / 1.88 / 2.07 | −71 to −75 % |
> | nimbus-veil | 2.57 / 0.78 / 0.95 / 0.93 / 0.94 | −63 to −70 % |
> | neon-dusk | 8.61 / 4.64 / 4.91 / 4.82 / 4.92 | −43 to −46 % |
> | chromadelic-highway | 10.52 / 9.28 / 6.68 / 8.61 / 6.98 | −12 to −36 %: the road still flows, at a quarter of its speed |
>
> No GPU errors and no driver events. With batch A, every registered theme now reads Reduce
> motion.
>
> **Also fixed (2026-10-14, branch `fix/theme-breath-ease-and-warm-adopt`):**
> - **THM-266:** `applyCameraBreath()` keeps a per-camera scale.
>   - Switching Reduce motion on stops the breath at once, as the theme suites expect.
>   - Switching it off eases the breath back over 1.5 s of the theme's clock. It used to
>     restart in one frame, a hop of about 2 units, in every theme.
>   - A seek, a frozen frame or a replay lands settled, so captures stay deterministic.
> - **PIPE-05:** entering a mode during a boot pre-warm adopts the running warm (reveal and
>   publish) instead of tearing it down and building it again.
>   - An adopt probe on the RTX, seen in Quiet mode, entered right at "Pre-warming theme
>     (hidden)" twice. Before: 2 GPU devices and active 1.3-1.4 s after the click. After:
>     1 device, "Adopted the running pre-warm on entry", and active about 0.5 s after the
>     click.
> - **The restart carries the run:** a quality change behind the menu (or in the in-game
>   settings) used to send every theme back to clock 0, and most back to level 1.
>   - BaseTheme now captures the clock and level when `resume()` hands the theme back, and
>     restores them after `stop()`.
>   - Carry-pattern themes get the run as their `this.carry`; sunset and luminous-tides add
>     their day target and hour wheel.
>   - 31 themes whose `createScene()` started the clock at 0 now read `takeRestartTime(0)`.
>   - Halcyon-apex, ocean, stillwater and vesper-chrysalis lost their own early
>     `return false`, so the base class captures the run.
>   - A clock probe on the RTX (level 4, about 17 s of play, then suspend, quality Low and
>     resume): tornado, stillwater, ocean, aether-tides and verdant-hills went from clock
>     about 5 s (and level 1 or 0) to clock 20-23 s, and level 4 where the theme tracks it.
>   - Not covered: moonlit-forest and parhelion (`elapsedTime`), and themes that do not
>     re-apply a restored level to their world.
>
> **Also fixed (2026-10-14, branch `fix/frame-rate-cap-loops`):**
> - **C3 (THM-180, THM-229/230, PIPE-16/17):** misty-lake and rainy-window draw at the Target
>   Frame Rate through `shouldRenderFrame()`.
>   - misty-lake steps its bird drift and its glow and bloom decays by time.
>   - rainy-window steps its storm by the real time between drawn frames instead of 1/60 s a
>     frame. On the 165 Hz panel the storm, rain and camera ran 2.2 times too fast. A second
>     start no longer stacks a loop. The rain integrates its storm-scaled speed instead of
>     multiplying the whole clock by it, which lurched the rain more the longer it ran.
>   - On the RTX, seen in Quiet mode, Target Frame Rate 60, 20 s idle each: misty-lake went from
>     131.3 to 65.5 frames/s and from 85 to 33 W; rainy-window from 130.6 to 65.5 frames/s and
>     from 106 to 67 W. The aurora control read 21-23 W both times. No GPU errors, no driver events.
> - **REND-02 (the cap), REND-08 part 1 / ODYR-03, ODYR-27:** the menu intro renderer and the
>   Odyssey map draw at the Target Frame Rate with the themes' pacer (`?noThemeFpsCap=1` turns
>   it off for all three).
>   - The intro draws nothing while its container is hidden. Odyssey's entry hides it, so after
>     a return to the menu it no longer draws under the map.
>   - The intro's dynamic quality judges a Target Frame Rate under 60 against that target, so
>     a 30 fps cap does not drop the background to LOW.
>   - The map's adaptive quality records the slowest refresh since the last drawn frame. Under
>     the cap the gap between drawn frames is the cap itself and would never read as headroom.
>   - The music pulse, the warp decay, the seam bloom punch and the black-hole lens glide are
>     smoothed by time.
>   - On the RTX, seen in Quiet mode, Target Frame Rate 60, two Odyssey visits with a return to
>     the menu between them: the menu intro went from 131 to 66 frames/s and the map from 130
>     to 66.
>   - On the second visit the intro had drawn 130.6 times a second under the map, and the GPU
>     drew 85.5 W at idle. After: only the map draws, at 28.2 W. The map alone went from 31.5
>     to 28.8 W and the menu from 30.8 to 27.2 W. No GPU errors, no console errors, no driver
>     events.
>
> **Also fixed (2026-10-14, branch `fix/menu-renderer-park`):**
> - **REND-02 (the rebuild):** entering a mode destroyed the menu renderer, so every return to the
>   menu built a new GPU device, scene and pipelines.
>   - The dismissal now parks it: hidden, its loop stopped, and shrunk to 64×36 (one frame drawn
>     there, since three resizes its post targets as it renders). The return revives it, and
>     rebuilds it only if its device or WebGL context was lost during play.
>   - A return during the one-second dismissal fade waits for it; before, the fade could remove
>     the container from under the menu.
>   - On the RTX, seen in Quiet mode, three Single Player round trips: each return after the
>     first created 0 GPU devices and 0 pipelines instead of 1 and 36, and the menu drew 10-17 ms
>     after the return call instead of about 117 ms.
>   - The cost, during play: about 36 MiB more VRAM (shrunk; 135 MiB parked at full size) and
>     about 200 MB more GPU-process memory, the second live device, which the menu already holds.
>     No GPU errors, no driver events. Still open: pausing it under Settings and the Hub (R-29).
>
> **Also fixed (2026-10-14, branch `fix/perf-lane-gpu-samples`, Performance mode):** see
> [THEME_PERF_FLEET_2026-10.md](THEME_PERF_FLEET_2026-10.md), the fleet sweep of all 63 themes.
> - **INS-01:** the perf lane resolves GPU timestamps only after a rendered frame, and divides
>   the total by the frames it covers. That gives one sample per frame instead of 1.4-1.9.
> - **The level-up freeze:** an in-play switch builds the incoming theme behind the playing one.
>   Pipelines are created async, each new render object's node build is limited to 8 ms per
>   frame, and the two crossfade. On five vegetation-heavy switches from forest, the longest
>   freeze went from 0.55-3.3 s to 0.18-0.42 s.

**Relationship to the 2026-10-13 audit.** That audit ran in a cloud container with no GPU and
deliberately excluded the themes and their performance. This one covers exactly that gap, on the
owner's laptop. Its [Fixed since this audit](REPOSITORY_AUDIT_2026-10-13.md#fixed-since-this-audit)
table and [OWNER_DECISIONS_RESEARCH_2026-10-13.md](OWNER_DECISIONS_RESEARCH_2026-10-13.md) were
read first; items fixed there are not re-reported here.

## Machine conditions

Every measurement in this document was taken under these conditions unless its row says otherwise.

| Item | Value | How it was read |
|---|---|---|
| Machine | Lenovo Legion 5 15ACH6H (82JU) | `Win32_ComputerSystem` |
| CPU | AMD Ryzen 7 5800H, 8 cores / 16 threads | `Win32_Processor` |
| Dedicated GPU | NVIDIA GeForce RTX 3070 Laptop GPU, driver 572.47; enforced power limit **115 W** (default 115 W, max 130 W) at session start | `nvidia-smi` |
| Integrated GPU | AMD Radeon (Cezanne), driver 31.0.12044.3 | `Win32_VideoController` |
| Display | internal panel (1920 × 1080 native), scanned out by the **AMD iGPU** (hybrid mode: frames the RTX renders are copied to the iGPU for display). The **desktop runs at 1600 × 900, 100 % scale** (`scaleFactor 1`, work area 1600 × 852), stretched to the panel. | `Win32_VideoController`; Electron `screen.getPrimaryDisplay()`; `AppliedDPI = 96` |
| Refresh rate | **nominal 165 Hz** (Windows and Electron `displayFrequency`), but Electron's **rAF runs at 131.5–131.8 Hz** (p50 7.4–7.5 ms) even on a blank page (two runs, 09:43 local). All cadence numbers below are against ~131.6 Hz. | Electron `displayFrequency`; scratch blank-page rAF probe |
| Lenovo power mode | **Quiet** (owner-set via Fn+Q for the whole audit). Not independently confirmed: `LENOVO_GAMEZONE_DATA.GetSmartFanMode` needs admin ("Access denied"). The 115 W enforced cap is consistent with Dynamic Boost being off. | owner; `nvidia-smi` |
| Windows power plan | Balanced ("Balanserat") | `powercfg /getactivescheme` |
| Power source | **AC** (`Win32_Battery.BatteryStatus = 2`, 96 % at 08:57) | `Win32_Battery` |
| GPU the game uses | **the RTX 3070** (confirmed): the game's own log line `[GPU] Active Renderer: Google Inc. (NVIDIA) - ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Laptop GPU (0x000024DD) Direct3D11 vs_5_0 ps_5_0, D3D11)` (`src/rendering/renderer.js:745-747`, `window.activeGPURenderer`) and the WebGPU adapter `vendor nvidia, architecture ampere`. Every Electron run here passes `force_high_performance_gpu`, as `electron/main.js:57` does; each runtime row repeats the check. | game log; `navigator.gpu.requestAdapter()` |
| Background GPU clients | Epic Games Launcher and its EOS overlay renderer hold the RTX (C+G) and keep it in P0 (29 W at 0 % utilisation) | `nvidia-smi` |
| Concurrent sessions | 14 idle interactive Claude sessions in this repo plus cloud sessions; no Electron or Chrome running at start; shared GPU lock free | `ListAgents`, `Win32_Process` |

**How to read the performance numbers here.**
- Quiet mode runs the CPU and GPU below full power, so every absolute timing is *worse* than the
  same machine in Balanced or Performance mode would give.
- Compare themes **relative to each other** within this document.
- Do not compare them with `perf-budgets.json` or older committed baselines (captured at full
  power) without the power-mode caveat stated next to the comparison.
- Every performance-based finding is marked **"seen in Quiet mode"**.

## Method

**Step 1 — static pass (no GPU load).** Twelve parallel read-only reviewers, each told to cite
`file:line` for every claim and to label it:

- **VERIFIED:** traced in code (the line is quoted), or measured with a verified instrument.
- **PLAUSIBLE:** a mechanism-level claim that needs a runtime check (the check is named).

| Reviewer | Scope |
|---|---|
| B1 | sky-children, neon-district, sky-children-v2 (retired id), geode, waves, golden-forest, synthwave-sunset, blood-moon |
| B2 | rainbark, pyrestorm, vesper-chrysalis, ice-temple, galaxy, solar-eclipse, parhelion |
| B3 | moonlit-greenhouse, cosmic-noir, chromadelic-highway, serenity-warp, chiral-gold, starlight, crystal-cave |
| B4 | thermal-bloom, forest, lunara, cinder-drift, murmuration, fluid-dreams, astral-weave, nimbus-veil |
| B5 | wolfhour, painted-ages, winter, sakura-twilight, sunset, shifting-sands, fall, moonrise-summit, rainy-window, shared fox engine |
| B6 | high-coast, ocean, halcyon-apex, aether-tides, stellar-drift, nebula-flow, misty-lake, neon-dusk, moonlit-forest |
| B7 | verdant-hills, stillwater, himalayan-peak, chromatic-impasto, void-ember, stellar-velocity, kaleidosonic, black-hole |
| B8 | summer, koi-pond, bioluminescence, voltage-storm, supernova, luminous-tides, tornado, aurora |
| PIPE | theme manager, base theme, frame pacer, registry, prewarm, boot warp/handoff, async pipelines, GPU loss, shared WebGL1 overlay |
| ODY1 | Odyssey board controller, camera, chapter/level-node/path managers, warmup, post, transitions |
| ODY2 | Odyssey `world/` and `chapter-environments/` (a lead plus seven sub-reviewers, one per chapter group) |
| RITEM | R-09, R-17, R-22, R-28, R-29 and the REND items re-checked at `cde601f8`, with runtime procedures |

Batches were balanced by line count (about 47,000 lines each; 381,501 lines of theme code in
total). The coordinator re-read the code behind every finding ranked High or Critical.

**Step 2 — instrument verification (ADR-0016)** before any runtime number is used: see
[Instruments](#instruments-adr-0016).

**Step 3 — runtime pass (GPU safety enforced).** At most 3–5 themes per run, never a full
journey or the whole fleet in one go; stop on any GPU hang, reset or heavy throttling.

*(Sections below are filled in as each batch lands.)*

## Executive summary

### Verdict

**The themes are individually well built and collectively under-governed.** The static pass read
all 64 theme folders (381,501 lines), the theme pipeline and Odyssey rendering, and produced 391
findings with **no Critical** and **15 High** (12 in themes, 1 in the pipeline, 2 in Odyssey; one
theme High was regraded to Med after a runtime check). Twenty-five themes, the shipped boot path
and Odyssey were then measured on this machine (all **seen in Quiet mode**): no driver reset, no
thermal or power throttling, and **no accumulating leak in ordinary theme switching** for any theme
measured.

The October rebuilds show: almost every theme owns its renderer, runs through `safeAnimate` and
tears its runtime down in `stop()`. The black-hole timestamp lifecycle, the shared fox engine, and
stillwater, ocean and painted-ages are the models worth copying.

What is wrong is mostly **one layer up, and copied**:

1. **The lifecycle the manager promises and the one themes implement have drifted apart.**
   - A second suspend disposes a healthy paused theme (PIPE-01, **confirmed at runtime** on both
     paths): the 1.85 s boot warm is thrown away when the menu appears and rebuilt 4 s later, and an
     exit to the menu turns the next entry into a cold rebuild.
   - ~47 of 52 themes double-build on resume after a quality change made behind the menu
     (THM-33/93 family); a restarted *stopped* instance leaks its runtime on packaged Windows before
     startup completes (THM-228, PIPE-19).
   - The warm hooks `getWarmupRoots()` / `usesMrtScenePass()` have **no runtime consumer**
     (THM-137), so FX parked until a combo compile at the climax. **Measured:** the first gameplay
     burst stalls tornado for **271 ms**, wolfhour 91 ms, cosmic-noir 89 ms; the second burst is
     clean.
2. **Two classic holdouts break the render contract.** misty-lake and rainy-window render every
   vsync (**131/s against ~65.5/s** for capped themes), keep rendering under the breathing guide,
   and draw **~3× the GPU power** of the WebGPU themes (67–90 W against 23–36 W). rainy-window also
   runs its simulation per frame (THM-230). The Odyssey map is uncapped too (REND-08, measured), and
   after a menu return the menu's intro renderer keeps running under it (ODYR-27, new).
3. **The starter theme is the heaviest one measured.** forest, which every new player sees first,
   takes **6.05 s** to its first GPU-complete frame on a cold cache (127 synchronous pipelines) and
   costs ~2.6× the CPU per rendered frame of the other themes (7.2 ms p50); its CPU fireflies drive
   ~20 minor GCs per second in play. The CPU-simulation themes carry the fleet's GC pressure
   (verdant-hills and sakura-twilight 5–8× a clean theme, sky-children 16/s at idle), without a
   visible hitch on this machine; switch-in compiles range up to 263 synchronous pipelines (summer).
4. **Reduced motion reaches 46 of 63 themes.** 8 read only the OS query and 9 read nothing; there is
   no plumbing for the in-game toggle (PIPE-12, RIT-06). Measured on 25 themes: the toggle visibly
   calms neon-district (−72 %), geode (−63 %), himalayan-peak (−45 %) and sky-children (−31 %); it
   changes nothing measurable in 17 others, including every OS-only and "neither" theme measured
   (kaleidosonic −10 to −20 %; rainy-window and summer inconclusive; aurora not run).
5. **Copy-paste is the root of most of it.** The settings helpers and composition module exist in ~42
   copies, one gameplay director in 13 identical copies plus ~20 near-copies, a second director family
   in 6, the scene template in 6, the bloom high-pass in 52 files. Fixes land in one copy (stillwater's
   resume guard, thermal-bloom's `try/finally`, solar-eclipse's clock carry) and the rest keep the bug.

**Odyssey** is in better shape than its open-item list suggests: one shared device, O(1) draw calls in
level count, no synchronous pipeline after the reveal (measured), ADR-0016-compliant timing. The first
audit's mid-build exit bugs are still open (ODYR-01/02; an aborted build kept running after `Disposed`
and left +47 MB heap and +167 MB GPU-process memory behind), and the map ignores Target Frame Rate.

**None of the R-items left for this machine is fixed.** Measured here: R-09 (the first piece falls
unseen for ~1.95 s under the cover), R-17 (title interactive at 9.6 s while the KPI ends at 1.5 s),
R-28 (the board is shrunk 0.82× nearest-neighbour on this desktop), R-29 (board 60/s in uneven 2/3-vsync
gaps, theme 65.7/s, menu intro 98.6/s against a 60 cap, a new GPUDevice per menu return).

**Two instrument facts change how numbers are read here:** this machine's rAF runs at ~131.6 Hz,
not the 165 Hz it reports; and the theme perf lane's GPU sampler re-pushes stale timestamps when the
panel outpaces the theme (INS-01, confirmed at runtime), so its `gpuMs` is not used.

### If you only do five things

1. **C1:** fix suspend/resume idempotency (PIPE-01 first: one condition in `suspendThemes()`), then
   move the rebuild-pending guard into BaseTheme.
2. **P1:** have the manager warm every theme's declared warm roots, then declare them in tornado,
   cosmic-noir and wolfhour.
3. **C3:** put misty-lake and rainy-window behind `shouldRenderFrame()` with real `dt`, and give the
   Odyssey map the theme pacer.
4. **A2:** a BaseTheme `reducedMotion` that reads the in-game toggle, then the 17 themes that ignore it.
5. **P2 + forest:** cut forest's cold first frame and per-frame CPU (async pipelines on entry,
   compute or vertex-animated fireflies).

## Prioritized recommendations

Each recommendation merges findings from the tables below (IDs in brackets) and gives **Why**,
**How** and **Expected benefit**. Effort follows the umbrella plan: **S** ≤ 1 day · **M** days to
2 weeks · **L** weeks or more. Runtime evidence is quoted where it exists, always seen in Quiet
mode.

### 1 · Critical bugs and leaks

No finding met the Critical bar (crash, blank screen, or unbounded growth in normal play). These are
the highest-impact bugs and leaks, in order.

#### C1 · Make suspend, resume and restart idempotent in the manager and BaseTheme
*Lifecycle · M · [PIPE-01, PIPE-02, PIPE-03, PIPE-05, PIPE-19, THM-33 family (THM-47/50/55/67/93/183–186), THM-228, THM-182, THM-21; first-audit LIFE-08/09]*
- **Why:**
  - A second `suspendThemes()` disposes a healthy paused theme because `pause()` leaves `isActive`
    true (PIPE-01). Measured: the parked boot warm was disposed when the menu appeared and rebuilt
    from 15.5 to 17.1 s; after an exit the next entry logged `Loading a fresh theme identity` instead
    of a quick resume.
  - ~47 of 52 themes return `true` from `resume()` and then rebuild, so the manager's first-frame
    check watches a retired renderer and rebuilds a second time (THM-33, THM-93).
  - `runStartAttempt()` releases a previous runtime only if the instance is still active or paused,
    so restarting a stopped instance leaks it where `stop()` does not tear down (THM-228; live on
    packaged Windows before `startupComplete`).
  - The deferred `initial-theme-prewarm` keeps a discarded cancel handle and can rebuild the
    just-entered theme hidden (PIPE-02).
- **How:**
  1. In `suspendThemes()`, treat a pending instance with `isPaused === true` or
     `lifecycleState === 'paused'` as already suspended (PIPE-01).
  2. Move the rebuild-pending rule into BaseTheme: `resume()` returns `false` when a rebuild is
     pending (stillwater's version), and delete the per-theme copies.
  3. In `runStartAttempt()`, release any runtime that still exists (`this.renderer`, `this.scene`),
     whatever the flags say.
  4. Give the prewarm a cancellable handle and a promise that mode entry awaits or aborts; keep the
     deferred task's handle.
  5. Guard settings-driven rebuilds on `isActive && !isPaused` (THM-182, THM-21).
  6. Tests: double suspend keeps the instance; resume with a pending rebuild builds once; restart of
     a stopped instance disposes the old renderer.
- **Expected benefit:** the boot warm is used instead of rebuilt, re-entries after an exit are quick
  resumes instead of cold builds (forest's cold first frame measured 6.05 s), one build per quality
  change instead of two, and no leaked renderers or doubled handlers.

#### C2 · Close the Odyssey mid-build exits and per-entry residue
*Odyssey · S–M · [ODYR-01, ODYR-02, ODYR-05, ODYR-06, ODYR-18; first-audit ODY-02/03/04/05/18]*
- **Why:** a board disposed during `initialize()` keeps building (measured: its prewarm ran 42 ms
  after `Disposed`, and +47 MB heap / +167 MB GPU-process memory stayed resident); exit-during-build
  then re-entry can join a stale build promise (ODYR-02); `oneWorld.dispose()` is never called and
  module caches pin previous renderers' GPU copies (ODYR-05).
- **How:** check `_disposed` after every await in `initialize()` and abort the warm-up chain; clear
  `_boardBuildPromise` in `_disposeOdysseyBoard()` with a generation token; call `oneWorld.dispose()`;
  gate background chapter creation on an active board; key chapter creation by an in-flight map.
- **Expected benefit:** no empty-map re-entries and flat memory across Odyssey visits.

#### C3 · Enforce the render contract and frame-rate independence
*Contracts · S–M · [THM-180, THM-229, THM-230, PIPE-16, PIPE-17, THM-167, THM-26, THM-193, ODYR-03, ODYR-15, ODYR-16, ODYR-27, REND-08]*
- **Why:** misty-lake and rainy-window render every vsync, under the breathing guide and past the
  Target Frame Rate (measured 131/s and ~3× the GPU power); rainy-window advances a fixed 1/60 s per
  frame. murmuration's camera punches and several smoothers decay per frame. The Odyssey map is
  uncapped (measured 130/s) and the menu intro renderer can run under it (ODYR-27).
- **How:** route every theme loop through `safeAnimate`/`shouldRenderFrame` and make the two holdouts
  integrate real `dt`; replace per-frame `x += (t − x)·k` with `1 − exp(−rate·dt)`; give the Odyssey
  map the theme pacer and park the menu renderer on mode entry; add a `theme-lifecycle-audit` rule
  that rejects a raw `requestAnimationFrame` loop in `src/themes/**` (INS-04).
- **Expected benefit:** the same look at 60, 131 and 240 Hz, roughly a third of the GPU power in the
  two holdouts, and real savings on battery and under the breathing guide.

#### C4 · Treat a destroyed device as a destroy, and give every theme a loss path
*GPU loss · S · [PIPE-09, PIPE-10, PIPE-22, ODYR-17]*
- **Why:** `monitorWebGPU` reports every normal `destroy()` as a device loss (this audit's own harness
  fell into the same trap first); six themes have no loss handling and freeze or go black.
- **How:** filter `reason === 'destroyed'` as three does; give the six themes BaseTheme's resilience
  hook; fix the duplicate-monitor unsubscribe.
- **Expected benefit:** recoveries that happen when a loss is real, and never when it is not.

### 2 · Performance optimizations

#### P1 · Warm what play will draw, from the manager
*Compile stalls · M · [THM-137, THM-179, THM-244, THM-70, THM-118, THM-227, THM-100, PIPE-06, ODYR-07, ODYR-08, ODYR-09]*
- **Why:** FX parked at `visible = false` until a combo are skipped by every warm render and by
  `compileAsync`, and the declared roots are never read. Measured on the first gameplay burst:
  tornado 271 ms, wolfhour 91 ms, cosmic-noir 89 ms of frame stall; the second burst is clean.
- **How:** in the manager's masked warm window call `warmHiddenDrawables(theme.getWarmupRoots())` for
  every theme (black-hole's pattern) and honour `usesMrtScenePass()` in every bare sweep; declare the
  roots in tornado, cosmic-noir, wolfhour and himalayan-peak; in DEV, assert zero synchronous pipeline
  creations after the reveal (the harness pattern used here).
- **Expected benefit:** no first-combo hitches.

#### P2 · Cut the starter theme's cost and the hot-path allocation storms
*Frame time / GC · S–M · [THM-155–159 (forest), THM-25, THM-46, THM-72, THM-73, THM-95, THM-96, THM-181, THM-59, THM-178, THM-189, THM-163]*
- **Why:** forest's cold first frame is 6.05 s (127 synchronous pipelines) and its `render()` costs
  7.2 ms CPU p50, ~2.6× the other themes; its CPU fireflies drive ~20 minor GCs/s in play.
  sky-children runs ~16 minor GCs/s at idle from per-puff `subarray` views. three r186 issues one
  `writeBuffer` per update range (no merging), so per-particle ranges become hundreds of writes.
- **How:** create forest's pipelines through the async path on entry (ADR-0020) and move its fireflies
  to compute or closed-form vertex animation; create typed-array views once; sort indices without
  `subarray`; one merged update range (min…max) per attribute per frame; pool ripple materials;
  re-pack only the struck crystal (THM-46, regraded Med after runtime).
- **Expected benefit:** a faster first impression on the default theme and fewer GC pauses in play.

#### P3 · Stop settings churn and fix render-scale ownership
*Settings · S · [THM-75, THM-03, THM-30, PIPE-08, THM-188, RIT-01, RIT-02, RIT-05]*
- **Why:** every settings save is read as a render-scale change and resizes the active theme (~42
  themes); four writers fight over the global scale; dynamic resolution reads any target above the
  refresh as overload (and this machine's refresh is detected as 132 Hz, not 165).
- **How:** read `dirtyKeys` from `SETTINGS_CHANGED`; subscribe once (bus *or* window); one render-scale
  owner that broadcasts; clamp the target to the measured refresh.
- **Expected benefit:** no hitches while dragging sliders, and no silent quality ratchet.

#### P4 · Cut idle cost (with R-29's frame driver)
*Idle · M · [PIPE-07 / REND-05, REND-02, REND-07, ODYR-03, ODYR-26, ODYR-27, PIPE-21]*
- **Why:** measured: the empty WebGL1 overlay is presented 60/s on a theme that never uses it, Phaser
  presents 46.6/s on the menu with no board, the menu intro renders 98.6/s against a 60 cap and keeps
  rendering under Odyssey after a menu return, and the Odyssey map renders every vsync.
- **How:** R-29's single frame driver; create the overlay lazily; sleep Phaser on the menu and while
  paused; cap and park the menu renderer on mode entry instead of rebuilding it per return.
- **Expected benefit:** lower GPU power on the menu and in Odyssey; matters most on laptops and iGPUs.

### 3 · Architectural and code improvements

#### A1 · One theme adapter base and shared modules
*Structure · L (incremental) · [THM-32, THM-113, THM-162, THM-09, THM-74, THM-114, THM-136, THM-138, THM-115, THM-24, PIPE-14]*
- **Why:** the same settings helpers (~42 copies), composition module (~42), gameplay director (13
  identical + ~20 near), second director family (6), scene template (6) and post kit (52 files) are
  copied per theme; fixes land in one copy only (the resume guard in 5 of 52; the director
  `try/finally` in one family of two).
- **How:** extract `shared/theme-settings.js`, `shared/composition.js`, `shared/gameplay-director.js`
  (with thermal-bloom's `try/finally`), `shared/calm-post.js`, and a `ThemeAdapterBase` that owns
  renderer creation with WebGL2 fallback, GPU resilience, layout scheduling, pointer, resize,
  pause/resume and the solar-eclipse `carry` of clock and level; migrate the newest themes first.
- **Expected benefit:** a fix once instead of 40 times, and smaller theme chunks.

#### A2 · Reduced-motion plumbing
*Accessibility · S–M · [PIPE-12, RIT-06; THM-54, THM-61, THM-77, THM-78, THM-94, THM-122, THM-129, THM-147, THM-155, THM-175, THM-190, THM-191, THM-232, THM-236 and the other OS-only themes]*
- **Why:** 9 themes read nothing and 8 read only the OS query, so the in-game toggle shipped in
  `1433075` does nothing in 17 themes, the boot warp, the menu and the loading overlay. Measured: no
  motion change in forest, cosmic-noir, misty-lake and wolfhour; the toggle works in geode (−63 %)
  and sky-children (−31 %).
- **How:** a BaseTheme `reducedMotion` getter (in-game setting OR OS query) with a change hook; fix the
  17 themes, then the opening and menu surfaces; keep the motion-energy check as a regression probe.
- **Expected benefit:** the setting works everywhere it is offered.

#### A3 · Retire dead code and the classic holdouts
*Hygiene · M · [THM-40, PIPE-24, THM-126, THM-245, THM-219, PIPE-23, THM-31]*
- **How:** delete `sky-children-v2` and `shared/sky-core` (a never-imported lazy chunk), cosmic-noir's
  GLSL path, wolfhour's legacy branch and the manager's dead machinery; port misty-lake, rainy-window
  and moonrise-summit to WebGPURenderer + TSL (house rule) — they are also the power outliers.

#### A4 · Instruments and guards
*Tooling · S · [INS-01..05]*
- **How:** fix the perf lane's GPU sampler (resolve only after a render); extend `theme-lifecycle-audit`
  with rules for raw rAF loops, unremoved bus/`matchMedia` subscriptions and unread warm roots; run
  lifecycle validation on the GPU; adopt this audit's harness checks (listener/bus/device census
  across switch cycles, first-burst pipeline count) as a theme gate.
- **Expected benefit:** the classes of defect this audit found by hand get caught by CI.

## Finding tables

Columns: **Sev** severity (Critical / High / Med / Low) · **Cat** Bug / Perf / Improvement ·
**Evidence** VERIFIED / PLAUSIBLE · **Proof** `file:line` at `cde601f8` or a runtime measurement.

| Prefix | Area |
|---|---|
| THM | individual themes and `src/themes/shared/` |
| PIPE | theme pipeline |
| ODYR | Odyssey rendering (`ODYR`, so it cannot be confused with the 2026-10-13 audit's `ODY-nn` gameplay IDs, several of which this audit re-checks) |
| RIT | new findings in the R-item code paths |
| INS | the measuring instruments themselves (ADR-0016) |

THM IDs are assigned in the order the batches landed. A row naming several themes is a shared
pattern; the extraction it suggests is collected under
[Architectural and code improvements](#3--architectural-and-code-improvements).

### Themes (THM)

#### Batch B2 — rainbark, pyrestorm, vesper-chrysalis, ice-temple, galaxy, solar-eclipse, parhelion

No Critical or High finding. All seven own their WebGPURenderer, run through `safeAnimate`, and
dispose world, post stack and renderer inside `stop()`; every bus, mode-manager, DOM and
`matchMedia` listener is removed on stop. All seven read **both** `window.settings.reducedMotion`
and the OS query, and react live. The coordinator re-read THM-05 and THM-21.

| ID | Theme | Finding | Sev | Cat | Evidence | Proof |
|---|---|---|---|---|---|---|
| THM-01 | rainbark | ~8 small objects allocated per frame: `aspectWeights` default `out` (≈6 calls via `pose`/`restLens`), `windScaleAt` closure, `post.update({ time })` | Low | Perf | VERIFIED | `src/themes/rainbark/rainbark-core.js:1053` `export function aspectWeights(aspect, out = { k: 0, w: 0 })`; `rainbark-world.js:742,753,1228,1487`; `rainbark-theme.js:645` |
| THM-02 | rainbark | Module-level bake caches keep the CPU bakes (~3–5 MB: 512² RGBA atlas, 512² RGBA crowns + mips, 256² fbm/lattice, lace/gap pyramids) for the app lifetime, also after eviction (intentional reuse) | Low | Improvement | VERIFIED (size PLAUSIBLE) | `src/themes/rainbark/rainbark-world.js:154-155` `const BAKES = new Map(); let CANOPY = null;`, `:182` |
| THM-03 | all seven of B2 | Settings handler subscribed twice (bus `SETTINGS_CHANGED` + window `settingsChanged`), so `applyReactionSettings` runs twice per change (the rebuild is deduped; otherwise harmless) | Low | Improvement | VERIFIED | `src/themes/rainbark/rainbark-theme.js:376` `eventBus.on(EVENTS.SETTINGS_CHANGED, …)` + `:382` `this.registerEventListener(window, 'settingsChanged', …)`; same in `parhelion-theme.js:381,384` and the other five |
| THM-04 | rainbark | No-op ternary left in the T-spin path | Low | Improvement | VERIFIED | `src/themes/rainbark/rainbark-world.js:954` `const at = t + (this.reducedMotion ? 0 : 0);` |
| THM-05 | pyrestorm | `sharedBakes` keeps the two 1024² lava fields (2 × RGBA8 = 16 MB) plus noise/lattice/billows (~1.5 MB) on the JS heap for the app lifetime after the first visit, also after eviction | Med | Improvement | VERIFIED | `src/themes/pyrestorm/pyrestorm-world.js:76-80` `let sharedBakes = null; … lava: bakeLavaFields(),`; `pyrestorm-bake.js:23,26` `size: 1024`; `:368-369` |
| THM-06 | pyrestorm | The lava-field bake runs before the generator's first `yield`, so on the first start it is one unsliced synchronous block (2 × 1024² rasterise + 6 box-blur passes, ~9 × 4 MB transient Float32Arrays per field); only the land is sliced | Med | Perf | VERIFIED (duration PLAUSIBLE: longest task on a cold first start) | `src/themes/pyrestorm/pyrestorm-world.js:89-93` `const bakes = bakesOnce(); yield 'bakes';`; `pyrestorm-bake.js:293-383` |
| THM-07 | pyrestorm | Event smoke places, insertion-sorts and re-uploads 4 instanced attributes every frame even when no puff is alive (puffs exist only after a T-spin / four-line surge) | Low | Perf | VERIFIED | `src/themes/pyrestorm/pyrestorm-smoke.js:303-306` `this.attr.puff.needsUpdate = true; …` (each frame from `pyrestorm-world.js:878`) |
| THM-08 | pyrestorm | `updateLights` allocates an object per live bolt (≤ 8) + storm-glow + crater objects, a closure and a sort comparator every frame (3 objects at rest, ≤ 12 in storms) | Low | Perf | VERIFIED | `src/themes/pyrestorm/pyrestorm-world.js:895` `list.push({`, `:911`, `:938` `list.sort(…)` |
| THM-09 | rainbark, pyrestorm, ice-temple, galaxy, solar-eclipse | Reaction directors are verbatim copies: rainbark ≡ pyrestorm (817 lines each; names and `MAX_B2B` differ); ice-temple ≡ galaxy ≡ solar-eclipse (445 lines each, 2-line name diff); vesper is a 468-line variant | Low | Improvement | VERIFIED | `src/themes/pyrestorm/pyrestorm-director.js:77` `const MAX_B2B = 4;` vs `rainbark-director.js:77` `const MAX_B2B = 3;`; `ice-temple-director.js` vs `galaxy-director.js` / `solar-eclipse-director.js` |
| THM-10 | vesper-chrysalis | An in-place rebuild (tier change on screen, WebGPU loss) resets the world clock; the hour is `level − 1 + time/120`, so the palette snaps back by time/120 hours (5 h after 10 min) | Low | Bug | VERIFIED | `src/themes/vesper-chrysalis/vesper-chrysalis-theme.js:269` `this.time = this.flags.time ?? 0;`; `vesper-chrysalis-core.js:590` |
| THM-11 | rainbark, pyrestorm, ice-temple, galaxy, solar-eclipse, parhelion | `pointerleave` registered on `window`, where (per vesper's own note) it is never dispatched: parallax does not recentre when the pointer leaves the page (blur still resets) | Low | Bug | PLAUSIBLE (move the pointer out of the window and read `pointer.x/y`) | `src/themes/vesper-chrysalis/vesper-chrysalis-theme.js:392-393`; `rainbark-theme.js:402`; `pyrestorm-theme.js:411`; `ice-temple-theme.js:368`; `galaxy-theme.js:375`; `solar-eclipse-theme.js:389`; `parhelion-theme.js:406` |
| THM-12 | vesper-chrysalis | 2 small allocations per frame (`PALETTE_KEYS.forEach` closure, `post.update({ time })`) | Low | Perf | VERIFIED | `src/themes/vesper-chrysalis/vesper-chrysalis-world.js:901`; `vesper-chrysalis-theme.js:640` |
| THM-13 | ice-temple | `applyPalette` runs every frame and rebuilds the level's linear palette from constants (1 object + 4 arrays + 12 sRGB→linear `pow`s) | Low | Perf | VERIFIED | `src/themes/ice-temple/ice-temple-world.js:561` `const target = paletteRGB(AURORA_PALETTES[this.paletteIndex]);` from `:604`; `:96-98` |
| THM-14 | ice-temple | In-place rebuild resets the clock and keeps no level, so the aurora palette snaps to level 1 mid-run | Low | Bug | VERIFIED | `src/themes/ice-temple/ice-temple-theme.js:246` `this.time = this.flags.time ?? 0;`; `:236` |
| THM-15 | ice-temple | Aurora palette steps only on level-up; it never drifts with the clock (the newer themes' house rule) | Low | Improvement | VERIFIED | `src/themes/ice-temple/ice-temple-world.js:551` `this.paletteIndex = (this.level - 1) % AURORA_PALETTES.length;` |
| THM-16 | galaxy | In-place rebuild resets the clock and keeps no level, so the palette snaps to level 1 mid-run | Low | Bug | VERIFIED | `src/themes/galaxy/galaxy-theme.js:254` `this.time = this.flags.time ?? 0;`; `:244` |
| THM-17 | galaxy | Palette steps only on level-up; no clock drift | Low | Improvement | VERIFIED | `src/themes/galaxy/galaxy-world.js:789` |
| THM-18 | galaxy | 2 small allocations per frame (`warm` closure, `post.update({ time })`) | Low | Perf | VERIFIED | `src/themes/galaxy/galaxy-world.js:913`; `galaxy-theme.js:597` |
| THM-19 | solar-eclipse | A new run sets `level = 1`, so `hourShift` eases back and the light turns **backwards** (level − 1) steps over ~8 s at every game over; intentional per the comment, but it contradicts the house convention "a new run starts at level 1 without moving the light" | Low | Improvement | VERIFIED | `src/themes/solar-eclipse/solar-eclipse-world.js:303` `this.level = 1;` + `:830`; convention at `pyrestorm-hours.js:12-13` |
| THM-20 | all (three r186) | WGSL modules are emitted with derivative uniformity off, so implicit-LOD samples inside per-pixel `If`s compile silently; artefacts at branch edges are possible, validation errors are not | Low | Improvement | VERIFIED | `node_modules/three/src/renderers/webgpu/nodes/WGSLNodeBuilder.js:283` `diagnostics += 'diagnostic( off, derivative_uniformity );\n';` |
| THM-21 | parhelion | `createScene` starts the loop without the `isPaused` guard the other six use; a tier/AA rebuild or GPU recovery that completes after a `pause()` during the renderer-init await starts `safeAnimate`, which only checks `isActive`, so it renders behind the menu until resume | Med | Bug | PLAUSIBLE (code VERIFIED by the coordinator; race needs a run: change quality, open the menu within ~200 ms, count frames) | `src/themes/parhelion/parhelion-theme.js:256` `this.animate();` vs `src/themes/rainbark/rainbark-theme.js:287` `if (!this.isPaused) this.animate();`; `base-theme.js:1356-1361` |
| THM-22 | parhelion | In-place rebuild resets the clock, the Lower Sun level and resonance | Low | Bug | VERIFIED | `src/themes/parhelion/parhelion-theme.js:685` `this.elapsedTime = 0;` |
| THM-23 | parhelion | Bloom mip count set through BloomNode's private field (breaks silently on a three upgrade) | Low | Improvement | VERIFIED | `src/playground/effects/parhelion-post.js:93` `this.bloomNode._nMips = tier.bloomMips;` |
| THM-24 | rainbark, pyrestorm, vesper-chrysalis, ice-temple, galaxy, solar-eclipse (+ parhelion partly) | The theme adapter is copy-pasted per theme: `readFlags`/`readSettingUpdate`/`readSetting`/`boolSetting`, the WebGPU→WebGL2 `createRenderer` with timeout, `setupGpuResilience`, `PIXEL_RATIO_CAP`, the layout re-read schedule, calm-zone easing, pass-through post, and in post the calm-rect SDF + hue-preserving bloom high-pass + grain/dither encode. Candidate: a shared `ThemeAdapterBase` + `createCalmPost()`; solar-eclipse's `carry` pattern would fix THM-10/14/16/22 in one place | Low | Improvement | VERIFIED | `src/themes/rainbark/rainbark-theme.js:82-140` ≡ `pyrestorm-theme.js:58-116` ≡ `vesper-chrysalis-theme.js:79-137` ≡ `ice-temple-theme.js:66-124` ≡ `galaxy-theme.js:74-132` ≡ `solar-eclipse-theme.js:73-131`; bloom high-pass `rainbark-post.js:154-169` ≡ `pyrestorm-post.js:134-148` ≡ `vesper-chrysalis-post.js:155-170` ≡ `ice-temple-post.js:159-174` |

#### Batch B1 — sky-children, neon-district, sky-children-v2, geode, waves, golden-forest, synthwave-sunset, blood-moon

2 High, 13 Med, 30 Low, no Critical. The coordinator re-read THM-25, THM-33 (with
`theme-manager.js:2062-2101`), THM-46 and THM-59 (with three's `WebGPUAttributeUtils.js:236-265`).

- **`sky-children-v2` is unreachable in the game.** The registry only aliases its id to
  `sky-children`, but the `import.meta.glob('./**/*-theme.js')` loader still emits a ~96 kB
  chunk for it (THM-40). Its latent rows (THM-41 to THM-45) are graded Low; they would be three
  High and two Med if it were ever registered again.
- **One root cause in five themes (THM-33, 47, 50, 55, 67):** a quick resume with a quality
  rebuild pending returns `true` from `resume()` and then rebuilds, retiring the renderer whose
  `render` the manager's 700 ms first-frame check has patched, so the manager rebuilds a second
  time. `sky-children-theme.js:792-800` is the reference fix (return `false` and carry the run).
- **Reduced motion:** sky-children, neon-district, geode, waves and blood-moon read both the
  in-game setting and the OS query; golden-forest reads only the OS query (THM-54);
  synthwave-sunset and sky-children-v2 read neither (THM-61, THM-45).

| ID | Theme | Finding | Sev | Cat | Evidence | Proof |
|---|---|---|---|---|---|---|
| THM-25 | sky-children | Spray far-to-near sort allocates one TypedArray `subarray` view per puff per frame (up to `tier.spray`: 1100 High, 1900 Extreme) plus a comparator sort every frame | High | Perf | VERIFIED | `src/themes/sky-children/sky-children-fx.js:348-350` `order.subarray(0, count).sort(byDepth); for (let k = 0; k < count; k++) sorted.set(data.subarray(order[k] * 12, order[k] * 12 + 12), k * 12);` |
| THM-26 | sky-children | Glider trails append one sample per RENDERED frame, so trail length in time depends on frame rate / Target Frame Rate (16 samples = 0.27 s at 60 fps, 0.53 s at 30, 0.11 s at 144) and still advances with a frozen capture clock | Med | Bug | VERIFIED | `src/themes/sky-children/sky-children-world.js:2317-2322` `tr.pts[tr.head * 3] = pz.pos[0]; ... tr.head = (tr.head + 1) % m; tr.n = Math.min(m, tr.n + 1);` |
| THM-27 | sky-children | All spray puffs (up to 1100-1900) recomputed in closed form on the CPU each frame (4 sin-hashes, fall evaluation, trig per puff) — GPU/vertex candidate | Low | Perf | PLAUSIBLE (measure JS ms/frame) | `src/themes/sky-children/sky-children-world.js:2094-2107` `for (const e of SPRAY_EMITTERS) { ... for (let k = 0; k < n; k++, id++) { const h0 = hash(id + 0.13);` |
| THM-28 | sky-children | Glow / spray / glider instance buffers re-uploaded at full capacity every frame (no `addUpdateRange` for the live count) | Low | Perf | VERIFIED | `src/themes/sky-children/sky-children-fx.js:133-136` `end() { mesh.count = count; buffer.needsUpdate = true; }` (also :353-355, sky-children-gliders.js:135) |
| THM-29 | sky-children | ~30-40 small closures/arrays per frame (writeLamps array + sort + 12 `find` closures, writeStrokes closures, `push.bind`, `post.update({ time })`) | Low | Perf | VERIFIED | `src/themes/sky-children/sky-children-world.js:2221-2236` `const live = []; this.held.forEach((h, slot) => {...}); ... this.poolSlots.find((p) => p.slot === slot)`; `:2252` `const push = g.push.bind(g);` |
| THM-30 | sky-children | Every settings change handled twice (window `settingsChanged` + bus SETTINGS_CHANGED both fire, settings.js:412/455); renderScale path resizes twice. Same pattern in neon-district, geode, waves, golden-forest, blood-moon | Low | Improvement | VERIFIED | `src/themes/sky-children/sky-children-theme.js:472` `eventBus.on(EVENTS.SETTINGS_CHANGED, (p) => this.handleSettingsChanged(p))` + `:478` `this.registerEventListener(window, 'settingsChanged', (p) => this.handleSettingsChanged(p));` |
| THM-31 | sky-children | `sky-children-ledger.js` (514 lines) is dead at runtime — only its unit test imports it | Low | Improvement | VERIFIED | `tests/unit/sky-children-ledger.test.js:9` (sole importer; grep) |
| THM-32 | sky-children | `readSettingUpdate`/`readSetting`/`boolSetting` copied verbatim into 42 theme classes -> `src/themes/shared/theme-settings.js` | Low | Improvement | VERIFIED | `src/themes/sky-children/sky-children-theme.js:133-163` `function readSettingUpdate(payload, key) {` (grep: 42 files under src/themes) |
| THM-33 | neon-district | Quick resume with a quality rebuild pending: `resume()` returns true then queues `createScene()`, which disposes the renderer the manager's `_ensureThemeRendering` just patched -> no frame seen in 700 ms -> manager rebuilds a second time. sky-children fixed this by returning false | Med | Bug | PLAUSIBLE (main menu -> change Effect Quality -> resume; count "Scene ready" + "produced no frames") | `src/themes/neon-district/neon-district-theme.js:653-656` `if (this.rebuildPending) { this.rebuildPending = false; this.queueRebuild(); }` vs `src/themes/theme-manager.js:2094-2097` `if (!rendered && this.activeTheme === themeInstance ...) await this.activateThemeInstance(...)` |
| THM-34 | neon-district | Drone dragon (5200 High / 8400 Ultra / 12000 Extreme instances, heavy vertex shader with 3 path evaluations) and spark pool are vertex-processed every frame while idle, and again in the reflector pass; `instanceCount = 0` while idle would keep the pipeline warm (r186 builds the pipeline before the null draw check) | Med | Perf | PLAUSIBLE (GPU ms idle vs instanceCount 0) | `src/themes/neon-district/neon-district-fx.js:541` `clip.xy.add(positionGeometry.xy.mul(sizePx.mul(step(0.002, live)))...` + `:581` `finish('NeonDistrictDragon', geometry, material, 32, true)` |
| THM-35 | neon-district | Reduced motion only stops camera sway and street scroll; it leaves the ~13.7 Hz storm-light flicker (`|sin(43t)|`) on 3/4-line clears and level-ups, the 31 s ambient ~11.8 Hz sheet lightning, the 0.2 s blackout and 19-20 Hz glitch steps; no flash governor | Med | Bug | VERIFIED (code path); luminance impact PLAUSIBLE | `src/themes/neon-district/neon-district-world.js:673-674` `Math.abs(Math.sin(beat * 37))` / `this.storm * (0.55 + 0.45 * Math.abs(Math.sin(t * 43)))`; reduced gate only at `:408` `const calm = this.reducedMotion ? 0 : 1;` and `:664` |
| THM-36 | neon-district | `applyPalette()` runs every frame and `linRGB()` returns two new arrays each time; `fades` array literal per frame | Low | Perf | VERIFIED | `src/themes/neon-district/neon-district-world.js:624-625` `const a = linRGB(target.a); const b = linRGB(target.b);` (called at :662); `:698` `const fades = [this.atlases.shopFade, this.atlases.adsFade];` |
| THM-37 | neon-district | Spark `emit()` allocates a 4-element array literal per spark (x3 attributes) and flags whole attributes for upload per call (~10-18 calls per clear) | Low | Perf | VERIFIED | `src/themes/neon-district/neon-district-fx.js:177-184` `aBirth.set([x, y, z - scroll, time + rand() * stagger], i * 4);` |
| THM-38 | neon-district | Palette steps only on level-up and never drifts with the clock (owner rule: level steps must also drift with the clock) | Low | Improvement | VERIFIED | `src/themes/neon-district/neon-district-world.js:610-612` `this.paletteIndex = (this.level - 1) % DISTRICT_PALETTES.length;` |
| THM-39 | neon-district | Theme shell is a near-verbatim copy of the sky-children/geode/waves shell (older revision) -> shared rebuilt-theme base class | Low | Improvement | VERIFIED | `src/themes/neon-district/neon-district-theme.js:661-709` `disposeRuntime() {` (identical blocks in geode-theme.js:657-705, waves-theme.js:688-736) |
| THM-40 | sky-children-v2 | Unreachable in the game (registry publishes only `sky-children`; retired alias) yet the theme glob still emits a ~96 kB `theme-sky-children-v2` chunk; only the dev playground effect and two tests import its modules | Low | Improvement | VERIFIED | `src/themes/theme-manager.js:162-170` `import.meta.glob('./**/*-theme.js'); THEME_REGISTRY.forEach(({ id, module }) => { const importer = moduleImports[module];` + `src/themes/theme-registry.js:546` `['sky-children-v2', 'sky-children'],` |
| THM-41 | sky-children-v2 | [latent; High if re-registered] Raw rAF loop never calls `shouldRenderFrame()` -> renders while paused/covered/reduced and ignores Target Frame Rate | Low | Bug | VERIFIED | `src/themes/sky-children-v2/sky-children-v2-theme.js:2168-2169` `const loop = (now) => { if (!this.isActive) return;` ... `:2227` `this.animationFrameId = requestAnimationFrame(loop);` |
| THM-42 | sky-children-v2 | [latent; High if re-registered] `SkyPipeline.dispose()` never disposes its scene pass or RenderPipeline; adaptive quality toggles post off/on and every settings change rebuilds it -> a full-screen RT leaked per toggle | Low | Bug | VERIFIED | `src/themes/sky-children-v2/post/sky-pipeline.js:247-251` `dispose() { disposeBloomNodeDeep(this.bloomNode); this.postProcessing = null; this.bloomNode = null; }` (pass created at :70) |
| THM-43 | sky-children-v2 | [latent; High if re-registered] ANY settings change (both bus + window) starts a full async terrain/mountain/cloud/vegetation/post rebuild -> pipeline creation mid-play, two overlapping rebuilds | Low | Perf | VERIFIED | `src/themes/sky-children-v2/sky-children-v2-theme.js:1919-1922` `handleSettingsChanged() { ... this.setQualityTier(requestedTier, { rebuild: true }); }` |
| THM-44 | sky-children-v2 | [latent; Med if re-registered] Per-frame constant-factor easing without dt (energies, wind, camera event offset/FOV) | Low | Bug | VERIFIED | `src/themes/sky-children-v2/sky-children-v2-theme.js:2182` `this.runtime.eventEnergy += (this.runtime.eventEnergyTarget - this.runtime.eventEnergy) * 0.12;`; `composition/camera-director.js:113` `this._eventOffsetTarget.multiplyScalar(0.92);` |
| THM-45 | sky-children-v2 | [latent; Med if re-registered] No reduced-motion support at all | Low | Bug | VERIFIED | grep: no `reducedMotion` / `prefers-reduced-motion` under `src/themes/sky-children-v2/` |
| THM-46 | geode | `touch()` re-packs ALL crystals (5 `subarray` views each; n = heroes + 8 crown rings, up to ~476 High / ~680 Extreme) on every `strike()`; a lock strikes 1 + up to 7 chime voices, a hard drop 3 sparks -> ~19k-82k short-lived views per lock event | Med (was High) | Perf | VERIFIED; runtime batch 2 (Quiet mode): two scripted bursts with 4 locks, a Tetris and a cascade each gave no frame gap ≥ 50 ms and 47 / 46 minor GCs, close to a clean theme (aurora 37–41), so regraded | `src/themes/geode/geode-crystals.js:225-235` `const touch = () => { for (let i = 0; i < n; i++) { ... liveData.set(aStore.subarray(i * 4, i * 4 + 4), o);` + `:651` `touch();` (per strike); `src/themes/geode/geode-world.js:463-472` chime loop |
| THM-47 | geode | Quick resume + pending quality rebuild races the manager's render-verify (double rebuild), as THM-33 | Med | Bug | PLAUSIBLE | `src/themes/geode/geode-theme.js:649-652` `if (this.rebuildPending) { this.rebuildPending = false; this.queueRebuild(); }` |
| THM-48 | geode | 10 template-literal key strings built per frame for the palette uniforms | Low | Perf | VERIFIED | `src/themes/geode/geode-world.js:810` `const c = p[\`band${i}\`];` / `:814` `const c = p[\`m${i}\`];` |
| THM-49 | geode | Shard/wisp emit allocate array literals per particle and flag whole attributes per call | Low | Perf | VERIFIED | `src/themes/geode/geode-fx.js:368` `aBirth.set([x, y, z, time + rand() * stagger], i * 4);` |
| THM-50 | waves | Quick resume + pending quality rebuild races the manager's render-verify (double rebuild), as THM-33 | Med | Bug | PLAUSIBLE | `src/themes/waves/waves-theme.js:680-683` `if (this.rebuildPending) { this.rebuildPending = false; this.queueRebuild(); }` |
| THM-51 | waves | `getPostState()` allocates a new object and a new `shaftTint` array every frame | Low | Perf | VERIFIED | `src/themes/waves/waves-world.js:780-788` `return { flash: s.flash, ... shaftTint: [shaft[0], shaft[1], shaft[2]],` |
| THM-52 | waves | Dolphin pod buffer flagged for upload every frame even with nothing airborne | Low | Perf | VERIFIED | `src/themes/waves/waves-life.js:348` `this.buffer.needsUpdate = true;` (unconditional at end of update) |
| THM-53 | waves | Spray pool flags a full-buffer upload per drop (up to 3600 x 12 floats) with no update ranges | Low | Perf | VERIFIED | `src/themes/waves/waves-spray.js:235` `this.buffer.needsUpdate = true;` (in `put()`) |
| THM-54 | golden-forest | Reduced motion reads only the OS media query; `settings.reducedMotion` is ignored, and the only effect is pointer parallax (fireflies, flock, vortex, ribbons, wind unchanged) | Med | Bug | VERIFIED | `src/themes/golden-forest/golden-forest-theme.js:351-353` `const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)'); const updateMotion = () => { this.reducedMotion = motionQuery?.matches === true;` |
| THM-55 | golden-forest | Quick resume + pending quality rebuild: `resume()` true then `queueRebuild()` -> `this.start()` disposes the patched renderer (double rebuild), as THM-33 | Med | Bug | PLAUSIBLE | `src/themes/golden-forest/golden-forest-theme.js:560-562` `if (this.rebuildPending) { this.rebuildPending = false; this.queueRebuild(); }` + `:454` `this.start(this.webglRenderer, {` |
| THM-56 | golden-forest | CPU firefly simulation (2200 High / 3400 Extreme) integrated + written + three full instance buffers re-uploaded every frame — compute candidate | Low | Perf | PLAUSIBLE (measure JS ms/frame) | `src/themes/golden-forest/golden-forest-sparks.js:102-105` `update(dt, env) { this.sim.step(dt, env); this.markDirty(); }` (sim loops spark-sim.js:186-237, 246-290) |
| THM-57 | golden-forest | Board rect polled every 0.75 s with forced layout + style (querySelectorAll, getBoundingClientRect, getComputedStyle) instead of trigger-scheduled reads | Low | Perf | VERIFIED | `src/themes/golden-forest/golden-forest-theme.js:487-490` `if (this.boardPoll <= 0) { this.boardPoll = BOARD_POLL_S; this.world?.setBoard?.(readGoldenForestBoardRect());` |
| THM-58 | golden-forest | Frame object built twice per frame (update() result discarded, getFrame() again) plus two object spreads per frame | Low | Perf | VERIFIED | `src/themes/golden-forest/golden-forest-theme.js:484-485` `this.reactions?.update(dt); const frame = this.reactions?.getFrame();` + `:494` `this.post?.update?.({ ...frame, time: this.time });` |
| THM-59 | synthwave-sunset | Each spark adds one update range on each of 4 attributes; r186 does NOT merge ranges (one writeBuffer/bufferSubData per range), so a Tetris (embers + solar burst, ~350 sparks) issues ~1400 tiny buffer writes and ~2800 small objects in one frame; the code comment claims ranges merge | Med | Perf | VERIFIED (mechanism) / PLAUSIBLE (cost) | `src/themes/synthwave-sunset/synthwave-sunset-fx.js:53-57` `/** ... ranges merge per frame in three). */ function touch(attr, index) { attr.addUpdateRange(index * attr.itemSize, attr.itemSize);` vs `node_modules/three/src/renderers/webgpu/utils/WebGPUAttributeUtils.js:241-262` per-range `device.queue.writeBuffer(` |
| THM-60 | synthwave-sunset | No settings listener at all: an Effect Quality change is ignored until the next theme start; `pieceLockRipple` never read | Med | Bug | VERIFIED | `src/themes/synthwave-sunset/synthwave-sunset-theme.js:343-376` (setupEventListeners subscribes PIECE_LOCK/LINE_CLEAR/COMBO/LEVEL_UP only; grep: no SETTINGS_CHANGED/settingsChanged in folder) |
| THM-61 | synthwave-sunset | No reduced-motion support: camera drift, pointer parallax, solar bursts, shooting stars and 30 Hz cell twinkle all unchanged | Med | Bug | VERIFIED | `src/themes/synthwave-sunset/synthwave-sunset-world.js:344-346` `const driftX = Math.sin(t * 0.031) * 1.0 + ...; const px = (sim.pointerX ?? 0) * 1.5;`; `synthwave-sunset-fx.js:89` `sin(u.time.mul(30.0)...` (grep: no reducedMotion) |
| THM-62 | synthwave-sunset | Bloom prefilter clamps per channel (owner rule: clamp on the max channel), shifting a hot sun's hue in the bloom | Low | Bug | PLAUSIBLE (only where a channel > 8) | `src/themes/synthwave-sunset/synthwave-sunset-post.js:136` `const tap = (dx, dy) => clamp(input.sample(...).rgb, 0.0, 8.0);` |
| THM-63 | synthwave-sunset | DRS step calls full `resize()` (render targets re-allocate per 0.05 step); `resize()` allocates a Vector2 and runs on both window resize and the manager funnel | Low | Perf | VERIFIED | `src/themes/synthwave-sunset/synthwave-sunset-theme.js:483` `this.resize(window.innerWidth, window.innerHeight);` + `:504` `this.renderer.getDrawingBufferSize(new THREE.Vector2());` |
| THM-64 | synthwave-sunset | Three closures per frame in world.update | Low | Perf | VERIFIED | `src/themes/synthwave-sunset/synthwave-sunset-world.js:378` `const k = (rate) => Math.exp(-rate * dt);` + `:391` `this.rings.forEach((ring, i) => {` |
| THM-65 | synthwave-sunset | Palette never drifts with level or clock (owner rule) | Low | Improvement | VERIFIED | `src/themes/synthwave-sunset/synthwave-sunset-world.js:381` `this.comboShift *= k(0.9);` (only palette input) |
| THM-66 | blood-moon | Module-level lunar atlas cache (Uint8Array albedo + normals per size) and the decoded 2k moon image are never released; ~16.8 MB at 2048 (Ultra/Extreme), ~22 MB if three sizes visited; no `disposeSharedResources` | Med | Bug | VERIFIED | `src/playground/effects/blood-moon-surface.js:10-11` `const authoredSurfaceCache = new Map(); let authoredImageReady;` + `:344-347` `authoredSurfaceCache.set(width, authoredImageReady.then((image) => bakeAuthoredSurface(image, width))` |
| THM-67 | blood-moon | Quick resume + pending rebuild races the manager's render-verify (double rebuild), as THM-33 | Med | Bug | PLAUSIBLE | `src/themes/blood-moon/blood-moon-theme.js:397` `if (this.rebuildPending) { this.rebuildPending = false; this.queueRebuild(); }` |
| THM-68 | blood-moon | Main-thread lunar atlas bake (two full 2048x1024 loops + getImageData) on the first start per size | Low | Perf | PLAUSIBLE (measure long task) | `src/playground/effects/blood-moon-surface.js:300-308` `for (let y = 0; y < height; y++) { for (let x = 0; x < width; x++) {` |
| THM-69 | blood-moon | Production theme scene lives under `src/playground/effects/` (layering inversion, chunking relies on a vite rule) | Low | Improvement | VERIFIED | `src/themes/blood-moon/blood-moon-theme.js:8` `import { create as createBloodMoon } from '../../playground/effects/blood-moon.effect.js';` |

#### Batch B8 — summer, koi-pond, bioluminescence, voltage-storm, supernova, luminous-tides, tornado, aurora

1 High, 7 Med, 15 Low, no Critical. GPU resources, listeners and timers are released on `stop()`
in all eight; no leak that accumulates across switches was found. The coordinator re-read
THM-70 (tornado's empty `getWarmupRoots()` against `tornado-funnel.js:335`), THM-71 (only
tornado, voltage-storm and moonrise-summit of the 63 registered themes are missing from
`HEAVY_GPU_THEME_IDS`) and THM-75.

- **THM-75 is fleet-wide, not only this batch.** `settings.js:455-456` emits the full `settings`
  snapshot on every save, and the shared `readSettingUpdate` helper (copied into ~42 theme classes,
  THM-32) looks for the key in `detail.settings`, so **every settings save is read as a
  `renderScale` change** and resizes the active theme's canvas and post targets. Runtime check:
  drag a slider in Settings during play and count resizes.
- **Reduced motion:** koi-pond, bioluminescence, voltage-storm, supernova, tornado and aurora read
  both inputs and react broadly; summer reads only the OS query and only stops pointer parallax
  (THM-77); luminous-tides only stills the camera (THM-78).
- **BOOT-16** (first audit) still holds at a moved path, `src/ui/serenity-hub/ThemesTab.js:17`,
  and lands in the lazily loaded hub chunk, not the boot chunk (THM-91).

| ID | Theme | Finding | Sev | Cat | Evidence | Proof |
|---|---|---|---|---|---|---|
| THM-70 | tornado | Satellite vortices (2-3 meshes, each its own node graph) and the dust front are parked `visible = false` and only shown on the first 3-combo (`fury > 0.28`) and for 5 s after a four-line/perfect clear, but the theme declares `getWarmupRoots() { return []; }` ("No parked drawables") → their pipelines compile at the gameplay climax (BaseTheme: 70-190 ms GPU stall) | High | Perf | VERIFIED (code path) / PLAUSIBLE (stall size) | `src/themes/tornado/tornado-funnel.js:335` `child.visible = false;` · `:258` `mesh.visible = false;` (front) · `src/themes/tornado/tornado-world.js:739-741` `const circling = fury > 0.28; … children[i].visible = circling;` · `:767` `this.funnel.front.visible = true;` · `src/themes/tornado/tornado-theme.js:655-658` `getWarmupRoots() { return []; }` |
| THM-71 | voltage-storm, tornado | Both own a WebGPU device + MSAA scene pass but are missing from `HEAVY_GPU_THEME_IDS` → registry `performanceClass: 'light'`: manager start/init/prewarm timeout is 10 s (not 20 s) although `createRenderer()` alone can take 2 × 5.5 s when WebGPU init times out and the WebGL2 attempt runs; deactivation takes the plain `stop()` branch (harmless only because both themes' `stop()` disposes everything) | Med | Bug | VERIFIED (classification) / PLAUSIBLE (timeout race) | `src/themes/theme-registry.js:445-506` (no 'voltage-storm'/'tornado') · `:510-511` `resourceProfile: HEAVY_GPU_THEME_IDS.has(entry.id) ? 'heavy-gpu' : 'light'` · `src/themes/theme-manager.js:23-24` `THEME_LIFECYCLE_TIMEOUT = 10000; HEAVY_THEME_LIFECYCLE_TIMEOUT = 20000;` · `src/themes/voltage-storm/voltage-storm-theme.js:68` `RENDERER_INIT_TIMEOUT_MS = 5500` + `:303-317` two sequential attempts |
| THM-72 | summer | `reactions.update()` returns a fresh `getFrame()` that is discarded, `getFrame()` is called again, and the frame is spread twice more (post, light): ~25-key objects ×4, two arrays + one clone per active emitter, plus 5-6 closures — every frame | Med | Perf | VERIFIED | `src/themes/summer/summer-theme.js:499-500` `this.reactions?.update(dt); const frame = this.reactions?.getFrame();` · `:509` `this.post?.update?.({ ...frame, time: this.time });` · `src/themes/summer/summer-reactions.js:652` `return this.getFrame();` · `:684-687` `emitters.filter(…).map((emitter) => ({ ...emitter, progress }))` · `src/themes/summer/summer-world.js:182` `light.update(time, { ...frame, front: env.front });` |
| THM-73 | supernova | `writeShells()` (every frame) allocates a `put` closure, 7 arrays per standing shell, 5 per live front and ~9 + 2 closures per blast shell for 19 s after a detonation (≈35-110 arrays/frame), plus `warm`/`follow` closures | Med | Perf | VERIFIED | `src/themes/supernova/supernova-world.js:1301` `const put = (a, b, c, d, e) => {` · `:1319-1320` `const colA = [p[keyA][0], …]; const colB = […]` · `:1345-1351` `put([radius, …], [colA[0] * norm, …], …)` · `:1385-1386` `[0, 1, 2].map((c) => …)` · `:1478` `this.writeShells(t);` |
| THM-74 | koi-pond, bioluminescence, voltage-storm, supernova, luminous-tides, tornado | The 2026-10 "scene theme" template is copy-pasted six times: theme classes differ by only 76-126 lines of ~730 after renaming, the voltage-storm/supernova/tornado directors are byte-identical, compositions differ by 12-27 lines, posts share roundBoxSdf/filmic/calm-zone code. The copies already diverge (level/clock carry exists in 3 of 6, see THM-76) and every template bug (THM-75) must be fixed six times | Med | Improvement | VERIFIED (diff counts) | `diff` after renaming: `bioluminescence-theme.js` vs `koi-pond-theme.js` 116 lines, vs `voltage-storm-theme.js` 112, `supernova` 76, `luminous-tides` 101, `tornado` 126; `voltage-storm-director.js` vs `supernova-director.js` / `tornado-director.js` = 0 · e.g. `src/themes/koi-pond/koi-pond-theme.js:110-138` ≡ `src/themes/bioluminescence/bioluminescence-theme.js:97-125` (`readSettingUpdate/readSetting/boolSetting`) |
| THM-75 | all 8 (summer, koi-pond, bioluminescence, voltage-storm, supernova, luminous-tides, tornado, aurora) | Settings parsing treats the bus SETTINGS_CHANGED payload's full `settings` snapshot as "changed keys", so every settings save is handled as a `renderScale` change → `appliedSize = null` + `renderer.setPixelRatio/setSize` (r186 reassigns canvas width/height and drops the canvas target → framebuffer realloc) + post resize (+3 forced layout reads in the template themes); Summer and the template themes also listen on both the bus and window `settingsChanged` | Low | Bug | VERIFIED | `src/ui/settings.js:455-462` `eventBus.emit(EVENTS.SETTINGS_CHANGED, { settings: { ...this.settings }, …})` · `src/themes/koi-pond/koi-pond-theme.js:114-118` `const sources = [detail, detail.changed, detail.settings]; … hasOwnProperty.call(src, key)` + `:455-461` `if (readSettingUpdate(payload, 'renderScale').present) { … this.appliedSize = null; this.resize(…)` (same in bio/voltage/supernova/luminous/tornado) · `src/themes/summer/summer-theme.js:62-66, 446-453` · `src/themes/aurora/aurora-theme.js:303-310` `|| detail.settings?.renderScale !== undefined` · `node_modules/three/src/renderers/common/CanvasTarget.js` setSize → `this.domElement.width = …; this._dispatchResize();` |
| THM-76 | koi-pond, bioluminescence, supernova | A quality rebuild or WebGPU-loss recovery restarts the world at clock 0 and level 1 (palette/night wheel, mood, combo chain snap back mid-run); voltage-storm, luminous-tides and tornado carry `{ time, level }` across the same rebuild | Low | Bug | VERIFIED | `src/themes/supernova/supernova-theme.js:255` `this.time = this.flags.time ?? 0;` · `src/themes/bioluminescence/bioluminescence-theme.js:247` same · `src/themes/koi-pond/koi-pond-theme.js:261` `this.playTo(this.flags.time ?? 0);` vs `src/themes/voltage-storm/voltage-storm-theme.js:273-279` `const carried = this.carry; … this.time = this.flags.time ?? carried?.time ?? 0; this.level = carried?.level ?? 1;` |
| THM-77 | summer | Reduced motion reads only the OS media query (never `window.settings.reducedMotion`) and only zeroes the pointer parallax; petals, the crown vortex, gust rings, swallows and the hour drift are unchanged | Med | Improvement | VERIFIED | `src/themes/summer/summer-theme.js:357-359` `const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)'); … this.reducedMotion = motionQuery?.matches === true;` · `:517-518` `const x = this.reducedMotion ? 0 : this.pointer.sx;` |
| THM-78 | luminous-tides | Reduced motion (settings + OS) only stills the camera; the constant surf/swash, spray, rain, crowns and the T-spin shoal are unchanged (no other reducedMotion read in the folder) | Low | Improvement | VERIFIED | `src/themes/luminous-tides/luminous-tides-world.js:310` `const still = this.reducedMotion ? 0 : 1;` (only use; grep) |
| THM-79 | voltage-storm, supernova | The deterministic 3D noise volume is baked on the main thread on every `build()` (every switch-in and quality rebuild): voltage-storm 3 cellular (27 neighbour tests/voxel) + 2 gradient fields at up to 64³; supernova 4 fields × 3 octaves at 64³ on every tier — cacheable per size/seed | Low | Perf | PLAUSIBLE (measure createScene long task) | `src/themes/voltage-storm/voltage-storm-world.js:252` `createCloudTexture(bakeCloudNoise(9001, tier.noise3d), tier.noise3d)` · `src/themes/voltage-storm/voltage-storm-tsl.js:232-269` cellular triple loop · `src/themes/supernova/supernova-world.js:313` `createNoise3DTexture(bakeNoise3D(this.seed))` · `src/themes/supernova/supernova-tsl.js:93` `NOISE3_SIZE = 64` |
| THM-80 | summer | Static sun shadow map (2048×1024 High, 4096×2048 Ultra/Extreme) is re-aimed and redrawn whenever the sun moved ≥0.03° and 2 frames passed; `setHour()` runs every frame, so during the 2.4 s level-up hour turn the whole forest/meadow shadow pass can run every other frame | Low | Perf | PLAUSIBLE (GPU ms after LEVEL_UP) | `src/themes/summer/summer-light.js:26-27` `SHADOW_AIM_STEP = degToRad(0.03); SHADOW_AIM_FRAMES = 2;` · `:210-217` `… sun.shadow.needsUpdate = true;` · `:364` `this.setHour(…)` in `update()` · `src/themes/summer/summer-hours.js:32` `SUMMER_HOUR_TURN_SECONDS = 2.4` |
| THM-81 | summer | CPU petal/seed/pollen sim rewrites both instance buffers for the whole pool and flags them for upload every frame (2400 particles High, 3600 Extreme ≈ 77-115 KB/frame) even when no reserve particle is alive | Low | Perf | VERIFIED | `src/themes/summer/summer-petals.js:166-176` `this.places.needsUpdate = true; this.looks.needsUpdate = true;` in `update()` · `src/themes/summer/summer-petal-sim.js:283-322` `write()` loops `this.count` |
| THM-82 | luminous-tides | CPU glow layer: every frame walks the whole drop ring (640-1000), solves the ambient spray (52 strips × 3 crests, Newton solve) and flags three full instanced attributes for upload (≈47-74 KB/frame) | Low | Perf | VERIFIED | `src/themes/luminous-tides/luminous-tides-world.js:709-736` drop loop + `writeSpray(…)` · `src/themes/luminous-tides/luminous-tides-glows.js:98-102` `a.needsUpdate = true; b.needsUpdate = true; c.needsUpdate = true;` |
| THM-83 | koi-pond | Spray pool (640-960 drops) and light pools are rewritten and flagged for upload every frame regardless of activity; 8 array literals per frame for the flash pools plus `post.update({ time })` | Low | Perf | VERIFIED | `src/themes/koi-pond/koi-pond-fx.js:167-190` `commit() { … this.buffer.needsUpdate = true; }` · `src/themes/koi-pond/koi-pond-world.js:942-944` `this.pools.set(…, [flash.rgb[i * 3], …])` · `src/themes/koi-pond/koi-pond-theme.js:624` |
| THM-84 | bioluminescence | `updateLamps()` calls `heldColor()` + `flashAt()` per cap lamp (≤12), each via `peek(i)` returning a new `{ state, o4, o3 }` → up to 24 objects/frame, plus a `forEach` closure | Low | Perf | VERIFIED | `src/themes/bioluminescence/bioluminescence-mushrooms.js:482-485` `const peek = (i) => { … return { state: …, o4: …, o3: … }; };` · `src/themes/bioluminescence/bioluminescence-world.js:893, 899` · `:978` `PALETTE_KEYS.forEach((key) => {` |
| THM-85 | tornado | `applyPalette()` every frame builds a `set` closure and a 15-key array literal and runs `TINTED.includes()` per key; while a strike is scheduled, `scheduled.filter()` allocates every frame (twice + sort when due) | Low | Perf | VERIFIED | `src/themes/tornado/tornado-world.js:611-621` `const set = (key) => {…}; ['sun', 'gapLow', …].forEach(set);` · `:702-706` `const due = this.scheduled.filter((s) => s.time <= time);` |
| THM-86 | summer | Board rect polled every 0.75 s with `querySelectorAll` + `getBoundingClientRect` + `getComputedStyle` inside the frame (forced style/layout) | Low | Perf | VERIFIED | `src/themes/summer/summer-theme.js:501-505` `if (this.boardPoll <= 0) { this.boardPoll = BOARD_POLL_S; this.world?.setBoard?.(readSummerBoardRect()); }` · `src/themes/summer/summer-stage.js:36-43` |
| THM-87 | aurora | Own rAF loop has no try/catch and re-queues the next frame before updating/rendering: a throwing frame (lost device, validation exception) repeats every frame and is never reported (`onRuntimeFailure`), unlike Summer and `safeAnimate` | Low | Bug | VERIFIED | `src/themes/aurora/aurora-theme.js:388` `this.animationFrameId = requestAnimationFrame(animate);` then `:395-397` `this.timer.update(timestamp); this.update(…); this.renderFrame();` (no try) |
| THM-88 | aurora | On every rebuild/re-entry `createScene()` calls `resize()` → `scheduleBoardReads()` while `this.time` still holds the previous run's clock, then sets `this.time = 0`: board-span reads are delayed by the previous run's length, so after a mid-game quality change events aim at the default centred board until a mode/resize event | Low | Bug | VERIFIED | `src/themes/aurora/aurora-theme.js:125-127` `this.resize(width, height); this.setupEventListeners(); this.time = 0;` · `:353` `this.boardReads = BOARD_READ_DELAYS_S.map((delay) => this.time + delay);` · `:365` `if (… this.time >= this.boardReads[0])` · `:426-452` disposeRuntime never resets `time` |
| THM-89 | aurora | The curtain march is JS-unrolled per arc (3-4 copies of `If → Loop(steps+1) → If → Loop(4) → If → {~100 nodes, 3-4 texture reads}`) → one very large fragment shader; risk of a long DXC compile on D3D12 | Low | Perf | PLAUSIBLE (pipeline compile ms) | `src/themes/aurora/aurora-curtains.js:182-186` `for (const arc of this.arcs) { this.marchArc(arc, …); }` · `:240-411` nested `If/Loop/If/Loop/If` |
| THM-90 | voltage-storm, tornado | Dated-closure queues are unbounded (koi-pond caps its queue at 96): they only fail to drain while a capture freezes the clock (`?…Time=`), but then grow by every event | Low | Bug | VERIFIED (captures only) | `src/themes/voltage-storm/voltage-storm-world.js:535-537` `schedule(time, run) { this.queue.push({ time, run }); }` · `src/themes/tornado/tornado-world.js:410-412` same · cf. `src/themes/koi-pond/koi-pond-world.js:458` `if (this.queue.length >= 96) this.queue.shift();` |
| THM-91 | tornado | BOOT-16 still holds at a moved path: the Themes tab statically imports `tornado/params.ts`; SerenityHub is dynamic-imported in a deferred task, so it lands in the hub chunk, not boot (params.ts has no imports) — UI→theme-folder coupling only | Low | Improvement | VERIFIED | `src/ui/serenity-hub/ThemesTab.js:17` `import { TORNADO_PARAM_DEFAULTS, TORNADO_PARAM_RANGES } from '../../themes/tornado/params.ts';` · `src/ui/serenity-hub/SerenityHub.js:12` · `src/main.js:2368` `await import('./ui/serenity-hub/SerenityHub.js')` |
| THM-92 | koi-pond | `PondSurface.update()` has no caller (the world steps `stepOnce()`/`derive()` itself) — dead code | Low | Improvement | VERIFIED (grep `surface?.update(` = 0 hits) | `src/themes/koi-pond/koi-pond-surface.js:381-391` `update(renderer, dt, time, maxSteps = 4) {` |

#### Batch B7 — verdant-hills, stillwater, himalayan-peak, chromatic-impasto, void-ember, stellar-velocity, kaleidosonic, black-hole

No Critical or High. black-hole's GPU-timestamp lifecycle is clean (tracking cleared before
dispose, pending resolves awaited ≤ 300 ms, no compute pool any more). Reduced motion:
verdant-hills reads only the OS query (THM-94); the other seven read both inputs.

- **The resume/rebuild race is fleet-wide (THM-93, same root cause as THM-33).** A coordinator
  grep finds 52 theme classes with a `rebuildPending` resume path; only five `return false` from
  `resume()` while a rebuild is pending (sky-children, stillwater, halcyon-apex, ocean,
  vesper-chrysalis), so about 47 can double-build on resume after a quality change behind the
  menu. On chromatic-impasto that also throws away the player's painting; on stellar-velocity and
  kaleidosonic the palette clock jumps to zero.
- **THM-113 and THM-114:** `*-composition.js` is a verbatim copy in ~42 themes, and the
  "overhauled theme" class and director are near-copies across this batch.

| ID | Theme | Finding | Sev | Cat | Evidence | Proof |
|---|---|---|---|---|---|---|
| THM-93 | verdant-hills, himalayan-peak, chromatic-impasto, void-ember, stellar-velocity, kaleidosonic, black-hole | `resume()` with `rebuildPending` returns true and queues the rebuild; the manager then patches the OLD `renderer.render` and waits 700 ms for a frame, the queued rebuild disposes that renderer first, so the manager's "produced no frames" recovery runs `activateThemeInstance()` → `start()` → `stop()` → a second full rebuild. Extra consequences: impasto's painting and kaleidosonic's session/trance are lost (the recovery path's `stop()` disposes the world before export), stellar-velocity/kaleidosonic clocks reset to 0 (palette/mood jump). Stillwater avoids it by refusing the resume. | Med | Bug | PLAUSIBLE — trace verified in code; confirm at runtime: change quality in the menu while parked, resume, look for `[ThemeManager] Resumed theme … produced no frames` and two scene builds. Repo-wide: 48 of 52 `rebuildPending` themes lack the guard. | `verdant-hills-theme.js:575-577` `if (this.rebuildPending) { this.rebuildPending = false; this.queueRebuild(); }`; same at `himalayan-peak-theme.js:689-692`, `chromatic-impasto-theme.js:682-685`, `void-ember-theme.js:669-672`, `stellar-velocity-theme.js:677-680`, `kaleidosonic-theme.js:733-736`, `black-hole-theme.js:534-536`; manager `theme-manager.js:2062-2096` `const renderer = themeInstance?.renderer; … renderer.render = (...args) => { rendered = true; … }` → `await this.activateThemeInstance(...)`; fix pattern `stillwater-theme.js:762` `if (this.rebuildPending) return false;` |
| THM-94 | verdant-hills | reducedMotion reads ONLY the OS media query (never `window.settings.reducedMotion`) and only disables mouse parallax; kites, ribbons, seed bursts, cloud drift, birds and grass waves run unchanged | Med | Bug | VERIFIED | `verdant-hills-theme.js:362-372` `const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)'); … this.reducedMotion = motionQuery?.matches === true;` effect only `:517-518` `const x = this.reducedMotion ? 0 : this.pointer.sx;` |
| THM-95 | verdant-hills | Reactions frame rebuilt twice per frame (the `update()` return value is discarded) plus two whole-frame spreads, per-emitter copies and per-frame closures: ~13 allocations/frame idle, 40-60 in a combo | Med | Perf | VERIFIED | `verdant-hills-theme.js:499-500` `this.reactions?.update(dt); const frame = this.reactions?.getFrame();` (`reactions.js:690` `return this.getFrame();`); `reactions.js:727-730` `emitters: this.emitters.filter(…).map((emitter) => ({ ...emitter, progress … }))`; `verdant-hills-theme.js:509` `this.post?.update?.({ ...frame, time: this.time });`; `verdant-hills-world.js:167` `light.update(time, { ...frame, front: env.front, pool: env.pool });`; `fx-director.js:615` `const play = (queue, last, start) => {` |
| THM-96 | verdant-hills | CPU seed/chaff sim (2400 High / 3600 Extreme): every live reserve particle evaluates the analytic `groundHeight()` each frame, `write()` rewrites all slots and both instanced attributes are flagged for full upload every frame even when nothing is live (77-115 KB/frame) | Med | Perf | PLAUSIBLE — measure `world.seeds.update` ms after a four-line clear / during a combo whirl | `verdant-hills-seed-sim.js:244` `const floor = this.groundHeight(this.x[i], this.z[i]);`; `:278-297` full loop over `this.count`; `verdant-hills-seeds.js:170-173` `this.sim.step(dt, env); this.markDirty();` → `:166-167` `this.places.needsUpdate = true; this.looks.needsUpdate = true;` |
| THM-97 | verdant-hills | `rise()` runs a CPU ground ray-march (≈55 steps + 5 refinements of `groundHeight`, plus a closure) for every spawned particle — ~17k height evaluations/s for 1.5 s on four-line clears, perfect clears and festivals | Low | Perf | PLAUSIBLE — profile a four-line clear | `verdant-hills-fx-director.js:471` `const spot = stage.ground(this.random(), 0.6 + 0.39 * this.random(), this.groundHeight, this.foot);`; `verdant-hills-stage.js:159-174` `const under = (reach) => … height(…); … while (!met && high < GROUND_FAR) {` |
| THM-98 | verdant-hills | Board-rect poll every 0.75 s calls `getComputedStyle` + `getBoundingClientRect` per card (forced layout ~1.3×/s); the overhauled themes read layout only on scheduled triggers | Low | Perf | VERIFIED | `verdant-hills-theme.js:501-505` `if (this.boardPoll <= 0) { this.boardPoll = BOARD_POLL_S; this.world?.setBoard?.(readVerdantHillsBoardRect()); }`; `verdant-hills-stage.js:41-43` `const style = … win.getComputedStyle(element)` |
| THM-99 | himalayan-peak, chromatic-impasto, void-ember, stellar-velocity, kaleidosonic | `pointerleave` listener registered on `window`: the event does not bubble and is never targeted at `window`, so the non-capture listener never fires and pointer parallax keeps its last lean when the cursor leaves the window. Stillwater documents this and uses `pointerout` + `relatedTarget`. Repo-wide: 36 theme classes have the line. | Low | Bug | VERIFIED (code + DOM dispatch rules; the repo's own note at `stillwater-theme.js:461-462`) | `himalayan-peak-theme.js:401` `this.registerEventListener(window, 'pointerleave', resetPointer, { passive: true });`; same at `chromatic-impasto-theme.js:382`, `void-ember-theme.js:391`, `stellar-velocity-theme.js:399`, `kaleidosonic-theme.js:408`; fix `stillwater-theme.js:463-467` `const onPointerOut = (event) => { if (!event?.relatedTarget) resetPointer(); };` |
| THM-100 | himalayan-peak | The eagle (skinned, animated GLB) is fetched after `build()` and added whenever it arrives; warm roots are empty and the header claims the first frame compiles every pipeline, so the eagle's pipeline (and its skinning variant) can be created after reveal | Med | Perf | PLAUSIBLE — measure eagle arrival vs reveal on a cold cache; pipelines created after reveal | `himalayan-peak-world.js:295-302` `this.eagleReady = … loadEagle().then((gltf) => { … this.eagle = createEagle(this.u, gltf); … this.root.add(this.eagle.mesh);`; `himalayan-peak-theme.js:35-36` `Warm: none (… the first frame compiles every render pipeline).`; `:649-651` `getWarmupRoots() { return []; }` |
| THM-101 | stillwater | The troll sculpt is awaited ≤4 s before the first frame; a GLB later than that joins mid-play and compiles its skinned pipelines (main + reflector pass) then | Low | Perf | PLAUSIBLE — cold-cache load time vs 4 s | `stillwater-theme.js:69` `const WORLD_PREPARE_TIMEOUT_MS = 4000;`; `stillwater-world.js:331-337` `const loaded = await this.troll.load(); … this.troll.mesh.traverse((o) => o.layers.set(HERO_LAYER));` |
| THM-102 | chromatic-impasto | Four RGBA16F paint targets sized to the drawing buffer (≈113 MB on High at 1440 px tall, ≈210 MB Extreme) are all re-created on every buffer-size change, new before old are disposed (2× transient) — a window drag churns hundreds of MB | Low | Perf | PLAUSIBLE — VRAM + frame time during a window-edge drag | `chromatic-impasto-world.js:234-236` `const height = clamp(Math.round(this.buffer.height * VIEW.overscan * tier.canvasScale), 384, tier.canvasMax); const width = Math.min(4096, …);`; `chromatic-impasto-canvas.js:424-427` `this.pigment[i] = makeTarget(w, h, …); this.relief[i] = makeTarget(w, h, …);` then `:442-445` `old.pigment?.dispose(); …` |
| THM-103 | void-ember | `level` is not reset by `stop()` and is replayed by the next `createScene()`; if a run ends while another theme is active (this theme's `gameOver` listener is gone) the next start opens on a stale level's palette (stellar-velocity keeps level across stop by design, same caveat) | Low | Bug | VERIFIED | `void-ember-theme.js:271` `if (this.level > 1) this.world.levelUp(this.level, { silent: true });`; reset only in `resetSession()` `:417` `this.level = 1;`; `stop()` `:727-730` has no reset (contrast `stillwater-theme.js:831` `this.level = 0;`) |
| THM-104 | kaleidosonic | Reduced motion stops dive/roll/kick/turn but the clear-driven refold spring still morphs the whole temple and the vein flow/pulse phases run at full gameplay-driven rate — the largest full-frame motions stay on | Low | Bug | VERIFIED | `kaleidosonic-world.js:716-719` `const target = REFOLDS[…]; springStep(this.sSpring, target, dt, 4.2);` (no reducedMotion check); `:723-725` `this.breath = (((this.breath + dt * flow) % PHASE_WRAP) …`; reduced set only gates `:213-225` |
| THM-105 | kaleidosonic | `fwidth()` evaluated inside the `If(hit > 0.5)` branch (veins, floor mandala, harmonic shells); three r186 disables WGSL derivative uniformity on Chromium so it compiles in Electron, but derivatives are undefined across hit/miss quads (silhouette sparkle) and the module would fail validation on Firefox | Low | Bug | PLAUSIBLE — visual check at stone silhouettes | `kaleidosonic-temple.js:143` `If(hit.greaterThan(0.5), () => {` … `:228` `const aa = max(fwidth(wr), 0.02).toVar();` `:249` `const aaM = max(fwidth(wm), 0.015);` `:306` `fwidth(phase)`; three `WGSLNodeBuilder.js:281-285` `diagnostics += 'diagnostic( off, derivative_uniformity );\n';` (skipped for Firefox) |
| THM-106 | kaleidosonic | `placeHeart()` runs 49 CPU `marchTemple` rays + up to 25 `templeDistance` probes on every `setViewport()`/`setLayout()` — each resize step and each of the 3 scheduled layout reads | Low | Perf | PLAUSIBLE — main-thread ms during a window drag | `kaleidosonic-world.js:351-358` `for (let j = -3; j <= 3; j++) { for (let i = -3; i <= 3; i++) { … const hit = marchTemple(o, d, {…`; called from `:248` and `:256` |
| THM-107 | black-hole | Camera position/look, roll and pointer smoothing use `lerp(target, Math.min(1, dt·k))` — first-order, so lag and overshoot-free settling differ between 30 and 144 fps (director uses exact half-life decay) | Low | Bug | VERIFIED | `black-hole-world.js:307` `this.cameraSmoothed.lerp(this.cameraTarget, Math.min(1, dt * (1.8 + energy * 0.9)));`; `:328` `…Math.min(1, dt * (2.4 + energy * 1.2))`; `:341` `…Math.min(1, dt * 2)`; `:441` `const ease = Math.min(1, dt * 3.4);` |
| THM-108 | black-hole | Module-level `bakeCache` keeps every tier's CPU bakes (≈1.2 MB sky + 0.26 MB disk per size) for the whole session; no `static disposeSharedResources()` for the manager's terminal disposer | Low | Improvement | VERIFIED | `black-hole-world.js:44-48` `const bakeCache = new Map(); function cached(key, bake) { if (!bakeCache.has(key)) bakeCache.set(key, bake()); …`; hook `theme-manager.js:233-241` `if (typeof ThemeClass?.disposeSharedResources !== 'function') return;` |
| THM-109 | black-hole | Only the sky bake is sliced; the 512×128 fBm disk bake runs synchronously on first use (main-thread block on the first start of a session) | Low | Perf | PLAUSIBLE — longtask on first start | `black-hole-world.js:102-103` `if (!bakeCache.has(\`disk:…\`)) await yieldToLoop(); return bakeBlackHoleTextures(preset, seed);` → `:56-59` `cached(…, () => bakeDiskTexture(diskWidth, diskHeight, seed % 65521))` |
| THM-110 | black-hole | GPU-timed DRS resolves render timestamps at 15 Hz; each resolve makes three clone the offsets Map, regex every pass uid and `mapAsync` — avoidable churn given the 0.8/0.2 EMA already smooths samples (lifecycle itself is clean: trackTimestamp cleared before dispose, pending resolves awaited ≤300 ms, late results gated by `owned()`) | Low | Perf | PLAUSIBLE — CPU profile of `_resolveQueries` | `black-hole-theme.js:31` `const GPU_SAMPLE_INTERVAL_S = 1 / 15;`; `:282` `query = renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER);`; three `WebGPUTimestampQueryPool.js` `_resolveQueries` `const currentOffsets = new Map( this.queryOffsets ); … uid.match( /^(.*):f(\d+)$/ )` |
| THM-111 | stillwater, himalayan-peak, chromatic-impasto, void-ember, stellar-velocity, kaleidosonic, black-hole | Small per-frame allocations on the render path: an object literal per frame for `post.update` in every template theme, plus stillwater's pool/tuple arrays and place() literals, himalayan's `warm` closure, impasto's advance/`into()` closures and `mixRgb` array, stellar's sort comparator | Low | Perf | VERIFIED | `stillwater-theme.js:711` / `himalayan-peak-theme.js:633` / `chromatic-impasto-theme.js:627` / `void-ember-theme.js:614` / `stellar-velocity-theme.js:622` / `kaleidosonic-theme.js:678` `this.post.update({ time: this.time });`; `black-hole-theme.js:466` `this.post?.update({ energy: …, flash: …, ripples: … });`; `stillwater-world.js:1105` `const pool = [[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]];`; `himalayan-peak-world.js:925` `const warm = (key, node, gain = 1) => {`; `chromatic-impasto-world.js:997-1003` `painter.advance(t, canvas.batch, tw, (entry) => {…}, …, (seconds) => {…})`; `stellar-velocity-world.js:867` `lit.sort((a, b) => rows[a * 2].x - rows[b * 2].x);` |
| THM-112 | stillwater, himalayan-peak, chromatic-impasto | Pool emits flag every instanced attribute for a full re-upload (no update ranges): sparks/papers up to 80-90 KB on an emitting frame | Low | Perf | VERIFIED | `stillwater-fx.js:376-381` `if (many > 0) { aBirth.needsUpdate = true; aMotion.needsUpdate = true; aLook.needsUpdate = true; aMode.needsUpdate = true; }`; `himalayan-peak-fx.js:191-193` `['aBirth', 'aVel', 'aTint', 'aTurn'].forEach((name) => { geometry.getAttribute(name).needsUpdate = true; });` (impasto's stamp buffer already uses `addUpdateRange`, `chromatic-impasto-canvas.js:512-514`) |
| THM-113 | stillwater, himalayan-peak, chromatic-impasto, void-ember, stellar-velocity, kaleidosonic (+ ~36 others) | `*-composition.js` is a verbatim copy in ~42 themes (`readLayoutRects`, `fallbackLayout`, `boardFor`, `cardUnion`, `boardPoint`, `layoutsDiffer`); `diff` vs stillwater differs only in the header comment → `src/themes/shared/board-layout.js` | Low | Improvement | VERIFIED | `diff stillwater-composition.js himalayan-peak-composition.js` = 28 lines (header); same 25 lines for void-ember / stellar-velocity / chromatic-impasto; `stillwater-composition.js:77` `export function readLayoutRects(doc = globalThis.document, win = globalThis.window) {` |
| THM-114 | stillwater, himalayan-peak, chromatic-impasto, void-ember, stellar-velocity, kaleidosonic | "Overhauled theme" template duplicated: theme classes (renderer/fallback/GPU-surface recovery, settings parsing, layout scheduling, calm zones, pointer, resize, pause/resume, disposeRuntime) and gameplay directors are near-copies — stellar-velocity's theme is a rename of void-ember's; directors differ from stillwater's by 109-129 of ~450 lines; posts share `roundBoxSdf`/calm rects/max-channel highpass/filmic/grain → shared base class + `shared/gameplay-director.js` + `shared/post-calm-rects.js` | Low | Improvement | VERIFIED | `diff stillwater-theme.js himalayan-peak-theme.js` 330 lines of 753; `diff void-ember-theme.js stellar-velocity-theme.js` ≈40 meaningful lines; `diff stillwater-director.js {void-ember,stellar-velocity,chromatic-impasto,himalayan-peak}-director.js` 115/129/109/129 lines |
| THM-115 | himalayan-peak, chromatic-impasto, void-ember, stellar-velocity | FX quad-pool helpers (instanced quad geometry, premultiplied "over" material, part wrapper) and screen-space row beams duplicated per theme → `shared/fx-quad-pool.js`, `shared/row-beams.js` | Low | Improvement | VERIFIED | `himalayan-peak-tsl.js:511-557` `hpFxMaterial` / `hpQuadGeometry` / `hpPart`; `chromatic-impasto-fx.js:41-80` `quadGeometry` / `fxMaterial` / `part`; `void-ember-fx.js:451-509` vs `himalayan-peak-fx.js:214-273` `createRowBeams` |
| THM-116 | verdant-hills, black-hole (+ blood-moon, fall, forest, golden-forest, sakura-twilight, summer) | Settings/URL helper family (`searchParams`, `enabledParam`, `eventDetail`, `settingUpdate`, `enabledSetting`) copy-pasted per theme class → `src/themes/shared/theme-settings.js` | Low | Improvement | VERIFIED | `verdant-hills-theme.js:49-84` `function searchParams() … function enabledParam(params, ...keys) … function settingUpdate(payload, key) … function enabledSetting(value, fallback = true)`; `black-hole-theme.js:33-44` |

#### Batch B3 — moonlit-greenhouse, cosmic-noir, chromadelic-highway, serenity-warp, chiral-gold, starlight, crystal-cave

2 High, 6 Med, 26 Low, no Critical (including three batch-wide rows). The coordinator re-read
THM-120 (three r186 documents that `sizeNode` "has no effect when the material is used with
`Points` and a WebGPU backend", `PointsNodeMaterial.js`, constructor comment; cosmic-noir sets it
on five `Points` materials, `cosmic-noir-materials.js:184,244,631,694,787`) and THM-137 (outside
tests, `getWarmupRoots()` is called only by black-hole's own theme code, and only black-hole
imports `shared/warm-hidden-drawables.js`).

- **THM-137 changes how the warm findings read.** The manager never warms a theme's declared
  warm roots, so a theme that declares them (THM-70's fix) gains nothing unless the theme calls the
  helper itself, as black-hole does. The fix belongs in the pipeline (see PIPE).
- **Reduced motion:** cosmic-noir, chromadelic-highway and crystal-cave read **neither** input
  (THM-122, THM-129, THM-147); moonlit-greenhouse stills only the camera (THM-117); starlight keeps
  its whole-sky turns (THM-146).
- **`THREE.Points` + `sizeNode`** is also used in misty-lake, moonrise-summit, neon-dusk,
  nimbus-veil, rainy-window, synthwave-sunset and wolfhour; their batch rows say whether those are
  affected.

| ID | Theme | Finding | Sev | Cat | Evidence | Proof |
|---|---|---|---|---|---|---|
| THM-117 | moonlit-greenhouse | Reduced motion only stills the camera (sway, parallax, hard-drop jolt); Queen spin, T-spin air wheel, glazing waves and flashes are unchanged | Low | Improvement | VERIFIED | `src/themes/moonlit-greenhouse/moonlit-greenhouse-world.js:463` `const still = this.reducedMotion ? 0 : 1;` (the only consumer of `reducedMotion`) |
| THM-118 | cosmic-noir | Hidden FX drawables (gas swirl, spark points, combo flash sprite, lens flare) and the spark compute pipeline are never warmed; the first combo ≥2 / ≥6 creates render + compute pipelines during play | High | Perf | VERIFIED (code) / PLAUSIBLE (stall size) | `src/themes/cosmic-noir/cosmic-noir-theme.js:2941` `points.visible = false;` + `:3192` `sparks.visible = false;` + `:1865` `this.renderer.compileAsync(this.scene, this.camera)` (skips invisible objects; compute first dispatched at `:3745`) |
| THM-119 | cosmic-noir | On non-Windows WebGPU the theme turns MRT on and then runs its own bare `compileAsync(scene, camera)` — the documented MRT poisoned-pipeline (blank objects) vector; no `usesMrtScenePass()` override | High | Bug | PLAUSIBLE | `src/themes/cosmic-noir/cosmic-noir-theme.js:1531` `const useMRT = this.isWebGPU && usePost && !this.flags.noMRT && supportsMRT && !guardMrtOnPlatform;` + `:1865` (guard is Windows-only, `:1555-1561`) |
| THM-120 | cosmic-noir | Every particle layer (starfield, dust, void sparks, gas swirl) is `THREE.Points` + `PointsNodeMaterial.sizeNode`; r186 ignores sizeNode for Points (WebGPU) and hard-codes `gl_PointSize = 1.0` (WebGL2) — all render as 1-px points, not the intended 12-300 px soft sprites | Med | Bug | VERIFIED | `src/themes/cosmic-noir/cosmic-noir-materials.js:184` `material.sizeNode = clamp(` on `cosmic-noir-theme.js:2287` `new THREE.Points(geometry, material)`; `node_modules/three/src/materials/nodes/PointsNodeMaterial.js:55-63` "this node has no effect when the material is used with Points and a WebGPU backend" |
| THM-121 | cosmic-noir | Combo choreography keys off `COMBO.comboCount`, which is cascade DEPTH; standard-play LINE_CLEAR carries no comboCount, so ordinary back-to-back combos never reach the ≥2 / ≥6 sparks, gas swirl and flash | Med | Bug | VERIFIED | `src/themes/cosmic-noir/cosmic-noir-theme.js:4414` `const comboCount = detail.comboCount ?? detail.combo ?? detail.count ?? 0;` vs `src/core/game-modes/InfinityMode.js:1525` "the number is cascade depth" |
| THM-122 | cosmic-noir | Reduced motion: reads neither the OS query nor `settings.reducedMotion`; 420-unit camera orbit, rig breathing and impact shake always run | Med | Improvement | VERIFIED | `src/themes/cosmic-noir/cosmic-noir-theme.js:3812` `this.cameraBase.x = Math.sin(cameraTime) * orbitRadiusX` (no `reduc`/`matchMedia` in the folder; `shared/camera-rig.js:192-264` has none either) |
| THM-123 | cosmic-noir | `effectQuality` changes are ignored until the next start (read only in createScene, no SETTINGS_CHANGED subscription; main.js does not restart themes) | Med | Improvement | VERIFIED | `src/themes/cosmic-noir/cosmic-noir-theme.js:1914` `const quality = this.getCurrentQualityLevel();` |
| THM-124 | cosmic-noir | Adaptive budget re-derives scene/bloom resolution scale every frame from an EMA of CPU dispatch time with hard thresholds and no hysteresis → `setResolutionScale` flips reallocate targets | Low | Perf | PLAUSIBLE | `src/themes/cosmic-noir/cosmic-noir-theme.js:783-785` `if (pressure > 1.05) { budget.postResolutionScale = 0.94;` + `cosmic-noir-post.js:243` `this.scenePass.setResolutionScale(this.resolutionScale);` |
| THM-125 | cosmic-noir | Bus handlers gate on `isActive` only, so a PAUSED theme still spawns waves and arms `setTimeout`s into the parked scene | Low | Bug | VERIFIED | `src/themes/cosmic-noir/cosmic-noir-theme.js:4377` `if (this.isActive && settings?.backgroundComboEffects === true) {` |
| THM-126 | cosmic-noir | Dead code: every ShaderMaterial / EffectComposer / CanvasTexture branch, the 611-line `cosmic-noir-shaders.js`, two PointLights + AmbientLight (all materials unlit), unused FBM-octave preset keys, an inline-`opacity:0` fallback container | Low | Improvement | VERIFIED | `src/themes/cosmic-noir/cosmic-noir-theme.js:2069` `this.usesNodeMaterials = renderer.isWebGPURenderer === true;` (renderer is always `WebGPURenderer`, `:2039`) |
| THM-127 | cosmic-noir | `pieceLockRipple` setting ignored: lock wave + lock shake fire whenever combo effects are on | Low | Improvement | VERIFIED | `src/themes/cosmic-noir/cosmic-noir-theme.js:4375-4379` `eventBus.on(EVENTS.PIECE_LOCK, () => { … this.handlePieceLock();` |
| THM-128 | cosmic-noir | ~4 small allocations per frame (rAF arrow, `q` closure, `toFixed` string, `find` closure); keyed wave pool disposes on overflow and can rebuild NodeMaterials mid-play | Low | Perf | VERIFIED | `src/themes/cosmic-noir/cosmic-noir-theme.js:3590` `requestAnimationFrame(() => this.animate())`; `:890` `const q = (value) =>`; `:4181-4185` dispose when pool full |
| THM-129 | chromadelic-highway | Reduced motion: reads neither; forward travel, camera float/bank/look-ahead, pace FOV widening, Tetris surge and streak warp always run | Med | Improvement | VERIFIED | `src/themes/chromadelic-highway/chromadelic-highway-world.js:1087-1088` `camera.position.set( rest.x + Math.sin(t * 0.13) * 2.2 + …` (no `reduc`/`matchMedia` in folder) |
| THM-130 | chromadelic-highway | `effectQuality` changes ignored until the next start | Med | Improvement | VERIFIED | `src/themes/chromadelic-highway/chromadelic-highway-theme.js:1600` `const quality = this.getCurrentQualityLevel();` (createScene only) |
| THM-131 | chromadelic-highway | Bus handlers gate on `isActive` only: a paused theme keeps pushing the envelope, scheduling waves and spawning meteors | Low | Bug | VERIFIED | `src/themes/chromadelic-highway/chromadelic-highway-theme.js:1925` `const reactive = () => this.isActive && window.settings?.backgroundComboEffects !== false;` |
| THM-132 | chromadelic-highway | A window resize is handled twice (own `resize` listener + ThemeManager funnel), each with two drawing-buffer writes | Low | Perf | VERIFIED | `src/themes/chromadelic-highway/chromadelic-highway-theme.js:1977` `window.addEventListener('resize', this.resizeHandler);` + `:2159-2160` `setPixelRatio(…)` / `setSize(width, height)` |
| THM-133 | chromadelic-highway | Layout watch polls at 1 Hz and each poll forces a style/layout read (getBoundingClientRect + getComputedStyle) during play | Low | Perf | VERIFIED | `src/themes/chromadelic-highway/chromadelic-highway-theme.js:1694` `watch.interval = setInterval(schedule, 1000);` → `:1717` `const rects = readLayoutRects();` |
| THM-134 | chromadelic-highway | Planet anchor ease is linear in dt with a 0.03 floor — frame-rate dependent above ~70 fps | Low | Bug | VERIFIED | `src/themes/chromadelic-highway/chromadelic-highway-world.js:987` `const k = delta > 0 ? THREE.MathUtils.clamp(delta * 2.1, 0.03, 0.16) : 1;` |
| THM-135 | chromadelic-highway | ~720 lines of baseline/soak/sign-off tooling live in the production theme class (overlaps the shared perf lane) | Low | Improvement | VERIFIED | `src/themes/chromadelic-highway/chromadelic-highway-theme.js:1276` `async runBaselineSoak(options = {}) {` … `:1540` `installBaselineHelpers() {` |
| THM-136 | batch: moonlit-greenhouse, serenity-warp, chiral-gold, starlight (+ ~38 other themes) | The "rebuild template" is copy-pasted: theme shells are ~85 % identical (serenity-warp vs moonlit: 113 differing lines of ~750 after renaming), the gameplay directors are identical apart from names (485 lines; chiral-gold 66 / starlight 52 differing lines), `readLayoutRects` (36-line body, 0 diff) and `readSettingUpdate` each exist in 42 theme files. Candidates: `shared/theme-shell.js` (flags, settings readers, renderer factory + WebGL2 fallback, gpu-surface, rebuild queue, layout-read scheduler, disposeRuntime), `shared/gameplay-director.js`, `shared/layout-rects.js` | Low | Improvement | VERIFIED | `src/themes/serenity-warp/serenity-warp-director.js` vs `src/themes/moonlit-greenhouse/moonlit-greenhouse-director.js` (diff = renames only); `export function readLayoutRects` in 42 files under `src/themes/` |
| THM-137 | batch (base contract; crystal-cave, cosmic-noir) | `getWarmupRoots()` / `usesMrtScenePass()` are documented as manager hooks ("A theme that declares its FX root gets those pipelines compiled during its masked warm window"; "Consumers must skip bare sweeps") but nothing at runtime calls them (only black-hole calls its own, plus the perf instrument and tests); the legacy prewarm path (`?themeWarmAsync=0`) runs a bare `compileAsync` regardless | Med | Bug | VERIFIED | `src/themes/base-theme.js:386-417` (doc) vs `src/themes/theme-manager.js:1708-1714` `theme.renderer.compileAsync(theme.scene, theme.camera)`; grep `getWarmupRoots\|usesMrtScenePass` outside theme classes: `black-hole-theme.js:481`, `scripts/lib/theme-perf-instrument.mjs:444`, tests |
| THM-138 | batch: moonlit-greenhouse, chromadelic-highway, serenity-warp, chiral-gold, starlight, crystal-cave | Post-stack skeleton duplicated: max-channel 4-tap BloomNode `highPassFn` (set in 52 theme files), rounded-box calm-rect SDF, filmic shoulder, `renderOutput(…, NoToneMapping)` + grain + triangular dither, falseColor `select` ladder, `createPassThroughPipeline` (exported from 45 files). Candidate `shared/post-kit.js` | Low | Improvement | VERIFIED | `src/themes/moonlit-greenhouse/moonlit-greenhouse-post.js:171-184` ≡ `src/themes/serenity-warp/serenity-warp-post.js:156-171` ≡ `src/themes/chromadelic-highway/chromadelic-highway-post.js:174-184` (`this.bloomNode.highPassFn = Fn(({ input, threshold, smoothWidth }) => {`) |
| THM-139 | serenity-warp | The environment sky (what the glass refracts) is repainted every rendered frame on Medium+ (512×256 … 1024×512 full sky evaluation), with a frame-count cadence that scales with fps | Low | Perf | PLAUSIBLE | `src/themes/serenity-warp/serenity-warp-sky.js:342-343` `const every = Math.max(1, tier.envEvery \| 0); const due = force \|\| frame % every === 0;` + `serenity-warp-world.js:1325` |
| THM-140 | serenity-warp | Per-frame `{ time }` literal, and all 7 glass interleaved buffers fully re-uploaded every frame with no update range | Low | Perf | VERIFIED | `src/themes/serenity-warp/serenity-warp-theme.js:621` `this.post.update({ time: this.time });` + `serenity-warp-glass.js:447` `s.buffer.needsUpdate = true;` |
| THM-141 | serenity-warp | 64³ gas volume (10 gradient + 2 cellular fields, ~16 MB transient) and 256² fBm + CPU mip chain re-baked on the main thread on every createScene, though the seeds are constant | Low | Perf | PLAUSIBLE | `src/themes/serenity-warp/serenity-warp-world.js:338-339` `const gas = createGasTexture(bakeGasNoise(6151, 64), 64); const fbm = createFbmTexture(bakeFbm());` |
| THM-142 | chiral-gold | A rebuild in place (quality change, GPU recovery) resets the clock and the level, so the hall drops back to the level-1 alloy mid-run (moonlit/warp/starlight carry both) | Low | Bug | VERIFIED | `src/themes/chiral-gold/chiral-gold-theme.js:250` `this.time = this.flags.time ?? 0;` + `chiral-gold-world.js:752-753` `this.level = 1; this.applyAlloy(ALLOYS[0], true);` (via `seek`, `:757-758`) |
| THM-143 | chiral-gold | Per-frame allocations: `{ time }` literal, `ease` closure, `cardUnion` object spread every frame, and with no board on screen `fallbackLayout()` (~9 objects) every frame; the shared `getAudioAnalysis` allocates per call when no analyser exists | Low | Perf | VERIFIED | `src/themes/chiral-gold/chiral-gold-world.js:930` `const union = cardUnion(this.currentLayout());` + `chiral-gold-composition.js:129` `const u = { ...cards[0] };` |
| THM-144 | chiral-gold | Particle emits allocate four array literals per particle (`TypedArray.set([...])`) — ~4 900 short-lived arrays on a High 4-line clear in a chain | Low | Perf | VERIFIED | `src/themes/chiral-gold/chiral-gold-fx.js:239-240` `aOrigin.set([ x + (rand() - 0.5) * jitter, …], i * 4);` |
| THM-145 | starlight | Per-frame allocations: `{ time }` literal, `setTrailing` forEach closure, and two `filter`s + a sort over the staged-event list every frame while anything is staged | Low | Perf | VERIFIED | `src/themes/starlight/starlight-world.js:939-941` `const due = this.scheduled.filter((s) => s.time <= time); … this.scheduled = this.scheduled.filter((s) => s.time > time);` + `starlight-theme.js:614` |
| THM-146 | starlight | Reduced motion keeps the T-spin pirouette and the level-up hour swing of the whole sky (and the chain-thickened shower) | Low | Improvement | VERIFIED | `src/themes/starlight/starlight-world.js:957-960` `const step = this.turnDebt * approach(1.5, dt); … this.skyAngle += dt * SKY_RATE * (1 + this.shutter * 3) + step;` (no `this.reduced` term) |
| THM-147 | crystal-cave | Reduced motion: reads neither; camera drift/parallax and every spark, fan, beam and pinwheel effect run unchanged | Med | Improvement | VERIFIED | `src/themes/crystal-cave/crystal-cave-world.js:557-558` `camera.position.set( this.eye.x + (Math.sin(time * 0.071) * 1.05 + (pointer?.x ?? 0) * 0.6) * sway,` (no `reduc`/`matchMedia` in folder) |
| THM-148 | crystal-cave | The 3.7 MB `cavern.glb` is re-fetched and re-parsed (plus float conversion of 73k verts and 2 087 crystal records) on every createScene — switch-in, quality rebuild, GPU recovery | Low | Perf | PLAUSIBLE | `src/themes/crystal-cave/crystal-cave-assets.js:122` `const gltf = await loader.loadAsync(CRYSTAL_CAVE_CAVERN_URL);` + `crystal-cave-theme.js:470` `disposeCrystalCaveAssets(this.assets);` |
| THM-149 | crystal-cave | CPU spark pool loops every slot and re-uploads three full instanced attributes every frame even with no spark alive; plus per-frame `forEach` closures | Low | Perf | VERIFIED | `src/themes/crystal-cave/crystal-cave-effects.js:321-324` `sparkMesh.geometry.instanceCount = Math.max(1, live); sparkPlace.needsUpdate = true; sparkTrail.needsUpdate = true; sparkTint.needsUpdate = true;` |
| THM-150 | crystal-cave | Board-rect poll every 0.75 s forces a layout read during play | Low | Perf | VERIFIED | `src/themes/crystal-cave/crystal-cave-theme.js:393-394` `this.boardPoll = BOARD_POLL_S; this.world?.setBoard?.(readCrystalCaveBoardRect());` |

#### Batch B4 — thermal-bloom, forest, lunara, cinder-drift, murmuration, fluid-dreams, astral-weave, nimbus-veil

1 High, 8 Med, 20 Low, no Critical. All eight are heavy-gpu and fully tear their renderer down in
`stop()`; no accumulating GPU or listener leak was found. The coordinator re-read THM-167
(`murmuration/composition/camera-director.js:171-172,180`) and THM-161
(`lunara-director.js:397-422`, the sink is called before `clearPending(slot)` with no
`try/finally`).

- **forest is the starter theme** (the one a fresh profile boots with): its CPU firefly simulation
  re-uploads all instance buffers every frame (THM-156), it may allocate thousands of small objects
  per frame in combos (THM-157), and it re-fetches its 12-file asset pack on every start (THM-159).
  Its reduced motion reads only the OS query (THM-155).
- **THM-161 (director freeze):** in the 13-theme lunara director family, a throwing event sink
  leaves the slot pending, so the same event is re-delivered every frame; after three consecutive
  errors `safeAnimate` stops the loop and the theme freezes. thermal-bloom's family already wraps
  delivery in `try/finally`.
- **Reduced motion:** nimbus-veil reads neither input (THM-175); murmuration reads both but only
  stills the camera and has no OS change listener (THM-169).
- THM-179 independently confirms THM-137 (no runtime caller of the warm/MRT hooks).

| ID | Theme | Finding | Sev | Cat | Evidence | Proof |
|---|---|---|---|---|---|---|
| THM-151 | thermal-bloom | ~80-120 short-lived allocations every frame: `rigFrame`/`projectToScreen` arrays (writeShimmer, update), 6× `[0,1,2].map` in writeSeasonAir, five `filter()` array rebuilds, a 7-field template-string cache key in `eyeHeatCap`, per-frame closures | Med | Perf | VERIFIED (presence; count estimated) | `thermal-bloom/thermal-bloom-world.js:2850` `const c = [0, 1, 2].map((i) => lerp(...))`; `thermal-bloom/thermal-bloom-core.js:771` `position: [0, rig.height, 0],`; `thermal-bloom-world.js:2161` `` `${this.aspect}\|${card.x0}\|...` ``; `:1484` `this.blooms = this.blooms.filter(...)` |
| THM-152 | all 8 (thermal-bloom, forest, lunara, cinder-drift, murmuration, fluid-dreams, astral-weave, nimbus-veil) | Frame delta clamped to 0.05 s: under `window.isRenderingReduced` (10 fps) every 100 ms frame advances the clock 50 ms, so the scene runs at half speed while rendering is reduced | Low | Bug | VERIFIED | `thermal-bloom/thermal-bloom-theme.js:69` `const MAX_DELTA_S = 0.05;` / `:624` `Math.min(MAX_DELTA_S, ...)`; same in `forest/forest-theme.js:552`, `lunara/lunara-theme.js:569`, `cinder-drift/cinder-drift-theme.js:562`, `fluid-dreams/fluid-dreams-theme.js:561`, `astral-weave/astral-weave-theme.js:553`, `murmuration/murmuration-theme.js:779`, `nimbus-veil/nimbus-veil-theme.js:416` |
| THM-153 | thermal-bloom, forest, lunara, cinder-drift, fluid-dreams, astral-weave, murmuration | Every settings change is handled twice (bus `SETTINGS_CHANGED` and window `settingsChanged` both call the handler) | Low | Improvement | VERIFIED | `thermal-bloom/thermal-bloom-theme.js:388` `eventBus.on(EVENTS.SETTINGS_CHANGED, (p) => this.handleSettingsChanged(p))` + `:394` `this.registerEventListener(window, 'settingsChanged', ...)`; `forest/forest-theme.js:387,389`; `murmuration/murmuration-theme.js:405,414` |
| THM-154 | thermal-bloom | Each lock allocates a few hundred small arrays (29-heading search via `projectToScreen`, outline probes) | Low | Perf | VERIFIED | `thermal-bloom/thermal-bloom-world.js:1377-1382` `for (let deg = -70; deg <= 70; deg += 5) { ... const p = screen(...)` |
| THM-155 | forest (STARTER) | Reduced motion reads only the OS media query — never the in-game `settings.reducedMotion` — and only zeroes the pointer lean (fireflies, sway, waves, meteors, figures unchanged) | Med | Bug | VERIFIED | `forest/forest-theme.js:401-403` `const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)'); ... this.reducedMotion = motionQuery?.matches === true;` (no other `reducedMotion` read in `src/themes/forest`) |
| THM-156 | forest (STARTER) | 2400-3600 fireflies simulated on the CPU every frame, then all three instance buffers (incl. the 56% dark reserve, ≈115-173 KB) and the light-field texture re-uploaded every frame | Med | Perf | VERIFIED | `forest/forest-fireflies.js:208-213` `this.places.needsUpdate = true; this.glows.needsUpdate = true; this.velocities.needsUpdate = true;` (called every frame from `:226`); `forest/forest-light-field.js:85` `this.dirty = true;` in `commit()` |
| THM-157 | forest (STARTER) | `forestGroundHeight` allocates two `{s,d}` objects per call (via `forestRide`); it runs per live spark per frame in `step` and `shed` → thousands of objects per frame during combos/figures unless V8 scalar-replaces them | Med | Perf | PLAUSIBLE (measure allocation rate in a 6+ combo) | `forest/forest-plan.js:29` `return { s: dx * AXIS_X + dz * AXIS_Z, d: ... };`; `forest/forest-firefly-sim.js:363` `const floor = this.groundHeight(this.x[i], this.z[i]);` |
| THM-158 | forest (STARTER) | Reactions frame object graph (spread + `filter().map(e => ({...e}))`) built twice per frame and spread a third time by the world | Low | Perf | VERIFIED | `forest/forest-theme.js:554-555` `this.reactions?.update(dt); const frame = this.reactions?.getFrame();`; `forest/forest-reactions.js:574-577`; `forest/forest-world.js:233` `light.update(time, dt, { ...frame, front: env.front });` |
| THM-159 | forest (STARTER) | The 12-file asset pack (10 tree GLBs, foliage, props, impostor PNG, moon JPG) is re-fetched and re-parsed on every start — quality change, fallback-to-Forest, switch back; `assetManager` unused | Low | Improvement | VERIFIED | `forest/forest-assets.js:203` `loader = new GLTFLoader()` default per call; `:208-217` `await Promise.all([loader.loadAsync(FOREST_FOLIAGE_URL), ...])`; called from `forest/forest-theme.js:304-306` on every `createScene` |
| THM-160 | lunara, cinder-drift, fluid-dreams, astral-weave | A quality rebuild (or WebGPU-loss recovery) mid-run restarts the world clock at 0 and the level look at level 1 (palette / weave figure) until the next LEVEL_UP; thermal-bloom's shell carries both | Low | Bug | VERIFIED | `lunara/lunara-theme.js:250` `this.time = this.flags.time ?? 0;` + `lunara/lunara-world.js:188-189` `this.level = 1; this.paletteIndex = 0;`; same shell line in cinder-drift/fluid-dreams/astral-weave (`astral-weave/astral-weave-theme.js:243`); contrast `thermal-bloom/thermal-bloom-theme.js:288-294` |
| THM-161 | lunara, cinder-drift, fluid-dreams, astral-weave, murmuration (+8 other themes sharing the director) | Lunara-family director delivers staged events with no try/finally: a sink that throws leaves the slot pending, it is re-delivered every frame, and after 3 consecutive errors `safeAnimate` stops the loop (frozen frame). The thermal-bloom family fixed this | Low | Bug | VERIFIED (mechanism; needs a throwing sink) | `lunara/lunara-director.js:397-422` `sink.lock(c); ... sink.clear(c); } clearPending(slot);`; `murmuration/composition/play-director.js:394-419`; contrast `thermal-bloom/thermal-bloom-director.js:717-721` `try { this.deliver(...) } finally { clearPending(slot); }` |
| THM-162 | lunara, cinder-drift, fluid-dreams, astral-weave, thermal-bloom (+ themes outside B4) | Gameplay directors duplicated: 13 themes carry a renamed-but-identical copy of `lunara-director.js` (chromatic-impasto, cinder-drift, fluid-dreams, galaxy, geode, ice-temple, neon-district, solar-eclipse, starlight, supernova, tornado, voltage-storm), ~20 more differ by <100 lines; a second 817-line family is identical in thermal-bloom, high-coast, kaleidosonic, painted-ages, pyrestorm, rainbark. The theme shells (renderer init, GPU recovery, settings readers, layout re-reads, calm zones, pointer, reduced motion) differ by 66-170 lines of ~720. Candidate `shared/gameplay-director.js` + a shared overhaul shell | Low | Improvement | VERIFIED (normalised diff counts) | `diff lunara-director.js cinder-drift-director.js` → 2 renamed lines of 445; `lunara-theme.js` vs `fluid-dreams-theme.js` 66 changed lines |
| THM-163 | cinder-drift | Every spatter emit flags all four pool attributes for a full re-upload (256 KB High, 512 KB Extreme); the chamber's ambient beats emit 4-10×/s with no gameplay (spray every 0.25 s, drips every 0.2 s, streams every 0.5 s) | Med | Perf | VERIFIED | `cinder-drift/cinder-drift-fx.js:169-172` `names.forEach((name) => { geometry.getAttribute(name).needsUpdate = true; });`; `cinder-drift/cinder-drift-world.js:792-797` (spray beat, `SPRAY_BEAT = 0.25` `:106`) |
| THM-164 | cinder-drift | Spatter emit allocates 4-5 arrays per drop (≈1000 in a hard-drop frame) | Low | Perf | VERIFIED | `cinder-drift/cinder-drift-fx.js:162-167` `aBirth.set([x + sx, y, z + sz, ...], i * 4); ... const c = rgb \|\| [1, 1, 1];` |
| THM-165 | cinder-drift | Each heat stamp rebases the whole 192² field and the next frame converts all 36 864 texels to half floats and uploads them | Low | Perf | VERIFIED | `cinder-drift/cinder-drift-heat.js:41` `for (let i = 0; i < data.length; i++) data[i] *= k;`; `cinder-drift/cinder-drift-tsl.js:333` `half[i] = THREE.DataUtils.toHalfFloat(data[i]);` |
| THM-166 | murmuration | WebGL2 fallback steps 45k (High) - 90k (Extreme) motes on the main thread every frame and re-uploads ~2.2-4.3 MB of instance attributes per frame | Med | Perf | VERIFIED | `murmuration/sim/fluid-particles.js:72-74` `High: { count: 45000 ...}, Extreme: { count: 90000 ...}`; `:769-771` `this.positionBuffer.needsUpdate = true; this.velocityBuffer.needsUpdate = true; this.colorBuffer.needsUpdate = true;` |
| THM-167 | murmuration | Camera event reactions decay by fixed per-frame factors (×0.92, lerp 0.14) and the shake uses per-frame `Math.random()`: lock/clear/vertigo punches last ~2.4× shorter at 144 Hz than at 60 Hz and change with the Target Frame Rate | High | Bug | VERIFIED | `murmuration/composition/camera-director.js:171-172` `this._eventOffsetTarget.multiplyScalar(0.92); this._eventOffset.lerp(this._eventOffsetTarget, 0.14);`; `:180-181`; `:213-216` |
| THM-168 | murmuration | Scene pass uses MRT (output + emissive) on Medium+ WebGPU but the theme does not override `usesMrtScenePass()` (base returns false) — latent: nothing calls the hook at cde601f8 | Low | Bug | VERIFIED | `murmuration/post/render-pipeline.js:168` `scenePass.setMRT(withEmissiveMaterialBlending(mrt({ output, emissive })));`; no override in `murmuration/murmuration-theme.js`; `base-theme.js:415-417` |
| THM-169 | murmuration | No OS reduced-motion change listener (OS toggle seen only at the next settings event); reduced motion only stills the camera, the swarm/waves/flashes are unchanged | Low | Bug | VERIFIED | `murmuration/murmuration-theme.js:436-438` `window.matchMedia('(prefers-reduced-motion: reduce)')` read inside `_applyReactionSettings` only |
| THM-170 | murmuration | `window.murmuration` debug API is installed on every build in production | Low | Improvement | VERIFIED | `murmuration/murmuration-theme.js:330` `if (this.fluidSim) this._installDebugHelper();` → `:601` `window.murmuration = { shape: ..., ... }` |
| THM-171 | murmuration | Runtime tier change rebuilds the sim on the live renderer, but `FluidParticleSim.dispose()` only nulls references, so the old storage buffers (up to ~8 MB at Extreme) are released only when GC collects them | Low | Bug | PLAUSIBLE (GPU memory after 3 tier changes) | `murmuration/sim/fluid-particles.js:982-987` `dispose() { this.computeNode = null; this.positionBuffer = null; ...`; rebuild `murmuration/murmuration-theme.js:365-383` |
| THM-172 | fluid-dreams | Liquid shader nests a JS-unrolled 4-group `If` + inner `Loop` chain inside the march `Loop` inside the bounce `Loop` (expanded twice) — the DXC/D3D12 compile-time-pole shape | Low | Perf | PLAUSIBLE (measure first compile at Extreme) | `fluid-dreams/fluid-dreams-liquid.js:364-374` `for (let g = 0; g < GROUP_COUNT; g += 1) { ... If(..., () => { ... Loop({` called from the march loop at `:503` and again at `:557` |
| THM-173 | fluid-dreams | Steady small per-frame allocations in the choreography (kin colour/body arrays, a closure, satellite colour arrays) | Low | Perf | VERIFIED | `fluid-dreams/fluid-dreams-choreography.js:706` `const c0 = mix3([0, 0, 0], palette.inkB, WHITE, 0.45);`; `:710` `const bodies = [`; `:608` `const hue = [palette.inkA, palette.inkB, palette.sun][j % 3];` |
| THM-174 | astral-weave | If the dust compute compile fails or times out, a new closed-form dust material is built and compiled during play | Low | Perf | VERIFIED (failure path only) | `astral-weave/astral-weave-world.js:246-248` `dust.dispose(); this.dust = createDust(this.shared, Math.min(dust.count, DUST_STATIC_MAX), false); this.loomGroup.add(this.dust.mesh);` |
| THM-175 | nimbus-veil | Reduced motion is not read at all (neither OS query nor in-game setting): camera drift, pointer parallax, sparkle bursts and sun pulses run unchanged | Med | Bug | VERIFIED | grep `reducedMotion\|prefers-reduced-motion` in `src/themes/nimbus-veil` → no hit; `nimbus-veil/nimbus-veil-world.js:243-247` drift + parallax applied unconditionally |
| THM-176 | nimbus-veil | No settings subscription: Effect Quality changes are ignored until the theme restarts, render scale applies only at the next resize/DRS step, `pieceLockRipple` is never consulted | Med | Bug | VERIFIED | `nimbus-veil/nimbus-veil-theme.js:136` `this.currentQuality = this.getGraphicsQuality();` (createScene only); `:347-375` subscribes only PIECE_LOCK/LINE_CLEAR/COMBO/LEVEL_UP + pointer/resize |
| THM-177 | nimbus-veil | Bus `COMBO` (cascade depth per mode code, e.g. `SinglePlayerMode.js:1224-1233`) is used as the combo count, so true chains never earn the combo burst; handlers also run while the theme is paused | Low | Bug | VERIFIED | `nimbus-veil/nimbus-veil-theme.js:353-354` `eventBus.on(EVENTS.COMBO, (data) => { if (reactive()) this.world?.onCombo(data?.comboCount ?? 0);`; `:345` `const reactive = () => this.isActive && window.settings?.backgroundComboEffects !== false;` |
| THM-178 | nimbus-veil | Sparkle spawns add one update range per instance per attribute; three r186 issues one `writeBuffer` per range (no merging), so a 220-sparkle burst frame makes ~880 16-byte writes (the code comment assumes ranges merge) | Low | Perf | VERIFIED | `nimbus-veil/nimbus-veil-fx.js:49-52` `/** ... ranges merge per frame in three */ ... attr.addUpdateRange(index * attr.itemSize, attr.itemSize);` (4× per sparkle `:254-257`); `node_modules/three/src/renderers/webgpu/utils/WebGPUAttributeUtils.js:241-269` |
| THM-179 | batch-wide (contract) | `getWarmupRoots()` and `usesMrtScenePass()` are defined on BaseTheme and overridden by themes, but nothing in `src/` calls them at cde601f8 (the documented prewarm sweep consumer does not exist; `shared/warm-hidden-drawables.js` is imported only by black-hole) — the contracts are untested and their values unverified | Low | Improvement | VERIFIED | `grep -rn "usesMrtScenePass\|getWarmupRoots" src` → only definitions (`base-theme.js:400, 415` and theme overrides); `grep -rn "warm-hidden-drawables" src` → `black-hole/black-hole-theme.js:16` only |

#### Batch B6 — high-coast, ocean, halcyon-apex, aether-tides, stellar-drift, nebula-flow, misty-lake, neon-dusk, moonlit-forest

3 High, 15 Med, 29 Low, no Critical. The coordinator re-read all three Highs:

- **THM-180 (misty-lake), refined:** the theme file never reads `shouldRenderFrame`,
  `isRenderingPaused` or `document.hidden`, and its loop re-queues itself
  (`misty-lake-theme.js:1820`). A hidden tab still stops it, because `main.js:1251` calls
  `theme.pause()`, which cancels the registered frame. What it really bypasses is the **Target
  Frame Rate cap** (it renders every vsync: 165/s on this panel) and **`isThemeCovered`** (it keeps
  rendering under the breathing guide).
- **THM-181 (misty-lake):** `createRipple()` / `createMistBurst()` build a new `PlaneGeometry` +
  `ShaderMaterial` per event (`misty-lake-theme.js:2078-2100`, from locks, clears and pointer
  moves).
- **THM-182 (moonlit-forest):** the quality/AA handler gates on `isActive` only
  (`moonlit-forest-theme.js:417`) and `createScene()` ends in `startAnimationLoop()` (`:244`), so a
  change made while paused starts rendering behind the menu.

misty-lake is still on the legacy `WebGLRenderer` + `EffectComposer` + GLSL stack (THM-219), and it
and neon-dusk read no reduced-motion input at all (THM-191, THM-190). THM-183 to THM-186 are four
more instances of the fleet-wide resume/rebuild race (THM-93); ocean and halcyon-apex carry the
guard. THM-188 adds a fleet-wide note: the Electron desktop scaler changes the global render scale
(`main.js:1030-1037`) without an event any theme listens to.

| ID | Theme | Finding | Sev | Cat | Evidence | Proof |
|---|---|---|---|---|---|---|
| THM-180 | misty-lake | Own rAF loop never calls `shouldRenderFrame()`: renders while `window.isRenderingPaused` / `isThemeCovered`, ignores 10 fps reduced mode and the Target-Frame-Rate cap (full vsync, e.g. 240 Hz) | High | Bug | VERIFIED | `src/themes/misty-lake/misty-lake-theme.js:1835` `if (!this.isActive \|\| this.isPaused) {` ; `:1820` `requestAnimationFrame(() => this.animate(frameToken))` ; `:1894` `this.startRenderLoop();` (no shouldRenderFrame/safeAnimate in file) |
| THM-181 | misty-lake | Ripples/mist bursts allocate a new PlaneGeometry + ShaderMaterial per event (40% of locks, ≤9 per clear, ≤20/s from mousemove) and dispose on expiry; when the last one goes three destroys the GL program, so the next event recompiles/links GLSL mid-play. `lightBurst` parked `visible=false`, no warm roots | High | Perf | VERIFIED (mechanism) | `src/themes/misty-lake/misty-lake-theme.js:2087-2090` `const geometry = new THREE.PlaneGeometry(size, size); ... const material = new THREE.ShaderMaterial({` ; `:2120` `ripple.material.dispose();` ; `node_modules/three/src/renderers/webgl/WebGLPrograms.js:651-661` `if ( -- program.usedTimes === 0 ) { ... program.destroy();` ; `:1555` `this.lightBurst.visible = false;` |
| THM-182 | moonlit-forest | Effect Quality / AA change while the theme is paused: the window `settingsChanged` handler (gated on `isActive`, which stays true when paused) runs `createScene()`, which starts a fresh safeAnimate loop → renders behind the settings menu | High | Bug | VERIFIED (trace) | `src/themes/moonlit-forest/moonlit-forest-theme.js:417-418` `if (this.isActive && (hasAntialiasChange \|\| (hasQualityChange && nextQuality !== this.quality))) { this.createScene()` ; `:244` `this.startAnimationLoop();` ; `src/themes/base-theme.js:1356` `if (!this.isActive) return;` |
| THM-183 | high-coast | Tier change while suspended: `resume()` queues a rebuild that disposes the renderer the manager's `_ensureThemeRendering` captured → no frame on it within 700 ms → manager rebuilds the theme a second time (two full builds incl. PNG decode) | Med | Bug | VERIFIED (trace) | `src/themes/high-coast/high-coast-theme.js:732-735` `if (this.rebuildPending) { this.rebuildPending = false; this.queueRebuild(); }` ; `src/themes/theme-manager.js:2063` `const renderer = themeInstance?.renderer;` ; `:2094-2097` `if (!rendered && this.activeTheme === themeInstance && !this.isTransitioning) { ... await this.activateThemeInstance(` |
| THM-184 | aether-tides | Same resume/queueRebuild double-rebuild as THM-183 (ocean/halcyon return false instead; halcyon-apex-theme.js:657-662 documents the bug) | Med | Bug | VERIFIED (trace) | `src/themes/aether-tides/aether-tides-theme.js:664-667` `if (this.rebuildPending) { this.rebuildPending = false; this.queueRebuild(); }` |
| THM-185 | stellar-drift | Same resume/queueRebuild double-rebuild as THM-183 | Med | Bug | VERIFIED (trace) | `src/themes/stellar-drift/stellar-drift-theme.js:667-670` `if (this.rebuildPending) { this.rebuildPending = false; this.queueRebuild(); }` |
| THM-186 | nebula-flow | Same resume/queueRebuild double-rebuild as THM-183 | Med | Bug | VERIFIED (trace) | `src/themes/nebula-flow/nebula-flow-theme.js:688-691` `if (this.rebuildPending) { this.rebuildPending = false; this.queueRebuild(); }` |
| THM-187 | neon-dusk | Own DRS judges the interval between RENDERED frames; under reduced rendering (10 fps) every 100 ms interval reads as overload → scale sinks to 0.7, then 6 resize steps (MSAA scene RT, bloom chain, reflector RT re-allocations) on recovery | Med | Bug | VERIFIED | `src/themes/neon-dusk/neon-dusk-theme.js:415` `const wallDelta = this.lastFrameTime === null ? 1 / 60 : Math.max(0, (t - this.lastFrameTime) / 1000);` ; `:473-481` `if (!(ms > 0) \|\| ms > 250) return; ... if (drs.emaMs > expected * 1.3) next = Math.max(drs.minScale, drs.scale - 0.05);` ; `src/themes/base-theme.js:1298-1311` |
| THM-188 | neon-dusk | Own DRS multiplies with the global render scale (PERFORMANCE_DOWNSCALE one-shot + Electron desktop-policy DRS) and the theme has no SETTINGS_CHANGED listener: global changes land only at its next own DRS step / window resize, or compound (floor 0.5 × 0.7 = 0.35× DPR cap). The desktop policy emits no theme event at all | Med | Improvement | VERIFIED (mechanism) / PLAUSIBLE (oscillation) | `src/themes/neon-dusk/neon-dusk-theme.js:451-453` `const scale = this.dynamicResolution.enabled ? this.dynamicResolution.scale : 1.0; return Math.max(0.25, Math.round(this.getEffectivePixelRatio() * scale * 100) / 100);` ; `src/main.js:1030-1037` `setGlobalRenderScale(policy.renderScale); ... this.webglRenderer.resize();` |
| THM-189 | neon-dusk | Burst pixels add one update range per attribute per pixel; on WebGPU r186 each range is its own `device.queue.writeBuffer` (only WebGL merges) → ~1,200 writes on a tetris frame; the code comment assumes merging | Med | Perf | VERIFIED (three source) / PLAUSIBLE (cost) | `src/themes/neon-dusk/neon-dusk-fx.js:49-52` `/** Mark one instance dirty (ranged upload; ranges merge per frame in three). */ ... attr.addUpdateRange(index * attr.itemSize, attr.itemSize);` ; `node_modules/three/src/renderers/webgpu/utils/WebGPUAttributeUtils.js:241-262` `for ( let i = 0, l = updateRanges.length; i < l; i ++ ) { ... device.queue.writeBuffer(` |
| THM-190 | neon-dusk | No reduced-motion support (camera glide drift + parallax, VHS glitch, bursts always full) | Med | Bug | VERIFIED | grep `reducedMotion\|prefers-reduced` in `src/themes/neon-dusk` → none ; `src/themes/neon-dusk/neon-dusk-world.js:345-350` `const driftX = Math.sin(t * 0.05) * 1.4 + ...` |
| THM-191 | misty-lake | No reduced-motion support at all (neither OS query nor in-game setting) | Med | Bug | VERIFIED | grep `reducedMotion\|prefers-reduced` in `misty-lake-theme.js` → none ; `src/themes/misty-lake/misty-lake-theme.js:2019-2027` camera breath always applied |
| THM-192 | moonlit-forest | Reduced motion reads only the OS query (ignores `settings.reducedMotion`) and only damps event pulses (×0.45) | Med | Bug | VERIFIED | `src/themes/moonlit-forest/moonlit-forest-theme.js:382` `return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 0.45 : 1;` |
| THM-193 | misty-lake | Frame-rate-dependent per-frame decays and bird motion (144 Hz: glows fade 2.4× faster, birds fly 2.4× faster) | Med | Bug | VERIFIED | `src/themes/misty-lake/misty-lake-theme.js:2041` `this.targetGlowIntensity *= 0.94;` ; `:2046` `this.bloomBoost *= 0.94;` ; `:1996` `data.x += data.speed * 0.02;` |
| THM-194 | misty-lake | Render scale / adaptive downscale and quality changes ignored until restart (pixel ratio set once, resize never re-applies it, no SETTINGS_CHANGED) | Med | Bug | VERIFIED | `src/themes/misty-lake/misty-lake-theme.js:497` `this.renderer.setPixelRatio(this.getEffectivePixelRatio());` ; `:2261-2274` `onWindowResize()` (no setPixelRatio) |
| THM-195 | misty-lake | `mousemove` raycasts the 30.7k-triangle water mesh per pointer event, ungated by isActive/isPaused (also runs behind menus, adding ripples to the paused scene) | Med | Perf | PLAUSIBLE | `src/themes/misty-lake/misty-lake-theme.js:2276-2287` `onMouseMove(event) { if (!this.water \|\| !this.camera) return; ... const intersects = this.raycaster.intersectObject(this.water);` ; `:958` `new THREE.PlaneGeometry(160, 90, 192, 80)` |
| THM-196 | halcyon-apex | Every frame `crystals.place()` writes each crystal with an array literal (~60 arrays/frame) and re-uploads the whole attribute | Med | Perf | VERIFIED | `src/themes/halcyon-apex/halcyon-apex-crystals.js:325` `aPos.set([x, y, z, yaw], i * 4);` ; `:330` `posAttr.needsUpdate = true;` ; `src/themes/halcyon-apex/halcyon-apex-world.js:1005` `this.placeCrystals(dt);` |
| THM-197 | high-coast | Clears run up to ~117 synchronous CPU heightfield ray marches inside the frame (`drainMist` 8+3·step `waterSite` calls, each ≤28 rays × ≤466 march steps + bisection) | Med | Perf | PLAUSIBLE | `src/themes/high-coast/high-coast-world.js:593-595` `const count = Math.round(8 + step * 3); for (let i = 0; i < count; i++) { const p = this.waterSite(r(), 6 + r() * 13);` ; `:336` `for (let t = near; t < 12000; t += Math.max(1.5, t * 0.012)) {` ; `:402` `for (let k = 0; k < 28; k++) {` |
| THM-198 | high-coast | Motes.spawn allocates 4 temp arrays per mote and re-uploads all four full instanced attributes on any spawn frame (≈440 spawns on a quad+hard-drop frame) | Low | Perf | VERIFIED | `src/themes/high-coast/high-coast-motes.js:145-148` `this.start.set([x, y, z, born], i * 4);` ; `:163` `for (const a of Object.values(this.attr)) a.needsUpdate = true;` |
| THM-199 | high-coast | ~45 small per-frame allocations (array literals into typed-array `.set`, forEach closures, option objects) | Low | Perf | VERIFIED | `src/themes/high-coast/high-coast-fleet.js:380` `sailData.set([b.colour[0], b.colour[1], b.colour[2], clampJs(open, 0, 1)], i * 4);` ; `src/themes/high-coast/high-coast-life.js:193` `flap.set([Math.min(1, bout + lift * 1.5), g.seed, 0, 0], i * 4);` ; `src/themes/high-coast/high-coast-theme.js:677` `this.post.update({ time: this.time });` |
| THM-200 | high-coast | 0.05 s dt clamp halves the theme clock under 10 fps reduced rendering (same pattern in ocean, halcyon-apex, aether-tides, stellar-drift, nebula-flow, neon-dusk adapters) | Low | Bug | VERIFIED | `src/themes/high-coast/high-coast-theme.js:640-642` `: Math.min(MAX_DELTA_S, Math.max(0, (t - this.lastFrameMs) / 1000));` with `:35` `const MAX_DELTA_S = 0.05;` |
| THM-201 | high-coast | Adapter settings helpers (`readSettingUpdate/readSetting/boolSetting/readFlags`) copy-pasted in 42 themes; staged-slot gameplay director re-implemented in 48 `*-director.js` files; ocean/halcyon/aether/stellar/nebula adapters ≈90% identical | Low | Improvement | VERIFIED | `src/themes/high-coast/high-coast-theme.js:86` `function readSettingUpdate(payload, key) {` (identical: ocean-theme.js:113, halcyon-apex-theme.js:94, aether-tides-theme.js:104, stellar-drift-theme.js:109, nebula-flow-theme.js:117) |
| THM-202 | ocean | pool.emit allocates 4 arrays per mote and flags all 4 instanced attributes for full re-upload each emit frame | Low | Perf | VERIFIED | `src/themes/ocean/ocean-fx.js:228` `birth.set([ox, oy, oz, start], o);` ; `:245-249` `aBirth.needsUpdate = true; aMotion.needsUpdate = true; aLook.needsUpdate = true; aMode.needsUpdate = true;` |
| THM-203 | ocean | ~10 small per-frame allocations in world.update/placeGiants (object literal + Object.keys closure, closures, spread per giant, array literal) | Low | Perf | VERIFIED | `src/themes/ocean/ocean-world.js:1052` `const ask = {` ; `:1060` `Object.keys(ask).forEach((key) => {` ; `:936` `const along = (lane, k, side) => passAt(k, { ...lane, side }, this.squeeze, pose);` ; `src/themes/ocean/ocean-core.js:476` `const kinds = ['turtle', 'manta', 'whaleFar'];` |
| THM-204 | halcyon-apex | Shadow-map redraw cadence counts frames: the 4096² pass (Ultra/Extreme every frame, High every 2nd) scales with the target frame rate | Low | Perf | VERIFIED | `src/themes/halcyon-apex/halcyon-apex-world.js:1068-1071` `this.shadowFrames += 1; ... \|\| (every > 0 && this.shadowFrames % every === 0)) this.sun.shadow.needsUpdate = true;` |
| THM-205 | halcyon-apex | Quality rebuild in place resets the theme clock to 0 (slow sky/crystal clocks jump) | Low | Bug | VERIFIED | `src/themes/halcyon-apex/halcyon-apex-theme.js:252` `this.time = this.flags.time ?? 0;` |
| THM-206 | halcyon-apex | sparks/wisps emitters allocate 3-4 arrays per instance and full-reupload their pools | Low | Perf | VERIFIED | `src/themes/halcyon-apex/halcyon-apex-fx.js:242-249` `aBirth.set([x, y, z, time + rand() * stagger], i * 4); ... geometry.getAttribute('aBirth').needsUpdate = true;` |
| THM-207 | aether-tides | Dead `window` `pointerleave` listener (never dispatched at window): parallax never resets when the pointer leaves the page | Low | Bug | VERIFIED | `src/themes/aether-tides/aether-tides-theme.js:381` `this.registerEventListener(window, 'pointerleave', resetPointer, { passive: true });` |
| THM-208 | stellar-drift | Same dead `window` `pointerleave` listener | Low | Bug | VERIFIED | `src/themes/stellar-drift/stellar-drift-theme.js:389` `this.registerEventListener(window, 'pointerleave', resetPointer, { passive: true });` |
| THM-209 | nebula-flow | Same dead `window` `pointerleave` listener | Low | Bug | VERIFIED | `src/themes/nebula-flow/nebula-flow-theme.js:408` `this.registerEventListener(window, 'pointerleave', resetPointer, { passive: true });` |
| THM-210 | aether-tides | Rebuild in place forgets the run's level (palette back to 0) and restarts the clock/fluid | Low | Bug | VERIFIED | `src/themes/aether-tides/aether-tides-theme.js:248` `levelUp: (level) => this.world?.levelUp(level),` ; `:258` `this.time = this.flags.time ?? 0;` |
| THM-211 | aether-tides | Any aspect change re-creates 8 fluid + 3 light half-float RTs and resets the fluid (per distinct grid size while dragging a window edge) | Low | Perf | VERIFIED | `src/themes/aether-tides/aether-tides-fluid.js:531-539` `this.disposeTargets(); ... this.vel = makePair(grid.width, grid.height, 'Aether Tides — velocity');` ; `src/themes/aether-tides/aether-tides-light.js:188-196` |
| THM-212 | aether-tides | Up to 45 separate `renderer.render` submissions per frame for the solver on Extreme (3 steps × (5 + 10 sweeps)) — CPU submit overhead | Low | Perf | PLAUSIBLE | `src/themes/aether-tides/aether-tides-fluid.js:619-624` `this.draw(renderer, this.velocityMaterial, this.vel); ... for (let i = 0; i < this.sweeps; i += 1) this.draw(renderer, this.pressureMaterial, this.pres);` ; `:640` `while (this.debt >= SIM_DT && taken < maxSteps) {` |
| THM-213 | stellar-drift | Ice field clock is closed form `time * motion`: toggling reduced motion teleports every boulder/shard/mote (closed-form phase trap) | Low | Bug | VERIFIED | `src/themes/stellar-drift/stellar-drift-fx.js:242-243` `update(time, _dt, motion = 1) { frame.clock.value = time * motion;` |
| THM-214 | stellar-drift | Five per-frame flush closures + palette phase object | Low | Perf | VERIFIED | `src/themes/stellar-drift/stellar-drift-world.js:954` `const nRipples = this.ripples.flush(t, (e, i) => {` |
| THM-215 | nebula-flow | Reduced motion halves drift but keeps full-strength flashes/kicks (0.85 flash + kick 1 on a quad); stellar-drift zeros them | Low | Improvement | VERIFIED | `src/themes/nebula-flow/nebula-flow-world.js:819-821` `this.flash = Math.max(this.flash, 0.85); this.flashTint = [...this._palette.clusterGlow]; this.kick = Math.max(this.kick, 1);` |
| THM-216 | misty-lake | Gameplay events while paused still schedule timeouts and add ripple/mist meshes (handlers gate on isActive only; effect timeouts not cleared on pause) | Low | Bug | VERIFIED | `src/themes/misty-lake/misty-lake-theme.js:2189` `if (this.isActive && settings?.backgroundComboEffects !== false) {` ; `:2303-2314` `pause()` (no clearEffectTimeouts) |
| THM-217 | misty-lake | THREE.Clock never reset and delta unclamped: the first frame after a restart jumps by the whole idle time | Low | Bug | VERIFIED | `src/themes/misty-lake/misty-lake-theme.js:1840-1841` `const delta = this.clock.getDelta(); this.time += delta;` |
| THM-218 | misty-lake | No WebGL context-loss resilience (never calls `setupRendererResilience`) → black until next switch | Low | Bug | PLAUSIBLE | `src/themes/misty-lake/misty-lake-theme.js:490-508` `initRenderer()` (no resilience hook) |
| THM-219 | misty-lake | Legacy WebGLRenderer + EffectComposer + GLSL stack (house rule: WebGPURenderer + TSL); dead lights; per-instance materials for birds/lanterns/lily pads/reeds | Low | Improvement | VERIFIED | `src/themes/misty-lake/misty-lake-theme.js:26-30` `import * as THREE from 'three'; import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';` ; `:1559-1570` `setupLighting()` |
| THM-220 | neon-dusk | No WebGPU device-loss registration / renderer resilience hooks | Low | Bug | PLAUSIBLE | `src/themes/neon-dusk/neon-dusk-theme.js:174-234` `async initRenderer(...)` (no setupRendererResilience/registerGpuSurface) |
| THM-221 | neon-dusk | Quality tier changes ignored until the next start (read only in createScene) | Low | Bug | VERIFIED | `src/themes/neon-dusk/neon-dusk-theme.js:136` `this.currentQuality = this.getGraphicsQuality();` |
| THM-222 | neon-dusk | 1 s layout poll forces style/layout reads; dead `getSunScreen()`; header still promises god rays the post removed | Low | Improvement | VERIFIED | `src/themes/neon-dusk/neon-dusk-theme.js:296` `watch.interval = setInterval(watch.schedule, LAYOUT_POLL_MS);` ; `src/themes/neon-dusk/neon-dusk-world.js:357` `getSunScreen(camera, out) {` |
| THM-223 | moonlit-forest | `window.matchMedia(...)` + 3 object literals every frame via applyReactiveState | Low | Perf | VERIFIED | `src/themes/moonlit-forest/moonlit-forest-theme.js:562` `this.applyReactiveState();` ; `:536-537` `const intensity = this.getReactiveIntensity(); this.runtime.setReactive({` |
| THM-224 | moonlit-forest | Adaptive downscale (bus-only SETTINGS_CHANGED) not observed; theme listens to window `settingsChanged` only | Low | Bug | VERIFIED | `src/themes/moonlit-forest/moonlit-forest-theme.js:406` `this.registerEventListener(window, 'settingsChanged', (event) => {` ; `src/themes/base-theme.js:64` `eventBus.emit(EVENTS.SETTINGS_CHANGED, { type: 'renderScale', value: newScale });` |
| THM-225 | moonlit-forest | Production theme imports its runtime from `src/playground/effects/`; local quality helpers duplicate `utils/quality.js` | Low | Improvement | VERIFIED | `src/themes/moonlit-forest/moonlit-forest-theme.js:14` `import { create as createMoonlitForestScene } from '../../playground/effects/moonlit-forest-master.effect.js';` |
| THM-226 | moonlit-forest | Stops the shared WebGL surface loop on every build; nothing restarts it in the standalone (non-Phaser) loop configuration | Low | Bug | PLAUSIBLE | `src/themes/moonlit-forest/moonlit-forest-theme.js:201` `this.webglRenderer?.stop?.();` ; `src/rendering/renderer.js:956-968` `stop() {` |

#### Batch B5 — wolfhour, painted-ages, winter, sakura-twilight, sunset, shifting-sands, fall, moonrise-summit, rainy-window, shared fox engine

5 High rows (THM-228 covers two themes), 0 Critical. The coordinator re-read:

- **THM-228, exposure narrowed.** `resolveThemeStartupPolicy` returns
  `preserveSuspendedRuntime: false` in packaged-Windows safe mode (unreachable: first audit BOOT-02)
  **and on packaged Windows before `startupComplete`** (`theme-manager.js:47-61`), which is live.
  Then `suspendThemes()` calls `stop()` instead of `pause()` (`:1825-1831`), and a later
  `start()` skips the release because `runStartAttempt()` only releases an instance that is still
  active or paused (`base-theme.js:196-203`). wolfhour's and moonrise-summit's own `stop()` do not
  tear down, so each mode stop/start in that window leaves a renderer, canvas and scene behind
  (wolfhour also re-subscribes its handlers, so reactions fire twice).
- **THM-229/230 (rainy-window):** no reference to `shouldRenderFrame`, `isRenderingPaused` or
  `isThemeCovered` anywhere in the theme; time advances a fixed `1/60` per frame
  (`rainy-window-theme.js:850,1015`), so at 165 Hz the scene runs 2.75× fast.
- **THM-231 (wolfhour overlay):** the shared WebGL1 overlay hard-codes
  `if (themeName === 'wolfhour')` (`src/rendering/renderer.js:1189`) to add 450 CPU particles;
  this is the one consumer behind first-audit REND-05.

Reduced motion: wolfhour and rainy-window read nothing (THM-232, THM-236); sakura-twilight, fall
and moonrise-summit read only the OS query; painted-ages, winter, sunset and shifting-sands read
both inputs live. THM-244 is a third independent confirmation that `getWarmupRoots()` has no
runtime consumer (winter, sakura and fall declare roots nobody reads). moonrise-summit and
rainy-window are classic `WebGLRenderer` holdouts.

| ID | Theme | Finding | Sev | Cat | Evidence | Proof |
|---|---|---|---|---|---|---|
| THM-227 | wolfhour | Pooled gameplay FX (starBurst/beam/rift/wave/meteor/crash) are parked `visible=false`; the "prewarm" toggles visibility on and off in the same tick (no render between), `compileAsync` skips invisible objects and no `getWarmupRoots()` exists → node build + render-pipeline creation on the first piece lock / line clear / cascade-3 / cascade-5 during play | High | Perf | VERIFIED | `src/themes/wolfhour/wolfhour-theme.js:3305-3308` `effect.visible = true; effect.visible = false;`; `:3216-3218` `effect.visible = false; ... this.scene.add(effect);`; `node_modules/three/src/renderers/common/Renderer.js:3244` `if ( object.visible === false ) return;` |
| THM-228 | wolfhour, moonrise-summit | Restart of a *stopped* instance builds a second renderer/canvas/scene without disposing the first (and wolfhour re-subscribes every bus/pointer handler → doubled reactions; leaks an unremovable `resize` closure). Path: `suspendThemes()` calls `stop()` when runtime reuse is off (packaged-Windows safe mode always, packaged Windows until startup completes), then `resumeThemes()` fully re-activates the same instance; `runStartAttempt()` only releases when active/paused. Accumulates per mode stop/start | High | Bug | VERIFIED | `src/themes/theme-manager.js:1830-1831` `if (!paused) { this.activeTheme.stop(); }`; `src/themes/base-theme.js:197` `if (this.isActive \|\| this.isPaused) {`; `src/themes/wolfhour/wolfhour-theme.js:1460` `this.renderer = selectedRenderer;`, `:1488` `container.appendChild(this.renderer.domElement);`, `:2570` `this.eventUnsubscribers.push(lineClearUnsub, ...)`; `src/themes/moonrise-summit/moonrise-summit-theme.js:383` `const renderer = new THREE.WebGLRenderer({`, `:402` `container.appendChild(renderer.domElement);` |
| THM-229 | rainy-window | Own rAF loop never calls `shouldRenderFrame()` → renders every vsync while `isRenderingPaused` / `isThemeCovered` (breathing guide), ignores reduced-rate mode and the Target-Frame-Rate cap | High | Bug | VERIFIED | `src/themes/rainy-window/rainy-window-theme.js:1117-1119` `if (this.isActive) { this.animationFrameId = requestAnimationFrame(() => this.animate()); }` (no throttle check anywhere in `animate()` `:1012-1120`) |
| THM-230 | rainy-window | Whole simulation is frame-counted: fixed `1/60` s per frame for clock, camera and water plus per-frame decays and random flicker → rain, camera dips and the "3-10 s" lightning run 2.4× fast at 144 Hz, half speed at 30 fps | High | Bug | VERIFIED | `rainy-window-theme.js:1015` `this.time += 1.0 / 60.0;`; `:850` `const deltaTime = 1.0 / 60.0;`; `:1027` `this.targetStormIntensity - 0.003`; `:1039` `this.lightningIntensity *= 0.8;`; `:1076` `this.skyFlashIntensity *= 0.96;` |
| THM-231 | wolfhour | Wolfhour-only content on the shared full-screen WebGL1 overlay: `WebGLRenderer.loadTheme('wolfhour')` adds 6 CPU particle systems / 450 particles (z-index 10 above the theme), stepped per Phaser frame with per-frame physics (dart "20-50 frames"), no pause/covered/reduced-motion gate; removed only by `clearRendererThemeResources()` on switch or by the next theme's `loadTheme`, **not** by wolfhour stop/pause, and explicitly preserved across a normal suspend → keeps drifting in menus over the paused theme | Med | Perf | VERIFIED | `src/rendering/renderer.js:1189` `if (themeName === 'wolfhour') {`; `:412` `Math.random() * 30 + 20; // Dart for 20-50 frames`; `:1028` `renderFrame() {` (no pause check); `src/themes/base-theme.js:256-258` `this.webglRenderer.loadTheme(this.name);`; `src/themes/theme-manager.js:1865-1866` `if (!this.allowSuspendedRuntimeReuse) { this.clearRendererThemeResources();` |
| THM-232 | wolfhour | Reduced motion ignored entirely (neither OS query nor `settings.reducedMotion`): camera pan/breath, shake, ambient meteors every 4-7 s, overlay particles | Med | Bug | VERIFIED | no `reduce`/`matchMedia` in `src/themes/wolfhour/`; `wolfhour-composition.js:21` `const breath = Math.sin(safeTime * ((Math.PI * 2) / 18));`; `wolfhour-theme.js:4096` `if (this.time - this.lastMeteorTime > this.nextMeteorDelay) {` |
| THM-233 | sakura-twilight | Reduced motion reads only the OS query (in-game setting never) and only disables pointer parallax; petals, gusts, fox pounces, shooting stars, lantern flights unchanged | Med | Bug | VERIFIED | `src/themes/sakura-twilight/sakura-twilight-theme.js:339-341` `const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)'); ... this.reducedMotion = motionQuery?.matches === true;`; `:490` `const x = this.reducedMotion ? 0 : this.pointer.sx;` |
| THM-234 | fall | Same as THM-233 (sibling adapter): OS query only, pointer parallax only | Med | Bug | VERIFIED | `src/themes/fall/fall-theme.js:363-365` `const motionQuery = window.matchMedia?.(...); ... this.reducedMotion = motionQuery?.matches === true;`; `:514` `const x = this.reducedMotion ? 0 : this.pointer.sx;` |
| THM-235 | moonrise-summit | Reduced motion: OS query only; and with it already on at start the camera still breathes/sways (`cameraBreatheEnabled` is only cleared on a media-query *change*) | Med | Bug | VERIFIED | `src/themes/moonrise-summit/moonrise-summit-theme.js:956` `this._reducedMotion = this._reducedMotionMQ.matches;` (no `cameraBreatheEnabled` update); `:261` `this.cameraBreatheEnabled = true;`; `:1023` `const breathe = this.cameraBreatheEnabled` |
| THM-236 | rainy-window | Reduced motion ignored: constant camera breathing ±15 u with dives toward the water every 1-8 s, plus full-sky lightning flashes every 3-10 s and on every clear (photosensitivity) | Med | Bug | VERIFIED | no `matchMedia`/`reducedMotion` in `rainy-window-theme.js`; `:861` `const breathY = Math.sin(this.cameraAnimTime * breatheSpeed1 + this.breathingPhase) * 12.0`; `:904` `this.nextDipTime = this.cameraAnimTime + 1 + Math.random() * 7;`; `:226` `color = mix(color, flashColor, lightningFlash * 0.8);` |
| THM-237 | moonrise-summit | Theme's own `visibilitychange` handler writes the BaseTheme lifecycle flag `isPaused`; while hidden `pause()` then no-ops, after showing `resume()` fails its paused guard → manager full restart (depends on listener order) | Med | Bug | VERIFIED (write) / PLAUSIBLE (effect) | `moonrise-summit-theme.js:972-974` `const visHandler = () => { this.isPaused = document.hidden; };`; `src/themes/base-theme.js:1451` `if (!this.isActive \|\| this.isPaused) {` |
| THM-238 | rainy-window | `lightningBolts` grows by 5 on every restart of the same instance (never emptied); later lightning picks bolts from disposed scenes → increasingly invisible lightning | Med | Bug | VERIFIED | `rainy-window-theme.js:695-699` `for (let i = 0; i < 5; i++) { ... this.lightningBolts.push(bolt); }`; `:1157-1160` `this.lightningBolts.forEach((bolt) => { bolt.geometry.dispose(); ...` (array kept) |
| THM-239 | rainy-window | No quality tiers at all: 50 000 rain points, 200 point sprites of 1200-1800 px each running ~4 3-D simplex noises, and a `Water` mirror that re-renders the whole scene every frame, on every tier | Med | Perf | VERIFIED (code) / PLAUSIBLE (GPU cost) | `rainy-window-theme.js:383` `const particleCount = 50000;`; `:488` `sizes.push(1200 + Math.random() * 600);`; `:544` `gl_PointSize = size * (400.0 / -mvPosition.z);` |
| THM-240 | sakura-twilight | 20-70 short-lived objects per frame: `getFrame()` built twice (update's return is discarded), each with envelope spread + `filter().map()` emitter clones; frame re-spread for the light, wind object, fox `filter`s and `attend` objects, 4 `clamp01` closures | Med | Perf | VERIFIED | `sakura-twilight-theme.js:472-473` `this.reactions?.update(dt); const frame = this.reactions?.getFrame();`; `sakura-reactions.js:500` `emitters: this.emitters.filter((emitter) => emitter.active).map((emitter) => ({`; `sakura-world.js:224` `light.update(time, { ...frame, front: env.front });` |
| THM-241 | sakura-twilight | CPU petal simulation of every petal every frame (6000 High / 9000 Extreme) + quaternion rewrite for all petals incl. idle + whole re-upload of 3 instance attributes (240-360 KB/frame) | Med | Perf | VERIFIED (mechanism) / PLAUSIBLE (ms) | `src/themes/sakura-twilight/sakura-petal-sim.js:219` `for (let i = 0; i < this.count; i += 1) {`; `:378-380` `write() { ... for (let i = 0; i < this.count; i += 1) {`; `sakura-petals.js:118-119` `this.sim.step(dt, env); this.markDirty();`; `sakura-quality.js:28` `High: [..., 6000, ...]` |
| THM-242 | sunset | Sustained per-frame allocations: an object per floating lantern + sort comparator, a literal per mote-trail point (16 per light in flight), fresh post-state object with 3 arrays (≈50-250 objects/frame) | Med | Perf | VERIFIED | `src/themes/sunset/sunset-world.js:788-790` `lamps.push({ x: st.x, y: fy, z: st.z, glow: st.glow, rgb: r.rgb, score, });`; `:763` `moteAt({ x: r.fromX, y: r.fromY, z: r.fromZ }, this._to, s, this._mote);`; `:837` `shaftTint: [L.shaft[0], L.shaft[1], L.shaft[2]],` |
| THM-243 | fall | Per-frame allocations as THM-240: frame snapshot built twice, emitter clones, frame spreads for post and light | Med | Perf | VERIFIED | `fall-theme.js:496-497` `this.reactions?.update(dt); const frame = this.reactions?.getFrame();`; `:506` `this.post?.update?.({ ...frame, time: this.time });`; `fall-reactions.js:403` `emitters: this.emitters.filter(...).map(...)` |
| THM-244 | (cross-cutting) winter, sakura-twilight, fall | `getWarmupRoots()` contract (BaseTheme doc: "a theme that declares its FX root gets those pipelines compiled during its masked warm window") has **no consumer** in `src/` — only black-hole calls its own. Winter/Sakura/Fall declare roots that nobody reads (harmless here: Winter self-warms its spirit, Sakura/Fall park nothing), and themes like wolfhour have no working mechanism at all | Med | Bug | VERIFIED (grep `WarmupRoots` over src) | `src/themes/base-theme.js:400` `getWarmupRoots() { return []; }`; `src/themes/black-hole/black-hole-theme.js:481` `const roots = this.getWarmupRoots();`; `src/themes/winter/winter-theme.js:670-672` `const spirit = this.world?.spirit?.mesh; return spirit ? [spirit] : [];` |
| THM-245 | wolfhour | ~3k lines dead at runtime: legacy WebGL branch (`usesNodeMaterials` is always true), every preset disables compute and spirits/ambient are empty stubs (so wolfhour-compute.js never runs), GLSL shader module + EffectComposer/UnrealBloomPass imports unused | Low | Improvement | VERIFIED | `wolfhour-theme.js:623-625` `return this.renderer?.isWebGPURenderer === true;`; `:1669` `if (!this.usesNodeMaterials) {`; `:2396-2397` `createSpirits() { // Removed as per user request`; `:1160-1161` `if (!hasComputeWork) { this.flags.useCompute = false;` |
| THM-246 | wolfhour | Pool growth beyond the warm count builds a fresh NodeMaterial per spawn during play (up to 27 extra starBursts on Extreme) | Low | Perf | PLAUSIBLE | `wolfhour-theme.js:3209-3214` `let effect = pool.pop(); if (!effect) { ... effect = buildFn.call(this);` |
| THM-247 | wolfhour | Prewarm `compileAsync` is fire-and-forget and races the first frame started in the same tick; with the post pipeline on it compiles for the default target rather than the PassNode RT | Low | Perf | PLAUSIBLE | `wolfhour-theme.js:3335` `this.precompileSceneWithTimeout(3000).catch(`; `:1365-1368` `this.runReactivePrewarm(); ... this.startAnimation();` |
| THM-248 | wolfhour | dt clamped to 1/30 s → the scene runs in slow motion below 30 fps (10 fps reduced mode = ⅓ speed) | Low | Bug | VERIFIED | `wolfhour-theme.js:4759` `deltaTime = Math.min(this.clock.getDelta(), 1 / 30);` |
| THM-249 | painted-ages | Motes re-upload all 4 instance buffers whole on every frame with a spawn (rain = every frame; 256 KB/frame at Extreme) and each spawn allocates ~6 objects/arrays | Low | Perf | VERIFIED | `src/themes/painted-ages/painted-ages-motes.js:178` `for (const a of Object.values(this.attr)) a.needsUpdate = true;`; `:156` `this.start.set([x, y, z, born], i * 4);` |
| THM-250 | painted-ages | Each lock/clear ray-marches the height field on the CPU (≤12 sites × ≤9 rays × ~400 steps) inside the frame's `director.flush()` | Low | Perf | PLAUSIBLE | `painted-ages-world.js:324` `for (let t = near; t < 9000; t += Math.max(1.2, t * 0.012)) {`; `:538-539` `for (let s = 0; s < 3 + lines * 2; s++) { const p = this.landSite(...)` |
| THM-251 | winter | Quality change / GPU-recovery rebuild resets the session mid-run: clock to 0, level hour back to the first, chain tracker and fox reset (Painted Ages/Sunset carry this state) | Low | Bug | VERIFIED | `src/themes/winter/winter-theme.js:287-289` `this.time = this.flags.time ?? 0; ... this.world.seek(this.time);`; `:271` `this.director = new WinterDirector({`; `winter-world.js:189-191` `this.level = 1; ... this.hourStep = 0;` |
| THM-252 | winter | Spark `emit()` allocates four array literals per sprite plus options/closures and re-uploads 4 whole instance buffers; the fox's tail stream emits most frames during a chain | Low | Perf | VERIFIED | `src/themes/winter/winter-fx.js:188` `aBirth.set([`; `:205-207` `['aBirth', 'aVel', 'aTint', 'aKind'].forEach((name) => { geometry.getAttribute(name).needsUpdate = true;`; `winter-world.js:1163-1168` tail stream |
| THM-253 | shared fox engine | Per-step allocations: a new blink RNG closure every step and a new `attend` object per call (Winter calls it every frame during the spirit run) | Low | Perf | VERIFIED | `src/themes/shared/fox-mind.js:707` `mulberry32(this.seed + slot * 7919)()`; `:334-336` `this.attending = { x, y, z, until, weight, };` |
| THM-254 | sakura-twilight, fall | Quality change (and GPU recovery) runs a full `start()` including re-fetch/parse of every GLB/PNG asset — multi-second rebuild mid-run | Low | Perf | VERIFIED | `sakura-twilight-theme.js:442` `this.start(this.webglRenderer, {`; `fall-theme.js:466` same; `sakura-assets.js:197-198` `await Promise.all([ loader.loadAsync(SAKURA_BLOSSOM_URL),` |
| THM-255 | fall | CPU leaf simulation (2600 High / 4200 Extreme) + quaternion rewrite of all + 2 attribute re-uploads per frame (half of Sakura's cost) | Low | Perf | VERIFIED (mechanism) / PLAUSIBLE (ms) | `src/themes/fall/fall-leaf-sim.js:208` `for (let i = 0; i < this.count; i += 1) {`; `fall-leaves.js:135-136` `this.sim.step(dt, env); this.markDirty();` |
| THM-256 | fall | Dead `QUALITY_PRESETS` / `qualityPreset` (read only by unit tests); the adapter, stage, reactions, foliage sim and director are 70-94 % copies of Sakura's | Low | Improvement | VERIFIED | `fall-theme.js:29-32` `// Kept only for historical preset readers ... export const QUALITY_PRESETS = Object.freeze({`; diff after name normalisation: theme 80 differing lines of ~1230 |
| THM-257 | shifting-sands | Synchronous CPU dune + shadow-march + rock bake inside `createScene()`; a mid-run quality change rebuilds in place → main-thread long task | Low | Perf | PLAUSIBLE | `src/themes/shifting-sands/shifting-sands-terrain.js:243` `export function bakeTerrainGeometry(field, { tier, shadowDir }) {`; `shifting-sands-theme.js:416` `this.createScene().catch((error) => {` |
| THM-258 | moonrise-summit | Cloud drift is unbounded: position = baseX + drift·t·0.4 wrapped by a single ±180 step → clouds leave the sky for good after ~6-18 min | Low | Bug | VERIFIED | `moonrise-summit-theme.js:1113-1115` `m.position.x = m.userData.baseX + Math.sin(t * 0.05 + i) * 12 + drift * t * 0.4; if (m.position.x > 90) m.position.x -= 180;` |
| THM-259 | moonrise-summit | Runtime quality change never creates/removes the bloom composer or rebuilds the lake grid; aurora/god rays hidden at low tiers compile on reveal | Low | Bug | VERIFIED | `moonrise-summit-theme.js:315-316` `if (this.post) { this.post.updateParams({`; `:869` `if (!this.preset.bloomEnabled) return;` |
| THM-260 | moonrise-summit | `cleanup()` disposes and nulls the WebGLRenderer itself before base cleanup → `forceContextLoss()` never runs (context lives until GC); constructor `resourceProfile = 'heavy-gpu'` is silently overwritten to `light` by the manager (id missing from `HEAVY_GPU_THEME_IDS`) | Low | Bug | VERIFIED | `moonrise-summit-theme.js:1236-1238` `try { this.renderer.dispose?.(); } catch (e) { /* ignore */ } ... this.renderer = null;`; `:207` `this.resourceProfile = 'heavy-gpu';`; `src/themes/theme-manager.js:733` `themeInstance.resourceProfile = getThemeMeta(themeName)?.resourceProfile \|\| 'light';` |
| THM-261 | rainy-window | Event handlers read `data.detail.count` (bus emits `lineCount`/`comboCount` at top level → always 1) and ignore `backgroundComboEffects`/pause; each bolt allocates 2 throw-away materials and the glow child keeps the old bolt path | Low | Bug | VERIFIED | `rainy-window-theme.js:790` `this.triggerLightning(data?.detail?.count \|\| 1);`; `src/events/gameplay-events.js:68` `eventBus.emit(EVENTS.COMBO, { comboCount, ...` ; `rainy-window-theme.js:823` `oldBolt.geometry = newBolt.geometry;` |
| THM-262 | (cross-cutting) wolfhour, shifting-sands, sakura-twilight, fall, moonrise-summit | COMBO's `comboCount` is cascade depth per wave (documented at the emitter), but these themes treat it as a combo: combo-tier reactions (wolfhour meteor showers ≥3 / crashes ≥5, sands spice glow, sakura/fall vortex, moonrise aurora) fire only on cascades | Low | Improvement | VERIFIED | `src/core/game-modes/SinglePlayerMode.js:1224` `// Cascade signal. The payload is cascade DEPTH, not a combo`; `wolfhour-theme.js:3093` `data?.detail?.comboCount ?? data?.comboCount`; `shifting-sands-theme.js:328` `this.world?.onCombo(... d.comboCount ...)`; `moonrise-summit-theme.js:890` `this._onCombo(data?.comboCount ?? 1);` |
| THM-263 | (cross-cutting) painted-ages, winter, sunset, shifting-sands (+38 more themes) | Adapter boilerplate copied into 42 theme classes (`readFlags`, `readSettingUpdate/readSetting/boolSetting`, layout re-read scheduler, renderer create-with-WebGL2-fallback, `disposeRuntime`), plus the same calm-zone/filmic/grain post output in painted-ages/winter/sunset/shifting-sands → candidates `shared/theme-adapter-kit.js`, `shared/post-kit.js` | Low | Improvement | VERIFIED (grep `function readSettingUpdate` → 42 files) | `src/themes/painted-ages/painted-ages-theme.js:86` `function readSettingUpdate(payload, key) {`; `winter-theme.js:106`, `sunset-theme.js:109`, `shifting-sands-theme.js:90` identical |
| THM-264 | moonrise-summit | *(found 2026-10-14, after the audit, while re-checking reduced motion)* The god-ray billboard (Ultra and above) shows hard rectangular edges around the moon. The rays start at uv (0.5, 0.85) and the falloff only reaches zero 0.7 away, so the quad's top edge (0.15 from the origin) and its sides are drawn near full strength. Visible in every moonrise-summit capture of this audit | Med | Bug | VERIFIED (screenshots `rt6b`, `rm1` + shader) | `moonrise-summit-shaders.js:741-747` `vec2 dir = uv - vec2(0.5, 0.85);` … `float falloff = 1.0 - smoothstep(0.0, 0.7, dist);` |
| THM-265 | rainy-window | *(found 2026-10-14, after the audit; fixed the same day)* The "gentle roll" writes `camera.rotation.z` after `camera.lookAt()`, which replaces part of the look rotation instead of rolling about the view axis. The horizon leans by 1-8 degrees as the camera sways (−4.6 degrees at the rest pose) against an intended ±1.4. Fixed with `camera.rotateZ()` | Med | Bug | VERIFIED (three.js computation + screenshots `flash1`, `flash2`) | `rainy-window-theme.js` `updateCameraAnimation()` `this.camera.rotation.z = rollAngle;` |
| THM-266 | (cross-cutting) every theme using the shared camera breath | *(found 2026-10-14, after the audit)* Themes pass `scale: prefersReducedMotion() ? 0 : 1` (or their own flag) to `applyCameraBreath`, so toggling Reduce motion turns the breath fully on or off in one frame. With a subject distance the camera then hops about 2 units. Rainy-window now ramps its scale over 1.5 s; the rest do not | Low | Improvement | VERIFIED (unit measurement in `rainy-window-reduced-motion.test.js` before the ramp) | `src/themes/shared/camera-breath.js` `applyCameraBreath()`; callers listed in the 2026-10-14 header note |



### Theme pipeline (PIPE)

1 High, the rest Med and Low (26 rows). The coordinator re-read PIPE-01:
`suspendThemes()`'s cancel-and-dispose branch matches a pending instance whose `isActive === true`
(`theme-manager.js:1837-1857`), and `BaseTheme.pause()` never clears `isActive`
(`base-theme.js:1449-1469`), so the **second** suspend in boot→menu (`show('start')` after the
pre-intro warm parks) and in exit→menu (`stopCurrentMode` then `show('start')`) disposes a healthy
paused theme. The boot warm is thrown away on every boot that plays the intro, and every re-entry
after a mid-run exit is a cold build.

**Fleet facts from this pass (63 registered themes):**

| Fact | Count / list |
|---|---|
| Loops that bypass the render-throttle contract (first audit's "3 folders") | misty-lake, rainy-window, and the unregistered sky-children-v2. No theme uses `setAnimationLoop(fn)`. |
| Unguarded loop starters that stack on restart (REND-19) | wolfhour, rainy-window, moonrise-summit, cosmic-noir |
| Reduced motion: both the OS query and `settings.reducedMotion`, live | **46** |
| Reduced motion: OS query only | **8**: forest, moonlit-forest, fall, summer, sakura-twilight, verdant-hills, golden-forest, moonrise-summit |
| Reduced motion: neither | **9**: wolfhour, rainy-window, misty-lake, crystal-cave, cosmic-noir, nimbus-veil, neon-dusk, synthwave-sunset, chromadelic-highway |
| Reduced-motion plumbing | none: no BaseTheme/ThemeManager API; each theme reads it through copied helpers; the boot warp and loading overlay read the OS query only |
| Light-profile themes (missing from `HEAVY_GPU_THEME_IDS`) | tornado, voltage-storm, moonrise-summit |

| ID | Area | Finding | Sev | Cat | Evidence | Proof |
|---|---|---|---|---|---|---|
| PIPE-01 | Suspend / prewarm | **A second `suspendThemes()` throws away a parked or suspended theme.** `pause()` never clears `isActive`, so a paused pending theme matches the "in-flight activation" branch and is disposed. Boot: the pre-intro warm parks via `pause()`, then the menu's `show('start')` → `modalShown` → `suspendThemes()` disposes it. That happens on every boot that plays the intro; the deferred warm builds it again about 3.8 s later. Mid-run exit ("Change mode", `_returnToMainMenu`): `stopCurrentMode` suspends (pause → pending), then `show('start')` suspends again → disposed, so the next entry is a cold build and quick resume never runs after the first exit. No unit test covers a double suspend. All 58 theme `pause()` overrides call `super.pause()` and none clears `isActive`. | High | Bug | VERIFIED (trace); confirm with R1 | `theme-manager.js:1837-1843` `this.pendingThemeInstance.isActive === true \|\| …'starting'` → `:1857` `disposeThemeInstance(pendingTheme…)`; `base-theme.js:1449-1469` (pause sets only `isPaused`/`lifecycleState`); `main.js:2934-2945`, `:5119`, `:3202`+`:3227`, `:4274`+`:4311`; `GameModeManager.js:366-368` |
| PIPE-02 | Prewarm race (c) | **The deferred `initial-theme-prewarm` can still fire during a mode entry and rebuild the entered theme hidden.** Its cancel handle is discarded. `prewarmTheme`'s guards can't see an in-flight `resumeThemes` activation: `isTransitioning` is never set there, and `activeTheme` and `themesSuspended` flip only after `start()` returns. The warm's `start()` queues behind the activation's, then runs `stop()` + `releaseManagedGpuResources()` on the fresh visible runtime and rebuilds it with `_prewarmHidden` set. The activation then publishes the theme active, so the overlay lifts on a hidden, rebuilding theme. It is revealed only when the warm loop sees `activeTheme`. If that hidden rebuild fails, the catch skips disposal (`activeTheme === theme`): a `failed` theme behind a hidden container that the manager reports as active. | Med | Bug | VERIFIED (trace) / PLAUSIBLE (timing) R2 | `main.js:849` `this.scheduleDeferredStartupTask('initial-theme-prewarm', …)` (return unused); `theme-manager.js:1541-1544`, `:1593` `theme._prewarmHidden = true`, `:1299-1305`, `:1671`, `:1769`, `:1802`; `base-theme.js:151-158`, `:196-203`, `:231-239` |
| PIPE-03 | Prewarm race (a/b) | **The warm can park (pause) a theme whose visible activation is mid-build.** The warm loop's only guard is `this.activeTheme`, which is published after the activation's `createScene`. If the loop exits (stable, quiet or max-warm) during the rebuild, `pause()` cancels its RAFs and sets `isPaused`. `runStartAttempt` then writes `lifecycleState='running'` but leaves `isPaused=true`, and the manager publishes it as active. Loops that check `isPaused` (e.g. black-hole) never start, and `_ensureThemeRendering` runs only on quick resume, so the theme stays frozen or blank. The parking also flips manager state (`pendingThemeInstance`, `themesSuspended`) mid-activation. | Med | Bug | PLAUSIBLE R3 | `theme-manager.js:1671` `if (this.activeTheme) { exitReason = 'entered'`, `:1778-1791` (pause + publish pending); `base-theme.js:341-348` (checks only generation / `isActive`); `black-hole-theme.js:493` `… \|\| this.isPaused \|\| …) return;` |
| PIPE-04 | Prewarm / mode entry | **Mode entry neither waits for nor aborts a warm, and a warm holds the switch queue.** The warm sets `isTransitioning` but never `switchDrainPromise`, and mode entry awaits only `switchDrainPromise`. A Hub theme pick made during a warm (up to 7 s + 3 s tail, 20 s timeout) waits for the warm's `finally`. It can then switch the theme after the mode has started: dispose first, with no cover. | Med | Bug | VERIFIED (code) / PLAUSIBLE R2 | `theme-manager.js:1581` `this.isTransitioning = true;`, `:1094-1095`, `:1809-1814`; `main.js:2832-2834` `if (tm?.switchDrainPromise)` |
| PIPE-05 | Prewarm (LIFE-08) | **Entering during a warm still discards it.** Container hidden-ness is fixed. Window (a): the queued `start()` rebuilds. Window (b): `resumeThemes` takes the full-activation path for a running hidden instance, and `runStartAttempt` stops and releases it. The manager never adopts the running warm (reveal + `pending=null`). | Med | Perf | VERIFIED | `theme-manager.js:1974-1983`, `:1987-1991` (needs `isPaused`), `:2040-2046`; `base-theme.js:196-203` `this.stop(); … this.releaseManagedGpuResources();` |
| PIPE-06 | Prewarm (legacy path) | **The legacy warm ends with a bare `compileAsync(scene, camera)` sweep that ignores `usesMrtScenePass()`.** That is the documented MRT pipeline-cache poison (black objects). 52 theme folders define `usesMrtScenePass()`, but nothing outside `src/themes` reads it (grep), so the BaseTheme contract has no consumer. It runs with `?themeWarmAsync=0`, when the backend prototype hasn't resolved, on WebGL2 / classic renderers, and when `asyncActive` comes out false because a racing activation swapped the renderer (PIPE-03). | Med | Bug | VERIFIED (code) / PLAUSIBLE (visual) R4 | `theme-manager.js:1708-1714` `!asyncActive && typeof theme.renderer?.compileAsync === 'function' && theme.scene && theme.camera`; `base-theme.js:404-417` "Consumers must skip bare sweeps when this is true" |
| PIPE-07 | Shared overlay (REND-05) | **REND-05 is still open, and the SB-12a "park" doesn't help in production.** Phaser's BackgroundScene calls `renderFrame()` on every capped frame. `renderFrame` clears an `antialias:true` context and does two `getAttribLocation` calls, program binds and uniform writes. It draws nothing for 62/63 themes. `loadTheme`'s `stop()` parks only the internal rAF, which the external loop has already disabled. `addWebGLLayer` / `addCustomParticles` have no callers; only wolfhour has content. | Med | Perf | VERIFIED | `background-scene.js:141-145` `this.webglRenderer.renderFrame();`; `renderer.js:949-951` (start no-op under external loop), `:1056-1068`, `:1278-1283` |
| PIPE-08 | State bleed: render scale | **The module-global render scale has four uncoordinated writers.** (1) The Serenity hub's low-quality mode sets 0.6 and then restores a hard-coded 1.0, wiping the user's or policy scale (0.75 / 1.25 / GPU-health 0.65–0.85) for the session. (2) BaseTheme's adaptive downscaler lowers the scale one way and never writes main's DRS state, so main's next DRS step overwrites it. (3) Main's DRS changes reach the overlay and Odyssey but not the live theme: `persist:false`, so no `SETTINGS_CHANGED` (REND-04). (4) Display settings. On top of that, 7 themes run their own DRS. | Med | Bug | VERIFIED | `SerenityMode.js:311` `setGlobalRenderScale(enabled ? 0.6 : 1.0);`; `base-theme.js:57-66`; `main.js:1030-1041`, `:1088-1111`; `performance-monitor.js:469-473` |
| PIPE-09 | GPU loss | **`monitorWebGPU` reports a normal device destroy as a device loss.** It doesn't filter `reason === 'destroyed'`, unlike three. Any renderer disposed while its monitor is live emits `CONTEXT_LOST {type:'webgpu'}`, and the coordinator runs `recover()` for that label. The coordinator's one-attempt guard resets on every `registerSurface`, and 53 themes re-register on every `createScene`, so loop protection depends on each theme's own flag. `recover()` calls `createScene()` directly, bypassing `start()` serialization and the manager. | Med | Bug | VERIFIED (code) / PLAUSIBLE (trigger) R6 | `gpu-context-resilience.js:91-101` (no reason check) vs three `WebGPUBackend.js:266-268` `if ( info.reason === 'destroyed' ) return;`; `gpu-loss-coordinator.js:66` `{ ...surface, attempts: 0 }`; `aether-tides-theme.js:308-317` |
| PIPE-10 | GPU loss (fleet) | **Six registered themes have no device- or context-loss handling.** neon-dusk, nimbus-veil and synthwave-sunset (WebGPURenderer): three sets `_isDeviceLost` and `render()` returns early, leaving a frozen canvas. misty-lake, moonrise-summit and rainy-window (classic WebGLRenderer, unmonitored): no `CONTEXT_RESTORED` ever names them, so they never rebuild. murmuration monitors without recovering. chromadelic-highway, cosmic-noir and wolfhour use their own `onDeviceLost`. The other 53 register with the coordinator. | Med | Bug | VERIFIED (grep) | `three/src/renderers/common/Renderer.js:898` `if ( this._isDeviceLost === true ) return;`; `gpu-loss-coordinator.js:86-90` (`unhandledWebgpu`) |
| PIPE-11 | Frame pacer (REND-01) | **The pacer caps at the ceiling cadence and reads the wrong clock.** It renders 72/s at 144 Hz, 82.5/s at 165 Hz and doesn't cap at all at 75/90/100 Hz (by design). It doesn't drift (`lastRenderAt = now`). But it uses `performance.now()` at call time, not the rAF timestamp the loop already receives, so exact divisors keep only 0.5 ms of margin. Replay: ±0.8 ms of in-frame jitter → 120 Hz runs at 63.7 fps with mixed 1v/2v gaps (likewise 2v/3v at 180 Hz, 3v/4v at 240 Hz). A 2 ms Phaser step ahead of the theme turns 165 Hz into 60 fps with 2v/3v judder. | Med | Perf | VERIFIED (replay of shipped module) / PLAUSIBLE (real jitter) R7 | `theme-frame-pacer.js:51` `DEADLINE_EPSILON_MS = 0.5`, `:131`, `:136`; `base-theme.js:1323-1327` `performance.now()` vs `:1355` `const loop = (time) =>`; `pacer-replay.txt` |
| PIPE-12 | Reduced motion | **No reduced-motion plumbing.** BaseTheme and ThemeManager expose nothing. The toggle reaches themes only as a window `settingsChanged` event (changed keys) plus a bus `SETTINGS_CHANGED` (full snapshot), which most themes handle twice through 42 copy-pasted helpers. Fleet: 46 read both and re-read on change; 8 read the OS query only; 9 read neither. Boot warp, cinematic overlay, startup-shell fade and cinematic skip read only the OS query, so the in-app toggle doesn't skip the warp. | Med | Improvement | VERIFIED (scripted scan + hand checks) | `settings.js:409-411`, `:454-462`; `boot-warp-transition.js:80` `matchMedia('(prefers-reduced-motion: reduce)')`; `cinematic-loading-overlay.js:410-411`; `main.js:544`, `:4989` |
| PIPE-13 | Device budget | **Peak GPUDevice count isn't governed.** No theme injects a device, so every theme renderer requests its own. Switches overlap two theme devices (dispose deferred up to 300 ms + async r186 `dispose`). Odyssey's warmed device is injected, so three never destroys it and it lives all session. The deferred menu-theme warm can still run during Odyssey once the board is quiet or after 25 s. Odyssey + orb theme + warm = 3, plus switch overlap, plus breathing stage. main.js records that 3 devices already blanked the boot warp. | Med | Perf | PLAUSIBLE R5 | `webgpu-device-warm.js:35-73`; `OdysseyBoardController.js:2448`; `main.js:2596-2600`, `:2693`; `startup-warm.js:49-60`; `base-theme.js:689-697` |
| PIPE-14 | Code quality | **Every theme re-implements pipeline boilerplate** (counts are registered theme folders). Settings helpers 42; reduced-motion query 54; bus + window settings subscription 53 / 56; `VIEWPORT_RESIZED` 52 (on top of `ThemeManager.resize`); WebGPU→WebGL2 renderer `attempt()` 59 (the shared `initializeThemeNodeRenderer` is used by 1); GPU-surface `recover()` 53; quality table + `queueRebuild` 54 / 52; 7 loop-starter names; `gameOver` → `resetSession` 53. Proposed APIs are in `q9-code-quality.md`: `startFrameLoop`, `createNodeRenderer`, `enableGpuRecovery`, `defineQualityTiers`, `onSettingsChanged`, `this.reducedMotion`, `start({hidden})`. | Med | Improvement | VERIFIED (grep counts) | `aether-tides-theme.js:100-123` (helper copy); `shared/node-renderer.js:8` (one user); `base-theme.js:1484-1492` (7 starter names) |
| PIPE-15 | GPU loss (WebGL restore) | **A shared-overlay context restore rebuilds themes that don't use the overlay.** Every started instance listens to `CONTEXT_RESTORED` for the overlay canvas. A restore rebuilds the active theme (a full `createScene` for nothing). It also restarts a suspended theme, which keeps `isActive` true while paused, *visibly* behind the menu while the manager still holds it as pending. The overlay is the oldest context, so it is the first Chromium evicts at its context cap (REND-06). | Low | Bug | PLAUSIBLE R6 | `base-theme.js:266-275` `payload.canvas === this.webglRenderer.canvas … && this.isActive`, `:289` `await this.start(sharedRenderer, …)` |
| PIPE-16 | Throttle bypass | **Two registered themes bypass the throttle contract.** misty-lake and rainy-window render every vsync and ignore `isRenderingPaused`, `isThemeCovered`, reduced mode and the FPS cap. rainy-window also advances time by 1/60 per frame (2.4× speed at 144 Hz) and has an unguarded `animate()`. Unregistered `sky-children-v2` bypasses too. The other 61 use `safeAnimate` (46) or call `shouldRenderFrame` (15). | Low | Perf | VERIFIED | `misty-lake-theme.js:1817-1880`; `rainy-window-theme.js:1015` `this.time += 1.0 / 60.0;`, `:1118`; table in `_status.md` |
| PIPE-17 | Loop restart (REND-19) | **REND-19 is still open; the four unguarded starters are now named.** `restartRenderLoop` calls the first of 7 method names with no idempotency. `safeAnimate` has no re-entry guard, and `registerAnimation` keeps a single slot, so a stacked chain can't be cancelled and survives `pause()` (it checks only `isActive`). main restarts on every visible/focus event even when `resume()` returned false. Unguarded starters: wolfhour `startAnimation`, rainy-window `animate`, moonrise-summit `_startAnimation`, cosmic-noir `animate`. | Low | Bug | VERIFIED (code) / PLAUSIBLE (trigger) R8 | `base-theme.js:1136-1142` `this.animationIds[this.animationIds.length - 1] = id;`, `:1356`, `:1493-1497`; `main.js:1303-1308`; `wolfhour-theme.js:4726`; `moonrise-summit-theme.js:996`; `cosmic-noir-theme.js:3587`; `rainy-window-theme.js:1012` |
| PIPE-18 | Safety net (LIFE-10) | **The 700 ms "no frame drawn" check rebuilds themes that skip frames on purpose.** It fires under `isThemeCovered` (breathing guide) or `isRenderingPaused`. In a hidden tab it waits on rAF with no timeout. On restore it leaves an own, bound `render` property on the renderer. | Low | Bug | VERIFIED (code) / PLAUSIBLE R8 | `theme-manager.js:2077` `renderer.render = (...args) => { rendered = true; …`, `:2085-2088`, `:2090`, `:2094-2097` |
| PIPE-19 | Suspend leak (LIFE-09) | **LIFE-09 is still open and has a second trigger.** Besides the no-reuse profiles, `suspendThemes` falls back to `stop()` whenever `pause()` returns false, e.g. for a theme already paused by minimize ('reduce'). `stop()` keeps renderer, device, scene and bus subscriptions, and the next `start()` skips the release because `isActive \|\| isPaused` is false, so `createScene` orphans the old renderer. | Low | Bug | VERIFIED (code) / PLAUSIBLE (trigger) | `theme-manager.js:1825-1832` `if (!paused) { this.activeTheme.stop(); }`; `base-theme.js:196` `if (this.isActive \|\| this.isPaused) {`; `main.js:1273-1275` |
| PIPE-20 | Async pipelines | **An async-pipeline session can claim a renderer that belongs to a newer instance of its theme.** It owns any canvas inside `#<name>-theme`, so a session still alive for a retired instance (retained warm ≤20 s, mode-entry lease ≤~25 s) claims a fresh identity's renderer. That identity's pipelines then go async with no surface covering them (pop-in), and the in-flight count is credited to the old instance. | Low | Bug | PLAUSIBLE | `async-render-pipelines.js:217-224` `container.contains(canvas)`, `:196-198` |
| PIPE-21 | Throttle writers | **Only minimize/hide and the breathing guide throttle the theme.** It keeps rendering at the full cap under Settings, the pause menu and focus-pause. The reduced gate is naive (8.6 fps at 60 Hz) and is dead for the active theme, because the same writer pauses it. The packaged `'continue'` default is dead: the settings default `'reduce'` wins. | Low | Perf | VERIFIED | `main.js:1155-1156` `settings.backgroundTabBehavior \|\| defaultBehavior`; `settings.js:71`; `base-theme.js:1298-1312`; `main.js:1273-1279`; `breathing-guide.js:401` |
| PIPE-22 | GPU loss | **A second WebGL monitor on the same canvas breaks the first.** `monitorWebGL` dedupes by canvas, but the duplicate gets back an unsubscribe that removes the *first* owner's listeners, and its own handlers are silently dropped. (`monitorWebGPU` dedupes to a no-op instead.) | Low | Bug | VERIFIED (code) | `gpu-context-resilience.js:29-31` `return () => this.unmonitorWebGL(canvas);` |
| PIPE-23 | Manager dead code | **ThemeManager still carries dead machinery.** `deactivateThemeRuntime`, `preloadThemes`, `cleanupTheme` and `update` have no callers. `terminalThemeResourceDisposers` has no implementors (no theme defines `disposeSharedResources`). The adjacent preload serves only the 3 light themes. In practice the LRU bounds init-only instances, and at most one instance is ever started. | Low | Improvement | VERIFIED (grep) | `theme-manager.js:257-269`, `:824-855`, `:2248-2255`, `:2361-2365`, `:233-255`, `:866-869` |
| PIPE-24 | Build | **A dead theme chunk ships.** Unregistered `src/themes/sky-children-v2/` and `shared/sky-core/` (~8.6k lines) still match the manager's `import.meta.glob`, so they ship as a never-imported lazy chunk. | Low | Perf | VERIFIED | `theme-manager.js:162` `import.meta.glob('./**/*-theme.js')`; `dist/assets/theme-sky-children-v2-O4KmWe3v.js` in the worktree's dist |
| PIPE-25 | GPU loss diagnostics | **The loss coordinator's counters are never read.** `getGpuLossStats()` says it feeds the support bundle, but nothing calls it and nothing exposes it on `window`, so the observed-loss counts never leave the coordinator. | Low | Improvement | VERIFIED (grep) | `gpu-loss-coordinator.js:163-166` `export function getGpuLossStats()`; no callers in `src` |
| PIPE-26 | Quality table | **`quality.js` marks `renderScale` LIVE, but nothing reads it** (the REND-13 part is still open). | Low | Improvement | VERIFIED (grep) | `quality.js:7` `LIVE   renderFrameSkip, renderScale, …`; `getRenderScale` has no callers |

#### Prewarm and mode-entry race (recorded 2026-10-03 at `3d50d88e`), re-checked

| Window | State at cde601f8 | Current lines |
|---|---|---|
| (a) entry during the warm's `start()` | Hidden-forever FIXED in d8966f00 (2026-10-08): the activation clears `_prewarmHidden` before its `start()`, which queues and rebuilds visible. Still a full rebuild (PIPE-05), with the parking race (PIPE-03). | theme-manager.js:1226, 1974-1983; base-theme.js:151-158, 196-203, 231-250 |
| (b) entry during the warm's frame loop | Hidden-forever FIXED (same commit + `revealThemeContainer` 1148-1161 used at 1769). Still rebuilds (2040-2046) and can be parked mid-build (PIPE-03). | theme-manager.js:1226, 1671, 1760-1791, 1987-1991, 2040-2046 |
| (c) deferred `initial-theme-prewarm` fires on the same click | OPEN. Handle discarded; guards miss an in-flight resume activation. The warm tears down the just-entered runtime and rebuilds it hidden until 1769 reveals it. A failed hidden rebuild is left hidden (1802). (PIPE-02) | main.js:849-854; theme-manager.js:1541-1544, 1593, 1299-1305, 1671, 1769, 1802; base-theme.js:151-158, 196-203, 231-239 |
| new: second suspend | Boot `show('start')` disposes the parked pre-intro warm; a mid-run exit then `show('start')` disposes the suspended runtime (PIPE-01). | theme-manager.js:1837-1859; main.js:2934-2945, 5119, 3202/3227, 4274/4311 |

#### First-audit pipeline items re-checked at `cde601f8`

| ID | State | Current evidence |
|---|---|---|
| REND-05 empty WebGL1 overlay cleared/MSAA-resolved/composited every capped frame | **OPEN** (and the SB-12a park is ineffective under Phaser's external loop) | background-scene.js:129-151 (`renderFrame()` each capped frame); renderer.js:678-691 (`antialias: true`), 949-951, 1028-1132, 1278-1283; only wolfhour adds content (1189-1274) |
| REND-06 GPU contexts never released | **CHANGED** for the theme pipeline: themes now release (classic `forceContextLoss` base-theme.js:663-668; r186 WebGLBackend `loseContext` WebGLBackend.js:2941-2942; owned WebGPU device destroyed WebGPUBackend.js:3272-3274). Overlay context is app-lifetime (renderer.js:974-1026 never loses it). Non-theme surfaces (local MP) not re-verified here; cosmic exploration was deleted 2026-10-16 and its replacement, the ascent sky layer, is an r186 renderer released by `dispose()`. | base-theme.js:629-717 |
| REND-19 restart-on-visible can stack theme loops | **OPEN**. Four unguarded starters named: wolfhour 4726, rainy-window 1012, moonrise-summit 996, cosmic-noir 3587. A stacked safeAnimate chain survives `pause()`. | main.js:1294-1309; base-theme.js:1136-1142, 1351-1377, 1480-1499 |
| LIFE-04 default settings rebuild the theme mid-run with no cover | **OPEN**; the re-request is FIXED 2026-10-16: Level mode ("As you level up") asks for one switch per 3-level stretch (`level-theme-journey.js` `nextSwitch`) | was SinglePlayerMode.js:942-947 (compares `activeThemeName`, so it re-requests while a switch is in flight); theme-manager.js:1002-1013 (dispose first), 2224-2231 (random interval); main.js:4112 `switchToRandomTheme` callers 2383/3048/3252/3505 |
| LIFE-05 switches can't be preempted (A→B→C builds B) | **OPEN** | theme-manager.js:1093-1125 (drain awaits each switch); no supersession check in 984-1087 / 1163-1312; THEME_CHANGED → music at 1307 / main.js:2746-2761 |
| LIFE-08 entering during the warm throws it away; deferred warm over Odyssey | **CHANGED**: the container is no longer left hidden, but the warm is still discarded (PIPE-05), window (c) is open (PIPE-02), and the warm can still run during Odyssey once the board is quiet or after 25 s | theme-manager.js:1226, 1769, 2040-2046; main.js:849, 2693; startup-warm.js:49-60 |
| LIFE-09 suspend without runtime reuse leaks heavy runtimes | **OPEN**, plus a trigger in the default profile (`pause()` false → `stop()`) (PIPE-19) | theme-manager.js:43-70, 1825-1832, 1865-1867; base-theme.js:196-203 |
| LIFE-10 restart not idempotent; the 700 ms safety net rebuilds themes that skip frames on purpose | **OPEN** (PIPE-17/18) | theme-manager.js:2062-2102; base-theme.js:1480-1499; main.js:1286-1316 |
### Odyssey rendering (ODYR)

#### Core — board controller, camera, chapter/level-node/path managers, warm-up, post, transitions

2 High, 11 Med, 13 Low. The coordinator re-read ODYR-01 (`OdysseyBoardController.js`:
`setupInteraction()` adds the document `wheel` and window `resize` listeners at `:2919-2920` and
runs before the only `_disposed` check in `initialize()`, ~`:1248`) and ODYR-02
(`OdysseyMode.js:2885-2888` joins `_boardBuildPromise`; `_disposeOdysseyBoard`, `:3123-3137`,
never clears it).

- **Device and renderer per entry:** one shared device is reused (the warm device); the renderer,
  canvas and context are recreated per Odyssey activation and reused across level visits. The
  device count does not grow; what a previous entry leaves on the GPU depends on GC and on
  module-cached assets (ODYR-05).
- **Pipelines after reveal:** the default path compiles chapters, One World and the whale through
  the live-loop `compileAsync` path. What still creates pipelines after reveal: the ch7 lens post
  variants in fast-start, the dynamic-resolution sharpen wrapper, and chapters reached by directed
  travel before the background drain warmed them (ODYR-07, ODYR-08).
- **Draw calls are O(1) in level count;** hidden chapters do not draw; per-node vertex work is not
  culled (ODYR-14).
- **GPU timestamps** follow ADR-0016 (one push per resolved query, epoch-guarded,
  `OdysseyBoardController.js:3170-3190`).

| ID | Area | Finding | Sev | Cat | Evidence | Proof |
|---|---|---|---|---|---|---|
| ODYR-01 | Lifecycle | **A board disposed mid-`initialize()` keeps building and is pinned forever** (= first-audit ODY-03, still OPEN). The only `_disposed` check sits after ~15 awaits and AFTER `setupInteraction()`/`_registerPerfMonitorHooks()`; `teardownInteraction()` already ran as a no-op, so the document `wheel` + window `resize` listeners attached afterwards are never removed and retain the whole controller (scene, renderer, path, nodes, One World built after dispose). The warm-up then renders through the disposed post stack (fast-start: 1 sample + 2 variant renders; full mode ~17). | High | Bug | VERIFIED; runtime (Odyssey session, one run): after a mid-build abort the in-flight board logged `Disposed`, and 42 ms later its prewarm still ran and failed (`Shader prewarm failed for corridor field: THREE.WebGPUTextureUtils: Texture already initialized`); after the next exit +47 MB heap and +167 MB GPU-process memory stayed resident against a normal cycle | OdysseyBoardController.js:1220-1221 `this.setupInteraction(); this._registerPerfMonitorHooks();` precede OdysseyBoardController.js:1248 `if (this._disposed) return;`; OdysseyBoardController.js:2919 `document.addEventListener('wheel', …)`; OdysseyBoardController.js:2926 `if (!this.interactionAttached) { return; }` |
| ODYR-02 | Lifecycle (Mode) | **Exit during the board build, then re-enter → map revealed with no board** (= first-audit ODY-02, OPEN). `_disposeOdysseyBoard` never clears `_boardBuildPromise`; the next activation joins the stale promise, and the generation guard is captured after the deactivate already bumped it, so `_revealOdysseyBoard()` runs with `boardController === null`. | High | Bug | VERIFIED (mechanism); runtime: not reproduced with an abort 1.5 s into the build (the re-entry showed a board); timing-sensitive, needs an offset sweep | OdysseyMode.js:2886-2888 `if (this._boardBuildPromise) { await this._boardBuildPromise; return; }`; OdysseyMode.js:3123-3128 (no `_boardBuildPromise = null`); OdysseyMode.js:2835-2840 `const generation = …; await this._buildOdysseyBoard(); if (generation !== …) return false; this._revealOdysseyBoard();` |
| ODYR-03 | Frame pacing | **Map loop ignores Target Frame Rate** (REND-08 part 1, OPEN): rAF every vsync, no frame-interval gate; `targetFrameRate` only feeds the adaptive controller's budget and the perf context. On a 144/240 Hz panel with the default 60 target the board renders 2.4–4× the frames. With Target = Unlimited (0) the adaptive target falls through to the panel refresh, so the ladder sheds resolution/bloom/post to chase 144–240 Hz; its window is 60 *frames* (0.25 s at 240 Hz). The shared pure pacer `src/themes/theme-frame-pacer.js` is not used. | Med | Perf | VERIFIED; runtime: **confirmed**, the board presents 128.9–130.6/s at map idle with Target Frame Rate 60 (rAF ≈ 130/s) | OdysseyBoardController.js:3547 `this.animationFrameId = requestAnimationFrame(() => this.animate());` then `this.renderFrame(delta)` unconditionally (:3562); OdysseyBoardController.js:629/:644/:3149 only consumers; odyssey-performance-utils.js:35-37 candidates `[explicit, url, settings, detectedRefreshRate, …]`; OdysseyAdaptiveQuality.js:29 `DEFAULT_WINDOW = 60` |
| ODYR-04 | Lifecycle (Mode) | **Resume keys off `_boardParked`** (REND-08 part 2 / ODY-19, OPEN). The board is paused at the entry blackout but parked only by a 1.2 s timer; a return inside that window cancels the timer and skips `resumeRendering()` → frozen map. | Low | Bug | VERIFIED | OdysseyMode.js:790 `this.boardController?.pauseRendering?.();`; OdysseyMode.js:844-852 `setTimeout(() => { … this._parkOdysseyBoard(); … }, 1200)`; OdysseyMode.js:3070 `this._cancelBoardParkTimer();` then OdysseyMode.js:3088 `if (this._boardParked) { this.boardController?.resumeRendering?.();` |
| ODYR-05 | Lifecycle / VRAM | **Per-entry GPU residue relies on GC; module-cached assets pin every previous renderer** (= first-audit ODY-05, OPEN). `dispose()` never calls `oneWorld.dispose()` (which frees 5 DataTextures — relief 1024² etc. — and off-scene geometries); the board's scene traverse disposes geometry+material only. On r186 `Renderer.dispose()` just swaps its DataMaps (`this.data = new WeakMap()`) and never destroys textures on an injected device, and per-texture/geometry `dispose` listeners stay attached. So anything that outlives the board (the module-level glTF cache: the whale pass on the default path) is re-uploaded each entry while its listener closures keep each old Textures/Geometries manager → backend (its GPU copies) → renderer → canvas (context never `unconfigure()`d) alive. | Med | Bug | VERIFIED (mechanism) / PLAUSIBLE (magnitude — measure); runtime: GPU-process memory 874 → 1,214 MB on the first entry, then +31 and +14 MB on the next two; heap after exit flat at ~96 MB; device count flat; consistent with per-entry residue, not conclusive in 3 cycles | OdysseyBoardController.js:4593-4699 (no `oneWorld.dispose`); world/odyssey-world-renderer.js:4793 `[heightTex, sunVisTex, groundTex, detailTex, macroTex].forEach((t) => t.dispose());`; three common/DataMap.js:82-86; common/Textures.js:410 `texture.addEventListener( 'dispose', textureData.onDispose );`; webgpu/WebGPUBackend.js:3271-3273 `if ( this.parameters.device === undefined && this.device !== null ) { this.device.destroy();`; composition/odyssey-whale-pass.js:124 `await loadOdysseyGltfCached(url)`, :210 "never disposed here" |
| ODYR-06 | Warm/compile | **Background chapter `create()` (synchronous, ~400 ms) runs while the board is parked mid-level** (= first-audit ODY-04, OPEN). `_canRunBackgroundTask` has no active/paused gate and `frameMsEma` is frozen at the last board frame while parked, so the loader keeps creating chapters 6–8 during level entry/gameplay; the 8 s starvation escape forces a pass even if it were unhealthy. | Med | Perf | VERIFIED | OdysseyBoardController.js:1505-1531 (no `isActive`/`isRenderingPaused` term); OdysseyBoardController.js:1557-1560 EMA updated only in `animate()`; ChapterEnvironmentManager.js:990-996 `if (!canRunTask()) { … } … this.createChapterEnvironment(chapterId)`; ChapterEnvironmentManager.js:745 `const group = def.create(this.qualitySettings);` |
| ODYR-07 | Warm/compile | **Directed travel bypasses the warm pipeline.** `travelToLevel` (orb select, navigator, chapter arrival) awaits an on-demand synchronous chapter create and then flies straight in; the prewarm drain is blocked for the whole flight because `_isScrollIdle()` is false while `cc.isAnimating`, and the travel frontier deliberately excludes `travelToPosition`. A jump to an unwarmed chapter (e.g. ch7/8 within seconds of reveal) therefore creates its pipelines synchronously on visible frames. | Med | Perf | PLAUSIBLE (measure pipelines.sync during a navigator jump) | OdysseyBoardController.js:3461-3473 `await this._requestChapterEnvironment(targetChapter); … await this.cameraController.travelToPosition(…)`; OdysseyBoardController.js:1492 `if (cc.isAnimating) return false;`; OdysseyCameraController.js:1247 `this.isAnimating = true;`; OdysseyCameraController.js:865-870 frontier "never to travelToPosition/focus" |
| ODYR-08 | Warm/compile (post) | **Post variant swaps rebuild the graded post graph on the main thread; ch7 lens variant and the DRS sharpen wrapper compile after reveal.** Every lens/bloom swap sets `outputNode` + `needsUpdate` (r186 RenderPipeline then flags the quad material → full TSL rebuild); fast-start (default) never warms the lens variants, so the first ch7 visit creates the final quad pipeline on a live frame; below DRS 0.95 every base-variant change disposes and rebuilds the RCAS wrapper (new RTT + SharpenNode + quad materials). | Med | Perf | VERIFIED (mechanism) / PLAUSIBLE (cost) | Post:590-595 `this.postProcessing.outputNode = node; … this.postProcessing.needsUpdate = true;`; three RenderPipeline.js:206-207 `fragmentNode = outputNode; …material.needsUpdate = true;`; OdysseyBoardController.js:4145-4155 `{ lensStates: [false], skipActive: true }`; Post:612 `if (slot) OdysseyTslPipeline._disposeSharpenWrapper(slot.node);` |
| ODYR-09 | Warm/compile (ADR-0020) | **The board renderer is outside every ADR-0020 async-pipeline session**, so pipelines its pre-reveal warm-up renders and `warmOutputVariants` still create are synchronous on the GPU-process main thread while the cinematic overlay animates (the freeze ADR-0020 measured). Sessions only own a theme's renderer / adopted renderers / `#<theme>-theme` canvases; only base-theme adopts. | Med | Perf | PLAUSIBLE (measure `unownedSyncDuringSession` + boot-smoothness mode-entry) | rendering/async-render-pipelines.js:154-157 `const s = sessionFor(backend); if (s === null) { diagnostics.unownedSyncDuringSession += 1; return original.call(backend, renderObject, null);`; :217 `owns(r)`; themes/base-theme.js:790 `adoptRendererForTheme(this, renderer)` (sole caller); OdysseyBoardController.js:4035 `this.renderFrame(1 / 60);` |
| ODYR-10 | Frame pacing | **Odyssey map ignores the app's hidden/minimised pause policy** (= REND-09 for the map, OPEN). main.js calls `currentMode.pauseRendering()` — OdysseyMode has none — and the board never reads `window.isRenderingPaused`/`isRenderingReduced`; with `backgroundThrottling:false` the map keeps rendering minimised. Background warm work also treats `document.hidden` as "healthy". | Med | Perf | VERIFIED (code path) | main.js:1256-1258 `if (currentMode?.pauseRendering) { currentMode.pauseRendering(); }`; grep: no `pauseRendering(` method in Mode; electron/main.js:586 `backgroundThrottling: false`; OdysseyBoardController.js:1501 `if (… document.hidden) return true; // nothing to stutter` |
| ODYR-11 | Settings | **Quality read once; user Render Scale never reaches the board; no settings subscription** (= first-audit ODY-12, OPEN). | Med | Bug | VERIFIED | OdysseyBoardController.js:752 `const quality = window.settings?.effectQuality \|\| 'High';` (initialize only); OdysseyBoardController.js:2428-2438 `computeScenePixelRatio({ renderScale: this._drs.renderScale, …})` (DRS scale, starts 1 :623-626); utils/desktop-performance-policy.js:170-180 never reads `settings.renderScale` |
| ODYR-12 | reducedMotion | **Reduced motion only removes camera breathing and the ch7 fall.** Idle auto-drift (ODY-26, OPEN), the journey-end ARRIVAL SHOT (24° orbit + push-in after 1.2 s idle), seam forward lean/vista pull-back, the ch5 lift/pan shots and the ch8 crane all still play. Setting + live OS query are read correctly. | Med | Bug (a11y) | VERIFIED | OdysseyCameraController.js:1603-1608 `if (this.prefersReducedMotion()) { this._breathWeight = 0; …}`; OdysseyCameraController.js:524-526 ch7 only; OdysseyCameraController.js:2136-2140 `if (!this.config.idleAutoDrift \|\| this.mode !== 'follow') return;` (no RM); OdysseyCameraController.js:1864-1890 `updateArrivalShot` (no RM); OdysseyCameraController.js:229-238 `orbitDeg: 24` |
| ODYR-13 | Per-frame CPU | **~80–90 short-lived objects per frame from the camera/seam helpers** (~5k/s at 60 Hz, ~12k/s at 144 Hz). Dominant: `seamHalfWidth` does two object spreads uncached and `seamWindowAt` calls it for up to 7 boundaries, 3×/frame from the camera + 2×/chapter from the corridor; plus `getBlendState` fresh state+maps, `resolveJourneyFraming` record spreads, `getPathDataAt`/`computeFollowFrame` return literals, `getTravelState`, `_resolveChapterSignature`, `Math.max(0, ...Object.values())`. CEM already has the frozen cache (`getChapterBoardTransition`) that `seamHalfWidth` should use. | Low | Perf | VERIFIED (mechanism) / PLAUSIBLE (GC cost — measure allocation rate) | transitions/odyssey-seam-schedule.js:43-47 `const transition = { ...DEFAULT_BOARD_TRANSITION, ...getChapterTransitionForChapter(sourceChapter) };`, :64 `const halfWidth = seamHalfWidth(source);`; OdysseyCameraController.js:606, :653, :1740, :1765; ChapterEnvironmentManager.js:1295-1297 `return resolveChapterBlendState(progress, …)` (no scratch); OdysseyCameraController.js:1075-1080; OdysseyBoardController.js:3619 |
| ODYR-14 | Per-frame CPU/GPU | **Level-node upload path is O(levels×96) and fires every ~4 frames during idle drift, every frame while scrolling**: per-particle `aNodePos/aNodeScale/aNodeLocked` are per-node constants replicated 96× (~105 KB of buffers re-uploaded); hidden orbs stay in every instanced draw as scale-0 instances (no compaction/`count`), so all 55 shells/cores + 5,280 quads are vertex-shaded every frame; lock/star matrices re-upload every frame (breathing moves the camera). | Low | Perf | VERIFIED (mechanism) / PLAUSIBLE (cost) | LevelNodeManager.js:143 `UPDATE_PROGRESS_EPSILON = 1e-4`; :1491-1496 `for (let p = 0; p < particleCountPerNode; p++) { … setXYZ(pIdx, node.group.position.x, …)`; :1426 `setMatrixAt(idx, HIDDEN_INSTANCE_MATRIX)`; :1603-1606 `cameraMoved` |
| ODYR-15 | Frame pacing | **Corridor-field animation clock loses time when the camera is settled**: `_uTime += deltaTime` runs only on the 30 Hz position-work frames, passing a single frame's delta, so sheet drift + mote wander/twinkle run at ~½ speed at 60 Hz and ~⅕ at 144 Hz whenever settled (journey end / arrival shot, frontier hold). | Low | Bug | VERIFIED | composition/odyssey-corridor-field.js:665 `this._uTime.value += deltaTime;`; OdysseyBoardController.js:3641-3648 `const runPositionWork = !settled \|\| (nowMs - this.lastPositionWorkAtMs) >= this.positionWorkIntervalMs; if (runPositionWork) { … this.corridorField?.update(this.camera, cameraProgress, delta);` |
| ODYR-16 | Frame pacing | **Frame-count / clock inconsistencies**: post `_seamBoost *= 0.9` and lens centre/radius `lerp(…, 0.18)` per frame (refresh-dependent); node float-bob only advances on upload frames; board clamps dt to 50 ms but CEM to 33 ms, so below 30 fps chapter shaders run slow-motion against world/post/camera time. | Low | Bug | VERIFIED | Post:980, :1167, :1180; LevelNodeManager.js:1444-1454 (inside gated block); OdysseyBoardController.js:3561 `Math.min(rawDelta, 0.05)`; ChapterEnvironmentManager.js:1403 `Math.min(Math.max(delta, 0), 1 / 30)` |
| ODYR-17 | GPU loss | **WebGL2-fallback board has no context-loss handling**: monitor + coordinator registration are gated on `isWebGPU`; themes and the playground monitor WebGL too. A lost fallback context renders black with no route-out. | Low | Bug | VERIFIED | OdysseyBoardController.js:2494 `if (this.isWebGPU) { … gpuResilience.monitorWebGPU(device, …); … registerGpuSurface('odyssey-board', …) }`; themes/base-theme.js:1398 `gpuResilience.monitorWebGL(renderer.domElement, …)` |
| ODYR-18 | Lifecycle | **Concurrent creation of the same chapter** (= first-audit ODY-18, OPEN): `environments.has()` is checked before the module `await`, no in-flight map; background loader, eviction and board requests can both build a chapter; the loser's group is orphaned (hidden, still parented, its virtual lights claimed). | Low | Bug | VERIFIED (mechanism) | ChapterEnvironmentManager.js:727-736 `if (this.environments.has(chapterId)) {…} … const def = await loadChapterModule(chapterId);`; callers ChapterEnvironmentManager.js:942, ChapterEnvironmentManager.js:996, OdysseyBoardController.js:4569 |
| ODYR-19 | Warm/compile (rollback) | **`?odysseyLiveCompile=0` is a working but expensive rollback**: the drain skips the live compile and the sweep "warms anyway" after its grace window, i.e. synchronous pipeline creation after reveal (the documented ~78 sync creates). Default path compiles live first and never warms anyway. | Low | Perf | VERIFIED | OdysseyBoardController.js:430-431 `this.liveCompileEnabled = … readUrlValue('odysseyLiveCompile') !== '0';`; OdysseyBoardController.js:1642 `if (!env.prewarmed && this.liveCompileEnabled)`; OdysseyBoardController.js:1863 `… warming anyway` |
| ODYR-20 | Instrumentation | **Debug/profile-only leaks**: with `?odysseyAAA=1` alone timestamps are resolved but three's never-cleared `timestamps` Map is pruned only when the profile ring exists (unbounded growth); `window.__ODYSSEY_GPU_RESET__` (profile flag) is never cleared in dispose and pins the old board. ADR-0016 sampling itself is correct (one push per resolved query, epoch guard). | Low | Bug | VERIFIED | OdysseyBoardController.js:3914-3916 `if (this.debugOverlayActive \|\| this.gpuProfileEnabled) this._resolveRenderTimestamps();`; OdysseyBoardController.js:3181-3186 `if (this.gpuProfileRing && epoch === … ) { … this._recordPassTimestamps(renderType); }`; OdysseyBoardController.js:488 `window.__ODYSSEY_GPU_RESET__ = () => {` |
| ODYR-21 | Lifecycle (Mode) | **Dead warp transition still opens a full-window classic WebGL context once per session** (= first-audit ODY-06, OPEN): deferred pre-init 5 s after reveal; no caller plays it; the mode never disposes its `transitionManager`. | Med | Perf | VERIFIED | OdysseyMode.js:2824 `this._scheduleDeferredWarpPreinit();`; core/odyssey/ThemeTransitionManager.js:298-300 `preInitWarp() { this.ensureWarpRenderer(); this.warpRenderer.init();`; rendering/transitions/WarpTransitionRenderer.js:99 `new THREE.WebGLRenderer({ antialias: true, alpha: false })`; grep `playOrbPortal\|warpTransition(` → no callers |
| ODYR-22 | Code quality | **Inert/dead render code still costs**: ChapterThresholdDirector builds no component (all profiles scale 0) but joins the pre-reveal compile barrier as an empty-group `compileAsync` and still does curve lookups on seam frames; `captureFrame`/`renderOnce`, `triggerFovPulse`/`triggerVistaBeat` have no callers. | Low | Improvement | VERIFIED | transitions/ChapterThresholdDirector.js:193 `if (thresholdComponentAuthored('veilScale'))` (all false); OdysseyBoardController.js:2754 + :2788 `this._timedCompile('breach', breachWarm)`; warmup/post-target-compile.js:523-527 `if (queue.length === 0) { await launch(group);`; grep: no callers of `captureFrame`, `renderOnce`, `triggerFovPulse`, `triggerVistaBeat` |
| ODYR-23 | Code quality | **Unpinned BloomNode private field + duplicated bloom setup**: `bloomNode._nMips = 3` (also shifting-sands-post, parhelion-post) has no contract test (bloom-dispose does), and each copy re-implements the mip cut + setSize pre-scale. A `themes/shared` bloom-configure helper + contract test would cover all three. | Low | Improvement | VERIFIED | Post:376 `this.bloomNode._nMips = 3;`; themes/shifting-sands/shifting-sands-post.js:160; playground/effects/parhelion-post.js:93; grep tests/ `_nMips` → none |
| ODYR-24 | Code quality | **God files** (= first-audit ODY-27, OPEN; board 4,698 → 4,702 lines). Seams: GPU profiler (OdysseyBoardController.js:329-361, 3153-3395), background warm scheduler (OdysseyBoardController.js:1499-2141), One World option plumbing (the same flags read twice: OdysseyBoardController.js:1027-1133 vs 2293-2321), set-piece wiring + per-frame ticks (OdysseyBoardController.js:2655-2741, 3650-3704), input (OdysseyBoardController.js:2903-3031), world/fog drive (OdysseyBoardController.js:3750-3865); camera framing tables/resolvers are pure (OdysseyCameraController.js:57-707), free camera is editor-only (OdysseyCameraController.js:2236-2395). Shared-code duplication: `smootherstep01`/`lerpColorViaBridge` in ChapterEnvironmentManager.js:161-179 and OdysseyDirector.js:52-65; `seamHalfWidth` vs `getChapterBoardTransition`; frame pacer not shared. | Med | Improvement | VERIFIED | `wc -l` 4702 / 2960; OdysseyBoardController.js:1054-1124 vs OdysseyBoardController.js:2296-2316 (`odysseyWorldNoCloudField`, `odysseyForestLod`, `odysseyWorldNoVisCull` read in both) |
| ODYR-25 | Per-frame CPU | **`sampleColourScript` allocates ~12 objects per call** (result, 5 rgb arrays, 5 Lab objects, template-string keys) and is called per frame by the world renderer; `getOdysseyPathPointAt` allocates a Vector3 per call (board, per frame). Add `out` parameters. | Low | Perf | VERIFIED (callee) | odyssey-colour-script.js:341-347 `const result = { … }; COLOUR_SLOTS.forEach(… result[slot] = oklabToLinearRgb(lab); result[\`${slot}Lab\`] = lab;`; world/odyssey-world-renderer.js:4615 `const cs = sampleColourScript(scriptP);`; path-utils.js:90-93 `return curve.getPointAt(t);`; OdysseyBoardController.js:3754 |
| ODYR-26 | Lifecycle | **Parked boards poll for the whole level session**: the prewarm drain reschedules every 400 ms and the render-warm sweep every 500 ms while parked; `_deferRenderWarm` (eviction flag path) exits on `!isActive`, permanently dropping that re-warm if the board was parked. Bounded, cheap. | Low | Improvement | VERIFIED | OdysseyBoardController.js:1612-1614 `if (!this.isActive) { this._schedulePrewarmDrain(400); return; }`; OdysseyBoardController.js:1770-1772 `setTimeout(step, 500)`; OdysseyBoardController.js:1904 `if (!this.isActive \|\| !env \|\| env._renderWarmed) return;` |
| ODYR-27 | Frame pacing / idle cost | **After a return to the menu, the menu intro renderer keeps presenting underneath the Odyssey board.** In cycles 2 and 3 of the Odyssey session the `#intro-animation` WebGPU canvas presented ~129/s for the whole Odyssey visit (cycle 1, entered from the boot menu with the intro skipped, showed only the board), so two full-rate WebGPU renderers run during play and GPU power rose from ~33 W to 53–85 W. The cause is not traced; REND-02 (menu renderer uncapped, rebuilt per return) is the same subsystem. | Med | Perf | VERIFIED (runtime: per-canvas presents) / cause PLAUSIBLE | Odyssey session `presents` per canvas: cycle 1 `{odyssey-board-3d: 130.6}`; cycles 2–3 `{intro-animation: 129.3, odyssey-board-3d: 129.3}` and `{intro-animation: 128.9, odyssey-board-3d: 128.9}`; `nvidia-smi` per-minute means |

#### First-audit Odyssey items re-checked at `cde601f8`

From the 2026-10-13 audit (ODY/REND IDs are that audit's) and the 2026-10-03 audit (§2 #5).

| Item | Topic | State | Evidence |
|---|---|---|---|
| REND-08 (part 1) | Map loop ignores Target Frame Rate | **OPEN** | OdysseyBoardController.js:3544-3563 (rAF every vsync, no interval gate); target only feeds the adaptive budget (OdysseyBoardController.js:629, :644, :3149) → ODYR-03 |
| REND-08 (part 2) | Resume keys off "parked" | **OPEN** | OdysseyMode.js:790 pause at blackout; OdysseyMode.js:844-852 park after 1.2 s; OdysseyMode.js:3070 cancel timer then OdysseyMode.js:3088 `if (this._boardParked)` → ODYR-04 (= ODY-19) |
| ODY-02 | Exit during build + quick re-entry → no map | **OPEN** | OdysseyMode.js:2886-2888 stale promise join; OdysseyMode.js:3123-3137 never clears it; generation guard OdysseyMode.js:2835-2840 → ODYR-02 |
| ODY-03 | Board disposed mid-build keeps building, retained forever | **OPEN** (line numbers moved: single `_disposed` check now OdysseyBoardController.js:1248; listeners OdysseyBoardController.js:1220) | → ODYR-01 |
| ODY-04 | Background `create()` while parked mid-level | **OPEN** | OdysseyBoardController.js:1505-1531; ChapterEnvironmentManager.js:990-996, :745 → ODYR-06 |
| ODY-05 | Previous renderer graph + shared-texture VRAM per visit; `oneWorld.dispose()` never called | **OPEN** | OdysseyBoardController.js:4593-4699; world renderer :4778-4796; r186 DataMap/Textures/WebGPUBackend dispose semantics → ODYR-05 |
| ODY-06 | Dead warp transition opens a full-window WebGL context per session | **OPEN** | OdysseyMode.js:2824, :3033-3053; ThemeTransitionManager.js:298-312; WarpTransitionRenderer.js:99; no play callers → ODYR-21 |
| ODY-12 | Quality read once; Render Scale / FPS cap never reach the board | **OPEN** | OdysseyBoardController.js:752-754, :2428-2438, :3544-3563 → ODYR-11, ODYR-03 |
| ODY-18 | Concurrent creation of the same chapter | **OPEN** (lines now ChapterEnvironmentManager.js:722-774) | → ODYR-18 |
| ODY-19 | Map frozen after a return within 1.2 s | **OPEN** | = REND-08 part 2 → ODYR-04 |
| ODY-20 | Unbounded `performance.mark`s (startup trace) | **OPEN** (unchanged: unique mark names per entry, odyssey-startup-trace.js:51-53) | noted, not re-filed |
| ODY-21 | OdysseyLayoutEditor ships | **FIXED** | OdysseyBoardController.js:1273-1281 `if (import.meta.env.DEV) { const { OdysseyLayoutEditor } = await import(…)`; odyssey-url-flags.js:12-15 DEV gate; no editor chunk in `dist/assets` |
| ODY-26 | Map auto-drift ignores reduced motion | **OPEN** (and the arrival-shot orbit also ignores it) | OdysseyCameraController.js:2136-2179, :1864-1890 → ODYR-12 |
| ODY-27 | God files | **OPEN** (board 4,698 → 4,702 lines; Mode 4,390) | → ODYR-24 |
| §2 #5 (03 audit) | Odyssey background loops are flag-flips → `_disposed` | **FIXED, holds** — every self-rescheduling loop checks `_disposed` or exits on `!isActive`; only `initialize()` itself lacks the checks | OdysseyBoardController.js:714, :1506, :1595, :1606, :1687, :1769; ChapterEnvironmentManager.js:984, :997 |
| REND-09 (map part) | Minimised packaged window keeps rendering the Odyssey map | **OPEN** | main.js:1256-1258 calls a `pauseRendering` the mode lacks; board ignores `window.isRenderingPaused`; electron/main.js:586 → ODYR-10 |
| ADR-0016 sampling | GPU timestamps once per resolved query | **COMPLIANT** | OdysseyBoardController.js:3170-3190 (single in-flight resolve, epoch guard, push in `.then`) — only flag-gated leaks in ODYR-20 |



#### World and chapter environments — `world/**` and `chapter-environments/**`

0 Critical, 0 High, 18 Med (12 on the default journey, 6 in fallback-only chapters), 37 Low.
Every module was read; one lead and seven sub-reviewers.

- **What ships:** with One World on by default, chapters 2–5 are built only on
  `?odysseyOneWorld=0` or a world-build failure (their chunks are never fetched otherwise), so their
  rows are tagged *[fallback]*.
- **Residency:** chapter eviction is off by default, so every created chapter stays resident for the
  board session, hidden when off-screen.
- **Reduced motion:** nothing in scope reads it (ODYR-31).
- **ODYR-28 is the world-side half of ODYR-05:** nothing calls the world's `dispose()`, so its 5 baked
  textures (~13 MiB) wait for GC after every exit while the next entry uploads a fresh set. That is
  consistent with the +31/+14 MB per-entry GPU-process growth measured in runtime batch 4.

| ID | Area | Finding | Sev | Cat | Evidence | Proof |
|---|---|---|---|---|---|---|
| ODYR-28 | World lifecycle [ship] | Production code never calls `createOdysseyWorld().dispose()`. The board's teardown frees the world's geometry and materials through `scene.traverse`, but not its 5 baked DataTextures (~13 MiB at high, ~8.6 MiB at low). The WebGPU device is injected and survives teardown, and r186 `Renderer.dispose` only drops its WeakMaps. So every Odyssey exit leaves those textures allocated until GC, and each re-entry uploads a fresh set. [lead, W1-1, W2-5] | Med | Bug | VERIFIED (GC timing PLAUSIBLE) | `W/odyssey-world-renderer.js:4793` `[heightTex, sunVisTex, groundTex, detailTex, macroTex].forEach((t) => t.dispose())` (only inside the uncalled `dispose()`); `OdysseyBoardController.js:4675-4685` traverse frees geometry/material only; `OdysseyBoardController.js:2449-2450` `device: warmDevice`; `three/renderers/webgpu/WebGPUBackend.js:3271` `if ( this.parameters.device === undefined && this.device !== null ) this.device.destroy();` |
| ODYR-29 | World bake [ship] | The world bake has no watchdog. If a worker goes silent (no post and no `error` event), or a main-thread `onStage` handler throws, `awaitWorldBake` never settles and Odyssey boot waits forever. The loader's own comment records one such hang. [W2-1, W2-4] | Med | Bug | PLAUSIBLE | `W/odyssey-world-bake-loader.js:307` `await Promise.all([handle.relief, handle.textures, …])`; `:209-212` "the board sat in `await awaitWorldBake(...)` forever"; `:168-182` abort only on `stage === 'error'` / `onerror`; `OdysseyBoardController.js:1021` `prebaked = await awaitWorldBake(this._worldBake)` |
| ODYR-30 | World failure path [ship] | The failure report and legacy fallback wrap only the synchronous `createOdysseyWorld` call. Shader build and compile happen later, in prewarm or the first render, where a failure only logs `console.warn`. A driver that cannot compile the world therefore gets no fallback, banner or stored log. Once shown, the banner also stays on the page after leaving Odyssey. [W1-2, W1-10] | Med | Bug | VERIFIED | `OdysseyBoardController.js:1136-1150` try/catch around the build only; `OdysseyBoardController.js:2387`, `:2416` `console.warn('[OdysseyBoard] Shader prewarm failed …')`; `W/world-build-failure-report.js:5-7`, `:97` |
| ODYR-31 | reducedMotion [ship+fallback] | Nothing in scope reads `settings.reducedMotion` or the OS query; the board forwards the setting only to the camera. Everything animates regardless: <br>- **World:** swell, cloud-field drift ±145 u, forest sway, a spray burst past the lens. <br>- **ch1:** heart beat, light flicker 4±1.5, embers past the lens. <br>- **ch6:** streaks, twinkle, comet. <br>- **ch7:** tunnel streaks at up to `uTime*1.6`, disk at 0.40 rad/s, rim flash. <br>- **ch8:** glyph steps, shock-ring heartbeat, rain at 120 u/s, traffic at up to 224 u/s. <br>One global motion-scale uniform would cover it. [W1-3, W2-19, C1-17, C1-D13, C2-17, C3-12, C3-27, C4-16, C4-31, C5-24] | Med | Improvement | VERIFIED | grep `reducedMotion\|prefers-reduced-motion` in scope = 0; `OdysseyBoardController.js:369-370` `getReducedMotion`, `:1166` (camera only); `W/odyssey-world-renderer.js:3211` `…mul(FIELD_DRIFT_XZ)`; `CE/black-hole-transcendence.tsl.js:211` `uTime.mul(1.6)`; `CE/urban-dreams.tsl.js:1108` `uTime.mul(1.2).floor()` |
| ODYR-32 | ch6 crossfade [ship] | The galaxy, planet-halo and planet-ring materials set `opacityNode` without `materialOpacity` and have no `uniforms.uOpacity`. In r186 an opacityNode replaces materialOpacity, so both the chapter's `setOpacityScale` and the manager crossfade are dead writes for them. They pop on at the 0.002 visibility threshold (earth ignite, p≈0.725) and pop off at the end of 6→7. The re-arm test reads only `cosmic-expanse.js`, not the `.tsl.js`. [C2-3, C2-5] | Med | Bug | VERIFIED (mechanism); how visible it is: PLAUSIBLE | `CE/cosmic-expanse.tsl.js:658` `material.opacityNode = alpha;`, `:807` `haloMat.opacityNode = clamp(haloStrength, 0.0, 1.0);`, `:849`; `three/materials/nodes/NodeMaterial.js:865` `this.opacityNode ? float( this.opacityNode ) : materialOpacity`; `CE/cosmic-expanse-environment.test.js:239-252` |
| ODYR-33 | ch6 create CPU [ship] | Every ch6 create re-bakes the 1024×512 void-sky DataTexture on the main thread, with no cache (the code's own estimate is ~260 ms). ch6 is created eagerly only when the focus chapter is 5-7; otherwise the background loader creates it after reveal, so the stall lands on the interactive board. The bake is deterministic, so a module-scope cache fixes both this and ODYR-41. [C2-2] | Med | Perf | PLAUSIBLE | `CE/odyssey-cosmic-backdrop.js:49` `// 1024×512 (~260 ms CPU, once, at chapter creation …)`, `:144-224`, `:249` `const bake = bakeCosmicBackdropTexture(bakeOptions);`; `src/core/game-modes/OdysseyMode.js:2863-2867` `const lo = Math.max(1, focusChapter - 1);` |
| ODYR-34 | ch1 create CPU [ship] | `_bakedNoiseTex` (a 96³ R32F Perlin texture: 884,736 evaluations, each with a closure and 8 hashes) is built synchronously on the main thread inside ch1 create. The helper's header still says "DEFAULT-OFF / experimental", but earth-core defaults it on. When the focus chapter is 3 or later, ch1 is a background create after reveal. [C1-8, C5-8] | Med | Perf | PLAUSIBLE | `CE/earth-core.tsl.js:141` `return true; // default ON`, `:147` `_bakedNoiseTex = buildTileableNoise3D(96, 20, BAKED_NOISE_PERIOD, 1337);`; `CE/shared/odyssey-baked-noise.js:8` `DEFAULT-OFF / experimental`, `:53`, `:63-71` |
| ODYR-35 | Light pool [ship] | Rig slots are derived from the full 1..8 manifest, including ch3/4/5, which One World suppresses. That puts 4 Point + 3 Dir + 1 Hemi + 1 Ambient = 9 lights in every lit pipeline for the whole session. The default path needs at most 2 Point + 1 Dir + 1 Ambient, so 5 always-zero lights are paid per lit fragment and per lit compile (ch1 rock and column MeshStandard). The file's own measurement: 18 lights took ch1's compile from 0.5 s to 0.8 s. [C5-1] | Med | Perf | PLAUSIBLE (mechanism VERIFIED) | `CE/shared/chapter-light-pool.js:40-42` `5: Object.freeze(['AmbientLight', 'PointLight', 'PointLight', 'PointLight'])`, `:63-64` `countOf(id, type) + countOf(id + 1, type)`; `CEM:440` `seedChapterLightPool(this.persistentLightRig);` |
| ODYR-36 | ch1 space bug [ship] | The molten-haze near-fade measures a LOCAL puff centre against the WORLD `cameraPosition`, under a group anchored at y = -30. A puff right at the lens computes as ~30 u away, so `nearFade` = 1 and the soft-particle proxy is defeated exactly where it matters: puffs up to 13.5 u half-extent sweep the lens at full 0.10-0.16 opacity and hard-cut at the near plane. [C1-2, C5-5] | Med | Bug | PLAUSIBLE (math verified) | `CE/earth-core.tsl.js:1208` `const camDist = length(center.sub(cameraPosition));`, `:1230` `smoothstep(6.0, 22.0, camDist)`; `CE/earth-core.js:1409` `group.position.set(chapterRange.center.x, chapterAnchorY, …)` |
| ODYR-37 | ch7 fill [ship] | The full-frame BackSide void dome evaluates 5 lattice-noise fields per pixel (fbm3 ×3 + ridged3 ×2) for a near-black backdrop, from ch7 entry to about local 0.46. ch6 measured the same pattern at 13.37 ms on Lane B and baked it. [C3-4] | Med | Perf | PLAUSIBLE | `CE/black-hole-transcendence.tsl.js:306-308` `fbm3(q, 3, latticeNoise3)` … `ridged3(q.mul(1.7).add(7.0), 2, latticeNoise3)`; `CE/black-hole-transcendence.js:494` `voidDome.visible = fall.inside < 0.999;`; `CE/odyssey-cosmic-backdrop.js:5-10` |
| ODYR-38 | ch8 fill [ship] | ch8 stacks many large blended surfaces: <br>- a noise sky dome; <br>- the Retrosun halo (~85% of frame height); <br>- 2 skyline cards; <br>- the street (fbm ×3 + hash); <br>- 9 additive ground-haze pools; <br>- 7 additive haze curtains (the nearest passes ~20 u from the eye, so it is nearly full-screen); <br>- the towers, forced transparent. <br>The `renderOrder = -150` early-Z trick only applies once the towers are fully present. [C3-20] | Med | Perf | PLAUSIBLE | `CE/urban-dreams.tsl.js:1393-1420` haze-stack bases and sizes; `:1216-1229` street; `CE/urban-dreams.js:767` `cityTowers.renderOrder = towerWeight >= 0.999 ? -150 : 0;` |
| ODYR-39 | Validation gate [ship] | The ch7 pilot uses a plain black shadow material, although its comment says it "exercises every ch7 pipeline". So the singularity window, ch7's most complex shader (alphaTest, DataTexture, texture3D, fwidth, atan2), never runs in the headless WebGPU validation. The ch8 pilot likewise omits the rain, skyline cards, horizon haze, gate holo and trails. [C3-3] | Med | Improvement | VERIFIED | `CE/black-hole-transcendence.tsl.js:957-958` `so the gate exercises every ch7 pipeline again` vs `:967-970` `new THREE.MeshBasicNodeMaterial({ color: 0x000000 })`; `CE/urban-dreams.tsl.js:1458-1486` |
| ODYR-40 | ch1 billboards [ship] | All 6 ch1 billboard systems use `billboardWorld` (local centre against the world camera) under the group anchored 30 u down, so quads face a point ~30 u below the eye (about 34° of error at r = 10 u and 45° elevation). The ember streak basis and the lava-lake fresnel and fog (`vPos`) carry the same bias. Round sprites hide most of it, and the helper itself documents the trap and the `billboardLocal` fix. (The world's own mote `billboardWorld`, `W/odyssey-world-renderer.js:3691`, sits under an identity group, `:993`, so it is fine.) [C1-1, C1-3, C1-4, C5-5] | Low | Bug | VERIFIED (mechanism) | `CE/earth-core.js:308` `material.positionNode = billboardWorld(center, worldSize);` (also `:396`, `:685`, `:837`, tsl `:1195`); `:574` `normalize(cameraPosition.sub(emberCenter))`; `CE/earth-core.tsl.js:507` `normalize(vPos.sub(cameraPosition))`; `CE/shared/odyssey-tsl-billboard.js:43` "Correct ONLY when the mesh's parent chain is the identity" |
| ODYR-41 | Texture lifecycle [ship+fallback] | Textures bound only inside TSL nodes and not registered in `group.userData.ownedTextures` are invisible to `_freeEnvironmentResources`. Two such textures: the ch6 void-sky DataTexture (2 MiB GPU + 2 MiB CPU; the caller drops the returned `texture`) and the ch3 shore-height R16F 512² [fallback]. Each is orphaned per board build until GC, and eviction can never free it. [C2-1, C4-8] | Low | Bug | VERIFIED | `CE/odyssey-cosmic-backdrop.js:263` `textureNode(bake.texture, drift)`; `CE/cosmic-expanse.js:987` `const { mesh } = createBakedVoidSkyTSL(…)`; `CE/surface-world.tsl.js:776` `heightTexture: bakeShoreHeightTexture()`; `CEM:852-859` (ownedTextures sweep) |
| ODYR-42 | Process singletons [ship] | The lake noise (4 MB R16F), `_bakedNoiseTex` (3.5 MB R32F), lattice (256 KB) and ch7 palette textures are process-level singletons that keep their CPU data, so they re-upload correctly to each new renderer. But with the injected device, each re-entry uploads ~7.8 MB again while the old GPUTextures wait for GC: a sawtooth, not growth. [C5-12, C3-1] | Low | Perf | PLAUSIBLE | `CE/shared/odyssey-lake-noise-bake.js:102` "process-level singleton like _bakedNoiseTex"; `CE/shared/odyssey-lattice-noise.js:57` "never disposed"; `CE/black-hole-transcendence.tsl.js:134` `let _journeyPalette = null;`; `three/renderers/common/DataMap.js:82-86` |
| ODYR-43 | Float32 3D filtering [ship] | `_bakedNoiseTex` is FloatType with LinearFilter. Without `float32-filterable`: <br>- r186 fragment sampling goes through `isUnfilterable` → `generateTextureLod` (`textureLoad`, nearest), giving blocky vault, rock and heart noise; <br>- explicit-level or vertex samples go to the 2D biquadratic helper (a possible WGSL error on a 3D texture); <br>- WebGL2 without `OES_texture_float_linear` gets an incomplete texture (samples 0, so the noise reads -1 everywhere). <br>Half-float, which the lake bake uses, is filterable everywhere. [C1-7, C5-9] | Low | Bug | VERIFIED (r186 code path); how often hardware hits it: PLAUSIBLE | `CE/shared/odyssey-baked-noise.js:74-75` `tex.type = THREE.FloatType;` `tex.minFilter = THREE.LinearFilter;`; `three/renderers/webgpu/nodes/WGSLNodeBuilder.js:860` `( ! this.isAvailable( 'float32Filterable' ) && texture.type === FloatType )`, `:882-884` |
| ODYR-44 | Lake noise bake [ship] | The ch1 lake binds a zero-filled 4 MB R16F 3D texture at create, then re-uploads it on an arbitrary live frame when the worker lands; the lake is flat until then. If the worker fails, the code falls back to a multi-second synchronous main-thread bake (2.1M simplex evaluations plus fit and CRC, ~70 MB transient), and there is no `onmessageerror` handler. The worker is constructed the same way as the shipping world-bake worker, so this failure path is unlikely; downgraded from C5's Med. [C1-9, C5-10, C5-11] | Low | Perf | PLAUSIBLE | `CE/shared/odyssey-lake-noise-bake.js:110-111` `new Uint16Array(res * res * res)`, `:119` `tex.needsUpdate = true;`, `:84` `new Worker(new URL('./lake-noise.worker.js', import.meta.url), { type: 'module' })` (same as `W/odyssey-world-bake-loader.js:162`), `:91-93` |
| ODYR-45 | Billboard degeneracy [ship] | `billboardWorld` and `billboardLocal` compute `right = normalize(cross(Y, toCam))` with no guard, despite a comment promising one. A particle exactly above or below the eye gives normalize(0) = NaN corners and the quad drops; near-vertical ones spin. This matters for the near-vertical ch7 climb and the ch8 rain. [C5-6, C3-10, C2-15] | Low | Bug | VERIFIED (code); visual effect PLAUSIBLE | `CE/shared/odyssey-tsl-billboard.js:52-53` `// Guard against the degenerate up==toCam case...` / `const right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));`, `:81` |
| ODYR-46 | NaN risks [ship] | Several pow/atan inputs are unclamped: <br>- the world's departure limb and airglow take `.pow(2)` of signed values; <br>- ch1's `viewFresnel` `pow(oneMinus(abs(dot)), k)` can see -ε; <br>- ch7's `atan(ray.y, ray.x)` is unguarded at the projected axis, where the hero sits exactly centred once `centring = 1`. <br>WGSL leaves pow of a negative base undefined, and a NaN pixel in the HDR target can smear through bloom. Fallback sites: ch2 fresnel, opt-in ch6 procedural dome. [W1-4, C1-10, C3-8, C1-D10, C2-14] | Low | Bug | PLAUSIBLE | `W/odyssey-world-renderer.js:2112` `exp(skyDir.y.sub(0.01).div(0.045).pow(2).negate())`; `CE/earth-core.tsl.js:93` `pow(oneMinus(abs(dot(normalize(nView), positionViewDirection))), k)`; `CE/black-hole-transcendence.tsl.js:187` `atan(ray.y, ray.x).add(twist)` |
| ODYR-47 | Clipmap reach [ship] | The world terrain grid reaches 26,214 u, but the board camera's far plane is 9,000 u. The outermost ring starts at 11,878 u, so 26,040 of the 241,088 ground triangles (and 1,656 of the 15,296 water triangles) are vertex-processed and then fully clipped on every Act II frame. [W1-5] | Low | Perf | VERIFIED | `W/odyssey-world-renderer.js:87` `levels: 9,`; `W/odyssey-clipmap.js:109` `const reach = half * baseSpacing * (2 ** (levels - 1));`; `OdysseyBoardController.js:2515` `new THREE.PerspectiveCamera(60, aspect, 0.1, 9000)` |
| ODYR-48 | Per-frame CPU [ship] | Shipping updates make small per-frame garbage: <br>- **World:** samples the colour script twice (the 2nd call is constant), plus a carry object and a closure. <br>- **ch1:** a spread array and ~6 closures. <br>- **ch6:** `setOpacityScale` runs 8 traversals over 23 nodes, with ~23 arrays, ~31 closures, 4 result objects and ~5 redundant `updateWorldMatrix` calls. <br>- **ch7 / ch8:** ~9-10 / ~3 short-lived objects (`resolveSunCarry`, `resolveBlackHoleFall`, the `getChapterTransitionForChapter` spread). <br>- **Light pool:** `used = {}` plus one `{chapterId, weight}` per chapter. <br>Each is microseconds; the cost is GC churn only. The ch6 `transparent = true` write is a no-op because QW5 forces the flag at create (`CEM:607-618`). [W1-6, C1-11, C2-6, C2-13, C3-6, C3-23, C5-3, C5-26] | Low | Perf | VERIFIED | `W/odyssey-world-renderer.js:4627-4629` `sampleColourScript(WATER_SCRIPT_END)`; `CE/earth-core.js:2292` `const sinkables = [ ...`; `CE/cosmic-expanse.js:528-538` `root.traverse(… [child.material] …)`; `CE/urban-dreams-sun-carry.js:60` `const ramp = (a, b) => …`; `CE/shared/chapter-profile.js:510-513` `return { ...DEFAULT_ODYSSEY_TRANSITION, … }`; `CE/shared/chapter-light-pool.js:177` `const used = {};` |
| ODYR-49 | Shared programs [ship] | Constants are baked into node graphs where a uniform would let materials share one program: the 5 ch1 glow sprites (tint and opacity), the ch6 dust and star near/far pairs, the ch8 trail hue, skyline near/far and sign blade/marquee. That is ~7-9 extra WGSL variants, each one more Dawn/D3D12 backend compile at warm. [C1-5, C2-10, C3-18, C4-24] | Low | Perf | VERIFIED (counts); ms cost PLAUSIBLE | `CE/earth-core.js:207` `sprite.rgb.mul(vec3(new THREE.Color(colorHex)))`; `CE/cosmic-expanse.js:1507,1540`; `CE/urban-dreams.js:374` `mix(vec3(hue.r, hue.g, hue.b), …)`; `CE/urban-dreams.tsl.js:406` |
| ODYR-50 | Draw calls [ship] | ch8 makes 64 draws (58 on low), 54 of them small per-mesh pieces: traffic 18, signs 12, rails 9, spire 10, gate bridge 5 (the bridge forced `frustumCulled = false`). ch1 makes ~53 draws with 16 `frustumCulled = false` sites. No shipping chapter reads `userData.detailLevel`, because chapter LOD is behind a flag that is off by default. Instancing or merging the ch8 signs, rails and bridge would save ~30 draws. [C3-19, C3-25, C1-13, C2-9] | Low | Perf | VERIFIED | `CE/urban-dreams.js:404` `new THREE.Mesh(new THREE.TubeGeometry(curve, 36, 0.55, 7, false), …)`, `:643` `gateBridge.traverse((child) => { child.frustumCulled = false; });`; `OdysseyBoardController.js:520-522` `(options.chapterLOD === true \|\| readBooleanUrlFlag('odysseyChapterLOD'))` |
| ODYR-51 | ch8 dead animation [ship] | The neon rails spin about `rotation.z` after `rotation.x = π/2`. Euler XYZ applies Z in local space, which is the torus's own symmetry axis, so the spin is invisible: 9 matrix recomposes per frame for nothing. [C3-21] | Low | Improvement | VERIFIED | `CE/urban-dreams.js:233` `ring.rotation.x = Math.PI * 0.5;`, `:748` `ring.rotation.z += delta * (0.18 + index * 0.05);` |
| ODYR-52 | ch8 traffic wrap [ship] | Traffic trails teleport 760 u at the wrap with no fade at either end, so near-lane trails can appear or vanish close to the eye path as bright 130 u additive tubes. [C3-22] | Low | Bug | PLAUSIBLE | `CE/urban-dreams.js:884-889` `const travelled = (time * (trail.userData.speed ?? 80)) % span;` … `if (baseZ - travelled < -680)` |
| ODYR-53 | ch7 window cost [ship] | The singularity-window graph (2 atan, log, 4 exp, 3 hashes, 3 texture fetches, 4 fwidth, plus a permanent alphaTest discard) runs full-frame for most of ch7. It also runs while `uPortal = 0`, where its result is multiplied by 0. `fwidth` across the atan ±π wrap softens one streak column. [C3-5, C3-9] | Low | Perf | PLAUSIBLE | `CE/black-hole-transcendence.tsl.js:270` `material.colorNode = color.mul(clamp(uPortal, 0.0, 1.0)).mul(leaving);`, `:273-274`, `:203` `clamp(fwidth(lanePos), 0.018, 0.24)` |
| ODYR-54 | ch6 fade details [ship] | Three smaller fade problems in ch6: <br>- The ch7 builders reused for the ch6 omen (disk, photon ring, folds) fade only on their own `uOpacity`, so ch6's arrival fade is dead for them: they enter at 100% × the crossfade rather than the authored 16%. <br>- The planet surface and asteroids fade on the symmetric `chapterOpacity` rather than `chapterCoverage`, so they can go see-through across 6→7. <br>- The comet head's alpha is unclamped (up to 1.5). <br>[C2-4, C2-7, C2-8] | Low | Bug | VERIFIED (disk) / PLAUSIBLE (rest) | `CE/black-hole-transcendence.tsl.js:407,477,523` `.mul(uOpacity)`; `CE/cosmic-expanse.js:2276` `setOpacityScale(object, earthReveal, chapterOpacity)`; `:1776` `uReveal.sub(hash).add(0.5)` |
| ODYR-55 | Lights [ship] | ch6 takes 3 pooled lights and animates `diskLight` every frame, but every ch6 material is unlit; the lights only reach other content. Separately, pooled DirectionalLight slots keep an un-parented target at the origin, so a chapter Dir light authored at a local offset under an anchored group points along anchor + offset. [C2-20, C5-4] | Low | Bug | VERIFIED (unlit) / PLAUSIBLE (direction) | `CE/cosmic-expanse.js:1856-1867`, `:2135` `diskLight.intensity = (…)`; `CE/shared/chapter-light-pool.js:218-220` (copies position only) |
| ODYR-56 | Light-pool singleton [ship] | The module-level `_pool` is never reset on manager dispose. It keeps the old rig and its 9 slot lights until the next board seeds, and a late `releaseChapterLights()` from a stale manager would hit the newer pool. This is safe today only because OdysseyMode disposes the old board before building the new one. [C5-2] | Low | Bug | VERIFIED | `CE/shared/chapter-light-pool.js:91` `let _pool = null;`, `:236-238` (reset is test-only); `CEM:1666-1683` |
| ODYR-57 | World bake lifecycle [ship] | Four smaller bake problems: <br>- The bake cannot be cancelled: the handle has no terminate and `_worldBake` is never cleared. A teardown mid-bake lets every lane run on (~1.4 s), and a quick re-entry starts a second set. <br>- Under `?odysseyWorldNoForest=1` or `ForestV1=1`, the keepAlive band-1 worker is never retired, leaking one idle worker per board. <br>- `abort()` runs the whole synchronous twin (a ~1.4-1.8 s long task) inside the failing worker's callback. <br>- The scatter result is posted without a transfer list, so ~7k objects are structured-cloned on the main thread. <br>[W2-2, W2-3, W2-7, W2-14] | Low | Perf | VERIFIED (mechanism) | `W/odyssey-world-bake-loader.js:88-96` (handle fields), `:266` `{ keepAlive: bandIndex <= 1 }`, `:214`, `:146-154` → `runSync()`; `W/odyssey-world-bake.worker.js:54` `post('scatter', { zoned }, undefined, …)` |
| ODYR-58 | World bake correctness [ship] | The renderer trusts the worker's scatter whenever `stats.trees > 0`, without comparing the options it was baked with. The bake (`OdysseyBoardController.js:769`) and the build (`OdysseyBoardController.js:1027`) assemble their options independently, so a quality-tier change in between would use a stale scatter. Separately, the atlas `fields` (1 MiB of Float32) are baked and transferred but never read. [W2-13, W2-6] | Low | Bug | VERIFIED (mechanism) | `W/odyssey-world-renderer.js:4346-4348` `pre.scatter && pre.scatter.stats?.trees > 0 ? pre.scatter : scatterZonedForest(…)`; `W/odyssey-world-bake.worker.js:82` `...atlas.fields.map((f) => f.buffer)` |
| ODYR-59 | Forest culling [ship] | Forest InstancedMesh bounds are centred on the instance mean, with radius `edge*0.75 + ySpan/2 + 40`. A recompute shows they cover every tree today, but the worst margin is only 2.5 u, so any scatter edit can wrongly cull a chunk. Also, each of the 40 buckets clones its source geometry, though there are at most 63 distinct sources to share. [W2-8, W2-9] | Low | Improvement | VERIFIED (computed) | `W/odyssey-world-renderer.js:4418-4421` `new THREE.Sphere(new THREE.Vector3(cx / n, …), (bucket.edge * 0.75) + ((maxY - minY) / 2) + 40)`, `:4384` `const geo = src.clone();` |
| ODYR-60 | World draws and fill [ship] | Three world draw/fill issues: <br>- The north lake is 3 never-culled meshes, drawn all through Act II, including deep under water. <br>- The cloud field (1 draw, 54 masses, 33,840 triangles, ~2× its documented budget) is opaque but uses `alphaTest` across the whole field, which likely disables early-Z. <br>- The water's ripple normal is not faded with distance and the detail texture has no mipmaps, so the far sea likely shimmers. <br>[W1-7, W1-8, W1-9, W2-10] | Low | Perf | VERIFIED (lake, counts) / PLAUSIBLE (fill, aliasing) | `W/odyssey-world-renderer.js:2057-2063`, `:3394-3397` (`fieldMat.alphaTest`), `:2323` `waveSlope.add(ripple.mul(vSwellFade))`; `W/odyssey-cloud-field.js:101-103` `{ near: 6, mid: 4, far: 3 }` |
| ODYR-61 | Long-session precision [fallback mainly] | The manager clock `this.time` only resets per board. `mod(aBase + uTime*k, span)` particle patterns lose f32 precision (~0.06 u at 1 h, ~0.5 u at 10 h), so fast near-camera streaks step (ch5 wisps and crystals, ch4 snow). The shipping chapters checked use bounded or `mod`-wrapped clocks. [C4-30, C5-27] | Low | Bug | PLAUSIBLE | `CEM:1404` `this.time += dt;`; `CE/sky-drift.tsl.js:867-869`; `CE/mountain-peaks.js:876-879` |
| ODYR-62 | Determinism [ship+fallback] | Build-time layouts use unseeded `Math.random`: ch1 particles (45 sites), ch6 debris, dust and streaks, ch7 dust, embers and shards, ch8 rain, and everything in ch2-5. None of it runs per frame, but layouts differ per board build, so `?t=` phase-locked captures are not reproducible. Stars, asteroids, the city and the colonnade are seeded; world/ has no `Math.random` at all. [C1, C2-11, C3-7, C3-24, C4-14, C5-21] | Low | Improvement | VERIFIED | `CE/earth-core.js:270-277`; `CE/cosmic-expanse.js:1224,1471,1696`; `CE/black-hole-transcendence.tsl.js:582-593`; `CE/urban-dreams.js:263` `(Math.random() - 0.5) * (Math.random() < 0.6 ? 90 : 260)` |
| ODYR-63 | WebGPU limits [ship] | The ch7 embers use 7 of the 8 vertex buffers (the ch1 ember stars use exactly 8, deliberately). One more instanced attribute, or a material that reads the normal, reaches `maxVertexBuffers`. [C3-14, C1-16] | Low | Improvement | VERIFIED | `CE/black-hole-transcendence.tsl.js:726-732` `aBase, aColor, aSize, aPhase, aSeed`; `CE/earth-core.js:347-349` "keep this billboard's WebGPU vertex-buffer count at 8 (the max)" |
| ODYR-64 | Portability [ship] | ch6 aurora and planet use reversed-edge `smoothstep(hi, lo, x)`, which the GLSL and MSL specs leave undefined. The ch8 sky's `atan(dir.z, dir.x)` has a ±π seam on corridor -X (off-frame today). [C2-16, C3-26] | Low | Bug | PLAUSIBLE | `CE/odyssey-planet-aurora.js:261,361`; `CE/cosmic-expanse.tsl.js:507`; `CE/urban-dreams.tsl.js:149` `const azimuth = atan(dir.z, dir.x);` |
| ODYR-65 | ch1 transparency [ship] | The ch1 rock, column, pocket and colonnade MeshStandard materials (~19 draws) are authored `transparent = true` for the ecotone fade. Their heavy fbm3 + ridged3 + lighting fragments therefore draw in the sorted transparent pass with no opaque early-Z, and overdraw on overlapping prisms. The flag is set at build and never flipped at runtime. [C1-14] | Low | Perf | PLAUSIBLE | `CE/earth-core.tsl.js:1420` `material.transparent = true;`, `:1082` `material.transparent = true; // authored at build (QW5)` |
| ODYR-66 | ch7 to ch8 coupling [ship] | ch7 imports ch8's modules for the sun copy, so loading ch7's chunk also loads ch8's. `computeCorridorOrientation` (2 × 48-step bisections) runs at create in both chapters. The sun copy, hidden until 7→8, shares ch8's Retrosun WGSL, so its first draw needs only a JS node build. [C3-29, C3-2] | Low | Improvement | VERIFIED | `CE/black-hole-transcendence.js:54-55` `import { createSynthwaveSunTSL } from './urban-dreams.tsl.js';` |
| ODYR-67 | ch2 seabed [fallback] | The seabed is degenerate. The plane is rotated flat at build, so its local positions are `(x, 0, -y)`. The positionNode then rebuilds them as `vec3(posL.x, posL.y, f)`, dropping the depth axis, so every column collapses to `(x, 0, f(x))` and every triangle has zero area. The reef payoff never rasterises, yet it still costs 2 draws plus 10 octaves of vertex noise. Re-verified by the lead. [C1-D1] | Med | Bug | VERIFIED (static math) | `CE/deep-ocean.tsl.js:389` `geometry.rotateX(-Math.PI / 2);`, `:327` `ridged3(vec3(posL.x.mul(0.012), posL.y.mul(0.012), 0.0))`, `:329` `const displaced = vec3(posL.x, posL.y, ridge.add(swell));` |
| ODYR-68 | Fallback billboards [fallback] | `billboardWorld` is used under anchored chapter groups in all four fallback chapters: <br>- **ch2 (+209 u):** FrontSide plankton, bubbles, jellies, kelp and panes show their back faces (culled) above the camera, or render edge-on. <br>- **ch5 (y≈585):** wisps (280) and ice crystals (120) aim along the group offset, so they are likely slivers; the sun glow is foreshortened. <br>- **ch3:** the sun disc and the foreground quad. <br>- **ch4:** plume, spindrift snow, sun disc and ray fan. <br>ch6 and ch7 already fixed this with `billboardLocal`. [C1-D2, C4-21, C4-6, C5-17, C5-5] | Med | Bug | VERIFIED (mechanism); magnitude PLAUSIBLE | `CE/deep-ocean.js:721` `billboardWorld(center, 0.8)`, `:727` `mat.side = THREE.FrontSide;`; `CE/sky-drift.tsl.js:876` `billboardWorld(center, size)`, `:1036`; `CE/surface-world.tsl.js:2632`; `CE/mountain-peaks.js:502`; `CE/shared/odyssey-tsl-billboard.js:43-45` |
| ODYR-69 | ch2 creature masks [fallback] | Creature masks read `positionLocal.xy` in the fragment as if it were quad-space coordinates. With a positionNode set, r186's fragment `positionLocal` is the varying carrying the billboarded output (tens to hundreds of units), so the mask and quadFeather go to 0 and the leviathan plus the distant whale/ray/jelly layer render fully transparent (2 wasted draws). The fix is `uv().sub(0.5)`. God rays read `positionLocal` the same way. [C1-D3, C1-D11] | Med | Bug | PLAUSIBLE (strong) | `CE/deep-ocean.tsl.js:530` `const rawUv = positionLocal.xy;`, `:614` `material.positionNode = billboardWorld(animCenter, aSize);`; `docs/THREE_UPGRADE_RESEARCH_R181_TO_R185_2026-08.md:747-751` |
| ODYR-70 | Post-create GLB materials [fallback] | The ch2 manta/whale and ch3 flying-bird GLBs load fire-and-forget after create(), then attach NEW materials (skinned, transparent, DoubleSide: ~2 pipelines each). That normally happens after the create-time prewarm, so the first visible frame compiles at chapter entry. The replacement materials are never disposed, because the meshes carry `fromSharedGltfCache` and teardown skips them wholesale. A load that resolves after dispose still `group.add`s into a freed group. [C1-D4, C1-D5, C4-1, C4-9] | Med | Perf | PLAUSIBLE (compile) / VERIFIED (leak) | `CE/deep-ocean.js:265-268` `loadDeepOceanMantas(group, uniforms, corridor).catch(…)`; `CE/deep-ocean-manta.js:143-153` `child.material = material;`; `CE/surface-world.js:671` `loadFlyingBirdsOnly(group, layer)`, `:465`; `CE/shared/odyssey-gltf-loader.js:77`; `CEM:814` `if (child.userData?.fromSharedGltfCache) return;` |
| ODYR-71 | Runtime depthWrite flips [fallback] | ch3 writes `material.depthWrite = material.opacity >= 0.98` every frame on the flying-bird materials, and ch4 toggles the conifer belt's depthWrite at opacity 0.98. On WebGPU each flip builds a new GPURenderPipeline (`needsRenderUpdate` compares depthWrite) on the live seam frame: a post-warm hitch, and a repeatable one. ch4's instance on its own was rated Low by C5. [C4-2, C5-15] | Med | Perf | VERIFIED (r186 mechanism) | `CE/surface-world.js:479` `material.depthWrite = material.opacity >= 0.98;`; `CE/mountain-peaks.js:943-946` `beltMesh.material.depthWrite = beltDepthWrite;`; `three/renderers/webgpu/WebGPUBackend.js:2396` `data.depthWrite !== material.depthWrite` |
| ODYR-72 | ch3 hero mirror [fallback] | The hero-lake `reflector()` defaults on for High/Ultra/Extreme, though the comments say "default OFF". It costs a second full scene render per frame into a 0.5-scale HalfFloat render target, which needs a second set of pipelines for that format that the board prewarm (through the post target) cannot create. The virtual camera's layer mask is wired lazily from update()'s camera, so a different camera reflects the whole scene. [C4-5, C4-20] | Med | Perf | PLAUSIBLE | `CE/surface-world.js:894-895` `return tier === 'high' \|\| tier === 'ultra' \|\| tier === 'extreme';`, `:877-879`; `CE/surface-world.tsl.js:757` `reflector({ resolutionScale: 0.5, bounces: false, generateMipmaps: false })`; `CE/surface-world.js:1557-1561` |
| ODYR-73 | Fallback crossfade gaps [fallback] | Materials with an opacityNode and no `uniforms.uOpacity` or chapter term ignore the manager crossfade and pop when `group.visible` flips: <br>- the ch3 sky dome (its `uOpacity` is never written), at 2→3 and 3→4; <br>- the ch5 sun glow, god-ray fans, lenticular, ice crystals, wisps and cloud-sea deck, at 4→5 (the deck doubles ch4's identical deck). <br>[C4-13, C4-25] | Low | Bug | VERIFIED (static) | `CE/surface-world.tsl.js:590` `material.opacityNode = uOpacity;` (not in the target list at `CE/surface-world.js:1247-1258`); `CE/sky-drift.tsl.js:223,531,882,933,1043` |
| ODYR-74 | Fallback wasted work [fallback] | Fallback chapters compile and draw things nobody can see: <br>- Count-0 builders (reeds, leaves, motes, pollen, trees, great tree, procedural birds) and the hidden hero-lake water still build node graphs and pipelines that never draw; r186 skips only the draw. <br>- One stray foreground grass head is seated at `{0, 0, -10}`, because the count is `max(len, 1)`. <br>- The ch5 noctilucent veil is always at zero alpha (dusk is capped at 0.1) but is drawn every frame (900×520, additive, fbm2 ×4). <br>- 6 ch5 aurora ribbons compile 6 separate programs. <br>[C4-3, C4-4, C4-7, C4-23, C4-24] | Low | Perf | VERIFIED | `CE/surface-world.js:1054` `createReeds(uniforms, 0)`; `three/renderers/common/RenderObject.js:629` `if ( instanceCount === 0 ) return null;`; `CE/surface-world.tsl.js:3152` `const count = Math.max(placements.length, 1);`; `CE/sky-drift.js:468`; `CE/sky-drift.tsl.js:981` `const reveal = smoothstep(0.8, 0.94, uDusk);` |
| ODYR-75 | Fallback correctness [fallback] | Three smaller fallback bugs: <br>- The ch4 aurora curtains are frozen: a plain `{ uTime: { value: 0 } }` is wrapped into a new `uniform(0)` that nothing ticks. <br>- ch5 has two suns ~22° apart: the dome's `uSunDir` is hard-coded every frame, while the sprite and light use ODYSSEY_SUN. <br>- The conifer-material cache is keyed by `uSnowBlend` only, so a second belt fades with the first belt's `uOpacity`. <br>[C5-16, C4-22, C5-14] | Low | Bug | VERIFIED | `CE/mountain-peaks.js:209` `const uniforms = { uTime: { value: 0 } };`; `CE/shared/mountain-aurora.js:83-86`; `CE/sky-drift.js:476` `uniforms.uSunDir.value.set(0.34, elevation, -0.88).normalize()`; `CE/shared/snow-conifer-belt.js:62-66` |
| ODYR-76 | Fallback CPU [fallback] | **At create, every entry:** synchronous bakes, namely the ch3 shore height (262,144 `getTerrainHeight` calls) and ch4 mountain geometry (~2.4M `Math.sin`, rebuilt again by ch3 and ch5). <br>**Per frame:** <br>- a ch2 CPU bubble sim with a full `aBase` re-upload; <br>- ch3 animating permanently hidden birds and ticking 5 mixers under water; <br>- a ch5 recursive `getObjectByName` search. <br>[C4-11, C5-20, C1-D7, C4-12, C4-29, C5-19] | Low | Perf | VERIFIED (code) / PLAUSIBLE (ms) | `CE/surface-world.tsl.js:683-695` `SHORE_HEIGHT_RES = 512`; `CE/mountain-peaks.tsl.js:140-160`; `CE/deep-ocean.js:1006-1010` `baseAttr.needsUpdate = true;`; `CE/surface-world.js:1897` `mixer.update(delta)`; `CE/sky-drift.js:127-130` |
| ODYR-77 | Fallback draws and fill [fallback] | Transparent + DoubleSide materials without `forceSinglePass` draw twice (ch2 god rays, seabed, creatures, water). ch4 makes ~29 draws, including 3 eagle meshes that share geometry and material, and transparent hero peaks with 10 snoise3 per fragment. ch5's 28 draws are dominated by overdraw (6 strata, the dome, 6 additive ribbons, the lenticular). [C1-D6, C5-18, C4-26] | Low | Perf | VERIFIED (counts) / PLAUSIBLE (cost) | `CE/deep-ocean.tsl.js:238` `material.side = THREE.DoubleSide;`; `three/renderers/common/Renderer.js:3783` `material.transparent === true && material.side === DoubleSide && material.forceSinglePass === false`; `CE/mountain-peaks.js:715-726`; `CE/sky-drift.tsl.js:396-397` |
| ODYR-78 | Theme coupling [fallback] | `surface-world.tsl.js` statically imports 5 flower builders from `src/themes/summer/rendering/summer-flora.js` and is now that file's ONLY importer. Deleting or renaming the file in a theme cleanup breaks the ch3 chunk at build; editing its geometry or baked `color` attribute silently changes ch3. It should move under `CE/shared/`. Similarly, ch3 pulls in `deep-ocean.tsl.js` for one PlaneGeometry, and ch5 pulls in `mountain-peaks.tsl.js`. The theme file itself was not audited (theme reviewers own it). [C4-17, C4-33] | Low | Improvement | VERIFIED | `CE/surface-world.tsl.js:74-76` `} from '../../../themes/summer/rendering/summer-flora.js';`, `:71`; `CE/sky-drift.js:43` `import { createCloudSeaDeckTSL } from './mountain-peaks.tsl.js'` |
| ODYR-79 | Dead weight [ship+fallback] | **Fallback chunks:** with One World on by default, the ch2-5 chunks (~11.4k lines) are never fetched; ch3 alone holds ~1,300 lines of pilot/playground-only builders. <br>**Shipping code still carries dead parts:** <br>- **World:** still builds the retired V1 forest material, the ~430-line cloud sheet and the heroes at boot; `stats.materials` is stale; worker lanes `terrain`/`all` are unreachable. <br>- **ch1:** the satellite/tether branch is unreachable (`size >= 4.5` is never true), and 3 builders are unused. <br>- **ch6:** `createAccretionDiskTSL` and `createLensShellTSL` are unused. <br>- **Shared noise:** `curl3` and `mxPerlin3` are unused. <br>- **Per-frame dead writes:** ch7 `horizon.material.opacity = 1` and ch6 `shadow.material.opacity = 1` (an opacityNode is set). <br>[W1-10, W2-12, C1-12, C2-18, C3-11, C3-28, C4-18, C4-32, C5-7, C5-22] | Low | Improvement | VERIFIED | `CEM:734` `if (this.suppressedChapters.has(chapterId)) return null;`; `W/odyssey-world-renderer.js:4013,4036`; `CE/earth-core.js:1920` `const satelliteCount = size >= 4.5 ? …`; `CE/cosmic-expanse.tsl.js:180-288`; `CE/shared/odyssey-tsl-noise.js:138-153`; `CE/black-hole-transcendence.js:513-515`; `W/odyssey-world-bake.worker.js:62-77` |
| ODYR-80 | Duplication [ship+fallback] | Code is duplicated widely: <br>- **CPU noise:** integer-hash value noise is reimplemented ≥7 times (world height, forest scatter, tiling noise, forest geometry, cloud field, the renderer, cosmic backdrop, mountain-language); smooth-min twice; makeRng twice with different algorithms. The shipping cloud field imports `makeRng` from the RETIRED hero-clouds module. <br>- **TSL noise:** fbm duplicated (earth-core `fbm`, mountain-peaks `fbmValue2`, beside the shared fbm3). <br>- **Billboards:** ch8 `billboardStage` is identical to the shared `billboardLocal`. <br>- **Skies and water:** ch6 and ch7 (and ch5, the corridor field and the threshold director) each own a space sky and starfield; 15 files build their own BackSide sky dome; the world water is separate from the shared `buildOdysseyWaterSurface`. <br>- **Peaks:** the world height hand-transcribes the canonical peaks. <br>`src/themes/shared/sky-core` is not imported anywhere in Odyssey. Any merge must stay byte-identical (golden suite and frozen forest quantiles). [lead, W1-10, W2-11, C1-18, C1-D14, C2-19, C3-15, C3-28, C4-19, C4-33, C5-23] | Low | Improvement | VERIFIED | `W/odyssey-cloud-field.js:54` `import { makeRng } from './odyssey-hero-clouds.js';`; `W/odyssey-forest-scatter.js:311-324`; `CE/urban-dreams.tsl.js:114-121` vs `CE/shared/odyssey-tsl-billboard.js:78-87`; `W/odyssey-world-height.js:107-112` "transcribed from shared/canonical-mountain-range.js" |
| ODYR-81 | Budget docs drift [ship] | The forest and cloud budget comments are stale against the code. Forest at high is 7,039 trees / 40 draws / 425k triangles, versus documented 4,739 / 34-37 / 399k. The cloud field is 33,840 triangles, about 2× the documented 17,360. The species file says the forest was "not paired on Lane B". [W2-10] | Low | Improvement | VERIFIED (computed) | `W/odyssey-forest-scatter.js:52-56`; `W/odyssey-cloud-field-specs.js:84`; `W/odyssey-cloud-field.js:101-103` |
| ODYR-82 | GLB cache [ship] | The GLB cache itself is correct: URL-keyed, deleted on failure, bounded at 7 GLBs, and only `isMesh` children are tagged. But KTX2 `detectSupport` is latched to the FIRST renderer forever, which is latent: 0 of 7 GLBs use basisu today. [C5-13] | Low | Improvement | VERIFIED | `CE/shared/odyssey-gltf-loader.js:16` `let ktx2SupportDetected = false;`, `:43` `if (!renderer \|\| ktx2SupportDetected)` |

### R-item code paths (RIT)

New findings the RITEM reviewer made while re-checking R-09, R-17, R-22, R-28 and R-29 (not in the
2026-10-13 audit as written, or materially extending an item there).

| ID | Finding | Sev | Cat | Evidence | Proof |
|---|---|---|---|---|---|
| RIT-01 | **Dynamic resolution sees permanent "frame-time pressure" whenever the target is above the panel's refresh.** Thresholds come from the target (`downscaleThreshold = 1000/target × 1.14`) while the sample is the monitor's own rAF interval, which can never be shorter than one vsync. On the 165 Hz panel with 240 or Unlimited→240: 4.75 ms threshold vs 6.06 ms intervals → −0.1 render scale every ≥ 6 s (5 s tick) down to 0.5 in ~45 s of gameplay with the FPS counter on; the up-scale test (p95 < 3.75 ms) can never pass. Same on a 60 Hz panel at 120/144/240. Not persisted at 0.5 (the `changed` branch sets `persistEligible: false`), so it repeats every session. | Med | Perf / rendering | `src/utils/desktop-performance-policy.js:256-268,270-281`; `src/utils/performance-monitor.js:415-426,717-723,888-901`; `src/main.js:1071-1112,1136` | Arithmetic VERIFIED; behaviour PLAUSIBLE → runtime-plan B9 |
| RIT-02 | **A packaged first run on this 165 Hz laptop writes Target Frame Rate 240.** `applyPackagedWindowsFirstRunDisplayPolicy` persists `getNearestSupportedFrameRate(monitorRefreshRate)`, which returns the first of [60,120,144,240] ≥ 165 → 240; there is no 165 option in the menu. Consequences: every layer presents at 165 (no cap, full GPU cost), SP/Infinity/Odyssey switch to the `setTimeout` hybrid sim because 240 > 165 (`needsHybridMode`), and RIT-01 applies whenever the FPS counter is on. Depends on the async refresh detection (IPC `get-displays`) finishing before the first-run policy; otherwise it writes 60. | Med | Settings / perf | `src/main.js:2080-2120`; `src/utils/desktop-performance-policy.js:75,104-110,136-140`; `src/core/frame-rate-controller.js:43,50-64,105-117,178-181`; `src/core/game-modes/SinglePlayerMode.js:1024-1049`; `index.html:1281-1288` | Code path VERIFIED; the detection race PLAUSIBLE → B1 |
| RIT-03 | **At 165 Hz the theme's 60 FPS cap has a 1.0 ms decision margin and is fed `performance.now()` from inside its rAF callback**, so main-thread work that ran earlier in the same frame (Phaser presenting on its 3,3,3,2 frames; Phaser's loop was registered at boot, before the theme's) shifts the decision. Replay of the shipped pacer: 82.5 fps with even 2-vsync gaps when that work is ≤ 0.5 ms, 70 fps at 1.0 ms, and 60 fps locked to Phaser's uneven 3,3,3,2 cadence at ≥ 1.5 ms. At 144 Hz the margin is 3.7 ms. | Low-Med | Rendering / pacing | `src/themes/base-theme.js:1318-1327`; `src/themes/theme-frame-pacer.js:51,120-138`; `src/rendering/phaser/frame-rate-policy.js:21-47`; replay `RITEM/replay-gates.mjs` + `.out.json` (sensitivity rows) | Replay VERIFIED; device PLAUSIBLE → C1, C3 |
| RIT-04 | **"Unlimited" is not one value across the code.** The overlay runs at 60 (`targetFrameRate || 60`); after a reload the FPS select shows "60" (`settings.targetFrameRate || 60`) while the game runs uncapped; the desktop policy replaces 0 with the refresh-rounded target (240 on this panel) and a DRS `persist-stable` writes that back over the player's choice; `changes.targetFrameRate` is tested for truthiness, so picking Unlimited (0) does not refresh the policy. | Low | Settings / UI | `src/main.js:964,1044-1050,4034-4049`; `src/ui/settings.js:1653`; `src/utils/desktop-performance-policy.js:208-210` | VERIFIED (code) |
| RIT-05 | **Hiding the FPS counter doesn't stop dynamic resolution.** `hideFPSCounter()` only hides the overlay and drops the `overlay` sampling reason; `performanceMonitor.enabled` stays true and `syncPerformanceMonitorSampling()` re-adds `gameplay`, so DRS (gated on `enabled`) keeps sampling and stepping for the rest of the session — and every session if `showFPSCounter` was ever saved on. Refines REND-04 ("runs only while the overlay is on"). | Low-Med | Perf | `src/main.js:1073,1679-1728`; `src/utils/performance-monitor.js:201-228,1312-1319` | VERIFIED (code) → B9 confirms |
| RIT-06 | **The new in-game "Reduce motion" (1433075) does not reach the opening or the menu.** The boot warp, the menu cinematic background, the intro auto-skip, the startup-shell fade and the loading-overlay countdown read only the OS media query, not `settings.reducedMotion`. | Low-Med | Accessibility | `src/ui/boot-warp-transition.js:80`; `src/ui/intro-animation.js:1399-1402,1427`; `src/main.js:544,4989`; `src/ui/cinematic-loading-overlay.js:410-411` | VERIFIED (code) |
| RIT-07 | **Two more frame-count-tied presentation sites (REND-10 class).** Menu music-pulse smoothing `* 0.78 + * 0.22` per uncapped frame (τ 67 ms at 60 Hz, 24 ms at 165 Hz); custom-cursor trail clamps its delta to ≥ 8 ms, so at 165 Hz (6.06 ms frames) trail life and particles run 1.32× fast and a trail point is emitted per frame (2.75× as many as at 60 Hz). | Low | Rendering / timing | `src/ui/intro-animation.js:558-563`; `src/ui/components/custom-cursor.js:963-965,881,904-906` | VERIFIED (code) |
| RIT-08 | **REND-14 also breaks beat detection, not only envelopes.** The analyser's 150 ms beat cooldown is measured on its integrated clock (`elapsedMs += deltaSeconds`), which runs at the caller's per-frame dt only once per ≥ 33 ms. At 165 Hz: Odyssey (per-frame dt) clock = 1/6 → cooldown ≈ 0.9 s wall, so beats faster than ~67 BPM are dropped (every other beat at 120 BPM); menu (fixed 1/60) clock = 0.46 → ≈ 327 ms. | Low-Med | Audio-visual sync | `src/audio/sound-manager.js:65,537-545,559`; `src/audio/audio-analyzer.js:16,189-195,270-280`; `src/rendering/odyssey/composition/OdysseyAudioReactor.js:57-64`; `src/ui/intro-animation.js:558` | Arithmetic VERIFIED → C6 (menu ratio) |
| RIT-09 | **Focus-pause (6e3b1c5) and the loading cover interact badly.** A blur *before* `onStart` (alt-tab right after clicking a mode card, during a cover that can last ~15 s cold) is never re-checked when the run starts, so the run starts unfocused, unpaused and unseen; a blur *after* `onStart` opens Settings underneath the cover (cover z-index 10002 > Settings 2100), so the player returns to a cover over a paused game. Compounds LIFE-01. | Med | Lifecycle / fairness | `src/ui/focus-pause.js:21-33,56-72`; `src/main.js:2844-2849,2913`; `src/core/game-modes/SinglePlayerMode.js:436`; `public/styles/cinematic-loading.css:6`; `public/styles/main.css:4630-4631` | VERIFIED (code); runtime: Session A variant with `win.blur()` before the dispatch, expect `focus:false, paused:false, spawned ≥ 1` at reveal |
| RIT-10 | **Theme-linked music on by default (964ca55e) + the default `backgroundMode: 'Level'`** means every mid-run level theme switch (LIFE-04) now also switches the song for new players, with AUDIO-03's ~4.5–5 s near-silent dip each time. Owned by the LIFE-04 / AUDIO reviewers; noted because it changed after the audit. | Low-Med | Audio / lifecycle | `src/ui/settings.js:24,26`; `src/core/constants.js:247`; `src/main.js:2746-2753`; `src/audio/sound-manager.js:1249-1268`; `src/core/game-modes/SinglePlayerMode.js:942-947` | VERIFIED (code interaction) |
| RIT-11 | **`appliedDisplayMode` (61fd001) remembers only its own writes.** Fullscreen entered or left through F / R3 / the Hub (`toggleFullScreen`), Esc or the OS leaves it stale; Settings then shows a mode the window is not in, and re-asserting it needs picking another value first. | Low | Display / UX | `src/core/display-manager.js:13,146-151`; `src/main.js:2385-2387,3508-3510` | PLAUSIBLE → B6 |
| RIT-12 | **First-run resolution tiering under-counts HiDPI pixels**: `screen.width × screen.height × DPR` (CSS px × DPR, not DPR²) — a 4K panel at 150 % reads 5.5 MPx instead of 8.3 MPx and gets 0.8/High instead of 0.65/Medium. Not this machine (1080p). | Low | Perf policy | `src/utils/desktop-performance-policy.js:112-141` (`:118`); `src/main.js:2094-2099` | VERIFIED (arithmetic) |
| RIT-13 | **Stale premise in the Phaser cap code**: the comment says Phaser has no public live limiter setter, but Phaser 4.2 has `TimeStep.setFPSLimit` (`@since 4.2.0`). `applyPhaserFrameRate` builds a new TimeStep and destroys the old one per cap change; either way Phaser's rAF callback moves to the end of the frame's callback order (relevant to RIT-03). | Low | Maintainability | `src/rendering/phaser/frame-rate-policy.js:90-126`; `node_modules/phaser/src/core/TimeStep.js:855-883` | VERIFIED |
| RIT-14 | **The overlay's modulo gate also drops frames at 60 Hz / 60 cap** when rAF timestamps alternate 16.6/16.7 ms after Chromium's 100 µs coarsening: replay 40/s with 1- and 2-vsync gaps. Whether it happens depends on the panel's true period (60.00 vs 59.94 Hz). Extends REND-01; the overlay itself is REND-05 (other reviewer). | Low | Rendering | `src/rendering/phaser/background-scene.js:141-150`; `RITEM/replay-gates.out.json` (60 Hz rows) | Replay VERIFIED → C8 |
| RIT-15 | **`npm run dev:electron` fights focus-pause**: it opens detached DevTools at launch (`openDevTools({ mode: 'detach' })`); any click into DevTools blurs the game and pauses a local run with Settings open, which makes interactive debugging and manual perf checks of gameplay misleading. | Low | Dev experience | `electron/main.js:676-680`; `src/ui/focus-pause.js:62-72` | VERIFIED (code); procedure note in runtime-plan §0.7 |

## Re-checked GPU items

The 2026-10-13 audit left these for a machine with a dedicated GPU. Static state re-checked at
`cde601f8` by the RITEM reviewer; the last column is filled as runtime sessions land (always
"seen in Quiet mode").

> **This machine's real cadence differs from its nominal refresh.** Windows and Electron report
> 165 Hz (`screen.getPrimaryDisplay().displayFrequency`), but Electron's rAF runs at a steady
> **131.5–131.8 Hz** (p50 7.4–7.5 ms) even on a blank page (two runs). The RITEM reviewer derived its
> expectations for 165 Hz (board 60/s in 3,3,3,2-vsync gaps; theme 82.5/s in 2-vsync gaps; overlay
> 46–50/s); at the measured 131.6 Hz the theme pacer renders every second frame, **65.8/s**, which is
> what the runtime pass measured (65.2–65.6 fps).

| Item | Sub-findings | State at `cde601f8` | Evidence | Hardware measurement (Quiet mode) |
|---|---|---|---|---|
| R-09 | LIFE-01 (run starts under the cover; Esc/Space under it) | **OPEN** (start path byte-identical; focus-pause 6e3b1c5 adds RIT-09) | `SinglePlayerMode.js:407-412,435-436`; `InfinityMode.js:339-351,410-411`; `main.js:2844-2849` → waits `:2853-2888` → `:2913`; `cinematic-loading-overlay.js:11,284-310`; `controls.js:579-595`; gravity `constants.js:150-158` (720 ms/row), clamp `game.js:1419` | **Confirmed** (R-session, forest, entry from the boot menu): the first piece spawned 69 ms after `startGameWithMode`, the cover began lifting **1,948 ms later**, and the piece fell from row 2 to row 4 unseen with the run unpaused; the re-entry after an exit: 1,982 ms, row 2 → 3. A cold heavy-theme entry is not yet measured. |
| R-09 | BOOT-13 (first gameplay frame under the overlay; warm entries 2.0 s + 0.8 s) | **OPEN** | `cinematic-loading-overlay.js:11` (`GLOBAL_MIN_VISIBLE_MS = 2000`), `main.js:2913` (`dismissCinematicLoadingOverlay(800)`) | **Confirmed:** spawn → overlay `dismissing` 1.95–1.98 s on both entries (the coded 2.0 s minimum, then a 0.8 s fade). |
| R-17 | BOOT-03 (opening waits for the selected theme's whole warm) | **OPEN** | `main.js:2607,2619,2624,5028`; `boot-warp-startup.js:30` (45 s cap); `boot-warp-orchestrator.js:101-108`; Random re-roll `main.js:2544-2546` | Default theme (forest), dev server, cold profile: theme warm 2.68 → 4.53 s; the boot warp waited for theme-ready 5.60 → 6.16 s; handoff complete at **9.61 s**. A heavy theme (neon-district) is not yet measured. |
| R-17 | BOOT-04 (serial waits; floor clock from bootstrap) | **OPEN** | `main.js:488-494,496-504,5028-5032`; `startup-pipeline-state-machine.js:1` (4000); `boot-warp-startup.js:23,499,531-550` | **Confirmed:** the warm finished at 4.53 s but the intro started at 5.03 s, the 4 s floor counted from boot-started (1.02 s); the boot warp then holds its 2.0 s minimum (6.31 → 8.31 s) and fades until 9.61 s. |
| R-17 | BOOT-12 (KPIs miss the wait) | **OPEN** | `startup-pipeline-state-machine.js:134,255-258`; `startup-pipeline-controller.js:69-73`; `startup-debug.js:5,105-121`; `perf-budgets.json:6-10` (baseline null) | **Confirmed:** `startup-pipeline:menu-ready` 1.52 s against `intro-interactive` 9.62 s; the KPI ends 8.1 s before the title is interactive. |
| R-22 | UI-01 (display re-apply, `displays[0]`, bounds) | **PARTLY FIXED** — 61fd001: mode applied only on change (`display-manager.js:146-151`, `main.js:1651-1652`). Open: slider `input` still runs the full apply + overlay realloc per tick (`settings.js:1802-1815`, `main.js:1640-1649`), `displays[0]` (`main.js:1641`), no bounds persistence (`electron/main.js:573-577,650-652`), F/Hub fullscreen bypass (RIT-11) | see cell | pending — Bounds and fullscreen kept while dragging; per-tick frame gaps (procedure: Session B (real app, CDP): B6; ≈ 40 s) |
| R-22 | UI-02 (VSync no-op; "apply right away") | **OPEN** | `frame-rate-controller.js:202-205`; `electron/main.js:196-200`; `index.html:1291-1293,1393`; `settings.js:1707,1812`; slider 50–150 `index.html:1269` vs `desktop-performance-policy.js:7` (1.25) | pending — rAF histogram unchanged by the toggle; AA/scale not live (procedure: B7 (P3 before/after), B8 (screenshots); ≈ 65 s) |
| R-22 | ELEC-13 (VSync stored only; borderless keeps frame; no bounds) | **OPEN** except the re-apply part (61fd001) | `electron/main.js:78,157-177,196-200,573-577,650-652`; no `powerSaveBlocker`/`setAppUserModelId` | pending — Borderless frame/position; VSync no-op (procedure: B6 (also pick Borderless: bounds + screenshot), B7; ≈ in B6/B7) |
| R-22 | REND-04 (DRS persists, overlay-only, 60 samples, never reaches theme, second downscaler) | **OPEN** (+RIT-01 false pressure above refresh, RIT-05 runs after hiding) | `main.js:1044-1051,1073,1116-1127,1136`; `desktop-performance-policy.js:243-291`; `performance-monitor.js:10,415-426,717-723`; `base-theme.js:58-66` | pending — renderScale over time at caps 60 vs 240; persistence; sampling after hide (procedure: B9 (FPS counter on; 60 s per cap, 30 s hidden); ≈ 2.5 min) |
| R-22 | REND-13 (quality reach) | **OPEN** | `main.js:1584-1611` (no `mainBoardScene`, `OnlineMultiplayerMode.js:1014`); `InfinityMode.js:543` + `settings.js:376-378`; `quality.js:186-188` | pending — Cosmic exploration preset/contexts at Low (procedure: B10 (online board: static evidence suffices); ≈ 30 s) |
| R-22 | REND-18 (VSync unread; refresh once; 1 ms unlimited; alpha ignored) | **OPEN** | `frame-rate-controller.js:10,43,50-64,178-181,202-205,377-388,448-457`; `SinglePlayerMode.js:1043-1047` | The game detects **132 Hz** (`frameRateController.monitorRefreshRate`, from rAF) while Windows and Electron report 165 Hz; on this machine RIT-02's first-run policy would therefore write 144, not 240. |
| R-28 | REND-03 (400×800 backing stretched nearest-neighbour) | **OPEN** | `main.js:1356-1358,1421-1423,1454-1462`; `SinglePlayerMode.js:1584-1592` (`resize` doesn't exist in Phaser 4.2.1); `main.css:3950-3959` (`pixelated`); `keystone-solo.css:35-38` | **Confirmed, and worse here than predicted:** the 400 × 800 backing is shown at 328 × 657 CSS px, **0.82×**, on this 1600 × 900 desktop and at **0.71×** in a 1280 × 720 window (DPR 1, `image-rendering: pixelated`): always a nearest-neighbour downscale on this machine. |
| R-29 | REND-01 (no frame driver; 4 gates) | **OPEN** (+RIT-03, RIT-14) | `base-theme.js:1318-1327,1351-1361`; `theme-frame-pacer.js:51,120-138`; `frame-rate-policy.js:21-47`; `background-scene.js:141-150`; `main.js:956-964` | **Confirmed** (Single Player, forest, cap 60, rAF 130.9/s): the board presents 60.1/s in uneven 2- and 3-vsync gaps (244 : 55); the theme 65.7/s in even 2-vsync gaps; the empty WebGL1 overlay is cleared and presented 60.1/s on a theme that never uses it (REND-05 / PIPE-07). |
| R-29 | REND-02 (menu uncapped; new GPUDevice per return; not paused under Settings/Hub) | **OPEN** | `intro-animation.js:270-288,1422-1507`; `threejs-intro-renderer-webgpu.js:228-229,1520-1526`; modal check pointer-only `intro-animation.js:60-66,1030` | **Confirmed:** on the menu the intro canvas presented **98.6/s** against a 60 cap (the page itself reached only ~98 rAF/s there), and a return to the menu requested a **new GPUDevice**. |
| R-29 | REND-07 (Phaser presents unchanged boards) | **OPEN** | `node_modules/phaser/src/core/Game.js:454-498`; `base-board-scene.js:202-203`; only sleeper `odyssey-opponent-board.js:144` | **Confirmed:** Phaser's board canvas presented **46.6/s** on the menu with no board on screen. |
| R-29 | REND-09 (minimized packaged window keeps rendering) | **PARTLY CHANGED** — 6e3b1c5 pauses a local run on minimize (`focus-pause.js:62-72`); loops still run: `electron/main.js:586,687-691`, 'reduce' pauses only the theme `main.js:1268-1281`, packaged 'continue' default dead (`main.js:1155` vs `settings.js:71`) | see cell | pending — Whether rAF runs minimized under `backgroundThrottling:false`; presents and power while minimized (procedure: B5 (manual minimize 20 s, P1 ring buffer, `nvidia-smi`); ≈ 60 s) |
| R-29 | REND-10 (frame-count-tied presentation) | **OPEN** (+RIT-07) | `base-board-scene.js:749-753` via `InfinityMode.js:969-971`; `InfinityMode.js:102,106,114,2093`; `CosmicExplorationEffect.js:326-332,346-347` (deleted 2026-10-16 with the Infinity ascent, INFINITY_ASCENT_2026-10.md: its springs and fades step on real time); `renderer.js:383-385`; `LocalMultiplayerMode.js:770-774` | pending — Infinity camera τ: 72.7 ms at 165 Hz vs 200 ms at 60 Hz (procedure: C4 (P7, run paused), C8 at 60 Hz optional; ≈ 20–60 s) |
| R-29 | REND-12 (fresh Text per combo) | **OPEN** (842b021b removed only Infinity's DOM counter) | `shared-effects.js:1447-1470,1595-1664` | pending — Text/texture growth + long frames per combo (procedure: C5 (P8: 10 × `showComboPopup`); ≈ 15 s) |
| R-29 | REND-14 (analysis integrates one-frame dt) | **OPEN** (+RIT-08 beat cooldown) | `sound-manager.js:65,537-571`; `audio-analyzer.js:16,189-205,270-280`; `intro-animation.js:558`; `OdysseyAudioReactor.js:57-64` | pending — Analyzer clock ratio: 0.46 menu, 1/6 Odyssey at 165 Hz (procedure: C6 (P6, menu only; Odyssey optional ≤ 30 s); ≈ 15 s) |
| R-29 | REND-15 (monitor counts its own rAF) | **OPEN** | `performance-monitor.js:9-11,415-441,888-901`; dup class `performance-utils.js:414-460` | pending — Monitor FPS (≈165) vs board presents (60) (procedure: B2 (`perfMonitor.getMetrics()` vs P1); ≈ in B2) |
| R-29 | REND-16 (idle loops never park) | **OPEN** | `custom-cursor.js:721-746,968-971`; `game.js:1524-1533` | pending — rAF/timer callbacks per second idle and paused (procedure: C7 (CDP trace 10 s menu + 10 s SP); ≈ 30 s (with REND-17)) |
| R-29 | REND-17 (hot-path allocation/DOM/paint) | **OPEN** | `game.js:1513-1533`; `tetromino-style-manager.js:91-101`; `LocalMultiplayerMode.js:748-756`; `draw.js:836-841`; `keystone-solo.css:252-259` | pending — GC/paint events per second (procedure: C7; ≈ in C7) |
| R-29 | REND-20 (dead render-path code) | **OPEN** | `renderer.js:771-782`; `performance-utils.js:150-409`; `src/utils/cache.js` (imported `main.js:119`, never called); `main.js:1903` | pending — nothing (procedure: none; ≈ 0) |

## Instruments (ADR-0016)

ADR-0016 admits a performance number only from a verified instrument, with content-matched
baselines, a pinned station and a quiet machine. Each instrument used or cited here was read
before any of its numbers were used.

| Instrument | What it actually measures | Trust on this machine |
|---|---|---|
| Theme perf lane: `scripts/validate-all-themes.mjs --perf` → worker `scripts/capture-theme-screenshots.mjs --perf`, in-page `scripts/lib/theme-perf-instrument.mjs` | One fresh Electron per theme, `force_high_performance_gpu`, `force-device-scale-factor=1`, a per-theme cold Dawn cache (`capture-theme-screenshots.mjs:97-111`); pins quality High, Target Frame Rate 60 and DRS off and checks the pins held (`theme-perf-instrument.mjs:455-482,660-670`). Records every pipeline creation from document start (sync ones with `ms: null`), switch and first-GPU-work timings, an idle window of page-rAF intervals (`wall`), the summed duration of the theme's `render()` calls per lane frame (`cpuSubmitMs`), resolved GPU timestamps (`gpuMs`), latched draws/triangles, heap and long tasks. Admissibility guards: pins, sticky sampler, contested `renderer.info`, console errors, content match between two visits. | **Good for** pipelines, switch/first-frame timings, CPU submit, draws, heap. **`gpuMs` needs the INS-01 check** and **`wall` is not theme frame time** on this panel (INS-02). Defaults: idle 20 s, settle 4 s (`validate-all-themes.mjs:66-68`). |
| Boot smoothness probe: `scripts/boot-smoothness-probe.mjs` | Fresh-profile (cold) Electron boot against a running dev server, `force_high_performance_gpu` (`:78-83`); every `create*Pipeline*` with caller stack (`:100-123`); page rAF gaps ≥ 50 ms with a compositor canary so a GPU-process stall always shows (`:124-137`); long animation frames for main-thread attribution (`:139-145`); the startup trace; optional mode-entry scenario. | Fit for R-17 and R-09 timings. Dev-server boots include Vite transforms (so does the committed RTX baseline the first audit used). |
| Odyssey perf session: `scripts/odyssey-perf-session.mjs` (+ `perf:odyssey:baseline/compare/nightly`) | Pins adaptive quality off and pixel ratio 1 by default; `force_high_performance_gpu` (`:50-61`); GPU timestamps from the board controller, resolved **right after its own render** (`OdysseyBoardController.js:3170-3190,3915`), so every resolve has new queries; GPU-memory probe. | ADR-0016 compliant. Only one small run is allowed here (CLAUDE.md). |
| `npm run perf:budgets:gate` (`scripts/perf-budgets-gate.mjs`) | Measures nothing: a self-test of the compare tool, a structural lint of `perf-budgets.json`, and committed idle cells checked against the budgets. | `perf-budgets.json` was re-baselined on **this machine** on 2026-08-21 at three **0.185.1**, power mode unrecorded (assume full power). Every comparison with it here carries the Quiet-mode caveat. `frameP95Ms.perSurface.heavy-theme-worst` stays `null` on purpose. |
| `npm run audit:theme-lifecycle` (`scripts/theme-lifecycle-audit.mjs`) | A static AST guard with 10 rules (super calls, inline `.bind`, raw resize listeners, `dispose()` adapters, async teardown, unregistered rAF, renderer init late-retirement, early returns). | Passes at `cde601f8` ("no obvious issues"). It cannot see most leak classes this audit found (INS-04). |
| `validate-all-themes` lifecycle mode (without `--perf`) | The 104-assertion real-app lifecycle check per theme. | It appends `force_high_performance_gpu` only for `--perf` (`capture-theme-screenshots.mjs:97-101`); a 2026-10-13 session recorded **software rendering** in its `gpuDiagnostics` (INS-05). |
| This audit's leak harness (scratch, not committed) | One Electron on the RTX against a private dev server; Single Player started and its simulation paused. Per theme: `anchor → theme → anchor` cycles with a forced GC (CDP) at each return, counting eventBus listeners (the live module singleton), `window`/`document` listeners (CDP `DOMDebugger.getEventListeners`), live `MediaQueryList` listeners, ResizeObservers, live intervals, GPUDevices created/destroyed **and** distinct devices that configure a canvas (two independent hooks), canvases, context kinds, rAF registrations/s, heap, pipelines created (sync/async). Plus theme render cadence, two scripted gameplay bursts through the game's own emitters (`src/events/gameplay-events.js`), frame gaps, GC count, and reduced-motion motion energy (mean absolute luminance difference of frames 1 s apart) for default, in-game setting live and rebuilt, and OS media (CDP emulation) live and rebuilt. | Verified by two smoke runs (aurora, anchor tornado). The two device counters agree after a fix: a normal `destroy()` resolves `device.lost` with `reason: 'destroyed'`, which the first version counted as an error, the same trap as PIPE-09. Motion energy is an observation, not a measurement: it depends on the scene's own motion at that moment. |

### Instrument findings (INS)

| ID | Instrument | Finding | Sev | Cat | Evidence | Proof |
|---|---|---|---|---|---|---|
| INS-01 | theme perf lane | **The lane's GPU sampler is not frame-locked to the theme's render.** It resolves on its own rAF tick (`theme-perf-instrument.mjs:262-272`, `resolveRender` at `:245-260`). In three r186, a resolve with no new queries returns the pool's `lastValue` (`node_modules/three/src/renderers/webgpu/utils/WebGPUTimestampQueryPool.js:98-100`) and `Backend.resolveTimestampsAsync` writes it back to `info.render.timestamp` (`common/Backend.js:623-625`), so the lane re-pushes a stale sample on every tick where the theme did not render. On any panel faster than the pinned cap (here ~131.6 Hz vs ~65.8 renders/s) `gpuMs` becomes dwell-weighted, the bias ADR-0016 forbids; the sticky-sampler guard (`:562`) only fires when samples ≥ frames. The two reference samplers resolve right after their own render (`OdysseyBoardController.js:3915`; `src/playground/main.js:741`) and are not affected. | Med | Bug | VERIFIED (mechanism; runtime: GPU samples 1.4–1.9× the rendered frames in batch 1) | Protocol for this audit: treat `idle.gpuMs` as admissible only when `gpuMs.samples ≤ cpuSubmitMs.samples` (one push per lane frame that rendered). Fix: resolve only when a render happened since the last resolve (e.g. `cpuAccumMs > 0` that tick). |
| INS-02 | theme perf lane | **`idle.wall` is the page's rAF cadence, not the theme's frame time,** whenever the theme is capped below the refresh: here p50 ≈ 7.6 ms regardless of the theme, and `overBudget` counts only rAF stalls above 16.7 ms. On a 60 Hz panel the two coincide, which is how the lane was designed and validated. | Low | Improvement | VERIFIED | `theme-perf-instrument.mjs:264-272` (`S.rings.wall.push(t - S.lastFrameAt)` per lane tick), `:557` |
| INS-03 | theme perf lane | **Defaults that silently change the measurement:** `PERF_LANE_DEFAULTS.idleMs` is 20,000 while committed cells were taken at 10,000; the 4 s settle lets the asynchronous resolution-tier pin land inside the idle window for fast-switching themes. Pass `--perf-idle-ms` and `--perf-settle-ms` explicitly. | Low | Improvement | VERIFIED | `validate-all-themes.mjs:66-68` |
| INS-04 | `audit:theme-lifecycle` | **The static guard is blind to the leak and contract classes this audit found:** eventBus subscriptions, `matchMedia` listeners, render targets and TSL-only textures, per-frame allocation, warm coverage, render-throttle bypass, pause-time handlers. It passes while THM-180/181/228/229 exist. | Low | Improvement | VERIFIED | `scripts/theme-lifecycle-audit.mjs:1-23` (rule list); passes at `cde601f8` |
| INS-05 | `validate-all-themes` (lifecycle mode) | **Lifecycle validation may not run on the GPU:** the worker requests the discrete GPU only in perf mode, and a 2026-10-13 run recorded software rendering in `gpuDiagnostics`. Its start timings are then software timings, and WebGPU validation errors cannot appear. | Med | Improvement | PLAUSIBLE (read `results/<id>.json` `gpuDiagnostics` of one lifecycle run) | `scripts/capture-theme-screenshots.mjs:97-101` (`if (PERF_LANE_ENABLED) { app.commandLine.appendSwitch('force_high_performance_gpu'); …`) |

## Runtime measurements

All rows: **seen in Quiet mode**, on AC, on the RTX 3070 (each run re-read the game's
`[GPU] Active Renderer` line and the WebGPU adapter), desktop 1600 × 900, rAF ≈ 131 Hz. No run
saw a driver reset (Windows System log, IDs 4101/4116/4119 and display/`nvlddmkm`/`amdkmdag`
providers), and `nvidia-smi` (1 Hz) showed no hardware or thermal slowdown in any run.

### Runtime batch 1 — lifecycle, leaks, gameplay bursts, reduced motion (2026-10-14, 09:35–10:05)

**Setup.** The leak harness (see [Instruments](#instruments-adr-0016)) on a private Vite dev server,
Single Player started and its simulation paused, anchor theme **tornado**, three
`anchor → theme → anchor` cycles per theme. Switch times are dev-server times (module transforms
included), so read them relative to each other. Pipelines are WebGPU pipelines; classic-WebGL
program compiles are not counted. A peer session's GPU job ran just before batch 1a (serialized by
the shared lock, never concurrent).

| Theme | Switch-in (cycles 1/2/3) | Pipelines at switch-in (sync / async) | Theme frames/s (rAF ≈ 131/s) | Gameplay burst 1 → burst 2 | Minor GCs per burst (~9.5 s) | Anchor heap after each cycle | Listeners, bus, `matchMedia`, devices | Reduced-motion energy: default / setting live / setting rebuilt / OS live / OS rebuilt | Visual |
|---|---|---|---|---|---|---|---|---|---|
| aurora (smoke runs) | 2.59 / 2.51 s | 23 / 0 | 65.2–65.5 | 0 pipelines, no gap ≥ 50 ms → same | 41 / 36 | 107.1 / 106.9 MB | constant (92 window listeners, 27 bus, 4, 1) | not run | — |
| forest | 3.47 / 3.54 / 3.45 s | **127 / 0** | 65.4 | 0 pipelines, no gap → same | **198 / 170** | 103.9 / 104.1 / 103.7 MB | constant | 5.61 / 7.02 / 5.73 / 6.53 / 5.89 → **no reduction** | correct (moonlit forest, fireflies, fog) |
| cosmic-noir | 2.79 / 2.44 / 2.41 s | 16 / 8 | 65.2 | **5 sync pipelines, one 89 ms gap** → 0, none | 27 / 19 | 109.7 / 109.3 / 109.3 MB | constant | 11.92 / 14.59 / 13.54 / 14.26 / 12.74 → **no reduction** | black hole and nebula correct; starfield only 1-px dots (consistent with THM-120) |
| misty-lake | 3.28 / 2.16 / 2.10 s | 0 / 0 (classic WebGL) | **130.6 (every vsync)** | **gaps of 60 and 54 ms** → none | 25 / 23 | 109.1 / 108.7 / 108.6 MB | constant | 2.25 / 2.23 / 2.27 / 2.24 / 2.27 → **no reduction** | renders; legacy look: untextured trapezoid trunks with dark slabs below the nearest two (likely clipped reflections) |
| wolfhour | 3.04 / 2.64 / 2.60 s | 16 / 6 | 65.7 | **14 sync pipelines, gaps of 75 and 91 ms** → 0, none | 18 / 9 | 121.8 / 121.4 / 122.3 MB (+13 MB resident after the first visit, then flat) | constant | 5.88 / 5.80 / 5.83 / 5.92 / 5.87 → **no reduction** | correct (moonlit ridge, starfield) |

**GPU power by theme window** (`nvidia-smi`, per-minute means, anchor intervals included): forest and
cosmic-noir 23–30 W at 0.65–1.0 GHz; wolfhour 25–36 W; **misty-lake 67–78 W at 1.57–1.78 GHz**
(peak 95 W of the 115 W cap).

**What batch 1 settles:**
- **No accumulating leak in menu-context switching** for these five themes: window and document
  listeners, eventBus subscriptions, live `matchMedia` listeners, live GPUDevices (one created and
  one destroyed per visit, cross-checked by two independent hooks) and heap after a forced GC are
  flat across three cycles. This does not exercise the packaged-Windows restart path of THM-228.
- **THM-118 (cosmic-noir) and THM-227 (wolfhour) confirmed at runtime:** the first gameplay burst
  creates pipelines synchronously and stalls the page for 89 ms and 91 ms; the second burst creates
  none. The stall *durations* are borderline (compile time is CPU-bound and Quiet mode slows it):
  re-measure once in Performance mode; the *existence* of the stall does not depend on the mode. forest and aurora create none, so their warm covers play.
- **THM-180 (misty-lake) confirmed at runtime:** it renders on every vsync (130.6 frames/s against
  ~65.5 for capped themes) and draws 2.5–3× the GPU power of the other themes.
- **Reduced motion:** none of the four themes moved less with the in-game setting or with the OS
  preference, live or after a rebuild, which matches the static reading (forest reads only the OS
  query and only stops pointer lean; the other three read neither). Motion energy is an observation:
  it depends on what the scene happens to be doing.
- **Switch-in is dominated by synchronous pipeline creation outside a loading surface.** forest
  creates all 127 of its pipelines synchronously on every entry, because each visit gets a fresh
  device. This is the cost a mid-run level-theme switch (LIFE-04) pays with no cover.
- **Allocation pressure:** forest saw ~20 minor GCs per second during bursts against 2–4 for the
  other themes, consistent with THM-156/157. Not yet attributed; a heap-allocation profile would.


#### Batch 1 on the theme perf lane (production build, 10:09–10:15)

`validate-all-themes.mjs --perf --perf-idle-ms 10000 --perf-settle-ms 12000`, one fresh Electron per
theme with a cold Dawn cache, pins High / 60 fps / DRS off (held in every cell), production preview
on a private port. All four passed the lifecycle part (0 console errors, 0 process failures).
**The lane marks every cell inadmissible**, and the reasons are instructive:

- forest, cosmic-noir and wolfhour reset `renderer.info` themselves, so the latched draw counts are
  partial frames ("contested"); wolfhour's two visits also differed by 2 draws.
- misty-lake is a classic `WebGLRenderer`: no timestamps, so the content guard has no draw counts.
- **INS-01 confirmed at runtime:** GPU samples exceed the frames that rendered by 1.4–1.9× (forest
  933 vs 654, cosmic-noir 1,180 vs 657, wolfhour 1,232 vs 658); the stale `lastValue` re-pushes
  are in the data, so the lane's `gpuMs` percentiles are not used here.

What is still usable (single run each, **seen in Quiet mode**, read relative to each other):

| Theme | First frame GPU-complete after the switch (cold cache) | Switch wall | Pipelines (sync / async; after first frame) | CPU in `render()` per rendered frame p50 / p95 / p99 | Long tasks | Peak heap |
|---|---|---|---|---|---|---|
| forest | **6,051 ms** | 985 ms | 127 / 0; 0 | **7.2 / 8.9 / 10.3 ms** | 0 | 70.5 MB |
| cosmic-noir | 2,901 ms | 807 ms | 16 / 8; 0 | 2.8 / 3.3 / 3.5 ms | 0 | 42.8 MB |
| wolfhour | 2,940 ms | 347 ms | 16 / 6; **3** | 2.7 / 3.3 / 3.6 ms | 0 | 42.0 MB |
| misty-lake | 2,192 ms | 89 ms | classic WebGL | 0.7 / 1.0 / 1.1 ms over **1,311 renders in 1,311 frames** (uncapped) | 0 | 35.7 MB |

- **forest, the starter theme, is the heaviest of the four on both axes:** a 6.1 s cold first frame
  (127 synchronous pipelines; the switch call returns after 1 s and the GPU process blocks at first
  draw) and ~2.6× the CPU per rendered frame inside `render()` of the other themes. At the default
  cap that is 7.2 ms of a ~15.2 ms render interval, on the CPU, before its firefly simulation.
- **Borderline, re-measure once in Performance mode at the machine:** forest's 6.05 s cold first frame and 7.2 ms CPU per frame (shader compiles and CPU submit are exactly what Quiet mode slows). The owner was working remotely on 2026-10-14 and the Lenovo mode cannot be switched remotely without admin, so these stay Quiet-mode numbers.
- The switch wall (`switchWallMs`) understates the player-facing cost by 2–6×; judge on the
  first-frame number (the lane's own documentation says the same).
### Runtime batch 2 — R-session: the shipped boot, Single Player entry, exit and re-entry (10:16–10:18)

**Setup.** One Electron run (scratch `rsession.mjs`) on the RTX against the dev server, **booting
with the intro** (the shipped path; cold profile), background theme pinned to forest, Enter pressed
at the title, then: 5 s of per-canvas presents on the menu; Single Player entry with the RITEM P2
recorder; 5 s of presents in play; board geometry at the 1600 × 900 desktop and in a 1280 × 720
window; exit through `EXIT_TO_MAIN_MENU`; re-entry. Results per item are in
[Re-checked GPU items](#re-checked-gpu-items); the lifecycle trace is here.

**PIPE-01 confirmed at runtime, on both paths:**

| Time (page) | ThemeManager / BaseTheme line | What it means |
|---|---|---|
| 2.90 → 4.75 s | `Pre-warming theme (hidden): forest` → `Theme pre-warmed + parked for instant first entry: forest` | the boot warm, 1.85 s of hidden build and compile |
| 11.71 s (menu shown) | `Cancelling in-flight activation for suspension: forest` → `Cleaning up theme: forest` | **the parked warm is disposed by the second suspend** |
| 15.54 → 17.07 s | `Pre-warming theme (hidden): forest` → `… parked …` | the deferred warm rebuilds it (a mode entry before ~17 s would be cold or race it, PIPE-02/05) |
| 23.33 s (entry 1) | `Attempting quick resume for theme: forest` | the good path, on the second warm |
| 52.33 s (exit) | `Suspending active theme` → `renderer preserved for quick resume` → 63 ms later `Cancelling in-flight activation for suspension: forest` → `Cleaning up theme: forest` | **the suspended runtime is disposed** |
| 58.38 s (entry 2) | `Loading a fresh theme identity for resume: forest` → `Activating theme` → `Theme activation complete` (0.9 s) | a cold rebuild where a quick resume was intended |

**Devices:** the session requested 5 GPUDevices: the warm device, the intro/boot warp, the deferred
theme warm, **one at the return to the menu** (REND-02), and the re-entered theme.

### Runtime batch 3 — tornado, geode, rainy-window, sky-children (10:21–10:30)

Same harness and protocol as batch 1, anchor **aurora** (clean in the smoke runs), plus an idle
minor-GC rate taken during the 4 s cadence window. The owner was working remotely, so the borderline
re-measurements in Performance mode could not be taken (see batch 1).

| Theme | Switch-in (cycles 1/2/3) | Pipelines at switch-in | Theme frames/s | Idle minor GCs/s | Gameplay burst 1 → burst 2 | Minor GCs per burst | Anchor heap after each cycle | Listeners, bus, `matchMedia`, devices | Reduced-motion energy: default / setting live / setting rebuilt / OS live / OS rebuilt | GPU power (theme window) |
|---|---|---|---|---|---|---|---|---|---|---|
| tornado | 3.14 / 2.59 / 2.57 s | 26 / 0 | 65.4 | 6.0 | **5 sync pipelines, gaps of 97 and 271 ms** → 0, none | 24 / 16 | 96.4 / 96.6 / 96.5 MB | constant | 6.99 / 6.26 / 7.31 / 6.21 / 7.38 → no measurable drop | 28–29 W |
| geode | 3.01 / 2.73 / 2.80 s | 17 / 0 | 65.2 | 3.2 | 0 pipelines, no gap → same | 47 / 46 | 102.0 / 102.2 / 102.0 MB | constant | 4.84 / 1.78 / 1.78 / 1.77 / 1.78 → **−63 %, live and rebuilt** | 27–28 W |
| rainy-window | 4.23 / 2.31 / 2.32 s | 0 / 0 (classic WebGL) | **131.2 (every vsync)** | 5.5 | 0 pipelines, no gap → same | 50 / 48 | 104.9 / 105.9 / 106.1 MB (+0.6 MB per cycle, not separable from noise in 3 cycles) | constant | 7.27 / 12.97 / 9.77 / 21.05 / 6.65 → inconclusive (lightning flashes dominate) | **71–90 W** |
| sky-children | 3.32 / 2.88 / 2.86 s | 22 / 0 | 65.7 | **16.2** | 0 pipelines, no gap → same | **168 / 91** | 132.4 / 133.0 / 133.1 MB | constant | 2.52 / 1.64 / 1.73 / 1.63 / 1.74 → **−31 %, live and rebuilt** | 30–31 W |

**What batch 3 settles:**
- **THM-70 (tornado) confirmed at runtime, with the largest stall measured:** the first burst
  compiles the parked vortices and dust front synchronously, with a **271 ms** frame gap (duration
  borderline in Quiet mode; the stall itself is mode-independent).
- **THM-229 (rainy-window) confirmed:** it renders every vsync and, like misty-lake, draws ~3× the
  GPU power of the WebGPU themes. The two classic holdouts are the fleet's power outliers.
- **THM-25 (sky-children) confirmed:** ~16 minor GCs per second at idle against 3–6 for every other
  theme measured, from the per-puff `subarray` views; no frame gap ≥ 50 ms on this machine.
- **THM-46 (geode) regraded High → Med:** with real lock, Tetris and cascade bursts the GC rate and
  frame gaps match a clean theme.
- **The motion-energy method works where a theme really reduces motion:** geode −63 %, sky-children
  −31 %, with the in-game setting live as well as after a rebuild. tornado reads both inputs, but
  what it calms (camera, rope, wander) is not what moves most of its frame.
- No accumulating leak in any of the four.
### Runtime batch 4 — Odyssey, one small session (10:30–10:32)

**Setup.** One Electron run (scratch `odyssey-session.mjs`) on the RTX against the **production
preview**, fresh profile (so the map opens on chapter 1; no journey, no chapter jump, per CLAUDE.md),
intro skipped. Three `menu → Odyssey → idle 15 s → menu` cycles, with a forced GC before each
reading, then one abort 1.5 s into a board build followed by an immediate re-entry. Exits go through
the app's own `_returnToMainMenu()`.

| Reading | Menu (baseline) | Cycle 1 | Cycle 2 | Cycle 3 | After abort + re-entry |
|---|---|---|---|---|---|
| Enter → map revealed | — | 3.17 s | 2.78 s | 3.13 s | 2.77 s (board present) |
| Presents/s at map idle (rAF ≈ 130/s, cap 60) | — | board 130.6 | board 129.3 + **intro 129.3** | board 128.9 + **intro 128.9** | — |
| Pipelines created after the reveal (sync / async) | — | 0 / 48 | 0 / 48 | 0 / 48 | — |
| Heap at map idle / back on the menu (after GC) | 41.7 MB | 131.3 / 95.8 MB | 157.7 / 96.0 MB | 159.4 / 96.5 MB | 208.4 / **143.9 MB** |
| GPU-process private memory, back on the menu | 873.7 MB | 1,213.7 MB | 1,244.7 MB | 1,258.3 MB | **1,425.6 MB** |
| Devices created / destroyed (board on the shared device) | 1 / 0 | 3 / 1 | 3 / 1 | 3 / 1 | 3 / 1 |
| `document` wheel / `window` resize listeners on the menu | 2 / 5 | 2 / 8 | 2 / 8 | 2 / 8 | 2 / 8 |
| GPU power (per-minute means) | — | 33 W | 53 W | 85 W (incl. abort) | |

**What batch 4 settles:**
- **REND-08 / ODYR-03 confirmed:** the map renders every vsync against a 60 cap.
- **ODYR-27 (new):** after a return to the menu, the menu intro renderer keeps presenting at full rate
  under the Odyssey board, doubling the full-rate WebGPU renderers during play.
- **ODYR-01 shown at runtime through memory, not listeners:** the aborted build kept running after
  `Disposed` (its prewarm failed 42 ms later on `Texture already initialized`), and +47 MB of heap and
  +167 MB of GPU-process memory stayed resident after the next exit. ODYR-02's empty map did not
  reproduce at this abort offset.
- **The default path creates no synchronous pipeline after the reveal** (0 in every cycle; the 48
  asynchronous ones are the background warm drain by design).
- The first Odyssey visit leaves ~54 MB of heap and ~340 MB of GPU-process memory resident (module
  caches, world bakes); later visits add +31 and +14 MB GPU-process memory, so ODYR-05's per-entry
  residue is plausible but not settled in three cycles. The `window` resize listeners go 5 → 8 once,
  then stay flat.

### Runtime batch 5 — himalayan-peak, murmuration, neon-dusk, nimbus-veil (10:37–10:46)

Same harness and protocol as batch 3 (anchor aurora).

| Theme | Switch-in (cycles 1/2/3) | Pipelines at switch-in | Theme frames/s | Idle minor GCs/s | Gameplay burst 1 → burst 2 | Minor GCs per burst | Anchor heap after each cycle | Listeners, bus, `matchMedia`, devices | Reduced-motion energy: default / setting live / setting rebuilt / OS live / OS rebuilt | GPU power |
|---|---|---|---|---|---|---|---|---|---|---|
| himalayan-peak | 3.28 / 3.03 / 3.12 s | 22 / 0 | 65.4 | 4.0 | 0 pipelines, no gap → same | 36 / 32 | 108.4 / 108.3 / 108.4 MB | constant | 3.93 / 2.14 / 2.14 / 2.14 / 2.12 → **−45 %, live and rebuilt** | 28–35 W |
| murmuration | 2.37 / 2.22 / 2.26 s | 12 / 0 | 65.2 | 3.5 | 0 pipelines, no gap → same | 31 / 32 | 113.4 / 113.4 / 113.8 MB | constant | 15.08 / 15.37 / 15.03 / 15.34 / 15.07 → no measurable drop (only the camera calms; the swarm fills the frame) | 36–39 W |
| neon-dusk | 2.34 / 2.31 / 2.32 s | 17 / 0 | 65.5 | 7.2 | 0 pipelines, no gap → same | 40 / 34 | 104.6 / 104.5 / 104.7 MB | constant | 6.09 / 5.91 / 6.20 / 5.69 / 5.61 → no reduction (reads neither) | 23–24 W |
| nimbus-veil | 2.21 / 2.27 / 2.25 s | 15 / 0 | 65.7 | 3.2 | 0 pipelines, no gap → same | 31 / 30 | 107.1 / 107.1 / 107.0 MB | constant | 2.08 / 2.21 / 2.06 / 2.22 / 2.06 → no reduction (reads neither) | 23 W |

**What batch 5 settles:**
- No leak and no first-burst compile in any of the four. himalayan-peak's late eagle (THM-100) did
  not show: on the dev server the model lands inside the 3 s settle; a cold production start is the
  case still to check.
- The per-range upload storms predicted for neon-dusk (THM-189) and nimbus-veil (THM-178) produced no
  frame gap ≥ 50 ms in the scripted bursts.
- Reduced motion: himalayan-peak −45 % (works); murmuration reads both inputs but what it calms is not
  what fills the frame; neon-dusk and nimbus-veil read neither, as the static pass found.
- Visual check (default frames): himalayan-peak (dusk peak, prayer flags, stupa, cloud sea) and
  murmuration (compute swarm) render correctly.
### Runtime batch 6 — synthwave-sunset, chromadelic-highway, crystal-cave, moonrise-summit (10:46–10:55)

Same harness and protocol as batch 3 (anchor aurora).

| Theme | Switch-in (cycles 1/2/3) | Pipelines at switch-in | Theme frames/s | Idle minor GCs/s | Gameplay burst 1 → burst 2 | Minor GCs per burst | Anchor heap after each cycle | Listeners, bus, `matchMedia`, devices | Reduced-motion energy: default / setting live / setting rebuilt / OS live / OS rebuilt | GPU power |
|---|---|---|---|---|---|---|---|---|---|---|
| synthwave-sunset | 2.31 / 2.28 / 2.28 s | 17 / 0 | 65.2 | 7.0 | 0 pipelines, no gap → same | 45 / 31 | 104.8 / 104.7 / 105.1 MB | constant | 5.52 / 5.40 / 5.82 / 5.49 / 5.76 → no reduction (reads neither) | 22–26 W |
| chromadelic-highway | 3.00 / 2.29 / 2.37 s | 20 / 0 | 65.7 | 3.5 | 0 pipelines, no gap → same | 33 / 31 | 110.0 / 110.4 / 110.5 MB | constant | 9.87 / 11.39 / 9.95 / 10.60 / 10.22 → no reduction (reads neither) | 22 W |
| crystal-cave | 2.35 / 2.37 / 2.38 s | 23 / 0 | 65.5 | 8.5 | 0 pipelines, no gap → same | 49 / 38 | 105.9 / 105.6 / 105.6 MB | constant | 3.96 / 3.73 / 3.98 / 3.74 / 3.93 → no reduction (reads neither) | 29–31 W |
| moonrise-summit | 3.60 / 2.51 / 2.51 s | 0 / 0 (classic WebGL) | 65.4 (capped) | 1.5 | 0 pipelines, no gap → same | 13 / 12 | 109.4 / 108.7 / 108.7 MB | constant | 2.21 / 2.18 / 2.21 / 2.19 / 2.22 → no reduction | 28–29 W |

**What batch 6 settles:**
- No leak and no first-burst compile in any of the four; synthwave-sunset's per-spark update ranges
  (THM-59) cause no frame gap in the bursts.
- moonrise-summit, the third classic-WebGL holdout, respects the frame cap (it runs through
  `safeAnimate`), so the power outliers are only misty-lake and rainy-window. Its packaged-Windows
  restart leak (THM-228) is not reachable from this harness.
- crystal-cave idles at 8.5 minor GCs/s (CPU spark pool, THM-149), the third highest measured after
  sky-children and forest.
- Reduced motion: no measurable change in any of the four, which matches the static pass (three read
  neither input; moonrise-summit reads only the OS query, and its OS-emulated rebuild did not change
  the motion either).
### Runtime batch 7 — summer, verdant-hills, golden-forest, sakura-twilight (10:55–11:05)

Same harness and protocol as batch 3 (anchor aurora). All four run CPU particle simulations and read
reduced motion from the OS query only.

| Theme | Switch-in (cycles 1/2/3) | Pipelines at switch-in | Theme frames/s | Idle minor GCs/s | Gameplay burst 1 → burst 2 | Minor GCs per burst | Anchor heap after each cycle | Listeners, bus, `matchMedia`, devices | Reduced-motion energy: default / setting live / setting rebuilt / OS live / OS rebuilt | GPU power |
|---|---|---|---|---|---|---|---|---|---|---|
| summer | 4.76 / 4.37 / 4.15 s | **263 / 0** | 65.3 | 6.2 | 0 pipelines, no gap → same | 127 / 90 | 112.7 / 113.1 / 113.4 MB | constant | 16.82 / 16.64 / 14.41 / 16.67 / 14.40 → inconclusive (the −14 % after a rebuild appears with the in-game setting too, which summer does not read: scene drift) | 27–30 W |
| verdant-hills | 2.94 / 2.81 / 2.72 s | 62 / 0 | 65.6 | 5.5 | 0 pipelines, no gap → same | **281 / 224** | 120.9 / 121.5 / 121.4 MB | constant | 11.76 / 10.32 / 11.68 / 10.33 / 11.77 → no reduction | 43–45 W |
| golden-forest | 3.78 / 3.39 / 3.26 s | **185 / 0** | 65.7 | 6.2 | 0 pipelines, no gap → same | 134 / 83 | 106.3 / 107.0 / 107.1 MB | constant | 4.18 / 3.84 / 4.18 / 3.85 / 4.16 → no reduction | 28–30 W |
| sakura-twilight | 3.46 / 3.51 / 3.54 s | 101 / 0 | 65.1 | **13.5** | 0 pipelines, no gap → same | **263 / 231** | 115.2 / 115.4 / 115.6 MB | constant | 11.58 / 11.51 / 11.17 / 11.17 / 11.70 → no reduction | 29–30 W |

**What batch 7 settles:**
- **The CPU-simulation themes carry the fleet's GC pressure.** In bursts, verdant-hills (281/224) and
  sakura-twilight (263/231) produce 5–8× the minor GCs of a clean theme (aurora 37–41), with
  summer and golden-forest at 3–4×. This confirms THM-95/96, THM-240/241, THM-72 and the forest
  results (batch 1). None produced a frame gap ≥ 50 ms on this machine, so the cost is CPU time and
  battery rather than visible hitches here.
- **Synchronous pipeline counts at switch-in vary 20×:** summer 263, golden-forest 185, forest 127,
  sakura-twilight 101, against 12–26 for most themes. These are the themes a mid-run level switch
  (LIFE-04) freezes longest.
- No leak and no first-burst compile in any of the four. The anchor heap creeps by ~0.3 MB per cycle
  after summer and golden-forest, too little to separate from noise in three cycles.
- Reduced motion: no measurable change in any of the four. That matches the static pass: all four
  read the OS query only, and use it only to stop pointer parallax, which the harness never moves.
### Runtime batch 8 — fall, moonlit-forest, neon-district, kaleidosonic (11:05–11:14)

Same harness and protocol as batch 3 (anchor aurora).

| Theme | Switch-in (cycles 1/2/3) | Pipelines at switch-in | Theme frames/s | Idle minor GCs/s | Gameplay burst 1 → burst 2 | Minor GCs per burst | Anchor heap after each cycle | Listeners, bus, `matchMedia`, devices | Reduced-motion energy: default / setting live / setting rebuilt / OS live / OS rebuilt | GPU power |
|---|---|---|---|---|---|---|---|---|---|---|
| fall | 3.03 / 3.01 / 3.88 s | 107 / 0 | 65.2 | 5.5 | 0 pipelines, no gap → same | 115 / 76 | 105.1 / 106.4 / 106.4 MB | constant | 4.72 / 4.72 / 4.70 / 4.54 / 4.52 → no reduction (OS only, parallax only) | 27–30 W |
| moonlit-forest | 4.30 / 2.72 / 2.73 s | **9 / 29 (mostly async)** | 65.7 | **1.7** | 0 pipelines, no gap → same | 14 / 13 | 108.9 / 109.1 / 109.2 MB | constant | 0.145 / 0.154 / 0.142 / 0.154 / 0.143 → a very still scene; no reduction | 21–22 W |
| neon-district | 3.23 / 2.66 / 2.80 s | 48 / 0 | 65.2 | 4.2 | 0 pipelines, no gap → same | 37 / 37 | 108.1 / 108.0 / 108.0 MB | constant | 14.63 / 7.51 / 4.08 / 4.75 / 3.51 → **−72 to −76 %** (the camera sway and street scroll it stops dominate; the storm flicker THM-35 leaves on is not separable by this metric) | 30 W |
| kaleidosonic | 2.31 / 2.24 / 2.27 s | 9 / 0 | 65.4 | 3.2 | 0 pipelines, no gap → same | 32 / 32 | 112.4 / 112.6 / 112.7 MB | constant | 10.99 / 8.83 / 9.86 / 8.75 / 9.90 → −10 to −20 % (the refold morph stays, THM-104) | **63–66 W** |

**What batch 8 settles:**
- moonlit-forest is the one theme measured that compiles most of its switch-in pipelines
  asynchronously (the ADR-0020 path) and has the lowest idle GC rate; it is the in-repo model for the
  P2 recommendation.
- kaleidosonic's full-screen ray-marched temple is the most expensive WebGPU theme measured on the
  GPU (63–66 W at 1.6–1.7 GHz, against 21–39 W for the others), below only the two uncapped
  classic holdouts.
- No leak and no first-burst compile in any of the four. Visual check: moonlit-forest renders
  correctly (low-poly glade, pond, fireflies).
## Progress tracker

Static = the code-review pass; Runtime = measured on this machine (always "seen in Quiet mode").

### Themes

| # | Theme | Batch | Static audit | Runtime audit |
|---|---|---|---|---|
| 1 | aether-tides | B6 | done · 0/0/1/4 · RM: setting + OS, live | not started |
| 2 | astral-weave | B4 | done · 0/0/0/6 · RM: setting + OS, live | not started |
| 3 | aurora | B8 | done · 0/0/0/4 · RM: setting + OS, live | batch 1 (smoke): no leak over 2 cycles; bursts compile nothing; 65.2–65.5 fps |
| 4 | bioluminescence | B8 | done · 0/0/1/3 · RM: setting + OS, live | not started |
| 5 | black-hole | B7 | done · 0/0/1/5 · RM: setting + OS, live | not started |
| 6 | blood-moon | B1 | done · 0/0/2/2 · RM: setting + OS, live | not started |
| 7 | chiral-gold | B3 | done · 0/0/0/3 · RM: setting + OS, live | not started |
| 8 | chromadelic-highway | B3 | done · 0/0/2/5 · RM: neither | batch 6: no leak; bursts clean; RM no effect |
| 9 | chromatic-impasto | B7 | done · 0/0/1/4 · RM: setting + OS, live | not started |
| 10 | cinder-drift | B4 | done · 0/0/1/7 · RM: setting + OS, live | not started |
| 11 | cosmic-noir | B3 | done · 0/2/4/5 · RM: neither | batch 1: no leak; THM-118 confirmed (5 sync, 89 ms gap); RM no effect; stars 1 px · perf lane: first frame 2.90 s, CPU 2.8 ms |
| 12 | crystal-cave | B3 | done · 0/0/1/3 · RM: neither | batch 6: no leak; bursts clean; idle 8.5 GCs/s; RM no effect |
| 13 | fall | B5 | done · 0/0/3/4 · RM: OS only, parallax only | batch 8: 107 sync pipelines; 115/76 GCs per burst; no leak; RM no effect |
| 14 | fluid-dreams | B4 | done · 0/0/0/7 · RM: setting + OS, live | not started |
| 15 | forest | B4 | done · 0/0/3/4 · RM: OS only, pointer lean only · STARTER | batch 1: no leak (3 cycles); bursts clean; ~20 GCs/s in bursts; RM no effect; visual OK · perf lane: first frame 6.05 s cold (127 sync), CPU render 7.2 ms p50 |
| 16 | galaxy | B2 | done · 0/0/0/3 · RM: setting + OS, live | not started |
| 17 | geode | B1 | done · 0/1/1/2 · RM: setting + OS, live | batch 3: no leak; bursts clean (THM-46 regraded Med); RM works (−63 %) |
| 18 | golden-forest | B1 | done · 0/0/2/3 · RM: OS only | batch 7: 185 sync pipelines per entry; 134/83 GCs per burst; no leak; RM no effect |
| 19 | halcyon-apex | B6 | done · 0/0/1/3 · RM: setting + OS, live | not started |
| 20 | high-coast | B6 | done · 0/0/2/4 · RM: setting + OS, live | not started |
| 21 | himalayan-peak | B7 | done · 0/0/2/3 · RM: setting + OS, live | batch 5: no leak; bursts clean (THM-100 not seen on dev server); RM works (−45 %); visual OK |
| 22 | ice-temple | B2 | done · 0/0/0/3 · RM: setting + OS, live | not started |
| 23 | kaleidosonic | B7 | done · 0/0/1/5 · RM: setting + OS (refold morph stays) | batch 8: no leak; bursts clean; RM −10 to −20 % (refold stays); 63–66 W |
| 24 | koi-pond | B8 | done · 0/0/1/4 · RM: setting + OS, live | not started |
| 25 | luminous-tides | B8 | done · 0/0/1/3 · RM: setting + OS, camera only | not started |
| 26 | lunara | B4 | done · 0/0/0/5 · RM: setting + OS, live | not started |
| 27 | misty-lake | B6 | done · 0/2/4/4 · RM: neither · legacy WebGL stack | batch 1: no leak; THM-180 confirmed (130.6 fps, 67–78 W); first-burst gaps 60/54 ms; RM no effect · perf lane: first frame 2.19 s, renders every frame |
| 28 | moonlit-forest | B6 | done · 0/1/1/4 · RM: OS only (pulses ×0.45) | batch 8: mostly async compile (9 sync / 29 async); idle 1.7 GCs/s; no leak; visual OK; THM-182 not exercised |
| 29 | moonlit-greenhouse | B3 | done · 0/0/0/1 · RM: setting + OS, camera only | not started |
| 30 | moonrise-summit | B5 | done · 0/1/2/4 · RM: OS only · classic WebGL, light profile | batch 6: capped (65.4 fps); no leak in normal switching (THM-228 path not reachable); RM no effect |
| 31 | murmuration | B4 | done · 0/1/1/7 · RM: setting + OS, camera only, no OS listener | batch 5: no leak; bursts clean; RM no measurable drop (camera only); visual OK |
| 32 | nebula-flow | B6 | done · 0/0/1/2 · RM: setting + OS (flashes stay) | not started |
| 33 | neon-district | B1 | done · 0/0/3/4 · RM: setting + OS, live (flicker sources ungated) | batch 8: no leak; bursts clean; RM −72 to −76 % (flicker not separable) |
| 34 | neon-dusk | B6 | done · 0/0/4/3 · RM: neither | batch 5: no leak; bursts clean (no gap from THM-189); RM no effect |
| 35 | nimbus-veil | B4 | done · 0/0/2/3 · RM: neither | batch 5: no leak; bursts clean (no gap from THM-178); RM no effect |
| 36 | ocean | B6 | done · 0/0/0/2 · RM: setting + OS, live | not started |
| 37 | painted-ages | B5 | done · 0/0/0/3 · RM: setting + OS, live | not started |
| 38 | parhelion | B2 | done · 0/0/1/2 · RM: setting + OS, live | not started |
| 39 | pyrestorm | B2 | done · 0/0/2/2 · RM: setting + OS, live | not started |
| 40 | rainbark | B2 | done · 0/0/0/3 (+ shared THM-03/09/11/24) · RM: setting + OS, live | not started |
| 41 | rainy-window | B5 | done · 0/2/3/1 · RM: neither · classic WebGL | batch 3: THM-229 confirmed (131.2 fps, 71–90 W); heap +0.6 MB/cycle (inconclusive); RM inconclusive |
| 42 | sakura-twilight | B5 | done · 0/0/4/2 · RM: OS only, parallax only | batch 7: 13.5 idle GCs/s, 263/231 per burst (THM-240/241 confirmed); no leak; RM no effect |
| 43 | serenity-warp | B3 | done · 0/0/0/3 · RM: setting + OS, live | not started |
| 44 | shifting-sands | B5 | done · 0/0/0/3 · RM: setting + OS, live | not started |
| 45 | sky-children | B1 | done · 0/1/1/6 · RM: setting + OS, live | batch 3: THM-25 confirmed (16.2 idle GCs/s); no leak; RM works (−31 %) |
| 46 | sky-children-v2 (retired id → sky-children) | B1 | done · 0/0/0/6 (latent) · unreachable in game; RM: neither | n/a unless reachable |
| 47 | solar-eclipse | B2 | done · 0/0/0/1 · RM: setting + OS, live | not started |
| 48 | starlight | B3 | done · 0/0/0/2 · RM: setting + OS (sky turns stay) | not started |
| 49 | stellar-drift | B6 | done · 0/0/1/3 · RM: setting + OS, live | not started |
| 50 | stellar-velocity | B7 | done · 0/0/1/3 · RM: setting + OS, live | not started |
| 51 | stillwater | B7 | done · 0/0/0/4 · RM: setting + OS, live | not started |
| 52 | summer | B8 | done · 0/0/2/4 · RM: OS only, parallax only | batch 7: 263 sync pipelines per entry; 127/90 GCs per burst; no leak; RM inconclusive |
| 53 | sunset | B5 | done · 0/0/1/1 · RM: setting + OS, live | not started |
| 54 | supernova | B8 | done · 0/0/2/3 · RM: setting + OS, live | not started |
| 55 | synthwave-sunset | B1 | done · 0/0/3/4 · RM: neither | batch 6: no leak; bursts clean (no gap from THM-59); RM no effect |
| 56 | thermal-bloom | B4 | done · 0/0/1/4 · RM: setting + OS, live | not started |
| 57 | tornado | B8 | done · 0/1/2/4 · RM: setting + OS, live · light profile | batch 3: no leak; THM-70 confirmed (5 sync pipelines, 271 ms gap on first burst); RM: no measurable drop |
| 58 | verdant-hills | B7 | done · 0/0/4/3 · RM: OS only, parallax only | batch 7: 281/224 GCs per burst (highest; THM-95/96 confirmed); no gap; no leak; RM no effect |
| 59 | vesper-chrysalis | B2 | done · 0/0/0/2 · RM: setting + OS, live | not started |
| 60 | void-ember | B7 | done · 0/0/1/3 · RM: setting + OS, live | not started |
| 61 | voltage-storm | B8 | done · 0/0/2/3 · RM: setting + OS, live · light profile | not started |
| 62 | waves | B1 | done · 0/0/1/3 · RM: setting + OS, live | not started |
| 63 | winter | B5 | done · 0/0/1/3 · RM: setting + OS, live | not started |
| 64 | wolfhour | B5 | done · 0/2/2/5 · RM: neither · feeds the WebGL1 overlay | batch 1: no leak (+13 MB after first visit); THM-227 confirmed (14 sync, 91 ms gap); RM no effect · perf lane: first frame 2.94 s, 3 pipelines after first frame |
| 65 | shared/ (fox engine; bloom/composer dispose, warm-hidden-drawables, camera rig, sky-core) | B5 / PIPE | done (fox engine B5; dispose helpers, warm helper, camera rig PIPE; sky-core feeds only the retired sky-children-v2) | n/a |

The registry publishes 63 themes (`src/themes/theme-registry.js`); `sky-children-v2` is a retired
id that resolves to `sky-children` (`theme-registry.js:545-546`) but its folder is still in the tree.

### Pipeline, Odyssey and R-items

| Item | Static audit | Runtime audit |
|---|---|---|
| Theme pipeline (PIPE) | done · 0/1/13/12 (PIPE-01..26) | PIPE-01 confirmed on boot and exit paths (R-session) |
| Odyssey core (ODY1) | done · 0/2/11/13 (ODYR-01..26) | one small session: ODYR-03 confirmed (130/s), ODYR-27 new, ODYR-01 shown via memory, ODYR-02 not reproduced at 1.5 s, ODYR-05 inconclusive |
| Odyssey world + chapters (ODY2) | done · 0/0/18/37 (ODYR-28..82; ch2–5 fallback-only) | covered only via the Odyssey session (chapter 1); per-chapter sessions pending |
| R-09 · play under the loading cover | done · OPEN | confirmed (forest entries: piece spawns 1.95–1.98 s before the cover lifts, falls 1–2 rows unseen); cold heavy entry pending |
| R-17 · boot and handoff timings | done · OPEN | measured on forest (MENU_READY 1.52 s, title interactive 9.62 s, 4 s floor holds the intro); heavy theme pending |
| R-22 · frame pacing, VSync, dynamic resolution | done · UI-01 partly fixed, rest OPEN | REND-18: game detects 132 Hz (OS 165); VSync/DRS items pending |
| R-28 · crisp board | done · OPEN | confirmed: 0.82x downscale at 1600x900, 0.71x at 1280x720, pixelated |
| R-29 · frame driver, idle cost | done · OPEN (REND-09 partly changed) | REND-01/02/05/07 confirmed; REND-09/10/12/14/15/16/17 pending |
| REND-01 … REND-20 | done · see Re-checked GPU items and PIPE | REND-01/02/05/07/08/18 measured; 09/10/12/14/15/16/17 pending |
| `reducedMotion` visual/runtime check | done · fleet: 46 both / 8 OS-only / 9 neither (PIPE) | 9 themes measured: works in geode (−63 %), sky-children (−31 %); no effect in forest, cosmic-noir, misty-lake, wolfhour, tornado; rainy-window inconclusive |
| Instruments (ADR-0016) | done · INS-01..05 | n/a |

### Next session: where to pick up

**Start with [THEME_AUDIT_HANDOVER_2026-10.md](THEME_AUDIT_HANDOVER_2026-10.md)** (2026-10-14): what
was fixed after this audit, the open rows of the plan's §0b, the order to continue in, and the
tooling as it is now. The measurement list below still holds.

**Tooling.** The scratch scripts and every raw result from this session are kept, not committed, in
the audit worktree at `C:\Users\olov_\repos\serenity-blocks-thmaudit\.cache\theme-audit\`
(git-ignored):

- **Scripts:**
  - `leak-harness.mjs`: theme cycles, gameplay bursts, reduced-motion motion energy;
  - `rsession.mjs`: boot with the intro, mode entry, presents, board geometry, exit and re-entry;
  - `odyssey-session.mjs`;
  - `gpu-batch.sh`: shared GPU lock, `nvidia-smi` telemetry, TDR check;
  - two display/rAF probes;
  - the merge helpers.
- **Raw results:** `results/<run>/` (logs, `results.json`, telemetry, screenshots).
- **Static notes:** every reviewer's notes, under `static-notes/`.
- **Running them:** `gpu-batch.sh` hard-codes this session's scratch path; point `RT=` at a new folder
  first. The harness and R-session need a dev server; the perf lane and Odyssey session need
  `npm run build` + `vite preview` on a free port. Pass every URL-like option as `--key=value`.

**Still to measure (seen in Quiet mode unless stated):**

| What | Why it matters | Suggested batch |
|---|---|---|
| Re-measure forest's cold first frame / CPU per frame, and the first-combo stall durations (tornado, wolfhour, cosmic-noir), **once in Performance mode** | borderline: CPU-bound numbers that Quiet mode inflates; the owner could not switch modes remotely on 2026-10-14 | perf lane `--theme forest`; harness `--themes=tornado,wolfhour,cosmic-noir --cycles=1 --rm=0` |
| Themes measured so far (25) | — | aurora, tornado, forest, cosmic-noir, misty-lake, wolfhour, geode, rainy-window, sky-children, himalayan-peak, murmuration, neon-dusk, nimbus-veil, synthwave-sunset, chromadelic-highway, crystal-cave, moonrise-summit, summer, verdant-hills, golden-forest, sakura-twilight, fall, moonlit-forest, neon-district, kaleidosonic |
| The remaining 38 registered themes | lifecycle and leak census, bursts, reduced motion, visual check | two per GPU-lock turn; the six-way scene template first (koi-pond + bioluminescence, voltage-storm + supernova, luminous-tides + stellar-velocity), then aether-tides, astral-weave, black-hole, blood-moon, chiral-gold, chromatic-impasto, cinder-drift, fluid-dreams, galaxy, halcyon-apex, high-coast, ice-temple, lunara, moonlit-greenhouse, nebula-flow, ocean, painted-ages, parhelion, pyrestorm, rainbark, serenity-warp, shifting-sands, solar-eclipse, starlight, stellar-drift, stillwater, sunset, thermal-bloom, vesper-chrysalis, void-ember, waves, winter (`sky-children-v2` is unreachable) |
| Perf lane for every theme measured by the harness | first frame, CPU submit, pipelines (apply the INS-01 check to `gpuMs`) | after each harness pair |
| R-09 cold entry on a heavy theme; R-17 with neon-district | the first audit's worst cases (up to ~14 unseen rows; 33 s handoff) | `boot-smoothness-probe.mjs --theme=neon-district`, plus `rsession.mjs --theme=neon-district` on a cold profile |
| R-22: VSync toggle, DRS at caps above the refresh (RIT-01), RIT-02's first-run cap | settings that do nothing or ratchet quality | RITEM session B |
| R-29: REND-09 (minimise), REND-10 (Infinity camera τ), REND-12 (Text per combo), REND-14 (analyser clock), REND-15/16/17 | idle cost and frame-count timing | RITEM session C |
| Odyssey: ODYR-02 abort-offset sweep; one chapter per session from the ODY2 runtime plan (ch1 haze near-fade, ch6 fades, ch7/ch8 fill) | timing-sensitive lifecycle bug; per-chapter visuals | `odyssey-session.mjs` with an abort offset sweep; playground `?effect=` shots per chapter |
| Pipeline: PIPE-02/03 (prewarm race, window c) and PIPE-18 (700 ms net under the breathing guide) | blank backgrounds and needless rebuilds | PIPE runtime plan R2/R3 |

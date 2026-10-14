# Theme and rendering audit — handover (2026-10-14)

Handover of the follow-up to [THEME_AND_RENDERING_AUDIT_2026-10.md](THEME_AND_RENDERING_AUDIT_2026-10.md):
the eleven fix branches merged on 2026-10-14, what is still open, the order to continue in, and how
the work was done and verified. The work queue itself is the umbrella plan's
[§0b table (T1–T13)](ARCHITECTURAL_REMEDIATION_PLAN.md). This page explains it and does not replace it.

Every performance number below was measured on the owner's laptop (RTX 3070 Laptop, Electron rAF
≈ 131.6 Hz on a 165 Hz panel, 1600×900) in **Lenovo Quiet mode**, and is "seen in Quiet mode". The
owner cannot switch power modes from a remote session, so Performance-mode re-checks wait for the
owner at the machine.

## 1. What was merged

Each row is its own branch: unit tests that fail on the old code, a GPU before/after under the
shared GPU lock, the plan row and the audit doc's header updated, every CI gate and the full suite
run on the merge candidate, then a guarded push.

| Merge | Branch | What it fixed | Measured on the RTX |
|---|---|---|---|
| `afeeacb0` | `fix/theme-suspend-and-device-loss` | T1 PIPE-01: a second `suspendThemes()` threw away a parked theme. T2 PIPE-09/22: a device the app destroyed was counted and "recovered" as a loss | 3 GPU devices per session instead of 5; re-entry is a quick resume |
| `83146e98` | `fix/theme-warm-parked-fx` | T3: tornado, wolfhour and cosmic-noir warm their parked FX at the end of the build (`shared/warm-hidden-drawables.js`) | first-burst pipelines 5→0, 14→2, 5→2; the 271/91/89 ms gaps gone |
| `005ba025` | `fix/theme-reduced-motion-setting` | T4: the eight OS-only themes read Settings › Reduce motion too, live | — |
| `5e694121` | `fix/theme-resume-rebuild-guard` | T5: `BaseTheme.resume()` refuses while a rebuild is pending, and the manager restarts it once; 47 per-theme copies deleted | 2 builds → 1 |
| `b232b211` | `fix/theme-flashes-and-moonrise-rays` | Flashes calmed under reduced motion (neon-district, rainy-window); the rainy-window horizon roll (THM-265); moonrise god rays from the moon (THM-264) | — |
| `a7f597fb` | `fix/theme-lifecycle-restart-warm-pause` | A stopped runtime is released before a restart (THM-228/PIPE-19); activations cancel the pre-warm (PIPE-02/03); `safeAnimate` never draws while paused (THM-182/21) | drawing behind the menu: 187 and 116 frames → 0 |
| `4d18a435` | `fix/theme-reduced-motion-batch-a` | Reduced motion for wolfhour, misty-lake, crystal-cave and cosmic-noir's own motion | motion energy −98 %, −4 %, −72 %, −44 to −53 % |
| `701da7df` | `fix/theme-reduced-motion-batch-b` | The same for nimbus-veil, neon-dusk, synthwave-sunset and chromadelic-highway | −63 to −70 %, −43 to −46 %, −71 to −75 %, −12 to −36 % |
| `fdf96a59` | `fix/theme-breath-ease-and-warm-adopt` | THM-266: the shared camera breath eases back over 1.5 s when Reduce motion goes off. PIPE-05: an entry during the boot warm adopts it. Restarts carry the clock and level | 1 device instead of 2; active 0.5 s after the click instead of 1.3 s; clocks kept (20–23 s instead of ~5) |
| `64d73191` | `fix/frame-rate-cap-loops` | C3: misty-lake and rainy-window draw at the Target Frame Rate with real `dt`. The menu intro and the Odyssey map use the themes' pacer. The intro no longer draws under the map (ODYR-27) | misty-lake 85→33 W; rainy-window 106→67 W; intro and map 131→66 frames/s; an Odyssey visit after a menu return 85.5→28.2 W |
| this merge | `fix/menu-renderer-park` | REND-02: entering a mode parks the menu renderer (hidden, stopped, shrunk to 64×36) instead of destroying it. The return revives it and rebuilds only if its device was lost | per return 0 devices and 0 pipelines instead of 1 and 36; the menu draws 10–17 ms after the return call instead of ~117 ms. Cost during play: ~+36 MiB VRAM and ~+200 MB of GPU-process memory (the second live device) |

## 2. What is open

The plan's §0b status column is the source of truth. In short:

| Row | Status | Open |
|---|---|---|
| T2 | 🟡 | Six themes with no device-loss path (PIPE-10); the WebGL2-fallback Odyssey board (ODYR-17) |
| T3 | 🟡 | The manager never reads `getWarmupRoots()`, so a theme with parked FX must warm them itself; himalayan-peak's late eagle; a DEV assert of no synchronous pipeline after the reveal |
| T4 | 🟡 | How much each theme calms beyond the camera, pointer lean and breath |
| T5 | 🟡 | moonlit-forest and parhelion keep their clock as `elapsedTime`, which a restart does not carry; themes that don't re-apply a restored level to their world |
| T6 | 🟡 | A lifecycle-audit rule against raw rAF loops in `src/themes/**` (lives in T13) |
| T7 | ⬜ | Odyssey mid-build exits: check `_disposed` after every await in `initialize()`, clear the stale build promise, `oneWorld.dispose()` (ODYR-01/02/05) |
| T8 | ⬜ | forest's 6 s cold first frame and 7.2 ms CPU per frame (P2). Re-measure in Performance mode first |
| T9 | ⬜ | Every settings save reads as a render-scale change; one render-scale owner; clamp the dynamic-resolution target to the refresh (P3) |
| T10 | 🟡 | R-29's single frame driver, a lazy WebGL1 overlay, Phaser asleep on the menu, the menu renderer paused under Settings and the Hub |
| T11 | ⬜ | One theme adapter base and shared modules (A1). Large, incremental |
| T12 | ⬜ | Dead code. Porting misty-lake, rainy-window and moonrise-summit to WebGPU/TSL needs the owner's yes |
| T13 | ⬜ | Instruments: the perf lane's GPU sampler (INS-01), lifecycle-audit rules, the listener/bus/device census as a gate |

Also open:
- **Unmeasured themes:** 38 of them. The audit doc's "Next session: where to pick up" lists them, with a pairing order.
- **Not yet run on the GPU:** the 30 fps cap's quality judgement (unit-tested only).
- **Memory trade-off:** the parked menu renderer. If low-memory machines (8 GB laptops, the Steam Deck) matter more than a quicker menu return, add a time limit that discards a renderer parked for longer than about a minute (`IntroAnimation.discardRenderer()` already exists).

## 3. Recommended order

1. **T7, Odyssey mid-build exits.** A real bug (leaks and a stale build promise on a quick exit), small to medium, with a probe ready (`odyssey-session.mjs` runs a mid-build abort).
2. **T13's lifecycle-audit rule against raw rAF loops.** This closes T6. Small; it stops the next theme from repeating misty-lake's loop.
3. **T9, settings churn.** Small, and every settings save currently pays for it.
4. **T10's small parts.** Pause the menu renderer under Settings and the Hub, create the WebGL1 overlay lazily, sleep Phaser on the menu. R-29's frame driver is the big step after that.
5. **The 38 unmeasured themes,** two per GPU-lock turn with `leak-harness.mjs`. Every batch so far found something.
6. **At the machine with the owner:** Performance-mode re-measures (T8 forest, the first-combo stalls), then the Odyssey per-chapter runs.

## 4. How the work was done

**Checkouts.**
- The worktree is `C:\Users\olov_\repos\serenity-blocks-thmaudit`. It is left detached at `origin/main` between branches; branch each fix from `origin/main`.
- The main checkout `C:\Users\olov_\repos\serenity-blocks` stays clean on `main`, fast-forwarded after each merge.
- Never `git stash` for a before/after. The stash is shared by all worktrees and peer sessions. Copy the changed files aside and `git checkout <base> -- <files>`, or let the template below do the swap.

**Tooling.** Everything is git-ignored, in the worktree's `.cache/theme-audit/`.
- `gpu-batch-fix.sh <tag> <command…>` runs one batch under the shared GPU lock (`C:\Users\olov_\repos\odyssey-gpu\gpu.lock`). It records `nvidia-smi` telemetry every second, checks the System log for TDR/driver events, and writes to `results/runtime/<tag>/` (override with `RT=`).
- `before-after-template.sh` holds one lock for a before run and an after run, swapping the changed files between them. Set `FILES`, `BASE` and the probe line.
- Probes (all run as `node scripts/run-electron.mjs <probe> --baseUrl=http://127.0.0.1:5391 --out=<dir> --profile=<dir> …`):

  | Probe | What it measures |
  |---|---|
  | `leak-harness.mjs` | theme cycles (`--themes=a,b --anchor=aurora --cycles=1`): leaks, burst pipelines and gaps, theme frames/s, reduced-motion energy (`--rm=0` skips it). `--hold=<ms>` idles on each theme for a power reading |
  | `odyssey-session.mjs` | Odyssey enter/exit cycles: presents per canvas on the map and on the menu, devices, pipelines, GPU-process memory, a mid-build abort (`--noAbort=1` skips it; it then logs "ERROR noAbort: done" on purpose). Also takes `--hold=<ms>` |
  | `menu-return-probe.mjs` | Single Player enter/return cycles: devices and pipelines per return, ms to the menu's first frame, presents, GPU-process memory |
  | `rsession.mjs` | boot with the intro, mode entry, exit and re-entry |
  | `resume-probe.mjs`, `lifecycle-probe.mjs`, `adopt-probe.mjs`, `clock-probe.mjs` | the resume/rebuild, restart, warm-adoption and clock-carry checks behind T5 and fdf96a59 |

- `hold-power.mjs <telemetry.csv> <log…>` averages GPU power, utilisation and clocks over each `HOLD-START`/`HOLD-END` window. `vram-phases.mjs` gives VRAM per menu-return cycle.
- Results: `results/<run>/`. This session's runs are in `results/2026-10-14-fixes/` (`cap-*` C3, `pace-*` the menu/map pacing, `park-*` REND-02 and the rest).

**Dev server.** Start it from the worktree:
`VITE_CACHE_DIR=<worktree>/.cache/vite-5391 node node_modules/vite/bin/vite.js --port 5391 --strictPort --host 127.0.0.1`.
To stop it, match the parent bash's command line (worktree path plus `vite.js --port 5391`), never the port alone. Don't edit code while a GPU run is in progress: the dev server serves the files as they are on disk.

**Merging.** Use `.cache/theme-audit/merge/gate-push.sh`.
- Retarget `FEATURE=`, `CAND=` and `L=` with `sed`, then run it in the background. It prints `GATE-PUSH: PUSHED <sha>` or a `REFUSED` line.
- It cuts a `--no-ff` candidate on `origin/main` and runs typecheck, the TS ratchet, the lint ratchet (baseline 599 errors), fitness (main.js 5614 lines, baseline 5629), the lifecycle audit, boundaries, palette, perf budgets, the build (boot-closure guard), IP strings, the pages artifact, the release gates and the full suite.
- The suite has two allow-listed machine reds: `odyssey-level-briefing` (locale) and `tts-recorder-e2e` (EPERM).
- It then waits for CI on main and pushes only if `origin/main` has not moved.
- There is no `gh` CLI. Read CI from `https://api.github.com/repos/olovmelander/serenity-blocks/actions/runs?branch=main&per_page=3`.

## 5. Traps that cost time

- **Frame caps change what frame times mean.**
  - A capped loop's gap between drawn frames is the cap itself (15.2 ms at 60 on this panel). An adaptive quality that reads it never sees headroom, so the Odyssey map's controller now reads the slowest display refresh since the last draw.
  - Per-frame smoothing (`x *= 0.94`, `lerp(…, 0.18)`) runs at half speed under the cap. Write it as `k ** (dt * 60)`.
- **Never clock × a changing rate.** Rainy-window's rain did `time * (0.5 + storm * 0.5)` and lurched more the longer it ran. Integrate the speed instead.
- **Memory measures.** Electron's GPU-process private bytes are system memory and include about 200 MB per live WebGPU device whatever it draws. Use `nvidia-smi` `memory.used` for VRAM.
- **three r186 resizes its post targets when it renders, not on `setSize()`.** To free them, draw one frame at the small size. Not 1×1: bloom halves the size per level.
- **`camera.rotation.z` after `lookAt()` is not a roll.** Use `rotateZ`.
- **Tests that pin behaviour:**
  - World replay and seek tests pin determinism, so eased state must settle on a clock that jumps.
  - 16 world suites pin "Reduce motion on holds still at once".
  - The breath-coverage test forbids wolfhour importing `camera-breath.js`; it imports `reduced-motion.js`.
- **Scripts.** Write edit scripts to files, keep CRLF where a file has it, and assert each anchor occurs exactly once. In bash, `node -e "…`x`…"` runs `x`.
- **Telemetry timing.** `nvidia-smi` telemetry stops at the batch's end, so leave a few seconds after the last hold.

## 6. Decisions made (not to re-litigate)

- **How the record is kept.** Fixes go in the audit doc's header as "Also fixed" blocks; the finding rows stay as recorded. The plan's §0b row is updated with each merge.
- **Pacing.**
  - Every loop that draws (themes, the menu intro, the Odyssey map) uses the one shared pacer, `src/themes/theme-frame-pacer.js`, and `?noThemeFpsCap=1` turns it off for all of them.
  - R-29's single frame driver is a later, bigger step, not a reason to undo this.
- **Reduce motion.** Switched on, it stops at once; switched off, motion eases back over 1.5 s.
- **The menu renderer.** It is parked (hidden, stopped, shrunk) on mode entry, never destroyed while its device lives, and the next return revives it.

## 7. Starting the next session

> Continue the theme and rendering audit follow-up. Read docs/THEME_AUDIT_HANDOVER_2026-10.md
> and the plan's §0b table first. Work in the worktree C:\Users\olov_\repos\serenity-blocks-thmaudit:
> one branch per fix from origin/main, unit tests that fail on the old code, a GPU before/after
> under the shared lock (Quiet mode unless I say otherwise), the plan row and the audit doc's
> header updated, then gate-push.sh. Start with T7 (Odyssey mid-build exits).

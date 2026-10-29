# Theme fleet at 240 fps: handover (2026-10-27 → 2026-10-29)

Handover of the first day of the fleet performance pass. The record with all numbers and findings
is [THEME_FLEET_240_2026-10.md](THEME_FLEET_240_2026-10.md); this page says where everything is, how
to resume, and what to do next, in order.

> **Pick up here (updated 2026-10-29, after the night pass).**
> - **Branch:** `perf/theme-fleet-240` in the worktree `C:\Users\olovm\repos\serenity-blocks-perf240`
>   (node_modules junctioned to the main checkout).
>   - Committed, **not merged and not pushed**. Last synced with main at `647c3851` (2026-10-28);
>     sync again before merging.
> - **The night pass** (2026-10-28 → 29, record §11) is committed. The rules were:
>   - every tier keeps its best look, and High stays identical;
>   - fixes that change no pixel first;
>   - trims only below High, or at Ultra/Extreme where they cost far more.
> - **What it did:**
>   - removed the switch-time main-thread stalls in Neon District, Fall, Sunfall, Spring, Starlight,
>     Aurora, Forest, Void Ember, Himalayan Peak, Halcyon Apex and Ice Temple. Revisits gain most:
>     Spring shows 460 ms sooner and Himalayan Peak 290 ms sooner;
>   - trimmed Cosmic Noir's Ultra/Extreme smoke;
>   - gave Aurora Medium antialiasing;
>   - re-checked the tier outliers by GPU ms (Golden Forest Medium is fine).
> - **Checks:** each change has same-frame playground shots against the base, first and second
>   mount. Every changed theme but Ice Temple has an interleaved A/B (record §11).
>   - Gates green: tsc, TS and lint ratchets, fitness, boundaries, lifecycle audit, IP strings, perf
>     budgets, release gates.
>   - Full vitest green except the four known local-only failures.
> - **Next:**
>   1. A Performance-mode High baseline (§3), then decide on the GPU-bound four: Verdant Hills,
>      Grainfields, Thermal Bloom in storms, Summer. Their remaining cost is the look itself (record
>      §11): any further cut is the owner's call.
>   2. The queue in §4 from item 2. Items 4 and 5 are mostly done (record §11).
>   3. Merge when the owner says so.
>
> Earlier status (2026-10-28 morning), kept for reference:
> - **Branch:** `perf/theme-fleet-240` in the worktree `C:\Users\olovm\repos\serenity-blocks-perf240`
>   (node_modules junctioned to the main checkout).
>   - Committed, **not merged and not pushed**.
>   - Synced with main at `647c3851` on 2026-10-28 (49 commits; only `ts-ratchet.json` conflicted,
>     both new entries kept).
>   - Gates were green on the synced branch on 2026-10-28: tsc, ts and lint ratchets, fitness,
>     boundaries, lifecycle audit, IP strings, perf budgets, release gates, and `npm run build`.
>     Fitness reports three improvements that came in with main; they are not locked in here.
>   - Full vitest passed (23 452 tests) except the four known local-only failures:
>     records-view, game-over-modal-result-compatibility and odyssey-level-briefing (the sv-SE
>     locale), and tts-recorder-e2e (the symlink EPERM in a worktree).
>   - Sync with main again before merging; main moves several times a day.
> - **Done on 2026-10-28:** the final High run on the tier-run build and settings
>   (`reports/theme-fleet-bench/2026-10-28-tier-High`), still in **Balanced** mode.
>   - The six-tier matrix against it is in record §8b.
>   - Six real tier outliers, consistent across both High baselines (record §8b table): Golden Forest,
>     Chromadelic Highway and Wolfhour at Medium; Black Hole and Parhelion at Low; Cosmic Noir at
>     Ultra and Extreme.
> - **Next:**
>   1. When the laptop can be in Lenovo **Performance** mode (Fn+Q until the power button is red),
>      on AC and with other GPU work closed, re-run High (§3) and compare with
>      `2026-10-28-tier-High`. Until then all numbers are Balanced-mode (GPU 80-95 W).
>   2. Otherwise work the queue in §4 from item 3.
>      - Item 2 (the display ceiling) needs the owner at the machine.
>      - Item 5 can start on the six confirmed tier outliers directly.

## 1. What was done

| Commit | What |
|---|---|
| `c6f80772` | The fleet bench: `scripts/theme-fleet-bench.mjs` (`npm run perf:themes:bench`), its worker and page code, probes in `scripts/lib/theme-bench-snippets/`, tests; the dev-only gameplay-event handle in the console harness |
| `09597f0a` | The canvas is multisampled only where the scene is drawn to it (seven themes; ~90 MB VRAM each, no pixel or fps change) |
| `2f4b1706` | Themes start on a spare GPU device requested ahead of time (`src/rendering/theme-device-spare.js`; renderer creation 30-45 ms → under 1 ms per theme start; no leak; rollback `?themeDeviceSpare=0`) |
| `74f1519b` | The record and the two High baselines (`reports/theme-fleet-bench/2026-10-27-base-high*`) |
| `15a9dc91` | The tier runs (`reports/theme-fleet-bench/2026-10-27-tier-*`), the first tier matrix, `scripts/lib/theme-bench-tools/`, this handover |
| `f4d05b5f` | Sync with main (`390fc497`: Spring's woods on phones) |
| (2026-10-28 commit) | The final High run (`2026-10-28-tier-High`), the final tier matrix (`2026-10-28-tier-matrix.md`, record §8b), this update |
| `8ca09778` … `d97b74ff` | The night pass of 2026-10-28 → 29 (record §11): switch-time stalls removed in eleven themes, Cosmic Noir Ultra/Extreme and Aurora Medium tiers, shared helpers `attribute-floats`, `session-geometry`, `fresh-geometry`, `decoded-texture` |

## 2. What we know (short)

- **This laptop cannot show more than ~178 fps in any Chromium app,** the game included: Windows
  composes 237.6 Hz, Chromium draws on 3 refreshes of 4 (record §6). Nothing in the app fixes it.
  Machine-side candidates (need the owner and a reboot):
  1. Legion Space → GPU mode → **dGPU only** (MUX), reboot, then re-run the bare-page check (§3).
  2. Windows Settings → Display → Advanced → refresh rate: a fixed 240 Hz, not "Dynamic".
  3. AMD Adrenalin → Display → FreeSync / Variable Refresh Rate, off and on.
- **At High in Balanced mode** (GPU capped at 80-95 W), 59 of 63 themes clear 240 fps uncapped. The
  four that do not are GPU-bound: Verdant Hills, Grainfields, Spring, Thermal Bloom. Summer and
  Kaleidosonic sit on the line.
- **At the panel's cadence** 60 of 63 themes are smooth; Thermal Bloom, Spring and Verdant Hills drop
  ~1 % of frames in storms.
- **Loads:** the median theme shows in 0.79 s cold, 0.57 s warm. Seven themes freeze a frame for
  110-360 ms while switching: Neon District, Fall, Spring, Void Ember, Aurora, Sunfall, Starlight
  (record §7 table, with causes).
- **Tiers** (record §8 and §8b): the median step vs High is Minimal 0.22×, Low 0.31×, Medium 0.65×,
  Ultra 1.38×, Extreme 1.65×. The outliers to fix are in §8b.
- **Run-to-run drift is large on this machine.** The same High build read 35-50 % slower in the
  morning than in the afternoon for some themes (Neon Dusk, Halcyon Apex). Compare only runs made
  close together, interleaved, two rounds or more.

## 3. How to resume

Paths are from the worktree root. Use a scratch dir per session for builds and results
(`$SCRATCH` below).

```bash
# 1. Build the game with the bench's harness hook and serve it on a free private port
#    (check the port first: Get-NetTCPConnection -State Listen).
VITE_DEV_HARNESS=1 VITE_CACHE_DIR=$SCRATCH/vite-cache npx vite build --outDir $SCRATCH/dist-base --emptyOutDir
VITE_CACHE_DIR=$SCRATCH/vite-cache npx vite preview --outDir $SCRATCH/dist-base --port 4317 --strictPort --host 127.0.0.1 &

# 2. The fleet at High, uncapped (frame-rate headroom), ~35 min with these windows.
#    The Bash tool needs its sandbox off for Electron.
node scripts/theme-fleet-bench.mjs --base-url=http://127.0.0.1:4317 --themes=all --quality=High \
  --tag=perfmode-high --out=$SCRATCH/bench-out --rest-ms=4000 --storm-ms=4000 --no-second-visit=1 --shots=0

# 3. The fleet at the panel's cadence (what the player sees, and the only valid load numbers), ~50 min.
node scripts/theme-fleet-bench.mjs --base-url=http://127.0.0.1:4317 --themes=all --quality=High \
  --tag=perfmode-high-vsync --out=$SCRATCH/bench-out --vsync=1 --target-fps=240 --shots=0

# 4. Tables.
BENCH_OUT=$SCRATCH/bench-out node scripts/lib/theme-bench-tools/cadence-table.mjs $SCRATCH/bench-out/perfmode-high-vsync/summary.json
BENCH_OUT=$SCRATCH/bench-out node scripts/lib/theme-bench-tools/tier-compare.mjs \
  reports/theme-fleet-bench/2026-10-27-tier-High/summary.json $SCRATCH/bench-out/perfmode-high/summary.json "Performance mode"
```

Other tools (READMEs beside them):
- **A/B a change:** build each arm into its own dir and serve each on its own port, then
  `BENCH_OUT=… bash scripts/lib/theme-bench-tools/ab.sh <tag> <themes> 2 <urlA> <urlB>` for frame
  rate, or `ab-load.sh` for loads. Tables: `ab-table.mjs` / `ab-load-table.mjs`.
- **Where a slow theme spends its frame:** `--eval-file=scripts/lib/theme-bench-snippets/pass-profile.js
  --exit-after-eval=1` (GPU per pass) or `cost-census.js` (per scene part; add
  `--eval-timeout-ms=240000 --hard-timeout-ms=400000`).
- **What a load does tick by tick:** an unminified build (`vite build --minify false`) and
  `--profile-load=1`, then `node scripts/lib/theme-bench-snippets/profile-timeline.mjs <cell>.load1.cpuprofile 250`.
- **The display ceiling check:** `--vsync=1 --target-fps=240` on one light theme (nimbus-veil). It
  should read ~237 fps at rest once the ceiling is gone; it reads ~178 now.

## 4. The queue, in order

1. **Performance-mode baseline** (owner at the machine): steps 2-3 above.
   - Expect the GPU-bound themes to gain the most.
   - Then decide which still need work: Thermal Bloom (storms), Verdant Hills, Grainfields, Spring,
     Summer, Kaleidosonic.
2. **The display ceiling** (owner): try the three machine-side settings in §2, re-checking after
   each.
3. **The packaged app's dynamic resolution** (record §8): confirmed in the dev desktop app and
   fixed on 2026-10-29 (record §13). With the FPS counter shown and target 240 it held 1.0 for two
   minutes of play, where main fell to the 0.5 floor in 45 s.
4. **Load freezes** (record §7). Each needs an A/B with `ab-load.sh`, and a look at the theme after:
   - Fall and Sunfall re-parse their GLTFs on every visit (83-132 ms). Cache the parsed result for
     the session. Fall re-applies its draw ranges per build; check the squirrel's clone first.
   - Neon District (two 150-190 ms tasks), Aurora (~95 ms), Starlight (~97 ms): profile which
     material builds in one task (`--profile-load=1`). Then make its node graph smaller
     (`Fn().setLayout`) or split the build.
   - Spring (a 240-310 ms task on both visits) and Void Ember (188 ms, first visit).
5. **Tier alignment** (record §8, §8b).
   - **Real outliers:** the six in the record's §8b table hold against both High baselines.
   - Start with Golden Forest's Medium (costs more than High). Measure each fix interleaved (High vs
     the tier, two rounds) and screenshot the tier before and after.
   - **Consistency fixes that do not touch High's look:**
     - MSAA that follows the antialiasing toggle (about twenty themes ignore it);
     - antialiasing that does not get worse from Low to Medium (Golden Forest, Crystal Cave, Aurora);
     - the dead dynamic resolution in Nimbus Veil, Neon Dusk and Synthwave Sunset;
     - `normalizeQuality` in the three themes that skip it.
6. **Starvation under a saturated outgoing theme** (record §7). Measure first: a GPU-bound anchor
   (`--anchor=verdant-hills`, `--vsync=1`) switching to Spring. If loads stretch, cap the outgoing
   theme's frame rate while the build behind it is starved.
7. **Look-safe GPU work** in the GPU-bound themes (record §5), each with before/after screenshots:
   - High Coast's full-resolution shaft march (0.95 ms);
   - Moonlit Greenhouse's air march (1.06 ms);
   - Sunfall's full-resolution post target (0.54 ms);
   - Thermal Bloom's storm effects.
8. **Merge** `perf/theme-fleet-240` when the owner says so. Follow the routine in memory
   (merge-when-pipelines-done): sync, gates, wait for main's deploy, detached merge, `ls-remote`
   guard.

## 5. Traps found today

- **Uncapped runs starve loads.** `--vsync=0` loads are invalid: the anchor's uncapped frames starve
  the incoming theme's compiles, so Spring and Wolfhour took 9-10 s.
- **GPU timestamps undercount uncapped.** They are off in the fps windows; use the pass profile
  (60 fps cap) for GPU per pass.
- **three reuses render-context ids across passes.** The pass profile keys by target label.
- **No heavy CPU during a run.** vitest during the cadence run skewed Spring's load cells.
- **About 1 % of runs stall.** The page hangs in the first window after a good load (Black Hole,
  Aether Tides, Summer, Neon Dusk once each; all fine on rerun). Rerun singles with the same `--tag`;
  `summary.json` is rebuilt from all cells.
- **The power limit:** `nvidia-smi -q -d POWER` → "Current Power Limit". Balanced reads 80-95 W;
  Performance should read up to 175 W. nvidia-smi's clock reads 180-450 MHz under the cap, which is
  misleading.
- **Electron and the Bash sandbox.** Electron needs the Bash sandbox off. A VS Code shell sets
  `ELECTRON_RUN_AS_NODE`; the bench clears it.

## 6. Starter prompt for tomorrow

> Continue the theme fleet performance pass from docs/THEME_FLEET_240_HANDOVER_2026-10-27.md (branch
> perf/theme-fleet-240, worktree C:\Users\olovm\repos\serenity-blocks-perf240). The laptop is now in
> Lenovo Performance mode [or: still Balanced]. Re-run the High baseline per §3, compare with the
> 2026-10-27 tier-High summary, then work the queue in §4 in order, measuring every change with
> interleaved A/B runs and checking the look with screenshots.

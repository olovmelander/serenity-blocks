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
> what the next session should pick up.

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
| Display | internal panel **1920 × 1080 @ 165 Hz**, scanned out by the **AMD iGPU** (hybrid mode: frames the RTX renders are copied to the iGPU for display) | `Win32_VideoController.CurrentRefreshRate` |
| Lenovo power mode | **Quiet** (owner-set via Fn+Q for the whole audit). Not independently confirmed: `LENOVO_GAMEZONE_DATA.GetSmartFanMode` needs admin ("Access denied"). The 115 W enforced cap is consistent with Dynamic Boost being off. | owner; `nvidia-smi` |
| Windows power plan | Balanced ("Balanserat") | `powercfg /getactivescheme` |
| Power source | **AC** (`Win32_Battery.BatteryStatus = 2`, 96 % at 08:57) | `Win32_Battery` |
| GPU the game uses | *to be confirmed per runtime row from the game's own adapter log* (`electron/main.js:57` appends `force_high_performance_gpu`) | runtime |
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
| ODY2 | Odyssey `world/` and `chapter-environments/` |
| RITEM | R-09, R-17, R-22, R-28, R-29 and the REND items re-checked at `cde601f8`, with runtime procedures |

Batches were balanced by line count (about 47,000 lines each; 381,501 lines of theme code in
total). The coordinator re-read the code behind every finding ranked High or Critical.

**Step 2 — instrument verification (ADR-0016)** before any runtime number is used: see
[Instruments](#instruments-adr-0016).

**Step 3 — runtime pass (GPU safety enforced).** At most 3–5 themes per run, never a full
journey or the whole fleet in one go; stop on any GPU hang, reset or heavy throttling.

*(Sections below are filled in as each batch lands.)*

## Executive summary

*Pending: written once the static pass and the first runtime batch are in.*

## Prioritized recommendations

### 1 · Critical bugs and leaks

*Pending.*

### 2 · Performance optimizations

*Pending.*

### 3 · Architectural and code improvements

*Pending.*

## Finding tables

Columns: **Sev** severity (Critical / High / Med / Low) · **Cat** Bug / Perf / Improvement ·
**Evidence** VERIFIED / PLAUSIBLE · **Proof** `file:line` at `cde601f8` or a runtime measurement.

| Prefix | Area |
|---|---|
| THM | individual themes and `src/themes/shared/` |
| PIPE | theme pipeline |
| ODY | Odyssey rendering |
| RIT | new findings in the R-item code paths |

*Pending: one table per area, appended as each batch lands.*

## Re-checked GPU items

*Pending.*

## Instruments (ADR-0016)

*Pending.*

## Runtime measurements

*Pending.*

## Progress tracker

Static = the code-review pass; Runtime = measured on this machine (always "seen in Quiet mode").

### Themes

| # | Theme | Batch | Static audit | Runtime audit |
|---|---|---|---|---|
| 1 | aether-tides | B6 | in progress | not started |
| 2 | astral-weave | B4 | in progress | not started |
| 3 | aurora | B8 | in progress | not started |
| 4 | bioluminescence | B8 | in progress | not started |
| 5 | black-hole | B7 | in progress | not started |
| 6 | blood-moon | B1 | in progress | not started |
| 7 | chiral-gold | B3 | in progress | not started |
| 8 | chromadelic-highway | B3 | in progress | not started |
| 9 | chromatic-impasto | B7 | in progress | not started |
| 10 | cinder-drift | B4 | in progress | not started |
| 11 | cosmic-noir | B3 | in progress | not started |
| 12 | crystal-cave | B3 | in progress | not started |
| 13 | fall | B5 | in progress | not started |
| 14 | fluid-dreams | B4 | in progress | not started |
| 15 | forest | B4 | in progress | not started |
| 16 | galaxy | B2 | in progress | not started |
| 17 | geode | B1 | in progress | not started |
| 18 | golden-forest | B1 | in progress | not started |
| 19 | halcyon-apex | B6 | in progress | not started |
| 20 | high-coast | B6 | in progress | not started |
| 21 | himalayan-peak | B7 | in progress | not started |
| 22 | ice-temple | B2 | in progress | not started |
| 23 | kaleidosonic | B7 | in progress | not started |
| 24 | koi-pond | B8 | in progress | not started |
| 25 | luminous-tides | B8 | in progress | not started |
| 26 | lunara | B4 | in progress | not started |
| 27 | misty-lake | B6 | in progress | not started |
| 28 | moonlit-forest | B6 | in progress | not started |
| 29 | moonlit-greenhouse | B3 | in progress | not started |
| 30 | moonrise-summit | B5 | in progress | not started |
| 31 | murmuration | B4 | in progress | not started |
| 32 | nebula-flow | B6 | in progress | not started |
| 33 | neon-district | B1 | in progress | not started |
| 34 | neon-dusk | B6 | in progress | not started |
| 35 | nimbus-veil | B4 | in progress | not started |
| 36 | ocean | B6 | in progress | not started |
| 37 | painted-ages | B5 | in progress | not started |
| 38 | parhelion | B2 | in progress | not started |
| 39 | pyrestorm | B2 | in progress | not started |
| 40 | rainbark | B2 | in progress | not started |
| 41 | rainy-window | B5 | in progress | not started |
| 42 | sakura-twilight | B5 | in progress | not started |
| 43 | serenity-warp | B3 | in progress | not started |
| 44 | shifting-sands | B5 | in progress | not started |
| 45 | sky-children | B1 | in progress | not started |
| 46 | sky-children-v2 (retired id → sky-children) | B1 | in progress | n/a unless reachable |
| 47 | solar-eclipse | B2 | in progress | not started |
| 48 | starlight | B3 | in progress | not started |
| 49 | stellar-drift | B6 | in progress | not started |
| 50 | stellar-velocity | B7 | in progress | not started |
| 51 | stillwater | B7 | in progress | not started |
| 52 | summer | B8 | in progress | not started |
| 53 | sunset | B5 | in progress | not started |
| 54 | supernova | B8 | in progress | not started |
| 55 | synthwave-sunset | B1 | in progress | not started |
| 56 | thermal-bloom | B4 | in progress | not started |
| 57 | tornado | B8 | in progress | not started |
| 58 | verdant-hills | B7 | in progress | not started |
| 59 | vesper-chrysalis | B2 | in progress | not started |
| 60 | void-ember | B7 | in progress | not started |
| 61 | voltage-storm | B8 | in progress | not started |
| 62 | waves | B1 | in progress | not started |
| 63 | winter | B5 | in progress | not started |
| 64 | wolfhour | B5 | in progress | not started |
| 65 | shared/ (fox engine; bloom/composer dispose, warm-hidden-drawables, camera rig, sky-core) | B5 / PIPE | in progress | n/a |

The registry publishes 63 themes (`src/themes/theme-registry.js`); `sky-children-v2` is a retired
id that resolves to `sky-children` (`theme-registry.js:545-546`) but its folder is still in the tree.

### Pipeline, Odyssey and R-items

| Item | Static audit | Runtime audit |
|---|---|---|
| Theme pipeline (PIPE) | in progress | not started |
| Odyssey core (ODY1) | in progress | not started |
| Odyssey world + chapters (ODY2) | in progress | not started |
| R-09 · play under the loading cover | in progress | not started |
| R-17 · boot and handoff timings | in progress | not started |
| R-22 · frame pacing, VSync, dynamic resolution | in progress | not started |
| R-28 · crisp board | in progress | not started |
| R-29 · frame driver, idle cost | in progress | not started |
| REND-01 … REND-20 | in progress | not started |
| `reducedMotion` visual/runtime check | in progress | not started |
| Instruments (ADR-0016) | in progress | n/a |

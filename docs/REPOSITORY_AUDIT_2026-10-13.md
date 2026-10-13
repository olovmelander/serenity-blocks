# Serenity Blocks — repository audit (non-theme)

**Date:** 2026-10-13 · **Tree:** `main` @ `b3d6e46` · **Scope:** everything except individual
themes (`src/themes/<id>/**`) and Odyssey chapter visuals. Covered: backend (the Electron main
process and Steamworks), menus, settings, transitions, gameplay rules, local and online
multiplayer, local and global high scores, performance, code structure, dead code, boot time,
Electron configuration, packages, tests/CI and repository hygiene.

> **Status: a record, not a backlog.** Per [ARCHITECTURE_INDEX.md](ARCHITECTURE_INDEX.md),
> harvest items into [ARCHITECTURAL_REMEDIATION_PLAN.md](ARCHITECTURAL_REMEDIATION_PLAN.md)
> before executing them. Line numbers describe `b3d6e46`; re-verify before acting. This audit
> changed no code. Fixes made after it are listed in
> [Fixed since this audit](#fixed-since-this-audit) below.
>
> **Relationship to the 2026-10-03 audit.** [REPOSITORY_AUDIT_2026-10-03.md](REPOSITORY_AUDIT_2026-10-03.md)
> was static only. This one re-verified every item of it in scope (Part 5 has the scorecard).
> It also **executed** things: the full CI gate suite, the production build, a duplicate and
> bundle analysis, cold boots in headless Chromium, an `electron-builder` package, a smoke run of
> the packaged binary, and ~60 small reproductions that import the real modules (Steam Cloud
> sync, SRS kicks, replays, RNG, input handlers, attack routing, bots, the online session
> harness).

**Method.** Eleven parallel reviewers, one per area:

| Area | Area | Area |
|---|---|---|
| Electron and packaging | boot and build | core rules |
| input and local MP | online MP | scores, Steam and saves |
| menus, settings and a11y | lifecycle and audio | rendering and frame pacing |
| structure, tooling and deps | Odyssey | |

Each reviewer was instructed to cite `file:line` and to label every claim:

- **VERIFIED:** traced in code, or reproduced with the real modules.
- **PLAUSIBLE:** a mechanism-level claim that needs a runtime check.

The coordinator re-read the code behind every headline claim (marked "coordinator-verified")
and ran the measurements in Part 2.

**Where it ran.** A Claude Code cloud container: Linux, 4 vCPUs, **no GPU** (Chromium falls back
to SwiftShader software rendering). It is *not* the owner's Windows machine with a dedicated
graphics card. Not done:

- no real Steam session;
- no Windows machine;
- no hardware GPU.

What that means for the findings:

- **Unaffected (the large majority):** code-level findings, CI gates and tests, build and install sizes, duplicate files, package contents, Steam module loading.
- **Container-only:** the GPU-bound timings in Part 2 (boot times, frame rates, "no menu within 200 s") describe a machine with no usable GPU. They say nothing about the owner's hardware, and the report doesn't use them as evidence of a problem there. The only conclusion drawn from them is that there is no lightweight fallback when hardware acceleration is missing (R-17).
- **Cloud CPU:** the CPU-bound microbenchmarks (bot planning, lock cost) ran on a 2.1 GHz cloud Xeon; a desktop CPU will post lower absolute numbers.
- **Real-hardware boot figures** come from the project's own committed Electron captures, made on the dev machine with an RTX GPU (`reports/boot-smoothness/`, 2026-09-29/30).

Performance numbers follow [ADR-0016](adr/0016-perf-claims-require-a-verified-instrument.md):
measured in the container, they illustrate mechanisms; they are not budgets.

## Fixed since this audit

Follow-up fixes made on 2026-10-13 in the same GPU-less container, on branch
`ccr-3487099f-uml9x6` (not yet merged). Only changes that could be verified there were made:
- unit or session-harness tests that fail before the change;
- packaging and smoke runs of the Electron app;
- headless-Chromium checks of the production build.

Nothing here needed a GPU.

On the final code, every `pages.yml` step passes, along with the build and the IP-string and
Pages-artifact checks. The test suite runs 918 files and 18,010 tests. A Linux
`electron-builder --dir` package of it boots to the intro.

| Finding | What changed | Commit | Still open |
|---|---|---|---|
| ELEC-07 · R-16 (1, 6) | `build.files` excludes `node_modules`. `app.asar` is 697 MiB (was 801), with no `app.asar.unpacked` and no `app-update.yml`. ADR-0001 amended; `packaging-config.test.js` guards it. | `b9a1116` | R-16 2–5, 7: duplicate placeholder song, icon sizes, `asarUnpack` for media, the afterPack size assertion |
| ELEC-06 | ez-steam-api and koffi removed (they could never load). | `e968211` | R-04: choose a Steam binding that has leaderboards |
| SCORE-01 | A new device's first sync downloads instead of overwriting. Score and stats uploads read-merge the remote copy first. | `df1adf3` | Settings and keybinds are still last writer wins per document; device-specific keys still roam |
| SCORE-04 (+ SCORE-17 for stats) | Stats merge with max() instead of a sum. `importStatistics` is one transaction that resolves on commit. | `df1adf3` | Per-device counters: max() can miss games played on two devices between syncs |
| NET-01, NET-05, NET-07 | Every match start advances the generation. The lobby status comes from `matchIsOn()`. Watchers get the match start during the countdown and the round beat. | `24c36f0`, `e8481b2` | — |
| INPUT-12 | Key releases are processed while Settings is open; pause and resume drop key latches. | `2a6b8cf` | — |
| INPUT-03 | Pad buttons held across a menu change stay latched until released, in both directions. | `47e2b0e` | — |
| INPUT-11 | The local-MP legacy loop clamps DAS and gravity delta to 50 ms, like single player. | `73d6941` | — |
| ELEC-17 (second instance) | A second instance opens no window (checked with two real Electron processes). | `961dd88` | Quit flush handshake; close confirmation mid-match |
| LIFE-03 (menu dead end) | Odyssey's and Serenity's "Back to menu" emit `EXIT_TO_MAIN_MENU`. | `c8fa53e` | SP and Infinity game over still bypass the manager (`modeStopped`); needs a visual check on real hardware |
| ODY-21 | The layout editor import is statically DEV-gated, so its 362 KB chunk is gone from builds. | `26addbe` | — |
| BOOT-19 | The WebGPU inspector path is relative and loads under `file://`. | `4803803` | — |
| UI-01 (re-apply) | `DisplayManager.applyDisplayMode` re-applies the window mode only when it changes. | `61fd001` | `displays[0]` vs the primary display; window bounds are not persisted |
| BOOT-01, BOOT-02 (error paths) | The startup shell has a failure panel with Restart. A build never falls back to the dev entry. The degraded path is null-safe. The error box uses text and offers Restart. | `08baebf` | A degraded boot that recovers when init finishes late; a reachable safe mode |
| R-36 (part) | Stale lint (807→599) and fitness baselines locked in. The fitness pathspec now counts `src/main.js`. | `06a8113` | Per-file and per-rule ratchets |
| REPO-18 (part) | Unused `node-fetch` removed. | `e5d9e86` | Undeclared `playwright`, `postcss`, `eventemitter3`; exact-pin `phaser` |
| REPO-04 (part), REPO-20 (part) | CI builds on pull requests. Pages and OIDC write permissions belong to the deploy job only. | `b89dfa3` | Windows build lane, timeouts, SHA-pinned actions |

**Decisions for the owner, not attempted here:**
- `wireV2` before 2026-10-31 (R-01).
- The real AppID and launch through Steam (R-03).
- The Steam binding, by ADR (R-04).
- The P2P membership filter, which needs a real Steam session to verify (R-05).
- The Electron upgrade, CSP and fuses (R-07).
- Rules changes behind a rules version (R-13).
- The P1 flip key (R-10).
- VSync (R-22).
- Gating the remaining developer surfaces (R-40; ODY-21 and BOOT-19 are done).
- Licensing (R-42).

**Visual work left for the GPU machine:** R-28, R-29 and the CLAUDE.md screenshot loop.

---

## Part 1 — Executive summary

### Verdict

**Engineering discipline: unusually strong for a solo project.**
- 20 ADRs and shrink-only ratchets (lint, types, fitness, module boundaries, boot closure).
- A supply-chain gate.
- **17,977 passing tests**; every CI gate passed locally.
- A pure cascade resolver, a time-conserving fixed-tick clock, a checksummed chunked resync, and a well-tested startup state machine.
- The online-play fixes from the 2026-10-07 gold-standard audit **hold up in code**.

**The product layer around that core isn't launch-ready.**

1. **The Steam "backend" mostly doesn't work.**
   - Release builds resolve AppID 480 (Spacewar).
   - steamworks.js 0.4.0 has no leaderboard, achievement or friends API. The documented fix (ez-steam-api) can't load next to it on Windows.
   - The Steam overlay is never enabled.
   - The Linux package can't load Steam (seen at runtime).
   - Steam Cloud's first sync on a new device **erases** the Cloud's high scores, stats, settings and keybinds.
2. **Inputs get eaten or misrouted.**
   - Inputs are dropped during hit-stop and clears in every mode.
   - Default bindings collide between players.
   - Bindings use case- and layout-sensitive `e.key`.
   - Unpausing with a pad performs a hard drop.
   - Nothing pauses on alt-tab or pad disconnect.
   - Single Player starts *under* the loading cover, so the first piece can lock unseen.
3. **Rules and replays aren't trustworthy yet.**
   - T/J/L wall kicks are mirrored versus every other SRS game.
   - Replays don't reproduce on the default clock (34 of 40 sessions diverged with ordinary frame jitter).
   - Fixes ship without a rules version.
4. **Ship size, runtime and first launch.**
   - About **40 % of the 1.2 GB install is waste**: 193 MB of unused `node_modules` and 300 MB of byte-identical duplicates.
   - The runtime (Electron 38) has had **no security patches since March 2026**, with 8 high-severity advisories that CI can't see.
   - The opening takes **~10 s** to the title on the default theme and **~33 s** with a heavy theme on the dev machine's RTX GPU (the project's committed captures). The forced waits run back to back, and the opening waits for the selected theme's whole shader prewarm.
   - A boot failure leaves an endless animation with no message.

**Effort.** Most fixes are small: of the 45 recommendations, 24 are S or S–M. The structural
items (an input router, a persistence layer, one frame driver, a rules registry) turn whole
bug classes into things the existing ratchets can guard.

### Area scorecard

| Area | State | Biggest risk | Biggest win |
|---|---|---|---|
| Core rules & sim | 🟡 solid core, wrong defaults | Replays diverge; T/J/L kicks mirrored | Rules registry, then the fixes (R-13, R-15) |
| Input & controllers | 🔴 | Eaten inputs, colliding bindings, pad unpause = hard drop | Input fixes and command gate (R-10, R-14) |
| Local MP & bots | 🟡 | Garbage 1.33–2× intended; bots hitch up to 125 ms | Shared attack routing, sliced bots (R-13, R-20) |
| Online MP | 🟡 post-fix | Peers ignore the next Start after a round-1 finish; IP exposure to any Steam user | Session bugs, P2P filter (R-05, R-06) |
| High scores & Steam services ("backend") | 🔴 | Cloud wipes data; global boards dead | Cloud fixes, real binding (R-02, R-04) |
| Menus & settings | 🟡 strong design system | Settings that lie (VSync, display re-apply) | Settings integrity (R-22) |
| Accessibility & l10n | 🔴 missing | No reduced-motion toggle, flash warning or colour-blind mode | A11y baseline (R-25) |
| Transitions & lifecycle | 🟡 | Nobody owns transitions; mid-run theme rebuilds by default | Transition owner, no-cover rebuilds (R-18, R-19) |
| Audio | 🟢 core / 🟡 mix | Silent after a device change; ducks lost | Gain stages and buses (R-22) |
| Rendering & frame pacing (non-theme) | 🟡 | No frame driver; board upscaled nearest-neighbour | Frame driver, crisp board (R-28, R-29) |
| Boot time | 🟡 good machinery | 9.95 s to the title on the default theme, 33 s on a heavy theme (RTX dev machine, committed captures); dead-ends on failure | Opening budget, failure panel (R-11, R-17) |
| Electron & packaging | 🔴 | EOL runtime; AppID 480; 40 % waste | Upgrade and hardening, install diet (R-03, R-07, R-16) |
| Structure, tooling & CI | 🟡 strong governance | EOL toolchain; ratchets blind to main.js; no Windows/package CI | Toolchain, ratchets, packaged CI (R-27, R-35, R-36) |
| Odyssey | 🟡 content solid | Map unplayable with a controller; mid-build exit bugs | R-12, R-26 |
| Repo & docs | 🟡 | 1.52 GB tracked and growing; docs drift | Repo weight and docs (R-41) |

### If you only do ten things (in this order)

1. **R-01:** decide `wireV2` before **2026-10-31**, or CI and Pages deploys go red on Nov 1.
2. **R-02:** stop Steam Cloud from erasing saves on a new device; fix the stats double-count.
3. **R-03:** ship with the real AppID and launch through Steam; delete ez-steam-api.
4. **R-05 + R-06:** accept P2P only from lobby members; fix restart-after-round-1, join hangs, the "Finished" status and the oversized SYNC.
5. **R-07:** move to a supported Electron (44.x) with a working CSP, fuses and no DevTools in release.
6. **R-10 + R-14:** binding defaults, `e.code`, pad unpause, then a buffered command gate in every mode.
7. **R-08 + R-09:** auto-pause on focus loss; never start a run under the loading cover.
8. **R-16:** remove ~490 MB from the install (one config line and one dedupe).
9. **R-11 + R-12:** a boot that never dead-ends; Odyssey playable with a controller.
10. **R-04:** decide the Steam binding by ADR so global leaderboards can exist; hide them until they do.

### What "backend" means here

There is no game server. The backend is the **Electron main process plus Steamworks**:

| Concern | Steamworks feature |
|---|---|
| Online play | P2P networking and lobbies |
| Global high scores | Leaderboards |
| Stats and achievements | Stats, achievements |
| Saves | Steam Cloud |

That's the right architecture for this game, and it needs no server for launch. The work is
making the Steam layer real and safe (R-02 to R-07). Later, if leaderboard abuse appears, a
tiny serverless verifier can make boards "trusted": Steam auth ticket, then deterministic
re-simulation, then `SetLeaderboardScore`. It only becomes possible once replays are
deterministic (R-15, R-33). Details: SCORE-07.

---

## Part 2 — Measurements

The 2026-10-03 audit was static only. This one also ran the repository's own gates, the
production build, a bundle and duplicate analysis, five cold boots in headless Chromium, an
`electron-builder --dir` package and a 200-second smoke run of the packaged binary.

> **Environment.** A Claude Code cloud container: 4 vCPU / 15 GB, Linux, Node 22.22, **no GPU**
> (Chromium renders with SwiftShader, in software). That is not the owner's machine, which has a
> dedicated graphics card.
> - **Hardware-independent, apply as measured:** §2.1, §2.2, the sizes in §2.4, and the Steam module failure on Linux.
> - **Container-only:** the timings in §2.3 and the smoke run's GPU symptoms describe the software-rendering fallback only. They are **not** what a dedicated-GPU machine sees; real-hardware boot figures are in §4.8, from the dev machine's committed RTX captures.

Sizes from `du` and Node are binary units (MB here means MiB); Vite's chunk sizes are decimal kB.

### 2.1 CI gates (all run locally, in CI order)

| Gate | Result | Time | Note |
|---|---|---|---|
| `npm run typecheck` | pass | 5.9 s | opt-in `@ts-check` island |
| `ts-ratchet-check` | pass | 0.2 s | |
| `npm run lint:ci` | pass | 82.8 s | **602 errors vs 807 baseline**, 1,766 warnings. The baseline is stale, so 205 errors can come back unnoticed. |
| `architecture-fitness-check` | pass | 1.6 s | shader-material 75/200, resize-listeners 24/40: improvements not locked in (`--update`) |
| `audit:theme-lifecycle` | pass | 3.9 s | |
| `check:boundaries` | pass | 7.4 s | 1,674 modules, 5,747 dependencies, 0 violations |
| `perf:budgets:gate` / `check:release-gates` | pass | 1.5 s | |
| `npm audit --omit=dev` (the hard gate) | 0 vulnerabilities | 0.6 s | Blind to Electron, which is a devDependency but ships its runtime to every player |
| `npm audit` (full) | **high:** electron ≤41.10.5 (24 Electron advisories, 8 high, none fixed on 38.x; e.g. use-after-free ×2, `window.open` target scoping, code-sign spoofing, custom-protocol CORS bypass), `@xmldom/xmldom`, `brace-expansion`; **moderate:** vitest/@vitest/mocker | 3.2 s | |
| `npm run build` (Vite + boot-closure guard) | pass | 111 s | Four ineffective dynamic imports reported (see BOOT) |
| `check:ip-strings`, `check:pages-artifact` | pass | <1 s | Run post-merge only in CI |
| `npm test` (Vitest) | **910 files / 17,977 tests pass** | 463.6 s | 490 KB of console noise; some tests make real `fetch` calls that fail (`[DeepOcean] … fetch failed`) |

`npm outdated`: electron 38.8.6 → **44.7.0**, eslint 8.57.1 → **10.12.0**, vite 5.4.21 →
**8.3.4**, vitest 3.2.7 → **5.0.4**, typescript 5.9.3 → **7.0.2**, prettier 3.6.2 → 3.9.10,
dependency-cruiser 18.0.0 → 18.6.0, fast-check 4.9.0 → 4.10.2.

### 2.2 Production build (`dist/`)

| Item | Size | Note |
|---|---|---|
| `dist/` total | **700 MB** | deployed to GitHub Pages on every push to `main` |
| music | 511 MB (72 files) | |
| **byte-identical duplicates** | **300.7 MB** (68 groups, 223 files) | one 8.3 MB song (`blood-moon.mp3`) present as **33 identical files**: the original plus 32 placeholder copies, 254.5 MB wasted; every theme icon (~1 MB PNG each) shipped **3×**: `assets/themes/`, `assets/theme-thumbnails/` and a Vite-hashed copy |
| JS | 119 chunks, 13.5 MB raw | `main` 1,088 kB (301 kB gz); `three` 1,674 kB (460 kB gz); `phaser` 1,686 kB (382 kB gz); `OdysseyLayoutEditor` 362 kB and `UrlParametersView` 250 kB are developer tools shipped to players |
| CSS | **30 files, 1,003 KB raw / 178 KB gz**, 29 render-blocking `<link>`s | served from `public/`, so Vite never minifies, bundles or content-hashes them; `main.css` alone is 263 KB |
| `index.html` | 150 KB | not minified |
| `manifest.json` | 83 KB | fetched with `cache: 'no-store'` on every boot |

### 2.3 Cold boot in the cloud container: no GPU, not representative of dedicated-GPU hardware

Headless Chromium with SwiftShader software rendering, 1920×1080.

Four default runs plus one with `noThemeWarm`, all against `vite preview`. Values are ranges across the default runs.

| Metric | Value |
|---|---|
| First contentful paint | 2.3–4.6 s |
| App KPI `timeToMenuReadyMs` | 10.7–24.8 s |
| App KPI `timeToMenuVisibleMs` | **48–126 s** |
| Main-thread long tasks before the menu shows | 11–13, totalling 80–150 s; the longest single task was up to 104 s |
| Transferred before menu-ready | 84–85 requests, 7.6 MiB (compressed). Includes the 2.2 MiB startup song, ~3 MiB of starter-theme models and textures (incl. a 1 MiB moon JPEG and an 812 KiB impostor PNG), and both `three` and `phaser` |

**Request waterfall, run 4:**

| Time | What loaded |
|---|---|
| 0–136 ms | HTML and 29 stylesheets |
| 204 ms | `app.js` |
| 208 ms | `manifest.json` |
| 258 ms | `entry-desktop` |
| 292 ms | `main` |
| 493 ms | `three` |
| ~6 s | *main-thread work* |
| 6.3 s | `songs.json` and **`phaser`**, although no board exists yet |
| 11.4 s | theme chunk and startup music |
| 14.1 s | theme models and textures |
| 20.4 s | Hub, Single Player and breathwork chunks |
| 21.7 s | a single **104 s** main-thread task |
| 125.6 s | menu visible |

With the `noThemeWarm` kill switch the menu never became ready within 150 s.

**What carries over to real hardware** is the structure, not the seconds. On the dev machine's
RTX the same pipeline reaches MENU_READY at 1.92 s and the title at ~10 s (§4.8). What applies
is the serial loader chain, Phaser and two WebGL contexts created before the menu, 1 MB of
render-blocking CSS, and the theme warm sitting on the critical path.

### 2.4 Packaged desktop app (`electron-builder --dir --linux`, packaged the way `scripts/build-win.mjs` packages)

| Item | Size |
|---|---|
| install directory | **1.2 GiB** |
| `app.asar` | 801 MiB (`dist` 697 MiB, of which 529 MiB is audio) |
| `node_modules` inside the asar (+ `app.asar.unpacked`) | **193 MB**: phaser 91.7, koffi 82.1, three 10.8, steamworks.js 8.1, ez-steam-api 0.3 |
| `resources/native_modules` (extraResources) | 4.9 MB, the copy of the Steam natives the main process actually loads (`electron/steam-integration.js:379-396, 491-499`) |

All 193 MB of `node_modules` in the asar is dead weight: phaser and three are already bundled
into `dist/`, and the Steam natives load from `native_modules/`. With the 300 MiB of duplicate
media, about **490 MiB (~40 %) of the install is removable**. The prior audit marked the
node_modules payload "(plausible)"; it is now confirmed. electron-builder also emits
`app-update.yml` (publish inferred from the GitHub remote) although no updater is used.

**Packaged smoke run** (Xvfb in the container, no GPU, 200 s, no input):
- **Hardware-independent:** Steam never initialises on Linux. `Cannot find module './dist/linux64/steamworksjs.linux-x64-gnu.node'`, because the `extraResources` filter strips `dist/linux64/**` (`package.json` build block). The app then runs offline. `npm run build:linux` produces this build.
- **Container-only (no usable GPU, so not representative of a dedicated-GPU machine):**
  - WebGPU was unavailable, so the app fell back to WebGL2 on SwiftShader. Chromium logs that automatic SwiftShader fallback is deprecated, so a future Electron may drop it entirely.
  - The theme prewarm timed out and the intro played at 15 Hz.
  - No menu appeared within 200 s.
  - The one conclusion drawn: the boot has no lightweight path when hardware acceleration is missing (R-17).

### 2.5 Repository facts

| Fact | Value |
|---|---|
| Visibility | **public** (GitHub API), with Pages enabled |
| Repository size | ~2.2 GB (GitHub's `size` field) |
| Licence | **No `LICENSE` file**, while `package.json` declares `"license": "MIT"`, `"private"` is unset and the game is commercial |
| History | This clone is shallow (258 commits), so history-size findings come from the 2026-10-03 audit |

---

## Part 3 — Prioritized recommendations

Each recommendation merges the related findings from Part 4 (source IDs in brackets) and gives
**Why**, **How** and **Benefit**. Effort uses the umbrella plan's scale: **S** ≤ 1 day ·
**M** days to 2 weeks · **L** weeks or more (solo, part-time).

| Tier | Meaning |
|---|---|
| **P0** | Fix now: a hard deadline, player data loss, a security or privacy exposure, or a shipped promise that is broken |
| **P1** | Next: highest-value player-facing quality (feel, fairness, flow, speed, size) |
| **P2** | Structural investments that stop these bug classes from coming back |
| **P3** | Polish, hygiene and owner decisions |

Ordering inside a tier is by value per effort, with dependencies respected. For example, R-13 (rules versioning) must land before the rule fixes it lists.

### P0 — Fix now

#### R-01 · Decide `wireV2` before 2026-10-31
*Online / CI · S · [CORE-04, NET-13]*
- **Why:** `flags.js:124-130` gives the dated refactor flag `wireV2` an expiry of `2026-10-31`. `tests/unit/flag-registry.test.js:7,39` compares that against today's **UTC** date. At 2026-11-01 00:00:01 UTC (01:00 in Stockholm) `npm test` fails on every push and PR. Because `pages.yml` chains test → build → deploy, Pages deploys stop too. This is by design (the plan's "time bomb"), but the decision is due in 18 days.
- **How:**
  1. Run a 30–60 minute two-machine Steam smoke test on v2 (the raw-frame IPC lane has only run on mock).
  2. If it passes, graduate `wireV2`. There are no public builds, so it costs nothing in compatibility, and v1 stays negotiable as the rollback.
  3. If it doesn't pass, re-date it once, with an ADR-0013 note naming the run date.
  4. Turn the time bomb into a scheduled warning N days before expiry instead of failing unrelated PRs.
- **Benefit:** no surprise red `main` or frozen deploys, and the bandwidth win (host upload ≈2.2 → ≈0.8 Mbit/s at 8P) becomes real.

#### R-02 · Stop Steam Cloud from destroying player data
*Saves / Steam · S–M · [SCORE-01, SCORE-04, SCORE-11, ODY-10, ELEC-17, LIFE-14]*
- **Why:**
  - **First sync wipes the Cloud.** On a new or wiped device, the first sync stamps empty local documents "now" (`steam-cloud-sync.js:952`: `payload.updatedAt || this.now()` turns the bootstrap's deliberate `0` into the current time), so they win and are uploaded. The run wiped the Cloud's high scores, stats, settings and keybinds. It then pushed those defaults back to the original device, resetting its volume, DAS and bindings. If the original PC is gone, the data is gone. The auditor executed the real code; the coordinator re-read the lines.
  - **Stats double-count** on every cross-device download (13 games became 26).
  - **A corrupt Odyssey save** is silently overwritten by the next save and blocks Cloud restore.
  - **Pending uploads are lost** on quit: they're in memory only, the 1.5 s debounce is never flushed, and there is no quit handshake.
- **How:**
  1. Keep bootstrap entries at `0` (`??`), and never let an empty or default local document outrank a Cloud document.
  2. Read-union-write high scores and stats at the upload boundary, as unlocks and Odyssey already do.
  3. Stats: per-device counters (`stats.<deviceId>`; total = sum, records = max), or max() at minimum.
  4. Persist per-file dirty flags. On `before-quit`, send a bounded prepare-quit IPC and wait up to 2 s for the renderer to flush.
  5. Odyssey: back up the raw document on parse failure (the theme collection's pattern), stay read-only until recovered, and let Cloud replace a corrupt local copy.
  6. Tests: "a fresh device adopts the Cloud and leaves it unchanged", "syncs without play are idempotent", and a two-device round-trip property test.
- **Benefit:** a reinstall, a second PC or a Steam Deck restores progress instead of erasing it.

#### R-03 · Ship as the real Steam app
*Electron / Steam · S (plus the owner supplying the AppID) · [ELEC-01, ELEC-06, SCORE-03]*
- **Why:**
  - **Release builds resolve AppID 480 (Spacewar).** The resolver reads `STEAM_APP_ID` (Steam sets `SteamAppId`), then `steam_appid.txt` (which afterPack deletes in release mode), then falls back to 480 (`electron/steam-integration.js:45,87-100`). `init(480)` then overwrites the environment Steam passed. So even after the owner writes the real ID into the txt, which satisfies the gate, the shipped game runs as Spacewar.
  - **Nothing ensures launch through Steam:** no `restartAppIfNecessary`, NSIS creates direct shortcuts, and renderer constants are 480 with `debugMode` on.
  - **ez-steam-api is pure liability.** On Windows it can't load next to steamworks.js (its DLL imports `SteamAPI_Init`, which steamworks.js's `steam_api64.dll` doesn't export). If it did load, its `start()` would call `RestartAppIfNecessary(480)` and the code would ignore the "should exit" answer. It also costs 82 MB of koffi.
- **How:**
  1. One `electron/steam-app-id.js` constant, checked against the txt.
  2. Prefer `process.env.SteamAppId`. In packaged builds never fall back to 480: go offline and log.
  3. At the top of `main.js`, before the single-instance lock, in Steam-channel builds: `if (restartAppIfNecessary(APP_ID)) app.exit(0)`.
  4. Pass the ID to the renderer through `desktop:get-runtime-config` and delete the renderer constants.
  5. Release gate: grep for `\b480\b` under `electron/` and `src/core/steam/`.
  6. Delete ez-steam-api, koffi, the `overrides` entry and both extraResources entries.
- **Benefit:** presence, stats, Cloud and lobbies attach to the actual game instead of a public test app shared with every Steamworks developer.

#### R-04 · Make leaderboards, achievements and friends real, or stop advertising them
*Steam · decision S, build M–L · [SCORE-02, SCORE-08, SCORE-09, SCORE-10, ELEC-06, ELEC-11]*
- **Why:**
  - **No leaderboard or friends API exists** in steamworks.js 0.4.0 (coordinator-verified against `client.d.ts`). Every one of the 9 upload sites in 4 modes returns "Leaderboard not found", and the result is ignored.
  - **Players see it:** the menu permanently reads "Limited — Steam API missing: leaderboards, achievements, friends".
  - **Achievements don't exist:** no IDs and no unlock calls.
  - **The library is frozen:** steamworks.js 0.4.0 (2024-08-06) is its last release.
  - **Latent bugs wait behind it:** details sent as `[object]`, "Around you" requests Global, off-by-one ranges, KeepBest on a win-rate board, concurrent uploads.
- **How:**
  1. Write an ADR choosing the binding: a small fork of steamworks.js on steamworks-rs (which already has leaderboards, NetworkingMessages and the rich-presence join callback), or a maintained FFI binding verified under the ADR-0018 protocol.
  2. Until it lands, hide the leaderboard and friends UI and the "Limited" pill.
  3. Wire achievements now through the existing `client.achievement.*`.
  4. Build one main-process `LeaderboardService`: cached find-or-create handles, a serialized upload queue that only uploads on a personal best, durable retry, and Global / AroundUser / Friends downloads with details.
  5. Check in `steamworks/app-config.json` (boards, stats, achievements) with a test that it equals the code's constants.
  6. Put `electron/` under `@ts-check` with the library's own type. That alone flags the 22 calls to nonexistent APIs.
- **Benefit:** global high scores, one of the features this audit was asked to cover, become real, and the menu stops telling players the game is broken.

#### R-05 · Close the open P2P door
*Online / privacy · S–M · [NET-02, ELEC-04, NET-25, NET-27]*
- **Why:**
  - **Any Steam user can connect.** The main process accepts every `P2PSessionRequest` for the whole time the game runs, menus and Single Player included (`steam-integration.js:319-331`; coordinator-verified). Legacy ISteamNetworking then reveals the player's IP to anyone who knows their SteamID64.
  - **Joins aren't checked:** HELLO has no lobby-membership check.
  - **Kicks don't stick:** a kicked peer is re-admitted at once (harness repro).
  - **No caps:** spectators are uncapped.
  - **Lobby types are wrong:** "Invite only" lobbies are FriendsOnly.
- **How:**
  1. In main, accept sessions and forward or send packets only for `currentLobby.getMembers()`, and only while in a lobby. Re-check for ~3 s after LobbyChatUpdate "entered".
  2. Keep a per-lobby ban set checked at HELLO and on "entered".
  3. Cap spectators.
  4. Make LOBBY_PLAYER_JOINED host→peer only.
  5. Map private → Private (0), and label it "Friends only" until the overlay invite works (R-07).
  6. Unit-test the filter as a pure function.
- **Benefit:** closes IP exposure and lobby griefing without waiting for the NetworkingMessages/relay migration.

#### R-06 · Fix the bugs that break online sessions
*Online · S each · [NET-01, NET-03, NET-05, NET-07, NET-08, NET-04, NET-21]*
- **Why:** NET-01, NET-05, NET-07 and NET-21 were reproduced in the repo's own session harness and NET-08 was measured; NET-03 and NET-04 are traced in code.
  - **NET-01:** after a match decided in its first round (Lines/Score/Time races, Peaceful, frags = 1, an abandoned duel), every peer ignores the next waiting-room Start. They drop a start whose generation equals the last one, and only restarts bump it (`ffa-p2p-game-state.js:1055-1060`; coordinator-verified). The host then plays the peer's input-less copy to a "win".
  - **NET-03:** a join the host never answers hangs forever, and after a host migration *every* join does.
  - **NET-05:** lobbies advertise "Finished" from round 2, which disables drop-in.
  - **NET-07:** watchers who arrive during the countdown never see the match.
  - **NET-08:** the migration SYNC carries a ~100 KB JSON snapshot at 8P that receivers drop (main discards anything over 64 KB, and the mock has no cap, so tests pass).
  - **NET-04:** rules identity isn't negotiated, so the first rules bump (R-13) would silently desync mixed-version lobbies.
  - **NET-21:** abandoned or split matches count as Steam wins.
- **How:**
  - **NET-01:** the host bumps the generation in `startMatch` (one owner), or dedupes on the per-match nonce.
  - **NET-03:** a 10 s handshake deadline → `JOIN_REJECTED('host_unreachable')`. Survivors follow Steam's reassigned owner, or any member answers a stray HELLO with a redirect.
  - **NET-05:** derive the status from `matchIsOn()` on every phase change.
  - **NET-07:** use `matchIsOn()` for spectators.
  - **NET-08:** drop the JSON from SYNC, plus a send-side guard against non-chunked packets over 60 KB.
  - **NET-04:** `simVersion` plus a hash of `matchConfig` and sim flags in HELLO; reject a mismatch as `update_required`.
  - **NET-21:** count a match only if ≥2 players were present at the first spawn.
  - Port each scratch repro as a failing-first test.
- **Benefit:** lobby → match → lobby → match works for every rule set, and joins never dead-end.

#### R-07 · Move to a supported, hardened Electron
*Electron / security · M · [ELEC-03, ELEC-02, ELEC-08, ELEC-10, UI-09, ELEC-05]*
- **Why:**
  - **The runtime is unsupported.** Electron 38 has had no patches since March 2026 (end of life; supported lines are 42–44). It has 24 published advisories, 8 of them high, including a context-isolation bypass and file-protocol cross-origin reads.
  - **CI can't see it.** The CI "hard" audit uses `--omit=dev`, so it never sees Electron, although Electron's runtime ships to every player.
  - **Updates can't merge.** Dependabot bundles Electron with the Vite 8 / Vitest 5 / TS 7 majors.
  - **The CSP likely doesn't apply.** It is header-only while the app loads `file://`.
  - **Permissions are wide open.** There is no permission handler, so Electron grants everything.
  - **No fuses.** `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect` work in the shipped exe.
  - **DevTools is one click away** in the release Settings, together with a "URL parameters" tab that tells players `unlockAll=1` works.
- **How:**
  1. **ADR modelled on ADR-0018.** Pin exactly; target 44.x. Known breaks:
     - 42 stops the `postinstall` download, so `gpu-validation.yml` needs `npx install-electron`;
     - 44 statically links ANGLE, so test the Phaser board.
     Natives are N-API (no rebuild). "Done" means a packaged smoke run, `capture:themes`, Odyssey, a two-machine Steam session and a perf re-baseline.
  2. **Audit and Dependabot.** Give Electron its own Dependabot group. Make CI fail when `npm audit --json` reports a high advisory for `electron`: a small script, because `--omit=dev` hides it.
  3. **CSP now.** A `transformIndexHtml` plugin injects a `<meta>` CSP with sha256 hashes of the inline scripts; drop the Google Fonts origins; a smoke test asserts `eval('1')` throws.
  4. **`app://` before launch.** Move to a privileged scheme (`protocol.handle`) *before the first public build*. localStorage and IndexedDB are origin-keyed, so moving later needs a data migration.
  5. **Deny-by-default permissions:** allow fullscreen, pointer lock and clipboard write.
  6. **Fuses:** `runAsNode` and `nodeOptions` off, `cliInspect` off, embedded asar integrity on, `onlyLoadAppFromAsar` on.
  7. **Gate developer surfaces:** DevTools and the URL-parameters tab behind `import.meta.env.DEV` or the diagnostics flag.
  8. **Overlay A/B.** Test `in-process-gpu` + `disable-direct-composition` (steamworks.js's own overlay recipe) on the iGPU and NVIDIA, and record the trade-off in an ADR. The overlay is the only invite path in 0.4.0.
- **Benefit:** a patched, supported runtime with tested security controls before players install it.

#### R-08 · Never lose a run to focus loss
*Gameplay / UX · S–M · [INPUT-10, UI-03, LIFE-06, CORE-17, ODY-16]*
- **Why:**
  - **Nothing pauses** on alt-tab, minimize, the Steam overlay or a controller disconnect, in Single Player, Infinity, Odyssey or local MP.
  - **The settings don't do what they say.** "When the game is hidden → Pause" and "Slow to 10 FPS" both just pause the *theme*. The intended packaged default (`'continue'`) is dead code because the defaults table always supplies `'reduce'`.
  - **Pause leaks.** Pausing doesn't pause an in-flight cascade (the next piece spawns under the pause sheet).
  - **Timed orbs drift.** They count wall-clock `Date.now()` while unfocused.
- **How:**
  1. One focus policy. On `blur`, hidden, pad disconnect (and overlay activation once the binding exposes it), call `pauseGameOnly()` for pausable modes; online never pauses but releases held inputs.
  2. Resume only on a fresh input, with the shared Ready cue.
  3. Add "Pause when unfocused" (default on) and fix how the default resolves.
  4. Make the cascade pacer await a resume promise.
  5. Use `performance.now()` for level clocks.
  6. Tests: blur sets `isPaused` and shows the sheet; a paused cascade doesn't spawn.
- **Benefit:** standard behaviour players expect from any action game, and no lost Odyssey attempts.

#### R-09 · Don't start the game under the loading cover
*Transitions / fairness · S–M · [LIFE-01, BOOT-13]*
- **Why:**
  - **The board runs unseen.** `SinglePlayerMode.onStart` (and Infinity's) spawns the first piece and starts the game loop *before* the cover finishes waiting for theme-ready (≤6 s), content (≤7.5 s), pipeline settle (~9 s), music sync and its own 2 s minimum + 0.8 s fade.
  - **What players lose:** a warm entry costs ~2–3 rows of unseen gravity; a cold entry up to ~14, enough to lock the first piece unseen. A blind Space hard-drops. The timer and the demo include that time.
  - **Esc misfires:** Esc under the cover opens a hidden Settings sheet while the mode starts unpaused.
  - **Other modes already gate on the reveal:** local MP (countdown) and Odyssey (Ready/Go).
- **How:**
  1. Split `onStart` into prepare and `beginPlay()`.
  2. Have main call `beginPlay()` from the reveal, after the shared start cue.
  3. Add a "loading" input context that swallows gameplay keys and Esc.
  4. Use `waitForFade:false` for music, and lower the warm-entry floor to ~0.5 s.
  5. Tests: no row change before `beginPlay`; a key during the cover does nothing.
- **Benefit:** every run starts visibly and fairly, and warm entries are ~1.5 s faster.

#### R-10 · Input defaults that don't sabotage players
*Input · S · [INPUT-01, INPUT-02, INPUT-03, INPUT-12, UI-05, LIFE-12, text-guard gaps from §4.2]*
- **Why:**
  - **Couch keyboards collide.** P1 `flip` and P2 `moveLeft` are both `'a'` by default (coordinator-verified), so in the default arrows + WASD setup, P2 moving left flips P1's piece.
  - **Bindings break on case and layout.** They match case- and layout-sensitive `e.key`: with P2's hard drop on Shift, a held 'a' becomes 'A' on keyup and the move sticks. CapsLock kills 'z'. AZERTY scrambles WASD.
  - **Unpausing costs a piece.** Unpausing with a pad replays the held B (hard drop) or A (rotate). Results screens have no arm latch.
  - **The first press after Settings is dropped.**
  - **Controller players can lock themselves out.** "Gamepad support: Off" can be chosen with the pad, applies instantly and persists.
- **How:**
  1. Move P1 `flip` to a free key and migrate stored conflicts. Check conflicts across all simultaneously active sets and offer a swap.
  2. Bind by `KeyboardEvent.code`, label with `navigator.keyboard.getLayoutMap()`, release by code, and move P2's hard drop off a modifier.
  3. Latch every button held at a context switch and require a release. Arm result screens 400 ms after they appear.
  4. Always process keyup, and clear `keyMap` on pause and resume.
  5. Menus always respond to the pad. Disabling the pad needs a 10 s confirm-or-revert, and is never allowed on Deck (`isSteamRunningOnSteamDeck`).
  6. Cover `<select>`, contentEditable and the Serenity hotkeys with the text guard.
- **Benefit:** two-player keyboard play works out of the box on any layout, and unpausing never costs a piece.

#### R-11 · Boot never dead-ends
*Boot / Electron · S–M · [BOOT-01, BOOT-02, ELEC-09]*
- **Why:**
  - **Early failures are invisible.** Any failure before `bootstrap()` (chunk import, manifest fetch, TDZ cycle) calls `fail()`, which writes to element ids that no longer exist. The 45 s shell timer stops once `failed` is set, so the animated ident loops forever with no message.
  - **A failed manifest fetch** silently falls back to the dev-only `./src/entry-desktop.js`.
  - **The watchdog's degraded path throws** (`app.gamepadController` on a null `app`) and ends in "check the browser console", which doesn't exist in release.
  - **Safe mode is unreachable:** `safeMode` and `windowsProfile` are never set by `electron/main.js`.
  - **No Electron crash or load handlers.**
- **How:**
  1. A failure panel inside `#startup-shell`: reason, Restart, Safe start, Copy details. `fail()` shows it and stops the CSS lights. Make the 45 s timer independent of `failed`, and persist the last failure.
  2. Use `app?.` in the degraded path, and use `textContent`.
  3. Make safe mode real: a launch argument, automatic after 2 failed boots, or hold Shift. It skips the intro and the theme warm and uses a static menu background.
  4. Electron: on `did-fail-load` and `render-process-gone`, log, reload once, then show a dialog with Restart / Safe mode / Quit. Start `crashReporter` locally.
- **Benefit:** every boot either reaches a playable menu or explains itself, which is what keeps Steam reviews from saying "black screen".

#### R-12 · Make Odyssey playable with a controller and remove its dead ends
*Odyssey · S–M · [ODY-01, ODY-02, ODY-03, ODY-04, LIFE-03, ODY-09]*
- **Why:**
  - **No pad input on the map.** The 3D map accepts only mouse, touch and wheel, so a pad-only player (Deck, Big Picture) can't start orb 1 or leave the map.
  - **"Back to menu" goes nowhere.** The navigator's button calls `onDeactivate()` and dispatches `returnToMenu`, which nothing turns into a menu, so the screen is blank.
  - **Mid-build exits break things.** Exiting during the board build and re-entering quickly opens Odyssey with no map. A board disposed mid-build keeps building, re-attaches its listeners and stays retained.
  - **Hitches inside an orb.** The background chapter loader runs ~400 ms synchronous `create()` calls while a level is being played.
- **How:**
  1. Register an `odysseyMap` input sheet: D-pad/stick steps unlocked orbs, A = Play, Y = navigator, B = back; add arrow/Enter equivalents.
  2. Route `_exitToMenu` through the manager (`EXIT_TO_MAIN_MENU`).
  3. Clear `_boardBuildPromise` on dispose, and add `throwIfDisposed()` after every await in `initialize`/`initRenderer`.
  4. Gate the loader on `isActive && !isRenderingPaused`.
  5. Tests: pad-only launch of orb 1; activate → deactivate mid-initialize → activate; the loader doesn't advance while parked.
- **Benefit:** the campaign, the game's richest content, works on its target platforms and never strands the player.

### P1 — Next: player-facing quality

#### R-13 · Stand up rules versioning, then ship the rule fixes behind it
*Gameplay · M (registry) + S per fix · [CORE-18, CORE-02, CORE-08, INPUT-04, ODY-08, ODY-17, CORE-09, NET-04]*
- **Why:** several rules are wrong in ways that change outcomes, but there is no rules registry, so every fix silently changes how old demos replay and what old scores mean. The line-clear fix already shipped this way, under `DEMO_VERSION` '2.0'. The wrong rules:
  - **T/J/L wall kicks are mirrored left↔right** against every other SRS game (CORE-02). The spawn shape is SRS state 2, but the kick table is looked up as state 0. The repo's SRS test builds its fixtures from the game's own shapes, so it cannot catch this.
  - **The lock-delay reset counter never refreshes at a new lowest row.** After 15 resets on a ledge, a piece that falls 8 rows locks 1 frame after landing (CORE-08).
  - **Local 3–4-player garbage is 1.33–2× intended.** Scaling is computed but not applied, there is no cancellation, and the table differs from online (INPUT-04).
  - **Odyssey: meeting the goal on the final lock still fails** if the next spawn is blocked (ODY-08).
  - **"No singles" counts cascade waves** (ODY-17).
  - **T-spin, B2B and combo are announced but score nothing** (CORE-09, a design call).
- **How:**
  1. Implement plan §5.8: a `rules/` registry with a version per mode, recorded in demos, local records, leaderboard names and the online HELLO (R-06, NET-04). Keep the old interpreters for old demos.
  2. Then land each fix with its own conformance fixtures:
     - SRS lookup `srs = (rotation + (T/J/L ? 2 : 0)) % 4`, with fixtures built from **canonical** SRS matrices: 7 pieces × 4 orientations × 2 directions, plus a TST and a wall TSD. Keep the flat-side-up spawn; the legal review treats orientation as open (`tetris_legal_review.md:553`).
     - Lowest-row reset refresh.
     - One shared `routeAttack` (scale → cancel → distribute) for local and online.
     - Victory evaluated before spawn.
     - Singles counted only when `cascadeCount === 1`.
  3. Decide T-spin/B2B scoring, or drop the announcements.
- **Benefit:** rotation feels like the genre standard, couch FFA is balanced, and fixes stop corrupting replays and records.

#### R-14 · One input command gate for every mode
*Input / feel · M · [CORE-03, INPUT-05, ODY-13, INPUT-11, INPUT-13, INPUT-14, INPUT-20, INPUT-21, INPUT-22]*
- **Why:** inputs are dropped in every mode (online's hooks reject during hit-stop too).
  - **Single Player** rejects every command during hit-stop before buffering. Each hard drop sets 30 ms of hit-stop that spans the next spawn, so taps in the first ~2 frames of every piece vanish.
  - **Infinity, Odyssey and local MP** drop every move and rotate during the ~220–400 ms of each clear or cascade. The busy gate checks the App's idle GameState, not the active mode's.
  - **Local MP** feeds the raw, unclamped delta to DAS, gravity and lock, so one hitch teleports held pieces.
  - **Handling quality:**
    - No SOCD resolution: holding ← then → moves 9 left and 4 right.
    - The stick has no radial deadzone or hysteresis.
    - The pad is polled in a separate rAF.
    - Rounds start with stale held input.
- **How:**
  1. Build a per-GameState `offer(cmd) → APPLIED | BUFFERED | REJECTED` gate in BaseGameMode; SP's 4-slot buffer moves into it.
  2. Defer edges during hit-stop and physics to the first unfrozen tick or the spawn (IRS/IHS), instead of rejecting them.
  3. Don't carry the hard-drop hit-stop into the next piece, and move hit-stop durations from the renderer into core.
  4. Clamp local MP's delta to SP's 50 ms.
  5. Last-input priority SOCD in `das.js`.
  6. Radial deadzone with dominant-axis sectors and hysteresis.
  7. Poll pads first in the frame driver.
  8. Release and re-arm input on round start.
  9. Tests:
     - a tap 1 frame after a hard drop applies, in all modes;
     - an Infinity move during a cascade applies at spawn;
     - DAS/SOCD goldens at 30/60/144/240 Hz.
- **Benefit:** no silently eaten inputs. This is the single biggest "feel" gap versus TETR.IO and Tetris Effect.

#### R-15 · Replays players can trust
*Replays / integrity · M · [CORE-01, CORE-13, CORE-14, SCORE-13, UI-08]*
- **Why:**
  - **Replays don't reproduce on the default clock.** With ordinary 15.5–17.8 ms frame jitter and no stalls, replay scores differed in **34 of 40** sessions; one 400 ms frame gives a different board. Causes: sim time takes the raw delta while gravity, lock and DAS take the clamped delta; the lock bonus floors fractional milliseconds; replay steps in ≤16.67 ms slices.
  - **Seeking is a different game.** It restores the *live* checkpoints, so scrubbing and straight playback don't match.
  - **`REPLAY_VERIFIED` verifies nothing.**
  - **Recording ignores the setting.** Every SP game is force-recorded; the list deserializes up to 200 full demos.
  - **Personal-best replays get pruned** after 200 games.
  - **"Share" is broken:** a `file://…/app.asar` link that nothing reads and that leaks the install path.
- **How:**
  1. Compute the lock bonus from integer frames.
  2. Advance legacy `simTimeMs` by the clamped delta, under a new clock version.
  3. Seek by re-simulation, not by restoring live checkpoints.
  4. Add a record→replay round-trip test with jitter and 100/400 ms stalls.
  5. Rename the flag `REPLAY_SELF_CONSISTENT` until headless re-simulation exists.
  6. Honour `autoRecordDemos` and add a list index.
  7. Pin demos referenced by top scores, using UUID + device IDs.
  8. Replace Share with Export/Import file.
- **Benefit:** "Watch again" shows the game that was played, and replays become usable evidence for leaderboards (R-04) and the determinism cutover (R-33).

#### R-16 · Cut the install and download by ~490 MB
*Packaging / content · S · [ELEC-07, AUDIO-04, ODY-14, coordinator measurement]*
- **Why:** measured on a faithful `electron-builder --dir` package, the install is **1.2 GB**. Of that, **~490 MB (≈40 %) is removable:**
  - **193 MB of `node_modules` packed into the app:** phaser 91.7, koffi 82.1, three 10.8, steamworks.js 8.1. Phaser and three are already bundled into `dist/`, and packaged builds load the Steam natives from `resources/native_modules`.
  - **300.7 MB of byte-identical duplicates in `dist/`:**
    - 32 byte-identical placeholder copies of one 8.3 MB song (254.5 MB), which 30 Odyssey orbs announce as a "new song";
    - every ~1 MB theme icon shipped ×3.
  - **Budget overshoot:** the budgets are 262 MB for app.asar and 450 MB for the installer; app.asar is 801 MB.
  - **The web build is close to the cap:** `dist/` is 700 MB against GitHub Pages' 1 GB limit.
- **How:**
  1. Add `"!**/node_modules/**/*"` to `build.files` and set `npmRebuild:false`. Note the corrected packaging premise in ADR-0001; the dependency placement stays.
  2. Point every placeholder at one shared file (e.g. `blood-moon.mp3#<themeId>` keeps track keys distinct).
  3. Hide "New song" until a real recording exists.
  4. Serve icons from one location as WebP/AVIF thumbnails; ~1 MB PNG icons are oversized for UI tiles.
  5. Add `asarUnpack` for `dist/assets/music/**` and `audio/**`, so SteamPipe can delta-patch media files individually (PLAUSIBLE benefit).
  6. Set `publish:null`.
  7. An afterPack assertion that the asar holds no `node_modules` and stays within budget.
- **Benefit:** a ~700 MB install instead of 1.2 GB, faster Steam downloads and patches, a web build safely under the Pages cap, and honest rewards.

#### R-17 · A fast, predictable opening
*Boot · S–M · [BOOT-03, BOOT-04, BOOT-05, BOOT-06, BOOT-07, BOOT-08, BOOT-09, BOOT-12, BOOT-15, BOOT-16, BOOT-18, BOOT-20, BOOT-21, BOOT-22, ELEC-16]*
- **Why (the project's committed captures, dev machine with an RTX GPU):**
  - **Default theme, cold:** the title becomes interactive at **9.95 s**.
  - **Heavy theme selected:** the handoff begins at **33.1 s**, because the opening waits for the theme's whole shader prewarm.
  - **The waits run one after another.** 1.77 s is spent idle on a 4 s floor after the warm finished, and there is a 515 ms "stable" wait after 2.7 s of idle.
  - **Boot does work the menu doesn't need.** It loads and constructs Phaser (1.6 MB) plus two WebGL contexts and the settings UI before MENU_READY. The main chunk grew 34 % since August; ~44 % of it isn't needed for the menu, including Odyssey's 5.1k-line level data, pulled in just to map rewards.
  - **CSS:** 30 render-blocking, unminified stylesheets (1 MB) where the ident needs ~10 KB.
  - **The loader adds a round trip:** it fetches `manifest.json` (`no-store`), a serial hop.
  - **The KPIs miss the wait.** The headline KPI ends before every forced wait: in the RTX capture MENU_READY fired at 1.92 s while the title became interactive at 9.95 s.
  - **No way to skip.** Returning players can't skip the opening.
  - **No lightweight path without a GPU.** When hardware acceleration is unavailable (a blocklisted driver, a VM, Remote Desktop), the opening still runs the full WebGPU/WebGL theme warm and intro. The GPU-health check can't tell, because the renderer string is discarded by a stub. This is a minority path, and the only evidence for it is the GPU-less cloud container (Part 2); it says nothing about dedicated-GPU machines.
- **How:**
  1. Give the theme a fixed opening budget (~3 s after the floor); pause its progressive prewarm through the handoff and resume at MENU_VISIBLE.
  2. Start the intro and warp prewarm right after the warm, start the floor clock at first paint, and seed `idleSince`.
  3. Add "Opening: full / short / skip", arm skip-on-input at bootstrap, and show the hint after the first viewing.
  4. Create Phaser, the WebGL1 renderer and the settings UI lazily.
  5. Generate a small reward map at build time; dynamic-import breathwork, the player card, the invite manager and the demo browser.
  6. CSS: inline the ident's critical CSS and import mode CSS from mode chunks, so Vite minifies, hashes and splits it. Set Electron's `backgroundColor`.
  7. Loader: a literal `import()` plus `modulepreload` for three, the intro and the warp.
  8. KPIs: record page-relative `titleInteractive` and `humanWait`, persist the last 10 boots, and budget them.
  9. Small items:
     - move tornado params out of the theme chunk;
     - schedule the analyser after MENU_VISIBLE;
     - stagger deferred services after the first mode reveal;
     - start the Steam service at MENU_READY;
     - fix the four ineffective dynamic imports.
  10. Software-rendering fallback: detect it at bootstrap (WebGPU `isFallbackAdapter`; a WebGL renderer string matching SwiftShader / llvmpipe / "Basic Render") → a minimal profile (skip the intro and theme warm, static menu background) plus a "your GPU isn't being used" notice. Cheap insurance for the minority without working acceleration.
- **Benefit:** a ~7.5–8.4 s cold opening on the default theme (from 9.95 s), ~10 s instead of 33 s on heavy themes, and ~2 s to the menu for players who skip (it appears right after MENU_READY).

#### R-18 · One owner for mode transitions
*Lifecycle · M · [LIFE-02, LIFE-03, LIFE-11, NET-12, NET-18]*
- **Why:**
  - **Concurrent requests overwrite each other.** GameModeManager has no transition queue or token, and six call sites chain stop → deactivate → activate → start independently. Scripted interleavings: exiting SP then accepting a Steam invite leaves Online active with `getCurrentModeId()` null, so start throws; an invite during an Odyssey board build drops the invite's lobby ID.
  - **Modes bypass the manager.** SP and Infinity call `onStop()` directly at game over, so `modeStopped` never fires and rich presence, the invite queue and theme session hooks miss it.
  - **Five different return-to-menu paths.**
  - **Online exits all dump players to the main menu**, even mid-results.
  - **Invites:** the queued invite never drains, and `+connect_lobby` is ignored.
- **How:**
  1. A serialized `transitionTo(modeId, options)` queue with a token re-checked after every await.
  2. Identity checks before every post-await write and emit.
  3. A single-flight card handler.
  4. Modes request exit via a callback; only the manager calls lifecycle hooks and emits `runEnded`.
  5. One `exitToMenu()`.
  6. Online exits return to the lobby browser with the reason inline.
  7. Parse `+connect_lobby` on cold start and in `second-instance`.
  8. Tests: the three scripted interleavings.
- **Benefit:** invites always land, and lifecycle events can be trusted by everything that listens to them.

#### R-19 · No theme rebuilds mid-run
*Lifecycle / performance · M · [LIFE-04, LIFE-05, LIFE-08, LIFE-09, LIFE-10]*
- **Why:**
  - **Default settings rebuild themes during play.** The default `backgroundMode:'Level'` switches theme every few levels *during play*, from a per-frame callback that keeps re-queueing while the switch is in flight (coordinator-verified). The outgoing theme is disposed before the new one loads, and the new one compiles its pipelines synchronously. ADR-0020 measured 2.9 s for one heavy shader.
  - **Random and auto-change do the same.** Random mode switches every minute, online matches included; auto theme change fires on every track end.
  - **Switches can't be preempted:** A→B→C builds B fully first.
  - **Entering during the first-entry warm rebuilds the theme from scratch.**
  - **Safe-mode suspend leaks heavy runtimes.**
- **How:**
  1. Build the next theme hidden with an async session, keep the old one running, and swap at a safe point (level-up beat or pause).
  2. No Random or auto switches during Online or local MP.
  3. Compare against `pendingThemeName`.
  4. A per-switch cancel token.
  5. Adopt the in-flight prewarm instead of rebuilding.
  6. Release GPU resources in the no-reuse suspend path.
  7. One BaseTheme loop handle.
- **Benefit:** removes multi-second freezes and blank backgrounds that every player on default settings can hit.

#### R-20 · Bots that never hitch and play fair
*Local MP / Odyssey duels · M · [INPUT-06, INPUT-19]*
- **Why:**
  - **Bot planning blocks the frame.** It runs synchronously inside the frame: p99 37 ms at tier 1 to 108 ms at tier 10 (max 125 ms) on a 2.1 GHz cloud Xeon. A modern desktop CPU will be faster, but the whole plan still runs inside one frame; even at twice the speed, the p99 of tiers 4–10 exceeds a 60 Hz frame (16.7 ms). Three bots in a 4-player match means multi-frame hitches for the humans, which the unclamped local loop turns into DAS and gravity bursts.
  - **Bots see hidden information:** the full 10–16-piece queue, while humans see 3.
  - **Bots aren't reproducible:** they use `Math.random` and wall-clock reactions.
  - **No recovery:** they never re-plan after a failed action.
  - **The difficulty curve is compressed:** the top three tiers are all superhuman (~6 PPS).
- **How:**
  1. Time-slice `plan()` to ~2 ms per frame, round-robin across bots, and pre-plan the next piece while the current one falls.
  2. Limit the bot's queue view to the visible previews.
  3. Seed bots from the match seed and use tick-based reactions.
  4. Re-plan after a failed action.
  5. Recalibrate tiers against measured PPS/APM targets.
  6. A worker is an option, but needs its own ADR (ADR-0006 covers the sim, not advisory AI).
- **Benefit:** smooth 4-player couch matches and a difficulty ladder that covers beginners to experts.

#### R-21 · First-class couch and controller play
*Input / UX · M · [INPUT-07, INPUT-08, INPUT-15, INPUT-16, INPUT-17, UI-14, UI-19, ODY-23]*
- **Why:**
  - **Seat assignment is implicit.** Pads take seats in connection order, keyboard covers seats 1–2 only, a pad can end up driving a bot, and a human seat with no device can start.
  - **Pad menus are controller-1 only.** Players 2–4 can pause but not resume.
  - **The setup sheet's dropdowns** (bot skill, handicap, team) can't be used with a pad.
  - **Steam Deck gaps:** no Steam on-screen keyboard for its six text fields, and Xbox-only glyphs.
  - **Odyssey keyboard:** a tall Odyssey board swallows arrow keys while paused.
  - **Thin handling options:** DAS/ARR/SDF are global rather than per seat, and there's no key or pad test panel.
  - **The invite toast can't be reached with a pad** and expires in 10 s.
- **How:**
  1. A seat roster: "press A or any key to join", per-seat device glyphs and reassignment, keyboard zones (arrows / WASD / numpad), Start blocked while a human seat has no device, and assignments persisted by gamepad ID.
  2. Any pad navigates menus (or the pad that paused owns the sheet), and the router translates pad directions for focused widgets.
  3. `showFloatingGamepadTextInput` on text focus in gamepad mode.
  4. Glyph sets by controller family; haptics on drops, clears and incoming garbage.
  5. Per-seat handling profiles and a test panel.
  6. A pad shortcut for invites, a 20–30 s timeout, and missed invites queued to the menu.
- **Benefit:** couch sessions run entirely from controllers, and the Deck experience meets Verified expectations.

#### R-22 · Settings that do what they say
*Settings / display / audio · S–M · [UI-01, UI-02, UI-15, ELEC-13, ODY-12, REND-04, REND-13, AUDIO-01, AUDIO-02, AUDIO-03, AUDIO-06]*
- **Why:**
  - **Display:**
    - Dragging Render quality, or toggling AA or the FPS counter, re-applies the display mode on every tick: the window is resized and re-centred, and fullscreen is dropped (coordinator-verified).
    - Borderless keeps the frame.
    - The display mode is applied via `displays[0]`, which isn't always the primary.
    - Window bounds are never persisted, and there's no Alt+Enter.
    - VSync is a no-op (coordinator-verified).
    - "Changes apply right away" is false for several rows.
  - **Odyssey board:** reads quality once and ignores Render Scale and the FPS cap.
  - **Dynamic resolution:**
    - It *persists* lowered render scale, quality tier and frame rate into the player's settings. This compounds with GPU-health tiering, so quality ratchets down session by session.
    - It runs only while the FPS overlay is on.
    - It never reaches the live theme.
  - **Quality reach:** quality never reaches the online board, and cosmic exploration always runs at High because `get('graphicsQuality')` ignores its argument.
  - **Audio:**
    - No master or voice volume.
    - Theme-linked audio overrides the player's choice silently.
    - A device change while music is paused leaves music silent until the next track.
    - Four owners share one music gain, so ducks get lost or snap back.
    - Track changes dip to near-silence for ~5 s, and unmute restarts the song.
    - The volume slider is linear in amplitude.
- **How:**
  1. Apply the display mode only when it changes; apply render scale on `change`.
  2. Persist window bounds in main; use `getDisplayMatching()`.
  3. Implement Borderless as Electron's borderless fullscreen; route every fullscreen path through one controller; add Alt+Enter.
  4. Remove VSync or make it a launch switch.
  5. Add `applies: live | reload | restart` metadata shown as a chip on each row.
  6. Odyssey: subscribe to settings, apply Render Scale as the DRS ceiling, add a frame-interval gate.
  7. Dynamic resolution:
     - never persist automatic values (a session override only);
     - sample during gameplay regardless of the overlay, over ≥2 s;
     - one render-scale owner;
     - one `SETTINGS_CHANGED` per step;
     - one quality broadcaster that every scene registers with.
  8. Audio:
     - Master, Music, Effects, Voice and UI buses with a perceptual taper.
     - Build `source → gain → destination` once and tap the analyser as a side branch.
     - Chained gain stages, with ducks as ref-counted leases and `cancelAndHoldAtTime`.
     - A two-element equal-power crossfade.
     - Mute via gain.
- **Benefit:** every control does exactly what its label says, immediately.

#### R-23 · Honest local records and score integrity
*High scores · S–M · [SCORE-05, SCORE-06, SCORE-07, SCORE-08, SCORE-09, UI-07, NET-21, ODY-24]*
- **Why:**
  - **Modes share one table.** Single Player and Infinity share one unversioned local table, and the mode tag is dropped on save, so Infinity runs set SP's rank, "Best score" and "New record".
  - **A storage failure kills the results flow.** An IndexedDB failure at game over (disk full, corrupt LevelDB) is unhandled: no results screen, and the mode stays "processing".
  - **Scores aren't sanity-checked:**
    - Half of all replay checksums clamp to 2147483647.
    - Scores aren't int32-clamped.
    - Infinity survival time is wall clock including pauses: pause overnight and you top the board.
  - **Stats are fragile:**
    - `store()` runs 3–8 times per game over and never at quit.
    - Two declared stats are never written.
    - Playtime gets +1 minute per game.
  - **Abandoned or split online matches count as wins.**
- **How:**
  1. DB v2 adds `mode`, `rulesVersion`, `simClock` and a `[mode, rulesVersion, score]` index (backfill old records as single/legacy), plus per-mode tabs and stats.
  2. Catch storage failures, show results with "Couldn't save this score", and carry on.
  3. A plausibility gate: lines vs pieces, level vs lines, a per-lock score ceiling, minimum duration, int32 clamp.
  4. `simTimeMs` for Infinity.
  5. One `store()` per result and at quit.
  6. Count a match only with ≥2 players present at the first spawn.
  7. Use Steamworks stat "max change" and "increment only" settings.
  8. No server backend is needed for launch. If boards get abused, a tiny verifier (auth ticket → re-simulate → `SetLeaderboardScore`) can make them "trusted" later.
- **Benefit:** records mean what they say, and the global boards (R-04) start clean.

#### R-24 · Online feel and robustness
*Online · S–M · [NET-11, NET-09, NET-10, NET-15, NET-16, NET-22, NET-23, NET-26, NET-12]*
- **Why:**
  - **Opponent boards lag.** The 90 ms interpolation buffer is now pure latency: they show data ~57–90 ms older than what's already in memory.
  - **Watchers can load the host.** Any watcher can make the host recapture the world 4×/s (943 KB in 10 s at 4 players).
  - **Spectators take player seats** in the Steam lobby.
  - **Hot potato is invisible online.**
  - **A superseded host plays on alone and "wins".**
  - **Attack metadata isn't checked.** Peer-chosen attack `complexity` sets Blind duration, ~27 s per attack.
  - **Ready and rematch are host-only.**
  - **Several messages have no handler.**
- **How:**
  1. Render the newest applied state (or a ~40 ms buffer with hold-on-underflow).
  2. No sidecars to spectators; a ≥5 s per-peer resync cooldown; a global capture cap.
  3. Lobby size = players + spectator cap; publish counts as lobby data.
  4. Handle potato updates with a holder badge.
  5. A reliable `superseded` notice; record liveness only after validation.
  6. Take complexity and holes from the host copy.
  7. Rebroadcast ready state; wire rematch votes.
  8. A static check that every message type has a sender and a handler.
- **Benefit:** fresher opponent boards and lobbies that hold up against griefing.

#### R-25 · An accessibility baseline
*Accessibility · S–M · [UI-06, UI-13, UI-16, UI-17, UI-22, ODY-26, LIFE-13]*
- **Why:**
  - **Reduced motion has no setting.** An in-game reduced-motion setting is read by ~19 modules but has no default and no UI, so only the OS setting works.
  - **No photosensitivity protection:** no notice and no flash-reduction option, while effects flash on clears.
  - **No colour-blind option:** I is pure green next to Z pure red. That mapping is a deliberate legal mitigation, so fix it with glyphs or patterns, not guideline colours.
  - **Legibility:** 8–9 px text in places, faint text at ~4.4:1, and no UI scale or high-contrast mode.
  - **Focus:** the Hub is `aria-modal` but doesn't trap or return focus.
  - **Captions:** Hale narration is only partly captioned, although the text exists in `scripts/tts-script.json`.
  - **Motion on the map:** auto-drift ignores reduced motion and never stops.
- **How:**
  1. An Accessibility tab:
     - reduced motion (System / On / Off) driving both the setting and a body class;
     - "Reduce flashing", via SharedEffects caps and a theme hook, plus a first-launch photosensitivity notice;
     - colour-blind support through `tetromino-style-manager`. Per-piece glyphs or patterns are the safer route: any new palette must pass the PAL-1 gate (`npm run check:palette`), because the scrambled shape→colour mapping is a deliberate legal-distance mitigation (`tetris_legal_review.md:378-379`);
     - a 90–150 % UI scale with a 12 px minimum font;
     - a high-contrast token set.
  2. Captions from a line-id → text map.
  3. Put the Hub in the shared sheet stack (focus trap, inert background, focus return).
  4. ARIA fixes: describedby, live region for key capture, `aria-valuetext`.
- **Benefit:** the game becomes playable and comfortable for many more players. Platform certification and press increasingly check for this.

#### R-26 · Odyssey flow, fairness and memory
*Odyssey · S–M · [ODY-05, ODY-06, ODY-07, ODY-09, ODY-11, ODY-15, ODY-17, ODY-18, ODY-19, ODY-20, ODY-22, LIFE-07]*
- **Why:**
  - **Flow is slow:**
    - goal → control is ≈12–18 s on a first clear, ≈5–6 s of it fixed;
    - retry takes ≈1.3–1.7 s, with no mid-run restart key;
    - replays never auto-continue.
  - **Many stars can't be earned.** Deep-chain targets need 10–18-wave chains; the project's own solver peaked at 9 in 192 pieces. The realistic star cap is ≈176, and the finale routes players to those orbs.
  - **Slow loads look like failures.** The entry timeout (6.8–9.8 s) silently bounces the player to the map.
  - **Memory grows per visit.** Each visit retains the previous renderer graph and ~8 MB of shared textures, and the dead warp transition keeps an MSAA WebGL context for the whole session.
  - **The pause menu is thin:** no Restart or Back-to-map.
- **How:**
  1. Flow: Enter/A skips path travel; ~100 ms retry veils; hold-R restart; replays auto-continue.
  2. Pause strip: Restart orb and Back to map.
  3. Retune chain targets to evidence (≤6 on 20-row boards, ≤8 on tall ones), with a `validateAll` ceiling.
  4. "Taking longer…" with Keep waiting / Map instead of a silent bounce.
  5. Call `oneWorld.dispose()` and dispose the shared textures.
  6. Delete the warp transition (~2.2k lines).
  7. Dedupe concurrent chapter creation.
  8. Resume the map whenever it's paused.
  9. Delete dead modifiers and overlays.
- **Benefit:** a campaign that flows like a modern puzzle game, with every star reachable and memory flat across visits.

#### R-27 · Prove it on real Steam and on the shipped package, in CI
*Release engineering · S–M · [NET-06, ELEC-12, BOOT-10, ELEC-14]*
- **Why:**
  - **Nothing online has run on real Steam:** the two-machine run log is empty.
  - **The shipped package is never built or launched before release:**
    - `build-win.mjs` runs a bare `vite build`, so release builds skip the boot-closure guard, the IP-string gate and the pages-artifact check;
    - PRs never build;
    - release mode depends on someone remembering `SERENITY_RELEASE=1`.
  - **The validation harnesses test a different configuration** (`sandbox:false`, `preload.mjs`) from the one that ships.
  - **The coordinator's packaged smoke run** caught the Linux build that can never load Steam. CI never would have.
- **How:**
  1. A PR job on `windows-latest`: `npm run build`, then `electron-builder --dir`, then launch with `--serenity-selftest`. It asserts:
     - the CSP is active and `require` is absent in the page;
     - steamworks loads;
     - the asar has no `node_modules`;
     - the fuses are set;
     - the menu is reached.
  2. A `build:win:release` script that sets the release flag.
  3. Pin the SBOM tool.
  4. Share one `createMainWindowOptions()` between main and the harnesses.
  5. Port the online harness repros, then do one recorded two-machine run.
  6. Drop `build:linux` until the Linux natives and the Steam Runtime are handled.
- **Benefit:** what players install is what CI tested.

#### R-28 · Render the board crisply at every size
*Rendering · M · [REND-03] · visual change: screenshot-verify per CLAUDE.md / ADR-0007*
- **Why:** the game's primary surface is a fixed 400×800 Phaser backing store stretched nearest-neighbour (`image-rendering: pixelated`) to its CSS size:
  - ≈1.14× at 1080p, 1.59× at 1440p, 2.4× on a 1440p@1.5 laptop;
  - **0.71× (a downscale) in a 1280×720 window.**

  Three settings that look like they handle this do nothing:
  - `resolution: devicePixelRatio` has no reader in Phaser 4.2.1 (coordinator-verified);
  - the modes' resize helpers call a `phaserGame.resize` that doesn't exist;
  - `boardHost` is never assigned.

  Non-integer nearest-neighbour scaling makes rims and ghost outlines shimmer on moving pieces, and downscaling drops rows.
- **How:**
  1. On `VIEWPORT_RESIZED`, resize the game to `round(cssSize × min(dpr, 2))`.
  2. Call `camera.setZoom(backingWidth / 400)` so world coordinates stay 400×800.
  3. Drop `pixelated`.
  4. Apply the same to the online, local-MP and Odyssey boards.
  5. Assert `canvas.width === round(clientWidth × dpr)`.
  6. Verify with screenshots at 1080p, 1440p and HiDPI.
- **Benefit:** razor-sharp blocks at every resolution, the first thing every player looks at.

#### R-29 · One frame driver, and near-zero idle cost
*Rendering / performance · M · [REND-01, REND-02, REND-05, REND-07, REND-08, REND-09, REND-10, REND-12, REND-14, REND-15, REND-16, UI-21]*
- **Why:** there is no app frame driver. Sim, Phaser, theme, overlay, menu intro, Odyssey map, cursor and gamepad each run their own loop with four incompatible gates.
  - **Uneven cadence, replayed with the shipped code:** at 144 Hz with the default 60 cap, the board presents in alternating 2- and 3-vsync gaps while the theme runs at 72/s.
  - **The menu background renders uncapped:** a full post stack every vsync, ignoring the 30 FPS battery option. Every return to the menu rebuilds it with a **new GPUDevice** and fresh pipelines.
  - **Idle work that never stops:**
    - an empty full-screen WebGL1 overlay (used by 1 of 62 themes) is cleared, MSAA-resolved and composited every frame;
    - Phaser renders and presents unchanged boards, including in the menu and while paused;
    - a minimised packaged window keeps rendering everything except the theme.
  - **Refresh-rate-dependent timing:**
    - the Infinity camera eases 4× faster at 240 Hz than at 60 Hz;
    - audio envelopes run at ½ speed at 60 Hz and ⅕ at 144 Hz.
  - **Allocation spikes:** every combo wave creates fresh Text textures, exactly where the cascade frame-time tail was found.
  - **Misleading instrument:** the perf monitor counts its own rAF, so a 60-capped board on a 144 Hz display reads "144 FPS".
- **How:**
  1. A `FrameDriver` with one rAF. It decides presentation once per vsync from the rAF timestamp, using a whole number of vsyncs per present. In a fixed order it renders the theme, calls `phaserGame.step()` with Phaser's own loop asleep, then updates the overlay and HUD.
  2. Delete the per-layer gates.
  3. Cap and pause the menu renderer under modals, and park it instead of destroying it (or reuse the warm device).
  4. Create the overlay lazily and early-return when it's empty, or move wolfhour's dust into wolfhour.
  5. `game.loop.sleep()` when idle; bake the static stack into a DynamicTexture.
  6. On a true minimise, `setBackgroundThrottling(true)` (except during online play).
  7. Use time-based smoothing (`1 − exp(−rate·dt)`), pass a real Δt to audio analysis, pool Text objects, and count presented frames per layer.
  8. Measure: present-gap histograms at 60/120/144/165/240 Hz, and port the replays to unit tests.
- **Benefit:** smooth, even pacing on high-refresh monitors, and much lower menu and idle GPU and power cost. That matters for laptops, iGPUs and the Steam Deck's battery.

#### R-30 · GPU context hygiene
*Rendering / stability · S · [REND-06, LIFE-07, ODY-06]*
- **Why:**
  - **Contexts outlive their owners.** Phaser's `destroy()` and three's `dispose()` don't release WebGL contexts.
  - **Contexts accumulate:**
    - local MP creates 2–4 new ones per entry;
    - cosmic exploration creates 2 per session;
    - the dead warp transition holds an MSAA context for the whole session.
  - **Chromium force-loses the oldest** past its ~16-context cap, which would be the overlay or the main board, and board canvases aren't monitored for loss.
- **How:**
  1. Call `loseContext()` before `destroy(true)`, and `forceContextLoss()` on three renderers.
  2. Pool the four board games (sleep/wake) instead of recreating them.
  3. Monitor the board canvases and keep per-session coordinator attempt counts.
  4. Delete the warp path.
  5. Test: 10 local-MP enter/exit cycles produce no "too many contexts" warning.
- **Benefit:** long sessions stay stable instead of decaying.

### P2 — Structural investments (what makes the fixes stick)

#### R-31 · An input router with a context stack and a seat registry
*Input architecture · L · [INPUT-09, plus the root cause of INPUT-03/05/08/12/16, UI-04]*
- **Why:**
  - **Inputs are wired through globals.** 27 input globals are patched by five modes at 31 sites.
  - **There is no single key path:** ~50 keydown/keyup listeners, 7 "is this a text field" predicates and 4 key matchers.
  - **No owner per context**, so modals, results and gameplay steal from each other.
- **How:** a staged migration (design in INPUT-09):
  1. `src/input/router.js` owns the only key and pointer listeners and the only `getGamepads()` poll. It is called first by the frame driver.
  2. A context stack: `menu`, `modal:<sheet>`, `results`, `hub`, `text`, `camera`, `gameplay`. Every push or pop releases held actions and arms on fresh edges only.
  3. A seat registry: bindings by code, button or axis per seat; SOCD and stick sectors in one place.
  4. The per-GameState command gate from R-14.
  5. Delete the `window.*` input globals, then add fitness rules that ban them and ban keydown listeners outside `src/input`.
- **Benefit:** one place decides who owns every key and button press. The bug classes in R-10, R-14 and R-21 can't come back.

#### R-32 · A persistence layer and a settings schema
*Saves / settings · M · [SCORE-14, SCORE-12, SCORE-15, SCORE-16, SCORE-17, UI-11, ODY-10]*
- **Why:**
  - **Storage access is scattered:** 38 modules touch it directly.
  - **No common contract:** 12 durable localStorage keys, 2 IndexedDB databases and 7 Steam keys, with no shared versioning, corruption handling or reset path.
  - **Unclear ownership:** Odyssey progress has 2 writers and 5 parsers.
  - **Settings have no schema:** two drifting defaults tables, dead keys, and Cloud data applied without clamps.
  - **Gaps in coverage:** practice-earned breath grants and the Hale log aren't backed up.
  - **A trap for later:** any future `app://` move orphans every save unless migrated first.
- **How:**
  1. `src/core/persistence/`: a registry with one owner per key and a codec per document (version, migrate, validate, backup-on-corrupt, Cloud merge policy, tombstones for a deliberate "Reset records").
  2. A fitness ratchet banning raw `localStorage` outside the registry.
  3. `settings-schema.js` (type, default, range, category, applies, cloud, platform, control id, help) that generates rows, reset and search.
  4. Add `breath.json` and `hale.json` to Cloud.
  5. Plan the origin migration before R-07's `app://` step.
- **Benefit:** every player-owned byte has an owner, a version and a recovery path.

#### R-33 · Finish or cut the determinism migration
*Simulation · L · [CORE-05, CORE-06, CORE-07, CORE-12, CORE-16]*
- **Why:**
  - **The new sim paths are all still dark:** `fixedTick`, `cascadeV2`, `cascadeShadow` and `rngV2` have been off for ~13 weeks.
  - **The default legacy path carries the bugs** in R-14 and R-15, plus 3 full grid rebuilds and a clone on every lock.
  - **The RNG is weak:** a 233,280-state LCG that is predictable after 14 pieces; legacy Infinity and Odyssey runs are unseeded.
  - **Infinity's spawn truth** comes from the presentation camera.
- **How (in order):**
  1. A fixed-tick replay adapter and versioned result sinks (R-13).
  2. Default `fixedTick` on for SP and Infinity: single board, no network.
  3. Delete the legacy SP/Infinity clock.
  4. Enable `cascadeShadow` in dev to bank evidence.
  5. Bundle sfc32 RNG streams into the same rules bump, and require a seed in GameState.
  6. Incremental `boardGrid` writes; the `board-anchor-v1` spawn policy everywhere.
  7. If the soak fails, record the abort in an ADR and delete the dark path instead.
- **Benefit:** one simulation instead of two, and the default path stops carrying fixed-elsewhere bugs.

#### R-34 · Netcode fairness by design, and a cheaper transport
*Online · L · [NET-19, NET-14, NET-17, NET-20, NET-24]*
- **Why:**
  - **Two copies of every board.** Each peer's board and the host's copy are independent simulations.
  - **Weak divergence check:** it compares score and lines only.
  - **Cancellation is host-only.**
  - **Expensive transport at 8 players:**
    - one awaited IPC call per packet (~650/s);
    - serialization once per peer;
    - backpressure blind to Steam's send queue.
  - **No matchmaking:** steamworks.js 0.4 can't filter lobbies, so there is no quick match, ping or version check.
  - **A god class:** `ffa-p2p-game-state.js` is 4,310 lines.
- **How:**
  1. Ship the per-lock board digest and an idempotent `endMatch` now (both S).
  2. Decide D3/D4 (host-derived attacks, a closed deterministic peer sim) once R-33 lands.
  3. Batched `readP2PPackets(max)` / `sendP2PPacketMany`, with one encode per broadcast.
  4. Through the binding chosen in R-04, use NetworkingMessages/relay and lobby filters (version, distance, open slots) for Quick Match.
  5. Extract in this order, each step pinned by golden session traces:
     - `net-flags`
     - `round-lifecycle` (owns `roundGeneration`)
     - `snapshot-apply`
     - `garbage-system`
     - `roster`
- **Benefit:** fair, verifiable matches that scale to 8 players on ordinary home uploads.

#### R-35 · Supported toolchain and full lint scope
*Tooling · M–L · [REPO-05, REPO-06, REPO-17, REPO-18, REPO-20, ELEC-11]*
- **Why:**
  - **Old majors:** ESLint 8 (end of life since 2024), Vite 5 (three majors behind, no 5.x release in a year), Vitest 3 (moderate advisory), TypeScript 5.9 (7.0 is out).
  - **airbnb-base** pins ESLint ≤8.
  - **`engines`** still allows end-of-life Node 20.
  - **Lint covers only `src/**/*.js`.** `electron/` would show 465 errors; `scripts/`, `tests/` and the inline boot JS are never linted.
  - **Prettier and airbnb contradict each other.**
  - **Dependency declarations are wrong:** `node-fetch` is unused; `playwright`, `postcss` and `eventemitter3` are used but undeclared; `phaser` uses a caret range while tests pin its internals.
  - **CI permissions are too broad:** every job, including PR tests, gets `pages:write` and `id-token:write`.
- **How:**
  1. **Dependabot:** split groups (Electron alone, build, test, lint).
  2. **Vite 7** (still Rollup), with the boot-closure guard as the check. Treat Vite 8/Rolldown as a planned project.
  3. **Vitest 5**, after raising `engines` to `^22.12 || >=24`, plus a `.nvmrc`.
  4. **ESLint migration:**
     - swap in `eslint-plugin-import-x` while still on ESLint 8;
     - write out the kept airbnb rules explicitly;
     - move to ESLint 9/10 flat config with per-directory globals (renderer `src/` gets browser globals only, which surfaces the renderer-side `process` reads);
     - replace the total-count ratchet with ESLint's per-file, per-rule bulk suppressions;
     - pick one formatter.
  5. **Typecheck:** `@ts-check` for `electron/` with the steamworks type, a strict sub-config for net/events/flags, and the 4 missing ratcheted files added.
  6. **Dependencies:** fix the declarations and exact-pin `phaser` (extend ADR-0018).
  7. **CI:** per-job permissions, timeouts, `vitest --shard`, SHA-pinned actions.
- **Benefit:** security patches flow again, and the tooling stops hiding defects (ELEC-11's typecheck alone would have flagged the dead Steam APIs).

#### R-36 · Ratchets without blind spots
*Governance · S · [REPO-07, REPO-14, REPO-22, the lint-ratchet note in §2.1]*
- **Why:**
  - **The fitness script misses the biggest file.** It scans `git ls-files 'src/**/*.js'`, which matches neither `src/main.js` nor `src/entry-desktop.js` (coordinator-verified), so six metrics never see the largest god file.
  - **Big files without ceilings:** 16 non-data files over 2,000 lines, including OdysseyBoardController (4,698) and `odyssey-world-renderer` (4,799).
  - **The nondeterminism regex counts calls only**, missing value uses like `rng = Math.random`.
  - **A file-level depcruise exemption hides 73 forbidden edges**, and new forbidden imports in those files pass.
  - **Improvements aren't locked in:** lint is at 602 errors against an 807 baseline, and the fitness gains are unrecorded.
  - **Flags never graduate:** 36 refactor flags, only 1 dated.
  - **Events go unchecked:** about 30 window event names are unregistered, 6 with no listener.
- **How:**
  1. Use the `':(glob)src/**/*.js'` pathspec.
  2. A ceiling at today's value for every code file over 2,000 lines.
  3. Match `\b(Math\.random|Date\.now|performance\.now)\b` without requiring a call.
  4. Edge-level known violations, shrink-only.
  5. `--update` the lint and fitness baselines now.
  6. A test that every flag has a call site, with dated reviews for release-gated flags.
  7. A `DOM_EVENTS` registry with a dispatch↔listener contract test; call `setKnownEvents` in DEV.
- **Benefit:** the governance system measures what it claims to.

#### R-37 · A test strategy aimed at the risky code
*Quality · M · [CORE-10, REPO-09, NET-06]*
- **Why:**
  - **The tests can't see the real bugs.** 17,977 tests all pass, yet the bugs this audit reproduced live where they don't look:
    - the SRS test derives its expectations from the code under test;
    - the bag test covers dead code;
    - there is no live→replay round trip;
    - `src/main.js` and the Electron main process have only source-text tests.
  - **Regex tripwires:** ~573 assertions across 64 files pin source text, so renames break them while real regressions pass.
  - **No coverage measurement.**
  - **Hidden wall-clock dependence:** 15 assertions will flake on slow runners.
  - **Network access:** some tests make real `fetch` calls.
- **How:**
  1. Independent oracles:
     - canonical SRS fixtures;
     - a fast-check cell-conservation and no-overlap property over random tetromino stacks;
     - record→replay with jitter and stalls;
     - lock-delay and top-out fixtures.
  2. Port every harness repro from this audit failing-first: NET-01/05/07/09/21/25, INPUT-01/03/04, SCORE-01/04.
  3. Extract main.js boot/input glue and the Electron IPC handlers into injectable modules with behaviour tests.
  4. Turn "must not contain X" tripwires into lint or depcruise rules.
  5. A non-gating `@vitest/coverage-v8` report for core, events and electron.
  6. Gate timing assertions behind `PERF=1`; stub `fetch` globally.
  7. Silence the console in tests (`onConsoleLog`): 490 KB of noise today.
- **Benefit:** the suite catches the bugs that reach players.

#### R-38 · Decompose the god files and retire the `window` service locator
*Architecture · L · [CORE-11, NET-24, ODY-27, UI-25, REPO-10, REPO-11, REPO-12]*
- **Why:**
  - **God files:** `main.js` 5,641 lines with 56 globals; `ffa-p2p-game-state` 4,310; OdysseyMode 4,390; OdysseyBoardController 4,698; `settings.js` 2,121; `game.js`/`physics.js` with triplicated rules.
  - **Globals as wiring:** 155 `window.X =` sites; 47 theme files poll `window.serenityBlocks`.
  - **Layering holes:** playground code ships as theme code; an Odyssey chapter imports Summer internals; `core/constants.js` imports a registry that contains DOM code.
- **How:**
  1. Behaviour-neutral extractions along the seams each auditor named:
     - **game core:** `rules/` modules for progression, T-spin/B2B, lock delay, rotation and spawn;
     - **Odyssey:** entry orchestrator, map view and attempt controller; on the board controller, a flag reader, a cancellable bootstrap, a background scheduler, a GPU profiler and map input;
     - **settings:** schema-generated rows.
  2. An `AppContext` (settings, current mode, sound) passed to modes and themes.
  3. A shrink-only `window`-assignment metric (baseline 155).
  4. Move the playground files into their themes; split theme metadata into `src/core/theme-catalog.js`; depcruise rules against playground and theme-internal imports.
  5. Delete the duplicate `pieces.js`/`board.js` code and the P2–P4 copy-paste.
- **Benefit:** a smaller blast radius per change, and code agents can reason about.

#### R-39 · A localization layer
*Reach · L · [UI-18]*
- **Why:**
  - **Volume:** ~270 HTML text nodes, ~2,300 player-facing literals and 1,098 voice-script lines.
  - **English is baked in:** hand-rolled plurals and concatenation.
  - **Mixed languages:** dates and numbers follow the OS locale while the text doesn't.
  - **Fonts:** Latin-only.
  - **Stakes:** Steam's audience is global, and non-English markets are a large share of puzzle-game sales.
- **How:**
  1. Per-locale JSON plus ICU MessageFormat, and `Intl.*` with the UI locale.
  2. `data-i18n` attributes in `index.html`.
  3. The locale from Steam `apps.currentGameLanguage()`, then `navigator.language`, then a setting.
  4. A pseudo-locale build (+35 % length) to catch overflow.
  5. `no-literal-string` lint scoped to `src/ui`.
  6. Cyrillic / Latin-ext font subsets and a CJK fallback.
- **Benefit:** the store page can list more languages, and every caption and string has one source of truth (shared with R-25 captions).

### P3 — Polish, hygiene and decisions

#### R-40 · Take dead code and developer surfaces out of production
*Hygiene · S–M · [UI-09, BOOT-11, BOOT-17, BOOT-19, BOOT-22, ODY-20, ODY-21, ODY-25, AUDIO-08, NET-26, UI-23, ELEC-18, CORE-15, CORE-16, CORE-19, REND-20, REPO-10, REPO-13, REPO-19]*
- **Why:** players are shipped developer tools and dead code:
  - the 362 KB OdysseyLayoutEditor and the 250 KB URL-parameter reference;
  - test globals and `?localMp=` flows;
  - ~2.2k lines of the dead warp transition;
  - dead modifiers on 34 orbs;
  - legacy procedural music generators;
  - message types with no handler;
  - `preload.mjs`, `main-minimal.js`, `preload-minimal.cjs` and `electron/steam_appid.txt` (AppID 480);
  - 1,144 `console.log` calls;
  - Phaser's 3D-camera and Facebook plugins, which register because the replace targets are wrong.
- **How:**
  1. Gate dev surfaces on `import.meta.env.DEV`.
  2. Delete the listed dead code and its tests.
  3. Use a top-level build-only `esbuild: { pure: ['console.log', 'console.info'] }` and a leveled logger.
  4. Fix the Phaser replace targets (`typeof PLUGIN_CAMERA3D`/`PLUGIN_FBINSTANT` → `false`).
  5. Use `./vendor/` paths.
  6. Emit hidden source maps for crash symbolication.
  7. Ratchet unused exports.
- **Benefit:** a smaller, quieter and less exploitable shipped app.

#### R-41 · Repository weight and documentation
*Repo hygiene · M · [REPO-02, REPO-08, REPO-15, REPO-21, REPO-23, REPO-25]*
- **Why:**
  - **1.52 GB tracked, growing fast:** MP3 529 MB, PNG 475 MB, evidence zips split into 40 MB parts to dodge GitHub's limit.
  - **`reports/` holds code and debris:** forked scripts, logs, cpuprofiles and .blend files.
  - **Dead assets:** about 62 MB unreferenced in `public/`, and `playground-refs` (140 MB) ships in `public/`.
  - **Docs drift:** README is stale (Phaser rc.5, 6 of 7 links dead) and ships in `dist`; 41 docs are unreachable from the index and 182 links are broken.
  - **Clutter:** 22 root `.md`/`.txt` files and obsolete scripts.
- **How:**
  1. Git LFS, or Release assets with the existing SHA-256 manifests, for zips, `.part-*`, `.blend`, `.cpuprofile` and report binaries. Commit SHAs, not copies of source.
  2. Move `playground-refs` out of `public/` and delete the dead assets.
  3. Make `check:pages-artifact` fail on duplicates over 1 MB and on an over-budget total.
  4. Execute the prior audit's Part 2 archive table, and rewrite the README with its Legal block verbatim.
  5. Add shrink-only `docs:*` fitness metrics: unreachable docs, broken links, root allowlist, valid statuses.
  6. Move the inline boot JS into `src/boot/`.
  7. Add `scripts/README.md` and use `fileURLToPath`.
  8. One logical change per commit.
- **Benefit:** fast clones, clean code search, and docs agents can trust.

#### R-42 · Decide licensing and distribution deliberately
*Owner decision · S · [REPO-24, BOOT-14]*
- **Why:**
  - **The licence says MIT by default.** The repository is **public** and `package.json` declares `"license": "MIT"`, with no LICENSE file and no `private: true`. For a commercial game, that reads as an open-source grant of the code. The asset licences in CREDITS are separate and fine; the Suno music records are documented.
  - **The whole game is free on the web.** CI deploys the full game (all themes, all music) to GitHub Pages on every push, against a 1 GB site limit.
  - **The web build has no defined support level:** no service worker, and deploys break open tabs.
- **How:**
  1. Choose: `"license": "UNLICENSED"`, `"private": true`, an author and a COPYRIGHT notice, or an intentional licence.
  2. Decide whether Pages hosts the full game, a demo subset, or only a landing page.
  3. If the web build stays: add a service worker, route CSS through Vite, reload on `vite:preloadError`, and host music elsewhere.
- **Benefit:** intent instead of accident, before launch.

#### R-43 · Onboarding, how-to-play, version and credits
*UX · M · [UI-20]*
- **Why:**
  - **Nothing explains the game:** Single Player, Infinity and Online don't explain the controls or the cascade mechanic, which is what makes the game different.
  - **No version or credits screen**, yet toasts tell players to "Update Serenity Blocks".
- **How:**
  1. Reuse `versusCoachRows` for a first-runs controls card.
  2. Add a How-to-play sheet with an animated cascade example.
  3. Show the version and Credits in Settings.
- **Benefit:** new players understand the game's unique rule in the first minute.

#### R-44 · Agent tooling that works everywhere
*Workflow · S · [REPO-16]*
- **Why:**
  - **The visual-check tool only starts on Windows.** `.mcp.json` launches the chrome-devtools MCP with `cmd /c`, so it failed in this Linux cloud session, while CLAUDE.md requires that MCP for the visual definition of done.
  - **No setup hook:** there's no SessionStart hook, so cloud sessions start without `node_modules`.
  - **Duplicated agent docs:** CLAUDE.md and AGENTS.md are hand-synced near-duplicates without the commands or the "PR CI doesn't build" rule.
  - **Lockfile drift:** `.claude/settings.json` pre-approves `npm install:*`, which can drift the lockfile.
- **How:**
  1. A small Node launcher for the MCP that spawns `npx` with `shell:true` and accepts Playwright's Chromium path.
  2. A SessionStart hook running `npm ci --ignore-scripts`.
  3. Make AGENTS.md canonical, with CLAUDE.md as `@AGENTS.md` plus Claude-only notes.
  4. Pre-approve `npm ci` rather than `npm install`. This is the owner's call; this audit changed no settings.
- **Benefit:** every agent session can follow the project's own verification rules.

#### R-45 · Smaller UX polish
*UX · S each*
- **Pause flow** [UI-12]: "Main menu" abandons a live run or online match with no confirmation, and there is no Restart or Quit. Serenity's Esc quits instantly. Use the in-app confirm whenever a run is live.
- **Cursor** [UI-21]: the custom cursor replaces the OS cursor by default and adds a frame of latency. Default to the system cursor, and suppress the custom one in gamepad mode.
- **Gameplay options** [UI-26]: ghost opacity, a preview count of 1–3 (MechanicsMixer already supports `previewCount`; stay within 3, because the legal review lists hold and the 5-slot preview as deliberate mitigations, `tetris_legal_review.md:380-381,409,547-548`) and coarser pad slider steps.
- **Audio** [AUDIO-05/06/07]: SFX scheduled on `ctx.currentTime`, a voice cap, per-player cooldowns, a perceptual volume taper and real breath-voice preloading.
- **Odyssey** [ODY-22/23/26]: held-key policy, copy nits, and map auto-drift under reduced motion.
- **Game-over arm delay** [LIFE-12]: so hard-drop spam doesn't skip the results.

---

## Part 4 — Detailed findings by area

Every finding, condensed. Columns:

| Column | Meaning |
|---|---|
| **Sev** | severity |
| **Eff** | effort: S / M / L |
| **Conf** | VERIFIED (traced or reproduced) / PLAUSIBLE (mechanism; needs a runtime check) |

Part 3 merges these into recommendations.

### 4.1 Core rules, Single Player, Infinity, Serenity, replays (CORE)

| ID | Finding | Sev | Eff | Conf | Evidence |
|---|---|---|---|---|---|
| CORE-01 | **Replays don't reproduce on the default clock, even at a steady 60 Hz.** Live play advances `simTimeMs` by the raw delta, while gravity, lock and DAS use the 50 ms-clamped delta. Replay steps in ≤16.67 ms slices. The lock bonus `floor((100-framesElapsed)/2)` uses fractional ms. With ordinary 15.5–17.8 ms jitter and no stalls, replay score differed in **34/40** sessions and the board in 2/40. One 400 ms frame gives a different board. Seeking restores live checkpoints, so scrubbing and straight playback show different games. | High | M | VERIFIED (repro) | `game.js:1425,1428,1419,1443,1460,1233-1240`; `DemoPlayer.js:458-471,573-592,313-325` |
| CORE-02 | **T/J/L SRS kicks mirrored left↔right.** Spawn matrices are SRS state 2, but the kick key is built from `piece.rotation` (0 at spawn), so all 8 T/J/L transitions are exact x-negations. The SRS test builds shapes from the game's own SHAPES, so it can't see this. A non-SRS ±1/±2 fallback also runs after SRS. | High | S | VERIFIED (repro + coordinator) | `constants.js:81-105`; `game.js:995-996,1018-1022`; `srs-kick-tables.test.js:45-61` |
| CORE-03 | **Inputs lost during hit-stop and, outside Single Player, during every clear.** SP rejects commands while `hitStopRemaining>0` before buffering, and every hard drop sets 30 ms of hit-stop that spans the next spawn. Infinity, Odyssey and local MP have no dispatcher: the busy gate checks the App's idle GameState and `window.move/rotate` return early. | High | S–M | VERIFIED | `SinglePlayerMode.js:804-818,1123-1128`; `main.js:3743-3786,3410-3440`; `game.js:1438-1457` |
| CORE-04 | **`wireV2` expiry: CI turns red at 2026-11-01T00:00:01Z** (01:00 Stockholm). The test uses the UTC date, and `test` gates `build` → `deploy`, so Pages deploys stop. | High (deadline) | S | VERIFIED (faked Date) | `flags.js:124-130`; `flag-registry.test.js:7,39`; `pages.yml` |
| CORE-05 | **Determinism migration stalled dark ~13 weeks.** `fixedTick`, `cascadeV2`, `cascadeShadow` and `rngV2` are all off. Blockers: DemoPlayer can't replay `fixed60-v1`; result sinks accept only legacy sessions; cascade animation sits outside tick ownership; no shadow soak evidence; `rngV2` has no reader. | High (arch) | L | VERIFIED | `flags.js:202-213`; `DemoPlayer.js:145-150`; `single-player-result-compatibility.js:12-22` |
| CORE-06 | **Piece RNG predictable after 14 pieces.** The LCG has only 233,280 states: seeds 233,280 apart give identical games, and 14 observed pieces identify the state exactly. Legacy Infinity and Odyssey are unseeded and fall back to `Math.random`. | Med | M | VERIFIED (repro) | `helpers.js:21-37`; `InfinityMode.js:288-293`; `OdysseyMode.js:2037-2039`; `game.js:609,741,828` |
| CORE-07 | **3 full grid rebuilds + 1 clone per plain lock; 6 + 3 per clearing lock.** The flag is read via regex + localStorage every lock; `maxPotentialFall` is computed for a disabled log; the BFS uses `queue.shift()`. Deep-Infinity lock p90 is 14 ms in Node on the cloud CPU (indicative only). | Med | M | VERIFIED counts | `game.js:93,1320`; `physics.js:689,709,1016,1264,284-313`; `cascade-helpers.js:53,70` |
| CORE-08 | **Lock-reset counter never refreshes at a new lowest row**, so after 15 resets on a ledge, a piece that falls 8 rows locks 1 frame after touching down. No lock-out; hidden rows never clear; 3-wide pieces spawn one column right of guideline. | Med | S | VERIFIED (repro) | `game.js:236-243,296-322,366,875-884` |
| CORE-09 | **T-spin, B2B and combo are celebrated but score nothing.** Detection is 3-corner only, with no mini, and can be armed by non-SRS fallback kicks. | Med (design) | S | VERIFIED | `scoring.js:23-58`; `SinglePlayerMode.js:1192-1207` |
| CORE-10 | **Rules tests can't catch the bugs that matter.** The SRS test is self-referential; the bag test covers dead `pieces.js` code; fast-check is used in only 2 files; no live→replay round trip; ~80/840 tests are source-regex tripwires. | Med | M | VERIFIED | `cascade-resolver-property.test.js:27-89`; `pieces-rotation-bag.test.js` |
| CORE-11 | **God files with triplicated rules.** GameState has 74 constructor fields plus ≥23 ad hoc. Level-up and T-spin/B2B logic exist ×3. Dead exports and helpers remain. The sim reads theme colour from `window`. `game.js`/`physics.js`/`das.js`/`garbage.js` aren't `@ts-check`. | Med | M–L | VERIFIED | `game.js:37-59,1551-1628`; `physics.js:523-640,826-894,1186-1230`; `cascade-resolver.js:269-304` |
| CORE-12 | **Legacy Infinity takes spawn and roof truth from the presentation camera** (`camera-v1` policy). Expansion and roof checks run in the draw callback. | Med-Low | S–M | PLAUSIBLE | `infinity-spawn-policy.js:12-15`; `InfinityMode.js:963-976,1312-1324,2216` |
| CORE-13 | **`REPLAY_VERIFIED` set without verification**: metadata is compared with the state it was written from. | Low→High once leaderboards work | S | VERIFIED | `replay-proof.js:62-79` |
| CORE-14 | **Every SP game is force-recorded** (`shouldRecord = true`; the setting has no UI). The demo list still deserializes up to 200 full records. | Low | S | VERIFIED | `SinglePlayerMode.js:382`; `DemoManager.js:11,132-160` |
| CORE-15 | **Odyssey modifiers that do nothing**: `enableCascadingGravity` (Gravity Cascade, on 24 orbs per the ODY level-data scan) and `timeAttackMode` (10 orbs) are never read. | Low | S | VERIFIED | `ModifierStack.js:21-44`; `levels.js:163…` |
| CORE-16 | **`MAX_CONCURRENT_LOOPS` guard can never trip**: 5 duplicate chains ran 300 callbacks with 0 warnings. | Low | S | VERIFIED (repro) | `game.js:1358-1360,1503-1537` |
| CORE-17 | **Pausing doesn't pause a cascade.** The pacer uses wall-clock time and the spawn ignores `isPaused`, so the next piece spawns under the pause overlay. | Low | S | VERIFIED | `physics.js:184-215`; `game.js:1197-1215` |
| CORE-18 | **Outcome-changing fixes ship with no rules version.** The line-clear fix kept `DEMO_VERSION` '2.0'; there is no rules registry. | Low (but gating) | S | VERIFIED | `DemoRecorder.js:10` |
| CORE-19 | **Serenity leaves an 8 s cooldown and notification timers running after exit**, so a stray toast can appear in the next mode. | Low | S | VERIFIED | `SerenityMode.js:236-247,867-869,1083-1087` |

**Rules conformance** (keep the legally attested deviations; `tetris_legal_review.md` lists hold and the 5-slot preview as mitigations):

| Feature | Current | Peers (TEC/TETR.IO/PPT2) | Recommendation |
|---|---|---|---|
| Randomizer | 7-bag over a 233,280-state LCG | 7-bag, strong PRNG | sfc32 streams (CORE-06) |
| Hold / previews | none / 3 visible | hold + 5–6 | **keep (legal)** |
| Kicks | SRS with T/J/L mirrored, plus legacy fallback | SRS | state offset for T/J/L (CORE-02) |
| Lock delay | 500 ms / 15 resets, never refreshed | refresh at new lowest row | CORE-08 |
| Top-out | block-out only | block-out + lock-out | add or document |
| Input buffering | SP only: 4 slots, none in hit-stop | IRS/IHS, buffered | uniform command gate (CORE-03) |
| Handling | DAS 50–300 ms, ARR 0–100, SD 50 ms/row, no DCD, no SOCD | DAS ≥1F, DCD, SDF×, last-input SOCD | lower DAS min, SDF multiplier, DCD, SOCD (INPUT-13) |
| T-spin/B2B/combo | detected, unscored | scored | design call (CORE-09) |

### 4.2 Input, controllers, local multiplayer, bots (INPUT)

| ID | Finding | Sev | Eff | Conf | Evidence |
|---|---|---|---|---|---|
| INPUT-01 | **Default bindings collide across players:** P1 `flip:'a'` and P2 `moveLeft:'a'`. One tap gives `P2.move(-1)` + `P1.rotate(flip)`. The conflict check is per player and silently reverts. | High | S | VERIFIED (repro + coordinator) | `constants.js:286,292`; `settings.js:76,81,707-712`; `controls.js:623-686` |
| INPUT-02 | **Bindings match case- and layout-sensitive `e.key`.** P2 hard drop is `Shift`: holding 'a', tapping Shift and releasing 'a' gives keyup 'A', so the move sticks (10 moves in 500 ms). CapsLock kills 'z'. AZERTY/QWERTZ scramble WASD. Four different matchers. | High | S–M | VERIFIED (repro) | `controls.js:622-631,764-784`; `constants.js:298` |
| INPUT-03 | **Unpausing with a pad performs a gameplay action.** The still-held B (= hard drop) or A (= rotate) registers as a new press after the sheet closes, because `disableMenuNavigation()` wipes edge state. The local results overlay has no arm latch. | High | S | VERIFIED (repro) | `gamepad-controller.js:1137-1139,1424-1431`; `main.js:3034-3036`; `local-match-end-overlay.js:156,186` |
| INPUT-04 | **Local 3–4P garbage: scaling computed, not applied; no cancellation; different table from online.** 3P depth 5 → reported 3, received 4/4. 4P depth 8 → reported 4, received 7/7/7. | High | S | VERIFIED (repro) | `multi-player-state.js:659,698-700,801-815`; `ffa-attack-router.js:271,439-470` |
| INPUT-05 | **Taps during line clear/ARE and hit-stop discarded in every mode; no IRS.** | High | M | VERIFIED | `main.js:3412-3466,3559-3715`; `LocalMultiplayerMode.js:1567-1604`; `game.js:899` |
| INPUT-06 | **Bot planning runs synchronously inside the frame:** p99 37 ms (tier 1) to 108 ms (tier 10), max 125 ms on a 2.1 GHz cloud Xeon (a desktop CPU is faster, but even at 2× the p99 of tiers 4–10 exceeds a 16.7 ms frame). Three bots in a 4P match cause multi-frame hitches. | High | M | VERIFIED (measured) | `local-multiplayer-loop.js:520`; `puzzle-bot-controller.js:200-205`; `OdysseyBotMatch.js:51` |
| INPUT-07 | **Seat↔device assignment is implicit.** Pads take seats in connection order; keyboard covers seats 1–2 only; a pad can drive a bot seat; a human seat with no device can start. | High | M | VERIFIED | `gamepad-controller.js:293-305,1889-1941`; `local-seat-controls.js:49-50` |
| INPUT-08 | **Pad menus are controller-1 only.** P2–P4 can pause but can't resume. CosmicSelect dropdowns (bot skill, handicap, team) can't be used with a pad. Hold-to-repeat is defined but unused. | High | M | VERIFIED | `gamepad-controller.js:200-201,709,981,1151,2379`; `cosmic-select.js:65-125` |
| INPUT-09 | **Input has no owner.** 27 input globals, 31 `window` patch sites across 5 modes (LocalMP patches 4 `hold*` globals nothing defines), ~50 key listeners, 7 text predicates. → router design in R-12. | High (struct) | L | VERIFIED | `main.js:3379-3887`; `LocalMultiplayerMode.js:1543-1633` |
| INPUT-10 | **Nothing pauses on blur, Steam overlay or pad disconnect.** With `backgroundThrottling:false` the page likely stays "visible" when minimized, so the hide-based clears may never run. | Med-High | S–M | VERIFIED (absence) | `main.js:3870`; `gamepad-controller.js:342-372`; `electron/main.js:571` |
| INPUT-11 | **Local MP loop feeds the raw, unclamped delta to DAS, gravity, lock and bots**, so one hitch teleports held pieces (SP clamps to 50 ms). | Med | S | VERIFIED | `local-multiplayer-loop.js:506,518,538` |
| INPUT-12 | **First press after closing Settings is dropped** (keyup ignored while Settings is open; `keyMap` not cleared). | Med | S | VERIFIED (repro) | `controls.js:391-401,672,767-771` |
| INPUT-13 | **No SOCD resolution:** holding ← then → for 400 ms gives 9 moves left and 4 right. | Med | S | VERIFIED (repro) | `controls.js:141-153`; `player-input-state.js:314-321` |
| INPUT-14 | **Stick has per-axis thresholds, no radial deadzone, no hysteresis:** (−0.30, 0.90) moves and soft-drops together; a jittery X gives 5 moves in 10 polls. | Med | S | VERIFIED (repro) | `gamepad-controller.js:2090-2103` |
| INPUT-15 | **Steam Deck gaps:** no on-screen keyboard for 6 text fields; Xbox-only glyphs (~15 sites); no haptics; 1280×800 board size is fine (27 px blocks at 4P). | Med | M | VERIFIED (absence) | `index.html:786`; `lobby-browser.js:86`; `ThemesTab.js:395` |
| INPUT-16 | **Pausing a tall Odyssey board swallows every arrow key** (a capture-phase listener), so the Settings tabs and sliders don't work by keyboard. | Med | S | VERIFIED | `OdysseyMode.js:480-484,4239,4279-4296` |
| INPUT-17 | **Handling depth below peers:** DAS/ARR/SDF are global, not per seat; no stick/trigger binding; no "up = hard drop" option; no key/pad test panel. | Med | M | VERIFIED | `settings.js:1337-1339,820,830` |
| INPUT-18 | **One Phaser.Game per local player** (4P = 4 games + the paused main game + theme + loops), booted sequentially 100 ms apart. | Med | L | VERIFIED | `local-board-hosts.js:79-90` |
| INPUT-19 | **Bots see the hidden 10–16-piece queue, use `Math.random` and wall-clock reactions, never re-plan after a failed action**; the top three tiers are all superhuman (~6 PPS). | Med-Low | S–M | VERIFIED | `puzzle-bot-controller.js:137-141,197`; `bot-difficulty.js` |
| INPUT-20 | **Gamepad polled in its own rAF**, so pad edges likely land a frame later than keyboard in SP. | Low-Med | S | PLAUSIBLE | `gamepad-controller.js:616-627` |
| INPUT-21 | **Rounds start with stale held input** (no DAS clear or countdown between local rounds). | Low | S | VERIFIED | `LocalMultiplayerMode.js:567,2232` |
| INPUT-22 | **Small defects:** `window.rotate`/`hardDrop` return `undefined` (instant ARR never stops at a wall; board juice plays for failed rotations); the dead `#match-chat-input` shortcut; an InGameChat listener leak per FFA state. | Low | S | VERIFIED | `main.js:3426-3485`; `ingame-chat.js:23,66`; `ffa-p2p-game-state.js:215` |

### 4.3 Online multiplayer, netcode, Steam transport (NET)

The 2026-10-07 gold-standard audit's Phase-1 fixes hold up in code: departures, rejoin, `FragTracker.isHost`, clock skew, prior-round garbage, teardown fences, SYNCPOINT spam, BigInt lobby counts, attack-depth bounds and peer-string escaping are all **fixed**. What remains:

| ID | Finding | Sev | Eff | Conf | Evidence |
|---|---|---|---|---|---|
| NET-01 | **After a match decided in round 1, every peer ignores the next waiting-room Start.** Peers drop a start whose generation equals the last one, and only restarts bump the generation. The peer stays in the waiting room while the host plays its input-less copy to a "win". Hits Lines/Score/Time races, Peaceful, frags=1 and abandoned duels. | High | S | VERIFIED (harness + coordinator) | `ffa-p2p-game-state.js:1055-1060,1787-1831,3839,4087`; `OnlineMultiplayerMode.js:855-871` |
| NET-02 | **Any Steam user can open a P2P session with you whenever the game runs** (menus and SP included). Every P2PSessionRequest is accepted, which exposes your IP via legacy ISteamNetworking. HELLO has no lobby-membership check, a kicked peer is re-admitted at once, and spectators are uncapped. | High | S–M | VERIFIED (+ coordinator) | `steam-integration.js:319-331,415`; `join-handshake.js:129-200`; `ffa-p2p-game-state.js:624-671` |
| NET-03 | **A join the host never answers hangs forever,** and after a host migration every new join does: joiners target Steam's lobby owner, and the elected host is the lowest SteamID. A connect failure shows "The host left". | High | S–M | VERIFIED code | `ffa-p2p-game-state.js:756-781`; `host-migration.js:105,134`; `steam-networking.js:370` |
| NET-04 | **Rules identity isn't negotiated.** HELLO/WELCOME carry wire versions only. Sim-affecting flags (`peerLocalSim`, `garbageDrainAll`, `garbageIdempotent`, `holdStats`, `cascadeV2`) are read per machine. `rulesHash` is computed and never compared. | High (pre-launch) | S | VERIFIED | `join-handshake.js:22-35,66-83`; `ffa-p2p-game-state.js:298-403,2263` |
| NET-05 | **Lobbies advertise "Finished" from round 2 onward,** so drop-in is disabled. | Med-High | S | VERIFIED (harness) | `frag-tracker.js:254`; `ffa-p2p-game-state.js:2898-2906,3872-3876`; `lobby-browser.js:327-338` |
| NET-06 | **Nothing has run on real Steam:** the two-machine run log is empty, the checklist counters don't exist, and network budgets are ungated (baseline 490 vs max 80). | High (release gate) | S–M | VERIFIED | `docs/TWO_MACHINE_STEAM_VALIDATION.md`; `perf-budgets.json:39-43` |
| NET-07 | **Watchers arriving during the countdown or round-over beat never see the match** (`gamePhase==='playing'` check). | Med | S | VERIFIED (harness) | `ffa-p2p-game-state.js:637`; `OnlineMultiplayerMode.js:549-555` |
| NET-08 | **The migration SYNC carries a ~100 KB JSON snapshot that receivers drop.** It measures 26/52/78/103 KB at 2/4/6/8 players, and main drops packets over 64 KB. The mock transport has no cap. | Med | S | VERIFIED (measured) | `host-migration.js:288,311`; `steam-integration.js:46,1124-1127` |
| NET-09 | **Any watcher can make the host recapture the world 4×/s:** 10 s of spam gave 40 captures and 943 KB; at 8P a capture is 147 KB and ~4.5 ms of host main thread. | Med | S | VERIFIED (harness) | `resync-request-handler.js:48-99`; `ffa-p2p-game-state.js:633-634` |
| NET-10 | **Spectators take player seats in the Steam lobby** (member limit = `maxPlayers`), so a watched lobby reads Full. | Med | S–M | VERIFIED code | `steam-integration.js:1018-1025,1056`; `OnlineMultiplayerMode.js:357` |
| NET-11 | **The 90 ms interpolation buffer is now pure latency.** It renders the newer bracketing grid unchanged, and the piece lerp is discarded by whole-cell drawing, so opponent boards show data ~57–90 ms older than what's in memory. | Med (feel) | S | VERIFIED | `OnlineMultiplayerMode.js:118,1854-1864`; `snapshot-interpolation.js:368-372`; `opponent-watch-manager.js:2176-2184` |
| NET-12 | **Every session exit (host left, kicked, full, version mismatch) dumps players to the main menu,** even mid-results. | Med | S | VERIFIED | `online-session-exit.js:24-28`; `OnlineMultiplayerMode.js:876-899` |
| NET-13 | = CORE-04 (`wireV2`). Suggest a 30–60 min two-machine smoke on v2 this month, then graduate (no public builds means no compatibility cost) or re-date once with a dated ADR note. | Med-High (deadline) | S | VERIFIED | `flags.js:124-129` |
| NET-14 | **Transport cost at 8P:** one awaited IPC per packet (~650 round trips/s at 8P), serialization per peer, cosmetic backpressure blind to Steam's queue. Host upload ≈2.1–2.3 Mbit/s on v1, ≈0.8 on v2. | Med | M | VERIFIED code, estimates | `steam-networking.js:846-934,2040-2131`; `steam-integration.js:1119-1137` |
| NET-15 | **Hot potato is invisible online:** updates are broadcast with no handler, and the snapshot omits the state. | Med | S | VERIFIED | `ffa-attack-router.js:114,165` |
| NET-16 | **A superseded host plays on alone and "wins"** (counted as a Steam win). Liveness is recorded before validation. | Med | S | VERIFIED code | `host-migration.js:303`; `presence.js:171-180`; `steam-networking.js:961,974` |
| NET-17 | **Migration depends on cold survivor↔survivor P2P sessions** (star topology); the mock is a full mesh, so this is untested. | Med | M | PLAUSIBLE | `host-migration.js:247-266` |
| NET-18 | **Invites:** the queued invite never drains; an accepted toast can land mid-match; `+connect_lobby` and second-instance argv are ignored (cold-start invites dropped). | Med | S | VERIFIED | `steam-invite-manager.js:106-117`; `electron/main.js:736-741` |
| NET-19 | **Fairness by design pending:** independent sims on the peer and the host copy, digest = score/lines, host-only cancelling, `endMatch` called up to 3× on same-frame deaths. | High | L | VERIFIED | `peer-board-agreement.js:72-77`; `frag-tracker.js:128` |
| NET-20 | **No quick match, filters, ping, version or region.** `getLobbies()` takes no filters in steamworks.js 0.4, so filtering is client-side over Steam's default set (shared with every Spacewar app under AppID 480). `version` lobby data is written, never read. | Med | M | VERIFIED code | `steam-integration.js:1045-1066`; `steam-networking.js:318-323` |
| NET-21 | **Matches nobody played count as wins:** the opponent leaves in the countdown, or a split network gives each side a solo win. | Low-Med | S | VERIFIED (harness) | `frag-tracker.js:395-398`; `online-steam-stats.js:45-47` |
| NET-22 | **Attack plausibility checks only line totals:** peer-chosen `complexity` sets Blind duration (`3+complexity` s, ~27 s per attack). | Low-Med | S | VERIFIED | `attack-request.js:70-125`; `garbage.js:140-141` |
| NET-23 | **Ready and rematch are host-only in practice:** peer ready isn't rebroadcast; rematch voting has no caller. | Low-Med | S | VERIFIED | `ffa-p2p-game-state.js:1068-1085,1233-1241` |
| NET-24 | **`ffa-p2p-game-state.js` (4,310 lines):** constructor 337 lines, `_applySnapshotState` 292, countdown DOM inside core; `addPlayer` logs the palette 3× per join. → seams in R-24. | Med (struct) | L | VERIFIED | |
| NET-25 | **A player can also register as a watcher** via a peer-sent LOBBY_PLAYER_JOINED, leaving a ghost player on departure. | Low | S | VERIFIED (harness) | `ffa-p2p-game-state.js:680-685,988-1008` |
| NET-26 | **Wire messages with no handler** (NET_ERROR, potato) **or no sender** (SYNCPOINT, rematch vote/status). | Low | S | VERIFIED | `steam-networking.js:1929-1936` |
| NET-27 | **"Invite only" lobbies are FriendsOnly,** contrary to the UI copy. | Low | S | VERIFIED | `steam-integration.js:1021`; `match-config-modal.js:60` |

### 4.4 High scores, leaderboards, stats, achievements, Cloud, persistence (SCORE)

| ID | Finding | Sev | Eff | Conf | Evidence |
|---|---|---|---|---|---|
| SCORE-01 | **A new or wiped device's first Cloud sync erases the Cloud's high scores, stats, settings and keybinds,** then pushes those defaults back to the original device. Bootstrap stamps empty local documents "now" (`payload.updatedAt \|\| this.now()`), so local wins and is uploaded. Only unlocks and Odyssey are unioned. | **High (data loss)** | S–M | VERIFIED (executed + coordinator) | `steam-cloud-sync.js:376-379,832-835,952,977-988,235-270,520-563` |
| SCORE-02 | **Global leaderboards and friends are dead end to end.** steamworks.js 0.4.0 has no leaderboard or friends API. `getLeaderboardsApi()` returns null, so all 9 uploads in 4 modes return "Leaderboard not found" and the result is ignored. The menu permanently reads "Limited — Steam API missing". | High | M | VERIFIED (+ coordinator vs `client.d.ts`) | `steam-integration.js:520-537,809-822,943-967`; `SinglePlayerMode.js:1541`; `main-menu-player-card.js:558-568` |
| SCORE-03 | **ez-steam-api is not a safe fix, and its unused `start()` already has side effects.** It runs `RestartAppIfNecessary` + a second `SteamAPI_Init`, and main ignores "should exit". It is Find-only (no create), KeepBest-only, friends-only and pumps legacy `RunCallbacks` against steamworks.js's manual dispatch. It costs 82 MB of koffi. | High | S (remove) | VERIFIED (disassembly + coordinator) | `steam-integration.js:488-514,637-639`; `node_modules/ez-steam-api/ez-steam-api.js:28,120-126` |
| SCORE-04 | **Cloud stats merge double-counts on every cross-device download** (13 real games became 26 after 3 syncs); the inflated value is never corrected. | Med | S | VERIFIED (executed) | `steam-cloud-sync.js:600-604,779-799,453-454`; `high-scores.js:389-399` |
| SCORE-05 | **An IndexedDB failure at game over kills the results flow:** `await addScore` is uncaught in a fire-and-forget handler, so no results modal and `isProcessingGameOver` stays true. | Med | S | VERIFIED (mechanism) | `SinglePlayerMode.js:1403`; `InfinityMode.js:1839`; `high-scores.js:28-35,101` |
| SCORE-06 | **Single Player and Infinity share one unversioned local table.** The mode tag is dropped, so Infinity runs set SP ranks, "Best score" and "New record". No `rulesVersion`; `gameHistory` written and never read; no migration path. | Med | M | VERIFIED | `high-scores.js:37-63,103-116,184-217`; `InfinityMode.js:1843`; `main-menu.js:418-422` |
| SCORE-07 | **No score plausibility.** `checksum32` clamps half of all replays to 2147483647; the score isn't int32-clamped; Infinity survival time is wall-clock including pauses (pause overnight → top score). FFA peer stats are bounded (good). | Med | S | VERIFIED | `replay-proof.js:16-21`; `steam-integration.js:813`; `InfinityMode.js:1934-1937` |
| SCORE-08 | **Latent leaderboard bugs that surface once wired:** score details sent as `[object]`; "Around you" requests Global; off-by-one ranges; KeepBest on `FFAWinRate_v1` (100 % forever after one win); concurrent uploads; Odyssey results panel shows "Steam offline" on web. | Med | S | VERIFIED code | `steam-integration.js:812,822,838-840`; `steam-service.js:1688`; `online-steam-stats.js:67` |
| SCORE-09 | **Stats use the real API, fragilely:** `store()` after every set (3–8 per game over); none at quit; the cache updates even on failure; `total_tspins` and `total_perfect_clears` declared but never written; `playtime_minutes` +1 minimum per game; the offline queue drops after 7 days. | Med | S | VERIFIED | `steam-integration.js:757-792,1161-1176`; `steam-service.js:1032,1079-1086`; `steam-config.js:173-174` |
| SCORE-10 | **Achievements don't exist:** no IDs, no unlock calls, no IPC channel. The wrong `achievements` probe (the real API is `achievement.activate`) keeps capabilities "partial". | Med | M | VERIFIED | `steam-integration.js:548-553`; `steam-service.js:826,944-949` |
| SCORE-11 | **Cloud durability:** failed uploads are kept only in memory; no quit flush; unsynced local changes are invisible after a restart; the offline queue replays stale snapshots over newer Cloud docs. | Med | M | VERIFIED code | `steam-cloud-sync.js:107,192-199,275-294,342-382`; `steam-service.js:214-217,1723-1727` |
| SCORE-12 | **Progression not backed up:** practice-earned breath grants, the Hale log and streak, and demos aren't in `CLOUD_FILES`. | Med | S–M | VERIFIED | `steam-cloud-sync.js:8-16` |
| SCORE-13 | **Personal-best replays pruned after 200 games; roamed `demoId`s open the wrong replay on another device.** | Low-Med | S | VERIFIED | `DemoManager.js:11,85-106`; `high-scores.js:114-116` |
| SCORE-14 | **Persistence is scattered:** 38 modules touch storage; 12 durable localStorage keys + 2 IndexedDB DBs + 7 Steam keys + ~11 dev keys + 40 flag overrides; Odyssey progress has 2 writers and 5 parsers; inconsistent corrupt-file handling; no reset path; an `app://` migration would orphan all saves unless migrated. | Med (arch) | M | VERIFIED | `OdysseyStateManager.js:147,165-205`; `breathwork-practice-log.js:60-65`; `high-scores.js:423` |
| SCORE-15 | **Settings debounced but still unversioned and unvalidated;** Cloud apply isn't clamped; device-specific keys roam. | Low | S | VERIFIED | `settings.js:434-452`; `steam-cloud-sync.js:21-42,520-536` |
| SCORE-16 | **Cloud API hygiene:** dead quota/timestamp handlers; `isEnabledForAccount/App` never checked; the write buffer ignores view offset/length; the contract test fakes a nonexistent SDK call. | Low | S | VERIFIED | `steam-integration.js:134,925-940`; `steam-cloud-ipc-contract.test.js:59` |
| SCORE-17 | **Import path not robust:** two transactions with a wipe window; unvalidated entries; raw record fields go into `innerHTML`. | Low | S | VERIFIED | `high-scores.js:332-381,413-420`; `modals.js:688-701` |

**Steam API contract** (code vs installed libraries): real and used: `init`, `localplayer.*`, `callback.register`, `stats.getInt/setInt/store`, `cloud.readFile/writeFile/deleteFile/fileExists`, `overlay.activate*`, `matchmaking.*`, `networking.*`. **Called but nonexistent:** `leaderboards/userStats*`, `achievements`, `friends.*`, `cloud.getQuota/getFileTimestamp`, `remoteStorage*`. **Available but never called:** `restartAppIfNecessary`, `electronEnableSteamOverlay`, `showFloatingGamepadTextInput`, `isSteamRunningOnSteamDeck`, `apps.currentGameLanguage`, `achievement.activate`, `auth.getAuthTicketForWebApi`.

### 4.5 Menus, Hub, modals, settings, accessibility, localization (UI)

| ID | Finding | Sev | Eff | Conf | Evidence |
|---|---|---|---|---|---|
| UI-01 | **Render quality, AA or FPS-counter changes re-apply the display mode:** the window is resized and re-centred and fullscreen dropped, on every slider tick. Uses `displays[0]` (not necessarily primary); window bounds never persisted; F/R3/Hub fullscreen bypass `displayMode`. | High | S | VERIFIED (code + coordinator) | `settings.js:1686,1705,1780-1793`; `main.js:1620-1676,2170-2173`; `electron/main.js:153-162` |
| UI-02 | **VSync toggle is a no-op;** "Changes apply right away" is false for AA, quality, render scale, FPS above refresh and GPU-policy-capped values. | High | S | VERIFIED (+ coordinator) | `frame-rate-controller.js:10,202-205`; `electron/main.js:66,182-186`; `index.html:1372` |
| UI-03 | **No auto-pause on focus loss;** "Pause" and "Slow to 10 FPS" when hidden both only pause the theme; the packaged default `'continue'` never applies. | High | S | VERIFIED | `controls.js:840-846`; `main.js:1151-1153,1172-1182,1253,1276`; `settings.js:70` |
| UI-04 | = INPUT-01/02 (binding collision; `e.key`). | High | S | VERIFIED | |
| UI-05 | **"Gamepad support: Off" can be set with the pad, takes effect immediately and persists:** controller-only and Deck players are locked out. | High | S | VERIFIED | `main.js:2281-2283,3068-3075`; `gamepad-controller.js:135,606-611` |
| UI-06 | **Accessibility gaps:** in-game reduced motion has 7 consumers but no default and no UI; no photosensitivity notice or flash reduction; no colour-blind option (I #00ff00 next to Z #ff0000; that mapping is a legal mitigation guarded by PAL-1, so use glyphs or patterns). | High | S–M | VERIFIED | `shared-effects.js:563`; `constants.js:40-44` |
| UI-07 | = SCORE-06 (Records mixes SP and Infinity). | High | S–M | VERIFIED | |
| UI-08 | **Replay "Share" broken end to end:** a `file://…/app.asar` URL leaks the install path; nothing reads `?demo=`; base64 isn't URL-encoded; the spread can throw on long replays; no Export despite the UI telling players to import files. | Med-High | S | VERIFIED | `DemoManager.js:213-234`; `demo-browser.js:164` |
| UI-09 | **Developer surfaces ship to players:** a "URL parameters" Settings tab (250 kB chunk) that tells players `unlockAll=1` works in built games, and an "Open DevTools" row that works in packaged builds. | Med-High | S | VERIFIED | `index.html:1172,2031`; `general-parameters.js:76-89`; `settings.js:1816-1820`; `electron/main.js:252-306` |
| UI-10 | **Boot failure leaves an endless "Preparing your space":** `fail()` writes to ids that don't exist. | Med-High | S | VERIFIED | `index.html:2117-2118,180-227` |
| UI-11 | **Settings model:** no schema, version, validation or global reset; two drifting defaults tables; dead keys (motion blur, shadows, particle/texture quality, bloom, `controlScheme`, `pieceLockRippleColor`, `autoRecordDemos`); 33 hand-wired `update()` calls. | Med | M | VERIFIED | `settings.js:14-156,494-591`; `constants.js:223-372` |
| UI-12 | **Pause "Main menu" abandons a run or online match with no confirmation;** no Restart or Quit; Serenity's Esc quits instantly. | Med | S | VERIFIED | `settings.js:1308-1317`; `main.js:3197-3230`; `SerenityMode.js:552-555` |
| UI-13 | **The Serenity Hub is `aria-modal` but doesn't trap or return focus;** the background isn't inert. | Med | S | VERIFIED | `SerenityHub.js:363-366,946-997`; `sheet-input.js:153-156` |
| UI-14 | **The Steam invite toast can't be reached with a pad** and expires in 10 s. | Med | S | VERIFIED | `invite-toast.js:118-123` |
| UI-15 | **Audio mix:** no master or voice volume (voice uses SFX); theme-linked audio silently overrides the player's choice. | Med | S–M | VERIFIED | `breathwork-audio-manager.js:117-123`; `main.js:2758-2762,3060-3063,3122-3133` |
| UI-16 | **Hale narration only partly captioned;** the text already exists in `scripts/tts-script.json`. | Med | M | VERIFIED | `breathwork-session-manager.js:1194-1348,1421-1422` |
| UI-17 | **Legibility at 1280×800:** 8–9 px text in places, faint text ~4.4:1 used 117×, no UI scale or high-contrast mode. | Med | M | VERIFIED sizes | `keystone-menu.css:834-845`; `keystone-settings.css:400,673,812,962` |
| UI-18 | **No localization layer:** ~270 HTML text nodes, ~2,300 literals in `src/` and 1,098 voice lines; hand-rolled plurals; Latin-only fonts. | Med | L | VERIFIED (heuristic counts) | `settings.js:1102`; `modals.js:678,684` |
| UI-19 | **No Deck on-screen keyboard or Deck detection** (the APIs exist in steamworks.js). | Med | S–M | VERIFIED | `client.d.ts:220-238` |
| UI-20 | **No onboarding or how-to-play for SP, Infinity or Online; no version or credits screen.** | Med | M | VERIFIED | `online-session-exit.js:5` |
| UI-21 | **Custom cursor replaces the OS cursor by default** (`cursor:none !important`): a frame of latency, frozen during stalls, a 120 ms idle loop. | Med-Low | S | VERIFIED | `settings.js:35`; `custom-cursor.css:324-329`; `custom-cursor.js:719-743` |
| UI-22 | **A11y polish:** cosmic-select drops `aria-describedby`; binding capture not announced; sliders lack `aria-valuetext`; the game-over dialog has no description; nested button inside `role=button`. | Low-Med | S | VERIFIED | `cosmic-select.js:66-92`; `settings.js:333-336,871` |
| UI-23 | **Window-event orphans:** `gameEnded` and `game:levelChange/odysseyProgress/localPlayers` are listened but never dispatched (rich presence never shows progress); `musicPlaybackError` is dispatched with no listener. | Low-Med | S | VERIFIED | `rich-presence-manager.js:136-172`; `sound-manager.js:1023` |
| UI-24 | **innerHTML defence:** Cloud-imported scores are rendered raw; 68 template-literal innerHTML sinks and 9 private escapers; no lint rule. | Low-Med | S–M | VERIFIED | `modals.js:681-705`; `high-scores.js:332-380` |
| UI-25 | **Structure:** `settings.js` is 2,121 lines; five sheet implementations; 30 render-blocking stylesheets; `main.css` is 11,331 lines; the settings modal markup is 73.5 KB (4 identical gamepad subtabs). | Low | M–L | VERIFIED | `settings.js:1816-2038` |
| UI-26 | **Thin handling options:** no ghost opacity, preview count, grid or per-player handling; pad sliders step 1 % per 150 ms and save every step. | Low | M | VERIFIED | `controls.js:136-139` |

### 4.6 Transitions, mode lifecycle, pause/focus, audio (LIFE, AUDIO)

| ID | Finding | Sev | Eff | Conf | Evidence |
|---|---|---|---|---|---|
| LIFE-01 | **Single Player and Infinity start playing under the opaque loading cover, and inputs drive the hidden board.** `onStart` spawns and starts the loop before theme-ready (≤6 s), content (≤7.5 s), settle (~9 s), music sync and the 2 s minimum + 0.8 s fade. A warm entry gives ~2–3 unseen rows of gravity; a cold one up to ~14. A blind Space hard-drops. Esc under the cover opens a hidden Settings while the mode starts unpaused. | High | S–M | VERIFIED | `SinglePlayerMode.js:404-435`; `GameModeManager.js:288-298`; `main.js:2824,2849-2920,4379-4416`; `cinematic-loading-overlay.js:11,273-311` |
| LIFE-02 | **GameModeManager has no transition owner:** no queue or token; `deactivateCurrentMode` nulls `currentMode` after an await; double onDeactivate; `startCurrentMode` accepts a still-activating mode; six callers chain stop/deactivate/activate/start independently. Scripted: exit SP then accept a Steam invite → Online active but `getCurrentModeId()` null, so start throws; an invite during an Odyssey board build drops the invite's lobbyId. | High | M | VERIFIED (scripted) | `GameModeManager.js:210-221,253,365-367,390-393`; `main.js:2790,3200,4121,4268`; `steam-invite-manager.js:158-182` |
| LIFE-03 | **Modes exit by bypassing the manager.** Odyssey "Back to menu" → blank screen (it dispatches `returnToMenu`, which nothing turns into a menu). SP/Infinity game over calls `onStop()` directly, so `modeStopped` never fires (rich presence, invite queue, perf sampling and theme `resetSession` miss it). | High | S | VERIFIED | `OdysseyMode.js:2531-2533,3607-3609,3870-3873`; `main.js:3017-3019`; `SinglePlayerMode.js:1394`; `InfinityMode.js:1830` |
| LIFE-04 | **Default settings rebuild the theme mid-run with no cover.** `backgroundMode:'Level'` (the default) switches theme every few levels from a per-frame callback that re-queues while the switch is in flight. Random mode switches every minute even online; auto-change fires on track end. The outgoing theme is disposed first, then the new one compiles synchronously (ADR-0020 measured a 2.9 s freeze for one heavy shader). | High | M | VERIFIED (+ coordinator) | `settings.js:24`; `SinglePlayerMode.js:942-947`; `theme-manager.js:1001-1013,1474,2224-2231`; `sound-manager.js:104-106,1197,1293` |
| LIFE-05 | **Theme switches can't be preempted:** A→B→C fully builds B (and switches B's music) before C. | Med | M | VERIFIED | `theme-manager.js:1106-1114,2270` |
| LIFE-06 | = INPUT-10/UI-03 (no pause on blur/minimize/overlay/disconnect; "Pause when hidden" doesn't pause; the packaged default is dead code; steamworks.js 0.4 exposes no overlay callback). | High | S–M | VERIFIED | `main.js:1153,1203-1265`; `electron/main.js:672-676` |
| LIFE-07 | = ODY-06 (dead warp transition): an idle MSAA WebGL context for the session, roughly 75 MB at 1080p and ~300 MB at 1440p@1.5 (estimate), reallocated on resize. | Med | S | VERIFIED | `WarpTransitionRenderer.js:69-121,1225-1253` |
| LIFE-08 | **Entering a mode during the first-entry warm throws the warm away and rebuilds;** the deferred warm can also warm the menu theme over a live Odyssey board after 25 s. | Med | S–M | VERIFIED | `theme-manager.js:1971-1977,2046-2051`; `base-theme.js:150-161,195-203`; `main.js:846,2620,2690` |
| LIFE-09 | **Suspend without runtime reuse leaks heavy theme runtimes:** plain `stop()` in packaged-Windows safe mode, the low-end profile. | Med | S | VERIFIED (per-theme leak PLAUSIBLE) | `theme-manager.js:43-73,915-927,1824-1832` |
| LIFE-10 | **Render-loop restart isn't idempotent at the infrastructure level;** the 700 ms "no frame drawn" safety net rebuilds themes that skip frames on purpose. | Low | S | VERIFIED | `main.js:1288-1317`; `base-theme.js:1351-1389`; `theme-manager.js:2062-2101` |
| LIFE-11 | **Return-to-menu exists in five versions;** an intro `dismiss()`/`showBackgroundOnly()` race can return a menu with no background; every return builds a fresh WebGPU intro renderer. | Low | S | VERIFIED (race PLAUSIBLE) | `main.js:3200-3234,4268-4317`; `intro-animation.js:1283-1313,1435-1468` |
| LIFE-12 | **The game-over modal restarts on any fresh press,** so hard-drop spam skips the results. | Low | S | PLAUSIBLE | `controls.js:633-651`; `gamepad-controller.js:861-869` |
| LIFE-13 | = UI-06 (reduced-motion setting has ~19 readers and no writer). | Low | S | VERIFIED | |
| LIFE-14 | **Quit can't finish async teardown:** `pagehide` runs async cleanup and Electron quits with no handshake, so the demo autosave and Odyssey `endSession`/save are cut off. | Low | S | PLAUSIBLE | `main.js:5153-5157`; `electron/main.js:200-202,762-770` |
| AUDIO-01 | **An audio device change while music is paused leaves music silent** until the next track (up to ~8.7 min): the analyser is the only route to the speakers and is rebuilt only if music is playing. | Med | S | VERIFIED (fake-graph script) | `sound-manager.js:114-120,396-414,487-498,847-861`; `audio-analyzer.js:147-155` |
| AUDIO-02 | **One music gain, four owners** (track fades, Odyssey duck, voice duck, user volume), each cancelling the last: music returns to full under a voice line after a track change; a second request mid-fade snaps the old level back. | Med | M | VERIFIED | `sound-manager.js:1611-1628,1659-1753,1834`; `breathwork-audio-manager.js:83-115` |
| AUDIO-03 | **Track changes dip to near-silence for ~4.5–5 s** (single element: fade-out, seek, swap, fade-in); unmute restarts the song from 0. | Low | S–M | VERIFIED | `sound-manager.js:70-71,1046-1153,1907-1961` |
| AUDIO-04 | = ODY-14 (`blood-moon.mp3` plus 32 identical placeholder copies, ~255 MB redundant; no `asarUnpack`). | Med | S | VERIFIED (+ coordinator) | `theme-music-catalog.js:44-57` |
| AUDIO-05 | **SFX note delays use `setTimeout`** (jitter under load); no voice cap; the 55 ms move-sound cooldown is shared by all local players. | Low | S | VERIFIED | `sound-manager.js:359-368`; `sound-effects.js:1046-1129` |
| AUDIO-06 | **Volume UX:** linear amplitude (half the slider ≈ −6 dB); the Hub pad volume jumps from 0 to ~50 % on first press and isn't saved; breath voices bypass the limiter; no master bus or "mute when unfocused". | Low | S | VERIFIED | `sound-manager.js:1640-1650`; `SerenityHub.js:1085,1092` |
| AUDIO-07 | **Breath-voice "preload" probably warms nothing under `file://`.** | Low | S | PLAUSIBLE | `breathwork-audio-manager.js:176-234` |
| AUDIO-08 | **Dead procedural music generators;** `musicPlaybackError` has no listener, so an autoplay rejection is never retried. | Low | S | VERIFIED | `sound-manager.js:1018-1026,2073-2168` |

**Audio inventory:** 537 files, 528.8 MB (535 MP3, 2 OGG, 0 WAV).

| Group | Files | Size | Detail |
|---|---|---|---|
| Music | 68 MP3 | 510.7 MB | 396 min, 48 kHz at ~166–203 kb/s; 255.6 MB of it is duplicates |
| Breath voices | 467 MP3 | 18.1 MB | 24 kHz mono, 96 kb/s |
| SFX | — | — | fully procedural |

Exactly one AudioContext. Music streams (it is not decoded), which is correct: the largest track would be 191 MB as float PCM.

### 4.7 Rendering core and whole-app frame performance (REND), theme internals excluded

Prior items **fixed:** per-frame Set/string churn in the outlines; the inverted shared-effects cap guard; FPS computed as a mean of reciprocals; the SP delta clamp; the theme render cap (with caveats); and the FPS setting now limits Phaser.

**Live loops** (the gameplay and menu rows from the auditor's full table):

| Loop | Menu | SP gameplay | Paused | Capped |
|---|---|---|---|---|
| sim `gameLoop` (`game.js:1495-1533`) | – | ✔ | ✔ (skips work) | no |
| Phaser main TimeStep (`frame-rate-policy.js:12-47`) | ✔ | ✔ | ✔ (re-renders) | yes, uneven cadence |
| WebGL1 overlay (`background-scene.js:129-151`) | ✔ | ✔ | ✔ | double-gated |
| theme (`base-theme.js:1351-1374`) | suspended | ✔ | ✔ | yes (3 folders bypass) |
| **menu intro renderer** (`intro-animation.js:270-293`) | ✔ | – | – | **no** |
| **Odyssey map** (`OdysseyBoardController.js:3539-3559`) | map | – | – | **no** |
| local-MP loop (`local-multiplayer-loop.js:493-562`) | – | local MP | rAF continues | no; delta unclamped |
| cursor (`custom-cursor.js:721-746,959-979`) | ✔ | ✔ | ✔ | no; ~8 Hz idle forever |
| gamepad poll (`gamepad-controller.js:616-627`) | ✔ | ✔ | ✔ | no |

So SP gameplay always runs at least three uncoordinated per-vsync loops (sim, Phaser, theme) plus the cursor. The menu runs the uncapped intro, a Phaser step clearing two WebGL canvases, and the cursor.

| ID | Finding | Sev | Eff | Conf | Evidence |
|---|---|---|---|---|---|
| REND-01 | **No app frame driver.** Four incompatible presentation gates (theme pacer on `performance.now()`, Phaser deadline on loop time, a modulo re-gate on the overlay, and ungated surfaces) give uneven cadence and mismatched layer rates on high-refresh panels. Replayed: at 144 Hz with a 60 cap, Phaser presents 60/s in alternating 2/3-vsync gaps while the theme presents 72/s; the overlay gets 51/s with 5-vsync holes. | High | M | VERIFIED (replayed gate code) | `base-theme.js:1323-1327,1356-1361`; `frame-rate-policy.js:21-47`; `background-scene.js:141-150`; `theme-frame-pacer.js:51`; `main.js:961` |
| REND-02 | **The main-menu background renders uncapped every vsync** (full post stack; the 30-FPS battery option is ignored), and **is rebuilt with a new GPUDevice and fresh pipelines on every return to the menu.** Not paused under Settings or the Hub. | High | S | VERIFIED | `intro-animation.js:270-293,1286-1300,1422-1503`; `threejs-intro-renderer-webgpu.js:218-229,1373-1527` |
| REND-03 | **The board is drawn into a fixed 400×800 backing store and stretched nearest-neighbour to its CSS size** (up to 640×1280): `scale.mode: NONE`; `resolution: devicePixelRatio` has no reader in Phaser 4.2.1 (coordinator-verified); `phaserGame.resize` doesn't exist; `image-rendering: pixelated`. That is ≈1.14× at 1080p, 1.59× at 1440p, 2.4× at 1440p@1.5 DPR and 0.71× in a 1280×720 window, so non-integer nearest-neighbour shimmer and dropped rows on the game's primary surface. | High | M | VERIFIED (mechanism) / PLAUSIBLE (visual) | `main.js:1423-1464`; `SinglePlayerMode.js:1580-1587`; `keystone-solo.css:35-38`; `main.css:3901-3910` |
| REND-04 | **Global dynamic resolution:** persists `renderScale`, a lowered `effectQuality` and `targetFrameRate` (it compounds with GPU-health tiering, ratcheting quality down session by session); runs only while the FPS overlay is on; samples 60 intervals (1 s at 60 Hz, 0.25 s at 240 Hz); never reaches the live theme (no `SETTINGS_CHANGED`); fights a second, one-way downscaler in `base-theme.js`. | High | S–M | VERIFIED | `main.js:1041-1047,1070,1113-1123`; `desktop-performance-policy.js:196-210`; `performance-monitor.js:10,421-425`; `base-theme.js:27-30,58-66` |
| REND-05 | **The empty WebGL1 overlay is cleared, MSAA-resolved and composited every capped frame,** full-screen at z-index 10, for content only one theme (wolfhour) ever adds. | High (iGPU) | S | VERIFIED | `renderer.js:678-691,865-881,1053-1131,1187-1272`; `main.css:308-317` |
| REND-06 | **GPU contexts are never released on teardown** (Phaser's `destroy()` doesn't call `WEBGL_lose_context`; three renderers aren't `forceContextLoss()`ed). Local MP creates 2–4 fresh contexts per entry; cosmic exploration 2 per session; warp and legacy intro more. Board canvases aren't monitored for loss. Chromium's ~16-context cap force-loses the oldest: the overlay or the main board. | High | S | VERIFIED (mechanism) / PLAUSIBLE (eviction) | `local-board-hosts.js:79-120`; `CosmicExplorationEffect.js:127,154,438-489`; `renderer.js:732` |
| REND-07 | **Phaser renders and presents every capped frame even when nothing changed:** the menu (BackgroundScene only), a paused game, local MP's paused main scene, a static stack. Graphics are re-tessellated each render; Phaser input managers run on every board unused. Only the Odyssey opponent board sleeps its loop. | Med | M | VERIFIED | `phaser/src/core/Game.js:454-498`; `GraphicsWebGLRenderer.js:50-140`; `odyssey-opponent-board.js:139-146` |
| REND-08 | **The Odyssey map loop ignores Target Frame Rate;** resume keys off "parked". | Med | S | VERIFIED | `OdysseyBoardController.js:3539-3559` |
| REND-09 | **A minimised packaged window keeps rendering everything except the theme** (Phaser loops, menu intro, Odyssey map, sim, cursor): `backgroundThrottling:false` keeps `document.hidden` false. | Med | S | VERIFIED (code path) | `electron/main.js:571,672-679`; `main.js:1152,1270-1284` |
| REND-10 | **Presentation tied to frame count:** overlay particles (`lifetimes[i]--`); the Infinity camera eases 0.08 per call (4× faster at 240 Hz); cosmic exploration decays per frame; the local-MP HUD updates on `frameCount % 10`. | Med | S | VERIFIED | `renderer.js:382-614`; `base-board-scene.js:753`; `InfinityMode.js:101-104,2183-2233`; `CosmicExplorationEffect.js:346-347` |
| REND-11 | = INPUT-11 (local MP's default loop has no delta clamp; DAS bursts after a stall). | Med | S | VERIFIED | `local-multiplayer-loop.js:506-526` |
| REND-12 | **Every combo wave and banner creates fresh Phaser Text objects** (a canvas, a raster, a GL upload each), exactly where the cascade frame-time tail was found. | Med | S | VERIFIED (mechanism) | `shared-effects.js:1423-1470,1643-1664` |
| REND-13 | **Quality doesn't reach several surfaces:** the online main board never gets `setEffectQuality`; cosmic exploration reads `get('graphicsQuality')`, but `get()` ignores its argument, so it falls back to High (10k stars, bloom, two contexts even on Low); `quality.js` lists a `renderScale` nothing reads. | Med | S | VERIFIED | `main.js:1586-1614`; `InfinityMode.js:542`; `settings.js:374-376`; `quality.js:7,153-163` |
| REND-14 | **Throttled audio analysis integrates a one-frame delta:** envelopes run at ½ speed at 60 Hz and ⅕ at 144 Hz (Odyssey audio reactor, menu). | Med-Low | S | VERIFIED | `sound-manager.js:537-567`; `audio-analyzer.js:189-283` |
| REND-15 | **The perf monitor has gaps as an instrument:** it counts its own rAF, not presented frames (a 60-capped 144 Hz board reads "144 FPS"); refresh-dependent window; double-written timings; a 30k-entry `shift()` log; a duplicate unused monitor class. | Med | S | VERIFIED | `performance-monitor.js:415-487,888-915`; `performance-utils.js:414-460` |
| REND-16 | **Idle loops never park:** cursor (~8 Hz forever plus a `querySelector` every 180 ms), sim loop while paused. | Low | S | VERIFIED | `custom-cursor.js:721-746,959-979`; `game.js:1526` |
| REND-17 | **Hot-path allocation, DOM and paint leftovers:** per-frame closures and options; style objects and colour strings per call; string-keyed flood fill; per-player-per-frame `setAttribute` feeding CSS `attr()`; a forced reflow in the stats pulse; an animated `box-shadow` danger glow. | Low | S | VERIFIED | `game.js:1515-1533`; `tetromino-style-manager.js:91-101`; `LocalMultiplayerMode.js:752`; `draw.js:838`; `keystone-solo.css:252-259` |
| REND-18 | **VSync never read;** "Unlimited" uses 1 ms timeouts clamped to ≥4 ms; interpolation alpha ignored; refresh rate detected once at boot and never on a monitor change. | Low | S | VERIFIED | `frame-rate-controller.js:43,119-172,178-181,202-205,377-388` |
| REND-19 | **Restart-on-visible can stack theme loops;** safety rests on each theme's own guard. | Low | S | PLAUSIBLE | `main.js:1206-1243,1299-1310`; `base-theme.js:1136-1142` |
| REND-20 | **Dead render-path code:** overlay Texture/BufferManagers, `DOMBatcher`/`StyleBatcher`/`memoize`, `cache.js`, `ensureMultiplayerBoardScenes`, `_resizePhaserGame`, `boardHost`. | Low | S | VERIFIED | `renderer.js:771-782`; `performance-utils.js:150-409`; `main.js:117,1905` |

### 4.8 Boot time and build configuration (BOOT)

Real-hardware context comes from the project's committed Electron 38 captures (`reports/boot-aurora/flow-electron-cold.json`, `reports/boot-smoothness/*.json`). They were made on the dev machine: Windows, D3D12, an RTX GPU via `force_high_performance_gpu`, dev server, cold profile.

| Run | `bootstrap()` starts | MENU_READY | Title interactive / handoff |
|---|---|---|---|
| Default theme | 1.09 s | 1.92 s | **9.95 s** |
| neon-district selected | — | — | handoff begins at **33.1 s** |

The cloud-container runs in Part 2 had no GPU, so their timings are not comparable. They only show that the same pipeline has no fallback when hardware acceleration is missing.

**Default cold boot, critical path:**

| Time | Step |
|---|---|
| 0–1.09 s | HTML → 30 blocking CSS → loader → `manifest.json` → entry → main |
| 1.09–1.92 s | app init: Phaser import and `new Phaser.Game`, a WebGL1 background renderer, settings UI, a 302 ms audio-analyser task |
| to 3.33 s | theme warm |
| 3.33–5.10 s | **idle until the 4 s floor** |
| from 5.10 s | intro (first frame: a 540 ms long task) → warp ("theme idle" ≥500 ms) → 3.2 s handoff |
| 9.95 s | title interactive → player press → menu |
| mode entry | the overlay holds at least 2.0 s plus a 0.8 s fade, while the game loop has already started underneath |

| ID | Finding | Sev | Eff | Conf | Evidence |
|---|---|---|---|---|---|
| BOOT-01 | **A failure before `bootstrap()` leaves the animated ident forever:** `fail()` writes to missing ids; the 45 s shell timer stops once `failed` is set; a failed manifest fetch silently falls back to the dev path `./src/entry-desktop.js` (404 in production); no Electron load/crash handlers; the release IPC stub drops the error mark. | High | S | VERIFIED | `index.html:2117-2118,2200-2209,2237,2261-2268,2332` |
| BOOT-02 | **The other failure paths end in a cryptic box, and safe mode is unreachable:** the watchdog's degraded path throws on `app.gamepadController`; `innerHTML` error "check the browser console" in a build with no console; `safeMode` and `windowsProfile` are never set by `electron/main.js`, so every safe or baseline profile branch is dead. | High | S | VERIFIED | `main.js:326-357,5005,5102,5192,5615-5631`; `electron/main.js:71-79` |
| BOOT-03 | **The opening waits for the selected theme's entire shader prewarm:** budgets 6.5 + 2 + 15 s plus up to 45 s of "theme idle", with up to 3 warp prewarms (12/15.5/19 s). Measured: neon-district cold handoff at 33.1 s vs ~6.6 s for Forest. A "Random" background re-rolls the theme each launch. | High | M | VERIFIED (measured) | `main.js:2546-2549,2609-2626,5029`; `boot-warp-startup.js:30,386`; `boot-warp-orchestrator.js:101-108` |
| BOOT-04 | **Forced waits run one after another:** 1.77 s idle on the 4 s floor after the warm finished; a 515 ms "stable" wait after 2.7 s of idle; the floor clock starts at bootstrap, not first paint. About 2–2.5 s recoverable. | Med-High | S | VERIFIED (2 captures) | `main.js:499,5034,5051`; `boot-warp-startup.js:498-545` |
| BOOT-05 | **No quick start for returning players:** no "skip opening" setting; skip-on-input arms only after app init and is never advertised. ~8 s per launch for those who opt in. | Med | S | VERIFIED | `main.js:4990-5004,5022` |
| BOOT-06 | **Phaser (1.6 MB), two WebGL contexts and the settings UI are built before MENU_READY;** a Phaser long task and a 222 ms frame gap sit inside app init. | Med | M | VERIFIED code | `main.js:647,651,3001,3055`; `renderer.js:752+` |
| BOOT-07 | **The main chunk grew 34 % since August (0.8 → 1,074 KiB); ~44 % is code the menu doesn't need:** gameplay core 245 KB, Phaser scenes 279 KB, board render 124 KB, Odyssey data 233 KB (pulled in by `theme-collection.js` → `levels.js` just for reward mapping), Steam 107 KB, breathwork 106 KB; ~410 lines of test globals. | Med | M–L | VERIFIED | `theme-collection.js:2,37`; `main.js:140,737,5199-5613` |
| BOOT-08 | **1 MB of render-blocking, unminified, unhashed CSS; the ident needs ~10 KB.** ~0.5 MB is mode-only; esbuild minification alone saves 31 %; Electron paints black until all 30 load. | Med | S–M | VERIFIED (+ coordinator) | `index.html:86-117`; `main.css:20-300`; `electron/main.js:564` |
| BOOT-09 | **The loader adds a serial round trip and a failure mode** (`manifest.json` `no-store`) and preloads nothing needed next (`modulePreload:false`). | Med | S | VERIFIED (+ coordinator) | `index.html:2257-2333`; `vite.config.js:133` |
| BOOT-10 | **The boot-closure guard skips release builds and PRs** (`build-win.mjs` and `build:linux` run bare `vite build`). The 2 MB ceiling is 2× today's size. The denylist misses SerenityHub, UrlParametersView and OdysseyLayoutEditor. Dynamic loads before the title are unmeasured. Paths with spaces break it. | Med | S | VERIFIED | `build-win.mjs:124`; `package.json:37`; `check-boot-closure.mjs:12,36,43` |
| BOOT-11 | **Dead or no-op build settings:** `build.esbuild` is ignored (1,144 `console.log` ship, 484 in main); the replace plugin targets `typeof CANVAS/WEBGL_RENDERER` (0 occurrences in Phaser 4.2.1) while `PLUGIN_CAMERA3D`/`PLUGIN_FBINSTANT` stay unreplaced, so Phaser registers its 3D-camera and Facebook plugins; no hidden sourcemaps for crash symbolication. | Med-Low | S | VERIFIED (+ coordinator) | `vite.config.js:88-94,253-256` |
| BOOT-12 | **Startup KPIs don't measure what the player waits for:** the clock excludes the 1.09 s before bootstrap; `timeToMenuReadyMs` ends before every forced wait; "title interactive" is trace-only; `timeToMenuVisibleMs` includes the human press; the trace is memory-only; `perf-budgets.json` boot baseline is `null`. | Med | S | VERIFIED (RTX capture: MENU_READY 1.92 s vs title 9.95 s) | `main.js:4912`; `startup-debug.js:105-139`; `perf-budgets.json:6-9` |
| BOOT-13 | **First gameplay frame: the game starts under the opaque loading overlay;** warm entries still wait 2.0 s min + 0.8 s fade. | Med | S | VERIFIED code | `main.js:2849-2881`; `SinglePlayerMode.js:435`; `cinematic-loading-overlay.js:11,273-307` |
| BOOT-14 | **Web build:** no service worker; unhashed CSS alongside a no-store manifest; deploys delete old hashed chunks while `vite:preloadError` only logs; first visit ≈1.3 MB gz JS + 0.2 MB CSS + 2.8 MB theme assets + 2.25 MB music preload; deferred services start during the ident; `dist` 697 MB vs Pages' 1 GB limit; Steam and mock-lobby code ships to web. | Med-Low | M | VERIFIED | `release-observability.js:26-37`; `sound-manager.js:900-929`; `main.js:2066` |
| BOOT-15 | **No graphics-capability check before the cinematic boot:** no WebGL means a half-built renderer, a WEBGL-only Phaser and silently guarded boards; GPU health is queried only at menu idle. | Low-Med | S | PLAUSIBLE (consistent with the GPU-less container run) | `renderer.js:693`; `main.js:908,1434` |
| BOOT-16 | **The Serenity Hub statically imports `tornado/params.ts`,** pulling `theme-tornado` (72 KB) and three in at menu idle. | Low | S | VERIFIED (+ coordinator: tornado chunk seen in boot waterfall) | `ThemesTab.js:17`; `vite.config.js:161,218-226` |
| BOOT-17 | **Debug globals and `?localMp=` test flows ship in release.** | Low | S | VERIFIED | `main.js:4990,5199-5613` |
| BOOT-18 | **The deferred audio analyser lands inside app init** (a 302 ms frame). | Low | S | PLAUSIBLE | `sound-manager.js:420-444` |
| BOOT-19 | **`/vendor/webgpu-inspector.js` is an absolute path:** it never loads under `file://`. | Low | S | VERIFIED | `index.html:78` |
| BOOT-20 | **The first interaction starts every deferred service** (Hub, player card, theme warm/prewarm, cloud sync) on top of the first mode entry. | Low | S | VERIFIED code | `main.js:808-863,5151` |
| BOOT-21 | **Steam services start only after the opening:** a launch invite waits ~10 s plus a press. | Low | S | VERIFIED | `main.js:5105-5108` |
| BOOT-22 | **Four ineffective dynamic imports** (`constants.js`, `performance-monitor.js`, `base-theme.js`, `LevelRegistry.js` are also imported statically, so "lazy" loading does nothing). | Low | S | VERIFIED (coordinator build log) | Vite build warnings |

### 4.9 Electron shell, security, packaging, main-process Steam (ELEC)

| ID | Finding | Sev | Eff | Conf | Evidence |
|---|---|---|---|---|---|
| ELEC-01 | **Release builds run as Spacewar (480) and never ensure launch through Steam.** Resolver order: `STEAM_APP_ID` (Steam sets `SteamAppId`), then the txt that afterPack deletes in release, then 480. `init(480)` then overwrites the env Steam passed. No `restartAppIfNecessary`; NSIS shortcuts launch outside Steam; renderer constants are 480 with `debugMode` true in release. | **Critical** | S (+ AppID) | VERIFIED | `steam-integration.js:45,87-100,407`; `afterPack.cjs:24-34`; `steam-config.js:9`; `config.js:24` |
| ELEC-02 | **The CSP may not apply in packaged builds:** header-only via `webRequest` while the app loads `file://`; no `<meta>` CSP; Google Fonts origins still allowed; no permission request/check handlers (Electron grants all by default); the renderer depends on `file://` fetch privileges. Move to `app://` **before launch**, since storage is origin-keyed. | High | S (meta) / M (`app://`) | facts VERIFIED, enforcement PLAUSIBLE | `main.js:532-551,655-659`; `content-security-policy.js:3,53-57` |
| ELEC-03 | **Electron 38 has been EOL since 2026-03-10:** 24 published advisories (8 high), none fixed on 38.x, incl. a context-isolation bypass and file-protocol cross-origin reads. Supported lines are 42/43/44 (44.7.0 = Chromium 152). The hard audit gate is blind to it (devDependency); Dependabot groups it with Vite/Vitest/TS majors so it never merges. | High | M | VERIFIED | `package.json`; `pages.yml:71-73`; `dependabot.yml:10-12` |
| ELEC-04 | **Friend joins and lobby privacy broken:** `+connect_lobby` from rich presence is never parsed (cold start or second instance); "Invite only" maps to FriendsOnly; P2P is accepted from and sent to anyone. | High | S | VERIFIED | `OnlineMultiplayerMode.js:2758`; `main.js:736-741`; `steam-integration.js:319-331,1021,1104-1117` |
| ELEC-05 | **The Steam overlay is never enabled:** only half of steamworks.js's `electronEnableSteamOverlay()` recipe is copied (the invalidator, without the `in-process-gpu`/`disable-direct-composition` switches), installed after load and before `init()`. In 0.4.0 the overlay is the only invite path; Shift+Tab is likely dead. Needs an A/B (in-process GPU trade-off) and an ADR. | High | M | VERIFIED (switches absent), PLAUSIBLE (overlay invisible) | `steam-integration.js:225-265`; `main.js:403,757-759` |
| ELEC-06 | **ez-steam-api can never load next to steamworks.js on Windows:** its DLL statically imports `SteamAPI_Init`, which steamworks.js's `steam_api64.dll` doesn't export. The failure only goes to `console.warn`. steamworks.js 0.4.0 (2024-08-06) is its last release and has no leaderboards. → decide the binding (fork steamworks-rs/steamworks.js or a maintained FFI binding) by ADR. | High | M–L | VERIFIED (PE tables) | `steam-integration.js:488-514`; PE import/export tables |
| ELEC-07 | **~195 MB of unused node_modules packed into the app,** plus 511 MB of music inside app.asar with no `asarUnpack`. Budgets are 262 MB for the asar and 450 MB for the installer. ADR-0001's "does not change the artifact" premise is false. | High | S / M | VERIFIED (+ coordinator: 193.2 MiB measured) | `package.json:61-65`; `perf-budgets.json:98-107`; ADR-0001 |
| ELEC-08 | **No Electron fuses:** `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect` work in the shipped exe, and a swapped asar is accepted. | Med | S | VERIFIED | no `electronFuses` in `package.json` |
| ELEC-09 | **No crash or hang handling:** no `render-process-gone`/`child-process-gone`/`unresponsive`/`did-fail-load`/`crashReporter`/`uncaughtException`; `whenReady` has no catch; main logs only with an env var; native FFI crashes leave no trace. | Med | S–M | VERIFIED | `main.js:378,743` |
| ELEC-10 | **The IPC boundary is unvalidated:** generic `invoke` over ~60 channels and generic `on`; 17 unused `window.steamworks` wrappers; no `senderFrame` checks; no validation of cloud filenames, lobby keys, stat names or P2P targets; asymmetric packet limits; "Open DevTools" in release Settings. | Med | M | VERIFIED | `preload.cjs:64-88,102,119`; `steam-integration.js:749-806,862-940,1077-1080`; `settings.js:1816-1896` |
| ELEC-11 | **`electron/` is outside lint and typecheck:** 465 ESLint errors when linted. Typing `steamworksClient` with the library's own type yields 26 errors, 22 of them the nonexistent APIs, so one annotation would have caught the leaderboard and friends bugs. | Med | S | VERIFIED (scratch run) | `package.json:19,25`; `tsconfig.json` |
| ELEC-12 | **What players get is never built or launched before release:** build-win runs bare `vite build`; release mode depends on remembering `SERENITY_RELEASE=1`; SBOM tool fetched unpinned; validation harnesses use `sandbox:false` + `preload.mjs`, not the shipped config; `publish` unset, so `app-update.yml` is generated; unsigned; empty `author`; no depot `.vdf`. | Med | S–M | VERIFIED (+ coordinator) | `build-win.mjs:124,143-146`; `windows-electron-parity-validation.mjs:36-38,316-321` |
| ELEC-13 | **Window/display settings don't do what they say:** Borderless keeps the frame and is placed at (0,0) of the primary work area; VSync is stored only; startup applies the display mode via `displays[0]`; no window-state persistence or Alt+Enter; no `powerSaveBlocker` during play; no `setAppUserModelId`. | Med | S–M | VERIFIED code | `main.js:143-151,182-186`; `src/main.js:1642-1654` |
| ELEC-14 | **The Linux build can't reach Steam** (extraResources strips the linux64 natives; confirmed at runtime by the coordinator's smoke run). Steam Deck is untested; no floating keyboard. | Low-Med | S | VERIFIED (+ runtime) | `package.json:74-95` |
| ELEC-15 | = NET-14 (one IPC round trip per received packet). | Low-Med | S | VERIFIED | `steam-networking.js:917-934`; `steam-integration.js:1119-1137` |
| ELEC-16 | **GPU health can't see software rendering:** the reported renderer string is discarded by a stub; the remediation copy points at a removed launcher. | Low | S | VERIFIED | `main.js:334`; `gpu-health.js:89`; `renderer.js:748` |
| ELEC-17 | **A second instance still reaches `createWindow`** (no `else` after the lock); quit has no renderer flush handshake (cloud sync is debounced 1.5 s); no close confirmation mid-online-match. | Low | S | VERIFIED code | `main.js:57-60,201-203` |
| ELEC-18 | **Dev-only files ship:** `main-minimal.js`, `preload-minimal.cjs`, `preload.mjs`, `electron/steam_appid.txt` (480), test-only `debug-tools` exports, a nonexistent `enable-webgl` switch, an unapplied `SERENITY_ANGLE_BACKEND`, the unloadable inspector; obsolete `rebuild-greenworks.sh` runs `npm install --save-dev`. | Low | S | VERIFIED | `main.js:15,52,228` |

### 4.10 Code structure, tooling, tests, dependencies, repository and docs (REPO)

**Key measurements:**

| Area | Measurement |
|---|---|
| Repository | 6,239 tracked files (784 `.md`/`.txt`), **1,522 MB tracked**, no LFS |
| `public/` | 727.5 MB (music 510.7, playground-refs 139.6) |
| `docs/` | 375.4 MB / 1,393 files (benchmarks 181.8 MB, including 3 × 40 MB evidence zip parts) |
| `reports/` | 197.5 MB / 1,021 files (60 JS, 34 logs, 3 cpuprofiles, 2 .blend) |
| `src/` | 117 MB (themes 101 MB) |
| Globals | 155 `window.X =` sites (107 names) across 38 non-theme files; `window.settings` read 145× |
| Console calls | 1,037 `console.log` in non-theme src |
| Tests | 910 files / 383K lines (theme tests 67 % of lines); 168 read source text, 64 regex-assert on it; 0 coverage tooling; 15 wall-clock assertions |
| Docs | 41 unreachable from the index; 27 Superseded docs in the `docs/` root; 182 broken links out of 1,761 |

| ID | Finding | Sev | Eff | Conf | Evidence |
|---|---|---|---|---|---|
| REPO-01 | = CORE-04 (`wireV2` expiry; confirmed with a Date shim: 1 failed at 2026-11-01). Also: assert every registry flag has a call site (would have caught `rngV2`). | High | S | VERIFIED (executed) | `flags.js:128`; `flag-registry.test.js:7,39` |
| REPO-02 | **≈330 MB (47 %) of the shipped payload is duplicate or dead:** 32 placeholder copies; `public/assets/themes` (26.5 MB, 59 files identical to the in-theme icons) referenced by no code path; 4 songs referenced nowhere (28.3 MB); ~8 MB of unused textures. | High | S | VERIFIED | `theme-music-catalog.js:46-53` |
| REPO-03 | = ELEC-07 (node_modules in the asar; ADR-0001's premise is false). Also: nothing reads the `installerBytes`/`appAsarBytes` budgets. | High | S–M | VERIFIED | `perf-budgets.json` |
| REPO-04 | **Nothing is built, packaged or run on Windows before merge** (all jobs Ubuntu; build is push-only). The legal palette gate (`check:palette`, PAL-1) is in no workflow. | High | M | VERIFIED | `pages.yml:77` |
| REPO-05 | **Runtime and toolchain past support, with Dependabot shaped so they can't move:** Electron 38 (EOL); Vite 5.4 (no 5.x release since 2025-10-20; latest 8.3.4); ESLint 8 (EOL 2024-10-05); Vitest 3 (moderate advisory; latest 5.0.4); TS 5.9 (7.0.2 out); `engines >=20` allows EOL Node 20 while CI runs 24; 9 deprecated lockfile packages. | High | M–L | VERIFIED (registry) | `package.json:163`; `dependabot.yml:10-23` |
| REPO-06 | **Lint stack and scope:** airbnb-base pins ESLint ≤8; only `src/**/*.js` is linted (`electron/` would have 465 errors; `scripts/` 54K lines, `tests/` 383K lines, the `.ts` file and 292 lines of inline `index.html` JS are never linted); the ratchet is one total; `.prettierrc` contradicts airbnb, so `npm run format` would break `lint:ci`. | Med-High | M | VERIFIED | `lint-ratchet.json`; `.prettierrc` |
| REPO-07 | **Architecture ratchets have blind spots:** the fitness pathspec `'src/**/*.js'` matches neither `src/main.js` nor `src/entry-desktop.js` (coordinator-verified: 0 vs 2 with `:(glob)`), so six metrics never see the biggest god file. 16 non-data files >2,000 lines have no ceiling. The nondeterminism regex counts calls only. A file-level depcruise exemption hides 73 forbidden edges. | Med-High | S | VERIFIED (+ coordinator) | `architecture-fitness-check.mjs:25,74`; `.dependency-cruiser.cjs:14-19,32` |
| REPO-08 | **Repository weight grows fast, with binaries and evidence in git:** 1.52 GB tracked; an evidence zip split into 40 MB parts to dodge GitHub's file limit; `reports/` holds a forked 2,483-line script, logs, cpuprofiles and .blend files; 57 tracked files inside gitignored directories; a 1.13 GiB pack even shallow. | Med-High | M | VERIFIED | `docs/benchmarks/2026-10-07-latency/README.md:157-158` |
| REPO-09 | **The riskiest code is only regex-tested, and coverage is unmeasured:** `src/main.js` has 0 importing tests and 11 text-reading ones; the Electron main/IPC/preload have only text reads; no coverage provider; Node-only environment; 15 wall-clock assertions will flake on slow runners; bare `vitest.config.js`. | Med | M | VERIFIED | `main-legacy-loop-retirement.test.js`; `ffa-attack-request.test.js:176` |
| REPO-10 | **Dead and duplicated implementations:** `pieces.js` duplicates (biased bag, stub kicks) with tests of the dead copies; `board.js` flood fill; main.js `multiplayerState` fallbacks and 12 copy-pasted P2–P4 input functions; dead warp; `preload.mjs`; 10 private `escapeHtml` copies; 85 unused exports and 363 test-only exports. | Med | S | VERIFIED | `pieces.js:34-116`; `board.js:319`; `main.js:3555-3725` |
| REPO-11 | **`window` is the service locator** (155 assignment sites); 47 theme files poll `window.serenityBlocks?.gameModeManager`; `types.d.ts` types 10 of 107 globals; test hooks ship ("can be removed in production"). | Med | M | VERIFIED | `main.js:5199` |
| REPO-12 | **Layering holes:** 13 playground files (6,710 lines) ship as theme code; an Odyssey chapter imports Summer theme internals; ThemesTab imports `tornado/params.ts`; `core/constants.js` imports a theme registry that now contains DOM code. | Med | S | VERIFIED | `vite.config.js:204-213`; `.dependency-cruiser.cjs:36` |
| REPO-13 | = UI-09 (the URL-parameter reference ships: 7,579 source lines, a 250 KB chunk). | Med-Low | S | VERIFIED | |
| REPO-14 | **Flag levers never graduate:** 40 flags, 36 refactor flags with only 1 dated; 9 graduate "after a stable release" that never happened; 17 local readers bypass `readFlag`. | Med | S | VERIFIED | `flags.js` |
| REPO-15 | **Docs drift outpaces the index:** the README (shipped in `dist`/Pages) says Phaser rc.5 and has 6 of 7 links dead; HOW_TO_RUN suggests helpers that don't exist; 41 unreachable docs; 182 broken links. | Med | S | VERIFIED | `README.md:30,48-54` |
| REPO-16 | **Agent tooling breaks outside the Windows dev box:** `.mcp.json` launches chrome-devtools via `cmd /c` (it failed in this Linux cloud session, while CLAUDE.md requires it for the visual definition of done); CLAUDE.md and AGENTS.md are hand-synced near-duplicates without commands; `.claude/settings.json` pre-approves `npm install:*` (lockfile drift) rather than `npm ci`; no SessionStart hook, so cloud sessions start without `node_modules`. | Med | S | VERIFIED (+ coordinator) | `.mcp.json`; `.claude/settings.json` |
| REPO-17 | **The TypeScript island is thin:** 31 % of core and events lines are checked, `strict:false`; 4 ratcheted files aren't in the program; Node types leak into renderer code; `EventPayloadMap` unused. | Med-Low | S | VERIFIED | `tsconfig.json`; `types.d.ts:347` |
| REPO-18 | **Inaccurate dependency declarations:** `node-fetch` unused; `playwright` (11 scripts), `postcss` and `eventemitter3` used but undeclared; `koffi` only via `overrides`; `phaser` caret while tests pin Phaser internals. | Med-Low | S | VERIFIED | `package.json:140,157` |
| REPO-19 | = BOOT-11 (console stripping is a no-op; `netDiag` logs once per second during online matches). | Med-Low | S | VERIFIED | `ffa-p2p-game-state.js:434` |
| REPO-20 | **Workflow hygiene:** `pages:write`/`id-token:write` on every job including PR tests; `cancel-in-progress` on `main` can cancel a deploy; no timeouts; one serial job; full audit soft-fail; GPU lane never green. | Med-Low | S | VERIFIED | `pages.yml:9-12` |
| REPO-21 | **292 lines of inline boot JS in `index.html` sit outside every gate** (the `fail()` ids bug lives here). | Low-Med | S | VERIFIED | `index.html:8-70,2103-2335` |
| REPO-22 | **Event names unregistered:** 5 dead `EVENTS` keys; ~30 free-form window events, 6 with no listener; `setKnownEvents` never called in DEV. | Low-Med | S | VERIFIED | `event-bus.js:100` |
| REPO-23 | **Root clutter and script sprawl:** obsolete `serve.sh`, `rebuild-greenworks.sh` (runs `npm install --save-dev`), `start-dev.sh`, `install-electron-deps-fixed.sh`; 176 scripts with no index, 10 orphans; 17 scripts use `URL.pathname` (breaks on spaces). | Low | S | VERIFIED | |
| REPO-24 | **package.json declares the game MIT** with an empty author, no `private:true` and no LICENSE file, on a public repo; `package.json` ships inside the asar. | Low (legal) | S | VERIFIED | `package.json:136-137` |
| REPO-25 | **Commit granularity:** 195 non-merge commits in 4 days, many of 40–331 files mixing code, tests, binaries and docs, so bisect and revert are hard. | Low | S | VERIFIED | e.g. `94f4e23`, `d752a39` |

### 4.11 Odyssey (ODY): gameplay, progression, flow and board lifecycle (chapter visuals excluded)

Level data validates cleanly: 60 levels, unique IDs, every theme exists and is obtainable, no unknown objectives or modifiers, monotonic stars, and no 0-star completion. Disposal discipline on background loops and the save v4 design are strong. Open:

| ID | Finding | Sev | Eff | Conf | Evidence |
|---|---|---|---|---|---|
| ODY-01 | **The 3D map can't be driven by a controller:** no key or pad handler for orbs, and the level panel isn't a gamepad sheet. A pad-only (Deck/Big Picture) player can't start orb 1. | High | M | VERIFIED | `OdysseyBoardController.js:2899-2938`; `sheet-input.js:18-80`; `gamepad-controller.js:715-723` |
| ODY-02 | **Exit during board build, then quick re-entry → Odyssey opens with no map:** the stale `_boardBuildPromise` is joined and a null board "revealed". | High | S | VERIFIED (mechanism) | `OdysseyMode.js:2882-2896,2948-2949,3067-3117` |
| ODY-03 | **A board disposed mid-build keeps building and is retained forever:** one `_disposed` check across ~18 awaits; it re-attaches document/window listeners after teardown and renders ~17 warm-up frames through a disposed post stack. | High | S–M | VERIFIED | `OdysseyBoardController.js:957-1248,2915-2916,2495-2500` |
| ODY-04 | **The background chapter loader runs synchronous `create()` (~400 ms) while parked mid-level**: there is no active/paused gate. | Med-High | S | VERIFIED | `OdysseyBoardController.js:1501-1527`; `ChapterEnvironmentManager.js:745,960-1011` |
| ODY-05 | **Each visit keeps the previous renderer graph and ~8 MB of shared-texture VRAM alive:** r186 texture `dispose` listeners outlive `Renderer.dispose()`; `oneWorld.dispose()` is never called. | Med | S–M | VERIFIED mechanism | `OdysseyBoardController.js:4589-4695`; `odyssey-world-renderer.js:4778-4796` |
| ODY-06 | **The dead warp transition still opens a full-window WebGL context per session** (5 s after board show, never disposed). ~2.2k dead lines. | Med | S | VERIFIED | `OdysseyMode.js:2995-3053`; `ThemeTransitionManager.js:298-312`; `WarpTransitionRenderer.js:99-115` |
| ODY-07 | **Deep-chain stars and bonuses effectively unreachable** (10–18-wave chains; the project's own solver peaked at 9 in 192 pieces). Realistic `odyssey_stars` cap ≈176; the finale routes players to these orbs. | Med | S (data) | PLAUSIBLE | `levels.js:4677-4688,4884-4900,4942-4950` |
| ODY-08 | **Reaching the goal on the final lock still fails if the next spawn is blocked:** game over wins the race against the victory check. | Med | S | VERIFIED | `game.js:1196-1213`; `OdysseyMode.js:2311-2345,2475-2497` |
| ODY-09 | **No Restart or Back-to-map in the pause strip;** the navigator's "Back to menu" dead-ends (dispatches `returnToMenu`, which nothing shows a menu for). | Med | S–M | VERIFIED code | `index.html:1131-1140`; `OdysseyMode.js:3870-3873` |
| ODY-10 | **A corrupt Odyssey save is silently overwritten on the next save, and also blocks Cloud restore.** No backup, unlike the theme collection. | Med | S | VERIFIED | `OdysseyStateManager.js:165-205`; `steam-cloud-sync.js:62-69,573-578` |
| ODY-11 | **Entry timeout (6.8–9.8 s) silently bounces the player to the map;** the project's own probe hit it. | Med | S | VERIFIED | `JourneyEntryTransition.js:404-415`; `OdysseyMode.js:854-881,1030-1076` |
| ODY-12 | **Quality is read once; Render Scale and the FPS cap never reach the board.** No settings subscription. | Med | S–M | VERIFIED | `OdysseyBoardController.js:752-754,2424-2434,3540-3558` |
| ODY-13 | = CORE-03 (inputs dropped during hit-stop and clears). | Med | M | VERIFIED | `legacy-input-wrapper.js:28-33` |
| ODY-14 | **30 orb "new song" rewards are byte copies of Blood Moon** (255 MB); the reward UI announces "Theme + song collected". | Med | S (dedupe) / L (content) | VERIFIED (+ coordinator) | `theme-music-catalog.js:45-60`; `ThemeUnlockReward.js:66-74` |
| ODY-15 | **Flow pacing is far from instant:** ≈5–6 s fixed after Continue, ≈12–18 s goal→control on a first clear, retry ≈1.3–1.7 s with no restart key; replays never auto-continue. | Med | M | VERIFIED (code timings) | `JourneyFlowOverlay.js:25-27`; `odyssey-journey-flow.js:117-118,289`; `retry-veil.js:8` |
| ODY-16 | **Timed orbs keep counting while unfocused or hidden** (`Date.now()` clock, no blur pause). | Low-Med | S | VERIFIED | `OdysseyMode.js:2201,3889-3894` |
| ODY-17 | **"Clear no single lines" counts automatic cascade waves** (gates 3★ on six orbs). | Low-Med | S | VERIFIED | `VictoryConditionEvaluator.js:56-73`; `physics.js:869-876` |
| ODY-18 | **Concurrent creation of the same chapter** → duplicate group and orphaned rig lights (no in-flight dedupe). | Low-Med | S | VERIFIED mechanism | `ChapterEnvironmentManager.js:722-760,4547-4580` |
| ODY-19 | **Map frozen after a return within 1.2 s of GO:** resume keys off "parked". | Low | S | VERIFIED | `OdysseyMode.js:790,843-852,3088-3092` |
| ODY-20 | **Dead data and code:** no-op modifiers on 34 orbs; dead `theme.overlays` on 12; unused methods; unbounded `performance.mark`s. | Low | S | VERIFIED | `ModifierStack.js:21-44`; `ThemeTransitionManager.js:56-75` |
| ODY-21 | **OdysseyLayoutEditor ships** (362 KB chunk; DEV-only gate on a dynamic import). | Low | S | VERIFIED | `OdysseyBoardController.js:1273-1277`; `odyssey-url-flags.js:12-23` |
| ODY-22 | **Copy/data nits:** two vacuous time bonuses; three tips still define "combo" as consecutive clears. | Low | S | VERIFIED | `levels.js:953,2499,2781` |
| ODY-23 | **Inconsistent held-key policy** across failure, results and journey overlays (Space, `e.repeat`). | Low | S | VERIFIED | `FailureModal.js:123-151`; `ResultsModal.js:178-197` |
| ODY-24 | **Leaderboard integrity:** solo runs unseeded and unrecorded; showcase "level time" includes the optional lap; playtime +1 min per clear. | Low | S–M | VERIFIED | `OdysseyMode.js:2037-2040`; `odyssey-completion.js:11-13` |
| ODY-25 | **~68 `odyssey*` URL flags read in shipping code, ~12 registered.** `fixedTick` honoured from localStorage silently makes every orb unranked and unsaved; fixed-tick standard orbs throw on a null `board`. | Low | S | VERIFIED | `flags.js:46-57,155-200`; `OdysseyMode.js:398,2036` |
| ODY-26 | **Map auto-drift ignores reduced motion and never stops** (WCAG 2.2.2). | Low | S | VERIFIED | `OdysseyCameraController.js:864-871,2136-2180` |
| ODY-27 | **God files:** OdysseyMode 4,390 lines (ceiling 4,391) and OdysseyBoardController 4,698 (no ceiling). Seams: entry orchestrator, map view, attempt controller; flag reader, cancellable bootstrap, background scheduler, GPU profiler, map input. | Med (struct) | L | VERIFIED | |


---

## Part 5 — The 2026-10-03 audit, ten days later

In-scope items only; themes are excluded.

Of the ~92 sub-items re-checked:

| Status | Count |
|---|---|
| ✅ Fixed | 32 |
| 🟡 Changed / partial | 9 |
| ⬜ Still open | 43 |
| ⚠ Worse | 8 |

Two of its claims needed correcting:
- **Confirmed:** the `node_modules`-in-asar payload, marked "(plausible)", is real: 193 MiB measured.
- **Not viable:** its proposed leaderboard fix, "use ez-steam-api", cannot work. The library can't load next to steamworks.js (ELEC-06).

| 2026-10-03 item | Now | Where |
|---|---|---|
| **#1** line clears shift fragments | ✅ fixed (shipped without a rules-version bump) | CORE table |
| #1 T/J/L kicks mirrored | ⬜ open | CORE-02 |
| #1 Infinity expands mid-cascade | ✅ fixed | |
| #1 inputs dropped during clears / hit-stop | ⬜ open | CORE-03, INPUT-05 |
| #1 Odyssey "combo" = cascade depth | 🟡 copy now says "N-wave chain"; targets still unreachable | ODY-07 |
| #1 local 3–4P attack scaling | ⬜ open | INPUT-04 |
| #1 bounding-box top-out after garbage | ✅ fixed (cell-precise) | |
| #1 SP replays diverge | ⚠ wider than reported (34/40 with no stall) | CORE-01 |
| **#2** departures, rejoin, `FragTracker.isHost`, clock skew, prior-round garbage, teardown timers, SYNCPOINT spam | ✅ all fixed | NET table |
| **#3** AppID 480 / `restartAppIfNecessary` | ⬜ open | ELEC-01 |
| #3 leaderboards / achievements / friends on missing APIs | ⬜ open; Cloud ✅ fixed but a new data-loss bug | SCORE-01/02, ELEC-06 |
| #3 BigInt lobby counts | ✅ fixed | |
| #3 overlay never enabled | ⬜ open | ELEC-05 |
| #3 no PR build / no packaged smoke | ⬜ open | ELEC-12, REPO-04 |
| **#4** unbounded attack depth | ✅ fixed (residual: complexity) | NET-22 |
| #4 P2P auto-accept / no membership check / no bans | ⬜ open | NET-02 |
| #4 CSP inert under `file://` | ⬜ open | ELEC-02 |
| #4 peer strings into innerHTML | ✅ fixed in online UI (residual: Cloud-imported scores) | UI-24 |
| #4 Electron behind | ⚠ now end-of-life | ELEC-03 |
| #4 no fuses | ⬜ open | ELEC-08 |
| #4 `STEAMWORKS_MODULE` honoured in packaged builds; `openExternal` takes any URL | ✅ fixed | |
| **#5** prewarm / mode-entry blank screen | 🟡 blank fixed; rebuild on entry remains | LIFE-08 |
| #5 Parhelion / Serenity Warp blank | ✅ fixed | |
| #5 Odyssey background loops are flag-flips | ✅ fixed (`_disposed`) | |
| #5 mid-build exit zombie | 🟡 tail fixed; mid-build still open | ODY-02/03 |
| #5 VRAM per Odyssey visit | ⬜ open | ODY-05 |
| #5 dead warp transition | 🟡 deferred, still built | ODY-06 |
| #5 boot failures invisible | ⬜ open | BOOT-01/02 |
| #5 safe-mode suspend leak | ⬜ open | LIFE-09 |
| #5 GameModeManager identity | 🟡 activate fixed; deactivate/stop open | LIFE-02 |
| **#6** chat keys move pieces | ✅ fixed (gaps: select, Esc, Serenity) | INPUT table |
| #6 keys stick after alt-tab | ✅ keyboard / ⬜ gamepad | INPUT-10 |
| #6 controller trapped at game over | ✅ fixed | |
| #6 `window.*` input patching | ⬜ open | INPUT-09 |
| **#7** (non-theme parts) frame cap | 🟡 3 theme folders + menu intro + Odyssey map uncapped | REND-01/02/08 |
| #7 DRS persists downscales | ⬜ open | REND-04 |
| #7 empty WebGL1 overlay every frame | ⬜ open | REND-05 |
| **#8** dark migrations | ⬜ open (~13 weeks) | CORE-05 |
| #8 `wireV2` expiry | ⬜ open, **18 days left** | CORE-04 |
| #8 unregistered URL flags | 🟡 reads pinned by a catalog test; 163/173 unregistered | REPO-14 |
| #8 sim flags not negotiated | ⬜ open | NET-04 |
| #8 nondeterminism regex | ⬜ open | REPO-07 |
| **#9** SFX block, orphan skill, CONTRIBUTING, RECOMMENDATIONS | ✅ fixed | |
| #9 umbrella plan stale | 🟡 §0a added; no ROADMAP.md | REPO-15 |
| #9 one canonical agent guide | ⬜ open | REPO-16 |
| **#10** node_modules in asar | ⬜ open, **confirmed (193 MiB)** | ELEC-07 |
| #10 music in asar | ⚠ 257 → 511 MB | R-16 |
| #10 WAV voice lines | ✅ fixed (MP3) | |
| #10 unused public assets | ⚠ 51 → ~62 MB, plus 256 MB of placeholders | REPO-02 |
| #10 repo weight | ⚠ 1.01 → 1.52 GB | REPO-08 |
| #10 `reports/` | ⚠ 159 → 197.5 MB | REPO-08 |
| #10 dead duplicates; god files | ⬜ / ⚠ | REPO-10, R-38 |
| **Part 3:** REPLAY_VERIFIED; forced recording; 4× JSON.stringify; ≥3 rebuilds per lock; LCG RNG; Gravity Cascade no-op; `MAX_CONCURRENT_LOOPS`; digest = score/lines; per-packet IPC | ⬜ open | CORE, NET |
| Part 3: HUD RTT overwritten; `registerAttackerIds`; `serenity:toast`; 22 native alert/confirm; View/Reload menu in release; `electric-dreams` heavy | ✅ fixed | |
| Part 3: settings per-tick write | ✅ debounced (schema still open) | UI-11 |
| Part 3: replay share `file://` leak | ⚠ also nothing reads `?demo=` | UI-08 |
| Part 3: `build.esbuild`; inspector path; boot-closure spaces; second instance; Borderless; GPU-renderer stub; electron/ unlinted; single-total lint ratchet; unpinned SBOM; `build:linux` Steam; obsolete root scripts | ⬜ open | BOOT, ELEC, REPO |

## Part 6 — Strengths to keep (don't redo these)

- **Simulation**
  - `fixed-tick-clock.js`: time-conserving, ADR-0012 overload policy, 30/60/144 Hz proofs.
  - `simulation-tick.js` explicit dispositions.
  - One DAS engine (`das.js`) and the integer 60 kHz input state.
  - A pure `resolveCascade` with commit-per-wave.
  - A generation-fenced lifecycle in every mode.
  - The line-clear fix shipped with conservation fixtures on both paths.
- **Online**
  - Default-deny message catalog with exact sender→receiver routes, enforced on send and receive.
  - Per-sender budgets and size caps checked before parsing.
  - Protocol negotiation with clear rejection copy.
  - Chunked, CRC-checked resync behind a two-phase input barrier (ADR-0014).
  - F-1/F-2/F-11 hold: wait for the keyframe, a single writer per opponent tile, a frozen delta baseline.
  - Departure and host-loss handling in every phase.
  - **The session harness**, which reproduced six of this audit's bugs in minutes.
- **Saves**
  - Atomic local score save.
  - The theme collection: monotonic union, backup of corrupt bytes, read-only future versions, receipts after a durable write.
  - Odyssey v4 migrations that also run on Cloud documents.
  - Cloud reads distinguish "missing" from "failed".
- **App shell and UX**
  - The startup state machine: a single MENU_VISIBLE writer, a terminal watchdog, an honest split KPI.
  - ThemeManager's latest-wins queue with generation tokens.
  - ADR-0020 async pipelines under loading surfaces.
  - The Keystone design system.
  - `sheet-input` focus trap and restore.
  - The toast service.
  - Native `alert`/`confirm` fully removed.
  - Odyssey's journey portals and flow overlay: the model for input-safe, cancellable transitions.
- **Audio**
  - One AudioContext.
  - Music streamed, not decoded.
  - LRU-bounded decoded buffers.
  - A pull-based, throttled analyser.
- **Rendering**
  - The theme frame-pacer logic and its tests.
  - Phaser's presentation clock forwarding true elapsed time.
  - Board geometry and segment caches with command-parity tests.
  - Self-parking BoardJuice and canvas effects.
  - HUD diffing.
  - The Odyssey opponent board's `loop.sleep()`, the template for R-29.
- **Odyssey**
  - Attempt-scoped sessions.
  - `LevelRegistry.validateAll`: the 60 levels validate cleanly.
  - `_disposed` on every background loop.
  - The disposal walk that keeps the GLB cache safe.
- **Electron**
  - Explicit `sandbox`, `contextIsolation` and `nodeIntegration:false`.
  - Popups denied; navigation blocked.
  - `openExternal` restricted to https Steam hosts.
  - Debug keys only in dev or diagnostics builds.
  - BigInt converted at the IPC boundary.
  - The afterPack 480 gate.
  - `steam-init.log`.
- **Governance**
  - 20 ADRs.
  - Shrink-only ratchets, depcruise with 0 cycles, the boot-closure guard.
  - `npm ci --ignore-scripts`, a production audit gate, an SBOM, exact pins on three and the natives.
  - A flag registry whose time bomb works as designed.
  - Benchmark evidence with SHA-256 manifests.
  - 17,977 passing tests, including property and fuzz tests.
  - An all-LF index.

## Part 7 — Suggested sequencing

Sized for one part-time developer, with AI help.

| When | Do | Why first |
|---|---|---|
| **This week** | R-01 `wireV2` decision · R-02 steps 1–3 (bootstrap timestamps, stats merge) · R-03 code (once the AppID is supplied) · R-05 P2P filter · R-06 NET-01/05/07/08 · R-10 binding defaults, `e.code`, pad latch · R-16 `!node_modules` + placeholder dedupe + `publish:null` · R-36 `--update` baselines + pathspec | Deadline, data loss, exposure; each is S |
| **Weeks 2–3** | R-07 Electron 44 + meta CSP + fuses + dev surfaces gated · R-08 focus pause · R-09 no unseen play · R-11 boot failure panel + crash handlers · R-12 Odyssey pad + dead ends · R-04 binding ADR (hide boards meanwhile; wire achievements) · R-27 packaged smoke job | Release-readiness: every later fix lands on a supported, tested package |
| **Weeks 4–8** | R-13 rules registry, then rule fixes · R-14 command gate · R-15 replays · R-17 opening (incl. the no-GPU fallback) · R-18/19 lifecycle · R-28 crisp board (screenshot-verified) · R-29 frame driver · R-30 contexts · R-20–R-26 · the R-04 implementation | Player-facing quality, in dependency order |
| **Ongoing (P2)** | R-31 input router · R-32 persistence · R-35 toolchain · R-36–R-38 structure · R-39 l10n · then R-33 determinism → R-34 netcode | Structural; R-33 and R-34 need R-13 and R-15 first |

**Owner decisions this audit can't make:**
- `wireV2`: graduate, delete or re-date.
- The real AppID, and a Steam channel vs a standalone NSIS channel.
- The Steam binding: a steamworks.js fork vs a maintained FFI binding.
- The `in-process-gpu` overlay trade-off.
- The Electron target major.
- Whether to score T-spins, B2B and combo.
- One garbage table for local and online.
- Odyssey chain-target retune vs a construction proof.
- Licence, and what the public Pages site should host.
- The web build's support level.
- How placeholder songs are presented.
- When to move to `app://` (it must precede any public build).

---

## Appendix — Reproducing this audit's measurements

**Gates**
- Install with `npm ci --ignore-scripts`.
- Run the steps of `.github/workflows/pages.yml` in order.
- Add `npm outdated --long` and the full `npm audit`.

**Duplicates**
- Hash every file over 100 KB in `dist/`: `find dist -type f -size +100k -print0 | xargs -0 sha256sum`.
- Group the output by hash.

**Bundle**
- `npm run build` prints the boot closure.
- `dist/manifest.json` lists each entry's imports and dynamic imports.

**Browser boot**
- Serve with `npx vite preview`.
- Load it in Playwright's Chromium with `--use-angle=swiftshader --enable-unsafe-swiftshader`.
- Collect `longtask` entries with a `PerformanceObserver`.
- Wait for `window.startupPipelineSnapshot`, then read its `metrics`.
- Record requests with `request.sizes()`.

**Real-hardware boot numbers (run on the owner's machine, not in a cloud session)**
- Start the dev server (`npm run dev`).
- Run the repo's own instrument (ADR-0016): `node scripts/run-electron.mjs scripts/boot-smoothness-probe.mjs --port 5173 --duration 45000 --out reports/boot-smoothness/<tag>.json`.
- Add `--theme neon-district` for the heavy-theme case.
- The committed RTX runs in `reports/boot-smoothness/` are the baseline the R-17 estimates start from.

**Package**
- `npx electron-builder --dir --linux --publish never`, with `SERENITY_SKIP_ELECTRON_NODE_MODULE_SCAN` *unset*, as `scripts/build-win.mjs` does.
- List `app.asar` with `require('@electron/asar').getRawHeader(path).header`.

**Packaged smoke run**
```
xvfb-run -a env ELECTRON_ENABLE_LOGGING=1 release/linux-unpacked/serenity-blocks --no-sandbox --enable-logging=stderr
```

**Reproductions**
- Findings marked *repro*, *executed* or *harness* were shown by short scripts. Each script imports the real modules, or uses the repo's own session harness (`tests/unit/helpers/session-wire.js`).
- The scripts lived in the session's scratch space and are not committed (this keeps to REPO-08's rule: no code copies in `reports/`).
- Each finding states its inputs and observed outputs, so it can be ported as a failing-first test (R-37).

**ID prefixes**

| Prefix | Area |
|---|---|
| CORE | rules and engine |
| INPUT | input, local MP, bots |
| NET | online |
| SCORE | scores, Steam services, saves |
| UI | menus, settings, accessibility |
| LIFE / AUDIO | lifecycle and audio |
| REND | rendering |
| BOOT | boot and build |
| ELEC | Electron and packaging |
| REPO | structure, tooling and repository |
| ODY | Odyssey |

`= X` marks a defect two reviewers found independently.


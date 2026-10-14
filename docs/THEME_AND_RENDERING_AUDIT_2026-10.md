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
| THM-46 | geode | `touch()` re-packs ALL crystals (5 `subarray` views each; n = heroes + 8 crown rings, up to ~476 High / ~680 Extreme) on every `strike()`; a lock strikes 1 + up to 7 chime voices, a hard drop 3 sparks -> ~19k-82k short-lived views per lock event | High | Perf | VERIFIED | `src/themes/geode/geode-crystals.js:225-235` `const touch = () => { for (let i = 0; i < n; i++) { ... liveData.set(aStore.subarray(i * 4, i * 4 + 4), o);` + `:651` `touch();` (per strike); `src/themes/geode/geode-world.js:463-472` chime loop |
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
| 6 | blood-moon | B1 | done · 0/0/2/2 · RM: setting + OS, live | not started |
| 7 | chiral-gold | B3 | in progress | not started |
| 8 | chromadelic-highway | B3 | in progress | not started |
| 9 | chromatic-impasto | B7 | in progress | not started |
| 10 | cinder-drift | B4 | in progress | not started |
| 11 | cosmic-noir | B3 | in progress | not started |
| 12 | crystal-cave | B3 | in progress | not started |
| 13 | fall | B5 | in progress | not started |
| 14 | fluid-dreams | B4 | in progress | not started |
| 15 | forest | B4 | in progress | not started |
| 16 | galaxy | B2 | done · 0/0/0/3 · RM: setting + OS, live | not started |
| 17 | geode | B1 | done · 0/1/1/2 · RM: setting + OS, live | not started |
| 18 | golden-forest | B1 | done · 0/0/2/3 · RM: OS only | not started |
| 19 | halcyon-apex | B6 | in progress | not started |
| 20 | high-coast | B6 | in progress | not started |
| 21 | himalayan-peak | B7 | in progress | not started |
| 22 | ice-temple | B2 | done · 0/0/0/3 · RM: setting + OS, live | not started |
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
| 33 | neon-district | B1 | done · 0/0/3/4 · RM: setting + OS, live (flicker sources ungated) | not started |
| 34 | neon-dusk | B6 | in progress | not started |
| 35 | nimbus-veil | B4 | in progress | not started |
| 36 | ocean | B6 | in progress | not started |
| 37 | painted-ages | B5 | in progress | not started |
| 38 | parhelion | B2 | done · 0/0/1/2 · RM: setting + OS, live | not started |
| 39 | pyrestorm | B2 | done · 0/0/2/2 · RM: setting + OS, live | not started |
| 40 | rainbark | B2 | done · 0/0/0/3 (+ shared THM-03/09/11/24) · RM: setting + OS, live | not started |
| 41 | rainy-window | B5 | in progress | not started |
| 42 | sakura-twilight | B5 | in progress | not started |
| 43 | serenity-warp | B3 | in progress | not started |
| 44 | shifting-sands | B5 | in progress | not started |
| 45 | sky-children | B1 | done · 0/1/1/6 · RM: setting + OS, live | not started |
| 46 | sky-children-v2 (retired id → sky-children) | B1 | done · 0/0/0/6 (latent) · unreachable in game; RM: neither | n/a unless reachable |
| 47 | solar-eclipse | B2 | done · 0/0/0/1 · RM: setting + OS, live | not started |
| 48 | starlight | B3 | in progress | not started |
| 49 | stellar-drift | B6 | in progress | not started |
| 50 | stellar-velocity | B7 | in progress | not started |
| 51 | stillwater | B7 | in progress | not started |
| 52 | summer | B8 | in progress | not started |
| 53 | sunset | B5 | in progress | not started |
| 54 | supernova | B8 | in progress | not started |
| 55 | synthwave-sunset | B1 | done · 0/0/3/4 · RM: neither | not started |
| 56 | thermal-bloom | B4 | in progress | not started |
| 57 | tornado | B8 | in progress | not started |
| 58 | verdant-hills | B7 | in progress | not started |
| 59 | vesper-chrysalis | B2 | done · 0/0/0/2 · RM: setting + OS, live | not started |
| 60 | void-ember | B7 | in progress | not started |
| 61 | voltage-storm | B8 | in progress | not started |
| 62 | waves | B1 | done · 0/0/1/3 · RM: setting + OS, live | not started |
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

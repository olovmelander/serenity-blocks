# CI gates, tests and verification tooling

> **Snapshot taken at commit 5d3478d (main, 2026-10-11) during the Rainbark design; line numbers drift, verify against the current code.**
>
> Part of `docs/theme-concepts/`: the index is [`../README.md`](../README.md) and the shared build procedure is [`../PLAYBOOK.md`](../PLAYBOOK.md). PLAYBOOK wins where the two disagree; it was written later and folds in what the Rainbark build learned.
>
> This survey was written while choosing a replacement for `cosmic-chimes`. That replacement happened in `585ab55` (Cosmic Chimes → Rainbark), so `cosmic-chimes` no longer exists outside the `RETIRED_THEME_IDS` alias, the frozen V2 save table and dated records. Read every "cosmic-chimes", "Cosmic Chimes" or "the old theme" below as "the theme being replaced" (`OLD_ID` in PLAYBOOK), with the Cosmic Chimes → Rainbark change as the worked example. To choose the theme a new concept replaces, see PLAYBOOK §1 "Choosing a slot".
>
> "Here", "locally", "this container" and "this session" mean the Claude Code cloud container the survey ran in on 2026-10-11 (no GPU; headless Chromium 141 with SwiftShader for WebGPU and WebGL2). The capture scripts that work there are printed in full in PLAYBOOK §5.
>
> Counts move: after `585ab55` the full suite was 822 files / 15 679 tests and the lint ratchet 609 errors. Re-run the commands instead of trusting the numbers below.

Repo HEAD `5d3478d` (main, merge of serenity-warp masterpiece). Working tree clean. Node v22.22.0, vitest 3.2.7, Vite 5.4.21, 4 vCPU / 15 GB.

## 1. CI workflows (.github/workflows)

### pages.yml — the only per-PR/per-push gate (push to main + every pull_request)
Job `test` (ubuntu-latest, node 24, `npm ci --ignore-scripts`), in order. Every step below was run locally and passed (timings measured here):

| # | CI step | Local command | Result here |
|---|---|---|---|
| 1 | typecheck (opt-in `// @ts-check`, checkJs:false) | `npm run typecheck` (= `tsc --noEmit`) | exit 0, 5.5 s |
| 2 | TS coverage ratchet | `node scripts/ts-ratchet-check.mjs` | 73 pragma'd files = baseline 73, 0.2 s. No theme-dir file is in ts-ratchet.json except src/themes/shared/* and theme-frame-pacer.js |
| 3 | lint error ratchet (baseline lint-ratchet.json maxErrors 807) | `npm run lint:ci` (= `node scripts/lint-ratchet-check.mjs`; lints all of `src`) | 610 errors (<807), 1370 warnings, 90.7 s. Fails only if total errors > 807. Lint just the new dir with `npx eslint src/themes/<id> --ext .js` |
| 4 | architecture fitness (architecture-fitness.json, shrink-only) | `node scripts/architecture-fitness-check.mjs` | OK, 1.6 s. **lines:main = 5642 and lines:OdysseyMode = 4391 are AT their ceilings** (wc -l shows 5641/4390 + split('\n') counts one more): adding ANY net line to `src/main.js` or `src/core/game-modes/OdysseyMode.js` fails CI. Relevant because the rename precedent (a74a86a) edited the `heavyThemes` Sets in OdysseyMode.js:1036-1043 and :1086-1093 — swap an id in place, never add a line. shader-material:hits 100/200, files 13/30, resize-listeners 27/40 (slack exists, but a theme should add none) |
| 5 | theme lifecycle audit | `npm run audit:theme-lifecycle` (= `node scripts/theme-lifecycle-audit.mjs`) | "passed with no obvious issues", 3.8 s |
| 6 | import boundaries | `npm run check:boundaries` (= `depcruise src --output-type err`) | 0 violations, 1492 modules, 7.1 s |
| 7 | unit tests | `npm test` (= `vitest run`, include `tests/unit/**/*.test.js`, `src/**/*.test.js`) | **817 files / 15 506 tests all pass, 492.8 s** (ran with headless-Chromium probes contending) |
| 8 | perf-budget falsifiability (no measurement) | `npm run perf:budgets:gate` | PASS, 0.3 s |
| 9 | release-gate scaffolding | `npm run check:release-gates` | passed (runs an inner vitest of 5 tests), 1.5 s |
| 10 | prod dependency audit (hard) | `npm audit --omit=dev --audit-level=high` | not run (network); unaffected by theme work |
| 11 | full audit (continue-on-error) | `npm audit --audit-level=high` | soft lane |

Job `build` (push only, needs test): `npm run build` (= `vite build && node scripts/check-boot-closure.mjs`) → `npm run check:ip-strings` → `npm run check:pages-artifact` → upload dist. Local: build exit 0 in 40 s ("entry static closure: 3 chunks, 12 KB / main static closure: 3 chunks, 1073 KB / boot closure OK"), ip-strings OK 0.3 s, pages-artifact OK 0.3 s. (I deleted the `dist/` I created; it is gitignored.)

NOT in CI: `npm run check:palette` (scripts/palette-guideline-check.mjs) — but every masterpiece rebuild lists it as green (docs/SERENITY_WARP_VISUAL_OVERHAUL_2026-10.md "CI gates"). Local: exit 0, "61 palettes screened, 0 full matches, 1 warnings" (luminous-tides legacy format).

### gpu-validation.yml — "Odyssey GPU Validation", workflow_dispatch only
Electron + xvfb + SwiftShader, `node node_modules/electron/install.js` then `node scripts/run-electron.mjs scripts/odyssey-webgpu-validation.mjs` with `ODYSSEY_FORCE_WEBGL=1`, verdict from `artifacts/odyssey/webgpu-validation/webgl2/report.json`. Odyssey scenes only, never blocks a PR; schedule retired (hosted runners lack Chromium shm). Irrelevant to a theme swap.

## 2. What each gate requires of the new theme

- **themes-are-islands** (.dependency-cruiser.cjs:41-66): `src/themes/<id>/**` may import only its own dir, `src/themes/shared/`, `base-theme.js`, `theme-registry.js`, `theme-manager.js`. Known-violations baseline is empty — never add one. Also `no-electron-in-renderer-src` (no `node:*`, fs, path… under src/), `no-circular` (count is 0).
- **theme-lifecycle-audit** (scripts/theme-lifecycle-audit.mjs:1-23; parses every .js/.ts under src/themes, BaseTheme subclasses only): cleanup()/stop() overrides must call super; no inline `.bind(this)` in add/removeEventListener; raw `window` resize listener needs removal path; `dispose()` needs stop()/cleanup() adapter; no `super.dispose()`; no async teardown overrides; animation-loop rAFs must be registered/stored; `WebGPURenderer.init()` needs a lifecycle-owned late-retirement path; stop()/cleanup() returns must not bypass BaseTheme teardown. Heuristics unit-tested in tests/unit/theme-lifecycle-audit.test.js. Safest: copy the serenity-warp-theme.js adapter shape (ported from Stellar Velocity's).
- **palette-guideline-check**: reads the first hex per shape from `src/themes/<id>/<id>-tetrominos.js` (`colors: { I: '#xxxxxx', … }` modern format; must contain `colors:`). FAIL if all 7 shapes land in Guideline hue bands (I 160-210, O 32-75, T 245-315, S 90-170, Z 320-360/0-20, J 200-250, L 20-50); WARN at 6/7 (needs documented human review); WARN if the exported const is not referenced by another file in the theme dir (dead config). Derange at least two roles.
- **ip-string-gate** (scripts/ip-string-gate.mjs:31): scans public/, index.html, dist/ case-insensitively for the trademarked name of the original falling-block game and its official spelling of the piece name, as standalone tokens (the `TOKEN` regex). Never put those words in user-visible strings/CSS/HTML or string literals that survive minification (say "four lines", "quad", "pieces").
- **check-boot-closure**: main chunk's static closure must not reach any `theme-*`, `mode-*`, `phaser`, `three` chunk. Theme must stay lazily imported via the registry `module:` path (don't import it from main/UI statically).
- **architecture-fitness**: see ceiling note above; also don't add `new ShaderMaterial(` (shader-material ratchet) and no window resize listeners.
- **dual-state tripwire** (tests/unit/dual-state-theme-tripwire.test.js:24-27,30-31): allowlist is only `cosmic-noir`, `wolfhour`; a theme dir (scanned via `git ls-files src/themes/**/*.js`, so only TRACKED files count) containing both `new …WebGPURenderer(` and `new …ShaderMaterial(` fails.
- **Static per-theme conventions** pinned by every sibling theme test (serenity-warp-theme.test.js:441-458): no `new …ShaderMaterial(`, no `new …WebGLRenderer(`, no `mx_*(` MaterialX noise (DXC compile pathology), no `from 'three'` (use `three/webgpu` + `three/tsl`), no absolute asset paths `'/assets/…'`/`'/textures/…'` (break under file:// in packaged Electron), no `.wgsl/.glsl` files, no `getContext(`/`localStorage` in the theme shell, no `EffectComposer|UnrealBloomPass|ShaderPass|RenderPass|compileComputeAsync`, no `buildsPipelinesAsync` (ADR-0020: manager's async session covers pipelines). ADR-0019: choose node materials on `renderer.isWebGPURenderer` (true on both backends); WebGL2 backend is a supported player surface.

## 3. Tests touched by replacing/renaming cosmic-chimes

`grep -rn cosmic-chimes|CosmicChimes|Cosmic Chimes tests/` hits exactly 4 files:

| File:line | What | Action |
|---|---|---|
| tests/unit/mobile-wrapper-policy.test.js (whole file, 74 lines; :4 `import CosmicChimesTheme from '../../src/themes/cosmic-chimes/cosmic-chimes-theme.js'`) | DOM/CSS quality-animation policy of the old theme (space-dust/chimes counts 15/3 Minimal, 45/9 High) | **breaks on deletion → delete the file** (it tests nothing else) |
| tests/unit/mobile-webgl2-validation.test.js:159-171 `cleanResult('cosmic-chimes')` "does not require a renderer heartbeat from authored DOM artwork" | id used as a label only (mobileWebgl2Failures never looks it up) | passes either way; relabel (the new theme is no longer DOM artwork). If the new id joins `MOBILE_WEBGL2_NODE_IDS`, this label must NOT be the new id |
| tests/unit/odyssey-save-migration.test.js:79 `43: 'cosmic-chimes'` | frozen v2 save table expectation | **keep unchanged** — `V2_LEVEL_THEME_IDS` in src/core/odyssey/odyssey-progress-schema.js:26-27 is frozen on purpose (a74a86a kept `electric-dreams-v3` there). Map the old id via `RETIRED_THEME_IDS` instead |
| tests/unit/theme-music-preferences.test.js:15 (`'CosmicChimes'` as an unavailable saved key → Forest), :99-100 (fake `trackNames`) | track key as example data | passes either way (unowned key still repairs to `EchoesOfTheSoul`); optional relabel |

Generic registry-driven tests that will exercise the new id (no edit needed if invariants hold):
- **tests/unit/theme-music-catalog.test.js:23-33** — `THEME_MUSIC_CATALOG` length **61**, themeIds `toEqual(THEME_REGISTRY.map(id))` (same order), 61 distinct themeId/trackKey/file/path, **31 authored (`placeholder:false`) / 30 placeholders**. Cosmic Chimes is authored today (`theme-music-catalog.js:19` `'cosmic-chimes': ['Cosmic Chimes', 'cosmic-chimes.mp3']`). Keep the recording (rename like murmuration: git mv mp3, new AUTHORED_SONGS key) → counts unchanged; turn it into a placeholder → must become `<new-id>-placeholder-song.mp3`, a byte-identical copy of `blood-moon.mp3` (:77-90), and counts become 30/31. `:113-117` `shippedManifest` must `toEqual(buildSongsManifest(files, []))` → after any music change run `node generate-songs.js` (rewrites public/assets/music/songs.json, alphabetical by name). `:136-139` missing recording throws.
- **tests/unit/odyssey-unique-themes.test.js** — 60 orbs, 61 registry entries, every orb theme registered + canonical (`resolveThemeId(x)===x`); `chapter.themes.primary` must equal the orb order → rename `src/core/odyssey/data/chapters.js:230` and `levels.js:3132` (orb 47 "Singularity Gate", ch 6) in lockstep; `catalog.get(id).icon` truthy; `getOdysseyThemePresentationPalette(id)` non-null → rename key in `src/core/odyssey/theme-presentation.js:12` (`'cosmic-chimes': '#7ce8ff'`). Pinned anchors (orbs 1,42,43,51,55-58) don't include 47.
- **tests/unit/odyssey-difficulty-balance.test.js:51-60** pins orb 47's role/difficulty (not its theme).
- **tests/unit/theme-registry-lifecycle-acceptance.test.js:117-218** — imports EVERY registry module in Node with only `window` (no gpu, `location.search ''`, `matchMedia`), `document` (all lookups null), `navigator {gpu:null}` stubbed and `@utils/helpers.js` aliased; default export must be a function, `prototype instanceof BaseTheme`; then switchTheme through all ids with lifecycle doubles; loaded instance `name` must equal requested id ("Theme identity mismatch"). → module top-level must not touch DOM/GPU.
- **tests/unit/murmuration-rename-migration.test.js** — the template for an old-id migration test (resolveThemeId, getThemeMeta alias, RETIRED_TRACK_KEYS via `resolveMusicTrackKey`, SettingsManager heals `backgroundTheme`/`musicTrack` on load, `normalizeThemeCollection` moves grants/seen ids, `getOdysseyCompletionThemeIds(...).map(resolveThemeId)`, orb named after theme, `JSON.stringify(LEVEL_CONFIGS)` free of old name). Write `<new-id>-rename-migration.test.js` (or a "replaces cosmic-chimes" block) the same way: add `['cosmic-chimes', '<new-id>']` to `RETIRED_THEME_IDS` (src/themes/theme-registry.js:513-517) and, if the song is retitled, `['CosmicChimes', '<NewKey>']` to `RETIRED_TRACK_KEYS` (theme-music-catalog.js:68-70).
- Others that iterate the registry: theme-collection.test.js (60 grants), development-collection-access.test.js (61 owned), theme-capture-orchestrator.test.js (entries = registry length), theme-container-registry.test.js ("works for every registered theme id"; `ensureThemeContainer` lazily creates `#<id>-theme` when index.html has no static div — serenity-warp/parhelion use this), mobile-webgl2-validation.test.js:41-46/66-74 (`--all` and `--list` print the registry), theme-manager-startup-policy.test.js (metadata only).
- **tests/unit/url-parameter-catalog.test.js** — every catalog `sources` path must exist on disk (add the `captureThemes` row in `src/ui/url-parameters/theme-parameters.js:64-185` only once `src/themes/<id>/<id>-theme.js` AND `<id>-world.js` exist; the row generates `<prefix>ForceWebGL`, `<prefix>Time`, `<prefix>FixedDt`, `<prefix>Parts`, `<prefix>FalseColor`), and every literal `params.get('x')`/`.has('x')`/`readFlag('x')` in a referenced source must be catalogued. Sibling theme tests assert the theme lists exactly those five and reads each by literal name.
- Registry metadata: add the new id to `HEAVY_GPU_THEME_IDS` (theme-registry.js:431-486) → `resourceProfile 'heavy-gpu'`, `performanceClass 'heavy'`, `startupEligible false` (cosmic-chimes is currently light). Sibling theme tests assert this triple.

Non-test rename surface (for completeness; from grep): src/themes/theme-registry.js:143-147 (id, displayName, module, icon, `group: 'cosmic'`), src/ui/serenity-hub/ThemesTab.js:302 (`'Cosmic Chimes': 'chime'` fallback icon, keyed by displayName), index.html:285-294 (static `#cosmic-chimes-theme` div with `.chime-nebula`, `#space-dust`, `#chimes`, `#cosmic-chimes-effects` — keep the `<div class="background-container">` … `<div class="game-container single-player-layout"` markers intact; validate-mobile-webgl2.mjs:285-288 slices on them), public/styles/main.css:2967-~3100 (`#cosmic-chimes-theme`, `#cosmic-chimes-effects` rules), public/assets/music/songs.json:86-92, public/assets/themes/cosmic-chimes-theme-icon.png (legacy public copy; a74a86a renamed its sibling), CREDITS.md:167 (song list), OdysseyMode heavyThemes Sets (optional, ceiling!). Dated docs/ and reports/ keep the old name (precedent). docs/theme-screenshots/results/cosmic-chimes.json is a generated validate-all-themes record.

## 4. How sibling theme unit tests are structured (serenity-warp, 5 files, 135 tests)

- **serenity-warp-core.test.js** (374 lines, 21 tests) — "the three-free core": palettes + drift, piece runs, shape packing for the shader, CPU twins of shader traces, waves, the jump. "Relations, not tuning numbers: constants are imported." No mocks. Ran here: `npx vitest run tests/unit/serenity-warp-core.test.js` → 21 passed, Duration 561 ms (1 s wall).
- **serenity-warp-world.test.js** (347) — a REAL `SerenityWarpWorld` in a `THREE.Scene` from `three/webgpu`, no renderer. Helper `makeWorld(quality='Minimal', {width,height,layout,at,reduce})`: `new SerenityWarpWorld({scene, quality, capture:true}).build()` → `bindCamera(new PerspectiveCamera(fovForAspect(aspect),aspect,REST_RIG.near,REST_RIG.far))` → `setReducedMotion` → `setViewport(w,h,aspect)` → `setLayout(fallbackLayout(w,h), aspect)` → `settle()` = `seek(t)` + `updateCamera(camera, sim)` + `update(sim, camera)` with `sim={time,delta,pointerX,pointerY}`. Asserts counts/order/bounds of what lock/clear/chain/quad/level do.
- **serenity-warp-director.test.js** (321) — `new SerenityWarpDirector({sink})` with a `vi.fn` sink `{lock, clear, combo, levelUp}` (sink must copy contexts: director reuses objects); drives `EVENTS` from src/events/event-bus.js; exports `SERENITY_WARP_EVENT_HANDLERS`, `resolvePieceColor`, `themePieceColor`; piece table `SERENITY_WARP_TETROMINOS.colors`.
- **serenity-warp-composition.test.js** (243) — layout math: `fallbackLayout(w,h)` (board from stylesheet formulas, 2:1 playfield, PLAYER_SLOTS), `readLayoutRects` over DOM-rect doubles `{getBoundingClientRect}`, selectors `BOARD_SELECTOR`, `HUD_SELECTOR`, `SOLO_CANVAS_SELECTORS`.
- **serenity-warp-theme.test.js** (1588) — the shell. `vi.mock('three/webgpu')` keeps the real module but replaces `RenderPipeline` (render/dispose spies) and `WebGPURenderer` (records `options.forceWebGL`, `backend {isWebGLBackend}` or `{isWebGPUBackend, device.limits}`, pixel ratio/size/drawing-buffer, `init` async). `vi.mock` of `<id>-world.js` and `<id>-post.js` with contract doubles (WORLD_METHODS: build, bindCamera, showOnlyParts, setViewport, setLayout, setReducedMotion, seek, resetSession, restCamera, updateCamera, onLock, onClear, onCombo, levelUp, update, getPostState, getState, dispose; POST_METHODS: update, setCalmRects, setSize, render, dispose; plus `POST_LOOK` per tier, `createPassThroughPipeline`), `vi.mock('../../src/utils/viewport.js')` (getViewport from stubbed window), `vi.mock('../../src/utils/gpu-loss-coordinator.js')`. `stubBrowser({gpu, search, quality, reducedMotion, settings})` stubs window (settings.effectQuality/graphicsQuality, matchMedia, location.search), document (`getElementById('<id>-theme')`, `#main-game-canvas`, `.single-player-stats-bar`, `.player-card[data-player]`), navigator (gpu or not), rAF. `createTheme()` spies `disposeRenderer`, `setupRendererResilience`, `initializeRendererCandidate`; `theme.createScene(theme.lifecycleGeneration)`, `stepFrame(nowMs)`. Pins: registry entry + icon file exists + `name === id`; static source bans (§2); exact 5 capture flags; WebGL2 backend of the node renderer when no GPU (`options.forceWebGL === true`, `isWebGPURenderer`); 6 pixel-ratio caps (Minimal 0.7 … Extreme 1.6). Final `describe.skipIf(!world||!post)` uses `vi.importActual` on the REAL world/post and runs every tier (Minimal…Extreme) through build → post → frames with lock/clear(tspin)/combo/levelUp → showOnlyParts/resetSession → dispose, asserting all materials `isNodeMaterial && !isShaderMaterial`, no `TextureLoader.load`, no `fetch` — "the node graphs are built, never compiled".

**TSL dual-backend compile-in-Node helper**: there is NO shared helper; it is copied inline per theme. Canonical copies: `tests/unit/himalayan-peak-shaders.test.js:27-72` and `tests/unit/winter-shaders.test.js:38-~105` (origin: parhelion-shader-size.test.js:38 / odyssey-tsl-noise-emission.test.js). Pattern:
```js
import * as THREE from 'three/webgpu'; import { context } from 'three/tsl';
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
const STAGE_BUDGET = 48 * 1024;
function stubRenderer() { return { contextNode: context(), lighting:{enabled:false}, backend:{ device:null,
  capabilities:{getUniformBufferLimit:()=>65536}, extensions:{has:()=>false},
  utils:{getTextureSampleData:()=>({samples:1,primarySamples:1,isMSAA:false})}, compatibilityMode:false },
  getRenderTarget:()=>null, getMRT:()=>null, shadowMap:{enabled:false,type:0}, capabilities:{},
  library:{fromMaterial:(m)=>m}, nodes:{}, getOutputRenderTarget:()=>null, currentColorSpace:'srgb',
  outputColorSpace:'srgb', toneMapping:0, xr:{enabled:false}, debug:{checkShaderErrors:false,diagnostics:{keywords:true}},
  getUniformBufferLimit:()=>65536, hasFeature:()=>false, isOutputTarget:false, logarithmicDepthBuffer:false,
  reverseDepth:false, highPrecision:false }; }
function buildShaders(Builder, mesh) { const b = new Builder(mesh, stubRenderer()); b.scene = new THREE.Scene();
  b.camera = new THREE.PerspectiveCamera(); b.context.material = mesh.material; b.material = mesh.material;
  b.build(); return { vertex: b.vertexShader, fragment: b.fragmentShader }; }
```
Per part × backend × tier (High + Minimal): spy console.warn/error during build → must be empty; no throw; WGSL has `@vertex/@fragment`, GLSL `void main()`; each stage < 48 KB; no equal-edge `smoothstep(c,c,…)` (hard WGSL error); no `mx_\w+`; layout'd helper Fns (`fn <prefix>_name`) emitted once. It does not run Tint/driver compile. Serenity Warp's doc claims this was done ad hoc ("built in Node for both backends … at every change") but no committed serenity-warp-shaders test exists — write `tests/unit/<id>-shaders.test.js`.

## 5. Visual validators: requirements and whether they run here

- **Electron**: `ls node_modules/electron/dist` → "No such file or directory" (node_modules/electron has only cli.js, index.js, install.js, checksums.json…; package.json pins `electron ^38.8.6` = Chromium 140). Not downloaded (`--ignore-scripts`); could be fetched with `node node_modules/electron/install.js`, but per gpu-validation.yml and capture-breathing-headless.mjs:1-6 Linux cloud containers can't give Electron a GPU/shm. Treat every `node scripts/run-electron.mjs …` / `electron` script as **not runnable here**.
- **scripts/validate-all-themes.mjs** (`npm run capture:themes`): registry-driven, builds prod bundle, `vite preview` on 4174, one fresh **Electron** process per theme running scripts/capture-theme-screenshots.mjs (URL `/?skipIntro=1&noThemeWarm=1&themeValidation=1&unlockAll=1&captureBust=<run>`, starts mode `single`, pauses via `modeManager.pauseCurrentMode({reason:'theme-lifecycle-validation'})`, switches anchor theme ↔ target via `themeManager.switchTheme(id, true)`, FAILURE_PATTERNS for WGSL errors, device lost, theme start failures, uncaught errors). Throws "Electron binary missing — run `node node_modules/electron/install.js` first." (line 542-543). `--list` works without Electron. **Cannot run here.**
- **scripts/validate-mobile-webgl2.mjs** + scripts/lib/mobile-webgl2-validation.mjs (`npm run validate:mobile:webgl2 -- --theme <id>`): **Playwright/Chromium, not Electron → runs here.** Isolated production theme page (navigator.gpu removed, `?forceWebGL=1&noThemeFpsCap=1`), phone 390×844 DPR 3, quality Low (render scale 0.5 → DPR ceiling 0.5), phases portrait → effects (emits `PIECE_LOCK {piece:{type:'T'},type:'T',position:{x:5,y:10},lines:0}`, `LINE_CLEAR {lineCount:4,lines:4,count:4,linesCleared:4,comboCount:5,combo:5}`, `COMBO {comboCount:5,combo:5,count:5}`) → landscape 844×390. Fails on: console errors, failed/4xx requests, GL/shader/material warnings, theme not ready/active, uniform screenshot, non-finite transforms/attributes, quality label ≠ requested, renderer heartbeat not advancing, canvas missing, DPR over ceiling, drawing buffer not following viewport×DPR, "requires WebGPU" placeholder text, and — for ids in `MOBILE_WEBGL2_NODE_IDS` (lib:14-21) — anything but `WebGPURenderer` on the WebGL2 backend with ≥1 node material. New theme: add its id to `MOBILE_WEBGL2_NODE_IDS` (and optionally `MOBILE_WEBGL2_SMOKE_IDS`, lib:6-11); expose `theme.renderer`, `theme.scene`, `theme.isActive`, a quality field (`activeQualityLevel|currentQualityLevel|currentQuality|qualityName|qualityLevel|quality` string or `getCurrentQualityLevel()`), and `resize(w,h)`.
  - **Blocker found**: Vite 5.4 treats the harness's `server.port: 0` as "default" (`startServer`: `!configPort → DEFAULT_DEV_PORT` 5173; node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:63436-63437) and vite.config.js sets `strictPort: true`, so the validator dies with "Port 5173 is already in use" whenever a dev server is up — and one IS up (pid 697, `vite --port 5173 --strictPort --host 127.0.0.1`, started with the session). Working invocation (no repo change): a Node loader hook substitutes a `vite` module whose `createServer` forces port 5188, and `VITE_CACHE_DIR` isolates the Vite cache. The three shim files (`vite-port-register.mjs`, `vite-port-hooks.mjs`, `vite-port-shim.mjs`) are printed in full in `docs/theme-concepts/PLAYBOOK.md` §5.8; save them in your session's scratchpad as `<scratchpad>/probe/`:
    ```
    P=<scratchpad>/probe
    VITE_CACHE_DIR=$P/vite-cache-mobile MOBILE_VITE_PORT=5188 \
    PLAYWRIGHT_MODULE=/opt/node22/lib/node_modules/playwright/index.mjs \
    PLAYWRIGHT_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
    node --import $P/vite-port-register.mjs scripts/validate-mobile-webgl2.mjs --theme serenity-warp --out <dir>
    ```
    → `{"id":"serenity-warp","status":"pass","backend":"WebGL2","quality":"Low","failures":[]}` in 14 s; portrait/effects/landscape PNGs looked correct. Add `--quality Minimal` for the second pass siblings record.
- **scripts/theme-lifecycle-audit.mjs** / **scripts/palette-guideline-check.mjs**: pure Node, run here (see §1/§2).
- chrome-devtools MCP (CLAUDE.md's screenshot loop) **failed to connect** in the cloud container ("Executable not found in $PATH: cmd" — Windows config). Substitute Playwright.

## 6. Booting the real game into a theme (headless Chromium, verified)

`src/ui/url-parameters/theme-parameters.js` is documentation only ("This is documentation, not a flag reader", line 1): it catalogues per-theme readers (`<prefix>ForceWebGL|Time|FixedDt|Parts|FalseColor` from the `captureThemes` table, :64-185; global `forceWebGL`, `noThemeFpsCap`, `themeValidation`). General startup flags live in `src/ui/url-parameters/general-parameters.js:76-130`: `unlockAll=1` (exactly "1"; src/themes/theme-collection.js:13; every theme + song selectable, nothing saved), `skipIntro=1` (exactly "1"; src/main.js:4990), `noThemeWarm=1`. **There is no `?theme=` URL pin.** Two working ways (both verified here):
1. Pin via saved settings before load: `localStorage['serenityBlocksSettings'] = JSON.stringify({backgroundMode:'Specific', backgroundTheme:'<id>'})` (Playwright `addInitScript`) + `?skipIntro=1&unlockAll=1` → `loadInitialTheme()` (main.js:2532-2541, deferred ~1 s idle task) activates it; probe showed `activeThemeName === 'serenity-warp'` within 4 s of managers ready. Without `unlockAll=1`, `sanitizeCollectionThemeSetting` (src/ui/theme-collection-integration.js:6-21) resets an unowned theme to forest.
2. Drive it: wait `window.serenityBlocks?.themeManager && window.serenityBlocks?.gameModeManager` (main.js:5201), `window.dispatchEvent(new CustomEvent('startGameWithMode',{detail:{mode:'single'}}))`, wait `gameModeManager.getCurrentMode()?.isRunning`, `await window.serenityBlocks.themeManager.switchTheme('<id>', true)`; optional freeze `gameModeManager.pauseCurrentMode({reason:'…'})`. Inject reactions with `const {eventBus, EVENTS} = await import('/src/events/event-bus.js')` (same module instance on the dev server, as the mobile harness does) or real keys (`page.keyboard.press('Space')` hard drop).

Chromium launch flags (from scripts/capture-breathing-ingame.mjs:47-50):
- WebGPU on SwiftShader: `--enable-unsafe-webgpu --enable-features=Vulkan --use-vulkan=swiftshader --use-webgpu-adapter=swiftshader --use-angle=swiftshader --ignore-gpu-blocklist` (adapter probe: vendor google / arch swiftshader, device OK; WebGPU needs a secure context — http://127.0.0.1/localhost, not data:).
- WebGL2 backend: `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist` + `&forceWebGL=1`.
- Harness-only shim (capture-breathing-ingame.mjs:63-74): wrap `GPUTexture.prototype.createView` to drop a string `swizzle` (this Chromium 141.0.7390.37 predates it). Block HMR reloads with `page.routeWebSocket(/.*/, () => {})`. Filter noise `/vite\]|GL Driver Message|WebGPU Context Provider|ReadPixels|Automatic fallback/`.
- Reusable probe (kept outside the repo): the survey's `game-probe.mjs`, whose successor `game.mjs` is printed in full in `docs/theme-concepts/PLAYBOOK.md` §5.4 (`node <scratchpad>/tools/game.mjs --theme=<id> [--backend=webgl2] --settle=15000 --out=<dir>`), writes `menu-<id>.png`, `game-<id>-<backend>.png`, prints filtered console problems. Timings: page load 1 s, managers ready 8-15 s, single mode 10-22 s, screenshot after settle at 35-48 s total.
- Results: serenity-warp **WebGL2 clean** (wormhole, glass pieces, stars; 0 problems). solar-eclipse **WebGPU clean** (1 warning: `THREE.Clock … deprecated, use THREE.Timer` — new theme should use `THREE.Timer`). serenity-warp **WebGPU on SwiftShader: per-frame GPUValidationError** "TextureViewDimension::e2D … not compatible with TextureDimension::e3D of [Texture "serenity-warp-gas"]" (a `THREE.Data3DTexture` sampled with `texture3D`, serenity-warp-tsl.js:266-267,510) and the sky did not draw. Cause unverified (Chromium 141 vs Electron 38/Chromium 140 on hardware, which the sibling doc reports clean). Lesson for the new theme: avoid 3D textures or verify them on the headless WebGPU lane; always prove both backends.
- Playground (CLAUDE.md loop): dev server already at http://127.0.0.1:5173 → `/playground.html?effect=<id>&t=<s>&quality=High[&forceWebGL=1&orbit=0&hud=0]`, wait `window.__PLAYGROUND_READY__ === true || window.__PLAYGROUND_ERROR__`; API `window.__PLAYGROUND__.setTime/setEffect/backend()`. scripts/playground-capture.mjs and playground-phase-capture.mjs are Electron-only; scripts/capture-breathing-headless.mjs is the headless template (breathing-specific).
- **Do not start a second Vite on the shared cache**: vite.config.js:78-83 — two Vite instances sharing `node_modules/.vite` corrupt the dep optimizer (playground hangs on 504s). Reuse the 5173 server, or set `VITE_CACHE_DIR=<scratch dir>` for any extra server. (The survey briefly ran one on 5199 without it; `.vite/deps` mtime 20:01 unchanged; stopped; 5173 still serves 200.)

## 7. Verification command lists

### Minimal (every commit; ~2-3 min plus lint)
```
npm run typecheck
npx vitest run tests/unit/<id>- tests/unit/theme-registry-lifecycle-acceptance.test.js \
  tests/unit/theme-music-catalog.test.js tests/unit/odyssey-unique-themes.test.js \
  tests/unit/url-parameter-catalog.test.js tests/unit/dual-state-theme-tripwire.test.js \
  tests/unit/mobile-webgl2-validation.test.js tests/unit/odyssey-save-migration.test.js \
  tests/unit/theme-music-preferences.test.js tests/unit/theme-collection.test.js \
  tests/unit/development-collection-access.test.js tests/unit/theme-container-registry.test.js \
  tests/unit/theme-capture-orchestrator.test.js tests/unit/murmuration-rename-migration.test.js \
  tests/unit/odyssey-difficulty-balance.test.js tests/unit/theme-lifecycle-audit.test.js
npm run audit:theme-lifecycle && npm run check:palette && npm run check:boundaries
node scripts/architecture-fitness-check.mjs
npx eslint src/themes/<id> --ext .js        # aim for 0 errors in new files
```
(`git add` new files before trusting dual-state-theme-tripwire — it scans tracked files only.)

### Full (= pages.yml + precedent extras; ~12 min)
```
npm run typecheck                       # 5.5 s
node scripts/ts-ratchet-check.mjs       # 0.2 s
npm run lint:ci                         # ~91 s, errors ≤ 807 (now 610)
node scripts/architecture-fitness-check.mjs   # main/OdysseyMode line ceilings at limit
npm run audit:theme-lifecycle           # 3.8 s
npm run check:boundaries                # 7 s
npm test                                # ~8.2 min, 817 files / 15 506 tests today
npm run perf:budgets:gate               # 0.3 s
npm run check:release-gates             # 1.5 s
npm run check:palette                   # not CI, precedent
npm run build                           # 40 s, includes check-boot-closure
npm run check:ip-strings                # after build
npm run check:pages-artifact            # after build
rm -rf dist                             # optional tidy (gitignored)
# visual proof (ADR-0007: no WebGPU/TSL change is done without a screenshot + clean console)
#   playground: /playground.html?effect=<id>&t=..&quality=High  (+ &forceWebGL=1), WebGPU + WebGL2
#   real game : game.mjs --theme=<id>  and  --backend=webgl2  (skipIntro=1&unlockAll=1; PLAYBOOK §5.4)
#   switch-away: switch-away.mjs --theme=<id> --to=forest, both backends (PLAYBOOK §5.5)
#   phone     : validate-mobile-webgl2 --theme <id> (Low, then --quality Minimal) via the port shim (PLAYBOOK §5.8)
#   NOT available here: validate-all-themes.mjs (Electron), Electron playground captures, chrome-devtools MCP
```

# Rendering Architecture Evidence Report — Themes, Odyssey, Device Loss, Perf Policy (Plan Phases 4 & 7)

*Verified against the working tree on 2026-07-02 (branch `cleanup/repository-files`, clean status). All counts measured with grep/wc, not estimated. Grep-based counts are directory-level and ±a few percent where noted.*

---

## 1. Corrected file locations (the plan and task briefs cite wrong paths)

| Artifact | Actual path | Notes |
|---|---|---|
| GPU resilience module | `src/utils/gpu-context-resilience.js` (132 lines) | Not `src/rendering/` |
| Theme registry | `src/themes/theme-registry.js` (504 lines) | Not `src/rendering/` |
| Theme manager (LRU/lifecycle) | `src/themes/theme-manager.js` (1,071 lines) | |
| Perf policy | `src/utils/desktop-performance-policy.js` (302 lines) | Not `src/rendering/` |
| Local MP mode | `src/core/game-modes/LocalMultiplayerMode.js` (4,262 lines) | Not `src/modes/` |
| TSL construction test | `src/rendering/odyssey/__tests__/webgpu-tsl-build.test.js` | |

Any plan rewrite should pin these paths; two independent documents have now mis-cited them.

---

## 2. Theme material census (measured 2026-07-02)

- **Raw `new THREE.ShaderMaterial` src-wide: 392 constructions in 54 files** (review said ~390/~53 — still accurate). Of these, **374 in 49 files under `src/themes/`**.
- **The 5 non-theme ShaderMaterial files:** `src/rendering/transitions/WarpTransitionRenderer.js` (descoped in plan 7.1), plus **four UI-effect files the plan never mentions**: `src/ui/threejs-intro-renderer.js`, `src/ui/effects/CosmicExplorationEffect.js`, `src/ui/effects/CosmicParticleSystem.js`, `src/ui/effects/threejs-breathing-renderer.js`. Phase 7.1's descope list is incomplete — without an explicit disposition for these four, the exit criterion "mixed-set allowlist is empty" is unmeasurable.
- **Theme registry now has 62 entries** (`grep -c "id: '" src/themes/theme-registry.js` = 62; review said 61). `HEAVY_GPU_THEME_IDS` contains **48 ids** (`theme-registry.js:438-487`).
- **30 theme directories construct a `WebGPURenderer`** (up from ~25 at review time; new: `bioluminescence-2`, `summer`, `starlight`, `halcyon-apex`, `sky-children-v2`, `electric-dreams-v3`, …).
- **Dual-state set (WebGPURenderer + raw ShaderMaterial in the same theme dir): exactly 19 themes** — `astral-weave, black-hole, chiral-gold, chromadelic-highway, cosmic-noir, electric-dreams, fluid-dreams, ice-temple, lunara, moonlit-forest, neon-district, neon-dusk, ocean, stellar-drift, stellar-velocity, swedish-forest, synthwave-sunset, winter, wolfhour`. Plan's "~16–20" bracket holds, but the list is now concrete and should be committed as the Phase 3c allowlist.
- **WebGPU-clean themes (WebGPURenderer, zero raw ShaderMaterial): 11** — `tornado` (TS), `sky-children-v2`, `bioluminescence-2`, `summer`, `starlight`, `halcyon-apex`, `electric-dreams-v3`, `shifting-sands`, `verdant-hills`, `himalayan-peak`, `pyrestorm-v2`.
- **WebGL-only themes (plain `WebGLRenderer` + ShaderMaterial, no WebGPURenderer): 21** — `aurora, bioluminescence, blood-moon, cinder-drift, crystal-cave, fall, galaxy, geode, luminous-tides, misty-lake, moonrise-summit, nimbus-veil, pyrestorm, rainy-window, sakura-twilight, singing-bowl, solar-eclipse, stillwater, sunset, supernova, waves` (~176 ShaderMaterial constructions total; heaviest: misty-lake 22, stillwater 17, pyrestorm 16).

### 2.1 The plan's central Phase 7 premise is wrong today

Plan 7.2 (and review §2.5/§3.3) describes the dual-state themes as "build a `WebGPURenderer` *and* raw `ShaderMaterial`s — **survive only via silent WebGL2 fallback**". **Measured reality: all 19 are deliberately backend-gated dual-render-path themes**, not silent-fallback dependents:

- Every one of the 19 has heavy `isWebGPU` branching (16–95 refs/theme) *and* substantial NodeMaterial usage (5–133 refs/theme).
- The GLSL factories are explicitly named as fallbacks: `createAuroraMaterialWebGL` / `createShockwaveMaterialWebGL` / `createSnowMaterialWebGL` / `createIceShardMaterialWebGL` (`src/themes/ice-temple/ice-temple-materials.js:50,135,187,298`).
- Material choice is a runtime ternary: `const material = this.isWebGPU ? …NodeMaterial… : …ShaderMaterial…` (`src/themes/black-hole/black-hole-theme.js:1714,1802`).
- **16 of the 19 even construct an explicit `new THREE.WebGLRenderer`** for the fallback path (only `winter`, `neon-district`, `synthwave-sunset` rely on `WebGPURenderer`'s internal WebGL2 backend).

**Consequence for the rewrite:** the "conversion" for these 19 is **not** "port GLSL to TSL" — the TSL versions already exist and are the live path on WebGPU hardware (memory-validated at Extreme for black-hole, stellar-drift, ice-temple, wolfhour, cosmic-noir). The actual work is **retiring the duplicated GLSL branch**: per theme, (1) audit that every `*WebGL` factory has a TSL twin, (2) switch the fallback strategy from hand-written GLSL-on-WebGLRenderer to *the same TSL graph on `WebGPURenderer`'s WebGL2 backend* (`forceWebGL` — the exact pattern Odyssey uses, `OdysseyBoardController.js:1267-1276`), (3) A/B screenshot WebGPU vs `?forceWebGL=1`, (4) delete the GLSL factories and the second renderer construction. The debt being paid is *dual-maintenance divergence* (every visual tweak must be made twice or the two backends drift), not fragility to a three.js fallback change. The plan's risk framing should be corrected accordingly — the themes will not "break if three tightens fallback behavior"; they will just keep costing 2× per change.

**Second consequence — Phase 7 is internally inconsistent:** 7.1 redefines done as "*no theme feeds a `WebGPURenderer` a GLSL `ShaderMaterial`*". The 21 WebGL-only themes never construct a WebGPURenderer, so **they already satisfy 7.1's definition**; 7.3 ("convert the remaining WebGL2-only themes", ~176 material ports with no existing TSL) goes far beyond it. The rewrite must either (a) narrow 7.3 to an explicit opt-in per-theme backlog with its own justification (visual parity for the perf-policy/MRT-bloom pipeline, single-codebase), or (b) widen the definition of done and own the cost. As written, 7.3 is the single largest work item in the phase and its "why" is unstated.

### 2.2 Concrete conversion recipe (worked example: `ice-temple`)

Smallest-first batch order proof case — ice-temple has only 4 GLSL materials (all in `ice-temple-materials.js`, all `*WebGL`-suffixed) and its WebGPU path is already the flagship (compute snow/shards, memory-documented 21906e0/1d63262):

1. `npm run dev:playground` → verify the 4 effects (aurora plane, shockwave, snow, ice shards) render identically under `?forceWebGL=1` using the *TSL* builders (the WebGL2 backend transpiles WGSL→GLSL through three's node system).
2. In `ice-temple-theme.js`, delete the `isWebGL` branch that selects `create*MaterialWebGL` and the explicit `new THREE.WebGLRenderer` fallback construction; always construct `WebGPURenderer` (with `forceWebGL` honored for QA).
3. Delete the local `setupRendererResilience()` override (`ice-temple-theme.js:1160-1175`) so the base-class version (`base-theme.js:884`) takes over — this folds the Camp-2→Camp-1 device-loss fix into the same theme session (see §3).
4. Delete the four `*WebGL` factories from `ice-temple-materials.js`.
5. Validate: playground screenshots at fixed `?t=` on both backends; live A/B at Extreme with `effectScale` forced to 1 (memory gotcha: the chrome-devtools MCP throttles `effectScale<0.64`, so unforced A/Bs are invalid); console clean of WGSL errors.

Batching for the 19: do the four low-count themes first (`fluid-dreams` 2, `ice-temple` 4, `moonlit-forest` 4, `stellar-velocity` 4 — the last three are also Camp-2 device-loss themes, so each session ships both fixes), then mid-size (`stellar-drift` 5, `chiral-gold` 5, `electric-dreams` 6, `synthwave-sunset` 6, `chromadelic-highway` 7, `black-hole` 8, `astral-weave` 8, `cosmic-noir` 9), then the heavy tails (`wolfhour` 15, `neon-district` 15, `lunara` 16, `neon-dusk` 16, `ocean` 20, `winter` 21, `swedish-forest` 27). One theme per session (TDR constraint, CLAUDE.md). **Abort criterion per theme:** if the TSL-on-WebGL2 rendering of any effect visibly diverges from the retired GLSL version and can't be matched in one session, keep that theme on the documented allowlist rather than shipping a regression — the tripwire test (not yet written, see §6) makes that an explicit, reviewed state.

---

## 3. Device-loss: the Camp split has shifted, and the plan under-specifies the fix

### Current membership (measured)

- **Camp 1 (routes through `gpuResilience` via `BaseTheme.setupRendererResilience`, `base-theme.js:884-903`): 7 themes** — ocean (`ocean-theme.js:1147`), cosmic-noir (`cosmic-noir-theme.js:1709`, passes `webgpuDevice` :1710), void-ember (`void-ember-theme.js:398`), **plus four new WebGPU themes that all adopted the API**: bioluminescence-2 (:177), halcyon-apex (:192), summer (:185), starlight (:285) — each passing `webgpuDevice: this.isWebGPU ? renderer.backend?.device : null`. The review's "Camp 1 = 3 themes" is stale; the convention is winning by default in new code.
- **Camp 2 (private handling, invisible to the bus): still exactly 6** — wolfhour (`wolfhour-theme.js:1368-1372`), astral-weave (`astral-weave-theme.js:706`), ice-temple (`ice-temple-theme.js:1160,1175`), stellar-velocity (`stellar-velocity-theme.js:1712,1727`), stellar-drift (`stellar-drift-theme.js:1550,1562`), moonlit-forest (`moonlit-forest-theme.js:2143,2157`). Crucial mechanism the plan misses: **four of the six *shadow the base-class method by name*** (they define their own zero-arg `setupRendererResilience()`), so the fix is largely *deleting the override* and passing callbacks to the base call. Also: **stellar-drift's "Camp 2" handler is more capable than the plan implies** — it registers WebGPU `device.lost` and `renderer.onDeviceLost` locally (`stellar-drift-theme.js:1567-1577`); a naive "route through the module" must not leave both paths active (double-recovery storm risk).
- **Camp 3 (Odyssey): still zero.** `grep` for `device.lost|webglcontextlost|contextlost` across `src/rendering/odyssey/` returns **no matches**; `OdysseyBoardController.initRenderer()` (`OdysseyBoardController.js:1260-1295`) creates the WebGPURenderer, awaits `init()`, and registers nothing.
- **Camp 0 (the plan never mentions it): ~38 themes construct a Three renderer and have no device-loss handling at all.** 51 theme dirs construct a renderer (37 `new THREE.WebGLRenderer` + 30 WebGPURenderer, 16 overlap) minus Camp 1/2 ≈ 38-39. The plan's "route the 6 Camp 2 themes" fixes the *inconsistent* set but leaves the *unprotected majority* unaddressed. The cheap systemic fix: call `setupRendererResilience(renderer)` from one shared point (e.g., wherever `BaseTheme` learns about the renderer, or a `createThemeRenderer()` factory) instead of 51 per-theme call sites.

### The bus is currently write-only for losses

`EVENTS.CONTEXT_LOST` has **zero subscribers** anywhere in `src/` (`grep "on(EVENTS.CONTEXT_LOST"` = no matches). Only `CONTEXT_RESTORED` is consumed: `base-theme.js:164-181` (a real, existing recovery mechanism — stop + `createScene()` rebuild for the active theme whose `label` matches) and `performance-monitor.js:502`. The plan says "route … through `gpu-context-resilience.js` + the EventBus" but never names a consumer. **Missing design piece: WebGPU device loss has no "restored" event** — `device.lost` is terminal — so the base-theme rebuild-on-restore path *never fires for WebGPU losses*. Nothing today maps `CONTEXT_LOST{type:'webgpu'}` to a re-init. The only working WebGPU-loss recovery in the tree is void-ember's private `handleWebGPUDeviceLost()` → tear down + 2D fallback (`void-ember-theme.js:1129-1165`) — the model to generalize.

### Concrete implementation the plan should specify

1. **API shape:** keep `gpuResilience.monitorWebGL/monitorWebGPU` (`gpu-context-resilience.js:28,78` — already handles `uncapturederror` :97-107). Add one consumer, e.g. `GpuLossCoordinator`, subscribing `EVENTS.CONTEXT_LOST`: for `webgl`, rely on browser restore + the existing `CONTEXT_RESTORED` rebuild; for `webgpu`, invoke a registered per-surface recovery callback (theme: dispose renderer → re-run `createScene()`; Odyssey: below).
2. **Registration point:** themes — the base class after renderer creation; Odyssey — end of `initRenderer()` (`OdysseyBoardController.js:1284`, after `await this.renderer.init()`, when `this.renderer.backend?.device` exists; also `monitorWebGL(renderer.domElement)` for the `forceWebGL`/fallback backend).
3. **Odyssey recovery flow:** the hooks already exist — `pauseRendering()` (:2239-2248, cancels the rAF), `dispose()` (:2579), `resumeRendering()` (:2253). Handler = `pauseRendering()` → user-visible overlay → either full `dispose()` + re-init (re-uses the existing warm-up path; memory notes the whole journey is already replayed at load, so re-init cost is a known ~seconds quantity, not unbounded) → `resumeRendering()`, or route out to the menu on second failure. **Abort criterion:** if re-init on a genuinely TDR'd iGPU re-triggers loss (plausible on this dev machine), the fallback must be route-out, not retry-loop — cap recovery attempts at 1.
4. **Camp-2 conversion:** delete the 4 method-shadows + 2 raw registrations; pass their existing local behavior (`stellar-drift`'s `handleDeviceLoss`, ice-temple's cleanup) as `onDeviceLost`/`onContextLost` callbacks so behavior is preserved but the bus sees every loss.
5. **Validation:** unit-testable without a GPU (the module is DOM-light; fake `device.lost` promise). Live: `WEBGL_lose_context.loseContext()` for WebGL surfaces; `renderer.backend.device.destroy()` in the console for WebGPU. Success = every loss appears in `gpuResilience.stats` + one bus event per loss + the surface recovers or routes out; performance-monitor's restore counter increments.
6. **Perf impact:** zero steady-state (event registration only). The win is diagnostic: today a WebGPU loss in Camp 0/3 is a silent frozen canvas; memory (`winter-framing-spruces`) already documents GPU degradation episodes being mis-attributed because losses are invisible.

---

## 4. Odyssey chapter registries: the 5-list problem is confirmed — and there is a 6th list

All five hand-synced chapter-keyed structures still exist:

1. `CHAPTER_CONFIGS` — `src/core/odyssey/data/chapters.js:22` (8 chapters)
2. `LEVEL_CONFIGS` — `src/core/odyssey/data/levels.js:4894`
3. `CHAPTER_MODULE_LOADERS` — `src/rendering/odyssey/ChapterEnvironmentManager.js:28-37` (8 entries)
4. `CHAPTER_EXPORT_NAMES` — `ChapterEnvironmentManager.js:43-84` (8 entries)
5. `ODYSSEY_CHAPTER_PROFILES` — `src/rendering/odyssey/chapter-environments/shared/chapter-profile.js:85` (frozen array, pinned to length 8 by `OdysseyDirector.test.js:24`)

The orphaned `CHAPTER_ENVIRONMENTS` map is gone, replaced by an explicit do-not-re-add note (`chapter-environments/index.js:43-49`) — Phase 2 delta accurate. A *derived* `CHAPTER_ENVIRONMENTS_BY_ID` (`ChapterEnvironmentManager.js:87-91`) is fine (computed, not hand-synced).

**What the plan misses:**

- **A 6th hand-synced list exists and has already drifted:** `SCENES` in `scripts/odyssey-webgpu-validation.mjs:29-32` lists 7 chapters + 3 systems — **`surface-world` (chapter 3) is missing**, so the GPU gate the plan wants to wire into CI silently never validates chapter 3. Consolidation should make the validation script derive its scene list from the registry.
- **Boundary conflict the plan's own fitness rules create:** Phase 3d forbids DOM/UI imports from `src/core/**`, but lists 3-5 are rendering-side (dynamic `import()` of TSL modules) while 1-2 are core data consumed by `src/ui/odyssey/*` and `difficulty-model.js`. A single literal `CHAPTER_REGISTRY` object holding loaders would drag rendering imports into core. **Concrete design:** keep `CHAPTER_CONFIGS` as the core id/name/levelRange truth; collapse lists 3+4+5 into one rendering-side map keyed by chapter id (loaders + export names are derivable from one string via the existing naming convention, e.g. `earth-core` → `EARTH_CORE_CONFIG`/`createEarthCoreEnvironment`); add a vitest asserting id-set equality between the core list and the rendering map (extend the existing pin in `OdysseyDirector.test.js:24-65`, which already covers profiles↔configs).
- Consolidation should also resolve the memory-documented fact that the difficulty curve inside `chapters.js` is dead data (live difficulty derives from `levels.js` PHASE2_TAGS via `difficulty-model.js:75`) — a registry rewrite that faithfully copies dead fields re-launders false signal.
- **Success metric:** "adding a chapter touches one registry" → make it testable: a fitness check that greps for new `case`/object-literal chapter keys outside the registry file.

---

## 5. Local-MP context explosion: verified, and the plan misses that the fix already half-exists

- Live path: `_createSeparatePhaserGames()` (`LocalMultiplayerMode.js:2152`) loops `for (let i = 1; i <= numPlayers; i++)` (:2214) constructing **`new Phaser.Game(...)` per player at :2217** (up to 4), each `type: Phaser.WEBGL` (:2196) with per-player `Scale.FIT` containers. The review's line refs (2214-2217) are still valid.
- **The plan's proposed alternative already exists in the same file:** `_ensureMultiplayerBoardScenes()` (:1992-2064) runs N `MultiplayerBoardScene` instances **inside the single main `phaserGame`** with explicit per-player viewport rects (:2028-2046). The scene class (`src/rendering/phaser/multiplayer/board-panel.js:49`, "Handles dual viewport rendering", `init()` takes `{playerId, viewport, playerLabel}` :86-96) extends the shared `BaseBoardScene` factory (`src/rendering/phaser/base-board-scene.js:23`). So **one-context-N-viewports is not a hypothesis to validate — it is the dormant legacy path**; the question for the rewrite is *why the code moved away from it* (evidence points to DOM-driven layout: per-player container divs + CSS variables + `Scale.FIT` per game + per-canvas `BoardJuice` init at :2253) and whether those reasons still hold.
- **Concrete step the plan should state:** rather than a fresh viewport design, *resurrect and finish* `_ensureMultiplayerBoardScenes` for N≤4: one canvas spanning the board area, per-scene camera viewports, per-camera zoom replacing per-game FIT, and a decision for `BoardJuice` (per-viewport shake vs per-canvas). Cheaper interim (also already in the plan as an "or"): destroy the idle main-board game during local MP — that alone removes one context.
- **Quantified win:** 4-player local MP today ≈ 6 GL contexts (main Phaser + 4 players + WebGL1 background); after: 2 (+1 if a Three theme is active). Each Phaser.Game carries its own rAF, texture atlases, and pipelines — this is the resize-storm and near-16-context-cap scenario, and each `new Phaser.Game` boot also costs the `await 100ms` handshake per player (:2220).
- **Abort criterion:** if viewport cameras cannot reproduce `Scale.FIT` sharpness on mixed-DPI setups within a timebox, ship the "destroy main board first" mitigation and keep separate games — contexts 6→5, still bounded.

---

## 6. Quality gates: what exists vs what Phase 3c/7 assumes

- **CI today** (`.github/workflows/pages.yml`): `test` job = hard `npm run typecheck` (:31), soft lint via `continue-on-error: true` (:36-37), hard `npm test` (:38); `build` `needs: test` (:41); deploy on push. Matches the plan's delta table. **No GPU/WGSL gate is wired.** Test suite has grown to **95 `*.test.js` files** (review: 67).
- **`scripts/odyssey-webgpu-validation.mjs` (100 lines) is Electron-based** (`import electron`, BrowserWindow, run via `scripts/run-electron.mjs`; `package.json` → `validate:odyssey:webgpu`). CI-readiness gaps the plan does not surface: (1) on a hosted Linux runner it needs `xvfb` plus Chromium software-WebGPU flags (`--enable-unsafe-webgpu`, SwiftShader/Dawn adapter) that the script does not set; (2) **the script never asserts which backend actually initialized** — if WebGPU silently falls back to WebGL2 on the runner, the "WebGPU" gate green-lights without compiling any WGSL; (3) a fixed `await delay(2500)` per scene (:75) will be too short under software rasterization — it needs a readiness signal (the playground's `__PLAYGROUND_READY__` contract is the in-repo model, `src/playground/README.md:75-80`); (4) screenshots are captured (:77-78) but nothing diffs them — the artifact exists, the assertion doesn't; (5) the hand-synced `SCENES` list omits chapter 3 (§4). **Suggested abort-criterion for 3c:** timebox software-WebGPU-in-Electron to two sessions; if Dawn/SwiftShader won't initialize, ship the `ODYSSEY_FORCE_WEBGL=1` leg in CI (the WebGL2 backend still compiles the same TSL graphs and catches most graph errors) and keep the WebGPU leg as a documented local pre-release step.
- **The Phase 3c tripwire test does not exist.** No test asserts the dual-state allowlist (`grep ShaderMaterial tests/` hits only 3 old per-theme phase tests). This report's §2 lists are the committed baseline it needs; the check is a ~30-line static grep test and should land *before* the first 7.2 conversion so the set can only shrink.
- **Playground harness is real and matches its README contract:** `src/playground/` (main.js, reference-overlay.js, 31 `*.effect.js`), deterministic `?t=`, `?forceWebGL=1`, `__PLAYGROUND_READY__`. Phase 7.2's "playground-first" instruction is well-supported by tooling; what's missing is a *per-theme validation artifact convention* (7.4 mentions "screenshot artifact path" — define it as e.g. `artifacts/themes/<id>/{webgpu,webgl2}.png`, mirroring `artifacts/odyssey/webgpu-validation/`).

---

## 7. Resize listeners & perf policy

- **Measured: 61 `addEventListener('resize'` across 60 files in `src/`** (46 of them in `src/themes/`), plus 6 `visibilitychange`. The plan's "~69 listeners across 66 files" is slightly stale but directionally right. **No resize event exists on the bus** (`event-bus.js` has no RESIZE constant), so Phase 4's broadcaster is genuinely unbuilt. Implementation note the plan lacks: since 46/61 are in themes, wiring the broadcaster into `BaseTheme` (subscribe once, call the theme's existing `resize(w,h)`) converts the migration into deleting per-theme listeners incrementally — no big-bang. Perf win is measurable: count `renderer.setSize` calls during a scripted 2-second window drag before/after.
- **`desktop-performance-policy.js` is healthy and unchanged in shape:** 6 tiers (`QUALITY_ORDER` :3) × 7 surfaces (`DEFAULT_PIXEL_RATIO_CAPS` :16-24, per-tier matrix :26-72, odyssey deliberately lowest), adaptive render-scale 0.5-1.25 with hysteresis (:4-8), frame targets `[60,120,144,240]` (:74). The plan barely engages with it; the one interaction worth stating in Phase 7.4: converted themes must keep routing size through `computeScenePixelRatio` (as `base-theme.js:8` and `OdysseyBoardController.js:1261` do) and honor the `shouldRenderFrame` background gate that the 2026-07 perf passes just retrofitted onto every heavy theme — a conversion that reconstructs a renderer without these re-opens closed perf bugs.
- **Theme LRU interplay (missing from Phase 7):** `theme-manager.js` evicts by LRU (`:159`, `evictOldThemeIfNeeded` :250, lifecycle timeout 10s :12). Conversions that add compute pipelines (the pattern in ice-temple/stellar-drift) must dispose them in `stop()` or eviction leaks GPU memory that `disposeThreeJSGroup` cannot see. Add "compute/storage buffers disposed on stop" to the 7.4 contract.
- **Container generation (Phase 2 leftover) is still open:** `chiral-gold` still self-creates its DOM container (`chiral-gold-theme.js:840-842`) and `theme-registry.js` contains no container code.

## 8. Delta-table spot-checks (staleness audit)

- `ffa-p2p-game-state.js` = **5,116 lines** — the 2026-07-01 delta figure is still exact (`src/core/multiplayer/ffa-p2p-game-state.js`).
- `OdysseyBoardController.js` = 2,656 lines; `ChapterEnvironmentManager.js` = 1,590; `LocalMultiplayerMode.js` = 4,262.
- Odyssey tree remains raw-ShaderMaterial-free (the dead nebula material is gone) — Phase 2 exit criterion holds.

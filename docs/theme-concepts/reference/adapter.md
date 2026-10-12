# Theme adapter and lifecycle contract: porting guide (serenity-warp → new id)

> **Snapshot taken at commit 5d3478d (main, 2026-10-11) during the Rainbark design; line numbers drift, verify against the current code.**
>
> Part of `docs/theme-concepts/`: the index is [`../README.md`](../README.md) and the shared build procedure is [`../PLAYBOOK.md`](../PLAYBOOK.md). PLAYBOOK wins where the two disagree; it was written later and folds in what the Rainbark build learned.
>
> This survey was written while choosing a replacement for `cosmic-chimes`. That replacement happened in `585ab55` (Cosmic Chimes → Rainbark), so `cosmic-chimes` no longer exists outside the `RETIRED_THEME_IDS` alias, the frozen V2 save table and dated records. Read every "cosmic-chimes", "Cosmic Chimes" or "the old theme" below as "the theme being replaced" (`OLD_ID` in PLAYBOOK), with the Cosmic Chimes → Rainbark change as the worked example. To choose the theme a new concept replaces, see PLAYBOOK §1 "Choosing a slot".
>
> Since this survey, PLAYBOOK §5.7 and `reference/rendering.md` §4 make a hard rule of what §6e only hints at: no `Data3DTexture`, `texture3D` or `lut3D` in a new theme (3D textures fail WebGPU validation on the cloud container's SwiftShader). Bake 2D noise, or use the Void Ember 2D-lattice trick.

I read these in full: `src/themes/serenity-warp/serenity-warp-{theme,director,composition,quality}.js`, `src/themes/base-theme.js`, `src/themes/theme-frame-pacer.js`, and the relevant parts of `theme-manager.js`, `theme-registry.js`, `serenity-warp-{world,post,core,pieces}.js`, `solar-eclipse-theme.js` and `sunset-theme.js`, plus their directors, compositions and quality modules. I also read the tests and catalogs that pin the adapter (`tests/unit/serenity-warp-theme.test.js`, `tests/unit/url-parameter-catalog.test.js`, `src/ui/url-parameters/theme-parameters.js`, `scripts/lib/mobile-webgl2-validation.mjs`).

**Key finding:** the three latest masterpiece adapters (serenity-warp, solar-eclipse, sunset) are about 740 lines each. Once you swap the names, the same file appears three times. A normalized diff of serenity-warp against solar-eclipse/sunset shows only these differences:
- header comment
- `LOG_PREFIX`
- `CLEAR_COLOR`
- whether the world gets `renderer`
- the clock-carry policy across a rebuild

The directors are about 95% identical, the compositions are identical (solar-eclipse) or a superset (sunset), and the quality modules share the same shape. **So clone the adapter, the director and the composition. Rewrite only the world, post, core, tsl, quality values, piece palette and the content modules.**

---

## 1. Full lifecycle: exact call graph

### 1a. Discovery and load (ThemeManager)
- `ThemeManager.initializeRegistry()` (theme-manager.js:161) runs `import.meta.glob('./**/*-theme.js')`. It maps each `THEME_REGISTRY` entry's `module` (for example `'./serenity-warp/serenity-warp-theme.js'`) to a lazy importer. **The file must be named `<id>/<id>-theme.js` and `export default` the class.**
- `loadTheme(name)` (658) leads to `loadThemeCandidate` (687):
  - a dynamic import with a timeout: 10 s, or 20 s for `performanceClass:'heavy'` (`getThemeLifecycleTimeout`, 223)
  - `new ThemeClass()` (732), with no constructor arguments
  - `themeInstance.resourceProfile = getThemeMeta(name).resourceProfile` (733)
  - `await themeInstance.init()` (744; BaseTheme's version is a no-op)
  - an identity check that `themeInstance.name === themeName` (777). **So the value passed to `super(THEME_ID)` must equal the registry id.**
  - then the instance enters the LRU cache (cap 2, or 1 on packaged-Windows startup or safe mode).

### 1b. Start: visible activation
`activateThemeInstance(inst, name)` (1163):
1. Disposes the previous active theme (terminal, `cleanup()`).
2. Calls `ensureThemeContainer(name)` (registry 551). This reuses a static `<div id="<id>-theme" class="theme-container">` from index.html, or creates a fixed div with z-index:-1 and marks it `data-theme-registry-owned="true"`.
3. Sets `inst._prewarmHidden=false` (1226).
4. Calls `withTimeout(inst.start(this.webglRenderer, {assetManager, audioManager, onRuntimeFailure}))` (1233).
5. Sets `activeTheme`, then emits `EVENTS.THEME_CHANGED {themeName}`.

`BaseTheme.start()` (142) serializes per instance (`_startInFlight`, latest request wins). It then calls `runStartAttempt()` (189):
- If the theme is active or paused, it calls `stop()` and then `releaseManagedGpuResources()`.
- `++lifecycleGeneration` gives `startGeneration`. It sets `isActive=true` and `lifecycleState='starting'`.
- It activates the container: adds `.active` and removes it from every other `.theme-container`. During a hidden prewarm it removes `.active` instead.
- It calls `webglRenderer.loadTheme(name)` on the shared legacy renderer. This is irrelevant to the node themes.
- It subscribes once to `EVENTS.CONTEXT_RESTORED` (`_contextRestoreUnsub`).
- It calls `await this.createScene(startGeneration)`.
  - If that throws and the start was cancelled: `retireStaleStartResources()` and return `false`.
  - If it throws on the current attempt: retire, set `lifecycleState='failed'` and rethrow. The manager then disposes the theme and falls back to forest.
- On success it sets `hasStarted=true` and `lifecycleState='running'`.

### 1c. Start: boot prewarm (hidden)
`ThemeManager.prewarmTheme(name)` (1533) runs only from the suspended menu. It is called from main.js:2710 with `isThemeBusy: getStartupThemeBusyState`.
1. Sets `theme._prewarmHidden=true` (1593).
2. Calls `beginAsyncRenderPipelines(theme)`, an async-pipeline session per ADR-0020. The theme's renderer is adopted because `initializeRendererCandidate` calls `adoptRendererForTheme` (base-theme.js:790).
3. Calls `ensureThemeContainer` and `theme.start(...)`.
4. Waits until `theme.scene.children.length` holds stable:
   - async path: 30 frames plus `session.isQuiet(12)` plus not busy
   - legacy path: 45 frames, then 30 post-warm frames and a bare `renderer.compileAsync(theme.scene, theme.camera)` (1709)
5. Parks the theme with `theme.pause()` (1778), so `pendingThemeInstance=theme`.
6. The real entry then comes through `resumeThemes()` and the quick-resume path (1992): `theme.resume()`, then `theme.restartRenderLoop()` (2021), then `_ensureThemeRendering` (2062). That last step wraps `renderer.render`/`renderAsync` for 700 ms. If nothing renders it rebuilds via `activateThemeInstance`.

Consequences for the port:
- The world must be **fully in `scene` after `createScene` resolves**, so the children count is stable.
- `usesMrtScenePass()` must be truthful: false for a single-output pass.
- `getWarmupRoots()` returns `[]` if nothing is parked at `visible=false`.
- The busy-state probe reads `buildingLoadPromise`, `isCreatingScene`, `isPrewarming` and similar fields (boot-warp-startup.js:363). Serenity-warp sets none of them because it does no async loading. Keep it that way: no textures or models fetched, everything baked on the CPU.

### 1d. `createScene(ownerGeneration)` in serenity-warp-theme.js:195–286
```
container = getElementById(`${this.name}-theme`)        // throw if missing
disposeRuntime(); generation = ++runtimeGeneration
isCurrent = () => generation===runtimeGeneration && ownerGeneration===lifecycleGeneration && isActive && !cleanupComplete
container.replaceChildren(); flags = readFlags()
quality = pendingQuality ?? normalizeQuality(readSetting(null,'effectQuality')); pendingQuality=null
renderer = await createRenderer(ownerGeneration)        // null = cancelled -> return
if !isCurrent(): disposeRenderer(renderer,{nullInstance:false}); return
renderer.setClearColor(CLEAR_COLOR,1); toneMapping=NoToneMapping; outputColorSpace=SRGBColorSpace
canvas css 'position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none', aria-hidden
container.appendChild(canvas); setupGpuResilience()
scene=new Scene(); camera=new PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far)
try { world=new XWorld({scene,quality,capture: flags.time!==null||flags.fixedDt!==null, renderer}); world.build();
      world.bindCamera(camera); if(flags.parts) world.showOnlyParts(flags.parts); setupPost() }
catch(e){ if current disposeRuntime(); throw e }        // -> start() rejects -> manager falls back
if !isCurrent() return
combos.clear(); director=new XDirector({sink:{lock,clear,combo->reportCombo,levelUp->{this.level=..;world.levelUp}}})
appliedSize=null; resize(w,h); applyReactionSettings(null); setupEvents(); layout={applied:null,live:false,strength:0}; modeManager=null
if(flags.time!==null) time=flags.time   // clock NOT reset (rebuild-in-place keeps it)
scheduleLayoutReads(); world.seek(time); if(level>1) world.levelUp(level,{silent:true})
world.updateCamera(camera, buildSim(0)); world.update(buildSim(0), camera)
if(!isPaused) animate(); console.log(`${LOG_PREFIX} Scene ready (${backend}, ${quality})`)
```

`createRenderer` (288–318):
- Builds `new THREE.WebGPURenderer({antialias:false, depth:false, alpha:false, forceWebGL, powerPreference:'high-performance'})` and initializes it through `this.initializeRendererCandidate(r, {timeoutMs: 5500, label, ownerGeneration})` (base-theme.js:732). That call bounds `init()`, rejects stale owners, adopts the renderer for the loading surface, and re-disposes it after a late settle.
- It tries WebGPU first, only when `navigator.gpu` exists and neither `this.forceWebGL` nor `flags.forceWebGL` is set. On failure it retries on the WebGL2 backend with a fresh renderer.
- It returns `null` when the start is no longer owned, and throws `'... could not initialize WebGPU or WebGL2.'` when both backends fail.

`setupPost` (338–353):
- Builds `new XPost(renderer, scene, camera, {look: POST_LOOK[quality]||POST_LOOK.High, falseColor})`.
- On a throw it falls back to `renderer.toneMapping = AgXToneMapping` with `passThrough = createPassThroughPipeline(renderer, scene, camera)`.

### 1e. Frame loop
- `animate()` (565) is guarded by `animationLoopStarted`. It calls `loop = this.safeAnimate(now => this.stepFrame(now), {maxConsecutiveErrors:3})` and then `registerAnimation(requestAnimationFrame(loop))`.
- `BaseTheme.safeAnimate` (1351): each rAF checks `if(!isActive) return`, re-registers the next rAF, and **then** calls `shouldRenderFrame()` (1290). That function returns false when `window.isRenderingPaused` or `window.isThemeCovered` is set (the breathing guide sets the latter). When `window.isRenderingReduced` is set it throttles to `reducedFrameInterval` (default 100 ms). Otherwise it applies the **frame pacer**: `shouldRenderAtTargetFps(_framePacer, performance.now(), resolveTargetFps())` (theme-frame-pacer.js).
  - `resolveTargetFps` reads `window.serenityBlocks.settingsManager.get().targetFrameRate`, floor 30, 0 meaning unlimited.
  - The pacer has a look-ahead with half-frame tolerance: 240 Hz at 60 renders every 4th frame, 144 Hz renders every 2nd frame for 72 fps, and 90 Hz renders every frame.
  - `?noThemeFpsCap=1` disables it.
  - So **`stepFrame` must compute delta from its own `lastFrameMs`**, because skipped vsyncs are invisible to it. Serenity-warp clamps the delta to `MAX_DELTA_S=0.05`.
- `stepFrame(now)` (582–628) runs in this order:
  1. wall delta; delta is 0 when `flags.time` is set and `flags.fixedDt` when that is set; then `time += delta` and `layoutClock += wall`
  2. pointer easing `approach(2.2, wall)`
  3. if `renderer.getDrawingBufferSize` changed, re-send `world.setViewport` and `post.setSize`
  4. `processLayoutReads()`
  5. `sim = buildSim(delta)`, with `{time, delta, pointerX, pointerY}` reused
  6. **`world.updateCamera(camera, sim)` → `director.flush()` → `world.update(sim, camera)`**. The camera goes first because events aim through it.
  7. `easeCalmZones(wall)`
  8. `post.update(world.getPostState()); post.update({time}); post.render()`, or `passThrough.render()`, or `renderer.render(scene, camera)`

### 1f. Resize
- `ThemeManager.resize(w,h)` (2372) forwards to the **active** theme only.
- Serenity-warp also subscribes to `EVENTS.VIEWPORT_RESIZED` (the payload carries `{width,height,dpr}`; it falls back to `getViewport()`).
- `resize(w,h)` (544–561) is deduplicated on `{w,h,pixelRatio}`. It computes `pixelRatio = this.getEffectivePixelRatio(PIXEL_RATIO_CAP[quality] ?? PIXEL_RATIO_CAP.High, 'theme')`, then runs: `camera.aspect`/`updateProjectionMatrix`, `renderer.setPixelRatio`, `renderer.setSize(w,h,false)`, `getDrawingBufferSize(bufferSize)`, `world.setViewport(bx,by,w/h)`, `post.setSize(w,h,bx,by)`, `director.setViewport(w,h)` and `scheduleLayoutReads()`.
- `resume()` re-runs `resize(getViewport())` to catch resizes missed while the theme was parked.

### 1g. Quality and settings change
- Settings arrive on two channels: bus `EVENTS.SETTINGS_CHANGED` (`{settings,source}` or `{type,value}`) and window `'settingsChanged'` (`detail` holds only the changed keys; settings.js:410).
- `readSettingUpdate(payload, key)` (110) accepts all three shapes. `readSetting` falls back to `window.settings[key]`.
- `handleSettingsChanged` (441):
  - If `effectQuality` is present and different from `pendingQuality ?? quality`: set `pendingQuality`, call `queueRebuild()` and return.
  - Otherwise call `applyReactionSettings(payload)`.
  - If `renderScale` is present: on a `queueMicrotask`, set `appliedSize=null` and call `resize(getViewport())`. The microtask defers until main.js has called `setGlobalRenderScale`; this also covers the `PERFORMANCE_DOWNSCALE` re-emit at base-theme.js:58–66.
- `queueRebuild()` (463) coalesces into one microtask and checks `scheduled === runtimeGeneration`. If the theme is paused it sets `rebuildPending=true` and rebuilds on `resume()`. Otherwise it calls `createScene()` (owner defaults to the current `lifecycleGeneration`), and a failure goes to `onRuntimeFailure(err)`. The manager replaces the runtime with a fresh identity (`handleThemeRuntimeFailure`, theme-manager.js:518).
- `applyReactionSettings` (429):
  - `reducedMotion = boolSetting(settings.reducedMotion) || matchMedia('(prefers-reduced-motion: reduce)').matches`
  - `director.configure({enabled: settings.backgroundComboEffects ?? true, lockRipple: settings.pieceLockRipple ?? true})`
  - `world.setReducedMotion()`

### 1h. Pause, visibility and resume
- Visibility in main.js:
  - `pauseAllRendering()` (1249) calls `activeTheme.pause()` and sets `window.isRenderingPaused=true`.
  - `reduceRenderingFrameRate()` (1270) calls `pause()` and sets `isRenderingReduced=true`.
  - `resumeFullRendering()` (1288) clears the flags, calls `theme.resume()` and then `requestAnimationFrame(() => theme.restartRenderLoop())`.
- Mode menus call `ThemeManager.suspendThemes()` (1818), which uses `pause()` when `allowSuspendedRuntimeReuse` is set and `stop()` otherwise; then `resumeThemes()` (1899) quick-resumes.
- `BaseTheme.pause()` (1449) cancels RAFs and setAnimationLoop, resets `animationLoopStarted=false` and `isAnimating=false`, and sets `lifecycleState='paused'`.
- The theme's `pause()` (658) adds `lastFrameMs=null`, so the delta never jumps.
- `BaseTheme.resume()` (871) reactivates the container (clearing inline opacity and visibility). The theme's `resume()` (666):
  - returns **false** (meaning: do a full restart) when world, renderer, scene or camera is missing
  - otherwise `lastFrameMs=null`, `resize(getViewport())`, `ensureModeManagerListeners()`, `scheduleLayoutReads()`, and runs a pending rebuild if one is queued.
- `restartRenderLoop()` (1480) calls `resetFramePacer` and then the first of `animate`/`startAnimationLoop`/… that exists. **Keep the method name `animate`.**

### 1i. GPU loss
- `setupGpuResilience()` (320) calls `this.setupRendererResilience(renderer, {webgpuDevice: isWebGPU ? backend.device : null})` (base-theme.js:1391), which calls `gpuResilience.monitorWebGL(canvas, {label:this.name})` plus `monitorWebGPU(device, {label:this.name})`.
- **WebGPU device lost:** `CONTEXT_LOST {type:'webgpu', label}` reaches the GpuLossCoordinator. The theme registers `registerGpuSurface(this.name, {recover})`, and **the label must equal `this.name`**. `recover()` runs once: it throws if `gpuRecoveryAttempted`, otherwise sets `gpuRecoveryAttempted=true` and `forceWebGL=true` and calls `createScene()` to rebuild in place on the WebGL2 backend. A second loss is routed out with `EXIT_TO_MAIN_MENU {reason:'gpu-loss-unrecoverable'}`.
- **WebGL2-backend context lost:** `monitorWebGL.onLost` calls `retireContextLostNodeRenderer(renderer)` (1418), which calls `pause()` and `disposeRenderer(renderer, {preserveCanvas:true})`. On restore, `CONTEXT_RESTORED {label:this.name}` triggers BaseTheme's listener (265), which calls `this.start(sharedRenderer, managers)`. That is a full restart: `stop()` first, so serenity-warp's clock resets while the level is kept.
- **Order in `disposeRuntime()` matters:** call `removeRendererResilience()` **before** `disposeRenderer()`. Disposing destroys the device, and `device.lost` would otherwise fire as a loss (gpu-context-resilience.js:91 guards on `active`).

### 1j. Stop, cleanup and dispose
- **Switching away** from a theme is terminal: `performThemeSwitch` → `disposeThemeInstance(outgoing, {removeFromCache:true})` (433) → `invalidateThemeInstanceLifecycle` (`lifecycleGeneration+1`, `'stopping'`) → `theme.cleanup()`. If `cleanupComplete` is not set afterwards, the manager runs `forceRetireThemeInstance`. **The instance is never restarted after `cleanup()`; `start()` throws.**
- Theme `cleanup()` (742) = `this.stop()` followed by `super.cleanup()`.
- `super.cleanup()` (918) sets `cleanupComplete`, calls `releaseInactiveResources()` (which is `stop()` plus `releaseManagedGpuResources()` for `'heavy-gpu'`), removes resilience and the context-restore listener, deactivates registry-owned containers without removing them, and nulls the managers, `options` and the scene.
- Theme `stop()` (734) = `super.stop()` (423: `lifecycleGeneration+1`, inactive, `'stopped'`, removes `.active`, cancels RAFs, `clearTrackedResources()`), then `disposeRuntime()`, then `this.time = 0`.
- `disposeRuntime()` (684–732) runs in this order and is idempotent:
  1. `runtimeGeneration++`, `cancelAnimationFrames`, `animationLoopStarted=false`
  2. `layoutDue.fill(Infinity)`, `modeManager=null`
  3. `clearEventUnsubscribers()`, `clearTrackedResources()`, `removeRendererResilience()`, `gpuSurfaceUnregister()`, `director=null`
  4. `post.dispose()` and `passThrough.dispose()` (try/catch)
  5. `world.dispose()` (try/catch)
  6. `scene.clear()`; null the scene and camera
  7. `disposeRenderer(renderer, {nullInstance:false})`, which quiesces timestamp queries (up to 300 ms) and disposes; then detach the canvas
  8. `isWebGPU=false`, `appliedSize=null`
- `ThemeManager.deactivateThemeRuntime` (257) calls `releaseInactiveResources()` for heavy themes and `stop()` otherwise.

### 1k. Hooks other code queries
| hook | serenity-warp value | consumer |
|---|---|---|
| `getTetrominoConfig()` | `SERENITY_WARP_TETROMINOS` | board renderers (colors, renderMode, effects, rendererOverrides) |
| `whenCriticalReady()` | `!!(world&&renderer&&scene&&camera)` | Odyssey ThemeTransitionManager.js:427, capture-theme-screenshots.mjs:790, perf lane |
| `whenFullReady()` | BaseTheme `true` | the Odyssey reveal does not block on it |
| `getWarmupRoots()` | `[]` | warm-hidden-drawables.js; only used if FX are parked `visible=false` |
| `usesMrtScenePass()` | `false` | prewarm / perf lane (a bare compileAsync is unsafe on MRT) |
| `getDiagnostics()` | `{lifecycle, backend, quality, pixelRatio, world: world.getState(), reducedMotion, droppedEvents}` | tests and diagnostics |
| `buildsPipelinesAsync` | **must be absent** (the test asserts undefined) | ADR-0020 manager session covers ordinary three themes |

---

## 2. Id-specific strings and identifiers in serenity-warp-theme.js (rename all)

| line | current | port to |
|---|---|---|
| 3 | header `SERENITY WARP` plus a doc paragraph (6–19, 33–43) | new concept text |
| 21–22 | `SerenityWarpWorld (serenity-warp-world.js)`, `src/playground/effects/serenity-warp.effect.js` | `<Pascal>World`, `<id>-world.js`, `<id>.effect.js` |
| 24 | doc `?serenityWarpForceWebGL` | `?<prefix>ForceWebGL` |
| 28–31 | doc `?serenityWarpTime=<s>`, `?serenityWarpFixedDt=<ms>`, `?serenityWarpParts=a,b`, `?serenityWarpFalseColor=1` | `<prefix>…` |
| 53 | `import { SERENITY_WARP_TETROMINOS } from './serenity-warp-tetrominos.js'` | `<UPPER>_TETROMINOS`, `./<id>-tetrominos.js` |
| 54 | `SerenityWarpWorld, REST_RIG, fovForAspect` from `./serenity-warp-world.js` | (sunset keeps `REST_RIG`/`fovForAspect` in composition but re-exports them from world) |
| 55 | `POST_LOOK, SerenityWarpPost, createPassThroughPipeline` from `./serenity-warp-post.js` | |
| 56 | `PLAYER_SLOTS, readLayoutRects` from `./serenity-warp-composition.js` | |
| 57 | `SERENITY_WARP_EVENT_HANDLERS, SerenityWarpDirector` from `./serenity-warp-director.js` | |
| 58 | `approach` from `./serenity-warp-core.js` | (the generic helper `approach=(rate,dt)=>1-Math.exp(-rate*dt)`) |
| 60 | `const THEME_ID = 'serenity-warp'` | **new id: must match the registry `id` and the folder** |
| 61 | `const LOG_PREFIX = '[Serenity Warp]'` | `'[<Display>]'` (solar uses `'[SolarEclipse]'`, sunset `'[Sunset]'`) |
| 65 | `CLEAR_COLOR = 0x02030c` | the darkest colour of the new sky (also set as the container's CSS `background`) |
| 71–78 | `PIXEL_RATIO_CAP {Minimal .7, Low .85, Medium 1, High 1.15, Ultra 1.35, Extreme 1.6}` | keep or retune (identical in solar and sunset) |
| 93 | `num('serenityWarpTime')` | `'<prefix>Time'` (**a literal string: the test greps `'${name}'`**) |
| 94 | `num('serenityWarpFixedDt')` | `'<prefix>FixedDt'` |
| 96 | `bool('forceWebGL') \|\| bool('serenityWarpForceWebGL')` | keep the generic `'forceWebGL'` and add `'<prefix>ForceWebGL'` |
| 99–100 | `params.get('serenityWarpParts')` twice (direct literal reads: the catalog AST test catches these) | `'<prefix>Parts'` |
| 102 | `bool('serenityWarpFalseColor')` | `'<prefix>FalseColor'` |
| 140 | `export default class SerenityWarpTheme extends BaseTheme` | `<Pascal>Theme` |
| 179, 409, 420 | comments: "the warp answers the longest chain", "back to rest" | rephrase |
| 190 | `return SERENITY_WARP_TETROMINOS` | |
| 196 | `` getElementById(`${this.name}-theme`) `` | derived; the DOM id becomes `<id>-theme` |
| 236 | `new SerenityWarpWorld({scene, quality, capture, renderer})` | (drop `renderer` if the world needs no env target, as in solar and sunset) |
| 254 | `new SerenityWarpDirector({sink})` | |
| 299 | label `` `Serenity Warp ${forceWebGL?'WebGL2':'WebGPU'} renderer init` `` | |
| 316 | `'Serenity Warp could not initialize WebGPU or WebGL2.'` | |
| 328 | `registerGpuSurface(this.name, …)` | derived |
| 330 | `'Serenity Warp WebGPU recovery already attempted.'` | |
| 343 | `new SerenityWarpPost(…)` | |
| 364–365 | `SERENITY_WARP_EVENT_HANDLERS` | |

**Window globals.** None are written. There are no console helpers, no `window.__*` and no localStorage (the test forbids `localStorage` and `getContext(`). Read-only globals:
- `window.location.search` (flags)
- `window.settings[key]`
- `window.serenityBlocks.gameModeManager` (516)
- `window.matchMedia`
- `window.innerWidth/innerHeight`

**Window events listened to** through `registerEventListener`: `'settingsChanged'`, `'gameOver'` (dispatched at SinglePlayerMode.js:1455 and InfinityMode.js:1892), `'pointermove'`, `'pointerleave'`, `'blur'`, and the media-query `'change'`. **Mode-manager events:** `'modeStarted'`, `'modeActivated'` (relayout) and `'modeStopped'` (`resetSession`).

**Sibling differences to choose between:**
- **Clock policy.** Serenity-warp keeps `this.time` across a rebuild in place and clears it only in `stop()`. Solar-eclipse and sunset use `this.carry = {time, level}`, set in `queueRebuild` and GPU `recover()`, consumed in createScene as `this.time = flags.time ?? carried?.time ?? 0; this.level = carried?.level ?? 1;`, and cleared in `stop()`. Both are tested. Serenity-warp's variant is simpler.
- **World construction.** Serenity-warp does `new World({…, renderer}); world.build();` in separate statements. The siblings chain `new World({…}).build()`.

---

## 3. Director: gameplay intake → sink

**Bus wiring.** `setupEvents()` (357–407) loops over `X_EVENT_HANDLERS` and calls `eventBus.on(EVENTS[key], p => { if (isActive && !isPaused) director[handler](p) })`. It also subscribes to `SETTINGS_CHANGED` and `VIEWPORT_RESIZED`. Every unsubscriber goes into `this.eventUnsubscribers`, which is cleared before re-subscribing because createScene re-runs on every rebuild.

`SERENITY_WARP_EVENT_HANDLERS` (director.js:48):
```js
{ PIECE_LOCK:'onPieceLock', HARD_DROP:'onHardDrop', LINE_CLEAR:'onLineClear', COMBO:'onCombo',
  TSPIN:'onTSpin', B2B:'onB2B', PERFECT_CLEAR:'onPerfectClear', LEVEL_UP:'onLevelUp' }
```
Payload fields each handler reads (canonical emitters in `src/events/gameplay-events.js`):

| event | fields read |
|---|---|
| all | `player` (int; 0 = solo; 1..4 = local MP), mapped to 1 of `PLAYER_SLOTS=5` slots; overflow increments `droppedEvents` |
| PIECE_LOCK `{piece, viewportOrigin?}` | `piece.color` (hex wins) / `piece.type` / `piece.shapeKey` (→ theme colour); `piece.shape` (matrix → `cellsFromMatrix`: 8 numbers, centred, y up); `piece.x`, `piece.y` (absolute rows incl. 4 hidden); `viewportOrigin{x,y}` via `readLockViewportOrigin` (Infinity mode; wins over board math). Calls `tracker.notePieceLocked()`. |
| HARD_DROP `{piece,startY,endY,distance,viewportOrigin?}` | same capture as lock; sets `hardDrop`. Fires **before** the PIECE_LOCK of the same piece, in the same tick. |
| LINE_CLEAR `{lineCount, clearedRows[], cascadeCount, comboCount?, viewportOrigin?, position?}` | lines = `lineCount` (fallback `clearedRows.length`, clamped 1..4); the widest wave in a frame names the rows (`clearedRows[i] - hiddenRows`, or `viewportOrigin.y`); `cascadeCount` (max); `comboCount` (explicit, used by meditation / Odyssey); `position{x,y}` px (meditation clicks). Calls `tracker.noteLineClear()`. |
| COMBO `{comboCount, position?}` | **cascade DEPTH, not combo (ADR-0011)**; with `position` it is a meditation click combo and forces lines ≥ 1 |
| TSPIN `{lineCount}` | `tspin=true`; raises lines |
| B2B `{active}` | `active===false` is ignored; else `b2b=true` |
| PERFECT_CLEAR `{depth, perfectClearBonus}` | `perfect=true`, lines ≥ 1 |
| LEVEL_UP `{level}` | `level` (else last + 1); staged as `levelPending` (not per slot) |

`flush()` is called once per frame between `updateCamera` and `update`. It runs `levelUp` first, then for each assigned slot the slot's lock, then its clear, then its combo:
```
sink.lock({ player, rows:[visible rows 0=top..19=floor], u: col fraction 0..1, hardDrop, color:'#hex'|null,
            shape:'I'|'O'|...|null, cells:[8 numbers]|null, screen:null })
sink.clear({ player, rows, lines 1..4, combo ≥1, cascade, tspin, perfect, b2b, screen:{x,y} fractions|null })
sink.combo(n, player)   // true consecutive-clear combo via ComboTracker; 0 = chain broke (arrives one lock late)
sink.levelUp(level)
```
The lock and clear objects are **reused**, so the sink must copy anything it keeps. A clear reaches the sink **before** the combo it raised, so read `clear.combo`. `configure({enabled:false})` calls `reset()`, which drops everything staged and sends `combo(0)` to every slot; `lockRipple:false` drops staged locks only.

**What the theme hands the world** (createScene sink, 254–264):
- `lock: c => world.onLock(c)`
- `clear: c => world.onClear(c)`
- `combo: (n,p) => reportCombo(n,p)`. `reportCombo` (410) keeps a `Map` of player → combo and calls `world.onCombo(max over players)`.
- `levelUp: lvl => { this.level = lvl; world.levelUp(lvl) }`

`resetSession()` (421) runs on window `gameOver` and on mode-manager `modeStopped`: `director.reset()`, `combos.clear()`, `level=1`, `world.resetSession()`, `scheduleLayoutReads()`.

**Director variants:** solar-eclipse and sunset lack `shape`, `cells` and `themePieceColor`; their `resolvePieceColor` reads `TETROMINOS.colors[key]`. Serenity-warp's `themePieceColor(key, table)` (67) accepts both table shapes, `{colors:{T}}` and `{T:{color}}`. The director imports only `ComboTracker` (`src/core/combo-tracker.js`), `readLockViewportOrigin` (`src/events/lock-origin.js`), `BOARD_GRID`/`PLAYER_SLOTS` (composition), the pieces and `cellsFromMatrix` (core). It is renderer-free, DOM-free and bus-free, and it is unit-tested in isolation (`tests/unit/serenity-warp-director.test.js`, 321 lines).

---

## 4. Composition API (`serenity-warp-composition.js`, CPU only, three-free; identical in solar-eclipse)

```js
BOARD_GRID   = { columns:10, rows:20, hiddenRows:4 }
PLAYER_SLOTS = 5
BOARD_SELECTOR = '.player-card[data-player]'      // gameplay cards (lobby avatar cards lack data-player)
HUD_SELECTOR   = '.single-player-stats-bar'
SOLO_CANVAS_SELECTORS = ['#phaser-game-container canvas', '#main-game-canvas', '#single-player-game-canvas']
playerCanvasSelector(p) = `#p${p}-phaser-container canvas`
fallbackLayout(W,H)  -> {cardCount:0, cards:[card], hud, boards:[solo,null×4]}  // from main.css formulas:
    board = max(120, min(max(220, min(.22W,300)), (H-250)/2)); card ≈ 1.19·board × (2·board+158); HUD 60px right of stage
readLayoutRects(doc,win) -> null | {cardCount, cards:[{x0,y0,x1,y1}], hud|null, boards:[5]}
    // screen fractions, y down; visibleRect(): >8px, on-screen, not display:none/visibility:hidden/opacity<.05
layoutsDiffer(a,b,eps=.004), boardFor(layout,player) (own canvas else first), cardUnion(layout),
boardPoint(board,u,row,out) -> {x,y} (row centre line)
```
Sunset adds `REST_RIG`, `fovForAspect`, `frameFor(aspect, layout)`, `aimLanding`, `aimLeave` and `cardFor(layout, board)`, and drops `layoutsDiffer`/`cardUnion`.

**Aspect anchors** live in core, not in composition. `gateAnchors(aspect)` (core 524) uses the smoothsteps `k = smooth(.62,.95,a)` (portrait to landscape), `roomy = smooth(1,1.6,a)` and `wide = smooth(1.5,2.3,a)`. It returns `{x,y,hFov,radius}`:
- landscape puts the focal object in the free space left of the card, at x ≈ 0.21–0.24, y ≈ 0.42
- an upright phone puts it above the card, at x = 0.5, y = 0.085
`fovForAspect(a)` (world 121) converts the anchor's `hFov` to a vertical FOV clamped to `[REST_RIG.minFov 30, maxFov 78]`.

**Layout reads on frame time, never from a handler** (`getBoundingClientRect` forces layout):
- `scheduleLayoutReads()` (489) sets `layoutDue[i] = layoutClock + [0, 0.5, 1.5]`.
- Triggers: scene build, `resize`, `resume`, `resetSession`, mode-manager `modeStarted` / `modeActivated` / `modeStopped`.
- `processLayoutReads()` (495) runs inside `stepFrame`. When any slot is due it calls `ensureModeManagerListeners()` (a late subscription to `window.serenityBlocks.gameModeManager`), then `rects = readLayoutRects()`. It keeps the last good rects in `layout.applied`, sets `layout.live = !!rects`, and calls `world.setLayout(rects)`.
- `layoutClock` advances by **wall** time, so the reads still land while a capture freezes the simulation.
- `easeCalmZones(dt)` (528) eases `strength` toward `live ? 1 : 0` at rate 3. It collects up to 4 cards plus the HUD and calls `post.setCalmRects(list, applied ? strength : 0)`. The post's output pass soft-dims inside rounded boxes (`CALM_RECTS_MAX = 5`).
- The world uses `boardFor(layout, player)` plus `boardPoint(board, u, row)` to aim lock and clear events, and `cardExit` to find where a lock leaves the card's edge.

---

## 5. Quality tiers, settings mapping, pixel ratio, mobile

**Tier module shape** (identical across siblings):
```js
export const QUALITY = Object.freeze({ Minimal:{…}, Low:{…}, Medium:{…}, High:{…}, Ultra:{…}, Extreme:{…} });
export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));
export function tierFor(q) { return QUALITY[q] || QUALITY.High; }   // solar: hasOwnProperty guard
```
- The keys are content budgets, theme-specific. Serenity-warp has `detail, warpRead, skyLayers, env, envEvery, pieces, ambient, bevel, stars, motes`; solar-eclipse has `rays, flow, fibres, faces, mist, stars, motes`; sunset has noise sizes, slices, lantern and drop counts. The convention, stated in each header: "Every tier keeps the whole picture and every event". Tiers cut detail and counts, never whole features.
- The post has its own `POST_LOOK[tier]`, with `{msaa, bloom, bloomStrength, bloomResolution, rays, rush, fringe}` in serenity-warp. Medium and lower drop MSAA; Low and Minimal drop bloom.
- The world reads `tierFor(quality)` in its constructor. **The tier is fixed per build; a tier change means a full `createScene()` rebuild.**

**Settings to tier.** Only `settings.effectQuality` matters (default `'High'`, settings.js:60). `normalizeQuality` (utils/quality.js:153) is case-insensitive over Minimal|Low|Medium|High|Ultra|Extreme; anything else, including `'Custom'` and missing, gives `'High'`. The tier is read at createScene from `window.settings`, and a change triggers `pendingQuality` plus a rebuild.

**Pixel ratio.** `BaseTheme.getEffectivePixelRatio(maxRatio, 'theme')` (1227) calls `computeScenePixelRatio` (desktop-performance-policy.js:170):
```
min(devicePixelRatio, maxRatio = theme PIXEL_RATIO_CAP[quality], policyCap.theme) × clampRenderScale(globalRenderScale)
policy theme caps by window.settings.effectQuality: Minimal .9, Low 1, Medium 1.15, High 1.25, Ultra 1.35, Extreme 1.5
```
At High the binding cap is the theme's 1.15. Extreme is limited to 1.5 by policy. `globalRenderScale` comes from the settings `renderScale`, and `PERFORMANCE_DOWNSCALE` steps it down by 0.25, to a floor of 0.5.

**Mobile and phone handling.** There is no device sniffing in the adapter. Phones are handled by:
1. The user or settings tier (Low or Minimal), plus the pixel-ratio caps above. `tests/unit/mobile-webgl2-validation.test.js` asserts the theme follows the shared `computeScenePixelRatio` policy.
2. Aspect-driven composition: `gateAnchors`/`fovForAspect` place the hero above the card when aspect < 0.62.
3. Pointer parallax ignores `pointerType==='touch'` and `isPrimary===false` and is off under reduced motion.
4. The WebGL2 backend fallback when `navigator.gpu` is missing.
5. Validation lists in `scripts/lib/mobile-webgl2-validation.mjs`: `MOBILE_WEBGL2_SMOKE_IDS` (line 6) and `MOBILE_WEBGL2_NODE_IDS` (line 14). Add the new id to NODE_IDS, and to SMOKE as serenity-warp is.

---

## 6. Recipe: cloning the adapter for a new id with minimum risk

### 6a. Generic: copy verbatim, then rename identifiers only
- `<id>-theme.js`: everything from serenity-warp-theme.js except the header and the table in §2. That covers `readFlags`, `readSettingUpdate`, `readSetting`, `boolSetting`, the constructor fields, `createScene`, `createRenderer`, `setupGpuResilience`, `setupPost`, `setupEvents`, `reportCombo`, `resetSession`, `applyReactionSettings`, `handleSettingsChanged`, `queueRebuild`, the layout methods, `resize`, `animate`, `buildSim`, `stepFrame`, the hooks, `pause`, `resume`, `disposeRuntime`, `stop` and `cleanup`. Pick serenity-warp's clock policy or the siblings' `carry` policy.
- `<id>-director.js`: copy serenity-warp's, which has the richest payload (shape and cells). Rename `SerenityWarpDirector`, `SERENITY_WARP_EVENT_HANDLERS` and `SERENITY_WARP_TETROMINOS`, and keep `cellsFromMatrix` (move it into the new core). Drop shape and cells if the world won't use them.
- `<id>-composition.js`: copy verbatim and rewrite only the header comment describing what is LEFT, BEHIND, RIGHT and ABOVE.
- `<id>-quality.js`: copy the shape and write new keys and values.
- `<id>-post.js` skeleton: `RenderPipeline` plus `pass(scene, camera, {samples})`, optional `bloom` with a custom `highPassFn`, an `outputFn` that has calm rects via `roundBoxSdf`, `outputColorTransform=false`, `update({...})`, `setCalmRects`, `setSize(w,h,bw,bh)`, `render`, `dispose` (including `disposeBloomNodeDeep`) and `createPassThroughPipeline`. Rewrite the grade and look.

### 6b. Must be rewritten (theme content)
- `<id>-world.js` must export:
  - `class <Pascal>World` with every method in `WORLD_METHODS` (test line 33): `build`, `bindCamera`, `showOnlyParts`, `setViewport(bw,bh,aspect)`, `setLayout(rects[,aspect])`, `setReducedMotion`, `seek(t)`, `resetSession`, `restCamera`, `updateCamera(camera,sim)`, `onLock(c)`, `onClear(c)`, `onCombo(n)`, `levelUp(level,{silent})`, `update(sim,camera)`, `getPostState()` (**one reused object**), `getState()` (must include `quality`) and `dispose()`
  - `REST_RIG {near>0, far>near, minFov, maxFov}`
  - `fovForAspect(aspect)` returning a value in (1, 179) for aspects 0.46 to 21/9
  - `<UPPER>_PARTS` (an array matching the URL-reference `Parts` list)
- `<id>-core.js` (constants, palettes, `approach`, anchors), `<id>-tsl.js` (TSL helpers), the content modules, `<id>-tetrominos.js` (a new palette in `{version:1, colors:{I,O,T,S,Z,J,L,GARBAGE}, renderMode, effects, rendererOverrides:{canvas,phaser}}` form), `<id>-theme-icon.png`, and `src/playground/effects/<id>.effect.js`. The effect uses the same world and post through `create({scene,camera,renderer,params})`, which returns `{camera, update, seek, render, resize, getDiagnostics, dispose}`.
- Constraints enforced by the test (serenity-warp-theme.test.js:442–486):
  - no `new …ShaderMaterial(`, no `new …WebGLRenderer(`, no `mx_*` noise, no `from 'three'` (only `'three/webgpu'` and `'three/tsl'`)
  - no absolute `'/textures|/assets|/hdri/'` paths
  - no `.wgsl`/`.glsl` files
  - no `buildsPipelinesAsync`, no `create(Render|Compute)Pipeline(Async)?(`, no `getContext(`, no `localStorage`
  - no `EffectComposer`, `UnrealBloomPass`, `ShaderPass`, `RenderPass` or `compileComputeAsync`
  - no theme props named `webgpuState`, `webglState`, `composer`, `visual`, `gameplayFx`, `reactionDirector` or `overlay`
  - every scene material is `isNodeMaterial`
  - no `TextureLoader.load` and no `fetch` in a build-and-frame run

### 6c. Wiring outside the adapter (rename surface touching the lifecycle)
1. **`src/themes/theme-registry.js:142–148`**: replace the `cosmic-chimes` entry with `{id, displayName, module:'./<id>/<id>-theme.js', icon:'./<id>/<id>-theme-icon.png', group}`. Cosmic-chimes is `group:'cosmic'`; the existing groups are abstract, atmospheric, biomes, cosmic, fantasy, meditation, sky and urban, so pick a non-cosmic one.
2. **`HEAVY_GPU_THEME_IDS` (registry 431–486): add the new id.** Cosmic-chimes is not in the set. Adding it gives `resourceProfile:'heavy-gpu'` (deep release on deactivate), `performanceClass:'heavy'` (20 s timeouts) and `startupEligible:false`.
3. **`RETIRED_THEME_IDS` (513–517): add `['cosmic-chimes', '<new-id>']`**, as was done for `electric-dreams-v3 → murmuration`. Saves, collection entries and Odyssey completions that name the old id then resolve.
4. **Container:**
   - `index.html:285–294` is a static `cosmic-chimes-theme` div with DOM children (`.chime-nebula`, `#space-dust`, `#chimes`, `#cosmic-chimes-effects`). Replace it with a bare `<div id="<id>-theme" class="theme-container"><!-- canvas added by <Pascal>Theme --></div>`, or delete it and rely on `ensureThemeContainer`'s lazy path as serenity-warp does.
   - `public/styles/main.css:2967+`: remove the `#cosmic-chimes-theme`, `.chime-nebula`, chime and dust rules, and add `#<id>-theme { background: #<CLEAR_COLOR>; overflow: hidden; }` (pattern at main.css:976–980).
   - `.theme-container` fades over 2.5 s (main.css:325–356).
5. **URL params:** in `src/ui/url-parameters/theme-parameters.js:64–185` (`captureThemes`; generator at 187), add the row `['<id>', '<prefix>', '<Display>', 'part1, part2, …']`. It generates `<prefix>ForceWebGL`, `Time`, `FixedDt`, `Parts` and `FalseColor`, with sources `src/themes/<id>/<id>-theme.js` and `…/<id>-world.js` (`source(id)` hard-codes the file naming). The catalog test asserts the files exist and every literal `params.get(...)` in the source is catalogued. Also update the effect lists in `src/ui/url-parameters/playground-parameters.js` and `docs/URL_PARAMETER_REFERENCE.md`.
6. **Tests:**
   - Clone `tests/unit/serenity-warp-{theme,director,composition,core,world}.test.js` to `<id>-*`.
   - Delete `tests/unit/mobile-wrapper-policy.test.js`; its only describe is Cosmic Chimes.
   - Retarget the `cleanResult('cosmic-chimes')` DOM-artwork case in `tests/unit/mobile-webgl2-validation.test.js:160` to another DOM theme.
   - Also update `theme-music-preferences.test.js` and `odyssey-save-migration.test.js`.
   - Other cosmic-chimes references: `src/ui/serenity-hub/ThemesTab.js:302` (`'Cosmic Chimes': 'chime'` icon key), `src/core/progression/theme-music-catalog.js`, `src/core/odyssey/{theme-presentation.js, data/levels.js, data/chapters.js, odyssey-progress-schema.js}` and `public/assets/music/songs.json`.

### 6d. Step order (lowest risk)
1. Scaffold the new folder with copied adapter, director, composition and quality, plus a minimal world (one sky part) and the post. Make the world satisfy `WORLD_METHODS` from day one.
2. Make the registry, heavy-set, retired-id, container/CSS and URL-param changes. Delete `src/themes/cosmic-chimes/` and the obsolete cosmic-chimes references, tests and CSS. Run `npx vitest run tests/unit/<id>-theme.test.js tests/unit/url-parameter-catalog.test.js tests/unit/theme-*`.
3. Iterate the look in `src/playground/effects/<id>.effect.js` and take screenshots. Grow the parts list and keep `<UPPER>_PARTS` in sync with the captureThemes row.
4. Implement `onLock`, `onClear`, `onCombo` and `levelUp` in the world, playground-first (`event=lock|drop|clear|quad|tspin|perfect|levelUp`).
5. Set tier values and POST_LOOK, then check on WebGL2 (`?forceWebGL`) and on a phone aspect.

### 6e. Pitfalls
- **Keep the flag names as string literals** in the theme source. Both tests check: the catalog AST test (`params.get('x')`) and the theme test (``source.toContain(`'${name}'`)``).
- **`THEME_ID` must equal the registry id and the folder name.** The manager throws `Theme identity mismatch` otherwise.
- **Never read the DOM layout inside a bus handler.** Stage the read and run it on frame time.
- **Director sink objects are reused**, so copy what you keep.
- **Read `clear.combo` for a clear's chain**, not the last `sink.combo` value. `sink.combo(0)` arrives one lock late.
- **The world must not grow `scene.children` after build.** The prewarm watches the children count, and parts parked at `visible=false` would compile on first reveal. Serenity-warp's pattern: every pool is always drawn, with zero-size dormant slots.
- **No downloads.** CPU-baked noise volumes only (serenity-warp uses `bakeGasNoise`/`bakeFbm` to DataTexture). This keeps the theme from being "busy" during prewarm and avoids `file://` path issues.
- **Delta must come from the theme's own `lastFrameMs`**, because the frame pacer skips vsyncs. Reset it to null on pause and resume.
- **Call `removeRendererResilience()` before `disposeRenderer()`**, or a destroyed device looks like a loss.
- **WebGPU recovery is one-shot**, onto the WebGL2 backend (`forceWebGL=true`). The world and post must build on both backends: gate on renderer kind, not backend (ADR-0019).
- **Rebuild-in-place keeps the instance.** `createScene` can run many times per start, so `setupEvents` must clear before it re-subscribes; serenity-warp does this.

---

## 7. Key skeleton (copy target)

```js
import * as THREE from 'three/webgpu';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { registerGpuSurface } from '../../utils/gpu-loss-coordinator.js';
import { normalizeQuality } from '../../utils/quality.js';
import { getViewport } from '../../utils/viewport.js';
import { NEW_TETROMINOS } from './<id>-tetrominos.js';
import { NewWorld, REST_RIG, fovForAspect } from './<id>-world.js';
import { POST_LOOK, NewPost, createPassThroughPipeline } from './<id>-post.js';
import { PLAYER_SLOTS, readLayoutRects } from './<id>-composition.js';
import { NEW_EVENT_HANDLERS, NewDirector } from './<id>-director.js';
import { approach } from './<id>-core.js';

const THEME_ID = '<id>';  const LOG_PREFIX = '[<Display>]';
const RENDERER_INIT_TIMEOUT_MS = 5500; const MAX_DELTA_S = 0.05; const CLEAR_COLOR = 0x______;
const LAYOUT_REREAD_OFFSETS = Object.freeze([0, 0.5, 1.5]);
const PIXEL_RATIO_CAP = Object.freeze({ Minimal: 0.7, Low: 0.85, Medium: 1.0, High: 1.15, Ultra: 1.35, Extreme: 1.6 });

function readFlags() { /* … */ const t = num('<prefix>Time'); const dt = num('<prefix>FixedDt');
  return { forceWebGL: bool('forceWebGL') || bool('<prefix>ForceWebGL'), time: …, fixedDt: dt/(dt>1?1000:1),
           parts: params.get('<prefix>Parts') ? params.get('<prefix>Parts').split(',').map(s=>s.trim()) : null,
           falseColor: bool('<prefix>FalseColor') }; }

export default class NewTheme extends BaseTheme {
  constructor() { super(THEME_ID); /* renderer, scene, camera, world, post, passThrough, director,
     isWebGPU, forceWebGL, quality:'High', pendingQuality, flags, time:0, lastFrameMs, animationLoopStarted,
     runtimeGeneration, eventUnsubscribers:[], gpuSurfaceUnregister, gpuRecoveryAttempted, layoutDue(Float64Array∞),
     layoutClock, modeManager, layout, pointer, reducedMotion, appliedSize, bufferSize, rebuildQueued,
     rebuildPending, combos:new Map(), level:1, _sim, _calmRects */ }
  getTetrominoConfig() { return NEW_TETROMINOS; }
  async createScene(ownerGeneration = this.lifecycleGeneration) { /* §1d verbatim */ }
  stepFrame(now) { /* … */ world.updateCamera(camera, sim); this.director?.flush(); world.update(sim, camera);
                   this.easeCalmZones(wall); this.post.update(world.getPostState()); this.post.update({ time: this.time });
                   this.post.render(); }
  async whenCriticalReady() { return !!(this.world && this.renderer && this.scene && this.camera); }
  getWarmupRoots() { return []; }  usesMrtScenePass() { return false; }
  stop() { super.stop(); this.disposeRuntime(); this.time = 0; }
  cleanup() { this.stop(); super.cleanup(); }
}
```

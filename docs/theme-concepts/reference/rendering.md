# Rendering architecture and TSL house style (Serenity Warp rebuild + Sunset/Ocean landscapes)

> **Snapshot taken at commit 5d3478d (main, 2026-10-11) during the Rainbark design; line numbers drift, verify against the current code.**
>
> Part of `docs/theme-concepts/`: the index is [`../README.md`](../README.md) and the shared build procedure is [`../PLAYBOOK.md`](../PLAYBOOK.md). PLAYBOOK wins where the two disagree; it was written later and folds in what the Rainbark build learned.
>
> "Here", "locally", "this container" and "this session" mean the Claude Code cloud container the survey ran in on 2026-10-11 (no GPU; headless Chromium 141 with SwiftShader for WebGPU and WebGL2). The capture scripts that work there are printed in full in PLAYBOOK §5.

Read-only survey. Paths relative to `/home/user/serenity-blocks`. Line numbers are as of HEAD `5d3478d`.

## 0. File layout of a "masterpiece" rebuild (serenity-warp)

| file | role |
|---|---|
| `src/themes/serenity-warp/serenity-warp-core.js` | THREE-FREE constants + CPU maths (palettes, paths, quats, `mulberry32`, `smooth`, `approach`, `packCell`, `pieceColor`, `gateAnchors`). Director/layout/tests import only this. |
| `-tsl.js` | shared TSL: laid-out hashes, env-UV maps, CPU noise bakes → textures, `createWarpUniforms(...)` (the ONE shared uniform bag `u`), material/geometry/target helpers. `export * from './serenity-warp-core.js'`. |
| `-quality.js` | content tiers `QUALITY.{Minimal,Low,Medium,High,Ultra,Extreme}` + `tierFor(q)` (fallback High). |
| `-sky.js`, `-glass.js`, `-stars.js`, `-fx.js` | scene parts; each returns `{ mesh, material, geometry, ...extra }` (via `swPart`) and optionally `dispose/reset/fire/render/resize`. |
| `-world.js` | `SerenityWarpWorld`: owns `u`, parts, camera rig, choreography, event slots. Shared by theme AND playground effect. |
| `-post.js` | `SerenityWarpPost` (RenderPipeline) + `POST_LOOK` per tier + `createPassThroughPipeline`. |
| `-composition.js` | layout: `BOARD_GRID`, `PLAYER_SLOTS=5`, `fallbackLayout`, `readLayoutRects`, `boardFor`, `cardUnion`, `boardPoint`. |
| `-director.js` | renderer/DOM/bus-free event stager (`SERENITY_WARP_EVENT_HANDLERS`, `flush()` → sink). |
| `-theme.js` | `BaseTheme` adapter: renderer, post, events, layout reads, settings, GPU loss, capture flags. |
| `-tetrominos.js`, `-theme-icon.png` | piece colours, menu icon. |
| `src/playground/effects/serenity-warp.effect.js` | mounts the SAME world + post for captures. |

## 1. The world object and how theme + playground share it

### Constructor / build (`serenity-warp-world.js:190-366`)
```js
constructor({ scene, quality = 'High', renderer = null, capture = false, seed = 0x5e7e, floatTarget } = {})
// tier = tierFor(quality); floatTarget = floatTarget ?? supportsFloatTargets(renderer)
// root = new THREE.Group() named 'SerenityWarp'; parts = {}; disposables = []; textures = []
// preallocates: pieces[PIECE_SLOTS], waveSlots[WAVE_SLOTS], rippleSlots[RIPPLE_SLOTS], _write, _post, scratch Vector3/Matrix4
```
`build()` (336-366): bakes CPU noise → textures (`createGasTexture(bakeGasNoise(6151, 64), 64)`, `createFbmTexture(bakeFbm())`, 1×1 placeholder env), `u = createWarpUniforms({gas, fbm, env, floatTarget})`, then `this.sky = createSky(u, tier); this.addPart('sky', this.sky)` … glass/stars/motes/streams/flares, `compose()`, `resetState(time)`, `applyPalette(1)`, `scene.add(root)`; returns `this` (chainable: `new World({...}).build()`).

`addPart(name, part)` (368-372): `parts[name]=part; root.add(part.mesh); disposables.push(part)`.

### Public contract (pinned by `tests/unit/serenity-warp-theme.test.js:33-37` `WORLD_METHODS`)
`build, bindCamera, showOnlyParts, setViewport, setLayout, setReducedMotion, seek, resetSession, restCamera, updateCamera, onLock, onClear, onCombo, levelUp, update, getPostState, getState, dispose`.

- `setViewport(bufferW, bufferH, aspect)` (382-390): writes `u.viewport`, recomposes on aspect change, refreshes fallback layout, `updatePixelAngle()` → `u.pixelAngle = 2·tan(fov/2)/bufferH` (radians per buffer pixel; every AA width / star size keys off it).
- `setLayout(rects|null, aspect)` (396-404): live board/card/HUD rects in screen fractions (y down) or null → `fallbackLayout(aspect*1000,1000)`.
- `seek(time)` (411-414) = `resetState(max(0,t)); applyPalette(1)` — drops everything in flight; `prefill(time)` (740-747) places ambient pieces as a function of the clock so a seek shows a settled field.
- `resetSession()` (417-433): back to rest but keeps integrated flow/phase and pieces in flight.
- `bindCamera(camera)` (436): just stores it ("Kept so the theme and the playground bind every world alike").
- `updateCamera(camera, sim)` (507-539): sets `this.time = sim.time` FIRST ("The staged gameplay is flushed between this and update(): it must carry this frame's time"), FOV from aspect + warp/jump/kick, sway + pointer parallax (`sim.pointerX/Y`), roll from twist, `aim()` (452-477) builds a no-roll basis that puts the gate at the composed screen anchor.
- `update(sim, camera)` (1197-1326): `dt = max(0, sim.delta)`; exponential decays (`this.flash *= Math.exp(-dt/0.22)` …), `drain(t)` timed queue, integrates flow (`this.inflow += dt*INFLOW_REST*...`), semi-implicit spring "in small steps so a long frame cannot blow it up" (1239-1246), `stepPieces`, writes uniforms (`u.inflow.value = this.inflow % 4096`, `u.spin.value = this.spin % (2π·64)`, `u.starTravel.value = this.drift % STAR_DEPTH` — integrated phases WRAPPED for float precision), palette uniforms via `.value.set(...)`, `writeEvents(t)`, camera-basis uniforms (`camPos/camRight/camUp/camFwd` from `camera.matrixWorld.elements`, `tanHalf`), gate screen position, `writePieces(t)`, fills the reused `_post` object, then paints env target: `if (this.sky && sim.draw !== false && this.glass?.mesh.visible) this.sky.render(this.renderer)` (1325).
- `getPostState()` (1329) returns the reused `_post` `{heart, flash, flashTint, kick, rays, blur, bloomBoost, exposure, jump, warp}`.
- `getState()` (1333-1376): diagnostics snapshot (allocates; diagnostics only).
- `dispose()` (1378-1399): idempotent (`disposed` flag), `scene.remove(root)`, `part.dispose?.()/geometry/material`, textures.

### Events API (world side)
- `onLock({ u=0.5, rows=null, hardDrop=false, color=null, cells=null, player=0, screen=null })` (754-854): `u` column fraction, `rows` visible rows (0 top..19 floor), `cells` 8 numbers (orientation it locked in) → `matchShape` → (shape, quarter turns). Aims via `boardFor(layout, player)` + `boardPoint` + `cardExit()` (the effect leaves the card's edge toward the hero — see SKILL gotcha #144 "A lock's effect 'under the piece' is never seen").
- `onClear({ rows, lines=1, tspin, perfect, player, screen })` (895-948): schedules waves/pulls/boost/kick with `this.schedule(at + i*0.12, 'wave', {...})`; quad/perfect → hush then `'jump'`.
- `onCombo(n)` (978-991), `levelUp(level, { silent })` (997-1006).
- Timed queue: `schedule(time, kind, data)` (605-610, sorted insert) + `drain(t)` (613-624). Header (33-36): "Nothing is created at event time: events write numbers into preallocated slots and a small queue of timed moments, so seek(t) plus a fixed-step replay reproduces any frame. What is integrated … is integrated because the speeds change; the clock is never multiplied by a rate that moves."
- Ring-buffer slots: `wave()` (637-644) `slot = waveSlots[waveCursor++ % WAVE_SLOTS]`; `ripple()` (647-654).

Theme-side director contract (`serenity-warp-director.js:1-34`): bus handlers only STAGE numbers into 5 preallocated player slots; `flush()` (called first in the frame) emits `sink.lock({player, rows, u, hardDrop, color, shape, cells, screen})`, `sink.clear({player, rows, lines, combo, cascade, tspin, perfect, b2b, screen})`, `sink.combo(n, player)`, `sink.levelUp(level)`. "A clear therefore reaches the sink BEFORE the combo it raised"; COMBO bus event = cascade depth (ADR-0011), true combo derived by `ComboTracker`; `sink.combo(0)` arrives one lock late.

### Parts toggles
`const PARTS = ['sky', 'glass', 'stars', 'motes', 'streams', 'flares']` (140), exported `SERENITY_WARP_PARTS` (1402). `showOnlyParts(names)` (375-380) flips `mesh.visible`. Theme reads `?serenityWarpParts=a,b` (`serenity-warp-theme.js:99-101`); effect reads `parts=`. The URL catalogue row `['serenity-warp', 'serenityWarp', 'Serenity Warp', 'sky, glass, stars, motes, streams, flares']` (`src/ui/url-parameters/theme-parameters.js:139`) generates `<prefix>ForceWebGL/Time/FixedDt/Parts/FalseColor` entries (187-226); test (`serenity-warp-theme.test.js:1482-1489`) requires the listed parts == exported `*_PARTS`, and (488-512) that exactly those 5 prefixed flags exist and appear as literal strings in `-theme.js`.

### How the theme drives it (`serenity-warp-theme.js`)
- Renderer (288-318): `new THREE.WebGPURenderer({ antialias: false, depth: false, alpha: false, forceWebGL, powerPreference: 'high-performance' })` — "The canvas only receives the output quad (the scene pass owns depth)". WebGPU first, WebGL2 backend fallback; GPU loss → one-shot `forceWebGL = true` rebuild (320-336).
- `renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace` (220-221).
- createScene (233-286): `new SerenityWarpWorld({ scene, quality, capture: flags.time !== null || flags.fixedDt !== null, renderer }).build(); world.bindCamera(camera); if (flags.parts) world.showOnlyParts(...)`; post; director sink; `resize`; `world.seek(this.time)` (clock survives rebuild in place); silent levelUp to restore palette; one `updateCamera`+`update` at dt 0.
- stepFrame (582-628): `wall` clamped to `MAX_DELTA_S = 0.05`; `delta = 0` if `?serenityWarpTime`, `fixedDt` if set; order: `processLayoutReads()` → `world.updateCamera(camera, sim)` → `director.flush()` → `world.update(sim, camera)` → `easeCalmZones(wall)` → `post.update(world.getPostState()); post.update({ time }); post.render()`.
- Layout: no polling/observers; `readLayoutRects()` re-read on frame time at +0, +0.5, +1.5 s after triggers (489-512) — "Never from a handler (getBoundingClientRect forces layout)".
- `resize` (544-561): `getEffectivePixelRatio(PIXEL_RATIO_CAP[quality])`, `renderer.setSize(w,h,false)`, `getDrawingBufferSize` → `world.setViewport(bw,bh,w/h)`, `post.setSize(w,h,bw,bh)`. Buffer size re-checked every frame (600-608) "Other code may resize our renderer".
- `getWarmupRoots() → []`, `usesMrtScenePass() → false` (637-644): "every pool is always drawn with zero-size dormant slots, so the first frame compiles every render pipeline; the scene pass has one output".

### Layout of the readers (`serenity-warp-composition.js:51-117`)
`readLayoutRects()` → `{ cardCount, cards:[{x0,y0,x1,y1}], hud, boards[5] }` (fractions, y down) from `.player-card[data-player]`, solo canvas selectors, `#p${n}-phaser-container canvas`, `.single-player-stats-bar`; null when no card visible. `fallbackLayout(W,H)` reproduces `public/styles/main.css` formulas.

## 2. Post pipeline in detail (`serenity-warp-post.js`)

Header (4-18): "One scene pass (no MRT: the scene is authored in scene-linear HDR, so a max-channel knee selects what blooms; MSAA on the tiers that can afford it…), one bloom chain (Medium and up) and ONE full-screen pass: rush → lens fringe → calm zones → bloom → the gate's shafts → exposure and the event flash → 'starlight filmic' tone map (hue preserving) → grade → vignette → sRGB → grain and dither. Tone mapping happens exactly once: renderer.toneMapping = NoToneMapping and the pipeline's outputColorTransform is off (the output node encodes sRGB itself)."

### Tier look (56-75)
```js
High:   { msaa: true,  bloom: true,  bloomStrength: 0.58, bloomResolution: 0.45, rays: 10, rush: 7, fringe: true },
Medium: { msaa: false, bloom: true,  bloomStrength: 0.54, bloomResolution: 0.33, rays: 6,  rush: 5, fringe: false },
Low:    { msaa: false, bloom: false, bloomStrength: 0,    bloomResolution: 0.25, rays: 0,  rush: 4, fringe: false },
Minimal:{ msaa: false, bloom: false, ...,                                         rays: 0,  rush: 0, fringe: false },
// Extreme/Ultra: msaa, bloom 0.6 @0.5, rays 14/12, rush 10/8, fringe
BLOOM_THRESHOLD = 1.0; BLOOM_KNEE = 0.5; BLOOM_RADIUS = 0.62; EXPOSURE = 1.0; CALM_RECTS_MAX = 5;
```
Tap counts are JS constants baked into the graph (unrolled `for` in JS), features off = not built ("Gate in JS, not shader zeros").

### Scene pass + MSAA (124-126)
```js
this.pipeline = new THREE.RenderPipeline(renderer);
this.scenePass = pass(scene, camera, { samples: look.msaa ? 4 : 0 });
const sceneColor = this.scenePass.getTextureNode('output');
```
(Ocean also takes depth: `pass(scene, camera, { samples: params.samples ?? look.msaa ?? 0 })` + `getTextureNode('depth')`, `ocean-post.js:145-147`; Sunset uses no MSAA and wraps the output in `fxaa(outputFn())` when `look.fxaa && !falseColor`, `sunset-post.js:255`.)

### Bloom node with custom high-pass (146-172)
```js
this.bloomNode = bloom(sceneColor, look.bloomStrength, BLOOM_RADIUS, BLOOM_THRESHOLD);
this.bloomNode.threshold.value = BLOOM_THRESHOLD;
this.bloomNode.smoothWidth.value = BLOOM_KNEE;
this.bloomNode.setResolutionScale(look.bloomResolution);
// BloomNode's documented hook, read once at setup. Inline (no setLayout): `input`
// must stay the raw scene TextureNode for .sample().
this.bloomNode.highPassFn = Fn(({ input, threshold, smoothWidth }) => {
    const st = uv(); const o = uSrcTexel.mul(1.25);
    // Hue-preserving clamp on the max channel: a per-channel clamp would turn a
    // saturated pane of glass toward white.
    const tap = (dx, dy) => {
        const c = max(vec3(input.sample(st.add(vec2(o.x.mul(dx), o.y.mul(dy)))).rgb), vec3(0.0));
        return c.mul(min(float(1.0), float(7.0).div(max(swMax3(c), 1e-4))));
    };
    const c = tap(1, 1).add(tap(-1, 1)).add(tap(1, -1)).add(tap(-1, -1)).mul(0.25);
    const br = swMax3(c);
    const soft = clamp(br.sub(threshold).add(smoothWidth), 0.0, smoothWidth.mul(2.0));
    const w = max(soft.mul(soft).div(smoothWidth.mul(4.0).add(1e-4)), br.sub(threshold)).div(max(br, 1e-4));
    return vec4(c.mul(w), 1.0);
});
```
Disposal: `disposeBloomNodeDeep(this.bloomNode)` from `src/themes/shared/bloom-dispose.js` (358).
Iris-coupled knee (`update`, 321-325): `this.bloomNode.threshold.value = BLOOM_THRESHOLD / Math.max(0.2, exposure)` — "The bloom's knee follows the iris: at speed the sky must not bloom into a veil." World sets `post.exposure = 1/(1 + warp*0.15 + surge*0.4 + flash*0.25 + phase*0.3)` and `u.iris.value = (1/post.exposure) ** 0.8` (world 1321-1322); event lights multiply by `u.iris` so they read at any exposure (SKILL gotcha #134).

### Calm zones over card/HUD (182-191, 234-237, 259, 264, 286)
```js
const roundBoxSdf = Fn(([p, rect, radius]) => { ... }).setLayout({ name: 'sw_roundBoxSdf', type: 'float', inputs: [...] }); // 86-95
const hScale = this.uViewport.y.div(1080.0);
const calm = float(0.0).toVar();
for (let i = 0; i < CALM_RECTS_MAX; i++) {
    const r = this.uCalm[i];
    const sdf = roundBoxSdf(px, r.mul(vec4(this.uViewport, this.uViewport)), hScale.mul(16.0));
    const inside = float(1.0).sub(smoothstep(-20.0, 6.0, sdf)).mul(step(0.001, r.z.sub(r.x)));
    calm.assign(max(calm, inside));
}
calm.mulAssign(this.uCalmStrength);
...
// What shows through the card is soft-clipped (hue-preserving).
const m = max(swMax3(S), 1e-5);
const clipped = S.mul(min(m, min(float(0.16).add(m.mul(0.08)), 0.5)).div(m));
S.assign(mix(S, clipped, calm.mul(0.9)));
```
Calm also scales: rush `×(1−0.85·calm)`, fringe `×(1−calm)`, glare `×(1−0.86·calm)`, flash lift `×(1−0.7·calm)`, grain `×(1−0.7·calm)`. Rects are 5 separate `uniform(Vector4)` (142-144); `setCalmRects(rects, strength)` (335-342) zero-fills unused. Theme eases strength `ls.strength += ((live?1:0) - ls.strength) * approach(3, dt)` and passes `cards[0..PLAYER_SLOTS-2] + hud` (`-theme.js:528-539`). Sunset uses the same SDF with a softer clip `min(m, 0.22 + 0.2·m)` (`sunset-post.js:185-187`).

### Rush (zoom blur toward the hero) (199-217)
```js
const S = vec3(sceneColor.sample(st).rgb).toVar();
if (rushTaps > 0) {
    const rush = this.uRush.mul(float(1.0).sub(calm.mul(0.85))).toVar();
    If(rush.greaterThan(0.004), () => {
        const reach = rush.mul(0.1).mul(smoothstep(0.0, 0.5, dist));
        const sum = vec3(S).toVar(); let total = 1;
        for (let i = 0; i < rushTaps; i++) {
            const w = 1 - (i / rushTaps) * 0.6; total += w;
            const f = jitter.add(i).div(rushTaps).mul(reach);
            sum.addAssign(sceneColor.sample(st.add(toHeart.mul(f))).level(0).rgb.mul(w));
        }
        S.assign(sum.mul(1 / total));
    });
}
```
`jitter = swHash21(floor(screenCoordinate).add(vec2(3, 71)))`; samples inside a branch use `.level(0)`.
Fringe (220-232): radial chromatic split `r2·(0.0018 + rush·0.0045) + kick·0.0025`, two extra scene taps (R and B), inside `If(fringe > 2e-4)`.

### Shafts (239-261): bloom texture dragged toward the hero
```js
const bt = this.bloomNode.getTextureNode();
glare.assign(vec3(bt.sample(st).rgb).mul(float(1.0).add(this.uBloomBoost.mul(0.5))));
for (let i = 0; i < rayTaps; i++) {
    const w = 1 - (i / rayTaps) * 0.75; total += w;
    const f = jitter.add(i).div(rayTaps).mul(0.72);
    rays.addAssign(bt.sample(st.add(toHeart.mul(f))).rgb.mul(w));
}
const reach = float(1.0).sub(smoothstep(0.0, 1.25, dist));
glare.addAssign(rays.mul(1 / total).mul(this.uRays).mul(reach).mul(1.6));
```
Alternatives in siblings:
- Sunset (`sunset-post.js:260-302`): two short marches into half/third-size `rtt(gather, null, null, { resolutionScale: scale })` targets — "N + M taps give the smoothness of N x M, with no jitter and so no grain"; emitters limited to `SHAFT_RADIUS=0.22` screen heights round the sun and above `SHAFT_THRESHOLD=1.5`; last steps tapered `1 - smoothstep(steps*0.7, steps, i+1)`; hue-preserving clamp `c·min(1, 4/max3(c))`. Shaft tint/strength per hour from world.
- Ocean (`ocean-post.js:180-183, 335+`): depth-aware volumetric march in an `rtt(..., { resolutionScale: look.shaftScale })`, ray from camera basis uniforms, `perspectiveDepthToViewZ(depth, uNear, uFar)`, start offset `interleavedGradientNoise(screenCoordinate.xy)`, light looked up in the world's tileable light-pattern target so shafts line up with caustics (SKILL gotcha #156).

### Tone map + grade + encode (263-289)
```js
const starlightFilmic = Fn(([cIn]) => {          // 102-110, setLayout'd
    const c = max(cIn, vec3(0.0)); const peak = max(swMax3(c), 1e-5); const k = float(0.42);
    const shoulder = k.add(float(1.0).sub(k).mul(float(1.0).sub(exp(peak.sub(k).div(float(1.0).sub(k)).negate()))));
    const mapped = select(peak.greaterThan(k), shoulder, peak);
    const toned = c.mul(mapped.div(peak));
    return mix(toned, vec3(mapped, mapped, mapped), smoothstep(1.8, 9.0, peak).mul(0.78));
}).setLayout({ name: 'sw_starlightFilmic', type: 'vec3', inputs: [{ name: 'cIn', type: 'vec3' }] });

const X = H.mul(this.uExposure).mul(float(1.0).add(this.uFlash.mul(0.3))).add(lift.mul(edge.mul(0.5).add(0.04)));
const T = starlightFilmic(X).toVar();
// cool lifted shadows; saturation 1.12; vignette smoothstep(0.45, 1.08, |cv·1.5|) × 0.36
const D = vec3(renderOutput(vec4(clamp(T, 0.0, 1.0), 1.0), THREE.NoToneMapping).rgb).toVar();
// grain: swHash21(pxi + frame·(1.7,−2.3)) − 0.5, × 0.014; frame = floor(uTime·24)
// dither: (hash(pxi) + hash(pxi+17.17) − 1) / 255
...
this.pipeline.outputColorTransform = false;   // 307
this.pipeline.outputNode = outputFn();
this.pipeline.needsUpdate = true;
```
Sunset variant `sunsetFilmic` k=0.56, whitening `smoothstep(4, 30, peak)·0.75`, plus per-hour `uGradeShadow/uGradeLight` and `uWarm` (`sunset-post.js:89-97, 205-219`).
falseColor debug (291-303): bands pre-tone-map max channel `<0.1` blue, `<0.6` green, `<1` yellow, `<2.5` orange, else red.
Fallback (367-381): `createPassThroughPipeline` (plain `pass`, samples 0) and `renderer.toneMapping = AgXToneMapping` when the post throws (`-theme.js:338-353`).
Per-frame API: `update({ heart, flash, flashTint, kick, bloomBoost, exposure, rays, blur, time })`, `setCalmRects`, `setSize(w, h, bw, bh)` → `uAspect`, `uSrcTexel`, `uViewport` (344-350), `render()`, `dispose()`.

## 3. TSL idioms

### Imports
`import * as THREE from 'three/webgpu'`; every TSL symbol from `'three/tsl'` (`Fn, If, Loop, select, uniform, uniformArray, attribute, varying, texture, texture3D, positionGeometry, screenUV, screenCoordinate, uv, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, normalGeometry, renderOutput, pass, rtt, ...`). Addons: `three/addons/tsl/display/BloomNode.js`, `FXAANode.js`, `three/addons/utils/BufferGeometryUtils.js`.

### Laid-out pure helpers (`serenity-warp-tsl.js:52-106`)
```js
export const swHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'sw_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });
```
Rules (`-tsl.js:4-15`): "every helper that is called more than once carries `setLayout` … laid-out helpers are pure (no captured uniforms or textures); no `mx_noise_*` anywhere (a DXC compile pathology …): the gas is ONE tileable 3D byte texture and the fine grain one tileable half-float fBm texture, both baked on the CPU; nothing is lit by scene lights: every part writes its own light, scene-linear and unbounded (HDR); the post stack owns the tone map; the sky is one function of a direction …". Helpers that read `u` (e.g. `skyLight`, `swViewRay`, sunset `skyColour`) are plain JS builders inlined inside a material's `Fn` ("These builders read uniforms and a texture, so they are inline … never laid-out functions", `sunset-tsl.js:17-18`). Tiny ones are plain arrow functions: `swLuma`, `swMax3 = (c) => max(c.x, max(c.y, c.z))`.

### Shared uniform bag (`createWarpUniforms`, `-tsl.js:432-525`)
One object `u` built once; world writes `.value`, materials only read. Contains time, viewport, `pixelAngle`, camera basis (`camPos/camRight/camUp/camFwd/tanHalf`), hero direction/axes, gameplay scalars (`warp, inflow, spin, twist, breath, jump, iris`), palette `v3(...)` uniforms, ONE event table:
```js
const tables = { events: rows(EVENT_ROWS.total, [0, 0, 0, 0]) };   // Vector4[]
events: uniformArray(tables.events, 'vec4'),
waveCount: uniform(0, 'int'), rippleCount: uniform(0, 'int'),
```
plus sampler closures: `u.gas = (p3) => texture3D(u.gasTex, p3).level(0)`, `u.fbm = (st) => texture(u.fbmTex, st)`, `u.fbmLod = (st, lod) => texture(u.fbmTex, st).level(lod)`, `u.envAt(dir)`. Sunset/Ocean palettes: one `uniformArray` of vec4 rows, `createLight(rows)` maps names → `rows.element(i).xyz` (`sunset-tsl.js:111-113`).

### Loop over live rows of the event table (`serenity-warp-sky.js:100-111`)
```js
Loop({ start: int(0), end: u.waveCount, type: 'int', condition: '<', name: 'w' }, ({ w }) => {
    const A = u.events.element(w.mul(2).add(EVENT_ROWS.waves));
    const C = u.events.element(w.mul(2).add(EVENT_ROWS.waves + 1));
    ...
});
```
World compacts live rows to the front each frame (`writeEvents`, world 1163-1193) and sets the count.

### Instanced quads with per-instance attributes (no InstancedMesh, no storage buffers, no compute)
`swQuadGeometry(count, { aPlace: [Float32Array, 4], aLook: [Float32Array, 4] })` → `InstancedBufferGeometry` with `InstancedBufferAttribute`s and `instanceCount` (`-tsl.js:563-576`); read with `attribute('aPlace', 'vec4')`. Vertex placement done in CLIP space via `material.vertexNode`:
```js
const viewProjection = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0)); // stars.js:45
material.vertexNode = vec4(clip.xy.add(nrm.mul(positionGeometry.y.mul(2.0).mul(widthPx)).add(lead).div(half).mul(clip.w)), clip.z, clip.w); // 141-145
```
Light decided per instance in the vertex stage and passed as a `varying(..., 'swStarLight')`; fragment shapes a capsule from `uv()` (177-185). Width in pixels: `clamp(world/(range·pixelAngle), 1.15, 5.0)` and dim by `shrink = min(1, wantPx/1.15)` instead of drawing sub-pixel.
Glass pieces (`serenity-warp-glass.js:371-398`): 7 meshes (one per shape) with `InstancedBufferGeometry` sharing ONE material; per-instance data in ONE `InstancedInterleavedBuffer(data, GLASS_STRIDE=20, 1)` with `DynamicDrawUsage`, exposed as `InterleavedBufferAttribute`s `aPlace/aTurn/aTint/aShape/aState` (keeps under the 8-vertex-buffer WebGPU limit, gotcha #99). Transform in `material.positionNode = place.xyz + swQuatRotate(turn, stretched)·place.w` from `positionGeometry` (no instance matrices exist, so the r185 positionNode ordering trap does not apply). Per-frame `begin()/write(p)/commit()` (404-449) with `buffer.needsUpdate = true`; "Never zero instances: a draw is kept (one dormant piece of no size), so the first frame compiles every pipeline" (385-388).
Screen-space strips (`-fx.js:47-69`): instanced strip geometry with an `aSlot` float attribute; per-slot data in a `uniformArray(table,'vec4')` indexed `int(attribute('aSlot','float').add(0.5)).mul(2)`; clip-space `vertexNode = vec4(x*2-1, y*2-1, 1.0, 1.0)`; dormant slots collapse to zero width.
Integer-coded per-instance data: `packCell(x,y) = (round(2x)+8)*32 + (round(2y)+8)` (core 179); shader decodes with `floor(code.add(0.5))` (glass 74-78) — gotcha #87.

### Materials
- Premultiplied "over" FX material (`swFxMaterial`, `-tsl.js:540-556`): `MeshBasicNodeMaterial({ transparent:true, depthWrite:false, depthTest, side: DoubleSide })`, `blending = CustomBlending`, `blendSrc = One, blendDst = OneMinusSrcAlpha` (alpha same), `forceSinglePass = true`; `colorNode = vec4(emission, 0)` ADDS without touching alpha, `vec4(rgb·a, a)` occludes (gotcha #90).
- Solid unlit: glass `MeshBasicNodeMaterial({ side: FrontSide })`, `depthWrite = true`, `colorNode = Fn(() => ...)()` returns `vec4(max(col,0),1)` (HDR, unbounded).
- Full-screen pass material (`swPassMaterial`, 589-596): `new THREE.NodeMaterial(); depthTest=false; depthWrite=false; fragmentNode = node` for `THREE.QuadMesh`.
- `swPart(name, geometry, material, renderOrder)` (579-586): `frustumCulled = false; matrixAutoUpdate = false; renderOrder`.
Render order in SW: glass 10 (opaque, writes depth) → sky backdrop 50 → stars 60 → motes 70 → streams 80 → flares 90.

### Screen-space backdrop at the far plane (`serenity-warp-sky.js:309-323`)
```js
const backdropFn = Fn(() => {
    const d = swViewRay(u, screenUV).toVar();
    return vec4(max(skyLight(u, d, u.pixelAngle, options), vec3(0.0)), 1.0);
});
geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)); // one triangle
const backdrop = new THREE.MeshBasicNodeMaterial({ depthTest: true, depthWrite: false });
backdrop.depthFunc = THREE.LessEqualDepth;
backdrop.vertexNode = vec4(positionGeometry.xy, 1.0, 1.0);   // at the far plane
backdrop.colorNode = backdropFn();
const part = swPart('SerenityWarpSky', geometry, backdrop, 50);  // after the solids: shaded only where it shows
```
`swViewRay(u, st) = normalize(camFwd + camRight·(2x−1)·tanHalf.x + camUp·(1−2y)·tanHalf.y)` (`-tsl.js:528-532`). Sunset instead uses a `SphereGeometry(1,96,48)` `BackSide` dome scaled 30000, `renderOrder = 40`, `depthTest:true, depthWrite:false`, `follow(camera)` copies camera position (`sunset-sky.js:15-52`).

### Equirect environment target (`serenity-warp-sky.js:295-351`, `-tsl.js:94-106, 603-632`)
```js
const envFn = Fn(() => {
    const d = swEnvDir(uv()).toVar();
    const light = skyLight(u, d, envTexel, { ...options, skyLayers: Math.min(2, options.skyLayers) });
    const stored = u.floatTarget ? light : sqrt(clamp(light.div(ENV_CODE_PEAK), 0.0, 1.0));  // 8-bit fallback
    return vec4(stored, 1.0);
});
const quad = new THREE.QuadMesh(swPassMaterial('SerenityWarpEnvironment', envFn()));
let target = swTarget(w, w/2, 'serenity-warp-environment', u.floatTarget, THREE.RepeatWrapping);
u.envTex.value = target.texture;      // texture() node repointed on resize
part.render = (renderer, force) => {  // every tier.envEvery-th frame
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target); quad.render(renderer); renderer.setRenderTarget(previous);
};
```
`swEnvUv(d) = (atan(d.x, −d.z)/τ + 0.5, 0.5 − asin(d.y)/π)` — "v DOWN from the zenith … The painting pass writes texel (u, v) with the QuadMesh's own uv, whose v also runs down the target, so the two agree on both backends" (gotcha #113). `swTarget`: `RenderTarget({ type: halfFloat ? HalfFloatType : UnsignedByteType, depthBuffer:false, samples:0 })`, linear, no mips, `NoColorSpace`. `supportsFloatTargets(renderer)`: WebGPU always; WebGL2 needs `EXT_color_buffer_float` or `EXT_color_buffer_half_float` "without one a half-float target is an incomplete framebuffer". Read with `u.envAt(dir)` (`.level(0)`, decoded `rgb·rgb·8` on 8-bit).
Ocean's analogue: a tileable 512² RGBA8 light-pattern `RenderTarget` with `RepeatWrapping`, `generateMipmaps = true`, `anisotropy = 8`, painted by a `NodeMaterial` fragment each frame via `world.paint(renderer)` called by the theme/effect after `update()` (`ocean-tsl.js:596-623`, `ocean-world.js:1179-1182`).

### Noise
- Baked on CPU at build: 2D fBm `bakeFbm(seed, 256)` → half-float `DataTexture` with a CPU mip chain "generating half-float mips on the GPU is not portable to every WebGL2 device" (`-tsl.js:371-412`), `LinearMipmapLinearFilter`, Repeat.
- 3D gas `bakeGasNoise(6151, 64)` → `Data3DTexture` RGBA8, Repeat on S/T/R, Linear, no mips (`-tsl.js:266-281`), sampled `texture3D(u.gasTex, p3).level(0)` (510).
- Sunset: 2D RGBA8 noise `DataTexture` with GPU mips + anisotropy 8 (`sunset-tsl.js:84-97`); hashes are `fract(sin(dot()))` arrow fns (113-119).
- Ocean: 2D 256² noise via `u.noise(st)`.
- Void Ember 2D-lattice 3D value noise (NO 3D texture), `void-ember-tsl.js:122-165, 374-381`:
```js
u.noise3 = (at) => {
    const cell = floor(at); const f0 = fract(at);
    const f = f0.mul(f0).mul(float(3.0).sub(f0.mul(2.0)));
    const st = cell.xy.add(vec2(37, 17).mul(cell.z)).add(f.xy).add(0.5).div(256);
    const t = texture(u.latticeTex, st).level(0);
    return mix(t.xz, t.yw, f.z);     // two independent trilinear fields, one fetch
};
```

### Landscapes in siblings (terrain / water / sky)
- Sunset sea (`sunset-sea.js:63-236`): CPU fan mesh of rings round the eye (`buildSeaFan`, log-spaced rings), Gerstner swell in `material.positionNode` from `positionGeometry.xz` with each train faded where the mesh is too coarse; fragment rebuilds slope from the same trains + 1–3 ripple layers from a 2D noise texture, accumulates unresolved slope as variance (footprint `dist·pixelAngle/grazing`), mirrors `skyColour(R, …)` (same sky function along the reflected ray, fewer layers — no reflector pass), sun road via `glintLobe(slope, variance, V, sun)`, rings and lanterns via `Loop` over `rows.rings/rows.lamps` with counts in `U.counts`, distance haze `1 − exp(−dist/2600)` into `horizonHaze`.
- Ocean seabed (`ocean-seabed.js:41-163`): CPU heightfield grid (finer near the eye, `seabedHeight(x,z)`), per-vertex `aGround` vec2 (rock mask, cavity AO) computed on CPU, patterns laid out in `positionGeometry.xz` "so a narrow frame does not stretch them", normal perturbed per pixel from noise reads, caustic read three times along the light axis for a colour fringe, `ocFog(u, col, P)` = mix toward `ocBackdrop(u, dir)` by `exp(−ext·dist)` (`ocean-tsl.js:339-363`).
- Sky as ONE function of direction drawn on the backdrop/dome and again for reflections (SKILL #128, #137).

## 4. Gotchas and pitfalls (quoted)

### From `.claude/skills/webgpu-threejs-tsl/SKILL.md` gotcha table (lines 61-159) — most relevant to a new landscape theme
- (#63) Construct `THREE.RenderPipeline`, never `PostProcessing` (deprecation warning = stray site).
- (#64) "`X is not defined` … TSL functions are not globals. Import every identifier from `'three/tsl'` (incl. `Fn`, `If`, `Loop`)".
- (#65) "r185 **inverted** `positionNode` ordering … Portable idiom: compute masks/pivots/phases from `positionGeometry`, output `positionLocal.add(displacement)`. Never output a `positionGeometry`-only expression on a real-matrix InstancedMesh".
- (#66) "`positionNode = buffer.element(instanceIndex)` replaces *every vertex* with one point" → `positionLocal.add(...)` or the `vertexNode` billboard.
- (#67) "JS variable reassignment inside `If()` — TSL can't see `x = x.add(1)`" → `.toVar()` + `.assign()`, or `select()`.
- (#68) "A branch reads ZEROS from shared nodes … Root-pin: at the top of the `Fn`, before any `If`, call bare `.toVar()` on every shared node".
- (#69) "`smoothstep(a, a, x)` — **EQUAL** edges are a hard WGSL error … killing the whole module". (Reversed edges in shaders ARE fine — CORRECTED note 161-173; JS `THREE.MathUtils.smoothstep` returns 0 on reversed edges, #70.)
- (#71) "A region goes BLACK … often ONLY on a tall portrait screen … `exp(k * signedDistance)` reaches 1e8 … Bound every term before it is masked: `exp(max(distance, 0).mul(-k))`, and capture portrait before calling it done."
- (#72) "Multiplying by a 0-value uniform is NOT dead-code-eliminated" → gate in JS.
- (#73) In-place mutation of a uniform `Color/Vector` uploads every frame.
- (#74) "`oscSine` already returns 0..1".
- (#75/#76) Selective bloom needs MRT; MRT secondary attachments default to `NoBlending` → `withEmissiveMaterialBlending` (`src/themes/shared/mrt-blend.js`). SW/Sunset/Ocean all avoid MRT.
- (#77/#82) `compileAsync` traps (argument order `compileAsync(group, camera, scene)`; deferred builds).
- (#78) Backgrounded tab → `shouldRenderFrame()` gate + clamp delta.
- (#79) Electron `file://`: use relative `./assets/...`.
- (#80) "`mx_noise_float` / `mx_fractal_noise_*` … 20 evaluations = **7.3 s** [compile] … Use the Ashima simplex port `snoise3` / `simplex3` in `chapter-environments/shared/odyssey-tsl-noise.js` …, value noise, or a baked texture." (NB: `.claude/skills/webgpu-threejs-tsl/docs/noise-and-utility-nodes.md` still advertises `mx_*`; the gotcha table and SW's header rule win.)
- (#81) "A TSL `Fn` **without `setLayout`** is an *inline* function — its body is re-emitted at every call site (a 20-call simplex lake fragment was 113 KB)".
- (#83/#84/#85) shadow-map caster sampling its own shadow; `shadow(light)` in unlit scenes; `GodraysNode` needs a prior `renderer.render`.
- (#86) `bilateralBlur(godraysNode.getTextureNode())`, not the node.
- (#87) "A per-instance attribute read in the fragment stage is an interpolated varying … Store instance seeds as INTEGERS, `floor(seed.add(0.5))`" ; (#88) bias `floor(q.add(0.02))` on exact divisions.
- (#89) "`TypeError … 'addToStack' "VarNode.build()"` on the **WebGL2 backend only** … A `select()` whose branch holds another `select()` … with `Fn` calls such as `hash()` inside … Fold the conditions into ONE `select(a.and(b), value, fallback)` and build `value` as a `.toVar()` inside a `Fn` first." — "a WebGPU-only check misses it".
- (#90) Non-premultiplied `AdditiveBlending` adds alpha 1 → `premultipliedAlpha: true` + `outputNode = vec4(rgb, 0)` (SW: CustomBlending One/OneMinusSrcAlpha + `vec4(rgb,0)`).
- (#91) Opaque `colorNode` alpha forced to 1 → write `fragmentNode = vec4(rgb, a)`.
- (#92) World-space camera-facing ribbon culled → `side = DoubleSide`.
- (#93) "`unresolved value 'nodeUniformN'` inside a function you gave `setLayout` … The laid-out `Fn` samples a **texture** captured from the enclosing scope … Keep textures out of laid-out helpers". (#95) same for uniforms/uniformArrays: "Keep layout functions pure — pass values in as parameters".
- (#94) "Whole frame goes **black** … One fragment produced **NaN** and the bloom mip chain spread it … `pow(x, n)` with a base a hair below zero … Clamp the cosine and write small integer powers as products". (SW glass: "Schlick's Fresnel, written as products (a pow of a hair below zero is NaN)", glass 99-104.)
- (#96) "Pipeline COUNT: three creates one per mesh per pass it is drawn in … Sakura Twilight's 200 pipelines froze it for ~14 s after ready … cut passes, not materials".
- (#97) glTF without normals → `dFdx` in vertex stage; `flatShading = true`.
- (#98) atlas cell boundaries pick coarsest mip → sample a fixed `.level()`.
- (#99) "Vertex buffer count (9) exceeds the maximum number of vertex buffers (8) … on WebGPU (the WebGL2 backend draws it)" → `InstancedInterleavedBuffer`s.
- (#100) Sky dome drawn first shades every pixel → solids lower `renderOrder`, dome LAST among opaque with `depthTest = true, depthWrite = false`.
- (#101) JS `forEach` emitting TSL per element → 135 KB `main()` with 974 private vars → one TSL `Loop` over a `uniformArray` and pure laid-out `Fn`s.
- (#102) "Each `uniformArray` is its own uniform buffer and a shader stage may bind 12 (`maxUniformBuffersPerShaderStage`) … 13–15 arrays fail" (WebGPU validation; WebGL2 may still draw) → pack into ONE vec4 array.
- (#103) Screen-space shafts streaks/veil/lattice → limit emitters to the light's neighbourhood, `length ≈ 0.7`, fade last steps, stack two short marches.
- (#104) Baked fBm read at mip 0 with large gain = serrated edges → `texture(noise, uv).level(2.0)`.
- (#105) MSAA extrapolates varyings on sub-pixel strips → `clamp()` every interpolated coordinate.
- (#108) sphere-traced ground/bounding volume artefacts; (#109) nested smooth-min.
- (#110) "`uniformArray(rows, 'vec4')` copies `.x .y .z .w` from whatever objects … Keep live rows compacted at the front, pass the count in a uniform and loop `Loop({ start: int(0), end: int(count), type: 'int', condition: '<', name: 'row' }, ...)` … Give nested loops distinct `name`s."
- (#111) `fragmentNode` disables `maskNode`.
- (#112) "three's `acesFilmicToneMapping` multiplies by `exposure / 0.6` … exposure 1 is already +0.74 stop … judge colour only through the tone-mapped pipeline".
- (#113) "A render target's **v = 0 is its TOP row on both backends** … `QuadMesh`'s own uv runs DOWN the screen … A hand-made lookup `uv = p / span + 0.5` (v up) is mirrored".
- (#114) accumulation targets without ping-pong (autoClear false, CustomBlending); "Nothing may sample a target in the pass that writes it".
- (#115) marched slab clouds combed along the view → read grain once at the midplane.
- (#116) narrow `smoothstep` on fBm = confetti → wide ramps + `exp(-tau)`.
- (#117) "A part captured alone (`parts=stars&noPost=1`) is a black frame … Every additive part writes `vec4(rgb, 0)` … keep one opaque part in the frame (`parts=sky,stars`) or leave the post on."
- (#118) wrong winding → inward normals; check numerically, pin in a unit test.
- (#119) `colorNode` + `emissiveNode` both = light → double brightness.
- (#120) additive particle total light must be budgeted per tier (count × area × exposure).
- (#121) shockwave rings in a thick volume: scale depth (`z * 0.3`), hairline band, die in two frames.
- (#122) "A contrast S-curve written as `T * T * (3 - 2T)` is only monotonic on 0..1 … `clamp()` the colour to 0..1 before any polynomial curve".
- (#123) grazing-angle sparkle grid in the eye's projected coordinates from the RESTING eye.
- (#127) marched cloud contour lines from density-shell lighting.
- (#128) water mirror of an expensive sky without rendering it twice (reduced-res sky target, mirrored ray lookup).
- (#129) transparent `depthWrite:false` quads get depth-haze in-scatter → `depthWrite: true` + small `alphaTest` for opaque things.
- (#134) bloom knee must follow the iris; `u.iris` inverse-iris on event lights.
- (#135) "A tier drops a noise octave by substituting the constant `0.5` … `1 - abs(2n - 1)` of 0.5 is exactly 1 … Drop the TERM in JavaScript … capture the lowest tier".
- (#136) 2D lattice 3D noise (above).
- (#137/#138/#141) reflector cost, faceting, ripple-slope clamps (`clamp(slope, -0.09, 0.09)`).
- (#139) "three sorts by a Group's renderOrder (`groupOrder`) BEFORE any mesh's own" → leave Group order 0, set per mesh.
- (#140) skyline silhouettes: low sky = mist and brighter than anything in it.
- (#143) palette change on banded surfaces: table texture with a row per palette, per-band timing.
- (#144) lock effects behind the card are never seen → lay the board over the visible stage.
- (#147) "On a phone's small buffer (pixel ratio 0.5) every star is a blob … Author sizes for one reference frame and floor them at about a buffer pixel: `max(design × pixels, texel × least)` … The phone validator's SCREENSHOTS showed both; its verdict was 'pass'."
- (#148) star lattice in (lon,lat) cells streaks near the pole → 3D lattice cells.
- (#149) hero light reads pale: keep band round it under 1 after exposure, saturated lights with low green, whiten only hottest, bloom threshold above the brightest sky; "Look at the frame in false colour first".
- (#153) "A disc drawn in direction space … is an upright ellipse near its edge, worst on a phone's wide portrait lens" → draw in the lens's image plane.
- (#155) "a named loop hands its index over under that NAME: `({ i })` is undefined" → `({ pr: i })`.
- (#156) one light pattern for shafts + caustics; (#157) cap overlapping pools `hue / Σw³ · (Σw / (Σw + 1)) · 2`.
- (#159) pieces must be fused solids (`createShapeGeometry`/`matchShape` in `serenity-warp-glass.js`), "the user asked for them back as solid colour".
- r186 lifecycle (175-184): `compileComputeAsync` from `src/rendering/webgpu-compute-pipeline-async.js`; `await renderer.dispose()` before releasing a device; no `PCFSoftShadowMap` (use `PCFShadowMap`).
- Workflow: one small effect per session (TDR on the Windows iGPU); playground screenshot + clean console + check one low tier before porting.

### From code comments in the rebuilds
- Post: "Inline (no setLayout): `input` must stay the raw scene TextureNode for .sample()." (`-post.js:154-155`); "Hue-preserving clamp on the max channel" (159-160); "Tone mapping happens exactly once" (17-18).
- TSL: half-float mips built on CPU (`-tsl.js:371-373`); RGBA8 3D "filterable everywhere" (265); 8-bit env coding `ENV_CODE_PEAK = 8` (422-423); float-target support check (598-602); env UV orientation agreement (89-92).
- Glass: Fresnel as products (99); `safe` reciprocal of the refracted direction `t1.add(sign(t1).add(step(abs(t1), vec3(1e-6))).mul(1e-6))` (315); dormant instance (385-388).
- FX: "Nothing is created at event time and every pool is always drawn (dormant slots collapse to zero size), so the first frame compiles every pipeline." (`-fx.js:10-11`).
- Sky: rim "Sharp, but never thinner than the pixels it is painted on" (`-sky.js:208-209`); both sides of a discontinuity "blended over a pixel of whatever is painted" (124-126); star lattices dimmed by footprint `thin = min(STAR_SPREAD / want, 1)` (190-191); "Keep a feature that must stay a point on screen … in SCREEN angle" (nucleus uses `pix`, 236).
- Core: integer cell codes because "an interpolated attribute comes back with last-bit noise; it is rounded first" (176-178).
- Theme: layout reads never from handlers (483-488); clock kept across rebuild (272-275).

### WebGL2-backend vs WebGPU split to remember
WebGPU-only failures: #99 (8 vertex buffers), #102 (12 uniform buffers per stage). WebGL2-only failures: #89 (nested select with Fn). Both backends verified for: `rtt`, `QuadMesh` into targets, half-float target blending (#114), `.level(n)` reads (#104). Half-float target on WebGL2 needs the extension (SW `supportsFloatTargets`).

### 3D textures — FLAG for the cloud container
Data3DTexture is used by `serenity-warp-tsl.js:266-281,510` (gas, `texture3D(u.gasTex, p3).level(0)`), `stellar-velocity-tsl.js:326,564-566` (canyon + canyonFar), `supernova-tsl.js:199,300`. These fail on a Claude Code cloud container's headless Chromium/SwiftShader build (Data3DTexture writeTexture validation). Sunset, Ocean and Void Ember use only 2D textures. For a new theme: do NOT copy SW's gas volume; use the Void Ember 2D-lattice trick (SKILL #136; `void-ember-tsl.js:122-165,374-381`), 2D baked fBm with CPU mips (SW `createFbmTexture`), or arithmetic noise in laid-out pure `Fn`s. Also avoid `lut3D` (needs a 3D texture).

## 5. Performance practices

- Two tier tables: content `QUALITY` in `-quality.js` ("Every tier keeps the whole picture and every event") and `POST_LOOK` in `-post.js`. SW content tiers (`serenity-warp-quality.js:13-86`): `env` 256/384/512/768/1024/1024, `envEvery` 2,2,1,1,1,1; `pieces` 12/16/20/24/24/24 (`ambient` 6–12); `bevel` 1–4; `stars` 400/800/1400/2400/3400/4400; `motes` 120/220/380/600/850/1100; `skyLayers` 1/2/2/3/3/3; `detail`/`warpRead` octave toggles off on Low/Minimal (the TERM is dropped in JS, gotcha #135). Sunset (`sunset-quality.js`): sky/sea noise sizes, cloud slices 2–7, mirror slices 0–3, sea fan rings×spokes 90×64 → 300×240, lanterns 24–64, drops 160–1000. Fixed slot pools: `WAVE_SLOTS=8`, `RIPPLE_SLOTS=6`, `STREAM_SLOTS=8`, `FLARE_SLOTS=10`, `PIECE_SLOTS=24`.
- Pixel-ratio cap per tier (`-theme.js:71-78`, identical in Ocean/Sunset): Minimal 0.7, Low 0.85, Medium 1.0, High 1.15, Ultra 1.35, Extreme 1.6, multiplied through `getEffectivePixelRatio(cap, 'theme')` (global renderScale + DPR; `base-theme.js:1227-1246`).
- Post cost: bloom at 0.25–0.5 resolution scale and off on Low/Minimal; MSAA only High+ (SW, Ocean 4×) or FXAA (Sunset Medium+); fringe High+; shaft/rush taps scaled per tier; half-res `rtt(node, null, null, { resolutionScale })` for marches (Sunset 0.34–0.5, Ocean 0.25–0.5). Features off are not built (JS gating), shader branches (`If(rush > 0.004)`, `If(outside > 0.001)`, `If(u.jump > 0.002)`) skip work at rest.
- Overdraw: solids first, backdrop last among opaque with depth test (SW order 10 → 50 → additive 60–90). Env target painted only when glass visible and not on replay frames (`sim.draw !== false`), every `envEvery` frames.
- Compile time / pipeline count: laid-out pure helpers; no `mx_noise`; `Loop` over live counts instead of JS-unrolled per-element TSL; one material shared across 7 glass meshes; all pools always drawn with dormant slots so the first frame compiles everything (no mid-game hitch); single-output scene pass.
- No per-frame allocation in the frame path: preallocated slots/arrays, scratch `THREE.Vector3/Matrix4` (`_f,_r,_up,_ray,_v,_basis`), reused `_write`, `_place`, `_post`, `_sim`; uniforms written with `.value.set(...)` / scalar assignment; instance data written into one `Float32Array` per shape and `buffer.needsUpdate = true`. Event handlers allocate a few small arrays (acceptable). Minor per-frame allocations remain: theme `post.update({ time: this.time })` (`-theme.js:621`) and effect `pushPost` spreads `{ ...world.getPostState(), time }`.
- Determinism/precision: integrate rate-varying phases with dt, wrap before upload (`% 4096`, `% (2π·64)`, `% STAR_DEPTH`); integer-coded attributes; spring sub-stepped at 1/120 s.
- Frame-loop hygiene: `MAX_DELTA_S = 0.05`; `BaseTheme.safeAnimate`; pause/resume reset `lastFrameMs`; quality change → rebuild in a microtask, deferred while paused.
- Tests build node graphs without a GPU: `new THREE.WebGPURenderer({ forceWebGL: true })`, build world + post for every tier, run frames/events/teardown ("No GPU is needed: the node graphs are built, never compiled", `serenity-warp-theme.test.js:1490-1560`).

## 6. Playground effect: deterministic time and event scrubbing

### Playground runtime (`src/playground/main.js`)
- `?t=<s>` sets `fixedTime` (42-43). `tick()` (321-334): sim time = fixedTime; `simDt = min(0.05, max(0, simTime − prev))` (0 while fixed/paused).
- `applyFrame(time, dt)` (374-387): calls `current.camera(time, camera)`, then **in fixed-time mode `current.seek(time)` EVERY frame** (true phase lock), else `current.update(time, dt)`.
- First frame (700-708): `applyFrame` then `renderer.render(scene, camera)` — the RAW scene, NOT `current.render()` (unless the effect defines `renderAsync`) — then `markReady()` sets `window.__PLAYGROUND_READY__ = true`, title prefix `✓`, `playground-ready` event. The post pipeline (`current.render()`) first runs in the next `setAnimationLoop` tick (716-745). ⇒ after READY, wait several rAFs (plus compile time on SwiftShader) before screenshotting, or call `window.__PLAYGROUND__.seek(t)` which does `applyFrame` + `current.render()` (399-406).
- Agent API (594-625): `window.__PLAYGROUND__ = { setEffect, listEffects, setTime, clearFixedTime, reset, seek, seed, pause, backend, setReference, diagnostics: () => current?.getDiagnostics?.(), scene, camera, renderer, profile, ready }`. Other page params: `paused=1`, `orbit=0`, `forceWebGL=1`, `profile=1&trackTimestamp=1`, `ref=…&refMode=overlay|split|side&refOpacity`, `silhouette=1`, `hud=0`, `seed=`.
- Renderer: `new THREE.WebGPURenderer({ antialias: true, forceWebGL, trackTimestamp })` (630); pixel ratio via `computeScenePixelRatio({ maxPixelRatio: 2, sceneType: 'theme' })`.
- Headless SwiftShader launch flags already used in repo (`scripts/capture-breathing-headless.mjs:69-77`, Playwright): WebGPU `['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist']`; WebGL2 `&forceWebGL=1` with `['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']`. It also has an `--shaders` initScript that reports the largest WGSL modules. (`scripts/playground-capture.mjs` is Electron, settle 350 ms default.)

### `serenity-warp.effect.js` (the template to copy)
Header (8-29) documents every param. Contract: `export const meta = { id: 'serenity-warp', title, description }`; `export function create({ scene, camera, renderer, params })` returns `{ cameraRadius, camera(time, cam), update(time, dt), seek(time), render(), resize(), getDiagnostics(), dispose() }` (301-343).
- World built as a capture: `new SerenityWarpWorld({ scene, quality, capture: true, renderer }).build(); world.bindCamera(camera); world.setReducedMotion(params.get('reduce') === '1'); if (parts) world.showOnlyParts(...)` (132-138).
- `quality=` → tier + `POST_LOOK[quality]`; `bloom=0|1` overrides (a tier without bloom borrows `POST_LOOK.Medium.bloomStrength`) (140-145); `noPost=1` → no post, `renderer.toneMapping = AgXToneMapping` (146-151); `falseColor=1`.
- `board=1` → `mountBoardOverlay(statsHud !== '0')` (51-85): DOM mock with the REAL selectors (`.player-card[data-player="solo"]`, `#single-player-game-canvas`, `.single-player-stats-bar`) sized by the stylesheet formula `BOARD_PX = 'min(clamp(220px, 22vw, 300px), (100vh - 250px) / 2)'`; `syncViewport()` (157-167) then does `readLayoutRects()` → `world.setLayout(rects, aspect)` and `post.setCalmRects([...rects.cards, rects.hud].filter(Boolean), rects ? 1 : 0)` — so events aim at the mock board and calm zones are exercised.
- `px=`, `py=` hold pointer parallax; `icon=1` (176-189): after the rig, `camera.fov = iconFov (34)`, `camera.lookAt(pos − 10 z)`, `rotateY(iconYaw)`, `rotateX(iconPitch)`, recompute `world.u.pixelAngle` (capture a square frame for the icon).
- `frame(time, delta, draw)` = `world.updateCamera(camera, sim(time, delta)); aimIcon(); world.update(sim(time, delta, draw), camera)` (190-194); `stepTo(from, to, dt)` replays fixed steps with `draw=false` "Only the last frame of a replay is looked at: the others need not paint the sky" (195-200).
- `seekTo(time)` (243-267):
```js
const lead = (eventName ? eventAge : 0) + 9 + warmLocks * 0.6;
const start = Math.max(0, time - lead);
world.seek(start);
if (level > 1) world.levelUp(level, { silent: true });
if (holdCombo > 0) world.onCombo(holdCombo);
frame(start, 0, false);
// locks=<n>: lockAt(i) every 0.6 s from start+0.5, stepping 0.1 s between (never past the event)
if (eventTime > cursor) stepTo(cursor, eventTime, 0.1);
if (eventName) { fireEvent(); stepTo(eventTime, time, 1 / 120); }
frame(time, 0);   // draw=true: env painted
pushPost(time);   // post.update({ ...world.getPostState(), time })
```
- `event=lock|drop|clear|quad|tspin|perfect|levelUp` with `eventAge=` (default 0.4 s), `lines=` (1–4, default 2), `row=` (default 9), `u=` (default 0.3), `color=<hex>` (default the piece's theme colour), `piece=I|O|T|S|Z|J|L` (default T), `turns=` quarter turns (cells via `turnCw` matrix rotation, 91-99), `eventLevel=` (default level+1) (211-230). `combo=<n>` holds a chain; `level=<n>` rests on that palette; `locks=<n>` pre-plays n locks.
- `demo=1` (live only): 40 s looping script of locks/clears/combos/quad/T-spin (102-123, 269-299), `world.resetSession()` per loop; breaks chains on schedule.
- `getDiagnostics()` → `{ backend: 'WebGPU'|'WebGL2', calls, triangles, ...world.getState() }`.
- `dispose()` removes overlay, disposes post + world, restores `toneMapping`, `fov/near/far`.

### Param registration/validation (`src/ui/url-parameters/playground-parameters.js`)
- `PLAYGROUND_URL_PARAMETERS` is a flat array of `{ name, category: 'Playground', scope: 'playground.html — <effect ids…>', description, values, defaultValue, example, notes, sources: ['src/playground/effects/<id>.effect.js', …] }`; aggregated into `URL_PARAMETER_CATALOG` by `src/ui/url-parameters/catalog.js`. Shared entries (e.g. `event` 1033-1105, `eventAge` 1106-1168, `eventLevel` 1169-1210, `piece` 3100-3115, plus `board, combo, level, locks, lines, row, u, color, turns, quality, reduce, parts, px, py, bloom, noPost, falseColor, statsHud, demo, icon, iconFov, iconYaw, iconPitch`) list every effect in `scope` AND `sources`. SW's documented set exactly equals what the effect reads: `bloom board color combo demo event eventAge eventLevel falseColor icon iconFov iconPitch iconYaw level lines locks noPost parts piece px py quality reduce row statsHud turns u`.
- Validation: `tests/unit/url-parameter-catalog.test.js` (every field non-empty, `example` parses and contains the name, no duplicate `name:scope`, every `source` file exists, literal `new URLSearchParams(...).get/has` reads in listed sources are catalogued). Per-theme tests enforce effect coverage by regex — e.g. `tests/unit/geode-theme.test.js:897-915`: reads `params.(get|has)('x')` and `num(params, 'x'` from the effect source, requires `URL_PARAMETER_CATALOG.filter(e => e.sources.includes(file))` names == reads, and `entry.scope` matches `/\bgeode\b/`; `tests/unit/ocean-playground.test.js:26-37` pins a `PARAMETERS` list and that each is named in the effect header, the effect imports only `three/webgpu` + its own theme modules, builds exactly one `new OceanWorld({... capture: true ...})` and one `OceanPost`, and returns `camera, update, seek, render, resize, getDiagnostics, dispose`.
- Theme capture flags (`<prefix>Time/FixedDt/Parts/FalseColor/ForceWebGL`) come from one row in `captureThemes` in `src/ui/url-parameters/theme-parameters.js` (array 64-185, generator 187-226); sources must be `src/themes/<id>/<id>-theme.js` and `src/themes/<id>/<id>-world.js` (file naming must follow `<id>-theme.js` / `<id>-world.js`).

### Screenshot recipe implied (for a cloud container; full scripts in PLAYBOOK §5)
`/playground.html?effect=<id>&t=<s>&quality=High[&board=1][&event=clear&lines=2&eventAge=0.5][&level=3][&combo=4][&locks=6][&icon=1]` (+ `&forceWebGL=1` for the WebGL2 leg) → wait `window.__PLAYGROUND_READY__` → wait N rAFs or `__PLAYGROUND__.seek(t)` → screenshot → read console for WGSL/validation errors → read `__PLAYGROUND__.diagnostics()`. Capture portrait (e.g. 390×844) and Low/Minimal tiers too (gotchas #71, #135, #147).

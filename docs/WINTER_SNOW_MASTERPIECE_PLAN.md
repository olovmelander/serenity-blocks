# Winter Theme — Falling Snow Masterpiece Plan ("Inside the Weather")

**Status:** Planning (0% built). Plan-first — no snow code until approved.
**Date:** 2026-06-17
**Author:** Claude (Opus 4.8), from a 5-agent research/investigation sweep (3 web dossiers: AAA technique survey, WebGPU/TSL implementation, cinematic art-direction; 1 codebase dossier; 1 synthesis).
**Goal:** Replace the current flat, weak falling snow with a **4-tier, camera-relative, GPU-compute snow system** that surrounds the moving camera with real near/mid/far depth plus cinematic foreground bokeh — AAA-grade, beautiful, and performant.

**Scope:** `src/playground/effects/winter-wonderland.effect.js` `buildSnow()` (the theme is a thin wrapper around this effect). Playground-first, screenshot-verified per `CLAUDE.md`.

---

## 0. TL;DR

- **Diagnosis:** today's snow is a *single* `THREE.Points` cloud (~4,200 points) in a **fixed world box** that doesn't follow the camera, with **one flat color**, **no depth layers**, **no sprite shape**, **mechanical sin/cos sway**, and **no scene-light interaction**. That's exactly why it reads small, flat, and detached. ([winter-wonderland.effect.js:139-179](../src/playground/effects/winter-wonderland.effect.js))
- **The fix is layering + camera-relative volume + billboards, not raw count.** The look needs ~**14–22k** flakes, not 100k. Depth comes from **4 distinct tiers** (far mist-grain → mid body → near hero crystals → foreground bokeh), each with its own size/speed/color/blend.
- **Architecture = fork our proven StardustSim spine:** storage buffers → TSL `Fn().compute(count)` → `InstancedMesh` camera-facing billboards, dispatched via `renderer.compute()` in `update()`. Already battle-tested in [stardust-particles.js](../src/themes/starlight/sim/stardust-particles.js) + [stardust-renderer.js](../src/themes/starlight/rendering/stardust-renderer.js) + [starlight-stardust.effect.js](../src/playground/effects/starlight-stardust.effect.js).
- **Critical gotcha:** in WebGPU, `THREE.Points` are **1-pixel primitives and `sizeNode` is ignored** (confirmed in [winter-snow-crystals.effect.js:6-9](../src/playground/effects/winter-snow-crystals.effect.js)). So every *visible* flake must be an **instanced billboard quad** — the only path to sized, shaped, tumbling, glinting snow. Points survive only as optional sub-pixel FAR filler.
- **Motion:** gravity + divergence-free `curlNoise3` turbulence ([tsl-noise-lib.js:123](../src/themes/starlight/materials/tsl-noise-lib.js)) + a gusting breeze (amplitude breathing over ~25s) + per-flake tumble. Snow swirls and drifts instead of falling on rails.
- **Lit by the scene:** near/bokeh flakes catch a **moonlight backlit halo + sharp specular glint** (toward `MOON_POS`) and a faint **aurora-emerald kiss** (wired to `aurora.uniforms.uIntensity`), and the far tier **dissolves into the existing snow-mist** (`0xbcd3e3`). One painting.
- **v1 stays single-pass** (NoToneMapping, look baked into materials, like the rest of the scene). **Soft-particles + bloom are deferred** to an optional RTX-only phase to protect the TDR-sensitive dev iGPU.

---

## 1. Vision — "Inside the Weather"

Today the snow is *in front of* a winter scene. The goal is to put the player **inside** it: enveloping, three-dimensional snowfall with a tangible foreground, a swirling readable mid-body, and a soft far veil that melts into the night haze — all reacting to the moon and aurora. Calm enough to play Tetris in front of for an hour, beautiful enough to stop and watch.

### Design pillars
1. **Depth by stratification, not count.** Four tiers with distinct size / fall-speed / sway / color-temp / blend. Layering is the cheapest, highest-impact 3D cue and is universal in AAA (Niagara, Witcher, RDR2).
2. **Camera-relative infinite volume.** Spawn/respawn boxes centered on the *live* camera (a `uniform vec3`) so the breathing+parallax camera is always enveloped and never out-runs the snow edge.
3. **Instanced billboards over points.** Camera-facing quads reading storage buffers → size attenuation, snowflake shape, tumble, twinkle, and glint all become possible.
4. **Choreographed organic motion.** Gravity + `curlNoise3` + gusting breeze + tumble, not fixed-frequency sines.
5. **Atmospheric harmony.** Far tier desaturates and fades into the snow-mist tint; cool blue-white palette (never pure white — matches night vision / Purkinje effect).
6. **Moonlight as a character.** Backlit halos + specular glints toward `MOON_POS`, plus an aurora-emerald rim — snow lit *by* the scene.
7. **Graceful degradation.** One quality knob scales counts/features; WebGL2 / no-compute falls back to the current vertex-animated Points path so the theme never hard-fails.

---

## 2. The four tiers

| Tier | Role | Count (High) | Flake style | Motion | Depth behavior |
|---|---|---|---|---|---|
| **FAR — mist-grain veil** | Atmospheric backdrop that dissolves into the snow-mist banks + fog-blued peaks; gives the sky "weather" without discrete flakes. | ~7,000 (cheap `Points`, reuse current vertex path — sub-pixel so the 1px limit is *correct* here) | Tiny soft radial Gaussian, 2–4px; color `mix(white, mist 0xbcd3e3)` ~0.6 toward mist; opacity 0.15–0.3. | Slow fall (~30–45 u/s), wide gentle curl drift, minimal tumble. | Alpha → 0 with distance (smoothstep ~1800→3200) so it merges into haze; tall wide cam-relative box (~5000×3000×3000). |
| **MID — the body** | The main readable snowfall filling the frame; the parallax mid-plane against lake/treeline. | ~6,000 billboards | Soft disc + faint 6-point-star SDF, 6–14px; `0xf5f8ff` ±15% per-flake brightness; opacity 0.4–0.7. | Fall ~55–75 u/s, `curlNoise3` + breeze gust, lazy z-tumble, hashed twinkle. | `size = base·k/viewZ` (manual node); mild distance alpha fade; box ~4200×2800×2600. |
| **NEAR — hero crystals** | Tactile, sharply-lit flakes that sell "3D" and catch the moon — the emotional hero. | ~1,500–2,200 billboards | Distinct 6-point snowflake SDF (or 4-shape atlas), 18–60px; bright `0xd8f0ff` core + moonlit rim + aurora kiss; full tumble; opacity 0.7–0.95; a subset gets a sharp glint spark. | Fast fall ~70–100 u/s, widest sway, strongest gust response, visible tumble; velocity-driven size/brightness → gusts produce bright flurries. | Largest size swing; tight cam-relative box near the eye (~1400×1200×1200); age bell-curve fade prevents respawn pops. |
| **FOREGROUND — bokeh lens flakes** | Cinematic shallow-DOF artifact: a few huge soft out-of-focus blobs catching moon/aurora light, framing the shot — the instant "pro VFX" tell. | 12–20 billboards only | Very large (80–220px) soft disc with a subtle bright iris-ring (procedural bokeh, no texture); additive; opacity 0.08–0.22; moon-white + aurora-emerald tint. | Very slow drift + slow rotation; lazy vertical fall with big lateral sway; respawn off-frame. | Spawned 60–260u in front of camera in a thin slab; **intentionally not** size-attenuated (stays big = out of focus); additive so it glows, not occludes. |

---

## 3. Architecture & file plan

Fork the StardustSim spine into a winter snow module (modular like the rest of `src/themes/winter/`):

- **`src/themes/winter/sim/snow-sim.js`** ← adapt [stardust-particles.js](../src/themes/starlight/sim/stardust-particles.js). Storage layout (3× `vec4`): `position+age`, `velocity+lifetime`, `color+energy`. Strip the 8-slot impulse system. Force model = gravity + `curlNoise3(pos·0.03..0.06, time)·strength` + gusting `breeze` uniform; camera-relative respawn (hash-scatter XZ on age overflow, stardust pattern lines 206–218).
- **`src/themes/winter/rendering/snow-renderer.js`** ← adapt [stardust-renderer.js](../src/themes/starlight/rendering/stardust-renderer.js). `InstancedMesh(PlaneGeometry(1,1), MeshBasicNodeMaterial, count)`; camera-facing billboard `vertexNode` (lines 59–78); fragment = 6-point-star SDF / Gaussian / bokeh-ring variants, twinkle (hashed phase/freq, lines 94–98), age bell-curve fade (lines 101–102), moon glint/halo, aurora kiss, distance fog mix. Per-tier blend + `renderOrder`.
- **`src/playground/effects/winter-snow-storm.effect.js`** (NEW testbed) → then port into **`winter-wonderland.effect.js`** (replace `buildSnow`).

**Reusable TSL compute API (confirmed in repo, r181):** `StorageBufferAttribute(Float32Array, itemSize)` → `storage(buf, 'vec4', count)` in `Fn()` → `.element(instanceIndex)` read/`.assign()` write → `Fn(()=>{…})().compute(count)` → `renderer.compute(node)` in `update()`. `create()` must **destructure `renderer`** and gate on compute capability exactly like [starlight-stardust.effect.js:31-42,60](../src/playground/effects/starlight-stardust.effect.js).

### Key technique choices (with rationale)
- **Billboards for all visible tiers; Points only for sub-pixel FAR** — WebGPU Points ignore `sizeNode`.
- **Hybrid blending:** FAR/MID `NormalBlending` (sit into the cobalt sky, match snow-mist); NEAR core normal + glint additive; BOKEH additive. All-additive blows out white overlaps and kills depth.
- **Procedural 6-point-star SDF** (`cos(6·θ)` radial mask) for MID/NEAR; soft Gaussian for FAR/BOKEH. Zero texture load, mip-free. A 4–8 shape sprite atlas is later polish.
- **`dt` clamped** (`min(delta, 0.033)`) like StardustSim to prevent gust/integration blowups on frame hitches.

---

## 4. Implementation phases (playground-first, screenshot-verified)

| Phase | Work | Verify |
|---|---|---|
| **P0 — Standalone testbed** | NEW `winter-snow-storm.effect.js`: cobalt bg + moon marker + ONE tier (MID) as compute billboards forked from StardustSim. Strip impulses; force = gravity+curlNoise3+breeze; world-fixed respawn first. | `?effect=winter-snow-storm&t=6`; wait `__PLAYGROUND_READY__`; screenshot; read console for WebGPU validation / "compute failed". Expect drifting billboard flakes, no errors. |
| **P1 — Shape + color + motion** | 6-point-star SDF, `0xf5f8ff` ±15% variation, hashed twinkle, tumble, gusting breeze (sin over ~25s). Tune fall/sway/`size=base·k/viewZ`. Lock to `PAL`. | Phase-locked shots `t=2,6,12`: confirm swirl (not rails), gust breathing, reads as snowflakes. |
| **P2 — Camera-relative respawn** | `uniform(cameraPos)`; respawn box centers on camera each frame; wrap Y, hash-scatter XZ. Drive testbed camera with the SAME breathing+parallax as winter-wonderland (`camera()` lines ~643–676). | Drive camera across a sway cycle; confirm no volume edge / density gaps. |
| **P3 — Multi-tier composition** | Instantiate FAR/MID/NEAR + BOKEH with per-tier params; FAR as cheap Points; NEAR bigger SDF + glint; BOKEH 12–20 additive iris discs in a front slab; `renderOrder` far→near. Moon glint/halo + aurora-emerald kiss; far color → mist `0xbcd3e3` + distance alpha. | 2–3 phase-locked shots: clear near/mid/far parallax, foreground bokeh catching light, glints on near flakes, far dissolving into haze. Perf check. **One small session (TDR caution).** |
| **P4 — Quality scaling + fallback** | Single quality knob (Low ~6k / Med ~10k / High ~15k / Ultra ~22k) → per-tier counts + feature flags (bokeh+glint off on Low). No-compute → fall back to current vertex Points for MID+FAR. | Screenshot Low & Ultra; `?forceWebGL=1` still renders (degraded), no console errors. |
| **P5 — Port into the real scene** | Replace `buildSnow(4200,…)` + its add/dispose/update wiring in `winter-wonderland.effect.js` with the proven system. Add `renderer` to `create()` destructure + `renderer.compute()` per tier in `update()`; wire camPos + aurora uniforms; dispose all tiers. | `?effect=winter-wonderland&t=8` vs current: full scene still composes AND snow has depth+bokeh+glint, harmonizes with snow-mist, no errors. **Single short session.** |
| **P6 — OPTIONAL (later, RTX-only)** | Scene-depth-texture **soft-particle** fade at geometry intersections; localized **bloom** on near glints + bokeh. Gate behind a flag; never on iGPU. | Smooth fades where snow meets treeline/peaks; perf trace <2–3ms added; abort on any instability. |

---

## 5. Performance plan

Target = RTX 5080 laptop (173–240fps headroom), but degrade gracefully. **Budget by impact, not raw count.** High tier ≈ FAR ~7k (cheap Points) + MID ~6k + NEAR ~2k + BOKEH ~16 ≈ **~15k**. StardustSim runs 18–30k billboards in ~2ms on this GPU class and snow forces are *simpler* (impulse loop stripped), so compute should stay **<1–1.5ms** and render is a handful of draw calls (1/tier).

LOD levers in priority order: (1) tier counts via the quality knob; (2) `curlNoise3` sample frequency (FAR can skip curl, use cheap sin sway); (3) bokeh + glint feature flags (off below High); (4) SDF complexity (FAR = plain Gaussian). Overdraw guard: keep NEAR sparse (biggest flakes = fewest), `depthWrite=false` on all tiers with explicit `renderOrder` far→near to avoid sort thrash. No extra render passes in v1. Defer soft-particle depth pass + bloom (each ~10–15% / 2–3ms) to the optional RTX-only phase.

---

## 6. Risks & mitigations

- **WebGPU Points `sizeNode` ignored** → billboards for all visible tiers; Points only sub-pixel FAR.
- **TDR/iGPU crash** (CLAUDE.md + memory: full-journey captures bluescreened the dev machine) → one small effect per session, phase-locked `?t=` shots, never capture the whole journey; do heavy iteration in the standalone testbed.
- **Additive blowout** → hybrid blending (Normal body, additive only glints/bokeh).
- **Respawn pops** → age bell-curve fade-in; hash-scatter across the whole box, not the seam.
- **Double-darkening far snow** (distance alpha + mist mix) → smoothstep (not linear); test against the real mist bands.
- **Forgot `renderer.compute()`** (winter-wonderland's `create()` doesn't currently destructure `renderer`) → copy the exact gate+dispatch from starlight-stardust.
- **Tumble vs billboard** → rotate the quad offset in **view space** before projection, or flakes go edge-on and vanish.
- **Disposal leaks** → current `dispose()` handles only `snow.points`; must track + dispose all 4 tiers (sims + meshes).

---

## 7. Open questions (for sign-off)

1. **Default shipping quality** — is High (~15k) the default, or should the theme inherit a named performance-policy tier like Odyssey/Starlight (the repo caps pixelRatio per scene)?
2. **FAR tier** — 4th compute buffer (uniform code path, camera-relative) or cheaper existing vertex Points (less code, world-fixed edge)? *Leaning Points for v1.*
3. **Flake variety** — procedural 6-point SDF enough, or author a 4–8 shape 256² sprite atlas? (Note: per memory, winter snow assets aren't all tracked in git — an atlas needs explicit `git add`.)
4. **Aurora tint strength** — a subtle emerald kiss unifies the palette; too much looks green. Screenshot judgment call.
5. **Soft-particle pass (P6)** — worth it given snow mostly falls in open air over the lake and the framing trees are at the edges? May be low ROI vs TDR risk.
6. **Gusts** — purely procedural, or event-reactive (drive flurries from line-clears via one retained impulse slot)? Stripping simplifies; keeping one slot enables gameplay-driven snow later.

---

## 8. Key sources

- **three.js — WebGPU Compute Particles Snow** (the canonical reference): https://threejs.org/examples/webgpu_compute_particles_snow.html
- **GPGPU Particles with TSL & WebGPU** — Wawa Sensei: https://wawasensei.dev/courses/react-three-fiber/lessons/tsl-gpgpu
- **Field Guide to TSL and WebGPU** — Maxime Heckel: https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/
- **Crafting a Dreamy Particle Effect (GPGPU)** — Codrops: https://tympanus.net/codrops/2024/12/19/crafting-a-dreamy-particle-effect-with-three-js-and-gpgpu/
- **Snowflake Particles: When Points Just Aren't Enough** — Marinacci: https://medium.com/@joshmarinacci/snowflake-particles-when-points-just-arent-enough-4593023bbff6
- **Curl Noise (Bridson, SIGGRAPH 2007)**: https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph2007-curlnoise.pdf
- **Soft Particles**: https://nickthecoder.wordpress.com/2012/08/15/soft-particles/
- **Point Sprites vs Instanced Billboards** — Geeks3D: https://www.geeks3d.com/20140929/test-particle-rendering-point-sprites-vs-geometry-instancing-based-billboards/
- **Seasons [TSL, Sprite + PointsNodeMaterial]** — three.js forum: https://discourse.threejs.org/t/seasons-tsl-sprite-pointsnodematerial/77973
- **Real-time Particle-based Snow Simulation on the GPU** (paper): https://www.diva-portal.org/smash/get/diva2:1320769/FULLTEXT01.pdf
- **Internal references:** [stardust-particles.js](../src/themes/starlight/sim/stardust-particles.js), [stardust-renderer.js](../src/themes/starlight/rendering/stardust-renderer.js), [starlight-stardust.effect.js](../src/playground/effects/starlight-stardust.effect.js), [winter-snow-crystals.effect.js](../src/playground/effects/winter-snow-crystals.effect.js), [tsl-noise-lib.js](../src/themes/starlight/materials/tsl-noise-lib.js).

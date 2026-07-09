# Winter Theme — AAA Review & Improvement Roadmap (2026-06)

> **Ask**: a beautiful, visually-stunning, AAA winter theme with **northern lights**,
> **stormy weather**, and **snowflakes swirling around**.
>
> **Method**: 7-subsystem multi-agent code review (map → adversarial critique → synthesis)
> cross-checked against a firsthand read, then playground-first prototyping with WebGPU
> screenshot verification (per `CLAUDE.md`). Supersedes the now-archived
> `WINTER_AAA_PLAN.md`, most of which **shipped** — this records what's left.

---

## 1. Executive summary — where it actually stands

The winter theme is **not** a basic theme. The archived "Living Blizzard" rebuild largely
landed: the `StormDirector` intensity spine, the GPU **curl-noise snow field**
(`sim/storm-field.js`), the modern **TSL `PostProcessing` graph** (`post/winter-pipeline.js`
— bloom, ACES, cold grade, frost, grain), and relit moon/mountains all exist and are good.

But the **one part billed as the hero — a volumetric aurora — was abandoned to a 2D Canvas
painting** after a WebGPU white-screen bug, and that one fallback cascades into the theme's
biggest quality cap. Per-pillar grades from the review:

| Pillar | Grade | One-line verdict |
|---|---|---|
| **Northern Lights** | **D (≈4/10)** | Hero is a CPU `Canvas2D` texture on a sphere **+ a second** flat-plane TSL curtain — two overlapping, non-volumetric auroras. The headline element is the weakest. |
| **Stormy Weather** | **C (≈5–6/10)** | Excellent sim spine, but the 3-act **peak is hollow on WebGPU** (blizzard/lightning/vortex/crash all early-return on WebGPU; whiteout only dims exposure; the arc rarely crosses the whiteout threshold). |
| **Swirling Snow** | **C+ (≈6/10)** | Genuinely AAA **motion** (divergence-free curl field). But the **look** lags: round blobs not crystals, no per-flake spin, flat XY-only swirl, near/far flakes on different wind formulas. |
| **Overall AAA** | **C (≈5/10)** | Strong bones; the aurora + a few systemic toggles are what hold it back. |

### The one finding that unlocks the most: `useMRT:false`

`WinterPipeline` is constructed with **`useMRT:false`** (`winter-theme.js:2858`) because the
canvas sky-shell drops out of the MRT path. Consequence: **emissive bloom is disabled
scene-wide** — bloom keys off a dumb `0.9` luminance threshold on the tonemapped output,
and every material's carefully-authored `emissiveNode` glow (aurora ribbons, moon, halo, ice
glints) is **wasted**. Replacing the canvas aurora with a clean GPU/TSL dome that survives
MRT lets us flip `useMRT:true` and light up **aurora + moon + glints** bloom all at once.
This is the highest-leverage change in the whole theme and it directly serves Pillar #1.

---

## 2. Art-direction north star

A wide, deep arctic night. A **dancing volumetric aurora** owns the upper third — desaturated
**whitish-green** base with a green→teal→magenta vertical drift, a luminous ground-glow where
it meets the ridgeline, throwing soft light down into the falling snow. Below, **snow drives
across the frame in wind-shaped sheets**, large soft crystals near the lens, hazing to the
horizon. A cold **moon** is the key light, its halo blooming as a soft HDR core. The whole
frame **breathes**, and **the blizzard IS the game's intensity**: calm starlit fall when idle,
rising wind on combos, an earned **whiteout** at the peak, then exhale on game-over.

Palette correction from the review: the current aurora emerald `[0.08,1.0,0.34]` is
**over-saturated**; real aurora is whitish-green. The new prototype grades toward that.

---

## 3. Highest-leverage upgrades (ranked)

1. **★ Volumetric aurora (the hero).** Replace BOTH the `Canvas2D` sky-shell
   (`rendering/aurora-volume.js`) and the flat-plane ribbons (`createAuroraSystem`,
   `winter-theme.js:1600`) with **one** raymarched TSL aurora authored in a NodeMaterial
   `colorNode`+`emissiveNode` (domain-warped multi-octave noise curtains, vertical rays,
   green→teal→magenta drift, luminous ground-glow). **Effort: deep. Status: PROTOTYPED &
   PROVEN — see §5.**
2. **★ Flip `useMRT:true`** once the aurora survives MRT, and drop the `0.9` bloom threshold,
   so aurora/moon/glints get real isolated HDR bloom (`winter-pipeline.js:63-77`). **Quick win
   once #1 lands.**
3. **Set `renderer.toneMapping`** (AgX or ACES) as a single HDR source of truth so the WebGL
   and no-post paths stop hard-clipping; let bloom work in HDR before the tonemap
   (`initRenderer:1135-1159`, `winter-pipeline.js:125-147`). **Medium.**
4. **Fix `targetFps:120` on every WebGPU preset.** On 60Hz/vsync displays the LOD controller
   permanently parks the theme at reduced pixelRatio + decimated snow + fewer aurora/fog
   layers — quietly capping all three pillars. Derive target from the actual refresh
   (preset `targetFps`, `updatePerformance:3518`). **Quick win, big real-world impact.**
5. **Snow look** (motion is already great): render the main GPU cloud as **rotating atlas
   crystals** with a far-haze alpha floor; add **soft-particle** depth fade + velocity
   motion-blur streaks under high wind; unify near/far flakes onto the **shared wind field**
   (`winter-materials.js:302-389`, `storm-field.js`, `winter-theme.js:3654-3742`). **Medium.**
6. **Make the storm peak real on WebGPU**: a TSL volumetric snow-fog sheet + an **additive
   whiteout flash** in `winter-pipeline.js` (today whiteout only dims exposure), and lower the
   whiteout threshold / raise combo bumps so Act 3 is actually reached. **Medium.**
7. **3D curl** for snow (XY→3D divergence-free) so it eddies through depth, not a flat sheet
   (`storm-field.js:126-144`). **Medium.**
8. **Dead-code cleanup** (no visual change, removes traps): `winter-compute.js`
   (`SnowParticleCompute`) is orphaned — the live compute is `StormField`;
   `createWinterSkyNodeMaterial` is never imported; ice-wisp + fog are duplicated in both
   `winter-materials.js` and `winter-shaders.js`; several GLSL shaders never instantiate.

---

## 4. Playground-first roadmap (one small effect per session — TDR-safe)

Each session = one isolated effect under `src/playground/effects/<id>.effect.js`,
screenshot-verified via chrome-devtools MCP (`window.__PLAYGROUND_READY__`), then ported.

| # | Effect id | Visual goal | Success / screenshot check | Port target |
|---|---|---|---|---|
| **1 ✅** | `winter-aurora` | Volumetric dancing curtains, whitish-green + ground-glow, accent flare | **DONE** — distinct ribbons, rays, dark gaps, dances over time, no console errors, lint clean | `rendering/aurora-volume.js` (replace canvas) + delete `createAuroraSystem` ribbons |
| 2 | *(port + integrate)* | Aurora dome wired to `StormDirector` (intensity/flare/whiteout/accent), `useMRT:true`, `renderer.toneMapping` | User board capture: aurora reads, moon/glints bloom, no white sky, ≥60fps | `winter-theme.js` createSkyBackground / setupPostProcessing |
| 3 | `winter-snow-crystals` | Rotating atlas-crystal sprite + far-haze floor + soft-particle + wind streak | Reads as snowflakes, not blobs; streaks under wind | `createWinterSnowNodeMaterial` |
| 4 | `winter-whiteout` | Additive radial whiteout flash + snow-fog sheet for the storm peak | Peak flash reads; recovers; doesn't occlude board center | `winter-pipeline.js` + storm hooks |
| 5 | `winter-moon` | HDR moon disc + soft bloom halo + TSL god-rays (port the WebGL-only rays) | Soft HDR core, rays scatter in fog | `createWinterMoon*` |

> ⚠️ **Capture constraint**: the live WebGPU **board** can't be auto-screenshotted headless and
> full-journey captures have TDR-crashed this machine's iGPU. The **playground** is the safe
> path (single small effect). Live-theme ports (sessions 2,4,5) are verified by **user capture**
> in their desktop session — batch code changes before asking for a re-capture.

---

## 5. Session 1 status — aurora PROVEN ✅

`src/playground/effects/winter-aurora.effect.js` (nimitz/iq layered-slab march in TSL):
**compiles and renders cleanly on this machine's WebGPU** (no white-screen, no validation
errors — this is the key proof, since the white-screen bug is exactly what forced the canvas
fallback). Shots in `.playground-shots/winter-aurora-0*.png` show green volumetric curtains
with vertical rays, dark sky gaps, a luminous base, and motion between `t=8` and `t=22`.

Open items before porting (Session 2): it's a full-res 42-step march (~20fps fullscreen on
the dev box) — for the port, **half-res + ~28–32 steps**, render only above the horizon, and
wire `uTime/uIntensity/uFlare/uAccent` to the `StormDirector` snapshot (the canvas
`auroraVolume` already exposes exactly these uniforms, so the theme plumbing is unchanged).

---

## 6. Risks & sequencing

- **MRT flip regressions**: the canvas shell was the reason MRT was off. Port aurora to a
  proper `emissiveNode` dome **first**, confirm it survives MRT, *then* flip — don't flip blind.
- **TDR / perf**: half-res the aurora march from the start; keep the LOD controller pointed at
  march steps + particle count before pixelRatio.
- **WebGL parity**: keep the simplified WebGL fallback intact; new TSL aurora is WebGPU-only,
  WebGL keeps the existing flat curtain.
- **Order**: 1 (done) → 2 (aurora port + MRT + tonemap + targetFps fix — the big visual jump)
  → 5 (moon bloom) → 3 (snow look) → 4 (whiteout peak) → 7/8 (3D curl, cleanup).

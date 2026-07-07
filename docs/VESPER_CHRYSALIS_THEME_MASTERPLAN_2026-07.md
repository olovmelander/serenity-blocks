# Vesper Chrysalis — Living Theme Masterplan

*A hatching at dusk. One scene that wakes as you play.*

Status: **M0–M3 BUILT & VERIFIED IN-GAME (2026-07-06).** A real, selectable, living
`vesper-chrysalis` theme renders in the game on WebGPU with the full cinematic look:
Dormant tableau + gameplay-driven escalation, the **post pipeline** (threshold bloom +
violet-ember ACES grade + vignette + grain), and the **Ascension aurora veil** (wing of light
that unfurls at high S). Zero console errors; ~98fps full detail on RTX. Remaining (M4 + polish):
6-tier perf scaling + adaptive DRS + WebGL-fallback validation (reflector/bloom/shard tier-gating
for the low-end AMD 610M), the Cosmos reveal (monolith + planets) + GPU ember field, and a bespoke
selector icon (currently a stellar-drift placeholder). Author: design pass 2026-07-06.
Inspiration: [hatom.com](https://www.hatom.com/) (Immersive Garden, Paris — Awwwards SOTD Nov 2024).
Decision locked with user: **one living gameplay theme** under `src/themes/` (NOT an Odyssey chapter);
**our own mythos in Hatom's art direction** (no griffin, no DeFi branding).

---

## 0. What we're borrowing (and what we're not)

The Hatom site is a scroll-driven **5-phase creature mythology**: a glowing egg over a twilight
bioluminescent lake → the egg cracks and floods with molten light → an armored griffin rises →
a neon city → cosmic expansion across planets. Built with Three.js + GSAP + Lenis + Blender assets,
a progressive preloader, and a long-press that reveals alternate environment variants.

**We borrow the SOUL, not the IP:**

| Borrow (the DNA) | Discard (their brand) |
|---|---|
| Violet/indigo base · magenta-pink horizon · molten-amber relic core · icy-cyan translucent highlights | The griffin (we use our own spirit) |
| A dormant luminous relic on a mirror-still twilight lake, ringed by crystal shards & silhouette peaks | DeFi / token / HTM iconography |
| Volumetric god-rays, drifting embers, film grain, cinematic color grade | The 5 *separate worlds* / literal scroll |
| The **metamorphosis arc**: dormant → crack → light-spill → ascension | Vue/Nuxt/Lenis scroll stack |

**The key reinterpretation:** Hatom expresses the arc through *scroll position* across five separate
scenes. We express it through **gameplay progression** inside **one cohesive scene** — the myth
escalates as you clear lines, build combos, and level up. This is the same technique your
**Winter Blizzard combo** already proved (`src/themes/winter/composition/storm-director.js`): one eased
scalar `S` + transient flares drive the whole world. It "lives," stays performant, and never occludes
the board.

---

## 1. Name & identity

**Theme name (lead): `Vesper Chrysalis`**
- *vesper* = the evening/twilight star · *chrysalis* = the dormant relic that metamorphoses.
- Names the whole idea in two words: **a hatching at dusk.** Sits naturally beside *Halcyon Apex*,
  *Stellar Drift*, *Cosmic Noir*.
- Theme id: `vesper-chrysalis` · displayName: `Vesper Chrysalis` · group: `fantasy`.

*Alternates if you'd rather:* **Aurelian Veil** (*aurelia* = the archaic word for a golden chrysalis) ·
**Emberwake** · **Vesper Bloom**.

**The spirit (our creature — lead): an aurora phoenix — a bird of light, never a solid model.**
It exists only as light: aurora ribbons and ember-particles that, at the peak beat, organize into a
**wing-spread across the sky**, mirrored in the lake. Rendering it as light (not geometry) means it
*never occludes the playfield* and costs a fraction of a rigged model.
*Alternates:* aurora **stag** (antler-branches of light) · **serpent-of-light** (coiling ribbon).
Recommendation: phoenix — the wing-unfurl is the showstopper payoff and reads instantly.

---

## 2. The mythos & the living arc

A dormant **relic-heart** — a faceted crystalline geode-egg with a molten core — rests on a
mirror-still twilight lake, ringed by crystal shards and silhouette peaks under a magenta→indigo sky.
It is *sleeping*. Your play wakes it.

The world is driven by a single eased **escalation scalar `S ∈ [0,1]`** (the "wakefulness" of the
relic) plus **transient flares** fired by discrete events. Idle → `S` decays back toward dormant.

| Beat | `S` band | Trigger | What the world does |
|---|---|---|---|
| **Dormant** | 0.0–0.15 | idle / start | relic breathes a slow amber pulse; embers drift lazily; aurora sways faintly; lake perfectly mirrors sky |
| **Fracture** | 0.15–0.45 | combos build | hairline cracks trace the shell and glow molten-amber; core brightens; first god-ray hints; shore crystals catch the light |
| **Spill** | 0.45–0.7 | line clears / Tetris | shell fractures widen; a vertical **shaft of light** spills upward; the lake ripples outward from the relic |
| **Ascension** | 0.7–0.9 | combo peak | the **aurora phoenix unfurls its wings** across the sky, mirrored in the water; embers swarm upward; bloom surges |
| **Cosmos** | 0.9–1.0 | high level | sky deepens past twilight toward the void; a distant **monolith rises** on the horizon and **ringed planets** fade in high above |

**Transient flares** (short, decaying, layered on top of `S`):
- **Line clear** → radial lake ripple + small ember burst from the relic.
- **Tetris** → light-shaft flash + aurora density surge (whiteout-lite).
- **Combo step** → crack-glow pulse + core flare.
- **Level up** → one-step sky deepen; at high levels, arm the Cosmos reveal.
- **Game over** → relic dims, cracks cool to ash, aurora recedes (graceful dormancy).

All escalation is **accessibility-gated** (respect reduced-motion / photosensitivity: cap ripple
amplitude, aurora flicker, and flash brightness), mirroring winter's a11y gating.

---

## 3. Art-direction bible

**Palette (working hex — tune in playground against ref screenshots):**

| Role | Hex | Use |
|---|---|---|
| Zenith indigo | `#0d0824` | top of sky dome, deep shadow lift |
| Mid violet | `#301a5e` | sky body, fog color |
| Horizon magenta | `#c2416f` → `#ff7ea8` | the signature pink horizon band |
| Ember core (molten) | `#ff7a1a` / `#ffb347` / `#ffd88a` | relic core, crack glow, MRT-bloom |
| Crack emissive | `#ff8c2a` | growing fracture lines |
| Icy translucent | `#9fe8ff` / `#c8f4ff` | crystal shards, spirit-wing cool edge, rim light |
| Bioluminescent lake | `#6a3ad0` base + `#7fe6ff` sparkle | water glow & caustics |
| Aurora spirit | `#ff6ec7` → `#7be0ff`, `#ffb45a` heart | wing gradient (magenta→cyan, amber core) |
| Ember/dust | `#ffb055` amber · `#dfe8ff` cool motes | particle field |

**Lighting:** low-key twilight. One warm key from the relic core (amber, bloom-driving), one cool
ambient from the sky/lake (indigo-cyan), a magenta rim from the horizon on peaks and shards.
God-rays emanate from the relic core through the crack shell. Exposure ~1.2–1.4, ACES filmic.

**Composition (constraint — the board sits center-screen):** frame the relic slightly **below and
behind** the playfield focal zone, peaks framing the sides, aurora & sky filling the **upper
periphery**, lake filling the **lower periphery**. Everything readable *around* the board, nothing
important *behind* it. Subtle breathing dolly + a slow lateral parallax drift (echoes the site's
orbit-around feel) — no camera cuts.

**Texture of the image:** subtle film grain + dither, gentle chromatic aberration at the extreme
edges, soft vignette, faint volumetric haze near the water. This "film stock" is what makes Hatom
feel expensive — it lives entirely in post (§6).

---

## 4. Scene anatomy — element by element (rendering technique)

Each element is a self-contained module under `rendering/` (or `sim/`), built and **screenshot-verified
in isolation in the playground first** (§8), then assembled. Technique choices favor
procedural-TSL-first (fully animatable, no asset pipeline dependency) with optional GLB upgrades.

1. **Twilight sky dome** (`rendering/twilight-sky.js`) — inverted sphere / screen-space gradient.
   TSL `colorNode` blends zenith→horizon by view elevation; procedural star field (hash noise,
   twinkle); a faint horizontal aurora band. `S` deepens indigo & darkens the horizon toward Cosmos.
   *Reference:* mountain-peaks / sky-drift sky builders.

2. **Silhouette peaks** (`rendering/silhouette-peaks.js`) — 2–3 parallax layers of dark ridgeline
   (near-black violet) with a thin magenta backlit rim. Cheap: layered plane silhouettes or low-poly
   FBM ridge. Parallax with camera drift.

3. **Mirror lake** (`rendering/mirror-lake.js`) — the signature reflection. Tier-gated `Reflector`
   (three addons) at capped resolution for a true reflection of relic + aurora, blended with
   procedural ripple normals + bioluminescent caustic sparkle. Mirror-still at `S≈0`; transients push
   concentric ripples from the relic. *WebGL/low-tier fallback:* fake reflection = vertically-mirrored
   emissive smear of the relic/aurora + ripple noise (no extra render pass). *Reference:* winter ice
   `winter-ice-shine`, koi-pond, stillwater.

4. **Relic-heart** (`rendering/relic-heart.js`) — the hero. Faceted icosphere geode (noise-displaced)
   with:
   - **Shell:** translucent fresnel-rim material; molten core visible through it (transmission-lite or
     layered emissive-through-fresnel; avoid true transmission cost on low tiers).
   - **Core:** emissive amber sphere with animated FBM "breathing" pulse (rate scales with `S`),
     MRT-tagged for bloom.
   - **Cracks:** procedural voronoi/curl crack map, emissive amber, **width & glow masked by `S`** —
     hairline at Fracture → gaping at Spill. Drives the god-ray shaft.
   *Reference:* geode, crystal-cave, bioluminescence-2 glowing GLBs. Procedural-first so the crack
   growth is fully controllable; optional Blender/TRELLIS GLB upgrade later.

5. **Aurora spirit** (`rendering/aurora-spirit.js`) — the light-being. Large additive emissive form in
   the sky realized as **curl-noise-advected GPU particles** (compute) *or* a TSL sky-dome emissive
   **wing-SDF mask** whose alpha & spread ramp with the **Ascension transient**. Magenta→cyan gradient,
   amber heart. Reflected by the lake. Recedes on decay. *Reference:* winter `aurora-volume.js`,
   ice-temple aurora, mountain-aurora.

6. **Crystal shards** (`rendering/crystal-shards.js`) — instanced translucent crystal spikes ringing
   the shore, faint cyan glow, catching the relic's warm key as it brightens. `InstancedMesh`,
   static transforms. *Reference:* crystal-cave, geode, ice-temple shards.

7. **Ember & dust field** (`sim/embers-compute.js`) — camera-relative GPU-compute particles: amber
   embers rising from the relic + cool dust motes drifting. Additive, MRT-bloom. Count/speed scale with
   `S`; transient bursts on line clears. *WebGL fallback:* CPU points, reduced count.
   *Reference:* ice-temple snow compute, stellar-drift particles.

8. **Cosmos reveal** (`rendering/cosmos-reveal.js`) — only armed at `S≥0.9` / high level: a distant dark
   monolith rises from the water on the horizon; 2–3 faint ringed planets fade in high in the sky.
   Cheap emissive-rim geometry / billboards, temporally & tier gated so it costs nothing until earned.

---

## 5. The Metamorphosis Director (`composition/metamorphosis-director.js`)

The brain. One class, ticked once per frame. Directly modeled on
`src/themes/winter/composition/storm-director.js`.

- **State:** target `S` from gameplay signals; actual `S` eased toward target (attack fast on events,
  slow decay when idle); a small pool of active transients (each: kind, age, duration, magnitude).
- **Inputs (gameplay coupling):** subscribe to the same event stream winter's storm-director uses —
  line clears, combo count, level, Tetris, game-over. **Task: confirm exact event names/bus API by
  reading `storm-director.js` before wiring** (it already does this; copy its subscription).
- **Outputs:** every element reads a single `directorState` object each frame:
  `{ S, corePulse, crackOpen, godrayIntensity, auroraSpread, rippleImpulses[], emberRate, skyDeepen,
  cosmosReveal, bloomBoost, flashWhite }`. Elements map these to their TSL uniforms — no element talks
  to gameplay directly.
- **A11y:** a `calmFactor` multiplier (from reduced-motion settings) scales every dynamic amplitude.

This keeps escalation logic in one auditable place and every visual element a pure function of
`directorState` — the pattern that made the Winter Blizzard combo maintainable.

---

## 6. Post-processing pipeline (`post/vesper-chrysalis-pipeline.js`)

This is where the Hatom "film" lives. Own pipeline file, built on `new THREE.PostProcessing(renderer)`
from `three/webgpu` + TSL nodes. **Modeled on `winter/post/winter-pipeline.js`** (the fullest example)
and `stellar-drift-post.js`.

Graph (WebGPU, `useMRT` when `maxColorAttachments > 1`):

```
scenePass(scene,camera)
  → MRT { output, emissive }              // only emissive-tagged mats bloom (core, cracks, aurora, embers)
  → bloom(emissiveTarget, strength, radius, threshold)   // strength boosted by directorState.bloomBoost
  → exposure + ACES filmic tonemap
  → VESPER GRADE  (lift shadows→indigo, push highlights→amber, magenta horizon tint)
  → light-shaft / god-ray accent (radial from relic core, gated by godrayIntensity)
  → gentle chromatic aberration (edges only)
  → soft vignette
  → film grain + dither
```

- `useMRT=true` default on capable WebGPU (like winter/stellar-drift). Non-MRT / WebGL path: bloom the
  full `output` texture with a higher threshold so only bright emissives blow out.
- Monkey-patch bloom `setSize` with a `bloomDownsample` factor (tier-scaled) for cheap blur — the
  established idiom in `ice-temple-post.js` / `stellar-drift-post.js`.
- Expose `updateDynamic(directorState)` for per-frame coupling; `setSize()` / `dispose()`.

---

## 7. How it plugs into the theme system (architecture)

Grounded in the theme-system map. **File layout** (adopting the newer "AAA" nested structure —
winter / himalayan-peak / electric-dreams-v3 / sky-children-v2):

```
src/themes/vesper-chrysalis/
  vesper-chrysalis-theme.js         # export default class VesperChrysalisTheme extends BaseTheme
  vesper-chrysalis-tetrominos.js    # tetromino visual config (getTetrominoConfig)
  vesper-chrysalis-materials.js     # shared TSL material factories (NodeMaterials)
  vesper-chrysalis-theme-icon.png   # theme-selector icon
  post/    vesper-chrysalis-pipeline.js
  rendering/  twilight-sky.js · silhouette-peaks.js · mirror-lake.js · relic-heart.js
              aurora-spirit.js · crystal-shards.js · cosmos-reveal.js
  sim/        embers-compute.js
  composition/ metamorphosis-director.js
  assets/     (optional GLBs + ATTRIBUTION.md)
```

**Contract (from `base-theme.js`):**
- `export default class VesperChrysalisTheme extends BaseTheme`, constructor calls
  `super('vesper-chrysalis')` — the id **must exactly match** the DOM container `#vesper-chrysalis-theme`.
- Implement **`async createScene()`** (the one required method; base throws otherwise). Inside it,
  build our **own** `THREE.Scene` + `PerspectiveCamera`, then `initRenderer(container)` appending our
  canvas into `#vesper-chrysalis-theme` — themes are *not* handed a renderer; they create their own.
- WebGPU opt-in via the canonical `initRenderer()` probe (copy `ice-temple-theme.js`): try
  `new WebGPURenderer`, accept only if `backend.isWebGPUBackend`, else fall back to `WebGLRenderer`;
  set `toneMapping=ACESFilmic`, `outputColorSpace=SRGB`. Then `probeCapabilities()` →
  `{ usePost, useMRT, useCompute }` flags gate the pipeline and the ember compute.
- Per-frame loop via `this.safeAnimate(renderFn)` so the base **`shouldRenderFrame()`** gate, RAF
  cleanup, and error-stop all apply for free.
- `getTetrominoConfig()` returns the `vesper-chrysalis-tetrominos.js` config.

**Registration (make it appear in-game):**
1. Add to `RAW_THEME_REGISTRY` in `src/themes/theme-registry.js`:
   `{ id:'vesper-chrysalis', displayName:'Vesper Chrysalis', module:'./vesper-chrysalis/vesper-chrysalis-theme.js', group:'fantasy', icon:'./vesper-chrysalis/vesper-chrysalis-theme-icon.png' }`.
2. Add `'vesper-chrysalis'` to **`HEAVY_GPU_THEME_IDS`** (heavy WebGPU → correct disposal + excluded
   from eager preload).
3. Ship `vesper-chrysalis-theme-icon.png`. The selector (`ThemesTab.js`) auto-renders from the registry
   and derives the category pill from `group` — no UI edits needed.
4. Optional: add a hub thumbnail via `theme-thumbnail-manifest.js` (+ `scripts/theme-thumbnail-assets.js`).

**Assets:** if we add GLBs, bundle them in `assets/` and import with `?url` (Vite-fingerprinted) or
`new URL('./x.glb', import.meta.url).href`. HDRIs go in `public/hdri/` referenced via
`` `${import.meta.env.BASE_URL}hdri/...` ``. **Never** hand a bare `'./textures/x.jpg'` to a loader —
that's the absolute-path trap that breaks packaged Electron. (Procedural-first means we may ship zero
GLBs for v1.)

**Tetrominoes:** style the falling pieces as **shards of the relic** — translucent crystalline blocks
with amber-emissive cores and icy-cyan rims, emissive-tagged for bloom. Gorgeous cohesion, and it ties
the playfield to the backdrop.

---

## 8. Build workflow — playground-first (REQUIRED by CLAUDE.md)

WebGPU/TSL is not "done" on a clean build — only on a **screenshot + zero console errors**. And
**one small effect per session** (full-journey WebGPU captures have TDR-crashed this iGPU).

**Reference-driven:** save the five Hatom phase screenshots into the playground refs folder and iterate
each slice against them with `?ref=/playground-refs/vesper-phaseN.png&refMode=split`.

Build & verify **in this order**, each as its own drop-in `src/playground/effects/*.effect.js`, each its
own capture session (open page → wait `window.__PLAYGROUND_READY__` → screenshot canvas via
chrome-devtools MCP → read console for WebGPU validation errors; use `?t=<sec>` for phase-locked shots):

1. `vesper-sky.effect.js` — sky gradient + horizon band + stars.
2. `vesper-relic.effect.js` — geode shell + molten core + crack growth, with an `S` slider.
3. `vesper-lake.effect.js` — mirror water + relic reflection + ripples.
4. `vesper-aurora-spirit.effect.js` — the wing-of-light unfurl.
5. `vesper-embers.effect.js` — compute embers/dust + WebGL fallback.
6. `vesper-grade.effect.js` — full post grade over a composited still.
7. `vesper-chrysalis.effect.js` — assembled hero scene + `S` slider + transient buttons (final
   integration proof **before** porting into `createScene()`).

Only after a clean screenshot per slice do we port the proven builder into the real theme module.

---

## 9. Performance plan

It's a `heavy-gpu` theme; it must be a good citizen from day one.

- **Gate & clamp:** drive the loop through `safeAnimate` → `shouldRenderFrame()` (respects
  `isRenderingPaused` / `isRenderingReduced`); clamp per-frame delta; zero per-frame allocations in
  hot paths (reuse scratch `Vector3`/`Color`).
- **6-tier scaling** (`Minimal < Low < Medium < High < Ultra < Extreme`, read from
  `window.settings.graphicsQuality` via `normalizeQuality`): a `QUALITY_PRESETS` table scales — ember
  count, aurora layer count, Reflector resolution (or fake-reflection on low tiers), star count,
  bloom on High+ only, god-ray samples, Cosmos reveal (Ultra/Extreme only).
- **Adaptive DRS + pixel-ratio cap:** `getEffectivePixelRatio(2, 'theme')` + a per-theme adaptive
  resolution scaler against a frame-time EMA (copy ice-temple's `updateAdaptiveScaler`), disabled by
  `?...NoDrs`.
- **WebGL fallback path** everywhere compute/MRT is used (fake reflection, CPU embers, full-output
  bloom). Device-loss → WebGL recovery (copy ice-temple).
- **Tab-hidden:** freeze the director + skip compute dispatches when hidden (the
  loop-anti-pattern fix every heavy theme now carries).
- **Budget target:** ≥120 fps Extreme/WebGPU on the dev laptop (RTX 5080) around the hero framing;
  never below High-tier interactivity on the iGPU fallback.

---

## 10. Milestones

| M | Goal | Exit criteria |
|---|---|---|
| **M0** | Scaffold: registry entry, empty `VesperChrysalisTheme extends BaseTheme`, WebGPU init + probe, black scene renders, appears in selector | theme loads & disposes clean; console clean |
| **M1** | **Hero still** (Dormant beat): sky + peaks + lake + relic + shards + base post grade | playground screenshot matches Hatom phase-1 mood; no WebGPU errors |
| **M2** | **Living escalation**: metamorphosis-director + crack growth + ripples + ember field + aurora spirit; wired to gameplay events | `S` slider + in-game combo drive the full Dormant→Ascension arc |
| **M3** | **Cosmos + polish**: cosmos reveal, god-rays, transient flares, tetromino styling, a11y gating, sound cues | full arc reads on-device; game-over dormancy graceful |
| **M4** | **Perf pass + validation**: 6-tier presets, DRS, WebGL fallback, tab-hidden freeze; live capture at each tier | ≥120fps Extreme; clean WebGL fallback; icon + hub thumbnail shipped |

Each milestone ends with a screenshot-verified capture (per §8 constraints).

---

## 11. Risks & mitigations

- **Reflector cost** → tier-gate resolution; fake reflection below Medium; it's the one true extra pass.
- **Aurora legibility over the board** → keep the wing in the upper periphery; cap opacity where it
  crosses the playfield zone; it's additive light so it reads as glow, not occlusion.
- **Crack animation fighting a GLB** → procedural relic first; GLB is an optional later upgrade only if
  the procedural geode isn't beautiful enough.
- **TDR on iteration** → one effect slice per session; never composite the whole scene in a fresh
  session cold; batch changes before re-capture (the standing Odyssey/theme capture rule).
- **Event-coupling drift** → don't invent a new event API; reuse storm-director's exact subscriptions.

---

## 12. Open decisions (small — I'll default unless you redirect)

1. **Name:** default `Vesper Chrysalis`. (Alt: Aurelian Veil / Emberwake.)
2. **Spirit form:** default aurora **phoenix** (wing-unfurl). (Alt: stag / serpent.)
3. **Relic:** default **procedural geode** (best for animated cracks). (Alt: Blender/TRELLIS GLB later.)
4. **v1 asset budget:** default **zero GLBs** (fully procedural) to ship faster and dodge the asset-path
   traps; add bespoke GLBs in a later polish pass if wanted.

---

## 13. Next action

On your **GO**, I start **M0 + M1 the playground way**: scaffold the theme + build `vesper-sky`,
`vesper-relic`, and `vesper-lake` effect slices, screenshot-verifying each against the Hatom refs,
then assemble the Dormant hero still. I'll batch and show you captures before porting into the theme.

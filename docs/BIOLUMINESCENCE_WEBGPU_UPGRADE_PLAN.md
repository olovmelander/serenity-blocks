# Bioluminescence Theme - WebGPU Hybrid Upgrade Plan (World-Class Revision)

## Executive Summary

This revision transforms the Bioluminescence theme from a WebGL-only, monolithic implementation into a production-grade WebGPU hybrid masterpiece — following the proven patterns established in Chromadelic Highway, Cosmic Noir, Stellar Drift, and Swedish Forest upgrades.

Key outcomes:
- WebGPU-first startup with silent WebGL2 fallback.
- TSL (Three Shading Language) node materials with real subsurface scattering, transmission, and procedural noise.
- GPU compute-driven particle systems (spores, fireflies, mycelium pulse).
- MRT emissive bloom that isolates glow from non-emissive surfaces (the single biggest visual upgrade).
- Dramatically enhanced cave environment with depth, atmosphere, and organic detail.
- Per-material bloom class weights preventing whiteout and false glow.
- Unified reactive envelope system for gameplay event responses.
- Strict lifecycle management, capability gating, and deterministic validation.

Scope:
- `src/themes/bioluminescence/`
- `docs/BIOLUMINESCENCE_WEBGPU_UPGRADE_PLAN.md`

**Reference implementations:**
- `src/themes/black-hole/` — Gold standard hybrid pattern (renderer init, MRT, compute, materials)
- `src/themes/chromadelic-highway/` — Production-hardened patterns (device loss recovery, bloom class weights, material return tuples, compile timeout, MRT audit, adaptive DRS)
- `src/themes/cosmic-noir/` — TSL materials, MRT patching fail-safe, reactive envelope system

**Three.js version:** r181+ with TSL support

---

## Current Baseline (Verified)

### What Exists (WebGL Only)
- `bioluminescence-theme.js` (~2000 lines, monolithic)
- `bioluminescence-tetrominos.js` (color/effects config)
- Legacy backup: `bioluminescence-theme-old.js` (~1019 lines)
- `WebGLRenderer` with `EffectComposer` + `UnrealBloomPass`
- 6 GLSL shaders inline (Mushroom, Crystal, Terrain, Spore, ContactRipple, Shore)
- CPU-generated PBR textures via Canvas2D (cave rock, vine, mushroom cap)
- `Water.js` from Three.js examples for cave pool
- Static `MeshStandardMaterial` for terrain, stems, vines
- Spore particles via `THREE.Points` with GLSL shader
- ~20 mushrooms, ~6 crystal clusters, ~300 spores (High preset)
- Single bloom pass, basic fog, minimal volumetric effects

### Current Weaknesses
1. **Monolithic file** — all 2000 lines in one file, hard to maintain
2. **No WebGPU support** — uses only `WebGLRenderer`
3. **CPU-bound particles** — spores and effects limited by JS
4. **Basic post-processing** — single UnrealBloomPass, no emissive isolation
5. **Static lighting** — no dynamic light interaction with bioluminescence
6. **Fake SSS** — GLSL rim glow approximation instead of true transmission/thickness
7. **No GPU compute** — all animation driven by CPU uniform updates
8. **Water is placeholder** — `Water.js` with wrong normal map, looks generic
9. **Missing atmosphere** — no volumetric fog, no light scattering, no god rays
10. **Crystals too bright** — additive blending causes complete whiteout (no internal color)
11. **Cave feels empty** — limited environment depth, sparse decoration
12. **No mycelium network** — missing the signature bioluminescent neural web connecting organisms
13. **No instancing** — every small element is a unique mesh (performance waste)
14. **Mushrooms are flat** — uniform teal color, no SSS, no variation, no gill texture
15. **No depth layers** — everything sits on one visual plane, no sense of cave vastness
16. **Cave ceiling unconvincing** — circular glow spots look projected, not organic

### Immediate Risks to Close Before Expanding Scope
- Lifecycle hardening is incomplete for a hybrid renderer migration (device loss, controlled fallback, full resource teardown).
- No deterministic replay hooks (`seed`, fixed delta, canned event sequence).
- No backend-specific render abstraction (`renderFrame`) yet.
- Expensive visual ambitions are specified before objective baseline captures and budgets.

---

## Art Direction & Visual Identity

### Mood & Inspiration
- **Primary references:** *Avatar* (Pandora bioluminescence), *Subnautica* (alien ocean caves), *Deep Rock Galactic* (crystal caves), real deep-sea bioluminescence footage
- **Emotional tone:** Awe, mystery, tranquility with moments of spectacle (game events)
- **Atmosphere:** Dense, humid cave air; the sense that the cave is *alive*; every surface subtly breathes
- **Key principle:** Darkness is as important as light — bioluminescence only works when surrounded by deep, rich blackness

### Color Palette (Strict)
| Role | Color | Hex | Usage |
|------|-------|-----|-------|
| **Primary Glow** | Vivid Cyan | `#00FFD4` | Mushroom caps, spore cores, primary emissive |
| **Secondary Glow** | Bioluminescent Teal | `#00C9A7` | Crystal interiors, vine orbs, gill glow |
| **Accent Warm** | Phosphor Green | `#66FFAA` | Moss patches, algae, firefly trails |
| **Accent Cool** | Deep Aqua | `#0088AA` | Water subsurface, deep crystal, cave veins |
| **Highlight** | White-Cyan | `#CCFFFF` | Brightest bloom peaks, crystal tips, combo flash |
| **Shadow Base** | Abyss Navy | `#020810` | Background void, deep shadows, fog base |
| **Rock Base** | Wet Slate | `#0A1518` | Cave floor, walls, stalactites (non-emissive) |
| **Water Deep** | Midnight Teal | `#001A1A` | Deep water areas, pool center |

### Visual Hierarchy (Brightness Order)
1. Crystal tips & mushroom cap centers (brightest — drives bloom)
2. Mushroom cap edges (SSS transmission glow)
3. Fireflies & large spores (moving bright accents)
4. Vine orbs, moss patches (mid-level ambient glow)
5. Mycelium network veins (subtle connecting glow)
6. Cave wall veins, water subsurface (atmospheric base glow)
7. Rock surfaces, stalactites (non-emissive, lit only by scene glow)
8. Background void, deep shadows (near-black anchor)

### Per-Mushroom Color Variation
Every mushroom in the current theme is identical teal. The upgrade must include:
- Base hue variation: ±15° around primary cyan per mushroom instance
- Size-correlated brightness: larger mushrooms = brighter base glow
- Random pulse phase offset: mushrooms must NOT all breathe in sync
- Species-specific color shift: Cluster Mini → Phosphor Green, Giant Ancient → deeper Teal

### Readability Rules
- Combo effects must not hide board edges or piece contrast.
- Bloom budget is capped per quality tier.
- Chromatic aberration remains subtle and event-scaled.

---

## Target End State

### Rendering Contract
- Startup never hard-fails due to WebGPU availability.
- Runtime selects one of these supported paths:
  - WebGPU + MRT + compute (full feature set)
  - WebGPU + MRT + CPU particle fallback
  - WebGPU without MRT
  - WebGPU without post
  - WebGL2 fallback (`EffectComposer`)
- Every optional feature is gated by both capability checks and debug flags.

### Visual Contract (Masterpiece Bar)
- Signature identity: bioluminescent cave where darkness is as important as light.
- MRT bloom isolates glow — rock never false-blooms; mushrooms/crystals glow beautifully.
- Mycelium network visibly connects organisms as the theme's defining feature.
- Player-reactive effects enhance gameplay moments without obscuring board readability.
- Visual hierarchy remains intentional at all quality levels:
  - Tier 1: Crystal/mushroom glow hierarchy and board readability
  - Tier 2: Spore/firefly atmosphere and depth layers
  - Tier 3: Mycelium pulse, volumetric fog, and spectacle effects

### Reliability Contract
- Clean theme switches with no leaked listeners, RAF loops, timers, render targets, or GPU buffers.
- Deterministic replay for visual regression checks.
- Cross-backend parity defined by concrete acceptance captures, not subjective memory.

### Performance Contract
- High tier target: sustained 60 FPS at 1080p on mid-range discrete GPU class (GTX 1060 / RX 580).
- Low/Minimal tiers remain stable with conservative post and simulation budgets.
- Adaptive scaling is smooth, bounded, and testable.

---

## Platform & Version Constraints

- Three.js version target: **0.181.2** (align all `three/webgpu` + `three/tsl` API usage to this revision)
- Electron runtime target: **38.3.0** (WebGPU validation in packaged Electron build is mandatory)
- Platform policy: Desktop/Electron is first-class WebGPU path; WebGL2 fallback must remain stable and visually coherent
- Visual parity policy: WebGPU can exceed WebGL visual fidelity, but WebGL fallback must preserve the core bioluminescence identity

## Compatibility Constraints (Must Be Explicit)

- `ShaderMaterial`/GLSL pipeline remains WebGL-only; WebGPU path uses TSL node materials
- `EffectComposer` is WebGL-only; WebGPU path uses `PostProcessing` from `three/webgpu`
- WebGPU point primitive size limits make `THREE.Points` unsuitable for hero particles; use instanced billboards/sprites on WebGPU
- Compute, MRT, and advanced post effects are optional capabilities; startup must never fail when one is unavailable

---

## Migration Policy

- Stability first: lifecycle hardening before new expensive visuals.
- Introduce one major rendering risk at a time.
- Keep WebGL visual parity unless explicitly accepted as a deliberate difference.
- Do not remove fallback code until parity and perf gates pass.
- Each phase has objective, file scope, tasks, and hard exit criteria.

Non-goals until Phase 7+:
- Large new simulation systems without measured bottleneck evidence.
- Effect additions that reduce board legibility under gameplay stress.
- Depth of field and film-grain experimentation before fallback parity, budget compliance, and readability gates are closed.

---

## Non-Negotiable Engineering Gates

To keep this upgrade best-in-class, every phase must pass objective gates before merge:

1. **Deterministic visual baseline**
   - Add seeded randomness (`?bioluminescenceSeed=12345`) so screenshots are reproducible.
   - Capture before/after frames at fixed timestamps (`?bioluminescenceFixedDt=16.666`).
   - Fail phase signoff if visual diffs exceed target thresholds for fallback parity.

2. **Fallback parity first**
   - WebGL fallback is never a second-class path.
   - Any WebGPU change that regresses fallback visuals or stability blocks the phase.

3. **Single owner per rendering stage**
   - Exactly one stage performs tone mapping.
   - Exactly one stage owns bloom source selection (MRT emissive or full-frame fallback).
   - Exactly one stage writes reactive envelope values per frame.

4. **Measured budgets, not estimates**
   - Track p50/p95 frame time, draw calls, and memory proxies (`renderer.info.memory`, texture/buffer counts) for each quality preset.
   - Record metrics for idle + combo burst scenarios.
   - No phase closes without baseline numbers captured and attached to PR notes.

5. **Fast rollback switches**
   - Every major feature has an immediate runtime kill-switch (`noCompute`, `noMRT`, `noPost`, etc.).
   - Device-loss and runtime failure paths must downgrade without reload loops.

---

## Objective Signoff Thresholds (Locked)

World-class execution requires explicit quantitative pass/fail gates:

| Category | Gate | Threshold |
|----------|------|-----------|
| Visual parity | Fallback parity diff (same seed, fixed dt, matched camera) | <= 2.5% changed pixels outside approved glow ROIs |
| Visual readability | Board ROI contrast during `LINE_CLEAR`, `COMBO`, `TETRIS` anchors | >= 4.5:1 |
| Bloom containment | Non-emissive leakage in bright bloom mask | <= 3.0% of bright pixels |
| Mood fidelity | Darkness ratio in hero frames | 40% - 65% of frame remains dark-value dominant |
| Runtime performance (WebGPU High) | Frame time | `avg <= 16.7ms`, `p95 <= 16.7ms`, `p99 <= 20ms` |
| Runtime performance (WebGL Medium fallback) | Frame time | `avg <= 16.7ms`, `p95 <= 20ms` |
| Stability | Soak run | 30 min with no uncaught errors, no unbounded memory trend |
| Lifecycle | Theme-switch stress | 100+ create/cleanup cycles, no leaked listeners/timers/RAF loops |

Notes:
- Approved glow ROIs are limited to emissive cores, bloom halos, and event flashes documented in Phase 0 anchors.
- All thresholds apply to both WebGPU-preferred runtime and `?forceWebGL=1` fallback runtime unless explicitly marked WebGPU-only.

---

## Validation Artifacts (Repo Standard)

To align with existing validation patterns in this repository, Phase 0 must produce these artifacts:

- Create: `docs/BIOLUMINESCENCE_ART_DIRECTION.md` (palette lock, hero-frame composition, brightness hierarchy, readability ROIs).
- Create: `docs/BIOLUMINESCENCE_BASELINE_CAPTURE_PROTOCOL.md` (deterministic capture runbook and signoff checklist).
- Create: `tests/performance/benchmark-bioluminescence-phase9.html` (dual-backend harness with preset sweep, event anchors, soak and switch stress).
- Create: `tests/unit/test-bioluminescence-phase0.js` (flags, deterministic hooks, helper API exposure).
- Create: `tests/unit/test-bioluminescence-phase1.js` (hybrid init, lifecycle hardening, fallback/device-loss hooks).
- Create: `tests/unit/test-bioluminescence-phase6.js` (post path, MRT isolation, audit/fail-safe wiring).
- Create: `tests/unit/test-bioluminescence-phase9.js` (signoff instrumentation, stress helpers, cleanup guarantees).

Harness API target:
- `window.bioluminescenceBaseline` should expose at minimum: `report`, `capture`, `captureEventAnchors`, `runPresetSweep`, `runSoak`, `runThemeSwitchStress`, `collectEvidence`.

---

## Target Architecture

### New File Structure
```
src/themes/bioluminescence/
  bioluminescence-theme.js          # Main class (hybrid renderer, scene, animation, events)
  bioluminescence-materials.js      # TSL node material factories + noise library
  bioluminescence-shaders.js        # GLSL shaders (WebGL fallback — kept and maintained)
  bioluminescence-compute.js        # GPU compute: spores, fireflies, mycelium
  bioluminescence-post.js           # WebGPU PostProcessing (MRT bloom, grading)
  bioluminescence-tetrominos.js     # Tetromino config (keep existing)
  bioluminescence-theme-icon.png    # Theme icon (keep existing)
```

### Hybrid Renderer Pattern (Gold Standard)
```
┌─────────────────────────────────────────────┐
│              createScene() (async)           │
│                                              │
│  1. Try WebGPURenderer → await init()        │
│  2. Check backend?.isWebGPUBackend === true  │
│  3. Fallback → WebGLRenderer (silent)        │
│  4. Set this.isWebGPU flag                   │
│  5. Probe capabilities (MRT, compute)        │
│  6. Create scene elements (conditional path) │
│  7. MRT material patching (conditional)      │
│  8. Setup post-processing (conditional path) │
│  9. Pre-compile with timeout guard           │
│  10. Start animation loop                    │
└─────────────────────────────────────────────┘
```

### Import Pattern
```javascript
// bioluminescence-theme.js
import * as THREE from 'three';
import * as THREE_WEBGPU from 'three/webgpu';

// WebGL fallback post-processing (only used when !isWebGPU)
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { BIOLUMINESCENCE_TETROMINOS } from './bioluminescence-tetrominos.js';
import {
    createMushroomCapNodeMaterial, createMushroomStemNodeMaterial,
    createCrystalNodeMaterial, createCaveRockNodeMaterial,
    createCaveWallNodeMaterial, createVineNodeMaterial,
    createWaterSurfaceNodeMaterial, createBackgroundNodeMaterial,
    createMyceliumNodeMaterial, createSporeParticleMaterial,
    createFireflyParticleMaterial, createWebGLFallbackMaterials,
} from './bioluminescence-materials.js';
import { BioluminescencePost } from './bioluminescence-post.js';
import { SporeCompute, FireflyCompute, MyceliumPulseCompute } from './bioluminescence-compute.js';
```

### Material Factory Return Pattern (from Chromadelic Highway)
Every material factory returns `{ material, uniforms, meta }`:
```javascript
export function createMushroomCapNodeMaterial(params = {}) {
    const material = new MeshPhysicalNodeMaterial({ ... });
    const uTime = uniform(0);
    const uPulseIntensity = uniform(0);
    // ... build TSL graph ...

    // Bloom class weight controls MRT emissive contribution
    material.emissiveNode = glowColor.mul(intensity).mul(BLOOM_CLASS_WEIGHTS.mushroomCap);

    return {
        material,
        uniforms: { uTime, uPulseIntensity },
        meta: { emitsBloom: true, mrtRole: 'mushroomCap' },
    };
}
```

---

## Capability Matrix & Kill Switches

| Runtime Capability | Post | MRT | Compute | Expected Path |
|--------------------|------|-----|---------|---------------|
| WebGPU + MRT + Compute | Yes | Yes | Yes | Full Bioluminescence feature set |
| WebGPU + MRT, no Compute | Yes | Yes | No | Node materials + CPU particle fallback |
| WebGPU, no MRT | Yes | No | Optional | Standard bloom path |
| WebGPU, no Post | No | No | Optional | Direct scene render |
| WebGL2 fallback | `EffectComposer` | No | No | Stable fallback-quality experience |

### Required Debug Flags
| Flag | Effect |
|------|--------|
| `?forceWebGL=1` | Force WebGL2 backend |
| `?bioluminescenceNoPost=1` | Disable all post-processing |
| `?bioluminescenceNoMRT=1` | Disable MRT emissive isolation |
| `?bioluminescenceNoCompute=1` | Disable GPU compute (CPU fallback) |
| `?bioluminescenceNoMycelium=1` | Disable mycelium propagation effects |
| `?bioluminescenceNoBloom=1` | Disable bloom specifically |
| `?bioluminescenceMrtAudit=1` | Log material MRT metadata for debugging |
| `?bioluminescenceBaseline=1` | Log backend, capability map, frame timings |
| `?bioluminescenceSeed=1234` | Deterministic procedural seed |
| `?bioluminescenceFixedDt=16.666` | Fixed timestep for deterministic captures |
| `?quality=extreme` | Override quality preset |
| `?wireframe=1` | Wireframe mode for geometry debugging |

### Derived Runtime Flags (Single Source of Truth)
```javascript
updateCapabilityFlags() {
    const usePost = this.isWebGPU && this.qualityPreset.enablePostProcessing && !this.flags.noPost;
    const supportsMRT = this.capabilities?.maxColorAttachments > 1;
    const useMRT = usePost && !this.flags.noMRT && supportsMRT;
    const useCompute = this.isWebGPU && this.capabilities?.supportsCompute && !this.flags.noCompute;

    this.flags.usePost = usePost;
    this.flags.useMRT = useMRT;
    this.flags.useCompute = useCompute;
    this.flags.useMyceliumPulse = useCompute && !this.flags.noMycelium && this.qualityPreset.enableMyceliumPulse;
}
```

### Capability Probes (After `await renderer.init()`)
```javascript
probeCapabilities() {
    if (!this.isWebGPU) {
        this.capabilities = { isWebGPU: false };
        return;
    }
    const backend = this.renderer.backend;
    const device = backend?.device;
    this.capabilities = {
        isWebGPU: true,
        maxColorAttachments: device?.limits?.maxColorAttachments ?? 0,
        supportsCompute: !!this.renderer.compute,
    };

    if (this.flags.baseline) {
        console.log('[Bioluminescence] Capabilities:', this.capabilities);
    }
}
```

All probes must be logged when `?bioluminescenceBaseline=1` is set, and all optional features must degrade without throwing.

---

## GPU Timing & Telemetry Hooks (Required)

Pass-level timing is mandatory when timestamp queries are available, and gracefully optional when not:

```javascript
async initGpuTiming() {
    if (!this.isWebGPU || !this.renderer?.hasFeature) return;
    this.capabilities.supportsTimestampQuery = this.renderer.hasFeature('timestamp-query');
}

async sampleGpuPassTimes() {
    if (!this.capabilities?.supportsTimestampQuery) return null;
    // Collect timestamps after compute + post/render passes for baseline reports.
    await this.renderer.resolveTimestampsAsync();
    const frames = this.renderer.backend?.getTimestampFrames?.() || [];
    return frames;
}
```

Telemetry minimums for baseline reports:
- CPU frame stats: `avg`, `p50`, `p95`, `p99`, variance.
- GPU pass stats (when available): compute, scene pass, bloom, grading.
- Runtime counters: draw calls, geometry count, texture count, buffer count.
- Event counters: `PIECE_LOCK`, `LINE_CLEAR`, `COMBO`, `TETRIS`.

When timestamps are unavailable, the harness still reports CPU-side frame metrics and marks GPU pass timings as `unsupported`.

---

## Bloom Class Weights (from Chromadelic Highway / Cosmic Noir)

Per-material emissive weighting prevents bloom washout and ensures only bioluminescent surfaces glow:

```javascript
const BLOOM_CLASS_WEIGHTS = {
    mushroomCap:     0.80,  // Strong organic glow
    mushroomStem:    0.10,  // Faint wet sheen only
    crystalTip:      1.00,  // Maximum — crystal tips are brightest
    crystalBody:     0.60,  // Internal energy glow
    mycelium:        0.50,  // Moderate network glow
    vineOrb:         0.45,  // Seed pod glow
    caveRock:        0.00,  // CRITICAL: rock never blooms
    caveWall:        0.05,  // Faint vein glow only
    water:           0.15,  // Subtle subsurface plankton
    spore:           0.60,  // Medium floating glow
    firefly:         0.70,  // Bright moving accent
    moss:            0.30,  // Gentle ambient glow
    stalactite:      0.00,  // Non-emissive
    godRay:          0.20,  // Soft atmospheric light
    background:      0.00,  // No bloom (pure void)
    jellyfish:       0.55,  // Ghostly translucent glow
};
```

Each material factory multiplies its `emissiveNode` by the weight, preventing bright elements from dominating the bloom pass. This is the key fix for the crystal whiteout problem visible in the current screenshot.

---

## Reactive Envelope System (from Cosmic Noir)

Replace ad-hoc `pulseIntensity *= 0.96` decay with a unified multi-channel envelope:

```javascript
this.reactiveEnvelope = {
    pulse: 0,        // Mushroom/crystal emissive boost
    bloom: 0,        // Dynamic bloom strength boost
    spore: 0,        // Spore emission rate multiplier
    mycelium: 0,     // Mycelium pulse propagation trigger
    atmosphere: 0,   // God ray + fog intensity boost
    water: 0,        // Water glow and ripple intensity
    exposure: 0,     // Post-processing exposure flash
};

pushReactiveEnvelope(values) {
    for (const [key, val] of Object.entries(values)) {
        this.reactiveEnvelope[key] = Math.min(
            (this.reactiveEnvelope[key] || 0) + val, 1.0
        );
    }
}

updateReactiveEnvelope(delta) {
    const decay = 1 - delta * 3.0;  // ~3× per second decay
    for (const key of Object.keys(this.reactiveEnvelope)) {
        this.reactiveEnvelope[key] *= decay;
        if (this.reactiveEnvelope[key] < 0.01) this.reactiveEnvelope[key] = 0;
    }
}
```

Event handlers push multi-channel envelopes:
```javascript
PIECE_LOCK:   pushReactiveEnvelope({ pulse: 0.15, spore: 0.2 })
LINE_CLEAR:   pushReactiveEnvelope({ pulse: 0.2+lines*0.1, bloom: 0.08+lines*0.06, water: 0.15+lines*0.1, mycelium: 0.3 })
COMBO(n):     pushReactiveEnvelope({ pulse: 0.2+n*0.1, bloom: 0.1+n*0.08, spore: 0.3+n*0.15, atmosphere: 0.2+n*0.1 })
TETRIS:       pushReactiveEnvelope({ pulse: 1.0, bloom: 0.5, spore: 1.0, mycelium: 1.0, atmosphere: 0.8, water: 0.6, exposure: 0.4 })
```

Animation loop reads envelope channels to drive each subsystem independently. This replaces scatter-shot per-effect decay with a unified, extensible system.

---

## Performance Budgets per Quality Tier

| Tier | Max Draw Calls | Max Post Cost (ms) | Max Spores | Max Fireflies | Max Instances | Point Lights | Adaptive DRS Range |
|------|----------------|--------------------|------------|---------------|---------------|--------------|-------------------|
| Extreme | 450 | 5.0 | 3000 | 200 | 700 | 8 | 0.75 - 1.00 |
| Ultra | 380 | 4.5 | 2000 | 150 | 500 | 6 | 0.72 - 1.00 |
| High | 300 | 4.0 | 1000 | 100 | 350 | 5 | 0.68 - 1.00 |
| Medium | 220 | 3.0 | 500 | 50 | 200 | 0 | 0.62 - 0.94 |
| Low | 150 | 2.0 | 200 | 0 | 50 | 0 | 0.56 - 0.84 |
| Minimal | 100 | 1.5 | 80 | 0 | 0 | 0 | 0.50 - 0.78 |

**"Max Instances"** = total micro-crystals + moss patches + rubble + cluster mushroom instances.

---

## Phase Plan

---

### Phase 0: Baseline Lock and Instrumentation (Critical)

**Objective:** Establish objective visual/performance baselines and deterministic replay before migration work begins.

**Files:**
- Modify: `src/themes/bioluminescence/bioluminescence-theme.js`
- Create: `docs/BIOLUMINESCENCE_ART_DIRECTION.md`
- Create: `docs/BIOLUMINESCENCE_BASELINE_CAPTURE_PROTOCOL.md`
- Create: `tests/performance/benchmark-bioluminescence-phase9.html`
- Create: `tests/unit/test-bioluminescence-phase0.js`

**Tasks:**
- [ ] Define hero-frame captures for each quality tier and backend.
- [ ] Add deterministic controls (`bioluminescenceSeed`, `bioluminescenceFixedDt`, canned event playback).
- [ ] Record baseline metrics: FPS, 1% low, frame-time variance, draw calls, memory.
- [ ] Capture readability anchors during `PIECE_LOCK`, `LINE_CLEAR`, `COMBO`, `TETRIS` events.
- [ ] Capture baseline at `Minimal`, `High`, and `Extreme` presets.
- [ ] Expose baseline helper API on `window.bioluminescenceBaseline`.
- [ ] Implement dual-backend campaign helpers in harness (`WebGPU` + `?forceWebGL=1`).
- [ ] Export evidence bundle JSON containing metrics, anchor captures, and gate evaluation.

**Exit Criteria:**
- Baseline pack committed and reproducible.
- Deterministic run is reproducible with identical seed and fixed timestep.
- Harness report includes quantitative pass/fail status for all thresholds in "Objective Signoff Thresholds".
- Instrumentation exists before migration work begins.

---

### Phase 1: Renderer Bootstrap and Lifecycle Hardening (Critical)

**Objective:** Make startup/shutdown and fallback transitions robust. Stability before features.

**Files:**
- Modify: `src/themes/bioluminescence/bioluminescence-theme.js`

#### 1.1 - Dual Import Pattern
```javascript
import * as THREE from 'three';
import * as THREE_WEBGPU from 'three/webgpu';
```
- `THREE` — Standard Three.js for WebGL types (Vector3, Color, Clock, BufferGeometry, WebGLRenderer, etc.)
- `THREE_WEBGPU` — WebGPU-specific renderer only (`WebGPURenderer`)

#### 1.2 - Renderer Initialization
```javascript
async initRenderer(container) {
    let webgpuRenderer = null;

    // Step 1: Try WebGPU (unless forced to WebGL via URL flag)
    if (!this.flags.forceWebGL) {
        try {
            webgpuRenderer = new THREE_WEBGPU.WebGPURenderer({
                antialias: this.getAntialiasEnabled(),
                powerPreference: 'high-performance',
                alpha: false,
            });
            await webgpuRenderer.init();  // CRITICAL: async initialization
        } catch (e) {
            console.warn('[Bioluminescence] WebGPU init failed, falling back to WebGL:', e.message);
            if (webgpuRenderer) webgpuRenderer.dispose();
            webgpuRenderer = null;
        }
    }

    // Step 2: Backend verification
    if (webgpuRenderer && webgpuRenderer.backend?.isWebGPUBackend === true) {
        this.renderer = webgpuRenderer;
        this.isWebGPU = true;
        this.isWebGL = false;
        console.log('[Bioluminescence] WebGPU renderer initialized');
    } else {
        // Step 3: Silent fallback to WebGL2
        if (webgpuRenderer) webgpuRenderer.dispose();
        this.renderer = new THREE.WebGLRenderer({
            antialias: this.getAntialiasEnabled(),
            powerPreference: 'high-performance',
            alpha: false,
        });
        this.isWebGPU = false;
        this.isWebGL = true;
        console.log('[Bioluminescence] WebGL2 renderer initialized (fallback)');
    }

    // Color pipeline ownership (CRITICAL: prevents double tone mapping)
    // - WebGPU + post graph: post pass owns tone mapping
    // - WebGL fallback (or no post): renderer owns tone mapping
    const postEnabled = this.isWebGPU && this.qualityPreset.enablePostProcessing && !this.flags.noPost;
    if (postEnabled) {
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.renderer.toneMappingExposure = 1.0;
    } else {
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
    }

    // Common configuration
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.setPixelRatio(this.getEffectivePixelRatio());
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.sortObjects = true;
}
```

#### 1.3 - Device Loss Recovery (from Chromadelic Highway)
```javascript
if (this.isWebGPU) {
    this.renderer.onDeviceLost = (info) => { void this.handleDeviceLoss(info); };
}

async handleDeviceLoss(info) {
    if (this.deviceLossRecoveryInProgress || !this.isActive) return;
    this.deviceLossRecoveryInProgress = true;
    console.error('[Bioluminescence] WebGPU device lost:', info);
    try {
        this.cancelAnimationLoop();
        this.clearEventSubscriptions();
        this.removeResizeListener();
        this.disposeRuntimeResources({ removeCanvas: true });

        // Force WebGL on recovery
        this.flags.forceWebGL = true;
        this.flags.noCompute = true;
        this.flags.noMRT = true;

        await this.createScene();
        console.log('[Bioluminescence] Recovery complete: running on WebGL fallback.');
    } catch (error) {
        console.error('[Bioluminescence] Device-loss recovery failed:', error);
        this.isActive = false;
    } finally {
        this.deviceLossRecoveryInProgress = false;
    }
}
```

#### 1.4 - Timeout-Guarded Compilation (from Cosmic Noir)
```javascript
async precompileSceneWithTimeout() {
    if (!this.isWebGPU || !this.renderer?.compileAsync) return;

    const TIMEOUT_MS = 3000;
    let timeoutId = null;
    try {
        await Promise.race([
            this.renderer.compileAsync(this.scene, this.camera),
            new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error('compile timeout')), TIMEOUT_MS);
            }),
        ]);
        console.log('[Bioluminescence] Scene pre-compiled');
    } catch (e) {
        console.warn('[Bioluminescence] compileAsync skipped:', e.message);
    } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
    }
}
```

#### 1.5 - Render Frame Abstraction
```javascript
renderFrame() {
    // WebGPU path
    if (this.isWebGPU) {
        // Dispatch compute before render
        if (this.flags.useCompute && this.renderer?.compute) {
            if (this.sporeCompute?.computeNode) this.renderer.compute(this.sporeCompute.computeNode);
            if (this.fireflyCompute?.computeNode) this.renderer.compute(this.fireflyCompute.computeNode);
            if (this.myceliumCompute?.computeNode) this.renderer.compute(this.myceliumCompute.computeNode);
        }
        if (this.postProcessing && this.flags.usePost) {
            this.postProcessing.render();      // sync
        } else {
            this.renderer.render(this.scene, this.camera); // sync
        }
    }
    // WebGL path
    else {
        if (this.composer) {
            this.composer.render();             // sync
        } else {
            this.renderer.render(this.scene, this.camera); // sync
        }
    }
}
```

#### 1.6 - Make `createScene()` Async
```javascript
async createScene() {
    const container = document.getElementById('bioluminescence-theme');
    if (!container) return;

    await this.initRenderer(container);
    this.probeCapabilities();
    this.updateCapabilityFlags();

    // Create scene elements (conditional WebGPU/WebGL paths)
    this.createCaveEnvironment();
    this.createMushrooms();
    this.createCrystals();
    this.createWater();
    this.createMyceliumNetwork();
    this.createParticles();

    // MRT patching (WebGPU only)
    if (this.isWebGPU && this.flags.useMRT) {
        this.ensureMrtMaterials();
    }

    // Post-processing (conditional path)
    this.setupPostProcessing();
    this.setupResizeHandler();
    this.setupEventListeners();

    // Pre-compile with timeout guard
    await this.precompileSceneWithTimeout();

    this.startAnimation();
}
```

#### 1.7 - Lifecycle Cleanup
```javascript
cancelAnimationLoop() {
    if (this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
    }
}

clearEventSubscriptions() {
    this.eventUnsubscribers.forEach((unsub) => unsub?.());
    this.eventUnsubscribers = [];
}

removeResizeListener() {
    if (this.resizeHandler) {
        window.removeEventListener('resize', this.resizeHandler);
        this.resizeHandler = null;
    }
}

disposeRuntimeResources({ removeCanvas = true } = {}) {
    const disposeMaterial = (material) => {
        if (!material) return;
        const list = Array.isArray(material) ? material : [material];
        for (const mat of list) {
            if (!mat) continue;
            for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap']) {
                if (mat[key]?.dispose) mat[key].dispose();
            }
            mat.dispose?.();
        }
    };

    // 1. Dispose compute nodes first
    if (this.sporeCompute) { this.sporeCompute.dispose(); this.sporeCompute = null; }
    if (this.fireflyCompute) { this.fireflyCompute.dispose(); this.fireflyCompute = null; }
    if (this.myceliumCompute) { this.myceliumCompute.dispose(); this.myceliumCompute = null; }

    // 2. Dispose post-processing
    if (this.postProcessing) { this.postProcessing.dispose(); this.postProcessing = null; }
    if (this.composer) { this.composer.dispose?.(); this.composer = null; }

    // 3. Dispose scene objects
    if (this.scene) {
        this.scene.traverse((child) => {
            child.geometry?.dispose?.();
            if (child.material) disposeMaterial(child.material);
        });
    }

    // 4. Dispose renderer last
    if (this.renderer) { this.renderer.dispose(); this.renderer = null; }

    // 5. Null references
    this.scene = null;
    this.camera = null;
}

stop() {
    this.cancelAnimationLoop();
    this.clearEventSubscriptions();
    this.removeResizeListener();
    this.disposeRuntimeResources({ removeCanvas: true });
    super.stop();
}
```

**Exit Criteria:**
- WebGPU renderer initializes on supported browsers; WebGL fallback activates silently on others.
- `?forceWebGL=1` forces WebGL path; all `?bioluminescenceNo*` flags work.
- Device loss triggers controlled auto-restart with WebGL (no restart loop, no leaked listeners).
- `compileAsync` completes or times out within 3s without stalling.
- Tone mapping is applied exactly once per path (no double tone mapping).
- 100+ theme switches with no listener/timer/resource leaks.
- Theme renders identically to current on WebGL fallback.

---

### Phase 2: Render Path Abstraction and Post-Processing (Critical)

**Objective:** Centralize render flow, establish MRT bloom, and validate emissive behavior early. MRT emissive bloom is the single biggest visual upgrade — it must be validated before environment expansion.

**Files:**
- Modify: `src/themes/bioluminescence/bioluminescence-theme.js`
- Create: `src/themes/bioluminescence/bioluminescence-post.js`

#### 2.1 - WebGPU Post-Processing Chain (`bioluminescence-post.js`)

```javascript
import * as THREE from 'three/webgpu';
import {
    emissive, mrt, output, pass, viewportUV,
    uniform, clamp, float, length, mix, smoothstep,
    vec2, vec3, vec4, dot, fract, sin, pow,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';

export class BioluminescencePost {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.size = { width: 0, height: 0 };
        this.postProcessing = new THREE.PostProcessing(renderer);
        this.useMRT = params.useMRT ?? true;
        this.bloomDownsample = params.bloomDownsample ?? 0.8;

        // Scene pass with MRT
        this.scenePass = pass(scene, camera);
        if (this.useMRT) {
            this.scenePass.setMRT(mrt({ output, emissive }));
        }

        const sceneColor = this.scenePass.getTextureNode('output');
        const bloomSource = this.useMRT
            ? this.scenePass.getTextureNode('emissive')
            : sceneColor;

        // Emissive Bloom (isolated via MRT)
        this.uBloomStrength = uniform(params.bloomStrength ?? 0.4);
        this.uBloomBoost = uniform(0);
        const totalBloom = this.uBloomStrength.add(this.uBloomBoost);
        this.bloomNode = bloom(bloomSource, totalBloom, params.bloomRadius ?? 0.3, params.bloomThreshold ?? 0.0);

        // Hook setSize for bloom downsampling
        const originalSetSize = this.bloomNode.setSize.bind(this.bloomNode);
        this.bloomNode.setSize = (w, h) => {
            originalSetSize(w * this.bloomDownsample, h * this.bloomDownsample);
        };

        // TSL uniforms
        this.uVignetteDarkness = uniform(params.vignetteDarkness ?? 0.8);
        this.uVignetteOffset = uniform(params.vignetteOffset ?? 1.2);
        this.uChromaticStrength = uniform(params.chromaticStrength ?? 0.0003);
        this.uExposure = uniform(params.exposure ?? 1.2);
        this.uContrast = uniform(params.contrast ?? 1.15);
        this.uSaturation = uniform(params.saturation ?? 1.1);
        this.uDitherStrength = uniform(params.ditherStrength ?? 0.004);

        // Build TSL post-processing graph
        const uvCoord = viewportUV;

        // 1. Vignette (strong: cave-appropriate dark edges)
        const dist = length(uvCoord.sub(0.5).mul(2.0));
        const vig = smoothstep(this.uVignetteOffset, this.uVignetteOffset.sub(0.7), dist);
        const vignetted = mix(sceneColor.mul(float(1).sub(this.uVignetteDarkness)), sceneColor, vig);

        // 2. Chromatic aberration (subtle, event-scaled)
        const chroma = chromaticAberration(vignetted, this.uChromaticStrength);

        // 3. Add bloom
        const combined = chroma.add(this.bloomNode);

        // 4. Exposure + ACES tone mapping
        const exposed = combined.mul(this.uExposure);
        const acesA = float(2.51);
        const acesB = float(0.03);
        const acesC = float(2.43);
        const acesD = float(0.59);
        const acesE = float(0.14);
        const acesNum = exposed.mul(exposed.mul(acesA).add(acesB));
        const acesDen = exposed.mul(exposed.mul(acesC).add(acesD)).add(acesE);
        let graded = clamp(acesNum.div(acesDen), float(0.0), float(1.0));

        // 5. Color grading (bioluminescent cave mood)
        const luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
        graded = mix(vec3(luma), graded, this.uSaturation);
        graded = graded.sub(0.5).mul(this.uContrast).add(0.5);

        // Shadow push toward Abyss Navy, highlight pull toward White-Cyan
        const shadowColor = vec3(0.008, 0.03, 0.06);
        const highlightColor = vec3(0.8, 1.0, 1.0);
        graded = mix(
            mix(shadowColor, graded, pow(luma, 0.8)),
            mix(graded, highlightColor, pow(luma, 2.0)),
            luma
        );

        // 6. Dithering (CRITICAL for this theme — prevents banding in deep blacks)
        const dither = fract(sin(dot(uvCoord, vec2(12.9898, 78.233))).mul(43758.5453));
        const dithered = clamp(graded.add(dither.sub(0.5).mul(this.uDitherStrength)), 0.0, 1.0);

        this.postProcessing.outputNode = dithered;
        this.postProcessing.needsUpdate = true;
    }

    update(params = {}) {
        if (params.bloomStrength !== undefined) {
            if (this.uBloomStrength) this.uBloomStrength.value = params.bloomStrength;
            else if (this.bloomNode?.strength) this.bloomNode.strength.value = params.bloomStrength;
        }
        if (params.bloomRadius !== undefined && this.bloomNode?.radius) this.bloomNode.radius.value = params.bloomRadius;
        if (params.chromaticStrength !== undefined) this.uChromaticStrength.value = params.chromaticStrength;
        if (params.vignetteOffset !== undefined) this.uVignetteOffset.value = params.vignetteOffset;
        if (params.vignetteDarkness !== undefined) this.uVignetteDarkness.value = params.vignetteDarkness;
        if (params.exposure !== undefined) this.uExposure.value = params.exposure;
        if (params.bloomBoost !== undefined) this.uBloomBoost.value = params.bloomBoost;
    }

    render() { this.postProcessing.render(); }

    setSize(width, height) {
        this.size.width = width;
        this.size.height = height;
        this.scenePass.setSize(width, height);
        if (this.bloomNode?.setSize) {
            this.bloomNode.setSize(width, height);
        }
    }

    dispose() {
        this.scenePass?.dispose?.();
        this.bloomNode?.dispose?.();
        this.postProcessing?.dispose?.();
    }
}
```

#### 2.2 - MRT Material Patching and Fail-Safe (from Cosmic Noir Phase 7)

```javascript
isNodeMaterial(material) {
    if (!material) return false;
    if (material.isNodeMaterial) return true;
    if (material.isMeshBasicNodeMaterial
        || material.isMeshStandardNodeMaterial
        || material.isMeshPhysicalNodeMaterial
        || material.isPointsNodeMaterial
        || material.isSpriteNodeMaterial) return true;
    const type = material.type || material.constructor?.name || '';
    return type.includes('NodeMaterial');
}

ensureMrtMaterials() {
    if (!this.isWebGPU || !this.flags.useMRT) return;

    const seen = new Set();
    const nonNodeMaterials = [];
    const nodeMaterials = [];
    const zeroEmissive = vec3(0, 0, 0);

    const recordMaterial = (mat, objectName = 'Unknown') => {
        if (!mat) return;
        if (Array.isArray(mat)) {
            mat.forEach((entry) => recordMaterial(entry, objectName));
            return;
        }
        if (seen.has(mat)) return;
        seen.add(mat);

        if (!this.isNodeMaterial(mat)) {
            nonNodeMaterials.push({ objectName, materialName: mat.name || mat.type || 'Unknown' });
            return;
        }

        nodeMaterials.push(mat);
        if (!mat.emissiveNode) {
            mat.emissiveNode = zeroEmissive;
        }
        mat.mrtNode = mrt({ emissive: mat.emissiveNode || zeroEmissive });
        mat.needsUpdate = true;
    };

    this.scene.traverse((child) => {
        if (child.material) recordMaterial(child.material, child.name || child.type);
    });

    // FAIL-SAFE: If any non-node material found, disable MRT entirely
    if (nonNodeMaterials.length > 0) {
        nodeMaterials.forEach((mat) => {
            mat.mrtNode = null;
            mat.needsUpdate = true;
        });
        console.warn('[Bioluminescence] MRT disabled — non-node materials detected:', nonNodeMaterials);
        this.flags.useMRT = false;
    }

    if (this.flags.mrtAudit) {
        console.log('[Bioluminescence] MRT audit:', {
            nodeCount: nodeMaterials.length,
            nonNodeCount: nonNodeMaterials.length,
            nonNodeMaterials,
        });
    }
}
```

#### 2.3 - Bloom Configuration per Quality Tier

| Quality | Strength | Radius | Threshold | Downsample |
|---------|----------|--------|-----------|------------|
| Extreme | 0.50 | 0.40 | 0.0 (MRT) | 0.9 |
| Ultra | 0.45 | 0.35 | 0.0 (MRT) | 0.85 |
| High | 0.40 | 0.30 | 0.0 (MRT) | 0.8 |
| Medium | 0.30 | 0.25 | 0.0 (MRT) | 0.7 |
| Low | 0.20 | 0.20 | 0.7 | 0.6 |
| Minimal | 0.15 | 0.15 | 0.7 | 0.5 |

#### 2.4 - WebGL Post-Processing Fallback
- `EffectComposer` with:
  - `RenderPass`
  - `UnrealBloomPass` (strength: 0.3, radius: 0.2, threshold: 0.85 — higher threshold since no MRT isolation)
  - `ShaderPass(VignetteShader)` — dark cave edges
  - `ShaderPass(ColorGradeShader)` — teal shadow push, cyan highlight pull
- 4 passes total (lean for performance)

**Exit Criteria:**
- MRT bloom isolates only emissive objects (mushrooms/crystals glow, rock doesn't bloom).
- `ensureMrtMaterials()` patches all scene materials; fail-safe disables MRT if non-node material found.
- `?bioluminescenceMrtAudit=1` logs all material MRT metadata to console.
- Tone mapping is not applied twice (post graph owns it on WebGPU path).
- WebGL path uses existing `EffectComposer` chain.
- All flag/capability permutations run without runtime errors.

---

### Phase 3: TSL Node Materials (Critical)

**Objective:** Migrate core shaders to TSL node materials on WebGPU. Extract GLSL to shaders file for WebGL.

**Files:**
- Create: `src/themes/bioluminescence/bioluminescence-materials.js`
- Create: `src/themes/bioluminescence/bioluminescence-shaders.js`
- Modify: `src/themes/bioluminescence/bioluminescence-theme.js`

#### 3.1 - TSL Procedural Noise Library (top of `bioluminescence-materials.js`)

Build reusable `Fn()` noise functions. Pattern proven in Black Hole, Neon District, and Shifting Sands:

```javascript
import { Fn, vec2, vec3, float, fract, sin, cos, dot, floor, mix, abs, smoothstep } from 'three/tsl';

const hash21 = /* @__PURE__ */ Fn(([p]) => {
    return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
});

const noise2D = /* @__PURE__ */ Fn(([p]) => {
    const i = floor(p);
    const f = fract(p);
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
    return mix(
        mix(hash21(i), hash21(i.add(vec2(1, 0))), u.x),
        mix(hash21(i.add(vec2(0, 1))), hash21(i.add(vec2(1, 1))), u.x),
        u.y
    );
});

const fbm4 = /* @__PURE__ */ Fn(([p]) => {
    let noise = noise2D(p);
    noise = noise.add(noise2D(p.mul(2.0).add(vec2(17.0))).mul(0.5));
    noise = noise.add(noise2D(p.mul(4.0).add(vec2(31.0))).mul(0.25));
    noise = noise.add(noise2D(p.mul(8.0).add(vec2(53.0))).mul(0.125));
    return noise.div(1.875);
});

const voronoi = /* @__PURE__ */ Fn(([p]) => {
    const i = floor(p);
    const f = fract(p);
    let minDist = float(8.0);
    // 3x3 grid search for nearest cell center
    // ... returns distance to nearest cell
});
```

#### 3.2 - Material Factories

Each factory returns `{ material, uniforms, meta }`:

- **`createMushroomCapNodeMaterial(params)`** — `MeshPhysicalNodeMaterial` with:
  - `transmissionNode` — light passes through thin cap edges (0.3-0.6)
  - `thicknessNode` — varies across cap surface (thin at edges, thick at center)
  - `attenuationColor` — deep teal-cyan (`#006655`)
  - `iorNode` — 1.4 (organic refractive index)
  - `emissiveNode` — animated pulse glow × `BLOOM_CLASS_WEIGHTS.mushroomCap`
  - `normalNode` — voronoi-based cell pattern for organic gill structure
  - Voronoi displacement on cap geometry (not just normal map) for organic character
  - Iridescence via view-angle-dependent color shift in emissive
  - Per-instance hue variation (±15° around primary cyan)
  - Per-instance pulse phase offset (mushrooms must NOT breathe in sync)

- **`createMushroomStemNodeMaterial()`** — `MeshStandardNodeMaterial` with wet look

- **`createCrystalNodeMaterial(params)`** — `MeshPhysicalNodeMaterial` with:
  - `transmissionNode` — 0.7-0.9 for glass-like transparency
  - `thicknessNode` — height-gradient (brighter at tips)
  - `attenuationColor` — `#004488` for deep blue internal tint
  - `iorNode` — 1.8 (crystal-like refraction)
  - `emissiveNode` — animated internal energy flow × `BLOOM_CLASS_WEIGHTS.crystalTip`
  - Fresnel rim: `pow(1.0 - abs(dot(normal, viewDir)), 4.0)` with **clamped max 0.4** (critical fix for whiteout)
  - No additive blending (remove all additive blending from crystals)
  - Internal facet geometry (hexagonal subdivisions) for visible refraction

- **`createCaveRockNodeMaterial()`** — `MeshStandardNodeMaterial` with:
  - Procedural color from `fbm4` (no canvas textures needed)
  - `normalNode` from noise-based detail
  - `roughnessNode` — wet in low areas, dry on ridges
  - `emissiveNode` — locked to zero (`vec3(0)`) so cave rock never contributes to bloom

- **`createCaveWallNodeMaterial()`** — `MeshStandardNodeMaterial` with animated bioluminescent vein network and subtle crack-line emissive response

- **`createVineNodeMaterial()`** — `MeshStandardNodeMaterial` with animated emissive veins

- **`createWaterSurfaceNodeMaterial()`** — `MeshPhysicalNodeMaterial` with:
  - `transmissionNode` — 0.6 for see-through water
  - Animated `normalNode` from multi-layer sine ripples
  - Subsurface `emissiveNode` — animated plankton glow clusters (not uniform)
  - Depth-based opacity (transparent at edges, opaque at center)
  - `attenuationColor` — `#001A1A` (Midnight Teal)

- **`createSporeParticleMaterial(isWebGPU, sporeCompute)`** — WebGPU instanced billboard quads + WebGL `THREE.Points` fallback

- **`createFireflyParticleMaterial(isWebGPU, fireflyCompute)`** — same hybrid pattern

- **`createBackgroundNodeMaterial()`** — `MeshBasicNodeMaterial` with cave void

- **`createMyceliumNodeMaterial()`** — `MeshBasicNodeMaterial` with additive blending, animated brightness wave

#### 3.3 - WebGL Fallback Shaders (`bioluminescence-shaders.js`)

Extract all 6 existing inline GLSL shaders to a dedicated shaders file (pattern from Cosmic Noir):
```javascript
// bioluminescence-shaders.js
export const mushroomCapVertexShader = `...`;
export const mushroomCapFragmentShader = `...`;
export const crystalVertexShader = `...`;
export const crystalFragmentShader = `...`;
export const terrainVertexShader = `...`;
export const terrainFragmentShader = `...`;
export const sporeVertexShader = `...`;
export const sporeFragmentShader = `...`;
export const contactRippleVertexShader = `...`;
export const contactRippleFragmentShader = `...`;
export const shoreVertexShader = `...`;
export const shoreFragmentShader = `...`;

// New WebGL fallback shaders
export const vignetteShader = { ... };
export const colorGradeShader = { ... };
```

`createWebGLFallbackMaterials()` in the materials file creates `ShaderMaterial` instances from these GLSL strings.

#### 3.4 - Conditional Material Creation in Theme
```javascript
if (this.isWebGPU) {
    const result = createMushroomCapNodeMaterial({ transmission: 0.4, ... });
    this.mushroomCapMaterial = result.material;
    this.mushroomCapUniforms = result.uniforms;
} else {
    this.mushroomCapMaterial = new THREE.ShaderMaterial({
        vertexShader: mushroomCapVertexShader,
        fragmentShader: mushroomCapFragmentShader,
        uniforms: { ... },
    });
}
```

**Exit Criteria:**
- All material factories return `{ material, uniforms, meta }` tuples.
- TSL noise helpers produce visuals matching GLSL originals.
- Bloom class weights prevent emissive washout in MRT bloom pass.
- Mushroom caps show visible light transmission through thin edges (WebGPU).
- Crystals are transparent with internal color tint, no whiteout (WebGPU).
- Fresnel rim on crystals is clamped to max 0.4.
- WebGL path uses original GLSL shaders from `bioluminescence-shaders.js`.
- Side-by-side comparison confirms visual parity.

---

### Phase 4: GPU Compute Particle Systems & Mycelium (High)

**Objective:** Move particle simulation to GPU compute with safe CPU fallback.

**Files:**
- Create: `src/themes/bioluminescence/bioluminescence-compute.js`
- Modify: `src/themes/bioluminescence/bioluminescence-materials.js`
- Modify: `src/themes/bioluminescence/bioluminescence-theme.js`

#### 4.0 - Compute Buffer Contract (Alignment-Safe, Zero-Readback)

Use explicit 16-byte aligned structures to avoid WGSL layout bugs and keep compute->render data flow stable:

```wgsl
struct ParticleState {
    position : vec4f,  // xyz + life
    velocity : vec4f,  // xyz + seed
    color    : vec4f,  // rgb + size
    misc     : vec4f,  // phase, state, age, active
};
```

- Stride: 64 bytes per particle (no packed scalars outside `vec4f` lanes).
- Use ping-pong storage buffers (`readBuffer`, `writeBuffer`) for each simulation system.
- Swap buffers after each dispatch, never read back to CPU inside frame loop.
- Keep workgroup size fixed at 64 unless profiling proves a better per-device setting.
- Document byte offsets in code comments in `bioluminescence-compute.js` for every struct field.

#### 4.1 - SporeCompute Class
- `StorageBufferAttribute` for interleaved buffers: `[x, y, z, life]` + `[vx, vy, vz, seed]` per particle
- Compute shader via `Fn()`: upward float + 3D noise turbulence + lifecycle + wind gusts
- Quality scaling: 1000 (High) → 3000 (Extreme)
- Material uses vertex pulling: `storage()` → `positionNode`

#### 4.2 - FireflyCompute Class
- 50-200 particles (quality-scaled)
- State machine encoded in `state` float (idle hover → dart → hover → glow → reset)
- Color variation per firefly based on seed
- Instanced camera-facing quads on WebGPU (not Points)

#### 4.3 - MyceliumPulseCompute Class (Extreme/Ultra only)
- Simulates glow propagation through underground network
- Network nodes at mushroom/crystal base positions
- Game events trigger propagation waves
- Material reads brightness per node

#### 4.4 - Integration and Fallback
- **WebGPU:** Spore/firefly visuals use instanced billboards, transform/color from compute storage buffers
- **WebGL:** Keep existing `THREE.Points` with GLSL vertex shader for spores; fireflies/mycelium simplified
- No CPU readback from compute buffers in frame loop (zero-readback path)
- `?bioluminescenceNoCompute=1` disables compute; falls back to CPU

**Exit Criteria:**
- Spores computed entirely on GPU (WebGPU) or CPU (WebGL).
- WebGPU particles are visually large enough (not 1px artifacts).
- Minimum 1000 spores at 60fps on mid-range GPU.
- No performance regression on WebGL path.
- Compute and CPU paths are runtime-switch safe.

---

### Phase 5: Enhanced Environment & World Building (High)

**Objective:** Transform the cave from sparse to vast, deep, and alive.

**Files:**
- Modify: `src/themes/bioluminescence/bioluminescence-theme.js`
- Modify: `src/themes/bioluminescence/bioluminescence-materials.js`

#### 5.1 - Dramatic Cave Architecture

**Cave ceiling:**
- Large dome-shaped displaced PlaneGeometry at y=450-500
- Procedural stalactite clusters: groups of 3-7 ConeGeometry hanging down
- Bioluminescent moss patches on stalactite surfaces (irregular organic shapes via voronoi, NOT circles)
- Dripping water: occasional small sphere dropping from stalactite tips

**Side walls (left/right):**
- Two curved PlaneGeometry walls (concave toward center) at x=±500
- Displacement from multi-octave noise for rocky surface
- TSL cave wall material with animated bioluminescent vein network
- Shelf mushrooms growing from wall surfaces

**Cave floor enhancement:**
- Deeper cracks with emissive bioluminescent moss in crevices
- Small rock formations (InstancedMesh with per-instance random transform)

**Cave depth (background layers) — parallax:**
- Layer 1 (z=-400): Silhouette mushroom/crystal shapes (dark with subtle edge glow)
- Layer 2 (z=-600): Faint glowing spots suggesting distant cave continuation
- Layer 3 (z=-800): Pure darkness with occasional dim pulse
- Fog density gradient that fades distant layers naturally

#### 5.2 - Bioluminescent Water Pool Overhaul

Replace `Water.js` entirely with custom implementation:
- **WebGPU:** `MeshPhysicalNodeMaterial` with transmission, animated sine-wave normals, subsurface plankton glow clusters, depth-based opacity
- **WebGL:** `ShaderMaterial` with animated sine-wave normals, Fresnel reflection, emissive hint
- Caustics projection onto underwater terrain (animated texture projection, even faked)
- Shore foam ring with noise-based pattern
- Contact ripples at mushroom/crystal bases in water

#### 5.3 - Enhanced Mushroom Ecosystem

4 distinct species (all share material factory with per-instance params):

| Species | Geometry | Size | Placement | Count (High) |
|---------|----------|------|-----------|---------------|
| **Tall Spire** | Thin cylinder stem + varied cap shapes (some flat, some domed, some upturned) | H: 30-60 | Floor, scattered | 8-12 |
| **Shelf/Bracket** | Flat disc + quarter-sphere cap | W: 15-30 | Wall surfaces | 6-10 |
| **Cluster Mini** | InstancedMesh, 5-8 per cluster | H: 3-8 | Rock surfaces, near large mushrooms | 4-6 clusters |
| **Giant Ancient** | Large cylinder + dome cap + root tendrils + cap underside gill fins | H: 80-120 | 1-2 focal points | 1-2 |

Per-species tweaks: transmission strength, emissive color shift, pulse speed, voronoi scale.

#### 5.4 - Crystal Formation Upgrade

3 crystal types with proper transmission materials (no additive blending):

| Type | Count (High) |
|------|--------------|
| **Pillar Crystal** (hex cylinder, pointed top, floor clusters) | 5 clusters |
| **Ceiling Crystal** (inverted, hanging) | 8-12 |
| **Micro-Crystal** (InstancedMesh, embedded in rock) | 200-500 instances |

#### 5.5 - Mycelium Network (Signature Visual)

The defining feature:
- Thin `TubeGeometry` (radius 0.3-0.8) paths between nearby mushroom bases
- CatmullRomCurve3 with jittered midpoints (no perfectly straight lines)
- `MeshBasicNodeMaterial` with additive blending, animated brightness from compute or CPU
- Partially visible through terrain (emissive cracks align with mycelium paths)

#### 5.6 - Flora & Organic Details

- Glowing vines with animated bioluminescent veins and seed pods at tips
- Moss patches (InstancedMesh, 50-100 instances, breathing animation)
- Hanging tendrils from ceiling (4-8, pendulum sway, glow orb at tip)
- Floating jellyfish (Extreme/Ultra only, 2-4 translucent creatures)

**Exit Criteria:**
- Cave feels vast, deep, and alive with multiple depth layers.
- Water is a stunning centerpiece with visible subsurface glow.
- At least 4 mushroom species and 3 crystal types.
- Mycelium network visibly connects organisms.
- All new elements use TSL materials on WebGPU, fallback on WebGL.
- Performance stays within budget per tier.

---

### Phase 6: Advanced Lighting & Atmosphere (High)

**Objective:** Add volumetric atmosphere and dynamic lighting to sell the cave environment.

**Files:**
- Modify: `src/themes/bioluminescence/bioluminescence-theme.js`
- Modify: `src/themes/bioluminescence/bioluminescence-materials.js`

#### 6.1 - Volumetric Atmosphere
- Height-based fog density (denser near water, thinner above)
- Color-graded: teal near emissive sources, deep navy in dark areas
- Animated wisps: slow 3D noise displacement

#### 6.2 - God Rays / Light Shafts
- Cone geometry with TSL material (animated intensity, dust motes within)
- 4-8 cones (quality-scaled), placed at ceiling openings
- Color tinted by nearest bioluminescent source

#### 6.3 - Dynamic Point Lights (Quality-Gated)
- Only on High+ quality presets
- 1 PointLight per Giant Mushroom (colored, radius 200)
- 1 PointLight per Pillar Crystal cluster (colored, radius 150)
- Animate light intensity in sync with object emissive pulse
- Medium and below: `pointLightCount = 0` (hard gate, not heuristic)

#### 6.4 - Atmospheric Particles
- Dust motes: 500-2000 (quality-scaled), catch light from nearby emissive sources
- Water vapor (Extreme/Ultra only): subtle mist rising from water surface

**Exit Criteria:**
- Atmosphere feels thick and mysterious.
- God rays add drama without overwhelming.
- Dynamic point lights only on presets that can afford them.
- Performance remains within budget.

---

### Phase 7: Game Event Reactions & Polish (Medium)

**Objective:** Wire the reactive envelope system to all visual subsystems.

**Files:**
- Modify: `src/themes/bioluminescence/bioluminescence-theme.js`

#### 7.1 - Event Response System (via Reactive Envelope)

| Event | Envelope Push | Duration |
|-------|---------------|----------|
| **PIECE_LOCK** | `{ pulse: 0.15, spore: 0.2 }` | 0.3s decay |
| **LINE_CLEAR** | `{ pulse: 0.2+lines*0.1, bloom: 0.08+lines*0.06, water: 0.15+lines*0.1, mycelium: 0.3 }` | 0.8s decay |
| **COMBO (1-3)** | `{ pulse: 0.2+n*0.1, bloom: 0.1+n*0.08, spore: 0.3+n*0.15, atmosphere: 0.2+n*0.1 }` | Sustained, 1s decay |
| **COMBO (4+)** | Above + `{ atmosphere: 0.5, water: 0.3 }` | Sustained, 1.5s decay |
| **TETRIS** | `{ pulse: 1.0, bloom: 0.5, spore: 1.0, mycelium: 1.0, atmosphere: 0.8, water: 0.6, exposure: 0.4 }` | 2s decay |

Animation loop reads envelope channels to update uniforms:
```javascript
// In animate():
this.updateReactiveEnvelope(delta);
const env = this.reactiveEnvelope;

// Update post-processing
if (this.postProcessing) {
    this.postProcessing.update({
        bloomBoost: env.bloom * 0.3,
        exposure: 1.2 + env.exposure * 0.3,
        chromaticStrength: 0.0003 + env.bloom * 0.001,
    });
}

// Update material uniforms
this.mushroomCapUniforms?.uPulseIntensity?.setValue(env.pulse);
// ... etc for all material systems
```

#### 7.2 - Ambient Animation (Idle State)
- Organic breathing: all emissive intensities have base sine cycle (4-8s period, ±10%)
- Periodic cave life events (random, every 10-30s):
  - Distant mushroom flash
  - Water disturbance
  - Firefly congregation
  - Spore gust

#### 7.3 - Performance Optimization
- Frustum culling: ensure no `frustumCulled = false` on standard meshes
- LOD for Giant mushrooms (2 levels)
- InstancedMesh for micro-crystals, moss, rubble, cluster mushrooms
- Compute workgroup sizing: 64 invocations
- Frame budget monitoring with auto-reduce

**Exit Criteria:**
- Game events create satisfying, visible, layered reactions.
- TETRIS event is spectacular and memorable.
- Animation feels alive even during idle.
- Stable 60fps at High on mid-range desktop GPU.

---

### Phase 8: Quality Presets & Final Tuning (Low)

#### 8.1 - Quality Preset Scaling
```javascript
const QUALITY_PRESETS = {
    Extreme: {
        mushroomCount: 25, crystalClusterCount: 8, ceilingCrystalCount: 12,
        stalactiteCount: 15, vineCount: 12, tendrilCount: 8,
        microCrystalCount: 500, mossPatchCount: 100, rubbleCount: 60,
        sporeCount: 3000, fireflyCount: 200, dustMoteCount: 2000, vaporCount: 500,
        enableCompute: true, enableMyceliumPulse: true,
        enableJellyfish: true, jellyfishCount: 4,
        enablePostProcessing: true, enableMRT: true,
        bloomStrength: 0.5, bloomRadius: 0.40, bloomDownsample: 0.9,
        enableDoF: false, enableFilmGrain: false,
        pointLightCount: 8, backgroundLayers: 3,
        adaptiveDrsRange: [0.75, 1.00],
    },
    Ultra: {
        mushroomCount: 20, crystalClusterCount: 6, ceilingCrystalCount: 10,
        stalactiteCount: 12, vineCount: 10, tendrilCount: 6,
        microCrystalCount: 300, mossPatchCount: 80, rubbleCount: 40,
        sporeCount: 2000, fireflyCount: 150, dustMoteCount: 1500, vaporCount: 300,
        enableCompute: true, enableMyceliumPulse: true,
        enableJellyfish: true, jellyfishCount: 2,
        enablePostProcessing: true, enableMRT: true,
        bloomStrength: 0.45, bloomRadius: 0.35, bloomDownsample: 0.85,
        enableDoF: false, enableFilmGrain: false,
        pointLightCount: 6, backgroundLayers: 3,
        adaptiveDrsRange: [0.72, 1.00],
    },
    High: {
        mushroomCount: 15, crystalClusterCount: 5, ceilingCrystalCount: 8,
        stalactiteCount: 8, vineCount: 8, tendrilCount: 4,
        microCrystalCount: 200, mossPatchCount: 50, rubbleCount: 25,
        sporeCount: 1000, fireflyCount: 100, dustMoteCount: 1000, vaporCount: 0,
        enableCompute: true, enableMyceliumPulse: false,
        enableJellyfish: false, jellyfishCount: 0,
        enablePostProcessing: true, enableMRT: true,
        bloomStrength: 0.4, bloomRadius: 0.30, bloomDownsample: 0.8,
        enableDoF: false, enableFilmGrain: false,
        pointLightCount: 5, backgroundLayers: 2,
        adaptiveDrsRange: [0.68, 1.00],
    },
    Medium: {
        mushroomCount: 10, crystalClusterCount: 3, ceilingCrystalCount: 4,
        stalactiteCount: 5, vineCount: 6, tendrilCount: 2,
        microCrystalCount: 100, mossPatchCount: 30, rubbleCount: 15,
        sporeCount: 500, fireflyCount: 50, dustMoteCount: 500, vaporCount: 0,
        enableCompute: false, enableMyceliumPulse: false,
        enableJellyfish: false, jellyfishCount: 0,
        enablePostProcessing: true, enableMRT: false,
        bloomStrength: 0.3, bloomRadius: 0.25, bloomDownsample: 0.7,
        enableDoF: false, enableFilmGrain: false,
        pointLightCount: 0, backgroundLayers: 1,
        adaptiveDrsRange: [0.62, 0.94],
    },
    Low: {
        mushroomCount: 6, crystalClusterCount: 2, ceilingCrystalCount: 2,
        stalactiteCount: 3, vineCount: 4, tendrilCount: 0,
        microCrystalCount: 0, mossPatchCount: 0, rubbleCount: 0,
        sporeCount: 200, fireflyCount: 0, dustMoteCount: 0, vaporCount: 0,
        enableCompute: false, enableMyceliumPulse: false,
        enableJellyfish: false, jellyfishCount: 0,
        enablePostProcessing: true, enableMRT: false,
        bloomStrength: 0.2, bloomRadius: 0.20, bloomDownsample: 0.6,
        enableDoF: false, enableFilmGrain: false,
        pointLightCount: 0, backgroundLayers: 1,
        adaptiveDrsRange: [0.56, 0.84],
    },
    Minimal: {
        mushroomCount: 3, crystalClusterCount: 1, ceilingCrystalCount: 0,
        stalactiteCount: 0, vineCount: 2, tendrilCount: 0,
        microCrystalCount: 0, mossPatchCount: 0, rubbleCount: 0,
        sporeCount: 80, fireflyCount: 0, dustMoteCount: 0, vaporCount: 0,
        enableCompute: false, enableMyceliumPulse: false,
        enableJellyfish: false, jellyfishCount: 0,
        enablePostProcessing: false, enableMRT: false,
        bloomStrength: 0.15, bloomRadius: 0.15, bloomDownsample: 0.5,
        enableDoF: false, enableFilmGrain: false,
        pointLightCount: 0, backgroundLayers: 0,
        adaptiveDrsRange: [0.50, 0.78],
    },
};
```

`enableDoF` and `enableFilmGrain` are locked `false` for this upgrade scope. They may be explored only after all Phase 9 release gates are green.

#### 8.2 - Adaptive Resolution Scaling (DRS)
- Track smoothed frame time per frame
- If frame time exceeds budget, reduce render resolution within `adaptiveDrsRange`
- If frame time has headroom, gradually increase back toward 1.0
- Quality floor prevents resolution from dropping below minimum per tier

#### 8.3 - Final Art Direction Tuning Checklist
- [ ] Balance all glow intensities: no single element overwhelms others
- [ ] Verify color harmony: all sources within the defined palette
- [ ] Check brightness hierarchy matches Visual Hierarchy section
- [ ] Darkness is preserved: at least 40% of visible area should be very dark
- [ ] Bloom halos don't bleed excessively into dark areas
- [ ] Water shows visible subsurface glow and depth variation
- [ ] Mycelium network is visible but subtle (not competing with mushrooms)
- [ ] Crystal transmission shows internal color tint without whiteout
- [ ] Mushroom SSS visible from multiple camera angles
- [ ] Per-mushroom color variation is visible (not all identical teal)
- [ ] Spores and fireflies have distinct movement patterns
- [ ] Game events are satisfying at all combo levels
- [ ] TETRIS event is the most spectacular moment in the scene
- [ ] WebGL fallback is still visually impressive
- [ ] Cave ceiling uses organic shapes (voronoi), not projected circles
- [ ] Background depth layers create sense of vast cave
- [ ] Test at 1080p, 1440p, and 4K resolutions
- [ ] No z-fighting between water surface and terrain

---

### Phase 9: QA & Validation (Critical)

**Objective:** Final correctness, fallback, and stability validation before release.

#### 9.1 - Visual Regression Validation
- Capture deterministic screenshots (fixed seed, fixed timestep) for each quality preset
- Compare WebGPU vs WebGL fallback framing for key camera shots
- Compare event reaction frames against approved references

#### 9.2 - Performance Validation
- Track `avg`, `p95`, and worst frame time per preset and backend
- Track pass-level costs when GPU timestamps are available
- Validate startup time and shader compilation stutter with/without warm-up path
- Verify budgets from Performance Budgets table are met

#### 9.3 - Fallback and Kill-Switch Validation
- Validate each `?bioluminescenceNo*` flag independently
- Validate `?forceWebGL=1` and natural WebGL fallback
- Confirm game events and cleanup behavior in every fallback mode

#### 9.4 - Long-Run Stability
- 30-minute soak test per backend without scene reload
- Theme-switch loop test (100+ `createScene`/`cleanup` cycles) for leak detection
- Device-loss simulation on WebGPU path where supported

**Exit Criteria:**
- No console errors in WebGPU full path, WebGPU degraded path, or WebGL fallback path.
- WebGPU `High`: `avg <= 16.7ms`, `p95 <= 16.7ms`; WebGL fallback `Medium`: `avg <= 16.7ms`, `p95 <= 20ms`.
- 30-minute soak test shows stable memory trend (no unbounded growth).
- All flag/capability permutations pass without runtime errors.
- Visual diff, bloom containment, and readability checks pass the locked thresholds.

---

## Phase Dependency Graph

```
Phase 0 (Baseline + Instrumentation) ──> Phase 1 (Renderer + Lifecycle)

Phase 1 ──> Phase 2 (Post-Processing + MRT)   ← MRT validated early

Phase 1 + 2 ──> Phase 3 (TSL Materials)       ← materials need MRT context

Phase 1 + 3 ──> Phase 4 (GPU Compute)         ← needs materials for particle rendering

Phase 3 ──> Phase 5 (Environment)             ← needs materials system

Phase 4 + 5 ──> Phase 6 (Lighting & Atmosphere)

Phase 2 + 4 + 5 + 6 ──> Phase 7 (Events & Polish)

Phase 7 ──> Phase 8 (Quality & Tuning) ──> Phase 9 (QA & Validation)
```

**Key change from original plan:** Post-processing (Phase 2) comes immediately after renderer foundation, before materials. This ensures MRT bloom is validated early and materials can be tested with proper emissive isolation from the start.

**Parallel tracks after Phase 2:**
- Track A: Phase 3 (TSL materials) → Phase 4 (compute)
- Track B: Phase 5 (environment) can begin once Phase 3 core materials are ready

---

## Testing and Validation Matrix

### Functional
- Backend startup scenarios:
  - WebGPU available
  - WebGPU unavailable
  - forced WebGL
  - post disabled
  - MRT disabled
  - compute disabled
- Theme switch stress: 100+ repeated activate/deactivate cycles.
- Event stress: sustained combo spam with deterministic playback.

### Visual
- Side-by-side baseline diffs per quality tier and backend.
- Hero-frame checks:
  - mushroom/crystal glow hierarchy
  - cave depth layering
  - water quality
  - bloom containment
  - darkness ratio (>= 40%)

### Hardware Matrix (Required)
- Windows desktop NVIDIA (WebGPU + WebGL).
- Windows desktop AMD/Intel (WebGPU + WebGL).
- Apple Silicon macOS (WebGPU + WebGL).
- Linux desktop (WebGL mandatory, WebGPU optional).

### Performance
- Track per backend/preset:
  - average FPS
  - 1% low
  - frame-time variance
  - draw calls
  - memory footprint
- Verify against Performance Budgets table.

---

## Risk Register and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| WebGPU unavailable/blocked | Startup failure or missing visuals | Silent WebGL2 fallback with explicit capability matrix |
| WebGPU points render at 1px | Spores/fireflies nearly invisible | Use instanced billboards/sprites on WebGPU path |
| MRT unsupported or partially supported | Emissive bloom pipeline breaks | Gate `useMRT` via probe + kill switch; fail-safe `ensureMrtMaterials()` |
| MRT mixed materials | Rendering errors with non-node materials | `ensureMrtMaterials()` disables MRT if any non-node material found |
| Compute unsupported/slow | Performance regressions | Capability-gate compute, quality-scaled counts, CPU fallback |
| MeshPhysicalNodeMaterial too expensive | Frame-time spikes | Quality-gate transmission features; per-material LOD |
| Shader compilation stutter | First-frame hitching | `precompileSceneWithTimeout()` (3s max) |
| Device loss | Black screen during gameplay | `handleDeviceLoss()` auto-restarts with WebGL |
| Double tone mapping | Washed-out highlights | Explicit color-pipeline ownership: post OR renderer, never both |
| Bloom washout/flicker | Bright elements dominate scene | Per-material bloom class weights control emissive contribution |
| Visual regression during migration | Art drift from approved look | Deterministic screenshot diffs + baseline camera set |
| Memory leaks during theme switching | Long-session instability | Strict disposal order + 100-cycle soak test |
| Over-complex mycelium behavior | Feature stalls or instability | Quality-gated: static tubes + CPU pulse on lower tiers |
| Crystal whiteout (current bug) | Crystals appear as white blobs | Remove additive blending; use transmission + clamped fresnel (0.4 max) |
| Scope inflation from visual ambition | Schedule risk | Strict phase gates with measurable exits |

---

## Browser Compatibility Matrix

| Environment | WebGPU Expectation | Fallback | Expected Path |
|-------------|--------------------|----------|---------------|
| Electron packaged build | Prefer WebGPU when probe passes | WebGL2 | WebGPU + TSL + Compute + MRT (full path) |
| Chromium Desktop | Prefer WebGPU when probe passes | WebGL2 | WebGPU full; compute/MRT gated by probe |
| Safari Desktop | Prefer WebGPU when probe passes | WebGL2 | WebGPU + TSL; compute/MRT gated by probe |
| Firefox Desktop | Usually fallback unless probe passes | WebGL2 | WebGL2 fallback by default |
| Non-WebGPU desktops | N/A | WebGL2 | No startup errors; gameplay visuals intact |

---

## Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Rendering mode | Synchronous `render()` | Matches gold standard themes; avoids async timing complexity |
| Material return pattern | `{ material, uniforms, meta }` tuple | Clean separation; enables MRT audit logging (from Chromadelic) |
| Bloom control | Per-material class weights | Prevents washout; fine-grained emissive tuning (from Chromadelic/Cosmic Noir) |
| Noise implementation | TSL `hash21` + `noise2D` + `fbm4` + `voronoi` | Compile-time graph construction; GPU-native (from Black Hole) |
| Particle architecture | Instanced billboards (WebGPU) / Points (WebGL) | Avoids 1px point size limit on WebGPU |
| MRT fail-safe | Disable MRT if any non-node material found | Prevents mixed-material rendering crashes (from Cosmic Noir) |
| Device loss | Auto-restart with WebGL fallback | Graceful recovery without user intervention (from Chromadelic) |
| Color pipeline | Post owns tone mapping on WebGPU post path | Prevents double tonemap and highlight washout |
| Shader compilation | Timeout-guarded `compileAsync` (3s max) | Prevents indefinite stall on slow devices (from Chromadelic) |
| Post dithering | Always on | Critical for cave theme — prevents banding in deep blacks |
| Bloom threshold | 0.0 with MRT (emissive-only) | Eliminates false glow on dark scene elements |
| Event system | Unified reactive envelope with per-channel decay | Replaces ad-hoc pulse variables (from Cosmic Noir) |
| Crystal fresnel cap | Max 0.4 (not 0.6) | Fixes current whiteout bug visible in screenshot |
| GLSL fallback location | Separate `bioluminescence-shaders.js` | Keeps materials file focused on TSL (from Cosmic Noir) |
| Adaptive resolution | DRS with per-tier quality floor | Maintains frame budget under load (from Chromadelic) |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| **Visual Impact** | First impression is high-contrast, living cave mood in approved camera set |
| **Signature Moment** | Mycelium pulse on `TETRIS` is clearly visible and repeatable |
| **Crystal Fix** | Crystals show internal colored volume, no whiteout |
| **Mushroom SSS** | Cap edges show light transmission, per-mushroom color variation visible |
| **Darkness Ratio** | >= 40% of screen area remains very dark |
| **Performance (WebGPU High)** | `avg <= 16.7ms`, `p95 <= 16.7ms`, `p99 <= 20ms` on GTX 1060 / RX 580 class |
| **Performance (WebGL Medium)** | `avg <= 16.7ms`, `p95 <= 20ms`, no major stutter during events |
| **Startup Robustness** | First interactive frame < 3s; fallback always succeeds |
| **Fallback Quality** | WebGL path remains art-direction compliant and gameplay-reactive |
| **Code Quality** | Modular split (`theme`, `materials`, `shaders`, `compute`, `post`) with clear capability gates |
| **Correctness** | No console errors, clean init/cleanup, no leak trend in 30-min soak |
| **Color Accuracy** | Emissive outputs stay within defined palette |
| **Budget Compliance** | Draw calls and frame times within Performance Budgets table |

---

## Release Gates (Definition of Done)

1. Phase 0 deterministic harness and baseline captures are complete.
2. Every `?bioluminescenceNo*` flag passes startup + gameplay smoke tests.
3. `ensureMrtMaterials()` correctly patches all materials or disables MRT gracefully.
4. WebGPU full path and WebGL fallback both pass the Phase 9 validation checklist.
5. Performance and soak-test targets in Success Metrics are met.
6. No open P1/P2 rendering, stability, or fallback bugs.
7. Reactive envelope system drives all event responses through unified channels.
8. Final QA checklist passes on required hardware matrix.
9. `docs/BIOLUMINESCENCE_ART_DIRECTION.md` and `docs/BIOLUMINESCENCE_BASELINE_CAPTURE_PROTOCOL.md` are complete and approved.
10. `tests/performance/benchmark-bioluminescence-phase9.html` and Phase unit tests (`phase0`, `phase1`, `phase6`, `phase9`) exist and pass.

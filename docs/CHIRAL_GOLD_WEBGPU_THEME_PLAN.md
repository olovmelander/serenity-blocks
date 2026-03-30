# Chiral Gold Theme - WebGPU Implementation Plan

## Context

Create a new visually stunning WebGPU theme called **"Chiral Gold"** for Serenity Blocks, inspired by:
- **Death Stranding 2's "Chiral Gold" aesthetic**: Dark cinematic atmosphere, brilliant golden metallic particles, high contrast between deep blacks and bright gold, wet/metallic light catching, volumetric golden beams
- **Tetris Effect's synesthesia**: Every gameplay action triggers synchronized visual responses. Particles pulse with the music beat. The player feels like part of the visual experience
- Pure dark void with floating golden particles - **no reflective plane**
- Music-reactive particles using real-time audio frequency analysis (new capability)

**Reference implementation**: Cosmic Noir theme (`src/themes/cosmic-noir/`) is the most complex existing WebGPU theme and serves as the architectural template.

---

## Files to Create

### Theme Files (new directory: `src/themes/chiral-gold/`)

| File | Purpose | Lines (est.) |
|------|---------|------|
| `chiral-gold-theme.js` | Main theme class extending BaseTheme | ~2800 |
| `chiral-gold-compute.js` | 3 GPU compute classes for particle physics | ~500 |
| `chiral-gold-materials.js` | TSL node materials for all particle types | ~600 |
| `chiral-gold-post.js` | WebGPU PostProcessing pipeline | ~200 |
| `chiral-gold-shaders.js` | WebGL fallback GLSL shaders | ~400 |
| `chiral-gold-tetrominos.js` | Gold-palette block colors + glow config | ~50 |

### New Shared Utility

| File | Purpose |
|------|---------|
| `src/audio/audio-analyzer.js` | Real-time audio frequency analyzer (Web Audio API AnalyserNode) |

### Files to Modify

| File | Change |
|------|--------|
| `src/themes/theme-registry.js` | Add `chiral-gold` entry to registry |
| `src/audio/sound-manager.js` | Add `getAnalyzer()` method (lazy AudioAnalyzer creation) |

---

## 1. Audio Analyzer (`src/audio/audio-analyzer.js`)

New shared utility - any theme can opt in. Bridges `SoundManager.audioContext` + `SoundManager.audioElement` with real-time frequency analysis.

**Design**:
- Creates `AnalyserNode` (fftSize=2048, smoothingTimeConstant=0.8)
- `SoundManager` owns a single `MediaElementSourceNode` + `AudioAnalyzer` instance (single source of truth)
- Themes never call `createMediaElementSource()` directly (prevents duplicate-node `InvalidStateError`)
- Signal chain: `mediaSource → analyser → audioContext.destination` (preserves audio output)
- Analyzer bands are computed from sample rate / FFT size (Hz-driven, not fixed bin indices)

**API**:
```
update(deltaTime)        // Call each frame - reads frequency + time-domain data
getBassEnergy() → 0-1    // Average of bins 0-10 (20-200Hz)
getMidEnergy() → 0-1     // Average of bins 10-100 (200-2000Hz)
getTrebleEnergy() → 0-1  // Average of bins 100-512 (2000-20kHz)
getOverallEnergy() → 0-1 // Average all frequency bins
getBeatDetected() → bool // Onset detection: bass spike > 1.3x previous + 150ms cooldown
dispose()                // Disconnect nodes (don't close shared audioContext)
```

**SoundManager integration (recommended reusable API)**:
```javascript
getAnalyzer() {
    if (!this.audioAnalyzer && this.audioContext && this.audioElement) {
        this.audioAnalyzer = new AudioAnalyzer(this.audioContext, this.audioElement);
    }
    return this.audioAnalyzer;
}

getAudioAnalysis(deltaTime = 1 / 60) {
    const analyzer = this.getAnalyzer();
    return analyzer ? analyzer.update(deltaTime) : {
        bassEnergy: 0, midEnergy: 0, trebleEnergy: 0, overallEnergy: 0, beatDetected: false,
    };
}
```

**Consumer pattern for themes**:
- In `animate()`, call `soundManager.getAudioAnalysis(delta)` and use returned snapshot values
- Do not dispose analyzer from theme instances; `SoundManager` owns analyzer lifecycle
- Intro/other systems should also use `getAudioAnalysis()` to reuse the same graph

---

## 2. Particle Systems (GPU Compute)

### 2a. ChiralGoldDustCompute - Ambient Gold Dust (The Main Visual Layer)

- **Count**: 1,500 (Minimal) → 30,000 (Extreme)
- **Buffers**: position(vec4), velocity(vec4), life(vec4: birthTime, alpha, maxLife, phase), color(vec4: r, g, b, size)
- **Color palette**: 40% deep amber `#B8860B`, 25% bright gold `#FFD700`, 20% warm white `#FFF8DC`, 10% copper `#B87333`, 5% pure white
- **Size**: 2-25px, modulated by bass energy
- **Lifecycle**: Continuous - particles respawn at random positions when life expires (8-20s cycle)

**Movement & Formation System** — The dust particles are NOT statically floating. They have layered, evolving movement:

1. **Three Depth Bands** (like cosmic-noir's star layers but for particles):
   - **Near band** (25%): radius 400-1200, larger particles (15-25px), fastest movement, strongest parallax (0.6)
   - **Mid band** (40%): radius 1000-2800, medium particles (8-18px), moderate movement, parallax (0.35)
   - **Far band** (35%): radius 2400-5000, tiny particles (2-10px), slow ethereal drift, parallax (0.15)

2. **Base Movement — Orbital Vortex**:
   - All particles orbit around a central axis (not a point) on tilted elliptical paths
   - Each particle has a unique orbit tilt angle (±30° from horizontal)
   - Orbital speed varies by depth band: Near=0.15 rad/s, Mid=0.08 rad/s, Far=0.03 rad/s
   - Creates a galaxy-like swirling motion when viewed together

3. **Turbulence Layer — Curl Noise Flow Field**:
   - 3D curl noise displacement applied on top of orbital motion
   - Prevents particles from looking mechanical/uniform
   - Curl noise evolves slowly over time (frequency 0.002, amplitude 40-80 units)
   - Creates organic, smoke-like particle clustering
   - Implementation: `curlNoise(pos * 0.002 + time * 0.05)` computed in GPU shader

4. **Audio-Reactive Breathing**:
   - **Bass (20-200Hz)**: Modulates orbit radius — all particles push outward on bass hits then contract back. Creates a "cosmic heartbeat" effect: `radiusScale = 1.0 + bassEnergy * 0.3`
   - **Mid (200-2000Hz)**: Modulates orbital speed — particles swirl faster during melodic passages: `speedMultiplier = 1.0 + midEnergy * 0.5`
   - **Beat detection**: On detected beat, ALL particles receive a brief outward velocity impulse (15 units, decays over 0.3s) — creates a visible "pulse wave" expanding from center
   - **Overall energy**: Modulates turbulence amplitude — calm music = gentle drift, intense music = chaotic swirling

5. **Formation Transitions** (state-based, triggered by combos):
   - **Idle state**: Normal orbital vortex (default)
   - **Convergence** (combo 4-6): 30% of particles begin spiraling inward toward center over 2s, creating a dense golden core, then slowly disperse back
   - **Expansion** (combo 7-9): All particles accelerate outward in a rapid expansion, then snap back with elastic easing — like the universe breathing
   - **Supernova** (combo 10+): ALL particles rush to center point over 0.5s (forming a blindingly bright golden singularity), then EXPLODE outward in all directions at high speed, slowly returning to orbital paths over 4-5s
   - Formations are implemented via `uFormationState` (0=idle, 1=converge, 2=expand, 3=supernova) and `uFormationProgress` (0-1) uniforms in the compute shader. The shader lerps between current position and target formation position.

6. **Particle Clustering & Streams**:
   - Particles aren't uniformly distributed — they naturally cluster into streams and ribbons due to curl noise
   - Occasional dense "rivers" of gold particles flowing through space
   - Clusters slowly form and dissolve as curl noise field evolves

### 2b. ChiralGoldBurstCompute - Event Burst Sparks

- **Count**: 0 (Low/Minimal, CPU fallback) → 50,000 (Extreme)
- **Life**: 2.0-4.0s with 0-0.5s stagger delay
- **Color**: 60% bright gold, 25% hot white core, 15% copper
- **Size**: 3-120px, scaling with life alpha
- **Trigger**: `triggerBurst(time, intensity, origin)` - activates 8-26% of pool per burst, ring-buffer index cycling

**Movement Patterns** — Burst sparks have varied, dramatic trajectories:

1. **Radial Explosion** (primary, 60% of particles):
   - Spherical burst from origin point
   - Initial speed: 60-120 u/s (fast and dramatic)
   - Deceleration curve: `max(0.25, 1.0 - pow(lifeNorm, 1.5))` — fast start, graceful slowdown
   - Slight gravity pull (-8 u/s² on Y) for dramatic arcing trajectories
   - Particles leave "comet tails" via size elongation in direction of travel

2. **Spiral Shooters** (25% of particles):
   - Launch in spiral patterns (tangential velocity + outward expansion)
   - Creates golden spiral arms extending from burst center
   - `tangentialSpeed = 80 + comboCount * 15`, `outwardSpeed = 40 + comboCount * 8`
   - Helical rising motion: `y += sin(helixPhase * 2) * 25`

3. **Screen Streakers** (15% of particles):
   - Aim directly toward camera at very high speed (200-350 u/s)
   - Streak across the screen creating dramatic "rain of gold" effect
   - Very short life (1.0-1.5s) but visually impactful
   - Size increases as they approach camera (perspective scaling)

4. **Deceleration Art**:
   - As particles slow down near end of life, they briefly join the ambient dust orbital flow before fading
   - Creates a visual connection between burst energy and ambient atmosphere
   - Achieved by lerping velocity toward nearest dust orbital velocity as `lifeNorm > 0.7`

### 2c. ChiralGoldWispCompute - Golden Firefly Wisps

- **Count**: 80 (Minimal) → 1,000 (Extreme)
- **Size**: 60-120px (larger accent particles)

**Movement — Ethereal Intelligence**:

1. **3D Lissajous Figures**:
   - Each wisp follows a unique Lissajous curve in 3D space
   - Parameters: `x = A * sin(a*t + δ)`, `y = B * sin(b*t)`, `z = C * sin(c*t + φ)`
   - Where a, b, c are small integers (1-5) with slight random offsets for organic feel
   - Creates figure-8, infinity, and clover-leaf paths
   - Amplitude: 200-800 units, period: 15-40 seconds (slow, mesmerizing)

2. **Flocking Behavior** (simple boids, 3 rules):
   - **Separation**: Wisps avoid getting too close to each other (min distance 100 units)
   - **Alignment**: Nearby wisps (within 400 units) gently align velocities
   - **Cohesion**: Wisps drift toward local center of mass
   - Combined with Lissajous base path: `finalVel = lissajousVel * 0.7 + flockingVel * 0.3`
   - Creates the appearance of wisps "dancing together" like fireflies

3. **Audio-Reactive Speed & Brightness**:
   - Treble energy modulates Lissajous time progression: `t += delta * (1.0 + trebleEnergy * 0.8)`
   - Beat detection: wisps briefly flash to maximum brightness (size doubles for 0.1s)
   - Mid energy: flocking cohesion strength increases — wisps cluster together during melodic passages, spread apart during quiet sections

4. **Trail Rendering**:
   - Each wisp stores previous 3-5 positions in velocity buffer
   - Trail particles rendered at decreasing size/opacity behind each wisp
   - Creates golden "light painting" streaks through space
   - Trail length increases with wisp speed (faster = longer trails)

---

## 3. TSL Node Materials (`chiral-gold-materials.js`)

All materials use `PointsNodeMaterial` with `AdditiveBlending`, `transparent: true`, `depthWrite: false`.

**MRT Bloom Weights**:
| System | Weight | Rationale |
|--------|--------|-----------|
| burstSpark | 0.9 | Brightest - event feedback |
| wisp | 0.6 | Accent glow |
| strand | 0.5 | Medium presence |
| goldDust | 0.4 | Ambient, not overpowering |
| lightBeam | 0.3 | Subtle volumetric |

**Materials to create**:
1. `createGoldDustNodeMaterial` - reads from DustCompute buffers, UV-based soft circles, twinkling alpha
2. `createBurstSparkNodeMaterial` - dual path (GPU compute / CPU fallback), hot core color fade
3. `createWispNodeMaterial` - larger soft circles, warmer temperature, trail-like alpha
4. `createStrandNodeMaterial` - particles arranged along computed helix paths (chiral DNA strands)
5. `createLightBeamNodeMaterial` - `MeshBasicNodeMaterial`, UV gradient, `DoubleSide`, gold tint

All materials MUST have `emissiveNode` set for MRT bloom compatibility.

---

## 4. Additional Visual Elements

### Chiral Strands — DNA-Like Golden Helices

2-6 strands (quality dependent) of golden double-helix formations weaving through space. These are the theme's signature visual element.

**Structure**:
- Each strand = 2000-5000 small particles arranged along a parametric double-helix curve
- Helix parameters: radius 80-200, pitch 300-600, total length 2000-4000 units
- Particles are NOT connected by geometry — they're individual points that FORM the helix visually
- Rendered via `PointsNodeMaterial` (same as other particle systems)

**Movement**:
- **Rotation**: Strands slowly rotate around their central axis (0.1-0.3 rad/s)
- **Drift**: Each strand drifts through the scene on a slow path (10-20 u/s), creating variety
- **Undulation**: The helix parameters oscillate over time — radius breathes, pitch varies sinusoidally
- **Mid-frequency reactive**: Audio mid energy modulates rotation speed and helix tightness (higher energy = faster spin, tighter helix)
- **Combo reactive**: On combos, strands temporarily "unwind" — radius expands, particles scatter slightly along the helix axis, then reconverge over 2-3s

**Implementation**:
- Compute shader positions particles along parametric helix: `x = R * cos(t), y = pitch * t, z = R * sin(t)` where R and pitch are uniform-driven
- `uStrandPhase` advances each frame for rotation
- `uStrandUnwind` (0-1) lerps between tight helix and scattered state

### Volumetric Light Beams — Sweeping Golden Searchlights

2-4 golden light cone meshes. Only on High+ quality.

**Structure**: Tall plane geometry (height 3000, width 200-400) with `MeshBasicNodeMaterial`, `AdditiveBlending`, `DoubleSide`

**Movement**:
- Slow rotation around Y axis at different speeds (0.02-0.06 rad/s each), offset phases
- Subtle wobble on X/Z tilt (±5°, period 8-15s)
- Bass-reactive opacity: `opacity = baseOpacity * (0.4 + bassEnergy * 0.6)` — beams pulse with the music
- On line clear events: beams flash to full intensity and sweep faster for 1-2s

---

## 5. Post-Processing Pipeline (`chiral-gold-post.js`)

WebGPU path (following cosmic-noir-post.js pattern):

1. **Scene Pass with MRT**: `scenePass.setMRT(mrt({ output, emissive }))` → separate emissive channel for bloom
2. **Bloom**: `bloom(emissiveSource, 0.55, 0.4, 0.0)` — gold-tinted by multiplying result with `vec3(1.0, 0.92, 0.7)`
3. **Chromatic Aberration**: Base 0.003, increases to 0.008 on events via `uChromaticStrength` uniform
4. **Vignette**: Darkness 0.9, offset 1.1 (darker/more cinematic than cosmic-noir)
5. **Film Grain**: TSL sine-hash noise overlay, strength 0.015 (subtle)
6. **Color Grading**: ACES tonemapping, saturation 0.85, contrast 1.1, black floor 0.08, warm gold tint `vec3(1.0, 0.95, 0.85)`
7. **Dithering**: 8-bit banding reduction

WebGL fallback: `EffectComposer` + `UnrealBloomPass` + `ShaderPass` (vignette, chromatic, film grain)

---

## 6. Game Event Integration

Event subscriptions (same pattern as cosmic-noir lines 3077-3102):
```
EVENTS.LINE_CLEAR → handleLineClear(data)
EVENTS.COMBO      → handleCombo(data)
EVENTS.PIECE_LOCK → handlePieceLock()
```

All gated by `window.settings?.backgroundComboEffects === true`.

### handlePieceLock() — Every Block Lock

Triggered every time a piece locks into the board. Should feel satisfying but not overwhelming since it fires frequently.

**Visual effects**:
- **Gold dust pulse**: All ambient dust particles briefly accelerate outward (breathing push), `dustPulseIntensity += 0.12` (capped at 0.45)
- **Dust brightness flash**: `dustEventBoost = 2.0` — momentary brightness spike on all gold dust, decays over ~0.3s
- **Micro-ripple**: A single small golden shockwave ring expanding from center (radius 30, tube 0.8, fades in 1.5s) — thinner/faster than combo waves
- **Wisp jolt**: All wisps get a brief velocity kick (+20% speed for 0.5s), making them momentarily dart
- **Camera micro-shake**: Tiny camera position jitter (±2 units, 0.15s duration) for tactile feedback
- **Reactive envelope push**: `{ pulse: 0.12, dust: 0.2, bloom: 0.05 }`

### handleCombo(data) — Combo Chain Building

Fired when combo counter increments. Uses `pendingComboCount` pattern from cosmic-noir (line 3118) to bridge combo→lineClear timing.

**Visual effects scaled by comboCount**:
- **Reactive envelope push** (same scaling as cosmic-noir lines 3119-3125):
  ```
  pulse:      min(0.05 + comboCount * 0.05, 0.5)
  bloom:      min(0.04 + comboCount * 0.05, 0.55)
  spark:      min(0.05 + comboCount * 0.06, 0.6)
  dust:       min(0.04 + comboCount * 0.05, 0.5)
  strand:     min(0.05 + comboCount * 0.04, 0.45)
  ```
- **Chiral strand intensification**: Strand opacity `+= 0.1 * comboCount`, strand rotation speed `+= 0.05 * comboCount` (capped)
- **Gold color temperature shift**: At combo >= 4, particles shift from warm gold toward hot white (color temperature increases with combo)
- **Light beam intensity**: Volumetric beams brighten by `0.08 * comboCount`

### handleLineClear(data) — The Main Visual Event

The primary gameplay visual trigger. Extracts both `lineCount` (1-4) and `comboCount` from event payload (same parsing as cosmic-noir lines 3130-3140).

**Combo multiplier**: `comboMultiplier = min(1 + comboCount * 0.25, 2.5)` — scales all effects below

**Burst Spark Explosions** (combo >= 2):
- Number of burst pulses: 1 (base), 2 (combo≥4), 3 (combo≥8), 4 (combo≥10)
- GPU path: `burstCompute.triggerBurst(time, burstIntensity)` for each pulse
  - burstIntensity: `min(1.0 + comboCount * 0.14 + burstIndex * 0.08, 2.25)`
  - Staggered: first immediate, subsequent at 150ms intervals
- Extra trailing bursts at combo >= 6: +2 bursts at 320ms + 460ms delays
- CPU fallback: Pool cycling through pre-allocated spark systems (same ring-buffer pattern as cosmic-noir lines 3212-3268)

**Golden Shockwave Rings**:
- Count: `min(lineCount + floor(comboCount / 2), 4)` expanding torus rings
- Staggered at 100ms intervals
- Gold color with slight size variation
- At combo >= 6: extra shockwaves (up to 3 more) with larger radii, faster expansion

**Chiral Strand Eruption** (combo >= 3):
- Existing strands expand outward rapidly then contract back
- New temporary strand segments spawn and dissolve (2-3s life)
- Higher combo = more strand segments

**Volumetric Beam Flash** (combo >= 4):
- All light beams flash to peak intensity
- Beam sweep speed increases briefly

**Screen-Level Effects** (combo >= 6):
- `comboFlashIntensity = min(1.0, existing + 0.45 + comboCount * 0.04)` — golden screen flash
- Chromatic aberration spike: `chromaticStrength += 0.004 * comboCount`
- Camera shake: amplitude `min(0.2 + comboCount * 0.08, 1.0)` mapped to position offset

**Reactive envelope push**:
```
pulse:      min(0.15 + lineCount * 0.1 + comboCount * 0.08, 1.0)
bloom:      min(0.05 + lineCount * 0.08 + comboCount * 0.06, 1.0)
spark:      min(0.14 + comboCount * 0.12, 1.0)
dust:       min(0.12 + comboCount * 0.1, 1.0)
strand:     min(0.08 + comboCount * 0.06, 1.0)
shake:      comboCount >= 6 ? min(0.2 + comboCount * 0.08, 1.0) : 0
```

### Reactive Envelope System

Tracks per-channel intensity values that decay each frame (same architecture as cosmic-noir):

**Channels**: `pulse`, `bloom`, `spark`, `dust`, `strand`, `shake`, `chroma`

**Decay rates** (per second):
```
pulse:   3.0   (fast recovery — snappy response)
bloom:   2.6   (medium — glow lingers slightly)
spark:   3.4   (fast — bursts are momentary)
dust:    2.8   (medium — ambient effect)
strand:  2.2   (slower — strands stay active longer)
shake:   5.0   (very fast — shake is brief)
chroma:  4.0   (fast — chromatic flash is brief)
```

**Usage**: Each channel's value (0-1) is used as a multiplier in the animate loop:
- `pulse` → dust orbit radius expansion, wisp speed
- `bloom` → post-processing bloom strength addition
- `spark` → burst particle intensity/count
- `dust` → dust brightness boost
- `strand` → strand opacity/rotation
- `shake` → camera position offset
- `chroma` → chromatic aberration strength

---

## 7. Quality Presets

| Setting | Extreme | Ultra | High | Medium | Low | Minimal |
|---------|---------|-------|------|--------|-----|---------|
| goldDustCount | 30000 | 20000 | 12000 | 7000 | 3000 | 1500 |
| burstSparkCount | 50000 | 36000 | 26000 | 16000 | 0* | 0* |
| wispCount | 1000 | 700 | 500 | 300 | 150 | 80 |
| strandCount | 6 | 4 | 3 | 2 | 0 | 0 |
| lightBeamCount | 4 | 3 | 2 | 0 | 0 | 0 |
| bloomStrength | 0.55 | 0.5 | 0.45 | 0.35 | 0.25 | 0.2 |
| enableCompute | yes | yes | yes | yes | no | no |
| enablePostProcessing | yes | yes | yes | yes | no | no |
| enableFilmGrain | yes | yes | yes | no | no | no |
| enableChromaticAberr | yes | yes | yes | no | no | no |
| enableVolumetricBeams | yes | yes | yes | no | no | no |

*Low/Minimal: burst sparks use CPU fallback pool (~2000 particles)

### Minimal Simplified Visual Language (explicit requirement)

For `Minimal`, use a deliberately simplified style instead of attempting full parity:
- Keep only ambient gold dust + occasional single ring pulse on line clear
- Disable wisps trails, chiral strands, volumetric beams, chromatic aberration, and film grain
- Use CPU motion with simple orbital drift + bass-only pulse (no curl-noise field simulation)
- Use narrower palette (`#B8860B`, `#FFD700`, `#FFF8DC`) with lower bloom to maintain readability
- Cap event layering: max 1 burst pulse and max 1 shockwave active at once

### Target Hardware & Performance Budget

Target platforms: desktop/laptop PCs with discrete or modern integrated GPUs.
- High preset target: stable 60 FPS at 1920x1080
- Medium preset target: stable 60 FPS at 1920x1080 on integrated GPUs
- Low/Minimal target: stable 60 FPS with simplified CPU path and no post-processing
- Hard guardrails: cap GPU particle count and avoid O(n^2) neighbor logic in runtime shaders

---

## 8. Theme Main Class Lifecycle

### start(webglRenderer, managers)
1. Cleanup any previous instance
2. Parse URL flags (`?forceWebGL`, `?noCompute`, `?noMRT`, `?noPost`)
3. Apply quality preset from settings
4. Init WebGPU renderer (fallback to WebGL)
5. Probe capabilities (maxColorAttachments, compute support)
6. Acquire audio analysis service from `SoundManager` (`getAudioAnalysis()` / `getAnalyzer()`)
7. Create scene elements: dust → strands → bursts → wisps → beams
8. Ensure MRT materials (patch `emissiveNode` on all materials)
9. Setup PostProcessing pipeline
10. Setup resize handler + event listeners
11. Precompile shaders (3s timeout)
12. Start animation loop

### animate() (per frame)
1. Delta time + time accumulator
2. **Poll SoundManager audio analysis snapshot** → smooth bass/mid/treble/beat/energy
3. Decay reactive envelope values
4. Update all material uniforms (time, pulse, audio energy)
5. Run GPU compute nodes (dust, burst, wisp)
6. Update camera orbit (cinematic slow sway)
7. Update volumetric beam rotation
8. Render via PostProcessing or EffectComposer

### dispose()
1. Dispose PostProcessing stack
2. Traverse scene and dispose all geometries/materials/textures
3. Dispose compute buffers
4. Release local analyzer references only (shared analyzer remains owned by `SoundManager`)
5. Dispose renderer + remove canvas
6. Nullify all references

---

## 9. Tetromino Customization (`chiral-gold-tetrominos.js`)

Gold palette with glow effects:
- I: `#FFD700` (bright gold), O: `#DAA520` (goldenrod), T: `#B8860B` (dark goldenrod)
- S: `#CD853F` (peru), Z: `#D4AF37` (metallic gold), J: `#8B6914` (dark gold), L: `#C5B358` (vegas gold)
- Render mode: `glow` with outline, pulse, shimmer, and trails enabled

---

## 10. Theme Registration

Add to `src/themes/theme-registry.js` in the `cosmic` group:
```javascript
{ id: 'chiral-gold', displayName: 'Chiral Gold', module: './chiral-gold/chiral-gold-theme.js', group: 'cosmic' }
```

---

## 11. Implementation Sequence

| Phase | Tasks | Dependencies |
|-------|-------|-------------|
| 1. Foundation | Create `audio-analyzer.js`, modify `sound-manager.js`, create `chiral-gold-tetrominos.js` | None |
| 2. Compute | Create `chiral-gold-compute.js` (DustCompute first, then Burst, then Wisp) | None |
| 3. Materials | Create `chiral-gold-materials.js` (dust material first) | Phase 2 |
| 4. Core Theme | Create `chiral-gold-theme.js` skeleton with dust-only rendering | Phase 2-3 |
| 5. Post-Processing | Create `chiral-gold-post.js`, wire into theme | Phase 4 |
| 6. Burst System | Add burst compute + material + event handlers | Phase 4-5 |
| 7. Wisps & Strands | Add wisp compute + material, strand meshes | Phase 4 |
| 8. Audio Reactivity | Wire AudioAnalyzer → compute uniforms, test with music | Phase 1, 4 |
| 9. Volumetric Beams | Add light beam meshes (quality-dependent) | Phase 4 |
| 10. WebGL Fallback | Create `chiral-gold-shaders.js`, add CPU fallback paths | Phase 4 |
| 11. Polish | Tune quality presets, register theme, create icon | Phase 1-10 |

---

## 12. Verification

1. **Load theme**: Navigate to Chiral Gold in theme selector → black void with gold particles floating
2. **WebGPU check**: Console log shows `backend: 'WebGPU'`; particles are GPU-computed
3. **WebGL fallback**: Add `?forceWebGL` → theme still renders with CPU particles
4. **Event response**: Play game → line clears trigger golden burst explosions, combos escalate intensity
5. **Audio reactivity**: Play music → particles breathe/pulse with bass, wisps accelerate with treble, beat detection causes micro-bursts
6. **Quality scaling**: Switch between Extreme/Low → particle counts change dramatically
7. **MRT bloom**: Gold particles bloom correctly with warm tint
8. **Performance**: 60fps at High quality on mid-range GPU
9. **Memory**: Switch away from theme → verify complete cleanup (no leaked buffers/textures)
10. **No audio fallback**: Mute music → theme still runs with gentle ambient pulsing

---

## 13. Runtime Safety & Failure Modes

1. `SoundManager` owns the analyzer lifecycle and media source graph. Themes must not create/dispose `MediaElementSourceNode` or `AudioAnalyzer`.
2. Theme runtime consumes one shared snapshot API: `getAudioAnalysis(deltaTime)`.
3. Normalize capability flags before scene creation: `usePost`, `useMRT`, `useCompute`.
4. Track all deferred stagger timers and clear them on stop/dispose/device-loss recovery.
5. Use compile prewarm with timeout and structured compile stats logging.
6. On WebGPU device-loss: dispose runtime resources, flip fallback flags, recreate on WebGL path.
7. Enforce deterministic dispose ordering: post stack → compute → scene resources → renderer → references.
8. Fallback query flags (`?forceWebGL`, `?noCompute`, `?noMRT`, `?noPost`) must always render a coherent scene.

## 14. Performance Instrumentation & Acceptance Gates

1. Log a startup capability report: backend, MRT support, compute support, post support, active flags.
2. Track frame-time percentiles (`p50/p95/p99`) and effect counts in debug sampling windows.
3. Sample metrics every ~5 seconds during active play for long-run quality checks.
4. Hard reject criteria:
   - sustained `p95 > 20ms` at `High`
   - memory growth across repeated theme switches
   - broken fallback visuals in any guarded mode
5. Minimal/Low prioritize smooth coherent visuals over feature parity.

## 15. Tetris-Effect Choreography Rules

1. Ambient movement is always active; gameplay events inject accents rather than replacing ambient flow.
2. Event hierarchy:
   - `PIECE_LOCK`: micro pulse / tactile accent
   - `COMBO`: escalating tension layer
   - `LINE_CLEAR`: main rhythmic release
3. Use quantized stagger delays (`100ms`, `150ms`, `320ms`, `460ms`) with per-quality caps.
4. Quality-aware escalation:
   - `High+`: full choreography including advanced formations
   - `Medium`: reduced transitions and burst counts
   - `Low/Minimal`: simplified dust-centric visual language
5. Legibility guardrails cap flash/chromatic/shake and enforce quick decay.

---

## Key Reference Files

- [cosmic-noir-theme.js](src/themes/cosmic-noir/cosmic-noir-theme.js) — Main architectural template
- [cosmic-noir-compute.js](src/themes/cosmic-noir/cosmic-noir-compute.js) — GPU compute pattern (buffers, TSL Fn, burst triggering)
- [cosmic-noir-materials.js](src/themes/cosmic-noir/cosmic-noir-materials.js) — TSL node materials (PointsNodeMaterial, MRT emissive, bloom weights)
- [cosmic-noir-post.js](src/themes/cosmic-noir/cosmic-noir-post.js) — WebGPU PostProcessing (MRT bloom, chromatic, vignette, ACES)
- [cosmic-noir-shaders.js](src/themes/cosmic-noir/cosmic-noir-shaders.js) — WebGL fallback GLSL shaders
- [sound-manager.js](src/audio/sound-manager.js) — Audio context + HTML5 Audio element (lines 22-62)
- [base-theme.js](src/themes/base-theme.js) — Base class lifecycle (start, stop, cleanup, resize)
- [event-bus.js](src/events/event-bus.js) — Event subscription pattern
- [theme-registry.js](src/themes/theme-registry.js) — Theme registration

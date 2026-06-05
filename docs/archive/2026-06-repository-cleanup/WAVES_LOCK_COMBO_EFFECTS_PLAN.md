# Waves Theme — Lock Piece & Combo Effects Upgrade Plan

## 1. Vision & Aesthetic Grounding

The Waves theme puts the player **inside a surf barrel**: a 360° cylinder of animated ocean water wraps the camera, and a bright cyan/white "exit glow" at the far end simulates sunlight at the mouth of the curl. The palette is deep teal → mint crest → foam-white, lit by underwater caustics, with drifting spray particles and ACES-filmic bloom.

**Design principle for this upgrade:** every gameplay effect must be something that would **physically happen inside a tube wave**. No abstract flashes, no moon-like pulses, no crimson sparks. Only things a surfer would see: droplet splashes, foam bursts, caustic flares, swell surges, breaking lips, god-rays through the barrel mouth, bioluminescent plankton streaks.

The current `onPieceLock` / `onLineClear` / `onCombo` handlers in [src/themes/waves/waves-theme.js:756-772](src/themes/waves/waves-theme.js#L756-L772) only nudge two scalar uniforms (`uWaveIntensity`, `uGlowIntensity`). There is no particle burst, no ripple on the barrel wall, no visible ejecta. By contrast, Blood Moon fires multiple systems per event: blood waves (expanding spheres), soul orbs (rising glows), blood sparks (pooled particle explosions), moon pulse, nebula pulse, star boost ([src/themes/blood-moon/blood-moon-theme.js:985-1061](src/themes/blood-moon/blood-moon-theme.js#L985-L1061)).

We will bring the same **layered, multi-system** approach to Waves, but re-skin every layer to fit the ocean aesthetic.

---

## 2. Blood-Moon → Waves Effect Mapping

| Blood Moon System              | Waves Equivalent                        | Why it fits                                                        |
| ------------------------------ | --------------------------------------- | ------------------------------------------------------------------ |
| Blood sparks (pooled bursts)   | **Foam/droplet bursts** (pooled)        | A locked piece = water slamming water → foam ejecta                |
| Blood waves (expanding rings)  | **Ripples on the barrel wall**          | Ring distortion travelling along the curved inner surface          |
| Soul orbs (rising glows)       | **Rising bubbles + bioluminescent motes** | Air trapped by a breaking wave rises as glowing spheres             |
| Moon pulse (`uPulseIntensity`) | **Caustic flash** (`uCausticsIntensity` surge) | The underwater light mesh brightens like sun catching a ripple     |
| Moon glow layer pulse          | **Exit-glow surge** (existing `exitGlow` plane) | The sun at the barrel mouth flares brighter                         |
| Nebula pulse                   | **Wave-amplitude surge travelling along Z** | A swell rolling through the tube                                   |
| Star event boost               | **Spray-field boost** (existing `SprayShader`) | All background mist gets pulled into motion                        |
| (new for combos)               | **God-ray shafts through exit**         | Volumetric sunlight breaking through the curl — signature combo moment |
| (new for big combos)           | **Breaking-lip foam curtain**           | The top of the barrel collapses into foam during a huge combo       |

Everything we add is either (a) a **new particle/mesh system** or (b) a **uniform already exposed by the existing shaders** that we start animating on game events.

---

## 3. Lock-Piece Effect — "Droplet Impact"

Fires on every `PIECE_LOCK`. Must be **subtle and cheap** — it runs hundreds of times per game — but instantly readable. The metaphor: a hand (or a board) smacks the inside wall of the barrel, water splashes, a ring expands, caustics flare.

### 3.1 Layers

1. **Wall-ripple ring** (new mesh)
   - A thin `RingGeometry` (or a shader-displaced `CircleGeometry`) laid **tangent to the barrel wall** at a random angular position around the camera and a random Z along the tube.
   - Grows from ~0.5u → ~4u over ~0.6s, alpha fades from 0.8 → 0.
   - Shader: concentric foam-noise rings travelling outward (same `snoise` family as `WaterBarrelShader`).
   - Colour: `uCrestColor` (0x44ddcc) fading to `uFoamColor` (0xddffff) at the crest of the ring.
   - Pool of 12 pre-allocated rings (same pattern as Blood Moon's blood-spark pool at [blood-moon-theme.js:587-664](src/themes/blood-moon/blood-moon-theme.js#L587-L664)); cycle through idle systems rather than allocating per event.

2. **Foam-droplet burst** (new GPU particle system)
   - 40–80 tiny white points launched **outward along the wall normal** from the ripple origin, with upward/tangential drift.
   - Ballistic motion: fast launch (~6u/s), gravity pulls them back along the wall's inward normal, life ≈ 0.8s.
   - Colour: white→cyan→transparent.
   - Same pooled pattern as the rings. Re-use the existing `SprayShader` or write a dedicated `DropletShader` that adds gravity + per-particle life.

3. **Caustic flash** (existing uniform)
   - `barrelMaterial.uniforms.uCausticsIntensity.value` surges from baseline (0.4) to ~0.9 and decays at `pow(0.94, frame)`.
   - Already wired in the fragment shader at [waves-theme.js:325-327](src/themes/waves/waves-theme.js#L325-L327); we just need an animated target.

4. **Micro bubble stream** (new GPU particle system, optional)
   - 6–12 tiny bubbles rise from the ripple origin for ~1.5s.
   - Only emitted for "satisfying" lock flavour; can be disabled on Low/Minimal.

### 3.2 Positioning logic

```
angle  = random uniform [0, 2π)
z      = camera.z + random(-10, +25)       // bias ahead of camera
radius = barrelRadius - 0.1                 // just inside the wall
origin = (cos(angle)*radius, sin(angle)*radius, z)
normal = -origin.xy normalized              // points inward (toward camera axis)
```

Randomising each lock so successive pieces feel varied (never the same two spots back-to-back — keep a 2-slot history).

### 3.3 Cost budget (per lock)

- 1 ring mesh awakened from pool (0 allocations)
- 1 droplet particle system awakened (0 allocations)
- 1 uniform assignment
- Particle counts listed above already fit in the Medium preset's `sprayCount` envelope.

---

## 4. Line-Clear Effect — "Splash Impact Scaled by Line Count"

Fires on `LINE_CLEAR`. Re-uses the lock droplet system but at **much higher intensity**, plus adds a wave surge.

### 4.1 Layers

1. **Multi-point droplet burst** — trigger `lineCount` lock-impacts simultaneously at evenly spaced angles around the camera, slightly staggered (0, 50, 100, 150 ms) like Blood Moon's `scheduleEffectTimeout` wave cascade at [blood-moon-theme.js:1049-1052](src/themes/blood-moon/blood-moon-theme.js#L1049-L1052).
2. **Swell surge along Z** (new uniform on `WaterBarrelShader`)
   - Add `uSurgeAmplitude` (float) and `uSurgeCenterZ` (float) uniforms.
   - In the vertex shader, add a gaussian bump to `totalDisplacement`:
     ```glsl
     float surgeDist = abs(worldPos.z - uSurgeCenterZ);
     float surge = exp(-surgeDist * surgeDist / 80.0) * uSurgeAmplitude;
     totalDisplacement += surge;
     ```
   - In JS, animate `uSurgeCenterZ` from camera.z → camera.z + 60 over ~1.2s; amplitude peaks at 0.8 × lineCount, decays to 0. Feels like a swell rolling past the player toward the exit.
3. **Spray-field boost** — increase `SprayShader` point sizes and speeds via a new `uEventBoost` uniform (mirrors the `uEventBoost` on Blood Moon's starfield at [blood-moon-shaders.js:437](src/themes/blood-moon/blood-moon-shaders.js#L437)). Decays at 0.96/frame.
4. **Foam crest along barrel top** — temporarily push the `foam` term in the fragment shader ([waves-theme.js:330-331](src/themes/waves/waves-theme.js#L330-L331)) higher via a new `uFoamBoost` uniform.

### 4.2 Scaling table

| Lines | Droplet bursts | Surge amplitude | Spray boost | Foam boost |
| ----- | -------------- | --------------- | ----------- | ---------- |
| 1     | 2              | 0.6             | 0.3         | 0.2        |
| 2     | 4              | 1.0             | 0.5         | 0.35       |
| 3     | 6              | 1.5             | 0.7         | 0.55       |
| 4 (tetris) | 8         | 2.2             | 1.0         | 0.8        |

---

## 5. Combo Effect — "Barrel Opens to the Sun"

Fires on `COMBO`. This is the **signature moment** — when the tube thins, the lip breaks, and sunlight floods in. Must feel dramatically different from lock/line-clear. Scales with `comboCount`.

### 5.1 Layers

1. **God-ray shafts through the exit** (new mesh)
   - 5–8 long, narrow `PlaneGeometry` quads anchored at the exit-glow position ([waves-theme.js:586](src/themes/waves/waves-theme.js#L586)), angled outward into the barrel.
   - Shader: animated volumetric-light stripes (`dot(rayDir, -viewDir)` with `smoothstep`); additive blend; fades with distance.
   - Intensity modulated by `uComboIntensity` uniform; lifetime ~1.5s with ease-in-ease-out.
   - Colour: warm white → cyan tip, matching `uInnerColor`/`uOuterColor` of the exit glow.

2. **Exit-glow surge** — existing `exitGlow` plane scales up (1.0 → 1.6) and its inner colour shifts toward pure white for 0.8s. Already has the shader at [waves-theme.js:560-583](src/themes/waves/waves-theme.js#L560-L583); just needs a material uniform + animated scale.

3. **Breaking-lip foam curtain** (new, only for combo ≥ 4)
   - A curved ribbon of foam particles emitted from the top arc of the barrel (angles roughly π/4 to 3π/4 around the camera), cascading downward under simulated gravity.
   - 200–400 particles per burst, ~2s life.
   - Shader: white/cyan additive points with size attenuation and downward velocity. Wind drift sideways via sine.

4. **Bioluminescent streaks** (new, combo ≥ 2)
   - 8–20 bright cyan "plankton trails" — elongated points drawn with point-sprite stretching along velocity — that streak **along** the inner barrel wall (tangent to cylinder), following the curl.
   - Life ~1.2s, easing out. Adds a magical, slightly surreal flourish at high combos without breaking realism (bioluminescent surf happens in the wild).
   - Per-particle random angular start; angular velocity ~3 rad/s; slight Z drift toward the exit.

5. **Caustic & glow surge**
   - `uCausticsIntensity` → 1.2, decays.
   - `uGlowIntensity` → 0.6 + comboCount × 0.15 (saturates at ~1.8). Already animated by existing code — we just make the target punchier.

6. **Bloom surge** (optional)
   - Temporarily raise `bloomPass.strength` by +0.15 × min(comboCount, 5), decay back to preset over ~1s. Makes the exit feel genuinely overexposed at big combos.

### 5.2 Tiering

| Combo | God-rays | Exit surge | Plankton streaks | Lip-break foam | Bloom surge |
| ----- | -------- | ---------- | ---------------- | -------------- | ----------- |
| 2     | ✗        | +0.2       | 8 streaks        | ✗              | ✗           |
| 3     | 4 shafts | +0.4       | 12 streaks       | ✗              | +0.1        |
| 4     | 6 shafts | +0.6       | 16 streaks       | ✓ 200 pts      | +0.15       |
| 5+    | 8 shafts | +0.8       | 20 streaks       | ✓ 400 pts      | +0.25       |

Stop scaling past combo 7 to avoid runaway brightness.

---

## 6. New / Modified Files

### New files
- `src/themes/waves/waves-shaders.js` — extract existing inline shaders + add new ones (droplet, ripple ring, god-ray, plankton-streak, foam-curtain). Mirrors the [blood-moon-shaders.js](src/themes/blood-moon/blood-moon-shaders.js) structure.
- `src/themes/waves/waves-effects.js` — effect-system classes: `DropletBurstPool`, `RipplePool`, `GodRayArray`, `PlanktonStreakPool`, `FoamCurtain`, `BubbleStream`. Each exposes `trigger(origin, intensity)` and `update(delta)` methods. Keeps the main theme file readable.

### Modified files
- `src/themes/waves/waves-theme.js`
  - Import new effect classes and shader module.
  - Add new uniforms to `WaterBarrelShader`: `uSurgeAmplitude`, `uSurgeCenterZ`, `uFoamBoost`.
  - Add `uEventBoost` uniform to `SprayShader`.
  - Replace minimal `onPieceLock` / `onLineClear` / `onCombo` bodies with calls into the effect pools.
  - Extend `QUALITY_PRESETS` with per-effect caps (`rippleCount`, `dropletCount`, `godRayCount`, `plankStreakCount`, `enableLipFoam`).
  - In the animation loop, call `update(delta)` on each pool and animate the new uniform targets with smoothing.
  - Extend `cleanup()` to dispose each pool.

No changes to [waves-tetrominos.js](src/themes/waves/waves-tetrominos.js) or theme registry.

---

## 7. Quality-Preset Additions

Everything must degrade gracefully. Rule of thumb: on Minimal/Low the player still gets a ripple + caustic flash on lock and a god-ray on combo, but particle-heavy systems turn off.

| Preset   | Ripple pool | Droplets/burst | God-rays | Plankton | Lip foam | Bloom surge |
| -------- | ----------- | -------------- | -------- | -------- | -------- | ----------- |
| Extreme  | 16          | 120            | 8        | 24       | 400 pts  | ✓           |
| Ultra    | 14          | 100            | 8        | 20       | 300 pts  | ✓           |
| High     | 12          | 80             | 6        | 16       | 250 pts  | ✓           |
| Medium   | 10          | 60             | 5        | 12       | 180 pts  | ✗           |
| Low      | 8           | 40             | 4        | 8        | ✗        | ✗           |
| Minimal  | 6           | 20             | 3        | ✗        | ✗        | ✗           |

Total particle-system count on Extreme stays under 32, well below the budget used by Blood Moon's 16-system blood-spark pool.

---

## 8. Implementation Phases

### Phase 1 — Plumbing & refactor (no visual change)
1. Extract inline shaders from [waves-theme.js](src/themes/waves/waves-theme.js) into `waves-shaders.js`; re-import them. Verify theme still renders identically.
2. Introduce empty `waves-effects.js` with `BaseEffectPool` class (pool, `awaken()`, `update()`, `dispose()`).
3. Gate all new effects behind `settings.backgroundComboEffects === true` — same pattern as existing handlers at [waves-theme.js:707-727](src/themes/waves/waves-theme.js#L707-L727).

### Phase 2 — Lock effect
1. Implement `RipplePool` + `DropletBurstPool`.
2. Wire into `onPieceLock()`; pick random angle/z per lock; animate `uCausticsIntensity` target.
3. Tune numbers until a locked piece feels "wet" but not noisy. **Explicit test: visually compare 30 consecutive piece-locks against a baseline recording — same scene before/after, no regression in frame time.**

### Phase 3 — Line-clear effect
1. Add `uSurgeAmplitude` / `uSurgeCenterZ` / `uFoamBoost` uniforms to barrel shader + animate them.
2. Add `uEventBoost` to spray shader.
3. Trigger N ripple+droplet bursts in `onLineClear` with stagger.

### Phase 4 — Combo effect
1. Implement `GodRayArray` (most visually important — build first).
2. Implement `PlanktonStreakPool`.
3. Implement `FoamCurtain` (combo ≥ 4 only).
4. Animate exit-glow scale + inner colour + bloom strength targets.

### Phase 5 — Tuning & QA
1. Run through the full quality-preset matrix: Extreme → Minimal. Verify no frame-time regression > 1ms at High vs baseline when idle; bursts stay under 4ms at Extreme.
2. Tetris (4-line) + 5-combo sequence should look unambiguously more impressive than a single-line clear with no combo. Record side-by-side captures.
3. Verify `cleanup()` disposes every pool (geometry + material) — use Three.js `renderer.info.memory` before/after a theme swap.
4. Check that disabling `window.settings.backgroundComboEffects` kills all new effects identically to the existing handlers.

---

## 9. Risks & Mitigations

| Risk                                                      | Mitigation                                                                                                 |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Over-bloom washes out the scene at high combos             | Clamp bloom strength surge to `preset.bloomStrength + 0.25`; decay to baseline in <1s.                      |
| God-rays look fake (harsh bands) on ultrawide              | Use noise-modulated intensity + softstep edges; reduce ray count rather than widening on ultrawide.         |
| Ripples on curved cylinder look detached from wall        | Orient each ripple mesh with a `lookAt` toward the barrel centre so its plane is tangent to the wall.       |
| Too many simultaneous pool allocations on a long combo    | All pools cycle idle-slot-first, matching Blood Moon's scan loop at [blood-moon-theme.js:1030-1045](src/themes/blood-moon/blood-moon-theme.js#L1030-L1045). |
| Minimal-preset players get no feedback                    | Ripple + caustic flash + exit-glow surge stay enabled at all presets; only particle-heavy systems drop out. |
| Bubble stream or foam curtain fights the bloom and clips  | Cap luminance in the fragment shader (`clamp(color, 0.0, 1.3)`) before returning.                          |

---

## 10. Success Criteria

- Locking a piece visibly **splashes** the barrel wall and flashes the caustics — the player can feel each placement.
- Clearing a line sends a swell rolling toward the exit, with spray and foam proportional to line count.
- A 3+ combo unmistakably "opens the barrel": god-rays break through, the exit glows hot-white, and plankton streaks chase along the wall.
- A tetris-with-big-combo is the most spectacular visual in the theme, bar none.
- Frame time on High preset stays within 1ms of current baseline when idle and under 4ms during peak bursts.
- No effect breaks the surf-tunnel metaphor. A surfer watching the screen should recognise every element.

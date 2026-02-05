# Neon District Theme - Performance Optimization Plan

> **Goal**: Improve FPS without changing the visual look or feel of the theme at the same quality level.
> **Date**: 2026-02-04
> **Status**: Planning

---

## Executive Summary

This plan targets meaningful FPS gains for the **Neon District** theme while preserving the exact visual output at a given quality setting. Optimizations prioritize shader complexity, animation loop cost, and post-processing scalability, with each change guarded by feature flags and verified against a repeatable baseline.

---

## Scope & Constraints

- **No visual regressions at the same quality level**. Any visual deltas must be explicitly approved and only allowed on lower quality tiers.
- **WebGPU and WebGL fallback must remain parity** in output and behavior.
- **No gameplay or timing changes**. Only rendering and animation performance optimizations.
- **All optimizations are feature-flagged** for easy rollback and A/B validation.

---

## Baseline & Targets

### Baseline Environment (to record)

- GPU model and driver version
- CPU model
- OS and browser version
- Resolution and devicePixelRatio
- WebGPU vs WebGL fallback mode

### Success Targets

- **+15% average FPS** on High quality in WebGPU mode.
- **No detectable visual differences** at the same quality level.
- **1% low FPS** not worse than baseline.
- **No regression** in WebGL fallback.

---

## Current Architecture Summary

| Component | Implementation | Location |
|-----------|---------------|----------|
| Renderer | WebGPU with WebGL2 fallback | `neon-district-theme.js` |
| Materials | TSL node materials | `neon-district-materials.js` |
| Post-processing | `NeonDistrictPost` (WebGPU) / `EffectComposer` (WebGL) | `neon-district-post.js` |
| Quality Presets | 6 levels (Minimal → Extreme) | `QUALITY_PRESETS` object |
| Animation Loop | ~200 lines with frame pacing | `startAnimation()` |

---

## Performance Profile Analysis

### Current Update Frequency (Per Frame)

| System | Update Rate | Notes |
|--------|-------------|-------|
| Camera Sway | Every frame | 3 sin calls |
| Starfield | Every frame | Rotation + uniforms |
| Rain | Every frame | TSL GPU-driven |
| Vehicles | 15-30fps (throttled) | Instance matrix updates |
| Neon Signs | Every 3-6 frames | Batch updates |
| VHS Billboards | 12-30fps (throttled) | Texture cycling |
| Searchlights | 20fps (throttled) | Rotation only |
| Bloom | Conditional | Only when boost > 0 |

### Identified Optimization Opportunities

#### High Impact

1. **Wet Ground Material Complexity** (`createWetGroundNodeMaterial`)
   - 4-octave FBM (`fbm4`) for puddle generation
   - `getRipples` function: 9-point grid search with derivatives
   - Multiple noise lookups per fragment
   - **Recommendation**: Distance-based LOD with branchless blending to avoid shader divergence

2. **Post-Processing Resolution**
   - Bloom currently runs at `bloomDownsample = 0.8`
   - **Recommendation**: Quality-adaptive bloom resolution for Medium/Low only, keep High+ identical

3. **Per-Frame Uniform Updates**
   - 15+ uniform updates per frame across shaders
   - **Recommendation**: Batch writes and skip updates when values unchanged or offscreen

#### Medium Impact

4. **Vehicle System (CPU Updates)**
   - Throttled but still CPU-bound per-instance matrix updates
   - **Recommendation**: Move all vehicle motion to GPU via TSL attributes

5. **Starfield Rotation**
   - Per-frame rotation applied even when minimal visual change
   - **Recommendation**: Update at 30fps with time accumulator

6. **Building Material Shader**
   - Multiple hash calls per fragment for window patterns
   - **Recommendation**: Bake window pattern to a small texture atlas for static buildings

#### Low Impact (Quick Wins)

7. **Dynamic Resolution Tuning**
   - Current: min 0.7, step 0.05, interval 1.5-6s
   - **Recommendation**: More aggressive scaling for low tiers only

8. **Shadow Corridor Calculations** (Wet Ground)
   - Multiple noise samples for procedural shadows
   - **Recommendation**: Disable for Medium/Low to save fragment cost

9. **Rain Particle Count**
   - Extreme: 6500, Ultra: 3500, High: 2600
   - **Recommendation**: Reduce by 20-30% for Medium/Low, leave High+ unchanged

---

## Proposed Optimizations

### Phase 0: Instrumentation & Cleanup (Zero-Risk)

**Purpose**: Establish reliable measurement and remove dead code without altering visuals.

#### 0.0 Add Performance Instrumentation

- Add per-system CPU timers in the animation loop
- Add GPU timing queries where supported
- Track uniform update counts per frame
- Add a debug overlay flag `?ndPerfHud=1`

#### 0.1 Dead Code Removal

| Location | Issue | Action |
|----------|-------|--------|
| `createAllBuildings()` (L745-752) | Deprecated, empty stub | **Remove** method |
| `createNeonSignsForBuildings()` (L980-987) | Disabled for performance, empty | **Remove** method |
| `createHolographicBillboards()` (L989-997) | Disabled for performance, empty | **Remove** method |
| `NEON_DISTRICT_STAR_VERTEX_SHADER` import | Only used in WebGL fallback | Keep for WebGL compat |

#### 0.2 Unused Imports

| Import | File | Status |
|--------|------|--------|
| `Reflector` from `three/addons/objects/Reflector.js` | neon-district-theme.js:23 | **Unused** - Remove |
| `createHologramNodeMaterial` | neon-district-theme.js:44 | Called but feature disabled |

#### 0.3 Console.log Cleanup

**Current Count**: 90+ statements across theme files

**Recommendation**: Replace with conditional logging:

```javascript
// Add once in constructor
this.debugEnabled = new URLSearchParams(window.location.search).has('ndDebug');

// Replace console.log with:
if (this.debugEnabled) console.log('[NeonDistrict] ...');
```

**Keep only**:
- Error logging (`console.error`)
- Warnings for critical states (`console.warn`)
- Performance profiler output (already conditional)

#### 0.4 Hot-Path Object Allocations

| Line | Code | Impact | Fix |
|------|------|--------|-----|
| L765 | `new THREE.Color().setHSL(...)` | Low (setup) | OK |
| L5773 | `new THREE.Vector3().addVectors(...)` | **HIGH** (per vehicle) | Cache in class |
| L6378 | `new THREE.Vector3()` | **HIGH** (per sign) | Cache in class |
| L7582 | `new THREE.Vector3()` | Medium (lazy init) | Already cached pattern |

**Pattern to use**:
```javascript
// Lazy-cached allocation
const worldPos = this._signWorldPos || (this._signWorldPos = new THREE.Vector3());
```

#### 0.5 Redundant Logic Detection

| Pattern | Location | Issue |
|---------|----------|-------|
| Duplicate uniform updates | Animation loop | `uTime` set multiple times for same shader |
| Pool re-generation guards | `generateBuildingPool` | Already has guard, correct |
| Feature flag checks | Multiple places | Consistent pattern |

#### 0.6 Best Practices Checklist

- [ ] No `new THREE.*` in loops
- [ ] Uniform updates batched
- [ ] Console.log guarded
- [ ] Dead code removed
- [ ] Imports pruned
- [ ] Pools disposed correctly

---

### Phase 1: Shader Complexity Reduction (Preserve Visuals)

#### 1.1 Wet Ground LOD System (Branchless)

```
DISTANCE → COMPLEXITY
< 200 units  → Full ripples + FBM puddles
200-500      → Simplified ripples (3-point instead of 9-point)
> 500        → Static wet look only
```

**Implementation Notes**:
- Use `smoothstep` and `mix` to avoid shader branching
- Prefer computing LOD factor once and reusing across ripples and FBM

#### 1.2 Bloom Resolution Control

| Quality | Current Downsample | Proposed |
|---------|-------------------|----------|
| Extreme | 0.8 | 0.8 |
| Ultra | 0.8 | 0.8 |
| High | 0.8 | 0.8 |
| Medium | 0.8 | 0.6 |
| Low | N/A | N/A |

**Visual Impact**: None at High+; Medium only with explicit approval.

#### 1.3 Quality-Gated Shadow Calculations

- Disable procedural shadow corridors for Medium and below
- Results in ~6 fewer noise samples per fragment on wet ground

---

### Phase 2: Animation Loop Optimization

#### 2.1 Conditional Uniform Updates

```javascript
// Current: Always updates
if (this.starUniforms?.uTime) {
    this.starUniforms.uTime.value = this.time;
}

// Proposed: Skip if not visible or mostly static
if (this.starUniforms?.uTime && !skipHeavy) {
    this.starfieldTimeAccumulator += delta;
    if (this.starfieldTimeAccumulator > 0.033) { // 30fps
        this.starUniforms.uTime.value = this.time;
        this.starfieldTimeAccumulator = 0;
    }
}
```

#### 2.2 Starfield Update Throttling

- Current: Every frame rotation
- Proposed: Every 2nd frame rotation (visual difference imperceptible)

#### 2.3 Ground Uniform Batching

- Combine `uTime`, `uRainIntensity`, `uCameraPos` updates into single conditional block
- Skip update if delta < 0.016 (60fps floor)

#### 2.4 Static Object Freezing

- For static meshes, set `matrixAutoUpdate = false`
- Call `updateMatrix()` once after creation

---

### Phase 3: GPU Optimization

#### 3.1 Vehicle GPU Animation

- `vehicleGPUDriven` flag exists but not fully utilized
- Move all vehicle position/rotation to TSL vertex shader
- Eliminate per-frame matrix uploads for 20-70 vehicles

#### 3.2 Rain System Optimization

- Confirm no CPU fallback path is active
- Consider reducing rain lifetime for faster culling on low tiers

#### 3.3 Window Pattern Baking

- Replace per-fragment hash patterns with a small precomputed texture atlas
- Maintain same pattern frequency and color values

---

### Phase 4: Quality Preset Tuning (Last Step)

| Parameter | Current (High) | Optimized (High) | Notes |
|-----------|---------------|------------------|-------|
| rainParticles | 2600 | 2600 | Keep High identical |
| starCount | 9000 | 9000 | Keep High identical |
| flyingVehicles | 35 | 35 | Keep High identical |
| vehicleUpdateInterval | 1/24 | 1/24 | Keep High identical |
| bloomDownsample | 0.8 | 0.8 | Keep High identical |

**Changes only apply to Medium/Low tiers**, after visual approval.

---

## Verification Plan

### Automated Testing

- Add a lightweight perf harness that runs a fixed camera path
- Record FPS, frame time percentiles, and GPU timing where supported
- Store baseline CSV in `optimization-reports/`

### Manual Verification Steps

1. FPS Baseline Capture
2. Visual Comparison (before/after) at each quality level
3. WebGL fallback verification
4. GPU timing validation in DevTools

### Success Criteria

- [ ] +15% average FPS on High quality
- [ ] Visual parity at same quality level
- [ ] 1% low FPS no worse than baseline
- [ ] WebGL fallback unaffected

---

## Risk Management & Rollback

- All changes behind flags (e.g. `?ndOptWetGround=1`)
- Maintain A/B comparison toggles per phase
- Roll back immediately if High quality visuals change

---

## Implementation Priority

| Phase | Priority | Estimated Impact | Risk |
|-------|----------|------------------|------|
| Phase 0 (Instrumentation + Audit) | **CRITICAL** | +2-5% FPS | None |
| Phase 1 (Shaders) | HIGH | +10-15% FPS | Low |
| Phase 2 (Loop) | MEDIUM | +5-8% FPS | Low |
| Phase 3 (GPU) | MEDIUM | +5-10% FPS | Medium |
| Phase 4 (Presets) | HIGH | +8-12% FPS (Medium/Low only) | Low |

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/themes/neon-district/neon-district-materials.js` | Wet ground LOD, shadow gating, window atlas |
| `src/themes/neon-district/neon-district-theme.js` | Animation loop throttling, preset tuning, instrumentation |
| `src/themes/neon-district/neon-district-post.js` | Quality-adaptive bloom resolution |

---

## References

- [NEON_DISTRICT_WEBGPU_UPGRADE_PLAN.md](./NEON_DISTRICT_WEBGPU_UPGRADE_PLAN.md) - WebGPU migration history
- [PERFORMANCE_OPTIMIZATION_PLAN.md](./PERFORMANCE_OPTIMIZATION_PLAN.md) - Multiplayer optimization patterns
- Three.js WebGPU Performance Guide
- TSL Shading Language Best Practices

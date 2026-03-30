# Nimbus Veil Cloud Refinement Plan (Post-Regression Recovery)

## Executive Summary

Current Nimbus Veil cloud output is visually regressed: clouds read as faceted slabs, overfill the frame, and lose the soft cotton-like volumetric character.

This plan restores art direction quality with a WebGPU-first implementation path and a safe WebGL fallback path. It is focused, testable, and designed to recover visual quality without breaking readability or runtime stability.

Scope:
- `src/themes/nimbus-veil/nimbus-veil-theme.js`
- `src/themes/nimbus-veil/nimbus-veil-materials.js`
- `src/themes/nimbus-veil/nimbus-veil-shaders.js`
- `src/themes/nimbus-veil/nimbus-veil-clouds.js`
- `tests/unit/test-nimbus-veil-phase4.js`
- optional: new benchmark harness sections in `tests/performance/benchmark-nimbus-veil-phase4.html`

---

## 1) Current Visual Problems (From Latest Screens)

1. Clouds appear as large polygonal sheets instead of soft volumetric masses.
2. Scene composition is over-occluded; clouds dominate the camera and erase negative space.
3. Silhouette reads as card boundaries and triangle edges, not rounded cotton billows.
4. Depth layering is unstable: near shells clip heavily and flatten perceived volume.
5. Board-safe composition window is frequently violated by giant foreground masses.

---

## 2) Recovery Goals

1. Restore cotton-like 3D cloud read at idle and during gameplay events.
2. Keep three depth bands readable (near/mid/far) with controlled occupancy.
3. Maintain moon-guided lighting and calm atmospheric motion.
4. Preserve or improve board readability under stress events.
5. Keep feature-gated WebGPU-first path with deterministic fallback behavior.

---

## 3) Root-Cause Hypotheses

1. Excessive shell tilt/parallax exposes quad corners and triangulation.
2. Spawn envelopes place oversized clusters too close to camera.
3. Opacity + depth write + shell overlap creates slab-like stacking.
4. Insufficient erosion masking at quad edges reveals card geometry.
5. Layer weighting and transmittance are not enforcing rounded core/soft rim behavior.

---

## 4) Non-Negotiable Acceptance Gates

1. No obvious card corners in hero frames (`idle-serenity`, `line-clear-4`, `combo-10-chain`).
2. Cloud occupancy caps:
- near: 20-35%
- mid: 35-55%
- far: 20-35%
3. Board ROI contrast under stress remains `>= 4.5:1`.
4. No full-screen cloud takeover for more than `0.5s` during normal motion.
5. WebGL fallback remains visually coherent and does not collapse into faceted slabs.

---

## 5) Phase Plan

## Phase A: Immediate Regression Containment (Critical)

### A.1 Camera-Safe Spawn Envelope
- Clamp near-cloud shell size and depth spread.
- Push oversized clusters out of foreground camera collision zone.
- Add per-band hard bounds for `x/y/z` and shell count.

### A.2 Facet Exposure Reduction
- Reduce or disable aggressive per-shell `rotation.x/y` tilt.
- Keep camera-facing billboards with only subtle roll and micro-tilt.
- Add adaptive tilt clamp based on shell depth and camera distance.

### A.3 Edge Erosion Safety
- Strengthen alpha erosion near quad perimeter.
- Increase cotton mask edge softness where corner exposure risk is high.
- Add debug metric: corner-alpha ratio threshold.

Exit Criteria:
- No prominent polygon edges in static screenshots.
- No single cloud cluster occupies >45% of frame in idle shot.

---

## Phase B: Shape Language Recovery (High)

### B.1 Cotton Lobes Rebalance
- Re-tune lobe radii and offsets to restore rounded, stacked cloud puffs.
- Bias density toward central lobe mass, reduce edge-heavy density.

### B.2 Shell Weighting and Thickness Model
- Rebalance front/back shell weighting to avoid uniform slab opacity.
- Use shell-thickness modulation to preserve core depth but soften silhouette.

### B.3 Lighting Readability
- Keep directional moonlight response but lower hard rim dominance.
- Improve shadow-to-lit transition using smooth powder term caps.

Exit Criteria:
- Clouds read as rounded cotton volumes at 3 distances.
- Rim and body shading stay calm with no hard contour banding.

---

## Phase C: True Volumetric Upgrade Path (WebGPU)

### C.1 3D Density Field (Feature Flag)
- Add optional 3D density volume path (`nimbusCloudVolume=1`).
- Build density from low-frequency shape + high-frequency erosion noise.

### C.2 Volumetric Integration Pass
- Raymarch with conservative step count by tier.
- Use Beer extinction + powder approximation + anisotropic phase shaping.

### C.3 Performance Controls
- Half-resolution cloud pass at High+ tiers.
- Temporal reprojection + jitter with ghosting guards.
- Dynamic quality fallback ladder:
  - reduce steps
  - reduce volume resolution
  - fallback to improved sliced mode

Exit Criteria:
- WebGPU volume path visibly better than card path in A/B captures.
- Performance budget within tier targets.

---

## Phase D: Art Direction Lock and QA Signoff

### D.1 Deterministic Capture Pack
- Capture baseline with:
  - `nimbusBaseline=1`
  - `nimbusSeed=1234`
  - `nimbusFixedDt=16.666`
- Produce hero frame pack for High, Ultra, and forced WebGL.

### D.2 Rubric Scoring
- Score:
  - Cloud Presence
  - Motion Grace
  - Readability Safety
  - Atmosphere Fidelity
- Signoff gate:
  - minimum category `>= 4`
  - average `>= 4.4`

### D.3 Regression Guards
- Extend tests for cloud shell orientation/size constraints.
- Add benchmark assertions for occupancy and board-safe clamps.

Exit Criteria:
- Signoff rubric passed for both WebGPU and fallback path.

---

## 6) Technical Work Items

## `src/themes/nimbus-veil/nimbus-veil-theme.js`
1. Enforce camera-safe spawn ranges and shell count caps by depth band.
2. Replace aggressive shell tilt with constrained roll-based billboarding.
3. Add cloud occupancy diagnostics and frame-safe clamp logic.

## `src/themes/nimbus-veil/nimbus-veil-materials.js`
1. Rework cotton mask edge erosion and lobe blending.
2. Rebalance shell density/transmittance weighting.
3. Add optional volume-path material factory (feature flag).

## `src/themes/nimbus-veil/nimbus-veil-shaders.js`
1. Tune fallback GLSL for softer body gradients and less faceting exposure.
2. Add perimeter fade and corner suppression logic.
3. Keep parity with WebGPU shading intent.

## `src/themes/nimbus-veil/nimbus-veil-clouds.js`
1. Add profile knobs for spawn bounds, tilt clamp, and shell corner suppression.
2. Add per-quality defaults for volume-path budget.

---

## 7) Validation Matrix

1. Unit checks:
- `node tests/unit/test-nimbus-veil-phase4.js`
- `node tests/unit/test-nimbus-veil-phase7.js`

2. Syntax checks:
- `node --check src/themes/nimbus-veil/nimbus-veil-theme.js`
- `node --check src/themes/nimbus-veil/nimbus-veil-materials.js`
- `node --check src/themes/nimbus-veil/nimbus-veil-shaders.js`

3. Visual harness:
- `tests/performance/benchmark-nimbus-veil-phase4.html`

4. Required scenarios:
- idle serenity (no events)
- sustained combo (10+)
- forced WebGL parity (`forceWebGL=1`)

5. Pass/fail conditions:
- no visible faceted slab artifacts in hero frames
- no board readability regressions
- no repeated runtime fallback churn

---

## 8) Rollback and Safety

If refinement causes instability or quality collapse:
1. Disable volume path feature flag.
2. Revert to improved sliced mode profile.
3. Reduce shell tilt and depth spread to safe defaults.
4. Keep board-safe opacity clamps enabled at all times.

---

## 9) Estimate

1. Phase A: 1-2 days
2. Phase B: 2-3 days
3. Phase C: 3-5 days
4. Phase D: 1-2 days

Total: 7-12 engineering days.

---

## 10) Definition of Done

1. Clouds read as soft cotton-like 3D forms, not cards/slabs.
2. Composition returns to balanced depth bands with protected negative space.
3. High/Ultra WebGPU path shows clear visual uplift over fallback.
4. WebGL fallback remains serene and readable.
5. Deterministic captures and rubric signoff are complete.

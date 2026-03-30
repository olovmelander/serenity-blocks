# Moonlit Forest Baseline Capture Protocol

## Purpose

Produce a reproducible Moonlit Forest baseline pack for both backends and all quality presets, aligned with Phase 0 and Phase 8 gates.

Outputs per run:
- Preset sweep JSON (`Minimal -> Extreme`) with metrics and hero-frame checklist results
- Event anchor JSON (`LINE_CLEAR`, `COMBO`, `PIECE_LOCK`) with capture metadata
- Evidence bundle JSON (metrics + event validation + tetromino validation + hero-frame validation)

---

## Prerequisites

1. Start runtime:
```bash
npm run dev
```
2. Open:
`tests/performance/benchmark-moonlit-phase8.html`
3. In the embedded runtime, activate `moonlit-forest` (use harness button).

---

## Deterministic Flags

Harness default query:
- `moonlitBaseline=1`
- `moonlitSeed=1234`
- `moonlitFixedDt=16.666`
- `moonlitPlayback=default`
- `moonlitPlaybackLoops=1`

Fallback run adds:
- `forceWebGL=1`

---

## Phase 0 Capture Procedure (Per Backend)

1. Load backend:
- `Load WebGPU Baseline`, then run all captures.
- `Load Force WebGL Baseline`, then run all captures again.

2. Validate hero framing:
- Click `Validate Hero Frame Checklist`.
- Save result from log if needed.

3. Capture event anchors:
- Click `Capture Event Anchors`.
- Click `Download Anchor Pack`.

4. Run preset matrix:
- Click `Run Preset Sweep (Minimal..Extreme)`.
- Click `Download Preset Sweep`.

---

## Phase 8 Validation Procedure

Minimum:
1. `Validate LINE_CLEAR/COMBO/PIECE_LOCK`
2. `Validate Tetromino Styling`
3. `Run Resize Stress`
4. `Run Theme Switch Stress`
5. `Run M/H/U Campaign` (30 minutes per preset for release evidence)
6. `Run Evidence Bundle`

Cross-backend comparison:
1. Click `Run WebGPU + WebGL Campaign`
2. Click `Download Dual Campaign`

---

## Suggested Output Structure

```text
baseline/moonlit-forest/
  webgpu/
    phase0/
      moonlit-phase0-preset-sweep-<timestamp>.json
      moonlit-phase0-anchors-<timestamp>.json
    phase8/
      moonlit-phase8-evidence-<timestamp>.json
      moonlit-phase8-campaign-<timestamp>.json
  webgl/
    phase0/
      moonlit-phase0-preset-sweep-<timestamp>.json
      moonlit-phase0-anchors-<timestamp>.json
    phase8/
      moonlit-phase8-evidence-<timestamp>.json
      moonlit-phase8-campaign-<timestamp>.json
  comparison/
    moonlit-phase8-dual-campaign-<timestamp>.json
```

---

## Run Matrix Checklist

| Backend | Hero Checklist | Event Anchors | Preset Sweep | Evidence Bundle | M/H/U Campaign | Status |
|---|---|---|---|---|---|---|
| WebGPU | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| WebGL | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |

---

## Manual Acceptance Prompts

- Moon corridor remains clearly framed and visible.
- Mid-ground fog basin remains the focal pocket.
- Silhouette layering reads as foreground/mid/background depth.
- Bioluminescent accents stay event-driven (not constant neon wash).
- Fallback backend keeps coherent mood and gameplay readability.

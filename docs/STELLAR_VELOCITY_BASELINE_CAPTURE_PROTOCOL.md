# Stellar Velocity Baseline Capture Protocol

## Purpose

Generate a reproducible Phase 0 baseline pack for Stellar Velocity with deterministic playback and fixed timestep controls.

Outputs per run:
- 5 PNG captures (`idle`, `default`, `stress`, `warp-spool`, `warp-transit`)
- 1 JSON metrics report (`avgFps`, `1% low`, frame-time variance/stddev, draw calls, GPU memory estimate, geometry/texture counts, flags)

---

## Prerequisites

1. Start runtime:
```bash
npm run dev
```
2. Open:
`tests/performance/benchmark-stellar-velocity-baseline.html`
3. In the embedded app, switch to the `stellar-velocity` theme.

---

## Deterministic Flags

Baseline harness loads with:
- `stellarVelBaseline=1`
- `stellarVelSeed=1234`
- `stellarVelFixedDt=16.666`

Optional fallback run adds:
- `forceWebGL=1`

---

## Capture Procedure (Per Preset)

1. Load backend runtime:
- `Load Baseline Runtime` or
- `Load Force WebGL Runtime`

2. In app settings, choose quality preset (`Minimal`, `Low`, `Medium`, `High`, `Ultra`, `Extreme`).

3. Click `Reset Metrics`.

4. Click `Capture Full Pack`.
- This runs deterministic playback and downloads:
  - `stellar-velocity-pack-idle-...png`
  - `stellar-velocity-pack-default-...png`
  - `stellar-velocity-pack-stress-...png`
  - `stellar-velocity-pack-warp-spool-...png`
  - `stellar-velocity-pack-warp-transit-...png`
  - `stellar-velocity-pack-...json`

5. Optional manual checks:
- `Play Default Sequence`
- `Play Stress Sequence`
- `Capture Readability Anchors`
- `Report Metrics`
- `Download Report JSON`

---

## Phase 8 Validation Procedure

Use harness controls after baseline capture:
- `Run Validation Matrix`
- `Run Soak Validation`

Console equivalents:
```js
window.stellarVelocityBaseline.validationRows();
window.stellarVelocityBaseline.validationMatrix({ settleMs: 480, emitEvents: true });
window.stellarVelocityBaseline.validationSnapshot('after-matrix');
window.stellarVelocityBaseline.soakValidation({
  cycles: 180,
  stepMs: 220,
  snapshotEvery: 24,
  fullRebuild: false,
});
```

Expected outputs:
- Matrix summary with per-row backend/render-path/capability state.
- Soak summary with `textureDelta`, `geometryDelta`, and `timerDelta`.
- Reload-required row list for force-WebGL scenarios.

---

## Output Organization

Recommended structure:
```text
baseline/stellar-velocity/
  runtime-default/
    minimal/
    low/
    medium/
    high/
    ultra/
    extreme/
  runtime-force-webgl/
    minimal/
    low/
    medium/
    high/
    ultra/
    extreme/
```

Store:
- 5 screenshots + 1 JSON per preset/runtime row.

---

## Run Matrix Checklist

| Runtime | Preset | Idle PNG | Default PNG | Stress PNG | JSON | Status |
|---|---|---|---|---|---|---|
| Default | Minimal | ☐ | ☐ | ☐ | ☐ | ☐ |
| Default | Low | ☐ | ☐ | ☐ | ☐ | ☐ |
| Default | Medium | ☐ | ☐ | ☐ | ☐ | ☐ |
| Default | High | ☐ | ☐ | ☐ | ☐ | ☐ |
| Default | Ultra | ☐ | ☐ | ☐ | ☐ | ☐ |
| Default | Extreme | ☐ | ☐ | ☐ | ☐ | ☐ |
| Force WebGL | Minimal | ☐ | ☐ | ☐ | ☐ | ☐ |
| Force WebGL | Low | ☐ | ☐ | ☐ | ☐ | ☐ |
| Force WebGL | Medium | ☐ | ☐ | ☐ | ☐ | ☐ |
| Force WebGL | High | ☐ | ☐ | ☐ | ☐ | ☐ |
| Force WebGL | Ultra | ☐ | ☐ | ☐ | ☐ | ☐ |
| Force WebGL | Extreme | ☐ | ☐ | ☐ | ☐ | ☐ |

---

## Metadata to Record

Capture metadata alongside each pack:
- Date/time
- OS + GPU + driver
- Browser/version (or Electron runtime build)
- Runtime path (default or forced WebGL)
- Quality preset
- Active flags/query params

---

## Acceptance Notes

Phase 0 baseline capture is complete when:
- Full matrix above is populated.
- JSON reports exist for every row.
- Hero-frame screenshots exist for every row.
- Readability anchor captures are collected for `piece-lock`, `combo-3`, `combo-6`, `combo-8`, and `combo-10` on target presets.

Art-direction checklist reference:
- `docs/STELLAR_VELOCITY_ART_DIRECTION.md`

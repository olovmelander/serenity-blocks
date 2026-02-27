# Nimbus Veil Baseline Capture Protocol

## Purpose

Produce a reproducible Phase 0 baseline pack for Nimbus Veil with deterministic playback and fixed timestep controls.

Required outputs per preset/runtime:
- PNG captures for hero shots (`idle`, `line-clear-4`, `combo-10`, readability anchors)
- JSON metrics report (`avgFps`, `1% low`, p50/p95/p99 frame time, draw calls, memory proxies, flags)
- rubric scoring sheet entry

## Prerequisites

1. Start app runtime:
```bash
npm run dev
```
2. Open baseline harness:
`tests/performance/benchmark-nimbus-veil-phase0.html`
3. In embedded app, switch theme to `nimbus-veil`.

## Deterministic Flags

Baseline harness loads with:
- `nimbusBaseline=1`
- `nimbusSeed=1234`
- `nimbusFixedDt=16.666`
- `nimbusPlayback=default`
- `nimbusPlaybackLoops=1`

Optional fallback parity run adds:
- `forceWebGL=1`

Current Phase 0 runtime note:
- Nimbus is still WebGL-only at this stage.
- `forceWebGL=1` is still captured as a separate matrix mode so fallback-tagged evidence exists before WebGPU rollout.

## Capture Procedure (Per Preset)

1. Load runtime:
- `Load Baseline Runtime`
- `Load Force WebGL Runtime`

2. In app settings, select target preset:
- `Minimal`, `Low`, `Medium`, `High`, `Ultra`, `Extreme`

3. Click `Reset Metrics`.

4. Click `Capture Full Pack`.
- Downloads deterministic hero captures and `*-metrics.json`.

5. Click `Capture Readability Anchors`.
- Captures:
  - `piece-lock`
  - `line-clear-4`
  - `combo-3`
  - `combo-6`
  - `combo-8`
  - `combo-10`

6. Optional manual controls:
- `Play Default Sequence`
- `Play Stress Sequence`
- `Report Metrics`
- `Download Report JSON`

## Hero Shot Checklist

| Shot | Runtime | Preset | Captured | Notes |
|---|---|---|---|---|
| idle-serenity | Default |  | ☐ |  |
| line-clear-4 | Default |  | ☐ |  |
| combo-10-chain | Default |  | ☐ |  |
| low-tier-parity | Default | Low | ☐ |  |
| force-webgl-parity | Force WebGL |  | ☐ |  |

## Matrix Checklist

| Runtime | Minimal | Low | Medium | High | Ultra | Extreme |
|---|---|---|---|---|---|---|
| Default | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Force WebGL | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |

## Metadata to Record

- capture date/time
- OS and GPU
- browser/electron build
- runtime path (default or force WebGL)
- selected preset
- active query flags

## Signoff Gates

- fallback visual parity diff outside approved glow ROI: `<= 3.0%`
- board ROI contrast under combo stress: `>= 4.5:1`
- continuous clipping duration: `<= 0.5s`
- Sky Fidelity Rubric: no category `< 4`, average `>= 4.4`

## Console Helper Commands

```js
window.nimbusBaseline.play('default', { loops: 2, stepMs: 300 });
window.nimbusBaseline.capture('nimbus-hero-frame');
window.nimbusBaseline.capturePack({ label: 'nimbus-phase0-pack', defaultLoops: 2, stressLoops: 2 });
window.nimbusBaseline.captureReadability({ label: 'nimbus-phase0-readability', settleMs: 280 });
window.nimbusBaseline.report();
window.nimbusBaseline.downloadReport('nimbus-phase0-baseline');
window.nimbusBaseline.stop();
```

## References

- Art packet: `docs/NIMBUS_VEIL_ART_DIRECTION.md`
- Plan: `docs/NIMBUS_VEIL_WEBGPU_UPGRADE_PLAN.md`

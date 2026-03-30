# Chromadelic Highway Baseline Capture Protocol

## Purpose

Generate a reproducible Phase 0 baseline pack for Chromadelic Highway on both WebGPU and WebGL fallback paths.

Outputs per run:
- 3 PNG captures (`idle`, `default`, `stress`)
- 1 JSON metrics report (`avgFps`, `1% low`, frame-time variance/stddev, draw calls, GPU memory estimate, geometry/texture counts, flags)
- Optional Phase 6 soak JSON (`memory/thermal trend`, sampled metrics, pass/fail gates)

---

## Prerequisites

1. Start app runtime:
```bash
npm run dev
```
2. Open:
`tests/performance/benchmark-chromadelic-baseline.html`
3. In the embedded app, switch to the `chromadelic-highway` theme.

---

## Deterministic Flags

Baseline harness loads with:
- `chromadelicBaseline=1`
- `chromadelicSeed=1234`
- `chromadelicFixedDt=16.666`

WebGL fallback run adds:
- `forceWebGL=1`

---

## Capture Procedure (Per Backend + Preset)

1. Load backend:
- `Load WebGPU Baseline` or
- `Load WebGL Baseline`

2. In app settings, set target quality preset (`Minimal`, `Low`, `Medium`, `High`, `Ultra`, `Extreme`).

3. Click `Reset Metrics`.

4. Click `Capture Full Pack`.
- This runs deterministic playback and downloads:
  - `chromadelic-pack-idle-...png`
  - `chromadelic-pack-default-...png`
  - `chromadelic-pack-stress-...png`
  - `chromadelic-pack-...json`

5. Optional manual checks:
- `Play Default Sequence`
- `Play Stress Sequence`
- `Report Metrics`
- `Download Report JSON`

---

## Phase 6 Soak Procedure (Thermal + Memory)

Goal:
- Validate no sustained memory growth and no major thermal drift over long sessions.

Recommended run:
1. Use the same baseline harness page:
   - `tests/performance/benchmark-chromadelic-baseline.html`
2. Select backend (`WebGPU` and then `WebGL` in separate runs).
3. Set quality preset (at minimum test `High`; optionally sweep all presets).
4. In **Phase 6 Soak Controls**:
   - `Duration (minutes)`: `30`
   - `Sample every (seconds)`: `30`
   - `Stress step ms`: `220`
5. Click `Start Soak`.
6. After completion, click `Download Soak Report`.

CLI-equivalent helper calls:
```js
window.chromadelicBaseline.runSoak({ durationMinutes: 30, sampleSeconds: 30, stepMs: 220 });
window.chromadelicBaseline.getSoakReport();
window.chromadelicBaseline.downloadSoakReport('chromadelic-soak');
```

Pass guidance:
- `completed: true`
- `memoryTrendStable: true`
- `thermalTrendStable: true`
- `pass: true`

If failed:
- Record backend/preset/hardware details.
- Re-run once to confirm reproducibility.
- Save both failing and follow-up soak reports with screenshots.

---

## Phase 7 Signoff Capture Pack

Goal:
- Produce a compact release signoff artifact bundling hero captures, readability anchors, baseline metrics, and optional soak summary.

Run from:
- `tests/performance/benchmark-chromadelic-baseline.html`
- Section: **Phase 7 Signoff Pack**

Default capture set:
- `hero-idle`
- `hero-default`
- `hero-stress`
- `hero-readability-line-clear-4`
- `hero-readability-combo-8`

Helper commands:
```js
window.chromadelicBaseline.runSignoffPack({
  defaultLoops: 2,
  stressLoops: 2,
  stepMs: 240,
  settleMs: 260,
  includeReadability: true,
  includeSoakReport: true
});
window.chromadelicBaseline.getSignoffReport();
window.chromadelicBaseline.downloadSignoffReport('chromadelic-signoff');
```

Expected artifact:
- `chromadelic-signoff-<backend>-<timestamp>.json`
  - `captures[]`
  - `baselineReport`
  - `budget`
  - `capabilities`
  - `soakReport` (if available)

Campaign automation (harness UI):
- **Run Preset Campaign (Current Backend)**
- **Run Dual Backend Campaign**

Campaign artifact:
- `chromadelic-signoff-campaign-<timestamp>.json`
  - per-preset summary for each backend
  - capture counts and headline FPS metrics

---

## Phase 7 Functional Release Gate Automation

Goal:
- Produce repeatable evidence for flag permutations and theme-switch stability before final hardware signoff.

Run from:
- `tests/performance/benchmark-chromadelic-baseline.html`
- Section: **Functional Release Gate**

Harness controls:
- `Run Functional Sweep`
- `Run Theme Switch Stress`
- `Download Gate JSON`
- `Download Gate Markdown`

Manual harness API:
```js
window.chromadelicHarness.runFunctionalSweep();
window.chromadelicHarness.runThemeSwitchStress({ cycles: 100, settleMs: 320 });
window.chromadelicHarness.getGateReport();
window.chromadelicHarness.downloadGateReport('chromadelic-release-gate');
window.chromadelicHarness.downloadGateMarkdown('chromadelic-release-gate');
```

Expected artifacts:
- `chromadelic-release-gate-<timestamp>.json`
  - functional permutation matrix verdicts
  - theme-switch stress sample/failure summary
  - linked signoff campaign metadata (if available)
- `chromadelic-release-gate-<timestamp>.md`
  - review-ready release gate summary

---

## Output Organization

Recommended structure:
```text
baseline/chromadelic-highway/
  webgpu/
    minimal/
    low/
    medium/
    high/
    ultra/
    extreme/
  webgl/
    minimal/
    low/
    medium/
    high/
    ultra/
    extreme/
```

Store:
- 3 screenshots + 1 JSON per preset/backend pair.

---

## Run Matrix Checklist

| Backend | Preset | Idle PNG | Default PNG | Stress PNG | JSON | Status |
|---|---|---|---|---|---|---|
| WebGPU | Minimal | ☐ | ☐ | ☐ | ☐ | ☐ |
| WebGPU | Low | ☐ | ☐ | ☐ | ☐ | ☐ |
| WebGPU | Medium | ☐ | ☐ | ☐ | ☐ | ☐ |
| WebGPU | High | ☐ | ☐ | ☐ | ☐ | ☐ |
| WebGPU | Ultra | ☐ | ☐ | ☐ | ☐ | ☐ |
| WebGPU | Extreme | ☐ | ☐ | ☐ | ☐ | ☐ |
| WebGL | Minimal | ☐ | ☐ | ☐ | ☐ | ☐ |
| WebGL | Low | ☐ | ☐ | ☐ | ☐ | ☐ |
| WebGL | Medium | ☐ | ☐ | ☐ | ☐ | ☐ |
| WebGL | High | ☐ | ☐ | ☐ | ☐ | ☐ |
| WebGL | Ultra | ☐ | ☐ | ☐ | ☐ | ☐ |
| WebGL | Extreme | ☐ | ☐ | ☐ | ☐ | ☐ |

---

## Metadata to Record

Include alongside capture pack:
- Date/time
- OS + GPU + driver
- Browser/version (or Electron runtime build)
- Renderer backend (`WebGPU` or `WebGL2`)
- Quality preset
- Active flags/query params

---

## Acceptance Notes

Baseline capture for Phase 0 is complete when:
- Full matrix above is populated.
- JSON reports are present for every row.
- Hero-frame screenshots are present for every row.

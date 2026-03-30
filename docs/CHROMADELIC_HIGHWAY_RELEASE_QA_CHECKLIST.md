# Chromadelic Highway Release QA Checklist

## Scope

Use this checklist to sign off Chromadelic Highway for release after the WebGPU hybrid upgrade.

Artifacts expected:
- Baseline capture pack (WebGPU + WebGL)
- Readability hero captures
- Soak reports
- Functional permutation pass notes

---

## Runtime Preflight

- [ ] Launch app with deterministic baseline flags:
  - `chromadelicBaseline=1`
  - `chromadelicSeed=1234`
  - `chromadelicFixedDt=16.666`
- [ ] Confirm theme activation: `chromadelic-highway`
- [ ] Confirm helper availability: `window.chromadelicBaseline`
- [ ] Confirm backend under test:
  - WebGPU preferred run
  - Forced WebGL run (`forceWebGL=1`)

---

## Functional Permutations

Run each permutation and verify no runtime errors, black frames, or stuck animation:

- [ ] WebGPU default path
- [ ] WebGPU + `chromadelicNoMRT=1`
- [ ] WebGPU + `chromadelicNoPost=1`
- [ ] WebGPU + `chromadelicNoCompute=1`
- [ ] Forced WebGL fallback (`forceWebGL=1`)
- [ ] Theme switch stress (100+ activate/deactivate cycles)

Harness automation:
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

---

## Visual Signoff Captures

Required hero captures per backend (`WebGPU`, `WebGL`) and quality tier (`Minimal`..`Extreme`):

- [ ] `hero-idle`
- [ ] `hero-default`
- [ ] `hero-stress`
- [ ] `hero-readability-line-clear-4`
- [ ] `hero-readability-combo-8`

Recommended automation:
```js
window.chromadelicBaseline.runSignoffPack({
  defaultLoops: 2,
  stressLoops: 2,
  stepMs: 240,
  settleMs: 260,
  includeReadability: true,
  includeSoakReport: true
});
window.chromadelicBaseline.downloadSignoffReport('chromadelic-signoff');
window.chromadelicBaseline.getPresetOrder();
```

Harness campaign shortcuts:
- `Run Preset Campaign (Current Backend)`
- `Run Dual Backend Campaign`

Readability acceptance:
- [ ] Road lane flow remains trackable
- [ ] Ring edges stay separated (no bloom wash merge)
- [ ] Focal corridor remains visually dominant
- [ ] High-combo events recover quickly to baseline clarity

---

## Performance and Soak

Use:
- `tests/performance/benchmark-chromadelic-baseline.html`
- `window.chromadelicBaseline.runSoak({ durationMinutes: 30, sampleSeconds: 30, stepMs: 220 })`

Targets:
- [ ] 1080p desktop `High`: average >= 60 FPS, 1% low >= 50 FPS
- [ ] 4K desktop `High`: >= 60 FPS while adaptive scaler stays above image floor
- [ ] WebGL fallback `Medium` equivalent: average >= 60 FPS
- [ ] Soak (`>= 20` minutes) shows no sustained memory growth
- [ ] Soak trend gates pass:
  - `memoryTrendStable: true`
  - `thermalTrendStable: true`
  - `pass: true`

---

## Hardware Signoff Matrix

| Platform | Backend Coverage | Visual Pass | Performance Pass | Soak Pass | Signoff |
|---|---|---|---|---|---|
| Windows + high-end NVIDIA | WebGPU + WebGL | ☐ | ☐ | ☐ | ☐ |
| Windows + mid-tier AMD/Intel | WebGPU + WebGL | ☐ | ☐ | ☐ | ☐ |
| macOS Apple Silicon | WebGPU + WebGL | ☐ | ☐ | ☐ | ☐ |
| macOS Intel (if target) | WebGL required, WebGPU optional | ☐ | ☐ | ☐ | ☐ |
| Linux desktop (if target) | WebGL required, WebGPU optional | ☐ | ☐ | ☐ | ☐ |

---

## Artifact Manifest

Store all release evidence under a single dated folder, for example:

```text
release-evidence/chromadelic-highway/YYYY-MM-DD/
  webgpu/
    baseline/
    readability/
    soak/
  webgl/
    baseline/
    readability/
    soak/
  notes/
    functional-permutations.md
    signoff-summary.md
```

Required files:
- [ ] Baseline JSON reports for all required presets/backends
- [ ] Hero-frame screenshots for all required presets/backends
- [ ] Soak JSON reports per required backend/platform
- [ ] Functional gate JSON + Markdown evidence
- [ ] Final signoff summary with known deviations (if any)

---

## Release Gate

Ship only when all are true:
- [ ] No blocking functional regressions
- [ ] Visual acceptance passes on required platforms
- [ ] Performance targets pass on required platforms
- [ ] Soak passes on required platforms
- [ ] All artifacts archived and linked in release notes

# Quadra Test Suite

This directory contains all tests and benchmarks for the Quadra game.

## Directory Structure

```
tests/
├── unit/              # Automated unit tests (run with Node.js)
│   ├── test-optimization.js
│   └── test-god-rays.js
├── performance/       # Interactive performance benchmarks (run in browser)
│   ├── benchmark-rendering.html
│   └── test-god-rays-performance.html
└── README.md
```

## Running Tests

### Unit Tests

Unit tests verify code correctness and optimization implementations.

**Run all unit tests:**
```bash
cd tests/unit
node test-optimization.js
node test-god-rays.js
node test-rainy-window-optimization.js
node test-moonlit-forest-optimization.js
node test-chromadelic-phase0.js
node test-stellar-phase0.js
node test-ice-temple-phase8.js
node test-moonlit-phase0.js
node test-moonlit-phase1.js
node test-moonlit-phase2.js
node test-moonlit-phase3.js
node test-moonlit-phase5.js
node test-moonlit-phase6.js
node test-moonlit-phase7.js
node test-moonlit-phase8.js
node test-moonlit-phase9.js
```

**Run specific test:**
```bash
node tests/unit/test-optimization.js
node tests/unit/test-god-rays.js
node tests/unit/test-rainy-window-optimization.js
node tests/unit/test-moonlit-forest-optimization.js
node tests/unit/test-chromadelic-phase0.js
node tests/unit/test-stellar-phase0.js
node tests/unit/test-ice-temple-phase8.js
node tests/unit/test-moonlit-phase0.js
node tests/unit/test-moonlit-phase1.js
node tests/unit/test-moonlit-phase2.js
node tests/unit/test-moonlit-phase3.js
node tests/unit/test-moonlit-phase5.js
node tests/unit/test-moonlit-phase6.js
node tests/unit/test-moonlit-phase7.js
node tests/unit/test-moonlit-phase8.js
node tests/unit/test-moonlit-phase9.js
```

#### Available Unit Tests

**`test-optimization.js`** - WebGL Renderer Optimization
- Verifies attribute location caching in TexturedQuad
- Verifies attribute location caching in ParticleSystem
- Ensures no redundant `getAttribLocation()` calls
- Validates core rendering logic integrity

**`test-god-rays.js`** - Sunset God Rays Optimization
- Verifies CSS definitions exist for god rays
- Checks GPU acceleration optimization
- Validates animation efficiency
- Confirms visual output functionality
- Tests theme layering and interaction optimization

**`test-rainy-window-optimization.js`** - Rainy Window Collision Optimization
- Verifies squared distance comparison (no sqrt in collision)
- Checks swap-and-pop array removal optimization
- Validates style string caching
- Ensures Math.pow() replaced with multiplication
- Confirms core animation logic integrity
- Verifies only 1 sqrt() call remains (for drop merge)

**`test-moonlit-forest-optimization.js`** - Moonlit Forest Tree Caching
- Verifies tree background cache Map exists
- Checks cache key generation with layer properties
- Validates cache lookup before tree generation
- Ensures cached backgrounds are reused
- Confirms new backgrounds are cached
- Verifies core tree drawing logic integrity

**`test-chromadelic-phase0.js`** - Chromadelic Phase 0 Instrumentation
- Verifies `chromadelicBaseline`/`chromadelicSeed`/`chromadelicFixedDt` flag parsing
- Confirms `window.chromadelicBaseline` helper API is exposed
- Validates baseline metric reporting hooks
- Confirms frame-time variance/stddev metrics are included in reports
- Checks fixed-timestep deterministic animation path
- Confirms compute initializer supports injected deterministic RNG
- Verifies Phase 1 renderer hardening hooks (capabilities, color pipeline, device-loss fallback, lifecycle disposal)
- Verifies Phase 5 reactive envelope mapping/caps and pace-linked road modulation hooks

**`test-stellar-phase0.js`** - Stellar Drift Phase 0 Instrumentation
- Verifies `stellarBaseline`/`stellarSeed`/`stellarFixedDt` flag parsing
- Confirms `window.stellarBaseline` helper API is exposed
- Validates deterministic seed + fixed-timestep hooks
- Validates baseline metric reporting hooks and payload fields
- Checks deterministic playback/capture pack/readability anchor helpers
- Verifies Phase 1 lifecycle hardening hooks (async hybrid init, capabilities, timer tracking, device-loss fallback, runtime disposal)
- Verifies Phase 2 parity groundwork hooks (color pipeline policy, post stack fallback controls, renderFrame abstraction)
- Verifies WebGPU post module wiring and MRT/non-MRT bloom source gating (`stellar-drift-post.js`)
- Verifies Phase 3 start for starfield material modularization (`stellar-drift-materials.js`) with dual WebGPU/WebGL factories
- Verifies Phase 3 `planet + glow` modularization with stable uniform handle wiring
- Verifies full Phase 3 modularization for nebula/dust/ambient/shockwave/shooting-star materials plus stable uniform-handle updates
- Verifies MRT audit diagnostics/fallback controls for hybrid safety
- Verifies Phase 5 kickoff meteor migration to `InstancedMesh` with per-frame instance-matrix updates
- Verifies Phase 5 compute modularization (`stellar-drift-compute.js`) for ambient/dust/burst systems with WebGPU compute wiring and CPU fallback gates
- Verifies per-tier simulation budgets (ambient/dust counts and nebula burst caps) are enforced from quality presets
- Verifies Phase 6B hero planet upgrade hooks (animated banding/scattering/lightning uniforms + structured hero ring material wiring)
- Verifies Phase 6C unified reactive-envelope hooks plus budget/readability-gated comet and aurora event systems with deterministic decay loops
- Verifies Phase 7 adaptive scaler hooks (resolution/effect scaling, runtime quality budget snapshots, render-path post-cost telemetry)
- Verifies Phase 7 warmup/runtime-validation hooks (`compileAsync` timeout guard + quality-switch stress harness API)

**`test-ice-temple-phase8.js`** - Ice Temple Phase 8 Validation Instrumentation
- Verifies `iceTempleBaseline`/`iceTempleSeed`/`iceTempleFixedDt` parsing
- Verifies deterministic playback controls (`iceTemplePlayback`, `iceTemplePlaybackLoops`)
- Confirms `window.iceTempleBaseline` helper API for phase-8 harness automation
- Validates baseline metric/report fields (FPS, 1% low, variance, draw calls, memory estimates)
- Confirms gameplay event validation hooks for `LINE_CLEAR`, `COMBO`, and `PIECE_LOCK`
- Verifies baseline helper/timer lifecycle teardown on stop

**`test-moonlit-phase0.js`** - Moonlit Forest Phase 0 Baseline Lock
- Verifies art-direction packet includes locked hero-frame camera/composition specs
- Verifies baseline helper API exposes hero-frame checklist, event-anchor capture, and preset-sweep automation
- Verifies Phase 8 harness includes dedicated Phase 0 controls and command snippets
- Verifies Moonlit baseline capture protocol doc exists and matches harness workflow

**`test-moonlit-phase1.js`** - Moonlit Forest Phase 1 Hardening
- Verifies capability normalization, fallback wiring, and lifecycle cleanup hooks
- Validates render-path fault tolerance and centralized `stop()` cleanup

**`test-moonlit-phase2.js`** - Moonlit Forest Phase 2 Event Pipeline
- Verifies GPU burst queue/event envelope controller (`moonlit-forest-fx-controller.js`)
- Confirms gameplay handlers route through GPU signal path without legacy DOM writes

**`test-moonlit-phase3.js`** - Moonlit Forest Phase 3 GPU World
- Verifies undergrowth, framing silhouettes, and fog basin systems are built and animated
- Confirms runtime/cleanup tracking for new world-layer arrays

**`test-moonlit-phase5.js`** - Moonlit Forest Phase 5 Compute Path
- Verifies dedicated Moonlit compute module for ambient firefly simulation
- Confirms compute-aware ambient firefly node material wiring
- Confirms renderer compute dispatch and compute-capability plumbing in theme/particle systems

**`test-moonlit-phase6.js`** - Moonlit Forest Phase 6 Post Pipeline
- Verifies WebGPU + WebGL dual post paths, MRT emissive isolation wiring, and grading controls
- Confirms preset-driven post config and MRT audit diagnostics wiring

**`test-moonlit-phase7.js`** - Moonlit Forest Phase 7 Quality Budgets
- Verifies explicit post/budget preset tables and adaptive budget controller hooks
- Confirms frame-loop adaptive updates and live runtime quality-transition handling

**`test-moonlit-phase8.js`** - Moonlit Forest Phase 8 Validation Instrumentation
- Verifies baseline metrics/report hooks for FPS, 1% low, variance, draw calls, and memory estimates
- Confirms deterministic playback controls (`moonlitPlayback`, `moonlitPlaybackLoops`)
- Confirms `window.moonlitBaseline` helper API for event validation and stress automation
- Verifies gameplay validation/soak/resize stress orchestration helpers and lifecycle teardown wiring

**`test-moonlit-phase9.js`** - Moonlit Forest Phase 9 Legacy Decommission
- Verifies no legacy Moonlit DOM/canvas generation code remains in runtime
- Confirms legacy Moonlit selectors/renderer branch removal

### Performance Benchmarks

Performance benchmarks provide interactive measurements and visualizations.

**Run benchmarks:**
1. Open the HTML file in a web browser
2. Click the "Run Benchmark" button
3. Review the performance metrics

#### Available Benchmarks

**`benchmark-rendering.html`** - WebGL Rendering Performance
- Measures frame rendering time
- Tests particle system performance
- Benchmarks texture quad rendering
- Provides before/after optimization comparison

**`test-god-rays-performance.html`** - God Rays Performance
- Measures initial render time
- Tests style recalculation overhead
- Monitors memory usage
- Verifies GPU acceleration status
- Validates visual output

**`benchmark-rainy-window.html`** - Rainy Window Performance
- Real-time FPS monitoring
- Frame time measurement and analysis
- Validates collision optimization (no sqrt in hot path)
- Verifies array removal efficiency (O(1) swap-and-pop)
- Confirms style string caching
- Interactive 5-second benchmark with detailed metrics

**`benchmark-moonlit-forest.html`** - Moonlit Forest Theme Performance
- Measures initial tree generation time
- Tests cached background retrieval speed
- Compares performance with/without caching
- Validates 50x+ speedup on cached loads
- Verifies zero visual regression

**`benchmark-chromadelic-baseline.html`** - Chromadelic Highway Phase 0 Baseline Harness
- Launches deterministic baseline runs (`chromadelicSeed`, `chromadelicFixedDt`, `chromadelicBaseline`)
- Supports WebGPU and forced WebGL fallback capture flows
- Triggers canned gameplay event sequences for repeatable visual stress
- Exposes one-click capture/report/reset plus full pack/readability anchor/JSON export through `window.chromadelicBaseline`

**`benchmark-stellar-baseline.html`** - Stellar Drift Phase 0 Baseline Harness
- Launches deterministic baseline runs (`stellarSeed`, `stellarFixedDt`, `stellarBaseline`)
- Supports default and forced WebGL runtime capture flows
- Triggers canned gameplay event sequences for repeatable visual stress
- Exposes one-click capture/report/reset plus full pack/readability anchor/JSON export through `window.stellarBaseline`

**`benchmark-ice-temple-phase8.html`** - Ice Temple Phase 8 Validation Harness
- Launches deterministic Ice Temple baseline runtime (`iceTempleBaseline`, `iceTempleSeed`, `iceTempleFixedDt`)
- Validates gameplay event coverage (`LINE_CLEAR`, `COMBO`, `PIECE_LOCK`) via helper automation
- Runs pipeline compile/render diagnostics (`validatePipeline`) per backend path
- Runs strict MRT bloom-isolation audit (`validateMRT`) with role/unclassified reporting
- Runs snow compute capacity sampling (`validateSnowCompute`) for 10k+ target checks
- Captures full preset baseline matrix (`Minimal -> Extreme`) with screenshot + metrics export
- Exports evidence bundles with renderer/material/shader inventory + preset metrics
- Evidence bundles now include validation diagnostics (`pipeline`, `mrt`, `events`, `snowCompute`)
- Evidence bundles include a success-criteria snapshot (`evaluateCriteria`) with pass/fail/inconclusive counts
- Runs a dual backend campaign (WebGPU + forced WebGL) and exports side-by-side comparison reports
- Runs configurable soak loops (30+ minute target) with periodic memory/perf samples
- Runs repeated theme-switch cycles (`ice-temple -> forest -> ice-temple`) for leak trend checks
- Exposes one-click report/download/capture controls through `window.iceTempleBaseline`

**`benchmark-moonlit-phase8.html`** - Moonlit Forest Phase 8 Validation Harness
- Launches deterministic Moonlit baseline runtime (`moonlitBaseline`, `moonlitSeed`, `moonlitFixedDt`, `moonlitPlayback`)
- Validates gameplay event coverage (`LINE_CLEAR`, `COMBO`, `PIECE_LOCK`) via helper automation
- Validates hero-frame composition gates (camera/moon corridor/depth/fog/framing)
- Validates tetromino style config snapshot/hash to catch regressions in theme tetromino visuals
- Captures event visual anchors (`LINE_CLEAR`, `COMBO`, `PIECE_LOCK`) as reusable JSON evidence
- Runs a full preset sweep (`Minimal -> Extreme`) with per-preset metrics/checklists/export
- Runs resize stress and theme-switch stress campaigns with JSON report export
- Runs single-preset soak and Medium/High/Ultra soak campaign automation
- Builds a Moonlit evidence bundle (`collectEvidence`) with metrics + validation reports
- Runs a dual backend campaign (WebGPU + forced WebGL) and exports comparison data
- Supports WebGPU and forced WebGL fallback validation passes in one harness
- Exposes runtime controls through `window.moonlitBaseline` (`setQuality`, `runResizeStress`, `runSoakCampaign`, `collectEvidence`)

## Test Organization Philosophy

### Unit Tests (`tests/unit/`)
- **Purpose:** Automated verification of code correctness
- **Runtime:** Node.js
- **Output:** Pass/fail with detailed diagnostics
- **CI/CD:** Can be integrated into automated pipelines

### Performance Tests (`tests/performance/`)
- **Purpose:** Interactive performance measurement and visualization
- **Runtime:** Web browser
- **Output:** Visual metrics, charts, and comparisons
- **Use Case:** Manual performance validation and debugging

## Adding New Tests

### Adding a Unit Test

1. Create `tests/unit/test-your-feature.js`
2. Use Node.js filesystem API to read source files
3. Implement verification logic
4. Exit with code 0 (pass) or 1 (fail)
5. Update this README

Example structure:
```javascript
const fs = require('fs');

console.log('=== Your Feature Test ===\n');

const sourceCode = fs.readFileSync('./your-file.js', 'utf8');

console.log('Test 1: Description');
if (sourceCode.includes('expected-pattern')) {
    console.log('  ✓ PASS');
} else {
    console.log('  ✗ FAIL');
    process.exit(1);
}

console.log('\n=== All Tests Passed! ===');
process.exit(0);
```

### Adding a Performance Benchmark

1. Create `tests/performance/benchmark-your-feature.html`
2. Include performance measurement code
3. Provide visual metrics display
4. Add start/reset controls
5. Update this README

## Best Practices

✅ **Keep tests focused** - One test file per feature/optimization
✅ **Clear naming** - Use descriptive test names (test-feature-name.js)
✅ **Comprehensive output** - Show what's being tested and why
✅ **Exit codes** - Unit tests should exit 0 (pass) or 1 (fail)
✅ **Documentation** - Update this README when adding tests

## Test Coverage

Current test coverage:

| Component | Unit Tests | Performance Tests |
|-----------|------------|-------------------|
| WebGL Renderer | ✅ | ✅ |
| Attribute Caching | ✅ | ✅ |
| Sunset God Rays | ✅ | ✅ |
| Rainy Window Collision | ✅ | ✅ |
| Moonlit Forest Trees | ✅ | ✅ |
| Chromadelic Phase 0 | ✅ | N/A |
| Chromadelic Baseline Harness | N/A | ✅ |
| Stellar Phase 0 | ✅ | N/A |
| Stellar Baseline Harness | N/A | ✅ |
| Ice Temple Phase 8 Instrumentation | ✅ | N/A |
| Ice Temple Phase 8 Harness | N/A | ✅ |
| Moonlit Phases 1/2/3/5/6/7/8/9 | ✅ | N/A |
| Particle Systems | ✅ | ✅ |
| Textured Quads | ✅ | ✅ |

## CI/CD Integration

To integrate unit tests into CI/CD:

```yaml
# Example GitHub Actions workflow
- name: Run Unit Tests
  run: |
    node tests/unit/test-optimization.js
    node tests/unit/test-god-rays.js
    node tests/unit/test-rainy-window-optimization.js
    node tests/unit/test-moonlit-forest-optimization.js
```

## Troubleshooting

**Problem:** Unit test can't find source files
**Solution:** Run from project root: `node tests/unit/test-name.js`

**Problem:** Performance benchmark not loading
**Solution:** Use a local web server (not `file://` protocol)

**Problem:** Performance metrics show as "N/A"
**Solution:** Some metrics require Chrome/Chromium (e.g., `performance.memory`)

## Related Documentation

- [OPTIMIZATION_REPORT.md](../OPTIMIZATION_REPORT.md) - God rays optimization details
- [PERFORMANCE_OPTIMIZATION.md](../PERFORMANCE_OPTIMIZATION.md) - General optimization docs

---

**Last Updated:** 2025-10-01

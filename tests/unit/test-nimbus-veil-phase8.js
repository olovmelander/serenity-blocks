import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Nimbus Veil Phase 8 Performance + Thermal Hardening Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const themePath = path.join(root, 'src', 'themes', 'nimbus-veil', 'nimbus-veil-theme.js');
const planPath = path.join(root, 'docs', 'NIMBUS_VEIL_WEBGPU_UPGRADE_PLAN.md');
const artPath = path.join(root, 'docs', 'NIMBUS_VEIL_ART_DIRECTION.md');
const harnessPath = path.join(root, 'tests', 'performance', 'benchmark-nimbus-veil-phase8.html');

const themeSource = fs.readFileSync(themePath, 'utf8');
const planSource = fs.readFileSync(planPath, 'utf8');
const artSource = fs.readFileSync(artPath, 'utf8');
const harnessSource = fs.readFileSync(harnessPath, 'utf8');

console.log('Test 1: Phase 8 DRS policy profile and state controllers exist');
assert(themeSource.includes('PHASE8_PERFORMANCE_PROFILES'), 'Missing Phase 8 performance profile matrix');
assert(themeSource.includes('resolvePhase8PerformanceProfile()'), 'Missing Phase 8 profile resolver');
assert(themeSource.includes('initializePhase8PerformanceState()'), 'Missing Phase 8 performance state initializer');
assert(themeSource.includes('updatePhase8AdaptiveResolution(frameMs)'), 'Missing Phase 8 adaptive resolution controller');
assert(themeSource.includes('applyPhase8ResolutionScale(force = false)'), 'Missing Phase 8 resolution apply helper');
assert(themeSource.includes('nimbusNoDRS'), 'Missing Phase 8 nimbusNoDRS flag gating');
console.log('  ✓ PASS');

console.log('\nTest 2: Animation/render loop records pass timings and updates adaptive scaling');
assert(themeSource.includes('recordPhase8PassTimingSample({'), 'Missing Phase 8 pass timing sample capture in frame loop');
assert(themeSource.includes('this.updatePhase8AdaptiveResolution(frameMs);'), 'Missing adaptive DRS update in frame loop');
assert(themeSource.includes('void this.updatePhase8GpuTimings();'), 'Missing async GPU timing update in frame loop');
assert(themeSource.includes('renderFrame() {'), 'Missing renderFrame implementation');
assert(themeSource.includes("method: 'cpu-pass-timer'"), 'Missing CPU pass timer fallback method tag');
console.log('  ✓ PASS');

console.log('\nTest 3: Timestamp-query instrumentation with CPU fallback is implemented');
assert(themeSource.includes('configurePhase8TimingInstrumentation()'), 'Missing Phase 8 timing instrumentation configuration');
assert(themeSource.includes('supportsTimestampQuery'), 'Missing timestamp query capability hook');
assert(themeSource.includes("this.phase8Timing.method = this.phase8Timing.enabled ? 'gpu-timestamp-query' : 'cpu-pass-timer';"), 'Missing explicit gpu/cpu timing mode selection');
assert(themeSource.includes('updatePhase8GpuTimings()'), 'Missing Phase 8 GPU timing resolver');
console.log('  ✓ PASS');

console.log('\nTest 4: Prewarm and soak helpers are implemented and exposed');
assert(themeSource.includes('prewarmPhase8Pipelines()'), 'Missing Phase 8 pipeline prewarm helper');
assert(themeSource.includes('runPhase8PerformanceValidation(options = {})'), 'Missing Phase 8 performance validation helper');
assert(themeSource.includes('runPhase8SoakScenario(options = {})'), 'Missing Phase 8 soak scenario helper');
assert(themeSource.includes('runPhase8Soak30m(options = {})'), 'Missing Phase 8 30-minute soak helper');
assert(themeSource.includes('runPhase8Soak2h(options = {})'), 'Missing Phase 8 2-hour soak helper');
assert(themeSource.includes('phase8PerfState: () => this.getPhase8PerformanceRuntimeState(),'), 'Baseline helper missing phase8PerfState');
assert(themeSource.includes('phase8PerfValidate: (options = {}) => this.runPhase8PerformanceValidation(options),'), 'Baseline helper missing phase8PerfValidate');
assert(themeSource.includes('phase8Soak: (options = {}) => this.runPhase8SoakScenario(options),'), 'Baseline helper missing phase8Soak');
assert(themeSource.includes('phase8SoakStop: () => this.requestPhase8SoakStop(),'), 'Baseline helper missing phase8SoakStop');
console.log('  ✓ PASS');

console.log('\nTest 5: Plan and art docs reflect Phase 8 implementation start and guardrails');
assert(planSource.includes('## Phase 8: Performance and Thermal Hardening (Critical)'), 'Plan missing Phase 8 section');
assert(planSource.includes('- [x] Implement and tune DRS policy.'), 'Plan should mark DRS implementation task complete');
assert(planSource.includes('- [x] Prewarm key materials/pipelines.'), 'Plan should mark prewarm task complete');
assert(planSource.includes('- [x] Add timestamp-query instrumentation when supported and CPU pass-timing fallback when unsupported.'), 'Plan should mark timing instrumentation task complete');
assert(planSource.includes('- [x] Add 30-minute and 2-hour soak scenarios.'), 'Plan should mark soak-scenario task complete');
assert(planSource.includes('tests/unit/test-nimbus-veil-phase8.js'), 'Plan evidence should reference Phase 8 unit test');
assert(planSource.includes('tests/performance/benchmark-nimbus-veil-phase8.html'), 'Plan evidence should reference Phase 8 harness');
assert(artSource.includes('## Phase 8 Performance and Thermal Guardrails'), 'Art packet missing Phase 8 guardrail section');
assert(artSource.includes('timestamp query is unavailable, CPU pass timing fallback is mandatory'), 'Art packet missing Phase 8 timing fallback guardrail');
console.log('  ✓ PASS');

console.log('\nTest 6: Phase 8 harness exposes validation and soak helper commands');
assert(harnessSource.includes('Nimbus Veil Phase 8 Performance + Thermal Harness'), 'Phase 8 harness title missing');
assert(harnessSource.includes('window.nimbusBaseline.phase8PerfState();'), 'Phase 8 harness missing perf state helper command');
assert(harnessSource.includes('window.nimbusBaseline.phase8PerfValidate('), 'Phase 8 harness missing performance validation helper command');
assert(harnessSource.includes('window.nimbusBaseline.phase8Soak('), 'Phase 8 harness missing custom soak helper command');
assert(harnessSource.includes('window.nimbusBaseline.phase8Soak30m('), 'Phase 8 harness missing 30m soak helper command');
assert(harnessSource.includes('window.nimbusBaseline.phase8Soak2h('), 'Phase 8 harness missing 2h soak helper command');
assert(harnessSource.includes('window.nimbusBaseline.phase8SoakStop();'), 'Phase 8 harness missing soak stop helper command');
console.log('  ✓ PASS');

console.log('\n=== All Nimbus Veil Phase 8 Tests Passed ===');

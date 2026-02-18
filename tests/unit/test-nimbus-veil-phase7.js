import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Nimbus Veil Phase 7 Reactive Feel + Readability Polish Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const themePath = path.join(root, 'src', 'themes', 'nimbus-veil', 'nimbus-veil-theme.js');
const cloudPath = path.join(root, 'src', 'themes', 'nimbus-veil', 'nimbus-veil-clouds.js');
const computePath = path.join(root, 'src', 'themes', 'nimbus-veil', 'nimbus-veil-compute.js');
const planPath = path.join(root, 'docs', 'NIMBUS_VEIL_WEBGPU_UPGRADE_PLAN.md');
const artPath = path.join(root, 'docs', 'NIMBUS_VEIL_ART_DIRECTION.md');
const harnessPath = path.join(root, 'tests', 'performance', 'benchmark-nimbus-veil-phase7.html');

const themeSource = fs.readFileSync(themePath, 'utf8');
const cloudSource = fs.readFileSync(cloudPath, 'utf8');
const computeSource = fs.readFileSync(computePath, 'utf8');
const planSource = fs.readFileSync(planPath, 'utf8');
const artSource = fs.readFileSync(artPath, 'utf8');
const harnessSource = fs.readFileSync(harnessPath, 'utf8');

console.log('Test 1: Cloud module defines unified envelope matrix and readability caps by tier');
assert(cloudSource.includes('REACTIVE_ENVELOPE_MATRIX'), 'Missing Phase 7 reactive envelope matrix');
assert(cloudSource.includes('resolveNimbusReactiveEnvelopeProfile({'), 'Missing reactive envelope profile resolver');
assert(cloudSource.includes('mapNimbusEventToReactiveImpulse(eventName, magnitude = 1)'), 'Missing event-to-envelope impulse mapping');
assert(cloudSource.includes('computeNimbusCloudReactiveEnvelope({'), 'Missing cloud reactive envelope mapper');
assert(cloudSource.includes('boardSafeClamp'), 'Missing board-safe readability clamp in cloud envelope');
console.log('  ✓ PASS');

console.log('\nTest 2: Theme routes gameplay events through envelope and derives visuals from reactive state');
assert(themeSource.includes('syncReactiveEnvelopeDerivedState()'), 'Missing envelope derived-state synchronization helper');
assert(themeSource.includes("this.applyReactiveEnvelopeImpulse('line-clear'"), 'Line clear should feed unified reactive envelope');
assert(themeSource.includes("this.applyReactiveEnvelopeImpulse('combo'"), 'Combo should feed unified reactive envelope');
assert(themeSource.includes("this.applyReactiveEnvelopeImpulse('piece-lock'"), 'Piece lock should feed unified reactive envelope');
assert(themeSource.includes('const opacityBoost = this.cloudReactiveEnvelope?.opacityBoost ?? 0;'), 'animateEffects should use envelope-driven opacity boost');
assert(themeSource.includes('const reactiveBloomBoost = THREE.MathUtils.clamp('), 'animateEffects should clamp envelope-driven bloom boost');
console.log('  ✓ PASS');

console.log('\nTest 3: Phase 7 readability caps are integrated into post dynamics');
assert(themeSource.includes('PHASE7_READABILITY_THRESHOLDS'), 'Missing Phase 7 readability threshold table');
assert(themeSource.includes('updatePhase6PostPipeline()'), 'Missing post dynamic update method');
assert(themeSource.includes('maxCloudDensitySignal'), 'Missing cloud-density readability cap integration');
assert(themeSource.includes('boardProtection = THREE.MathUtils.clamp('), 'Missing board-protection clamp integration');
assert(themeSource.includes('maxGodRayIntensity'), 'Missing god-ray readability cap integration');
console.log('  ✓ PASS');

console.log('\nTest 4: Theme exposes Phase 7 runtime state and sustained-combo readability validation APIs');
assert(themeSource.includes('getPhase7ReactiveRuntimeState()'), 'Missing Phase 7 reactive runtime state helper');
assert(themeSource.includes('runPhase7ReadabilityValidation(options = {})'), 'Missing Phase 7 readability validation runner');
assert(themeSource.includes("id: 'sustained-combo-sequence'"), 'Readability validation missing sustained combo sequence check');
assert(themeSource.includes("id: 'contrast-ratio-floor'"), 'Readability validation missing contrast threshold check');
assert(themeSource.includes("id: 'envelope-decays-after-stress'"), 'Readability validation missing decay restoration check');
assert(themeSource.includes('phase7ReactiveState: () => this.getPhase7ReactiveRuntimeState(),'), 'Baseline API missing phase7ReactiveState helper');
assert(themeSource.includes('phase7ReadabilityValidate: (options = {}) => this.runPhase7ReadabilityValidation(options),'), 'Baseline API missing phase7ReadabilityValidate helper');
assert(themeSource.includes('phase7ReadabilityDownload: (label) => this.downloadPhase7ReadabilityValidationReport(label),'), 'Baseline API missing phase7ReadabilityDownload helper');
console.log('  ✓ PASS');

console.log('\nTest 5: Compute spirit reactive bridge remains envelope-aware');
assert(computeSource.includes('resolveNimbusSpiritReactiveParams({'), 'Missing Phase 7 spirit reactive parameter bridge');
assert(computeSource.includes('cloudReactive = null'), 'Missing cloud-reactive input handling in compute bridge');
assert(computeSource.includes('cloudSpiritBoost'), 'Missing cloud spirit boost coupling in compute bridge');
console.log('  ✓ PASS');

console.log('\nTest 6: Plan and art docs reflect Phase 7 completion and guardrails');
assert(planSource.includes('## Phase 7: Reactive Feel and Readability Polish (High)'), 'Plan missing Phase 7 section');
assert(planSource.includes('- [x] Replace scattered state with unified envelope model.'), 'Plan should mark unified-envelope task complete');
assert(planSource.includes('- [x] Tune event curves and decay constants by tier.'), 'Plan should mark event-curve tuning task complete');
assert(planSource.includes('- [x] Add accessibility caps and board-safe intensity clamps.'), 'Plan should mark readability-cap task complete');
assert(planSource.includes('- [x] Validate sustained combo readability sequence.'), 'Plan should mark sustained-readability task complete');
assert(planSource.includes('tests/unit/test-nimbus-veil-phase7.js'), 'Plan evidence should reference Phase 7 unit coverage');
assert(planSource.includes('tests/performance/benchmark-nimbus-veil-phase7.html'), 'Plan evidence should reference Phase 7 harness');
assert(artSource.includes('## Phase 7 Reactive Feel and Readability Guardrails'), 'Art packet missing Phase 7 guardrail section');
assert(artSource.includes('Sustained combo chains (`10+`)'), 'Art packet missing sustained combo readability guardrail');
console.log('  ✓ PASS');

console.log('\nTest 7: Phase 7 harness exposes reactive/readability helper commands');
assert(harnessSource.includes('window.nimbusBaseline.phase7ReactiveState();'), 'Phase 7 harness missing reactive-state helper command');
assert(harnessSource.includes('window.nimbusBaseline.phase7ReadabilityValidate('), 'Phase 7 harness missing validation helper command');
assert(harnessSource.includes('window.nimbusBaseline.phase7ReadabilityDownload('), 'Phase 7 harness missing download helper command');
console.log('  ✓ PASS');

console.log('\n=== All Nimbus Veil Phase 7 Tests Passed ===');

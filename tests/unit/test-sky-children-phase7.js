import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Sky Children Phase 7 Quality Tier QA Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const resourcesPath = path.join(root, 'src', 'themes', 'sky-children', 'sky-children-resources.js');
const themePath = path.join(root, 'src', 'themes', 'sky-children', 'sky-children-theme.js');
const harnessPath = path.join(root, 'tests', 'performance', 'benchmark-sky-children-phase7.html');

const resourcesSource = fs.readFileSync(resourcesPath, 'utf8');
const themeSource = fs.readFileSync(themePath, 'utf8');
const harnessSource = fs.readFileSync(harnessPath, 'utf8');

console.log('Test 1: Phase 7 quality preset matrix is declared in resources');
assert(resourcesSource.includes('SKY_CHILDREN_PHASE7_QUALITY_PRESETS'), 'Missing Phase 7 quality preset export');
assert(resourcesSource.includes('grassInstances: 3000'), 'Missing mobile grass instance target');
assert(resourcesSource.includes('grassInstances: 8000'), 'Missing medium grass instance target');
assert(resourcesSource.includes('grassInstances: 14000'), 'Missing high grass instance target');
assert(resourcesSource.includes('grassInstances: 22000'), 'Missing ultra grass instance target');
assert(resourcesSource.includes('renderScale: 0.6'), 'Missing mobile render scale target');
assert(resourcesSource.includes('renderScale: 0.85'), 'Missing medium render scale target');
assert(resourcesSource.includes('renderScale: 1.0'), 'Missing high/ultra render scale target');
assert(resourcesSource.includes('normalizeSkyChildrenPhase7QualityTier'), 'Missing Phase 7 quality tier normalization helper');
assert(resourcesSource.includes('getSkyChildrenPhase7QualityPreset'), 'Missing Phase 7 quality preset getter');
console.log('  ✓ PASS');

console.log('\nTest 2: Theme exposes dedicated Phase 7 helper API');
assert(themeSource.includes('installPhase7Helpers()'), 'Missing installPhase7Helpers');
assert(themeSource.includes('removePhase7Helpers()'), 'Missing removePhase7Helpers');
assert(themeSource.includes('window.skyChildrenPhase7 = {'), 'Missing global skyChildrenPhase7 helper object');
assert(themeSource.includes('setTier: (tier, options = {}) => this.setPhase7QualityTier(tier, options)'), 'Missing setTier helper mapping');
assert(themeSource.includes('state: () => this.getPhase7QualityState()'), 'Missing state helper mapping');
assert(themeSource.includes('visualGate: (options = {}) => this.evaluatePhase7VisualGate(options)'), 'Missing visualGate helper mapping');
assert(themeSource.includes('perfGate: (options = {}) => this.runPhase7PerformanceGate(options)'), 'Missing perfGate helper mapping');
assert(themeSource.includes('validate: (options = {}) => this.runPhase7Validation(options)'), 'Missing validate helper mapping');
assert(themeSource.includes('download: (label) => this.downloadPhase7ValidationReport(label)'), 'Missing download helper mapping');
console.log('  ✓ PASS');

console.log('\nTest 3: Phase 7 gates and validation report wiring are implemented');
assert(themeSource.includes('evaluatePhase7VisualGate(options = {})'), 'Missing Phase 7 visual gate method');
assert(themeSource.includes('runPhase7PerformanceGate(options = {})'), 'Missing Phase 7 performance gate method');
assert(themeSource.includes('runPhase7Validation(options = {})'), 'Missing Phase 7 validation method');
assert(themeSource.includes("gate: 'Phase 7 visual gate'"), 'Missing Phase 7 visual gate label');
assert(themeSource.includes("gate: 'Phase 7 performance gate'"), 'Missing Phase 7 performance gate label');
assert(themeSource.includes("deliverable: 'Quality-tier QA'"), 'Missing Phase 7 deliverable label');
assert(themeSource.includes('Mobile/Medium/High/Ultra tiers preserve artistic identity, not just FPS'), 'Missing Phase 7 visual criterion text');
assert(themeSource.includes('Tier frame budget compliance'), 'Missing Phase 7 performance criterion text');
assert(themeSource.includes('heroShotChecklist: [...SKY_CHILDREN_PHASE7_HERO_SHOTS]'), 'Missing Phase 7 hero shot checklist wiring');
console.log('  ✓ PASS');

console.log('\nTest 4: Browser harness wires Phase 7 helper commands');
assert(harnessSource.includes('Sky Children Phase 7 Quality Tier QA Harness'), 'Missing Phase 7 harness title');
assert(harnessSource.includes('Run Tier Visual Gate'), 'Harness missing Phase 7 visual gate control');
assert(harnessSource.includes('Run Tier Perf Gate'), 'Harness missing Phase 7 performance gate control');
assert(harnessSource.includes('Run Full Phase 7 Validation'), 'Harness missing Phase 7 validation control');
assert(harnessSource.includes("helper.setTier('mobile')"), 'Harness should invoke setTier helper');
assert(harnessSource.includes('helper.tiers()'), 'Harness should invoke tiers helper');
assert(harnessSource.includes('helper.visualGate()'), 'Harness should invoke visualGate helper');
assert(harnessSource.includes('helper.perfGate('), 'Harness should invoke perfGate helper');
assert(harnessSource.includes('helper.validate({'), 'Harness should invoke validate helper');
assert(harnessSource.includes('helper.download('), 'Harness should invoke download helper');
assert(harnessSource.includes('helper.setResolutionLock(1920, 1080)'), 'Harness should invoke resolution lock helper');
console.log('  ✓ PASS');

console.log('\n=== Sky Children Phase 7 Quality Tier QA Tests Passed ===');

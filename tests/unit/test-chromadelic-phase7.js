import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Chromadelic Phase 7 Decommission + Docs Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.join(__dirname, '..', '..');
const planPath = path.join(rootDir, 'docs', 'CHROMADELIC_HIGHWAY_WEBGPU_UPGRADE_PLAN.md');
const checklistPath = path.join(rootDir, 'docs', 'CHROMADELIC_HIGHWAY_RELEASE_QA_CHECKLIST.md');
const protocolPath = path.join(rootDir, 'docs', 'CHROMADELIC_HIGHWAY_BASELINE_CAPTURE_PROTOCOL.md');
const legacyRendererPath = path.join(
    rootDir,
    'src',
    'themes',
    'chromadelic-highway',
    'webgl-chromadelic-renderer.js',
);
const themePath = path.join(
    rootDir,
    'src',
    'themes',
    'chromadelic-highway',
    'chromadelic-highway-theme.js',
);
const harnessPath = path.join(
    rootDir,
    'tests',
    'performance',
    'benchmark-chromadelic-baseline.html',
);

const planSource = fs.readFileSync(planPath, 'utf8');
const checklistSource = fs.readFileSync(checklistPath, 'utf8');
const protocolSource = fs.readFileSync(protocolPath, 'utf8');
const themeSource = fs.readFileSync(themePath, 'utf8');
const harnessSource = fs.readFileSync(harnessPath, 'utf8');

console.log('Test 1: Legacy standalone WebGL renderer file is removed');
assert(!fs.existsSync(legacyRendererPath), 'Legacy webgl-chromadelic-renderer.js still exists');
console.log('  PASS');

console.log('\nTest 2: Runtime theme has no remaining references to removed legacy renderer');
assert(!themeSource.includes('webgl-chromadelic-renderer'), 'Theme still references legacy WebGL renderer module');
console.log('  PASS');

console.log('\nTest 3: Plan includes final capability matrix and quality budget documentation');
assert(planSource.includes('### Final Capability Matrix (Shipped Runtime)'), 'Missing final capability matrix section');
assert(planSource.includes('### Final Quality Budgets (Shipped Defaults)'), 'Missing final quality budget section');
assert(
    planSource.includes('- [x] Remove stale/unused code paths proven unnecessary by telemetry and tests.'),
    'Phase 7 stale path cleanup not marked complete',
);
assert(
    planSource.includes('- [x] Update docs with final capability matrix and quality budgets.'),
    'Phase 7 docs update not marked complete',
);
console.log('  PASS');

console.log('\nTest 4: Release QA checklist artifact exists with required gate sections');
assert(checklistSource.includes('# Chromadelic Highway Release QA Checklist'), 'Missing release checklist title');
assert(checklistSource.includes('## Functional Permutations'), 'Missing functional permutation section');
assert(checklistSource.includes('## Performance and Soak'), 'Missing performance and soak section');
assert(checklistSource.includes('## Hardware Signoff Matrix'), 'Missing hardware signoff matrix section');
assert(checklistSource.includes('## Release Gate'), 'Missing release gate section');
assert(checklistSource.includes('window.chromadelicHarness.runFunctionalSweep'), 'Checklist missing functional sweep helper command');
assert(checklistSource.includes('window.chromadelicHarness.runThemeSwitchStress'), 'Checklist missing switch stress helper command');
console.log('  PASS');

console.log('\nTest 5: Signoff capture helper workflow is documented and exposed');
assert(themeSource.includes('async runBaselineSignoffPack(options = {})'), 'Missing runBaselineSignoffPack implementation');
assert(themeSource.includes('downloadBaselineSignoffReport(label = \'chromadelic-signoff\')'), 'Missing signoff download helper');
assert(themeSource.includes('runSignoffPack: (options = {}) => this.runBaselineSignoffPack(options)'), 'Missing runSignoffPack helper exposure');
assert(themeSource.includes('getSignoffReport: () => this.lastBaselineSignoffReport'), 'Missing getSignoffReport helper exposure');
assert(themeSource.includes('downloadSignoffReport: (label) => this.downloadBaselineSignoffReport(label)'), 'Missing downloadSignoffReport helper exposure');
assert(themeSource.includes('getPresetOrder: () => this.getBaselinePresetOrder()'), 'Missing getPresetOrder helper exposure');
assert(checklistSource.includes('window.chromadelicBaseline.runSignoffPack'), 'Checklist missing signoff helper command');
assert(protocolSource.includes('## Phase 7 Signoff Capture Pack'), 'Protocol missing Phase 7 signoff section');
assert(protocolSource.includes('window.chromadelicBaseline.runSignoffPack'), 'Protocol missing runSignoffPack command');
console.log('  PASS');

console.log('\nTest 6: Harness includes preset and dual-backend campaign automation controls');
assert(harnessSource.includes('Run Preset Campaign (Current Backend)'), 'Harness missing single-backend campaign control');
assert(harnessSource.includes('Run Dual Backend Campaign'), 'Harness missing dual-backend campaign control');
assert(harnessSource.includes('runSignoffCampaignForCurrentBackend(options = {})'), 'Harness missing campaign runner');
assert(harnessSource.includes('run-dual-signoff-campaign'), 'Harness missing dual campaign button wiring');
console.log('  PASS');

console.log('\nTest 7: Functional release-gate automation is available in harness and docs');
assert(harnessSource.includes('Functional Release Gate'), 'Harness missing functional release gate section');
assert(harnessSource.includes('Run Functional Sweep'), 'Harness missing functional sweep control');
assert(harnessSource.includes('Run Theme Switch Stress'), 'Harness missing switch stress control');
assert(harnessSource.includes('download-functional-gate-md'), 'Harness missing gate markdown download control');
assert(harnessSource.includes('window.chromadelicHarness = {'), 'Harness missing chromadelicHarness API');
assert(harnessSource.includes('runFunctionalSweep: async (options = {}) =>'), 'Harness missing runFunctionalSweep API exposure');
assert(harnessSource.includes('runThemeSwitchStress: async (options = {}) =>'), 'Harness missing runThemeSwitchStress API exposure');
assert(protocolSource.includes('## Phase 7 Functional Release Gate Automation'), 'Protocol missing functional release gate section');
assert(protocolSource.includes('window.chromadelicHarness.runFunctionalSweep'), 'Protocol missing functional sweep command');
assert(protocolSource.includes('window.chromadelicHarness.downloadGateMarkdown'), 'Protocol missing gate markdown command');
console.log('  PASS');

console.log('\n=== Chromadelic Phase 7 Tests Passed ===');

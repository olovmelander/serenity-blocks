import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Sky Children Phase 5 Validation Gate Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const themePath = path.join(root, 'src', 'themes', 'sky-children', 'sky-children-theme.js');
const harnessPath = path.join(root, 'tests', 'performance', 'benchmark-sky-children-phase5.html');

const themeSource = fs.readFileSync(themePath, 'utf8');
const harnessSource = fs.readFileSync(harnessPath, 'utf8');

console.log('Test 1: Theme exposes dedicated Phase 5 helper API');
assert(themeSource.includes('installPhase5Helpers()'), 'Missing installPhase5Helpers');
assert(themeSource.includes('removePhase5Helpers()'), 'Missing removePhase5Helpers');
assert(themeSource.includes('window.skyChildrenPhase5 = {'), 'Missing global skyChildrenPhase5 helper object');
assert(
    themeSource.includes('validate: (options = {}) => this.runPhase5Validation(options)'),
    'Missing phase5 validate() helper mapping',
);
assert(
    themeSource.includes('download: (label) => this.downloadPhase5ValidationReport(label)'),
    'Missing phase5 download() helper mapping',
);
assert(
    themeSource.includes('setPostState: (overrides = {}) => this.setPhase5PostState(overrides)'),
    'Missing phase5 setPostState() helper mapping',
);
console.log('  ✓ PASS');

console.log('\nTest 2: Visual gate checks enforce Phase 5 post criteria');
assert(
    themeSource.includes('Bloom halo soft but controlled'),
    'Phase 5 visual gate should include bloom halo criterion',
);
assert(
    themeSource.includes('No highlight hue collapse in approved sunset scenes'),
    'Phase 5 visual gate should include highlight hue criterion',
);
assert(themeSource.includes('bloomHaloControlled'), 'Phase 5 visual gate should track bloom halo control check');
assert(themeSource.includes('highlightHueSafety'), 'Phase 5 visual gate should track highlight hue safety check');
console.log('  ✓ PASS');

console.log('\nTest 3: Performance gate defaults align to Phase 5 target budget');
assert(
    themeSource.includes('targetMs = Number.isFinite(options.targetMs) ? Math.max(0.05, options.targetMs) : 1.5'),
    'Phase 5 performance gate should default to 1.5ms target',
);
assert(
    themeSource.includes("gate: 'Phase 5 performance gate'"),
    'Phase 5 performance gate label missing',
);
assert(
    themeSource.includes("deliverable: 'Post stack'"),
    'Phase 5 validation deliverable label missing',
);
console.log('  ✓ PASS');

console.log('\nTest 4: Browser harness wires the Phase 5 helper commands');
assert(harnessSource.includes('Sky Children Phase 5 Post Validation Harness'), 'Missing Phase 5 harness title');
assert(harnessSource.includes('Run Post Visual Gate'), 'Harness missing Phase 5 visual gate control');
assert(harnessSource.includes('Run Post Perf Gate'), 'Harness missing Phase 5 performance gate control');
assert(harnessSource.includes('Run Full Phase 5 Validation'), 'Harness missing Phase 5 validation control');
assert(harnessSource.includes('helper.visualGate()'), 'Harness should invoke Phase 5 visualGate helper');
assert(harnessSource.includes('helper.perfGate({'), 'Harness should invoke Phase 5 perfGate helper');
assert(harnessSource.includes('helper.validate({'), 'Harness should invoke Phase 5 validate helper');
assert(harnessSource.includes('helper.download('), 'Harness should invoke Phase 5 download helper');
assert(harnessSource.includes('helper.setPostState({'), 'Harness should invoke Phase 5 post-state helper');
assert(harnessSource.includes('helper.setResolutionLock(1920, 1080)'), 'Harness should invoke Phase 5 resolution lock helper');
console.log('  ✓ PASS');

console.log('\n=== Sky Children Phase 5 Validation Gate Tests Passed ===');

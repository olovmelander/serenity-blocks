import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Sky Children Phase 3 Validation Gate Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const themePath = path.join(root, 'src', 'themes', 'sky-children', 'sky-children-theme.js');
const harnessPath = path.join(root, 'tests', 'performance', 'benchmark-sky-children-phase3.html');

const themeSource = fs.readFileSync(themePath, 'utf8');
const harnessSource = fs.readFileSync(harnessPath, 'utf8');

console.log('Test 1: Theme exposes dedicated Phase 3 helper API');
assert(themeSource.includes('installPhase3Helpers()'), 'Missing installPhase3Helpers');
assert(themeSource.includes('removePhase3Helpers()'), 'Missing removePhase3Helpers');
assert(themeSource.includes('window.skyChildrenPhase3 = {'), 'Missing global skyChildrenPhase3 helper object');
assert(
    themeSource.includes('validate: (options = {}) => this.runPhase3Validation(options)'),
    'Missing phase3 validate() helper mapping',
);
assert(
    themeSource.includes('download: (label) => this.downloadPhase3ValidationReport(label)'),
    'Missing phase3 download() helper mapping',
);
assert(
    themeSource.includes('setResolutionLock: (width = 1920, height = 1080, options = {}) => this.setResolutionLock(width, height, options)'),
    'Missing phase3 setResolutionLock() helper mapping',
);
assert(
    themeSource.includes('clearResolutionLock: () => this.clearResolutionLock()'),
    'Missing phase3 clearResolutionLock() helper mapping',
);
console.log('  ✓ PASS');

console.log('\nTest 2: Visual gate checks enforce Phase 3 cloud criteria');
assert(
    themeSource.includes('Hero cloud silhouettes read clearly against sky'),
    'Phase 3 visual gate should include silhouette criterion',
);
assert(
    themeSource.includes('Backlit silver-lining behavior passes reference check'),
    'Phase 3 visual gate should include silver-lining criterion',
);
assert(themeSource.includes('silverLiningBehavior'), 'Phase 3 visual gate should track silver-lining behavior');
assert(themeSource.includes('silhouetteReadability'), 'Phase 3 visual gate should track silhouette readability');
console.log('  ✓ PASS');

console.log('\nTest 3: Performance gate defaults align to Phase 3 target budget');
assert(
    themeSource.includes('targetMs = Number.isFinite(options.targetMs) ? Math.max(0.05, options.targetMs) : 2.5'),
    'Phase 3 performance gate should default to 2.5ms target',
);
assert(
    themeSource.includes("gate: 'Phase 3 performance gate'"),
    'Phase 3 performance gate label missing',
);
assert(
    themeSource.includes("deliverable: 'Cloud pass'"),
    'Phase 3 validation deliverable label missing',
);
console.log('  ✓ PASS');

console.log('\nTest 4: Browser harness wires the Phase 3 helper commands');
assert(harnessSource.includes('Sky Children Phase 3 Cloud Validation Harness'), 'Missing Phase 3 harness title');
assert(harnessSource.includes('Run Cloud Visual Gate'), 'Harness missing Phase 3 visual gate control');
assert(harnessSource.includes('Run Cloud Perf Gate'), 'Harness missing Phase 3 performance gate control');
assert(harnessSource.includes('Run Full Phase 3 Validation'), 'Harness missing Phase 3 validation control');
assert(harnessSource.includes('helper.visualGate()'), 'Harness should invoke Phase 3 visualGate helper');
assert(harnessSource.includes('helper.perfGate({'), 'Harness should invoke Phase 3 perfGate helper');
assert(harnessSource.includes('helper.validate({'), 'Harness should invoke Phase 3 validate helper');
assert(harnessSource.includes('helper.download('), 'Harness should invoke Phase 3 download helper');
assert(harnessSource.includes('helper.setResolutionLock(1920, 1080)'), 'Harness should invoke Phase 3 resolution lock helper');
assert(harnessSource.includes('helper.clearResolutionLock()'), 'Harness should invoke Phase 3 resolution unlock helper');
console.log('  ✓ PASS');

console.log('\n=== Sky Children Phase 3 Validation Gate Tests Passed ===');

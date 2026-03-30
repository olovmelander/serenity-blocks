import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Sky Children Phase 2 Validation Gate Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const themePath = path.join(root, 'src', 'themes', 'sky-children', 'sky-children-theme.js');
const harnessPath = path.join(root, 'tests', 'performance', 'benchmark-sky-children-phase2.html');

const themeSource = fs.readFileSync(themePath, 'utf8');
const harnessSource = fs.readFileSync(harnessPath, 'utf8');

console.log('Test 1: Theme exposes dedicated Phase 2 helper API');
assert(themeSource.includes('installPhase2Helpers()'), 'Missing installPhase2Helpers');
assert(themeSource.includes('removePhase2Helpers()'), 'Missing removePhase2Helpers');
assert(themeSource.includes('window.skyChildrenPhase2 = {'), 'Missing global skyChildrenPhase2 helper object');
assert(
    themeSource.includes('validate: (options = {}) => this.runPhase2Validation(options)'),
    'Missing phase2 validate() helper mapping',
);
assert(
    themeSource.includes('download: (label) => this.downloadPhase2ValidationReport(label)'),
    'Missing phase2 download() helper mapping',
);
assert(
    themeSource.includes('setResolutionLock: (width = 1920, height = 1080, options = {}) => this.setResolutionLock(width, height, options)'),
    'Missing phase2 setResolutionLock() helper mapping',
);
assert(
    themeSource.includes('clearResolutionLock: () => this.clearResolutionLock()'),
    'Missing phase2 clearResolutionLock() helper mapping',
);
console.log('  ✓ PASS');

console.log('\nTest 2: Visual gate checks enforce Phase 2 terrain criteria');
assert(
    themeSource.includes('No visible UV stretching on steep slopes (tri-planar active)'),
    'Phase 2 visual gate should include UV stretching criterion',
);
assert(themeSource.includes('distanceStability'), 'Phase 2 visual gate should track distance stability');
assert(themeSource.includes('triplanarActive'), 'Phase 2 visual gate should track tri-planar activation');
console.log('  ✓ PASS');

console.log('\nTest 3: Performance gate defaults align to Phase 2 target budget');
assert(
    themeSource.includes('targetMs = Number.isFinite(options.targetMs) ? Math.max(0.05, options.targetMs) : 2.0'),
    'Phase 2 performance gate should default to 2.0ms target',
);
assert(
    themeSource.includes("gate: 'Phase 2 performance gate'"),
    'Phase 2 performance gate label missing',
);
assert(
    themeSource.includes("deliverable: 'Terrain pass'"),
    'Phase 2 validation deliverable label missing',
);
console.log('  ✓ PASS');

console.log('\nTest 4: Browser harness wires the Phase 2 helper commands');
assert(harnessSource.includes('Sky Children Phase 2 Terrain Validation Harness'), 'Missing Phase 2 harness title');
assert(harnessSource.includes('Run Terrain Visual Gate'), 'Harness missing Phase 2 visual gate control');
assert(harnessSource.includes('Run Terrain Perf Gate'), 'Harness missing Phase 2 performance gate control');
assert(harnessSource.includes('Run Full Phase 2 Validation'), 'Harness missing Phase 2 validation control');
assert(harnessSource.includes('helper.visualGate()'), 'Harness should invoke Phase 2 visualGate helper');
assert(harnessSource.includes('helper.perfGate({'), 'Harness should invoke Phase 2 perfGate helper');
assert(harnessSource.includes('helper.validate({'), 'Harness should invoke Phase 2 validate helper');
assert(harnessSource.includes('helper.download('), 'Harness should invoke Phase 2 download helper');
assert(harnessSource.includes('helper.setResolutionLock(1920, 1080)'), 'Harness should invoke Phase 2 resolution lock helper');
assert(harnessSource.includes('helper.clearResolutionLock()'), 'Harness should invoke Phase 2 resolution unlock helper');
console.log('  ✓ PASS');

console.log('\n=== Sky Children Phase 2 Validation Gate Tests Passed ===');

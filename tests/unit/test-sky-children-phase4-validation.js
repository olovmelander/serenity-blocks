import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Sky Children Phase 4 Validation Gate Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const themePath = path.join(root, 'src', 'themes', 'sky-children', 'sky-children-theme.js');
const harnessPath = path.join(root, 'tests', 'performance', 'benchmark-sky-children-phase4.html');

const themeSource = fs.readFileSync(themePath, 'utf8');
const harnessSource = fs.readFileSync(harnessPath, 'utf8');

console.log('Test 1: Theme exposes dedicated Phase 4 helper API');
assert(themeSource.includes('installPhase4Helpers()'), 'Missing installPhase4Helpers');
assert(themeSource.includes('removePhase4Helpers()'), 'Missing removePhase4Helpers');
assert(themeSource.includes('window.skyChildrenPhase4 = {'), 'Missing global skyChildrenPhase4 helper object');
assert(
    themeSource.includes('validate: (options = {}) => this.runPhase4Validation(options)'),
    'Missing phase4 validate() helper mapping',
);
assert(
    themeSource.includes('download: (label) => this.downloadPhase4ValidationReport(label)'),
    'Missing phase4 download() helper mapping',
);
assert(
    themeSource.includes('setInstanceCount: (count) => this.setFoliageInstanceCount(count)'),
    'Missing phase4 setInstanceCount() helper mapping',
);
console.log('  ✓ PASS');

console.log('\nTest 2: Visual gate checks enforce Phase 4 foliage criteria');
assert(
    themeSource.includes('Wind motion looks layered/non-synchronous'),
    'Phase 4 visual gate should include layered/non-synchronous wind criterion',
);
assert(
    themeSource.includes('Translucency reads from sun-facing camera angles'),
    'Phase 4 visual gate should include translucency criterion',
);
assert(themeSource.includes('layeredWind'), 'Phase 4 visual gate should track layered wind check');
assert(themeSource.includes('translucencyReadability'), 'Phase 4 visual gate should track translucency readability');
assert(themeSource.includes('directionNormalization'), 'Phase 4 visual gate should track wind direction normalization');
assert(themeSource.includes('silhouetteSafety'), 'Phase 4 visual gate should track foreground silhouette safety');
console.log('  ✓ PASS');

console.log('\nTest 3: Performance gate defaults align to Phase 4 target budget');
assert(
    themeSource.includes('targetMs = Number.isFinite(options.targetMs) ? Math.max(0.05, options.targetMs) : 2.0'),
    'Phase 4 performance gate should default to 2.0ms target',
);
assert(
    themeSource.includes("gate: 'Phase 4 performance gate'"),
    'Phase 4 performance gate label missing',
);
assert(
    themeSource.includes("deliverable: 'Foliage instancing'"),
    'Phase 4 validation deliverable label missing',
);
console.log('  ✓ PASS');

console.log('\nTest 4: Browser harness wires the Phase 4 helper commands');
assert(harnessSource.includes('Sky Children Phase 4 Foliage Validation Harness'), 'Missing Phase 4 harness title');
assert(harnessSource.includes('Run Foliage Visual Gate'), 'Harness missing Phase 4 visual gate control');
assert(harnessSource.includes('Run Foliage Perf Gate'), 'Harness missing Phase 4 performance gate control');
assert(harnessSource.includes('Run Full Phase 4 Validation'), 'Harness missing Phase 4 validation control');
assert(harnessSource.includes('helper.visualGate()'), 'Harness should invoke Phase 4 visualGate helper');
assert(harnessSource.includes('helper.perfGate({'), 'Harness should invoke Phase 4 perfGate helper');
assert(harnessSource.includes('helper.validate({'), 'Harness should invoke Phase 4 validate helper');
assert(harnessSource.includes('helper.download('), 'Harness should invoke Phase 4 download helper');
assert(harnessSource.includes('helper.setInstanceCount('), 'Harness should invoke Phase 4 instance count helper');
assert(harnessSource.includes('helper.setResolutionLock(1920, 1080)'), 'Harness should invoke Phase 4 resolution lock helper');
console.log('  ✓ PASS');

console.log('\n=== Sky Children Phase 4 Validation Gate Tests Passed ===');

import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Sky Children Phase 1 Validation Gate Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const themePath = path.join(root, 'src', 'themes', 'sky-children', 'sky-children-theme.js');
const harnessPath = path.join(root, 'tests', 'performance', 'benchmark-sky-children-phase1.html');

const themeSource = fs.readFileSync(themePath, 'utf8');
const harnessSource = fs.readFileSync(harnessPath, 'utf8');

console.log('Test 1: Theme exposes dedicated Phase 1 helper API');
assert(themeSource.includes('installPhase1Helpers()'), 'Missing installPhase1Helpers');
assert(themeSource.includes('removePhase1Helpers()'), 'Missing removePhase1Helpers');
assert(themeSource.includes('window.skyChildrenPhase1 = {'), 'Missing global skyChildrenPhase1 helper object');
assert(
    themeSource.includes('validate: (options = {}) => this.runPhase1Validation(options)'),
    'Missing validate() helper mapping',
);
assert(
    themeSource.includes('download: (label) => this.downloadPhase1ValidationReport(label)'),
    'Missing download() helper mapping',
);
assert(
    themeSource.includes('setResolutionLock: (width = 1920, height = 1080, options = {}) => this.setResolutionLock(width, height, options)'),
    'Missing phase1 setResolutionLock() helper mapping',
);
assert(
    themeSource.includes('clearResolutionLock: () => this.clearResolutionLock()'),
    'Missing phase1 clearResolutionLock() helper mapping',
);
console.log('  ✓ PASS');

console.log('\nTest 2: Visual gate checks enforce the plan criteria');
assert(themeSource.includes('No black shadows'), 'Visual gate should include no-black-shadows criterion');
assert(themeSource.includes('rimSeparation'), 'Visual gate should track rim separation');
assert(themeSource.includes('warmCoolSplit'), 'Visual gate should track warm/cool split');
assert(themeSource.includes('heroShotChecklist'), 'Validation report should include hero shot checklist');
console.log('  ✓ PASS');

console.log('\nTest 3: Performance gate defaults align to Phase 1 target budget');
assert(
    themeSource.includes('targetMs = Number.isFinite(options.targetMs) ? Math.max(0.05, options.targetMs) : 0.5'),
    'Performance gate should default to 0.5ms target',
);
assert(
    themeSource.includes('requiredWidth = Number.isFinite(options.requiredWidth) ? Math.max(1, options.requiredWidth) : 1920'),
    'Performance gate should default to 1920 width',
);
assert(
    themeSource.includes('requiredHeight = Number.isFinite(options.requiredHeight) ? Math.max(1, options.requiredHeight) : 1080'),
    'Performance gate should default to 1080 height',
);
assert(
    themeSource.includes("gate: 'Phase 1 performance gate'"),
    'Performance gate report label is missing',
);
console.log('  ✓ PASS');

console.log('\nTest 4: Browser harness wires the helper commands');
assert(harnessSource.includes('Sky Children Phase 1 Validation Harness'), 'Missing harness title');
assert(harnessSource.includes('Run Visual Gate'), 'Harness missing visual gate control');
assert(harnessSource.includes('Run Perf Gate'), 'Harness missing performance gate control');
assert(harnessSource.includes('Run Full Phase 1 Validation'), 'Harness missing validation control');
assert(harnessSource.includes('helper.visualGate()'), 'Harness should invoke visualGate helper');
assert(harnessSource.includes('helper.perfGate({'), 'Harness should invoke perfGate helper');
assert(harnessSource.includes('helper.validate({'), 'Harness should invoke validate helper');
assert(harnessSource.includes('helper.download('), 'Harness should invoke download helper');
assert(harnessSource.includes('helper.setResolutionLock(1920, 1080)'), 'Harness should invoke resolution lock helper');
assert(harnessSource.includes('helper.clearResolutionLock()'), 'Harness should invoke resolution unlock helper');
console.log('  ✓ PASS');

console.log('\n=== Sky Children Phase 1 Validation Gate Tests Passed ===');

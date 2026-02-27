import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Sky Children Phase 6 Validation Gate Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const themePath = path.join(root, 'src', 'themes', 'sky-children', 'sky-children-theme.js');
const harnessPath = path.join(root, 'tests', 'performance', 'benchmark-sky-children-phase6.html');

const themeSource = fs.readFileSync(themePath, 'utf8');
const harnessSource = fs.readFileSync(harnessPath, 'utf8');

console.log('Test 1: Theme exposes dedicated Phase 6 helper API');
assert(themeSource.includes('installPhase6Helpers()'), 'Missing installPhase6Helpers');
assert(themeSource.includes('removePhase6Helpers()'), 'Missing removePhase6Helpers');
assert(themeSource.includes('window.skyChildrenPhase6 = {'), 'Missing global skyChildrenPhase6 helper object');
assert(
    themeSource.includes('validate: (options = {}) => this.runPhase6Validation(options)'),
    'Missing phase6 validate() helper mapping',
);
assert(
    themeSource.includes('download: (label) => this.downloadPhase6ValidationReport(label)'),
    'Missing phase6 download() helper mapping',
);
assert(
    themeSource.includes('shotReview: () => this.getPhase6ShotReviewSignals()'),
    'Missing phase6 shotReview() helper mapping',
);
assert(
    themeSource.includes('cameraPaths: () => this.getPhase6CameraPathBookmarks()'),
    'Missing phase6 cameraPaths() helper mapping',
);
console.log('  ✓ PASS');

console.log('\nTest 2: Visual gate checks enforce Phase 6 integrated review criteria');
assert(
    themeSource.includes('6 cinematic camera paths validated against look bible'),
    'Phase 6 visual gate should include camera path validation criterion',
);
assert(
    themeSource.includes('No style drift between shots'),
    'Phase 6 visual gate should include style drift criterion',
);
assert(themeSource.includes('cameraPathCoverage'), 'Phase 6 visual gate should track path coverage check');
assert(themeSource.includes('styleDriftControlled'), 'Phase 6 visual gate should track style drift control check');
assert(themeSource.includes('depthBandReadability'), 'Phase 6 visual gate should track depth-band readability check');
assert(themeSource.includes('crossShotContinuity'), 'Phase 6 visual gate should track cross-shot continuity check');
console.log('  ✓ PASS');

console.log('\nTest 3: Performance gate defaults align to sustained 60fps target');
assert(
    themeSource.includes('targetFps = Number.isFinite(options.targetFps) ? Math.max(24, options.targetFps) : 60'),
    'Phase 6 performance gate should default to 60fps target',
);
assert(
    themeSource.includes("gate: 'Phase 6 performance gate'"),
    'Phase 6 performance gate label missing',
);
assert(
    themeSource.includes("deliverable: 'Integrated shot review'"),
    'Phase 6 validation deliverable label missing',
);
console.log('  ✓ PASS');

console.log('\nTest 4: Browser harness wires the Phase 6 helper commands');
assert(harnessSource.includes('Sky Children Phase 6 Integrated Shot Review Harness'), 'Missing Phase 6 harness title');
assert(harnessSource.includes('Run Integrated Visual Gate'), 'Harness missing Phase 6 visual gate control');
assert(harnessSource.includes('Run Sustained Perf Gate'), 'Harness missing Phase 6 performance gate control');
assert(harnessSource.includes('Run Full Phase 6 Validation'), 'Harness missing Phase 6 validation control');
assert(harnessSource.includes('helper.cameraPaths()'), 'Harness should invoke Phase 6 cameraPaths helper');
assert(harnessSource.includes('helper.shotReview()'), 'Harness should invoke Phase 6 shotReview helper');
assert(harnessSource.includes('helper.visualGate()'), 'Harness should invoke Phase 6 visualGate helper');
assert(
    harnessSource.includes('helper.perfGate({') || harnessSource.includes('helper.perfGate(perfConfig('),
    'Harness should invoke Phase 6 perfGate helper',
);
assert(harnessSource.includes('helper.validate({'), 'Harness should invoke Phase 6 validate helper');
assert(harnessSource.includes('helper.download('), 'Harness should invoke Phase 6 download helper');
assert(harnessSource.includes('helper.setResolutionLock(1920, 1080)'), 'Harness should invoke Phase 6 resolution lock helper');
console.log('  ✓ PASS');

console.log('\n=== Sky Children Phase 6 Validation Gate Tests Passed ===');

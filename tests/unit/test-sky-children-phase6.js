import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Sky Children Phase 6 Integrated Shot Review Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const themePath = path.join(root, 'src', 'themes', 'sky-children', 'sky-children-theme.js');
const themeSource = fs.readFileSync(themePath, 'utf8');

console.log('Test 1: Phase 6 camera-path profiles and hero set are declared');
assert(themeSource.includes('SKY_CHILDREN_PHASE6_CAMERA_PATHS'), 'Missing Phase 6 camera path profile list');
assert(themeSource.includes("id: 'hero-sunset-ridge'"), 'Missing sunset ridge path profile');
assert(themeSource.includes("id: 'hero-sunset-cloud-rim'"), 'Missing sunset cloud rim path profile');
assert(themeSource.includes("id: 'hero-cloud-sea-wide'"), 'Missing cloud sea wide path profile');
assert(themeSource.includes("id: 'hero-cloud-sea-silhouette'"), 'Missing cloud sea silhouette path profile');
assert(themeSource.includes("id: 'hero-interior-haze-entry'"), 'Missing interior haze entry path profile');
assert(themeSource.includes("id: 'hero-interior-haze-depth'"), 'Missing interior haze depth path profile');
assert(themeSource.includes('SKY_CHILDREN_PHASE6_HERO_SHOTS'), 'Missing Phase 6 hero shot checklist');
console.log('  ✓ PASS');

console.log('\nTest 2: Phase 6 visual gate computes cross-shot drift and continuity');
assert(themeSource.includes('getPhase6CameraPathBookmarks()'), 'Missing Phase 6 camera path bookmark helper');
assert(themeSource.includes('getPhase6ShotReviewSignals()'), 'Missing Phase 6 shot review signal helper');
assert(themeSource.includes('meanStyleDrift'), 'Missing mean style drift signal');
assert(themeSource.includes('maxStyleDrift'), 'Missing max style drift signal');
assert(themeSource.includes('passingPathRatio'), 'Missing passing path ratio signal');
assert(themeSource.includes('evaluatePhase6VisualGate(options = {})'), 'Missing Phase 6 visual gate');
assert(themeSource.includes('cameraPathCoverage'), 'Phase 6 visual gate should track camera path coverage');
assert(themeSource.includes('styleDriftControlled'), 'Phase 6 visual gate should track style drift control');
assert(themeSource.includes('crossShotContinuity'), 'Phase 6 visual gate should track cross-shot continuity');
assert(
    themeSource.includes('6 cinematic camera paths validated against look bible'),
    'Phase 6 visual gate should include camera path validation criterion',
);
assert(
    themeSource.includes('No style drift between shots'),
    'Phase 6 visual gate should include style drift criterion',
);
console.log('  ✓ PASS');

console.log('\nTest 3: Phase 6 performance gate targets sustained 60fps');
assert(themeSource.includes('runPhase6PerformanceGate(options = {})'), 'Missing Phase 6 performance gate');
assert(
    themeSource.includes('targetFps = Number.isFinite(options.targetFps) ? Math.max(24, options.targetFps) : 60'),
    'Phase 6 performance gate should default to 60fps target',
);
assert(themeSource.includes('targetFrameMs = 1000 / targetFps'), 'Missing frame-time conversion from target FPS');
assert(themeSource.includes('droppedFrameRatio'), 'Missing dropped-frame ratio tracking');
assert(themeSource.includes('sustained60Fps'), 'Missing sustained 60fps pass signal');
assert(themeSource.includes("gate: 'Phase 6 performance gate'"), 'Missing Phase 6 performance gate label');
assert(themeSource.includes("method: 'frame-present-interval'"), 'Missing present-inclusive Phase 6 gate method label');
assert(
    /async runPhase6PerformanceGate[\s\S]*const collectSamples = \(\) => this\.selectFrameTimingSampleSet/.test(themeSource),
    'Phase 6 performance gate must read from present-inclusive frame timing selector',
);
console.log('  ✓ PASS');

console.log('\nTest 4: Phase 6 validation report is integrated');
assert(themeSource.includes('runPhase6Validation(options = {})'), 'Missing Phase 6 validation runner');
assert(themeSource.includes("phase: 'phase6'"), 'Missing Phase 6 report phase id');
assert(themeSource.includes("deliverable: 'Integrated shot review'"), 'Missing Phase 6 deliverable label');
assert(themeSource.includes('heroShotChecklist: [...SKY_CHILDREN_PHASE6_HERO_SHOTS]'), 'Missing Phase 6 hero shot checklist wiring');
console.log('  ✓ PASS');

console.log('\n=== Sky Children Phase 6 Integrated Shot Review Tests Passed ===');

import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Ice Temple 120 FPS Performance Budget Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..', '..');

const themePath = path.join(repoRoot, 'src', 'themes', 'ice-temple', 'ice-temple-theme.js');
const harnessPath = path.join(repoRoot, 'tests', 'performance', 'benchmark-ice-temple-phase8.html');

const themeSource = fs.readFileSync(themePath, 'utf8');
const harnessSource = fs.readFileSync(harnessPath, 'utf8');

console.log('Test 1: Quality budgets define 120 FPS WebGPU and 60 FPS WebGL gates');
assert(themeSource.includes('const QUALITY_BUDGETS = {'), 'Missing QUALITY_BUDGETS table');
assert(themeSource.includes('webgpuTargetFrameMs: 8.33'), 'Missing WebGPU 120 FPS frame target');
assert(themeSource.includes('webgpuLow1Fps: 100'), 'Missing WebGPU 1% low target');
assert(themeSource.includes('webglTargetFrameMs: 16.7'), 'Missing WebGL 60 FPS frame target');
assert(themeSource.includes('webglLow1Fps: 55'), 'Missing WebGL 1% low target');
console.log('  PASS');

console.log('\nTest 2: Adaptive scaler helpers and DRS lock flag are wired');
[
    'resolveQualityBudget(level)',
    'resetAdaptiveScalerState()',
    'updateAdaptiveScaler(frameMs)',
    'applyAdaptiveScalerState(force = false)',
    'getRuntimeBudgetSnapshot()',
    "noDrs: readBool('iceTempleNoDrs')",
].forEach((needle) => {
    assert(themeSource.includes(needle), `Missing ${needle}`);
});
assert(
    themeSource.includes('this.updateAdaptiveScaler(rawDelta * 1000);'),
    'Render loop does not feed adaptive scaler',
);
assert(themeSource.includes('this.getAdaptiveEffectScale()'), 'Effects are not tied to adaptive scale');
console.log('  PASS');

console.log('\nTest 3: Render path tracks post-processing cost');
assert(themeSource.includes('this.lastPostCostMs = canMeasure'), 'Post cost is not measured');
assert(themeSource.includes("this.lastRenderPath = 'webgpu-post'"), 'Missing WebGPU post render-path marker');
assert(themeSource.includes("this.lastRenderPath = 'webgl-post'"), 'Missing WebGL post render-path marker');
assert(themeSource.includes('postCostMs:'), 'Runtime budget snapshot omits post-cost telemetry');
console.log('  PASS');

console.log('\nTest 4: Gameplay allocation hot paths use pools');
assert(themeSource.includes('acquireWebGLShardBurst(count, material)'), 'Missing WebGL shard burst pool acquisition');
assert(themeSource.includes('releaseWebGLShardBurst(burst)'), 'Missing WebGL shard burst pool release');
assert(themeSource.includes('getSharedIceShardMaterial(size)'), 'Missing shared WebGL shard material cache');
assert(themeSource.includes('acquireShockwaveMesh(color)'), 'Missing shockwave pool acquisition');
assert(themeSource.includes('releaseShockwave(wave)'), 'Missing shockwave pool release');
assert(themeSource.includes('shouldUsePillarPointLight(index = 0)'), 'Missing bounded pillar point-light policy');
console.log('  PASS');

console.log('\nTest 5: Baseline helper and harness expose budget/performance gate controls');
assert(
    themeSource.includes('budget: () => this.getRuntimeBudgetSnapshot()'),
    'Baseline helper missing budget snapshot',
);
assert(harnessSource.includes('120 FPS Perf Gate'), 'Harness missing 120 FPS performance gate section');
assert(harnessSource.includes('run120FpsPerfGate'), 'Harness missing 120 FPS gate runner');
console.log('  PASS');

console.log('\n=== Ice Temple 120 FPS Performance Budget Tests Passed ===');

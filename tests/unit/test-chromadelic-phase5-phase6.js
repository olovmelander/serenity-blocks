import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Chromadelic Phase 5/6 Continuation Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const themePath = path.join(
    __dirname,
    '..',
    '..',
    'src',
    'themes',
    'chromadelic-highway',
    'chromadelic-highway-theme.js',
);
const themeSource = fs.readFileSync(themePath, 'utf8');

console.log('Test 1: Per-tier hard budgets are defined for draw calls, particles, and post cost');
assert(themeSource.includes('const QUALITY_BUDGETS = {'), 'Missing QUALITY_BUDGETS definition');
assert(themeSource.includes('maxDrawCalls'), 'Missing draw-call budget field');
assert(themeSource.includes('maxPostCostMs'), 'Missing post-cost budget field');
assert(themeSource.includes('maxSpeedParticles'), 'Missing speed particle budget field');
assert(themeSource.includes('maxAmbientParticles'), 'Missing ambient particle budget field');
console.log('  PASS');

console.log('\nTest 2: Quality preset application binds budget profile and adaptive scaler state');
assert(themeSource.includes('resolveQualityBudget(quality)'), 'Missing resolveQualityBudget helper');
assert(themeSource.includes('this.performanceBudget = this.resolveQualityBudget(normalized);'), 'Missing budget binding in applyQualityPreset');
assert(themeSource.includes('this.resetAdaptiveScalerState();'), 'Missing adaptive state reset on quality apply');
console.log('  PASS');

console.log('\nTest 3: Adaptive scaler updates from smoothed frame timing in main loop');
assert(themeSource.includes('updateAdaptiveScaler(frameMs)'), 'Missing updateAdaptiveScaler helper');
assert(themeSource.includes('state.frameTimeEmaMs = state.frameTimeEmaMs * 0.92 + frameMs * 0.08;'), 'Missing frame-time EMA smoothing');
assert(themeSource.includes('this.updateAdaptiveScaler(rawDelta * 1000);'), 'Animation loop does not feed adaptive scaler');
console.log('  PASS');

console.log('\nTest 4: compileAsync prewarm now uses timeout safeguards');
assert(themeSource.includes('async precompileSceneWithTimeout()'), 'Missing precompileSceneWithTimeout helper');
assert(themeSource.includes('Promise.race(['), 'Missing Promise.race timeout guard');
assert(themeSource.includes('compileAsync timeout'), 'Missing compile timeout error path');
assert(themeSource.includes('await this.precompileSceneWithTimeout();'), 'createScene does not invoke timeout-guarded precompile');
console.log('  PASS');

console.log('\nTest 5: Under-road glow is budget-gated and readability-aware');
assert(themeSource.includes('createUnderRoadGlow()'), 'Missing createUnderRoadGlow helper');
assert(themeSource.includes('if (!this.performanceBudget?.allowUnderRoadGlow) return;'), 'Under-road glow not budget gated');
assert(themeSource.includes('updateUnderRoadGlow()'), 'Missing updateUnderRoadGlow helper');
assert(themeSource.includes('1.0 - (this.bloomBoost * 0.85 + this.ringGlow * 0.35)'), 'Under-road glow readability gate missing');
console.log('  PASS');

console.log('\nTest 6: Celestial staging keeps primary corridor and restrained secondary motion');
assert(themeSource.includes('this.celestialCorridor = {'), 'Missing celestial corridor definition');
assert(themeSource.includes('this.planet.position.copy(this.planetStartPos);'), 'Primary planet no longer starts on corridor anchor');
assert(themeSource.includes('this.crystalMoon.userData.orbitSpeed = 0.052;'), 'Crystal moon orbit was not slowed');
assert(themeSource.includes('this.neonGasGiant.userData.basePosition = this.neonGasGiant.position.clone();'), 'Secondary gas giant staging metadata missing');
console.log('  PASS');

console.log('\n=== Chromadelic Phase 5/6 Continuation Tests Passed ===');

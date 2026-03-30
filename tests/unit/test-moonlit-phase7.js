import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Moonlit Forest Phase 7 Quality Budget Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const themePath = path.join(__dirname, '..', '..', 'src', 'themes', 'moonlit-forest', 'moonlit-forest-theme.js');
const themeSource = fs.readFileSync(themePath, 'utf8');

console.log('Test 1: Quality config includes explicit post profiles and GPU budget tables');
assert(themeSource.includes('const postProfiles = {'), 'Missing postProfiles table');
assert(themeSource.includes('const gpuBudgets = {'), 'Missing gpuBudgets table');
assert(themeSource.includes('configs[tier].post = postProfiles[tier];'), 'Quality presets not wired to post profiles');
assert(themeSource.includes('configs[tier].gpuBudget = gpuBudgets[tier];'), 'Quality presets not wired to gpu budgets');
console.log('  ✓ PASS');

console.log('\nTest 2: Adaptive budget controller methods exist');
assert(themeSource.includes('resolveGpuBudget(config = this.qualityConfig)'), 'Missing resolveGpuBudget method');
assert(themeSource.includes('initializeAdaptiveBudgetState()'), 'Missing initializeAdaptiveBudgetState method');
assert(themeSource.includes('applyAdaptiveBudgetState()'), 'Missing applyAdaptiveBudgetState method');
assert(themeSource.includes('updateAdaptiveBudgets(frameMs)'), 'Missing updateAdaptiveBudgets method');
assert(themeSource.includes('scaleBurstCount(count)'), 'Missing burst count scaler');
assert(themeSource.includes('scaleBurstStrength(strength)'), 'Missing burst strength scaler');
console.log('  ✓ PASS');

console.log('\nTest 3: Frame loop applies adaptive updates and emission scaling');
assert(themeSource.includes('this.updateAdaptiveBudgets(frameMs);'), 'Render loop does not update adaptive budgets');
assert(themeSource.includes('const fireflies = this.scaleBurstCount(bursts.fireflies);'), 'Burst queue is not emission-scaled');
assert(themeSource.includes('const auroraStrength = this.scaleBurstStrength(bursts.auroraStrength);'), 'Aurora bursts are not quality-scaled');
console.log('  ✓ PASS');

console.log('\nTest 4: Live quality preset switching during runtime is supported');
assert(themeSource.includes('this.activeQualityLevel ='), 'Missing active quality state tracking');
assert(themeSource.includes('this.qualityCheckAccumulator ='), 'Missing quality transition timer state');
assert(themeSource.includes('requestQualityTransition(nextQuality)'), 'Missing quality transition request handler');
assert(themeSource.includes('maybeHandleQualityTransition(delta)'), 'Missing quality transition polling handler');
assert(themeSource.includes('if (this.maybeHandleQualityTransition(delta)) {'), 'Render loop does not gate on quality transition checks');
console.log('  ✓ PASS');

console.log('\n=== All Moonlit Forest Phase 7 Tests Passed ===');

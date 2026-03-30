import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Black Hole Burst Accumulation Wiring Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const computePath = path.join(__dirname, '..', '..', 'src', 'themes', 'black-hole', 'black-hole-compute.js');
const materialsPath = path.join(__dirname, '..', '..', 'src', 'themes', 'black-hole', 'black-hole-materials.js');
const themePath = path.join(__dirname, '..', '..', 'src', 'themes', 'black-hole', 'black-hole-theme.js');

const computeSource = fs.readFileSync(computePath, 'utf8');
const materialsSource = fs.readFileSync(materialsPath, 'utf8');
const themeSource = fs.readFileSync(themePath, 'utf8');

console.log('Test 1: Burst compute API migrated to activateParticles(requestedCount, now, seed)');
assert(computeSource.includes('activateParticles(requestedCount, now = this.currentTime, seed = 0)'), 'Missing activateParticles API');
assert(computeSource.includes('return {\n            activated,'), 'activateParticles should return activation stats');
console.log('  ✓ PASS');

console.log('\nTest 2: Runtime activation path updates misc/position only (no life/angle buffer uploads)');
const activateStart = computeSource.indexOf('activateParticles(requestedCount, now = this.currentTime, seed = 0)');
const activateEnd = computeSource.indexOf('getPositionBuffer()', activateStart);
assert(activateStart >= 0 && activateEnd > activateStart, 'Unable to isolate activateParticles block');
const activateBlock = computeSource.slice(activateStart, activateEnd);
assert(!activateBlock.includes('this.lifeBuffer.needsUpdate = true;'), 'activateParticles should not flag lifeBuffer.needsUpdate');
assert(!activateBlock.includes('this.angleBuffer.needsUpdate = true;'), 'activateParticles should not flag angleBuffer.needsUpdate');
assert(activateBlock.includes('this.miscBuffer.needsUpdate = true;'), 'activateParticles should flag miscBuffer.needsUpdate');
console.log('  ✓ PASS');

console.log('\nTest 3: Burst lifecycle is derived from spawnTime (misc.w) and writes active to position.w');
assert(computeSource.includes('const spawnTime = misc.w;'), 'Compute node missing spawnTime source');
assert(computeSource.includes('const age = time.sub(spawnTime);'), 'Compute node missing age calculation');
assert(computeSource.includes('const active = hasSpawned.mul(step(age, float(20.0)));'), 'Compute node missing age-based active gate');
assert(computeSource.includes('life.x.assign(mix(float(0.0), lifeClamped, active));'), 'Compute node missing time-derived life assignment');
assert(computeSource.includes('pos.w.assign(1.0);'), 'Compute node missing active visibility write');
assert(computeSource.includes('pos.w.assign(0.0);'), 'Compute node missing inactive visibility write');
assert(computeSource.includes('hasActiveParticles(now = this.currentTime)'), 'Compute class missing active-particle signal helper');
console.log('  ✓ PASS');

console.log('\nTest 4: Burst spark material gates visibility/alpha by positionBuffer.w (not angle.w)');
assert(materialsSource.includes('const activeNode = positionBuffer.element(instanceIndex).w;'), 'GPU position gating should use positionBuffer.w');
assert(materialsSource.includes('return positionBuffer.element(instanceIndex).w;'), 'GPU activeValue should use positionBuffer.w');
console.log('  ✓ PASS');

console.log('\nTest 5: Theme implements multi-bank burst capacity + overflow queue with 4x cap');
assert(themeSource.includes('this.burstComputeBanks = [];'), 'Missing burstComputeBanks runtime state');
assert(themeSource.includes('this.burstSparkBanks = [];'), 'Missing burstSparkBanks runtime state');
assert(themeSource.includes('this.burstCapacityBase = 0;'), 'Missing burstCapacityBase runtime state');
assert(themeSource.includes('this.burstCapacityMax = 0;'), 'Missing burstCapacityMax runtime state');
assert(themeSource.includes('this.burstRequestQueue = [];'), 'Missing burstRequestQueue runtime state');
assert(themeSource.includes('this.nextBurstBankIndex = 0;'), 'Missing nextBurstBankIndex runtime state');
assert(themeSource.includes('createBurstComputeBank(count, colorOptions = null)'), 'Missing createBurstComputeBank helper');
assert(themeSource.includes('ensureBurstCapacityFor(neededCount)'), 'Missing ensureBurstCapacityFor helper');
assert(themeSource.includes('emitBurstParticles(requestedCount, seed = 0, queueOnOverflow = true)'), 'Missing emitBurstParticles helper');
assert(themeSource.includes('drainBurstRequestQueue()'), 'Missing drainBurstRequestQueue helper');
assert(themeSource.includes('this.burstCapacityMax = count * 4;'), 'Burst max capacity should be 4x preset base');
assert(themeSource.includes('this.pendingBurstPoolTriggers += shortfall;'), 'Fallback pool saturation should queue without dropping');
assert(themeSource.includes('this.drainBurstRequestQueue();'), 'Animation loop should drain queued compute burst requests');
assert(themeSource.includes('compute?.hasActiveParticles?.(this.time)'), 'Burst compute run-gate should include active-particle signal');
console.log('  ✓ PASS');

console.log('\nAll Black Hole burst accumulation wiring checks passed.');

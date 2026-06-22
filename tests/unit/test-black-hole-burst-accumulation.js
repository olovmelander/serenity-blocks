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
assert(
    /return\s*{\s*activated,\s*remaining:\s*Math\.max\(0,\s*targetBatch - activated\),\s*}/m.test(computeSource),
    'activateParticles should return activation stats',
);
console.log('  PASS');

console.log('\nTest 2: Runtime activation path updates misc/position only (no life/angle buffer uploads)');
const activateStart = computeSource.indexOf('activateParticles(requestedCount, now = this.currentTime, seed = 0)');
const activateEnd = computeSource.indexOf('getPositionBuffer()', activateStart);
assert(activateStart >= 0 && activateEnd > activateStart, 'Unable to isolate activateParticles block');
const activateBlock = computeSource.slice(activateStart, activateEnd);
assert(!activateBlock.includes('this.lifeBuffer.needsUpdate = true;'), 'activateParticles should not flag lifeBuffer.needsUpdate');
assert(!activateBlock.includes('this.angleBuffer.needsUpdate = true;'), 'activateParticles should not flag angleBuffer.needsUpdate');
assert(activateBlock.includes('this.miscBuffer.needsUpdate = true;'), 'activateParticles should flag miscBuffer.needsUpdate');
console.log('  PASS');

console.log('\nTest 3: Burst lifecycle is tierable, derived from spawnTime (misc.w), and writes active to position.w');
assert(computeSource.includes('constructor(particleCount, options = {})'), 'Burst compute constructor should accept options');
assert(computeSource.includes('this.burstLifetimeSeconds = Math.max(6, Number(options.lifetimeSeconds) || 12.0);'), 'Burst lifetime should be configurable with a safe floor');
assert(computeSource.includes('const spawnTime = misc.w;'), 'Compute node missing spawnTime source');
assert(computeSource.includes('const age = time.sub(spawnTime);'), 'Compute node missing age calculation');
assert(computeSource.includes('const lifetime = float(this.burstLifetimeSeconds);'), 'Compute node missing lifetime literal');
assert(computeSource.includes('const active = hasSpawned.mul(step(age, lifetime));'), 'Compute node missing lifetime-based active gate');
assert(computeSource.includes('const lifeClamped = clamp(age.div(lifetime), float(0.0), float(1.0));'), 'Compute node missing lifetime-normalized life');
assert(computeSource.includes('life.x.assign(mix(float(0.0), lifeClamped, active));'), 'Compute node missing time-derived life assignment');
assert(computeSource.includes('pos.w.assign(1.0);'), 'Compute node missing active visibility write');
assert(computeSource.includes('pos.w.assign(0.0);'), 'Compute node missing inactive visibility write');
assert(computeSource.includes('hasActiveParticles(now = this.currentTime)'), 'Compute class missing active-particle signal helper');
console.log('  PASS');

console.log('\nTest 4: Burst spark material gates visibility/alpha by positionBuffer.w (not angle.w)');
assert(materialsSource.includes('const activeNode = positionBuffer.element(instanceIndex).w;'), 'GPU position gating should use positionBuffer.w');
assert(materialsSource.includes('return positionBuffer.element(instanceIndex).w;'), 'GPU activeValue should use positionBuffer.w');
console.log('  PASS');

console.log('\nTest 5: Theme implements bounded multi-bank burst capacity + overflow queue');
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
assert(themeSource.includes('this.qualityPreset.burstCapacityMultiplier ?? 1.25'), 'Burst max capacity should be quality-tier bounded');
assert(themeSource.includes('this.pendingBurstPoolTriggers += shortfall;'), 'Fallback pool saturation should queue without dropping');
assert(themeSource.includes('this.drainBurstRequestQueue();'), 'Animation loop should drain queued compute burst requests');
assert(themeSource.includes('burstCompute.hasActiveParticles?.(this.time)'), 'Burst compute run-gate should include active-particle signal');
assert(themeSource.includes('if (!burstCompute.hasActiveParticles?.(this.time)) continue;'), 'Animation loop should skip inactive burst banks');
console.log('  PASS');

console.log('\nTest 6: High profile carries the fast-path trims');
assert(themeSource.includes('High: {'), 'Missing High quality preset');
assert(themeSource.includes('enableVolumetricDisk: false,'), 'High should use layered disk instead of volumetric raymarch');
assert(themeSource.includes('enableChromatic: false,'), 'High should suppress chromatic aberration');
assert(themeSource.includes('maxPixelRatio: 1.0,'), 'High should cap device pixel ratio for fill-rate control');
assert(themeSource.includes('bloomDownsample: 0.44,'), 'High should use a cheaper bloom resolution');
assert(themeSource.includes('bloomMinDownsample: 0.34,'), 'High should allow adaptive bloom to downshift under pressure');
assert(themeSource.includes('burstCapacityMultiplier: 1,'), 'High should avoid extra preallocated burst banks');
assert(themeSource.includes('particleComputeInterval: 1 / 30,'), 'High should throttle idle particle compute');
assert(themeSource.includes('hawkingUpdateInterval: 1 / 24,'), 'High should throttle idle Hawking updates');
assert(themeSource.includes('layeredDiskCount: 1,'), 'High should use one cheap glow layer plus the base disk');
assert(themeSource.includes('sortObjects: false,'), 'High should rely on explicit render ordering');
console.log('  PASS');

console.log('\nAll Black Hole burst accumulation/performance wiring checks passed.');

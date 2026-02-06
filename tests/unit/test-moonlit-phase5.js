import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Moonlit Forest Phase 5 Compute Path Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const computePath = path.join(root, 'src', 'themes', 'moonlit-forest', 'moonlit-forest-compute.js');
const particlesPath = path.join(root, 'src', 'themes', 'moonlit-forest', 'moonlit-forest-particles.js');
const materialsPath = path.join(root, 'src', 'themes', 'moonlit-forest', 'moonlit-forest-materials.js');
const themePath = path.join(root, 'src', 'themes', 'moonlit-forest', 'moonlit-forest-theme.js');

const computeSource = fs.readFileSync(computePath, 'utf8');
const particlesSource = fs.readFileSync(particlesPath, 'utf8');
const materialsSource = fs.readFileSync(materialsPath, 'utf8');
const themeSource = fs.readFileSync(themePath, 'utf8');

console.log('Test 1: Dedicated Moonlit compute module exists for ambient simulation');
assert(computeSource.includes('export class MoonlitAmbientFireflyCompute'), 'Missing MoonlitAmbientFireflyCompute export');
assert(computeSource.includes('this.positionBuffer = new THREE.StorageBufferAttribute'), 'Compute module missing storage position buffer');
assert(computeSource.includes('createComputeNode()'), 'Compute module missing createComputeNode');
assert(computeSource.includes('this.computeNode = computeFireflies().compute(this.count);'), 'Compute node is not generated for ambient fireflies');
console.log('  ✓ PASS');

console.log('\nTest 2: Materials expose compute-aware ambient firefly node material');
assert(materialsSource.includes('export function createMoonlitAmbientFireflyNodeMaterial'), 'Missing ambient firefly node material factory');
assert(materialsSource.includes('storage(fireflyCompute.getPositionBuffer()'), 'Ambient material missing compute position storage wiring');
assert(materialsSource.includes('storage(fireflyCompute.getMiscBuffer()'), 'Ambient material missing compute misc storage wiring');
console.log('  ✓ PASS');

console.log('\nTest 3: Particle system initializes and updates compute ambient field when available');
assert(particlesSource.includes("import { MoonlitAmbientFireflyCompute } from './moonlit-forest-compute.js';"), 'Particles do not import Moonlit compute module');
assert(particlesSource.includes('createAmbientFireflyField(budgets)'), 'Particles missing compute ambient field initializer');
assert(particlesSource.includes('this.renderer.compute(this.ambientField.compute.computeNode);'), 'Particles do not dispatch compute work to renderer');
assert(particlesSource.includes('usesComputeAmbientField()'), 'Particles missing compute ambient capability probe');
console.log('  ✓ PASS');

console.log('\nTest 4: Theme passes compute capabilities into particle system and avoids legacy ambient timeout churn in compute mode');
assert(themeSource.includes('useCompute: this.flags.useCompute,'), 'Theme does not pass compute flag to Moonlit particles');
assert(themeSource.includes('renderer: this.renderer,'), 'Theme does not pass renderer to Moonlit particles');
assert(themeSource.includes('isWebGPU: this.isWebGPU,'), 'Theme does not pass backend mode to Moonlit particles');
assert(themeSource.includes('!this.particleSystem?.usesComputeAmbientField?.()'), 'Theme still schedules ambient timeout churn when compute ambient field is active');
console.log('  ✓ PASS');

console.log('\n=== All Moonlit Forest Phase 5 Tests Passed ===');

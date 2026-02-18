import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Nimbus Veil Phase 5 Compute-Driven Spirit Swarms Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const themePath = path.join(root, 'src', 'themes', 'nimbus-veil', 'nimbus-veil-theme.js');
const materialsPath = path.join(root, 'src', 'themes', 'nimbus-veil', 'nimbus-veil-materials.js');
const computePath = path.join(root, 'src', 'themes', 'nimbus-veil', 'nimbus-veil-compute.js');
const planPath = path.join(root, 'docs', 'NIMBUS_VEIL_WEBGPU_UPGRADE_PLAN.md');
const artPath = path.join(root, 'docs', 'NIMBUS_VEIL_ART_DIRECTION.md');

const themeSource = fs.readFileSync(themePath, 'utf8');
const materialsSource = fs.readFileSync(materialsPath, 'utf8');
const computeSource = fs.readFileSync(computePath, 'utf8');
const planSource = fs.readFileSync(planPath, 'utf8');
const artSource = fs.readFileSync(artPath, 'utf8');

console.log('Test 1: Phase 5 compute module defines budgets and layout contracts');
assert(computeSource.includes('NIMBUS_SPIRIT_COMPUTE_BUDGETS'), 'Missing Phase 5 compute budget table');
assert(computeSource.includes('spiritCount: 60000'), 'High spirit budget target is missing');
assert(computeSource.includes('spiritCount: 90000'), 'Ultra spirit budget target is missing');
assert(computeSource.includes('NIMBUS_SPIRIT_COMPUTE_LAYOUT'), 'Missing compute layout contract');
assert(computeSource.includes('vec4-packed (16-byte aligned)'), 'Missing 16-byte alignment contract note');
console.log('  ✓ PASS');

console.log('\nTest 2: Compute module uses aligned storage buffers with ping-pong flow');
assert(computeSource.includes('createNimbusAlignedStorageBuffer('), 'Missing aligned storage buffer helper');
assert(computeSource.includes('new THREE_WEBGPU.StorageBufferAttribute(data, 4);'), 'Storage buffers must be vec4 aligned');
assert(computeSource.includes('this.positionBuffers = ['), 'Missing position ping-pong buffers');
assert(computeSource.includes('this.velocityBuffers = ['), 'Missing velocity ping-pong buffers');
assert(computeSource.includes('this.computeNodes = ['), 'Missing dual compute node ping-pong dispatch');
assert(computeSource.includes('getDisplayBufferIndexUniform()'), 'Missing display buffer index uniform accessor');
console.log('  ✓ PASS');

console.log('\nTest 3: Compute kernel includes advection, cohesion, and gameplay burst influence');
assert(computeSource.includes('this.uAdvection = uniform('), 'Missing advection uniform');
assert(computeSource.includes('this.uCohesionCenter = uniform('), 'Missing cohesion center uniform');
assert(computeSource.includes('this.uBurst = uniform('), 'Missing gameplay burst uniform');
assert(computeSource.includes('const flowForce ='), 'Missing flow force kernel term');
assert(computeSource.includes('const cohesionForce ='), 'Missing cohesion force kernel term');
assert(computeSource.includes('const burstForce ='), 'Missing gameplay burst force kernel term');
assert(computeSource.includes('queueInfluence(params = {})'), 'Missing gameplay influence queue API');
console.log('  ✓ PASS');

console.log('\nTest 4: Materials module exposes WebGPU spirit swarm instanced billboard material');
assert(materialsSource.includes('createNimbusSpiritSwarmNodeMaterial'), 'Missing spirit swarm node material factory');
assert(materialsSource.includes('createNimbusSpiritSwarmMaterial'), 'Missing spirit swarm public material factory');
assert(materialsSource.includes("'spirit-swarm'"), 'Missing spirit-swarm material type metadata');
assert(materialsSource.includes('spiritCompute?.getPositionBuffer'), 'Spirit material missing compute position storage hook');
assert(materialsSource.includes('storage(params.spiritCompute.getFlowBuffer()'), 'Spirit material missing compute flow storage hook');
assert(materialsSource.includes('instancedQuads: true'), 'Spirit material must declare instanced quad metadata');
console.log('  ✓ PASS');

console.log('\nTest 5: Theme integrates compute bootstrap, dispatch, and fallback ladder');
assert(themeSource.includes("from './nimbus-veil-compute.js';"), 'Theme missing Phase 5 compute module import');
assert(themeSource.includes('this.createSpiritSwarm();'), 'Scene bootstrap should create spirit swarm path');
assert(themeSource.includes('createSpiritSwarm() {'), 'Missing spirit swarm bootstrap helper');
assert(themeSource.includes('createComputeSpiritSwarm() {'), 'Missing compute spirit swarm creation helper');
assert(themeSource.includes('updateSpiritSwarm(delta)'), 'Animation loop missing spirit swarm updater');
assert(themeSource.includes('triggerSpiritSwarmInfluence(kind, strength = 1.0)'), 'Missing gameplay influence bridge');
assert(themeSource.includes('this.createDustParticles();'), 'Missing CPU dust fallback path');
assert(themeSource.includes("this.requestRuntimeRebuild('no-compute', 'phase5-spirit-compute-dispatch-failed', error)"), 'Missing runtime compute failure rebuild fallback');
assert(themeSource.includes('phase5SpiritState: () => this.getPhase5SpiritRuntimeState(),'), 'Baseline API missing phase5 spirit state helper');
assert(themeSource.includes('phase5SpiritValidate: (options = {}) => this.runPhase5SpiritValidation(options),'), 'Baseline API missing phase5 validation helper');
console.log('  ✓ PASS');

console.log('\nTest 6: Plan and art packet include Phase 5 completion evidence and guardrails');
assert(planSource.includes('## Phase 5: Compute-Driven Spirit Swarms (Critical)'), 'Plan missing Phase 5 section');
assert(planSource.includes('- [x] Implement aligned storage buffers and ping-pong update flow.'), 'Plan should mark ping-pong task complete');
assert(planSource.includes('- [x] Add advection/cohesion/gameplay influence kernels.'), 'Plan should mark kernel task complete');
assert(planSource.includes('- [x] Render spirits via instanced billboards from GPU data.'), 'Plan should mark instanced billboard task complete');
assert(planSource.includes('- [x] Add robust fallback path when compute init fails.'), 'Plan should mark fallback task complete');
assert(planSource.includes('src/themes/nimbus-veil/nimbus-veil-compute.js'), 'Plan evidence missing compute module reference');
assert(planSource.includes('tests/unit/test-nimbus-veil-phase5.js'), 'Plan evidence missing Phase 5 unit coverage reference');
assert(artSource.includes('## Phase 5 Spirit Swarm Guardrails'), 'Art packet missing Phase 5 guardrail section');
assert(artSource.includes('coherent wind currents'), 'Art packet missing coherent spirit flow guardrail');
console.log('  ✓ PASS');

console.log('\n=== All Nimbus Veil Phase 5 Tests Passed ===');

import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Nimbus Veil Phase 3 TSL Material Migration Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const themePath = path.join(root, 'src', 'themes', 'nimbus-veil', 'nimbus-veil-theme.js');
const materialsPath = path.join(root, 'src', 'themes', 'nimbus-veil', 'nimbus-veil-materials.js');
const planPath = path.join(root, 'docs', 'NIMBUS_VEIL_WEBGPU_UPGRADE_PLAN.md');
const artPath = path.join(root, 'docs', 'NIMBUS_VEIL_ART_DIRECTION.md');
const harnessPath = path.join(root, 'tests', 'performance', 'benchmark-nimbus-veil-phase3.html');

const themeSource = fs.readFileSync(themePath, 'utf8');
const materialsSource = fs.readFileSync(materialsPath, 'utf8');
const planSource = fs.readFileSync(planPath, 'utf8');
const artSource = fs.readFileSync(artPath, 'utf8');
const harnessSource = fs.readFileSync(harnessPath, 'utf8');

console.log('Test 1: Materials module includes WebGPU node-material + TSL imports');
assert(materialsSource.includes("from 'three/webgpu';"), 'Missing three/webgpu node material import');
assert(materialsSource.includes("from 'three/tsl';"), 'Missing three/tsl import');
assert(materialsSource.includes('PointsNodeMaterial'), 'Missing PointsNodeMaterial usage');
assert(materialsSource.includes('MeshBasicNodeMaterial'), 'Missing MeshBasicNodeMaterial usage');
console.log('  ✓ PASS');

console.log('\nTest 2: Phase 3 migrated roles branch to WebGPU node material path');
assert(
    materialsSource.includes('if (params.isWebGPU === true) {\n        return createNimbusStarsNodeMaterial(params);'),
    'Stars factory should route to node material on WebGPU',
);
assert(
    materialsSource.includes('if (params.isWebGPU === true) {\n        return createNimbusDustNodeMaterial(params);'),
    'Dust factory should route to node material on WebGPU',
);
assert(
    materialsSource.includes('if (params.isWebGPU === true) {\n        return createNimbusMistNodeMaterial(params);'),
    'Mist factory should route to node material on WebGPU',
);
assert(
    materialsSource.includes('if (params.isWebGPU === true) {\n        return createNimbusLightBurstNodeMaterial(params);'),
    'Light burst factory should route to node material on WebGPU',
);
assert(
    materialsSource.includes('if (params.isWebGPU === true) {\n        return createNimbusPulseNodeMaterial(params);'),
    'Pulse factory should route to node material on WebGPU',
);
console.log('  ✓ PASS');

console.log('\nTest 3: Bloom metadata contract is explicit in material envelopes');
assert(materialsSource.includes('NIMBUS_BLOOM_CLASS_WEIGHTS'), 'Missing Nimbus bloom class weights table');
assert(materialsSource.includes('bloomClass'), 'Missing bloomClass metadata key');
assert(materialsSource.includes('bloomWeight'), 'Missing bloomWeight metadata key');
assert(materialsSource.includes('supportsMrt'), 'Missing supportsMrt metadata key');
assert(materialsSource.includes('mrtRole'), 'Missing mrtRole metadata key');
assert(materialsSource.includes('primitive'), 'Missing primitive metadata key');
console.log('  ✓ PASS');

console.log('\nTest 4: Pulse role supports instanced-quad metadata in node path');
assert(materialsSource.includes('useInstancing = params.useInstancing === true;'), 'Pulse node material missing instancing flag');
assert(materialsSource.includes("attribute('aProgress', 'float')"), 'Pulse node material missing instanced progress attribute');
assert(materialsSource.includes("attribute('aOpacity', 'float')"), 'Pulse node material missing instanced opacity attribute');
assert(materialsSource.includes('instancedQuads: useInstancing'), 'Pulse metadata should expose instanced quad state');
console.log('  ✓ PASS');

console.log('\nTest 5: Material audit hook covers node + pulse-instancing safety');
assert(materialsSource.includes('auditNimbusMaterialMetadata('), 'Missing Nimbus material audit helper');
assert(materialsSource.includes('HERO_GLOW_QUAD_ROLES'), 'Missing hero glow quad guardrail set');
assert(materialsSource.includes('PHASE3_NODE_REQUIRED_ROLES'), 'Missing Phase 3 node-required role set');
assert(materialsSource.includes('NON_NODE_MATERIAL'), 'Missing node-material audit issue code');
assert(materialsSource.includes('PULSE_NOT_INSTANCED'), 'Missing pulse instanced-quad audit issue code');
console.log('  ✓ PASS');

console.log('\nTest 6: Theme bootstraps pulse instanced system on WebGPU');
assert(themeSource.includes('setupPulseWaveSystem()'), 'Theme missing pulse-wave system bootstrap');
assert(themeSource.includes('this.setupPulseWaveSystem();'), 'Scene bootstrap should initialize pulse-wave system');
assert(themeSource.includes('usesInstancedPulseWaves()'), 'Theme missing instanced pulse mode guard');
assert(themeSource.includes('mode: \'instanced-quads\''), 'Pulse-wave system should tag instanced mode');
console.log('  ✓ PASS');

console.log('\nTest 7: Theme integrates Phase 3 material-audit lifecycle');
assert(themeSource.includes('runPhase3MaterialAudit({ log = this.flags.mrtAudit === true } = {})'), 'Missing Phase 3 audit runner');
assert(
    themeSource.includes('auditNimbusMaterialMetadata(this.scene, {'),
    'Theme should call material audit helper',
);
assert(
    themeSource.includes("this.recordRuntimeEvent('phase3-material-audit'"),
    'Theme should log Phase 3 audit runtime event',
);
assert(
    themeSource.includes('this.runPhase3MaterialAudit({ log: this.flags.mrtAudit === true });'),
    'Scene bootstrap should run Phase 3 material audit',
);
console.log('  ✓ PASS');

console.log('\nTest 8: Snapshot + baseline helpers expose Phase 3 audit and parity APIs');
assert(themeSource.includes('supportsMrt: this.capabilities.mrt,'), 'Theme should pass supportsMrt to material factories');
assert(
    themeSource.includes('phase3MaterialAudit: this.lastPhase3MaterialAudit,'),
    'Validation snapshot missing Phase 3 audit evidence',
);
assert(
    themeSource.includes('phase3ParityValidation: this.lastPhase3ParityValidation,'),
    'Validation snapshot missing Phase 3 parity evidence',
);
assert(
    themeSource.includes('phase3MaterialAudit: (options = {}) => this.runPhase3MaterialAudit(options),'),
    'Baseline helper API missing phase3MaterialAudit hook',
);
assert(
    themeSource.includes('phase3Parity: (options = {}) => this.runPhase3ParityValidation(options),'),
    'Baseline helper API missing phase3Parity hook',
);
assert(
    themeSource.includes('phase3ParityReport: () => this.getPhase3ParityValidationSummary(),'),
    'Baseline helper API missing phase3ParityReport hook',
);
assert(
    themeSource.includes('phase3ParityDownload: (label) => this.downloadPhase3ParityValidationReport(label),'),
    'Baseline helper API missing phase3ParityDownload hook',
);
assert(themeSource.includes('runPhase3ParityValidation(options = {})'), 'Theme missing Phase 3 parity runner');
console.log('  ✓ PASS');

console.log('\nTest 9: Plan and harness reflect completed remaining Phase 3 items');
assert(planSource.includes('Phase 3: TSL Material Migration (High)'), 'Plan missing Phase 3 section');
assert(planSource.includes('Migrate stars, dust, mist, pulse, light burst materials.'), 'Plan missing migrated role list');
assert(planSource.includes('Implement bloom-class metadata and MRT audit hooks.'), 'Plan missing metadata/audit task');
assert(planSource.includes('- [x] Convert hero glow elements to instanced quads where needed.'), 'Plan should mark instanced-quad task complete');
assert(planSource.includes('- [x] Validate WebGL parity using baseline hero frames.'), 'Plan should mark parity task complete');
assert(
    planSource.includes('tests/performance/benchmark-nimbus-veil-phase3.html'),
    'Plan evidence should reference Phase 3 parity harness',
);
assert(harnessSource.includes('window.nimbusBaseline.phase3Parity('), 'Phase 3 harness missing parity helper command');
assert(harnessSource.includes('window.nimbusBaseline.phase3MaterialAudit('), 'Phase 3 harness missing material audit command');
console.log('  ✓ PASS');

console.log('\nTest 10: Art packet still aligns with Sky-inspired Phase 3 guardrails');
assert(artSource.includes('Use Sky: Children of the Light as a mood reference only.'), 'Art inspiration guardrail missing');
assert(artSource.includes('Board readability is non-negotiable.'), 'Art readability guardrail missing');
assert(artSource.includes('## Phase 3 Material Migration Guardrails'), 'Art packet missing Phase 3 guardrail section');
console.log('  ✓ PASS');

console.log('\n=== All Nimbus Veil Phase 3 Tests Passed ===');

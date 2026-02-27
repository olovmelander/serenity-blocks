import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Nimbus Veil Phase 4 Volumetric Cloud Core Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const cloudsPath = path.join(root, 'src', 'themes', 'nimbus-veil', 'nimbus-veil-clouds.js');
const themePath = path.join(root, 'src', 'themes', 'nimbus-veil', 'nimbus-veil-theme.js');
const materialsPath = path.join(root, 'src', 'themes', 'nimbus-veil', 'nimbus-veil-materials.js');
const shaderPath = path.join(root, 'src', 'themes', 'nimbus-veil', 'nimbus-veil-shaders.js');
const planPath = path.join(root, 'docs', 'NIMBUS_VEIL_WEBGPU_UPGRADE_PLAN.md');
const artPath = path.join(root, 'docs', 'NIMBUS_VEIL_ART_DIRECTION.md');
const harnessPath = path.join(root, 'tests', 'performance', 'benchmark-nimbus-veil-phase4.html');

const cloudsSource = fs.readFileSync(cloudsPath, 'utf8');
const themeSource = fs.readFileSync(themePath, 'utf8');
const materialsSource = fs.readFileSync(materialsPath, 'utf8');
const shaderSource = fs.readFileSync(shaderPath, 'utf8');
const planSource = fs.readFileSync(planPath, 'utf8');
const artSource = fs.readFileSync(artPath, 'utf8');
const harnessSource = fs.readFileSync(harnessPath, 'utf8');

console.log('Test 1: Dedicated cloud profile module exists');
assert(cloudsSource.includes('const CLOUD_PROFILE_MATRIX'), 'Phase 4 missing cloud profile matrix');
assert(cloudsSource.includes('resolveNimbusCloudProfile('), 'Phase 4 missing cloud profile resolver');
assert(cloudsSource.includes('computeNimbusCloudReactiveEnvelope('), 'Phase 4 missing reactive envelope helper');
assert(cloudsSource.includes('computeNimbusCloudEdgeFade('), 'Phase 4 missing edge-fade helper');
console.log('  ✓ PASS');

console.log('\nTest 2: Light direction is sourced from scene directional light and synced to cloud uniforms');
assert(themeSource.includes('this.mainDirectionalLight = directionalLight;'), 'Theme should retain directional light handle');
assert(themeSource.includes('getMoonLightDirection()'), 'Theme missing moon-light direction resolver');
assert(
    themeSource.includes('this.setupLighting();\n            this.createClouds();'),
    'Scene build should setup lighting before cloud material creation',
);
assert(
    themeSource.includes('mat.uniforms.uLightDir.value.copy(this.getMoonLightDirection());'),
    'Cloud uniforms should sync light direction from moon-light resolver',
);
console.log('  ✓ PASS');

console.log('\nTest 3: Temporal reprojection is implemented with previous-frame time and velocity uniforms');
assert(shaderSource.includes('uniform float uPrevTime;'), 'Cloud shader missing previous-time uniform');
assert(shaderSource.includes('uniform float uDeltaTime;'), 'Cloud shader missing delta-time uniform');
assert(shaderSource.includes('uniform vec2 uWindVelocity;'), 'Cloud shader missing wind-velocity uniform');
assert(shaderSource.includes('uniform float uCloudVolumeEnabled;'), 'Cloud shader missing cloud-volume enable uniform');
assert(shaderSource.includes('uniform float uCloudVolumeStrength;'), 'Cloud shader missing cloud-volume strength uniform');
assert(shaderSource.includes('uniform float uCloudVolumeSteps;'), 'Cloud shader missing cloud-volume step-count uniform');
assert(shaderSource.includes('uniform float uCloudVolumeDepth;'), 'Cloud shader missing cloud-volume depth uniform');
assert(shaderSource.includes('reprojectionEnabled'), 'Cloud shader missing temporal reprojection branch');
assert(shaderSource.includes('sampleDensityAt(samplePos - windReprojectionOffset, uPrevTime,'), 'Cloud shader should sample reprojected history');
assert(materialsSource.includes('uPrevTime'), 'Cloud material missing previous-time uniform wiring');
assert(materialsSource.includes('uDeltaTime'), 'Cloud material missing delta-time uniform wiring');
assert(materialsSource.includes('uWindVelocity'), 'Cloud material missing wind-velocity uniform wiring');
assert(materialsSource.includes('uCloudVolumeEnabled'), 'Cloud material missing cloud-volume enable wiring');
assert(materialsSource.includes('uCloudVolumeStrength'), 'Cloud material missing cloud-volume strength wiring');
assert(materialsSource.includes('uCloudVolumeSteps'), 'Cloud material missing cloud-volume step-count wiring');
assert(materialsSource.includes('uCloudVolumeDepth'), 'Cloud material missing cloud-volume depth wiring');
console.log('  ✓ PASS');

console.log('\nTest 4: Runtime flags and profile logic preserve reprojection safety controls');
assert(
    themeSource.includes('nextFlags.noReprojection = nextFlags.noReprojection || this.flags.noReprojection === true;'),
    'Runtime refresh should preserve noReprojection flag',
);
assert(
    themeSource.includes('nextFlags.cloudVolume = nextFlags.cloudVolume || this.flags.cloudVolume === true;'),
    'Runtime refresh should preserve cloudVolume flag',
);
assert(
    themeSource.includes('nextFlags.noCloudVolume = nextFlags.noCloudVolume || this.flags.noCloudVolume === true;'),
    'Runtime refresh should preserve noCloudVolume flag',
);
assert(cloudsSource.includes('if (flags.noReprojection === true)'), 'Cloud profile resolver should disable reprojection by flag');
assert(cloudsSource.includes('if (profile.volumeRequested && flags.noCloudVolume === true)'), 'Cloud profile resolver should honor noCloudVolume override');
assert(themeSource.includes('this.cloudProfile = resolveNimbusCloudProfile({'), 'Theme should resolve cloud profile during cloud creation');
assert(themeSource.includes('this.cloudReactiveEnvelope = computeNimbusCloudReactiveEnvelope({'), 'Theme should compute cloud reactive envelope');
assert(themeSource.includes('computeNimbusCloudEdgeFade({'), 'Theme should use shared cloud edge-fade helper');
assert(themeSource.includes('depthBandRatios'), 'Phase 4 runtime stats should expose depth-band occupancy ratios');
assert(themeSource.includes('maxShellTiltRadians'), 'Phase 4 runtime stats should expose shell tilt clamp metric');
assert(themeSource.includes('maxShellSize'), 'Phase 4 runtime stats should expose shell size guard metric');
assert(themeSource.includes("id: 'depth-band-balance'"), 'Phase 4 validation should enforce depth-band composition guardrail');
assert(themeSource.includes("id: 'tilt-clamp'"), 'Phase 4 validation should enforce shell tilt clamp guardrail');
assert(themeSource.includes("id: 'shell-size-safety'"), 'Phase 4 validation should enforce shell size safety guardrail');
assert(themeSource.includes("id: 'board-safe-cloud-clamp'"), 'Phase 4 validation should enforce board-safe cloud clamp guardrail');
console.log('  ✓ PASS');

console.log('\nTest 5: Behavioral and perf validation helpers are implemented and exposed');
assert(themeSource.includes('runPhase4CloudBehaviorValidation(options = {})'), 'Missing Phase 4 cloud behavior validator');
assert(themeSource.includes('runPhase4CloudPerfSweep(options = {})'), 'Missing Phase 4 cloud perf sweep');
assert(themeSource.includes('phase4CloudBehavior: (options = {}) => this.runPhase4CloudBehaviorValidation(options),'), 'Baseline helper missing phase4CloudBehavior');
assert(themeSource.includes('phase4CloudPerf: (options = {}) => this.runPhase4CloudPerfSweep(options),'), 'Baseline helper missing phase4CloudPerf');
assert(themeSource.includes('phase4CloudProfile: () => (this.cloudProfile ? { ...this.cloudProfile } : null),'), 'Baseline helper missing phase4CloudProfile');
assert(harnessSource.includes('phase4CloudBehavior('), 'Phase 4 harness missing behavior validation wiring');
assert(harnessSource.includes('phase4CloudPerf('), 'Phase 4 harness missing perf sweep wiring');
console.log('  ✓ PASS');

console.log('\nTest 6: Plan and art packet reflect Phase 4 implementation + validation coverage');
assert(planSource.includes('## Phase 4: Volumetric Cloud Core (Critical)'), 'Plan missing Phase 4 section');
assert(planSource.includes('- [x] Implement tiered cloud paths (raymarch/sliced/billboard).'), 'Plan missing completed tiered cloud task');
assert(planSource.includes('- [x] Add scattering, self-shadow approximation, and rim response.'), 'Plan missing completed scattering task');
assert(planSource.includes('- [x] Integrate blue-noise jitter and optional reprojection.'), 'Plan missing completed jitter/reprojection task');
assert(planSource.includes('- [x] Add gameplay-driven density/emissive responses.'), 'Plan missing completed reactive cloud task');
assert(planSource.includes('tests/unit/test-nimbus-veil-phase4.js'), 'Plan evidence should reference Phase 4 unit coverage');
assert(planSource.includes('tests/performance/benchmark-nimbus-veil-phase4.html'), 'Plan evidence should reference Phase 4 harness');
assert(artSource.includes('## Phase 4 Volumetric Cloud Guardrails'), 'Art packet missing Phase 4 cloud guardrails');
console.log('  ✓ PASS');

console.log('\n=== All Nimbus Veil Phase 4 Tests Passed ===');

import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Nimbus Veil Phase 6 Divine Lighting + Post Pipeline Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const themePath = path.join(root, 'src', 'themes', 'nimbus-veil', 'nimbus-veil-theme.js');
const postPath = path.join(root, 'src', 'themes', 'nimbus-veil', 'nimbus-veil-post.js');
const planPath = path.join(root, 'docs', 'NIMBUS_VEIL_WEBGPU_UPGRADE_PLAN.md');
const artPath = path.join(root, 'docs', 'NIMBUS_VEIL_ART_DIRECTION.md');
const harnessPath = path.join(root, 'tests', 'performance', 'benchmark-nimbus-veil-phase6.html');

const themeSource = fs.readFileSync(themePath, 'utf8');
const postSource = fs.readFileSync(postPath, 'utf8');
const planSource = fs.readFileSync(planPath, 'utf8');
const artSource = fs.readFileSync(artPath, 'utf8');
const harnessSource = fs.readFileSync(harnessPath, 'utf8');

console.log('Test 1: Post abstraction supports WebGPU and WebGL routes');
assert(postSource.includes('setupWebGPU()'), 'Missing WebGPU post setup path');
assert(postSource.includes('setupWebGL()'), 'Missing WebGL post setup path');
assert(postSource.includes('new WEBGPU.PostProcessing(this.renderer)'), 'Missing WebGPU post-processing pipeline');
assert(postSource.includes('new EffectComposer(this.renderer)'), 'Missing WebGL EffectComposer fallback path');
assert(postSource.includes('this.mode = this.useMRT ? \'webgpu-post-mrt\' : \'webgpu-post-no-mrt\';'), 'Missing WebGPU mode tagging');
console.log('  ✓ PASS');

console.log('\nTest 2: WebGPU post includes MRT emissive isolation and depth-aware rays');
assert(postSource.includes("this.scenePass.setMRT(mrt({ output, emissive }));"), 'Missing MRT emissive isolation setup');
assert(postSource.includes("const emissiveSource = this.useMRT ? this.scenePass.getTextureNode('emissive') : sceneColor;"), 'Missing MRT/no-MRT bloom source routing');
assert(postSource.includes("const depthTexture = this.scenePass.getTextureNode('depth');"), 'Missing depth texture sampling for god rays');
assert(postSource.includes('perspectiveDepthToViewZ'), 'Missing depth conversion helper for depth-aware attenuation');
assert(postSource.includes('viewZToOrthographicDepth'), 'Missing linear-depth attenuation conversion');
console.log('  ✓ PASS');

console.log('\nTest 3: Post stack applies grading, vignette, and board-safe masks');
assert(postSource.includes('uVignetteDarkness'), 'Missing vignette uniform wiring');
assert(postSource.includes('uExposure'), 'Missing exposure uniform wiring');
assert(postSource.includes('uContrast'), 'Missing contrast uniform wiring');
assert(postSource.includes('uSaturation'), 'Missing saturation uniform wiring');
assert(postSource.includes('uBoardProtection'), 'Missing board-safe mask protection uniform');
assert(postSource.includes('uBoardRadius'), 'Missing board-safe radius handling in fallback shader');
console.log('  ✓ PASS');

console.log('\nTest 4: Theme wires Phase 6 post presets, runtime updates, and MRT enforcement');
assert(themeSource.includes('PHASE6_POST_PRESETS'), 'Missing Phase 6 post preset table');
assert(themeSource.includes('getPhase6PostConfig()'), 'Missing Phase 6 post config resolver');
assert(themeSource.includes('updatePhase6PostPipeline()'), 'Missing dynamic post update bridge');
assert(themeSource.includes('buildPhase6MrtAuditReport(materialAudit, usingMRT)'), 'Missing Phase 6 MRT audit builder');
assert(themeSource.includes('this.nimbusPost = new NimbusVeilPost(this.renderer, this.scene, this.camera, {'), 'Theme does not construct Nimbus post abstraction');
assert(themeSource.includes('enableGodRays: true'), 'Theme should explicitly request god rays in post stack');
console.log('  ✓ PASS');

console.log('\nTest 5: Theme exposes Phase 6 runtime/validation helpers');
assert(themeSource.includes('getPhase6PostRuntimeState()'), 'Missing Phase 6 post runtime state helper');
assert(themeSource.includes('runPhase6PostValidation(options = {})'), 'Missing Phase 6 post validation runner');
assert(themeSource.includes('phase6PostState: () => this.getPhase6PostRuntimeState(),'), 'Baseline API missing phase6PostState');
assert(themeSource.includes('phase6PostValidate: (options = {}) => this.runPhase6PostValidation(options),'), 'Baseline API missing phase6PostValidate');
assert(themeSource.includes('phase6PostReport: () => this.getPhase6PostValidationSummary(),'), 'Baseline API missing phase6PostReport');
assert(themeSource.includes('phase6PostDownload: (label) => this.downloadPhase6PostValidationReport(label),'), 'Baseline API missing phase6PostDownload');
console.log('  ✓ PASS');

console.log('\nTest 6: Plan and art docs reflect Phase 6 completion and guardrails');
assert(planSource.includes('## Phase 6: Divine Lighting and Post Pipeline (High)'), 'Plan missing Phase 6 section');
assert(planSource.includes('- [x] 6A base post: bloom, grade, vignette, board-safe masks.'), 'Plan should mark Phase 6A complete');
assert(planSource.includes('- [x] 6B MRT hardening: emissive isolation and audit enforcement.'), 'Plan should mark Phase 6B complete');
assert(planSource.includes('- [x] Add god rays with depth-aware attenuation.'), 'Plan should mark god-ray task complete');
assert(planSource.includes('- [x] Add fallback post routes for no-MRT/no-post modes.'), 'Plan should mark fallback routing complete');
assert(planSource.includes('tests/unit/test-nimbus-veil-phase6.js'), 'Plan evidence should reference Phase 6 unit coverage');
assert(planSource.includes('tests/performance/benchmark-nimbus-veil-phase6.html'), 'Plan evidence should reference Phase 6 harness');
assert(artSource.includes('## Phase 6 Divine Lighting and Post Guardrails'), 'Art packet missing Phase 6 guardrail section');
assert(artSource.includes('board-safe mask'), 'Art packet missing board-safe mask guardrail');
console.log('  ✓ PASS');

console.log('\nTest 7: Phase 6 performance harness exposes validation helper calls');
assert(harnessSource.includes('window.nimbusBaseline.phase6PostState();'), 'Phase 6 harness missing post state helper command');
assert(harnessSource.includes('window.nimbusBaseline.phase6PostValidate('), 'Phase 6 harness missing validation helper command');
assert(harnessSource.includes('window.nimbusBaseline.phase6PostDownload('), 'Phase 6 harness missing download helper command');
assert(harnessSource.includes('window.nimbusBaseline.phase6MrtAudit();'), 'Phase 6 harness missing MRT audit helper command');
console.log('  ✓ PASS');

console.log('\n=== All Nimbus Veil Phase 6 Tests Passed ===');

import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Moonlit Forest Phase 6 Post Pipeline Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const postPath = path.join(root, 'src', 'themes', 'moonlit-forest', 'moonlit-forest-post.js');
const themePath = path.join(root, 'src', 'themes', 'moonlit-forest', 'moonlit-forest-theme.js');

const postSource = fs.readFileSync(postPath, 'utf8');
const themeSource = fs.readFileSync(themePath, 'utf8');

console.log('Test 1: Dual post paths exist (WebGPU + WebGL fallback)');
assert(postSource.includes('setupWebGPU(scene, camera, params)'), 'Missing WebGPU post setup path');
assert(postSource.includes('setupWebGL(scene, camera, params)'), 'Missing WebGL post setup path');
assert(postSource.includes('new WEBGPU.PostProcessing(this.renderer)'), 'Missing WebGPU PostProcessing chain');
assert(postSource.includes('new EffectComposer(this.renderer)'), 'Missing WebGL EffectComposer fallback chain');
console.log('  ✓ PASS');

console.log('\nTest 2: Post stack supports bloom + grading + vignette controls');
assert(postSource.includes('this.bloomNode = bloom('), 'Missing WebGPU bloom node');
assert(postSource.includes('this.gradePass = new ShaderPass(MOONLIT_GRADE_SHADER);'), 'Missing WebGL grading shader pass');
assert(postSource.includes('params.vignetteOffset'), 'Missing vignette parameter handling');
assert(postSource.includes('params.vignetteDarkness'), 'Missing vignette darkness handling');
assert(postSource.includes('params.exposure'), 'Missing exposure parameter handling');
assert(postSource.includes('params.saturation'), 'Missing saturation parameter handling');
console.log('  ✓ PASS');

console.log('\nTest 3: Optional MRT emissive isolation wiring exists');
assert(postSource.includes("this.scenePass.setMRT(mrt({ output, emissive }));"), 'Missing MRT setup for emissive isolation');
assert(postSource.includes("const bloomSource = this.useMRT ? this.scenePass.getTextureNode('emissive') : sceneColor;"), 'Missing MRT bloom source selection');
console.log('  ✓ PASS');

console.log('\nTest 4: Theme wires preset-driven post params and runtime updates');
assert(themeSource.includes('const postConfig = this.qualityConfig?.post ?? {};'), 'Missing post config extraction in theme');
assert(themeSource.includes('this.postProcessing = new MoonlitForestPost(this.renderer, this.scene, this.camera, {'), 'Theme does not create Moonlit post stack');
assert(themeSource.includes('bloomDownsample: postConfig.bloomDownsample'), 'Theme does not pass bloomDownsample from preset');
assert(themeSource.includes('grainStrength: postConfig.grainStrength'), 'Theme does not pass grainStrength from preset');
assert(themeSource.includes('this.postProcessing.update({'), 'Theme does not drive dynamic post updates');
console.log('  ✓ PASS');

console.log('\nTest 5: MRT audit diagnostics are available behind Moonlit debug flag');
assert(themeSource.includes("mrtAudit: readBool('moonlitMrtAudit')"), 'Missing moonlitMrtAudit query flag parsing');
assert(themeSource.includes('auditMrtMaterials()'), 'Missing MRT material audit helper');
assert(themeSource.includes('if (this.flags.mrtAudit && this.flags.useMRT)'), 'MRT audit is not conditionally invoked');
console.log('  ✓ PASS');

console.log('\n=== All Moonlit Forest Phase 6 Tests Passed ===');

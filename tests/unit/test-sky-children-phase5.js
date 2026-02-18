import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Sky Children Phase 5 Post Stack Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const postWgslPath = path.join(root, 'src', 'themes', 'sky-children', 'wgsl', 'post_processing.wgsl');
const resourcesPath = path.join(root, 'src', 'themes', 'sky-children', 'sky-children-resources.js');
const pipelinesPath = path.join(root, 'src', 'themes', 'sky-children', 'sky-children-pipelines.js');
const themePath = path.join(root, 'src', 'themes', 'sky-children', 'sky-children-theme.js');

const postWgslSource = fs.readFileSync(postWgslPath, 'utf8');
const resourcesSource = fs.readFileSync(resourcesPath, 'utf8');
const pipelinesSource = fs.readFileSync(pipelinesPath, 'utf8');
const themeSource = fs.readFileSync(themePath, 'utf8');

console.log('Test 1: Post WGSL defines bloom, AgX tonemap, and grading passes');
assert(postWgslSource.includes('struct PostUniforms'), 'Missing PostUniforms struct');
assert(postWgslSource.includes('fn bloom_threshold('), 'Missing bloom threshold helper');
assert(postWgslSource.includes('fn kawase_downsample('), 'Missing Kawase downsample helper');
assert(postWgslSource.includes('fn kawase_upsample('), 'Missing Kawase upsample helper');
assert(postWgslSource.includes('fn agx_tonemap('), 'Missing AgX tonemap helper');
assert(postWgslSource.includes('fn sky_color_grade('), 'Missing Sky color grading helper');
assert(postWgslSource.includes('@fragment\nfn fs_post('), 'Missing post fragment entrypoint');
assert(postWgslSource.includes('let scene_uv = input.uv;'), 'Missing direct UV sampling in post pass');
console.log('  ✓ PASS');

console.log('\nTest 2: Phase 5 post defaults and mutable state factory exist');
assert(resourcesSource.includes('SKY_CHILDREN_PHASE5_POST_DEFAULTS'), 'Missing Phase 5 post defaults object');
assert(resourcesSource.includes('bloomThreshold'), 'Missing bloom threshold default');
assert(resourcesSource.includes('highlightColor'), 'Missing highlightColor default');
assert(resourcesSource.includes('agxMix'), 'Missing agxMix default');
assert(
    resourcesSource.includes('export function createSkyChildrenPhase5PostState'),
    'Missing Phase 5 post state factory',
);
console.log('  ✓ PASS');

console.log('\nTest 3: Pipeline helpers expose Phase 5 post module wiring');
assert(
    pipelinesSource.includes('export const SKY_CHILDREN_PHASE5_SHADER_LABELS'),
    'Missing Phase 5 shader labels export',
);
assert(
    pipelinesSource.includes("postPass: 'sky-children/phase5-post-pass'"),
    'Missing Phase 5 post pass label',
);
assert(
    pipelinesSource.includes('export function createSkyChildrenPostProcessingModule'),
    'Missing Phase 5 post shader module helper',
);
assert(
    pipelinesSource.includes('export function buildSkyChildrenPhase5PostWGSL'),
    'Missing Phase 5 post WGSL builder helper',
);
console.log('  ✓ PASS');

console.log('\nTest 4: Theme wires post stack into real WebGPU render path');
assert(themeSource.includes('loadPostProcessingSource()'), 'Missing post WGSL loader');
assert(themeSource.includes('createSkyChildrenPostProcessingModule(device, postWGSL)'), 'Missing post shader module creation');
assert(themeSource.includes('postPipeline = device.createRenderPipeline({'), 'Missing post render pipeline creation');
assert(themeSource.includes('ensureWebGPUSceneTexture()'), 'Missing scene texture allocation for post pass');
assert(themeSource.includes('postPass.setPipeline(webgpu.postPipeline);'), 'Missing post pass pipeline binding');
assert(themeSource.includes('postPass.setBindGroup(0, webgpu.postBindGroup);'), 'Missing post pass bind group binding');
assert(themeSource.includes('postPass.draw(3, 1, 0, 0);'), 'Missing post pass fullscreen draw');
assert(themeSource.includes('presentPass.setPipeline(webgpu.presentPipeline);'), 'Missing final present pass pipeline binding');
assert(themeSource.includes('presentPass.setBindGroup(0, webgpu.presentBindGroup);'), 'Missing final present pass bind group binding');
assert(themeSource.includes("let sceneFormat = 'rgba16float';"), 'Missing HDR scene render target format selection');
assert(themeSource.includes('format: sceneFormat'), 'Missing scene pipeline HDR target binding');
assert(
    themeSource.includes('this.recordPhase5PostSample(cpuPostMs);')
    || themeSource.includes('this.recordPhase5PostSample(postMs);'),
    'Missing dedicated phase5 post sampling',
);
assert(themeSource.includes('this.phase5PostSamples'), 'Missing dedicated phase5 post sample store');
assert(
    /async runPhase1PerformanceGate[\s\S]*const collectSamples = \(\) => this\.selectSceneTimingSampleSet/.test(themeSource),
    'Phase 1 performance gate must read from scene timing sample selector',
);
assert(
    /async runPhase2PerformanceGate[\s\S]*const collectSamples = \(\) => this\.selectSceneTimingSampleSet/.test(themeSource),
    'Phase 2 performance gate must read from scene timing sample selector',
);
assert(
    /async runPhase5PerformanceGate[\s\S]*const collectSamples = \(\) => this\.selectPostTimingSampleSet/.test(themeSource),
    'Phase 5 performance gate must read from post timing sample selector',
);
console.log('  ✓ PASS');

console.log('\n=== Sky Children Phase 5 Post Stack Tests Passed ===');

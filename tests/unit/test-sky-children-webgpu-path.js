import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Sky Children WebGPU Phase 4 Wiring Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const themePath = path.join(root, 'src', 'themes', 'sky-children', 'sky-children-theme.js');
const pipelinePath = path.join(root, 'src', 'themes', 'sky-children', 'sky-children-pipelines.js');

const themeSource = fs.readFileSync(themePath, 'utf8');
const pipelineSource = fs.readFileSync(pipelinePath, 'utf8');

console.log('Test 1: Theme initializes real WebGPU objects (adapter/device/context)');
assert(themeSource.includes('navigator.gpu.requestAdapter'), 'Missing requestAdapter call');
assert(themeSource.includes('adapter.requestDevice'), 'Missing requestDevice call');
assert(themeSource.includes("this.canvas.getContext('webgpu')"), 'Missing webgpu canvas context acquisition');
assert(themeSource.includes('navigator.gpu.getPreferredCanvasFormat'), 'Missing preferred canvas format usage');
assert(themeSource.includes('device.createBindGroupLayout({'), 'Missing explicit bind group layout creation');
assert(themeSource.includes('device.createPipelineLayout({'), 'Missing explicit pipeline layout creation');
console.log('  ✓ PASS');

console.log('\nTest 2: Theme loads stylized_lighting/terrain/cloud/foliage WGSL and builds shader modules');
assert(
    themeSource.includes("new URL('./wgsl/stylized_lighting.wgsl', import.meta.url)"),
    'Theme should load stylized_lighting.wgsl from disk',
);
assert(
    themeSource.includes("new URL('./wgsl/terrain.wgsl', import.meta.url)"),
    'Theme should load terrain.wgsl from disk',
);
assert(
    themeSource.includes("new URL('./wgsl/cloud.wgsl', import.meta.url)"),
    'Theme should load cloud.wgsl from disk',
);
assert(
    themeSource.includes("new URL('./wgsl/foliage.wgsl', import.meta.url)"),
    'Theme should load foliage.wgsl from disk',
);
assert(
    themeSource.includes("new URL('./wgsl/post_processing.wgsl', import.meta.url)"),
    'Theme should load post_processing.wgsl from disk',
);
assert(
    themeSource.includes('buildSkyChildrenPhase4TerrainCloudFoliageWGSL('),
    'Theme should build the phase4 terrain+cloud+foliage WGSL shader source',
);
assert(
    themeSource.includes('buildSkyChildrenPhase5PostWGSL('),
    'Theme should build the phase5 post WGSL shader source',
);
assert(
    themeSource.includes('createSkyChildrenStylizedLightingModule(device, shaderSource)'),
    'Theme should compile shader via pipeline helper',
);
assert(
    themeSource.includes('createSkyChildrenPostProcessingModule(device, postWGSL)'),
    'Theme should compile phase5 post shader module via pipeline helper',
);
console.log('  ✓ PASS');

console.log('\nTest 3: Theme writes uniforms and submits terrain+foliage WebGPU draws each frame');
assert(themeSource.includes('device.queue.writeBuffer'), 'Missing uniform buffer writes');
assert(themeSource.includes('data[UNIFORM.controls + 1] = controls.yNormalCompression;'), 'Missing yNormalCompression uniform wiring');
assert(themeSource.includes('data[UNIFORM.controls + 2] = controls.diffuseMultiplier;'), 'Missing diffuseMultiplier uniform wiring');
assert(themeSource.includes('data[UNIFORM.comboMisc + 3] = runtime.cameraOffsetX;'), 'Missing cameraOffsetX uniform wiring');
assert(themeSource.includes('data[UNIFORM.controls + 3] = runtime.cameraOffsetY;'), 'Missing cameraOffsetY uniform wiring');
assert(themeSource.includes('data[UNIFORM.foliageWindPrimary + 0] = foliageState.windStrength;'), 'Missing foliage wind uniform wiring');
assert(themeSource.includes('pass.setPipeline(webgpu.pipeline);'), 'Missing pass.setPipeline');
assert(themeSource.includes('pass.setBindGroup(0, webgpu.bindGroup);'), 'Missing pass.setBindGroup');
assert(themeSource.includes('pass.draw(3, 1, 0, 0);'), 'Missing fullscreen triangle draw');
assert(themeSource.includes('pass.setPipeline(webgpu.foliagePipeline);'), 'Missing foliage pipeline draw stage');
assert(themeSource.includes('pass.draw(6, instanceCount, 0, 0);'), 'Missing instanced foliage draw call');
assert(themeSource.includes('pass.setBindGroup(0, webgpu.foliageBindGroup);'), 'Missing dedicated foliage bind group usage');
assert(themeSource.includes('this.updateWebGPUPostUniforms(width, height);'), 'Missing phase5 post uniform buffer updates');
assert(themeSource.includes('this.ensureWebGPUSceneTexture();'), 'Missing phase5 scene render target allocation');
assert(themeSource.includes('postPass.setPipeline(webgpu.postPipeline);'), 'Missing phase5 post pipeline draw stage');
assert(themeSource.includes('postPass.setBindGroup(0, webgpu.postBindGroup);'), 'Missing phase5 post bind group usage');
assert(themeSource.includes('postPass.draw(3, 1, 0, 0);'), 'Missing phase5 fullscreen post draw');
assert(themeSource.includes('presentPass.setPipeline(webgpu.presentPipeline);'), 'Missing present pipeline draw stage');
assert(themeSource.includes('presentPass.setBindGroup(0, webgpu.presentBindGroup);'), 'Missing present bind group usage');
assert(themeSource.includes("let sceneFormat = 'rgba16float';"), 'Missing Phase 5 HDR scene format selection');
assert(themeSource.includes('format: sceneFormat'), 'Missing HDR scene format usage in scene pipelines');
assert(
    themeSource.includes('this.recordPhase5PostSample(cpuPostMs);')
    || themeSource.includes('this.recordPhase5PostSample(postMs);'),
    'Missing Phase 5 post-only sample timing',
);
assert(themeSource.includes('webgpu.sceneTexture.destroy();'), 'Missing scene texture destroy path on resize/dispose');
assert(themeSource.includes('webgpu.device.queue.submit([encoder.finish()]);'), 'Missing queue submit');
console.log('  ✓ PASS');

console.log('\nTest 4: Pipeline helper exports composed WGSL builders and uniform sizes');
assert(
    pipelineSource.includes('export const SKY_CHILDREN_PHASE1_UNIFORM_FLOATS'),
    'Missing uniform float count export',
);
assert(
    pipelineSource.includes('export const SKY_CHILDREN_PHASE1_UNIFORM_BYTES'),
    'Missing uniform byte size export',
);
assert(
    pipelineSource.includes('export function buildSkyChildrenPhase3TerrainCloudWGSL'),
    'Missing Phase 3 WGSL composition helper',
);
assert(
    pipelineSource.includes('export function buildSkyChildrenPhase4TerrainCloudFoliageWGSL'),
    'Missing Phase 4 WGSL composition helper',
);
assert(
    pipelineSource.includes('calculate_journey_lighting_custom('),
    'Composed shader should invoke phase1 Journey lighting core with runtime controls',
);
assert(
    pipelineSource.includes('let y_normal_compression = clamp(frame.controls.y, 0.0, 1.0);'),
    'Composed shader should bind yNormalCompression from controls',
);
assert(
    pipelineSource.includes('let diffuse_multiplier = max(frame.controls.z * mix(0.85, 1.0, detail_attn), 0.01);'),
    'Composed shader should bind diffuseMultiplier from controls and adapt it by distance detail attenuation',
);
assert(
    pipelineSource.includes('let camera_offset = vec2f(frame.combo_misc.w, frame.controls.w);'),
    'Composed shader should read runtime camera offsets for cinematic movement',
);
assert(
    pipelineSource.includes('fn sky_atmosphere_particles('),
    'Composed shader should include atmospheric particle helper',
);
assert(
    !pipelineSource.includes('color = color / (color + vec3f(1.0));'),
    'Scene shader should stay linear for Phase 5 post stack (no pre-tonemap)',
);
console.log('  ✓ PASS');

console.log('\nTest 5: Theme keeps a 2D fallback path when WebGPU fails');
assert(
    themeSource.includes('WebGPU init failed, falling back to 2D'),
    'Missing WebGPU failure fallback log path',
);
assert(
    themeSource.includes('this.renderBackend = \'canvas2d\';'),
    'Theme should explicitly set canvas2d backend fallback',
);
assert(
    themeSource.includes('this.disableWebGPUAndFallback();'),
    'Theme should downgrade to canvas2d on runtime WebGPU failures',
);
console.log('  ✓ PASS');

console.log('\n=== Sky Children WebGPU Wiring Tests Passed ===');

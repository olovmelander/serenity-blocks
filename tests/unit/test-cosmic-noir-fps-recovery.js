import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

console.log('=== Cosmic Noir FPS Recovery Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

const themePath = path.join(root, 'src', 'themes', 'cosmic-noir', 'cosmic-noir-theme.js');
const postPath = path.join(root, 'src', 'themes', 'cosmic-noir', 'cosmic-noir-post.js');
const materialsPath = path.join(root, 'src', 'themes', 'cosmic-noir', 'cosmic-noir-materials.js');
const shadersPath = path.join(root, 'src', 'themes', 'cosmic-noir', 'cosmic-noir-shaders.js');

const themeSource = fs.readFileSync(themePath, 'utf8');
const postSource = fs.readFileSync(postPath, 'utf8');
const materialsSource = fs.readFileSync(materialsPath, 'utf8');
const shadersSource = fs.readFileSync(shadersPath, 'utf8');

console.log('Test 1: Adaptive runtime controls are wired into theme + post stack');
assert(themeSource.includes("noAdaptiveScale: readBool('cosmicNoirNoAdaptiveScale')"), 'Missing cosmicNoirNoAdaptiveScale flag');
assert(themeSource.includes("const fixedPixelRatio = readNumber('cosmicNoirFixedPixelRatio', 'fixedPixelRatio');"), 'Missing fixed pixel ratio flag');
assert(themeSource.includes('initializeAdaptiveBudgetState()'), 'Missing adaptive budget initializer');
assert(themeSource.includes('this.updateAdaptiveBudgetState(frameMs);'), 'Animation loop does not update adaptive budget state');
assert(themeSource.includes('this.applyAdaptiveBudgetState();'), 'Animation loop does not apply adaptive budget state');
assert(postSource.includes('this.resolutionScale = params.resolutionScale ?? 1.0;'), 'Post stack missing resolutionScale state');
assert(postSource.includes('this.chromaticEnabled = params.chromaticEnabled ?? true;'), 'Post stack missing chromaticEnabled state');
assert(postSource.includes('this.uLensingStrength = uniform(params.lensingStrength ?? 1.0);'), 'Post stack missing lensingStrength uniform');
console.log('  ✓ PASS');

console.log('\nTest 2: Post degradation controls are driven before renderer scaling');
assert(themeSource.includes('const adaptivePost = this.getAdaptivePostParams();'), 'Theme does not extract adaptive post params');
assert(themeSource.includes('resolutionScale: adaptivePost.resolutionScale,'), 'Theme does not drive post resolution scale');
assert(themeSource.includes('chromaticEnabled: adaptivePost.chromaticEnabled,'), 'Theme does not drive chromatic toggle');
assert(themeSource.includes('lensingStrength: adaptivePost.lensingStrength,'), 'Theme does not drive lensing strength');
assert(themeSource.includes('this.chromaticPass.uniforms.uIntensity.value = adaptivePost.chromaticEnabled'), 'WebGL fallback chromatic pass is not budget-aware');
console.log('  ✓ PASS');

console.log('\nTest 3: Gas swirl and transient effects avoid rendering inactive content');
assert(themeSource.includes('geometry.setDrawRange(0, 0);'), 'Gas swirl should initialize with an empty draw range');
assert(themeSource.includes('this.gasSwirl.geometry.setDrawRange(0, d.activeCount);'), 'Gas swirl active draw range is missing');
assert(themeSource.includes('this.gasSwirl.visible = d.activeCount > 0;'), 'Gas swirl visibility is not gated by activity');
assert(themeSource.includes('sparks.visible = false;'), 'Fallback spark systems should start hidden');
assert(themeSource.includes('this.comboFlash.visible = flashOpacity > 0.001;'), 'Combo flash visibility should be gated by opacity');
assert(themeSource.includes('this.comboLensFlare.visible = flareOpacity > 0.001;'), 'Combo lens flare visibility should be gated by opacity');
console.log('  ✓ PASS');

console.log('\nTest 4: Cosmic waves are pooled instead of recreated every burst');
assert(themeSource.includes('this.cosmicWavePool = [];'), 'Missing cosmic wave pool state');
assert(themeSource.includes('acquireCosmicWave(options = {})'), 'Missing cosmic wave acquire helper');
assert(themeSource.includes('releaseCosmicWave(wave)'), 'Missing cosmic wave release helper');
assert(themeSource.includes('disposeCosmicWavePool()'), 'Missing cosmic wave pool disposal helper');
console.log('  ✓ PASS');

console.log('\nTest 5: Heavy shader paths use shared noise textures in both renderers');
assert(themeSource.includes('ensureSharedNoiseTexture()'), 'Theme missing shared noise texture helper');
assert(themeSource.includes('this.disposeSharedNoiseTexture();'), 'Theme missing shared noise texture cleanup');
assert(materialsSource.includes('const noiseNode = params.noiseMap ? texture(params.noiseMap) : null;'), 'Node materials are not wired for texture noise');
assert(shadersSource.includes('uniform sampler2D uNoiseMap;'), 'WebGL shaders are not wired for texture noise');
console.log('  ✓ PASS');

console.log('\nTest 6: Runtime compute path keeps spark compute but drops low-value compute passes');
assert(themeSource.includes('new CosmicNoirSparkCompute('), 'Spark compute path should remain available');
assert(!themeSource.includes('new CosmicNoirStarTwinkleCompute('), 'Star twinkle compute should not be instantiated at runtime');
assert(!themeSource.includes('new CosmicNoirAtmosphereFlowCompute('), 'Atmosphere flow compute should not be instantiated at runtime');
assert(!themeSource.includes('this.atmosphereFlowCompute.update({'), 'Atmosphere flow compute should not be dispatched at runtime');
assert(!themeSource.includes('this.renderer.compute(this.atmosphereFlowCompute.computeNode);'), 'Atmosphere flow compute should not be rendered');
console.log('  ✓ PASS');

console.log('\n=== Cosmic Noir FPS Recovery Tests Passed ===');

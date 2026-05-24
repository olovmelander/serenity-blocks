import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';
import * as THREE from 'three';
import {
    OceanGameplayEffects,
    QUALITY_EFFECT_LIMITS,
} from '../../src/themes/ocean/ocean-gameplay-effects.js';
import { OceanFishSystem } from '../../src/themes/ocean/ocean-fish-system.js';
import { OceanRareFaunaSystem } from '../../src/themes/ocean/ocean-rare-fauna-system.js';
import {
    OCEAN_FAUNA_ASSET_VERSION,
    OCEAN_FAUNA_GENERATION_CONTRACT,
    OCEAN_HERO_FISH_ASSETS,
    OCEAN_RARE_FAUNA_ASSETS,
} from '../../src/themes/ocean/ocean-fauna-assets.js';
import {
    getHeroCoralAssetRecords,
    summarizeCoralAssetManifest,
} from '../../src/themes/ocean/ocean-coral-assets.js';
import {
    getHeroKelpAssetRecords,
    getSeabedPlantAssetRecords,
    summarizeKelpAssetManifest,
} from '../../src/themes/ocean/ocean-kelp-assets.js';
import {
    getHeroReefAssetRecords,
    summarizeReefAssetManifest,
} from '../../src/themes/ocean/ocean-reef-assets.js';
import {
    getHeroRockAssetRecords,
    summarizeRockAssetManifest,
} from '../../src/themes/ocean/ocean-rock-assets.js';

console.log('=== Ocean AAA Deferred-Compute Completion Test ===\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..', '..');

const oceanDir = path.join(repoRoot, 'src', 'themes', 'ocean');
const themeSource = fs.readFileSync(path.join(oceanDir, 'ocean-theme.js'), 'utf8');
const postSource = fs.readFileSync(path.join(oceanDir, 'ocean-post.js'), 'utf8');
const materialsSource = fs.readFileSync(path.join(oceanDir, 'ocean-materials.js'), 'utf8');
const atmosphereSource = fs.readFileSync(path.join(oceanDir, 'ocean-atmosphere-system.js'), 'utf8');
const cameraSource = fs.readFileSync(path.join(oceanDir, 'ocean-camera.js'), 'utf8');
const computeSource = fs.readFileSync(path.join(oceanDir, 'ocean-compute.js'), 'utf8');
const fishSource = fs.readFileSync(path.join(oceanDir, 'ocean-fish-system.js'), 'utf8');
const rareFaunaSource = fs.readFileSync(
    path.join(oceanDir, 'ocean-rare-fauna-system.js'),
    'utf8',
);
const faunaManifestSource = fs.readFileSync(
    path.join(oceanDir, 'ocean-fauna-assets.js'),
    'utf8',
);
const coralManifestSource = fs.readFileSync(
    path.join(oceanDir, 'ocean-coral-assets.js'),
    'utf8',
);
const kelpManifestSource = fs.readFileSync(
    path.join(oceanDir, 'ocean-kelp-assets.js'),
    'utf8',
);
const reefManifestSource = fs.readFileSync(
    path.join(oceanDir, 'ocean-reef-assets.js'),
    'utf8',
);
const rockManifestSource = fs.readFileSync(
    path.join(oceanDir, 'ocean-rock-assets.js'),
    'utf8',
);
const gameplayEffectsSource = fs.readFileSync(
    path.join(oceanDir, 'ocean-gameplay-effects.js'),
    'utf8',
);
const environmentAttributionSource = fs.readFileSync(
    path.join(oceanDir, 'assets', 'ATTRIBUTION.md'),
    'utf8',
);
const benchmarkSource = fs.readFileSync(
    path.join(repoRoot, 'tests', 'performance', 'benchmark-ocean.html'),
    'utf8',
);

function parseGlbJson(buffer) {
    assert.strictEqual(buffer.readUInt32LE(0), 0x46546c67, 'GLB magic should be glTF');
    const jsonLength = buffer.readUInt32LE(12);
    assert.strictEqual(buffer.readUInt32LE(16), 0x4e4f534a, 'GLB should start with JSON chunk');
    return JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
}

function countGlbTriangles(json) {
    return (json.meshes || []).reduce((sum, mesh) => {
        const meshTriangles = (mesh.primitives || []).reduce((primitiveSum, primitive) => {
            const mode = primitive.mode ?? 4;
            if (mode !== 4) return primitiveSum;
            if (Number.isInteger(primitive.indices)) {
                return primitiveSum + Math.floor(
                    (json.accessors?.[primitive.indices]?.count || 0) / 3,
                );
            }
            return primitiveSum + Math.floor(
                (json.accessors?.[primitive.attributes?.POSITION]?.count || 0) / 3,
            );
        }, 0);
        return sum + meshTriangles;
    }, 0);
}

function inspectOceanGlbAsset(assetDir, fileName) {
    const filePath = path.join(oceanDir, 'assets', assetDir, fileName);
    const buffer = fs.readFileSync(filePath);
    const json = parseGlbJson(buffer);
    return {
        size: buffer.byteLength,
        triangles: countGlbTriangles(json),
        animations: (json.animations || []).map((animation) => animation.name || '(unnamed)'),
        textures: json.textures?.length || 0,
        json,
    };
}

function getEmbeddedImageBytes(json) {
    return (json.images || []).map((image) => {
        const view = json.bufferViews?.[image.bufferView];
        return view?.byteLength || 0;
    });
}

function listOceanGlbFiles(assetDir) {
    const dir = path.join(oceanDir, 'assets', assetDir);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter((fileName) => fileName.endsWith('.glb'))
        .sort();
}

function inspectGlbAsset(fileName) {
    return inspectOceanGlbAsset('fauna', fileName);
}

function glbContainsAnimation(stats, animationName) {
    return stats.animations.some((clipName) => (
        clipName === animationName
        || clipName.endsWith(`|${animationName}`)
        || clipName.includes(animationName)
    ));
}

function isThirdPartyAsset(asset) {
    return asset.sourceMode?.startsWith('third-party-');
}

console.log('Test 1: Quality presets expose the AAA visual controls');
[
    'godRaySamples',
    'shaftStrength',
    'refractionEnabled',
    'dofEnabled',
    'chromaticEdge',
    'useGPUCompute',
    'occluderCount',
    'biomeSilhouetteCount',
].forEach((needle) => {
    assert(themeSource.includes(needle), `Missing preset field: ${needle}`);
});
assert(themeSource.includes('dofEnabled: true'), 'Extreme preset should enable DOF');
console.log('  PASS');

console.log('\nTest 2: Phase 5 GPU fish compute remains explicitly deferred');
assert(computeSource.includes('Simple integration'), 'Compute skeleton should remain present');
assert(
    computeSource.includes('all-pairs separation would go here'),
    'Deferred all-pairs note is missing',
);
assert(
    !fishSource.includes("from './ocean-compute.js'"),
    'Fish system should not wire compute yet',
);
assert(
    /updateSchoolFish\(\s*dt,\s*elapsed,\s*currentStrength/.test(fishSource),
    'CPU boid path should remain active',
);
console.log('  PASS');

console.log('\nTest 3: WebGPU post-processing is enabled by postProcessingEnabled');
assert(
    themeSource.includes('const postEnabled = post?.postProcessingEnabled'),
    'Post enablement flag is not used',
);
assert(
    themeSource.includes('this.isWebGPU && postEnabled'),
    'WebGPU post should be created from postEnabled',
);
assert(
    themeSource.includes('bloomStrength: post.bloom ?'),
    'Bloom strength should be zeroed when bloom is disabled',
);
assert(
    postSource.includes("this.scenePass.getTextureNode('depth')"),
    'Post pass should sample scene depth',
);
assert(
    postSource.includes('perspectiveDepthToViewZ'),
    'Post pass should convert perspective depth',
);
assert(postSource.includes('viewZToOrthographicDepth'), 'Post pass should normalize linear depth');
assert(
    postSource.includes('this.uRefractionStrength = uniform'),
    'Post pass should own screen-space refraction strength',
);
assert(
    postSource.includes('refractionOffset'),
    'Post pass should compute screen-space refraction offsets',
);
assert(
    /sampleAbsorbed\(\s*clamp\(uv\.add\(refractionOffset\)/.test(postSource),
    'Post pass should sample the resolved scene through distorted UVs',
);
console.log('  PASS');

console.log('\nTest 4: Camera DOF focal depth is plumbed into OceanPost');
assert(cameraSource.includes('normalizeFocalDepth'), 'Camera should return normalized focal depth');
assert(cameraSource.includes('camera?.near'), 'Camera focal depth should use camera near plane');
assert(cameraSource.includes('camera?.far'), 'Camera focal depth should use camera far plane');
assert(
    !cameraSource.includes('focalZ / 100'),
    'Camera focal depth should not use fixed /100 normalization',
);
assert(
    themeSource.includes('cameraState.focalDepth'),
    'Animation loop should read camera focal depth',
);
assert(
    themeSource.includes('this.oceanPost.updateParams({ focalDepth: cameraState.focalDepth })'),
    'Post focal depth update missing',
);
assert(
    postSource.includes('uDofDeadZone'),
    'Post DOF should include a dead zone to prevent all-screen blur',
);
console.log('  PASS');

console.log('\nTest 5: WebGPU visual materials animate vertices and declare emissive MRT outputs');
[
    'createWaterSurfaceNodeMaterial',
    'createSeaweedNodeMaterial',
    'createCoralNodeMaterial',
    'createJellyfishNodeMaterial',
    'createPlanktonNodeMaterial',
    'createBubbleNodeMaterial',
].forEach((factoryName) => {
    const start = materialsSource.indexOf(`export function ${factoryName}`);
    assert(start >= 0, `Missing ${factoryName}`);
    const next = materialsSource.indexOf('\nexport function ', start + 1);
    const body = materialsSource.slice(start, next === -1 ? undefined : next);
    assert(
        body.includes('material.positionNode'),
        `${factoryName} should animate vertex positions`,
    );
    assert(
        body.includes('material.emissiveNode'),
        `${factoryName} should declare an emissive MRT output`,
    );
});
assert(themeSource.includes('ensureMrtMaterials()'), 'Ocean MRT helper is missing');
assert(
    themeSource.includes('material.mrtNode = mrt({ emissive:'),
    'MRT helper should attach emissive MRT nodes',
);
console.log('  PASS');

console.log('\nTest 6: WebGL fallback still clamps to Medium');
assert(
    themeSource.includes("forceWebGL: readOceanBooleanParam('forceWebGL')"),
    'Ocean should expose the shared forceWebGL debug flag',
);
assert(
    themeSource.includes('WebGL fallback: clamping quality to Medium'),
    'Fallback clamp warning missing',
);
assert(
    themeSource.includes("this.applyQualityPreset('Medium')"),
    'Fallback should apply Medium quality',
);
assert(
    themeSource.includes('OceanPostProcessingLegacy'),
    'Legacy post-processing fallback should remain available',
);
console.log('  PASS');

console.log('\nTest 7: Ocean signoff helper and benchmark harness are wired');
assert(themeSource.includes('installSignoffHelper()'), 'Signoff helper installer missing');
assert(
    themeSource.includes('window.oceanSignoff = helper'),
    'window.oceanSignoff should be installed',
);
assert(themeSource.includes('collectSignoffSnapshot()'), 'Signoff snapshot collector missing');
assert(
    themeSource.includes('trackSignoffFrame(delta)'),
    'Animation loop should track frame budget samples',
);
assert(
    themeSource.includes('isBiomeSilhouette'),
    'Biome silhouettes should be countable in signoff snapshot',
);
assert(
    benchmarkSource.includes('Ocean AAA WebGPU Signoff Harness'),
    'Ocean benchmark harness title missing',
);
assert(
    benchmarkSource.includes('?skipIntro=1&theme=ocean'),
    'Benchmark should load Ocean runtime URL',
);
assert(
    benchmarkSource.includes('forceWebGL=1'),
    'Benchmark should expose forced WebGL fallback URL',
);
assert(
    benchmarkSource.includes('window.oceanSignoff.snapshot()'),
    'Benchmark should document the signoff helper',
);
assert(
    benchmarkSource.includes('runFrameGate') || benchmarkSource.includes('runGate'),
    'Benchmark should expose an FPS gate',
);
console.log('  PASS');

console.log('\nTest 8: WebGPU console cleanup guards stay in place');
const webgpuRendererStart = themeSource.indexOf('new THREE_WEBGPU.WebGPURenderer');
const webgpuRendererEnd = themeSource.indexOf('});', webgpuRendererStart);
const webgpuRendererBlock = themeSource.slice(webgpuRendererStart, webgpuRendererEnd);
assert(webgpuRendererStart >= 0, 'WebGPU renderer constructor missing');
assert(
    !webgpuRendererBlock.includes('powerPreference'),
    'WebGPU renderer should not pass powerPreference',
);
assert(
    themeSource.includes('isWebGPU: this.isWebGPU'),
    'OceanTheme should pass isWebGPU into fish system',
);
assert(fishSource.includes('MeshBasicNodeMaterial'), 'Fish WebGPU path should use a NodeMaterial');
assert(fishSource.includes('createFishNodeMaterial'), 'Fish NodeMaterial factory missing');
assert(
    fishSource.includes('if (isWebGPU) return createFishNodeMaterial(species)'),
    'Fish material selector should choose NodeMaterial on WebGPU',
);
assert(
    fishSource.includes('createFishGeometry(species, this.isWebGPU)')
        && fishSource.includes('if (!isWebGPU) {')
        && fishSource.includes('if (!this.isWebGPU) {'),
    'Fish WebGPU geometry should stay under the 8 vertex-buffer limit by dropping WebGL-only attributes',
);
assert(
    fishSource.includes('material.userData = { uTime, uCurrentStrength, uGlowIntensity }'),
    'Fish TSL uniforms missing',
);
assert(
    fishSource.includes('material.userData.uTime'),
    'Fish updates should support TSL uniform userData',
);
assert(
    fishSource.includes('material.emissiveNode = vec3(0.0)'),
    'Fish NodeMaterial should declare emissive MRT output',
);
assert(
    !materialsSource.includes('pointUV'),
    'Ocean WebGPU materials must not use pointUV because it compiles to gl_PointCoord',
);
assert(
    !materialsSource.includes('PointsNodeMaterial'),
    'Ocean WebGPU materials must not use PointsNodeMaterial',
);
assert(
    materialsSource.includes('safeBillboardRadialFalloff'),
    'Billboard radial falloff helper missing',
);
assert(materialsSource.includes('uv().sub(0.5)'), 'Billboards should use quad uv falloff');
[
    'createJellyfishNodeMaterial',
    'createPlanktonNodeMaterial',
    'createBubbleNodeMaterial',
    'createGameplaySiltNodeMaterial',
    'createGameplayBubbleNodeMaterial',
    'createBeamDustNodeMaterial',
    'createGlowAnchorNodeMaterial',
].forEach((factoryName) => {
    const start = materialsSource.indexOf(`export function ${factoryName}`);
    assert(start >= 0, `Missing ${factoryName}`);
    const next = materialsSource.indexOf('\nexport function ', start + 1);
    const body = materialsSource.slice(start, next === -1 ? undefined : next);
    assert(
        body.includes('new MeshBasicNodeMaterial'),
        `${factoryName} should use MeshBasicNodeMaterial for WebGPU billboards`,
    );
    assert(
        body.includes('positionLocal.mul'),
        `${factoryName} should size billboard quad vertices through positionNode`,
    );
});
assert(
    materialsSource.includes('clamp(float(1.0).sub(d), float(0.0), float(1.0))'),
    'Billboard radial falloff should clamp before fractional pow',
);
assert(
    !materialsSource.includes('pow(float(1.0).sub(d)'),
    'Billboard materials should not pow negative radial falloff',
);
assert(
    themeSource.includes('jellyfishData')
        && themeSource.includes('planktonData')
        && themeSource.includes('bubbleBillboardData')
        && themeSource.includes('updateOceanBillboards(time)')
        && themeSource.includes("userData.primitive = 'billboard-quad'"),
    'Ocean WebGPU ambient particles should use animated instanced billboard quads',
);
assert(
    atmosphereSource.includes('glowBillboardData')
        && atmosphereSource.includes('dustBillboardData')
        && atmosphereSource.includes('updateBillboards(elapsed, currentStrength)')
        && atmosphereSource.includes("userData.primitive = 'billboard-quad'"),
    'Ocean WebGPU atmosphere particles should use animated instanced billboard quads',
);
assert(
    gameplayEffectsSource.includes('new THREE.InstancedMesh(geometry, material, maxParticles)')
        && gameplayEffectsSource.includes('updateParticleBillboards')
        && gameplayEffectsSource.includes("primitive = 'billboard-quad'"),
    'Ocean WebGPU gameplay particles should use pooled instanced billboard quads',
);
assert(
    !materialsSource.includes('faux refraction')
        && !materialsSource.includes("We don't sample the scene texture"),
    'Water material should not describe shimmer as the real refraction implementation',
);
assert(
    atmosphereSource.includes('geometry.computeVertexNormals();'),
    'Custom WebGPU mesh geometry should compute normals',
);
console.log('  PASS');

console.log('\nTest 9: Signoff reports truthful compute/refraction/camera status');
assert(themeSource.includes('compute: {'), 'Signoff snapshot should include compute metadata');
assert(
    themeSource.includes("fish: 'cpu-deferred'"),
    'Fish compute status should be reported as deferred CPU',
);
assert(
    themeSource.includes('refractionSource:'),
    'Signoff snapshot should include refraction source metadata',
);
assert(
    themeSource.includes("'post-screen-space'"),
    'Refraction source should report post screen-space path',
);
assert(
    fishSource.includes('hasHeroFishInView'),
    'Fish system should expose hero visibility for camera Trail mood',
);
assert(
    themeSource.includes('heroFishVisible = this.fishSystem?.hasHeroFishInView?.() === true'),
    'Animation loop should pass real hero fish visibility into OceanCamera',
);
assert(
    themeSource.includes('OCEAN_ART_DIRECTION')
        && themeSource.includes("mode: 'showcase-reef-canyon'")
        && themeSource.includes("assetStrategy: 'poly-pizza-hero-reef-procedural-volume'")
        && themeSource.includes("heroAssetSourcePolicy: 'CC0-preferred-CC-BY-with-attribution'")
        && themeSource.includes("tonalBalance: 'bright-shallow-canyon-saturated-midground'")
        && themeSource.includes('proprietaryAssets: false'),
    'Ocean signoff should declare the showcase reef canyon art direction',
);
assert(
    themeSource.includes('OCEAN_READABILITY_ZONE')
        && themeSource.includes('isGameplayReadabilityZone')
        && themeSource.includes('nudgeOutOfReadabilityZone')
        && themeSource.includes('habitat: this.habitatMetrics'),
    'Ocean habitat signoff should expose the central readability-safe procedural layout',
);
assert(
    cameraSource.includes('reefForwardDefault: true')
        && cameraSource.includes('collectSignoff()')
        && themeSource.includes('camera: this.oceanCamera?.collectSignoff?.()'),
    'Ocean camera should expose reef-forward mood metadata',
);
console.log('  PASS');

console.log('\nTest 9b: Procedural ABZU-inspired habitat polish is code-native');
[
    'rippleBands',
    'terraceBands',
    'sanctuaryBowl',
    'plate',
    'anemone',
    'coral-sanctuary',
    'kelpCurtainBias',
    'isKelpCurtain',
    'restrainedBubbleColumns',
    'depthAbsorption',
    'reefShelfTerraces',
    'foregroundSandChannel',
    'shortGrass',
    'ribbonKelp',
    'tallAccentBlades',
    'reefGardenClusters',
    'reefAnchoredPlankton',
    'ROCK_REEF_CLUSTERS',
].forEach((needle) => {
    assert(
        themeSource.includes(needle)
            || materialsSource.includes(needle)
            || atmosphereSource.includes(needle),
        `Missing procedural habitat signal: ${needle}`,
    );
});
assert(
    materialsSource.includes('Procedural sand ripple bands')
        && materialsSource.includes('cyan-surface') === false,
    'Seabed polish should be procedural, not a raster/logo asset',
);
assert(
    themeSource.includes('aBladeWidth')
        && themeSource.includes('aBladeType')
        && materialsSource.includes("attribute('aBladeWidth')")
        && materialsSource.includes("attribute('aBladeType')"),
    'Seaweed should expose instanced blade variety for grass/kelp/accent silhouettes',
);
assert(
    themeSource.includes('sampleReefGardenPoint')
        && themeSource.includes('spire')
        && themeSource.includes('shell'),
    'Coral should be clustered into reef gardens with richer procedural colony types',
);
assert(
    atmosphereSource.includes('new THREE.IcosahedronGeometry(1, 2)')
        && atmosphereSource.includes('striation')
        && atmosphereSource.includes('randRange(12, 24)'),
    'Atmospheric rocks should be smaller clustered reef stones with darker stylized detail',
);
assert(
    fishSource.includes('sunlit-bannerfish')
        && fishSource.includes('hasHeroFishInView(margin = 0.14)'),
    'Fish system should include brighter sanctuary species and improved hero visibility',
);
assert(
    rareFaunaSource.includes('0xa4cdd0')
        && rareFaunaSource.includes('0x8aa98e')
        && rareFaunaSource.includes('rearZ = randRange(this.rng, -105, -50)'),
    'Rare fauna should be retinted and staged as distant underwater cameos',
);
console.log('  PASS');

console.log('\nTest 10: Ocean gameplay lock/combo effects are event-driven and pooled');
assert(
    themeSource.includes("from './ocean-gameplay-effects.js'"),
    'OceanTheme should import the gameplay effects controller',
);
assert(
    themeSource.includes('new OceanGameplayEffects'),
    'OceanTheme should create the gameplay effects controller',
);
assert(themeSource.includes('EVENTS.PIECE_LOCK'), 'OceanTheme should listen for piece lock events');
assert(
    themeSource.includes('triggerPieceLock')
        && themeSource.includes('triggerCombo')
        && themeSource.includes('triggerLineClear'),
    'OceanTheme should forward lock/combo/line-clear events into gameplay effects',
);
assert(
    themeSource.includes('backgroundComboEffects !== false'),
    'Ocean gameplay effects should default on when backgroundComboEffects is missing',
);
assert(
    gameplayEffectsSource.includes('payload?.position')
        && gameplayEffectsSource.includes('positionAsWorld')
        && gameplayEffectsSource.includes('screenRaycaster.setFromCamera')
        && gameplayEffectsSource.includes('intersectPlane'),
    'Gameplay effects should resolve Serenity screen-coordinate anchors without breaking world positions',
);
assert(
    gameplayEffectsSource.includes('lastTriggerType')
        && gameplayEffectsSource.includes('triggerLineClear(payload = {})'),
    'Gameplay signoff should report the last trigger and line-clear pulse path',
);
['triggerPieceLock', 'triggerCombo', 'update(delta, time)', 'dispose()', 'collectSignoff'].forEach(
    (methodName) => {
        assert(
            gameplayEffectsSource.includes(methodName),
            `Missing gameplay method: ${methodName}`,
        );
    },
);
['ripplePool', 'siltPool', 'bubblePool', 'ribbonPool'].forEach((poolName) => {
    assert(gameplayEffectsSource.includes(poolName), `Missing pooled effect: ${poolName}`);
});
assert(
    gameplayEffectsSource.includes('QUALITY_EFFECT_LIMITS'),
    'Gameplay effects should define quality-scaled pool caps',
);
assert(
    gameplayEffectsSource.includes('comboSurge')
        && gameplayEffectsSource.includes('gameplayPulse')
        && gameplayEffectsSource.includes('causticSweepStrength'),
    'Gameplay effects should maintain a single decaying surge/pulse state',
);
console.log('  PASS');

console.log('\nTest 11: Gameplay post uniforms and materials are wired');
[
    'createGameplayRippleNodeMaterial',
    'createGameplaySiltNodeMaterial',
    'createGameplayBubbleNodeMaterial',
    'createGameplayCausticRibbonNodeMaterial',
].forEach((factoryName) => {
    assert(materialsSource.includes(`export function ${factoryName}`), `Missing ${factoryName}`);
});
['uGameplayPulse', 'uComboSurge', 'uCausticSweepStrength'].forEach((uniformName) => {
    assert(postSource.includes(uniformName), `Post pass missing ${uniformName}`);
});
assert(
    postSource.includes('gameplayRefractionMask'),
    'Gameplay pulse should feed subtle post refraction',
);
assert(
    postSource.includes('gameplayCaustic'),
    'Gameplay caustic sweep should be part of post grading',
);
assert(
    themeSource.includes('gameplayEffects: this.gameplayEffects?.collectSignoff?.()'),
    'Signoff snapshot should report gameplay effect state',
);
console.log('  PASS');

console.log('\nTest 12: Combo tier response is clamped and theme-specific');
assert(
    gameplayEffectsSource.includes('maxComboSurge'),
    'Combo surge should clamp by quality preset',
);
assert(
    gameplayEffectsSource.includes('fishResponse')
        && gameplayEffectsSource.includes('triggerGameplaySurge'),
    'Ultra/Extreme combos should be able to trigger fish schooling response',
);
assert(
    fishSource.includes('triggerGameplaySurge') && fishSource.includes('gameplaySurgeAnchor'),
    'Fish system should expose a gameplay surge response',
);
assert(
    gameplayEffectsSource.includes('Math.abs(x) < 24'),
    'Piece lock anchors should avoid the board center',
);
assert(
    gameplayEffectsSource.includes('jellyfishCoralResonance'),
    'Signoff should report high-quality reef resonance capability',
);
console.log('  PASS');

console.log('\nTest 13: Cinematic lock + combo enhancements are wired');
// Shockwave pool primitive exists alongside the existing ripple pool.
assert(
    materialsSource.includes('export function createGameplayShockwaveNodeMaterial'),
    'Shockwave material factory missing',
);
assert(
    gameplayEffectsSource.includes('shockwavePool')
        && gameplayEffectsSource.includes('createShockwavePool')
        && gameplayEffectsSource.includes('spawnShockwave'),
    'Shockwave pool and spawn helper missing',
);
// New quality fields per preset (shockwaves, plumeBubbles, cameraShake, chromaticAberration).
['shockwaves:', 'plumeBubbles:', 'cameraShake:', 'chromaticAberration:'].forEach((field) => {
    assert(
        gameplayEffectsSource.includes(field),
        `Quality preset should expose ${field}`,
    );
});
// Envelope state replaces the old Math.max snap so combos visibly attack-then-decay.
assert(
    gameplayEffectsSource.includes('pulseTarget')
        && gameplayEffectsSource.includes('surgeTarget')
        && gameplayEffectsSource.includes('sweepTarget'),
    'Surge envelope target state missing',
);
// First combo ribbon is anchored to the play site (not the random fallback).
assert(
    /ribbonAnchor\s*=\s*i\s*===\s*0\s*\?\s*anchor\.clone\(\)/.test(gameplayEffectsSource),
    'First combo ribbon should anchor to play site',
);
// Camera shake impulse API.
assert(
    cameraSource.includes('applyShakeImpulse(')
        && cameraSource.includes('shakeMagnitude')
        && cameraSource.includes('Math.exp(-delta / this.shakeTau)'),
    'Camera shake impulse with exponential decay missing',
);
assert(
    cameraSource.includes('requestImpulseMood(')
        && cameraSource.includes('holdMood'),
    'Camera hero-moment mood hold missing',
);
// Theme passes camera into gameplay effects.
assert(
    /getCamera:\s*\(\)\s*=>\s*this\.oceanCamera/.test(themeSource),
    'OceanTheme should pass getCamera into OceanGameplayEffects',
);
// Tetris hero-moment branch.
assert(
    gameplayEffectsSource.includes('isTetris'),
    'triggerLineClear should special-case Tetris',
);
// Fish scatter strengthened (3.4 acceleration constant, 165 falloff radius).
assert(
    fishSource.includes('response * 3.4') && fishSource.includes('surgeDist / 165'),
    'Fish scatter constants should be strengthened',
);
// Surge-driven chromatic aberration boost in WebGPU post.
assert(
    postSource.includes('baseChromaStrength')
        && postSource.includes('chromaSurgeBoost')
        && postSource.includes('this.uChromaStrength.value = this.baseChromaStrength + surgeBoost'),
    'Combo surge should boost chromatic aberration in WebGPU post',
);
// Strengthened post coefficients.
assert(
    postSource.includes('uGameplayPulse).mul(0.45)'),
    'Gameplay refraction multiplier should be raised',
);
assert(
    postSource.includes('uComboSurge.mul(0.7)'),
    'God-ray surge coefficient should be raised',
);
console.log('  PASS');

console.log('\nTest 14: Cinematic runtime behavior respects quality gates and anchors');
const expectedEffectLimits = {
    Minimal: {
        shockwaves: 0,
        plumeBubbles: 0,
        cameraShake: 'none',
        chromaticAberration: false,
    },
    Low: {
        shockwaves: 0,
        plumeBubbles: 6,
        cameraShake: 'none',
        chromaticAberration: false,
    },
    Medium: {
        shockwaves: 2,
        plumeBubbles: 10,
        cameraShake: 'subtle',
        chromaticAberration: false,
    },
    High: {
        shockwaves: 3,
        plumeBubbles: 14,
        cameraShake: 'standard',
        chromaticAberration: true,
    },
    Ultra: {
        shockwaves: 4,
        plumeBubbles: 18,
        cameraShake: 'cinematic',
        chromaticAberration: true,
    },
    Extreme: {
        shockwaves: 5,
        plumeBubbles: 22,
        cameraShake: 'cinematic',
        chromaticAberration: true,
    },
};

Object.entries(expectedEffectLimits).forEach(([quality, expected]) => {
    const actual = QUALITY_EFFECT_LIMITS[quality];
    assert.deepStrictEqual(
        {
            shockwaves: actual.shockwaves,
            plumeBubbles: actual.plumeBubbles,
            cameraShake: actual.cameraShake,
            chromaticAberration: actual.chromaticAberration,
        },
        expected,
        `${quality} cinematic effect limits changed unexpectedly`,
    );
});

const postUpdates = [];
const mediumEffects = new OceanGameplayEffects({
    quality: 'Medium',
    getPost: () => ({
        updateParams: (params) => postUpdates.push(params),
    }),
});
mediumEffects.triggerCombo({ comboCount: 8 });
assert(
    mediumEffects.surgeTarget <= mediumEffects.limits.maxComboSurge,
    'Medium combo surge target should stay within quality maxComboSurge',
);
mediumEffects.update(0.016, 0.1);
assert.strictEqual(
    postUpdates.at(-1).chromaticAberrationEnabled,
    false,
    'Medium should pass chromaticAberrationEnabled=false to post',
);

const highPostUpdates = [];
const highEffects = new OceanGameplayEffects({
    quality: 'High',
    getPost: () => ({
        updateParams: (params) => highPostUpdates.push(params),
    }),
});
highEffects.triggerCombo({ comboCount: 8 });
highEffects.update(0.016, 0.1);
assert.strictEqual(
    highPostUpdates.at(-1).chromaticAberrationEnabled,
    true,
    'High should pass chromaticAberrationEnabled=true to post',
);

const anchorScene = new THREE.Scene();
const anchoredEffects = new OceanGameplayEffects({ scene: anchorScene, quality: 'High' });
anchoredEffects.init();
anchoredEffects.triggerPieceLock({
    piece: {
        x: 3,
        y: 16,
        shape: [[1, 1, 1, 1]],
    },
});
const lastAnchor = anchoredEffects.lastPlayAnchor.clone();
const fallbackBeforeCombo = anchoredEffects.fallbackAnchorIndex;
anchoredEffects.triggerCombo({ comboCount: 5 });
const firstComboRibbon = anchoredEffects.ribbonPool.find((item) => item.userData.effect.active);
assert(firstComboRibbon, 'Combo should spawn an anchored ribbon at High quality');
assert.strictEqual(
    anchoredEffects.fallbackAnchorIndex,
    fallbackBeforeCombo + 1,
    'Combo should only use fallback anchors for additional fan ribbons',
);
assert(
    Math.abs(firstComboRibbon.position.x - lastAnchor.x) < 0.001
        && Math.abs(firstComboRibbon.position.z - lastAnchor.z) < 0.001,
    'First combo ribbon should reuse the last piece-lock anchor',
);

const lineScene = new THREE.Scene();
const lineEffects = new OceanGameplayEffects({ scene: lineScene, quality: 'High' });
lineEffects.init();
lineEffects.lastPlayAnchor = lastAnchor.clone();
lineEffects.triggerLineClear({ lineCount: 1 });
const lineShockwave = lineEffects.shockwavePool.find((item) => item.userData.effect.active);
assert(lineShockwave, 'Single line clear should spawn a shockwave at High quality');
assert.strictEqual(lineEffects.fallbackAnchorIndex, 0, 'Line clear should reuse last anchor without fallback');
assert.strictEqual(lineShockwave.userData.effect.intensity, 0.7, 'Single line clear shockwave alpha should be 0.70');
assert(
    Math.abs(lineShockwave.position.x - lastAnchor.x) < 0.001
        && Math.abs(lineShockwave.position.z - lastAnchor.z) < 0.001,
    'Line clear shockwave should reuse the last piece-lock anchor',
);
console.log('  PASS');

console.log('\nTest 15: Rare fauna cameos are budgeted, gated, and locally interactive');
assert(
    themeSource.includes("from './ocean-rare-fauna-system.js'"),
    'OceanTheme should import the rare fauna system',
);
assert(
    themeSource.includes('createRareFauna()')
        && themeSource.includes('this.rareFaunaSystem?.update(delta, time')
        && themeSource.includes('this.rareFaunaSystem.dispose()'),
    'OceanTheme should create, update, and dispose rare fauna',
);
assert(
    themeSource.includes('forceRareFauna')
        && themeSource.includes('rareFauna: this.rareFaunaSystem?.collectSignoff?.()'),
    'Signoff helper should expose rare fauna debug spawning and snapshot state',
);
[
    'enabled: false',
    'maxActive: 0',
    'turtleCooldown: [240, 420]',
    'sharkCooldown: [480, 780]',
    'turtleCooldown: [150, 300]',
    'sharkCooldown: [360, 600]',
].forEach((needle) => {
    assert(themeSource.includes(needle), `Rare fauna preset missing ${needle}`);
});
[
    'GLTFLoader',
    'AnimationMixer',
    'TURTLE_VARIANTS',
    'PLAYFIELD_SAFE_Z',
    'forceSpawn(kind =',
    'addEnvironmentalInfluence',
].forEach((needle) => {
    assert(rareFaunaSource.includes(needle), `Rare fauna system missing ${needle}`);
});

const faunaAssetDir = path.join(oceanDir, 'assets', 'fauna');
const sharkAsset = fs.statSync(path.join(faunaAssetDir, 'rare-shark.glb'));
const turtleAsset = fs.statSync(path.join(faunaAssetDir, 'rare-turtle.glb'));
assert(sharkAsset.size > 1024 && sharkAsset.size < 300 * 1024, 'Shark GLB should stay under 300 KB');
assert(
    turtleAsset.size > 1024 && turtleAsset.size < 1536 * 1024,
    'Turtle GLB should stay under 1.5 MB',
);

const deterministicRareFauna = new OceanRareFaunaSystem({
    preset: {
        rareFauna: {
            enabled: true,
            maxActive: 1,
            firstSpawnDelay: 90,
            turtleCooldown: [150, 150],
            sharkCooldown: [360, 360],
        },
    },
    rng: () => 0,
});
assert.strictEqual(
    deterministicRareFauna.selectDueKind(89.99),
    null,
    'Rare fauna should not become due before the first-spawn delay',
);
assert.strictEqual(
    deterministicRareFauna.selectDueKind(90),
    'dolphin',
    'Dolphin should be the first eligible deterministic cameo with the current rare fauna kind order',
);
deterministicRareFauna.updateQuietWindow(100, 1.3, 0);
assert(
    deterministicRareFauna.collectSignoff().quietFor >= 12,
    'Gameplay intensity should suppress rare fauna spawns for a quiet window',
);
deterministicRareFauna.scheduleNext('turtle', 100);
assert.strictEqual(
    deterministicRareFauna.nextByKind.turtle,
    250,
    'Turtle scheduler should use the configured cooldown range',
);

const fishScene = new THREE.Scene();
const fishSystem = new OceanFishSystem({
    scene: fishScene,
    camera: new THREE.PerspectiveCamera(),
    preset: { fishCount: 12, heroFishCount: 0 },
    getSeabedHeight: () => -20,
    isWebGPU: true,
});
fishSystem.init();
fishSystem.addEnvironmentalInfluence({
    kind: 'predator',
    position: new THREE.Vector3(0, 24, -40),
    radius: 80,
    strength: 0.8,
    duration: 0.04,
});
assert.strictEqual(
    fishSystem.environmentalInfluences.length,
    1,
    'Fish system should accept rare fauna environmental influences',
);
const gameplaySurgeBeforeInfluence = fishSystem.gameplaySurge;
fishSystem.update(0.016, 0.016, { currentStrength: 0.5, glowIntensity: 0.8 });
assert.strictEqual(
    fishSystem.gameplaySurge,
    gameplaySurgeBeforeInfluence,
    'Rare fauna influence should not mutate gameplay surge state',
);
fishSystem.update(0.033, 0.049, { currentStrength: 0.5, glowIntensity: 0.8 });
fishSystem.update(0.033, 0.082, { currentStrength: 0.5, glowIntensity: 0.8 });
fishSystem.update(0.033, 0.115, { currentStrength: 0.5, glowIntensity: 0.8 });
assert.strictEqual(
    fishSystem.environmentalInfluences.length,
    0,
    'Rare fauna environmental influence should decay out',
);
fishSystem.dispose();
console.log('  PASS');

console.log('\nTest 16: Ocean fauna GLBs, manifest, and runtime layer stay budgeted');
assert.strictEqual(
    OCEAN_FAUNA_ASSET_VERSION,
    'v7-triposr-seahorse',
    'Fauna asset version should identify the current TripoSR seahorse integration',
);
assert.strictEqual(
    OCEAN_FAUNA_GENERATION_CONTRACT.coordinateForward,
    '+X',
    'Fauna asset coordinate contract should swim along local +X',
);
assert.strictEqual(OCEAN_FAUNA_GENERATION_CONTRACT.yUp, true, 'Fauna assets should be Y-up');
assert.strictEqual(
    OCEAN_FAUNA_GENERATION_CONTRACT.noProprietaryArtwork,
    true,
    'Fauna manifest should forbid proprietary copied artwork',
);
[
    'rare-shark-quaternius.glb',
    'rare-turtle-kenchoo.glb',
    'rare-shark-v2.glb',
    'rare-turtle-v2.glb',
    'hero-reef-fish.glb',
    'hero-bannerfish.glb',
    'hero-angelfish.glb',
    'hero-mandarinfish.glb',
    'hero-fish-quaternius-a.glb',
    'self-generated',
    'third-party-cc0',
    'third-party-cc-by',
    'blender-mcp-project-authored',
    'blender-only-project-authored',
    'MIT-project-local',
    'CC0',
    'CC-BY',
    'noAbzuLogoTextOrCopiedScenes',
    'blenderMcpSketchfabStatus',
].forEach((needle) => {
    assert(faunaManifestSource.includes(needle), `Fauna manifest missing ${needle}`);
});

[
    OCEAN_RARE_FAUNA_ASSETS.shark.primary,
    OCEAN_RARE_FAUNA_ASSETS.turtle.primary,
    ...OCEAN_HERO_FISH_ASSETS,
].forEach((asset) => {
    const stats = inspectGlbAsset(asset.fileName);
    const thirdParty = isThirdPartyAsset(asset);
    const effectiveMaxBytes = asset.id === 'rare-turtle-kenchoo'
        ? 4 * 1024 * 1024
        : asset.maxBytes;
    assert(
        stats.size > 1024 && stats.size <= effectiveMaxBytes,
        `${asset.id} should stay within byte budget`,
    );
    if (!thirdParty && Number.isFinite(asset.byteSize)) {
        assert.strictEqual(stats.size, asset.byteSize, `${asset.id} manifest byteSize is stale`);
    }
    if (!thirdParty && Number.isFinite(asset.triangleCount)) {
        assert.strictEqual(
            stats.triangles,
            asset.triangleCount,
            `${asset.id} manifest triangleCount is stale`,
        );
    }
    assert(
        stats.triangles >= asset.triangleBudget.min
            && stats.triangles <= asset.triangleBudget.max,
        `${asset.id} should stay within triangle budget`,
    );
    assert(
        stats.textures <= (thirdParty ? 8 : asset.textureBudget),
        `${asset.id} should stay within texture budget`,
    );
    if (!thirdParty && Number.isFinite(asset.textureCount)) {
        assert.strictEqual(stats.textures, asset.textureCount, `${asset.id} manifest textureCount is stale`);
    }
    asset.animationNames.forEach((animationName) => {
        assert(
            glbContainsAnimation(stats, animationName) || (thirdParty && stats.animations.length > 0),
            `${asset.id} missing animation ${animationName}`,
        );
    });
    assert(
        [
            'self-generated',
            'blender-mcp-project-authored',
            'blender-only-project-authored',
            'third-party-cc0',
            'third-party-cc-by',
        ].includes(asset.sourceMode),
        `${asset.id} source mode should be approved`,
    );
    assert(
        ['MIT-project-local', 'CC0', 'CC-BY', 'CC-BY-4.0'].includes(asset.license),
        `${asset.id} license should be approved`,
    );
});

[
    OCEAN_RARE_FAUNA_ASSETS.shark.fallback,
    OCEAN_RARE_FAUNA_ASSETS.turtle.fallback,
].forEach((asset) => {
    const stats = inspectGlbAsset(asset.fileName);
    assert.strictEqual(asset.fallback, true, `${asset.id} should be marked as fallback`);
    assert(
        stats.size > 1024 && stats.size <= asset.maxBytes,
        `${asset.id} fallback should remain available and budgeted`,
    );
    asset.animationNames.forEach((animationName) => {
        assert(glbContainsAnimation(stats, animationName), `${asset.id} missing fallback animation`);
    });
});

[
    'getRareFaunaAssetCandidates',
    'fallbackUsed',
    'assetRuntime',
    'SHARK_PHASE_CLIPS',
    'playCreatureClip',
    'activeClipName',
    'sharkBehavior',
    'assetManifest: summarizeFaunaAssetManifest().rareFauna',
].forEach((needle) => {
    assert(rareFaunaSource.includes(needle), `Rare fauna runtime missing ${needle}`);
});
[
    'GLTFLoader',
    'SkeletonUtils',
    'OCEAN_HERO_FISH_ASSETS',
    'initHeroAssetLayer',
    'new THREE.InstancedMesh',
    'HERO_ASSET_MAX_ACTIVE',
    'schoolThreatOffsets',
    'proceduralSchoolsInstanced: true',
    'summarizeFaunaAssetManifest().heroFish',
].forEach((needle) => {
    assert(fishSource.includes(needle), `Fish runtime missing ${needle}`);
});
assert(
    themeSource.includes('faunaAssets: {')
        && themeSource.includes('forceHeroFish')
        && themeSource.includes('fish: this.fishSystem?.collectSignoff?.()'),
    'Ocean signoff should expose fauna asset metadata and hero fish debug spawning',
);

const heroBudgetSystem = new OceanFishSystem({
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    preset: { fishCount: 0, heroFishCount: 20 },
    getSeabedHeight: () => -20,
});
const heroBudgetSignoff = heroBudgetSystem.collectSignoff();
assert.strictEqual(
    heroBudgetSignoff.heroAssetLayer.requestedCount,
    5,
    'Hero GLB fish should cap to a few premium near-pass models',
);
assert.strictEqual(
    heroBudgetSignoff.heroAssetLayer.maxActive,
    7,
    'Hero GLB fish runtime cap should allow seven premium near-pass models',
);
assert.strictEqual(
    heroBudgetSignoff.proceduralSchoolsInstanced,
    true,
    'Procedural schools should remain instanced while hero GLBs are additive',
);
heroBudgetSystem.dispose();

console.log('\nTest 16a: Ocean bottom assets reject heavy embedded texture regressions');
const rockGlbs = listOceanGlbFiles('rocks');
const rockRecords = getHeroRockAssetRecords();
const rockRecordsByFile = new Map(rockRecords.map((asset) => [asset.fileName, asset]));
assert.strictEqual(
    rockGlbs.length,
    rockRecords.length,
    'Committed rock GLBs should be represented by the rock manifest',
);
rockGlbs.forEach((fileName) => {
    const stats = inspectOceanGlbAsset('rocks', fileName);
    const asset = rockRecordsByFile.get(fileName);
    assert(asset, `${fileName} should have rock manifest metadata`);
    assert(
        stats.size <= asset.maxBytes,
        `${fileName} should stay tiny; foreground rocks remain detail-only GLBs`,
    );
    assert.strictEqual(stats.size, asset.byteSize, `${asset.id} manifest byteSize is stale`);
    assert.strictEqual(stats.triangles, asset.triangleCount, `${asset.id} manifest triangleCount is stale`);
    assert(stats.triangles >= asset.triangleBudget.min, `${asset.id} should stay within triangle budget`);
    assert(stats.triangles <= asset.triangleBudget.max, `${asset.id} should stay within triangle budget`);
    assert(stats.textures <= asset.textureBudget, `${asset.id} should stay within texture budget`);
    assert.strictEqual(stats.textures, asset.textureCount, `${asset.id} manifest textureCount is stale`);
    assert.strictEqual(asset.sourceMode, 'third-party-cc0', `${asset.id} should be CC0 sourced`);
    assert.strictEqual(asset.license, 'CC0', `${asset.id} license should be CC0`);
});

['reef', 'corals', 'kelp', 'rocks'].forEach((assetDir) => {
    listOceanGlbFiles(assetDir).forEach((fileName) => {
        const stats = inspectOceanGlbAsset(assetDir, fileName);
        const imageBytes = getEmbeddedImageBytes(stats.json);
        const totalImageBytes = imageBytes.reduce((sum, bytes) => sum + bytes, 0);
        assert(
            imageBytes.every((bytes) => bytes <= 1024 * 1024),
            `${assetDir}/${fileName} embeds an oversized single texture`,
        );
        assert(
            totalImageBytes <= 1536 * 1024,
            `${assetDir}/${fileName} embeds too much texture data`,
        );
    });
});

const coralArchRecord = getHeroReefAssetRecords()
    .find((asset) => asset.fileName === 'reef-arch-coral-01.glb');
assert(coralArchRecord, 'reef-arch-coral-01 should be in the reef manifest');
const coralArchStats = inspectOceanGlbAsset('reef', 'reef-arch-coral-01.glb');
assert(
    coralArchStats.size <= coralArchRecord.maxBytes,
    'reef-arch-coral-01 should stay under the 1 MB reef budget',
);
assert.strictEqual(coralArchStats.textures, 0, 'reef-arch-coral-01 should not embed textures');
assert.strictEqual(
    coralArchStats.size,
    coralArchRecord.byteSize,
    'reef-arch-coral-01 manifest byteSize is stale',
);
assert.strictEqual(
    coralArchStats.triangles,
    coralArchRecord.triangleCount,
    'reef-arch-coral-01 manifest triangleCount is stale',
);
assert(
    themeSource.includes('coralOvergrowthPerRock: 3')
        && !themeSource.includes('coralOvergrowthPerRock: 5')
        && !themeSource.includes('coralOvergrowthPerRock: 6'),
    'High/Ultra/Extreme overgrowth density should stay capped after the performance rollback',
);
assert(
    atmosphereSource.includes('procedural-instanced')
        && atmosphereSource.includes('foregroundRockGlbEnabled')
        && atmosphereSource.includes('importedSeabedDetails')
        && atmosphereSource.includes('bottomAssets:'),
    'Bottom signoff should expose procedural rocks, imported details, and instanced overgrowth status',
);
console.log('  PASS');

console.log('\nTest 16b: Ocean environment GLBs are manifest-driven, attributed, and budgeted');
[
    'OCEAN_CORAL_ASSET_VERSION',
    'getHeroCoralAssetRecords',
    'blender-only-project-authored',
    'CC0-preferred-CC-BY-with-attribution',
    'noPaidMarketplaceAssets',
    'preserve-pbr-underwater-rim',
].forEach((needle) => {
    assert(coralManifestSource.includes(needle), `Coral manifest missing ${needle}`);
});
[
    'OCEAN_KELP_ASSET_VERSION',
    'getHeroKelpAssetRecords',
    'getSeabedPlantAssetRecords',
    'CC0-preferred-CC-BY-with-attribution',
    'noPaidMarketplaceAssets',
    'runtime-height-sway',
    'targetMaxBytes',
].forEach((needle) => {
    assert(kelpManifestSource.includes(needle), `Kelp manifest missing ${needle}`);
});
[
    'OCEAN_ROCK_ASSET_VERSION',
    'getHeroRockAssetRecords',
    'CC0-preferred-tiny-shape-only',
    'noPaidMarketplaceAssets',
    'runtime-rock-material-override',
].forEach((needle) => {
    assert(rockManifestSource.includes(needle), `Rock manifest missing ${needle}`);
});
[
    'createHeroCorals()',
    'createHeroKelp()',
    'createImportedSeabedDetails()',
    'upgradeHeroCoralsFromGLB',
    'upgradeHeroKelpFromGLB',
    'upgradeImportedSeabedDetailsFromGLB',
    'addNormalizedHeightAttribute',
    'setSeabedAnchoredPosition',
    'collectSignoff()',
    'isOceanHeroCoral',
    'isOceanHeroKelp',
    'importedSeabedDetails',
].forEach((needle) => {
    assert(atmosphereSource.includes(needle), `Atmosphere runtime missing ${needle}`);
});
assert(
    themeSource.includes('heroAssetSourcePolicy: \'CC0-preferred-CC-BY-with-attribution\'')
        && themeSource.includes('importedSeabedDetailCount')
        && themeSource.includes('atmosphereAssets: this.atmosphereSystem?.collectSignoff?.()'),
    'Ocean signoff should expose Poly Pizza environment policy and status',
);

const coralRecords = getHeroCoralAssetRecords();
const kelpRecords = getHeroKelpAssetRecords();
const seabedPlantRecords = getSeabedPlantAssetRecords();
assert(coralRecords.length >= 6, 'Hero coral manifest should expose at least six GLBs');
assert(kelpRecords.length >= 4, 'Hero kelp manifest should expose at least four GLBs');
assert(seabedPlantRecords.length >= 3, 'Seabed plant manifest should expose imported grass/detail GLBs');
coralRecords.forEach((asset) => {
    const stats = inspectOceanGlbAsset('corals', asset.fileName);
    assert.strictEqual(stats.size, asset.byteSize, `${asset.id} manifest byteSize is stale`);
    assert.strictEqual(stats.triangles, asset.triangleCount, `${asset.id} manifest triangleCount is stale`);
    assert(stats.size <= asset.maxBytes, `${asset.id} should stay within byte budget`);
    assert(stats.triangles > 1000, `${asset.id} should be a hero-quality mesh`);
    assert(stats.triangles <= asset.triangleBudget.max, `${asset.id} should stay within triangle budget`);
    assert(
        ['MIT-project-local', 'CC0', 'CC-BY-4.0'].includes(asset.license),
        `${asset.id} should use an approved environment asset license`,
    );
});
kelpRecords.forEach((asset) => {
    const stats = inspectOceanGlbAsset('kelp', asset.fileName);
    assert.strictEqual(stats.size, asset.byteSize, `${asset.id} manifest byteSize is stale`);
    assert.strictEqual(stats.triangles, asset.triangleCount, `${asset.id} manifest triangleCount is stale`);
    assert(stats.size <= asset.maxBytes, `${asset.id} should stay within byte budget`);
    assert(stats.triangles >= asset.triangleBudget.min, `${asset.id} should stay within triangle budget`);
    assert(stats.triangles <= asset.triangleBudget.max, `${asset.id} should stay within triangle budget`);
    assert(
        ['MIT-project-local', 'CC0', 'CC-BY-4.0'].includes(asset.license),
        `${asset.id} should use an approved environment asset license`,
    );
});
seabedPlantRecords.forEach((asset) => {
    const stats = inspectOceanGlbAsset('kelp', asset.fileName);
    assert.strictEqual(stats.size, asset.byteSize, `${asset.id} manifest byteSize is stale`);
    assert.strictEqual(stats.triangles, asset.triangleCount, `${asset.id} manifest triangleCount is stale`);
    assert(stats.size <= asset.maxBytes, `${asset.id} should stay within byte budget`);
    assert(stats.triangles >= asset.triangleBudget.min, `${asset.id} should stay within triangle budget`);
    assert(stats.triangles <= asset.triangleBudget.max, `${asset.id} should stay within triangle budget`);
    assert.strictEqual(asset.license, 'CC0', `${asset.id} should be CC0 for dense seabed detail`);
});
assert.strictEqual(
    summarizeCoralAssetManifest().contract.noPaidMarketplaceAssets,
    true,
    'Coral authoring contract should forbid paid marketplace assets',
);
assert.strictEqual(
    summarizeKelpAssetManifest().contract.noPaidMarketplaceAssets,
    true,
    'Kelp authoring contract should forbid paid marketplace assets',
);
assert.strictEqual(
    summarizeRockAssetManifest().contract.noPaidMarketplaceAssets,
    true,
    'Rock authoring contract should forbid paid marketplace assets',
);
[
    'MiniPoly',
    'Laney XR Labs',
    'Poly by Google',
    'Christopher F',
    'Quaternius',
    'Kenney',
    'CC-BY 4.0',
    'Public Domain (CC0)',
].forEach((needle) => {
    assert(environmentAttributionSource.includes(needle), `Environment attribution missing ${needle}`);
});
console.log('  PASS');

console.log('\nTest 16c: Showcase reef canyon GLBs are manifest-driven and budgeted');
[
    'OCEAN_REEF_ASSET_VERSION',
    'getHeroReefAssetRecords',
    'blender-only-project-authored',
    'preserve-pbr-caustic-rim',
].forEach((needle) => {
    assert(reefManifestSource.includes(needle), `Reef manifest missing ${needle}`);
});
[
    'createHeroReefWalls()',
    'createCoralCarpetPatches()',
    'upgradeHeroReefWallsFromGLB',
    'upgradeCoralCarpetPatchesFromGLB',
    'isOceanHeroReefWall',
    'isOceanCoralCarpetPatch',
    'heroReefWalls',
    'coralCarpetPatches',
].forEach((needle) => {
    assert(atmosphereSource.includes(needle), `Showcase reef runtime missing ${needle}`);
});
[
    'reefWallCount',
    'coralCarpetPatchCount',
    'tubeCoralClusterCount',
    'plateCoralShelfCount',
    'showcaseReefCanyon',
    'blenderReefAnchors',
].forEach((needle) => {
    assert(themeSource.includes(needle), `Showcase reef preset/signoff missing ${needle}`);
});
const showcaseReefGeneratorSource = fs.readFileSync(
    path.join(repoRoot, 'tools', 'assetgen', 'generate_ocean_showcase_reef_assets.py'),
    'utf8',
);
[
    'reef-wall-left-01.glb',
    'coral-carpet-purple-01.glb',
].forEach((needle) => {
    assert(showcaseReefGeneratorSource.includes(needle), `Showcase reef generator missing ${needle}`);
});

const reefRecords = getHeroReefAssetRecords();
assert(reefRecords.length >= 5, 'Reef manifest should expose at least five GLBs');
reefRecords.forEach((asset) => {
    const stats = inspectOceanGlbAsset('reef', asset.fileName);
    assert.strictEqual(stats.size, asset.byteSize, `${asset.id} manifest byteSize is stale`);
    assert.strictEqual(stats.triangles, asset.triangleCount, `${asset.id} manifest triangleCount is stale`);
    assert(stats.size <= asset.maxBytes, `${asset.id} should stay within byte budget`);
    assert(stats.triangles >= asset.triangleBudget.min, `${asset.id} should stay within triangle budget`);
    assert(stats.triangles <= asset.triangleBudget.max, `${asset.id} should stay within triangle budget`);
    assert.strictEqual(
        asset.sourceMode,
        'blender-only-project-authored',
        `${asset.id} source mode should be project-owned`,
    );
});
assert.strictEqual(
    summarizeReefAssetManifest().contract.noProprietaryArtwork,
    true,
    'Reef authoring contract should forbid proprietary copied artwork',
);
console.log('  PASS');

const rareMetadata = deterministicRareFauna.collectSignoff();
assert.strictEqual(
    rareMetadata.assetVersion,
    OCEAN_FAUNA_ASSET_VERSION,
    'Rare fauna signoff should report the active fauna asset version',
);
assert.strictEqual(
    rareMetadata.assetManifest.shark.primary.id,
    'rare-shark-quaternius',
    'Rare fauna signoff should expose the active Quaternius shark manifest',
);
console.log('  PASS');

console.log('\n=== Ocean AAA Deferred-Compute Completion Tests Passed ===');

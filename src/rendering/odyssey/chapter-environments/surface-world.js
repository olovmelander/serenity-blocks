/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Surface World Environment - Chapter 3 Visual Theme
 *
 * Enhanced Version:
 * - High-Quality Fluffy Grass (Sakura-style billboards) on Terrain
 * - "Rainy Window" style Ocean Surface at horizon
 * - Distant Sakura Landscape/Islands
 * - Volumetric Golden Sun Rays
 * - Flowing "God Ray" Atmosphere
 * - Soft Procedural Clouds
 * - Fluttering Butterflies
 *
 * WebGPU/TSL: this live chapter now runs on THREE.WebGPURenderer. Its GLSL
 * THREE.ShaderMaterials were replaced with the validated TSL NodeMaterial builders in
 * the sibling surface-world.tsl.js. The public API (exports, group.userData
 * shape, update signature) is unchanged.
 */

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import {
    getActiveOdysseyChapterPositions,
    getChapterPathRange,
    getOdysseyPathPointAt,
    ODYSSEY_SURFACE_BREAKOUT_Y_OFFSET,
} from '../path-utils.js';
import { loadOdysseyGltfCached } from './shared/odyssey-gltf-loader.js';
import {
    getChapter3QuaterniusAssetById,
    getChapter3QuaterniusAssetRecords,
    summarizeChapter3QuaterniusAssets,
} from './shared/chapter-03-quaternius-assets.js';
import {
    getChapter3FlyingBirdAssetById,
} from './shared/chapter-03-bird-assets.js';
import {
    createSnowConiferBelt,
    buildConiferBeltPlacements,
} from './shared/snow-conifer-belt.js';
import { createCanonicalMountainRangeTSL } from './shared/canonical-mountain-range.js';
import {
    createSkyBackgroundTSL,
    createOceanSurfaceTSL,
    createLandscapeTSL,
    createFoothillBridgeTSL,
    createFluffyGrassTSL,
    createWildflowersTSL,
    createSunRaysTSL,
    createCloudsTSL,
    createTreesTSL,
    createReedsTSL,
    createGreatTreeTSL,
    createFallingLeavesTSL,
    getSurfaceGreatTreeAnchor,
    createPollenTSL,
    createBirdsTSL,
    createSunDiscTSL,
    createForegroundPassByTSL,
    createSnowMotesTSL,
    CH3_BIRD_SILHOUETTE_SETTINGS,
    getTerrainHeight,
} from './surface-world.tsl.js';

/**
 * Surface World environment configuration
 */
export const SURFACE_WORLD_CONFIG = {
    id: 3,
    name: 'surface-world',
    yStart: 52.5,
    yEnd: 97.5,
    transitionZone: 0.06, // Much earlier fade-in for maximum overlap
    colors: {
        primary: 0x87ceeb, // Sky blue
        secondary: 0x90ee90, // Light green
        tertiary: 0xffb7c5, // Sakura pink
        accent: 0xffd700, // Golden sunlight
        background: 0xc8e6c9, // Soft green fog
    },
};

const SURFACE_WORLD_TERRAIN_DEPTH_OFFSET = 8;

// ═══════════════════════════════════════════════════════════════════════════════
// ENVIRONMENT CREATION
// ═══════════════════════════════════════════════════════════════════════════════

// WebGPU/TSL: NodeMaterials expose no `material.uniforms` map, so the per-element
// uniform nodes (uTime/uSnowBlend/uOpacity) returned by the .tsl.js builders are
// collected on each Object3D's `userData.odysseyUniforms` when the element is built.
// These collectors gather those TSL uniform nodes (which support `.value` like the old
// THREE.Uniform) so the existing update() opacity/snow logic ticks unchanged.
function collectUniformTargets(root, uniformName, targets, seen) {
    if (!root) return;

    const collectFromHolder = (holder) => {
        const node = holder?.userData?.odysseyUniforms?.[uniformName];
        if (!node || seen.has(node)) return;
        if (typeof node.value !== 'number') return;

        if (node.__odysseyBaseOpacity === undefined && uniformName === 'uOpacity') {
            node.__odysseyBaseOpacity = node.value;
        }

        seen.add(node);
        targets.push(node);
    };

    collectFromHolder(root);
    root.traverse((child) => collectFromHolder(child));
}

function collectUniformTargetsFromRoots(roots, uniformName) {
    const targets = [];
    const seen = new Set();

    roots.filter(Boolean).forEach((root) => {
        collectUniformTargets(root, uniformName, targets, seen);
    });

    return targets;
}

// Attach a builder's returned TSL uniform nodes onto an Object3D so the collectors
// above can find them by name during traversal.
function tagUniforms(object3d, builderUniforms) {
    if (!object3d || !builderUniforms) return object3d;
    const existing = object3d.userData.odysseyUniforms || {};
    object3d.userData.odysseyUniforms = { ...existing, ...builderUniforms };
    return object3d;
}

const CH3_QUATERNIUS_GROUND_PLACEMENTS = Object.freeze([
    {
        assetId: 'tree-hero', name: 'hero-left-tree', x: -120, z: -120, scale: 1.05, rotationY: -0.35,
    },
    {
        assetId: 'tree-t9kb', name: 'right-round-tree', x: 120, z: -120, scale: 0.95, rotationY: 0.7,
    },
    {
        assetId: 'pine-cluster', name: 'pine-cluster-left-ridge', x: -150, z: -240, scale: 1.0, rotationY: 0.3,
    },
    {
        assetId: 'pine-cluster', name: 'pine-cluster-right-ridge', x: 120, z: -240, scale: 0.96, rotationY: -0.35,
    },
    {
        assetId: 'pine-igsu', name: 'individual-pine-front-right', x: 150, z: -40, scale: 0.76, rotationY: -0.55,
    },
    {
        assetId: 'pine-79gm', name: 'individual-pine-left-mid', x: -80, z: -196, scale: 0.82, rotationY: 0.2,
    },
    {
        assetId: 'pine-699s', name: 'individual-pine-right-mid', x: 90, z: -200, scale: 0.88, rotationY: -0.65,
    },
    {
        assetId: 'twisted-edsp', name: 'twisted-left-accent', x: -150, z: -210, scale: 0.82, rotationY: 0.15,
    },
    {
        assetId: 'twisted-9awl', name: 'twisted-right-accent', x: 150, z: -120, scale: 0.74, rotationY: -0.15,
    },
    {
        assetId: 'tree-cluster', name: 'distant-green-tree-mass-left', x: -180, z: -280, scale: 1.0, rotationY: 0.9,
    },
    {
        assetId: 'tree-cluster', name: 'distant-green-tree-mass-right', x: 90, z: -280, scale: 0.9, rotationY: -0.2,
    },
    {
        assetId: 'bush-flowers', name: 'flower-bush-left', x: -120, z: -160, scale: 0.82, rotationY: 0.1,
    },
    {
        assetId: 'bush-flowers', name: 'flower-bush-right', x: 120, z: -160, scale: 0.8, rotationY: -0.5,
    },
    {
        assetId: 'flower-group', name: 'shore-flowers-left', x: -90, z: -160, scale: 0.7, rotationY: 0.4,
    },
    {
        assetId: 'flower-group', name: 'shore-flowers-right', x: 90, z: -160, scale: 0.66, rotationY: -0.3,
    },
    {
        assetId: 'fern', name: 'fern-left', x: -60, z: -200, scale: 0.7, rotationY: 0.8,
    },
    {
        assetId: 'fern', name: 'fern-right', x: 60, z: -200, scale: 0.66, rotationY: -0.7,
    },
    {
        assetId: 'clover', name: 'clover-left', x: -60, z: -160, scale: 0.78, rotationY: 0.25,
    },
    {
        assetId: 'clover', name: 'clover-right', x: 60, z: -160, scale: 0.72, rotationY: -0.45,
    },
    {
        assetId: 'rock-medium', name: 'shore-rock-left', x: -180, z: -40, scale: 0.86, rotationY: -0.25,
    },
    {
        assetId: 'rock-medium', name: 'hill-foot-rock-right', x: 104, z: -126, scale: 1.05, rotationY: 0.55,
    },
    {
        assetId: 'pebble-round', name: 'wet-pebble-left', x: -120, z: -120, scale: 0.52, rotationY: 0.1,
    },
    {
        assetId: 'pebble-round', name: 'wet-pebble-right', x: 120, z: -80, scale: 0.5, rotationY: -0.25,
    },
]);

// Chapter 3's flying birds: skinned, vertex-coloured goldfinch + swallow GLBs
// (pipeline-authored, see chapter-03-bird-assets.js). They flap via their own
// "Flap" skeletal clip, so `wingRig: false` drops the old synthetic wing
// triangles. `modelRotationY` is the per-flight facing knob — the bird's nose
// must lead its travel direction once the update loop applies root.rotation.y.
const CH3_FLYING_BIRD_FLIGHTS = Object.freeze([
    {
        assetId: 'swallow-flying',
        name: 'swallow-cross-left',
        crosser: true,
        wingRig: false,
        modelRotationY: 0,
        lane: -34,
        height: 18,
        speed: 1.05,
        offset: 0.18,
        scale: 0.9,
    },
    {
        assetId: 'goldfinch-flying',
        name: 'goldfinch-cross-right',
        crosser: true,
        wingRig: false,
        modelRotationY: 0,
        lane: -68,
        height: 24,
        speed: 0.82,
        offset: 0.61,
        scale: 0.78,
    },
    {
        assetId: 'swallow-flying',
        name: 'swallow-cross-high',
        crosser: true,
        wingRig: false,
        modelRotationY: 0,
        lane: -104,
        height: 34,
        speed: 0.62,
        offset: 0.88,
        scale: 0.62,
    },
    {
        assetId: 'goldfinch-flying',
        name: 'goldfinch-distant-left',
        crosser: false,
        wingRig: false,
        modelRotationY: 0,
        radius: 88,
        height: 46,
        speed: 0.22,
        offset: 1.2,
        scale: 0.82,
    },
    {
        assetId: 'goldfinch-flying',
        name: 'goldfinch-distant-right',
        crosser: false,
        wingRig: false,
        modelRotationY: 0,
        radius: 118,
        height: 54,
        speed: 0.18,
        offset: 3.4,
        scale: 0.72,
    },
]);

function getQuaterniusOpacityTargets(group) {
    if (!group.userData.quaterniusMaterialOpacityTargets) {
        group.userData.quaterniusMaterialOpacityTargets = [];
    }
    return group.userData.quaterniusMaterialOpacityTargets;
}

function registerQuaterniusMaterial(group, material) {
    if (!material) return;
    const targets = getQuaterniusOpacityTargets(group);
    if (!targets.includes(material)) {
        material.userData.odysseyBaseOpacity = material.opacity ?? 1;
        material.transparent = true;
        material.depthWrite = false;
        material.needsUpdate = true;
        targets.push(material);
    }
}

function resolveQuaterniusRuntimeColor(sourceMaterial, record) {
    const name = (sourceMaterial?.name || '').toLowerCase();

    if (record.role === 'bird') {
        return 0x1e3d58;
    }
    if (record.role === 'animated-bird') {
        if (name.includes('secondary')) return 0xd29b38;
        if (name.includes('eye_white')) return 0xe8edf0;
        if (name.includes('eye_black')) return 0x11151a;
        return 0x6b6380;
    }
    if (record.role === 'shore-rock') {
        return name.includes('path') ? 0x889083 : 0x778176;
    }
    if (name.includes('flower')) {
        return 0xf2b7cf;
    }
    if (name.includes('wood') || name.includes('bark')) {
        return name.includes('twisted') ? 0x4a3329 : 0x77533a;
    }
    if (name.includes('pine')) {
        return 0x236d27;
    }
    if (name.includes('twisted')) {
        return 0xbb4836;
    }
    if (name.includes('leaf') || name.includes('green') || name.includes('grass')) {
        return record.id === 'tree-hero' ? 0x3e8f31 : 0x337f2d;
    }
    if (record.role === 'ground-detail') {
        return 0x3f8f35;
    }

    return 0x4d8a35;
}

// Deterministic per-placement tint so repeated GLB props (pines, tree clusters) stop
// reading as identical stamps. FNV-1a hash of the placement name → stable HSL jitter
// (no per-run popping). Greens fan yellow↔blue-green; low-sat rocks barely shift.
function placementTintFromName(name) {
    if (!name) return null;
    // Bitwise-free deterministic scramble: accumulate the chars into a number, then
    // sin-fract it to a stable pseudo-random in [-1, 1] per (name, salt).
    const unit = (salt) => {
        let acc = salt * 127.1 + 311.7;
        for (let i = 0; i < name.length; i += 1) {
            acc += name.charCodeAt(i) * (i + 1) * 13.37;
        }
        const s = Math.sin(acc) * 43758.5453;
        return ((s - Math.floor(s)) * 2) - 1; // fract → [-1, 1]
    };
    return { h: unit(1) * 0.035, s: unit(2) * 0.12, l: unit(3) * 0.09 };
}

function applyTintToColor(hex, tint) {
    const color = new THREE.Color(hex);
    if (!tint) return color;
    const hsl = { h: 0, s: 0, l: 0 };
    color.getHSL(hsl);
    color.setHSL(
        (hsl.h + tint.h + 1) % 1,
        THREE.MathUtils.clamp(hsl.s + tint.s, 0, 1),
        THREE.MathUtils.clamp(hsl.l + tint.l, 0, 1),
    );
    return color;
}

function createQuaterniusRuntimeMaterial(sourceMaterial, record, tint = null) {
    const material = new THREE.MeshBasicMaterial({
        color: applyTintToColor(resolveQuaterniusRuntimeColor(sourceMaterial, record), tint),
        opacity: sourceMaterial?.opacity ?? 1,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
    });
    material.name = `odyssey-${record.id}-${sourceMaterial?.name || 'material'}`;
    material.userData.sourceMaterialName = sourceMaterial?.name || null;
    material.userData.sourceMode = 'quaternius-runtime-color';
    return material;
}

function createBirdWingGeometry(side = 1, span = 6.0) {
    const geometry = new THREE.BufferGeometry();
    const rootX = 0.16 * side;
    const tipX = span * side;
    const positions = new Float32Array([
        rootX, 0.0, 0.0,
        tipX, 0.0, -0.45,
        side * span * 0.34, 0.0, -1.2,
        rootX, 0.0, 0.0,
        side * span * 0.34, 0.0, -1.2,
        side * span * 0.58, 0.0, 0.42,
    ]);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    return geometry;
}

function addFlyingWingRig(root, group, flight) {
    const wingMaterial = new THREE.MeshBasicMaterial({
        color: 0x2b5d79,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
    });
    wingMaterial.name = 'odyssey-cc0-bird-flight-wings';
    registerQuaterniusMaterial(group, wingMaterial);

    const span = flight.wingSpan ?? 6.0;
    const leftWing = new THREE.Mesh(createBirdWingGeometry(-1, span), wingMaterial);
    const rightWing = new THREE.Mesh(createBirdWingGeometry(1, span), wingMaterial);
    leftWing.name = 'left-flight-wing';
    rightWing.name = 'right-flight-wing';
    leftWing.position.set(0, 0.35, 0.05);
    rightWing.position.set(0, 0.35, 0.05);
    leftWing.frustumCulled = false;
    rightWing.frustumCulled = false;
    root.add(leftWing, rightWing);
    root.userData.flightWings = { leftWing, rightWing };
}

function prepareQuaterniusScene(scene, record, group, tint = null) {
    scene.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = false;
        child.receiveShadow = true;
        child.frustumCulled = false;

        const materials = Array.isArray(child.material) ? child.material : [child.material];
        const runtimeMaterials = materials.map((material) => (
            createQuaterniusRuntimeMaterial(material, record, tint)
        ));
        child.material = Array.isArray(child.material) ? runtimeMaterials : runtimeMaterials[0];
        runtimeMaterials.forEach((material) => registerQuaterniusMaterial(group, material));
    });

    scene.userData.assetRecord = record;
    scene.userData.sourceMode = 'third-party-cc0-glb';
}

// Flying birds keep their own baked vertex colours (a goldfinch/swallow must
// read as themselves), so we DON'T run the flat role-colour pass. We still swap
// to a flat unlit MeshBasicMaterial to match the chapter's stylised look and to
// register it for the shared surface opacity fade. Skinning is preserved because
// only `.material` is replaced — geometry, skeleton, and bindings are untouched.
function prepareFlyingBirdScene(scene, record, group) {
    scene.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = false;
        child.receiveShadow = false;
        child.frustumCulled = false;

        const materials = Array.isArray(child.material) ? child.material : [child.material];
        const runtimeMaterials = materials.map((source) => {
            const material = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                vertexColors: true,
                opacity: source?.opacity ?? 1,
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,
                toneMapped: false,
            });
            material.name = `odyssey-${record.id}-${source?.name || 'material'}`;
            material.userData.sourceMaterialName = source?.name || null;
            material.userData.sourceMode = 'flying-bird-vertex-color';
            return material;
        });
        child.material = Array.isArray(child.material) ? runtimeMaterials : runtimeMaterials[0];
        runtimeMaterials.forEach((material) => registerQuaterniusMaterial(group, material));
    });

    scene.userData.assetRecord = record;
    scene.userData.sourceMode = 'pipeline-flying-bird-glb';
}

function applyQuaterniusMaterialOpacity(targets, opacity) {
    targets.forEach((material) => {
        const baseOpacity = typeof material.userData.odysseyBaseOpacity === 'number'
            ? material.userData.odysseyBaseOpacity
            : material.opacity ?? 1;
        material.opacity = baseOpacity * opacity;
        material.depthWrite = material.opacity >= 0.98;
        material.visible = material.opacity > 0.002;
    });
}

function resolveGroundPoint(x, z, minHeight = 3.0) {
    const offsets = [
        [0, 0],
        [14, 0],
        [-14, 0],
        [0, 14],
        [0, -14],
        [18, 12],
        [-18, 12],
        [18, -12],
        [-18, -12],
        [28, 0],
        [-28, 0],
    ];
    let best = { x, z, y: getTerrainHeight(x, z) };

    offsets.forEach(([ox, oz]) => {
        const px = x + ox;
        const pz = z + oz;
        const y = getTerrainHeight(px, pz);
        if (y >= minHeight && best.y < minHeight) {
            best = { x: px, z: pz, y };
        } else if (best.y < minHeight && y > best.y) {
            best = { x: px, z: pz, y };
        }
    });

    return best;
}

async function addQuaterniusGroundModel(group, groundLayer, placement) {
    const record = getChapter3QuaterniusAssetById(placement.assetId);
    if (!record?.url) return null;

    const gltf = await loadOdysseyGltfCached(record.url);
    const model = gltf.scene;
    model.name = `quaternius-${placement.name || record.id}`;
    prepareQuaterniusScene(model, record, group, placementTintFromName(placement.name));

    const ground = resolveGroundPoint(placement.x, placement.z, placement.minHeight ?? 4.0);
    const scale = record.runtimeScale * (placement.scale ?? 1);
    model.rotation.set(placement.rotationX ?? 0, placement.rotationY ?? 0, placement.rotationZ ?? 0);
    model.scale.setScalar(scale);
    // Seat the model's LOWEST vertex on the terrain (pivot-safe): measure the scaled/rotated
    // bounds while the model is still un-parented (matrixWorld == local), then place so the base
    // sits at the sampled ground height. groundLayer.position.y already applies terrainOffsetY.
    model.position.set(ground.x, 0, ground.z);
    model.updateMatrixWorld(true);
    const baseY = new THREE.Box3().setFromObject(model).min.y;
    model.position.y = ground.y + (placement.yOffset ?? 0) - baseY;
    groundLayer.add(model);
    return model;
}

async function addFlyingBird(group, birdLayer, flight) {
    const record = getChapter3FlyingBirdAssetById(flight.assetId);
    if (!record?.url) return null;

    const gltf = await loadOdysseyGltfCached(record.url);
    const model = gltf.scene;
    model.name = `flying-bird-${flight.name || record.id}-model`;
    prepareFlyingBirdScene(model, record, group);

    const root = new THREE.Group();
    root.name = `flying-bird-${flight.name || record.id}`;
    root.userData.assetRecord = record;
    root.userData.flight = { ...flight };
    const scale = (record.runtimeScale ?? 1) * (flight.scale ?? 1);
    model.scale.setScalar(scale);
    // Base yaw 0 (no 180° flip): these are different models from bird-jay, so the
    // facing is tuned per-flight via modelRotationY after a capture check.
    model.rotation.set(
        flight.modelRotationX ?? 0,
        flight.modelRotationY ?? 0,
        flight.modelRotationZ ?? 0,
    );
    root.add(model);
    if (flight.wingRig !== false) {
        addFlyingWingRig(root, group, flight);
    }
    birdLayer.add(root);

    let mixer = null;
    if (gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(model);
        gltf.animations.forEach((clip) => {
            mixer.clipAction(clip).play();
        });
        group.userData.quaterniusAnimationMixers.push(mixer);
    }

    group.userData.quaterniusBirdFlights.push({
        root,
        mixer,
        ...flight,
    });

    return root;
}

// Kept (intentionally uncalled) so the GLB vegetation loader is one line away from restoration;
// see createQuaterniusNatureLayer (GLBs removed 2026-06-18 per user request, Ch3 being redone).
// eslint-disable-next-line no-unused-vars
async function loadQuaterniusNatureAssets(group, layer) {
    const { groundLayer, birdLayer } = layer.userData;
    const jobs = [
        ...CH3_QUATERNIUS_GROUND_PLACEMENTS.map(
            (placement) => addQuaterniusGroundModel(group, groundLayer, placement),
        ),
        ...CH3_FLYING_BIRD_FLIGHTS.map(
            (flight) => addFlyingBird(group, birdLayer, flight),
        ),
    ];

    const results = await Promise.allSettled(jobs);
    const loadedCount = results.filter((result) => result.status === 'fulfilled' && result.value).length;
    const failedCount = results.length - loadedCount;
    layer.userData.loadedCount = loadedCount;
    layer.userData.failedCount = failedCount;
    layer.userData.assetsReady = loadedCount > 0;
    layer.userData.assetStatus = loadedCount > 0 ? 'glb-loaded' : 'glb-error';
    group.userData.quaterniusAssetsReady = loadedCount > 0;

    if (failedCount > 0) {
        console.warn(`[Odyssey][Ch3] ${failedCount} Quaternius assets failed to load`);
    }
}

// Birds-only restore (masterplan D1-ch3): the Quaternius GROUND GLBs are deleted (pending the
// Ch3 redo), but the goldfinch + swallow flight GLBs are still on disk (shared with Summer) and
// carry a full wing-rig + flight system. Loading just the animated birds gives Ch3 real motion
// life now, at ~1.6MB, without waiting on the ground-prop redo. CH3_QUATERNIUS_GROUND_PLACEMENTS
// stays gated off.
async function loadFlyingBirdsOnly(group, layer) {
    const { birdLayer } = layer.userData;
    const jobs = CH3_FLYING_BIRD_FLIGHTS.map((flight) => addFlyingBird(group, birdLayer, flight));
    const results = await Promise.allSettled(jobs);
    const loadedCount = results.filter((r) => r.status === 'fulfilled' && r.value).length;
    const failedCount = results.length - loadedCount;
    layer.userData.loadedCount = loadedCount;
    layer.userData.failedCount = failedCount;
    layer.userData.assetsReady = loadedCount > 0;
    layer.userData.assetStatus = loadedCount > 0 ? 'birds-only' : 'birds-error';
    group.userData.quaterniusAssetsReady = true;
    if (failedCount > 0) {
        console.warn(`[Odyssey][Ch3] ${failedCount} flying birds failed to load`);
    }
}

function createQuaterniusNatureLayer(group, terrainOffsetY) {
    const layer = new THREE.Group();
    layer.name = 'quaternius-cc0-nature-assets';
    layer.userData.assetManifest = summarizeChapter3QuaterniusAssets();
    layer.userData.assetRecords = getChapter3QuaterniusAssetRecords();
    layer.userData.assetStatus = 'pending';

    const groundLayer = new THREE.Group();
    groundLayer.name = 'quaternius-ground-props';
    // terrainOffsetY only — the GLB props sample getTerrainHeight directly and bake NO -15
    // (unlike the procedural instancers), so the old extra -15 sank every model ~15u underground.
    groundLayer.position.y = terrainOffsetY;
    layer.add(groundLayer);

    const birdLayer = new THREE.Group();
    birdLayer.name = 'quaternius-birds';
    layer.add(birdLayer);

    layer.userData.groundLayer = groundLayer;
    layer.userData.birdLayer = birdLayer;
    group.userData.quaterniusAnimationMixers = [];
    group.userData.quaterniusBirdFlights = [];
    group.userData.quaterniusAssetsReady = false;
    getQuaterniusOpacityTargets(group);

    if (typeof window === 'undefined') {
        layer.userData.assetStatus = 'deferred-non-browser';
        return layer;
    }

    // GROUND props (trees / flowers / bushes / ferns / clover / rocks) stay REMOVED — their
    // Quaternius GLBs were deleted 2026-06-18 pending the Ch3 redo. But the animated flying
    // BIRDS (goldfinch + swallow, ~1.6MB, on disk + shared with Summer) are restored now to give
    // Ch3 real motion life (masterplan D1-ch3). Fire-and-forget; the empty ground layer keeps
    // update()/opacity a no-op. Full ground restore = swap loadFlyingBirdsOnly → loadQuaterniusNatureAssets.
    layer.userData.assetStatus = 'birds-only-pending-ground-redo';
    layer.userData.loadedCount = 0;
    group.userData.quaterniusAssetsReady = true;
    layer.userData.loadPromise = loadFlyingBirdsOnly(group, layer).catch((error) => {
        console.warn('[Odyssey][Ch3] flying-bird load failed:', error);
    });

    return layer;
}

export function resolveSurfaceWorldVisibilityState({
    waterSurfaceY,
    surfaceProbeY,
    cameraY,
}) {
    const fallbackProbeY = Number.isFinite(cameraY) ? cameraY : waterSurfaceY;
    const resolvedProbeY = Number.isFinite(surfaceProbeY) ? surfaceProbeY : fallbackProbeY;
    const isUnderwater = resolvedProbeY < (waterSurfaceY - 2);
    const surfaceOpacity = THREE.MathUtils.smoothstep(
        resolvedProbeY,
        waterSurfaceY - 12,
        waterSurfaceY + 2,
    );

    return {
        surfaceProbeY: resolvedProbeY,
        cameraY: fallbackProbeY,
        isUnderwater,
        surfaceOpacity,
    };
}

export function resolveSurfaceWorldAuroraPreviewState(progress) {
    return {
        previewOpacity: Number.isFinite(progress) ? 0 : 0,
        previewVisible: false,
    };
}

/**
 * Resolve the ALPINE RAMP for Surface World's distant range + foothill skirt.
 *
 * GATE THE LEAK: those big alpine pieces are anchored at Chapter 3's path center and are
 * huge (≈800–1200 wide). With only the underwater surface-opacity gate they popped into
 * the camera's view during the Deep Ocean→Surface seam (the "alpine peaks + translucent
 * slab during Deep Ocean" bug). They must only fade in across the Surface→Mountains
 * approach (the back portion of Ch3), never during Ch2. This ramps 0→1 over the latter
 * part of Chapter 3 by progress, so they are absent early in Ch3 (and therefore in Ch2).
 *
 * @param {number} progress global Odyssey path progress (0..1), or null.
 * @param {number[]} [chapterPositions] active chapter-start progresses.
 * @returns {{rampOpacity:number, rampVisible:boolean}}
 */
export function resolveSurfaceWorldAlpineRampState(
    progress,
    chapterPositions = getActiveOdysseyChapterPositions(),
) {
    if (!Number.isFinite(progress)) {
        // No progress info (e.g. the standalone pilot) — show the range fully so the
        // chapter still reads correctly; the leak is a live-traversal artefact only.
        return { rampOpacity: 1, rampVisible: true };
    }

    const ch3Start = chapterPositions?.[2];
    const ch4Start = chapterPositions?.[3] ?? 1;
    if (!Number.isFinite(ch3Start) || ch4Start <= ch3Start) {
        return { rampOpacity: 1, rampVisible: true };
    }

    // Begin the mountain-world reveal right after the breach: once the camera breaks
    // through the water, Chapter 4 must already read as the far destination behind the
    // green islands. The entry opacity gate still prevents any leak during Chapter 2.
    const rampStart = ch3Start + (ch4Start - ch3Start) * 0.04;
    const rampEnd = ch3Start + (ch4Start - ch3Start) * 0.52;
    const rampOpacity = THREE.MathUtils.smoothstep(progress, rampStart, rampEnd);

    return { rampOpacity, rampVisible: rampOpacity > 0 };
}

// SEAM 3->4 ("the mountains change shape, and the waterfalls disappear"). The manager's
// group-opacity crossfade can't reach these TSL NodeMaterials (their alpha flows through
// opacityNode/uOpacity, not material.opacity), so without this they stay full-opacity until
// group.visible flips false at the seam = a hard pop. This resolves a 1->0 recede ramp keyed
// to global progress across the FINAL stretch of Ch3 into the Surface→Mountains seam:
//   • the WATERFALL recedes (fades) gracefully instead of vanishing, and
//   • the Surface distant-range fades in lock-step with the rising Mountains hero peaks
//     (driven up by the manager ecotone) so the shape SWAP cross-dissolves rather than jumps.
// Pure arithmetic, no allocation. Outside the band (or with no progress) it returns 1 so the
// chapter reads fully when standalone / mid-chapter.
const SURFACE_SEAM_RECEDE_BAND = 0.22; // fraction of Ch3 span before the boundary to recede over
const SURFACE_SEAM_SURFACE_EXIT_BAND = 0.06; // fraction of Ch3 span per side of the boundary
// The canonical Ch4 chain is already atmospheric through its base/edge alpha; keeping the
// preview nearly opaque prevents the live board from reading as see-through ghost peaks.
const SURFACE_DISTANT_MOUNTAIN_PREVIEW_OPACITY = 1.0;
const SURFACE_WATER_CROSSING_FADE_START = 0.28;
const SURFACE_WATER_CROSSING_FADE_END = 0.52;

/**
 * ENTRY RAMP (creative plan Transition In): the landscape slab popped into frame 01–02
 * and petals leaked through the breach because the surface elements appeared at full
 * presence the moment the camera crossed the waterline. This ramps everything 0→1 from
 * just inside the 2→3 ecotone to ~7% into the chapter, so the first held composition
 * RISES into frame instead of popping.
 */
export function resolveSurfaceWorldEntryRampState(
    progress,
    chapterPositions = getActiveOdysseyChapterPositions(),
) {
    if (!Number.isFinite(progress)) {
        return { entryOpacity: 1 };
    }
    const ch3Start = chapterPositions?.[2];
    const ch4Start = chapterPositions?.[3] ?? 1;
    if (!Number.isFinite(ch3Start) || ch4Start <= ch3Start) {
        return { entryOpacity: 1 };
    }
    const span = ch4Start - ch3Start;
    const entryOpacity = THREE.MathUtils.smoothstep(
        progress,
        ch3Start - span * 0.02,
        ch3Start + span * 0.07,
    );
    return { entryOpacity };
}

export function resolveSurfaceWorldWaterCrossingState(
    progress,
    chapterPositions = getActiveOdysseyChapterPositions(),
) {
    if (!Number.isFinite(progress)) {
        return { waterCrossingOpacity: 1, waterCrossingVisible: true };
    }
    const ch3Start = chapterPositions?.[2];
    const ch4Start = chapterPositions?.[3] ?? 1;
    if (!Number.isFinite(ch3Start) || ch4Start <= ch3Start) {
        return { waterCrossingOpacity: 1, waterCrossingVisible: true };
    }

    const local = THREE.MathUtils.clamp((progress - ch3Start) / (ch4Start - ch3Start), 0, 1);
    const waterCrossingOpacity = 1 - THREE.MathUtils.smoothstep(
        local,
        SURFACE_WATER_CROSSING_FADE_START,
        SURFACE_WATER_CROSSING_FADE_END,
    );

    return {
        waterCrossingOpacity,
        waterCrossingVisible: waterCrossingOpacity > 0.02,
    };
}

export function resolveSurfaceWorldSeamRecedeState(
    progress,
    chapterPositions = getActiveOdysseyChapterPositions(),
) {
    if (!Number.isFinite(progress)) {
        return { recedeOpacity: 1 };
    }

    const ch3Start = chapterPositions?.[2];
    const ch4Start = chapterPositions?.[3] ?? 1;
    if (!Number.isFinite(ch3Start) || ch4Start <= ch3Start) {
        return { recedeOpacity: 1 };
    }

    // Recede across the last SURFACE_SEAM_RECEDE_BAND of Ch3 up to the boundary.
    // THREE.MathUtils.smoothstep does not support reversed edges, so invert the normal ramp.
    const span = ch4Start - ch3Start;
    const recedeStart = ch4Start - span * SURFACE_SEAM_RECEDE_BAND;
    const recedeOpacity = 1 - THREE.MathUtils.smoothstep(progress, recedeStart, ch4Start);

    return { recedeOpacity };
}

export function resolveSurfaceWorldSurfaceExitState(
    progress,
    chapterPositions = getActiveOdysseyChapterPositions(),
) {
    if (!Number.isFinite(progress)) {
        return { surfaceExitOpacity: 1 };
    }

    const ch3Start = chapterPositions?.[2];
    const ch4Start = chapterPositions?.[3] ?? 1;
    if (!Number.isFinite(ch3Start) || ch4Start <= ch3Start) {
        return { surfaceExitOpacity: 1 };
    }

    const span = ch4Start - ch3Start;
    const halfWidth = span * SURFACE_SEAM_SURFACE_EXIT_BAND;
    const fadeStart = ch4Start - halfWidth;
    const fadeEnd = ch4Start + halfWidth;
    const surfaceExitOpacity = 1 - THREE.MathUtils.smoothstep(progress, fadeStart, fadeEnd);

    return { surfaceExitOpacity };
}

// Snow-conifer placements that climb the foothill bridge across the Ch3→Ch4 seam, thinning to
// the tree line (none above ~70% of the climb → bare snow). Anchored to the exact bridge
// surface (foothillBridgeHeight) and kept off the carved player corridor (around x=-18).
// ── Ch3 HERO MIRROR (flag ch3HeroMirror) ─────────────────────────────────────────────
// Opt-in REAL reflector() planar mirror for the hero lake (default OFF → the chapter is
// byte-identical to today). Enable with URL ?ch3HeroMirror=1 or localStorage
// 'odyssey.ch3HeroMirror'='1'. Headless-guarded. See the isolated proof effect
// src/playground/effects/surface-world-hero-lake.effect.js + the rebuild plan doc.
const CH3_REFLECTION_LAYER = 2;
function readCh3HeroMirrorFlag() {
    try {
        if (typeof window === 'undefined') return false;
        const q = new URLSearchParams(window.location.search).get('ch3HeroMirror');
        if (q === '1' || q === 'true') return true;
        if (q === '0' || q === 'false') return false;
        return window.localStorage?.getItem('odyssey.ch3HeroMirror') === '1';
    } catch {
        return false;
    }
}

export function createSurfaceWorldEnvironment() {
    const group = new THREE.Group();
    group.name = 'surface-world-environment';
    group.userData.chapterId = 3;
    group.userData.yStart = SURFACE_WORLD_CONFIG.yStart;
    group.userData.yEnd = SURFACE_WORLD_CONFIG.yEnd;

    // Shared time clock. On WebGPU this is a TSL uniform node (it still exposes `.value`,
    // so the update() loop ticks it exactly as before); it is passed into every .tsl.js
    // builder so all converted materials share one clock.
    //
    // uSeason (creative plan item 6): ONE scalar, 0 at the surface breach → 1 at the
    // Mountains seam, scripting the spring→autumn→winter arc THROUGH LIGHT — the sky
    // bands, sun disc, key light, god-ray density, tree recolor, and the one-at-a-time
    // particle stories (pollen → leaves → snow) all ride it.
    const uTime = uniform(0);
    const uSeason = uniform(0);
    const uniforms = { uTime, uSeason };
    group.userData.uniforms = uniforms;

    const chapterRange = getChapterPathRange(3);
    const chapter4Range = getChapterPathRange(4);
    const fallbackCenterY = (SURFACE_WORLD_CONFIG.yStart + SURFACE_WORLD_CONFIG.yEnd) / 2;
    const chapterCenterY = chapterRange?.center.y ?? fallbackCenterY;
    const waterSurfaceY = chapterRange
        ? chapterRange.start.y - ODYSSEY_SURFACE_BREAKOUT_Y_OFFSET
        : chapterCenterY - 15;
    const surfaceOffsetY = waterSurfaceY - chapterCenterY;
    const surfaceWorldY = chapterCenterY + surfaceOffsetY;
    const terrainOffsetY = surfaceOffsetY + (15 - SURFACE_WORLD_TERRAIN_DEPTH_OFFSET);

    if (chapterRange) {
        group.userData.yStart = chapterRange.start.y;
        group.userData.yEnd = chapterRange.end.y;
    }

    const snowTransitionEndY = chapter4Range?.start.y ?? group.userData.yEnd;
    const snowTransitionRange = chapterRange
        ? (chapterRange.end.y - chapterRange.start.y) * 0.4
        : 18;
    group.userData.snowTransition = {
        endY: snowTransitionEndY,
        range: snowTransitionRange,
    };

    // 1. Sky Background
    const sky = createSkyBackground(uniforms);
    sky.name = 'sky';
    group.add(sky);

    // 2. Ocean Surface (Bottom) - visible from above and below
    const ocean = createOceanSurface(uniforms, surfaceOffsetY, readCh3HeroMirrorFlag());
    ocean.name = 'ocean-surface';
    ocean.userData.kind = 'persistent-blue-sea-with-river';
    group.add(ocean);
    group.userData.ocean = ocean;

    // 3. Distant Landscape/Islands - only visible above water
    const landscape = createLandscape(uniforms, surfaceWorldY);
    landscape.name = 'landscape';
    landscape.position.y = terrainOffsetY;
    group.add(landscape);
    group.userData.landscape = landscape;

    // 3.5 Foothill terrain bridge into Chapter 4
    const foothillBridge = createFoothillBridge(uniforms);
    foothillBridge.name = 'foothill-bridge';
    foothillBridge.position.y = terrainOffsetY;
    group.add(foothillBridge);
    group.userData.foothillBridge = foothillBridge;
    group.userData.snowFloor = foothillBridge;

    // 3.75 Distant Mountains on horizon (same style as Chapter 4)
    const distantMountains = createDistantMountains(uniforms, chapterRange?.center);
    distantMountains.name = 'distant-mountains';
    group.add(distantMountains);
    group.userData.distantMountains = distantMountains;
    group.userData.foothillMist = distantMountains.userData.foothillMist;

    // Chapter 3 should hand to Chapter 4 through mountains and mist only. Aurora belongs
    // to Chapter 5; keeping this null avoids the old hard-edged preview curtain.
    group.userData.auroraPreview = null;

    // 4. High Quality Fluffy Grass (Removed per user request due to floating artifacts)
    // const grass = createFluffyGrass(uniforms, 1000);
    // group.add(grass);

    // 4.5 Visible golden SUN disc + halo (golden-hour) - only visible above water
    const sun = createSunDisc(uniforms);
    sun.name = 'sun-disc';
    group.add(sun);
    group.userData.sun = sun;

    // 5. Volumetric Sun Rays - only visible above water
    const rays = createSunRays(uniforms);
    rays.name = 'sun-rays';
    group.add(rays);

    // 6. Soft Procedural Clouds - only visible above water
    const clouds = createClouds(uniforms);
    clouds.name = 'clouds';
    group.add(clouds);

    // Butterflies CUT (remake plan #5 / declutter): 20 separate JS-animated meshes = 20 draws +
    // a material for little on-screen value; the pollen + falling-leaves + birds carry the meadow's
    // life. Removing them drops a material, 20 draws, and the per-frame animation loop below.

    // 9. Living Landscapes vegetation — real 3D wildflowers, trees and reeds, anchored to
    // getTerrainHeight(). BotW re-composition: grass tufts removed; vegetation kept sparse +
    // zoned (deliberate clumps + open negative space), not a scattered carpet.
    // PAINTERLY-ASCENT REPALETTE (2026-08, Wave A): the meadow flowers are RESTORED. The user's new
    // reference (a bright Ghibli/Genshin lakeside meadow) wants a lush flower carpet — buttercup-
    // yellow, daisy-white, lupine-purple, cornflower-blue, poppy — which is exactly the species
    // palette createWildflowersTSL already carries, placed banks-dense / corridor-clear by the shared
    // composition grammar. (Trees stay out — the reference is a flower meadow, not a forest.)
    const meadowFlowers = createWildflowers(uniforms, 1200);
    meadowFlowers.name = 'meadow-flowers';
    meadowFlowers.position.y = terrainOffsetY;
    group.add(meadowFlowers);
    group.userData.meadowFlowers = meadowFlowers;

    const trees = createTrees(uniforms, 0); // CLEAN LANDSCAPE: scattered deciduous rounds cut (object kept for cc0 + fallback pins)
    trees.name = 'trees';
    trees.position.y = terrainOffsetY;
    group.add(trees);
    group.userData.trees = trees;

    // Remake plan action #1 (tree declutter + compile cut): the procedural spruce stands and the
    // mid-distance procedural tree-line are CUT. Both were redundant with the shared GLB snow-
    // conifer belt below — which is the real, well-modelled Ch3↔Ch4 tree-line — so removing them
    // drops two vocabularies of visual clutter AND two first-visit pipeline compiles. The deciduous
    // rounds + Great Tree carry the near/mid forest; the conifer belt carries the flank silhouette.

    const reeds = createReeds(uniforms, 0); // CLEAN LANDSCAPE: reed clutter cut
    reeds.name = 'reeds';
    reeds.position.y = terrainOffsetY;
    group.add(reeds);
    group.userData.reeds = reeds;

    // HERO landmark: the great ancient tree on a knoll off the left of the path. Plus
    // falling-leaf billboards drifting off its canopy. Anchored via getTerrainHeight in the
    // builder, then lifted by the same terrainOffsetY the rest of the vegetation uses so the
    // trunk foot seats on the rendered ground.
    const greatTree = createGreatTree(uniforms);
    greatTree.name = 'great-tree';
    greatTree.position.y += terrainOffsetY;
    group.add(greatTree);
    group.userData.greatTree = greatTree;
    // HOOK for B7 (camera landmark look-bias): the Great Tree's LOCAL anchor (relative to
    // the chapter group) so the camera controller can bias its lookAt toward the hero at the
    // hero-tree beat. World position = group.position + this anchor (with the prop offset).
    // SEAM 3→4 ECOTONE: a snow-conifer tree-line on the higher ground rising toward the
    // mountains. The SAME vertex-coloured fir/pine/spruce appear in Ch4, so crossing the seam
    // reads as one continuous alpine world. Density thins to the snow line; uSnowBlend whitens
    // them with the season/altitude (shared with the terrain + mountain snow line).
    const coniferSnowBlend = uniform(0);
    const coniferBelt = createSnowConiferBelt({
        uSnowBlend: coniferSnowBlend,
        // Keep inside the rendered 400×400 landscape (±200) so the trees seat on real terrain,
        // not the foothill-bridge zone beyond it; cluster on the FAR meadow edge (the tree line
        // climbing toward the seam). The Ch4 side seeds its own conifers on its lower slopes.
        placementsBySpecies: buildConiferBeltPlacements({
            count: 0, // CLEAN LANDSCAPE: flank conifer tree-line cut (object+key kept); bare hills→mountains reads cleaner
            area: { x: 360, zMin: -188, zMax: -60 },
            heightBand: { base: 6, line: 26 },
            sampleHeight: (x, z) => getTerrainHeight(x, z),
        }),
    });
    coniferBelt.position.y = terrainOffsetY;
    group.add(coniferBelt);
    group.userData.coniferBelt = coniferBelt;

    // The tree-line CROSSES THE SEAM: conifers continue up the foothill bridge (anchored to its
    // exact surface) and thin to nothing toward the top — so the forest gives way to bare snow
    // exactly as the Mountains chapter takes over (a real, well-modelled tree line).
    const bridgeConiferBelt = createSnowConiferBelt({
        uSnowBlend: coniferSnowBlend,
        // CLEAN LANDSCAPE: the bridge tree-line is cut too (empty placements → 0 instances). Ch3→Ch4
        // continuity comes from the continuous terrain slope + the shared canonical peaks (Fix D),
        // not a conifer belt. Object + key kept so the snow-blend collection + tests stay intact.
        placementsBySpecies: { spruce: [], pine: [], fir: [] },
    });
    bridgeConiferBelt.name = 'snow-conifer-belt-bridge';
    bridgeConiferBelt.position.y = terrainOffsetY;
    group.add(bridgeConiferBelt);
    group.userData.bridgeConiferBelt = bridgeConiferBelt;

    const greatTreeAnchor = getSurfaceGreatTreeAnchor();
    group.userData.greatTreeAnchor = {
        x: greatTreeAnchor.x,
        y: (greatTreeAnchor.y - 15) + terrainOffsetY + 30, // canopy mid-height
        z: greatTreeAnchor.z,
    };

    // Corridor sampling for the foreground pass-by layer + the corridor-wide autumn
    // leaves (chapter-local spline stations; create-time only, zero per-frame cost).
    const chapterPositions = getActiveOdysseyChapterPositions();
    const ch3Start = chapterPositions?.[2];
    const ch4Start = chapterPositions?.[3];
    group.userData.chapterTStart = ch3Start ?? 0.25;
    group.userData.chapterTEnd = ch4Start ?? 0.41;
    const fgPlacements = [];
    const leafPlacements = [];
    if (chapterRange?.center && Number.isFinite(ch3Start) && Number.isFinite(ch4Start)) {
        for (let i = 0; i < 120; i += 1) {
            const t = THREE.MathUtils.lerp(ch3Start, ch4Start, i / 119);
            const pt = getOdysseyPathPointAt(t);
            const side = i % 2 === 0 ? 1 : -1;
            const local = {
                x: pt.x - chapterRange.center.x + side * (2 + Math.random() * 6),
                y: pt.y - chapterCenterY - 1.6 + Math.random() * 1.4,
                z: pt.z - chapterRange.center.z + (Math.random() - 0.5) * 3,
            };
            // CLEAN LANDSCAPE: near-field pass-by silhouettes stripped → fgPlacements stays empty.
            if (i % 2 === 0) {
                leafPlacements.push({
                    x: local.x + side * (3 + Math.random() * 14),
                    y: local.y + 6,
                    z: local.z,
                });
            }
        }
    }

    // Foreground PASS-BY layer (creative plan asset 7): the near-silhouette dark anchor
    // flanking the spline the whole chapter — speed, intimacy, and the darkest value in
    // every frame.
    const foregroundLayer = createForegroundLayer(uniforms, fgPlacements);
    foregroundLayer.name = 'foreground-pass-by';
    group.add(foregroundLayer);
    group.userData.foregroundLayer = foregroundLayer;

    const fallingLeaves = createFallingLeaves(uniforms, 0, leafPlacements); // CLEAN LANDSCAPE: autumn leaf drift cut (object kept truthy)
    fallingLeaves.name = 'falling-leaves';
    fallingLeaves.position.y += terrainOffsetY;
    group.add(fallingLeaves);
    group.userData.fallingLeaves = fallingLeaves;

    // Winter snow motes (creative plan asset 9): the final act's particle story.
    const snowMotes = createSnowMotes(uniforms, 0); // CLEAN LANDSCAPE: winter motes cut (object+key kept)
    snowMotes.name = 'snow-motes';
    group.add(snowMotes);
    group.userData.snowMotes = snowMotes;

    // 10. Warm-amber pollen motes drifting in the golden-hour light. (Remake plan declutter:
    // 600 -> 300 — still a soft golden shimmer, half the additive fill.)
    const pollen = createPollen(uniforms, 0); // CLEAN LANDSCAPE: pollen additive shimmer cut
    pollen.name = 'pollen';
    group.add(pollen);
    group.userData.pollen = pollen;

    // 11. A couple of drifting birds (low-poly silhouettes).
    const birds = createBirds(CH3_BIRD_SILHOUETTE_SETTINGS.flockCount);
    birds.name = 'birds';
    group.add(birds);
    group.userData.birds = birds;

    const quaterniusNatureLayer = createQuaterniusNatureLayer(group, terrainOffsetY);
    group.add(quaterniusNatureLayer);
    group.userData.quaterniusNatureLayer = quaterniusNatureLayer;
    group.userData.quaterniusProceduralFallbacks = [trees, greatTree, birds];

    // Golden-hour raking key (Batch B5): a LOW warm directional sun raking from the left
    // gilds the hills with long shadows, balanced by a cool sky-fill ambient that keeps the
    // shadows from going muddy. Lower/warmer than the old near-overhead key so the relief
    // reads at the forward angle without lifting the frame toward white.
    const ambient = new THREE.AmbientLight(0xacc6e6, 0.18); // Low cool flat floor
    group.add(ambient);
    const sunLight = new THREE.DirectionalLight(0xffcf7a, 0.7); // Low warm golden key
    sunLight.position.set(-90, 38, -120); // low raking angle from the left
    group.add(sunLight);
    // Hemisphere sky/ground bounce — gives the now-LIT vegetation (MeshLambertNode trees)
    // a natural fill so shadow sides read as lush green, not black silhouettes. Only the lit
    // foliage responds; the unlit terrain/GLB props are unaffected, so the grade is unchanged.
    const hemiFill = new THREE.HemisphereLight(0xcfe4ff, 0x5a7a44, 0.75);
    group.add(hemiFill);
    group.userData.hemiFill = hemiFill;
    // Creative plan item 6: the season MOVES the key — spring gold → autumn amber →
    // winter pale-blue. Colors precomputed (no per-frame allocation); the update loop
    // rewrites color/intensity every frame per the QW4 light-rig rule.
    group.userData.sunKey = sunLight;
    group.userData.skyFill = ambient;
    group.userData.seasonLight = {
        springKey: new THREE.Color(0xffcf7a),
        autumnKey: new THREE.Color(0xffb070),
        winterKey: new THREE.Color(0xdce8ff),
        springFill: new THREE.Color(0xacc6e6),
        winterFill: new THREE.Color(0xc9d6ee),
    };

    // Store references to surface-only elements for visibility toggling (visible from
    // above the water). The alpine pieces (foothillBridge, distantMountains) are NOT here
    // — they toggle on the combined surface+alpine-ramp gate below so they never appear in
    // the Deep Ocean view (see resolveSurfaceWorldAlpineRampState).
    group.userData.surfaceElements = [
        ocean,
        landscape,
        sun,
        rays,
        clouds,
        meadowFlowers,
        trees,
        reeds,
        coniferBelt,
        bridgeConiferBelt,
        greatTree,
        fallingLeaves,
        foregroundLayer,
        snowMotes,
        pollen,
        birds,
        quaterniusNatureLayer,
    ];
    group.userData.skyElement = sky;
    group.userData.waterSurfaceY = surfaceWorldY;
    group.userData.snowBlendUniformTargets = [
        ...collectUniformTargetsFromRoots(
            // Deciduous trees whiten toward the seam so the deciduous→conifer→snow belt blends
            // (the procedural spruces that also carried uSnowBlend were cut — belt handles it now).
            [landscape, foothillBridge, distantMountains, trees],
            'uSnowBlend',
        ),
        // The conifer belts whiten with the same season/altitude snow blend.
        coniferBelt.userData.uSnowBlend,
    ];
    group.userData.surfaceOpacityUniformTargets = collectUniformTargetsFromRoots(
        [
            ocean,
            landscape,
            sun,
            rays,
            clouds,
            foregroundLayer,
            snowMotes,
            pollen,
        ],
        'uOpacity',
    );
    group.userData.oceanOpacityUniformTargets = collectUniformTargetsFromRoots(
        [ocean],
        'uOpacity',
    );
    // GATE THE LEAK: the alpine pieces (distant range + foothill skirt) get their own
    // opacity target set so they can be gated by BOTH the underwater surface fade AND the
    // Surface→Mountains alpine ramp (so they never bleed into the Deep Ocean view). They
    // are deliberately excluded from surfaceOpacityUniformTargets above to avoid a
    // double-write of the same uOpacity node within one frame.
    group.userData.alpineOpacityUniformTargets = collectUniformTargetsFromRoots(
        [foothillBridge],
        'uOpacity',
    );
    group.userData.distantMountainOpacityUniformTargets = collectUniformTargetsFromRoots(
        [distantMountains],
        'uOpacity',
    );
    group.userData.auroraPreviewOpacityUniformTargets = collectUniformTargetsFromRoots(
        [],
        'uOpacity',
    );
    // The alpine pieces toggle on the combined gate (surface + ramp); the rest of the
    // surface elements toggle on surface opacity alone.
    group.userData.alpineElements = [foothillBridge];
    group.userData.distantMountainElements = [distantMountains];

    // Anchor the whole environment to the path's FULL center (x,y,z), not just Y, so the
    // terrain/ocean/mountains stay centred on the path and the forward camera never clips
    // through chapter geometry (mirrors mountain-peaks.js).
    if (chapterRange?.center) {
        group.position.set(chapterRange.center.x, chapterCenterY, chapterRange.center.z);
    } else {
        group.position.y = chapterCenterY;
    }

    // HERO MIRROR (flag ch3HeroMirror): tag the far-silhouette meshes onto the reflection layer so
    // the hero lake's reflector() renders them (sky, terrain, treeline, mountains, tree stands…).
    // The ocean group (sea/river/lake + the reflector target) is EXCLUDED, so water never reflects
    // water (feedback). SELECTIVE by instance count: DENSE instanced foliage/particle clouds (meadow
    // flowers ~3600, wildflowers ~1400, pollen/motes…) barely register in the grazing, blurry lake
    // reflection but would DOUBLE their draw cost in the mirror's 2nd scene pass — so any instanced
    // mesh over ~250 instances is skipped. Structural single meshes and modest stands (trees/spruce/
    // tree-line ≤~120) still reflect. The group is translation-only (above), so the target's
    // horizontal mirror plane stays valid in world space. Virtual-camera layer wired lazily in
    // updateSurfaceWorldEnvironment (it needs the render camera).
    const ch3Reflection = ocean.userData?.ch3Reflection ?? null;
    if (ch3Reflection) {
        group.userData.ch3Reflection = ch3Reflection;
        for (const child of group.children) {
            if (child === ocean) continue;
            child.traverse((o) => {
                if (!(o.isMesh || o.isInstancedMesh)) return;
                // Skip dense foliage/particle clouds — heavy in the 2nd pass, invisible in the mirror.
                if (o.isInstancedMesh && (o.count ?? 0) > 250) return;
                o.layers.enable(CH3_REFLECTION_LAYER);
            });
        }
        // Harden teardown (SB-15 leak trap): register the reflector's GPU resources so the
        // ChapterEnvironmentManager frees them on eviction/theme-switch — the generic material
        // traverse cannot reach a node-graph reflector's render targets. Best-effort + idempotent.
        (group.userData.ownedDisposables ??= []).push({
            dispose() {
                try {
                    ch3Reflection.reflector?.renderTargets?.forEach?.((rt) => rt?.dispose?.());
                    ch3Reflection.renderTargets?.forEach?.((rt) => rt?.dispose?.());
                    ch3Reflection.dispose?.();
                } catch { /* best-effort teardown */ }
            },
        });
    }

    return group;
}

// WebGPU/TSL: sky-sphere backstop delegated to the validated createSkyBackgroundTSL
// builder (graded sky + sun-glow bleed). Same SphereGeometry(2500,64,48), BackSide,
// renderOrder -100. uTime shared in; returned uOpacity tagged for the fade collectors.
function createSkyBackground(uniforms) {
    const { mesh, uniforms: builderUniforms } = createSkyBackgroundTSL(uniforms.uTime, {
        uSeason: uniforms.uSeason,
    });
    return tagUniforms(mesh, builderUniforms);
}

// WebGPU/TSL: paradise ocean delegated to createOceanSurfaceTSL (Gerstner waves +
// caustics + fresnel). Same PlaneGeometry(300,300,64,64) rotated flat, positioned at
// surfaceOffsetY. uTime shared in; returned uOpacity tagged for the fade collectors.
function createOceanSurface(uniforms, surfaceOffsetY = -15, enableReflector = false) {
    const { mesh, reflection, uniforms: builderUniforms } = createOceanSurfaceTSL(
        uniforms.uTime,
        surfaceOffsetY,
        { enableReflector },
    );
    // Surface the hero-lake reflector (flag ch3HeroMirror) so createSurfaceWorldEnvironment can
    // tag the reflection layer and updateSurfaceWorldEnvironment can wire its virtual camera.
    if (reflection) mesh.userData.ch3Reflection = reflection;
    return tagUniforms(mesh, builderUniforms);
}

// WebGPU/TSL: CPU-baked tropical-island terrain delegated to createLandscapeTSL (its
// builder owns the byte-identical getTerrainHeight bake + the GPU sand/grass/fog/snow
// shading). Same position.y = -15 base; uSnowBlend/uOpacity tagged for the collectors.
function createLandscape(uniforms, waterLevel = 60.0) {
    const { mesh, uniforms: builderUniforms } = createLandscapeTSL(uniforms.uTime, waterLevel);
    return tagUniforms(mesh, builderUniforms);
}

// WebGPU/TSL: foothill terrain bridge into Chapter 4 delegated to createFoothillBridgeTSL
// (its builder owns the byte-identical heightfield walk + the GPU grass/tundra/snow/fog
// shading). Same position (0,0,-500) and renderOrder -2; uSnowBlend/uOpacity tagged for
// the collectors (and the live update() reads uOpacity from userData.odysseyUniforms to
// drive the bridge's depthWrite toggle).
function createFoothillBridge(uniforms) {
    const { mesh, uniforms: builderUniforms } = createFoothillBridgeTSL(uniforms.uTime);
    return tagUniforms(mesh, builderUniforms);
}

// WebGPU/TSL: fluffy grass delegated to createFluffyGrassTSL (instanced billboard quads
// with wind-sway + the procedural blade CanvasTexture, anchored to the same getTerrainHeight
// bake). Returns the InstancedMesh; kept exported for parity with the live API.
export function createFluffyGrass(uniforms, count) {
    const { mesh } = createFluffyGrassTSL(uniforms.uTime, count);
    return mesh;
}

// WebGPU/TSL: Living Landscapes vegetation. Each builder returns an instanced low-poly
// mesh anchored to getTerrainHeight() (props sit on the ground, no floating). No uniforms
// to tag (the sway is time-driven via the shared uTime node), so they are returned plain.

// Real 3D per-species WILDFLOWERS (daisy/buttercup/poppy/lupine/cornflower) — replaces the flat
// cross-card blooms. Deliberately placed (banks-dense, corridor-clear) by the shared composition
// grammar. Delegates to createWildflowersTSL; returns the group (terrain-anchored in-builder).
function createWildflowers(uniforms, count) {
    const { group } = createWildflowersTSL(uniforms.uTime, count);
    return group;
}

function createTrees(uniforms, count) {
    const { mesh, uniforms: builderUniforms } = createTreesTSL(uniforms.uTime, count, {
        uSeason: uniforms.uSeason,
    });
    return tagUniforms(mesh, builderUniforms); // uSnowBlend → whitens toward the seam
}

function createReeds(uniforms, count) {
    const { mesh } = createReedsTSL(uniforms.uTime, count);
    return mesh;
}

// WebGPU/TSL: HERO Great Tree (one large merged low-poly tree). Returns the mesh, anchored
// in the builder via getTerrainHeight; the env lifts it by terrainOffsetY like the props.
function createGreatTree(uniforms) {
    const { mesh } = createGreatTreeTSL(uniforms.uTime);
    return mesh;
}

// WebGPU/TSL: falling-leaf billboards — near-tree halo + corridor-wide autumn story.
function createFallingLeaves(uniforms, count, corridorPlacements) {
    const { mesh } = createFallingLeavesTSL(uniforms.uTime, count, {
        uSeason: uniforms.uSeason,
        corridorPlacements,
    });
    return mesh;
}

// WebGPU/TSL: warm-amber pollen motes (instanced billboard quads, radial feather). uOpacity
// is tagged so the surface fade collector drives it like the other surface elements.
function createPollen(uniforms, count) {
    const { mesh, uniforms: builderUniforms } = createPollenTSL(uniforms.uTime, count, {
        uSeason: uniforms.uSeason,
    });
    return tagUniforms(mesh, builderUniforms);
}

// WebGPU/TSL: drifting low-poly bird silhouettes (animated in update via userData.birds).
// Creative plan asset 8: the first two birds become LOW FAST CROSSERS cutting the
// corridor at height 8–14 — small fast shapes across the travel vector are the
// cheapest "alive" signal the chapter can render.
function createBirds(count) {
    const { group } = createBirdsTSL(count);
    const crosserCount = Math.min(CH3_BIRD_SILHOUETTE_SETTINGS.crosserCount, group.children.length);
    group.children.slice(0, crosserCount).forEach((bird, i) => {
        bird.userData.crosser = true;
        bird.userData.lane = -22 - i * 24;
        bird.userData.height = 10 + i * 4;
        bird.userData.speed = 1.1 + i * 0.24;
        bird.userData.closeScale = 1.55 + i * 0.12;
    });
    group.userData.cc0Candidate = CH3_BIRD_SILHOUETTE_SETTINGS.cc0Candidate;
    group.userData.animatedCc0Candidate = CH3_BIRD_SILHOUETTE_SETTINGS.animatedCc0Candidate;
    return group;
}

// Foreground pass-by silhouettes; uOpacity tagged for the surface fade collectors.
function createForegroundLayer(uniforms, placements) {
    const { mesh, uniforms: builderUniforms } = createForegroundPassByTSL(
        uniforms.uTime,
        placements,
    );
    return tagUniforms(mesh, builderUniforms);
}

// Winter snow motes; uOpacity tagged for the surface fade collectors.
function createSnowMotes(uniforms, count) {
    const { mesh, uniforms: builderUniforms } = createSnowMotesTSL(uniforms.uTime, count, {
        uSeason: uniforms.uSeason,
    });
    return tagUniforms(mesh, builderUniforms);
}

// WebGPU/TSL: visible golden SUN disc + soft halo delegated to createSunDiscTSL (a single
// camera-facing additive billboard, capped below white). Returns the group; uOpacity tagged
// on the group for the surface fade collectors.
function createSunDisc(uniforms) {
    const { group, uniforms: builderUniforms } = createSunDiscTSL(uniforms.uTime, {
        uSeason: uniforms.uSeason,
    });
    return tagUniforms(group, builderUniforms);
}

// WebGPU/TSL: additive golden volumetric sun-rays delegated to createSunRaysTSL (its
// builder owns the 5-beam group + bloom-eligible additive material). Returns the group;
// uOpacity tagged on the group for the fade collectors.
function createSunRays(uniforms) {
    const { group, uniforms: builderUniforms } = createSunRaysTSL(uniforms.uTime, {
        uSeason: uniforms.uSeason,
    });
    return tagUniforms(group, builderUniforms);
}

// WebGPU/TSL: soft procedural clouds delegated to createCloudsTSL (its builder owns the
// 6-puff group + NormalBlending transparent material). Returns the group; uOpacity tagged
// on the group for the fade collectors.
function createClouds(uniforms) {
    const { group, uniforms: builderUniforms } = createCloudsTSL(uniforms.uTime);
    return tagUniforms(group, builderUniforms);
}

// WebGPU/TSL: 3 distant peaks + base valley mist delegated to createDistantMountainsTSL
// (its builder owns the byte-identical per-mountain cone/FBM bakes, the GPU snow/rock/fog
// shading, and the 4-plane mist). Each peak mesh + the mist meshes are tagged with their
// uSnowBlend/uOpacity nodes so the collectors drive snow + surface fade. The mist group is
// exposed on userData.foothillMist for parity with the live API.
function createDistantMountains(uniforms, hostCenter = null) {
    const { group, parts } = createCanonicalMountainRangeTSL({
        hostCenter,
        hostChapterId: 3,
        name: 'canonical-distant-mountains',
        // PEAK-LIGHTING MATCH (Fix D, "disconnected from the winter mountains"): these ARE Ch4's
        // canonical peaks seen from Ch3, so they must be lit the SAME on both sides of the seam.
        // Feeding uSeason drove alpenScale=oneMinus(uSeason)→0 at the seam (no alpenglow, cold),
        // while Ch4 gives them full alpenglow — so the peaks flipped warm→cold as you crossed. Left
        // null → constant full alpenglow, matching Ch4's warm-lit peaks. The valley still winters
        // (grass/fog via uSeason) and the peaks still whiten via uSnowBlend, but the distant
        // destination mountains glow warm continuously across the boundary.
        uTransition: null,
        baseOpacity: 1,
    });
    group.name = 'distant-mountains';

    // Chapter 3 now renders Chapter 4's canonical hero chain at the same world coordinates
    // so the mountains are visible immediately and never swap silhouettes later.
    parts.forEach((part) => {
        if (part?.mesh) {
            tagUniforms(part.mesh, part.uniforms);
        }
    });

    group.userData.foothillMist = null;

    return group;
}

// NOTE: the foothill valley mist is now built inside createDistantMountainsTSL (the
// .tsl.js builder) — the live createMountainMist GLSL helper was removed in the WebGPU swap.

export function updateSurfaceWorldEnvironment(group, delta, time, camera, cameraProgress = null) {
    const { uniforms } = group.userData;
    if (uniforms?.uTime) {
        uniforms.uTime.value = time;
    }

    // HERO MIRROR (flag ch3HeroMirror): wire the reflector's virtual camera to render ONLY the
    // reflection layer (needs the render camera, which the environment build lacks). Once, guarded.
    const { ch3Reflection } = group.userData;
    if (ch3Reflection && camera && !group.userData._ch3ReflWired) {
        try {
            ch3Reflection.reflector.getVirtualCamera(camera).layers.set(CH3_REFLECTION_LAYER);
            group.userData._ch3ReflWired = true;
        } catch {
            /* reflector API-shape guard — leave unwired; the mirror simply won't render */
        }
    }

    // Stage 1 LOD (flag odysseyChapterLOD): shed Ch3's two standout costs when OFF-CENTER — the
    // reflector()'s 2nd scene render (the ocean subgroup) + the ~2,000 additive particle quads
    // (meadow flowers + pollen). Computed here but APPLIED further down, AFTER the surface-element +
    // ocean visibility writes (which are plain assignments that would otherwise clobber it) — and
    // only ever force-HIDES so at full detail the normal gates stand. No-op when the flag is off
    // (detailLevel = 'near' → fullDetail = true).
    const fullDetail = (group.userData.detailLevel || 'near') === 'near';

    // Season scalar (creative plan item 6): chapter-local progress 0→1 scripts the
    // spring→autumn→winter arc through light. Drives the in-shader season gates AND the
    // JS-side key-light lerp below.
    if (uniforms?.uSeason && Number.isFinite(cameraProgress)) {
        const tStart = group.userData.chapterTStart ?? 0.25;
        const tEnd = group.userData.chapterTEnd ?? 0.41;
        const span = Math.max(tEnd - tStart, 1e-4);
        uniforms.uSeason.value = THREE.MathUtils.clamp((cameraProgress - tStart) / span, 0, 1);
    }

    // Season-lerped raking key + sky fill (rewritten every frame per the QW4 light-rig
    // rule; colors precomputed at create — zero per-frame allocation). Spring gold
    // #FFCF7A → autumn amber #FFB070 → winter pale #DCE8FF at lower intensity, so
    // autumn frames measure warmer-lit and winter frames cooler-lit (acceptance check).
    const seasonValue = uniforms?.uSeason ? uniforms.uSeason.value : 0;
    const { seasonLight, sunKey } = group.userData;
    if (sunKey && seasonLight) {
        const autumnT = THREE.MathUtils.smoothstep(seasonValue, 0.38, 0.6)
            * (1 - THREE.MathUtils.smoothstep(seasonValue, 0.72, 0.92));
        const winterT = THREE.MathUtils.smoothstep(seasonValue, 0.68, 0.92);
        sunKey.color.copy(seasonLight.springKey)
            .lerp(seasonLight.autumnKey, autumnT)
            .lerp(seasonLight.winterKey, winterT);
        sunKey.intensity = 0.7 + autumnT * 0.05 - winterT * 0.15;
        const { skyFill } = group.userData;
        if (skyFill) {
            skyFill.color.copy(seasonLight.springFill).lerp(seasonLight.winterFill, winterT);
            skyFill.intensity = 0.18 - winterT * 0.04;
        }
    }

    const waterSurfaceY = group.userData.waterSurfaceY || 35;
    const cameraY = camera?.position?.y ?? 100; // Default to above water
    const surfaceProbeY = Number.isFinite(cameraProgress)
        ? getOdysseyPathPointAt(cameraProgress).y
        : cameraY;
    const visibilityState = resolveSurfaceWorldVisibilityState({
        waterSurfaceY,
        surfaceProbeY,
        cameraY,
    });
    const {
        isUnderwater,
        surfaceOpacity,
    } = visibilityState;
    const auroraPreviewState = resolveSurfaceWorldAuroraPreviewState(cameraProgress);
    const alpineRampState = resolveSurfaceWorldAlpineRampState(cameraProgress);
    // SEAM 3->4 recede: 1->0 across the final stretch of Ch3 into the Surface→Mountains seam
    // so the waterfall + distant range fade BEFORE the group hides (no pop), and the distant
    // range cross-dissolves with the rising Mountains peaks rather than swapping shape hard.
    const seamRecedeState = resolveSurfaceWorldSeamRecedeState(cameraProgress);
    const { recedeOpacity } = seamRecedeState;
    const { surfaceExitOpacity } = resolveSurfaceWorldSurfaceExitState(cameraProgress);
    const waterCrossingState = resolveSurfaceWorldWaterCrossingState(cameraProgress);
    // ENTRY RAMP (frames 01–02 slab pop + petal leak fix): every surface element rises
    // into presence across the breach instead of appearing fully formed.
    const { entryOpacity } = resolveSurfaceWorldEntryRampState(cameraProgress);
    const surfaceGate = surfaceOpacity * entryOpacity;
    const surfaceElementOpacity = surfaceGate * surfaceExitOpacity;
    // L3 BRIDGE-CONNECT (2026-08, Wave D): the foothill bridge (the only alpineElement) is gated by
    // the underwater surface fade AND the Surface→Mountains ramp, but is NO LONGER receded across the
    // seam — it must persist as a SOLID ramp through the 3→4 crossfade so the ground physically hands
    // off to Ch4's raised snow floor (world ~302) instead of dissolving into a 65u cliff. The manager
    // hides the whole Ch3 group (group.visible = opacity>0) once the ecotone weight reaches 0, so the
    // bridge cannot leak into deep Ch4. recedeOpacity is retained below for the distant range, which
    // SHOULD cross-dissolve with the rising Ch4 peaks.
    const alpineOpacity = surfaceGate * alpineRampState.rampOpacity;
    const distantMountainOpacity = surfaceGate
        * Math.max(SURFACE_DISTANT_MOUNTAIN_PREVIEW_OPACITY, alpineRampState.rampOpacity)
        * recedeOpacity;

    const { snowTransition } = group.userData;
    const heightSnowBlend = snowTransition
        ? THREE.MathUtils.smoothstep(
            cameraY,
            snowTransition.endY - snowTransition.range,
            snowTransition.endY,
        )
        : 0;
    // The Ch3->Ch4 terrain-edge dissolve is authored as part of the season story, not only
    // altitude. Near the seam the chapter can be visually winter while the camera-height
    // snow ramp still lags, so let late-season progress pull the same snow/edge uniform up.
    // Fix D + "green→winter POP" (2026-08): the frost band was too NARROW and completed too EARLY.
    // [0.5,0.72] in seasonValue maps to global progress [0.278,0.311] — the meadow flipped green→
    // full-snow over just ~0.033 of progress and then sat white for ~0.04 BEFORE Ch4 even begins
    // fading in (entry [0.322,0.352]) or the manager's ecotone crossfade ([0.322,0.382]). Two
    // separated beats (early whitening, then the biome swap) read as a pop. Widen the END to 0.98
    // so the whitening spans the whole approach and COMPLETES right at the seam (seasonValue 0.98 ≈
    // progress 0.349 ≈ ch4Start 0.352 / the crossfade midpoint), turning it into one continuous
    // green→frost→snow gradient. Start stays 0.5 so the green hero valley still holds through the
    // first ~half (emergence + lake beats). heightSnowBlend still Math.max-tops it to a hard 1 by
    // the exact boundary, so full snow is guaranteed at the handoff with no seam.
    const seasonSnowBlend = THREE.MathUtils.smoothstep(seasonValue, 0.5, 0.98);
    const snowBlend = Math.max(heightSnowBlend, seasonSnowBlend);

    const snowBlendUniformTargets = group.userData.snowBlendUniformTargets || [];
    snowBlendUniformTargets.forEach((target) => {
        target.value = snowBlend;
    });

    // Toggle visibility of surface-only elements
    const { surfaceElements } = group.userData;

    if (surfaceElements) {
        const hideProceduralFallbacks = group.userData.quaterniusAssetsReady === true;
        const proceduralFallbacks = group.userData.quaterniusProceduralFallbacks || [];
        surfaceElements.forEach((element) => {
            if (element) {
                const isRetiredFallback = hideProceduralFallbacks
                    && proceduralFallbacks.includes(element);
                element.visible = surfaceElementOpacity > 0 && !isRetiredFallback;
            }
        });
    }

    const opacityUniformTargets = group.userData.surfaceOpacityUniformTargets || [];
    opacityUniformTargets.forEach((target) => {
        const baseOpacity = typeof target.__odysseyBaseOpacity === 'number'
            ? target.__odysseyBaseOpacity
            : target.value;
        target.value = baseOpacity * surfaceElementOpacity;
    });

    applyQuaterniusMaterialOpacity(
        group.userData.quaterniusMaterialOpacityTargets || [],
        surfaceElementOpacity,
    );

    const oceanOpacityUniformTargets = group.userData.oceanOpacityUniformTargets || [];
    oceanOpacityUniformTargets.forEach((target) => {
        const baseOpacity = typeof target.__odysseyBaseOpacity === 'number'
            ? target.__odysseyBaseOpacity
            : target.value;
        target.value = baseOpacity * surfaceGate * waterCrossingState.waterCrossingOpacity;
    });
    const { ocean } = group.userData;
    if (ocean) {
        ocean.visible = surfaceGate > 0 && waterCrossingState.waterCrossingVisible;
    }

    // Stage 1 LOD shed (flag odysseyChapterLOD): force-hide the reflector water + the big meadow/
    // pollen particle clouds when Ch3 is OFF-CENTER. Placed AFTER the surface-element + ocean
    // visibility writes above so it wins (they are plain assignments that would otherwise clobber
    // it); force-HIDE only, so at full detail the normal gates stand. No-op when the flag is off.
    if (!fullDetail) {
        if (ocean) ocean.visible = false;
        if (group.userData.meadowFlowers) group.userData.meadowFlowers.visible = false;
        if (group.userData.pollen) group.userData.pollen.visible = false;
    }

    // Alpine pieces: toggle on the combined gate + drive their dedicated opacity targets.
    const { alpineElements } = group.userData;
    if (alpineElements) {
        alpineElements.forEach((element) => {
            if (element) {
                element.visible = alpineOpacity > 0;
            }
        });
    }

    const alpineOpacityUniformTargets = group.userData.alpineOpacityUniformTargets || [];
    alpineOpacityUniformTargets.forEach((target) => {
        const baseOpacity = typeof target.__odysseyBaseOpacity === 'number'
            ? target.__odysseyBaseOpacity
            : target.value;
        target.value = baseOpacity * alpineOpacity;
    });

    const { distantMountainElements } = group.userData;
    if (distantMountainElements) {
        distantMountainElements.forEach((element) => {
            if (element) {
                element.visible = distantMountainOpacity > 0;
            }
        });
    }

    const distantMountainOpacityUniformTargets = group.userData.distantMountainOpacityUniformTargets || [];
    distantMountainOpacityUniformTargets.forEach((target) => {
        const baseOpacity = typeof target.__odysseyBaseOpacity === 'number'
            ? target.__odysseyBaseOpacity
            : target.value;
        target.value = baseOpacity * distantMountainOpacity;
    });

    const { auroraPreview } = group.userData;
    if (auroraPreview) {
        auroraPreview.visible = surfaceOpacity > 0 && auroraPreviewState.previewVisible;
    }

    const auroraPreviewOpacityUniformTargets = group.userData.auroraPreviewOpacityUniformTargets || [];
    auroraPreviewOpacityUniformTargets.forEach((target) => {
        const baseOpacity = typeof target.__odysseyBaseOpacity === 'number'
            ? target.__odysseyBaseOpacity
            : target.value;
        target.value = baseOpacity * surfaceGate * auroraPreviewState.previewOpacity;
    });

    const bridge = group.userData.foothillBridge;
    const bridgeMaterial = bridge?.material;
    // WebGPU/TSL: the bridge's uOpacity is a TSL uniform node tagged on userData.odysseyUniforms.
    const bridgeOpacityNode = bridge?.userData?.odysseyUniforms?.uOpacity;
    if (bridgeMaterial && bridgeOpacityNode) {
        const bridgeOpacity = bridgeOpacityNode.value;
        const shouldWriteDepth = bridgeOpacity >= 0.98 && surfaceOpacity >= 0.98;
        if (bridgeMaterial.depthWrite !== shouldWriteDepth) {
            bridgeMaterial.depthWrite = shouldWriteDepth;
            bridgeMaterial.needsUpdate = true;
        }
    }

    // Sky visibility (hide sky sphere when underwater for ocean fade)
    const sky = group.userData.skyElement;
    if (sky) {
        sky.visible = !isUnderwater;
    }

    // Drifting birds — wide lazy circles overhead with a swept-wing flap (banked into the
    // turn). The geometry is a swept-wing silhouette whose tips carry Y extent, so beating
    // scale.y actually flaps the wings up/down. Only when above water and visible.
    const { birds } = group.userData;
    if (birds && !isUnderwater) {
        birds.children.forEach((bird) => {
            const ud = bird.userData;
            // LOW FAST CROSSERS (creative plan asset 8): straight passes across the
            // corridor at height 8–14, wrapping — motion aimed across the travel vector.
            if (ud.crosser) {
                const span = 240;
                const tx = ((time * ud.speed * 40 + ud.offset * 60) % span) - span / 2;
                bird.position.set(tx, ud.height + Math.sin(time * 2 + ud.offset) * 1.5, ud.lane);
                const crossFlap = 0.6 + Math.abs(Math.sin(time * (ud.flap + 2))) * 0.8;
                const closeScale = ud.closeScale ?? 1.55;
                bird.scale.set(closeScale, closeScale * crossFlap, closeScale);
                bird.rotation.y = Math.PI / 2;
                bird.rotation.z = 0;
                return;
            }
            const t = time * ud.speed + ud.offset;
            bird.position.set(
                Math.cos(t) * ud.radius,
                ud.height + Math.sin(t * 1.7) * 4,
                Math.sin(t) * ud.radius - 30,
            );
            // Flap: oscillate scale.y so the swept wing tips beat; bank + face the heading.
            const flap = 0.7 + Math.abs(Math.sin(time * ud.flap)) * 0.7;
            bird.scale.set(1.85, 1.85 * flap, 1.85);
            bird.rotation.y = -t + Math.PI / 2;
            bird.rotation.z = Math.sin(t) * 0.28;
        });
    }

    const quaterniusMixers = group.userData.quaterniusAnimationMixers || [];
    quaterniusMixers.forEach((mixer) => mixer.update(delta));

    const quaterniusBirdFlights = group.userData.quaterniusBirdFlights || [];
    if (quaterniusBirdFlights.length > 0 && !isUnderwater) {
        quaterniusBirdFlights.forEach((flight) => {
            const { root } = flight;
            if (!root) return;
            const wings = root.userData.flightWings;
            if (wings) {
                const beat = Math.sin(time * (flight.wingBeat ?? 6.0) + flight.offset * 9.0);
                const lift = 0.18 + Math.abs(beat) * 0.7;
                wings.leftWing.rotation.z = -lift;
                wings.rightWing.rotation.z = lift;
                wings.leftWing.rotation.x = Math.sin(time * 1.7 + flight.offset) * 0.08;
                wings.rightWing.rotation.x = -wings.leftWing.rotation.x;
            }

            if (flight.crosser) {
                const span = 260;
                const tx = ((time * flight.speed * 42 + flight.offset * 120) % span) - span / 2;
                const bob = Math.sin(time * 2.4 + flight.offset * 7) * 1.8;
                root.position.set(tx, flight.height + bob, flight.lane);
                root.rotation.y = Math.PI / 2;
                root.rotation.z = Math.sin(time * 2.1 + flight.offset) * 0.08;
                return;
            }

            const t = time * flight.speed + flight.offset;
            root.position.set(
                Math.cos(t) * flight.radius,
                flight.height + Math.sin(t * 1.6) * 4.5,
                Math.sin(t) * flight.radius - 70,
            );
            root.rotation.y = -t + Math.PI / 2;
            root.rotation.z = Math.sin(t) * 0.18;
        });
    }
}

export default {
    config: SURFACE_WORLD_CONFIG,
    create: createSurfaceWorldEnvironment,
    update: updateSurfaceWorldEnvironment,
};

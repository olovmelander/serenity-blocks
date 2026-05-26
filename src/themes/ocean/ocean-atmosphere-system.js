/* eslint-disable import/no-extraneous-dependencies, import/no-unresolved, no-await-in-loop */
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { loadGltfCached } from './ocean-asset-loader.js';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import {
    attribute,
    cameraPosition,
    cos,
    dot,
    float,
    max as tslMax,
    mix,
    normalWorld,
    positionLocal,
    positionWorld,
    pow,
    sin,
    smoothstep,
    uniform,
    vec3,
    normalize as tslNormalize,
    clamp,
    length,
    modelViewMatrix,
    vec4,
} from 'three/tsl';
import {
    createVolumetricShaftNodeMaterial,
    createHazeLayerNodeMaterial,
    createReefSilhouetteNodeMaterial,
    createBeamDustNodeMaterial,
    createBiomeSilhouetteNodeMaterial,
    createGlowAnchorNodeMaterial,
    createCoralNodeMaterial,
    createCoralOvergrowthNodeMaterial,
} from './ocean-materials.js';
import {
    getHeroRockAssetRecords,
    getHeroRockAssetUrls,
    summarizeRockAssetManifest,
} from './ocean-rock-assets.js';
import {
    getHeroCoralAssetRecords,
    getCoralCarpetAssetRecords,
    summarizeCoralAssetManifest,
} from './ocean-coral-assets.js';
import {
    getHeroKelpAssetRecords,
    getSeabedPlantAssetRecords,
    summarizeKelpAssetManifest,
} from './ocean-kelp-assets.js';
import {
    getHeroReefAssetRecords,
    summarizeReefAssetManifest,
} from './ocean-reef-assets.js';
import { tslCausticProjection, tslDepthGradedFog } from './ocean-tsl-helpers.js';

const SHAFT_COLOR = new THREE.Color(0x8ae8ff);
const SHAFT_WARMTH = new THREE.Color(0xfff5d6);
const FOG_COLOR = new THREE.Color(0x1a8fb8);
// Vibrant tropical-reef palette — matches reference reef-canyon photo.
// Lifted from near-black to mid-tone blue-grey with warm-stone highlights so
// rocks read as a daylit reef shelf rather than a deep abyss.
const ROCK_LOW = new THREE.Color().setRGB(0.20, 0.18, 0.28);
const ROCK_HIGH = new THREE.Color().setRGB(0.70, 0.62, 0.48);

const ROCK_REEF_CLUSTERS = [
    { x: 76, z: 34, radius: 28 },
    { x: -112, z: -72, radius: 42 },
    { x: 118, z: -86, radius: 44 },
]; const HERO_CORAL_PLACEMENTS = [
    // First 10 slots dominate at High/Ultra — new vibrant sponges + corals
    // interleaved with original heroes to match the reference reef photo.
    {
        x: -42, z: 24, scale: 2.7, ry: -0.45, kind: 'branching-coral',
    }, // Left Reef Base
    {
        x: 44, z: 22, scale: 2.6, ry: 0.38, kind: 'orange-tube-sponge',
    }, // Right Arch Base
    {
        x: -56, z: 18, scale: 2.35, ry: 0.82, kind: 'table-coral',
    }, // Left Reef Base
    {
        x: 58, z: 14, scale: 2.45, ry: -0.76, kind: 'magenta-vase-coral',
    }, // Right Arch Base
    {
        x: -64, z: -28, scale: 3.05, ry: 1.22, kind: 'anemone-coral',
    }, // Left Mid Reef
    {
        x: 68, z: -24, scale: 3.10, ry: -1.08, kind: 'purple-tube-sponge',
    }, // Right Mid Reef
    // TripoSR painterly-coral placements for orphan kinds (brain, staghorn, mushroom).
    // Inserted at slots 6-8 so they appear at Ultra/Extreme presets.
    {
        x: -86, z: -8, scale: 2.85, ry: 0.32, kind: 'brain-coral',
    }, // Left Mid Dome
    {
        x: 88, z: -4, scale: 2.75, ry: -0.42, kind: 'staghorn-coral',
    }, // Right Mid Antlers
    {
        x: -30, z: -58, scale: 2.6, ry: 0.92, kind: 'mushroom-coral',
    }, // Center Mid Disk
    {
        x: -94, z: -68, scale: 3.2, ry: 0.62, kind: 'yellow-barrel-sponge',
    },
    {
        x: 96, z: -62, scale: 3.12, ry: -0.34, kind: 'purple-sea-fan',
    },
    {
        x: -118, z: -42, scale: 2.8, ry: 1.4, kind: 'spire-coral',
    },
    {
        x: 114, z: -50, scale: 3.0, ry: -0.8, kind: 'boulder-coral',
    },
    // Slots 10+ — Extreme tier extras
    {
        x: -74, z: 38, scale: 2.6, ry: -0.2, kind: 'orange-tube-sponge',
    },
    {
        x: 78, z: 42, scale: 2.75, ry: 0.5, kind: 'magenta-vase-coral',
    },
    {
        x: -22, z: -92, scale: 3.4, ry: 0.9, kind: 'fan-coral',
    },
    {
        x: 18, z: -98, scale: 3.2, ry: -1.2, kind: 'purple-sea-fan',
    },
];

const HERO_KELP_PLACEMENTS = [
    {
        x: -36, z: 38, scale: 1.22, ry: 0.15, // Foreground left framing kelp
    },
    {
        x: 40, z: 32, scale: 1.25, ry: -0.22, // Foreground right framing kelp
    },
    {
        x: -48, z: 18, scale: 1.0, ry: 0.2,
    },
    {
        x: 54, z: 22, scale: 1.05, ry: -0.18,
    },
    {
        x: -86, z: -38, scale: 1.18, ry: 0.62,
    },
    {
        x: 96, z: -28, scale: 1.16, ry: -0.52,
    },
    {
        x: -126, z: -96, scale: 1.26, ry: 1.1,
    },
    {
        x: 128, z: -88, scale: 1.24, ry: -1.0,
    },
    {
        x: -74, z: 64, scale: 1.08, ry: 0.46,
    },
    {
        x: 78, z: 58, scale: 1.1, ry: -0.4,
    },
];

// Slot order matters — quality presets slice by reefCount, so the most visible
// hero pieces must come first. The flat 'right-coral-shelf' and
// 'left-coral-shelf' GLBs read as pale plateaus in the central camera view
// even when demoted/shrunk, so they're removed entirely from placements.
// Other reef pieces (arches, walls, far stacks) carry the mid-distance silhouette.
const HERO_REEF_PLACEMENTS = [
    {
        idHint: 'reef-arch-coral-01',
        x: 76,
        z: 16,
        scale: 1.15,
        rx: 0.02,
        ry: -0.58,
        rz: 0.0,
        yOffset: 0.0,
        kind: 'foreground-coral-arch',
    },
    {
        idHint: 'reef-wall-left-01',
        x: -78,
        z: 10,
        scale: 1.25,
        rx: -0.04,
        ry: 0.46,
        rz: 0.02,
        yOffset: 0.6,
        kind: 'left-canyon-wall',
    },
    {
        idHint: 'reef-arch-mid-01',
        x: 0,
        z: -95,
        scale: 1.28,
        rx: -0.02,
        ry: 0.02,
        rz: 0.0,
        yOffset: 0.1,
        kind: 'mid-canyon-arch',
    },
    {
        idHint: 'reef-stack-far-01',
        x: -132,
        z: -148,
        scale: 0.95,
        rx: 0.0,
        ry: 0.62,
        rz: -0.02,
        yOffset: 0.0,
        kind: 'far-blue-stack',
    },
    {
        idHint: 'reef-stack-far-01',
        x: 134,
        z: -142,
        scale: 0.86,
        rx: 0.0,
        ry: -0.78,
        rz: 0.02,
        yOffset: -0.2,
        kind: 'far-blue-stack',
    },
];

const CORAL_CARPET_PLACEMENTS = [
    {
        x: -54, z: 50, scale: 3.8, ry: -0.18, kind: 'purple-blue-coral-carpet',
    },
    {
        x: 54, z: 47, scale: 3.6, ry: 0.2, kind: 'orange-tube-sponge-cluster',
    },
    {
        x: -74, z: 18, scale: 3.2, ry: 0.72, kind: 'green-yellow-plate-coral',
    },
    {
        x: 82, z: 14, scale: 3.4, ry: -0.64, kind: 'blue-brush-coral',
    },
    {
        x: -94, z: -48, scale: 4.1, ry: 1.08, kind: 'purple-blue-coral-carpet',
    },
    {
        x: 96, z: -42, scale: 4.0, ry: -1.0, kind: 'orange-tube-sponge-cluster',
    },
    {
        x: -124, z: -112, scale: 4.5, ry: 0.56, kind: 'green-yellow-plate-coral',
    },
    {
        x: 126, z: -104, scale: 4.4, ry: -0.48, kind: 'blue-brush-coral',
    },
    {
        x: -40, z: -14, scale: 3.1, ry: 0.14, kind: 'purple-blue-coral-carpet',
    },
    {
        x: 42, z: -18, scale: 3.2, ry: -0.2, kind: 'green-yellow-plate-coral',
    },
    {
        x: -118, z: -22, scale: 3.5, ry: 0.8, kind: 'blue-brush-coral',
    },
    {
        x: 124, z: -34, scale: 3.8, ry: -1.1, kind: 'orange-tube-sponge-cluster',
    },
];

const IMPORTED_SEABED_DETAIL_PLACEMENTS = [
    {
        type: 'seaweed', x: -42, z: 38, scale: 0.82, ry: 0.12,
    },
    {
        type: 'coral', x: 44, z: 34, scale: 1.15, ry: -0.25,
    },
    {
        type: 'plant', x: -58, z: 10, scale: 2.55, ry: 0.74,
    },
    {
        type: 'rock', x: 58, z: 8, scale: 0.9, ry: -0.55,
    },
    {
        type: 'seaweed', x: 72, z: 48, scale: 0.78, ry: -0.42,
    },
    {
        type: 'coral', x: -76, z: 46, scale: 1.08, ry: 0.65,
    },
    {
        type: 'plant', x: 86, z: 18, scale: 2.45, ry: -0.82,
    },
    {
        type: 'rock', x: -88, z: 16, scale: 0.86, ry: 1.08,
    },
    {
        type: 'seaweed', x: -98, z: -36, scale: 0.92, ry: 1.22,
    },
    {
        type: 'coral', x: 104, z: -38, scale: 1.22, ry: -1.0,
    },
    {
        type: 'plant', x: -118, z: -72, scale: 2.8, ry: 0.55,
    },
    {
        type: 'rock', x: 120, z: -72, scale: 1.04, ry: -0.7,
    },
    {
        type: 'plant', x: 132, z: -96, scale: 2.7, ry: -0.45,
    },
    {
        type: 'seaweed', x: -132, z: -100, scale: 1.0, ry: 0.92,
    },
    {
        type: 'coral', x: -38, z: -24, scale: 0.9, ry: 0.25,
    },
    {
        type: 'rock', x: 38, z: -28, scale: 0.78, ry: -0.3,
    },
    {
        type: 'plant', x: -34, z: 72, scale: 2.25, ry: 0.1,
    },
    {
        type: 'seaweed', x: 36, z: 70, scale: 0.72, ry: -0.2,
    },
    {
        type: 'coral', x: -118, z: -18, scale: 1.0, ry: 0.8,
    },
    {
        type: 'rock', x: 122, z: -26, scale: 0.92, ry: -1.1,
    },
];

function randRange(min, max) {
    return min + Math.random() * (max - min);
}

// Seeded RNG — stable per-rock overgrowth picks across page reloads so the
// reef silhouette doesn't reshuffle every frame.
function mulberry32(seed) {
    let s = seed | 0;
    return function next() {
        s = (s + 0x6D2B79F5) | 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function selectUniqueRecordsForPlacements(records, placements, pickRecord) {
    const selected = [];
    const seen = new Set();
    placements.forEach((placement, index) => {
        const record = pickRecord(records, placement, index);
        if (!record || seen.has(record.id)) return;
        seen.add(record.id);
        selected.push(record);
    });
    return selected;
}

// Walks a GLTF scene graph and returns the first Mesh encountered (Blender
// rock GLBs typically contain a single mesh, sometimes wrapped in transforms).
function extractFirstMesh(root) {
    let found = null;
    root.traverse((obj) => {
        if (!found && obj.isMesh && obj.geometry) found = obj;
    });
    return found;
}

function addNormalizedHeightAttribute(geometry, attributeName = 'aHeroKelpHeight') {
    const position = geometry?.attributes?.position;
    if (!position || geometry.getAttribute(attributeName)) return;

    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < position.count; i++) {
        const y = position.getY(i);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    }
    const heightRange = Math.max(0.0001, maxY - minY);
    const heights = new Float32Array(position.count);
    for (let i = 0; i < position.count; i++) {
        heights[i] = (position.getY(i) - minY) / heightRange;
    }
    geometry.setAttribute(attributeName, new THREE.BufferAttribute(heights, 1));
}

function cacheLocalMinY(root) {
    root.updateWorldMatrix?.(true, true);
    const box = new THREE.Box3().setFromObject(root);
    root.userData.localMinY = Number.isFinite(box.min.y) ? box.min.y : 0;
    return root.userData.localMinY;
}

function setSeabedAnchoredPosition(root, x, y, z, scale = 1) {
    const localMinY = root.userData.localMinY ?? 0;
    root.position.set(x, y - localMinY * scale, z);
}

// Build a unique lumpy rock from an icosphere by walking each vertex and
// scaling it outward by a deterministic per-vertex hash. Two-octave: large
// lumps + fine surface roughness. Seed drives the hash so each call returns
// a different silhouette while staying deterministic for a given seed.
//
// We CPU-displace (rather than vertex-shader displace) because the resulting
// `computeVertexNormals()` lights the bumpy surface correctly — shader-time
// displacement would leave stale icosphere normals and read as a flat orb.
function createDisplacedRockGeometry(seed, subdivisions = 2, displacementStrength = 0.25) {
    const geom = new THREE.IcosahedronGeometry(1, subdivisions);
    const pos = geom.attributes.position;
    const hash = (x, y, z) => {
        const v = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 0.1731) * 43758.5453;
        return v - Math.floor(v);
    };
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const h1 = hash(x * 2.3, y * 2.3, z * 2.3);
        const h2 = hash(x * 5.7, y * 5.7, z * 5.7);
        const d = (h1 - 0.5) * displacementStrength
            + (h2 - 0.5) * displacementStrength * 0.35;
        const len = Math.hypot(x, y, z) || 1;
        const scale = 1 + d / len;
        pos.setXYZ(i, x * scale, y * scale, z * scale);
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();
    return geom;
}

/**
 * Creates sharp, layered, shale-like rock formations matching the reference photo.
 */
function createLayeredRockGeometry(seed, subdivisions = 3, strength = 0.5) {
    const geom = new THREE.IcosahedronGeometry(1, subdivisions);
    // Mild Y-flattening for boulder feel — previous 0.35 read as flat discs
    // when paired with placement scaling that further squashed the Y axis.
    geom.scale(1.0, 0.72, 1.0);
    const pos = geom.attributes.position;
    const hash = (x, y, z) => {
        const v = Math.sin(x * 18.2 + y * 44.3 + z * 21.9 + seed * 0.12) * 43758.5453;
        return v - Math.floor(v);
    };

    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);

        // Stratified noise: strong horizontal jitter, weak vertical jitter.
        const h1 = hash(x * 1.5, y * 12.0, z * 1.5);
        const h2 = hash(x * 4.0, y * 22.0, z * 4.0);

        // Create "shelves" by quantizing Y displacement influence.
        const layer = Math.floor(y * 8.0) / 8.0;
        const layerNoise = hash(seed * 0.5, layer, 0.0);

        const dx = (h1 - 0.5) * strength * 1.2 + (h2 - 0.5) * strength * 0.4;
        const dy = (h1 - 0.5) * strength * 0.15; // Keep vertical noise low for layering
        const dz = (h1 - 0.5) * strength * 1.2 + (h2 - 0.5) * strength * 0.4;

        // Push out more on XZ if near a "layer edge".
        const shelfPush = Math.sin(y * 15.0 + seed) * 0.25 * strength;

        pos.setXYZ(
            i,
            x * (1.0 + shelfPush) + dx,
            y + dy,
            z * (1.0 + shelfPush) + dz,
        );
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();
    return geom;
}

function disposeObject(root) {
    const geometries = new Set();
    const materials = new Set();

    root.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry);
        if (object.material) {
            if (Array.isArray(object.material)) {
                object.material.forEach((material) => materials.add(material));
            } else {
                materials.add(object.material);
            }
        }
    });

    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
}

// Phase I: per-variant InstancedMesh helper. After Phase G's per-clone
// geometry merge, hero asset placements still produce M draw calls per clone
// (one per unique material) × N placements = N×M draws per asset type. This
// helper collapses that to M draw calls per VARIANT regardless of how many
// placements use it — by extracting the merged meshes from the prepared scene
// and rebuilding them as InstancedMeshes. With 10 hero coral placements
// sharing 1 variant × 3 materials, draws drop from 30 → 3.
function buildPlacementInstanceMeshes(placements, pickRecordFor, resultsById) {
    const byVariant = new Map();
    placements.forEach((placement, originalIndex) => {
        const record = pickRecordFor(placement, originalIndex);
        if (!record) return;
        const result = resultsById.get(record.id);
        if (!result || result.status !== 'fulfilled') return;
        if (!byVariant.has(record.id)) {
            byVariant.set(record.id, { record, scene: result.value.scene, slots: [] });
        }
        byVariant.get(record.id).slots.push({ placement, originalIndex });
    });

    const meshes = [];
    const indexToVariantSlot = new Map();
    const dummy = new THREE.Object3D();
    byVariant.forEach(({ record, scene, slots }, variantId) => {
        const count = slots.length;
        if (count <= 0) return;
        const localMinY = scene.userData?.localMinY ?? 0;
        scene.traverse((child) => {
            if (!child.isMesh || !child.geometry || !child.material) return;
            if (Array.isArray(child.material)) return;
            const inst = new THREE.InstancedMesh(child.geometry, child.material, count);
            inst.name = `${child.name || record.id}:inst`;
            inst.frustumCulled = true;
            inst.userData.assetId = record.id;
            inst.userData.assetStatus = 'glb-loaded-instanced';
            inst.userData.triangleCount = record.triangleCount;
            for (let i = 0; i < count; i += 1) {
                const { placement } = slots[i];
                const scale = (placement.scale ?? 1) * (record.runtimeScale ?? 1);
                dummy.position.set(placement.x, placement.y - localMinY * scale, placement.z);
                dummy.rotation.set(placement.rx ?? 0, placement.ry ?? 0, placement.rz ?? 0);
                dummy.scale.setScalar(scale);
                dummy.updateMatrix();
                inst.setMatrixAt(i, dummy.matrix);
            }
            inst.instanceMatrix.needsUpdate = true;
            inst.computeBoundingSphere();
            meshes.push(inst);
        });
        slots.forEach((slot, instanceIdx) => {
            indexToVariantSlot.set(slot.originalIndex, { variantId, instanceIdx });
        });
    });
    return { meshes, indexToVariantSlot };
}

// Phase G.1: shared utility for hero-asset draw-call consolidation.
// Each loaded GLB scene typically contains many child meshes (10-50+); when
// cloned per placement that becomes 10-50+ draw calls per clone. Bisect
// data (noAtmosphere = +48 fps at Extreme) confirmed this is the dominant
// cost. Merging child geometries by material reduces a clone to 1 draw call
// per *unique material*. Must run AFTER per-mesh material conversion so the
// converted materials are visible here; the prepareXAsset functions also
// share materials by source so two children with the same source GLB
// material end up sharing the same converted material instance (required
// for the merge to actually group them).
function mergeMeshesByMaterial(root) {
    if (!root) return;
    root.updateMatrixWorld(true);
    const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const byMaterial = new Map(); // material → { geometries: [], origin: parentGroup }
    const meshesToRemove = [];

    root.traverse((child) => {
        if (!child.isMesh || !child.geometry) return;
        // Skip multi-material meshes — merging them safely would require
        // splitting the geometry by material group, which is more invasive
        // than this surgical pass warrants.
        if (Array.isArray(child.material)) return;
        const material = child.material;
        if (!material) return;

        child.updateMatrixWorld(true);
        // Bake child's transform-relative-to-root into the geometry so the
        // merged mesh placed under root renders the child at its current
        // world position. (root's own transform is re-applied later by the
        // scene graph when the prepared asset is positioned per-placement.)
        const childToRoot = new THREE.Matrix4().multiplyMatrices(rootInverse, child.matrixWorld);
        const geo = child.geometry.clone();
        geo.applyMatrix4(childToRoot);

        if (!byMaterial.has(material)) byMaterial.set(material, []);
        byMaterial.get(material).push(geo);
        meshesToRemove.push(child);
    });

    // Drop the per-child meshes (geometries are already cloned into the merge buckets).
    meshesToRemove.forEach((mesh) => {
        if (mesh.parent) mesh.parent.remove(mesh);
    });

    let mergedCount = 0;
    byMaterial.forEach((geometries, material) => {
        if (geometries.length === 0) return;
        // mergeGeometries returns null on attribute mismatch — fall back to
        // the first geometry alone so we never silently lose meshes.
        const merged = geometries.length === 1
            ? geometries[0]
            : (BufferGeometryUtils.mergeGeometries(geometries, false) || geometries[0]);
        if (!merged) return;
        const mesh = new THREE.Mesh(merged, material);
        mesh.name = `${root.name || 'merged'}:m${mergedCount}`;
        mesh.frustumCulled = true;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.userData.isMergedAsset = true;
        root.add(mesh);
        mergedCount += 1;
        // Dispose individual cloned geometries that merged into a larger buffer.
        if (geometries.length > 1) {
            geometries.forEach((g) => { if (g !== merged) g.dispose(); });
        }
    });
}

function createSharedAtmosphereUniforms() {
    return {
        uTime: { value: 0 },
        uCurrentStrength: { value: 0.5 },
        uGlowIntensity: { value: 0.8 },
        uFogColor: { value: FOG_COLOR },
    };
}

function createFallbackHeroKelpGeometry(height = 8, width = 0.58, segments = 12) {
    const positions = [];
    const heights = [];
    const indices = [];

    for (let s = 0; s <= segments; s++) {
        const t = s / segments;
        const y = t * height;
        const taper = 1 - t * 0.62;
        const curve = Math.sin(t * Math.PI * 1.12) * 0.38;
        const halfWidth = width * taper;
        positions.push(-halfWidth + curve, y, 0, halfWidth + curve, y, 0);
        heights.push(t, t);
        if (s < segments) {
            const i = s * 2;
            indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aHeroKelpHeight', new THREE.Float32BufferAttribute(heights, 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

function createHeroKelpNodeMaterial() {
    const material = new MeshBasicNodeMaterial({
        // Hero kelp blades are thin and viewed from both sides as the camera
        // drifts, so DoubleSide stays — but the cost from kelp is already
        // small (it's the rim/caustic glow that's expensive elsewhere).
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.94,
    });

    const uTime = uniform(0);
    const uCurrentStrength = uniform(0.5);
    const aHeight = attribute('aHeroKelpHeight');
    const heightSq = aHeight.mul(aHeight);
    const phase = positionWorld.x.mul(0.035).add(positionWorld.z.mul(0.026));
    const phaseX = uTime.mul(1.1).add(phase).add(aHeight.mul(4.5));
    const swayX = sin(phaseX).mul(heightSq).mul(uCurrentStrength).mul(1.15);
    const phaseZ = uTime.mul(0.88).add(phase.mul(0.8)).add(aHeight.mul(3.6));
    const swayZ = cos(phaseZ).mul(heightSq).mul(uCurrentStrength).mul(0.8);

    const base = vec3(0.015, 0.16, 0.12);
    const mid = vec3(0.065, 0.35, 0.24);
    const tip = vec3(0.35, 0.76, 0.42);
    let color = mix(base, mid, smoothstep(float(0.02), float(0.58), aHeight));
    color = mix(color, tip, smoothstep(float(0.55), float(1.0), aHeight));
    // WS B1: tip highlight moves from emissiveNode → colorNode so kelp tips
    // don't dump bright pixels into the MRT emissive target the god-ray Loop
    // samples. Visual: the tip glow still appears in the rendered color.
    const tipHighlight = tip.mul(smoothstep(float(0.74), float(1.0), aHeight).mul(0.1));

    material.colorNode = color.add(tipHighlight);
    material.positionNode = positionLocal.add(vec3(swayX, float(0.0), swayZ));
    material.emissiveNode = vec3(0);
    material.userData = { uTime, uCurrentStrength };
    return material;
}

function createHeroKelpShaderMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uCurrentStrength: { value: 0.5 },
        },
        vertexShader: `
            uniform float uTime;
            uniform float uCurrentStrength;
            attribute float aHeroKelpHeight;
            varying float vHeight;

            void main() {
                vec3 pos = position;
                float h = aHeroKelpHeight;
                vec4 origin = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
                float phase = origin.x * 0.035 + origin.z * 0.026;
                float phaseX = uTime * 1.1 + phase + h * 4.5;
                float phaseZ = uTime * 0.88 + phase * 0.8 + h * 3.6;
                pos.x += sin(phaseX) * h * h * uCurrentStrength * 1.15;
                pos.z += cos(phaseZ) * h * h * uCurrentStrength * 0.8;
                vHeight = h;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
            }
        `,
        fragmentShader: `
            varying float vHeight;

            void main() {
                vec3 base = vec3(0.015, 0.16, 0.12);
                vec3 mid = vec3(0.065, 0.35, 0.24);
                vec3 tip = vec3(0.35, 0.76, 0.42);
                vec3 color = mix(base, mid, smoothstep(0.02, 0.58, vHeight));
                color = mix(color, tip, smoothstep(0.55, 1.0, vHeight));
                color += tip * smoothstep(0.74, 1.0, vHeight) * 0.08;
                gl_FragColor = vec4(color, 0.94);
            }
        `,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: true,
    });
}

function createImportedSeabedPlantNodeMaterial() {
    const material = new MeshBasicNodeMaterial({
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.97,
    });

    const uTime = uniform(0);
    const uCurrentStrength = uniform(0.5);
    const aHeight = attribute('aHeroKelpHeight');
    const heightSq = aHeight.mul(aHeight);
    const phase = positionWorld.x.mul(0.04).add(positionWorld.z.mul(0.031));
    const phaseX = uTime.mul(1.1).add(phase).add(aHeight.mul(4.5));
    const swayX = sin(phaseX).mul(heightSq).mul(uCurrentStrength).mul(1.1);
    const phaseZ = uTime.mul(0.88).add(phase.mul(0.8)).add(aHeight.mul(3.6));
    const swayZ = cos(phaseZ).mul(heightSq).mul(uCurrentStrength).mul(0.77);

    const base = vec3(0.025, 0.18, 0.12);
    const mid = vec3(0.11, 0.46, 0.31);
    const tip = vec3(0.7, 0.84, 0.32);
    let color = mix(base, mid, smoothstep(float(0.0), float(0.62), aHeight));
    color = mix(color, tip, smoothstep(float(0.58), float(1.0), aHeight));

    // Diffuse lighting based on normal
    const lightDir = tslNormalize(vec3(0.16, 0.92, -0.18));
    const diffuse = tslMax(float(0.24), dot(normalWorld, lightDir));
    color = color.mul(diffuse);

    // Subsurface Scattering (translucency) at the tips
    const viewDir = tslNormalize(cameraPosition.sub(positionWorld));
    const sssDot = clamp(dot(viewDir.negate(), lightDir), float(0.0), float(1.0));
    const sssStrength = pow(aHeight, float(2.0)).mul(sssDot).mul(0.38);
    const sssColor = vec3(0.4, 0.88, 0.3);
    color = color.add(sssColor.mul(sssStrength));

    // Project caustics
    const caustic = tslCausticProjection(positionWorld.xz, uTime, 0.18);
    color = color.add(vec3(0.5, 0.96, 0.7).mul(caustic).mul(aHeight).mul(0.26));

    // Depth-graded fog wash
    const viewDist = length(modelViewMatrix.mul(vec4(positionLocal, float(1.0))).xyz);
    color = tslDepthGradedFog(color, positionWorld.y, viewDist, float(1.05));

    // WS B1: tip highlight moves from emissiveNode → colorNode. Plants are not
    // self-illuminated in nature; the highlight remains visible in the rendered
    // output, but doesn't dump bright pixels into the MRT emissive target.
    const tipHighlight = tip.mul(smoothstep(float(0.68), float(1.0), aHeight).mul(0.16));
    material.colorNode = color.add(tipHighlight);
    material.positionNode = positionLocal.add(vec3(swayX, float(0.0), swayZ));
    material.emissiveNode = vec3(0);
    material.userData = { uTime, uCurrentStrength };
    return material;
}

function createImportedSeabedPlantShaderMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uCurrentStrength: { value: 0.5 },
            uFogShallow: { value: new THREE.Color().setRGB(0.0, 0.24, 0.42) },
            uFogDeep: { value: new THREE.Color().setRGB(0.0, 0.08, 0.18) },
        },
        vertexShader: `
            uniform float uTime;
            uniform float uCurrentStrength;
            attribute float aHeroKelpHeight;
            varying float vHeight;
            varying vec3 vNormal;
            varying vec2 vWorldXZ;
            varying vec3 vWorldPos;
            varying float vDist;

            void main() {
                vec3 pos = position;
                float h = aHeroKelpHeight;
                vec4 origin = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
                float phase = origin.x * 0.04 + origin.z * 0.031;
                float phaseX = uTime * 1.1 + phase + h * 4.5;
                float phaseZ = uTime * 0.88 + phase * 0.8 + h * 3.6;
                pos.x += sin(phaseX) * h * h * uCurrentStrength * 1.1;
                pos.z += cos(phaseZ) * h * h * uCurrentStrength * 0.77;
                vHeight = h;
                
                vec4 worldPos = modelMatrix * vec4(pos, 1.0);
                vWorldPos = worldPos.xyz;
                vWorldXZ = worldPos.xz;
                vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
                vDist = length(mvPos.xyz);
                vNormal = normalize(normalMatrix * normal);
                gl_Position = projectionMatrix * mvPos;
            }
        `,
        fragmentShader: `
            varying float vHeight;
            varying vec3 vNormal;
            varying vec2 vWorldXZ;
            varying vec3 vWorldPos;
            varying float vDist;
            uniform float uTime;
            uniform vec3 uFogShallow;
            uniform vec3 uFogDeep;

            void main() {
                vec3 base = vec3(0.025, 0.18, 0.12);
                vec3 mid = vec3(0.11, 0.46, 0.31);
                vec3 tip = vec3(0.7, 0.84, 0.32);
                vec3 color = mix(base, mid, smoothstep(0.0, 0.62, vHeight));
                color = mix(color, tip, smoothstep(0.58, 1.0, vHeight));

                // Diffuse lighting
                vec3 lightDir = normalize(vec3(0.16, 0.92, -0.18));
                float diffuse = max(0.24, dot(normalize(vNormal), lightDir));
                color *= diffuse;

                // Subsurface Scattering (translucency) at tips
                vec3 viewDir = normalize(cameraPosition - vWorldPos);
                float sssDot = clamp(dot(-viewDir, lightDir), 0.0, 1.0);
                float sssStrength = pow(vHeight, 2.0) * sssDot * 0.38;
                vec3 sssColor = vec3(0.4, 0.88, 0.3);
                color += sssColor * sssStrength;

                // Project caustics
                float c1 = sin(vWorldXZ.x * 0.22 + uTime * 0.7) * sin(vWorldXZ.y * 0.18 + uTime * 0.5);
                float c2 = sin(vWorldXZ.x * 0.28 - uTime * 0.6) * sin(vWorldXZ.y * 0.24 + uTime * 0.8);
                float caustic = pow(max(0.0, (c1 + c2) * 0.5), 3.0);
                color += vec3(0.5, 0.96, 0.7) * caustic * 0.26 * vHeight;

                // Depth-graded fog wash
                float depthMix = smoothstep(-25.0, 24.0, vWorldPos.y);
                vec3 fogColor = mix(uFogDeep, uFogShallow, depthMix);
                float fog = 1.0 - exp(-vDist * 0.0036);
                color = mix(color, fogColor, clamp(fog * 0.65, 0.0, 0.82));

                gl_FragColor = vec4(color, 0.97);
            }
        `,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: true,
    });
}

function createHeroCoralNodeMaterial(sourceMaterial, opts = {}) {
    const baseColor = sourceMaterial?.color || new THREE.Color(0xc06a52);
    const material = new MeshStandardNodeMaterial({
        color: baseColor,
        map: sourceMaterial?.map ?? null,
        normalMap: sourceMaterial?.normalMap ?? null,
        roughnessMap: sourceMaterial?.roughnessMap ?? null,
        metalnessMap: sourceMaterial?.metalnessMap ?? null,
        roughness: sourceMaterial?.roughness ?? 0.74,
        metalness: sourceMaterial?.metalness ?? 0.02,
        envMapIntensity: 1.08,
        // WS B2: hero coral is always viewed from in front of the camera.
        // FrontSide halves fragment shading vs DoubleSide.
        side: sourceMaterial?.side === THREE.DoubleSide ? THREE.FrontSide : (sourceMaterial?.side ?? THREE.FrontSide),
        transparent: sourceMaterial?.transparent ?? false,
        opacity: sourceMaterial?.opacity ?? 1,
        alphaTest: sourceMaterial?.alphaTest ?? 0.08,
    });
    const uTime = uniform(0);
    const uGlowIntensity = uniform(0.8);
    const viewDir = tslNormalize(cameraPosition.sub(positionWorld));
    const rim = pow(float(1.0).sub(tslMax(dot(normalWorld, viewDir), float(0.0))), float(2.35));
    const caustic = tslCausticProjection(positionWorld.xz, uTime, 0.14);
    const warmRim = vec3(1.0, 0.58, 0.34).mul(rim).mul(0.28);
    const coolCaustic = vec3(0.26, 0.9, 0.78).mul(caustic).mul(0.18);
    const tint = warmRim.add(coolCaustic).mul(float(0.68).add(uGlowIntensity.mul(0.14)));

    // Vertex-colored meshes (TripoSR GLBs with COLOR_0) need their pastel painted
    // colors to drive the final hue, not the GLB's neutral baseColorFactor. The
    // 1.6× lift restores the pastel "pop" lost to underwater scene lighting.
    if (opts.vertexColors) {
        const vColor = attribute('color', 'vec3');
        material.colorNode = vec3(baseColor.r, baseColor.g, baseColor.b).mul(vColor).mul(1.6).add(tint);
    } else {
        material.colorNode = vec3(baseColor.r, baseColor.g, baseColor.b).add(tint);
    }
    material.emissiveNode = vec3(0);

    material.userData = {
        uTime,
        uGlowIntensity,
        heroCoralMaterial: true,
        materialMode: 'no-emissive-mrt-rim-in-color',
    };
    return material;
}

function createHeroCoralStandardMaterial(sourceMaterial, opts = {}) {
    const color = sourceMaterial?.color?.clone?.() || new THREE.Color(0xc06a52);
    // WS B1: WebGL2 fallback. No MRT here (legacy composer path) but we still
    // drop emissive so the scene-pass output stays at a similar luma to the
    // WebGPU path (and bloom in the legacy composer doesn't pick coral up).
    // Slightly brighten base color to compensate visually for the lost glow.
    const brightened = color.clone().multiplyScalar(1.14);
    return new THREE.MeshStandardMaterial({
        color: brightened,
        map: sourceMaterial?.map ?? null,
        normalMap: sourceMaterial?.normalMap ?? null,
        roughnessMap: sourceMaterial?.roughnessMap ?? null,
        metalnessMap: sourceMaterial?.metalnessMap ?? null,
        roughness: sourceMaterial?.roughness ?? 0.74,
        metalness: sourceMaterial?.metalness ?? 0.02,
        vertexColors: !!opts.vertexColors,
        emissive: 0x000000,
        emissiveIntensity: 0,
        envMapIntensity: 1.08,
        // WS B2: FrontSide for the same reason as the WebGPU path.
        side: sourceMaterial?.side === THREE.DoubleSide ? THREE.FrontSide : (sourceMaterial?.side ?? THREE.FrontSide),
        transparent: sourceMaterial?.transparent ?? false,
        opacity: sourceMaterial?.opacity ?? 1,
        alphaTest: sourceMaterial?.alphaTest ?? 0.08,
    });
}

function createHeroReefNodeMaterial(sourceMaterial) {
    const baseColor = sourceMaterial?.color || new THREE.Color(0x1c4c5a);
    const material = new MeshStandardNodeMaterial({
        color: baseColor,
        map: sourceMaterial?.map ?? null,
        normalMap: sourceMaterial?.normalMap ?? null,
        roughnessMap: sourceMaterial?.roughnessMap ?? null,
        metalnessMap: sourceMaterial?.metalnessMap ?? null,
        roughness: sourceMaterial?.roughness ?? 0.82,
        metalness: sourceMaterial?.metalness ?? 0.0,
        envMapIntensity: 1.18,
        // WS B2: hero reef walls are background scenery — backfaces never visible.
        side: sourceMaterial?.side === THREE.DoubleSide ? THREE.FrontSide : (sourceMaterial?.side ?? THREE.FrontSide),
        transparent: sourceMaterial?.transparent ?? false,
        opacity: sourceMaterial?.opacity ?? 1,
        alphaTest: sourceMaterial?.alphaTest ?? 0.02,
    });
    const uTime = uniform(0);
    const uGlowIntensity = uniform(0.8);
    const viewDir = tslNormalize(cameraPosition.sub(positionWorld));
    const rim = pow(float(1.0).sub(tslMax(dot(normalWorld, viewDir), float(0.0))), float(2.1));
    const upLight = tslMax(normalWorld.y, float(0.0));
    const caustic = tslCausticProjection(positionWorld.xz, uTime, 0.12);
    const cyanRim = vec3(0.42, 0.98, 0.88).mul(rim).mul(0.22);
    const shelfCaustic = vec3(0.82, 1.0, 0.58).mul(caustic).mul(upLight).mul(0.18);
    const tint = cyanRim.add(shelfCaustic).mul(float(0.7).add(uGlowIntensity.mul(0.12)));

    // Slope-based sand accumulation (sand settles on horizontal shelves)
    const slope = normalWorld.y;
    const sandColor = vec3(0.82, 0.74, 0.56); // matching sandMid
    const sandWeight = smoothstep(float(0.45), float(0.85), slope);
    // WS B1: rim + caustic move from emissiveNode → colorNode so the reef
    // doesn't contribute to MRT emissive (god-ray Loop / bloom samples).
    material.colorNode = mix(baseColor, sandColor, sandWeight).add(tint);
    material.emissiveNode = vec3(0);

    material.userData = {
        uTime,
        uGlowIntensity,
        heroReefMaterial: true,
        materialMode: 'preserve-pbr-caustic-rim',
    };
    return material;
}

function createHeroReefStandardMaterial(sourceMaterial) {
    const color = sourceMaterial?.color?.clone?.() || new THREE.Color(0x1c4c5a);
    // WS B1: WebGL2 fallback. Drop emissive contribution and slightly
    // brighten the base color to compensate visually.
    const brightened = color.clone().multiplyScalar(1.12);
    const material = new THREE.MeshStandardMaterial({
        color: brightened,
        map: sourceMaterial?.map ?? null,
        normalMap: sourceMaterial?.normalMap ?? null,
        roughnessMap: sourceMaterial?.roughnessMap ?? null,
        metalnessMap: sourceMaterial?.metalnessMap ?? null,
        roughness: sourceMaterial?.roughness ?? 0.82,
        metalness: sourceMaterial?.metalness ?? 0.0,
        emissive: 0x000000,
        emissiveIntensity: 0,
        envMapIntensity: 1.18,
        // WS B2: FrontSide for background reef geometry.
        side: sourceMaterial?.side === THREE.DoubleSide ? THREE.FrontSide : (sourceMaterial?.side ?? THREE.FrontSide),
        transparent: sourceMaterial?.transparent ?? false,
        opacity: sourceMaterial?.opacity ?? 1,
        alphaTest: sourceMaterial?.alphaTest ?? 0.02,
    });

    material.onBeforeCompile = (shader) => {
        // Pass world normal from vertex to fragment shader
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
             varying vec3 vWorldNormal;`,
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <beginnormal_vertex>',
            `#include <beginnormal_vertex>
             vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
        );

        // Blend diffuseColor with sand color based on slope of vWorldNormal
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
             varying vec3 vWorldNormal;`,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <color_fragment>',
            `#include <color_fragment>
             float slope = normalize(vWorldNormal).y;
             float sandWeight = smoothstep(0.45, 0.85, slope);
             vec3 sandColor = vec3(0.82, 0.74, 0.56);
             diffuseColor.rgb = mix(diffuseColor.rgb, sandColor, sandWeight);`,
        );
    };

    return material;
}

export class OceanAtmosphereSystem {
    constructor({
        scene,
        camera,
        preset,
        getSeabedHeight,
        isWebGPU = false,
        skipFlags = {},
    }) {
        this.scene = scene;
        this.camera = camera;
        this.preset = preset;
        this.getSeabedHeight = getSeabedHeight;
        this.isWebGPU = isWebGPU;
        this.settings = preset?.atmosphere ?? {};
        // Phase 1 diagnostic skip flags: each key maps to one of the per-component
        // ?oceanNoX URL flags. Defaults to {} (everything enabled).
        this.skipFlags = skipFlags;
        this.group = new THREE.Group();
        this.group.name = 'ocean-cinematic-atmosphere';
        this.uniforms = [];
        // TSL userData containers (parallel structure to legacy uniforms; same .value API)
        this.tslUserData = [];
        // Track god-ray occluder geometry positions so the camera state machine can
        // probabilistically frame "shafts threading between rocks" mood (TODO: hint hook).
        this.occluderPositions = [];
        this.billboardDummy = new THREE.Object3D();
        this.glowBillboardMesh = null;
        this.glowBillboardData = null;
        this.dustBillboardMesh = null;
        this.dustBillboardData = null;
        this.assetUpgradeTimers = [];
        this.heroReefWalls = [];
        this.coralCarpetPatches = [];
        this.heroCorals = [];
        this.heroKelp = [];
        this.importedSeabedDetails = [];
        this.coralOvergrowthInstances = [];
        // Tracking arrays for bisect drill-down. Without these, atmosphere
        // sub-components like haze / silhouettes / arches are added directly
        // to this.group and can't be targeted individually.
        this.hazeLayers = [];
        this.reefSilhouettes = [];
        this.biomeSilhouettes = [];
        this.arches = [];
        this.volumetricShafts = [];
        this._coralOvergrowthCache = null;
        this.bottomAssetWarnings = [];
        this.foregroundRockStats = {
            requestedCount: 0,
            proceduralCount: 0,
            discoveredGlbCount: 0,
            glbEnabled: false,
            glbLoadedCount: 0,
            statuses: {},
            errors: {},
        };
        this.coralOvergrowthStats = {
            mode: 'procedural-instanced',
            densityPerRock: 0,
            requestedClusters: 0,
            createdClusters: 0,
            instanceCount: 0,
            meshCount: 0,
        };
        this.heroReefStats = {
            requestedCount: 0,
            placeholderCount: 0,
            loadedCount: 0,
            statuses: {},
            errors: {},
        };
        this.coralCarpetStats = {
            requestedCount: 0,
            placeholderCount: 0,
            loadedCount: 0,
            statuses: {},
            errors: {},
        };
        this.heroCoralStats = {
            requestedCount: 0,
            placeholderCount: 0,
            loadedCount: 0,
            statuses: {},
            errors: {},
        };
        this.heroKelpStats = {
            requestedCount: 0,
            placeholderCount: 0,
            loadedCount: 0,
            statuses: {},
            errors: {},
        };
        this.importedSeabedDetailStats = {
            requestedCount: 0,
            loadedCount: 0,
            plantCount: 0,
            seaweedCount: 0,
            coralCount: 0,
            rockCount: 0,
            statuses: {},
            errors: {},
        };
        this.upgradeQueue = [];
        this.upgradeQueueRunning = false;
    }

    init() {
        // Backwards-compatible single-shot init. Prefer initCritical() +
        // initDeferred() so the heavy procedural anchors can run on later
        // frames without blocking the first paint.
        this.initCritical();
        this.initDeferred();
    }

    initCritical() {
        if (!this.scene || this._criticalInitialized) return;
        this._criticalInitialized = true;

        // These builders define the atmospheric look (god ray shafts, depth
        // haze, distant silhouettes, glow anchors, dust motes). They must be
        // present on the first visible frame.
        //
        // createVolumetricShafts() is intentionally skipped: the post-processing
        // pipeline (ocean-post.js god-ray TSL Loop) already renders the radiant
        // shafts from emissive MRT samples, making the additive-blended cone
        // meshes here visually redundant and a meaningful overdraw cost. If a
        // visual A/B shows the post pass isn't enough, re-enable this call.
        // this.createVolumetricShafts();
        if (!this.skipFlags.haze) this.createHazeLayers();
        if (!this.skipFlags.reefSilhouettes) this.createReefSilhouettes();
        if (!this.skipFlags.bioSilhouettes) this.createBiomeSilhouettes();
        if (!this.skipFlags.glowAnchors) this.createAnchoredGlowSources();
        if (!this.skipFlags.beamDust) this.createBeamDust();

        this.scene.add(this.group);
    }

    initDeferred() {
        if (!this.scene || this._deferredInitialized) return;
        this._deferredInitialized = true;
        if (!this._criticalInitialized) {
            // Defensive: make sure the group is in the scene if a caller
            // skipped initCritical for some reason.
            this.scene.add(this.group);
        }

        // Heavy procedural anchors. Most of these get GLB-swapped via the
        // upgrade queue anyway, so the procedural fallbacks are scenery the
        // user can comfortably see fade in over the next few frames.
        // Gated by Phase 1 diagnostic flags so we can A/B each component.
        if (!this.skipFlags.heroReef) this.createHeroReefWalls();
        if (!this.skipFlags.foregroundRocks) this.createForegroundRocks();
        if (!this.skipFlags.coralCarpets) this.createCoralCarpetPatches();
        if (!this.skipFlags.heroCoral) this.createHeroCorals();
        if (!this.skipFlags.heroKelp) this.createHeroKelp();
        if (!this.skipFlags.importedSeabed) this.createImportedSeabedDetails();
    }

    scheduleAssetUpgrade(task, delayMs = 600) {
        const timer = setTimeout(() => {
            this.assetUpgradeTimers = this.assetUpgradeTimers.filter((item) => item !== timer);
            if (!this.group || !this.scene) return;
            task();
        }, delayMs);
        this.assetUpgradeTimers.push(timer);
    }

    enqueueUpgradeTask(task) {
        this.upgradeQueue.push(task);
        if (!this.upgradeQueueRunning) {
            this.processUpgradeQueue().catch((err) => {
                console.warn('🌊 [Ocean] upgrade queue error:', err);
            });
        }
    }

    async processUpgradeQueue() {
        this.upgradeQueueRunning = true;
        while (this.upgradeQueue.length > 0) {
            const task = this.upgradeQueue.shift();
            try {
                await task();
            } catch (err) {
                console.warn('🌊 [Ocean] failed to execute upgrade task:', err);
            }
            await new Promise((resolve) => { setTimeout(resolve, 30); });
        }
        this.upgradeQueueRunning = false;
    }

    /**
     * Scene-ready signal for the bisect runner. Returns true when no async
     * asset upgrades are pending — scheduled deferred GLB loads have all
     * fired, the upgrade queue has drained, and no upgrade task is currently
     * running. Bisect uses this to avoid sampling FPS while the main thread
     * is still being hit by clone/material-conversion work.
     */
    isSceneReady() {
        return (this.assetUpgradeTimers?.length ?? 0) === 0
            && (this.upgradeQueue?.length ?? 0) === 0
            && this.upgradeQueueRunning !== true;
    }

    // Hero reef walls and arches frame the sand channel. Procedural anchors are
    // visible immediately; compact GLBs may replace only the records used by
    // the current quality preset when explicitly enabled.
    createHeroReefWalls() {
        const count = Math.max(0, Math.floor(this.settings.reefWallCount ?? 0));
        this.heroReefStats.requestedCount = count;
        if (count <= 0) return;

        const placements = HERO_REEF_PLACEMENTS.slice(0, count).map((placement, i) => {
            const y = this.getSeabedHeight(placement.x, placement.z) + placement.yOffset;
            return {
                ...placement,
                y,
                rx: placement.rx + randRange(-0.025, 0.025),
                ry: placement.ry + randRange(-0.04, 0.04),
                rz: placement.rz + randRange(-0.02, 0.02),
                index: i,
            };
        });

        placements.forEach((placement) => {
            const placeholder = this.createProceduralHeroReefWall(placement);
            this.heroReefWalls[placement.index] = placeholder;
            this.heroReefStats.placeholderCount += 1;
            this.group.add(placeholder);
        });

        if (this.settings.reefWallGlbEnabled === true) {
            this.enqueueUpgradeTask(() => this.upgradeHeroReefWallsFromGLB(placements));
        } else {
            this.heroReefStats.manifest = summarizeReefAssetManifest().heroReef;
            this.heroReefStats.glbAutoLoadDisabled = true;
            this.heroReefStats.optimizationNote = 'organic-procedural-anchors-skip-blocky-wall-glbs';
        }
    }

    createProceduralHeroReefWall(placement) {
        const group = new THREE.Group();
        group.name = `OceanHeroReefFallback:${placement.index}`;
        group.userData.isOceanHeroReefWall = true;
        group.userData.assetStatus = 'procedural-fallback';
        group.userData.kind = placement.kind;

        const material = this.isWebGPU
            ? createHeroReefNodeMaterial({ color: new THREE.Color(0x1b5660) })
            : new THREE.MeshStandardMaterial({
                color: new THREE.Color(0x1b5660),
                emissive: new THREE.Color(0x06333a),
                emissiveIntensity: 0.1,
                roughness: 0.86,
                metalness: 0.0,
                side: THREE.DoubleSide,
            });
        if (this.isWebGPU) this.tslUserData.push(material.userData);

        const shelfCount = placement.kind === 'mid-canyon-arch' ? 5 : 7;
        for (let i = 0; i < shelfCount; i++) {
            const geometry = createDisplacedRockGeometry(placement.index * 157 + i * 23, 2, 0.34);
            const shelf = new THREE.Mesh(geometry, material);
            const t = shelfCount === 1 ? 0.5 : i / (shelfCount - 1);
            shelf.position.set(
                randRange(-1.8, 1.8),
                0.8 + t * 6.4,
                (t - 0.5) * 6.0 + randRange(-0.7, 0.7),
            );
            shelf.rotation.set(
                randRange(-0.18, 0.18),
                randRange(-0.38, 0.38),
                randRange(-0.16, 0.16),
            );
            shelf.scale.set(
                randRange(3.2, 5.8) * (1 - t * 0.16),
                randRange(0.34, 0.7),
                randRange(0.85, 1.7),
            );
            group.add(shelf);
        }

        const boulderCount = placement.kind === 'mid-canyon-arch' ? 9 : 14;
        for (let i = 0; i < boulderCount; i++) {
            const geometry = createDisplacedRockGeometry(placement.index * 113 + i * 11, 2, 0.32);
            const rock = new THREE.Mesh(geometry, material);
            const angle = (i / boulderCount) * Math.PI * 2;
            rock.position.set(
                Math.cos(angle) * randRange(1.0, 3.6),
                randRange(0.5, 6.9),
                Math.sin(angle) * randRange(0.7, 3.2),
            );
            rock.rotation.set(randRange(-0.16, 0.16), randRange(0, Math.PI * 2), randRange(-0.16, 0.16));
            rock.scale.set(randRange(1.1, 2.4), randRange(0.55, 1.35), randRange(1.0, 2.2));
            group.add(rock);
        }

        group.position.set(placement.x, placement.y, placement.z);
        group.rotation.set(placement.rx, placement.ry, placement.rz);
        group.scale.setScalar(placement.scale * 3.2);
        group.frustumCulled = false;
        return group;
    }

    async upgradeHeroReefWallsFromGLB(placements) {
        const allRecords = getHeroReefAssetRecords();
        this.heroReefStats.manifest = summarizeReefAssetManifest().heroReef;
        const pickRecord = (records, placement, index) => {
            const preferred = records.find((record) => record.id === placement.idHint);
            return preferred || records[index % records.length];
        };
        const records = selectUniqueRecordsForPlacements(allRecords, placements, pickRecord);
        if (!records.length) return;

        records.forEach((record) => {
            this.heroReefStats.statuses[record.id] = 'loading';
            this.heroReefStats.errors[record.id] = null;
        });
        const promises = records.map((record) => loadGltfCached(record.url));
        const results = await Promise.allSettled(promises);

        results.forEach((result, recordIndex) => {
            const record = records[recordIndex];
            if (result.status !== 'fulfilled') {
                this.heroReefStats.statuses[record.id] = 'error';
                this.heroReefStats.errors[record.id] = result.reason?.message || String(result.reason);
                console.warn(`🌊 [Ocean] reef ${record.id} GLB load failed:`, result.reason);
                return;
            }
            this.prepareHeroReefAsset(result.value.scene);
            this.heroReefStats.statuses[record.id] = 'loaded';
        });
        const resultsById = new Map(records.map((record, index) => [record.id, results[index]]));

        placements.forEach((placement, i) => {
            const record = pickRecord(allRecords, placement, i);
            const result = record ? resultsById.get(record.id) : null;
            if (!result || result.status !== 'fulfilled') return;
            const root = result.value.scene.clone(true);
            root.name = `OceanHeroReef:${record.id}:${i}`;
            root.userData.isOceanHeroReefWall = true;
            root.userData.assetId = record.id;
            root.userData.assetStatus = 'glb-loaded';
            root.userData.triangleCount = record.triangleCount;
            root.position.set(placement.x, placement.y, placement.z);
            root.rotation.set(placement.rx, placement.ry, placement.rz);
            root.scale.setScalar(placement.scale * record.runtimeScale);
            // WS A2: enable frustum culling on placed hero assets. Bounding
            // spheres on GLB meshes are loader-computed and accurate.
            root.frustumCulled = true;

            const old = this.heroReefWalls[i];
            if (old?.parent) {
                this.group.remove(old);
                disposeObject(old);
            }
            this.heroReefWalls[i] = root;
            this.heroReefStats.loadedCount += 1;
            this.group.add(root);
        });
    }

    prepareHeroReefAsset(root) {
        // Phase G.3: same consolidation as hero corals — share converted
        // materials by source, then merge child meshes per unique material.
        const materialCache = new Map();
        root.traverse((child) => {
            if (!child.isMesh) return;
            child.frustumCulled = true; // WS A2: GLB meshes have valid bounds
            child.castShadow = false;
            child.receiveShadow = true;
            child.geometry?.computeVertexNormals?.();

            const sources = Array.isArray(child.material) ? child.material : [child.material];
            const materials = sources.map((source) => {
                if (source && materialCache.has(source)) return materialCache.get(source);
                const material = this.isWebGPU
                    ? createHeroReefNodeMaterial(source)
                    : createHeroReefStandardMaterial(source);
                if (this.isWebGPU) this.tslUserData.push(material.userData);
                if (source) materialCache.set(source, material);
                source?.dispose?.();
                return material;
            });
            child.material = Array.isArray(child.material) ? materials : materials[0];
        });
        mergeMeshesByMaterial(root);
    }

    createForegroundRocks() {
        const count = Math.max(0, Math.floor(this.settings.foregroundRockCount ?? 0));
        if (count <= 0) return;
        this.foregroundRockStats.requestedCount = count;

        const candidates = [
            { x: 52, z: 56 },
            { x: -66, z: 38 }, { x: 70, z: 34 },
            { x: -86, z: 16 }, { x: 90, z: 18 },
            { x: -104, z: -12 }, { x: 108, z: -18 },
            { x: -126, z: -44 }, { x: 130, z: -48 },
            { x: -144, z: -78 }, { x: 146, z: -84 },
        ];

        let material;
        if (this.isWebGPU) {
            material = createReefSilhouetteNodeMaterial();
            this.tslUserData.push(material.userData);
        } else {
            const uniforms = {
                ...createSharedAtmosphereUniforms(),
                uLowColor: { value: ROCK_LOW },
                uHighColor: { value: ROCK_HIGH },
            };
            material = new THREE.ShaderMaterial({
                uniforms,
                vertexShader: `
                    varying vec3 vWorldPos;
                    varying vec3 vNormal;
                    varying float vDist;

                    void main() {
                        vec4 worldPos = modelMatrix * vec4(position, 1.0);
                        vec4 mvPos = viewMatrix * worldPos;
                        vWorldPos = worldPos.xyz;
                        vNormal = normalize(mat3(modelMatrix) * normal);
                        vDist = length(mvPos.xyz);
                        gl_Position = projectionMatrix * mvPos;
                    }
                `,
                fragmentShader: `
                    uniform float uTime;
                    uniform vec3 uFogColor;
                    uniform vec3 uLowColor;
                    uniform vec3 uHighColor;
                    varying vec3 vWorldPos;
                    varying vec3 vNormal;
                    varying float vDist;

                    void main() {
                        float height = smoothstep(-34.0, 18.0, vWorldPos.y);
                        vec3 color = mix(uLowColor, uHighColor, height);
                        float topLight = max(dot(normalize(vNormal), normalize(vec3(0.1, 0.92, -0.22))), 0.0);
                        float upward = max(normalize(vNormal).y, 0.0);
                        float caustic = sin(vWorldPos.x * 0.12 + uTime * 0.55)
                            * sin(vWorldPos.z * 0.11 - uTime * 0.42);
                        caustic = pow(max(caustic * 0.5 + 0.5, 0.0), 4.0) * pow(upward, 1.2);
                        float striation = abs(sin(vWorldPos.y * 0.72 + vWorldPos.x * 0.05));
                        color *= 0.72 + topLight * 0.58;
                        color *= 0.86 + striation * 0.10;
                        color += vec3(0.05, 0.18, 0.08) * pow(upward, 1.6) * 0.32;
                        color += vec3(0.06, 0.18, 0.14) * caustic * 0.10;

                        float fog = 1.0 - exp(-vDist * 0.0052);
                        color = mix(color, uFogColor, clamp(fog * 0.5, 0.0, 0.66));
                        gl_FragColor = vec4(color, 1.0);
                    }
                `,
                side: THREE.DoubleSide,
            });
        }

        // Save the per-rock placement so an async GLB swap can match position/scale.
        this.foregroundRocks = [];
        const placements = [];
        const used = new Set();
        for (let i = 0; i < count; i++) {
            let candidate = candidates[i % candidates.length];
            if (used.has(candidate) && candidates.length > count) {
                candidate = candidates[Math.floor(Math.random() * candidates.length)];
            }
            used.add(candidate);
            const placement = {
                x: candidate.x + randRange(-4, 4),
                z: candidate.z + randRange(-4, 4),
                sx: randRange(7, 12),
                sy: randRange(3.5, 6.5),
                sz: randRange(7, 12),
                rx: randRange(-0.25, 0.25),
                ry: randRange(0, Math.PI * 2),
                rz: randRange(-0.25, 0.25),
            };
            placement.y = this.getSeabedHeight(placement.x, placement.z) + placement.sy * 0.45;
            placements.push(placement);

            const geom = createDisplacedRockGeometry(
                i * 41 + Math.floor(Math.random() * 1000),
                3,
                randRange(0.32, 0.42),
            );
            const rock = new THREE.Mesh(geom, material);
            rock.position.set(placement.x, placement.y, placement.z);
            rock.rotation.set(placement.rx, placement.ry, placement.rz);
            rock.scale.set(placement.sx, placement.sy, placement.sz);
            rock.frustumCulled = true; // WS A2
            rock.renderOrder = -2;
            rock.userData.heroRockIndex = i;
            this.foregroundRocks.push(rock);
            this.group.add(rock);
        }
        this.foregroundRockStats.proceduralCount = this.foregroundRocks.length;

        const rockUrls = getHeroRockAssetUrls();
        this.foregroundRockStats.discoveredGlbCount = rockUrls.length;
        this.foregroundRockStats.glbEnabled = this.settings.foregroundRockGlbEnabled === true;
        if (this.foregroundRockStats.glbEnabled && rockUrls.length > 0) {
            // Off by default: foreground GLBs must stay texture-free and tiny.
            this.enqueueUpgradeTask(() => this.upgradeForegroundRocksFromGLB(placements, material, rockUrls));
        } else {
            this.foregroundRockStats.optimizationNote = 'procedural-rocks-default-no-heavy-glb-swap';
        }

        // Coral overgrowth — drape each rock with small coral/sponge accents on
        // its upper hemisphere, matching the reference reef-canyon photo where
        // rock shelves are densely colonized. Anchored to placement world coords
        // (not as rock children) so they survive the async GLB swap.
        const density = Math.max(0, Math.floor(this.settings.coralOvergrowthPerRock ?? 2));
        if (density > 0) {
            this.attachCoralOvergrowthToRocks(placements, density);
        }
    }

    attachCoralOvergrowthToRocks(placements, density) {
        this.coralOvergrowthStats.densityPerRock = density;
        this.coralOvergrowthStats.requestedClusters = placements.length * density;
        if (!placements.length || density <= 0) return;

        const palette = [
            new THREE.Color(0x9d4edd), // vibrant purple
            new THREE.Color(0xff7006), // vibrant orange
            new THREE.Color(0xff007f), // vibrant pink
            new THREE.Color(0x00b4d8), // vibrant turquoise
            new THREE.Color(0xeec900), // vibrant yellow
        ];

        // WS 4.2: one material total (was 5) — color is supplied per-instance.
        // WebGPU reads `aInstanceColor` attribute; WebGL uses InstancedMesh's
        // built-in `instanceColor` (set via mesh.setColorAt). 20 InstancedMesh
        // per rock-cluster → 4 InstancedMesh.
        const sharedMaterial = this.isWebGPU
            ? createCoralOvergrowthNodeMaterial()
            : new THREE.MeshLambertMaterial({
                color: 0xffffff,
                emissive: new THREE.Color(0xffffff).multiplyScalar(0.18),
                emissiveIntensity: 0.38,
                side: THREE.DoubleSide,
                vertexColors: true,
            });
        if (this.isWebGPU) this.tslUserData.push(sharedMaterial.userData);

        const geometries = [
            new THREE.CylinderGeometry(0.07, 0.09, 0.42, 10),
            new THREE.ConeGeometry(0.11, 0.48, 9),
            new THREE.CylinderGeometry(0.22, 0.14, 0.06, 18),
            new THREE.IcosahedronGeometry(0.16, 1),
        ];
        geometries.forEach((geometry) => geometry.computeVertexNormals());

        // One bucket per geometry; each entry is { matrices: [], colors: [] }.
        const buckets = geometries.map(() => ({ matrices: [], colors: [] }));
        const dummy = new THREE.Object3D();
        let createdClusters = 0;
        let instanceCount = 0;

        for (let pi = 0; pi < placements.length; pi += 1) {
            const placement = placements[pi];
            const rand = mulberry32(pi * 1009 + 17);
            for (let n = 0; n < density; n += 1) {
                const angle = rand() * Math.PI * 2;
                const radial = (0.18 + rand() * 0.46) * Math.max(placement.sx, placement.sz);
                const centerX = placement.x + Math.cos(angle) * radial;
                const centerZ = placement.z + Math.sin(angle) * radial;
                const centerY = placement.y + placement.sy * (0.20 + rand() * 0.26);
                const pieces = 3 + Math.floor(rand() * 5);
                createdClusters += 1;

                for (let p = 0; p < pieces; p += 1) {
                    const localAngle = rand() * Math.PI * 2;
                    const localRadius = Math.sqrt(rand()) * (0.28 + rand() * 0.82);
                    const typeIndex = Math.floor(rand() * geometries.length);
                    const colorIndex = (pi + n + p + typeIndex) % palette.length;
                    const heightScale = (0.7 + rand() * 1.8) * 2.2;
                    const footprint = (0.75 + rand() * 1.35) * 2.2;
                    dummy.position.set(
                        centerX + Math.cos(localAngle) * localRadius,
                        centerY + rand() * 0.36,
                        centerZ + Math.sin(localAngle) * localRadius,
                    );
                    dummy.rotation.set(
                        rand() * 0.24 - 0.12,
                        rand() * Math.PI * 2,
                        rand() * 0.24 - 0.12,
                    );
                    dummy.scale.set(
                        footprint,
                        typeIndex <= 1 ? heightScale : 0.72 + rand() * 0.55,
                        footprint,
                    );
                    dummy.updateMatrix();
                    buckets[typeIndex].matrices.push(dummy.matrix.clone());
                    buckets[typeIndex].colors.push(palette[colorIndex]);
                    instanceCount += 1;
                }
            }
        }

        buckets.forEach((bucket, typeIndex) => {
            if (!bucket.matrices.length) return;
            const count = bucket.matrices.length;
            const geometry = geometries[typeIndex].clone();

            // Per-instance color attribute. WebGPU TSL reads `aInstanceColor`;
            // WebGL uses InstancedMesh.setColorAt (which writes to a built-in
            // instanceColor attribute). Both paths use vec3 (rgb).
            if (this.isWebGPU) {
                const colorArray = new Float32Array(count * 3);
                for (let i = 0; i < count; i += 1) {
                    const c = bucket.colors[i];
                    colorArray[i * 3] = c.r;
                    colorArray[i * 3 + 1] = c.g;
                    colorArray[i * 3 + 2] = c.b;
                }
                geometry.setAttribute('aInstanceColor', new THREE.InstancedBufferAttribute(colorArray, 3));
            }

            const mesh = new THREE.InstancedMesh(geometry, sharedMaterial, count);
            for (let i = 0; i < count; i += 1) {
                mesh.setMatrixAt(i, bucket.matrices[i]);
                if (!this.isWebGPU) mesh.setColorAt(i, bucket.colors[i]);
            }
            mesh.name = `OceanCoralOvergrowth:${typeIndex}`;
            mesh.userData.isOceanCoralOvergrowth = true;
            mesh.userData.assetStatus = 'procedural-instanced';
            mesh.instanceMatrix.needsUpdate = true;
            if (!this.isWebGPU && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
            mesh.computeBoundingSphere();
            mesh.frustumCulled = true;
            mesh.renderOrder = -1;
            this.group.add(mesh);
            this.coralOvergrowthInstances.push(mesh);
        });
        geometries.forEach((geometry) => geometry.dispose());
        this.coralOvergrowthStats.createdClusters = createdClusters;
        this.coralOvergrowthStats.instanceCount = instanceCount;
        this.coralOvergrowthStats.meshCount = this.coralOvergrowthInstances.length;
    }

    async upgradeForegroundRocksFromGLB(placements, material, providedUrls = null) {
        const urls = providedUrls || getHeroRockAssetUrls();
        if (!urls.length) return;

        // Cache loaded scenes per URL so we can spread N variants across M>N
        // placements with cloning, while only downloading each GLB once.
        const sceneCache = new Map();
        const promises = urls.map(async (url) => {
            try {
                const gltf = await loadGltfCached(url);
                sceneCache.set(url, gltf.scene);
            } catch (err) {
                console.warn(
                    `🌊 [Ocean] rock GLB load failed (${url}):`,
                    err?.message || err,
                );
            }
        });
        await Promise.all(promises);

        placements.forEach((p, i) => {
            const url = urls[i % urls.length];
            const sceneRoot = sceneCache.get(url);
            if (!sceneRoot) return;
            const oldRock = this.foregroundRocks[i];
            if (!oldRock || !oldRock.parent) return;

            // Optional rock GLBs are shape-only. Runtime owns the material so
            // future rocks cannot drag large texture payloads into startup.
            const swapped = sceneRoot.clone(true);
            swapped.position.set(p.x, p.y - p.sy * 0.5, p.z);
            swapped.rotation.set(p.rx, p.ry, p.rz);
            const uniformScale = (p.sx + p.sz) * 0.5;
            swapped.scale.set(uniformScale, p.sy, uniformScale);
            swapped.frustumCulled = true; // WS A2
            swapped.traverse((node) => {
                if (node.isMesh) {
                    if (Array.isArray(node.material)) node.material.forEach((source) => source?.dispose?.());
                    else node.material?.dispose?.();
                    node.material = material;
                    node.frustumCulled = true; // WS A2
                    node.renderOrder = -2;
                    node.userData.heroRockIndex = i;
                    node.userData.glbSource = url;
                }
            });

            this.group.remove(oldRock);
            if (oldRock.geometry) oldRock.geometry.dispose();
            this.foregroundRocks[i] = swapped;
            this.foregroundRockStats.glbLoadedCount += 1;
            this.group.add(swapped);
        });
    }

    createCoralCarpetPatches() {
        const count = Math.max(0, Math.floor(this.settings.coralCarpetPatchCount ?? 0));
        this.coralCarpetStats.requestedCount = count;
        if (count <= 0) return;

        const placements = CORAL_CARPET_PLACEMENTS.slice(0, count).map((placement, i) => {
            const y = this.getSeabedHeight(placement.x, placement.z) + 0.08;
            return {
                ...placement,
                y,
                ry: placement.ry + randRange(-0.12, 0.12),
                index: i,
            };
        });

        placements.forEach((placement) => {
            const placeholder = this.createProceduralCoralCarpetPatch(placement);
            this.coralCarpetPatches[placement.index] = placeholder;
            this.coralCarpetStats.placeholderCount += 1;
            this.group.add(placeholder);
        });

        this.scheduleAssetUpgrade(() => {
            this.enqueueUpgradeTask(() => this.upgradeCoralCarpetPatchesFromGLB(placements));
        }, 1100);
    }

    createProceduralCoralCarpetPatch(placement) {
        const group = new THREE.Group();
        group.name = `OceanCoralCarpetFallback:${placement.index}`;
        group.userData.isOceanCoralCarpetPatch = true;
        group.userData.assetStatus = 'procedural-fallback';
        group.userData.kind = placement.kind;

        const paletteByKind = {
            'purple-blue-coral-carpet': 0x6548a6,
            'orange-tube-sponge-cluster': 0xf08a31,
            'green-yellow-plate-coral': 0x8fca72,
            'blue-brush-coral': 0x278fb5,
        };
        const tint = new THREE.Color(paletteByKind[placement.kind] || 0x8f6db6);
        const material = this.isWebGPU
            ? createCoralNodeMaterial(tint)
            : new THREE.MeshLambertMaterial({
                color: tint,
                emissive: tint.clone().multiplyScalar(0.24),
                emissiveIntensity: 0.38,
                side: THREE.DoubleSide,
            });
        if (this.isWebGPU) this.tslUserData.push(material.userData);

        const isPlate = placement.kind === 'green-yellow-plate-coral';
        const isTube = placement.kind === 'orange-tube-sponge-cluster';
        let count = 42;
        if (isPlate) count = 14;
        else if (isTube) count = 28;
        for (let i = 0; i < count; i++) {
            const angle = (i * 2.399963) % (Math.PI * 2);
            const radius = Math.sqrt((i + 0.5) / count) * 1.0;
            const geometry = isPlate
                ? new THREE.CylinderGeometry(0.24, 0.18, 0.045, 22)
                : new THREE.CylinderGeometry(isTube ? 0.065 : 0.035, isTube ? 0.085 : 0.045, 0.28, isTube ? 12 : 8);
            geometry.computeVertexNormals();
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(
                Math.cos(angle) * radius * 1.2,
                isPlate ? 0.16 + i * 0.015 : 0.16 + (i % 7) * 0.035,
                Math.sin(angle) * radius * 0.72,
            );
            mesh.rotation.set(
                isPlate ? randRange(-0.06, 0.06) : randRange(-0.22, 0.22),
                angle,
                isPlate ? angle : randRange(-0.16, 0.16),
            );
            mesh.scale.setScalar(randRange(0.76, 1.22));
            group.add(mesh);
        }

        const baseGeometry = new THREE.CylinderGeometry(1, 0.82, 0.055, 36);
        baseGeometry.computeVertexNormals();
        const base = new THREE.Mesh(baseGeometry, material);
        base.position.y = 0.03;
        base.scale.set(1.38, 1.0, 0.76);
        group.add(base);

        group.position.set(placement.x, placement.y, placement.z);
        group.rotation.y = placement.ry;
        group.scale.setScalar(placement.scale);
        group.frustumCulled = false;
        return group;
    }

    async upgradeCoralCarpetPatchesFromGLB(placements) {
        const allRecords = getCoralCarpetAssetRecords();
        this.coralCarpetStats.manifest = summarizeCoralAssetManifest().heroCorals
            .filter((record) => record.placementRole === 'carpet-patch');
        const pickRecord = (records, placement, index) => {
            const preferred = records.find((record) => record.kind === placement.kind);
            return preferred || records[index % records.length];
        };
        const records = selectUniqueRecordsForPlacements(allRecords, placements, pickRecord);
        if (!records.length) return;

        records.forEach((record) => {
            this.coralCarpetStats.statuses[record.id] = 'loading';
            this.coralCarpetStats.errors[record.id] = null;
        });
        const promises = records.map((record) => loadGltfCached(record.url));
        const results = await Promise.allSettled(promises);

        results.forEach((result, recordIndex) => {
            const record = records[recordIndex];
            if (result.status !== 'fulfilled') {
                this.coralCarpetStats.statuses[record.id] = 'error';
                this.coralCarpetStats.errors[record.id] = result.reason?.message || String(result.reason);
                console.warn(`🌊 [Ocean] coral patch ${record.id} GLB load failed:`, result.reason);
                return;
            }
            this.prepareHeroCoralAsset(result.value.scene);
            this.coralCarpetStats.statuses[record.id] = 'loaded';
        });
        const resultsById = new Map(records.map((record, index) => [record.id, results[index]]));

        placements.forEach((placement, i) => {
            const record = pickRecord(allRecords, placement, i);
            const result = record ? resultsById.get(record.id) : null;
            if (!result || result.status !== 'fulfilled') return;
            const root = result.value.scene.clone(true);
            root.name = `OceanCoralCarpet:${record.id}:${i}`;
            root.userData.isOceanCoralCarpetPatch = true;
            root.userData.assetId = record.id;
            root.userData.assetStatus = 'glb-loaded';
            root.userData.triangleCount = record.triangleCount;
            root.rotation.y = placement.ry;
            const scale = placement.scale * record.runtimeScale;
            root.scale.setScalar(scale);
            setSeabedAnchoredPosition(root, placement.x, placement.y, placement.z, scale);
            root.frustumCulled = true; // WS A2: GLB has valid bounds

            const old = this.coralCarpetPatches[i];
            if (old?.parent) {
                this.group.remove(old);
                disposeObject(old);
            }
            this.coralCarpetPatches[i] = root;
            this.coralCarpetStats.loadedCount += 1;
            this.group.add(root);
        });
    }

    createHeroCorals() {
        const count = Math.max(0, Math.floor(this.settings.heroCoralCount ?? 0));
        this.heroCoralStats.requestedCount = count;
        if (count <= 0) return;

        const placements = HERO_CORAL_PLACEMENTS.slice(0, count).map((placement, i) => {
            const y = this.getSeabedHeight(placement.x, placement.z);
            return {
                ...placement,
                y,
                rx: randRange(-0.08, 0.08),
                ry: placement.ry + randRange(-0.16, 0.16),
                rz: randRange(-0.06, 0.06),
                index: i,
            };
        });

        placements.forEach((placement) => {
            const placeholder = this.createProceduralHeroCoral(placement);
            this.heroCorals[placement.index] = placeholder;
            this.heroCoralStats.placeholderCount += 1;
            this.group.add(placeholder);
        });

        this.scheduleAssetUpgrade(() => {
            this.enqueueUpgradeTask(() => this.upgradeHeroCoralsFromGLB(placements));
        }, 650);
    }

    createProceduralHeroCoral(placement) {
        const group = new THREE.Group();
        group.name = `OceanHeroCoralFallback:${placement.index}`;
        group.userData.isOceanHeroCoral = true;
        group.userData.assetStatus = 'procedural-fallback';

        const palette = [
            new THREE.Color(0xc86e54),
            new THREE.Color(0xc58a4d),
            new THREE.Color(0x8d597f),
            new THREE.Color(0x4d9688),
        ];
        const tint = palette[placement.index % palette.length];
        const material = this.isWebGPU
            ? createCoralNodeMaterial(tint)
            : new THREE.MeshLambertMaterial({
                color: tint,
                emissive: tint.clone().multiplyScalar(0.22),
                emissiveIntensity: 0.42,
                side: THREE.DoubleSide,
            });
        if (this.isWebGPU) this.tslUserData.push(material.userData);
        else this.uniforms.push(material.uniforms || {});

        const branchCount = 7 + (placement.index % 5);
        for (let i = 0; i < branchCount; i++) {
            const angle = (i / branchCount) * Math.PI * 2 + randRange(-0.12, 0.12);
            const radius = randRange(0.22, 0.72) * placement.scale;
            const height = randRange(0.82, 1.8) * placement.scale;
            const geometry = i % 3 === 0
                ? new THREE.ConeGeometry(0.16, 1, 10)
                : new THREE.CylinderGeometry(0.06, 0.16, 1, 10);
            geometry.computeVertexNormals();
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(
                Math.cos(angle) * radius,
                height * 0.5,
                Math.sin(angle) * radius,
            );
            mesh.rotation.set(randRange(-0.28, 0.28), angle, randRange(-0.24, 0.24));
            mesh.scale.set(
                randRange(0.65, 1.15) * placement.scale,
                height,
                randRange(0.65, 1.15) * placement.scale,
            );
            group.add(mesh);
        }

        const plateGeometry = new THREE.CylinderGeometry(1, 0.7, 0.12, 22);
        plateGeometry.computeVertexNormals();
        const plate = new THREE.Mesh(plateGeometry, material);
        plate.position.y = 0.24 * placement.scale;
        plate.scale.set(placement.scale * 1.25, placement.scale * 0.55, placement.scale);
        group.add(plate);

        group.position.set(placement.x, placement.y, placement.z);
        group.rotation.set(placement.rx, placement.ry, placement.rz);
        group.frustumCulled = false;
        return group;
    }

    async upgradeHeroCoralsFromGLB(placements) {
        const allRecords = getHeroCoralAssetRecords()
            .filter((record) => record.placementRole !== 'carpet-patch');
        this.heroCoralStats.manifest = summarizeCoralAssetManifest().heroCorals
            .filter((record) => record.placementRole !== 'carpet-patch');
        const pickRecord = (records, placement, index) => {
            const preferred = records.find((record) => record.kind === placement.kind);
            return preferred || records[index % records.length];
        };
        const records = selectUniqueRecordsForPlacements(allRecords, placements, pickRecord);
        if (!records.length) return;

        records.forEach((record) => {
            this.heroCoralStats.statuses[record.id] = 'loading';
            this.heroCoralStats.errors[record.id] = null;
        });
        const promises = records.map((record) => loadGltfCached(record.url));
        const results = await Promise.allSettled(promises);

        results.forEach((result, recordIndex) => {
            const record = records[recordIndex];
            if (result.status !== 'fulfilled') {
                this.heroCoralStats.statuses[record.id] = 'error';
                this.heroCoralStats.errors[record.id] = result.reason?.message || String(result.reason);
                console.warn(`🌊 [Ocean] coral ${record.id} GLB load failed:`, result.reason);
                return;
            }
            this.prepareHeroCoralAsset(result.value.scene, record);
            this.heroCoralStats.statuses[record.id] = 'loaded';
        });
        const resultsById = new Map(records.map((record, index) => [record.id, results[index]]));

        // Phase I: per-variant InstancedMesh. The Phase G merge already
        // collapsed each prepared scene to 1 mesh per unique material; this
        // step takes those merged meshes and rebuilds them as InstancedMesh
        // shared across ALL placements using the same variant. For 10
        // placements × 1 variant × ~3 materials, draws drop from 30 → 3.
        const { meshes } = buildPlacementInstanceMeshes(
            placements,
            (placement, index) => pickRecord(allRecords, placement, index),
            resultsById,
        );

        // Remove existing placeholder roots; replace this.heroCorals[] with
        // references to the new InstancedMeshes so bisect drill-down + dispose
        // still work. We keep the array length = placements.length so the
        // index → entry mapping for atmosphereSystem.heroCorals stays usable;
        // multiple indices may point at the same InstancedMesh which is fine.
        placements.forEach((_placement, i) => {
            const old = this.heroCorals[i];
            if (old?.parent) {
                this.group.remove(old);
                disposeObject(old);
            }
            // Point every index at the first InstancedMesh as a stable
            // reference; visibility toggles on it affect all placements
            // simultaneously (which is what the bisect scenario wants).
            this.heroCorals[i] = meshes[0] || null;
        });

        meshes.forEach((mesh) => {
            mesh.userData.isOceanHeroCoral = true;
            this.group.add(mesh);
        });
        this.heroCoralStats.loadedCount = placements.length;
        this.heroCoralStats.instancedMeshCount = meshes.length;
        this.heroCoralStats.optimizationNote = `phase-I: ${placements.length} placements collapsed to ${meshes.length} InstancedMesh draw calls`;
    }

    prepareHeroCoralAsset(root, record = null) {
        // Bake per-record baseRotation into geometry BEFORE material conversion
        // and bounds caching. TripoSR meshes sometimes export with their longest
        // axis on Z instead of Y (sea-fan, staghorn, tube-sponge); rotating the
        // geometry directly means the rotated bounds drive setSeabedAnchoredPosition
        // correctly and the placement's own rotation stays free for randomized yaw.
        if (record?.baseRotation) {
            const { x = 0, y = 0, z = 0 } = record.baseRotation;
            if (x !== 0 || y !== 0 || z !== 0) {
                const rotMatrix = new THREE.Matrix4().makeRotationFromEuler(
                    new THREE.Euler(x, y, z, 'XYZ'),
                );
                root.traverse((child) => {
                    if (child.isMesh && child.geometry) {
                        child.geometry.applyMatrix4(rotMatrix);
                    }
                });
            }
        }
        // Phase G.1: share converted materials by source so child meshes
        // pointing at the same source GLB material end up with the SAME
        // converted material instance — required for mergeMeshesByMaterial
        // to bucket them together.
        const materialCache = new Map();
        root.traverse((child) => {
            if (!child.isMesh) return;
            child.frustumCulled = true; // WS A2: GLB meshes have valid bounds
            child.castShadow = false;
            child.receiveShadow = true;
            child.geometry?.computeVertexNormals?.();

            // TripoSR GLBs ship vertex colors as the COLOR_0 attribute (Three
            // exposes it as `color`). The hero coral material reads it when
            // present to preserve the painterly pastel hue.
            const hasVertexColors = !!child.geometry?.attributes?.color;

            const sources = Array.isArray(child.material) ? child.material : [child.material];
            const materials = sources.map((source) => {
                const cacheKey = source ? `${source.uuid}_vc${hasVertexColors ? 1 : 0}` : null;
                if (cacheKey && materialCache.has(cacheKey)) return materialCache.get(cacheKey);
                const material = this.isWebGPU
                    ? createHeroCoralNodeMaterial(source, { vertexColors: hasVertexColors })
                    : createHeroCoralStandardMaterial(source, { vertexColors: hasVertexColors });
                if (this.isWebGPU) this.tslUserData.push(material.userData);
                if (cacheKey) materialCache.set(cacheKey, material);
                source?.dispose?.();
                return material;
            });
            child.material = Array.isArray(child.material) ? materials : materials[0];
        });
        // Now collapse N child meshes → 1 mesh per unique material. Each
        // placement's scene.clone(true) downstream inherits the merged shape,
        // so 10 placements × 50 children → 10 placements × M materials.
        mergeMeshesByMaterial(root);
        cacheLocalMinY(root);
    }

    createHeroKelp() {
        const count = Math.max(0, Math.floor(this.settings.heroKelpCount ?? 0));
        this.heroKelpStats.requestedCount = count;
        if (count <= 0) return;

        const placements = HERO_KELP_PLACEMENTS.slice(0, count).map((placement, i) => {
            const y = this.getSeabedHeight(placement.x, placement.z);
            return {
                ...placement,
                y,
                ry: placement.ry + randRange(-0.18, 0.18),
                index: i,
            };
        });

        placements.forEach((placement) => {
            const placeholder = this.createProceduralHeroKelp(placement);
            this.heroKelp[placement.index] = placeholder;
            this.heroKelpStats.placeholderCount += 1;
            this.group.add(placeholder);
        });

        this.scheduleAssetUpgrade(() => {
            this.enqueueUpgradeTask(() => this.upgradeHeroKelpFromGLB(placements));
        }, 850);
    }

    createProceduralHeroKelp(placement) {
        const group = new THREE.Group();
        group.name = `OceanHeroKelpFallback:${placement.index}`;
        group.userData.isOceanHeroKelp = true;
        group.userData.assetStatus = 'procedural-fallback';

        const bladeCount = 6 + (placement.index % 4);
        for (let i = 0; i < bladeCount; i++) {
            const geometry = createFallbackHeroKelpGeometry(
                randRange(6.5, 10.5) * placement.scale,
                randRange(0.34, 0.64),
                12,
            );
            const material = this.isWebGPU ? createHeroKelpNodeMaterial() : createHeroKelpShaderMaterial();
            if (this.isWebGPU) this.tslUserData.push(material.userData);
            else this.uniforms.push(material.uniforms);
            const mesh = new THREE.Mesh(geometry, material);
            const angle = (i / bladeCount) * Math.PI * 2 + randRange(-0.22, 0.22);
            const radius = randRange(0.1, 1.15) * placement.scale;
            mesh.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
            mesh.rotation.set(randRange(-0.08, 0.08), angle, randRange(-0.1, 0.1));
            mesh.scale.setScalar(randRange(0.86, 1.18));
            mesh.frustumCulled = true; // WS A2: procedural mesh has valid bounds
            group.add(mesh);
        }

        group.position.set(placement.x, placement.y, placement.z);
        group.rotation.y = placement.ry;
        group.frustumCulled = false;
        return group;
    }

    async upgradeHeroKelpFromGLB(placements) {
        const records = getHeroKelpAssetRecords();
        this.heroKelpStats.manifest = summarizeKelpAssetManifest().heroKelp;
        if (!records.length) return;

        records.forEach((record) => {
            this.heroKelpStats.statuses[record.id] = 'loading';
            this.heroKelpStats.errors[record.id] = null;
        });
        const promises = records.map((record) => loadGltfCached(record.url));
        const results = await Promise.allSettled(promises);

        results.forEach((result, recordIndex) => {
            const record = records[recordIndex];
            if (result.status !== 'fulfilled') {
                this.heroKelpStats.statuses[record.id] = 'error';
                this.heroKelpStats.errors[record.id] = result.reason?.message || String(result.reason);
                console.warn(`🌊 [Ocean] kelp ${record.id} GLB load failed:`, result.reason);
                return;
            }
            this.prepareHeroKelpAsset(result.value.scene);
            this.heroKelpStats.statuses[record.id] = 'loaded';
        });

        placements.forEach((placement, i) => {
            const recordIndex = i % records.length;
            const result = results[recordIndex];
            if (result.status !== 'fulfilled') return;
            const record = records[recordIndex];
            const root = result.value.scene.clone(true);
            root.name = `OceanHeroKelp:${record.id}:${i}`;
            root.userData.isOceanHeroKelp = true;
            root.userData.assetId = record.id;
            root.userData.assetStatus = 'glb-loaded';
            root.userData.triangleCount = record.triangleCount;
            root.rotation.y = placement.ry;
            const scale = placement.scale * record.runtimeScale;
            root.scale.setScalar(scale);
            setSeabedAnchoredPosition(root, placement.x, placement.y, placement.z, scale);
            root.frustumCulled = true; // WS A2: GLB has valid bounds

            const old = this.heroKelp[i];
            if (old?.parent) {
                this.group.remove(old);
                disposeObject(old);
            }
            this.heroKelp[i] = root;
            this.heroKelpStats.loadedCount += 1;
            this.group.add(root);
        });
    }

    prepareHeroKelpAsset(root) {
        // Phase G.2: hero kelp uses ONE material for every child — share it
        // across the asset and let mergeMeshesByMaterial collapse all child
        // meshes into a single draw call per kelp clone.
        const sharedMaterial = this.isWebGPU ? createHeroKelpNodeMaterial() : createHeroKelpShaderMaterial();
        if (this.isWebGPU) this.tslUserData.push(sharedMaterial.userData);
        else this.uniforms.push(sharedMaterial.uniforms);

        root.traverse((child) => {
            if (!child.isMesh) return;
            child.frustumCulled = true; // WS A2: GLB meshes have valid bounds
            child.castShadow = false;
            child.receiveShadow = false;
            addNormalizedHeightAttribute(child.geometry);
            child.geometry?.computeVertexNormals?.();
            if (Array.isArray(child.material)) child.material.forEach((source) => source?.dispose?.());
            else child.material?.dispose?.();
            child.material = sharedMaterial;
        });
        // All children share one material → merge collapses them all to ONE draw call.
        mergeMeshesByMaterial(root);
        cacheLocalMinY(root);
    }

    createImportedSeabedDetails() {
        const count = Math.max(0, Math.floor(this.settings.importedSeabedDetailCount ?? 0));
        this.importedSeabedDetailStats.requestedCount = count;
        if (count <= 0) return;

        const placements = IMPORTED_SEABED_DETAIL_PLACEMENTS.slice(0, count).map((placement, i) => {
            const y = this.getSeabedHeight(placement.x, placement.z);
            return {
                ...placement,
                y,
                ry: placement.ry + randRange(-0.2, 0.2),
                index: i,
            };
        });

        this.scheduleAssetUpgrade(() => {
            this.enqueueUpgradeTask(() => this.upgradeImportedSeabedDetailsFromGLB(placements));
        }, 1250);
    }

    async upgradeImportedSeabedDetailsFromGLB(placements) {
        const plantRecords = getSeabedPlantAssetRecords();
        const seaweedRecords = getHeroKelpAssetRecords()
            .filter((record) => record.sourceMode?.startsWith('third-party'));
        const coralRecords = getCoralCarpetAssetRecords();
        const rockRecords = getHeroRockAssetRecords()
            .filter((record) => record.byteSize <= record.maxBytes);
        if (!plantRecords.length && !seaweedRecords.length && !coralRecords.length && !rockRecords.length) return;

        const pickRecord = (placement, index) => {
            const records = ({
                coral: coralRecords,
                rock: rockRecords,
                seaweed: seaweedRecords,
            })[placement.type] || plantRecords;
            if (!records.length) return null;
            return records[index % records.length];
        };
        const records = selectUniqueRecordsForPlacements(
            [...plantRecords, ...seaweedRecords, ...coralRecords, ...rockRecords],
            placements,
            (_records, placement, index) => pickRecord(placement, index),
        );
        if (!records.length) return;

        records.forEach((record) => {
            this.importedSeabedDetailStats.statuses[record.id] = 'loading';
            this.importedSeabedDetailStats.errors[record.id] = null;
        });
        const promises = records.map((record) => loadGltfCached(record.url));
        const results = await Promise.allSettled(promises);

        results.forEach((result, recordIndex) => {
            const record = records[recordIndex];
            if (result.status !== 'fulfilled') {
                this.importedSeabedDetailStats.statuses[record.id] = 'error';
                this.importedSeabedDetailStats.errors[record.id] = result.reason?.message || String(result.reason);
                console.warn(`🌊 [Ocean] seabed detail ${record.id} GLB load failed:`, result.reason);
                return;
            }
            if (record.kind === 'foreground-rock') this.prepareImportedSeabedRockAsset(result.value.scene);
            else if (record.materialMode === 'preserve-pbr-underwater-rim') {
                this.prepareImportedSeabedCoralAsset(result.value.scene);
            } else this.prepareImportedSeabedPlantAsset(result.value.scene);
            this.importedSeabedDetailStats.statuses[record.id] = 'loaded';
        });
        const resultsById = new Map(records.map((record, index) => [record.id, results[index]]));

        placements.forEach((placement, i) => {
            const record = pickRecord(placement, i);
            const result = record ? resultsById.get(record.id) : null;
            if (!result || result.status !== 'fulfilled') return;
            const root = result.value.scene.clone(true);
            root.name = `OceanImportedSeabedDetail:${record.id}:${i}`;
            root.userData.isOceanImportedSeabedDetail = true;
            root.userData.assetId = record.id;
            root.userData.assetStatus = 'glb-loaded';
            root.userData.detailType = placement.type;
            root.userData.triangleCount = record.triangleCount;
            root.rotation.y = placement.ry;
            const scale = placement.scale * record.runtimeScale;
            root.scale.setScalar(scale);
            setSeabedAnchoredPosition(root, placement.x, placement.y + 0.02, placement.z, scale);
            root.frustumCulled = true; // WS A2: imported seabed GLB has valid bounds

            this.importedSeabedDetails.push(root);
            this.importedSeabedDetailStats.loadedCount += 1;
            if (placement.type === 'rock') this.importedSeabedDetailStats.rockCount += 1;
            else if (placement.type === 'coral') this.importedSeabedDetailStats.coralCount += 1;
            else if (placement.type === 'seaweed') this.importedSeabedDetailStats.seaweedCount += 1;
            else this.importedSeabedDetailStats.plantCount += 1;
            this.group.add(root);
        });
    }

    prepareImportedSeabedPlantAsset(root) {
        // Phase G.4: one shared material → mergeMeshesByMaterial collapses
        // every child into a single draw call per asset clone.
        const sharedMaterial = this.isWebGPU
            ? createImportedSeabedPlantNodeMaterial()
            : createImportedSeabedPlantShaderMaterial();
        if (this.isWebGPU) this.tslUserData.push(sharedMaterial.userData);
        else this.uniforms.push(sharedMaterial.uniforms);

        root.traverse((child) => {
            if (!child.isMesh) return;
            child.frustumCulled = true; // WS A2: GLB meshes have valid bounds
            child.castShadow = false;
            child.receiveShadow = false;
            addNormalizedHeightAttribute(child.geometry);
            child.geometry?.computeVertexNormals?.();
            if (Array.isArray(child.material)) child.material.forEach((source) => source?.dispose?.());
            else child.material?.dispose?.();
            child.material = sharedMaterial;
        });
        mergeMeshesByMaterial(root);
        cacheLocalMinY(root);
    }

    prepareImportedSeabedCoralAsset(root) {
        // Phase G.4: same source-based material caching as hero corals.
        const materialCache = new Map();
        root.traverse((child) => {
            if (!child.isMesh) return;
            child.frustumCulled = true; // WS A2: GLB meshes have valid bounds
            child.castShadow = false;
            child.receiveShadow = true;

            const sources = Array.isArray(child.material) ? child.material : [child.material];
            const materials = sources.map((source) => {
                if (source && materialCache.has(source)) return materialCache.get(source);
                const material = this.isWebGPU
                    ? createHeroCoralNodeMaterial(source)
                    : createHeroCoralStandardMaterial(source);
                if (this.isWebGPU) this.tslUserData.push(material.userData);
                if (source) materialCache.set(source, material);
                source?.dispose?.();
                return material;
            });
            child.material = Array.isArray(child.material) ? materials : materials[0];
        });
        mergeMeshesByMaterial(root);
        cacheLocalMinY(root);
    }

    prepareImportedSeabedRockAsset(root) {
        // Use ROCK_LOW (dark blue-grey) so these rocks blend with the darker
        // reef formations instead of standing out as pale plateaus.
        // Phase G.4: this already uses a single shared material; just add
        // the merge so multi-mesh rocks collapse to 1 draw call.
        const material = this.isWebGPU
            ? createHeroReefNodeMaterial({ color: ROCK_LOW })
            : createHeroReefStandardMaterial({ color: ROCK_LOW, roughness: 0.9, metalness: 0.0 });
        if (this.isWebGPU) this.tslUserData.push(material.userData);

        root.traverse((child) => {
            if (!child.isMesh) return;
            child.frustumCulled = true; // WS A2: GLB mesh has valid bounds
            child.castShadow = false;
            child.receiveShadow = true;
            child.geometry?.computeVertexNormals?.();
            if (Array.isArray(child.material)) child.material.forEach((source) => source?.dispose?.());
            else child.material?.dispose?.();
            child.material = material;
        });
        mergeMeshesByMaterial(root);
        cacheLocalMinY(root);
    }

    createVolumetricShafts() {
        const rayCount = Math.max(0, Math.floor(this.settings.rayCount ?? 0));
        if (rayCount <= 0) return;

        const positions = [];
        const uvs = [];
        const seeds = [];
        const layers = [];

        for (let i = 0; i < rayCount; i++) {
            const layer = i % 3;
            const x = randRange(-150, 150);
            const z = randRange(-145, 55) - layer * 12;
            const topY = randRange(66, 82);
            const bottomY = randRange(-38, 4);
            const topWidth = randRange(9, 20) * (1 + layer * 0.22);
            const bottomWidth = topWidth * randRange(2.5, 4.8);
            const tilt = randRange(-0.24, 0.24);
            const seed = Math.random() * 100;

            const verts = [
                [-topWidth, topY, 0, 0, 1],
                [topWidth, topY, 0, 1, 1],
                [bottomWidth, bottomY, tilt * (topY - bottomY), 1, 0],
                [-topWidth, topY, 0, 0, 1],
                [bottomWidth, bottomY, tilt * (topY - bottomY), 1, 0],
                [-bottomWidth, bottomY, tilt * (topY - bottomY), 0, 0],
            ];

            verts.forEach((vertex) => {
                positions.push(x + vertex[0], vertex[1], z + vertex[2]);
                uvs.push(vertex[3], vertex[4]);
                seeds.push(seed);
                layers.push(layer);
            });
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
        geometry.setAttribute('aLayer', new THREE.Float32BufferAttribute(layers, 1));
        geometry.computeVertexNormals();

        if (this.isWebGPU) {
            const tslMaterial = createVolumetricShaftNodeMaterial({
                rayStrength: this.settings.rayStrength ?? 1.0,
            });
            const rays = new THREE.Mesh(geometry, tslMaterial);
            rays.renderOrder = -8;
            this.group.add(rays);
            this.tslUserData.push(tslMaterial.userData);
            return;
        }

        const uniforms = {
            ...createSharedAtmosphereUniforms(),
            uRayStrength: { value: this.settings.rayStrength ?? 1.0 },
            uShaftColor: { value: SHAFT_COLOR },
            uWarmColor: { value: SHAFT_WARMTH },
        };
        const material = new THREE.ShaderMaterial({
            uniforms,
            vertexShader: `
                attribute float aSeed;
                attribute float aLayer;
                varying vec2 vUv;
                varying float vSeed;
                varying float vLayer;
                varying float vDist;

                void main() {
                    vUv = uv;
                    vSeed = aSeed;
                    vLayer = aLayer;
                    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                    vDist = length(mvPos.xyz);
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform float uCurrentStrength;
                uniform float uGlowIntensity;
                uniform float uRayStrength;
                uniform vec3 uShaftColor;
                uniform vec3 uWarmColor;
                varying vec2 vUv;
                varying float vSeed;
                varying float vLayer;
                varying float vDist;

                float hash(vec2 p) {
                    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
                }

                void main() {
                    float core = smoothstep(0.0, 0.28, vUv.x) * smoothstep(1.0, 0.72, vUv.x);
                    float vertical = smoothstep(0.0, 0.22, vUv.y) * smoothstep(1.0, 0.42, vUv.y);
                    float streak = sin((vUv.y * 32.0) + (uTime * (1.2 + vLayer * 0.25)) + vSeed);
                    float fine = sin((vUv.x * 18.0) - (uTime * 0.8) + (vSeed * 1.7));
                    float dust = hash(floor((vUv + vSeed) * vec2(26.0, 68.0)));
                    float shimmer = 0.72 + streak * 0.18 + fine * 0.08 + dust * 0.07;
                    float ray = core * vertical * shimmer;

                    float distanceFade = 1.0 - smoothstep(70.0, 230.0, vDist);
                    float currentPulse = 0.86 + uCurrentStrength * 0.08;
                    vec3 color = mix(uShaftColor, uWarmColor, pow(vUv.y, 3.0) * 0.22);
                    color *= ray * (0.65 + uGlowIntensity * 0.08);

                    float alpha = ray * distanceFade * uRayStrength * currentPulse * 0.58;
                    gl_FragColor = vec4(color, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        const rays = new THREE.Mesh(geometry, material);
        rays.renderOrder = -8;
        this.uniforms.push(uniforms);
        this.group.add(rays);
    }

    createHazeLayers() {
        const hazeLayers = Math.max(0, Math.floor(this.settings.hazeLayers ?? 0));
        if (hazeLayers <= 0) return;

        const geometry = new THREE.PlaneGeometry(430, 155, 1, 1);

        if (this.isWebGPU) {
            const tslMaterial = createHazeLayerNodeMaterial({
                hazeStrength: this.settings.hazeStrength ?? 1.0,
            });
            for (let i = 0; i < hazeLayers; i++) {
                const layer = new THREE.Mesh(geometry, tslMaterial);
                const t = hazeLayers === 1 ? 0.5 : i / (hazeLayers - 1);
                layer.position.set(randRange(-18, 18), 22 + t * 24, -150 + t * 210);
                layer.rotation.y = randRange(-0.05, 0.05);
                layer.scale.setScalar(1.0 + t * 0.28);
                layer.renderOrder = -10 + i;
                this.group.add(layer);
                this.hazeLayers.push(layer);
            }
            this.tslUserData.push(tslMaterial.userData);
            return;
        }

        const uniforms = {
            ...createSharedAtmosphereUniforms(),
            uHazeStrength: { value: this.settings.hazeStrength ?? 1.0 },
        };
        const material = new THREE.ShaderMaterial({
            uniforms,
            vertexShader: `
                varying vec2 vUv;
                varying float vDist;

                void main() {
                    vUv = uv;
                    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                    vDist = length(mvPos.xyz);
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform float uCurrentStrength;
                uniform float uGlowIntensity;
                uniform float uHazeStrength;
                uniform vec3 uFogColor;
                varying vec2 vUv;
                varying float vDist;

                float noise(vec2 p) {
                    vec2 i = floor(p);
                    vec2 f = fract(p);
                    float a = fract(sin(dot(i, vec2(12.9898, 78.233))) * 43758.5453);
                    float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(12.9898, 78.233))) * 43758.5453);
                    float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(12.9898, 78.233))) * 43758.5453);
                    float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(12.9898, 78.233))) * 43758.5453);
                    vec2 u = f * f * (3.0 - 2.0 * f);
                    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
                }

                void main() {
                    vec2 flow = vec2(uTime * (0.018 + uCurrentStrength * 0.006), uTime * 0.012);
                    float n1 = noise(vUv * vec2(4.0, 2.2) + flow);
                    float n2 = noise(vUv * vec2(10.0, 4.0) - flow * 1.8);
                    float body = smoothstep(0.05, 0.75, n1 * 0.7 + n2 * 0.3);
                    float edge = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.72, vUv.y);
                    float sideFade = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.9, vUv.x);
                    float distFade = smoothstep(24.0, 190.0, vDist);
                    float alpha = body * edge * sideFade * distFade * uHazeStrength * 0.04;

                    vec3 color = mix(uFogColor, vec3(0.08, 0.46, 0.65), 0.42 + uGlowIntensity * 0.06);
                    gl_FragColor = vec4(color, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        for (let i = 0; i < hazeLayers; i++) {
            const layer = new THREE.Mesh(geometry, material);
            const t = hazeLayers === 1 ? 0.5 : i / (hazeLayers - 1);
            layer.position.set(randRange(-18, 18), 22 + t * 24, -150 + t * 210);
            layer.rotation.y = randRange(-0.05, 0.05);
            layer.scale.setScalar(1.0 + t * 0.28);
            layer.renderOrder = -10 + i;
            this.group.add(layer);
            this.hazeLayers.push(layer);
        }

        this.uniforms.push(uniforms);
    }

    createReefSilhouettes() {
        const reefCount = Math.max(0, Math.floor(this.settings.reefCount ?? 0));
        if (reefCount <= 0) return;

        // Six unique lumpy rock variants — instances are bucketed across them so
        // a cluster of 18 reef rocks reads as 6 distinct silhouettes repeated
        // (each rotated/scaled differently) rather than 18 identical orbs.
        const VARIANT_COUNT = 6;
        const variants = [];
        for (let v = 0; v < VARIANT_COUNT; v++) {
            // Use the new layered geometry for all midground silhouettes.
            variants.push(createLayeredRockGeometry(v * 17 + 4, 3, 0.95 + (v % 3) * 0.25));
        }
        // Smooth icosphere kept for god-ray occluders + arches — those need
        // massy backgrounds, lumpy noise would distract behind volumetric shafts.
        const smoothRockGeometry = new THREE.IcosahedronGeometry(1, 2);

        // Bucket size: ceil(count / variants), trimmed for the last bucket.
        const perVariant = Math.ceil(reefCount / VARIANT_COUNT);

        const placeOne = (dummy, i) => {
            let sideBias = 0;
            if (Math.random() < 0.62) sideBias = Math.random() < 0.5 ? -1 : 1;
            let x;
            let z;
            if (Math.random() < 0.72) {
                const cluster = ROCK_REEF_CLUSTERS[i % ROCK_REEF_CLUSTERS.length];
                const angle = randRange(0, Math.PI * 2);
                const radius = Math.sqrt(Math.random()) * cluster.radius;
                x = cluster.x + Math.cos(angle) * radius;
                z = cluster.z + Math.sin(angle) * radius;
            } else {
                x = sideBias === 0 ? randRange(-118, 118) : sideBias * randRange(44, 152);
                z = randRange(-152, -4);
            }
            const y = this.getSeabedHeight(x, z) + randRange(1.8, 4.5);
            const nearScale = z > -32 ? 0.42 : 0.82;
            dummy.position.set(x, y, z);
            dummy.rotation.set(
                randRange(-0.18, 0.18),
                randRange(0, Math.PI * 2),
                randRange(-0.2, 0.2),
            );
            // Boulder aspect ratio — Y closer to X/Z so rocks read as 3D forms
            // rather than the previous wide-flat-disc shape. Range narrowed and
            // raised on the Y axis to fix the "flat stone disc" silhouette.
            dummy.scale.set(
                randRange(3.5, 10) * nearScale,
                randRange(3.0, 7.5) * nearScale,
                randRange(3.5, 9) * nearScale,
            );
            dummy.updateMatrix();
        };

        if (this.isWebGPU) {
            const tslMaterial = createReefSilhouetteNodeMaterial();
            this.tslUserData.push(tslMaterial.userData);
            const dummy = new THREE.Object3D();
            let placed = 0;
            for (let v = 0; v < VARIANT_COUNT && placed < reefCount; v++) {
                const bucketSize = Math.min(perVariant, reefCount - placed);
                const mesh = new THREE.InstancedMesh(variants[v], tslMaterial, bucketSize);
                for (let j = 0; j < bucketSize; j++) {
                    placeOne(dummy, placed + j);
                    mesh.setMatrixAt(j, dummy.matrix);
                }
                mesh.instanceMatrix.needsUpdate = true;
                // WS A2: compute a sphere wrapping all instances so frustum
                // culling can skip the whole bucket when the camera is turned
                // away from this rock cluster.
                mesh.computeBoundingSphere();
                mesh.frustumCulled = true;
                this.group.add(mesh);
                this.reefSilhouettes.push(mesh);
                placed += bucketSize;
            }

            this.createGodRayOccluders(variants, tslMaterial);
            if (!this.skipFlags.arches) this.createArchSilhouettes(tslMaterial);
            return;
        }

        const uniforms = {
            ...createSharedAtmosphereUniforms(),
            uLowColor: { value: ROCK_LOW },
            uHighColor: { value: ROCK_HIGH },
        };
        const rockMaterial = new THREE.ShaderMaterial({
            uniforms,
            vertexShader: `
                varying vec3 vWorldPos;
                varying vec3 vNormal;
                varying float vDist;

                void main() {
                    vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
                    vec4 mvPos = viewMatrix * worldPos;
                    vWorldPos = worldPos.xyz;
                    vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
                    vDist = length(mvPos.xyz);
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform vec3 uFogColor;
                uniform vec3 uLowColor;
                uniform vec3 uHighColor;
                varying vec3 vWorldPos;
                varying vec3 vNormal;
                varying float vDist;

                void main() {
                    float height = smoothstep(-34.0, 18.0, vWorldPos.y);
                    vec3 color = mix(uLowColor, uHighColor, height);
                    float topLight = max(dot(normalize(vNormal), normalize(vec3(0.1, 0.92, -0.22))), 0.0);
                    float upward = max(normalize(vNormal).y, 0.0);
                    float caustic = sin(vWorldPos.x * 0.12 + uTime * 0.55)
                        * sin(vWorldPos.z * 0.11 - uTime * 0.42);
                    caustic = pow(max(caustic * 0.5 + 0.5, 0.0), 4.0) * pow(upward, 1.2);
                    float striation = abs(sin(vWorldPos.y * 0.72 + vWorldPos.x * 0.05));
                    // Narrower lit range so even sun-facing rock stays in shadow tones.
                    color *= 0.72 + topLight * 0.58;
                    color *= 0.86 + striation * 0.10;
                    color += vec3(0.05, 0.18, 0.08) * pow(upward, 1.6) * 0.32;
                    color += vec3(0.06, 0.18, 0.14) * caustic * 0.10;

                    float fog = 1.0 - exp(-vDist * 0.0052);
                    color = mix(color, uFogColor, clamp(fog * 0.5, 0.0, 0.66));
                    gl_FragColor = vec4(color, 1.0);
                }
            `,
        });

        // WebGL fallback: same variant bucketing as the WebGPU path.
        const dummy = new THREE.Object3D();
        let placed = 0;
        for (let v = 0; v < VARIANT_COUNT && placed < reefCount; v++) {
            const bucketSize = Math.min(perVariant, reefCount - placed);
            const mesh = new THREE.InstancedMesh(variants[v], rockMaterial, bucketSize);
            for (let j = 0; j < bucketSize; j++) {
                placeOne(dummy, placed + j);
                mesh.setMatrixAt(j, dummy.matrix);
            }
            mesh.instanceMatrix.needsUpdate = true;
            mesh.computeBoundingSphere(); // WS A2
            mesh.frustumCulled = true;
            this.group.add(mesh);
            this.reefSilhouettes.push(mesh);
            placed += bucketSize;
        }
        this.uniforms.push(uniforms);

        this.createGodRayOccluders(variants, rockMaterial);
        if (!this.skipFlags.arches) this.createArchSilhouettes(rockMaterial);
    }

    createArchSilhouettes(sharedMaterial) {
        const archCount = Math.max(0, Math.floor(this.settings.archCount ?? 0));
        if (archCount <= 0) return;

        const geometry = new THREE.TorusGeometry(1, 0.12, 8, 28, Math.PI);
        const arches = new THREE.InstancedMesh(geometry, sharedMaterial, archCount);
        const dummy = new THREE.Object3D();

        for (let i = 0; i < archCount; i++) {
            const side = Math.random() < 0.5 ? -1 : 1;
            const x = side * randRange(64, 144);
            const z = randRange(-148, -48);
            const y = this.getSeabedHeight(x, z) + randRange(1.2, 3.2);
            dummy.position.set(x, y, z);
            dummy.rotation.set(randRange(-0.08, 0.08), randRange(-0.35, 0.35), Math.PI);
            dummy.scale.set(randRange(12, 27), randRange(9, 19), randRange(1.5, 3.6));
            dummy.updateMatrix();
            arches.setMatrixAt(i, dummy.matrix);
        }

        arches.instanceMatrix.needsUpdate = true;
        arches.computeBoundingSphere(); // WS A2
        arches.frustumCulled = true;
        this.group.add(arches);
        this.arches.push(arches);
    }

    /**
     * God-ray occluder rocks — smaller shelf stones positioned along the visible god-ray
     * cone so the post-pass shafts naturally chop into cinematic underwater
     * silhouettes.
     */
    createGodRayOccluders(variants, sharedMaterial) {
        const occluderCount = Math.max(0, Math.floor(this.settings.occluderCount ?? 6));
        if (occluderCount <= 0 || !variants.length) return;

        // Spread occluders across the different lumpy variants so they don't look
        // like identical orbs.
        const variantMeshes = variants.map((v) => new THREE.InstancedMesh(v, sharedMaterial, Math.ceil(occluderCount / variants.length)));
        const dummy = new THREE.Object3D();

        for (let i = 0; i < occluderCount; i++) {
            const vIdx = i % variants.length;
            const instanceIdx = Math.floor(i / variants.length);
            const mesh = variantMeshes[vIdx];
            if (instanceIdx >= mesh.count) continue;

            const t = i / (occluderCount - 1 || 1);
            const sideClear = Math.random() < 0.54 ? (Math.random() < 0.5 ? -1 : 1) * randRange(36, 62) : 0;
            const x = randRange(-58, 58) + Math.sin(t * Math.PI) * 10 + sideClear;
            const z = -122 + t * 86 + randRange(-12, 12);
            const baseY = this.getSeabedHeight(x, z);
            const y = baseY + randRange(6, 18);

            dummy.position.set(x, y, z);
            dummy.rotation.set(randRange(-0.15, 0.15), randRange(0, Math.PI * 2), randRange(-0.1, 0.1));
            // Flatten on Y to create the plate-like stacked shelf look.
            dummy.scale.set(randRange(12, 24), randRange(4, 8), randRange(10, 20));
            dummy.updateMatrix();
            mesh.setMatrixAt(instanceIdx, dummy.matrix);
        }

        variantMeshes.forEach((m) => {
            m.instanceMatrix.needsUpdate = true;
            m.computeBoundingSphere(); // WS A2
            m.frustumCulled = true;
            m.userData.isGodRayOccluder = true;
            this.group.add(m);
        });
    }

    /**
     * Distant biome silhouettes — far parallax planes hinting at cliff walls or
     * kelp curtains in fog. Always behind atmosphere haze.
     */
    createBiomeSilhouettes() {
        if (!this.isWebGPU) return; // TSL-only — keeps WebGL legacy path unchanged
        const count = Math.max(0, Math.floor(this.settings.biomeSilhouetteCount ?? 4));
        if (count <= 0) return;

        const geometry = new THREE.PlaneGeometry(220, 90);
        const tslMaterial = createBiomeSilhouetteNodeMaterial();

        for (let i = 0; i < count; i++) {
            const side = i % 2 === 0 ? -1 : 1;
            const t = i / (count - 1 || 1);
            const plane = new THREE.Mesh(geometry, tslMaterial);
            plane.position.set(side * randRange(60, 140), 30 + t * 12, -180 - t * 20);
            plane.rotation.y = side * randRange(0.05, 0.18);
            plane.renderOrder = -12;
            plane.userData.isBiomeSilhouette = true;
            plane.userData.isKelpCurtain = true;
            this.group.add(plane);
            this.biomeSilhouettes.push(plane);
        }
        this.tslUserData.push(tslMaterial.userData);
    }

    createAnchoredGlowSources() {
        const glowCount = Math.max(0, Math.floor(this.settings.glowAnchors ?? 0));
        if (glowCount <= 0) return;

        const glowColors = [
            new THREE.Color(0x35f0d0),
            new THREE.Color(0x86f3a8),
            new THREE.Color(0xd397ff),
            new THREE.Color(0xffaa69),
        ];
        const positions = new Float32Array(glowCount * 3);
        const colors = new Float32Array(glowCount * 3);
        const sizes = new Float32Array(glowCount);
        const phases = new Float32Array(glowCount);

        for (let i = 0; i < glowCount; i++) {
            let sideBias = 0;
            if (Math.random() < 0.58) sideBias = Math.random() < 0.5 ? -1 : 1;
            const x = sideBias === 0 ? randRange(-92, 92) : sideBias * randRange(26, 118);
            const z = randRange(-115, 65);
            const y = this.getSeabedHeight(x, z) + randRange(2.0, 12.0);
            const color = glowColors[i % glowColors.length];
            const intensity = randRange(0.48, 0.92);

            positions[i * 3] = x;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = z;
            colors[i * 3] = color.r * intensity;
            colors[i * 3 + 1] = color.g * intensity;
            colors[i * 3 + 2] = color.b * intensity;
            sizes[i] = randRange(6, 18);
            phases[i] = randRange(0, Math.PI * 2);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

        if (this.isWebGPU) {
            geometry.dispose();
            const billboardGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);
            billboardGeometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
            billboardGeometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(sizes, 1));
            billboardGeometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
            const tslMaterial = createGlowAnchorNodeMaterial({
                glowIntensity: 0.58,
                opacityScale: this.settings.glowAnchorOpacityScale ?? 1.0,
                emissiveScale: this.settings.glowAnchorEmissiveScale ?? 1.0,
            });
            const glows = new THREE.InstancedMesh(billboardGeometry, tslMaterial, glowCount);
            glows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            glows.frustumCulled = false;
            glows.renderOrder = 5;
            glows.userData.primitive = 'billboard-quad';
            this.group.add(glows);
            this.tslUserData.push(tslMaterial.userData);
            this.glowBillboardMesh = glows;
            this.glowBillboardData = { positions, phases, count: glowCount };
            return;
        }

        const uniforms = createSharedAtmosphereUniforms();
        const material = new THREE.ShaderMaterial({
            uniforms,
            vertexShader: `
                uniform float uTime;
                uniform float uGlowIntensity;
                attribute vec3 aColor;
                attribute float aSize;
                attribute float aPhase;
                varying vec3 vColor;
                varying float vPulse;
                varying float vDist;

                void main() {
                    vec3 pos = position;
                    pos.y += sin(uTime * 0.35 + aPhase) * 0.5;
                    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
                    vColor = aColor;
                    vPulse = 0.76 + sin(uTime * 1.15 + aPhase) * 0.18 + uGlowIntensity * 0.08;
                    vDist = length(mvPos.xyz);
                    gl_PointSize = aSize * vPulse * (180.0 / -mvPos.z);
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                uniform vec3 uFogColor;
                varying vec3 vColor;
                varying float vPulse;
                varying float vDist;

                void main() {
                    float d = length(gl_PointCoord - 0.5) * 2.0;
                    if (d > 1.0) discard;
                    float core = pow(1.0 - d, 4.0);
                    float aura = pow(1.0 - d, 1.7);
                    vec3 color = vColor * (core * 0.65 + aura * 0.35) * vPulse;
                    float fog = 1.0 - exp(-vDist * 0.007);
                    color = mix(color, uFogColor, fog * 0.48);
                    gl_FragColor = vec4(color, aura * 0.28 * vPulse);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const glows = new THREE.Points(geometry, material);
        glows.renderOrder = 5;
        this.group.add(glows);
        this.uniforms.push(uniforms);
    }

    createBeamDust() {
        const dustCount = Math.max(0, Math.floor(this.settings.beamDustCount ?? 0));
        if (dustCount <= 0) return;

        const positions = new Float32Array(dustCount * 3);
        const phases = new Float32Array(dustCount);
        const sizes = new Float32Array(dustCount);

        for (let i = 0; i < dustCount; i++) {
            positions[i * 3] = randRange(-180, 180);
            positions[i * 3 + 1] = randRange(8, 74);
            positions[i * 3 + 2] = randRange(-160, 85);
            phases[i] = randRange(0, Math.PI * 2);
            sizes[i] = randRange(0.7, 2.2);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

        if (this.isWebGPU) {
            geometry.dispose();
            const billboardGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);
            billboardGeometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
            billboardGeometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(sizes, 1));
            const tslMaterial = createBeamDustNodeMaterial();
            const dust = new THREE.InstancedMesh(billboardGeometry, tslMaterial, dustCount);

            // WS A3: bake each instance's base position into a static matrix
            // and never re-upload. Drift motion is now in the vertex shader
            // (see createBeamDustNodeMaterial). Rotation is identity — quads
            // sit in their natural XY plane facing camera default direction.
            const dummy = new THREE.Object3D();
            for (let i = 0; i < dustCount; i += 1) {
                const i3 = i * 3;
                dummy.position.set(positions[i3], positions[i3 + 1], positions[i3 + 2]);
                dummy.rotation.set(0, 0, 0);
                dummy.scale.setScalar(1);
                dummy.updateMatrix();
                dust.setMatrixAt(i, dummy.matrix);
            }
            dust.instanceMatrix.needsUpdate = true;
            dust.instanceMatrix.setUsage(THREE.StaticDrawUsage);
            dust.computeBoundingSphere();
            dust.frustumCulled = false; // bound is tight per-instance but drift expands footprint; safer to skip cull
            dust.renderOrder = 3;
            dust.userData.primitive = 'billboard-quad';
            this.group.add(dust);
            this.tslUserData.push(tslMaterial.userData);
            this.dustBillboardMesh = dust;
            // Per-frame drift is now shader-side; we no longer need the
            // positions/phases CPU arrays. Keep a stub so updateBillboards
            // null-checks still pass cleanly without rewriting that branch.
            this.dustBillboardData = null;
            return;
        }

        const uniforms = createSharedAtmosphereUniforms();
        const material = new THREE.ShaderMaterial({
            uniforms,
            vertexShader: `
                uniform float uTime;
                uniform float uCurrentStrength;
                attribute float aPhase;
                attribute float aSize;
                varying float vAlpha;
                varying float vDist;

                void main() {
                    vec3 pos = position;
                    pos.x += sin(uTime * 0.11 + aPhase) * (1.0 + uCurrentStrength * 0.8);
                    pos.y += sin(uTime * 0.09 + aPhase * 1.7) * 0.45;
                    pos.z += cos(uTime * 0.08 + aPhase * 1.3) * 0.65;
                    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
                    vDist = length(mvPos.xyz);
                    vAlpha = 0.5 + sin(uTime * 0.5 + aPhase) * 0.32;
                    gl_PointSize = aSize * (135.0 / -mvPos.z);
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                uniform vec3 uFogColor;
                varying float vAlpha;
                varying float vDist;

                void main() {
                    float d = length(gl_PointCoord - 0.5) * 2.0;
                    if (d > 1.0) discard;
                    float alpha = pow(1.0 - d, 2.1) * vAlpha;
                    float fog = 1.0 - exp(-vDist * 0.009);
                    vec3 color = mix(vec3(0.14, 0.48, 0.46), uFogColor, fog * 0.62);
                    gl_FragColor = vec4(color, alpha * 0.13);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const dust = new THREE.Points(geometry, material);
        dust.renderOrder = 3;
        this.group.add(dust);
        this.uniforms.push(uniforms);
    }

    setBillboardInstance(mesh, index, x, y, z) {
        if (!mesh || !this.camera || !this.billboardDummy) return;
        this.billboardDummy.position.set(x, y, z);
        this.billboardDummy.quaternion.copy(this.camera.quaternion);
        this.billboardDummy.scale.setScalar(1);
        this.billboardDummy.updateMatrix();
        mesh.setMatrixAt(index, this.billboardDummy.matrix);
    }

    updateBillboards(elapsed, currentStrength) {
        if (!this.isWebGPU || !this.camera) return;

        if (this.glowBillboardMesh && this.glowBillboardData) {
            const { positions, phases, count } = this.glowBillboardData;
            for (let i = 0; i < count; i += 1) {
                const i3 = i * 3;
                this.setBillboardInstance(
                    this.glowBillboardMesh,
                    i,
                    positions[i3],
                    positions[i3 + 1] + Math.sin(elapsed * 0.35 + phases[i]) * 0.5,
                    positions[i3 + 2],
                );
            }
            this.glowBillboardMesh.instanceMatrix.needsUpdate = true;
        }

        if (this.dustBillboardMesh && this.dustBillboardData) {
            const { positions, phases, count } = this.dustBillboardData;
            for (let i = 0; i < count; i += 1) {
                const i3 = i * 3;
                const phase = phases[i];
                this.setBillboardInstance(
                    this.dustBillboardMesh,
                    i,
                    positions[i3]
                        + Math.sin(elapsed * 0.11 + phase) * (1.0 + currentStrength * 0.8),
                    positions[i3 + 1] + Math.sin(elapsed * 0.09 + phase * 1.7) * 0.45,
                    positions[i3 + 2] + Math.cos(elapsed * 0.08 + phase * 1.3) * 0.65,
                );
            }
            this.dustBillboardMesh.instanceMatrix.needsUpdate = true;
        }
    }

    update(elapsed, {
        currentStrength = 0.5,
        glowIntensity = 0.8,
        billboardHeavyTick = true,
        skipBillboards = false,
    } = {}) {
        // Legacy ShaderMaterial uniforms (each is { value: ... } object)
        this.uniforms.forEach((uniforms) => {
            if (uniforms.uTime) uniforms.uTime.value = elapsed;
            if (uniforms.uCurrentStrength) uniforms.uCurrentStrength.value = currentStrength;
            if (uniforms.uGlowIntensity) uniforms.uGlowIntensity.value = glowIntensity;
        });
        // TSL NodeMaterial userData (each is a TSL uniform() node — same .value setter)
        this.tslUserData.forEach((userData) => {
            if (userData.uTime) userData.uTime.value = elapsed;
            if (userData.uCurrentStrength) userData.uCurrentStrength.value = currentStrength;
            if (userData.uGlowIntensity) userData.uGlowIntensity.value = glowIntensity;
        });
        // Glow + dust billboard meshes (up to ~504 instances at Extreme) update
        // at 30 Hz on the odd-frame stride group. Slow drift; visually identical.
        // ?oceanNoAtmosphereBillboards=1 sets skipBillboards to suppress entirely.
        if (billboardHeavyTick && !skipBillboards) this.updateBillboards(elapsed, currentStrength);
    }

    collectSignoff() {
        const coralManifest = summarizeCoralAssetManifest().heroCorals;
        const kelpManifest = summarizeKelpAssetManifest();
        return {
            bottomAssets: {
                foregroundRocks: this.foregroundRockStats,
                coralOvergrowth: this.coralOvergrowthStats,
                importedSeabedDetails: {
                    ...this.importedSeabedDetailStats,
                    activeCount: this.importedSeabedDetails.filter(Boolean).length,
                    manifest: {
                        plants: kelpManifest.seabedPlants,
                        seaweed: kelpManifest.heroKelp.filter((record) => record.sourceMode?.startsWith('third-party')),
                        corals: coralManifest.filter((record) => record.placementRole === 'carpet-patch'),
                        rocks: summarizeRockAssetManifest().heroRocks,
                    },
                },
                oversizedAssetWarnings: this.bottomAssetWarnings,
            },
            heroReefWalls: {
                ...this.heroReefStats,
                activeCount: this.heroReefWalls.filter(Boolean).length,
                glbLoadedCount: this.heroReefWalls.filter(
                    (reef) => reef?.userData?.assetStatus === 'glb-loaded',
                ).length,
                manifest: summarizeReefAssetManifest().heroReef,
            },
            coralCarpetPatches: {
                ...this.coralCarpetStats,
                activeCount: this.coralCarpetPatches.filter(Boolean).length,
                glbLoadedCount: this.coralCarpetPatches.filter(
                    (patch) => patch?.userData?.assetStatus === 'glb-loaded',
                ).length,
                manifest: coralManifest.filter((record) => record.placementRole === 'carpet-patch'),
            },
            heroCorals: {
                ...this.heroCoralStats,
                activeCount: this.heroCorals.filter(Boolean).length,
                glbLoadedCount: this.heroCorals.filter(
                    (coral) => coral?.userData?.assetStatus === 'glb-loaded',
                ).length,
                manifest: coralManifest.filter((record) => record.placementRole !== 'carpet-patch'),
            },
            heroKelp: {
                ...this.heroKelpStats,
                activeCount: this.heroKelp.filter(Boolean).length,
                glbLoadedCount: this.heroKelp.filter(
                    (kelp) => kelp?.userData?.assetStatus === 'glb-loaded',
                ).length,
                manifest: kelpManifest.heroKelp,
            },
        };
    }

    /**
     * Expose placement data for collision avoidance.
     */
    getOccupancyData() {
        return {
            clusters: ROCK_REEF_CLUSTERS,
            corals: HERO_CORAL_PLACEMENTS,
            reefs: HERO_REEF_PLACEMENTS,
            heroReefWalls: (this.heroReefWalls || []).map((wall) => ({
                x: wall.position.x,
                z: wall.position.z,
                radius: 12 * (wall.scale?.x || 1.0), // Heuristic for wall footprint
            })),
            occluders: (this.occluderPositions || []).map((pos) => ({
                x: pos.x,
                z: pos.z,
                radius: 10, // Average occluder footprint
            })),
        };
    }

    dispose() {
        this.assetUpgradeTimers?.forEach((timer) => clearTimeout(timer));
        this.assetUpgradeTimers = [];
        if (this.group) {
            this.scene?.remove(this.group);
            disposeObject(this.group);
            this.group.clear();
        }
        this.group = null;
        this.uniforms = [];
        this.tslUserData = [];
        this.occluderPositions = [];
        this.billboardDummy = null;
        this.glowBillboardMesh = null;
        this.glowBillboardData = null;
        this.dustBillboardMesh = null;
        this.dustBillboardData = null;
        this.heroReefWalls = [];
        this.coralCarpetPatches = [];
        this.heroCorals = [];
        this.heroKelp = [];
        this.coralOvergrowthInstances = [];
        this._coralOvergrowthCache = null;
        this.bottomAssetWarnings = [];
        this.foregroundRockStats = null;
        this.coralOvergrowthStats = null;
        this.heroReefStats = null;
        this.coralCarpetStats = null;
        this.heroCoralStats = null;
        this.heroKelpStats = null;
        this.scene = null;
        this.camera = null;
        this.getSeabedHeight = null;
    }
}

export default OceanAtmosphereSystem;

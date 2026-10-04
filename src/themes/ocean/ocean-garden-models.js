/* eslint-disable import/no-unresolved */
import * as THREE from 'three/webgpu';
import { attribute, uniform } from 'three/tsl';
import { loadGltfCached } from './ocean-asset-loader.js';
import { createOceanMorphSampler } from './ocean-jellyfish-model.js';

const TRIANGLE_BUDGET = 17000;
const TAU = Math.PI * 2;

// Small authored habitat pockets leave the central sand channel open. A record
// is one mesh/material draw, irrespective of how many colonies it contains.
const GARDENS = [
    {
        id: 'coral-rosette',
        url: new URL('./assets/blender-reef/coral-rosette.glb', import.meta.url).href,
        tint: 0xfff5ec,
        placements: [[-34, 13, 2.8, 0.25], [-44, -32, 2.6, 1.3], [-66, -68, 2.6, -0.6]],
    },
    {
        id: 'coral-antler',
        url: new URL('./assets/blender-reef/coral-antler.glb', import.meta.url).href,
        tint: 0xf4efff,
        placements: [[-48, 5, 2.5, 0.2], [51, -53, 2.3, -0.8], [-55, -101, 2.4, 1.5]],
    },
    {
        id: 'anemone-lantern',
        url: new URL('./assets/blender-reef/anemone-lantern.glb', import.meta.url).href,
        tint: 0xfff8ef,
        luminous: true,
        placements: [[-32, -8, 3.0, -0.5], [37, -33, 2.8, 1.3], [-60, -58, 2.8, 0.5]],
    },
    {
        id: 'seaweed-spiral',
        url: new URL('./assets/blender-reef/seaweed-spiral.glb', import.meta.url).href,
        tint: 0xc1ed91,
        blades: true,
        placements: [[-48, 5, 5.2, -0.5], [51, -23, 5.0, 0.8], [-56, -77, 5.4, 2.4]],
    },
    {
        id: 'grass-meadow',
        url: new URL('./assets/blender-reef/grass-meadow.glb', import.meta.url).href,
        tint: 0xb9ed88,
        blades: true,
        placements: [[28, 6, 4.9, 0.3], [38, -29, 5.6, -1.1], [-31, -14, 4.8, 1.7], [-51, -67, 5.2, 0.7]],
    },
    {
        id: 'stone-ridge',
        url: new URL('./assets/blender-reef/stone-ridge.glb', import.meta.url).href,
        tint: 0xe1f1ed,
        stone: true,
        placements: [[-51, 11, 2.2, -0.8], [63, -71, 2.8, 0.3], [-69, -80, 2.6, 1.2]],
    },
    {
        id: 'reef-arch',
        url: new URL('./assets/blender-reef/reef-arch.glb', import.meta.url).href,
        tint: 0xd4ebe7,
        stone: true,
        placements: [[63, -108, 3.0, 0.12]],
    },
    {
        id: 'pearl-cluster',
        url: new URL('./assets/blender-reef/pearl-cluster.glb', import.meta.url).href,
        tint: 0xeafffa,
        luminous: true,
        placements: [[-50, -41, 2.5, 0.5], [57, -61, 2.7, -0.7], [69, -101, 2.7, 1.4]],
    },
];

// Cache-returned scene geometry/materials belong to this load, but its texture
// references belong to the cache. These authored assets have no texture maps.
function disposeLoadedScene(scene) {
    const resources = new Set();
    scene?.traverse((child) => {
        if (child.geometry) resources.add(child.geometry);
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.filter(Boolean).forEach((material) => resources.add(material));
    });
    resources.forEach((resource) => resource.dispose());
    scene?.clear();
}

function inspectAsset(gltf, record) {
    const sources = [];
    gltf.scene.updateWorldMatrix(true, true);
    gltf.scene.traverse((child) => {
        if (child.isMesh) sources.push(child);
    });
    if (sources.length !== 1 || sources[0].isSkinnedMesh
        || Array.isArray(sources[0].material) || !sources[0].geometry.attributes.color) {
        throw new TypeError(`${record.id} requires one vertex-painted, unskinned mesh and material.`);
    }
    const [source] = sources;
    const triangleCount = (source.geometry.index?.count ?? source.geometry.attributes.position.count) / 3;
    if (!Number.isInteger(triangleCount) || triangleCount <= 0) {
        throw new TypeError(`${record.id} has invalid triangle topology.`);
    }
    return {
        record, gltf, source, triangleCount, count: record.placements.length,
    };
}

function createMaterial(record, geometry, sourceMatrix, usesNodeMaterials) {
    const Material = usesNodeMaterials ? THREE.MeshStandardNodeMaterial : THREE.MeshStandardMaterial;
    const material = new Material({
        color: record.tint,
        vertexColors: true,
        roughness: record.stone ? 0.96 : 0.72,
        metalness: 0,
        side: record.blades ? THREE.DoubleSide : THREE.FrontSide,
    });
    material.name = `Ocean Garden ${record.id}`;
    // A small painted-color contribution keeps crimson, apricot and gold
    // legible through underwater fill lighting without introducing white haze.
    if (usesNodeMaterials && !record.stone) material.emissiveNode = attribute('color', 'vec3').mul(0.035);
    if (record.luminous && usesNodeMaterials) {
        // A per-vertex cap mask keeps dark holdfasts dark. Authored COLOR_0
        // supplies the tip hue; there are no additional textures or lights.
        const positions = geometry.attributes.position;
        const point = new THREE.Vector3();
        let minimum = Infinity;
        let maximum = -Infinity;
        for (let index = 0; index < positions.count; index += 1) {
            point.fromBufferAttribute(positions, index).applyMatrix4(sourceMatrix);
            minimum = Math.min(minimum, point.y);
            maximum = Math.max(maximum, point.y);
        }
        const height = Math.max(maximum - minimum, 0.001);
        const mask = new Float32Array(positions.count);
        for (let index = 0; index < positions.count; index += 1) {
            point.fromBufferAttribute(positions, index).applyMatrix4(sourceMatrix);
            mask[index] = THREE.MathUtils.smoothstep((point.y - minimum) / height, 0.56, 0.92);
        }
        geometry.setAttribute('oceanGardenGlow', new THREE.BufferAttribute(mask, 1));
        const glow = uniform(0.045);
        material.emissiveNode = attribute('color', 'vec3')
            .mul(attribute('oceanGardenGlow', 'float').mul(glow).add(0.035));
        material.userData.gardenGlow = glow;
    }
    return material;
}

function groundedMatrix(source, placement, getSeabedHeight, stone) {
    const [x, z, scale, rotation] = placement;
    const transform = new THREE.Matrix4().makeRotationY(rotation).scale(new THREE.Vector3(scale, scale, scale));
    transform.setPosition(x, 0, z);
    transform.multiply(source.matrixWorld);
    const positions = source.geometry.attributes.position;
    const point = new THREE.Vector3();
    let minimum = Infinity;
    let maximum = -Infinity;
    for (let index = 0; index < positions.count; index += 1) {
        point.fromBufferAttribute(positions, index).applyMatrix4(transform);
        minimum = Math.min(minimum, point.y);
        maximum = Math.max(maximum, point.y);
    }
    // Larger understory clumps expose more of their curved root skirt. Seat
    // that whole low band so the downhill edge stays planted on broad dunes.
    const band = minimum + Math.min(0.6, (maximum - minimum) * 0.08);
    let offset = Infinity;
    for (let index = 0; index < positions.count; index += 1) {
        point.fromBufferAttribute(positions, index).applyMatrix4(transform);
        if (point.y <= band) offset = Math.min(offset, getSeabedHeight(point.x, point.z) - point.y);
    }
    if (!Number.isFinite(offset)) throw new TypeError('Ocean garden requires finite seabed heights.');
    transform.elements[13] += offset - (stone ? 0.32 : 0.12);
    return transform;
}

/**
 * Load at most eight draws of original Blender flora/stone. The returned group
 * is unattached; the caller owns stale-generation checks before adding it.
 * Low detail returns null without requesting any assets.
 */
export async function createOceanGardenModels({
    getSeabedHeight,
    isWebGPU = true, usesNodeMaterials = isWebGPU,
    detailCount = 0,
} = {}) {
    const requested = Number.isFinite(detailCount) ? Math.max(0, Math.floor(detailCount)) : 0;
    if (requested === 0) return null;
    if (typeof getSeabedHeight !== 'function') throw new TypeError('Ocean garden requires getSeabedHeight.');
    const records = GARDENS.slice(0, Math.min(requested, GARDENS.length));
    const results = await Promise.allSettled(records.map((record) => loadGltfCached(record.url)));
    const diagnostics = {
        requestedVariants: records.length,
        variantCount: 0,
        drawCalls: 0,
        instanceCount: 0,
        triangleCount: 0,
        animatedVariants: 0,
        assets: [],
        errors: [],
    };
    const assets = [];
    results.forEach((result, index) => {
        if (result.status === 'rejected') {
            diagnostics.errors.push({
                id: records[index].id, message: String(result.reason?.message ?? result.reason),
            });
            return;
        }
        try {
            assets.push(inspectAsset(result.value, records[index]));
        } catch (error) {
            diagnostics.errors.push({ id: records[index].id, message: error.message });
            disposeLoadedScene(result.value.scene);
        }
    });
    // Preserve every habitat before removing repetitions when an authored
    // model grows. The hard cap also guards against an accidental heavy export.
    let triangles = assets.reduce((sum, asset) => sum + asset.triangleCount * asset.count, 0);
    while (triangles > TRIANGLE_BUDGET) {
        const candidate = assets.filter((asset) => asset.count > (asset.record.id === 'reef-arch' ? 1 : 2))
            .sort((a, b) => b.triangleCount - a.triangleCount)[0];
        if (!candidate) break;
        candidate.count -= 1;
        triangles -= candidate.triangleCount;
    }
    const group = new THREE.Group();
    group.name = 'OceanBlenderGarden';
    const states = [];
    let disposed = false;
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        group.removeFromParent();
        states.forEach(({ mesh }) => {
            mesh.dispose();
            mesh.geometry.dispose();
            mesh.material.dispose();
        });
        states.length = 0;
        group.clear();
    };
    try {
        if (triangles > TRIANGLE_BUDGET) throw new RangeError('Ocean garden exceeds its 17000 triangle budget.');
        assets.forEach((asset, assetIndex) => {
            const {
                record, gltf, source, triangleCount, count,
            } = asset;
            const geometry = source.geometry.clone();
            const material = createMaterial(record, geometry, source.matrixWorld, usesNodeMaterials);
            const mesh = new THREE.InstancedMesh(geometry, material, count);
            mesh.name = `OceanGarden:${record.id}`;
            mesh.castShadow = false;
            mesh.receiveShadow = true;
            mesh.userData.assetId = record.id;
            const morphCount = geometry.morphAttributes.position?.length ?? 0;
            const influenceSource = { morphTargetInfluences: new Array(morphCount).fill(0) };
            const clip = gltf.animations.find((animation) => (
                animation.tracks.some((track) => track.name.includes('morphTargetInfluences'))
            ));
            const sample = morphCount > 0 ? createOceanMorphSampler(source, clip) : null;
            // r186's multi-instance morph branch must have no ordinary influence
            // array: it reads the per-instance morph texture instead.
            if (morphCount > 0) {
                mesh.morphTargetDictionary = { ...source.morphTargetDictionary };
                if (count === 1) mesh.morphTargetInfluences = influenceSource.morphTargetInfluences;
            }
            const state = {
                mesh, sample, influenceSource, phase: assetIndex * 1.618,
            };
            states.push(state);
            for (let index = 0; index < count; index += 1) {
                const matrix = groundedMatrix(source, record.placements[index], getSeabedHeight, record.stone);
                mesh.setMatrixAt(index, matrix);
                if (sample) mesh.setMorphAt(index, influenceSource);
            }
            mesh.instanceMatrix.needsUpdate = true;
            // BufferGeometry's bounds include morph positions; InstancedMesh
            // combines them with every authored placement once at construction.
            mesh.computeBoundingSphere();
            group.add(mesh);
            diagnostics.assets.push({
                id: record.id, count, triangleCount, animated: !!sample?.authored,
            });
            diagnostics.variantCount += 1;
            diagnostics.drawCalls += 1;
            diagnostics.instanceCount += count;
            diagnostics.triangleCount += triangleCount * count;
            if (sample?.authored) diagnostics.animatedVariants += 1;
        });
    } catch (error) {
        dispose();
        throw error;
    } finally {
        assets.forEach(({ gltf }) => disposeLoadedScene(gltf.scene));
    }
    const update = (time, current = 0.5, glow = 0.8) => {
        if (disposed) return;
        const strength = THREE.MathUtils.clamp(Number.isFinite(current) ? current : 0.5, 0, 2);
        const radiance = THREE.MathUtils.clamp(Number.isFinite(glow) ? glow : 0.8, 0, 3);
        states.forEach(({
            mesh, sample, influenceSource, phase,
        }) => {
            const glowUniform = mesh.material.userData.gardenGlow;
            if (glowUniform) glowUniform.value = 0.026 + radiance * 0.024;
            if (!sample) return;
            for (let index = 0; index < mesh.count; index += 1) {
                const weights = sample(time, (phase + index * 2.399) % TAU);
                for (let target = 0; target < weights.length; target += 1) {
                    influenceSource.morphTargetInfluences[target] = weights[target] * (0.7 + strength * 0.15);
                }
                mesh.setMorphAt(index, influenceSource);
            }
            mesh.morphTexture.needsUpdate = true;
        });
    };
    update(0);
    group.userData.oceanGardenDiagnostics = diagnostics;
    return {
        group, update, dispose, diagnostics,
    };
}

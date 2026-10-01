/* eslint-disable import/no-unresolved */
import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, dot, float, length, max, normalWorld, normalize, positionWorld, uniform, vec3,
} from 'three/tsl';
import { loadGltfCached } from './ocean-asset-loader.js';
import { createOceanMorphSampler, transformMorphGeometry } from './ocean-jellyfish-model.js';
import { tslWarmCoolAttenuation } from './ocean-tsl-helpers.js';

const SCHOOL_ASSETS = [
    new URL('./assets/blender-reef/fish-prism-tang.glb', import.meta.url).href,
    new URL('./assets/blender-reef/fish-moon-sardine.glb', import.meta.url).href,
    new URL('./assets/blender-reef/fish-ember-anthias.glb', import.meta.url).href,
    new URL('./assets/blender-reef/fish-sun-banner.glb', import.meta.url).href,
];

export const OCEAN_ATELIER_CREATURES = [
    {
        id: 'atelier-manta',
        url: new URL('./assets/blender-reef/creature-manta.glb', import.meta.url).href,
        runtimeScale: 2.8,
        referenceSpeed: 7,
        forwardAxis: '+X',
        animationNames: ['creature_manta_Swim_Loop'],
        triangleCount: 750,
    },
    {
        id: 'atelier-cuttlefish',
        url: new URL('./assets/blender-reef/creature-cuttlefish.glb', import.meta.url).href,
        runtimeScale: 2.1,
        referenceSpeed: 5,
        forwardAxis: '+X',
        animationNames: ['creature_cuttlefish_Swim_Loop'],
        triangleCount: 818,
    },
].map((record) => ({
    ...record,
    modelVersion: 'ocean-atelier-2026-10',
    sourceMode: 'blender-mcp-project-authored',
    license: 'MIT-project-local',
}));

function disposeSource(root) {
    root?.traverse((child) => {
        child.geometry?.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => material?.dispose());
    });
    root?.clear();
}

/** Original Blender silhouettes and clips retain the existing school simulation. */
export function createOceanSchoolModel(gltf, { count, phases, isWebGPU = true }) {
    let source;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((child) => { if (child.isMesh) source = child; });
    if (!source?.geometry.morphAttributes.position?.length) throw new Error('School asset needs authored morphs.');
    const geometry = source.geometry.clone();
    transformMorphGeometry(geometry, source.matrixWorld);
    const material = isWebGPU
        ? new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide })
        : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.54, side: THREE.DoubleSide });
    const uTime = uniform(0);
    const uCurrentStrength = uniform(0.5);
    const uGlowIntensity = uniform(0.8);
    if (isWebGPU) {
        const paint = attribute('color', 'vec3');
        const light = max(dot(normalize(normalWorld), normalize(vec3(-0.1, 0.9, -0.42))), float(0));
        const lit = paint.mul(light.mul(0.50).add(0.42)).mul(float(0.96).add(uGlowIntensity.mul(0.05)));
        material.colorNode = tslWarmCoolAttenuation(lit, length(cameraPosition.sub(positionWorld)), float(0.60));
    }
    material.userData = { uTime, uCurrentStrength, uGlowIntensity };
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = `OceanSchool:${source.name}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.morphTargetDictionary = { ...source.morphTargetDictionary };
    const sample = createOceanMorphSampler(source, gltf.animations[0]);
    const pose = { morphTargetInfluences: [...source.morphTargetInfluences] };
    for (let i = 0; i < count; i++) mesh.setMorphAt(i, pose);
    if (count === 1) mesh.morphTargetInfluences = pose.morphTargetInfluences;
    mesh.userData.authoredSchool = true;
    mesh.userData.authoredMorphAnimation = sample.authored;
    mesh.userData.activeSchoolCount = count;
    mesh.userData.setActiveCount = (active) => {
        const visibleCount = THREE.MathUtils.clamp(active, 0, count);
        for (let i = visibleCount; i < mesh.userData.activeSchoolCount; i++) {
            // Keep dormant fish outside the frustum with a nonsingular matrix.
            // Native r186 morph setup is keyed to the fixed population capacity.
            const offset = i * 16;
            mesh.instanceMatrix.array.fill(0, offset, offset + 16);
            mesh.instanceMatrix.array[offset] = 0.000001;
            mesh.instanceMatrix.array[offset + 5] = 0.000001;
            mesh.instanceMatrix.array[offset + 10] = 0.000001;
            mesh.instanceMatrix.array[offset + 13] = -10000;
            mesh.instanceMatrix.array[offset + 15] = 1;
        }
        mesh.userData.activeSchoolCount = visibleCount;
        mesh.instanceMatrix.needsUpdate = true;
    };
    mesh.userData.update = (time) => {
        for (let i = 0; i < mesh.userData.activeSchoolCount; i++) {
            const weights = sample(time * 1.35, phases[i]);
            for (let j = 0; j < weights.length; j++) pose.morphTargetInfluences[j] = weights[j];
            mesh.setMorphAt(i, pose);
        }
        if (mesh.morphTexture) mesh.morphTexture.needsUpdate = true;
    };
    return mesh;
}

export async function upgradeOceanSchoolModels(system) {
    const generation = system.loadGeneration;
    await Promise.all(SCHOOL_ASSETS.map(async (url, index) => {
        const fallback = system.meshes[index];
        if (!fallback) return;
        let gltf;
        try {
            gltf = await loadGltfCached(url);
            if (system.disposed || generation !== system.loadGeneration || !system.scene) return;
            const count = system.speciesCounts[index];
            const phases = new Float32Array(count);
            const misc = fallback.geometry.attributes.aMisc;
            for (let i = 0; i < count; i++) phases[i] = misc.getX(i);
            const mesh = createOceanSchoolModel(gltf, { count, phases, isWebGPU: system.isWebGPU });
            mesh.instanceMatrix.array.set(fallback.instanceMatrix.array);
            mesh.instanceMatrix.needsUpdate = true;
            mesh.userData.setActiveCount(fallback.count);
            mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 30, 0), 230);
            mesh.userData.update(system._authoredSchoolTime || 0);
            fallback.removeFromParent();
            fallback.dispose();
            fallback.geometry.dispose();
            fallback.material.dispose();
            system.meshes[index] = mesh;
            system.materials[index] = mesh.material;
            system.scene.add(mesh);
        } catch (error) {
            if (!system.disposed) console.warn('[Ocean] Authored school unavailable; keeping fallback:', error);
        } finally {
            disposeSource(gltf?.scene);
        }
    }));
}

import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    createOceanSchoolModel, OCEAN_ATELIER_CREATURES,
} from '../../src/themes/ocean/ocean-school-models.js';
import { createOceanMorphSampler } from '../../src/themes/ocean/ocean-jellyfish-model.js';
import { OceanFishSystem } from '../../src/themes/ocean/ocean-fish-system.js';
import { loadGltfCached } from '../../src/themes/ocean/ocean-asset-loader.js';
import { disposeReefCausticTexture } from '../../src/themes/ocean/ocean-caustics.js';

vi.mock('../../src/themes/ocean/ocean-asset-loader.js', () => ({ loadGltfCached: vi.fn() }));

const schoolNames = ['fish-prism-tang', 'fish-moon-sardine', 'fish-ember-anthias', 'fish-sun-banner'];
const faunaNames = [...schoolNames, 'creature-manta', 'creature-cuttlefish'];
const owned = [];
const systems = [];

afterEach(() => {
    systems.forEach((system) => { if (!system.disposed) system.dispose(); });
    systems.length = 0;
    owned.forEach((resource) => resource.dispose());
    owned.length = 0;
    disposeReefCausticTexture();
    vi.restoreAllMocks();
    vi.resetAllMocks();
});

async function readAsset(name, trackResources = true) {
    const path = new URL(`../../src/themes/ocean/assets/blender-reef/${name}.glb`, import.meta.url);
    const bytes = await readFile(path);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const gltf = await new GLTFLoader().parseAsync(buffer, '');
    const meshes = [];
    gltf.scene.traverse((child) => {
        if (!child.isMesh) return;
        meshes.push(child);
        if (trackResources) owned.push(child.geometry, child.material);
    });
    return { gltf, meshes, source: meshes[0] };
}

function createModel(gltf, options = {}) {
    const model = createOceanSchoolModel(gltf, {
        count: 3, phases: new Float32Array([0, 0.73, 2.13]), ...options,
    });
    owned.push(model, model.geometry, model.material);
    return model;
}

function makeSystem(isWebGPU = true) {
    const system = new OceanFishSystem({
        scene: new THREE.Scene(),
        camera: new THREE.PerspectiveCamera(),
        preset: { fishCount: 32, heroFishCount: 0, atmosphere: { biodiversityAssets: true } },
        getSeabedHeight: () => -22,
        isWebGPU,
    });
    systems.push(system);
    return system;
}

function pendingSchoolLoads() {
    const pending = new Map();
    loadGltfCached.mockImplementation((url) => new Promise((resolve, reject) => {
        const name = url.split('/').at(-1).replace('.glb', '');
        pending.set(name, { resolve, reject });
    }));
    return pending;
}

async function resolveSchools(pending) {
    return Promise.all([...pending].map(async ([name, load]) => {
        const asset = await readAsset(name, false);
        const disposeGeometry = vi.spyOn(asset.source.geometry, 'dispose');
        const disposeMaterial = vi.spyOn(asset.source.material, 'dispose');
        load.resolve(asset.gltf);
        return {
            ...asset, name, disposeGeometry, disposeMaterial,
        };
    }));
}

function expectHiddenMatrix(mesh, index) {
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(index, matrix);
    expect(matrix.elements[13]).toBeLessThan(-9000);
    expect(matrix.elements[0]).toBeGreaterThan(0);
    expect(matrix.elements[0]).toBeLessThan(0.00001);
    expect(matrix.determinant()).toBeGreaterThan(0);
    expect(matrix.elements[15]).toBe(1);
}

describe('Original Blender fauna animation contracts', () => {
    it.each(faunaNames)('%s retains a colored single mesh and a real seamless four-second clip', async (name) => {
        const { gltf, source, meshes } = await readAsset(name);
        expect(meshes).toHaveLength(1);
        expect(Array.isArray(source.material)).toBe(false);
        expect(source.material.map).toBeNull();
        expect(source.geometry.attributes.color.count).toBe(source.geometry.attributes.position.count);
        expect(source.geometry.morphTargetsRelative).toBe(true);
        expect(Object.keys(source.morphTargetDictionary)).toEqual(['swimBend', 'finSweep']);
        const triangles = source.geometry.index.count / 3;
        expect(triangles).toBeLessThanOrEqual(name.startsWith('fish-') ? 260 : 1000);
        expect(gltf.animations).toHaveLength(1);
        const sampler = createOceanMorphSampler(source, gltf.animations[0]);
        expect(sampler.authored).toBe(true);
        expect(sampler.duration).toBeCloseTo(4, 5);
        const first = sampler(0).slice();
        expect(sampler(sampler.duration)).toEqual(first);
        expect(sampler(0.317)).not.toEqual(first);

        // Prove exported Blender tracks deform actual vertices in the native mixer.
        const mixer = new THREE.AnimationMixer(gltf.scene);
        mixer.clipAction(gltf.animations[0]).play();
        mixer.setTime(sampler.startTime);
        const base = Array.from({ length: source.geometry.attributes.position.count }, (_, index) => (
            source.getVertexPosition(index, new THREE.Vector3())
        ));
        mixer.setTime(sampler.startTime + 0.317);
        let largestMove = 0;
        base.forEach((point, index) => {
            largestMove = Math.max(largestMove, point.distanceTo(source.getVertexPosition(index, new THREE.Vector3())));
        });
        expect(largestMove).toBeGreaterThan(0.01);
        mixer.stopAllAction();
        mixer.uncacheRoot(gltf.scene);

        const record = OCEAN_ATELIER_CREATURES.find((entry) => entry.url.endsWith(`/${name}.glb`));
        if (record) {
            expect(record.animationNames).toContain(gltf.animations[0].name);
            expect(record.triangleCount).toBe(triangles);
            expect(record.forwardAxis).toBe('+X');
        } else {
            const bounds = new THREE.Box3().setFromBufferAttribute(source.geometry.attributes.position);
            expect(bounds.max.x - bounds.min.x).toBeCloseTo(1.5);
        }
    });
});

describe('Ocean authored school runtime', () => {
    it.each([true, false])('samples independent phases and preserves source geometry (%s)', async (isWebGPU) => {
        const { gltf, source } = await readAsset('fish-prism-tang');
        const positions = source.geometry.attributes.position.array.slice();
        const deltas = source.geometry.morphAttributes.position[0].array.slice();
        const phases = new Float32Array([0, 0.73, 2.13]);
        const mesh = createModel(gltf, { isWebGPU, phases });
        const sampler = createOceanMorphSampler(source, gltf.animations[0]);
        mesh.userData.update(0.49);
        const pose = { morphTargetInfluences: [0, 0] };
        for (let index = 0; index < 3; index += 1) {
            mesh.getMorphAt(index, pose);
            const expected = sampler(0.49 * 1.35, phases[index]);
            pose.morphTargetInfluences.forEach((weight, target) => expect(weight).toBeCloseTo(expected[target], 5));
        }
        expect(mesh.morphTargetInfluences).toBeUndefined();
        expect(mesh.material.isNodeMaterial === true).toBe(isWebGPU);
        expect(mesh.geometry.attributes.color.array).toEqual(source.geometry.attributes.color.array);
        expect(source.geometry.attributes.position.array).toEqual(positions);
        expect(source.geometry.morphAttributes.position[0].array).toEqual(deltas);
        expect(mesh.geometry).not.toBe(source.geometry);
    });

    it('keeps native morph capacity stable across zero, one, and many visible fish', async () => {
        const { gltf } = await readAsset('fish-sun-banner');
        const mesh = createModel(gltf);
        const materialVersion = mesh.material.version;
        for (const active of [0, 1, 3, 1, 0]) {
            mesh.userData.setActiveCount(active);
            mesh.userData.update(0.37);
            expect(mesh.count).toBe(3);
            expect(mesh.userData.activeSchoolCount).toBe(active);
            expect(mesh.morphTargetInfluences).toBeUndefined();
            expect(mesh.material.version).toBe(materialVersion);
            for (let index = active; index < 3; index += 1) expectHiddenMatrix(mesh, index);
        }
        const single = createModel(gltf, { count: 1, phases: new Float32Array([0.43]) });
        single.userData.setActiveCount(0);
        single.userData.update(0.37);
        expect(single.count).toBe(1);
        expect(single.morphTargetInfluences).toHaveLength(2);
        expectHiddenMatrix(single, 0);
        single.userData.setActiveCount(1);
        single.userData.update(0.37);
        expect(single.morphTargetInfluences.every(Number.isFinite)).toBe(true);
    });

    it.each([true, false])('replaces four meshes and preserves simulation and reveal state (%s)', async (isWebGPU) => {
        const pending = pendingSchoolLoads();
        const system = makeSystem(isWebGPU);
        system.init();
        const fallbacks = [...system.meshes];
        const visibleCounts = fallbacks.map((mesh) => mesh.count);
        const matrices = fallbacks.map((mesh) => mesh.instanceMatrix.array.slice());
        const phases = fallbacks.map((mesh) => (
            Array.from({ length: mesh.instanceMatrix.count }, (_, index) => mesh.geometry.attributes.aMisc.getX(index))
        ));
        const fallbackDisposals = fallbacks.map((mesh) => ({
            geometry: vi.spyOn(mesh.geometry, 'dispose'), material: vi.spyOn(mesh.material, 'dispose'),
        }));
        const positions = system.positions.slice();
        const velocities = system.velocities.slice();
        expect(pending.size).toBe(4);
        expect(system.scene.children).toHaveLength(4);
        const assets = await resolveSchools(pending);
        await system.schoolModelLoadPromise;
        expect(system.scene.children).toHaveLength(4);
        expect(system.positions).toEqual(positions);
        expect(system.velocities).toEqual(velocities);
        system.meshes.forEach((mesh, species) => {
            expect(mesh).not.toBe(fallbacks[species]);
            expect(mesh.count).toBe(system.speciesCounts[species]);
            expect(mesh.userData.activeSchoolCount).toBe(visibleCounts[species]);
            expect(mesh.instanceMatrix.array.slice(0, visibleCounts[species] * 16))
                .toEqual(matrices[species].slice(0, visibleCounts[species] * 16));
            for (let index = visibleCounts[species]; index < mesh.count; index += 1) expectHiddenMatrix(mesh, index);
            const asset = assets.find(({ name }) => name === schoolNames[species]);
            const sampler = createOceanMorphSampler(asset.source, asset.gltf.animations[0]);
            const pose = { morphTargetInfluences: [0, 0] };
            for (let index = 0; index < visibleCounts[species]; index += 1) {
                mesh.getMorphAt(index, pose);
                const expected = sampler(0, phases[species][index]);
                pose.morphTargetInfluences.forEach((weight, target) => expect(weight).toBeCloseTo(expected[target], 5));
            }
            expect(fallbackDisposals[species].geometry).toHaveBeenCalledTimes(1);
            expect(fallbackDisposals[species].material).toHaveBeenCalledTimes(1);
        });
        assets.forEach(({ disposeGeometry, disposeMaterial }) => {
            expect(disposeGeometry).toHaveBeenCalledTimes(1);
            expect(disposeMaterial).toHaveBeenCalledTimes(1);
        });
        while (system.activateNextSchool()) { /* Reveal existing simulation slots. */ }
        system.updateMatrices();
        system.meshes.forEach((mesh) => {
            expect(mesh.userData.activeSchoolCount).toBe(mesh.count);
            for (let index = 0; index < mesh.count; index += 1) {
                expect(mesh.instanceMatrix.array[index * 16 + 13]).toBeGreaterThan(-1000);
            }
        });
        const morphDisposals = system.meshes.map((mesh) => vi.spyOn(mesh.morphTexture, 'dispose'));
        system.dispose();
        morphDisposals.forEach((dispose) => expect(dispose).toHaveBeenCalledTimes(1));
    });

    it('disposes late loaded clones without resurrecting a stopped system', async () => {
        const pending = pendingSchoolLoads();
        const system = makeSystem();
        system.init();
        const { scene } = system;
        const completion = system.schoolModelLoadPromise;
        system.dispose();
        const assets = await resolveSchools(pending);
        await completion;
        expect(scene.children).toHaveLength(0);
        expect(system.meshes).toHaveLength(0);
        assets.forEach(({ disposeGeometry, disposeMaterial }) => {
            expect(disposeGeometry).toHaveBeenCalledTimes(1);
            expect(disposeMaterial).toHaveBeenCalledTimes(1);
        });
    });

    it('retains each fallback when an authored school asset fails to load', async () => {
        const pending = pendingSchoolLoads();
        const system = makeSystem();
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        system.init();
        const fallbacks = [...system.meshes];
        pending.forEach(({ reject }) => reject(new Error('missing GLB')));
        await system.schoolModelLoadPromise;
        expect(system.meshes).toEqual(fallbacks);
        expect(system.scene.children).toEqual(fallbacks);
        expect(warning).toHaveBeenCalledTimes(4);
    });
});

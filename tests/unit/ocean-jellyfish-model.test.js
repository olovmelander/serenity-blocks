import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    createOceanJellyfishModels,
    createOceanMorphSampler,
    disposeOceanJellyfishModels,
    updateOceanJellyfishModels,
} from '../../src/themes/ocean/ocean-jellyfish-model.js';

const fixtures = [];
const models = [];
afterEach(() => {
    models.forEach(disposeOceanJellyfishModels);
    models.length = 0;
    fixtures.forEach(({ source }) => {
        source.geometry.dispose();
        source.material.dispose();
    });
    fixtures.length = 0;
});

function makeFixture() {
    const geometry = new THREE.BoxGeometry(2, 4, 2);
    const { count } = geometry.attributes.position;
    const rgba = new Float32Array(count * 4);
    const pulse = new Float32Array(count * 3);
    const sway = new Float32Array(count * 3);
    const normalPulse = new Float32Array(count * 3);
    const baseNormal = new THREE.Vector3();
    const targetNormal = new THREE.Vector3();
    for (let index = 0; index < count; index += 1) {
        rgba.set([0.3, 0.65, 0.8, 0.24 + (index % 2) * 0.5], index * 4);
        pulse.set([0.1, 0.2, -0.1], index * 3);
        sway.set([-0.12, 0, 0.08], index * 3);
        baseNormal.fromBufferAttribute(geometry.attributes.normal, index);
        targetNormal.copy(baseNormal).add(new THREE.Vector3(0.04, 0.1, 0.06)).normalize().sub(baseNormal);
        normalPulse.set(targetNormal.toArray(), index * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
    geometry.morphAttributes.position = [
        new THREE.BufferAttribute(pulse, 3), new THREE.BufferAttribute(sway, 3),
    ];
    geometry.morphAttributes.position[0].name = 'bellPulse';
    geometry.morphAttributes.position[1].name = 'currentSway';
    geometry.morphAttributes.normal = [
        new THREE.BufferAttribute(normalPulse, 3), new THREE.BufferAttribute(new Float32Array(count * 3), 3),
    ];
    geometry.morphTargetsRelative = true;
    const source = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true }));
    source.name = 'BlenderJellyfish';
    source.position.set(5, -3, 2);
    source.scale.set(2, 3, 0.5);
    const scene = new THREE.Group();
    scene.rotation.z = 0.4;
    scene.add(source);
    const binding = 'BlenderJellyfish.morphTargetInfluences';
    const track = new THREE.NumberKeyframeTrack(binding, [0, 2, 4], [0, -1, 1, 0.5, 0, -1]);
    const gltf = { scene, animations: [new THREE.AnimationClip('Blender_Loop', 4, [track])] };
    const fixture = { gltf, source, track };
    fixtures.push(fixture);
    return fixture;
}

function makePopulation(count = 2) {
    return {
        count,
        positions: new Float32Array(Array.from({ length: count * 3 }, (_, index) => (index % 3) * 8)),
        phases: new Float32Array(Array.from({ length: count }, (_, index) => index * Math.PI)),
        sizes: new Float32Array(count).fill(12),
    };
}

function createModel(gltf, population = makePopulation(), options = {}) {
    const mesh = createOceanJellyfishModels(gltf, population, options);
    models.push(mesh);
    return mesh;
}

describe('Ocean Blender jellyfish population', () => {
    it('bakes transforms into base and morph attributes without mutating the loaded asset', () => {
        const { gltf, source } = makeFixture();
        const originalPosition = source.geometry.attributes.position.array.slice();
        const originalMorph = source.geometry.morphAttributes.position[0].array.slice();
        const originalColor = source.geometry.attributes.color.array.slice();
        const mesh = createModel(gltf);
        const bounds = new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position);
        const size = bounds.getSize(new THREE.Vector3());
        expect(size.y).toBeCloseTo(1);
        expect(Math.max(size.x, size.z)).toBeCloseTo(0.7);
        expect(bounds.getCenter(new THREE.Vector3()).length()).toBeLessThan(1e-6);
        expect(source.geometry.attributes.position.array).toEqual(originalPosition);
        expect(source.geometry.morphAttributes.position[0].array).toEqual(originalMorph);
        expect(mesh.geometry.attributes.color.array).toEqual(originalColor);
        expect(mesh.geometry).not.toBe(source.geometry);

        const worldPositions = source.geometry.attributes.position.clone().applyMatrix4(source.matrixWorld);
        const worldBox = new THREE.Box3().setFromBufferAttribute(worldPositions);
        const worldSize = worldBox.getSize(new THREE.Vector3());
        const worldCenter = worldBox.getCenter(new THREE.Vector3());
        const horizontalScale = 0.7 / Math.max(worldSize.x, worldSize.z);
        const scale = new THREE.Vector3(horizontalScale, 1 / worldSize.y, horizontalScale);
        const original = new THREE.Vector3().fromBufferAttribute(source.geometry.attributes.position, 0);
        const delta = new THREE.Vector3().fromBufferAttribute(source.geometry.morphAttributes.position[0], 0);
        const expected = original.clone().add(delta).applyMatrix4(source.matrixWorld).sub(worldCenter)
            .multiply(scale);
        const actual = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, 0)
            .add(new THREE.Vector3().fromBufferAttribute(mesh.geometry.morphAttributes.position[0], 0));
        expect(actual.distanceTo(expected)).toBeLessThan(1e-6);

        const combined = new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z).multiply(source.matrixWorld);
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(combined);
        const expectedNormal = new THREE.Vector3().fromBufferAttribute(source.geometry.attributes.normal, 0)
            .add(new THREE.Vector3().fromBufferAttribute(source.geometry.morphAttributes.normal[0], 0))
            .applyNormalMatrix(normalMatrix);
        const actualNormal = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.normal, 0)
            .add(new THREE.Vector3().fromBufferAttribute(mesh.geometry.morphAttributes.normal[0], 0)).normalize();
        expect(actualNormal.distanceTo(expectedNormal)).toBeLessThan(1e-6);
    });

    it('samples authored interpolation per instance and loops without altering population buffers', () => {
        const { gltf } = makeFixture();
        const population = makePopulation();
        const positions = population.positions.slice();
        const mesh = createModel(gltf, population);
        // The r186 instanced branch must not create an unbuilt uniform array;
        // its per-instance weights are supplied entirely by the morph texture.
        expect(mesh.morphTargetInfluences).toBeUndefined();
        updateOceanJellyfishModels(mesh, 0.5, 1.2);
        const weights = mesh.morphTexture.image.data.slice();
        expect(mesh.userData.authoredMorphAnimation).toBe(true);
        expect(weights[0]).toBe(1);
        expect(weights[1]).toBeCloseTo(0.25);
        expect(weights[2]).toBeCloseTo(-0.625);
        expect(weights[3]).toBe(1);
        expect(weights[4]).toBeCloseTo(0.75);
        expect(weights[5]).toBeCloseTo(0.125);
        updateOceanJellyfishModels(mesh, 4.5, 1.2);
        expect(mesh.morphTexture.image.data).toEqual(weights);
        expect(population.positions).toEqual(positions);
        expect(mesh.material.userData.uTime.value).toBe(4.5);
        expect(mesh.material.userData.uGlowIntensity.value).toBe(1.2);
        expect(mesh.count).toBe(population.count);
        expect(mesh.boundingSphere.radius).toBeGreaterThan(12);
    });

    it('supports the count=1 uniform morph branch and the classic material fallback', () => {
        const { gltf } = makeFixture();
        const mesh = createModel(gltf, makePopulation(1), { isWebGPU: false });
        updateOceanJellyfishModels(mesh, 0.5);
        expect(mesh.material.type).toBe('MeshStandardMaterial');
        expect(mesh.material.isNodeMaterial).not.toBe(true);
        expect(mesh.material.vertexColors).toBe(true);
        expect(mesh.material.forceSinglePass).toBe(true);
        expect(mesh.morphTargetInfluences).toEqual([0.25, -0.625]);
        expect(mesh.morphTexture.image.data).toEqual(new Float32Array([1, 0.25, -0.625]));
    });

    it('disposes its morph texture and owned resources once while preserving the source asset', () => {
        const { gltf, source } = makeFixture();
        const mesh = createModel(gltf);
        const textureDispose = vi.fn();
        mesh.morphTexture.addEventListener('dispose', textureDispose);
        const geometryDispose = vi.spyOn(mesh.geometry, 'dispose');
        const materialDispose = vi.spyOn(mesh.material, 'dispose');
        const sourceDispose = vi.spyOn(source.geometry, 'dispose');
        const group = new THREE.Group();
        group.add(mesh);
        mesh.userData.dispose();
        disposeOceanJellyfishModels(mesh);
        mesh.userData.update(10, 2);
        expect(textureDispose).toHaveBeenCalledTimes(1);
        expect(geometryDispose).toHaveBeenCalledTimes(1);
        expect(materialDispose).toHaveBeenCalledTimes(1);
        expect(sourceDispose).not.toHaveBeenCalled();
        expect(mesh.morphTexture).toBeNull();
        expect(group.children).toHaveLength(0);
    });

    it('uses analytic motion only without an authored morph track', () => {
        const { source, gltf } = makeFixture();
        const sampler = createOceanMorphSampler(source);
        expect(sampler.authored).toBe(false);
        expect(sampler(0, 0)).toEqual(new Float32Array([0.5, 0]));
        const authored = createOceanMorphSampler(source, gltf.animations[0]);
        expect(authored.authored).toBe(true);
        expect(authored(0, 0)).toEqual(new Float32Array([0, -1]));
    });

    it.each(['jellyfish', 'kelp', 'coral-fan'])('preserves %s GLB timing and interpolation', async (name) => {
        const assetPath = new URL(`../../src/themes/ocean/assets/blender-reef/${name}.glb`, import.meta.url);
        const bytes = await readFile(assetPath);
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const gltf = await new GLTFLoader().parseAsync(buffer, '');
        let source;
        gltf.scene.traverse((child) => { if (child.isMesh) source = child; });
        fixtures.push({ source });
        const [clip] = gltf.animations;
        const [track] = clip.tracks;
        const sampler = createOceanMorphSampler(source, clip);
        const duration = track.times[track.times.length - 1] - track.times[0];
        const reference = track.createInterpolant();
        expect(sampler.authored).toBe(true);
        expect(sampler.startTime).toBeGreaterThan(0);
        expect(sampler.duration).toBe(duration);
        const startWeights = sampler(0).slice();
        expect(sampler(duration)).toEqual(startWeights);
        expect(sampler(0.73)).toEqual(reference.evaluate(track.times[0] + 0.73));
        expect(sampler(0.73, Math.PI)).toEqual(reference.evaluate(track.times[0] + 0.73 + duration * 0.5));
        if (name === 'jellyfish') {
            const mesh = createModel(gltf);
            expect(mesh.userData.authoredMorphAnimation).toBe(true);
            expect(mesh.geometry.attributes.color.itemSize).toBe(4);
            expect(mesh.geometry.index.count / 3).toBe(1408);
        }
    });
});

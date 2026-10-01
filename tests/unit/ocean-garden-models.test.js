import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createOceanGardenModels } from '../../src/themes/ocean/ocean-garden-models.js';
import { loadGltfCached } from '../../src/themes/ocean/ocean-asset-loader.js';
import { getReefSeabedHeight } from '../../src/themes/ocean/ocean-composition.js';

vi.mock('../../src/themes/ocean/ocean-asset-loader.js', () => ({ loadGltfCached: vi.fn() }));
const gardens = [];
const sources = [];
const floor = (x, z) => -22 + x * 0.045 + z * 0.02;

function fixture(url, { triangles = 12, invalid = false } = {}) {
    const id = url.split('/').pop().replace('.glb', '');
    const animated = /anemone|seaweed|grass|pearl/.test(id);
    const geometry = new THREE.BoxGeometry(2, 3, 2);
    geometry.translate(0, 1.5, 0);
    if (triangles !== 12) geometry.setIndex(Array.from({ length: triangles * 3 }, (_, index) => index % 24));
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    colors.fill(0.4);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (invalid) geometry.deleteAttribute('color');
    if (animated) {
        geometry.morphTargetsRelative = true;
        geometry.morphAttributes.position = ['currentSway', 'crossSway'].map((name, axis) => {
            const values = new Float32Array(geometry.attributes.position.count * 3);
            for (let index = 0; index < geometry.attributes.position.count; index += 1) {
                values[index * 3 + axis * 2] = geometry.attributes.position.getY(index) * 0.04;
            }
            const attribute = new THREE.BufferAttribute(values, 3);
            attribute.name = name;
            return attribute;
        });
    }
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true }));
    mesh.name = id;
    mesh.position.set(0.3, 0.2, -0.15);
    mesh.rotation.y = 0.3;
    const scene = new THREE.Group();
    scene.add(mesh);
    const animations = animated ? [new THREE.AnimationClip('AuthoredCurrent', 4, [
        new THREE.NumberKeyframeTrack(`${id}.morphTargetInfluences`, [0, 1, 2, 3, 4], [0, 0, 1, 0, 0, 0, 0, 1, 0, 0]),
    ])] : [];
    const source = {
        mesh,
        positions: geometry.attributes.position.array.slice(),
        colors: geometry.attributes.color?.array.slice(),
        geometryDispose: vi.spyOn(geometry, 'dispose'),
        materialDispose: vi.spyOn(mesh.material, 'dispose'),
    };
    sources.push(source);
    return { scene, animations };
}

async function create(options = {}) {
    if (!vi.mocked(loadGltfCached).getMockImplementation()) vi.mocked(loadGltfCached).mockImplementation(fixture);
    const garden = await createOceanGardenModels({ getSeabedHeight: floor, detailCount: 10, ...options });
    if (garden) gardens.push(garden);
    return garden;
}

afterEach(() => {
    gardens.splice(0).forEach((garden) => garden.dispose());
    sources.length = 0;
    vi.restoreAllMocks();
    vi.mocked(loadGltfCached).mockReset();
});

describe('Ocean Blender habitat populations', () => {
    it('skips all loads at zero detail and respects the medium variant limit', async () => {
        expect(await create({ detailCount: 0 })).toBeNull();
        expect(loadGltfCached).not.toHaveBeenCalled();
        const garden = await create({ detailCount: 6 });
        expect(loadGltfCached).toHaveBeenCalledTimes(6);
        expect(garden.diagnostics.variantCount).toBe(6);
        expect(garden.diagnostics.drawCalls).toBe(6);
        expect(garden.group.children).toHaveLength(6);
        expect(garden.diagnostics.instanceCount).toBe(19);
    });

    it('grounds every base vertex on sloping terrain and preserves the channel and source paint', async () => {
        const garden = await create();
        expect(garden.diagnostics.variantCount).toBe(8);
        expect(garden.diagnostics.instanceCount).toBe(23);
        expect(garden.diagnostics.triangleCount).toBe(23 * 12);
        const matrix = new THREE.Matrix4();
        const point = new THREE.Vector3();
        garden.group.children.forEach((mesh, sourceIndex) => {
            const source = sources[sourceIndex];
            expect(mesh.geometry).not.toBe(source.mesh.geometry);
            expect(mesh.geometry.attributes.color.array).toEqual(source.colors);
            expect(source.mesh.geometry.attributes.position.array).toEqual(source.positions);
            expect(source.geometryDispose).toHaveBeenCalledTimes(1);
            expect(source.materialDispose).toHaveBeenCalledTimes(1);
            expect(mesh.material.vertexColors).toBe(true);
            expect(mesh.material.map).toBeNull();
            for (let instance = 0; instance < mesh.count; instance += 1) {
                mesh.getMatrixAt(instance, matrix);
                expect(Math.abs(matrix.elements[12])).toBeGreaterThan(20);
                for (let vertex = 0; vertex < mesh.geometry.attributes.position.count; vertex += 1) {
                    if (mesh.geometry.attributes.position.getY(vertex) > 0.001) continue;
                    point.fromBufferAttribute(mesh.geometry.attributes.position, vertex).applyMatrix4(matrix);
                    expect(point.y - floor(point.x, point.z)).toBeLessThan(-0.10);
                }
            }
        });
    });

    it('samples closed authored loops with varied phases without moving the roots', async () => {
        const garden = await create();
        const mesh = garden.group.children.find((child) => child.userData.assetId === 'grass-meadow');
        const matrices = mesh.instanceMatrix.array.slice();
        expect(mesh.morphTargetInfluences).toBeUndefined();
        expect(garden.diagnostics.animatedVariants).toBe(4);
        garden.update(0.75, 0.8, 1.2);
        const weights = mesh.morphTexture.image.data.slice();
        expect(weights[1]).not.toBe(weights[4]);
        garden.update(4.75, 0.8, 1.2);
        expect(mesh.morphTexture.image.data).toEqual(weights);
        expect(mesh.instanceMatrix.array).toEqual(matrices);
        expect(mesh.boundingSphere.radius).toBeGreaterThan(0);
        const anemone = garden.group.children.find((child) => child.userData.assetId === 'anemone-lantern');
        expect(anemone.material.userData.gardenGlow.value).toBeCloseTo(0.0548);
        const mask = anemone.geometry.attributes.oceanGardenGlow.array;
        expect(Math.min(...mask)).toBe(0);
        expect(Math.max(...mask)).toBe(1);
    });

    it('keeps all habitats by trimming repeats before exceeding the instance triangle budget', async () => {
        vi.mocked(loadGltfCached).mockImplementation((url) => fixture(url, { triangles: 1000 }));
        const garden = await create();
        expect(garden.diagnostics.variantCount).toBe(8);
        expect(garden.diagnostics.triangleCount).toBe(17000);
        expect(garden.diagnostics.instanceCount).toBe(17);
        expect(garden.diagnostics.assets.every((asset) => asset.count >= (asset.id === 'reef-arch' ? 1 : 2))).toBe(true);
    });

    it('loads all eight actual exports within budget and seats their authored footprints on the real floor', async () => {
        vi.mocked(loadGltfCached).mockImplementation(async (url) => {
            const filename = url.split('/').pop();
            const bytes = readFileSync(new URL(`../../src/themes/ocean/assets/blender-reef/${filename}`, import.meta.url));
            return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
        });
        const garden = await create({ getSeabedHeight: getReefSeabedHeight });
        expect(garden.diagnostics.errors).toEqual([]);
        expect(garden.diagnostics.variantCount).toBe(8);
        expect(garden.diagnostics.instanceCount).toBe(23);
        expect(garden.diagnostics.triangleCount).toBe(14292);
        expect(garden.diagnostics.animatedVariants).toBe(4);
        const matrix = new THREE.Matrix4();
        const point = new THREE.Vector3();
        garden.group.children.forEach((mesh) => {
            const positions = mesh.geometry.attributes.position;
            const bounds = new THREE.Box3().setFromBufferAttribute(positions);
            const band = bounds.min.y + Math.min(0.1, (bounds.max.y - bounds.min.y) * 0.04);
            for (let instance = 0; instance < mesh.count; instance += 1) {
                mesh.getMatrixAt(instance, matrix);
                for (let vertex = 0; vertex < positions.count; vertex += 1) {
                    if (positions.getY(vertex) > band) continue;
                    point.fromBufferAttribute(positions, vertex).applyMatrix4(matrix);
                    expect(point.y - getReefSeabedHeight(point.x, point.z)).toBeLessThan(-0.10);
                }
            }
        });
        garden.update(0.37);
        const weights = garden.group.children.map((mesh) => mesh.morphTexture?.image.data.slice());
        garden.update(4.37);
        garden.group.children.forEach((mesh, index) => {
            if (weights[index]) {
                mesh.morphTexture.image.data.forEach((value, component) => {
                    expect(value).toBeCloseTo(weights[index][component], 6);
                });
            }
        });
    });

    it('reports a failed or invalid asset and still releases every successfully loaded source', async () => {
        vi.mocked(loadGltfCached).mockImplementation((url) => {
            if (url.includes('rosette')) return Promise.reject(new Error('fixture unavailable'));
            return fixture(url, { invalid: url.includes('antler') });
        });
        const garden = await create();
        expect(garden.diagnostics.variantCount).toBe(6);
        expect(garden.diagnostics.errors.map((error) => error.id)).toEqual(['coral-rosette', 'coral-antler']);
        sources.forEach((source) => {
            expect(source.geometryDispose).toHaveBeenCalledTimes(1);
            expect(source.materialDispose).toHaveBeenCalledTimes(1);
        });
    });

    it('rejects an excessive replacement payload and cleans up every loaded asset', async () => {
        vi.mocked(loadGltfCached).mockImplementation((url) => fixture(url, { triangles: 2000 }));
        await expect(create()).rejects.toThrow('17000 triangle budget');
        sources.forEach((source) => expect(source.geometryDispose).toHaveBeenCalledTimes(1));
    });

    it('disposes owned morph textures, meshes and materials once on either backend', async () => {
        const garden = await create({ isWebGPU: false });
        const parent = new THREE.Group();
        parent.add(garden.group);
        const checks = garden.group.children.map((mesh) => ({
            geometry: vi.spyOn(mesh.geometry, 'dispose'),
            material: vi.spyOn(mesh.material, 'dispose'),
            morph: mesh.morphTexture ? vi.spyOn(mesh.morphTexture, 'dispose') : null,
        }));
        expect(garden.group.children.every((mesh) => mesh.material.type === 'MeshStandardMaterial')).toBe(true);
        garden.dispose();
        garden.dispose();
        garden.update(100);
        expect(parent.children).toHaveLength(0);
        checks.forEach((check) => {
            expect(check.geometry).toHaveBeenCalledTimes(1);
            expect(check.material).toHaveBeenCalledTimes(1);
            if (check.morph) expect(check.morph).toHaveBeenCalledTimes(1);
        });
    });
});

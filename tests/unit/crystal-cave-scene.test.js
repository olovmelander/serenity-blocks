import * as THREE from 'three/webgpu';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { createCrystalCaveScene } from '../../src/themes/crystal-cave/crystal-cave-scene.js';

const instances = [];
const suppliedMaterials = [];
const TIERS = [4, 8, 14, 24, 32, 40];
const AUTHORED_HERO_COUNT = 18;

function create(crystalClusters = 24) {
    const scene = new THREE.Scene();
    const materials = Object.fromEntries(
        ['crystal', 'rock', 'water', 'backdrop', 'mist', 'shaft', 'vein']
            .map((key) => [key, new THREE.MeshBasicNodeMaterial()]),
    );
    const world = createCrystalCaveScene({ scene, materials, quality: { crystalClusters } });
    instances.push(world);
    suppliedMaterials.push(...Object.values(materials));
    const crystals = world.group.getObjectByName('Faceted mineral spires');
    return {
        world, scene, materials, crystals,
    };
}

function snapshot(group) {
    const objects = [];
    group.updateMatrixWorld(true);
    group.traverse((object) => {
        if (!object.geometry) return;
        const attributes = Object.fromEntries(Object.entries(object.geometry.attributes)
            .map(([key, attribute]) => [key, Array.from(attribute.array)]));
        objects.push({
            name: object.name,
            attributes,
            indices: Array.from(object.geometry.index?.array ?? []),
            worldMatrix: object.matrixWorld.toArray(),
            instanceMatrices: Array.from(object.instanceMatrix?.array ?? []),
            instanceColors: Array.from(object.instanceColor?.array ?? []),
        });
    });
    return objects;
}

afterEach(() => {
    for (const world of instances) world.dispose();
    instances.length = 0;
    for (const material of suppliedMaterials) material.dispose();
    suppliedMaterials.length = 0;
    vi.restoreAllMocks();
});

describe('Crystal Cave authored geometry', () => {
    it('retains both hero wings and the ceiling pendants at every quality tier', () => {
        const { crystals: low } = create(TIERS[0]);
        const heroMatrices = Array.from(low.instanceMatrix.array.slice(0, AUTHORED_HERO_COUNT * 16));
        const heroColors = Array.from(low.instanceColor.array.slice(0, AUTHORED_HERO_COUNT * 3));
        let previousCount = 0;
        for (const tier of TIERS) {
            const { crystals, world } = create(tier);
            expect(crystals.count).toBeGreaterThan(AUTHORED_HERO_COUNT);
            expect(crystals.count).toBeGreaterThanOrEqual(previousCount);
            expect(world.crystalCount).toBe(crystals.count);
            expect(Array.from(crystals.instanceMatrix.array.slice(0, AUTHORED_HERO_COUNT * 16)))
                .toEqual(heroMatrices);
            expect(Array.from(crystals.instanceColor.array.slice(0, AUTHORED_HERO_COUNT * 3)))
                .toEqual(heroColors);
            const left = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(heroMatrices, 0));
            const rightMatrix = new THREE.Matrix4().fromArray(heroMatrices, 5 * 16);
            const right = new THREE.Vector3().setFromMatrixPosition(rightMatrix);
            expect(left.x).toBeLessThan(-10);
            expect(right.x).toBeGreaterThan(10);
            for (let index = 14; index < AUTHORED_HERO_COUNT; index++) {
                const pendant = new THREE.Matrix4().fromArray(heroMatrices, index * 16);
                expect(new THREE.Vector3().setFromMatrixPosition(pendant).y).toBeGreaterThan(18);
                // A transformed local-up vector points downward for suspended crystals.
                expect(new THREE.Vector3(0, 1, 0).transformDirection(pendant).y).toBeLessThan(-0.8);
            }
            previousCount = crystals.count;
        }
    });

    it.each(TIERS)('has finite, nondegenerate geometry and instance transforms at cluster budget %i', (tier) => {
        const { world } = create(tier);
        world.group.updateMatrixWorld(true);
        world.group.traverse((object) => {
            expect(object.matrixWorld.elements.every(Number.isFinite)).toBe(true);
            if (!object.geometry) return;
            for (const attribute of Object.values(object.geometry.attributes)) {
                expect(Array.from(attribute.array).every(Number.isFinite), object.name).toBe(true);
            }
            const normals = object.geometry.getAttribute('normal');
            expect(normals, object.name).toBeTruthy();
            for (let index = 0; index < normals.count; index++) {
                const length = new THREE.Vector3().fromBufferAttribute(normals, index).length();
                expect(length, `${object.name} normal ${index}`).toBeCloseTo(1, 5);
            }
            if (!object.isInstancedMesh) return;
            expect(Array.from(object.instanceMatrix.array).every(Number.isFinite), object.name).toBe(true);
            for (let index = 0; index < object.count; index++) {
                const matrix = new THREE.Matrix4().fromArray(object.instanceMatrix.array, index * 16);
                expect(Math.abs(matrix.determinant()), `${object.name} transform ${index}`).toBeGreaterThan(1e-8);
            }
            if (object.instanceColor) {
                expect(Array.from(object.instanceColor.array).every(Number.isFinite), object.name).toBe(true);
            }
        });
    });

    it('faces every exterior shaft facet outward and closes the crystal bottom downward', () => {
        const { crystals } = create();
        const positions = crystals.geometry.getAttribute('position');
        const normals = crystals.geometry.getAttribute('normal');
        let checkedShaftTriangles = 0;
        let checkedBottomTriangles = 0;
        for (let index = 0; index < positions.count; index += 3) {
            const a = new THREE.Vector3().fromBufferAttribute(positions, index);
            const b = new THREE.Vector3().fromBufferAttribute(positions, index + 1);
            const c = new THREE.Vector3().fromBufferAttribute(positions, index + 2);
            const normal = new THREE.Vector3().fromBufferAttribute(normals, index);
            if (a.y === 0 && b.y === 0 && c.y === 0) {
                expect(normal.y).toBeLessThan(-0.99);
                checkedBottomTriangles++;
            } else if (Math.max(a.y, b.y, c.y) < 0.9) {
                const radial = a.clone().add(b).add(c).multiplyScalar(1 / 3);
                radial.y = 0;
                expect(normal.dot(radial)).toBeGreaterThan(0);
                checkedShaftTriangles++;
            }
        }
        expect(checkedShaftTriangles).toBe(48);
        expect(checkedBottomTriangles).toBe(12);
    });

    it('keeps event tips clear of the board corridor and the hero tips inside the authored camera', () => {
        const { world } = create();
        const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 500);
        camera.position.set(0, 4, 29);
        camera.lookAt(0, 2, -18);
        camera.updateMatrixWorld(true);
        for (const anchor of world.anchors) {
            expect(anchor.toArray().every(Number.isFinite)).toBe(true);
            expect(Math.abs(anchor.x)).toBeGreaterThanOrEqual(5);
        }
        const heroTips = world.anchors.slice(0, 14);
        expect(heroTips).toHaveLength(14);
        for (const tip of heroTips) {
            const projected = tip.clone().project(camera);
            expect(Math.abs(projected.x)).toBeGreaterThan(0.2);
            expect(Math.abs(projected.x)).toBeLessThan(1);
            expect(Math.abs(projected.y)).toBeLessThan(0.9);
            expect(projected.z).toBeGreaterThan(-1);
            expect(projected.z).toBeLessThan(1);
        }
        const highestTip = heroTips.reduce((highest, tip) => (tip.y > highest.y ? tip : highest));
        expect(highestTip.y).toBeGreaterThan(12);
        expect(highestTip.clone().project(camera).y).toBeLessThan(0.85);
    });

    it('rebuilds the same deterministic geometry, instance colors, transforms and event anchors', () => {
        const first = create(14);
        const second = create(14);
        expect(snapshot(first.world.group)).toEqual(snapshot(second.world.group));
        expect(first.world.anchors.map((anchor) => anchor.toArray()))
            .toEqual(second.world.anchors.map((anchor) => anchor.toArray()));
    });

    it('releases each owned geometry and instanced buffer once while preserving supplied materials', () => {
        const { world, scene, materials } = create();
        const geometries = new Set();
        const buffers = [];
        world.group.traverse((object) => {
            if (object.geometry) geometries.add(object.geometry);
            if (object.isInstancedMesh) buffers.push(vi.spyOn(object, 'dispose'));
        });
        const geometryDisposals = [...geometries].map((geometry) => vi.spyOn(geometry, 'dispose'));
        const materialDisposals = Object.values(materials).map((material) => vi.spyOn(material, 'dispose'));
        const unrelated = new THREE.Group();
        scene.add(unrelated);
        world.dispose();
        world.dispose();
        for (const dispose of [...geometryDisposals, ...buffers]) expect(dispose).toHaveBeenCalledTimes(1);
        for (const dispose of materialDisposals) expect(dispose).not.toHaveBeenCalled();
        expect(world.group.children).toHaveLength(0);
        expect(scene.children).toEqual([unrelated]);
    });
});

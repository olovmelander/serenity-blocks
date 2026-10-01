import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { OceanAtmosphereSystem } from '../../src/themes/ocean/ocean-atmosphere-system.js';
import {
    applyReefComposition,
    composeReefCoralPlacements,
    getReefSeabedHeight,
} from '../../src/themes/ocean/ocean-composition.js';
import { OceanCamera } from '../../src/themes/ocean/ocean-camera.js';

vi.mock('../../src/themes/ocean/ocean-asset-loader.js', () => ({ loadGltfCached: vi.fn() }));

const systems = [];
afterEach(() => {
    systems.forEach((system) => system.dispose());
    systems.length = 0;
    vi.restoreAllMocks();
});

function createAuthoredFormations() {
    vi.spyOn(Math, 'random').mockReturnValue(0.43);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(54, 16 / 9, 0.5, 350);
    const system = new OceanAtmosphereSystem({
        scene,
        camera,
        preset: { atmosphere: { reefWallCount: 5, foregroundRockCount: 11, coralOvergrowthPerRock: 0 } },
        getSeabedHeight: getReefSeabedHeight,
        isWebGPU: false,
    });
    scene.add(system.group);
    systems.push(system);
    system.createHeroReefWalls();
    system.createForegroundRocks();
    return system;
}

function footprintGaps(root) {
    root.updateWorldMatrix(true, true);
    const point = new THREE.Vector3();
    const samples = [];
    root.traverse((child) => {
        const positions = child.geometry?.attributes?.position;
        if (!positions) return;
        for (let index = 0; index < positions.count; index += 1) {
            point.fromBufferAttribute(positions, index).applyMatrix4(child.matrixWorld);
            samples.push({ height: point.y, gap: point.y - getReefSeabedHeight(point.x, point.z) });
        }
    });
    const min = Math.min(...samples.map(({ height }) => height));
    const max = Math.max(...samples.map(({ height }) => height));
    const top = min + Math.min(2.2, (max - min) * 0.07);
    return samples.filter(({ height }) => height <= top + 1e-8).map(({ gap }) => gap);
}

describe('Ocean reef composition', () => {
    it('keeps the entire rendered floor submerged and the far edge below the near reef shelves', () => {
        for (let x = -200; x <= 200; x += 5) {
            for (let z = -200; z <= 200; z += 5) {
                const height = getReefSeabedHeight(x, z);
                expect(height).toBeGreaterThan(-31);
                expect(height).toBeLessThan(-6);
            }
            expect(getReefSeabedHeight(x, -200)).toBeLessThan(-19);
        }
        expect(getReefSeabedHeight(0, 25)).toBeLessThan(getReefSeabedHeight(-58, 25));
        expect(getReefSeabedHeight(0, 25)).toBeLessThan(getReefSeabedHeight(64, 25));
    });

    it('seats all authored reef and rock footprints without changing geometry or drifting on later frames', () => {
        const system = createAuthoredFormations();
        const roots = [...system.heroReefWalls, ...system.foregroundRocks];
        const transforms = roots.map((root) => ({ position: root.position.toArray(), scale: root.scale.toArray() }));
        const geometryCounts = roots.map((root) => {
            let vertices = 0;
            root.traverse((child) => { vertices += child.geometry?.attributes?.position?.count ?? 0; });
            return vertices;
        });
        for (let frame = 0; frame < 10; frame += 1) system.update(frame / 60, { skipBillboards: true });
        roots.forEach((root, index) => {
            const gaps = footprintGaps(root);
            expect(gaps.length).toBeGreaterThan(0);
            expect(Math.max(...gaps)).toBeLessThanOrEqual(index < 5 ? -0.999 : -0.649);
            expect(root.position.toArray()).toEqual(transforms[index].position);
            expect(root.scale.toArray()).toEqual(transforms[index].scale);
            let vertices = 0;
            root.traverse((child) => { vertices += child.geometry?.attributes?.position?.count ?? 0; });
            expect(vertices).toBe(geometryCounts[index]);
        });
        expect(system.heroReefWalls[2].position.x).toBe(-62);
    });

    it('grounds a deferred replacement even when its transforms were frozen before insertion', () => {
        const root = new THREE.Group();
        const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(3, 1), new THREE.MeshBasicMaterial());
        root.add(mesh);
        root.position.set(38, getReefSeabedHeight(38, -58) + 9, -58);
        root.traverse((child) => {
            child.updateMatrix();
            child.matrixAutoUpdate = false;
        });
        const atmosphere = { heroReefWalls: [root] };
        applyReefComposition(atmosphere);
        expect(Math.max(...footprintGaps(root))).toBeLessThanOrEqual(-0.999);
        const position = root.position.toArray();
        const scale = root.scale.toArray();
        applyReefComposition(atmosphere);
        expect(root.position.toArray()).toEqual(position);
        expect(root.scale.toArray()).toEqual(scale);
        mesh.geometry.dispose();
        mesh.material.dispose();
    });

    it('composes each coral instance before batching and never shifts the shared mesh root', () => {
        const source = [
            {
                index: 0, x: -26, y: getReefSeabedHeight(-26, 34), z: 34, scale: 2.5,
            },
            {
                index: 1, x: 28, y: getReefSeabedHeight(28, 32), z: 32, scale: 3,
            },
        ];
        const composed = composeReefCoralPlacements(source);
        expect(composed.map(({ x, z }) => [x, z])).toEqual([[-28, 24], [32, 20]]);
        expect(composed[0].y).toBe(getReefSeabedHeight(-28, 24));
        expect(source[0].x).toBe(-26);
        const batch = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 2);
        const dummy = new THREE.Object3D();
        composed.forEach((placement, index) => {
            dummy.position.set(placement.x, placement.y, placement.z);
            dummy.scale.setScalar(placement.scale);
            dummy.updateMatrix();
            batch.setMatrixAt(index, dummy.matrix);
        });
        const before = batch.instanceMatrix.array.slice();
        applyReefComposition({ heroCorals: [batch, batch] });
        expect(batch.position.toArray()).toEqual([0, 0, 0]);
        expect(batch.scale.toArray()).toEqual([1, 1, 1]);
        expect(batch.instanceMatrix.array).toEqual(before);
        batch.geometry.dispose();
        batch.material.dispose();
    });

    it('preserves mood and impulse behavior within the restrained camera framing', () => {
        const camera = new THREE.PerspectiveCamera(54, 16 / 9, 0.5, 350);
        const rig = new OceanCamera(camera);
        rig.nextSwitchAt = Infinity;
        rig.setPointer(1, -1);
        rig.requestImpulseMood('cathedral', 4);
        for (let frame = 1; frame <= 180; frame += 1) rig.update(1 / 60, frame / 60);
        expect(camera.fov).toBeCloseTo(52);
        expect(Math.abs(camera.position.x)).toBeLessThan(14.3);
        expect(rig.holdMood).toBe('cathedral');
        rig.applyShakeImpulse(0.8, 240);
        rig.update(1 / 60, 3.1);
        expect(rig.shakeMagnitude).toBeGreaterThan(0);
        expect(rig.targetMood).toBe('cathedral');
        rig.requestImpulseMood('trail', 4);
        for (let frame = 181; frame <= 360; frame += 1) rig.update(1 / 60, frame / 60);
        expect(camera.fov).toBeCloseTo(57);
        for (let frame = 361; frame <= 720; frame += 1) rig.update(1 / 60, frame / 60);
        expect(camera.fov).toBeCloseTo(54);
        expect(rig.holdMood).toBeNull();
        expect(rig.shakeMagnitude).toBe(0);
        rig.dispose();
    });
});

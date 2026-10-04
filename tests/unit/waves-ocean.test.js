import * as THREE from 'three/webgpu';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { OCEAN_TIERS, WavesOcean } from '../../src/themes/waves/waves-ocean.js';
import { WAVES_REACTION_LIMITS, WavesReactions } from '../../src/themes/waves/waves-reactions.js';
import { WavesPost } from '../../src/themes/waves/waves-post.js';

const owned = [];

function createOcean(quality = 'High', aspect = 16 / 9) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 240);
    const ocean = new WavesOcean({
        scene, camera, quality, rng: () => 0.5,
    }).build();
    owned.push(ocean);
    return { scene, camera, ocean };
}

function drawables(scene) {
    const meshes = [];
    scene.traverse((object) => { if (object.isMesh) meshes.push(object); });
    return meshes;
}

function resources(ocean) {
    const result = new Set([ocean.noise]);
    ocean.group.traverse((object) => {
        if (object.geometry) result.add(object.geometry);
        if (object.material) result.add(object.material);
    });
    return result;
}

afterEach(() => {
    owned.splice(0).forEach((resource) => resource.dispose());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('Waves ocean scene contracts', () => {
    it.each(Object.keys(OCEAN_TIERS))('retains the complete instanced surf scene at %s', (quality) => {
        const { scene, ocean } = createOcean(quality);
        const meshes = drawables(scene);
        const water = meshes.filter((mesh) => mesh.name === 'waves-sculpted-barrel');
        const spray = meshes.filter((mesh) => mesh.name === 'waves-salt-spray');
        const rings = meshes.filter((mesh) => mesh.name === 'waves-surface-impact-rings');
        expect(water).toHaveLength(1);
        expect(spray).toHaveLength(1);
        expect(rings).toHaveLength(1);
        expect(water[0].material.transparent).toBe(false);
        expect(spray[0].geometry.isInstancedBufferGeometry).toBe(true);
        expect(spray[0].geometry.instanceCount).toBe(OCEAN_TIERS[quality].spray);
        expect(spray[0].geometry.getAttribute('aSeed').count).toBe(OCEAN_TIERS[quality].spray);
        expect(rings[0].geometry.isInstancedBufferGeometry).toBe(true);
        expect(rings[0].geometry.instanceCount).toBe(WAVES_REACTION_LIMITS[quality]);
        expect(ocean.impactData).toHaveLength(WAVES_REACTION_LIMITS[quality]);
        for (const mesh of meshes) {
            expect(mesh.material.isNodeMaterial).toBe(true);
            expect(mesh.material.isShaderMaterial).not.toBe(true);
            expect(mesh.material.emissiveNode?.isNode).toBe(true);
            expect(mesh.frustumCulled).toBe(false);
        }
    });

    it('keeps sparse director slot IDs attached to the correct surface ring and clears retired slots', () => {
        const { ocean } = createOcean();
        const reactions = new WavesReactions({ quality: 'High', rng: () => 0.5 });
        for (let event = 0; event < 5; event++) {
            reactions.onPieceLock();
            reactions.update(0.1);
        }
        reactions.update(0.3);
        const frame = reactions.getFrame();
        expect(frame.impacts.length).toBeGreaterThan(0);
        expect(frame.impacts[0].id).toBeGreaterThan(0);
        ocean.update(reactions.time, 0.3, frame);
        for (const impact of frame.impacts) {
            const value = ocean.impactData[impact.id];
            expect(value.x).toBe(impact.angle);
            expect(value.y).toBe(impact.z);
            expect(value.z).toBeCloseTo(impact.progress, 10);
            expect(value.w).toBe(impact.strength);
        }
        expect(ocean.impactData[0].w).toBe(0);
        reactions.reset();
        ocean.update(0, 0, reactions.getFrame());
        for (const value of ocean.impactData) {
            expect(value.w).toBe(0);
            expect(value.toArray().every(Number.isFinite)).toBe(true);
        }
        for (const key of ['pulse', 'foam', 'spray', 'shafts', 'surgeStrength']) {
            expect(ocean[key].value).toBe(0);
        }
        expect(Number.isFinite(ocean.surgeZ.value)).toBe(true);
    });

    it('updates a frozen time without adding objects or reallocating scene resources', () => {
        const { scene, ocean } = createOcean('Low');
        const reactions = new WavesReactions({ quality: 'Low', rng: () => 0.5 });
        const originalMeshes = drawables(scene);
        const originalResources = resources(ocean);
        const originalSlots = ocean.impactData;
        for (let frame = 0; frame < 100; frame++) {
            if (frame % 10 === 0) {
                reactions.onLineClear(4);
                reactions.onCombo(8);
            }
            ocean.update(8, 1 / 60, reactions.update(1 / 60));
            for (const key of ['time', 'pulse', 'foam', 'spray', 'shafts', 'surgeStrength', 'surgeZ']) {
                expect(Number.isFinite(ocean[key].value)).toBe(true);
            }
        }
        expect(drawables(scene)).toEqual(originalMeshes);
        expect(resources(ocean)).toEqual(originalResources);
        expect(ocean.impactData).toBe(originalSlots);
        ocean.dispose();
        expect(scene.children).toHaveLength(0);
    });

    it('disposes its density texture, materials and geometries exactly once', () => {
        const { scene, ocean } = createOcean('Minimal');
        const ownedResources = resources(ocean);
        const disposals = [...ownedResources].map((resource) => vi.spyOn(resource, 'dispose'));
        expect(ocean.noise.isDataTexture).toBe(true);
        expect(ocean.noise.wrapS).toBe(THREE.RepeatWrapping);
        expect(ocean.noise.wrapT).toBe(THREE.RepeatWrapping);
        expect(ocean.noise.colorSpace).toBe(THREE.NoColorSpace);
        ocean.dispose();
        ocean.dispose();
        expect(scene.children).toHaveLength(0);
        disposals.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
    });

    it.each([
        {
            name: 'desktop',
            width: 1440,
            height: 900,
            board: {
                left: 545, top: 76, width: 350, height: 762,
            },
        },
        {
            name: 'portrait',
            width: 390,
            height: 844,
            board: {
                left: 73, top: 190, width: 244, height: 464,
            },
        },
        {
            name: 'production phone',
            width: 390,
            height: 844,
            board: {
                left: 21.5, top: 45, width: 347, height: 756,
            },
        },
    ])('keeps the $name aperture visible outside the gameplay board', ({ width, height, board }) => {
        const { camera, ocean } = createOcean('Minimal', width / height);
        vi.stubGlobal('document', {
            querySelector: () => ({ getBoundingClientRect: () => board }),
        });
        vi.stubGlobal('window', { innerHeight: height });
        ocean.update(0, 0);
        camera.updateMatrixWorld(true);
        // Project the far barrel aperture, independently of the camera's chosen yaw/FOV.
        const aperture = new THREE.Vector3(7, 1.2, 46).project(camera);
        expect(Math.abs(aperture.x)).toBeLessThan(0.9);
        expect(Math.abs(aperture.y)).toBeLessThan(0.99);
        expect(aperture.z).toBeGreaterThan(-1);
        expect(aperture.z).toBeLessThan(1);
        const screen = {
            x: ((aperture.x + 1) / 2) * width,
            y: ((1 - aperture.y) / 2) * height,
        };
        const covered = screen.x >= board.left && screen.x <= board.left + board.width
            && screen.y >= board.top && screen.y <= board.top + board.height;
        expect(covered).toBe(false);
        if (width < height) expect(screen.y).toBeLessThan(board.top);
    });
});

describe('Waves post tier ownership', () => {
    it.each(['Low', 'Minimal'])('uses no blur pipeline or offscreen scene targets at %s', (quality) => {
        const renderer = {
            toneMapping: THREE.NoToneMapping,
            toneMappingExposure: 0.75,
            render: vi.fn(),
        };
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera();
        const post = new WavesPost({
            renderer, scene, camera, quality,
        });
        owned.push(post);
        expect(post.pipeline).toBeNull();
        expect(post.scenePass).toBeNull();
        expect(post.bloomNode).toBeNull();
        const reactions = new WavesReactions({ quality, rng: () => 0.5 });
        reactions.onCombo(8);
        post.update(reactions.frame);
        post.render();
        expect(renderer.render).toHaveBeenCalledWith(scene, camera);
        expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
        expect(renderer.toneMappingExposure).toBe(0.75);
        post.dispose();
        post.render();
        expect(renderer.render).toHaveBeenCalledOnce();
    });

    it('restores the owner renderer output settings when a direct ocean render fails', () => {
        const renderer = {
            toneMapping: THREE.NoToneMapping,
            toneMappingExposure: 0.75,
            render: vi.fn(() => { throw new Error('device lost'); }),
        };
        const post = new WavesPost({
            renderer,
            scene: new THREE.Scene(),
            camera: new THREE.PerspectiveCamera(),
            quality: 'Low',
        });
        owned.push(post);
        expect(() => post.render()).toThrow('device lost');
        expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
        expect(renderer.toneMappingExposure).toBe(0.75);
    });
});

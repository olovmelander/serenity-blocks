import * as THREE from 'three/webgpu';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import {
    DRIFT_TIERS,
    createDriftNoise,
    createGasGiantTexture,
    StellarDriftAtmosphere,
} from '../../src/themes/stellar-drift/stellar-drift-atmosphere.js';
import {
    STELLAR_DRIFT_REACTION_LIMITS,
    StellarDriftReactions,
} from '../../src/themes/stellar-drift/stellar-drift-reactions.js';
import { StellarDriftPost } from '../../src/themes/stellar-drift/stellar-drift-post.js';

const owned = [];

function createAtmosphere(quality = 'High', aspect = 16 / 9) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, aspect, 0.1, 500);
    const atmosphere = new StellarDriftAtmosphere({
        scene, camera, quality, rng: () => 0.5,
    }).build();
    owned.push(atmosphere);
    return { scene, camera, atmosphere };
}

function meshes(scene) {
    const result = [];
    scene.traverse((object) => { if (object.isMesh) result.push(object); });
    return result;
}

function resources(atmosphere) {
    const result = new Set([atmosphere.noise, atmosphere.planetMap]);
    atmosphere.group.traverse((object) => {
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

describe('Stellar Drift orbital scene contracts', () => {
    it('preserves the same deterministic density and cloud belts when texture resolution changes', () => {
        for (const [factory, size, samples] of [
            [createDriftNoise, 64, [[0, 0], [13, 42], [63, 63]]],
            [createGasGiantTexture, 128, [[0, 0], [21, 39], [127, 63]]],
        ]) {
            const low = factory(size);
            const high = factory(size * 2);
            try {
                for (const [x, y] of samples) {
                    const a = (y * size + x) * 4;
                    const b = (y * 2 * size * 2 + x * 2) * 4;
                    expect(Array.from(low.image.data.slice(a, a + 4)))
                        .toEqual(Array.from(high.image.data.slice(b, b + 4)));
                }
            } finally { low.dispose(); high.dispose(); }
        }
    });

    it('retains a complete node scene and bounded star, dust, debris and comet pools in every tier', () => {
        for (const [quality, tier] of Object.entries(DRIFT_TIERS)) {
            const { scene, atmosphere } = createAtmosphere(quality);
            const limits = STELLAR_DRIFT_REACTION_LIMITS[quality];
            const drawables = meshes(scene);
            for (const [name, count] of [
                ['stellar-drift-starfield', tier.stars],
                ['stellar-drift-ice-debris', tier.rocks],
                ['stellar-drift-ring-dust', tier.dust],
            ]) {
                const family = drawables.filter((mesh) => mesh.name === name);
                expect(family).toHaveLength(1);
                expect(family[0].geometry.isInstancedBufferGeometry).toBe(true);
                expect(family[0].geometry.instanceCount).toBe(count);
                expect(family[0].geometry.getAttribute('aSeed').count).toBe(count);
            }
            for (const name of ['stellar-drift-cloud-planet', 'stellar-drift-atmosphere',
                'stellar-drift-fine-rings', 'stellar-drift-auroral-curtains',
                'stellar-drift-distant-moon', 'stellar-drift-inner-moon']) {
                expect(drawables.filter((mesh) => mesh.name === name)).toHaveLength(1);
            }
            for (const [name, count] of [
                ['stellar-drift-orbital-event-arcs', limits.arcs],
                ['stellar-drift-curved-event-comets', limits.comets],
                ['stellar-drift-contact-coronas', limits.comets],
            ]) {
                const mesh = drawables.find((entry) => entry.name === name);
                expect(mesh.geometry.instanceCount).toBe(count);
            }
            expect(atmosphere.effects.arcData).toHaveLength(limits.arcs);
            expect(atmosphere.effects.cometData).toHaveLength(limits.comets);
            expect(atmosphere.effects.cometTargetVectors).toHaveLength(limits.comets);
            for (const mesh of drawables) {
                expect(mesh.material.isNodeMaterial).toBe(true);
                expect(mesh.material.isShaderMaterial).not.toBe(true);
                expect(mesh.material.emissiveNode?.isNode).toBe(true);
            }
            atmosphere.dispose();
            expect(scene.children).toHaveLength(0);
        }
    });

    it('keeps render resources and uniform slot storage stable through repeated event storms', () => {
        const { scene, atmosphere } = createAtmosphere('Low');
        const reactions = new StellarDriftReactions({ quality: 'Low', rng: () => 0.5 });
        const originalMeshes = meshes(scene);
        const originalResources = resources(atmosphere);
        const arcs = [...atmosphere.effects.arcData];
        const comets = [...atmosphere.effects.cometData];
        const targets = [...atmosphere.effects.cometTargetVectors];
        const tangents = [...atmosphere.effects.cometTangentVectors];
        for (let frame = 0; frame < 180; frame++) {
            if (frame % 5 === 0) {
                reactions.onPieceLock();
                reactions.onLineClear(4);
                reactions.onCombo(12);
            }
            atmosphere.update(8, 1 / 60, reactions.update(1 / 60));
        }
        expect(meshes(scene)).toEqual(originalMeshes);
        expect(resources(atmosphere)).toEqual(originalResources);
        for (const [current, original] of [[atmosphere.effects.arcData, arcs],
            [atmosphere.effects.cometData, comets], [atmosphere.effects.cometTargetVectors, targets],
            [atmosphere.effects.cometTangentVectors, tangents]]) {
            current.forEach((value, index) => expect(value).toBe(original[index]));
        }
        atmosphere.dispose();
        expect(scene.children).toHaveLength(0);
    });

    it('disposes both textures and every material/geometry once, including the shared moon material', () => {
        const { scene, atmosphere } = createAtmosphere('Minimal');
        const moon = scene.getObjectByName('stellar-drift-distant-moon');
        const inner = scene.getObjectByName('stellar-drift-inner-moon');
        expect(inner.material).toBe(moon.material);
        const ownedResources = resources(atmosphere);
        const disposals = [...ownedResources].map((resource) => vi.spyOn(resource, 'dispose'));
        expect(atmosphere.noise.isDataTexture).toBe(true);
        expect(atmosphere.planetMap.isDataTexture).toBe(true);
        expect(atmosphere.noise).not.toBe(atmosphere.planetMap);
        expect(atmosphere.noise.colorSpace).toBe(THREE.NoColorSpace);
        expect(atmosphere.noise.wrapS).toBe(THREE.RepeatWrapping);
        expect(atmosphere.noise.wrapT).toBe(THREE.RepeatWrapping);
        atmosphere.dispose();
        atmosphere.dispose();
        expect(scene.children).toHaveLength(0);
        expect(atmosphere.group.children).toHaveLength(0);
        disposals.forEach((disposal) => expect(disposal).toHaveBeenCalledOnce());
    });

    it('maps sparse active event IDs into their own uniform slots and clears them on reset', () => {
        const { atmosphere } = createAtmosphere('High');
        const arcId = atmosphere.effects.arcData.length - 1;
        const cometId = atmosphere.effects.cometData.length - 1;
        atmosphere.update(8, 1 / 60, {
            arcs: [{
                id: arcId, active: true, angle: 1.1, progress: 0.4, direction: -1, strength: 0.6,
            }],
            comets: [{
                id: cometId, active: true, angle: 2.1, progress: 0.3, strength: 0.7, seed: 0.4,
            }],
        });
        expect(atmosphere.effects.arcData[arcId].y).toBeGreaterThan(0);
        expect(atmosphere.effects.arcData[0].y).toBe(0);
        expect(atmosphere.effects.cometData[cometId].x).toBe(0.3);
        expect(atmosphere.effects.cometData[cometId].y).toBe(0.7);
        expect(atmosphere.effects.cometData[cometId].z).toBe(0.4);
        expect(atmosphere.effects.cometData[0].y).toBe(0);
        atmosphere.update(0, 0, new StellarDriftReactions().frame);
        expect(atmosphere.effects.arcData.every((entry) => entry.y === 0)).toBe(true);
        expect(atmosphere.effects.cometData.every((entry) => entry.y === 0)).toBe(true);
        for (const entry of [...atmosphere.effects.arcData, ...atmosphere.effects.cometData,
            ...atmosphere.effects.cometTargetVectors, ...atmosphere.effects.cometTangentVectors]) {
            expect(entry.toArray().every(Number.isFinite)).toBe(true);
        }
    });

    it('keeps time and event envelopes finite after invalid input and a director reset', () => {
        const { atmosphere } = createAtmosphere('Minimal');
        atmosphere.update(NaN, Infinity, {
            rim: NaN, aurora: Infinity, dust: -Infinity, stars: -1, glow: 2, impact: 0.4,
        });
        expect(atmosphere.time.value).toBe(0);
        for (const key of ['rim', 'aurora', 'dust', 'stars', 'glow', 'impact']) {
            expect(Number.isFinite(atmosphere[key].value)).toBe(true);
            expect(atmosphere[key].value).toBeGreaterThanOrEqual(0);
            expect(atmosphere[key].value).toBeLessThanOrEqual(1);
        }
        const reactions = new StellarDriftReactions({ quality: 'Minimal', rng: () => 0.5 });
        reactions.onCombo(8);
        atmosphere.update(8, 0.5, reactions.update(0.5));
        reactions.reset();
        atmosphere.update(0, 0, reactions.frame);
        for (const key of ['rim', 'aurora', 'dust', 'stars', 'glow', 'impact']) {
            expect(atmosphere[key].value).toBe(0);
        }
    });

    it('smooths pointer camera travel and keeps near/far parallax bounded', () => {
        const { atmosphere, camera } = createAtmosphere('Minimal');
        atmosphere.resize(1440, 900);
        atmosphere.update(8, 0, {});
        const center = camera.position.clone();
        atmosphere.setPointer(1, 1);
        atmosphere.update(8, 1 / 60, {});
        expect(camera.position.distanceTo(center)).toBeGreaterThan(0);
        expect(camera.position.distanceTo(center)).toBeLessThan(0.3);
        for (let i = 0; i < 120; i++) atmosphere.update(8, 1 / 60, {});
        expect(camera.position.x - center.x).toBeCloseTo(2.2, 3);
        expect(camera.position.y - center.y).toBeCloseTo(1.1, 3);
        atmosphere.setPointer(NaN, Infinity);
        for (let i = 0; i < 120; i++) atmosphere.update(8, 1 / 60, {});
        expect(camera.position.distanceTo(center)).toBeLessThan(0.0001);
    });

    it.each([[390, 844], [844, 390], [1440, 900], [3440, 1440]])('covers %sx%s', (width, height) => {
        const { atmosphere } = createAtmosphere('Minimal');
        atmosphere.resize(width, height);
        const { sky } = atmosphere.backdrop;
        expect(sky.material.vertexNode.isNode).toBe(true);
        expect(sky.frustumCulled).toBe(false);
        expect(sky.material.depthTest).toBe(false);
        expect(atmosphere.backdrop.aspect.value).toBe(width / height);
        expect(atmosphere.viewHalfWidth.value / atmosphere.viewHalfHeight.value).toBe(width / height);
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
                left: 73, top: 101, width: 244, height: 642,
            },
        },
    ])('keeps a visible planetary horizon outside the $name board', ({ width, height, board }) => {
        const { camera, atmosphere } = createAtmosphere('Minimal', width / height);
        atmosphere.resize(width, height, board);
        atmosphere.group.updateMatrixWorld(true);
        camera.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(atmosphere.planet);
        const projected = [];
        for (const x of [bounds.min.x, bounds.max.x]) {
            for (const y of [bounds.min.y, bounds.max.y]) {
                for (const z of [bounds.min.z, bounds.max.z]) {
                    const point = new THREE.Vector3(x, y, z).project(camera);
                    projected.push({ x: ((point.x + 1) / 2) * width, y: ((1 - point.y) / 2) * height });
                }
            }
        }
        const left = Math.max(0, Math.min(...projected.map((point) => point.x)));
        const right = Math.min(width, Math.max(...projected.map((point) => point.x)));
        const top = Math.max(0, Math.min(...projected.map((point) => point.y)));
        const bottom = Math.min(height, Math.max(...projected.map((point) => point.y)));
        expect(right - left).toBeGreaterThan(40);
        expect(bottom - top).toBeGreaterThan(20);
        if (width > height) {
            const center = atmosphere.hero.getWorldPosition(new THREE.Vector3()).project(camera);
            expect(((center.x + 1) / 2) * width).toBeLessThan(board.left - 30);
        } else {
            expect(Math.min(bottom, board.top) - top).toBeGreaterThan(20);
        }
    });
});

describe('Stellar Drift post ownership', () => {
    it.each(['Low', 'Minimal'])('renders directly without offscreen or bloom allocation at %s', (quality) => {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera();
        const renderer = { toneMapping: THREE.NoToneMapping, toneMappingExposure: 0.75, render: vi.fn() };
        const post = new StellarDriftPost({
            renderer, scene, camera, quality,
        });
        owned.push(post);
        expect(post.pipeline).toBeNull();
        expect(post.scenePass).toBeNull();
        expect(post.bloomNode).toBeNull();
        post.update({ glow: 1, aurora: 1 });
        post.render();
        expect(renderer.render).toHaveBeenCalledWith(scene, camera);
        expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
        expect(renderer.toneMappingExposure).toBe(0.75);
        post.dispose();
        post.dispose();
        post.render();
        expect(renderer.render).toHaveBeenCalledOnce();
    });

    it('restores tone mapping and exposure when the direct render throws', () => {
        const renderer = {
            toneMapping: THREE.NoToneMapping,
            toneMappingExposure: 0.75,
            render: vi.fn(() => { throw new Error('device lost'); }),
        };
        const post = new StellarDriftPost({
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

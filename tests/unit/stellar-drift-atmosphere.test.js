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
    STELLAR_DRIFT_COMET_CONTACT,
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

function contact(id, angle, impactAge) {
    return {
        id,
        angle,
        impactAge,
        active: true,
        impacted: true,
        progress: 0.8,
        strength: 0.7,
        seed: 0.5,
    };
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
            expect(drawables.filter((mesh) => mesh.name.startsWith('stellar-drift-pooled-comet-')))
                .toHaveLength(limits.comets);
            expect(atmosphere.arcVectors).toHaveLength(limits.arcs);
            expect(atmosphere.cometVectors).toHaveLength(limits.comets);
            expect(atmosphere.cometTargetVectors).toHaveLength(limits.comets);
            expect(atmosphere.cometApproachVectors).toHaveLength(limits.comets);
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
        const arcs = [...atmosphere.arcVectors];
        const comets = [...atmosphere.cometVectors];
        const targets = [...atmosphere.cometTargetVectors];
        const approaches = [...atmosphere.cometApproachVectors];
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
        for (const [current, original] of [[atmosphere.arcVectors, arcs],
            [atmosphere.cometVectors, comets], [atmosphere.cometTargetVectors, targets],
            [atmosphere.cometApproachVectors, approaches]]) {
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
        const arcId = atmosphere.arcVectors.length - 1;
        const cometId = atmosphere.cometVectors.length - 1;
        atmosphere.update(8, 1 / 60, {
            arcs: [{
                id: arcId, active: true, angle: 1.1, progress: 0.4, direction: -1, strength: 0.6,
            }],
            comets: [{
                id: cometId, active: true, angle: 2.1, progress: 0.3, strength: 0.7, seed: 0.4,
            }],
        });
        expect(atmosphere.arcVectors[arcId].z).toBeGreaterThan(0);
        expect(atmosphere.arcVectors[0].z).toBe(0);
        expect(atmosphere.cometVectors[cometId].x).toBe(0.3);
        expect(atmosphere.cometVectors[cometId].y).toBe(2.1);
        expect(atmosphere.cometVectors[cometId].z).toBe(0.7);
        expect(atmosphere.cometVectors[0].z).toBe(0);
        atmosphere.update(0, 0, new StellarDriftReactions().frame);
        expect(atmosphere.arcVectors.every((entry) => entry.z === 0)).toBe(true);
        expect(atmosphere.cometVectors.every((entry) => entry.z === 0)).toBe(true);
        for (const entry of [...atmosphere.arcVectors, ...atmosphere.cometVectors,
            ...atmosphere.cometTargetVectors, ...atmosphere.cometApproachVectors]) {
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

    it('places comet targets on the visible planet tangent and keeps contact on the newest impact', () => {
        const { camera, atmosphere } = createAtmosphere('High');
        const newest = contact(0, 2.1, 0.02);
        const older = contact(atmosphere.maxComets - 1, 0.7, 0.25);
        atmosphere.update(8, 0.02, { impact: 0.7, comets: [newest, older] });
        atmosphere.group.updateMatrixWorld(true);
        const { radius } = atmosphere.planet.geometry.parameters;
        const localCamera = atmosphere.hero.worldToLocal(camera.getWorldPosition(new THREE.Vector3()));
        for (const comet of [newest, older]) {
            const target = atmosphere.cometTargetVectors[comet.id];
            expect(target.length()).toBeCloseTo(radius, 5);
            // A tangent surface normal is perpendicular to the view ray at contact.
            expect(target.dot(localCamera.clone().sub(target))).toBeCloseTo(0, 4);
        }
        const latestTarget = atmosphere.cometTargetVectors[newest.id];
        expect(atmosphere.impactMesh.position.distanceTo(latestTarget)).toBeLessThan(0.1);
        expect(atmosphere.impactMesh.position.dot(latestTarget)).toBeGreaterThan(latestTarget.lengthSq());
        const position = atmosphere.impactMesh.position.clone();
        atmosphere.update(8.01, 0.01, { impact: 0.6, comets: [older, newest] });
        expect(atmosphere.impactMesh.position.distanceTo(position)).toBeLessThan(0.00001);
        atmosphere.update(8.02, 0.01, { impact: 0.5, comets: [] });
        expect(atmosphere.impactMesh.position.distanceTo(position)).toBeLessThan(0.00001);
    });

    it('keeps every comet approach outside the planet through its visible tangent contact', () => {
        for (const [width, height, board] of [
            [1440, 900, {
                left: 545, top: 76, width: 350, height: 762,
            }],
            [390, 844, {
                left: 73, top: 101, width: 244, height: 642,
            }],
        ]) {
            const { atmosphere } = createAtmosphere('Minimal', width / height);
            atmosphere.resize(width, height, board);
            const { radius } = atmosphere.planet.geometry.parameters;
            expect(atmosphere.cometApproaches.array).toBe(atmosphere.cometApproachVectors);
            expect(atmosphere.cometTargets.array).toBe(atmosphere.cometTargetVectors);
            for (let quadrant = 0; quadrant < 16; quadrant++) {
                for (const direction of [-1, 1]) {
                    for (const seed of [0, 0.5, 1]) {
                        for (const progress of [0, 0.1, 0.35, 0.6, 0.68, STELLAR_DRIFT_COMET_CONTACT]) {
                            atmosphere.update(8, 0, {
                                comets: [{
                                    id: 0,
                                    active: true,
                                    angle: (quadrant * Math.PI) / 8,
                                    direction,
                                    seed,
                                    progress,
                                    strength: 0.7,
                                }],
                            });
                            const target = atmosphere.cometTargets.array[0];
                            const approach = atmosphere.cometApproaches.array[0];
                            expect(target.dot(approach)).toBeGreaterThan(0);
                            // Sample the uploaded trajectory contract, including the old
                            // failure at progress .68 on the bottom planetary limb.
                            const travel = Math.min(1, atmosphere.comets.array[0].x / STELLAR_DRIFT_COMET_CONTACT);
                            const head = target.clone().addScaledVector(approach, 1 - travel);
                            expect(head.length()).toBeGreaterThanOrEqual(radius - 1e-8);
                            if (progress < STELLAR_DRIFT_COMET_CONTACT) {
                                expect(head.length()).toBeGreaterThan(radius);
                            } else {
                                expect(head.distanceTo(target)).toBeLessThan(1e-8);
                            }
                            head.addScaledVector(atmosphere.contactNormalNode.value, 0.035);
                            expect(head.length()).toBeGreaterThan(radius);
                        }
                    }
                }
            }
        }
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

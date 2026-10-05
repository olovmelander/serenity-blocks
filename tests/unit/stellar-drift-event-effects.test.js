import * as THREE from 'three/webgpu';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { StellarDriftEventEffects } from '../../src/themes/stellar-drift/stellar-drift-event-effects.js';
import {
    STELLAR_DRIFT_COMET_CONTACT, STELLAR_DRIFT_REACTION_LIMITS, StellarDriftReactions,
} from '../../src/themes/stellar-drift/stellar-drift-reactions.js';

const owned = [];

function create(quality = 'High', portrait = false) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, portrait ? 390 / 844 : 1440 / 900, 0.1, 500);
    camera.position.set(0, 0, 45);
    const parent = new THREE.Group();
    parent.position.set(portrait ? -2 : -14, portrait ? 16 : -2.5, 0);
    parent.scale.setScalar(portrait ? 0.8 : 1);
    const orbit = new THREE.Group();
    orbit.rotation.set(1.15, -0.1, -0.31);
    parent.add(orbit);
    scene.add(parent);
    const effects = new StellarDriftEventEffects({
        parent, orbitalParent: orbit, camera, quality,
    }).build();
    owned.push(effects);
    return {
        effects, scene, camera, parent, orbit,
    };
}

function resources(effects) {
    return [effects.arcMesh, effects.cometMesh, effects.headMesh, effects.impactMesh]
        .flatMap((mesh) => [mesh, mesh.geometry, mesh.material]);
}

afterEach(() => {
    owned.splice(0).forEach((effects) => effects.dispose());
    vi.restoreAllMocks();
});

describe('Stellar Drift local orbital effects', () => {
    it.each(Object.entries(STELLAR_DRIFT_REACTION_LIMITS))('keeps bounded node draws at %s', (quality, limits) => {
        const { effects } = create(quality);
        expect(effects.arcMesh.geometry.instanceCount).toBe(limits.arcs);
        expect(effects.cometMesh.geometry.instanceCount).toBe(limits.comets);
        expect(effects.headMesh.geometry.instanceCount).toBe(limits.comets);
        expect(effects.impactMesh.geometry.instanceCount).toBe(limits.comets);
        for (const mesh of [effects.arcMesh, effects.cometMesh, effects.headMesh, effects.impactMesh]) {
            expect(mesh.geometry.isInstancedBufferGeometry).toBe(true);
            expect(mesh.material.isNodeMaterial).toBe(true);
            expect(mesh.material.isShaderMaterial).not.toBe(true);
            expect(mesh.material.depthWrite).toBe(false);
            expect(mesh.material.depthTest).toBe(true);
            expect(mesh.material.emissiveNode.isNode).toBe(true);
            expect(mesh.geometry.getAttribute('aEventSlot').count).toBe(mesh.geometry.instanceCount);
        }
        expect(effects.getDiagnostics().eventDraws).toBe(4);
    });

    it('maps sparse slot IDs and retires all geometry after a director reset', () => {
        const { effects } = create();
        const arcId = effects.maxArcs - 1;
        const cometId = effects.maxComets - 1;
        effects.update(9, 1 / 60, {
            arcs: [{
                id: arcId,
                active: true,
                angle: 1.2,
                progress: 0.3,
                strength: 0.7,
                seed: 0.2,
                direction: -1,
                kind: 'combo',
            }],
            comets: [{
                id: cometId,
                active: true,
                angle: 2.1,
                progress: 0.78,
                strength: 0.6,
                seed: 0.3,
                impacted: true,
                impactAge: 0.1,
                direction: -1,
            }],
        });
        expect(effects.arcData[arcId].y).toBeCloseTo(0.7, 12);
        expect(effects.arcMetadata[arcId].y).toBe(2);
        expect(effects.arcMetadata[arcId].w).toBe(1);
        expect(effects.arcData[0].y).toBe(0);
        expect(effects.cometData[cometId].x).toBe(0.78);
        expect(effects.cometData[cometId].y).toBe(0.6);
        expect(effects.impactData[cometId].x).toBe(0.1);
        expect(effects.impactData[cometId].y).toBe(0.6);
        expect(effects.impactData[0].y).toBe(0);
        effects.update(0, 0, new StellarDriftReactions().frame);
        expect(effects.arcMetadata.every((entry) => entry.w === 0)).toBe(true);
        expect(effects.cometData.every((entry) => entry.y === 0)).toBe(true);
        expect(effects.impactData.every((entry) => entry.y === 0)).toBe(true);
    });

    it.each([false, true])('keeps curved heads outside the sphere through contact (portrait=%s)', (portrait) => {
        const { effects, camera, parent } = create('Minimal', portrait);
        const sample = new THREE.Vector3();
        for (let quadrant = 0; quadrant < 16; quadrant++) {
            for (const direction of [-1, 1]) {
                for (const seed of [0, 0.5, 1]) {
                    effects.update(8, 0, {
                        comets: [{
                            id: 0,
                            active: true,
                            angle: (quadrant * Math.PI) / 8,
                            progress: 0.3,
                            strength: 0.7,
                            seed,
                            direction,
                        }],
                    });
                    const target = effects.cometTargetVectors[0];
                    const localCamera = parent.worldToLocal(camera.getWorldPosition(new THREE.Vector3()));
                    expect(target.length()).toBeCloseTo(effects.radius, 5);
                    expect(target.dot(localCamera.sub(target))).toBeCloseTo(0, 4);
                    for (const progress of [0, 0.1, 0.35, 0.6, 0.68, STELLAR_DRIFT_COMET_CONTACT]) {
                        effects.sampleCometPosition(0, progress, sample);
                        expect(sample.length()).toBeGreaterThanOrEqual(effects.radius - 1e-8);
                        if (progress < STELLAR_DRIFT_COMET_CONTACT) {
                            expect(sample.length()).toBeGreaterThan(effects.radius);
                        } else {
                            expect(sample.distanceTo(target)).toBeLessThan(1e-8);
                        }
                    }
                }
            }
        }
    });

    it('protects the actual board rectangle on the shared top-left screen-UV convention', () => {
        const { effects } = create();
        effects.resize(1440, 900, {
            left: 550, top: 90, width: 340, height: 720,
        });
        expect(effects.boardBounds.value.toArray()).toEqual([550 / 1440, 0.1, 890 / 1440, 0.9]);
        effects.resize(1440, 900);
        expect(effects.boardBounds.value.toArray()).toEqual([2, 2, 3, 3]);
        effects.resize(1440, 900, { left: NaN });
        expect(effects.boardBounds.value.toArray()).toEqual([2, 2, 3, 3]);
    });

    it('reuses every render resource and vector while escalating a dense event storm', () => {
        const { effects } = create('Low');
        const reactions = new StellarDriftReactions({ quality: 'Low', rng: () => 0.5 });
        const originalResources = resources(effects);
        const pools = ['arcData', 'arcMetadata', 'cometData', 'impactData',
            'cometTargetVectors', 'cometRadialVectors', 'cometTangentVectors'];
        const originalVectors = pools.map((key) => [...effects[key]]);
        for (let index = 0; index < 200; index++) {
            reactions.onCombo((index % 20) + 2);
            reactions.onLineClear(4);
            reactions.onPieceLock();
            effects.update(index / 60, 1 / 60, reactions.update(1 / 60));
        }
        expect(resources(effects)).toEqual(originalResources);
        pools.forEach((key, pool) => effects[key].forEach((entry, index) => {
            expect(entry).toBe(originalVectors[pool][index]);
            expect(entry.toArray().every(Number.isFinite)).toBe(true);
        }));
    });

    it('detaches both groups and disposes every owned geometry and material exactly once', () => {
        const { effects, parent, orbit } = create('Minimal');
        const disposals = resources(effects).filter((resource) => resource.isBufferGeometry || resource.isMaterial)
            .map((resource) => vi.spyOn(resource, 'dispose'));
        effects.build();
        effects.dispose();
        effects.dispose();
        expect(parent.children).not.toContain(effects.group);
        expect(orbit.children).not.toContain(effects.orbitGroup);
        disposals.forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
    });
});

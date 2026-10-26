/**
 * THE FOLD — chapter 7's other dimension (2026-10-26, docs/ODYSSEY_CH7_FOLD_2026-10.md). Pinned
 * here: when the fall hands the hole's interior from the warp's streaks to the fold (the schedule,
 * pure), the march's cost per quality tier, the dust's two lives, and the window shader building
 * clean on both backends with the fold in it — with no var read where its assignment may not have
 * run (the trap that, mid-pass, washed the plunge out in salmon: the tunnel's light was first built
 * inside the tunnel's uniform branch, and read after both).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';

import {
    CH7_FALL,
    blackHoleFallAtRest,
    resolveBlackHoleFall,
    resolveBlackHoleInsideProgress,
} from '../../src/rendering/odyssey/transitions/odyssey-black-hole-fall.js';
import {
    CH7_QUALITY_TIERS,
    createBlackHoleTranscendenceEnvironment,
} from '../../src/rendering/odyssey/chapter-environments/black-hole-transcendence.js';
import { CH7_FOLD } from '../../src/rendering/odyssey/chapter-environments/odyssey-fold-space.tsl.js';
import {
    CH7_FOLD_CAGE,
    CH7_FOLD_ROOMS,
    CH7_FOLD_SHAPES,
    foldHypercubeCages,
    resolveFoldRoom,
    resolveFoldRoomAnchors,
} from '../../src/rendering/odyssey/transitions/odyssey-fold-rooms.js';
import {
    HYPERCUBE_EDGES,
    createFoldHypercubes,
    hypercubeEdges,
} from '../../src/rendering/odyssey/chapter-environments/odyssey-fold-hypercubes.js';
import { getActiveOdysseyChapterPositions } from '../../src/rendering/odyssey/path-utils.js';
import { build, unassignedReads } from './helpers/tsl-node-build.js';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';

describe('the fold takes over the hole\'s interior from the warp', () => {
    const cp = getActiveOdysseyChapterPositions();
    const ch7 = cp[6];
    const span = cp[7] - cp[6];
    const at = (local) => resolveBlackHoleFall(ch7 + (span * local), cp);

    it('is nothing at rest and through the plunge, and begins only once the eye is inside', () => {
        expect(blackHoleFallAtRest().fold).toBe(0);
        expect(resolveBlackHoleFall(ch7 - 0.01, cp).fold ?? 0).toBe(0);
        for (let local = 0; local <= CH7_FALL.foldFrom; local += 0.005) {
            expect(at(local).fold, `local ${local.toFixed(3)}`).toBe(0);
        }
        const inside = (resolveBlackHoleInsideProgress(cp) - ch7) / span;
        expect(CH7_FALL.foldFrom).toBeGreaterThanOrEqual(inside - 1e-9);
    });

    it('is whole before the first orbs park inside, and stays through the exit', () => {
        const rig = createOdysseyCameraRig();
        const firstPark = Math.min(rig.parkOf(49), rig.parkOf(50));
        expect(resolveBlackHoleFall(firstPark, cp).fold).toBe(1);
        for (let local = CH7_FALL.foldTo; local < 1; local += 0.01) {
            expect(at(local).fold, `local ${local.toFixed(3)}`).toBe(1);
        }
    });

    it('grows without a step', () => {
        let prev = 0;
        for (let local = 0; local < 0.4; local += 0.0005) {
            const { fold } = at(local);
            expect(fold).toBeGreaterThanOrEqual(prev - 1e-12);
            expect(fold - prev).toBeLessThan(0.02);
            prev = fold;
        }
    });
});

describe('a room of the fold for every orb inside the hole (step 3)', () => {
    const rig = createOdysseyCameraRig();
    const { cp } = rig;
    const anchors = resolveFoldRoomAnchors(cp);

    it('covers orbs 49 to 56 once each, in order, each room anchored where its first orb parks', () => {
        const orbs = CH7_FOLD_ROOMS.flatMap((r) => r.orbs);
        expect(orbs).toEqual([49, 50, 51, 52, 53, 54, 55, 56]);
        // ...and the way out after them, its walls the city's square neon grid (step 5).
        const out = CH7_FOLD_ROOMS[CH7_FOLD_ROOMS.length - 1];
        expect(out.orbs).toEqual([]);
        expect(out.grid).toBe(1);
        expect(CH7_FOLD_ROOMS.slice(0, -1).every((r) => r.grid === 0)).toBe(true);
        expect(anchors).toHaveLength(CH7_FOLD_ROOMS.length);
        CH7_FOLD_ROOMS.forEach((room, i) => {
            const at = room.orbs.length
                ? Math.min(...room.orbs.map((id) => rig.parkOf(id)))
                : cp[6] + ((cp[7] - cp[6]) * room.exitAt);
            expect(anchors[i]).toBeCloseTo(at, 9);
            if (i > 0) expect(anchors[i]).toBeGreaterThan(anchors[i - 1]);
            expect(Object.values(CH7_FOLD_SHAPES)).toContain(CH7_FOLD_SHAPES[room.shape]);
        });
    });

    it("is each orb's own room, unmixed, where the orb parks, and the first and last beyond them", () => {
        CH7_FOLD_ROOMS.forEach((room, i) => {
            const r = resolveFoldRoom(anchors[i], anchors);
            expect(r.morph, room.theme).toBe(0);
            expect(r.shapeA).toBe(CH7_FOLD_SHAPES[room.shape]);
            expect(r.hue).toBeCloseTo(room.hue, 9);
            expect(r.tintMix).toBeCloseTo(room.tintMix, 9);
        });
        expect(resolveFoldRoom(anchors[0] - 0.01, anchors).shapeA).toBe(CH7_FOLD_SHAPES[CH7_FOLD_ROOMS[0].shape]);
        const last = CH7_FOLD_ROOMS[CH7_FOLD_ROOMS.length - 1];
        const after = resolveFoldRoom(cp[7], anchors);
        expect(after.morph).toBe(0);
        expect(after.shapeA).toBe(CH7_FOLD_SHAPES[last.shape]);
        // Serenity Warp's room is built of tetrominoes (one solid piece each, never four cells).
        expect(CH7_FOLD_ROOMS.find((r) => r.orbs.includes(54)).shape).toBe('tetromino');
    });

    it('morphs from one room into the next between their orbs, without a step', () => {
        for (let i = 0; i < anchors.length - 1; i += 1) {
            let prev = 0;
            const span = anchors[i + 1] - anchors[i];
            for (let p = anchors[i]; p < anchors[i + 1]; p += span / 200) {
                const r = resolveFoldRoom(p, anchors);
                expect(r.morph).toBeGreaterThanOrEqual(prev - 1e-12);
                expect(r.morph - prev).toBeLessThan(0.05);
                prev = r.morph;
            }
            expect(prev).toBeGreaterThan(0.99);
        }
    });
});

describe('a hypercube round every orb inside the hole (step 4)', () => {
    it('is a true four-dimensional cube: 32 edges, each joining corners that differ in one coordinate', () => {
        expect(HYPERCUBE_EDGES).toHaveLength(32);
        HYPERCUBE_EDGES.forEach(([a, b]) => {
            const diff = a ^ b;
            expect(diff & (diff - 1), `${a}-${b}`).toBe(0);
        });
        // Every corner meets four edges.
        const degree = new Array(16).fill(0);
        HYPERCUBE_EDGES.forEach(([a, b]) => { degree[a] += 1; degree[b] += 1; });
        expect(degree.every((d) => d === 4)).toBe(true);
    });

    it('turns through the fourth dimension: its projection breathes, bounded, and is a cube at rest', () => {
        const extent = (t) => Math.max(...hypercubeEdges(t, 1).flat().map(Math.abs));
        expect(extent(0)).toBeCloseTo(1, 9);
        const seen = [];
        for (let t = 0; t < 60; t += 0.25) seen.push(extent(t));
        expect(Math.max(...seen)).toBeGreaterThan(1.3);
        expect(Math.max(...seen)).toBeLessThan(2.5);
        hypercubeEdges(7.3, 2).flat().forEach((v) => expect(Number.isFinite(v)).toBe(true));
    });

    it("cages each orb in its room's light, fades near the eye and far off, and leaves as the mouth opens", () => {
        const eye = { x: 0, y: 0, z: 0 };
        const at = (d) => () => ({ x: 0, y: 0, z: -d });
        const mid = foldHypercubeCages(1, eye, at(100), 0.5);
        expect(mid).toHaveLength(8);
        mid.forEach((cage) => {
            expect(cage.presence).toBeCloseTo(1, 9);
            expect(cage.size).toBe(CH7_FOLD_CAGE.size);
        });
        expect(foldHypercubeCages(1, eye, at(CH7_FOLD_CAGE.nearFrom - 1), 0.5)).toHaveLength(0);
        expect(foldHypercubeCages(1, eye, at(CH7_FOLD_CAGE.farTo + 1), 0.5)).toHaveLength(0);
        expect(foldHypercubeCages(0, eye, at(100), 0.5)).toHaveLength(0);
        expect(foldHypercubeCages(1, eye, at(100), CH7_FOLD_CAGE.outTo + 0.01)).toHaveLength(0);
        // Chiral Gold's orb is caged in gold.
        const gold = mid.find((c) => c.id === 51).colour;
        expect(gold.r).toBeGreaterThan(gold.b);
    });

    it('draws as additive light that writes no alpha and no depth', () => {
        const cubes = createFoldHypercubes({ count: 2 });
        expect(cubes.mesh.material.blending).toBe(THREE.AdditiveBlending);
        expect(cubes.mesh.material.depthWrite).toBe(false);
        expect(cubes.mesh.material.premultipliedAlpha).toBe(true);
        const camera = new THREE.PerspectiveCamera();
        camera.position.set(0, 0, 10);
        cubes.update(camera, 1, [{
            position: new THREE.Vector3(), size: 2, presence: 1, colour: { r: 1, g: 1, b: 1 },
        }]);
        expect(cubes.mesh.visible).toBe(true);
        const pos = cubes.mesh.geometry.getAttribute('position').array;
        expect(Array.from(pos.slice(0, 32 * 4 * 3)).every((v) => Number.isFinite(v))).toBe(true);
        cubes.update(camera, 1, []);
        expect(cubes.mesh.visible).toBe(false);
        cubes.dispose();
    });
});

describe('the march costs less on the lower tiers', () => {
    it('steps down from High to Low, High at the module default', () => {
        expect(CH7_QUALITY_TIERS.high.foldSteps).toBe(CH7_FOLD.steps);
        expect(CH7_QUALITY_TIERS.medium.foldSteps).toBeLessThan(CH7_QUALITY_TIERS.high.foldSteps);
        expect(CH7_QUALITY_TIERS.low.foldSteps).toBeLessThan(CH7_QUALITY_TIERS.medium.foldSteps);
        expect(CH7_QUALITY_TIERS.low.foldSteps).toBeGreaterThanOrEqual(12);
    });

    it('keeps the tesseracts off the axis, so the path and its orbs stay in the open', () => {
        expect(CH7_FOLD.ringRadius - (CH7_FOLD.size * Math.sqrt(3))).toBeGreaterThan(1.5);
        expect(CH7_FOLD.shellIn).toBeLessThan(CH7_FOLD.ringRadius - (CH7_FOLD.size * Math.sqrt(3)));
        expect(CH7_FOLD.shellOut).toBeGreaterThan(CH7_FOLD.ringRadius + (CH7_FOLD.size * 1.75));
    });
});

describe('the hole\'s window builds on both backends with the fold in it', () => {
    const backends = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
    ['high', 'low'].forEach((tier) => {
        const env = createBlackHoleTranscendenceEnvironment({ particleCount: 200, qualityTier: tier });
        let shadow = null;
        env.traverse((o) => { if (o.name === 'gargantua-shadow') shadow = o; });
        backends.forEach(([label, Builder]) => {
            it(`${tier} (${label})`, () => {
                expect(shadow).not.toBeNull();
                const out = build(Builder, shadow);
                expect(out.thrown, `${out.thrown?.stack ?? ''}`).toBeUndefined();
                expect(out.heard).toEqual([]);
                expect(out.fragment).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
                // The march is a real loop (not unrolled), and the mouth still cuts.
                expect(out.fragment).toMatch(/\bfor\s*\(/);
                expect(out.fragment).toMatch(/discard/);
                if (label === 'WGSL') {
                    expect(unassignedReads(out.fragment), 'fragment').toEqual([]);
                }
            });
        });
    });
});

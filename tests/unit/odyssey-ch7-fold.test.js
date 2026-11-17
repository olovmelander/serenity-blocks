/**
 * THE FOLD — chapter 7's other dimension (2026-10-26; eight places since the masterpiece pass,
 * 2026-11-17; docs/ODYSSEY_CH7_FOLD_2026-10.md). Pinned here: when the fall hands the hole's
 * interior from the closing sky to the fold (the schedule, pure), the rooms and the places they
 * are, how a room is held in the world, the hypercubes, the walk's cost per quality tier, and the
 * window shader building clean on both backends with the fold in it — with no var read where its
 * assignment may not have run (the trap that, mid-pass, washed the plunge out in salmon: a light
 * was first built inside one uniform branch, and read after both), and with no screen derivative
 * (the places sit behind a per-pixel branch while one room opens through another).
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
import {
    CH7_FOLD,
    CH7_FOLD_PLACE,
    CH7_FOLD_PLACES,
} from '../../src/rendering/odyssey/chapter-environments/odyssey-fold-space.tsl.js';
import { CH7_FOLD_PLACE_BUILDERS } from '../../src/rendering/odyssey/chapter-environments/odyssey-fold-places.tsl.js';
import { CH7_CLOSING_SKY } from '../../src/rendering/odyssey/chapter-environments/odyssey-closing-sky.tsl.js';
import {
    CH7_FOLD_CAGE,
    CH7_FOLD_HOLD,
    CH7_FOLD_PLACE_IDS,
    CH7_FOLD_ROOMS,
    CH7_FOLD_STRAIGHTEN,
    foldHypercubeCages,
    followFoldRoom,
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

describe('the fold takes over the hole\'s interior from the closing sky', () => {
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

describe('the last ring of starlight closes on the dark, and the fold opens where it closes', () => {
    const cp = getActiveOdysseyChapterPositions();
    const ch7 = cp[6];
    const span = cp[7] - cp[6];
    const at = (local) => resolveBlackHoleFall(ch7 + (span * local), cp);

    it('is wide open (past the frame\'s far corner) until the eye is inside', () => {
        // A 16:9 frame's corner is under 1 rad from the middle at the lens the plunge is seen
        // through (and a 21:9 frame's 1.05).
        expect(CH7_FALL.ringOpen).toBeGreaterThan(1.05);
        expect(CH7_CLOSING_SKY.open).toBe(CH7_FALL.ringOpen);
        expect(blackHoleFallAtRest().ring).toBe(CH7_FALL.ringOpen);
        // It starts as the hole's rim passes the frame's edges (the hole over 45 degrees), before
        // the eye is wholly inside.
        const inside = (resolveBlackHoleInsideProgress(cp) - ch7) / span;
        expect(at(CH7_FALL.ringFrom).alpha).toBeGreaterThan((45 * Math.PI) / 180);
        expect(CH7_FALL.ringFrom).toBeLessThan(inside);
        // ...and for as long as the ring is outside the hole's own rim it is not seen at all.
        for (let local = CH7_FALL.ringFrom; local < CH7_FALL.ringTo; local += 0.001) {
            const f = at(local);
            if (f.ring > f.alpha) expect(f.alpha, `local ${local.toFixed(3)}`).toBeLessThan((62 * Math.PI) / 180);
        }
        for (let local = -0.1; local <= CH7_FALL.ringFrom; local += 0.01) {
            expect(at(local).ring, `local ${local.toFixed(2)}`).toBe(CH7_FALL.ringOpen);
        }
    });

    it('closes to a point without a step, and stays closed', () => {
        let prev = CH7_FALL.ringOpen;
        for (let local = 0; local < 0.4; local += 0.0005) {
            const { ring } = at(local);
            expect(ring).toBeLessThanOrEqual(prev + 1e-12);
            expect(prev - ring).toBeLessThan(0.02);
            prev = ring;
        }
        expect(at(CH7_FALL.ringTo).ring).toBe(0);
        expect(at(0.9).ring).toBe(0);
    });

    it('hands over to the fold: the fold begins as the ring is nearly closed, not before', () => {
        expect(CH7_FALL.foldFrom).toBeGreaterThan(CH7_FALL.ringFrom);
        expect(CH7_FALL.foldFrom).toBeLessThan(CH7_FALL.ringTo);
        expect(at(CH7_FALL.foldFrom).ring).toBeLessThan(0.2);
        // ...and the ring is seen for most of its closing with nothing of the fold over it.
        const half = (CH7_FALL.ringFrom + CH7_FALL.ringTo) / 2;
        expect(at(half).fold).toBe(0);
    });
});

describe('a room of the fold for every orb inside the hole, each a place of its own', () => {
    const rig = createOdysseyCameraRig();
    const { cp } = rig;
    const anchors = resolveFoldRoomAnchors(cp);

    it('covers orbs 49 to 56 once each, in order, each room anchored where its first orb parks', () => {
        const orbs = CH7_FOLD_ROOMS.flatMap((r) => r.orbs);
        expect(orbs).toEqual([49, 50, 51, 52, 53, 54, 55, 56]);
        // ...and the way out after them: the hall, with no orb of its own.
        const out = CH7_FOLD_ROOMS[CH7_FOLD_ROOMS.length - 1];
        expect(out.orbs).toEqual([]);
        expect(out.place).toBe('hall');
        expect(anchors).toHaveLength(CH7_FOLD_ROOMS.length);
        CH7_FOLD_ROOMS.forEach((room, i) => {
            const at = room.orbs.length
                ? Math.min(...room.orbs.map((id) => rig.parkOf(id)))
                : cp[6] + ((cp[7] - cp[6]) * room.exitAt);
            expect(anchors[i]).toBeCloseTo(at, 9);
            if (i > 0) expect(anchors[i]).toBeGreaterThan(anchors[i - 1]);
        });
        // Every orb has a park and a room of its own (2026-11-17: orbs 49 and 50 used to share).
        CH7_FOLD_ROOMS.filter((r) => r.orbs.length).forEach((room) => expect(room.orbs).toHaveLength(1));
        const parks = [49, 50, 51, 52, 53, 54, 55, 56].map((id) => rig.parkOf(id));
        expect(new Set(parks).size).toBe(8);
    });

    it('is nine rooms that are nine different places, no two opening from the same spot', () => {
        expect(CH7_FOLD_ROOMS).toHaveLength(9);
        const places = CH7_FOLD_ROOMS.map((r) => r.place);
        expect(new Set(places).size).toBe(9);
        places.forEach((name) => {
            expect(Object.keys(CH7_FOLD_PLACE_IDS)).toContain(name);
            expect(CH7_FOLD_PLACE[name], name).toBeDefined();
        });
        // One list of ids, and a builder for each.
        expect(CH7_FOLD_PLACES).toBe(CH7_FOLD_PLACE_IDS);
        expect(Object.values(CH7_FOLD_PLACE_IDS).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
        expect(CH7_FOLD_PLACE_BUILDERS).toHaveLength(9);
        // The frames the places are seen in differ: no two put the way ahead in the same spot.
        const frames = Object.values(CH7_FOLD_PLACE).filter((p) => p.frame).map((p) => p.frame.slice(0, 2).join(','));
        expect(new Set(frames).size).toBe(frames.length);
        for (let i = 2; i < CH7_FOLD_ROOMS.length - 1; i += 1) {
            expect(CH7_FOLD_ROOMS[i].door).not.toEqual(CH7_FOLD_ROOMS[i - 1].door);
        }
        // The first room opens at the crossing and the hall where the mouth will: both the middle.
        expect(CH7_FOLD_ROOMS[0].door).toEqual([0, 0]);
        expect(CH7_FOLD_ROOMS[CH7_FOLD_ROOMS.length - 1].door).toEqual([0, 0]);
        // Orb 50 (Nebula Flow) has the star cradle.
        expect(CH7_FOLD_ROOMS.find((r) => r.orbs.includes(50)).place).toBe('cradle');
        // The stairs' glasses are handed round by the happenings: three whole colours at every
        // count, each family's own, and none of them a mix.
        const { glass } = CH7_FOLD_PLACE.stairs;
        expect(glass).toHaveLength(3);
        for (let turns = 0; turns < 4; turns += 1) {
            const standing = glass.map((family) => family[turns].join(','));
            expect(new Set(standing).size, `after ${turns}`).toBe(3);
            standing.forEach((colour) => expect(glass.map((family) => family[0].join(','))).toContain(colour));
        }
        // Serenity Warp's room is stairs, never the game's pieces.
        expect(CH7_FOLD_ROOMS.find((r) => r.orbs.includes(54)).place).toBe('stairs');
    });

    it("is each orb's own place, whole, where the orb parks, and the first and last beyond them", () => {
        CH7_FOLD_ROOMS.forEach((room, i) => {
            const r = resolveFoldRoom(anchors[i], anchors, cp);
            expect(r.morph, room.theme).toBe(0);
            expect(r.placeA).toBe(CH7_FOLD_PLACE_IDS[room.place]);
            expect(r.exit).toBe(room.place === 'hall' ? 1 : 0);
        });
        expect(resolveFoldRoom(anchors[0] - 0.01, anchors, cp).placeA).toBe(CH7_FOLD_PLACE_IDS.tide);
        const after = resolveFoldRoom(cp[7], anchors, cp);
        expect(after.morph).toBe(0);
        expect(after.placeA).toBe(CH7_FOLD_PLACE_IDS.hall);
        expect(after.exit).toBe(1);
    });

    it('opens the next room through this one between their orbs, without a step', () => {
        for (let i = 0; i < anchors.length - 1; i += 1) {
            let prev = 0;
            const span = anchors[i + 1] - anchors[i];
            for (let p = anchors[i]; p < anchors[i + 1]; p += span / 200) {
                const r = resolveFoldRoom(p, anchors, cp);
                expect(r.morph).toBeGreaterThanOrEqual(prev - 1e-12);
                expect(r.morph - prev).toBeLessThan(0.05);
                expect(r.placeB).toBe(CH7_FOLD_PLACE_IDS[CH7_FOLD_ROOMS[i + 1].place]);
                expect(r.door).toEqual(CH7_FOLD_ROOMS[i + 1].door);
                prev = r.morph;
            }
            expect(prev).toBeGreaterThan(0.99);
        }
    });

    it('straightens the hall into the city\'s grid as the mouth opens, whole by the seam', () => {
        const local = (v) => cp[6] + ((cp[7] - cp[6]) * v);
        expect(resolveFoldRoom(local(CH7_FOLD_STRAIGHTEN.from), anchors, cp).straight).toBeCloseTo(0, 9);
        expect(resolveFoldRoom(local(CH7_FOLD_STRAIGHTEN.to), anchors, cp).straight).toBeCloseTo(1, 9);
        expect(CH7_FOLD_STRAIGHTEN.to).toBeLessThan(1);
        expect(resolveFoldRoom(cp[7], anchors, cp).straight).toBe(1);
        let prev = 0;
        for (let v = 0.8; v <= 1; v += 0.001) {
            const { straight } = resolveFoldRoom(local(v), anchors, cp);
            expect(straight).toBeGreaterThanOrEqual(prev - 1e-12);
            expect(straight - prev).toBeLessThan(0.03);
            prev = straight;
        }
        // The hall has begun to open by the time it straightens (it is a tube first).
        expect(local(CH7_FOLD_STRAIGHTEN.from)).toBeGreaterThan(anchors[6]);
    });
});

describe('the room is held in the world while the eye turns in it', () => {
    it('lets the eye turn freely a little, follows more firmly further out, and is never left far behind', () => {
        const H = CH7_FOLD_HOLD;
        // Within the free angle the room does not move at all.
        expect(followFoldRoom(H.free * 0.8, 1 / 60)).toBe(H.free * 0.8);
        expect(followFoldRoom(0, 1 / 60)).toBe(0);
        // Further out it follows: a little a frame, never past the view, never the wrong way.
        for (let lag = H.free + 0.5; lag <= 60; lag += 0.5) {
            const next = followFoldRoom(lag, 1 / 60);
            expect(next).toBeLessThanOrEqual(lag);
            expect(next).toBeGreaterThan(0);
            expect(next).toBeLessThanOrEqual(H.most);
        }
        // Firmer the further behind it is.
        const eased = (lag) => (lag - followFoldRoom(lag, 1 / 60)) / lag;
        expect(eased(H.firm)).toBeGreaterThan(eased((H.free + H.firm) / 2));
        expect(eased((H.free + H.firm) / 2)).toBeGreaterThan(0);
    });

    it('comes to rest inside the firm angle after a swing, and does not depend on the frame rate', () => {
        const settle = (dt) => {
            let lag = 28;
            for (let t = 0; t < 4; t += dt) lag = followFoldRoom(lag, dt);
            return lag;
        };
        expect(settle(1 / 60)).toBeLessThan(CH7_FOLD_HOLD.firm * 0.6);
        expect(settle(1 / 60)).toBeGreaterThan(CH7_FOLD_HOLD.free);
        expect(Math.abs(settle(1 / 30) - settle(1 / 120))).toBeLessThan(0.5);
        // A stalled frame does not throw the room.
        expect(followFoldRoom(20, 5)).toBeGreaterThan(0);
        expect(followFoldRoom(Number.NaN, 0.016)).toBe(0);
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
        // Orb 51 (the lattice) is caged in gold.
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

describe('the walk costs less on the lower tiers', () => {
    it('steps down from High to Low, High at the module default', () => {
        expect(CH7_QUALITY_TIERS.high.foldSteps).toBe(CH7_FOLD.steps);
        expect(CH7_QUALITY_TIERS.medium.foldSteps).toBeLessThan(CH7_QUALITY_TIERS.high.foldSteps);
        expect(CH7_QUALITY_TIERS.low.foldSteps).toBeLessThan(CH7_QUALITY_TIERS.medium.foldSteps);
        expect(CH7_QUALITY_TIERS.low.foldSteps).toBeGreaterThanOrEqual(12);
    });

    it("keeps the eye's own line clear in the places that are walked, so the path stays in the open", () => {
        // The stairs: the eye rides between the planes its flights stand in, and between the
        // flights of the family whose planes it crosses.
        const S = CH7_FOLD_PLACE.stairs;
        expect((S.planes / 2) - (S.width / 2)).toBeGreaterThan(6);
        expect((S.apart / 2) - S.thick - S.tread).toBeGreaterThan(6);
        // The lattice winds, so its beams do cross the eye's line: they fade before they reach it.
        const L = CH7_FOLD_PLACE.lattice;
        expect(L.nearFrom).toBeGreaterThanOrEqual(1);
        expect(L.nearTo).toBeGreaterThan(L.nearFrom + 1);
        // The flock's and the paint's nearest layers are not drawn; the tide's threads stand well out.
        expect(CH7_FOLD_PLACE.paint.near).toBeGreaterThanOrEqual(2);
        expect(CH7_FOLD_PLACE.tide.threads.near).toBeGreaterThan(5);
        // The nave and the hall are rooms round the eye: it stands inside them.
        const N = CH7_FOLD_PLACE.nave;
        expect(Math.abs(N.eye[0])).toBeLessThan(N.halfWidth - 2);
        expect(N.eye[1]).toBeGreaterThan(-N.floor + 1);
        expect(N.eye[1]).toBeLessThan(N.spring);
    });
});

describe('the hole\'s window builds on both backends with the fold in it', () => {
    const backends = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
    ['high', 'low'].forEach((tier) => {
        const env = createBlackHoleTranscendenceEnvironment({ particleCount: 200, qualityTier: tier });
        let shadow = null;
        env.traverse((o) => { if (o.name === 'great-hole-shadow') shadow = o; });
        backends.forEach(([label, Builder]) => {
            it(`${tier} (${label})`, () => {
                expect(shadow).not.toBeNull();
                const out = build(Builder, shadow);
                expect(out.thrown, `${out.thrown?.stack ?? ''}`).toBeUndefined();
                expect(out.heard).toEqual([]);
                expect(out.fragment).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
                // The walks are real loops (not unrolled), and the mouth still cuts.
                expect((out.fragment.match(/\bfor\s*\(/g) ?? []).length).toBeGreaterThanOrEqual(6);
                expect(out.fragment).toMatch(/discard/);
                // No screen derivative anywhere in it: a place runs behind a per-pixel branch
                // while one room opens through another, where WGSL allows none.
                expect(out.fragment).not.toMatch(/\b(dpdx|dpdy|fwidth|dFdx|dFdy)\w*\s*\(/);
                if (label === 'WGSL') {
                    expect(unassignedReads(out.fragment), 'fragment').toEqual([]);
                }
            });
        });
    });
});

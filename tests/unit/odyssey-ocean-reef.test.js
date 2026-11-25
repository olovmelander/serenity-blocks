/**
 * THE ISLAND'S UNDERWATER FLANK (masterpiece pass, 2026-11-17): the kelp tower, the sea stacks,
 * the coral and the forest stand on the drawn bed, under the surface, clear of the rail and of
 * every animal's way, and in the frames they were placed for: the orbs' close-ups (which look
 * along -z at the flank) and the climb's first look up.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { getOdysseyPathPointAt } from '../../src/rendering/odyssey/path-utils.js';
import { ODYSSEY_SEA_LEVEL, odysseyWorldHeight } from '../../src/rendering/odyssey/world/odyssey-world-height.js';
import {
    OCEAN_REEF, REEF_KELP, REEF_POOLS, buildReefKelpGeometry, buildReefPoolGeometry, buildReefRockGeometry, kelpAxisAt,
    planOceanReef, reefKeepOut, stackCrownAt, towerRadiusAt,
} from '../../src/rendering/odyssey/world/odyssey-ocean-reef.js';
import { OCEAN_ROAM, roamAt, roamLane } from '../../src/rendering/odyssey/composition/odyssey-ocean-roam.js';
import { WHALE_PASS_PAIR } from '../../src/rendering/odyssey/composition/odyssey-whale-pass.js';
import {
    OCEAN_SHAFTS, oceanShaftDirection, sunUnderWater,
} from '../../src/rendering/odyssey/world/odyssey-ocean-scenery.js';
import { ODYSSEY_WORLD_SUN } from '../../src/rendering/odyssey/chapter-environments/shared/chapter-profile.js';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';

const SEA = ODYSSEY_SEA_LEVEL;
/** The world's open-water rail: the samples under the surface and over the bed. */
const rail = [];
for (let p = 0.066; p < 0.1372; p += 0.0015) {
    const q = getOdysseyPathPointAt(p);
    if (q.y < SEA - 2 && q.y > odysseyWorldHeight(q.x, q.z) + 2) rail.push({ x: q.x, y: q.y, z: q.z });
}
const plan = planOceanReef({ heightAt: odysseyWorldHeight, rail, seaLevel: SEA });

/**
 * The orbs' close-up cameras, as the running game poses them (measured 2026-11-17 with the map
 * open at each orb: position, forward, up; a 58 degree lens at 16:10).
 */
const CLOSE_UPS = {
    // (orb 6: measured 2026-11-25, when the arch was placed for it)
    6: { pos: [-2.84, 129.98, 18.27], fwd: [-0.05, -0.23, -0.97], up: [-0.44, 0.88, -0.19] },
    7: { pos: [-3.11, 161.99, 19.36], fwd: [0.01, -0.19, -0.98], up: [-0.44, 0.88, -0.18] },
    8: { pos: [-2.96, 195.47, 19.84], fwd: [0, -0.21, -0.98], up: [-0.44, 0.88, -0.19] },
    9: { pos: [-3.23, 227.61, 20.54], fwd: [0, -0.19, -0.98], up: [-0.44, 0.88, -0.17] },
    10: { pos: [-19.34, 281.86, -5.18], fwd: [0, -0.19, -0.98], up: [-0.43, 0.88, -0.17] },
};
const closeUp = (id) => {
    const c = CLOSE_UPS[id];
    const cam = new THREE.PerspectiveCamera(58, 1.6, 0.1, 9000);
    cam.position.set(...c.pos);
    cam.up.set(...c.up);
    cam.lookAt(new THREE.Vector3(...c.pos).add(new THREE.Vector3(...c.fwd)));
    cam.updateMatrixWorld(true);
    return cam;
};
const ndcOf = (cam, x, y, z) => {
    const v = new THREE.Vector3(x, y, z);
    const ahead = v.clone().sub(cam.position).dot(cam.getWorldDirection(new THREE.Vector3())) > 0;
    v.project(cam);
    return { x: v.x, y: v.y, ahead };
};

describe("the island's underwater flank", () => {
    it('plants the same reef every time: a tower, stacks, scree, coral and kelp', () => {
        const again = planOceanReef({ heightAt: odysseyWorldHeight, rail, seaLevel: SEA });
        expect(again).toEqual(plan);
        expect(plan.tower).toBeTruthy();
        expect(plan.pinnacles.length).toBeGreaterThanOrEqual(6);
        expect(plan.boulders.length).toBeGreaterThanOrEqual(24);
        // Fewer and better (the lead's review): colonies of forms on outcrops, not a scatter.
        expect(plan.corals.length).toBeGreaterThanOrEqual(90);
        expect(plan.corals.length).toBeLessThanOrEqual(140);
        expect(plan.corals.filter((c) => c.deep).length).toBeGreaterThanOrEqual(36);
        expect(plan.mounds.length).toBeGreaterThanOrEqual(10);
        const forms = new Set(plan.corals.map((c) => c.kind));
        ['tree', 'fan', 'tubes', 'anemone', 'pen', 'dome', 'table'].forEach((k) => expect(forms.has(k), k).toBe(true));
        expect(plan.stipes.length).toBeGreaterThanOrEqual(90);
    });

    it('stands on the drawn bed and stops under the surface', () => {
        const T = plan.tower;
        expect(T.baseY).toBeLessThan(odysseyWorldHeight(T.x, T.z));
        expect(SEA - T.topY).toBeCloseTo(OCEAN_REEF.tower.topDepth, 6);
        plan.pinnacles.forEach((p) => {
            expect(p.baseY, 'sunk into the bed').toBeLessThan(odysseyWorldHeight(p.x, p.z));
            expect(SEA - p.topY, 'top under the surface').toBeGreaterThan(14);
            expect(p.topY - p.baseY).toBeGreaterThan(18);
        });
        plan.boulders.forEach((b) => {
            expect(b.y).toBeLessThan(odysseyWorldHeight(b.x, b.z));
            expect(SEA - (b.y + b.r)).toBeGreaterThan(4);
        });
        plan.corals.forEach((c) => expect(SEA - (c.y + (c.size * 1.6)), c.kind).toBeGreaterThan(1));
        plan.stipes.forEach((st) => {
            // Its whole axis, canopy run included, lies under the canopy's depth.
            const a = {};
            for (let s = 0; s <= st.length; s += 1) {
                kelpAxisAt(st, s, a);
                expect(a.y).toBeLessThanOrEqual(SEA - OCEAN_REEF.canopyDepth + 1e-6);
                expect(Number.isFinite(a.x + a.y + a.z)).toBe(true);
            }
            expect(st.length).toBeGreaterThan(4);
        });
        // The tallest kelp lays a canopy just under the surface.
        expect(plan.stipes.filter((st) => st.length > st.room).length).toBeGreaterThan(30);
    });

    it('keeps the rail, the orbs and their close-ups clear', () => {
        const clear = (x, z) => Math.min(...rail.map((p) => Math.hypot(p.x - x, p.z - z)));
        expect(clear(plan.tower.x, plan.tower.z) - OCEAN_REEF.tower.baseRadius).toBeGreaterThan(OCEAN_REEF.corridor);
        plan.pinnacles.forEach((p) => expect(clear(p.x, p.z) - (p.baseR * 0.8)).toBeGreaterThan(OCEAN_REEF.corridor));
        plan.boulders.forEach((b) => expect(clear(b.x, b.z) - b.r).toBeGreaterThan(OCEAN_REEF.corridor));
        // What grows on the bed is measured against the rail in space (the upper rail runs 150 u
        // over the slope's foot): nothing of it within the corridor of any rail point.
        plan.corals.forEach((c) => {
            const near = Math.min(...rail.map((p) => Math.hypot(p.x - c.x, p.z - c.z, p.y - (c.y + c.size))));
            expect(near, c.kind).toBeGreaterThan(OCEAN_REEF.corridor - 1);
        });
        plan.stipes.forEach((st) => expect(clear(st.x, st.z)).toBeGreaterThan(OCEAN_REEF.corridor));
        // Nothing between a close-up's lens and its orb (the lens sits ~10 u toward +z of the rail).
        Object.values(CLOSE_UPS).forEach((c) => {
            const near = (x, z) => Math.hypot(x - c.pos[0], z - c.pos[2]);
            [...plan.pinnacles.map((p) => [p.x, p.z, p.baseR]), ...plan.boulders.map((b) => [b.x, b.z, b.r]),
                ...plan.mounds.map((m) => [m.x, m.z, m.r])]
                .forEach(([x, z, r]) => expect(near(x, z) - r).toBeGreaterThan(18));
        });
    });

    it('stands in no animal\'s way (the routes, with the bodies\' sizes, over their whole clock)', () => {
        const animals = [
            { route: OCEAN_ROAM.whaleShark, half: 6, tall: 5 },
            { route: OCEAN_ROAM.manta, half: 12, tall: 2 },
            { route: OCEAN_ROAM.whales, half: 8, tall: 7 },
            { route: roamLane(OCEAN_ROAM.whales, WHALE_PASS_PAIR.calf), half: 4, tall: 4 },
        ];
        // Each solid as a cylinder: centre, radius at its top, top depth.
        const solids = [
            [plan.tower.x, plan.tower.z, OCEAN_REEF.tower.topRadius, SEA - plan.tower.topY],
            // The tower's kelp, up to the canopy.
            [plan.tower.x, plan.tower.z, OCEAN_REEF.tower.kelpRadius, OCEAN_REEF.canopyDepth],
            ...plan.pinnacles.map((p) => [p.x, p.z, p.baseR * 0.55, SEA - p.topY]),
            ...plan.boulders.map((b) => [b.x, b.z, b.r, SEA - (b.y + b.r)]),
        ];
        const at = { x: 0, y: 0, z: 0 };
        animals.forEach(({ route, half, tall }) => {
            for (let t = 0; t < 1800; t += 0.5) {
                roamAt(route, t, at);
                const depth = SEA - at.y;
                solids.forEach(([x, z, r, top]) => {
                    if (depth + tall < top) return; // it swims over the top
                    expect(Math.hypot(at.x - x, at.z - z), `t ${t}`).toBeGreaterThan(r + half);
                });
            }
        });
        // The keep-out itself refuses a stack in the whale shark's loop and in the corridor.
        const keep = reefKeepOut({ rail, seaLevel: SEA });
        expect(keep.blockedBy(6, -51, 6, 20)).toBe('roamer');
        expect(keep.blockedBy(-5, 8, 5, 100)).toBe('rail');
        expect(keep.blockedBy(plan.tower.x, plan.tower.z, OCEAN_REEF.tower.topRadius, SEA - plan.tower.topY)).toBeNull();
    });

    it('puts the kelp tower in the close-ups: its wall behind orbs 8 and 9, its forest behind orb 10', () => {
        const T = plan.tower;
        const inFrame = (n) => n.ahead && Math.abs(n.x) < 1 && Math.abs(n.y) < 1;
        // Orb 9 sees the tower's body through the middle of the frame.
        const mid9 = ndcOf(closeUp(9), T.x, T.topY - 22, T.z);
        expect(inFrame(mid9)).toBe(true);
        expect(Math.abs(mid9.x)).toBeLessThan(0.5);
        // Orb 8 sees its lower wall.
        expect(inFrame(ndcOf(closeUp(8), T.x, T.topY - 62, T.z))).toBe(true);
        // Orb 10 sees the forest on its crown, from the crown up toward the canopy.
        expect(inFrame(ndcOf(closeUp(10), T.x, T.topY + 6, T.z))).toBe(true);
        expect(inFrame(ndcOf(closeUp(10), T.x, SEA - 8, T.z))).toBe(true);
        // ...and something of the reef lies in every close-up's frame.
        Object.keys(CLOSE_UPS).forEach((id) => {
            const cam = closeUp(id);
            const seen = [
                ...plan.pinnacles.map((p) => [p.x, p.topY - 6, p.z]),
                ...plan.boulders.map((b) => [b.x, b.y + b.r, b.z]),
                ...plan.corals.map((c) => [c.x, c.y + c.size, c.z]),
            ].filter(([x, y, z]) => inFrame(ndcOf(cam, x, y, z))).length;
            expect(seen, `orb ${id}`).toBeGreaterThanOrEqual(6);
        });
    });

    it('shows the tower from the first look up the column (the real rail camera)', () => {
        const rig = createOdysseyCameraRig();
        const cam = rig.poseAt(0.068).clone();
        cam.aspect = 1.6;
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld(true);
        const n = ndcOf(cam, plan.tower.x, plan.tower.topY + 20, plan.tower.z);
        expect(n.ahead).toBe(true);
        expect(Math.abs(n.x)).toBeLessThan(1);
        expect(Math.abs(n.y)).toBeLessThan(1);
    });

    it('plants about half the small things on the low tier, and nothing without a rail', () => {
        const low = planOceanReef({
            heightAt: odysseyWorldHeight, rail, seaLevel: SEA, quality: 'low',
        });
        expect(low.tower).toBeTruthy();
        expect(low.pinnacles.length).toBe(plan.pinnacles.length);
        expect(low.boulders.length).toBeLessThan(plan.boulders.length * 0.7);
        expect(low.corals.length).toBeLessThan(plan.corals.length * 0.85);
        expect(low.stipes.length).toBeLessThan(plan.stipes.length * 0.8);
        const none = planOceanReef({ heightAt: odysseyWorldHeight, rail: [], seaLevel: SEA });
        expect(none.tower).toBeNull();
        expect(none.stipes).toEqual([]);
    });

    it('builds the rock as one flat-shaded mesh and the kelp as one swaying one', () => {
        const rock = buildReefRockGeometry(plan);
        const kelp = buildReefKelpGeometry(plan);
        const finite = (attr) => Array.from(attr.array).every(Number.isFinite);
        expect(rock.attributes.position.count % 3).toBe(0);
        expect(rock.attributes.position.count / 3).toBeGreaterThan(20000);
        // (70k -> 80k, 2026-11-25: the needle, the arch and the two gardens on them, +12k.)
        expect(rock.attributes.position.count / 3).toBeLessThan(80000);
        expect(rock.attributes.color.count).toBe(rock.attributes.position.count);
        expect(rock.attributes.normal.count).toBe(rock.attributes.position.count);
        expect(finite(rock.attributes.position) && finite(rock.attributes.normal)).toBe(true);
        // Smooth-shaded: every vertex carries a unit normal of its own, and the living things say
        // where they glow (tips, rims, ridges) and how far they may sway.
        const life = rock.attributes.aLife;
        expect(life.itemSize).toBe(3);
        let alive = 0;
        let glowing = 0;
        let swaying = 0;
        for (let i = 0; i < life.count; i += 1) {
            const n = Math.hypot(rock.attributes.normal.getX(i), rock.attributes.normal.getY(i), rock.attributes.normal.getZ(i));
            expect(Math.abs(n - 1)).toBeLessThan(1e-3);
            expect(life.getX(i)).toBeGreaterThanOrEqual(0);
            expect(life.getX(i)).toBeLessThanOrEqual(1);
            if (life.getZ(i) > 0.5) alive += 1;
            else expect(life.getX(i) + life.getY(i)).toBe(0);
            if (life.getX(i) > 0.8) glowing += 1;
            if (life.getY(i) > 0.5) swaying += 1;
        }
        expect(alive).toBeGreaterThan(life.count * 0.4);
        expect(glowing).toBeGreaterThan(500);
        expect(glowing).toBeLessThan(alive * 0.35);
        expect(swaying).toBeGreaterThan(500);
        expect(kelp.attributes.aKelp.itemSize).toBe(4);
        expect(kelp.attributes.aKelp.count).toBe(kelp.attributes.position.count);
        expect(kelp.attributes.position.count / 3).toBeLessThan(16000);
        expect(finite(kelp.attributes.position) && finite(kelp.attributes.aKelp)).toBe(true);
        // Under the surface, every vertex of both (the kelp's sway is a few units, sideways).
        const top = (g) => {
            let y = -Infinity;
            for (let i = 1; i < g.attributes.position.array.length; i += 3) y = Math.max(y, g.attributes.position.array[i]);
            return y;
        };
        expect(top(rock)).toBeLessThan(SEA - 3);
        expect(top(kelp)).toBeLessThan(SEA - (OCEAN_REEF.canopyDepth - 0.5));
        // The tower narrows from its foot to its crown.
        expect(towerRadiusAt(plan.tower, plan.tower.baseY)).toBeCloseTo(OCEAN_REEF.tower.baseRadius, 6);
        expect(towerRadiusAt(plan.tower, plan.tower.topY)).toBeCloseTo(OCEAN_REEF.tower.topRadius, 6);
        expect(REEF_KELP.bend).toBeGreaterThan(0);
        rock.dispose();
        kelp.dispose();
    });
});

describe('the needle and the arch: the places beside the first close-ups (2026-11-25)', () => {
    const N = plan.needle;
    const A = plan.arch;
    const inFrame = (n) => n.ahead && Math.abs(n.x) < 1 && Math.abs(n.y) < 1;
    const railGap = (x, y, z) => Math.min(...rail.map((p) => Math.hypot(p.x - x, p.y - y, p.z - z)));

    it('stands the needle on the bed, its crown and its garden under the cruising school', () => {
        expect(N).toBeTruthy();
        // Sunk past its downhill side: the bed under its whole foot is over its base.
        for (let k = 0; k < 8; k += 1) {
            const a = (k / 8) * Math.PI * 2;
            const bed = odysseyWorldHeight(N.x + (Math.cos(a) * N.baseR), N.z + (Math.sin(a) * N.baseR));
            expect(N.baseY).toBeLessThan(bed);
        }
        expect(SEA - N.topY).toBeCloseTo(OCEAN_REEF.needle.topDepth, 6);
        expect(N.topY - N.baseY).toBeGreaterThan(45);
        // In space it is in nothing's way: the rail, the roaming animals, the fish rings. With what
        // grows on its crown (up to ~6 u) it still stops under the school that cruises that water.
        const keep = reefKeepOut({ rail, seaLevel: SEA });
        expect(keep.blockedBy(N.x, N.z, N.baseR, SEA - N.topY - 6, N.topY + 6)).toBeNull();
        // ...and a stack as tall as the tower would not be let stand there (the school's ring).
        expect(keep.blockedBy(N.x, N.z, N.topR, 60, SEA - 60)).toBe('fish');
        let near = Infinity;
        for (let y = N.baseY; y <= N.topY + 6; y += 2) near = Math.min(near, railGap(N.x, y, N.z));
        expect(near - N.baseR).toBeGreaterThan(OCEAN_REEF.corridor);
        // No close-up's lens looks through it at its orb.
        Object.values(CLOSE_UPS).forEach((c) => {
            expect(Math.hypot(N.x - c.pos[0], N.z - c.pos[2]) - N.baseR).toBeGreaterThan(18);
        });
    });

    it('keeps the arch low on the bed at the slope\'s foot, clear of the rail in space', () => {
        expect(A).toBeTruthy();
        [A.a, A.b].forEach((foot) => {
            expect(foot.y, 'a foot sunk in the bed').toBeLessThan(odysseyWorldHeight(foot.x, foot.z));
            expect(odysseyWorldHeight(foot.x, foot.z) - foot.y).toBeLessThan(8);
        });
        const top = Math.max(A.a.y, A.b.y) + A.rise;
        expect(SEA - top, 'in the deep').toBeGreaterThan(130);
        for (let k = 0; k <= 10; k += 1) {
            const u = k / 10;
            const x = A.a.x + ((A.b.x - A.a.x) * u);
            const z = A.a.z + ((A.b.z - A.a.z) * u);
            expect(railGap(x, top, z) - (A.thick * 3)).toBeGreaterThan(OCEAN_REEF.corridor);
        }
        // No close-up's lens is near it (in space: orb 10's stands 160 u over it).
        Object.values(CLOSE_UPS).forEach((c) => {
            [A.a, A.b].forEach((foot) => {
                const gap = Math.hypot(foot.x - c.pos[0], top - c.pos[1], foot.z - c.pos[2]);
                expect(gap).toBeGreaterThan(18 + (A.thick * 3));
            });
        });
    });

    it('puts them on the free side of each frame: beside the orb, away from its card', () => {
        // Orb 6 sees the arch whole (both feet and its crown), left of the orb.
        const top = Math.max(A.a.y, A.b.y) + A.rise;
        const arch6 = [
            ndcOf(closeUp(6), A.a.x, A.a.y + 3, A.a.z), ndcOf(closeUp(6), A.b.x, A.b.y + 3, A.b.z),
            ndcOf(closeUp(6), (A.a.x + A.b.x) / 2, top, (A.a.z + A.b.z) / 2),
        ];
        arch6.forEach((n) => {
            expect(inFrame(n)).toBe(true);
            expect(n.x).toBeLessThan(0);
        });
        // Orb 7 sees the needle's wall, orb 8 its crown, orb 9 looks down on the crown: all left
        // of the orb, and none nearer the frame's edge than a tenth of it.
        const crown = stackCrownAt(N, 0, 0);
        const wall7 = ndcOf(closeUp(7), N.x, N.baseY + ((N.topY - N.baseY) * 0.45), N.z);
        const crown8 = ndcOf(closeUp(8), crown.x, crown.y, crown.z);
        const crown9 = ndcOf(closeUp(9), crown.x, crown.y, crown.z);
        [wall7, crown8, crown9].forEach((n) => {
            expect(inFrame(n)).toBe(true);
            expect(n.x).toBeLessThan(-0.05);
            expect(n.x).toBeGreaterThan(-0.9);
        });
        // Near enough for its colour: within 85 u of each of those eyes (the tower stands 90-120).
        [7, 8, 9].forEach((id) => {
            const c = CLOSE_UPS[id];
            const range = Math.hypot(crown.x - c.pos[0], crown.y - c.pos[1], crown.z - c.pos[2]);
            expect(range, `orb ${id}`).toBeLessThan(86);
        });
    });

    it('grows a garden on each, with warm lights among the cold', () => {
        const nearNeedle = plan.corals
            .filter((c) => Math.hypot(c.x - N.x, c.z - N.z) < N.baseR + 2 && c.y > N.baseY + 10);
        expect(nearNeedle.length).toBeGreaterThanOrEqual(10);
        const midX = (A.a.x + A.b.x) / 2;
        const midZ = (A.a.z + A.b.z) / 2;
        const underArch = plan.corals.filter((c) => Math.hypot(c.x - midX, c.z - midZ) < 12);
        expect(underArch.length).toBeGreaterThanOrEqual(6);
        const warm = (c) => c.colour[0] > c.colour[2] * 1.5;
        expect(nearNeedle.some(warm) && nearNeedle.some((c) => !warm(c))).toBe(true);
        expect(underArch.some(warm) && underArch.some((c) => !warm(c))).toBe(true);
        // Nothing of either garden in the rail's corridor (in space), or over the surface's light.
        [...nearNeedle, ...underArch].forEach((c) => {
            expect(railGap(c.x, c.y + c.size, c.z), c.kind).toBeGreaterThan(OCEAN_REEF.corridor - 1);
            expect(c.deep).toBe(true);
        });
        // The low tier keeps both places, with less growth.
        const low = planOceanReef({
            heightAt: odysseyWorldHeight, rail, seaLevel: SEA, quality: 'low',
        });
        expect(low.needle).toEqual(N);
        expect(low.arch).toEqual(A);
    });

    it('lights the rock and the sand round the gardens of the deep', () => {
        expect(plan.lights.length).toBeGreaterThanOrEqual(5);
        plan.lights.forEach((L) => {
            expect(SEA - L.y, 'a light of the deep').toBeGreaterThan(90);
            expect(L.r).toBeGreaterThan(8);
            expect(L.colour.every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
        });
        // Baked into the reef's mesh: a share of its vertices take some of it, most take none.
        const rock = buildReefRockGeometry(plan);
        const light = rock.attributes.aLight;
        expect(light.count).toBe(rock.attributes.position.count);
        expect(light.itemSize).toBe(4);
        expect(light.normalized).toBe(true);
        let lit = 0;
        for (let i = 0; i < light.count; i += 1) if (light.getX(i) + light.getY(i) + light.getZ(i) > 0.05) lit += 1;
        expect(lit).toBeGreaterThan(3000);
        expect(lit).toBeLessThan(light.count * 0.5);
        rock.dispose();
        // The pools: one disc per garden on the bed, every vertex seated on it.
        const pools = buildReefPoolGeometry(plan, odysseyWorldHeight);
        const count = plan.lights.filter((L) => L.pool).length;
        expect(count).toBeGreaterThanOrEqual(4);
        const pos = pools.attributes.position;
        expect(pos.count).toBe(count * (1 + (REEF_POOLS.rings * REEF_POOLS.spokes)));
        for (let i = 0; i < pos.count; i += 1) {
            expect(pos.getY(i) - odysseyWorldHeight(pos.getX(i), pos.getZ(i))).toBeCloseTo(REEF_POOLS.lift, 4);
            const rim = pools.attributes.aPool.getX(i);
            expect(rim >= 0 && rim <= 1).toBe(true);
        }
        expect(pools.index.count % 3).toBe(0);
        pools.dispose();
        // With no lights there is nothing to draw.
        const none = buildReefPoolGeometry({ lights: [] }, odysseyWorldHeight);
        expect(none.attributes.position.count).toBe(0);
        none.dispose();
    });
});

describe('the sun\'s shafts in the upper water sweep on the clock', () => {
    it('lets the sun in at Snell\'s angle: nearer the vertical, on the bearing it stands', () => {
        const sun = ODYSSEY_WORLD_SUN;
        const under = sunUnderWater(sun);
        expect(Math.hypot(...under)).toBeCloseTo(1, 6);
        expect(under[1]).toBeGreaterThan(sun[1]);
        expect(Math.atan2(under[2], under[0])).toBeCloseTo(Math.atan2(sun[2], sun[0]), 6);
        // Never flatter than the critical angle, however low the sun.
        expect(Math.hypot(under[0], under[2])).toBeLessThanOrEqual((1 / 1.333) + 1e-9);
        expect(sunUnderWater([0, 1, 0])).toEqual([0, 1, 0]);
    });

    it('lean away from the sun, downward, and never stand still', () => {
        const sun = ODYSSEY_WORLD_SUN;
        const d0 = oceanShaftDirection(sun, 0).slice();
        expect(Math.hypot(...d0)).toBeCloseTo(1, 9);
        expect(d0[1]).toBeLessThan(-0.8);
        // Away from the sun in plan.
        expect((d0[0] * sun[0]) + (d0[2] * sun[2])).toBeLessThan(0);
        let turned = 0;
        let prev = d0;
        for (let t = 0.5; t < 400; t += 0.5) {
            const d = oceanShaftDirection(sun, t).slice();
            const step = Math.acos(Math.min(1, (d[0] * prev[0]) + (d[1] * prev[1]) + (d[2] * prev[2])));
            expect(step).toBeLessThan(0.01);
            turned = Math.max(turned, Math.acos(Math.min(1, (d[0] * d0[0]) + (d[1] * d0[1]) + (d[2] * d0[2]))));
            prev = d;
        }
        // Several degrees of sweep over a few minutes.
        expect((turned * 180) / Math.PI).toBeGreaterThan(5);
        expect(OCEAN_SHAFTS.lowCount).toBeLessThan(OCEAN_SHAFTS.count);
    });
});

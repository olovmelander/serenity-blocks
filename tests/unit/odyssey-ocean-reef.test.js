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
    OCEAN_REEF, REEF_KELP, buildReefKelpGeometry, buildReefRockGeometry, kelpAxisAt, planOceanReef, reefKeepOut,
    towerRadiusAt,
} from '../../src/rendering/odyssey/world/odyssey-ocean-reef.js';
import { OCEAN_ROAM, roamAt, roamLane } from '../../src/rendering/odyssey/composition/odyssey-ocean-roam.js';
import { WHALE_PASS_PAIR } from '../../src/rendering/odyssey/composition/odyssey-whale-pass.js';
import { OCEAN_SHAFTS, oceanShaftDirection } from '../../src/rendering/odyssey/world/odyssey-ocean-scenery.js';
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
        expect(rock.attributes.position.count / 3).toBeLessThan(70000);
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

describe('the sun\'s shafts in the upper water sweep on the clock', () => {
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

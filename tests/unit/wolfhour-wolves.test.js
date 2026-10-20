import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    CAPSULE_COUNT, CAPSULE_STRIDE, WOLF_BOUNDS, blendRigs, pawCycle, poseWolf,
} from '../../src/themes/wolfhour/wolfhour-wolf-rig.js';
import {
    ANSWERER, HOWL, PACK, SCOUT, WALK_STRIDE, createWolfhourPack, eventEnvelope, scoutAt,
} from '../../src/themes/wolfhour/wolfhour-wolves.js';
import {
    REPERTOIRES, YOUNG_MOVES, actionFor, behaviourAt,
} from '../../src/themes/wolfhour/wolfhour-wolf-behaviour.js';
import { WOLFHOUR_PROPS, standWolfhourProps } from '../../src/themes/wolfhour/wolfhour-props.js';
import { FOREST_BELTS, createWolfhourForest, plantBelt } from '../../src/themes/wolfhour/wolfhour-forest.js';
import { createWolfhourLandscape } from '../../src/themes/wolfhour/wolfhour-landscape.js';
import { createWolfhourSky } from '../../src/themes/wolfhour/wolfhour-sky.js';

/**
 * Wolfhour's wolves are capsule rigs unioned in a shader: the rig must stay inside its quad and
 * keep its paws on the ground, poses must follow time alone, and the pack, the wolf across the
 * valley and the scout must keep their parts in the story (howl, answer, walk in, look, walk out).
 */
const owners = [];
const own = (owner) => {
    owners.push(owner);
    return owner;
};
afterEach(() => {
    for (const owner of owners.splice(0).reverse()) owner.dispose();
});

const capsulesOf = (rig) => Array.from(
    { length: CAPSULE_COUNT },
    (_, i) => rig.capsules.slice(i * CAPSULE_STRIDE, (i + 1) * CAPSULE_STRIDE),
);
const live = (rig) => capsulesOf(rig).filter((c) => c[0] < 1e3);

describe('Wolfhour wolf rig', () => {
    const poses = [
        { build: 'standing' },
        {
            build: 'standing', head: 64, jaw: 14, ears: 14,
        },
        { build: 'sitting', head: 70, jaw: 15 },
        { build: 'standing', head: -30, tail: -8 },
        ...Array.from({ length: 8 }, (_, i) => ({ build: 'standing', stride: 15, gait: i / 8 })),
    ];

    it.each(poses)('stays finite and inside its quad: %o', (pose) => {
        const rig = poseWolf(pose);
        expect(rig.capsules).toHaveLength(CAPSULE_COUNT * CAPSULE_STRIDE);
        expect(Array.from(rig.capsules).every(Number.isFinite)).toBe(true);
        const [x0, y0, x1, y1] = WOLF_BOUNDS;
        for (const [ax, ay, bx, by, ra, rb] of live(rig)) {
            expect(Math.min(ax - ra, bx - rb)).toBeGreaterThan(x0);
            expect(Math.max(ax + ra, bx + rb)).toBeLessThan(x1);
            expect(Math.min(ay - ra, by - rb)).toBeGreaterThan(y0);
            expect(Math.max(ay + ra, by + rb)).toBeLessThan(y1);
        }
        expect(rig.muzzle.every(Number.isFinite)).toBe(true);
    });

    it('keeps a paw on the ground through the walk and lifts the others in turn', () => {
        for (let i = 0; i < 16; i++) {
            const lifts = [0.25, 0.75, 0, 0.5].map((offset) => pawCycle(i / 16 + offset, 15)[1]);
            // A four-beat walk: at least two paws are always down.
            expect(lifts.filter((lift) => lift === 0).length).toBeGreaterThanOrEqual(2);
            expect(Math.max(...lifts)).toBeLessThan(3);
        }
        expect(pawCycle(0.3, 0)).toEqual([0, 0, 0]);
    });

    it('raises the muzzle to the sky for a howl', () => {
        const rest = poseWolf({ build: 'standing' });
        const howl = poseWolf({ build: 'standing', head: 64, jaw: 14 });
        expect(howl.muzzle[1]).toBeGreaterThan(rest.muzzle[1] + 6);
        expect(howl.muzzle[1]).toBeGreaterThan(howl.eye[1]);
    });
});

describe('Wolfhour wolves', () => {
    it('poses every wolf from time alone, so a seek lands on the same frame', () => {
        const a = own(createWolfhourPack());
        const b = own(createWolfhourPack());
        a.howl(30);
        b.howl(30);
        for (const t of [3, 12.5, 31.7]) a.update(t);
        b.update(31.7);
        const all = (pack) => [...pack.wolves, pack.answerer.wolf, pack.scout.wolf];
        all(a).forEach((wolf, i) => {
            const other = all(b)[i];
            expect(wolf.mesh.position.toArray()).toEqual(other.mesh.position.toArray());
            expect(wolf.rows.map((r) => r.toArray())).toEqual(other.rows.map((r) => r.toArray()));
        });
    });

    it('howls one after another, then the wolf across the valley answers', () => {
        const pack = own(createWolfhourPack());
        expect(pack.howl(10)).toBe(true);
        expect(pack.howl(11)).toBe(false);
        const lead = PACK.find((w) => w.name === 'lead');
        const young = PACK.find((w) => w.name === 'young');
        const at = 10 + HOWL.rise + 0.1;
        expect(pack.howlLevel(at)).toBe(1);
        expect(eventEnvelope(at - 10 - young.delay, HOWL)).toBeLessThan(1);
        expect(ANSWERER.delay).toBeGreaterThan(Math.max(...PACK.map((w) => w.delay)));
        pack.update(at);
        const leadWolf = pack.wolves.find((w) => w.spec.name === 'lead');
        const restMuzzle = poseWolf({ build: 'standing', head: lead.head }).muzzle[1];
        expect(leadWolf.muzzle[1]).toBeGreaterThan(restMuzzle + 6);
        const done = 10 + ANSWERER.delay + HOWL.rise + HOWL.hold + HOWL.fall + 0.01;
        expect(pack.howlLevel(done)).toBe(0);
    });

    it('lifts the lead wolf\'s head for a smaller clear', () => {
        const pack = own(createWolfhourPack());
        pack.update(5);
        const lead = pack.wolves.find((w) => w.spec.name === 'lead');
        const rest = lead.muzzle[1];
        pack.glance(5);
        pack.update(5.6);
        expect(lead.muzzle[1]).toBeGreaterThan(rest + 1.5);
        expect(pack.howlLevel(5.6)).toBe(0);
    });

    it('breathes vapour while it howls and draws one invisible puff at rest', () => {
        const pack = own(createWolfhourPack());
        const vapour = pack.group.getObjectByName('Wolfhour breath vapour');
        pack.update(1);
        expect(vapour.count).toBe(1);
        expect(vapour.geometry.getAttribute('aPuff').array[0]).toBe(0);
        pack.howl(2);
        pack.update(2 + HOWL.rise + 1.2);
        expect(vapour.count).toBeGreaterThan(2);
        const alphas = Array.from(vapour.geometry.getAttribute('aPuff').array.slice(0, vapour.count));
        expect(alphas.every((alpha) => alpha >= 0 && alpha <= 0.6)).toBe(true);
        expect(Math.max(...alphas)).toBeGreaterThan(0.1);
    });

    it('sends the scout in from off screen, lets it look, and takes it out again', () => {
        expect(scoutAt(SCOUT.first - 1)).toBeNull();
        const walk = (SCOUT.from - SCOUT.to) / SCOUT.speed;
        const arriving = scoutAt(SCOUT.first + walk * 0.5);
        expect(arriving.moving).toBe(true);
        expect(arriving.facing).toBe(-1);
        expect(arriving.x).toBeLessThan(SCOUT.from);
        expect(arriving.x).toBeGreaterThan(SCOUT.to);
        const looking = scoutAt(SCOUT.first + walk + SCOUT.pause / 2);
        expect(looking.moving).toBe(false);
        expect(looking.x).toBe(SCOUT.to);
        expect(scoutAt(SCOUT.first + walk * 1.5 + SCOUT.pause).facing).toBe(1);
        expect(scoutAt(SCOUT.first + walk * 2 + SCOUT.pause + 1)).toBeNull();
        expect(scoutAt(SCOUT.first + SCOUT.period + walk * 0.5)).toEqual(arriving);
        // Under reduced motion nobody walks: the scout stays away and the young wolf stands still.
        const pack = own(createWolfhourPack());
        pack.update(SCOUT.first + walk + 1, 0);
        expect(pack.scout.wolf.mesh.visible).toBe(false);
        pack.update(SCOUT.first + walk + 1, 1);
        expect(pack.scout.wolf.mesh.visible).toBe(true);
    });

    it('keeps the young wolf on gentle ground near its place, moving without a jump', () => {
        const landscape = own(createWolfhourLandscape({ quality: 'High', seed: 73013 }));
        const pack = own(createWolfhourPack());
        standWolfhourProps(landscape, { pack });
        const young = PACK.find((w) => w.name === 'young');
        const at = WOLFHOUR_PROPS.pack;
        const ground = (x) => landscape.crestPoint(at.range, at.x + x * at.scale).y;
        let previous = null;
        let furthest = 0;
        for (let t = 0; t < 900; t += 0.05) {
            const act = behaviourAt('young', t);
            // Its place, its walks and its pounces stay between its home and the leap's landing.
            expect(act.dx).toBeGreaterThanOrEqual(0);
            expect(act.dx).toBeLessThanOrEqual(YOUNG_MOVES.leap + 1e-6);
            furthest = Math.max(furthest, act.dx);
            if (previous) {
                // No teleport: it never moves faster than a leap carries it.
                // (a 0.9 s leap peaks at 1.5 times its mean speed)
                expect(Math.abs(act.dx - previous.dx)).toBeLessThan(((YOUNG_MOVES.leap * 1.6) / 0.9) * 0.05 + 0.2);
                // A leap takes off at about 77 units a second: 3.9 a step of 0.05 s.
                expect(Math.abs(act.lift - previous.lift)).toBeLessThan(5);
            }
            previous = act;
        }
        expect(furthest).toBeCloseTo(YOUNG_MOVES.leap, 3);
        // Wherever it goes the ridge under it is gentler than 30 degrees...
        for (let dx = 0; dx <= YOUNG_MOVES.leap; dx += 2) {
            const x = young.x + dx;
            const rise = Math.abs(ground(x + 6) - ground(x - 6)) / (12 * at.scale);
            expect((Math.atan(rise) * 180) / Math.PI).toBeLessThan(30);
        }
        // ...and its nose (23 units ahead at its size, facing the lead) stays clear of the lead's tail.
        expect(young.x - 29 * young.scale).toBeGreaterThan(20);
    });

    it('draws a calm first slot, then a varied, repeatable repertoire', () => {
        for (const role of Object.keys(REPERTOIRES)) {
            expect(actionFor(role, 0)).toBe('idle');
            const seen = new Set(Array.from({ length: 200 }, (_, k) => actionFor(role, k + 1)));
            for (const [name] of REPERTOIRES[role].actions) expect(seen.has(name)).toBe(true);
            expect(behaviourAt(role, 123.4)).toEqual(behaviourAt(role, 123.4));
        }
    });

    it('pounces in an arc, nose first, throwing snow where it lands, and shakes it off', () => {
        const { slot } = REPERTOIRES.young;
        const k = Array.from({ length: 200 }, (_, i) => i + 1).find((i) => actionFor('young', i) === 'pounce');
        const peak = behaviourAt('young', k * slot + 2.65);
        expect(peak.lift).toBeGreaterThan(YOUNG_MOVES.leapHeight * 0.9);
        expect(peak.tuck).toBeGreaterThan(0.5);
        expect(peak.busy).toBe(true);
        const dive = behaviourAt('young', k * slot + 3.05);
        expect(dive.pitch).toBeLessThan(-0.5);
        const landed = behaviourAt('young', k * slot + 3.4);
        expect(landed.bursts.some((b) => b.kind === 'plume')).toBe(true);
        expect(landed.bursts.some((b) => b.kind === 'ring')).toBe(true);
        expect(behaviourAt('young', (k + 1) * slot - 0.05).dx).toBe(0);
    });

    it('lies down, rests its head and sits up again, blending its posture', () => {
        const { slot } = REPERTOIRES.sitter;
        const k = Array.from({ length: 200 }, (_, i) => i + 2)
            .find((i) => actionFor('sitter', i) === 'lie' && actionFor('sitter', i - 1) !== 'lie');
        const start = behaviourAt('sitter', k * slot + 0.4);
        expect(start.posture).toBe('lying');
        expect(start.blend).toBeGreaterThan(0);
        expect(start.blend).toBeLessThan(1);
        expect(behaviourAt('sitter', k * slot + slot / 2).head).toBeLessThan(-20);
        const posed = poseWolf({ build: 'lying', head: -38 });
        const sat = poseWolf({ build: 'sitting' });
        const between = blendRigs(posed, sat, 0.5);
        expect(Array.from(between.capsules).every(Number.isFinite)).toBe(true);
        // Every capsule of a lying wolf stays near the ground: its back is lower than a sitter's.
        expect(posed.capsules[3]).toBeLessThan(sat.capsules[3]);
    });

    it('turns to look at you for a line clear, and the young wolf bows for a combo', () => {
        const pack = own(createWolfhourPack());
        pack.update(6);
        const lead = pack.wolves.find((w) => w.spec.name === 'lead');
        expect(lead.uniforms.uEye2.value.z).toBe(0);
        pack.glance(6);
        pack.update(7);
        // Both eyes catch the moon when it faces you.
        expect(lead.uniforms.uEye2.value.z).toBeGreaterThan(0.1);
        const young = pack.wolves.find((w) => w.spec.name === 'young');
        pack.update(6.2);
        const before = young.rows.map((r) => r.toArray());
        pack.excite(6.2);
        pack.update(7.4);
        expect(young.rows.map((r) => r.toArray())).not.toEqual(before);
    });

    it('runs the young wolf on real time until the first howl', () => {
        const pack = own(createWolfhourPack());
        pack.settle(() => 0);
        for (const t of [3.2, 31.7, 77.5]) {
            pack.update(t);
            const young = pack.wolves.find((w) => w.spec.name === 'young');
            const expected = PACK.find((w) => w.name === 'young').x + behaviourAt('young', t).dx;
            expect(young.mesh.position.x).toBeCloseTo(expected, 6);
        }
    });

    it('keeps still under Reduce motion: no walking, hunting, play or shaking', () => {
        const pack = own(createWolfhourPack());
        pack.settle(() => 0);
        const young = pack.wolves.find((w) => w.spec.name === 'young');
        for (let t = 0; t < 300; t += 0.7) {
            pack.update(t, 0);
            for (const entry of [...pack.wolves, pack.answerer.wolf]) {
                expect(['pace', 'pounce', 'play', 'shake', 'stretch', 'rise']).not.toContain(entry.act?.action);
                expect(entry.uniforms.uShake.value.z).toBe(0);
            }
            expect(young.mesh.position.x).toBeCloseTo(PACK.find((w) => w.name === 'young').x, 6);
        }
    });

    it('stays on the hunt rather than howl when a howl begins in mid-pounce', () => {
        const { slot } = REPERTOIRES.young;
        const k = Array.from({ length: 200 }, (_, i) => i + 1).find((i) => actionFor('young', i) === 'pounce');
        const pack = own(createWolfhourPack());
        const t0 = k * slot + 2.5;
        expect(pack.howl(t0)).toBe(true);
        const young = pack.wolves.find((w) => w.spec.name === 'young');
        pack.update(t0 + 0.2);
        const x1 = young.mesh.position.x;
        pack.update(t0 + 0.5);
        // It keeps flying forward; the others howl.
        expect(young.mesh.position.x).toBeGreaterThan(x1);
        expect(pack.howlLevel(t0 + HOWL.rise + 0.2)).toBe(1);
    });

    it('releases every material, the shared quad and the vapour', () => {
        const pack = createWolfhourPack();
        const resources = new Set();
        for (const group of [pack.group, pack.answerer.group, pack.scout.group]) {
            group.traverse((object) => {
                if (object.geometry) resources.add(object.geometry);
                if (object.material) resources.add(object.material);
            });
        }
        const released = new Set();
        for (const resource of resources) resource.addEventListener('dispose', () => released.add(resource));
        pack.dispose();
        expect(released).toEqual(resources);
    });
});

describe('Wolfhour spruce', () => {
    it('plants belts clear of the wolves, the hut and the scout\'s path', () => {
        const landscape = own(createWolfhourLandscape({ quality: 'Low', seed: 73013 }));
        for (const belt of FOREST_BELTS) {
            const planted = plantBelt(belt, (x) => landscape.crestPoint(belt.range, x));
            expect(planted.trees).toBeGreaterThan(20);
            expect(planted.positions.every(Number.isFinite)).toBe(true);
            expect(planted.fog.every((fog) => fog >= 0 && fog <= 0.9)).toBe(true);
            for (let i = 0; i < planted.tints.length; i += 3) {
                expect(planted.tints[i + 2]).toBeGreaterThan(planted.tints[i]);
            }
            // No tree's trunk stands in a kept-clear stretch (the giants stand outside them).
            for (let v = 0; v < planted.positions.length; v += 3) {
                const trunkX = planted.positions[v] - planted.offsets[v / 3];
                const inside = belt.keepOut.some(([a, b]) => trunkX > a + 1 && trunkX < b - 1);
                const giant = (belt.giants ?? []).some(([gx]) => Math.abs(trunkX - gx) < 3);
                expect(inside && !giant).toBe(false);
            }
        }
    });

    it('stands one draw per belt on its range, none at Minimal, and keeps tree widths on resize', () => {
        const landscape = own(createWolfhourLandscape({ quality: 'Low', seed: 73013 }));
        const forest = own(createWolfhourForest({ quality: 'High' }));
        forest.stand(landscape);
        expect(forest.meshes).toHaveLength(FOREST_BELTS.length);
        forest.meshes.forEach((mesh, i) => expect(mesh.parent).toBe(landscape.group.children[FOREST_BELTS[i].range]));
        expect(forest.trees).toBeGreaterThan(60);
        const minimal = own(createWolfhourForest({ quality: 'Minimal' }));
        minimal.stand(landscape);
        expect(minimal.meshes).toHaveLength(0);
        expect(() => forest.fit(9 / 16 / (16 / 9))).not.toThrow();
    });
});

describe('Wolfhour moonlit clouds', () => {
    beforeEach(() => {
        vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(() => new THREE.Texture());
    });
    afterEach(() => vi.restoreAllMocks());

    it('drift between the moon and the mountains from Low up', () => {
        const sky = own(createWolfhourSky({ scene: new THREE.Scene(), quality: 'Low' }));
        const clouds = sky.group.getObjectByName('Wolfhour moonlit clouds');
        expect(clouds).toBeTruthy();
        expect(clouds.position.z).toBeGreaterThan(sky.moon.position.z);
        expect(clouds.position.z).toBeLessThan(-1920);
        expect(clouds.material.transparent).toBe(true);
        const minimal = own(createWolfhourSky({ scene: new THREE.Scene(), quality: 'Minimal' }));
        expect(minimal.group.getObjectByName('Wolfhour moonlit clouds')).toBeUndefined();
    });
});

describe('Wolfhour wolves on the ground', () => {
    const grounds = {
        flat: () => 0,
        uphill: (x) => x * 0.35,
        downhill: (x) => x * -0.35,
        rough: (x) => Math.sin(x * 0.45 + 1) * 1.6 + x * 0.12,
    };
    /** The lowest point of each paw's capsule (the foot: wrist to paw tip, the last of each leg). */
    const pawBottoms = (rig) => {
        const legs = [11, 14, 17, 20].map((first) => first + 2);
        return legs.map((i) => {
            const o = i * CAPSULE_STRIDE;
            const c = rig.capsules;
            const bottomA = c[o + 1] - c[o + 4];
            const bottomB = c[o + 3] - c[o + 5];
            return bottomA < bottomB ? [c[o], bottomA] : [c[o + 2], bottomB];
        });
    };

    it.each(Object.keys(grounds))('sets every standing paw on %s ground, at rest and through a stride', (name) => {
        const ground = grounds[name];
        for (const gait of [0, 0.13, 0.31, 0.5, 0.77]) {
            for (const stride of [0, 15]) {
                const rig = poseWolf({
                    build: 'standing', ground, stride, gait,
                });
                rig.paws.forEach((paw, i) => {
                    const lifted = stride > 0 && pawCycle(gait + [0.25, 0.75, 0, 0.5][i], stride)[1] > 0;
                    if (lifted) return;
                    // A planted paw stands 0.7 above the ground line at its centre...
                    expect(paw[1] - ground(paw[0])).toBeCloseTo(0.7, 6);
                });
                // ...so its pad meets the line: never floating, never buried.
                const down = (_, i) => stride === 0 || pawCycle(gait + [0.25, 0.75, 0, 0.5][i], stride)[1] === 0;
                for (const [x, bottom] of pawBottoms(rig).filter(down)) {
                    const gap = bottom - ground(x);
                    expect(gap).toBeGreaterThan(-1.6);
                    expect(gap).toBeLessThan(0.6);
                }
            }
        }
    });

    it('tilts the body with the slope, and keeps the legs within reach', () => {
        const up = poseWolf({ build: 'standing', ground: grounds.uphill });
        const down = poseWolf({ build: 'standing', ground: grounds.downhill });
        const flat = poseWolf({ build: 'standing' });
        // The torso is the first capsule: hip (a) to shoulder (b).
        const rise = (rig) => rig.capsules[3] - rig.capsules[1];
        expect(rise(up)).toBeGreaterThan(rise(flat) + 4);
        expect(rise(down)).toBeLessThan(rise(flat) - 4);
        // Upper and lower leg bones keep their lengths (no leg is pulled apart to reach a paw).
        for (const rig of [up, down, flat]) {
            for (const first of [11, 14, 17, 20]) {
                const c = rig.capsules;
                const bone = (i) => {
                    const o = i * CAPSULE_STRIDE;
                    return Math.hypot(c[o + 2] - c[o], c[o + 3] - c[o + 1]);
                };
                const upper = first < 17 ? 7.5 : 7.6;
                const lower = first < 17 ? 7.3 : 6.9;
                expect(bone(first)).toBeCloseTo(upper, 3);
                expect(bone(first + 1)).toBeCloseTo(lower, 3);
            }
        }
    });

    it('rests a sitting wolf\'s haunch and tail on the ground', () => {
        for (const ground of Object.values(grounds)) {
            const rig = poseWolf({ build: 'sitting', ground });
            for (const [x, bottom] of pawBottoms(rig)) {
                expect(bottom - ground(x)).toBeLessThan(0.8);
                expect(bottom - ground(x)).toBeGreaterThan(-1.8);
            }
        }
    });

    it('keeps a planted paw where it was put down while the scout walks', () => {
        const pack = own(createWolfhourPack());
        const ridge = (x) => Math.sin(x * 0.05) * 9 + x * 0.08;
        pack.scout.settle(ridge);
        const walk = (SCOUT.from - SCOUT.to) / SCOUT.speed;
        const start = SCOUT.first + walk * 0.4;
        const dt = 1 / 120;
        // Each paw in the scout's own frame at `t`: x along the ridge, and whether it is planted.
        const pawsAt = (t) => {
            pack.update(t, 1);
            const { wolf } = pack.scout;
            const cycle = scoutAt(t).travel / (WALK_STRIDE * SCOUT.scale);
            return wolf.paws.map((paw, i) => ({
                x: wolf.mesh.position.x + paw[0] * wolf.facing * SCOUT.scale,
                planted: pawCycle(cycle + [0.25, 0.75, 0, 0.5][i], WALK_STRIDE)[1] === 0,
            }));
        };
        const frames = Array.from({ length: 90 }, (_, k) => pawsAt(start + k * dt));
        const steps = frames.slice(1).flatMap((now, k) => now
            .map((paw, i) => [paw, frames[k][i]])
            .filter(([paw, before]) => paw.planted && before.planted)
            .map(([paw, before]) => Math.abs(paw.x - before.x)));
        expect(steps.length).toBeGreaterThan(100);
        expect(Math.max(...steps)).toBeLessThan(0.02);
    });

    it('follows the scout\'s ridge with its paws as it walks', () => {
        const pack = own(createWolfhourPack());
        const ridge = (x) => Math.sin(x * 0.05) * 9 + x * 0.08;
        pack.scout.settle(ridge);
        const walk = (SCOUT.from - SCOUT.to) / SCOUT.speed;
        for (let k = 0; k < 40; k++) {
            const t = SCOUT.first + walk * (k / 40);
            pack.update(t, 1);
            const { wolf } = pack.scout;
            for (const paw of wolf.paws) {
                const groupX = wolf.mesh.position.x + paw[0] * wolf.facing * SCOUT.scale;
                const groupY = wolf.mesh.position.y + paw[1] * SCOUT.scale;
                // On the ridge or lifted in a step (never below it, never far above it).
                expect(groupY - ridge(groupX)).toBeGreaterThan(-0.2);
                expect(groupY - ridge(groupX)).toBeLessThan(0.7 + 15 * 0.17 + 0.6);
            }
        }
    });
});

/**
 * Grainfields — the horse's skeleton (grainfields-horse-rig.js) and how it moves
 * (grainfields-horse-motion.js), with the skeleton the asset really carries: hooves that stay where
 * they strike and never sink, legs that clear the ground, a gallop with a moment in the air, gaits
 * that change without a jerk, steps taken standing, grazing at the barley's ears and at the grass,
 * a head that comes up to look, a cocked hind at rest, a tail that rides the gait. Run without a
 * renderer, in fixed steps.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    HORSE_BONES, SKIN_ROWS, boneToWorld, createPose, createRig, poseRig, writeSkinRows,
} from '../../src/themes/grainfields/grainfields-horse-rig.js';
import {
    BARLEY_TOPS, createHorseMotion, solveLeg, stepHorseMotion,
} from '../../src/themes/grainfields/grainfields-horse-motion.js';

/** The horse's own skeleton and landmarks, read from the GLB's JSON chunk. */
function horseExtras() {
    const glb = readFileSync(new URL('../../src/themes/grainfields/assets/grainfields-horse.glb', import.meta.url));
    const length = glb.readUInt32LE(12);
    return JSON.parse(glb.subarray(20, 20 + length).toString('utf8')).scenes[0].extras;
}
const EXTRAS = horseExtras();
const RIG = createRig(EXTRAS.skeleton);
const DT = 1 / 60;
const flat = () => 10;
const rolling = (x, z) => 10 + 0.4 * Math.sin(x * 0.07) * Math.cos(z * 0.05);

function horse(over = {}) {
    return {
        x: 0, z: 0, heading: 0.4, speed: 0, yawRate: 0, accel: 0, scale: 1, seed: 0.3, business: 'travel', ...over,
    };
}

/** Move a horse on at its speed for `seconds`, calling `each(m, h, t)` after every step. */
function run(m, h, seconds, each = () => {}, { ground = flat, from = 0, dt = DT } = {}) {
    for (let t = from; t < from + seconds; t += dt) {
        h.heading += (h.yawRate || 0) * dt;
        h.x += Math.sin(h.heading) * h.speed * dt;
        h.z += Math.cos(h.heading) * h.speed * dt;
        stepHorseMotion(m, h, ground, dt, t, {});
        each(m, h, t);
    }
}

const muzzleY = (m) => boneToWorld(RIG, m.pose, RIG.index.head, EXTRAS.landmarks.muzzle, m.place.scale)[1];

describe('Grainfields horse: its skeleton', () => {
    it('takes the asset\'s skeleton and refuses one it could not pose', () => {
        expect(RIG.count).toBe(38);
        HORSE_BONES.forEach((name) => expect(RIG.index[name], name).toBeDefined());
        const without = EXTRAS.skeleton.filter((bone) => bone.name !== 'tibiaR');
        expect(() => createRig(without)).toThrow('missing its "tibiaR" bone');
        const backwards = EXTRAS.skeleton.map((bone, i) => (i === 3 ? { ...bone, parent: 5 } : bone));
        expect(() => createRig(backwards)).toThrow('comes before its parent');
        const headless = EXTRAS.skeleton.map((bone, i) => (i === 7 ? { ...bone, head: [0, Number.NaN, 0] } : bone));
        expect(() => createRig(headless)).toThrow('has no head');
        expect(() => createRig([])).toThrow('no skeleton');
    });

    it('stands at rest where it was authored, and its skin table carries a vertex as its bone does', () => {
        const pose = createPose(RIG);
        const root = RIG.heads.slice(0, 3);
        poseRig(RIG, pose, {
            x: root[0], y: root[1], z: root[2], heading: 0, scale: 1,
        });
        for (let i = 0; i < RIG.count * 3; i++) expect(pose.at[i]).toBeCloseTo(RIG.heads[i], 5);
        // Turned, bent and scaled: a rest point through a bone's rows is where the bone carries it.
        pose.local.set([0.3, 0.2, -0.1], RIG.index.neck0 * 3);
        pose.local.set([0.6, 0, 0], RIG.index.foreCannonL * 3);
        pose.local.set([0, 0, 0.4], RIG.index.tail2 * 3);
        const place = {
            x: 5, y: 11, z: -3, heading: 1.1, scale: 0.7,
        };
        poseRig(RIG, pose, place);
        const rows = Array.from({ length: RIG.count * SKIN_ROWS }, () => ({
            x: 0, y: 0, z: 0, w: 0,
        }));
        writeSkinRows(RIG, pose, place.scale, rows);
        const point = [0.1, 0.3, 0.42];
        ['neck0', 'foreCannonL', 'tail2', 'head', 'hindHoofR'].forEach((name) => {
            const b = RIG.index[name];
            const q = rows[b * SKIN_ROWS];
            const t = rows[b * SKIN_ROWS + 1];
            expect(Math.hypot(q.x, q.y, q.z, q.w), name).toBeCloseTo(1, 5);
            // s q(p) + t
            const [px, py, pz] = point;
            const cx = q.y * pz - q.z * py + q.w * px;
            const cy = q.z * px - q.x * pz + q.w * py;
            const cz = q.x * py - q.y * px + q.w * pz;
            const turned = [px + 2 * (q.y * cz - q.z * cy), py + 2 * (q.z * cx - q.x * cz), pz + 2 * (q.x * cy - q.y * cx)];
            const via = turned.map((v, k) => v * t.w + [t.x, t.y, t.z][k]);
            const expected = boneToWorld(RIG, pose, b, point, place.scale);
            via.forEach((v, k) => expect(v, `${name}[${k}]`).toBeCloseTo(expected[k], 5));
        });
    });

    it('solves a leg to any foothold it can reach, and stretches as far as it can toward one it cannot', () => {
        const m = createHorseMotion(RIG);
        const [fore, , hind] = m.legs.map((leg) => leg.spec);
        for (const leg of [fore, hind]) {
            const rest = leg.coffin[1] - leg.root[1];
            const solved = solveLeg(leg, rest + 0.06, 0.25, {});
            expect(solved.reach).toBe(1);
            expect(Math.abs(solved.aim)).toBeLessThan(Math.PI);
            const far = solveLeg(leg, -3, 0, {});
            expect(far.reach).toBe(0);
            expect(far.f).toBe(leg.flex[0]);
        }
    });
});

describe('Grainfields horse: its legs', () => {
    it('keeps a planted hoof where it struck, never under the ground, and clears it in the air', () => {
        const clearance = {};
        for (const speed of [1.45, 3.8, 6.6, 11.8]) {
            const m = createHorseMotion(RIG, { seed: 0.3 });
            const h = horse({ speed, yawRate: 0.03 });
            let worstSlide = 0;
            let lowest = Infinity;
            let highest = 0;
            let planted = 0;
            let unreached = 0;
            const before = m.legs.map(() => null);
            run(m, h, 10, (mm, hh, t) => {
                if (t < 4) return;
                mm.legs.forEach((leg, i) => {
                    const ground = rolling(leg.coffin[0], leg.coffin[2]);
                    lowest = Math.min(lowest, leg.coffin[1] - ground);
                    if (!leg.planted) highest = Math.max(highest, leg.coffin[1] - ground);
                    else {
                        planted += 1;
                        if (!leg.now.reach) unreached += 1;
                    }
                    // While the heel is down (the first four fifths of the stance) the coffin is still.
                    const prev = before[i];
                    if (prev && prev.planted && leg.planted && leg.now.reach && prev.reach && t - leg.landed > 0.02) {
                        const psi = (((mm.phase - mm.gait.offsets[i]) % 1) + 1) % 1;
                        if (psi / mm.gait.duty < 0.7) {
                            worstSlide = Math.max(worstSlide, Math.hypot(leg.coffin[0] - prev.x, leg.coffin[2] - prev.z));
                        }
                    }
                    before[i] = {
                        planted: leg.planted, reach: leg.now.reach, x: leg.coffin[0], z: leg.coffin[2],
                    };
                });
            }, { ground: rolling });
            expect(worstSlide, `slide at ${speed}`).toBeLessThan(0.002);
            expect(lowest, `sink at ${speed}`).toBeGreaterThan(0.035);
            expect(unreached / planted, `reach at ${speed}`).toBeLessThan(0.08);
            clearance[speed] = highest;
        }
        // The faster the gait, the higher a hoof is carried.
        expect(clearance[1.45]).toBeGreaterThan(0.12);
        expect(clearance[11.8]).toBeGreaterThan(0.3);
        expect(clearance[11.8]).toBeGreaterThan(clearance[3.8]);
        expect(clearance[3.8]).toBeGreaterThan(clearance[1.45]);
    });

    it('walks on two feet or more, and gallops through a moment with all four in the air', () => {
        const count = (speed) => {
            const m = createHorseMotion(RIG, { seed: 0.6 });
            const h = horse({ speed });
            let fewest = 4;
            let airborne = 0;
            run(m, h, 8, (mm, hh, t) => {
                if (t < 3) return;
                const down = mm.legs.filter((leg) => leg.planted).length;
                fewest = Math.min(fewest, down);
                if (down === 0) airborne += 1;
            });
            return { fewest, airborne };
        };
        expect(count(1.45).fewest).toBeGreaterThanOrEqual(2);
        expect(count(1.45).airborne).toBe(0);
        expect(count(11.8).airborne).toBeGreaterThan(20);
    });

    it('breaks from a stand to a gallop and back without a jerk in any joint', () => {
        const m = createHorseMotion(RIG, { seed: 0.2 });
        const h = horse({ business: 'travel' });
        let worst = 0;
        let last = null;
        // (In fine steps: a galloping hoof is down for five frames of a 60 Hz display, and its fetlock
        // really does turn half a radian a frame; a pop would jump however fine the step.)
        run(m, h, 40, (mm, hh, t) => {
            hh.speed = 12 * Math.max(0, Math.sin((Math.PI * t) / 36));
            const now = Array.from(mm.pose.local);
            if (last) now.forEach((v, i) => { worst = Math.max(worst, Math.abs(v - last[i])); });
            last = now;
        }, { dt: 1 / 240 });
        expect(worst).toBeLessThan(0.25);
        expect(m.g).toBeLessThan(0.5);
    });

    it('steps round on the spot when it turns, and squares up under itself when it stands', () => {
        const m = createHorseMotion(RIG, { seed: 0.4 });
        const h = horse({ business: 'look' });
        run(m, h, 2);
        let lifts = 0;
        let wasDown = m.legs.map((leg) => leg.planted);
        let most = 0;
        h.yawRate = 0.6;
        run(m, h, 2.6, (mm) => {
            mm.legs.forEach((leg, i) => {
                if (wasDown[i] && !leg.planted) lifts += 1;
            });
            wasDown = mm.legs.map((leg) => leg.planted);
            most = Math.max(most, mm.legs.filter((leg) => !leg.planted).length);
        }, { from: 2 });
        // A quarter turn takes a step of every leg, one at a time.
        expect(lifts).toBeGreaterThanOrEqual(4);
        expect(most).toBe(1);
        h.yawRate = 0;
        run(m, h, 8, () => {}, { from: 5 });
        expect(m.legs.every((leg) => leg.planted)).toBe(true);
    });

    it('runs its gaits on a treadmill: kept on the spot, its hooves are carried back under it', () => {
        const m = createHorseMotion(RIG, { seed: 0.7 });
        const h = horse({ speed: 3.8, treadmill: true });
        let travel = 0;
        const start = { x: h.x, z: h.z };
        let lowest = Infinity;
        for (let t = 0; t < 6; t += DT) {
            stepHorseMotion(m, h, flat, DT, t, {});
            if (t > 2) {
                lowest = Math.min(lowest, ...m.legs.map((leg) => leg.coffin[1] - 10));
                const behind = m.legs.filter((leg) => leg.planted)
                    .map((leg) => (leg.coffin[0] - h.x) * Math.sin(h.heading) + (leg.coffin[2] - h.z) * Math.cos(h.heading));
                travel = Math.min(travel, ...behind);
            }
        }
        expect(Math.hypot(h.x - start.x, h.z - start.z)).toBe(0);
        // Its planted hooves are carried back past its hind feet's rest, as if the ground ran on.
        expect(travel).toBeLessThan(-0.9);
        expect(lowest).toBeGreaterThan(0.035);
    });

    it('rests a hind leg cocked on the toe of its hoof, on its own side', () => {
        for (const seed of [0.2, 0.8]) {
            const m = createHorseMotion(RIG, { seed });
            const h = horse({ business: 'rest', seed });
            run(m, h, 12);
            const [hindLeft, hindRight] = [m.legs[2], m.legs[3]];
            const lift = (leg) => leg.coffin[1] - 10;
            const resting = seed < 0.5 ? hindLeft : hindRight;
            const standing = seed < 0.5 ? hindRight : hindLeft;
            expect(m.rest).toBeGreaterThan(0.9);
            expect(lift(resting)).toBeGreaterThan(lift(standing) + 0.02);
        }
    });

    it('stays whole under long, ragged steps (a seek, a dropped frame)', () => {
        const m = createHorseMotion(RIG, { seed: 0.5 });
        const h = horse({ speed: 11.8 });
        run(m, h, 20, (mm) => {
            expect(Array.from(mm.pose.local).every(Number.isFinite)).toBe(true);
            expect(Array.from(mm.pose.at).every(Number.isFinite)).toBe(true);
        }, { dt: 0.25 });
    });
});

describe('Grainfields horse: its head, ears and tail', () => {
    it('browses the barley\'s ears, grazes the verge\'s grass at its feet, and looks up over the stand', () => {
        const heights = (over) => {
            const m = createHorseMotion(RIG, { seed: 0.42, landmarks: EXTRAS.landmarks });
            const h = horse({ business: 'graze', ...over });
            const out = [];
            run(m, h, 30, (mm, hh, t) => { if (t > 4) out.push(muzzleY(mm) - 10); });
            return { min: Math.min(...out), mean: out.reduce((a, b) => a + b, 0) / out.length, max: Math.max(...out) };
        };
        const barley = heights({});
        expect(barley.mean).toBeGreaterThan(BARLEY_TOPS - 0.2);
        expect(barley.mean).toBeLessThan(BARLEY_TOPS + 0.12);
        expect(barley.max - barley.min).toBeGreaterThan(0.1);
        const verge = heights({ verge: true });
        expect(verge.min).toBeLessThan(0.12);
        expect(verge.mean).toBeLessThan(0.3);
        const look = heights({ business: 'look' });
        expect(look.min).toBeGreaterThan(BARLEY_TOPS + 0.4);
        // A foal browses lower: it reaches what it can.
        const foal = heights({ scale: 0.62, foal: true });
        expect(foal.mean).toBeLessThan(barley.mean);
    });

    it('works its jaw as it chews, and tugs its head to tear a mouthful away', () => {
        const m = createHorseMotion(RIG, { seed: 0.42, landmarks: EXTRAS.landmarks });
        const h = horse({ business: 'graze' });
        const stages = new Set();
        let jawTurns = 0;
        let lastJaw = 0;
        let tug = 0;
        run(m, h, 30, (mm) => {
            stages.add(mm.eat.stage);
            const jaw = mm.pose.local[RIG.index.jaw * 3];
            if (mm.eat.stage === 'chew' && Math.sign(jaw - 0.05) !== Math.sign(lastJaw - 0.05)) jawTurns += 1;
            lastJaw = jaw;
            tug = Math.min(tug, mm.head.tugPitch.x);
        });
        expect([...stages].sort()).toEqual(['bite', 'chew', 'reach', 'tear']);
        expect(jawTurns).toBeGreaterThan(20);
        expect(tug).toBeLessThan(-0.08);
    });

    it('pricks its ears forward when startled, pins them back at a gallop, lops them dozing', () => {
        const ears = (over, seconds = 6) => {
            const m = createHorseMotion(RIG, { seed: 0.1 });
            const h = horse(over);
            run(m, h, seconds);
            const L = RIG.index.earL * 3;
            return { pitch: m.pose.local[L], lop: m.pose.local[L + 2] };
        };
        expect(ears({ business: 'look', alert: 1 }).pitch).toBeGreaterThan(0.2);
        expect(ears({ speed: 11.8 }).pitch).toBeLessThan(-0.4);
        expect(ears({ business: 'rest' }, 10).lop).toBeGreaterThan(0.5);
    });

    it('carries its tail with the gait and swishes it standing', () => {
        const tail = (over, seconds = 12) => {
            const m = createHorseMotion(RIG, { seed: 0.25 });
            const h = horse(over);
            let lift = 0;
            let swingLo = 0;
            let swingHi = 0;
            run(m, h, seconds, (mm, hh, t) => {
                if (t < 3) return;
                lift += mm.pose.local[RIG.index.tail0 * 3];
                const swing = mm.pose.local[RIG.index.tail3 * 3 + 2];
                swingLo = Math.min(swingLo, swing);
                swingHi = Math.max(swingHi, swing);
            });
            return { lift: lift / ((seconds - 3) / DT), swing: swingHi - swingLo };
        };
        const gallop = tail({ speed: 11.8 });
        const stand = tail({ business: 'swat' }, 20);
        expect(gallop.lift).toBeGreaterThan(0.4);
        expect(stand.lift).toBeLessThan(0.15);
        expect(stand.swing).toBeGreaterThan(0.2);
    });
});

describe('Grainfields horse: its quiet business', () => {
    const begin = (m, h, business, at) => {
        h.business = business;
        run(m, h, 4, () => {}, { from: at });
    };

    it('yawns with its mouth wide, shakes its head and neck, stamps a fore at a fly and puts it back', () => {
        const m = createHorseMotion(RIG, { seed: 0.3, landmarks: EXTRAS.landmarks });
        const h = horse({ business: 'look' });
        run(m, h, 3);
        let jaw = 0;
        run(m, h, 3, (mm) => { jaw = Math.max(jaw, mm.pose.local[RIG.index.jaw * 3]); }, { from: 3 });
        expect(jaw).toBeLessThan(0.1);
        h.business = 'yawn';
        run(m, h, 3, (mm) => { jaw = Math.max(jaw, mm.pose.local[RIG.index.jaw * 3]); }, { from: 6 });
        expect(jaw).toBeGreaterThan(0.4);
        // A shake swings the neck from side to side, several times.
        h.business = 'shake';
        let turns = 0;
        let last = 0;
        run(m, h, 1.4, (mm) => {
            const yaw = mm.pose.local[RIG.index.neck2 * 3 + 1];
            if (Math.abs(yaw) > 0.05 && Math.sign(yaw) !== Math.sign(last)) turns += 1;
            if (Math.abs(yaw) > 0.05) last = yaw;
        }, { from: 9 });
        expect(turns).toBeGreaterThanOrEqual(4);
        // A stamp lifts one fore well clear of the ground, and it comes down where it stood.
        h.business = 'graze';
        run(m, h, 2, () => {}, { from: 10.5 });
        const fore = m.legs[m.seed < 0.5 ? 0 : 1];
        const before = [...fore.plant];
        h.business = 'stamp';
        let lift = 0;
        run(m, h, 1.2, () => { lift = Math.max(lift, fore.coffin[1] - 10); }, { from: 12.5 });
        expect(lift).toBeGreaterThan(0.2);
        expect(fore.planted).toBe(true);
        expect(Math.hypot(fore.plant[0] - before[0], fore.plant[2] - before[2])).toBeLessThan(0.15);
    });

    it('bucks: the croup up and the hinds kicked out, then down again', () => {
        const m = createHorseMotion(RIG, { seed: 0.2 });
        const h = horse({ business: 'graze', foal: true, scale: 0.62 });
        run(m, h, 2);
        const croup = () => m.pose.at[RIG.index.tail0 * 3 + 1] - m.pose.at[RIG.index.chest * 3 + 1];
        const level = croup();
        begin(m, h, 'frolic', 2);
        expect(m.buckAt).toBeGreaterThan(1.9);
        let highest = -Infinity;
        run(m, h, 0.6, () => { highest = Math.max(highest, croup()); }, { from: m.buckAt });
        expect(highest).toBeGreaterThan(level + 0.08);
        run(m, h, 2, () => {}, { from: m.buckAt + 0.6 });
        expect(croup()).toBeLessThan(level + 0.05);
    });
});

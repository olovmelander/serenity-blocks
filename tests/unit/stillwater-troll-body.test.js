/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Stillwater — the troll's body (stillwater-troll-body.js), posed from the real skeleton.
 *
 * He is not played from clips: every frame his feet, hips, staff and lantern are worked out from
 * what he means to do. These tests take his skeleton from the file the game loads
 * (troll-lod1.glb's extras) and stand him on the tarn's real ground (stillwater-plan.js), then
 * walk him through a night: off his stone, down the bank to the water's edge, into the shallows,
 * down on his haunches to the water, home again, and down onto his stone. What his motion promises
 * is pinned (a planted foot does not slide, a step lands on the ground, the feet take turns, he
 * arrives and faces what he is asked to, an act turned back does not jump, a replay is the same),
 * not the paces and timings it is tuned with.
 *
 * A test marked `it.fails` pins a fault that is known and left open: it says what it expects and
 * what happens instead, and turns red the day the fault is fixed (drop `.fails` then).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    ACT_TIME, STAFF, TrollBody, parentsFromSpec, restFromSpec,
} from '../../src/themes/stillwater/stillwater-troll-body.js';
import { wrapAngle } from '../../src/themes/stillwater/stillwater-motion.js';
import { HEART, SPIRIT, TROLL } from '../../src/themes/stillwater/stillwater-core.js';
import { groundHeight } from '../../src/themes/stillwater/stillwater-plan.js';

/** The skeleton the game poses: the troll's file, read as the loader would read its extras. */
const SPEC = (() => {
    const bytes = readFileSync(new URL('../../src/themes/stillwater/assets/troll-lod1.glb', import.meta.url));
    const length = bytes.readUInt32LE(12);
    return JSON.parse(bytes.toString('utf8', 20, 20 + length).trim()).scenes[0].extras;
})();

const DT = 1 / 60;
const HOME = [TROLL.home[0], TROLL.home[2]];
const REACH = [TROLL.reach[0], TROLL.reach[2]];
const SHALLOWS = [TROLL.shallows[0], TROLL.shallows[2]];
/** He faces across the water to her. */
const FACE = Math.atan2(SPIRIT.home[0] - TROLL.home[0], SPIRIT.home[2] - TROLL.home[2]);
const HER = [SPIRIT.home[0], 1.4, SPIRIT.home[2]];

function makeBody() {
    const body = new TrollBody(restFromSpec(SPEC), {
        sole: SPEC.sole, height: TROLL.height, ground: groundHeight, parents: parentsFromSpec(SPEC),
    });
    body.reset(HOME[0], HOME[1], FACE, { seated: true, seat: [...TROLL.seat] });
    return body;
}

/** What he means to do, as the story would put it. */
const want = (at, extra = {}) => ({
    at: [...at], face: FACE, sit: false, staff: 'walk', crouch: false, look: HER, reach: 0, pace: TROLL.pace, ...extra,
});

/** A night of his: each line is what he is asked, and for how long. */
const NIGHT = [
    ['sits on his stone', want(HOME, { sit: true }), 3],
    ['gets up', want(HOME), 3],
    ['walks down to the water\'s edge', want(REACH), 9],
    ['wades into the shallows', want(SHALLOWS), 9],
    ['crouches to the water', want(SHALLOWS, { crouch: true, staff: 'dip', look: [HEART[0], 0, HEART[2]] }), 4],
    ['rises', want(SHALLOWS), 3],
    ['walks home', want(HOME, { staff: 'high', pace: 0.42, heavy: true }), 15],
    ['sits again', want(HOME, { sit: true }), 5],
];

/** Live through a script; `each(body, label, time, i)` after every frame. Returns the clock. */
function live(body, script, { start = 0, dt = DT, each = null } = {}) {
    let time = start;
    for (const [label, wanted, seconds] of script) {
        const frames = Math.round(seconds / dt);
        for (let i = 0; i < frames; i++) {
            time += dt;
            body.update(dt, wanted, time);
            if (each) each(body, label, time, i);
        }
    }
    return time;
}

/** Every number of his pose: each bone's turn, his hips, his place, his staff and lantern. */
function poseOf(body) {
    return [
        ...Object.keys(body.local).flatMap((name) => body.local[name].toArray()),
        ...body.hipsOffset.toArray(), ...body.root.toArray(), body.heading,
        ...body.lanternAt.toArray(), ...body.hookAt.toArray(),
        ...body.feet.L.pos.toArray(), ...body.feet.R.pos.toArray(),
    ];
}

const BONE_OF = { L: 'footL', R: 'footR' };
const THIGH_OF = { L: 'thighL', R: 'thighR' };

describe('stillwater troll body: his feet', () => {
    it('keeps a planted foot where it landed: it never slides while it bears him', () => {
        const body = makeBody();
        const planted = { L: null, R: null };
        let drift = 0;
        let steps = 0;
        live(body, NIGHT, {
            each: (b) => {
                for (const side of ['L', 'R']) {
                    const foot = b.feet[side];
                    if (foot.swing) {
                        planted[side] = null;
                        continue;
                    }
                    if (planted[side]) drift = Math.max(drift, foot.pos.distanceTo(planted[side]));
                    else {
                        planted[side] = foot.pos.clone();
                        steps += 1;
                    }
                }
            },
        });
        expect(drift).toBeLessThan(1e-6);
        // (He did walk: there and back is a good many steps.)
        expect(steps).toBeGreaterThan(12);
    });

    it('sets every foot down on the ground, and keeps every planted foot on it', () => {
        const body = makeBody();
        const off = [];
        let falls = 0;
        live(body, NIGHT, {
            each: (b, label) => {
                for (const e of b.events) {
                    if (e.type !== 'footfall') continue;
                    falls += 1;
                    const gap = e.y - groundHeight(e.x, e.z);
                    if (gap !== 0) off.push(`${label}: a footfall ${gap} m off`);
                }
                for (const side of ['L', 'R']) {
                    const foot = b.feet[side];
                    if (foot.swing) continue;
                    const gap = foot.pos.y - groundHeight(foot.pos.x, foot.pos.z);
                    if (gap !== 0 && off.length < 10) off.push(`${label}: ${side} planted ${gap} m off`);
                }
            },
        });
        expect(off).toEqual([]);
        expect(falls).toBeGreaterThan(12);
    });

    it('takes his steps one foot after the other while he walks', () => {
        const body = makeBody();
        const falls = [];
        live(body, NIGHT, {
            each: (b, label) => {
                for (const e of b.events) if (e.type === 'footfall') falls.push({ ...e, label });
            },
        });
        const walking = falls.filter((e) => e.strength === 1);
        expect(walking.length).toBeGreaterThan(8);
        const repeats = [];
        for (let i = 1; i < falls.length; i++) {
            // A step taken on the move never follows a step of the same foot.
            if (falls[i].strength === 1 && falls[i].side === falls[i - 1].side) repeats.push(`${falls[i].label} #${i}`);
        }
        expect(repeats).toEqual([]);
        expect(new Set(walking.map((e) => e.side))).toEqual(new Set(['L', 'R']));
    });

    // The knee bends: the shin's turn is taken relative to the thigh's (each in a quaternion of
    // its own), so wherever the leg can reach its foot the posed ankle is on it, seated, crouched or
    // walking. (Found pinned: both turns once shared one scratch quaternion and the knee never bent.)
    it('puts each ankle where its foot stands, wherever the leg can reach it', () => {
        const body = makeBody();
        const leg = {
            L: body.legs.L, R: body.legs.R,
        };
        const target = new THREE.Vector3();
        const posed = new THREE.Vector3();
        let reachable = 0;
        let worst = 0;
        live(body, NIGHT, {
            each: (b) => {
                for (const side of ['L', 'R']) {
                    const foot = b.feet[side];
                    if (foot.swing) continue;
                    target.copy(foot.pos);
                    target.y += b.ankleUp * b.H;
                    b.toModel(target, target);
                    const hip = b.globalPos[THIGH_OF[side]];
                    if (hip.distanceTo(target) > leg[side].l1 + leg[side].l2 - 1e-3) continue;
                    reachable += 1;
                    posed.copy(b.globalPos[BONE_OF[side]]);
                    worst = Math.max(worst, posed.distanceTo(target) * b.H);
                }
            },
        });
        expect(reachable).toBeGreaterThan(500);
        expect(worst).toBeLessThan(1e-6);
    });

    // His left hand closes on the staff wherever the arm can reach the grip: not beyond the arm's
    // length, and not nearer the shoulder than a fully folded elbow lets it (|upper − fore|).
    it('closes his left hand on his staff, wherever his arm can reach it', () => {
        const body = makeBody();
        const arm = body.arms.L;
        let reachable = 0;
        let worst = 0;
        live(body, NIGHT, {
            each: (b) => {
                const grip = b.staffGripModel();
                if (!grip) return;
                const shoulder = b.globalPos.upperL;
                const d = shoulder.distanceTo(grip);
                if (d > arm.l1 + arm.l2 - 1e-3 || d < Math.abs(arm.l1 - arm.l2) + 1e-3) return;
                reachable += 1;
                worst = Math.max(worst, b.globalPos.handL.distanceTo(grip) * b.H);
            },
        });
        expect(reachable).toBeGreaterThan(200);
        expect(worst).toBeLessThan(1e-6);
    });
});

describe('stillwater troll body: where he goes', () => {
    it('arrives within a step of where he is sent, and turns to face what he is asked to', () => {
        const body = makeBody();
        const toHeart = (at) => Math.atan2(HEART[0] - at[0], HEART[2] - at[1]);
        const stops = [
            ['the water\'s edge', REACH, FACE],
            ['the shallows', SHALLOWS, toHeart(SHALLOWS)],
            ['the water\'s edge again', REACH, toHeart(REACH)],
            ['home', HOME, FACE],
        ];
        let time = live(body, [['gets up', want(HOME), 3]]);
        for (const [label, at, face] of stops) {
            time = live(body, [[label, want(at, { face }), 14]], { start: time });
            expect(body.mode, label).toBe('standing');
            expect(Math.hypot(body.root.x - at[0], body.root.z - at[1]), label).toBeLessThan(0.2);
            expect(Math.abs(wrapAngle(body.heading - face)), label).toBeLessThan(0.1);
            expect(body.speed, label).toBeLessThan(0.01);
            // Both feet under him, both on the ground.
            expect(body.anySwing(), label).toBe(false);
            for (const side of ['L', 'R']) {
                expect(Math.hypot(body.feet[side].pos.x - body.root.x, body.feet[side].pos.z - body.root.z), label)
                    .toBeLessThan(TROLL.height * 0.4);
            }
        }
    });

    it('walks toward where he is sent, never faster than his pace', () => {
        const body = makeBody();
        let fastest = 0;
        let last = null;
        live(body, [['gets up', want(HOME), 3], ['walks to the shallows', want(SHALLOWS), 12]], {
            each: (b, label) => {
                if (last) fastest = Math.max(fastest, Math.hypot(b.root.x - last.x, b.root.z - last.z) / DT);
                last = b.root.clone();
                if (label !== 'gets up') expect(b.speed).toBeLessThanOrEqual(TROLL.pace * 1.0001);
            },
        });
        expect(fastest).toBeGreaterThan(TROLL.pace * 0.5);
        expect(fastest).toBeLessThanOrEqual(TROLL.pace * 1.0001);
    });

    it('walks home to his stone when asked to sit, and sits there: lower, and further back', () => {
        const body = makeBody();
        let time = live(body, [['gets up', want(HOME), 3], ['walks to the edge', want(REACH), 9]]);
        expect(body.mode).toBe('standing');
        const standing = body.hipsOffset.clone();
        // Asked to sit at home, he walks back first and sits there.
        time = live(body, [['asked to sit at home', want(HOME, { sit: true }), 14]], { start: time });
        expect(body.mode).toBe('seated');
        expect(body.sitK).toBe(1);
        expect(Math.hypot(body.root.x - HOME[0], body.root.z - HOME[1])).toBeLessThan(0.2);
        // Seated, his hips are lower and further back than standing.
        expect(body.hipsOffset.y).toBeLessThan(standing.y - 0.02);
        expect(body.hipsOffset.z).toBeLessThan(standing.z - 0.02);
        // He does not set off while he sits: asked elsewhere, he gets up first.
        let moved = false;
        const seat = body.root.clone();
        live(body, [['asked to the edge', want(REACH), ACT_TIME.standUp * 0.9]], {
            start: time,
            each: (b) => {
                if (b.root.distanceTo(seat) > 1e-9) moved = true;
            },
        });
        expect(body.mode).toBe('standUp');
        expect(moved).toBe(false);
    });

    // He sits only by his seat stone, wherever else he is asked to (found pinned: he once sat down
    // at the water's edge on the air).
    it('sits only where he stands by his seat', () => {
        const body = makeBody();
        const time = live(body, [['gets up', want(HOME), 3], ['walks to the edge', want(REACH), 9]]);
        expect(body.mode).toBe('standing');
        live(body, [['asked to sit at the edge', want(REACH, { sit: true }), 4]], { start: time });
        expect(body.mode).toBe('standing');
        expect(body.sitK).toBe(0);
    });
});

describe('stillwater troll body: acts', () => {
    /** The largest change of his hips (m) and of any bone's turn (rad) from one frame to the next, through a script. */
    function roughest(script, start) {
        const body = makeBody();
        const time = live(body, start);
        let hips = 0;
        let turn = 0;
        let prevHips = body.hipsOffset.clone().multiplyScalar(body.H);
        const prevLocal = Object.fromEntries(Object.entries(body.local).map(([k, q]) => [k, q.clone()]));
        const modes = new Set();
        live(body, script, {
            start: time,
            each: (b) => {
                modes.add(b.mode);
                const now = b.hipsOffset.clone().multiplyScalar(b.H);
                hips = Math.max(hips, now.distanceTo(prevHips));
                prevHips = now;
                for (const name of ['hips', 'spine', 'chest', 'thighL', 'thighR']) {
                    turn = Math.max(turn, b.local[name].angleTo(prevLocal[name]));
                    prevLocal[name] = b.local[name].clone();
                }
            },
        });
        return {
            hips, turn, modes, body,
        };
    }

    it('turns a sitting down back from where it has got to, without a jump', () => {
        const up = [['gets up', want(HOME), 4]];
        // Sitting down all the way, for how fast an act moves him at most.
        const whole = roughest([['sits', want(HOME, { sit: true }), ACT_TIME.sitDown + 1]], up);
        expect(whole.modes).toContain('sitDown');
        expect(whole.body.mode).toBe('seated');
        // Halfway down he is asked to stand again: he gets up from where he got to.
        const cut = roughest([
            ['sits', want(HOME, { sit: true }), ACT_TIME.sitDown * 0.5],
            ['changes his mind', want(HOME), ACT_TIME.standUp + 1],
        ], up);
        expect(cut.modes).toContain('sitDown');
        expect(cut.modes).toContain('standUp');
        expect(cut.body.mode).toBe('standing');
        // (Its own curves do not meet at the turn: the ease takes the step out of it, so the
        // turn is a little brisker than the act's own fastest frame, never a jump.)
        expect(cut.hips).toBeLessThan(Math.max(whole.hips * 2, 0.004));
        expect(cut.hips).toBeLessThan(0.02);
        expect(cut.turn).toBeLessThan(Math.max(whole.turn * 2, 0.02));
    });

    it('turns a crouching back from where it has got to, without a jump', () => {
        const there = [['gets up', want(HOME), 4], ['walks to the shallows', want(SHALLOWS), 14]];
        const crouching = want(SHALLOWS, { crouch: true, staff: 'dip' });
        const whole = roughest([['crouches', crouching, ACT_TIME.crouch + 1]], there);
        expect(whole.body.mode).toBe('crouched');
        const cut = roughest([
            ['crouches', want(SHALLOWS, { crouch: true, staff: 'dip' }), ACT_TIME.crouch * 0.5],
            ['changes his mind', want(SHALLOWS), ACT_TIME.rise + 1],
        ], there);
        expect(cut.modes).toContain('crouch');
        expect(cut.modes).toContain('rise');
        expect(cut.body.mode).toBe('standing');
        expect(cut.hips).toBeLessThan(Math.max(whole.hips * 2, 0.004));
        expect(cut.hips).toBeLessThan(0.02);
        expect(cut.turn).toBeLessThan(Math.max(whole.turn * 2, 0.02));
    });
});

describe('stillwater troll body: his staff and his lantern', () => {
    it('keeps his lantern by him, and lowers it to the water when he crouches there with his staff dipped', () => {
        const body = makeBody();
        let farthest = 0;
        let dipped = null;
        live(body, NIGHT, {
            each: (b, label) => {
                expect(b.lanternAt.toArray().every(Number.isFinite), label).toBe(true);
                farthest = Math.max(farthest, b.lanternAt.distanceTo(b.root));
                if (label === 'crouches to the water' && b.mode === 'crouched') dipped = b.lanternAt.clone();
            },
        });
        expect(farthest).toBeLessThan(STAFF.length + 1.5);
        expect(dipped).not.toBeNull();
        expect(Math.abs(dipped.y)).toBeLessThan(0.3);
        // Out over the water, in front of him.
        expect(groundHeight(dipped.x, dipped.z)).toBeLessThan(0);
    });

    it('lifts the lantern over his head for light coming home, and carries it high on his way home', () => {
        const body = makeBody();
        let time = live(body, [['gets up', want(HOME), 4]]);
        const low = body.lanternAt.y - body.root.y;
        time = live(body, [['lifts it', want(HOME, { staff: 'raise' }), 3]], { start: time });
        expect(body.staff.mode).toBe('held');
        const raised = body.lanternAt.y - body.root.y;
        expect(raised).toBeGreaterThan(low + 0.3);
        expect(raised).toBeGreaterThan(TROLL.height * 0.8);
        live(body, [['walks to the edge', want(REACH, { staff: 'high' }), 9]], { start: time });
        expect(body.lanternAt.y - body.root.y).toBeGreaterThan(low);
    });

    it('stands his staff on the ground while he leans on it', () => {
        const body = makeBody();
        const settle = 3;
        const places = [
            ['standing at home', want(HOME), 4],
            ['standing at the edge', want(REACH), 12],
            ['seated', want(HOME, { sit: true }), 16],
        ];
        let time = 0;
        for (const [label, wanted, seconds] of places) {
            time = live(body, [[label, wanted, seconds + settle]], { start: time });
            const st = body.staff;
            expect(st.mode, label).toBe('planted');
            expect(st.tip.y, label).toBeCloseTo(groundHeight(st.tip.x, st.tip.z), 9);
            // Its foot is where its tip stands, and the staff leans up from it toward his hand.
            expect(st.foot.distanceTo(st.tip), label).toBeLessThan(0.02);
            expect(st.dirN.y, label).toBeGreaterThan(0.25);
            expect(st.top.y, label).toBeGreaterThan(st.foot.y + STAFF.length * 0.25);
        }
        expect(body.mode).toBe('seated');
    });
});

describe('stillwater troll body: soundness', () => {
    it('stays finite and whole through frames of no time, long frames and every act', () => {
        const body = makeBody();
        const frames = [0, DT, 0.1, 0.25, 1e-7, 0, DT * 3, 2];
        const wants = [
            want(HOME, { sit: true }), want(REACH), want(SHALLOWS, { crouch: true, staff: 'dip' }),
            want(SHALLOWS, { staff: 'offer', reach: 1 }), want(HOME, { staff: 'raise', look: null }),
            want(REACH, {
                staff: 'high', startle: true, doze: true, wind: 3,
            }), want([HOME[0] + 0.05, HOME[1]], { sit: true }),
        ];
        let time = 0;
        const faults = [];
        for (let i = 0; i < 4000; i++) {
            const dt = frames[i % frames.length];
            time += dt;
            body.update(dt, wants[Math.floor(i / 150) % wants.length], time);
            for (const [name, q] of Object.entries(body.local)) {
                const whole = q.toArray().every(Number.isFinite) && Math.abs(q.length() - 1) <= 1e-6;
                if (!whole) faults.push(`${i}: ${name}`);
            }
            const numbers = [...body.root.toArray(), ...body.hipsOffset.toArray(), body.heading,
                ...body.lanternAt.toArray(), ...body.hookAt.toArray()];
            if (!numbers.every(Number.isFinite)) faults.push(`${i}: ${numbers}`);
            if (faults.length > 5) break;
        }
        expect(faults).toEqual([]);
    });

    it('moves the same for the same wants: two of him, frame for frame', () => {
        const a = makeBody();
        const b = makeBody();
        const poses = [];
        live(a, NIGHT, { each: (body) => poses.push(poseOf(body)) });
        let frame = 0;
        let differ = 0;
        live(b, NIGHT, {
            each: (body) => {
                const pose = poseOf(body);
                if (pose.some((v, k) => v !== poses[frame][k])) differ += 1;
                frame += 1;
            },
        });
        expect(frame).toBe(poses.length);
        expect(differ).toBe(0);
    });

    // A reset keeps nothing of his walk: the springs' own speeds are cleared with his velocity
    // (found pinned: a reset body drifted and turned).
    it('stands as he did at the start when he is set down again: a reset keeps nothing of his walk', () => {
        const fresh = makeBody();
        const walked = makeBody();
        // One is set down in the middle of setting off, the other has done nothing.
        live(walked, [['gets up', want(HOME), 4], ['sets off', want(SHALLOWS), 0.8]]);
        expect(walked.speed).toBeGreaterThan(0.05);
        for (const body of [fresh, walked]) body.reset(HOME[0], HOME[1], FACE, { seated: false });
        const script = [['stands', want(HOME), 1], ['walks to the edge', want(REACH), 3]];
        const poses = [];
        live(fresh, script, { start: 50, each: (body) => poses.push(poseOf(body)) });
        let frame = 0;
        let worst = 0;
        live(walked, script, {
            start: 50,
            each: (body) => {
                const pose = poseOf(body);
                pose.forEach((v, k) => {
                    worst = Math.max(worst, Math.abs(v - poses[frame][k]));
                });
                frame += 1;
            },
        });
        expect(worst).toBe(0);
    });

    it('reads his rest skeleton and parents from the file\'s bone list', () => {
        const rest = restFromSpec(SPEC);
        const parents = parentsFromSpec(SPEC);
        expect(Object.keys(rest)).toEqual(SPEC.bones.map((b) => b.name));
        SPEC.bones.forEach((b) => {
            expect(rest[b.name].toArray()).toEqual(b.head);
            expect(parents[b.name]).toBe(b.parent >= 0 ? SPEC.bones[b.parent].name : null);
        });
        expect(restFromSpec({})).toEqual({});
        expect(parentsFromSpec({})).toEqual({});
        // His two legs and two arms are found by name, each of two bones of some length.
        const body = makeBody();
        for (const limb of [body.legs.L, body.legs.R, body.arms.L, body.arms.R]) {
            expect(limb).toBeTruthy();
            expect(limb.l1).toBeGreaterThan(0.05);
            expect(limb.l2).toBeGreaterThan(0.05);
        }
    });
});

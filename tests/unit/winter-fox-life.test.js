/**
 * Winter — the arctic fox's own life: its paces at rest, the acts no other fox has, what it
 * chooses when it stops, its romp, what it answers the board with, and its prints. No three,
 * no GPU. (What every fox does, on this fox, is winter-fox-mind.test.js and winter-fox-rig.test.js;
 * the visitor is winter-fox-visitor.test.js.)
 *
 * What is pinned is what holds by construction — a paw in stance does not slide at any pace, a
 * bound is off the snow only while every paw is, an act begins and ends standing, a paw that goes
 * round after its tail stays where it was put down, the same seed is the same night — and what the
 * pass was for: many kinds of stop and seldom one twice running, every pace used, the night
 * swaying what it chooses. Tuning is read from the modules; the test's own numbers are generous.
 */

import { describe, expect, it } from 'vitest';
import {
    AFTER_ZOOM, FOX_PACES, FOX_RANGE, FOX_TROT, FOX_WANDER_STOPS, FoxMind, RoamingFoxMind, ZOOM,
} from '../../src/themes/winter/winter-fox-mind.js';
import {
    BATH_WRIGGLE, FOOT, FOX_ACTS, FOX_LEGS, FOX_MARKS, FOX_RIG, MOUSE_AIR, PRONK_AIRS, SPEC, TWIRL_AIR,
    WINTER_ACT_NAMES, createFoxPace, createFoxPosture, createFoxSpec, foxAct, foxDuty, foxFootfalls, foxGait,
    foxGallop, foxPoint, foxSpec, foxStride, solveFox,
} from '../../src/themes/winter/winter-fox-rig.js';
import {
    FOX_SCALE, FRAME_TREES, bearingFor, foxRound,
} from '../../src/themes/winter/winter-core.js';

const DT = 1 / 60;
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const CYCLE = 240;
const REST = Object.freeze({ power: 0, surge: 0, aurora: 0 });
const WIDE = foxRound(16 / 9);
const { DY, DZ, AIR } = { DY: FOOT.dy, DZ: FOOT.dz, AIR: FOOT.air };
const foot = (leg) => SPEC.feet + leg * FOOT.size;
const pawAt = (posture, leg, out = [0, 0, 0]) => foxPoint(posture, FOX_LEGS[leg][3], FOX_MARKS[FOX_LEGS[leg][4]], out);
const dot4 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
const turnBetween = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(dot4(a, b))));
const wrap = (angle) => angle - TAU * Math.round(angle / TAU);

/** Each of its own paces, wholly, at the speed it goes it: [name, speed (m/s), pace]. */
const OWN_PACES = ['walk', 'lope', 'bound'].map((name) => [
    name, FOX_PACES[name].speed, { ...createFoxPace(), [name]: 1, stretch: FOX_PACES[name].stretch },
]);
const paced = (phase, speed, pace) => foxGait(createFoxSpec(), phase, speed, 1, 0, foxGallop(speed), pace);
/** Which paws a pace has on the snow at a phase. */
const downAt = (phase, speed, pace) => {
    const spec = paced(phase, speed, pace);
    return FOX_LEGS.map((leg, n) => spec[foot(n) + DY] === 0);
};

function run(mind, from, seconds, env = REST, each = null) {
    const steps = Math.round(seconds / DT);
    let time = from;
    for (let i = 1; i <= steps; i++) {
        time = from + i * DT;
        mind.step(DT, time, env);
        each?.(mind, time);
    }
    return time;
}

function runUntil(mind, from, done, limit = 120, env = REST, each = null) {
    const steps = Math.round(limit / DT);
    for (let i = 1; i <= steps; i++) {
        const time = from + i * DT;
        mind.step(DT, time, env);
        each?.(mind, time);
        if (done(mind)) return time;
    }
    throw new Error(`not within ${limit} s (mode ${mind.mode}, clip ${mind.clip})`);
}

/** The game's fox: the arctic fox as it roams the snowfield. */
const wandering = (seed = 0xf0c5, aspect = 16 / 9) => new RoamingFoxMind({ aspect, seed });

describe('winter fox paces: the gait at a walk, a lope and a bound', () => {
    it('leaves its trot as it was when its pace says nothing', () => {
        const none = createFoxPace();
        expect(none).toEqual({
            walk: 0, lope: 0, bound: 0, stretch: 1,
        });
        for (const speed of [0.6, FOX_TROT, 3, 5.5]) {
            expect(foxStride(speed, none)).toBe(foxStride(speed));
            expect(foxDuty(speed, none)).toBe(foxDuty(speed));
            expect(foxFootfalls(speed, [], foxGallop(speed), none)).toEqual(foxFootfalls(speed));
            for (let i = 0; i < 24; i++) {
                const plain = foxGait(createFoxSpec(), i / 24, speed, 1);
                expect(Array.from(paced(i / 24, speed, none))).toEqual(Array.from(plain));
            }
        }
    });

    it('walks in four beats, hind paw then the forepaw of its side, most of each cycle on the snow', () => {
        const [, speed, pace] = OWN_PACES[0];
        const falls = foxFootfalls(speed, [], 0, pace).map((v) => ((v % 1) + 1) % 1);
        // Left hind, left fore, right hind, right fore: a quarter of a cycle apart.
        const order = [2, 0, 3, 1];
        order.forEach((leg, i) => {
            const gap = (((falls[order[(i + 1) % 4]] - falls[leg]) % 1) + 1) % 1;
            expect(gap, `after ${FOX_LEGS[leg][0]}`).toBeCloseTo(0.25, 9);
        });
        expect(foxDuty(speed, pace)).toBeGreaterThan(0.6);
        expect(foxDuty(speed, pace)).toBeGreaterThan(foxDuty(speed));
        // Never fewer than two paws down.
        let fewest = 4;
        for (let i = 0; i < CYCLE; i++) {
            fewest = Math.min(fewest, downAt(i / CYCLE, speed, pace).filter(Boolean).length);
        }
        expect(fewest).toBeGreaterThanOrEqual(2);
    });

    it('lopes in three beats with a moment off the snow, and bounds off both hind paws onto both forepaws', () => {
        const [, lopeSpeed, lope] = OWN_PACES[1];
        const [, boundSpeed, bound] = OWN_PACES[2];
        const lopeFalls = foxFootfalls(lopeSpeed, [], 0, lope);
        // One hind paw, then the other with the forepaw across from it, then the leading forepaw.
        expect(lopeFalls[2]).toBeCloseTo(lopeFalls[1], 9);
        expect(lopeFalls[3]).toBeLessThan(lopeFalls[2]);
        expect(lopeFalls[0]).toBeGreaterThan(lopeFalls[1]);
        const boundFalls = foxFootfalls(boundSpeed, [], 0, bound).map((v) => ((v % 1) + 1) % 1);
        expect(boundFalls[2]).toBeCloseTo(boundFalls[3], 9);
        expect(boundFalls[0]).toBeCloseTo(boundFalls[1], 9);
        expect(Math.abs(boundFalls[0] - boundFalls[2])).toBeGreaterThan(0.3);
        // Each is off the snow altogether for part of every cycle, and a cycle of each carries it
        // further than a cycle of its trot would.
        for (const [name, speed, pace] of [OWN_PACES[1], OWN_PACES[2]]) {
            let flying = 0;
            for (let i = 0; i < CYCLE; i++) if (downAt(i / CYCLE, speed, pace).every((on) => !on)) flying += 1;
            expect(flying / CYCLE, name).toBeGreaterThan(0.12);
            expect(foxStride(speed, pace), name).toBeGreaterThan(foxStride(speed) * 1.2);
        }
    });

    it('does not slide a planted paw at a steady pace, at any pace or half-way between two', () => {
        const before = createFoxPosture();
        const after = createFoxPosture();
        const a = [0, 0, 0];
        const b = [0, 0, 0];
        const wrong = [];
        let stances = 0;
        const halves = [
            ['half a walk', 0.9, { ...createFoxPace(), walk: 0.5 }],
            ['half a lope', 2.2, { ...createFoxPace(), lope: 0.5, stretch: 1.15 }],
            ['half a bound', 1.8, { ...createFoxPace(), bound: 0.5, stretch: 1.25 }],
        ];
        [...OWN_PACES, ...halves].forEach(([name, speed, pace]) => {
            const stride = foxStride(speed, pace) / FOX_SCALE;
            const step = 0.37 / CYCLE;
            for (let i = 0; i < CYCLE; i++) {
                const phase = i / CYCLE;
                const from = paced(phase, speed, pace);
                const to = paced(phase + step, speed, pace);
                solveFox(from, before);
                solveFox(to, after);
                for (let n = 0; n < FOX_LEGS.length; n++) {
                    if (from[foot(n) + DY] !== 0 || to[foot(n) + DY] !== 0) continue;
                    stances += 1;
                    pawAt(before, n, a);
                    pawAt(after, n, b);
                    const slid = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2] + step * stride);
                    const where = `${FOX_LEGS[n][0]} at ${name}, phase ${phase.toFixed(3)}`;
                    if (slid > 1e-9 || Math.abs(b[1]) > 1e-9) wrong.push(`${where}: slid ${slid.toExponential(1)} m`);
                    // (And its leg reaches it: a body risen over a paw still down would leave it hanging.)
                    const short = before.short[n];
                    if (short > 0.01) wrong.push(`${where}: ${short.toFixed(3)} m short of its paw`);
                }
            }
        });
        expect(wrong.slice(0, 5)).toEqual([]);
        expect(stances).toBeGreaterThan(CYCLE * 3);
    });

    it('is off the snow in a bound only while every paw is, highest in the middle of its flight', () => {
        const [, speed, pace] = OWN_PACES[2];
        const posture = createFoxPosture();
        const middle = FOX_RIG.index.spine;
        const standing = solveFox(createFoxSpec(), createFoxPosture()).at[middle][1];
        let highest = 0;
        for (let i = 0; i < CYCLE; i++) {
            const phase = i / CYCLE;
            const spec = paced(phase, speed, pace);
            solveFox(spec, posture);
            const risen = -(spec[SPEC.rear] + spec[SPEC.fore]) / 2;
            const down = downAt(phase, speed, pace).some(Boolean);
            // With a paw on the snow its body is no higher than its legs let it stand.
            if (down) expect(risen, `phase ${phase.toFixed(3)}`).toBeLessThan(0.012);
            highest = Math.max(highest, posture.at[middle][1] - standing);
        }
        // The middle of its back goes up by a good part of its own leg.
        expect(highest).toBeGreaterThan(0.045);
        // A pace that is only part bound (its pace changing) has no flight to rise in, and does not.
        const part = { ...createFoxPace(), bound: 0.4, stretch: 1.2 };
        for (let i = 0; i < CYCLE; i++) {
            const spec = paced(i / CYCLE, 1.7, part);
            const risen = -(spec[SPEC.rear] + spec[SPEC.fore]) / 2;
            if (downAt(i / CYCLE, 1.7, part).some(Boolean)) expect(risen).toBeLessThan(0.012);
        }
    });

    it('turns no bone far in a frame at any pace, and moves its footfalls evenly as a pace comes on', () => {
        OWN_PACES.forEach(([name, speed, pace]) => {
            const cycles = speed / foxStride(speed, pace);
            let before = solveFox(paced(0, speed, pace), createFoxPosture());
            let after = createFoxPosture();
            let most = 0;
            for (let i = 1; i <= 120; i++) {
                solveFox(paced(i * DT * cycles, speed, pace), after);
                for (let k = 0; k < before.world.length; k++) {
                    most = Math.max(most, turnBetween(before.world[k], after.world[k]));
                }
                [before, after] = [after, before];
            }
            expect(most / DEG, name).toBeLessThan(35);
            // Its footfalls go from its trot's to the pace's in a straight line: no paw's beat jumps.
            const trot = foxFootfalls(speed, [], 0);
            const whole = foxFootfalls(speed, [], 0, pace);
            for (const share of [0.25, 0.5, 0.75]) {
                const part = foxFootfalls(speed, [], 0, { ...pace, [name]: share });
                part.forEach((v, n) => {
                    expect(v, `${name} ${FOX_LEGS[n][0]}`).toBeCloseTo(trot[n] + (whole[n] - trot[n]) * share, 9);
                });
            }
        });
        // At a full gallop a pace changes nothing: it is what is left of its trot that a pace takes.
        expect(foxFootfalls(6.8, [], 1, OWN_PACES[2][2])).toEqual(foxFootfalls(6.8, [], 1));
    });
});

describe('winter fox acts: what no other fox does', () => {
    const act = (name, t) => foxAct(createFoxSpec(), name, t);

    it('has eleven acts of its own, each begun and ended standing as it stands', () => {
        expect(WINTER_ACT_NAMES).toEqual(expect.arrayContaining([
            'Scratch', 'SnowBath', 'Sphinx', 'StandTall', 'TailChase', 'PlayBow', 'MouseLeap', 'HeadTilt', 'SkyGaze',
            'Twirl', 'Pronk',
        ]));
        WINTER_ACT_NAMES.forEach((name) => {
            expect(FOX_ACTS[name], name).toBeGreaterThan(1);
            // At its first and its last moment every number of the pose is nought (a whole turn
            // is none), so it cross-fades from and to a stand without a start.
            for (const t of [0, FOX_ACTS[name]]) {
                const spec = act(name, t);
                spec[SPEC.yaw] = wrap(spec[SPEC.yaw]);
                const most = Math.max(...Array.from(spec, Math.abs));
                expect(most, `${name} at ${t} s`).toBeLessThan(0.02);
            }
            // ...and in between it is far from a stand.
            let moved = 0;
            for (let t = 0; t <= FOX_ACTS[name]; t += DT) {
                moved = Math.max(moved, ...Array.from(act(name, t), Math.abs));
            }
            expect(moved, name).toBeGreaterThan(0.2);
        });
    });

    it('goes round after its tail twice, each paw staying where it was put down until it is lifted', () => {
        const posture = createFoxPosture();
        const now = [0, 0, 0];
        let turned = 0;
        let last = 0;
        let held = 0;
        const was = FOX_LEGS.map(() => null);
        for (let t = 0; t <= FOX_ACTS.TailChase; t += DT / 2) {
            const spec = act('TailChase', t);
            turned += wrap(spec[SPEC.yaw] - last);
            last = spec[SPEC.yaw];
            solveFox(spec, posture);
            for (let n = 0; n < FOX_LEGS.length; n++) {
                const where = `${FOX_LEGS[n][0]} at ${t.toFixed(2)} s`;
                const down = spec[foot(n) + DY] === 0;
                pawAt(posture, n, now);
                if (down && was[n]) {
                    held += 1;
                    // (It moves no further over the snow than rounding lets it.)
                    expect(Math.hypot(now[0] - was[n][0], now[2] - was[n][2]), where).toBeLessThan(1e-9);
                }
                was[n] = down ? [now[0], 0, now[2]] : null;
                expect(posture.short[n], where).toBeLessThan(0.01);
            }
        }
        expect(turned / TAU).toBeCloseTo(2, 6);
        expect(held).toBeGreaterThan(400);
        // It ends where it began, facing as it faced.
        expect(wrap(act('TailChase', FOX_ACTS.TailChase)[SPEC.yaw])).toBeCloseTo(0, 9);
    });

    it('carries every paw while it is in the air: the mousing leap, the leap with a turn, the bounces', () => {
        const airs = [['MouseLeap', MOUSE_AIR], ['Twirl', TWIRL_AIR], ...PRONK_AIRS.map((air) => ['Pronk', air])];
        airs.forEach(([name, [off, down]]) => {
            expect(off).toBeGreaterThan(0);
            expect(down).toBeGreaterThan(off + 0.25);
            expect(down).toBeLessThan(FOX_ACTS[name]);
            for (let t = off + 0.07; t <= down - 0.09; t += DT) {
                const spec = act(name, t);
                FOX_LEGS.forEach((leg, n) => {
                    expect(spec[foot(n) + AIR], `${name} ${leg[0]} at ${t.toFixed(2)} s`).toBe(1);
                });
            }
            // Before it leaves the snow every paw is on it.
            FOX_LEGS.forEach((leg, n) => expect(act(name, 0.1)[foot(n) + AIR], `${name} ${leg[0]}`).toBe(0));
        });
        // The leap with a turn in it turns it once round, in the air only.
        expect(wrap(act('Twirl', TWIRL_AIR[0] - 0.02)[SPEC.yaw])).toBeCloseTo(0, 6);
        expect(Math.abs(act('Twirl', (TWIRL_AIR[0] + TWIRL_AIR[1]) / 2)[SPEC.yaw])).toBeGreaterThan(2.8);
        expect(wrap(act('Twirl', TWIRL_AIR[1] + 0.02)[SPEC.yaw])).toBeCloseTo(0, 6);
        // In its mousing leap it comes down nose first: its trunk tipped well forward as it lands.
        expect(act('MouseLeap', MOUSE_AIR[1])[SPEC.pitch]).toBeGreaterThan(0.7);
        expect(act('MouseLeap', MOUSE_AIR[0] + 0.15)[SPEC.pitch]).toBeLessThan(-0.4);
    });

    it('stands up on its hind legs, lies like a sphinx, scratches where its paw reaches, and rolls right over', () => {
        const posture = createFoxPosture();
        const standing = solveFox(createFoxSpec(), createFoxPosture());
        const head = (p) => p.at[FOX_RIG.index.head];
        // Standing tall: its head well above where it stands, forepaws off the snow, hind paws on it.
        let spec = act('StandTall', 1.6);
        solveFox(spec, posture);
        expect(head(posture)[1] - head(standing)[1]).toBeGreaterThan(0.15);
        expect([spec[foot(0) + AIR], spec[foot(1) + AIR]]).toEqual([1, 1]);
        expect(pawAt(posture, 0)[1]).toBeGreaterThan(0.2);
        expect(Math.abs(pawAt(posture, 2)[1])).toBeLessThan(1e-9);
        expect(Math.max(...posture.short)).toBeLessThan(0.01);
        // A sphinx: belly down, forepaws out ahead on the snow, head still up.
        spec = act('Sphinx', 3.5);
        solveFox(spec, posture);
        expect(spec[SPEC.rear]).toBeGreaterThan(0.15);
        expect(spec[SPEC.fore]).toBeGreaterThan(0.12);
        expect(spec[foot(0) + DZ]).toBeGreaterThan(0.05);
        expect(Math.abs(pawAt(posture, 0)[1])).toBeLessThan(1e-9);
        expect(head(posture)[1]).toBeGreaterThan(0.3);
        // Scratching: its hind paw comes up beside its head (within a hand of where its ear is),
        // and goes like a drumstick: several strokes a second.
        solveFox(act('Scratch', 2), posture);
        const ear = foxPoint(posture, 'head', [0.085, 0.61, 0.35]);
        const paw = pawAt(posture, 2);
        expect(Math.hypot(paw[0] - ear[0], paw[1] - ear[1], paw[2] - ear[2])).toBeLessThan(0.07);
        expect(paw[1]).toBeGreaterThan(0.2);
        let strokes = 0;
        let rising = false;
        for (let t = 1.5; t < 2.5; t += DT / 4) {
            const up = act('Scratch', t + DT / 4)[foot(2) + DY] > act('Scratch', t)[foot(2) + DY];
            if (up && !rising) strokes += 1;
            rising = up;
        }
        expect(strokes).toBeGreaterThanOrEqual(5);
        // Its bath: right over onto its back (past a quarter turn), every paw carried, and back.
        const [from, to] = BATH_WRIGGLE;
        spec = act('SnowBath', (from + to) / 2);
        expect(spec[SPEC.roll]).toBeGreaterThan(1.8);
        FOX_LEGS.forEach((leg, n) => expect(spec[foot(n) + AIR], leg[0]).toBe(1));
        expect(spec[SPEC.rear]).toBeGreaterThan(0.15);
    });
});

describe('winter fox at rest: its paces and what it stops for', () => {
    /** A stretch of a wandering fox's night: every stop it made, how long it went at each pace, its speeds. */
    function night(seed, seconds, env = REST, mind = wandering(seed)) {
        const stops = [];
        const paces = {
            walk: 0, trot: 0, lope: 0, bound: 0,
        };
        const speeds = {
            walk: [], trot: [], lope: [], bound: [],
        };
        let mode = 'gait';
        let fastestChange = 0;
        const last = { ...mind.pose.pace };
        run(mind, 0, seconds, env, (m) => {
            if (m.mode === 'idle' && mode !== 'idle' && m.next) stops.push(m.next.join('+'));
            if (m.mode === 'gait' && !m.zooming) {
                paces[m.going] += DT;
                const { pace } = m.pose;
                if (m.going === 'trot' || pace[m.going] > 0.95) speeds[m.going].push(m.speed);
            }
            for (const name of ['walk', 'lope', 'bound']) {
                fastestChange = Math.max(fastestChange, Math.abs(m.pose.pace[name] - last[name]));
                last[name] = m.pose.pace[name];
            }
            ({ mode } = m);
        });
        return {
            mind, stops, paces, speeds, fastestChange,
        };
    }

    it('walks, trots, lopes and bounds as what it is about asks, easing from one into the next', () => {
        for (const seed of [0xf0c5, 7, 12345]) {
            const { paces, speeds, fastestChange } = night(seed, 900);
            // It walks with its nose down to cast about and to creep up on what it hears, trots to
            // get somewhere, and lopes and bounds when it goes further or is restless.
            Object.entries(paces).forEach(([name, seconds]) => {
                expect(seconds, `${name}, seed ${seed}`).toBeGreaterThan(name === 'walk' || name === 'trot' ? 60 : 4);
            });
            expect(Math.min(paces.walk, paces.trot), `seed ${seed}`).toBeGreaterThan(Math.max(paces.lope, paces.bound));
            // Each pace at about its own speed.
            const middle = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
            expect(middle(speeds.walk)).toBeLessThan(0.8);
            expect(middle(speeds.walk)).toBeGreaterThan(0.4);
            expect(middle(speeds.lope)).toBeGreaterThan(2.3);
            expect(middle(speeds.bound)).toBeGreaterThan(1.7);
            expect(middle(speeds.bound)).toBeLessThan(middle(speeds.lope));
            // No pace comes on in a frame: a twentieth of the way at most (where it stands, and
            // no step shows it, it may change outright).
            expect(fastestChange, `seed ${seed}`).toBeLessThanOrEqual(1);
        }
        // Under way a pace eases: followed frame by frame while it moves, nothing jumps.
        const mind = wandering(99);
        const last = { ...mind.pose.pace };
        let most = 0;
        run(mind, 0, 600, REST, (m) => {
            for (const name of ['walk', 'lope', 'bound']) {
                if (m.speed > 0.3) most = Math.max(most, Math.abs(m.pose.pace[name] - last[name]));
                last[name] = m.pose.pace[name];
            }
        });
        expect(most).toBeLessThan(0.06);
    });

    it('keeps to its trot and its gallop while the fires burn, whatever pace it was in', () => {
        const mind = wandering(7);
        mind.keepPace('bound');
        const time = runUntil(mind, 0, (m) => m.mode === 'gait' && m.pose.pace.bound > 0.9, 60);
        run(mind, time, 2, { power: 0.8, surge: 0 });
        expect(mind.pose.pace.bound).toBeLessThan(0.05);
        expect(mind.pose.pace.stretch).toBeLessThan(1.03);
        expect(mind.speed).toBeGreaterThan(3.5);
        // The plain fox (the tests' and the captures' own) has no paces but its trot.
        const plain = new FoxMind(WIDE);
        run(plain, 0, 60);
        expect(plain.pose.pace).toEqual(createFoxPace());
        expect(Array.from(plain.pose.over).every((v) => v === 0)).toBe(true);
    });

    it('puts its nose down to the snow at a walk, and lifts it again when it trots on', () => {
        const mind = wandering(7);
        mind.keepPace('walk');
        const time = run(mind, 0, 5);
        const low = foxSpec(mind.pose);
        expect(mind.pose.over[SPEC.headPitch]).toBeLessThan(-0.35);
        expect(low[SPEC.reach]).toBeGreaterThan(0.35);
        mind.keepPace('trot');
        run(mind, time, 4);
        expect(Math.abs(mind.pose.over[SPEC.headPitch])).toBeLessThan(0.02);
    });

    it('does many kinds of thing when it stops, every act of its own among them, and seldom one twice running', () => {
        const seen = new Set();
        let repeats = 0;
        let count = 0;
        const known = [...FOX_WANDER_STOPS.map(([acts]) => acts), ...AFTER_ZOOM].map((acts) => acts.join('+'));
        for (const seed of [0xf0c5, 7, 12345, 99]) {
            const { stops } = night(seed, 900);
            expect(new Set(stops).size, `seed ${seed}`).toBeGreaterThanOrEqual(13);
            stops.forEach((what) => {
                expect(known, what).toContain(what);
                what.split('+').forEach((name) => seen.add(name));
            });
            repeats += stops.filter((what, i) => i > 0 && what === stops[i - 1]).length;
            count += stops.length;
        }
        expect(repeats / count).toBeLessThan(0.03);
        // In an hour of four nights it has done every one of its own acts that a stop can lead to.
        ['Scratch', 'SnowBath', 'Sphinx', 'StandTall', 'TailChase', 'PlayBow', 'MouseLeap', 'HeadTilt', 'SkyGaze']
            .forEach((name) => expect([...seen], name).toContain(name));
        // Every stop in its table names acts its body has.
        FOX_WANDER_STOPS.forEach(([acts, odds]) => {
            expect(odds).toBeGreaterThan(0);
            acts.forEach((name) => expect(FOX_ACTS[name], name).toBeGreaterThan(0));
        });
    });

    it('sits and watches the sky more under a strong aurora, and lies down more after a chain', () => {
        const among = (what, names) => names.some((name) => what.split('+').includes(name));
        const share = (stops, names) => stops.filter((what) => among(what, names)).length / Math.max(1, stops.length);
        const RESTS = ['Sphinx', 'Sit', 'Stretch'];
        let calm = 0;
        let lit = 0;
        let fresh = 0;
        let rested = 0;
        const seeds = [0xf0c5, 7, 12345, 99, 4242, 31, 2026, 808];
        for (const seed of seeds) {
            const plain = night(seed, 900).stops;
            calm += share(plain, ['Sit', 'SkyGaze']);
            lit += share(night(seed, 900, { power: 0, surge: 0, aurora: 1 }).stops, ['Sit', 'SkyGaze']);
            fresh += share(plain, RESTS);
            // (A chain first: half a minute at a run. Then the first thing it stops for.)
            const mind = wandering(seed);
            run(mind, 0, 30, { power: 0.8, surge: 0, aurora: 0 });
            expect(mind.tired).toBeGreaterThan(0.6);
            runUntil(mind, 30, (m) => m.mode === 'idle' && Boolean(m.next), 120);
            if (RESTS.some((name) => mind.next.includes(name))) rested += 1;
        }
        expect(lit).toBeGreaterThan(calm * 1.6);
        // Left to itself it rests at one stop in five or six; after a chain, at its first stop more often than not.
        expect(fresh / seeds.length).toBeLessThan(0.35);
        expect(rested / seeds.length).toBeGreaterThanOrEqual(0.5);
    });

    it('replays the same night from the same seed, paces, stops and all, and another from another', () => {
        const a = night(7, 300);
        const b = night(7, 300);
        expect(b.stops).toEqual(a.stops);
        expect(b.paces).toEqual(a.paces);
        expect({ ...b.mind.pose, plant: null, over: null }).toEqual({ ...a.mind.pose, plant: null, over: null });
        expect(Array.from(b.mind.pose.plant)).toEqual(Array.from(a.mind.pose.plant));
        const other = night(8, 300);
        expect(other.stops).not.toEqual(a.stops);
        // After a reset it is the same night again.
        a.mind.reset(0);
        expect(night(7, 300, REST, a.mind).stops).toEqual(b.stops);
    });

    it('keeps its paws where they are put down through every pace: next to no slide, no bone thrown', () => {
        const posture = createFoxPosture();
        let before = createFoxPosture();
        const footing = new Float64Array(8);
        const lastPaw = new Float64Array(8);
        const down = new Uint8Array(4);
        const paw = [0, 0, 0];
        const mind = wandering(12345);
        let slid = 0;
        let stances = 0;
        let mostTurn = 0;
        let shortest = 0;
        let first = true;
        run(mind, 0, 420, REST, (m) => {
            const { pose } = m;
            solveFox(foxSpec(pose), posture);
            if (!first) {
                for (let k = 0; k < posture.world.length; k++) {
                    mostTurn = Math.max(mostTurn, turnBetween(before.world[k], posture.world[k]));
                }
            }
            first = false;
            const share = FOX_RIG.footing(pose, footing);
            const c = Math.cos(pose.heading);
            const s = Math.sin(pose.heading);
            for (let i = 0; i < 4; i++) {
                pawAt(posture, i, paw);
                const x = pose.x + FOX_SCALE * (paw[0] * c + paw[2] * s);
                const z = pose.z + FOX_SCALE * (paw[2] * c - paw[0] * s);
                const planted = share > 0.99 && footing[2 * i] === 1 && pose.lift < 0.01;
                if (planted && down[i]) {
                    slid += Math.hypot(x - lastPaw[2 * i], z - lastPaw[2 * i + 1]);
                    stances += 1;
                }
                down[i] = planted ? 1 : 0;
                lastPaw[2 * i] = x;
                lastPaw[2 * i + 1] = z;
                shortest = Math.max(shortest, posture.short[i]);
            }
            for (let k = 0; k < posture.world.length; k++) before.world[k].splice(0, 4, ...posture.world[k]);
        });
        before = null;
        expect(stances).toBeGreaterThan(20000);
        // A paw on the snow moves a tenth of a millimetre a frame on average, at most (it moved
        // 0.03 before it had paces; 1.3 before its paws were held at all).
        expect((slid / stances) * 1000).toBeLessThan(0.1);
        expect(mostTurn / DEG).toBeLessThan(40);
        expect(shortest).toBeLessThan(0.05);
    });
});

describe('winter fox: its romp', () => {
    const fractionOf = (x, z) => Math.abs(x / -z) / Math.tan(bearingFor(1, 16 / 9));
    const trees = FRAME_TREES.map(([fraction, dist]) => {
        const az = bearingFor(fraction, 16 / 9);
        return [Math.sin(az) * dist, -Math.cos(az) * dist];
    });

    it('bows, tears about this way and that — not round a ring — and skids to a stop on the open snow', () => {
        let romps = 0;
        for (const seed of [0xf0c5, 7, 12345, 99]) {
            const mind = wandering(seed);
            // (From a place it stopped at on the open snow, as it bows there.)
            let time = runUntil(mind, 0, (m) => m.mode === 'idle', 120);
            time = runUntil(mind, time, (m) => m.mode === 'gait', 60);
            mind.playZoom(time);
            time = runUntil(mind, time, (m) => m.mode === 'gait', 10);
            if (!mind.zooming) continue; // (No room here for a romp: it goes on.)
            romps += 1;
            let net = 0;
            let swung = 0;
            let { heading } = mind.pose;
            let fastest = 0;
            let widest = 0;
            let nearestTree = Infinity;
            let last = [mind.pose.x, mind.pose.z];
            let longestStep = 0;
            const events = [];
            time = runUntil(mind, time, (m) => m.mode === 'idle', 30, REST, (m) => {
                const { pose } = m;
                const turn = wrap(pose.heading - heading);
                if (m.speed > 1) {
                    net += turn;
                    swung += Math.abs(turn);
                }
                ({ heading } = pose);
                fastest = Math.max(fastest, m.speed);
                widest = Math.max(widest, fractionOf(pose.x, pose.z));
                trees.forEach(([x, z]) => {
                    nearestTree = Math.min(nearestTree, Math.hypot(pose.x - x, pose.z - z));
                });
                longestStep = Math.max(longestStep, Math.hypot(pose.x - last[0], pose.z - last[1]) - m.speed * DT);
                last = [pose.x, pose.z];
                m.events.forEach((event) => events.push(event.type));
            });
            const label = `seed ${seed}`;
            // Flat out, swerving one way and the other — and never once right round.
            expect(fastest, label).toBeGreaterThan(ZOOM.speed * 0.85);
            expect(swung, label).toBeGreaterThan(1.5);
            expect(Math.abs(net) / TAU, label).toBeLessThan(0.75);
            // It skids to a stop where it is seen, in the frame, clear of the trees, its way never
            // jumping under it.
            const end = fractionOf(mind.pose.x, mind.pose.z);
            expect(end, label).toBeGreaterThan(FOX_RANGE.open[0] - 0.05);
            expect(end, label).toBeLessThan(FOX_RANGE.open[1] + 0.05);
            expect(widest, label).toBeLessThan(0.95);
            expect(nearestTree, label).toBeGreaterThan(1.6);
            expect(longestStep, label).toBeLessThan(0.02);
            // It skids (the world throws the snow up) and then does one of three things.
            expect(events, label).toContain('skid');
            expect(AFTER_ZOOM.map((acts) => acts.join('+')), label).toContain(mind.next.join('+'));
            expect(mind.zooming, label).toBeNull();
            expect(mind.paces.brake, label).toBe(1.5);
        }
        expect(romps).toBeGreaterThanOrEqual(2);
    });

    it('goes on from where it is when the frame changes shape in the middle of a romp', () => {
        // (The first of its nights that has room for a romp where it first stops.)
        let mind = null;
        let time = 0;
        for (let seed = 1; seed < 20 && !mind?.zooming; seed++) {
            mind = wandering(seed);
            time = runUntil(mind, 0, (m) => m.mode === 'idle', 120);
            time = runUntil(mind, time, (m) => m.mode === 'gait', 60);
            mind.playZoom(time);
            time = runUntil(mind, time, (m) => m.mode === 'gait', 10);
        }
        time = runUntil(mind, time, (m) => Boolean(m.zooming) && m.speed > 3, 20);
        const before = [mind.pose.x, mind.pose.z];
        mind.setAspect(4 / 3);
        expect(mind.zooming).toBeNull();
        mind.step(DT, time + DT, REST);
        expect(Math.hypot(mind.pose.x - before[0], mind.pose.z - before[1])).toBeLessThan(0.15);
        run(mind, time + DT, 20);
        expect(Number.isFinite(mind.pose.x + mind.pose.z + mind.pose.heading)).toBe(true);
        expect(fractionOf(mind.pose.x, mind.pose.z)).toBeLessThan(1);
    });
});

describe('winter fox: what it answers the board with', () => {
    it('leaps with a turn, looks at the sky, bounces three times — and finishes each though the fires burn', () => {
        const cases = [['twirl', 'Twirl', 1], ['gaze', 'SkyGaze', 0], ['rejoice', 'Pronk', 3]];
        cases.forEach(([verb, clip, leaps]) => {
            const mind = wandering(7);
            const burning = { power: 0.7, surge: 0.2, aurora: 0.5 };
            let time = run(mind, 0, 4, burning);
            expect(mind[verb](time)).toBe(true);
            expect(mind.clip).toBe(clip);
            let risen = 0;
            let wasUp = false;
            let highest = 0;
            const seen = new Set();
            // A clear on its heels startles a fox out of what it is doing: not out of this.
            mind.startle(1.2);
            const began = time;
            time = runUntil(mind, time, (m) => m.mode === 'gait', 10, burning, (m) => {
                const up = m.pose.lift > 0.02;
                if (up && !wasUp) risen += 1;
                wasUp = up;
                highest = Math.max(highest, m.pose.lift);
                seen.add(m.clip);
                m.events.forEach((event) => seen.add(`event:${event.type}`));
            });
            expect(time - began, verb).toBeGreaterThan(FOX_ACTS[clip] - 0.05);
            expect(risen, verb).toBe(leaps);
            if (leaps) expect(highest, verb).toBeGreaterThan(0.2);
            expect([...seen].filter((name) => !name.startsWith('event:')), verb).toEqual([clip]);
            if (verb === 'twirl') expect([...seen]).toContain('event:land');
            if (verb === 'rejoice') expect([...seen]).toContain('event:hop');
            // Then it runs on with the chain.
            run(mind, time, 1.5, burning);
            expect(mind.speed, verb).toBeGreaterThan(3);
            expect(mind.stunting).toBe(false);
        });
    });

    it('does not answer in its sleep, and bounces after its great leap rather than in the middle of it', () => {
        const mind = wandering(7);
        let time = run(mind, 0, 3);
        mind.sleep(time);
        time = run(mind, time, 3);
        for (const verb of ['twirl', 'gaze', 'rejoice']) expect(mind[verb](time), verb).toBe(false);
        expect(mind.asleep).toBe(true);
        mind.wake(time);
        time = run(mind, time, 4);
        mind.pounce(time);
        time = run(mind, time, 0.3);
        expect(mind.twirl(time)).toBe(false);
        expect(mind.rejoice(time)).toBe(true);
        expect(mind.clip).toBe('Pounce');
        time = runUntil(mind, time, (m) => m.clip === 'Pronk', 5);
        expect(mind.mode).toBe('idle');
        runUntil(mind, time, (m) => m.mode === 'gait', 5);
    });
});

describe('winter fox: its prints', () => {
    it('presses a print where a forepaw is put down, and where every paw is when it bounds', () => {
        const posture = createFoxPosture();
        const paw = [0, 0, 0];
        for (const [name, most] of [['trot', 2], ['walk', 2], ['bound', 4]]) {
            const mind = wandering(7);
            mind.keepPace(name);
            let prints = 0;
            let cycles = 0;
            let phase = null;
            run(mind, 0, 12, REST, (m) => {
                if (m.mode !== 'gait' || m.speed < FOX_PACES[name].speed * 0.8) {
                    phase = null;
                    return;
                }
                if (phase !== null) cycles += m.phase - phase;
                ({ phase } = m);
                const made = m.events.filter((event) => event.type === 'print');
                prints += made.length;
                if (!made.length) return;
                solveFox(foxSpec(m.pose), posture);
                const c = Math.cos(m.pose.heading);
                const s = Math.sin(m.pose.heading);
                made.forEach((print) => {
                    // Each is under one of its paws as its body is drawn in that very frame.
                    let nearest = Infinity;
                    for (let i = 0; i < 4; i++) {
                        pawAt(posture, i, paw);
                        const x = m.pose.x + FOX_SCALE * (paw[0] * c + paw[2] * s);
                        const z = m.pose.z + FOX_SCALE * (paw[2] * c - paw[0] * s);
                        nearest = Math.min(nearest, Math.hypot(print.x - x, print.z - z));
                    }
                    expect(nearest, `${name}`).toBeLessThan(0.03);
                    expect(print.heading).toBe(m.pose.heading);
                });
            });
            expect(cycles, name).toBeGreaterThan(4);
            // Two to a cycle where its hind paws tread in its forepaws' prints, four where they do not.
            expect(prints / cycles, name).toBeGreaterThan(most * 0.8);
            expect(prints / cycles, name).toBeLessThan(most * 1.25);
        }
        // Standing, sitting or asleep it presses none; nor does the plain fox count them this way.
        const mind = wandering(7);
        let time = runUntil(mind, 0, (m) => m.mode === 'idle' && Boolean(m.act), 120);
        time = run(mind, time, 0.6);
        let standing = 0;
        runUntil(mind, time, (m) => m.mode !== 'idle' || m.clip === 'Run', 30, REST, (m) => {
            if (m.mode !== 'idle' || m.clip === 'Run') return;
            standing += m.events.filter((event) => event.type === 'print').length;
        });
        expect(standing).toBe(0);
    });
});

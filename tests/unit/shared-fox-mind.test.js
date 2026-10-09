/**
 * The fox mind the themes share (src/themes/shared/fox-mind.js), on a course and a body that are
 * nobody's: a ring over a sloping field with three stopping places and a viewer off to one
 * side, gone round by a made-up fox drawn twice life size. No three, no GPU.
 *
 * What is pinned is what a theme hands it and must get back: its course is where it goes and
 * whose viewer it turns to, its paces are the speeds and heights it moves at, its stops are
 * what it does — and the same steps give the same fox. (What the mind does with all that, in
 * detail, is pinned on Winter's fox: winter-fox-mind.test.js.)
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    FOX_BLEND, FOX_STOPS, FoxMind, MOUSING, foxCourse, foxGaitAmp,
} from '../../src/themes/shared/fox-mind.js';
import {
    FOX_ACTS, POUNCE_AIR, SLEEP_HOLD, SPEC, createFoxRig,
} from '../../src/themes/shared/fox-rig.js';

const source = readFileSync(path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'src',
    'themes',
    'shared',
    'fox-mind.js',
), 'utf8');

const DT = 1 / 60;
const TAU = Math.PI * 2;
const REST = Object.freeze({ power: 0, surge: 0 });
const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** A fox that is nobody's, `k` times the arctic fox's size, with a tail of three bones. */
function madeUp(k = 1) {
    const m = (x, y, z) => [x * k, y * k, z * k];
    const bones = [
        ['hips', null, ...m(0, 0.36, -0.14)],
        ['spine', 'hips', ...m(0, 0.365, 0)],
        ['chest', 'spine', ...m(0, 0.37, 0.13)],
        ['neck', 'chest', ...m(0, 0.45, 0.22)],
        ['head', 'neck', ...m(0, 0.54, 0.32)],
        ['tail1', 'hips', ...m(0, 0.34, -0.2)],
        ['tail2', 'tail1', ...m(0, 0.27, -0.3)],
        ['tail3', 'tail2', ...m(0, 0.22, -0.4)],
        ...[['L', 1], ['R', -1]].flatMap(([side, s]) => [
            [`arm${side}`, 'chest', ...m(0.08 * s, 0.31, 0.2)],
            [`fore${side}`, `arm${side}`, ...m(0.08 * s, 0.18, 0.17)],
            [`hand${side}`, `fore${side}`, ...m(0.08 * s, 0.06, 0.19)],
            [`thigh${side}`, 'hips', ...m(0.09 * s, 0.32, -0.12)],
            [`shin${side}`, `thigh${side}`, ...m(0.09 * s, 0.19, -0.06)],
            [`hock${side}`, `shin${side}`, ...m(0.09 * s, 0.1, -0.13)],
        ]),
    ];
    const marks = {
        nose: m(0, 0.5, 0.54),
        tailTip: m(0, 0.24, -0.47),
        pawFL: m(0.08, 0, 0.22),
        pawFR: m(-0.08, 0, 0.22),
        pawBL: m(0.09, 0, -0.1),
        pawBR: m(-0.09, 0, -0.1),
    };
    return { bones, marks };
}

/** The body most of these minds have: 1.3 times the arctic fox's size, drawn twice as large again. */
const SCALE = 2;
const RIG = createFoxRig({ ...madeUp(1.3), size: 1.3, scale: SCALE });

/** A field that slopes: no two places of the ring are at one height. */
const field = (x, z) => 1 + 0.05 * x + 0.02 * z;
/** Where the ring's middle is, and how wide it is (m). */
const MIDDLE = [4, -6];
const RADIUS = 9;

/**
 * A ring gone round to its left (anticlockwise seen from above), `radius` across, with three
 * stopping places a third of the way round from each other and whoever watches at `viewer`.
 */
function ring({ radius = RADIUS, viewer = [MIDDLE[0], MIDDLE[1] + 40], count = 180 } = {}) {
    const points = new Float64Array(count * 3);
    for (let i = 0; i < count; i++) {
        const a = (i / count) * TAU;
        // Starting due "south" of the middle and heading +x: its heading is the way it goes.
        points[i * 3] = MIDDLE[0] + Math.sin(a) * radius;
        points[i * 3 + 1] = MIDDLE[1] + Math.cos(a) * radius;
        points[i * 3 + 2] = wrap(a + Math.PI / 2);
    }
    const length = count * 2 * radius * Math.sin(Math.PI / count);
    const stations = [0.1, 0.1 + 1 / 3, 0.1 + 2 / 3].map((share) => share * length);
    return foxCourse({
        points, count, length, stations, height: field, viewer,
    });
}

const makeMind = (options = {}) => new FoxMind({ rig: RIG, course: ring(), ...options });

/** Step a mind `seconds` on from `from` at the fixed step; `each` sees it after every step. */
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

/** Step until `done(mind)`; the time it came true. Fails the test if it never does. */
function runUntil(mind, from, done, limit = 120, env = REST) {
    const steps = Math.round(limit / DT);
    for (let i = 1; i <= steps; i++) {
        const time = from + i * DT;
        mind.step(DT, time, env);
        if (done(mind)) return time;
    }
    throw new Error(`the fox never got there in ${limit} s (mode ${mind.mode}, clip ${mind.clip})`);
}

/** Metres along its course to its nearest stopping place. */
function stationGap(mind) {
    const { length, stations } = mind.course;
    return Math.min(...stations.map((station) => {
        const ahead = (((mind.s - station) % length) + length) % length;
        return Math.min(ahead, length - ahead);
    }));
}

const snapshot = (mind) => ({
    pose: { ...mind.pose },
    s: mind.s,
    speed: mind.speed,
    phase: mind.phase,
    mode: mind.mode,
    clip: mind.clip,
    act: mind.act,
    next: mind.next,
    nextStop: mind.nextStop,
    asleep: mind.asleep,
    body: [mind.face, mind.stepping, mind.side, mind.turn, mind.tailVel, mind.blendTime, mind.lift],
});

/** A night of everything a world can do to it; every step's events. */
function night(mind, from = 0) {
    const log = [];
    const keep = (m, time) => m.events.forEach((event) => log.push({ ...event, at: time }));
    let time = run(mind, from, 12, REST, keep);
    mind.attend(3, 6, -20, time + 2, 0.8);
    time = run(mind, time, 4, { power: 0.5, surge: 0 }, keep);
    mind.flickTail(0.8);
    mind.startle(1.2);
    time = run(mind, time, 2, { power: 0.9, surge: 0.6 }, keep);
    mind.pounce(time);
    time = run(mind, time, 3, { power: 0.2, surge: 0.3 }, keep);
    time = run(mind, time, 30, REST, keep);
    mind.sleep(time);
    time = run(mind, time, 3, REST, keep);
    mind.wake(time);
    time = run(mind, time, 5, REST, keep);
    mind.rehearse(MOUSING, time);
    time = run(mind, time, 8, REST, keep);
    return { time, log };
}

describe('shared fox mind: the module', () => {
    it('is three-free and knows no theme: it imports the rig beside it and nothing else', () => {
        const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
        expect(imports).toEqual(['./fox-rig.js']);
        expect(source).not.toMatch(/\bTHREE\b|\bdocument\b|\bwindow\b|performance\.now|Date\.now|Math\.random/);
    });

    it('offers a fox what every fox does at a stop, all of it acts every rig knows', () => {
        expect(Object.isFrozen(FOX_STOPS)).toBe(true);
        expect(Object.isFrozen(MOUSING)).toBe(true);
        expect(FOX_STOPS.length).toBeGreaterThan(3);
        FOX_STOPS.forEach((stop) => {
            expect(stop.length).toBeGreaterThan(0);
            stop.forEach((act) => expect(FOX_ACTS[act], act).toBeGreaterThan(0));
            // Nothing it does at a stop is its gait or its sleep.
            expect(stop).not.toContain('Run');
            expect(stop).not.toContain('CurlSleep');
        });
        // Its hunt is one of them: it listens, leaps, digs and shakes itself off.
        expect(FOX_STOPS).toContain(MOUSING);
        expect(MOUSING).toEqual(['Listen', 'Pounce', 'Dig', 'Shake']);
        expect(FOX_BLEND).toBeGreaterThan(0);
        expect(FOX_BLEND).toBeLessThan(POUNCE_AIR[0]);
        // It shortens its stride to a halt.
        expect(foxGaitAmp(0)).toBe(0);
        expect(foxGaitAmp(-2)).toBe(0);
        expect(foxGaitAmp(5)).toBe(1);
        expect(foxGaitAmp(0.1)).toBeGreaterThan(0);
        expect(foxGaitAmp(0.1)).toBeLessThan(1);
    });
});

describe('shared fox mind: a course', () => {
    it('is a closed line it can be asked for any distance along', () => {
        const course = ring();
        expect(course.length).toBeGreaterThan(TAU * RADIUS * 0.99);
        expect(course.length).toBeLessThan(TAU * RADIUS);
        expect(course.height).toBe(field);
        expect(course.stations).toHaveLength(3);
        // Round once, round three times and backwards: the same place.
        for (const s of [0, 1.7, course.length * 0.4, course.length - 0.01]) {
            const here = course.at(s);
            [s + course.length, s + 3 * course.length, s - course.length, s - 2 * course.length].forEach((far) => {
                course.at(far).forEach((v, k) => expect(v, `s ${s}`).toBeCloseTo(here[k], 9));
            });
            // On the ring, heading the way it goes: square to the line from the middle, to its left.
            expect(Math.hypot(here[0] - MIDDLE[0], here[1] - MIDDLE[1])).toBeGreaterThan(RADIUS * 0.999);
            expect(Math.hypot(here[0] - MIDDLE[0], here[1] - MIDDLE[1])).toBeLessThanOrEqual(RADIUS + 1e-9);
            const on = course.at(s + 0.05);
            expect(wrap(Math.atan2(on[0] - here[0], on[1] - here[1]) - here[2])).toBeCloseTo(0, 1);
        }
        // It writes where it is told to.
        const out = [9, 9, 9];
        expect(course.at(2, out)).toBe(out);
        expect(out).toEqual(course.at(2));
    });

    it('goes smoothly between the points it was given, the short way round where a heading wraps', () => {
        // A square of four points; the heading passes ±π between the third and the fourth.
        const points = [0, 0, 3, 4, 0, 3.1, 4, 4, -3.1, 0, 4, -3];
        const course = foxCourse({
            points, count: 4, length: 16, stations: [2], height: () => 0,
        });
        expect(course.viewer).toEqual([0, 0]); // (at the origin, when it is not said)
        expect(course.at(0)).toEqual([0, 0, 3]);
        expect(course.at(4)).toEqual([4, 0, 3.1]);
        const [x, z, heading] = course.at(2);
        expect([x, z]).toEqual([2, 0]);
        expect(heading).toBeCloseTo(3.05, 12);
        // Half-way from 3.1 to −3.1 is π (or −π), not 0.
        expect(Math.abs(course.at(6)[2])).toBeGreaterThan(3.1);
        expect(Math.cos(course.at(6)[2])).toBeCloseTo(-1, 2);
        // And the last point leads back to the first.
        expect(course.at(14).slice(0, 2)).toEqual([0, 2]);
    });
});

describe('shared fox mind: on its course', () => {
    it('starts at its first stopping place, or where it is told, already at its trot', () => {
        const mind = makeMind();
        expect(mind.s).toBe(mind.course.stations[0]);
        expect(mind.mode).toBe('gait');
        expect(mind.speed).toBe(mind.paces.trot);
        expect(mind.seed).toBe(0xf0c5);
        const placed = makeMind({ start: 17.5, seed: 7 });
        expect(placed.s).toBe(17.5);
        expect(placed.seed).toBe(7);
        // Its pose is where the course is, on the course's own ground, heading the way it goes.
        const at = placed.course.at(17.5);
        expect(placed.pose).toMatchObject({
            x: at[0], z: at[1], heading: at[2], y: field(at[0], at[1]), clip: 'Run', lift: 0,
        });
        const time = run(placed, 0, 2);
        expect(placed.s - 17.5).toBeCloseTo(placed.paces.trot * 2, 6);
        const on = placed.course.at(placed.s);
        expect(placed.pose.x).toBeCloseTo(on[0], 12);
        expect(placed.pose.z).toBeCloseTo(on[1], 12);
        expect(placed.pose.y).toBe(field(placed.pose.x, placed.pose.z));
        expect(placed.pose.heading).toBeCloseTo(on[2], 9);
        expect(time).toBeCloseTo(2, 9);
        // Its gait turns over a cycle a stride of the rig's.
        expect(placed.phase * RIG.stride(placed.speed)).toBeCloseTo(placed.s - 17.5, 6);
    });

    it('stops only at its stopping places, and not before its first stop is due', () => {
        // A station a couple of metres ahead: it trots past it while its first stop is not due.
        const course = ring();
        const mind = new FoxMind({
            rig: RIG, course, start: course.stations[1] - 3, firstStop: 6,
        });
        let passed = false;
        run(mind, 0, 5.9, REST, (m) => {
            expect(m.mode).toBe('gait');
            if (m.s > course.stations[1] + 0.5) passed = true;
        });
        expect(passed).toBe(true);
        expect(mind.speed).toBe(mind.paces.trot);
        // Due, it brakes for the next one and pulls up on it.
        const stops = [];
        let was = mind.mode;
        let last = mind.s;
        run(mind, 5.9, 240, REST, (m) => {
            expect(m.s).toBeGreaterThanOrEqual(last); // never backward
            last = m.s;
            if (m.mode === 'idle' && was !== 'idle') stops.push({ gap: stationGap(m), speed: m.speed });
            was = m.mode;
        });
        expect(stops.length).toBeGreaterThan(4);
        stops.forEach((stop) => {
            expect(stop.gap).toBeLessThan(0.25);
            expect(stop.speed).toBeLessThan(mind.paces.trot);
        });
        expect(mind.s).toBeGreaterThan(course.length);
    });

    it('does at a stop what its theme says a fox of its kind does, and nothing else', () => {
        const done = (stops, seed = 3) => {
            const mind = makeMind({ stops, seed, firstStop: 1 });
            const seen = new Set();
            const chosen = [];
            let had = null;
            run(mind, 0, 200, REST, (m) => {
                if (m.mode === 'idle' && m.act && m.act !== had) chosen.push(m.act);
                had = m.mode === 'idle' ? m.act : null;
                seen.add(m.clip);
            });
            return { seen: [...seen].sort(), chosen };
        };
        // One thing only: it is all it ever does.
        const sitter = done([['Sit']]);
        expect(sitter.seen).toEqual(['Run', 'Sit']);
        expect(sitter.chosen.length).toBeGreaterThan(4);
        // A run of acts is done in its order, each for its length.
        const lists = [['Greet', 'Shake'], ['Stretch']];
        const two = done(lists);
        expect(two.seen).toEqual(['Greet', 'Run', 'Shake', 'Stretch']);
        two.chosen.forEach((act) => expect(lists).toContain(act));
        expect(new Set(two.chosen).size).toBe(2); // (both, over a few minutes)
        // Left to itself it does what every fox does.
        const usual = done(undefined, 5);
        usual.chosen.forEach((act) => expect(FOX_STOPS).toContain(act));
        // An act of the rig's own is as good as any: it plays for the length the rig gives it.
        const rig = createFoxRig({
            ...madeUp(1.3),
            size: 1.3,
            scale: SCALE,
            acts: {
                Wave(spec, t) {
                    spec[SPEC.headRoll] = 0.3 * Math.sin(t * 4);
                },
            },
            lengths: { Wave: 1.25 },
        });
        const waver = new FoxMind({
            rig, course: ring(), stops: [['Wave']], firstStop: 1,
        });
        const began = runUntil(waver, 0, (m) => m.clip === 'Wave');
        const ended = runUntil(waver, began, (m) => m.mode === 'gait');
        expect(ended - began).toBeGreaterThan(1.25 - 1e-6);
        expect(ended - began).toBeLessThan(1.25 + 3 * DT);
    });

    it('keeps its place along a course that changes shape', () => {
        const mind = makeMind();
        const time = run(mind, 0, 4, { power: 0.6, surge: 0 });
        const share = mind.s / mind.course.length;
        const small = ring({ radius: 4 });
        mind.setCourse(small);
        expect(mind.course).toBe(small);
        expect(mind.s / small.length).toBeCloseTo(share, 12);
        // From the next pose on it is on the new course, and goes on from there without a jump.
        mind.resolve(time);
        const at = small.at(mind.s);
        expect(mind.pose.x).toBeCloseTo(at[0], 9);
        expect(mind.pose.z).toBeCloseTo(at[1], 9);
        expect(mind.pose.y).toBe(field(mind.pose.x, mind.pose.z));
        const before = mind.s;
        mind.step(DT, time + DT, { power: 0.6, surge: 0 });
        expect(mind.s - before).toBeCloseTo(mind.speed * DT, 6);
        // (Its lean and its look are not thrown by the change: its path did not turn under it.)
        expect(Math.abs(mind.turn)).toBeLessThan(1);
        // Laps, and a place behind the start, come through the same.
        for (const s of [-3.5, 0, mind.course.length * 2.25]) {
            const other = makeMind();
            other.s = s;
            const whole = other.course.length;
            other.setCourse(small);
            expect(other.s / small.length, `s ${s}`).toBeCloseTo(s / whole, 12);
        }
    });
});

describe('shared fox mind: whoever is watching', () => {
    /** A mind pulled up at a stopping place, with one thing to do there and the viewer where `viewer` says. */
    function stopped(viewer) {
        const mind = new FoxMind({
            rig: RIG, course: ring({ viewer }), stops: [['Sit']], firstStop: 0.5, start: ring().stations[0] - 1.5,
        });
        const time = runUntil(mind, 0, (m) => m.mode === 'idle');
        return { mind, time };
    }
    /** Where the viewer is from it: to its left (+) or its right (−), and how far round. */
    const bearing = (mind) => wrap(Math.atan2(
        mind.course.viewer[0] - mind.pose.x,
        mind.course.viewer[1] - mind.pose.z,
    ) - mind.pose.heading);

    it('turns to face the course\'s viewer before it does what it stopped for', () => {
        for (const viewer of [[MIDDLE[0], MIDDLE[1]], [MIDDLE[0] + 60, MIDDLE[1] - 5], [-40, 30]]) {
            const { mind, time } = stopped(viewer);
            const off = bearing(mind);
            const from = mind.pose.heading;
            expect(Math.abs(off)).toBeGreaterThan(0.3);
            runUntil(mind, time, (m) => m.act !== null, 5);
            const turned = wrap(mind.pose.heading - from);
            // Toward them, part of the way: never past them, never the other way.
            expect(Math.sign(turned), `viewer at ${viewer}`).toBe(Math.sign(off));
            expect(Math.abs(turned)).toBeGreaterThan(0.05);
            expect(Math.abs(turned)).toBeLessThan(Math.abs(off));
            expect(Math.abs(bearing(mind))).toBeLessThan(Math.abs(off));
            // And it sits with its tail toward them: the side they are on.
            expect(mind.pose.clip).toBe('Sit');
            expect(mind.pose.side).toBe(Math.sign(bearing(mind)));
            expect(mind.viewerSide()).toBe(mind.pose.side);
        }
    });

    it('follows a viewer who moves: the course\'s viewer is read when it is needed, not kept', () => {
        const { mind, time } = stopped([MIDDLE[0], MIDDLE[1]]);
        const inside = Math.sign(mind.toFace());
        expect(mind.viewerSide()).toBe(inside);
        // The viewer walks round to its other side before it has turned.
        const { x, z, heading } = mind.pose;
        mind.course.viewer[0] = x - Math.cos(heading) * inside * 30;
        mind.course.viewer[1] = z + Math.sin(heading) * inside * 30;
        expect(Math.sign(mind.toFace())).toBe(-inside);
        expect(mind.viewerSide()).toBe(-inside);
        const from = mind.pose.heading;
        runUntil(mind, time, (m) => m.act !== null, 5);
        expect(Math.sign(wrap(mind.pose.heading - from))).toBe(-inside);
        expect(mind.pose.side).toBe(-inside);
    });

    it('looks at what it is told to attend to from the height of its own eyes', () => {
        const high = makeMind({ paces: { eye: 3 } });
        const low = makeMind({ paces: { eye: 0.2 } });
        [high, low].forEach((mind) => {
            const time = run(mind, 0, 1);
            const {
                x, y, z, heading,
            } = mind.pose;
            // A point ahead of it, 1.5 m above the ground it stands on.
            mind.attend(x + Math.sin(heading) * 6, y + 1.5, z + Math.cos(heading) * 6, time + 3);
            run(mind, time, 1);
        });
        // Below the eyes of the one, above the eyes of the other.
        expect(high.pose.lookPitch).toBeLessThan(-0.05);
        expect(low.pose.lookPitch).toBeGreaterThan(0.05);
        // Left to the rig's scale, its eyes are half a (drawn) metre up.
        expect(makeMind().paces.eye).toBeCloseTo(0.5 * SCALE, 12);
    });
});

describe('shared fox mind: its paces', () => {
    it('trots, runs and dashes at the speeds it is given', () => {
        const paces = { trot: 0.8, run: (power, surge = 0) => 2 + 3 * power + surge, dash: 1.5 };
        const settle = (env, seconds = 8) => {
            const mind = makeMind({ paces, firstStop: 1e9 });
            run(mind, 0, seconds, env);
            return mind;
        };
        expect(settle(REST).speed).toBeCloseTo(0.8, 6);
        expect(settle({ power: 0.5, surge: 0 }).speed).toBeCloseTo(3.5, 3);
        expect(settle({ power: 1, surge: 0.7 }).speed).toBeCloseTo(5.7, 3);
        // Too little power to run on is none: it trots.
        expect(settle({ power: 0.05, surge: 0 }).speed).toBeCloseTo(0.8, 6);
        // A dash is so much on top of its pace for a full startle, less for a lesser one.
        const top = (strength) => {
            const mind = makeMind({ paces, firstStop: 1e9 });
            mind.startle(strength);
            let most = 0;
            run(mind, 0, 3, REST, (m) => { most = Math.max(most, m.speed); });
            return most;
        };
        expect(top(1)).toBeGreaterThan(paces.run(0) * 0.9);
        expect(top(1)).toBeLessThan(paces.run(0) + paces.dash);
        expect(top(0.5)).toBeLessThan(top(1));
        // What it is not given it has of its own.
        const usual = makeMind();
        expect(usual.paces.trot).toBeGreaterThan(0);
        expect(usual.paces.run(1)).toBeGreaterThan(usual.paces.run(0));
        expect(usual.paces.run(0)).toBeGreaterThan(usual.paces.trot);
    });

    it('leaps as high and as far as it is given: its great leap and the low one of its hunt', () => {
        const paces = {
            leapHigh: 2.4, leapLow: 0.9, pounce: 5, mouse: 2,
        };
        const air = POUNCE_AIR[1] - POUNCE_AIR[0];
        // The great leap.
        const leaper = makeMind({ paces, firstStop: 1e9 });
        const from = leaper.s;
        leaper.pounce(0);
        let peak = 0;
        let landings = 0;
        const flown = [];
        run(leaper, 0, FOX_ACTS.Pounce, REST, (m) => {
            peak = Math.max(peak, m.pose.lift);
            landings += m.events.filter((event) => event.type === 'land' && !event.soft).length;
            if (m.pose.lift > 0) flown.push(m.s);
        });
        expect(peak).toBeGreaterThan(2.4 * 0.99);
        expect(peak).toBeLessThanOrEqual(2.4);
        expect(landings).toBe(1);
        // In the air it covers the ground at its pounce's pace, all but the moment it takes to reach it.
        const aloft = (flown.length - 1) * DT;
        expect(flown[flown.length - 1] - flown[0]).toBeGreaterThan(5 * aloft * 0.9);
        expect(flown[flown.length - 1] - flown[0]).toBeLessThanOrEqual(5 * aloft + 1e-9);
        expect(leaper.s - from).toBeGreaterThan(5 * air * 0.9);
        // The leap of its hunt: lower, slower, and it lands softly.
        const hunter = makeMind({ paces, firstStop: 1e9 });
        hunter.rehearse(MOUSING, 0);
        const place = hunter.s;
        let low = 0;
        const soft = [];
        run(hunter, 0, FOX_ACTS.Listen + FOX_ACTS.Pounce, REST, (m) => {
            low = Math.max(low, m.pose.lift);
            m.events.filter((event) => event.type === 'land').forEach((event) => soft.push(event.soft));
        });
        expect(low).toBeGreaterThan(0.9 * 0.99);
        expect(low).toBeLessThanOrEqual(0.9);
        expect(soft).toEqual([true]);
        expect(hunter.s - place).toBeGreaterThan(2 * air * 0.6);
        expect(hunter.s - place).toBeLessThan(2 * (air + 2 * DT));
        // Left to the rig's scale, a leap is the height of the drawn animal's, not the model's.
        const usual = makeMind();
        expect(usual.paces.leapHigh).toBeCloseTo(0.75 * SCALE, 12);
        expect(usual.paces.leapLow).toBeCloseTo(0.4 * SCALE, 12);
        expect(usual.paces.leapHigh).toBeGreaterThan(usual.paces.leapLow);
    });

    it('comes down from a leap cut short as fast as it is said to fall, and goes on while it does', () => {
        for (const fall of [3, 12]) {
            const mind = makeMind({ paces: { leapHigh: 2.4, fall }, firstStop: 1e9 });
            mind.pounce(0);
            const top = run(mind, 0, (POUNCE_AIR[0] + POUNCE_AIR[1]) / 2);
            const height = mind.pose.lift;
            const place = mind.s;
            mind.sleep(top);
            const heights = [height];
            run(mind, top, 2, REST, (m) => heights.push(m.pose.lift));
            const landed = heights.indexOf(0);
            // So much a step, to the step.
            for (let i = 1; i < landed; i++) {
                expect(heights[i - 1] - heights[i], `fall ${fall}`).toBeCloseTo(fall * DT, 9);
            }
            expect(landed * DT).toBeGreaterThan(height / fall - DT);
            expect(landed * DT).toBeLessThan(height / fall + 2 * DT);
            // The longer it is in the air the further its leap carries it on.
            expect(mind.s).toBeGreaterThan(place);
            expect(mind.asleep).toBe(true);
            expect(mind.pose.clip).toBe('CurlSleep');
            expect(mind.pose.clipTime).toBe(SLEEP_HOLD);
        }
    });

    it('brakes for a stopping place as hard and from as far off as it is told', () => {
        const pullUp = (paces) => {
            const course = ring();
            const mind = new FoxMind({
                rig: RIG, course, paces, firstStop: 0, start: course.stations[0] + 2,
            });
            let slowed = null;
            runUntil(mind, 0, (m) => {
                if (slowed === null && m.speed < m.paces.trot - 1e-6) slowed = mind.toStation();
                return m.mode === 'idle';
            });
            return { slowed, gap: stationGap(mind) };
        };
        const gentle = pullUp({ brake: 0.4 });
        const hard = pullUp({ brake: 4 });
        // A gentle brake has to begin sooner; both end on the place.
        expect(gentle.slowed).toBeGreaterThan(hard.slowed * 2);
        expect(gentle.gap).toBeLessThan(0.25);
        expect(hard.gap).toBeLessThan(0.25);
        // Told to brake only from close by, it does not begin before.
        const late = pullUp({ brake: 0.4, brakeFrom: 0.5 });
        expect(late.slowed).toBeLessThan(0.5);
        expect(late.gap).toBeLessThan(0.25);
    });

    it('leaves whatever is ahead of it the room it is told to, and makes a stop of the wait', () => {
        // Alone it has all the room there is, and the room it would leave is none.
        const alone = makeMind();
        expect(alone.ahead).toBe(Infinity);
        expect(alone.aheadSpeed).toBe(0);
        expect(alone.paces.room).toBe(0);
        // Told of something standing eight metres ahead on its course, it pulls up three short
        // of it — never nearer — and does there what it does at a stop, though no stopping
        // place is near and none is due.
        const course = ring();
        const mind = new FoxMind({
            rig: RIG,
            course,
            paces: { room: 3 },
            firstStop: 1e6,
            start: course.stations[0] + 4,
            stops: [MOUSING, ['Sit']],
        });
        const wall = mind.s + 8;
        let least = Infinity;
        const tell = (m) => {
            m.ahead = wall - m.s;
            least = Math.min(least, m.ahead);
        };
        tell(mind);
        const stopped = runUntil(mind, 0, (m) => {
            tell(m);
            return m.mode === 'idle' && m.act !== null;
        }, 30);
        expect(least).toBeGreaterThan(2.85);
        expect(mind.ahead).toBeLessThan(3.3);
        expect(stationGap(mind)).toBeGreaterThan(1);
        // (Its hunt ends in a leap along its course: with something where it would land, it
        // does the other thing it knows.)
        expect(mind.act).toEqual(['Sit']);
        // What is ahead goes on, at a trot: so does it, and no nearer than it was told.
        let time = run(mind, stopped, FOX_ACTS.Sit + 1, REST, tell);
        let gone = wall;
        time = run(mind, time, 12, REST, (m) => {
            gone += m.paces.trot * DT;
            m.ahead = gone - m.s;
            m.aheadSpeed = m.paces.trot;
            least = Math.min(least, m.ahead);
        });
        expect(mind.mode).toBe('gait');
        expect(mind.speed).toBeGreaterThan(mind.paces.trot * 0.8);
        expect(least).toBeGreaterThan(2.85);
        // Running flat out behind something that only trots, it is held to that pace too.
        run(mind, time, 8, { power: 1, surge: 1 }, (m) => {
            gone += m.paces.trot * DT;
            m.ahead = gone - m.s;
            least = Math.min(least, m.ahead);
        });
        expect(least).toBeGreaterThan(2.85);
        expect(mind.speed).toBeLessThan(mind.paces.trot * 1.5);
    });

    it('leaves prints as far apart as it is told, either side of its line — or none at all', () => {
        const printsOf = (paces, env = { power: 0.5, surge: 0 }) => {
            const mind = makeMind({ paces, firstStop: 1e9 });
            const prints = [];
            const others = [];
            const from = mind.s;
            run(mind, 0, 8, env, (m, time) => m.events.forEach((event) => {
                if (event.type === 'print') prints.push({ ...event, at: time });
                else others.push(event.type);
            }));
            return { prints, others, travelled: mind.s - from };
        };
        // A step of nothing: the ground keeps no prints, whatever it does on it.
        const none = printsOf({ printStep: 0 });
        expect(none.travelled).toBeGreaterThan(20);
        expect(none.prints).toEqual([]);
        expect(printsOf({ printStep: 0 }, REST).prints).toEqual([]);
        // Told a step and a width: that far apart along its line, that far off it, left and right in turn.
        const { prints, travelled } = printsOf({ printStep: 0.8, printSide: 0.25 });
        expect(Math.abs(prints.length - travelled / 0.8)).toBeLessThan(1);
        const sides = [];
        prints.forEach((print, i) => {
            // On the course's own ground, at the moment of the step that pressed it.
            expect(print.y).toBe(field(print.x, print.z));
            expect(print.time).toBe(print.at);
            const off = Math.hypot(print.x - MIDDLE[0], print.z - MIDDLE[1]) - RADIUS;
            expect(Math.abs(Math.abs(off) - 0.25), `print ${i}`).toBeLessThan(0.02);
            sides.push(Math.sign(off));
        });
        for (let i = 1; i < sides.length; i++) expect(sides[i], `print ${i}`).toBe(-sides[i - 1]);
        // Left to the rig's scale, the drawn animal's stride of prints.
        expect(makeMind().paces.printStep).toBeCloseTo(0.33 * SCALE, 12);
        // And a fox with no prints still tells of everything else it does.
        const hunter = makeMind({ paces: { printStep: 0 }, firstStop: 1e9 });
        hunter.rehearse(MOUSING, 0);
        const told = new Set();
        run(hunter, 0, 9, REST, (m) => m.events.forEach((event) => told.add(event.type)));
        expect([...told].sort()).toEqual(['dig', 'land', 'shake']);
    });

    it('says where the tip of its tail is at the size it is drawn', () => {
        const mind = makeMind();
        run(mind, 0, 3, { power: 0.4, surge: 0 });
        const { pose } = mind;
        // The rig's own answer, in the model's metres, carried to the world: turned its way, as
        // large as it is drawn, from where it stands.
        const tailBone = 'tail3';
        const tip = RIG.point(RIG.solve(RIG.spec(pose)), tailBone, RIG.marks.tailTip);
        const sin = Math.sin(pose.heading);
        const cos = Math.cos(pose.heading);
        const want = [
            pose.x + (tip[0] * cos + tip[2] * sin) * SCALE,
            pose.y + tip[1] * SCALE,
            pose.z + (tip[2] * cos - tip[0] * sin) * SCALE,
        ];
        const out = [0, 0, 0];
        expect(mind.tail(out)).toBe(out);
        out.forEach((v, k) => expect(v).toBeCloseTo(want[k], 9));
        // Behind it and above the ground.
        const back = (out[0] - pose.x) * sin + (out[2] - pose.z) * cos;
        expect(back).toBeLessThan(0);
        expect(out[1]).toBeGreaterThan(pose.y);
    });
});

describe('shared fox mind: replay', () => {
    it('is deterministic: two minds stepped alike are the same fox, down to every event', () => {
        const a = makeMind({ seed: 11 });
        const b = makeMind({ seed: 11 });
        expect(snapshot(b)).toEqual(snapshot(a));
        const first = night(a);
        const second = night(b);
        expect(second.time).toBe(first.time);
        expect(snapshot(b)).toEqual(snapshot(a));
        expect(second.log).toEqual(first.log);
        // The night was a full one.
        const types = new Set(first.log.map((event) => event.type));
        expect([...types].sort()).toEqual(['dig', 'land', 'print', 'shake']);
        Object.entries(a.pose).forEach(([key, value]) => {
            if (typeof value === 'number') expect(Number.isFinite(value), key).toBe(true);
        });
        // Another seed is another fox: it chooses otherwise, and blinks at other moments.
        const other = makeMind({ seed: 12 });
        const third = night(other);
        expect(third.time).toBe(first.time);
        expect(snapshot(other)).not.toEqual(snapshot(a));
    });

    it('replays the same night after a reset, from where and when it is reset to', () => {
        const mind = makeMind({ seed: 11, start: 9 });
        mind.reset(4);
        const first = night(mind, 4);
        const ended = snapshot(mind);
        // Left asleep with a flick in its tail and a leap half made: a reset forgets all of it.
        mind.pounce(first.time);
        run(mind, first.time, 0.6);
        mind.sleep(first.time + 0.6);
        mind.flickTail(1);
        mind.reset(4);
        const fresh = makeMind({ seed: 11, start: 9 });
        fresh.reset(4);
        expect(snapshot(mind)).toEqual(snapshot(fresh));
        expect(mind.s).toBe(9);
        expect(mind.events).toEqual([]);
        expect(mind.pose.lift).toBe(0);
        const again = night(mind, 4);
        expect(snapshot(mind)).toEqual(ended);
        expect(again.log).toEqual(first.log);
    });
});

/**
 * Sakura Twilight — what the fox does (sakura-fox-mind.js): its course by the stepping-stone
 * path and the fox mind that goes round it. No renderer, no GPU.
 *
 * What is pinned is the garden's side of it: the course is a closed round over dry ground that
 * stops beside the stone lanterns; there is one fox on it (the pair lost one, 2026-10-18), and
 * the same steps give the same fox. (What a fox mind does on a course: shared-fox-mind.test.js;
 * what the garden asks of it and how it is drawn: sakura-world.test.js.)
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SAKURA_STONE_LANTERNS, SAKURA_VIEWS } from '../../src/themes/sakura-twilight/sakura-composition.js';
import {
    SAKURA_FOX_LANTERNS, SAKURA_FOX_PLANS, SAKURA_FOX_REACH, SakuraFoxMind, sakuraFoxCourse,
} from '../../src/themes/sakura-twilight/sakura-fox-mind.js';
import {
    SAKURA_WATER_LEVEL, sakuraLand, sakuraPathZ, sakuraTerrainHeight,
} from '../../src/themes/sakura-twilight/sakura-terrain.js';
import { FoxMind } from '../../src/themes/shared/fox-mind.js';
import { SLEEP_HOLD } from '../../src/themes/shared/fox-rig.js';

const source = readFileSync(path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'src',
    'themes',
    'sakura-twilight',
    'sakura-fox-mind.js',
), 'utf8');

const DT = 1 / 60;
const REST = Object.freeze({ power: 0, surge: 0 });
const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
/** The garden's own ground under them, as sakura-foxes.js hands it over. */
const GARDEN = Object.freeze({ pathZ: sakuraPathZ, height: sakuraTerrainHeight });
const makeMind = () => new SakuraFoxMind(GARDEN);
const COURSE = sakuraFoxCourse(GARDEN);
/** The two stone lanterns that stand by the path. */
const LANTERNS = SAKURA_STONE_LANTERNS.slice(0, 2);
/** How far a place is from the middle of the stepping-stone path (m, over the ground). */
function fromPath(x, z) {
    let least = Infinity;
    for (let px = x - 3; px <= x + 3; px += 0.02) least = Math.min(least, Math.hypot(px - x, sakuraPathZ(px) - z));
    return least;
}

/** Step a mind `seconds` on from `from`; `each` sees it after every step. The time it ends at. */
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

const snapshot = (mind) => mind.foxes.map((fox) => ({
    pose: { ...fox.pose }, s: fox.s, mode: fox.mode, act: fox.act, nextStop: fox.nextStop, asleep: fox.asleep,
}));

/** An evening of everything the garden does to them. */
function evening(mind, from = 0) {
    let time = run(mind, from, 20);
    mind.attend(0, 2.5, -6, time + 1.1, 0.8);
    time = run(mind, time, 3, { power: 0.6, surge: 0 });
    mind.startle(1);
    time = run(mind, time, 4);
    mind.pounce(time);
    time = run(mind, time, 25);
    mind.sleep(time);
    time = run(mind, time, 4);
    mind.wake(time);
    return run(mind, time, 12);
}

describe('sakura fox mind: the module', () => {
    it('is three-free: the shared fox mind and these foxes\' own rig are all it imports', () => {
        const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
        expect(imports).toEqual(['../shared/fox-mind.js', './sakura-fox-rig.js']);
        expect(source).not.toMatch(/\bTHREE\b|\bdocument\b|\bwindow\b|performance\.now|Date\.now|Math\.random/);
    });

    it('plans one fox: a size that reads from the game, its own seed, a start on the course', () => {
        expect(Object.isFrozen(SAKURA_FOX_PLANS)).toBe(true);
        // (The garden had a pair; Olov asked for one of them to go.)
        expect(SAKURA_FOX_PLANS).toHaveLength(1);
        SAKURA_FOX_PLANS.forEach((plan) => {
            expect(Object.isFrozen(plan)).toBe(true);
            expect(plan.scale).toBeGreaterThan(0.7);
            expect(plan.scale).toBeLessThan(1.4);
            expect(plan.start).toBeGreaterThanOrEqual(0);
            expect(plan.start).toBeLessThan(1);
            expect(Number.isInteger(plan.seed)).toBe(true);
        });
        // The lanterns they stop by and go round are the garden's own.
        const places = (lanterns) => lanterns.map((lantern) => [lantern.x, lantern.z]);
        expect(SAKURA_FOX_LANTERNS.map((lantern) => [...lantern])).toEqual(places(LANTERNS));
        // (Handed every lantern of the garden, as sakura-foxes.js hands them, the course is the
        // same: the others are nowhere near the path.)
        const whole = sakuraFoxCourse({ ...GARDEN, lanterns: places(SAKURA_STONE_LANTERNS) });
        expect(SAKURA_STONE_LANTERNS.length).toBeGreaterThan(LANTERNS.length);
        expect(whole.length).toBe(COURSE.length);
        expect(whole.stations).toEqual(COURSE.stations);
        LANTERNS.forEach((lantern) => {
            expect(lantern.kind).toBe('stone_lantern');
            expect(Math.abs(lantern.x)).toBeLessThan(SAKURA_FOX_REACH);
        });
    });
});

describe('sakura fox mind: the course', () => {
    /** Every five centimetres of it: where it is, which way it heads, how far along. */
    const samples = [];
    for (let s = 0; s < COURSE.length; s += 0.05) {
        const [x, z, heading] = COURSE.at(s);
        samples.push({
            s, x, z, heading,
        });
    }

    it('is a closed round by the stepping-stone path: out along the water\'s side, back along the near side', () => {
        // Two lanes the length of the path and a turn at either end.
        expect(COURSE.length).toBeGreaterThan(4 * SAKURA_FOX_REACH);
        expect(COURSE.length).toBeLessThan(4 * SAKURA_FOX_REACH + 30);
        expect(COURSE.height).toBe(sakuraTerrainHeight);
        // Closed: its end is its beginning, and going round again is the same place.
        COURSE.at(COURSE.length).forEach((v, k) => expect(v).toBeCloseTo(COURSE.at(0)[k], 9));
        COURSE.at(COURSE.length + 7.3).forEach((v, k) => expect(v).toBeCloseTo(COURSE.at(7.3)[k], 9));
        const wrong = [];
        const lanes = { out: [], back: [] };
        samples.forEach((here, i) => {
            const next = samples[(i + 1) % samples.length];
            const where = `s ${here.s.toFixed(2)}`;
            // One unbroken line: no gap in it anywhere, its ends included.
            if (!(Math.hypot(next.x - here.x, next.z - here.z) < 0.08)) wrong.push(`${where}: a gap`);
            // By the path, within its reach (it leaves the stones a little to go round a lantern).
            if (!(fromPath(here.x, here.z) < 2.2)) wrong.push(`${where}: off the path`);
            if (!(Math.abs(here.x) < SAKURA_FOX_REACH + 1.5)) wrong.push(`${where}: beyond its reach`);
            // Between its ends, the first half of it goes out toward +x; the second comes back.
            if (Math.abs(here.x) < SAKURA_FOX_REACH - 0.5) {
                const out = here.s < COURSE.length / 2;
                if (Math.sign(Math.sin(here.heading)) !== (out ? 1 : -1)) wrong.push(`${where}: the wrong way`);
                lanes[out ? 'out' : 'back'].push(here);
            }
        });
        // The way out is the lane on the water's side (toward −z) of the way back, all along.
        lanes.out.forEach((here) => {
            const level = lanes.back.reduce((best, there) => (
                Math.abs(there.x - here.x) < Math.abs(best.x - here.x) ? there : best));
            if (!(here.z < level.z - 0.3)) wrong.push(`s ${here.s.toFixed(2)}: not on the water's side`);
        });
        expect(wrong.slice(0, 5)).toEqual([]);
        // Away from the lanterns the lanes keep to the stones: half a metre either side of them.
        const plain = samples.filter((here) => Math.abs(here.x) < 1.5);
        expect(plain.length).toBeGreaterThan(50);
        plain.forEach((here) => {
            expect(here.z - sakuraPathZ(here.x)).toBeCloseTo(here.s < COURSE.length / 2 ? -0.5 : 0.5, 1);
        });
        // It goes the whole reach of the path, both ways.
        const xs = samples.map((sample) => sample.x);
        expect(Math.min(...xs)).toBeLessThan(-SAKURA_FOX_REACH);
        expect(Math.max(...xs)).toBeGreaterThan(SAKURA_FOX_REACH);
    });

    it('never leaves dry ground, and stays before the camera', () => {
        const wrong = [];
        let least = Infinity;
        samples.forEach(({ s, x, z }) => {
            const land = sakuraLand(x, z);
            least = Math.min(least, land);
            if (!(land > 0)) wrong.push(`s ${s.toFixed(2)}: over the water`);
            if (!(sakuraTerrainHeight(x, z) > SAKURA_WATER_LEVEL)) wrong.push(`s ${s.toFixed(2)}: under the water`);
            Object.values(SAKURA_VIEWS).forEach((view) => {
                if (!(z < view.position[2] - 3)) wrong.push(`s ${s.toFixed(2)}: at the camera`);
            });
        });
        expect(wrong.slice(0, 5)).toEqual([]);
        // (Not by a hair: a paw's width of ground and more to spare.)
        expect(least).toBeGreaterThan(0.3);
    });

    it('turns without a jump in its heading, and heads the way it goes', () => {
        const wrong = [];
        // A centimetre at a time, all the way round and over the join.
        let before = COURSE.at(0)[2];
        for (let s = 0.01; s <= COURSE.length + 0.02; s += 0.01) {
            const heading = COURSE.at(s)[2];
            if (!(Math.abs(wrap(heading - before)) < 0.06)) wrong.push(`s ${s.toFixed(2)}: its heading jumps`);
            before = heading;
        }
        samples.forEach((here, i) => {
            const next = samples[(i + 2) % samples.length];
            const going = Math.atan2(next.x - here.x, next.z - here.z);
            if (!(Math.abs(wrap(going - here.heading)) < 0.6)) wrong.push(`s ${here.s.toFixed(2)}: heads off its line`);
        });
        expect(wrong.slice(0, 5)).toEqual([]);
    });

    it('has its stopping places beside the stone lanterns: one on the way out and one on the way back, each', () => {
        const { stations } = COURSE;
        expect(stations).toHaveLength(2 * LANTERNS.length);
        expect([...stations].sort((a, b) => a - b)).toEqual([...stations]);
        stations.forEach((station) => {
            expect(station).toBeGreaterThanOrEqual(0);
            expect(station).toBeLessThan(COURSE.length);
        });
        LANTERNS.forEach((lantern) => {
            // Near the lantern, in its light — and clear of its stone, however the fox turns there.
            const beside = stations.filter((station) => {
                const [x, z] = COURSE.at(station);
                return Math.hypot(x - lantern.x, z - lantern.z) < 2.5;
            });
            expect(beside, `the lantern at x ${lantern.x}`).toHaveLength(2);
            const places = beside.map((station) => COURSE.at(station));
            places.forEach(([x, z]) => expect(Math.hypot(x - lantern.x, z - lantern.z)).toBeGreaterThan(1.15));
            // One on the way out and one on the way back, and not side by side: the stop going
            // out and the stop coming back are two places.
            expect(beside.map((station) => station < COURSE.length / 2).sort()).toEqual([false, true]);
            expect(Math.hypot(places[0][0] - places[1][0], places[0][1] - places[1][1])).toBeGreaterThan(1.4);
        });
        // The places are apart: a fox is under way for a while between two of them.
        stations.forEach((station, i) => {
            const next = stations[(i + 1) % stations.length];
            const ahead = (((next - station) % COURSE.length) + COURSE.length) % COURSE.length;
            expect(ahead).toBeGreaterThan(5);
        });
    });

    it('goes round the stone lanterns: no fox walks through one, or sits in it', () => {
        const near = (course, [lx, lz]) => {
            let least = Infinity;
            for (let s = 0; s < course.length; s += 0.02) {
                const [x, z] = course.at(s);
                least = Math.min(least, Math.hypot(x - lx, z - lz));
            }
            return least;
        };
        // (A stone lantern's foot is half a metre across its widest; a fox is a quarter.)
        LANTERNS.forEach((lantern) => expect(near(COURSE, [lantern.x, lantern.z])).toBeGreaterThan(1));
        // It is the lanterns that bend it: told of none, the lanes run straight through where
        // they stand, and it has no stopping places.
        const bare = sakuraFoxCourse({ ...GARDEN, lanterns: [] });
        expect(bare.stations).toEqual([]);
        expect(Math.min(...LANTERNS.map((lantern) => near(bare, [lantern.x, lantern.z])))).toBeLessThan(0.5);
        // Wherever one is stood — in the water's lane, in the near one, between them — both
        // lanes go round it, on ground that stays dry.
        [-0.5, 0, 0.5].forEach((off) => {
            [-4.5, 0.8, 5.2].forEach((x) => {
                const lantern = [x, sakuraPathZ(x) + off];
                const course = sakuraFoxCourse({ ...GARDEN, lanterns: [lantern] });
                expect(near(course, lantern), `a lantern at ${lantern}`).toBeGreaterThan(1);
                expect(course.stations).toHaveLength(2);
                for (let s = 0; s < course.length; s += 0.05) {
                    const [px, pz] = course.at(s);
                    expect(sakuraLand(px, pz)).toBeGreaterThan(0.3);
                }
            });
        });
    });

    it('faces whoever is watching: at the camera unless it is told where they stand', () => {
        expect(COURSE.viewer).toEqual([0, SAKURA_VIEWS.landscape.position[2]]);
        const mind = new SakuraFoxMind({ ...GARDEN, viewer: [3, 12] });
        expect(mind.course.viewer).toEqual([3, 12]);
        const before = mind.foxes.map((fox) => fox.toViewer(mind.course.at(fox.s)));
        const { viewer } = mind.course;
        mind.setViewer(-14, 19);
        // (The same course, told in place: the fox's mind reads it there.)
        expect(mind.course.viewer).toBe(viewer);
        expect(mind.course.viewer).toEqual([-14, 19]);
        mind.foxes.forEach((fox, i) => {
            const at = mind.course.at(fox.s);
            expect(fox.toViewer(at)).not.toBe(before[i]);
            expect(fox.toViewer(at)).toBeCloseTo(Math.atan2(-14 - at[0], 19 - at[1]), 9);
        });
        // On flat ground with no path given it is still a course (tools build it bare).
        const bare = new SakuraFoxMind();
        expect(bare.course.length).toBeGreaterThan(4 * SAKURA_FOX_REACH);
        expect(bare.poses.every((pose) => pose.y === 0)).toBe(true);
    });
});

describe('sakura fox mind: the fox', () => {
    it('is one fox mind on the course, its own size, under way from its own start', () => {
        const mind = makeMind();
        expect(mind.foxes).toHaveLength(1);
        expect(mind.poses).toHaveLength(1);
        expect(mind.asleep).toBe(false);
        mind.foxes.forEach((fox, i) => {
            const plan = SAKURA_FOX_PLANS[i];
            expect(fox).toBeInstanceOf(FoxMind);
            expect(fox.course).toBe(mind.course);
            expect(mind.poses[i]).toBe(fox.pose);
            expect(fox.rig.scale).toBe(plan.scale);
            expect(fox.seed).toBe(plan.seed);
            expect(fox.s).toBe(plan.start * mind.course.length);
            expect(fox.mode).toBe('gait');
            expect(fox.pose.y).toBe(sakuraTerrainHeight(fox.pose.x, fox.pose.z));
            // Its own paces: an amble, a run the chain's stream of petals sets it at, and no
            // prints (the grass keeps none).
            expect(fox.speed).toBe(fox.paces.trot);
            expect(fox.paces.run(0)).toBeGreaterThan(fox.paces.trot);
            expect(fox.paces.run(1)).toBeGreaterThan(fox.paces.run(0));
            expect(fox.paces.run(1, 1)).toBeGreaterThan(fox.paces.run(1));
            expect(fox.paces.printStep).toBe(0);
            expect(fox.paces.leapHigh).toBeGreaterThan(fox.paces.leapLow);
            // Alone on its course: nothing ahead of it to leave room for.
            expect(fox.ahead).toBe(Infinity);
            expect(fox.paces.room).toBe(0);
        });
        // It opens on the left of the board, near the lantern there.
        const [fox] = mind.foxes;
        expect(fox.pose.x).toBeLessThan(-3);
        expect(Math.hypot(fox.pose.x - LANTERNS[0].x, fox.pose.z - LANTERNS[0].z)).toBeLessThan(3);
    });

    it('is deterministic: the same evening twice is the same fox, and a reset replays it', () => {
        const one = makeMind();
        const two = makeMind();
        expect(snapshot(two)).toEqual(snapshot(one));
        const ended = evening(one);
        expect(evening(two)).toBe(ended);
        const after = snapshot(one);
        expect(snapshot(two)).toEqual(after);
        after.forEach((fox) => Object.entries(fox.pose).forEach(([key, value]) => {
            if (typeof value === 'number') expect(Number.isFinite(value), key).toBe(true);
        }));
        // Left asleep just after a leap: a reset forgets it and the evening comes round the same.
        one.pounce(ended);
        one.sleep(ended + 0.1);
        run(one, ended, 0.3);
        one.reset(0);
        expect(one.asleep).toBe(false);
        expect(snapshot(one)).toEqual(snapshot(makeMind()));
        evening(one);
        expect(snapshot(one)).toEqual(after);
    });

    it('lies down to sleep where it is, and wakes when the garden stirs', () => {
        const mind = makeMind();
        let time = run(mind, 0, 6);
        mind.sleep(time);
        expect(mind.asleep).toBe(true);
        // It settles at once.
        let lay = null;
        const told = time;
        time = run(mind, time, 2, REST, (m, now) => {
            if (lay === null && m.foxes[0].asleep) lay = now - told;
        });
        expect(lay).toBeLessThan(2 * DT);
        // Curled up, its eyes shut, on the ground, on the side its tail is to the viewer.
        time = run(mind, time, 4);
        const places = mind.foxes.map((fox) => [fox.pose.x, fox.pose.z, fox.s]);
        time = run(mind, time, 20, { power: 0.9, surge: 0.5 });
        mind.startle(1);
        time = run(mind, time, 2);
        mind.foxes.forEach((fox, i) => {
            expect(fox.mode).toBe('sleep');
            expect(fox.pose.clip).toBe('CurlSleep');
            expect(fox.pose.clipTime).toBe(SLEEP_HOLD);
            expect(fox.pose.eyes).toBe(1);
            expect(fox.pose.lift).toBe(0);
            expect([fox.pose.x, fox.pose.z, fox.s]).toEqual(places[i]);
            expect(sakuraLand(fox.pose.x, fox.pose.z)).toBeGreaterThan(0);
            expect(Math.abs(fox.pose.side)).toBe(1);
        });
        // The wind stirs: it is up at once, stretching, and goes on its way.
        mind.wake(time);
        expect(mind.asleep).toBe(false);
        mind.foxes.forEach((fox) => expect([fox.asleep, fox.mode, fox.clip]).toEqual([false, 'idle', 'Stretch']));
        time = run(mind, time, 8);
        mind.foxes.forEach((fox, i) => {
            expect(fox.asleep).toBe(false);
            expect(fox.s).toBeGreaterThan(places[i][2]);
        });
        // Laid down and woken a moment later, it is up again.
        mind.sleep(time);
        time = run(mind, time, 0.2);
        expect(mind.foxes.map((fox) => fox.asleep)).toEqual([true]);
        mind.wake(time);
        run(mind, time, 3);
        expect(mind.foxes.map((fox) => fox.asleep)).toEqual([false]);
    });

    it('leaps on four lines at once, as high as its own size', () => {
        const mind = makeMind();
        let time = run(mind, 0, 4);
        const told = time;
        mind.pounce(time);
        const [fox] = mind.foxes;
        let began = null;
        let peak = 0;
        let landings = 0;
        const wrong = [];
        time = run(mind, time, 3, REST, (m, now) => {
            if (began === null && fox.mode === 'pounce') began = now - told;
            peak = Math.max(peak, fox.pose.lift);
            landings += fox.events.filter((event) => event.type === 'land' && !event.soft).length;
            if (!(sakuraLand(fox.pose.x, fox.pose.z) > 0)) wrong.push('it is over the water');
        });
        expect(wrong.slice(0, 5)).toEqual([]);
        expect(began).toBeLessThan(2 * DT);
        expect(peak).toBeGreaterThan(fox.paces.leapHigh * 0.98);
        expect(peak).toBeLessThanOrEqual(fox.paces.leapHigh);
        // Clear of the grass by more than it stands tall, and down again once.
        expect(peak).toBeGreaterThan(0.6 * fox.rig.scale);
        expect(landings).toBe(1);
        expect(fox.mode).toBe('gait');
        expect(fox.pose.lift).toBe(0);
        // Asleep, four lines have it up and over in one move.
        mind.sleep(time);
        time = run(mind, time, 3);
        expect(fox.asleep).toBe(true);
        mind.pounce(time);
        expect(mind.asleep).toBe(false);
        time = run(mind, time, 0.2);
        expect(fox.mode).toBe('pounce');
        run(mind, time, 0.3);
        expect([fox.mode, fox.asleep]).toEqual(['pounce', false]);
    });

    it('answers the garden: a startle sets it dashing, a chain sets it running, the lanterns turn its head', () => {
        const mind = makeMind();
        let time = run(mind, 0, 1);
        const amble = mind.foxes.map((fox) => fox.speed);
        mind.startle(1);
        time = run(mind, time, 1);
        mind.foxes.forEach((fox, i) => {
            expect(fox.mode).toBe('gait');
            expect(fox.speed).toBeGreaterThan(amble[i] * 1.5);
        });
        // The stream of petals a chain winds up: the more of it, the faster it goes.
        const pace = (power) => {
            const runner = makeMind();
            run(runner, 0, 6, { power, surge: 0 });
            return runner.foxes.map((fox) => fox.speed);
        };
        const slow = pace(0.3);
        const fast = pace(0.9);
        mind.foxes.forEach((fox, i) => {
            expect(slow[i]).toBeGreaterThan(fox.paces.trot * 1.5);
            expect(fast[i]).toBeGreaterThan(slow[i] + 0.5);
            expect(fast[i]).toBeCloseTo(fox.paces.run(0.9), 1);
        });
        // A piece locks, the lanterns breathe: it looks out over the water where the ring runs.
        mind.attend(0, 2.5, -6, time + 1.1, 0.8);
        mind.foxes.forEach((fox) => expect(fox.attending).toEqual({
            x: 0, y: 2.5, z: -6, until: time + 1.1, weight: 0.8,
        }));
        // A rehearsal is for the fox, or the one it names; nobody for a name it has not.
        time = run(mind, time, 4);
        mind.rehearse(['Sit'], time);
        expect(mind.foxes.map((fox) => [fox.mode, fox.clip])).toEqual([['idle', 'Sit']]);
        expect(() => mind.rehearse(['Greet'], time, 5)).not.toThrow();
        run(mind, time, 1);
        expect(mind.foxes.map((fox) => fox.clip)).toEqual(['Sit']);
    });

    it('keeps on dry ground, out of the lanterns and whole, through ten quiet minutes of the garden', () => {
        const mind = makeMind();
        const wrong = [];
        const stops = [0];
        const was = ['gait'];
        run(mind, 0, 600, REST, (m, now) => {
            // It is never in a lantern.
            m.foxes.forEach((fox, i) => {
                LANTERNS.forEach((lantern) => {
                    if (!(Math.hypot(fox.pose.x - lantern.x, fox.pose.z - lantern.z) > 1)) {
                        wrong.push(`${now.toFixed(1)} s: fox ${i} in the lantern at x ${lantern.x}`);
                    }
                });
            });
            m.foxes.forEach((fox, i) => {
                const { x, y, z } = fox.pose;
                if (![x, y, z, fox.pose.heading].every(Number.isFinite)) wrong.push(`${now.toFixed(1)} s: nowhere`);
                if (!(sakuraLand(x, z) > 0)) wrong.push(`${now.toFixed(1)} s: fox ${i} over the water`);
                if (y !== sakuraTerrainHeight(x, z)) wrong.push(`${now.toFixed(1)} s: fox ${i} off the ground`);
                if (fox.mode === 'idle' && was[i] !== 'idle') stops[i] += 1;
                was[i] = fox.mode;
            });
        });
        expect(wrong.slice(0, 5)).toEqual([]);
        // It went on round and stopped by the lanterns a good many times meanwhile.
        stops.forEach((count) => expect(count).toBeGreaterThan(8));
        mind.foxes.forEach((fox, i) => {
            expect(fox.s - SAKURA_FOX_PLANS[i].start * mind.course.length).toBeGreaterThan(mind.course.length);
        });
    });
});

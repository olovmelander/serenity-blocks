/**
 * How a fox wanders (src/themes/shared/fox-wander.js), apart from any theme: on a ring of its own
 * with a made-up test of where it may go and stop. What is pinned is what holds by construction:
 * its stray stays in the room it is given and never doubles its way back on itself, a turn sends
 * it back over the ground it came by, it stops only where it is let, a fox given no walk is the
 * shared fox as it was, and a seed replays it. Winter's and Sakura's own places are pinned in
 * winter-fox-mind.test.js and sakura-fox-mind.test.js.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FoxMind, MOUSING, foxCourse } from '../../src/themes/shared/fox-mind.js';
import {
    WanderingFoxMind, foxWalk, strayRoom, wanderingCourse,
} from '../../src/themes/shared/fox-wander.js';
import { FOX_RIG } from '../../src/themes/winter/winter-fox-rig.js';

const source = readFileSync(path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'src',
    'themes',
    'shared',
    'fox-wander.js',
), 'utf8');

const DT = 1 / 60;
const TAU = Math.PI * 2;
const REST = Object.freeze({ power: 0, surge: 0 });
const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
const height = () => 0;
const VIEWER = [0, 30];

/** A ring round the origin, `radius` across, gone round to its left; two places on it. */
function ring(radius = 8, count = 240) {
    const points = new Float64Array(count * 3);
    for (let i = 0; i < count; i++) {
        const a = (i / count) * TAU;
        points[i * 3] = Math.sin(a) * radius;
        points[i * 3 + 1] = Math.cos(a) * radius;
        points[i * 3 + 2] = wrap(a + Math.PI / 2);
    }
    const length = count * 2 * radius * Math.sin(Math.PI / count);
    return foxCourse({
        points, count, length, stations: [0.2 * length, 0.7 * length], height, viewer: VIEWER,
    });
}

/** A post it keeps clear of, and where it may stop: the half of the ring with x > 0. */
const POST = [8.6, 0];
const fromPost = (x, z) => Math.hypot(x - POST[0], z - POST[1]);
const PLAN = Object.freeze({
    reach: 0.8,
    allowed: (i, x, z, sx, sz) => fromPost(sx, sz) >= Math.min(1.2, fromPost(x, z)),
    open: (i, x) => x > 1,
});
const WAYS = Object.freeze({
    pace: [0.8, 1.2],
    rest: [3, 18],
    anywhere: 0.5,
    turnBack: 0.4,
    turnGap: 15,
    reach: 20,
    restlessTime: 60,
    restlessSpread: 0.3,
    stops: [[['LookAround'], 1, 0.4], [['Sit'], 0.6, 2], [MOUSING, 0.8, 0.5], [['Stretch', 'LookAround'], 0.5]],
});

function wanderer(seed = 7, base = ring()) {
    const walk = foxWalk(base, PLAN);
    return new WanderingFoxMind({
        rig: FOX_RIG,
        course: wanderingCourse(base, walk, { height, viewer: VIEWER }),
        seed,
        paces: { trot: 1.3 },
    }, { ...WAYS, walk });
}

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

describe('shared fox wander: the module', () => {
    it('is three-free and knows no theme: it imports the fox mind beside it and nothing else', () => {
        const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
        expect(imports).toEqual(['./fox-mind.js']);
        expect(source).not.toMatch(/\bTHREE\b|\bdocument\b|\bwindow\b|performance\.now|Date\.now|Math\.random/);
    });
});

describe('shared fox wander: its way over its course', () => {
    it('strays no further than it is let, nor inside a bend more than half its radius', () => {
        const base = ring(1.2);
        const [right, left] = strayRoom(base, 2, () => true);
        // The middle of this ring is on its right as it goes: 0.6 m that side, 2 m the other.
        right.forEach((room) => expect(room).toBeLessThanOrEqual(0.6 + 1e-6));
        left.forEach((room) => expect(room).toBeCloseTo(2, 6));
        // Told never to go nearer the middle, it does not stray toward it at all.
        const [none] = strayRoom(base, 2, (i, x, z, sx, sz) => Math.hypot(sx, sz) >= Math.hypot(x, z));
        none.forEach((room) => expect(room).toBe(0));
    });

    it('keeps clear of what it is told to, strays both ways where it may, and its path stays smooth', () => {
        const base = ring();
        const walk = foxWalk(base, PLAN);
        const at = [0, 0, 0];
        const plain = [0, 0, 0];
        let left = 0;
        let right = 0;
        let previous = null;
        let previousPlain = null;
        for (let q = 0; q < base.length * 6; q += 0.1) {
            walk.at(q, at);
            base.at(q, plain);
            const side = Math.cos(plain[2]) * (at[0] - plain[0]) - Math.sin(plain[2]) * (at[1] - plain[1]);
            left = Math.min(left, side);
            right = Math.max(right, side);
            expect(Math.abs(side)).toBeLessThanOrEqual(PLAN.reach + 1e-6);
            expect(fromPost(at[0], at[1])).toBeGreaterThan(Math.min(1.2, fromPost(plain[0], plain[1])) - 0.02);
            // (It turns hardly more sharply than its course does: 0.35 rad a metre more at most.)
            if (previous !== null) {
                expect(Math.abs(wrap(at[2] - previous))).toBeLessThan(Math.abs(wrap(plain[2] - previousPlain)) + 0.035);
            }
            previous = at[2];
            previousPlain = plain[2];
        }
        expect(right).toBeGreaterThan(0.5);
        expect(left).toBeLessThan(-0.5);
    });

    it('goes back over the ground it came by after a turn, facing the other way', () => {
        const walk = foxWalk(ring(), PLAN);
        walk.turn(10);
        const [q, dir] = walk.along(13);
        expect(dir).toBe(-1);
        expect(q).toBeCloseTo(7, 9);
        const out = walk.at(13, [0, 0, 0]);
        const back = foxWalk(ring(), PLAN).at(7, [0, 0, 0]);
        expect(out[0]).toBeCloseTo(back[0], 9);
        expect(out[1]).toBeCloseTo(back[1], 9);
        expect(Math.abs(wrap(out[2] - back[2] - Math.PI))).toBeLessThan(1e-9);
    });
});

describe('shared fox wander: a fox that wanders', () => {
    it('given no walk, is the fox mind the themes share, step for step', () => {
        const options = {
            rig: FOX_RIG, course: ring(), seed: 11, paces: { trot: 1.3 },
        };
        const plain = new FoxMind(options);
        const unwalked = new WanderingFoxMind(options);
        expect(unwalked.walk).toBe(null);
        run(plain, 0, 60);
        run(unwalked, 0, 60);
        expect(unwalked.pose).toEqual(plain.pose);
        expect(unwalked.s).toBe(plain.s);
    });

    it('stops only where it is let, more often at its places than chance would, and turns back now and then', () => {
        const mind = wanderer();
        const stops = [];
        let { mode } = mind;
        run(mind, 0, 900, REST, (m) => {
            if (m.mode === 'idle' && mode !== 'idle') {
                stops.push({ x: m.pose.x, station: m.stopAtStation, what: m.next.join('+') });
            }
            ({ mode } = m);
        });
        expect(stops.length).toBeGreaterThan(15);
        stops.forEach(({ x }) => expect(x).toBeGreaterThan(1 - PLAN.reach));
        expect(stops.filter((stop) => stop.station).length).toBeGreaterThan(2);
        expect(stops.filter((stop) => !stop.station).length).toBeGreaterThan(2);
        expect(new Set(stops.map((stop) => stop.what)).size).toBeGreaterThanOrEqual(3);
        expect(mind.walk.turns.length).toBeGreaterThanOrEqual(3);
    });

    it('wanders the same night again from a seed and a reset, and keeps its way round when its course changes', () => {
        const a = wanderer(5);
        const b = wanderer(5);
        run(a, 0, 240);
        run(b, 0, 240);
        expect(b.pose).toEqual(a.pose);
        expect(b.walk.turns).toEqual(a.walk.turns);
        a.reset(0);
        run(a, 0, 240);
        expect(a.pose).toEqual(b.pose);
        // A course twice as long: its place and its way round keep their share of it.
        const [q, dir] = a.walk.along(a.s);
        const big = ring(16);
        a.setBase(big, PLAN, wanderingCourse(big, a.walk, { height, viewer: VIEWER }));
        const [q2, dir2] = a.walk.along(a.s);
        expect(dir2).toBe(dir);
        expect(q2 / big.length).toBeCloseTo(q / ring().length, 2);
    });
});

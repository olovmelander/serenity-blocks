import {
    describe, expect, it, vi,
} from 'vitest';
import { GoldenForestSparkSim } from '../../src/themes/golden-forest/golden-forest-spark-sim.js';

const STEP = 1 / 60;
const TOUCH_COOLDOWN = 0.22;
// By design: at most one spark rings the lake per cooldown, so one touch a step is all there is.
const MAX_TOUCHES = 1;
// Ambient fireflies are never drawn lower than this above the lake (as the buffers store it).
const WATERLINE = Math.fround(0.06);
const LAND = () => 0.5;
const DRY = () => 0;

function seededRandom(seed = 271) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function create({ seed = 271, ...options } = {}) {
    return new GoldenForestSparkSim({
        count: 60, reserve: 40, rng: seededRandom(seed), ...options,
    });
}

function run(sim, seconds, env = {}, dt = STEP) {
    const frames = Math.round(seconds / dt);
    for (let frame = 0; frame < frames; frame++) sim.step(dt, env);
}

function allFinite(array) {
    for (let index = 0; index < array.length; index++) {
        if (!Number.isFinite(array[index])) return false;
    }
    return true;
}

/** Every typed array the simulation owns, by name. */
function buffers(sim) {
    return Object.fromEntries(Object.entries(sim).filter(([, value]) => ArrayBuffer.isView(value)));
}

/** A plain copy of every buffer, so a later state can be compared with this one. */
function snapshot(sim) {
    return Object.fromEntries(Object.entries(buffers(sim)).map(([name, array]) => [name, Array.from(array)]));
}

function expectFinite(sim) {
    for (const [name, array] of Object.entries(buffers(sim))) expect(allFinite(array), name).toBe(true);
    for (const touch of sim.touches) expect([touch.x, touch.z, touch.strength].every(Number.isFinite)).toBe(true);
}

/** Indices of the event sparks that are alight. */
function alight(sim) {
    const result = [];
    for (let index = sim.ambient; index < sim.count; index++) if (sim.life[index] > 0) result.push(index);
    return result;
}

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Smallest and largest of one component of a packed buffer, over fireflies `from` .. `to`. */
function extent(array, stride, offset, from, to) {
    let min = Infinity;
    let max = -Infinity;
    for (let index = from; index < to; index++) {
        // Math.min/max keep a NaN once they have seen one, so it cannot pass as "in range".
        min = Math.min(min, array[index * stride + offset]);
        max = Math.max(max, array[index * stride + offset]);
    }
    return [min, max];
}

function expectWithin([min, max], low, high, label) {
    expect(min, `${label} minimum`).toBeGreaterThanOrEqual(low);
    expect(max, `${label} maximum`).toBeLessThanOrEqual(high);
}

/** The river a combo winds around the board, as GoldenForestSparkDirector lays it down. */
function riverField(vortex, { x = 0, z = 6, turn = 1 } = {}) {
    return {
        kind: 'vortex',
        x,
        z,
        radius: 2.8 + 0.8 * vortex,
        reach: 8,
        top: 2.2 + 6.5 * vortex,
        spin: 1.2 + 1.8 * vortex,
        turn,
        grip: 3,
        pull: 9,
        lift: 1 + 2 * vortex,
    };
}

/** Throw a ring of sparks into the orbit, already turning, as the director feeds the river. */
function feedRiver(sim, field, count, vortex, random, life = 9) {
    for (let index = 0; index < count; index++) {
        const angle = random() * Math.PI * 2;
        const radius = 2.7 + random();
        const speed = (1.2 + 1.8 * vortex) * radius * (0.85 + 0.3 * random());
        sim.spawn(
            field.x + Math.cos(angle) * radius,
            0.3 + random() * 2.2,
            field.z + Math.sin(angle) * radius,
            -Math.sin(angle) * speed * field.turn,
            0.5 + random() * 1.2,
            Math.cos(angle) * speed * field.turn,
            life,
            0.5,
            0.1,
        );
    }
}

/** Radius and angular velocity of every lit spark about a field's axis. */
function orbit(sim, field) {
    return alight(sim).map((index) => {
        const dx = sim.x[index] - field.x;
        const dz = sim.z[index] - field.z;
        const radius = Math.hypot(dx, dz);
        return { radius, y: sim.y[index], turning: (dx * sim.vz[index] - dz * sim.vx[index]) / (radius * radius) };
    });
}

describe('Golden Forest firefly simulation', () => {
    describe('construction', () => {
        it('sizes every buffer from the firefly count and splits it into ambient and reserve', () => {
            const sim = new GoldenForestSparkSim({ rng: seededRandom() });
            expect(sim).toMatchObject({ count: 1200, reserve: 480, ambient: 720 });
            for (const name of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'life', 'span', 'heat', 'size', 'seed']) {
                expect(sim[name], name).toBeInstanceOf(Float32Array);
                expect(sim[name], name).toHaveLength(1200);
            }
            expect(sim.home).toHaveLength(720 * 3);
            // Instance buffers: four floats a firefly, whether it is lit or not.
            for (const name of ['outPlace', 'outGlow', 'outVelocity']) {
                expect(sim[name], name).toBeInstanceOf(Float32Array);
                expect(sim[name], name).toHaveLength(1200 * 4);
            }
            expect(sim.touches).toHaveLength(MAX_TOUCHES);
            expect(sim.touchCount).toBe(0);
            expect(sim.counts()).toEqual({ ambient: 720, reserve: 480, live: 0 });
            expectFinite(sim);
        });

        it('clamps the count and the reserve into a usable pool', () => {
            const pool = (count, reserve) => {
                const sim = new GoldenForestSparkSim({ count, reserve, rng: seededRandom() });
                expect(sim.ambient + sim.reserve).toBe(sim.count);
                expect(sim.outPlace).toHaveLength(sim.count * 4);
                return [sim.count, sim.ambient, sim.reserve];
            };
            expect(pool(10, 4)).toEqual([10, 6, 4]);
            expect(pool(10.9, 3.7)).toEqual([10, 7, 3]);
            // There is always at least one ambient firefly and one spark in reserve.
            expect(pool(10, 50)).toEqual([10, 1, 9]);
            expect(pool(10, 0)).toEqual([10, 9, 1]);
            expect(pool(10, -6)).toEqual([10, 9, 1]);
            expect(pool(1, 5)).toEqual([2, 1, 1]);
            expect(pool(0, 0)).toEqual([2, 1, 1]);
            expect(pool(-4, -4)).toEqual([2, 1, 1]);
        });

        it('opens with the ambient fireflies about their homes and the reserve dark', () => {
            const sim = new GoldenForestSparkSim({ rng: seededRandom(5) });
            const { ambient, count } = sim;
            // Default homes: a box over the near water.
            expectWithin(extent(sim.home, 3, 0, 0, ambient), -16, 16, 'home x');
            expectWithin(extent(sim.home, 3, 1, 0, ambient), 0.4, 3.6, 'home y');
            expectWithin(extent(sim.home, 3, 2, 0, ambient), -13, 9, 'home z');
            // Each wanders within a couple of metres of home and never dips into the lake.
            const wander = { x: 0, z: 0 };
            for (let index = 0; index < ambient; index++) {
                wander.x = Math.max(wander.x, Math.abs(sim.outPlace[index * 4] - sim.home[index * 3]));
                wander.z = Math.max(wander.z, Math.abs(sim.outPlace[index * 4 + 2] - sim.home[index * 3 + 2]));
            }
            expect(wander.x).toBeLessThanOrEqual(1.61);
            expect(wander.z).toBeLessThanOrEqual(1.31);
            expect(wander.x).toBeGreaterThan(0.5);
            expectWithin(extent(sim.outPlace, 4, 1, 0, ambient), WATERLINE, 4.2, 'ambient height');
            expectWithin(extent(sim.outPlace, 4, 3, 0, ambient), 0.12, 0.22, 'ambient size');
            // A firefly is never fully dark between flashes, and some are mid-flash.
            const [dimmest, brightest] = extent(sim.outGlow, 4, 0, 0, ambient);
            expect(dimmest).toBeGreaterThanOrEqual(0.1);
            expect(brightest).toBeGreaterThan(0.5);
            for (let index = 0; index < ambient; index += 37) expect(sim.outGlow[index * 4 + 3]).toBe(sim.seed[index]);
            // The reserve waits unseen: no size, no light, no life.
            expect(extent(sim.outPlace, 4, 3, ambient, count)).toEqual([0, 0]);
            expect(extent(sim.outGlow, 4, 0, ambient, count)).toEqual([0, 0]);
            expect(extent(sim.life, 1, 0, ambient, count)).toEqual([0, 0]);
        });

        it('keeps house at the homes it is given', () => {
            const homes = new Float32Array([-20, 3, -40, 14, 6, 2, 0, 1.5, -9]);
            const sim = create({ count: 400, reserve: 100, homes });
            const used = new Set();
            for (let index = 0; index < sim.ambient; index++) {
                const [x, y, z] = sim.home.subarray(index * 3, index * 3 + 3);
                const nearest = [0, 1, 2].find((home) => Math.abs(x - homes[home * 3]) <= 0.8
                    && Math.abs(y - homes[home * 3 + 1]) <= 0.5 && Math.abs(z - homes[home * 3 + 2]) <= 0.8);
                expect(nearest, `firefly ${index} at ${x},${y},${z}`).toBeDefined();
                used.add(nearest);
            }
            expect([...used].sort()).toEqual([0, 1, 2]);
            // Too short to hold a home: the default box is used instead.
            const fallback = create({ homes: new Float32Array([5, 5]) });
            expect(Math.abs(fallback.home[0])).toBeLessThanOrEqual(16);
            expectFinite(fallback);
        });
    });

    describe('spawning event sparks', () => {
        it('lights reserve sparks in order and never touches an ambient firefly', () => {
            const sim = create();
            const ambientBefore = Array.from(sim.outPlace.subarray(0, sim.ambient * 4));
            const first = sim.spawn(1, 2, 3, 0.5, 1, -0.5, 2, 0.4, 0.2);
            const second = sim.spawn(4, 5, 6, 0, 0, 0);
            expect([first, second]).toEqual([sim.ambient, sim.ambient + 1]);
            expect(sim.counts()).toEqual({ ambient: 20, reserve: 40, live: 2 });
            expect([sim.x[first], sim.y[first], sim.z[first]]).toEqual([1, 2, 3]);
            expect([sim.vx[first], sim.vy[first], sim.vz[first]]).toEqual([0.5, 1, -0.5]);
            expect(sim.life[first]).toBe(2);
            expect(sim.span[first]).toBe(2);
            // Defaults: 2.4 s, cool, a small point.
            expect(sim.life[second]).toBeCloseTo(2.4, 6);
            expect(sim.heat[second]).toBe(0);
            expect(sim.size[second]).toBeCloseTo(0.085, 6);

            sim.write(0, 0);
            expect(Array.from(sim.outPlace.subarray(first * 4, first * 4 + 4))).toEqual([1, 2, 3, sim.size[first]]);
            expect(sim.size[first]).toBeCloseTo(0.2, 6);
            expect(sim.outGlow[first * 4 + 1]).toBeCloseTo(0.4, 6);
            expect(Array.from(sim.outVelocity.subarray(first * 4, first * 4 + 3))).toEqual([0.5, 1, -0.5]);
            expect(Array.from(sim.outPlace.subarray(0, sim.ambient * 4))).toEqual(ambientBefore);
        });

        it('clamps life, heat and size and refuses a spark it cannot place', () => {
            const sim = create();
            const index = sim.spawn(0, 1, 0, 0, 0, 0, 0, 7, 9);
            expect(sim.life[index]).toBeCloseTo(0.2, 6);
            expect(sim.span[index]).toBeCloseTo(0.2, 6);
            expect(sim.heat[index]).toBe(1);
            expect(sim.size[index]).toBeCloseTo(0.4, 6);
            const small = sim.spawn(0, 1, 0, 0, 0, 0, -3, -2, 0);
            expect(sim.life[small]).toBeCloseTo(0.2, 6);
            expect(sim.heat[small]).toBe(0);
            expect(sim.size[small]).toBeCloseTo(0.02, 6);

            const state = snapshot(sim);
            const { cursor } = sim;
            for (const args of [[NaN, 1, 0, 0, 0, 0], [0, Infinity, 0, 0, 0, 0], [0, 1, -Infinity, 0, 0, 0],
                [0, 1, 0, NaN, 0, 0], [0, 1, 0, 0, Infinity, 0], [0, 1, 0, 0, 0, NaN], [undefined, 1, 0, 0, 0, 0],
                ['1', 1, 0, 0, 0, 0], [], [null, null, null, null, null, null]]) {
                expect(sim.spawn(...args)).toBe(-1);
            }
            expect(sim.cursor).toBe(cursor);
            expect(sim.counts().live).toBe(2);
            expect(snapshot(sim)).toEqual(state);
        });

        it('falls back to an ordinary spark when life, heat or size is not a number', () => {
            for (const junk of [NaN, Infinity, -Infinity, undefined, null, 'long', {}]) {
                const sim = create({ groundHeight: DRY });
                const index = sim.spawn(0, 4, 0, 0, 0, 0, junk, junk, junk);
                expect(index, String(junk)).toBe(sim.ambient);
                // The defaults of a spark thrown without them: 2.4 s, cool, a small point.
                expect(sim.life[index]).toBeCloseTo(2.4, 6);
                expect(sim.span[index]).toBeCloseTo(2.4, 6);
                expect(sim.heat[index]).toBe(0);
                expect(sim.size[index]).toBeCloseTo(0.085, 6);
            }
            // Each is judged on its own: a bad life does not discard a good heat and size.
            const mixed = create({ groundHeight: DRY });
            const kept = mixed.spawn(0, 4, 0, 0, 0, 0, NaN, 0.7, 0.2);
            expect(mixed.life[kept]).toBeCloseTo(2.4, 6);
            expect(mixed.heat[kept]).toBeCloseTo(0.7, 6);
            expect(mixed.size[kept]).toBeCloseTo(0.2, 6);

            // Regression: a NaN life used to make an immortal spark with NaN brightness.
            const sim = create({ groundHeight: DRY });
            const index = sim.spawn(0, 4, 0, 0, 0, 0, NaN, NaN, NaN);
            let brightest = 0;
            for (let frame = 0; frame < 120; frame++) {
                sim.step(STEP);
                expectFinite(sim);
                brightest = Math.max(brightest, sim.outGlow[index * 4]);
            }
            // It shines like any other spark for its two and a half seconds ...
            expect(brightest).toBeGreaterThan(0.8);
            expect(sim.counts().live).toBe(1);
            expect(sim.life[index]).toBeCloseTo(0.4, 4);
            // ... and then it goes out.
            run(sim, 0.5);
            expect(sim.counts().live).toBe(0);
            expect(sim.outGlow[index * 4]).toBe(0);
            expect(sim.outPlace[index * 4 + 3]).toBe(0);
            expectFinite(sim);
        });

        it('takes the spark nearest its end when the whole reserve is alight', () => {
            const sim = create({ count: 12, reserve: 8 });
            const lives = [5, 3, 1, 4, 2, 6, 7, 8];
            const indices = lives.map((life, slot) => sim.spawn(slot, 2, 0, 0, 0, 0, life));
            expect(indices).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
            expect(sim.counts().live).toBe(8);
            // 1 s left, then 2 s, then 3 s: always the one that would have gone out soonest.
            expect(sim.spawn(50, 2, 0, 0, 0, 0, 9)).toBe(6);
            expect(sim.spawn(51, 2, 0, 0, 0, 0, 9)).toBe(8);
            expect(sim.spawn(52, 2, 0, 0, 0, 0, 9)).toBe(5);
            expect(sim.counts()).toEqual({ ambient: 4, reserve: 8, live: 8 });
            expect([sim.x[6], sim.x[8], sim.x[5]]).toEqual([50, 51, 52]);
            expect([sim.life[6], sim.life[8], sim.life[5]]).toEqual([9, 9, 9]);
            // The others were left burning.
            expect([sim.life[4], sim.life[7], sim.life[9], sim.life[10], sim.life[11]]).toEqual([5, 4, 6, 7, 8]);
        });

        it('prefers a dark spark to one that is still burning', () => {
            const sim = create({ count: 12, reserve: 8, groundHeight: DRY });
            for (let slot = 0; slot < 8; slot++) sim.spawn(slot, 4, 0, 0, 0, 0, slot === 5 ? 0.3 : 6);
            run(sim, 0.5);
            expect(sim.counts().live).toBe(7);
            expect(sim.spawn(0, 4, 0, 0, 0, 0, 6)).toBe(sim.ambient + 5);
            expect(sim.counts().live).toBe(8);
        });

        it('never grows past the reserve however many sparks are thrown', () => {
            const sim = create({ count: 260, reserve: 200, groundHeight: DRY });
            const random = seededRandom(4);
            const ambient = () => Array.from(sim.life.subarray(0, sim.ambient));
            const before = ambient();
            let lowest = Infinity;
            let highest = -Infinity;
            for (let frame = 0; frame < 120; frame++) {
                for (let burst = 0; burst < 40; burst++) {
                    const life = 1 + random() * 3;
                    const index = sim.spawn(random() * 8 - 4, 1 + random() * 4, random() * 8 - 4, 0, 1, 0, life);
                    lowest = Math.min(lowest, index);
                    highest = Math.max(highest, index);
                }
                sim.step(STEP);
                expect(sim.counts().live).toBeLessThanOrEqual(sim.reserve);
            }
            expect(sim.counts().live).toBe(200);
            // Every one of the 4800 sparks went into the reserve, never over an ambient firefly.
            expect(lowest).toBe(sim.ambient);
            expect(highest).toBe(sim.count - 1);
            expect(ambient()).toEqual(before);
            expect(sim.cursor).toBeGreaterThanOrEqual(sim.ambient);
            expect(sim.cursor).toBeLessThan(sim.count);
        });
    });

    describe('life', () => {
        it('fades a spark in, burns it down and puts it out at the end of its life', () => {
            const sim = create({ groundHeight: DRY });
            const index = sim.spawn(0, 5, 0, 0, 0, 0, 1);
            const o = index * 4;
            sim.write(0, 0);
            // It does not pop into view: brightness ramps over the first few hundredths of a second.
            expect(sim.outGlow[o]).toBe(0);
            sim.step(STEP);
            const born = sim.outGlow[o];
            expect(born).toBeGreaterThan(0);
            run(sim, 4 * STEP);
            const lit = sim.outGlow[o];
            expect(lit).toBeGreaterThan(born);
            expect(sim.life[index]).toBeCloseTo(1 - 5 * STEP, 5);
            run(sim, 0.5 - 5 * STEP);
            expect(sim.life[index]).toBeCloseTo(0.5, 5);
            expect(sim.outGlow[o]).toBeLessThan(lit);
            expect(sim.outGlow[o]).toBeGreaterThan(0.3);
            expect(sim.outPlace[o + 3]).toBeGreaterThan(0);
            expect(sim.counts().live).toBe(1);
            run(sim, 0.45);
            expect(sim.outGlow[o]).toBeLessThan(0.3);
            run(sim, 0.1);
            // Out: not merely dim, but drawn at zero size.
            expect(sim.life[index]).toBeLessThanOrEqual(0);
            expect(sim.outGlow[o]).toBe(0);
            expect(sim.outPlace[o + 3]).toBe(0);
            expect(sim.counts().live).toBe(0);
            // A dead spark is no longer simulated.
            const rest = [sim.x[index], sim.y[index], sim.z[index]];
            run(sim, 1);
            expect([sim.x[index], sim.y[index], sim.z[index]]).toEqual(rest);
        });

        it('lets a spark drift upward on its own and carries it down the wind', () => {
            const still = create({ groundHeight: DRY, seed: 3 });
            const windy = create({ groundHeight: DRY, seed: 3 });
            const cross = create({ groundHeight: DRY, seed: 3 });
            const index = still.spawn(0, 3, 0, 0, 0, 0, 5);
            windy.spawn(0, 3, 0, 0, 0, 0, 5);
            cross.spawn(0, 3, 0, 0, 0, 0, 5);
            run(still, 2);
            run(windy, 2, { gust: 1, windX: 1, windZ: 0 });
            run(cross, 2, { gust: 1, windX: 0, windZ: -1 });
            expect(still.y[index]).toBeGreaterThan(3.3);
            expect(windy.x[index] - still.x[index]).toBeGreaterThan(1);
            expect(Math.abs(windy.z[index] - still.z[index])).toBeLessThan(0.2);
            expect(cross.z[index] - still.z[index]).toBeLessThan(-1);
            // Without a gust the wind's direction means nothing.
            const calm = create({ groundHeight: DRY, seed: 3 });
            calm.spawn(0, 3, 0, 0, 0, 0, 5);
            run(calm, 2, { gust: 0, windX: -1, windZ: 1 });
            expect(calm.x[index]).toBe(still.x[index]);
        });

        it('sinks the sparks and burns them out sooner once the lake has settled', () => {
            const playing = create({ groundHeight: DRY, seed: 3 });
            const settled = create({ groundHeight: DRY, seed: 3 });
            const index = playing.spawn(0, 6, 0, 0, 0, 0, 3);
            settled.spawn(0, 6, 0, 0, 0, 0, 3);
            run(playing, 1);
            run(settled, 1, { settled: true });
            expect(playing.life[index]).toBeCloseTo(2, 4);
            expect(settled.life[index]).toBeCloseTo(1.4, 4);
            expect(playing.y[index]).toBeGreaterThan(6);
            expect(settled.y[index]).toBeLessThan(5.6);
            expect(settled.vy[index]).toBeLessThan(0);
            // Only a strict `true` settles it: a truthy stand-in does not.
            const truthy = create({ groundHeight: DRY, seed: 3 });
            truthy.spawn(0, 6, 0, 0, 0, 0, 3);
            run(truthy, 1, { settled: 1 });
            expect(truthy.y[index]).toBe(playing.y[index]);
        });
    });

    describe('water and land', () => {
        it('puts out a spark that touches the lake and records where it went in', () => {
            const sim = create();
            const index = sim.spawn(1.5, 0.3, -2, 0.2, -6, 0, 3);
            let touchedAt = -1;
            for (let frame = 0; frame < 12; frame++) {
                sim.step(STEP);
                if (sim.touchCount > 0 && touchedAt < 0) {
                    touchedAt = frame;
                    expect(sim.touchCount).toBe(1);
                    const [touch] = sim.touches;
                    expect(touch.x).toBeCloseTo(sim.x[index], 6);
                    expect(touch.z).toBeCloseTo(sim.z[index], 6);
                    expect(touch.x).toBeCloseTo(1.5, 1);
                    expect(touch.z).toBeCloseTo(-2, 1);
                    expect(touch.strength).toBeGreaterThanOrEqual(0.16);
                    expect(touch.strength).toBeLessThanOrEqual(0.26);
                    expect(sim.life[index]).toBe(0);
                    expect(sim.y[index]).toBeLessThan(0.02);
                    expect(sim.outPlace[index * 4 + 3]).toBe(0);
                    expect(sim.outGlow[index * 4]).toBe(0);
                } else if (touchedAt >= 0) {
                    // A touch is reported for exactly one step.
                    expect(sim.touchCount).toBe(0);
                }
            }
            expect(touchedAt).toBe(2);
            expect(sim.counts().live).toBe(0);
        });

        it('leaves a spark alone until it is really down on the water', () => {
            const sim = create();
            const index = sim.spawn(0, 0.5, 0, 0, 0, 0, 0.4);
            // Hovering a hand above the lake, drifting upward: it burns out in the air.
            run(sim, 0.6);
            expect(sim.life[index]).toBeLessThanOrEqual(0);
            expect(sim.y[index]).toBeGreaterThan(0.02);
            expect(sim.touchCount).toBe(0);
        });

        it('rations the rings: every spark that lands dies, but touches are a cooldown apart', () => {
            const sim = create({ count: 140, reserve: 120 });
            // A rain of sparks, three reaching the water every frame for two seconds.
            const touches = [];
            let landed = 0;
            for (let frame = 0; frame < 150; frame++) {
                if (frame < 120) {
                    for (let drop = 0; drop < 3; drop++) sim.spawn(drop + frame * 0.01, 0.05, 0, 0, -3, 0, 3);
                }
                const before = sim.counts().live;
                sim.step(STEP);
                landed += before - sim.counts().live;
                // Three sparks went in on this step; the lake hears of one at most.
                expect(sim.touchCount).toBeLessThanOrEqual(MAX_TOUCHES);
                for (let touch = 0; touch < sim.touchCount; touch++) {
                    touches.push({ frame, x: sim.touches[touch].x, strength: sim.touches[touch].strength });
                }
            }
            expect(landed).toBe(360);
            expect(sim.counts().live).toBe(0);
            // Hundreds of sparks went out; the lake was asked for a handful of rings.
            expect(touches.length).toBeGreaterThan(5);
            expect(touches.length).toBeLessThanOrEqual(Math.ceil(2 / TOUCH_COOLDOWN) + 1);
            for (let index = 1; index < touches.length; index++) {
                expect((touches[index].frame - touches[index - 1].frame) * STEP).toBeGreaterThanOrEqual(TOUCH_COOLDOWN);
            }
            for (const touch of touches) {
                expect(touch.strength).toBeGreaterThanOrEqual(0.16);
                expect(touch.strength).toBeLessThanOrEqual(0.26);
            }
        });

        it('bounces a spark off the bank instead of letting it through', () => {
            const groundHeight = vi.fn(LAND);
            const sim = create({ groundHeight });
            const index = sim.spawn(0, 0.9, 0, 0, -6, 0, 3);
            let lowest = Infinity;
            let bounced = false;
            let lifeBefore = sim.life[index];
            for (let frame = 0; frame < 40; frame++) {
                const falling = sim.vy[index] < 0;
                sim.step(STEP);
                lowest = Math.min(lowest, sim.y[index]);
                if (falling && sim.vy[index] > 0 && !bounced) {
                    bounced = true;
                    // It comes back up at a fraction of the speed it came down with ...
                    expect(sim.y[index]).toBeCloseTo(0.55, 5);
                    expect(sim.vy[index]).toBeGreaterThan(1);
                    expect(sim.vy[index]).toBeLessThan(2);
                    // ... and the knock costs it some of its light.
                    expect(sim.life[index]).toBeLessThan((lifeBefore - STEP) * 0.86);
                    expect(sim.life[index]).toBeGreaterThan((lifeBefore - STEP) * 0.84);
                }
                lifeBefore = sim.life[index];
                expect(sim.touchCount).toBe(0);
            }
            expect(bounced).toBe(true);
            expect(lowest).toBeGreaterThanOrEqual(0.55 - 1e-6);
            expect(sim.life[index]).toBeGreaterThan(0);
            // The ground is only asked about sparks that are low enough to meet it.
            expect(groundHeight).toHaveBeenCalled();
            for (const [x, z] of groundHeight.mock.calls) expect([x, z].every(Number.isFinite)).toBe(true);
            const high = create({ groundHeight: vi.fn(LAND) });
            high.spawn(0, 5, 0, 0, 0, 0, 0.5);
            run(high, 0.6);
            expect(high.groundHeight).not.toHaveBeenCalled();
        });

        it('tells bank from water by the ground under each spark', () => {
            const sim = create({ groundHeight: (x) => (x < 0 ? 0.3 : -1.2) });
            const onBank = sim.spawn(-2, 0.5, 0, 0, -5, 0, 3);
            const onLake = sim.spawn(2, 0.5, 0, 0, -5, 0, 3);
            run(sim, 0.3);
            expect(sim.life[onBank]).toBeGreaterThan(0);
            expect(sim.y[onBank]).toBeGreaterThanOrEqual(0.35 - 1e-6);
            expect(sim.life[onLake]).toBe(0);
            // A ground function that answers nonsense neither kills nor bounces.
            const lost = create({ groundHeight: () => NaN });
            const index = lost.spawn(0, 0.1, 0, 0, -5, 0, 1);
            run(lost, 0.3);
            expect(lost.life[index]).toBeGreaterThan(0);
            expectFinite(lost);
        });
    });

    describe('force fields', () => {
        it('throws the sparks inside a burst outward and up, and no others', () => {
            const field = {
                kind: 'burst', x: 0, y: 2, z: 0, radius: 4, power: 20, up: 5,
            };
            const make = () => {
                const sim = create({ groundHeight: DRY, seed: 3 });
                const ids = [[1, 2, 0], [-1, 2, 0], [0, 2, 1.5], [0, 2, -1.5], [9, 2, 0]]
                    .map(([x, y, z]) => sim.spawn(x, y, z, 0, 0, 0, 5));
                return { sim, ids };
            };
            const pushed = make();
            const free = make();
            run(pushed.sim, 0.25, { fields: [field] });
            run(free.sim, 0.25);
            const delta = (name, slot) => pushed.sim[name][pushed.ids[slot]] - free.sim[name][free.ids[slot]];
            expect(delta('vx', 0)).toBeGreaterThan(1.5);
            expect(delta('vx', 1)).toBeLessThan(-1.5);
            expect(delta('vz', 2)).toBeGreaterThan(1);
            expect(delta('vz', 3)).toBeLessThan(-1);
            for (let slot = 0; slot < 4; slot++) expect(delta('vy', slot)).toBeGreaterThan(0.3);
            // Nearer the centre the push is harder.
            expect(delta('vx', 0)).toBeGreaterThan(delta('vz', 2));
            // Outside the radius the field does not exist.
            for (const name of ['x', 'y', 'z', 'vx', 'vy', 'vz']) expect(delta(name, 4)).toBe(0);
        });

        it.each([[1], [-1]])('carries sparks along a jet pointing %i and leaves the rest', (side) => {
            const field = {
                kind: 'jet', x: side * 3, y: 2, z: 0, dx: side, dy: 0.12, dz: 0, radius: 5.4, power: 12,
            };
            const make = () => {
                const sim = create({ groundHeight: DRY, seed: 3 });
                const near = sim.spawn(side * 2, 2, 0.5, 0, 0, 0, 5);
                const far = sim.spawn(side * 14, 2, 0, 0, 0, 0, 5);
                return { sim, near, far };
            };
            const blown = make();
            const free = make();
            run(blown.sim, 0.4, { fields: [field] });
            run(free.sim, 0.4);
            expect((blown.sim.x[blown.near] - free.sim.x[free.near]) * side).toBeGreaterThan(0.4);
            expect((blown.sim.vx[blown.near] - free.sim.vx[free.near]) * side).toBeGreaterThan(2);
            expect(blown.sim.vy[blown.near]).toBeGreaterThan(free.sim.vy[free.near]);
            expect(blown.sim.x[blown.far]).toBe(free.sim.x[free.far]);
            expect(blown.sim.vx[blown.far]).toBe(free.sim.vx[free.far]);
        });

        // Regression: sparks fed into the combo's river used to be flung out to ~11 m from an
        // orbit of ~3 m. The field must hold them on its radius for as long as it turns.
        it.each([
            ['a young river', 0.2], ['a building river', 0.6], ['a river in full spate', 1],
        ])('holds the sparks it is fed on the orbit of %s for seconds on end', (_label, vortex) => {
            const sim = create({ count: 260, reserve: 220, groundHeight: DRY });
            const field = riverField(vortex);
            feedRiver(sim, field, 200, vortex, seededRandom(9));
            let furthest = 0;
            for (let frame = 1; frame <= 420; frame++) {
                sim.step(STEP, { fields: [field] });
                const sparks = orbit(sim, field);
                furthest = Math.max(furthest, ...sparks.map((spark) => spark.radius));
                if (frame % 30 === 0 && frame >= 60) {
                    const radius = mean(sparks.map((spark) => spark.radius));
                    expect(sparks, `t=${frame / 60}`).toHaveLength(200);
                    expect(Math.abs(radius - field.radius), `mean radius ${radius} at t=${frame / 60}`).toBeLessThan(1);
                }
            }
            // Not one of them ever left the neighbourhood of the board, let alone the field.
            expect(furthest).toBeLessThan(field.radius + 1.5);
            const settled = orbit(sim, field);
            expect(Math.abs(mean(settled.map((spark) => spark.radius)) - field.radius)).toBeLessThan(0.3);
            expect(Math.max(...settled.map((spark) => spark.radius))).toBeLessThan(field.radius + 0.5);
            expect(Math.min(...settled.map((spark) => spark.radius))).toBeGreaterThan(field.radius - 0.8);
            // They climb to the top of the column and ride there.
            expect(Math.abs(mean(settled.map((spark) => spark.y)) - field.top)).toBeLessThan(0.5);
            expectFinite(sim);
        });

        it.each([[1], [-1]])('gathers sparks at rest into the orbit and turns them the way it spins (%i)', (turn) => {
            const sim = create({ count: 260, reserve: 220, groundHeight: DRY });
            const field = riverField(1, { x: -3, z: 2, turn });
            const random = seededRandom(9);
            for (let index = 0; index < 200; index++) {
                const angle = random() * Math.PI * 2;
                const radius = 0.5 + random() * 7;
                const x = field.x + Math.cos(angle) * radius;
                const z = field.z + Math.sin(angle) * radius;
                sim.spawn(x, 0.5 + random() * 2, z, 0, 0, 0, 9);
            }
            run(sim, 3, { fields: [field] });
            const sparks = orbit(sim, field);
            expect(sparks).toHaveLength(200);
            // From anywhere between half a metre and the edge of its reach, onto the radius.
            expect(Math.abs(mean(sparks.map((spark) => spark.radius)) - field.radius)).toBeLessThan(0.3);
            expect(Math.max(...sparks.map((spark) => spark.radius))).toBeLessThan(field.radius + 0.5);
            expect(Math.min(...sparks.map((spark) => spark.radius))).toBeGreaterThan(field.radius - 0.5);
            // Every one of them goes round the same way, at a good part of the field's own rate.
            for (const spark of sparks) expect(spark.turning * turn).toBeGreaterThan(field.spin * 0.4);
            expect(mean(sparks.map((spark) => spark.turning)) * turn).toBeLessThanOrEqual(field.spin);
        });

        it('winds a t-spin flourish into a tight spiral beside the board', () => {
            const field = {
                kind: 'vortex',
                x: 4,
                z: 6,
                radius: 1.2,
                reach: 3.4,
                top: 5,
                spin: 4.4,
                turn: -1,
                grip: 3,
                pull: 12,
                lift: 2,
            };
            const sim = create({ count: 120, reserve: 100, groundHeight: DRY });
            const random = seededRandom(9);
            for (let index = 0; index < 44; index++) {
                const angle = index * 0.7;
                const speed = 3 + 0.1 * index;
                sim.spawn(
                    4,
                    2.5 + (random() - 0.5) * 0.6,
                    6,
                    Math.cos(angle) * speed * 0.8 - 2,
                    Math.sin(angle) * speed * 0.6 + 1.5,
                    Math.sin(angle) * 1.5,
                    6,
                    0.6,
                );
            }
            let furthest = 0;
            for (let frame = 0; frame < 120; frame++) {
                sim.step(STEP, { fields: [field] });
                furthest = Math.max(furthest, ...orbit(sim, field).map((spark) => spark.radius));
            }
            const sparks = orbit(sim, field);
            expect(sparks).toHaveLength(44);
            expect(furthest).toBeLessThan(field.reach);
            expect(Math.abs(mean(sparks.map((spark) => spark.radius)) - field.radius)).toBeLessThan(0.3);
            for (const spark of sparks) expect(spark.turning).toBeLessThan(-1);
        });

        it('lets go of sparks that are outside a vortex or far above its column', () => {
            const field = riverField(0.5);
            const make = () => {
                const sim = create({ groundHeight: DRY, seed: 3 });
                return {
                    sim,
                    outside: sim.spawn(field.x + field.reach + 0.5, 2, field.z, 0, 0, 0, 5),
                    above: sim.spawn(field.x + field.radius, field.top + 4, field.z, 0, 0, 0, 5),
                    inside: sim.spawn(field.x + field.radius + 1, 2, field.z, 0, 0, 0, 5),
                };
            };
            const turned = make();
            const free = make();
            run(turned.sim, 0.2, { fields: [field] });
            run(free.sim, 0.2);
            for (const key of ['outside', 'above']) {
                for (const name of ['x', 'y', 'z', 'vx', 'vz']) {
                    expect(turned.sim[name][turned[key]], `${key}.${name}`).toBe(free.sim[name][free[key]]);
                }
            }
            expect(turned.sim.vz[turned.inside]).not.toBe(free.sim.vz[free.inside]);
            expect(turned.sim.x[turned.inside]).toBeLessThan(free.sim.x[free.inside]);
        });

        it('adds the fields together and ignores an empty or missing list', () => {
            const burst = {
                kind: 'burst', x: -1, y: 2, z: 0, radius: 4, power: 20, up: 0,
            };
            const mirror = { ...burst, x: 1 };
            const kick = (fields) => {
                const sim = create({ groundHeight: DRY, seed: 3 });
                const index = sim.spawn(0, 2, 0, 0, 0, 0, 5);
                sim.step(STEP, { fields });
                return sim.vx[index];
            };
            const free = kick([]);
            const once = kick([burst]) - free;
            expect(once).toBeGreaterThan(0.1);
            // The same burst twice pushes twice as hard; its mirror image cancels it.
            expect(kick([burst, burst]) - free).toBeCloseTo(once * 2, 5);
            expect(kick([burst, mirror]) - free).toBeCloseTo(0, 5);
            expect(kick([burst, mirror, burst]) - free).toBeCloseTo(once, 5);
            // No list at all is the same as an empty one.
            expect(kick(undefined)).toBe(free);
            const bare = create({ groundHeight: DRY, seed: 3 });
            const index = bare.spawn(0, 2, 0, 0, 0, 0, 5);
            bare.step(STEP);
            expect(bare.vx[index]).toBe(free);
        });
    });

    describe('ambient fireflies', () => {
        function gap(a, b) {
            let widest = 0;
            for (let index = 0; index < a.ambient; index++) {
                for (let axis = 0; axis < 3; axis++) {
                    widest = Math.max(widest, Math.abs(a.outPlace[index * 4 + axis] - b.outPlace[index * 4 + axis]));
                }
            }
            return widest;
        }

        it('scatter from a burst and drift back to where they keep house', () => {
            const disturbed = create({ count: 40, reserve: 10, seed: 3 });
            const calm = create({ count: 40, reserve: 10, seed: 3 });
            const [x, y, z] = calm.outPlace;
            const field = {
                kind: 'burst', x, y, z, radius: 30, power: 40, up: 5,
            };
            for (let frame = 0; frame < 30; frame++) {
                disturbed.step(STEP, { fields: [field] });
                calm.step(STEP);
            }
            expect(gap(disturbed, calm)).toBeGreaterThan(1);
            let widest = 0;
            for (let frame = 0; frame < 120; frame++) {
                disturbed.step(STEP);
                calm.step(STEP);
                widest = Math.max(widest, gap(disturbed, calm));
            }
            // They overshoot a little, but nobody is thrown out of the scene.
            expect(widest).toBeLessThan(4);
            for (let frame = 0; frame < 720; frame++) {
                disturbed.step(STEP);
                calm.step(STEP);
            }
            // Fourteen seconds on they are back on the paths they would have flown anyway.
            expect(gap(disturbed, calm)).toBeLessThan(0.01);
            // None was lost or put out on the way: ambient fireflies have no lifetime to spend.
            expect(disturbed.counts()).toEqual(calm.counts());
            for (let index = 0; index < disturbed.ambient; index++) {
                expect(disturbed.outPlace[index * 4 + 3]).toBeGreaterThan(0);
                expect(disturbed.outGlow[index * 4]).toBeGreaterThanOrEqual(0.1);
            }
        });

        it('lean downwind in a gust and come back when it drops', () => {
            const windy = create({ count: 40, reserve: 10, seed: 3 });
            const calm = create({ count: 40, reserve: 10, seed: 3 });
            const lean = () => {
                let total = 0;
                for (let index = 0; index < windy.ambient; index++) {
                    total += windy.outPlace[index * 4] - calm.outPlace[index * 4];
                }
                return total / windy.ambient;
            };
            for (let frame = 0; frame < 600; frame++) {
                windy.step(STEP, { gust: 1, windX: 1, windZ: 0 });
                calm.step(STEP);
            }
            // The breeze balances the pull of home about three quarters of a metre out.
            expect(lean()).toBeGreaterThan(0.6);
            expect(lean()).toBeLessThan(0.85);
            for (let frame = 0; frame < 720; frame++) {
                windy.step(STEP);
                calm.step(STEP);
            }
            expect(Math.abs(lean())).toBeLessThan(0.01);
        });

        it('keep wandering and signalling when nothing happens at all', () => {
            const sim = create({ count: 40, reserve: 10, seed: 3 });
            const start = Array.from(sim.outPlace);
            let brightest = 0;
            let lowest = Infinity;
            for (let frame = 0; frame < 600; frame++) {
                sim.step(STEP);
                brightest = Math.max(brightest, extent(sim.outGlow, 4, 0, 0, sim.ambient)[1]);
                lowest = Math.min(lowest, extent(sim.outPlace, 4, 1, 0, sim.ambient)[0]);
            }
            let moved = 0;
            for (let index = 0; index < sim.ambient; index++) {
                moved = Math.max(moved, Math.abs(sim.outPlace[index * 4] - start[index * 4]));
            }
            expect(moved).toBeGreaterThan(0.5);
            expect(lowest).toBeGreaterThanOrEqual(WATERLINE);
            // Somebody flashed in ten seconds; at rest nobody outshines a firefly's own flash.
            expect(brightest).toBeGreaterThan(0.9);
            expect(brightest).toBeLessThanOrEqual(1.4);
            // The world's glow lifts every one of them.
            const dim = Array.from(sim.outGlow);
            sim.write(1, 0);
            for (let index = 0; index < sim.ambient; index++) {
                expect(sim.outGlow[index * 4]).toBeCloseTo(dim[index * 4] + 0.75, 5);
                expect(sim.outGlow[index * 4 + 1]).toBeCloseTo(0.25, 6);
            }
        });
    });

    describe('time and hostile input', () => {
        it('ignores invalid timesteps and clamps long frames to a twentieth of a second', () => {
            const sim = create({ groundHeight: DRY });
            sim.spawn(0, 5, 0, 1, 1, 1, 3);
            sim.step(STEP);
            const { time } = sim;
            const state = snapshot(sim);
            for (const dt of [0, -0, -1, -1e9, NaN, -Infinity, undefined, null, '0.1', {}, []]) {
                sim.step(dt);
                expect(sim.time).toBe(time);
            }
            expect(snapshot(sim)).toEqual(state);
            sim.step(10);
            expect(sim.time).toBeCloseTo(time + 0.05, 12);
            sim.step(Infinity);
            expect(sim.time).toBeCloseTo(time + 0.05, 12);
            sim.step(1e300);
            expect(sim.time).toBeCloseTo(time + 0.1, 12);
            expect(Array.from(sim.outPlace)).not.toEqual(state.outPlace);
            expectFinite(sim);
        });

        it('still answers the light on a frozen frame', () => {
            const sim = create({ groundHeight: DRY });
            const index = sim.spawn(0, 5, 0, 0, 0, 0, 3, 0.2);
            run(sim, 0.2);
            const place = Array.from(sim.outPlace);
            sim.step(0, { glow: 1, heat: 0.9 });
            // Nothing moved, but the envelopes of the frame reached the instance buffers.
            expect(Array.from(sim.outPlace)).toEqual(place);
            expect(sim.outGlow[index * 4 + 1]).toBeCloseTo(0.9, 6);
            expect(sim.outGlow[1]).toBeCloseTo(0.25, 6);
            // The environment's heat never cools a spark that was thrown hot.
            sim.step(0, { heat: 0 });
            expect(sim.outGlow[index * 4 + 1]).toBeCloseTo(0.2, 6);
            // Out-of-range envelopes are clamped, nonsense reads as none.
            sim.step(0, { glow: 40, heat: 40 });
            expect(sim.outGlow[1]).toBeCloseTo(0.25, 6);
            expect(sim.outGlow[index * 4 + 1]).toBe(1);
            sim.step(0, { glow: NaN, heat: -Infinity });
            expect(sim.outGlow[1]).toBe(0);
            expect(sim.outGlow[index * 4 + 1]).toBeCloseTo(0.2, 6);
        });

        it('keeps every buffer finite and in range through a long run of extreme input', () => {
            const sim = create({ count: 300, reserve: 180, groundHeight: (x) => (x < 0 ? 0.4 : -1) });
            const random = seededRandom(11);
            const steps = [STEP, 0, -1, NaN, Infinity, 1e9, 1 / 30, undefined, '0.016', STEP, STEP, -Infinity, 1e-9,
                0.05];
            let peak = 0;
            let touches = 0;
            let mostTouches = 0;
            const poisoned = new Set();
            const seen = Object.fromEntries(['brightness', 'heat', 'streak', 'size']
                .map((name) => [name, [Infinity, -Infinity]]));
            for (let frame = 0; frame < 3000; frame++) {
                if (frame % 3 === 0) {
                    for (let burst = 0; burst < 6; burst++) {
                        sim.spawn(
                            (random() - 0.5) * 20,
                            random() * 6,
                            (random() - 0.5) * 20,
                            (random() - 0.5) * (frame % 50 === 0 ? 1e6 : 20),
                            (random() - 0.5) * 20,
                            (random() - 0.5) * 20,
                            0.5 + random() * 3,
                            random() * 3 - 1,
                            random(),
                        );
                    }
                }
                sim.step(steps[frame % steps.length], {
                    windX: [1, NaN, -1e6, Infinity, 0][frame % 5],
                    windZ: [0, 1e6, NaN][frame % 3],
                    gust: [0, 1, NaN, Infinity, 1e6, -3][frame % 6],
                    glow: [0, NaN, Infinity, -2, 7, 0.5][frame % 6],
                    heat: [0, NaN, 1e9, -5, 0.5][frame % 5],
                    settled: frame % 7 === 0,
                    fields: [{
                        kind: 'burst', x: 0, y: 1, z: 0, radius: 6, power: frame % 11 === 0 ? 1e6 : 30, up: 5,
                    }, {
                        kind: 'jet', x: 3, y: 2, z: 0, dx: 1, dy: 0.12, dz: 0, radius: 5.4, power: 18,
                    }, riverField(1)],
                });
                peak = Math.max(peak, sim.counts().live);
                touches += sim.touchCount;
                mostTouches = Math.max(mostTouches, sim.touchCount);
                for (const array of Object.values(buffers(sim))) if (!allFinite(array)) poisoned.add(frame);
                // Brightness, heat and streak must stay inside what the shader expects.
                for (const [name, array, offset] of [['brightness', sim.outGlow, 0], ['heat', sim.outGlow, 1],
                    ['streak', sim.outGlow, 2], ['size', sim.outPlace, 3]]) {
                    const [min, max] = extent(array, 4, offset, 0, sim.count);
                    seen[name] = [Math.min(seen[name][0], min), Math.max(seen[name][1], max)];
                }
            }
            expect([...poisoned]).toEqual([]);
            expectFinite(sim);
            expectWithin(seen.brightness, 0, 2.2, 'brightness');
            expectWithin(seen.heat, 0, 1, 'heat');
            expectWithin(seen.streak, 0, 1, 'streak');
            expectWithin(seen.size, 0, Math.fround(0.4), 'size');
            // The run was not a quiet one: sparks streaked, ran hot and filled the whole reserve.
            expect(seen.streak[1]).toBe(1);
            expect(seen.heat[1]).toBe(1);
            expect(mostTouches).toBeGreaterThan(0);
            expect(mostTouches).toBeLessThanOrEqual(MAX_TOUCHES);
            expect(peak).toBe(sim.reserve);
            expect(touches).toBeGreaterThan(0);
            expect(Number.isFinite(sim.time)).toBe(true);
            expect(sim.time).toBeGreaterThan(30);
            expect(sim.counts()).toMatchObject({ ambient: 120, reserve: 180 });
        });

        it('survives a random source that returns nonsense', () => {
            for (const rng of [() => NaN, () => 0, () => 1, () => -4, () => Infinity]) {
                const build = () => new GoldenForestSparkSim({ count: 30, reserve: 12, rng });
                expect(build).not.toThrow();
                const sim = build();
                sim.spawn(0, 3, 0, 1, 1, 1, 2);
                expect(() => run(sim, 0.5, { gust: 1 })).not.toThrow();
                expect(sim.counts()).toMatchObject({ ambient: 18, reserve: 12 });
            }
            // A sane source after all: the buffers of a run are finite.
            const sim = create();
            run(sim, 1);
            expectFinite(sim);
        });
    });

    describe('render buffers and reset', () => {
        it('writes place, glow and velocity for every lit spark, with a streak for the fast ones', () => {
            const sim = create({ groundHeight: DRY });
            const slow = sim.spawn(1, 4, 2, 0.2, 0, 0, 4, 0.3, 0.15);
            const fast = sim.spawn(-1, 4, -2, 30, 0, 0, 4, 0.8, 0.15);
            sim.step(STEP);
            for (const index of [slow, fast]) {
                const o = index * 4;
                expect(Array.from(sim.outPlace.subarray(o, o + 4)))
                    .toEqual([sim.x[index], sim.y[index], sim.z[index], sim.size[index]]);
                expect(Array.from(sim.outVelocity.subarray(o, o + 3)))
                    .toEqual([sim.vx[index], sim.vy[index], sim.vz[index]]);
                expect(sim.outGlow[o + 3]).toBe(sim.seed[index]);
            }
            expect(sim.outGlow[slow * 4 + 1]).toBeCloseTo(0.3, 6);
            expect(sim.outGlow[fast * 4 + 1]).toBeCloseTo(0.8, 6);
            // The streak follows speed and saturates.
            expect(sim.outGlow[slow * 4 + 2]).toBeLessThan(0.15);
            expect(sim.outGlow[fast * 4 + 2]).toBe(1);
            expect(sim.outGlow[slow * 4]).toBeGreaterThan(0);
            expect(sim.outGlow[slow * 4]).toBeLessThanOrEqual(1.25);
        });

        it('reproduces the same flight for the same seed and a different one for another', () => {
            const play = (seed) => {
                const sim = create({
                    seed, count: 120, reserve: 80, groundHeight: (x, z) => Math.sin(x) * Math.cos(z),
                });
                const random = seededRandom(seed + 100);
                for (let frame = 0; frame < 240; frame++) {
                    if (frame % 10 === 0) {
                        for (let burst = 0; burst < 8; burst++) {
                            const [x, y, z] = [random() * 6 - 3, random() * 4, random() * 6 - 3];
                            sim.spawn(x, y, z, random() * 8 - 4, random() * 4, random() * 8 - 4);
                        }
                    }
                    sim.step(STEP, {
                        gust: 0.4, windX: 0.9, windZ: 0.4, fields: frame < 120 ? [riverField(0.7)] : [],
                    });
                }
                return sim;
            };
            const first = play(7);
            const again = play(7);
            const other = play(8);
            for (const name of ['outPlace', 'outGlow', 'outVelocity', 'life']) {
                expect(Array.from(again[name]), name).toEqual(Array.from(first[name]));
            }
            expect(again.counts()).toEqual(first.counts());
            expect(Array.from(other.outPlace)).not.toEqual(Array.from(first.outPlace));
        });

        it('returns to its opening state on reset', () => {
            const sim = create({ count: 120, reserve: 80, seed: 5 });
            const fresh = create({ count: 120, reserve: 80, seed: 5 });
            const random = seededRandom(6);
            for (let frame = 0; frame < 200; frame++) {
                for (let burst = 0; burst < 3; burst++) {
                    sim.spawn(random() * 6, 0.1 + random() * 3, random() * 6, 0, -2, 0, 2, 1, 0.3);
                }
                sim.step(STEP, {
                    gust: 1, glow: 1, heat: 1, fields: [riverField(1)],
                });
            }
            expect(sim.counts().live).toBeGreaterThan(0);
            expect(sim.time).toBeGreaterThan(3);
            sim.reset();
            expect(sim.time).toBe(0);
            expect(sim.cursor).toBe(sim.ambient);
            expect(sim.touchCount).toBe(0);
            expect(sim.touchCooldown).toBe(0);
            expect(sim.counts()).toEqual({ ambient: 40, reserve: 80, live: 0 });
            // Indistinguishable from a simulation that was never played.
            for (const name of ['outPlace', 'outGlow', 'outVelocity', 'x', 'y', 'z', 'vx', 'vy', 'vz', 'life',
                'heat']) {
                expect(Array.from(sim[name]), name).toEqual(Array.from(fresh[name]));
            }
            // And it plays again exactly as a fresh one does.
            for (const each of [sim, fresh]) {
                each.spawn(1, 2, 3, 1, 1, 1, 2, 0.5, 0.1);
                run(each, 0.5, { gust: 0.5 });
            }
            expect(sim.spawn(0, 1, 0, 0, 0, 0)).toBe(sim.ambient + 1);
            expect(Array.from(sim.outPlace)).toEqual(Array.from(fresh.outPlace));
            expect(Array.from(sim.outGlow)).toEqual(Array.from(fresh.outGlow));
        });
    });
});

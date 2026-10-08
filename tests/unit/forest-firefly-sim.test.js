import { describe, expect, it } from 'vitest';
import {
    FOREST_FIREFLY_AMBIENT, FOREST_FIREFLY_DEW, FOREST_FIREFLY_SPARK, FOREST_SYNC_PHASE_PER_METRE, ForestFireflySim,
    forestFireflyFlash, forestFireflyPace, forestFireflyWander,
} from '../../src/themes/forest/forest-firefly-sim.js';
import { FOREST_LIGHT_FIELD_BOUNDS, ForestLightField } from '../../src/themes/forest/forest-light-field.js';
import { ForestPulses } from '../../src/themes/forest/forest-pulses.js';
import {
    FOREST_STAG_BOUNDS, createForestStagPoints, forestStagDistance,
} from '../../src/themes/forest/forest-stag.js';

// Pure typed-array code: these tests assert what the drawing code and the director rely on
// (bounds, ownership of slots, what comes back to rest), not today's speeds and strengths.
const STEP = 1 / 60;

function seededRandom(seed = 419) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function allFinite(array) {
    for (let index = 0; index < array.length; index++) {
        if (!Number.isFinite(array[index])) return false;
    }
    return true;
}

function createSim(options = {}) {
    return new ForestFireflySim({
        count: 60, reserve: 40, rng: seededRandom(options.seed ?? 7), ...options,
    });
}

function run(sim, seconds, env = {}) {
    const steps = Math.round(seconds / STEP);
    for (let index = 0; index < steps; index++) sim.step(STEP, env);
}

/** World position of an ambient firefly: its home, its place on the wander path, and its displacement. */
function ambientPosition(sim, index) {
    const offset = forestFireflyWander(sim.seed[index], sim.time, [0, 0, 0]);
    return [
        sim.home[index * 3] + offset[0] + sim.x[index],
        sim.home[index * 3 + 1] + offset[1] + sim.y[index],
        sim.home[index * 3 + 2] + offset[2] + sim.z[index],
    ];
}

function displacement(sim) {
    let total = 0;
    for (let index = 0; index < sim.ambient; index++) total += Math.hypot(sim.x[index], sim.y[index], sim.z[index]);
    return total / sim.ambient;
}

function buffersFinite(sim) {
    return allFinite(sim.outPlace) && allFinite(sim.outGlow) && allFinite(sim.outVelocity) && allFinite(sim.outHome);
}

describe('Forest fireflies: the closed-form path and flash', () => {
    const seeds = Array.from({ length: 40 }, (_, index) => (index + 0.37) / 40);

    it('gives every firefly a pace of its own, within a narrow band', () => {
        const paces = seeds.map(forestFireflyPace);
        for (const pace of paces) {
            expect(pace).toBeGreaterThan(0.3);
            expect(pace).toBeLessThan(3);
        }
        expect(new Set(paces.map((pace) => pace.toFixed(4))).size).toBeGreaterThan(seeds.length * 0.8);
        expect(Math.max(...paces) / Math.min(...paces)).toBeGreaterThan(1.3);
    });

    it('wanders within arm’s reach of home, smoothly, as a pure function of seed and time', () => {
        const out = [9, 9, 9];
        expect(forestFireflyWander(0.3, 4, out)).toBe(out);
        expect(out.every(Number.isFinite)).toBe(true);
        for (const seed of seeds) {
            const reach = [0, 0, 0];
            const sum = [0, 0, 0];
            let previous = forestFireflyWander(seed, 0, [0, 0, 0]);
            let point = [0, 0, 0];
            let samples = 0;
            let fastest = 0;
            for (let t = 0.1; t < 400; t += 0.1) {
                forestFireflyWander(seed, t, point);
                for (let axis = 0; axis < 3; axis++) {
                    reach[axis] = Math.max(reach[axis], Math.abs(point[axis]));
                    sum[axis] += point[axis];
                }
                fastest = Math.max(
                    fastest,
                    Math.hypot(point[0] - previous[0], point[1] - previous[1], point[2] - previous[2]) / 0.1,
                );
                [previous, point] = [point, previous];
                samples += 1;
            }
            // A firefly drifts; it does not dart. Well under a few metres a second.
            expect(fastest).toBeLessThan(4);
            expect(fastest).toBeGreaterThan(0.1);
            // A couple of metres sideways, less than a metre up and down: it never leaves home
            // and never reaches the moss under a home that is a pace above it.
            expect(reach[0]).toBeLessThan(2.5);
            expect(reach[2]).toBeLessThan(2.5);
            expect(reach[1]).toBeLessThan(0.85);
            // It really does move, in all three directions, and its home is the middle of it.
            for (let axis = 0; axis < 3; axis++) {
                expect(reach[axis]).toBeGreaterThan(0.2);
                expect(Math.abs(sum[axis] / samples)).toBeLessThan(reach[axis] * 0.35);
            }
        }
        // No memory: the trail shader asks for earlier times in any order and gets the same path.
        const later = forestFireflyWander(0.61, 37.25, [0, 0, 0]);
        forestFireflyWander(0.61, 5, [0, 0, 0]);
        forestFireflyWander(0.12, 37.25, [0, 0, 0]);
        expect(forestFireflyWander(0.61, 37.25, [0, 0, 0])).toEqual(later);
        expect(forestFireflyWander(0.62, 37.25, [0, 0, 0])).not.toEqual(later);
    });

    it('flashes briefly and regularly on its own clock, and is dark most of the time', () => {
        const periods = [];
        for (const seed of seeds) {
            const peaks = [];
            let lit = 0;
            let total = 0;
            let brightest = 0;
            let darkest = Infinity;
            let rising = false;
            let previous = forestFireflyFlash(seed, 0);
            const dt = 0.01;
            for (let t = dt; t < 70; t += dt) {
                const value = forestFireflyFlash(seed, t);
                brightest = Math.max(brightest, value);
                darkest = Math.min(darkest, value);
                if (value > 0.5) lit += 1;
                total += 1;
                // The top of each main flash (the dimmer echo stays under the threshold).
                if (rising && value < previous && previous > 0.8) peaks.push(t - dt);
                rising = value > previous;
                previous = value;
            }
            expect(darkest).toBeGreaterThanOrEqual(0);
            expect(darkest).toBeLessThan(0.01);
            expect(brightest).toBeGreaterThan(0.9);
            expect(brightest).toBeLessThan(2);
            // Lit for a small part of its cycle.
            expect(lit / total).toBeLessThan(0.2);
            expect(lit / total).toBeGreaterThan(0.005);
            // Periodic: every flash follows the last after the same wait.
            expect(peaks.length).toBeGreaterThan(5);
            const waits = peaks.slice(1).map((peak, index) => peak - peaks[index]);
            const period = waits.reduce((a, b) => a + b, 0) / waits.length;
            expect(Math.max(...waits.map((wait) => Math.abs(wait - period)))).toBeLessThan(0.03);
            expect(period).toBeGreaterThan(1);
            expect(period).toBeLessThan(15);
            // A whole period later it is exactly as bright as it was.
            for (const t of [0.3, 4.4, 17.9]) {
                expect(forestFireflyFlash(seed, t + period * 3)).toBeCloseTo(forestFireflyFlash(seed, t), 1);
            }
            periods.push(period);
        }
        // Their own clocks: no two keep quite the same time.
        expect(new Set(periods.map((period) => period.toFixed(2))).size).toBeGreaterThan(seeds.length * 0.7);
    });

    it('falls into step as the forest wakes, one firefly after another', () => {
        const litTogether = (sync) => {
            let most = 0;
            for (let beat = 0; beat < 1; beat += 0.005) {
                let lit = 0;
                for (const seed of seeds) {
                    if (forestFireflyFlash(seed, beat * 9.7, sync, beat, 6) > 0.5) lit += 1;
                }
                most = Math.max(most, lit / seeds.length);
            }
            return most;
        };
        // On their own clocks only a few are ever lit at once; in step, nearly all of them are.
        const alone = litTogether(0);
        const together = litTogether(1);
        expect(alone).toBeLessThan(0.4);
        expect(together).toBeGreaterThan(0.85);
        // They join one by one: the chorus only grows with sync.
        let previous = 0;
        for (const sync of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
            const joined = seeds.filter((seed) => (
                forestFireflyFlash(seed, 3.3, sync, 0.2, 0) !== forestFireflyFlash(seed, 3.3, 0, 0.2, 0))).length;
            expect(joined).toBeGreaterThanOrEqual(previous);
            previous = joined;
        }
        expect(previous).toBe(seeds.length);
        // Out-of-range sync is the nearest end of the range.
        for (const seed of seeds.slice(0, 6)) {
            expect(forestFireflyFlash(seed, 2, 7, 0.4, 3)).toBe(forestFireflyFlash(seed, 2, 1, 0.4, 3));
            expect(forestFireflyFlash(seed, 2, -3, 0.4, 3)).toBe(forestFireflyFlash(seed, 2, 0, 0.4, 3));
        }
    });

    it('keeps the shared flash on the shared clock, and runs it outward from the hearth', () => {
        expect(FOREST_SYNC_PHASE_PER_METRE).toBeGreaterThan(0);
        expect(FOREST_SYNC_PHASE_PER_METRE).toBeLessThan(1);
        for (const seed of seeds) {
            for (const beat of [0.03, 0.41, 0.77]) {
                const here = forestFireflyFlash(seed, 1.7, 1, beat, 0);
                // One whole beat later the wood flashes again, exactly alike, whatever its own clock says.
                expect(forestFireflyFlash(seed, 1.7, 1, beat + 1, 0)).toBeCloseTo(here, 9);
                expect(forestFireflyFlash(seed, 55.5, 1, beat, 0)).toBeCloseTo(here, 9);
                // A firefly further out flashes later by its distance: the wave travels.
                const away = 11;
                expect(forestFireflyFlash(seed, 1.7, 1, beat + away * FOREST_SYNC_PHASE_PER_METRE, away))
                    .toBeCloseTo(here, 9);
            }
        }
        // Negative clocks (a seek backwards) are still a phase, not a NaN.
        expect(Number.isFinite(forestFireflyFlash(0.4, -12.5, 0.5, -3.2, 4))).toBe(true);
        expect(forestFireflyFlash(0.4, -12.5, 0.5, -3.2, 4)).toBeGreaterThanOrEqual(0);
    });
});

describe('Forest fireflies: the two populations', () => {
    it('splits one buffer into fireflies that live here and a dark reserve', () => {
        const sim = createSim();
        expect(sim.count).toBe(60);
        expect(sim.reserve).toBe(40);
        expect(sim.ambient).toBe(20);
        expect(sim.counts()).toEqual({
            ambient: 20, reserve: 40, live: 0, bound: 0,
        });
        for (const buffer of [sim.outHome, sim.outPlace, sim.outVelocity, sim.outGlow]) {
            expect(buffer).toBeInstanceOf(Float32Array);
            expect(buffer).toHaveLength(60 * 4);
        }
        expect(buffersFinite(sim)).toBe(true);
        for (let index = 0; index < sim.count; index++) {
            expect(sim.seed[index]).toBeGreaterThanOrEqual(0);
            expect(sim.seed[index]).toBeLessThan(1);
            // The seed rides with the home, for the shader's copy of the path.
            expect(sim.outHome[index * 4 + 3]).toBe(sim.seed[index]);
            expect(sim.kind[index]).toBe(index < sim.ambient ? FOREST_FIREFLY_AMBIENT : FOREST_FIREFLY_SPARK);
        }
        // The fireflies that live here are drawn from the start; the reserve is dark and has no size.
        for (let index = 0; index < sim.ambient; index++) {
            expect(sim.outPlace[index * 4 + 3]).toBeGreaterThan(0);
            expect(sim.outGlow[index * 4]).toBeGreaterThan(0);
        }
        for (let index = sim.ambient; index < sim.count; index++) {
            expect(sim.outPlace[index * 4 + 3]).toBe(0);
            expect(sim.outGlow[index * 4]).toBe(0);
        }
        expect([FOREST_FIREFLY_AMBIENT, FOREST_FIREFLY_SPARK, FOREST_FIREFLY_DEW]).toEqual([0, 1, 2]);
    });

    it.each([
        [{ count: 10, reserve: 0 }, 10, 1], [{ count: 10, reserve: 99 }, 10, 9], [{ count: 10.9, reserve: 4.9 }, 10, 4],
        [{ count: 1, reserve: 1 }, 2, 1], [{ count: 0, reserve: 0 }, 2, 1], [{ count: -5, reserve: -5 }, 2, 1],
    ])('keeps at least one of each population for %j', (options, count, reserve) => {
        const sim = new ForestFireflySim({ ...options, rng: seededRandom(3) });
        expect(sim.count).toBe(count);
        expect(sim.reserve).toBe(reserve);
        expect(sim.ambient).toBe(count - reserve);
        expect(sim.ambient).toBeGreaterThanOrEqual(1);
        expect(() => run(sim, 0.2)).not.toThrow();
        expect(buffersFinite(sim)).toBe(true);
    });

    it('keeps house where it is told, a pace clear of the ground', () => {
        const ground = (x, z) => 2 + 0.1 * x - 0.05 * z;
        const homes = new Float32Array([4, ground(4, -6) + 2.2, -6, -9, ground(-9, 3) - 5, 3]);
        const sim = createSim({ homes, groundHeight: ground, hearth: { x: 1, z: -2 } });
        const near = [0, 0];
        for (let index = 0; index < sim.ambient; index++) {
            const [x, y, z] = [sim.home[index * 3], sim.home[index * 3 + 1], sim.home[index * 3 + 2]];
            const which = Math.hypot(x - 4, z + 6) < Math.hypot(x + 9, z - 3) ? 0 : 1;
            near[which] += 1;
            // Scattered a little round one of the places it was given ...
            expect(Math.hypot(x - homes[which * 3], z - homes[which * 3 + 2])).toBeLessThan(1.5);
            // ... and never so low that its wander could touch the moss, even under a home in the ground.
            expect(y - ground(x, z)).toBeGreaterThan(0.8);
            expect(sim.homeFloor[index]).toBeCloseTo(ground(x, z), 4);
            expect(sim.homeAway[index]).toBeCloseTo(Math.hypot(x - 1, z + 2), 4);
            expect(Array.from(sim.outHome.subarray(index * 4, index * 4 + 3))).toEqual([x, y, z]);
        }
        expect(near[0]).toBeGreaterThan(0);
        expect(near[1]).toBeGreaterThan(0);
        // Without a list it scatters them over the glade by itself, on the same ground.
        for (const none of [null, undefined, new Float32Array(0), new Float32Array(2)]) {
            const wild = createSim({ homes: none, groundHeight: ground });
            for (let index = 0; index < wild.ambient; index++) {
                const [x, y, z] = [wild.home[index * 3], wild.home[index * 3 + 1], wild.home[index * 3 + 2]];
                expect(y - ground(x, z)).toBeGreaterThan(0.8);
                expect(y - ground(x, z)).toBeLessThan(6);
                expect(Math.abs(x)).toBeLessThan(40);
            }
        }
    });

    it('builds the same swarm from the same seed', () => {
        const first = createSim({ seed: 11 });
        const second = createSim({ seed: 11 });
        const other = createSim({ seed: 12 });
        expect(second.outHome).toEqual(first.outHome);
        expect(second.size).toEqual(first.size);
        expect(other.outHome).not.toEqual(first.outHome);
        run(first, 1);
        run(second, 1);
        expect(second.outPlace).toEqual(first.outPlace);
        expect(second.outGlow).toEqual(first.outGlow);
    });
});

describe('Forest fireflies: the ones that live here', () => {
    it('stays on its path when nothing disturbs it, and flashes as the pure function says', () => {
        const sim = createSim();
        run(sim, 3);
        expect(sim.time).toBeCloseTo(3, 6);
        for (let index = 0; index < sim.ambient; index++) {
            expect(Math.hypot(sim.x[index], sim.y[index], sim.z[index])).toBeLessThan(1e-6);
            expect(sim.outVelocity[index * 4 + 3]).toBe(FOREST_FIREFLY_AMBIENT);
            // Brightness is the flash plus a faint ember that never quite goes out.
            const flash = forestFireflyFlash(sim.seed[index], sim.time, 0, sim.beat, sim.homeAway[index]);
            expect(sim.outGlow[index * 4]).toBeGreaterThan(flash);
            expect(sim.outGlow[index * 4] - flash).toBeLessThan(0.1);
            expect(sim.outGlow[index * 4 + 2]).toBe(sim.homeAway[index]);
        }
        expect(buffersFinite(sim)).toBe(true);
    });

    it('is carried off by a gust or a burst, and drifts back home when the air is still', () => {
        // A gust carries every one of them downwind, whichever way the wind blows.
        for (const [windX, windZ] of [[1, 0], [0, -1], [-0.6, 0.8]]) {
            const windy = createSim();
            run(windy, 1, { gust: 1, windX, windZ });
            for (let index = 0; index < windy.ambient; index++) {
                expect(windy.x[index] * windX + windy.z[index] * windZ).toBeGreaterThan(0.05);
                expect(Math.abs(windy.x[index] * windZ - windy.z[index] * windX)).toBeLessThan(1e-6);
            }
        }
        // A burst beside one of them throws it clear, up and away from the burst's centre.
        const sim = createSim();
        const home = ambientPosition(sim, 0);
        const burst = {
            kind: 'burst', x: home[0] - 0.4, y: home[1] - 0.5, z: home[2] + 0.3, radius: 6, power: 40, up: 4,
        };
        run(sim, 1, {
            gust: 1, windX: 1, windZ: 0, fields: [burst],
        });
        const blown = displacement(sim);
        expect(blown).toBeGreaterThan(0.1);
        expect(sim.x[0]).toBeGreaterThan(0.2);
        expect(sim.y[0]).toBeGreaterThan(0);
        expect(Math.hypot(sim.x[0], sim.y[0], sim.z[0])).toBeGreaterThan(blown * 0.5);
        // Still air: they come back, steadily enough to be nearly home within ten seconds.
        run(sim, 3);
        expect(displacement(sim)).toBeLessThan(blown);
        run(sim, 10);
        expect(displacement(sim)).toBeLessThan(blown * 0.05);
        run(sim, 20);
        expect(displacement(sim)).toBeLessThan(1e-3);
        expect(buffersFinite(sim)).toBe(true);
    });

    it('feels a force field less than a spark thrown into it does', () => {
        const sim = createSim();
        const [x, y, z] = ambientPosition(sim, 0);
        const jet = {
            kind: 'jet', x, y, z, dx: 1, dy: 0, dz: 0, radius: 8, power: 20,
        };
        const spark = sim.spawn(x, y, z, 0, 0, 0, { life: 9 });
        sim.step(STEP, { fields: [jet] });
        expect(sim.vx[0]).toBeGreaterThan(0);
        expect(sim.vx[spark]).toBeGreaterThan(sim.vx[0] * 1.5);
    });

    it('sinks toward the moss when the forest is settled, and rises again when it wakes', () => {
        const ground = () => 1.5;
        const sim = createSim({ groundHeight: ground });
        const heights = () => Array.from({ length: sim.ambient }, (_, index) => ambientPosition(sim, index)[1] - 1.5);
        run(sim, 2);
        const flying = heights();
        run(sim, 14, { settled: true });
        const sunk = heights();
        const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
        expect(mean(sunk)).toBeLessThan(mean(flying) * 0.75);
        expect(buffersFinite(sim)).toBe(true);
        run(sim, 20);
        expect(displacement(sim)).toBeLessThan(0.02);
    });

    it('lights the whole swarm a little with the forest’s glow, and warms it with its heat', () => {
        const dim = createSim();
        const bright = createSim();
        dim.step(STEP, { glow: 0, heat: 0 });
        bright.step(STEP, { glow: 1, heat: 1 });
        for (let index = 0; index < dim.ambient; index++) {
            expect(bright.outGlow[index * 4]).toBeGreaterThan(dim.outGlow[index * 4]);
            expect(dim.outGlow[index * 4 + 1]).toBe(0);
            expect(bright.outGlow[index * 4 + 1]).toBeGreaterThan(0);
            expect(bright.outGlow[index * 4 + 1]).toBeLessThanOrEqual(1);
        }
        // Out-of-range envelopes are the ends of the range.
        const over = createSim();
        over.step(STEP, { glow: 40, heat: 40 });
        expect(over.outGlow).toEqual(bright.outGlow);
        const under = createSim();
        under.step(STEP, { glow: -40, heat: -40 });
        expect(under.outGlow).toEqual(dim.outGlow);
    });

    it('keeps the shared clock: the beat runs at the rate it is given, within bounds', () => {
        const sim = createSim();
        expect(sim.beat).toBe(0);
        run(sim, 2, { beatRate: 0.5, sync: 0.7 });
        expect(sim.beat).toBeCloseTo(1, 4);
        expect(sim.sync).toBeCloseTo(0.7, 6);
        const before = sim.beat;
        run(sim, 1, { beatRate: 1e9, sync: 9 });
        expect(sim.beat - before).toBeGreaterThan(0.5);
        expect(sim.beat - before).toBeLessThan(10);
        expect(sim.sync).toBe(1);
        const held = sim.beat;
        run(sim, 1, { beatRate: -4, sync: -4 });
        expect(sim.beat).toBe(held);
        expect(sim.sync).toBe(0);
        // With no rate given the clock still runs.
        run(sim, 1);
        expect(sim.beat).toBeGreaterThan(held);
        // In step, the swarm's brightness is the shared flash.
        const chorus = createSim();
        chorus.step(STEP, { sync: 1, beatRate: 0.6 });
        for (let index = 0; index < chorus.ambient; index++) {
            const shared = forestFireflyFlash(chorus.seed[index], chorus.time, 1, chorus.beat, chorus.homeAway[index]);
            expect(chorus.outGlow[index * 4] - shared).toBeGreaterThan(0);
            expect(chorus.outGlow[index * 4] - shared).toBeLessThan(0.1);
        }
    });
});

describe('Forest fireflies: the reserve', () => {
    it('lights a dark spark where it is thrown, and puts it out when its time is up', () => {
        const sim = createSim();
        const index = sim.spawn(1, 2, -3, 0.5, 1, -0.25, { life: 1.5, heat: 0.4, size: 0.12 });
        expect(index).toBeGreaterThanOrEqual(sim.ambient);
        expect(index).toBeLessThan(sim.count);
        expect(sim.counts().live).toBe(1);
        // Dark until the next step writes it; then drawn where it is, the way it is going.
        sim.step(STEP);
        const o = index * 4;
        expect(sim.outPlace[o + 3]).toBeCloseTo(0.12, 6);
        expect(Math.hypot(sim.outPlace[o] - 1, sim.outPlace[o + 1] - 2, sim.outPlace[o + 2] + 3)).toBeLessThan(0.1);
        expect(sim.outVelocity[o + 3]).toBe(FOREST_FIREFLY_SPARK);
        expect(sim.outVelocity[o]).toBeGreaterThan(0);
        expect(sim.outGlow[o]).toBeGreaterThan(0);
        expect(sim.outGlow[o + 1]).toBeCloseTo(0.4, 6);
        // It comes up to full light within a few frames rather than popping.
        const first = sim.outGlow[o];
        run(sim, 0.15);
        expect(sim.outGlow[o]).toBeGreaterThan(first);
        // It burns down, and at the end of its life it is dark and has no size.
        run(sim, 0.9);
        const late = sim.outGlow[o];
        expect(late).toBeLessThan(1);
        run(sim, 0.6);
        expect(sim.counts().live).toBe(0);
        expect(sim.outPlace[o + 3]).toBe(0);
        expect(sim.outGlow[o]).toBe(0);
        expect(buffersFinite(sim)).toBe(true);
    });

    it('bounds what it is asked for', () => {
        const sim = createSim();
        const tiny = sim.spawn(0, 2, 0, 0, 0, 0, { life: -5, heat: 9, size: 9 });
        const odd = sim.spawn(0, 2, 0, 0, 0, 0, {
            life: NaN, heat: NaN, size: NaN, kind: 'moth',
        });
        const dew = sim.spawn(0, 2, 0, 0, 0, 0, { kind: FOREST_FIREFLY_DEW, heat: -3, size: -3 });
        const plain = sim.spawn(0, 2, 0, 0, 0, 0);
        for (const index of [tiny, odd, dew, plain]) {
            expect(sim.life[index]).toBeGreaterThan(0.1);
            expect(sim.life[index]).toBeLessThan(60);
            expect(sim.span[index]).toBe(sim.life[index]);
            expect(sim.heat[index]).toBeGreaterThanOrEqual(0);
            expect(sim.heat[index]).toBeLessThanOrEqual(1);
            expect(sim.size[index]).toBeGreaterThan(0);
            expect(sim.size[index]).toBeLessThan(0.5);
        }
        expect(sim.kind[odd]).toBe(FOREST_FIREFLY_SPARK);
        expect(sim.kind[dew]).toBe(FOREST_FIREFLY_DEW);
        expect(sim.life[odd]).toBe(sim.life[plain]);
        expect(sim.size[odd]).toBe(sim.size[plain]);
    });

    it.each([
        [[NaN, 2, 0, 0, 0, 0]], [[0, Infinity, 0, 0, 0, 0]], [[0, 2, -Infinity, 0, 0, 0]], [[0, 2, 0, NaN, 0, 0]],
        [[0, 2, 0, 0, undefined, 0]], [[0, 2, 0, 0, 0, '3']], [[null, 2, 0, 0, 0, 0]],
    ])('refuses to throw a spark from or to nowhere: %j', (args) => {
        const sim = createSim();
        expect(sim.spawn(...args)).toBe(-1);
        expect(sim.counts().live).toBe(0);
        run(sim, 0.1);
        expect(buffersFinite(sim)).toBe(true);
    });

    it('uses dark sparks first, and when none is dark takes the one nearest its end', () => {
        const sim = createSim({ count: 12, reserve: 10 });
        const taken = [];
        for (let n = 0; n < 10; n++) taken.push(sim.spawn(n, 3, 0, 0, 0, 0, { life: n === 6 ? 2 : 20 + n }));
        expect(new Set(taken).size).toBe(10);
        expect(sim.counts().live).toBe(10);
        run(sim, 0.5);
        // The pool is full: the next spark replaces the one with the least life left.
        const stolen = sim.spawn(0, 9, 0, 0, 0, 0, { life: 30 });
        expect(stolen).toBe(taken[6]);
        expect(sim.y[stolen]).toBe(9);
        expect(sim.counts().live).toBe(10);
        // Then one burns out: its slot is used before anything else is disturbed.
        const lives = () => taken.map((index) => sim.life[index]);
        const shortest = sim.spawn(0, 9, 0, 0, 0, 0, { life: 0.2 });
        run(sim, 0.4);
        expect(sim.life[shortest]).toBeLessThanOrEqual(0);
        const before = lives();
        const reused = sim.spawn(5, 5, 5, 0, 0, 0, { life: 4 });
        expect(reused).toBe(shortest);
        const after = lives();
        taken.forEach((index, n) => { if (index !== reused) expect(after[n]).toBe(before[n]); });
    });

    it('lets a thrown spark fly: drag slows it, the floor turns it back, a settled forest lets it fall', () => {
        const ground = (x) => 0.2 * x;
        const sim = createSim({ groundHeight: ground });
        const fast = sim.spawn(0, 3, 0, 8, 0, 0, { life: 20 });
        sim.step(STEP);
        expect(sim.x[fast]).toBeGreaterThan(0);
        run(sim, 2);
        expect(Math.abs(sim.vx[fast])).toBeLessThan(4);
        // Thrown hard at the ground it is turned back, never drawn under the moss.
        const down = sim.spawn(2, ground(2) + 0.4, 0, 0, -30, 0, { life: 20 });
        for (let frame = 0; frame < 120; frame++) {
            sim.step(STEP);
            expect(sim.y[down]).toBeGreaterThanOrEqual(ground(sim.x[down]) + 0.049);
            expect(sim.y[fast]).toBeGreaterThanOrEqual(ground(sim.x[fast]) + 0.049);
        }
        // A settled forest pulls them down and burns them out sooner.
        const calm = createSim();
        const tired = createSim();
        const a = calm.spawn(0, 5, 0, 0, 0, 0, { life: 6 });
        const b = tired.spawn(0, 5, 0, 0, 0, 0, { life: 6 });
        run(calm, 1.5);
        run(tired, 1.5, { settled: true });
        expect(tired.y[b]).toBeLessThan(calm.y[a]);
        expect(tired.life[b]).toBeLessThan(calm.life[a]);
    });

    it('is moved by the fields laid down for it: thrown out, carried along, wound round', () => {
        const push = (field, at, seconds = 0.25) => {
            const sim = createSim();
            const index = sim.spawn(at[0], at[1], at[2], 0, 0, 0, { life: 30 });
            run(sim, seconds, { fields: [field] });
            return { sim, index };
        };
        // A burst throws outward from its centre, and upward.
        const burst = {
            kind: 'burst', x: 0, y: 5, z: 0, radius: 5, power: 30, up: 6,
        };
        const east = push(burst, [1, 5, 0]);
        const west = push(burst, [-1, 5, 0]);
        expect(east.sim.vx[east.index]).toBeGreaterThan(1);
        expect(west.sim.vx[west.index]).toBeLessThan(-1);
        expect(east.sim.vy[east.index]).toBeGreaterThan(0.5);
        // Out of its reach it does nothing at all.
        const outside = push(burst, [9, 5, 0]);
        const untouched = push({ ...burst, power: 0, up: 0 }, [9, 5, 0]);
        expect(outside.sim.vx[outside.index]).toBe(untouched.sim.vx[untouched.index]);
        // A jet carries along its own direction, wherever in it the spark is.
        const jet = {
            kind: 'jet', x: 0, y: 5, z: 0, dx: 0, dy: 0, dz: -1, radius: 5, power: 30,
        };
        for (const at of [[1, 5, 0], [-1, 5, 1], [0, 6, -1]]) {
            const carried = push(jet, at);
            expect(carried.sim.vz[carried.index]).toBeLessThan(-1);
        }
        // A vortex winds sparks round its axis in the sense it is given, and holds them near it.
        for (const turn of [1, -1]) {
            const vortex = {
                kind: 'vortex',
                x: 0,
                z: 0,
                radius: 1.5,
                reach: 5,
                floor: 0,
                top: 9,
                spin: 3,
                turn,
                grip: 3,
                pull: 12,
                lift: 0,
            };
            const { sim, index } = push(vortex, [2.5, 4, 0], 3);
            const angular = sim.x[index] * sim.vz[index] - sim.z[index] * sim.vx[index];
            expect(Math.sign(angular)).toBe(turn);
            expect(Math.hypot(sim.x[index], sim.z[index])).toBeLessThan(4);
            expect(Math.hypot(sim.x[index], sim.z[index])).toBeGreaterThan(0.3);
            expect(buffersFinite(sim)).toBe(true);
        }
    });

    it('counts what is alight', () => {
        const sim = createSim();
        for (let n = 0; n < 7; n++) sim.spawn(n, 4, 0, 0, 0, 0, { life: n < 3 ? 0.3 : 9 });
        expect(sim.counts()).toEqual({
            ambient: 20, reserve: 40, live: 7, bound: 0,
        });
        run(sim, 0.5);
        expect(sim.counts().live).toBe(4);
    });
});

describe('Forest fireflies: dew', () => {
    it('falls through still air and goes out on the forest floor', () => {
        const ground = () => 1;
        const sim = createSim({ groundHeight: ground });
        const drop = sim.spawn(0, 9, 0, 0.2, 0, 0, { kind: FOREST_FIREFLY_DEW, life: 30 });
        let previous = sim.y[drop];
        let landedAt = null;
        for (let frame = 1; frame <= 600 && landedAt === null; frame++) {
            sim.step(STEP);
            if (sim.life[drop] <= 0) landedAt = frame * STEP;
            else {
                // Always falling, never faster than a drop in air would.
                expect(sim.y[drop]).toBeLessThan(previous);
                expect(sim.vy[drop]).toBeLessThan(0);
                expect(sim.vy[drop]).toBeGreaterThan(-12);
                expect(sim.outVelocity[drop * 4 + 3]).toBe(FOREST_FIREFLY_DEW);
                expect(sim.outGlow[drop * 4]).toBeGreaterThan(0);
                previous = sim.y[drop];
            }
        }
        // It reached the floor (well before its life ran out) and stopped being drawn there.
        expect(landedAt).not.toBeNull();
        expect(landedAt).toBeGreaterThan(0.5);
        expect(landedAt).toBeLessThan(6);
        expect(previous).toBeLessThan(1.5);
        expect(sim.outPlace[drop * 4 + 3]).toBe(0);
        expect(sim.outGlow[drop * 4]).toBe(0);
        expect(sim.counts().live).toBe(0);
    });

    it('is not a firefly: fields do not steer it, and it sheds no light on the moss', () => {
        const burst = {
            kind: 'burst', x: 0, y: 5, z: 0, radius: 8, power: 60, up: 20,
        };
        const sim = createSim();
        const still = createSim();
        const a = sim.spawn(1, 5, 0, 0, 0, 0, { kind: FOREST_FIREFLY_DEW, life: 9 });
        const b = still.spawn(1, 5, 0, 0, 0, 0, { kind: FOREST_FIREFLY_DEW, life: 9 });
        run(sim, 0.3, { fields: [burst] });
        run(still, 0.3);
        expect(sim.x[a]).toBe(still.x[b]);
        expect(sim.y[a]).toBe(still.y[b]);
        // A gust does carry it sideways.
        const windy = createSim();
        const c = windy.spawn(1, 5, 0, 0, 0, 0, { kind: FOREST_FIREFLY_DEW, life: 9 });
        run(windy, 0.3, { gust: 1, windX: 1, windZ: 0 });
        expect(windy.x[c]).toBeGreaterThan(still.x[b]);
        // Its trail is shorter than a firefly's.
        const spark = sim.spawn(1, 5, 0, 0, 0, 0, { life: 9 });
        sim.step(STEP);
        expect(sim.outGlow[a * 4 + 3]).toBeGreaterThan(0);
        expect(sim.outGlow[a * 4 + 3]).toBeLessThan(sim.outGlow[spark * 4 + 3]);
    });
});

describe('Forest fireflies: sparks with a place to be', () => {
    it('flies a bound spark to its place and holds it there, lit, for as long as it is bound', () => {
        const sim = createSim();
        const bound = sim.spawn(0, 1, 0, 0, 0, 0, { life: 1.2 });
        const free = sim.spawn(0, 1, 0, 0, 0, 0, { life: 1.2 });
        expect(sim.bind(bound, 3, 4, -2)).toBe(true);
        expect(sim.counts()).toMatchObject({ live: 2, bound: 1 });
        const far = Math.hypot(3, 3, 2);
        run(sim, 0.4);
        expect(Math.hypot(sim.x[bound] - 3, sim.y[bound] - 4, sim.z[bound] + 2)).toBeLessThan(far);
        run(sim, 4);
        // Long after a free spark of the same age has gone out, it is in place, trembling a little.
        expect(sim.life[free]).toBeLessThanOrEqual(0);
        expect(sim.life[bound]).toBeCloseTo(1.2, 5);
        for (let frame = 0; frame < 120; frame++) {
            sim.step(STEP);
            expect(Math.hypot(sim.x[bound] - 3, sim.y[bound] - 4, sim.z[bound] + 2)).toBeLessThan(0.25);
            // Fully alight the whole time: it does not burn down while it holds its place.
            expect(sim.outGlow[bound * 4]).toBeGreaterThan(0.5);
            expect(sim.outPlace[bound * 4 + 3]).toBeGreaterThan(0);
        }
        expect(sim.counts()).toMatchObject({ live: 1, bound: 1 });
        // A firmer grip arrives sooner.
        const race = createSim();
        const loose = race.spawn(0, 1, 0, 0, 0, 0, { life: 9 });
        const firm = race.spawn(0, 1, 0, 0, 0, 0, { life: 9 });
        race.bind(loose, 3, 4, -2, 0.4);
        race.bind(firm, 3, 4, -2, 1.2);
        run(race, 0.5);
        expect(Math.hypot(race.x[firm] - 3, race.y[firm] - 4, race.z[firm] + 2))
            .toBeLessThan(Math.hypot(race.x[loose] - 3, race.y[loose] - 4, race.z[loose] + 2));
    });

    it('only binds a spark that is alight', () => {
        const sim = createSim();
        const live = sim.spawn(0, 2, 0, 0, 0, 0);
        expect(sim.bind(0, 1, 1, 1)).toBe(false);
        expect(sim.bind(sim.ambient - 1, 1, 1, 1)).toBe(false);
        expect(sim.bind(sim.count, 1, 1, 1)).toBe(false);
        expect(sim.bind(-1, 1, 1, 1)).toBe(false);
        expect(sim.bind(NaN, 1, 1, 1)).toBe(false);
        expect(sim.bind(live + 1, 1, 1, 1)).toBe(false);
        expect(sim.counts().bound).toBe(0);
        expect(sim.bind(live, 1, 1, 1)).toBe(true);
        // A grip of nothing, or less, lets it go again.
        expect(sim.bind(live, 1, 1, 1, 0)).toBe(true);
        expect(sim.counts().bound).toBe(0);
        sim.bind(live, 1, 1, 1, -4);
        expect(sim.counts().bound).toBe(0);
    });

    it('never takes a bound spark for something else, however full the pool', () => {
        const sim = createSim({ count: 14, reserve: 12 });
        const held = [];
        for (let n = 0; n < 12; n++) {
            const index = sim.spawn(n, 3, 0, 0, 0, 0, { life: 1 });
            // Half of them belong to the stag; they are the ones with the least life left to lose.
            if (n % 2 === 0) {
                sim.bind(index, n, 5, 0);
                held.push(index);
            }
        }
        run(sim, 0.3);
        const places = held.map((index) => [sim.tx[index], sim.ty[index], sim.tz[index]]);
        const thrown = [];
        for (let n = 0; n < 40; n++) thrown.push(sim.spawn(0, 8, 0, 0, 0, 0, { life: 50 }));
        // Every new spark found a slot among the free ones.
        for (const index of thrown) {
            expect(index).toBeGreaterThanOrEqual(0);
            expect(held).not.toContain(index);
        }
        expect(sim.counts()).toMatchObject({ live: 12, bound: 6 });
        held.forEach((index, n) => {
            expect(sim.bound[index]).toBeGreaterThan(0);
            expect([sim.tx[index], sim.ty[index], sim.tz[index]]).toEqual(places[n]);
            expect(sim.y[index]).not.toBe(8);
        });
        // With every spark spoken for there is simply no room, and nothing is disturbed.
        const full = createSim({ count: 6, reserve: 4 });
        for (let n = 0; n < 4; n++) full.bind(full.spawn(n, 3, 0, 0, 0, 0), n, 4, 0);
        expect(full.spawn(0, 8, 0, 0, 0, 0)).toBe(-1);
        expect(full.counts()).toMatchObject({ live: 4, bound: 4 });
    });

    it('lets them all go at once, to drift off and go out within the time it is given', () => {
        const sim = createSim();
        const stag = [];
        for (let n = 0; n < 12; n++) {
            const index = sim.spawn(n * 0.2, 3, 0, 0, 0, 0, { life: 30 });
            sim.bind(index, n * 0.2, 4, 0);
            stag.push(index);
        }
        const bystander = sim.spawn(0, 6, 0, 0, 0, 0, { life: 30 });
        run(sim, 2);
        sim.release(2);
        expect(sim.counts()).toMatchObject({ live: 13, bound: 0 });
        // Not all in the same frame: each keeps a share of the time, none more than the whole of it and a half.
        const left = stag.map((index) => sim.life[index]);
        for (const life of left) {
            expect(life).toBeGreaterThan(0.5);
            expect(life).toBeLessThanOrEqual(3.0001);
        }
        expect(new Set(left.map((life) => life.toFixed(3))).size).toBeGreaterThan(6);
        // The spark that was never bound keeps the life it had.
        expect(sim.life[bystander]).toBeGreaterThan(27);
        const lit = stag.map((index) => sim.outGlow[index * 4]);
        run(sim, 1);
        stag.forEach((index, n) => {
            // Burning down now, and no longer pinned to its place.
            if (sim.life[index] > 0) expect(sim.outGlow[index * 4]).toBeLessThan(lit[n] * 1.3);
        });
        run(sim, 2.2);
        expect(sim.counts()).toMatchObject({ live: 1, bound: 0 });
        // Letting go of nothing is nothing.
        expect(() => sim.release()).not.toThrow();
        expect(sim.life[bystander]).toBeGreaterThan(20);
        // A release never lengthens a life that was already shorter.
        const brief = createSim();
        const spark = brief.spawn(0, 3, 0, 0, 0, 0, { life: 0.3 });
        brief.bind(spark, 0, 4, 0);
        brief.release(50);
        expect(brief.life[spark]).toBeCloseTo(0.3, 6);
    });
});

describe('Forest fireflies: reset and bad input', () => {
    it('returns to a calm opening state on reset', () => {
        const sim = createSim();
        const fresh = {
            place: Array.from(sim.outPlace), glow: Array.from(sim.outGlow), velocity: Array.from(sim.outVelocity),
        };
        for (let n = 0; n < 30; n++) {
            const kind = n % 3 ? FOREST_FIREFLY_SPARK : FOREST_FIREFLY_DEW;
            const index = sim.spawn(n * 0.1, 3, 0, 1, 1, 1, { kind });
            if (n % 4 === 0) sim.bind(index, 0, 5, 0);
        }
        run(sim, 1, { gust: 1, sync: 1, beatRate: 0.8 });
        expect(sim.counts().live).toBeGreaterThan(0);
        const homes = Array.from(sim.outHome);
        sim.reset();
        expect(sim.time).toBe(0);
        expect(sim.beat).toBe(0);
        expect(sim.sync).toBe(0);
        expect(sim.counts()).toEqual({
            ambient: 20, reserve: 40, live: 0, bound: 0,
        });
        expect(Array.from(sim.outPlace)).toEqual(fresh.place);
        expect(Array.from(sim.outGlow)).toEqual(fresh.glow);
        expect(Array.from(sim.outVelocity)).toEqual(fresh.velocity);
        // Where they live is not part of what a reset forgets.
        expect(Array.from(sim.outHome)).toEqual(homes);
        // And it plays again exactly as a new one would.
        const again = createSim();
        const first = sim.spawn(1, 2, 3, 0, 0, 0);
        expect(first).toBe(again.spawn(1, 2, 3, 0, 0, 0));
        run(sim, 0.5);
        run(again, 0.5);
        expect(sim.outPlace).toEqual(again.outPlace);
    });

    it.each([[NaN], [Infinity], [-Infinity], [-1], [undefined], [null], ['0.016']])(
        'does not advance on a step of %s',
        (dt) => {
            const sim = createSim();
            sim.spawn(0, 3, 0, 1, 0, 0, { life: 5 });
            run(sim, 0.1);
            const { time } = sim;
            const place = Array.from(sim.outPlace);
            sim.step(dt);
            expect(sim.time).toBe(time);
            expect(Array.from(sim.outPlace)).toEqual(place);
            expect(buffersFinite(sim)).toBe(true);
        },
    );

    it('takes a long hitch as one short step, never a leap', () => {
        const sim = createSim();
        const spark = sim.spawn(0, 3, 0, 4, 0, 0, { life: 5 });
        for (const dt of [0.5, 10, 1e9, Number.MAX_VALUE]) {
            const { time } = sim;
            const x = sim.x[spark];
            sim.step(dt);
            expect(sim.time - time).toBeGreaterThan(0);
            expect(sim.time - time).toBeLessThanOrEqual(0.1);
            expect(Math.abs(sim.x[spark] - x)).toBeLessThan(1);
        }
        expect(sim.life[spark]).toBeGreaterThan(4);
        expect(buffersFinite(sim)).toBe(true);
    });

    it('keeps its buffers finite whatever the environment says', () => {
        const sim = createSim();
        for (let n = 0; n < 20; n++) sim.spawn(n * 0.3 - 3, 3, 0, 1, 1, -1, { kind: n % 2 ? 1 : FOREST_FIREFLY_DEW });
        const junk = [NaN, Infinity, -Infinity, undefined, null, 'x', {}, []];
        for (const value of junk) {
            sim.step(STEP, {
                windX: value,
                windZ: value,
                gust: value,
                glow: value,
                heat: value,
                sync: value,
                beatRate: value,
                settled: value,
            });
            expect(buffersFinite(sim)).toBe(true);
        }
        expect(() => sim.step(STEP, { fields: null })).not.toThrow();
        expect(() => sim.step(STEP, undefined)).not.toThrow();
        expect(() => sim.step(STEP, { fields: [] })).not.toThrow();
        expect(buffersFinite(sim)).toBe(true);
        expect(sim.time).toBeCloseTo(STEP * (junk.length + 3), 6);
    });
});

describe('Forest light field', () => {
    const cell = (field, x, z) => {
        const column = Math.round((x - field.bounds.minX) * field.scaleX);
        const row = Math.round((z - field.bounds.minZ) * field.scaleZ);
        return row * field.size + column;
    };

    it('is a small square map of the glade, dark to begin with', () => {
        expect(Object.isFrozen(FOREST_LIGHT_FIELD_BOUNDS)).toBe(true);
        expect(FOREST_LIGHT_FIELD_BOUNDS.maxX).toBeGreaterThan(FOREST_LIGHT_FIELD_BOUNDS.minX);
        expect(FOREST_LIGHT_FIELD_BOUNDS.maxZ).toBeGreaterThan(FOREST_LIGHT_FIELD_BOUNDS.minZ);
        const field = new ForestLightField(64);
        expect(field.size).toBe(64);
        expect(field.bounds).toBe(FOREST_LIGHT_FIELD_BOUNDS);
        expect(field.data).toBeInstanceOf(Uint8Array);
        expect(field.data).toHaveLength(64 * 64);
        expect(field.sum).toHaveLength(64 * 64);
        expect(field.data.every((value) => value === 0)).toBe(true);
        // New, it has yet to be handed to the GPU.
        expect(field.dirty).toBe(true);
        for (const [size, expected] of [[0, 8], [-3, 8], [3.9, 8], [33.7, 33]]) {
            expect(new ForestLightField(size).size).toBe(expected);
        }
        expect(new ForestLightField().size).toBeGreaterThanOrEqual(8);
    });

    it('lays a soft pool of light under a firefly, brightest right beneath it', () => {
        const field = new ForestLightField(64);
        const [x, z] = [3.5, -20];
        field.add(x, z, 0.5, 1);
        const data = field.commit();
        expect(data).toBe(field.data);
        const centre = cell(field, x, z);
        const brightest = data.indexOf(Math.max(...data));
        expect(brightest).toBe(centre);
        expect(data[centre]).toBeGreaterThan(20);
        // It falls off evenly on every side and is gone a few cells out.
        for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [2, 0]]) {
            const ring = [centre + dc + dr * 64, centre - dc - dr * 64, centre + dc - dr * 64, centre - dc + dr * 64]
                .map((index) => data[index]);
            expect(new Set(ring).size).toBe(1);
            expect(ring[0]).toBeLessThan(data[centre]);
        }
        expect(data[centre + 1]).toBeGreaterThan(data[centre + 2]);
        expect(data[centre + 4]).toBe(0);
        expect(data[centre + 4 * 64]).toBe(0);
        const lit = data.reduce((count, value) => count + (value > 0 ? 1 : 0), 0);
        expect(lit).toBeGreaterThan(4);
        expect(lit).toBeLessThan(40);
    });

    it('sheds less from higher up, nothing from above the canopy, and nothing from a dark firefly', () => {
        const peak = (height, light) => {
            const field = new ForestLightField(48);
            field.add(0, -30, height, light);
            return Math.max(...field.commit());
        };
        const heights = [0, 0.5, 1.5, 3, 5].map((height) => peak(height, 1));
        for (let index = 1; index < heights.length; index++) expect(heights[index]).toBeLessThan(heights[index - 1]);
        expect(heights.at(-1)).toBeGreaterThan(0);
        expect(peak(6, 1)).toBe(0);
        expect(peak(40, 1)).toBe(0);
        // Under the floor counts as on it.
        expect(peak(-3, 1)).toBe(heights[0]);
        // Brighter fireflies shed more; a dark one sheds nothing.
        expect(peak(0.5, 0.5)).toBeLessThan(peak(0.5, 1));
        expect(peak(0.5, 0)).toBe(0);
        expect(peak(0.5, -1)).toBe(0);
        expect(peak(0.5, 0.004)).toBe(0);
    });

    it('adds lights together and packs a swarm softly, so it can never clip or wrap', () => {
        const field = new ForestLightField(48);
        let previous = 0;
        const centre = cell(field, 0, -30);
        for (let fireflies = 1; fireflies <= 400; fireflies++) {
            field.add(0, -30, 0.3, 1);
            if (fireflies % 20 === 0 || fireflies < 6) {
                const value = field.commit()[centre];
                expect(value).toBeGreaterThanOrEqual(previous);
                expect(value).toBeLessThanOrEqual(255);
                previous = value;
            }
        }
        expect(previous).toBe(255);
        expect(field.sum.every(Number.isFinite)).toBe(true);
        // Two lights apart from each other make two pools.
        const pair = new ForestLightField(48);
        pair.add(-12, -30, 0.3, 1);
        pair.add(12, -30, 0.3, 1);
        const data = pair.commit();
        expect(data[cell(pair, -12, -30)]).toBe(data[cell(pair, 12, -30)]);
        expect(data[cell(pair, -12, -30)]).toBeGreaterThan(0);
        expect(data[cell(pair, 0, -30)]).toBe(0);
    });

    it('never writes to its own edge, and ignores what lies outside the glade', () => {
        const field = new ForestLightField(32);
        const {
            minX, maxX, minZ, maxZ,
        } = field.bounds;
        const random = seededRandom(9);
        for (let n = 0; n < 4000; n++) {
            // Mostly along and just beyond the borders.
            const x = minX - 6 + (maxX - minX + 12) * random();
            const border = (random() < 0.5 ? minZ : maxZ) + (random() - 0.5) * 8;
            const z = n % 2 ? border : minZ - 6 + (maxZ - minZ + 12) * random();
            field.add(x, z, random() * 2, 1);
        }
        for (const [x, z] of [[1e9, 0], [0, -1e9], [-1e9, 1e9], [minX, minZ], [maxX, maxZ]]) field.add(x, z, 0, 1);
        const data = field.commit();
        let total = 0;
        for (let index = 0; index < 32; index++) {
            for (const edge of [index, 31 * 32 + index, index * 32, index * 32 + 31]) expect(data[edge]).toBe(0);
        }
        for (const value of data) total += value;
        expect(total).toBeGreaterThan(0);
    });

    it.each([
        [[NaN, 0, 0, 1]], [[0, NaN, 0, 1]], [[0, 0, NaN, 1]], [[0, 0, 0, NaN]], [[Infinity, 0, 0, 1]],
        [[0, -Infinity, 0, 1]], [[0, 0, Infinity, 1]], [[0, 0, 0, Infinity]],
        [[undefined, undefined, undefined, undefined]],
    ])('keeps a bad light out of the map: add(%j)', (args) => {
        const field = new ForestLightField(24);
        field.add(0, -30, 0.5, 0.5);
        const before = Array.from(field.sum);
        expect(() => field.add(...args)).not.toThrow();
        // Either it was ignored, or (an infinitely bright firefly) it is still a number the map can pack.
        if (args[3] !== Infinity) expect(Array.from(field.sum)).toEqual(before);
        const data = field.commit();
        expect(data.every((value) => value >= 0 && value <= 255)).toBe(true);
        expect(Object.keys(field.sum)).toHaveLength(24 * 24);
    });

    it('clears, and says when the GPU copy is stale', () => {
        const field = new ForestLightField(24);
        field.dirty = false;
        field.add(0, -30, 0.5, 1);
        field.commit();
        expect(field.dirty).toBe(true);
        expect(Math.max(...field.data)).toBeGreaterThan(0);
        field.dirty = false;
        field.clear();
        expect(field.dirty).toBe(true);
        expect(field.sum.every((value) => value === 0)).toBe(true);
        // The bytes follow at the next commit.
        expect(Math.max(...field.commit())).toBe(0);
    });

    it('gathers a whole simulation’s lit fireflies in one call', () => {
        const ground = (x) => 0.1 * x;
        const place = new Float32Array([
            2, ground(2) + 0.5, -20, 0.1, // lit, low
            -8, ground(-8) + 0.5, -40, 0.1, // lit, low
            9, ground(9) + 0.5, -10, 0.1, // too dim to count
            14, ground(14) + 30, -30, 0.1, // lit, far overhead
        ]);
        const glow = new Float32Array([1, 0, 0, 1, 0.6, 0, 0, 1, 0.01, 0, 0, 1, 1, 0, 0, 1]);
        const field = new ForestLightField(48);
        field.add(20, -50, 0, 1);
        field.dirty = false;
        const data = field.gather(place, glow, 4, ground);
        expect(data).toBe(field.data);
        expect(field.dirty).toBe(true);
        // What was there before is gone: gathering starts from darkness.
        expect(data[cell(field, 20, -50)]).toBe(0);
        const expected = new ForestLightField(48);
        expected.add(2, -20, 0.5, 1);
        expected.add(-8, -40, 0.5, 0.6);
        expect(Array.from(data)).toEqual(Array.from(expected.commit()));
        expect(data[cell(field, 2, -20)]).toBeGreaterThan(data[cell(field, -8, -40)]);
        // Only the first `count` are read.
        expect(Math.max(...field.gather(place, glow, 0, ground))).toBe(0);
    });

    it('is filled by the simulation: lit sparks near the floor, never dew, never the high ones', () => {
        const sim = createSim({ count: 30, reserve: 29, groundHeight: () => 0 });
        const field = new ForestLightField(48);
        const low = sim.spawn(5, 0.6, -30, 0, 0, 0, { life: 9 });
        const high = sim.spawn(-20, 12, -30, 0, 0, 0, { life: 9 });
        const dew = sim.spawn(20, 0.6, -50, 0, 0, 0, { life: 9, kind: FOREST_FIREFLY_DEW });
        run(sim, 0.2);
        field.dirty = false;
        field.add(0, -10, 0, 1);
        sim.shed(field);
        expect(field.dirty).toBe(true);
        const { data } = field;
        expect(data[cell(field, sim.x[low], sim.z[low])]).toBeGreaterThan(0);
        expect(data[cell(field, sim.x[high], sim.z[high])]).toBe(0);
        expect(data[cell(field, sim.x[dew], sim.z[dew])]).toBe(0);
        // Shedding starts from darkness too.
        expect(data[cell(field, 0, -10)]).toBe(0);
        // The fireflies that live here light the moss under them when they flash.
        const swarm = createSim({ count: 400, reserve: 1, groundHeight: () => 0 });
        const moss = new ForestLightField(96);
        let brightest = 0;
        for (let frame = 0; frame < 240; frame++) {
            swarm.step(STEP);
            swarm.shed(moss);
            brightest = Math.max(brightest, Math.max(...moss.data));
        }
        expect(brightest).toBeGreaterThan(0);
        expect(() => sim.shed(null)).not.toThrow();
        expect(() => sim.shed(undefined)).not.toThrow();
    });
});

describe('Forest pulses: the waves of light', () => {
    const wave = {
        strength: 1, speed: 10, width: 2, reach: 3, heat: 0.25, life: 2,
    };

    it('keeps a fixed pool of rings the shaders can hold on to', () => {
        const pulses = new ForestPulses(4);
        expect(pulses.count).toBe(4);
        expect(pulses.place).toHaveLength(4);
        expect(pulses.shape).toHaveLength(4);
        expect(pulses.active()).toBe(0);
        const vectors = [...pulses.place, ...pulses.shape];
        for (const vector of vectors) expect(vector.isVector4).toBe(true);
        for (const shape of pulses.shape) {
            expect(shape.x).toBe(0);
            // Widths and reaches are divided by in the shaders: never zero, even at rest.
            expect(shape.y).toBeGreaterThan(0);
            expect(shape.z).toBeGreaterThan(0);
        }
        for (let n = 0; n < 9; n++) pulses.add(n, 0, -n, wave);
        pulses.update(0.5);
        pulses.reset();
        // The very same vectors, before and after: uniforms are bound to them once.
        expect([...pulses.place, ...pulses.shape]).toEqual(vectors);
        [...pulses.place, ...pulses.shape].forEach((vector, index) => expect(vector).toBe(vectors[index]));
        for (const [count, expected] of [[0, 1], [-4, 1], [2.9, 2], [undefined, 5]]) {
            expect(new ForestPulses(count).count).toBe(expected);
        }
    });

    it('starts a ring where it is asked, at no radius, and carries it outward as it fades', () => {
        const pulses = new ForestPulses(3);
        const slot = pulses.add(4, 1.5, -9, wave);
        expect(slot).toBeGreaterThanOrEqual(0);
        expect(pulses.active()).toBe(1);
        expect(pulses.place[slot].toArray()).toEqual([4, 1.5, -9, 0]);
        expect(pulses.shape[slot].y).toBe(2);
        expect(pulses.shape[slot].z).toBe(3);
        expect(pulses.shape[slot].w).toBe(0.25);
        let radius = 0;
        let strongest = 0;
        let strongestAt = 0;
        let frames = 0;
        const strengths = [];
        while (pulses.active() > 0 && frames < 1000) {
            pulses.update(STEP);
            frames += 1;
            if (pulses.active() === 0) break;
            // The centre stays put; the ring only ever widens.
            expect(pulses.place[slot].toArray().slice(0, 3)).toEqual([4, 1.5, -9]);
            expect(pulses.place[slot].w).toBeGreaterThan(radius);
            radius = pulses.place[slot].w;
            const strength = pulses.shape[slot].x;
            expect(strength).toBeGreaterThanOrEqual(0);
            expect(strength).toBeLessThanOrEqual(1);
            strengths.push(strength);
            if (strength > strongest) {
                strongest = strength;
                strongestAt = frames * STEP;
            }
        }
        // It lasted the life it was given, and travelled metres in that time.
        expect(frames * STEP).toBeCloseTo(2, 1);
        expect(radius).toBeGreaterThan(5);
        expect(radius).toBeLessThanOrEqual(10 * 2);
        // It comes up within a few frames, then only fades.
        expect(strongest).toBeGreaterThan(0.5);
        expect(strongestAt).toBeLessThan(0.3);
        const after = strengths.slice(Math.round(strongestAt / STEP));
        for (let index = 1; index < after.length; index++) expect(after[index]).toBeLessThanOrEqual(after[index - 1]);
        expect(strengths.at(-1)).toBeLessThan(0.05);
        // Spent, it is dark and has no radius.
        expect(pulses.shape[slot].x).toBe(0);
        expect(pulses.place[slot].w).toBe(0);
        expect(pulses.shape[slot].y).toBeGreaterThan(0);
    });

    it('runs a faster wave further and keeps a longer one alive longer', () => {
        const after = (options, seconds) => {
            const pulses = new ForestPulses(2);
            const slot = pulses.add(0, 0, 0, { ...wave, ...options });
            for (let frame = 0; frame < Math.round(seconds / STEP); frame++) pulses.update(STEP);
            return { radius: pulses.place[slot].w, strength: pulses.shape[slot].x, active: pulses.active() };
        };
        expect(after({ speed: 20 }, 1).radius).toBeGreaterThan(after({ speed: 10 }, 1).radius);
        expect(after({ strength: 2 }, 1).strength).toBeGreaterThan(after({ strength: 1 }, 1).strength);
        expect(after({ life: 1 }, 1.5).active).toBe(0);
        expect(after({ life: 4 }, 1.5).active).toBe(1);
        // The clock decides, not the frame rate.
        const smooth = new ForestPulses(1);
        const choppy = new ForestPulses(1);
        smooth.add(0, 0, 0, wave);
        choppy.add(0, 0, 0, wave);
        for (let frame = 0; frame < 120; frame++) smooth.update(1 / 120);
        for (let frame = 0; frame < 10; frame++) choppy.update(1 / 10);
        expect(choppy.place[0].w).toBeCloseTo(smooth.place[0].w, 6);
        expect(choppy.shape[0].x).toBeCloseTo(smooth.shape[0].x, 6);
    });

    it('takes a free slot first, and when all are running the wave nearest its end', () => {
        const pulses = new ForestPulses(3);
        const first = pulses.add(1, 0, 0, { ...wave, life: 10 });
        const second = pulses.add(2, 0, 0, { ...wave, life: 1 });
        const third = pulses.add(3, 0, 0, { ...wave, life: 10 });
        expect(new Set([first, second, third]).size).toBe(3);
        pulses.update(0.6);
        // Full: the short one is furthest through its life, though not the oldest.
        const fourth = pulses.add(4, 0, 0, wave);
        expect(fourth).toBe(second);
        expect(pulses.place[fourth].toArray()).toEqual([4, 0, 0, 0]);
        expect(pulses.place[first].x).toBe(1);
        expect(pulses.place[third].x).toBe(3);
        expect(pulses.active()).toBe(3);
        // One ends: its slot is the next to be used, and the others run on undisturbed.
        const short = pulses.add(5, 0, 0, { ...wave, life: 0.3 });
        pulses.update(0.4);
        expect(pulses.active()).toBe(2);
        const radius = pulses.place.map((place) => place.w);
        const reused = pulses.add(6, 0, 0, wave);
        expect(reused).toBe(short);
        pulses.place.forEach((place, index) => { if (index !== reused) expect(place.w).toBe(radius[index]); });
    });

    it.each([
        [[NaN, 0, 0, wave]], [[0, Infinity, 0, wave]], [[0, 0, undefined, wave]], [[0, 0, 0, { ...wave, strength: 0 }]],
        [[0, 0, 0, { ...wave, strength: -2 }]], [[0, 0, 0, { ...wave, strength: NaN }]], [['1', 0, 0, wave]],
    ])('refuses a wave from nowhere or of no strength: add(%j)', (args) => {
        const pulses = new ForestPulses(2);
        pulses.add(1, 2, 3, wave);
        const before = JSON.stringify([pulses.place, pulses.shape, pulses.state]);
        expect(pulses.add(...args)).toBe(-1);
        expect(JSON.stringify([pulses.place, pulses.shape, pulses.state])).toBe(before);
        expect(pulses.active()).toBe(1);
    });

    it('bounds every number a wave is described by', () => {
        const pulses = new ForestPulses(2);
        const wild = pulses.add(0, 0, 0, {
            strength: 1e9, speed: 1e9, width: 1e9, reach: 1e9, heat: 1e9, life: 1e9,
        });
        const odd = pulses.add(0, 0, 0, {
            strength: 1, speed: NaN, width: -5, reach: Infinity, heat: NaN, life: -1,
        });
        // A wave is dark until time first moves it: no frame ever shows it at full strength on a point.
        for (const slot of [wild, odd]) expect(pulses.shape[slot].x).toBe(0);
        pulses.update(0.05);
        for (const slot of [wild, odd]) {
            const shape = pulses.shape[slot];
            expect(shape.toArray().every(Number.isFinite)).toBe(true);
            expect(shape.x).toBeGreaterThan(0);
            expect(shape.x).toBeLessThan(10);
            expect(shape.y).toBeGreaterThan(0);
            expect(shape.y).toBeLessThan(100);
            expect(shape.z).toBeGreaterThan(0);
            expect(shape.z).toBeLessThan(100);
            expect(shape.w).toBeGreaterThanOrEqual(0);
            expect(shape.w).toBeLessThanOrEqual(1);
        }
        // Defaults stand in for what is missing.
        const plain = new ForestPulses(1);
        expect(plain.add(0, 0, 0)).toBe(0);
        expect(plain.shape[0].toArray().every(Number.isFinite)).toBe(true);
        for (let frame = 0; frame < 3000; frame++) pulses.update(STEP);
        // Even the wildest wave ends, and nothing in the pool is ever not a number.
        expect(pulses.active()).toBe(0);
        for (const vector of [...pulses.place, ...pulses.shape]) {
            expect(vector.toArray().every(Number.isFinite)).toBe(true);
        }
    });

    it('stands still for a step that is not a positive time, and forgets everything on reset', () => {
        const pulses = new ForestPulses(2);
        pulses.add(1, 2, 3, wave);
        pulses.update(0.2);
        const before = JSON.stringify([pulses.place, pulses.shape, pulses.state]);
        for (const dt of [0, -1, NaN, undefined, null]) pulses.update(dt);
        expect(JSON.stringify([pulses.place, pulses.shape, pulses.state])).toBe(before);
        // A stall longer than a wave's life simply ends it.
        pulses.update(Infinity);
        expect(pulses.active()).toBe(0);
        for (const vector of [...pulses.place, ...pulses.shape]) {
            expect(vector.toArray().every(Number.isFinite)).toBe(true);
        }
        pulses.add(1, 2, 3, wave);
        pulses.add(4, 5, 6, wave);
        pulses.reset();
        expect(pulses.active()).toBe(0);
        expect(JSON.stringify([pulses.place, pulses.shape, pulses.state]))
            .toBe(JSON.stringify([new ForestPulses(2).place, new ForestPulses(2).shape, new ForestPulses(2).state]));
        expect(pulses.add(7, 8, 9, wave)).toBe(0);
    });
});

describe('Forest stag: the figure the fireflies gather into', () => {
    const {
        minX, maxX, minY, maxY,
    } = FOREST_STAG_BOUNDS;

    it('is a standing animal a few metres long and tall, hooves on the ground', () => {
        expect(Object.isFrozen(FOREST_STAG_BOUNDS)).toBe(true);
        expect(minY).toBe(0);
        expect(maxX - minX).toBeGreaterThan(2);
        expect(maxX - minX).toBeLessThan(6);
        expect(maxY).toBeGreaterThan(2.5);
        expect(maxY).toBeLessThan(7);
    });

    it('measures distance to its body: negative inside, positive outside, further is larger', () => {
        // Somewhere in the figure there is a barrel a hand's breadth or more thick.
        let deepest = { distance: Infinity };
        for (let x = minX; x <= maxX; x += 0.05) {
            for (let y = minY; y <= maxY; y += 0.05) {
                const distance = forestStagDistance(x, y);
                expect(Number.isFinite(distance)).toBe(true);
                if (distance < deepest.distance) deepest = { x, y, distance };
            }
        }
        expect(deepest.distance).toBeLessThan(-0.2);
        expect(deepest.distance).toBeGreaterThan(-1);
        // The body is carried on legs: its thickest part is well above the ground, and under it,
        // between the legs, is open air.
        expect(deepest.y).toBeGreaterThan(0.8);
        expect(forestStagDistance(deepest.x, 0.3)).toBeGreaterThan(0);
        // Outside on every side, and further out is a larger distance.
        const outside = [[minX - 1, 1], [maxX + 1, 1], [0, maxY + 1], [0, -1], [minX - 5, -5]];
        for (const [x, y] of outside) {
            expect(forestStagDistance(x, y)).toBeGreaterThan(0.3);
            expect(forestStagDistance(x * 3, y * 3 - 9)).toBeGreaterThan(forestStagDistance(x, y));
        }
        // Walking in from far away the distance falls steadily until the hide is reached.
        let previous = Infinity;
        for (let x = deepest.x - 6; x <= deepest.x; x += 0.1) {
            const distance = forestStagDistance(x, deepest.y);
            if (previous > 0.05) expect(distance).toBeLessThan(previous + 1e-9);
            previous = distance;
        }
        // The antlers are drawn as lines, not measured as body: the air above the head is outside.
        expect(forestStagDistance(deepest.x, maxY - 0.3)).toBeGreaterThan(0);
        for (const [x, y] of [[NaN, 1], [1, NaN], [Infinity, 1]]) {
            expect(forestStagDistance(x, y) < 0).toBe(false);
        }
    });

    it.each([[60], [240], [560], [1500]])('places %i lights inside its bounds, every one a finite point', (count) => {
        const points = createForestStagPoints(count, seededRandom(4));
        expect(points).toBeInstanceOf(Float32Array);
        expect(points).toHaveLength(count * 4);
        expect(allFinite(points)).toBe(true);
        for (let index = 0; index < count; index++) {
            const [x, y, z, weight] = points.subarray(index * 4, index * 4 + 4);
            expect(x).toBeGreaterThanOrEqual(minX);
            expect(x).toBeLessThanOrEqual(maxX);
            expect(y).toBeGreaterThanOrEqual(minY);
            expect(y).toBeLessThanOrEqual(maxY);
            // A little depth, so it is not a flat card; far less than its length.
            expect(Math.abs(z)).toBeLessThan(0.5);
            expect(weight).toBeGreaterThan(0);
            expect(weight).toBeLessThanOrEqual(1);
        }
    });

    it('draws the outline and the antlers brighter than the body they enclose', () => {
        const count = 800;
        const points = createForestStagPoints(count, seededRandom(4));
        const lights = Array.from({ length: count }, (_, index) => ({
            x: points[index * 4], y: points[index * 4 + 1], z: points[index * 4 + 2], weight: points[index * 4 + 3],
        }));
        const bright = lights.filter((light) => light.weight === 1);
        const dim = lights.filter((light) => light.weight < 1);
        expect(dim.length).toBeGreaterThan(count * 0.05);
        // Every dimmer light is well inside the hide; none of them is out on an antler.
        const inset = dim.map((light) => forestStagDistance(light.x, light.y));
        for (const distance of inset) expect(distance).toBeLessThan(-0.02);
        // The full-weight lights are the antlers (in the air above the head) and the body's edge.
        const antlers = bright.filter((light) => forestStagDistance(light.x, light.y) > 0.02);
        const outline = bright.filter((light) => forestStagDistance(light.x, light.y) <= 0.02);
        expect(antlers.length).toBeGreaterThan(count * 0.1);
        expect(antlers.length).toBeLessThan(count * 0.45);
        for (const light of antlers) expect(light.y).toBeGreaterThan(1.8);
        const shallowest = Math.max(...inset);
        for (const light of outline) {
            // Nearer the edge than any dim light is.
            expect(forestStagDistance(light.x, light.y)).toBeGreaterThan(shallowest - 1e-6);
        }
        // The outline carries the drawing: it is a thin band, yet holds more lights than the whole
        // interior, so a few hundred of them read as an animal.
        expect(outline.length).toBeGreaterThan(dim.length);
        // Two antlers, one set a little behind the other.
        expect(antlers.filter((light) => light.z > 0).length).toBeGreaterThan(antlers.length * 0.3);
        expect(antlers.filter((light) => light.z < 0).length).toBeGreaterThan(antlers.length * 0.3);
        // And the whole animal is there: hooves, belly, head and crown.
        const body = lights.filter((light) => forestStagDistance(light.x, light.y) <= 0.02);
        expect(body.some((light) => light.y < 0.3)).toBe(true);
        expect(body.some((light) => light.x < minX + 0.6)).toBe(true);
        expect(body.some((light) => light.x > maxX - 0.6)).toBe(true);
        expect(Math.max(...antlers.map((light) => light.y)))
            .toBeGreaterThan(Math.max(...body.map((light) => light.y)) + 0.5);
    });

    it('is the same animal from the same seed, and a different scatter from another', () => {
        const first = createForestStagPoints(300, seededRandom(4));
        expect(createForestStagPoints(300, seededRandom(4))).toEqual(first);
        expect(createForestStagPoints(300, seededRandom(5))).not.toEqual(first);
        // Without a generator it still makes a stag.
        const casual = createForestStagPoints(120);
        expect(casual).toHaveLength(480);
        expect(allFinite(casual)).toBe(true);
    });

    it('always returns a usable figure, however little it is asked for', () => {
        for (const count of [0, 1, 7.9, -20]) {
            const points = createForestStagPoints(count, seededRandom(4));
            expect(points.length).toBeGreaterThanOrEqual(8 * 4);
            expect(points.length % 4).toBe(0);
            expect(allFinite(points)).toBe(true);
        }
        expect(createForestStagPoints(99.9, seededRandom(4))).toHaveLength(99 * 4);
        // A generator stuck on one value cannot fill the body: what it has is repeated, never left blank.
        const stuck = createForestStagPoints(200, () => 0.5);
        expect(allFinite(stuck)).toBe(true);
        for (let index = 0; index < 200; index++) {
            expect(stuck[index * 4 + 3]).toBeGreaterThan(0);
            expect(stuck[index * 4 + 1]).toBeGreaterThan(0);
        }
    });
});

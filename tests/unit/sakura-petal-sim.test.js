import { describe, expect, it } from 'vitest';
import { Euler, Quaternion, Vector3 } from 'three/webgpu';
import {
    PETAL_AIR, PETAL_FADE, PETAL_FLOAT, PETAL_IDLE, PETAL_REST, SakuraPetalSim,
} from '../../src/themes/sakura-twilight/sakura-petal-sim.js';

const STEP = 1 / 60;
const STATE_NAMES = ['idle', 'air', 'rest', 'afloat', 'fade'];
const DOWN = [PETAL_REST, PETAL_FLOAT];

function seededRandom(seed = 187) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function createSim({ seed = 187, ...options }) {
    return new SakuraPetalSim({ rng: seededRandom(seed), ...options });
}

/**
 * Every petal is an event petal lying on a flat surface at height 0, scattered over a square of
 * half-width `spread`: on grass, or (with `afloat`) on a lake that covers everything.
 */
function carpet(count, spread, { seed = 4, afloat = false } = {}) {
    const sim = createSim({
        count, reserve: count, seed, waterLevel: afloat ? 0 : -Infinity,
    });
    const scatter = seededRandom(seed + 100);
    for (let index = 0; index < count; index += 1) {
        sim.spawn((scatter() * 2 - 1) * spread, 0.03, (scatter() * 2 - 1) * spread, 0, -1, 0);
    }
    sim.step(STEP);
    expect(sim.counts()).toEqual({
        idle: 0, air: 0, rest: afloat ? 0 : count, afloat: afloat ? count : 0, fade: 0,
    });
    return sim;
}

function run(sim, seconds, env, dt = STEP) {
    const steps = Math.round(seconds / dt);
    for (let step = 0; step < steps; step += 1) sim.step(dt, typeof env === 'function' ? env(step * dt) : env);
}

function petal(sim, index) {
    const o = index * 3;
    return {
        index,
        state: sim.state[index],
        x: sim.position[o],
        y: sim.position[o + 1],
        z: sim.position[o + 2],
        vx: sim.velocity[o],
        vy: sim.velocity[o + 1],
        vz: sim.velocity[o + 2],
        drawn: sim.outPosition[index * 4 + 3],
        glow: sim.glow[index],
    };
}

function petals(sim, predicate = () => true) {
    const result = [];
    for (let index = 0; index < sim.count; index += 1) {
        const entry = petal(sim, index);
        if (predicate(entry)) result.push(entry);
    }
    return result;
}

const airborne = (sim) => petals(sim, (entry) => entry.state === PETAL_AIR);
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

function allFinite(array) {
    for (let index = 0; index < array.length; index += 1) {
        if (!Number.isFinite(array[index])) return false;
    }
    return true;
}

/** The direction a petal's face points in the world, from its render quaternion. */
function faceNormal(sim, index) {
    const p = index * 4;
    const turn = new Quaternion().fromArray(sim.outRotation, p);
    return new Vector3(0, 0, 1).applyQuaternion(turn);
}

function expectHealthy(sim) {
    for (const key of ['position', 'velocity', 'angles', 'spin', 'phase', 'rate', 'size', 'scale', 'timer',
        'heading', 'glow', 'outPosition', 'outRotation', 'outLook']) {
        expect(allFinite(sim[key]), key).toBe(true);
    }
    const counts = sim.counts();
    expect(Object.keys(counts)).toEqual(STATE_NAMES);
    expect(counts.idle + counts.air + counts.rest + counts.afloat + counts.fade).toBe(sim.count);
    let worstQuaternion = 0;
    let lowestLook = Infinity;
    let highestLook = -Infinity;
    for (let index = 0; index < sim.count; index += 1) {
        const p = index * 4;
        const length = Math.hypot(
            sim.outRotation[p],
            sim.outRotation[p + 1],
            sim.outRotation[p + 2],
            sim.outRotation[p + 3],
        );
        worstQuaternion = Math.max(worstQuaternion, Math.abs(length - 1));
        // Tone and carried light are both fractions.
        lowestLook = Math.min(lowestLook, sim.outLook[index * 2], sim.outLook[index * 2 + 1]);
        highestLook = Math.max(highestLook, sim.outLook[index * 2], sim.outLook[index * 2 + 1]);
    }
    expect(worstQuaternion).toBeLessThan(1e-5);
    expect(lowestLook).toBeGreaterThanOrEqual(0);
    expect(highestLook).toBeLessThanOrEqual(1);
}

function snapshot(sim) {
    return {
        time: sim.time,
        state: Array.from(sim.state),
        position: Array.from(sim.position),
        velocity: Array.from(sim.velocity),
        outPosition: Array.from(sim.outPosition),
        outRotation: Array.from(sim.outRotation),
        outLook: Array.from(sim.outLook),
    };
}

/** A column of turning air at the origin, of the kind the director lays round the board. */
const WHIRL = Object.freeze({
    kind: 'vortex', x: 0, z: 0, radius: 2.7, reach: 4.4, top: 6, spin: 8, turn: 1, grip: 2.4, pull: 2.6, lift: 2,
});

/** A bank on the +x side (1.5 m up) and a lake at level 0 on the -x side. */
const shore = { surface: (x) => (x < 0 ? 0 : 1.5), waterLevel: 0 };

describe('Sakura petal simulation', () => {
    describe('construction', () => {
        it('clamps the petal count and the reserve into a usable pool', () => {
            const cases = [
                [{ count: 0 }, 1, 0],
                [{ count: -4, reserve: 3 }, 1, 1],
                [{ count: 10.9, reserve: 2.7 }, 10, 2],
                [{ count: 10, reserve: 99 }, 10, 10],
                [{ count: 10, reserve: -3 }, 10, 0],
                [{ count: 10 }, 10, 0],
            ];
            for (const [options, count, reserve] of cases) {
                const sim = createSim(options);
                expect(sim.count).toBe(count);
                expect(sim.reserve).toBe(reserve);
                expect(sim.ambient).toBe(count - reserve);
                expect(sim.position).toHaveLength(count * 3);
                expect(sim.velocity).toHaveLength(count * 3);
                expect(sim.state).toHaveLength(count);
                expect(sim.outPosition).toHaveLength(count * 4);
                expect(sim.outRotation).toHaveLength(count * 4);
                expect(sim.outLook).toHaveLength(count * 2);
                expect(sim.counts().idle).toBe(reserve);
                expectHealthy(sim);
            }
        });

        // A non-finite count or reserve must not leak NaN into the buffer sizes: the count falls back
        // to one petal and the reserve to none.
        it('clamps a non-finite petal count or reserve as it clamps other out-of-range values', () => {
            for (const count of [NaN, undefined, 'many', Infinity]) {
                const sim = createSim({ count });
                expect(Number.isInteger(sim.count)).toBe(true);
                expect(sim.count).toBeGreaterThanOrEqual(1);
                expect(sim.outPosition).toHaveLength(sim.count * 4);
            }
            const sim = createSim({ count: 5, reserve: NaN });
            expect(sim.reserve).toBe(0);
            expect(sim.ambient).toBe(5);
        });

        it('opens mid-cycle: ambient petals lie, float or fall, reserve petals wait hidden', () => {
            // The near bank is dry; everything beyond z = -5 is lake.
            const surface = (x, z) => (z < -5 ? 0 : 0.8);
            const sim = createSim({
                count: 600, reserve: 200, surface, waterLevel: 0,
            });
            expect(sim.time).toBe(0);
            const ambient = petals(sim, (entry) => entry.index < sim.ambient);
            const reserve = petals(sim, (entry) => entry.index >= sim.ambient);
            expect(ambient).toHaveLength(400);
            expect(reserve).toHaveLength(200);
            const resting = ambient.filter((entry) => entry.state === PETAL_REST);
            const floating = ambient.filter((entry) => entry.state === PETAL_FLOAT);
            const falling = ambient.filter((entry) => entry.state === PETAL_AIR);
            expect(resting.length + floating.length + falling.length).toBe(ambient.length);
            for (const group of [resting, floating, falling]) expect(group.length).toBeGreaterThan(10);
            for (const entry of ambient) expect(entry.drawn).toBeGreaterThan(0);
            for (const entry of resting) {
                expect(entry.z).toBeGreaterThanOrEqual(-5);
                expect(entry.y).toBeGreaterThan(0.8);
                expect(entry.y).toBeLessThan(0.9);
                expect([entry.vx, entry.vy, entry.vz]).toEqual([0, 0, 0]);
            }
            for (const entry of floating) {
                expect(entry.z).toBeLessThan(-5);
                expect(entry.y).toBeGreaterThan(0);
                expect(entry.y).toBeLessThan(0.05);
                expect([entry.vx, entry.vy, entry.vz]).toEqual([0, 0, 0]);
            }
            for (const entry of falling) {
                expect(entry.y).toBeGreaterThanOrEqual(surface(entry.x, entry.z));
                expect(entry.vy).toBeLessThan(0);
            }
            for (const entry of reserve) {
                expect(entry.state).toBe(PETAL_IDLE);
                expect(entry.drawn).toBe(0);
                expect(entry.glow).toBe(0);
            }
            expect(sim.counts()).toEqual({
                idle: 200, air: falling.length, rest: resting.length, afloat: floating.length, fade: 0,
            });
            expectHealthy(sim);
        });

        it('lets ambient petals go from the crown points it is given, in the colour of that tree', () => {
            // [x, y, z, tone]: a near-white tree, a mid one and a deep rose one.
            const crowns = [[-16, 11, -4, 0], [15, 9, -22, 0.5], [0, 13, 9, 1]];
            const sim = createSim({ count: 400, reserve: 0, crownPoints: new Float32Array(crowns.flat()) });
            const falling = airborne(sim);
            expect(falling.length).toBeGreaterThan(40);
            const used = new Set();
            for (const entry of falling) {
                const crown = crowns.findIndex(([x, , z]) => (
                    Math.abs(entry.x - x) <= 0.71 && Math.abs(entry.z - z) <= 0.71));
                expect(crown).toBeGreaterThanOrEqual(0);
                // Pre-aged falls start somewhere between the bough and the ground.
                expect(entry.y).toBeLessThanOrEqual(crowns[crown][1]);
                expect(entry.y).toBeGreaterThan(0);
                const tone = sim.outLook[entry.index * 2];
                expect(Math.abs(tone - crowns[crown][3])).toBeLessThanOrEqual(0.2 + 1e-6);
                used.add(crown);
            }
            expect(used.size).toBe(crowns.length);
            // Too few values to describe one point: fall back to the bounds.
            const bare = createSim({ count: 50, reserve: 0, crownPoints: new Float32Array([1, 2, 3]) });
            expect(bare.crownPoints).toBeNull();
            expectHealthy(bare);
            const { bounds } = bare;
            for (const entry of airborne(bare)) {
                expect(entry.x).toBeGreaterThanOrEqual(bounds.minX);
                expect(entry.x).toBeLessThanOrEqual(bounds.maxX);
                expect(entry.z).toBeGreaterThanOrEqual(bounds.minZ);
                expect(entry.z).toBeLessThanOrEqual(bounds.maxZ);
            }
        });
    });

    describe('falling, landing and fading', () => {
        it('lands petals on the supplied surface and never rests or sinks below it', () => {
            const surface = (x, z) => 1.2 + 0.6 * Math.sin(x * 0.3) * Math.cos(z * 0.2);
            const sim = createSim({ count: 300, reserve: 0, surface });
            let landings = 0;
            const problems = [];
            const before = new Uint8Array(sim.count);
            for (let step = 0; step < 60 * 25; step += 1) {
                before.set(sim.state);
                sim.step(STEP, { windX: 1, windZ: 0, breeze: 0.6 });
                for (let index = 0; index < sim.count; index += 1) {
                    const o = index * 3;
                    const lift = sim.position[o + 1] - surface(sim.position[o], sim.position[o + 2]);
                    if (sim.state[index] === PETAL_REST) {
                        if (before[index] === PETAL_AIR) landings += 1;
                        if (!(lift > 0 && lift < 0.06)) problems.push(`petal ${index} rests ${lift} above the ground`);
                        if (sim.velocity[o] !== 0 || sim.velocity[o + 1] !== 0 || sim.velocity[o + 2] !== 0) {
                            problems.push(`petal ${index} rests while moving`);
                        }
                    } else if (sim.state[index] === PETAL_AIR && !(lift > 0 || sim.velocity[o + 1] > 0)) {
                        // A petal at the surface is either about to be caught or on its way up.
                        problems.push(`petal ${index} sinks ${lift} into the ground`);
                    }
                }
            }
            expect(problems.slice(0, 5)).toEqual([]);
            expect(landings).toBeGreaterThan(100);
            expect(sim.counts().afloat).toBe(0);
            expectHealthy(sim);
        }, 30000);

        it('floats the petals that come down on the lake and rests the ones that reach the bank', () => {
            const sim = createSim({ count: 80, reserve: 80, ...shore });
            for (let index = 0; index < 40; index += 1) {
                sim.spawn(-8 - index * 0.5, 2, -10 + index * 0.4, 0, -0.5, 0);
                sim.spawn(8 + index * 0.5, 3.5, -10 + index * 0.4, 0, -0.5, 0);
            }
            run(sim, 6, { breeze: 0, gust: 0 });
            const counts = sim.counts();
            expect(counts.air).toBe(0);
            expect(counts.afloat).toBe(40);
            expect(counts.rest).toBe(40);
            for (const entry of petals(sim)) {
                const normal = faceNormal(sim, entry.index);
                if (entry.x < 0) {
                    expect(entry.state).toBe(PETAL_FLOAT);
                    // On the water, just proud of it, and perfectly flat.
                    expect(entry.y).toBeGreaterThan(0);
                    expect(entry.y).toBeLessThan(0.03);
                    expect(Math.abs(normal.y)).toBeCloseTo(1, 5);
                } else {
                    expect(entry.state).toBe(PETAL_REST);
                    expect(entry.y).toBeGreaterThan(1.5);
                    expect(entry.y).toBeLessThan(1.56);
                    // On the grass a petal lies nearly flat, each at its own small tilt.
                    expect(Math.abs(normal.y)).toBeGreaterThan(0.9);
                }
                expect(entry.drawn).toBeGreaterThan(0);
            }
            const tilts = petals(sim, (entry) => entry.x > 0).map((entry) => Math.abs(faceNormal(sim, entry.index).y));
            expect(new Set(tilts.map((tilt) => tilt.toFixed(4))).size).toBeGreaterThan(10);
        });

        it('lets a raft drift with the breeze while the petals on the grass stay where they fell', () => {
            const sim = createSim({ count: 60, reserve: 60, ...shore });
            for (let index = 0; index < 30; index += 1) {
                sim.spawn(-20 - index * 0.3, 0.03, -5 + index * 0.2, 0, -1, 0);
                sim.spawn(20 + index * 0.3, 1.53, -5 + index * 0.2, 0, -1, 0);
            }
            sim.step(STEP);
            expect(sim.counts()).toMatchObject({ rest: 30, afloat: 30 });
            const before = snapshot(sim);
            run(sim, 3, { windX: 0.6, windZ: 0.8, breeze: 1.6 });
            for (const entry of petals(sim)) {
                const o = entry.index * 3;
                const dx = entry.x - before.position[o];
                const dz = entry.z - before.position[o + 2];
                if (before.state[entry.index] === PETAL_FLOAT) {
                    expect(entry.state).toBe(PETAL_FLOAT);
                    // Downwind, slowly: a drift, not a flight.
                    expect(dx).toBeGreaterThan(0);
                    expect(dz).toBeGreaterThan(0);
                    expect(dz / dx).toBeCloseTo(0.8 / 0.6, 3);
                    expect(Math.hypot(dx, dz)).toBeLessThan(1.5);
                    expect(entry.y).toBe(before.position[o + 1]);
                } else {
                    expect(entry.state).toBe(PETAL_REST);
                    expect([dx, dz]).toEqual([0, 0]);
                }
            }
            // A stiffer breeze carries the raft further in the same time.
            const drift = (breeze) => {
                const lake = carpet(40, 10, { afloat: true });
                const start = Array.from(lake.position);
                run(lake, 2, { windX: 1, windZ: 0, breeze });
                return mean(petals(lake).map((entry) => entry.x - start[entry.index * 3]));
            };
            expect(drift(2)).toBeGreaterThan(drift(0.5));
            expect(drift(0.5)).toBeGreaterThan(0);
            expect(drift(0)).toBe(0);
        });

        it('turns a raft that drifts ashore into resting petals', () => {
            // A beach: the lake ends at x = 5 and the sand rises gently beyond it.
            const surface = (x) => Math.max(0, (x - 5) * 0.05);
            const sim = createSim({
                count: 20, reserve: 20, surface, waterLevel: 0,
            });
            for (let index = 0; index < 20; index += 1) sim.spawn(4.6 + index * 0.015, 0.03, index - 10, 0, -1, 0);
            sim.step(STEP);
            expect(sim.counts().afloat).toBe(20);
            run(sim, 4, { windX: 1, windZ: 0, breeze: 6 });
            const counts = sim.counts();
            expect(counts.afloat).toBe(0);
            expect(counts.rest + counts.fade).toBe(20);
            for (const entry of petals(sim)) expect(entry.x).toBeGreaterThan(5);
            // Beached petals stop: the wind that moved the raft no longer moves them.
            const beached = snapshot(sim).position;
            run(sim, 0.5, { windX: 1, windZ: 0, breeze: 6 });
            expect(Array.from(sim.position)).toEqual(beached);
        });

        it('cycles ambient petals from the ground back to the crowns without ever hiding one', () => {
            const crowns = new Float32Array([-6, 4, -4, 0.2, 5, 4.5, -12, 0.8]);
            const sim = createSim({ count: 120, reserve: 0, crownPoints: crowns });
            const seen = Array.from({ length: sim.count }, () => new Set());
            const cycles = new Uint16Array(sim.count);
            const before = new Uint8Array(sim.count);
            const scaleBefore = new Float32Array(sim.count);
            const problems = [];
            let shrinking = 0;
            for (let step = 0; step < 60 * 90; step += 1) {
                before.set(sim.state);
                scaleBefore.set(sim.scale);
                sim.step(STEP, { windX: 1, windZ: 0, breeze: 0.4 });
                for (let index = 0; index < sim.count; index += 1) {
                    const state = sim.state[index];
                    seen[index].add(state);
                    if (state === PETAL_IDLE) problems.push(`petal ${index} was hidden`);
                    if (state === PETAL_FADE && before[index] === PETAL_FADE) {
                        if (!(sim.scale[index] < scaleBefore[index])) problems.push(`petal ${index} stopped fading`);
                        shrinking += 1;
                    }
                    if (before[index] === PETAL_FADE && state === PETAL_AIR) {
                        // A faded petal lets go again from a bough, at full size.
                        cycles[index] += 1;
                        if (sim.scale[index] !== 1 || !(sim.outPosition[index * 4 + 3] > 0)) {
                            problems.push(`petal ${index} came back small`);
                        }
                        if (!(sim.position[index * 3 + 1] > 3)) problems.push(`petal ${index} came back on the ground`);
                    }
                }
            }
            expect(problems.slice(0, 5)).toEqual([]);
            expect(shrinking).toBeGreaterThan(sim.count);
            for (let index = 0; index < sim.count; index += 1) {
                expect([...seen[index]].sort()).toEqual([PETAL_AIR, PETAL_REST, PETAL_FADE]);
                expect(cycles[index]).toBeGreaterThanOrEqual(1);
            }
            expectHealthy(sim);
        }, 30000);

        it('returns event petals to the hidden reserve once they have lain a while', () => {
            const sim = createSim({ count: 50, reserve: 30 });
            const thrown = [];
            for (let index = 0; index < 30; index += 1) {
                thrown.push(sim.spawn(index - 15, 2 + (index % 5), -10, 1, 2, 0, 0.9));
            }
            expect(sim.counts().idle).toBe(0);
            const visited = thrown.map(() => new Set());
            for (let step = 0; step < 60 * 40 && sim.counts().idle < 30; step += 1) {
                sim.step(STEP);
                thrown.forEach((index, slot) => visited[slot].add(sim.state[index]));
            }
            expect(sim.counts().idle).toBe(30);
            for (const states of visited) {
                expect([...states].sort()).toEqual([PETAL_IDLE, PETAL_AIR, PETAL_REST, PETAL_FADE]);
            }
            for (const index of thrown) {
                expect(sim.outPosition[index * 4 + 3]).toBe(0);
                expect(sim.glow[index]).toBe(0);
                expect(sim.outLook[index * 2 + 1]).toBe(0);
            }
            // The ambient petals were never drawn into it.
            expect(petals(sim, (entry) => entry.index < sim.ambient && entry.state === PETAL_IDLE)).toEqual([]);
        });

        it('carries falling petals along the wind', () => {
            const flown = (windX, windZ) => {
                const sim = createSim({ count: 200, reserve: 200 });
                for (let index = 0; index < 200; index += 1) {
                    sim.spawn((index % 20) - 10, 12, -30 + (index % 7), 0, 0, 0);
                }
                run(sim, 2.5, { windX, windZ, breeze: 3 });
                const flying = airborne(sim);
                expect(flying.length).toBeGreaterThan(150);
                return {
                    vx: mean(flying.map((entry) => entry.vx)),
                    vz: mean(flying.map((entry) => entry.vz)),
                    x: mean(flying.map((entry) => entry.x)),
                };
            };
            const east = flown(1, 0);
            const west = flown(-1, 0);
            const south = flown(0, 1);
            expect(east.vx).toBeGreaterThan(1);
            expect(west.vx).toBeLessThan(-1);
            expect(east.x).toBeGreaterThan(west.x + 4);
            expect(south.vz).toBeGreaterThan(1);
            expect(Math.abs(south.vx)).toBeLessThan(Math.abs(east.vx) / 2);
        });

        it('lets the light an event petal carries fade as it falls', () => {
            const sim = createSim({ count: 6, reserve: 4 });
            const bright = sim.spawn(0, 20, -10, 0, 0, 0, 1);
            const dim = sim.spawn(2, 20, -10, 0, 0, 0, 0.3);
            const plain = sim.spawn(4, 20, -10, 0, 0, 0);
            // Asked for more or less light than there is: clamped.
            expect(sim.glow[sim.spawn(6, 20, -10, 0, 0, 0, 7)]).toBe(1);
            expect(sim.glow[bright]).toBe(1);
            expect(sim.glow[dim]).toBeCloseTo(0.3, 6);
            expect(sim.glow[plain]).toBeGreaterThan(0);
            let previous = [1, sim.glow[dim]];
            for (let second = 0; second < 5; second += 1) {
                run(sim, 1);
                expect(sim.state[bright]).toBe(PETAL_AIR);
                const now = [sim.glow[bright], sim.glow[dim]];
                expect(now[0]).toBeLessThan(previous[0]);
                expect(now[1]).toBeLessThan(previous[1]);
                // Both fade at the same rate, so the brighter one stays brighter.
                expect(now[0] / now[1]).toBeCloseTo(1 / 0.3, 3);
                expect(sim.outLook[bright * 2 + 1]).toBe(sim.glow[bright]);
                previous = now;
            }
            expect(previous[0]).toBeGreaterThan(0);
            // Ambient petals carry none.
            for (let index = 0; index < sim.ambient; index += 1) expect(sim.glow[index]).toBe(0);
        });
    });

    describe('spawning event petals', () => {
        it('does nothing without a reserve', () => {
            const sim = createSim({ count: 30, reserve: 0 });
            const before = snapshot(sim);
            expect(sim.spawn(0, 5, 0, 1, 1, 1)).toBe(-1);
            expect(snapshot(sim)).toEqual(before);
        });

        it('hands out hidden petals in order and never touches an ambient petal', () => {
            const sim = createSim({ count: 20, reserve: 8 });
            const ambient = snapshot(sim);
            const handed = [];
            for (let index = 0; index < 8; index += 1) {
                handed.push(sim.spawn(index, 5 + index, -index, 1 + index, 2, -3, 0.5));
            }
            expect(handed).toEqual([12, 13, 14, 15, 16, 17, 18, 19]);
            handed.forEach((index, order) => {
                expect(petal(sim, index)).toMatchObject({
                    state: PETAL_AIR, x: order, y: 5 + order, z: -order, vx: 1 + order, vy: 2, vz: -3, glow: 0.5,
                });
                expect(sim.scale[index]).toBe(1);
                expect(sim.timer[index]).toBe(0);
            });
            expect(sim.counts().idle).toBe(0);
            expect(Array.from(sim.state.subarray(0, 12))).toEqual(ambient.state.slice(0, 12));
            expect(Array.from(sim.position.subarray(0, 36))).toEqual(ambient.position.slice(0, 36));
            expect(Array.from(sim.velocity.subarray(0, 36))).toEqual(ambient.velocity.slice(0, 36));
            // They are drawn from the next step on.
            sim.step(STEP);
            for (const index of handed) expect(sim.outPosition[index * 4 + 3]).toBeGreaterThan(0);
        });

        it('never steals a petal that is still in the air', () => {
            const sim = createSim({ count: 5, reserve: 3 });
            const flying = [0, 1, 2].map((index) => sim.spawn(index, 30, -10, 0, 0, 0));
            expect(flying).toEqual([2, 3, 4]);
            const before = snapshot(sim);
            expect(sim.spawn(9, 9, 9, 9, 9, 9)).toBe(-1);
            expect(snapshot(sim)).toEqual(before);
        });

        it('reuses the event petal that has lain longest once the reserve is exhausted', () => {
            const sim = createSim({ count: 3, reserve: 3 });
            const first = sim.spawn(0, 0.03, -10, 0, -1, 0);
            run(sim, 1);
            const second = sim.spawn(3, 0.03, -10, 0, -1, 0);
            run(sim, 1);
            const third = sim.spawn(6, 30, -10, 0, 0, 0);
            sim.step(STEP);
            expect([first, second, third].map((index) => sim.state[index]))
                .toEqual([PETAL_REST, PETAL_REST, PETAL_AIR]);
            expect(sim.timer[first]).toBeGreaterThan(sim.timer[second]);
            // No hidden petal is left: the one that has lain longest is thrown again.
            expect(sim.spawn(-4, 8, -20, 1, 2, 3)).toBe(first);
            expect(petal(sim, first)).toMatchObject({
                state: PETAL_AIR, x: -4, y: 8, z: -20, vx: 1, vy: 2, vz: 3,
            });
            expect(sim.spawn(-5, 8, -20, 0, 0, 0)).toBe(second);
            expect(sim.spawn(-6, 8, -20, 0, 0, 0)).toBe(-1);
        });

        it('prefers a hidden petal to one that is lying in view', () => {
            const sim = createSim({ count: 4, reserve: 4 });
            const lying = sim.spawn(0, 0.03, -10, 0, -1, 0);
            run(sim, 2);
            expect(sim.state[lying]).toBe(PETAL_REST);
            const next = [sim.spawn(1, 9, -10, 0, 0, 0), sim.spawn(2, 9, -10, 0, 0, 0), sim.spawn(3, 9, -10, 0, 0, 0)];
            expect(next).not.toContain(lying);
            expect(new Set(next).size).toBe(3);
            expect(sim.state[lying]).toBe(PETAL_REST);
            expect(sim.spawn(4, 9, -10, 0, 0, 0)).toBe(lying);
        });
    });

    describe('wind and force fields', () => {
        it.each([
            ['on the grass', false], ['on the lake', true],
        ])('leaves petals %s undisturbed in still air', (_label, afloat) => {
            const sim = carpet(200, 15, { afloat });
            const before = Array.from(sim.position);
            run(sim, 3);
            run(sim, 1, { breeze: 0, gust: 0, fields: [] });
            expect(Array.from(sim.position)).toEqual(before);
            expect(sim.counts().air).toBe(0);
            expectHealthy(sim);
        });

        it('lifts the petals inside a burst and throws them outward and up', () => {
            const sim = carpet(400, 8);
            const burst = {
                kind: 'burst', x: 0, y: -0.3, z: 0, radius: 4, power: 20, up: 6,
            };
            run(sim, 0.3, { fields: [burst] });
            const lifted = airborne(sim);
            expect(lifted.length).toBeGreaterThan(20);
            for (const entry of lifted) expect(Math.hypot(entry.x, entry.z)).toBeLessThan(6);
            const radial = lifted
                .map((entry) => (entry.x * entry.vx + entry.z * entry.vz) / Math.hypot(entry.x, entry.z));
            expect(mean(radial)).toBeGreaterThan(0.5);
            expect(mean(lifted.map((entry) => entry.y))).toBeGreaterThan(0.15);
            // Out of its reach nothing stirs.
            const outside = petals(sim, (entry) => Math.hypot(entry.x, entry.z) > 4.5);
            expect(outside.length).toBeGreaterThan(50);
            for (const entry of outside) expect(entry.state).toBe(PETAL_REST);
            // A harder burst throws them faster.
            const speedFor = (power) => {
                const other = carpet(400, 8);
                run(other, 0.3, { fields: [{ ...burst, power }] });
                return mean(airborne(other).map((entry) => Math.hypot(entry.vx, entry.vz)));
            };
            expect(speedFor(40)).toBeGreaterThan(speedFor(10));
        });

        it.each([[1], [-1]])('lifts petals into a jet and carries them the way it points (dx %i)', (dx) => {
            const sim = carpet(400, 8);
            const start = Array.from(sim.position);
            const jet = {
                kind: 'jet', x: 0, y: 0, z: 0, dx, dy: 0.12, dz: 0, radius: 5, power: 18,
            };
            run(sim, 0.5, { fields: [jet] });
            const lifted = airborne(sim);
            expect(lifted.length).toBeGreaterThan(40);
            expect(mean(lifted.map((entry) => entry.vx)) * dx).toBeGreaterThan(1);
            expect(mean(lifted.map((entry) => entry.x - start[entry.index * 3])) * dx).toBeGreaterThan(0.2);
            expect(lifted.filter((entry) => entry.vx * dx > 0).length).toBeGreaterThan(lifted.length * 0.9);
        });

        it.each([[1], [-1]])('captures petals in a vortex and turns them the way it spins (turn %i)', (turn) => {
            const sim = carpet(500, 6);
            const vortex = { ...WHIRL, turn };
            run(sim, 2, { fields: [vortex] });
            const caught = airborne(sim).filter((entry) => Math.hypot(entry.x, entry.z) < 4.4);
            expect(caught.length).toBeGreaterThan(100);
            const circulation = caught.map((entry) => entry.x * entry.vz - entry.z * entry.vx);
            expect(mean(circulation) * turn).toBeGreaterThan(1);
            expect(circulation.filter((value) => value * turn > 0).length).toBeGreaterThan(caught.length * 0.85);
            // It carries them up off the ground, but not out through the top of the column.
            expect(mean(caught.map((entry) => entry.y))).toBeGreaterThan(0.5);
            expect(Math.max(...caught.map((entry) => entry.y))).toBeLessThan(vortex.top + 4);
            // The spring toward the ring gathers them near its radius.
            const radii = caught.map((entry) => Math.hypot(entry.x, entry.z));
            expect(Math.abs(mean(radii) - vortex.radius)).toBeLessThan(1.5);
            expectHealthy(sim);
        });

        it.each([
            ['off the grass', false], ['off the lake', true],
        ])('breathes fallen petals up %s inside a lift', (_label, afloat) => {
            const sim = carpet(500, 16, { afloat });
            const lift = {
                kind: 'lift', x: 0, z: 0, radius: 10, top: 7, power: 6.5, swirl: 2.2,
            };
            run(sim, 0.2, { fields: [lift] });
            const inside = petals(sim, (entry) => Math.hypot(entry.x, entry.z) < 6);
            const outside = petals(sim, (entry) => Math.hypot(entry.x, entry.z) > 11);
            expect(inside.length).toBeGreaterThan(60);
            expect(outside.length).toBeGreaterThan(60);
            for (const entry of inside) {
                expect(entry.state).toBe(PETAL_AIR);
                expect(entry.vy).toBeGreaterThan(0);
                expect(entry.y).toBeGreaterThan(0.03);
            }
            for (const entry of outside) expect(DOWN).toContain(entry.state);
            run(sim, 1.1, { fields: [lift] });
            const risen = airborne(sim);
            expect(mean(risen.map((entry) => entry.y))).toBeGreaterThan(1);
            // The updraught stops at its ceiling.
            expect(Math.max(...risen.map((entry) => entry.y))).toBeLessThan(lift.top + 3);
            // It lifts hardest at its centre.
            const near = risen.filter((entry) => Math.hypot(entry.x, entry.z) < 4);
            const far = risen.filter((entry) => Math.hypot(entry.x, entry.z) > 7);
            expect(mean(near.map((entry) => entry.y))).toBeGreaterThan(mean(far.map((entry) => entry.y)));
            // And the swirl turns them about it.
            expect(mean(risen.map((entry) => entry.x * entry.vz - entry.z * entry.vx))).toBeGreaterThan(0);
        });

        it.each([[1], [-1]])('kicks the petals under a gust front along its travel (direction %i)', (direction) => {
            const sim = carpet(400, 16);
            const front = {
                x: 0, width: 9, strength: 1, direction,
            };
            sim.step(STEP, { front });
            const under = petals(sim, (entry) => Math.abs(entry.x) < 3);
            const clear = petals(sim, (entry) => Math.abs(entry.x) > 14);
            expect(under.length).toBeGreaterThan(40);
            expect(clear.length).toBeGreaterThan(20);
            for (const entry of under) {
                expect(entry.state).toBe(PETAL_AIR);
                expect(entry.vx * direction).toBeGreaterThan(0);
                expect(entry.vy).toBeGreaterThan(0);
            }
            for (const entry of clear) expect(entry.state).toBe(PETAL_REST);
            // Carried on, they travel with it.
            const start = Array.from(sim.position);
            run(sim, 0.6, (time) => ({ front: { ...front, x: direction * time * 20 } }));
            expect(mean(under.map((entry) => sim.position[entry.index * 3] - start[entry.index * 3])) * direction)
                .toBeGreaterThan(0.3);
            // A faint front passes over without lifting anything.
            const calm = carpet(200, 16);
            calm.step(STEP, { front: { ...front, strength: 0.2 } });
            expect(calm.counts().air).toBe(0);
        });

        it('lets strong gusts pick petals up where gentle wind cannot', () => {
            // A long lawn, so that a whole swell of the wind fits across it.
            const lawn = () => {
                const sim = createSim({ count: 400, reserve: 400, seed: 9 });
                const scatter = seededRandom(21);
                for (let index = 0; index < 400; index += 1) {
                    sim.spawn((scatter() * 2 - 1) * 55, 0.03, (scatter() * 2 - 1) * 15, 0, -1, 0);
                }
                sim.step(STEP);
                expect(sim.counts().rest).toBe(400);
                return sim;
            };
            const gentle = lawn();
            run(gentle, 3, {
                windX: 1, windZ: 0, breeze: 1, gust: 0.5,
            });
            expect(gentle.counts()).toMatchObject({ air: 0, rest: 400 });

            const stormy = lawn();
            stormy.step(STEP, {
                windX: 1, windZ: 0, breeze: 1, gust: 4.5,
            });
            const first = stormy.counts().air;
            // The gust rolls across the garden: it takes some at once and more as it passes.
            expect(first).toBeGreaterThan(0);
            expect(first).toBeLessThan(400);
            const everLifted = new Set(airborne(stormy).map((entry) => entry.index));
            for (let step = 0; step < 120; step += 1) {
                stormy.step(STEP, {
                    windX: 1, windZ: 0, breeze: 1, gust: 4.5,
                });
                for (let index = 0; index < stormy.count; index += 1) {
                    if (stormy.state[index] === PETAL_AIR) everLifted.add(index);
                }
            }
            expect(everLifted.size).toBeGreaterThan(first + 20);
            expectHealthy(stormy);
        });

        it('ignores fields that do not reach a petal', () => {
            const sim = carpet(200, 6);
            const before = Array.from(sim.position);
            const fields = [
                {
                    kind: 'burst', x: 30, y: 0, z: 0, radius: 4, power: 50, up: 9,
                },
                {
                    kind: 'burst', x: 0, y: 12, z: 0, radius: 4, power: 50, up: 9,
                },
                {
                    kind: 'jet', x: 0, y: 0, z: -40, dx: 1, dy: 0, dz: 0, radius: 5, power: 40,
                },
                { ...WHIRL, x: 40 },
                // A column that ends below the ground, and an updraught whose ceiling does.
                { ...WHIRL, reach: 9, top: -5 },
                {
                    kind: 'lift', x: 0, z: 0, radius: 20, top: -1, power: 9, swirl: 2,
                },
                {
                    kind: 'lift', x: 60, z: 0, radius: 20, top: 7, power: 9, swirl: 2,
                },
            ];
            run(sim, 1, { fields });
            expect(Array.from(sim.position)).toEqual(before);
            expect(sim.counts()).toMatchObject({ air: 0, rest: 200 });
        });
    });

    describe('bounds and time', () => {
        it('retires event petals that fly out of bounds', () => {
            const sim = createSim({ count: 10, reserve: 10 });
            const { bounds } = sim;
            const out = [
                sim.spawn(bounds.maxX - 0.05, 5, 0, 40, 0, 0),
                sim.spawn(bounds.minX + 0.05, 5, 0, -40, 0, 0),
                sim.spawn(0, 5, bounds.maxZ - 0.05, 0, 0, 40),
                sim.spawn(0, 5, bounds.minZ + 0.05, 0, 0, -40),
                sim.spawn(0, bounds.maxY - 0.05, 0, 0, 40, 0),
            ];
            const kept = sim.spawn(0, 5, -20, 0, 0, 0);
            sim.step(STEP);
            for (const index of out) {
                expect(sim.state[index]).toBe(PETAL_IDLE);
                expect(sim.outPosition[index * 4 + 3]).toBe(0);
                expect(sim.glow[index]).toBe(0);
            }
            expect(sim.state[kept]).toBe(PETAL_AIR);
            expect(sim.counts().idle).toBe(9);
            // Retired petals are back in the reserve: the whole of it can be thrown again.
            const again = Array.from({ length: 9 }, () => sim.spawn(0, 5, -20, 0, 0, 0));
            expect(again).not.toContain(-1);
            expect(again).not.toContain(kept);
            for (const index of out) expect(again).toContain(index);
            expect(sim.spawn(0, 5, -20, 0, 0, 0)).toBe(-1);
        });

        it('starts ambient petals again inside the bounds when the wind carries them out', () => {
            const bounds = {
                minX: -20, maxX: 20, minZ: -20, maxZ: 20, maxY: 30,
            };
            const sim = createSim({ count: 150, reserve: 0, bounds });
            let restarts = 0;
            const problems = [];
            const before = new Float32Array(sim.count * 3);
            const states = new Uint8Array(sim.count);
            for (let step = 0; step < 60 * 12; step += 1) {
                before.set(sim.position);
                states.set(sim.state);
                sim.step(STEP, { windX: 1, windZ: 0, breeze: 14 });
                for (let index = 0; index < sim.count; index += 1) {
                    const o = index * 3;
                    if (sim.state[index] === PETAL_IDLE) problems.push(`petal ${index} was hidden`);
                    if (sim.state[index] === PETAL_AIR) {
                        const x = sim.position[o];
                        const z = sim.position[o + 2];
                        const outside = x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ
                            || sim.position[o + 1] > bounds.maxY;
                        if (outside) problems.push(`petal ${index} flies outside at ${x}, ${z}`);
                        // Blown out through the downwind edge, back in somewhere upwind of it.
                        if (states[index] === PETAL_AIR && x < before[o] - 1) restarts += 1;
                    }
                }
            }
            expect(problems.slice(0, 5)).toEqual([]);
            expect(restarts).toBeGreaterThan(20);
            expectHealthy(sim);
        }, 30000);

        it('ignores invalid timesteps and clamps long frames to a twentieth of a second', () => {
            const sim = createSim({ count: 60, reserve: 20 });
            sim.spawn(0, 6, -10, 1, 1, 1);
            const before = snapshot(sim);
            for (const dt of [0, -0.016, NaN, Infinity, -Infinity, undefined, null, '0.016']) {
                sim.step(dt, { breeze: 2 });
            }
            expect(snapshot(sim)).toEqual(before);
            sim.step(10, { breeze: 2 });
            expect(sim.time).toBeCloseTo(0.05, 9);
            const hitch = createSim({ count: 60, reserve: 20 });
            hitch.spawn(0, 6, -10, 1, 1, 1);
            hitch.step(0.05, { breeze: 2 });
            expect(snapshot(sim)).toEqual(snapshot(hitch));
            sim.step(0.01);
            expect(sim.time).toBeCloseTo(0.06, 9);
            // No environment at all is still air.
            expect(() => sim.step(STEP, undefined)).not.toThrow();
            expectHealthy(sim);
        });

        it('keeps every buffer finite through a long run of gameplay-like events', () => {
            const sim = createSim({
                count: 900,
                reserve: 500,
                seed: 31,
                surface: (x, z) => Math.max(0, 0.8 + 0.6 * Math.sin(x * 0.2 + z * 0.1)),
                waterLevel: 0,
            });
            const chaos = seededRandom(77);
            const centre = { x: 0, z: -8 };
            for (let step = 0; step < 60 * 24; step += 1) {
                const time = step * STEP;
                const fields = [];
                if (step % 90 < 20) {
                    fields.push({
                        kind: 'burst', x: (chaos() - 0.5) * 12, y: 0.5, z: centre.z, radius: 4.2, power: 25, up: 6,
                    });
                }
                if (step % 200 < 45) {
                    const side = step % 400 < 200 ? -1 : 1;
                    fields.push({
                        kind: 'jet', x: side * 3, y: 2, z: centre.z, dx: side, dy: 0.12, dz: 0, radius: 5.2, power: 18,
                    });
                }
                if (step % 600 > 300) {
                    fields.push({
                        ...WHIRL, x: centre.x, z: centre.z, radius: 3.2, reach: 5, top: 8, spin: 10, lift: 3,
                    });
                }
                if (step % 700 > 620) {
                    fields.push({
                        kind: 'lift', x: centre.x, z: centre.z - 6, radius: 26, top: 7, power: 6.5, swirl: 2.2,
                    });
                }
                if (step % 6 === 0) {
                    for (let burst = 0; burst < 12; burst += 1) {
                        sim.spawn(
                            (chaos() - 0.5) * 20,
                            1 + chaos() * 9,
                            centre.z + (chaos() - 0.5) * 10,
                            (chaos() - 0.5) * 16,
                            chaos() * 6,
                            (chaos() - 0.5) * 8,
                            chaos(),
                        );
                    }
                }
                const front = step % 500 < 120
                    ? {
                        x: -60 + (step % 500),
                        width: 9,
                        strength: Math.sin(((step % 500) / 120) * Math.PI),
                        direction: 1,
                    }
                    : null;
                sim.step(STEP, {
                    windX: 0.96, windZ: 0.28, breeze: 0.9, gust: 2.2 + 2.2 * Math.sin(time), front, fields,
                });
                if (step % 60 === 0) expectHealthy(sim);
            }
            expectHealthy(sim);
            const counts = sim.counts();
            expect(counts.air).toBeGreaterThan(0);
            expect(counts.rest + counts.afloat).toBeGreaterThan(0);
            // The surface is never broken, wherever a petal came down.
            for (const entry of petals(sim, (item) => DOWN.includes(item.state))) {
                expect(entry.y).toBeGreaterThanOrEqual(sim.surface(entry.x, entry.z));
            }
        }, 30000);

        it('survives a random source that returns nonsense', () => {
            for (const value of [NaN, Infinity, -Infinity, -3, 0, 1, 42]) {
                const sim = new SakuraPetalSim({
                    count: 60, reserve: 20, rng: () => value, ...shore,
                });
                for (let index = 0; index < 20; index += 1) sim.spawn(index - 10, 3, -10, 1, 2, 0);
                run(sim, 2, {
                    breeze: 2,
                    gust: 4.5,
                    fields: [{
                        kind: 'burst', x: 0, y: 0, z: -10, radius: 6, power: 20, up: 6,
                    }],
                });
                expectHealthy(sim);
            }
        });
    });

    describe('render buffers', () => {
        it('writes position, drawn size and a yaw-pitch-roll quaternion for every petal', () => {
            const sim = createSim({ count: 120, reserve: 40, ...shore });
            for (let index = 0; index < 20; index += 1) sim.spawn(index - 10, 4, -10, 2, 3, 1);
            run(sim, 1.5, { breeze: 1.5, gust: 1 });
            const expected = new Quaternion();
            const actual = new Quaternion();
            for (let index = 0; index < sim.count; index += 1) {
                const o = index * 3;
                const p = index * 4;
                expect(sim.outPosition[p]).toBe(sim.position[o]);
                expect(sim.outPosition[p + 1]).toBe(sim.position[o + 1]);
                expect(sim.outPosition[p + 2]).toBe(sim.position[o + 2]);
                if (sim.state[index] === PETAL_IDLE) expect(sim.outPosition[p + 3]).toBe(0);
                else expect(sim.outPosition[p + 3]).toBeCloseTo(sim.size[index] * sim.scale[index], 6);
                // angles are (yaw, pitch, roll): yaw about Y, then pitch about X, then roll about Z.
                expected.setFromEuler(new Euler(sim.angles[o + 1], sim.angles[o], sim.angles[o + 2], 'YXZ'));
                actual.set(sim.outRotation[p], sim.outRotation[p + 1], sim.outRotation[p + 2], sim.outRotation[p + 3]);
                expect(Math.abs(expected.dot(actual))).toBeCloseTo(1, 5);
                expect(sim.outLook[index * 2 + 1]).toBe(sim.glow[index]);
            }
            expectHealthy(sim);
        });

        it('gives every petal a size and a tone of its own', () => {
            const sim = createSim({ count: 300, reserve: 100 });
            const sizes = Array.from(sim.size);
            expect(Math.min(...sizes)).toBeGreaterThan(0.05);
            expect(Math.max(...sizes)).toBeLessThan(0.4);
            expect(new Set(sizes).size).toBeGreaterThan(250);
            const tones = Array.from({ length: sim.count }, (_, index) => sim.outLook[index * 2]);
            expect(Math.min(...tones)).toBeGreaterThanOrEqual(0);
            expect(Math.max(...tones)).toBeLessThanOrEqual(1);
            expect(Math.max(...tones) - Math.min(...tones)).toBeGreaterThan(0.5);
            // Size and tone belong to the petal, not to the flight: a step changes neither.
            run(sim, 1, { breeze: 1 });
            expect(Array.from(sim.size)).toEqual(sizes);
        });

        it('reproduces the same flight for the same seed and a different one for another', () => {
            const fly = (seed) => {
                const sim = createSim({
                    count: 200, reserve: 80, seed, ...shore,
                });
                for (let step = 0; step < 180; step += 1) {
                    if (step % 30 === 0) sim.spawn(step % 7, 5, -10, 2, 3, -1);
                    sim.step(STEP, {
                        windX: 1, windZ: 0, breeze: 1.2, gust: step > 90 ? 4.5 : 0,
                    });
                }
                return snapshot(sim);
            };
            expect(fly(5)).toEqual(fly(5));
            expect(fly(6).outPosition).not.toEqual(fly(5).outPosition);
        });

        it('returns to its opening state on reset', () => {
            const sim = createSim({ count: 300, reserve: 120, ...shore });
            for (let index = 0; index < 120; index += 1) sim.spawn(index % 11, 4, -10, 2, 3, 0, 1);
            run(sim, 2, { breeze: 2, gust: 4.5 });
            expect(sim.counts().idle).toBe(0);
            sim.reset();
            expect(sim.time).toBe(0);
            const counts = sim.counts();
            expect(counts).toMatchObject({ idle: 120, fade: 0 });
            expect(counts.air + counts.rest + counts.afloat).toBe(180);
            for (let index = 0; index < sim.count; index += 1) {
                if (index < sim.ambient) {
                    expect([PETAL_AIR, PETAL_REST, PETAL_FLOAT]).toContain(sim.state[index]);
                    expect(sim.outPosition[index * 4 + 3]).toBeGreaterThan(0);
                } else {
                    expect(sim.state[index]).toBe(PETAL_IDLE);
                    expect(sim.outPosition[index * 4 + 3]).toBe(0);
                    expect(sim.outLook[index * 2 + 1]).toBe(0);
                }
            }
            // The reserve is handed out from its start again.
            expect(sim.spawn(0, 5, -10, 0, 0, 0)).toBe(sim.ambient);
            expectHealthy(sim);
        });
    });
});

import { describe, expect, it } from 'vitest';
import { Euler, Quaternion, Vector3 } from 'three/webgpu';
import {
    FallLeafSim, LEAF_AIR, LEAF_FADE, LEAF_IDLE, LEAF_REST,
} from '../../src/themes/fall/fall-leaf-sim.js';

const STEP = 1 / 60;
const STATE_NAMES = ['idle', 'air', 'rest', 'fade'];

function seededRandom(seed = 187) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function createSim({ seed = 187, ...options }) {
    return new FallLeafSim({ rng: seededRandom(seed), ...options });
}

/** Every leaf is an event leaf lying on flat ground, scattered over a square of half-width `spread`. */
function carpet(count, spread, seed = 4) {
    const sim = createSim({ count, reserve: count, seed });
    const scatter = seededRandom(seed + 100);
    for (let index = 0; index < count; index++) {
        sim.spawn((scatter() * 2 - 1) * spread, 0.03, (scatter() * 2 - 1) * spread, 0, -1, 0);
    }
    sim.step(STEP);
    expect(sim.counts()).toEqual({
        idle: 0, air: 0, rest: count, fade: 0,
    });
    return sim;
}

function run(sim, seconds, env, dt = STEP) {
    const steps = Math.round(seconds / dt);
    for (let step = 0; step < steps; step++) sim.step(dt, typeof env === 'function' ? env(step * dt) : env);
}

function leaf(sim, index) {
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
    };
}

function leaves(sim, predicate = () => true) {
    const result = [];
    for (let index = 0; index < sim.count; index++) {
        const entry = leaf(sim, index);
        if (predicate(entry)) result.push(entry);
    }
    return result;
}

const airborne = (sim) => leaves(sim, (entry) => entry.state === LEAF_AIR);
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

function allFinite(array) {
    for (let index = 0; index < array.length; index++) {
        if (!Number.isFinite(array[index])) return false;
    }
    return true;
}

function expectHealthy(sim) {
    for (const key of ['position', 'velocity', 'angles', 'spin', 'phase', 'rate', 'size', 'scale', 'timer',
        'heading', 'tone', 'outPosition', 'outRotation']) {
        expect(allFinite(sim[key]), key).toBe(true);
    }
    const counts = sim.counts();
    expect(Object.keys(counts)).toEqual(STATE_NAMES);
    expect(counts.idle + counts.air + counts.rest + counts.fade).toBe(sim.count);
    let worstQuaternion = 0;
    for (let index = 0; index < sim.count; index++) {
        const p = index * 4;
        const length = Math.hypot(
            sim.outRotation[p],
            sim.outRotation[p + 1],
            sim.outRotation[p + 2],
            sim.outRotation[p + 3],
        );
        worstQuaternion = Math.max(worstQuaternion, Math.abs(length - 1));
    }
    expect(worstQuaternion).toBeLessThan(1e-5);
}

function snapshot(sim) {
    return {
        time: sim.time,
        state: Array.from(sim.state),
        position: Array.from(sim.position),
        velocity: Array.from(sim.velocity),
        outPosition: Array.from(sim.outPosition),
        outRotation: Array.from(sim.outRotation),
    };
}

describe('Fall leaf simulation', () => {
    describe('construction', () => {
        it('clamps the leaf count and the reserve into a usable pool', () => {
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
                expect(sim.counts().idle).toBe(reserve);
                expectHealthy(sim);
            }
        });

        // A non-finite count or reserve must not leak NaN into the buffer sizes: the count falls back
        // to one leaf and the reserve to none.
        it('clamps a non-finite leaf count or reserve as it clamps other out-of-range values', () => {
            for (const count of [NaN, undefined, 'many']) {
                const sim = createSim({ count });
                expect(Number.isInteger(sim.count)).toBe(true);
                expect(sim.count).toBeGreaterThanOrEqual(1);
                expect(sim.outPosition).toHaveLength(sim.count * 4);
            }
            const sim = createSim({ count: 5, reserve: NaN });
            expect(sim.reserve).toBe(0);
            expect(sim.ambient).toBe(5);
        });

        it('opens mid-cycle: ambient leaves lie or fall, reserve leaves wait hidden', () => {
            const sim = createSim({ count: 400, reserve: 150 });
            expect(sim.time).toBe(0);
            const ambient = leaves(sim, (entry) => entry.index < sim.ambient);
            const reserve = leaves(sim, (entry) => entry.index >= sim.ambient);
            expect(ambient).toHaveLength(250);
            expect(reserve).toHaveLength(150);
            const resting = ambient.filter((entry) => entry.state === LEAF_REST);
            const falling = ambient.filter((entry) => entry.state === LEAF_AIR);
            expect(resting.length + falling.length).toBe(ambient.length);
            expect(falling.length).toBeGreaterThan(0);
            // Most of the opening picture is the carpet, not the air.
            expect(resting.length).toBeGreaterThan(falling.length);
            for (const entry of ambient) expect(entry.drawn).toBeGreaterThan(0);
            for (const entry of resting) {
                expect(entry.y).toBeGreaterThanOrEqual(0);
                expect(entry.y).toBeLessThan(0.1);
                expect([entry.vx, entry.vy, entry.vz]).toEqual([0, 0, 0]);
            }
            for (const entry of falling) {
                expect(entry.y).toBeGreaterThan(0);
                expect(entry.vy).toBeLessThan(0);
            }
            for (const entry of reserve) {
                expect(entry.state).toBe(LEAF_IDLE);
                expect(entry.drawn).toBe(0);
            }
            expect(sim.counts()).toEqual({
                idle: 150, air: falling.length, rest: resting.length, fade: 0,
            });
            expectHealthy(sim);
        });

        it('lets ambient leaves go from the crown points it is given', () => {
            const crowns = [[-6, 11, -4, 0], [5, 9, -12, 1], [0, 13, 3, 2]];
            const sim = createSim({ count: 300, reserve: 0, crownPoints: new Float32Array(crowns.flat()) });
            const falling = airborne(sim);
            expect(falling.length).toBeGreaterThan(20);
            const used = new Set();
            for (const entry of falling) {
                const crown = crowns.findIndex(([x, , z]) => (
                    Math.abs(entry.x - x) <= 0.81 && Math.abs(entry.z - z) <= 0.81));
                expect(crown).toBeGreaterThanOrEqual(0);
                // Pre-aged falls start somewhere between the bough and the floor.
                expect(entry.y).toBeLessThanOrEqual(crowns[crown][1]);
                expect(entry.y).toBeGreaterThan(0);
                used.add(crown);
            }
            expect(used.size).toBe(crowns.length);
            // Too few values to describe one point: fall back to the bounds.
            const bare = createSim({ count: 50, reserve: 0, crownPoints: new Float32Array([1, 2, 3]) });
            expect(bare.crownPoints).toBeNull();
            expectHealthy(bare);
        });
    });

    describe('falling, resting and fading', () => {
        it('lands leaves on the supplied ground and never rests or sinks below it', () => {
            const ground = (x, z) => 1.5 + 0.08 * x - 0.05 * z + 0.3 * Math.sin(x * 0.7);
            const sim = createSim({
                count: 240,
                reserve: 80,
                groundHeight: ground,
                bounds: {
                    minX: -20, maxX: 20, minZ: -20, maxZ: 20, maxY: 30,
                },
            });
            const drop = seededRandom(11);
            const problems = [];
            let landings = 0;
            for (let frame = 0; frame < 60 * 12; frame++) {
                if (frame % 20 === 0) {
                    const x = (drop() * 2 - 1) * 15;
                    const z = (drop() * 2 - 1) * 15;
                    sim.spawn(x, ground(x, z) + 1 + drop() * 4, z, drop() - 0.5, 0, drop() - 0.5);
                }
                const before = Array.from(sim.state);
                sim.step(STEP);
                for (let index = 0; index < sim.count; index++) {
                    const state = sim.state[index];
                    if (state === LEAF_IDLE) continue;
                    const entry = leaf(sim, index);
                    const height = entry.y - ground(entry.x, entry.z);
                    if (state === LEAF_REST || state === LEAF_FADE) {
                        if (!(height > -1e-3 && height < 0.1)) {
                            problems.push(`leaf ${index} lies ${height} above ground`);
                        }
                        if (entry.vx !== 0 || entry.vy !== 0 || entry.vz !== 0) {
                            problems.push(`leaf ${index} moves at rest`);
                        }
                    } else if (entry.vy <= 0 && !(height > 0)) {
                        problems.push(`falling leaf ${index} is ${height} above ground at frame ${frame}`);
                    }
                    if (before[index] === LEAF_AIR && state === LEAF_REST) landings += 1;
                }
            }
            expect(problems).toEqual([]);
            expect(landings).toBeGreaterThan(40);
            expectHealthy(sim);
        });

        it('cycles ambient leaves from the floor back to the crowns without ever hiding one', () => {
            const crowns = [[-6, 11, -4, 0], [5, 9, -12, 1]];
            const sim = createSim({ count: 60, reserve: 0, crownPoints: new Float32Array(crowns.flat()) });
            const released = new Set();
            const allowed = new Set([
                `${LEAF_AIR}>${LEAF_REST}`, `${LEAF_REST}>${LEAF_FADE}`, `${LEAF_FADE}>${LEAF_AIR}`,
            ]);
            const problems = [];
            let previous = leaves(sim);
            for (let frame = 0; frame < 30 * 240 && released.size < sim.count; frame++) {
                sim.step(1 / 30);
                const current = leaves(sim);
                for (let index = 0; index < current.length; index++) {
                    const entry = current[index];
                    const before = previous[index];
                    if (entry.state === LEAF_IDLE) problems.push(`ambient leaf ${index} was hidden`);
                    if (entry.state !== before.state && !allowed.has(`${before.state}>${entry.state}`)) {
                        problems.push(`leaf ${index} went ${STATE_NAMES[before.state]} > ${STATE_NAMES[entry.state]}`);
                    }
                    if (before.state === LEAF_FADE && entry.state === LEAF_FADE) {
                        // Still on the floor, shrinking.
                        if (!(entry.drawn < before.drawn)) problems.push(`fading leaf ${index} did not shrink`);
                        if (entry.x !== before.x || entry.y !== before.y || entry.z !== before.z) {
                            problems.push(`fading leaf ${index} moved`);
                        }
                    }
                    if (before.state === LEAF_FADE && entry.state === LEAF_AIR) {
                        released.add(index);
                        const crown = crowns.find(([x, , z]) => (
                            Math.abs(entry.x - x) <= 0.81 && Math.abs(entry.z - z) <= 0.81));
                        if (!crown) problems.push(`leaf ${index} was released away from every crown`);
                        else if (!(entry.y <= crown[1] && entry.y > crown[1] - 0.81)) {
                            problems.push(`leaf ${index} was released at height ${entry.y}`);
                        }
                        if (!(entry.vy < 0)) problems.push(`released leaf ${index} is not falling`);
                        if (Math.abs(entry.drawn - sim.size[index]) > 1e-6) {
                            problems.push(`released leaf ${index} is drawn at ${entry.drawn}`);
                        }
                    }
                }
                previous = current;
            }
            expect(problems).toEqual([]);
            expect(released.size).toBe(sim.count);
            expect(sim.counts().idle).toBe(0);
            expectHealthy(sim);
        });

        it('returns event leaves to the hidden reserve once they have rested', () => {
            const sim = createSim({ count: 30, reserve: 12 });
            const ambientBefore = sim.counts();
            const spawned = [];
            for (let index = 0; index < 12; index++) spawned.push(sim.spawn(index - 6, 2, 4, 0, 0, 0));
            sim.step(STEP);
            for (const index of spawned) expect(leaf(sim, index).drawn).toBeGreaterThan(0);
            const order = new Map(spawned.map((index) => [index, [LEAF_AIR]]));
            let previous = leaves(sim);
            for (let frame = 0; frame < 60 * 120 && sim.counts().idle < 12; frame++) {
                sim.step(STEP);
                for (const index of spawned) {
                    const entry = leaf(sim, index);
                    const history = order.get(index);
                    if (entry.state !== history.at(-1)) history.push(entry.state);
                    if (previous[index].state === LEAF_FADE && entry.state === LEAF_FADE) {
                        expect(entry.drawn).toBeLessThan(previous[index].drawn);
                    }
                }
                previous = leaves(sim);
            }
            for (const index of spawned) {
                expect(order.get(index)).toEqual([LEAF_AIR, LEAF_REST, LEAF_FADE, LEAF_IDLE]);
                expect(leaf(sim, index).drawn).toBe(0);
            }
            expect(sim.counts().idle).toBe(12);
            // Event leaves never join the ambient cycle, and ambient leaves never go into hiding.
            const counts = sim.counts();
            expect(counts.air + counts.rest + counts.fade).toBe(ambientBefore.air + ambientBefore.rest);
        });

        it('carries falling leaves along the wind', () => {
            const drift = (windX, windZ) => {
                const sim = createSim({ count: 200, reserve: 200 });
                for (let index = 0; index < 200; index++) sim.spawn(0, 12, 0, 0, 0, 0);
                run(sim, 1.5, { windX, windZ, breeze: 3 });
                const flying = airborne(sim);
                expect(flying.length).toBeGreaterThan(150);
                return {
                    x: mean(flying.map((entry) => entry.x)),
                    z: mean(flying.map((entry) => entry.z)),
                    vx: mean(flying.map((entry) => entry.vx)),
                    vz: mean(flying.map((entry) => entry.vz)),
                };
            };
            const east = drift(1, 0);
            const west = drift(-1, 0);
            const south = drift(0, 1);
            expect(east.x).toBeGreaterThan(1);
            expect(east.vx).toBeGreaterThan(1);
            expect(west.x).toBeLessThan(-1);
            expect(west.vx).toBeLessThan(-1);
            expect(south.z).toBeGreaterThan(1);
            expect(south.vz).toBeGreaterThan(1);
            expect(Math.abs(south.x)).toBeLessThan(Math.abs(east.x));
        });
    });

    describe('spawning event leaves', () => {
        it('does nothing without a reserve', () => {
            const sim = createSim({ count: 40, reserve: 0 });
            const before = snapshot(sim);
            expect(sim.spawn(0, 5, 0, 1, 1, 1)).toBe(-1);
            expect(snapshot(sim)).toEqual(before);
        });

        it('hands out hidden leaves in order and never touches an ambient leaf', () => {
            const sim = createSim({ count: 50, reserve: 20 });
            const ambientState = Array.from(sim.state.subarray(0, sim.ambient));
            const ambientPosition = Array.from(sim.position.subarray(0, sim.ambient * 3));
            const ambientVelocity = Array.from(sim.velocity.subarray(0, sim.ambient * 3));
            const indices = [];
            for (let index = 0; index < 20; index++) {
                indices.push(sim.spawn(index, 7 + index, -index, 1.5, 2.5, -3.5, index % 3));
            }
            expect(indices).toEqual(Array.from({ length: 20 }, (_, index) => 30 + index));
            indices.forEach((index, order) => {
                expect(leaf(sim, index)).toMatchObject({
                    state: LEAF_AIR, x: order, y: 7 + order, z: -order, vx: 1.5, vy: 2.5, vz: -3.5,
                });
                expect(sim.species[index]).toBe(order % 3);
                expect(sim.scale[index]).toBe(1);
                expect(sim.timer[index]).toBe(0);
            });
            // Every reserve leaf is in flight: nothing is stolen from the air or from the ambient set.
            expect(sim.spawn(0, 5, 0, 0, 0, 0)).toBe(-1);
            expect(Array.from(sim.state.subarray(0, sim.ambient))).toEqual(ambientState);
            expect(Array.from(sim.position.subarray(0, sim.ambient * 3))).toEqual(ambientPosition);
            expect(Array.from(sim.velocity.subarray(0, sim.ambient * 3))).toEqual(ambientVelocity);
            expect(sim.counts().idle).toBe(0);
            // The leaves appear with the next step.
            sim.step(STEP);
            for (const index of indices) expect(leaf(sim, index).drawn).toBeGreaterThan(0);
        });

        it('reuses the event leaf that has rested longest once the reserve is exhausted', () => {
            const sim = createSim({ count: 6, reserve: 4 });
            const landed = [];
            for (let index = 0; index < 4; index++) {
                landed.push(sim.spawn(index, 0.03, 0, 0, -1, 0));
                run(sim, 0.1, {}, 0.05);
            }
            expect(landed).toEqual([2, 3, 4, 5]);
            for (const index of landed) expect(sim.state[index]).toBe(LEAF_REST);
            const timers = landed.map((index) => sim.timer[index]);
            expect([...timers].sort((a, b) => b - a)).toEqual(timers);
            // Oldest first, and each reuse is thrown from the new place.
            expect(sim.spawn(9, 5, 1, 0, 0, 0)).toBe(2);
            expect(leaf(sim, 2)).toMatchObject({
                state: LEAF_AIR, x: 9, y: 5, z: 1,
            });
            expect(sim.spawn(9, 5, 1, 0, 0, 0)).toBe(3);
            expect(sim.spawn(9, 5, 1, 0, 0, 0)).toBe(4);
            expect(sim.spawn(9, 5, 1, 0, 0, 0)).toBe(5);
            expect(sim.spawn(9, 5, 1, 0, 0, 0)).toBe(-1);
            for (const index of [0, 1]) expect(sim.state[index]).not.toBe(LEAF_IDLE);
        });

        it('prefers a hidden leaf to one that is lying in view', () => {
            const sim = createSim({ count: 5, reserve: 3 });
            const first = sim.spawn(0, 0.03, 0, 0, -1, 0);
            const second = sim.spawn(1, 0.03, 0, 0, -1, 0);
            run(sim, 0.5);
            expect([sim.state[first], sim.state[second]]).toEqual([LEAF_REST, LEAF_REST]);
            const third = sim.spawn(2, 6, 0, 0, 0, 0);
            expect(third).toBe(4);
            expect([sim.state[first], sim.state[second]]).toEqual([LEAF_REST, LEAF_REST]);
        });
    });

    describe('wind and force fields', () => {
        it('leaves a carpet undisturbed in still air', () => {
            const sim = carpet(200, 6);
            const before = Array.from(sim.position);
            run(sim, 2, {});
            run(sim, 1, { breeze: 2, gust: 1 });
            expect(sim.counts().rest).toBe(200);
            expect(Array.from(sim.position)).toEqual(before);
        });

        it('lifts the leaves inside a burst and throws them outward and up', () => {
            const sim = carpet(400, 8);
            const burst = {
                kind: 'burst', x: 0, y: -0.3, z: 0, radius: 4, power: 24, up: 7,
            };
            const distance = (entry) => Math.hypot(entry.x - burst.x, entry.y - burst.y, entry.z - burst.z);
            sim.step(STEP, { fields: [burst] });
            const lifted = airborne(sim);
            expect(lifted.length).toBeGreaterThan(20);
            for (const entry of lifted) {
                expect(distance(entry)).toBeLessThan(burst.radius);
                expect(entry.vy).toBeGreaterThan(0);
            }
            for (const entry of leaves(sim, (candidate) => candidate.state === LEAF_REST)) {
                // Only the faint rim of the burst leaves anything lying.
                expect(distance(entry)).toBeGreaterThan(burst.radius * 0.5);
            }
            run(sim, 0.2, { fields: [burst] });
            const thrown = airborne(sim);
            expect(thrown.length).toBeGreaterThanOrEqual(lifted.length);
            const outward = thrown.map((entry) => (
                (entry.x * entry.vx + entry.z * entry.vz) / Math.hypot(entry.x, entry.z)));
            expect(mean(outward)).toBeGreaterThan(0);
            expect(mean(thrown.map((entry) => entry.y))).toBeGreaterThan(0.2);
            // Without the field the same leaves come back down.
            run(sim, 6, {});
            expect(sim.counts().air).toBe(0);
            expectHealthy(sim);
        });

        it.each([[1], [-1]])('lifts leaves into a jet and carries them the way it points (dx %i)', (dx) => {
            const sim = carpet(400, 8);
            const start = Array.from(sim.position);
            const jet = {
                kind: 'jet', x: 0, y: 0.5, z: 0, dx, dy: 0.1, dz: 0, radius: 5, power: 16,
            };
            run(sim, 1 / 3, { fields: [jet] });
            const carried = airborne(sim);
            expect(carried.length).toBeGreaterThan(40);
            expect(mean(carried.map((entry) => entry.vx)) * dx).toBeGreaterThan(0.5);
            expect(mean(carried.map((entry) => entry.x - start[entry.index * 3])) * dx).toBeGreaterThan(0);
            expect(Math.abs(mean(carried.map((entry) => entry.vz)))).toBeLessThan(0.5);
            for (const entry of carried) {
                expect(Math.hypot(start[entry.index * 3], start[entry.index * 3 + 2])).toBeLessThan(jet.radius);
            }
            expect(sim.counts().rest).toBeGreaterThan(100);
        });

        it.each([[1], [-1]])('captures leaves in a vortex and turns them the way it spins (turn %i)', (turn) => {
            const sim = carpet(600, 8);
            const vortex = {
                kind: 'vortex',
                x: 0.5,
                z: -1,
                radius: 3.1,
                reach: 4.9,
                top: 6.2,
                spin: 8,
                turn,
                grip: 2.4,
                pull: 2.6,
                lift: 2.8,
            };
            const radial = (entry) => Math.hypot(entry.x - vortex.x, entry.z - vortex.z);
            sim.step(STEP, { fields: [vortex] });
            const captured = new Set(airborne(sim).map((entry) => entry.index));
            expect(captured.size).toBeGreaterThan(60);
            const heights = [];
            for (let second = 0; second < 4; second++) {
                run(sim, 1, { fields: [vortex] });
                const turning = airborne(sim);
                turning.forEach((entry) => captured.add(entry.index));
                // Nothing the column has taken hold of falls out of it while it turns.
                expect(turning).toHaveLength(captured.size);
                for (const entry of turning) {
                    expect(radial(entry)).toBeLessThan(vortex.reach);
                    expect(entry.y).toBeLessThan(vortex.top + 2);
                }
                const circulation = turning.map((entry) => (
                    ((entry.x - vortex.x) * entry.vz - (entry.z - vortex.z) * entry.vx) / radial(entry)));
                expect(mean(circulation) * turn).toBeGreaterThan(1);
                expect(circulation.filter((value) => value * turn > 0).length).toBeGreaterThan(turning.length * 0.9);
                const orbit = mean(turning.map(radial));
                // The ring, not the axis and not the rim: closer to the orbit than to the edge of reach.
                expect(orbit).toBeGreaterThan(vortex.radius * 0.5);
                expect(Math.abs(orbit - vortex.radius)).toBeLessThan(vortex.reach - vortex.radius);
                heights.push(mean(turning.map((entry) => entry.y)));
            }
            // The column climbs.
            for (let index = 1; index < heights.length; index++) {
                expect(heights[index]).toBeGreaterThan(heights[index - 1]);
            }
            // Leaves outside its reach never noticed.
            for (const entry of leaves(sim, (candidate) => !captured.has(candidate.index))) {
                expect(entry.state).not.toBe(LEAF_AIR);
            }
            // When the vortex stops the leaves drop back to the floor.
            run(sim, 12, {});
            expect(sim.counts().air).toBe(0);
            expectHealthy(sim);
        });

        it.each([[1], [-1]])('kicks the leaves under a gust front along its travel (direction %i)', (direction) => {
            const sim = carpet(400, 20);
            const front = {
                x: 2, strength: 1, width: 5, direction,
            };
            sim.step(STEP, { front });
            const near = leaves(sim, (entry) => Math.abs(entry.x - front.x) < front.width * 0.6);
            const far = leaves(sim, (entry) => Math.abs(entry.x - front.x) > front.width * 2.5);
            expect(near.length).toBeGreaterThan(20);
            expect(far.length).toBeGreaterThan(20);
            for (const entry of near) {
                expect(entry.state).toBe(LEAF_AIR);
                expect(entry.vx * direction).toBeGreaterThan(0);
                expect(entry.vy).toBeGreaterThan(0);
            }
            for (const entry of far) expect(entry.state).toBe(LEAF_REST);
            // A faint front stirs nothing.
            const calm = carpet(400, 20);
            run(calm, 0.5, { front: { ...front, strength: 0.2 } });
            expect(calm.counts().rest).toBe(400);
        });

        it('lets strong gusts pick leaves off the floor where gentle wind cannot', () => {
            const everLifted = (env) => {
                const sim = carpet(400, 20);
                const lifted = new Set();
                for (let frame = 0; frame < 180; frame++) {
                    sim.step(STEP, env);
                    airborne(sim).forEach((entry) => lifted.add(entry.index));
                }
                expectHealthy(sim);
                return lifted.size;
            };
            expect(everLifted({ breeze: 1.2, gust: 0.5 })).toBe(0);
            const strong = everLifted({ breeze: 1.2, gust: 4.5 });
            expect(strong).toBeGreaterThan(20);
            // Gusts roll through in swells rather than lifting the whole floor at once.
            expect(strong).toBeLessThan(400);
        });

        it('ignores fields that do not reach a leaf', () => {
            const sim = carpet(100, 3);
            const before = Array.from(sim.position);
            run(sim, 0.5, {
                fields: [
                    {
                        kind: 'burst', x: 40, y: 0, z: 0, radius: 4, power: 50, up: 9,
                    },
                    {
                        kind: 'jet', x: 0, y: 30, z: 0, dx: 1, dy: 0, dz: 0, radius: 5, power: 50,
                    },
                    {
                        kind: 'vortex',
                        x: -40,
                        z: 0,
                        radius: 3,
                        reach: 5,
                        top: 6,
                        spin: 8,
                        turn: 1,
                        grip: 2.4,
                        pull: 2.6,
                        lift: 3,
                    },
                ],
            });
            expect(sim.counts().rest).toBe(100);
            expect(Array.from(sim.position)).toEqual(before);
        });
    });

    describe('bounds and time', () => {
        it('retires leaves that fly out of bounds', () => {
            const bounds = {
                minX: -5, maxX: 5, minZ: -5, maxZ: 5, maxY: 10,
            };
            const sim = createSim({ count: 10, reserve: 4, bounds });
            const sideways = sim.spawn(4.9, 3, 0, 50, 0, 0);
            const upward = sim.spawn(0, 9.9, 0, 0, 50, 0);
            const backward = sim.spawn(0, 3, -4.9, 0, 0, -50);
            const staying = sim.spawn(0, 5, 0, 0, 0, 0);
            sim.step(STEP);
            for (const index of [sideways, upward, backward]) {
                expect(sim.state[index]).toBe(LEAF_IDLE);
                expect(leaf(sim, index).drawn).toBe(0);
            }
            expect(sim.state[staying]).toBe(LEAF_AIR);
        });

        it('starts ambient leaves again inside the bounds when the wind carries them out', () => {
            const bounds = {
                minX: -5, maxX: 5, minZ: -5, maxZ: 5, maxY: 30,
            };
            const sim = createSim({ count: 60, reserve: 0, bounds });
            const problems = [];
            let restarts = 0;
            for (let frame = 0; frame < 600; frame++) {
                const before = leaves(sim);
                sim.step(STEP, { breeze: 8 });
                for (const entry of leaves(sim)) {
                    if (entry.state === LEAF_IDLE) problems.push(`ambient leaf ${entry.index} was hidden`);
                    if (entry.state !== LEAF_AIR) continue;
                    if (Math.abs(entry.x) > 5 || Math.abs(entry.z) > 5 || entry.y > 30) {
                        problems.push(`leaf ${entry.index} flies out of bounds at ${entry.x}, ${entry.y}, ${entry.z}`);
                    }
                    // A restart jumps upwind, against the 8 m/s the leaf was riding.
                    if (before[entry.index].state === LEAF_AIR && entry.x < before[entry.index].x - 1) restarts += 1;
                }
            }
            expect(problems).toEqual([]);
            expect(restarts).toBeGreaterThan(10);
            expectHealthy(sim);
        });

        it('ignores invalid timesteps and clamps long frames to a twentieth of a second', () => {
            const sim = createSim({ count: 80, reserve: 30 });
            sim.spawn(0, 4, 0, 1, 2, 3);
            const before = snapshot(sim);
            for (const dt of [0, -1, NaN, Infinity, -Infinity, undefined, null, '0.016', [], {}]) {
                sim.step(dt, { breeze: 3 });
            }
            expect(snapshot(sim)).toEqual(before);
            const long = createSim({ count: 80, reserve: 30 });
            const short = createSim({ count: 80, reserve: 30 });
            long.spawn(0, 4, 0, 1, 2, 3);
            short.spawn(0, 4, 0, 1, 2, 3);
            long.step(10, { breeze: 3 });
            short.step(0.05, { breeze: 3 });
            expect(long.time).toBe(0.05);
            expect(snapshot(long)).toEqual(snapshot(short));
            long.step(0.02);
            expect(long.time).toBeCloseTo(0.07, 12);
        });

        it('keeps every buffer finite through a long run of gameplay-like events', () => {
            const sim = createSim({
                count: 600, reserve: 230, crownPoints: new Float32Array([-8, 12, 2, 0, 10, 10, -3, 1, -20, 14, -30, 2]),
            });
            const dice = seededRandom(23);
            const fields = [];
            let front = null;
            for (let frame = 0; frame < 30 * 60; frame++) {
                const time = frame / 30;
                if (frame % 45 === 0) {
                    fields.length = 0;
                    const side = dice() < 0.5 ? -1 : 1;
                    for (let throwIndex = 0; throwIndex < 40; throwIndex++) {
                        const speed = side * (3 + dice() * 9);
                        sim.spawn(side * 2.5, 2 + dice() * 5, 6, speed, dice() * 4, (dice() - 0.5) * 4);
                    }
                    fields.push({
                        kind: 'burst', x: side * 2.5, y: 3, z: 6, radius: 4.2, power: 30 * dice() + 6, up: 7,
                    }, {
                        kind: 'jet', x: side * 4, y: 4, z: 6, dx: side, dy: 0.1, dz: 0, radius: 5.2, power: 20 * dice(),
                    });
                    if (dice() < 0.5) {
                        fields.push({
                            kind: 'vortex',
                            x: 0,
                            z: 6.5,
                            radius: 3.5,
                            reach: 5.4,
                            top: 9.9,
                            spin: 11.7,
                            turn: 1,
                            grip: 2.4,
                            pull: 2.6,
                            lift: 4.2,
                        });
                    }
                    front = dice() < 0.5 ? {
                        x: -40, strength: dice(), width: 9, direction: 1,
                    } : null;
                }
                if (front) front.x += 1.5;
                sim.step(1 / 30, {
                    windX: Math.cos(time * 0.1),
                    windZ: Math.sin(time * 0.1),
                    breeze: 1.2,
                    gust: 4.5 * dice(),
                    front,
                    fields,
                });
                if (frame % 60 === 0) expectHealthy(sim);
            }
            expectHealthy(sim);
            expect(sim.time).toBeCloseTo(60, 6);
            const counts = sim.counts();
            expect(counts.air).toBeGreaterThan(0);
            expect(counts.rest).toBeGreaterThan(0);
        });

        it('survives a random source that returns nonsense', () => {
            for (const value of [NaN, Infinity, -Infinity, -1, 2, undefined, 'bad']) {
                const sim = new FallLeafSim({ count: 60, reserve: 20, rng: () => value });
                for (let index = 0; index < 20; index++) sim.spawn(0, 3, 0, 1, 1, 1);
                run(sim, 1, { breeze: 2, gust: 4.5 });
                expectHealthy(sim);
                for (const entry of leaves(sim)) {
                    expect(Math.abs(entry.x)).toBeLessThan(100);
                    expect(Math.abs(entry.z)).toBeLessThan(100);
                }
            }
        });
    });

    describe('render buffers', () => {
        it('writes position, drawn size and a yaw-pitch-roll quaternion for every leaf', () => {
            const sim = createSim({ count: 120, reserve: 40 });
            for (let index = 0; index < 25; index++) sim.spawn(index - 12, 4, 0, 1, 2, -1);
            run(sim, 0.7, { breeze: 2 });
            const expected = new Quaternion();
            const euler = new Euler();
            for (let index = 0; index < sim.count; index++) {
                const o = index * 3;
                const p = index * 4;
                expect(Array.from(sim.outPosition.subarray(p, p + 3)))
                    .toEqual(Array.from(sim.position.subarray(o, o + 3)));
                if (sim.state[index] === LEAF_IDLE) expect(sim.outPosition[p + 3]).toBe(0);
                else expect(sim.outPosition[p + 3]).toBeCloseTo(sim.size[index] * sim.scale[index], 6);
                // angles = yaw, pitch, roll; the quaternion is yaw(Y) * pitch(X) * roll(Z).
                expected.setFromEuler(euler.set(sim.angles[o + 1], sim.angles[o], sim.angles[o + 2], 'YXZ'));
                expect(sim.outRotation[p]).toBeCloseTo(expected.x, 5);
                expect(sim.outRotation[p + 1]).toBeCloseTo(expected.y, 5);
                expect(sim.outRotation[p + 2]).toBeCloseTo(expected.z, 5);
                expect(sim.outRotation[p + 3]).toBeCloseTo(expected.w, 5);
            }
            expectHealthy(sim);
        });

        it('lays resting leaves flat on the ground', () => {
            const sim = createSim({ count: 200, reserve: 0 });
            run(sim, 3, {});
            const normal = new Vector3();
            const turn = new Quaternion();
            const resting = leaves(sim, (entry) => entry.state === LEAF_REST);
            expect(resting.length).toBeGreaterThan(50);
            for (const entry of resting) {
                turn.fromArray(sim.outRotation, entry.index * 4);
                // The blade lies in its local XY plane, so its normal is local Z.
                normal.set(0, 0, 1).applyQuaternion(turn);
                expect(Math.abs(normal.y)).toBeGreaterThan(0.9);
            }
        });

        it('reproduces the same flight for the same seed and a different one for another', () => {
            const fly = (seed) => {
                const sim = createSim({ count: 300, reserve: 110, seed });
                const env = (time) => ({
                    breeze: 1.5,
                    gust: 3 * Math.abs(Math.sin(time)),
                    fields: time < 1 ? [{
                        kind: 'burst', x: 0, y: 0, z: 0, radius: 6, power: 20, up: 6,
                    }] : [],
                });
                for (let index = 0; index < 60; index++) sim.spawn(index * 0.1, 3, 0, 2, 1, 0);
                run(sim, 4, env);
                return snapshot(sim);
            };
            const first = fly(31);
            expect(fly(31)).toEqual(first);
            expect(fly(32).outPosition).not.toEqual(first.outPosition);
        });

        it('returns to its opening state on reset', () => {
            const sim = createSim({ count: 200, reserve: 70 });
            for (let index = 0; index < 70; index++) sim.spawn(0, 3, 0, 4, 2, 0);
            run(sim, 2, { breeze: 3, gust: 4.5 });
            expect(sim.counts().idle).toBeLessThan(70);
            sim.reset();
            expect(sim.time).toBe(0);
            const counts = sim.counts();
            expect(counts.idle).toBe(70);
            expect(counts.fade).toBe(0);
            expect(counts.air + counts.rest).toBe(130);
            for (const entry of leaves(sim)) {
                if (entry.index >= sim.ambient) expect(entry).toMatchObject({ state: LEAF_IDLE, drawn: 0 });
                else {
                    expect([LEAF_AIR, LEAF_REST]).toContain(entry.state);
                    expect(entry.drawn).toBeGreaterThan(0);
                }
            }
            // The reserve is handed out from its first leaf again.
            expect(sim.spawn(0, 3, 0, 0, 0, 0)).toBe(sim.ambient);
            expectHealthy(sim);
        });
    });
});

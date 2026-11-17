import { describe, expect, it } from 'vitest';
import { SUMMER_PARTICLES, SummerPetalSim } from '../../src/themes/summer/summer-petal-sim.js';

const STEP = 1 / 60;
const FLOWER_KINDS = 7;
const {
    petal: PETAL, seed: SEED, pollen: POLLEN, glow: GLOW,
} = SUMMER_PARTICLES;
/** Open water everywhere, as the simulation assumes when it is told nothing. */
const LAKE = () => -1;
/** A meadow half a metre above the lake. */
const MEADOW_HEIGHT = 0.5;
const MEADOW = () => MEADOW_HEIGHT;
/** Still air: no breeze and no gust, so only weight and the particle's own flutter act. */
const STILL = Object.freeze({ wind: 0, gust: 0 });

function seededRandom(seed = 271) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function create({ seed = 271, ...options } = {}) {
    return new SummerPetalSim({
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

/** Indices of the event particles that are in the air. */
function aloft(sim) {
    const result = [];
    for (let index = sim.ambient; index < sim.count; index++) if (sim.life[index] > 0) result.push(index);
    return result;
}

/** What the renderer is given for one particle. */
function drawn(sim, index) {
    const o = index * 4;
    return {
        x: sim.outPlace[o],
        y: sim.outPlace[o + 1],
        z: sim.outPlace[o + 2],
        size: sim.outPlace[o + 3],
        flower: sim.outLook[o],
        kind: sim.outLook[o + 1],
        spin: sim.outLook[o + 2],
        light: sim.outLook[o + 3],
    };
}

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** The largest distance between the same drawn particle in two simulations, over `from` .. `to`. */
function apart(a, b, from, to) {
    let worst = 0;
    for (let index = from; index < to; index++) {
        const [p, q] = [drawn(a, index), drawn(b, index)];
        worst = Math.max(worst, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z));
    }
    return worst;
}

/** A particle no field reached flies exactly as its twin does. */
function expectUntouched(pushed, free, index) {
    for (const name of ['x', 'y', 'z', 'vx', 'vy', 'vz']) expect(pushed[name][index], name).toBe(free[name][index]);
}

/** The wheel a combo winds around the board, in the terms the simulation reads. */
function crownField({
    x = 0, z = 0, turn = 1, top = 30,
} = {}) {
    return {
        kind: 'vortex', x, z, radius: 3, reach: 8, top, spin: 2, turn, grip: 3, pull: 9, lift: 2.5,
    };
}

/** Radius, height and angular velocity of every particle in the air about a field's axis. */
function orbit(sim, field) {
    return aloft(sim).map((index) => {
        const dx = sim.x[index] - field.x;
        const dz = sim.z[index] - field.z;
        const radius = Math.hypot(dx, dz);
        return { radius, y: sim.y[index], turning: (dx * sim.vz[index] - dz * sim.vx[index]) / (radius * radius) };
    });
}

describe('Summer petal simulation', () => {
    describe('construction', () => {
        it('names the four kinds of particle', () => {
            expect(Object.isFrozen(SUMMER_PARTICLES)).toBe(true);
            // Three things that fly, and a light that stays where it was lit.
            expect(Object.keys(SUMMER_PARTICLES).sort()).toEqual(['glow', 'petal', 'pollen', 'seed']);
            expect(new Set(Object.values(SUMMER_PARTICLES)).size).toBe(4);
            // A petal is what a particle is when nothing says otherwise: a cleared slot reads as one.
            expect(PETAL).toBe(0);
            // Stored in a byte and handed to the shader as a number.
            for (const kind of Object.values(SUMMER_PARTICLES)) {
                expect(Number.isInteger(kind) && kind >= 0 && kind < 256).toBe(true);
            }
        });

        it('sizes every buffer from the count and splits it into ambient down and a hidden reserve', () => {
            const sim = create();
            expect(sim).toMatchObject({ count: 60, reserve: 40, ambient: 20 });
            for (const name of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'life', 'span', 'kind', 'flower', 'size', 'spin',
                'seed', 'hang', 'shine']) {
                expect(sim[name], name).toHaveLength(60);
            }
            expect(sim.home).toHaveLength(20 * 3);
            expect(sim.outPlace).toHaveLength(60 * 4);
            expect(sim.outLook).toHaveLength(60 * 4);
            expect(sim.outPlace).toBeInstanceOf(Float32Array);
            expect(sim.outLook).toBeInstanceOf(Float32Array);
            expect(sim.touches.length).toBeGreaterThanOrEqual(1);
            expect(sim.touchCount).toBe(0);
            expect(sim.counts()).toEqual({ ambient: 20, reserve: 40, live: 0 });
            expectFinite(sim);
        });

        it('clamps the count and the reserve into a usable pool', () => {
            for (const [options, count] of [[{ count: 10, reserve: 100 }, 10], [{ count: 10, reserve: 0 }, 10],
                [{ count: 10, reserve: -4 }, 10], [{ count: 1, reserve: 1 }, 2], [{ count: 0, reserve: 0 }, 2],
                [{ count: -50, reserve: 3 }, 2], [{ count: 5.9, reserve: 2.9 }, 5], [{ count: 9, reserve: 8.2 }, 9]]) {
                const sim = new SummerPetalSim({ ...options, rng: seededRandom(3) });
                expect(sim.count, JSON.stringify(options)).toBe(count);
                // Always at least one of each, and nothing left over.
                expect(sim.reserve).toBeGreaterThanOrEqual(1);
                expect(sim.ambient).toBeGreaterThanOrEqual(1);
                expect(sim.ambient + sim.reserve).toBe(sim.count);
                expect(sim.spawn(0, 2, 0, 0, 0, 0)).toBeGreaterThanOrEqual(sim.ambient);
                run(sim, 0.2);
                expectFinite(sim);
            }
            // Left to itself it builds a pool with both kinds in it.
            const plain = new SummerPetalSim();
            expect(plain.ambient).toBeGreaterThan(0);
            expect(plain.reserve).toBeGreaterThan(0);
            expect(plain.counts().live).toBe(0);
        });

        it('opens with the down adrift about its homes and the reserve hidden', () => {
            const sim = create();
            for (let index = 0; index < sim.count; index++) {
                const particle = drawn(sim, index);
                if (index < sim.ambient) {
                    expect(particle.size).toBeGreaterThan(0);
                    expect(particle.light).toBeGreaterThan(0);
                    expect(particle.kind).toBe(SEED);
                    // Above the lake, and never far from where it keeps house.
                    expect(particle.y).toBeGreaterThan(0);
                    const home = sim.home.subarray(index * 3, index * 3 + 3);
                    expect(Math.hypot(particle.x - home[0], particle.y - home[1], particle.z - home[2]))
                        .toBeLessThan(5);
                } else {
                    expect(particle.size).toBe(0);
                    expect(particle.light).toBe(0);
                }
                // What picks a colour from the palette is a whole number the palette has.
                expect(Number.isInteger(particle.flower) && particle.flower >= 0 && particle.flower <= FLOWER_KINDS)
                    .toBe(true);
            }
        });

        it('keeps house at the homes it is given', () => {
            const homes = new Float32Array([-40, 3, 10, 55, 6, -80]);
            const sim = create({ homes });
            const used = new Set();
            for (let index = 0; index < sim.ambient; index++) {
                const [x, y, z] = sim.home.subarray(index * 3, index * 3 + 3);
                const nearest = [0, 1].map((home) => Math.hypot(
                    x - homes[home * 3],
                    y - homes[home * 3 + 1],
                    z - homes[home * 3 + 2],
                ));
                expect(Math.min(...nearest)).toBeLessThan(2);
                used.add(nearest[0] < nearest[1] ? 0 : 1);
            }
            // Both are lived in, and no two tufts sit on exactly the same spot.
            expect(used.size).toBe(2);
            expect(new Set(Array.from({ length: sim.ambient }, (_, index) => sim.home[index * 3])).size)
                .toBe(sim.ambient);
            // Too little to be a home, or none at all: it spreads the down out by itself.
            for (const given of [null, undefined, [], new Float32Array(2)]) {
                const loose = create({ homes: given });
                expect(allFinite(loose.home)).toBe(true);
                const xs = Array.from({ length: loose.ambient }, (_, index) => loose.home[index * 3]);
                expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(5);
                for (let index = 0; index < loose.ambient; index++) {
                    expect(loose.home[index * 3 + 1]).toBeGreaterThan(0);
                }
            }
        });
    });

    describe('throwing petals', () => {
        it('releases reserve particles in turn and never touches the down', () => {
            const sim = create();
            const down = snapshot(sim);
            const indices = [];
            for (let count = 0; count < 12; count++) {
                indices.push(sim.spawn(count, 20 + count, -count, 1, 2, 3, { life: 4, flower: count % FLOWER_KINDS }));
            }
            expect(new Set(indices).size).toBe(12);
            for (const index of indices) {
                expect(index).toBeGreaterThanOrEqual(sim.ambient);
                expect(index).toBeLessThan(sim.count);
            }
            indices.forEach((index, count) => {
                expect([sim.x[index], sim.y[index], sim.z[index]]).toEqual([count, 20 + count, -count]);
                expect([sim.vx[index], sim.vy[index], sim.vz[index]]).toEqual([1, 2, 3]);
                expect(sim.life[index]).toBe(4);
                expect(sim.span[index]).toBe(4);
                expect(sim.flower[index]).toBe(count % FLOWER_KINDS);
                expect(sim.kind[index]).toBe(PETAL);
            });
            expect(sim.counts().live).toBe(12);
            for (const name of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'life']) {
                expect(Array.from(sim[name].subarray(0, sim.ambient)), name).toEqual(down[name].slice(0, sim.ambient));
            }
            // Drawn from the next frame on.
            sim.step(STEP, STILL);
            for (const index of indices) expect(drawn(sim, index).light).toBeGreaterThan(0);
        });

        it('clamps life and size, falls back for nonsense and refuses a particle it cannot place', () => {
            const sim = create();
            const before = snapshot(sim);
            for (const bad of [NaN, Infinity, -Infinity, undefined, null, '1', {}]) {
                for (let slot = 0; slot < 6; slot++) {
                    const args = [0, 5, 0, 0, 0, 0];
                    args[slot] = bad;
                    expect(sim.spawn(...args), `${String(bad)} in ${slot}`).toBe(-1);
                }
            }
            expect(snapshot(sim)).toEqual(before);
            expect(sim.counts().live).toBe(0);

            const thrown = (options) => {
                const index = sim.spawn(0, 20, 0, 0, 0, 0, options);
                return {
                    life: sim.life[index], span: sim.span[index], size: sim.size[index], kind: sim.kind[index],
                };
            };
            const plain = thrown();
            expect(plain.life).toBeGreaterThan(0);
            expect(plain.size).toBeGreaterThan(0);
            expect(plain.kind).toBe(PETAL);
            // A life too short to see is lengthened; one that is no number is an ordinary one.
            const brief = thrown({ life: 1e-6 });
            expect(brief.life).toBeGreaterThan(0.05);
            expect(thrown({ life: -3 }).life).toBe(brief.life);
            for (const life of [NaN, Infinity, 'long', null]) expect(thrown({ life }).life).toBe(plain.life);
            expect(thrown({ life: 7 })).toMatchObject({ life: 7, span: 7 });
            // Size is kept between a speck and a handful.
            const speck = thrown({ size: 0 }).size;
            const handful = thrown({ size: 1e6 }).size;
            expect(speck).toBeGreaterThan(0);
            expect(handful).toBeGreaterThan(speck);
            expect(handful).toBeLessThan(2);
            expect(thrown({ size: -1 }).size).toBe(speck);
            for (const size of [NaN, Infinity, 'big', null]) expect(thrown({ size }).size).toBe(plain.size);
            // Only the four kinds exist.
            expect(thrown({ kind: SEED }).kind).toBe(SEED);
            expect(thrown({ kind: POLLEN }).kind).toBe(POLLEN);
            expect(thrown({ kind: GLOW }).kind).toBe(GLOW);
            const unknown = Math.max(...Object.values(SUMMER_PARTICLES)) + 1;
            for (const kind of [-1, unknown, 99, 2.5, NaN, 'seed', 'glow', null]) {
                expect(thrown({ kind }).kind, String(kind)).toBe(PETAL);
            }
            // A glow is a light, metres across: its size has a ceiling of its own, far above a
            // petal's, and the same floor.
            const light = thrown({ kind: GLOW, size: 1e6 }).size;
            expect(light).toBeGreaterThan(handful * 4);
            expect(light).toBeLessThanOrEqual(20);
            expect(thrown({ kind: GLOW, size: 3.5 }).size).toBe(3.5);
            expect(thrown({ kind: GLOW, size: 0 }).size).toBe(speck);
            for (const kind of [PETAL, SEED, POLLEN]) expect(thrown({ kind, size: 3.5 }).size).toBe(handful);
            expectFinite(sim);
        });

        it('keeps the flower it is given and picks one of the seven when it is given none', () => {
            const sim = create({ count: 420, reserve: 400 });
            for (let kind = 0; kind < FLOWER_KINDS; kind++) {
                expect(sim.flower[sim.spawn(0, 20, 0, 0, 0, 0, { flower: kind })]).toBe(kind);
            }
            const picked = new Set();
            for (const flower of [-1, FLOWER_KINDS, 99, 2.5, NaN, '3', null, undefined]) {
                for (let count = 0; count < 40; count++) {
                    const kind = sim.flower[sim.spawn(0, 20, 0, 0, 0, 0, { flower })];
                    expect(kind).toBeGreaterThanOrEqual(0);
                    expect(kind).toBeLessThan(FLOWER_KINDS);
                    picked.add(kind);
                }
            }
            // Mixed petals really are mixed.
            expect(picked.size).toBe(FLOWER_KINDS);
            // A glow may also be lit in the pale colour of seed down, the eighth of the palette;
            // nothing that flies may, and no light has a ninth.
            const lit = (flower, kind = GLOW) => sim.flower[sim.spawn(0, 20, 0, 0, 0, 0, { flower, kind })];
            for (let kind = 0; kind <= FLOWER_KINDS; kind++) expect(lit(kind)).toBe(kind);
            for (const kind of [PETAL, SEED, POLLEN]) expect(lit(FLOWER_KINDS, kind)).toBeLessThan(FLOWER_KINDS);
            for (const flower of [FLOWER_KINDS + 1, -1, 99, 6.5, NaN, null]) {
                expect(lit(flower), String(flower)).toBeLessThan(FLOWER_KINDS);
            }
        });

        it('takes the particle nearest its end when the whole reserve is in the air', () => {
            const sim = create({ count: 12, reserve: 8 });
            const lives = [6, 9, 4, 8, 2.5, 7, 5, 10];
            const indices = lives.map((life) => sim.spawn(0, 20, 0, 0, 0, 0, { life }));
            expect(new Set(indices).size).toBe(8);
            expect(sim.counts().live).toBe(8);
            // The pool is full: the next ones replace those with the least life left, in that order.
            const order = [...lives].sort((a, b) => a - b);
            for (let extra = 0; extra < 3; extra++) {
                const index = sim.spawn(1, 21, 1, 0, 0, 0, { life: 30 });
                expect(indices).toContain(index);
                expect(lives[indices.indexOf(index)]).toBe(order[extra]);
                expect(sim.life[index]).toBe(30);
                expect(sim.counts().live).toBe(8);
            }
        });

        it('prefers a free particle to one that is still in the air', () => {
            const sim = create({ count: 12, reserve: 8 });
            const indices = [5, 5, 0.3, 5, 5, 5, 5, 5].map((life) => sim.spawn(0, 20, 0, 0, 0, 0, { life }));
            run(sim, 0.5, STILL);
            expect(sim.counts().live).toBe(7);
            const lives = indices.map((index) => sim.life[index]);
            const index = sim.spawn(0, 20, 0, 0, 0, 0, { life: 9 });
            expect(index).toBe(indices[2]);
            indices.forEach((other, slot) => { if (slot !== 2) expect(sim.life[other]).toBe(lives[slot]); });
            expect(sim.counts().live).toBe(8);
        });

        it('never grows past the reserve however many are thrown', () => {
            const sim = create();
            const owned = buffers(sim);
            for (let count = 0; count < sim.reserve * 10; count++) {
                const index = sim.spawn(count % 7, 20, 0, 0, 0, 0, { life: 3 + (count % 5) });
                expect(index).toBeGreaterThanOrEqual(sim.ambient);
                expect(index).toBeLessThan(sim.count);
                if (count % 17 === 0) sim.step(STEP, STILL);
            }
            expect(sim.counts()).toEqual({ ambient: 20, reserve: 40, live: 40 });
            for (const [name, array] of Object.entries(buffers(sim))) expect(array, name).toBe(owned[name]);
            expectFinite(sim);
        });
    });

    describe('life', () => {
        it('shows a petal at once, shrinks it away at the end of its life and then hides it', () => {
            const sim = create();
            const index = sim.spawn(0, 30, 0, 0, 0, 0, { life: 2, size: 0.1 });
            const sizes = [];
            for (let frame = 0; frame < 150; frame++) {
                sim.step(STEP, STILL);
                sizes.push(drawn(sim, index).size);
            }
            // Full size within a few frames ...
            const full = Math.max(...sizes);
            expect(full).toBeCloseTo(0.1, 6);
            expect(sizes[0]).toBeGreaterThan(0);
            expect(sizes.indexOf(full)).toBeLessThan(12);
            // ... held through the middle of its life, then smaller every frame until it has gone.
            expect(sizes[60]).toBe(full);
            const last = sizes.findIndex((size, frame) => frame > 60 && size === 0);
            expect(last / 60).toBeCloseTo(2, 1);
            const shrinking = sizes.slice(sizes.lastIndexOf(full), last + 1);
            expect(shrinking.length).toBeGreaterThan(5);
            for (let frame = 1; frame < shrinking.length; frame++) {
                expect(shrinking[frame]).toBeLessThan(shrinking[frame - 1]);
            }
            expect(sizes.slice(last).every((size) => size === 0)).toBe(true);
            expect(drawn(sim, index).light).toBe(0);
            expect(sim.life[index]).toBeLessThanOrEqual(0);
            expect(sim.counts().live).toBe(0);
        });

        it('keeps seed and pollen whole and lets their light go instead', () => {
            for (const kind of [SEED, POLLEN]) {
                const sim = create();
                const index = sim.spawn(0, 30, 0, 0, 0, 0, { life: 2, size: 0.1, kind });
                run(sim, 1, STILL);
                const middle = drawn(sim, index);
                run(sim, 0.9, STILL);
                const late = drawn(sim, index);
                expect(sim.life[index]).toBeGreaterThan(0);
                expect(late.size).toBe(middle.size);
                expect(late.size).toBeCloseTo(0.1, 6);
                expect(late.light).toBeLessThan(middle.light);
                expect(late.kind).toBe(kind);
                run(sim, 0.3, STILL);
                expect(drawn(sim, index)).toMatchObject({ size: 0, light: 0 });
            }
        });

        it('lets a petal fall while seed and pollen drift up, lighter than air', () => {
            const sim = create({ count: 140, reserve: 120 });
            const thrown = { [PETAL]: [], [SEED]: [], [POLLEN]: [] };
            for (let count = 0; count < 30; count++) {
                for (const kind of [PETAL, SEED, POLLEN]) {
                    thrown[kind].push(sim.spawn(count, 20, 0, 0, 0, 0, { life: 9, kind }));
                }
            }
            run(sim, 2, STILL);
            for (const index of thrown[PETAL]) expect(sim.y[index]).toBeLessThan(20);
            for (const index of thrown[SEED]) expect(sim.y[index]).toBeGreaterThan(20);
            for (const index of thrown[POLLEN]) expect(sim.y[index]).toBeGreaterThan(20);
            // A petal side-slips as it comes down: no two take the same path.
            const drift = thrown[PETAL].map((index, count) => sim.x[index] - count);
            expect(new Set(drift.map((value) => value.toFixed(3))).size).toBeGreaterThan(20);
            expect(Math.max(...drift.map(Math.abs))).toBeGreaterThan(0.05);
        });

        it.each([
            [1, 0], [-1, 0], [0, 1], [0, -1],
        ])('carries everything down a wind blowing (%i, %i)', (windX, windZ) => {
            const fly = (env) => {
                const sim = create({ count: 110, reserve: 90 });
                for (let count = 0; count < 30; count++) {
                    for (const kind of [PETAL, SEED, POLLEN]) sim.spawn(0, 20, 0, 0, 0, 0, { life: 9, kind });
                }
                run(sim, 2, env);
                const along = aloft(sim).map((index) => sim.x[index] * windX + sim.z[index] * windZ);
                return { mean: mean(along), least: Math.min(...along) };
            };
            const breeze = fly({
                windX, windZ, wind: 0.5, gust: 0,
            });
            const gust = fly({
                windX, windZ, wind: 0.5, gust: 1,
            });
            const calm = fly({
                windX, windZ, wind: 0, gust: 1,
            });
            expect(breeze.mean).toBeGreaterThan(0.2);
            // A gust carries them further on the same breeze, but there is nothing to gust in dead air.
            expect(gust.mean).toBeGreaterThan(breeze.mean * 1.5);
            expect(gust.least).toBeGreaterThan(0);
            expect(Math.abs(calm.mean)).toBeLessThan(breeze.mean);
        });

        it('sinks everything and wears it out sooner once the evening has settled', () => {
            const fly = (settled) => {
                const sim = create();
                const seed = sim.spawn(0, 20, 0, 0, 0, 0, { life: 4, kind: SEED });
                const pollen = sim.spawn(2, 20, 0, 0, 0, 0, { life: 4, kind: POLLEN });
                const petal = sim.spawn(4, 20, 0, 0, 0, 0, { life: 4 });
                run(sim, 2, { ...STILL, settled });
                return {
                    sim, seed: sim.y[seed], pollen: sim.y[pollen], petal: sim.y[petal], life: sim.life[petal],
                };
            };
            const playing = fly(false);
            const over = fly(true);
            expect(over.seed).toBeLessThan(20);
            expect(over.pollen).toBeLessThan(20);
            expect(over.petal).toBeLessThan(playing.petal);
            expect(over.life).toBeLessThan(playing.life);
            // Anything but `true` is still play.
            for (const settled of ['true', 1, {}, null]) expect(fly(settled).seed).toBe(playing.seed);
            // Wears out sooner: by three seconds the settled ones have gone, the others have a second left.
            run(over.sim, 1, { ...STILL, settled: true });
            run(playing.sim, 1, STILL);
            expect(over.sim.counts().live).toBe(0);
            expect(playing.sim.counts().live).toBe(3);
        });

        it('tumbles a particle as it flies, the faster the more', () => {
            const sim = create();
            const slow = sim.spawn(0, 30, 0, 0, 0, 0, { life: 9 });
            const fast = sim.spawn(5, 30, 0, 40, 0, 0, { life: 9 });
            const start = [sim.spin[slow], sim.spin[fast]];
            run(sim, 0.25, STILL);
            const turned = [Math.abs(sim.spin[slow] - start[0]), Math.abs(sim.spin[fast] - start[1])];
            expect(turned[0]).toBeGreaterThan(0);
            expect(turned[1]).toBeGreaterThan(turned[0] * 2);
            expect(drawn(sim, fast).spin).toBe(sim.spin[fast]);
        });
    });

    describe('water and grass', () => {
        it('takes a petal that touches the lake and records where it went in', () => {
            const sim = create({ groundHeight: LAKE });
            const index = sim.spawn(3, 0.6, -7, 0.4, -1, 0.2, { life: 30 });
            let touched = null;
            for (let frame = 0; frame < 240 && !touched; frame++) {
                const above = sim.y[index];
                sim.step(STEP, STILL);
                if (sim.touchCount > 0) touched = { frame, above, touch: { ...sim.touches[0] } };
                // Until then it is in the air, alive, and has said nothing.
                else expect(sim.life[index]).toBeGreaterThan(0);
            }
            expect(touched).not.toBeNull();
            expect(sim.touchCount).toBe(1);
            // It was just above the water a frame earlier, and went in where the touch says.
            expect(touched.above).toBeGreaterThan(0);
            expect(touched.above).toBeLessThan(0.2);
            expect(touched.touch.x).toBeCloseTo(sim.x[index], 5);
            expect(touched.touch.z).toBeCloseTo(sim.z[index], 5);
            expect(Math.hypot(touched.touch.x - 3, touched.touch.z + 7)).toBeLessThan(1.5);
            expect(touched.touch.strength).toBeGreaterThan(0);
            expect(touched.touch.strength).toBeLessThan(1);
            expect(sim.life[index]).toBe(0);
            expect(drawn(sim, index)).toMatchObject({ size: 0, light: 0 });
            // One frame's news: the next frame reports nothing.
            sim.step(STEP, STILL);
            expect(sim.touchCount).toBe(0);
            expect(sim.counts().live).toBe(0);
        });

        it('rations the rings: every petal that lands dies, but touches are a cooldown apart', () => {
            const sim = create({ count: 140, reserve: 120, groundHeight: LAKE });
            // A long shower: petals from a hand's breadth to a few metres above the water.
            for (let count = 0; count < 120; count++) {
                sim.spawn(count * 0.3, 0.05 + count * 0.02, 0, 0, -0.5, 0, { life: 30 });
            }
            const touches = [];
            let landed = 0;
            for (let frame = 0; frame < 60 * 12 && sim.counts().live > 0; frame++) {
                const before = sim.counts().live;
                const cooling = sim.touchCooldown - STEP > 0;
                sim.step(STEP, STILL);
                landed += before - sim.counts().live;
                expect(sim.touchCount).toBeLessThanOrEqual(sim.touches.length);
                // While the last ring is still young the lake is not asked for another.
                if (cooling) expect(sim.touchCount).toBe(0);
                if (sim.touchCount > 0) {
                    expect(before - sim.counts().live).toBeGreaterThan(0);
                    expect(sim.touchCooldown).toBeGreaterThan(STEP);
                    touches.push(frame);
                }
            }
            expect(sim.counts().live).toBe(0);
            expect(landed).toBe(120);
            // Several rings over the shower, far fewer than petals, never in consecutive frames.
            expect(touches.length).toBeGreaterThan(3);
            expect(touches.length).toBeLessThan(landed / 2);
            for (let index = 1; index < touches.length; index++) {
                expect(touches[index] - touches[index - 1]).toBeGreaterThan(2);
            }
        });

        it('loses a petal that comes down in the grass, quickly, without letting it through the ground', () => {
            const sim = create({ groundHeight: MEADOW });
            const landing = sim.spawn(0, MEADOW_HEIGHT + 0.8, 0, 0.5, -1, 0.5, { life: 20 });
            const flying = sim.spawn(0, 40, 0, 0.5, -1, 0.5, { life: 20 });
            let lowest = Infinity;
            let gone = null;
            let left = null;
            for (let frame = 0; frame < 60 * 15; frame++) {
                sim.step(STEP, STILL);
                if (sim.life[landing] > 0) lowest = Math.min(lowest, sim.y[landing]);
                else if (gone === null) {
                    gone = frame / 60;
                    left = sim.life[flying];
                }
                // Grass is not water: it leaves no ring.
                expect(sim.touchCount).toBe(0);
            }
            expect(lowest).toBeGreaterThanOrEqual(MEADOW_HEIGHT);
            expect(lowest).toBeLessThan(MEADOW_HEIGHT + 0.2);
            // Lost among the blades long before its twenty seconds were up, while its twin flew on
            // with most of its life ahead of it.
            expect(gone).not.toBeNull();
            expect(gone).toBeGreaterThan(0.3);
            expect(gone).toBeLessThan(10);
            expect(left).toBeGreaterThan(10);
            expect(left).toBeCloseTo(20 - gone, 1);
        });

        it('tells meadow from lake by the ground under each particle', () => {
            // A shore along x = 0: lake to the left, meadow to the right.
            const sim = create({ groundHeight: (x) => (x < 0 ? -1 : MEADOW_HEIGHT) });
            const overLake = sim.spawn(-4, 0.4, 0, 0, -1, 0, { life: 30 });
            const overMeadow = sim.spawn(4, MEADOW_HEIGHT + 0.4, 0, 0, -1, 0, { life: 30 });
            const touches = [];
            for (let frame = 0; frame < 120; frame++) {
                sim.step(STEP, STILL);
                for (let index = 0; index < sim.touchCount; index++) touches.push({ ...sim.touches[index] });
            }
            expect(touches).toHaveLength(1);
            expect(touches[0].x).toBeLessThan(0);
            expect(sim.life[overLake]).toBe(0);
            expect(sim.life[overMeadow]).toBeGreaterThan(0);
            expect(sim.y[overMeadow]).toBeGreaterThanOrEqual(MEADOW_HEIGHT);
        });

        it('takes the lake to lie under everything when it is told nothing about the ground', () => {
            const sim = new SummerPetalSim({ count: 20, reserve: 10, rng: seededRandom(5) });
            const index = sim.spawn(0, 0.3, 0, 0, -1, 0, { life: 30 });
            let touches = 0;
            for (let frame = 0; frame < 120; frame++) {
                sim.step(STEP, STILL);
                touches += sim.touchCount;
            }
            expect(touches).toBe(1);
            expect(sim.life[index]).toBe(0);
        });
    });

    describe('force fields', () => {
        /** Two identical flights, one of them through `fields`. */
        function twins(place, fields, seconds, kind = PETAL) {
            const [free, pushed] = [create(), create()];
            const indices = place.map(([x, y, z]) => {
                free.spawn(x, y, z, 0, 0, 0, { life: 20, kind });
                return pushed.spawn(x, y, z, 0, 0, 0, { life: 20, kind });
            });
            run(free, seconds, STILL);
            run(pushed, seconds, { ...STILL, fields });
            return { free, pushed, indices };
        }

        it('throws the particles inside a burst outward and up, and no others', () => {
            const centre = { x: 2, y: 20, z: -3 };
            const inside = [[3, 20, -3], [1, 20.5, -3], [2, 19.6, -2], [2.5, 20.4, -4]];
            const outside = [[8, 20, -3], [2, 27, -3], [2, 20, 4]];
            const burst = (up) => [{
                kind: 'burst', ...centre, radius: 4, power: 20, up,
            }];
            const { free, pushed, indices } = twins([...inside, ...outside], burst(6), 0.4);
            const level = twins([...inside, ...outside], burst(0), 0.4).pushed;
            const from = (sim, index) => Math.hypot(
                sim.x[index] - centre.x,
                sim.y[index] - centre.y,
                sim.z[index] - centre.z,
            );
            inside.forEach((_place, slot) => {
                const index = indices[slot];
                expect(from(pushed, index)).toBeGreaterThan(from(free, index) + 0.3);
                expect(from(level, index)).toBeGreaterThan(from(free, index) + 0.3);
                // The lift is on top of the push away from the middle.
                expect(pushed.y[index]).toBeGreaterThan(level.y[index]);
            });
            outside.forEach((_place, slot) => {
                const index = indices[inside.length + slot];
                expectUntouched(pushed, free, index);
            });
        });

        it.each([[1], [-1]])('carries particles along a jet pointing %i and leaves the rest', (side) => {
            const inside = [[0, 20, 0], [1, 20.5, 0.5], [-1, 19.5, -1]];
            const outside = [[9, 20, 0], [0, 30, 0]];
            const { free, pushed, indices } = twins([...inside, ...outside], [{
                kind: 'jet', x: 0, y: 20, z: 0, dx: side, dy: 0.2, dz: 0, radius: 5, power: 16,
            }], 0.4);
            inside.forEach((_place, slot) => {
                const index = indices[slot];
                expect((pushed.x[index] - free.x[index]) * side).toBeGreaterThan(0.3);
                expect((pushed.vx[index] - free.vx[index]) * side).toBeGreaterThan(0);
                expect(pushed.y[index]).toBeGreaterThan(free.y[index]);
                expect(pushed.z[index]).toBeCloseTo(free.z[index], 5);
            });
            outside.forEach((_place, slot) => {
                const index = indices[inside.length + slot];
                expectUntouched(pushed, free, index);
            });
        });

        it('pushes harder near the middle of a field than at its edge', () => {
            const { free, pushed, indices } = twins([[0.5, 20, 0], [3.5, 20, 0]], [{
                kind: 'jet', x: 0, y: 20, z: 0, dx: 0, dy: 0, dz: 1, radius: 4, power: 16,
            }], 0.1);
            const [near, far] = indices.map((index) => pushed.vz[index] - free.vz[index]);
            expect(far).toBeGreaterThan(0);
            expect(near).toBeGreaterThan(far * 3);
        });

        it.each([[1], [-1]])('gathers petals at rest into the orbit and turns them the way it spins (%i)', (turn) => {
            const field = crownField({ turn });
            const random = seededRandom(9);
            const place = Array.from({ length: 36 }, () => {
                const angle = random() * Math.PI * 2;
                const radius = 0.8 + random() * 6;
                return [Math.cos(angle) * radius, field.top - 3 + random() * 6, Math.sin(angle) * radius];
            });
            const spread = (sim) => {
                const ring = orbit(sim, field);
                return {
                    radius: mean(ring.map((particle) => Math.abs(particle.radius - field.radius))),
                    height: mean(ring.map((particle) => Math.abs(particle.y - field.top))),
                    turning: ring.map((particle) => particle.turning),
                    count: ring.length,
                };
            };
            const start = create();
            place.forEach(([x, y, z]) => start.spawn(x, y, z, 0, 0, 0, { life: 20 }));
            const before = spread(start);
            const { free, pushed } = twins(place, [field], 5);
            const [loose, wound] = [spread(free), spread(pushed)];
            expect(wound.count).toBe(36);
            // Drawn onto the wheel's radius and up to its height ...
            expect(wound.radius).toBeLessThan(before.radius * 0.5);
            expect(wound.height).toBeLessThan(before.height * 0.5);
            expect(wound.radius).toBeLessThan(loose.radius);
            expect(wound.height).toBeLessThan(loose.height);
            // ... and all going round the same way, near the rate the wheel turns at.
            for (const turning of wound.turning) expect(turning * turn).toBeGreaterThan(0);
            expect(mean(wound.turning) * turn).toBeGreaterThan(field.spin * 0.5);
            expect(mean(wound.turning) * turn).toBeLessThan(field.spin * 1.5);
        });

        it('lets go of what is outside a vortex or far above its column', () => {
            const field = crownField({ top: 20 });
            const outside = [[field.reach + 1, 20, 0], [0, 20, -field.reach - 3], [1, 60, 1]];
            const { free, pushed, indices } = twins([[2, 20, 0], ...outside], [field], 0.5);
            expect(pushed.vz[indices[0]]).not.toBe(free.vz[indices[0]]);
            outside.forEach((_place, slot) => {
                const index = indices[slot + 1];
                expectUntouched(pushed, free, index);
            });
        });

        it('adds the fields together and ignores an empty or missing list', () => {
            const jet = (dx) => ({
                kind: 'jet', x: 0, y: 20, z: 0, dx, dy: 0, dz: 0, radius: 6, power: 16,
            });
            const place = [[0.5, 20, 0], [-1, 21, 1]];
            const one = twins(place, [jet(1)], 0.3);
            const two = twins(place, [jet(1), jet(1)], 0.3);
            const cancelled = twins(place, [jet(1), jet(-1)], 0.3);
            one.indices.forEach((index) => {
                const single = one.pushed.vx[index] - one.free.vx[index];
                expect(single).toBeGreaterThan(0);
                expect(two.pushed.vx[index] - two.free.vx[index]).toBeGreaterThan(single * 1.5);
                expect(cancelled.pushed.x[index]).toBe(cancelled.free.x[index]);
            });
            for (const fields of [[], undefined, null]) {
                const { free, pushed } = twins(place, fields, 0.3);
                expect(snapshot(pushed)).toEqual(snapshot(free));
            }
        });
    });

    describe('lights in the air', () => {
        /** Everything the air can do to a particle at once: wind, a gust, and three fields on top of it. */
        const storm = (at) => ({
            windX: 0.6,
            windZ: -0.8,
            wind: 1,
            gust: 1,
            fields: [
                {
                    kind: 'burst', x: at[0] + 0.5, y: at[1] - 0.5, z: at[2], radius: 6, power: 40, up: 12,
                },
                {
                    kind: 'jet', x: at[0], y: at[1], z: at[2], dx: 1, dy: 0.3, dz: 0, radius: 6, power: 30,
                },
                crownField({ x: at[0] + 2, z: at[2], top: at[1] }),
            ],
        });

        it('lights a glow where it is asked and leaves it there, whatever blows', () => {
            const at = [3, 6, -4];
            const sim = create({ groundHeight: MEADOW });
            // Thrown like anything else, with a speed of its own: a light is not a thing, and stays.
            const glow = sim.spawn(...at, 4, 5, -3, {
                life: 1.2, kind: GLOW, flower: 2, size: 2,
            });
            const petal = sim.spawn(...at, 4, 5, -3, { life: 1.2 });
            expect(glow).toBeGreaterThanOrEqual(sim.ambient);
            expect(sim.counts().live).toBe(2);
            for (let frame = 0; frame < 60; frame++) {
                sim.step(STEP, frame % 2 ? { ...storm(at), settled: frame > 30 } : storm(at));
                expect([sim.x[glow], sim.y[glow], sim.z[glow]]).toEqual(at);
                const shown = drawn(sim, glow);
                expect([shown.x, shown.y, shown.z]).toEqual(at);
                expect(shown.kind).toBe(GLOW);
                expect(shown.flower).toBe(2);
            }
            // The petal beside it went where all of that carried it.
            expect(Math.hypot(sim.x[petal] - at[0], sim.y[petal] - at[1], sim.z[petal] - at[2])).toBeGreaterThan(1);
            expectFinite(sim);
        });

        it('keeps a glow alight for the life it was given, over water and grass alike, and then it is gone', () => {
            for (const groundHeight of [LAKE, MEADOW]) {
                const sim = create({ groundHeight });
                // Low over the water: a petal here would be taken by the lake at once.
                const glow = sim.spawn(0, 0.01, 0, 0, -3, 0, { life: 0.8, kind: GLOW, size: 3 });
                const petal = sim.spawn(5, 0.01, 0, 0, -3, 0, { life: 0.8 });
                let touches = 0;
                for (let frame = 0; frame < 46; frame++) {
                    sim.step(STEP, STILL);
                    touches += sim.touchCount;
                    expect(sim.life[glow], `frame ${frame}`).toBeGreaterThan(0);
                    expect(sim.life[glow]).toBeCloseTo(0.8 - (frame + 1) * STEP, 5);
                    expect(drawn(sim, glow).size).toBeGreaterThan(0);
                    expect(sim.y[glow]).toBeCloseTo(0.01, 6);
                }
                // The petal met the lake (and rang it) or the grass; the light met neither.
                expect(touches).toBe(groundHeight === LAKE ? 1 : 0);
                if (groundHeight === LAKE) expect(sim.life[petal]).toBe(0);
                run(sim, 0.1, STILL);
                expect(sim.life[glow]).toBeLessThanOrEqual(0);
                expect(drawn(sim, glow)).toMatchObject({ size: 0, light: 0 });
                run(sim, 2, STILL);
                expect(sim.counts().live).toBe(0);
                // Its slot is free for the next thing thrown.
                expect(sim.life[sim.spawn(0, 9, 0, 0, 0, 0, { life: 1 })]).toBe(1);
                expectFinite(sim);
            }
        });

        it('swells a glow to its size early in its life and holds it there while its light goes', () => {
            const sim = create();
            const size = 4;
            const life = 1.5;
            const glow = sim.spawn(0, 9, 0, 0, 0, 0, {
                life, kind: GLOW, flower: 1, size,
            });
            const seen = [];
            for (let frame = 0; frame < Math.round(life * 60) - 1; frame++) {
                sim.step(STEP, STILL);
                seen.push({ ...drawn(sim, glow), lived: 1 - sim.life[glow] / life });
            }
            // It opens small, never from nothing, and only ever grows ...
            expect(seen[0].size).toBeGreaterThan(size * 0.2);
            expect(seen[0].size).toBeLessThan(size * 0.5);
            for (let frame = 1; frame < seen.length; frame++) {
                expect(seen[frame].size).toBeGreaterThanOrEqual(seen[frame - 1].size);
            }
            // ... to the size it was given, reached in the first third of its life and held to the end.
            const grown = seen.findIndex((entry) => entry.size === size);
            expect(grown).toBeGreaterThan(3);
            expect(seen[grown].lived).toBeLessThan(1 / 3);
            expect(seen.slice(grown).every((entry) => entry.size === size)).toBe(true);
            // Its light comes up with it, is brightest about when it is full grown, and then only falls.
            const lights = seen.map((entry) => entry.light);
            const peak = lights.indexOf(Math.max(...lights));
            expect(lights[0]).toBeLessThan(lights[peak] * 0.25);
            expect(Math.abs(peak - grown)).toBeLessThanOrEqual(2);
            expect(lights[peak]).toBeGreaterThan(0.3);
            expect(lights[peak]).toBeLessThanOrEqual(1);
            for (let frame = 1; frame <= peak; frame++) expect(lights[frame]).toBeGreaterThan(lights[frame - 1]);
            for (let frame = peak + 1; frame < lights.length; frame++) {
                expect(lights[frame]).toBeLessThan(lights[frame - 1]);
            }
            // It goes out: all but dark in its last frames, and nothing at all once its life is up.
            expect(lights.at(-1)).toBeGreaterThanOrEqual(0);
            expect(lights.at(-1)).toBeLessThan(lights[peak] * 0.01);
            run(sim, 3 * STEP, STILL);
            expect(drawn(sim, glow)).toMatchObject({ size: 0, light: 0 });
            // The renderer is told what it is all the while.
            for (const entry of seen) expect(entry).toMatchObject({ kind: GLOW, flower: 1 });
        });

        it('dims its glows by the share of flashes the player allows, and nothing else by it', () => {
            const sim = create();
            const glow = sim.spawn(0, 9, 0, 0, 0, 0, { life: 2, kind: GLOW, size: 3 });
            const petal = sim.spawn(2, 9, 0, 0, 0, 0, { life: 2 });
            const pollen = sim.spawn(4, 9, 0, 0, 0, 0, { life: 2, kind: POLLEN });
            run(sim, 0.6, STILL);
            const shown = (env) => {
                sim.step(0, env);
                return {
                    glow: drawn(sim, glow),
                    petal: drawn(sim, petal).light,
                    pollen: drawn(sim, pollen).light,
                    down: drawn(sim, 0).light,
                };
            };
            const full = shown({});
            expect(full.glow.light).toBeGreaterThan(0.2);
            // No word about flashes is all of them: so is anything that is not a share.
            for (const flash of [1, 7, undefined, null, NaN, Infinity, -Infinity, 'dim']) {
                expect(shown({ flash }).glow.light, String(flash)).toBe(full.glow.light);
            }
            const half = shown({ flash: 0.5 });
            expect(half.glow.light).toBeCloseTo(full.glow.light / 2, 6);
            expect(shown({ flash: 0.25 }).glow.light).toBeCloseTo(full.glow.light / 4, 6);
            // Reduce flashing all the way: the light is not shown at all, though it is still there.
            for (const flash of [0, -0.5, -3]) {
                const dark = shown({ flash });
                expect(dark.glow.light, String(flash)).toBe(0);
                expect(dark.glow.size).toBe(full.glow.size);
                // The petals still fly, as bright as ever.
                expect([dark.petal, dark.pollen, dark.down]).toEqual([full.petal, full.pollen, full.down]);
            }
            expect([half.petal, half.pollen, half.down]).toEqual([full.petal, full.pollen, full.down]);
            // The share is read every frame it flies, too.
            sim.step(STEP, { ...STILL, flash: 0 });
            expect(drawn(sim, glow).light).toBe(0);
            sim.step(STEP, STILL);
            expect(drawn(sim, glow).light).toBeGreaterThan(0.2);
            // write() on its own takes the same share, and all of it when it is told nothing.
            sim.write(0, 0, 0.5);
            const written = drawn(sim, glow).light;
            sim.write(0, 0);
            expect(written).toBeCloseTo(drawn(sim, glow).light / 2, 6);
        });
    });

    describe('petals that hang in the air', () => {
        /** How far a particle is from a place. */
        const from = (sim, index, [x, y, z]) => Math.hypot(sim.x[index] - x, sim.y[index] - y, sim.z[index] - z);

        it('holds a petal up where it was thrown while it hangs, then lets it fall like any other', () => {
            const sim = create();
            const at = [0, 20, 0];
            const hung = sim.spawn(...at, 0, 0, 0, { life: 9, hang: 1.5 });
            const loose = sim.spawn(...at, 0, 0, 0, { life: 9 });
            let strayed = 0;
            for (let frame = 0; frame < 84; frame++) {
                sim.step(STEP, STILL);
                strayed = Math.max(strayed, from(sim, hung, at));
            }
            // A second and a half on it is within a few centimetres of where it was let go, while
            // the petal thrown beside it without a hold has dropped away.
            expect(strayed).toBeLessThan(0.06);
            expect(at[1] - sim.y[loose]).toBeGreaterThan(0.25);
            expect(at[1] - sim.y[loose]).toBeGreaterThan((at[1] - sim.y[hung]) * 8);
            // Then the air lets go of it, and it comes down as the other did.
            run(sim, 1.5, STILL);
            expect(at[1] - sim.y[hung]).toBeGreaterThan(0.25);
            expect(sim.hang[hung]).toBeLessThanOrEqual(0);
            // It is a petal like any other all the while: drawn, tumbling, growing older.
            expect(drawn(sim, hung)).toMatchObject({ kind: PETAL });
            expect(drawn(sim, hung).size).toBeGreaterThan(0);
            expect(sim.life[hung]).toBeCloseTo(sim.life[loose], 5);
        });

        it('lets the air stop a thrown petal at its place, twice as far for twice the speed, and holds it', () => {
            const sim = create();
            const at = [1, 30, -2];
            const throwOne = (speed) => sim.spawn(...at, 0.6 * speed, 0.8 * speed, 0, { life: 9, hang: 3 });
            const [slow, fast] = [throwOne(1.5), throwOne(3)];
            run(sim, 2, STILL);
            const reach = (index) => [sim.x[index] - at[0], sim.y[index] - at[1], sim.z[index] - at[2]];
            const [near, far] = [reach(slow), reach(fast)];
            // Out along the way it was thrown, and no further for the time it has had: the air has
            // all but stopped it.
            for (const [index, place] of [[slow, near], [fast, far]]) {
                expect(Math.hypot(sim.vx[index], sim.vy[index], sim.vz[index])).toBeLessThan(0.2);
                expect(place[0] / Math.hypot(...place)).toBeCloseTo(0.6, 1);
                expect(place[1] / Math.hypot(...place)).toBeCloseTo(0.8, 1);
            }
            expect(Math.hypot(...near)).toBeGreaterThan(0.5);
            expect(Math.hypot(...far) / Math.hypot(...near)).toBeGreaterThan(1.8);
            expect(Math.hypot(...far) / Math.hypot(...near)).toBeLessThan(2.2);
            // It stays where the air stopped it for as long as it hangs.
            const [held, heldFar] = [[sim.x[slow], sim.y[slow], sim.z[slow]], [sim.x[fast], sim.y[fast], sim.z[fast]]];
            run(sim, 0.8, STILL);
            expect(from(sim, slow, held)).toBeLessThan(0.08);
            expect(from(sim, fast, heldFar)).toBeLessThan(0.12);
        });

        it('keeps a hanging petal out of every field until it lets go', () => {
            const at = [2, 20, 0];
            const fields = [
                // A crown turning right through it, a jet and a burst on top of it.
                crownField({ x: 0, z: 0, top: 20 }),
                {
                    kind: 'jet', x: 2, y: 20, z: 0, dx: 0, dy: 0, dz: 1, radius: 5, power: 30,
                },
                {
                    kind: 'burst', x: 1.5, y: 19.5, z: 0.2, radius: 5, power: 30, up: 8,
                },
            ];
            const fly = (env, options) => {
                const sim = create();
                const index = sim.spawn(...at, 0.5, 0.2, 0, { life: 20, ...options });
                return { sim, index, env };
            };
            const free = fly(STILL, { hang: 1 });
            const pushed = fly({ ...STILL, fields }, { hang: 1 });
            const plain = fly({ ...STILL, fields }, {});
            for (let frame = 0; frame < 58; frame++) {
                for (const flight of [free, pushed, plain]) flight.sim.step(STEP, flight.env);
                // Exactly the flight of its twin in empty air, frame after frame.
                expectUntouched(pushed.sim, free.sim, pushed.index);
            }
            // The same fields had the petal without a hold from the first frame.
            expect(from(plain.sim, plain.index, at)).toBeGreaterThan(from(pushed.sim, pushed.index, at) + 1);
            // Its hold over, the fields take it as they take anything.
            for (let frame = 0; frame < 30; frame++) {
                for (const flight of [free, pushed]) flight.sim.step(STEP, flight.env);
            }
            expect(Math.hypot(
                pushed.sim.x[pushed.index] - free.sim.x[free.index],
                pushed.sim.y[pushed.index] - free.sim.y[free.index],
                pushed.sim.z[pushed.index] - free.sim.z[free.index],
            )).toBeGreaterThan(0.5);
            expectFinite(pushed.sim);
        });

        it('leans a hanging petal on the wind only a little, and lets it go sooner once the game is over', () => {
            const at = [0, 20, 0];
            const fly = (env, hang) => {
                const sim = create();
                const index = sim.spawn(...at, 0, 0, 0, { life: 9, hang });
                run(sim, 1, env);
                return { along: sim.x[index] - at[0], drop: at[1] - sim.y[index] };
            };
            const windy = {
                windX: 1, windZ: 0, wind: 0.6, gust: 0.5,
            };
            const [hung, loose] = [fly(windy, 2), fly(windy, 0)];
            // Carried the way the wind blows, but a fraction as far as a petal it has all to itself.
            expect(hung.along).toBeGreaterThan(0);
            expect(hung.along).toBeLessThan(loose.along / 2.5);
            expect(hung.drop).toBeLessThan(0.05);
            // The game is over: the flower comes apart in a third of the time, and falls.
            const over = fly({ ...STILL, settled: true }, 2);
            const playing = fly(STILL, 2);
            expect(playing.drop).toBeLessThan(0.05);
            expect(over.drop).toBeGreaterThan(playing.drop + 0.1);
        });

        it('takes a hold and a shine in range only, and nothing for nonsense', () => {
            const sim = create({ count: 140, reserve: 120 });
            const given = (options) => {
                const index = sim.spawn(0, 20, 0, 0, 0, 0, { life: 9, ...options });
                return { hang: sim.hang[index], shine: sim.shine[index] };
            };
            expect(given({})).toEqual({ hang: 0, shine: 0 });
            expect(given({ hang: 1.5, shine: 0.25 })).toEqual({ hang: 1.5, shine: 0.25 });
            for (const junk of [NaN, Infinity, -Infinity, -2, 'long', null, undefined, {}]) {
                expect(given({ hang: junk, shine: junk }), String(junk)).toEqual({ hang: 0, shine: 0 });
            }
            // A hold is seconds, and never many; a shine is a share of full light.
            const longest = given({ hang: 1e9 }).hang;
            expect(longest).toBeGreaterThan(2);
            expect(longest).toBeLessThan(20);
            expect(given({ hang: 1e12 }).hang).toBe(longest);
            expect(given({ shine: 40 }).shine).toBe(1);
            // The next thing thrown from the same slot carries neither over.
            const small = create({ count: 4, reserve: 2 });
            const first = small.spawn(0, 20, 0, 0, 0, 0, { life: 0.3, hang: 2, shine: 0.9 });
            run(small, 0.5, STILL);
            small.spawn(0, 20, 0, 0, 0, 0, { life: 0.3 });
            const again = small.spawn(0, 20, 0, 0, 0, 0, { life: 0.3 });
            expect(again).toBe(first);
            expect([small.hang[again], small.shine[again]]).toEqual([0, 0]);
        });

        it('adds a petal\'s shine to the light it is drawn with, and to nothing else about it', () => {
            // The same petal three times over, in three evenings that differ in nothing else.
            const thrown = (shine) => {
                const sim = create();
                const index = sim.spawn(0, 20, 0, 0, 0, 0, { life: 6, flower: 3, shine });
                run(sim, 1, STILL);
                return { sim, index };
            };
            const [plain, bright, brightest] = [0, 0.4, 1].map(thrown);
            const [dull, lit, most] = [plain, bright, brightest].map(({ sim, index }) => drawn(sim, index));
            expect(lit.light - dull.light).toBeCloseTo(0.4, 6);
            expect(most.light - dull.light).toBeCloseTo(1, 6);
            for (const key of ['x', 'y', 'z', 'size', 'flower', 'kind', 'spin']) expect(lit[key], key).toBe(dull[key]);
            // On top of the evening's glow and the crown's heat, not instead of them.
            for (const { sim } of [plain, bright]) sim.step(0, { glow: 1, heat: 1 });
            const warmed = drawn(plain.sim, plain.index).light;
            expect(warmed).toBeGreaterThan(dull.light);
            expect(drawn(bright.sim, bright.index).light - warmed).toBeCloseTo(0.4, 6);
            // Seed and pollen carry it the same way.
            for (const kind of [SEED, POLLEN]) {
                const sim = create();
                const pair = [0, 0.3].map((shine) => sim.spawn(0, 20, 0, 0, 0, 0, { life: 6, kind, shine }));
                run(sim, 1, STILL);
                expect(drawn(sim, pair[1]).light - drawn(sim, pair[0]).light).toBeCloseTo(0.3, 6);
            }
            // It goes as the petal goes: nothing is drawn of it once its life is up.
            run(bright.sim, 6, STILL);
            expect(drawn(bright.sim, bright.index)).toMatchObject({ size: 0, light: 0 });
        });
    });

    describe('ambient down', () => {
        it('wanders about its home and keeps to the air when nothing happens at all', () => {
            const sim = create();
            const start = snapshot(sim).outPlace;
            const reach = new Float32Array(sim.ambient);
            for (let frame = 0; frame < 60 * 90; frame++) {
                sim.step(STEP);
                if (frame % 6 === 0) {
                    for (let index = 0; index < sim.ambient; index++) {
                        const tuft = drawn(sim, index);
                        const home = sim.home.subarray(index * 3, index * 3 + 3);
                        const strayed = Math.hypot(tuft.x - home[0], tuft.y - home[1], tuft.z - home[2]);
                        reach[index] = Math.max(reach[index], strayed);
                        expect(tuft.y).toBeGreaterThan(0);
                        expect(tuft.size).toBeGreaterThan(0);
                        expect(tuft.light).toBeGreaterThan(0);
                        expect(tuft.light).toBeLessThanOrEqual(1);
                        expect(tuft.kind).toBe(SEED);
                    }
                }
            }
            // Every tuft has moved, none has strayed.
            for (let index = 0; index < sim.ambient; index++) {
                expect(reach[index]).toBeGreaterThan(0.3);
                expect(reach[index]).toBeLessThan(6);
            }
            expect(Array.from(sim.outPlace)).not.toEqual(start);
            expect(sim.counts()).toEqual({ ambient: 20, reserve: 40, live: 0 });
            expectFinite(sim);
        });

        it('scatters from a burst and drifts back to where it keeps house', () => {
            const homes = new Float32Array([0, 4, 0]);
            const [calm, stirred] = [create({ homes }), create({ homes })];
            const burst = [{
                kind: 'burst', x: 0, y: 3, z: 0, radius: 12, power: 30, up: 4,
            }];
            run(calm, 0.6);
            run(stirred, 0.6, { fields: burst });
            const thrown = apart(calm, stirred, 0, calm.ambient);
            expect(thrown).toBeGreaterThan(0.5);
            run(calm, 1);
            run(stirred, 1);
            expect(apart(calm, stirred, 0, calm.ambient)).toBeGreaterThan(0.2);
            // Half a minute of calm and every tuft is back on the path it would have wandered anyway.
            run(calm, 30);
            run(stirred, 30);
            expect(apart(calm, stirred, 0, calm.ambient)).toBeLessThan(0.02);
        });

        it.each([
            [1, 0], [0, -1],
        ])('leans downwind in a gust from (%i, %i) and comes back when it drops', (windX, windZ) => {
            const [calm, blown] = [create(), create()];
            run(calm, 3, { windX, windZ, gust: 0 });
            run(blown, 3, { windX, windZ, gust: 1 });
            for (let index = 0; index < calm.ambient; index++) {
                const [still, leaning] = [drawn(calm, index), drawn(blown, index)];
                expect((leaning.x - still.x) * windX + (leaning.z - still.z) * windZ).toBeGreaterThan(0.2);
                // Down keeps its height in a gust: it is carried, not lifted.
                expect(leaning.y).toBeCloseTo(still.y, 5);
            }
            run(calm, 30, { windX, windZ, gust: 0 });
            run(blown, 30, { windX, windZ, gust: 0 });
            expect(apart(calm, blown, 0, calm.ambient)).toBeLessThan(0.02);
        });

        it('is never taken for an event, however many are thrown', () => {
            const sim = create();
            for (let frame = 0; frame < 240; frame++) {
                for (let count = 0; count < 3; count++) {
                    expect(sim.spawn(frame % 9, 0.5 + (frame % 5), count, 1, 2, 0, { life: 0.5 + (frame % 4) }))
                        .toBeGreaterThanOrEqual(sim.ambient);
                }
                sim.step(STEP, { gust: 0.5, settled: frame > 200 });
            }
            for (let index = 0; index < sim.ambient; index++) {
                expect(drawn(sim, index)).toMatchObject({ kind: SEED });
                expect(drawn(sim, index).size).toBeGreaterThan(0);
                expect(sim.life[index]).toBe(0);
            }
            expect(sim.counts().ambient).toBe(20);
        });
    });

    describe('time and hostile input', () => {
        it('ignores invalid timesteps and clamps long frames', () => {
            const sim = create();
            sim.spawn(0, 20, 0, 1, 1, 1, { life: 3 });
            sim.step(STEP, STILL);
            const { time } = sim;
            const state = snapshot(sim);
            for (const dt of [0, -0, -1, -1e9, NaN, -Infinity, undefined, null, '0.1', {}, []]) {
                sim.step(dt, STILL);
                expect(sim.time).toBe(time);
            }
            expect(snapshot(sim)).toEqual(state);
            // A long frame is a short one: a hitch does not throw the petals across the lake.
            sim.step(10, STILL);
            const clamped = sim.time - time;
            expect(clamped).toBeGreaterThan(0);
            expect(clamped).toBeLessThanOrEqual(0.1);
            sim.step(1e300, STILL);
            expect(sim.time - time).toBeCloseTo(clamped * 2, 12);
            sim.step(Infinity, STILL);
            expect(sim.time - time).toBeCloseTo(clamped * 2, 12);
            expect(Array.from(sim.outPlace)).not.toEqual(state.outPlace);
            expectFinite(sim);
        });

        it('advances the same flight at 30, 60 and 120 frames a second', () => {
            const fly = (fps) => {
                const sim = create();
                const petal = sim.spawn(0, 30, 0, 2, 3, -1, { life: 9 });
                const seed = sim.spawn(0, 30, 0, 2, 3, -1, { life: 9, kind: SEED });
                run(sim, 2, {
                    windX: 1, windZ: 0, wind: 0.4, gust: 0.3,
                }, 1 / fps);
                return { sim, petal, seed };
            };
            const reference = fly(60);
            expect(reference.sim.time).toBeCloseTo(2, 9);
            for (const fps of [30, 120]) {
                const other = fly(fps);
                expect(other.sim.time).toBeCloseTo(2, 9);
                for (const key of ['petal', 'seed']) {
                    const [a, b] = [reference[key], other[key]];
                    expect(Math.hypot(
                        other.sim.x[b] - reference.sim.x[a],
                        other.sim.y[b] - reference.sim.y[a],
                        other.sim.z[b] - reference.sim.z[a],
                    ), `${key} @${fps}`).toBeLessThan(0.5);
                    expect(other.sim.life[b]).toBeCloseTo(reference.sim.life[a], 3);
                }
                expect(apart(reference.sim, other.sim, 0, reference.sim.ambient)).toBeLessThan(0.1);
            }
        });

        it('still answers the light on a frozen frame', () => {
            const sim = create();
            const index = sim.spawn(0, 20, 0, 0, 0, 0, { life: 5 });
            run(sim, 0.5, STILL);
            const frozen = snapshot(sim);
            const shown = (env) => {
                sim.step(0, env);
                return { down: drawn(sim, 0).light, petal: drawn(sim, index).light };
            };
            const dark = shown({});
            const glowing = shown({ glow: 1 });
            const hot = shown({ heat: 1 });
            expect(glowing.down).toBeGreaterThan(dark.down);
            expect(glowing.petal).toBeGreaterThan(dark.petal);
            // Heat is the crown's own: it lights the petals, not the down.
            expect(hot.petal).toBeGreaterThan(dark.petal);
            expect(hot.down).toBe(dark.down);
            // Out of range or not a number: the nearest sensible light.
            expect(shown({ glow: 99, heat: 99 })).toEqual(shown({ glow: 1, heat: 1 }));
            for (const junk of [NaN, -5, -Infinity, 'bright', null]) {
                expect(shown({ glow: junk, heat: junk })).toEqual(dark);
            }
            expect(shown({ glow: Infinity })).toEqual(dark);
            // Nothing moved meanwhile.
            sim.step(0, {});
            for (const name of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'life', 'spin']) {
                expect(Array.from(sim[name]), name).toEqual(frozen[name]);
            }
            expect(sim.time).toBeCloseTo(0.5, 9);
        });

        it('keeps every buffer finite and every particle accounted for through a long run of extreme input', () => {
            const sim = create({ groundHeight: (x, z) => Math.sin(x * 0.3) * 2 + Math.cos(z * 0.2) });
            const random = seededRandom(77);
            const junk = [NaN, Infinity, -Infinity, undefined, null, 'x', -1e9, 1e9];
            const pick = (list) => list[Math.floor(random() * list.length)];
            for (let frame = 0; frame < 900; frame++) {
                for (let count = 0; count < 4; count++) {
                    sim.spawn(
                        (random() - 0.5) * 60,
                        random() * 30,
                        (random() - 0.5) * 60,
                        (random() - 0.5) * 2e3,
                        (random() - 0.5) * 2e3,
                        (random() - 0.5) * 2e3,
                        {
                            life: random() < 0.1 ? pick(junk) : random() * 6,
                            // (Glows among them: one more kind than the three that fly.)
                            kind: random() < 0.1 ? pick(junk) : Math.floor(random() * 4),
                            flower: random() < 0.1 ? pick(junk) : Math.floor(random() * 9) - 1,
                            size: random() < 0.1 ? pick(junk) : random() * 0.3,
                            hang: random() < 0.2 ? pick(junk) : random() * 3 - 1,
                            shine: random() < 0.2 ? pick(junk) : random() * 3 - 1,
                        },
                    );
                }
                const fields = [];
                if (random() < 0.5) {
                    fields.push({
                        kind: 'burst',
                        x: (random() - 0.5) * 20,
                        y: random() * 8,
                        z: (random() - 0.5) * 20,
                        radius: 9,
                        power: random() * 400,
                        up: random() * 100,
                    });
                }
                if (random() < 0.5) {
                    fields.push({
                        kind: 'jet',
                        x: 0,
                        y: 4,
                        z: 0,
                        dx: random() - 0.5,
                        dy: random() - 0.5,
                        dz: random() - 0.5,
                        radius: 12,
                        power: random() * 400,
                    });
                }
                if (random() < 0.5) fields.push(crownField({ turn: random() < 0.5 ? 1 : -1, top: random() * 9 }));
                sim.step(random() < 0.1 ? pick(junk) : random() * 0.08, {
                    windX: random() < 0.2 ? pick(junk) : random() * 2 - 1,
                    windZ: random() < 0.2 ? pick(junk) : random() * 2 - 1,
                    wind: random() < 0.2 ? pick(junk) : random() * 3,
                    gust: random() < 0.2 ? pick(junk) : random() * 4,
                    glow: random() < 0.2 ? pick(junk) : random() * 2,
                    heat: random() < 0.2 ? pick(junk) : random() * 2,
                    flash: random() < 0.2 ? pick(junk) : random() * 2,
                    settled: random() < 0.2 ? pick(junk) : random() < 0.3,
                    fields,
                });
                if (!Object.values(buffers(sim)).every(allFinite)) throw new Error(`not finite at frame ${frame}`);
                const { ambient, reserve, live } = sim.counts();
                expect(ambient + reserve).toBe(sim.count);
                expect(live).toBeLessThanOrEqual(reserve);
                expect(sim.touchCount).toBeLessThanOrEqual(sim.touches.length);
            }
            for (let index = 0; index < sim.count; index++) {
                const particle = drawn(sim, index);
                expect(particle.size).toBeGreaterThanOrEqual(0);
                expect(particle.light).toBeGreaterThanOrEqual(0);
                expect(Number.isInteger(particle.flower) && particle.flower >= 0 && particle.flower <= FLOWER_KINDS)
                    .toBe(true);
                expect(Object.values(SUMMER_PARTICLES)).toContain(particle.kind);
            }
            expectFinite(sim);
        });

        it('survives a random source that returns nonsense', () => {
            for (const rng of [() => NaN, () => 0, () => 1, () => -4, () => Infinity]) {
                const build = () => new SummerPetalSim({ count: 30, reserve: 12, rng });
                expect(build).not.toThrow();
                const sim = build();
                expect(sim.spawn(0, 3, 0, 1, 1, 1, { life: 2 })).toBeGreaterThanOrEqual(sim.ambient);
                expect(() => run(sim, 0.5, { gust: 1 })).not.toThrow();
                expect(sim.counts()).toMatchObject({ ambient: 18, reserve: 12 });
            }
        });
    });

    describe('render buffers and reset', () => {
        it('writes place and look for everything in the air and nothing for the rest', () => {
            const sim = create();
            const thrown = [
                sim.spawn(1, 20, 2, 0, 0, 0, { life: 6, flower: 4, size: 0.09 }),
                sim.spawn(3, 21, 4, 0, 0, 0, { life: 6, kind: SEED, size: 0.05 }),
                sim.spawn(5, 22, 6, 0, 0, 0, {
                    life: 6, kind: POLLEN, flower: 2, size: 0.04,
                }),
            ];
            run(sim, 0.5, STILL);
            thrown.forEach((index) => {
                const particle = drawn(sim, index);
                expect([particle.x, particle.y, particle.z]).toEqual([sim.x[index], sim.y[index], sim.z[index]]);
                expect(particle.size).toBe(sim.size[index]);
                expect(particle.flower).toBe(sim.flower[index]);
                expect(particle.kind).toBe(sim.kind[index]);
                expect(particle.spin).toBe(sim.spin[index]);
                expect(particle.light).toBeGreaterThan(0);
            });
            expect(drawn(sim, thrown[0])).toMatchObject({ flower: 4, kind: PETAL });
            expect(drawn(sim, thrown[1]).kind).toBe(SEED);
            expect(drawn(sim, thrown[2])).toMatchObject({ flower: 2, kind: POLLEN });
            for (let index = sim.ambient; index < sim.count; index++) {
                if (!thrown.includes(index)) expect(drawn(sim, index)).toMatchObject({ size: 0, light: 0 });
            }
        });

        it('steps, throws and resets in the buffers it was built with', () => {
            const sim = create({ groundHeight: LAKE });
            sim.step(STEP);
            const owned = { ...buffers(sim), pull: sim.pull };
            const { touches } = sim;
            const entries = [...touches];
            const env = { gust: 0.4, fields: [crownField({ top: 3 })] };
            for (let frame = 0; frame < 400; frame++) {
                if (frame % 3 === 0) sim.spawn(frame % 6, 0.2 + (frame % 9), 0, 1, 1, 0, { life: 0.4 + (frame % 5) });
                sim.step(STEP, env);
                if (frame === 200) sim.reset();
            }
            for (const [name, array] of Object.entries(owned)) expect(sim[name], name).toBe(array);
            expect(sim.touches).toBe(touches);
            sim.touches.forEach((touch, index) => expect(touch).toBe(entries[index]));
            // The field list belongs to whoever passed it.
            expect(env.fields).toHaveLength(1);
            expect(Object.values(sim)).not.toContain(env.fields);
        });

        it('reproduces the same flight for the same seed and a different one for another', () => {
            const fly = (seed) => {
                const sim = create({ seed, groundHeight: (x) => (x < 0 ? -1 : 0.3) });
                const random = seededRandom(5);
                const touches = [];
                for (let frame = 0; frame < 300; frame++) {
                    if (frame % 4 === 0) {
                        sim.spawn(
                            (random() - 0.5) * 8,
                            random() * 1.5,
                            random() * 3,
                            random() * 4 - 2,
                            random() * 2 - 1,
                            random() - 0.5,
                            { life: 1 + random() * 3, kind: Math.floor(random() * 3) },
                        );
                    }
                    sim.step(STEP, {
                        windX: 0.8,
                        windZ: 0.6,
                        wind: 0.4,
                        gust: frame % 90 < 20 ? 0.8 : 0,
                        fields: frame % 120 < 30 ? [crownField({ top: 3 })] : [],
                    });
                    for (let index = 0; index < sim.touchCount; index++) touches.push({ frame, ...sim.touches[index] });
                }
                return { state: snapshot(sim), touches };
            };
            const first = fly(11);
            expect(fly(11)).toEqual(first);
            expect(first.touches.length).toBeGreaterThan(0);
            const other = fly(12);
            expect(other.state.outPlace).not.toEqual(first.state.outPlace);
            expect(other.state.home).not.toEqual(first.state.home);
        });

        it('returns to its opening state on reset and flies the next session as a new one would', () => {
            const session = (sim) => {
                for (let frame = 0; frame < 150; frame++) {
                    if (frame % 5 === 0) {
                        sim.spawn(frame % 7, 1 + (frame % 4), -2, 1, 2, 0.5, { life: 2, flower: frame % 7 });
                    }
                    sim.step(STEP, { gust: 0.3, glow: 0.5 });
                }
            };
            const sim = create({ groundHeight: LAKE });
            const opening = snapshot(sim);
            // A different, busier evening first.
            for (let frame = 0; frame < 400; frame++) {
                sim.spawn(frame % 11, 0.3 + (frame % 3), frame % 5, 3, 1, -2, {
                    life: 5, kind: frame % 4, size: 0.2, hang: 4, shine: 0.6,
                });
                sim.step(STEP, {
                    gust: 1, heat: 1, glow: 1, fields: [crownField({ top: 2 })],
                });
            }
            expect(sim.counts().live).toBeGreaterThan(0);
            sim.reset();
            expect(sim.time).toBe(0);
            expect(sim.touchCount).toBe(0);
            expect(sim.counts().live).toBe(0);
            const reopened = snapshot(sim);
            for (const name of ['outPlace', 'outLook', 'x', 'y', 'z', 'vx', 'vy', 'vz', 'life', 'spin', 'home',
                'seed', 'hang', 'shine', 'kind']) {
                expect(reopened[name], name).toEqual(opening[name]);
            }
            // No cooldown is left over to swallow the first touch of the new session.
            sim.spawn(0, 0.03, 0, 0, -1, 0, { life: 5 });
            sim.step(STEP, STILL);
            expect(sim.touchCount).toBe(1);
            sim.reset();
            const fresh = create({ groundHeight: LAKE });
            session(sim);
            session(fresh);
            expect(Array.from(sim.outPlace)).toEqual(Array.from(fresh.outPlace));
            expect(Array.from(sim.outLook)).toEqual(Array.from(fresh.outLook));
            expect(sim.time).toBe(fresh.time);
        });
    });
});

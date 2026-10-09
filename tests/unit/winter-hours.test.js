/**
 * Winter — the hours turn by the clock as well as by level (winter-core.js hourDrift / hourAt /
 * nearestTurn, and how winter-world.js stands the sky on them).
 *
 * An hour rests, then melts into the next, by the world clock alone; a level is one step on top
 * of wherever the clock has brought the sky. Timings are read from the module, never copied.
 */

import {
    beforeAll, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { WinterWorld } from '../../src/themes/winter/winter-world.js';
import { planGhosts } from '../../src/themes/winter/winter-ghosts.js';
import {
    HOURS, HOUR_KEYS, HOUR_PERIOD, HOUR_REST, REST_RIG, hourAt, hourDrift, hourName, nearestTurn,
} from '../../src/themes/winter/winter-core.js';

const N = HOURS.length;
const blank = () => Object.fromEntries(HOUR_KEYS.map((key) => [key, [0, 0, 0]]));
const calm = (hour) => HOUR_KEYS.map((key) => hour.calm[key]);
const flat = (palette) => HOUR_KEYS.map((key) => [...palette[key]]);
/** The largest difference in any channel of any of an hour's colours. */
const far = (a, b) => Math.max(...a.flatMap((colour, i) => colour.map((c, k) => Math.abs(c - b[i][k]))));
/** The middle of hour `k`'s rest, and of its melt into the next (seconds on the clock). */
const resting = (k) => (k + HOUR_REST * 0.5) * HOUR_PERIOD;
const melting = (k) => (k + HOUR_REST + (1 - HOUR_REST) * 0.5) * HOUR_PERIOD;

describe('winter hours: the clock\'s own turn', () => {
    it('rests on an hour, then melts into the next, a period at a time', () => {
        expect(HOUR_PERIOD).toBeGreaterThan(30);
        expect(HOUR_REST).toBeGreaterThan(0);
        expect(HOUR_REST).toBeLessThan(1);
        for (let k = 0; k < N * 2; k++) {
            // At rest: a whole number of hours, from the period's start to the end of its rest.
            expect(hourDrift(k * HOUR_PERIOD)).toBe(k);
            expect(hourDrift(resting(k))).toBe(k);
            expect(hourDrift((k + HOUR_REST) * HOUR_PERIOD)).toBeCloseTo(k, 9);
            // Melting: half-way through the melt it is half-way to the next hour.
            expect(hourDrift(melting(k))).toBeCloseTo(k + 0.5, 9);
        }
    });

    it('never runs backward and never jumps, the seams between periods included', () => {
        let before = hourDrift(0);
        const dt = 0.05;
        // The steepest the ease gets is 1.875 of its mean slope.
        const steepest = (1.875 * dt) / ((1 - HOUR_REST) * HOUR_PERIOD);
        for (let t = dt; t < HOUR_PERIOD * (N + 1); t += dt) {
            const now = hourDrift(t);
            expect(now).toBeGreaterThanOrEqual(before);
            expect(now - before).toBeLessThanOrEqual(steepest * 1.01);
            before = now;
        }
        // The whole day comes round once in N periods.
        expect(hourDrift(N * HOUR_PERIOD)).toBe(N);
    });

    it('is a function of the time alone, and takes nonsense as the start', () => {
        expect(hourDrift(melting(2))).toBe(hourDrift(melting(2)));
        for (const bad of [-5, NaN, undefined, null, Infinity, -Infinity]) expect(hourDrift(bad)).toBe(0);
    });
});

describe('winter hours: the sky at a phase', () => {
    it('is the hour itself at a whole phase, calm or lit, and comes round', () => {
        const out = blank();
        HOURS.forEach((hour, i) => {
            for (const phase of [i, i + N, i - N, i + N * 7]) {
                const stars = hourAt(phase, 0, out);
                expect(far(flat(out), calm(hour))).toBeLessThan(1e-12);
                expect(stars).toBeCloseTo(hour.calm.stars, 12);
            }
            const stars = hourAt(i, 1, out);
            expect(far(flat(out), HOUR_KEYS.map((key) => hour.lit[key]))).toBeLessThan(1e-12);
            expect(stars).toBeCloseTo(hour.lit.stars, 12);
        });
    });

    it('lies between two neighbouring hours in between, channel by channel', () => {
        const out = blank();
        HOURS.forEach((hour, i) => {
            const next = HOURS[(i + 1) % N];
            for (const f of [0.25, 0.5, 0.9]) {
                hourAt(i + f, 0, out);
                HOUR_KEYS.forEach((key) => {
                    out[key].forEach((c, k) => {
                        const lo = Math.min(hour.calm[key][k], next.calm[key][k]);
                        const hi = Math.max(hour.calm[key][k], next.calm[key][k]);
                        expect(c, `${hour.name} ${key}`).toBeGreaterThanOrEqual(lo - 1e-12);
                        expect(c, `${hour.name} ${key}`).toBeLessThanOrEqual(hi + 1e-12);
                    });
                });
            }
        });
    });

    it('keeps its colour half-way: no melt passes through grey', () => {
        const saturation = (v) => (Math.max(...v) <= 0 ? 0 : (Math.max(...v) - Math.min(...v)) / Math.max(...v));
        const a = blank();
        const b = blank();
        const mid = blank();
        for (const heat of [0, 1]) {
            for (let i = 0; i < N; i++) {
                hourAt(i, heat, a);
                hourAt(i + 1, heat, b);
                hourAt(i + 0.5, heat, mid);
                HOUR_KEYS.forEach((key) => {
                    const least = Math.min(saturation(a[key]), saturation(b[key]));
                    expect(saturation(mid[key]), `${HOURS[i].name} ${key} heat ${heat}`).toBeGreaterThan(least * 0.8);
                });
            }
        }
    });

    it('names the nearer hour, and turns to a level\'s hour the short way round', () => {
        expect(hourName(0)).toBe(HOURS[0].name);
        expect(hourName(1.4)).toBe(HOURS[1].name);
        expect(hourName(N - 0.4)).toBe(HOURS[0].name);
        expect(hourName(-1)).toBe(HOURS[N - 1].name);
        // One step on is one step on; from the last hour the first is one step on, not N − 1 back.
        expect(nearestTurn(0, 1)).toBe(1);
        expect(nearestTurn(N - 1, 0)).toBe(N);
        expect(nearestTurn(N + 0.2, 1)).toBe(N + 1);
        for (let from = -N; from <= N * 2; from += 0.37) {
            for (let wanted = 0; wanted < N; wanted++) {
                const turned = nearestTurn(from, wanted);
                expect(Math.abs(turned - from)).toBeLessThanOrEqual(N / 2 + 1e-9);
                expect(hourName(turned)).toBe(HOURS[wanted].name);
            }
        }
    });
});

describe('WinterWorld: the hours turn by the clock', () => {
    let ghosts;
    beforeAll(() => {
        ghosts = planGhosts();
    });
    const makeWorld = () => {
        const world = new WinterWorld({
            scene: new THREE.Scene(), quality: 'Minimal', capture: true, ghosts, fox: false,
        }).build();
        const camera = new THREE.PerspectiveCamera(50, 16 / 9, REST_RIG.near, REST_RIG.far);
        world.bindCamera(camera);
        world.setViewport(1600, 900, 16 / 9);
        return { world, camera };
    };
    const frame = (world, camera, time, delta = 0) => {
        const sim = {
            time, delta, pointerX: 0, pointerY: 0,
        };
        world.updateCamera(camera, sim);
        world.update(sim, camera);
    };
    const step = (world, camera, from, to, dt = 1 / 30) => {
        const steps = Math.max(1, Math.round((to - from) / dt));
        const h = (to - from) / steps;
        for (let i = 1; i <= steps; i++) frame(world, camera, from + i * h, h);
    };
    const key = (name) => (name === 'moon' ? 'moonCol' : name);
    const read = (world) => HOUR_KEYS.map((name) => world.u[key(name)].value.toArray());

    it('moves through every hour on one level, with nothing played', () => {
        const { world, camera } = makeWorld();
        frame(world, camera, 0, 0);
        expect(far(read(world), calm(HOURS[0]))).toBeLessThan(1e-9);
        let clock = 0;
        for (let k = 1; k <= N; k++) {
            // Half-way through the melt the sky is neither hour...
            step(world, camera, clock, melting(k - 1));
            clock = melting(k - 1);
            expect(far(read(world), calm(HOURS[(k - 1) % N]))).toBeGreaterThan(0.01);
            expect(far(read(world), calm(HOURS[k % N]))).toBeGreaterThan(0.01);
            // ...and by the next rest it is the next hour, with its stars.
            step(world, camera, clock, resting(k));
            clock = resting(k);
            expect(far(read(world), calm(HOURS[k % N])), `hour ${k}`).toBeLessThan(1e-6);
            expect(world.u.stars.value).toBeCloseTo(HOURS[k % N].calm.stars, 6);
            expect(world.getState().hour).toBe(HOURS[k % N].name);
            expect(world.getState().level).toBe(1);
        }
        world.dispose();
    });

    it('shows the same sky after a seek as after running there, at any frame rate', () => {
        const at = melting(1) + 3.21;
        const run = makeWorld();
        step(run.world, run.camera, 0, at, 1 / 24);
        const slow = makeWorld();
        step(slow.world, slow.camera, 0, at, 1 / 7);
        const sought = makeWorld();
        sought.world.seek(at);
        frame(sought.world, sought.camera, at, 0);
        expect(far(read(run.world), read(sought.world))).toBeLessThan(1e-9);
        expect(far(read(slow.world), read(sought.world))).toBeLessThan(1e-9);
        expect(run.world.getState().hourPhase).toBeCloseTo(sought.world.getState().hourPhase, 9);
        [run, slow, sought].forEach(({ world }) => world.dispose());
    });

    it('takes a level as one step on top of the clock', () => {
        const { world, camera } = makeWorld();
        // The clock has brought the sky to its second hour; the level has done nothing yet.
        step(world, camera, 0, resting(1));
        expect(far(read(world), calm(HOURS[1 % N]))).toBeLessThan(1e-6);
        // A level-up: one hour on from THERE, eased in, not back to "level two's hour".
        world.levelUp(2);
        expect(world.getState().hour).toBe(HOURS[2 % N].name);
        frame(world, camera, resting(1) + 1 / 60, 1 / 60);
        expect(far(read(world), calm(HOURS[2 % N]))).toBeGreaterThan(far(calm(HOURS[1 % N]), calm(HOURS[2 % N])) * 0.5);
        step(world, camera, world.time, world.time + 9);
        expect(far(read(world), calm(HOURS[2 % N]))).toBeLessThan(1e-4);
        // Silent (a restored session, a capture): there at once.
        world.levelUp(4, { silent: true });
        frame(world, camera, world.time, 0);
        expect(far(read(world), calm(HOURS[(1 + 3) % N]))).toBeLessThan(1e-9);
        world.dispose();
    });

    it('turns back to a new run\'s first level the short way round, without a jump', () => {
        const { world, camera } = makeWorld();
        world.levelUp(N, { silent: true });
        frame(world, camera, 1, 0);
        expect(far(read(world), calm(HOURS[N - 1]))).toBeLessThan(1e-9);
        const before = read(world);
        world.resetSession();
        // The level is dropped at once; the sky has not moved yet...
        expect(world.getState().level).toBe(1);
        expect(world.getState().hour).toBe(HOURS[0].name);
        expect(far(read(world), before)).toBeLessThan(1e-9);
        // ...and eases to the first hour by going ON one hour, not back through the other three.
        frame(world, camera, 1 + 1 / 60, 1 / 60);
        expect(world.hourStep).toBeGreaterThan(N - 1);
        step(world, camera, world.time, world.time + 9);
        expect(world.hourStep).toBeCloseTo(N, 4);
        expect(far(read(world), calm(HOURS[0]))).toBeLessThan(1e-4);
        world.dispose();
    });

    it('does not slow the turn for reduced motion: a slow change of colour is not motion', () => {
        const still = makeWorld();
        still.world.setReducedMotion(true);
        const moving = makeWorld();
        const at = melting(0);
        step(still.world, still.camera, 0, at);
        step(moving.world, moving.camera, 0, at);
        expect(far(read(still.world), read(moving.world))).toBeLessThan(1e-9);
        [still, moving].forEach(({ world }) => world.dispose());
    });
});

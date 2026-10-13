/**
 * Pyrestorm — the watches of the night.
 *
 * The standing requirement (the owner's, for every theme): the night's palette drifts with the
 * CLOCK by itself, whatever the level and with no gameplay at all, resting only a small share of
 * each step on a watch's own palette; a level-up adds a step on top of the clock, stepping forward
 * from where the light was heading, never back; a new run keeps the light where it is. The walk
 * goes there and back along a line of neighbouring palettes, so no mix ever crosses the colour
 * wheel through grey.
 *
 * Every number is read from the module (TIMING, WATCHES, WALK): the palettes are still being tuned.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { TIMING } from '../../src/themes/pyrestorm/pyrestorm-core.js';
import {
    WALK, WATCHES, WatchWheel, createWatchLight, restEase, watchAt,
} from '../../src/themes/pyrestorm/pyrestorm-hours.js';
import { PyrestormWorld } from '../../src/themes/pyrestorm/pyrestorm-world.js';

const COLOUR_KEYS = ['zenith', 'horizon', 'dusk', 'haze', 'ambient', 'ash', 'bolt', 'fire'];
const SCALAR_KEYS = ['duskBearing', 'stars', 'lavaHeat', 'hazeDensity'];
const SKY_KEYS = ['zenith', 'horizon', 'dusk'];
const W = TIMING.watch;
const REST = TIMING.watchRest;

/** How far two lights are apart: the largest difference of any colour channel or scalar. */
function distance(a, b) {
    let d = 0;
    for (const key of COLOUR_KEYS) for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a[key][c] - b[key][c]));
    for (const key of SCALAR_KEYS) d = Math.max(d, Math.abs(a[key] - b[key]));
    return d;
}

/** A change seen relative to the colour's own brightness (the night's colours are dark). */
const relative = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i]))) / Math.max(...a, ...b, 1e-9);

/** True when a light is exactly a watch's own palette. */
function isWatch(light, index) {
    const watch = WATCHES[index];
    return COLOUR_KEYS.every((key) => watch[key].every((v, c) => Math.abs(light[key][c] - v) < 1e-12))
        && SCALAR_KEYS.every((key) => Math.abs(light[key] - watch[key]) < 1e-12);
}

/** Colourfulness: (max − min) / max of a colour; 0 is grey. */
const chroma = (rgb) => {
    const hi = Math.max(...rgb);
    return hi > 0 ? (hi - Math.min(...rgb)) / hi : 0;
};

const lightOf = (wheel, t) => watchAt(wheel.place(t));

describe('Pyrestorm watches: the palettes', () => {
    it('are a line of watches, each with every colour and scalar the world reads', () => {
        expect(WATCHES.length).toBeGreaterThanOrEqual(3);
        WATCHES.forEach((watch) => {
            expect(typeof watch.name).toBe('string');
            COLOUR_KEYS.forEach((key) => {
                expect(watch[key], `${watch.name}.${key}`).toHaveLength(3);
                watch[key].forEach((v) => expect(v >= 0 && Number.isFinite(v), `${watch.name}.${key}`).toBe(true));
            });
            SCALAR_KEYS.forEach((key) => expect(Number.isFinite(watch[key]), `${watch.name}.${key}`).toBe(true));
        });
        expect(new Set(WATCHES.map((watch) => watch.name)).size).toBe(WATCHES.length);
    });

    it('walks there and back along the line, visiting every watch, one neighbour at a time', () => {
        const last = WATCHES.length - 1;
        expect(new Set(WALK)).toEqual(new Set(WATCHES.map((_, i) => i)));
        expect(WALK[0]).toBe(0);
        expect(WALK).toContain(last);
        for (let k = 0; k < WALK.length; k++) {
            const step = Math.abs(WALK[(k + 1) % WALK.length] - WALK[k]);
            expect(step, `step ${k}`).toBe(1);
        }
    });

    it('never mixes two palettes that are not neighbours on the walk', () => {
        const out = createWatchLight();
        for (let place = 0; place < WALK.length * 2; place += 0.029) {
            const light = watchAt(place, out);
            const k = Math.floor(place) % WALK.length;
            expect(light.from, `place ${place.toFixed(3)}`).toBe(WALK[k]);
            expect(light.to, `place ${place.toFixed(3)}`).toBe(WALK[(k + 1) % WALK.length]);
            expect(Math.abs(light.from - light.to)).toBe(1);
            // The light is exactly that pair's mix, nothing else.
            const A = WATCHES[light.from];
            const B = WATCHES[light.to];
            for (const key of COLOUR_KEYS) {
                for (let c = 0; c < 3; c++) {
                    expect(light[key][c]).toBeCloseTo(A[key][c] + (B[key][c] - A[key][c]) * light.mix, 12);
                }
            }
            expect(light.mix).toBeGreaterThanOrEqual(0);
            expect(light.mix).toBeLessThanOrEqual(1);
        }
    });

    it('keeps its colour half-way between every pair of neighbouring watches: no grey crossings', () => {
        for (let k = 0; k < WALK.length; k++) {
            const light = watchAt(k + 0.5);
            const label = `${WATCHES[light.from].name} → ${WATCHES[light.to].name}`;
            expect(light.mix, label).toBeCloseTo(0.5, 12);
            for (const key of SKY_KEYS) {
                // A floor well below what the palettes have: the trap is a mix that falls to grey.
                expect(chroma(light[key]), `${label}: ${key}`).toBeGreaterThan(0.3);
            }
        }
        expect(chroma([0.2, 0.2, 0.2])).toBe(0);
    });

    it('fills the light it is handed and never writes into the watches', () => {
        const watches = JSON.stringify(WATCHES);
        const out = createWatchLight();
        const { zenith } = out;
        for (let place = 0; place < 20; place += 0.37) {
            expect(watchAt(place, out)).toBe(out);
            out.zenith[0] += 1;
        }
        expect(out.zenith).toBe(zenith);
        expect(JSON.stringify(WATCHES)).toBe(watches);
        const fresh = [createWatchLight(), createWatchLight()];
        COLOUR_KEYS.forEach((key) => expect(fresh[0][key]).not.toBe(fresh[1][key]));
        // Nonsense places are the first watch.
        for (const bad of [Number.NaN, -3, undefined, -Infinity]) {
            expect(isWatch(watchAt(bad), 0), String(bad)).toBe(true);
        }
    });
});

describe('Pyrestorm watches: the clock alone', () => {
    it('rests TIMING.watchRest of each step at each end, and is on its way the rest of it', () => {
        expect(REST).toBeGreaterThan(0);
        expect(REST).toBeLessThan(0.5);
        // (A hair inside each edge: k + rest − k is not exactly rest in floating point.)
        for (const f of [0, REST * 0.5, REST - 1e-9]) expect(restEase(f), `f = ${f}`).toBe(0);
        for (const f of [1 - REST + 1e-9, 1 - REST * 0.5, 0.999999]) expect(restEase(f), `f = ${f}`).toBe(1);
        let previous = 0;
        for (let f = REST + 0.01; f < 1 - REST; f += 0.01) {
            const mix = restEase(f);
            expect(mix, `f = ${f}`).toBeGreaterThan(previous);
            expect(mix).toBeLessThan(1);
            previous = mix;
        }
        expect(restEase(0.5)).toBeCloseTo(0.5, 12);
    });

    it('has visibly moved the light within the first minute, at a fixed level with no gameplay', () => {
        const wheel = new WatchWheel();
        const start = lightOf(wheel, 0);
        expect(isWatch(start, WALK[0])).toBe(true);
        const minute = lightOf(wheel, 60);
        // The sky itself has moved, by a share of its own brightness one can see.
        const moved = Math.max(relative(start.zenith, minute.zenith), relative(start.horizon, minute.horizon));
        expect(moved).toBeGreaterThan(0.1);
        // It starts moving as soon as the rest is over...
        const restEnds = REST * W;
        expect(restEnds).toBeLessThan(60);
        expect(distance(lightOf(wheel, restEnds + 3), start)).toBeGreaterThan(0);
        // ...and keeps moving: no five seconds of a step's middle hold still.
        for (let t = restEnds + 1; t < W - restEnds - 5; t += 5) {
            expect(distance(lightOf(wheel, t + 5), lightOf(wheel, t)), `t = ${t}`).toBeGreaterThan(1e-5);
        }
    });

    it('stands on the next palette of the walk one TIMING.watch later, and on each after it', () => {
        const wheel = new WatchWheel();
        for (let k = 0; k <= WALK.length + 2; k++) {
            const light = lightOf(wheel, k * W);
            expect(isWatch(light, WALK[k % WALK.length]), `after ${k} watches`).toBe(true);
            // ...and rests there for the rest share either side of the step.
            const own = WALK[k % WALK.length];
            expect(isWatch(lightOf(wheel, k * W + REST * W * 0.9), own), `rest after ${k}`).toBe(true);
            if (k > 0) expect(isWatch(lightOf(wheel, k * W - REST * W * 0.9), own), `rest before ${k}`).toBe(true);
        }
    });

    it('drifts the same at every level: the level is added on top of the clock, never instead of it', () => {
        for (const level of [1, 2, 4, 7, 12]) {
            const wheel = new WatchWheel();
            wheel.levelUp(level, 0, true);
            for (const t of [0, 15, 37, 60, 100, 250, 999]) {
                expect(wheel.place(t), `level ${level}, t = ${t}`).toBeCloseTo(level - 1 + t / W, 9);
            }
            expect(distance(lightOf(wheel, 60), lightOf(wheel, 0)), `level ${level}`).toBeGreaterThan(0);
        }
        // A negative clock is the start of the night.
        expect(new WatchWheel().place(-50)).toBe(0);
    });
});

describe('Pyrestorm watches: level-ups and runs', () => {
    it('add a whole step on top of the clock, eased over TIMING.levelTurn from where the light stood', () => {
        const wheel = new WatchWheel();
        const t0 = 30;
        const before = wheel.place(t0);
        wheel.levelUp(2, t0);
        expect(wheel.place(t0)).toBeCloseTo(before, 12); // no jump at the instant
        let previous = before;
        for (let k = 1; k <= 20; k++) {
            const t = t0 + (k / 20) * TIMING.levelTurn;
            const place = wheel.place(t);
            expect(place, `step ${k}`).toBeGreaterThan(previous);
            previous = place;
        }
        for (const t of [t0 + TIMING.levelTurn, t0 + 60, t0 + 400]) {
            expect(wheel.place(t)).toBeCloseTo(1 + t / W, 9);
        }
    });

    it('step forward from where the light was heading when a second level comes mid-turn', () => {
        const wheel = new WatchWheel();
        wheel.levelUp(2, 10);
        const t1 = 10 + TIMING.levelTurn * 0.4;
        const before = wheel.place(t1);
        wheel.levelUp(3, t1);
        expect(wheel.place(t1)).toBeCloseTo(before, 12);
        const done = t1 + TIMING.levelTurn;
        expect(wheel.place(done)).toBeCloseTo(2 + done / W, 9);
        // Several levels at once step by all of them.
        const jump = new WatchWheel();
        jump.levelUp(4, 0);
        expect(jump.place(TIMING.levelTurn)).toBeCloseTo(3 + TIMING.levelTurn / W, 9);
    });

    it('never step back: after a long run, a new run keeps the light and its levels step on from it', () => {
        const wheel = new WatchWheel();
        const samples = [];
        const sample = (t) => samples.push([t, wheel.place(t)]);
        // A long run: nine levels over fifteen minutes.
        let t = 0;
        for (let level = 2; level <= 10; level++) {
            for (let s = 0; s < 100; s += 2.5) sample(t + s);
            t += 100;
            wheel.levelUp(level, t);
        }
        for (let s = 0; s <= 20; s += 0.5) sample(t + s);
        t += 20;
        const atRun = wheel.place(t);
        // The run ends: the night stays where it is.
        wheel.newRun();
        expect(wheel.place(t)).toBeCloseTo(atRun, 12);
        expect(wheel.lastLevel).toBe(1);
        // The director re-announcing level 1 changes nothing.
        wheel.levelUp(1, t);
        expect(wheel.place(t)).toBeCloseTo(atRun, 12);
        // The new run's level 2 steps one watch FORWARD from here, never back to level 2's own place.
        wheel.levelUp(2, t);
        for (let s = 0; s <= 30; s += 0.5) sample(t + s);
        expect(wheel.place(t + TIMING.levelTurn)).toBeCloseTo(atRun + 1 + TIMING.levelTurn / W, 9);
        for (let i = 1; i < samples.length; i++) {
            expect(samples[i][1], `t = ${samples[i][0]}`).toBeGreaterThanOrEqual(samples[i - 1][1] - 1e-12);
        }
    });

    it('a silent level-up (a rebuild restoring the run) lands at once', () => {
        const wheel = new WatchWheel();
        wheel.levelUp(3, 50, true);
        expect(wheel.place(50)).toBeCloseTo(2 + 50 / W, 9);
        // A level the wheel already has adds nothing.
        wheel.levelUp(3, 50);
        expect(wheel.place(50)).toBeCloseTo(2 + 50 / W, 9);
    });

    it('export and import restore the place, mid-turn and after it', () => {
        const wheel = new WatchWheel();
        wheel.levelUp(3, 12);
        wheel.newRun();
        wheel.levelUp(2, 14);
        const copy = new WatchWheel();
        copy.importState(JSON.parse(JSON.stringify(wheel.exportState())));
        for (const t of [14, 15.5, 17, 19, 60, 500]) expect(copy.place(t), `t = ${t}`).toBeCloseTo(wheel.place(t), 12);
        expect(copy.lastLevel).toBe(wheel.lastLevel);
        copy.importState(null);
        expect(copy.place(60)).toBeCloseTo(wheel.place(60), 12);
        copy.importState({ turnAt: Number.NaN, lastLevel: -4 });
        expect(copy.lastLevel).toBe(1);
        expect(copy.place(0)).toBe(0);
        wheel.reset();
        expect(wheel.place(0)).toBe(0);
    });
});

describe('Pyrestorm watches: in the world', () => {
    it('drift the world\'s own light with the clock at level 1 and at a high level, with no gameplay', () => {
        for (const level of [1, 6]) {
            // No build is needed: the light is CPU state the update writes into the uniforms.
            const world = new PyrestormWorld({ scene: new THREE.Scene(), quality: 'Minimal' });
            world.levelUp(level, { silent: true, time: 0 });
            const at = (time) => {
                world.update({ time, delta: 1 / 30 });
                const light = createWatchLight();
                for (const key of COLOUR_KEYS) light[key] = [...world.light[key]];
                for (const key of SCALAR_KEYS) light[key] = world.light[key];
                light.place = world.light.place;
                return light;
            };
            const first = at(0);
            expect(first.place).toBeCloseTo(level - 1, 9);
            expect(distance(at(60), first), `level ${level}`).toBeGreaterThan(0.005);
            expect(world.getState().watch.place).toBeCloseTo(level - 1 + 60 / W, 9);
            const later = at(W);
            expect(isWatch(later, WALK[level % WALK.length]), `level ${level}`).toBe(true);
            expect(world.getState().level).toBe(level);
            // The uniforms follow the light.
            world.u.zenith.value.toArray().forEach((v, i) => expect(v).toBeCloseTo(later.zenith[i], 6));
            world.u.horizon.value.toArray().forEach((v, i) => expect(v).toBeCloseTo(later.horizon[i], 6));
            world.dispose();
        }
    });

    it('step the world a watch on at a level-up, keep it through a new run, and step on from there', () => {
        const world = new PyrestormWorld({ scene: new THREE.Scene(), quality: 'Minimal' });
        const step = (time) => world.update({ time, delta: 1 / 30 });
        step(20);
        world.levelUp(2, { time: 20 });
        expect(world.counts.levelUps).toBe(1);
        step(20 + TIMING.levelTurn + 0.1);
        expect(world.light.place - world.time / W).toBeCloseTo(1, 9);
        world.resetSession();
        expect(world.level).toBe(1);
        step(40);
        expect(world.light.place - world.time / W).toBeCloseTo(1, 9);
        world.levelUp(2, { time: 40 });
        step(40 + TIMING.levelTurn + 0.1);
        expect(world.light.place - world.time / W).toBeCloseTo(2, 9);
        world.dispose();
    });
});

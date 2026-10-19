/**
 * Grainfields — the horse's gaits (grainfields-gait.js): the footfalls of each gait, a planted
 * hoof that stays put, the moment in the air of the canter and the gallop, and gaits that hand
 * over to each other without a jump.
 */
import { describe, expect, it } from 'vitest';
import {
    GAITS, GAIT_BREAKS, LEGS, LEG_LENGTH, createGaitState, gaitAt, gaitFor, legAt, stepGait,
} from '../../src/themes/grainfields/grainfields-gait.js';

const LEG = Object.fromEntries(LEGS.map((name, i) => [name, i]));
/** The shortest distance between two phases (cycles). */
const apart = (a, b) => Math.abs(((b - a + 1.5) % 1) - 0.5);

/** Run a gait at a steady speed for `seconds`, collecting each step's state (after a settling run). */
function run(speed, seconds = 4, dt = 1 / 240, settle = 6) {
    const state = createGaitState(0.1, 1);
    for (let t = 0; t < settle; t += dt) stepGait(state, speed, dt);
    const frames = [];
    for (let t = 0; t < seconds; t += dt) {
        stepGait(state, speed, dt);
        frames.push({
            t,
            legs: state.legs.map((leg) => ({ ...leg })),
            bob: state.bob,
            pitch: state.pitch,
            g: state.g,
        });
    }
    return frames;
}

describe('Grainfields gaits', () => {
    it('asks for the gait its speed calls for, rising with it', () => {
        expect(gaitFor(0)).toBe(0);
        expect(gaitFor(1.5)).toBeCloseTo(1, 5);
        expect(gaitFor(3.8)).toBeCloseTo(2, 5);
        expect(gaitFor(6.6)).toBeCloseTo(3, 5);
        expect(gaitFor(12)).toBeCloseTo(4, 5);
        let last = -1;
        for (let v = 0; v <= 14; v += 0.05) {
            const g = gaitFor(v);
            expect(g).toBeGreaterThanOrEqual(last - 1e-9);
            last = g;
        }
        // Each gait is at home between the breaks.
        GAITS.slice(1).forEach((gait, i) => {
            if (i < GAIT_BREAKS.length - 1) expect(gait.speed).toBeLessThan(GAIT_BREAKS[i + 1][0]);
            expect(gait.speed).toBeGreaterThan(GAIT_BREAKS[i][1]);
        });
        expect(gaitFor(Number.NaN)).toBe(0);
    });

    it('strikes the ground in each gait\'s own order', () => {
        const walk = gaitAt(1).offsets;
        // Walk: left hind, left fore, right hind, right fore, a quarter apart.
        const order = [LEG.hindLeft, LEG.frontLeft, LEG.hindRight, LEG.frontRight];
        order.forEach((leg, k) => expect(apart(walk[leg], walk[order[0]] + k * 0.25)).toBeLessThan(1e-9));
        // Trot: the diagonal pairs together, half a stride apart.
        const trot = gaitAt(2).offsets;
        expect(apart(trot[LEG.hindLeft], trot[LEG.frontRight])).toBeLessThan(1e-9);
        expect(apart(trot[LEG.hindRight], trot[LEG.frontLeft])).toBeLessThan(1e-9);
        expect(apart(trot[LEG.hindLeft], trot[LEG.hindRight])).toBeCloseTo(0.5, 9);
        // Canter (right lead): outside hind, then inside hind with outside fore, then the leading fore.
        const canter = gaitAt(3).offsets;
        expect(apart(canter[LEG.hindRight], canter[LEG.frontLeft])).toBeLessThan(1e-9);
        expect(canter[LEG.hindLeft]).toBeLessThan(canter[LEG.hindRight]);
        expect(canter[LEG.frontLeft]).toBeLessThan(canter[LEG.frontRight]);
        // Gallop: four beats, the hinds first, then the fores, the leading fore last.
        const gallop = gaitAt(4).offsets;
        const beats = [LEG.hindLeft, LEG.hindRight, LEG.frontLeft, LEG.frontRight].map((leg) => gallop[leg]);
        expect([...beats].sort((a, b) => a - b)).toEqual(beats);
        expect(new Set(beats).size).toBe(4);
        // A left lead mirrors the legs.
        const left = gaitAt(4, -1).offsets;
        expect(left[LEG.frontLeft]).toBeCloseTo(gallop[LEG.frontRight], 9);
        expect(left[LEG.hindRight]).toBeCloseTo(gallop[LEG.hindLeft], 9);
    });

    it('keeps a planted hoof still while the body passes over it', () => {
        for (const speed of [1.45, 3.8]) {
            const frames = run(speed, 3, 1 / 480);
            const leg = LEG.frontLeft;
            // Where the hoof is on the ground: the body's travel less the leg's lean back.
            let worst = 0;
            let start = null;
            frames.forEach((frame) => {
                const l = frame.legs[leg];
                const hoof = speed * frame.t - LEG_LENGTH * Math.sin(l.upper);
                if (l.planted > 0.999) {
                    if (start === null) start = hoof;
                    worst = Math.max(worst, Math.abs(hoof - start));
                } else start = null;
            });
            expect(worst, `slip at ${speed} m/s`).toBeLessThan(0.03);
        }
    });

    it('folds the knee back and the hock forward in the air, never on the ground', () => {
        const gait = gaitAt(4);
        for (let psi = 0; psi < 1; psi += 0.01) {
            const front = legAt(gait, true, psi, 0.5);
            const hind = legAt(gait, false, psi, 0.5);
            expect(front.lower).toBeGreaterThanOrEqual(0);
            expect(hind.lower).toBeLessThanOrEqual(0);
            if (psi < gait.duty) {
                expect(front.lower).toBe(0);
                expect(hind.lower).toBe(0);
            }
        }
        // Folded deepest a little before mid-swing.
        const mid = legAt(gait, true, gait.duty + (1 - gait.duty) * 0.42, 0.5);
        expect(mid.lower).toBeGreaterThan(gait.knee * 0.95);
    });

    it('walks on two or more feet and gallops through a moment in the air, rising in it', () => {
        const walk = run(1.45);
        walk.forEach((frame) => {
            const down = frame.legs.filter((l) => l.planted > 0.5).length;
            expect(down).toBeGreaterThanOrEqual(2);
        });
        const gallop = run(11.8);
        const airborne = gallop.filter((frame) => frame.legs.every((l) => l.planted < 0.01));
        expect(airborne.length).toBeGreaterThan(0);
        const bobAir = Math.max(...airborne.map((frame) => frame.bob));
        const bobDown = Math.min(...gallop.map((frame) => frame.bob));
        expect(bobAir).toBeGreaterThan(bobDown + 0.02);
        // The body rocks fore and aft at the gallop, a few degrees.
        const pitches = gallop.map((frame) => frame.pitch);
        expect(Math.max(...pitches) - Math.min(...pitches)).toBeGreaterThan(0.02);
        expect(Math.max(...pitches.map(Math.abs))).toBeLessThan(0.25);
    });

    it('breaks from one gait into the next over a stride, without a jump in any joint', () => {
        const state = createGaitState(0, 1);
        const dt = 1 / 120;
        const frames = [];
        for (let t = 0; t < 18; t += dt) {
            // From a stand up to a gallop and back down, then a stand.
            const speed = t < 8 ? (12 * t) / 8 : Math.max(0, 12 * (1 - (t - 8) / 8));
            stepGait(state, speed, dt);
            frames.push(state.legs.flatMap((l) => [l.upper, l.lower, l.fetlock]).concat(state.bob, state.pitch));
        }
        expect(frames.every((now) => now.every(Number.isFinite))).toBe(true);
        let worst = 0;
        for (let k = 1; k < frames.length; k++) {
            for (let i = 0; i < frames[k].length; i++) worst = Math.max(worst, Math.abs(frames[k][i] - frames[k - 1][i]));
        }
        // At 120 frames a second no joint turns more than a few degrees between frames.
        expect(worst).toBeLessThan(0.2);
        expect(state.g).toBeLessThan(0.5);
    });
});

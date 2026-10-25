/**
 * Grainfields — the horse's gaits (grainfields-gait.js): the footfalls of each gait, how the body
 * rides and the neck nods through a stride, how a leg folds in the air, and gaits that hand over to
 * each other without a jump. The legs solved to the ground are grainfields-horse.test.js's.
 */
import { describe, expect, it } from 'vitest';
import {
    GAITS, GAIT_BREAKS, LEGS, bodyAt, gaitAt, gaitFor, swingShape, wrap,
} from '../../src/themes/grainfields/grainfields-gait.js';

const LEG = Object.fromEntries(LEGS.map((name, i) => [name, i]));
/** The shortest distance between two phases (cycles). */
const apart = (a, b) => Math.abs(((b - a + 1.5) % 1) - 0.5);

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

    it('rides the walk over its straight legs and the faster gaits on springs', () => {
        const at = (g, phase) => bodyAt(gaitAt(g), phase);
        const walk = gaitAt(1);
        // The walk: the withers highest as a fore stands under them (mid-stance), the croup as a hind
        // does; twice a stride each.
        const foreMid = wrap(walk.offsets[LEG.frontLeft] + walk.duty / 2);
        const hindMid = wrap(walk.offsets[LEG.hindLeft] + walk.duty / 2);
        expect(at(1, foreMid).front).toBeCloseTo(walk.front, 2);
        expect(at(1, hindMid).hind).toBeCloseTo(walk.hind, 2);
        expect(at(1, foreMid + 0.25).front).toBeLessThan(0);
        // The trot: lowest over the diagonal pair's mid-stance, highest in the air between.
        const trot = gaitAt(2);
        const pairMid = wrap(trot.offsets[LEG.hindLeft] + trot.duty / 2);
        expect(at(2, pairMid).front).toBeLessThan(-trot.drop);
        expect(at(2, pairMid + 0.25).front).toBeGreaterThan(-trot.drop);
        // The canter and the gallop round and stretch the back once a stride and nod once; the walk
        // nods twice, the trot hardly.
        let walkNods = 0;
        let gallopNods = 0;
        let last = { walk: at(1, 0).nod, gallop: at(4, 0).nod };
        for (let p = 0.005; p <= 1; p += 0.005) {
            const w = at(1, p).nod;
            const g = at(4, p).nod;
            if (Math.sign(w) !== Math.sign(last.walk)) walkNods += 1;
            if (Math.sign(g) !== Math.sign(last.gallop)) gallopNods += 1;
            last = { walk: w, gallop: g };
        }
        expect(walkNods).toBe(4);
        expect(gallopNods).toBe(2);
        expect(Math.abs(gaitAt(4).flex)).toBeGreaterThan(Math.abs(gaitAt(1).flex) * 4);
        expect(gaitAt(2).nod).toBeLessThan(gaitAt(1).nod / 2);
        // Standing still nothing moves.
        Object.values(at(0, 0.3)).forEach((value) => expect(Math.abs(value)).toBe(0));
    });

    it('folds a leg in the air and opens it again to land', () => {
        const shape = (w) => swingShape(w, {});
        for (const key of ['fold', 'knee', 'curl', 'reach']) {
            expect(shape(0)[key], key).toBeCloseTo(0, 6);
            expect(shape(1)[key], key).toBeCloseTo(0, 6);
        }
        // The knee folds most early in the swing, opens before the hoof reaches forward; the reach is
        // late.
        let kneePeak = 0;
        let reachPeak = 0;
        for (let w = 0; w <= 1; w += 0.01) {
            if (shape(w).knee > shape(kneePeak).knee) kneePeak = w;
            if (shape(w).reach > shape(reachPeak).reach) reachPeak = w;
        }
        expect(kneePeak).toBeLessThan(0.5);
        expect(reachPeak).toBeGreaterThan(0.55);
        expect(shape(0.9).knee).toBeLessThan(0.1);
        // Each gait folds more than the one below it.
        for (let g = 1; g < GAITS.length - 1; g++) {
            for (const key of ['fold', 'knee', 'stifle', 'hock', 'curl', 'reach', 'load']) {
                expect(GAITS[g + 1][key], `${GAITS[g + 1].name} ${key}`).toBeGreaterThan(GAITS[g][key]);
            }
        }
    });

    it('breaks from one gait into the next without a jump in any number', () => {
        let last = gaitAt(0);
        const keys = ['freq', 'duty', 'fold', 'knee', 'stifle', 'hock', 'curl', 'load', 'drop', 'front', 'hind', 'flex',
            'nod', 'carry'];
        let worst = 0;
        for (let g = 0.002; g <= 4; g += 0.002) {
            const next = gaitAt(g);
            for (const key of keys) worst = Math.max(worst, Math.abs(next[key] - last[key]));
            for (let i = 0; i < 4; i++) worst = Math.max(worst, apart(next.offsets[i], last.offsets[i]));
            last = { ...next, offsets: [...next.offsets] };
        }
        expect(worst).toBeLessThan(0.01);
        // A pony's stride stays inside what its legs reach: the ground a hoof covers while it is down.
        for (const gait of GAITS.slice(1)) {
            const stance = (gait.speed * gait.duty) / gait.freq;
            expect(stance, gait.name).toBeLessThan(1.1);
        }
    });
});

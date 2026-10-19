/**
 * Grainfields — the herd's life (grainfields-herd-sim.js), its pose written for the vertex stage
 * (grainfields-herd.js writeHorse) and the barley it parts (grainfields-trample.js). Run without a
 * renderer, in fixed steps.
 */
import {
    describe, expect, it, vi,
} from 'vitest';
import {
    DEFAULT_VIEW, HERD, beltCover, createHerdSim, onStage, openBearings, planMove,
} from '../../src/themes/grainfields/grainfields-herd-sim.js';
import { HORSE_ATTRIBUTES, HORSE_STRIDE, writeHorse } from '../../src/themes/grainfields/grainfields-herd.js';
import { TRAMPLE, createTrample } from '../../src/themes/grainfields/grainfields-trample.js';
import { EYE, mulberry32 } from '../../src/themes/grainfields/grainfields-core.js';
import { beltAt } from '../../src/themes/grainfields/grainfields-plan.js';

vi.setConfig({ testTimeout: 60_000 });

const DT = 1 / 30;

/** Live a herd for `seconds`, calling `each(sim, time)` after every step. */
function live(sim, seconds, each = () => {}, from = 0) {
    for (let t = from; t < from + seconds; t += DT) {
        sim.update(t, DT);
        each(sim, t);
    }
}

const snapshot = (sim) => sim.horses.map((h) => [h.x, h.z, h.heading, h.speed, h.neck]);

describe('Grainfields herd: the band\'s life', () => {
    it('is the same band every time for a seed', () => {
        const a = createHerdSim({ count: 9 });
        const b = createHerdSim({ count: 9 });
        live(a, 120);
        live(b, 120);
        expect(snapshot(a)).toEqual(snapshot(b));
        const other = createHerdSim({ count: 9, seed: 7 });
        live(other, 120);
        expect(snapshot(other)).not.toEqual(snapshot(a));
        // A seek lands the band in the same place each time.
        a.reset(200);
        const first = snapshot(a);
        a.reset(200);
        expect(snapshot(a)).toEqual(first);
    });

    it('grazes, wanders and gallops out of the picture and back, mostly in sight, never wild', () => {
        const sim = createHerdSim({ count: 9 });
        const moves = new Set();
        let seen = 0;
        let samples = 0;
        let fastest = 0;
        let outOfSight = 0;
        let inBelt = 0;
        let crowded = 0;
        let pairs = 0;
        let broken = 0;
        live(sim, 1200, (s) => {
            if (s.plan) moves.add(s.plan.name);
            const allAway = s.horses.every((h) => !onStage(h.x, h.z));
            if (allAway) outOfSight += DT;
            s.horses.forEach((h, i) => {
                samples += 1;
                if (onStage(h.x, h.z)) seen += 1;
                fastest = Math.max(fastest, h.speed);
                if (!Number.isFinite(h.x + h.z + h.heading + h.speed + h.neck + h.head + h.gait.bob)) broken += 1;
                if (beltCover(h.x, h.z) > 0.5) inBelt += 1;
                for (let k = i + 1; k < s.horses.length; k++) {
                    // (A foal may press against its mother.)
                    const o = s.horses[k];
                    if (o.mother === i || h.mother === k) continue;
                    pairs += 1;
                    if (Math.hypot(h.x - o.x, h.z - o.z) < 0.9) crowded += 1;
                }
            });
        });
        expect(broken).toBe(0);
        // It moves on in all its ways: walks, trots, canters and gallops out of sight and back.
        expect([...moves].some((name) => name.startsWith('gallop-'))).toBe(true);
        expect(moves.has('walk') || moves.has('trot')).toBe(true);
        expect(moves.size).toBeGreaterThanOrEqual(4);
        // Mostly in the picture; out of it now and then, but never for long altogether.
        expect(seen / samples).toBeGreaterThan(0.65);
        expect(outOfSight).toBeGreaterThan(3);
        expect(outOfSight).toBeLessThan(1200 * 0.2);
        // A horse's pace: a gallop, not a car.
        expect(fastest).toBeGreaterThan(9);
        expect(fastest).toBeLessThan(HERD.paces.gallop * 1.2);
        // Round the shelterbelts, and each in its own space.
        expect(inBelt).toBe(0);
        expect(crowded / pairs).toBeLessThan(0.002);
    });

    it('runs at a chain, out of the picture and back into it within a minute', () => {
        const sim = createHerdSim({ count: 9 });
        live(sim, 30);
        sim.run(30);
        let gone = null;
        let back = null;
        // Strung out at a gallop, a straggler or two may still be in sight as the leaders return.
        live(sim, 90, (s, t) => {
            const seen = s.horses.filter((h) => onStage(h.x, h.z)).length;
            if (seen <= 2 && gone === null) gone = t;
            if (gone !== null && back === null && seen >= 7) back = t;
        }, 30);
        expect(gone).not.toBeNull();
        expect(gone - 30).toBeLessThan(25);
        expect(back).not.toBeNull();
        expect(back - gone).toBeLessThan(60);
        // A second chain while it is still running does not turn it round.
        const runner = createHerdSim({ count: 9 });
        live(runner, 30);
        runner.run(30);
        live(runner, 2, () => {}, 30);
        const { plan } = runner;
        runner.run(32);
        live(runner, 0.1, () => {}, 32);
        expect(runner.plan).toBe(plan);
    });

    it('wheels round at a T-spin, and keeps calm under reduced motion', () => {
        const sim = createHerdSim({ count: 9 });
        live(sim, 20);
        sim.wheel(20);
        live(sim, 0.2, () => {}, 20);
        expect(sim.plan?.name).toBe('wheel');
        const calm = createHerdSim({ count: 9 });
        calm.setCalm(true);
        let fastest = 0;
        const names = new Set();
        live(calm, 400, (s, t) => {
            if (Math.abs(t - 100) < DT / 2) s.run(t);
            if (Math.abs(t - 200) < DT / 2) s.wheel(t);
            s.horses.forEach((h) => { fastest = Math.max(fastest, h.speed); });
            if (s.plan) names.add(s.plan.name);
        });
        expect([...names].every((name) => name === 'walk' || name === 'trot')).toBe(true);
        expect(fastest).toBeLessThan(HERD.paces.trot * 1.25);
    });

    it('lowers its heads to graze and lifts them on the move', () => {
        const sim = createHerdSim({ count: 9 });
        let grazing = 0;
        let travelling = 0;
        let lowWhileGrazing = 0;
        let upWhileGalloping = 0;
        live(sim, 600, (s) => {
            s.horses.forEach((h) => {
                if (!s.plan && h.business === 'graze' && h.speed < 0.2) {
                    grazing += 1;
                    if (h.neck > 0.6) lowWhileGrazing += 1;
                }
                if (s.plan && h.speed > 9) {
                    travelling += 1;
                    if (h.neck < 0.6) upWhileGalloping += 1;
                }
            });
        });
        expect(grazing).toBeGreaterThan(100);
        expect(lowWhileGrazing / grazing).toBeGreaterThan(0.7);
        expect(travelling).toBeGreaterThan(100);
        expect(upWhileGalloping / travelling).toBeGreaterThan(0.9);
    });

    it('keeps its foals at their mothers\' sides', () => {
        const sim = createHerdSim({ count: 9 });
        const foals = sim.horses.filter((h) => h.foal);
        expect(foals.length).toBe(2);
        foals.forEach((foal) => {
            expect(foal.scale).toBeLessThan(0.75);
            expect(sim.horses[foal.mother].foal).toBe(false);
        });
        let near = 0;
        let samples = 0;
        live(sim, 600, (s) => {
            if (s.plan) return;
            s.horses.filter((h) => h.foal).forEach((foal) => {
                const mother = s.horses[foal.mother];
                samples += 1;
                if (Math.hypot(foal.x - mother.x, foal.z - mother.z) < 9) near += 1;
            });
        });
        expect(near / samples).toBeGreaterThan(0.8);
    });

    it('picks grazing grounds in the open, beside the board', () => {
        const open = openBearings(DEFAULT_VIEW);
        open.forEach(([lo, hi]) => {
            expect(hi).toBeGreaterThan(lo);
            DEFAULT_VIEW.blocked.forEach(([a, b]) => expect(hi <= a || lo >= b).toBe(true));
        });
        // The band settles where it can be seen: the leader's ground after any move.
        const rng = mulberry32(3);
        for (let k = 0; k < 40; k++) {
            const kind = ['walk', 'trot', 'canter', 'gallop'][k % 4];
            const move = planMove(kind, {
                x: -12, z: -30, heading: 0, turn: 1, bearing: -22,
            }, rng);
            const end = move.points[move.points.length - 1];
            expect(onStage(end.x, end.z), `${move.name} ends in sight`).toBe(true);
            expect(Math.hypot(end.x - EYE.x, end.z - EYE.z)).toBeLessThan(HERD.far + 10);
        }
    });

    it('lays its gallops out as curves a horse can run', () => {
        const rng = mulberry32(11);
        for (const kind of ['gallop-round', 'gallop-crest', 'gallop-path', 'gallop-loop']) {
            for (const from of [{ x: -12, z: -28 }, { x: 14, z: -35 }]) {
                const bearing = Math.atan2(from.x - EYE.x, -(from.z - EYE.z)) * (180 / Math.PI);
                const move = planMove(kind, {
                    ...from, heading: 0, turn: 1, bearing,
                }, rng);
                expect(move.name).toBe(kind);
                expect(move.pace).toBe('gallop');
                const pts = move.points;
                let length = 0;
                let away = 0;
                for (let i = 1; i < pts.length; i++) {
                    const step = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
                    length += step;
                    if (!onStage(pts[i].x, pts[i].z)) away += 1;
                }
                // Long enough to be a run, and it leaves the stage on the way (but the loop).
                expect(length, kind).toBeGreaterThan(120);
                if (kind !== 'gallop-loop') expect(away, kind).toBeGreaterThan(0);
                // No waypoint inside a shelterbelt.
                pts.forEach((p) => expect(beltAt(p.x, p.z).cover, kind).toBeLessThan(0.5));
            }
        }
    });

    it('agrees with the plan\'s own shelterbelts near the band', () => {
        for (let k = 0; k < 400; k++) {
            const x = -160 + (k % 20) * 16;
            const z = -200 + Math.floor(k / 20) * 12;
            expect(beltCover(x, z)).toBeCloseTo(beltAt(x, z).cover, 6);
        }
    });

    it('stands the gaits side by side for captures, through a seek', () => {
        const sim = createHerdSim({ count: 9 });
        sim.lineup(true, 16);
        sim.reset(10);
        sim.update(10, DT);
        const row = sim.horses.slice(0, 5);
        row.forEach((h, i) => {
            expect(h.z).toBeCloseTo(EYE.z - 16, 6);
            if (i > 0) expect(h.x).toBeGreaterThan(row[i - 1].x);
        });
        expect(row.map((h) => h.speed)).toEqual([0, HERD.paces.walk, HERD.paces.trot, HERD.paces.canter, HERD.paces.gallop]);
    });

    it('replays scripted moves through a seek', () => {
        const sim = createHerdSim({ count: 9 });
        sim.setScript([{ at: 20, kind: 'gallop-round' }]);
        sim.reset(22);
        expect(sim.plan?.name).toBe('gallop-round');
    });
});

describe('Grainfields herd: the pose the vertex stage reads', () => {
    it('writes each horse into its own stride of the interleaved buffer, a hind leg cocked at rest', () => {
        expect(HORSE_ATTRIBUTES).toHaveLength(7);
        expect(HORSE_STRIDE).toBe(28);
        const sim = createHerdSim({ count: 3 });
        live(sim, 5);
        const array = new Float32Array(3 * HORSE_STRIDE).fill(Number.NaN);
        sim.horses.forEach((h, i) => writeHorse(h, i, array, () => 10.5));
        expect([...array].every(Number.isFinite)).toBe(true);
        sim.horses.forEach((h, i) => {
            const o = i * HORSE_STRIDE;
            expect(array[o]).toBeCloseTo(h.x, 4);
            expect(array[o + 1]).toBeCloseTo(10.46, 4);
            expect(array[o + 2]).toBeCloseTo(h.z, 4);
            expect(array[o + 7]).toBeCloseTo(h.scale, 4);
            expect(array[o + 26]).toBe(h.coat);
        });
        // At rest one hind leg is cocked: its hock folded forward, the hoof tipped on its toe.
        const h = sim.horses[0];
        h.rest = 1;
        h.seed = 0.2;
        writeHorse(h, 0, array, () => 0);
        expect(array[17]).toBeLessThan(-0.3);
        expect(array[22]).toBeGreaterThan(0.8);
    });
});

describe('Grainfields herd: the barley it parts', () => {
    const at = (field, x, z) => {
        const i = Math.floor((x - TRAMPLE.x0) / (TRAMPLE.width / TRAMPLE.cols));
        const j = Math.floor((z - TRAMPLE.z0) / (TRAMPLE.depth / TRAMPLE.rows));
        const o = (j * TRAMPLE.cols + i) * 4;
        const b = field.texture.image.data;
        return { push: [b[o] / 127.5 - 1, b[o + 1] / 127.5 - 1], lay: b[o + 2] / 255 };
    };

    it('parts the stalks away from a horse going through and lets them rise again behind it', () => {
        const field = createTrample();
        const horse = {
            x: 0, z: -30, heading: Math.PI / 2, speed: 10, scale: 1,
        };
        expect(field.press([horse], 1 / 60)).toBe(true);
        // Beside the horse (it faces +x) the stalks lean away from it, and are laid over.
        const left = at(field, 0.3, -31.4);
        const right = at(field, 0.3, -28.6);
        expect(left.push[1]).toBeLessThan(-0.2);
        expect(right.push[1]).toBeGreaterThan(0.2);
        expect(left.lay).toBeGreaterThan(0.2);
        // Far from it, nothing.
        expect(at(field, 30, -60).lay).toBe(0);
        expect(Math.abs(at(field, 30, -60).push[0])).toBeLessThan(0.01);
        // The horse moves on: behind it the stalks stand back up over a few seconds.
        for (let k = 0; k < 600; k++) field.press([{ ...horse, x: 60 }], 1 / 60);
        expect(at(field, 0.3, -31.4).lay).toBeLessThan(left.lay * 0.3);
        expect(Math.abs(at(field, 0.3, -31.4).push[1])).toBeLessThan(0.05);
        // Off the field and settled, it stops uploading; a seek clears it.
        const quiet = createTrample();
        expect(quiet.press([], 1 / 60)).toBe(false);
        field.clear();
        expect(at(field, 60, -31.4).lay).toBe(0);
        expect(field.live).toBe(false);
    });

    it('keeps the field\'s border upright, so the barley beyond it is never pressed', () => {
        const field = createTrample();
        field.press([{
            x: TRAMPLE.x0 + 0.3, z: TRAMPLE.z0 + 0.3, heading: 0, speed: 10, scale: 1,
        }], 1 / 60);
        const b = field.texture.image.data;
        for (let i = 0; i < TRAMPLE.cols; i++) expect(b[i * 4 + 2]).toBe(0);
        for (let j = 0; j < TRAMPLE.rows; j++) expect(b[j * TRAMPLE.cols * 4 + 2]).toBe(0);
    });
});

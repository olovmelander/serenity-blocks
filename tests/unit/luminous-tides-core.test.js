/**
 * Luminous Tides — the three-free core: the shore's frame and profile, the surf, the swash, the
 * six nights and their wheel, the piece light and the bakes. Relations, not tuning numbers.
 */
import { describe, expect, it } from 'vitest';
import {
    EYE, EYE_OVER_SAND, NIGHTS, NIGHT_COLOURS, NIGHT_REST, NIGHT_SECONDS, SHORE, SHORE_FRAME, SURF, WAVE_LENGTH,
    bakeSeaNoise, bakeSkyNoise, breakLine, crestHeight, fromShore, lightAt, nightAt, pieceLight, runup, runupSeconds,
    sandHeight, surfAt, surfHeight, surfPhase, swashFront, toShore, turnOffset,
} from '../../src/themes/luminous-tides/luminous-tides-core.js';

const hueOf = ([r, g, b]) => {
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    if (mx - mn < 1e-6) return null;
    const d = mx - mn;
    let h;
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return (h * 60 + 360) % 360;
};
const saturation = ([r, g, b]) => {
    const mx = Math.max(r, g, b);
    return mx > 0 ? (mx - Math.min(r, g, b)) / mx : 0;
};

describe('luminous tides core: the shore', () => {
    it('has an orthonormal frame and puts the eye where the plan says', () => {
        const { along, out } = SHORE_FRAME;
        expect(Math.hypot(along.x, along.z)).toBeCloseTo(1, 9);
        expect(Math.hypot(out.x, out.z)).toBeCloseTo(1, 9);
        expect(along.x * out.x + along.z * out.z).toBeCloseTo(0, 9);
        const eye = toShore(EYE.x, EYE.z);
        expect(eye.a).toBeCloseTo(0, 6);
        expect(eye.s).toBeCloseTo(SHORE.eyeS, 6);
        expect(EYE.y).toBeCloseTo(sandHeight(SHORE.eyeS) + EYE_OVER_SAND, 9);
    });

    it('runs the shore toward the right of the picture with the sea on its left', () => {
        // Out in front of the eye is sea; to its right, up the beach.
        expect(toShore(-6, -20).s).toBeGreaterThan(0);
        expect(toShore(18, -4).s).toBeLessThan(0);
        // Far along the shore lies to the right of the view line.
        const far = fromShore(300, 0);
        expect(far.x).toBeGreaterThan(0);
        expect(far.z).toBeLessThan(0);
    });

    it('maps shore coordinates back and forth, the bay\'s far arm included', () => {
        [[-30, 4], [0, -10], [80, 25], [260, -12], [420, 3]].forEach(([a, s]) => {
            const w = fromShore(a, s);
            const back = toShore(w.x, w.z);
            expect(back.a).toBeCloseTo(a, 6);
            expect(back.s).toBeCloseTo(s, 6);
        });
    });

    it('lays the ground out: a seabed falling seaward, a beach rising inland, no cliffs, a cap', () => {
        expect(sandHeight(0)).toBeCloseTo(0, 9);
        let last = sandHeight(-80);
        for (let s = -80; s <= 120; s += 0.5) {
            const h = sandHeight(s);
            expect(h).toBeLessThanOrEqual(last + 1e-9);
            expect(Math.abs(h - last)).toBeLessThan(0.1);
            last = h;
        }
        expect(sandHeight(-5000)).toBeLessThanOrEqual(6);
        expect(sandHeight(SHORE.eyeS)).toBeGreaterThan(0);
    });
});

describe('luminous tides core: the surf', () => {
    it('counts crests forward in time and spaces them about a period apart', () => {
        let last = surfPhase(0);
        for (let t = 0.1; t < 400; t += 0.1) {
            const p = surfPhase(t);
            expect(p).toBeGreaterThan(last);
            last = p;
        }
        expect(surfPhase(1000) - surfPhase(0)).toBeCloseTo(1000 / SURF.period, 0);
    });

    it('gives every crest a height within its spread, swelled by sets, and breaks bigger waves further out', () => {
        const heights = Array.from({ length: 400 }, (_, k) => crestHeight(k));
        const lo = SURF.height * (1 - SURF.spread) * (1 - SURF.setDepth * 0.5);
        const hi = SURF.height * (1 + SURF.spread) * (1 + SURF.setDepth * 0.5);
        heights.forEach((h) => {
            expect(h).toBeGreaterThanOrEqual(lo - 1e-9);
            expect(h).toBeLessThanOrEqual(hi + 1e-9);
        });
        expect(Math.max(...heights) / Math.min(...heights)).toBeGreaterThan(1.8);
        expect(breakLine(1.2, 0)).toBeGreaterThan(breakLine(0.4, 0));
        expect(breakLine(0.05, 0)).toBeGreaterThanOrEqual(4);
    });

    it('describes a place between two crests, and the water there stays within the waves', () => {
        for (let i = 0; i < 300; i += 1) {
            const a = -20 + ((i * 7.3) % 200);
            const s = (i * 3.1) % 40;
            const t = i * 1.37;
            const at = surfAt(a, s, t);
            expect(at.f).toBeGreaterThanOrEqual(0);
            expect(at.f).toBeLessThan(1);
            expect(at.since).toBeCloseTo(at.f * SURF.period, 9);
            const h = surfHeight(a, s, t);
            expect(Number.isFinite(h)).toBe(true);
            expect(Math.abs(h)).toBeLessThan(2 * SURF.height * (1 + SURF.spread) * (1 + SURF.setDepth));
        }
        // Nothing stands up the beach.
        expect(Math.abs(surfHeight(5, -3, 17))).toBeLessThan(1e-6);
        expect(WAVE_LENGTH).toBeCloseTo(SURF.period * SURF.speed, 9);
    });
});

describe('luminous tides core: the swash', () => {
    it('runs up further for a bigger wave and comes back down where it began', () => {
        expect(runup(1)).toBeGreaterThan(runup(0.3));
        [0.3, 0.62, 1.1].forEach((H) => {
            const top = runupSeconds(H);
            expect(swashFront(H, 0)).toBe(0);
            expect(swashFront(H, top)).toBeCloseTo(runup(H), 6);
            expect(swashFront(H, top * 0.5)).toBeLessThan(runup(H));
            expect(swashFront(H, 2 * top)).toBeCloseTo(0, 6);
            expect(swashFront(H, 3 * top)).toBeCloseTo(0, 6);
        });
    });
});

describe('luminous tides core: the six nights', () => {
    it('has six nights, each with every colour row and its scalars', () => {
        expect(NIGHTS).toHaveLength(6);
        NIGHTS.forEach((night) => {
            NIGHT_COLOURS.forEach((name) => {
                expect(night[name]).toHaveLength(3);
                night[name].forEach((c) => expect(c).toBeGreaterThanOrEqual(0));
            });
            ['stars', 'milky', 'cover', 'haze', 'warmth', 'glowPower', 'exposure'].forEach((k) => {
                expect(Number.isFinite(night[k])).toBe(true);
            });
        });
    });

    it('rests on each night for a share of the step, and is on its way the rest of it', () => {
        expect(nightAt(2 + NIGHT_REST * 0.5).mix).toBe(0);
        expect(nightAt(2 + 1 - NIGHT_REST * 0.5).mix).toBe(1);
        const half = nightAt(2.5);
        expect(half.i).toBe(2);
        expect(half.j).toBe(3);
        expect(half.mix).toBeCloseTo(0.5, 6);
        // The wheel wraps.
        expect(nightAt(6.3).i).toBe(0);
        expect(nightAt(-0.5).i).toBe(5);
    });

    it('drifts by the clock alone: moved within the first minute, on the next night a step later', () => {
        const start = lightAt(0);
        const glow0 = [...start.glow];
        const minute = lightAt(60 / NIGHT_SECONDS);
        const moved = Math.hypot(...minute.glow.map((c, i) => c - glow0[i]));
        expect(moved).toBeGreaterThan(0.02);
        const next = lightAt(1 + NIGHT_REST * 0.5);
        expect(next.name).toBe(NIGHTS[1].name);
    });

    it('never melts two neighbouring nights\' sea-light through grey', () => {
        for (let i = 0; i < NIGHTS.length; i += 1) {
            for (let k = 1; k < 10; k += 1) {
                const { glow } = lightAt(i + NIGHT_REST + (1 - 2 * NIGHT_REST) * (k / 10));
                expect(saturation(glow)).toBeGreaterThan(0.6);
                const hue = hueOf(glow);
                expect(hue).toBeGreaterThan(150);
                expect(hue).toBeLessThan(240);
            }
        }
    });

    it('eases a level\'s turn of the wheel from where it was to where it goes', () => {
        expect(turnOffset(1, 2, -1)).toBe(1);
        expect(turnOffset(1, 2, 0)).toBe(1);
        expect(turnOffset(1, 2, 100)).toBe(2);
        const mid = turnOffset(1, 2, 2);
        expect(mid).toBeGreaterThan(1);
        expect(mid).toBeLessThan(2);
    });
});

describe('luminous tides core: piece light and the bakes', () => {
    it('turns a piece colour into light with its brightest channel at one, and falls back to the sea\'s blue', () => {
        const amber = pieceLight('#FFB23E');
        expect(Math.max(...amber)).toBeCloseTo(1, 9);
        expect(amber[0]).toBeGreaterThan(amber[2]);
        expect(pieceLight('not a colour')).toEqual([0.2, 0.62, 1]);
        expect(pieceLight('#000000')).toEqual([0.2, 0.62, 1]);
    });

    it('bakes its noise deterministically, at the size asked for', () => {
        const a = bakeSkyNoise(64);
        const b = bakeSkyNoise(64);
        expect(a).toHaveLength(64 * 64 * 4);
        expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
        const sea = bakeSeaNoise(64);
        expect(sea.data).toHaveLength(64 * 64 * 4);
        expect(sea.variance).toBeGreaterThan(0);
        // The lace channel has threads and holes.
        let lit = 0;
        for (let i = 2; i < sea.data.length; i += 4) if (sea.data[i] > 128) lit += 1;
        expect(lit / (64 * 64)).toBeGreaterThan(0.01);
        expect(lit / (64 * 64)).toBeLessThan(0.6);
    });
});

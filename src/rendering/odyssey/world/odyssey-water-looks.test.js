import { describe, expect, it } from 'vitest';
import {
    LAKE_RAMP, LAKE_WATER, SEA_HORIZON_DOWN, SEA_SURF, WATER_SHORE_DEPTH_BIAS,
    depthStepAlongRay, lakeBodyAt, lakeShoreOpacity, lakeShoreWidth, lakeWetLip, seaBodyAt, seaFilmOpacity,
    seaHorizonKeep, seaSurfLine, shoreFightBand,
} from './odyssey-water-looks.js';

const luma = (c) => (0.2126 * c[0]) + (0.7152 * c[1]) + (0.0722 * c[2]);
const depths = Array.from({ length: 481 }, (_, i) => i * 0.25); // 0..120 u

describe('the waters\' depth colour (2026-11-02)', () => {
    [['lake', lakeBodyAt], ['sea', seaBodyAt]].forEach(([name, bodyAt]) => {
        it(`${name}: darkens and turns bluer with depth, never back`, () => {
            let prev = bodyAt(0);
            depths.slice(1).forEach((d) => {
                const c = bodyAt(d);
                expect(luma(c), `${name} at ${d}`).toBeLessThanOrEqual(luma(prev) + 1e-9);
                expect(c[2] / c[1], `${name} at ${d}`).toBeGreaterThanOrEqual((prev[2] / prev[1]) - 1e-9);
                prev = c;
            });
        });
    });

    it('lake: turquoise over the shelf, deep blue in the middle of the basin', () => {
        const shore = lakeBodyAt(1);
        expect(shore).toEqual([...LAKE_RAMP.shore]);
        expect(shore[1]).toBeGreaterThan(shore[2]); // green over blue: turquoise
        const middle = lakeBodyAt(40); // the main basin
        expect(middle[2]).toBeGreaterThan(middle[1]); // blue over green
        expect(luma(middle)).toBeLessThan(luma(shore) * 0.6);
    });

    it('lake: the plates step at ~3, 10 and 22 u of depth (turquoise, teal, blue, deep blue)', () => {
        // The first plate (the shore colour) holds to ~3 u of depth and the teal to ~10 u, so the
        // shelf's colour is several pixels wide from the climb, not a sub-pixel line.
        expect(lakeBodyAt(2.5)).toEqual([...LAKE_RAMP.shore]);
        expect(lakeBodyAt(3.4)).not.toEqual([...LAKE_RAMP.shore]);
        const step = (a, b) => luma(lakeBodyAt(a)) - luma(lakeBodyAt(b));
        expect(step(9.5, 11.5)).toBeGreaterThan(0.02);
        expect(step(20.5, 23)).toBeGreaterThan(0.02);
        expect(step(12, 20)).toBeCloseTo(0, 9); // flat inside a plate
        expect(LAKE_WATER.absorb).toBeGreaterThan(0);
    });
});

describe('the sea\'s horizon dissolve keeps to the horizon (2026-11-02)', () => {
    it('stays whole looking along the water (the shore orbs) and is gone looking down (the climb)', () => {
        expect(seaHorizonKeep(0)).toBe(1);
        expect(seaHorizonKeep(SEA_HORIZON_DOWN[0])).toBe(1);
        // ~11 degrees down: the east isle from the climb
        expect(seaHorizonKeep(Math.sin((11 * Math.PI) / 180))).toBeLessThan(0.25);
        expect(seaHorizonKeep(SEA_HORIZON_DOWN[1])).toBe(0);
        expect(seaHorizonKeep(1)).toBe(0);
    });

    it('lets go smoothly as the view steepens', () => {
        let prev = 1;
        for (let a = 0; a <= 90; a += 0.5) {
            const k = seaHorizonKeep(Math.sin((a * Math.PI) / 180));
            expect(k).toBeLessThanOrEqual(prev + 1e-12);
            expect(prev - k).toBeLessThan(0.08); // no step between half-degree samples
            prev = k;
        }
    });
});

describe('the surf line from afar (2026-11-02)', () => {
    it('lies only on the waterline: nothing past a few pixels of water or a pixel of dry sand', () => {
        [1.2, 2, 5, 20].forEach((depthPx) => {
            [0, 0.5, 1].forEach((pulse) => {
                const outer = SEA_SURF.widthPx[1] * depthPx;
                expect(seaSurfLine(outer + 1e-6, depthPx, pulse)).toBe(0);
                expect(seaSurfLine(outer * 4, depthPx, pulse)).toBe(0);
                expect(seaSurfLine(-1.0001 * depthPx, depthPx, pulse)).toBe(0);
                expect(seaSurfLine(0.5 * depthPx, depthPx, pulse)).toBeGreaterThan(0.5 * SEA_SURF.thinKeep);
            });
        });
    });

    it('keeps its width in pixels at any range and slope', () => {
        // (measured against its own peak: far off it thins, but keeps its width)
        const widthPx = (depthPx) => {
            const peak = seaSurfLine(0.5 * depthPx, depthPx);
            let n = 0;
            for (let u = -2; u <= 6; u += 0.01) if (seaSurfLine(u * depthPx, depthPx) > 0.25 * peak) n += 1;
            return n * 0.01;
        };
        const near = widthPx(1.5);
        [3, 10, 40].forEach((d) => expect(widthPx(d)).toBeCloseTo(near, 1));
        expect(near).toBeGreaterThan(1.5);
        expect(near).toBeLessThan(4);
    });

    it('leaves the near shore to the swash front (a pixel spans under ~0.3 m of depth)', () => {
        [0, 0.05, 0.1, 0.2].forEach((d) => expect(seaSurfLine(d, 0.25)).toBe(0));
        expect(seaSurfLine(0.2, 0.3)).toBe(0);
    });

    it('thins (but stays) where one pixel spans the whole surf zone', () => {
        const at = (px) => seaSurfLine(0.5 * px, px);
        expect(at(1.5)).toBeGreaterThan(0.9);
        expect(at(SEA_SURF.thinPx[0])).toBeCloseTo(at(1.5), 9);
        expect(at(SEA_SURF.thinPx[1])).toBeCloseTo(at(1.5) * SEA_SURF.thinKeep, 9);
        expect(at(50)).toBeGreaterThan(0);
        let prev = at(SEA_SURF.thinPx[0]);
        for (let px = SEA_SURF.thinPx[0]; px <= SEA_SURF.thinPx[1] + 1; px += 0.1) {
            expect(at(px)).toBeLessThanOrEqual(prev + 1e-12);
            prev = at(px);
        }
    });

    it('is broken, not cut: a broken stretch keeps part of the line', () => {
        const whole = seaSurfLine(1, 1.5, 0, 1);
        const broken = seaSurfLine(1, 1.5, 0, 0);
        expect(broken).toBeCloseTo(whole * SEA_SURF.broken, 9);
        expect(broken).toBeGreaterThan(0);
    });
});

describe('the lake\'s soft shore (2026-11-02)', () => {
    it('is clear at the waterline and the full film past the shore band', () => {
        [0, 0.3, 1, 4, 12].forEach((depthPx) => {
            const w = lakeShoreWidth(depthPx);
            expect(w).toBeGreaterThanOrEqual(LAKE_WATER.shore);
            expect(lakeShoreOpacity(0, depthPx)).toBe(0);
            expect(lakeShoreOpacity(-1, depthPx)).toBe(0);
            expect(lakeShoreOpacity(w, depthPx)).toBe(1);
            expect(lakeShoreOpacity(w * 0.5, depthPx)).toBeCloseTo(0.5, 9);
        });
    });

    it('fades over at least three pixels from afar', () => {
        expect(lakeShoreWidth(2)).toBeCloseTo(2 * LAKE_WATER.shorePx, 9);
        expect(LAKE_WATER.shorePx).toBeGreaterThanOrEqual(3);
    });

    it('draws its pale wet line on the thin film only', () => {
        [0.2, 2, 8].forEach((depthPx) => {
            const w = lakeShoreWidth(depthPx);
            expect(lakeWetLip(w * 0.6, depthPx)).toBe(0);
            expect(lakeWetLip(w * 3, depthPx)).toBe(0);
            expect(lakeWetLip(w * 0.2, depthPx)).toBeGreaterThan(0);
            expect(lakeWetLip(w * 0.2, depthPx)).toBeLessThanOrEqual(LAKE_WATER.lip);
        });
    });
});

describe('no NaN anywhere in the waters\' terms', () => {
    it('holds for any depth and any pixel footprint, zero and huge included', () => {
        const ds = [-1e6, -50, -1, 0, 1e-9, 0.5, 3, 47, 207, 1e6];
        const pxs = [0, 1e-9, 1e-3, 0.3, 1, 7, 1e4];
        ds.forEach((d) => {
            [...lakeBodyAt(Math.max(d, 0)), ...seaBodyAt(Math.max(d, 0))].forEach((v) => expect(Number.isFinite(v)).toBe(true));
            pxs.forEach((px) => {
                [seaSurfLine(d, px, 0.5, 0.5), lakeShoreOpacity(d, px), lakeWetLip(d, px)]
                    .forEach((v) => expect(Number.isFinite(v), `${d} ${px}`).toBe(true));
            });
        });
        [-1, 0, 0.05, 0.3, 1, 2].forEach((s) => expect(Number.isFinite(seaHorizonKeep(s))).toBe(true));
    });
});

describe('the shore depth fight (2026-11-03)', () => {
    // The game's camera: PerspectiveCamera(60, aspect, 0.1, 9000), a standard depth buffer. The
    // finest screen the owner plays on (1440 rows) makes the pixel smallest, so the test strictest.
    const NEAR = 0.1;
    const PX = ((60 * Math.PI) / 180) / 1440;
    const BEACH = Math.tan((2 * Math.PI) / 180); // the north beach's sand and shelf
    const deg = (a) => Math.sin((a * Math.PI) / 180);
    /**
     * How much an undecided depth test can show at a shore: the most the film (or its foam) covers
     * anywhere in the band, times how much of a pixel the band is wide (a band under a pixel only
     * shimmers by its share of it).
     */
    const flickerWeight = (range, down, units) => {
        const [lo, hi] = shoreFightBand(range, down, NEAR, units);
        const depthPx = (BEACH * range * PX) / down; // depth one pixel spans on the beach
        let most = 0;
        for (let i = 0; i <= 64; i += 1) {
            const depth = -(lo + (((hi - lo) * i) / 64)); // heights above the water are negative depths
            most = Math.max(most, seaFilmOpacity(depth), seaSurfLine(depth, depthPx) * SEA_SURF.gain * 0.92);
        }
        const widthPx = (hi - lo) / BEACH / ((range * PX) / down);
        return most * Math.min(1, widthPx);
    };

    it('a depth step is ~2.4 u along a ray at 2 km and microscopic near the eye', () => {
        expect(depthStepAlongRay(2000, NEAR)).toBeCloseTo(2.38, 1);
        expect(depthStepAlongRay(300, NEAR)).toBeLessThan(0.06);
    });

    it('without the bias the climb saw the band on the waterline, where the film and the surf line show', () => {
        [1700, 2000, 2100].forEach((range) => [15, 20, 25].forEach((a) => {
            expect(flickerWeight(range, deg(a), 0), `${range} u, ${a} deg`).toBeGreaterThan(0.3);
        }));
    });

    it('with the bias the band lies on the dry sand, where nothing is drawn, from the climb', () => {
        [1500, 1700, 2000, 2100, 2500, 3500].forEach((range) => [10, 15, 20, 25, 35].forEach((a) => {
            expect(flickerWeight(range, deg(a), WATER_SHORE_DEPTH_BIAS), `${range} u, ${a} deg`).toBeLessThan(0.01);
        }));
    });

    it('is never worse than without it, and faint at every range and angle', () => {
        // Near the eye the band is a hair wide on the film's own faint edge (its 9% at the
        // waterline), with or without the bias. Looking along the water at a far coast it can touch
        // the surf line's soft edge a pixel over the sand, a third of a pixel wide.
        for (let range = 50; range <= 6000; range += 50) {
            [3, 5, 10, 20, 30, 45].forEach((a) => {
                const w = flickerWeight(range, deg(a), WATER_SHORE_DEPTH_BIAS);
                expect(w, `${range} u, ${a} deg`).toBeLessThanOrEqual(flickerWeight(range, deg(a), 0) + 1e-12);
                expect(w, `${range} u, ${a} deg`).toBeLessThan(0.12);
            });
        }
    });

    it('moves little near the eye: under 0.2 u of ray within 300 u', () => {
        expect(WATER_SHORE_DEPTH_BIAS * depthStepAlongRay(300, NEAR)).toBeLessThan(0.2);
        expect(WATER_SHORE_DEPTH_BIAS).toBeGreaterThanOrEqual(2); // a margin over one step of noise
    });

    it('the lake film is exactly clear on the dry side, so its band shows nothing at all', () => {
        [500, 1000, 2000].forEach((range) => {
            const [lo, hi] = shoreFightBand(range, deg(30), NEAR);
            expect(lo).toBeGreaterThan(0);
            expect(lakeShoreOpacity(-lo, 1)).toBe(0);
            expect(lakeShoreOpacity(-hi, 1)).toBe(0);
        });
    });
});

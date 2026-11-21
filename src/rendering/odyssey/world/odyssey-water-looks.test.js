import { describe, expect, it } from 'vitest';
import {
    LAKE_WATER, SEA_HORIZON_DOWN, SEA_SURF, WATER_SHORE_DEPTH_BIAS,
    SEA_AIR, depthStepAlongRay, lakeClearAt, seaAirOwn, lakeShoreOpacity, lakeShoreWidth, seaBodyAt, seaFilmOpacity,
    seaHorizonKeep, seaSurfLine, shoreFightBand,
} from './odyssey-water-looks.js';

const luma = (c) => (0.2126 * c[0]) + (0.7152 * c[1]) + (0.0722 * c[2]);
const depths = Array.from({ length: 481 }, (_, i) => i * 0.25); // 0..120 u

describe('the waters\' depth colour (2026-11-02)', () => {
    [['sea', seaBodyAt]].forEach(([name, bodyAt]) => {
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

    // THE LAKE IS CLEAR WATER (2026-11-21): its bed shows through by its depth, and its own colour
    // goes from turquoise over the shelf to deep blue in the basins (the owner's "turquoise-to-
    // blue"), the tarn's form.
    it('lake: the bed shows through the shelf and is gone in the basins', () => {
        expect(lakeClearAt(0)).toBe(1);
        expect(lakeClearAt(1)).toBeGreaterThan(0.5);
        expect(lakeClearAt(10)).toBeLessThan(0.02);
        expect(lakeClearAt(-3)).toBe(1);
        let prev = 1;
        depths.forEach((d) => {
            const c = lakeClearAt(d);
            expect(c).toBeLessThanOrEqual(prev);
            prev = c;
        });
    });

    it('lake: its own colour is turquoise in the shallows and a deep blue past the blend', () => {
        const [s, d] = [LAKE_WATER.shallow, LAKE_WATER.deep];
        expect(s[1]).toBeGreaterThan(s[0] * 3); // green-blue, not grey
        expect(s[2]).toBeGreaterThan(s[0] * 3);
        expect(d[2]).toBeGreaterThan(d[1]); // blue over green in the deep
        expect(luma(d)).toBeLessThan(luma(s));
        expect(LAKE_WATER.blend[0]).toBeLessThan(LAKE_WATER.blend[1]);
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

    it('fades over at least two pixels from afar, and draws no pale line on its edge', () => {
        // (2 px since 2026-11-21: the drawn lake's shelf is gentle, so its depth is what fades it;
        // the pale wet line is gone, an outline round the water from the climb.)
        expect(lakeShoreWidth(2)).toBeCloseTo(2 * LAKE_WATER.shorePx, 9);
        expect(LAKE_WATER.shorePx).toBeGreaterThanOrEqual(2);
        expect(LAKE_WATER.lip).toBeUndefined();
    });
});

describe('no NaN anywhere in the waters\' terms', () => {
    it('holds for any depth and any pixel footprint, zero and huge included', () => {
        const ds = [-1e6, -50, -1, 0, 1e-9, 0.5, 3, 47, 207, 1e6];
        const pxs = [0, 1e-9, 1e-3, 0.3, 1, 7, 1e4];
        ds.forEach((d) => {
            [lakeClearAt(d), ...seaBodyAt(Math.max(d, 0))].forEach((v) => expect(Number.isFinite(v)).toBe(true));
            pxs.forEach((px) => {
                [seaSurfLine(d, px, 0.5, 0.5), lakeShoreOpacity(d, px)]
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

// THE SEA'S OWN AIR FROM ABOVE (2026-11-21 sea audit, item 1): seen from the climb the near sea
// keeps a value of its own; the far band, grazing rays, the sun's side, the shore eyes and the
// Earth's departure keep the horizon's air.
describe('the sea\'s own air from above (2026-11-21)', () => {
    it('is whole for the climb looking down on the sea away from the sun', () => {
        // c31: 2-4 km, 9-20 degrees down, the eye ~1 km over the sea.
        [2000, 3000, 4000].forEach((range) => {
            [0.16, 0.25, 0.34].forEach((down) => {
                expect(seaAirOwn(range, down, -0.3, 1000)).toBeGreaterThan(0.99);
            });
        });
    });

    it('leaves the shore orbs, the horizon, the far band, the sun side and the Earth alone', () => {
        expect(seaAirOwn(500, 0.3, -0.3, 12)).toBe(0); // a shore orb's eye
        expect(seaAirOwn(3000, 0.02, -0.3, 1000)).toBe(0); // grazing, within ~1.7 degrees
        expect(seaAirOwn(9000, 0.3, -0.3, 1000)).toBe(0); // the far band meets the dome
        expect(seaAirOwn(3000, 0.3, 0.9, 1000)).toBe(0); // toward the low sun: its warm air
        expect(seaAirOwn(3000, 0.3, -0.3, 1000, 1)).toBe(0); // the departure's Earth
        expect(SEA_AIR.mistAbove).toBeLessThan(1);
    });

    it('comes in smoothly with each of its gates', () => {
        let prev = 0;
        for (let eye = 100; eye <= 320; eye += 5) {
            const v = seaAirOwn(3000, 0.3, -0.3, eye);
            expect(v).toBeGreaterThanOrEqual(prev);
            expect(v - prev).toBeLessThan(0.06);
            prev = v;
        }
    });
});

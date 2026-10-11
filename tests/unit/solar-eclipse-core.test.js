/**
 * Solar Eclipse — the numbers of the scene: frames, ranges, the corona's field, the moon, the
 * light of the hour, the chain and the board on the limb. CPU only; nothing here pins a look.
 */
import { describe, expect, it } from 'vitest';
import {
    BRIGHT_POINTS,
    CORONA,
    DEG,
    HOUR_REST,
    HOUR_SECONDS,
    KIND,
    LIMB_FROM,
    LIMB_TO,
    MOON,
    NOISE_SIZE,
    PALETTES,
    PALETTE_KEYS,
    PALETTE_SCALARS,
    PROMINENCES,
    RANGES,
    RIDGE_SAMPLES,
    RIDGE_SPAN,
    STREAMERS,
    STREAMER_SET,
    TAU,
    WORLD,
    axisAt,
    bakeNoise,
    bakeRanges,
    crestAt,
    exposureFor,
    hexToLinear,
    highestCrest,
    limbAngleFor,
    moonWander,
    paletteAt,
    prominenceShape,
    streamersAt,
    sunFrame,
    sunPlaneToWorld,
    worldToSunPlane,
    wrapAngle,
} from '../../src/themes/solar-eclipse/solar-eclipse-core.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.sqrt(dot(a, a));

/** Saturation (HSV) of a linear colour. */
const saturation = (c) => {
    const hi = Math.max(...c);
    const lo = Math.min(...c);
    return hi > 0 ? (hi - lo) / hi : 0;
};

describe('solar eclipse core: frames', () => {
    it('builds an orthonormal frame round the sun, right level and up toward the zenith', () => {
        [[0, 12 * DEG], [-0.3, 9 * DEG], [0.4, 30 * DEG]].forEach(([az, alt]) => {
            const f = sunFrame(az, alt);
            expect(len(f.dir)).toBeCloseTo(1, 9);
            expect(len(f.right)).toBeCloseTo(1, 9);
            expect(len(f.up)).toBeCloseTo(1, 9);
            expect(dot(f.dir, f.right)).toBeCloseTo(0, 9);
            expect(dot(f.dir, f.up)).toBeCloseTo(0, 9);
            expect(dot(f.right, f.up)).toBeCloseTo(0, 9);
            expect(f.right[1]).toBeCloseTo(0, 9);
            expect(f.up[1]).toBeGreaterThan(0);
            expect(Math.asin(f.dir[1])).toBeCloseTo(alt, 9);
        });
    });

    it('maps the sun\'s plane to the sky and back', () => {
        const f = sunFrame(-0.2, 11 * DEG);
        const tanR = Math.tan(2.6 * DEG);
        [[0, 0], [1, 0], [0, -1], [3.5, 2.2], [-6, 1]].forEach(([x, y]) => {
            const d = sunPlaneToWorld(f, tanR, x, y);
            expect(len(d)).toBeCloseTo(1, 9);
            const back = worldToSunPlane(f, tanR, d);
            expect(back[0]).toBeCloseTo(x, 6);
            expect(back[1]).toBeCloseTo(y, 6);
            expect(back[2]).toBe(1);
        });
    });

    it('folds angles into one turn', () => {
        expect(Math.abs(wrapAngle(3 * Math.PI))).toBeCloseTo(Math.PI, 9);
        expect(wrapAngle(-TAU - 0.5)).toBeCloseTo(-0.5, 9);
        expect(Math.abs(wrapAngle(7.3))).toBeLessThanOrEqual(Math.PI);
    });

    it('reads a piece\'s hex colour as linear light, and refuses anything else', () => {
        const out = [0, 0, 0];
        expect(hexToLinear('#ff8000', out)).toBe(true);
        expect(out[0]).toBeCloseTo(1, 6);
        expect(out[1]).toBeGreaterThan(0.2);
        expect(out[1]).toBeLessThan(0.25);
        expect(out[2]).toBe(0);
        expect(hexToLinear('rgb(1,2,3)', out)).toBe(false);
        expect(hexToLinear(null, out)).toBe(false);
    });
});

describe('solar eclipse core: the baked noise', () => {
    it('is deterministic and spans every channel', () => {
        const a = bakeNoise(7, 64);
        const b = bakeNoise(7, 64);
        expect(a).toEqual(b);
        expect(a.length).toBe(64 * 64 * 4);
        for (let c = 0; c < 4; c += 1) {
            let lo = 255;
            let hi = 0;
            for (let i = c; i < a.length; i += 4) {
                lo = Math.min(lo, a[i]);
                hi = Math.max(hi, a[i]);
            }
            expect(lo).toBe(0);
            expect(hi).toBe(255);
        }
        expect(NOISE_SIZE).toBe(256);
    });
});

describe('solar eclipse core: the ranges', () => {
    const ranges = bakeRanges();

    it('stands farthest first, each nearer range lower on the horizon', () => {
        expect(RANGES).toHaveLength(6);
        for (let i = 1; i < RANGES.length; i += 1) {
            expect(RANGES[i].distance).toBeLessThan(RANGES[i - 1].distance);
            expect(RANGES[i].base).toBeLessThan(RANGES[i - 1].base);
        }
    });

    it('bakes every crest the same way twice, within its range of heights', () => {
        const again = bakeRanges();
        expect(ranges.crests).toHaveLength(RANGES.length);
        ranges.crests.forEach((crest, layer) => {
            expect(crest).toHaveLength(RIDGE_SAMPLES);
            expect(crest).toEqual(again.crests[layer]);
            const { base, amp } = RANGES[layer];
            let lo = Infinity;
            let hi = -Infinity;
            crest.forEach((h) => {
                lo = Math.min(lo, h);
                hi = Math.max(hi, h);
            });
            expect(lo).toBeGreaterThanOrEqual(base - 1e-9);
            expect(hi).toBeLessThanOrEqual(base + amp * 1.4);
            // A real range: its peaks rise well above its lowest passes.
            expect(hi - lo).toBeGreaterThan(amp * 0.3);
        });
    });

    it('reads a crest between its samples as the GPU does, and clamps beyond the table', () => {
        const step = (2 * RIDGE_SPAN) / (RIDGE_SAMPLES - 1);
        const i = 900;
        const az = ((i / (RIDGE_SAMPLES - 1)) * 2 - 1) * RIDGE_SPAN;
        expect(crestAt(ranges, 2, az)).toBeCloseTo(ranges.crests[2][i], 9);
        const mid = crestAt(ranges, 2, az + step / 2);
        expect(mid).toBeCloseTo((ranges.crests[2][i] + ranges.crests[2][i + 1]) / 2, 9);
        expect(crestAt(ranges, 0, 10)).toBe(ranges.crests[0][RIDGE_SAMPLES - 1]);
        expect(crestAt(ranges, 0, -10)).toBe(ranges.crests[0][0]);
    });

    it('keeps the slopes the sunlit range is lit by', () => {
        expect(ranges.slopes).toHaveLength(RANGES.length);
        const i = 1000;
        const daz = (2 * RIDGE_SPAN) / (RIDGE_SAMPLES - 1);
        const expected = (ranges.crests[0][i + 1] - ranges.crests[0][i - 1]) / (2 * daz);
        expect(ranges.slopes[0][i]).toBeCloseTo(expected, 6);
    });

    it('never lifts a peak to where the sun stands', () => {
        // The sun stands at least ~9° up in every composition; no crest comes near that.
        expect(highestCrest(ranges, -RIDGE_SPAN, RIDGE_SPAN)).toBeLessThan(4 * DEG);
    });
});

describe('solar eclipse core: the corona\'s field', () => {
    it('closes the field below the cusp and opens it above the source surface', () => {
        expect(CORONA.cuspLatitude).toBeCloseTo(Math.acos(1 / Math.sqrt(CORONA.sourceSurface)), 12);
        // A dipole line from the cusp's foot reaches the source surface at the equator.
        const foot = CORONA.cuspLatitude;
        const L = 1 / Math.cos(foot) ** 2;
        expect(L).toBeCloseTo(CORONA.sourceSurface, 9);
        expect(CORONA.inner).toBeGreaterThan(CORONA.outer);
        expect(CORONA.innerPower).toBeGreaterThan(CORONA.outerPower);
    });

    it('raises the extra streamers one by one as the cycle climbs', () => {
        expect(STREAMER_SET).toHaveLength(STREAMERS);
        const count = (cycle) => Array.from(streamersAt(cycle)).filter((s) => s > 0.25).length;
        expect(count(0)).toBeLessThanOrEqual(1);
        expect(count(0.5)).toBeGreaterThan(count(0.1));
        expect(count(1)).toBeGreaterThan(count(0.5));
        expect(count(1)).toBeGreaterThanOrEqual(STREAMERS - 1);
        STREAMER_SET.forEach((s) => {
            expect(Math.abs(s.angle)).toBeLessThanOrEqual(Math.PI);
            expect(s.width).toBeGreaterThan(0.1);
        });
        // Never brighter as the cycle falls.
        const lo = streamersAt(0.3);
        const hi = streamersAt(0.7);
        for (let i = 0; i < STREAMERS; i += 1) expect(hi[i]).toBeGreaterThanOrEqual(lo[i]);
    });

    it('sways the sun\'s axis slowly about its rest', () => {
        expect(axisAt(0)).toBeCloseTo(CORONA.axis, 9);
        expect(axisAt(CORONA.axisSeconds)).toBeCloseTo(CORONA.axis, 9);
        expect(Math.abs(axisAt(CORONA.axisSeconds / 4) - CORONA.axis)).toBeCloseTo(CORONA.axisSway, 9);
        // Slowly: a second moves it a fraction of a degree.
        expect(Math.abs(axisAt(31) - axisAt(30))).toBeLessThan(0.5 * DEG);
    });
});

describe('solar eclipse core: the moon', () => {
    it('covers the photosphere at rest, wherever it wanders and whatever valley meets the limb', () => {
        for (let t = 0; t < 600; t += 3.7) {
            const [x, y] = moonWander(t);
            const off = Math.hypot(x, y);
            expect(off).toBeLessThanOrEqual(MOON.wander + 1e-9);
            // The moon's nearest edge to the sun's limb, at its deepest valley, is still outside it.
            expect(MOON.ratio - off - MOON.valley).toBeGreaterThan(1);
        }
    });

    it('slides far enough for the diamond to break through, and leaves the chromosphere a sliver at rest', () => {
        expect(MOON.ratio - MOON.diamond - MOON.valley).toBeLessThan(1);
        // At rest the chromosphere shows on the side away from the moon's offset.
        expect(1 + MOON.chromosphere).toBeGreaterThan(MOON.ratio - MOON.wander);
        // …but the moon's far side still hides it.
        expect(MOON.ratio + 0).toBeLessThan(1 + MOON.chromosphere * 1.15 + MOON.flashLift);
    });

    it('wanders, so the sliver creeps round the limb', () => {
        const a = moonWander(0);
        const b = moonWander(MOON.wanderA / 2);
        expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(MOON.wander * 0.8);
    });
});

describe('solar eclipse core: the light of the hour', () => {
    it('keeps six palettes, each with every colour and scalar', () => {
        expect(PALETTES.map((p) => p.name)).toEqual(['ember', 'gold', 'jade', 'azure', 'violet', 'rose']);
        PALETTES.forEach((p) => {
            PALETTE_KEYS.forEach((key) => {
                expect(p[key], `${p.name}.${key}`).toHaveLength(3);
                p[key].forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
            });
            PALETTE_SCALARS.forEach((key) => expect(Number.isFinite(p[key]), `${p.name}.${key}`).toBe(true));
            expect(p.cycle).toBeGreaterThanOrEqual(0);
            expect(p.cycle).toBeLessThanOrEqual(1);
        });
    });

    it('keeps the shadow dark and the horizon bright in every palette', () => {
        PALETTES.forEach((p) => {
            const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
            expect(lum(p.zenith), p.name).toBeLessThan(0.02);
            expect(lum(p.glow), p.name).toBeGreaterThan(lum(p.horizon));
            expect(lum(p.horizon), p.name).toBeGreaterThan(lum(p.mid));
            expect(lum(p.ridge), p.name).toBeLessThan(lum(p.mid));
        });
    });

    it('rests briefly on a palette, then turns for most of the step', () => {
        expect(HOUR_REST).toBeLessThanOrEqual(0.15);
        expect(paletteAt(0).turn).toBe(0);
        expect(paletteAt(0.1).turn).toBe(0);
        expect(paletteAt(0.5).turn).toBeCloseTo(0.5, 6);
        expect(paletteAt(0.95).turn).toBe(1);
        // The clock alone moves the light within the first minute.
        expect(paletteAt(60 / HOUR_SECONDS).turn).toBeGreaterThan(0.3);
    });

    it('goes round the wheel and wraps back to the first palette', () => {
        expect(paletteAt(PALETTES.length).index).toBe(0);
        expect(paletteAt(-1).index).toBe(PALETTES.length - 1);
        expect(paletteAt(2.05).glow).toEqual(PALETTES[2].glow);
        const end = paletteAt(PALETTES.length - 0.01);
        PALETTE_KEYS.forEach((key) => {
            for (let j = 0; j < 3; j += 1) expect(end[key][j]).toBeCloseTo(PALETTES[0][key][j], 6);
        });
    });

    it('never mixes two neighbours through grey: the glow and the band keep their colour half-way', () => {
        for (let i = 0; i < PALETTES.length; i += 1) {
            const half = paletteAt(i + 0.5);
            const a = PALETTES[i];
            const b = PALETTES[(i + 1) % PALETTES.length];
            ['glow', 'horizon', 'alpen'].forEach((key) => {
                const floor = Math.min(saturation(a[key]), saturation(b[key])) * 0.45;
                expect(saturation(half[key]), `${a.name}→${b.name} ${key}`).toBeGreaterThan(floor);
            });
        }
    });
});

describe('solar eclipse core: the chain', () => {
    it('opens no exposure for a single clear, and a longer one the longer the chain', () => {
        expect(exposureFor(0)).toBe(0);
        expect(exposureFor(1)).toBe(0);
        let last = 0;
        for (let n = 2; n < 20; n += 1) {
            const e = exposureFor(n);
            expect(e).toBeGreaterThan(last);
            expect(e).toBeLessThan(1);
            last = e;
        }
        expect(exposureFor(10)).toBeGreaterThan(0.8);
        expect(exposureFor(undefined)).toBe(0);
    });
});

describe('solar eclipse core: the board on the limb', () => {
    it('lays the columns over the top of the sun, left to right', () => {
        expect(limbAngleFor(0)).toBeCloseTo(LIMB_FROM, 9);
        expect(limbAngleFor(1)).toBeCloseTo(LIMB_TO, 9);
        expect(Math.cos(limbAngleFor(0))).toBeLessThan(-0.9);
        expect(Math.cos(limbAngleFor(1))).toBeGreaterThan(0.9);
        expect(Math.sin(limbAngleFor(0.5))).toBeCloseTo(1, 6);
        for (let u = 0.05; u <= 1; u += 0.05) expect(limbAngleFor(u)).toBeLessThan(limbAngleFor(u - 0.05));
        expect(limbAngleFor(-3)).toBe(limbAngleFor(0));
        expect(limbAngleFor(7)).toBe(limbAngleFor(1));
        expect(limbAngleFor(Number.NaN)).toBe(limbAngleFor(0.5));
    });

    it('raises arches and hedgerows, and a taller, wider arch on a hard drop', () => {
        expect(PROMINENCES).toBeGreaterThanOrEqual(10);
        const kinds = new Set();
        for (let s = 0; s < 1; s += 0.05) {
            const shape = prominenceShape(s);
            kinds.add(shape.kind);
            expect(shape.halfWidth).toBeGreaterThan(0.08);
            expect(shape.height).toBeGreaterThan(0.15);
            const hard = prominenceShape(s, true);
            expect(hard.kind).toBe(KIND.arch);
            expect(hard.height).toBeGreaterThan(shape.kind === KIND.arch ? shape.height : 0);
        }
        expect([...kinds].sort()).toEqual([KIND.arch, KIND.hedge]);
    });
});

describe('solar eclipse core: the stage', () => {
    it('stands the sun beside the card, well above the horizon', () => {
        expect(WORLD.sunScreenX).toBeLessThan(0.3);
        expect(WORLD.sunScreenY).toBeLessThan(WORLD.horizonY - 0.25);
        expect(WORLD.sunShare).toBeGreaterThan(0.05);
        expect(WORLD.sunShare).toBeLessThan(0.15);
    });

    it('lets the planets out round the sun, Venus the brightest', () => {
        const powers = BRIGHT_POINTS.map((p) => p[2]);
        expect(Math.max(...powers)).toBe(BRIGHT_POINTS[0][2]);
        BRIGHT_POINTS.forEach(([x, y]) => expect(Math.hypot(x, y)).toBeGreaterThan(4));
    });
});

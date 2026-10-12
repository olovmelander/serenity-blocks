/**
 * Sky Children — the three-free core: the droplet-optics table every optic reads (where the
 * bows, the dark band, the fogbow and the glory fall, and that the table is the same physics at
 * any width), the noise bakes, colour, the falls' ballistics and the pieces' cells. Relations
 * and physics, not tuning numbers: constants are imported.
 */
import { describe, expect, it } from 'vitest';
import {
    FALL_SWAY, G, OPTICS, OPTICS_RANGE, OPTICS_WIDTH, WATER_WRAP, airyAi, bakeOpticsLut, bakePuff, bakeSkyNoise,
    bakeStoneNoise, besselJ0, besselJ1, bowRay, cellsFromMatrix, fallLength, fallPoint, fallSway, fromOklch, hexToLinear,
    lerpOklch, linearToOklab, mulberry32, oklabToLinear, opticsAt, pieceLight, toOklch, travelTime,
} from '../../src/themes/sky-children/sky-children-core.js';
import { SKY_CHILDREN_TETROMINOS } from '../../src/themes/sky-children/sky-children-tetrominos.js';
import { SHAPES } from '../../src/core/constants.js';
import { rotateShape } from '../../src/core/pieces.js';

const W = OPTICS_WIDTH;
const LUT = bakeOpticsLut(W);
const thetaOf = (row, i, width = W) => (OPTICS_RANGE[row] * (i + 0.5)) / width;
const texel = (row, i, c, lut = LUT, width = W) => lut[(row * width + i) * 4 + c];
const luma = (row, i) => 0.2126 * texel(row, i, 0) + 0.7152 * texel(row, i, 1) + 0.0722 * texel(row, i, 2);
const grey = (row, i) => (texel(row, i, 0) + texel(row, i, 1) + texel(row, i, 2)) / 3;

/** The angle (degrees) of a channel's brightest texel in a row, within [lo, hi]. */
function peakAt(row, c, lo = 0, hi = OPTICS_RANGE[row]) {
    let best = -1;
    let at = 0;
    for (let i = 0; i < W; i++) {
        const t = thetaOf(row, i);
        if (t >= lo && t <= hi && texel(row, i, c) > best) {
            best = texel(row, i, c);
            at = t;
        }
    }
    return { at, value: best };
}

/** Texel angles of a curve's local maxima within [lo, hi]. */
function maxima(read, row, lo, hi) {
    const found = [];
    for (let i = 1; i < W - 1; i++) {
        const t = thetaOf(row, i);
        if (t < lo || t > hi) continue;
        const v = read(i);
        if (v > read(i - 1) && v >= read(i + 1)) found.push({ at: t, value: v });
    }
    return found;
}

/** Mean of all three channels of rows `rows` over θ in [lo, hi]. */
function mean(rows, lo, hi) {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < W; i++) {
        const t = thetaOf(rows[0], i);
        if (t < lo || t > hi) continue;
        for (let k = 0; k < rows.length; k++) sum += grey(rows[k], i);
        n++;
    }
    return sum / n;
}

/** The widest gap between channels anywhere in a row. */
function chroma(row) {
    let top = 0;
    for (let i = 0; i < W; i++) {
        const c = [0, 1, 2].map((k) => texel(row, i, k));
        top = Math.max(top, Math.max(...c) - Math.min(...c));
    }
    return top;
}

/** Degrees between the half-maximum points of a channel's main peak. */
function fullWidth(row, c) {
    const { value } = peakAt(row, c);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < W; i++) {
        if (texel(row, i, c) >= value / 2) {
            lo = Math.min(lo, thetaOf(row, i));
            hi = Math.max(hi, thetaOf(row, i));
        }
    }
    return hi - lo;
}

describe('Sky Children optics: the special functions the table is built from', () => {
    it('has Airy\'s function right through the switch between series and asymptotics', () => {
        expect(airyAi(0)).toBeCloseTo(0.355028053887817, 9);
        expect(airyAi(-2.338107410459767)).toBeCloseTo(0, 7); // its first zero
        expect(airyAi(-1.018792971647471)).toBeCloseTo(0.535656656015, 6); // its first maximum
        expect(airyAi(1)).toBeCloseTo(0.135292416312881, 7);
        // Continuous where the evaluation changes method.
        expect(airyAi(-7 - 1e-9)).toBeCloseTo(airyAi(-7 + 1e-9), 5);
        expect(airyAi(5 - 1e-9)).toBeCloseTo(airyAi(5 + 1e-9), 7);
    });

    it('has Bessel\'s J0 and J1 at their first zeros and continuous at the switch', () => {
        expect(besselJ0(0)).toBeCloseTo(1, 8);
        expect(besselJ0(2.404825557695773)).toBeCloseTo(0, 6);
        expect(besselJ1(3.831705970207512)).toBeCloseTo(0, 6);
        expect(besselJ1(-1)).toBeCloseTo(-besselJ1(1), 9);
        expect(besselJ0(8 - 1e-9)).toBeCloseTo(besselJ0(8 + 1e-9), 6);
        expect(besselJ1(8 - 1e-9)).toBeCloseTo(besselJ1(8 + 1e-9), 6);
    });

    it('puts the geometric bows where Descartes put them, red outside blue on the primary', () => {
        expect(bowRay(1.333, 1).theta).toBeCloseTo(42.0, 0);
        expect(bowRay(1.333, 2).theta).toBeGreaterThan(50);
        expect(bowRay(1.333, 2).theta).toBeLessThan(52);
        expect(bowRay(1.331, 1).theta).toBeGreaterThan(bowRay(1.34, 1).theta);
        expect(bowRay(1.331, 2).theta).toBeLessThan(bowRay(1.34, 2).theta);
    });
});

describe('Sky Children optics: the table', () => {
    it('lays out four rows of RGBA texels, finite and never negative, A = 1', () => {
        expect(OPTICS_RANGE).toEqual([60, 60, 60, 25]);
        expect(LUT).toBeInstanceOf(Float32Array);
        expect(LUT).toHaveLength(W * 4 * 4);
        for (let i = 0; i < LUT.length; i += 4) {
            for (let c = 0; c < 3; c++) {
                expect(Number.isFinite(LUT[i + c]) && LUT[i + c] >= 0).toBe(true);
            }
            // Alpha: 1 on every row but the primary, whose alpha holds the supernumeraries (0..1).
            if (i < W * 4) expect(LUT[i + 3] >= 0 && LUT[i + 3] <= 1).toBe(true);
            else expect(LUT[i + 3]).toBe(1);
        }
        expect(bakeOpticsLut(64)).toHaveLength(64 * 16);
    });

    it('puts the primary\'s red peak at 42.0 ± 0.6° and its blue at 40.6 ± 0.6°, red outside blue', () => {
        const red = peakAt(0, 0);
        const blue = peakAt(0, 2);
        expect(red.at).toBeGreaterThanOrEqual(41.4);
        expect(red.at).toBeLessThanOrEqual(42.6);
        expect(blue.at).toBeGreaterThanOrEqual(40.0);
        expect(blue.at).toBeLessThanOrEqual(41.2);
        expect(red.at).toBeGreaterThan(blue.at);
        expect(peakAt(0, 1).at).toBeGreaterThan(blue.at);
        expect(peakAt(0, 1).at).toBeLessThan(red.at);
        // The primary's red peak is the table's unit of light.
        expect(red.value).toBeGreaterThan(0.95);
        expect(red.value).toBeLessThanOrEqual(1.0001);
    });

    it('reverses the secondary: red at 50.4 ± 0.8° on its inside, blue outside, 0.43 of the primary', () => {
        const red = peakAt(1, 0);
        const blue = peakAt(1, 2);
        expect(red.at).toBeGreaterThanOrEqual(49.6);
        expect(red.at).toBeLessThanOrEqual(51.2);
        expect(blue.at).toBeGreaterThan(red.at);
        expect(red.value / peakAt(0, 0).value).toBeCloseTo(OPTICS.secondary, 1);
    });

    it('leaves Alexander\'s band dark between the bows', () => {
        expect(mean([0, 1], 44, 49)).toBeLessThan(0.6 * mean([0, 1], 36, 40));
        // Not just darker: neither bow sends light into it at all.
        for (let i = 0; i < W; i++) {
            const t = thetaOf(0, i);
            if (t < 44.8 || t > 48) continue;
            for (let c = 0; c < 3; c++) {
                expect(texel(0, i, c) + texel(1, i, c), `${t.toFixed(2)}°`).toBeLessThan(1e-3);
            }
        }
    });

    it('rings supernumeraries just inside the primary (the primary row\'s alpha)', () => {
        const fringes = maxima((i) => texel(0, i, 3), 0, 36.5, 40.5);
        expect(fringes.length).toBeGreaterThanOrEqual(2);
        // Nothing outside their window.
        expect(texel(0, Math.round((30 / 60) * W), 3)).toBeLessThan(1e-3);
        expect(texel(0, Math.round((44 / 60) * W), 3)).toBeLessThan(1e-3);
        // ... and none far inside: there the fringes have long since washed out into the glow.
        expect(maxima((i) => luma(0, i), 0, 5, 36)).toHaveLength(0);
    });

    it('brightens the sky inside the primary toward the bow, white far in; outside the secondary too', () => {
        expect(mean([0], 30, 38)).toBeGreaterThan(mean([0], 20, 30));
        expect(mean([0], 20, 30)).toBeGreaterThan(mean([0], 5, 15));
        expect(mean([0], 5, 15)).toBeGreaterThan(0);
        const deep = opticsAt(0, 25);
        expect(Math.max(...deep) / Math.min(...deep)).toBeLessThan(1.1);
        expect(mean([1], 53.5, 57)).toBeGreaterThan(0.05);
        // The table ends dark, so clamping at its edge adds nothing.
        expect(Math.max(...opticsAt(1, 60))).toBeLessThan(1e-3);
        expect(Math.max(...opticsAt(2, 60))).toBeLessThan(1e-3);
    });

    it('draws the fogbow broad and nearly white, peaking at 37–40°', () => {
        for (let c = 0; c < 3; c++) {
            const { at } = peakAt(2, c);
            expect(at).toBeGreaterThanOrEqual(37);
            expect(at).toBeLessThanOrEqual(40);
        }
        expect(chroma(2)).toBeLessThan(0.15 * chroma(0));
        expect(fullWidth(2, 1)).toBeGreaterThan(3 * fullWidth(0, 1));
        expect(Math.max(...[0, 1, 2].map((c) => peakAt(2, c).value))).toBeCloseTo(OPTICS.fogbow, 2);
    });

    it('opens at least three glory rings inside 8°, each fainter than the last, over the opposition glow', () => {
        const rings = maxima((i) => luma(3, i), 3, 0.5, 8);
        expect(rings.length).toBeGreaterThanOrEqual(3);
        for (let k = 1; k < rings.length; k++) expect(rings[k].value).toBeLessThan(rings[k - 1].value);
        // The heart: the glory's peak plus the opposition glow's, white.
        const heart = opticsAt(3, 0);
        heart.forEach((v) => expect(v).toBeCloseTo(OPTICS.glory + OPTICS.opposition, 1));
        // Each ring is coloured: blue inside red (spacing ∝ λ/a).
        const red = maxima((i) => texel(3, i, 0), 3, 0.5, 8);
        const blue = maxima((i) => texel(3, i, 2), 3, 0.5, 8);
        expect(blue[0].at).toBeLessThan(red[0].at);
        // Gone before the row's edge.
        expect(Math.max(...opticsAt(3, 25))).toBeLessThan(1e-3);
    });

    it('is the same physics at any width: two texels average to one of a table half as wide', () => {
        const half = bakeOpticsLut(W / 2);
        for (let r = 0; r < 4; r++) {
            for (let i = 0; i < W / 2; i++) {
                for (let c = 0; c < 3; c++) {
                    const pair = (texel(r, 2 * i, c) + texel(r, 2 * i + 1, c)) / 2;
                    expect(Math.abs(texel(r, i, c, half, W / 2) - pair)).toBeLessThan(2e-3);
                }
            }
        }
        // And the narrow table still puts the bows where the wide one does.
        const narrow = (row, c) => {
            let best = -1;
            let at = 0;
            for (let i = 0; i < W / 2; i++) {
                if (texel(row, i, c, half, W / 2) > best) {
                    best = texel(row, i, c, half, W / 2);
                    at = thetaOf(row, i, W / 2);
                }
            }
            return at;
        };
        expect(Math.abs(narrow(0, 0) - peakAt(0, 0).at)).toBeLessThan(0.25);
        expect(Math.abs(narrow(1, 0) - peakAt(1, 0).at)).toBeLessThan(0.25);
    });

    it('bakes the same table every time', () => {
        expect(bakeOpticsLut(W)).toEqual(LUT);
    });

    it('has a CPU twin that reads the table as the GPU\'s linear filter does', () => {
        const out = [0, 0, 0];
        for (let r = 0; r < 4; r++) {
            for (let i = 0; i < W; i += 37) {
                opticsAt(r, thetaOf(r, i), out);
                for (let c = 0; c < 3; c++) expect(out[c]).toBeCloseTo(texel(r, i, c), 6);
                // Half way between two texel centres: their mean.
                if (i + 1 < W) {
                    opticsAt(r, (thetaOf(r, i) + thetaOf(r, i + 1)) / 2, out);
                    for (let c = 0; c < 3; c++) {
                        expect(out[c]).toBeCloseTo((texel(r, i, c) + texel(r, i + 1, c)) / 2, 6);
                    }
                }
            }
            // Clamped at both ends, as ClampToEdge does.
            opticsAt(r, -5, out);
            expect(out[0]).toBeCloseTo(texel(r, 0, 0), 6);
            opticsAt(r, OPTICS_RANGE[r] + 5, out);
            expect(out[0]).toBeCloseTo(texel(r, W - 1, 0), 6);
        }
        // Any table can be read: a narrower one gives its own texels.
        const narrow = bakeOpticsLut(64);
        opticsAt(0, thetaOf(0, 10, 64), out, narrow);
        expect(out[1]).toBeCloseTo(narrow[10 * 4 + 1], 6);
    });
});

describe('Sky Children noise', () => {
    const N = 64;

    /**
     * The mean byte step across each pair of neighbouring columns (or rows) inside the field,
     * and across the wrap (the last column to the first).
     */
    function steps(data, size, channel, vertical) {
        const pairs = new Float64Array(size - 1);
        let seam = 0;
        for (let a = 0; a < size; a++) {
            for (let b = 0; b < size - 1; b++) {
                const p = vertical ? (b * size + a) : (a * size + b);
                const q = vertical ? ((b + 1) * size + a) : (a * size + b + 1);
                pairs[b] += Math.abs(data[p * 4 + channel] - data[q * 4 + channel]) / size;
            }
            const first = vertical ? a : a * size;
            const last = vertical ? ((size - 1) * size + a) : (a * size + size - 1);
            seam += Math.abs(data[first * 4 + channel] - data[last * 4 + channel]) / size;
        }
        return { roughest: Math.max(...pairs), seam };
    }

    it('bakes the sky\'s and the stone\'s noise at the asked size, the same from the same seed', () => {
        [bakeSkyNoise, bakeStoneNoise].forEach((bake) => {
            const a = bake(N, 5);
            expect(a).toBeInstanceOf(Uint8Array);
            expect(a).toHaveLength(N * N * 4);
            expect(bake(N, 5)).toEqual(a);
            expect(bake(N, 6)).not.toEqual(a);
        });
        // The seeds the world uses by default.
        expect(bakeSkyNoise(N)).toEqual(bakeSkyNoise(N, 33));
        expect(bakeStoneNoise(N)).toEqual(bakeStoneNoise(N, 7));
    });

    it('tiles: across the wrap no channel steps harder than across any column (or row) inside', () => {
        [bakeSkyNoise(128, 33), bakeStoneNoise(128, 7)].forEach((data, which) => {
            for (let c = 0; c < 4; c++) {
                [false, true].forEach((vertical) => {
                    const { roughest, seam } = steps(data, 128, c, vertical);
                    const label = `${which ? 'stone' : 'sky'} ch${c} ${vertical ? 'y' : 'x'}`;
                    expect(seam, label).toBeLessThanOrEqual(roughest);
                });
            }
        });
    });

    it('uses the byte range in every channel', () => {
        [bakeSkyNoise(128), bakeStoneNoise(128)].forEach((data) => {
            for (let c = 0; c < 4; c++) {
                let lo = 255;
                let hi = 0;
                for (let i = c; i < data.length; i += 4) {
                    lo = Math.min(lo, data[i]);
                    hi = Math.max(hi, data[i]);
                }
                expect(hi - lo).toBeGreaterThan(120);
            }
        });
    });

    it('bakes 512² well inside a third of a second', () => {
        bakeSkyNoise(32);
        bakeStoneNoise(32);
        let t = performance.now();
        bakeSkyNoise(512);
        expect(performance.now() - t).toBeLessThan(300);
        t = performance.now();
        bakeStoneNoise(512);
        expect(performance.now() - t).toBeLessThan(300);
    });

    it('bakes a white puff of spray whose alpha dies before the square\'s edge', () => {
        const puff = bakePuff(128);
        expect(puff).toHaveLength(128 * 128 * 4);
        expect(bakePuff(128)).toEqual(puff);
        let centre = 0;
        for (let j = 0; j < 128; j++) {
            for (let i = 0; i < 128; i++) {
                const at = (j * 128 + i) * 4;
                expect(puff[at]).toBe(255);
                expect(puff[at + 1]).toBe(255);
                expect(puff[at + 2]).toBe(255);
                const r = Math.hypot((i + 0.5) / 64 - 1, (j + 0.5) / 64 - 1);
                if (r >= 1) expect(puff[at + 3]).toBe(0);
                if (r < 0.2) centre = Math.max(centre, puff[at + 3]);
            }
        }
        expect(centre).toBeGreaterThan(150);
    });
});

describe('Sky Children colour', () => {
    it('reads hex (and numbers) as scene-linear light, anything else as black', () => {
        expect(hexToLinear('#ffffff')).toEqual([1, 1, 1]);
        expect(hexToLinear(0xff0000)).toEqual([1, 0, 0]);
        expect(hexToLinear('#808080')[1]).toBeCloseTo(0.21586, 4);
        expect(hexToLinear('#abc')).toEqual(hexToLinear('#aabbcc'));
        expect(hexToLinear('not a colour')).toEqual([0, 0, 0]);
        const out = [9, 9, 9];
        expect(hexToLinear('#000000', out)).toBe(out);
    });

    it('goes to OKLab and OKLCh and back within 1e-4', () => {
        const rand = mulberry32(11);
        for (let k = 0; k < 200; k++) {
            const rgb = [rand(), rand(), rand()];
            const back = oklabToLinear(linearToOklab(rgb));
            const viaLch = fromOklch(toOklch(rgb));
            for (let c = 0; c < 3; c++) {
                expect(Math.abs(back[c] - rgb[c])).toBeLessThan(1e-4);
                expect(Math.abs(viaLch[c] - rgb[c])).toBeLessThan(1e-4);
            }
        }
        const white = toOklch([1, 1, 1]);
        expect(white[0]).toBeCloseTo(1, 4);
        expect(white[1]).toBeLessThan(1e-4);
        const h = toOklch(hexToLinear('#6fd6b0'))[2];
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThan(360);
    });

    it('mixes in OKLCh along the short arc, keeping chroma and never leaving the gamut', () => {
        const red = hexToLinear('#ff6b5e');
        const violet = hexToLinear('#c46bf0');
        const [, cr, hr] = toOklch(red);
        const [, cv, hv] = toOklch(violet);
        const mid = toOklch(lerpOklch(red, violet, 0.5));
        // Red (h ≈ 30°) to violet (h ≈ 310°) runs back through magenta, not forward through green.
        const arc = ((((hv - hr) % 360) + 540) % 360) - 180;
        const short = (hr + arc / 2 + 360) % 360;
        expect(Math.abs(((mid[2] - short + 540) % 360) - 180)).toBeLessThan(1);
        expect(mid[1]).toBeGreaterThan(0.95 * Math.min(cr, cv));
        lerpOklch(red, violet, 0, mid);
        mid.forEach((v, c) => expect(v).toBeCloseTo(red[c], 6));
        // A mix that would leave the gamut gives up chroma, never light below zero.
        const rand = mulberry32(5);
        for (let k = 0; k < 100; k++) {
            const a = [rand(), rand(), rand()];
            const b = [rand(), rand(), rand()];
            lerpOklch(a, b, rand()).forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
        }
    });

    it('lights every piece in its own colour, lifting only the dark ones to the floor', () => {
        Object.entries(SKY_CHILDREN_TETROMINOS.colors).forEach(([key, hex]) => {
            const light = pieceLight(hex);
            const plain = hexToLinear(hex);
            expect(Math.max(...light), key).toBeGreaterThanOrEqual(0.35 - 1e-9);
            if (Math.max(...plain) >= 0.35) expect(light, key).toEqual(plain);
        });
        // A dark colour keeps its hue (channel ratios) and comes up to the floor.
        const dark = hexToLinear('#202a40');
        const lifted = pieceLight('#202a40', 0.5);
        expect(Math.max(...lifted)).toBeCloseTo(0.5, 9);
        expect(lifted[0] / lifted[2]).toBeCloseTo(dark[0] / dark[2], 9);
        expect(pieceLight('#000000', 0.4)).toEqual([0.4, 0.4, 0.4]);
        expect(pieceLight(undefined)).toEqual([1, 1, 1]);
    });
});

describe('Sky Children falls', () => {
    const fall = {
        lip: [10, 200, -40], dir: [0.6, -0.8], v0: 3, spread: 0.1,
    };

    it('falls the way water falls: out at v0, down at ½·G·t²', () => {
        const at = fallPoint(fall, 2);
        expect(at[0]).toBeCloseTo(10 + 0.6 * 3 * 2, 9);
        expect(at[1]).toBeCloseTo(200 - 0.5 * G * 4, 9);
        expect(at[2]).toBeCloseTo(-40 - 0.8 * 3 * 2, 9);
        expect(fallPoint(fall, 0)).toEqual(fall.lip);
    });

    it('runs monotonic paths: always lower, always further out, longer the longer it falls', () => {
        let last = fallPoint(fall, 0);
        let lastLength = 0;
        for (let t = 0.05; t < 12; t += 0.05) {
            const p = fallPoint(fall, t);
            expect(p[1]).toBeLessThan(last[1]);
            expect(Math.hypot(p[0] - fall.lip[0], p[2] - fall.lip[2]))
                .toBeGreaterThan(Math.hypot(last[0] - fall.lip[0], last[2] - fall.lip[2]));
            const s = fallLength(t, fall.v0);
            expect(s).toBeGreaterThan(lastLength);
            last = p;
            lastLength = s;
        }
    });

    it('times a path length exactly: travelTime inverts the arc length, and grows with it', () => {
        [0, 0.5, 3, 12].forEach((v0) => {
            let lastT = -1;
            for (let s = 0; s <= 900; s += 7.5) {
                const t = travelTime(s, v0);
                expect(t).toBeGreaterThan(lastT);
                expect(fallLength(t, v0)).toBeCloseTo(s, 6);
                lastT = t;
            }
        });
        expect(travelTime(0, 3)).toBe(0);
        expect(travelTime(100, 0)).toBeCloseTo(Math.sqrt(200 / G), 9);
        // The arc is the curve itself: its length matches the polyline through fallPoint.
        let poly = 0;
        let prev = fallPoint(fall, 0);
        const end = travelTime(300, fall.v0);
        for (let k = 1; k <= 2000; k++) {
            const p = fallPoint(fall, (end * k) / 2000);
            poly += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
            prev = p;
        }
        expect(poly).toBeCloseTo(300, 2);
    });

    it('strays only as the falls draw it: a thread sways, a curtain meanders, both from nothing at the lip', () => {
        const thread = { ...fall, kind: 1, phase: 1.1 };
        const sheet = {
            ...fall, kind: 0, width: 26, spread: 3.4, phase: 0.4,
        };
        // A fall that names no kind falls true (the path tests above), as does an unknown kind.
        expect(fallSway({ ...fall, kind: 3 }, 4, 17)).toBe(0);
        [thread, sheet].forEach((f) => {
            expect(fallSway(f, 0, 12.3)).toBeCloseTo(0, 12);
            // Off the centre line along the lip's tangent, never along the heading.
            const p = fallPoint(f, 3, [0, 0, 0], 12.3);
            const q = fallPoint(fall, 3);
            const side = fallSway(f, 3, 12.3);
            expect(Math.hypot(p[0] - q[0], p[2] - q[2])).toBeCloseTo(Math.abs(side), 9);
            expect((p[0] - q[0]) * fall.dir[0] + (p[2] - q[2]) * fall.dir[1]).toBeCloseTo(0, 9);
        });
        // A thread's sway is bounded by its terms (the wind, and gusts of at most 0.7 + 0.3 + 0.7),
        // and grows with the fall (t²).
        let most = 0;
        for (let c = 0; c < WATER_WRAP; c += 0.37) most = Math.max(most, Math.abs(fallSway(thread, 5, c)));
        expect(most).toBeLessThanOrEqual(25 * (FALL_SWAY.thread + 1.7 * FALL_SWAY.ripple) + 1e-9);
        expect(most).toBeGreaterThan(Math.abs(fallSway(thread, 1, 0)));
        // A curtain strays at most its `sheet` share of its own width.
        for (let c = 0; c < WATER_WRAP; c += 0.37) {
            expect(Math.abs(fallSway(sheet, 4, c))).toBeLessThanOrEqual(FALL_SWAY.sheet * (26 + 3.4 * 4) + 1e-9);
        }
    });

    it('never jumps at the water clock\'s wrap: every rate is a whole number of turns in it', () => {
        // Every rate the falls move at, on the CPU and in the shaders alike (the swell is GPU only).
        const rates = [FALL_SWAY.rate, ...FALL_SWAY.gust, ...FALL_SWAY.lobes, FALL_SWAY.swell];
        rates.forEach((r) => {
            const turns = (r * WATER_WRAP) / (2 * Math.PI);
            expect(Math.abs(turns - Math.round(turns)), `${turns} turns`).toBeLessThan(1e-9);
        });
        [{ ...fall, kind: 1, phase: 2 }, {
            ...fall, kind: 0, width: 20, spread: 2, phase: 0.7,
        }].forEach((f) => {
            [0.5, 3, 7.5].forEach((t) => {
                expect(fallSway(f, t, WATER_WRAP - 1e-7)).toBeCloseTo(fallSway(f, t, WATER_WRAP + 1e-7), 4);
                expect(fallSway(f, t, 3.2)).toBeCloseTo(fallSway(f, t, 3.2 + WATER_WRAP), 9);
            });
        });
    });
});

describe('Sky Children pieces', () => {
    const KEYS = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
    const asSet = (cells) => {
        const out = [];
        for (let i = 0; i < 8; i += 2) out.push(`${cells[i] + 0},${cells[i + 1] + 0}`);
        return [...new Set(out)].sort();
    };

    it('turns every piece in all four rotations into four cells on the half grid, centred', () => {
        KEYS.forEach((key) => {
            let shape = SHAPES[key];
            for (let r = 0; r < 4; r++) {
                const cells = cellsFromMatrix(shape);
                expect(cells, `${key}${r}`).toHaveLength(8);
                expect(asSet(cells), `${key}${r}`).toHaveLength(4);
                let minX = Infinity;
                let maxX = -Infinity;
                let minY = Infinity;
                let maxY = -Infinity;
                for (let i = 0; i < 8; i += 2) {
                    expect(Number.isInteger(cells[i] * 2) && Number.isInteger(cells[i + 1] * 2)).toBe(true);
                    minX = Math.min(minX, cells[i]);
                    maxX = Math.max(maxX, cells[i]);
                    minY = Math.min(minY, cells[i + 1]);
                    maxY = Math.max(maxY, cells[i + 1]);
                }
                expect(minX + maxX, `${key}${r}`).toBe(0);
                expect(minY + maxY, `${key}${r}`).toBe(0);
                shape = rotateShape(shape, 'right');
            }
        });
    });

    it('turns the cells clockwise when the matrix turns right (rows run down, cells y up)', () => {
        KEYS.forEach((key) => {
            let shape = SHAPES[key];
            for (let r = 0; r < 4; r++) {
                const cells = cellsFromMatrix(shape);
                const turned = [];
                for (let i = 0; i < 8; i += 2) turned.push(cells[i + 1], -cells[i]);
                shape = rotateShape(shape, 'right');
                expect(asSet(cellsFromMatrix(shape)), `${key}${r}`).toEqual(asSet(turned));
            }
        });
        expect(cellsFromMatrix([[0, 0], [0, 0]])).toBeNull();
        expect(cellsFromMatrix(null)).toBeNull();
    });

    it('draws the same numbers from the same seed', () => {
        const a = mulberry32(33);
        const b = mulberry32(33);
        for (let k = 0; k < 50; k++) expect(a()).toBe(b());
        expect(mulberry32(34)()).not.toBe(mulberry32(33)());
    });
});

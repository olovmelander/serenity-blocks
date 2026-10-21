/**
 * Starlight — the numbers of the scene: the pole's frame, the Milky Way, the catalogue, the hours,
 * the chain and the constellations.
 *
 * Nothing here pins a colour or a gain: the look is still being tuned. What is pinned is what
 * the picture depends on being true.
 */
import { describe, expect, it } from 'vitest';
import {
    BAND,
    DEG,
    EXPOSURE_MAX,
    FIGURES,
    FIGURES_KEPT,
    FIGURE_LINES,
    FIGURE_STARS,
    GALAXY,
    HOUR_REST,
    HOUR_SECONDS,
    MAG_BRIGHT,
    MAG_FAINT,
    NOISE_SIZE,
    PALETTES,
    PALETTE_KEYS,
    PALETTE_SCALARS,
    SKY_RATE,
    SKY_TURN_SECONDS,
    TAU,
    WORLD,
    approach,
    bakeNoise,
    bandLight,
    dustAt,
    dustTau,
    figureOrder,
    generateCatalog,
    hexToLinear,
    horizontal,
    mulberry32,
    noiseLevels,
    paletteAt,
    poleFrame,
    sampleNoise,
    sampleNoiseSmooth,
    shutterFor,
    skyToGalactic,
    skyToWorld,
    slerp,
    worldToSky,
} from '../../src/themes/starlight/starlight-core.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const noise = bakeNoise(1610);

describe('Starlight core: the pole and its frame', () => {
    it('gives three unit vectors at right angles, the first of them up from the pole', () => {
        [[0, WORLD.poleAlt], [-0.4, 0.3], [0.7, 0.9]].forEach(([az, alt]) => {
            const f = poleFrame(az, alt);
            expect(dot(f.p, f.p)).toBeCloseTo(1, 9);
            expect(dot(f.e1, f.e1)).toBeCloseTo(1, 9);
            expect(dot(f.e2, f.e2)).toBeCloseTo(1, 9);
            expect(dot(f.p, f.e1)).toBeCloseTo(0, 9);
            expect(dot(f.p, f.e2)).toBeCloseTo(0, 9);
            expect(dot(f.e1, f.e2)).toBeCloseTo(0, 9);
            expect(f.p[1]).toBeCloseTo(Math.sin(alt), 9);
            expect(f.e1[1]).toBeGreaterThan(0);
        });
    });

    it('turns the sky the way the northern sky turns: up, then west', () => {
        const f = poleFrame(0, WORLD.poleAlt);
        const above = skyToWorld(f, 0.3, 0);
        const later = skyToWorld(f, 0.3, 0.4);
        // Above the pole first; a little later, to the west (the left of a lens that looks north).
        expect(above[1]).toBeGreaterThan(f.p[1]);
        expect(Math.abs(above[0])).toBeLessThan(1e-9);
        expect(later[0]).toBeLessThan(-0.05);
    });

    it('takes a direction to the sky and back', () => {
        const f = poleFrame(-0.39, WORLD.poleAlt);
        [[0.2, 1.1], [0.9, -2.4], [1.3, 3.0], [0.02, 0.5]].forEach(([rho, angle]) => {
            const d = skyToWorld(f, rho, angle);
            expect(dot(d, d)).toBeCloseTo(1, 9);
            const back = worldToSky(f, d);
            expect(back[0]).toBeCloseTo(rho, 6);
            expect(Math.cos(back[1] - angle)).toBeCloseTo(1, 6);
        });
    });

    it('turns once round the pole in the time it says', () => {
        expect(SKY_RATE * SKY_TURN_SECONDS).toBeCloseTo(TAU, 9);
        // A slow sky: under half a degree a second.
        expect(SKY_RATE / DEG).toBeLessThan(0.5);
        expect(SKY_RATE).toBeGreaterThan(0);
    });
});

describe('Starlight core: the Milky Way', () => {
    it('has a frame of three unit vectors at right angles', () => {
        const { north, centre, east } = GALAXY;
        [north, centre, east].forEach((v) => expect(dot(v, v)).toBeCloseTo(1, 9));
        expect(dot(north, centre)).toBeCloseTo(0, 9);
        expect(dot(north, east)).toBeCloseTo(0, 9);
        expect(dot(centre, east)).toBeCloseTo(0, 9);
    });

    it('passes close to the pole, and keeps its core near it', () => {
        // The pole's own galactic latitude: how far the band's midline is from it.
        const atPole = skyToGalactic(0, 0);
        expect(Math.abs(atPole[1])).toBeLessThan(12 * DEG);
        expect(Math.abs(atPole[1])).toBeGreaterThan(2 * DEG);
        // The core (longitude 0, latitude 0) is the sky direction `centre`: within the frame's reach.
        const coreFromPole = Math.acos(GALAXY.centre[2]);
        expect(coreFromPole).toBeLessThan(16 * DEG);
    });

    it('is brightest on its own plane and at its core, and never negative', () => {
        expect(bandLight(0, 0)).toBeGreaterThan(bandLight(0, 0.2));
        expect(bandLight(0, 0.2)).toBeGreaterThan(bandLight(0, 0.6));
        expect(bandLight(0, 0)).toBeGreaterThan(bandLight(2.4, 0));
        for (let l = -3.1; l <= 3.1; l += 0.2) {
            for (let b = -1.5; b <= 1.5; b += 0.1) {
                const v = bandLight(l, b);
                expect(v).toBeGreaterThanOrEqual(0);
                expect(Number.isFinite(v)).toBe(true);
            }
        }
        // Both arms keep light all the way round: the frame always finds one of them.
        expect(bandLight(Math.PI, 0)).toBeGreaterThan(0.2);
        expect(BAND.floor).toBeGreaterThan(0.2);
    });

    it('lays its dust on the plane only, as a share between 0 and 1', () => {
        let onPlane = 0;
        for (let l = -3.1; l <= 3.1; l += 0.05) {
            const d = dustAt(noise, l, 0.01);
            expect(d).toBeGreaterThanOrEqual(0);
            expect(d).toBeLessThanOrEqual(1);
            onPlane += d;
            expect(dustAt(noise, l, 0.9)).toBeLessThan(1e-6);
        }
        // There are lanes, and they do not cover everything.
        expect(onPlane / 125).toBeGreaterThan(0.08);
        expect(onPlane / 125).toBeLessThan(0.85);
    });

    it('is an optical depth: never negative, dark down the rift across the core, and its fine work only adds', () => {
        for (let l = -3.1; l <= 3.1; l += 0.1) {
            for (let b = -0.5; b <= 0.5; b += 0.02) {
                const tau = dustTau(noise, l, b);
                expect(Number.isFinite(tau)).toBe(true);
                expect(tau).toBeGreaterThanOrEqual(0);
            }
        }
        // The Great Rift splits the bulge: somewhere on its line through the core the dust takes
        // most of the light.
        let darkest = 0;
        for (let b = -0.04; b <= 0.08; b += 0.002) darkest = Math.max(darkest, dustAt(noise, 0, b));
        expect(darkest).toBeGreaterThan(0.85);
        // Without the frayed edges and the threads (the catalogue's copy, the low tiers) the dust
        // is still there, and the same along most of the plane.
        let near = 0;
        let count = 0;
        for (let l = -3.1; l <= 3.1; l += 0.05) {
            count += 1;
            if (Math.abs(dustAt(noise, l, 0.03, false) - dustAt(noise, l, 0.03)) < 0.35) near += 1;
        }
        expect(near / count).toBeGreaterThan(0.6);
    });
});

describe('Starlight core: the baked noise', () => {
    it('is the same for the same seed, fills every channel, and repeats', () => {
        expect(noise).toHaveLength(NOISE_SIZE * NOISE_SIZE * 4);
        const again = bakeNoise(1610);
        expect(again).toEqual(noise);
        for (let c = 0; c < 4; c += 1) {
            let lo = 255;
            let hi = 0;
            for (let i = c; i < noise.length; i += 4) {
                if (noise[i] < lo) lo = noise[i];
                if (noise[i] > hi) hi = noise[i];
            }
            expect(lo).toBe(0);
            expect(hi).toBe(255);
        }
        [[0.13, 0.7, 0], [0.91, 0.02, 2], [0.5, 0.5, 3]].forEach(([u, v, c]) => {
            const here = sampleNoise(noise, u, v, c);
            expect(here).toBeGreaterThanOrEqual(0);
            expect(here).toBeLessThanOrEqual(1);
            expect(sampleNoise(noise, u + 1, v - 2, c)).toBeCloseTo(here, 9);
        });
    });

    it('builds its mip chain on the CPU as the mean of each 2 × 2 block, down to one texel', () => {
        const levels = noiseLevels(noise);
        expect(levels).toHaveLength(Math.log2(NOISE_SIZE) + 1);
        expect(levels[0]).toBe(noise);
        expect(noiseLevels(noise)).toBe(levels);
        const n = NOISE_SIZE;
        const at = (x, y, c) => noise[(y * n + x) * 4 + c];
        [[0, 0, 0], [17, 40, 2], [127, 127, 3]].forEach(([x, y, c]) => {
            const mean = (at(2 * x, 2 * y, c) + at(2 * x + 1, 2 * y, c) + at(2 * x, 2 * y + 1, c) + at(2 * x + 1, 2 * y + 1, c)) / 4;
            expect(Math.abs(levels[1][(y * (n / 2) + x) * 4 + c] - mean)).toBeLessThanOrEqual(0.5);
        });
        expect(levels[levels.length - 1]).toHaveLength(4);
    });

    it('reads the eased sampler as the texel at a texel centre, and smoothly between', () => {
        [[0, 3, 5, 1], [1, 10, 20, 2], [2, 7, 30, 3]].forEach(([level, x, y, c]) => {
            const size = NOISE_SIZE >> level;
            const texel = noiseLevels(noise)[level][(y * size + x) * 4 + c] / 255;
            expect(sampleNoiseSmooth(noise, (x + 0.5) / size, (y + 0.5) / size, c, level)).toBeCloseTo(texel, 6);
        });
        // No step anywhere along a line across many texels: a small move is a small change.
        let worst = 0;
        let last = sampleNoiseSmooth(noise, 0, 0.37, 1, 1);
        for (let i = 1; i <= 2000; i += 1) {
            const here = sampleNoiseSmooth(noise, i / 2000, 0.37, 1, 1);
            worst = Math.max(worst, Math.abs(here - last));
            last = here;
        }
        expect(worst).toBeLessThan(0.06);
    });
});

describe('Starlight core: the catalogue', () => {
    const catalog = generateCatalog(6000, noise);

    it('gives the stars asked for, brightest first, each a unit direction inside the cap', () => {
        expect(catalog.count).toBe(6000);
        expect(catalog.polar).toHaveLength(6000 * 4);
        expect(catalog.look).toHaveLength(6000 * 4);
        const capCos = Math.cos(WORLD.cap) - 1e-6;
        for (let i = 0; i < catalog.count; i += 1) {
            const c = catalog.polar[i * 4];
            const s = catalog.polar[i * 4 + 1];
            const mag = catalog.polar[i * 4 + 3];
            expect(c * c + s * s).toBeCloseTo(1, 5);
            expect(c).toBeGreaterThanOrEqual(capCos);
            expect(mag).toBeGreaterThanOrEqual(MAG_BRIGHT - 1e-6);
            expect(mag).toBeLessThanOrEqual(MAG_FAINT + 1e-6);
            if (i > 0) expect(mag).toBeGreaterThanOrEqual(catalog.polar[(i - 1) * 4 + 3]);
            const temp = catalog.look[i * 4];
            expect(temp).toBeGreaterThanOrEqual(0);
            expect(temp).toBeLessThanOrEqual(1);
        }
    });

    it('is the same sky every time', () => {
        const again = generateCatalog(6000, noise);
        expect(again.polar).toEqual(catalog.polar);
        expect(again.look).toEqual(catalog.look);
    });

    it('has far more faint stars than bright ones', () => {
        let bright = 0;
        let faint = 0;
        for (let i = 0; i < catalog.count; i += 1) {
            if (catalog.polar[i * 4 + 3] < 3) bright += 1;
            else if (catalog.polar[i * 4 + 3] > 5.5) faint += 1;
        }
        expect(faint).toBeGreaterThan(bright * 8);
        expect(bright).toBeGreaterThan(10);
    });

    it('crowds its stars toward the Milky Way', () => {
        let near = 0;
        const gal = [0, 0];
        for (let i = 0; i < catalog.count; i += 1) {
            const rho = Math.acos(catalog.polar[i * 4]);
            skyToGalactic(rho, catalog.polar[i * 4 + 2], gal);
            if (Math.abs(gal[1]) < 0.17) near += 1;
        }
        // A strip of ±10° is about a sixth of the cap; it holds well over a quarter of the stars.
        expect(near / catalog.count).toBeGreaterThan(0.27);
    });

    it('keeps a bright star at the pole for the sky to turn round', () => {
        let found = false;
        for (let i = 0; i < 40; i += 1) {
            if (Math.acos(catalog.polar[i * 4]) < 2 * DEG) found = true;
        }
        expect(found).toBe(true);
    });
});

describe('Starlight core: the hours', () => {
    const saturation = (c) => {
        const hi = Math.max(c[0], c[1], c[2]);
        const lo = Math.min(c[0], c[1], c[2]);
        return hi > 0 ? (hi - lo) / hi : 0;
    };

    it('names every colour and scalar in every hour', () => {
        expect(PALETTES.length).toBeGreaterThanOrEqual(5);
        expect(new Set(PALETTES.map((p) => p.name)).size).toBe(PALETTES.length);
        PALETTES.forEach((p) => {
            PALETTE_KEYS.forEach((key) => {
                expect(p[key], `${p.name}.${key}`).toHaveLength(3);
                p[key].forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
            });
            PALETTE_SCALARS.forEach((key) => expect(p[key], `${p.name}.${key}`).toBeGreaterThan(0));
        });
    });

    it('gives the zodiacal light to its own hour above all the others', () => {
        const zodiacal = PALETTES.find((p) => p.name === 'zodiacal');
        PALETTES.filter((p) => p !== zodiacal).forEach((p) => expect(p.zodiac).toBeLessThan(zodiacal.zodiac / 2));
    });

    it('stands on the hour itself at a whole wheel position, and wraps', () => {
        PALETTES.forEach((p, i) => {
            const at = paletteAt(i);
            PALETTE_KEYS.forEach((key) => expect(at[key]).toEqual(p[key]));
            PALETTE_SCALARS.forEach((key) => expect(at[key]).toBeCloseTo(p[key], 9));
            expect(at.index).toBe(i);
            expect(at.turn).toBe(0);
        });
        const n = PALETTES.length;
        expect(paletteAt(n + 0.5).horizon).toEqual(paletteAt(0.5).horizon);
        expect(paletteAt(-0.5).horizon).toEqual(paletteAt(n - 0.5).horizon);
    });

    it('rests briefly on an hour and is on its way for most of every step', () => {
        expect(HOUR_REST).toBeLessThanOrEqual(0.2);
        expect(paletteAt(HOUR_REST * 0.9).turn).toBe(0);
        expect(paletteAt(1 - HOUR_REST * 0.9).turn).toBe(1);
        let last = -1;
        for (let f = 0; f <= 1.0001; f += 0.05) {
            const { turn } = paletteAt(2 + Math.min(f, 0.9999));
            expect(turn).toBeGreaterThanOrEqual(last);
            last = turn;
        }
        expect(paletteAt(0.5).turn).toBeCloseTo(0.5, 6);
    });

    it('moves with the clock alone: half an hour on the light has left, a whole hour on it has arrived', () => {
        const wheel = (seconds, level = 1) => seconds / HOUR_SECONDS + level - 1;
        const start = paletteAt(wheel(0));
        const half = paletteAt(wheel(HOUR_SECONDS / 2));
        const whole = paletteAt(wheel(HOUR_SECONDS));
        expect(half.horizon).not.toEqual(start.horizon);
        expect(whole.horizon).toEqual(PALETTES[1].horizon);
        // A level is a step added on top of where the clock has carried the light.
        expect(paletteAt(wheel(HOUR_SECONDS, 2)).horizon).toEqual(PALETTES[2].horizon);
        expect(HOUR_SECONDS).toBeGreaterThanOrEqual(60);
        expect(HOUR_SECONDS).toBeLessThanOrEqual(150);
    });

    it('never mixes two neighbouring hours through grey', () => {
        const n = PALETTES.length;
        for (let i = 0; i < n; i += 1) {
            const mid = paletteAt(i + 0.5);
            const least = Math.min(saturation(PALETTES[i].horizon), saturation(PALETTES[(i + 1) % n].horizon));
            // Half-way between two hours the horizon still has a colour of its own.
            expect(saturation(mid.horizon), `${PALETTES[i].name} → next`).toBeGreaterThan(Math.min(0.35, least * 0.6));
        }
    });
});

describe('Starlight core: the chain', () => {
    it('keeps the shutter closed without a chain and opens it further with every clear', () => {
        expect(shutterFor(0)).toBe(0);
        expect(shutterFor(1)).toBe(0);
        expect(shutterFor(undefined)).toBe(0);
        let last = 0;
        for (let combo = 2; combo <= 20; combo += 1) {
            const s = shutterFor(combo);
            expect(s).toBeGreaterThan(last);
            expect(s).toBeLessThan(1);
            last = s;
        }
        // A short chain draws a short trail: the long ones are earned.
        expect(shutterFor(2)).toBeLessThan(0.2);
        expect(shutterFor(8)).toBeGreaterThan(0.7);
        expect(EXPOSURE_MAX).toBeLessThan(Math.PI / 3);
    });

    it('eases at the same pace whatever the frame rate', () => {
        const once = approach(2, 0.1);
        const twice = 1 - (1 - approach(2, 0.05)) ** 2;
        expect(twice).toBeCloseTo(once, 9);
        expect(approach(2, 0)).toBe(0);
        expect(approach(2, -1)).toBe(0);
    });
});

describe('Starlight core: the constellations', () => {
    it('has figures the sky can hold: every star on a line, every line between two of its stars', () => {
        expect(FIGURES.length).toBeGreaterThanOrEqual(10);
        expect(new Set(FIGURES.map((f) => f.name)).size).toBe(FIGURES.length);
        FIGURES.forEach((figure) => {
            expect(figure.stars.length, figure.name).toBeGreaterThanOrEqual(4);
            expect(figure.stars.length, figure.name).toBeLessThanOrEqual(FIGURE_STARS);
            expect(figure.lines.length, figure.name).toBeGreaterThanOrEqual(3);
            expect(figure.lines.length, figure.name).toBeLessThanOrEqual(FIGURE_LINES);
            const used = new Set();
            const seen = new Set();
            figure.lines.forEach(([a, b]) => {
                expect(a).not.toBe(b);
                expect(figure.stars[a], `${figure.name} line ${a}-${b}`).toBeDefined();
                expect(figure.stars[b], `${figure.name} line ${a}-${b}`).toBeDefined();
                const key = a < b ? `${a}-${b}` : `${b}-${a}`;
                expect(seen.has(key), `${figure.name} repeats ${key}`).toBe(false);
                seen.add(key);
                used.add(a);
                used.add(b);
            });
            // A star no line reaches would never be finished by clears alone.
            expect(used.size, figure.name).toBe(figure.stars.length);
            figure.stars.forEach(([x, y, weight]) => {
                expect(Math.abs(x)).toBeLessThanOrEqual(1.35);
                expect(Math.abs(y)).toBeLessThanOrEqual(1.1);
                expect(weight).toBeGreaterThan(0.4);
                expect(weight).toBeLessThanOrEqual(1);
            });
        });
        expect(FIGURES_KEPT).toBeGreaterThanOrEqual(3);
    });

    it('draws them in a shuffled order that uses every figure once', () => {
        const order = figureOrder(7);
        expect(order.slice().sort((a, b) => a - b)).toEqual(FIGURES.map((_, i) => i));
        expect(figureOrder(7)).toEqual(order);
        expect(figureOrder(8)).not.toEqual(order);
    });
});

describe('Starlight core: small tools', () => {
    it('reads a hex colour as linear light', () => {
        const out = [0, 0, 0];
        expect(hexToLinear('#ffffff', out)).toBe(true);
        expect(out).toEqual([1, 1, 1]);
        expect(hexToLinear('808080', out)).toBe(true);
        expect(out[0]).toBeCloseTo(0.2158, 3);
        expect(hexToLinear('teal', out)).toBe(false);
        expect(hexToLinear(null, out)).toBe(false);
    });

    it('walks a great circle between two directions', () => {
        const a = horizontal(0.2, 0.6);
        const b = horizontal(-0.9, 0.2);
        expect(dot(a, a)).toBeCloseTo(1, 9);
        expect(slerp(a, b, 0)).toEqual(a);
        const end = slerp(a, b, 1);
        end.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));
        const mid = slerp(a, b, 0.5);
        expect(dot(mid, mid)).toBeCloseTo(1, 9);
        expect(Math.acos(dot(a, mid))).toBeCloseTo(Math.acos(dot(mid, b)), 9);
        expect(slerp(a, a, 0.3)).toEqual(a);
    });

    it('draws the same random numbers for the same seed', () => {
        const one = mulberry32(5);
        const two = mulberry32(5);
        for (let i = 0; i < 5; i += 1) {
            const v = one();
            expect(v).toBe(two());
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        }
    });
});

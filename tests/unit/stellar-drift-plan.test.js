/**
 * Stellar Drift — the plan: the three-free maths the world and the shaders share, and what is
 * baked on the CPU when the world is built.
 *
 * These pin contracts and relations (ordered, bounded, periodic, deterministic), never a tuning
 * number: constants are imported.
 */
import { describe, expect, it } from 'vitest';
import {
    BAND_KEYS, BOLT_SLOTS, CHIME_SLOTS, DEG, EVENT_ROWS, JET_SLOTS, PALETTES, PALETTE_COUNT,
    PALETTE_KEYS, PALETTE_REST, PALETTE_STEP, RINGS, RIPPLE_SLOTS, STRIKE_SLOTS, TAU, bandPlace, chainHeat,
    bell, giantAnchors, linRGB, mulberry32, paletteAt, paletteName, palettePhase, palettePlace, pieceColor,
    ringOmega, rowLatitude, saturationOf, smooth, sunDirection,
} from '../../src/themes/stellar-drift/stellar-drift-core.js';
import {
    BELTS, LATTICE_SIZE, LATTICE_SLICE, RING_TAU_MAX, bakeBandColors, bakeBandMeta, bakeFbm, bakeLattice,
    bakeRingProfile, ringTau,
} from '../../src/themes/stellar-drift/stellar-drift-bake.js';

const mean = (fn, from, to, steps = 60) => {
    let sum = 0;
    for (let i = 0; i < steps; i++) sum += fn(from + ((i + 0.5) / steps) * (to - from));
    return sum / steps;
};
const luma = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];

describe('stellar drift plan: six palettes on a wheel', () => {
    it('holds six named palettes with every colour the shaders and the band table read', () => {
        expect(PALETTES).toHaveLength(6);
        expect(PALETTE_COUNT).toBe(PALETTES.length);
        expect(new Set(PALETTES.map((p) => p.name)).size).toBe(PALETTES.length);
        PALETTES.forEach((palette) => {
            [...PALETTE_KEYS, ...BAND_KEYS].forEach((key) => {
                expect(palette[key], `${palette.name}.${key}`).toHaveLength(3);
                palette[key].forEach((v) => {
                    expect(Number.isFinite(v)).toBe(true);
                    expect(v).toBeGreaterThanOrEqual(0);
                });
            });
        });
    });

    it('rests on a palette at each end of a step and is on its way in between', () => {
        expect(palettePhase(0)).toMatchObject({ index: 0, next: 1, mix: 0 });
        expect(palettePhase(PALETTE_REST * 0.9).mix).toBe(0);
        expect(palettePhase(1 - PALETTE_REST * 0.9).mix).toBe(1);
        expect(palettePhase(0.5).mix).toBeCloseTo(0.5, 6);
        // The picture is moving for the share of a step that is not rest: about 70 %.
        let moving = 0;
        const samples = 2000;
        for (let i = 0; i < samples; i++) {
            const { mix } = palettePhase((i + 0.5) / samples);
            if (mix > 0 && mix < 1) moving += 1;
        }
        expect(moving / samples).toBeCloseTo(1 - 2 * PALETTE_REST, 2);
        expect(moving / samples).toBeGreaterThan(0.6);
    });

    it('goes round: the last palette leads back to the first, and any place is a place', () => {
        const last = palettePhase(PALETTE_COUNT - 0.5);
        expect(last.index).toBe(PALETTE_COUNT - 1);
        expect(last.next).toBe(0);
        expect(palettePhase(PALETTE_COUNT)).toMatchObject({ index: 0, next: 1, mix: 0 });
        expect(palettePhase(-1).index).toBe(PALETTE_COUNT - 1);
        expect(paletteName(PALETTE_COUNT * 3 + 2)).toBe(PALETTES[2].name);
    });

    it('drifts with the clock alone: moved within a minute, on the next palette one step later', () => {
        // No level change anywhere here.
        const start = paletteAt(palettePlace(0, 0));
        const minute = paletteAt(palettePlace(0, 60));
        expect(palettePhase(palettePlace(0, 60)).mix).toBeGreaterThan(0.05);
        expect(minute.gasA).not.toEqual(start.gasA);
        expect(paletteName(palettePlace(0, PALETTE_STEP))).toBe(PALETTES[1].name);
        expect(paletteName(palettePlace(0, PALETTE_STEP * 3))).toBe(PALETTES[3].name);
        // And it keeps drifting on any level: the same step, from wherever the level put it.
        expect(paletteName(palettePlace(3, PALETTE_STEP))).toBe(PALETTES[4].name);
        expect(PALETTE_STEP).toBeGreaterThanOrEqual(60);
        expect(PALETTE_STEP).toBeLessThanOrEqual(150);
    });

    it('adds a level-up to wherever the clock has carried it', () => {
        for (const t of [0, 31, 200, 1234]) {
            expect(palettePlace(1, t) - palettePlace(0, t)).toBeCloseTo(1, 9);
            expect(palettePlace(4, t) - palettePlace(1, t)).toBeCloseTo(3, 9);
        }
        expect(palettePlace(0, -5)).toBe(0);
    });

    it('mixes every colour between two neighbours, and exactly a palette at rest', () => {
        const rest = paletteAt(2);
        PALETTE_KEYS.forEach((key) => expect(rest[key]).toEqual(PALETTES[2][key]));
        const half = paletteAt(2.5);
        PALETTE_KEYS.forEach((key) => {
            for (let c = 0; c < 3; c++) {
                expect(half[key][c]).toBeCloseTo((PALETTES[2][key][c] + PALETTES[3][key][c]) / 2, 9);
            }
        });
        // The caller's object is filled in place.
        const out = {};
        expect(paletteAt(1, out)).toBe(out);
    });

    it('keeps a colour half-way between every two neighbours (no step passes through grey)', () => {
        for (let i = 0; i < PALETTE_COUNT; i++) {
            const half = paletteAt(i + 0.5);
            const pair = `${PALETTES[i].name} → ${PALETTES[(i + 1) % PALETTE_COUNT].name}`;
            ['gasA', 'gasB'].forEach((key) => {
                expect(saturationOf(half[key]), `${pair} ${key}`).toBeGreaterThan(0.25);
            });
        }
    });

    it('gives the bands their own place: the row, and the way through the step', () => {
        for (let i = 0; i < PALETTE_COUNT; i++) {
            expect(Math.floor(bandPlace(i))).toBe(i);
            expect(bandPlace(i) - i).toBe(0);
            expect(Math.floor(bandPlace(i + 0.999))).toBe(i);
            expect(bandPlace(i + 0.999) - i).toBeGreaterThan(0.99);
        }
        let last = -1;
        for (let k = 0; k <= 200; k++) {
            const v = bandPlace(1 + k / 201);
            expect(v).toBeGreaterThanOrEqual(last);
            last = v;
        }
    });
});

describe('stellar drift plan: the sun, the board on the giant, colour', () => {
    it('keeps the sun over the rings and on the giant\'s left, once round per turn of the wheel', () => {
        for (let k = 0; k <= 120; k++) {
            const place = (k / 120) * PALETTE_COUNT;
            const s = sunDirection(place);
            expect(Math.hypot(s[0], s[1], s[2])).toBeCloseTo(1, 9);
            expect(s[1]).toBeGreaterThan(0.2);
            expect(s[0]).toBeLessThan(0);
            const again = sunDirection(place + PALETTE_COUNT);
            for (let c = 0; c < 3; c++) expect(again[c]).toBeCloseTo(s[c], 9);
        }
        const out = [0, 0, 0];
        expect(sunDirection(1, out)).toBe(out);
    });

    it('writes the top row north of the floor, every row on its own latitude', () => {
        let last = Infinity;
        for (let row = 0; row < 20; row++) {
            const lat = rowLatitude(row);
            expect(lat).toBeLessThan(last);
            expect(Math.abs(lat)).toBeLessThan(Math.PI / 2);
            last = lat;
        }
        expect(rowLatitude(-5)).toBe(rowLatitude(0));
        expect(rowLatitude(99)).toBe(rowLatitude(19));
    });

    it('turns a piece colour into light: peak one, a floor in every channel, a fallback', () => {
        ['#5ee7df', '#ffd662', '#8b5cf6', '#2d4a8c', '#4a1a6b', '#ffffff', '#101010'].forEach((hex) => {
            const rgb = pieceColor(hex);
            expect(Math.max(...rgb)).toBeCloseTo(1, 6);
            expect(Math.min(...rgb)).toBeGreaterThanOrEqual(0.06 - 1e-9);
        });
        expect(pieceColor(0xff0000)).toEqual(pieceColor('#ff0000'));
        expect(pieceColor('ff0000')).toEqual(pieceColor('#ff0000'));
        const fallback = pieceColor(undefined);
        [null, 'teal', '#12', {}, NaN].forEach((junk) => expect(pieceColor(junk)).toEqual(fallback));
        // A dark piece is still a hue, not grey.
        expect(saturationOf(pieceColor('#2d4a8c'))).toBeGreaterThan(0.5);
    });

    it('warms the giant with the chain, toward one', () => {
        expect(chainHeat(0)).toBe(0);
        let last = 0;
        for (let n = 1; n <= 30; n++) {
            const v = chainHeat(n);
            expect(v).toBeGreaterThan(last);
            expect(v).toBeLessThan(1);
            last = v;
        }
    });

    it('has the small maths right', () => {
        expect(smooth(0, 1, -1)).toBe(0);
        expect(smooth(0, 1, 2)).toBe(1);
        expect(smooth(0, 1, 0.5)).toBeCloseTo(0.5, 9);
        expect(bell(0)).toBe(1);
        expect(bell(1.5)).toBe(0);
        expect(linRGB(0xffffff)).toEqual([1, 1, 1]);
        expect(saturationOf([0.5, 0.5, 0.5])).toBe(0);
        expect(saturationOf([1, 0, 0])).toBe(1);
        const a = mulberry32(7);
        const b = mulberry32(7);
        for (let i = 0; i < 5; i++) expect(a()).toBe(b());
        // Inner ice turns faster than outer ice.
        expect(ringOmega(1.3)).toBeGreaterThan(ringOmega(2.2));
    });

    it('lays the event table out in blocks that do not overlap', () => {
        const blocks = [
            [EVENT_ROWS.ripple, RIPPLE_SLOTS], [EVENT_ROWS.chime, CHIME_SLOTS], [EVENT_ROWS.jet, JET_SLOTS],
            [EVENT_ROWS.strike, STRIKE_SLOTS], [EVENT_ROWS.bolt, BOLT_SLOTS],
        ];
        let cursor = 0;
        blocks.forEach(([start, slots]) => {
            expect(start).toBe(cursor);
            cursor += slots * 2;
        });
        expect(EVENT_ROWS.total).toBe(cursor);
    });
});

describe('stellar drift plan: where the giant hangs', () => {
    it('keeps the giant and both moons in the frame for any aspect', () => {
        for (let aspect = 0.45; aspect <= 3.5; aspect += 0.05) {
            const a = giantAnchors(aspect);
            [a.x, a.y, a.radius, a.elevation, a.roll].forEach((v) => expect(Number.isFinite(v)).toBe(true));
            expect(a.x).toBeGreaterThan(0);
            expect(a.x).toBeLessThan(1);
            expect(a.y).toBeGreaterThan(0);
            expect(a.y).toBeLessThan(1);
            expect(a.radius).toBeGreaterThan(0.04);
            expect(a.radius).toBeLessThan(0.5);
            expect(a.elevation).toBeGreaterThan(4 * DEG);
            expect(a.elevation).toBeLessThan(30 * DEG);
            expect(a.moons).toHaveLength(2);
            a.moons.forEach((m) => {
                expect(m.x).toBeGreaterThan(0);
                expect(m.x).toBeLessThan(1);
                expect(m.y).toBeGreaterThan(0);
                expect(m.y).toBeLessThan(1);
                expect(m.radius).toBeGreaterThan(0);
                expect(m.radius).toBeLessThan(a.radius);
            });
        }
    });

    it('leaves the centre to the board in landscape: the giant left, the moons right of the card', () => {
        [16 / 10, 16 / 9, 21 / 9, 32 / 9].forEach((aspect) => {
            const a = giantAnchors(aspect);
            expect(a.x).toBeLessThan(0.35);
            a.moons.forEach((m) => expect(m.x).toBeGreaterThan(0.7));
        });
        // An upright phone: the giant rises into the sky above the card.
        expect(giantAnchors(9 / 19.5).y).toBeLessThan(0.2);
        // Garbage in, the common screen out.
        expect(giantAnchors(NaN)).toEqual(giantAnchors(16 / 9));
    });
});

describe('stellar drift plan: what is baked', () => {
    it('bakes the same textures for the same seed, and others for another', () => {
        expect(bakeLattice(5)).toEqual(bakeLattice(5));
        expect(bakeLattice(5)).not.toEqual(bakeLattice(6));
        const a = bakeFbm(3, 32, 3);
        expect(a).toEqual(bakeFbm(3, 32, 3));
        expect(a).not.toEqual(bakeFbm(4, 32, 3));
        expect(a).toHaveLength(32 * 32 * 4);
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < a.length; i++) {
            lo = Math.min(lo, a[i]);
            hi = Math.max(hi, a[i]);
        }
        expect(lo).toBeGreaterThanOrEqual(0);
        expect(hi).toBeLessThanOrEqual(1);
        expect(bakeRingProfile(256, 9).levels[0].data).toEqual(bakeRingProfile(256, 9).levels[0].data);
    });

    it('lays the lattice out so one fetch holds two slices of each field', () => {
        const data = bakeLattice(11);
        const size = LATTICE_SIZE;
        for (const [x, y] of [[0, 0], [5, 200], [250, 250], [128, 3]]) {
            const here = (y * size + x) * 4;
            const there = (((y + LATTICE_SLICE[1]) % size) * size + ((x + LATTICE_SLICE[0]) % size)) * 4;
            expect(data[here + 1]).toBe(data[there]);
            expect(data[here + 3]).toBe(data[there + 2]);
        }
    });

    it('gives the rings their parts: a veil, a broad thick ring, a division, an outer ring with two gaps', () => {
        const profile = bakeRingProfile(2048, 5381);
        const tau = (r) => ringTau(profile, r);
        // Nothing inside the innermost ring or beyond the strand.
        expect(tau(RINGS.cInner - 0.02)).toBeLessThan(0.02);
        expect(tau(RINGS.strand + 0.04)).toBeLessThan(0.02);
        expect(tau(RINGS.from - 1)).toBe(0);
        expect(tau(RINGS.to + 1)).toBe(0);
        const veil = mean(tau, RINGS.cInner + 0.02, RINGS.bInner - 0.02);
        const broad = mean(tau, RINGS.bInner + 0.05, RINGS.bOuter - 0.03);
        const division = mean(tau, RINGS.bOuter + 0.015, RINGS.aInner - 0.012);
        const outer = mean(tau, RINGS.aInner + 0.02, 2.2);
        expect(broad).toBeGreaterThan(1);
        expect(veil).toBeLessThan(broad * 0.4);
        expect(division).toBeLessThan(0.3);
        expect(outer).toBeGreaterThan(division * 2);
        expect(outer).toBeLessThan(broad);
        // The two gaps in the outer ring, each darker than the ice on either side of it.
        [[2.2139, 0.012], [2.2633, 0.004]].forEach(([gap, off]) => {
            expect(tau(gap)).toBeLessThan(0.08);
            expect(tau(gap - off)).toBeGreaterThan(0.2);
        });
        // The strand outside is there, and thin.
        expect(tau(RINGS.strand)).toBeGreaterThan(0.05);
        for (let i = 0; i < profile.tau.length; i++) {
            expect(profile.tau[i]).toBeGreaterThanOrEqual(0);
            expect(profile.tau[i]).toBeLessThanOrEqual(RING_TAU_MAX);
        }
    });

    it('averages the ring profile down to one texel', () => {
        const profile = bakeRingProfile(1024, 1);
        expect(profile.levels[0].width).toBe(1024);
        for (let i = 1; i < profile.levels.length; i++) {
            expect(profile.levels[i].width).toBe(profile.levels[i - 1].width / 2);
            expect(profile.levels[i].data).toHaveLength(profile.levels[i].width * 4);
        }
        expect(profile.levels[profile.levels.length - 1].width).toBe(1);
    });

    it('bands the giant: belts between jets, the fastest wind on the equator', () => {
        const meta = bakeBandMeta(512, 9173);
        expect(meta.data).toHaveLength(512 * 4);
        const at = (lat) => {
            const i = Math.min(511, Math.floor(((lat + 90) / 180) * 512)) * 4;
            return { belt: meta.values[i], wind: meta.values[i + 1], shear: meta.values[i + 2] };
        };
        let fastest = -Infinity;
        let where = 0;
        for (let lat = -89; lat <= 89; lat += 0.5) {
            const v = at(lat);
            expect(v.belt).toBeGreaterThanOrEqual(0);
            expect(v.belt).toBeLessThanOrEqual(1);
            expect(Math.abs(v.wind)).toBeLessThanOrEqual(1);
            if (v.wind > fastest) {
                fastest = v.wind;
                where = lat;
            }
        }
        expect(Math.abs(where)).toBeLessThan(6);
        // The two broad belts either side of the equator are darker than the zone between them.
        const north = BELTS[0];
        expect(mean((lat) => at(lat).belt, north[0] + 2, north[1] - 2)).toBeGreaterThan(at(0).belt + 0.3);
        // The wind turns round somewhere: there are jets both ways.
        let reversed = false;
        for (let lat = -70; lat <= 70; lat += 0.5) reversed = reversed || at(lat).wind < -0.1;
        expect(reversed).toBe(true);
    });

    it('paints the bands once per palette, belts darker than zones in every one', () => {
        const meta = bakeBandMeta(512, 9173);
        const colors = bakeBandColors(meta);
        expect(colors.rows).toBe(PALETTE_COUNT);
        expect(colors.data).toHaveLength(512 * PALETTE_COUNT * 4);
        expect(colors.small).toHaveLength(colors.smallSize * PALETTE_COUNT * 4);
        const px = (row, lat) => {
            const i = (row * 512 + Math.floor(((lat + 90) / 180) * 512)) * 4;
            return [colors.data[i], colors.data[i + 1], colors.data[i + 2]];
        };
        for (let row = 0; row < PALETTE_COUNT; row++) {
            const zone = mean((lat) => luma(px(row, lat)), -3, 3, 12);
            const belt = mean((lat) => luma(px(row, lat)), 9, 15, 12);
            expect(belt, PALETTES[row].name).toBeLessThan(zone);
        }
        // Rows differ: a palette is a different giant.
        expect(px(0, 0)).not.toEqual(px(3, 0));
        expect(TAU).toBeCloseTo(Math.PI * 2, 12);
    });
});

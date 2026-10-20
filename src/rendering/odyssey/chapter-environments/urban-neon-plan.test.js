import { describe, expect, it } from 'vitest';
import {
    CH8_CITY_LAYOUT,
    NEON_GLOW,
    SIGN_KIND,
    STREET_Y,
    bakeNeonGlow,
    dealCityTowers,
    planNeonSigns,
} from './shared/odyssey-neon-city-plan.js';
import { NEON_LANTERNS, planNeonLanterns } from './shared/odyssey-neon-lanterns.tsl.js';
import { NEON_SIGN_MAX_GLYPHS } from './shared/odyssey-neon-signs.tsl.js';
import { NEON_GLYPH_COUNT, bakeNeonGlyphAtlas, neonGlyphFor } from './shared/odyssey-neon-glyphs.js';

// The rail through chapter 8 in corridor space (probed 2026-10-20): x within ±5, y -12..0,
// z +45 -> -45. Everything the neon city hangs must leave a tube round it clear.
const RAIL = Object.freeze({
    xHalf: 5, yLo: -12, yHi: 0, clear: 14,
});

describe('Chapter 8 neon city plan (2026-10-20)', () => {
    const towers = dealCityTowers(6);
    const { signs } = planNeonSigns(towers);

    it('deals the same city on every tier (only the outermost banks drop)', () => {
        expect(towers).toHaveLength((CH8_CITY_LAYOUT.ranks + CH8_CITY_LAYOUT.backRanks) * 2 * 6);
        const low = planNeonSigns(dealCityTowers(4)).signs;
        // Signs hang on banks 0-3 only, so the 4-bank Low city carries exactly the same plan.
        expect(low).toEqual(signs);
    });

    it('hangs a city of signs, a handful of giant screens among them', () => {
        const kinds = signs.reduce((acc, s) => ({ ...acc, [s.kind]: (acc[s.kind] || 0) + 1 }), {});
        expect(kinds[SIGN_KIND.tube]).toBeGreaterThan(40);
        expect(kinds[SIGN_KIND.fascia]).toBeGreaterThan(20);
        expect(kinds[SIGN_KIND.screen]).toBeGreaterThanOrEqual(3);
        signs.forEach((s) => {
            expect(Number.isFinite(s.x + s.y + s.z + s.w + s.h)).toBe(true);
            expect((s.text ?? '').length).toBeLessThanOrEqual(NEON_SIGN_MAX_GLYPHS);
        });
    });

    it('keeps the tube round the rail clear and every sign off the street', () => {
        signs.forEach((s) => {
            const halfX = s.facing === 0 ? s.w / 2 : 0;
            const nearX = Math.abs(s.x) - halfX;
            const overlapsRailHeight = s.y + s.h / 2 > RAIL.yLo - RAIL.clear && s.y - s.h / 2 < RAIL.yHi + RAIL.clear;
            if (overlapsRailHeight) expect(nearX).toBeGreaterThanOrEqual(RAIL.xHalf + RAIL.clear - 1);
            expect(s.y - s.h / 2).toBeGreaterThan(STREET_Y);
        });
    });

    it('stands every wall sign off its wall (no depth fighting) and inside the block it is on', () => {
        const inner = towers.filter((t) => t.bank === 0);
        signs.filter((s) => s.kind !== SIGN_KIND.screen && !s.roof).forEach((s) => {
            const wall = inner.find((t) => t.side === Math.sign(s.x) && Math.abs(t.z - s.z) <= t.depth / 2);
            expect(wall).toBeTruthy();
            const wallX = Math.abs(wall.x) - wall.width / 2;
            const signOuter = s.facing === 0 ? Math.abs(s.x) + s.w / 2 : Math.abs(s.x);
            expect(wallX - signOuter).toBeGreaterThanOrEqual(0.5);
        });
    });

    it('bakes a finite, non-negative glow map that lights the boulevard the eye sees', () => {
        const glow = bakeNeonGlow(signs);
        expect(glow).toHaveLength(NEON_GLOW.texels * NEON_GLOW.rows * 4);
        glow.forEach((v) => {
            expect(Number.isFinite(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(0);
        });
        // Every texel of the street-level rows between the eye and the spire carries light.
        const texelAt = (z) => Math.floor(((z - NEON_GLOW.z0) / (NEON_GLOW.z1 - NEON_GLOW.z0)) * NEON_GLOW.texels);
        for (let z = -500; z <= 60; z += 20) {
            const o = (2 * NEON_GLOW.texels + texelAt(z)) * 4;
            expect(glow[o] + glow[o + 1] + glow[o + 2]).toBeGreaterThan(0.01);
        }
    });

    it('hangs the lantern strings well below the rail, between the inner walls', () => {
        const lanterns = planNeonLanterns();
        expect(lanterns.length).toBeGreaterThan(50);
        lanterns.forEach((l) => {
            expect(l.y).toBeLessThan(RAIL.yLo - RAIL.clear);
            expect(Math.abs(l.x)).toBeLessThanOrEqual(NEON_LANTERNS.halfSpan);
        });
    });

    it('bakes every glyph a sign can ask for', () => {
        const { data, size } = bakeNeonGlyphAtlas();
        expect(data).toHaveLength(size * size);
        signs.filter((s) => s.text).forEach((s) => {
            Array.from(s.text).forEach((ch) => expect(neonGlyphFor(ch)).toBeLessThan(NEON_GLYPH_COUNT));
        });
    });
});

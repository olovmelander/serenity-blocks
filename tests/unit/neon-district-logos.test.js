import { describe, expect, it } from 'vitest';
import {
    LOGOS, LOGO_ANIMS, LOGO_ATLAS_KEY, LOGO_BOX, LOGO_CELL, LOGO_GRID, LOGO_RANGE, LOGO_UNITS,
    arc, bakeLogoAtlas, ellipse, logoFrames, logoIndex, logoStrokes,
} from '../../src/themes/neon-district/neon-district-logos.js';
import { BRANDS, CAMPAIGNS } from '../../src/themes/neon-district/neon-district-campaigns.js';
import { isBaked } from '../../src/themes/shared/bake-cache.js';

/** The animation channels (G, B, A) each anim lights at some point of its cycle. */
const USED = {
    none: [false, false, false],
    blink: [true, false, false],
    alt: [true, true, false],
    cycle: [true, true, true],
    build: [true, true, true],
    breath: [true, true, true],
};

describe('neon district logos', () => {
    it('lists sixteen marks with unique ids, known animations and real-neon periods', () => {
        expect(LOGOS).toHaveLength(LOGO_GRID * LOGO_GRID);
        expect(Object.isFrozen(LOGOS)).toBe(true);
        expect(new Set(LOGOS.map((logo) => logo.id)).size).toBe(LOGOS.length);
        for (const logo of LOGOS) {
            expect(LOGO_ANIMS).toContain(logo.anim);
            if (logo.anim === 'breath') expect(logo.period).toBe(10);
            else {
                expect(logo.period).toBeGreaterThanOrEqual(0.8);
                expect(logo.period).toBeLessThanOrEqual(3);
            }
        }
        // Every campaign's mark is in the atlas.
        for (const campaign of Object.values(CAMPAIGNS)) {
            expect(logoIndex(campaign.logo), campaign.id).toBeGreaterThanOrEqual(0);
        }
        expect(BRANDS.map((brand) => logoIndex(brand.logo))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
        expect(logoIndex('no-such-mark')).toBe(-1);
    });

    it('draws every mark in its box, with strokes in exactly the channels its animation lights', () => {
        const all = logoStrokes();
        expect(all).toHaveLength(LOGOS.length);
        all.forEach((channels, i) => {
            const { id, anim } = LOGOS[i];
            expect(channels).toHaveLength(4);
            expect(channels[0].length, `${id} has an always-lit tube`).toBeGreaterThan(0);
            USED[anim].forEach((used, k) => {
                if (used) expect(channels[k + 1].length, `${id} frame ${k + 1}`).toBeGreaterThan(0);
                else expect(channels[k + 1], `${id} frame ${k + 1} is unused`).toHaveLength(0);
            });
            const values = channels.flat();
            expect(values.every((segment) => segment.length === 4 && segment.every(Number.isFinite)), id).toBe(true);
            // No zero-length segments, and every point inside the box.
            expect(values.every(([ax, ay, bx, by]) => Math.hypot(bx - ax, by - ay) > 1e-6), id).toBe(true);
            const flat = values.flat();
            expect(Math.min(...flat), id).toBeGreaterThanOrEqual(0);
            expect(Math.max(...flat), id).toBeLessThanOrEqual(LOGO_UNITS);
        });
    });

    it('bends curves fine enough to show no facets', () => {
        // A unit is about ten texels: a chord may bow about a tenth of a texel off the curve.
        for (const r of [0.5, 0.65, 1, 1.9, 3, 4.5]) {
            const circle = arc(5, 5, r, 0, 360);
            expect(Math.hypot(circle[0][0] - circle.at(-1)[0], circle[0][1] - circle.at(-1)[1])).toBeLessThan(1e-9);
            for (const [x, y] of circle) expect(Math.hypot(x - 5, y - 5)).toBeCloseTo(r, 9);
            for (let i = 1; i < circle.length; i++) {
                const [[x0, y0], [x1, y1]] = [circle[i - 1], circle[i]];
                const mid = Math.hypot((x0 + x1) / 2 - 5, (y0 + y1) / 2 - 5);
                expect(r - mid, `circle of radius ${r}`).toBeLessThan(0.011);
            }
        }
        const oval = ellipse(5, 5, 4, 1, 180, 360);
        expect(oval[0][0]).toBeCloseTo(1, 9);
        expect(oval.at(-1)[0]).toBeCloseTo(9, 9);
        for (let i = 1; i < oval.length; i++) {
            expect(Math.hypot(oval[i][0] - oval[i - 1][0], oval[i][1] - oval[i - 1][1])).toBeLessThanOrEqual(0.4);
        }
    });

    it('lights the frames as each animation says', () => {
        expect(logoFrames('none', 0.3)).toEqual([0, 0, 0]);
        expect(logoFrames('blink', 0.2)).toEqual([1, 0, 0]);
        expect(logoFrames('blink', 0.7)).toEqual([0, 0, 0]);
        expect(logoFrames('alt', 0.2)).toEqual([1, 0, 0]);
        expect(logoFrames('alt', 0.7)).toEqual([0, 1, 0]);
        expect([0.1, 0.5, 0.9].map((p) => logoFrames('cycle', p))).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
        const build = [0.1, 0.3, 0.6, 0.9].map((p) => logoFrames('build', p));
        expect(build).toEqual([[1, 0, 0], [1, 1, 0], [1, 1, 1], [0, 0, 0]]);
        // Only the fraction of the phase counts.
        expect(logoFrames('cycle', 7.5)).toEqual(logoFrames('cycle', 0.5));
        expect(logoFrames('cycle', -0.1)).toEqual(logoFrames('cycle', 0.9));
        // The breath fills inner to outer, and empties outer to inner.
        expect(logoFrames('breath', 0)).toEqual([0, 0, 0]);
        expect(logoFrames('breath', 0.39)).toEqual([1, 1, 1]);
        const lit = (p) => logoFrames('breath', p).reduce((a, b) => a + b, 0);
        for (let p = 0.01; p < 0.4; p += 0.01) expect(lit(p)).toBeGreaterThanOrEqual(lit(p - 0.01));
        for (let p = 0.42; p < 1; p += 0.01) expect(lit(p)).toBeLessThanOrEqual(lit(p - 0.01));
    });

    it('bakes one distance field per channel, each mark inside its own cell', () => {
        expect(LOGO_BOX.x0).toBeGreaterThan(LOGO_RANGE);
        expect(1 - LOGO_BOX.x1).toBeGreaterThan(LOGO_RANGE);
        expect(LOGO_BOX.y0).toBeGreaterThan(LOGO_RANGE);
        expect(1 - LOGO_BOX.y1).toBeGreaterThan(LOGO_RANGE);
        const { data, size } = bakeLogoAtlas();
        expect(size).toBe(LOGO_GRID * LOGO_CELL);
        expect(data).toBeInstanceOf(Uint8Array);
        expect(data).toHaveLength(size * size * 4);
        const all = logoStrokes();
        for (let i = 0; i < LOGOS.length; i++) {
            const col = i % LOGO_GRID;
            const row = Math.floor(i / LOGO_GRID);
            for (let ch = 0; ch < 4; ch++) {
                let peak = 0;
                let edge = 0;
                for (let y = 0; y < LOGO_CELL; y++) {
                    for (let x = 0; x < LOGO_CELL; x++) {
                        const v = data[((row * LOGO_CELL + y) * size + col * LOGO_CELL + x) * 4 + ch];
                        peak = Math.max(peak, v);
                        if (x === 0 || y === 0 || x === LOGO_CELL - 1 || y === LOGO_CELL - 1) edge = Math.max(edge, v);
                    }
                }
                const label = `${LOGOS[i].id} channel ${ch}`;
                if (all[i][ch].length > 0) expect(peak, label).toBeGreaterThan(240);
                else expect(peak, `${label} is empty`).toBe(0);
                expect(edge, `${label} stays inside its cell`).toBeLessThan(160);
            }
        }
    });

    it('puts a stroke where the strokes say, with the data rows bottom-up', () => {
        const { data, size } = bakeLogoAtlas();
        const scale = (LOGO_BOX.x1 - LOGO_BOX.x0) / LOGO_UNITS;
        /** The texel nearest box point (x, y) of a mark's channel. */
        const at = (id, ch, x, y) => {
            const i = logoIndex(id);
            const px = Math.round((LOGO_BOX.x0 + x * scale) * LOGO_CELL - 0.5);
            const py = Math.round((LOGO_BOX.y0 + y * scale) * LOGO_CELL - 0.5);
            const row = Math.floor(i / LOGO_GRID) * LOGO_CELL + py;
            return data[(row * size + (i % LOGO_GRID) * LOGO_CELL + px) * 4 + ch];
        };
        // The cocktail's olive (its blinking frame, G) tops out at (5, 6.9), above the stem...
        expect(at('cocktail', 1, 5, 6.9)).toBeGreaterThan(200);
        // ...and its mirror image below the middle of the box holds nothing of it.
        expect(at('cocktail', 1, 5, 3.1)).toBe(0);
        // The stem (R) runs down the middle under the bowl.
        expect(at('cocktail', 0, 5, 3.1)).toBeGreaterThan(200);
    });

    it('bakes deterministically, once', () => {
        const a = bakeLogoAtlas();
        expect(isBaked(LOGO_ATLAS_KEY)).toBe(true);
        expect(bakeLogoAtlas()).toBe(a);
        expect(JSON.stringify(logoStrokes())).toBe(JSON.stringify(logoStrokes()));
    });
});

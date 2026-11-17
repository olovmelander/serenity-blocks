/**
 * The portal passage's colours come from the pictures the orbs wear. The baked table
 * (src/core/odyssey/theme-passage-palettes.js) must match the icons it was read from, cover
 * every orb of the journey, and never again paint a golden world blue.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    PASSAGE_PALETTE_FILE, bakePassagePalettes, renderPassagePaletteModule,
} from '../../scripts/bake-odyssey-passage-palettes.mjs';
import { decodePng, extractPassagePalette } from '../../scripts/odyssey-passage-palette-lib.mjs';
import { CHAPTER_CONFIGS } from '../../src/core/odyssey/data/chapters.js';
import { ODYSSEY_THEME_PASSAGE_PALETTES } from '../../src/core/odyssey/theme-passage-palettes.js';
import {
    getOdysseyPassagePalette, passageSeed, resetOdysseyPassageVisitsForTests, resolveOdysseyPassage,
} from '../../src/ui/odyssey/odyssey-passage-look.js';

const hue = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    if (d === 0) return null;
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return ((h * 60) + 360) % 360;
};

describe('the passage palettes', () => {
    it('are the baked reading of the theme icons (re-run the bake after changing an icon)', () => {
        const baked = renderPassagePaletteModule(bakePassagePalettes());
        expect(readFileSync(PASSAGE_PALETTE_FILE, 'utf8').replace(/\r\n/g, '\n')).toBe(baked);
    }, 30000);

    it('cover every orb of the journey', () => {
        const themes = CHAPTER_CONFIGS.flatMap((chapter) => chapter.themes.primary);
        expect(themes).toHaveLength(60);
        for (const theme of themes) {
            const row = ODYSSEY_THEME_PASSAGE_PALETTES[theme];
            expect(row, theme).toBeDefined();
            expect(row.slice(0, 4).every((colour) => /^#[0-9a-f]{6}$/.test(colour)), theme).toBe(true);
            expect(row[4]).toBeGreaterThanOrEqual(0);
            expect(row[4]).toBeLessThanOrEqual(1);
        }
    });

    it('paint a golden prairie storm gold, not the blue of its grey UI accent', () => {
        const palette = getOdysseyPassagePalette('tornado');
        // Gold to amber, both walls of the passage and its light.
        for (const colour of [palette.primary, palette.accent, palette.highlight]) {
            expect(hue(colour)).toBeGreaterThan(18);
            expect(hue(colour)).toBeLessThan(55);
        }
    });

    it('count hues by area: a few vivid kites do not outvote the hills they fly over', () => {
        const palette = getOdysseyPassagePalette('verdant-hills');
        expect(hue(palette.primary)).toBeGreaterThan(80);
        expect(hue(palette.primary)).toBeLessThan(170);
    });

    it('falls back to the UI accent for a theme without a picture, and to nothing for no theme', () => {
        expect(getOdysseyPassagePalette('no-such-theme')).toBeNull();
        expect(getOdysseyPassagePalette(null)).toBeNull();
    });
});

describe('reading a picture', () => {
    /** A tiny RGBA picture as extractPassagePalette takes it (a decoded PNG's shape). */
    const picture = (size, colourAt) => {
        const data = new Uint8Array(size * size * 4);
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) data.set([...colourAt(x, y), 255], (y * size + x) * 4);
        }
        return {
            width: size, height: size, channels: 4, data,
        };
    };

    it('finds the key light, the two strongest hues by area, the shadow and the brightness', () => {
        // Upper half a blue sky, lower half an orange field, a white sun.
        const read = extractPassagePalette(picture(96, (x, y) => {
            if (Math.hypot(x - 48, y - 30) < 16) return [255, 250, 230];
            return y < 48 ? [40, 90, 200] : [200, 110, 30];
        }));
        const hues = [hue(read.body), hue(read.second)].sort((a, b) => a - b);
        expect(hues[0]).toBeGreaterThan(15);
        expect(hues[0]).toBeLessThan(45);
        expect(hues[1]).toBeGreaterThan(200);
        expect(hues[1]).toBeLessThan(240);
        expect(read.light).toMatch(/^#f/);
        expect(read.key).toBeGreaterThan(0.2);
        expect(read.key).toBeLessThan(0.6);
    });

    it('gives a one-hue picture a second shade of its own hue, and a grey one no colour at all', () => {
        const green = extractPassagePalette(picture(64, (x) => [20, 80 + x, 40]));
        expect(Math.abs(hue(green.body) - hue(green.second))).toBeLessThan(30);
        const grey = extractPassagePalette(picture(64, (x) => [x * 3, x * 3, x * 3]));
        expect(hue(grey.body)).toBeNull();
    });

    it('refuses what is not an 8-bit PNG', () => {
        expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow('not a PNG');
    });
});

describe('the look of one passage', () => {
    const orb = (id, chapter, theme) => ({ id, chapter, theme: { primary: theme } });

    it('is made of the chapter the orb is in and coloured by the orb\'s world', () => {
        resetOdysseyPassageVisitsForTests();
        const passage = resolveOdysseyPassage(orb(15, 3, 'tornado'), { salt: 1 });
        expect(passage.look.kind).toBe('petals');
        expect(passage.look.chapter).toBe(3);
        expect(passage.primary).toBe(ODYSSEY_THEME_PASSAGE_PALETTES.tornado[1]);
        expect(passage.highlight).toBe(ODYSSEY_THEME_PASSAGE_PALETTES.tornado[0]);
        expect(passage.look.key).toBe(ODYSSEY_THEME_PASSAGE_PALETTES.tornado[4]);
        expect(passage.look.world).toMatch(/^#[0-9a-f]{6}$/);
        expect(resolveOdysseyPassage(orb(58, 8, 'neon-dusk'), { salt: 1 }).look.kind).toBe('neon');
    });

    it('is never the same twice: each visit, each orb and the way back out have their own seed', () => {
        resetOdysseyPassageVisitsForTests();
        const first = resolveOdysseyPassage(orb(15, 3, 'tornado'), { salt: 1 });
        const back = resolveOdysseyPassage(orb(15, 3, 'tornado'), { salt: 1, returning: true });
        const second = resolveOdysseyPassage(orb(15, 3, 'tornado'), { salt: 1 });
        const other = resolveOdysseyPassage(orb(16, 3, 'fall'), { salt: 1 });
        const seeds = [first, back, second, other].map((passage) => passage.look.seed);
        expect(new Set(seeds).size).toBe(4);
        // The same visit in the same session is the same passage (a retry of the transition).
        expect(passageSeed(15, 2, 1)).toBe(first.look.seed);
        // Another session, another run of passages.
        resetOdysseyPassageVisitsForTests();
        expect(resolveOdysseyPassage(orb(15, 3, 'tornado'), { salt: 2 }).look.seed).not.toBe(first.look.seed);
    });

    it('still draws for an orb with no theme or no chapter: the chapter\'s own light', () => {
        resetOdysseyPassageVisitsForTests();
        const passage = resolveOdysseyPassage({ id: 1 }, { salt: 0 });
        expect(passage.look.kind).toBe('embers');
        expect(passage.primary).toMatch(/^#[0-9a-f]{6}$/);
        expect(resolveOdysseyPassage(null, { salt: 0 }).look.kind).toBe('embers');
    });
});

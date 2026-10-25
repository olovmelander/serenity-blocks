/**
 * The app mark (scripts/app-icon/app-mark.mjs): the shipped favicon, master and Windows icon match
 * the generator, and the small cuts stay on the pixel grid with the tile's corner gaps open.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ICON_SIZES, APP_MARK_CUTS, appMarkSvg } from '../../scripts/app-icon/app-mark.mjs';
import { packIco, readIco, readPngSize } from '../../scripts/app-icon/ico.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file) => readFileSync(path.join(repoRoot, file));

describe('app mark', () => {
    it('ships what the generator draws (run node scripts/generate-app-icon.mjs after a change)', () => {
        expect(read('public/favicon.svg').toString('utf8')).toBe(appMarkSvg(16));
        expect(read('public/assets/branding/serenity-blocks-app-icon.svg').toString('utf8')).toBe(appMarkSvg(256));
    });

    it('gives Windows every size, smallest first, each image its stated size', () => {
        const entries = readIco(read('public/assets/branding/serenity-blocks.ico'));
        expect(entries.map((entry) => entry.width)).toEqual([...APP_ICON_SIZES]);
        for (const entry of entries) {
            expect(readPngSize(entry.png)).toEqual({ width: entry.width, height: entry.height });
        }
    });

    it('keeps each small cut on whole pixels, inside its tile, with a gap each side of the coral corner', () => {
        for (const [size, cut] of Object.entries(APP_MARK_CUTS).map(([s, c]) => [Number(s), c])) {
            for (const edge of [cut.x, cut.y, cut.w, cut.h, cut.t, cut.bar, cut.stem, cut.k, cut.lift]) {
                expect(Number.isInteger(edge)).toBe(true);
            }
            expect(cut.w - cut.k - cut.bar).toBeGreaterThanOrEqual(1);
            expect(cut.stem - (cut.k - cut.lift)).toBeGreaterThanOrEqual(1);
            expect(cut.x).toBeGreaterThanOrEqual(1);
            expect(cut.y - cut.lift).toBeGreaterThanOrEqual(1);
            expect(cut.x + cut.w).toBeLessThanOrEqual(size - 1);
            expect(cut.y + cut.h).toBeLessThanOrEqual(size - 1);
        }
    });

    it('packs and reads back an .ico', () => {
        const png = read('public/assets/branding/serenity-blocks.ico');
        const [first] = readIco(png);
        const repacked = readIco(packIco([first.png]));
        expect(repacked).toHaveLength(1);
        expect(repacked[0].png.equals(first.png)).toBe(true);
    });
});

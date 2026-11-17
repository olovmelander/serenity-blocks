/**
 * The chapter looks (src/core/odyssey/data/chapter-looks.js): one table for the UI's light, its
 * glass, the portal passage's matter and the world's light. The stylesheet's copy is generated
 * from it, no surface keeps a chapter colour of its own, and text set on the glass reads over
 * the brightest and the darkest world there can be behind it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readChapterLookBlock } from '../../scripts/sync-odyssey-chapter-looks.mjs';
import { CHAPTER_CONFIGS } from '../../src/core/odyssey/data/chapters.js';
import {
    ODYSSEY_CHAPTER_LOOKS, ODYSSEY_GLASS_ALPHA, ODYSSEY_GLASS_INKS, composite, contrastRatio,
    getOdysseyChapterLook, odysseyLookHex, renderOdysseyChapterLookCss, worstGlassContrast,
} from '../../src/core/odyssey/data/chapter-looks.js';
import { PASSAGE_KINDS } from '../../src/rendering/transitions/portal-gate-matter.js';

const styles = (name) => readFileSync(path.resolve('public/styles', name), 'utf8');

describe('the chapter looks', () => {
    it('has one look for each chapter of the journey, in order', () => {
        expect(ODYSSEY_CHAPTER_LOOKS.map((look) => look.id)).toEqual(CHAPTER_CONFIGS.map((chapter) => chapter.id));
        for (const look of ODYSSEY_CHAPTER_LOOKS) {
            for (const key of ['accent', 'glass', 'glassDeep', 'light']) {
                expect(look[key], `${look.id} ${key}`).toHaveLength(3);
                expect(look[key].every((value) => Number.isInteger(value) && value >= 0 && value <= 255)).toBe(true);
            }
            expect(PASSAGE_KINDS[look.passage], `chapter ${look.id} passage`).toBeDefined();
        }
        // No two chapters share a passage or a light.
        expect(new Set(ODYSSEY_CHAPTER_LOOKS.map((look) => look.passage)).size).toBe(8);
        expect(new Set(ODYSSEY_CHAPTER_LOOKS.map((look) => look.accent.join())).size).toBe(8);
        expect(new Set(ODYSSEY_CHAPTER_LOOKS.map((look) => look.glass.join())).size).toBe(8);
    });

    it('falls back to chapter 1 for anything that is not a chapter', () => {
        expect(getOdysseyChapterLook(3).id).toBe(3);
        expect(getOdysseyChapterLook('5').id).toBe(5);
        for (const bad of [0, 9, null, undefined, 'x', 2.5]) expect(getOdysseyChapterLook(bad).id).toBe(1);
        expect(odysseyLookHex([255, 158, 98])).toBe('#ff9e62');
    });

    it('is what the stylesheet holds (node scripts/sync-odyssey-chapter-looks.mjs rewrites it)', () => {
        expect(readChapterLookBlock()).toBe(renderOdysseyChapterLookCss());
    });

    it('is the only place a chapter colour is written: no stylesheet or overlay keeps its own table', () => {
        // The navigator's light is the shared one.
        const navigator = styles('odyssey-navigator.css');
        expect(navigator).not.toMatch(/\[data-chapter='\d'\][^{]*\{\s*--nav-hue-rgb:\s*\d/);
        expect(navigator).toMatch(/--nav-hue-rgb:\s*var\(--ody-hue-rgb/);
        // Outside the generated block, the shared sheet sets no chapter's hue.
        const shared = styles('odyssey-shared.css').replace(/\r\n/g, '\n').replace(readChapterLookBlock(), '');
        expect(shared).not.toMatch(/--ody-hue-rgb:\s*\d/);
        // The journey overlay takes its colour from the table.
        const overlay = readFileSync(path.resolve('src/ui/odyssey/JourneyFlowOverlay.js'), 'utf8');
        expect(overlay).not.toMatch(/CHAPTER_COLORS\s*=\s*\[/);
        expect(overlay).toMatch(/getOdysseyChapterLook/);
    });
});

describe('text on a chapter\'s glass', () => {
    it('reads over a white world and over a black one, in every chapter and every ink', () => {
        for (const look of ODYSSEY_CHAPTER_LOOKS) {
            for (const [name, ink] of Object.entries(ODYSSEY_GLASS_INKS)) {
                expect(worstGlassContrast(look, ink.alpha), `chapter ${look.id} ${name}`).toBeGreaterThanOrEqual(ink.minContrast);
            }
        }
    });

    it('keeps the chapter\'s own light readable as text on its glass (eyebrows, links)', () => {
        for (const look of ODYSSEY_CHAPTER_LOOKS) {
            const panel = composite(look.glass, [255, 255, 255], ODYSSEY_GLASS_ALPHA.top);
            expect(contrastRatio(look.accent, panel), `chapter ${look.id}`).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('is glass, not a slab: the world shows through it, more at the top than at the foot', () => {
        expect(ODYSSEY_GLASS_ALPHA.top).toBeLessThan(0.9);
        expect(ODYSSEY_GLASS_ALPHA.foot).toBeGreaterThan(ODYSSEY_GLASS_ALPHA.top);
        expect(ODYSSEY_GLASS_ALPHA.foot).toBeLessThan(1);
    });
});

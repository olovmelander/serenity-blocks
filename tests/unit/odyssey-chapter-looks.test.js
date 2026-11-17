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

describe('the surfaces over the live world', () => {
    /** Every block the sheet gives a selector (a sheet may open it more than once), as one text. */
    const rule = (sheet, selector) => {
        const blocks = [];
        for (let at = sheet.indexOf(`\n${selector} {`); at > -1; at = sheet.indexOf(`\n${selector} {`, at + 1)) {
            blocks.push(sheet.slice(at + 1, sheet.indexOf('\n}', at)));
        }
        expect(blocks.length, selector).toBeGreaterThan(0);
        return blocks.join('\n');
    };

    it('are the chapter\'s glass: the orb card, the charm chip, the tray and the docked briefing', () => {
        const map = styles('odyssey-map.css');
        expect(rule(map, '#odyssey-board-overlay .odyssey-level-panel::before')).toContain('var(--ody-glass-fill)');
        expect(rule(map, '#odyssey-board-overlay #odyssey-header-charms')).toContain('var(--ody-glass-fill)');
        expect(rule(map, 'html[data-ody-chapter] #sb-play-rail')).toContain('var(--ody-glass-fill)');
        // The header's night is one colour under a mask, so it can turn from chapter to chapter.
        const header = rule(map, '#odyssey-board-overlay .odyssey-header-bar::before');
        expect(header).toContain('background-color: rgb(var(--ody-glass-deep-rgb))');
        expect(header).toMatch(/transition: background-color/);
        const flow = styles('odyssey-flow.css');
        expect(rule(flow, ".ody-flow[data-layout='scenic'] .ody-flow__content")).toContain('var(--ody-glass-fill)');
        // The fill is declared again wherever a chapter is worn (a custom property that reads
        // another resolves where it is declared), and the default cannot outrank the page's chapter.
        const shared = styles('odyssey-shared.css').replace(/\r\n/g, '\n');
        expect(shared).toMatch(/:root,\n\[data-ody-chapter\],[^{]*\{\s*--ody-glass-fill:/);
        expect(shared).toMatch(/:where\(:root\) \{\s*--ody-glass-rgb:/);
    });

    it('take the inks measured for the glass', () => {
        for (const [sheet, selector] of [
            ['odyssey-map.css', '#odyssey-board-overlay .odyssey-level-panel'],
            ['odyssey-map.css', '#odyssey-board-overlay .odyssey-header-bar'],
            ['odyssey-navigator.css', '#odyssey-level-select.odyssey-level-select'],
            ['odyssey-flow.css', '.ody-flow'],
        ]) {
            const text = rule(styles(sheet), selector);
            expect(text, selector).toContain('--sb-text-muted: var(--ody-ink-muted)');
            expect(text, selector).toContain('--sb-text-faint: var(--ody-ink-faint)');
        }
    });

    it('never blur what is behind them: the map renders on underneath', () => {
        for (const sheet of ['odyssey-map.css', 'odyssey-flow.css', 'odyssey-navigator.css', 'odyssey-shared.css', 'odyssey-outcome.css']) {
            const text = styles(sheet).replace(/\/\*[\s\S]*?\*\//g, '');
            expect(text, sheet).not.toMatch(/backdrop-filter/);
        }
    });

    it('lay a chapter\'s arrival lightly: pools of its night where the words stand, not a sheet', () => {
        const flow = styles('odyssey-flow.css');
        const shade = rule(flow, ".ody-flow[data-layout='chapter']::before");
        expect(shade.match(/radial-gradient\(/g)).toHaveLength(2);
        // No opaque stop anywhere, and nothing that covers the frame from side to side.
        expect(shade).not.toMatch(/#080713|rgb\(|, 1\)|linear-gradient\(90deg/);
        const strongest = Math.max(...[...shade.matchAll(/rgba\(var\(--ody-glass-deep-rgb\), ([\d.]+)\)/g)].map((m) => Number(m[1])));
        expect(strongest).toBeLessThanOrEqual(0.9);
        expect(flow).toContain(".ody-flow[data-layout='chapter']::after { opacity: 0; }");
    });

    it('show the world through the navigator: its page has no fill of its own', () => {
        const navigator = styles('odyssey-navigator.css');
        const root = rule(navigator, '#odyssey-level-select.odyssey-level-select');
        expect(root).toMatch(/background: none;/);
        expect(root).not.toMatch(/background: #/);
        // Its night is see-through everywhere, deepest behind the ascent's small print.
        const sky = rule(navigator, '#odyssey-level-select .odyssey-nav__sky');
        const alphas = [...sky.matchAll(/rgba\(var\(--ody-glass-deep-rgb\), ([\d.]+)\)/g)].map((m) => Number(m[1]));
        expect(alphas.length).toBeGreaterThanOrEqual(3);
        expect(Math.max(...alphas)).toBeLessThan(1);
        expect(alphas[0]).toBeGreaterThan(Math.min(...alphas));
        expect(sky).not.toMatch(/#0d0b26|#05040f/);
    });
});

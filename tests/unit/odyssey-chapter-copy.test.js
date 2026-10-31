/* eslint-disable import/first */
// The words a chapter speaks: its subtitle, the intro on its arrival screen and in the navigator,
// and the outro its farewell plays as the world carries you out. The same voice as the orbs
// (orb-copy.js); before this they taught design ("teach rhythm through contrast instead of
// pressure"), counted orbs ("Four final orbs") and trailed off in ellipses.
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';

vi.mock('../../src/rendering/phaser/board-juice.js', () => ({ BoardJuice: class BoardJuice {} }));
import { OdysseyMode } from '../../src/core/game-modes/OdysseyMode.js';
import { CHAPTER_CONFIGS } from '../../src/core/odyssey/data/chapters.js';
import { shortOdysseyChapterName } from '../../src/ui/odyssey/odyssey-navigator-model.js';

const DESIGNER_TALK = /\bteach|asks for|decisions|contrast instead|\brelease\b|\bbeat\b|encore|\borbs? await/i;
const UK_SPELLING = /colour|favour|centre|\bgrey|metre|behaviour|honour|realis|organis|recognis/i;
const DASH = / - |--|–|—/;

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('Odyssey chapter copy', () => {
    it('gives every chapter a subtitle, an intro and an outro in the voice of its orbs', () => {
        expect(CHAPTER_CONFIGS).toHaveLength(8);
        for (const chapter of CHAPTER_CONFIGS) {
            const { subtitle, narrative } = chapter;
            const where = `chapter ${chapter.id}`;
            expect(subtitle, where).toMatch(/^[A-Z][^.!?]*$/);
            expect(subtitle.length, where).toBeLessThanOrEqual(28);
            for (const line of [narrative.intro, narrative.outro]) {
                expect(line, where).toMatch(/^[A-Z].*[^.]\.$/);
                expect(line, `${where} counts something`).not.toMatch(/\d/);
                expect(line, `${where} trails off`).not.toMatch(/\.\.\.|…/);
                expect(`${subtitle} ${line}`, where).not.toMatch(DESIGNER_TALK);
                expect(`${subtitle} ${line}`, where).not.toMatch(UK_SPELLING);
                expect(`${subtitle} ${line}`, where).not.toMatch(DASH);
            }
            // The navigator shows the intro on one line on a 1366x768 screen (measured: these fit).
            expect(narrative.intro.length, `${where}: ${narrative.intro}`).toBeLessThanOrEqual(95);
            expect(narrative.outro.length, `${where}: ${narrative.outro}`).toBeLessThanOrEqual(90);
        }
        const lines = CHAPTER_CONFIGS.flatMap((chapter) => [chapter.narrative.intro, chapter.narrative.outro]);
        expect(new Set(lines).size).toBe(lines.length);
    });

    it('falls into the black hole at the end of chapter 6 and spends chapter 7 inside it', () => {
        // The map dives into the hole at orb 49, the first of chapter 7, and leaves it for the
        // city (odyssey-black-hole-fall.js); orb 47 shows it from outside, in chapter 6.
        const byId = (id) => CHAPTER_CONFIGS.find((chapter) => chapter.id === id);
        const [space, blackHole, city] = [6, 7, 8].map(byId);
        expect(shortOdysseyChapterName(blackHole.name)).toBe('Black Hole');
        expect(space.narrative.outro).toMatch(/black hole/i);
        expect(blackHole.narrative.intro).toMatch(/event horizon/i);
        expect(blackHole.narrative.intro).toMatch(/\binside\b/i);
        expect(blackHole.narrative.outro).toMatch(/black hole opens onto a city/i);
        expect(city.narrative.intro).not.toMatch(/black hole/i);
    });

    it('names the chapter on the map\'s arrival card as the navigator does, not by its renderer key', () => {
        const nodes = Object.fromEntries([
            'odyssey-chapter-arrival-card', 'odyssey-arrival-kicker',
            'odyssey-arrival-title', 'odyssey-arrival-subtitle',
        ].map((id) => [id, { id, textContent: '', classList: { add: vi.fn(), remove: vi.fn() } }]));
        vi.stubGlobal('document', { getElementById: (id) => nodes[id] || null });
        vi.stubGlobal('requestAnimationFrame', (callback) => callback());
        vi.useFakeTimers();
        const chapters = new Map(CHAPTER_CONFIGS.map((chapter) => [chapter.id, chapter]));
        const mode = {
            _chapterFlowActive: false,
            chapterArrivalCueTimer: null,
            levelRegistry: { getChapter: (id) => chapters.get(id) },
        };
        OdysseyMode.prototype._showChapterArrivalCue.call(mode, { chapterId: 5, profile: { name: 'Sky & Drift' } });
        expect(nodes['odyssey-arrival-kicker'].textContent).toBe('Chapter 5');
        expect(nodes['odyssey-arrival-title'].textContent).toBe('Sky');
        expect(nodes['odyssey-arrival-subtitle'].textContent).toBe(chapters.get(5).subtitle);
        OdysseyMode.prototype._showChapterArrivalCue.call(mode, { chapterId: 8, profile: { name: 'Urban Encore' } });
        expect(nodes['odyssey-arrival-title'].textContent).toBe('Urban Dreams Encore');
        vi.runAllTimers();
        expect(mode.chapterArrivalCueTimer).toBeNull();
    });
});

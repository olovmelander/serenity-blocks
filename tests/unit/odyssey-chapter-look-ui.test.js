/**
 * The chapter the page wears (src/ui/odyssey/odyssey-chapter-look.js): the map's header and the
 * play rail's tray take the look of the chapter the world is showing.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import {
    CHAPTER_LOOK_WATCH_MS, applyOdysseyGlassMode, odysseyChapterColor, resetOdysseyChapterLookForTests,
    watchOdysseyChapterInView, wearOdysseyChapter,
} from '../../src/ui/odyssey/odyssey-chapter-look.js';
import { ODYSSEY_CHAPTER_LOOKS, odysseyLookHex } from '../../src/core/odyssey/data/chapter-looks.js';

const page = () => ({ documentElement: { dataset: {} } });

/** A window whose intervals the test steps by hand. */
function fakeWindow(settings = {}) {
    const timers = new Map();
    let next = 1;
    return {
        settings,
        timers,
        setInterval: (callback) => { timers.set(next, callback); return next++; },
        clearInterval: (id) => { timers.delete(id); },
        tick() { [...timers.values()].forEach((callback) => callback()); },
    };
}

describe('the chapter the page wears', () => {
    afterEach(() => resetOdysseyChapterLookForTests());

    it('puts a chapter on the page and takes it off again', () => {
        const doc = page();
        expect(wearOdysseyChapter(3, doc)).toBe(true);
        expect(doc.documentElement.dataset.odyChapter).toBe('3');
        expect(wearOdysseyChapter(3, doc)).toBe(false);
        expect(wearOdysseyChapter(null, doc)).toBe(true);
        expect('odyChapter' in doc.documentElement.dataset).toBe(false);
        // Nothing that is not a chapter is ever worn.
        for (const bad of [0, 2.5, NaN, undefined, 'x']) expect(wearOdysseyChapter(bad, doc)).toBe(false);
        expect(wearOdysseyChapter(3, null)).toBe(false);
    });

    it('gives each chapter\'s light from the one table', () => {
        expect(ODYSSEY_CHAPTER_LOOKS.map((look) => odysseyChapterColor(look.id)))
            .toEqual(ODYSSEY_CHAPTER_LOOKS.map((look) => odysseyLookHex(look.accent)));
        expect(odysseyChapterColor(99)).toBe(odysseyChapterColor(1));
    });

    it('follows the world while the map shows, lets go while an orb is played, and ends with the mode', () => {
        const doc = page();
        const windowRef = fakeWindow();
        const mode = { isActive: true, isInBoardView: true, boardController: { lastActiveChapter: 2 } };
        const stop = watchOdysseyChapterInView(mode, { doc, windowRef });
        expect(doc.documentElement.dataset.odyChapter).toBe('2');
        expect(windowRef.timers.size).toBe(1);
        expect(CHAPTER_LOOK_WATCH_MS).toBeGreaterThanOrEqual(200);
        // Asking again for the same mode starts nothing new.
        expect(watchOdysseyChapterInView(mode, { doc, windowRef })).toBe(stop);
        expect(windowRef.timers.size).toBe(1);
        // The camera crosses a seam.
        mode.boardController.lastActiveChapter = 3;
        windowRef.tick();
        expect(doc.documentElement.dataset.odyChapter).toBe('3');
        // An orb is being played: the world is not showing, so the page wears no chapter.
        mode.isInBoardView = false;
        windowRef.tick();
        expect('odyChapter' in doc.documentElement.dataset).toBe(false);
        mode.isInBoardView = true;
        windowRef.tick();
        expect(doc.documentElement.dataset.odyChapter).toBe('3');
        // The mode leaves: the watch ends itself and the page is left clean.
        mode.isActive = false;
        windowRef.tick();
        expect(windowRef.timers.size).toBe(0);
        expect('odyChapter' in doc.documentElement.dataset).toBe(false);
    });

    it('replaces the watch for a new mode and survives a board that is not there yet', () => {
        const doc = page();
        const windowRef = fakeWindow();
        watchOdysseyChapterInView({ isActive: true, isInBoardView: true, boardController: null }, { doc, windowRef });
        expect('odyChapter' in doc.documentElement.dataset).toBe(false);
        watchOdysseyChapterInView({
            isActive: true, isInBoardView: true, boardController: { lastActiveChapter: 7 },
        }, { doc, windowRef });
        expect(windowRef.timers.size).toBe(1);
        expect(doc.documentElement.dataset.odyChapter).toBe('7');
        expect(() => watchOdysseyChapterInView(null, { doc, windowRef: {} })()).not.toThrow();
    });

    it('frosts the glass only where the GPU has room', () => {
        const doc = page();
        expect(applyOdysseyGlassMode('High', doc)).toBe('plain');
        expect('odyGlass' in doc.documentElement.dataset).toBe(false);
        expect(applyOdysseyGlassMode('Ultra', doc)).toBe('frost');
        expect(doc.documentElement.dataset.odyGlass).toBe('frost');
        expect(applyOdysseyGlassMode('Extreme', doc)).toBe('frost');
        expect(applyOdysseyGlassMode('Minimal', doc)).toBe('plain');
        expect('odyGlass' in doc.documentElement.dataset).toBe(false);
        expect(applyOdysseyGlassMode(undefined, null)).toBe('plain');
        // The watch keeps it in step with the player's setting.
        const windowRef = fakeWindow({ effectQuality: 'Ultra' });
        watchOdysseyChapterInView({ isActive: true, isInBoardView: true, boardController: { lastActiveChapter: 1 } }, { doc, windowRef });
        expect(doc.documentElement.dataset.odyGlass).toBe('frost');
        windowRef.settings.effectQuality = 'Low';
        windowRef.tick();
        expect('odyGlass' in doc.documentElement.dataset).toBe(false);
        vi.restoreAllMocks();
    });
});

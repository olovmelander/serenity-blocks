import { existsSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
    MAIN_MENU_MODES, chapterForProgress, newestOpenSession, readOdysseyProgress,
} from '../../src/ui/main-menu/main-menu.js';
import { CHAPTER_CONFIGS } from '../../src/core/odyssey/data/chapters.js';
import { BREATH_LADDER, STARTER_SESSIONS } from '../../src/ui/effects/breathing/breath-collection.js';
import { SESSION_WORLDS } from '../../src/ui/effects/breathing/session-worlds.js';

const PUBLIC = path.resolve(__dirname, '../../public');
const SHAPE = {
    chapters: [
        { id: 1, name: 'Earth Core & Subterranean Origins', levels: [1, 2, 3, 4, 5] },
        { id: 2, name: 'Deep Ocean & Liquid Worlds', levels: [6, 7, 8, 9, 10] },
        { id: 3, name: 'Surface World & Living Landscapes', levels: [11, 12] },
    ],
};

describe('main menu stage art', () => {
    it('shows the chapter of the next level, the first on a fresh save', () => {
        expect(chapterForProgress(SHAPE, null).id).toBe(1);
        expect(chapterForProgress(SHAPE, readOdysseyProgress(JSON.stringify({
            completedLevels: { 1: { stars: 3 }, 2: { stars: 2 }, 3: { stars: 1 }, 4: { stars: 3 }, 5: { stars: 3 } },
            currentLevel: 6,
        }))).id).toBe(2);
        // A level outside the shape falls back to the saved chapter.
        expect(chapterForProgress(SHAPE, { currentLevel: 99, currentChapter: 3 }).id).toBe(3);
        // Before the shape loads: the saved chapter number, no name to caption with.
        expect(chapterForProgress(null, { currentChapter: 2 })).toEqual({ id: 2, name: '' });
        expect(chapterForProgress(null, null)).toBeNull();
    });

    it('shows the newest open Hale session along the breath path', () => {
        const order = [...STARTER_SESSIONS, ...BREATH_LADDER.map((step) => step.session)];
        expect(newestOpenSession(order, (id) => id === 'FIRST')).toBe('FIRST');
        expect(newestOpenSession(order, (id) => ['FIRST', 'TIDE', 'ROOTS'].includes(id))).toBe('ROOTS');
        // Practice can open a later step before an earlier one: the furthest open still wins.
        expect(newestOpenSession(order, (id) => ['FIRST', 'TIDE', 'SUNRISE'].includes(id))).toBe('SUNRISE');
        expect(newestOpenSession(order, () => false)).toBe('FIRST');
    });

    it('has a picture for every mode, every Odyssey chapter and every Hale session', () => {
        Object.entries(MAIN_MENU_MODES).forEach(([mode, spec]) => {
            if (mode === 'odyssey' || mode === 'hale') return;
            expect(spec.art?.file, mode).toBeTruthy();
            expect(existsSync(path.join(PUBLIC, 'assets/menu-art', `${spec.art.file}.webp`)), spec.art.file).toBe(true);
        });
        CHAPTER_CONFIGS.forEach((chapter) => {
            expect(existsSync(path.join(PUBLIC, 'assets/menu-art', `odyssey-${chapter.id}.webp`)), `chapter ${chapter.id}`).toBe(true);
        });
        Object.entries(SESSION_WORLDS).forEach(([session, worlds]) => {
            expect(existsSync(path.join(PUBLIC, 'assets/breathing', `${worlds.featured}.webp`)), session).toBe(true);
        });
    });
});

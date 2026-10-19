import { describe, expect, it } from 'vitest';
import { LevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import {
    buildOdysseyNavigatorModel,
    preferredOdysseyChapterOrb,
    resolveOdysseyNavigatorKey,
    resolveOdysseyNavigatorSelection,
    resolveOdysseyOrbPress,
    shortOdysseyChapterName,
    stepOdysseyNavigatorOrb,
} from '../../src/ui/odyssey/odyssey-navigator-model.js';

const registry = new LevelRegistry();

/** A journey with orbs 1..cleared done (stars from the pattern) and the next one open. */
function journey({ cleared = 0, stars = [3], unlocked = null } = {}) {
    const completions = new Map();
    for (let id = 1; id <= cleared; id += 1) {
        completions.set(id, { stars: stars[(id - 1) % stars.length], bestScore: 1000 * id });
    }
    const total = registry.getTotalLevels();
    const odysseyState = {
        getProgressSummary: () => ({
            currentLevel: Math.min(total, cleared + 1),
            totalStars: [...completions.values()].reduce((sum, entry) => sum + entry.stars, 0),
            maxStars: total * 3,
        }),
        isLevelUnlocked: (id) => (unlocked ? unlocked(id) : id <= cleared + 1),
        isLevelCompleted: (id) => completions.has(id),
        getLevelStars: (id) => completions.get(id)?.stars || 0,
        getLevelCompletion: (id) => completions.get(id) || null,
    };
    return buildOdysseyNavigatorModel({ odysseyState, levelRegistry: registry });
}

describe('Odyssey navigator model', () => {
    it('shortens chapter names to the part before the ampersand', () => {
        expect(shortOdysseyChapterName('Deep Ocean & Liquid Worlds')).toBe('Deep Ocean');
        expect(shortOdysseyChapterName('Urban Dreams Encore')).toBe('Urban Dreams Encore');
        expect(shortOdysseyChapterName('')).toBe('');
    });

    it('marks every orb cleared, next, open or locked, and every chapter by its orbs', () => {
        const model = journey({ cleared: 7, stars: [3, 2, 1] });
        expect(model.orbs.size).toBe(registry.getTotalLevels());
        expect(model.nextLevelId).toBe(8);
        expect(model.orbs.get(7).state).toBe('cleared');
        expect(model.orbs.get(8).state).toBe('next');
        expect(model.orbs.get(9).state).toBe('locked');
        expect(model.chapters.map((chapter) => chapter.state).slice(0, 3)).toEqual(['complete', 'current', 'locked']);
        const [first, second] = model.chapters;
        expect(first.stars).toBe(3 + 2 + 1 + 3 + 2);
        expect(first.maxStars).toBe(first.orbs.length * 3);
        expect(second.cleared).toBe(2);
        expect(model.progress.clearedOrbs).toBe(7);
        expect(model.progress.totalOrbs).toBe(registry.getTotalLevels());
    });

    it('calls an unlocked orb that is not the next one open', () => {
        const model = journey({ cleared: 2, unlocked: () => true });
        expect(model.orbs.get(3).state).toBe('next');
        expect(model.orbs.get(40).state).toBe('open');
        expect(model.chapters[5].state).toBe('open');
    });

    it('describes each orb with its world, its kind and its authored name', () => {
        const model = journey({ cleared: 0 });
        const [firstChapter] = model.chapters;
        const rival = firstChapter.orbs[firstChapter.orbs.length - 1];
        expect(rival.kind?.id).toBe('rival');
        expect(firstChapter.orbs.some((orb) => orb.kind?.id === 'boss')).toBe(true);
        firstChapter.orbs.forEach((orb) => {
            expect(orb.themeId).toBeTruthy();
            expect(orb.name).toBe(registry.resolveLevelPresentation(orb.id).pathLabel);
            expect(orb.chapterId).toBe(firstChapter.id);
        });
    });

    it('lands a look at a chapter on its next orb, an open orb, a missing star, then the first orb', () => {
        const model = journey({ cleared: 7, stars: [3, 3, 1, 3, 3, 3, 3] });
        const [first, second, third] = model.chapters;
        expect(preferredOdysseyChapterOrb(second).id).toBe(8);
        expect(preferredOdysseyChapterOrb(first).id).toBe(3);
        expect(preferredOdysseyChapterOrb(third).id).toBe(third.orbs[0].id);
        const perfect = journey({ cleared: 5, stars: [3] }).chapters[0];
        expect(preferredOdysseyChapterOrb(perfect).id).toBe(1);
    });

    it('opens on an asked chapter, else the board selection, else the next orb', () => {
        const model = journey({ cleared: 7 });
        expect(resolveOdysseyNavigatorSelection(model, { chapterId: 1 }).orb.id).toBe(1);
        expect(resolveOdysseyNavigatorSelection(model, { levelId: 3 }).orb.id).toBe(3);
        const fallback = resolveOdysseyNavigatorSelection(model, { levelId: 999 });
        expect(fallback.orb.id).toBe(8);
        expect(fallback.chapter.id).toBe(2);
    });

    it('steps along the whole journey across chapter seams, and stops at both ends', () => {
        const model = journey({ cleared: 0 });
        const firstChapterEnd = model.chapters[0].orbs[model.chapters[0].orbs.length - 1].id;
        expect(stepOdysseyNavigatorOrb(model, firstChapterEnd, 1).chapterId).toBe(2);
        expect(stepOdysseyNavigatorOrb(model, 1, -1)).toBeNull();
        expect(stepOdysseyNavigatorOrb(model, registry.getTotalLevels(), 1)).toBeNull();
    });
});

describe('Odyssey navigator input', () => {
    it('shows an orb on its first pointer press and sets out on the next', () => {
        expect(resolveOdysseyOrbPress({
            orbId: 7, shownOrbId: 7, shownBeforePress: 9, viaPointer: true,
        })).toBe('select');
        expect(resolveOdysseyOrbPress({
            orbId: 7, shownOrbId: 7, shownBeforePress: 7, viaPointer: true,
        })).toBe('launch');
    });

    it('sets out from a key or controller press on the orb its focus showed', () => {
        expect(resolveOdysseyOrbPress({ orbId: 7, shownOrbId: 7 })).toBe('launch');
        expect(resolveOdysseyOrbPress({ orbId: 7, shownOrbId: 9 })).toBe('select');
    });

    it('walks orbs with left and right and climbs chapters with up and down, as the map does', () => {
        const model = journey({ cleared: 7 });
        expect(resolveOdysseyNavigatorKey(model, 'ArrowRight', 'orb')).toEqual({ orbStep: 1 });
        expect(resolveOdysseyNavigatorKey(model, 'ArrowLeft', 'orb')).toEqual({ orbStep: -1 });
        expect(resolveOdysseyNavigatorKey(model, 'ArrowUp', 'orb')).toEqual({ chapterStep: 1, focus: 'orb' });
        expect(resolveOdysseyNavigatorKey(model, 'ArrowDown', 'tab')).toEqual({ chapterStep: -1, focus: 'tab' });
        expect(resolveOdysseyNavigatorKey(model, 'PageUp', 'other')).toEqual({ chapterStep: 1, focus: 'auto' });
        expect(resolveOdysseyNavigatorKey(model, 'ArrowRight', 'tab')).toEqual({ focus: 'orb' });
        expect(resolveOdysseyNavigatorKey(model, 'ArrowLeft', 'tab')).toBeNull();
        expect(resolveOdysseyNavigatorKey(model, 'ArrowDown', 'other')).toEqual({ focus: 'orb' });
    });

    it('sends Home to the first orb and End to the orb the journey waits on', () => {
        const model = journey({ cleared: 7 });
        expect(resolveOdysseyNavigatorKey(model, 'Home', 'orb')).toEqual({ orbId: 1, focus: 'orb' });
        expect(resolveOdysseyNavigatorKey(model, 'End', 'orb')).toEqual({ orbId: 8, focus: 'orb' });
        expect(resolveOdysseyNavigatorKey(model, 'End', 'tab')).toEqual({ chapterId: 8, focus: 'tab' });
        expect(resolveOdysseyNavigatorKey(model, 'Enter', 'orb')).toBeNull();
    });
});

/**
 * A CHAPTER'S WORLD BEGINS WITH ITS OWN ORBS (2026-11-27).
 *
 * The owner: "In odyssey mode are the chapter starts aligned with the orbs for the chapters?" A
 * chapter starts on its first orb by construction, and the seam between two worlds is centred
 * there. An opening orb parks the scenery past its seam (audit 2026-10-18). A closing orb parked
 * on itself, and chapter 1's stands at the vent's lip, past where the sea starts to draw: an Earth
 * Core orb stood in chapter 2's water, so the sea began one orb before its chapter. It parks before
 * the seam now, and the sea arrives on the glide to the sea's first orb.
 *
 * The other chapters' closing orbs stand inside their outgoing seams too and stay parked on
 * themselves: frames of the running game show each in its own world, and the pictures there (the
 * day's turn, the ibex, the bow, the plunge, the fold's way out) are composed on those parks.
 */
import { describe, expect, it } from 'vitest';
import { getLevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import { CHAPTER_CONFIGS } from '../../src/core/odyssey/data/chapters.js';
import { resolveChapterBlendState } from '../../src/rendering/odyssey/ChapterEnvironmentManager.js';
import { resolveOrbParkProgress } from '../../src/rendering/odyssey/odyssey-chapter-arrival.js';
import { seamHalfWidth } from '../../src/rendering/odyssey/transitions/odyssey-seam-schedule.js';
import { isWorldVisibleAtProgress } from '../../src/rendering/odyssey/world/odyssey-world-act-gate.js';

const registry = getLevelRegistry();
const layout = registry.getPresentationLayout();
const cp = layout.chapterPositions;
const levels = registry.getAllLevelPresentations();
const at = (id) => layout.levelPositionsById[id];
const chapterOf = (id) => levels.find((level) => level.id === id).chapter;
const park = (id) => resolveOrbParkProgress(chapterOf(id), at(id), cp);
const blendAt = (p) => resolveChapterBlendState(p, CHAPTER_CONFIGS, cp);
/** Whether the continuous world (the sea, the island, the sky) draws for scenery at `p`. */
const seaDrawn = (p) => isWorldVisibleAtProgress(p, cp[1], cp[5]);

/** The closing orbs that stand inside their chapter's outgoing seam, chapter 1's aside. */
const COMPOSED_CLOSING_ORBS = [18, 24, 25, 26, 47, 48, 56];

describe('a chapter\'s world begins with its own orbs', () => {
    it('starts every chapter on its first orb', () => {
        CHAPTER_CONFIGS.forEach((chapter) => {
            const own = levels.filter((level) => level.chapter === chapter.id);
            expect(own[0].id, `chapter ${chapter.id}`).toBe(chapter.levelRange[0]);
            expect(own[own.length - 1].id, `chapter ${chapter.id}`).toBe(chapter.levelRange[1]);
            expect(cp[chapter.id - 1], `chapter ${chapter.id}`).toBe(at(chapter.levelRange[0]));
        });
    });

    it('parks chapter 1\'s closing orb before the sea is drawn', () => {
        // The orb itself stands at the vent's lip, inside the 1->2 seam, where the sea draws...
        expect(at(5)).toBeGreaterThan(cp[1] - seamHalfWidth(1));
        expect(seaDrawn(at(5))).toBe(true);
        expect(blendAt(at(5)).inSeam).toBe(true);
        // ...and its scenery parks in the Earth Core alone, above the orb before it.
        expect(park(5)).toBeLessThan(cp[1] - seamHalfWidth(1));
        expect(park(5)).toBeGreaterThan(at(4));
        expect(seaDrawn(park(5))).toBe(false);
        const parked = blendAt(park(5));
        expect(parked.inSeam).toBe(false);
        expect(parked.weights[1]).toBe(1);
    });

    it('shows every Earth Core orb without the sea, and the sea from its own first orb', () => {
        for (const id of [1, 2, 3, 4, 5]) {
            expect(seaDrawn(park(id)), `orb ${id}`).toBe(false);
            expect(blendAt(park(id)).weights[1], `orb ${id}`).toBe(1);
        }
        expect(seaDrawn(park(6))).toBe(true);
        expect(blendAt(park(6)).weights[2]).toBe(1);
    });

    it('leaves the other chapters\' closing orbs parked on themselves', () => {
        COMPOSED_CLOSING_ORBS.forEach((id) => {
            const chapter = chapterOf(id);
            const seamStart = cp[chapter] - seamHalfWidth(chapter);
            expect(at(id), `orb ${id} stands inside its outgoing seam`).toBeGreaterThan(seamStart);
            expect(park(id), `orb ${id}`).toBe(at(id));
        });
        // Every other orb past its chapter's opening seam parks on itself too.
        levels.forEach((level) => {
            const start = cp[level.chapter - 1];
            const opening = level.chapter > 1 && at(level.id) < start + seamHalfWidth(level.chapter - 1);
            if (opening || level.id === 5) return;
            expect(park(level.id), `orb ${level.id}`).toBe(at(level.id));
        });
    });

    it('still parks an opening orb past its incoming seam, in its own chapter alone', () => {
        CHAPTER_CONFIGS.filter((chapter) => chapter.id > 1).forEach((chapter) => {
            const first = chapter.levelRange[0];
            expect(park(first), `orb ${first}`).toBeGreaterThan(cp[chapter.id - 1] + seamHalfWidth(chapter.id - 1));
            const parked = blendAt(park(first));
            expect(parked.inSeam, `orb ${first}`).toBe(false);
            expect(parked.weights[chapter.id], `orb ${first}`).toBe(1);
        });
    });

    it('keeps the parks in the orbs\' order', () => {
        for (let id = 1; id < levels.length; id += 1) {
            expect(park(id + 1), `orbs ${id} and ${id + 1}`).toBeGreaterThanOrEqual(park(id));
        }
    });

    it('tolerates a missing layout', () => {
        expect(resolveOrbParkProgress(1, 0.056)).toBe(0.056);
        expect(resolveOrbParkProgress(2, 0.0649)).toBe(0.0649);
        expect(resolveOrbParkProgress(1, Number.NaN, cp)).toBeNaN();
    });
});

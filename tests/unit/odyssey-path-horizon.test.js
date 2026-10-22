/**
 * THE PATH VANISHES INTO THE HOLE (2026-10-22): through chapter 6 the rail ends at the 6->7
 * boundary and the nodes beyond it are not drawn; the far rail retracts across the 5->6 seam.
 * Nothing past the mouth (chapter 7's first node) is drawn until the eye is wholly inside the
 * hole; then the rest of the journey is laid out by the next node.
 */
import { describe, expect, it } from 'vitest';
import { getLevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import {
    ODYSSEY_PATH_HORIZON,
    PATH_HORIZON_OPEN,
    odysseyPathHorizonWeight,
    resolveOdysseyPathHorizon,
} from '../../src/rendering/odyssey/odyssey-path-horizon.js';
import {
    getChapterTransitionForChapter,
} from '../../src/rendering/odyssey/chapter-environments/shared/chapter-profile.js';
import {
    resolveBlackHoleFall,
    resolveBlackHoleInsideProgress,
} from '../../src/rendering/odyssey/transitions/odyssey-black-hole-fall.js';

describe('Odyssey path horizon (the rail vanishes into the black hole)', () => {
    const { chapterPositions, levelPositions } = getLevelRegistry().getPresentationLayout();
    const ch6Start = chapterPositions[5];
    const ch7Start = chapterPositions[6];
    const wIn = getChapterTransitionForChapter(5).seamWidth;
    const horizon = (p) => resolveOdysseyPathHorizon(p, chapterPositions, levelPositions);
    const drawn = (x, p) => odysseyPathHorizonWeight(x, horizon(p));
    // The eye is inside the hole from here; the way on is laid out by the next node.
    const inside = resolveBlackHoleInsideProgress(chapterPositions);
    const nextNode = Math.min(...levelPositions.filter((x) => x > inside + 1e-6));

    it('places the plunge between the mouth and the next node', () => {
        expect(inside).toBeGreaterThan(ch7Start);
        expect(levelPositions.filter((x) => x > ch7Start + 1e-6 && x < inside)).toHaveLength(0);
        expect(resolveBlackHoleFall(inside, chapterPositions).inside).toBeCloseTo(1, 9);
    });

    it('hides nothing before chapter 6 and once the eye has reached the node inside the hole', () => {
        [0, 0.1, 0.4, ch6Start - wIn - 1e-4, nextNode, nextNode + 0.01, 0.95, 1].forEach((p) => {
            expect(horizon(p), `p=${p}`).toBe(PATH_HORIZON_OPEN);
            expect(drawn(1, p)).toBe(1);
        });
    });

    it('ends the rail at the mouth through chapter 6 and until the eye is inside the hole', () => {
        const levelsBeyond = levelPositions.filter((x) => x > ch7Start + ODYSSEY_PATH_HORIZON.soft);
        const levelsInChapter6 = levelPositions.filter((x) => x >= ch6Start && x <= ch7Start);
        expect(levelsBeyond.length).toBeGreaterThan(5);
        for (let p = ch6Start + wIn; p < inside; p += 0.001) {
            // The node AT the mouth (chapter 7's first) and every chapter 6 node are drawn...
            levelsInChapter6.forEach((x) => expect(drawn(x, p), `node ${x.toFixed(4)} @p=${p.toFixed(4)}`).toBe(1));
            // ...and nothing past the taper: not the climb, the tunnel or chapter 8.
            levelsBeyond.forEach((x) => expect(drawn(x, p), `node ${x.toFixed(4)} @p=${p.toFixed(4)}`).toBe(0));
            expect(drawn(1, p)).toBe(0);
        }
        // Parked on the mouth: the rail into the hole, and no way on yet.
        expect(horizon(ch7Start)).toBeCloseTo(ch7Start + ODYSSEY_PATH_HORIZON.soft, 9);
    });

    it('lays the way on out inside the hole, by the next node, without a pop', () => {
        expect(horizon(inside)).toBeCloseTo(ch7Start + ODYSSEY_PATH_HORIZON.soft, 9);
        expect(horizon(nextNode)).toBe(PATH_HORIZON_OPEN);
        expect(drawn(1, nextNode - 1e-6)).toBeGreaterThan(0.99);
        // The horizon SWEEPS, it never jumps. The reveal runs inside the hole over the last few
        // units of the glide, so it is quick, but still a sweep, never a step of the whole path.
        let prev = horizon(0);
        for (let p = 0.0005; p <= 1; p += 0.0005) {
            const h = Math.min(horizon(p), 1.02);
            expect(Math.abs(h - Math.min(prev, 1.02)), `step at p=${p.toFixed(4)}`).toBeLessThan(0.05);
            prev = horizon(p);
        }
    });

    it('opens up for an unknown layout, and without node positions still waits for the inside', () => {
        expect(resolveOdysseyPathHorizon(0.8, null)).toBe(PATH_HORIZON_OPEN);
        expect(resolveOdysseyPathHorizon(Number.NaN, chapterPositions)).toBe(PATH_HORIZON_OPEN);
        expect(resolveOdysseyPathHorizon(inside - 1e-4, chapterPositions))
            .toBeCloseTo(ch7Start + ODYSSEY_PATH_HORIZON.soft, 9);
        expect(resolveOdysseyPathHorizon(inside + 0.02, chapterPositions)).toBe(PATH_HORIZON_OPEN);
    });
});

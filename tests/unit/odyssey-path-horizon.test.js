/**
 * THE PATH VANISHES INTO THE HOLE (2026-10-22): through chapter 6 the rail ends at the 6->7
 * boundary and the nodes beyond it are not drawn; the far rail retracts across the 5->6 seam.
 * From there the way on is laid out one node at a time, and all of it once chapter 7's fall has
 * the hole swallowing the frame.
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
import { CH7_FALL } from '../../src/rendering/odyssey/transitions/odyssey-black-hole-fall.js';

describe('Odyssey path horizon (the rail vanishes into the black hole)', () => {
    const { chapterPositions, levelPositions } = getLevelRegistry().getPresentationLayout();
    const ch6Start = chapterPositions[5];
    const ch7Start = chapterPositions[6];
    const wIn = getChapterTransitionForChapter(5).seamWidth;
    const wOut = getChapterTransitionForChapter(6).seamWidth;
    const ch8Start = chapterPositions[7];
    const horizon = (p) => resolveOdysseyPathHorizon(p, chapterPositions, levelPositions);
    const drawn = (x, p) => odysseyPathHorizonWeight(x, horizon(p));
    // The way on's stops: the boundary node, then chapter 7's nodes until the hole has swallowed
    // the frame (levels 49-52 in the shipped layout).
    const swallowed = ch7Start + ((ch8Start - ch7Start) * CH7_FALL.horizon);
    const stops = [ch7Start, ...levelPositions.filter((x) => x > ch7Start + 1e-6 && x <= swallowed + 1e-6)];
    const wayOnEnd = stops[stops.length - 1];

    it('hides nothing before chapter 6 and once the hole has swallowed the frame', () => {
        expect(stops.length).toBeGreaterThanOrEqual(3);
        [0, 0.1, 0.4, ch6Start - wIn - 1e-4, wayOnEnd, wayOnEnd + 0.01, 0.95, 1].forEach((p) => {
            expect(horizon(p), `p=${p}`).toBe(PATH_HORIZON_OPEN);
            expect(drawn(1, p)).toBe(1);
        });
    });

    it('ends the rail at the 6->7 boundary through chapter 6, keeping chapter 7\'s first node', () => {
        const levelsBeyond = levelPositions.filter((x) => x > ch7Start + ODYSSEY_PATH_HORIZON.soft);
        const levelsInChapter6 = levelPositions.filter((x) => x >= ch6Start && x <= ch7Start);
        expect(levelsBeyond.length).toBeGreaterThan(5);
        for (let p = ch6Start + wIn; p < ch7Start - wOut; p += 0.002) {
            // The node ON the boundary (chapter 7's first) and every chapter 6 node are drawn...
            levelsInChapter6.forEach((x) => expect(drawn(x, p), `node ${x.toFixed(4)} @p=${p.toFixed(4)}`).toBe(1));
            // ...and nothing past the taper: not the climb, not chapter 8.
            levelsBeyond.forEach((x) => expect(drawn(x, p), `node ${x.toFixed(4)} @p=${p.toFixed(4)}`).toBe(0));
            expect(drawn(1, p)).toBe(0);
        }
    });

    it('never leaves a parked player looking at a half-drawn rail', () => {
        // Parked on chapter 6's last node the rail still vanishes into the hole; the far rail is
        // laid out on the glide from it to the boundary node.
        const lastNode = Math.max(...levelPositions.filter((x) => x > ch6Start && x < ch7Start - 1e-6));
        expect(drawn(1, lastNode)).toBe(0);
        expect(drawn(ch7Start + 0.02, lastNode)).toBe(0);
        expect(horizon(lastNode)).toBeCloseTo(ch7Start + ODYSSEY_PATH_HORIZON.soft, 9);
        // Without node positions the reveal still ends at the boundary.
        expect(resolveOdysseyPathHorizon(ch7Start, chapterPositions)).toBe(PATH_HORIZON_OPEN);
    });

    it('lays the way on out one node at a time: the next node drawn, nothing past it', () => {
        stops.slice(0, -1).forEach((stop, k) => {
            const next = stops[k + 1];
            // Parked on a stop the rail runs to the next node and tapers out just past it...
            expect(horizon(stop), `stop ${k}`).toBeCloseTo(next + ODYSSEY_PATH_HORIZON.soft, 9);
            expect(drawn(next, stop), `next node from stop ${k}`).toBe(1);
            // ...so it never stops between two nodes, and no node past the next one is drawn.
            levelPositions.filter((x) => x > next + ODYSSEY_PATH_HORIZON.soft)
                .forEach((x) => expect(drawn(x, stop), `node ${x.toFixed(4)} from stop ${k}`).toBe(0));
        });
        // Measured from level 49: the climb at p 0.890-0.901 crossed the face of the hole. From the
        // boundary node it is not drawn.
        for (let x = 0.890; x <= 0.901; x += 0.001) expect(drawn(x, ch7Start), `x=${x.toFixed(3)}`).toBe(0);
    });

    it('lays the whole way on out on the glide onto the last stop, without a jump anywhere', () => {
        expect(horizon(wayOnEnd)).toBe(PATH_HORIZON_OPEN);
        expect(drawn(1, wayOnEnd - 1e-6)).toBeGreaterThan(0.99);
        // The horizon SWEEPS, it never jumps: on each glide it runs ahead at most ~50x the eye's
        // own speed (a pop would be a step of a whole stretch of rail).
        let prev = horizon(0);
        for (let p = 0.0005; p <= 1; p += 0.0005) {
            const h = Math.min(horizon(p), 1.02);
            expect(Math.abs(h - Math.min(prev, 1.02)), `step at p=${p.toFixed(4)}`).toBeLessThan(0.025);
            prev = horizon(p);
        }
    });

    it('opens up for an unknown layout', () => {
        expect(resolveOdysseyPathHorizon(0.8, null)).toBe(PATH_HORIZON_OPEN);
        expect(resolveOdysseyPathHorizon(Number.NaN, chapterPositions)).toBe(PATH_HORIZON_OPEN);
    });
});

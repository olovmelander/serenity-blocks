import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { getActiveOdysseyChapterPositions } from '../../src/rendering/odyssey/path-utils.js';
import {
    DEFAULT_ODYSSEY_TRANSITION,
    ODYSSEY_CHAPTER_PROFILES,
} from '../../src/rendering/odyssey/chapter-environments/shared/chapter-profile.js';

/**
 * ACT-GATE — the continuous world must not draw in chapters that own their own frame.
 *
 * This is a CORRECTNESS guard, not a perf one. The world group was added to the scene once
 * and its `.visible` never written, so its ground/water/sky/cloud/god-rays drew through
 * chapters 1, 6, 7 and 8 too. Earth Core showed it worst: its vault backstop is an opaque
 * BackSide sphere at r=250 with `depthWrite = false` and renderOrder -90, so the world's
 * depth-writing geometry paints straight over it. Captured at p=0.051, Chapter 1's ember-lit
 * molten cathedral was rendering as magma columns in Act II's blue-teal ocean.
 *
 * The margin is the part that is easy to get wrong — the first attempt at this fix used the
 * journey's widest seamWidth (0.06) and did not fix the captured frame at all, because that
 * reaches back to p=0.033, only ~35% into Chapter 1. These tests pin the arithmetic.
 */
const ROOT = path.resolve(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
    '../..',
);
const BOARD = readFileSync(
    path.join(ROOT, 'src/rendering/odyssey/OdysseyBoardController.js'),
    'utf8',
);
const MARGIN = Number(BOARD.match(/const ONE_WORLD_ACT_MARGIN = ([\d.]+);/)[1]);

const seamWidthOf = (chapterId) => {
    const p = ODYSSEY_CHAPTER_PROFILES.find((c) => c.id === chapterId);
    return p?.transition?.seamWidth ?? DEFAULT_ODYSSEY_TRANSITION.seamWidth;
};

describe('the world is gated to Act II', () => {
    const cp = getActiveOdysseyChapterPositions();
    const actStart = cp[1];
    const actEnd = cp[5];
    const visibleAt = (p) => p > (actStart - MARGIN) && p < (actEnd + MARGIN);

    it('the margin is the authored seamWidth of BOTH act edges, not the widest in the journey', () => {
        expect(seamWidthOf(1)).toBe(MARGIN);
        expect(seamWidthOf(5)).toBe(MARGIN);
    });

    it('hides the world at the frame where the defect was captured (p=0.051, mid Chapter 1)', () => {
        // The regression test for my own first attempt: margin 0.06 leaves this visible.
        expect(visibleAt(0.051)).toBe(false);
    });

    it('keeps the world through the act-edge seams, so the handoff never shows a gap', () => {
        expect(visibleAt(actStart)).toBe(true);
        expect(visibleAt(actStart - (MARGIN * 0.5))).toBe(true);
        expect(visibleAt(actEnd)).toBe(true);
        expect(visibleAt(actEnd + (MARGIN * 0.5))).toBe(true);
    });

    it('draws across the whole of Act II', () => {
        for (let i = 0; i <= 20; i += 1) {
            const p = actStart + ((actEnd - actStart) * (i / 20));
            expect(visibleAt(p), `Act II p=${p.toFixed(3)} must draw`).toBe(true);
        }
    });

    it('hides the world deep in the chapters that own their own frame', () => {
        expect(visibleAt(0.0), 'journey start, Earth Core').toBe(false);
        expect(visibleAt(1.0), 'journey end, Urban Dreams').toBe(false);
    });

    it('hands the sky back: the dome cull follows visibility, not merely existence', () => {
        // Culling the global dome whenever a world EXISTS would leave a gated-out world
        // owning a sky it is not drawing.
        expect(BOARD).toMatch(/this\.atmosphere && this\.oneWorld && this\._oneWorldVisible !== false/);
    });

    it('skips the world update while hidden, but leaves heightAt and fog readable', () => {
        expect(BOARD).toMatch(/if \(worldVisible\) this\.oneWorld\.update\(/);
        // The fog handover and the orb ground-sampler read plain data off the world and must
        // keep working regardless of whether it draws.
        expect(BOARD).toMatch(/const worldFog = this\.oneWorld\.fog;/);
    });
});

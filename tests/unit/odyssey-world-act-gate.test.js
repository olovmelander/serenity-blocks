import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { getActiveOdysseyChapterPositions } from '../../src/rendering/odyssey/path-utils.js';
import {
    ONE_WORLD_ACT_MARGIN,
    ONE_WORLD_DEPARTURE_LEAD,
    ONE_WORLD_THIN_LEAD,
    ONE_WORLD_THIN_MAX,
    isWorldVisibleAtProgress,
    worldAtmosphericThin,
    worldDepartureFade,
} from '../../src/rendering/odyssey/world/odyssey-world-act-gate.js';
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
// Import the REAL gate rather than re-deriving it: a test that reimplements the predicate
// passes happily while the game does something else.
const MARGIN = ONE_WORLD_ACT_MARGIN;

const seamWidthOf = (chapterId) => {
    const p = ODYSSEY_CHAPTER_PROFILES.find((c) => c.id === chapterId);
    return p?.transition?.seamWidth ?? DEFAULT_ODYSSEY_TRANSITION.seamWidth;
};

describe('the world is gated to Act II', () => {
    const cp = getActiveOdysseyChapterPositions();
    const actStart = cp[1];
    const actEnd = cp[5];
    const visibleAt = (p) => isWorldVisibleAtProgress(p, actStart, actEnd);

    it('the margin is the authored seamWidth of BOTH act edges, not the widest in the journey', () => {
        expect(seamWidthOf(1)).toBe(MARGIN);
        expect(seamWidthOf(5)).toBe(MARGIN);
    });

    it('hides the world at the frame where the defect was captured (mid Chapter 1)', () => {
        // The regression test for the first attempt at this fix: margin 0.06 leaves it visible.
        //
        // DERIVED, not a literal. The capture was at p=0.051 when chapter 2 began at 0.093 —
        // i.e. 54.8% of the way through chapter 1. Wave 1A's ascent lengthened the journey
        // (1767.65 -> 2276.62) so every p re-normalised and that literal now points somewhere
        // else entirely. The defect is a fact about a WORLD position mid-chapter-1, so express
        // it that way and it survives the next re-layout too.
        const midChapter1 = cp[1] * 0.548;
        expect(visibleAt(midChapter1)).toBe(false);
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

    it('the board asks the shared gate rather than reimplementing it', () => {
        expect(BOARD).toMatch(/isWorldVisibleAtProgress\(cameraProgress, actStart, actEnd\)/);
    });

    it('degrades to VISIBLE on an unreadable layout, rather than blanking Act II', () => {
        expect(isWorldVisibleAtProgress(NaN, actStart, actEnd)).toBe(true);
        expect(isWorldVisibleAtProgress(0.3, undefined, actEnd)).toBe(true);
    });

    it('hands the sky back: the dome cull follows visibility, not merely existence', () => {
        // Culling the global dome whenever a world EXISTS would leave a gated-out world
        // owning a sky it is not drawing.
        expect(BOARD).toMatch(/this\.atmosphere && this\.oneWorld && this\._oneWorldVisible !== false/);
    });

    it('skips the world update while hidden, but leaves heightAt and fog readable', () => {
        // REPLACED 2026-08-13 (same requirement, new shape): the update call grew a fourth
        // argument (the real eye height, for eye-driven uSubmerged) and became a guarded
        // block. The assertion still requires the gate — an unguarded update() fails it.
        expect(BOARD).toMatch(/if \(worldVisible\) \{[^}]*this\.oneWorld\.update\(/);
        // The fog handover and the orb ground-sampler read plain data off the world and must
        // keep working regardless of whether it draws.
        expect(BOARD).toMatch(/const worldFog = this\.oneWorld\.fog;/);
    });
});

describe('the world RECEDES before the gate fires (Wave 1B)', () => {
    const cp = getActiveOdysseyChapterPositions();
    const actEnd = cp[5];
    const skyStart = cp[4];
    const fade = (p) => worldDepartureFade(p, skyStart, actEnd);

    it('is fully closed BEFORE the visibility flag flips — the whole point', () => {
        // The cliff was: full strength, then nothing, in one frame. The recession must have
        // finished while the world is still allowed to draw, so the boolean has nothing
        // visible left to hide. If this ever regresses, the -89 luma step comes back.
        const gateFires = actEnd + ONE_WORLD_ACT_MARGIN;
        expect(fade(gateFires)).toBeCloseTo(1, 6);
        expect(fade(gateFires - 1e-4)).toBeGreaterThan(0.999);
        expect(isWorldVisibleAtProgress(gateFires - 1e-4, cp[1], actEnd)).toBe(true);
    });

    it('leaves the whole of Act II untouched', () => {
        // A no-op everywhere it matters: nothing before the last 30% of the sky chapter may
        // dim by even a fraction, or the act quietly loses contrast for the whole journey.
        for (let i = 0; i <= 20; i += 1) {
            const p = cp[1] + ((skyStart - cp[1]) * (i / 20));
            expect(fade(p), `p=${p.toFixed(3)} must be untouched`).toBe(0);
        }
        expect(fade(skyStart)).toBe(0);
    });

    it('is monotonic and smooth across the departure', () => {
        let prev = -1;
        for (let i = 0; i <= 60; i += 1) {
            const p = skyStart + ((actEnd + ONE_WORLD_ACT_MARGIN - skyStart) * (i / 60));
            const v = fade(p);
            expect(v).toBeGreaterThanOrEqual(prev);
            prev = v;
        }
        // Smoothstep ends: no step at either edge of the ramp. Uses the exported constant,
        // not a literal — the lead is a tuning value and this assertion is about the SHAPE.
        expect(fade(actEnd - (actEnd - skyStart) * ONE_WORLD_DEPARTURE_LEAD)).toBeCloseTo(0, 6);
    });

    it('survives a re-layout, because it is expressed in fractions', () => {
        // Wave 1A moves every chapter boundary. Feed it a completely different layout and the
        // contract must still hold: closed before the gate, zero through the act.
        const alt = { skyStart: 0.3882, actEnd: 0.701 };
        const altFade = (p) => worldDepartureFade(p, alt.skyStart, alt.actEnd);
        expect(altFade(alt.actEnd + ONE_WORLD_ACT_MARGIN)).toBeCloseTo(1, 6);
        expect(altFade(alt.skyStart)).toBe(0);
    });
});

describe('the SKY thins with altitude before the world leaves (Wave 3 / F3)', () => {
    const cp = getActiveOdysseyChapterPositions();
    const actEnd = cp[5];
    const skyStart = cp[4];
    const thin = (p) => worldAtmosphericThin(p, skyStart, actEnd);
    const thinStart = actEnd - (actEnd - skyStart) * ONE_WORLD_THIN_LEAD;

    it('leaves the deck at full form through everything below the climb', () => {
        // F3's fix must not quietly flatten the deck for the whole act — the thinning is
        // an ALTITUDE read, and below the climb there is no altitude story to tell.
        for (let i = 0; i <= 20; i += 1) {
            const p = cp[1] + ((thinStart - cp[1]) * (i / 20));
            expect(thin(p), `p=${p.toFixed(3)} must be untouched`).toBe(0);
        }
    });

    it('opens EARLIER than the departure fade, and never completes', () => {
        // The thinning is the sky losing body while the world below is still vivid; the
        // fade is the whole world leaving. Order matters: thin first, then fade.
        expect(ONE_WORLD_THIN_LEAD).toBeGreaterThan(ONE_WORLD_DEPARTURE_LEAD);
        // A deck at zero would hand the limb bank nothing to cross — the cap is the
        // difference between thinning the sky and deleting it.
        expect(thin(actEnd)).toBeCloseTo(ONE_WORLD_THIN_MAX, 6);
        expect(ONE_WORLD_THIN_MAX).toBeLessThan(1);
        expect(thin(actEnd + ONE_WORLD_ACT_MARGIN)).toBeCloseTo(ONE_WORLD_THIN_MAX, 6);
    });

    it('is monotonic and smooth across the climb', () => {
        let prev = -1;
        for (let i = 0; i <= 60; i += 1) {
            const p = skyStart + ((actEnd - skyStart) * (i / 60));
            const v = thin(p);
            expect(v).toBeGreaterThanOrEqual(prev);
            expect(v).toBeLessThanOrEqual(ONE_WORLD_THIN_MAX + 1e-9);
            prev = v;
        }
    });

    it('survives a re-layout, because it is expressed in fractions', () => {
        const alt = { skyStart: 0.3882, actEnd: 0.701 };
        const altThin = (p) => worldAtmosphericThin(p, alt.skyStart, alt.actEnd);
        expect(altThin(alt.skyStart)).toBe(0);
        expect(altThin(alt.actEnd)).toBeCloseTo(ONE_WORLD_THIN_MAX, 6);
    });

    it('degrades to zero on an unreadable layout', () => {
        expect(worldAtmosphericThin(NaN, skyStart, actEnd)).toBe(0);
        expect(worldAtmosphericThin(0.7, undefined, actEnd)).toBe(0);
    });
});

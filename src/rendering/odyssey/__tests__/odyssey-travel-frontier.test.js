import { describe, expect, it } from 'vitest';
import {
    DEFAULT_FRONTIER_MARGIN,
    clampToFrontier,
    computeTravelFrontier,
    isHeldAtFrontier,
} from '../odyssey-travel-frontier.js';

/**
 * The Galaxy guarantee: the player can never reach a chapter that is not prepared.
 * These tests are the whole safety argument for gating travel, so they lean hardest on the
 * failure modes — being walled in is a worse bug than the stutter this prevents.
 */

// A plausible 8-chapter journey: chapter c spans positions[c-1]..positions[c].
const POSITIONS = [0, 0.13, 0.28, 0.42, 0.55, 0.68, 0.79, 0.9, 1];
const allReady = () => true;
const readyUpTo = (n) => (chapter) => chapter <= n;

describe('computeTravelFrontier', () => {
    it('allows the whole journey when every chapter is prepared', () => {
        expect(computeTravelFrontier({ chapterPositions: POSITIONS, isChapterReady: allReady })).toBe(1);
    });

    it('holds just before the first unprepared chapter', () => {
        // Chapters 1-3 ready, so the player may travel THROUGH chapter 3 and holds at the
        // opening boundary of chapter 4 — POSITIONS[3] = 0.42, not the start of 3.
        const frontier = computeTravelFrontier({
            chapterPositions: POSITIONS,
            isChapterReady: readyUpTo(3),
        });
        expect(frontier).toBeCloseTo(0.42 - DEFAULT_FRONTIER_MARGIN, 6);
    });

    it('stops at the FIRST gap even when later chapters are prepared', () => {
        // The measured real case: One World means chapters 6/7/8 can be ready while an earlier
        // one is not. A prepared 8 must not entitle anyone to cross an unprepared 4.
        const swissCheese = (c) => c !== 4;
        const frontier = computeTravelFrontier({
            chapterPositions: POSITIONS,
            isChapterReady: swissCheese,
        });
        expect(frontier).toBeCloseTo(0.42 - DEFAULT_FRONTIER_MARGIN, 6);
    });

    it('never returns a negative frontier when even chapter 1 is unprepared', () => {
        const frontier = computeTravelFrontier({
            chapterPositions: POSITIONS,
            isChapterReady: () => false,
        });
        expect(frontier).toBe(0);
    });

    it('honours a custom margin', () => {
        const frontier = computeTravelFrontier({
            chapterPositions: POSITIONS,
            isChapterReady: readyUpTo(1),
            margin: 0.02,
        });
        expect(frontier).toBeCloseTo(0.13 - 0.02, 6);
    });

    // ---- FAIL OPEN. Being stuck is worse than stuttering. ----

    it('fails OPEN on malformed positions rather than walling the player in', () => {
        expect(computeTravelFrontier({ chapterPositions: null, isChapterReady: () => false })).toBe(1);
        expect(computeTravelFrontier({ chapterPositions: [], isChapterReady: () => false })).toBe(1);
        expect(computeTravelFrontier({ chapterPositions: [0], isChapterReady: () => false })).toBe(1);
        expect(computeTravelFrontier({
            chapterPositions: [0, Number.NaN, 1],
            isChapterReady: () => false,
        })).toBe(1);
    });

    it('fails OPEN when the readiness predicate is missing or throws', () => {
        expect(computeTravelFrontier({ chapterPositions: POSITIONS })).toBe(1);
        expect(computeTravelFrontier({
            chapterPositions: POSITIONS,
            isChapterReady: () => { throw new Error('boom'); },
        })).toBe(1);
    });

    it('treats a non-boolean truthy answer as NOT ready — readiness must be explicit', () => {
        const frontier = computeTravelFrontier({
            chapterPositions: POSITIONS,
            isChapterReady: () => 'yes',
        });
        expect(frontier).toBe(0);
    });

    it('fails OPEN on a garbage margin instead of producing a garbage frontier', () => {
        const frontier = computeTravelFrontier({
            chapterPositions: POSITIONS,
            isChapterReady: readyUpTo(2),
            margin: Number.NaN,
        });
        expect(frontier).toBeCloseTo(0.28 - DEFAULT_FRONTIER_MARGIN, 6);
    });
});

describe('clampToFrontier', () => {
    it('limits a target beyond the frontier but leaves one below it alone', () => {
        expect(clampToFrontier(0.9, 0.5)).toBe(0.5);
        expect(clampToFrontier(0.2, 0.5)).toBe(0.2);
    });

    it('passes non-finite values through untouched rather than inventing a position', () => {
        expect(clampToFrontier(Number.NaN, 0.5)).toBeNaN();
        expect(clampToFrontier(0.7, Number.NaN)).toBe(0.7);
    });

    it('never moves the player BACKWARD — a hold stops travel, it does not rewind it', () => {
        // If the frontier retreats behind the player (a chapter unloaded, say), clamping the
        // TARGET must not yank them back; travel simply stops until it is ready again.
        const position = 0.6;
        const clampedTarget = clampToFrontier(0.65, 0.5);
        expect(clampedTarget).toBeLessThan(position);
        // ...which is why the caller clamps the TARGET only, and never assigns to currentPosition.
    });
});

describe('isHeldAtFrontier', () => {
    it('reports a hold when the player has arrived at the frontier', () => {
        expect(isHeldAtFrontier(0.499, 0.5)).toBe(true);
        expect(isHeldAtFrontier(0.5, 0.5)).toBe(true);
    });

    it('is not a hold while still travelling below the frontier', () => {
        expect(isHeldAtFrontier(0.3, 0.5)).toBe(false);
    });

    it('does not call the journey end a hold', () => {
        expect(isHeldAtFrontier(1, 1)).toBe(false);
    });

    it('is false for non-finite inputs', () => {
        expect(isHeldAtFrontier(Number.NaN, 0.5)).toBe(false);
        expect(isHeldAtFrontier(0.5, Number.NaN)).toBe(false);
    });
});

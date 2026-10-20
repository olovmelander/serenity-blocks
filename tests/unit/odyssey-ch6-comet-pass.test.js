/**
 * THE COMET FINISHES THE CROSSING IT HAS BEGUN (2026-10-20, in-game feedback: things "disappear
 * before we have moved past them").
 *
 * Chapter 6's comet crosses the sky on a 70 s chord and its progress window closes over
 * p 0.820-0.834 (the L43 -> L45 glides). The window used to multiply the crossing under way, so
 * the comet dissolved mid-sky — measured on the real camera with 60-75 % of its chord in frame.
 * The window now only decides each crossing as it starts; one that has begun leaves the way every
 * crossing does, as a glint at the end of its chord.
 */
import { describe, expect, it } from 'vitest';
import {
    COMET_PATH, resolveCometPassWindow,
} from '../../src/rendering/odyssey/chapter-environments/cosmic-expanse.js';

describe("chapter 6's comet", () => {
    const period = COMET_PATH.periodSec;

    it('keeps a crossing at the window it started with, whatever the window does meanwhile', () => {
        const state = {};
        expect(resolveCometPassWindow(state, period * 3 + 1, 1)).toBe(1);
        // The window closes mid-chord (the camera glides on): the crossing runs on at full.
        expect(resolveCometPassWindow(state, period * 3 + 20, 0.4)).toBe(1);
        expect(resolveCometPassWindow(state, period * 3 + 60, 0)).toBe(1);
        // The next crossing starts with the window shut: it never begins.
        expect(resolveCometPassWindow(state, period * 4 + 1, 0)).toBe(0);
    });

    it('does not pop a crossing in mid-sky either: an opening window waits for the next chord', () => {
        const state = {};
        expect(resolveCometPassWindow(state, period * 7 + 30, 0)).toBe(0);
        expect(resolveCometPassWindow(state, period * 7 + 40, 1)).toBe(0);
        expect(resolveCometPassWindow(state, period * 8 + 0.5, 1)).toBe(1);
    });
});

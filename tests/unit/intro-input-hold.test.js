/**
 * The title's begin-input waits for a connected arrival to land: while the loading wordmark is
 * still growing into the title (warp path or CSS fallback), an early unlock is deferred to the
 * landing, so a stray key never cuts the flight in half; a teardown drops the pending unlock.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { IntroAnimation } from '../../src/ui/intro-animation.js';

describe('the title holds begin-input until the wordmark lands', () => {
    let now;
    beforeEach(() => {
        vi.useFakeTimers();
        now = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('defers an early unlock to the landing', () => {
        const intro = new IntroAnimation();
        intro.isActive = true;
        intro.interactionEnabled = false; // as show() leaves a held title
        intro.interactionLockedUntil = now + 2750;
        intro.enableInteraction();
        expect(intro.interactionEnabled).toBe(false);
        now += 2000;
        vi.advanceTimersByTime(2000);
        expect(intro.interactionEnabled).toBe(false);
        now += 800;
        vi.advanceTimersByTime(800);
        expect(intro.interactionEnabled).toBe(true);
    });

    it('unlocks at once when nothing is in flight', () => {
        const intro = new IntroAnimation();
        intro.isActive = true;
        intro.interactionEnabled = false; // as show() leaves a held title
        intro.enableInteraction();
        expect(intro.interactionEnabled).toBe(true);
    });

    it('drops the pending unlock when the intro is torn down', () => {
        const intro = new IntroAnimation();
        intro.isActive = true;
        intro.interactionEnabled = false; // as show() leaves a held title
        intro.interactionLockedUntil = now + 2000;
        intro.enableInteraction();
        intro.clearTitleRevealSafety();
        now += 3000;
        vi.advanceTimersByTime(3000);
        expect(intro.interactionEnabled).toBe(false);
    });
});

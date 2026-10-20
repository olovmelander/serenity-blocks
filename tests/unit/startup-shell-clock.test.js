/**
 * The loading screen's clock and the photosensitivity warning's handoff to it
 * (src/ui/startup-shell-clock.js, ADR-0021): the ident's minimum and its reveal count from the
 * moment the warning lifts, the warm may begin under the warning, and the warning is traced
 * like any boot milestone while nothing waits for it.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    afterStartupShellReveal,
    markStartupShellShown,
    onPhotosensitivityWarningLift,
    photosensitivityWarning,
    photosensitivityWarningActive,
    resetStartupShellClockForTests,
    startupShellShownAtMs,
    tracePhotosensitivityWarning,
    waitForPhotosensitivityWarning,
    waitForStartupShellSeen,
} from '../../src/ui/startup-shell-clock.js';
import { markStartup, onStartupMark } from '../../src/ui/startup-debug.js';

function fakeWarning({ active = true } = {}) {
    let resolve;
    const dismissed = new Promise((r) => { resolve = r; });
    let isActive = active;
    return {
        shownAtMs: 100,
        dismissed,
        isActive: () => isActive,
        snapshot: () => ({ state: isActive ? 'shown' : 'done' }),
        lift(result = {}) {
            isActive = false;
            resolve({
                reason: 'input', via: 'key', visibleMs: 2500, dismissedAtMs: performance.now(), ...result,
            });
            return dismissed;
        },
    };
}

async function flush() {
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

describe('the loading screen\'s clock', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
        vi.setSystemTime(new Date('2026-10-20T08:00:00Z'));
        vi.stubGlobal('window', {});
        resetStartupShellClockForTests();
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('with no warning on the page the shell is seen from the moment it is marked', async () => {
        expect(photosensitivityWarning()).toBe(null);
        expect(photosensitivityWarningActive()).toBe(false);
        expect(onPhotosensitivityWarningLift(() => {})).toBe(false);
        await expect(waitForPhotosensitivityWarning()).resolves.toBeUndefined();

        const at = markStartupShellShown();
        expect(startupShellShownAtMs()).toBe(at);
        let seen = false;
        waitForStartupShellSeen(4000).then(() => { seen = true; });
        await vi.advanceTimersByTimeAsync(3999);
        expect(seen).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(seen).toBe(true);
    });

    it('resolves at once when the shell has been up long enough, or was never marked', async () => {
        let seen = false;
        waitForStartupShellSeen(4000).then(() => { seen = true; });
        await flush();
        expect(seen).toBe(true);

        markStartupShellShown();
        await vi.advanceTimersByTimeAsync(5000);
        seen = false;
        waitForStartupShellSeen(4000).then(() => { seen = true; });
        await flush();
        expect(seen).toBe(true);
    });

    it('under the warning the clock starts when the warning lifts, and the minimum counts from then', async () => {
        const warning = fakeWarning();
        window.__serenityPhotosensitivityWarning = warning;
        expect(photosensitivityWarningActive()).toBe(true);

        const marked = markStartupShellShown();
        let seen = false;
        waitForStartupShellSeen(4000).then(() => { seen = true; });
        await vi.advanceTimersByTimeAsync(9000);
        expect(seen).toBe(false);
        expect(startupShellShownAtMs()).toBe(marked);

        await warning.lift();
        await flush();
        expect(startupShellShownAtMs()).toBe(performance.now());
        await vi.advanceTimersByTimeAsync(3999);
        expect(seen).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(seen).toBe(true);
    });

    it('the reveal callback waits for the reveal without a warning', async () => {
        markStartupShellShown();
        const lit = vi.fn();
        let done = null;
        afterStartupShellReveal(1650, lit).then((ran) => { done = ran; });
        await vi.advanceTimersByTimeAsync(1649);
        expect(lit).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(lit).toHaveBeenCalledTimes(1);
        expect(done).toBe(true);
    });

    it('under the warning the reveal callback is parked for the lift and the caller is not held', async () => {
        const warning = fakeWarning();
        window.__serenityPhotosensitivityWarning = warning;
        markStartupShellShown();
        const lit = vi.fn();
        let done = null;
        afterStartupShellReveal(1650, lit).then((ran) => { done = ran; });
        await flush();
        expect(done).toBe(false);
        await vi.advanceTimersByTimeAsync(20000);
        expect(lit).not.toHaveBeenCalled();

        await warning.lift();
        await vi.advanceTimersByTimeAsync(1649);
        expect(lit).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(lit).toHaveBeenCalledTimes(1);
    });

    it('traces the warning as a boot milestone and records its outcome', async () => {
        const warning = fakeWarning();
        window.__serenityPhotosensitivityWarning = warning;
        const marks = [];
        const off = onStartupMark((phase, payload) => marks.push({ phase, ...payload }));
        try {
            expect(tracePhotosensitivityWarning()).toBe(true);
            expect(marks[0]).toMatchObject({ phase: 'photosensitivity-warning:observed', state: 'shown', shownAtMs: 100 });
            await warning.lift({ reason: 'auto', via: null, visibleMs: 10000.4 });
            await flush();
            expect(marks.at(-1)).toMatchObject({
                phase: 'photosensitivity-warning:dismissed', reason: 'auto', via: null, visibleMs: 10000,
            });
        } finally {
            off();
        }
        markStartup('noop');
    });

    it('traces nothing when the page has no warning', () => {
        expect(tracePhotosensitivityWarning()).toBe(false);
    });
});

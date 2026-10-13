/**
 * A renderer crash used to leave a blank black window with nothing logged (audit
 * ELEC-09). The main process now reloads once, and asks the player before reloading
 * again within a minute so a crash on load cannot spin in a reload loop.
 */
import { describe, expect, it } from 'vitest';
import {
    RENDERER_CRASH_WINDOW_MS,
    REQUESTED_RELOAD_GRACE_MS,
    decideRendererRecovery,
    isFatalLoadFailure,
} from '../../electron/renderer-recovery.js';

describe('renderer recovery', () => {
    it('ignores a clean exit, which is a normal reload or quit', () => {
        expect(decideRendererRecovery({ reason: 'clean-exit', now: 1000, recentCrashes: [900] }))
            .toEqual({ action: 'ignore', recentCrashes: [900] });
    });

    it('reloads after the first crash, kill or out-of-memory', () => {
        ['crashed', 'killed', 'oom', 'abnormal-exit', 'launch-failed', 'integrity-failure'].forEach((reason) => {
            expect(decideRendererRecovery({ reason, now: 5000 })).toEqual({ action: 'reload', recentCrashes: [5000] });
        });
    });

    it('asks the player after a second crash within a minute instead of reloading in a loop', () => {
        const first = decideRendererRecovery({ reason: 'crashed', now: 10_000 });
        const second = decideRendererRecovery({
            reason: 'crashed', now: 10_000 + RENDERER_CRASH_WINDOW_MS - 1, recentCrashes: first.recentCrashes,
        });
        expect(second.action).toBe('prompt');
        expect(second.recentCrashes).toHaveLength(2);
    });

    it('reloads again once the earlier crash is more than a minute old', () => {
        const decision = decideRendererRecovery({
            reason: 'crashed', now: 10_000 + RENDERER_CRASH_WINDOW_MS, recentCrashes: [10_000],
        });
        expect(decision).toEqual({ action: 'reload', recentCrashes: [10_000 + RENDERER_CRASH_WINDOW_MS] });
    });

    it('leaves alone the kill the player asked for on the "not responding" prompt', () => {
        const decision = decideRendererRecovery({
            reason: 'killed', now: 50_000, recentCrashes: [45_000], reloadRequestedAt: 49_000,
        });
        expect(decision).toEqual({ action: 'ignore', recentCrashes: [45_000] });
    });

    it('treats a crash long after a requested reload as a crash', () => {
        const decision = decideRendererRecovery({
            reason: 'crashed', now: 49_000 + REQUESTED_RELOAD_GRACE_MS, reloadRequestedAt: 49_000,
        });
        expect(decision.action).toBe('reload');
    });

    it('reports only a main-frame load failure, and not an aborted load', () => {
        expect(isFatalLoadFailure({ errorCode: -6, isMainFrame: true })).toBe(true); // ERR_FILE_NOT_FOUND
        expect(isFatalLoadFailure({ errorCode: -2, isMainFrame: true })).toBe(true); // ERR_FAILED
        expect(isFatalLoadFailure({ errorCode: -3, isMainFrame: true })).toBe(false); // ERR_ABORTED
        expect(isFatalLoadFailure({ errorCode: -6, isMainFrame: false })).toBe(false);
    });
});

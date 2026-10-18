/* eslint-disable import/first */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

// The renderer's @utils alias is not configured in the unit-test runtime.
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({
    BoardJuice: class BoardJuice {},
}));
vi.mock('../../src/ui/components/toast.js', () => ({ showToast: vi.fn(() => ({})) }));

import { OdysseyMode } from '../../src/core/game-modes/OdysseyMode.js';
import { noticeOdysseyEntryAbort } from '../../src/ui/odyssey/odyssey-entry-presence.js';
import { noticeOdysseyUnreadableSave } from '../../src/ui/odyssey/odyssey-save-notice.js';
import { showToast } from '../../src/ui/components/toast.js';

/**
 * Audit 2026-10-18: the readiness waits alone could take 6.2 s of a 7.15 s hold, so a slow orb
 * ran the hold out and cut back to the map, with only a console line to say why.
 */
describe('Odyssey entry hold budget', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function createMode(remaining) {
        const mode = Object.create(OdysseyMode.prototype);
        mode.themeRevealToken = 1;
        mode._confirmFirstGameplayComposite = vi.fn(async (ms) => {
            await Promise.resolve(); // the theme wait starts alongside, as in the game
            remaining.ms -= ms; // the frame never comes: the wait runs its full length
            return false;
        });
        mode.transitionManager = { waitForThemeCriticalReady: vi.fn(async () => false) };
        mode._showNeutralThemeFallbackBackdrop = vi.fn();
        mode._scheduleThemeFullReadySettlement = vi.fn();
        return mode;
    }

    it('fits every readiness wait into the hold that is left, then reveals guarded', async () => {
        const remaining = { ms: 1000 };
        const mode = createMode(remaining);
        const level = { id: 7 };

        const ready = await mode._waitForEntryRevealReadiness(level, 1, () => remaining.ms);

        expect(ready).toBe(true); // the orb still plays, over the safe backdrop
        expect(mode._confirmFirstGameplayComposite).toHaveBeenCalledTimes(1);
        expect(mode._confirmFirstGameplayComposite).toHaveBeenCalledWith(750);
        expect(mode.transitionManager.waitForThemeCriticalReady).toHaveBeenCalledWith(level, 750, { settleFade: true });
        expect(mode._showNeutralThemeFallbackBackdrop).toHaveBeenCalledOnce();
        expect(remaining.ms).toBeGreaterThan(0);
    });

    it('keeps the full waits when the hold has room', async () => {
        const mode = createMode({ ms: Infinity });
        await mode._waitForEntryRevealReadiness({ id: 7 }, 1);
        expect(mode._confirmFirstGameplayComposite.mock.calls.map(([ms]) => ms)).toEqual([2600, 2200]);
    });

    // A minimised window draws no frames, so one 6 s readiness miss left the plain fallback
    // backdrop over the theme for the whole orb.
    function createSettlingMode(results) {
        const mode = Object.create(OdysseyMode.prototype);
        mode.themeRevealToken = 1;
        mode.deps = { themeManager: { activeTheme: {} } };
        mode.transitionManager = {
            waitForThemeFullReady: vi.fn(async () => (results.length ? results.shift() : false)),
        };
        mode._clearNeutralThemeFallbackBackdrop = vi.fn();
        return mode;
    }

    it('keeps asking for full readiness until the theme gets there, then lifts the backdrop', async () => {
        const mode = createSettlingMode([false, false, true]);
        await expect(mode._scheduleThemeFullReadySettlement({ id: 7 }, 1, { safePresentation: true }))
            .resolves.toBe(true);
        expect(mode.transitionManager.waitForThemeFullReady).toHaveBeenCalledTimes(3);
        expect(mode._clearNeutralThemeFallbackBackdrop).toHaveBeenCalledOnce();
    });

    it('lifts the backdrop anyway once a minute of asking has not settled it', async () => {
        const mode = createSettlingMode([]);
        await expect(mode._scheduleThemeFullReadySettlement({ id: 7 }, 1)).resolves.toBe(false);
        expect(mode.transitionManager.waitForThemeFullReady).toHaveBeenCalledTimes(10);
        expect(mode._clearNeutralThemeFallbackBackdrop).toHaveBeenCalledOnce();
    });

    it('stops asking once the orb has ended', async () => {
        const mode = createSettlingMode([]);
        mode.transitionManager.waitForThemeFullReady.mockImplementationOnce(async () => {
            mode.themeRevealToken += 1;
            return false;
        });
        await expect(mode._scheduleThemeFullReadySettlement({ id: 7 }, 1)).resolves.toBe(false);
        expect(mode.transitionManager.waitForThemeFullReady).toHaveBeenCalledOnce();
        expect(mode._clearNeutralThemeFallbackBackdrop).not.toHaveBeenCalled();
    });

    it('says why an orb did not open, but not when the player chose to leave', () => {
        expect(noticeOdysseyEntryAbort({ reason: 'blackout-timeout' })).toBe(true);
        expect(noticeOdysseyEntryAbort({ reason: 'blackout-callback-error' })).toBe(true);
        expect(showToast).toHaveBeenCalledTimes(2);
        expect(noticeOdysseyEntryAbort({ reason: 'blackout-callback-rejected' })).toBe(false);
        expect(noticeOdysseyEntryAbort({ reason: 'replaced' })).toBe(false);
        expect(noticeOdysseyEntryAbort(null)).toBe(false);
        expect(showToast).toHaveBeenCalledTimes(2);
    });

    it('says once that a save could not be read', () => {
        showToast.mockClear();
        const state = { unreadableSaveKey: 'serenityBlocks_odysseyProgress.unreadable-x' };
        expect(noticeOdysseyUnreadableSave(state)).toBe(true);
        expect(noticeOdysseyUnreadableSave(state)).toBe(false);
        expect(noticeOdysseyUnreadableSave({})).toBe(false);
        expect(showToast).toHaveBeenCalledOnce();
    });
});

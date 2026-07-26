/* eslint-disable import/first */
// Pins the rank-4 reveal-latency fixes (audit OD-07 + OD-08): the Odyssey startup
// path must not floor the overlay at the 2000ms global minimum, and must not await
// the camera-travel animation under the overlay before revealing the board.

import {
    afterEach, describe, expect, it, vi,
} from 'vitest';

// OdysseyMode pulls in the Phaser board juice at import time — stub it like the
// sibling OdysseyMode tests do so the module loads in the node test env.
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({
    BoardJuice: class BoardJuice { destroy() {} },
}));

// Replace the overlay module so we can assert HOW the wrapper calls dismiss.
vi.mock('../../src/ui/cinematic-loading-overlay.js', () => ({
    showCinematicLoadingOverlay: vi.fn(),
    dismissCinematicLoadingOverlay: vi.fn(() => Promise.resolve()),
    transitionCinematicLoadingOverlayToCountdown: vi.fn(),
    setCinematicLoadingOverlayBuilding: vi.fn(),
}));

import { OdysseyMode } from '../../src/core/game-modes/OdysseyMode.js';
import { dismissCinematicLoadingOverlay } from '../../src/ui/cinematic-loading-overlay.js';

afterEach(() => {
    vi.clearAllMocks();
});

describe('OD-07: overlay dismiss does not double-impose the 2000ms floor', () => {
    it('uses the options form (the number 800 would silently reset minVisibleMs to 2000)', () => {
        OdysseyMode.prototype._dismissCinematicLoadingOverlay.call({}, { minVisibleMs: 0 });
        expect(dismissCinematicLoadingOverlay).toHaveBeenCalledTimes(1);
        const arg = dismissCinematicLoadingOverlay.mock.calls[0][0];
        expect(typeof arg).toBe('object');
        expect(arg).toEqual({ fadeOutMs: 800, minVisibleMs: 0 });
    });

    it('parked re-entry (minVisibleMs 0) is threaded straight through', () => {
        OdysseyMode.prototype._dismissCinematicLoadingOverlay.call({}, { minVisibleMs: 0 });
        expect(dismissCinematicLoadingOverlay.mock.calls[0][0].minVisibleMs).toBe(0);
    });

    it('defaults minVisibleMs to 800 when called with no args (the error/exit path at :398)', () => {
        OdysseyMode.prototype._dismissCinematicLoadingOverlay.call({});
        expect(dismissCinematicLoadingOverlay).toHaveBeenCalledWith({ fadeOutMs: 800, minVisibleMs: 800 });
    });
});

describe('OD-08: startup launch-focus does not await the camera-travel animation', () => {
    const fakeMode = (boardController) => ({ boardController, _updateLevelPreview: vi.fn() });

    it('settle:false calls focusOnLevel (fire-and-forget) and never awaits travelToLevel', async () => {
        let travelStarted = false;
        const boardController = {
            focusOnLevel: vi.fn(),
            // If the focus path awaited this, the await below would hang ~forever.
            travelToLevel: vi.fn(() => new Promise(() => { travelStarted = true; })),
        };
        const mode = fakeMode(boardController);

        await OdysseyMode.prototype._focusBoardLevelForLaunch.call(
            mode, 7, { settle: false, updatePreview: true },
        );

        expect(boardController.focusOnLevel).toHaveBeenCalledWith(7);
        expect(boardController.travelToLevel).not.toHaveBeenCalled();
        expect(travelStarted).toBe(false);
        expect(mode.selectedLevelId).toBe(7);
        expect(mode._updateLevelPreview).toHaveBeenCalledWith(7);
    });

    it('settle:true still awaits travelToLevel so interactive navigation is unchanged', async () => {
        const boardController = {
            focusOnLevel: vi.fn(),
            travelToLevel: vi.fn(() => Promise.resolve()),
        };
        const mode = fakeMode(boardController);

        await OdysseyMode.prototype._focusBoardLevelForLaunch.call(
            mode, 3, { settle: true, updatePreview: false },
        );

        expect(boardController.travelToLevel).toHaveBeenCalledWith(3);
        expect(boardController.focusOnLevel).not.toHaveBeenCalled();
    });
});

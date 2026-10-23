/* eslint-disable import/first */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';

// BoardJuice's renderer alias is outside the Vitest resolver; this path never constructs it.
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({ BoardJuice: class BoardJuice {} }));
import { OdysseyMode } from '../../src/core/game-modes/OdysseyMode.js';

/** Just what _revealOdysseyBoard touches, with the board paused by an entry's blackout. */
function revealingMode({ parked }) {
    return {
        _cancelBoardParkTimer: vi.fn(),
        _perfMark: vi.fn(),
        _perfMeasure: vi.fn(),
        _logBoardMemory: vi.fn(),
        _createBoardInfoOverlay: vi.fn(),
        _lockOdysseyBoardForLaunch: vi.fn(),
        _setBoardOverlaySuppressed: vi.fn(),
        _resolveWarpPreinitMode: () => 'off',
        _boardParked: parked,
        deps: {},
        boardController: { resumeRendering: vi.fn() },
    };
}

describe('revealing the Odyssey map', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('resumes a board the entry paused even when the park timer has not fired yet', () => {
        // The entry pauses the board at its blackout and parks it only 1.2 s after GO: Back to
        // map inside that window revealed a frozen map with no music and a dead wheel.
        vi.stubGlobal('document', { getElementById: () => null });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const mode = revealingMode({ parked: false });
        OdysseyMode.prototype._revealOdysseyBoard.call(mode);
        expect(mode.boardController.resumeRendering).toHaveBeenCalledTimes(1);
        expect(mode._boardParked).toBe(false);
    });

    it('still resumes and unparks a parked board', () => {
        vi.stubGlobal('document', { getElementById: () => null });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const mode = revealingMode({ parked: true });
        OdysseyMode.prototype._revealOdysseyBoard.call(mode);
        expect(mode.boardController.resumeRendering).toHaveBeenCalledTimes(1);
        expect(mode._boardParked).toBe(false);
        expect(mode._logBoardMemory).toHaveBeenCalledWith('board-resumed');
    });
});

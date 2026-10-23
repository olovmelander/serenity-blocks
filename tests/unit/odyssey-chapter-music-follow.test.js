import {
    describe, expect, it, vi,
} from 'vitest';
import { OdysseyBoardController } from '../../src/rendering/odyssey/OdysseyBoardController.js';

/** A board that records which chapter's music it asked for (no sound manager, no scene). */
function musicBoard({ playing = 4, direction = 1, activeChapter = playing } = {}) {
    const board = Object.create(OdysseyBoardController.prototype);
    Object.assign(board, {
        _odysseyMusicChapter: playing,
        activeSeamBoundaryId: null,
        seamMusicBoundaryId: null,
        environmentManager: { currentChapter: activeChapter },
        _resolveTravelDirection: () => direction,
        _playThresholdStinger: vi.fn(),
        _applyChapterMusic: vi.fn(function apply(chapterId) {
            this._odysseyMusicChapter = chapterId;
            return true;
        }),
    });
    return board;
}

const seam34 = (inSeam = true) => ({
    inSeam,
    boundaryId: inSeam ? '3-4' : null,
    sourceChapter: 3,
    targetChapter: 4,
    boundaryPosition: 0.35,
    transition: { fxPreset: 'soft', beatDurationMs: 800, crossfadeDurationMs: 3000 },
});

describe('Odyssey chapter music follows the chapter the camera is in', () => {
    it('bridges to the chapter it is heading into, backwards too', () => {
        // Audit 2026-10-23: the bridge always went to the seam's far side, so scrolling from
        // chapter 4 back into 3 kept chapter 4's track playing.
        const board = musicBoard({ playing: 4, direction: -1 });
        board._handleChapterSeam(0.36, seam34());
        expect(board._applyChapterMusic).toHaveBeenCalledTimes(1);
        expect(board._applyChapterMusic.mock.calls[0][0]).toBe(3);
    });

    it('switches back when a seam is left on the side it was entered from', () => {
        const board = musicBoard({ playing: 3, direction: 1, activeChapter: 3 });
        board._handleChapterSeam(0.34, seam34());
        expect(board._odysseyMusicChapter).toBe(4);
        board._handleChapterSeam(0.33, seam34(false));
        expect(board._odysseyMusicChapter).toBe(3);
    });

    it('changes on a chapter change without any seam (a cut), and never before the board has music', () => {
        const board = musicBoard({ playing: 2 });
        expect(board._syncChapterMusic(5)).toBe(true);
        expect(board._odysseyMusicChapter).toBe(5);
        expect(board._syncChapterMusic(5)).toBe(false);
        const booting = musicBoard();
        booting._odysseyMusicChapter = undefined;
        expect(booting._syncChapterMusic(3)).toBe(false);
        expect(booting._applyChapterMusic).not.toHaveBeenCalled();
    });
});

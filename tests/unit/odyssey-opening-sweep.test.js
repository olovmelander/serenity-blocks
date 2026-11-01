/* eslint-disable import/first */
// THE OPENING SWEEP (owner, 2026-11-01: "when Odyssey Mode starts, it should always begin at the
// start of the path in Chapter 1, and then pan a bit faster to the current unfinished orb"). The
// map opens at orb 1, built around chapter 1, holds there until every chapter on the way is ready,
// then flies to the orb to play next (the frontier orb of odyssey-frontier-reveal.test.js) with the
// music of that orb's chapter and no seam stingers. A scroll or an orb choice ends it.

import {
    afterEach, describe, expect, it, vi,
} from 'vitest';

vi.mock('../../src/rendering/phaser/board-juice.js', () => ({
    BoardJuice: class BoardJuice { destroy() {} },
}));
vi.mock('../../src/ui/cinematic-loading-overlay.js', () => ({
    showCinematicLoadingOverlay: vi.fn(),
    dismissCinematicLoadingOverlay: vi.fn(() => Promise.resolve()),
    waitForCinematicLoadingOverlayPresented: vi.fn(() => Promise.resolve()),
    transitionCinematicLoadingOverlayToCountdown: vi.fn(),
    setCinematicLoadingOverlayBuilding: vi.fn(),
    setCinematicLoadingProgress: vi.fn(),
}));

import { OdysseyMode } from '../../src/core/game-modes/OdysseyMode.js';
import {
    OPENING_SWEEP, OdysseyBoardController, computeOpeningSweepDuration,
} from '../../src/rendering/odyssey/OdysseyBoardController.js';
import { resolveOrbParkProgress } from '../../src/rendering/odyssey/odyssey-chapter-arrival.js';
import { plungeTravelExtraMs } from '../../src/rendering/odyssey/transitions/odyssey-black-hole-fall.js';
import { getLevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';

const registry = getLevelRegistry();
const layout = registry.getPresentationLayout();
const CP = layout.chapterPositions;

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function fakeMode({ reducedMotion = false } = {}) {
    return {
        deps: { settingsManager: { get: () => ({ reducedMotion }) } },
        odysseyState: { currentLevel: 35, currentChapter: registry.getLevel(35).chapter },
        levelRegistry: registry,
        _chapterOfLevel: OdysseyMode.prototype._chapterOfLevel,
    };
}

describe('when the mode sweeps from orb 1', () => {
    it('sweeps to the orb the map opens on', () => {
        expect(OdysseyMode.prototype._resolveOpeningSweepLevelId.call(fakeMode(), 35)).toBe(35);
    });

    it('opens framed on it at once for orb 1, no orb, reduced motion or ?odysseyOpeningSweep=0', () => {
        expect(OdysseyMode.prototype._resolveOpeningSweepLevelId.call(fakeMode(), 1)).toBeNull();
        expect(OdysseyMode.prototype._resolveOpeningSweepLevelId.call(fakeMode(), null)).toBeNull();
        expect(OdysseyMode.prototype._resolveOpeningSweepLevelId.call(fakeMode({ reducedMotion: true }), 35))
            .toBeNull();
        vi.stubGlobal('location', { search: '?odysseyOpeningSweep=0' });
        expect(OdysseyMode.prototype._resolveOpeningSweepLevelId.call(fakeMode(), 35)).toBeNull();
    });

    it('builds chapter 1 and its neighbour before the reveal, whatever the save', () => {
        expect(OdysseyMode.prototype._computeEagerStartupChapters.call(fakeMode(), 35, 1)).toEqual([1, 2]);
    });
});

describe('the sweep\'s flight time', () => {
    it('grows with the distance, from a little over a click\'s glide', () => {
        const near = computeOpeningSweepDuration(0, 0.2, CP);
        const far = computeOpeningSweepDuration(0, 0.8, CP);
        expect(near).toBe(Math.round(OPENING_SWEEP.baseMs + (0.2 * OPENING_SWEEP.perProgressMs)));
        expect(far).toBeGreaterThan(near);
        expect(far).toBeLessThan(6000);
    });

    it("adds the plunge's own time exactly as a click's glide does", () => {
        [[0, 0.99], [0.95, 0.965]].forEach(([from, to]) => {
            const plain = OPENING_SWEEP.baseMs + ((to - from) * OPENING_SWEEP.perProgressMs);
            expect(computeOpeningSweepDuration(from, to, CP)).toBe(Math.round(plain + plungeTravelExtraMs(from, to, CP)));
        });
    });
});

/** A board for the sweep: chapters 2-5 drawn by the One World, 6-8 with environments. */
function sweepBoard({ ready = true, levelId = 57 } = {}) {
    const board = Object.create(OdysseyBoardController.prototype);
    const level = registry.getLevel(levelId);
    const env = () => ({ prewarmed: ready, _renderWarmed: ready });
    Object.assign(board, {
        isActive: true,
        _disposed: false,
        selectionSequence: 0,
        presentationLayout: layout,
        oneWorld: { group: {} },
        _oneWorldCompiled: true,
        cameraController: {
            getCurrentPosition: () => 0,
            travelModel: { lastInputAt: 0 },
        },
        nodeManager: { nodes: new Map([[levelId, { config: { chapter: level.chapter }, pathPosition: level.pathPosition }]]) },
        environmentManager: {
            getBlendState: () => ({ activeChapter: 1 }),
            suppressedChapters: new Set([2, 3, 4, 5]),
            environments: new Map([[6, env()], [7, env()], [8, env()]]),
        },
        _requestGlideChapters: vi.fn(() => Promise.resolve(true)),
        _queueChapterPrewarm: vi.fn(),
        _syncChapterMusic: vi.fn(),
        travelToLevel: vi.fn(() => Promise.resolve(true)),
    });
    return { board, level };
}

describe('the board holds at orb 1 until the way is ready, then flies', () => {
    it('knows each chapter on the way: world, warm or not yet', () => {
        const { board } = sweepBoard();
        board.environmentManager.environments.get(7)._renderWarmed = false;
        expect(board._openingSweepPathReady(1, 8)).toBe(false);
        expect(board._openingSweepPathStates(1, 8)).toEqual({
            2: 'world', 3: 'world', 4: 'world', 5: 'world', 6: 'warm', 7: 'compiled', 8: 'warm',
        });
        board.environmentManager.environments.get(7)._renderWarmed = true;
        expect(board._openingSweepPathReady(1, 8)).toBe(true);
        board._oneWorldCompiled = false;
        expect(board._openingSweepPathReady(1, 8)).toBe(false);
        board.environmentManager.environments.delete(8);
        expect(board._openingSweepPathStates(1, 8)[8]).toBe('missing');
    });

    it('holds at least its minimum, then flies the sweep\'s time to the orb', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
        const { board, level } = sweepBoard();
        const done = board.playOpeningSweep(57);
        expect(board._openingSweepActive).toBe(true);
        await vi.advanceTimersByTimeAsync(OPENING_SWEEP.minHoldMs - 200);
        expect(board.travelToLevel).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(400);
        await expect(done).resolves.toBe(true);
        const target = resolveOrbParkProgress(level.chapter, level.pathPosition, CP);
        expect(board.travelToLevel).toHaveBeenCalledWith(57, expect.objectContaining({
            travelDuration: computeOpeningSweepDuration(0, target, CP),
        }));
        expect(board._requestGlideChapters).toHaveBeenCalledWith(1, level.chapter);
        expect(board._openingSweepActive).toBe(false);
    });

    it('waits for a chapter still compiling, and never longer than its cap', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
        const { board } = sweepBoard({ ready: false });
        const done = board.playOpeningSweep(57);
        await vi.advanceTimersByTimeAsync(OPENING_SWEEP.minHoldMs + 1000);
        expect(board.travelToLevel).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(OPENING_SWEEP.maxHoldMs);
        await expect(done).resolves.toBe(true);
        expect(board.travelToLevel).toHaveBeenCalledTimes(1);
    });

    it('ends at once when the player scrolls or picks an orb while it holds', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
        const scrolled = sweepBoard({ ready: false }).board;
        const first = scrolled.playOpeningSweep(57);
        await vi.advanceTimersByTimeAsync(300);
        scrolled.cameraController.travelModel.lastInputAt = 123;
        await vi.advanceTimersByTimeAsync(200);
        await expect(first).resolves.toBe(false);
        expect(scrolled.travelToLevel).not.toHaveBeenCalled();
        expect(scrolled._openingSweepActive).toBe(false);

        const picked = sweepBoard({ ready: false }).board;
        const second = picked.playOpeningSweep(57);
        await vi.advanceTimersByTimeAsync(300);
        picked.selectionSequence += 1;
        await vi.advanceTimersByTimeAsync(200);
        await expect(second).resolves.toBe(false);
        expect(picked.travelToLevel).not.toHaveBeenCalled();
    });

    it('keeps the music and quiets the seams while it runs', () => {
        const board = Object.create(OdysseyBoardController.prototype);
        board._odysseyMusicChapter = 6;
        board._openingSweepActive = true;
        board._applyChapterMusic = vi.fn(() => true);
        board.soundManager = { playOdysseyStinger: vi.fn() };
        expect(board._syncChapterMusic(3)).toBe(false);
        expect(board._startChapterMusicBridge(3, {}, '2-3')).toBe(false);
        board._playThresholdStinger('2-3', 1);
        expect(board.soundManager.playOdysseyStinger).not.toHaveBeenCalled();
        expect(board._applyChapterMusic).not.toHaveBeenCalled();
    });
});

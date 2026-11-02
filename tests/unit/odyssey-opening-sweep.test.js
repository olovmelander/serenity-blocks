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
    odysseyOpeningBoardOptions, prepareOdysseyOpening, resolveOdysseyOpeningSweep, startOdysseyOpeningSweep,
} from '../../src/ui/odyssey/odyssey-opening-sweep.js';
import {
    OPENING_SWEEP, OdysseyBoardController, computeOpeningSweepDuration, pacedSweepDistance,
} from '../../src/rendering/odyssey/OdysseyBoardController.js';
import {
    OdysseyCameraController, invertSweepPacing, sweepTravelEase,
} from '../../src/rendering/odyssey/OdysseyCameraController.js';
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
        _computeEagerStartupChapters: OdysseyMode.prototype._computeEagerStartupChapters,
    };
}

describe('when the mode sweeps from orb 1', () => {
    it('sweeps to the orb the map opens on', () => {
        expect(resolveOdysseyOpeningSweep(fakeMode(), 35)).toBe(35);
    });

    it('opens framed on it at once for orb 1, no orb, reduced motion or ?odysseyOpeningSweep=0', () => {
        expect(resolveOdysseyOpeningSweep(fakeMode(), 1)).toBeNull();
        expect(resolveOdysseyOpeningSweep(fakeMode(), null)).toBeNull();
        expect(resolveOdysseyOpeningSweep(fakeMode({ reducedMotion: true }), 35)).toBeNull();
        vi.stubGlobal('location', { search: '?odysseyOpeningSweep=0' });
        expect(resolveOdysseyOpeningSweep(fakeMode(), 35)).toBeNull();
    });

    it('opens with nothing selected while it sweeps, framed on the orb otherwise', () => {
        const sweeping = fakeMode();
        expect(prepareOdysseyOpening(sweeping, 35)).toEqual({ focusLevelId: null });
        expect(sweeping.selectedLevelId).toBeNull();
        expect(sweeping._openingSweepTo).toBe(35);
        const still = fakeMode({ reducedMotion: true });
        expect(prepareOdysseyOpening(still, 35)).toEqual({ focusLevelId: 35, seatOnFocus: true });
        expect(still.selectedLevelId).toBe(35);
        expect(still._openingSweepTo).toBeNull();
        expect(prepareOdysseyOpening(fakeMode(), null)).toEqual({});
    });

    it("builds the board at orb 1 around chapter 1, with the sweep orb's music", () => {
        const mode = fakeMode();
        prepareOdysseyOpening(mode, 35);
        expect(odysseyOpeningBoardOptions(mode)).toEqual({
            startupChapters: [1, 2], focusChapter: 1, revealLevelId: null, musicChapter: registry.getLevel(35).chapter,
        });
        expect(odysseyOpeningBoardOptions(fakeMode())).toEqual({});
    });

    it('asks the board to sweep once, and selects the orb when it arrives', async () => {
        const mode = fakeMode();
        prepareOdysseyOpening(mode, 35);
        let arrive;
        mode.boardController = { playOpeningSweep: vi.fn(() => new Promise((resolve) => { arrive = resolve; })) };
        Object.assign(mode, { isActive: true, isInBoardView: true, isEnteringLevel: false });
        startOdysseyOpeningSweep(mode);
        startOdysseyOpeningSweep(mode);
        expect(mode.boardController.playOpeningSweep).toHaveBeenCalledTimes(1);
        expect(mode.boardController.playOpeningSweep).toHaveBeenCalledWith(35, expect.any(Object));
        arrive(true);
        await Promise.resolve();
        await Promise.resolve();
        expect(mode.selectedLevelId).toBe(35);
    });
});

describe('the sweep\'s flight time and pace', () => {
    it('grows with the distance, weighing each stretch by the wheel\'s pace', () => {
        const near = computeOpeningSweepDuration(0, 0.2, CP);
        const far = computeOpeningSweepDuration(0, 0.8, CP);
        expect(near).toBe(Math.round(OPENING_SWEEP.baseMs + (pacedSweepDistance(0, 0.2, CP) * OPENING_SWEEP.perPacedMs)));
        expect(far).toBeGreaterThan(near);
        // Slower than it was (1.5 s + 4.6 s per journey: 5.2 s to 0.8), still under a quarter minute.
        expect(far).toBeGreaterThan(8500);
        expect(far).toBeLessThan(14000);
        // The climb into space, where the wheel slows, weighs more than its length.
        const cp = CP;
        expect(pacedSweepDistance(cp[4], cp[5], cp)).toBeGreaterThan((cp[5] - cp[4]) * 1.05);
        expect(pacedSweepDistance(0, cp[1], cp)).toBeCloseTo(cp[1], 6);
    });

    it("adds the plunge's own time exactly as a click's glide does", () => {
        [[0, 0.99], [0.95, 0.965]].forEach(([from, to]) => {
            const plain = OPENING_SWEEP.baseMs + (pacedSweepDistance(from, to, CP) * OPENING_SWEEP.perPacedMs);
            expect(computeOpeningSweepDuration(from, to, CP)).toBe(Math.round(plain + plungeTravelExtraMs(from, to, CP)));
        });
    });

    it('cruises instead of rushing its middle: a smooth start, a steady top speed, a smooth stop', () => {
        expect(sweepTravelEase(0)).toBe(0);
        expect(sweepTravelEase(1)).toBeCloseTo(1, 9);
        let top = 0;
        let previous = 0;
        for (let i = 1; i <= 1000; i += 1) {
            const value = sweepTravelEase(i / 1000);
            expect(value).toBeGreaterThanOrEqual(previous - 1e-12);
            top = Math.max(top, (value - previous) * 1000);
            previous = value;
        }
        // A click's cubic peaks at 3x its average; the sweep under 1.4x.
        expect(top).toBeLessThan(1.4);
        expect(top).toBeGreaterThan(1.2);
        // Starts and stops gently.
        expect(sweepTravelEase(0.02)).toBeLessThan(0.002);
        expect(1 - sweepTravelEase(0.98)).toBeLessThan(0.002);
    });

    it('gives the short early chapters a fair share of the flight, not just their length', () => {
        const table = OdysseyCameraController.prototype._buildSweepPacing.call(
            { chapterPositions: CP },
            { startPosition: 0, endPosition: 0.8, plunge: null },
        );
        const shareAt = (p) => table[Math.round((p / 0.8) * (table.length - 1))];
        // Chapter 2 (the ocean) is under a tenth of the way; by length alone it got that share.
        const ocean = shareAt(CP[2]) - shareAt(CP[1]);
        expect(ocean).toBeGreaterThan(((CP[2] - CP[1]) / 0.8) * 1.25);
        // ...and chapter 5's long climb no longer takes half the flight.
        expect(shareAt(CP[5]) - shareAt(CP[4])).toBeLessThan(0.45);
        expect(table[table.length - 1]).toBeCloseTo(1, 6);
    });

    it('inverts its pacing table exactly', () => {
        const table = new Float32Array([0, 0.1, 0.5, 0.6, 1]);
        expect(invertSweepPacing(table, 0)).toBe(0);
        expect(invertSweepPacing(table, 1)).toBe(1);
        expect(invertSweepPacing(table, 0.3)).toBeCloseTo(0.375, 6);
        expect(invertSweepPacing(table, 0.6)).toBeCloseTo(0.75, 6);
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
        // Compiled before the reveal: its timing landed.
        board._compileTimings = { 'one-world': 412 };
        expect(board._openingSweepPathReady(1, 8)).toBe(true);
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

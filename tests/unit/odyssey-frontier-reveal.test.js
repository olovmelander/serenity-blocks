/* eslint-disable import/first */
// The map opens on the next orb to play (owner, 2026-10-28: "the frontier orb! So always the orb
// that we are going to play to continue the journey"), and everything built before the reveal
// is built around it. It used to open at orb 1 while the eager chapter window, the warm-up and
// the opening music followed the frontier's chapter, so a save past chapter 2 revealed a
// chapter 1 nobody had built (then built it, the heaviest chapter, on the live map), and marked
// its frontier chapters "render-warmed" from a sample that never drew them.

import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three';

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
import { OdysseyBoardController } from '../../src/rendering/odyssey/OdysseyBoardController.js';
import { ChapterEnvironmentManager, pickNearestChapter } from '../../src/rendering/odyssey/ChapterEnvironmentManager.js';
import { resolveOrbParkProgress } from '../../src/rendering/odyssey/odyssey-chapter-arrival.js';
import { getLevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';

const registry = getLevelRegistry();
const layout = registry.getPresentationLayout();
const CP = layout.chapterPositions;
const LEVELS = registry.getAllLevelPresentations();
const levelOf = (id) => LEVELS.find((level) => level.id === id);

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

function fakeMode({
    currentLevel = 35, unlocked = () => true, fresh = false, seen = true,
} = {}) {
    return {
        odysseyState: {
            currentLevel,
            currentChapter: registry.getLevel(currentLevel)?.chapter ?? 1,
            isLevelUnlocked: unlocked,
            isFreshJourney: () => fresh,
            hasSeenArrival: () => seen,
        },
        levelRegistry: registry,
        _chapterOfLevel: OdysseyMode.prototype._chapterOfLevel,
    };
}

describe('the mode opens the map on the next orb to play', () => {
    it('reveals the frontier orb of a journey under way', () => {
        const mode = fakeMode({ currentLevel: 35 });
        expect(OdysseyMode.prototype._resolveRevealLevelId.call(mode)).toBe(35);
    });

    it('leaves a journey the first arrival will welcome to that welcome', () => {
        const mode = fakeMode({ currentLevel: 1, fresh: true, seen: false });
        expect(OdysseyMode.prototype._resolveRevealLevelId.call(mode)).toBeNull();
    });

    it('frames orb 1 once the welcome has been seen', () => {
        const mode = fakeMode({ currentLevel: 1, fresh: true, seen: true });
        expect(OdysseyMode.prototype._resolveRevealLevelId.call(mode)).toBe(1);
    });

    it('falls back to orb 1 for a frontier it cannot place', () => {
        expect(OdysseyMode.prototype._resolveRevealLevelId.call(fakeMode({ currentLevel: 999 }))).toBe(1);
        expect(OdysseyMode.prototype._resolveRevealLevelId.call(
            fakeMode({ currentLevel: 35, unlocked: () => false }),
        )).toBe(1);
    });

    it('builds the reveal orb\'s chapter and its neighbours before the reveal', () => {
        const mode = fakeMode({ currentLevel: 1 });
        const chapter = registry.getLevel(35).chapter;
        expect(OdysseyMode.prototype._computeEagerStartupChapters.call(mode, 35))
            .toEqual([chapter - 1, chapter, chapter + 1]);
        // Without a reveal orb (a rebuild on return) the window follows the save, as before.
        expect(OdysseyMode.prototype._computeEagerStartupChapters.call(mode)).toEqual([1, 2]);
    });

    it('shows a seated orb\'s panel without sending the camera there again', async () => {
        const mode = {
            boardController: { isSeatedOn: vi.fn(() => true), focusOnLevel: vi.fn(), travelToLevel: vi.fn() },
            _updateLevelPreview: vi.fn(),
            _focusBoardLevelForLaunch: vi.fn(),
        };
        await OdysseyMode.prototype._presentFocusLevel.call(mode, 35, { seatOnFocus: true });
        expect(mode.selectedLevelId).toBe(35);
        expect(mode._updateLevelPreview).toHaveBeenCalledWith(35);
        expect(mode._focusBoardLevelForLaunch).not.toHaveBeenCalled();
    });

    it('still focuses the orb when the board was not built framed on it', async () => {
        const mode = {
            boardController: { isSeatedOn: vi.fn(() => false) },
            _focusBoardLevelForLaunch: vi.fn(() => Promise.resolve(true)),
        };
        await OdysseyMode.prototype._presentFocusLevel.call(mode, 35, { seatOnFocus: true });
        expect(mode._focusBoardLevelForLaunch).toHaveBeenCalledWith(35, { updatePreview: true, settle: false });

        // A return (no seat asked for) always goes through the ordinary focus.
        mode.boardController.isSeatedOn.mockReturnValue(true);
        await OdysseyMode.prototype._presentFocusLevel.call(mode, 35);
        expect(mode._focusBoardLevelForLaunch).toHaveBeenCalledTimes(2);
    });
});

function seatedBoard(levelId = 35) {
    const board = Object.create(OdysseyBoardController.prototype);
    const nodePosition = new THREE.Vector3(10, 20, 30);
    const camera = {
        mode: 'follow',
        isAnimating: false,
        settleAt: vi.fn(),
        focusOnNode: vi.fn(function focus() { this.mode = 'focus'; return Promise.resolve(true); }),
        getSceneUp: () => new THREE.Vector3(0, 1, 0),
        getCurrentPosition: () => 0,
    };
    Object.assign(board, {
        revealLevelId: levelId,
        selectedLevelId: null,
        levelData: LEVELS,
        presentationLayout: layout,
        cameraController: camera,
        nodeManager: { getNodePosition: vi.fn(() => nodePosition), setNodeSelected: vi.fn() },
        director: { update: vi.fn(() => ({ camera: { fovBase: 52, followDistance: 30 } })) },
        environmentManager: { getBlendState: vi.fn(() => ({ activeChapter: 6 })) },
        _revealSeatLevelId: null,
        selectionSequence: 0,
    });
    return { board, camera, nodePosition };
}

describe('the board opens framed on the reveal orb', () => {
    it('parks where an ordinary selection of that orb parks', () => {
        const { board } = seatedBoard(35);
        const level = levelOf(35);
        const seat = board._resolveRevealSeat();
        expect(seat).toEqual({
            levelId: 35,
            chapter: level.chapter,
            levelProgress: level.pathPosition,
            parkProgress: resolveOrbParkProgress(level.chapter, level.pathPosition, CP),
        });
    });

    it('has no seat without a reveal orb or for one the layout cannot place', () => {
        const { board } = seatedBoard(null);
        expect(board._resolveRevealSeat()).toBeNull();
        board.revealLevelId = 999;
        expect(board._resolveRevealSeat()).toBeNull();
    });

    it('settles the camera on the director\'s lens there, then frames the orb in one step', () => {
        const { board, camera, nodePosition } = seatedBoard(35);
        const seat = board._resolveRevealSeat();
        expect(board._seatRevealOrb(seat)).toBe(true);

        expect(board.director.update).toHaveBeenCalledWith(0, expect.objectContaining({
            ascentProgress: seat.parkProgress,
        }));
        expect(camera.settleAt).toHaveBeenCalledWith(seat.parkProgress, { camera: { fovBase: 52, followDistance: 30 } });
        expect(camera.focusOnNode).toHaveBeenCalledWith(nodePosition, 0, expect.any(Object));
        expect(camera.settleAt.mock.invocationCallOrder[0])
            .toBeLessThan(camera.focusOnNode.mock.invocationCallOrder[0]);
        expect(board.selectedLevelId).toBe(35);
        expect(board.nodeManager.setNodeSelected).toHaveBeenCalledWith(35, true);
        expect(board.isSeatedOn(35)).toBe(true);
        expect(board.isSeatedOn(34)).toBe(false);
    });

    it('stops counting as seated once anything moves the camera', () => {
        const { board, camera } = seatedBoard(35);
        board._seatRevealOrb(board._resolveRevealSeat());
        camera.isAnimating = true;
        expect(board.isSeatedOn(35)).toBe(false);
        camera.isAnimating = false;
        camera.mode = 'follow'; // a scroll leaves the close-up
        expect(board.isSeatedOn(35)).toBe(false);

        camera.mode = 'focus';
        expect(board.isSeatedOn(35)).toBe(true);
        board.cancelTravel = OdysseyBoardController.prototype.cancelTravel;
        camera.setFollowMode = vi.fn();
        camera.travelModel = { velocity: 1, inputVelocity: 1 };
        board.cancelTravel();
        expect(board.isSeatedOn(35)).toBe(false);
    });

    it('does not frame an orb that has no node', () => {
        const { board, camera } = seatedBoard(35);
        board.nodeManager.getNodePosition.mockReturnValue(null);
        expect(board._seatRevealOrb(board._resolveRevealSeat())).toBe(false);
        expect(camera.focusOnNode).not.toHaveBeenCalled();
        expect(board.isSeatedOn(35)).toBe(false);
    });
});

describe('what the reveal shows decides what is compiled before it', () => {
    function worldBoard(progress) {
        const board = Object.create(OdysseyBoardController.prototype);
        Object.assign(board, {
            oneWorld: { group: new THREE.Group() },
            presentationLayout: layout,
            cameraController: { getCurrentPosition: () => progress },
        });
        return board;
    }

    it('keeps the world in the barrier when the map opens inside Act II', () => {
        expect(worldBoard((CP[2] + CP[3]) / 2)._revealShowsWorld()).toBe(true);
    });

    it('defers it, as before, when the map opens in chapter 1 or in space', () => {
        expect(worldBoard(0)._revealShowsWorld()).toBe(false);
        expect(worldBoard((CP[6] + CP[7]) / 2)._revealShowsWorld()).toBe(false);
        const noWorld = worldBoard((CP[2] + CP[3]) / 2);
        noWorld.oneWorld = null;
        expect(noWorld._revealShowsWorld()).toBe(false);
    });
});

describe('only the chapters the warm-up drew count as warm', () => {
    function warmBoard({ drawsFocus }) {
        const board = Object.create(OdysseyBoardController.prototype);
        const chapter6 = { group: { visible: false }, _renderWarmed: false };
        const chapter7 = { group: { visible: false }, _renderWarmed: false };
        Object.assign(board, {
            cameraController: { currentPosition: 0, targetPosition: 0 },
            _isWarmingUp: false,
            _skipPreRevealWarmup: false,
            warmupMode: 'current',
            _fastStart: true,
            _motionWarm: false,
            focusChapter: 6,
            restrictStartupChapterLoading: false,
            _activeStartupChapterIds: [5, 6, 7],
            presentationLayout: layout,
            environmentManager: {
                environments: new Map([[6, chapter6], [7, chapter7]]),
                updateVisibility: vi.fn(),
            },
            postProcessingStack: { warmOutputVariants: vi.fn(() => Promise.resolve()) },
            _yieldToMain: vi.fn(() => Promise.resolve()),
            soundManager: null,
            time: 0,
            renderFrame: vi.fn(() => {
                chapter6.group.visible = drawsFocus;
            }),
        });
        return { board, chapter6, chapter7 };
    }

    it('marks the focus chapter warm when its sample drew it', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const { board, chapter6, chapter7 } = warmBoard({ drawsFocus: true });
        await board._warmUpJourney();
        expect(chapter6._renderWarmed).toBe(true);
        expect(chapter7._renderWarmed).toBe(false); // not the focus chapter: the sweep warms it
    });

    it('leaves a focus chapter the sample never drew to the background warm', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const { board, chapter6 } = warmBoard({ drawsFocus: false });
        await board._warmUpJourney();
        expect(chapter6._renderWarmed).toBe(false);
    });
});

describe('background work is ordered around where the player is', () => {
    it('picks the nearest chapter, ahead on a tie, and the first without a focus', () => {
        expect(pickNearestChapter([1, 8], 6)).toBe(8);
        expect(pickNearestChapter([5, 7], 6)).toBe(7);
        expect(pickNearestChapter([1, 2, 3], null)).toBe(1);
        expect(pickNearestChapter([3, 1], undefined)).toBe(3);
    });

    it('follows the camera once the map draws, the reveal chapter before', () => {
        const board = Object.create(OdysseyBoardController.prototype);
        board.focusChapter = 6;
        board.lastActiveChapter = Number.NaN;
        expect(board._liveFocusChapter()).toBe(6);
        board.lastActiveChapter = 7;
        expect(board._liveFocusChapter()).toBe(7);
        board.focusChapter = null;
        board.lastActiveChapter = undefined;
        expect(board._liveFocusChapter()).toBe(1);
    });

    it('builds the nearest chapter first and gives the world\'s chapters no slot', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const manager = Object.create(ChapterEnvironmentManager.prototype);
        manager.environments = new Map();
        manager.suppressedChapters = new Set([2, 3, 4, 5]);
        manager.cameraProgress = 0;
        manager.updateVisibility = vi.fn();
        const built = [];
        manager.createChapterEnvironment = vi.fn(async (id) => { built.push(id); return null; });

        manager.loadChaptersInBackground([6, 7], { canRunTask: () => true, focusChapter: () => 7 });
        await vi.advanceTimersByTimeAsync(560 + 1);
        expect(built).toEqual([8]); // ahead of a chapter-7 player, not chapter 1 first
        await vi.advanceTimersByTimeAsync(5000);
        expect(built).toEqual([8, 1]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('still builds the world\'s chapters once the world is abandoned (ADR-0015)', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const manager = Object.create(ChapterEnvironmentManager.prototype);
        manager.environments = new Map();
        manager.suppressedChapters = new Set([2, 3, 4, 5]);
        manager.cameraProgress = 0;
        manager.updateVisibility = vi.fn();
        const built = [];
        manager.createChapterEnvironment = vi.fn(async (id) => { built.push(id); return null; });

        manager.loadChaptersInBackground([1], { canRunTask: () => true, focusChapter: 1 });
        manager.suppressedChapters = new Set(); // _abandonOneWorld hands 2-5 back
        await vi.advanceTimersByTimeAsync(10_000);
        expect(built).toEqual([2, 3, 4, 5, 6, 7, 8]);
    });
});

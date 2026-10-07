/* eslint-disable import/first */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

vi.mock('../../src/rendering/phaser/board-juice.js', () => ({
    BoardJuice: vi.fn(() => ({ destroy() {} })),
}));

vi.mock('../../src/ui/infinity/InfinityMinimap.js', () => ({
    InfinityMinimap: class InfinityMinimap {
        constructor() {
            this.container = new EventTarget();
            this.container.style = {};
        }

        show() {}

        hide() {}

        destroy() {}

        onPause() {}

        onUnpause() {}

        update() {}
    },
}));

import { OdysseyMode } from '../../src/core/game-modes/OdysseyMode.js';

function event(name, detail) {
    const value = new Event(name);
    value.detail = detail;
    return value;
}

function prepare() {
    const frameRateController = {
        pauseHybridLoop: vi.fn(), resumeHybridLoop: vi.fn(), stopHybridLoop: vi.fn(),
    };
    const mode = new OdysseyMode({ frameRateController });
    mode.isRunning = true;
    mode.isInBoardView = false;
    mode.usingHybridLoop = true;
    mode.currentLevelConfig = { mechanics: { board: { rows: 100, columns: 10 } } };
    mode.gameState = { board: Array.from({ length: 104 }, () => []), isPaused: false };
    mode._activeLevelSession = {
        gameState: mode.gameState, hybridEngine: mode.hybridEngine, retired: false,
    };
    mode._setupCameraControls = vi.fn();
    mode._removeCameraControls = vi.fn();
    mode._startLevelTimer = vi.fn();
    mode.boardScene = {
        cameraSettings: { currentTopRow: 0, visibleRows: 20 },
        enableManualCameraControl: vi.fn(),
        disableManualCameraControl: vi.fn(),
        setPresentationPaused: vi.fn(),
        updateCameraPosition: vi.fn((topRow) => {
            mode.boardScene.cameraSettings.currentTopRow = topRow;
        }),
    };
    mode._getBoardScene = () => mode.boardScene;
    mode._initializeMinimap();
    return { mode, frameRateController, container: mode.minimap.container };
}

describe('Odyssey tall-board minimap ownership', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.stubGlobal('localStorage', { getItem: () => null });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('pauses live gameplay during exploration, centers the clicked row and resumes afterward', () => {
        const { mode, frameRateController, container } = prepare();
        container.dispatchEvent(event('minimap-exploration-start'));
        expect(mode.isPaused).toBe(true);
        expect(mode.gameState.isPaused).toBe(true);
        expect(frameRateController.pauseHybridLoop).toHaveBeenCalledOnce();
        expect(mode.boardScene.enableManualCameraControl).toHaveBeenCalledOnce();

        container.dispatchEvent(event('minimap-jump', { targetRow: 65 }));
        expect(mode.boardScene.updateCameraPosition).toHaveBeenCalledWith(55, true);

        container.dispatchEvent(event('minimap-exploration-end'));
        expect(mode.isPaused).toBe(false);
        expect(mode.gameState.isPaused).toBe(false);
        expect(frameRateController.resumeHybridLoop).toHaveBeenCalledOnce();
        expect(mode.boardScene.disableManualCameraControl).toHaveBeenCalledOnce();
    });

    it('keeps a preexisting pause after dragging the minimap', () => {
        const { mode, frameRateController, container } = prepare();
        mode.onPause();
        container.dispatchEvent(event('minimap-exploration-start'));
        container.dispatchEvent(event('minimap-jump', { targetRow: 1000 }));
        container.dispatchEvent(event('minimap-exploration-end'));
        expect(mode.isPaused).toBe(true);
        expect(mode.gameState.isPaused).toBe(true);
        expect(mode.boardScene.updateCameraPosition).toHaveBeenCalledWith(84, true);
        expect(frameRateController.resumeHybridLoop).not.toHaveBeenCalled();
    });

    it('clamps navigation to the actual board including hidden rows', () => {
        const { mode, container } = prepare();
        container.dispatchEvent(event('minimap-jump', { targetRow: -50 }));
        expect(mode.boardScene.updateCameraPosition).toHaveBeenLastCalledWith(0, true);
        container.dispatchEvent(event('minimap-jump', { targetRow: 1000 }));
        expect(mode.boardScene.updateCameraPosition).toHaveBeenLastCalledWith(84, true);
    });

    it('ignores malformed row events without corrupting the camera', () => {
        const { mode, container } = prepare();
        [undefined, null, NaN, Infinity, '65'].forEach((targetRow) => {
            container.dispatchEvent(event('minimap-jump', { targetRow }));
        });
        container.dispatchEvent(event('minimap-jump', { row: 65 }));
        container.dispatchEvent(event('minimap-jump'));
        expect(mode.boardScene.updateCameraPosition).not.toHaveBeenCalled();
        expect(mode.boardScene.cameraSettings.currentTopRow).toBe(0);
    });

    it('fences a retired map before a replacement attempt can be paused or moved', () => {
        const { mode, frameRateController, container } = prepare();
        container.dispatchEvent(event('minimap-exploration-start'));
        mode._activeLevelSession.retired = true;
        mode._activeLevelSession = { gameState: {}, retired: false };
        container.dispatchEvent(event('minimap-jump', { targetRow: 65 }));
        container.dispatchEvent(event('minimap-exploration-end'));
        expect(mode.boardScene.updateCameraPosition).not.toHaveBeenCalled();
        expect(frameRateController.resumeHybridLoop).not.toHaveBeenCalled();
        frameRateController.pauseHybridLoop.mockClear();
        container.dispatchEvent(event('minimap-exploration-start'));
        expect(frameRateController.pauseHybridLoop).not.toHaveBeenCalled();
    });

    it('removes exploration listeners when the map is cleaned up', () => {
        const { mode, frameRateController, container } = prepare();
        mode._cleanupMinimap();
        container.dispatchEvent(event('minimap-exploration-start'));
        container.dispatchEvent(event('minimap-jump', { targetRow: 65 }));
        container.dispatchEvent(event('minimap-exploration-end'));
        expect(mode.minimap).toBeNull();
        expect(mode.boardScene.updateCameraPosition).not.toHaveBeenCalled();
        expect(frameRateController.pauseHybridLoop).not.toHaveBeenCalled();
        expect(frameRateController.resumeHybridLoop).not.toHaveBeenCalled();
    });
});

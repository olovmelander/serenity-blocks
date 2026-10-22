/* eslint-disable import/first */
import {
    describe, expect, it, vi,
} from 'vitest';

// The renderer's @utils alias is not configured in the unit-test runtime.
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({
    BoardJuice: class BoardJuice {},
}));

import { OdysseyMode } from '../../src/core/game-modes/OdysseyMode.js';
import {
    INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1,
    projectInfinityPresentationCamera,
    resolveInfinitySpawnRow,
} from '../../src/core/infinity-spawn-policy.js';

/**
 * 2026-10-22: a tall well's camera is the spawn's camera. It used to follow on thresholds of its
 * own (a piece past 60 % of the view to 30 %, the tower only into the top 40 %), so the view and
 * the board-anchored spawn drifted apart — in orb 7 every piece spawned ten rows above the view.
 * It now frames resolveInfinityFollowCameraRow every frame: the tower's top at 20 % of the view
 * (the window the next piece is anchored to, two rows above it), lowered only while a falling
 * piece's bottom would pass 80 %.
 */
describe('Odyssey tall-well camera follow', () => {
    const ROWS_SHOWN = 20;

    function createMode({
        rows = 60, stackTop = rows, piece = null, topRow = rows - ROWS_SHOWN,
    } = {}) {
        const mode = Object.create(OdysseyMode.prototype);
        const board = Array.from({ length: rows }, (_, row) => (
            Array.from({ length: 10 }, (__, col) => (row >= stackTop && col === 4 ? 'I' : null))
        ));
        const gameState = {
            board,
            boardGrid: board,
            currentPiece: piece,
            isInfinityMode: true,
            infinitySpawnPolicy: INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1,
            infinityVisibleRows: ROWS_SHOWN,
            cameraRow: 7,
            cameraCenterRow: 17,
            piecesPlaced: 3,
        };
        const cameraSettings = {
            visibleRows: ROWS_SHOWN, currentTopRow: topRow, targetTopRow: topRow, lerpSpeed: 0.08,
        };
        // The scene's own per-call lerp and projection (base-board-scene.updateCameraPosition).
        const scene = {
            cameraSettings,
            updateCameraPosition: vi.fn((row) => {
                cameraSettings.targetTopRow = row;
                cameraSettings.currentTopRow += (row - cameraSettings.currentTopRow) * cameraSettings.lerpSpeed;
                projectInfinityPresentationCamera(gameState, cameraSettings.currentTopRow);
            }),
        };
        mode.boardScene = scene;
        mode.visibleRows = ROWS_SHOWN;
        mode.gameState = gameState;
        return {
            mode, scene, cameraSettings, gameState,
        };
    }

    const settle = (mode, frames = 300) => {
        for (let i = 0; i < frames; i += 1) mode._updateCameraPosition();
    };

    it('frames the window the next piece spawns into: two rows above the view', () => {
        const { mode, cameraSettings, gameState } = createMode({ stackTop: 30 });
        settle(mode);
        // The tower's top at 20 % of the view...
        expect(cameraSettings.currentTopRow).toBeCloseTo(30 - 4, 3);
        // ...and the next piece enters two rows above it, on screen at once.
        expect(resolveInfinitySpawnRow(gameState)).toBe(Math.round(cameraSettings.currentTopRow) - 2);
    });

    it('rests on the floor of an empty well', () => {
        const { mode, scene } = createMode({ rows: 44 });
        mode._updateCameraPosition();
        expect(scene.updateCameraPosition).toHaveBeenLastCalledWith(24);
    });

    it('follows a falling piece down only past 80 % of the view, keeping its bottom there', () => {
        // Above the line: the view stays on the tower.
        const high = createMode({
            rows: 80, stackTop: 50, topRow: 46, piece: { y: 52, shape: [[1], [1]] },
        });
        high.mode._updateCameraPosition();
        expect(high.scene.updateCameraPosition).toHaveBeenLastCalledWith(46);
        // Below it (a soft drop down a shaft): the view lowers so the bottom sits at 80 %.
        const deep = createMode({ stackTop: 20, topRow: 16, piece: { y: 38, shape: [[1], [1]] } });
        deep.mode._updateCameraPosition();
        expect(deep.scene.updateCameraPosition).toHaveBeenLastCalledWith(40 - 16);
    });

    it('returns home quickly after a deep lock, and glides otherwise', () => {
        const { mode, cameraSettings, gameState } = createMode({ stackTop: 20, topRow: 30 });
        mode._updateCameraPosition();
        expect(cameraSettings.lerpSpeed).toBe(0.25);
        gameState.currentPiece = { y: 30, shape: [[1], [1]] };
        cameraSettings.currentTopRow = 16;
        mode._updateCameraPosition();
        expect(cameraSettings.lerpSpeed).toBe(0.08);
    });

    it('never writes the simulation camera that the spawn reads', () => {
        const { mode, cameraSettings, gameState } = createMode({ stackTop: 30, topRow: 40 });
        settle(mode, 40);
        expect(cameraSettings.currentTopRow).toBeLessThan(40);
        expect(gameState.cameraRow).toBe(7);
        expect(gameState.cameraCenterRow).toBe(17);
    });

    it('leaves the view to the tower look while it drives the camera', () => {
        const { mode, scene, cameraSettings } = createMode({ stackTop: 30 });
        cameraSettings.manualControl = true;
        mode._updateCameraPosition();
        expect(scene.updateCameraPosition).not.toHaveBeenCalled();
    });
});

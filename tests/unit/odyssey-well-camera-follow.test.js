/* eslint-disable import/first */
import {
    describe, expect, it, vi,
} from 'vitest';

// The renderer's @utils alias is not configured in the unit-test runtime.
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({
    BoardJuice: class BoardJuice {},
}));

import { OdysseyMode } from '../../src/core/game-modes/OdysseyMode.js';

/**
 * Audit 2026-10-18: the tall-well follow stepped the camera lerp twice in a frame where both
 * the piece follow and the tower follow fired, and stopped a glide dead whenever its threshold
 * (re-checked against the moving camera) flipped. One target per frame, kept until reached.
 */
describe('Odyssey tall-well camera follow', () => {
    const BLOCK = 30;

    function createMode({
        rows = 60, highestRow = 60, piece = null, topRow = 0,
    } = {}) {
        const mode = Object.create(OdysseyMode.prototype);
        const cameraSettings = {
            visibleRows: 20, currentTopRow: topRow, targetTopRow: topRow,
        };
        const scene = {
            cameraSettings,
            boardConfig: { blockSize: BLOCK },
            cameras: { main: { scrollY: topRow * BLOCK } },
            // The scene's own per-call lerp (base-board-scene), at its default speed.
            updateCameraPosition: vi.fn((row) => {
                cameraSettings.targetTopRow = row;
                cameraSettings.currentTopRow += (row - cameraSettings.currentTopRow) * 0.08;
                scene.cameras.main.scrollY = cameraSettings.currentTopRow * BLOCK;
            }),
        };
        mode.boardScene = scene;
        mode.visibleRows = 20;
        mode.gameState = { board: new Array(rows).fill(null), currentPiece: piece };
        mode._findHighestBlockRow = () => highestRow;
        return { mode, scene, cameraSettings };
    }

    it('steps the camera once per frame when the piece and the tower both ask', () => {
        // A piece falls down a shaft beside a tower whose top is near the viewport's top.
        const { mode, scene } = createMode({
            topRow: 20, highestRow: 22, piece: { y: 34, shape: [[1], [1]] },
        });
        mode._updateCameraPosition();
        expect(scene.updateCameraPosition).toHaveBeenCalledOnce();
        // The falling piece wins, as in Infinity.
        expect(scene.updateCameraPosition.mock.calls[0][0]).toBe(36 - 6);
    });

    it('keeps gliding to its target after the threshold stops firing', () => {
        const { mode, scene, cameraSettings } = createMode({ topRow: 0, piece: { y: 20, shape: [[1], [1]] } });
        mode._updateCameraPosition();
        // The piece locks: no rule fires any more, but the glide must not stop mid-way.
        mode.gameState.currentPiece = null;
        for (let i = 0; i < 200; i += 1) mode._updateCameraPosition();
        expect(cameraSettings.currentTopRow).toBeCloseTo(16, 1);
        expect(mode._wellCameraTarget).toBeNull();
        const calls = scene.updateCameraPosition.mock.calls.length;
        mode._updateCameraPosition();
        expect(scene.updateCameraPosition.mock.calls.length).toBe(calls);
    });
});

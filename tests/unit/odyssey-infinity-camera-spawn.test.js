import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { GameplayHybridEngine } from '../../src/core/odyssey/GameplayHybridEngine.js';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';
import { hardDrop, spawnPiece } from '../../src/core/game.js';
import { markBoardDirty, rebuildBoardGridFromPieces } from '../../src/core/board.js';
import { checkInfinityGameOver } from '../../src/core/infinity-grid.js';
import {
    INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1,
    INFINITY_SPAWN_POLICY_CAMERA_V1,
    projectInfinityPresentationCamera,
    resolveInfinitySpawnRow,
} from '../../src/core/infinity-spawn-policy.js';
import { processPhysics } from '../../src/core/physics.js';
import { createBaseBoardScene } from '../../src/rendering/phaser/base-board-scene.js';

function createAttempt(id, overrides) {
    const engine = new GameplayHybridEngine();
    engine.configure(getLevelById(id));
    const state = engine.createGameState(overrides);
    state.nextPieces = ['O', 'O', 'O'];
    return { engine, state };
}

function createScene(state) {
    const Scene = createBaseBoardScene({ Scene: class {} });
    const scene = new Scene('Camera-spawn-regression', { rows: 20, hiddenRows: 0, blockSize: 30 });
    scene.gameState = state;
    scene.cameras = { main: { setBounds() {}, centerOn() {} } };
    scene.cameraSettings = { visibleRows: 20, currentTopRow: state.cameraRow, manualControl: false };
    return scene;
}

describe('Odyssey Infinity camera-independent spawning', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => { vi.restoreAllMocks(); });

    it.each([[55, 52], [39, 6]])('preserves level %i first spawn above starting garbage', (id, expectedRow) => {
        const { state } = createAttempt(id);
        const level = getLevelById(id);
        expect(state.infinitySpawnPolicy).toBe(INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1);
        expect(state.infinityVisibleRows).toBe(20 + level.mechanics.board.startingRows);
        const anchor = state.cameraRow;
        expect(projectInfinityPresentationCamera(state, state.boardGrid.length - 20)).toBe(false);
        expect(state.cameraRow).toBe(anchor);
        expect(spawnPiece(state)?.y).toBe(expectedRow);
        expect(state.isGameOver).toBe(false);
    });

    it.each([55, 39])('keeps level %i playable after paused exploration and immediate hard drops', async (id) => {
        const { engine, state } = createAttempt(id);
        if (id === 39) {
            // A supported central tower still leaves twelve clear roof rows.
            const garbageTop = state.boardGrid.length - getLevelById(id).mechanics.board.startingRows;
            state.lockedPieces.push({
                x: 4, y: 12, shape: Array.from({ length: garbageTop - 12 }, () => [1, 1]), pieceId: 999,
            });
            rebuildBoardGridFromPieces(state.lockedPieces, state.boardGrid);
            markBoardDirty(state);
        }
        expect(spawnPiece(state)).not.toBeNull();
        const scene = createScene(state);
        const anchor = state.cameraRow;
        state.isPaused = true;
        scene.enableManualCameraControl();
        scene.updateCameraPosition(state.boardGrid.length - 20);
        expect(scene.cameraSettings.currentTopRow).toBe(state.boardGrid.length - 20);
        expect(state.cameraRow).toBe(anchor);
        scene.disableManualCameraControl();
        state.isPaused = false;
        state.isSeeking = true;
        const onGameOver = vi.fn();
        const callbacks = engine.buildPhysicsCallbacks({
            spawnPiece: () => spawnPiece(state, null, onGameOver),
        });

        // No render can repair a stale camera between resume and these locks.
        for (let placement = 0; placement < 2; placement++) {
            expect(hardDrop(state, null, callbacks)).toBe(true);
            await state.latestPhysicsPromise; // eslint-disable-line no-await-in-loop -- each lock owns the next spawn
            expect(state.currentPiece).not.toBeNull();
            expect(state.currentPiece.y).toBe(resolveInfinitySpawnRow(state));
            expect(state.isGameOver).toBe(false);
        }
        expect(state.lockedPieces.some((piece) => piece.isGarbage)).toBe(true);
        expect(state.piecesPlaced).toBe(3);
        expect(checkInfinityGameOver(state)).toBe(false);
        expect(onGameOver).not.toHaveBeenCalled();
    });

    it.each([55, 39])('spawns level %i from settled board truth after a real two-wave cascade', async (id) => {
        const { engine, state } = createAttempt(id);
        spawnPiece(state);
        const bottom = state.boardGrid.length - 1;
        state.isSeeking = true;
        state.lockedPieces = [
            {
                pieceId: 1, shapeKey: 'I', color: 'I', x: 0, y: bottom, shape: [Array(10).fill(1)],
            },
            {
                pieceId: 2, shapeKey: 'I', color: 'I', x: 0, y: bottom - 3, shape: [[1]],
            },
            {
                pieceId: 3, shapeKey: 'I', color: 'I', x: 1, y: bottom - 1, shape: [Array(9).fill(1)],
            },
        ];
        const scene = createScene(state);
        scene.enableManualCameraControl();
        scene.updateCameraPosition(0);
        await processPhysics(state, engine.buildPhysicsCallbacks({}));
        expect(engine.getMetrics()).toMatchObject({ lines: 2, cascades: 1, maxCascadeDepth: 2 });
        expect(state.lockedPieces).toEqual([]);
        scene.updateCameraPosition(state.boardGrid.length - 20);
        const expectedRow = resolveInfinitySpawnRow(state);
        expect(spawnPiece(state)?.y).toBe(expectedRow);
        expect(state.isGameOver).toBe(false);
    });

    it('uses the actual capped starting garbage count for the initial window', () => {
        const engine = new GameplayHybridEngine();
        const level = structuredClone(getLevelById(55));
        level.mechanics.board.startingRows = 1000;
        engine.configure(level);
        const state = engine.createGameState();
        expect(state.lockedPieces).toHaveLength(96);
        expect(state.infinityVisibleRows).toBe(116);
        state.nextPieces = ['O'];
        expect(spawnPiece(state)?.y).toBe(0);
        expect(state.isGameOver).toBe(false);
    });

    it('keeps explicit supplemental policy and viewport authoritative', () => {
        const { state } = createAttempt(55, {
            infinitySpawnPolicy: INFINITY_SPAWN_POLICY_CAMERA_V1,
            infinityVisibleRows: 31,
        });
        expect(state.infinitySpawnPolicy).toBe(INFINITY_SPAWN_POLICY_CAMERA_V1);
        expect(state.infinityVisibleRows).toBe(31);
        expect(projectInfinityPresentationCamera(state, 20)).toBe(true);
        expect(spawnPiece(state)?.y).toBe(18);
    });
});

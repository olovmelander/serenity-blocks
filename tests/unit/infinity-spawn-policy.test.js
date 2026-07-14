import {
    describe, expect, it, vi,
} from 'vitest';
import {
    fillBag, GameState, spawnPiece,
} from '../../src/core/game.js';
import { expandGridIfNeeded } from '../../src/core/infinity-grid.js';
import {
    captureGameStateSnapshot,
    restoreGameStateSnapshot,
} from '../../src/core/demo/demo-state.js';
import {
    INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1,
    INFINITY_SPAWN_POLICY_CAMERA_V1,
    normalizeInfinitySpawnPolicy,
    projectInfinityPresentationCamera,
    resolveInfinitySimulationCameraRow,
    resolveInfinitySpawnRow,
} from '../../src/core/infinity-spawn-policy.js';
import { createBaseBoardScene } from '../../src/rendering/phaser/base-board-scene.js';
import { seededRandom } from '../../src/utils/helpers.js';

function createInfinityState(policy = INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1) {
    return new GameState({
        isInfinityMode: true,
        initialInfinityRows: 44,
        infinitySpawnPolicy: policy,
        infinityVisibleRows: 20,
    });
}

function spawnSeededPiece(state, seed = 42) {
    state.randomGenerator = seededRandom(seed);
    fillBag(state.nextPieces, state.randomGenerator);
    return spawnPiece(state, null, null);
}

function createCameraHarness(gameState) {
    const camera = {
        centerOn: vi.fn(),
        setBounds: vi.fn(),
        setLerp: vi.fn(),
        setRoundPixels: vi.fn(),
    };
    class Scene {
        constructor(key) {
            this.sceneKey = key;
        }
    }
    const Phaser = {
        Scene,
        Utils: { String: { UUID: () => 'test-scene' } },
    };
    const BaseBoardScene = createBaseBoardScene(Phaser);
    const scene = new BaseBoardScene('SpawnPolicyScene', {
        rows: 20,
        hiddenRows: 0,
        blockSize: 30,
    });
    scene.gameState = gameState;
    scene.cameras = { main: camera };
    scene.getBoardDimensions = () => ({ width: 300, height: 600 });
    return { camera, scene };
}

describe('Infinity deterministic spawn policy', () => {
    it('keeps the legacy camera policy as the default and rejects unknown rules', () => {
        expect(normalizeInfinitySpawnPolicy(undefined)).toBe(INFINITY_SPAWN_POLICY_CAMERA_V1);
        expect(normalizeInfinitySpawnPolicy(INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1))
            .toBe(INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1);
        expect(() => normalizeInfinitySpawnPolicy('future-policy')).toThrow(TypeError);

        const legacy = createInfinityState(INFINITY_SPAWN_POLICY_CAMERA_V1);
        legacy.cameraRow = 17.9;
        expect(spawnSeededPiece(legacy)?.y).toBe(15);
    });

    it('starts an empty 44-row board at the bottom viewport independently of cameraRow', () => {
        const state = createInfinityState();
        expect(resolveInfinitySimulationCameraRow(state)).toBe(24);
        expect(resolveInfinitySpawnRow(state)).toBe(22);

        state.cameraRow = 3.25;
        expect(spawnSeededPiece(state)?.y).toBe(22);
        expect(state.cameraRow).toBe(3.25);
    });

    it('derives the tower anchor from board truth and shifts exactly with expansion', () => {
        const state = createInfinityState();
        state.boardGrid[20][4] = { color: '#fff' };

        const cameraBefore = resolveInfinitySimulationCameraRow(state);
        const spawnBefore = resolveInfinitySpawnRow(state);
        expect(cameraBefore).toBe(16);
        expect(spawnBefore).toBe(14);

        expect(expandGridIfNeeded(state, 54)).toBe(true);
        expect(resolveInfinitySimulationCameraRow(state)).toBe(cameraBefore + 10);
        expect(resolveInfinitySpawnRow(state)).toBe(spawnBefore + 10);
    });

    it('bottom-anchors only the first spawn of a widened virtual viewport', () => {
        const state = new GameState({
            isInfinityMode: true,
            initialInfinityRows: 44,
            infinitySpawnPolicy: INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1,
            infinityVisibleRows: 26,
        });
        state.boardGrid[18][4] = { color: '#fff' };

        expect(resolveInfinitySpawnRow(state)).toBe(16);
        state.piecesPlaced = 1;
        expect(resolveInfinitySpawnRow(state)).toBe(11);
    });

    it('reads canonical boardGrid before a stale Infinity render alias is repaired', () => {
        const state = createInfinityState();
        const replacement = state.boardGrid.map((row) => row.slice());
        replacement[20][4] = { color: '#fff' };
        state.boardGrid = replacement;

        expect(state.board).not.toBe(state.boardGrid);
        expect(resolveInfinitySpawnRow(state)).toBe(14);
        expect(spawnSeededPiece(state)?.y).toBe(14);
        expect(state.board).toBe(state.boardGrid);
    });

    it('validates spawn rules and restores the Infinity board alias atomically', () => {
        const source = new GameState({
            isInfinityMode: true,
            initialInfinityRows: 44,
            infinitySpawnPolicy: INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1,
            infinityVisibleRows: 18,
            infinitySpawnOffsetRows: 3,
        });
        source.boardGrid[20][4] = { color: '#fff' };
        source.cameraRow = 999;
        source.cameraCenterRow = 1008;
        const snapshot = captureGameStateSnapshot(source);
        const restored = createInfinityState(INFINITY_SPAWN_POLICY_CAMERA_V1);

        expect(() => restoreGameStateSnapshot(restored, snapshot)).toThrow(
            'Infinity checkpoint rules do not match the active session',
        );
        restoreGameStateSnapshot(restored, snapshot, { adoptInfinitySpawnRules: true });

        expect(restored.infinitySpawnPolicy).toBe(INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1);
        expect(restored.infinityVisibleRows).toBe(18);
        expect(restored.infinitySpawnOffsetRows).toBe(3);
        expect(restored.board).toBe(restored.boardGrid);
        expect(restored.cameraRow).toBe(17);
        expect(restored.cameraCenterRow).toBe(26);
        expect(resolveInfinitySpawnRow(restored)).toBe(14);

        const normalState = new GameState();
        expect(() => restoreGameStateSnapshot(normalState, snapshot, {
            adoptInfinitySpawnRules: true,
        })).toThrow('Infinity checkpoint requires an Infinity session');

        const partialSnapshot = { ...snapshot };
        delete partialSnapshot.infinitySpawnPolicy;
        expect(() => restoreGameStateSnapshot(source, partialSnapshot)).toThrow(
            'Incomplete Infinity spawn rule descriptor in checkpoint',
        );
    });

    it.each([30, 60, 144])(
        'produces the same seeded spawn after %i Hz presentation updates',
        (renderRate) => {
            const state = createInfinityState();
            const initialSimulationCamera = state.cameraRow;

            for (let frame = 0; frame < renderRate * 2; frame += 1) {
                expect(projectInfinityPresentationCamera(
                    state,
                    (frame * 7) % 25,
                    ((frame * 7) % 25) + 10,
                )).toBe(false);
            }

            const piece = spawnSeededPiece(state, 8675309);
            expect({
                cameraRow: state.cameraRow,
                nextPieces: state.nextPieces.slice(0, 7),
                shapeKey: piece?.shapeKey,
                y: piece?.y,
            }).toEqual({
                cameraRow: initialSimulationCamera,
                nextPieces: ['T', 'S', 'J', 'O', 'I', 'Z', 'J'],
                shapeKey: 'L',
                y: 22,
            });
        },
    );

    it('keeps Phaser camera interpolation observer-only for deterministic sessions', () => {
        vi.stubGlobal('window', {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            settingsManager: null,
            themeManager: null,
        });
        const scenes = [];
        try {
            const fixedState = createInfinityState();
            fixedState.cameraRow = 7;
            fixedState.cameraCenterRow = 17;
            const fixedHarness = createCameraHarness(fixedState);
            scenes.push(fixedHarness.scene);

            fixedHarness.scene.configureCamera();
            fixedHarness.scene.updateCameraPosition(3, true);

            expect(fixedState.cameraRow).toBe(7);
            expect(fixedState.cameraCenterRow).toBe(17);
            expect(fixedHarness.camera.centerOn).toHaveBeenCalled();

            const legacyState = createInfinityState(INFINITY_SPAWN_POLICY_CAMERA_V1);
            legacyState.cameraRow = 7;
            const legacyHarness = createCameraHarness(legacyState);
            scenes.push(legacyHarness.scene);
            legacyHarness.scene.configureCamera();

            expect(legacyState.cameraRow).toBe(24);
            expect(legacyState.cameraCenterRow).toBe(34);
        } finally {
            scenes.forEach((scene) => scene.styleManager?.destroy?.());
            vi.unstubAllGlobals();
        }
    });
});

import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { MultiPlayerState } from '../../src/core/multi-player-state.js';
import {
    applyGarbage, spawnPiece, hardDrop, canPlacePiece,
} from '../../src/core/game.js';
import { rebuildBoardGridFromPieces } from '../../src/core/board.js';
import { LocalMultiplayerMode } from '../../src/core/game-modes/LocalMultiplayerMode.js';
import { startLocalMultiplayerModeLoop } from '../../src/core/game-modes/local-multiplayer-loop.js';
import { projectInfinityPresentationCamera } from '../../src/core/infinity-spawn-policy.js';

vi.mock('phaser', () => ({ default: { Game: vi.fn() } }));
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({ BoardJuice: vi.fn() }));

function createMatch(numPlayers = 2) {
    const match = new MultiPlayerState(numPlayers);
    match.setMatchConfig({ isInfinityLMS: true, infinityMaxRows: 100 });
    match.reset();
    return match;
}

function setTower(player, topRow, column = 4) {
    player.lockedPieces = [{
        x: column, y: topRow, shape: Array.from({ length: player.boardGrid.length - topRow }, () => [1, 1]),
        pieceId: 1, shapeKey: 'O', color: '#ff0000',
    }];
    rebuildBoardGridFromPieces(player.lockedPieces, player.boardGrid);
    player.boardCacheDirty = true;
}

function createMode(match) {
    const mode = Object.create(LocalMultiplayerMode.prototype);
    Object.assign(mode, {
        multiplayerState: match,
        matchConfig: match.matchConfig,
        boardScenes: [],
        isRunning: true,
        _gameLoopGeneration: 0,
        animationFrameId: null,
        _syncBoardScenes: vi.fn(),
        _updateMultiplayerStats: vi.fn(),
        _handleGameOver: vi.fn(),
        deps: { soundManager: { sfxPlayer: { playDrop: vi.fn() } } },
    });
    return mode;
}

describe('local multiplayer Infinity stacking and roof rules', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('spawns above a fast-growing tower while the presentation camera lags', () => {
        const match = createMatch(4);
        for (const player of match.players) {
            setTower(player, 20);
            player.cameraRow = 24; // Camera still looking at the previous, lower stack.
            player.nextPieces = ['O'];
            const onDeath = vi.fn();
            const piece = spawnPiece(player, null, onDeath);

            expect(piece).not.toBeNull();
            expect(piece.y).toBe(14);
            expect(canPlacePiece(player, piece, piece.x, piece.y)).toBe(true);
            expect(onDeath).not.toHaveBeenCalled();
            expect(projectInfinityPresentationCamera(player, 24)).toBe(false);
        }
    });

    it('keeps repeated attack-free locks on the real floor through grid expansions', async () => {
        const match = createMatch();
        const mode = createMode(match);
        const player = match.players[0];
        const onDeath = vi.fn();
        const callbacks = {
            spawnPiece: () => {
                mode._maybeExpandPlayerGrid(player, null);
                spawnPiece(player, null, onDeath);
            },
        };
        player.nextPieces = Array(50).fill('O');
        spawnPiece(player, null, onDeath);

        for (let lock = 0; lock < 30; lock += 1) {
            const heightBefore = player.boardGrid.length;
            expect(hardDrop(player, null, callbacks)).toBe(true);
            await player.latestPhysicsPromise;
            const expansion = player.boardGrid.length - heightBefore;
            const latest = player.lockedPieces.at(-1);
            expect(latest.y).toBe(heightBefore - (lock + 1) * 2 + expansion);
            // Every occupied row reaches the same columns down to the actual bottom.
            for (let row = player.boardGrid.length - (lock + 1) * 2; row < player.boardGrid.length; row += 1) {
                expect(player.boardGrid[row][4]).not.toBeNull();
                expect(player.boardGrid[row][5]).not.toBeNull();
            }
            expect(player.isGameOver).toBe(false);
        }
        expect(player.boardGrid.length).toBeGreaterThan(44);
        expect(onDeath).not.toHaveBeenCalled();
    });

    it('expands before the roof check on the first frame, without a scene or a current piece', () => {
        const match = createMatch();
        const mode = createMode(match);
        const player = match.players[0];
        setTower(player, 0, 0);
        const frames = [];
        vi.stubGlobal('window', {});
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { frames.push(callback); return frames.length; }));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());

        startLocalMultiplayerModeLoop(mode);
        frames[0](16);

        expect(player.boardGrid).toHaveLength(54);
        expect(player.lockedPieces[0].y).toBe(10);
        expect(player.isGameOver).toBe(false);
        expect(mode._handleGameOver).not.toHaveBeenCalled();
    });

    it('allows a pending cascade to remove roof blocks before eliminating a player', () => {
        const match = createMatch();
        const mode = createMode(match);
        const player = match.players[0];
        player.maxRows = 44;
        setTower(player, 0, 0);
        player.isProcessingPhysics = true;
        const frames = [];
        vi.stubGlobal('window', {});
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { frames.push(callback); return frames.length; }));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());

        startLocalMultiplayerModeLoop(mode);
        frames[0](16);
        expect(mode._handleGameOver).not.toHaveBeenCalled();
        expect(player.isGameOver).toBe(false);

        player.isProcessingPhysics = false;
        frames[1](32);
        expect(mode._handleGameOver).toHaveBeenCalledExactlyOnceWith(0);
        expect(player.isGameOver).toBe(true);
    });

    it('compensates the visible camera while leaving the simulation spawn anchor on the tower', () => {
        const match = createMatch();
        const mode = createMode(match);
        const player = match.players[0];
        setTower(player, 20);
        const scene = {
            cameraSettings: { currentTopRow: 24, targetTopRow: 24, visibleRows: 20, manualControl: true },
            updateCameraBounds: vi.fn(),
            boardConfig: { blockSize: 40 },
            getBoardDimensions: () => ({ width: 400 }),
            cameras: { main: { centerOn: vi.fn() } },
        };

        mode._maybeExpandPlayerGrid(player, scene);

        expect(player.boardGrid).toHaveLength(54);
        expect(scene.cameraSettings.currentTopRow).toBe(34);
        expect(scene.cameras.main.centerOn).toHaveBeenCalledWith(200, 1760);
        expect(player.cameraRow).toBe(26);
        expect(player.infinityStats.rowsReached).toBe(54);
    });

    it('restores standard board rules when a match switches out of Infinity', () => {
        const match = createMatch();
        match.setMatchConfig({ isInfinityLMS: false });
        match.reset();
        expect(match.players.every((player) => !player.isInfinityMode && player.boardGrid.length === 24)).toBe(true);
    });

    it('spawns from board truth after a large burst compensates a lagging visible camera', () => {
        const match = createMatch();
        const mode = createMode(match);
        const player = match.players[0];
        setTower(player, 3);
        const scene = {
            cameraSettings: { currentTopRow: 24, targetTopRow: 24, visibleRows: 20 },
            updateCameraBounds: vi.fn(),
            boardConfig: { blockSize: 40 },
            getBoardDimensions: () => ({ width: 400 }),
            cameras: { main: { centerOn: vi.fn() } },
        };
        const burst = Array.from({ length: 25 }, () => ({ type: 'line', holeMask: 1 << 9 }));
        const result = applyGarbage(player, burst);
        mode._compensatePlayerGridExpansion(player, scene, result.rowsAdded);
        player.nextPieces = ['O'];
        const onDeath = vi.fn();
        const piece = spawnPiece(player, null, onDeath);

        expect(result.topOut).toBe(false);
        expect(result.rowsAdded).toBe(30);
        expect(player.boardGrid).toHaveLength(74);
        expect(scene.cameraSettings.currentTopRow).toBe(54);
        expect(player.cameraRow).toBe(4);
        expect(piece.y).toBe(2);
        expect(canPlacePiece(player, piece, piece.x, piece.y)).toBe(true);
        expect(player.infinityStats.rowsReached).toBe(74);
        expect(onDeath).not.toHaveBeenCalled();
    });
});

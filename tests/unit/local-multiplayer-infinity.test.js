import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { MultiPlayerState } from '../../src/core/multi-player-state.js';
import {
    applyGarbage, spawnPiece, hardDrop, canPlacePiece,
} from '../../src/core/game.js';
import { rebuildBoardGridFromPieces } from '../../src/core/board.js';
import { expandGridIfNeeded } from '../../src/core/infinity-grid.js';
import { LocalMultiplayerMode } from '../../src/core/game-modes/LocalMultiplayerMode.js';
import { startLocalMultiplayerModeLoop } from '../../src/core/game-modes/local-multiplayer-loop.js';
import { projectInfinityPresentationCamera } from '../../src/core/infinity-spawn-policy.js';

vi.mock('phaser', () => ({ default: { Game: vi.fn() } }));
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({ BoardJuice: vi.fn() }));

function createMatch(numPlayers = 2, infinityMaxRows = 100) {
    const match = new MultiPlayerState(numPlayers);
    match.setMatchConfig({ isInfinityLMS: true, infinityMaxRows });
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
            // The tower's top (row 20) six rows down the window (30 %), the spawn two above it.
            expect(piece.y).toBe(12);
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
        expect(player.cameraRow).toBe(24);
        expect(player.infinityStats.rowsReached).toBe(54);
    });

    it('spawns every piece two rows under the roof, and tops out only when none fits', () => {
        // Found in game: a stack two rows under the roof topped out on T, J and L (their
        // matrices start with an empty row, so at row 0 their cells began a row low).
        const spawnUnderRoof = (top, key) => {
            const player = createMatch().players[0];
            while (player.boardGrid.length < player.maxRows) expandGridIfNeeded(player, player.maxRows);
            // A stack across the well (column 0 open, so nothing clears).
            player.lockedPieces = [{
                x: 1,
                y: top,
                shape: Array.from({ length: player.boardGrid.length - top }, () => Array(9).fill(1)),
                pieceId: 1,
                shapeKey: 'J',
                color: '#ff0000',
            }];
            rebuildBoardGridFromPieces(player.lockedPieces, player.boardGrid);
            player.boardCacheDirty = true;
            player.nextPieces = [key, 'O'];
            const onDeath = vi.fn();
            const piece = spawnPiece(player, null, onDeath);
            return { player, piece, onDeath };
        };
        const firstCellRow = (piece) => piece.y + piece.shape.findIndex((row) => row.some(Boolean));
        for (const key of ['I', 'O', 'T', 'S', 'Z', 'J', 'L']) {
            const { player, piece, onDeath } = spawnUnderRoof(2, key);
            expect(onDeath, key).not.toHaveBeenCalled();
            expect(player.isGameOver, key).toBe(false);
            expect(canPlacePiece(player, piece, piece.x, piece.y), key).toBe(true);
            // T, J and L rose to the roof; the rest fit where they spawn (a flat I on row 1).
            expect(firstCellRow(piece), key).toBe(key === 'I' ? 1 : 0);
        }
        // One row of room: only a flat I still fits.
        for (const key of ['O', 'T', 'S', 'Z', 'J', 'L']) {
            expect(spawnUnderRoof(1, key).onDeath, key).toHaveBeenCalledOnce();
        }
        expect(spawnUnderRoof(1, 'I').onDeath).not.toHaveBeenCalled();
        // Below the roof a T spawns where it always has (nothing rises).
        const low = createMatch().players[0];
        setTower(low, 20);
        low.nextPieces = ['T'];
        expect(spawnPiece(low, null, vi.fn()).y).toBe(12);
    });

    it('keeps the well height between 40 and 1,000 rows, and 100 when none is given', () => {
        const heightFor = (infinityMaxRows) => {
            const match = new MultiPlayerState(2);
            match.setMatchConfig({ isInfinityLMS: true, infinityMaxRows });
            match.reset();
            return [match.matchConfig.infinityMaxRows, match.players[0].maxRows];
        };
        expect(heightFor(40)).toEqual([40, 40]);
        expect(heightFor('60')).toEqual([60, 60]);
        expect(heightFor(100)).toEqual([100, 100]);
        expect(heightFor(1000)).toEqual([1000, 1000]);
        expect(heightFor(39)).toEqual([40, 40]);
        expect(heightFor(0)).toEqual([40, 40]);
        expect(heightFor(5000)).toEqual([1000, 1000]);
        expect(heightFor(undefined)).toEqual([100, 100]);
        expect(heightFor('')).toEqual([100, 100]);
        expect(heightFor('tall')).toEqual([100, 100]);
        // A match that never names a height plays the default.
        const plain = new MultiPlayerState(2);
        plain.setMatchConfig({ isInfinityLMS: true });
        plain.reset();
        expect(plain.players[0].maxRows).toBe(100);
        expect(plain.players[0].boardGrid).toHaveLength(44);
    });

    it('opens a 40-row well at its full height and never grows it', () => {
        const match = createMatch(2, 40);
        const mode = createMode(match);
        for (const player of match.players) {
            expect(player.maxRows).toBe(40);
            expect(player.boardGrid).toHaveLength(40);
            expect(player.infinityStats.rowsReached).toBe(40);
            // The opening view is the well's lower 20 rows; the first piece enters two above it.
            expect(player.cameraRow).toBe(20);
        }
        const player = match.players[0];
        player.nextPieces = ['O', 'O'];
        const onDeath = vi.fn();
        expect(spawnPiece(player, null, onDeath).y).toBe(18);

        // A tower near the top asks for more rows; the well has none to give.
        setTower(player, 5);
        mode._maybeExpandPlayerGrid(player, null);
        expect(player.boardGrid).toHaveLength(40);

        // Nor does a burst of garbage raise the roof: it pushes the stack into it.
        const burst = Array.from({ length: 4 }, () => ({ type: 'line', holeMask: 1 << 9 }));
        const result = applyGarbage(player, burst);
        expect(result.rowsAdded).toBe(0);
        expect(player.boardGrid).toHaveLength(40);
        expect(player.infinityStats.rowsReached).toBe(40);
        expect(onDeath).not.toHaveBeenCalled();

        // A new round opens the same short well.
        match.reset();
        expect(match.players[0].boardGrid).toHaveLength(40);
    });

    it('lets a well between 40 and 44 rows open whole, and a taller one grow to its height', () => {
        expect(createMatch(2, 42).players[0].boardGrid).toHaveLength(42);
        const player = createMatch(2, 50).players[0];
        expect(player.boardGrid).toHaveLength(44);
        while (expandGridIfNeeded(player, player.maxRows)) { /* grow to the roof */ }
        expect(player.boardGrid).toHaveLength(50);
    });

    it('eliminates a player whose stack reaches the roof of a 40-row well', () => {
        const match = createMatch(2, 40);
        const mode = createMode(match);
        const player = match.players[0];
        setTower(player, 0, 0);
        const frames = [];
        vi.stubGlobal('window', {});
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { frames.push(callback); return frames.length; }));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());

        startLocalMultiplayerModeLoop(mode);
        frames[0](16);

        expect(player.boardGrid).toHaveLength(40);
        expect(mode._handleGameOver).toHaveBeenCalledExactlyOnceWith(0);
        expect(player.isGameOver).toBe(true);
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
        expect(player.cameraRow).toBe(2);
        expect(piece.y).toBe(0);
        expect(canPlacePiece(player, piece, piece.x, piece.y)).toBe(true);
        expect(player.infinityStats.rowsReached).toBe(74);
        expect(onDeath).not.toHaveBeenCalled();
    });
});

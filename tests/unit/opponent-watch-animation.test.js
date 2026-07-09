/* eslint-disable import/first */
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({
    BoardJuice: class BoardJuice {},
}));

import { OpponentWatchManager } from '../../src/ui/opponent-watch-manager.js';
import { OnlineMultiplayerMode } from '../../src/core/game-modes/OnlineMultiplayerMode.js';
import { emitMultiplayerEvent, MULTIPLAYER_EVENTS } from '../../src/events/multiplayer-events.js';

function makeWatcher() {
    return Object.assign(Object.create(OpponentWatchManager.prototype), {
        _colorCache: new Map(),
        _styleConfigCache: new Map(),
        _boardEffects: new Map(),
        allPlayers: [],
        styleManager: null,
        styleInitPending: false,
    });
}

function makeGrid(rows = 24, cols = 10) {
    return Array.from({ length: rows }, () => Array(cols).fill(0));
}

function makeCanvasContext() {
    return {
        canvas: {},
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        rect: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        arc: vi.fn(),
        fillRect: vi.fn(),
        set fillStyle(value) { this._fillStyle = value; },
        get fillStyle() { return this._fillStyle; },
        set strokeStyle(value) { this._strokeStyle = value; },
        get strokeStyle() { return this._strokeStyle; },
        set lineWidth(value) { this._lineWidth = value; },
        get lineWidth() { return this._lineWidth; },
        set imageSmoothingEnabled(value) { this._imageSmoothingEnabled = value; },
        get imageSmoothingEnabled() { return this._imageSmoothingEnabled; },
    };
}

const registeredModes = [];

function makeOnlineMode() {
    const mode = Object.assign(Object.create(OnlineMultiplayerMode.prototype), {
        steamNetworking: { steamId: 'LOCAL' },
        deps: {
            settingsManager: { get: () => ({ comboPopupEffect: true }) },
            soundManager: {
                sfxPlayer: {
                    playDrop: vi.fn(),
                    playPerfectClear: vi.fn(),
                },
            },
        },
        cleanupHandlers: [],
        playerColors: new Map([['P2', '#22d3ee']]),
        opponentWatchManager: {
            triggerOpponentPieceLock: vi.fn(),
            triggerOpponentHardDrop: vi.fn(),
            triggerOpponentGarbage: vi.fn(),
            setOpponentDeadState: vi.fn(),
            triggerOpponentPerfectClear: vi.fn(),
            clearOpponentEffectStates: vi.fn(),
        },
        mainBoardScene: {
            sharedEffects: { playPerfectClear: vi.fn() },
        },
        _flashGarbageIndicator: vi.fn(),
        _handlePlayerDeath: vi.fn(),
        _showDeathAnimation: vi.fn(),
        _clearDeathState: vi.fn(),
        _playRoundStartStinger: vi.fn(),
        killFeed: null,
        roundNumber: 1,
    });
    registeredModes.push(mode);
    return mode;
}

afterEach(() => {
    while (registeredModes.length > 0) {
        const mode = registeredModes.pop();
        mode.cleanupHandlers?.forEach((cleanup) => cleanup());
    }
    vi.restoreAllMocks();
});

describe('opponent watcher animation quality', () => {
    it('keeps fractional x/y in the render dirty signature', () => {
        const watcher = makeWatcher();

        const a = watcher._computePieceHash({
            type: 'T', x: 4, y: 5.1, rotation: 0,
        });
        const b = watcher._computePieceHash({
            type: 'T', x: 4, y: 5.2, rotation: 0,
        });
        const c = watcher._computePieceHash({
            type: 'T', x: 4.1, y: 5.2, rotation: 0,
        });

        expect(a).not.toBe(b);
        expect(b).not.toBe(c);
        expect(b).toBe('T|40|52|0');
    });

    it('projects ghost rows from floored interpolated y', () => {
        const watcher = makeWatcher();
        const ghostY = watcher._calculateGhostY({
            shape: [[1]],
            x: 4,
            y: 5.8,
        }, makeGrid());

        expect(ghostY).toBe(23);
    });

    it('draws opponent ghosts through the unified styled path', () => {
        const watcher = makeWatcher();
        const ctx = makeCanvasContext();

        watcher._drawGhostPiece(ctx, {
            type: 'I',
            color: '#38bdf8',
            shape: [[1, 1, 1, 1]],
            x: 3,
            y: 7.4,
        }, 18, 8, new Map());

        expect(ctx.rect).toHaveBeenCalled();
        expect(ctx.fill).toHaveBeenCalled();
        expect(ctx.stroke).toHaveBeenCalled();
        expect(ctx.fillRect).not.toHaveBeenCalled();
    });

    it('positions opponent hard-drop bursts from the dropped piece payload', () => {
        const watcher = makeWatcher();
        const fx = {
            width: 80,
            height: 160,
            blockSize: 8,
            isFocused: false,
            spawnBurstParticles: vi.fn(),
            triggerPieceLockPulse: vi.fn(),
        };
        watcher._boardEffects = new Map([['P2', fx]]);

        watcher.triggerOpponentHardDrop('P2', {
            piece: { x: 3, shape: [[1, 1], [1, 1]] },
            endY: 18,
        }, '#fde68a');

        expect(fx.spawnBurstParticles).toHaveBeenCalledWith(32, 116, 12, 220, '#fde68a');
        expect(fx.triggerPieceLockPulse).toHaveBeenCalledWith('#fde68a');
    });

    it('pulses in player color when a streamed opponent grid settles (lock-sized delta)', () => {
        const watcher = makeWatcher();
        const fx = { triggerPieceLockPulse: vi.fn() };
        watcher._boardEffects = new Map([['P2', fx]]);
        watcher.allPlayers = [{ id: 'P2', color: '#fb7185' }];
        const board = {
            settledGridHash: watcher._computeBoardHash(makeGrid()),
            settledCellCount: watcher._countOccupiedCells(makeGrid()),
        };
        const nextGrid = makeGrid();
        // A T-piece locking lands 4 new cells.
        nextGrid[23][3] = { type: 'T', color: '#fb7185' };
        nextGrid[23][4] = { type: 'T', color: '#fb7185' };
        nextGrid[23][5] = { type: 'T', color: '#fb7185' };
        nextGrid[22][4] = { type: 'T', color: '#fb7185' };

        watcher._maybeTriggerSettledBoardPulse('P2', board, {
            grid: nextGrid,
            color: '#fb7185',
        });

        expect(fx.triggerPieceLockPulse).toHaveBeenCalledWith('#fb7185');
        expect(board.settledGridHash).toBe(watcher._computeBoardHash(nextGrid));
        expect(board.settledCellCount).toBe(4);
    });

    it('does NOT pulse on a garbage insert (large positive delta — has its own red flash)', () => {
        const watcher = makeWatcher();
        const fx = { triggerPieceLockPulse: vi.fn() };
        watcher._boardEffects = new Map([['P2', fx]]);
        watcher.allPlayers = [{ id: 'P2', color: '#fb7185' }];
        const board = {
            settledGridHash: watcher._computeBoardHash(makeGrid()),
            settledCellCount: 0,
        };
        // Garbage inserts whole rows at once (9 cells/row) — far more than a piece lock.
        const nextGrid = makeGrid();
        [23, 22].forEach((r) => { for (let c = 0; c < 10; c++) { if (c !== 7) nextGrid[r][c] = { type: 'GARBAGE', color: '#888' }; } });

        watcher._maybeTriggerSettledBoardPulse('P2', board, { grid: nextGrid, color: '#fb7185' });

        expect(fx.triggerPieceLockPulse).not.toHaveBeenCalled();
        // baseline still advances so a subsequent real lock is measured from here
        expect(board.settledGridHash).toBe(watcher._computeBoardHash(nextGrid));
    });

    it('does NOT pulse on a line clear (cells removed — has its own clear flash)', () => {
        const watcher = makeWatcher();
        const fx = { triggerPieceLockPulse: vi.fn() };
        watcher._boardEffects = new Map([['P2', fx]]);
        watcher.allPlayers = [{ id: 'P2', color: '#fb7185' }];
        const fullishGrid = makeGrid();
        for (let c = 0; c < 10; c++) { fullishGrid[23][c] = { type: 'I', color: '#38bdf8' }; }
        const board = {
            settledGridHash: watcher._computeBoardHash(fullishGrid),
            settledCellCount: watcher._countOccupiedCells(fullishGrid),
        };
        // After a clear the row is gone → fewer occupied cells.
        const clearedGrid = makeGrid();

        watcher._maybeTriggerSettledBoardPulse('P2', board, { grid: clearedGrid, color: '#fb7185' });

        expect(fx.triggerPieceLockPulse).not.toHaveBeenCalled();
    });

    it('drives the spectator spotlight pending-garbage bar from the watched player', () => {
        const watcher = makeWatcher();
        const mkEl = () => ({
            style: {},
            classList: {
                _s: new Set(),
                toggle(c, on) { if (on) this._s.add(c); else this._s.delete(c); },
                contains(c) { return this._s.has(c); },
            },
        });
        const meter = mkEl();
        const fill = mkEl();
        const segments = mkEl();
        watcher._spotlightGarbage = { garbageMeter: meter, garbageFill: fill, garbageSegments: segments };
        watcher._spotlightGarbageSig = null;
        // Segment rendering uses document.createElement (DOM); assert delegation, not the DOM nodes.
        watcher._renderGarbageSegments = vi.fn();
        const queue = {
            getTotalLines: () => 6,
            entries: new Array(6).fill(0).map(() => ({ type: 'line', color: '#f00' })),
        };
        const player = { id: 'P2', garbageQueue: queue };

        watcher._updateSpotlightGarbage(player);

        expect(fill.style.height).toBe('30%'); // 6 / 20 lines
        expect(meter.classList.contains('pending')).toBe(true);
        expect(meter.classList.contains('warning')).toBe(false); // < 8
        expect(watcher._renderGarbageSegments).toHaveBeenCalledWith(segments, queue, 6);

        // Same amount/queue → dedup (no per-frame rebuild).
        watcher._updateSpotlightGarbage(player);
        expect(watcher._renderGarbageSegments).toHaveBeenCalledTimes(1);
    });

    it('no-ops the spotlight garbage update when no meter is wired', () => {
        const watcher = makeWatcher();
        watcher._spotlightGarbage = null;
        expect(() => watcher._updateSpotlightGarbage({ id: 'P2', garbagePending: 4 })).not.toThrow();
    });
});

describe('online opponent effect routing', () => {
    it('routes remote lock/drop/garbage/death/perfect-clear events to opponent overlays', () => {
        const mode = makeOnlineMode();
        mode._registerEffectHandlers();

        emitMultiplayerEvent(MULTIPLAYER_EVENTS.PIECE_LOCK, { steamId: 'P2', piece: { type: 'T' } });
        emitMultiplayerEvent('game:hard_drop', { steamId: 'P2', dropData: { endY: 17 } });
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.GARBAGE_INSERTED, { steamId: 'P2', isLocal: false });
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.PLAYER_TOPPED_OUT, { steamId: 'P2', isLocal: false });
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.PERFECT_CLEAR, { steamId: 'P2', depth: 4 });

        expect(mode.opponentWatchManager.triggerOpponentPieceLock).toHaveBeenCalledWith('P2', '#22d3ee');
        expect(mode.opponentWatchManager.triggerOpponentHardDrop).toHaveBeenCalledWith('P2', { endY: 17 }, '#22d3ee');
        expect(mode.opponentWatchManager.triggerOpponentGarbage).toHaveBeenCalledWith('P2', '#f87171');
        expect(mode.opponentWatchManager.setOpponentDeadState).toHaveBeenCalledWith('P2', true);
        expect(mode.opponentWatchManager.triggerOpponentPerfectClear).toHaveBeenCalledWith('P2', 4, '#ffffff');
    });

    it('keeps local perfect-clear effects on the main board path', () => {
        const mode = makeOnlineMode();
        mode._registerEffectHandlers();

        emitMultiplayerEvent(MULTIPLAYER_EVENTS.PERFECT_CLEAR, {
            steamId: 'LOCAL',
            depth: 3,
            perfectClearBonus: 3750,
        });

        expect(mode.deps.soundManager.sfxPlayer.playPerfectClear).toHaveBeenCalled();
        expect(mode.mainBoardScene.sharedEffects.playPerfectClear).toHaveBeenCalledWith(3);
        expect(mode.opponentWatchManager.triggerOpponentPerfectClear).not.toHaveBeenCalled();
    });
});

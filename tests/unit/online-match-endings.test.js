/* eslint-disable import/first */
/**
 * Online versus' endings, wired (OnlineMultiplayerMode + OpponentWatchManager): a knock-out
 * shows from the death message itself and stays shown until the round resets, the round's
 * outcome is announced while the host's beat holds, and the match won holds on the boards
 * with a crest over the winner's well before the results.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({
    BoardJuice: class BoardJuice {},
}));

import { OpponentWatchManager } from '../../src/ui/opponent-watch-manager.js';
import { OnlineMultiplayerMode } from '../../src/core/game-modes/OnlineMultiplayerMode.js';

function makeBoard(id) {
    const classes = new Set();
    return {
        playerKey: id,
        isEliminated: false,
        isWaiting: false,
        frame: { id: `frame-${id}` },
        element: {
            classList: {
                add: (c) => classes.add(c),
                remove: (c) => classes.delete(c),
                contains: (c) => classes.has(c),
            },
            style: { setProperty: vi.fn() },
        },
        _hud: { classes: {}, disconnected: false },
    };
}

function makeWatcher(ids = ['P2', 'P3']) {
    const fx = new Map(ids.map((id) => [id, { setDeadState: vi.fn(), triggerVictory: vi.fn() }]));
    const watcher = Object.assign(Object.create(OpponentWatchManager.prototype), {
        playerBoards: new Map(ids.map((id) => [id, makeBoard(id)])),
        _boardEffects: fx,
        _knockedOut: new Map(),
        _lastNextPieces: new Map(),
        allPlayers: [],
        localPlayerId: 'LOCAL',
        autoWatchEnabled: false,
    });
    watcher._showOpponentDeathAnimation = vi.fn();
    watcher._clearOpponentDeathState = vi.fn();
    watcher._ensureOpponentDeathOverlay = vi.fn();
    watcher._getBoardHudNodes = vi.fn((board) => board._hud);
    watcher._maybeTriggerSettledBoardPulse = vi.fn();
    watcher._updateGarbageMeter = vi.fn();
    watcher._updateSelectionList = vi.fn();
    return watcher;
}

const snapshot = (id, extra = {}) => ({ id, isAlive: true, frags: 0, ...extra });

describe('opponent field: a knock-out', () => {
    it('shows the moment it is announced, once, naming who did it', () => {
        const watcher = makeWatcher();
        watcher.knockOutOpponent('P2', 'Mika');
        const board = watcher.playerBoards.get('P2');
        expect(board.isEliminated).toBe(true);
        expect(board.element.classList.contains('dead')).toBe(true);
        expect(watcher._boardEffects.get('P2').setDeadState).toHaveBeenCalledWith(true);
        expect(watcher._showOpponentDeathAnimation).toHaveBeenCalledWith(board, 'Mika');

        watcher.knockOutOpponent('P2', 'Mika');
        expect(watcher._showOpponentDeathAnimation).toHaveBeenCalledTimes(1);
        // Your own board and players not in the field are not the field's to knock out.
        watcher.knockOutOpponent('LOCAL', null);
        watcher.knockOutOpponent('P9', null);
        expect(watcher._showOpponentDeathAnimation).toHaveBeenCalledTimes(1);
    });

    it('stays out when a snapshot sent before the death arrives after it', () => {
        const watcher = makeWatcher();
        watcher.knockOutOpponent('P2', 'Mika');
        watcher.updateFromState([snapshot('P2'), snapshot('P3')]);
        const board = watcher.playerBoards.get('P2');
        expect(board.isEliminated).toBe(true);
        expect(board.element.classList.contains('dead')).toBe(true);
        expect(watcher._clearOpponentDeathState).not.toHaveBeenCalled();
        expect(watcher._showOpponentDeathAnimation).toHaveBeenCalledTimes(1);
    });

    it('comes back with the next round', () => {
        const watcher = makeWatcher();
        watcher.knockOutOpponent('P2', 'Mika');
        watcher.clearOpponentEffectStates();
        watcher.updateFromState([snapshot('P2')]);
        const board = watcher.playerBoards.get('P2');
        expect(board.isEliminated).toBe(false);
        expect(board.element.classList.contains('dead')).toBe(false);
        expect(watcher._clearOpponentDeathState).toHaveBeenCalledWith(board);
    });

    it('never knocks out a late joiner waiting for the next round', () => {
        const watcher = makeWatcher();
        watcher.playerBoards.get('P3').isWaiting = true;
        watcher.knockOutOpponent('P3', null);
        expect(watcher._showOpponentDeathAnimation).not.toHaveBeenCalled();
    });

    it('keeps a small station\'s name readable: the frag count as a number alone', () => {
        const watcher = makeWatcher();
        const board = watcher.playerBoards.get('P2');
        board._hud.fragsEl = { textContent: '' };
        watcher.updateFromState([snapshot('P2', { frags: 3 })]);
        expect(board._hud.fragsEl.textContent).toBe('3 frags');
        watcher._fieldLayout = { block: 9, rows: 2, columns: 4 };
        watcher.updateFromState([snapshot('P2', { frags: 3 })]);
        expect(board._hud.fragsEl.textContent).toBe('3');
    });

    it('hands the victory its well and its light', () => {
        const watcher = makeWatcher();
        expect(watcher.getBoardFrame('P3')).toEqual({ id: 'frame-P3' });
        expect(watcher.getBoardFrame('P9')).toBeNull();
        watcher.celebrateOpponent('P3', '#22d3ee');
        expect(watcher._boardEffects.get('P3').triggerVictory).toHaveBeenCalledWith('#22d3ee');
    });
});

function makeMode() {
    return Object.assign(Object.create(OnlineMultiplayerMode.prototype), {
        steamNetworking: { steamId: 'LOCAL' },
        playerColors: new Map([['LOCAL', '#ffac88'], ['P2', '#22d3ee']]),
        ffaGameState: { players: new Map([['P2', { name: 'Mika' }], ['LOCAL', { name: 'Me' }]]) },
        roundNumber: 2,
        killFeed: null,
        matchResultsModal: { isVisible: false },
        _victoryBeatTimer: null,
        hud: {
            announceRound: vi.fn(),
            showVictory: vi.fn(),
            victoryBeatMs: () => 2400,
            updateMatchBar: vi.fn(),
            updateStats: vi.fn(),
        },
        scoreboard: { updatePlayers: vi.fn() },
        opponentWatchManager: {
            knockOutOpponent: vi.fn(),
            getBoardFrame: vi.fn(() => ({ id: 'frame-P2' })),
            celebrateOpponent: vi.fn(),
        },
        mainBoardScene: { sharedEffects: { playRoundWin: vi.fn(), playVictory: vi.fn() } },
        _presentMatchResults: vi.fn(),
        _showDeathAnimation: vi.fn(),
    });
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('online versus: the round', () => {
    it('knocks an opponent out from the death message, and you from yours', () => {
        const mode = makeMode();
        mode._handlePlayerDeath({ player: 'P2', killer: 'LOCAL', killerName: 'Me' });
        expect(mode.opponentWatchManager.knockOutOpponent).toHaveBeenCalledWith('P2', 'Me');
        mode._handlePlayerDeath({ player: 'LOCAL', killer: 'P2', killerName: 'Mika' });
        expect(mode._showDeathAnimation).toHaveBeenCalledWith('Mika');
        expect(mode.opponentWatchManager.knockOutOpponent).toHaveBeenCalledTimes(1);
    });

    it('announces who took the round, and celebrates on your board when it was you', () => {
        const mode = makeMode();
        mode._onRoundOver({ winner: { steamId: 'P2', name: 'Mika' } });
        expect(mode.hud.announceRound).toHaveBeenLastCalledWith(2, { name: 'Mika', color: '#22d3ee', isYou: false });
        expect(mode.mainBoardScene.sharedEffects.playRoundWin).not.toHaveBeenCalled();

        mode._onRoundOver({ winner: { steamId: 'LOCAL', name: 'Me' } });
        expect(mode.hud.announceRound).toHaveBeenLastCalledWith(2, { name: 'Me', color: '#ffac88', isYou: true });
        expect(mode.mainBoardScene.sharedEffects.playRoundWin).toHaveBeenCalledWith({ color: '#ffac88' });

        mode._onRoundOver({ winner: null });
        expect(mode.hud.announceRound).toHaveBeenLastCalledWith(2, null);
    });
});

describe('online versus: the round\'s last word', () => {
    // Every loop stops as a round ends: its last knock-out and frag reach the stage only
    // in the host's final stats.
    const finalStats = [
        { steamId: 'LOCAL', name: 'Me', frags: 3, score: 900, lines: 7, isAlive: true },
        { steamId: 'P2', name: 'Mika', frags: 1, score: 400, lines: 2, isAlive: false },
    ];

    it('puts the round\'s final standings on the rail, the bar and your plate', () => {
        const mode = makeMode();
        mode._onRoundOver({ winner: { steamId: 'LOCAL', name: 'Me' }, finalStats });
        const [rows] = mode.scoreboard.updatePlayers.mock.calls[0];
        expect(rows.find((r) => r.id === 'P2')).toMatchObject({ isAlive: false, frags: 1, color: '#22d3ee' });
        expect(mode.hud.updateMatchBar).toHaveBeenCalledWith(rows, 2, undefined, 2);
        expect(mode.hud.updateStats).toHaveBeenCalledWith(finalStats[0], undefined);
        // Held against the last frames until the next round starts.
        expect(mode._standingsFinal).toBe(true);
    });

    it('does the same as the match is won', () => {
        const mode = makeMode();
        mode._handleMatchResults({ isGameOver: true, winner: { steamId: 'P2', name: 'Mika' }, finalStats });
        expect(mode.scoreboard.updatePlayers).toHaveBeenCalledTimes(1);
        expect(mode._standingsFinal).toBe(true);
    });

    it('leaves the stage alone when the host sent no stats', () => {
        const mode = makeMode();
        mode._onRoundOver({ winner: null, finalStats: [] });
        expect(mode.scoreboard.updatePlayers).not.toHaveBeenCalled();
        expect(mode._standingsFinal).toBeUndefined();
    });
});

describe('online versus: the match won', () => {
    it('holds on the boards with a crest over the winner\'s well, then the results', () => {
        const mode = makeMode();
        const detail = { isGameOver: true, winner: { steamId: 'P2', name: 'Mika' }, winnerName: 'Mika' };
        mode._handleMatchResults(detail);
        expect(mode.hud.showVictory).toHaveBeenCalledWith({ id: 'frame-P2' }, { name: 'Mika', color: '#22d3ee', isYou: false });
        expect(mode.opponentWatchManager.celebrateOpponent).toHaveBeenCalledWith('P2', '#22d3ee');
        expect(mode._presentMatchResults).not.toHaveBeenCalled();

        // The match's end heard twice (the host's broadcast and the local event): one beat.
        mode._handleMatchResults(detail);
        expect(mode.hud.showVictory).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(2399);
        expect(mode._presentMatchResults).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(mode._presentMatchResults).toHaveBeenCalledWith(detail);
        expect(mode._victoryBeatTimer).toBeNull();
    });

    it('crowns your own well when you win', () => {
        const wrapper = { id: 'your-well' };
        vi.stubGlobal('document', { querySelector: vi.fn(() => wrapper) });
        const mode = makeMode();
        mode._handleMatchResults({ isGameOver: true, winner: { steamId: 'LOCAL', name: 'Me' } });
        expect(document.querySelector).toHaveBeenCalledWith('#online-player-card .player-board-wrapper');
        expect(mode.hud.showVictory).toHaveBeenCalledWith(wrapper, { name: 'Me', color: '#ffac88', isYou: true });
        expect(mode.mainBoardScene.sharedEffects.playVictory).toHaveBeenCalledWith({ color: '#ffac88' });
        expect(mode.opponentWatchManager.celebrateOpponent).not.toHaveBeenCalled();
    });

    it('waits for the match itself to be over', () => {
        const mode = makeMode();
        mode._handleMatchResults({ isGameOver: false, winner: { steamId: 'P2' } });
        expect(mode.hud.showVictory).not.toHaveBeenCalled();
        vi.advanceTimersByTime(5000);
        expect(mode._presentMatchResults).not.toHaveBeenCalled();
    });
});

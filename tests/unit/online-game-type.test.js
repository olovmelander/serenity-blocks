/* eslint-disable import/first, max-classes-per-file */
/**
 * The online game type as players meet it: chosen on the create sheet (free-for-all by
 * default), kept in the match config, named in the waiting room and the match bar, and
 * played out on your own board and the field (versus-rules.js, multiplayer/ffa/respawn.js).
 */
import { readFileSync } from 'node:fs';
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({ BoardJuice: class BoardJuice {} }));
vi.mock('../../src/core/multiplayer/ffa-p2p-game-state.js', () => ({
    FFAGameStateP2P: class FFAGameStateP2P {
        constructor(network, localPlayerId) {
            Object.assign(this, { network, localPlayerId, players: new Map() });
        }

        cleanup() {}
    },
}));

import { looseNode } from './helpers/loose-dom.js';
import { OnlineMultiplayerMode } from '../../src/core/game-modes/OnlineMultiplayerMode.js';
import { OpponentWatchManager } from '../../src/ui/opponent-watch-manager.js';
import { GAME_TYPE_HELP } from '../../src/ui/match-config-modal.js';
import { describeVersusGameType, RESPAWN_AFTER_MS } from '../../src/core/multiplayer/versus-rules.js';
import { createOnlineInputHooks } from '../../src/core/game-modes/online-input-hooks.js';
import { installOnlineFixedKeyboardAdapter } from '../../src/core/multiplayer/online-fixed-input.js';
import { GameState, spawnPiece } from '../../src/core/game.js';

const source = (file) => readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8');

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('choosing the game type', () => {
    it('offers free-for-all, chosen, and survivor, each saying how it plays', () => {
        const sheet = source('ui/match-config-modal.js');
        expect(sheet).toContain('<option value="ffa" selected>Free-for-all</option>');
        expect(sheet).toContain('<option value="survivor">Survivor</option>');
        expect(sheet).toContain("gameType: formData.get('gameType') === 'survivor' ? 'survivor' : 'ffa',");
        expect(sheet).toContain("this.updateGameTypeUI('ffa');");
        expect(GAME_TYPE_HELP).toEqual({
            ffa: 'Frag your opponents. When you die, press any of your keys to play again.',
            survivor: 'The last player standing takes the round, then everybody restarts.',
        });
    });

    it('is named in a word, and the waiting room names it', () => {
        expect(describeVersusGameType(undefined)).toBe('Free-for-all');
        expect(describeVersusGameType({ gameType: 'ffa' })).toBe('Free-for-all');
        expect(describeVersusGameType({ gameType: 'survivor' })).toBe('Survivor');
        const room = source('ui/lobby-waiting-room.js');
        expect(room).toContain('<dd class="info-value" id="game-type-value">');
        expect(room).toContain("this.setText('game-type-value', describeVersusGameType(config));");
    });

    it.each([
        [{ gameType: 'survivor' }, 'survivor'],
        [{ gameType: 'ffa' }, 'ffa'],
        [{}, 'ffa'],
    ])('the host keeps the choice in its match config (%o)', async (choice, expected) => {
        const mode = Object.create(OnlineMultiplayerMode.prototype);
        mode.steamNetworking = { steamId: 'H0', createLobby: vi.fn(async () => 'L1') };
        mode._configureLocalInputHooks = vi.fn();
        mode._setLobbyRichPresence = vi.fn();
        mode.showWaitingRoom = vi.fn();
        await mode.handleCreateLobby({ endCondition: 'frags', endConditionValue: 10, ...choice });
        expect(mode.ffaGameState.matchConfig.gameType).toBe(expected);
    });
});

/** The documents the death UI touches, by id. */
function installBoardDom() {
    const nodes = new Map();
    const byId = (id) => {
        if (!nodes.has(id)) {
            const node = looseNode();
            // Cards are found by their class among the board's children.
            node.querySelector = (selector) => node.children
                .find((child) => !child.removed
                    && ` ${child.className} `.includes(` ${selector.replace(/^\./, '')} `)) || null;
            nodes.set(id, node);
        }
        return nodes.get(id);
    };
    vi.stubGlobal('document', {
        getElementById: byId,
        createElement: (tag) => looseNode(tag),
        querySelector: () => null,
    });
    return byId;
}

/** The text of the card a container shows (status cards are spans in a div). */
const cardText = (container) => container.children
    .flatMap((card) => card.children.map((line) => line.textContent));

function makeMode(gameType) {
    return Object.assign(Object.create(OnlineMultiplayerMode.prototype), {
        steamNetworking: { steamId: 'LOCAL' },
        ffaGameState: {
            matchConfig: { gameType },
            players: new Map([['LOCAL', { name: 'Me', _respawnSeq: 0 }], ['P2', { name: 'Mika', _respawnSeq: 0 }]]),
        },
        roundNumber: 1,
        opponentWatchManager: { maxVisible: 4, setMaxVisible: vi.fn() },
        mainBoardScene: { sharedEffects: { playKnockout: vi.fn(), clearKnockout: vi.fn() } },
    });
}

describe('your knock-out', () => {
    it('in a free-for-all: your board stays in front of you, dark, and says how to play again', () => {
        const byId = installBoardDom();
        const mode = makeMode('ffa');
        mode._showDeathAnimation('Mika');
        expect(mode.mainBoardScene.sharedEffects.playKnockout).toHaveBeenCalled();
        expect(mode._deadSpectating).toBeFalsy(); // not the watch-everyone view
        expect(mode.opponentWatchManager.setMaxVisible).not.toHaveBeenCalled();

        vi.advanceTimersByTime(RESPAWN_AFTER_MS - 1);
        expect(cardText(byId('online-main-board'))).toEqual([]);
        vi.advanceTimersByTime(1); // the card rises as a key starts to work
        expect(cardText(byId('online-main-board'))).toEqual(['Out', 'By Mika', 'Press any key to play again']);

        // Back in play: the card and the dark go.
        mode._reconcileDeathOverlay(true);
        expect(mode._deathShown).toBe(false);
        expect(mode.mainBoardScene.sharedEffects.clearKnockout).toHaveBeenCalled();
    });

    it('in survivor: you watch everyone still in until the round ends', () => {
        const byId = installBoardDom();
        const mode = makeMode('survivor');
        mode._showDeathAnimation(null);
        expect(mode._deadSpectating).toBe(true);
        expect(mode.opponentWatchManager.setMaxVisible).toHaveBeenCalledWith(8);
        vi.advanceTimersByTime(600);
        expect(cardText(byId('online-main-board'))).toEqual(['Out', 'Topped out', 'Watching until the round ends']);
    });

    it('a free-for-all drop-in is asked to press a key, and its banner goes when it is in', () => {
        const byId = installBoardDom();
        const mode = makeMode('ffa');
        mode._enterDeadSpectate();
        expect(cardText(byId('online-main-board'))).toEqual(['Join in', 'Joined mid-match', 'Press any key to play']);
        mode._reconcileDeathOverlay(true);
        expect(mode._deadSpectating).toBe(false);
    });

    it('names each free-for-all death apart in the battle log, the same on every client', () => {
        const mode = makeMode('ffa');
        expect(mode._deathEventId('P2')).toBe('death:P2:1');
        mode.ffaGameState.players.get('P2')._respawnSeq = 2;
        expect(mode._deathEventId('P2')).toBe('death:P2:1:2');
    });
});

describe('an opponent back in play', () => {
    function makeWatcher() {
        const classes = new Set();
        const board = {
            playerKey: 'P2',
            isEliminated: false,
            isWaiting: false,
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
        const watcher = Object.assign(Object.create(OpponentWatchManager.prototype), {
            playerBoards: new Map([['P2', board]]),
            _boardEffects: new Map([['P2', { setDeadState: vi.fn() }]]),
            _knockedOut: new Map(),
            _lastNextPieces: new Map(),
            allPlayers: [],
            localPlayerId: 'LOCAL',
            autoWatchEnabled: false,
        });
        watcher._showOpponentDeathAnimation = vi.fn();
        watcher._clearOpponentDeathState = vi.fn();
        watcher._ensureOpponentDeathOverlay = vi.fn();
        watcher._getBoardHudNodes = vi.fn((b) => b._hud);
        watcher._maybeTriggerSettledBoardPulse = vi.fn();
        watcher._updateGarbageMeter = vi.fn();
        watcher._updateSelectionList = vi.fn();
        return { watcher, board };
    }

    it('lights up again, and the next frames keep it lit', () => {
        const { watcher, board } = makeWatcher();
        watcher.knockOutOpponent('P2', 'Me');
        expect(board.isEliminated).toBe(true);

        watcher.reviveOpponent('P2');
        expect(board.isEliminated).toBe(false);
        expect(board.element.classList.contains('dead')).toBe(false);
        expect(watcher._clearOpponentDeathState).toHaveBeenCalledWith(board);
        watcher.updateFromState([{ id: 'P2', isAlive: true, frags: 0 }]);
        expect(board.isEliminated).toBe(false); // the knock-out is forgotten, not held
    });
});

describe('your keys while you are out', () => {
    function boardWithPiece() {
        const gameState = new GameState();
        gameState.nextPieces = ['O', 'I', 'T', 'S', 'Z', 'J', 'L'];
        spawnPiece(gameState, null, null);
        return gameState;
    }

    it('ask to play again and play nothing; in play they play', () => {
        const gameState = boardWithPiece();
        const send = vi.fn();
        let out = true;
        const respawn = vi.fn(() => out);
        const hooks = createOnlineInputHooks({
            send, gameState: () => gameState, juice: () => null, respawn,
        });
        expect(hooks.move(-1)).toBe(false); // and so no auto-repeat
        hooks.rotate('right');
        hooks.hardDrop();
        expect(hooks.softDrop()).toBe(false);
        expect(respawn).toHaveBeenCalledTimes(4);
        expect(send).not.toHaveBeenCalled();

        out = false;
        expect(hooks.move(-1)).toBe(true);
        hooks.hardDrop();
        expect(send.mock.calls.map(([type]) => type)).toEqual(['move', 'drop']);
    });

    it('reach those hooks under the fixed clock too: its key adapter lets them through', () => {
        const inputController = { setFixedTickInputAdapter(adapter) { this.fixedTickInputAdapter = adapter; } };
        let out = false;
        const game = {
            isSpectator: false,
            _fixedTickEnabled: true,
            gamePhase: 'playing',
            waitsToRespawn: () => out,
            players: new Map(),
        };
        const mode = { deps: { inputController }, ffaGameState: game, isInMatch: true };
        installOnlineFixedKeyboardAdapter(mode, game);
        const adapter = inputController.fixedTickInputAdapter;
        expect(adapter.isEnabled({ playerIndex: 0 })).toBe(true);
        out = true;
        expect(adapter.isEnabled({ playerIndex: 0 })).toBe(false);
    });
});

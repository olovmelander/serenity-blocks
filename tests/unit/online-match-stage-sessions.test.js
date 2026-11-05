/* eslint-disable import/first */
/**
 * The online mode's instance is cached for the whole app run, so what one session leaves behind
 * meets the next one. Each of these left the next match running with no stage: inputs hooked and
 * the game live, but no boards, the waiting room up and the match container hidden.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({
    BoardJuice: class BoardJuice {},
}));

import { OnlineMultiplayerMode } from '../../src/core/game-modes/OnlineMultiplayerMode.js';
import { emitMultiplayerEvent, MULTIPLAYER_EVENTS } from '../../src/events/multiplayer-events.js';

/** The real session lifecycle; only what draws or reaches the DOM's far corners is stubbed. */
const STUBBED_METHODS = [
    '_hideOtherContainers', '_createOpponentBoards', '_initializeRightPanel',
    '_registerNetworkHandlers', '_setupInputHandlers', '_setupScoreboardOverlayHotkey',
    '_clearDeathState', '_suspendThemeForMatch', '_hookInputs', '_setupVisibilityHandler',
    '_clearLobbyRichPresence',
];

function makeMode() {
    const mode = new OnlineMultiplayerMode({});
    STUBBED_METHODS.forEach((name) => { mode[name] = vi.fn(); });
    mode.hud = { reset: vi.fn(), setPlayerName: vi.fn() };
    mode.boards = 0;
    mode.boardDelay = null;
    mode._createMainBoard = vi.fn(async () => {
        mode.boards += 1;
        mode.mainPhaserGame = { destroy: vi.fn() };
        if (mode.boardDelay) await mode.boardDelay;
    });
    return mode;
}

/** What a lobby entry gives the cached mode, a fresh game state each session. */
function enterLobby(mode) {
    mode.ffaGameState = { cleanup: vi.fn(), players: new Map() };
    mode.lobbyWaitingRoom = { show: vi.fn(), hide: vi.fn(), gameState: null };
    mode.showWaitingRoom();
}

async function prepareMatch() {
    emitMultiplayerEvent(MULTIPLAYER_EVENTS.MATCH_PREPARING, {});
    await vi.waitFor(() => {});
}

describe('the online match stage across sessions', () => {
    let container;

    beforeEach(() => {
        container = { style: { display: 'none' }, classList: { add: vi.fn(), remove: vi.fn() } };
        const getElementById = (id) => (id === 'online-multiplayer-container' ? container : null);
        vi.stubGlobal('document', {
            getElementById,
            querySelector: () => null,
            querySelectorAll: () => [],
            addEventListener: () => {},
            removeEventListener: () => {},
            createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }),
            body: { classList: { add() {}, remove() {} }, appendChild() {} },
            documentElement: { style: {} },
        });
        vi.stubGlobal('window', globalThis);
        vi.stubGlobal('addEventListener', () => {});
        vi.stubGlobal('removeEventListener', () => {});
        vi.stubGlobal('dispatchEvent', () => {});
        vi.stubGlobal('CustomEvent', class { constructor(type, init) { this.type = type; this.detail = init?.detail; } });
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('sets the match up in a session after an exit to the menu', async () => {
        const mode = makeMode();
        enterLobby(mode);
        await prepareMatch();
        expect(mode.boards).toBe(1);

        await mode.onDeactivate();

        enterLobby(mode);
        await prepareMatch();
        expect(mode.boards).toBe(2);
        expect(container.style.display).toBe('grid');
        expect(mode.lobbyWaitingRoom.hide).toHaveBeenCalled();
        await mode.onDeactivate();
    });

    it('answers one MATCH_PREPARING once, however many sessions came before', async () => {
        const mode = makeMode();
        enterLobby(mode);
        await mode.onDeactivate();
        enterLobby(mode);
        await mode.onDeactivate();
        enterLobby(mode);

        await prepareMatch();

        expect(mode.boards).toBe(1);
        await mode.onDeactivate();
    });

    it('builds the next match for a drop-in whose match went live while its board loaded', async () => {
        const mode = makeMode();
        let boardReady;
        mode.boardDelay = new Promise((resolve) => { boardReady = resolve; });
        mode.ffaGameState = { isSpectator: false, players: new Map(), getLocalPlayer: () => null };
        mode.steamNetworking = { steamId: 'P9', playerName: 'P9' };

        // A drop-in has no countdown: the match activates inside setup's await on the board.
        const setup = mode._setupMatchUI();
        mode._activateMatch();
        boardReady();
        await setup;
        expect(mode.isInMatch).toBe(true);

        // Its results tear the stage down, and the host starts the next match.
        mode._cleanupGameRendering();
        mode.isInMatch = false;
        mode.boardDelay = null;
        await mode._setupMatchUI();

        expect(mode.boards).toBe(2);
        expect(container.style.display).toBe('grid');
    });

    it('takes the stage down when the player leaves during the countdown', async () => {
        const mode = makeMode();
        enterLobby(mode);
        await prepareMatch();
        const board = mode.mainPhaserGame;
        expect(container.style.display).toBe('grid');
        expect(mode.isInMatch).toBe(false); // the countdown is still running

        await mode.onDeactivate();

        expect(board.destroy).toHaveBeenCalledOnce();
        expect(mode.mainPhaserGame).toBeNull();
        expect(container.style.display).toBe('none');

        enterLobby(mode);
        await prepareMatch();
        expect(mode.boards).toBe(2);
        await mode.onDeactivate();
    });

    it('builds the next match after a return to the lobby during the countdown', async () => {
        const mode = makeMode();
        enterLobby(mode);
        await prepareMatch();

        mode._returnToLobbyLocal();

        await prepareMatch();
        expect(mode.boards).toBe(2);
        expect(container.style.display).toBe('grid');
        await mode.onDeactivate();
    });

    it('still skips a repeat setup while the countdown waits on a stage that is up', async () => {
        const mode = makeMode();
        enterLobby(mode);
        await prepareMatch();

        await prepareMatch();

        expect(mode.boards).toBe(1);
        await mode.onDeactivate();
    });

    it('leaves from the lobby, with no stage ever built, without a fault', async () => {
        const mode = makeMode();
        enterLobby(mode);

        await expect(mode.onDeactivate()).resolves.toBeUndefined();

        expect(mode.isInMatch).toBe(false);
        expect(mode._uiSetupComplete).toBe(false);
    });
});

/**
 * Local versus, free-for-all (the default game type): a death is not the end of a player's
 * match. The death counts, the frag goes to whoever held the frag credit, the round goes on for
 * everyone else, and the player comes back on an empty well (score and lines kept): a person
 * with any of their own keys a second after dying, a bot on its own. The frag goal counts kills
 * and ends the match the moment it is met. Survivor keeps the rounds.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import {
    BOT_RESPAWN_MS, LocalMultiplayerMode, RESPAWN_KEY_HOLD_MS, ROUND_OUTCOME_MS,
} from '../../src/core/game-modes/LocalMultiplayerMode.js';
import { captureLocalMultiplayerRound } from '../../src/core/game-modes/local-multiplayer-loop.js';
import { localMatchRespawns } from '../../src/core/game-modes/local-match-rules.js';
import { MultiPlayerState } from '../../src/core/multi-player-state.js';
import { LocalBotManager } from '../../src/core/ai/local-bot-manager.js';
import { COLS, HIDDEN_ROWS, ROWS } from '../../src/core/constants.js';
import { columnsToMask } from '../../src/core/garbage.js';
import { applyVersusFeel, VERSUS_MAX_PENDING_LINES } from '../../src/core/multiplayer/versus-rules.js';
import { InputController, setupKeyboardControls } from '../../src/ui/controls.js';
import { GamepadController } from '../../src/ui/gamepad-controller.js';
import { eventBus } from '../../src/events/event-bus.js';
import { MULTIPLAYER_EVENTS } from '../../src/events/multiplayer-events.js';

const moduleMocks = vi.hoisted(() => ({ showLocalMatchEnd: vi.fn() }));

vi.mock('phaser', () => ({
    default: { Game: vi.fn(), WEBGL: 'webgl', Scale: { FIT: 1, CENTER_BOTH: 1 } },
}));
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({ BoardJuice: vi.fn() }));
vi.mock('../../src/ui/cinematic-loading-overlay.js', () => ({
    dismissCinematicLoadingOverlay: vi.fn(() => Promise.resolve()),
    showCinematicLoadingOverlay: vi.fn(),
    waitForCinematicLoadingOverlayPresented: vi.fn(() => Promise.resolve()),
    transitionCinematicLoadingOverlayToCountdown: vi.fn(),
    setCinematicLoadingProgress: vi.fn(),
}));
vi.mock('../../src/ui/intro-animation.js', () => ({ introAnimation: { dismiss: vi.fn() } }));
vi.mock('../../src/ui/local-match-end-overlay.js', () => ({ showLocalMatchEnd: moduleMocks.showLocalMatchEnd }));

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    moduleMocks.showLocalMatchEnd.mockReset();
});

const BOTTOM = ROWS + HIDDEN_ROWS - 1;

/** A stack that fills the whole well: the next piece cannot appear. */
const solidStack = () => ({
    pieceId: 'stack',
    shapeKey: 'I',
    color: '#ffffff',
    x: 0,
    y: 0,
    shape: Array.from({ length: BOTTOM + 1 }, () => Array(COLS).fill(1)),
});

/** A clear of `depth` rows that sends `depth - 1` rows of garbage. */
const clear = (depth) => ({
    depth,
    complexity: 1,
    manualColumns: [0],
    holeMask: Array.from({ length: depth }, () => columnsToMask([0])),
});

/**
 * A local match in play on the legacy (rAF) clock, every board with its first piece, the
 * result screens and round restarts stubbed.
 */
function versusMode(numPlayers, config = {}) {
    const mode = Object.create(LocalMultiplayerMode.prototype);
    mode.isRunning = true;
    mode.isActive = true;
    mode.isPaused = false;
    mode.matchConfig = {
        isInfinityLMS: false,
        numPlayers,
        endCondition: 'frags',
        endConditionValue: 7,
        startLevel: 1,
        levelProgression: false,
        ...config,
    };
    const state = new MultiPlayerState(numPlayers, { maxPendingLines: VERSUS_MAX_PENDING_LINES });
    state.players.forEach(applyVersusFeel);
    state.setMatchConfig(mode.matchConfig);
    state.reset();
    mode.multiplayerState = state;
    mode._initializeSharedPieceRng(11);
    state.isPaused = false;
    mode.matchStats = {};
    mode.matchStartTime = Date.now();
    mode.roundStartTime = mode.matchStartTime;
    mode.boardScenes = [];
    mode._startGeneration = 1;
    mode._localSimulationLoop = { fixedTickEnabled: false, transitionGeneration: 1 };
    mode._showPlayerDeathAnimation = vi.fn();
    mode._showVictoryAnimation = vi.fn();
    mode._showMatchEnd = vi.fn(() => Promise.resolve());
    mode._startNewRound = vi.fn(() => Promise.resolve());
    mode.handleRoundEnd = vi.fn(() => Promise.resolve());
    state.players.forEach((_, i) => mode._spawnFirstPiece(i));
    return mode;
}

/**
 * Top a player out the real way: the stack fills the well and their next piece cannot appear.
 * The spawn reports it to _handleGameOver (as a new round's first spawn does).
 */
async function topOut(mode, index) {
    const player = mode.multiplayerState.players[index];
    player.currentPiece = null;
    player.lockedPieces = [solidStack()];
    player.boardCacheDirty = true;
    const gameOver = vi.spyOn(mode, '_handleGameOver');
    mode._spawnFirstPiece(index);
    const reported = gameOver.mock.results.at(-1)?.value;
    gameOver.mockRestore();
    await reported;
}

const isEmptyWell = (player) => player.lockedPieces.length === 0
    && player.boardGrid.every((row) => row.every((cell) => cell === null));

describe('shared couch presentation', () => {
    it('shows each human knockout and successful return once, while the bot still respawns', async () => {
        vi.useFakeTimers();
        const mode = versusMode(2, { playerSlots: [{ kind: 'bot' }, { kind: 'human' }] });
        mode._showPlayerDeathAnimation = LocalMultiplayerMode.prototype._showPlayerDeathAnimation;
        const delivered = vi.spyOn(eventBus, 'emit');

        await topOut(mode, 0);
        await topOut(mode, 1);
        await mode._handleGameOver(1);
        expect(mode._onSeatPress(1)).toBe(false);
        vi.advanceTimersByTime(RESPAWN_KEY_HOLD_MS);
        expect(mode._onSeatPress(1)).toBe(true);
        expect(mode._onSeatPress(1)).toBe(false);
        vi.advanceTimersByTime(BOT_RESPAWN_MS - RESPAWN_KEY_HOLD_MS);
        expect(mode.multiplayerState.players.every((player) => player.isAlive)).toBe(true);
        await topOut(mode, 1);

        const { PLAYER_TOPPED_OUT, PLAYER_RESPAWNED } = MULTIPLAYER_EVENTS;
        expect(delivered.mock.calls.filter(([event]) => [PLAYER_TOPPED_OUT, PLAYER_RESPAWNED].includes(event)))
            .toEqual([
                [PLAYER_TOPPED_OUT, { player: 2, isLocal: true }],
                [PLAYER_RESPAWNED, { player: 2, isLocal: true }],
                [PLAYER_TOPPED_OUT, { player: 2, isLocal: true }],
            ]);
    });

    it.each(['human', 'bot'])('reports shared outcomes according to the first seat (%s)', async (kind) => {
        vi.useFakeTimers();
        const mode = versusMode(3, {
            gameType: 'survivor',
            isTeamMode: true,
            playerTeams: [0, 1, 1],
            playerSlots: [{ kind }, { kind: 'bot' }, { kind: 'bot' }],
        });
        mode._startNewRound = LocalMultiplayerMode.prototype._startNewRound;
        mode._showMatchEnd = LocalMultiplayerMode.prototype._showMatchEnd;
        mode._startGameLoop = vi.fn();
        mode._setupLocalBots = vi.fn();
        mode._updateMultiplayerStats = vi.fn();
        mode.onStop = vi.fn();
        mode.playerNextCanvases = new Map();
        mode.deps = { soundManager: { sfxPlayer: {} } };
        mode.teamRoundWins = {};
        mode.roundWins = {};
        mode.versusRound = 1;
        const delivered = vi.spyOn(eventBus, 'emit');
        const target = new EventTarget();
        const ended = vi.fn();
        target.addEventListener('gameOver', ended);
        vi.stubGlobal('window', target);

        await mode._handleTeamRoundEnd(1);
        expect(mode.versusRound).toBe(2);
        const roundBeats = delivered.mock.calls.filter(([event]) => event === MULTIPLAYER_EVENTS.ROUND_OVER);
        expect(roundBeats).toHaveLength(kind === 'human' ? 1 : 0);
        if (roundBeats.length) expect(roundBeats[0][1]).toEqual({ round: 1, outcome: { teamId: 1 }, isLocal: true });
        expect(ended).not.toHaveBeenCalled();

        const winner = { type: 'team', teamId: 1 };
        const finalBeat = mode._showMatchEnd(winner);
        expect(ended).toHaveBeenCalledTimes(kind === 'human' ? 1 : 0);
        if (kind === 'human') expect(ended.mock.calls[0][0].detail).toEqual({ mode: 'local-multiplayer', winner });
        expect(delivered.mock.calls.some(([event]) => event === MULTIPLAYER_EVENTS.GAME_OVER)).toBe(false);
        await vi.advanceTimersByTimeAsync(2399);
        expect(moduleMocks.showLocalMatchEnd).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await finalBeat;
        expect(moduleMocks.showLocalMatchEnd).toHaveBeenCalledOnce();
    });
});

describe('free-for-all is the default game type', () => {
    it('respawns unless the match asks for survivor rounds or is Infinity\'s Last Standing', () => {
        expect(localMatchRespawns({})).toBe(true);
        expect(localMatchRespawns({ gameType: 'ffa' })).toBe(true);
        expect(localMatchRespawns({ gameType: 'survivor' })).toBe(false);
        expect(localMatchRespawns({ isInfinityLMS: true })).toBe(false);
        expect(localMatchRespawns(null)).toBe(false);
    });
});

describe('a free-for-all death', () => {
    it('counts the death, credits the frag holder and lets everyone else play on', async () => {
        vi.useFakeTimers();
        const mode = versusMode(3);
        const state = mode.multiplayerState;
        state.handleGarbageSummary(1, clear(4), null); // player 2 attacks players 1 and 3
        expect(state.lastAttackerIds[0]).toBe(1);

        await topOut(mode, 0);

        expect(state.deaths).toEqual([1, 0, 0]);
        expect(state.frags).toEqual([0, 1, 0]);
        expect(state.players.map((player) => player.isAlive)).toEqual([false, true, true]);
        // Nobody is paused and no round ends.
        expect(state.isPaused).toBe(false);
        expect(state.isGameOver).toBe(false);
        await vi.advanceTimersByTimeAsync(ROUND_OUTCOME_MS * 2);
        expect(mode.handleRoundEnd).not.toHaveBeenCalled();
        expect(mode._startNewRound).not.toHaveBeenCalled();
        expect(mode._showMatchEnd).not.toHaveBeenCalled();
        // The knock-out names the frag holder, and the garbage waiting for the dead is gone.
        expect(mode._showPlayerDeathAnimation).toHaveBeenCalledExactlyOnceWith(0, 1);
        expect(state.garbageQueues[0].getTotalLines()).toBe(0);
        expect(state.garbageQueues[2].getTotalLines()).toBeGreaterThan(0);
        expect(state.players[0].currentPiece).toBeNull();
    });

    it('awards no frag for a death nobody caused', async () => {
        const mode = versusMode(2);
        await topOut(mode, 1);
        expect(mode.multiplayerState.deaths).toEqual([0, 1]);
        expect(mode.multiplayerState.frags).toEqual([0, 0]);
        expect(mode._showPlayerDeathAnimation).toHaveBeenCalledExactlyOnceWith(1, null);
        expect(mode.multiplayerState.isPaused).toBe(false);
    });

    it('is counted once when the legacy path reports it twice (main.js, then the mode)', async () => {
        const mode = versusMode(2);
        const state = mode.multiplayerState;
        state.lastAttackerIds[0] = 1;
        state.players[0].isGameOver = true;

        state.handlePlayerDeath(0); // main.js endMultiplayerGame
        await mode._handleGameOver(0);
        await mode._handleGameOver(0);

        expect(state.deaths).toEqual([1, 0]);
        expect(state.frags).toEqual([0, 1]);
        expect(mode._showPlayerDeathAnimation).toHaveBeenCalledOnce();
    });

    it('on the fixed clock: a same-tick double death ends no round and pauses nobody', async () => {
        vi.useFakeTimers();
        const mode = versusMode(2);
        mode._localSimulationLoop.fixedTickEnabled = true;
        const roundOwner = captureLocalMultiplayerRound(mode);
        const state = mode.multiplayerState;
        state.lastAttackerIds = [1, 0];

        await expect(mode._handleFixedTickTopOutBatch([1, 0], roundOwner)).resolves.toBe(true);
        await vi.advanceTimersByTimeAsync(ROUND_OUTCOME_MS * 2);

        expect(state.frags).toEqual([1, 1]);
        expect(state.isPaused).toBe(false);
        expect(mode._startNewRound).not.toHaveBeenCalled();
        expect(mode.handleRoundEnd).not.toHaveBeenCalled();
        expect(mode._showPlayerDeathAnimation.mock.calls).toEqual([[0, 1], [1, 0]]);
    });
});

describe('a person plays again', () => {
    it('only with their own key, and only once the hold after the death has passed', async () => {
        vi.useFakeTimers();
        const mode = versusMode(2, { playerSlots: [{ kind: 'human' }, { kind: 'human' }] });
        const player = mode.multiplayerState.players[0];
        await topOut(mode, 0);

        vi.advanceTimersByTime(RESPAWN_KEY_HOLD_MS - 1);
        expect(mode._onSeatPress(0)).toBe(false); // a key held or mashed as they topped out
        expect(mode._onSeatPress(1)).toBe(false); // someone else's key
        expect(player.isAlive).toBe(false);

        vi.advanceTimersByTime(1);
        expect(mode._onSeatPress(0)).toBe(true);
        expect(player.isAlive).toBe(true);
        expect(player.currentPiece).not.toBeNull();
        expect(mode._onSeatPress(0)).toBe(false); // already back
        expect(mode.multiplayerState.deaths).toEqual([1, 0]);
    });

    it('comes back on an empty well that keeps their score, lines and pieces', async () => {
        vi.useFakeTimers();
        const mode = versusMode(2, { startLevel: 3 });
        const state = mode.multiplayerState;
        const player = state.players[0];
        Object.assign(player, { score: 4321, lines: 17, level: 6 });
        player.handicaps = { 1: 2 };
        state.crowdStamps[0] = 2;
        const pieces = player.piecesPlaced;
        mode._clearPlayerDeathAnimation = vi.fn();
        await topOut(mode, 0);
        state.garbageQueues[0].enqueue([{ type: 'line', attackId: 'late', holeMask: 1, isLastInBurst: true }]);

        vi.advanceTimersByTime(RESPAWN_KEY_HOLD_MS);
        expect(mode._onSeatPress(0)).toBe(true);

        expect(isEmptyWell(player)).toBe(true);
        expect(player).toMatchObject({
            score: 4321, lines: 17, level: 3, isAlive: true, isGameOver: false, lockStyle: 'gravity',
        });
        expect(player.piecesPlaced).toBe(pieces + 2); // the blocked piece and the new one
        expect(player.handicaps).toEqual({});
        expect(state.crowdStamps[0]).toBe(0);
        expect(state.garbageQueues[0].getTotalLines()).toBe(0);
        expect(state.lastAttackerIds[0]).toBeNull();
        expect(state.attackCredit[0].killer).toBeNull();
        expect(mode._clearPlayerDeathAnimation).toHaveBeenCalledExactlyOnceWith(0);
    });

    it('waits while the game is paused', async () => {
        vi.useFakeTimers();
        const mode = versusMode(2);
        await topOut(mode, 0);
        vi.advanceTimersByTime(RESPAWN_KEY_HOLD_MS);
        mode.isPaused = true;
        mode.multiplayerState.isPaused = true;
        expect(mode._onSeatPress(0)).toBe(false);
        mode.isPaused = false;
        mode.multiplayerState.isPaused = false;
        expect(mode._onSeatPress(0)).toBe(true);
    });

    it('never into a round that is no longer the one they died in', async () => {
        vi.useFakeTimers();
        const mode = versusMode(2);
        await topOut(mode, 0);
        mode._localSimulationLoop.transitionGeneration += 1; // the match was left or restarted
        vi.advanceTimersByTime(RESPAWN_KEY_HOLD_MS);
        expect(mode._onSeatPress(0)).toBe(false);
        expect(mode.multiplayerState.players[0].isAlive).toBe(false);
        expect(mode._downPlayers.size).toBe(0);
    });

    it('from a real key press, routed by the keyboard controller to its seat', async () => {
        vi.useFakeTimers();
        const listeners = new Map();
        vi.stubGlobal('document', {
            activeElement: null,
            hidden: false,
            addEventListener: (type, fn) => listeners.set(type, fn),
            removeEventListener: () => {},
            getElementById: () => null,
        });
        vi.stubGlobal('window', { settings: null });
        const bindings = {
            moveLeft: 'ArrowLeft', moveRight: 'ArrowRight', softDrop: 'ArrowDown', rotateRight: 'ArrowUp', hardDrop: 'Space',
        };
        const settings = {
            keyBindings: bindings,
            player2KeyBindings: {
                moveLeft: 'a', moveRight: 'd', softDrop: 's', rotateRight: 'w', hardDrop: 'Shift',
            },
            dasDelay: 100,
            dasInterval: 25,
        };
        window.settings = settings;
        const inputController = new InputController();
        setupKeyboardControls(inputController, settings, {
            requestMove: vi.fn(), requestHardDrop: vi.fn(), requestMoveP2: vi.fn(), isPlayer2KeyboardActive: () => true,
        });
        const press = (key) => {
            listeners.get('keydown')({ key, repeat: false, preventDefault: vi.fn() });
            listeners.get('keyup')({ key });
        };

        const mode = versusMode(2);
        mode.deps = { inputController };
        mode._setupInputWrappers();
        await topOut(mode, 0);
        vi.advanceTimersByTime(RESPAWN_KEY_HOLD_MS);

        press('a'); // player 2's key
        expect(mode.multiplayerState.players[0].isAlive).toBe(false);
        press('Space');
        expect(mode.multiplayerState.players[0].isAlive).toBe(true);

        mode._removeInputWrappers();
        expect(inputController.seatPressListener).toBeNull();
    });
});

describe('the input controllers tell each seat press', () => {
    it('the keyboard: after the press is handled, once per press, for the seat that owns the key', () => {
        const listeners = new Map();
        vi.stubGlobal('document', {
            activeElement: null,
            hidden: false,
            addEventListener: (type, fn) => listeners.set(type, fn),
            removeEventListener: () => {},
            getElementById: () => null,
        });
        vi.stubGlobal('window', { settings: null });
        const settings = {
            keyBindings: { moveLeft: 'ArrowLeft', hardDrop: 'Space' },
            player2KeyBindings: { moveLeft: 'a' },
            dasDelay: 100,
            dasInterval: 25,
        };
        window.settings = settings;
        const controller = new InputController();
        const order = [];
        setupKeyboardControls(controller, settings, {
            requestMove: vi.fn(() => order.push('move')),
            requestHardDrop: vi.fn(() => order.push('drop')),
            requestMoveP2: vi.fn(() => order.push('move p2')),
            isPlayer2KeyboardActive: () => true,
        });
        controller.setSeatPressListener((seat, action) => order.push(`seat ${seat} ${action}`));
        const down = (key, repeat = false) => listeners.get('keydown')({ key, repeat, preventDefault: vi.fn() });

        down('ArrowLeft');
        down('ArrowLeft', true); // a browser repeat is no press
        down('a');
        down('Space');

        expect(order).toEqual([
            'move', 'seat 0 moveLeft', 'move p2', 'seat 1 moveLeft', 'drop', 'seat 0 hardDrop',
        ]);
    });

    it('the keyboard on the fixed clock: a dead board takes no input, its seat still hears the key', () => {
        const listeners = new Map();
        vi.stubGlobal('document', {
            activeElement: null,
            hidden: false,
            addEventListener: (type, fn) => listeners.set(type, fn),
            removeEventListener: () => {},
            getElementById: () => null,
        });
        vi.stubGlobal('window', { settings: null });
        const settings = {
            keyBindings: { hardDrop: 'Space' }, player2KeyBindings: {}, dasDelay: 100, dasInterval: 25,
        };
        window.settings = settings;
        const controller = new InputController();
        setupKeyboardControls(controller, settings, { requestHardDrop: vi.fn() });
        const mode = versusMode(2);
        const dead = mode.multiplayerState.players[0];
        dead.isAlive = false;
        controller.setFixedTickInputAdapter({
            isEnabled: () => true,
            resolveGameState: (index) => mode.multiplayerState.players[index],
        });
        const heard = vi.fn();
        controller.setSeatPressListener(heard);

        listeners.get('keydown')({ key: 'Space', repeat: false, preventDefault: vi.fn() });

        expect(dead.playerInput.pendingEdges).toEqual([]);
        expect(heard).toHaveBeenCalledExactlyOnceWith(0, 'hardDrop');
    });

    it('the controller: a new button press, not a held one', () => {
        const controller = new GamepadController();
        controller.enabled = true;
        controller.setGameActions({
            moveP3: vi.fn(), rotateP3: vi.fn(), softDropP3: vi.fn(), hardDropP3: vi.fn(), togglePause: vi.fn(),
        });
        const heard = vi.fn();
        controller.setSeatPressListener(heard);
        const pad = {
            buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
            axes: [0, 0, 0, 0],
        };

        pad.buttons[0].pressed = true; // A
        controller.processGamepadInput(pad, 2);
        controller.processGamepadInput(pad, 2); // still held
        pad.buttons[0].pressed = false;
        controller.processGamepadInput(pad, 2);
        pad.buttons[14].pressed = true; // d-pad left
        controller.processGamepadInput(pad, 2);

        expect(heard.mock.calls).toEqual([[2, 'rotateRight'], [2, 'moveLeft']]);
    });
});

describe('a bot plays again on its own', () => {
    function botActions() {
        return {
            moveLeft: vi.fn(() => true),
            moveRight: vi.fn(() => true),
            rotateLeft: vi.fn(() => true),
            rotateRight: vi.fn(() => true),
            rotateFlip: vi.fn(() => true),
            softDrop: vi.fn(() => true),
            hardDrop: vi.fn(() => true),
        };
    }

    it('after BOT_RESPAWN_MS, keys or no keys, and its controller drives the new well', async () => {
        vi.useFakeTimers();
        const slots = [{ kind: 'human' }, { kind: 'bot', difficulty: 5 }];
        const mode = versusMode(2, { playerSlots: slots });
        const actions = botActions();
        mode.botManager = new LocalBotManager({ multiplayerState: mode.multiplayerState, actionFactory: () => actions });
        mode.botManager.configure(slots, 5);
        const resetPlayer = vi.spyOn(mode.botManager, 'resetPlayer');
        const bot = mode.multiplayerState.players[1];
        let now = 0;
        const play = (ms) => {
            for (let t = 0; t < ms; t += 50) {
                now += 50;
                mode.botManager.update(50, now);
            }
        };
        const acted = () => Object.values(actions).some((action) => action.mock.calls.length > 0);

        await topOut(mode, 1);
        play(3000);
        expect(acted()).toBe(false); // a dead board is not driven
        vi.advanceTimersByTime(RESPAWN_KEY_HOLD_MS);
        expect(mode._onSeatPress(1)).toBe(false); // a bot's seat never answers keys

        vi.advanceTimersByTime(BOT_RESPAWN_MS - RESPAWN_KEY_HOLD_MS - 1);
        expect(bot.isAlive).toBe(false);
        vi.advanceTimersByTime(1);
        expect(bot.isAlive).toBe(true);
        expect(isEmptyWell(bot)).toBe(true);
        expect(resetPlayer).toHaveBeenCalledExactlyOnceWith(1);

        play(10000);
        expect(acted()).toBe(true);
    });

    it('waits out a pause before it comes back', async () => {
        vi.useFakeTimers();
        const mode = versusMode(2, { playerSlots: [{ kind: 'human' }, { kind: 'bot' }] });
        await topOut(mode, 1);
        mode.isPaused = true;
        mode.multiplayerState.isPaused = true;
        vi.advanceTimersByTime(BOT_RESPAWN_MS * 3);
        expect(mode.multiplayerState.players[1].isAlive).toBe(false);
        mode.isPaused = false;
        mode.multiplayerState.isPaused = false;
        vi.advanceTimersByTime(250);
        expect(mode.multiplayerState.players[1].isAlive).toBe(true);
    });
});

describe('the free-for-all match goal', () => {
    it('ends the match on the kill that reaches the frag goal, and nobody comes back after it', async () => {
        vi.useFakeTimers();
        const mode = versusMode(3, { endConditionValue: 2, playerSlots: [{ kind: 'human' }, { kind: 'human' }, { kind: 'bot' }] });
        const state = mode.multiplayerState;
        state.handleGarbageSummary(1, clear(3), null); // player 2 holds the credit on 1 and 3

        await topOut(mode, 0);
        expect(state.frags[1]).toBe(1);
        expect(mode._showMatchEnd).not.toHaveBeenCalled();
        const ending = topOut(mode, 2);
        await vi.advanceTimersByTimeAsync(ROUND_OUTCOME_MS);
        await ending;

        expect(state.frags).toEqual([0, 2, 0]);
        expect(mode._matchEnding).toBe(true);
        expect(mode._showMatchEnd).toHaveBeenCalledExactlyOnceWith('player2');
        // The match is decided: the human's key and the bot's timer bring no one back.
        expect(mode._onSeatPress(0)).toBe(false);
        vi.advanceTimersByTime(BOT_RESPAWN_MS);
        expect(state.players.map((player) => player.isAlive)).toEqual([false, true, false]);
    });

    it('a team\'s frags are its players\' kills', async () => {
        vi.useFakeTimers();
        const mode = versusMode(4, {
            endConditionValue: 2, isTeamMode: true, playerTeams: [0, 0, 1, 1],
        });
        const state = mode.multiplayerState;
        state.handleGarbageSummary(0, clear(3), null); // player 1 on players 3 and 4
        state.handleGarbageSummary(1, clear(4), null); // player 2 outweighs them on both

        const first = topOut(mode, 2);
        await first;
        expect(mode._showMatchEnd).not.toHaveBeenCalled();
        const second = topOut(mode, 3);
        await vi.advanceTimersByTimeAsync(ROUND_OUTCOME_MS);
        await second;

        expect(state.frags).toEqual([0, 2, 0, 0]);
        expect(mode._showMatchEnd).toHaveBeenCalledExactlyOnceWith({ type: 'team', teamId: 0 });
    });

    it('the results add up the one long round: frags, deaths and the score across a respawn', async () => {
        vi.useFakeTimers();
        const mode = versusMode(2);
        const state = mode.multiplayerState;
        state.players[0].score = 1500;
        state.lastAttackerIds[0] = 1;
        await topOut(mode, 0);
        vi.advanceTimersByTime(RESPAWN_KEY_HOLD_MS);
        mode._onSeatPress(0);
        state.players[0].score += 500;
        mode._showMatchEnd = LocalMultiplayerMode.prototype._showMatchEnd;
        mode._playVictoryBeat = vi.fn(() => Promise.resolve(true));
        mode.onStop = vi.fn(() => Promise.resolve());
        mode._getPlayerColorScheme = vi.fn(() => ({ primary: '#fff' }));

        await mode._showMatchEnd('player2');

        const { players } = moduleMocks.showLocalMatchEnd.mock.calls[0][0];
        expect(players.map(({ score, deaths, frags }) => ({ score, deaths, frags }))).toEqual([
            { score: 2000, deaths: 1, frags: 0 },
            { score: 0, deaths: 0, frags: 1 },
        ]);
    });
});

describe('fading frag credit', () => {
    function creditedMatch(config) {
        const state = new MultiPlayerState(2);
        state.setMatchConfig(config);
        state.reset();
        state.handleGarbageSummary(1, clear(2), null); // one row: credit 2
        return state;
    }

    it('free-for-all forgets a holder whose credit faded out: the death goes uncredited', () => {
        const state = creditedMatch({});
        state.notePiecePlaced(0);
        expect(state.lastAttackerIds[0]).toBe(1);
        state.notePiecePlaced(0);
        expect(state.lastAttackerIds[0]).toBeNull();
        state.handlePlayerDeath(0);
        expect(state.frags).toEqual([0, 0]);
    });

    it('survivor rounds and Infinity\'s Last Standing keep the last holder', () => {
        for (const config of [{ gameType: 'survivor' }, { isInfinityLMS: true }]) {
            const state = creditedMatch(config);
            state.notePiecePlaced(0);
            state.notePiecePlaced(0);
            state.notePiecePlaced(0);
            expect(state.lastAttackerIds[0]).toBe(1);
            state.handlePlayerDeath(0);
            expect(state.frags).toEqual([0, 1]);
        }
    });
});

describe('survivor keeps its rounds', () => {
    it('a two-player death ends the round for both: the board pauses and the winner takes it', async () => {
        vi.useFakeTimers();
        const mode = versusMode(2, { gameType: 'survivor' });
        mode.multiplayerState.lastAttackerIds[0] = 1;

        const outcome = topOut(mode, 0);
        await vi.advanceTimersByTimeAsync(ROUND_OUTCOME_MS);
        await outcome;

        expect(mode.multiplayerState.isPaused).toBe(true);
        expect(mode._showVictoryAnimation).toHaveBeenCalledWith(1);
        expect(mode.handleRoundEnd).toHaveBeenCalledWith('player2', false);
        vi.advanceTimersByTime(RESPAWN_KEY_HOLD_MS);
        expect(mode._onSeatPress(0)).toBe(false);
        expect(mode.multiplayerState.players[0].isAlive).toBe(false);
    });

    it('on the fixed clock, the last one alive takes the round', async () => {
        vi.useFakeTimers();
        const mode = versusMode(3, { gameType: 'survivor' });
        mode._localSimulationLoop.fixedTickEnabled = true;
        const roundOwner = captureLocalMultiplayerRound(mode);

        const resolution = mode._handleFixedTickTopOutBatch([0, 1], roundOwner);
        await vi.advanceTimersByTimeAsync(ROUND_OUTCOME_MS);
        await expect(resolution).resolves.toBe(true);

        expect(mode.handleRoundEnd).toHaveBeenCalledWith('player3', true);
        expect(mode._downPlayers?.size ?? 0).toBe(0);
    });
});

describe('LocalBotManager.resetPlayer', () => {
    it('starts one bot\'s controller over and leaves the others alone', () => {
        const manager = new LocalBotManager({ multiplayerState: new MultiPlayerState(3), actionFactory: () => ({}) });
        const one = { reset: vi.fn() };
        const two = { reset: vi.fn() };
        manager.controllers.set(1, one);
        manager.controllers.set(2, two);
        manager.resetPlayer(1);
        manager.resetPlayer(0);
        expect(one.reset).toHaveBeenCalledOnce();
        expect(two.reset).not.toHaveBeenCalled();
    });
});

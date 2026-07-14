import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { GameState } from '../../src/core/game.js';
import { OnlineMultiplayerMode } from '../../src/core/game-modes/OnlineMultiplayerMode.js';
import { createFfaFixedInputAdapter } from '../../src/core/multiplayer/ffa-fixed-input-adapter.js';
import {
    configureOnlineFixedInput,
    dispatchOnlineFixedInput,
    installOnlineFixedGamepadAdapter,
    installOnlineFixedKeyboardAdapter,
    removeOnlineFixedGamepadAdapter,
    removeOnlineFixedKeyboardAdapter,
} from '../../src/core/multiplayer/online-fixed-input.js';
import { enqueueInputEdge } from '../../src/core/player-input-state.js';
import { advanceTick, INPUT_DISPOSITIONS } from '../../src/core/simulation-tick.js';

vi.mock('../../src/rendering/phaser/board-juice.js', () => ({
    BoardJuice: class BoardJuice {},
}));
vi.mock('phaser', () => ({ default: {} }));

function createMode() {
    const settings = {
        dasDelay: 91,
        dasInterval: 23,
        softDropInterval: 17,
    };
    const localState = new GameState();
    const inputController = {
        fixedTickInputAdapter: null,
        setFixedTickInputAdapter: vi.fn(function setFixedTickInputAdapter(adapter) {
            this.fixedTickInputAdapter = adapter;
        }),
        keyMap: {},
        updateDAS: vi.fn(),
        clearTimers: vi.fn(),
    };
    const ffa = {
        isHost: false,
        isSpectator: false,
        localPlayerId: 'P1',
        _fixedTickEnabled: true,
        _fixedInputTimeMs: 0,
        _activeFixedInputStamp: null,
        gamePhase: 'playing',
        players: new Map([['P1', {
            isAlive: true,
            lastInputSeq: 0,
            gameState: localState,
        }]]),
        sendInput: vi.fn(),
        setLocalInputHooks(hooks) {
            this.localInputHooks = hooks;
        },
    };
    const gamepadController = {
        fixedTickInputAdapter: null,
        setFixedTickInputAdapter: vi.fn(function setFixedTickInputAdapter(adapter) {
            this.fixedTickInputAdapter = adapter;
        }),
        advanceGameplayInput: vi.fn(),
        clearAllDasTimers: vi.fn(),
    };
    const boardJuice = {
        nudge: vi.fn(),
        tilt: vi.fn(),
        dip: vi.fn(),
        bounce: vi.fn(),
    };
    const mode = Object.assign(Object.create(OnlineMultiplayerMode.prototype), {
        deps: {
            settingsManager: { get: () => settings },
            gamepadController,
            inputController,
        },
        ffaGameState: ffa,
        isInMatch: true,
        boardJuice,
        _fixedTickKeyboardAdapter: null,
        _fixedTickGamepadAdapter: null,
        cleanupHandlers: [],
    });

    configureOnlineFixedInput(mode, ffa);
    installOnlineFixedKeyboardAdapter(mode, ffa);
    installOnlineFixedGamepadAdapter(mode, ffa);
    return {
        boardJuice,
        ffa,
        gamepadController,
        inputController,
        localState,
        mode,
        settings,
    };
}

describe('online fixed input binding', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('claims P1 only for a live fixed match and detaches by identity', () => {
        const {
            ffa, gamepadController, inputController, localState, mode,
        } = createMode();
        const keyboardAdapter = inputController.fixedTickInputAdapter;
        const gamepadAdapter = gamepadController.fixedTickInputAdapter;

        expect(keyboardAdapter.resolveGameState(0)).toBe(localState);
        expect(keyboardAdapter.resolveGameState(1)).toBeNull();
        expect(gamepadAdapter.resolveGameState(0)).toBe(localState);
        expect(gamepadAdapter.resolveGameState(1)).toBeNull();
        expect(keyboardAdapter.isEnabled({ playerIndex: 0, gameState: localState })).toBe(true);
        expect(gamepadAdapter.isEnabled({ playerIndex: 0, gameState: localState })).toBe(true);
        expect(keyboardAdapter.isEnabled({ playerIndex: 1, gameState: null })).toBe(false);

        const localPlayer = ffa.players.get('P1');
        localPlayer.isAlive = false;
        expect(keyboardAdapter.resolveGameState(0)).toBeNull();
        expect(gamepadAdapter.resolveGameState(0)).toBeNull();
        expect(keyboardAdapter.isEnabled({ playerIndex: 0, gameState: localState })).toBe(true);
        localPlayer.isAlive = true;
        localPlayer.awaitingSpawn = true;
        expect(keyboardAdapter.resolveGameState(0)).toBeNull();
        expect(gamepadAdapter.resolveGameState(0)).toBeNull();
        localPlayer.awaitingSpawn = false;
        ffa._fixedTickEnabled = false;
        expect(keyboardAdapter.isEnabled({ playerIndex: 0, gameState: localState })).toBe(false);
        expect(gamepadAdapter.isEnabled({ playerIndex: 0, gameState: localState })).toBe(false);

        ffa._fixedTickEnabled = true;
        removeOnlineFixedKeyboardAdapter(mode);
        expect(inputController.fixedTickInputAdapter).toBeNull();
        removeOnlineFixedGamepadAdapter(mode);
        expect(gamepadController.fixedTickInputAdapter).toBeNull();

        installOnlineFixedKeyboardAdapter(mode, ffa);
        const replacement = { external: true };
        inputController.fixedTickInputAdapter = replacement;
        removeOnlineFixedKeyboardAdapter(mode);
        expect(inputController.fixedTickInputAdapter).toBe(replacement);

        installOnlineFixedGamepadAdapter(mode, ffa);
        gamepadController.fixedTickInputAdapter = replacement;
        removeOnlineFixedGamepadAdapter(mode);
        expect(gamepadController.fixedTickInputAdapter).toBe(replacement);
    });

    it('locks canonical gameplay to the first active device until input reset', () => {
        const {
            ffa, gamepadController, inputController,
        } = createMode();
        const keyboardAdapter = inputController.fixedTickInputAdapter;
        const gamepadAdapter = gamepadController.fixedTickInputAdapter;

        expect(keyboardAdapter.acceptSource()).toBe(true);
        expect(gamepadAdapter.acceptSource()).toBe(false);

        ffa.localInputHooks.reset();
        expect(gamepadAdapter.acceptSource()).toBe(true);
        expect(keyboardAdapter.acceptSource()).toBe(false);
    });

    it('drains one keyboard edge through advanceTick into one wire/prediction ingress', () => {
        const {
            boardJuice,
            ffa,
            gamepadController,
            inputController,
            localState,
            settings,
        } = createMode();
        enqueueInputEdge(localState.playerInput, {
            tick: 1,
            subframe: 0,
            action: 'move',
            value: -1,
            phase: 'down',
        });
        const adapter = createFfaFixedInputAdapter(ffa);

        const result = advanceTick(localState, {
            advanceInput: (context) => adapter.advanceInput('P1', context),
            applyInput: (command) => adapter.applyInput('P1', command),
        });
        adapter.onTickResult('P1', result);

        expect(result.input.map((entry) => entry.disposition)).toEqual([
            INPUT_DISPOSITIONS.APPLIED,
        ]);
        expect(ffa.sendInput).toHaveBeenCalledOnce();
        expect(ffa.sendInput).toHaveBeenCalledWith('move', { direction: -1 });
        expect(boardJuice.nudge).toHaveBeenCalledWith(-1.5, 0);
        expect(boardJuice.tilt).toHaveBeenCalledWith(-0.4);
        expect(inputController.updateDAS).toHaveBeenCalledWith(localState.simTickMs);
        expect(gamepadController.advanceGameplayInput).toHaveBeenCalledOnce();
        expect(localState.playerInput.config).toEqual(settings);

        settings.dasDelay = 1;
        settings.dasInterval = 1;
        settings.softDropInterval = 1;
        expect(localState.playerInput.config).toEqual({
            dasDelay: 91,
            dasInterval: 23,
            softDropInterval: 17,
        });
    });

    it('drains a queued edge fail-closed when the local roster player is waiting', () => {
        const {
            boardJuice, ffa, localState,
        } = createMode();
        enqueueInputEdge(localState.playerInput, {
            tick: 1,
            subframe: 0,
            action: 'move',
            value: 1,
            phase: 'down',
        });
        localState.playerInput.das.moveRight.active = true;
        ffa.players.get('P1').awaitingSpawn = true;
        const adapter = createFfaFixedInputAdapter(ffa);

        const result = advanceTick(localState, {
            advanceInput: (context) => adapter.advanceInput('P1', context),
            applyInput: (command) => adapter.applyInput('P1', command),
        });

        expect(result.input).toEqual([]);
        expect(localState.playerInput.pendingEdges).toEqual([]);
        expect(localState.playerInput.das.moveRight.active).toBe(false);
        expect(ffa.sendInput).not.toHaveBeenCalled();
        expect(boardJuice.nudge).not.toHaveBeenCalled();
        expect(boardJuice.tilt).not.toHaveBeenCalled();
    });

    it('resets injected input state on both visibility transitions', () => {
        const listeners = new Map();
        vi.stubGlobal('document', {
            hidden: true,
            addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
            removeEventListener: vi.fn(),
        });
        const {
            gamepadController, inputController, mode,
        } = createMode();
        inputController.keyMap = { ArrowLeft: true };
        mode._setupVisibilityHandler();

        expect(() => listeners.get('visibilitychange')()).not.toThrow();
        expect(inputController.clearTimers).toHaveBeenCalledOnce();
        expect(gamepadController.clearAllDasTimers).toHaveBeenCalledOnce();
        expect(inputController.keyMap).toEqual({});

        document.hidden = false;
        inputController.keyMap = { ArrowRight: true };
        expect(() => listeners.get('visibilitychange')()).not.toThrow();
        expect(inputController.clearTimers).toHaveBeenCalledTimes(2);
        expect(gamepadController.clearAllDasTimers).toHaveBeenCalledTimes(2);
        expect(inputController.keyMap).toEqual({});
    });

    it.each([
        ['rotate', 'left', ['rotate', { direction: 'left' }]],
        ['softDrop', null, ['drop', { type: 'soft' }]],
        ['hardDrop', null, ['drop', { type: 'hard' }]],
    ])('maps %s without invoking a legacy window action', (action, value, expected) => {
        const {
            boardJuice, ffa, mode,
        } = createMode();

        expect(dispatchOnlineFixedInput(mode, { action, value })).toBe(true);

        expect(ffa.sendInput).toHaveBeenCalledWith(...expected);
        if (action === 'rotate') expect(boardJuice.tilt).toHaveBeenCalledWith(-0.3);
        if (action === 'hardDrop') {
            expect(boardJuice.dip).toHaveBeenCalledWith(3);
            expect(boardJuice.bounce).toHaveBeenCalledOnce();
        }
    });
});

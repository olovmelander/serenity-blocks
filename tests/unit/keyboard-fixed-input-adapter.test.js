import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { GameState } from '../../src/core/game.js';
import { startDas } from '../../src/core/das.js';
import { InputController, setupKeyboardControls } from '../../src/ui/controls.js';

const baseBindings = {
    moveLeft: 'ArrowLeft',
    moveRight: 'ArrowRight',
    softDrop: 'ArrowDown',
    rotateRight: 'ArrowUp',
    rotateLeft: 'z',
    flip: 'a',
    hardDrop: 'Space',
};

function createDocument() {
    const listeners = new Map();
    const elements = new Map();
    return {
        activeElement: null,
        hidden: false,
        addEventListener(type, listener) {
            const entries = listeners.get(type) || [];
            entries.push(listener);
            listeners.set(type, entries);
        },
        removeEventListener(type, listener) {
            const entries = listeners.get(type) || [];
            listeners.set(type, entries.filter((entry) => entry !== listener));
        },
        getElementById(id) {
            return elements.get(id) || null;
        },
        setVisible(id, visible) {
            elements.set(id, {
                classList: { contains: (name) => name === 'visible' && visible },
            });
        },
        dispatch(type, event = {}) {
            (listeners.get(type) || []).forEach((listener) => listener(event));
        },
    };
}

function keyEvent(key, overrides = {}) {
    return {
        key,
        repeat: false,
        preventDefault: vi.fn(),
        ...overrides,
    };
}

function createHarness({ states = [new GameState(), null], enabledPlayers = [] } = {}) {
    const settings = {
        keyBindings: { ...baseBindings },
        player2KeyBindings: states[1] ? { ...baseBindings } : {},
        dasDelay: 95,
        dasInterval: 25,
        softDropInterval: 35,
    };
    window.settings = settings;
    const controller = new InputController();
    const gameActions = {
        requestMove: vi.fn(() => true),
        requestRotate: vi.fn(() => true),
        requestSoftDrop: vi.fn(() => true),
        requestHardDrop: vi.fn(() => true),
        requestMoveP2: vi.fn(() => true),
        requestRotateP2: vi.fn(() => true),
        requestSoftDropP2: vi.fn(() => true),
        requestHardDropP2: vi.fn(() => true),
        initSound: vi.fn(),
    };
    setupKeyboardControls(controller, settings, gameActions);
    if (enabledPlayers.length > 0) {
        const enabled = new Set(enabledPlayers);
        controller.setFixedTickInputAdapter({
            isEnabled: ({ playerIndex, gameState }) => (
                enabled.has(playerIndex) && Boolean(gameState)
            ),
            resolveGameState: (playerIndex) => states[playerIndex] || null,
        });
    }
    return {
        controller, gameActions, settings, states,
    };
}

describe('keyboard fixed-tick input adapter', () => {
    beforeEach(() => {
        vi.stubGlobal('document', createDocument());
        vi.stubGlobal('window', { settings: null });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('preserves the exact immediate legacy path when no adapter claims the player', () => {
        const { controller, gameActions } = createHarness();

        controller.handleKeyDown(keyEvent('ArrowLeft'));

        expect(gameActions.requestMove).toHaveBeenCalledWith(-1);
        expect(controller.dasState.moveLeft.active).toBe(true);
        expect(controller.fixedTickHeldKeys.size).toBe(0);
    });

    it('queues a next-tick edge and suppresses immediate action plus singleton DAS', () => {
        const state = new GameState({
            inputHandling: { dasDelay: 81, dasInterval: 22, softDropInterval: 13 },
        });
        state.simFrame = 7;
        const { controller, gameActions } = createHarness({
            states: [state, null],
            enabledPlayers: [0],
        });

        controller.handleKeyDown(keyEvent('ArrowLeft'));

        expect(state.playerInput.pendingEdges).toEqual([expect.objectContaining({
            tick: 8,
            subframe: 0,
            action: 'move',
            value: -1,
            phase: 'down',
        })]);
        expect(state.playerInput.config).toEqual({
            dasDelay: 81,
            dasInterval: 22,
            softDropInterval: 13,
        });
        expect(gameActions.requestMove).not.toHaveBeenCalled();
        expect(controller.dasState.moveLeft.active).toBe(false);
    });

    it('fails closed when another device owns the canonical source policy', () => {
        const state = new GameState();
        const { controller, gameActions } = createHarness({
            states: [state, null],
            enabledPlayers: [0],
        });
        controller.fixedTickInputAdapter.acceptSource = () => false;

        controller.handleKeyDown(keyEvent('ArrowLeft'));

        expect(state.playerInput.pendingEdges).toEqual([]);
        expect(gameActions.requestMove).not.toHaveBeenCalled();
        expect(controller.fixedTickHeldKeys.get('ArrowLeft')[0].cleared).toBe(true);
    });

    it('suppresses browser repeat and queues a same-tick tap in sequence order', () => {
        const state = new GameState();
        const { controller } = createHarness({
            states: [state, null],
            enabledPlayers: [0],
        });

        controller.handleKeyDown(keyEvent('ArrowLeft'));
        controller.handleKeyDown(keyEvent('ArrowLeft', { repeat: true }));
        controller.handleKeyUp(keyEvent('ArrowLeft'));

        expect(state.playerInput.pendingEdges.map((edge) => ({
            tick: edge.tick,
            sequence: edge.sequence,
            phase: edge.phase,
        }))).toEqual([
            { tick: 1, sequence: 0, phase: 'down' },
            { tick: 1, sequence: 1, phase: 'up' },
        ]);
    });

    it('releases the original target after a binding changes while held', () => {
        const state = new GameState();
        const { controller, settings } = createHarness({
            states: [state, null],
            enabledPlayers: [0],
        });
        controller.handleKeyDown(keyEvent('ArrowLeft'));
        settings.keyBindings.moveLeft = 'j';

        controller.handleKeyUp(keyEvent('ArrowLeft'));

        expect(state.playerInput.pendingEdges.map((edge) => edge.phase)).toEqual(['down', 'up']);
        expect(controller.keyMap.moveLeft).toBe(false);
    });

    it('releases a rejected key through its original binding after a live rebind', () => {
        const state = new GameState();
        state.isPaused = true;
        const { controller, settings } = createHarness({
            states: [state, null],
            enabledPlayers: [0],
        });
        controller.handleKeyDown(keyEvent('ArrowLeft'));
        settings.keyBindings.moveLeft = 'j';

        controller.handleKeyUp(keyEvent('ArrowLeft'));

        expect(state.playerInput.pendingEdges).toEqual([]);
        expect(controller.keyMap.moveLeft).toBe(false);
        expect(controller.fixedTickHeldKeys.size).toBe(0);
    });

    it('preserves P2-then-P1 ownership when both share one physical key', () => {
        const states = [new GameState(), new GameState()];
        const { controller } = createHarness({ states, enabledPlayers: [0, 1] });

        controller.handleKeyDown(keyEvent('ArrowLeft'));
        controller.handleKeyUp(keyEvent('ArrowLeft'));

        states.forEach((state) => {
            expect(state.playerInput.pendingEdges.map((edge) => edge.phase)).toEqual(['down', 'up']);
        });
        expect(controller.keyMap.moveLeft).toBe(false);
        expect(controller.keyMap['p2-moveLeft']).toBe(false);
    });

    it.each([
        ['ArrowUp', 'rotate', 'right', false],
        ['z', 'rotate', 'left', false],
        ['a', 'rotate', 'flip', false],
        ['Space', 'hardDrop', null, true],
    ])('normalizes %s to a down-only %s edge', (key, action, value, preventsDefault) => {
        const state = new GameState();
        const { controller } = createHarness({
            states: [state, null],
            enabledPlayers: [0],
        });
        const event = keyEvent(key);

        controller.handleKeyDown(event);
        controller.handleKeyUp(keyEvent(key));

        expect(state.playerInput.pendingEdges).toEqual([expect.objectContaining({
            action, value, phase: 'down',
        })]);
        expect(event.preventDefault).toHaveBeenCalledTimes(preventsDefault ? 1 : 0);
    });

    it('skips legacy repeats independently for a claimed player', () => {
        const state = new GameState();
        const { controller, gameActions } = createHarness({
            states: [state, null],
            enabledPlayers: [0],
        });
        controller.handleKeyDown(keyEvent('ArrowLeft'));

        controller.updateDAS(1000);

        expect(gameActions.requestMove).not.toHaveBeenCalled();
        expect(state.playerInput.pendingEdges).toHaveLength(1);
    });

    it('never falls through to legacy input when the canonical queue rejects overflow', () => {
        const state = new GameState();
        for (let index = 0; index < 64; index += 1) {
            state.playerInput.pendingEdges.push({
                tick: index,
                subframe: 0,
                sequence: index,
                action: 'softDrop',
                value: null,
                phase: 'down',
            });
        }
        state.playerInput.nextEdgeSequence = 64;
        const { controller, gameActions } = createHarness({
            states: [state, null],
            enabledPlayers: [0],
        });

        controller.handleKeyDown(keyEvent('ArrowLeft'));

        expect(state.playerInput.pendingEdges).toEqual([]);
        expect(state.playerInput.overflowCount).toBe(1);
        expect(gameActions.requestMove).not.toHaveBeenCalled();
    });

    it('uses the next-tick fallback when a custom stamp throws', () => {
        const state = new GameState();
        state.simFrame = 19;
        const { controller } = createHarness({ states: [state, null] });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        controller.setFixedTickInputAdapter({
            isEnabled: () => true,
            resolveGameState: () => state,
            stamp: () => { throw new Error('stamp failed'); },
        });

        controller.handleKeyDown(keyEvent('ArrowLeft'));

        expect(state.playerInput.pendingEdges).toEqual([expect.objectContaining({
            tick: 20,
            subframe: 0,
            action: 'move',
            phase: 'down',
        })]);
    });

    it.each(['isReplay', 'isSeeking', 'suppressExternalInput', 'isPaused', 'isGameOver'])(
        'swallows external input while %s is active',
        (gate) => {
            const state = new GameState();
            state[gate] = true;
            const { controller, gameActions } = createHarness({
                states: [state, null],
                enabledPlayers: [0],
            });

            controller.handleKeyDown(keyEvent('ArrowLeft'));

            expect(state.playerInput.pendingEdges).toEqual([]);
            expect(gameActions.requestMove).not.toHaveBeenCalled();
        },
    );

    it.each(['hitStopRemaining', 'isProcessingPhysics'])(
        'still queues an edge while %s is active',
        (gate) => {
            const state = new GameState();
            state[gate] = gate === 'hitStopRemaining' ? 30 : true;
            const { controller } = createHarness({
                states: [state, null],
                enabledPlayers: [0],
            });

            controller.handleKeyDown(keyEvent('ArrowLeft'));

            expect(state.playerInput.pendingEdges).toHaveLength(1);
        },
    );

    it('clears canonical state on timer reset and visibility without rearming a held key', () => {
        const state = new GameState();
        const { controller, gameActions } = createHarness({
            states: [state, null],
            enabledPlayers: [0],
        });
        controller.handleKeyDown(keyEvent('ArrowLeft'));
        startDas(state.playerInput.das.moveLeft);

        controller.clearTimers();
        document.hidden = true;
        document.dispatch('visibilitychange');
        controller.handleKeyDown(keyEvent('ArrowLeft', { repeat: false }));

        expect(state.playerInput.pendingEdges).toEqual([]);
        expect(state.playerInput.das.moveLeft.active).toBe(false);
        expect(gameActions.requestMove).not.toHaveBeenCalled();
        expect(controller.fixedTickHeldKeys.size).toBe(1);

        controller.handleKeyUp(keyEvent('ArrowLeft'));
        expect(controller.fixedTickHeldKeys.size).toBe(0);
    });

    it('keeps a physical latch across adapter replacement until keyup', () => {
        const state = new GameState();
        const { controller, gameActions } = createHarness({
            states: [state, null],
            enabledPlayers: [0],
        });
        controller.handleKeyDown(keyEvent('ArrowLeft'));

        controller.setFixedTickInputAdapter(null);
        controller.handleKeyDown(keyEvent('ArrowLeft', { repeat: false }));

        expect(state.playerInput.pendingEdges).toEqual([]);
        expect(gameActions.requestMove).not.toHaveBeenCalled();
        expect(controller.keyMap.moveLeft).toBe(true);
        expect(controller.fixedTickHeldKeys.size).toBe(1);

        controller.handleKeyUp(keyEvent('ArrowLeft'));
        expect(controller.keyMap.moveLeft).toBe(false);
        expect(controller.fixedTickHeldKeys.size).toBe(0);
    });

    it('clears the old target instead of releasing into it after a mode switch', () => {
        const oldState = new GameState();
        const states = [oldState, null];
        const { controller } = createHarness({ states, enabledPlayers: [0] });
        controller.handleKeyDown(keyEvent('ArrowLeft'));
        const newState = new GameState();
        states[0] = newState;

        controller.handleKeyUp(keyEvent('ArrowLeft'));

        expect(oldState.playerInput.pendingEdges).toEqual([]);
        expect(newState.playerInput.pendingEdges).toEqual([]);
        expect(oldState.playerInput.das.moveLeft.active).toBe(false);
    });

    it('clears canonical holds before keyboard handlers are replaced', () => {
        const state = new GameState();
        const { controller, gameActions, settings } = createHarness({
            states: [state, null],
            enabledPlayers: [0],
        });
        controller.handleKeyDown(keyEvent('ArrowLeft'));
        startDas(state.playerInput.das.moveLeft);

        setupKeyboardControls(controller, settings, gameActions);
        controller.handleKeyDown(keyEvent('ArrowLeft', { repeat: false }));

        expect(state.playerInput.pendingEdges).toEqual([]);
        expect(state.playerInput.das.moveLeft.active).toBe(false);
        expect(controller.fixedTickHeldKeys.size).toBe(1);

        controller.handleKeyUp(keyEvent('ArrowLeft'));
        expect(controller.fixedTickHeldKeys.size).toBe(0);
    });

    it('releases fixed input while the settings modal is visible', () => {
        const state = new GameState();
        const { controller } = createHarness({
            states: [state, null],
            enabledPlayers: [0],
        });
        controller.handleKeyDown(keyEvent('ArrowLeft'));
        document.setVisible('settings-modal', true);

        controller.handleKeyUp(keyEvent('ArrowLeft'));

        expect(state.playerInput.pendingEdges.map((edge) => edge.phase)).toEqual(['down', 'up']);
        expect(controller.keyMap.moveLeft).toBe(false);
    });

    it('cleanup clears both input engines and releases adapter-owned references', () => {
        const state = new GameState();
        const { controller } = createHarness({
            states: [state, null],
            enabledPlayers: [0],
        });
        controller.handleKeyDown(keyEvent('ArrowLeft'));
        startDas(state.playerInput.das.moveLeft);
        startDas(controller.dasState.moveRight);

        controller.cleanup();

        expect(state.playerInput.pendingEdges).toEqual([]);
        expect(state.playerInput.das.moveLeft.active).toBe(false);
        expect(controller.dasState.moveRight.active).toBe(false);
        expect(controller.fixedTickHeldKeys.size).toBe(0);
        expect(controller.fixedTickTouchedStates.size).toBe(0);
        expect(controller.fixedTickInputAdapter).toBeNull();
        expect(controller.keyMap).toEqual({});
    });

    it('honors existing modal, typing, and start-screen gates before edge capture', () => {
        const state = new GameState();
        const { controller } = createHarness({
            states: [state, null],
            enabledPlayers: [0],
        });
        document.setVisible('settings-modal', true);
        controller.handleKeyDown(keyEvent('ArrowLeft'));
        document.setVisible('settings-modal', false);
        document.activeElement = { classList: { contains: () => true } };
        controller.handleKeyDown(keyEvent('ArrowRight'));
        document.activeElement = null;
        document.setVisible('start-modal', true);
        controller.handleKeyDown(keyEvent('ArrowDown'));

        expect(state.playerInput.pendingEdges).toEqual([]);
    });
});

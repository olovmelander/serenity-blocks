import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { GameState } from '../../src/core/game.js';
import {
    InputController,
    isTextEntryElement,
    setupKeyboardControls,
} from '../../src/ui/controls.js';
import { OnlineChat } from '../../src/ui/online-chat.js';

const baseBindings = {
    moveLeft: 'ArrowLeft',
    moveRight: 'ArrowRight',
    softDrop: 'ArrowDown',
    rotateRight: 'ArrowUp',
    rotateLeft: 'z',
    flip: 'a',
    hardDrop: 'Space',
};

function createEventTarget(extra = {}) {
    const listeners = new Map();
    return {
        addEventListener(type, listener) {
            listeners.set(type, [...(listeners.get(type) || []), listener]);
        },
        removeEventListener(type, listener) {
            listeners.set(type, (listeners.get(type) || []).filter((entry) => entry !== listener));
        },
        dispatch(type, event = {}) {
            (listeners.get(type) || []).forEach((listener) => listener(event));
        },
        listenerCount(type) {
            return (listeners.get(type) || []).length;
        },
        ...extra,
    };
}

function createDocument() {
    return createEventTarget({
        activeElement: null,
        hidden: false,
        body: { classList: { contains: () => false } },
        getElementById: () => null,
    });
}

function field(tagName, overrides = {}) {
    const { type = null, classes = [], ...rest } = overrides;
    return {
        tagName,
        type: type ?? (tagName === 'INPUT' ? 'text' : undefined),
        getAttribute: (name) => (name === 'type' ? type : null),
        classList: { contains: (name) => classes.includes(name) },
        ...rest,
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

function createHarness({ fixedTickState = null } = {}) {
    const settings = {
        keyBindings: { ...baseBindings },
        player2KeyBindings: {},
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
        startGame: vi.fn(),
        initSound: vi.fn(),
    };
    setupKeyboardControls(controller, settings, gameActions);
    if (fixedTickState) {
        controller.setFixedTickInputAdapter({
            isEnabled: ({ playerIndex, gameState }) => playerIndex === 0 && Boolean(gameState),
            resolveGameState: (playerIndex) => (playerIndex === 0 ? fixedTickState : null),
        });
    }
    return { controller, gameActions };
}

beforeEach(() => {
    vi.stubGlobal('document', createDocument());
    vi.stubGlobal('window', createEventTarget({ settings: null }));
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('isTextEntryElement', () => {
    it('recognises text fields, text areas, editable content and key-binding boxes', () => {
        expect(isTextEntryElement(field('INPUT'))).toBe(true);
        expect(isTextEntryElement(field('input', { type: 'search' }))).toBe(true);
        expect(isTextEntryElement(field('INPUT', { type: 'number' }))).toBe(true);
        expect(isTextEntryElement(field('TEXTAREA'))).toBe(true);
        expect(isTextEntryElement(field('DIV', { isContentEditable: true }))).toBe(true);
        expect(isTextEntryElement(field('DIV', { classes: ['key-input'] }))).toBe(true);
    });

    it('ignores controls that do not take typed text, and anything that is not an element', () => {
        for (const type of ['checkbox', 'radio', 'range', 'button', 'submit', 'color', 'file']) {
            expect(isTextEntryElement(field('INPUT', { type }))).toBe(false);
        }
        expect(isTextEntryElement(field('BUTTON'))).toBe(false);
        expect(isTextEntryElement(field('SELECT'))).toBe(false);
        expect(isTextEntryElement(field('DIV'))).toBe(false);
        for (const value of [null, undefined, 'INPUT', 7, {}]) {
            expect(isTextEntryElement(value)).toBe(false);
        }
    });

    it('ignores a field that is disabled or no longer on screen', () => {
        expect(isTextEntryElement(field('INPUT', { disabled: true }))).toBe(false);
        expect(isTextEntryElement(field('INPUT', { checkVisibility: () => false }))).toBe(false);
        expect(isTextEntryElement(field('INPUT', { checkVisibility: () => true }))).toBe(true);
    });
});

describe('keyboard text-entry guard', () => {
    it('does not turn typing in a text field into gameplay input', () => {
        const { controller, gameActions } = createHarness();
        const chat = field('INPUT');
        const space = keyEvent(' ', { target: chat });

        controller.handleKeyDown(space);
        controller.handleKeyDown(keyEvent('ArrowLeft', { target: chat }));
        controller.handleKeyDown(keyEvent('a', { target: chat }));
        controller.handleKeyDown(keyEvent('z', { target: chat }));

        expect(gameActions.requestHardDrop).not.toHaveBeenCalled();
        expect(gameActions.requestMove).not.toHaveBeenCalled();
        expect(gameActions.requestRotate).not.toHaveBeenCalled();
        // The space must reach the field: hard drop used to preventDefault it.
        expect(space.preventDefault).not.toHaveBeenCalled();
        expect(controller.keyMap).toEqual({});
        expect(controller.dasState.moveLeft.active).toBe(false);
    });

    it('also guards on the focused element when the event carries no target', () => {
        const { controller, gameActions } = createHarness();
        document.activeElement = field('TEXTAREA');

        controller.handleKeyDown(keyEvent('ArrowLeft'));

        expect(gameActions.requestMove).not.toHaveBeenCalled();
    });

    it('keeps typing from starting a game on the start screen', () => {
        const { controller, gameActions } = createHarness();
        document.getElementById = (id) => (id === 'start-modal'
            ? { classList: { contains: (name) => name === 'visible' } }
            : null);

        controller.handleKeyDown(keyEvent(' ', { target: field('INPUT') }));
        expect(gameActions.startGame).not.toHaveBeenCalled();

        controller.handleKeyDown(keyEvent(' '));
        expect(gameActions.startGame).toHaveBeenCalledTimes(1);
    });

    it('still plays normally when focus sits on a non-text control or a hidden field', () => {
        const { controller, gameActions } = createHarness();

        controller.handleKeyDown(keyEvent('ArrowLeft', { target: field('BUTTON') }));
        controller.handleKeyUp(keyEvent('ArrowLeft'));
        controller.handleKeyDown(keyEvent('ArrowLeft', {
            target: field('INPUT', { checkVisibility: () => false }),
        }));

        expect(gameActions.requestMove).toHaveBeenCalledTimes(2);
    });
});

describe('window blur releases held input', () => {
    it('stops legacy auto-repeat and does not swallow the next press', () => {
        const { controller, gameActions } = createHarness();
        controller.handleKeyDown(keyEvent('ArrowLeft'));
        controller.handleKeyDown(keyEvent('ArrowDown'));
        expect(controller.dasState.moveLeft.active).toBe(true);
        expect(controller.dasState.softDrop.active).toBe(true);

        window.dispatch('blur'); // alt-tab: the keyup goes to another application

        expect(controller.dasState.moveLeft.active).toBe(false);
        expect(controller.dasState.softDrop.active).toBe(false);
        expect(controller.keyMap).toEqual({});

        // No repeats while away.
        controller.updateDAS(1000);
        expect(gameActions.requestMove).toHaveBeenCalledTimes(1);

        // Back in the game: the first press works.
        controller.handleKeyDown(keyEvent('ArrowLeft'));
        expect(gameActions.requestMove).toHaveBeenCalledTimes(2);
    });

    it('drops fixed-tick latches without re-arming a key that is still held', () => {
        const state = new GameState();
        const { controller } = createHarness({ fixedTickState: state });
        controller.handleKeyDown(keyEvent('ArrowLeft'));
        expect(controller.fixedTickHeldKeys.size).toBe(1);
        expect(state.playerInput.pendingEdges).toHaveLength(1);

        window.dispatch('blur');

        expect(controller.fixedTickHeldKeys.size).toBe(0);
        expect(state.playerInput.pendingEdges).toEqual([]);

        // Key still physically down on return: the OS only sends repeats.
        controller.handleKeyDown(keyEvent('ArrowLeft', { repeat: true }));
        expect(state.playerInput.pendingEdges).toEqual([]);
        controller.handleKeyUp(keyEvent('ArrowLeft'));

        // A genuine new press is accepted — it is not swallowed by a stale latch.
        controller.handleKeyDown(keyEvent('ArrowLeft'));
        expect(state.playerInput.pendingEdges).toEqual([
            expect.objectContaining({ action: 'move', value: -1, phase: 'down' }),
        ]);
    });

    it('removes the blur listener with the keyboard controls', () => {
        const { controller } = createHarness();
        expect(window.listenerCount('blur')).toBe(1);

        controller.removeKeyboardControls();

        expect(window.listenerCount('blur')).toBe(0);
        expect(controller.handleWindowBlur).toBeNull();
    });

    it('does not stack listeners when controls are set up again', () => {
        const { controller } = createHarness();
        setupKeyboardControls(controller, window.settings, controller.gameActions);

        expect(window.listenerCount('blur')).toBe(1);
        expect(document.listenerCount('keydown')).toBe(1);
    });
});

describe('OnlineChat input isolation', () => {
    function makeChat() {
        const input = { value: '', blur: vi.fn() };
        const elements = { 'chat-input': input, 'chat-send': {}, 'chat-messages': {} };
        document.getElementById = (id) => elements[id] || null;
        const onSend = vi.fn();
        const chat = new OnlineChat({}, onSend);
        return { chat, input, onSend };
    }

    function chatKey(key) {
        return { key, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    }

    it('keeps every typed key away from the global game-input handlers', () => {
        const { input } = makeChat();
        for (const key of [' ', 'a', 'z', 'ArrowLeft', 'ArrowDown']) {
            const event = chatKey(key);
            input.onkeydown(event);
            expect(event.stopPropagation).toHaveBeenCalledTimes(1);
            expect(event.preventDefault).not.toHaveBeenCalled();
        }
        expect(input.blur).not.toHaveBeenCalled();
    });

    it('sends on Enter and hands the keyboard back to the game', () => {
        const { input, onSend } = makeChat();
        input.value = '  gg a b  ';
        const enter = chatKey('Enter');

        input.onkeydown(enter);

        expect(onSend).toHaveBeenCalledWith('gg a b');
        expect(input.value).toBe('');
        expect(input.blur).toHaveBeenCalledTimes(1);
        expect(enter.preventDefault).toHaveBeenCalledTimes(1);
        expect(enter.stopPropagation).toHaveBeenCalledTimes(1);
    });

    it('leaves the field on Escape without sending or opening the pause menu', () => {
        const { input, onSend } = makeChat();
        input.value = 'half a thought';
        const escape = chatKey('Escape');

        input.onkeydown(escape);

        expect(onSend).not.toHaveBeenCalled();
        expect(input.value).toBe('half a thought');
        expect(input.blur).toHaveBeenCalledTimes(1);
        expect(escape.stopPropagation).toHaveBeenCalledTimes(1);
    });

    it('detaches its key handler on destroy', () => {
        const { chat, input } = makeChat();
        chat.destroy();
        expect(input.onkeydown).toBeNull();
    });
});

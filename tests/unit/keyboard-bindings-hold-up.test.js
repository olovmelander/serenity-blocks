import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    findBoundAction,
    isBindableKey,
    isKeyBound,
    normalizeBindingKey,
} from '../../src/ui/binding-keys.js';
import { InputController, setupKeyboardControls } from '../../src/ui/controls.js';
import { handleKeybinding, SettingsManager } from '../../src/ui/settings.js';

const P1 = {
    moveLeft: 'ArrowLeft',
    moveRight: 'ArrowRight',
    rotateRight: 'ArrowUp',
    rotateLeft: 'z',
    flip: 'a',
    softDrop: 'ArrowDown',
    hardDrop: 'Space',
};
const P2 = {
    moveLeft: 'a',
    moveRight: 'd',
    rotateRight: 'w',
    rotateLeft: 'q',
    flip: 'e',
    softDrop: 's',
    hardDrop: 'Shift',
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
        ...extra,
    };
}

/** A keyboard event the way a real key sends it: `key` follows Shift and Caps Lock, `code` does not. */
function key(keyValue, code, overrides = {}) {
    return {
        key: keyValue,
        code,
        repeat: false,
        preventDefault: vi.fn(),
        ...overrides,
    };
}

function createHarness({ seatTwo } = {}) {
    const settings = {
        keyBindings: { ...P1 },
        player2KeyBindings: { ...P2 },
        dasDelay: 100,
        dasInterval: 20,
        softDropInterval: 30,
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
        move: vi.fn(() => true),
        moveP2: vi.fn(() => true),
        startGame: vi.fn(),
        initSound: vi.fn(),
    };
    if (seatTwo !== undefined) gameActions.isPlayer2KeyboardActive = () => seatTwo;
    setupKeyboardControls(controller, settings, gameActions);
    return { controller, gameActions, settings };
}

beforeEach(() => {
    vi.stubGlobal('document', createEventTarget({
        activeElement: null,
        hidden: false,
        body: { classList: { contains: () => false } },
        getElementById: () => null,
    }));
    vi.stubGlobal('window', createEventTarget({ settings: null, dispatchEvent: vi.fn() }));
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('binding keys', () => {
    it('stores letters in lower case and Space by name', () => {
        expect(normalizeBindingKey('Z')).toBe('z');
        expect(normalizeBindingKey('z')).toBe('z');
        expect(normalizeBindingKey(' ')).toBe('Space');
        expect(normalizeBindingKey('ArrowLeft')).toBe('ArrowLeft');
        expect(normalizeBindingKey(undefined)).toBe('');
    });

    it('finds an action whatever case the key arrives in', () => {
        expect(findBoundAction(P1, 'Z')).toBe('rotateLeft');
        expect(findBoundAction({ rotateLeft: 'Z' }, 'z')).toBe('rotateLeft');
        expect(findBoundAction(P1, ' ')).toBe('hardDrop');
        expect(findBoundAction(P1, 'x')).toBeNull();
        expect(findBoundAction(null, 'z')).toBeNull();
        expect(isKeyBound([P1, P2], 'D')).toBe(true);
    });

    it('refuses keys a control cannot rely on', () => {
        for (const bad of ['Tab', 'CapsLock', 'Dead', 'Unidentified', 'Meta', '']) {
            expect(isBindableKey(bad)).toBe(false);
        }
        for (const good of ['z', 'Shift', 'Space', 'Enter', 'ArrowUp', 'Escape']) {
            expect(isBindableKey(good)).toBe(true);
        }
    });
});

describe('gameplay keys hold up', () => {
    it('plays letter bindings with Caps Lock on', () => {
        const { controller, gameActions } = createHarness();

        controller.handleKeyDown(key('Z', 'KeyZ'));
        controller.handleKeyDown(key('A', 'KeyA'));

        expect(gameActions.requestRotate).toHaveBeenNthCalledWith(1, 'left');
        expect(gameActions.requestRotate).toHaveBeenNthCalledWith(2, 'flip');
    });

    it('releases a held key whose keyup reads differently (Shift pressed meanwhile)', () => {
        const { controller, gameActions } = createHarness({ seatTwo: true });

        // Player 2 holds A to slide left, taps Shift to drop, lets go of A while Shift is down.
        controller.handleKeyDown(key('a', 'KeyA'));
        expect(controller.dasState.p2_moveLeft.active).toBe(true);
        controller.handleKeyDown(key('Shift', 'ShiftLeft'));
        expect(gameActions.requestHardDropP2).toHaveBeenCalledTimes(1);
        controller.handleKeyUp(key('A', 'KeyA', { shiftKey: true }));

        expect(controller.dasState.p2_moveLeft.active).toBe(false);
        expect(controller.keyMap['p2-moveLeft']).toBe(false);

        // The next press of A is a fresh move, not swallowed by a stale latch.
        controller.handleKeyDown(key('a', 'KeyA'));
        expect(gameActions.requestMoveP2).toHaveBeenCalledTimes(2);
    });

    it('releases a symbol key by its physical key', () => {
        const { controller, settings } = createHarness();
        settings.keyBindings = { ...P1, rotateLeft: '/' };

        controller.handleKeyDown(key('/', 'Slash'));
        expect(controller.keyMap.rotateLeft).toBe(true);
        controller.handleKeyUp(key('?', 'Slash', { shiftKey: true }));
        expect(controller.keyMap.rotateLeft).toBe(false);
    });

    it('gives a key both players have bound to Player 2 while a person plays seat 2', () => {
        const { controller, gameActions } = createHarness({ seatTwo: true });

        controller.handleKeyDown(key('a', 'KeyA'));

        expect(gameActions.requestMoveP2).toHaveBeenCalledWith(-1);
        expect(gameActions.requestRotate).not.toHaveBeenCalled();
    });

    it('keeps Player 2 keys out of play against a bot and outside Local Versus', () => {
        const { controller, gameActions } = createHarness({ seatTwo: false });

        controller.handleKeyDown(key('a', 'KeyA'));
        controller.handleKeyDown(key('d', 'KeyD'));
        controller.handleKeyDown(key('s', 'KeyS'));

        expect(gameActions.requestRotate).toHaveBeenCalledWith('flip');
        expect(gameActions.requestMoveP2).not.toHaveBeenCalled();
        expect(gameActions.requestSoftDropP2).not.toHaveBeenCalled();
        expect(controller.dasState.p2_softDrop.active).toBe(false);
    });

    it('forgets held keys when the window loses focus', () => {
        const { controller } = createHarness();

        controller.handleKeyDown(key('ArrowLeft', 'ArrowLeft'));
        window.dispatch('blur');

        expect(controller.heldKeyCodes.size).toBe(0);
        expect(controller.dasState.moveLeft.active).toBe(false);
    });
});

describe('rebinding in Settings', () => {
    function createManager() {
        const store = new Map();
        globalThis.localStorage = {
            getItem: (k) => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: (k) => store.delete(k),
        };
        return new SettingsManager();
    }

    function tile(id) {
        return {
            id,
            textContent: '',
            dataset: {},
            setAttribute: vi.fn(),
            classList: { remove: vi.fn(), add: vi.fn() },
        };
    }

    afterEach(() => {
        delete globalThis.localStorage;
    });

    it('swaps keys when the new key already plays another action of the set', () => {
        const manager = createManager();
        const update = vi.fn();

        handleKeybinding(key('a', 'KeyA'), tile('key-rotateLeft'), manager, update);

        const bindings = manager.get().keyBindings;
        expect(bindings.rotateLeft).toBe('a');
        expect(bindings.flip).toBe('z');
        expect(update).toHaveBeenCalledTimes(1);
    });

    it('stores a letter captured with Caps Lock in lower case', () => {
        const manager = createManager();

        handleKeybinding(key('X', 'KeyX'), tile('key-rotateLeft'), manager);

        expect(manager.get().keyBindings.rotateLeft).toBe('x');
    });

    it('keeps the binding when the key cannot be bound', () => {
        const manager = createManager();
        const update = vi.fn();

        handleKeybinding(key('Tab', 'Tab'), tile('key-hardDrop'), manager, update);
        handleKeybinding(key('CapsLock', 'CapsLock'), tile('key-hardDrop'), manager, update);

        expect(manager.get().keyBindings.hardDrop).toBe('Space');
        expect(update).not.toHaveBeenCalled();
    });

    it('repairs a saved set where two actions share a key', () => {
        const manager = createManager();
        manager.update({ keyBindings: { ...P1, flip: 'Z' } });

        const bindings = manager.get().keyBindings;
        expect(bindings.rotateLeft).toBe('z');
        expect(bindings.flip).toBe('a');
    });
});

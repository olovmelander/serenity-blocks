import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { GameState } from '../../src/core/game.js';
import { InputController, setupKeyboardControls } from '../../src/ui/controls.js';
import { GamepadController } from '../../src/ui/gamepad-controller.js';
import { OnlineChat } from '../../src/ui/online-chat.js';

function eventTarget(extra = {}) {
    const listeners = new Map();
    return {
        addEventListener(type, handler) { listeners.set(type, handler); },
        removeEventListener(type) { listeners.delete(type); },
        dispatch(type) { listeners.get(type)?.(); },
        ...extra,
    };
}

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('window', eventTarget({ settings: null }));
    vi.stubGlobal('document', eventTarget({
        hidden: false,
        activeElement: null,
        body: { classList: { contains: () => false } },
        getElementById: () => null,
    }));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('keyboard visibility lifecycle', () => {
    it('accepts the first fresh press after a key was released in a hidden tab', () => {
        const state = new GameState();
        const controller = new InputController();
        const settings = {
            keyBindings: { moveLeft: 'ArrowLeft' },
            player2KeyBindings: {},
        };
        setupKeyboardControls(controller, settings, {});
        controller.setFixedTickInputAdapter({
            isEnabled: ({ playerIndex }) => playerIndex === 0,
            resolveGameState: () => state,
        });
        const press = (repeat = false) => controller.handleKeyDown({
            key: 'ArrowLeft', code: 'ArrowLeft', repeat, preventDefault: vi.fn(),
        });
        press();
        expect(state.playerInput.pendingEdges).toHaveLength(1);

        // Visibility can change without a window blur (for example an app minimize).
        // The release while hidden never reaches this document.
        document.hidden = true;
        document.dispatch('visibilitychange');
        expect(state.playerInput.pendingEdges).toEqual([]);
        document.hidden = false;
        document.dispatch('visibilitychange');

        press(true);
        expect(state.playerInput.pendingEdges).toEqual([]);
        press();
        expect(state.playerInput.pendingEdges).toEqual([
            expect.objectContaining({ action: 'move', value: -1, phase: 'down' }),
        ]);
        controller.cleanup();
    });
});

function frameHarness() {
    const pending = new Map();
    let nextId = 0;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
        const id = nextId++;
        pending.set(id, callback);
        return id;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id) => pending.delete(id)));
    return {
        pending,
        run() {
            const callbacks = [...pending.values()];
            pending.clear();
            callbacks.forEach((callback) => callback(100));
        },
    };
}

describe('gamepad polling lifecycle', () => {
    it('does not revive a loop disabled from inside an input callback', () => {
        const frames = frameHarness();
        const controller = new GamepadController();
        controller.enabled = true;
        vi.spyOn(controller, 'poll').mockImplementation(() => controller.disable());

        controller.startPolling();
        frames.run();

        expect(frames.pending.size).toBe(0);
        expect(controller.pollInterval).toBeNull();
    });

    it('keeps only the replacement loop when a callback stops and restarts polling', () => {
        const frames = frameHarness();
        const controller = new GamepadController();
        vi.spyOn(controller, 'poll').mockImplementationOnce(() => {
            controller.stopPolling();
            controller.startPolling();
        });

        controller.startPolling();
        frames.run();

        expect(frames.pending.size).toBe(1);
        controller.stopPolling();
        expect(frames.pending.size).toBe(0);
    });

    it('treats a zero animation-frame handle as an active cancellable loop', () => {
        const frames = frameHarness();
        const controller = new GamepadController();
        controller.startPolling();
        controller.startPolling();

        expect(frames.pending.size).toBe(1);
        controller.stopPolling();
        expect(frames.pending.size).toBe(0);
    });
});

describe('chat input composition', () => {
    it.each(['Enter', 'Escape'])('leaves composing %s to the input method', (key) => {
        const input = { blur: vi.fn() };
        const send = vi.fn();
        OnlineChat.prototype._setupEventListeners.call({
            inputEl: input, sendBtn: null, _handleSend: send,
        });
        for (const composition of [{ isComposing: true }, { isComposing: false, keyCode: 229 }]) {
            const event = {
                key, ...composition, preventDefault: vi.fn(), stopPropagation: vi.fn(),
            };
            input.onkeydown(event);
            expect(send).not.toHaveBeenCalled();
            expect(input.blur).not.toHaveBeenCalled();
            expect(event.preventDefault).not.toHaveBeenCalled();
            expect(event.stopPropagation).toHaveBeenCalledOnce();
        }
    });
});

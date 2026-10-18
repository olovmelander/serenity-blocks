import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    createOdysseyGemPadControls, installOdysseyGemInput, resolveOdysseyGemKey,
} from '../../src/ui/odyssey/odyssey-gem-input.js';

function createController(bindings = {}) {
    const config = {
        moveLeft: { index: 14 },
        moveRight: { index: 15 },
        rotateRight: { index: 0 },
        rotateLeft: { index: 3 },
        flip: { index: 2 },
        softDrop: { index: 13 },
        hardDrop: { index: 1 },
        pause: { index: 9 },
        ...bindings,
    };
    return {
        gamepads: [null],
        menuNavigationEnabled: false,
        gameModeSelectionEnabled: false,
        getGameplayBindingConfig: () => config,
        getMenuSheet: () => null,
        serenityShortcutsLive: () => false,
    };
}
const gamepad = (pressed = []) => ({ buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })) });

describe('Odyssey gem input', () => {
    beforeEach(() => {
        vi.stubGlobal('document', {
            hidden: false,
            hasFocus: () => true,
            body: { classList: { contains: () => false } },
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        });
        vi.stubGlobal('window', { settings: { keyBindings: { flip: '3' } }, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('maps 1, 2 and 3 (and the numpad) to the abilities, and leaves a bound gameplay key alone', () => {
        expect(resolveOdysseyGemKey({ code: 'Digit1', key: '1' })).toBe('tide');
        expect(resolveOdysseyGemKey({ code: 'Numpad2', key: '2' })).toBe('still-air');
        expect(resolveOdysseyGemKey({ key: '3' })).toBe('second-breath');
        expect(resolveOdysseyGemKey({ code: 'KeyA', key: 'a' })).toBeNull();
        expect(resolveOdysseyGemKey({ code: 'Digit3', key: '3' }, new Set(['3']))).toBeNull();
    });

    it('takes three spare controller buttons, pressed fresh each time, never the gameplay bindings', () => {
        const controller = createController({ rotateLeft: { index: 4 } }); // LB is taken by a remap
        const onUse = vi.fn(() => true);
        const onHintChange = vi.fn();
        const controls = createOdysseyGemPadControls(controller, { isActive: () => true, onUse, onHintChange });
        expect(onHintChange).toHaveBeenLastCalledWith({ tide: 'RB', 'still-air': 'LT', 'second-breath': 'RT' });
        // Release first (arm), then press.
        controls.process(gamepad([]), 0);
        controls.process(gamepad([5]), 0);
        expect(onUse).toHaveBeenCalledExactlyOnceWith('tide');
        controls.process(gamepad([5]), 0); // held: no repeat
        expect(onUse).toHaveBeenCalledOnce();
        controls.process(gamepad([]), 0);
        controls.process(gamepad([7]), 0);
        expect(onUse).toHaveBeenLastCalledWith('second-breath');
        // Start held: nothing fires and the arming resets.
        controls.process(gamepad([9, 6]), 0);
        expect(onUse).toHaveBeenCalledTimes(2);
        expect(controls.process(gamepad([6]), 1)).toBe(false);
    });

    it('installs a capturing key listener that spends through the mode and leaves other keys untouched', () => {
        const session = { gameState: { isPaused: false, victoryLapActive: false } };
        const mode = {
            _activeLevelSession: session,
            _isLevelSessionActive: (candidate) => candidate === session,
            isPaused: false,
            useOdysseyGem: vi.fn(() => true),
            deps: { gamepadController: { setOdysseyGemControls: vi.fn(() => ({ reset: vi.fn(), dispose: vi.fn() })) } },
            odysseyHUD: { setGemPadHints: vi.fn() },
        };
        const dispose = installOdysseyGemInput(mode);
        expect(document.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true);
        const onKeyDown = document.addEventListener.mock.calls[0][1];
        const press = (init) => {
            const event = { preventDefault: vi.fn(), stopPropagation: vi.fn(), ...init };
            onKeyDown(event);
            return event;
        };
        expect(press({ code: 'Digit1', key: '1' }).preventDefault).toHaveBeenCalled();
        expect(mode.useOdysseyGem).toHaveBeenCalledWith('tide');
        // '3' is bound to flip in this player's settings: it stays a flip.
        expect(press({ code: 'Digit3', key: '3' }).preventDefault).not.toHaveBeenCalled();
        expect(press({ code: 'Digit2', key: '2', repeat: true }).preventDefault).not.toHaveBeenCalled();
        session.gameState.isPaused = true;
        expect(press({ code: 'Digit2', key: '2' }).preventDefault).not.toHaveBeenCalled();
        expect(mode.useOdysseyGem).toHaveBeenCalledOnce();
        expect(mode.deps.gamepadController.setOdysseyGemControls).toHaveBeenCalledOnce();
        dispose();
        expect(document.removeEventListener).toHaveBeenCalledWith('keydown', onKeyDown, true);
        expect(mode.deps.gamepadController.setOdysseyGemControls.mock.results[0].value.dispose).toHaveBeenCalled();
    });
});

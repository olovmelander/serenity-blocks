import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    createOdysseyCharmPadControls, installOdysseyCharmInput, odysseyReservedCharmKeys, resolveOdysseyCharmKey,
} from '../../src/ui/odyssey/odyssey-charm-input.js';
import { DEMO_FIXED_SIMULATION_CLOCK, DEMO_LEGACY_SIMULATION_CLOCK } from '../../src/core/demo/DemoRecorder.js';

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

describe('Odyssey charm input', () => {
    beforeEach(() => {
        vi.stubGlobal('document', {
            hidden: false,
            hasFocus: () => true,
            body: { classList: { contains: () => false } },
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        });
        vi.stubGlobal('window', {
            settings: { keyBindings: { flip: '3' } }, addEventListener: vi.fn(), removeEventListener: vi.fn(),
        });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('maps 1 to 4 (and the numpad) to the charms, and leaves a bound gameplay key alone', () => {
        expect(resolveOdysseyCharmKey({ code: 'Digit1', key: '1' })).toBe('tide');
        expect(resolveOdysseyCharmKey({ code: 'Numpad2', key: '2' })).toBe('still-air');
        expect(resolveOdysseyCharmKey({ key: '3' })).toBe('long-breath');
        expect(resolveOdysseyCharmKey({ code: 'Digit4', key: '4' })).toBe('hearth');
        expect(resolveOdysseyCharmKey({ code: 'Digit5', key: '5' })).toBeNull();
        expect(resolveOdysseyCharmKey({ code: 'KeyA', key: 'a' })).toBeNull();
        expect(resolveOdysseyCharmKey({ code: 'Digit3', key: '3' }, new Set(['3']))).toBeNull();
        // The live settings first, then the window's; a key bound to a move is reserved.
        const live = { deps: { settingsManager: { get: () => ({ keyBindings: { hardDrop: '1' } }) } } };
        expect(odysseyReservedCharmKeys(live)).toEqual(new Set(['1']));
        expect(odysseyReservedCharmKeys({})).toEqual(new Set(['3']));
    });

    it('takes four spare controller buttons, pressed fresh each time, never a gameplay binding, Select or R3', () => {
        const controller = createController({ rotateLeft: { index: 4 } }); // LB is taken by a remap
        const onUse = vi.fn(() => true);
        const onHintChange = vi.fn();
        const controls = createOdysseyCharmPadControls(controller, { isActive: () => true, onUse, onHintChange });
        // No controller yet: the tiles show no button labels.
        expect(onHintChange).toHaveBeenLastCalledWith({});
        // Release first (arm), then press. The first poll of a controller labels the tiles.
        controls.process(gamepad([]), 0);
        expect(onHintChange).toHaveBeenLastCalledWith({
            tide: 'RB', 'still-air': 'LT', 'long-breath': 'RT', hearth: 'L3',
        });
        expect(onHintChange).toHaveBeenCalledTimes(2);
        controls.process(gamepad([5]), 0);
        expect(onHintChange).toHaveBeenCalledTimes(2);
        expect(onUse).toHaveBeenCalledExactlyOnceWith('tide');
        controls.process(gamepad([5]), 0); // held: no repeat
        expect(onUse).toHaveBeenCalledOnce();
        controls.process(gamepad([]), 0);
        controls.process(gamepad([10]), 0);
        expect(onUse).toHaveBeenLastCalledWith('hearth');
        // Start held: nothing fires and the arming resets.
        controls.process(gamepad([9, 6]), 0);
        expect(onUse).toHaveBeenCalledTimes(2);
        expect(controls.process(gamepad([6]), 1)).toBe(false);
        // Select (the lap's Finish) and R3 (the tower look) are never taken, however crowded the pad.
        const crowded = createController({
            rotateLeft: { index: 4 }, flip: { index: 5 }, hardDrop: { index: 6 }, softDrop: { index: 7 }, rotateRight: { index: 10 },
        });
        const hints = vi.fn();
        createOdysseyCharmPadControls(crowded, { isActive: () => true, onUse, onHintChange: hints })
            .process(gamepad([]), 0);
        expect(hints).toHaveBeenLastCalledWith({ tide: 'X', 'still-air': 'Y' });
    });

    it('installs a capturing key listener that uses through the mode, shows a refusal, and leaves bound keys alone', () => {
        const session = {
            gameState: { isPaused: false, victoryLapActive: false }, simulationClock: DEMO_LEGACY_SIMULATION_CLOCK,
        };
        const mode = {
            _activeLevelSession: session,
            _isLevelSessionActive: (candidate) => candidate === session,
            isPaused: false,
            isInExplorationMode: false,
            useOdysseyCharm: vi.fn(() => ({ ok: true })),
            deps: { gamepadController: { setOdysseyCharmControls: vi.fn(() => ({ reset: vi.fn(), dispose: vi.fn() })) } },
            odysseyHUD: { setCharmPadHints: vi.fn(), flashCharmReason: vi.fn() },
        };
        const dispose = installOdysseyCharmInput(mode);
        expect(document.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true);
        const onKeyDown = document.addEventListener.mock.calls[0][1];
        const press = (init) => {
            const event = { preventDefault: vi.fn(), stopPropagation: vi.fn(), ...init };
            onKeyDown(event);
            return event;
        };
        expect(press({ code: 'Digit1', key: '1' }).preventDefault).toHaveBeenCalled();
        expect(mode.useOdysseyCharm).toHaveBeenCalledWith('tide');
        // '3' is bound to flip in this player's settings: it stays a flip.
        expect(press({ code: 'Digit3', key: '3' }).preventDefault).not.toHaveBeenCalled();
        expect(press({ code: 'Digit2', key: '2', repeat: true }).preventDefault).not.toHaveBeenCalled();
        // A refused press costs nothing and shows its reason on the chip.
        mode.useOdysseyCharm.mockReturnValue({ ok: false, reason: 'no-clock' });
        expect(press({ code: 'Digit4', key: '4' }).preventDefault).not.toHaveBeenCalled();
        expect(mode.odysseyHUD.flashCharmReason).toHaveBeenCalledWith('hearth', 'no-clock');
        mode.useOdysseyCharm.mockReturnValue({ ok: true });
        session.gameState.isPaused = true;
        expect(press({ code: 'Digit2', key: '2' }).preventDefault).not.toHaveBeenCalled();
        session.gameState.isPaused = false;
        // The tower look owns the pad and the keys while the player looks around.
        mode.isInExplorationMode = true;
        expect(press({ code: 'Digit2', key: '2' }).preventDefault).not.toHaveBeenCalled();
        mode.isInExplorationMode = false;
        expect(mode.useOdysseyCharm).toHaveBeenCalledTimes(2);
        const pad = mode.deps.gamepadController.setOdysseyCharmControls;
        expect(pad).toHaveBeenCalledOnce();
        const callbacks = pad.mock.calls[0][0];
        expect(callbacks.isActive()).toBe(true);
        callbacks.onHintChange({ tide: 'LB' });
        expect(mode.odysseyHUD.setCharmPadHints).toHaveBeenCalledWith({ tide: 'LB' });
        expect(callbacks.onUse('hearth')).toBe(true);
        dispose();
        expect(document.removeEventListener).toHaveBeenCalledWith('keydown', onKeyDown, true);
        expect(pad.mock.results[0].value.dispose).toHaveBeenCalled();
        expect(callbacks.isActive()).toBe(false);
    });

    it('installs nothing on the fixed-tick clock, where charms are refused', () => {
        const session = { gameState: {}, simulationClock: DEMO_FIXED_SIMULATION_CLOCK };
        const mode = {
            _activeLevelSession: session,
            _isLevelSessionActive: () => true,
            useOdysseyCharm: vi.fn(),
            deps: { gamepadController: { setOdysseyCharmControls: vi.fn() } },
        };
        const dispose = installOdysseyCharmInput(mode);
        expect(document.addEventListener).not.toHaveBeenCalled();
        expect(mode.deps.gamepadController.setOdysseyCharmControls).not.toHaveBeenCalled();
        expect(() => dispose()).not.toThrow();
    });
});

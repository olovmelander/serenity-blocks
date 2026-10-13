/**
 * A menu that takes or gives back the pad latches the buttons held at that moment until
 * they are released (audit 2026-10-13: INPUT-03). B or A that closed the pause sheet
 * also hard-dropped or rotated on the next poll, and a button held when a menu appeared
 * chose on it at once.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { GamepadController } from '../../src/ui/gamepad-controller.js';

const BUTTON = { A: 0, B: 1 }; // A rotates right and B hard-drops in play (constants.js)

function createHarness() {
    let settingsVisible = false;
    let controller = null;
    const settingsModal = {
        classList: { contains: (name) => name === 'visible' && settingsVisible },
        querySelector: () => null,
        querySelectorAll: () => [],
        getAttribute: () => null,
        contains: () => true,
        getClientRects: () => [1],
    };
    const closeButton = {
        click: vi.fn(() => {
            settingsVisible = false;
            controller.disableMenuNavigation();
        }),
    };
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('document', {
        addEventListener() {},
        removeEventListener() {},
        querySelector: () => null,
        querySelectorAll: () => [],
        getElementById: (id) => ({ 'settings-modal': settingsModal, 'close-settings': closeButton }[id] || null),
        body: { classList: { contains: () => false, add() {}, remove() {} } },
        // The pause sheet's focused Resume control.
        activeElement: { matches: () => false, click: () => closeButton.click() },
    });
    const pad = {
        index: 0,
        id: 'pad',
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    };
    vi.stubGlobal('navigator', { getGamepads: () => [pad] });

    controller = new GamepadController();
    controller.enabled = true;
    controller.gamepads[0] = pad;
    controller.connected[0] = true;
    const actions = {
        move: vi.fn(), rotate: vi.fn(), softDrop: vi.fn(), hardDrop: vi.fn(), togglePause: vi.fn(),
    };
    controller.setGameActions(actions);
    const press = (...indices) => {
        pad.buttons.forEach((button, index) => {
            button.pressed = indices.includes(index);
            button.value = button.pressed ? 1 : 0;
        });
        controller.poll();
    };
    const openSettings = () => {
        settingsVisible = true;
        controller.enableMenuNavigation();
    };
    return {
        actions, closeButton, controller, openSettings, press,
    };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('gamepad buttons held across a menu change', () => {
    it('B that closes the pause sheet does not also hard-drop', () => {
        const { actions, closeButton, openSettings, press } = createHarness();
        openSettings();
        press();
        press(BUTTON.B);
        expect(closeButton.click).toHaveBeenCalledOnce();
        press(BUTTON.B); // still held on the next poll, back in play
        press(BUTTON.B);
        expect(actions.hardDrop).not.toHaveBeenCalled();

        press(); // released: the next press plays again
        press(BUTTON.B);
        expect(actions.hardDrop).toHaveBeenCalledOnce();
    });

    it('A that resumes from the pause sheet does not also rotate', () => {
        const { actions, closeButton, openSettings, press } = createHarness();
        openSettings();
        press();
        press(BUTTON.A);
        expect(closeButton.click).toHaveBeenCalledOnce();
        press(BUTTON.A);
        expect(actions.rotate).not.toHaveBeenCalled();

        press();
        press(BUTTON.A);
        expect(actions.rotate).toHaveBeenCalledExactlyOnceWith('right');
    });

    it('needs a fresh press on a menu that appears while a button is held', () => {
        const { controller, openSettings, press } = createHarness();
        const activate = vi.spyOn(controller, 'activateMenuItem').mockImplementation(() => {});
        press(BUTTON.A); // mashing rotate as the menu appears
        openSettings();
        press(BUTTON.A);
        press(BUTTON.A);
        expect(activate).not.toHaveBeenCalled();

        press();
        press(BUTTON.A);
        expect(activate).toHaveBeenCalledOnce();
    });
});

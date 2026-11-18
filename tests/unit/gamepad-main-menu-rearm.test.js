/**
 * The main menu's pad handler follows the menu (audit 2026-11-18, A18-UI-1).
 *
 * It was armed once at boot and switched off at the first mode start, so every later visit
 * to the menu ran on the generic menu handler, and closing Settings or Records there handed
 * the pad to gameplay: D-pad, A and B did nothing on the menu.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { GamepadController } from '../../src/ui/gamepad-controller.js';
import { ModalManager } from '../../src/ui/modals.js';

const BUTTON = { A: 0, B: 1, D_DOWN: 13 };

function fakeElement(id, classes = []) {
    const classSet = new Set(classes);
    const element = {
        id,
        classList: {
            add: (...names) => names.forEach((name) => classSet.add(name)),
            remove: (...names) => names.forEach((name) => classSet.delete(name)),
            contains: (name) => classSet.has(name),
            toggle: (name, force) => {
                const on = force ?? !classSet.has(name);
                if (on) classSet.add(name); else classSet.delete(name);
                return on;
            },
        },
        children: [],
        querySelector: () => null,
        querySelectorAll: () => [],
        getAttribute: () => null,
        setAttribute: () => {},
        getClientRects: () => [1],
        contains(other) {
            return other === element || element.children.includes(other);
        },
        focus() {
            globalThis.document.activeElement = element;
        },
        click: vi.fn(),
    };
    return element;
}

function createHarness() {
    const card = fakeElement('single-player-card-btn', ['game-mode-card']);
    const start = fakeElement('start-modal', ['modal']);
    start.children.push(card);
    const modals = {
        'start-modal': start,
        'game-over-modal': fakeElement('game-over-modal', ['modal']),
        'demo-complete-modal': fakeElement('demo-complete-modal', ['modal']),
        'settings-modal': fakeElement('settings-modal', ['modal']),
        'high-scores-modal': fakeElement('high-scores-modal', ['modal']),
    };
    const body = fakeElement('body');
    const windowTarget = new EventTarget();
    vi.stubGlobal('window', {
        addEventListener: windowTarget.addEventListener.bind(windowTarget),
        removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
        dispatchEvent: windowTarget.dispatchEvent.bind(windowTarget),
    });
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('document', {
        addEventListener() {},
        removeEventListener() {},
        hasFocus: () => true,
        querySelector: () => null,
        querySelectorAll: (selector) => (selector === '.game-mode-card' ? [card] : []),
        getElementById: (id) => modals[id] || null,
        body,
        activeElement: body,
    });
    const pad = {
        index: 0,
        id: 'pad',
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    };
    vi.stubGlobal('navigator', { getGamepads: () => [pad] });

    const controller = new GamepadController();
    controller.enabled = true;
    controller.gamepads[0] = pad;
    controller.connected[0] = true;
    controller.setGameActions({
        move: vi.fn(), rotate: vi.fn(), softDrop: vi.fn(), hardDrop: vi.fn(), togglePause: vi.fn(),
    });
    const modalManager = new ModalManager(controller);
    const press = (...indices) => {
        pad.buttons.forEach((button, index) => {
            button.pressed = indices.includes(index);
            button.value = button.pressed ? 1 : 0;
        });
        controller.poll();
    };
    // The boot and mode-start calls main.js makes.
    const boot = () => {
        modalManager.show('start');
        controller.enableGameModeSelection();
    };
    const startMode = () => {
        controller.disableGameModeSelection();
        modalManager.hideAll();
    };
    const returnToMenu = () => {
        modalManager.hideAll();
        modalManager.show('start');
    };
    return {
        controller, modalManager, press, card, boot, startMode, returnToMenu,
    };
}

describe('the main menu pad handler after a game', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('walks the mode list on a second visit after Settings has been opened and closed', () => {
        const {
            controller, modalManager, press, boot, startMode, returnToMenu,
        } = createHarness();
        boot();
        startMode();
        returnToMenu();
        modalManager.show('settings');
        modalManager.hide('settings');

        // Which handler owns the pad is the question here, not what it does with the press.
        const selection = vi.spyOn(controller, 'processGameModeSelection').mockImplementation(() => {});
        const gameplay = vi.spyOn(controller, 'processGamepadInput').mockImplementation(() => {});
        press(BUTTON.D_DOWN);

        expect(selection).toHaveBeenCalled();
        expect(gameplay).not.toHaveBeenCalled();
        expect(controller.isInLivePlay()).toBe(false);
    });

    it('does not let the A still held from the results screen start the focused mode', () => {
        const {
            press, card, boot, startMode, returnToMenu,
        } = createHarness();
        boot();
        startMode();
        card.focus();
        press(BUTTON.A); // A held as the menu comes back
        returnToMenu();
        press(BUTTON.A);
        press(BUTTON.A);
        expect(card.click).not.toHaveBeenCalled();

        press();
        press(BUTTON.A);
        expect(card.click).toHaveBeenCalledTimes(1);
    });

    it('keeps held gameplay input when hideAll runs with the menu already hidden', () => {
        const {
            controller, modalManager, boot, startMode,
        } = createHarness();
        boot();
        startMode();
        const disable = vi.spyOn(controller, 'disableGameModeSelection');
        modalManager.hideAll(); // as resumeGame does mid-run
        expect(disable).not.toHaveBeenCalled();
    });
});

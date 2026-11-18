/**
 * The main menu keeps the mode it remembers when it shows (audit 2026-11-18, A18-UI-3).
 *
 * The controller's first-focus pass, 100 ms after any menu shows, focused the first focusable
 * control of the page when no sheet was open, so the main menu jumped to Single Player even
 * with no pad connected. The main menu places its own focus (main-menu.js focusCurrentForKeys).
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { GamepadController } from '../../src/ui/gamepad-controller.js';
import { ModalManager } from '../../src/ui/modals.js';

const BUTTON = { A: 0 };

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
        offsetParent: {},
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

function createMenu() {
    const cards = ['single', 'infinity', 'odyssey'].map((mode) => fakeElement(`${mode}-card-btn`, ['game-mode-card']));
    const start = fakeElement('start-modal', ['modal']);
    start.children.push(...cards);
    const modals = {
        'start-modal': start,
        'game-over-modal': fakeElement('game-over-modal', ['modal']),
        'demo-complete-modal': fakeElement('demo-complete-modal', ['modal']),
        'settings-modal': fakeElement('settings-modal', ['modal']),
        'high-scores-modal': fakeElement('high-scores-modal', ['modal']),
    };
    const body = fakeElement('body');
    vi.stubGlobal('window', {
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {},
        getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    });
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('document', {
        addEventListener() {},
        removeEventListener() {},
        hasFocus: () => true,
        querySelector: () => null,
        // The page's focusables in document order: the mode list comes first.
        querySelectorAll: (selector) => (selector === '.game-mode-card' || selector.includes('button') ? cards : []),
        getElementById: (id) => modals[id] || null,
        body,
        activeElement: body,
    });
    return { cards, body };
}

describe('the main menu showing again', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('keeps the remembered mode focused with no pad connected', () => {
        const { cards } = createMenu();
        vi.stubGlobal('navigator', { getGamepads: () => [] });
        const controller = new GamepadController();
        const modalManager = new ModalManager(controller);

        cards[2].focus(); // the remembered mode (main-menu.js focusCurrentForKeys)
        modalManager.show('start');
        vi.advanceTimersByTime(120);

        expect(document.activeElement).toBe(cards[2]);
    });

    it('plays the mode the menu shows when A comes with nothing focused', () => {
        const { cards } = createMenu();
        cards[2].classList.add('is-current'); // main-menu.js marks the mode its stage shows
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
        const modalManager = new ModalManager(controller);

        modalManager.show('start');
        pad.buttons[BUTTON.A].pressed = true;
        controller.poll();

        expect(cards[0].click).not.toHaveBeenCalled();
        expect(cards[2].click).toHaveBeenCalledTimes(1);
    });
});

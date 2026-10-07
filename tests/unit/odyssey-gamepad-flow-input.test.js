import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { GamepadController } from '../../src/ui/gamepad-controller.js';
import { getOpenSheet, installSheetInput } from '../../src/ui/sheet-input.js';
import { createPlayerInputState } from '../../src/core/player-input-state.js';

const BUTTON = {
    A: 0, B: 1, START: 9, LEFT: 14, RIGHT: 15,
};

function createHarness(id = 'odyssey-flow-overlay') {
    const elements = new Map();
    const body = { classList: { contains: () => false } };
    const doc = {
        body,
        activeElement: body,
        getElementById: (key) => elements.get(key) || null,
    };
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', {
        getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    });
    const pad = {
        index: 0,
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
        axes: [0, 0, 0, 0],
    };
    vi.stubGlobal('navigator', { getGamepads: () => [pad] });
    const makeButton = (action, index) => ({
        action,
        hidden: false,
        offsetParent: body,
        classList: { contains: () => false },
        checkVisibility() { return !this.hidden; },
        matches: () => false,
        focus() { doc.activeElement = this; },
        click: vi.fn(),
        scrollIntoView: vi.fn(),
        getBoundingClientRect: () => ({
            left: index * 120, right: index * 120 + 100, top: 0, bottom: 40, width: 100, height: 40,
        }),
    });
    const buttons = ['next', 'pause', 'map'].map(makeButton);
    const sheet = {
        id,
        isConnected: true,
        classList: { contains: () => false },
        checkVisibility() { return this.isConnected; },
        contains: (element) => buttons.includes(element),
        querySelectorAll(selector) {
            if (selector.includes('data-flow-action')) {
                return buttons.filter((button) => selector.includes(`"${button.action}"`));
            }
            if (selector === '.sb-ody-actions button:first-child') return [buttons[0]];
            if (selector === '.sb-ody-actions button:last-child') return [buttons.at(-1)];
            return buttons;
        },
        querySelector(selector) {
            if (selector === '.modal-content') return null;
            return this.querySelectorAll(selector)[0] || null;
        },
    };
    elements.set(id, sheet);
    const controller = new GamepadController();
    controller.enabled = true;
    controller.gamepads[0] = pad;
    controller.connected[0] = true;
    const actions = {
        move: vi.fn(), rotate: vi.fn(), softDrop: vi.fn(), hardDrop: vi.fn(), togglePause: vi.fn(),
    };
    controller.setGameActions(actions);
    const press = (...indices) => {
        pad.buttons.forEach((button, index) => { button.pressed = indices.includes(index); });
        controller.poll();
    };
    const remove = () => {
        elements.delete(id);
        sheet.isConnected = false;
        doc.activeElement = body;
    };
    return {
        actions, buttons, controller, doc, elements, pad, press, remove, sheet,
    };
}

beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Odyssey gamepad flow ownership', () => {
    it.each([
        ['odyssey-flow-overlay', 'odysseyFlow'],
        ['odyssey-failure-modal', 'odysseyFailure'],
        ['odyssey-results-modal', 'odysseyResults'],
    ])('routes %s to its focused action without a .visible class', (id, name) => {
        const {
            actions, buttons, controller, doc, press,
        } = createHarness(id);
        controller.gameModeSelectionEnabled = true;
        const modeSelection = vi.spyOn(controller, 'processGameModeSelection');
        expect(getOpenSheet(doc)?.name).toBe(name);

        // A/B from the finishing lock cannot accept a result or go back.
        press(BUTTON.A, BUTTON.B);
        press(BUTTON.A, BUTTON.B);
        expect(buttons.every((button) => button.click.mock.calls.length === 0)).toBe(true);
        press();
        buttons.at(-1).focus();
        press(BUTTON.A);

        expect(buttons.at(-1).click).toHaveBeenCalledTimes(1);
        expect(buttons[0].click).not.toHaveBeenCalled();
        expect(actions.rotate).not.toHaveBeenCalled();
        expect(actions.hardDrop).not.toHaveBeenCalled();
        expect(modeSelection).not.toHaveBeenCalled();
    });

    it('keeps spatial navigation inside Odyssey and sends B to Map', () => {
        const {
            buttons, controller, doc, press, sheet,
        } = createHarness();
        // The document body deliberately has no querySelectorAll: falling back
        // to it would navigate the controls behind this dialog (or fail here).
        press();
        press(BUTTON.RIGHT);
        expect(doc.activeElement).toBe(buttons[1]);
        expect(controller.getFocusableElements()).toEqual(buttons);
        expect(controller.getMenuSheet()?.element).toBe(sheet);
        press();
        press(BUTTON.B);
        expect(buttons[2].click).toHaveBeenCalledTimes(1);
    });

    it('repairs outside focus before A instead of activating a control behind the dialog', () => {
        const { buttons, doc, press } = createHarness();
        press();
        const outside = { click: vi.fn(), matches: () => false };
        doc.activeElement = outside;
        press(BUTTON.A);
        expect(outside.click).not.toHaveBeenCalled();
        expect(buttons[0].click).toHaveBeenCalledTimes(1);
    });

    it('repairs outside slider focus before a direction can adjust hidden settings', () => {
        const { buttons, doc, press } = createHarness();
        press();
        const slider = {
            value: '50',
            min: '0',
            max: '100',
            step: '1',
            matches: (selector) => selector === 'input[type="range"]',
            dispatchEvent: vi.fn(),
        };
        doc.activeElement = slider;
        press(BUTTON.RIGHT);
        expect(slider.value).toBe('50');
        expect(slider.dispatchEvent).not.toHaveBeenCalled();
        expect(doc.activeElement).toBe(buttons[1]);
    });

    it('preserves held drop, movement and confirm across next-board menu resets until release', () => {
        const {
            actions, buttons, controller, press, remove,
        } = createHarness();
        controller.startDas(0, 'left', actions.move);
        press(BUTTON.B, BUTTON.LEFT);
        expect(controller.dasState[0].left.active).toBe(false);
        buttons[0].click.mockImplementation(() => {
            remove();
            controller.clearAllDasTimers();
            controller.disableMenuNavigation();
        });
        press(BUTTON.A, BUTTON.B, BUTTON.LEFT);
        expect(buttons[0].click).toHaveBeenCalledTimes(1);
        press(BUTTON.A, BUTTON.B, BUTTON.LEFT);
        controller.advanceGameplayInput(1000);
        expect(actions.rotate).not.toHaveBeenCalled();
        expect(actions.hardDrop).not.toHaveBeenCalled();
        expect(actions.move).not.toHaveBeenCalled();

        press();
        press(BUTTON.A, BUTTON.B, BUTTON.LEFT);
        expect(actions.rotate).toHaveBeenCalledWith('right');
        expect(actions.hardDrop).toHaveBeenCalledTimes(1);
        expect(actions.move).toHaveBeenCalledWith(-1);
    });

    it('also latches custom bindings and analogue movement at an automatic continuation', () => {
        const {
            actions, controller, pad, press, remove,
        } = createHarness();
        controller.updateBindings({ hardDrop: 4 });
        pad.axes[0] = -1;
        press(4);
        remove(); // The countdown, rather than a button, continues this level.
        controller.disableMenuNavigation();
        press(4);
        expect(actions.move).not.toHaveBeenCalled();
        expect(actions.hardDrop).not.toHaveBeenCalled();
        pad.axes[0] = 0;
        press();
        pad.axes[0] = -1;
        press(4);
        expect(actions.move).toHaveBeenCalledWith(-1);
        expect(actions.hardDrop).toHaveBeenCalledTimes(1);
    });

    it('clears the previous fixed-tick board and does not queue held input on its replacement', () => {
        const {
            actions, controller, press, remove,
        } = createHarness();
        const previousBoard = { simFrame: 8, playerInput: createPlayerInputState() };
        const nextBoard = { simFrame: 0, playerInput: createPlayerInputState() };
        let board = previousBoard;
        controller.setFixedTickInputAdapter({
            isEnabled: () => true,
            resolveGameState: () => board,
        });
        // A movement edge queued just before the finishing lock must not outlive it.
        controller.pressFixedTickAction(0, 'left', 'move', -1);
        expect(previousBoard.playerInput.pendingEdges).toHaveLength(1);
        press(BUTTON.B, BUTTON.LEFT);
        expect(previousBoard.playerInput.pendingEdges).toEqual([]);
        board = nextBoard;
        remove();
        controller.disableMenuNavigation();
        press(BUTTON.B, BUTTON.LEFT);
        expect(nextBoard.playerInput.pendingEdges).toEqual([]);
        press();
        press(BUTTON.B, BUTTON.LEFT);
        expect(nextBoard.playerInput.pendingEdges).toEqual([
            expect.objectContaining({ action: 'move', value: -1, phase: 'down' }),
            expect.objectContaining({ action: 'hardDrop', phase: 'down' }),
        ]);
        expect(actions.move).not.toHaveBeenCalled();
        expect(actions.hardDrop).not.toHaveBeenCalled();
    });

    it('does not open a global Settings or Serenity shortcut behind the journey dialog', () => {
        const { controller, press } = createHarness();
        const settings = vi.spyOn(controller, 'toggleSettings');
        controller.serenityModeActive = true;
        controller.serenityModeCallbacks = { toggleHub: vi.fn(), isHubOpen: () => false };
        press();
        press(BUTTON.START, 8);
        expect(settings).not.toHaveBeenCalled();
        expect(controller.serenityModeCallbacks.toggleHub).not.toHaveBeenCalled();
    });

    it('keeps an inert portal cue in charge without focusing or activating its controls', () => {
        const {
            actions, buttons, controller, doc, press, remove, sheet,
        } = createHarness();
        const settings = vi.spyOn(controller, 'toggleSettings').mockImplementation(() => {});
        press();
        sheet.inert = true;
        doc.activeElement = doc.body;
        expect(controller.getMenuSheet()?.element).toBe(sheet);
        press(BUTTON.A, BUTTON.B, BUTTON.START, BUTTON.LEFT);
        press(BUTTON.A, BUTTON.B, BUTTON.START, BUTTON.LEFT);
        controller.advanceGameplayInput(1000);
        expect(doc.activeElement).toBe(doc.body);
        expect(buttons.every((button) => button.click.mock.calls.length === 0)).toBe(true);
        expect(settings).not.toHaveBeenCalled();
        expect(Object.values(actions).every((action) => action.mock.calls.length === 0)).toBe(true);

        remove();
        controller.disableMenuNavigation();
        press(BUTTON.A, BUTTON.B, BUTTON.START, BUTTON.LEFT);
        expect(settings).not.toHaveBeenCalled();
        expect(Object.values(actions).every((action) => action.mock.calls.length === 0)).toBe(true);
        press();
        press(BUTTON.A, BUTTON.B, BUTTON.LEFT);
        expect(actions.rotate).toHaveBeenCalledWith('right');
        expect(actions.hardDrop).toHaveBeenCalledTimes(1);
        expect(actions.move).toHaveBeenCalledWith(-1);
    });

    it('requires release before controls react when an inert cue becomes a visible hold', () => {
        const { buttons, press, sheet } = createHarness();
        sheet.inert = true;
        press(BUTTON.A, BUTTON.B);
        sheet.inert = false;
        press(BUTTON.A, BUTTON.B);
        expect(buttons.every((button) => button.click.mock.calls.length === 0)).toBe(true);
        press();
        press(BUTTON.A);
        expect(buttons[0].click).toHaveBeenCalledTimes(1);
    });

    it('leaves inert cue keyboard cancellation to the overlay instead of the generic sheet handler', () => {
        const { buttons, doc, sheet } = createHarness();
        let keyboardHandler;
        doc.addEventListener = (type, handler) => {
            if (type === 'keydown') keyboardHandler = handler;
        };
        window.addEventListener = vi.fn();
        installSheetInput(doc);
        sheet.inert = true;
        for (const key of ['Escape', 'Tab']) {
            const event = { key, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
            keyboardHandler(event);
            expect(event.preventDefault).not.toHaveBeenCalled();
            expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
        }
        expect(buttons.every((button) => button.click.mock.calls.length === 0)).toBe(true);
        expect(doc.activeElement).toBe(doc.body);
    });

    it('retains Settings priority and ignores a detached Odyssey dialog', () => {
        const { controller, elements, sheet } = createHarness();
        const settings = { classList: { contains: (name) => name === 'visible' } };
        elements.set('settings-modal', settings);
        expect(controller.getMenuSheet()?.name).toBe('settings');
        elements.delete('settings-modal');
        sheet.isConnected = false;
        expect(controller.getMenuSheet()).toBeNull();
    });

    it.each(['odyssey-failure-modal', 'odyssey-results-modal'])('still ignores inert %s', (id) => {
        const { controller, sheet } = createHarness(id);
        sheet.inert = true;
        expect(controller.getMenuSheet()).toBeNull();
    });
});

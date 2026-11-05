/**
 * A held direction repeats until its release is seen, and the switch between play and the menus
 * wipes the states a release is seen against. A direction held into the results sheet went on
 * repeating through the next run with nothing held, until that direction was tapped.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { GamepadController } from '../../src/ui/gamepad-controller.js';

const DPAD_DOWN = 13;
const DPAD_LEFT = 14;
const FRAME_MS = 16;

function harness() {
    const pad = {
        index: 0,
        id: 'test pad',
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    };
    vi.stubGlobal('navigator', { getGamepads: () => [pad] });

    const actions = {
        move: vi.fn(() => true),
        rotate: vi.fn(),
        softDrop: vi.fn(() => true),
        hardDrop: vi.fn(),
        togglePause: vi.fn(),
    };
    const controller = new GamepadController();
    controller.enabled = true;
    controller.gamepads[0] = pad;
    controller.connected[0] = true;
    controller.setGameActions(actions);

    const hold = (...buttons) => {
        pad.buttons.forEach((button, index) => {
            button.pressed = buttons.includes(index);
            button.value = button.pressed ? 1 : 0;
        });
        controller.poll();
    };
    let now = 1000;
    const play = (ms, ...buttons) => {
        controller.advanceGameplayInput(now);
        for (let spent = 0; spent < ms; spent += FRAME_MS) {
            now += FRAME_MS;
            hold(...buttons);
            controller.advanceGameplayInput(now);
        }
    };
    return { actions, controller, hold, play };
}

describe('a pad direction across the end of a run', () => {
    let sheetVisible;

    beforeEach(() => {
        sheetVisible = false;
        const sheet = {
            classList: { contains: (name) => name === 'visible' && sheetVisible },
            dataset: {},
        };
        vi.stubGlobal('requestAnimationFrame', () => 0);
        vi.stubGlobal('cancelAnimationFrame', () => {});
        vi.stubGlobal('window', {
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => {},
        });
        vi.stubGlobal('CustomEvent', class {});
        vi.stubGlobal('document', {
            addEventListener: () => {},
            removeEventListener: () => {},
            querySelector: () => null,
            querySelectorAll: () => [],
            getElementById: (id) => (id === 'game-over-modal' ? sheet : null),
            body: { classList: { contains: () => false, add() {}, remove() {} } },
            activeElement: { matches: () => false, click() {} },
            hasFocus: () => true,
        });
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    /** Held at the top-out, released on the sheet, then the menu and a new run from a card. */
    function endRunHolding(direction, { actions, controller, hold }) {
        hold(direction);
        sheetVisible = true;
        hold(direction);
        hold(direction);
        hold();
        sheetVisible = false;
        controller.enableMenuNavigation();
        hold();
        controller.disableGameModeSelection();
        controller.disableMenuNavigation();
        vi.clearAllMocks();
        return actions;
    }

    it.each([
        ['soft drop', DPAD_DOWN, 'softDrop'],
        ['move', DPAD_LEFT, 'move'],
    ])('leaves no %s repeating in the next run', (_name, direction, action) => {
        const pad = harness();

        const actions = endRunHolding(direction, pad);
        pad.play(2000);

        expect(actions[action]).not.toHaveBeenCalled();
    });

    it('stops repeating as soon as the results sheet is up, even while still held', () => {
        const pad = harness();
        pad.hold(DPAD_LEFT);
        pad.play(300, DPAD_LEFT);
        expect(pad.actions.move.mock.calls.length).toBeGreaterThan(1);

        sheetVisible = true;
        pad.hold(DPAD_LEFT);
        pad.actions.move.mockClear();
        pad.play(1000, DPAD_LEFT);

        expect(pad.actions.move).not.toHaveBeenCalled();
    });

    it('stops a repeat left running when a menu takes over from play', () => {
        const pad = harness();
        pad.hold(DPAD_LEFT);
        pad.controller.enableMenuNavigation();
        pad.controller.disableMenuNavigation();
        pad.actions.move.mockClear();

        pad.hold();
        pad.play(1000);

        expect(pad.actions.move).not.toHaveBeenCalled();
    });

    it('still repeats a direction the player presses in the new run', () => {
        const pad = harness();
        endRunHolding(DPAD_LEFT, pad);

        pad.play(600, DPAD_LEFT);

        expect(pad.actions.move.mock.calls.length).toBeGreaterThan(1);
    });

    it('still repeats through ordinary play', () => {
        const pad = harness();

        pad.play(600, DPAD_DOWN);

        expect(pad.actions.softDrop.mock.calls.length).toBeGreaterThan(1);
    });
});

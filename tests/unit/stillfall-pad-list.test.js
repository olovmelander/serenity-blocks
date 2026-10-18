/**
 * The Stillfall puzzle list on a gamepad (stillfall-pad-list.js) through the real
 * GamepadController poll: Select opens the list, which then owns the pad (up and down walk
 * it, A plays, B or Select closes); nothing it takes reaches the piece, and the A that chose
 * a puzzle does not rotate the new piece when the list lets go. Start still pauses.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { GamepadController } from '../../src/ui/gamepad-controller.js';
import { createPuzzleListPadControls } from '../../src/ui/stillfall/stillfall-pad-list.js';

const BUTTON = {
    A: 0, B: 1, SELECT: 8, START: 9, D_UP: 12, D_DOWN: 13,
};

function createHarness() {
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('document', {
        hidden: false,
        hasFocus: () => true,
        addEventListener() {},
        removeEventListener() {},
        querySelector: () => null,
        querySelectorAll: () => [],
        getElementById: () => null,
        body: { classList: { contains: () => false, add() {}, remove() {} } },
        activeElement: null,
    });
    const pad = {
        index: 0, id: 'pad', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    };
    vi.stubGlobal('navigator', { getGamepads: () => [pad] });

    const controller = new GamepadController();
    controller.enabled = true;
    controller.gamepads[0] = pad;
    controller.connected[0] = true;
    const actions = {
        move: vi.fn(), rotate: vi.fn(), softDrop: vi.fn(), hardDrop: vi.fn(), togglePause: vi.fn(),
    };
    controller.setGameActions(actions);

    let time = 0;
    const list = { open: false, active: true };
    const hud = {
        onOpen: vi.fn(() => { list.open = true; }),
        onMove: vi.fn(),
        onChoose: vi.fn(() => { list.open = false; }),
        onClose: vi.fn(() => { list.open = false; }),
    };
    const controls = controller.setPanelControls(createPuzzleListPadControls(controller, {
        isActive: () => list.active,
        isListOpen: () => list.open,
        ...hud,
        now: () => time,
    }));
    const press = (...indices) => {
        pad.buttons.forEach((button, index) => {
            button.pressed = indices.includes(index);
            button.value = button.pressed ? 1 : 0;
        });
        controller.poll();
    };
    const wait = (ms) => { time += ms; };
    return {
        actions, controls, controller, hud, list, press, wait,
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

describe('the Stillfall puzzle list on a gamepad', () => {
    it('opens on Select and leaves every other button to the piece while closed', () => {
        const { actions, hud, press } = createHarness();
        press();
        press(BUTTON.A);
        expect(actions.rotate).toHaveBeenCalledTimes(1);
        press();
        press(BUTTON.SELECT);
        expect(hud.onOpen).toHaveBeenCalledTimes(1);
        expect(actions.rotate).toHaveBeenCalledTimes(1);
    });

    it('walks the list, repeating on hold, and none of it moves or drops the piece', () => {
        const {
            actions, hud, press, wait,
        } = createHarness();
        press();
        press(BUTTON.SELECT);
        press();
        press(BUTTON.D_DOWN);
        expect(hud.onMove).toHaveBeenLastCalledWith(1);
        wait(200);
        press(BUTTON.D_DOWN);
        expect(hud.onMove).toHaveBeenCalledTimes(1);
        wait(300);
        press(BUTTON.D_DOWN);
        expect(hud.onMove).toHaveBeenCalledTimes(2);
        press();
        press(BUTTON.D_UP);
        expect(hud.onMove).toHaveBeenLastCalledWith(-1);
        expect(actions.softDrop).not.toHaveBeenCalled();
        expect(actions.move).not.toHaveBeenCalled();
    });

    it('plays the marked puzzle on A, and that A never rotates the new piece', () => {
        const { actions, hud, press } = createHarness();
        press();
        press(BUTTON.SELECT);
        press();
        press(BUTTON.A);
        expect(hud.onChoose).toHaveBeenCalledTimes(1);
        // Still held as the list lets go: latched until released.
        press(BUTTON.A);
        press(BUTTON.A);
        expect(actions.rotate).not.toHaveBeenCalled();
        press();
        press(BUTTON.A);
        expect(actions.rotate).toHaveBeenCalledTimes(1);
    });

    it('closes on B or Select without dropping the piece', () => {
        const { actions, hud, press } = createHarness();
        press();
        press(BUTTON.SELECT);
        press();
        press(BUTTON.B);
        expect(hud.onClose).toHaveBeenCalledTimes(1);
        press(BUTTON.B);
        expect(actions.hardDrop).not.toHaveBeenCalled();
        press();
        press(BUTTON.SELECT);
        press();
        press(BUTTON.SELECT);
        expect(hud.onClose).toHaveBeenCalledTimes(2);
    });

    it('ignores a press that began elsewhere, gives way to Start, and sleeps while covered', () => {
        const {
            hud, list, press, controls,
        } = createHarness();
        press(BUTTON.SELECT); // held before the list ever saw it up
        expect(hud.onOpen).not.toHaveBeenCalled();
        press();
        list.active = false; // a sheet or the Hub covers the board
        press(BUTTON.SELECT);
        expect(hud.onOpen).not.toHaveBeenCalled();
        list.active = true;
        press();
        press(BUTTON.SELECT, BUTTON.START);
        expect(hud.onOpen).not.toHaveBeenCalled();
        controls.dispose();
        press();
        press(BUTTON.SELECT);
        expect(hud.onOpen).not.toHaveBeenCalled();
    });
});

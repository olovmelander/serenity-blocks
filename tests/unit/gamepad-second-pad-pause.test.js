/**
 * Start closing Settings holds that press back until it is released. Only player 1's flag was ever
 * let go in play, so pads 2 to 4 lost their pause after unpausing with Start, until some other
 * menu happened to clear it.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { GamepadController } from '../../src/ui/gamepad-controller.js';

const START = 9;

function padAt(index) {
    return {
        index,
        id: `pad ${index}`,
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    };
}

function harness(slot) {
    const pads = [padAt(0), padAt(1), padAt(2), padAt(3)];
    vi.stubGlobal('navigator', { getGamepads: () => pads });
    const togglePause = vi.fn();
    const controller = new GamepadController();
    controller.enabled = true;
    pads.forEach((pad, index) => {
        controller.gamepads[index] = pad;
        controller.connected[index] = true;
    });
    const actions = {
        move: vi.fn(), rotate: vi.fn(), softDrop: vi.fn(), hardDrop: vi.fn(), togglePause,
    };
    controller.setGameActions(actions);
    controller.setPlayer2Actions?.(actions);
    controller.setPlayerActions?.(slot, actions);

    const press = (held) => {
        pads[slot].buttons[START].pressed = held;
        pads[slot].buttons[START].value = held ? 1 : 0;
        controller.poll();
    };
    const tap = () => { press(true); press(false); };
    return { controller, press, tap, togglePause };
}

describe('Start on pads 2 to 4, in play', () => {
    beforeEach(() => {
        vi.stubGlobal('requestAnimationFrame', () => 0);
        vi.stubGlobal('cancelAnimationFrame', () => {});
        vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} });
        vi.stubGlobal('CustomEvent', class {});
        vi.stubGlobal('document', {
            addEventListener() {},
            removeEventListener() {},
            querySelector: () => null,
            querySelectorAll: () => [],
            getElementById: () => null,
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

    /** What closing Settings with Start leaves behind (toggleSettings). */
    const closeSettingsWithStart = ({ controller }, slot) => { controller.waitingForStartRelease[slot] = true; };

    it.each([1, 2, 3])('pauses again after pad %i closed Settings with Start', (slot) => {
        const pad = harness(slot);
        pad.press(true);
        closeSettingsWithStart(pad, slot);
        pad.press(true); // still held: this press belonged to Settings
        pad.press(false); // released
        pad.togglePause.mockClear();

        pad.tap();

        expect(pad.togglePause).toHaveBeenCalledOnce();
    });

    it('holds the press back until it is released', () => {
        const pad = harness(1);
        pad.press(true);
        closeSettingsWithStart(pad, 1);
        pad.togglePause.mockClear();

        pad.press(true);
        pad.press(true);

        expect(pad.togglePause).not.toHaveBeenCalled();
        expect(pad.controller.waitingForStartRelease[1]).toBe(true);
    });
});

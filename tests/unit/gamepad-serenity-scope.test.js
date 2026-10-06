import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { GamepadController } from '../../src/ui/gamepad-controller.js';

const Y = 3;
const RB = 5;

function pad() {
    return {
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
        axes: [0, 0, 0, 0],
    };
}

/** The always-loaded Hub registers Serenity's pad shortcuts at startup, in every mode. */
function setup(bodyClasses) {
    vi.spyOn(performance, 'now').mockReturnValue(10000);
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', { body: { classList: { contains: (name) => bodyClasses.has(name) } } });
    const controller = new GamepadController();
    const callbacks = { toggleHub: vi.fn(), nextTrack: vi.fn(), isHubOpen: () => false };
    controller.enableSerenityMode(callbacks);
    return { controller, callbacks };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Serenity pad shortcuts', () => {
    it('stay out of other modes: Y and RB play the game instead of opening the Hub', () => {
        const { controller, callbacks } = setup(new Set());
        const gamepad = pad();
        gamepad.buttons[Y].pressed = true;
        gamepad.buttons[RB].pressed = true;

        controller.processGamepadInput(gamepad, 0);

        expect(controller.serenityShortcutsLive()).toBe(false);
        expect(callbacks.toggleHub).not.toHaveBeenCalled();
        expect(callbacks.nextTrack).not.toHaveBeenCalled();
    });

    it('work in Serenity Mode', () => {
        const { controller, callbacks } = setup(new Set(['serenity-mode']));
        const gamepad = pad();
        gamepad.buttons[Y].pressed = true;

        controller.processGamepadInput(gamepad, 0);

        expect(controller.serenityShortcutsLive()).toBe(true);
        expect(callbacks.toggleHub).toHaveBeenCalledTimes(1);
    });

    it('still drive an open Hub from any mode', () => {
        const { controller, callbacks } = setup(new Set());
        callbacks.isHubOpen = () => true;
        callbacks.closeHub = vi.fn();
        const gamepad = pad();
        gamepad.buttons[1].pressed = true; // B

        controller.processGamepadInput(gamepad, 0);

        expect(callbacks.closeHub).toHaveBeenCalledTimes(1);
    });
});

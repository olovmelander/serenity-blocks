import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

vi.mock('../../src/themes/base-theme.js', () => ({ setGlobalRenderScale: vi.fn() }));
vi.mock('../../src/ui/serenity-hub/SerenityHub.js', () => ({ SerenityHub: class {} }));

import { SerenityMode } from '../../src/core/game-modes/SerenityMode.js';
import { GamepadController } from '../../src/ui/gamepad-controller.js';

/**
 * Serenity Mode's keys: ← → change the theme (or, in a practice, its breathing world), ↑ ↓ the
 * music volume, , . the song, M mute, D drift; bare keys only, held keys repeat only for the
 * volume, the open Hub keeps its own keys, and while the rest veil is down any key only
 * brings the world back.
 */

let mode;
let ui;
let guide;
let bindings;

beforeEach(() => {
    bindings = {};
    guide = { isActive: false, isExternallyControlled: false, cycleTechnique: vi.fn() };
    vi.stubGlobal('window', { breathingIndicator: guide });
    vi.stubGlobal('document', { getElementById: () => null, body: { classList: { remove: vi.fn() } } });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mode = new SerenityMode({ settingsManager: { get: () => ({ serenityKeyBindings: bindings }), update: vi.fn() } });
    mode.isRunning = true;
    mode.isActive = true;
    ui = {
        resting: false,
        stepWorld: vi.fn(),
        nudgeVolume: vi.fn(),
        stepSong: vi.fn(),
        toggleMute: vi.fn(),
        toggleDrift: vi.fn(),
        randomWorld: vi.fn(),
        toggleFullscreen: vi.fn(),
        wakeFromRest: vi.fn(() => true),
        notice: vi.fn(),
    };
    mode.ui = ui;
    mode.serenityHub = { isOpen: false, toggle: vi.fn(), toggleButtonHints: vi.fn() };
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const press = (key, extra = {}) => {
    const event = {
        key, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra,
    };
    mode._onKeyPress(event);
    return event;
};

describe('Serenity keys', () => {
    it('change the theme with the arrows, and keep the page from scrolling', () => {
        const event = press('ArrowRight');
        press('ArrowLeft');
        expect(ui.stepWorld.mock.calls).toEqual([[1], [-1]]);
        expect(event.preventDefault).toHaveBeenCalled();
    });

    it('change the breathing world instead while a practice is open, and nothing in a session', () => {
        guide.isActive = true;
        press('ArrowRight');
        expect(guide.cycleTechnique).toHaveBeenCalledWith(1);
        guide.isExternallyControlled = true;
        press('ArrowLeft');
        expect(guide.cycleTechnique).toHaveBeenCalledTimes(1);
        expect(ui.stepWorld).not.toHaveBeenCalled();
    });

    it('play the music: volume, songs, mute, and drift', () => {
        press('ArrowUp');
        press('ArrowDown');
        press(',');
        press('.');
        press('m');
        press('D');
        press('b');
        expect(ui.nudgeVolume.mock.calls).toEqual([[1], [-1]]);
        expect(ui.stepSong.mock.calls).toEqual([[-1], [1]]);
        expect(ui.toggleMute).toHaveBeenCalledOnce();
        expect(ui.toggleDrift).toHaveBeenCalledOnce();
        expect(ui.randomWorld).toHaveBeenCalledOnce();
    });

    it('repeat while held only for the volume', () => {
        press('ArrowRight', { repeat: true });
        press('h', { repeat: true });
        press('ArrowUp', { repeat: true });
        expect(ui.stepWorld).not.toHaveBeenCalled();
        expect(mode.serenityHub.toggle).not.toHaveBeenCalled();
        expect(ui.nudgeVolume).toHaveBeenCalledOnce();
    });

    it('are bare keys: Ctrl+F, Alt+H and typing in a field belong elsewhere', () => {
        press('f', { ctrlKey: true });
        press('h', { altKey: true });
        press('d', { target: { closest: (selector) => (selector.includes('input') ? {} : null) } });
        expect(ui.toggleFullscreen).not.toHaveBeenCalled();
        expect(mode.serenityHub.toggle).not.toHaveBeenCalled();
        expect(ui.toggleDrift).not.toHaveBeenCalled();
    });

    it('leave the open Hub its arrows, but still close it and go full screen', () => {
        mode.serenityHub.isOpen = true;
        press('ArrowRight');
        press('m');
        press('h');
        press('f');
        expect(ui.stepWorld).not.toHaveBeenCalled();
        expect(ui.toggleMute).not.toHaveBeenCalled();
        expect(mode.serenityHub.toggle).toHaveBeenCalledOnce();
        expect(ui.toggleFullscreen).toHaveBeenCalledOnce();
    });

    it('only wake the world while it rests, even Escape', () => {
        ui.resting = true;
        press('Escape');
        press('ArrowRight');
        expect(ui.wakeFromRest).toHaveBeenCalledTimes(2);
        expect(ui.stepWorld).not.toHaveBeenCalled();
    });

    it('follow the player\'s own bindings', () => {
        bindings.nextTheme = 'n';
        press('n');
        press('ArrowRight');
        expect(ui.stepWorld.mock.calls).toEqual([[1]]);
    });

    it('name a breathing world chosen with the guide closed, and how to begin it', () => {
        guide.techniques = { 'ocean-tide': { name: 'Ocean Tide' } };
        guide.cycleTechnique.mockImplementation(() => { guide.currentTechnique = 'ocean-tide'; });
        press('t');
        expect(ui.notice).toHaveBeenCalledWith('Ocean Tide · Space to begin');
    });
});

describe('Serenity on a controller', () => {
    function setup({ resting = false } = {}) {
        vi.spyOn(performance, 'now').mockReturnValue(10000);
        vi.stubGlobal('window', {});
        vi.stubGlobal('document', { body: { classList: { contains: (name) => name === 'serenity-mode' } } });
        const controller = new GamepadController();
        const callbacks = {
            isHubOpen: () => false,
            stepWorld: vi.fn(),
            sessionPrimary: vi.fn(),
            toggleHub: vi.fn(),
            isResting: () => resting,
            wakeFromRest: vi.fn(),
        };
        controller.enableSerenityMode(callbacks);
        const gamepad = {
            buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
            axes: [0, 0, 0, 0],
        };
        return { controller, callbacks, gamepad };
    }

    it('changes the theme with the D-pad\'s left and right, once per press', () => {
        const { controller, callbacks, gamepad } = setup();
        gamepad.buttons[15].pressed = true;
        controller.processGamepadInput(gamepad, 0);
        controller.processGamepadInput(gamepad, 0);
        gamepad.buttons[15].pressed = false;
        gamepad.buttons[14].pressed = true;
        controller.processGamepadInput(gamepad, 0);
        expect(callbacks.stepWorld.mock.calls).toEqual([[1], [-1]]);
    });

    it('wakes a resting world with any button and does nothing else', () => {
        const { controller, callbacks, gamepad } = setup({ resting: true });
        gamepad.buttons[3].pressed = true; // Y
        controller.processGamepadInput(gamepad, 0);
        expect(callbacks.wakeFromRest).toHaveBeenCalledOnce();
        expect(callbacks.toggleHub).not.toHaveBeenCalled();
        // Awake now, the held Y still does nothing until it is let go.
        callbacks.isResting = () => false;
        controller.processGamepadInput(gamepad, 0);
        expect(callbacks.toggleHub).not.toHaveBeenCalled();
        gamepad.buttons[3].pressed = false;
        controller.processGamepadInput(gamepad, 0);
        gamepad.buttons[3].pressed = true;
        controller.processGamepadInput(gamepad, 0);
        expect(callbacks.toggleHub).toHaveBeenCalledOnce();
    });
});

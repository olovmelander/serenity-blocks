/**
 * The controller holds up (2026-10-26): a radial deadzone that reads one axis at a time,
 * a press that restarts from game over or comes back to a focused window waits for its
 * release, the Hub opened over a menu answers the pad, one menu press from two pads is
 * one press, and saved controller bindings are repaired.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { GamepadController } from '../../src/ui/gamepad-controller.js';
import { SettingsManager, handleGamepadBinding } from '../../src/ui/settings.js';

const A = 0;
const B = 1;
const START = 9;

function pad({ buttons = [], axes = [0, 0, 0, 0] } = {}) {
    return {
        index: 0,
        id: 'pad',
        mapping: 'standard',
        axes,
        buttons: Array.from({ length: 17 }, (_, index) => ({
            pressed: buttons.includes(index), value: buttons.includes(index) ? 1 : 0,
        })),
    };
}

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('stick reading', () => {
    it('reads only the stronger axis, past a round deadzone', () => {
        const controller = new GamepadController();
        // Fully left, 15 degrees below horizontal: a move, not a move and a soft drop.
        const leftAndALittleDown = pad({ axes: [-0.96, 0.26, 0, 0] });
        expect(controller.isAxisNegative(leftAndALittleDown, 0)).toBe(true);
        expect(controller.isAxisPositive(leftAndALittleDown, 1)).toBe(false);
        // Inside the circle, even where one axis alone would pass the old square test.
        expect(controller.isAxisNegative(pad({ axes: [-0.2, 0.1, 0, 0] }), 0)).toBe(false);
        // An exact diagonal reads as horizontal.
        const diagonal = pad({ axes: [0.6, 0.6, 0, 0] });
        expect(controller.isAxisPositive(diagonal, 0)).toBe(true);
        expect(controller.isAxisPositive(diagonal, 1)).toBe(false);
        expect(controller.isAxisNegative(diagonal, undefined)).toBe(false);
    });

    it('keeps the deadzone in a safe range whatever was saved', () => {
        const controller = new GamepadController();
        controller.deadzone = 0;
        expect(controller.deadzone).toBe(0.1);
        controller.updateDeadzone(5);
        expect(controller.deadzone).toBe(0.9);
        controller.deadzone = 'nonsense';
        expect(controller.deadzone).toBe(0.25);
    });
});

describe('presses that change what owns the pad', () => {
    function controllerWith(gamepad) {
        vi.stubGlobal('requestAnimationFrame', () => 0);
        vi.stubGlobal('cancelAnimationFrame', () => {});
        vi.stubGlobal('navigator', { getGamepads: () => [gamepad] });
        const controller = new GamepadController();
        controller.enabled = true;
        controller.gamepads[0] = gamepad;
        controller.connected[0] = true;
        return controller;
    }

    it('keeps a restart press held into the new run', () => {
        const held = pad({ buttons: [START, A] });
        const controller = controllerWith(held);
        controller.latchAllHeld(held, 0);
        expect(controller.waitingForStartRelease[0]).toBe(true);
        expect(controller.odysseyHeldInputs[0].rotateRight).toBe(true);
        expect(controller.odysseyHeldInputs[0].menuStart).toBe(true);
        expect(controller.previousStates[0].gameModeSelect).toBe(true);
    });

    it('lets nothing act while the window is in the background, then waits for releases', () => {
        const gamepad = pad({ buttons: [B] });
        const controller = controllerWith(gamepad);
        let focused = false;
        vi.stubGlobal('document', {
            hasFocus: () => focused,
            body: { classList: { contains: () => false, add() {}, remove() {} } },
            getElementById: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
            activeElement: null,
        });
        const actions = {
            hardDrop: vi.fn(), move: vi.fn(), rotate: vi.fn(), softDrop: vi.fn(), togglePause: vi.fn(),
        };
        controller.setGameActions(actions);
        const clear = vi.spyOn(controller, 'clearDasTimers');

        controller.poll();
        expect(clear).toHaveBeenCalled();
        expect(actions.hardDrop).not.toHaveBeenCalled();

        focused = true;
        controller.poll(); // back in front: B is still held, so it is latched
        controller.poll();
        expect(actions.hardDrop).not.toHaveBeenCalled();

        gamepad.buttons[B].pressed = false;
        controller.poll();
        gamepad.buttons[B].pressed = true;
        controller.poll();
        expect(actions.hardDrop).toHaveBeenCalledOnce();
    });

    it('lets the Hub opened over a menu take the pad', () => {
        const controller = new GamepadController();
        const closeHub = vi.fn();
        controller.menuNavigationEnabled = true;
        controller.enableSerenityMode({ isHubOpen: () => true, closeHub, navigate: vi.fn() });
        vi.stubGlobal('window', { settingsManager: null });
        controller.processSerenityModeInput(pad(), 0);
        controller.processSerenityModeInput(pad({ buttons: [B] }), 0);
        expect(closeHub).toHaveBeenCalledOnce();
    });
});

describe('menus on every controller', () => {
    it('acts once on one press that two pads report together', () => {
        let now = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        const controller = new GamepadController();
        expect(controller.claimMenuAction(0, 'down')).toBe(true);
        expect(controller.claimMenuAction(1, 'down')).toBe(false);
        expect(controller.claimMenuAction(0, 'down')).toBe(true);
        now += 500;
        expect(controller.claimMenuAction(1, 'down')).toBe(true);
    });
});

describe('saved controller bindings', () => {
    function createManager() {
        const store = new Map();
        globalThis.localStorage = {
            getItem: (key) => (store.has(key) ? store.get(key) : null),
            setItem: (key, value) => store.set(key, String(value)),
            removeItem: (key) => store.delete(key),
        };
        vi.stubGlobal('window', { dispatchEvent: vi.fn() });
        return { manager: new SettingsManager(), store };
    }

    afterEach(() => {
        delete globalThis.localStorage;
    });

    it('repairs a dead or shared button on load', () => {
        const { manager, store } = createManager();
        store.set(manager.STORAGE_KEY, JSON.stringify({
            gamepadBindings: { hardDrop: -1, rotateLeft: 2.5, flip: 0 },
        }));
        manager.load();
        const bindings = manager.get().gamepadBindings;
        expect(bindings.hardDrop).toBe(1);
        expect(bindings.rotateLeft).toBe(3);
        // flip took A from rotate right; rotate right keeps it, flip goes back to X.
        expect(bindings.rotateRight).toBe(0);
        expect(bindings.flip).toBe(2);
    });

    it('swaps buttons on a capture, and keeps the menu buttons for the menus', () => {
        vi.useFakeTimers();
        const { manager } = createManager();
        let pressed = -1;
        vi.stubGlobal('navigator', {
            getGamepads: () => [{
                index: 0,
                buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: index === pressed, value: 0 })),
            }],
        });
        vi.stubGlobal('document', { getElementById: () => null, addEventListener() {}, removeEventListener() {} });
        const tile = {
            id: 'gamepad-hardDrop',
            textContent: '',
            dataset: {},
            setAttribute() {},
            classList: { add() {}, remove() {}, contains: () => false },
        };
        handleGamepadBinding(tile, manager);
        pressed = START;
        vi.advanceTimersByTime(60);
        expect(manager.get().gamepadBindings.hardDrop).toBe(1);
        pressed = A;
        vi.advanceTimersByTime(60);
        expect(manager.get().gamepadBindings.hardDrop).toBe(0);
        expect(manager.get().gamepadBindings.rotateRight).toBe(1);

        // Pause takes only a menu button: a swap would hand Start to a move.
        handleGamepadBinding({ ...tile, id: 'gamepad-pause' }, manager);
        pressed = -1;
        vi.advanceTimersByTime(60);
        pressed = A;
        vi.advanceTimersByTime(60);
        expect(manager.get().gamepadBindings.pause).toBe(START);
        pressed = 8;
        vi.advanceTimersByTime(60);
        expect(manager.get().gamepadBindings.pause).toBe(8);
        vi.useRealTimers();
    });
});

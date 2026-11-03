/**
 * A replay and an online spectator on a controller: the replay bar (A play/pause, B stop,
 * D-pad seek, LB / RB speed) and the spectator's spotlight (D-pad left / right) were
 * mouse-only.
 */
import { describe, expect, it, vi } from 'vitest';
import { createReplayPadControls, REPLAY_SEEK_STEP_MS } from '../../src/ui/replay-pad-controls.js';
import { createSpectatorPadControls } from '../../src/ui/spectator-pad-controls.js';

const BUTTON = Object.freeze({
    A: 0, B: 1, LB: 4, RB: 5, VIEW: 8, START: 9, D_LEFT: 14, D_RIGHT: 15,
});

function pad() {
    return { axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false })) };
}

function hold(gamepad, ...indices) {
    gamepad.buttons.forEach((button, index) => { button.pressed = indices.includes(index); });
}

function controllerStub() {
    return {
        odysseyHeldInputs: [null, null, null, null],
        getGameplayPressedState: vi.fn(() => ({})),
        clearFixedTickInput: vi.fn(),
        clearDasTimers: vi.fn(),
        isAxisNegative: (gamepad, axis) => (gamepad.axes[axis] || 0) < -0.5,
        isAxisPositive: (gamepad, axis) => (gamepad.axes[axis] || 0) > 0.5,
    };
}

function replayHarness({ active = true } = {}) {
    let time = 0;
    const state = { active };
    const callbacks = {
        isActive: () => state.active,
        togglePlayPause: vi.fn(),
        stop: vi.fn(),
        seekBy: vi.fn(),
        stepSpeed: vi.fn(),
        now: () => time,
    };
    const controller = controllerStub();
    const controls = createReplayPadControls(controller, callbacks);
    const gamepad = pad();
    const poll = (...buttons) => {
        hold(gamepad, ...buttons);
        return controls.process(gamepad, 0);
    };
    return {
        callbacks, controller, controls, gamepad, poll, state, advance: (ms) => { time += ms; },
    };
}

describe('a replay on a controller', () => {
    it('plays and pauses on A, stops on B, and takes the poll', () => {
        const { callbacks, poll } = replayHarness();
        expect(poll()).toBe(true); // every button seen up
        expect(poll(BUTTON.A)).toBe(true);
        poll();
        poll(BUTTON.B);

        expect(callbacks.togglePlayPause).toHaveBeenCalledTimes(1);
        expect(callbacks.stop).toHaveBeenCalledTimes(1);
    });

    it('seeks with the D-pad, repeating while it is held', () => {
        const { callbacks, poll, advance } = replayHarness();
        poll();
        poll(BUTTON.D_RIGHT);
        advance(300);
        poll(BUTTON.D_RIGHT);
        advance(200);
        poll(BUTTON.D_RIGHT); // 500 ms: the repeat
        poll();
        poll(BUTTON.D_LEFT);

        expect(callbacks.seekBy.mock.calls).toEqual([
            [REPLAY_SEEK_STEP_MS], [REPLAY_SEEK_STEP_MS], [-REPLAY_SEEK_STEP_MS],
        ]);
    });

    it('steps the speed on LB and RB', () => {
        const { callbacks, poll } = replayHarness();
        poll();
        poll(BUTTON.RB);
        poll();
        poll(BUTTON.LB);

        expect(callbacks.stepSpeed.mock.calls).toEqual([[1], [-1]]);
    });

    it('ignores a button already held when the bar took the pad', () => {
        const { callbacks, poll } = replayHarness();
        poll(BUTTON.A, BUTTON.D_RIGHT);

        expect(callbacks.togglePlayPause).not.toHaveBeenCalled();
        expect(callbacks.seekBy).not.toHaveBeenCalled();
    });

    it('lets Menu and View through (Settings, the Hub), and stands aside under a menu', () => {
        const { callbacks, poll, state } = replayHarness();
        poll();
        expect(poll(BUTTON.START)).toBe(false);
        expect(poll(BUTTON.VIEW)).toBe(false);

        state.active = false;
        expect(poll(BUTTON.A)).toBe(false);
        expect(callbacks.togglePlayPause).not.toHaveBeenCalled();
    });

    it('keeps what it took from the game behind it', () => {
        const { controller, poll } = replayHarness();
        poll(BUTTON.A);

        expect(controller.getGameplayPressedState).toHaveBeenCalled();
        expect(controller.clearDasTimers).toHaveBeenCalledWith(0);
    });
});

describe('an online spectator on a controller', () => {
    it('walks the spotlight with the D-pad and never takes the poll', () => {
        const step = vi.fn();
        let active = true;
        const controls = createSpectatorPadControls({ isActive: () => active, step });
        const gamepad = pad();

        hold(gamepad);
        expect(controls.process(gamepad, 0)).toBe(false);
        hold(gamepad, BUTTON.D_RIGHT);
        controls.process(gamepad, 0);
        controls.process(gamepad, 0); // held: once
        hold(gamepad, BUTTON.D_LEFT);
        controls.process(gamepad, 0);

        expect(step.mock.calls).toEqual([[1], [-1]]);

        active = false;
        hold(gamepad);
        controls.process(gamepad, 0);
        hold(gamepad, BUTTON.D_RIGHT);
        controls.process(gamepad, 0);
        expect(step).toHaveBeenCalledTimes(2);
    });

    it('answers only the first controller', () => {
        const step = vi.fn();
        const controls = createSpectatorPadControls({ isActive: () => true, step });
        const gamepad = pad();
        controls.process(gamepad, 1);
        hold(gamepad, BUTTON.D_RIGHT);
        expect(controls.process(gamepad, 1)).toBe(false);
        expect(step).not.toHaveBeenCalled();
    });
});

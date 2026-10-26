/**
 * A direction held in a menu repeats (2026-10-26): once on the press, then after a delay
 * at a steady rate, so a long list or a slider no longer takes one press per step. A
 * direction already held when a menu takes the pad still waits for its release.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { GamepadController } from '../../src/ui/gamepad-controller.js';

let now = 0;

beforeEach(() => {
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** Drive one direction over time: [ms since start, pressed] samples, one poll each. */
function drive(controller, samples, key = 'menuDown') {
    const fired = [];
    const prev = controller.previousStates[0];
    const start = now;
    for (const [at, pressed] of samples) {
        now = start + at;
        if (controller.menuDirectionFires(0, key, pressed, Boolean(prev[key]))) fired.push(at);
        prev[key] = pressed;
    }
    return fired;
}

describe('menu direction repeat', () => {
    it('acts on the press, then repeats while held after the delay', () => {
        const controller = new GamepadController();
        const { menuNavigationRepeatDelay: delay, menuNavigationRepeatInterval: interval } = controller;
        const samples = [];
        for (let t = 0; t <= delay + interval * 3; t += 16) samples.push([t, true]);
        const fired = drive(controller, samples);

        expect(fired[0]).toBe(0);
        expect(fired.length).toBe(4);
        expect(fired[1]).toBeGreaterThanOrEqual(delay);
        expect(fired[2] - fired[1]).toBeGreaterThanOrEqual(interval);
    });

    it('does not repeat a quick tap, and a new press starts over', () => {
        const controller = new GamepadController();
        const fired = drive(controller, [[0, true], [80, true], [120, false], [200, true], [260, false]]);
        expect(fired).toEqual([0, 200]);
    });

    it('keeps a direction held when the menu took the pad latched until it is released', () => {
        const controller = new GamepadController();
        const pad = {
            buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: index === 13, value: index === 13 ? 1 : 0 })),
            axes: [0, 0, 0, 0],
        };
        controller.latchMenuButtons(pad, 0);
        expect(controller.previousStates[0].menuDown).toBe(true);

        const fired = drive(controller, [[0, true], [500, true], [1500, true], [1600, false], [1700, true]]);
        expect(fired).toEqual([1700]);
    });
});

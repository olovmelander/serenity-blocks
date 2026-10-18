import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { FrameRateController } from '../../src/core/frame-rate-controller.js';

function createController() {
    const controller = new FrameRateController();
    controller.isRunning = true;
    controller.updateCallback = vi.fn();
    return controller;
}

describe('FrameRateController hybrid logic ownership', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('treats pause and resume as idempotent one-owner transitions', () => {
        const controller = createController();
        controller.logicTimeoutId = 17;
        const schedule = vi.spyOn(controller, '_scheduleLogicUpdate').mockImplementation(() => {
            controller.logicTimeoutId = 18;
        });

        controller.pauseHybridLoop();
        controller.pauseHybridLoop();
        expect(controller.logicPaused).toBe(true);
        expect(controller.logicTimeoutId).toBeNull();

        controller.resumeHybridLoop();
        controller.resumeHybridLoop();
        expect(controller.logicPaused).toBe(false);
        expect(schedule).toHaveBeenCalledOnce();
        expect(controller.logicTimeoutId).toBe(18);
    });

    it('does not resurrect scheduling when pause occurs inside a logic callback', () => {
        const controller = createController();
        const schedule = vi.spyOn(controller, '_scheduleLogicUpdate');
        controller.updateCallback = vi.fn(() => controller.pauseHybridLoop());
        controller.logicTimeoutId = 21;

        controller._logicTick();

        expect(controller.updateCallback).toHaveBeenCalledOnce();
        expect(controller.logicPaused).toBe(true);
        expect(controller.logicTimeoutId).toBeNull();
        expect(schedule).toHaveBeenCalledOnce();
        expect(schedule).toHaveReturned();
    });

    it('ignores a naked resume while the existing logic owner is active', () => {
        const controller = createController();
        controller.logicTimeoutId = 31;
        const schedule = vi.spyOn(controller, '_scheduleLogicUpdate');

        controller.resumeHybridLoop();

        expect(schedule).not.toHaveBeenCalled();
        expect(controller.logicTimeoutId).toBe(31);
    });

    it('runs display-synced logic once per render frame, with no timer, and honours pause', () => {
        // Odyssey audit 2026-10-18: the duel's timer-driven logic gave each shown frame 0, 1 or
        // 2 updates at a 60 cap on a 120-165 Hz panel.
        const frames = [];
        vi.stubGlobal('requestAnimationFrame', (callback) => { frames.push(callback); return frames.length; });
        vi.stubGlobal('cancelAnimationFrame', () => {});
        const timeout = vi.spyOn(globalThis, 'setTimeout');
        try {
            const controller = new FrameRateController();
            const logic = vi.fn();
            const render = vi.fn();
            controller.startHybridLoop(logic, render, { displaySynced: true });
            const start = controller.lastLogicTime;
            expect(timeout).not.toHaveBeenCalled();

            frames.shift()(start + 7.6);
            frames.shift()(start + 15.2);
            expect(logic.mock.calls.map(([, delta]) => delta))
                .toEqual([expect.closeTo(7.6, 6), expect.closeTo(7.6, 6)]);
            expect(render).toHaveBeenCalledTimes(2);

            controller.pauseHybridLoop();
            frames.shift()(start + 22.8);
            expect(logic).toHaveBeenCalledTimes(2); // held, while the paused screen still draws
            expect(render).toHaveBeenCalledTimes(3);
            controller.resumeHybridLoop();
            expect(timeout).not.toHaveBeenCalled();

            controller.stopHybridLoop();
            expect(controller.displaySynced).toBe(false);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

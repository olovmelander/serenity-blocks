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
});

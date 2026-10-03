import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { FrameRateController } from '../../src/core/frame-rate-controller.js';

function controller() {
    vi.stubGlobal('window', undefined);
    vi.spyOn(performance, 'now').mockReturnValue(0);
    return new FrameRateController();
}

function recordSecond(subject, fps, second) {
    for (let frame = 1; frame <= fps; frame++) {
        subject.recordFrame(Math.round(second * 1000 + frame * (1000 / fps)));
    }
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('FrameRateController rolling metrics', () => {
    it('matches rolling statistics through history eviction and reset', () => {
        const subject = controller();
        const expected = [];
        for (let second = 0; second < 125; second++) {
            const fps = 30 + (second % 5) * 30;
            recordSecond(subject, fps, second);
            expected.push(fps);
            if (expected.length > 120) expected.shift();
            expect(subject.getStats()).toEqual({
                current: fps,
                average: Math.round(expected.reduce((sum, value) => sum + value, 0) / expected.length),
                min: Math.min(...expected),
                max: Math.max(...expected),
                logicUPS: 0,
            });
        }
        subject.resetStats();
        expect(subject.getStats()).toEqual({
            current: 0, average: 0, min: 0, max: 0, logicUPS: 0,
        });
        recordSecond(subject, 75, 0);
        expect(subject.getStats().average).toBe(75);
    });

    it('does not rescan history per render while returning isolated, current metrics', () => {
        const subject = controller();
        recordSecond(subject, 60, 0);
        const min = vi.spyOn(Math, 'min');
        const max = vi.spyOn(Math, 'max');
        const iterator = vi.spyOn(subject.fpsHistory, Symbol.iterator);
        const first = subject.getStats();
        first.average = -1;
        subject.logicUpdatesPerSecond = 144;
        for (let frame = 0; frame < 120; frame++) subject.recordFrame(1000 + frame);
        expect(subject.getStats()).toEqual({
            current: 60, average: 60, min: 60, max: 60, logicUPS: 144,
        });
        expect(iterator).not.toHaveBeenCalled();
        expect(min).not.toHaveBeenCalled();
        expect(max).not.toHaveBeenCalled();
    });
});

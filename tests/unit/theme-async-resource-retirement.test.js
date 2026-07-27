import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { FluidEmitters } from '../../src/themes/electric-dreams-v3/sim/fluid-emitters.js';

describe('theme async resource retirement', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('cancels delayed fluid impulses when the owning theme detaches', () => {
        vi.useFakeTimers();
        const sim = { pushImpulse: vi.fn() };
        const emitters = new FluidEmitters(sim);

        emitters._onLineClear({ lineCount: 4 });
        expect(sim.pushImpulse).toHaveBeenCalledTimes(1);

        emitters.detach();
        vi.advanceTimersByTime(100);

        expect(sim.pushImpulse).toHaveBeenCalledTimes(1);
        expect(emitters._timerIds.size).toBe(0);
    });

    it('cancels the repeating game-over impulse chain on detach', () => {
        vi.useFakeTimers();
        const sim = { pushImpulse: vi.fn() };
        const emitters = new FluidEmitters(sim);

        emitters._onGameOver();
        expect(sim.pushImpulse).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(300);
        expect(sim.pushImpulse).toHaveBeenCalledTimes(3);

        emitters.detach();
        vi.advanceTimersByTime(5000);

        expect(sim.pushImpulse).toHaveBeenCalledTimes(3);
        expect(emitters._timerIds.size).toBe(0);
    });
});

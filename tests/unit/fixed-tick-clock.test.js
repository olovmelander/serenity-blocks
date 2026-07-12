import {
    describe,
    expect,
    it,
} from 'vitest';
import {
    durationMsToTicks,
    elapsedMsToTicks,
    FIXED_TICK_HZ,
    FIXED_TICK_MAX_DEBT_MS,
    FIXED_TICK_MS,
    planFixedTicks,
} from '../../src/core/fixed-tick-clock.js';

function simulateOneSecond(renderRate) {
    let accumulatorMs = 0;
    let totalSteps = 0;

    for (let frame = 0; frame < renderRate; frame += 1) {
        const plan = planFixedTicks(accumulatorMs, 1000 / renderRate, {
            maxSteps: 5,
        });
        totalSteps += plan.steps;
        accumulatorMs = plan.remainderMs;
    }

    return { accumulatorMs, totalSteps };
}

describe('fixed tick clock', () => {
    it('defines the canonical simulation rate as 60 Hz', () => {
        expect(FIXED_TICK_HZ).toBe(60);
        expect(FIXED_TICK_MS).toBeCloseTo(1000 / 60, 12);
        expect(FIXED_TICK_MAX_DEBT_MS).toBe(300);
    });

    it('quantizes configured durations upward without inflating exact boundaries', () => {
        expect(durationMsToTicks(500)).toBe(30);
        expect(durationMsToTicks(20)).toBe(2);
        expect(durationMsToTicks(0)).toBe(0);
        expect(durationMsToTicks(-1)).toBe(0);
        expect(durationMsToTicks(Number.NaN)).toBe(0);
    });

    it('derives only fully elapsed ticks from legacy millisecond state', () => {
        expect(elapsedMsToTicks(499)).toBe(29);
        expect(elapsedMsToTicks(500)).toBe(30);
        expect(elapsedMsToTicks(20)).toBe(1);
        expect(elapsedMsToTicks(Number.POSITIVE_INFINITY)).toBe(0);
    });

    it.each([30, 60, 144])('plans exactly 60 ticks over one second at %i Hz render cadence', (renderRate) => {
        const result = simulateOneSecond(renderRate);

        expect(result.totalSteps).toBe(60);
        expect(result.accumulatorMs).toBeCloseTo(0, 8);
    });

    it('carries fractional remainder without drift', () => {
        const first = planFixedTicks(0, 7, { tickMs: 10 });
        const second = planFixedTicks(first.remainderMs, 6, { tickMs: 10 });
        const third = planFixedTicks(second.remainderMs, 17, { tickMs: 10 });

        expect(first).toMatchObject({ steps: 0, remainderMs: 7 });
        expect(second).toMatchObject({ steps: 1, remainderMs: 3 });
        expect(third).toMatchObject({ steps: 2, remainderMs: 0 });
    });

    it('tolerates floating-point noise only at the tick boundary', () => {
        const boundary = planFixedTicks(0, 9.99995, { tickMs: 10 });
        expect(boundary.steps).toBe(1);
        expect(boundary.remainderMs).toBeCloseTo(-0.00005, 10);
        expect(planFixedTicks(0, 9.9998, { tickMs: 10 })).toMatchObject({
            steps: 0,
            remainderMs: 9.9998,
        });
    });

    it('conserves elapsed time across repeated epsilon-boundary updates', () => {
        const tickMs = 10;
        const elapsedMs = tickMs - 0.00005;
        const updates = 10000;
        let accumulatorMs = 0;
        let totalSteps = 0;
        let totalAcceptedElapsedMs = 0;

        for (let update = 0; update < updates; update += 1) {
            const plan = planFixedTicks(accumulatorMs, elapsedMs, { tickMs });
            totalSteps += plan.steps;
            totalAcceptedElapsedMs += plan.acceptedElapsedMs;
            accumulatorMs = plan.remainderMs;
        }

        expect(totalSteps).toBe(9999);
        expect(accumulatorMs).toBeCloseTo(9.5, 7);
        expect((totalSteps * tickMs) + accumulatorMs).toBeCloseTo(totalAcceptedElapsedMs, 7);
    });

    it('keeps epsilon below the tick scale by enforcing a one-millisecond minimum tick', () => {
        const plan = planFixedTicks(0, 0.5, {
            tickMs: 0.00001,
            boundaryEpsilonMs: 1,
        });

        expect(plan).toMatchObject({ tickMs: 1, steps: 0, remainderMs: 0.5 });
        expect(planFixedTicks(0, 0, {
            tickMs: 0.00001,
            boundaryEpsilonMs: 1,
        }).steps).toBe(0);
    });

    it('sanitizes invalid elapsed values and clamps positive infinity to policy', () => {
        const policy = { tickMs: 10, maxSteps: 100, maxElapsedMs: 50 };

        expect(planFixedTicks(0, -10, policy)).toMatchObject({
            steps: 0,
            acceptedElapsedMs: 0,
            elapsedWasClamped: true,
        });
        expect(planFixedTicks(0, Number.NaN, policy)).toMatchObject({
            steps: 0,
            acceptedElapsedMs: 0,
            elapsedWasClamped: true,
        });
        expect(planFixedTicks(0, Number.POSITIVE_INFINITY, policy)).toMatchObject({
            steps: 5,
            acceptedElapsedMs: 50,
            elapsedWasClamped: true,
        });
    });

    it('applies the configured elapsed clamp before planning steps', () => {
        const plan = planFixedTicks(5, 1000, {
            tickMs: 10,
            maxSteps: 100,
            maxElapsedMs: 45,
        });

        expect(plan).toMatchObject({
            steps: 5,
            acceptedElapsedMs: 45,
            elapsedWasClamped: true,
            remainderMs: 0,
        });
    });

    it('caps catch-up at the step budget and carries at most one owed tick', () => {
        const overflow = planFixedTicks(0, 55, {
            tickMs: 10,
            maxSteps: 2,
            maxElapsedMs: 250,
            maxCarryTicks: 1,
        });

        expect(overflow).toMatchObject({
            steps: 2,
            accumulatedMs: 55,
            remainderBeforeCarryCapMs: 35,
            remainderMs: 10,
            overflowed: true,
            discardedMs: 25,
        });

        const carried = planFixedTicks(overflow.remainderMs, 0, {
            tickMs: 10,
            maxSteps: 2,
            maxCarryTicks: 1,
        });
        expect(carried).toMatchObject({ steps: 1, remainderMs: 0, overflowed: false });
    });

    it.each([
        [299, 299, 0],
        [300, 300, 0],
        [301, 300, 1],
    ])('rebases only debt beyond 300 ms (%i ms)', (elapsedMs, accumulatedMs, warpedMs) => {
        const plan = planFixedTicks(0, elapsedMs, {
            tickMs: 10,
            maxSteps: 5,
            maxDebtMs: FIXED_TICK_MAX_DEBT_MS,
            maxCarryTicks: 30,
        });

        expect(plan).toMatchObject({
            requestedAccumulatedMs: elapsedMs,
            accumulatedMs,
            debtWasClamped: warpedMs > 0,
            warpedMs,
            discardedMs: warpedMs,
        });
    });

    it('includes prior accumulator debt when applying the wall-time cap', () => {
        const plan = planFixedTicks(50, 251, {
            tickMs: 10,
            maxSteps: 5,
            maxDebtMs: FIXED_TICK_MAX_DEBT_MS,
            maxCarryTicks: 30,
        });

        expect(plan).toMatchObject({
            requestedAccumulatedMs: 301,
            accumulatedMs: 300,
            warpedMs: 1,
            remainderMs: 250,
        });
    });

    it('retains the full bounded debt and drains it without further loss', () => {
        const policy = {
            maxSteps: 5,
            maxDebtMs: FIXED_TICK_MAX_DEBT_MS,
            maxCarryTicks: FIXED_TICK_MAX_DEBT_MS / FIXED_TICK_MS,
        };
        const stalled = planFixedTicks(0, 1000, policy);

        expect(stalled.steps).toBe(5);
        expect(stalled.requestedAccumulatedMs).toBe(1000);
        expect(stalled.accumulatedMs).toBe(FIXED_TICK_MAX_DEBT_MS);
        expect(stalled.warpedMs).toBe(700);
        expect(stalled.remainderMs).toBeCloseTo(300 - (5 * FIXED_TICK_MS), 8);
        expect(stalled.discardedMs).toBe(700);

        let { remainderMs } = stalled;
        let drainedSteps = 0;
        for (let update = 0; update < 4; update += 1) {
            const plan = planFixedTicks(remainderMs, FIXED_TICK_MS, policy);
            const {
                discardedMs, remainderMs: nextRemainderMs, steps, warpedMs,
            } = plan;
            expect(warpedMs).toBe(0);
            expect(discardedMs).toBeCloseTo(0, 8);
            drainedSteps += steps;
            remainderMs = nextRemainderMs;
        }

        expect(drainedSteps).toBe(17);
        expect(remainderMs).toBeCloseTo(0, 8);
    });

    it('resets an invalid accumulator instead of propagating non-finite debt', () => {
        expect(planFixedTicks(Number.POSITIVE_INFINITY, 5, { tickMs: 10 })).toMatchObject({
            steps: 0,
            accumulatedMs: 5,
            remainderMs: 5,
        });
    });
});

import { describe, expect, it } from 'vitest';
import {
    advanceBlindTimersTick,
    applyBlindEffect,
    applyFullBlindEffect,
    createBlindTimers,
    decrementBlindTimers,
    restoreBlindTimers,
} from '../../src/core/blind.js';
import { FIXED_TICK_MS, planFixedTicks } from '../../src/core/fixed-tick-clock.js';
import { captureGameStateSnapshot, restoreGameStateSnapshot } from '../../src/core/demo/demo-state.js';
import { GameState } from '../../src/core/game.js';

function createState() {
    return {
        blindTimers: createBlindTimers(),
        simTickMs: FIXED_TICK_MS,
    };
}

describe('fixed-tick blind timer migration', () => {
    it('keeps legacy public-second arithmetic unchanged while refreshing tick mirrors', () => {
        const state = createState();
        applyBlindEffect(state, 1);
        applyFullBlindEffect(state, 1);

        decrementBlindTimers(state, 0.4);

        expect(state.blindTimers.field).toBeCloseTo(0.6, 12);
        expect(state.blindTimers.pending).toBeCloseTo(0.6, 12);
        expect(state.blindTimers.fieldMax).toBe(1);
        expect(state.blindTimers.pendingMax).toBe(1);
        expect(state.blindTimers.fieldTicks).toBe(36);
        expect(state.blindTimers.pendingTicks).toBe(36);
    });

    it('quantizes upward and consumes the final active canonical tick', () => {
        const state = createState();
        applyBlindEffect(state, 1.01);

        expect(state.blindTimers.pendingTicks).toBe(61);
        for (let tick = 0; tick < 60; tick++) {
            expect(advanceBlindTimersTick(state)).toBe(true);
        }
        expect(state.blindTimers.pendingTicks).toBe(1);
        expect(state.blindTimers.pending).toBeCloseTo(FIXED_TICK_MS / 1000, 12);

        expect(advanceBlindTimersTick(state)).toBe(true);
        expect(state.blindTimers.pendingTicks).toBe(0);
        expect(state.blindTimers.pending).toBe(0);
        expect(state.blindTimers.pendingMax).toBe(0);
        expect(advanceBlindTimersTick(state)).toBe(false);
    });

    it.each([30, 60, 144])('expires after 180 ticks at %i Hz render cadence', (renderHz) => {
        const state = createState();
        applyFullBlindEffect(state, 3);
        let accumulatorMs = 0;
        let advancedTicks = 0;

        for (let frame = 0; frame < renderHz * 3; frame++) {
            const plan = planFixedTicks(accumulatorMs, 1000 / renderHz);
            accumulatorMs = plan.remainderMs;
            for (let step = 0; step < plan.steps; step++) {
                advanceBlindTimersTick(state, plan.tickMs);
                advancedTicks += 1;
            }
        }

        expect(advancedTicks).toBe(180);
        expect(state.blindTimers.fieldTicks).toBe(0);
        expect(state.blindTimers.field).toBe(0);
    });

    it('resynchronizes direct public writes before consuming a fixed tick', () => {
        const state = createState();
        applyBlindEffect(state, 1);
        advanceBlindTimersTick(state);

        state.blindTimers.pending = 2;
        state.blindTimers.pendingMax = 2;
        advanceBlindTimersTick(state);

        expect(state.blindTimers.pendingTicks).toBe(119);
        expect(state.blindTimers.pendingMaxTicks).toBe(120);
        expect(state.blindTimers.pending).toBeCloseTo(119 / 60, 12);
        expect(state.blindTimers.pendingMax).toBeCloseTo(2, 12);
    });

    it('restores a compatible integer-clock snapshot exactly and in place', () => {
        const source = createState();
        applyFullBlindEffect(source, 1.01);
        for (let tick = 0; tick < 17; tick++) advanceBlindTimersTick(source);
        const snapshot = structuredClone(source.blindTimers);

        const target = createState();
        const originalTimers = target.blindTimers;
        const restored = restoreBlindTimers(target, snapshot);

        expect(restored).toBe(originalTimers);
        expect(target.blindTimers.fieldTicks).toBe(44);
        expect(target.blindTimers.fieldMaxTicks).toBe(61);

        advanceBlindTimersTick(source);
        advanceBlindTimersTick(target);
        expect(target.blindTimers.fieldTicks).toBe(source.blindTimers.fieldTicks);
        expect(target.blindTimers.field).toBe(source.blindTimers.field);
        expect(target.blindTimers.fieldMax).toBe(source.blindTimers.fieldMax);
    });

    it('upgrades legacy two-field snapshots at the target tick duration', () => {
        const state = createState();
        const originalTimers = state.blindTimers;

        restoreBlindTimers(state, { field: 1, pending: 0.5 });

        expect(state.blindTimers).toBe(originalTimers);
        expect(state.blindTimers.fieldMax).toBe(1);
        expect(state.blindTimers.pendingMax).toBe(0.5);
        expect(state.blindTimers.fieldTicks).toBe(60);
        expect(state.blindTimers.pendingTicks).toBe(30);
        advanceBlindTimersTick(state);
        expect(state.blindTimers.fieldTicks).toBe(59);
        expect(state.blindTimers.pendingTicks).toBe(29);
    });

    it('re-quantizes exact snapshots when the target tick duration differs', () => {
        const source = createState();
        applyBlindEffect(source, 1);
        advanceBlindTimersTick(source);
        const snapshot = structuredClone(source.blindTimers);
        snapshot.pendingTicks = 7;
        snapshot.pendingMaxTicks = 7;

        const target = createState();
        target.simTickMs = 10;
        restoreBlindTimers(target, snapshot);

        expect(target.blindTimers.pendingTicks).toBe(99);
        expect(target.blindTimers.pendingMaxTicks).toBe(100);
        expect(target.blindTimers._blindTickDurationMs).toBe(10);
    });

    it('round-trips an arbitrary canonical tick through demo state', () => {
        const source = new GameState();
        applyFullBlindEffect(source, 3);
        for (let tick = 0; tick < 37; tick++) advanceBlindTimersTick(source);
        const snapshot = captureGameStateSnapshot(source);
        const target = new GameState();

        restoreGameStateSnapshot(target, snapshot);

        expect(target.blindTimers.fieldTicks).toBe(143);
        expect(target.blindTimers.fieldMaxTicks).toBe(180);
        advanceBlindTimersTick(source);
        advanceBlindTimersTick(target);
        expect(target.blindTimers.fieldTicks).toBe(source.blindTimers.fieldTicks);
        expect(target.blindTimers.field).toBe(source.blindTimers.field);
    });

    it('re-derives stale counters after a direct public write is checkpointed', () => {
        const source = new GameState();
        applyBlindEffect(source, 1);
        advanceBlindTimersTick(source);
        source.blindTimers.pending = 5;
        source.blindTimers.pendingMax = 5;
        const snapshot = captureGameStateSnapshot(source);
        const target = new GameState();

        restoreGameStateSnapshot(target, snapshot);

        expect(target.blindTimers.pendingTicks).toBe(300);
        advanceBlindTimersTick(target);
        expect(target.blindTimers.pendingTicks).toBe(299);
        expect(target.blindTimers.pending).toBeCloseTo(299 / 60, 12);
    });
});

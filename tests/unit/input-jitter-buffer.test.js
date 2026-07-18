/**
 * @fileoverview Regression tests for the host input jitter-buffer clock.
 *
 * The buffer's processCursor advances once per loop frame (advanceTick). If
 * inputs are labeled with a DIFFERENT, slower clock (hostTick, which only
 * advances on broadcast, or a peer's hostTick which never advances), the cursor
 * overtakes the labels within a few frames and every later input is rejected as
 * stale — so the host's piece freezes. The fix labels inputs with the buffer's
 * own currentTick. These tests pin that invariant (remediation review follow-up).
 */

import { describe, it, expect, vi } from 'vitest';
import {
    InputJitterBuffer,
    MAX_WALL_CLOCK_CATCHUP_TICKS,
} from '../../src/core/network/input-jitter-buffer.js';

function drain(buf) {
    let applied = 0;
    for (const [, inputs] of buf.getInputsForTick()) applied += inputs.length;
    return applied;
}

describe('InputJitterBuffer clock', () => {
    it('labeling inputs with the buffer currentTick never drops them and applies each exactly once', () => {
        const buf = new InputJitterBuffer({ adaptive: false });
        buf.addPlayer('host');
        const FRAMES = 60;
        let totalApplied = 0;

        for (let frame = 0; frame < FRAMES; frame++) {
            // The fix: label with the buffer's own per-frame clock.
            const accepted = buf.addInput('host', buf.currentTick, { type: 'move' });
            expect(accepted).toBe(true); // never stale
            totalApplied += drain(buf);
            buf.advanceTick();
        }

        // No stale drops, and every input except the bufferDepth still in flight
        // has been applied exactly once.
        expect(buf.getStats().inputsDropped).toBe(0);
        expect(totalApplied).toBe(FRAMES - buf.bufferDepth);
    });

    it('demonstrates the bug it fixes: a frozen/slower input clock goes stale within a few frames', () => {
        const buf = new InputJitterBuffer({ adaptive: false });
        buf.addPlayer('peer');
        let dropped = 0;

        // Simulate a peer whose hostTick never advances (always labels tick=0)
        // while the buffer advances every frame.
        for (let frame = 0; frame < 20; frame++) {
            const accepted = buf.addInput('peer', 0, { type: 'move' });
            if (!accepted) dropped++;
            drain(buf);
            buf.advanceTick();
        }

        expect(dropped).toBeGreaterThan(0); // the old labeling loses inputs
    });

    it('stores scheduled tick separately from raw jitter tick metadata', () => {
        const buf = new InputJitterBuffer({ adaptive: true, tickRate: 60 });
        buf.addPlayer('peer');
        buf.setCurrentTick(10); // processCursor = 8 at bufferDepth 2

        const accepted = buf.addInput('peer', 8, { type: 'move' }, {
            jitterTick: 4,
            scheduleSource: 'sim_tick_clamped_late',
            lateClamped: true,
            receivedAt: 1234,
        });

        expect(accepted).toBe(true);
        const inputs = buf.getInputsForTick().get('peer');
        expect(inputs).toHaveLength(1);
        expect(inputs[0]).toMatchObject({
            _tick: 8,
            _rawTick: 4,
            _scheduleSource: 'sim_tick_clamped_late',
            _lateClamped: true,
            _receivedAt: 1234,
        });
    });

    it('accepts only a bounded internal future-window override', () => {
        const buf = new InputJitterBuffer({ adaptive: false, bufferDepth: 2 });
        buf.addPlayer('peer');
        buf.setCurrentTick(10);

        expect(buf.addInput('peer', 42, { type: 'move' }, { maxFutureTicks: 32 }))
            .toBe(true);
        expect(buf.addInput('peer', 43, { type: 'move' }, { maxFutureTicks: 32 }))
            .toBe(false);
        expect(buf.addInput('peer', 74, { type: 'move' }, { maxFutureTicks: 999 }))
            .toBe(true);
        expect(buf.addInput('peer', 75, { type: 'move' }, { maxFutureTicks: 999 }))
            .toBe(false);

        const epoch = buf.clockEpoch;
        buf.clear();
        expect(buf.clockEpoch).toBe(epoch + 1);
    });

    it('uses raw jitter tick offsets to raise adaptive depth', () => {
        const buf = new InputJitterBuffer({
            adaptive: true,
            tickRate: 60,
            bufferDepth: 2,
            minBufferDepth: 2,
            maxBufferDepth: 8,
        });
        buf.addPlayer('peer');
        buf.setCurrentTick(10);

        for (let i = 0; i < 20; i += 1) {
            expect(buf.addInput('peer', 8, { type: 'move', seq: i }, { jitterTick: 4 })).toBe(true);
        }

        const stats = buf.getStats();
        expect(stats.bufferDepth).toBe(3);
        expect(stats.avgOffsetTicks).toBe(6);
        expect(stats.maxOffsetTicks).toBe(6);
    });
});

describe('InputJitterBuffer.advanceByWallClock (review §2.3 wall-clock cadence)', () => {
    it('initializes the accumulator in the constructor (no undefined+= NaN freeze)', () => {
        const buf = new InputJitterBuffer({ adaptive: false, tickRate: 30 });
        expect(buf._wallClockAccumulatorMs).toBe(0);
        expect(buf.advanceByWallClock(40)).toBe(1);
        expect(buf.currentTick).toBe(1);
    });

    it('advances on elapsed time, not per call: 8ms x 8 calls = exactly 1 tick, remainder kept', () => {
        const buf = new InputJitterBuffer({ adaptive: false, tickRate: 30 });
        let ticks = 0;
        for (let i = 0; i < 8; i++) ticks += buf.advanceByWallClock(8);
        // 64ms elapsed at 33.3ms/tick -> exactly 1 tick, ~30.7ms retained.
        expect(ticks).toBe(1);
        expect(buf.currentTick).toBe(1);
        expect(buf._wallClockAccumulatorMs).toBeCloseTo(64 - buf.tickInterval, 6);
    });

    it('sub-interval frames advance zero ticks (144Hz frames simply wait)', () => {
        const buf = new InputJitterBuffer({ adaptive: false, tickRate: 30 });
        expect(buf.advanceByWallClock(7)).toBe(0);
        expect(buf.currentTick).toBe(0);
        expect(buf._wallClockAccumulatorMs).toBe(7);
    });

    it('caps catch-up at 4 ticks and rebases (discards) the leftover accumulator', () => {
        const buf = new InputJitterBuffer({ adaptive: false, tickRate: 30 });
        // One 500ms hitch is worth ~15 ticks; only the cap may be released.
        expect(buf.advanceByWallClock(500)).toBe(MAX_WALL_CLOCK_CATCHUP_TICKS);
        expect(buf.currentTick).toBe(4);
        expect(buf._wallClockAccumulatorMs).toBe(0); // rebased, not retained
        // The next ordinary frame starts from a clean base — no burst release.
        expect(buf.advanceByWallClock(8)).toBe(0);
        expect(buf.currentTick).toBe(4);
    });

    it('ignores non-finite and non-positive deltas', () => {
        const buf = new InputJitterBuffer({ adaptive: false, tickRate: 30 });
        expect(buf.advanceByWallClock(undefined)).toBe(0);
        expect(buf.advanceByWallClock(Number.NaN)).toBe(0);
        expect(buf.advanceByWallClock(-50)).toBe(0);
        expect(buf._wallClockAccumulatorMs).toBe(0);
        expect(buf.currentTick).toBe(0);
    });

    it('runs the drain callback BEFORE each advance so a 2-tick frame drains both ticks in order', () => {
        const buf = new InputJitterBuffer({ adaptive: false, tickRate: 30, bufferDepth: 0 });
        buf.addPlayer('peer');
        buf.addInput('peer', 0, { type: 'move', seq: 1 });
        buf.addInput('peer', 1, { type: 'rotate', seq: 2 });

        const drained = [];
        const ticks = buf.advanceByWallClock(2 * buf.tickInterval + 1, () => {
            for (const [, inputs] of buf.getInputsForTick()) {
                for (const input of inputs) drained.push(input.seq);
            }
        });

        expect(ticks).toBe(2);
        expect(drained).toEqual([1, 2]); // in tick order, one drain per tick
        expect(buf.getStats().inputsDropped).toBe(0);
    });

    it('clear() resets the wall-clock accumulator', () => {
        const buf = new InputJitterBuffer({ adaptive: false, tickRate: 30 });
        buf.advanceByWallClock(20);
        expect(buf._wallClockAccumulatorMs).toBe(20);
        buf.clear();
        expect(buf._wallClockAccumulatorMs).toBe(0);
    });

    it('leaves advanceTick() itself untouched for direct (fixed/adaptive) callers', () => {
        const buf = new InputJitterBuffer({ adaptive: false, tickRate: 30 });
        const spy = vi.spyOn(buf, 'advanceTick');
        buf.advanceByWallClock(buf.tickInterval);
        expect(spy).toHaveBeenCalledTimes(1);
        buf.advanceTick();
        expect(buf.currentTick).toBe(2);
    });
});

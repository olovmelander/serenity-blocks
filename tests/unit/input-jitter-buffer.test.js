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

import { describe, it, expect } from 'vitest';
import { InputJitterBuffer } from '../../src/core/network/input-jitter-buffer.js';

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

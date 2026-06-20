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
});

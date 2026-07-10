/**
 * Pinning tests for the unified event bus (plan §4.1 step 1).
 *
 * Locks the behavior the optimizer merge must preserve or fix: registration
 * ordering, per-listener error isolation, once-fires-once (the optimizer's
 * broken once), rafThrottle coalescing, unknown-name guard, and the
 * unsubscribe contract 222 theme subscriptions rely on.
 */
import {
    describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';
import { MULTIPLAYER_EVENTS, onMultiplayerEvent, emitMultiplayerEvent } from '../../src/events/multiplayer-events.js';

afterEach(() => {
    // Bus is a singleton — clear any listeners a test leaves behind.
    for (const name of [...eventBus.listeners.keys()]) eventBus.listeners.delete(name);
    eventBus.knownEvents = null;
});

describe('event bus — ordering & delivery', () => {
    it('option-less listeners fire synchronously in registration order', () => {
        const order = [];
        eventBus.on('t:order', () => order.push('a'));
        eventBus.on('t:order', () => order.push('b'));
        eventBus.on('t:order', () => order.push('c'));
        eventBus.emit('t:order');
        expect(order).toEqual(['a', 'b', 'c']); // synchronous, same tick
    });

    it('delivers the payload', () => {
        const h = vi.fn();
        eventBus.on('t:payload', h);
        eventBus.emit('t:payload', { x: 1 });
        expect(h).toHaveBeenCalledWith({ x: 1 });
    });

    it('emit on a name with no listeners is a no-op', () => {
        expect(() => eventBus.emit('t:nobody', {})).not.toThrow();
    });
});

describe('event bus — isolation', () => {
    it('one throwing listener does not abort later listeners or propagate', () => {
        const after = vi.fn();
        const spy = vi.spyOn(eventBus, 'onListenerError').mockImplementation(() => {});
        eventBus.on('t:iso', () => { throw new Error('boom'); });
        eventBus.on('t:iso', after);
        expect(() => eventBus.emit('t:iso', {})).not.toThrow();
        expect(after).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledTimes(1);
        spy.mockRestore();
    });
});

describe('event bus — unsubscribe & off', () => {
    it('on() returns an unsubscribe that removes exactly that listener', () => {
        const h = vi.fn();
        const off = eventBus.on('t:unsub', h);
        off();
        eventBus.emit('t:unsub', {});
        expect(h).not.toHaveBeenCalled();
        expect(eventBus.listenerCount('t:unsub')).toBe(0);
    });

    it('off(name, handler) matches the ORIGINAL handler even when wrapped', () => {
        const h = vi.fn();
        eventBus.on('t:offwrap', h, { rafThrottle: true });
        eventBus.off('t:offwrap', h);
        expect(eventBus.listenerCount('t:offwrap')).toBe(0);
    });

    it('mid-emit unsubscribe does not corrupt iteration', () => {
        const calls = [];
        const off = eventBus.on('t:mid', () => { calls.push('a'); off(); });
        eventBus.on('t:mid', () => calls.push('b'));
        eventBus.emit('t:mid');
        expect(calls).toEqual(['a', 'b']);
    });
});

describe('event bus — once', () => {
    it('fires exactly once then auto-removes (the optimizer once bug)', () => {
        const h = vi.fn();
        eventBus.once('t:once', h);
        eventBus.emit('t:once', 1);
        eventBus.emit('t:once', 2);
        expect(h).toHaveBeenCalledTimes(1);
        expect(h).toHaveBeenCalledWith(1);
        expect(eventBus.listenerCount('t:once')).toBe(0);
    });
});

describe('event bus — rafThrottle coalescing', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('coalesces a burst into a single deferred call with the LAST payload', () => {
        // jsdom-free (node) env: no requestAnimationFrame → the wrapper falls
        // back to setTimeout(16), which fake timers drive.
        const h = vi.fn();
        eventBus.on('t:raf', h, { rafThrottle: true });
        eventBus.emit('t:raf', 1);
        eventBus.emit('t:raf', 2);
        eventBus.emit('t:raf', 3);
        expect(h).not.toHaveBeenCalled(); // deferred
        vi.advanceTimersByTime(20);
        expect(h).toHaveBeenCalledTimes(1);
        expect(h).toHaveBeenCalledWith(3); // last payload wins
    });
});

describe('event bus — setKnownEvents guard (dev/test)', () => {
    it('throws on an unknown name at emit and subscribe once armed', () => {
        eventBus.setKnownEvents(['t:known']);
        expect(() => eventBus.emit('t:unknown', {})).toThrow(/unknown event name/);
        expect(() => eventBus.on('t:unknown', () => {})).toThrow(/unknown event name/);
        expect(() => eventBus.emit('t:known', {})).not.toThrow();
    });

    it('is permissive by default (production never arms it)', () => {
        expect(() => eventBus.emit('t:anything', {})).not.toThrow();
    });
});

describe('facade rides the same bus (cutover pin)', () => {
    it('onMultiplayerEvent subscribes on eventBus and returns an unsubscribe', () => {
        const h = vi.fn();
        const off = onMultiplayerEvent(MULTIPLAYER_EVENTS.COMBO, h);
        expect(typeof off).toBe('function');
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.COMBO, { comboCount: 2 });
        expect(h).toHaveBeenCalledWith({ comboCount: 2 });
        off();
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.COMBO, { comboCount: 3 });
        expect(h).toHaveBeenCalledTimes(1);
    });

    it('ffa: names do not collide with the EVENTS namespace on the shared bus', () => {
        const mp = vi.fn();
        const theme = vi.fn();
        onMultiplayerEvent(MULTIPLAYER_EVENTS.COMBO, mp); // 'ffa:combo'
        eventBus.on(EVENTS.COMBO, theme); // 'combo'
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.COMBO, {});
        expect(mp).toHaveBeenCalledTimes(1);
        expect(theme).not.toHaveBeenCalled();
    });
});

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
    it('off(name, handler) cancels a once listener by its original handler', () => {
        const handler = vi.fn();
        eventBus.once('t:once-off', handler);
        eventBus.off('t:once-off', handler);
        eventBus.emit('t:once-off');
        expect(handler).not.toHaveBeenCalled();
        expect(eventBus.listenerCount('t:once-off')).toBe(0);
    });

    it('fires exactly once then auto-removes (the optimizer once bug)', () => {
        const h = vi.fn();
        eventBus.once('t:once', h);
        eventBus.emit('t:once', 1);
        eventBus.emit('t:once', 2);
        expect(h).toHaveBeenCalledTimes(1);
        expect(h).toHaveBeenCalledWith(1);
        expect(eventBus.listenerCount('t:once')).toBe(0);
    });

    it('fires only once when an earlier listener emits the same event recursively', () => {
        const handler = vi.fn();
        eventBus.on('t:once-reentrant', (value) => {
            if (value === 'outer') eventBus.emit('t:once-reentrant', 'inner');
        });
        eventBus.once('t:once-reentrant', handler);
        eventBus.emit('t:once-reentrant', 'outer');
        expect(handler.mock.calls).toEqual([['inner']]);
    });

    it('removes itself before its own handler emits the same event', () => {
        const handler = vi.fn(() => eventBus.emit('t:once-self', 'inner'));
        eventBus.once('t:once-self', handler);
        eventBus.emit('t:once-self', 'outer');
        expect(handler.mock.calls).toEqual([['outer']]);
        expect(eventBus.listenerCount('t:once-self')).toBe(0);
    });
});

describe('event bus — deferred delivery', () => {
    beforeEach(() => { vi.useFakeTimers({ now: 1000 }); });
    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it.each([
        ['debounce', { debounceMs: 50 }],
        ['throttle', { throttleMs: 50 }],
        ['raf', { rafThrottle: true }],
    ])('isolates errors from %s listeners and reports their original handler', (_name, options) => {
        const error = new Error('deferred failure');
        const handler = vi.fn(() => { throw error; });
        const after = vi.fn();
        const report = vi.spyOn(eventBus, 'onListenerError').mockImplementation(() => {});
        eventBus.on('t:deferred-error', handler, options);
        eventBus.on('t:deferred-error', after, options);
        eventBus.emit('t:deferred-error', 1);
        handler.mockClear();
        after.mockClear();
        report.mockClear();
        eventBus.emit('t:deferred-error', 2);

        expect(() => vi.advanceTimersByTime(100)).not.toThrow();
        expect(handler).toHaveBeenCalledWith(2);
        expect(after).toHaveBeenCalledWith(2);
        expect(report).toHaveBeenCalledWith('t:deferred-error', error, handler);
    });

    it('does not redeliver an overdue throttle timer after a newer immediate delivery', () => {
        const handler = vi.fn();
        eventBus.on('t:throttle-overdue', handler, { throttleMs: 100 });
        eventBus.emit('t:throttle-overdue', 1);
        vi.advanceTimersByTime(10);
        eventBus.emit('t:throttle-overdue', 2);
        // A queued timer can be overdue when the main thread is blocked or the clock advances.
        vi.setSystemTime(1200);
        eventBus.emit('t:throttle-overdue', 3);
        vi.advanceTimersByTime(100);
        expect(handler.mock.calls).toEqual([[1], [3]]);
    });

    it.each([
        ['debounce', { debounceMs: 50 }],
        ['throttle', { throttleMs: 50 }],
        ['raf', { rafThrottle: true }],
    ])('cancels queued %s work when unsubscribed', (_name, options) => {
        const handler = vi.fn();
        const unsubscribe = eventBus.on('t:deferred-cancel', handler, options);
        eventBus.emit('t:deferred-cancel', 1);
        handler.mockClear();
        eventBus.emit('t:deferred-cancel', 2);
        unsubscribe();
        vi.advanceTimersByTime(100);
        expect(handler).not.toHaveBeenCalled();
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

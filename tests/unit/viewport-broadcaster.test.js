/**
 * ViewportBroadcaster pins (plan §4.4) — the ONE debounced window-resize
 * source. Testable without a browser: fake window-like + recording bus.
 */
import {
    describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { ViewportBroadcaster } from '../../src/utils/viewport.js';
import { EVENTS } from '../../src/events/event-bus.js';

const BUS_EVENTS = { VIEWPORT_RESIZED: 'viewportResized' };

function makeWin({ width = 1280, height = 720, dpr = 1 } = {}) {
    const listeners = new Map();
    return {
        innerWidth: width,
        innerHeight: height,
        devicePixelRatio: dpr,
        addEventListener(name, h) { listeners.set(h, name); },
        removeEventListener(name, h) { listeners.delete(h); },
        listenerCount() { return listeners.size; },
        fireResize() { for (const [h, name] of listeners) if (name === 'resize') h(); },
    };
}
function makeBus() {
    return { emits: [], emit(name, payload) { this.emits.push({ name, payload }); } };
}

describe('ViewportBroadcaster', () => {
    let win; let bus; let vp;
    beforeEach(() => {
        vi.useFakeTimers();
        win = makeWin();
        bus = makeBus();
        vp = new ViewportBroadcaster(win, bus, BUS_EVENTS, { debounceMs: 150 });
    });
    afterEach(() => { vp.dispose(); vi.useRealTimers(); });

    it('install() adds exactly one window listener, idempotently', () => {
        vp.install();
        vp.install();
        vp.install();
        expect(win.listenerCount()).toBe(1);
    });

    it('debounces a resize storm into ONE broadcast with the final dimensions', () => {
        vp.install();
        for (let i = 0; i < 20; i += 1) {
            win.innerWidth = 1280 + i * 10;
            win.fireResize();
            vi.advanceTimersByTime(20); // < debounce window each time
        }
        expect(bus.emits).toHaveLength(0); // still storming
        vi.advanceTimersByTime(150);
        expect(bus.emits).toHaveLength(1);
        expect(bus.emits[0]).toEqual({
            name: 'viewportResized',
            payload: { width: 1470, height: 720, dpr: 1 },
        });
    });

    it('dedups identical dimensions (devtools-toggle class of no-op resizes)', () => {
        vp.install();
        win.fireResize(); // dims unchanged from install snapshot
        vi.advanceTimersByTime(200);
        expect(bus.emits).toHaveLength(0);
    });

    it('broadcasts a dpr-only change (monitor swap)', () => {
        vp.install();
        win.devicePixelRatio = 2;
        win.fireResize();
        vi.advanceTimersByTime(200);
        expect(bus.emits).toHaveLength(1);
        expect(bus.emits[0].payload.dpr).toBe(2);
    });

    it('getViewport() pull API returns current dimensions without an event', () => {
        vp.install();
        expect(vp.getViewport()).toEqual({ width: 1280, height: 720, dpr: 1 });
        win.innerWidth = 1600;
        win.fireResize();
        vi.advanceTimersByTime(200);
        expect(vp.getViewport()).toEqual({ width: 1600, height: 720, dpr: 1 });
    });

    it('dispose() removes the listener and cancels a pending broadcast', () => {
        vp.install();
        win.innerWidth = 999;
        win.fireResize();
        vp.dispose();
        vi.advanceTimersByTime(500);
        expect(bus.emits).toHaveLength(0);
        expect(win.listenerCount()).toBe(0);
    });

    it('survives a null window (SSR/tests) without throwing', () => {
        const headless = new ViewportBroadcaster(null, bus, BUS_EVENTS);
        headless.install();
        expect(headless.getViewport()).toEqual({ width: 0, height: 0, dpr: 1 });
        headless.dispose();
    });
});

describe('wiring contracts', () => {
    it('VIEWPORT_RESIZED is a real key in the EVENTS map', () => {
        expect(EVENTS.VIEWPORT_RESIZED).toBe('viewportResized');
    });

    it('main.js subscribes via the broadcaster, not a raw resize listener (source tripwire)', async () => {
        const { readFileSync } = await import('node:fs');
        const src = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
        expect(src).toMatch(/initViewportBroadcaster\(\)/);
        expect(src).toMatch(/EVENTS\.VIEWPORT_RESIZED/);
        expect(src).not.toMatch(/addEventListener\(\s*['"]resize['"]/);
    });
});

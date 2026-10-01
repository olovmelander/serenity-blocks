import { afterEach, expect, it, vi } from 'vitest';
import { connectStartupWordmark } from '../../src/ui/startup-wordmark-handoff.js';

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

function fixture() {
    const values = {};
    const style = { setProperty: vi.fn((key, value) => { values[key] = value; }) };
    let from = { left: 500, top: 420, width: 280, height: 30 };
    let to = { left: 200, top: 330, width: 880, height: 90 };
    const origin = { getBoundingClientRect: () => from };
    const title = { getBoundingClientRect: () => to };
    const wordmark = { style };
    const shell = {
        style,
        querySelector: (selector) => (selector === '.startup-logo__name' ? origin : wordmark),
    };
    const container = { style, classList: { add: vi.fn() }, querySelector: () => title };
    let observerCallback;
    const disconnect = vi.fn();
    vi.stubGlobal('document', { getElementById: () => shell });
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback) { observerCallback = callback; }
        observe() {}
        disconnect() { disconnect(); }
    });
    return {
        container, values, disconnect,
        resize(nextFrom, nextTo) { from = nextFrom; to = nextTo; observerCallback(); },
    };
}

it('lands the existing wordmark on the title and follows a portrait resize without frame polling', () => {
    vi.useFakeTimers();
    const f = fixture();
    const cleanup = connectStartupWordmark(f.container, 3200);
    expect(f.values).toMatchObject({
        '--sb-title-x': '0px',
        '--sb-title-y': '-60px',
        '--sb-title-scale-y': '3',
        '--sb-opening-duration': '3200ms',
    });
    expect(Number(f.values['--sb-title-scale-x'])).toBeCloseTo(880 / 280);
    expect(f.container.classList.add).toHaveBeenCalledWith('intro-title-connected');
    f.resize(
        { left: 80, top: 360, width: 230, height: 22 },
        { left: 0, top: 180, width: 390, height: 35 },
    );
    expect(f.values['--sb-title-x']).toBe('0px');
    expect(f.values['--sb-title-y']).toBe('-173.5px');
    expect(Number(f.values['--sb-title-scale-x'])).toBeCloseTo(390 / 230);
    cleanup();
    expect(f.disconnect).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
});

it('disconnects its observer after the handoff without requiring a later user gesture', () => {
    vi.useFakeTimers();
    const f = fixture();
    connectStartupWordmark(f.container, 3200);
    vi.advanceTimersByTime(3300);
    expect(f.disconnect).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
});

it('leaves the normal title reveal available when no ident exists', () => {
    vi.stubGlobal('document', { getElementById: () => null });
    expect(() => connectStartupWordmark(null, 3200)()).not.toThrow();
});

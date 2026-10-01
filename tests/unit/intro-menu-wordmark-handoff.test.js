import { afterEach, expect, it, vi } from 'vitest';
import { beginIntroMenuWordmarkHandoff } from '../../src/ui/intro-menu-wordmark-handoff.js';

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

function fixture({ reduced = false } = {}) {
    vi.useFakeTimers();
    const events = new EventTarget();
    const motion = Object.assign(new EventTarget(), { matches: reduced });
    const classes = new Set();
    const children = new Set();
    const frames = new Map();
    const animations = [];
    let nextFrame = 0;
    let ready = false;
    let resizeObserver;
    const disconnect = vi.fn();
    const pulse = (currentTime, delay = 0) => ({
        animationName: 'sb-wordmark-pulse', currentTime,
        effect: { getTiming: () => ({ duration: 2800, delay }) },
    });
    const clonePulse = pulse(0);
    const sourcePulse = pulse(2300, 200);
    const targetPulse = pulse(0, -400);
    const clone = { getAnimations: () => [clonePulse] };
    const source = {
        animate() {},
        getAnimations: () => [sourcePulse],
        cloneNode: () => clone,
        // Mid-pulse scale .9 around a 500 x 180 artwork at (400, 300).
        getBoundingClientRect: () => ({ left: 425, top: 309, width: 450, height: 162 }),
    };
    let targetRect = { left: 560, top: 42, width: 180, height: 64.8 };
    const target = {
        isConnected: true, offsetWidth: 180,
        getBoundingClientRect: () => targetRect,
        getAnimations: () => [targetPulse],
    };
    const title = { querySelector: (selector) => (selector === '.intro-wordmark' ? source : null) };
    let currentRect = { left: 475, top: 190, width: 360, height: 129.6 };
    const flight = {
        style: {}, appendChild() {},
        getBoundingClientRect: () => currentRect,
        remove: vi.fn(() => children.delete(flight)),
        animate: vi.fn((keyframes, options) => {
            let resolve;
            const finished = new Promise((done) => { resolve = done; });
            const animation = { finished, resolve, cancel: vi.fn(), keyframes, options };
            animations.push(animation);
            return animation;
        }),
    };
    vi.stubGlobal('document', {
        createElement: () => flight,
        querySelector: () => ({}),
        body: {
            appendChild: (element) => children.add(element),
            classList: {
                add: (...names) => names.forEach((name) => classes.add(name)),
                remove: (name) => classes.delete(name),
            },
        },
    });
    vi.stubGlobal('window', Object.assign(events, { matchMedia: () => motion }));
    vi.stubGlobal('getComputedStyle', (element) => ({ transform: element === source ? 'pulse' : 'none' }));
    vi.stubGlobal('DOMMatrixReadOnly', class {
        constructor(transform) {
            this.a = transform === 'pulse' ? 0.9 : 1;
            this.d = this.a;
            this.b = 0;
            this.c = 0;
        }
    });
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback) { resizeObserver = callback; }
        observe() {}
        disconnect() { disconnect(); }
    });
    vi.stubGlobal('requestAnimationFrame', (callback) => { frames.set(++nextFrame, callback); return nextFrame; });
    vi.stubGlobal('cancelAnimationFrame', (id) => frames.delete(id));
    const controller = beginIntroMenuWordmarkHandoff(title, { getTarget: () => (ready ? target : null) });
    return {
        controller, flight, animations, clonePulse, targetPulse, children, classes, frames, disconnect,
        showMenu() { ready = true; events.dispatchEvent(new Event('modalShown')); },
        resize() { targetRect = { left: 90, top: 36, width: 160, height: 57.6 }; resizeObserver(); },
        reduceMotion() { motion.matches = true; motion.dispatchEvent(new Event('change')); },
        frame() { const pending = [...frames.values()]; frames.clear(); pending.forEach((fn) => fn()); },
    };
}

it('preserves the pulsing source pose while waiting for the real menu layout', () => {
    const f = fixture();
    expect(f.flight.style).toEqual({ left: '400px', top: '300px', width: '500px', height: '180px' });
    expect(f.clonePulse.currentTime).toBe(2100);
    f.frame();
    expect(f.animations).toHaveLength(0);
    expect(f.children.size).toBe(1);
    expect(f.classes.has('intro-menu-handoff')).toBe(true);
    f.showMenu();
    expect(f.animations).toHaveLength(1);
    expect(f.animations[0].keyframes.map(Object.keys)).toEqual([['transform'], ['transform']]);
    expect(f.animations[0].keyframes[1].transform).toBe('translate3d(160px, -258px, 0) scale(0.36, 0.36)');
    f.controller.cancel();
});

it('lands with the same pulse phase and releases every owned resource', async () => {
    const f = fixture();
    f.showMenu();
    f.clonePulse.currentTime = 3275;
    f.animations[0].resolve();
    await Promise.resolve();
    expect(f.targetPulse.currentTime).toBe(75); // 475 ms phase plus target's -400 ms delay.
    expect(f.controller.element).toBeNull();
    expect(f.children.size).toBe(0);
    expect(f.frames.size).toBe(0);
    expect(f.classes.has('intro-menu-handoff')).toBe(false);
    expect(f.disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    f.showMenu();
    f.controller.cancel();
    expect(f.animations).toHaveLength(1);
    expect(f.flight.remove).toHaveBeenCalledOnce();
});

it('retargets a resize from the visible pose and ignores the old animation completion', async () => {
    const f = fixture();
    f.showMenu();
    f.resize();
    expect(f.flight.style).toMatchObject({ left: '475px', top: '190px', width: '360px' });
    expect(f.animations[0].cancel).toHaveBeenCalledOnce();
    f.animations[0].resolve();
    await Promise.resolve();
    expect(f.controller.element).toBe(f.flight);
    f.animations[1].resolve();
    await Promise.resolve();
    expect(f.controller.element).toBeNull();
});

it('cancels cleanly before the menu becomes available', () => {
    const f = fixture();
    f.controller.cancel();
    f.showMenu();
    f.frame();
    expect(f.animations).toHaveLength(0);
    expect(f.children.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
});

it('restores the real logo if the menu or an animation completion never arrives', () => {
    const f = fixture();
    vi.advanceTimersByTime(2500);
    expect(f.controller.element).toBeNull();
    expect(f.classes.has('intro-menu-handoff')).toBe(false);
    const next = fixture();
    next.showMenu();
    vi.advanceTimersByTime(1500);
    expect(next.controller.element).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
});

it('respects reduced motion both before and during a flight', () => {
    const reduced = fixture({ reduced: true });
    expect(reduced.controller).toBeNull();
    expect(reduced.children.size).toBe(0);
    const f = fixture();
    f.showMenu();
    f.reduceMotion();
    expect(f.controller.element).toBeNull();
    expect(f.classes.has('intro-menu-handoff')).toBe(false);
});

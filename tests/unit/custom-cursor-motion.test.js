import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomCursor, CURSOR_STATES } from '../../src/ui/components/custom-cursor.js';

function classList() {
    const values = new Set();
    return {
        contains: (value) => values.has(value),
        toggle: vi.fn((value, enabled) => {
            if (enabled) values.add(value);
            else values.delete(value);
        }),
    };
}

function target(kind = 'plain', cursorStyle = '') {
    const element = {
        nodeType: 1,
        parentElement: null,
        style: { cursor: cursorStyle },
        getBoundingClientRect: vi.fn(() => ({ left: 100, top: 50, width: 300, height: 100 })),
        closest: vi.fn((selector) => {
            if (selector.startsWith('button:disabled')) return kind === 'disabled' ? element : null;
            if (selector.startsWith('input:not(')) return kind === 'text' ? element : null;
            if (selector.startsWith('a[href]')) return kind === 'button' ? element : null;
            return null;
        }),
    };
    return element;
}

function harness(intensity = 'standard') {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let now = 10000;
    vi.stubGlobal('performance', { now: () => now });
    vi.stubGlobal('window', { innerWidth: 1200, innerHeight: 800, matchMedia: () => ({ matches: true }) });
    vi.stubGlobal('document', {
        hidden: false,
        body: { classList: classList() },
        querySelector: vi.fn(() => null),
        elementFromPoint: vi.fn(() => null),
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const cursor = new CustomCursor({ settingsManager: { get: () => ({ customCursorIntensity: intensity }) } });
    const dataWrites = vi.fn();
    cursor.container = {
        classList: classList(),
        dataset: new Proxy({}, { set: (object, key, value) => { dataWrites(key, value); object[key] = value; return true; } }),
    };
    cursor.cursor = { style: {} };
    cursor.motionShell = { style: {} };
    cursor.trailCanvas = {};
    cursor.ctx = {
        clearRect: vi.fn(),
        createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
        beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(),
    };
    cursor.mounted = true;
    const move = (x, y, element = target()) => cursor.onPointerMove({ clientX: x, clientY: y, pointerType: 'mouse', target: element });
    return { cursor, move, dataWrites, advance: (delta) => { now += delta; return now; } };
}

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('cosmic cursor tracking and effect ownership', () => {
    it.each(['low', 'standard', 'high'])('tracks the latest pointer before RAF at %s intensity', (intensity) => {
        const h = harness(intensity);
        h.move(103.5, 87.25);
        expect(h.cursor.pos).toEqual({ x: 103.5, y: 87.25 });
        expect(h.cursor.cursor.style.transform).toBe('translate3d(103.5px, 87.25px, 0)');
        h.move(740, 301);
        expect(h.cursor.cursor.style.transform).toBe('translate3d(740px, 301px, 0)');
        expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
        h.cursor.animate(h.advance(16.667));
        expect(h.cursor.pos).toEqual({ x: 740, y: 301 });
        expect(h.cursor.cursor.style.transform).toBe('translate3d(740px, 301px, 0)');
    });

    it('keeps button-edge hits exact and writes position before resolving the control', () => {
        const h = harness('high');
        const button = target('button');
        button.closest.mockImplementation((selector) => {
            expect(h.cursor.cursor.style.transform).toBe('translate3d(101px, 51px, 0)');
            return selector.startsWith('a[href]') ? button : null;
        });
        h.move(101, 51, button);
        for (let frame = 0; frame < 30; frame++) h.cursor.animate(h.advance(16.667));
        expect(h.cursor.pos).toEqual({ x: 101, y: 51 });
        expect(h.cursor.semanticState).toBe(CURSOR_STATES.INTERACTIVE);
        expect(button.getBoundingClientRect).not.toHaveBeenCalled();
    });

    it('places click particles at the actual click before any following effect frame', () => {
        const h = harness();
        h.move(80, 90);
        h.cursor.onPointerDown({ clientX: 300, clientY: 210, pointerType: 'mouse', target: target('button') });
        expect(h.cursor.pos).toEqual({ x: 300, y: 210 });
        expect(h.cursor.burstParticles).toHaveLength(8);
        expect(h.cursor.burstParticles.every((particle) => particle.x === 300 && particle.y === 210)).toBe(true);
        h.cursor.onPointerUp({ clientX: 310, clientY: 220, pointerType: 'mouse', target: target('button') });
        expect(h.cursor.pos).toEqual({ x: 310, y: 220 });
        expect(h.cursor.pointerDown).toBe(false);
    });

    it.each([false, true])('drains stationary trails and skips blank-canvas work (reduced motion %s)', (reduced) => {
        const h = harness();
        h.cursor.prefersReducedMotion = reduced;
        h.move(80, 90);
        h.cursor.updateMotion();
        h.move(180, 110);
        h.cursor.updateMotion();
        h.cursor.updateTrail(16.667);
        expect(h.cursor.trailPoints).toHaveLength(1);
        for (let frame = 0; frame < 40; frame++) {
            h.advance(16.667);
            h.cursor.updateMotion();
            h.cursor.updateTrail(16.667);
        }
        expect(h.cursor.trailPoints).toHaveLength(0);
        expect(h.cursor.shouldUseHighFrequencyAnimation(h.advance(200))).toBe(false);
        const clearCount = h.cursor.ctx.clearRect.mock.calls.length;
        h.cursor.updateTrail(120);
        expect(h.cursor.ctx.clearRect).toHaveBeenCalledTimes(clearCount);
    });

    it('does not repeat presentation writes during same-state movement', () => {
        const h = harness();
        const button = target('button');
        h.move(100, 100, button);
        const count = h.dataWrites.mock.calls.length;
        const bodyWrites = document.body.classList.toggle.mock.calls.length;
        h.move(101, 102, button);
        h.cursor.syncPresentation();
        expect(h.dataWrites).toHaveBeenCalledTimes(count);
        expect(document.body.classList.toggle).toHaveBeenCalledTimes(bodyWrites);
    });

    it('skips stationary transform writes even when CSSOM normalizes the assigned value', () => {
        const h = harness();
        const coreWrites = vi.fn();
        const shellWrites = vi.fn();
        for (const [element, writes] of [[h.cursor.cursor, coreWrites], [h.cursor.motionShell, shellWrites]]) {
            let normalized = '';
            Object.defineProperty(element.style, 'transform', {
                get: () => normalized,
                set: (value) => {
                    writes(value);
                    normalized = value.replace(', 0)', ', 0px)');
                },
            });
        }
        h.move(80, 90);
        h.cursor.updateMotion();
        h.cursor.updateCursorVisuals();
        for (let frame = 0; frame < 40; frame++) {
            h.cursor.animate(h.advance(16.667));
        }
        expect(coreWrites).toHaveBeenCalledTimes(1);
        expect(shellWrites).toHaveBeenCalledTimes(1);
        h.move(81, 92);
        expect(coreWrites).toHaveBeenCalledTimes(2);
    });

    it('restores the pointer on movement after gamepad, idle and native-popup suppression', () => {
        const h = harness();
        h.move(80, 90);
        h.cursor.animationFrame = null;
        h.advance(2000);
        h.cursor.scheduleAnimationFrame();
        expect(h.cursor.idleAnimationTimeout).not.toBeNull();
        h.cursor.nativePopupOpen = true;
        h.cursor.gamepadSuppressed = true;
        h.move(140, 160);
        expect(h.cursor.nativePopupOpen).toBe(false);
        expect(h.cursor.gamepadSuppressed).toBe(false);
        expect(h.cursor.idleAnimationTimeout).toBeNull();
        expect(h.cursor.shouldRender()).toBe(true);
        expect(h.cursor.cursor.style.transform).toBe('translate3d(140px, 160px, 0)');
    });

    it('preserves text, disabled and drag states without letting touch move the mouse cursor', () => {
        const h = harness();
        h.move(80, 90, target('text'));
        expect(h.cursor.renderState).toBe(CURSOR_STATES.TEXT);
        h.move(100, 110, target('disabled'));
        expect(h.cursor.renderState).toBe(CURSOR_STATES.DISABLED);
        h.move(120, 130, target('plain', 'grabbing'));
        expect(h.cursor.renderState).toBe(CURSOR_STATES.GRABBING);
        h.cursor.onPointerMove({ clientX: 600, clientY: 700, pointerType: 'touch', target: target() });
        expect(h.cursor.pos).toEqual({ x: 120, y: 130 });
        h.cursor.onPointerLeaveWindow();
        expect(h.cursor.shouldRender()).toBe(false);
    });
});

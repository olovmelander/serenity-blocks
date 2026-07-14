import { describe, expect, it } from 'vitest';
import { resolveActiveThemeDrawCalls } from '../../src/utils/performance-monitor.js';

function createWindowCounterState({
    sharedCalls = 0,
    dedicatedCalls = 0,
    dedicatedDrawCalls,
    active = true,
    sameRenderer = false,
} = {}) {
    const sharedRenderer = { lastFrameDrawCalls: sharedCalls };
    const dedicatedRenderer = sameRenderer
        ? sharedRenderer
        : {
            info: {
                render: dedicatedDrawCalls === undefined
                    ? { calls: dedicatedCalls }
                    : { drawCalls: dedicatedDrawCalls, calls: dedicatedCalls },
            },
        };
    return {
        themeManager: {
            webglRenderer: sharedRenderer,
            activeTheme: {
                isActive: active,
                renderer: dedicatedRenderer,
            },
        },
    };
}

describe('active theme draw-call accounting', () => {
    it('adds dedicated WebGL and shared background calls', () => {
        const windowRef = createWindowCounterState({ sharedCalls: 7, dedicatedCalls: 63 });
        expect(resolveActiveThemeDrawCalls(windowRef)).toBe(70);
    });

    it('accepts WebGPU-style drawCalls counters', () => {
        const windowRef = createWindowCounterState({
            sharedCalls: 3,
            dedicatedCalls: 99,
            dedicatedDrawCalls: 12,
        });
        expect(resolveActiveThemeDrawCalls(windowRef)).toBe(15);
    });

    it('does not count a shared renderer twice', () => {
        const windowRef = createWindowCounterState({ sharedCalls: 9, sameRenderer: true });
        expect(resolveActiveThemeDrawCalls(windowRef)).toBe(9);
    });

    it('reports only shared work for an inactive theme', () => {
        const windowRef = createWindowCounterState({
            sharedCalls: 4,
            dedicatedCalls: 80,
            active: false,
        });
        expect(resolveActiveThemeDrawCalls(windowRef)).toBe(4);
    });

    it('normalizes missing and invalid counters to zero', () => {
        expect(resolveActiveThemeDrawCalls(null)).toBe(0);
        expect(resolveActiveThemeDrawCalls({ activeDrawCalls: Number.NaN })).toBe(0);
        expect(resolveActiveThemeDrawCalls({ activeDrawCalls: -5 })).toBe(0);
    });
});

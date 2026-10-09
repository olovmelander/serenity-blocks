import { describe, expect, it, vi } from 'vitest';
import {
    advancePortalTravel, canDrawPortalTunnel, createPortalTunnel, drawPortalTunnel,
} from '../../src/rendering/transitions/portal-tunnel.js';

function recordingContext() {
    const calls = [];
    const gradient = () => ({ addColorStop: vi.fn() });
    const ctx = {
        calls,
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        createRadialGradient: vi.fn(gradient),
        fillRect: vi.fn(),
    };
    ['beginPath', 'arc', 'stroke', 'fill', 'moveTo', 'lineTo'].forEach((name) => {
        ctx[name] = vi.fn((...args) => calls.push([name, ...args]));
    });
    return ctx;
}

function seeded() {
    let state = 7;
    return () => {
        state = (state * 16807) % 2147483647;
        return (state - 1) / 2147483646;
    };
}

const frame = (overrides = {}) => ({
    width: 1280, height: 800, cx: 640, cy: 400, travel: 0.4, intensity: 1, ...overrides,
});

describe('Odyssey portal tunnel', () => {
    it('scales its rings and streaks with the quality preset', () => {
        const minimal = createPortalTunnel({ qualityPreset: 'Minimal', random: seeded() });
        const extreme = createPortalTunnel({ qualityPreset: 'Extreme', random: seeded() });
        expect(minimal.rings.length).toBeLessThan(extreme.rings.length);
        expect(minimal.streaks.length).toBeLessThan(extreme.streaks.length);
        expect(createPortalTunnel({ qualityPreset: 'Unknown', random: seeded() }).rings).toHaveLength(13);
        minimal.rings.forEach((ring) => {
            expect(ring.segments.length).toBeGreaterThanOrEqual(2);
            const covered = ring.segments.reduce((sum, segment) => sum + segment.length, 0);
            // Arcs with gaps: a corridor of light, never a closed target ring.
            expect(covered).toBeLessThan(Math.PI * 2);
        });
    });

    it('takes the destination colours from the portal palette', () => {
        const tunnel = createPortalTunnel({
            palette: { primary: '#8cf4ff', accent: '#c8fbff', highlight: '#ffffff' }, random: seeded(),
        });
        expect(tunnel.colors).toEqual(['#8cf4ff', '#c8fbff', '#ffffff']);
        expect(createPortalTunnel({ random: seeded() }).colors).toEqual(['#ffd38a', '#fff3c8', '#ffffff']);
    });

    it('skips contexts that cannot stroke, and draws nothing when it has faded out', () => {
        const tunnel = createPortalTunnel({ random: seeded() });
        expect(canDrawPortalTunnel(null)).toBe(false);
        expect(canDrawPortalTunnel({ arc: vi.fn(), beginPath: vi.fn(), fill: vi.fn() })).toBe(false);
        expect(drawPortalTunnel({ arc: vi.fn() }, tunnel, frame())).toBe(false);
        const ctx = recordingContext();
        expect(drawPortalTunnel(ctx, tunnel, frame({ intensity: 0, bloom: 0 }))).toBe(false);
        expect(ctx.calls).toEqual([]);
    });

    it('draws additively and restores the context it borrowed', () => {
        const ctx = recordingContext();
        const tunnel = createPortalTunnel({ random: seeded() });
        expect(drawPortalTunnel(ctx, tunnel, frame())).toBe(true);
        expect(ctx.calls.some(([name]) => name === 'stroke')).toBe(true);
        expect(ctx.calls.some(([name]) => name === 'lineTo')).toBe(true);
        expect(ctx.fillRect).toHaveBeenCalledOnce();
        expect(ctx.globalAlpha).toBe(1);
        expect(ctx.globalCompositeOperation).toBe('source-over');
    });

    it('streams outward into an orb and inward when pulling back out', () => {
        const tunnel = createPortalTunnel({ qualityPreset: 'Minimal', random: seeded() });
        const radii = (direction, travel) => {
            const ctx = recordingContext();
            drawPortalTunnel(ctx, tunnel, frame({ direction, travel }));
            return ctx.calls.filter(([name, , , radius]) => name === 'arc' && radius > 50).map((call) => call[3]);
        };
        const ring = (direction, travel) => {
            const depth = ((tunnel.rings[2].phase + travel * 0.32) % 1);
            return direction < 0 ? 1 - depth : depth;
        };
        expect(ring(1, 0.5)).toBeGreaterThan(ring(1, 0.4));
        expect(ring(-1, 0.5)).toBeLessThan(ring(-1, 0.4));
        expect(radii(1, 0.4).length).toBeGreaterThan(0);
        expect(radii(-1, 0.4).length).toBeGreaterThan(0);
    });

    it('blooms on reveal even as the corridor itself fades', () => {
        const ctx = recordingContext();
        const tunnel = createPortalTunnel({ random: seeded() });
        expect(drawPortalTunnel(ctx, tunnel, frame({ intensity: 0, bloom: 0.8 }))).toBe(true);
        expect(ctx.createRadialGradient).toHaveBeenCalledOnce();
        expect(ctx.calls.filter(([name]) => name === 'stroke')).toHaveLength(0);
    });

    it('integrates travel so a change of speed never jumps, and ignores long stalls', () => {
        const state = {};
        expect(advancePortalTravel(state, 1000, 1)).toBe(0);
        expect(advancePortalTravel(state, 1100, 1)).toBeCloseTo(0.1, 6);
        expect(advancePortalTravel(state, 1200, 3)).toBeCloseTo(0.4, 6);
        // A frozen tab resumes where it was, at most one capped frame later.
        expect(advancePortalTravel(state, 61200, 1)).toBeCloseTo(0.5, 6);
    });
});

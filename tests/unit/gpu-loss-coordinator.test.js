/**
 * GpuLossCoordinator pins (plan §4.2) — the missing CONTEXT_LOST consumer.
 * Fully unit-testable without a GPU: a mock bus + emitted loss payloads.
 */
import {
    describe, it, expect, vi, beforeEach,
} from 'vitest';
import { GpuLossCoordinator } from '../../src/utils/gpu-loss-coordinator.js';

const EVENTS = { CONTEXT_LOST: 'contextLost', EXIT_TO_MAIN_MENU: 'exitToMainMenu' };

// Flush the fire-and-forget recovery promise chain (a bus handler can't await).
const flush = () => new Promise((r) => { setTimeout(r, 0); });

/** Minimal synchronous bus that records emits and lets a test fire losses. */
function makeBus() {
    const handlers = new Map();
    return {
        emits: [],
        on(name, h) {
            if (!handlers.has(name)) handlers.set(name, new Set());
            handlers.get(name).add(h);
            return () => handlers.get(name).delete(h);
        },
        emit(name, payload) {
            this.emits.push({ name, payload });
            handlers.get(name)?.forEach((h) => h(payload));
        },
        fireLoss(payload) { this.emit(EVENTS.CONTEXT_LOST, payload); },
    };
}

describe('GpuLossCoordinator — observation (diagnosability)', () => {
    let bus; let coord;
    beforeEach(() => { bus = makeBus(); coord = new GpuLossCoordinator(bus, EVENTS); });

    it('counts every loss by type for the support bundle', () => {
        bus.fireLoss({ type: 'webgl', label: 'ocean' });
        bus.fireLoss({ type: 'webgpu-error', label: 'ice-temple', message: 'oops' });
        bus.fireLoss({ type: 'webgpu-error', label: 'ice-temple' });
        const s = coord.getStats();
        expect(s.observed.webgl).toBe(1);
        expect(s.observed['webgpu-error']).toBe(2);
        expect(s.lastLoss).toEqual({ type: 'webgpu-error', label: 'ice-temple' });
    });

    it('a webgpu-error (uncaptured error, not a device loss) never recovers', () => {
        const recover = vi.fn();
        coord.registerSurface('x', { recover });
        bus.fireLoss({ type: 'webgpu-error', label: 'x' });
        expect(recover).not.toHaveBeenCalled();
    });

    it('a webgl loss is counted but not coordinator-recovered (browser restore owns it)', () => {
        const recover = vi.fn();
        coord.registerSurface('ocean', { recover });
        bus.fireLoss({ type: 'webgl', label: 'ocean' });
        expect(recover).not.toHaveBeenCalled();
        expect(coord.getStats().observed.webgl).toBe(1);
    });

    it('a webgpu loss on an unregistered surface is counted as unhandled', () => {
        bus.fireLoss({ type: 'webgpu', label: 'nobody' });
        expect(coord.getStats().unhandledWebgpu).toBe(1);
    });
});

describe('GpuLossCoordinator — coordinated WebGPU recovery', () => {
    let bus; let coord;
    beforeEach(() => { bus = makeBus(); coord = new GpuLossCoordinator(bus, EVENTS); });

    it('invokes recover() once on the first webgpu loss', async () => {
        const recover = vi.fn().mockResolvedValue(undefined);
        coord.registerSurface('theme', { recover });
        bus.fireLoss({ type: 'webgpu', label: 'theme' });
        await flush();
        expect(recover).toHaveBeenCalledTimes(1);
        expect(coord.getStats().recovered).toBe(1);
    });

    it('routes OUT on the second loss (no retry loop on a TDR-d iGPU)', async () => {
        const recover = vi.fn().mockResolvedValue(undefined);
        const routeOut = vi.fn();
        coord.registerSurface('theme', { recover, routeOut });
        bus.fireLoss({ type: 'webgpu', label: 'theme' });
        await flush();
        bus.fireLoss({ type: 'webgpu', label: 'theme' });
        expect(recover).toHaveBeenCalledTimes(1);
        expect(routeOut).toHaveBeenCalledTimes(1);
        expect(coord.getStats().routedOut).toBe(1);
    });

    it('routes OUT (default: EXIT_TO_MAIN_MENU) when recover() throws', async () => {
        const recover = vi.fn().mockRejectedValue(new Error('device gone'));
        coord.registerSurface('theme', { recover });
        bus.fireLoss({ type: 'webgpu', label: 'theme' });
        await flush();
        const exit = bus.emits.find((e) => e.name === EVENTS.EXIT_TO_MAIN_MENU);
        expect(exit).toBeTruthy();
        expect(coord.getStats().routedOut).toBe(1);
    });

    it('unregister stops coordinated recovery', () => {
        const recover = vi.fn();
        const off = coord.registerSurface('theme', { recover });
        off();
        bus.fireLoss({ type: 'webgpu', label: 'theme' });
        expect(recover).not.toHaveBeenCalled();
        expect(coord.getStats().unhandledWebgpu).toBe(1);
    });

    it('dispose() unsubscribes so later losses are ignored', () => {
        const recover = vi.fn();
        coord.registerSurface('theme', { recover });
        coord.dispose();
        bus.fireLoss({ type: 'webgpu', label: 'theme' });
        expect(recover).not.toHaveBeenCalled();
    });
});

// @ts-check
/**
 * GPU-loss coordinator (remediation plan §4.2) — the ONE consumer of
 * EVENTS.CONTEXT_LOST, which was write-only until now (gpu-context-resilience.js
 * emitted losses that nothing subscribed to → a frozen canvas was a silent
 * failure the project has mis-attributed before).
 *
 * Two jobs:
 *  1. OBSERVE every loss for diagnosability — counts by type, feeding the
 *     support bundle (plan §8.7). Global; no registration needed.
 *  2. ORCHESTRATE recovery for surfaces that OPT IN via registerSurface():
 *     - webgl: rely on the browser's restore + BaseTheme's existing
 *       CONTEXT_RESTORED rebuild — the coordinator only counts it.
 *     - webgpu (terminal — no restore event): invoke the surface's recover()
 *       callback ONCE; a second loss for the same surface routes OUT (a genuine
 *       TDR'd iGPU re-triggers loss on retry, so a retry loop is the wrong move).
 *     - webgpu-error (uncaptured error, NOT a device loss): diagnostic count
 *       only — never triggers recovery (recovering on every uncaptured error
 *       would storm).
 *
 * Surfaces that already wire their own onDeviceLost through
 * gpuResilience.monitorWebGPU (cosmic-noir, ocean, void-ember today) keep it —
 * they simply don't registerSurface(), so the coordinator won't double-recover.
 * The Camp-2 shadow themes + Camp-0 (no handling) + Odyssey migrate to
 * registerSurface() in later GPU-verified sessions (one theme per session).
 *
 * Unit-testable without a GPU: construct with a mock bus, emit CONTEXT_LOST.
 */
import { eventBus, EVENTS } from '../events/event-bus.js';

/**
 * @typedef {Object} GpuSurface
 * @property {() => (void | Promise<void>)} recover  Dispose + rebuild this surface's renderer/scene.
 * @property {() => void} [routeOut]  Called after recovery is exhausted (default: emit EXIT_TO_MAIN_MENU).
 */

export class GpuLossCoordinator {
    /**
     * @param {{ on: Function, emit: Function }} bus
     * @param {{ EXIT_TO_MAIN_MENU: string, CONTEXT_LOST: string }} events
     */
    constructor(bus, events) {
        this.bus = bus;
        this.events = events;
        /** @type {Map<string, GpuSurface & { attempts: number }>} */
        this.surfaces = new Map();
        this.stats = {
            observed: {
                webgl: 0, webgpu: 0, 'webgpu-error': 0, other: 0,
            },
            recovered: 0,
            routedOut: 0,
            unhandledWebgpu: 0,
            lastLoss: null,
        };
        this._unsub = bus.on(events.CONTEXT_LOST, (/** @type {any} */ payload) => this._onLoss(payload));
    }

    /**
     * Opt a surface into coordinated WebGPU recovery.
     * @param {string} label  Must match the label passed to gpuResilience.monitor*.
     * @param {GpuSurface} surface
     * @returns {() => void} unregister
     */
    registerSurface(label, surface) {
        this.surfaces.set(label, { ...surface, attempts: 0 });
        return () => this.unregisterSurface(label);
    }

    /** @param {string} label */
    unregisterSurface(label) {
        this.surfaces.delete(label);
    }

    /** @param {any} payload */
    _onLoss(payload) {
        const type = payload?.type || 'other';
        const bucket = type in this.stats.observed ? type : 'other';
        this.stats.observed[bucket] += 1;
        this.stats.lastLoss = { type, label: payload?.label ?? null };

        // Only a genuine WebGPU device loss is terminal + coordinator-recoverable.
        if (type !== 'webgpu') return;

        const surface = payload?.label != null ? this.surfaces.get(payload.label) : undefined;
        if (!surface) {
            // A WebGPU loss on a surface that opted into observation but not
            // coordinated recovery (or its own onDeviceLost handles it).
            this.stats.unhandledWebgpu += 1;
            return;
        }

        if (surface.attempts >= 1) {
            this.stats.routedOut += 1;
            this._routeOut(surface);
            return;
        }
        surface.attempts += 1;
        Promise.resolve()
            .then(() => surface.recover())
            .then(() => { this.stats.recovered += 1; })
            .catch((err) => {
                console.error(`[GpuLossCoordinator] recovery for "${payload.label}" failed:`, err);
                this.stats.routedOut += 1;
                this._routeOut(surface);
            });
    }

    /** @param {GpuSurface} surface */
    _routeOut(surface) {
        if (typeof surface.routeOut === 'function') {
            surface.routeOut();
        } else {
            this.bus.emit(this.events.EXIT_TO_MAIN_MENU, { reason: 'gpu-loss-unrecoverable' });
        }
    }

    /** Snapshot for the support bundle (plan §8.7). */
    getStats() {
        return {
            observed: { ...this.stats.observed },
            recovered: this.stats.recovered,
            routedOut: this.stats.routedOut,
            unhandledWebgpu: this.stats.unhandledWebgpu,
            lastLoss: this.stats.lastLoss,
            registeredSurfaces: this.surfaces.size,
        };
    }

    dispose() {
        this._unsub?.();
        this.surfaces.clear();
    }
}

// Lazily-built singleton wired to the real bus. Kept lazy (not built at module
// top level) so importing this module for the CLASS in tests doesn't subscribe
// a second live listener to the shared eventBus.
let singleton = null;

/** @returns {GpuLossCoordinator} */
function getSingleton() {
    if (!singleton) singleton = new GpuLossCoordinator(eventBus, EVENTS);
    return singleton;
}

/** Ensure the singleton coordinator is subscribed to CONTEXT_LOST (idempotent). */
export function initGpuLossCoordinator() {
    return getSingleton();
}

/**
 * Register a GPU surface for coordinated recovery (app-code entry point).
 * Ensures the singleton coordinator is live first.
 * @param {string} label
 * @param {GpuSurface} surface
 * @returns {() => void} unregister
 */
export function registerGpuSurface(label, surface) {
    return getSingleton().registerSurface(label, surface);
}

/** Snapshot for the support bundle; null if the coordinator was never initialized. */
export function getGpuLossStats() {
    return singleton ? singleton.getStats() : null;
}

/**
 * @fileoverview Centralized GPU context loss/restore handling
 * Monitors WebGL and WebGPU contexts and broadcasts events through the EventBus.
 * Themes and renderers can subscribe instead of duplicating listener logic.
 */

import { eventBus, EVENTS } from '../events/event-bus.js';

class GPUContextResilience {
    constructor() {
        /** @type {Map<HTMLCanvasElement, {lost: Function, restored: Function}>} */
        this._webglCanvases = new Map();
        /** @type {Map<GPUDevice, boolean>} active tracking for WebGPU devices */
        this._webgpuDevices = new Map();
        this.recoveryInProgress = false;
        this.stats = { lossCount: 0, recoveryCount: 0, lastLossTime: null };
    }

    /**
     * Monitor a WebGL canvas for context loss/restore events.
     * @param {HTMLCanvasElement} canvas
     * @param {Object} [options]
     * @param {Function} [options.onLost] - Additional local handler on context loss
     * @param {Function} [options.onRestored] - Additional local handler on context restore
     * @param {string} [options.label] - Label for log messages (e.g. theme name)
     * @returns {Function} Unsubscribe function
     */
    monitorWebGL(canvas, options = {}) {
        if (this._webglCanvases.has(canvas)) {
            // The first monitor owns the listeners. Handing this caller an unsubscribe for
            // them would let it tear down the owner's monitoring (monitorWebGPU dedupes the
            // same way).
            return () => {};
        }

        const label = options.label || 'unknown';

        const onLost = (event) => {
            event.preventDefault(); // Allows browser to attempt context restore
            this.stats.lossCount++;
            this.stats.lastLossTime = Date.now();
            console.warn(`[GPUResilience] WebGL context lost (${label})`);
            eventBus.emit(EVENTS.CONTEXT_LOST, {
                type: 'webgl', canvas, event, label,
            });
            options.onLost?.(event);
        };

        const onRestored = () => {
            this.stats.recoveryCount++;
            console.warn(`[GPUResilience] WebGL context restored (${label})`);
            eventBus.emit(EVENTS.CONTEXT_RESTORED, { type: 'webgl', canvas, label });
            options.onRestored?.();
        };

        canvas.addEventListener('webglcontextlost', onLost, false);
        canvas.addEventListener('webglcontextrestored', onRestored, false);
        this._webglCanvases.set(canvas, { lost: onLost, restored: onRestored });

        return () => this.unmonitorWebGL(canvas);
    }

    /**
     * Stop monitoring a WebGL canvas.
     * @param {HTMLCanvasElement} canvas
     */
    unmonitorWebGL(canvas) {
        const handlers = this._webglCanvases.get(canvas);
        if (!handlers) return;
        canvas.removeEventListener('webglcontextlost', handlers.lost, false);
        canvas.removeEventListener('webglcontextrestored', handlers.restored, false);
        this._webglCanvases.delete(canvas);
    }

    /**
     * Monitor a WebGPU device for loss.
     * @param {GPUDevice} device
     * @param {Object} [options]
     * @param {Function} [options.onDeviceLost] - Additional local handler on device loss
     * @param {string} [options.label] - Label for log messages
     * @returns {Function} Unsubscribe function
     */
    monitorWebGPU(device, options = {}) {
        if (!device?.lost || this._webgpuDevices.has(device)) {
            return () => {};
        }

        const label = options.label || 'unknown';
        let onDeviceLost = typeof options.onDeviceLost === 'function'
            ? options.onDeviceLost
            : null;
        let active = true;

        device.lost.then((info) => {
            if (!active) return;
            const reason = info?.reason || 'unknown';
            // destroy() resolves `lost` too, with reason 'destroyed' (three's own backend
            // ignores it). That is a teardown, not a GPU failure: do not count or warn, and the
            // coordinator does not recover it. It is still broadcast, because a surface that
            // shares this device (the boot warp on the intro's) must stop drawing on it.
            const destroyed = reason === 'destroyed';
            if (destroyed) {
                console.info(`[GPUResilience] WebGPU device destroyed (${label})`);
            } else {
                this.stats.lossCount++;
                this.stats.lastLossTime = Date.now();
                console.warn(`[GPUResilience] WebGPU device lost (${label}): ${reason}`);
            }
            eventBus.emit(EVENTS.CONTEXT_LOST, {
                type: 'webgpu', device, info, label, destroyed,
            });
            onDeviceLost?.(info);
        });

        // Phase 1: Monitor uncaptured WebGPU errors for diagnostics
        const onUncapturedError = (event) => {
            if (!active) return;
            const msg = event?.error?.message || 'unknown';
            console.error(`[GPUResilience] WebGPU uncaptured error (${label}): ${msg}`);
            eventBus.emit(EVENTS.CONTEXT_LOST, {
                type: 'webgpu-error', device, label, message: msg,
            });
        };
        if (typeof device.addEventListener === 'function') {
            device.addEventListener('uncapturederror', onUncapturedError);
        }

        this._webgpuDevices.set(device, true);

        return () => {
            active = false;
            // device.lost is a lifetime promise. Drop any theme-local closure
            // immediately instead of retaining its scene until the GPUDevice dies.
            onDeviceLost = null;
            if (typeof device.removeEventListener === 'function') {
                device.removeEventListener('uncapturederror', onUncapturedError);
            }
            this._webgpuDevices.delete(device);
        };
    }

    /**
     * Remove all monitors and reset state.
     */
    cleanup() {
        for (const canvas of [...this._webglCanvases.keys()]) {
            this.unmonitorWebGL(canvas);
        }
        this._webgpuDevices.clear();
    }
}

export const gpuResilience = new GPUContextResilience();

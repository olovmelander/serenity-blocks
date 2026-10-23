/* eslint-disable no-restricted-globals -- `self` is the Worker global scope */
/**
 * Module Worker that draws the portal gate on a transferred OffscreenCanvas, so the passage keeps
 * streaming while the page builds the orb's theme (portal-gate-worker-core.js has the why).
 */
import { createPortalGateWorkerCore } from './portal-gate-worker-core.js';

const core = createPortalGateWorkerCore({
    now: () => performance.now(),
    requestFrame: typeof self.requestAnimationFrame === 'function'
        ? (callback) => self.requestAnimationFrame(callback)
        : (callback) => setTimeout(callback, 16),
    makeCanvas: () => new OffscreenCanvas(1, 1),
});

self.onmessage = (event) => {
    try {
        core.handle(event?.data || {});
    } catch (error) {
        // A failed frame must not take the worker down: the next frame tries again.
        console.warn('[PortalGateWorker] frame failed:', error?.message || error);
    }
};

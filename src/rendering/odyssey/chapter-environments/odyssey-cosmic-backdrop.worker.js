/**
 * Module Worker for the ch6 cosmic backdrop bake (odyssey-cosmic-backdrop.js). Baked on the page
 * the field held the map's frames for ~0.5-0.9 s right after the reveal (measured 2026-10-19 at
 * Extreme on the dev laptop, even sliced): the slices left too little of each 7.6 ms frame.
 * Message in: { id, options }. Message out: { id, ok, value: Uint8Array } (buffer transferred).
 */
import { bakeCosmicBackdropData } from './odyssey-cosmic-backdrop-bake.js';

self.onmessage = (event) => {
    const { id, options } = event?.data || {};
    try {
        const value = bakeCosmicBackdropData(options || {});
        self.postMessage({ id, ok: true, value }, [value.buffer]);
    } catch (error) {
        self.postMessage({ id, ok: false, error: String(error?.message || error) });
    }
};

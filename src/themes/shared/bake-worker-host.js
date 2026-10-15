/* eslint-disable no-restricted-globals -- `self` is the Worker global scope */
/**
 * The worker side of a theme's bake worker (see bake-worker-client.js). A theme's worker entry is
 * three lines: import its pure bakes (no three, no DOM) and hand them to serveBakes.
 */

/** The typed arrays' buffers in a bake result (top level, arrays of them, objects of them). */
export function buffersOf(value, out = new Set(), depth = 0) {
    if (!value || depth > 3) return out;
    if (ArrayBuffer.isView(value)) out.add(value.buffer);
    else if (Array.isArray(value)) value.forEach((item) => buffersOf(item, out, depth + 1));
    else if (typeof value === 'object') Object.values(value).forEach((item) => buffersOf(item, out, depth + 1));
    return out;
}

/**
 * Answer { id, kind, args } messages with { id, ok, value } (buffers transferred) or { id, ok:
 * false, error }.
 * @param {Record<string, Function>} bakes  the theme's pure bakes, by job kind
 */
export function serveBakes(bakes) {
    self.onmessage = (event) => {
        const { id, kind, args } = event?.data || {};
        try {
            const bake = bakes[kind];
            if (!bake) throw new Error(`unknown bake ${kind}`);
            const value = bake(...(args || []));
            self.postMessage({ id, ok: true, value }, [...buffersOf(value)]);
        } catch (error) {
            self.postMessage({ id, ok: false, error: String(error?.message || error) });
        }
    };
}

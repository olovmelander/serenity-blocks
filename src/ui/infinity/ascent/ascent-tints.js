// @ts-check

/**
 * A theme's colours for the ascent's sky, read from its icon (a disc of its scene): the upper
 * band lends the glow at the night's edge, the lower band the ground the depths are hazed with,
 * so every world gets a sky of its own without a line of theme code.
 */

import { resolveHubThemeThumbnailUrl } from '../../serenity-hub/theme-thumbnail-manifest.js';

/** @param {number} value @param {number} min @param {number} max */
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * @typedef {{glow: number[], night: number[], ground: number[], mote: number[]}} AscentTints
 *   sRGB 0..255 triplets
 */

/**
 * @param {Uint8ClampedArray|number[]} data RGBA, row by row, `size` × `size`
 * @param {number} size
 * @returns {AscentTints | null} null for an icon with nothing opaque in it
 */
export function tintsFromIcon(data, size) {
    /** @param {number} y0 @param {number} y1 share of the height */
    const band = (y0, y1) => {
        let r = 0;
        let g = 0;
        let b = 0;
        let w = 0;
        for (let y = Math.floor(size * y0); y < Math.ceil(size * y1); y++) {
            for (let x = 0; x < size; x++) {
                const i = (y * size + x) * 4;
                const a = data[i + 3] / 255;
                if (a < 0.5) continue;
                r += data[i] * a;
                g += data[i + 1] * a;
                b += data[i + 2] * a;
                w += a;
            }
        }
        return w > 0 ? [r / w, g / w, b / w] : null;
    };
    const top = band(0.08, 0.42);
    const bottom = band(0.6, 0.94);
    if (!top) return null;
    /** @param {number[]} c */
    const luminance = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    /** A colour's hue at a luminance kept between lo and hi. @param {number[]} c @param {number} lo @param {number} hi */
    const scaleTo = (c, lo, hi) => {
        const l = Math.max(1, luminance(c));
        const k = clamp(l, lo, hi) / l;
        return c.map((v) => Math.round(clamp(v * k, 0, 255)));
    };
    /** @param {number[]} a @param {number[]} b @param {number} t */
    const mixRgb = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
    /** An average of a scene goes grey: give it back some of its colour. @param {number[]} c @param {number} k */
    const saturate = (c, k) => {
        const l = luminance(c);
        return c.map((v) => clamp(l + (v - l) * k, 0, 255));
    };
    const sky = saturate(top, 1.35);
    return {
        glow: scaleTo(sky, 74, 168),
        night: mixRgb(scaleTo(sky, 8, 14), [8, 9, 24], 0.55),
        ground: scaleTo(saturate(bottom || top, 1.2), 16, 40),
        mote: mixRgb([236, 240, 255], scaleTo(sky, 200, 230), 0.3),
    };
}

/** @type {Map<string, Promise<AscentTints | null>>} */
const cache = new Map();

/**
 * The tints for a theme (cached; null when its icon cannot be read).
 * @param {string} themeId
 * @returns {Promise<AscentTints | null>}
 */
export function loadThemeTints(themeId) {
    if (!themeId || typeof Image === 'undefined' || typeof document === 'undefined') return Promise.resolve(null);
    if (!cache.has(themeId)) {
        cache.set(themeId, (async () => {
            try {
                const url = resolveHubThemeThumbnailUrl(themeId);
                if (!url) return null;
                const image = new Image();
                image.decoding = 'async';
                image.src = url;
                await image.decode();
                const size = 24;
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (!ctx) return null;
                ctx.drawImage(image, 0, 0, size, size);
                return tintsFromIcon(ctx.getImageData(0, 0, size, size).data, size);
            } catch {
                return null;
            }
        })());
    }
    return /** @type {Promise<AscentTints | null>} */ (cache.get(themeId));
}

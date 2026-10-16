/**
 * Each theme's own light, for the words Serenity Mode puts over it — as each breathing world
 * has its accent (the eyebrow, the count, the glow of its bar).
 *
 * The colour is read from the theme's artwork (its round 512 px icon, which every theme has):
 * the most vivid, bright hue in it, made readable on the night scrims (saturated, light). It is
 * worked out once per theme and kept. Where the picture cannot be read (no icon, a canvas that
 * may not be read back), the theme's category hue stands in, the Hub's colours for its groups.
 */
import { getThemeMeta } from '../../themes/theme-registry.js';
import { resolveHubThemeThumbnailUrl } from '../serenity-hub/theme-thumbnail-manifest.js';

/** The Hub's group hues (keystone.css tokens), in r, g, b. */
const GROUP_ACCENTS = Object.freeze({
    biomes: [197, 241, 207],
    meditation: [243, 210, 141],
    fantasy: [245, 174, 208],
    urban: [148, 200, 255],
    sky: [148, 200, 255],
    abstract: [158, 232, 237],
    atmospheric: [158, 232, 237],
});
const DEFAULT_ACCENT = Object.freeze([184, 164, 255]);
const SAMPLE = 28;
const HUE_BINS = 24;

const accents = new Map();
const pending = new Map();

/** @param {string|null} themeId @returns {number[]} the theme's category hue */
export function groupAccent(themeId) {
    return [...(GROUP_ACCENTS[getThemeMeta(themeId)?.group] || DEFAULT_ACCENT)];
}

/** The accent already known for a theme (worked out or its group's), without waiting. */
export function knownAccent(themeId) {
    return accents.get(themeId) || groupAccent(themeId);
}

function rgbToHsl(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h / 6, s, l];
}

function hslToRgb(h, s, l) {
    if (s === 0) return [l, l, l];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const channel = (t0) => {
        let t = t0;
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

/**
 * The accent in a picture's pixels: the hue that carries the most vivid, bright colour,
 * averaged, then lifted to read on a dark scrim.
 * @param {ArrayLike<number>} data RGBA bytes
 * @returns {number[]|null} [r, g, b] 0..255, or null for a picture with no colour to speak of
 */
export function accentFromPixels(data) {
    const bins = Array.from({ length: HUE_BINS }, () => ({
        weight: 0, r: 0, g: 0, b: 0,
    }));
    let total = 0;
    for (let i = 0; i + 3 < data.length; i += 4) {
        if (data[i + 3] < 200) continue;
        const r = data[i] / 255;
        const g = data[i + 1] / 255;
        const b = data[i + 2] / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const s = max > 0 ? (max - min) / max : 0;
        const weight = (s ** 1.5) * (max ** 2);
        if (weight < 0.02) continue;
        const [h] = rgbToHsl(r, g, b);
        const bin = bins[Math.min(HUE_BINS - 1, Math.floor(h * HUE_BINS))];
        bin.weight += weight;
        bin.r += r * weight;
        bin.g += g * weight;
        bin.b += b * weight;
        total += weight;
    }
    if (total < 1) return null;
    // The strongest hue, with its neighbours (a hue that sits on a bin edge is not split).
    let best = 0;
    for (let i = 1; i < HUE_BINS; i++) if (bins[i].weight > bins[best].weight) best = i;
    const pick = [best - 1, best, best + 1].map((i) => bins[(i + HUE_BINS) % HUE_BINS]);
    const weight = pick.reduce((sum, bin) => sum + bin.weight, 0);
    const mean = ['r', 'g', 'b'].map((k) => pick.reduce((sum, bin) => sum + bin[k], 0) / weight);
    const [h, s, l] = rgbToHsl(...mean);
    // Readable over the night scrims: saturated enough to be a colour, light enough to be read.
    const rgb = hslToRgb(h, Math.min(0.95, Math.max(0.6, s)), Math.min(0.8, Math.max(0.66, l)));
    return rgb.map((c) => Math.round(c * 255));
}

function readIcon(url) {
    return new Promise((resolve) => {
        if (typeof Image === 'undefined' || typeof document === 'undefined' || !url) {
            resolve(null);
            return;
        }
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = SAMPLE;
                canvas.height = SAMPLE;
                const context = canvas.getContext('2d', { willReadFrequently: true });
                context.drawImage(image, 0, 0, SAMPLE, SAMPLE);
                resolve(accentFromPixels(context.getImageData(0, 0, SAMPLE, SAMPLE).data));
            } catch {
                // A picture that may not be read back (another origin, a locked-down build).
                resolve(null);
            }
        };
        image.onerror = () => resolve(null);
        image.src = url;
    });
}

/**
 * The theme's accent, worked out from its artwork once and kept.
 * @param {string} themeId
 * @returns {Promise<number[]>} [r, g, b]
 */
export function themeAccent(themeId) {
    if (accents.has(themeId)) return Promise.resolve(accents.get(themeId));
    if (pending.has(themeId)) return pending.get(themeId);
    const work = readIcon(resolveHubThemeThumbnailUrl(themeId, undefined, null)).then((rgb) => {
        const accent = rgb || groupAccent(themeId);
        accents.set(themeId, accent);
        pending.delete(themeId);
        return accent;
    });
    pending.set(themeId, work);
    return work;
}

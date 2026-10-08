/**
 * Himalayan Peak — the baked amphitheatre.
 *
 * `assets/massif.png` is written by scripts/himalayan-peak/bake-massif.mjs: the plan of ridges
 * after rain has run down it, as sixteen-bit heights (red × 256 + green) with the sky each point
 * sees in blue. This module reads it and derives what the materials need from it. Where the
 * image cannot be read (no image decoding, a failed request) the plan itself is sampled small
 * and unweathered instead, so the mountain is always there.
 */
import { GRID } from './himalayan-peak-core.js';
import {
    buildMassifMesh, decodeMassif, horizonMap, shadeMap, shadowSlices,
} from './himalayan-peak-field.js';
import { buildPlanHeights } from './himalayan-peak-massif.js';
import manifest from './assets/massif-manifest.json';

export const MASSIF_URL = new URL('./assets/massif.png', import.meta.url).href;
export const MASSIF_SCHEMA = 1;
/** Side of the generated stand-in when the baked image cannot be read. */
export const PLAN_SIZE = 256;

/** The plan sampled directly: every point sees the whole sky. */
export function planMassif(size = PLAN_SIZE) {
    return {
        heights: buildPlanHeights(size), sky: new Uint8Array(size * size).fill(235), size, source: 'plan',
    };
}

/**
 * The image decoded by hand: its chunks, one inflate, the row filters the bake writes (none, sub,
 * up). A 2D canvas would do, but canvases may be handed back with noise in them (anti-
 * fingerprinting), and one flipped bit of the high byte is seventeen metres of mountain.
 */
async function readExact(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    let offset = 8;
    let width = 0;
    let height = 0;
    const parts = [];
    while (offset + 8 <= bytes.length) {
        const length = view.getUint32(offset);
        const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
        if (type === 'IHDR') {
            width = view.getUint32(offset + 8);
            height = view.getUint32(offset + 12);
            if (bytes[offset + 16] !== 8 || bytes[offset + 17] !== 6) throw new Error('massif is not 8-bit RGBA');
        } else if (type === 'IDAT') parts.push(bytes.subarray(offset + 8, offset + 8 + length));
        offset += length + 12;
    }
    const inflated = new Response(new Blob(parts).stream().pipeThrough(new DecompressionStream('deflate')));
    const raw = new Uint8Array(await inflated.arrayBuffer());
    const stride = width * 4;
    if (raw.length !== (stride + 1) * height) throw new Error('massif data is short');
    const rgba = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        const src = y * (stride + 1) + 1;
        const row = y * stride;
        if (filter === 0) rgba.set(raw.subarray(src, src + stride), row);
        else if (filter === 1) {
            for (let x = 0; x < stride; x++) rgba[row + x] = (raw[src + x] + (x >= 4 ? rgba[row + x - 4] : 0)) & 255;
        } else if (filter === 2) {
            for (let x = 0; x < stride; x++) rgba[row + x] = (raw[src + x] + (y > 0 ? rgba[row - stride + x] : 0)) & 255;
        } else throw new Error(`massif row filter ${filter}`);
    }
    return { width, height, rgba };
}

async function readPixels(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`massif request failed: ${response.status}`);
    if (typeof DecompressionStream === 'function') return readExact(await response.arrayBuffer());
    // No colour conversion and no premultiplication: the bytes ARE the data.
    const bitmap = await createImageBitmap(await response.blob(), {
        colorSpaceConversion: 'none', premultiplyAlpha: 'none',
    });
    const { width, height } = bitmap;
    const canvas = typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement('canvas'), { width, height });
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return { width, height, rgba: context.getImageData(0, 0, width, height).data };
}

/**
 * Read the baked amphitheatre. Never rejects.
 * @returns {Promise<{ heights: Float32Array, sky: Uint8Array, size: number, source: 'asset' | 'plan' }>}
 */
export async function loadMassif(url = MASSIF_URL) {
    try {
        const canDecode = typeof DecompressionStream === 'function' || typeof createImageBitmap === 'function';
        if (typeof fetch !== 'function' || typeof document === 'undefined' || !canDecode) return planMassif();
        if (manifest.schema !== MASSIF_SCHEMA) throw new Error(`massif schema ${manifest.schema}`);
        const { width, height, rgba } = await readPixels(url);
        if (width !== height || width !== manifest.size) throw new Error(`massif is ${width}×${height}`);
        const { heights, sky } = decodeMassif(rgba, width);
        return {
            heights, sky, size: width, source: 'asset',
        };
    } catch (error) {
        console.warn('[HimalayanPeak] baked massif unavailable, drawing the plan:', error?.message || error);
        return planMassif();
    }
}

/** Let the page breathe between two pieces of work. */
const breathe = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/**
 * deriveField() in steps, yielding to the page between them, plus the massif's mesh for
 * `stride`: about half a second of arithmetic that must not land in one frame.
 * @param {{ heights: Float32Array, sky: Uint8Array, size: number, source: string }} massif
 * @param {number} stride  grid cells per mesh cell (the tier's)
 */
export async function deriveFieldInSteps(massif, stride) {
    const { heights, sky, size } = massif;
    const lowSize = Math.min(256, size);
    const shade = shadeMap(heights, sky, size);
    await breathe();
    const horizon = horizonMap(heights, size);
    await breathe();
    const slices = shadowSlices(heights, size, lowSize);
    await breathe();
    const mesh = { ...buildMassifMesh(heights, size, { stride }), stride };
    await breathe();
    return {
        heights,
        size,
        source: massif.source,
        cell: GRID.span / (size - 1),
        shade,
        horizon,
        volume: slices.volume,
        low: slices.low,
        lowSize,
        mesh,
    };
}

/**
 * Everything the materials read, derived from the heights.
 * @param {{ heights: Float32Array, sky: Uint8Array, size: number, source: string }} massif
 */
export function deriveField(massif) {
    const { heights, sky, size } = massif;
    const lowSize = Math.min(256, size);
    const slices = shadowSlices(heights, size, lowSize);
    return {
        heights,
        size,
        source: massif.source,
        cell: GRID.span / (size - 1),
        shade: shadeMap(heights, sky, size),
        horizon: horizonMap(heights, size),
        volume: slices.volume,
        low: slices.low,
        lowSize,
    };
}

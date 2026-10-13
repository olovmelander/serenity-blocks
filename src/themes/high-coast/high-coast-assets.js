/**
 * High Coast — the baked coast.
 *
 * `assets/coast-{near,mid,far}.png` are written by scripts/high-coast/bake-coast.mjs: the
 * plan of the coast with its joints and beach ridges, sixteen-bit heights (red × 256 + green), sky
 * visibility in blue, forest cover in alpha. This module reads them; where an image cannot be read
 * (no image decoding, a failed request) the plan itself is sampled small instead,
 * so the land is always there.
 */
import { FIELDS, FIELD_ORDER } from './high-coast-core.js';
import { decodeField, postX, postZ } from './high-coast-field.js';
import { planCover, planHeight } from './high-coast-plan.js';

export const COAST_URLS = Object.freeze({
    near: new URL('./assets/coast-near.png', import.meta.url).href,
    mid: new URL('./assets/coast-mid.png', import.meta.url).href,
    far: new URL('./assets/coast-far.png', import.meta.url).href,
});
/** The bake's schema (assets/coast-manifest.json carries it; the tests pin the two together). */
export const COAST_SCHEMA = 1;
/** Posts per side of each field's stand-in when the baked image cannot be read. */
export const PLAN_SIZE = 192;

/** Let the page breathe between two pieces of work. */
export const breathe = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/**
 * The plan sampled directly on a small grid, as a field of the same placement (the size differs:
 * the caller resamples). Every point sees the whole sky; the forest follows the plan's rules.
 * (`flow` is the field's cover byte: forest density.)
 */
export function planField(name, size = PLAN_SIZE) {
    const def = FIELDS[name];
    const small = { ...def, size };
    const heights = new Float32Array(size * size);
    for (let j = 0; j < size; j++) {
        const z = postZ(small, j);
        for (let i = 0; i < size; i++) heights[j * size + i] = planHeight(postX(small, i), z);
    }
    const flow = new Uint8Array(size * size);
    const cell = def.span / (size - 1);
    const cover = { forest: 0, heath: 0 };
    for (let j = 1; j < size - 1; j++) {
        for (let i = 1; i < size - 1; i++) {
            const o = j * size + i;
            const slope = Math.hypot(heights[o + 1] - heights[o - 1], heights[o + size] - heights[o - size]) / (2 * cell);
            planCover(postX(small, i), postZ(small, j), heights[o], slope, cover);
            flow[o] = Math.round(cover.forest * 255);
        }
    }
    return {
        heights, sky: new Uint8Array(size * size).fill(220), flow, size, source: 'plan',
    };
}

/**
 * The image decoded by hand: its chunks, one inflate, the row filters the bake writes (none, sub,
 * up). A 2D canvas would do, but canvases may be handed back with noise in them (anti-
 * fingerprinting), and one flipped bit of the high byte is twenty metres of mountain.
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
            if (bytes[offset + 16] !== 8 || bytes[offset + 17] !== 6) throw new Error('coast field is not 8-bit RGBA');
        } else if (type === 'IDAT') parts.push(bytes.subarray(offset + 8, offset + 8 + length));
        offset += length + 12;
    }
    const inflated = new Response(new Blob(parts).stream().pipeThrough(new DecompressionStream('deflate')));
    const raw = new Uint8Array(await inflated.arrayBuffer());
    const stride = width * 4;
    if (raw.length !== (stride + 1) * height) throw new Error('coast data is short');
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
        } else throw new Error(`coast row filter ${filter}`);
    }
    return { width, height, rgba };
}

async function readPixels(url, signal) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`coast request failed: ${response.status}`);
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

/** Bilinear resample of a small plan grid to a field's full size (so every consumer sees one size). */
function resample(small, size) {
    const n = small.size;
    const heights = new Float32Array(size * size);
    const flow = new Uint8Array(size * size);
    for (let j = 0; j < size; j++) {
        const fz = (j / (size - 1)) * (n - 1);
        const j0 = Math.min(n - 2, Math.floor(fz));
        const tz = fz - j0;
        for (let i = 0; i < size; i++) {
            const fx = (i / (size - 1)) * (n - 1);
            const i0 = Math.min(n - 2, Math.floor(fx));
            const tx = fx - i0;
            const o = j0 * n + i0;
            const a = small.heights[o];
            const b = small.heights[o + 1];
            const c = small.heights[o + n];
            const d = small.heights[o + n + 1];
            heights[j * size + i] = a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * tz;
            flow[j * size + i] = small.flow[Math.round(fz) * n + Math.round(fx)];
        }
    }
    return {
        heights, sky: new Uint8Array(size * size).fill(220), flow, size, source: 'plan',
    };
}

/**
 * Read the three baked fields. Never rejects (an abort does): a field that cannot be read is
 * replaced by the plan, resampled to the field's size.
 * @returns {Promise<{ near: object, mid: object, far: object, source: string }>}
 */
export async function loadCoast({ signal, urls = COAST_URLS } = {}) {
    const out = {};
    let fromAsset = 0;
    const canDecode = typeof DecompressionStream === 'function' || typeof createImageBitmap === 'function';
    const canFetch = typeof fetch === 'function' && typeof document !== 'undefined' && canDecode;
    for (const name of FIELD_ORDER) {
        const def = FIELDS[name];
        try {
            if (!canFetch) throw new Error('no image decoding here');
            // One field at a time, so the page breathes between them.
            // eslint-disable-next-line no-await-in-loop
            const { width, height, rgba } = await readPixels(urls[name], signal);
            if (width !== height || width !== def.size) throw new Error(`${name} field is ${width}×${height}`);
            out[name] = { ...decodeField(rgba, def), size: def.size, source: 'asset' };
            fromAsset++;
        } catch (error) {
            if (signal?.aborted) throw error;
            if (canFetch) console.warn(`[High Coast] baked ${name} field unavailable, drawing the plan:`, error?.message || error);
            out[name] = resample(planField(name), def.size);
        }
        // eslint-disable-next-line no-await-in-loop
        await breathe();
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    }
    if (fromAsset === FIELD_ORDER.length) out.source = 'asset';
    else out.source = fromAsset ? 'mixed' : 'plan';
    return out;
}

/** Synchronous stand-in (tests, a capture without network): the plan on every field. */
export function planCoast(size = PLAN_SIZE) {
    const out = {};
    for (const name of FIELD_ORDER) out[name] = resample(planField(name, size), FIELDS[name].size);
    out.source = 'plan';
    return out;
}

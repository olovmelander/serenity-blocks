/**
 * The colours of an orb's world, read from the picture the orb wears (its theme icon): the light
 * of the scene, its two strongest hues and its shadow. The portal passage is painted with them
 * (src/core/odyssey/theme-passage-palettes.js is the baked table; bake-odyssey-passage-palettes.mjs
 * writes it and tests/unit/odyssey-passage-palettes.test.js keeps the two in step).
 *
 * Pure node: a small PNG reader (8-bit RGB/RGBA, not interlaced: what the icon bake writes) on
 * node's own zlib, so neither the bake nor its test needs an image library or a browser.
 */
import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/**
 * @param {Uint8Array} bytes a PNG file
 * @returns {{width: number, height: number, channels: number, data: Uint8Array}} rows top to
 *   bottom, `channels` bytes a pixel (3 or 4)
 */
export function decodePng(bytes) {
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (!PNG_SIGNATURE.every((value, index) => buffer[index] === value)) throw new Error('not a PNG');
    let offset = 8;
    let header = null;
    const parts = [];
    while (offset < buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString('latin1', offset + 4, offset + 8);
        const body = buffer.subarray(offset + 8, offset + 8 + length);
        if (type === 'IHDR') {
            header = {
                width: body.readUInt32BE(0),
                height: body.readUInt32BE(4),
                depth: body[8],
                colorType: body[9],
                interlace: body[12],
            };
        } else if (type === 'IDAT') parts.push(body);
        else if (type === 'IEND') break;
        offset += 12 + length;
    }
    if (!header) throw new Error('PNG without a header');
    if (header.depth !== 8 || ![2, 6].includes(header.colorType) || header.interlace !== 0) {
        throw new Error(`unsupported PNG (depth ${header.depth}, type ${header.colorType}, interlace ${header.interlace})`);
    }
    const channels = header.colorType === 6 ? 4 : 3;
    const stride = header.width * channels;
    const raw = inflateSync(Buffer.concat(parts));
    const data = new Uint8Array(stride * header.height);
    for (let y = 0; y < header.height; y += 1) {
        const filter = raw[y * (stride + 1)];
        const from = y * (stride + 1) + 1;
        const to = y * stride;
        for (let x = 0; x < stride; x += 1) {
            const left = x >= channels ? data[to + x - channels] : 0;
            const up = y > 0 ? data[to + x - stride] : 0;
            const upLeft = (x >= channels && y > 0) ? data[to + x - stride - channels] : 0;
            let predicted = 0;
            if (filter === 1) predicted = left;
            else if (filter === 2) predicted = up;
            else if (filter === 3) predicted = (left + up) >> 1;
            else if (filter === 4) {
                const p = left + up - upLeft;
                const pa = Math.abs(p - left);
                const pb = Math.abs(p - up);
                const pc = Math.abs(p - upLeft);
                if (pa <= pb && pa <= pc) predicted = left;
                else predicted = pb <= pc ? up : upLeft;
            }
            data[to + x] = (raw[from + x] + predicted) & 255;
        }
    }
    return {
        width: header.width, height: header.height, channels, data,
    };
}

const HUE_BINS = 24;
const hex = (rgb) => `#${rgb.map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')}`;

function hueOf(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (d <= 0) return 0;
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return ((h * 60) + 360) % 360;
}

/**
 * The passage's four colours from one picture.
 * @param {{width: number, height: number, channels: number, data: Uint8Array}} image
 * @returns {{light: string, body: string, second: string, deep: string, key: number}} `light`
 *   the scene's key light, `body` its strongest hue, `second` its other hue (the body's own,
 *   shifted, when the picture has one hue only), `deep` its shadow, `key` its mean luminance
 *   (0 a night, 1 a white-out)
 */
export function extractPassagePalette(image) {
    const {
        width, height, channels, data,
    } = image;
    const samples = [];
    const half = width / 2;
    for (let y = 2; y < height; y += 4) {
        for (let x = 2; x < width; x += 4) {
            // The picture is a disc: its rim and the corners outside it say nothing of the world.
            if (Math.hypot(x - half, y - height / 2) > half * 0.9) continue;
            const o = (y * width + x) * channels;
            if (channels === 4 && data[o + 3] < 200) continue;
            const r = data[o];
            const g = data[o + 1];
            const b = data[o + 2];
            samples.push({
                r, g, b, lum: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255, chroma: (Math.max(r, g, b) - Math.min(r, g, b)) / 255,
            });
        }
    }
    if (!samples.length) throw new Error('empty picture');
    const mean = (list, weight = () => 1) => {
        let total = 0;
        const sum = [0, 0, 0];
        for (const sample of list) {
            const w = weight(sample);
            total += w;
            sum[0] += sample.r * w;
            sum[1] += sample.g * w;
            sum[2] += sample.b * w;
        }
        return total > 0 ? sum.map((value) => value / total) : [0, 0, 0];
    };
    const byLum = [...samples].sort((a, b) => a.lum - b.lum);
    const deep = mean(byLum.slice(0, Math.max(1, Math.floor(byLum.length * 0.2))));
    // The key light keeps its colour: the brightest pixels, the chromatic ones counted more.
    const light = mean(
        byLum.slice(Math.floor(byLum.length * 0.94)),
        (sample) => 0.25 + sample.chroma,
    );
    // The strongest hues, by area: each pixel counts by how chromatic it is and by how far it is
    // from black and white, so a grey funnel's faint blue cast does not outvote a golden field,
    // and a few vivid kites do not outvote the green hills they fly over (they come second).
    const bins = Array.from({ length: HUE_BINS }, () => ({ weight: 0, list: [] }));
    for (const sample of samples) {
        if (sample.chroma < 0.08) continue;
        const bin = Math.floor(hueOf(sample.r, sample.g, sample.b) / (360 / HUE_BINS)) % HUE_BINS;
        const mid = 1 - Math.abs(sample.lum * 2 - 1);
        const w = sample.chroma * (0.35 + mid);
        bins[bin].weight += w;
        bins[bin].list.push({ ...sample, w });
    }
    const smoothed = bins.map((bin, index) => bin.weight
        + 0.5 * (bins[(index + 1) % HUE_BINS].weight + bins[(index + HUE_BINS - 1) % HUE_BINS].weight));
    const top = smoothed.indexOf(Math.max(...smoothed));
    const around = (index) => [-1, 0, 1].flatMap((step) => bins[(index + step + HUE_BINS) % HUE_BINS].list);
    const weighted = (sample) => sample.w;
    const body = smoothed[top] > 0 ? mean(around(top), weighted) : mean(samples);
    let secondIndex = -1;
    for (let index = 0; index < HUE_BINS; index += 1) {
        const distance = Math.min((index - top + HUE_BINS) % HUE_BINS, (top - index + HUE_BINS) % HUE_BINS);
        if (distance < 3) continue;
        if (secondIndex < 0 || smoothed[index] > smoothed[secondIndex]) secondIndex = index;
    }
    // One hue only: its own lighter, slightly turned shade stands in for a second.
    const second = secondIndex >= 0 && smoothed[secondIndex] > smoothed[top] * 0.1
        ? mean(around(secondIndex), weighted)
        : body.map((value, channel) => value + (light[channel] - value) * 0.45);
    const key = samples.reduce((sum, sample) => sum + sample.lum, 0) / samples.length;
    return {
        light: hex(light), body: hex(body), second: hex(second), deep: hex(deep), key: Math.round(key * 100) / 100,
    };
}

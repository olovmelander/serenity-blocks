/**
 * ACT I VALUE-SHARE GATE — measure the dark fraction of a captured frame.
 *
 * The Act I plan (§3.1) turns "Earth Core must read as a DARK cavern with one warm key" into
 * a checkable number instead of a taste argument: at the cathedral station, **≥50 % of pixels
 * below luma 60**; at the shallows, ≤10 %. This script is that check.
 *
 * Why it decodes the PNG itself rather than reading the canvas: a WebGPU canvas does not
 * survive `drawImage` into a 2D context (it reads back as solid black — verified 2026-08-12,
 * and a gate that silently reports "100 % dark" is worse than no gate). The screenshot on
 * disk is the only honest source, so this decodes it with zlib and nothing else.
 *
 * Usage:
 *   node scripts/act1-value-gate.mjs <file.png> [--crop-top 260] [--threshold 60]
 *
 * `--crop-top` drops the playground's own UI panel, which is bright chrome that is not part
 * of the rendered frame and would otherwise flatter or spoil the measurement depending on
 * where it sits.
 */
import { readFileSync } from 'fs';
import { inflateSync } from 'zlib';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const readOpt = (name, dflt) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? Number(args[i + 1]) : dflt;
};
const cropTop = readOpt('crop-top', 0);
const threshold = readOpt('threshold', 60);

if (!file) {
    process.stderr.write('usage: node scripts/act1-value-gate.mjs <file.png> [--crop-top N] [--threshold N]\n');
    process.exit(2);
}

const buf = readFileSync(file);
if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');

// ── walk the chunks ──────────────────────────────────────────────────────────────
let pos = 8;
let width = 0;
let height = 0;
let bitDepth = 0;
let colorType = 0;
const idat = [];
while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        bitDepth = data[8];
        colorType = data[9];
    } else if (type === 'IDAT') {
        idat.push(data);
    } else if (type === 'IEND') break;
    pos += 12 + len;
}
if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
const channels = {
    0: 1, 2: 3, 4: 2, 6: 4,
}[colorType];
if (!channels) throw new Error(`unsupported colour type ${colorType}`);

// ── un-filter the scanlines (PNG filter types 0..4) ──────────────────────────────
const raw = inflateSync(Buffer.concat(idat));
const stride = width * channels;
const out = Buffer.alloc(height * stride);
let rp = 0;
for (let y = 0; y < height; y += 1) {
    const filter = raw[rp];
    rp += 1;
    const line = raw.subarray(rp, rp + stride);
    rp += stride;
    const o = y * stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
        const a = x >= channels ? out[o + x - channels] : 0;
        const b = prev ? prev[x] : 0;
        const c = prev && x >= channels ? prev[x - channels] : 0;
        let v = line[x];
        if (filter === 1) v += a;
        else if (filter === 2) v += b;
        else if (filter === 3) v += (a + b) >> 1;
        else if (filter === 4) {
            const p = a + b - c;
            const pa = Math.abs(p - a);
            const pb = Math.abs(p - b);
            const pc = Math.abs(p - c);
            let paeth = c;
            if (pa <= pb && pa <= pc) paeth = a;
            else if (pb <= pc) paeth = b;
            v += paeth;
        }
        out[o + x] = v & 0xff;
    }
}

// ── measure ──────────────────────────────────────────────────────────────────────
let dark = 0;
let sum = 0;
let count = 0;
const histogram = new Array(8).fill(0);
for (let y = cropTop; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
        const i = y * stride + x * channels;
        const luma = (0.2126 * out[i]) + (0.7152 * out[i + 1]) + (0.0722 * out[i + 2]);
        if (luma < threshold) dark += 1;
        sum += luma;
        count += 1;
        histogram[Math.min(7, Math.floor(luma / 32))] += 1;
    }
}

const result = {
    file,
    size: `${width}x${height}`,
    measuredRows: `${cropTop}..${height}`,
    threshold,
    darkShare: +(dark / count).toFixed(4),
    meanLuma: +(sum / count).toFixed(1),
    histogram: histogram.map((h) => +(h / count).toFixed(3)),
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

/**
 * THE SEAM VALUE LADDER — void < dome < masses, measured in grayscale (Act II -> Space
 * plan, Wave 4). The limb hand-off only reads if the frame keeps a value ladder: the void
 * is the darkest thing on screen, the dome's nebula wash sits above it, and the cloud
 * masses being flown past are the brightest field. A grade or staging change can invert
 * a rung silently (the void-dome once ARRIVED brighter than the limb it was behind), so
 * the ladder is asserted from real capture frames, not from authored constants.
 *
 * Method: per station, luma PERCENTILES (Rec.709) over the whole frame. The three
 * element classes own three value populations wherever they sit on screen — the void is
 * the frame's dark floor (p20), the dome's nebula wash is the mid body (p70), and the
 * sculpted masses supply the bright tail (p99). A first draft measured screen THIRDS on
 * the assumption the composition was vertical (void above, masses below); the real
 * p=0.7763 frame has the dome wash at the TOP and the receding limb at the BOTTOM, so
 * regions measure geometry, not the ladder. Percentiles measure the ladder wherever the
 * camera happens to point.
 *
 * Self-contained PNG decode (8-bit RGB/RGBA, filters 0-4) via node:zlib — the repo
 * deliberately carries no image dependency, and the capture harness's own pixels are
 * gone by the time anything on disk can be measured.
 *
 * Usage:
 *   node scripts/odyssey-seam-value-bands.mjs --dir artifacts/odyssey/wave-v/seam-5-6-high-webgpu \
 *     --boundary 0.7543
 * Stations checked: boundary + 0.022 / 0.030 / 0.038 (the limb hand-off window, past the
 * gate band, before deep space re-composes the frame). Exit 1 on a broken rung.
 */
/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const args = {};
for (let i = 2; i < process.argv.length; i += 1) {
    const t = process.argv[i];
    if (t.startsWith('--')) {
        const next = process.argv[i + 1];
        if (next && !next.startsWith('--')) { args[t.slice(2)] = next; i += 1; } else args[t.slice(2)] = true;
    }
}
const DIR = args.dir;
const BOUNDARY = Number.parseFloat(args.boundary);
if (!DIR || !Number.isFinite(BOUNDARY)) {
    console.error('Pass --dir <capture dir> and --boundary <p> (the boundary is NOT auto-derived).');
    process.exit(2);
}

function decodePng(file) {
    const buf = fs.readFileSync(file);
    if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file}: not a PNG`);
    let pos = 8;
    let width = 0; let height = 0; let bitDepth = 0; let colorType = 0;
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
            if (data[12] !== 0) throw new Error(`${file}: interlaced PNG not supported`);
        } else if (type === 'IDAT') idat.push(data);
        else if (type === 'IEND') break;
        pos += 12 + len;
    }
    if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`${file}: only 8-bit RGB/RGBA supported (got depth ${bitDepth} type ${colorType})`);
    }
    const bpp = colorType === 6 ? 4 : 3;
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = width * bpp;
    const out = Buffer.alloc(height * stride);
    // PNG row filters (spec §9): each row is prefixed by a filter byte; Paeth is the only
    // non-trivial one and it must use the RECONSTRUCTED neighbours, not the filtered ones.
    for (let y = 0; y < height; y += 1) {
        const filter = raw[y * (stride + 1)];
        const rowIn = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        const rowOut = out.subarray(y * stride, (y + 1) * stride);
        const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
        for (let x = 0; x < stride; x += 1) {
            const a = x >= bpp ? rowOut[x - bpp] : 0;
            const b = prev ? prev[x] : 0;
            const c = (prev && x >= bpp) ? prev[x - bpp] : 0;
            let v = rowIn[x];
            if (filter === 1) v += a;
            else if (filter === 2) v += b;
            else if (filter === 3) v += (a + b) >> 1;
            else if (filter === 4) {
                const p = a + b - c;
                const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
                v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
            }
            rowOut[x] = v & 0xff;
        }
    }
    return {
        width, height, bpp, data: out,
    };
}

function lumaPercentiles(img, wanted) {
    const { width, height, bpp, data } = img;
    const lumas = [];
    // Every 2nd pixel in x and y is plenty of sample for percentiles and 4x faster.
    for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x += 2) {
            const o = (y * width + x) * bpp;
            lumas.push(0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]);
        }
    }
    lumas.sort((p, q) => p - q);
    return wanted.map((f) => lumas[Math.min(lumas.length - 1, Math.floor(f * (lumas.length - 1)))]);
}

const stationTag = (p) => `seam-5-6-0p${String(Math.round(p * 10000)).padStart(4, '0')}.png`;
const OFFSETS = [0.022, 0.030, 0.038];
let fail = false;
console.log(`[value-bands] ${DIR}  boundary ${BOUNDARY}`);
for (const off of OFFSETS) {
    const p = BOUNDARY + off;
    const file = path.join(DIR, stationTag(p));
    if (!fs.existsSync(file)) {
        console.log(`  p=${p.toFixed(4)}  MISSING ${path.basename(file)} — station not in this capture`);
        fail = true;
        continue;
    }
    const [voidFloor, domeWash, massBright] = lumaPercentiles(decodePng(file), [0.20, 0.70, 0.99]);
    // The ladder, with real separations: the void floor must be genuinely dark (< 10 —
    // space is black, not grey), the dome wash must sit clearly off the floor (> +2), and
    // the masses' bright tail must stand clearly above the wash (> +20) or the limb has
    // nothing to read against. Equal rungs mean the ladder collapsed even if nothing is
    // technically inverted.
    const ok = voidFloor < 10 && domeWash > voidFloor + 2 && massBright > domeWash + 20;
    if (!ok) fail = true;
    console.log(`  p=${p.toFixed(4)}  void(p20) ${voidFloor.toFixed(1)} < dome(p70) ${domeWash.toFixed(1)} < masses(p99) ${massBright.toFixed(1)}  ${ok ? 'PASS' : 'FAIL'}`);
}
console.log(fail ? '[value-bands] FAIL' : '[value-bands] PASS');
process.exit(fail ? 1 : 0);

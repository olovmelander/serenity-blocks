/**
 * Bauer metrics — measure a capture against John Bauer's measured statistics.
 *
 * The Stillwater art direction is defined numerically (see
 * docs/STILLWATER_BAUER_MASTERPIECE_PLAN_2026-07.md §2): Bauer's forest pictures
 * are dark-key, low-chroma, and structurally bimodal — large flat regions with
 * hard boundaries and almost no mid-frequency gradient. A clean real-time render
 * is the inverse. This script makes that difference measurable instead of a
 * matter of taste, so every change can re-prove the target rather than relying
 * on anyone's eye.
 *
 * Usage:
 *   node scripts/bauer-metrics.mjs <capture.png> [more.png ...] [--json] [--quiet]
 *   node scripts/bauer-metrics.mjs <capture.png> --targets scripts/bauer-targets.json
 *
 * Exit code is 1 if any capture fails its targets, so it can gate CI.
 */
import { readFileSync, existsSync } from 'fs';
import { inflateSync } from 'zlib';
import path from 'path';

const DEFAULT_TARGETS = path.join('scripts', 'bauer-targets.json');

// ---------------------------------------------------------------- PNG decode

/**
 * Minimal PNG reader: 8-bit non-interlaced truecolour, with or without alpha.
 * Deliberately dependency-free — this runs in CI and on a clean checkout.
 */
function decodePng(file) {
    const buffer = readFileSync(file);
    if (buffer.readUInt32BE(0) !== 0x89504e47) {
        throw new Error(`${file}: not a PNG`);
    }
    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    let interlace = 0;
    const idat = [];
    while (offset < buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString('ascii', offset + 4, offset + 8);
        const body = buffer.subarray(offset + 8, offset + 8 + length);
        if (type === 'IHDR') {
            width = body.readUInt32BE(0);
            height = body.readUInt32BE(4);
            bitDepth = body[8];
            colorType = body[9];
            interlace = body[12];
        } else if (type === 'IDAT') {
            idat.push(body);
        } else if (type === 'IEND') {
            break;
        }
        offset += 12 + length;
    }
    if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(
            `${file}: unsupported PNG (bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}); `
            + 'expected 8-bit non-interlaced RGB or RGBA',
        );
    }
    const channels = colorType === 6 ? 4 : 3;
    const raw = inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    const out = Buffer.alloc(height * stride);
    let cursor = 0;
    for (let y = 0; y < height; y += 1) {
        const filter = raw[cursor];
        cursor += 1;
        const line = raw.subarray(cursor, cursor + stride);
        cursor += stride;
        const row = out.subarray(y * stride, (y + 1) * stride);
        const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
        for (let i = 0; i < stride; i += 1) {
            const a = i >= channels ? row[i - channels] : 0;
            const b = prev ? prev[i] : 0;
            const c = prev && i >= channels ? prev[i - channels] : 0;
            let value = line[i];
            if (filter === 1) value += a;
            else if (filter === 2) value += b;
            else if (filter === 3) value += (a + b) >> 1;
            else if (filter === 4) {
                const pa = Math.abs(b - c);
                const pb = Math.abs(a - c);
                const pc = Math.abs(a + b - 2 * c);
                let predictor = c;
                if (pa <= pb && pa <= pc) predictor = a;
                else if (pb <= pc) predictor = b;
                value += predictor;
            }
            row[i] = value & 0xff;
        }
    }
    return {
        width, height, channels, data: out,
    };
}

// ------------------------------------------------------------------ measures

/** Rec.709 luma on 0..100, matching the scale the Bauer scans were measured on. */
function lumaField({
    width, height, channels, data,
}) {
    const luma = new Float32Array(width * height);
    for (let i = 0, p = 0; i < luma.length; i += 1, p += channels) {
        luma[i] = (0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]) * (100 / 255);
    }
    return luma;
}

/**
 * HSV saturation, measured only over pixels bright enough for chroma to mean
 * anything. Near black the metric is ill-conditioned — a pixel of (0, 3, 1)
 * scores a full 1.0 — so in a dark night frame the shadow floor dominates the
 * distribution and the number stops describing the picture anyone sees.
 * Everything at or below `lumaFloor` is excluded rather than clamped, so the
 * result is "chroma of the visible image".
 */
function saturationField({
    width, height, channels, data,
}, luma, lumaFloor) {
    const sat = [];
    for (let i = 0, p = 0; i < width * height; i += 1, p += channels) {
        if (luma[i] < lumaFloor) continue;
        const r = data[p];
        const g = data[p + 1];
        const b = data[p + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        sat.push(max === 0 ? 0 : (max - min) / max);
    }
    return Float32Array.from(sat);
}

function percentile(sorted, q) {
    if (!sorted.length) return 0;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
    return sorted[index];
}

function percentiles(field, qs) {
    const sorted = Float32Array.from(field).sort();
    return qs.map((q) => percentile(sorted, q));
}

/**
 * Local gradient magnitude via forward differences. Bauer's signature is that
 * most of the frame sits below a small threshold — flat wash — while the tail
 * saturates at hard boundaries.
 */
function gradientField(luma, width, height) {
    const grad = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const i = y * width + x;
            const gx = x + 1 < width ? luma[i + 1] - luma[i] : 0;
            const gy = y + 1 < height ? luma[i + width] - luma[i] : 0;
            grad[i] = Math.hypot(gx, gy);
        }
    }
    return grad;
}

/** Largest 4-connected region of flat pixels, as a fraction of the frame. */
function largestFlatRegion(grad, width, height, threshold) {
    const flat = new Uint8Array(width * height);
    for (let i = 0; i < flat.length; i += 1) flat[i] = grad[i] < threshold ? 1 : 0;
    const seen = new Uint8Array(width * height);
    const queue = new Int32Array(width * height + 1); // see brightRegion: +1 for the 1-based writes
    let best = 0;
    for (let start = 0; start < flat.length; start += 1) {
        if (!flat[start] || seen[start]) continue;
        let head = 0;
        let tail = 0;
        queue[tail += 1] = start;
        seen[start] = 1;
        let size = 0;
        while (head < tail) {
            const i = queue[head += 1];
            size += 1;
            const x = i % width;
            const y = (i / width) | 0;
            if (x > 0 && flat[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; queue[tail += 1] = i - 1; }
            if (x + 1 < width && flat[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; queue[tail += 1] = i + 1; }
            if (y > 0 && flat[i - width] && !seen[i - width]) { seen[i - width] = 1; queue[tail += 1] = i - width; }
            if (y + 1 < height && flat[i + width] && !seen[i + width]) {
                seen[i + width] = 1; queue[tail += 1] = i + width;
            }
        }
        if (size > best) best = size;
    }
    return best / (width * height);
}

/**
 * Where the bright pixels are.
 *
 * `spreadFraction` — the bounding-box area over ALL bright pixels — was the
 * original gate, and it conflates two things a painter would never confuse:
 * a frame with highlights sprinkled everywhere, and a frame with two deliberate
 * light notes that happen to be far apart. Worse, it is a trap to tune against:
 * for a two-note composition the score peaks when the notes carry equal weight,
 * so making the intended subject brighter can push it UP, and the only way down
 * is to abandon the second note. It is kept as a diagnostic.
 *
 * The gate is now the question actually worth asking: how many distinct notes
 * are there, is each one compact, and how much light is loose in the frame?
 */
function brightRegion(luma, width, height, threshold) {
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    const mask = new Uint8Array(width * height);
    for (let i = 0; i < luma.length; i += 1) {
        if (luma[i] <= threshold) continue;
        mask[i] = 1;
        const x = i % width;
        const y = (i / width) | 0;
        count += 1;
        sumX += x;
        sumY += y;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }
    if (!count) {
        return {
            fraction: 0,
            centroid: null,
            bbox: null,
            spreadFraction: 0,
            poleCount: 0,
            poleSpread: 0,
            strayFraction: 0,
        };
    }
    const bbox = {
        x0: minX / width, y0: minY / height, x1: maxX / width, y1: maxY / height,
    };

    // 8-connected clustering. Diagonal connectivity matters: a bloom halo is
    // dithered at its edge and 4-connectivity shatters a single glow into dozens
    // of fragments, which would read as "scattered" when it is one note.
    const seen = new Uint8Array(width * height);
    // count + 1, not count: the writes below are `queue[tail += 1]`, so slot 0 is
    // never used and a fill of N pixels needs indices 1..N. Sized at `count` the
    // final write lands out of bounds and a typed array DISCARDS it silently —
    // and that happens precisely when one cluster holds every bright pixel, which
    // is the single-focal-note composition this metric exists to reward.
    const queue = new Int32Array(count + 1);
    const clusters = [];
    for (let start = 0; start < mask.length; start += 1) {
        if (!mask[start] || seen[start]) continue;
        let head = 0;
        let tail = 0;
        queue[tail += 1] = start;
        seen[start] = 1;
        let size = 0;
        let cx0 = width;
        let cy0 = height;
        let cx1 = -1;
        let cy1 = -1;
        while (head < tail) {
            const i = queue[head += 1];
            size += 1;
            const x = i % width;
            const y = (i / width) | 0;
            if (x < cx0) cx0 = x;
            if (y < cy0) cy0 = y;
            if (x > cx1) cx1 = x;
            if (y > cy1) cy1 = y;
            for (let dy = -1; dy <= 1; dy += 1) {
                const ny = y + dy;
                if (ny < 0 || ny >= height) continue;
                for (let dx = -1; dx <= 1; dx += 1) {
                    const nx = x + dx;
                    if (nx < 0 || nx >= width) continue;
                    const n = ny * width + nx;
                    if (!mask[n] || seen[n]) continue;
                    seen[n] = 1;
                    queue[tail += 1] = n;
                }
            }
        }
        clusters.push({
            size,
            spread: ((cx1 - cx0 + 1) / width) * ((cy1 - cy0 + 1) / height),
        });
    }
    clusters.sort((a, b) => b.size - a.size);
    // A "pole" is a note the eye actually reads: at least 8% of the frame's
    // bright pixels. Everything under that is a stray spark.
    const poles = clusters.filter((cluster) => cluster.size >= count * 0.08);
    const poleMass = poles.reduce((sum, cluster) => sum + cluster.size, 0);
    return {
        fraction: count / (width * height),
        centroid: { x: (sumX / count) / width, y: (sumY / count) / height },
        bbox,
        spreadFraction: (bbox.x1 - bbox.x0) * (bbox.y1 - bbox.y0),
        poleCount: poles.length,
        // Size-weighted mean footprint of the notes themselves. Bauer's light
        // notes are small and hard-edged; a soft wash over a quarter of the
        // frame is a different painting.
        poleSpread: poleMass
            ? poles.reduce((sum, c) => sum + c.spread * c.size, 0) / poleMass
            : 0,
        // Light loose in the frame — the thing the old gate was reaching for.
        strayFraction: (count - poleMass) / count,
    };
}

export function measureCapture(file, options = {}) {
    const flatThreshold = options.flatThreshold ?? 4;
    const brightThreshold = options.brightThreshold ?? 80;
    // Below this luma, HSV saturation is numerical noise, not colour.
    const saturationLumaFloor = options.saturationLumaFloor ?? 6;
    const image = decodePng(file);
    const luma = lumaField(image);
    const sat = saturationField(image, luma, saturationLumaFloor);
    const grad = gradientField(luma, image.width, image.height);

    const [p5, p25, p50, p75, p95] = percentiles(luma, [0.05, 0.25, 0.5, 0.75, 0.95]);
    const [satP50, satP99] = percentiles(sat, [0.5, 0.99]);

    let flatCount = 0;
    for (let i = 0; i < grad.length; i += 1) if (grad[i] < flatThreshold) flatCount += 1;

    return {
        file,
        width: image.width,
        height: image.height,
        luma: {
            p5,
            p25,
            p50,
            p75,
            p95,
            // Top-end compression. This is the medium-independent half of
            // Bauer's value signature: his highlights sit close to his
            // midtones, so nothing except the focal note escapes upward.
            topSpread: p95 - p75,
        },
        saturation: { p50: satP50, p99: satP99, sampled: sat.length / (image.width * image.height) },
        flatFraction: flatCount / grad.length,
        largestFlatFraction: largestFlatRegion(grad, image.width, image.height, flatThreshold),
        bright: brightRegion(luma, image.width, image.height, brightThreshold),
    };
}

// ------------------------------------------------------------------- targets

const FALLBACK_TARGETS = {
    'luma.p25': { min: 15 },
    'luma.p50': { min: 28, max: 34 },
    'luma.p75': { max: 50 },
    'luma.p95': { max: 62 },
    'saturation.p50': { min: 0.19, max: 0.32 },
    'saturation.p99': { max: 0.55 },
    flatFraction: { min: 0.45 },
    largestFlatFraction: { min: 0.18 },
    'bright.fraction': { max: 0.05 },
    'bright.poleCount': { max: 3 },
    'bright.poleSpread': { max: 0.02 },
    'bright.strayFraction': { max: 0.15 },
};

function readPath(object, dotted) {
    return dotted.split('.').reduce((node, key) => (node == null ? node : node[key]), object);
}

export function evaluate(metrics, targets) {
    return Object.entries(targets).map(([key, bound]) => {
        const value = readPath(metrics, key);
        const okMin = bound.min === undefined || value >= bound.min;
        const okMax = bound.max === undefined || value <= bound.max;
        return {
            key, value, bound, pass: okMin && okMax,
        };
    });
}

// ---------------------------------------------------------------------- main

function formatNumber(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
    return Math.abs(value) < 1 ? value.toFixed(4) : value.toFixed(2);
}

function main(argv) {
    const files = argv.filter((a) => !a.startsWith('--'));
    const asJson = argv.includes('--json');
    const targetsFlagIndex = argv.indexOf('--targets');
    const targetsFile = targetsFlagIndex >= 0 ? argv[targetsFlagIndex + 1] : DEFAULT_TARGETS;
    const targets = existsSync(targetsFile)
        ? JSON.parse(readFileSync(targetsFile, 'utf8')).targets
        : FALLBACK_TARGETS;

    if (!files.length) {
        process.stderr.write('usage: node scripts/bauer-metrics.mjs <capture.png> [...]\n');
        return 2;
    }

    const results = files
        .filter((file) => !file.endsWith(targetsFile))
        .map((file) => {
            const metrics = measureCapture(file);
            return { metrics, checks: evaluate(metrics, targets) };
        });

    if (asJson) {
        process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    } else {
        for (const { metrics, checks } of results) {
            const failed = checks.filter((c) => !c.pass);
            process.stdout.write(`\n${path.basename(metrics.file)}  ${metrics.width}x${metrics.height}\n`);
            process.stdout.write(
                `  luma  p5 ${formatNumber(metrics.luma.p5)}  p25 ${formatNumber(metrics.luma.p25)}`
                + `  p50 ${formatNumber(metrics.luma.p50)}  p75 ${formatNumber(metrics.luma.p75)}`
                + `  p95 ${formatNumber(metrics.luma.p95)}\n`,
            );
            process.stdout.write(
                `  sat   p50 ${formatNumber(metrics.saturation.p50)}  p99 ${formatNumber(metrics.saturation.p99)}\n`,
            );
            process.stdout.write(
                `  flat  frac ${formatNumber(metrics.flatFraction)}`
                + `  largest ${formatNumber(metrics.largestFlatFraction)}\n`,
            );
            const { bright } = metrics;
            const centroidText = bright.centroid
                ? `  centroid ${formatNumber(bright.centroid.x)},${formatNumber(bright.centroid.y)}`
                : '';
            process.stdout.write(
                `  L>80  frac ${formatNumber(bright.fraction)}`
                + `  poles ${bright.poleCount}`
                + `  poleSpread ${formatNumber(bright.poleSpread)}`
                + `  stray ${formatNumber(bright.strayFraction)}`
                + `  bboxSpread ${formatNumber(bright.spreadFraction)}`
                + `${centroidText}
`,
            );
            for (const check of checks) {
                const bounds = [
                    check.bound.min !== undefined ? `>= ${check.bound.min}` : null,
                    check.bound.max !== undefined ? `<= ${check.bound.max}` : null,
                ].filter(Boolean).join(' and ');
                process.stdout.write(
                    `  ${check.pass ? 'PASS' : 'FAIL'}  ${check.key.padEnd(26)}`
                    + `${formatNumber(check.value).padStart(9)}   want ${bounds}\n`,
                );
            }
            process.stdout.write(`  => ${failed.length ? `${failed.length} FAILED` : 'all in band'}\n`);
        }
    }

    return results.some(({ checks }) => checks.some((c) => !c.pass)) ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));

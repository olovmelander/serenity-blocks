/**
 * Pyrestorm — three-free CPU bakes (typed arrays, deterministic by seed).
 *
 * - The lava network: the authored rivers meandered and braided, the flank streams found by
 *   letting lava run downhill from the crater's rim, and the fissure's line; rasterised into two
 *   nested fields (near: the eye's side of the plain, fine; far: the whole country, coarse) as
 *   RGBA8 texels of (distance to the nearest channel's centreline, that channel's half-width,
 *   its heat, the glow its lava throws on the land around it) plus a second texture of the flow's
 *   heading. A distance field lets a 15 m texel draw a crisp 30 m channel at any range.
 * - Tileable value-noise fBm (RGBA: four bands) and a 3D-noise lattice (two fields per fetch).
 * - The billow atlas: sixteen cauliflower heaps of ash (alpha, normal, thickness) for the puffs.
 */
import {
    BRAIDS, CRATER, FISSURE, FLANK, RIVERS, SATELLITE, VOLCANO, clamp, clamp01, fbm, landHeight, lerp, mulberry32,
    smooth, volcanoHeight,
} from './pyrestorm-core.js';

// ── The lava network ──────────────────────────────────────────────────────────────

/** The two lava fields: origin, span (m), texels, and the encodings' ranges (m). */
export const LAVA_FIELDS = Object.freeze({
    near: Object.freeze({
        name: 'near', x0: -7000, z0: -13000, span: 18000, size: 1024, range: 220, widthRange: 160, glowSigma: 130,
    }),
    far: Object.freeze({
        name: 'far', x0: -20000, z0: -32000, span: 36000, size: 1024, range: 400, widthRange: 160, glowSigma: 700,
    }),
});

/** Catmull-Rom through points (x, z), sampled every `step` metres along the curve. */
function spline(points, step) {
    const out = [];
    const P = (i) => points[Math.max(0, Math.min(points.length - 1, i))];
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = P(i - 1);
        const p1 = P(i);
        const p2 = P(i + 1);
        const p3 = P(i + 2);
        const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
        const n = Math.max(2, Math.ceil(len / step));
        for (let k = 0; k < n; k++) {
            const t = k / n;
            const t2 = t * t;
            const t3 = t2 * t;
            const cr = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
            out.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])]);
        }
    }
    out.push(points[points.length - 1].slice());
    return out;
}

/** Arc length along a polyline (metres at each vertex). */
function arcLengths(pts) {
    const s = new Float64Array(pts.length);
    for (let i = 1; i < pts.length; i++) s[i] = s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return s;
}

/**
 * A channel: vertices (x, z), half-width, heat; the heading follows the vertices. `kind` is
 * 0 river, 1 braid, 2 flank stream, 3 fissure, 4 breakout.
 */
function makeChannel(pts, widthAt, heatAt, kind, id, arc0 = 0) {
    const s = arcLengths(pts);
    const total = s[s.length - 1] || 1;
    const hw = new Float32Array(pts.length);
    const heat = new Float32Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
        hw[i] = widthAt(s[i] / total, s[i]);
        heat[i] = heatAt(s[i] / total, s[i]);
    }
    return {
        id, kind, pts, s, total, hw, heat, arc0,
    };
}

/** Where each river's arc length starts (m from its vent: the main river leaves the breach). */
const RIVER_ARC0 = Object.freeze({
    main: 3600, fissure: 0, west: 7600, satellite: 0,
});

/** The rivers on the plain, meandered (seeded), plus their braids. */
export function buildRivers(seed = 0x1a7a) {
    const channels = [];
    const byId = {};
    RIVERS.forEach((river, r) => {
        const base = spline(river.points, 20);
        const s = arcLengths(base);
        const total = s[s.length - 1];
        // Meander: a slow sideways wander, quiet at the source (the vent fixes it).
        const pts = base.map((p, i) => {
            const a = base[Math.max(0, i - 1)];
            const b = base[Math.min(base.length - 1, i + 1)];
            const tx = b[0] - a[0];
            const tz = b[1] - a[1];
            const tl = Math.hypot(tx, tz) || 1;
            const nx = -tz / tl;
            const nz = tx / tl;
            const k = s[i] / total;
            const m = (fbm(s[i] / 1400, r * 7.3, 3, seed + r) * 0.75 + fbm(s[i] / 420, r * 3.1, 2, seed + 17 + r) * 0.25)
                * river.meander * smooth(0, 0.08, k);
            return [p[0] + nx * m, p[1] + nz * m];
        });
        const ch = makeChannel(
            pts,
            (k, sm) => lerp(river.width[0], river.width[1], smooth(0, 0.7, k)) * (0.85 + 0.3 * (fbm(sm / 600, r * 5.7, 2, seed + 40 + r) * 0.5 + 0.5)),
            (k, sm) => river.heat * Math.exp((-river.cool * sm) / 1000),
            0,
            river.id,
            RIVER_ARC0[river.id] ?? 0,
        );
        channels.push(ch);
        byId[river.id] = ch;
    });
    BRAIDS.forEach((braid, b) => {
        const parent = byId[braid.parent];
        if (!parent) return;
        const i0 = parent.pts.findIndex((_, i) => parent.s[i] / parent.total >= braid.from);
        let i1 = parent.pts.findIndex((_, i) => parent.s[i] / parent.total >= braid.to);
        if (i1 < 0) i1 = parent.pts.length - 1;
        if (i0 < 0 || i1 - i0 < 4) return;
        const pts = [];
        for (let i = i0; i <= i1; i++) {
            const a = parent.pts[Math.max(0, i - 1)];
            const c = parent.pts[Math.min(parent.pts.length - 1, i + 1)];
            const tx = c[0] - a[0];
            const tz = c[1] - a[1];
            const tl = Math.hypot(tx, tz) || 1;
            const t = (i - i0) / (i1 - i0);
            const bulge = Math.sin(Math.PI * t) ** 0.8;
            const wob = 1 + 0.35 * fbm(t * 4, b * 3.3, 2, seed + 90 + b);
            const off = braid.out * braid.side * bulge * wob;
            pts.push([parent.pts[i][0] - (tz / tl) * off, parent.pts[i][1] + (tx / tl) * off]);
        }
        channels.push(makeChannel(
            pts,
            (k) => braid.width * (0.55 + 0.45 * Math.sin(Math.PI * k) ** 0.5),
            (k) => {
                const at = Math.min(parent.pts.length - 1, Math.round(i0 + k * (i1 - i0)));
                return parent.heat[at] * 0.9;
            },
            1,
            `${braid.parent}-braid-${b}`,
            parent.arc0 + parent.s[i0],
        ));
    });
    return channels;
}

/**
 * Flank streams: lava let loose on the crater's rim at bearings around the breach runs downhill
 * (with a little inertia, so it holds a gully instead of dithering) until the cone gives out.
 */
export function buildFlankStreams(seed = 0xf1a2) {
    const random = mulberry32(seed);
    const out = [];
    const V = VOLCANO;
    const grad = (x, z) => {
        const e = 12;
        return [
            (landHeight(x + e, z) - landHeight(x - e, z)) / (2 * e),
            (landHeight(x, z + e) - landHeight(x, z - e)) / (2 * e),
        ];
    };
    for (let k = 0; k < FLANK.streams; k++) {
        // The breach stream first (it feeds the main river), then the rest fanned around it.
        const f = k === 0 ? 0 : ((k % 2 ? 1 : -1) * Math.ceil(k / 2)) / Math.ceil(FLANK.streams / 2);
        const bearing = V.breach + f * FLANK.spread + (k === 0 ? 0 : (random() - 0.5) * 0.12);
        const startR = k === 0 ? V.crater * 1.0 : V.crater * (1.05 + random() * 0.6);
        let x = V.x + Math.cos(bearing) * startR;
        let z = V.z + Math.sin(bearing) * startR;
        let vx = Math.cos(bearing);
        let vz = Math.sin(bearing);
        const pts = [[x, z]];
        const step = 22;
        const maxLen = k === 0 ? 3600 : 1800 + random() * 4200;
        let len = 0;
        for (let i = 0; i < 900 && len < maxLen; i++) {
            const g = grad(x, z);
            const gl = Math.hypot(g[0], g[1]) || 1;
            // Downhill, with inertia.
            vx = vx * 0.72 - (g[0] / gl) * 0.28;
            vz = vz * 0.72 - (g[1] / gl) * 0.28;
            const vl = Math.hypot(vx, vz) || 1;
            vx /= vl;
            vz /= vl;
            x += vx * step;
            z += vz * step;
            len += step;
            pts.push([x, z]);
            if (volcanoHeight(x, z) < 40) break;
        }
        if (pts.length < 6) continue;
        const width = k === 0 ? [FLANK.width[1] * 0.8, FLANK.width[1] * 1.5] : [FLANK.width[0], FLANK.width[0] + random() * (FLANK.width[1] - FLANK.width[0])];
        // Streams from the rim are short-lived: they cool as they go and a few are crusting over.
        const heat0 = k === 0 ? 1 : 0.82 + random() * 0.18;
        const cool = k === 0 ? 0.05 : 0.18 + random() * 0.22;
        out.push(makeChannel(pts, (t) => lerp(width[0], width[1], t), (t, sm) => heat0 * Math.exp((-cool * sm) / 1000), 2, `flank-${k}`));
    }
    // The satellite cone's crater overflows down its front.
    {
        const S = SATELLITE;
        const pts = [];
        const toward = Math.atan2(-S.z, -S.x);
        for (let i = 0; i <= 50; i++) {
            const t = i / 50;
            pts.push([S.x + Math.cos(toward + 0.25 * Math.sin(t * 5)) * t * S.radius * 0.95, S.z + Math.sin(toward + 0.25 * Math.sin(t * 5)) * t * S.radius * 0.95]);
        }
        out.push(makeChannel(pts, (t) => lerp(7, 15, t), (t) => 0.9 - 0.25 * t, 2, 'satellite-overflow'));
    }
    return out;
}

/** The fissure's own line of fire. */
export function buildFissure() {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        pts.push([lerp(FISSURE.a[0], FISSURE.b[0], t) + Math.sin(t * 9) * 30, lerp(FISSURE.a[1], FISSURE.b[1], t) + Math.cos(t * 7) * 24]);
    }
    return [makeChannel(pts, (t) => 9 + 7 * Math.sin(Math.PI * t), () => 1, 3, 'fissure-line')];
}

/** Every channel. */
/**
 * Breakouts: small toes of lava oozing out of the flow field beside the rivers (a lava field is
 * never only its channels). Short wiggly tongues off each river's banks, cooler than the river.
 */
export function buildBreakouts(rivers, seed = 0xb7ea) {
    const random = mulberry32(seed);
    const out = [];
    for (const river of rivers) {
        if (river.kind !== 0 || river.total < 3000) continue;
        const count = Math.round(river.total / 380);
        for (let n = 0; n < count; n++) {
            // Somewhere along the river past its first kilometre, off one bank.
            const at = 1000 + random() * (river.total - 1200);
            let i = 1;
            while (i < river.pts.length - 1 && river.s[i] < at) i++;
            const p = river.pts[i];
            const q = river.pts[i - 1];
            const tx = p[0] - q[0];
            const tz = p[1] - q[1];
            const tl = Math.hypot(tx, tz) || 1;
            const side = random() < 0.5 ? -1 : 1;
            const nx = (-tz / tl) * side;
            const nz = (tx / tl) * side;
            const off = river.hw[i] + 30 + random() ** 1.6 * 380;
            const len = 40 + random() * 110;
            const pts = [];
            const steps = 8;
            const wob = random() * 6.28;
            for (let k = 0; k <= steps; k++) {
                const u = k / steps;
                const d = off + u * len * 0.6;
                const lat = Math.sin(wob + u * 4) * len * 0.18 + (u - 0.5) * len * 0.7 * (random() < 0.5 ? 1 : -1) * 0.2;
                pts.push([p[0] + nx * d + (tx / tl) * lat, p[1] + nz * d + (tz / tl) * lat]);
            }
            const heat = (0.24 + random() * 0.3) * Math.min(1, river.heat[i] + 0.2);
            const w0 = 4 + random() * 8;
            out.push(makeChannel(pts, (u) => w0 * (0.5 + 0.5 * Math.sin(Math.PI * Math.min(1, u * 1.2))), () => heat, 4, `breakout-${out.length}`, river.arc0 + at));
            // Every third toe has an older, cooled lobe beside it: broad, dark, a few red cracks.
            if (n % 3 === 0) {
                const lobe = [];
                const lw = 50 + random() * 70;
                const ll = 220 + random() * 260;
                const lo = off + 120 + random() * 260;
                for (let k = 0; k <= 6; k++) {
                    const u2 = k / 6;
                    const lat = Math.sin(wob * 1.7 + u2 * 3) * ll * 0.15;
                    lobe.push([p[0] + nx * (lo + u2 * ll * 0.5) + (tx / tl) * (lat + (u2 - 0.5) * ll * 0.5),
                        p[1] + nz * (lo + u2 * ll * 0.5) + (tz / tl) * (lat + (u2 - 0.5) * ll * 0.5)]);
                }
                const cold = 0.1 + random() * 0.06;
                out.push(makeChannel(lobe, (u2) => lw * (0.55 + 0.45 * Math.sin(Math.PI * u2)), () => cold, 4, `lobe-${out.length}`, river.arc0 + at));
            }
        }
    }
    return out;
}

export function buildChannels() {
    const rivers = buildRivers();
    return [...buildFlankStreams(), ...rivers, ...buildBreakouts(rivers), ...buildFissure()];
}

/**
 * Rasterise the channels into one field: per texel the nearest channel by signed distance
 * (distance to centreline minus half-width), its centreline distance, half-width, heat and
 * heading; then the glow (each texel's lava coverage × heat^1.5, blurred).
 */
export function bakeLavaField(field, channels, extra = null) {
    const {
        x0, z0, span, size, range, widthRange, glowSigma,
    } = field;
    const cell = span / size;
    const n = size * size;
    const best = new Float32Array(n).fill(1e9);
    const dc = new Float32Array(n).fill(range);
    const hw = new Float32Array(n);
    const heat = new Float32Array(n);
    const dirX = new Float32Array(n);
    const dirZ = new Float32Array(n);
    const kind = new Uint8Array(n);
    const arc = new Float32Array(n);
    for (const ch of channels) {
        const { pts } = ch;
        for (let i = 0; i < pts.length - 1; i++) {
            const ax = pts[i][0];
            const az = pts[i][1];
            const bx = pts[i + 1][0];
            const bz = pts[i + 1][1];
            const vx = bx - ax;
            const vz = bz - az;
            const len2 = vx * vx + vz * vz;
            if (len2 < 1e-6) continue;
            const len = Math.sqrt(len2);
            const reach = range + Math.max(ch.hw[i], ch.hw[i + 1]);
            const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - x0) / cell));
            const i1 = Math.min(size - 1, Math.ceil((Math.max(ax, bx) + reach - x0) / cell));
            const j0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - z0) / cell));
            const j1 = Math.min(size - 1, Math.ceil((Math.max(az, bz) + reach - z0) / cell));
            if (i0 > i1 || j0 > j1) continue;
            const hx = vx / len;
            const hz = vz / len;
            for (let j = j0; j <= j1; j++) {
                const pz = z0 + (j + 0.5) * cell;
                for (let ii = i0; ii <= i1; ii++) {
                    const px = x0 + (ii + 0.5) * cell;
                    let t = ((px - ax) * vx + (pz - az) * vz) / len2;
                    t = Math.min(1, Math.max(0, t));
                    const d = Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
                    const w = ch.hw[i] + (ch.hw[i + 1] - ch.hw[i]) * t;
                    const sd = d - w;
                    const o = j * size + ii;
                    if (sd < best[o]) {
                        best[o] = sd;
                        dc[o] = d;
                        hw[o] = w;
                        heat[o] = ch.heat[i] + (ch.heat[i + 1] - ch.heat[i]) * t;
                        dirX[o] = hx;
                        dirZ[o] = hz;
                        kind[o] = ch.kind;
                        arc[o] = ch.arc0 + ch.s[i] + (ch.s[i + 1] - ch.s[i]) * t;
                    }
                }
            }
        }
    }
    // Glow: lava coverage of each texel times heat, then a separable box blur ×3 (≈ gaussian).
    const glow = new Float32Array(n);
    for (let o = 0; o < n; o++) {
        const cover = clamp01((hw[o] - dc[o]) / cell + 0.5) * clamp01(hw[o] / (cell * 0.5));
        glow[o] = cover * heat[o] ** 1.5;
    }
    if (extra) extra(glow, field);
    const radius = Math.max(1, Math.round((glowSigma / cell) * 0.9));
    const tmp = new Float32Array(n);
    for (let pass = 0; pass < 3; pass++) {
        boxBlur(glow, tmp, size, radius, true);
        boxBlur(tmp, glow, size, radius, false);
    }
    // Normalise so a broad river's surroundings sit near 0.5 and only the vents saturate.
    let peak = 0;
    for (let o = 0; o < n; o++) peak = Math.max(peak, glow[o]);
    const gain = peak > 0 ? 1 / Math.max(peak * 0.55, 1e-4) : 0;
    const a = new Uint8Array(n * 4);
    const b = new Uint8Array(n * 4);
    for (let o = 0; o < n; o++) {
        a[o * 4] = Math.round(clamp01(dc[o] / range) * 255);
        a[o * 4 + 1] = Math.round(clamp01(hw[o] / widthRange) * 255);
        a[o * 4 + 2] = Math.round(clamp01(heat[o]) * 255);
        a[o * 4 + 3] = Math.round(clamp01(Math.sqrt(glow[o] * gain)) * 255);
        b[o * 4] = Math.round((dirX[o] * 0.5 + 0.5) * 255);
        b[o * 4 + 1] = Math.round((dirZ[o] * 0.5 + 0.5) * 255);
        b[o * 4 + 2] = kind[o] * 60;
        b[o * 4 + 3] = Math.round(clamp01(arc[o] / 16000) * 255);
    }
    return {
        ...field, a, b,
    };
}

function boxBlur(src, dst, size, r, horizontal) {
    const norm = 1 / (2 * r + 1);
    for (let line = 0; line < size; line++) {
        let acc = 0;
        const at = (k) => {
            const kk = Math.min(size - 1, Math.max(0, k));
            return horizontal ? src[line * size + kk] : src[kk * size + line];
        };
        for (let k = -r; k <= r; k++) acc += at(k);
        for (let k = 0; k < size; k++) {
            const o = horizontal ? line * size + k : k * size + line;
            dst[o] = acc * norm;
            acc += at(k + r + 1) - at(k - r);
        }
    }
}

/** The far field also carries the crater's glow (the fountain lights the summit). */
function craterGlow(glow, field) {
    const cell = field.span / field.size;
    const ci = Math.floor((CRATER.x - field.x0) / cell);
    const cj = Math.floor((CRATER.z - field.z0) / cell);
    const R = Math.ceil(900 / cell);
    for (let j = -R; j <= R; j++) {
        for (let i = -R; i <= R; i++) {
            const ii = ci + i;
            const jj = cj + j;
            if (ii < 0 || jj < 0 || ii >= field.size || jj >= field.size) continue;
            const d = Math.hypot(i, j) * cell;
            glow[jj * field.size + ii] += 3.2 * Math.exp(-((d / 420) ** 2));
        }
    }
}

/**
 * Both fields, one per step: a sliced prepare can breathe between them (each is a long task of
 * its own on a first visit). Returns what bakeLavaFields() returns.
 */
export function* lavaFieldSteps(channels = buildChannels()) {
    const near = bakeLavaField(LAVA_FIELDS.near, channels);
    yield 'lava-near';
    const far = bakeLavaField(LAVA_FIELDS.far, channels, craterGlow);
    return { channels, near, far };
}

/** Both fields at once. */
export function bakeLavaFields(channels = buildChannels()) {
    const steps = lavaFieldSteps(channels);
    for (;;) {
        const next = steps.next();
        if (next.done) return next.value;
    }
}

// ── Noise ─────────────────────────────────────────────────────────────────────────

export const NOISE_SIZE = 256;

/**
 * Tileable value-noise fBm, four fields (RGBA) at lattice periods 8, 16, 32 and 64 across the
 * tile: broad, mid, fine, grain.
 */
export function bakeNoise(size = NOISE_SIZE, seed = 0xa5e) {
    const out = new Uint8Array(size * size * 4);
    const lattices = [8, 16, 32, 64].map((period, c) => {
        const random = mulberry32(seed + c * 977);
        const values = new Float32Array(period * period);
        for (let i = 0; i < values.length; i++) values[i] = random();
        return { period, values };
    });
    const fade = (t) => t * t * (3 - 2 * t);
    const valueAt = (lat, x, y) => {
        const { period, values } = lat;
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        const tx = fade(x - xi);
        const ty = fade(y - yi);
        const at = (a, b) => values[(((b % period) + period) % period) * period + (((a % period) + period) % period)];
        const a = at(xi, yi);
        const b = at(xi + 1, yi);
        const c = at(xi, yi + 1);
        const d = at(xi + 1, yi + 1);
        return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    };
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
            for (let c = 0; c < 4; c++) {
                let sum = 0;
                let amp = 0.5;
                let norm = 0;
                for (let o = 0; o < 4 && c + o < 4; o++) {
                    const lat = lattices[c + o];
                    sum += amp * valueAt(lat, (i / size) * lat.period, (j / size) * lat.period);
                    norm += amp;
                    amp *= 0.5;
                }
                if (c === 3) {
                    sum = valueAt(lattices[3], (i / size) * 64, (j / size) * 64);
                    norm = 1;
                }
                out[(j * size + i) * 4 + c] = Math.round((sum / norm) * 255);
            }
        }
    }
    return out;
}

export const LATTICE_SIZE = 256;
/** The z-slice shift of the lattice: G is R one slice up, A is B one slice up. */
export const LATTICE_SLICE = Object.freeze([37, 17]);

/**
 * A 256² RGBA8 lattice of white noise whose G channel is R shifted by one z-slice and whose A is B
 * shifted the same way, so ONE bilinear fetch gives two independent trilinear value-noise fields.
 */
export function bakeLattice(seed = 0x1a77, size = LATTICE_SIZE) {
    const rand = mulberry32(seed);
    const r = new Uint8Array(size * size);
    const b = new Uint8Array(size * size);
    for (let i = 0; i < r.length; i++) {
        r[i] = Math.floor(rand() * 256);
        b[i] = Math.floor(rand() * 256);
    }
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = y * size + x;
            const j = ((y + LATTICE_SLICE[1]) % size) * size + ((x + LATTICE_SLICE[0]) % size);
            data[i * 4] = r[i];
            data[i * 4 + 1] = r[j];
            data[i * 4 + 2] = b[i];
            data[i * 4 + 3] = b[j];
        }
    }
    return data;
}

// ── The billow atlas ──────────────────────────────────────────────────────────────

export const BILLOW = Object.freeze({ tile: 128, grid: 4 });

/**
 * Sixteen heaps of ash in a 4×4 atlas (512²): each a soft union of spheres eroded at the edge.
 * Texel = (alpha, normal x, normal y, thickness), normals in the tile's own frame (y up).
 */
export function bakeBillows(seed = 0xb1110) {
    const { tile, grid } = BILLOW;
    const size = tile * grid;
    const out = new Uint8Array(size * size * 4);
    const random = mulberry32(seed);
    const SOFT = 0.07;
    for (let v = 0; v < grid * grid; v++) {
        const balls = [];
        // A cauliflower: a dome, a ring of mid lobes, and a crowd of small knobs round its rim
        // (more on top than below), so the outline is a run of bumps, never one round edge.
        balls.push([0, -0.08, 0.44 + random() * 0.05]);
        const mid = 4 + Math.floor(random() * 3);
        for (let k = 0; k < mid; k++) {
            const a = (k / mid) * Math.PI * 2 + random() * 0.6;
            const d = 0.22 + random() * 0.12;
            balls.push([Math.cos(a) * d, Math.sin(a) * d * 0.8 - 0.02, 0.2 + random() * 0.08]);
        }
        const knobs = 14 + Math.floor(random() * 8);
        for (let k = 0; k < knobs; k++) {
            const a = (k / knobs) * Math.PI * 2 + (random() - 0.5) * 0.3;
            // Upper rim knobs sit further out and larger; the underside is smoother.
            const top = Math.max(0, Math.sin(a));
            const d = 0.4 + top * 0.1 + random() * 0.06;
            const r = 0.07 + top * 0.06 + random() * 0.05;
            balls.push([Math.cos(a) * d, Math.sin(a) * d * 0.85 - 0.04, r]);
        }
        const ox = (v % grid) * tile;
        const oy = Math.floor(v / grid) * tile;
        const heights = new Float32Array(tile * tile);
        for (let j = 0; j < tile; j++) {
            for (let i = 0; i < tile; i++) {
                const x = ((i + 0.5) / tile) * 2 - 1;
                const y = 1 - ((j + 0.5) / tile) * 2;
                let sum = 0;
                for (const [bx, by, br] of balls) {
                    const d2 = (x - bx) ** 2 + (y - by) ** 2;
                    const z = Math.sqrt(Math.max(0, br * br - d2));
                    if (z > 0) sum += Math.exp(Math.min(40, z / SOFT));
                }
                let h = sum > 0 ? Math.max(0, Math.log(sum) * SOFT) : 0;
                // Cauliflower: small lumps over the heap (never outside it), deeper at the rim.
                if (h > 0) {
                    const lump = fbm(x * 4 + v * 3.1, y * 4, 3, 401) * 0.07 + fbm(x * 11 + v, y * 11, 2, 409) * 0.022;
                    h = Math.max(0, h + lump * (0.5 + 0.5 * (1 - clamp01(h / 0.4))));
                }
                // A clear border: nothing reaches the tile's edge (no square ever shows).
                const border = Math.max(Math.abs(x), Math.abs(y));
                h *= 1 - smooth(0.86, 0.98, border);
                heights[j * tile + i] = h;
            }
        }
        for (let j = 0; j < tile; j++) {
            for (let i = 0; i < tile; i++) {
                const h = heights[j * tile + i];
                const at = (a, b) => heights[clamp(b, 0, tile - 1) * tile + clamp(a, 0, tile - 1)];
                const gx = (at(i + 1, j) - at(i - 1, j)) * tile * 0.3;
                const gy = (at(i, j - 1) - at(i, j + 1)) * tile * 0.3;
                const nl = Math.hypot(gx, gy, 1);
                const alpha = smooth(0.0, 0.13, h);
                const o = ((oy + j) * size + ox + i) * 4;
                out[o] = Math.round(alpha * 255);
                out[o + 1] = Math.round(((-gx / nl) * 0.5 + 0.5) * 255);
                out[o + 2] = Math.round(((-gy / nl) * 0.5 + 0.5) * 255);
                out[o + 3] = Math.round(clamp01(h / 0.55) * 255);
            }
        }
    }
    return out;
}

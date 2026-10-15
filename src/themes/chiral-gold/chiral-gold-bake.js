/**
 * Chiral Gold — the CPU bakes (three-free).
 *
 * The tileable noise and the studio the gold reflects are pure functions of their seed and size,
 * kept in the shared bake cache. A first visit bakes them in a module Worker
 * (chiral-gold-bake.worker.js, started by chiral-gold-bakes.js) while the renderer comes up; the
 * world's build then finds them there. The textures are made in chiral-gold-tsl.js.
 */
import { TAU, mulberry32 } from './chiral-gold-core.js';
import { bakeOnce } from '../shared/bake-cache.js';

export const NOISE_SIZE = 256;
export const NOISE_SEED = 7919;
export const STUDIO_SEED = 4242;

/** The bake cache's keys. */
export const noiseKey = (seed, size) => `chiral-gold:noise:${seed}:${size}`;
export const studioKey = (width, seed) => `chiral-gold:studio:${width}:${seed}`;

// ── Half floats (as three's DataUtils.toHalfFloat, without three) ─────────────────

const _f32 = new Float32Array(1);
const _u32 = new Uint32Array(_f32.buffer);
const _base = new Uint32Array(512);
const _shift = new Uint32Array(512);
for (let i = 0; i < 256; ++i) {
    const e = i - 127;
    if (e < -27) {
        _base[i] = 0x0000;
        _base[i | 0x100] = 0x8000;
        _shift[i] = 24;
        _shift[i | 0x100] = 24;
    } else if (e < -14) {
        _base[i] = 0x0400 >> (-e - 14);
        _base[i | 0x100] = (0x0400 >> (-e - 14)) | 0x8000;
        _shift[i] = -e - 1;
        _shift[i | 0x100] = -e - 1;
    } else if (e <= 15) {
        _base[i] = (e + 15) << 10;
        _base[i | 0x100] = ((e + 15) << 10) | 0x8000;
        _shift[i] = 13;
        _shift[i | 0x100] = 13;
    } else if (e < 128) {
        _base[i] = 0x7c00;
        _base[i | 0x100] = 0xfc00;
        _shift[i] = 24;
        _shift[i | 0x100] = 24;
    } else {
        _base[i] = 0x7c00;
        _base[i | 0x100] = 0xfc00;
        _shift[i] = 13;
        _shift[i | 0x100] = 13;
    }
}

/** A float as IEEE half bits, bit for bit what three's DataUtils.toHalfFloat returns. */
export function toHalfFloat(value) {
    _f32[0] = Math.max(-65504, Math.min(65504, value));
    const f = _u32[0];
    const e = (f >> 23) & 0x1ff;
    return _base[e] + ((f & 0x007fffff) >> _shift[e]);
}

// ── The noise ─────────────────────────────────────────────────────────────────────

/**
 * Four decorrelated channels of periodic gradient noise (four octaves), stretched to [0, 255]:
 * RGBA bytes, size × size, tileable.
 * @returns {Uint8Array}
 */
export function bakeNoise(seed = NOISE_SEED, size = NOISE_SIZE) {
    return bakeOnce(noiseKey(seed, size), () => computeNoise(seed, size));
}

function computeNoise(seed, size) {
    const n = size;
    const rand = mulberry32(seed);
    const data = new Uint8Array(n * n * 4);
    const field = new Float32Array(n * n);
    const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);
    for (let c = 0; c < 4; c++) {
        field.fill(0);
        let amp = 1;
        for (let o = 0; o < 4; o++) {
            const period = 4 << o;
            const gx = new Float32Array(period * period);
            const gy = new Float32Array(period * period);
            for (let i = 0; i < gx.length; i++) {
                const a = rand() * TAU;
                gx[i] = Math.cos(a);
                gy[i] = Math.sin(a);
            }
            const scale = period / n;
            for (let y = 0; y < n; y++) {
                const fy = y * scale;
                const y0 = Math.floor(fy);
                const ty = fy - y0;
                const y1 = (y0 + 1) % period;
                const sy = fade(ty);
                for (let x = 0; x < n; x++) {
                    const fx = x * scale;
                    const x0 = Math.floor(fx);
                    const tx = fx - x0;
                    const x1 = (x0 + 1) % period;
                    const sx = fade(tx);
                    const i00 = y0 * period + x0;
                    const i10 = y0 * period + x1;
                    const i01 = y1 * period + x0;
                    const i11 = y1 * period + x1;
                    const d00 = gx[i00] * tx + gy[i00] * ty;
                    const d10 = gx[i10] * (tx - 1) + gy[i10] * ty;
                    const d01 = gx[i01] * tx + gy[i01] * (ty - 1);
                    const d11 = gx[i11] * (tx - 1) + gy[i11] * (ty - 1);
                    const top = d00 + (d10 - d00) * sx;
                    const bottom = d01 + (d11 - d01) * sx;
                    field[y * n + x] += (top + (bottom - top) * sy) * amp;
                }
            }
            amp *= 0.5;
        }
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < field.length; i++) {
            if (field[i] < lo) lo = field[i];
            if (field[i] > hi) hi = field[i];
        }
        const inv = 255 / Math.max(1e-6, hi - lo);
        for (let i = 0; i < field.length; i++) data[i * 4 + c] = Math.round((field[i] - lo) * inv);
    }
    return data;
}

// ── The studio ────────────────────────────────────────────────────────────────────

/**
 * The lights the gold reflects. Polished metal shows nothing but its surroundings, so the hall is
 * lit the way a goldsmith's bench is photographed: large soft boxes for the broad faces, tall
 * strip lights for the long running highlights, rim lights behind, dark flags between them (the
 * contrast is what reads as metal), a warm bounce from the water, and a scatter of pin lights
 * that crawl over the ribbons as they turn.
 *
 * `az` is measured from +Z (toward the camera) round to +X, `el` up from the horizon, both in
 * degrees; `w`/`h` are half-extents in degrees; `rgb` is scene-linear radiance.
 */
export const STUDIO_LIGHTS = Object.freeze([
    {
        az: -38, el: 34, w: 28, h: 18, rgb: [5.4, 5.0, 4.4],
    }, // key
    {
        az: 52, el: 12, w: 15, h: 24, rgb: [1.3, 1.15, 0.95],
    }, // fill
    {
        az: -96, el: 18, w: 2.6, h: 50, rgb: [13, 12, 10.6],
    }, // strip, left
    {
        az: 102, el: 22, w: 2.2, h: 46, rgb: [11, 10.1, 8.8],
    }, // strip, right
    {
        az: 0, el: 88, w: 20, h: 20, rgb: [2.6, 2.35, 1.95],
    }, // overhead
    {
        az: -152, el: 26, w: 5, h: 18, rgb: [7, 6.6, 6.0],
    }, // rim, left
    {
        az: 148, el: 30, w: 5, h: 16, rgb: [6, 5.6, 5.0],
    }, // rim, right
    {
        az: 4, el: -16, w: 64, h: 3.5, rgb: [1.1, 0.55, 0.18],
    }, // the water's bounce
    {
        az: 178, el: 4, w: 40, h: 1.6, rgb: [1.4, 0.95, 0.5],
    }, // a line of light on the far horizon
]);

/**
 * The studio as equirectangular HDR radiance: RGBA half floats (A = 1), width × width / 2.
 * @param {number} [width=1024]  twice the height; the prefilter's cube faces are width / 4
 * @returns {Uint16Array}
 */
export function bakeStudio(width = 1024, seed = STUDIO_SEED) {
    return bakeOnce(studioKey(width, seed), () => computeStudio(width, seed));
}

function computeStudio(width, seed) {
    const W = width;
    const H = width >> 1;
    const rgb = new Float32Array(W * H * 3);
    const lights = STUDIO_LIGHTS.map((l) => {
        const az = (l.az * Math.PI) / 180;
        const el = (l.el * Math.PI) / 180;
        const fx = Math.sin(az) * Math.cos(el);
        const fy = Math.sin(el);
        const fz = Math.cos(az) * Math.cos(el);
        // Right = up × forward (or Z × forward when the light looks straight down).
        const steep = Math.abs(fy) > 0.98;
        const ux = 0;
        const uy = steep ? 0 : 1;
        const uz = steep ? 1 : 0;
        let rx = uy * fz - uz * fy;
        let ry = uz * fx - ux * fz;
        let rz = ux * fy - uy * fx;
        const rl = Math.hypot(rx, ry, rz) || 1;
        rx /= rl;
        ry /= rl;
        rz /= rl;
        return {
            f: [fx, fy, fz],
            r: [rx, ry, rz],
            u: [fy * rz - fz * ry, fz * rx - fx * rz, fx * ry - fy * rx],
            tw: Math.tan((l.w * Math.PI) / 180),
            th: Math.tan((l.h * Math.PI) / 180),
            rgb: l.rgb,
        };
    });
    const edge = (q) => {
        // A softbox: flat across its face, a short soft edge.
        const t = Math.min(1, Math.max(0, (Math.abs(q) - 0.72) / 0.28));
        return 1 - t * t * (3 - 2 * t);
    };
    for (let j = 0; j < H; j++) {
        const lat = ((j + 0.5) / H - 0.5) * Math.PI;
        const cl = Math.cos(lat);
        const dy = Math.sin(lat);
        // A dark room: a breath of warm air above the horizon, the water's amber below it.
        const baseUp = Math.max(0, dy);
        const baseDown = Math.max(0, -dy);
        const br = 0.011 + baseDown * 0.03 + (1 - baseUp) * 0.004;
        const bg = 0.009 + baseDown * 0.014 + (1 - baseUp) * 0.003;
        const bb = 0.008 + baseDown * 0.004 + (1 - baseUp) * 0.002;
        // The room behind the camera is not quite black: a face turned to the lens holds a little bronze.
        const room = Math.max(0, 1 - Math.abs(dy - 0.15) * 1.6);
        for (let i = 0; i < W; i++) {
            const lon = ((i + 0.5) / W - 0.5) * TAU;
            const dx = cl * Math.cos(lon);
            const dz = cl * Math.sin(lon);
            const front = Math.max(0, dz) * room;
            let r = br + front * 0.26;
            let g = bg + front * 0.2;
            let b = bb + front * 0.14;
            for (let k = 0; k < lights.length; k++) {
                const L = lights[k];
                const d = dx * L.f[0] + dy * L.f[1] + dz * L.f[2];
                if (d <= 0.05) continue;
                const tx = (dx * L.r[0] + dy * L.r[1] + dz * L.r[2]) / d;
                if (Math.abs(tx) >= L.tw) continue;
                const ty = (dx * L.u[0] + dy * L.u[1] + dz * L.u[2]) / d;
                if (Math.abs(ty) >= L.th) continue;
                const w = edge(tx / L.tw) * edge(ty / L.th);
                r += L.rgb[0] * w;
                g += L.rgb[1] * w;
                b += L.rgb[2] * w;
            }
            const o = (j * W + i) * 3;
            rgb[o] = r;
            rgb[o + 1] = g;
            rgb[o + 2] = b;
        }
    }
    // Pin lights: small hot discs over the upper hemisphere, rasterised into their own footprint.
    const rand = mulberry32(seed);
    const pins = 34;
    for (let p = 0; p < pins; p++) {
        const lon = (rand() - 0.5) * TAU;
        const lat = (0.06 + rand() * 0.78) * (Math.PI / 2);
        const radius = ((0.5 + rand() * 0.7) * Math.PI) / 180;
        const power = 26 + rand() * 70;
        const warm = 0.82 + rand() * 0.18;
        const cj = (lat / Math.PI + 0.5) * H;
        const ci = (lon / TAU + 0.5) * W;
        const rj = Math.ceil((radius / Math.PI) * H) + 1;
        const ri = Math.ceil(((radius / TAU) * W) / Math.max(0.2, Math.cos(lat))) + 1;
        const px = Math.cos(lat) * Math.cos(lon);
        const py = Math.sin(lat);
        const pz = Math.cos(lat) * Math.sin(lon);
        for (let j = Math.max(0, Math.floor(cj - rj)); j <= Math.min(H - 1, Math.ceil(cj + rj)); j++) {
            const la = ((j + 0.5) / H - 0.5) * Math.PI;
            for (let ii = Math.floor(ci - ri); ii <= Math.ceil(ci + ri); ii++) {
                const i = ((ii % W) + W) % W;
                const lo = ((i + 0.5) / W - 0.5) * TAU;
                const c = Math.cos(la) * Math.cos(lo) * px + Math.sin(la) * py + Math.cos(la) * Math.sin(lo) * pz;
                const ang = Math.acos(Math.min(1, c));
                if (ang >= radius) continue;
                const t = Math.min(1, Math.max(0, (ang / radius - 0.5) / 0.5));
                const w = (1 - t * t * (3 - 2 * t)) * power;
                const o = (j * W + i) * 3;
                rgb[o] += w;
                rgb[o + 1] += w * (0.9 + warm * 0.06);
                rgb[o + 2] += w * warm * 0.86;
            }
        }
    }
    const data = new Uint16Array(W * H * 4);
    const one = toHalfFloat(1);
    for (let i = 0, o = 0; i < W * H; i++, o += 4) {
        data[o] = toHalfFloat(Math.min(rgb[i * 3], 60000));
        data[o + 1] = toHalfFloat(Math.min(rgb[i * 3 + 1], 60000));
        data[o + 2] = toHalfFloat(Math.min(rgb[i * 3 + 2], 60000));
        data[o + 3] = one;
    }
    return data;
}

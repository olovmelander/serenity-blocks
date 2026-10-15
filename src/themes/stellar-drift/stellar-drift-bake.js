/**
 * Stellar Drift — what is baked on the CPU when the world is built (three-free: typed arrays
 * only, so the tests and the Node previews can read them).
 *
 *   bakeFbm          tileable gradient fBm, four decorrelated fields (the cloud and the nebula)
 *   bakeLattice      white noise laid out for one-fetch 3D value noise (the moons, the ice)
 *   bakeRingProfile  the rings' radial structure: how thick, how icy, how grooved, how dusty
 *   bakeBandMeta     the giant's bands by latitude: belt or zone, the jets' wind, the shear
 *   bakeBandColors   the bands' colours, one row per palette of the wheel
 */

import {
    PALETTES, RINGS, TAU, bell, clamp01, lerp, mulberry32, smooth, srgbByte,
} from './stellar-drift-core.js';
import { bakeOnce } from '../shared/bake-cache.js';

export const LATTICE_SIZE = 256;
/** The offset between two z-slices of the lattice (the classic 37, 17). */
export const LATTICE_SLICE = Object.freeze([37, 17]);

/**
 * White noise for 3D value noise in one fetch: G holds R shifted by one z-slice, A holds B
 * shifted the same way, so `mix(rb, ga, fz)` at `xy + SLICE · floor(z)` is the trilinear blend
 * of two independent fields. Must be sampled at level 0 with bilinear filtering.
 */
export function bakeLattice(seed = 7411, size = LATTICE_SIZE) {
    return bakeOnce(`stellar-drift:lattice:${seed}:${size}`, () => computeLattice(seed, size));
}

function computeLattice(seed, size) {
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

/**
 * Periodic fBm gradient noise, four decorrelated channels stretched to [0, 1].
 * @returns {Float32Array} size × size × 4
 */
export function bakeFbm(seed = 2718, size = 256, octaves = 5) {
    return bakeOnce(`stellar-drift:fbm:${seed}:${size}:${octaves}`, () => computeFbm(seed, size, octaves));
}

function computeFbm(seed, size, octaves) {
    const n = size;
    const rand = mulberry32(seed);
    const base = new Float32Array(n * n * 4);
    const field = new Float32Array(n * n);
    const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);
    for (let c = 0; c < 4; c++) {
        field.fill(0);
        let amp = 1;
        for (let o = 0; o < octaves; o++) {
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
            amp *= 0.52;
        }
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < field.length; i++) {
            if (field[i] < lo) lo = field[i];
            if (field[i] > hi) hi = field[i];
        }
        const inv = 1 / Math.max(1e-6, hi - lo);
        for (let i = 0; i < field.length; i++) base[i * 4 + c] = (field[i] - lo) * inv;
    }
    return base;
}

/** Smooth 1D value noise with a few octaves: the stuff of ringlets and thin cloud bands. */
function makeNoise1(seed) {
    const rand = mulberry32(seed);
    const table = new Float32Array(1024);
    for (let i = 0; i < table.length; i++) table[i] = rand();
    const value = (x) => {
        const i = Math.floor(x);
        const f = x - i;
        const s = f * f * (3 - 2 * f);
        const a = table[((i % 1024) + 1024) % 1024];
        const b = table[(((i + 1) % 1024) + 1024) % 1024];
        return a + (b - a) * s;
    };
    return (x, octaves = 3) => {
        let sum = 0;
        let amp = 0.5;
        let total = 0;
        let f = 1;
        for (let o = 0; o < octaves; o++) {
            sum += value(x * f + o * 17.31) * amp;
            total += amp;
            amp *= 0.5;
            f *= 2.03;
        }
        return sum / total;
    };
}

// ── The rings ───────────────────────────────────────────────────────────────────

/** The greatest optical depth the profile stores (its R channel holds sqrt(tau / TAU_MAX)). */
export const RING_TAU_MAX = 4;

/** 1 inside [a, b], falling to 0 over `soft` outside each edge. */
const box = (r, a, b, soft) => smooth(a - soft, a + soft, r) * (1 - smooth(b - soft, b + soft, r));

/** Thin resonances where the outer ring winds itself into a train of ever tighter waves. */
const WAVE_TRAINS = Object.freeze([2.062, 2.118, 2.166, 2.238]);
/** Opaque plateaus in the thin inner ring. */
const PLATEAUS = Object.freeze([1.262, 1.307, 1.351, 1.398, 1.436, 1.474, 1.502]);

/**
 * The rings at radius r: [tau (normal optical depth), ice (0 dust-dark .. 1 bright ice),
 * groove (fine brightness, 0..1), dust (the share that scatters light forward)].
 */
export function ringAt(r, noise) {
    const broad = noise(r * 46, 3);
    const lets = noise(r * 310 + 40, 3);
    const fine = noise(r * 1500 + 90, 2);
    let tau = 0;
    let ice = 0.5;
    let dust = 0.2;

    // The thin inner ring: a veil with opaque plateaus and two clean gaps.
    const c = box(r, RINGS.cInner, RINGS.bInner, 0.004);
    if (c > 0) {
        let t = 0.05 + 0.07 * broad + 0.05 * smooth(1.42, 1.52, r);
        for (let i = 0; i < PLATEAUS.length; i++) t += 0.3 * box(r, PLATEAUS[i] - 0.0045, PLATEAUS[i] + 0.0045, 0.0012);
        t *= 0.7 + 0.6 * lets;
        t *= 1 - box(r, 1.288, 1.2925, 0.0008);
        t *= 1 - box(r, 1.452, 1.4575, 0.0008);
        tau += t * c;
        ice = lerp(ice, 0.24 + 0.2 * lets, c);
        dust = lerp(dust, 0.5, c);
    }

    // The broad bright ring: thick, grooved like a record, thickest in its middle.
    const b = box(r, RINGS.bInner, RINGS.bOuter, 0.0018);
    if (b > 0) {
        const k = (r - RINGS.bInner) / (RINGS.bOuter - RINGS.bInner);
        const body = lerp(0.85, 2.7, smooth(0.0, 0.34, k)) * (1 - 0.3 * smooth(0.7, 1, k));
        let t = body * (0.5 + 1.0 * broad) * (0.62 + 0.76 * lets);
        t += 0.5 * smooth(0.62, 0.9, fine) * smooth(0.1, 0.4, k);
        tau += t * b;
        ice = lerp(ice, 0.72 + 0.26 * smooth(0, 1, k) - 0.14 * (1 - broad), b);
        dust = lerp(dust, 0.05, b);
    }

    // The division: almost empty, with a clean gap at its inner edge and a few faint bands.
    const d = box(r, RINGS.bOuter, RINGS.aInner, 0.0016);
    if (d > 0) {
        let t = 0.05 + 0.09 * smooth(0.35, 0.8, lets) + 0.06 * smooth(1.99, 2.02, r);
        t *= 1 - box(r, 1.9535, 1.961, 0.0007);
        t += 0.45 * box(r, 1.9566, 1.9578, 0.0004);
        tau += t * d;
        ice = lerp(ice, 0.3 + 0.12 * lets, d);
        dust = lerp(dust, 0.55, d);
    }

    // The outer ring: even, bright, with wave trains at its resonances and two gaps.
    const a = box(r, RINGS.aInner, RINGS.aOuter, 0.0016);
    if (a > 0) {
        const k = (r - RINGS.aInner) / (RINGS.aOuter - RINGS.aInner);
        let t = lerp(1.0, 0.52, smooth(0.0, 0.3, k)) * (0.84 + 0.32 * lets) * (0.9 + 0.2 * broad);
        for (let i = 0; i < WAVE_TRAINS.length; i++) {
            const x = r - WAVE_TRAINS[i];
            if (x > 0 && x < 0.03) t *= 1 + 0.42 * Math.sin(x * x * 52000) * Math.exp(-x / 0.011);
        }
        t *= 1 - 0.97 * box(r, 2.2112, 2.2166, 0.0006);
        t *= 1 - box(r, 2.2622, 2.2644, 0.0005);
        tau += t * a;
        ice = lerp(ice, 0.8 + 0.14 * k, a);
        dust = lerp(dust, 0.14, a);
    }

    // The strand outside: a thread of dust, and a fainter one beside it.
    const s1 = Math.exp(-(((r - RINGS.strand) / 0.0026) ** 2));
    const s2 = Math.exp(-(((r - RINGS.strand - 0.0088) / 0.0014) ** 2));
    const strand = s1 * 0.26 + s2 * 0.09;
    if (strand > 1e-4) {
        tau += strand;
        ice = lerp(ice, 0.86, clamp01(strand * 6));
        dust = lerp(dust, 1, clamp01(strand * 6));
    }

    // How bright the ice is here: the rings are banded in brightness at every scale.
    const groove = clamp01(0.5 + (broad - 0.5) * 1.0 + (lets - 0.5) * 0.8 + (fine - 0.5) * 0.4);
    return [Math.min(RING_TAU_MAX, Math.max(0, tau)), clamp01(ice), groove, clamp01(dust)];
}

/**
 * The rings' radial profile from RINGS.from to RINGS.to, with a mip chain averaged on the CPU
 * (optical depth is averaged as depth, not as its stored square root).
 * @returns {{ size: number, levels: Array<{ data: Uint8Array, width: number }>, tau: Float32Array }}
 */
export function bakeRingProfile(size = 2048, seed = 5381) {
    return bakeOnce(`stellar-drift:ring:${size}:${seed}`, () => computeRingProfile(size, seed));
}

function computeRingProfile(size, seed) {
    const noise = makeNoise1(seed);
    const values = new Float32Array(size * 4);
    const tau = new Float32Array(size);
    for (let i = 0; i < size; i++) {
        const r = RINGS.from + ((i + 0.5) / size) * (RINGS.to - RINGS.from);
        const v = ringAt(r, noise);
        tau[i] = v[0];
        for (let c = 0; c < 4; c++) values[i * 4 + c] = v[c];
    }
    const levels = [];
    let level = values;
    let width = size;
    for (;;) {
        const data = new Uint8Array(width * 4);
        for (let i = 0; i < width; i++) {
            data[i * 4] = Math.round(Math.sqrt(clamp01(level[i * 4] / RING_TAU_MAX)) * 255);
            data[i * 4 + 1] = Math.round(clamp01(level[i * 4 + 1]) * 255);
            data[i * 4 + 2] = Math.round(clamp01(level[i * 4 + 2]) * 255);
            data[i * 4 + 3] = Math.round(clamp01(level[i * 4 + 3]) * 255);
        }
        levels.push({ data, width });
        if (width === 1) break;
        const half = width >> 1;
        const next = new Float32Array(half * 4);
        for (let i = 0; i < half; i++) {
            for (let c = 0; c < 4; c++) next[i * 4 + c] = (level[i * 8 + c] + level[i * 8 + 4 + c]) * 0.5;
        }
        level = next;
        width = half;
    }
    return { size, levels, tau };
}

/** The rings' optical depth at radius r, read from a baked profile (the CPU twin of the lookup). */
export function ringTau(profile, r) {
    const x = ((r - RINGS.from) / (RINGS.to - RINGS.from)) * profile.size - 0.5;
    if (x < 0 || x > profile.size - 1) return 0;
    const i = Math.floor(x);
    const f = x - i;
    return profile.tau[i] + (profile.tau[Math.min(profile.size - 1, i + 1)] - profile.tau[i]) * f;
}

// ── The giant's bands ───────────────────────────────────────────────────────────

/** Belts as [south edge, north edge, strength], degrees of latitude. */
export const BELTS = Object.freeze([
    [7, 17.5, 1.0], [24.5, 31, 0.72], [36.5, 42, 0.66], [47.5, 52, 0.56], [57, 60.5, 0.5],
    [-19.5, -7, 0.94], [-33, -27, 0.74], [-44, -38.5, 0.62], [-53, -49, 0.55], [-61.5, -57.5, 0.5],
]);

/** The fastest wind is the equator's; the other jets are measured against it. */
const JET_EDGE = 0.46;

/**
 * The giant by latitude: [belt (0 bright zone .. 1 dark belt), wind (−1..1, the zonal jets),
 * shear (0..1: how torn the cloud is here), tone (0..1: which of a band's two colours)].
 */
export function bandAt(latDeg, noise) {
    let belt = 0;
    let wind = Math.exp(-((latDeg / 8.5) ** 2));
    let shear = 0;
    for (let i = 0; i < BELTS.length; i++) {
        const [a, b, strength] = BELTS[i];
        belt += box(latDeg, a, b, 1.1) * strength;
        // A belt is torn between two jets: the wind runs one way along one edge, back along the other.
        const side = latDeg >= 0 ? 1 : -1;
        const ga = Math.exp(-(((latDeg - a) / 1.7) ** 2));
        const gb = Math.exp(-(((latDeg - b) / 1.7) ** 2));
        wind += (gb - ga) * JET_EDGE * strength * side;
        shear += (ga + gb) * strength;
    }
    // Thin stripes ride on the broad bands, everywhere.
    const stripes = noise(latDeg * 0.83 + 200, 3);
    const hair = noise(latDeg * 3.3 + 31, 2);
    belt = clamp01(belt * (0.62 + 0.76 * stripes) + (stripes - 0.5) * 0.46 + (hair - 0.5) * 0.24);
    // The poles are a mottled dusk of their own.
    const polar = smooth(62, 78, Math.abs(latDeg));
    belt = lerp(belt, 0.58, polar);
    shear = clamp01(0.22 + 0.62 * shear + 0.28 * belt + 0.5 * polar);
    const tone = noise(latDeg * 0.19 + 77, 2);
    return [belt, Math.max(-1, Math.min(1, wind)), shear, clamp01(tone * 1.5 - 0.25)];
}

/**
 * The band table, `size` latitudes from the south pole to the north:
 * R belt, G wind · 0.5 + 0.5, B shear, A tone.
 */
export function bakeBandMeta(size = 512, seed = 9173) {
    return bakeOnce(`stellar-drift:bands:${size}:${seed}`, () => computeBandMeta(size, seed));
}

function computeBandMeta(size, seed) {
    const noise = makeNoise1(seed);
    const data = new Uint8Array(size * 4);
    const values = new Float32Array(size * 4);
    for (let i = 0; i < size; i++) {
        const lat = ((i + 0.5) / size) * 180 - 90;
        const v = bandAt(lat, noise);
        values.set(v, i * 4);
        data[i * 4] = Math.round(v[0] * 255);
        data[i * 4 + 1] = Math.round((v[1] * 0.5 + 0.5) * 255);
        data[i * 4 + 2] = Math.round(v[2] * 255);
        data[i * 4 + 3] = Math.round(v[3] * 255);
    }
    return { size, data, values };
}

/** A band's colour for one palette (scene-linear), from its belt and tone. */
export function bandColor(palette, latDeg, belt, tone, out = [0, 0, 0]) {
    const polar = smooth(58, 77, Math.abs(latDeg)) * 0.86;
    const equator = 0.3 * bell(latDeg / 9);
    // Four stops: the bright zone, its tan, the belt's rust, its dark. A band's own tone
    // slides it along them, so neighbouring bands differ in hue and not only in depth.
    const x = clamp01(belt * 0.86 + (tone - 0.5) * 0.42 + 0.06);
    const k = smooth(0.42, 0.74, x);
    for (let c = 0; c < 3; c++) {
        const zone = lerp(palette.zoneA[c], palette.zoneB[c], smooth(0.0, 0.42, x));
        const dark = lerp(palette.beltA[c], palette.beltB[c], smooth(0.7, 1.0, x));
        let v = lerp(zone, dark, k);
        v = lerp(v, palette.zoneA[c], equator * (1 - k));
        out[c] = lerp(v, palette.polar[c] * (0.8 + 0.4 * (1 - belt)), polar);
    }
    return out;
}

/**
 * The bands' colours: `size` latitudes wide, one row per palette of the wheel, sRGB bytes
 * (alpha = the belt value, linear). A second, narrow table holds the same rows blurred, for
 * the limb where a band is thinner than a pixel.
 */
export function bakeBandColors(meta, palettes = PALETTES, smallSize = 32) {
    const { size, values } = meta;
    const rows = palettes.length;
    const data = new Uint8Array(size * rows * 4);
    const linear = new Float32Array(size * rows * 4);
    const rgb = [0, 0, 0];
    for (let p = 0; p < rows; p++) {
        for (let i = 0; i < size; i++) {
            const lat = ((i + 0.5) / size) * 180 - 90;
            bandColor(palettes[p], lat, values[i * 4], values[i * 4 + 3], rgb);
            const o = (p * size + i) * 4;
            for (let c = 0; c < 3; c++) {
                linear[o + c] = rgb[c];
                data[o + c] = srgbByte(rgb[c]);
            }
            linear[o + 3] = values[i * 4];
            data[o + 3] = Math.round(values[i * 4] * 255);
        }
    }
    const small = new Uint8Array(smallSize * rows * 4);
    const span = size / smallSize;
    for (let p = 0; p < rows; p++) {
        for (let s = 0; s < smallSize; s++) {
            const acc = [0, 0, 0, 0];
            let weight = 0;
            // A wide tent, so neighbouring texels overlap and the blur has no steps.
            for (let i = Math.floor((s - 0.5) * span); i < (s + 1.5) * span; i++) {
                if (i < 0 || i >= size) continue;
                const w = 1 - Math.abs((i + 0.5) / span - (s + 0.5)) / 1.5;
                if (w <= 0) continue;
                const o = (p * size + i) * 4;
                for (let c = 0; c < 4; c++) acc[c] += linear[o + c] * w;
                weight += w;
            }
            const o = (p * smallSize + s) * 4;
            for (let c = 0; c < 3; c++) small[o + c] = srgbByte(acc[c] / weight);
            small[o + 3] = Math.round((acc[3] / weight) * 255);
        }
    }
    return {
        size, rows, data, smallSize, small,
    };
}

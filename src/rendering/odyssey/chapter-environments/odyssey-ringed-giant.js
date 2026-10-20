// @ts-check
/**
 * @fileoverview Chapter 6's ringed giant — the data and the CPU bakes (three-free: typed arrays
 * only, so tests can read them).
 *
 * The giant used to be a 28-unit ball with thirteen sine bands and three thin additive ring
 * strips whose plane sat 14 degrees off the bands' axis: from the rail it read as a striped toy.
 * This is the Stellar Drift theme's giant re-derived for Odyssey (the theme's code is never
 * imported here — `src/themes/stellar-drift/stellar-drift-bake.js` `ringAt`, `bandAt`,
 * `bandColor` and `stellar-drift-core.js` `RINGS`/`PALETTES` are the sources, adapted to one
 * palette and to a mesh instead of a full-screen trace):
 *   - the bands come from a latitude table (belts, the zonal jets' wind, how torn the cloud is),
 *     so there are dozens of them, of different widths, in four related colours;
 *   - the rings are a slab of ice with an optical depth read from one radial profile, and the
 *     same profile casts their shadow on the cloud tops — every gap is a line of light there.
 *
 * Bakes are tiny (512 + 32 band texels, 2048 ring texels with a CPU-averaged mip chain, a few
 * milliseconds) and memoised per module, so a chapter rebuild never bakes twice.
 */

/** The rings in giant radii: thin inner ring (C), the broad bright one (B), the division, the outer (A), a strand (F). */
export const GIANT_RINGS = Object.freeze({
    from: 1.2,
    to: 2.42,
    cInner: 1.24,
    bInner: 1.525,
    bOuter: 1.95,
    aInner: 2.025,
    aOuter: 2.27,
    strand: 2.33,
});

/** The greatest optical depth the profile stores (its R channel holds sqrt(tau / TAU_MAX)). */
export const GIANT_RING_TAU_MAX = 4;

/** Ring profile and band table sizes (texels). */
export const GIANT_RING_SIZE = 2048;
export const GIANT_BAND_SIZE = 512;
export const GIANT_BAND_FAR_SIZE = 32;

/** Belts as [south edge, north edge, strength], degrees of latitude. */
const BELTS = Object.freeze([
    [7, 17.5, 1.0], [24.5, 31, 0.72], [36.5, 42, 0.66], [47.5, 52, 0.56], [57, 60.5, 0.5],
    [-19.5, -7, 0.94], [-33, -27, 0.74], [-44, -38.5, 0.62], [-53, -49, 0.55], [-61.5, -57.5, 0.5],
]);
const JET_EDGE = 0.46;

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const L = (hex) => [
    srgbToLinear(((hex >> 16) & 255) / 255),
    srgbToLinear(((hex >> 8) & 255) / 255),
    srgbToLinear((hex & 255) / 255),
];

/**
 * The giant's palette (scene-linear). Stellar Drift's "amber": cream zones, tan, rust belts and
 * their dark, a dusky pole — it answers the black hole's amber disk that lights it, against the
 * chapter's violet nebula.
 */
export const GIANT_PALETTE = Object.freeze({
    zoneA: L(0xf3e2c3),
    zoneB: L(0xe8c99a),
    beltA: L(0xb0633a),
    beltB: L(0x7a4630),
    polar: L(0x8d7a66),
    storm: L(0xcf4a2c),
    haze: L(0xffd9a6),
    night: L(0x1a2440),
    ringIce: L(0xf2e6d2),
    ringDust: L(0x9a7a5c),
});

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
};
const bell = (x) => Math.exp(-x * x);
const box = (r, a, b, soft) => smooth(a - soft, a + soft, r) * (1 - smooth(b - soft, b + soft, r));
const srgbByte = (v) => {
    const c = clamp01(v);
    const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(clamp01(s) * 255);
};

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
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

const WAVE_TRAINS = Object.freeze([2.062, 2.118, 2.166, 2.238]);
const PLATEAUS = Object.freeze([1.262, 1.307, 1.351, 1.398, 1.436, 1.474, 1.502]);

/**
 * The rings at radius r (giant radii): [tau, ice (0 dust-dark .. 1 bright ice), groove (fine
 * brightness), dust (the share that scatters light forward)].
 */
export function giantRingAt(r, noise) {
    const R = GIANT_RINGS;
    const broad = noise(r * 46, 3);
    const lets = noise(r * 310 + 40, 3);
    const fine = noise(r * 1500 + 90, 2);
    let tau = 0;
    let ice = 0.5;
    let dust = 0.2;

    const c = box(r, R.cInner, R.bInner, 0.004);
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
    const b = box(r, R.bInner, R.bOuter, 0.0018);
    if (b > 0) {
        const k = (r - R.bInner) / (R.bOuter - R.bInner);
        const body = lerp(0.85, 2.7, smooth(0.0, 0.34, k)) * (1 - 0.3 * smooth(0.7, 1, k));
        let t = body * (0.5 + 1.0 * broad) * (0.62 + 0.76 * lets);
        t += 0.5 * smooth(0.62, 0.9, fine) * smooth(0.1, 0.4, k);
        tau += t * b;
        ice = lerp(ice, 0.72 + 0.26 * smooth(0, 1, k) - 0.14 * (1 - broad), b);
        dust = lerp(dust, 0.05, b);
    }
    const d = box(r, R.bOuter, R.aInner, 0.0016);
    if (d > 0) {
        let t = 0.05 + 0.09 * smooth(0.35, 0.8, lets) + 0.06 * smooth(1.99, 2.02, r);
        t *= 1 - box(r, 1.9535, 1.961, 0.0007);
        t += 0.45 * box(r, 1.9566, 1.9578, 0.0004);
        tau += t * d;
        ice = lerp(ice, 0.3 + 0.12 * lets, d);
        dust = lerp(dust, 0.55, d);
    }
    const a = box(r, R.aInner, R.aOuter, 0.0016);
    if (a > 0) {
        const k = (r - R.aInner) / (R.aOuter - R.aInner);
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
    const s1 = Math.exp(-(((r - R.strand) / 0.0026) ** 2));
    const s2 = Math.exp(-(((r - R.strand - 0.0088) / 0.0014) ** 2));
    const strand = s1 * 0.26 + s2 * 0.09;
    if (strand > 1e-4) {
        tau += strand;
        ice = lerp(ice, 0.86, clamp01(strand * 6));
        dust = lerp(dust, 1, clamp01(strand * 6));
    }
    const groove = clamp01(0.5 + (broad - 0.5) * 1.0 + (lets - 0.5) * 0.8 + (fine - 0.5) * 0.4);
    return [Math.min(GIANT_RING_TAU_MAX, Math.max(0, tau)), clamp01(ice), groove, clamp01(dust)];
}

let ringProfileCache = null;

/**
 * The rings' radial profile from GIANT_RINGS.from to .to with a CPU-averaged mip chain (optical
 * depth is averaged as depth, not as its stored square root). RGBA8: sqrt(tau/TAU_MAX), ice,
 * groove, dust.
 * @returns {{ size: number, levels: Array<{ data: Uint8Array, width: number }>, tau: Float32Array }}
 */
export function bakeGiantRingProfile() {
    if (ringProfileCache) return ringProfileCache;
    const size = GIANT_RING_SIZE;
    const noise = makeNoise1(5381);
    const values = new Float32Array(size * 4);
    const tau = new Float32Array(size);
    for (let i = 0; i < size; i++) {
        const r = GIANT_RINGS.from + ((i + 0.5) / size) * (GIANT_RINGS.to - GIANT_RINGS.from);
        const v = giantRingAt(r, noise);
        tau[i] = v[0];
        for (let c = 0; c < 4; c++) values[i * 4 + c] = v[c];
    }
    const levels = [];
    let level = values;
    let width = size;
    for (;;) {
        const data = new Uint8Array(width * 4);
        for (let i = 0; i < width; i++) {
            data[i * 4] = Math.round(Math.sqrt(clamp01(level[i * 4] / GIANT_RING_TAU_MAX)) * 255);
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
    ringProfileCache = { size, levels, tau };
    return ringProfileCache;
}

/** The rings' optical depth at radius r (giant radii), from the baked profile (CPU twin). */
export function giantRingTau(r) {
    const profile = bakeGiantRingProfile();
    const x = ((r - GIANT_RINGS.from) / (GIANT_RINGS.to - GIANT_RINGS.from)) * profile.size - 0.5;
    if (x < 0 || x > profile.size - 1) return 0;
    const i = Math.floor(x);
    const f = x - i;
    return profile.tau[i] + (profile.tau[Math.min(profile.size - 1, i + 1)] - profile.tau[i]) * f;
}

/**
 * The giant by latitude: [belt (0 bright zone .. 1 dark belt), wind (−1..1), shear (0..1), tone].
 */
export function giantBandAt(latDeg, noise) {
    let belt = 0;
    let wind = Math.exp(-((latDeg / 8.5) ** 2));
    let shear = 0;
    for (let i = 0; i < BELTS.length; i++) {
        const [a, b, strength] = BELTS[i];
        belt += box(latDeg, a, b, 1.1) * strength;
        const side = latDeg >= 0 ? 1 : -1;
        const ga = Math.exp(-(((latDeg - a) / 1.7) ** 2));
        const gb = Math.exp(-(((latDeg - b) / 1.7) ** 2));
        wind += (gb - ga) * JET_EDGE * strength * side;
        shear += (ga + gb) * strength;
    }
    const stripes = noise(latDeg * 0.83 + 200, 3);
    const hair = noise(latDeg * 3.3 + 31, 2);
    belt = clamp01(belt * (0.62 + 0.76 * stripes) + (stripes - 0.5) * 0.46 + (hair - 0.5) * 0.24);
    const polar = smooth(62, 78, Math.abs(latDeg));
    belt = lerp(belt, 0.58, polar);
    shear = clamp01(0.22 + 0.62 * shear + 0.28 * belt + 0.5 * polar);
    const tone = noise(latDeg * 0.19 + 77, 2);
    return [belt, Math.max(-1, Math.min(1, wind)), shear, clamp01(tone * 1.5 - 0.25)];
}

function bandColor(latDeg, belt, tone, out) {
    const p = GIANT_PALETTE;
    const polar = smooth(58, 77, Math.abs(latDeg)) * 0.86;
    const equator = 0.3 * bell(latDeg / 9);
    const x = clamp01(belt * 0.86 + (tone - 0.5) * 0.42 + 0.06);
    const k = smooth(0.42, 0.74, x);
    for (let c = 0; c < 3; c++) {
        const zone = lerp(p.zoneA[c], p.zoneB[c], smooth(0.0, 0.42, x));
        const dark = lerp(p.beltA[c], p.beltB[c], smooth(0.7, 1.0, x));
        let v = lerp(zone, dark, k);
        v = lerp(v, p.zoneA[c], equator * (1 - k));
        out[c] = lerp(v, p.polar[c] * (0.8 + 0.4 * (1 - belt)), polar);
    }
    return out;
}

let bandCache = null;

/**
 * The band tables, south pole to north. `meta` (linear bytes): R belt, G wind·0.5+0.5, B shear,
 * A tone. `colors` (sRGB bytes, alpha = belt) and `far` (the same, blurred, for the limb where a
 * band is thinner than a pixel).
 * @returns {{ size: number, meta: Uint8Array, colors: Uint8Array, farSize: number, far: Uint8Array }}
 */
export function bakeGiantBands() {
    if (bandCache) return bandCache;
    const size = GIANT_BAND_SIZE;
    const farSize = GIANT_BAND_FAR_SIZE;
    const noise = makeNoise1(9173);
    const meta = new Uint8Array(size * 4);
    const colors = new Uint8Array(size * 4);
    const linear = new Float32Array(size * 4);
    const rgb = [0, 0, 0];
    for (let i = 0; i < size; i++) {
        const lat = ((i + 0.5) / size) * 180 - 90;
        const v = giantBandAt(lat, noise);
        meta[i * 4] = Math.round(v[0] * 255);
        meta[i * 4 + 1] = Math.round((v[1] * 0.5 + 0.5) * 255);
        meta[i * 4 + 2] = Math.round(v[2] * 255);
        meta[i * 4 + 3] = Math.round(v[3] * 255);
        bandColor(lat, v[0], v[3], rgb);
        for (let c = 0; c < 3; c++) {
            linear[i * 4 + c] = rgb[c];
            colors[i * 4 + c] = srgbByte(rgb[c]);
        }
        linear[i * 4 + 3] = v[0];
        colors[i * 4 + 3] = Math.round(v[0] * 255);
    }
    const far = new Uint8Array(farSize * 4);
    const span = size / farSize;
    for (let s = 0; s < farSize; s++) {
        const acc = [0, 0, 0, 0];
        let weight = 0;
        for (let i = Math.floor((s - 0.5) * span); i < (s + 1.5) * span; i++) {
            if (i < 0 || i >= size) continue;
            const w = 1 - Math.abs((i + 0.5) / span - (s + 0.5)) / 1.5;
            if (w <= 0) continue;
            for (let c = 0; c < 4; c++) acc[c] += linear[i * 4 + c] * w;
            weight += w;
        }
        for (let c = 0; c < 3; c++) far[s * 4 + c] = srgbByte(acc[c] / weight);
        far[s * 4 + 3] = Math.round((acc[3] / weight) * 255);
    }
    bandCache = {
        size, meta, colors, farSize, far,
    };
    return bandCache;
}

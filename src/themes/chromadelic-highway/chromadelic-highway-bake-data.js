/**
 * Chromadelic Highway — deterministic texture data shared by the bake worker and the synchronous fallback.
 *
 * Replaces blurry/muddy raster lookups with razor-sharp procedural cosmic data that works offline,
 * headless, in tests, and on both WebGPU and WebGL2 with zero network stall:
 *
 *   1. Cosmic Nebula Atlas (256×256 seamless RGBA, mipped):
 *        R = broad billowy emission clouds
 *        G = warped ridge filament field (ionization threads)
 *        B = dark absorbing Bok dust rifts
 *        A = fine wispy aurora/cloud grain
 *
 *   2. Rainbow-Banded Gas Giant Surface + Altitude Map (512×256 equirectangular RGBA, mipped):
 *        RGB = vivid jewel-toned chromadelic bands with Kelvin-Helmholtz jet shear, braided cloud
 *              filaments and a swirling Great Chromatic Anticyclonic Vortex
 *        A   = cloud-top altitude height for analytic normal relief under the highway-core sun
 *
 *   3. Ringed Ice Giant 1D Optical-Depth Profile (512×1 RGBA with CPU-averaged mip chain):
 *        R = ring optical depth (gossamer C-ring, sculpted B-ring, crisp Cassini Division,
 *            A-ring with Encke Gap, delicate F-ring shepherd thread)
 *        G = ringlet iridescence variation
 *        B = icy crystal micro-sparkle density
 *        A = opacity (CPU mip-averaged per gotcha #142 so rings never alias at any distance)
 */

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
};
const toByte = (x) => Math.max(0, Math.min(255, Math.round(x * 255)));

/** Deterministic 2D integer hash in [0, 1). */
function hash2(ix, iy, seed) {
    let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
    h = (h ^ (h >>> 13)) | 0;
    h = Math.imul(h, 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Seamless periodic 2D value noise with period (px, py) and quintic interpolation. */
function periodicNoise2(x, y, px, py, seed) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const ix0 = ((x0 % px) + px) % px;
    const iy0 = ((y0 % py) + py) % py;
    const ix1 = (ix0 + 1) % px;
    const iy1 = (iy0 + 1) % py;
    const n00 = hash2(ix0, iy0, seed);
    const n10 = hash2(ix1, iy0, seed);
    const n01 = hash2(ix0, iy1, seed);
    const n11 = hash2(ix1, iy1, seed);
    return lerp(lerp(n00, n10, ux), lerp(n01, n11, ux), uy);
}

/** Seamless periodic fBm in [0, 1]. */
function periodicFbm(u, v, basePx, basePy, octaves, seed) {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let px = basePx;
    let py = basePy;
    for (let o = 0; o < octaves; o++) {
        sum += amp * periodicNoise2(u * px, v * py, px, py, seed + o * 97);
        norm += amp;
        amp *= 0.5;
        px *= 2;
        py *= 2;
    }
    return sum / norm;
}

/**
 * Bake the 256×256 seamless cosmic nebula + dust + filament atlas (linear data).
 * Returns the raw RGBA bytes and dimensions.
 */
export function bakeCosmicNebulaData(size = 256) {
    const data = new Uint8Array(size * size * 4);
    const inv = 1 / size;
    for (let y = 0; y < size; y++) {
        const v = y * inv;
        for (let x = 0; x < size; x++) {
            const u = x * inv;
            // Broad domain warp for organic astrophysical swirls
            const wx = periodicFbm(u, v, 4, 4, 3, 11) - 0.5;
            const wy = periodicFbm(u, v, 4, 4, 3, 37) - 0.5;
            const wu = u + wx * 0.22;
            const wv = v + wy * 0.22;

            // R: smooth billowy emission body
            const cloud = periodicFbm(wu, wv, 4, 4, 4, 71);

            // G: stretched warped ridge field for luminous ionization filaments
            const filRaw = periodicFbm(wu + wy * 0.14, wv - wx * 0.14, 6, 3, 3, 131);
            const ridge = 1.0 - Math.abs(filRaw * 2.0 - 1.0);
            const filament = clamp01(ridge) ** 2.4;

            // B: dark absorbing cosmic dust rifts (clumpy Bok globules + winding lanes)
            const dustRaw = periodicFbm(wu * 1.0 + 0.31, wv * 1.0 + 0.17, 5, 5, 4, 211);
            const dustLane = 1.0 - Math.abs(periodicFbm(wu, wv, 3, 6, 3, 277) * 2.0 - 1.0);
            const dust = clamp01(smooth(0.46, 0.78, dustRaw) * 0.72 + dustLane ** 3.0 * 0.55);

            // A: fine wispy detail + aurora curtain grain
            const wisp = periodicFbm(u + wx * 0.08, v + wy * 0.08, 8, 8, 3, 349);

            const idx = (y * size + x) * 4;
            data[idx] = toByte(cloud);
            data[idx + 1] = toByte(filament);
            data[idx + 2] = toByte(dust);
            data[idx + 3] = toByte(wisp);
        }
    }
    return { width: size, height: size, data };
}

// ── Rainbow-Banded Gas Giant Surface + Cloud Relief Map ─────────────────────

/**
 * Curated sRGB band stops from South Pole (v=0) to North Pole (v=1).
 * Balanced vivid jewel hues (violet → cobalt → cyan → emerald → warm gold → coral → rose-magenta
 * → royal orchid → warm amber → electric azure → deep indigo) so every band glows richly without
 * turning muddy brown or blowing out yellow-lime.
 */
const GIANT_BAND_STOPS = [
    [0.00, [0.16, 0.10, 0.34]], // south polar hood (deep indigo-violet)
    [0.10, [0.22, 0.24, 0.68]], // polar sapphire belt
    [0.19, [0.12, 0.72, 0.90]], // electric turquoise zone
    [0.27, [0.18, 0.84, 0.66]], // luminous aqua-emerald jet
    [0.34, [0.95, 0.80, 0.34]], // sunlit champagne-gold zone
    [0.42, [0.98, 0.44, 0.24]], // vivid coral-tangerine equatorial belt
    [0.50, [0.98, 0.18, 0.56]], // signature blazing rose-magenta equator
    [0.57, [0.76, 0.20, 0.96]], // royal electric orchid belt
    [0.64, [0.96, 0.52, 0.32]], // warm peach-coral shear zone
    [0.72, [0.94, 0.84, 0.44]], // luminous lemon-gold high band
    [0.80, [0.14, 0.78, 0.88]], // bright cerulean-cyan north belt
    [0.89, [0.30, 0.28, 0.82]], // deep cobalt-violet subpolar
    [1.00, [0.14, 0.08, 0.30]], // north polar hood
];

function sampleBandPalette(t, out) {
    const clamped = clamp01(t);
    for (let i = 0; i < GIANT_BAND_STOPS.length - 1; i++) {
        const [t0, c0] = GIANT_BAND_STOPS[i];
        const [t1, c1] = GIANT_BAND_STOPS[i + 1];
        if (clamped <= t1) {
            const k = smooth(t0, t1, clamped);
            out[0] = lerp(c0[0], c1[0], k);
            out[1] = lerp(c0[1], c1[1], k);
            out[2] = lerp(c0[2], c1[2], k);
            return out;
        }
    }
    const last = GIANT_BAND_STOPS[GIANT_BAND_STOPS.length - 1][1];
    out[0] = last[0];
    out[1] = last[1];
    out[2] = last[2];
    return out;
}

/**
 * Bake the 512×256 equirectangular rainbow gas-giant surface (RGB sRGB-like + A cloud altitude).
 */
export function bakeRainbowGiantData(width = 512, height = 256) {
    const data = new Uint8Array(width * height * 4);
    const col = [0, 0, 0];
    const stormCol = [0, 0, 0];
    const invW = 1 / width;
    const invH = 1 / height;

    // Great Chromatic Anticyclonic Vortex (positioned so it faces the camera cleanly on rest)
    const vU = 0.63;
    const vV = 0.53;
    const vRu = 0.071;
    const vRv = 0.049;

    for (let y = 0; y < height; y++) {
        const v = (y + 0.5) * invH; // 0 south -> 1 north
        const latSin = Math.sin((v - 0.5) * Math.PI);
        const polarFade = smooth(0.95, 0.65, Math.abs(latSin));

        for (let x = 0; x < width; x++) {
            const u = x * invW;

            // Zonal jet shear: alternating east/west wind belts deform longitudinal wisps
            const jetWave = Math.sin(v * Math.PI * 12.0) * 0.045 + Math.cos(v * Math.PI * 7.0) * 0.025;
            const shearU = u + jetWave;

            // Multi-scale turbulent eddies along the band boundaries (Kelvin-Helmholtz curls)
            const eddy1 = periodicFbm(shearU, v, 6, 12, 3, 401) - 0.5;
            const eddy2 = periodicFbm(u + eddy1 * 0.16, v + eddy1 * 0.05, 12, 24, 3, 509) - 0.5;
            const fineStreak = periodicFbm(u + eddy2 * 0.09, v, 16, 48, 2, 613);

            // Latitude coordinate warped by turbulent jets (calm at poles)
            // Advect the latitude bands around the pressure oval. The wake belongs to
            // the same jet as the coloured clouds on both sides of the eye.
            const du = u - vU - Math.round(u - vU);
            const ex = du / vRu;
            const ey = (v - vV) / vRv;
            const er = Math.hypot(ex, ey);
            const turn = 3.4 * Math.exp(-0.58 * er * er);
            const deflection = vRv * (Math.sin(turn) * ex + (Math.cos(turn) - 1) * ey);
            const warpedV = clamp01(v + deflection + (eddy1 * 0.064 + eddy2 * 0.031) * polarFade);
            sampleBandPalette(warpedV, col);

            // Luminous pearl-gold & rose-white high-altitude cloud deck filaments riding jet crests
            const ribbons = Math.sin(warpedV * 260 + eddy2 * 3.1);
            const crest = smooth(0.54, 0.82, fineStreak) * 0.70 + smooth(0.55, 1, ribbons) * 0.23;
            const trough = smooth(0.45, 0.17, fineStreak) * 0.26 + smooth(-0.32, -0.96, ribbons) * 0.16;
            col[0] = clamp01(col[0] * (1.0 - trough) + (1.0 - col[0]) * crest * 0.32);
            col[1] = clamp01(col[1] * (1.0 - trough) + (0.95 - col[1]) * crest * 0.26);
            col[2] = clamp01(col[2] * (1.0 - trough) + (1.0 - col[2]) * crest * 0.28);

            // Cloud altitude (for analytic lighting relief in the planet shader)
            let altitude = clamp01(0.45 + crest * 0.45 - trough * 0.5 + eddy2 * 0.2);

            // Great Chromatic Anticyclonic Vortex: spiral eye with golden-rose storm bands
            if (er < 1.35) {
                const ang = Math.atan2(ey, ex);
                const swirl = Math.sin(ang * 2.0 + er * 7.5 + eddy2 * 3.0) * 0.5 + 0.5;
                const eyeMask = smooth(1.25, 0.22, er);
                const coreGlow = smooth(0.55, 0.0, er);
                // A coral spiral wraps a dark eye at the centre of the jet.
                stormCol[0] = 0.74 + 0.24 * swirl - 0.38 * coreGlow;
                stormCol[1] = 0.18 + 0.54 * swirl - 0.16 * coreGlow;
                stormCol[2] = 0.40 + 0.12 * swirl;
                col[0] = lerp(col[0], stormCol[0], eyeMask * 0.88);
                col[1] = lerp(col[1], stormCol[1], eyeMask * 0.88);
                col[2] = lerp(col[2], stormCol[2], eyeMask * 0.88);
                altitude = lerp(altitude, 0.78 + swirl * 0.2, eyeMask);
            }

            // Secondary subtle turquoise-violet oval storm on opposite hemisphere
            let du2 = u - 0.18;
            if (du2 > 0.5) du2 -= 1;
            if (du2 < -0.5) du2 += 1;
            const er2 = Math.hypot(du2 / 0.06, (v - 0.68) / 0.036);
            if (er2 < 1.2) {
                const m2 = smooth(1.15, 0.15, er2);
                col[0] = lerp(col[0], 0.35, m2 * 0.65);
                col[1] = lerp(col[1], 0.96, m2 * 0.65);
                col[2] = lerp(col[2], 1.0, m2 * 0.65);
                altitude = lerp(altitude, 0.85, m2);
            }

            const idx = (y * width + x) * 4;
            data[idx] = toByte(col[0]);
            data[idx + 1] = toByte(col[1]);
            data[idx + 2] = toByte(col[2]);
            data[idx + 3] = toByte(altitude);
        }
    }
    return { width, height, data };
}

// ── Ringed Ice Giant 1D Optical-Depth Profile (CPU-averaged mip chain) ──────

/**
 * Bake a crisp 512×1 RGBA Saturn-inspired icy ring optical-depth profile with CPU-averaged mips
 * (gotcha #142): C-ring gossamer veil, dense banded B-ring, razor-sharp Cassini Division,
 * A-ring with Encke Gap, and fine F-ring shepherd thread.
 */
export function bakeIceRingData(width = 512) {
    const base = new Uint8Array(width * 4);
    for (let i = 0; i < width; i++) {
        const t = (i + 0.5) / width; // 0 inner edge -> 1 outer edge

        // Fine multi-frequency concentric density waves (resonant ringlets)
        const w1 = Math.sin(t * 95.0) * 0.5 + 0.5;
        const w2 = Math.sin(t * 240.0 + 1.3) * 0.5 + 0.5;
        const w3 = Math.sin(t * 530.0 + 2.7) * 0.5 + 0.5;
        const ringlets = 0.68 + 0.16 * w1 + 0.10 * w2 + 0.06 * w3;

        // Zone structure:
        //   0.00..0.22  Gossamer inner C-ring
        //   0.22..0.58  Dense luminous B-ring (brightest, richly banded)
        //   0.58..0.66  Cassini Division (crisp translucent gap with one faint central thread)
        //   0.66..0.93  Sculpted A-ring (with razor Encke Gap at 0.855..0.872)
        //   0.955..0.985 Delicate braided F-ring outer thread
        const cRing = smooth(0.01, 0.06, t) * (1.0 - smooth(0.20, 0.23, t)) * (0.28 + 0.18 * w1);
        const bRing = smooth(0.20, 0.24, t) * (1.0 - smooth(0.565, 0.585, t)) * (0.78 + 0.22 * w2) * ringlets;
        const cassiniThread = Math.exp(-(((t - 0.62) / 0.008) ** 2.0)) * 0.14;
        const enckeCut = 1.0 - Math.exp(-(((t - 0.862) / 0.009) ** 2.0)) * 0.92;
        const aRing = smooth(0.648, 0.668, t) * (1.0 - smooth(0.92, 0.94, t)) * 0.66 * ringlets * enckeCut;
        const fRing = Math.exp(-(((t - 0.968) / 0.007) ** 2.0)) * 0.58;

        const tau = clamp01(cRing + bRing + cassiniThread + aRing + fRing);
        // Iridescence channel: varies gently across zones for icy opalescent sheen
        const irid = clamp01(0.35 + 0.45 * w1 + 0.2 * Math.sin(t * 14.0));
        // Crystal sparkle density: strongest in dense B-ring crests and A-ring shoulder
        const sparkle = clamp01((bRing * 0.9 + aRing * 0.7 + fRing) * (0.3 + 0.7 * w3));

        const idx = i * 4;
        base[idx] = toByte(tau);
        base[idx + 1] = toByte(irid);
        base[idx + 2] = toByte(sparkle);
        base[idx + 3] = toByte(tau);
    }

    // Build CPU-averaged 1D mip chain (512 -> 256 -> ... -> 1)
    const levels = [{ data: base, width, height: 1 }];
    let prev = base;
    let curW = width;
    while (curW > 1) {
        const nextW = curW >> 1;
        const next = new Uint8Array(nextW * 4);
        for (let i = 0; i < nextW; i++) {
            const a = i * 8;
            const b = a + 4;
            const dst = i * 4;
            next[dst] = (prev[a] + prev[b] + 1) >> 1;
            next[dst + 1] = (prev[a + 1] + prev[b + 1] + 1) >> 1;
            next[dst + 2] = (prev[a + 2] + prev[b + 2] + 1) >> 1;
            next[dst + 3] = (prev[a + 3] + prev[b + 3] + 1) >> 1;
        }
        levels.push({ data: next, width: nextW, height: 1 });
        prev = next;
        curW = nextW;
    }
    return { width, levels };
}

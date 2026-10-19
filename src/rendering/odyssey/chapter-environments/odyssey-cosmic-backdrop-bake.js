/**
 * @fileoverview The ch6 cosmic backdrop's field bake, three-free so a module Worker can run it
 * (odyssey-cosmic-backdrop.worker.js). The texture, the slicing fallback and the dome material
 * stay in odyssey-cosmic-backdrop.js; this module is only the math (see that file's header for
 * what is baked and why).
 */

/**
 * THE MILKY WAY'S PLANE (its normal), shared by the dome's baked glow and the star sprites'
 * band share (cosmic-expanse.js CH6_STARFIELD) so the two are ONE band. Re-seated 2026-10-03
 * from (0.4, 0.18, 1.0): on the real camera that axis ran the star band straight down the screen
 * centre — behind the ribbon and the level nodes — for the whole chapter. This one (solved against
 * a real-camera replay at p 0.76-0.85) lays the band as a stable DIAGONAL from the upper left
 * (-0.5, 1.0) through the centre (0.1, 0.1) to the lower right (0.85, -1.0): it passes behind the
 * black hole's final seat and behind the gas giant, a leading line to the destination.
 */
export const GALACTIC_BAND_AXIS = Object.freeze([0.01, -0.75, -0.66]);

export const COSMIC_BACKDROP_DEFAULTS = Object.freeze({
    // 1024×512 (~260 ms CPU, once, at chapter creation inside the warmup path): at
    // 512×256 one texel spanned ~4.7° of longitude and the dome rendered as giant
    // soft blobs — the "blurry wash" the owner flagged. The world bake's 400 ms
    // budget class is the precedent; this is a look-critical one-time cost.
    width: 1024,
    height: 512,
    seed: 61.7,
    // Base floor gradient, bottom → top. ⚠️ Floors are chosen to survive 8-bit
    // quantisation (≥ 1/255 per authored channel): "nothing in a Ghibli frame is
    // ever pure black" fails silently if the lift rounds to zero.
    floorBottom: [0.004, 0.004, 0.012],
    floorTop: [0.010, 0.007, 0.030],
    // Galactic lane axis: the Milky Way's plane normal (see GALACTIC_BAND_AXIS).
    bandAxis: GALACTIC_BAND_AXIS,
});

// ── Seeded integer-bit-mix value noise (CPU) ─────────────────────────────────────
// sin-based hashes cost ~3x on startup paths (measured, One World Wave 1); this is
// the integer-mix form. Deterministic for a given seed — the bake is reproducible,
// which is what makes its tests meaningful.

function hash3(ix, iy, iz, seed) {
    let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(iz, 0x9e3779b9) ^ seed;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

const sstep = (lo, hi, x) => {
    const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
    return t * t * (3 - 2 * t);
};

function valueNoise3(x, y, z, seed) {
    const ix = Math.floor(x); const iy = Math.floor(y); const iz = Math.floor(z);
    const fx = x - ix; const fy = y - iy; const fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const uz = fz * fz * (3 - 2 * fz);
    const c000 = hash3(ix, iy, iz, seed); const c100 = hash3(ix + 1, iy, iz, seed);
    const c010 = hash3(ix, iy + 1, iz, seed); const c110 = hash3(ix + 1, iy + 1, iz, seed);
    const c001 = hash3(ix, iy, iz + 1, seed); const c101 = hash3(ix + 1, iy, iz + 1, seed);
    const c011 = hash3(ix, iy + 1, iz + 1, seed); const c111 = hash3(ix + 1, iy + 1, iz + 1, seed);
    const x00 = c000 + (c100 - c000) * ux;
    const x10 = c010 + (c110 - c010) * ux;
    const x01 = c001 + (c101 - c001) * ux;
    const x11 = c011 + (c111 - c011) * ux;
    const y0 = x00 + (x10 - x00) * uy;
    const y1 = x01 + (x11 - x01) * uy;
    return y0 + (y1 - y0) * uz;
}

function fbm3(x, y, z, octaves, seed) {
    let sum = 0; let amp = 0.5; let norm = 0; let f = 1;
    for (let o = 0; o < octaves; o += 1) {
        sum += amp * valueNoise3(x * f, y * f, z * f, seed + o * 101);
        norm += amp;
        amp *= 0.5;
        f *= 2;
    }
    return sum / norm;
}

function ridged3(x, y, z, octaves, seed) {
    let sum = 0; let amp = 0.5; let norm = 0; let f = 1;
    for (let o = 0; o < octaves; o += 1) {
        const n = valueNoise3(x * f, y * f, z * f, seed + o * 173);
        sum += amp * (1 - Math.abs(2 * n - 1));
        norm += amp;
        amp *= 0.5;
        f *= 2;
    }
    return sum / norm;
}

/** The options a bake resolves to: COSMIC_BACKDROP_DEFAULTS plus the caller's overrides. */
export function resolveCosmicBackdropOptions(options = {}) {
    return { ...COSMIC_BACKDROP_DEFAULTS, ...options };
}

/**
 * Bake rows [y0, y1) of the painted cosmos into `data` (RGBA8, width x height).
 * @param {Uint8Array} data @param {object} opts resolved options (COSMIC_BACKDROP_DEFAULTS + overrides)
 * @param {number} y0 @param {number} y1
 */
export function bakeCosmicBackdropRows(data, opts, y0, y1) {
    // NOTE dx below: three's SphereGeometry seats its vertices at x = -cos(phi) sin(theta)
    // (SphereGeometry.js), so the direction a texel is SEEN in has a negative cosine.
    const {
        width, height, seed, floorBottom, floorTop, bandAxis,
    } = opts;
    const iSeed = Math.floor(seed * 8191) | 0;

    const bl = Math.hypot(bandAxis[0], bandAxis[1], bandAxis[2]);
    const bx = bandAxis[0] / bl; const by = bandAxis[1] / bl; const bz = bandAxis[2] / bl;

    for (let iy = y0; iy < y1; iy += 1) {
        // DataTexture row 0 is v=0; SphereGeometry has uv.y=1 at +Y, so v maps
        // bottom (−Y) → top (+Y) as the polar angle runs π → 0.
        const v = (iy + 0.5) / height;
        const dirY = -Math.cos(Math.PI * v);
        const sinTheta = Math.sin(Math.PI * v);
        const h01 = v;
        const hCurve = h01 ** 1.4;
        for (let ix = 0; ix < width; ix += 1) {
            const u = (ix + 0.5) / width;
            const phi = 2 * Math.PI * u;
            // ⚠️ MIRROR FIX (2026-10-03). This was `+sinTheta * cos(phi)`, the mirror image of
            // where three's sphere actually puts the texel — so the dome's galactic glow sat on
            // the plane with normal (-x, y, z) while the star sprites sat on (x, y, z): the
            // "faint glow UNDER the stars" was never under them. In game it read as a grey
            // vertical smear at the right edge of every chapter-6 frame (real-camera replay:
            // ndc x 0.80-1.0), with the star band alone down the centre.
            const dx = -sinTheta * Math.cos(phi);
            const dz = sinTheta * Math.sin(phi);

            // Floor gradient — the void is never RGB-zero.
            let r = floorBottom[0] + (floorTop[0] - floorBottom[0]) * hCurve;
            let g = floorBottom[1] + (floorTop[1] - floorBottom[1]) * hCurve;
            let b = floorBottom[2] + (floorTop[2] - floorBottom[2]) * hCurve;

            // ── MASTERPIECE PASS (2026-10): a SOFT sky, one value band below the gas ──────
            // The Wave 2 bake posterized three saturated families (magenta pockets, cobalt
            // bodies, rust lane filaments) with 0.03-0.05-wide thresholds. Magnified 4-6x
            // on screen those read in-game as hard-edged purple blobs and a flat red smear
            // full of black holes — the loudest thing in every ch6 frame, louder than the
            // nebulae it was meant to sit behind. The sky is now what a deep-space sky is:
            // near-black, one soft galactic band with star clouds and dark dust rifts, and a
            // faint, low-chroma nebulosity — all wide ramps, nothing posterized.
            const bandDot = dx * bx + dirY * by + dz * bz;
            const lat2 = bandDot * bandDot;
            const bandWide = Math.exp(-14 * lat2);
            const bandCore = Math.exp(-70 * lat2);
            // Star clouds: lumpy brightness ALONG the band.
            const clump = sstep(0.38, 0.78, fbm3(dx * 3.4 + 5, dirY * 3.4, dz * 3.4, 3, iSeed ^ 0x2545));
            // Dark rifts: ridged crests, strongest in the band's spine (the Great Rift idea).
            // Thin, sparse rifts — wide, deep ones carved the band into grey "leaf" blobs.
            const rift = sstep(0.62, 0.86, ridged3(dx * 4.6 + 13, dirY * 4.6, dz * 4.6, 2, iSeed ^ 0x27d4));
            // Rifts soften the band rather than cutting HOLES in it (0.6 -> 0.3): with the grade
            // no longer crushing faint values (566c258d), deep rifts read as dark leaf-holes in
            // a grey cloud at the frame edge — the integrator's ch6 bisect isolated exactly this.
            const riftCut = 1 - 0.3 * rift * Math.min(1, bandCore * 1.5);
            // Clump contrast kept LOW: magnified 4-6x on screen, strong star-cloud clumps read as
            // grey bokeh blobs; the Milky Way's grain comes from the star sprites' band share.
            // ~0.55x of the first masterpiece-pass values: the band is a faint glow UNDER the
            // star sprites (45% of the far tier sits on it and gives the Milky Way its grain),
            // never a grey smoke shape of its own once the corrected grade shows faint values.
            const band = (bandWide * 0.05 + bandCore * (0.085 + 0.065 * clump)) * riftCut;
            // Warm spine, blue wings. (2026-10-03: with the band now IN frame — it sat mirrored
            // at the screen edge before — cream-and-grey read as a beam of grey smoke. The wings
            // are a clear starlight blue and the spine a warm gold-white.)
            const warmT = Math.min(1, bandCore * 1.2);
            r += band * (0.34 + 0.62 * warmT);
            g += band * (0.46 + 0.38 * warmT);
            b += band * (0.92 - 0.22 * warmT);

            // Faint nebulosity off the band: two soft families on separate seeds, gated by a
            // low-frequency macro so whole regions of the sky stay empty.
            const macro = sstep(0.48, 0.74, valueNoise3(dx * 1.1 + 7, dirY * 1.1 + 2, dz * 1.1, iSeed ^ 0x5bd1));
            const rose = sstep(0.50, 0.80, fbm3(dx * 2.2, dirY * 2.2, dz * 2.2, 3, iSeed)) * macro;
            const tealGate = valueNoise3(dx * 0.9 + 31, dirY * 0.9 + 17, dz * 0.9, iSeed ^ 0x9e37);
            const tealMacro = sstep(0.50, 0.76, tealGate);
            const tealField = fbm3(dx * 2.0 + 23, dirY * 2.0, dz * 2.0 + 11, 3, iSeed ^ 0x2545);
            const teal = sstep(0.50, 0.80, tealField) * tealMacro;
            // Kept faint: magnified on screen and desaturated by the dome material, brighter
            // values read as grey out-of-focus smudges behind the gas.
            r += 0.055 * rose + 0.010 * teal;
            g += 0.018 * rose + 0.040 * teal;
            b += 0.048 * rose + 0.062 * teal;

            const o = (iy * width + ix) * 4;
            data[o] = Math.min(255, Math.round(r * 255));
            data[o + 1] = Math.min(255, Math.round(g * 255));
            data[o + 2] = Math.min(255, Math.round(b * 255));
            data[o + 3] = 255;
        }
    }
}

/**
 * The whole field in one call (the worker's job, and the one-shot bake's).
 * @param {object} [options] COSMIC_BACKDROP_DEFAULTS overrides
 * @returns {Uint8Array} RGBA8, width x height
 */
export function bakeCosmicBackdropData(options = {}) {
    const o = resolveCosmicBackdropOptions(options);
    const data = new Uint8Array(o.width * o.height * 4);
    bakeCosmicBackdropRows(data, o, 0, o.height);
    return data;
}

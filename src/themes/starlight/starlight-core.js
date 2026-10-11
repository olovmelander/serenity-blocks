/**
 * Starlight — the numbers of the scene (CPU only, three-free).
 *
 * The lens stands on a mirror-flat lake at night and looks north (−Z), a little upward. The
 * sky turns round a pole that stands WORLD.poleAlt above the horizon; every star is kept in
 * polar coordinates about it (ρ = distance from the pole, θ = angle round it), so the sky's
 * turning, and a star's trail, are one angle.
 *
 * Three frames:
 *   world      x east (right), y up, z south. Meteors, the ridges, the water.
 *   sky        z = the pole, x = toward the zenith from the pole at sky angle 0, y = west of it.
 *              A sky direction (ρ, θ) has world direction
 *              P·cos ρ + (E1·cos(θ + skyAngle) + E2·sin(θ + skyAngle))·sin ρ.
 *   galactic   the Milky Way's own: longitude l along the band (0 = the core), latitude b.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const WORLD = Object.freeze({
    /** The lens above the water, metres. */
    eye: 2.2,
    /** The pole above the horizon. */
    poleAlt: 25 * DEG,
    /** Screen x the pole is stood at when the card leaves free space on its left. */
    poleScreenX: 0.2,
    /** Stars are kept out to this distance from the pole: farther ones never enter the frame. */
    cap: 84 * DEG,
    /** The radius everything in the sky is drawn at. */
    skyRadius: 4000,
    /** Where the shower's meteors come from (world azimuth from north, altitude). */
    radiantAz: 62 * DEG,
    radiantAlt: 58 * DEG,
});

/** The sky's own turn: once round the pole in this many seconds (an hour of sky a minute). */
export const SKY_TURN_SECONDS = 1440;
export const SKY_RATE = TAU / SKY_TURN_SECONDS;
/** A level-up carries the sky one hour on at once; a T-spin whirls it this far. */
export const HOUR_SWING = 15 * DEG;
export const TSPIN_SWING = 22 * DEG;
/** The longest trail a chain can open, radians round the pole. */
export const EXPOSURE_MAX = 40 * DEG;

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth01 = (t) => {
    const k = clamp01(t);
    return k * k * (3 - 2 * k);
};
/** Frame-rate independent ease factor: the share of the gap closed in `dt` at `rate` per second. */
export const approach = (rate, dt) => 1 - Math.exp(-rate * Math.max(0, dt));

export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A CSS hex colour → linear RGB in `out` (three numbers). Returns false if it is not a hex. */
export function hexToLinear(hex, out) {
    if (typeof hex !== 'string') return false;
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return false;
    const v = Number.parseInt(m[1], 16);
    for (let i = 0; i < 3; i += 1) {
        const c = ((v >> (16 - i * 8)) & 255) / 255;
        out[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }
    return true;
}

// ── The pole's frame ─────────────────────────────────────────────────────────────

/**
 * The pole at world azimuth `az` (radians east of north) and altitude `alt`, and the two unit
 * vectors across it: e1 toward the zenith, e2 to the west, so an angle round the pole grows the
 * way the real northern sky turns (anticlockwise, seen from below).
 */
export function poleFrame(az, alt, out = {}) {
    const p = out.p || (out.p = [0, 0, 0]);
    const e1 = out.e1 || (out.e1 = [0, 0, 0]);
    const e2 = out.e2 || (out.e2 = [0, 0, 0]);
    const ca = Math.cos(alt);
    p[0] = Math.sin(az) * ca;
    p[1] = Math.sin(alt);
    p[2] = -Math.cos(az) * ca;
    // Up, less its share along the pole.
    const d = p[1];
    let x = -p[0] * d;
    let y = 1 - p[1] * d;
    let z = -p[2] * d;
    const n = Math.hypot(x, y, z) || 1;
    x /= n;
    y /= n;
    z /= n;
    e1[0] = x;
    e1[1] = y;
    e1[2] = z;
    // e2 = e1 × p
    e2[0] = y * p[2] - z * p[1];
    e2[1] = z * p[0] - x * p[2];
    e2[2] = x * p[1] - y * p[0];
    return out;
}

/** A sky direction (ρ, θ + skyAngle) → world, into `out` (three numbers). */
export function skyToWorld(frame, rho, angle, out = [0, 0, 0]) {
    const c = Math.cos(rho);
    const s = Math.sin(rho);
    const ca = Math.cos(angle) * s;
    const sa = Math.sin(angle) * s;
    for (let i = 0; i < 3; i += 1) out[i] = frame.p[i] * c + frame.e1[i] * ca + frame.e2[i] * sa;
    return out;
}

/** A world direction → (ρ, angle round the pole, which still holds the sky angle), into `out`. */
export function worldToSky(frame, d, out = [0, 0]) {
    const c = clamp(d[0] * frame.p[0] + d[1] * frame.p[1] + d[2] * frame.p[2], -1, 1);
    const x = d[0] * frame.e1[0] + d[1] * frame.e1[1] + d[2] * frame.e1[2];
    const y = d[0] * frame.e2[0] + d[1] * frame.e2[1] + d[2] * frame.e2[2];
    out[0] = Math.acos(c);
    out[1] = Math.atan2(y, x);
    return out;
}

// ── The Milky Way ────────────────────────────────────────────────────────────────

/**
 * The band passes this close to the pole, and its core lies only a little way along it from
 * there: the heart of the Milky Way circles the pole star, always near the frame, and its two
 * arms sweep the rest of the sky like the hands of a clock.
 */
const BAND_OFFSET = 8 * DEG;
const CORE_ALONG = 4 * DEG;
/** Where the sky stands when the night's clock reads zero. */
export const SKY_START = -28 * DEG;

/**
 * The galaxy's frame in sky coordinates: `north` (its pole), `centre` (longitude 0) and `east`
 * (longitude 90°), all unit, mutually perpendicular.
 */
export const GALAXY = (() => {
    const sin = Math.sin(BAND_OFFSET);
    const cos = Math.cos(BAND_OFFSET);
    const north = [cos, 0, sin];
    // The band's point nearest the pole, and the direction along the band there (east).
    const near = [-sin, 0, cos];
    const along = [0, -1, 0];
    const cc = Math.cos(CORE_ALONG);
    const cs = Math.sin(CORE_ALONG);
    const centre = [near[0] * cc + along[0] * cs, near[1] * cc + along[1] * cs, near[2] * cc + along[2] * cs];
    const east = [
        north[1] * centre[2] - north[2] * centre[1],
        north[2] * centre[0] - north[0] * centre[2],
        north[0] * centre[1] - north[1] * centre[0],
    ];
    return Object.freeze({
        north: Object.freeze(north), centre: Object.freeze(centre), east: Object.freeze(east),
    });
})();

/** A sky direction (ρ, θ) → galactic (l, b), into `out`. */
export function skyToGalactic(rho, theta, out = [0, 0]) {
    const s = Math.sin(rho);
    const x = s * Math.cos(theta);
    const y = s * Math.sin(theta);
    const z = Math.cos(rho);
    const { north, centre, east } = GALAXY;
    const gz = clamp(x * north[0] + y * north[1] + z * north[2], -1, 1);
    const gx = x * centre[0] + y * centre[1] + z * centre[2];
    const gy = x * east[0] + y * east[1] + z * east[2];
    out[0] = Math.atan2(gy, gx);
    out[1] = Math.asin(gz);
    return out;
}

/** The band's shape. The shader evaluates the same expressions (starlight-sky.js). */
export const BAND = Object.freeze({
    /** Half-thickness of the disc, radians: `thin` everywhere, `thin + swell` at the core. */
    thin: 0.066,
    swell: 0.07,
    swellWidth: 0.75,
    /** How much of the core's brightness the far side of the disc keeps. */
    floor: 0.46,
    falloff: 1.3,
    /** A wide faint skirt under the bright spine: its share, and how many thicknesses wide. */
    skirt: 0.2,
    skirtWidth: 3.2,
    /** Star clouds along the two arms: (longitude, half-width, brightness) each. */
    armA: Object.freeze([0.86, 0.34, 0.42]),
    armB: Object.freeze([-1.02, 0.4, 0.46]),
    /** The bulge: brightness, half-widths along and across the band. */
    bulge: 1.1,
    bulgeL: 0.3,
    bulgeB: 0.165,
    /** The band's slow wave about its own plane. */
    warp: 0.03,
});

const gauss = (x) => Math.exp(-x * x);

/** The Milky Way's light at (l, b) before dust: the disc, its star clouds and the bulge. 0..~2. */
export function bandLight(l, b) {
    const bb = b + BAND.warp * Math.sin(2 * l + 0.7);
    const thick = BAND.thin + BAND.swell * gauss(l / BAND.swellWidth);
    const along = BAND.floor + (1 - BAND.floor) * gauss(l / BAND.falloff)
        + BAND.armA[2] * gauss((l - BAND.armA[0]) / BAND.armA[1])
        + BAND.armB[2] * gauss((l - BAND.armB[0]) / BAND.armB[1]);
    const spine = (1 - BAND.skirt) * Math.exp(-Math.abs(bb) / thick)
        + BAND.skirt * gauss(bb / (thick * BAND.skirtWidth));
    const bulge = BAND.bulge * Math.exp(-((l / BAND.bulgeL) ** 2) - ((bb / BAND.bulgeB) ** 2));
    return spine * along + bulge;
}

// ── The noise the sky is cut from ────────────────────────────────────────────────

export const NOISE_SIZE = 256;

/**
 * Four periodic fBm gradient-noise fields, one per channel, each stretched to 0..1. R and G
 * start at four cells a tile (the dust lanes, the star clouds), B at eight, A at sixteen (the
 * fine grain).
 * @returns {Uint8Array} size × size × 4
 */
export function bakeNoise(seed = 1610, size = NOISE_SIZE) {
    const n = size;
    const rand = mulberry32(seed);
    const data = new Uint8Array(n * n * 4);
    const field = new Float32Array(n * n);
    const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);
    const first = [4, 4, 8, 16];
    for (let c = 0; c < 4; c += 1) {
        field.fill(0);
        let amp = 1;
        for (let o = 0; o < 5; o += 1) {
            const period = first[c] << o;
            if (period > n / 2) break;
            const gx = new Float32Array(period * period);
            const gy = new Float32Array(period * period);
            for (let i = 0; i < gx.length; i += 1) {
                const a = rand() * TAU;
                gx[i] = Math.cos(a);
                gy[i] = Math.sin(a);
            }
            const scale = period / n;
            for (let y = 0; y < n; y += 1) {
                const fy = y * scale;
                const y0 = Math.floor(fy);
                const ty = fy - y0;
                const y1 = (y0 + 1) % period;
                const sy = fade(ty);
                for (let x = 0; x < n; x += 1) {
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
        for (let i = 0; i < field.length; i += 1) {
            if (field[i] < lo) lo = field[i];
            if (field[i] > hi) hi = field[i];
        }
        const inv = 255 / Math.max(1e-6, hi - lo);
        for (let i = 0; i < field.length; i += 1) data[i * 4 + c] = Math.round((field[i] - lo) * inv);
    }
    return data;
}

/** The baked noise read on the CPU the way the GPU reads it (bilinear, repeating). 0..1. */
export function sampleNoise(data, u, v, channel, size = NOISE_SIZE) {
    const fx = (u - Math.floor(u)) * size - 0.5;
    const fy = (v - Math.floor(v)) * size - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const xa = ((x0 % size) + size) % size;
    const xb = (xa + 1) % size;
    const ya = ((y0 % size) + size) % size;
    const yb = (ya + 1) % size;
    const a = data[(ya * size + xa) * 4 + channel];
    const b = data[(ya * size + xb) * 4 + channel];
    const c = data[(yb * size + xa) * 4 + channel];
    const d = data[(yb * size + xb) * 4 + channel];
    return (a + (b - a) * tx + (c + (d - c) * tx - (a + (b - a) * tx)) * ty) / 255;
}

/** How the dust lanes are laid over the band: the shader reads the same numbers. */
export const DUST = Object.freeze({
    /** The long lanes: noise tiles round the whole band, and per radian of latitude. */
    tilesL: 6,
    tilesB: 1.6,
    /** The filaments torn off them. */
    fineL: 19,
    fineB: 4.6,
    warp: 0.16,
    bend: 0.3,
    /** The lanes keep to the plane: half-width of their share, radians. */
    reach: 0.15,
    /** The Great Rift: a lane along the plane's own line, widest at the core. */
    rift: 0.3,
    riftWidth: 0.03,
    /** The rift is there for about half the band's length: tiles of its on-and-off round the band. */
    riftTiles: 3,
    lo: 0.51,
    hi: 0.73,
});

/** The dust in front of the band at (l, b): 0 = clear, 1 = a dark lane. */
export function dustAt(noise, l, b) {
    const u = l / TAU;
    // The lanes are bent by the same broad field that mottles the band.
    const bend = sampleNoise(noise, u * 5 + 0.4, b * 1.1 + 0.8, 0) - 0.5;
    const n1 = sampleNoise(noise, u * DUST.tilesL + bend * DUST.bend, b * DUST.tilesB + 0.37 + bend * DUST.bend, 1);
    const n2 = sampleNoise(noise, u * DUST.fineL + n1 * DUST.warp, b * DUST.fineB + 0.11, 2);
    const line = b - 0.014 - 0.024 * Math.sin(3 * l + 1.1);
    // …and always across the core, where it splits the bulge.
    const there = Math.max(
        smooth01((sampleNoise(noise, u * DUST.riftTiles, 0.15, 0) - 0.4) / 0.2),
        Math.exp(-((l / 0.45) ** 2)),
    );
    const rift = DUST.rift * Math.exp(-((line / DUST.riftWidth) ** 2)) * there;
    const field = n1 * 0.6 + n2 * 0.4 + rift;
    const lane = smooth01((field - DUST.lo) / (DUST.hi - DUST.lo));
    return lane * Math.exp(-((b / DUST.reach) ** 2));
}

// ── The star catalogue ───────────────────────────────────────────────────────────

/** The faintest and the brightest star kept (magnitudes: smaller is brighter). */
export const MAG_FAINT = 7.2;
export const MAG_BRIGHT = -0.6;

/**
 * The sky's stars, brightest first. Each star is four numbers in `polar` (cos ρ, sin ρ, θ,
 * magnitude) and four in `look` (colour temperature 0 = ember … 1 = blue, twinkle phase,
 * twinkle rate, a random number). They crowd toward the Milky Way and keep out of its dust.
 *
 * @param {number} count
 * @param {Uint8Array} noise the baked noise (bakeNoise), for the dust
 * @param {number} [seed]
 */
export function generateCatalog(count, noise, seed = 20261011) {
    const rand = mulberry32(seed);
    const stars = [];
    const gal = [0, 0];
    const capCos = Math.cos(WORLD.cap);
    // Counts roughly triple per magnitude: N(<m) ∝ 10^(0.5 m).
    const span = 10 ** (0.5 * (MAG_BRIGHT - MAG_FAINT));
    const magnitude = () => MAG_FAINT + Math.log10(rand() * (1 - span) + span) / 0.5;

    // The pole star: a little off the pole, so it draws its own small circle.
    stars.push({
        rho: 0.75 * DEG, theta: 2.1, mag: 0.6, temp: 0.46, anchor: true,
    });
    // A handful of anchors: the sky's brightest, set where the frame will find them.
    const anchors = [
        [14, 0.4, -0.3, 0.9], [22, 2.6, 0.2, 0.15], [31, 4.4, -0.5, 0.75], [38, 1.3, 0.0, 0.55],
        [47, 5.5, 0.3, 0.2], [26, 3.5, 0.5, 0.85], [55, 0.9, 0.4, 0.3], [44, 2.9, -0.1, 0.7],
        [61, 4.0, 0.6, 0.5], [35, 5.9, 0.1, 0.92], [18, 4.9, 0.9, 0.62], [52, 1.9, 0.7, 0.1],
    ];
    anchors.forEach(([rhoDeg, theta, mag, temp]) => stars.push({
        rho: rhoDeg * DEG, theta, mag, temp, anchor: true,
    }));

    let guard = count * 60;
    while (stars.length < count && guard > 0) {
        guard -= 1;
        // Uniform on the cap round the pole.
        const cosRho = 1 - rand() * (1 - capCos);
        const rho = Math.acos(cosRho);
        const theta = rand() * TAU;
        skyToGalactic(rho, theta, gal);
        const light = bandLight(gal[0], gal[1]);
        const dust = dustAt(noise, gal[0], gal[1]);
        const mag = magnitude();
        // Faint stars follow the band closely and vanish behind its dust; bright ones (near
        // ones) are spread over the whole sky.
        const faint = smooth01((mag - 2.5) / 3.5);
        const crowd = lerp(0.6, 0.3 + 0.95 * Math.min(1.4, light) * (1 - 0.9 * dust), faint);
        if (rand() * 1.6 > crowd) continue;
        // The bulge is old and yellow, the disc young and blue; a bright star is either.
        const inBulge = Math.exp(-((gal[0] / 0.36) ** 2) - ((gal[1] / 0.2) ** 2));
        let temp = 0.34 + rand() * 0.5 + (rand() - 0.5) * 0.3;
        temp = lerp(temp, 0.12 + rand() * 0.3, inBulge * 0.75);
        if (mag < 2.2 && rand() < 0.3) temp = rand() * 0.16;
        if (mag < 2.2 && rand() < 0.28) temp = 0.86 + rand() * 0.14;
        stars.push({
            rho, theta, mag, temp: clamp01(temp), anchor: false,
        });
    }
    stars.sort((a, b) => a.mag - b.mag);
    const n = stars.length;
    const polar = new Float32Array(n * 4);
    const look = new Float32Array(n * 4);
    for (let i = 0; i < n; i += 1) {
        const s = stars[i];
        polar[i * 4] = Math.cos(s.rho);
        polar[i * 4 + 1] = Math.sin(s.rho);
        polar[i * 4 + 2] = s.theta;
        polar[i * 4 + 3] = s.mag;
        look[i * 4] = s.temp;
        look[i * 4 + 1] = rand() * TAU;
        look[i * 4 + 2] = 2.2 + rand() * 5.5;
        look[i * 4 + 3] = rand();
    }
    return { count: n, polar, look };
}

// ── The hours ────────────────────────────────────────────────────────────────────

/**
 * The night's light. Scene-linear colours, authored through the post's tone map. They stand in
 * hue order round the wheel (indigo → emerald → gold → rose → violet → cobalt → indigo), so
 * two neighbours never mix through grey.
 *
 * zenith, mid, horizon   the air: overhead, a third of the way up, and the glow on the horizon
 * airglow                the banded glow low in the sky
 * band, core             the Milky Way's disc and its bulge
 * nebula                 the emission clouds along it
 * water                  the lake's own colour where it does not mirror
 * ridge                  the far hills
 * line                   a constellation's lines
 * meteor                 a shooting star's head
 * bandPower              how strongly the Milky Way shows through this hour's air
 * starPower              the same for the stars
 * glowHeight             how high the horizon's glow reaches (radians of altitude)
 */
export const PALETTE_KEYS = Object.freeze([
    'zenith', 'mid', 'horizon', 'airglow', 'band', 'core', 'nebula', 'water', 'ridge', 'line', 'meteor',
]);
export const PALETTE_SCALARS = Object.freeze(['bandPower', 'starPower', 'glowHeight']);

export const PALETTES = Object.freeze([
    Object.freeze({
        name: 'deep night',
        zenith: [0.0035, 0.0055, 0.016],
        mid: [0.0043, 0.0068, 0.019],
        horizon: [0.034, 0.052, 0.105],
        airglow: [0.0072, 0.024, 0.02],
        band: [0.56, 0.68, 1.0],
        core: [1.0, 0.76, 0.48],
        nebula: [1.0, 0.24, 0.42],
        water: [0.003, 0.006, 0.014],
        ridge: [0.004, 0.006, 0.013],
        line: [0.56, 0.74, 1.0],
        meteor: [0.7, 1.0, 0.9],
        bandPower: 1.0,
        starPower: 1.0,
        glowHeight: 0.11,
    }),
    Object.freeze({
        name: 'airglow',
        zenith: [0.003, 0.0075, 0.013],
        mid: [0.0037, 0.011, 0.014],
        horizon: [0.022, 0.1, 0.07],
        airglow: [0.021, 0.1, 0.051],
        band: [0.6, 0.86, 0.9],
        core: [1.0, 0.86, 0.52],
        nebula: [1.0, 0.3, 0.36],
        water: [0.002, 0.008, 0.01],
        ridge: [0.003, 0.008, 0.009],
        line: [0.5, 1.0, 0.8],
        meteor: [0.6, 1.0, 0.7],
        bandPower: 0.95,
        starPower: 1.0,
        glowHeight: 0.14,
    }),
    Object.freeze({
        name: 'first light',
        zenith: [0.006, 0.0105, 0.024],
        mid: [0.0099, 0.016, 0.025],
        horizon: [0.4, 0.25, 0.085],
        airglow: [0.042, 0.051, 0.018],
        band: [0.74, 0.78, 0.9],
        core: [1.0, 0.82, 0.5],
        nebula: [1.0, 0.36, 0.3],
        water: [0.006, 0.009, 0.014],
        ridge: [0.012, 0.01, 0.01],
        line: [1.0, 0.86, 0.52],
        meteor: [1.0, 0.94, 0.66],
        bandPower: 0.72,
        starPower: 0.86,
        glowHeight: 0.085,
    }),
    Object.freeze({
        name: 'afterglow',
        zenith: [0.01, 0.0085, 0.03],
        mid: [0.016, 0.011, 0.029],
        horizon: [0.34, 0.115, 0.13],
        airglow: [0.054, 0.018, 0.042],
        band: [0.82, 0.7, 0.94],
        core: [1.0, 0.74, 0.56],
        nebula: [1.0, 0.26, 0.5],
        water: [0.008, 0.006, 0.016],
        ridge: [0.014, 0.007, 0.014],
        line: [1.0, 0.62, 0.72],
        meteor: [1.0, 0.8, 0.78],
        bandPower: 0.76,
        starPower: 0.88,
        glowHeight: 0.09,
    }),
    Object.freeze({
        name: 'zodiacal',
        zenith: [0.007, 0.0045, 0.021],
        mid: [0.0099, 0.0056, 0.024],
        horizon: [0.085, 0.04, 0.15],
        airglow: [0.036, 0.013, 0.066],
        band: [0.78, 0.66, 1.0],
        core: [1.0, 0.76, 0.66],
        nebula: [1.0, 0.22, 0.62],
        water: [0.005, 0.004, 0.015],
        ridge: [0.007, 0.004, 0.014],
        line: [0.8, 0.62, 1.0],
        meteor: [0.86, 0.8, 1.0],
        bandPower: 0.96,
        starPower: 1.0,
        glowHeight: 0.13,
    }),
    Object.freeze({
        name: 'blue hour',
        zenith: [0.0065, 0.015, 0.046],
        mid: [0.0087, 0.021, 0.052],
        horizon: [0.05, 0.15, 0.33],
        airglow: [0.012, 0.042, 0.072],
        band: [0.6, 0.76, 1.0],
        core: [0.96, 0.84, 0.66],
        nebula: [0.9, 0.3, 0.6],
        water: [0.004, 0.011, 0.028],
        ridge: [0.004, 0.01, 0.024],
        line: [0.5, 0.8, 1.0],
        meteor: [0.66, 0.92, 1.0],
        bandPower: 0.8,
        starPower: 0.9,
        glowHeight: 0.12,
    }),
]);

/**
 * The clock alone carries the light one hour on in this many seconds, whatever the level: a
 * level-up is a step added on top (starlight-world.js: wheel = clock / HOUR_SECONDS + level − 1),
 * never the only thing that moves it.
 */
export const HOUR_SECONDS = 100;
/**
 * The share of a step the light rests on an hour before it leaves, and again when it reaches the
 * next. Small on purpose: for the other 70 % of every step the light is visibly on its way.
 */
export const HOUR_REST = 0.15;

/**
 * The light at wheel position `wheel` (one unit per palette, wraps): a short rest on the hour,
 * a long slow turn into the next, a short rest there. Writes every colour (arrays of three) and
 * scalar into `out` and returns it.
 */
export function paletteAt(wheel, out = {}) {
    const n = PALETTES.length;
    const w = ((wheel % n) + n) % n;
    const i = Math.floor(w) % n;
    const f = w - Math.floor(w);
    const k = smooth01((f - HOUR_REST) / (1 - 2 * HOUR_REST));
    const a = PALETTES[i];
    const b = PALETTES[(i + 1) % n];
    for (let c = 0; c < PALETTE_KEYS.length; c += 1) {
        const key = PALETTE_KEYS[c];
        const dst = out[key] || (out[key] = [0, 0, 0]);
        for (let j = 0; j < 3; j += 1) dst[j] = lerp(a[key][j], b[key][j], k);
    }
    for (let c = 0; c < PALETTE_SCALARS.length; c += 1) {
        const key = PALETTE_SCALARS[c];
        out[key] = lerp(a[key], b[key], k);
    }
    out.index = i;
    out.turn = k;
    return out;
}

// ── The chain ────────────────────────────────────────────────────────────────────

/** How far the shutter is open for a chain of `combo` clears: 0 at rest, toward 1. */
export function shutterFor(combo) {
    const n = Math.max(0, (combo || 0) - 1);
    // A slow start: two clears in a row draw a short trail, eight a long one.
    return 1 - Math.exp(-((n / 4.5) ** 1.5));
}

// ── The constellations ───────────────────────────────────────────────────────────

/** Stars and lines one figure can have, and figures the sky keeps at once. */
export const FIGURE_STARS = 10;
export const FIGURE_LINES = 10;
export const FIGURES_KEPT = 6;
/** Lines a cleared row draws. */
export const LINES_PER_ROW = 2;

/**
 * The figures, in a unit frame (x right, y up). A star is (x, y, weight): weight 1 is the
 * figure's brightest. Lines are pairs of star indices, in the order they are drawn; a star is
 * kindled in the order it is listed.
 */
export const FIGURES = Object.freeze([
    {
        name: 'the plough',
        stars: [
            [0.95, 0.3, 1], [0.88, -0.14, 0.85], [0.38, -0.24, 0.8], [0.28, 0.16, 0.6],
            [-0.14, 0.28, 0.95], [-0.56, 0.4, 0.9], [-1.0, 0.12, 0.9],
        ],
        lines: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]],
    },
    {
        name: 'the hunter',
        stars: [
            [-0.5, 0.72, 1], [0.46, 0.66, 0.85], [-0.17, 0.0, 0.8], [0.0, 0.06, 0.85], [0.17, 0.13, 0.75],
            [-0.42, -0.8, 0.75], [0.56, -0.74, 1], [0.0, 1.0, 0.55],
        ],
        lines: [[7, 0], [7, 1], [0, 2], [1, 4], [2, 3], [3, 4], [2, 5], [4, 6]],
    },
    {
        name: 'the queen',
        stars: [[-1.0, 0.3, 0.8], [-0.5, -0.32, 0.9], [0.0, 0.16, 1], [0.5, -0.38, 0.85], [1.0, 0.34, 0.75]],
        lines: [[0, 1], [1, 2], [2, 3], [3, 4]],
    },
    {
        name: 'the swan',
        stars: [
            [0.0, 1.0, 1], [0.0, 0.36, 0.85], [0.0, -0.32, 0.6], [0.0, -1.0, 0.8],
            [-0.92, 0.14, 0.75], [0.88, 0.5, 0.75],
        ],
        lines: [[0, 1], [1, 2], [2, 3], [4, 1], [1, 5]],
    },
    {
        name: 'the lyre',
        stars: [
            [-0.12, 1.0, 1], [0.36, 0.78, 0.55], [0.14, 0.44, 0.6], [0.6, 0.34, 0.6],
            [0.5, -0.6, 0.75], [0.04, -0.5, 0.75],
        ],
        lines: [[0, 1], [0, 2], [1, 2], [2, 3], [3, 4], [4, 5], [5, 2]],
    },
    {
        name: 'the lion',
        stars: [
            [0.74, -0.46, 1], [0.7, -0.06, 0.6], [0.5, 0.24, 0.85], [0.6, 0.6, 0.6], [0.86, 0.8, 0.55],
            [1.0, 0.58, 0.6], [-0.5, 0.2, 0.75], [-0.5, -0.2, 0.65], [-1.0, -0.26, 0.9],
        ],
        lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [2, 6], [6, 8], [8, 7], [7, 0], [6, 7]],
    },
    {
        name: 'the scorpion',
        stars: [
            [0.94, 0.78, 0.7], [1.0, 0.44, 0.75], [0.56, 0.3, 1], [0.3, 0.0, 0.7], [0.1, -0.36, 0.7],
            [0.04, -0.7, 0.7], [-0.26, -0.9, 0.7], [-0.6, -0.86, 0.75], [-0.86, -0.6, 0.85], [-0.8, -0.3, 0.8],
        ],
        lines: [[0, 2], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9]],
    },
    {
        name: 'the winged horse',
        stars: [
            [-0.5, 0.5, 0.85], [0.5, 0.5, 0.9], [0.5, -0.5, 0.85], [-0.5, -0.5, 0.9],
            [-1.0, 0.82, 0.6], [-0.94, -0.76, 0.65], [-1.3, -0.54, 0.75], [1.05, 0.1, 0.6],
        ],
        lines: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [3, 5], [5, 6], [1, 7]],
    },
    {
        name: 'the eagle',
        stars: [
            [0.0, 0.0, 1], [-0.13, 0.24, 0.7], [0.13, -0.22, 0.6], [-0.86, -0.26, 0.7],
            [0.76, 0.5, 0.7], [-0.36, -0.9, 0.65], [0.3, 0.86, 0.6],
        ],
        lines: [[1, 0], [0, 2], [6, 1], [2, 5], [0, 3], [0, 4]],
    },
    {
        name: 'the crown',
        stars: [
            [-1.0, 0.3, 0.6], [-0.78, -0.22, 0.65], [-0.36, -0.56, 0.75], [0.12, -0.62, 1],
            [0.58, -0.42, 0.7], [0.9, -0.02, 0.65], [1.0, 0.44, 0.6],
        ],
        lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]],
    },
    {
        name: 'the twins',
        stars: [
            [-0.3, 1.0, 0.95], [0.3, 0.9, 1], [-0.36, 0.4, 0.6], [-0.46, -0.2, 0.6], [-0.6, -0.9, 0.7],
            [0.3, 0.3, 0.6], [0.3, -0.3, 0.6], [0.2, -0.96, 0.75],
        ],
        lines: [[0, 1], [0, 2], [2, 3], [3, 4], [1, 5], [5, 6], [6, 7], [2, 5]],
    },
    {
        name: 'the herdsman',
        stars: [
            [0.0, -1.0, 1], [-0.46, -0.2, 0.65], [0.4, -0.1, 0.7], [-0.36, 0.6, 0.65], [0.3, 0.7, 0.65],
            [0.0, 1.06, 0.6],
        ],
        lines: [[0, 1], [0, 2], [1, 3], [2, 4], [3, 5], [4, 5]],
    },
    {
        name: 'the archer',
        stars: [
            [-0.4, -0.5, 0.8], [0.4, -0.56, 0.9], [0.56, 0.0, 0.85], [-0.36, 0.04, 0.75], [0.1, 0.5, 0.75],
            [-0.9, -0.1, 0.7], [1.0, -0.3, 0.7],
        ],
        lines: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 2], [3, 5], [5, 0], [2, 6], [6, 1]],
    },
    {
        name: 'the dolphin',
        stars: [
            [0.0, 0.3, 0.8], [0.3, 0.56, 0.75], [0.6, 0.3, 0.8], [0.3, 0.04, 0.7], [-0.22, -0.3, 0.65],
            [-0.52, -0.82, 0.7],
        ],
        lines: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5]],
    },
]);

/** The order the figures are drawn in for a session: a shuffle that never repeats a neighbour. */
export function figureOrder(seed = 1) {
    const rand = mulberry32(seed);
    const order = FIGURES.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        const t = order[i];
        order[i] = order[j];
        order[j] = t;
    }
    return order;
}

// ── Shooting stars ───────────────────────────────────────────────────────────────

/** Streak kinds (the table's fourth row, x). */
export const STREAK = Object.freeze({ meteor: 0, fireball: 1, mote: 2 });

/** A unit world direction for azimuth (east of north) and altitude. */
export function horizontal(az, alt, out = [0, 0, 0]) {
    const c = Math.cos(alt);
    out[0] = Math.sin(az) * c;
    out[1] = Math.sin(alt);
    out[2] = -Math.cos(az) * c;
    return out;
}

/** The point `t` of the way from unit `a` to unit `b` along their great circle, into `out`. */
export function slerp(a, b, t, out = [0, 0, 0]) {
    const dot = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1);
    const angle = Math.acos(dot);
    if (angle < 1e-5) {
        out[0] = a[0];
        out[1] = a[1];
        out[2] = a[2];
        return out;
    }
    const s = Math.sin(angle);
    const ka = Math.sin((1 - t) * angle) / s;
    const kb = Math.sin(t * angle) / s;
    for (let i = 0; i < 3; i += 1) out[i] = a[i] * ka + b[i] * kb;
    return out;
}

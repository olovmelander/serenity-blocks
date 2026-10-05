/**
 * Deterministic CPU bakes for the Black Hole artwork: the accretion-gas texture the disk
 * shader advects, and the galaxy the hole bends. Nothing here touches three or the DOM, so
 * every bake is reproducible from its seed and testable in plain node.
 */

/** Small seeded generator (mulberry32) for placement and per-instance attributes. */
export function createRandom(seed = 1) {
    let state = seed >>> 0;
    return function random() {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Integer lattice hash → [0, 1). */
function hash3(ix, iy, iz, seed) {
    let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263)
        ^ Math.imul(iz | 0, 2147483647) ^ Math.imul(seed | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const wrap = (value, period) => (period > 0 ? ((value % period) + period) % period : value);
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smooth = (low, high, value) => {
    const t = clamp01((value - low) / (high - low));
    return t * t * (3 - 2 * t);
};

/** Smooth value noise in [0, 1]; a positive period wraps the lattice along that axis. */
export function valueNoise2(x, y, seed = 0, periodX = 0, periodY = 0) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const ux = fade(x - ix);
    const uy = fade(y - iy);
    const x0 = wrap(ix, periodX);
    const x1 = wrap(ix + 1, periodX);
    const y0 = wrap(iy, periodY);
    const y1 = wrap(iy + 1, periodY);
    const a = hash3(x0, y0, 0, seed);
    const b = hash3(x1, y0, 0, seed);
    const c = hash3(x0, y1, 0, seed);
    const d = hash3(x1, y1, 0, seed);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Smooth value noise in [0, 1] over three dimensions. */
export function valueNoise3(x, y, z, seed = 0) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const ux = fade(x - ix);
    const uy = fade(y - iy);
    const uz = fade(z - iz);
    // Written out rather than composed from helpers: the sky bake calls this ~2M times.
    const a0 = hash3(ix, iy, iz, seed);
    const b0 = hash3(ix + 1, iy, iz, seed);
    const c0 = hash3(ix, iy + 1, iz, seed);
    const d0 = hash3(ix + 1, iy + 1, iz, seed);
    const a1 = hash3(ix, iy, iz + 1, seed);
    const b1 = hash3(ix + 1, iy, iz + 1, seed);
    const c1 = hash3(ix, iy + 1, iz + 1, seed);
    const d1 = hash3(ix + 1, iy + 1, iz + 1, seed);
    const near = a0 + (b0 - a0) * ux + (c0 - a0) * uy + (a0 - b0 - c0 + d0) * ux * uy;
    const far = a1 + (b1 - a1) * ux + (c1 - a1) * uy + (a1 - b1 - c1 + d1) * ux * uy;
    return near + (far - near) * uz;
}

function fbm2(x, y, seed, octaves, periodX, periodY) {
    let amplitude = 1;
    let frequency = 1;
    let total = 0;
    let weight = 0;
    for (let octave = 0; octave < octaves; octave += 1) {
        total += amplitude * valueNoise2(
            x * frequency,
            y * frequency,
            seed + octave * 131,
            periodX * frequency,
            periodY * frequency,
        );
        weight += amplitude;
        amplitude *= 0.5;
        frequency *= 2;
    }
    return total / weight;
}

function fbm3(x, y, z, seed, octaves) {
    let amplitude = 1;
    let frequency = 1;
    let total = 0;
    let weight = 0;
    for (let octave = 0; octave < octaves; octave += 1) {
        total += amplitude * valueNoise3(x * frequency, y * frequency, z * frequency, seed + octave * 197);
        weight += amplitude;
        amplitude *= 0.5;
        frequency *= 2.03;
    }
    return total / weight;
}

/**
 * Accretion gas, RGBA8, tileable on both axes. `u` runs once around the disk; `v` runs from
 * the inner edge to the outer (the shader also reads a finer octave by repeating the tile).
 * Features are long in `u`, so the shader's Keplerian shear draws them out into trailing
 * lanes.
 *   R  broad lanes       G  fine streaks
 *   B  hot clumps        A  gaps between lanes (ridged)
 * Each channel is stretched to the full byte range so shader thresholds stay predictable.
 */
export function bakeDiskTexture(width = 512, height = 128, seed = 7919) {
    const channels = [
        {
            seed: seed + 11, periodX: 3, periodY: 9, octaves: 4,
        },
        {
            seed: seed + 523, periodX: 12, periodY: 44, octaves: 3,
        },
        {
            seed: seed + 1009, periodX: 14, periodY: 9, octaves: 2,
        },
        {
            seed: seed + 2203, periodX: 4, periodY: 13, octaves: 3, ridged: true,
        },
    ];
    const data = new Uint8Array(width * height * 4);
    const plane = new Float32Array(width * height);
    channels.forEach((channel, index) => {
        let low = Infinity;
        let high = -Infinity;
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                let value = fbm2(
                    (x / width) * channel.periodX,
                    (y / height) * channel.periodY,
                    channel.seed,
                    channel.octaves,
                    channel.periodX,
                    channel.periodY,
                );
                if (channel.ridged) value = 1 - Math.abs(value * 2 - 1);
                plane[y * width + x] = value;
                if (value < low) low = value;
                if (value > high) high = value;
            }
        }
        const scale = 255 / Math.max(1e-6, high - low);
        for (let i = 0; i < plane.length; i += 1) {
            data[i * 4 + index] = Math.round((plane[i] - low) * scale);
        }
    });
    return data;
}

/** Galactic frame, as unit vectors in the sky texture's own axes. */
const GALACTIC_POLE = [0.0, 1.0, 0.0];
const GALACTIC_CENTRE = [1.0, 0.0, 0.0];

const srgb = (linear) => {
    const c = clamp01(linear);
    return c <= 0.0031308 ? c * 12.92 : 1.055 * (c ** (1 / 2.4)) - 0.055;
};

/**
 * The galaxy the hole bends: an equirectangular RGBA8 panorama, sRGB-encoded. `u` is the
 * longitude around the galactic pole (+Y of the texture's frame), `v` runs pole to pole.
 * RGB is the unresolved glow — the band of the Milky Way, its bulge, dust lanes and a few
 * emission clouds. A is the local star density the shader scatters resolved stars by.
 *
 * Stars themselves are not baked: the lens magnifies the sky near the hole, and a baked
 * star would smear into a blob exactly where the eye is looking.
 */
export function bakeSkyTexture(width = 512, height = 256, seed = 1543) {
    const data = new Uint8Array(width * height * 4);
    bakeSkyRows(data, width, height, seed, 0, height);
    return data;
}

/** Bake rows [from, to) of the galaxy into `data`, so a caller can spread the work over frames. */
export function bakeSkyRows(data, width, height, seed, from, to) {
    for (let y = from; y < to; y += 1) {
        const polar = ((y + 0.5) / height) * Math.PI;
        const sinPolar = Math.sin(polar);
        const dy = Math.cos(polar);
        for (let x = 0; x < width; x += 1) {
            const longitude = ((x + 0.5) / width) * Math.PI * 2 - Math.PI;
            const dx = sinPolar * Math.cos(longitude);
            const dz = sinPolar * Math.sin(longitude);
            const latitude = Math.asin(dx * GALACTIC_POLE[0] + dy * GALACTIC_POLE[1] + dz * GALACTIC_POLE[2]);
            const towardCentre = dx * GALACTIC_CENTRE[0] + dy * GALACTIC_CENTRE[1] + dz * GALACTIC_CENTRE[2];
            const centreAngle = Math.acos(Math.max(-1, Math.min(1, towardCentre)));

            // The band wanders and swells a little along its length.
            const warp = fbm3(dx * 1.4 + 3.1, dy * 1.4, dz * 1.4 - 1.7, seed + 5, 2) - 0.5;
            const lat = latitude + warp * 0.16;
            const band = Math.exp(-((lat / 0.2) ** 2));
            const bulge = Math.exp(-((centreAngle / 0.3) ** 2) * (1 + 9 * lat * lat));
            const halo = Math.exp(-((lat / 0.62) ** 2));

            let r = 0.004;
            let g = 0.0045;
            let b = 0.0085;
            let density = 0.2 + halo * 0.3;
            if (halo > 0.012) {
                const clouds = fbm3(dx * 3.2, dy * 3.2, dz * 3.2, seed + 17, 5);
                const fine = fbm3(dx * 9.5 + 7, dy * 9.5, dz * 9.5 + 2, seed + 41, 3);
                const glow = band * (0.07 + 1.5 * clouds * clouds * clouds) * (0.6 + 0.8 * fine) + bulge * 0.5;
                // Dust hugs the mid-plane and cuts the glow into lanes.
                const lanes = 1 - Math.abs(fbm3(dx * 3.4 - 5, dy * 13, dz * 3.4 + 9, seed + 73, 4) * 2 - 1);
                const dust = smooth(0.66, 0.96, lanes) * Math.exp(-((lat / 0.1) ** 2)) * 0.78
                    + smooth(0.55, 0.85, fine) * Math.exp(-((lat / 0.14) ** 2)) * 0.3;
                const lit = glow * (1 - clamp01(dust));
                // Cool spiral-arm blue far from the centre, old-star gold in the bulge.
                const warm = clamp01(bulge * 1.5 + (0.5 - centreAngle / Math.PI) * 0.4);
                r += lit * (0.13 + 0.38 * warm);
                g += lit * (0.165 + 0.145 * warm);
                b += lit * (0.29 - 0.15 * warm);
                // Emission clouds: hydrogen rose and oxygen teal, a few knots each.
                const rose = smooth(0.66, 0.86, fbm3(dx * 2.3 + 11, dy * 2.3 - 4, dz * 2.3, seed + 97, 3));
                const teal = smooth(0.68, 0.88, fbm3(dx * 2.1 - 8, dy * 2.1, dz * 2.1 + 6, seed + 113, 3));
                const knots = Math.exp(-((lat / 0.24) ** 2)) * (0.45 + 0.55 * fine) * (1 - clamp01(dust) * 0.7);
                r += knots * (rose * 0.26 + teal * 0.008);
                g += knots * (rose * 0.03 + teal * 0.11);
                b += knots * (rose * 0.1 + teal * 0.15);
                // A violet wash off the plane keeps the dark sky from reading as flat black.
                const veil = halo * (0.35 + 0.65 * clouds);
                r += veil * 0.0035;
                g += veil * 0.002;
                b += veil * 0.009;
                density = 0.2 + halo * 0.3 + band * 0.75 * (1 - clamp01(dust) * 0.8) + bulge * 0.6;
            }
            const offset = (y * width + x) * 4;
            data[offset] = Math.round(srgb(r) * 255);
            data[offset + 1] = Math.round(srgb(g) * 255);
            data[offset + 2] = Math.round(srgb(b) * 255);
            data[offset + 3] = Math.round(clamp01(density) * 255);
        }
    }
}

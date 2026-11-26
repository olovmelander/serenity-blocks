/**
 * Deterministic CPU bakes for the Black Hole artwork: the accretion-gas texture the disk
 * shader advects, and the galaxy the hole bends. Nothing here touches three or the DOM, so
 * every bake is reproducible from its seed and testable in plain node.
 */
import { drainSteps, stepClock } from '../shared/build-steps.js';

/** How long one slice of the gas bake runs before it yields to the page (ms). */
const DISK_SLICE_MS = 8;

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
    return drainSteps(bakeDiskTextureSteps(width, height, seed));
}

/**
 * `bakeDiskTexture` as steps: the same bytes, yielding between rows once a slice has run
 * DISK_SLICE_MS. In one task it held a first visit's switch frame 28 ms (2026-10-31).
 * @returns {Generator<string, Uint8Array>}
 */
export function* bakeDiskTextureSteps(width = 512, height = 128, seed = 7919) {
    const clock = stepClock(DISK_SLICE_MS);
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
    // Roll patches of the shear layer into eddies before laying down its fibres.
    // Each vortex dies out inside its cell, so both tile seams stay continuous.
    const coord = new Float32Array(width * height * 2);
    for (let y = 0; y < height; y += 1) {
        const v = y / height;
        for (let x = 0; x < width; x += 1) {
            const u = x / width;
            const meander = valueNoise2(u * 6, v * 3, seed + 127, 6, 3) - 0.5;
            const stream = v + 0.065 * meander;
            const ax = u * 5;
            const ay = stream * 4;
            const ix = Math.floor(ax);
            const iy = Math.floor(ay);
            const dx = ax - ix - 0.5;
            const dy = ay - iy - 0.5;
            const falloff = clamp01(1 - (dx * dx + dy * dy) * 4.1);
            const spin = (hash3(ix, wrap(iy, 4), 1, seed) - 0.40) * 9 * falloff * falloff;
            const c = Math.cos(spin) - 1;
            const s = Math.sin(spin);
            const i = (y * width + x) * 2;
            coord[i] = u + (c * dx - s * dy) / 5;
            coord[i + 1] = stream + (s * dx + c * dy) / 4;
        }
        if (clock.due()) {
            yield 'gas';
            clock.restart();
        }
    }
    for (let index = 0; index < channels.length; index += 1) {
        const channel = channels[index];
        let low = Infinity;
        let high = -Infinity;
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const i = (y * width + x) * 2;
                let value = fbm2(
                    coord[i] * channel.periodX,
                    coord[i + 1] * channel.periodY,
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
            if (clock.due()) {
                yield 'gas';
                clock.restart();
            }
        }
        const scale = 255 / Math.max(1e-6, high - low);
        for (let i = 0; i < plane.length; i += 1) {
            data[i * 4 + index] = Math.round((plane[i] - low) * scale);
        }
    }
    return data;
}

/** Side of the white-noise lattice the sky's 3D noise is read from. */
export const LATTICE_SIZE = 256;
/** The offset between two z-slices of the lattice (the classic 37, 17). */
export const LATTICE_SLICE = Object.freeze([37, 17]);

/**
 * White noise for 3D value noise in one fetch, RGBA8: G holds R shifted by one z-slice and A
 * holds B shifted the same way, so `mix(rb, ga, fz)` read at `xy + SLICE · floor(z)` is the
 * trilinear blend of two independent fields. The sky reads it along the bent ray's direction:
 * a 3D field has no poles and no seam, and does not fan out round the Einstein ring the way a
 * panorama's rows do. Sampled at level 0 with bilinear filtering and repeat wrapping.
 */
export function bakeLattice(seed = 9917, size = LATTICE_SIZE) {
    const random = createRandom(seed);
    const r = new Uint8Array(size * size);
    const b = new Uint8Array(size * size);
    for (let i = 0; i < r.length; i += 1) {
        r[i] = Math.floor(random() * 256);
        b[i] = Math.floor(random() * 256);
    }
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
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

/** The CPU twin of the lens's `noise3` (both fields), for tests and for tuning thresholds. */
export function sampleLattice(data, x, y, z, size = LATTICE_SIZE) {
    const ease = (v) => v * v * (3 - 2 * v);
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const fx = ease(x - ix);
    const fy = ease(y - iy);
    const fz = ease(z - iz);
    const wrapped = (v) => ((v % size) + size) % size;
    const read = (cx, cy, cz, channel) => data[(wrapped(cy + LATTICE_SLICE[1] * cz) * size
        + wrapped(cx + LATTICE_SLICE[0] * cz)) * 4 + channel] / 255;
    const field = (channel) => {
        const slice = (cz) => {
            const a = read(ix, iy, cz, channel);
            const b = read(ix + 1, iy, cz, channel);
            const c = read(ix, iy + 1, cz, channel);
            const d = read(ix + 1, iy + 1, cz, channel);
            return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
        };
        const near = slice(iz);
        return near + (slice(iz + 1) - near) * fz;
    };
    return [field(0), field(2)];
}

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
        const latitude = Math.PI * 0.5 - polar;
        for (let x = 0; x < width; x += 1) {
            const longitude = ((x + 0.5) / width) * Math.PI * 2 - Math.PI;
            const dx = sinPolar * Math.cos(longitude);
            const dz = sinPolar * Math.sin(longitude);
            const centreAngle = Math.acos(Math.max(-1, Math.min(1, dx)));

            // The band wanders and swells a little along its length.
            const warp = fbm3(dx * 1.4 + 3.1, dy * 1.4, dz * 1.4 - 1.7, seed + 5, 2) - 0.5;
            const lat = latitude + warp * 0.16;
            const band = Math.exp(-((lat / 0.2) ** 2));
            const bulge = Math.exp(-((centreAngle / 0.3) ** 2) * (1 + 9 * lat * lat));
            const halo = Math.exp(-((lat / 0.62) ** 2));

            let r = 0.0016;
            let g = 0.0025;
            let b = 0.005;
            let density = 0.14 + halo * 0.26;
            const clouds = fbm3(dx * 3.2, dy * 3.2, dz * 3.2, seed + 17, 4);
            const fine = fbm3(dx * 9.5 + 7, dy * 9.5, dz * 9.5 + 2, seed + 41, 3);
            if (halo > 0.012) {
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
                density += band * 0.64 * (1 - clamp01(dust) * 0.85) + bulge * 0.45;
            }

            // Three stellar nurseries at different longitudes and latitudes. The light catches
            // the broken outside of each cavity. Inside, the same dust occludes the old stars.
            const wall = Math.max(
                -0.57 * dx + 0.46 * dy - 0.68 * dz - 0.85,
                0.82 * dx - 0.39 * dy + 0.42 * dz - 0.74,
                -0.46 * dx - 0.54 * dy + 0.70 * dz - 0.80,
            ) + (clouds - 0.5) * 0.68 + (fine - 0.5) * 0.20;
            const cavity = smooth(-0.016, 0.19, wall) * (0.53 + 0.23 * fine);
            const edge = (wall + 0.019) / 0.035;
            const shoulder = (wall + 0.055) / 0.116;
            const exposed = smooth(0.27, 0.67, clouds * 0.67 + fine * 0.33 + dz * 0.115 - dy * 0.07);
            const rim = Math.exp(-edge * edge) * exposed * (0.3 + 0.9 * fine);
            const reflection = Math.exp(-shoulder * shoulder) * exposed;
            // An oblique sheet threads the bubbles. Its dust splits lengthwise into ragged
            // backlit pillars. Their branch tips, cold sides and shaded bases survive at Low.
            const dustPlane = 0.19 * dx + 0.80 * dy + 0.57 * dz + 0.38 * dx * dz
                + (clouds - 0.5) * 0.7 + (fine - 0.5) * 0.19;
            const bank = Math.exp(-(((dustPlane + 0.036) / 0.27) ** 2));
            const stratum = fbm3(dx * 9.2 - dy * 3.7, dy * 7.8 + dx * 3.1, dz * 5.2, seed + 113, 3);
            const spine = dustPlane + 0.065 + (stratum - 0.5) * 0.84;
            const pillar = smooth(-0.14, 0.04, spine) * bank;
            const litEdge = Math.exp(-(((spine - 0.013) / 0.040) ** 2)) * bank;
            const cluster = smooth(0.22, 0.71, fine * 0.42 + clouds * 0.58 - dx * 0.09);
            const scatter = bank * (0.24 + 1.2 * cluster) * (0.38 + stratum) * (1 - 0.78 * pillar);
            const silver = litEdge * (0.18 + 0.82 * cluster);
            const distant = (1 - cavity) * (1 - pillar * 0.73);
            r = r * distant + reflection * 0.015 + rim * 0.024 + scatter * 0.018 + silver * 0.050;
            g = g * distant + reflection * 0.043 + rim * 0.084 + scatter * 0.039 + silver * 0.096;
            b = b * distant + reflection * 0.092 + rim * 0.16 + scatter * 0.095 + silver * 0.14;
            density = 0.095 + density * (1 - cavity * 0.46) * (1 - pillar * 0.54)
                + reflection * 0.21 + rim * 0.27 + scatter * 0.31 + silver * 0.14;
            const offset = (y * width + x) * 4;
            data[offset] = Math.round(srgb(r) * 255);
            data[offset + 1] = Math.round(srgb(g) * 255);
            data[offset + 2] = Math.round(srgb(b) * 255);
            data[offset + 3] = Math.round(clamp01(density) * 255);
        }
    }
}

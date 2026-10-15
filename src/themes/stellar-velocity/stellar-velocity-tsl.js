/**
 * Stellar Velocity — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps):
 *  - every helper that is called more than once carries `setLayout`, so it is emitted ONCE as a
 *    real shader function; laid-out helpers are pure (no captured uniforms or textures);
 *  - no `mx_noise_*` anywhere (a DXC compile pathology on this project's Windows machines): the
 *    canyon's cloud is ONE tileable 3D byte texture and the fine grain one tileable half-float
 *    fBm texture, both baked on the CPU when the world is built;
 *  - nothing is lit by scene lights: every part writes its own light, scene-linear and unbounded
 *    (HDR); the post stack owns the tone map;
 *  - nothing here is solid: every part is light laid over the canyon, and the canyon itself is
 *    painted into a reduced-resolution target once a frame (stellar-velocity-nebula.js).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    clamp,
    dot,
    float,
    fract,
    max,
    mix,
    smoothstep,
    sqrt,
    texture,
    texture3D,
    uniform,
    uniformArray,
    vec3,
    vec4,
} from 'three/tsl';

import {
    FRONT_SLOTS,
    HOOP_LIGHTS,
    HOOP_SLOTS,
    NEBULA_PALETTES,
    STARBOW,
    TAU,
    mulberry32,
} from './stellar-velocity-core.js';
import { bakeOnce, derivedOnce } from '../shared/bake-cache.js';

export * from './stellar-velocity-core.js';

// ── Hashes (GPU) ────────────────────────────────────────────────────────────────

/** float → [0,1) */
export const svHash11 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(float(pIn).mul(0.1031)).toVar();
    p.mulAssign(p.add(33.33));
    p.mulAssign(p.add(p));
    return fract(p);
}).setLayout({ name: 'sv_hash11', type: 'float', inputs: [{ name: 'pIn', type: 'float' }] });

/** vec2 → [0,1) */
export const svHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'sv_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec2 → vec3 in [0,1) */
export const svHash23 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yxz.add(33.33)));
    return fract(p3.xxy.add(p3.yzz).mul(p3.zyx));
}).setLayout({ name: 'sv_hash23', type: 'vec3', inputs: [{ name: 'pIn', type: 'vec2' }] });

// ── Small maths ─────────────────────────────────────────────────────────────────

/** Rec.709 luminance. */
export const svLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const svMax3 = (c) => max(c.x, max(c.y, c.z));

/** (1 − |x|)² inside |x| < 1, else 0: a cheap bell with compact support. */
export const svBell = (x) => {
    const k = max(float(1.0).sub(abs(x)), 0.0);
    return k.mul(k);
};

// ── Light at speed ──────────────────────────────────────────────────────────────

/**
 * The true cosine off the course of something SEEN at cosine `seen`, at speed `beta`: the
 * inverse of the aberration that bunches the sky forward. TSL twin of the inverse of aberrate().
 */
export const svTrueCos = /* @__PURE__ */ Fn(([seen, beta]) => seen.sub(beta).div(float(1.0).sub(beta.mul(seen))))
    .setLayout({
        name: 'sv_trueCos', type: 'float', inputs: [{ name: 'seen', type: 'float' }, { name: 'beta', type: 'float' }],
    });

/** The cosine something at true cosine `truth` is seen at, at speed `beta`. TSL twin of aberrate(). */
export const svSeenCos = /* @__PURE__ */ Fn(([truth, beta]) => truth.add(beta).div(float(1.0).add(beta.mul(truth))))
    .setLayout({
        name: 'sv_seenCos', type: 'float', inputs: [{ name: 'truth', type: 'float' }, { name: 'beta', type: 'float' }],
    });

/** log2 of the Doppler factor of light seen at cosine `seen` off the course. TSL twin of doppler(). */
export const svShift = /* @__PURE__ */ Fn(([seen, beta]) => {
    const d = sqrt(max(float(1.0).sub(beta.mul(beta)), 0.0)).div(max(float(1.0).sub(beta.mul(seen)), 1e-4));
    return d.log2();
}).setLayout({
    name: 'sv_shift', type: 'float', inputs: [{ name: 'seen', type: 'float' }, { name: 'beta', type: 'float' }],
});

/**
 * The shift the starbow's colours are read from. The true white band (no shift) stands far out
 * to the side at any speed worth the name, so the whole frame would be blue; the bow is read
 * from the shift RELATIVE to a ring BOW_ANGLE off the course instead, which lays every band
 * across the frame: violet and blue round the sun, white behind the board, amber and red out
 * at the edge.
 */
export const BOW_COS = Math.cos(27 * (Math.PI / 180));
export const svBowShift = /* @__PURE__ */ Fn(([seen, beta]) => {
    const root = sqrt(max(float(1.0).sub(beta.mul(beta)), 0.0));
    const here = root.div(max(float(1.0).sub(beta.mul(seen)), 1e-4));
    const ring = root.div(max(float(1.0).sub(beta.mul(BOW_COS)), 1e-4));
    return here.div(ring).log2();
}).setLayout({
    name: 'sv_bowShift', type: 'float', inputs: [{ name: 'seen', type: 'float' }, { name: 'beta', type: 'float' }],
});

const stop = (i) => vec3(STARBOW[i][1], STARBOW[i][2], STARBOW[i][3]);

/** The starbow's colour for a shift (log2 of the Doppler factor). TSL twin of starbowColor(). */
export const svStarbow = /* @__PURE__ */ Fn(([shift]) => {
    const c = vec3(stop(0)).toVar();
    for (let i = 1; i < STARBOW.length; i++) {
        c.assign(mix(c, stop(i), smoothstep(STARBOW[i - 1][0], STARBOW[i][0], shift)));
    }
    return c;
}).setLayout({ name: 'sv_starbow', type: 'vec3', inputs: [{ name: 'shift', type: 'float' }] });

// ── The noise textures ──────────────────────────────────────────────────────────

export const FBM_SIZE = 256;

/**
 * The canyon's cloud as a tileable volume, four fields in the bytes of one texel:
 *   R  the masses (three octaves of gradient noise)
 *   G  filaments (the ridges of three finer octaves)
 *   B  billows (two octaves of cells: the heads of pillars, the puffs on a wall)
 *   A  a second, slower field: where the canyon opens, and where the gas is hot or cool
 *
 * It is baked twice from the same lattices: `near` with every octave, and `far` at half the
 * resolution with the finest octave of each field left out. A step of the march that is longer
 * than the finest features reads `far`: the same masses, with nothing in them the step could
 * miss.
 * @returns {{ near: Uint8Array, far: Uint8Array, farSize: number }} size³ × 4 and (size/2)³ × 4
 */
export function bakeCanyonNoise(seed = 4177, size = 64) {
    return bakeOnce(`stellar-velocity:canyon:${seed}:${size}`, () => computeCanyonNoise(seed, size));
}

function computeCanyonNoise(seed, size) {
    const rand = mulberry32(seed);
    const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);

    /** A periodic lattice of unit gradients, `cells` to a tile. */
    const gradientLattice = (cells) => {
        const g = new Float32Array(cells * cells * cells * 3);
        for (let i = 0; i < g.length; i += 3) {
            const zc = rand() * 2 - 1;
            const a = rand() * TAU;
            const r = Math.sqrt(1 - zc * zc);
            g[i] = r * Math.cos(a);
            g[i + 1] = r * Math.sin(a);
            g[i + 2] = zc;
        }
        return { g, cells };
    };
    /** Gradient noise of a lattice on an n³ grid, in about [−1, 1]. */
    const gradient = ({ g, cells }, n) => {
        const out = new Float32Array(n * n * n);
        const scale = cells / n;
        const at = (ix, iy, iz, dx, dy, dz) => {
            const k = ((((iz % cells) * cells) + (iy % cells)) * cells + (ix % cells)) * 3;
            return g[k] * dx + g[k + 1] * dy + g[k + 2] * dz;
        };
        let o = 0;
        for (let z = 0; z < n; z++) {
            const fz = (z + 0.5) * scale;
            const z0 = Math.floor(fz);
            const tz = fz - z0;
            const sz = fade(tz);
            for (let y = 0; y < n; y++) {
                const fy = (y + 0.5) * scale;
                const y0 = Math.floor(fy);
                const ty = fy - y0;
                const sy = fade(ty);
                for (let x = 0; x < n; x++) {
                    const fx = (x + 0.5) * scale;
                    const x0 = Math.floor(fx);
                    const tx = fx - x0;
                    const sx = fade(tx);
                    const a00 = at(x0, y0, z0, tx, ty, tz);
                    const a10 = at(x0 + 1, y0, z0, tx - 1, ty, tz);
                    const a01 = at(x0, y0 + 1, z0, tx, ty - 1, tz);
                    const a11 = at(x0 + 1, y0 + 1, z0, tx - 1, ty - 1, tz);
                    const b00 = at(x0, y0, z0 + 1, tx, ty, tz - 1);
                    const b10 = at(x0 + 1, y0, z0 + 1, tx - 1, ty, tz - 1);
                    const b01 = at(x0, y0 + 1, z0 + 1, tx, ty - 1, tz - 1);
                    const b11 = at(x0 + 1, y0 + 1, z0 + 1, tx - 1, ty - 1, tz - 1);
                    const a0 = a00 + (a10 - a00) * sx;
                    const a1 = a01 + (a11 - a01) * sx;
                    const b0 = b00 + (b10 - b00) * sx;
                    const b1 = b01 + (b11 - b01) * sx;
                    const lo = a0 + (a1 - a0) * sy;
                    const hi = b0 + (b1 - b0) * sy;
                    out[o] = (lo + (hi - lo) * sz) * 1.5;
                    o += 1;
                }
            }
        }
        return out;
    };
    /** A periodic lattice of one point a cell. */
    const cellLattice = (cells) => {
        const pts = new Float32Array(cells * cells * cells * 3);
        for (let i = 0; i < pts.length; i++) pts[i] = rand();
        return { pts, cells };
    };
    /** Cells of a lattice on an n³ grid: 1 at a cell's own point, falling to 0 a cell away. */
    const cellular = ({ pts, cells }, n) => {
        const out = new Float32Array(n * n * n);
        const scale = cells / n;
        let o = 0;
        for (let z = 0; z < n; z++) {
            const fz = (z + 0.5) * scale;
            const cz = Math.floor(fz);
            for (let y = 0; y < n; y++) {
                const fy = (y + 0.5) * scale;
                const cy = Math.floor(fy);
                for (let x = 0; x < n; x++) {
                    const fx = (x + 0.5) * scale;
                    const cx = Math.floor(fx);
                    let best = 9;
                    for (let dz = -1; dz <= 1; dz++) {
                        const kz = (((cz + dz) % cells) + cells) % cells;
                        for (let dy = -1; dy <= 1; dy++) {
                            const ky = (((cy + dy) % cells) + cells) % cells;
                            for (let dx = -1; dx <= 1; dx++) {
                                const kx = (((cx + dx) % cells) + cells) % cells;
                                const k = ((kz * cells + ky) * cells + kx) * 3;
                                const px = cx + dx + pts[k] - fx;
                                const py = cy + dy + pts[k + 1] - fy;
                                const pz = cz + dz + pts[k + 2] - fz;
                                const d = px * px + py * py + pz * pz;
                                if (d < best) best = d;
                            }
                        }
                    }
                    out[o] = 1 - Math.min(1, Math.sqrt(best));
                    o += 1;
                }
            }
        }
        return out;
    };

    const L = {
        g2: gradientLattice(2),
        g4: gradientLattice(4),
        g8: gradientLattice(8),
        r4: gradientLattice(4),
        r8: gradientLattice(8),
        r16: gradientLattice(16),
        c4: cellLattice(4),
        c8: cellLattice(8),
        h2: gradientLattice(2),
        h4: gradientLattice(4),
    };
    /** The four fields on an n³ grid; `fine` = with each field's finest octave. */
    const fieldsAt = (n, fine) => {
        const count = n * n * n;
        const g2 = gradient(L.g2, n);
        const g4 = gradient(L.g4, n);
        const g8 = fine ? gradient(L.g8, n) : null;
        const r4 = gradient(L.r4, n);
        const r8 = gradient(L.r8, n);
        const r16 = fine ? gradient(L.r16, n) : null;
        const c4 = cellular(L.c4, n);
        const c8 = fine ? cellular(L.c8, n) : null;
        const h2 = gradient(L.h2, n);
        const h4 = gradient(L.h4, n);
        const out = [new Float32Array(count), new Float32Array(count), new Float32Array(count), new Float32Array(count)];
        for (let i = 0; i < count; i++) {
            out[0][i] = g2[i] * 0.56 + g4[i] * 0.3 + (g8 ? g8[i] * 0.14 : 0);
            const ridge = 1 - Math.min(1, Math.abs(r4[i] * 0.58 + r8[i] * 0.3 + (r16 ? r16[i] * 0.12 : 0)) * 1.6);
            out[1][i] = ridge * ridge;
            // Without their finer octave the cells keep their mean.
            out[2][i] = c4[i] * 0.64 + (c8 ? c8[i] : 0.42) * 0.36;
            out[3][i] = h2[i] * 0.66 + h4[i] * 0.34;
        }
        return out;
    };
    const farSize = Math.max(8, size >> 1);
    const nearFields = fieldsAt(size, true);
    const farFields = fieldsAt(farSize, false);
    // Both are coded against the near fields' ranges, so they agree where they overlap.
    const ranges = nearFields.map((field) => {
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < field.length; i++) {
            if (field[i] < lo) lo = field[i];
            if (field[i] > hi) hi = field[i];
        }
        return [lo, 255 / Math.max(1e-6, hi - lo)];
    });
    const code = (fields) => {
        const count = fields[0].length;
        const data = new Uint8Array(count * 4);
        for (let c = 0; c < 4; c++) {
            const [lo, inv] = ranges[c];
            const field = fields[c];
            for (let i = 0; i < count; i++) data[i * 4 + c] = Math.max(0, Math.min(255, Math.round((field[i] - lo) * inv)));
        }
        return data;
    };
    return { near: code(nearFields), far: code(farFields), farSize };
}

/** The canyon's cloud as a tileable, linearly filtered 3D texture (RGBA8: filterable everywhere). */
export function createCanyonTexture(data, size, name = 'stellar-velocity-canyon') {
    const tex = new THREE.Data3DTexture(data, size, size, size);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.wrapR = THREE.RepeatWrapping;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.unpackAlignment = 1;
    tex.name = name;
    tex.needsUpdate = true;
    return tex;
}

/** The CPU twin of one read of the canyon's cloud (tests): the four fields at a point, 0..1. */
export function sampleCanyonNoise(data, size, x, y, z, out = [0, 0, 0, 0]) {
    const wrap = (v) => ((v % size) + size) % size;
    const px = x * size - 0.5;
    const py = y * size - 0.5;
    const pz = z * size - 0.5;
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const z0 = Math.floor(pz);
    const fx = px - x0;
    const fy = py - y0;
    const fz = pz - z0;
    for (let c = 0; c < 4; c++) {
        const at = (ix, iy, iz) => data[((wrap(iz) * size + wrap(iy)) * size + wrap(ix)) * 4 + c] / 255;
        const lerp1 = (a, b, t) => a + (b - a) * t;
        const lo = lerp1(lerp1(at(x0, y0, z0), at(x0 + 1, y0, z0), fx), lerp1(at(x0, y0 + 1, z0), at(x0 + 1, y0 + 1, z0), fx), fy);
        const hi = lerp1(
            lerp1(at(x0, y0, z0 + 1), at(x0 + 1, y0, z0 + 1), fx),
            lerp1(at(x0, y0 + 1, z0 + 1), at(x0 + 1, y0 + 1, z0 + 1), fx),
            fy,
        );
        out[c] = lerp1(lo, hi, fz);
    }
    return out;
}

/**
 * Periodic fBm gradient noise, four decorrelated channels stretched to [0, 1].
 * @returns {Float32Array} size × size × 4
 */
export function bakeFbm(seed = 2718, size = FBM_SIZE) {
    return bakeOnce(`stellar-velocity:fbm:${seed}:${size}`, () => computeFbm(seed, size));
}

function computeFbm(seed, size) {
    const n = size;
    const rand = mulberry32(seed);
    const base = new Float32Array(n * n * 4);
    const field = new Float32Array(n * n);
    const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);
    for (let c = 0; c < 4; c++) {
        field.fill(0);
        let amp = 1;
        for (let o = 0; o < 5; o++) {
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
        const inv = 1 / Math.max(1e-6, hi - lo);
        for (let i = 0; i < field.length; i++) base[i * 4 + c] = (field[i] - lo) * inv;
    }
    return base;
}

/**
 * The fBm field as a tileable half-float texture with a CPU-built mip chain (generating
 * half-float mips on the GPU is not portable to every WebGL2 device).
 */
export function createFbmTexture(field, size = FBM_SIZE) {
    // The CPU mip chain is derived once per cached field; each texture gets its own records.
    const mipmaps = derivedOnce(field, `mips:${size}`, () => mipsFbm(field, size)).map((mip) => ({ ...mip }));
    const tex = new THREE.DataTexture(mipmaps[0].data, size, size, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.mipmaps = mipmaps;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'stellar-velocity-fbm';
    tex.needsUpdate = true;
    return tex;
}

/** The half-float mip chain of a field (pure: derived once per field). */
function mipsFbm(field, size) {
    const mipmaps = [];
    let level = field;
    let w = size;
    for (;;) {
        const half = new Uint16Array(level.length);
        for (let i = 0; i < level.length; i++) half[i] = THREE.DataUtils.toHalfFloat(level[i]);
        mipmaps.push({ data: half, width: w, height: w });
        if (w === 1) break;
        const nw = w >> 1;
        const next = new Float32Array(nw * nw * 4);
        for (let y = 0; y < nw; y++) {
            for (let x = 0; x < nw; x++) {
                const a = (y * 2 * w + x * 2) * 4;
                const b2 = a + 4;
                const c2 = a + w * 4;
                const d2 = c2 + 4;
                const o = (y * nw + x) * 4;
                for (let c = 0; c < 4; c++) {
                    next[o + c] = (level[a + c] + level[b2 + c] + level[c2 + c] + level[d2 + c]) * 0.25;
                }
            }
        }
        level = next;
        w = nw;
    }
    return mipmaps;
}

// ── Shared uniforms ─────────────────────────────────────────────────────────────

const v3 = (a) => uniform(new THREE.Vector3(a[0], a[1], a[2]));
const rows = (count, fill = [0, 0, 0, 0]) => Array.from(
    { length: count },
    () => new THREE.Vector4(fill[0], fill[1], fill[2], fill[3]),
);

/** The peak the canyon's light is coded against where its target is 8-bit (see `canyonAt`). */
export const CANYON_CODE_PEAK = 6;

/**
 * Every uniform the scene's materials share. The world owns the values; materials only read.
 * @param {{ canyon: THREE.Data3DTexture, canyonFar: THREE.Data3DTexture, fbm: THREE.Texture, target: THREE.Texture,
 *   floatTarget?: boolean }} textures
 */
export function createStellarUniforms(textures) {
    const p = NEBULA_PALETTES[1];
    const tables = {
        hoops: rows(HOOP_SLOTS * 2, [-100, 1, 0, 0]),
        hoopLights: rows(HOOP_LIGHTS * 2, [-100, 1, 0, 0]),
        fronts: rows(FRONT_SLOTS * 2, [-100, 1, 0, 0]),
    };
    const u = {
        time: uniform(0),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        /** Radians of view per pixel. */
        pixelAngle: uniform(0.0006),
        // The camera, for the canyon's target (which is drawn without one).
        camPos: uniform(new THREE.Vector3(0, 0, 0)),
        camRight: uniform(new THREE.Vector3(1, 0, 0)),
        camUp: uniform(new THREE.Vector3(0, 1, 0)),
        camFwd: uniform(new THREE.Vector3(0, 0, -1)),
        tanHalf: uniform(new THREE.Vector2(0.9, 0.5)),
        /** The sun on screen (UV, y down). */
        sunUv: uniform(new THREE.Vector2(0.24, 0.45)),
        /**
         * How far the canyon has passed (canyon units, wrapped where every read of the cloud
         * comes round whole), and the same for the near stars and the dust, each wrapped at its
         * own depth. The world integrates them: the speed changes, so the clock cannot be
         * multiplied by it.
         */
        travel: uniform(0),
        starTravel: uniform(0),
        moteTravel: uniform(0),
        /** Canyon units per second right now (trail lengths). */
        speed: uniform(0.2),
        /** The share of light's speed the sky is shown at: 0 at rest → 0.9 in a long chain. */
        warp: uniform(0),
        /** The canyon winds round the course (a T-spin) and springs back: radians per unit of depth. */
        twist: uniform(0),
        /** Gain on every light: a four-line clear holds the drive's breath (→ 0.1). */
        breath: uniform(1),
        /** How much of the frame is the jump's tunnel (0..1), and the clock its streaks run on. */
        jump: uniform(0),
        jumpClock: uniform(0),
        /** A jump shifts the cloud's whole field: we come out somewhere else. */
        shift: uniform(new THREE.Vector3(0, 0, 0)),
        /** How brightly the sun stands (1 at rest; a chain and a jump's afterglow raise it). */
        sunGain: uniform(1),
        /**
         * How far the post's iris has closed, inverted: the lights of an event (a hoop, a bolt,
         * a jet) are raised by it, so they are as bright on screen at speed as at rest.
         */
        iris: uniform(1),
        // The nebula's palette (scene-linear), walked by the world.
        glow: v3(p.glow),
        deep: v3(p.deep),
        accent: v3(p.accent),
        dust: v3(p.dust),
        sunCol: v3(p.sun),
        skyCol: v3(p.sky),
        starTint: v3(p.star),
        tables,
        /**
         * The hoops on the course, two rows each: (depth ahead now, radius now, light now, the
         * turn of its arcs) and (colour, seed).
         */
        hoops: uniformArray(tables.hoops, 'vec4'),
        /** The lit hoops nearest the camera, for the cloud: (depth, radius, light, _) + (colour, _). */
        hoopLights: uniformArray(tables.hoopLights, 'vec4'),
        hoopLightCount: uniform(0, 'int'),
        /** Fronts of light in the canyon: (depth ahead now, width, strength, _) + (colour, _). */
        fronts: uniformArray(tables.fronts, 'vec4'),
        frontCount: uniform(0, 'int'),
        canyonTex: textures.canyon,
        canyonFarTex: textures.canyonFar,
        fbmTex: textures.fbm,
        targetTex: texture(textures.target),
    };
    /** The canyon's four fields at a point of the volume (one unit = one tile). */
    u.cloud = (p3) => texture3D(u.canyonTex, p3).level(0);
    /** The same fields without their finest octaves: what a long step of the march reads. */
    u.cloudFar = (p3) => texture3D(u.canyonFarTex, p3).level(0);
    /** The fBm grain (mipped). */
    u.fbm = (st) => texture(u.fbmTex, st);
    /** A fixed mip: for fetches whose coordinates jump or that run in a vertex stage. */
    u.fbmLod = (st, lod = 0) => texture(u.fbmTex, st).level(lod);
    /**
     * The canyon's target at a screen UV: (light, how much of what is behind it shows through).
     * Where the target is 8-bit (`floatTarget` false) it holds the square root of the light over
     * CANYON_CODE_PEAK, so the dark cloud keeps its steps.
     */
    u.floatTarget = textures.floatTarget !== false;
    u.canyonAt = (st) => {
        const stored = u.targetTex.sample(st);
        if (u.floatTarget) return stored;
        return vec4(stored.rgb.mul(stored.rgb).mul(CANYON_CODE_PEAK), stored.a);
    };
    return u;
}

/** The view ray through a UV of the frame (y down), from the camera uniforms. */
export const svViewRay = (u, st) => {
    const nx = st.x.mul(2.0).sub(1.0);
    const ny = float(1.0).sub(st.y.mul(2.0));
    return u.camFwd.add(u.camRight.mul(nx.mul(u.tanHalf.x))).add(u.camUp.mul(ny.mul(u.tanHalf.y))).normalize();
};

/**
 * The true direction of what is SEEN along `ray` at speed `beta` (the course runs to −Z): the
 * sky bunches forward at speed, so the ray of a pixel off the course looks at a true direction
 * further off it still.
 */
export const svTrueRay = (ray, beta) => {
    const seen = clamp(ray.z.negate(), -1.0, 1.0);
    const truth = svTrueCos(seen, beta);
    const side = ray.xy.div(max(sqrt(max(float(1.0).sub(seen.mul(seen)), 1e-8)), 1e-4));
    return vec3(side.mul(sqrt(max(float(1.0).sub(truth.mul(truth)), 0.0))), truth.negate());
};

// ── Materials and geometry ──────────────────────────────────────────────────────

/**
 * A premultiplied "over" material: `vec4(emission, 0)` adds, `vec4(rgb·a, a)` occludes. Nothing
 * in this scene writes depth.
 */
export function svFxMaterial(name) {
    const m = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
    });
    m.name = name;
    m.fog = false;
    m.blending = THREE.CustomBlending;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.blendSrcAlpha = THREE.OneFactor;
    m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    m.forceSinglePass = true;
    return m;
}

/**
 * A unit quad (xy in −0.5..0.5, uv 0..1) for `count` instances.
 * @param {number} count
 * @param {Record<string, [Float32Array, number]>} attributes  name → [data, itemSize]
 */
export function svQuadGeometry(count, attributes = {}) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    Object.keys(attributes).forEach((name) => {
        const [data, itemSize] = attributes[name];
        geometry.setAttribute(name, new THREE.InstancedBufferAttribute(data, itemSize));
    });
    geometry.instanceCount = count;
    return geometry;
}

/** The mesh wrapper every part returns. */
export function svPart(name, geometry, material, renderOrder = 0) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    return { mesh, material, geometry };
}

/** A full-screen pass material for a QuadMesh (no depth). */
export function svPassMaterial(name, node) {
    const material = new THREE.NodeMaterial();
    material.name = name;
    material.depthTest = false;
    material.depthWrite = false;
    material.fragmentNode = node;
    return material;
}

/**
 * Can this renderer draw into half-float targets? WebGPU always can. A WebGL2 context needs
 * EXT_color_buffer_float or EXT_color_buffer_half_float; without one a half-float target is an
 * incomplete framebuffer.
 */
export function supportsFloatTargets(renderer) {
    const backend = renderer?.backend;
    if (!backend || backend.isWebGPUBackend === true) return true;
    const { gl } = backend;
    if (!gl || typeof gl.getExtension !== 'function') return true;
    try {
        return Boolean(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    } catch {
        return false;
    }
}

/** Clamp-to-edge, linear colour target without depth: half-float, or 8-bit where that cannot be drawn to. */
export function svTarget(width, height, name, halfFloat = true) {
    const rt = new THREE.RenderTarget(Math.max(2, width), Math.max(2, height), {
        type: halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
        samples: 0,
    });
    rt.texture.name = name;
    rt.texture.minFilter = THREE.LinearFilter;
    rt.texture.magFilter = THREE.LinearFilter;
    rt.texture.wrapS = THREE.ClampToEdgeWrapping;
    rt.texture.wrapT = THREE.ClampToEdgeWrapping;
    rt.texture.generateMipmaps = false;
    rt.texture.colorSpace = THREE.NoColorSpace;
    return rt;
}

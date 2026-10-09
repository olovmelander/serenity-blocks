/**
 * Voltage Storm — shared TSL building blocks.
 *
 * Rules (from the fleet's perf sweeps):
 *  - every helper that is called more than once carries `setLayout`, so it is emitted ONCE as a
 *    real shader function; laid-out helpers are pure (no captured uniforms or textures);
 *  - no `mx_noise_*` anywhere (a DXC compile pathology on this project's Windows machines): the
 *    cloud reads ONE tileable 3D texture and the water, the hills and the rain shafts ONE
 *    tileable 2D texture, both baked on the CPU; hashes are hash-without-sine;
 *  - nothing is lit by scene lights: every part shades itself (MeshBasicNodeMaterial /
 *    NodeMaterial), scene-linear and unbounded (HDR); the post stack owns the tone map;
 *  - event data lives in a few `uniformArray` tables of vec4 rows written by the world; live
 *    rows are kept at the front and counted, so an idle storm loops over nothing.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    Loop,
    dot,
    exp,
    float,
    fract,
    int,
    length,
    max,
    texture,
    texture3D,
    uniform,
    uniformArray,
    vec3,
} from 'three/tsl';

import {
    BOLT_ROWS,
    BOLT_SLOTS,
    FLASH_SLOTS,
    SHOCK_FADE,
    SHOCK_SLOTS,
    SKY_CODE_PEAK,
    STORM,
    TAU,
    TOWER_MAX,
    VOLTAGE_STORM_PALETTES,
    mulberry32,
} from './voltage-storm-core.js';

export * from './voltage-storm-core.js';

// ── Hashes (GPU) ────────────────────────────────────────────────────────────────

/** float → [0,1) */
export const vsHash11 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(float(pIn).mul(0.1031)).toVar();
    p.mulAssign(p.add(33.33));
    p.mulAssign(p.add(p));
    return fract(p);
}).setLayout({ name: 'vs_hash11', type: 'float', inputs: [{ name: 'pIn', type: 'float' }] });

/** vec2 → [0,1) */
export const vsHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'vs_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** float → vec2 in [0,1) */
export const vsHash12 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn, pIn, pIn).mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.xx.add(p3.yz).mul(p3.zy));
}).setLayout({ name: 'vs_hash12', type: 'vec2', inputs: [{ name: 'pIn', type: 'float' }] });

/** vec2 → vec2 in [0,1) */
export const vsHash22 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.xx.add(p3.yz).mul(p3.zy));
}).setLayout({ name: 'vs_hash22', type: 'vec2', inputs: [{ name: 'pIn', type: 'vec2' }] });

// ── Small maths ─────────────────────────────────────────────────────────────────

/** Rec.709 luminance. */
export const vsLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const vsMax3 = (c) => max(c.x, max(c.y, c.z));

/** e^(−x²). */
export const vsGauss = (x) => exp(x.mul(x).negate());

// ── The 2D noise texture ────────────────────────────────────────────────────────

export const NOISE_SIZE = 256;
/** The slope channels hold (dR/du, dR/dv) per texel times this, so they sit near ±1. */
export const NOISE_SLOPE_GAIN = 14;

/**
 * Periodic fBm gradient noise. R and G are two decorrelated fields stretched to [0, 1]; B and A
 * are R's slope along u and v (signed, times NOISE_SLOPE_GAIN), so one fetch gives a height and
 * its gradient.
 * @returns {Float32Array} size × size × 4
 */
export function bakeNoise(seed = 5150, size = NOISE_SIZE) {
    const n = size;
    const rand = mulberry32(seed);
    const base = new Float32Array(n * n * 4);
    const field = new Float32Array(n * n);
    const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);
    for (let c = 0; c < 2; c++) {
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
    for (let y = 0; y < n; y++) {
        const yu = ((y + n - 1) % n) * n;
        const yd = ((y + 1) % n) * n;
        for (let x = 0; x < n; x++) {
            const xl = (x + n - 1) % n;
            const xr = (x + 1) % n;
            const o = (y * n + x) * 4;
            base[o + 2] = (base[(y * n + xr) * 4] - base[(y * n + xl) * 4]) * 0.5 * NOISE_SLOPE_GAIN;
            base[o + 3] = (base[(yd + x) * 4] - base[(yu + x) * 4]) * 0.5 * NOISE_SLOPE_GAIN;
        }
    }
    return base;
}

/**
 * The noise field as a tileable half-float texture with a CPU-built mip chain (generating
 * half-float mips on the GPU is not portable to every WebGL2 device).
 */
export function createNoiseTexture(field, size = NOISE_SIZE) {
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
    const tex = new THREE.DataTexture(mipmaps[0].data, size, size, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.mipmaps = mipmaps;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'voltage-storm-noise';
    tex.needsUpdate = true;
    return tex;
}

// ── The cloud's 3D noise ────────────────────────────────────────────────────────

/**
 * Tileable cloud noise, `size`³ voxels of RGBA8:
 *   R  the lobes: smooth gradient noise carved by inverted cellular noise (billows that hang)
 *   G  finer billows (cellular, two octaves), for the erosion of the lobes' edges
 *   B  the finest cells
 *   A  smooth gradient noise alone (wisps, the slow churn)
 * @returns {Uint8Array} size³ × 4, x fastest, then y, then z
 */
export function bakeCloudNoise(seed = 9001, size = 48) {
    const n = size;
    const rand = mulberry32(seed);
    const count = n * n * n;

    /** Inverted cellular noise (1 at a cell's point, 0 between) with `cells` cells per tile. */
    const cellular = (cells) => {
        const pts = new Float32Array(cells * cells * cells * 3);
        for (let i = 0; i < pts.length; i++) pts[i] = rand();
        const out = new Float32Array(count);
        const scale = cells / n;
        const wrap = (v) => ((v % cells) + cells) % cells;
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
                        const kz = wrap(cz + dz) * cells * cells;
                        for (let dy = -1; dy <= 1; dy++) {
                            const ky = kz + wrap(cy + dy) * cells;
                            for (let dx = -1; dx <= 1; dx++) {
                                const k = (ky + wrap(cx + dx)) * 3;
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

    /** Periodic gradient noise with `cells` lattice cells per tile, in about [−1, 1]. */
    const gradient = (cells) => {
        const g = new Float32Array(cells * cells * cells * 3);
        for (let i = 0; i < g.length; i += 3) {
            const zc = rand() * 2 - 1;
            const a = rand() * TAU;
            const r = Math.sqrt(1 - zc * zc);
            g[i] = r * Math.cos(a);
            g[i + 1] = r * Math.sin(a);
            g[i + 2] = zc;
        }
        const out = new Float32Array(count);
        const scale = cells / n;
        const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);
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

    const c3 = cellular(3);
    const c6 = cellular(6);
    const c12 = cellular(12);
    const g3 = gradient(3);
    const g6 = gradient(6);
    const data = new Uint8Array(count * 4);
    const byte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
    for (let i = 0; i < count; i++) {
        const smoothField = Math.max(0, Math.min(1, 0.5 + 0.5 * (g3[i] * 0.7 + g6[i] * 0.3)));
        const billow = c3[i] * 0.6 + c6[i] * 0.28 + c12[i] * 0.12;
        // Gradient noise gives the masses, the cells hang lobes from them.
        data[i * 4] = byte(smoothField * 0.55 + billow * 0.62 - 0.08);
        data[i * 4 + 1] = byte(c6[i] * 0.62 + c12[i] * 0.38);
        data[i * 4 + 2] = byte(c12[i]);
        data[i * 4 + 3] = byte(smoothField);
    }
    return data;
}

/** The cloud noise as a tileable, linearly filtered 3D texture (RGBA8: filterable everywhere). */
export function createCloudTexture(data, size) {
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
    tex.name = 'voltage-storm-cloud';
    tex.needsUpdate = true;
    return tex;
}

// ── Shared uniforms ─────────────────────────────────────────────────────────────

const v3 = (a) => uniform(new THREE.Vector3(a[0], a[1], a[2]));
const rows = (count, fill = [0, 0, 0, 0]) => Array.from(
    { length: count },
    () => new THREE.Vector4(fill[0], fill[1], fill[2], fill[3]),
);

/**
 * Every uniform the storm's materials share. The world owns the values; materials only read.
 * @param {{ noise: THREE.Texture, cloud: THREE.Data3DTexture, sky: THREE.Texture }} textures
 */
export function createStormUniforms(textures) {
    const p = VOLTAGE_STORM_PALETTES[0];
    const tables = {
        bolts: rows(BOLT_SLOTS * BOLT_ROWS),
        flashes: rows(FLASH_SLOTS * 2),
        shocks: rows(SHOCK_SLOTS * 2, [0, 0, -100, 0]),
        towers: rows(TOWER_MAX * 3),
    };
    const u = {
        time: uniform(0),
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        /** Radians of view per pixel. */
        pixelAngle: uniform(0.0006),
        // The camera, for the sky target (which is drawn without one).
        camPos: uniform(new THREE.Vector3(0, STORM.eye, 0)),
        camRight: uniform(new THREE.Vector3(1, 0, 0)),
        camUp: uniform(new THREE.Vector3(0, 1, 0)),
        camFwd: uniform(new THREE.Vector3(0, 0, -1)),
        tanHalf: uniform(new THREE.Vector2(0.6, 0.34)),
        /** The horizon's height in the frame (uv.y, down): the water mirrors the sky about it. */
        horizonV: uniform(0.7),
        /** Gain on every light the storm makes itself: a four-line clear holds its breath. */
        breath: uniform(1),
        /** 0..1: the chain's charge. */
        power: uniform(0),
        /** 0..1.3: the overdrive after a superbolt. */
        surge: uniform(0),
        /** How far the cloud has drifted (metres) and the churn's clock (gameplay bends both). */
        drift: uniform(new THREE.Vector3(0, 0, 0)),
        churn: uniform(0),
        /** The rain's own clock (it hangs while the storm holds its breath) and its lean and weight. */
        rainClock: uniform(0),
        rainLean: uniform(new THREE.Vector2(0.16, 0.05)),
        rainGain: uniform(1),
        /** The cloud's twist over the hero tower: (x, z, angle in radians, radius in metres). */
        twist: uniform(new THREE.Vector4(0, -200, 0, 900)),
        /** Sheet lightning running out through the cloud: (x, z, birth time, strength). */
        sheet: uniform(new THREE.Vector4(0, 0, -100, 0)),
        /** The strokes' light where the camera stands (rain, haze, the post's flash). */
        veil: uniform(new THREE.Vector3(0, 0, 0)),
        // The palette (scene-linear), eased by the world between levels.
        horizon: v3(p.horizon),
        gap: v3(p.gap),
        cloud: v3(p.cloud),
        rim: v3(p.rim),
        haze: v3(p.haze),
        bolt: v3(p.bolt),
        flash: v3(p.flash),
        water: v3(p.water),
        corona: v3(p.corona),
        chain: v3(p.chain),
        steel: v3(p.steel),
        /** Live rows at the front of the flash and shock tables. */
        flashCount: uniform(0),
        shockCount: uniform(0),
        tables,
        /** Bolt table: four rows per slot (see BOLT_KIND in the core). */
        bolts: uniformArray(tables.bolts, 'vec4'),
        /** Flash table: (position, reach in metres) + (rgb light, _). */
        flashes: uniformArray(tables.flashes, 'vec4'),
        /** Shock table: (x, z, birth time, strength) + (rgb, speed m/s). */
        shocks: uniformArray(tables.shocks, 'vec4'),
        /**
         * Tower table, three rows per tower: (x, z, height, live) + (held rgb, ring fill 0..1) +
         * (strike flash, lock pulse birth, lock pulse strength, corona 0..1).
         */
        towers: uniformArray(tables.towers, 'vec4'),
        noiseTex: textures.noise,
        cloudTex: textures.cloud,
        skyTex: texture(textures.sky),
    };
    u.noise = (st) => texture(u.noiseTex, st);
    /** A fixed mip: for fetches in a vertex stage or whose coordinates jump. */
    u.noiseLod = (st, lod = 0) => texture(u.noiseTex, st).level(lod);
    u.cloudNoise = (p3) => texture3D(u.cloudTex, p3).level(0);
    /**
     * The sky target's light at a screen UV. Where the target is 8-bit (`floatSky` false) it holds
     * the square root of the light over SKY_CODE_PEAK, so the dark cloud keeps its steps.
     */
    u.floatSky = textures.floatSky !== false;
    u.skyAt = (st) => {
        const stored = u.skyTex.sample(st).rgb;
        return u.floatSky ? stored : stored.mul(stored).mul(SKY_CODE_PEAK);
    };
    return u;
}

/**
 * The strokes' light at a world point: every live flash, falling off with distance over its own
 * reach. Inline (it reads the flash table), so call it once per shader.
 */
export const vsFlashLight = (u, point, name = 'fl') => {
    const sum = vec3(0.0).toVar();
    Loop({
        start: int(0), end: int(u.flashCount), type: 'int', condition: '<', name,
    }, (loop) => {
        const index = loop[name];
        const at = u.flashes.element(index.mul(2));
        const light = u.flashes.element(index.mul(2).add(1));
        const away = point.sub(at.xyz);
        // 1 / (1 + d²/r²)²: full within its reach, gone by three times that (a stroke lights its
        // own part of the storm, not the whole sky).
        const fall = float(1.0).div(float(1.0).add(dot(away, away).div(at.w.mul(at.w))));
        sum.addAssign(light.xyz.mul(fall.mul(fall)));
    });
    return sum;
};

/**
 * The rings crossing the water at `xz`: `{ slope }` (a vec2 along each ring's radius) and
 * `{ light }` (each ring's own colour on its front). A ring is a short train of ripples behind a
 * bright front.
 */
export const vsShockRings = (u, xz, name = 'sk') => {
    const slope = vec3(0.0).toVar(); // xy = slope, z unused
    const light = vec3(0.0).toVar();
    Loop({
        start: int(0), end: int(u.shockCount), type: 'int', condition: '<', name,
    }, (loop) => {
        const index = loop[name];
        const a = u.shocks.element(index.mul(2));
        const c = u.shocks.element(index.mul(2).add(1));
        const age = max(u.time.sub(a.z), 0.0);
        const away = xz.sub(a.xy);
        const dist = max(length(away), 0.01);
        const front = age.mul(c.w);
        const x = dist.sub(front);
        const width = float(6.0).add(front.mul(0.035));
        const env = exp(x.mul(x).div(width.mul(width)).negate()).mul(a.w).mul(exp(age.mul(-SHOCK_FADE)));
        const wave = x.div(width).mul(2.4).cos().mul(env);
        slope.addAssign(vec3(away.div(dist).mul(wave), 0.0));
        light.addAssign(c.xyz.mul(env));
    });
    return { slope: slope.xy, light };
};

// ── Materials and geometry ──────────────────────────────────────────────────────

/** A premultiplied "over" material: `vec4(emission, 0)` adds, `vec4(rgb·a, a)` occludes. */
export function vsFxMaterial(name, { depthTest = true } = {}) {
    const m = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest,
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
export function vsQuadGeometry(count, attributes = {}) {
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
export function vsPart(name, geometry, material, renderOrder = 0) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    return { mesh, material, geometry };
}

/** A full-screen pass material for a QuadMesh (no depth). */
export function vsPassMaterial(name, node) {
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
export function vsTarget(width, height, name, halfFloat = true) {
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

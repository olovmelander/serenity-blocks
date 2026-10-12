/**
 * Painted Ages — shared TSL: the uniforms every part reads, the baked textures, and the readers
 * of the land (the three nested fields as one surface, the strata column).
 *
 * One set of uniforms (createUniforms) is the scene's state on the GPU. The world writes it; the
 * materials read it. Readers that sample a texture or read a uniform are inline builders (a laid-
 * out Fn may not capture either); pure arithmetic helpers carry a layout.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    dot,
    float,
    floor,
    fract,
    max,
    mix,
    sin,
    smoothstep,
    texture,
    uniform,
    uniformArray,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    COLUMN, FIELDS, FIELD_BLEND, RECORD_ROWS, RECORD_WIDTH, bakeColumn, mulberry32,
} from './painted-ages-core.js';

// ── Small helpers ─────────────────────────────────────────────────────────────────

/** vec2 → [0, 1) */
export const paHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'pa_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec2 → vec2 in [0, 1) */
export const paHash22 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(vec3(0.1031, 0.103, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.xx.add(p3.yz).mul(p3.zy));
}).setLayout({ name: 'pa_hash22', type: 'vec2', inputs: [{ name: 'pIn', type: 'vec2' }] });

export const paLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));
export const paMax3 = (c) => max(c.x, max(c.y, c.z));

/**
 * Geological height (the JS strataG in core, the same numbers): a point's height lifted or
 * dropped by the dip of the beds and their folds.
 */
export const paStrataG = /* @__PURE__ */ Fn(([p]) => {
    const range = float(1.0).sub(smoothstep(-2800.0, -2100.0, p.z)).mul(smoothstep(-6400.0, -5200.0, p.z));
    const gentle = p.x.mul(0.085).add(p.z.mul(-0.06));
    const fold = sin(p.x.mul(0.0021).add(p.z.mul(0.0013))).mul(26.0)
        .add(sin(p.x.mul(0.0057).sub(p.z.mul(0.0031)).add(1.7)).mul(14.0));
    const steep = p.z.negate().sub(2600.0).mul(1.05).add(sin(p.x.mul(0.0019)).mul(30.0));
    return p.y.sub(mix(gentle.add(fold), steep, range));
}).setLayout({ name: 'pa_strataG', type: 'float', inputs: [{ name: 'p', type: 'vec3' }] });

/** The column texture's coordinate for a geological height. */
export const columnU = (g) => g.sub(COLUMN.gMin).div(COLUMN.gMax - COLUMN.gMin);

// ── Baked textures ────────────────────────────────────────────────────────────────

export const NOISE_SIZE = 256;

/**
 * Tileable value-noise fBm, four independent fields (RGBA) at lattice periods 8, 16, 32 and 64
 * across the tile: broad cloud, mid, fine, and grain.
 */
export function bakeNoise(size = NOISE_SIZE, seed = 0xc10d) {
    const out = new Uint8Array(size * size * 4);
    const lattices = [8, 16, 32, 64].map((period, c) => {
        const random = mulberry32(seed + c * 977);
        const values = new Float32Array(period * period);
        for (let i = 0; i < values.length; i++) values[i] = random();
        return { period, values };
    });
    const fade = (t) => t * t * (3 - 2 * t);
    const valueAt = (lat, x, y) => {
        const { period, values } = lat;
        const xi = Math.floor(x);
        const yi = Math.floor(y);
        const tx = fade(x - xi);
        const ty = fade(y - yi);
        const at = (a, b) => values[(((b % period) + period) % period) * period + (((a % period) + period) % period)];
        const a = at(xi, yi);
        const b = at(xi + 1, yi);
        const c = at(xi, yi + 1);
        const d = at(xi + 1, yi + 1);
        return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    };
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
            for (let c = 0; c < 4; c++) {
                let sum = 0;
                let amp = 0.5;
                let norm = 0;
                for (let o = 0; o < 4 && c + o < 4; o++) {
                    const lat = lattices[c + o];
                    sum += amp * valueAt(lat, (i / size) * lat.period, (j / size) * lat.period);
                    norm += amp;
                    amp *= 0.5;
                }
                if (c === 3) {
                    sum = valueAt(lattices[3], (i / size) * 64, (j / size) * 64);
                    norm = 1;
                }
                out[(j * size + i) * 4 + c] = Math.round((sum / norm) * 255);
            }
        }
    }
    return out;
}

export function createNoiseTexture(data = bakeNoise()) {
    const tex = new THREE.DataTexture(data, NOISE_SIZE, NOISE_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'painted-ages-noise';
    tex.needsUpdate = true;
    return tex;
}

const linearToSrgbByte = (c) => {
    const v = Math.max(0, Math.min(1, c));
    const s = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
    return Math.round(s * 255);
};

/**
 * The strata column as a 1-texel-high sRGB texture with its mip chain averaged on the CPU (in
 * linear light): the bands blend into their mean where a bed is thinner than a pixel. A = hardness.
 */
export function createColumnTexture(beds) {
    const base = bakeColumn(beds);
    const levels = [];
    let width = COLUMN.size;
    let linear = base;
    for (;;) {
        const bytes = new Uint8Array(width * 4);
        for (let i = 0; i < width; i++) {
            bytes[i * 4] = linearToSrgbByte(linear[i * 4]);
            bytes[i * 4 + 1] = linearToSrgbByte(linear[i * 4 + 1]);
            bytes[i * 4 + 2] = linearToSrgbByte(linear[i * 4 + 2]);
            bytes[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, linear[i * 4 + 3])) * 255);
        }
        levels.push({ data: bytes, width, height: 1 });
        if (width === 1) break;
        const next = new Float32Array((width >> 1) * 4);
        for (let i = 0; i < width >> 1; i++) {
            for (let c = 0; c < 4; c++) next[i * 4 + c] = (linear[i * 8 + c] + linear[i * 8 + 4 + c]) * 0.5;
        }
        linear = next;
        width >>= 1;
    }
    const tex = new THREE.DataTexture(levels[0].data, COLUMN.size, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.mipmaps = levels;
    tex.generateMipmaps = false;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.name = 'painted-ages-column';
    tex.needsUpdate = true;
    return tex;
}

export const LATTICE_SIZE = 256;
/** The z-slice shift of the lattice: G is R one slice up, A is B one slice up. */
const SLICE = [37, 17];

/**
 * A 256² RGBA8 lattice of white noise whose G channel is R shifted by one z-slice and whose A is B
 * shifted the same way, so ONE bilinear fetch at `xy + SLICE · floor(z)` gives two independent
 * trilinear value-noise fields (noise3 below).
 */
export function bakeLattice(seed = 0x1a77, size = LATTICE_SIZE) {
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
            const j = ((y + SLICE[1]) % size) * size + ((x + SLICE[0]) % size);
            data[i * 4] = r[i];
            data[i * 4 + 1] = r[j];
            data[i * 4 + 2] = b[i];
            data[i * 4 + 3] = b[j];
        }
    }
    return data;
}

export function createLatticeTexture(data = bakeLattice(), size = LATTICE_SIZE) {
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'painted-ages-lattice';
    tex.needsUpdate = true;
    return tex;
}

/** 3D value noise, two independent fields in [0, 1], in one fetch (one unit = one lattice cell). */
export const noise3 = (tex, at) => {
    const cell = floor(at);
    const f0 = fract(at);
    const f = f0.mul(f0).mul(float(3.0).sub(f0.mul(2.0)));
    const st = cell.xy.add(vec2(SLICE[0], SLICE[1]).mul(cell.z)).add(f.xy).add(0.5).div(LATTICE_SIZE);
    const t = texture(tex, st).level(0);
    return mix(t.xz, t.yw, f.z);
};

/** The mineral record as a linear RGBA8 texture (rows of cleared lines). */
export function createRecordTexture(record) {
    const tex = new THREE.DataTexture(record.data, RECORD_WIDTH, RECORD_ROWS, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'painted-ages-record';
    tex.needsUpdate = true;
    return tex;
}

/**
 * A field's GPU form: (height normalised to its [lo, hi], dh/dx, dh/dz, sky) as half floats, the
 * slope read off the heights a little smoothed (a Sobel pair) so a normal per cell never shows
 * as a grid of dots; and, for the near and mid fields, drainage as an 8-bit red texture.
 */
export function fieldTextureData(heights, sky, field) {
    const { size } = field;
    const cell = field.span / (size - 1);
    const range = field.hi - field.lo;
    const toHalf = THREE.DataUtils.toHalfFloat;
    const data = new Uint16Array(size * size * 4);
    const at = (i, j) => heights[Math.max(0, Math.min(size - 1, j)) * size + Math.max(0, Math.min(size - 1, i))];
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
            const gx = (at(i + 1, j - 1) + 2 * at(i + 1, j) + at(i + 1, j + 1)
                - at(i - 1, j - 1) - 2 * at(i - 1, j) - at(i - 1, j + 1)) / (8 * cell);
            const gz = (at(i - 1, j + 1) + 2 * at(i, j + 1) + at(i + 1, j + 1)
                - at(i - 1, j - 1) - 2 * at(i, j - 1) - at(i + 1, j - 1)) / (8 * cell);
            const o = (j * size + i) * 4;
            data[o] = toHalf((heights[j * size + i] - field.lo) / range);
            data[o + 1] = toHalf(gx);
            data[o + 2] = toHalf(gz);
            data[o + 3] = toHalf(sky[j * size + i] / 255);
        }
    }
    return data;
}

export function createFieldTexture(data, field) {
    const tex = new THREE.DataTexture(data, field.size, field.size, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = `painted-ages-${field.name}`;
    tex.needsUpdate = true;
    return tex;
}

export function createFlowTexture(flow, field) {
    const tex = new THREE.DataTexture(flow, field.size, field.size, THREE.RedFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = `painted-ages-${field.name}-flow`;
    tex.needsUpdate = true;
    return tex;
}

// ── Reading the land ──────────────────────────────────────────────────────────────

/** A field's texture coordinate for a world xz (posts at texel centres). */
export const fieldUV = (field, xz) => {
    const k = (field.size - 1) / (field.span * field.size);
    const h = 0.5 / field.size;
    return vec2(xz.x.sub(field.x0).mul(k).add(h), xz.y.sub(field.z0).mul(k).add(h));
};

/** How far inside a field a point lies, as the blend weight toward it (0 outside). */
export const fieldWeight = (field, xz, blend = FIELD_BLEND[field.name] || 1) => {
    const inset = xz.x.sub(field.x0).min(float(field.x0 + field.span).sub(xz.x))
        .min(xz.y.sub(field.z0)).min(float(field.z0 + field.span).sub(xz.y));
    return smoothstep(0.0, blend, inset);
};

/**
 * The land at a world xz as one surface: (height in metres, dh/dx, dh/dz, sky visibility) from
 * the finest field that holds the point, blended across each field's edge band. `tex` maps a
 * field name to its texture; `level` is an explicit mip level (0).
 */
export function landAt(tex, xz) {
    const read = (name) => {
        const f = FIELDS[name];
        const t = texture(tex[name], fieldUV(f, xz)).level(0);
        return vec4(t.x.mul(f.hi - f.lo).add(f.lo), t.y, t.z, t.w);
    };
    const far = read('far');
    const mid = read('mid');
    const near = read('near');
    const wm = fieldWeight(FIELDS.mid, xz);
    const wn = fieldWeight(FIELDS.near, xz);
    return mix(mix(far, mid, wm), near, wn);
}

/** Only the land's height (three taps, blended): what a shadow march reads. */
export function heightAt(tex, xz) {
    const read = (name) => {
        const f = FIELDS[name];
        return texture(tex[name], fieldUV(f, xz)).level(0).x.mul(f.hi - f.lo).add(f.lo);
    };
    const wm = fieldWeight(FIELDS.mid, xz);
    const wn = fieldWeight(FIELDS.near, xz);
    return mix(mix(read('far'), read('mid'), wm), read('near'), wn);
}

/** A per-field scalar target (sun visibility, drainage) blended the same way. */
export function fieldScalar(tex, xz, fallback = 1) {
    const read = (name) => (tex[name] ? texture(tex[name], fieldUV(FIELDS[name], xz)).x : float(fallback));
    const wm = fieldWeight(FIELDS.mid, xz);
    const wn = fieldWeight(FIELDS.near, xz);
    return mix(mix(read('far'), read('mid'), wm), read('near'), wn);
}

// ── The scene's state ─────────────────────────────────────────────────────────────

/** Pigment ribbons running along beds at once (locks). */
export const RIBBONS = 10;
/** Light waves climbing the strata at once (clears). */
export const WAVES = 6;

const rows = (count) => Array.from({ length: count }, () => new THREE.Vector4(0, 0, 0, 0));
const colour = (r, g, b) => uniform(new THREE.Vector3(r, g, b));

export function createUniforms() {
    const tables = {
        // per ribbon: (origin x, origin z, geological height, start time)
        //           + (rgb, power) + (heading x, heading z, speed m/s, reach m)
        ribbons: rows(RIBBONS * 3),
        // the flood's four rows' pigments (rgb, unused)
        floodRows: rows(4),
        // per wave: (g low, g high, start time, power) + (rgb, kind)
        waves: rows(WAVES * 2),
    };
    return {
        tables,
        ribbons: uniformArray(tables.ribbons, 'vec4'),
        waves: uniformArray(tables.waves, 'vec4'),
        floodRows: uniformArray(tables.floodRows, 'vec4'),
        ribbonCount: uniform(0, 'int'),
        waveCount: uniform(0, 'int'),

        time: uniform(0),
        /** The cloud deck's drift (metres, integrated on the CPU). */
        wind: uniform(new THREE.Vector2(0, 0)),
        cloudCover: uniform(0.32),

        eye: uniform(new THREE.Vector3(0, 172, 0)),
        camRight: uniform(new THREE.Vector3(1, 0, 0)),
        camUp: uniform(new THREE.Vector3(0, 1, 0)),
        camFwd: uniform(new THREE.Vector3(0, 0, -1)),
        tanHalfFov: uniform(0.36),
        aspect: uniform(16 / 9),
        /** Radians per pixel of the buffer drawn. */
        pixelAngle: uniform(0.0007),

        sunDir: uniform(new THREE.Vector3(0.6, 0.25, -0.75)),
        sunUp: uniform(1),
        sun: colour(4, 3, 2),
        fill: colour(0.2, 0.25, 0.4),
        bounce: colour(0.25, 0.12, 0.08),
        zenith: colour(0.06, 0.15, 0.42),
        horizon: colour(0.66, 0.62, 0.62),
        glow: colour(1.3, 0.9, 0.55),
        haze: colour(0.6, 0.57, 0.6),
        mist: colour(0.8, 0.74, 0.72),
        cloudLit: colour(1.6, 1.3, 1.0),
        cloudShade: colour(0.36, 0.38, 0.5),
        snow: colour(1.5, 1.35, 1.25),
        hazeDensity: uniform(1),
        mistDensity: uniform(0.5),
        stars: uniform(0),

        /** Rain on the land (0..1) and where the shower's front stands (metres from the eye). */
        wet: uniform(0),
        showerFront: uniform(0),
        showerPower: uniform(0),
        /** The rainbow after a chain: (strength, secondary, age). */
        bow: uniform(new THREE.Vector3(0, 0, 0)),
        /** Four lines: the flood's front (metres down the river) and its power. */
        flood: uniform(new THREE.Vector2(-1, 0)),
        floodColour: colour(0.6, 0.3, 0.2),
        /** Perfect clear: the clouds take the record's colours (0..1). */
        paint: uniform(0),
        /** Back-to-back: the strata's sheen (0..1). */
        sheen: uniform(0),
        /** Game over: the light falls (0..1). */
        dusk: uniform(0),
        /** The pavilion's lanterns and the boardwalk's lamps (0 off … 1 lit). */
        lamps: uniform(0),
        /** The record's newest bed is settling (1 → 0) and where the record's top stands (g). */
        settle: uniform(0),
        /** The newest record bed's glow (1 when it is laid down, fading). */
        fresh: uniform(0),
        recordTop: uniform(160),
        recordHead: uniform(RECORD_ROWS - 1),
        recordCount: uniform(0),
    };
}

/**
 * High Coast — shared TSL: the uniforms every part reads, the baked textures, and the readers
 * of the land (the three nested fields as one surface).
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
    smoothstep,
    texture,
    uniform,
    uniformArray,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    EYE, FIELDS, FIELD_BLEND, mulberry32,
} from './high-coast-core.js';

export * from './high-coast-core.js';

// ── Small helpers ─────────────────────────────────────────────────────────────────

/** vec2 → [0, 1) */
export const hcHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'hc_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec2 → vec2 in [0, 1) */
export const hcHash22 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(vec3(0.1031, 0.103, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.xx.add(p3.yz).mul(p3.zy));
}).setLayout({ name: 'hc_hash22', type: 'vec2', inputs: [{ name: 'pIn', type: 'vec2' }] });

export const hcLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));
export const hcMax3 = (c) => max(c.x, max(c.y, c.z));

// ── Baked textures ────────────────────────────────────────────────────────────────

export const NOISE_SIZE = 256;

/**
 * Tileable value-noise fBm, four independent fields (RGBA) at lattice periods 8, 16, 32 and 64
 * across the tile: broad, mid, fine, and grain.
 */
export function bakeNoise(size = NOISE_SIZE, seed = 0xc0a5) {
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
    tex.name = 'high-coast-noise';
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
    tex.name = 'high-coast-lattice';
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

/**
 * A field's GPU form: (height normalised to its [lo, hi], dh/dx, dh/dz, sky) as half floats, the
 * slope read off the heights a little smoothed (a Sobel pair) so a normal per cell never shows
 * as a grid of dots.
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
    tex.name = `high-coast-${field.name}`;
    tex.needsUpdate = true;
    return tex;
}

/** The forest cover of a field (8-bit red). */
export function createCoverTexture(cover, field) {
    const tex = new THREE.DataTexture(cover, field.size, field.size, THREE.RedFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = `high-coast-${field.name}-cover`;
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
 * the finest field that holds the point, blended across each field's edge band.
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

/** Only the land's height (three taps, blended): what a shadow or a reflection march reads. */
export function heightAt(tex, xz) {
    const read = (name) => {
        const f = FIELDS[name];
        return texture(tex[name], fieldUV(f, xz)).level(0).x.mul(f.hi - f.lo).add(f.lo);
    };
    const wm = fieldWeight(FIELDS.mid, xz);
    const wn = fieldWeight(FIELDS.near, xz);
    return mix(mix(read('far'), read('mid'), wm), read('near'), wn);
}

/** A per-field scalar texture (forest cover, sun visibility) blended the same way. */
export function fieldScalar(tex, xz, fallback = 1) {
    const read = (name) => (tex[name] ? texture(tex[name], fieldUV(FIELDS[name], xz)).level(0).x : float(fallback));
    const wm = fieldWeight(FIELDS.mid, xz);
    const wn = fieldWeight(FIELDS.near, xz);
    return mix(mix(read('far'), read('mid'), wm), read('near'), wn);
}

// ── The scene's state ─────────────────────────────────────────────────────────────

/** Gusts (cat's paws) crossing the water at once (locks and hard drops). */
export const GUSTS = 8;

const rows = (count) => Array.from({ length: count }, () => new THREE.Vector4(0, 0, 0, 0));
const colour = (r, g, b) => uniform(new THREE.Vector3(r, g, b));

export function createUniforms() {
    const tables = {
        // per gust: (origin x, origin z, start time, power) + (heading x, heading z, speed m/s, width m)
        //         + (the piece colour, linear rgb; unused)
        gusts: rows(GUSTS * 3),
    };
    return {
        tables,
        gusts: uniformArray(tables.gusts, 'vec4'),

        time: uniform(0),
        /** The cloud deck's drift (metres, integrated on the CPU). */
        wind: uniform(new THREE.Vector2(0, 0)),
        cloudCover: uniform(0.3),

        eye: uniform(new THREE.Vector3(EYE.x, EYE.y, EYE.z)),
        camRight: uniform(new THREE.Vector3(1, 0, 0)),
        camUp: uniform(new THREE.Vector3(0, 1, 0)),
        camFwd: uniform(new THREE.Vector3(0, 0, -1)),
        tanHalfFov: uniform(0.36),
        aspect: uniform(16 / 9),
        /** Radians per pixel of the buffer drawn. */
        pixelAngle: uniform(0.0007),

        sunDir: uniform(new THREE.Vector3(0.42, 0.08, -0.9)),
        /** How much of the disc stands clear of the far shore: the direct light's last gate. */
        sunUp: uniform(1),
        /** How far the sky is in daylight (0 the light night, 1 day): a few degrees either side of the horizon. */
        day: uniform(1),
        sun: colour(3.7, 2.25, 1.05),
        fill: colour(0.12, 0.19, 0.4),
        bounce: colour(0.16, 0.1, 0.07),
        zenith: colour(0.035, 0.12, 0.44),
        horizon: colour(0.82, 0.62, 0.5),
        glow: colour(1.75, 0.95, 0.42),
        haze: colour(0.6, 0.52, 0.5),
        mist: colour(0.82, 0.68, 0.6),
        cloudLit: colour(1.95, 1.25, 0.7),
        cloudShade: colour(0.4, 0.42, 0.62),
        water: colour(0.006, 0.03, 0.068),
        hazeDensity: uniform(1),
        mistDensity: uniform(0.08),
        stars: uniform(0),
        /** Windows, the lighthouse and boat lights (0 off … 1 lit). */
        lamps: uniform(0),
        /** Game over: the light falls (0..1). */
        dusk: uniform(0),

        // ── The rising land ──
        /** The sea's level (metres; 0 at rest, lower as the land rises). */
        sea: uniform(0),
        /** The top of the wet band (metres): rock between `sea` and here has just come out of it. */
        wetLine: uniform(0),
        /** The sea running off newly risen rock (0..1) and the time it last rose. */
        drain: uniform(0),
        /** A released chain's swell: (strength, the front's distance from the open sea, age). */
        swell: uniform(new THREE.Vector3(0, 0, 0)),
        /** Perfect clear: the sea's calm (0 wind … 1 glass) and where the returning breeze stands. */
        calm: uniform(0),
        calmFront: uniform(0),
        /** The wind on the water (1 at rest … ~2 in a long hot chain): ripple strength, the fleet's heel. */
        breeze: uniform(1),
        /** Back-to-back: the lighthouse (strength 0..1, beam). */
        beacon: uniform(new THREE.Vector2(0, 0)),
        /** The flare on the wet rock (a four-line clear ~1; stacked quads, waves and the crown up to ~1.6). */
        rebound: uniform(0),
        /**
         * How hot play runs (shared/gameplay-surge.js): (level 0..1, fever 0..1, the spinnakers'
         * glow, the gold the wet risen rock takes on).
         */
        heat: uniform(new THREE.Vector4(0, 0, 0, 0)),
    };
}

/**
 * Spring — shared TSL: the small pure helpers every part uses, the baked noise textures, and the
 * uniforms every part reads.
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
    texture,
    uniform,
    uniformArray,
    vec2,
    vec3,
} from 'three/tsl';
import { mulberry32 } from './spring-core.js';

export * from './spring-core.js';

// ── Small helpers ─────────────────────────────────────────────────────────────────

/** vec2 → [0, 1) */
export const spHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'sp_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec2 → vec2 in [0, 1) */
export const spHash22 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(vec3(0.1031, 0.103, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.xx.add(p3.yz).mul(p3.zy));
}).setLayout({ name: 'sp_hash22', type: 'vec2', inputs: [{ name: 'pIn', type: 'vec2' }] });

export const spLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));
export const spMax3 = (c) => max(c.x, max(c.y, c.z));

// ── Baked textures ────────────────────────────────────────────────────────────────

export const NOISE_SIZE = 256;

/**
 * Tileable value-noise fBm, four independent fields (RGBA) at lattice periods 8, 16, 32 and 64
 * across the tile: broad, mid, fine, and grain. A feature in channel c is (tile / period) wide.
 */
export function bakeNoise(size = NOISE_SIZE, seed = 0x5b12) {
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
    // The ground is mostly seen at a grazing angle: without this its far reads blur to their mean.
    tex.anisotropy = 8;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'spring-noise';
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
export function bakeLattice(seed = 0x7a31, size = LATTICE_SIZE) {
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
    tex.name = 'spring-lattice';
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

// ── The scene's state ─────────────────────────────────────────────────────────────

/** Patches of bloom on the knoll alive at once (one a lock; the oldest is reused). */
export const PATCHES = 8;
/** Surges (line clears) running down the river at once. */
export const SURGES = 8;

/** Rows of the `palette` table: the seven flowers' colours (spare: their state). */
export const PALETTE_ROWS = Object.freeze({ colour: 0, count: 7 });
/** Rows of the `events` table: two per patch of bloom, one per river surge. */
export const EVENT_ROWS = Object.freeze({
    patch: 0,
    surge: PATCHES * 2,
    count: PATCHES * 2 + SURGES,
});

const rows = (count) => Array.from({ length: count }, () => new THREE.Vector4(0, 0, 0, 0));
const colour = (r, g, b) => uniform(new THREE.Vector3(r, g, b));

/**
 * The uniforms every part reads. Two tables (a stage may bind only twelve uniform buffers):
 *   palette  rows 0..6  the seven flowers (linear r, g, b, spare)
 *   events   per patch  (x, z, born, power) + (flower slot, radius m, spare × 2): a patch of one
 *                       kind of flower bursting into bloom where a lock landed
 *            per surge  (born, power, spare × 2): a wave of white water down the rapids
 */
export function createUniforms() {
    const tables = {
        palette: rows(PALETTE_ROWS.count),
        events: rows(EVENT_ROWS.count),
    };
    for (let k = 0; k < PATCHES; k++) {
        tables.events[EVENT_ROWS.patch + k * 2].set(0, 0, -1e6, 0);
        tables.events[EVENT_ROWS.patch + k * 2 + 1].set(-1, 1, 0, 0);
    }
    for (let k = 0; k < SURGES; k++) tables.events[EVENT_ROWS.surge + k].set(-1e6, 0, 0, 0);
    return {
        tables,
        palette: uniformArray(tables.palette, 'vec4'),
        events: uniformArray(tables.events, 'vec4'),

        time: uniform(0),
        /** The cloud deck's drift (metres, integrated on the CPU). */
        wind: uniform(new THREE.Vector2(0, 0)),
        /** How hard the breeze leans the plants and the trees (1 calm … 1.6 a long chain). */
        gust: uniform(1),

        eye: uniform(new THREE.Vector3(0, 8.2, 0)),
        camRight: uniform(new THREE.Vector3(1, 0, 0)),
        camUp: uniform(new THREE.Vector3(0, 1, 0)),
        camFwd: uniform(new THREE.Vector3(0, 0, -1)),
        tanHalfFov: uniform(0.4),
        aspect: uniform(16 / 9),
        /** Radians per pixel of the buffer drawn. */
        pixelAngle: uniform(0.0007),

        // ── The light (spring-hours.js) ──
        sunDir: uniform(new THREE.Vector3(0.9, 0.4, 0.2)),
        /** How much of the sun reaches the valley floor (0 behind the skyline … 1). */
        sunUp: uniform(1),
        /** The sun's height and the skyline's at its bearing (degrees): the land lifts high ground. */
        sunEl: uniform(26),
        skyline: uniform(10),
        sun: colour(4.0, 3.62, 3.0),
        fill: colour(0.2, 0.32, 0.6),
        bounce: colour(0.12, 0.14, 0.08),
        zenith: colour(0.022, 0.11, 0.5),
        horizon: colour(0.55, 0.66, 0.82),
        glow: colour(1.0, 0.95, 0.85),
        haze: colour(0.42, 0.52, 0.72),
        mist: colour(0.76, 0.8, 0.88),
        cloudLit: colour(1.92, 1.88, 1.82),
        cloudShade: colour(0.5, 0.56, 0.72),
        water: colour(0.011, 0.02, 0.017),
        hazeDensity: uniform(0.36),
        mistDensity: uniform(0.12),
        cloudCover: uniform(0.28),
        /** How far the flowers are open (wood anemones close at night) and the dew on them. */
        open: uniform(0.78),
        dew: uniform(0.5),
        /** How far the sky is in daylight (0 the light night … 1 day): the sky-side light. */
        day: uniform(1),
        /** Game over's dusk (0 … 1). */
        dusk: uniform(0),

        // ── Gameplay ──
        /** Back-to-back: the river's glitter while the run lasts (0..1). */
        glory: uniform(0),
        /** A line clear's flush of bloom over the whole meadow (0..1). */
        flush: uniform(0),

        // ── The river ──
        /** The water's own clock (s): integrated on the CPU at the flood's pace. */
        flowClock: uniform(0),
        /** The spring flood's rise over the river's rest level (m) and its extra white water. */
        flood: uniform(0),
        foamBoost: uniform(0),
        /** A T-spin: the whirlpool in the plunge pool (start time, strength). */
        whirl: uniform(new THREE.Vector2(-1e6, 0)),
    };
}

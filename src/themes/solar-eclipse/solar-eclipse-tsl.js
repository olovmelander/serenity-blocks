/**
 * Solar Eclipse — shared TSL: the uniforms every part reads, the baked noise and crest lines.
 *
 * One set of uniforms (createUniforms) is the scene's state on the GPU: where the sun stands and
 * how large it is, where the moon is, the light of the hour, and the small tables the gameplay
 * writes (the prominences on the limb, the motes in the air, the extra streamers of the cycle).
 * Parts never keep copies: the world writes, the materials read.
 *
 * Everything in the sky is drawn at one radius round the lens, so a thing is a DIRECTION; the sun
 * and all it wears are drawn in the lens's image plane, in solar radii from the sun's centre
 * (sunPlane()), so the sun is a true circle on screen at any field of view, even at the edge of
 * a phone's wide frame.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    dot,
    exp,
    fract,
    max,
    texture,
    uniform,
    uniformArray,
    vec2,
    vec3,
} from 'three/tsl';
import {
    MIRROR, NOISE_SIZE, PROMINENCES, RANGES, RIDGE_SAMPLES, STREAMERS, WORLD, bakeNoise,
} from './solar-eclipse-core.js';

/** vec2 → [0,1) */
export const seHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'se_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

export const seLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));
export const seMax3 = (c) => max(c.x, max(c.y, c.z));
/** e^(−x²). */
export const seGauss = (x) => exp(x.mul(x).negate());

// ── The baked textures ───────────────────────────────────────────────────────────

/** The baked noise as a repeating texture; `data` is bakeNoise()'s. */
export function createNoiseTexture(data = bakeNoise()) {
    const tex = new THREE.DataTexture(data, NOISE_SIZE, NOISE_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
}

/** Sample the noise at an explicit level (where a coordinate wraps or jumps). */
export const noiseAt = (tex, uvNode, level = 0) => texture(tex, uvNode).level(level);

/**
 * The ranges' crest lines as one half-float texture, two rows: (crest 0, 1, 2, 3) and
 * (crest 4, 5, the sunlit range's slope, the far range's slope). Altitudes in radians; read at
 * level 0 with linear filtering, so a peak is exact to a sample (0.1°).
 */
export function createRangeTexture(ranges) {
    const n = RIDGE_SAMPLES;
    const data = new Uint16Array(n * 2 * 4);
    const half = THREE.DataUtils.toHalfFloat;
    const { crests, slopes } = ranges;
    for (let i = 0; i < n; i += 1) {
        for (let c = 0; c < 4; c += 1) data[i * 4 + c] = half(crests[c][i]);
        const o = (n + i) * 4;
        data[o] = half(crests[4][i]);
        data[o + 1] = half(crests[5][i]);
        data[o + 2] = half(slopes[0][i]);
        data[o + 3] = half(slopes[1][i]);
    }
    const tex = new THREE.DataTexture(data, n, 2, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
}

if (RANGES.length !== 6) throw new Error('solar-eclipse: the range texture packs exactly six crests');

// ── The scene's state ────────────────────────────────────────────────────────────

/** Motes in the air at once (a lock's flight from the card to the limb). */
export const STREAKS = 16;

const rows = (count) => Array.from({ length: count }, () => new THREE.Vector4(0, 0, 0, 0));
const colour = (r, g, b) => uniform(new THREE.Vector3(r, g, b));

export function createUniforms() {
    const tables = {
        // per prominence: (limb angle, half-width, height, seed)
        //               + (born, erupts (or 1e6), fades (or 1e6), kind)
        //               + (rgb, power)
        prominences: rows(PROMINENCES * 3),
        // per mote: (from xyz, start time) + (to xyz, duration) + (rgb, power)
        //         + (kind, tail length as a share of the path, width in pixels, bow)
        streaks: rows(STREAKS * 4),
        // per extra streamer: (position angle off the solar equator, base half-width, strength, seed)
        streamers: rows(STREAMERS),
        // per ripple on the mirror: (ground x, ground z in metres, dropped at, strength)
        //                         + (kind: 0 a ring, 1 a whirl; its turn; −; −)
        ripples: rows(MIRROR.ripples * 2),
    };
    return {
        tables,
        prominences: uniformArray(tables.prominences, 'vec4'),
        streaks: uniformArray(tables.streaks, 'vec4'),
        streamers: uniformArray(tables.streamers, 'vec4'),
        ripples: uniformArray(tables.ripples, 'vec4'),

        /** The water gone to glass (a chain): the swell and the wind's patches die down, 0..1. */
        glass: uniform(0),
        /** The diamond's light on the water: (its world direction, power), the glitter path. */
        glint: uniform(new THREE.Vector4(0, 0.15, -0.99, 0)),
        /** The shadow bands racing over the salt as the light breaks through, 0..1. */
        bands: uniform(0),

        time: uniform(0),

        /** The sun's direction (core.js sunFrame). */
        sunDir: uniform(new THREE.Vector3(0, 0.2, -0.98)),
        /** The lens's basis, and the sun's centre in its image plane (tangents of the lens's axis). */
        camRight: uniform(new THREE.Vector3(1, 0, 0)),
        camUp: uniform(new THREE.Vector3(0, 1, 0)),
        camFwd: uniform(new THREE.Vector3(0, 0, -1)),
        sunAt: uniform(new THREE.Vector2(-0.3, 0.05)),
        /** The sun's radius in the image plane (the tangent of its angular radius on the axis). */
        sunTan: uniform(0.045),
        /** Solar radii per pixel of the buffer really drawn, and per pixel of a 1080-line frame. */
        pxR: uniform(0.012),
        designR: uniform(0.012),
        /** Angles of one pixel of a 1080-line frame and of the buffer (for the motes). */
        design: uniform(0.0005),
        texel: uniform(0.0005),

        /** The solar axis on the sky (radians from vertical) and the cycle (0 min … 1 max). */
        axis: uniform(0.3),
        cycle: uniform(0.1),
        /** The chain's long exposure, 0..1. */
        exposure: uniform(0),
        /** A T-spin's twist of the corona, radians at the limb. */
        twist: uniform(0),
        /** The corona's swell on a clear, 0..1. */
        surge: uniform(0),
        /** The moon: (offset x, offset y in solar radii, radius over the sun's, earthshine 0..1). */
        moon: uniform(new THREE.Vector4(0, 0, 1.02, 0)),
        /** The diamond: (bead x, bead y in solar radii, power, spike turn). */
        diamond: uniform(new THREE.Vector4(1, 0, 0, 0)),
        /**
         * The bead necklace the clears send round the limb: (its turn, when it began, count, light).
         * The world turns it and lights it; a fractional count is a bead splitting off the first.
         */
        beads: uniform(new THREE.Vector4(0, -100, 0, 0)),
        /** The chromosphere's flash (a level, a clear), 0..1. */
        flash: uniform(0),
        /** Two coronal mass ejections, each (position angle, start time, power, width). */
        cme: uniform(new THREE.Vector4(0, -100, 0, 0.6)),
        cme2: uniform(new THREE.Vector4(0, -100, 0, 0.6)),
        /** Daylight returning for the moment the diamond burns, 0..1. */
        daylight: uniform(0),
        /** The bearing the moon's shadow ends nearest (core.js umbraAzAt), radians east of north. */
        umbraAz: uniform(0.5),

        zenith: colour(0.0035, 0.006, 0.02),
        mid: colour(0.013, 0.014, 0.04),
        horizon: colour(0.075, 0.032, 0.052),
        glow: colour(0.5, 0.2, 0.055),
        haze: colour(0.13, 0.058, 0.048),
        ridge: colour(0.0045, 0.005, 0.011),
        alpen: colour(0.64, 0.28, 0.11),
        coronaIn: colour(1.0, 0.93, 0.82),
        coronaOut: colour(0.84, 0.88, 1.0),
        chromo: colour(1.0, 0.16, 0.3),
        earth: colour(0.45, 0.55, 0.8),
        glowHeight: uniform(0.035),
        starPower: uniform(1),
        alpenPower: uniform(1),
    };
}

// ── Frames and sizes ─────────────────────────────────────────────────────────────

/**
 * An angle for something `pixels` wide on a 1080-line frame, never thinner than `least` pixels
 * of the buffer really drawn.
 */
export const sized = (u, pixels, least) => max(u.design.mul(pixels), u.texel.mul(least));

/** The same in solar radii, for what is drawn in the sun's plane. */
export const sizedR = (u, pixels, least) => max(u.designR.mul(pixels), u.pxR.mul(least));

/**
 * A world direction → the sun's plane: vec3(x, y in solar radii from the sun's centre, how far it
 * faces the lens's axis). The image plane of the lens, so a circle in it is a circle on screen.
 */
export const sunPlane = (u, d) => {
    const f = dot(d, u.camFwd);
    const inv = max(f, 1e-4);
    return vec3(vec2(dot(d, u.camRight), dot(d, u.camUp)).div(inv).sub(u.sunAt).div(u.sunTan), f);
};

/** The crest table's horizontal coordinate for an azimuth (radians). */
export const crestU = (az, span) => az.div(span).add(1.0).mul(0.5).mul((RIDGE_SAMPLES - 1) / RIDGE_SAMPLES)
    .add(0.5 / RIDGE_SAMPLES);

/** The sky's own radius, for the parts. */
export const SKY_RADIUS = WORLD.skyRadius;

export { vec2 };

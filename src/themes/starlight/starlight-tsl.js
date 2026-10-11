/**
 * Starlight — shared TSL: the uniforms every part reads, the baked noise, the sky's frames, the
 * far hills and the water.
 *
 * One set of uniforms (createUniforms) is the scene's state on the GPU: the sky's angle round the
 * pole, how far the shutter is open, the light of the hour, and the small tables the gameplay
 * writes (streaks in the air, rings on the water, the figures' light). Parts never keep copies:
 * the world writes, the materials read.
 *
 * Everything in the sky is drawn at one radius round the lens, so a thing is a DIRECTION. The
 * water repeats the sky: mirrorDir() turns a direction into where the lake shows it, bent by the
 * same slopes (waterSlope) the sky's own mirror ray reads, so a star and its reflection in the
 * Milky Way's reflection stay together.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    atan,
    clamp,
    cos,
    dot,
    exp,
    float,
    fract,
    length,
    log2,
    max,
    mix,
    normalize,
    pow,
    sin,
    smoothstep,
    texture,
    uniform,
    uniformArray,
    vec2,
    vec3,
} from 'three/tsl';
import {
    FIGURES_KEPT, NOISE_SIZE, TAU, WORLD, bakeNoise,
} from './starlight-core.js';

/** vec2 → [0,1) */
export const slHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'sl_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

export const slLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));
export const slMax3 = (c) => max(c.x, max(c.y, c.z));
/** e^(−x²). */
export const slGauss = (x) => exp(x.mul(x).negate());

// ── The noise texture ────────────────────────────────────────────────────────────

/** The baked noise as a repeating texture; `data` is bakeNoise()'s (the world keeps it too). */
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

/** Sample the noise at an explicit level (vertex stage, or where an angle wraps). */
export const noiseAt = (tex, uvNode, level = 0) => texture(tex, uvNode).level(level);

// ── The scene's state ────────────────────────────────────────────────────────────

/** Streaks in the air at once: shooting stars, a fireball and its train, the motes of locks. */
export const STREAKS = 16;
/** Rings on the water at once. */
export const RINGS = 6;

const rows = (count) => Array.from({ length: count }, () => new THREE.Vector4(0, 0, 0, 0));
const colour = (r, g, b) => uniform(new THREE.Vector3(r, g, b));

export function createUniforms() {
    const tables = {
        // per streak: (from xyz, start time) + (to xyz, duration) + (rgb, power)
        //           + (kind, tail length as a share of the path, width in pixels, bow)
        streaks: rows(STREAKS * 4),
        // per ring: (x, z, radius, strength) + (rgb, width)
        rings: rows(RINGS * 2),
        // per kept figure: (light 0..1, flare, 0, 0); the last row is the catalogue's own glints
        figures: rows(FIGURES_KEPT + 1),
    };
    return {
        tables,
        streaks: uniformArray(tables.streaks, 'vec4'),
        rings: uniformArray(tables.rings, 'vec4'),
        figures: uniformArray(tables.figures, 'vec4'),

        time: uniform(0),
        /** The sky's turn round the pole, radians: accumulated, so a change of pace never jumps. */
        skyAngle: uniform(0),
        /** The trail every star draws behind it, radians round the pole. */
        exposure: uniform(0),
        /** The chain: 0 at rest, toward 1. */
        shutter: uniform(0),
        /** The Milky Way swelling on a great clear, 0..1. */
        surge: uniform(0),
        /** A fireball's light: (where it is, unit world direction; power). */
        flash: uniform(new THREE.Vector4(0, 1, 0, 0)),

        /** The pole and the two unit vectors across it (starlight-core.js poleFrame). */
        pole: uniform(new THREE.Vector3(0, 0.42, -0.9)),
        poleUp: uniform(new THREE.Vector3(0, 0.9, 0.42)),
        poleWest: uniform(new THREE.Vector3(-1, 0, 0)),

        camRight: uniform(new THREE.Vector3(1, 0, 0)),
        camUp: uniform(new THREE.Vector3(0, 1, 0)),
        /**
         * Sizes are authored in pixels of a 1080-line frame, so a star covers the same share of
         * the sky on a phone's small buffer as on a 4K screen: `design` is the angle of one such
         * pixel, `texel` the angle of one pixel of the buffer really drawn (see sized()).
         */
        design: uniform(0.001),
        texel: uniform(0.001),

        zenith: colour(0.0035, 0.0055, 0.016),
        mid: colour(0.007, 0.011, 0.03),
        horizon: colour(0.034, 0.052, 0.105),
        airglow: colour(0.012, 0.04, 0.034),
        band: colour(0.62, 0.7, 1.0),
        core: colour(1.0, 0.8, 0.56),
        nebula: colour(1.0, 0.24, 0.42),
        water: colour(0.003, 0.006, 0.014),
        ridge: colour(0.004, 0.006, 0.013),
        line: colour(0.56, 0.74, 1.0),
        meteor: colour(0.7, 1.0, 0.9),
        bandPower: uniform(1),
        starPower: uniform(1),
        glowHeight: uniform(0.11),
    };
}

// ── The sky's frames ─────────────────────────────────────────────────────────────

/**
 * An angle for something `pixels` wide on a 1080-line frame, never thinner than `least` pixels
 * of the buffer really drawn (a thing thinner than a pixel crawls as the sky turns).
 */
export const sized = (u, pixels, least) => max(u.design.mul(pixels), u.texel.mul(least));

/** A sky direction (cos ρ, sin ρ, angle round the pole) → its unit world direction. */
export const skyDir = (u, cosRho, sinRho, angle) => u.pole.mul(cosRho)
    .add(u.poleUp.mul(cos(angle)).add(u.poleWest.mul(sin(angle))).mul(sinRho));

/** The direction a sky direction is moving in as the sky turns (unit, across the pole). */
export const skyTangent = (u, angle) => u.poleWest.mul(cos(angle)).sub(u.poleUp.mul(sin(angle)));

/** A star's colour from its temperature: 0 ember … 0.5 white … 1 blue. */
export const starColour = (temp) => {
    const ember = vec3(1.0, 0.5, 0.26);
    const gold = vec3(1.0, 0.8, 0.52);
    const white = vec3(1.0, 0.96, 0.92);
    const blue = vec3(0.6, 0.74, 1.0);
    const warm = mix(ember, gold, smoothstep(0.0, 0.26, temp));
    const cool = mix(white, blue, smoothstep(0.55, 1.0, temp));
    return mix(warm, cool, smoothstep(0.24, 0.56, temp));
};

// ── The far hills ────────────────────────────────────────────────────────────────

/**
 * The hills on the horizon in a world direction: (near crest, far crest), as heights in the
 * direction's own y (the sine of the altitude). Read at an explicit level, so it is the same in
 * a vertex and in a fragment and has no seam where the azimuth wraps.
 */
export const ridges = (noise, d) => {
    const ua = atan(d.x, d.z.negate()).div(TAU);
    const far = noiseAt(noise, vec2(ua.mul(3.0).add(0.13), 0.21)).r;
    const farFine = noiseAt(noise, vec2(ua.mul(19.0), 0.77)).g;
    const near = noiseAt(noise, vec2(ua.mul(5.0).add(0.61), 0.52)).g;
    const nearFine = noiseAt(noise, vec2(ua.mul(41.0), 0.34)).b;
    const farCrest = pow(max(far.sub(0.22), 0.0), 1.6).mul(0.11).add(farFine.mul(0.007)).add(0.006);
    const nearCrest = pow(max(near.sub(0.34), 0.0), 1.9).mul(0.085).add(nearFine.mul(0.0045)).add(0.0025);
    return vec2(nearCrest, farCrest);
};

// ── The water ────────────────────────────────────────────────────────────────────

/**
 * The lake's slope at a point (world x, z in metres): a long slow swell, patches of fine ripple
 * where a breath of wind touches it, and the rings the board sends out. Small on purpose: the
 * lake is a mirror.
 */
export const waterSlope = (u, noise, p, tier) => {
    const t = u.time;
    const swell = vec2(0.94, 0.34).mul(cos(dot(p, vec2(0.94, 0.34)).mul(0.62).add(t.mul(0.42))).mul(0.0009))
        .add(vec2(-0.5, 0.87).mul(cos(dot(p, vec2(-0.5, 0.87)).mul(1.05).sub(t.mul(0.55))).mul(0.0007)))
        .add(vec2(0.2, -0.98).mul(cos(dot(p, vec2(0.2, -0.98)).mul(1.9).add(t.mul(0.8))).mul(0.0005)));
    let slope = swell;
    if (tier.ripples) {
        // Cat's paws: where the coarse read is high, a fine read roughens the mirror.
        const far = length(p);
        const paws = smoothstep(0.52, 0.8, noiseAt(noise, p.div(95.0).add(vec2(t.mul(0.004), 0.0)), 1.0).r);
        // Read softer with distance: far ripples are smaller than a pixel and would only crawl.
        const level = clamp(log2(max(far, 1.0).div(14.0)), 0.0, 6.0);
        const fine = noiseAt(noise, p.div(vec2(5.5, 9.0)).add(vec2(t.mul(0.021), t.mul(0.013))), level);
        const grain = vec2(fine.b.sub(0.5), fine.a.sub(0.5));
        slope = slope.add(grain.mul(paws.mul(0.011).add(0.0012)).mul(exp(far.div(-160.0)).mul(0.9).add(0.1)));
    }
    for (let i = 0; i < RINGS; i += 1) {
        const ring = u.rings.element(i * 2);
        const paint = u.rings.element(i * 2 + 1);
        const away = p.sub(ring.xy);
        const r = max(length(away), 1e-3);
        const x = r.sub(ring.z).div(max(paint.w, 1e-3));
        // A short train of ripples: a few crests inside one swell.
        const wave = sin(x.mul(2.4)).mul(exp(x.mul(x).mul(-0.4))).mul(ring.w);
        slope = slope.add(away.div(r).mul(wave).mul(0.02));
    }
    return slope;
};

/** The light riding the rings at a water point: each ring's crest in its piece's colour. */
export const ringLight = (u, p) => {
    let light = vec3(0.0, 0.0, 0.0);
    for (let i = 0; i < RINGS; i += 1) {
        const ring = u.rings.element(i * 2);
        const paint = u.rings.element(i * 2 + 1);
        const r = length(p.sub(ring.xy));
        const x = r.sub(ring.z).div(max(paint.w, 1e-3));
        const crest = max(cos(x.mul(2.4)), 0.0);
        light = light.add(paint.xyz.mul(crest.mul(crest)).mul(exp(x.mul(x).mul(-0.4))).mul(ring.w));
    }
    return light;
};

/** Where a ray from the lens going down in direction `d` (d.y < 0) meets the water: world (x, z). */
export const waterPoint = (eye, d) => eye.xz.add(d.xz.mul(eye.y.div(max(d.y.negate(), 1e-4))));

/**
 * Where the lake shows a sky direction `d` (d.y > 0): the mirrored direction, bent by the water's
 * slope at the point the mirrored ray meets it. The slope along the line of sight moves the
 * image up and down (twice the slope), the slope across it sideways (far less, at a grazing
 * angle).
 */
export const mirrorDir = (u, noise, eye, d, tier) => {
    const flat = vec3(d.x, d.y.negate(), d.z);
    const slope = waterSlope(u, noise, waterPoint(eye, flat), tier);
    const along = dot(slope, normalize(d.xz.add(vec2(1e-5, 0.0))));
    return vec3(
        flat.x.add(slope.x.mul(d.y).mul(2.0)),
        flat.y.add(along.mul(2.0)),
        flat.z.add(slope.y.mul(d.y).mul(2.0)),
    );
};

/** How much of the sky the water gives back at a downward direction: nearly all, at a glance. */
export const mirrorShare = (d) => mix(0.6, 0.94, exp(abs(d.y).mul(-5.0)));

/** The sky's own radius, for the parts. */
export const SKY_RADIUS = WORLD.skyRadius;

export const clamp01 = (x) => clamp(x, 0.0, 1.0);
export { float };

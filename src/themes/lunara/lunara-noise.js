/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Lunara Theme — Self-contained TSL noise primitives.
 *
 * Kept local to the theme (mirrors electric-dreams-v3/materials/tsl-noise-lib.js)
 * so Lunara does not couple to another in-progress theme. Provides the proper
 * value-noise FBM / domain-warp / ridged / voronoi / curl helpers used to replace
 * the old sin-field "nebula" hack and to drive crystals, ground veins, and motes.
 *
 * Leaf primitives are `Fn`-wrapped function nodes (reused, no graph bloat).
 * Octave-count builders (fbm3 / ridged3 / warpFbm3) are plain JS so the octave
 * count can vary per call site, matching the existing lunara-materials style.
 */

import {
    Fn,
    abs,
    dot,
    float,
    floor,
    fract,
    length,
    min,
    mix,
    sin,
    vec3,
} from 'three/tsl';

// 3D hash → scalar in [0,1). Cheap, decorrelated enough for value noise.
export const hash31 = /* @__PURE__ */ Fn(([pInput]) => {
    const p = vec3(pInput).toVar();
    p.assign(fract(p.mul(vec3(0.1031, 0.1030, 0.0973))));
    p.addAssign(dot(p, p.yzx.add(33.33)));
    return fract(p.x.add(p.y).mul(p.z));
});

// 3D hash → vec3 in [0,1)^3. Used for voronoi feature points and curl potential.
export const hash33 = /* @__PURE__ */ Fn(([pInput]) => {
    const p = vec3(
        dot(pInput, vec3(127.1, 311.7, 74.7)),
        dot(pInput, vec3(269.5, 183.3, 246.1)),
        dot(pInput, vec3(113.5, 271.9, 124.6)),
    ).toVar();
    return fract(sin(p).mul(43758.5453123));
});

// Standard 3D value noise (smoothstep interpolation of hashed lattice corners).
export const valueNoise3 = /* @__PURE__ */ Fn(([pInput]) => {
    const p = vec3(pInput).toVar();
    const i = floor(p).toVar();
    const f = fract(p).toVar();
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));

    const a = hash31(i);
    const b = hash31(i.add(vec3(1.0, 0.0, 0.0)));
    const c = hash31(i.add(vec3(0.0, 1.0, 0.0)));
    const d = hash31(i.add(vec3(1.0, 1.0, 0.0)));
    const e = hash31(i.add(vec3(0.0, 0.0, 1.0)));
    const f1 = hash31(i.add(vec3(1.0, 0.0, 1.0)));
    const g = hash31(i.add(vec3(0.0, 1.0, 1.0)));
    const h = hash31(i.add(vec3(1.0, 1.0, 1.0)));

    const x1 = mix(a, b, u.x);
    const x2 = mix(c, d, u.x);
    const x3 = mix(e, f1, u.x);
    const x4 = mix(g, h, u.x);
    return mix(mix(x1, x2, u.y), mix(x3, x4, u.y), u.z);
});

/**
 * Fractional Brownian Motion (value-noise sum). Plain JS builder so octaves can
 * vary per call site. Returns ~[0,1].
 */
export function fbm3(pInput, octaves = 5, lacunarity = 2.0, gain = 0.5) {
    let value = float(0.0);
    let amplitude = float(0.5);
    let coord = vec3(pInput);
    for (let i = 0; i < octaves; i++) {
        value = value.add(valueNoise3(coord).mul(amplitude));
        coord = coord.mul(lacunarity).add(vec3(1.7, 9.2, 3.4));
        amplitude = amplitude.mul(gain);
    }
    return value;
}

/**
 * Domain-warped FBM — warps the sample point by another FBM lookup. Produces the
 * swirling, turbulent gas look. `warpStrength` ~0.4–1.6.
 */
export function warpFbm3(pInput, warpStrength = 0.9, octaves = 5) {
    const p = vec3(pInput);
    const warp = vec3(
        fbm3(p, octaves),
        fbm3(p.add(vec3(5.2, 1.3, 7.1)), octaves),
        fbm3(p.add(vec3(1.7, 9.2, 3.4)), octaves),
    ).mul(warpStrength);
    return fbm3(p.add(warp), octaves);
}

/**
 * Ridged multifractal — sharp creases for alien peaks / electric veins.
 * Returns ~[0,1] with high values along ridge lines.
 */
export function ridged3(pInput, octaves = 4, lacunarity = 2.0, gain = 0.5) {
    let value = float(0.0);
    let amplitude = float(0.5);
    let coord = vec3(pInput);
    for (let i = 0; i < octaves; i++) {
        const n = abs(valueNoise3(coord).mul(2.0).sub(1.0));
        const ridge = float(1.0).sub(n);
        value = value.add(ridge.mul(ridge).mul(amplitude));
        coord = coord.mul(lacunarity).add(vec3(2.3, 4.1, 1.9));
        amplitude = amplitude.mul(gain);
    }
    return value;
}

/**
 * Voronoi (cellular) F1 distance over the 3×3×3 neighbourhood. Low near cell
 * centres, high along borders → invert for crack/vein networks and crystal facets.
 * Returns ~[0,1].
 */
export const voronoi3 = /* @__PURE__ */ Fn(([pInput]) => {
    const p = vec3(pInput).toVar();
    const ip = floor(p).toVar();
    const fp = fract(p).toVar();
    const minDist = float(1.5).toVar();

    for (let x = -1; x <= 1; x++) {
        for (let y = -1; y <= 1; y++) {
            for (let z = -1; z <= 1; z++) {
                const offset = vec3(x, y, z);
                const feature = hash33(ip.add(offset));
                const diff = offset.add(feature).sub(fp);
                minDist.assign(min(minDist, length(diff)));
            }
        }
    }
    return minDist;
});

/**
 * Cheap curl-of-noise vector field for organic particle advection. Built from a
 * sin-based vector potential with analytic-ish finite differences. Returns an
 * (unnormalised) vec3 roughly in [-1,1].
 */
export const curl3 = /* @__PURE__ */ Fn(([pInput]) => {
    const p = vec3(pInput).toVar();
    const e = float(0.25);

    // Vector potential components via offset sin fields (cheap, divergence-free-ish).
    const potential = Fn(([q]) => vec3(
        sin(q.y.mul(1.3).add(q.z.mul(0.7))),
        sin(q.z.mul(1.1).add(q.x.mul(0.9))),
        sin(q.x.mul(1.7).add(q.y.mul(0.5))),
    ));

    const dx = potential(p.add(vec3(e, 0.0, 0.0))).sub(potential(p.sub(vec3(e, 0.0, 0.0))));
    const dy = potential(p.add(vec3(0.0, e, 0.0))).sub(potential(p.sub(vec3(0.0, e, 0.0))));
    const dz = potential(p.add(vec3(0.0, 0.0, e))).sub(potential(p.sub(vec3(0.0, 0.0, e))));

    return vec3(
        dy.z.sub(dz.y),
        dz.x.sub(dx.z),
        dx.y.sub(dy.x),
    );
});

/**
 * GLSL source for a matching 3D value-noise FBM, for the WebGL2 fallback shaders.
 * Inject this string into a ShaderMaterial fragment shader (defines `fbm3`,
 * `valueNoise3`, `hash31`). Mirrors the TSL version above closely enough that the
 * two render paths look consistent.
 */
export const LUNARA_GLSL_NOISE3 = /* glsl */`
    float lunaraHash31(vec3 p3) {
        p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
    }
    float lunaraValueNoise3(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        vec3 u = f * f * (3.0 - 2.0 * f);
        float a = lunaraHash31(i);
        float b = lunaraHash31(i + vec3(1.0, 0.0, 0.0));
        float c = lunaraHash31(i + vec3(0.0, 1.0, 0.0));
        float d = lunaraHash31(i + vec3(1.0, 1.0, 0.0));
        float e = lunaraHash31(i + vec3(0.0, 0.0, 1.0));
        float f1 = lunaraHash31(i + vec3(1.0, 0.0, 1.0));
        float g = lunaraHash31(i + vec3(0.0, 1.0, 1.0));
        float h = lunaraHash31(i + vec3(1.0, 1.0, 1.0));
        float x1 = mix(a, b, u.x);
        float x2 = mix(c, d, u.x);
        float x3 = mix(e, f1, u.x);
        float x4 = mix(g, h, u.x);
        return mix(mix(x1, x2, u.y), mix(x3, x4, u.y), u.z);
    }
    float lunaraFbm3(vec3 p, int octaves) {
        float value = 0.0;
        float amp = 0.5;
        vec3 coord = p;
        for (int i = 0; i < 6; i++) {
            if (i >= octaves) break;
            value += lunaraValueNoise3(coord) * amp;
            coord = coord * 2.0 + vec3(1.7, 9.2, 3.4);
            amp *= 0.5;
        }
        return value;
    }
    vec3 lunaraWarpFbm3Vec(vec3 p, int octaves) {
        return vec3(
            lunaraFbm3(p, octaves),
            lunaraFbm3(p + vec3(5.2, 1.3, 7.1), octaves),
            lunaraFbm3(p + vec3(1.7, 9.2, 3.4), octaves)
        );
    }
`;

/**
 * @fileoverview Odyssey shared GLSL noise chunks
 *
 * Part of the Odyssey AAA "Cosmic Ascent" overhaul (Phase 4 — chapter level-up).
 * See docs/ODYSSEY_MODE_AAA_OVERHAUL_PLAN.md §4 (shared/odyssey-noise.js).
 *
 * These are plain GLSL source strings the chapter environment shaders concatenate
 * into their own programs, so all eight worlds share one battle-tested noise
 * vocabulary (value/simplex hash noise + fbm + ridged + curl) instead of each file
 * re-deriving its own. The module is intentionally THREE-free and side-effect-free:
 * it exports strings only, which keeps it trivially unit-testable and safe to import
 * in a headless test environment (no `document`, no WebGL context).
 *
 * Usage:
 *   import { ODYSSEY_NOISE_GLSL } from './shared/odyssey-noise.js';
 *   const fragmentShader = `
 *     ${ODYSSEY_NOISE_GLSL}
 *     void main() { float n = fbm3(vPos * 0.5 + uTime * 0.1); ... }
 *   `;
 *
 * All helpers are prefixed `od_` internally and re-exposed under friendly names so
 * they never clash with a chapter's own helpers.
 */

/**
 * Hash + gradient value-noise primitives (cheap, GPU-friendly, no texture lookups).
 * `od_hash*` -> deterministic pseudo-random; `od_noise2/3` -> smooth value noise.
 */
export const ODYSSEY_HASH_GLSL = /* glsl */ `
float od_hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float od_hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float od_hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
}

vec3 od_hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
}
`;

/**
 * Smooth value noise in 2D and 3D built on the hash primitives above.
 */
export const ODYSSEY_VALUE_NOISE_GLSL = /* glsl */ `
float od_noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = od_hash21(i + vec2(0.0, 0.0));
    float b = od_hash21(i + vec2(1.0, 0.0));
    float c = od_hash21(i + vec2(0.0, 1.0));
    float d = od_hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float od_noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    float n000 = od_hash31(i + vec3(0.0, 0.0, 0.0));
    float n100 = od_hash31(i + vec3(1.0, 0.0, 0.0));
    float n010 = od_hash31(i + vec3(0.0, 1.0, 0.0));
    float n110 = od_hash31(i + vec3(1.0, 1.0, 0.0));
    float n001 = od_hash31(i + vec3(0.0, 0.0, 1.0));
    float n101 = od_hash31(i + vec3(1.0, 0.0, 1.0));
    float n011 = od_hash31(i + vec3(0.0, 1.0, 1.0));
    float n111 = od_hash31(i + vec3(1.0, 1.0, 1.0));
    vec4 x = mix(
        vec4(n000, n010, n001, n011),
        vec4(n100, n110, n101, n111),
        u.x
    );
    vec2 y = mix(x.xz, x.yw, u.y);
    return mix(y.x, y.y, u.z);
}
`;

/**
 * Fractal Brownian motion + ridged + curl, layered on the value noise above.
 * `fbm2/fbm3` -> billowy clouds/nebulae; `ridged3` -> sharp filaments/crests;
 * `od_curl3` -> divergence-free flow field for swirling particles/accretion.
 */
export const ODYSSEY_FBM_GLSL = /* glsl */ `
float fbm2(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
    for (int i = 0; i < 5; i++) {
        value += amplitude * od_noise2(p);
        p = rot * p * 2.02;
        amplitude *= 0.5;
    }
    return value;
}

float fbm3(vec3 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
        value += amplitude * od_noise3(p);
        p *= 2.03;
        amplitude *= 0.5;
    }
    return value;
}

float ridged3(vec3 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
        float n = 1.0 - abs(od_noise3(p) * 2.0 - 1.0);
        value += amplitude * n * n;
        p *= 2.05;
        amplitude *= 0.5;
    }
    return value;
}

vec3 od_curl3(vec3 p) {
    const float e = 0.18;
    vec3 dx = vec3(e, 0.0, 0.0);
    vec3 dy = vec3(0.0, e, 0.0);
    vec3 dz = vec3(0.0, 0.0, e);
    float x1 = fbm3(p + dy) - fbm3(p - dy);
    float x2 = fbm3(p + dz) - fbm3(p - dz);
    float y1 = fbm3(p + dz) - fbm3(p - dz);
    float y2 = fbm3(p + dx) - fbm3(p - dx);
    float z1 = fbm3(p + dx) - fbm3(p - dx);
    float z2 = fbm3(p + dy) - fbm3(p - dy);
    return normalize(vec3(x1 - x2, y1 - y2, z1 - z2) / (2.0 * e) + 1e-5);
}
`;

/**
 * The full noise vocabulary in dependency order. Drop this one string into any
 * chapter shader's global scope and every helper above is available.
 */
export const ODYSSEY_NOISE_GLSL = `${ODYSSEY_HASH_GLSL}\n${ODYSSEY_VALUE_NOISE_GLSL}\n${ODYSSEY_FBM_GLSL}`;

/**
 * Convenience accessor so callers can request just the chunks they need without
 * importing each constant. Returns the requested chunks concatenated in dependency
 * order (hash is always included because everything depends on it).
 * @param {{ value?: boolean, fbm?: boolean }} [opts]
 * @returns {string}
 */
export function glslNoiseChunk(opts = {}) {
    const { value = true, fbm = true } = opts;
    const chunks = [ODYSSEY_HASH_GLSL];
    if (value || fbm) chunks.push(ODYSSEY_VALUE_NOISE_GLSL);
    if (fbm) chunks.push(ODYSSEY_FBM_GLSL);
    return chunks.join('\n');
}

export default ODYSSEY_NOISE_GLSL;

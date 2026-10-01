import {
    clamp,
    cos,
    dot,
    float,
    floor,
    fract,
    mix,
    sin,
    smoothstep,
    sqrt,
    vec2,
    vec3,
} from 'three/tsl';
import { reefCaustics } from './ocean-caustics.js';
/* eslint-disable import/no-unresolved */
/**
 * Ocean Theme — Shared TSL Helpers
 * Common TSL node functions used across ocean materials and post-processing.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Hash & Noise
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cheap 2D → 1D hash (sin-based)
 */
export function tslHash(p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
}

/**
 * Value noise (2D → 1D)
 */
export function tslNoise(p) {
    const i = floor(p);
    const f = fract(p);
    const smoothF = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));

    const a = tslHash(i);
    const b = tslHash(i.add(vec2(1.0, 0.0)));
    const c = tslHash(i.add(vec2(0.0, 1.0)));
    const d = tslHash(i.add(vec2(1.0, 1.0)));

    return mix(mix(a, b, smoothF.x), mix(c, d, smoothF.x), smoothF.y);
}

/**
 * Fractional Brownian Motion (2D, configurable octaves)
 */
export function tslFbm(p, octaves = 3) {
    let v = float(0.0);
    let a = float(0.5);
    let coord = p;
    for (let i = 0; i < octaves; i += 1) {
        v = v.add(a.mul(tslNoise(coord)));
        coord = coord.mul(2.0);
        a = a.mul(0.5);
    }
    return v;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gerstner Waves
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Single Gerstner wave displacement (returns vec3).
 * @param {vec2} dir     - wave direction (will be normalized internally)
 * @param {float} steep  - steepness
 * @param {float} wlen   - wavelength
 * @param {vec3} pos     - world position (uses xz)
 * @param {float} t      - time
 */
export function tslGerstnerWave(dir, steep, wlen, posXZ, t) {
    const k = float(6.28318).div(wlen);
    const c = sqrt(float(9.8).div(k));
    const d = dir; // assume pre-normalized
    const f = k.mul(dot(d, posXZ).sub(c.mul(t)));
    const a = float(steep).div(k);
    return vec3(d.x.mul(a).mul(cos(f)), a.mul(sin(f)), d.y.mul(a).mul(cos(f)));
}

/**
 * Sum multiple Gerstner waves. Returns vec3 displacement.
 * @param {vec2} posXZ - world xz of the vertex
 * @param {float} time - time uniform
 */
export function tslGerstnerSum(posXZ, time) {
    const t = time.mul(0.5);
    let wave = tslGerstnerWave(vec2(0.857, 0.514), float(0.2), float(25.0), posXZ, t);
    wave = wave.add(
        tslGerstnerWave(vec2(0.707, 0.707), float(0.15), float(18.0), posXZ, t.mul(1.1)),
    );
    wave = wave.add(
        tslGerstnerWave(vec2(-0.406, 0.914), float(0.1), float(12.0), posXZ, t.mul(0.9)),
    );
    wave = wave.add(
        tslGerstnerWave(vec2(0.976, -0.218), float(0.08), float(9.0), posXZ, t.mul(0.85)),
    );
    return wave;
}

// ─────────────────────────────────────────────────────────────────────────────
// Caustic Projector
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Two drifting samples of the shared refractive field, projected from world XZ.
 * Returns a float (0→1+) representing caustic brightness.
 * @param {vec2} worldXZ - positionWorld.xz
 * @param {float} time   - uTime
 * @param {float} scale  - spatial frequency multiplier (default 0.15)
 */
export function tslCausticProjection(worldXZ, time, scale = 0.15) {
    // The shared filtered light field follows the same current on rocks,
    // coral and fish; two texture reads replace sixteen procedural hashes.
    return reefCaustics(worldXZ, time, scale * 0.12);
}

// ─────────────────────────────────────────────────────────────────────────────
// Depth-Graded Fog (Abzu/Subnautica vertical color zoning)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Vertical depth-graded fog. Surface stays warmer/lighter, deep water cools to
 * dark teal. This produces Abzu's signature warm-shallow / cool-deep banding
 * that flat distance fog can never express on its own.
 *
 * @param {vec3} color    - input scene color
 * @param {float} worldY  - world-space Y coordinate of the fragment
 * @param {float} viewDist- view-space distance
 * @param {float} density - overall fog density multiplier (default 1.0)
 */
export function tslDepthGradedFog(color, worldY, viewDist, density = 1.0) {
    // scene.fogNode owns fog color and opacity. Material helpers only model
    // wavelength loss so fog is never stacked across three separate layers.
    const deepWeight = float(1.0).sub(
        smoothstep(float(-25.0), float(24.0), worldY),
    );
    const attenuationStrength = float(density).mul(
        float(0.72).add(deepWeight.mul(0.28)),
    );
    return tslWarmCoolAttenuation(color, viewDist, attenuationStrength);
}

/**
 * Preserve warm coral and sand locally, then remove red wavelengths with
 * distance while retaining blue detail. This is deliberately multiplicative
 * so the original material value structure survives the attenuation.
 */
export function tslWarmCoolAttenuation(color, viewDist, strength = 1.0) {
    const farWeight = smoothstep(float(56.0), float(184.0), viewDist)
        .mul(strength)
        .clamp(float(0.0), float(1.0));
    const absorption = mix(
        vec3(1.0),
        vec3(0.66, 0.86, 1.0),
        farWeight.mul(0.68),
    );
    return color.mul(absorption);
}

// ─────────────────────────────────────────────────────────────────────────────
// Underwater Absorption
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Depth-based color absorption for underwater fog.
 * Linearly mixes scene color towards deep teal as linear depth increases.
 * @param {vec3} sceneColor   - input color
 * @param {float} linearDepth - linear depth (0 = near, 1 = far)
 * @param {float} density     - absorption density (default 1.0)
 * @param {vec3} deepColor    - deep water color
 */
export function tslUnderwaterAbsorption(sceneColor, linearDepth, density = 1.0, deepColor = null) {
    const deep = deepColor || vec3(0.02, 0.18, 0.24);
    const near = float(0.0);
    const far = float(1.0);
    const absorption = smoothstep(near, far, linearDepth).mul(density);
    return mix(sceneColor, deep, absorption);
}

// ─────────────────────────────────────────────────────────────────────────────
// Abzu Color Grade
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Abzu-style warm/cool color grade.
 * Lifts teal shadows, pushes warm gold highlights, adds slight mid desaturation.
 * @param {vec3} color    - input color (linear)
 * @param {float} strength - grade intensity (0→1)
 */
export function tslAbzuGrade(color, strength, blackLift = 0.04) {
    const luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    const shadowMask = float(1.0).sub(smoothstep(float(0.045), float(0.38), luma));
    const highlightMask = smoothstep(float(0.46), float(0.88), luma);
    const midMask = clamp(
        float(1.0).sub(shadowMask).sub(highlightMask),
        float(0.0),
        float(1.0),
    );

    // Contrast precedes the chromatic floor so low values cannot be crushed
    // back to black after the shadow lift.
    let graded = mix(
        color,
        color.sub(0.43).mul(1.095).add(0.43),
        strength,
    );
    graded = clamp(graded, float(0.0), float(1.0));
    graded = graded.add(
        vec3(0.18, 0.65, 0.62).mul(blackLift).mul(shadowMask).mul(strength),
    );
    graded = mix(
        graded,
        graded.mul(vec3(0.93, 1.035, 0.99)),
        shadowMask.mul(0.32).mul(strength),
    );
    graded = mix(
        graded,
        graded.mul(vec3(0.99, 1.035, 0.98)),
        midMask.mul(0.24).mul(strength),
    );

    const creamyHighlight = graded
        .mul(vec3(1.055, 1.012, 0.94))
        .add(vec3(0.022, 0.01, 0.0));
    graded = mix(
        graded,
        creamyHighlight,
        highlightMask.mul(0.38).mul(strength),
    );

    const postLuma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
    const saturationAmount = float(1.0)
        .add(midMask.mul(0.075))
        .sub(highlightMask.mul(0.15))
        .sub(shadowMask.mul(0.035));
    graded = mix(
        graded,
        mix(vec3(postLuma), graded, saturationAmount),
        strength,
    );
    return clamp(graded, float(0.0), float(1.0));
}

/* eslint-disable import/no-unresolved */
/**
 * Sky Children V2 AAA — Painterly Journey Lighting Library
 *
 * The shared TSL shading toolbox that makes the LOCKED style anchors live
 * (docs/SKY_CHILDREN_ART_DIRECTION.md §"Style Anchors"). Every surface material
 * — cloud sea now, valley terrain + meadow in Phase 4 — calls these so the look
 * is consistent and authored in one place.
 *
 *   wrappedDiffuse     — soft light wrap, no hard Lambert terminator (anchor #2)
 *   coloredShadowBlend — shadows tinted cool-violet, never black/grey (anchor #1)
 *   fresnelRim         — silhouette separation at any depth (anchor #3)
 *   glitter            — Journey reflect()-based sparkle: rare, bright, and STABLE
 *                        (static per-point hash → no strobe; anchor #5)
 *
 * Derived from John Edwards' Journey sand shader (GDC 2013) and the look bible.
 * See docs/SKY_CHILDREN_V2_AAA_PLAN.md §3.3.
 */
import {
    Fn,
    clamp,
    dot,
    float,
    floor,
    max,
    mix,
    normalize,
    pow,
    reflect,
    vec3,
} from 'three/tsl';
import { hash3to1 } from './sky-children-noise.js';

/**
 * Soft wrapped diffuse — light bleeds past the terminator so there's no hard
 * Lambert edge. wrap≈0.5 gives the painterly soft falloff the look bible wants.
 * @returns scalar [0..1]
 */
export const wrappedDiffuse = /* @__PURE__ */ Fn(([N, L, wrapIn]) => {
    const w = float(wrapIn);
    const ndl = dot(normalize(N), normalize(L));
    return clamp(ndl.add(w).div(float(1.0).add(w)), float(0.0), float(1.0));
});

/**
 * Colored-shadow blend — the shadow side is tinted (cool-violet), never black,
 * with a saturation lift so shadows read colored rather than muddy/grey.
 * @returns vec3 color
 */
export const coloredShadowBlend = /* @__PURE__ */ Fn(([diffuse, litColor, shadowColor, boostIn]) => {
    const blended = mix(shadowColor, litColor, diffuse).toVar();
    const luma = dot(blended, vec3(0.2126, 0.7152, 0.0722));
    // >1 extrapolates away from grey → boosts saturation, strongest in shadow.
    const sat = float(1.0).add(float(boostIn).mul(float(1.0).sub(diffuse)));
    return mix(vec3(luma), blended, sat);
});

/**
 * Fresnel rim — glowing silhouette edge. Caller scales `strength` by depth band
 * so near/mid/far silhouettes all separate from the atmosphere.
 * @returns scalar
 */
export const fresnelRim = /* @__PURE__ */ Fn(([N, V, powerIn, strengthIn]) => {
    const ndv = max(dot(normalize(N), normalize(V)), float(0.0));
    return pow(clamp(float(1.0).sub(ndv), float(0.0), float(1.0)), float(powerIn)).mul(float(strengthIn));
});

/**
 * Journey-style glitter. A random grain normal is built from a STATIC hash of
 * the quantized world position (so a given grain sparkles consistently across
 * frames — no strobe), tilted toward the surface normal. Only reflections that
 * land very close to the view direction sparkle, so glints are rare and bright.
 *
 * `threshold` may be a node (e.g. lifted by director.sparkle on big clears so
 * combos shower more glints). `intensity` >1 is HDR → triggers bloom.
 * @returns scalar
 */
export const glitter = /* @__PURE__ */ Fn(([worldP, N, L, V, threshold, intensityIn]) => {
    const cell = floor(worldP.mul(12.0)).toVar();
    const rnd = vec3(
        hash3to1(cell).mul(2.0).sub(1.0),
        hash3to1(cell.add(vec3(7.3, 1.1, 3.7))).mul(2.0).sub(1.0),
        hash3to1(cell.add(vec3(2.9, 9.2, 5.5))).mul(2.0).sub(1.0),
    );
    const grain = normalize(mix(normalize(N), normalize(rnd), float(0.7)));
    const reflected = reflect(normalize(L).negate(), grain);
    const rdotv = dot(reflected, normalize(V));
    const t = float(threshold);
    const sparkle = clamp(rdotv.sub(t).div(max(float(1.0).sub(t), float(0.001))), float(0.0), float(1.0));
    return sparkle.mul(sparkle).mul(float(intensityIn));
});

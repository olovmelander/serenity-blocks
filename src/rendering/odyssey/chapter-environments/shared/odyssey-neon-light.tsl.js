/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Chapter 8's light in the air — the neon city's shared TSL building blocks
 * (2026-10-20 overhaul).
 *
 * Adapted from Neon District (src/themes/neon-district/neon-district-tsl.js: ndGlow, ndFogAmount,
 * ndHaze, ndAtmosphere). That theme's street is a few metres wide and seen from head height; this
 * city is a boulevard 48 u wide seen from ~70 u above it, so the pieces are re-done for that:
 *
 *   - everything works in CORRIDOR space (the rotated stage frame the city is built in — the
 *     world's up is ~70 deg off the city's): materials read `neonCityPos()`, a varying of
 *     `cityFromWorld * positionWorld`, and the eye is `camCity`, both set by the chapter;
 *   - the GLOW MAP (odyssey-neon-city-plan.js bakeNeonGlow) has four rows: the wall signs' light
 *     left/right and the street-level light left/right, along corridor z;
 *   - the air is two media: a thin haze that grows with distance (exp2, thinner up high) and a
 *     STREET MIST, an exponential height fog integrated along the view ray, so looking down into
 *     the canyon the street dissolves into glowing mist while the roofs stay crisp. The mist
 *     carries the colour of the signs above it; the haze above is dark smog;
 *   - the IGNITION ring (the spire powering the city, odyssey-stage-frame.js urbanIgnition) is
 *     read here once, so every emitter switches on with the same wavefront.
 *
 * No `mx_noise`, no laid-out helper that samples a texture (r186 does not declare the binding
 * inside a laid-out fn): the texture reads are inline, the pure maths is plain JS-built nodes.
 */

import * as THREE from 'three/webgpu';
import {
    exp,
    float,
    length,
    max,
    min,
    mix,
    positionWorld,
    select,
    smoothstep,
    texture,
    uniform,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { NEON_GLOW, STREET_Y } from './odyssey-neon-city-plan.js';

/** Where the spire stands (corridor x, z) — the centre of the ignition ring. */
export const NEON_SPIRE_XZ = Object.freeze([0, -560]);

/** The air's numbers (corridor units). */
export const NEON_AIR = Object.freeze({
    // Haze: fraction lost = 1 - exp(-(d / hazeDistance)^2 * thin(y)).
    hazeDistance: 760,
    hazeThinHigh: 0.32,
    // Street mist: density mistDensity at the street, falling by e every mistHeight up.
    mistDensity: 0.0085,
    mistHeight: 17,
    // The sign light the mist carries, and how far above the street it reaches.
    mistGlow: 0.16,
    // Light a sign of the arrival city gives, before the ignition ring has reached it.
    arrivalNeon: 0.52,
});

/** The glow map as a texture: NEON_GLOW.texels x NEON_GLOW.rows half floats. */
export function createNeonGlowTexture(data) {
    const half = new Uint16Array(data.length);
    for (let i = 0; i < data.length; i += 1) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
    const tex = new THREE.DataTexture(half, NEON_GLOW.texels, NEON_GLOW.rows, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'odyssey-neon-glow';
    tex.needsUpdate = true;
    return tex;
}

/**
 * The uniforms the neon city's materials share (the chapter owns the values, materials read).
 * Pass the chapter's existing clock/ignition uniforms in so nothing ticks twice.
 * @param {object} base { uTime, uEnergy, uIgniteRadius, uCityLight, uDim, uRainDensity }
 * @param {THREE.Texture} glowTex
 */
export function createNeonCityUniforms(base, glowTex) {
    return {
        ...base,
        /** World -> corridor (the stage frame); set by the chapter once its transform is known. */
        cityFromWorld: uniform(new THREE.Matrix4()),
        /** The eye in corridor space, every frame. */
        camCity: uniform(new THREE.Vector3(0, 10, 60)),
        /** The camera projection's P[1][1] (1 / tan(fov / 2)): pixel-sized strips (the rain). */
        projY: uniform(1.6),
        /**
         * 0..1: how far the 7->8 carry's tunnel mouth has opened (urban-dreams-sun-carry.js
         * `open`). The city's emitters nearer than chapter 7's black-hole window would otherwise
         * shine over the warp tunnel before the mouth reaches them; they arrive through it.
         */
        seamReveal: uniform(1),
        /** 0..1 eased ignition (mirror of the spire's uReveal). */
        reveal: uniform(0),
        /** Mist at the street (lit by the city) and the smog above (scene-linear). */
        mistLow: uniform(new THREE.Vector3(0.045, 0.016, 0.07)),
        smogHigh: uniform(new THREE.Vector3(0.018, 0.012, 0.038)),
        /** The air's tunables (NEON_AIR), as uniforms so a bench can A/B them without a rebuild. */
        hazeDistance: uniform(NEON_AIR.hazeDistance),
        mistDensity: uniform(NEON_AIR.mistDensity),
        mistGlow: uniform(NEON_AIR.mistGlow),
        glowGain: uniform(1),
        glowTex,
    };
}

/**
 * The fragment's corridor-space position, interpolated from the vertex stage (it is linear in
 * the vertex position, so one matrix multiply per vertex, none per fragment).
 */
export function neonCityPos(N, name = 'vNeonCity') {
    return varying(N.cityFromWorld.mul(vec4(positionWorld, 1.0)).xyz, name);
}

/**
 * How lit the city's neon is at corridor (x, z): the arrival level until the ignition ring
 * (radius uIgniteRadius, from the spire) has passed, full after it, with a flare on the front.
 * @returns {{level: *, front: *}}
 */
export function neonIgnition(N, pc) {
    const d = length(vec2(pc.x.sub(NEON_SPIRE_XZ[0]), pc.z.sub(NEON_SPIRE_XZ[1])));
    const r = N.uIgniteRadius;
    const inside = float(1.0).sub(smoothstep(r.sub(50.0), r, d));
    const front = smoothstep(r.sub(80.0), r.sub(20.0), d).mul(inside).mul(smoothstep(1.0, 30.0, r));
    const level = mix(float(NEON_AIR.arrivalNeon), float(1.0), inside);
    return { level, front };
}

/**
 * What the signs of this stretch of the boulevard throw at corridor point `pc` (scene-linear,
 * unbounded). `layer` 0 = the wall signs, 1 = the street-level light. Falls off away from the
 * boulevard (the outer blocks have their own, dimmer streets).
 */
export function neonGlow(N, pc, layer = 0) {
    const s = pc.z.sub(NEON_GLOW.z0).div(NEON_GLOW.z1 - NEON_GLOW.z0);
    const t = smoothstep(-24.0, 24.0, pc.x);
    const v = t.add(layer === 0 ? 0.5 : 2.5).div(NEON_GLOW.rows);
    const lateral = exp(max(pc.x.abs().sub(30.0), 0.0).mul(-1 / 70));
    return texture(N.glowTex, vec2(s, v)).level(0).rgb.mul(lateral).mul(N.glowGain);
}

/**
 * The air between the eye and corridor point `pc`: returns { amount, colour } with amount the
 * fraction of the surface's light lost and colour the light the air adds in its place.
 * @param {object} N neon uniforms
 * @param {*} pc vec3 corridor position
 * @param {*} [glowLow] the street light at pc (pass it when the caller already sampled it)
 */
export function neonAir(N, pc, glowLow = null) {
    const rel = pc.sub(N.camCity);
    const dist = length(rel);
    // Haze: exp2 in distance, thinner high above the street.
    const thin = mix(float(1.0), float(NEON_AIR.hazeThinHigh), smoothstep(-30.0, 140.0, pc.y));
    const k = dist.div(N.hazeDistance);
    const hazeTau = k.mul(k).mul(thin);
    // Street mist: density rho0 * exp(-(y - street) / H), integrated along the ray.
    const H = NEON_AIR.mistHeight;
    const a = max(N.camCity.y.sub(STREET_Y), 0.0).div(H);
    const b = max(pc.y.sub(STREET_Y), 0.0).div(H);
    const ea = exp(a.negate());
    const eb = exp(b.negate());
    const dy = b.sub(a);
    // (e^-a - e^-b) / (b - a) -> e^-a as b -> a (a level ray).
    const level = dy.abs().lessThan(0.02);
    const dySafe = select(level, float(1.0), dy);
    const ratio = select(level, ea, ea.sub(eb).div(dySafe));
    const mistTau = dist.mul(N.mistDensity).mul(ratio.max(0.0));
    const tau = hazeTau.add(mistTau);
    const amount = float(1.0).sub(exp(tau.negate()));
    // What the air adds: the street mist glows with the signs and shopfronts below it; the
    // haze above is dark smog.
    const glow = glowLow ?? neonGlow(N, pc, 1);
    const ign = neonIgnition(N, pc);
    const mistCol = N.mistLow.add(glow.mul(N.mistGlow).mul(ign.level).mul(exp(b.mul(-0.6))));
    const share = mistTau.div(tau.max(1e-4));
    const colour = mix(N.smogHigh, mistCol, share);
    return { amount, colour, dist };
}

/** Apply the air to a shaded colour at corridor point `pc`. */
export function neonAtmosphere(N, col, pc, glowLow = null) {
    const air = neonAir(N, pc, glowLow);
    return mix(col, air.colour, air.amount);
}

/**
 * The spire's light on a surface at `pc` with normal `n` (corridor space): nothing until the
 * ignition, then a rose-cyan wash on everything that faces it, falling with distance.
 */
export function neonSpireLight(N, pc, n) {
    const to = vec3(
        float(NEON_SPIRE_XZ[0]).sub(pc.x),
        min(max(pc.y, -40.0), 300.0).sub(pc.y),
        float(NEON_SPIRE_XZ[1]).sub(pc.z),
    );
    const d = length(to);
    const facing = n.dot(to.div(d.max(1e-3))).mul(0.6).add(0.4).max(0.0);
    const q = d.mul(1 / 120);
    const fall = float(1.0).div(q.mul(q).add(1.0));
    return vec3(1.0, 0.24, 0.62).mul(N.reveal).mul(fall).mul(facing)
        .mul(0.32);
}

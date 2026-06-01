/* eslint-disable import/no-unresolved */
/**
 * Himalayan Peak AAA — Scattering Sky Dome
 *
 * The light source of the whole scene. An inverted sphere shaded in TSL with a
 * Rayleigh-flavored cool zenith → Mie-flavored warm horizon gradient, a physical
 * sun disc + halo, a warm horizon glow concentrated around the sun azimuth, and
 * a starfield that fades as the light warms.
 *
 * All palette/sun uniforms are OWNED BY THE ORCHESTRATOR and shared with the
 * terrain (so the aerial-perspective fog color always equals the sky horizon).
 * This module only builds geometry + the shader graph.
 *
 * See docs/HIMALAYAN_PEAK_AAA_PLAN.md §3.2.
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn,
    clamp,
    dot,
    float,
    max,
    mix,
    normalize,
    positionWorld,
    pow,
    smoothstep,
    vec3,
} from 'three/tsl';
import { valueNoise2 } from '../himalayan-noise.js';

/**
 * @param {object} u  shared uniforms (TSL uniform() handles) from the orchestrator:
 *   uTime, uWarmth, uSunDir(vec3), uSunColor(Color), uSkyZenith(Color),
 *   uSkyHorizon(Color), uStarFade(float)
 */
export function createSkyDome(u) {
    const geometry = new THREE.SphereGeometry(1400, 24, 16);

    const fragment = Fn(() => {
        const dir = normalize(positionWorld).toVar();
        const elevation = dir.y.toVar(); // -1 (down) .. 1 (up)

        // Vertical gradient: warm horizon → cool zenith.
        const horizonBand = smoothstep(float(-0.05), float(0.55), elevation);
        const gradient = mix(u.uSkyHorizon, u.uSkyZenith, horizonBand).toVar();

        // Below the horizon line, ease slightly darker (terrain usually covers it,
        // but gaps shouldn't show a hard band).
        const below = smoothstep(float(0.0), float(-0.4), elevation);
        gradient.assign(mix(gradient, u.uSkyHorizon.mul(0.72), below));

        // Sun direction in world space.
        const sunDot = clamp(dot(dir, normalize(u.uSunDir)), float(-1.0), float(1.0)).toVar();

        // Crisp sun disc.
        const disc = smoothstep(float(0.9982), float(0.9994), sunDot);
        // Wide soft halo around the sun.
        const halo = pow(max(sunDot, float(0.0)), float(220.0)).mul(0.6)
            .add(pow(max(sunDot, float(0.0)), float(14.0)).mul(0.16));

        // Horizon glow concentrated toward the sun azimuth + low elevation.
        const azimuthAlign = pow(max(sunDot, float(0.0)), float(3.0));
        const lowBand = smoothstep(float(0.42), float(-0.08), elevation);
        const horizonGlow = azimuthAlign.mul(lowBand).mul(0.5);

        const sunCol = u.uSunColor;
        let color = gradient
            .add(sunCol.mul(halo))
            .add(sunCol.mul(horizonGlow));

        // Stars — sharp threshold on value noise, fading out as the sky warms.
        const starUv = dir.xy.add(dir.zz.mul(0.5)).mul(170.0);
        const starN = valueNoise2(starUv);
        const starMask = smoothstep(float(0.988), float(1.0), starN)
            .mul(smoothstep(float(0.04), float(0.5), elevation))
            .mul(u.uStarFade);
        color = color.add(vec3(0.85, 0.9, 1.0).mul(starMask));

        // Sun core (very bright, drives bloom via emissive below).
        color = color.add(sunCol.mul(disc).mul(2.4));

        return color;
    })();

    const material = new MeshBasicNodeMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
    });
    material.colorNode = fragment;

    // Only the sun disc + tight halo are bloom-eligible (MRT emissive channel).
    material.emissiveNode = Fn(() => {
        const dir = normalize(positionWorld).toVar();
        const sunDot = clamp(dot(dir, normalize(u.uSunDir)), float(-1.0), float(1.0));
        const disc = smoothstep(float(0.9975), float(0.9994), sunDot);
        const tightHalo = pow(max(sunDot, float(0.0)), float(180.0)).mul(0.5);
        return u.uSunColor.mul(disc.mul(2.2).add(tightHalo));
    })();
    material.userData.emitsBloom = true;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -1000;
    mesh.frustumCulled = false;

    return {
        mesh,
        dispose: () => {
            geometry.dispose();
            material.dispose();
        },
    };
}

/* eslint-disable import/no-unresolved */
/**
 * Sky Children V2 AAA — Scattering Sunset Sky Dome
 *
 * The light source of the whole scene and the first thing the rebuild touches.
 * An inverted sphere shaded in TSL with a painterly THREE-STOP gradient (warm
 * horizon → mid → cool zenith), a physical sun disc + wide warm halo, a horizon
 * glow concentrated around the sun azimuth, and a starfield that fades as the
 * light warms toward Triumph.
 *
 * A touch of FBM modulates the gradient so it never reads as a clean ramp
 * (per the painterly research: "break up the linear gradient").
 *
 * All palette/sun uniforms are OWNED BY THE ORCHESTRATOR and shared with every
 * other surface (so the aerial-perspective fog color always equals the sky
 * horizon). This module only builds geometry + the shader graph.
 *
 * See docs/SKY_CHILDREN_V2_AAA_PLAN.md §3.2.
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
import { valueNoise2, fbm2 } from '../sky-children-noise.js';

/**
 * @param {object} u  shared uniforms (TSL uniform() handles) from the orchestrator:
 *   uTime, uRadiance, uSunDir(vec3), uSunColor(Color), uSkyZenith(Color),
 *   uSkyMid(Color), uSkyHorizon(Color), uStarFade(float)
 * @param {object} opts { radius }
 */
export function createSkyDome(u, opts = {}) {
    const radius = opts.radius ?? 1200;
    const geometry = new THREE.SphereGeometry(radius, 32, 20);

    const fragment = Fn(() => {
        const dir = normalize(positionWorld).toVar();
        const elevation = dir.y.toVar(); // -1 (down) .. 1 (up)

        // Three-stop gradient: warm horizon → mid → cool zenith.
        const toMid = smoothstep(float(-0.02), float(0.30), elevation);
        const toZenith = smoothstep(float(0.18), float(0.72), elevation);
        const lowMix = mix(u.uSkyHorizon, u.uSkyMid, toMid);
        const gradientBase = mix(lowMix, u.uSkyZenith, toZenith);

        // Painterly break — subtle FBM so the gradient isn't a clean ramp.
        const breakN = fbm2(dir.xz.mul(2.4).add(dir.y.mul(1.7)).add(u.uTime.mul(0.012)));
        const gradientBroken = gradientBase.mul(float(0.95).add(breakN.mul(0.10)));

        // Below the horizon line, ease slightly darker (terrain usually covers it).
        const below = smoothstep(float(0.0), float(-0.4), elevation);
        const gradient = mix(gradientBroken, u.uSkyHorizon.mul(0.78), below);

        // Sun direction in world space.
        const sunDot = clamp(dot(dir, normalize(u.uSunDir)), float(-1.0), float(1.0)).toVar();

        // Crisp sun disc.
        const disc = smoothstep(float(0.9982), float(0.9994), sunDot);
        // Wide soft halo around the low sun (restrained so the horizon stays moody).
        const halo = pow(max(sunDot, float(0.0)), float(260.0)).mul(0.45)
            .add(pow(max(sunDot, float(0.0)), float(16.0)).mul(0.12));

        // Horizon glow concentrated toward the sun azimuth + low elevation.
        const azimuthAlign = pow(max(sunDot, float(0.0)), float(4.0));
        const lowBand = smoothstep(float(0.40), float(-0.10), elevation);
        const horizonGlow = azimuthAlign.mul(lowBand).mul(0.38);

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
        color = color.add(vec3(0.82, 0.88, 1.0).mul(starMask));

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
        const tightHalo = pow(max(sunDot, float(0.0)), float(170.0)).mul(0.5);
        return u.uSunColor.mul(disc.mul(2.2).add(tightHalo));
    })();
    material.userData.emitsBloom = true;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -1000;
    mesh.frustumCulled = false;

    return {
        mesh,
        material,
        dispose: () => {
            geometry.dispose();
            material.dispose();
        },
    };
}

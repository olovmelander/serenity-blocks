/* eslint-disable import/no-unresolved */
/**
 * Pyrestorm V2 — Volcanic Sky
 *
 * Procedural dusk-over-a-caldera dome: warm horizon glow grading up into a
 * dark ashen void, drifting nebula smoke, and faint embers/stars. Built as a
 * MeshBasicNodeMaterial (unlit, fog-excluded) on a BackSide sphere.
 *
 * `uIntensity` pushes the horizon hotter as gameplay heats up.
 */
import * as THREE from 'three/webgpu';
import {
    clamp,
    float,
    mix,
    normalize,
    positionWorld,
    smoothstep,
    uniform,
    vec3,
} from 'three/tsl';
import { warpedFbm3, valueNoise3 } from './tsl-fire-lib.js';

export function createVolcanicSky({ radius = 16000 } = {}) {
    const uTime = uniform(0);
    const uIntensity = uniform(0);

    const dir = normalize(positionWorld);
    const height = dir.y;

    // ── Vertical gradient: hot horizon → dark red mid → ashen void ──
    const horizonGlow = vec3(0.42, 0.10, 0.03);
    const midSky = vec3(0.10, 0.025, 0.045);
    const upperSky = vec3(0.03, 0.012, 0.028);
    const space = vec3(0.004, 0.002, 0.012);

    const g1 = mix(horizonGlow, midSky, smoothstep(-0.05, 0.25, height));
    const g2 = mix(g1, upperSky, smoothstep(0.25, 0.55, height));
    const base = mix(g2, space, smoothstep(0.55, 0.95, height));

    // ── Horizon heat band (rises with intensity) ──
    const horizonHeat = smoothstep(0.16, -0.06, height);
    const heated = base.add(
        vec3(0.55, 0.16, 0.02).mul(horizonHeat).mul(uIntensity.mul(0.6).add(0.4)),
    );

    // ── Drifting nebula smoke ──
    const neb = warpedFbm3(dir.mul(2.2).add(vec3(uTime.mul(0.02))), float(0.7));
    const clouds = smoothstep(0.45, 0.85, neb);
    const nebColor = vec3(0.22, 0.03, 0.09);
    const withNeb = mix(heated, nebColor.add(heated.mul(0.4)), clouds.mul(0.32));

    // ── Faint embers / stars (fade toward horizon) ──
    const star = valueNoise3(dir.mul(130.0));
    const stars = smoothstep(0.92, 0.985, star).mul(clamp(height, 0.0, 1.0));
    const finalColor = withNeb.add(vec3(0.9, 0.55, 0.30).mul(stars).mul(0.6));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = finalColor;
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.fog = false;
    material.toneMapped = true;

    const geometry = new THREE.SphereGeometry(radius, 48, 32);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1000;

    return {
        mesh,
        uniforms: { uTime, uIntensity },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

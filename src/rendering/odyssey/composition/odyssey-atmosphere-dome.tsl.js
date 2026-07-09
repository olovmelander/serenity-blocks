/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview OdysseyAtmosphere sky-dome — TSL (WebGPU) twin of the GLSL dome.
 *
 * Part of the Odyssey AAA WebGPU migration (P2 — warm-up conversion). See
 * docs/ODYSSEY_AAA_MASTER_PLAN.md §3 / Appendix B (the canonical "must NOT bloom"
 * material). This is a 1:1 port of the graded zenith→horizon backstop in
 * composition/OdysseyAtmosphere.js `_buildDome()`: same gradient curve (pow(h,0.6)),
 * same horizon glow band, same exposure, same BackSide / depthTest-off / fog-off
 * backstop semantics — rebuilt as a MeshBasicNodeMaterial so it runs on the
 * WebGPURenderer (and its WebGL2 fallback).
 *
 * It deliberately sets NO emissiveNode / userData.emitsBloom: the dome is the
 * backstop and must stay below the selective-bloom threshold or the frame washes out.
 *
 * Additive/lit per-chapter content stays unchanged; this only replaces the dome's
 * material. The colour uniforms (uZenith/uHorizon) are THREE.Color values driven each
 * frame by OdysseyDirector state, exactly like the GLSL version.
 */

import * as THREE from 'three/webgpu';
import {
    abs,
    clamp,
    mix,
    normalize,
    positionLocal,
    pow,
    smoothstep,
    uniform,
} from 'three/tsl';

const DEFAULT_RADIUS = 4000;

/**
 * Build the TSL sky-dome.
 * @param {{ radius?: number }} [opts]
 * @returns {{ mesh: THREE.Mesh, uniforms: object, dispose: () => void }}
 */
export function createOdysseyAtmosphereDomeTSL({ radius = DEFAULT_RADIUS } = {}) {
    const uZenith = uniform(new THREE.Color(0x0a0a1a));
    const uHorizon = uniform(new THREE.Color(0x1a1020));
    const uEnergy = uniform(0);
    const uExposure = uniform(1.0);

    const dir = normalize(positionLocal);
    const h = clamp(dir.y.mul(0.5).add(0.5), 0.0, 1.0);
    const t = pow(h, 0.6);

    let color = mix(uHorizon, uZenith, t);

    // Subtle horizon glow band + tiny energy lift near the horizon.
    const glow = smoothstep(0.55, 0.0, abs(dir.y));
    color = color.add(uHorizon.mul(glow).mul(uEnergy.mul(0.10).add(0.12)));

    color = color.mul(uExposure);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.depthTest = false;
    material.fog = false;
    material.toneMapped = false;

    const geometry = new THREE.SphereGeometry(radius, 32, 16);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'odyssey-atmosphere-dome-tsl';
    mesh.renderOrder = -10000;
    mesh.frustumCulled = false;

    return {
        mesh,
        uniforms: {
            uZenith, uHorizon, uEnergy, uExposure,
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

export default createOdysseyAtmosphereDomeTSL;

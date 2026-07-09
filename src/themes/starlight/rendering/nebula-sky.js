/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Starlight — Backdrop Nebula Sky
 *
 * Forked from electric-dreams-v3/rendering/nebula-volume.js. An inverted
 * sky-sphere painted with a calm vertical gradient + domain-warped FBM nebula +
 * a tilted Milky Way band (with dust lanes) + zero-geometry "dust-salt" micro
 * stars. This is the ambient backdrop, NOT a hero — it is luminance-capped
 * (≤0.3 linear) and `emitsBloom=false` so it never competes with the real stars
 * or washes out the board.
 *
 * Palette: indigo void → violet → rose horizon, with sparse OIII-teal / Hα-
 * magenta nebula tints. Deliberately avoids galaxy pink-magenta, magma, crimson.
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn,
    abs,
    dot,
    float,
    min,
    mix,
    normalize,
    positionWorld,
    smoothstep,
    uniform,
    vec3,
} from 'three/tsl';
import { warpedFbm3, valueNoise2 } from '../materials/tsl-noise-lib.js';

export function createNebulaSky() {
    const geometry = new THREE.SphereGeometry(180, 24, 16);

    const uTime = uniform(0);
    const uPulse = uniform(0); // combo-driven brightness pulse (tiny)

    // Palette — LINEAR space. Node colors are not sRGB-encoded until output, so
    // even 0.1 linear reads as ~0.35 on screen. Keep everything TINY → deep space.
    const VOID = vec3(0.004, 0.006, 0.016); // near-black deep space
    const VIOLET = vec3(0.028, 0.020, 0.055); // faint violet mid
    const ZENITH = vec3(0.008, 0.012, 0.030); // deep indigo zenith
    const ROSE = vec3(0.050, 0.026, 0.050); // faint rose horizon
    const TEAL = vec3(0.05, 0.20, 0.20); // OIII glow (sparse, masked)
    const MAGENTA = vec3(0.18, 0.06, 0.14); // Hα glow (sparse, masked)
    const MWCORE = vec3(0.10, 0.095, 0.085); // milky-way dust (dim, warm)

    const colorNode = Fn(() => {
        const dir = normalize(positionWorld).toVar();
        const elev = dir.y.toVar();

        // Deep, dark vertical gradient: faint rose horizon → violet → indigo
        // zenith, fading toward true void overhead. All values stay tiny.
        const grad = mix(VIOLET, ZENITH, smoothstep(-0.15, 0.6, elev)).toVar();
        grad.assign(mix(ROSE, grad, smoothstep(-0.55, -0.05, elev)));
        grad.assign(mix(grad, VOID, smoothstep(0.45, 0.95, elev)));

        // Domain-warped nebula clouds — ADD faint glow only in the brightest FBM
        // pockets (sparse), so the base stays dark instead of a global wash.
        const cloudCoord = dir.mul(2.0).add(vec3(0.0, 0.0, uTime.mul(0.01)));
        const neb = warpedFbm3(cloudCoord, float(1.7)).toVar();
        const nebMask = smoothstep(0.6, 0.95, neb);
        const tintSel = warpedFbm3(cloudCoord.mul(0.6).add(vec3(11.0)), float(1.0));
        const tint = mix(TEAL, MAGENTA, tintSel.clamp(0.0, 1.0));
        const nebColor = grad.add(tint.mul(nebMask).mul(0.6)).toVar();

        // Milky Way band: proximity to a tilted plane, dust lanes subtracted so
        // it reads as 3D occlusion. Kept dim — a whisper, not a smear.
        const bandN = normalize(vec3(0.30, 0.42, 0.86));
        const planeDist = abs(dot(dir, bandN));
        const band = smoothstep(0.28, 0.0, planeDist).toVar();
        const lane = valueNoise2(dir.xy.mul(6.0).add(dir.zz.mul(2.0)));
        band.mulAssign(float(1.0).sub(smoothstep(0.4, 0.7, lane).mul(0.7)));
        nebColor.addAssign(MWCORE.mul(band.mul(0.7)));

        // Cap the AMBIENT backdrop dark so the instanced hero stars dominate.
        const ambient = min(nebColor, vec3(0.085)).toVar();

        // Dust-salt micro-stars (zero geometry; faint background grain). Added
        // after the ambient cap so specks read as faint pinpoints, but still far
        // below the instanced hero stars. Density biased to the band.
        const starUv = dir.xy.add(dir.zz.mul(0.5)).mul(110.0);
        const sn = valueNoise2(starUv);
        const starMask = smoothstep(0.991, 1.0, sn).mul(float(0.35).add(band.mul(0.65)));
        const salt = vec3(0.55, 0.62, 0.85).mul(starMask.mul(0.22));

        return ambient.add(salt).add(vec3(uPulse.mul(0.02)));
    })();

    const material = new MeshBasicNodeMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
    });
    material.colorNode = colorNode;
    material.emissiveNode = vec3(0.0); // ambient backdrop — NOT bloom-eligible
    material.userData.emitsBloom = false;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -1000;
    mesh.frustumCulled = false;

    return {
        mesh,
        uniforms: { uTime, uPulse },
        update(time) {
            uTime.value = time;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

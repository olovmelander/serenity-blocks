/* eslint-disable import/no-unresolved */
/**
 * Pyrestorm V2 — Volcanic Rock Material
 *
 * Shared lit material for the volcano cone, rim peaks, and basalt spires.
 * Unlike the old theme's fully-unlit rock, this computes its own cheap shading
 * so geometry reads as 3D form:
 *   - hemispheric ambient (cool sky tint above, warm ground bounce below)
 *   - one warm key term (N·L) — consistent light direction with the ground
 *   - cavity AO from noise (crevices darken)
 *   - thermal bleed (rock near the lava plain glows warm; rises with intensity)
 *   - optional radial-ish lava channels (cone slopes) via seamless domain-warped
 *     FBM (no angular `atan` seam like the old shader)
 *
 * Pass `uniforms` to share time/intensity/pulse handles across several
 * materials (the volcano group shares one set across cone + peaks + lake).
 */
import * as THREE from 'three/webgpu';
import {
    cameraPosition,
    clamp,
    dot,
    float,
    mix,
    normalize,
    normalWorld,
    oneMinus,
    positionWorld,
    smoothstep,
    uniform,
    vec3,
} from 'three/tsl';
import {
    fbm3, warpedFbm3, heatRamp, hemispheric,
} from './tsl-fire-lib.js';

export function createRockMaterial({
    baseColor = vec3(0.11, 0.075, 0.08),
    skyTint = vec3(0.16, 0.10, 0.13),
    groundTint = vec3(0.34, 0.13, 0.05),
    lavaChannels = false,
    channelStrength = 1.0,
    uniforms = null,
} = {}) {
    const uTime = uniforms?.uTime ?? uniform(0);
    const uIntensity = uniforms?.uIntensity ?? uniform(0);
    const uLavaPulse = uniforms?.uLavaPulse ?? uniform(0);

    const wp = positionWorld;
    const nrm = normalize(normalWorld).toVar();
    const keyDir = normalize(vec3(0.32, 0.78, 0.22));
    const ndl = clamp(dot(nrm, keyDir), 0.0, 1.0);
    const ambient = hemispheric(nrm.y, skyTint, groundTint);

    const rockN = fbm3(wp.mul(0.01)).toVar();
    const fineN = fbm3(wp.mul(0.055));
    const rock = baseColor.mul(rockN.mul(0.5).add(0.7)).sub(fineN.mul(0.03));
    const ao = smoothstep(0.12, 0.85, rockN).mul(0.4).add(0.6);

    // Warm key + hemispheric ambient — strong enough that rock reads as stone,
    // not a black silhouette.
    const lit = rock.mul(ambient.add(vec3(1.0, 0.6, 0.26).mul(ndl))).mul(ao).toVar();

    // Lava rim-glow (fresnel): hot orange edges where the surface turns away from
    // the camera — the signature "lit by the lava" look of the v1 rock.
    const viewDir = normalize(cameraPosition.sub(wp));
    const fres = oneMinus(clamp(dot(viewDir, nrm), 0.0, 1.0));
    const rim = fres.mul(fres).mul(fres);
    const lowGlow = smoothstep(360.0, -150.0, wp.y); // hotter nearer the plain
    lit.addAssign(
        vec3(1.1, 0.42, 0.08).mul(rim).mul(lowGlow.mul(0.7).add(0.25)).mul(uIntensity.mul(0.5).add(0.85)),
    );

    // Thermal bleed: broad warm wash low down / with intensity.
    lit.addAssign(vec3(0.4, 0.12, 0.02).mul(lowGlow.mul(0.3).add(uIntensity.mul(0.15))));

    let finalColor = lit;
    if (lavaChannels) {
        // Seamless molten veins that appear to flow down the cone (time drifts the
        // noise's vertical coordinate). No angular seam.
        const veinP = vec3(wp.x.mul(0.011), wp.z.mul(0.011), wp.y.mul(-0.004).add(uTime.mul(0.05)));
        const vein = warpedFbm3(veinP, float(0.7));
        const channelMask = smoothstep(0.5, 0.74, vein).toVar();
        const slopeMask = smoothstep(-150.0, 170.0, wp.y); // stronger toward the rim
        const heat = clamp(
            channelMask.mul(slopeMask).mul(channelStrength).add(uLavaPulse.mul(0.2)),
            0.0,
            1.0,
        ).toVar();
        const lavaCol = heatRamp(heat.mul(0.8).add(channelMask.mul(0.2)));
        finalColor = mix(lit, lavaCol, heat);
    }

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = finalColor;
    material.fog = true;

    return { material, uniforms: { uTime, uIntensity, uLavaPulse } };
}

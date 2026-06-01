/* eslint-disable import/no-unresolved */
/**
 * Pyrestorm V2 — Lava Ground Material
 *
 * The molten caldera plain. Replaces the old radial `atan` river pattern
 * (which banded into topographic contour lines) with:
 *   - domain-warped FBM flow → organic, advected molten veins
 *   - Worley cells → cracked cooled-basalt crust with glowing seams
 *   - radial cooling gradient → bright molten near the vent, dark crust far
 *   - thermal bleed → crust near molten is lit by it
 *   - cheap relief lighting (hemispheric + warm key) so the displaced
 *     basin geometry actually reads as terrain (the material is otherwise unlit)
 *
 * HDR is pushed into the hot range so Phase 6 selective bloom catches it.
 * Scene fog applies automatically (distant lava fades into haze = depth).
 */
import * as THREE from 'three/webgpu';
import {
    clamp,
    dot,
    float,
    length,
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
    fbm3, warpedFbm3, worley2, heatRamp, hemispheric,
} from './tsl-fire-lib.js';

export function createLavaGroundMaterial() {
    const uTime = uniform(0);
    const uIntensity = uniform(0);

    const wp = positionWorld;
    const radius = length(wp.xz).toVar();
    const nrm = normalize(normalWorld).toVar();

    // ── Radial cooling: 0 = molten (near vent) … 1 = cold crust (far). Pulled
    //    in close so molten lives near the volcano and the plain is dark rock. ──
    const cool = smoothstep(900.0, 5200.0, radius).toVar();
    const heatBase = oneMinus(cool).toVar();

    // ── Domain-warped molten flow (animated). High threshold → SPARSE rivers,
    //    not a uniform orange field. ──
    const flowP = vec3(wp.x.mul(0.0017), wp.z.mul(0.0017), uTime.mul(0.05));
    const flow = warpedFbm3(flowP, float(0.85)).toVar();
    const channel = smoothstep(0.60, 0.82, flow).toVar();

    // ── Worley crust cells: thin glowing cracks on the cell borders only. ──
    const w = worley2(wp.xz.mul(0.0045)).toVar();
    const crack = oneMinus(smoothstep(0.0, 0.03, w.y.sub(w.x))).toVar(); // thin borders
    const cellShade = smoothstep(0.1, 0.9, w.x).toVar(); // interior → border darkening

    // ── Molten = sparse rivers + thin cracks, gated by the cooling radius. ──
    const molten = clamp(channel.add(crack.mul(0.45)), 0.0, 1.0).mul(heatBase).toVar();

    // ── Temperature → HDR color (the glowing lava itself). ──
    const moltenColor = heatRamp(molten.mul(0.85).add(0.12)).toVar();

    // ── Cooled basalt crust with cheap relief lighting (dominant surface). ──
    const keyDir = normalize(vec3(0.32, 0.78, 0.22));
    const ndl = clamp(dot(nrm, keyDir), 0.0, 1.0);
    const ambient = hemispheric(nrm.y, vec3(0.07, 0.05, 0.07), vec3(0.16, 0.07, 0.04));
    const rockNoise = fbm3(vec3(wp.x.mul(0.011), wp.z.mul(0.011), 0.0));
    const baseRock = vec3(0.07, 0.05, 0.055).mul(cellShade.mul(0.5).add(0.6)).add(rockNoise.mul(0.025));
    const litRock = baseRock.mul(ambient.add(vec3(0.5, 0.3, 0.14).mul(ndl)));
    // Subtle thermal bleed only where molten is actually adjacent.
    const crustColor = litRock.add(vec3(0.45, 0.14, 0.02).mul(crack.mul(0.25).add(channel.mul(0.2))).mul(heatBase));

    const finalColor = mix(crustColor, moltenColor, molten);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = finalColor;
    material.side = THREE.DoubleSide;
    material.fog = true;

    return { material, uniforms: { uTime, uIntensity } };
}

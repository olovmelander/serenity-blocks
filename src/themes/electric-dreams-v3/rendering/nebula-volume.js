/* eslint-disable import/no-unresolved */
/**
 * Electric Dreams V3 — Nebula Volumetric Sky
 *
 * The backdrop layer. Renders a vast volumetric nebula using TSL.
 * Currently: surface-shaded sphere with warped FBM (cheap, visually rich).
 *
 * Future (Phase 1c): upgrade to raymarched volume with temporal accumulation
 * for true 3D depth. For now, the surface approach is 0.2ms vs the raymarch's
 * 1ms — we earn that budget back when fluid+GI come online.
 *
 * Compositional intent:
 * - Indigo → violet → teal gradient bottom-to-top
 * - Slow domain-warped swirling (~12s loop)
 * - Reacts to fxState.stageHeat (warmer/redder under high pressure)
 * - Acts as the ambient "sky color" that radiance cascades will sample later
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn,
    float,
    mix,
    normalize,
    positionWorld,
    smoothstep,
    uniform,
    vec3,
} from 'three/tsl';
import { warpedFbm3, valueNoise2 } from '../materials/tsl-noise-lib.js';

export function createNebulaSky() {
    // Inverted sphere so we render the inside surface from the camera POV.
    // Low-poly (12,8) is plenty — the shader does all the visual heavy lifting,
    // tessellation buys nothing for a gradient. ~192 triangles total.
    const geometry = new THREE.SphereGeometry(180, 12, 8);

    const uTime = uniform(0);
    const uHeat = uniform(0); // 0=cool/cinematic, 1=full Act-III warmth
    const uActProgress = uniform(0); // 0..3, drives palette across acts
    const uPulse = uniform(0); // combo-driven brightness pulse

    // Base palette — locked to harmony, no clashing hues.
    // These get *modulated* by uHeat / uActProgress but never replaced.
    const COL_DEEP = vec3(0.04, 0.02, 0.10); // deepest indigo
    const COL_VIOLET = vec3(0.18, 0.10, 0.32); // mid violet
    const COL_TEAL = vec3(0.06, 0.20, 0.32); // upper teal
    const COL_WARM = vec3(0.45, 0.12, 0.20); // act-III warmth (sparse)
    const COL_HIGHLIGHT = vec3(0.65, 0.45, 0.92); // magenta nebula highlight

    const fragmentNode = Fn(() => {
        const worldDir = normalize(positionWorld).toVar();
        const elevation = worldDir.y.toVar(); // -1 (bottom) to 1 (top)

        // Vertical gradient: deep at bottom → violet mid → teal top
        const lower = mix(COL_DEEP, COL_VIOLET, smoothstep(-0.6, 0.1, elevation));
        const upper = mix(COL_VIOLET, COL_TEAL, smoothstep(0.0, 0.7, elevation));
        const gradient = mix(lower, upper, smoothstep(-0.1, 0.5, elevation)).toVar();

        // Domain-warped nebula clouds — drives the "swirling sky" feel.
        // Slow time (0.04) keeps it dreamlike, never jittery.
        const cloudCoord = worldDir.mul(2.4).add(vec3(uTime.mul(0.04)));
        const nebula = warpedFbm3(cloudCoord, float(1.6)).toVar();

        // Carve highlights only where FBM > 0.55 (sparse glow pockets).
        // smoothstep gives soft edges without a hard threshold band.
        const nebulaMask = smoothstep(0.55, 0.85, nebula);
        const nebulaColor = mix(gradient, COL_HIGHLIGHT, nebulaMask.mul(0.35));

        // Stage heat: bias the whole sky toward warm at high pressure.
        // Subtle — only visible at heat > 0.5.
        const heated = mix(nebulaColor, COL_WARM, uHeat.mul(0.18));

        // Pulse: tiny additive on combo events. Caps at +5% intensity.
        const pulsed = heated.add(vec3(uPulse.mul(0.05)));

        // Static stars in screen-y projection — tiny bright dots above the horizon.
        // valueNoise2 → sharp threshold → only top 0.3% of texels become stars.
        const starUv = worldDir.xy.add(worldDir.zz.mul(0.5)).mul(80.0);
        const starNoise = valueNoise2(starUv);
        const starMask = smoothstep(0.985, 1.0, starNoise).mul(smoothstep(-0.1, 0.4, elevation));
        const stars = vec3(0.9, 0.95, 1.0).mul(starMask);

        return pulsed.add(stars);
    })();

    const material = new MeshBasicNodeMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
    });
    material.colorNode = fragmentNode;
    material.emissiveNode = vec3(0.0); // Nebula is NOT bloom-eligible — it's ambient
    material.userData.emitsBloom = false;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -1000; // Behind everything
    mesh.frustumCulled = false; // Always render the sky

    return {
        mesh,
        uniforms: {
            uTime, uHeat, uActProgress, uPulse,
        },
        dispose: () => {
            geometry.dispose();
            material.dispose();
        },
    };
}

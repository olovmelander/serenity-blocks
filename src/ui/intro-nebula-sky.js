/* eslint-disable import/no-unresolved */
/**
 * Intro Animation — Volumetric Nebula Sky (Phase A1)
 *
 * The AAA backdrop. Replaces the flat black void with a vast, slowly swirling
 * cosmic nebula rendered on the inside of a large sphere. Ported from the
 * Electric Dreams V3 nebula sky (`rendering/nebula-volume.js`) and re-paletted
 * to the intro's chromadelic identity (indigo base, cyan + magenta highlight
 * pockets), kept deliberately dim so it never overpowers the title or competes
 * with the main-menu cards rendered on top.
 *
 * Composition:
 *   - Indigo → violet → teal vertical gradient
 *   - Domain-warped FBM "cloud" pockets that glow cyan/magenta (sparse)
 *   - Procedural pin-prick stars above the horizon
 *   - Slow (~25 s) drift; gentle audio-pulse brightening
 *   - `uIntensity` dims the whole sky (1 = full intro, ~0.45 = menu background)
 *
 * Renders behind everything (renderOrder -1000), never frustum-culled, and is
 * NOT bloom-eligible (emissiveNode = 0) so it stays crisp under selective bloom.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    clamp,
    float,
    mix,
    normalize,
    positionWorld,
    sin,
    smoothstep,
    uniform,
    vec3,
} from 'three/tsl';
import { warpedFbm3, fbm3, valueNoise2 } from './intro-noise-lib.js';

export function createIntroNebulaSky({ radius = 200 } = {}) {
    // Low-poly inverted sphere — the shader does all the visual work, so
    // tessellation buys nothing. Rendered from the inside (BackSide).
    const geometry = new THREE.SphereGeometry(radius, 16, 10);

    const uTime = uniform(0);
    const uPulse = uniform(0); // audio/combo brightness pulse
    const uIntensity = uniform(1); // global dimmer (menu background → lower)

    // Palette — dark base so the void still reads as deep space, with sparse
    // saturated highlight pockets for the "chromadelic" identity. (Kept at the
    // liked brightness; depth/contrast now comes from the post grade + vignette,
    // NOT from crushing the palette — which previously pushed channels negative
    // and produced an olive ACES artefact.)
    const COL_DEEP = vec3(0.018, 0.010, 0.055); // deepest indigo
    const COL_VIOLET = vec3(0.090, 0.045, 0.190); // mid violet
    const COL_TEAL = vec3(0.030, 0.110, 0.180); // upper teal
    const HI_MAGENTA = vec3(0.34, 0.08, 0.42); // magenta nebula glow
    const HI_CYAN = vec3(0.055, 0.34, 0.47); // cyan nebula glow

    const colorNode = Fn(() => {
        const worldDir = normalize(positionWorld).toVar();
        const elevation = worldDir.y.toVar(); // -1 bottom → 1 top

        // Vertical gradient: deep indigo low → violet mid → teal high.
        const lower = mix(COL_DEEP, COL_VIOLET, smoothstep(-0.6, 0.1, elevation));
        const upper = mix(COL_VIOLET, COL_TEAL, smoothstep(0.0, 0.7, elevation));
        const gradient = mix(lower, upper, smoothstep(-0.1, 0.5, elevation)).toVar();

        // Domain-warped nebula clouds + a finer octave so it reads as layered
        // depth instead of one soft smoky blob. Slow time keeps it dreamlike.
        const cloudCoord = worldDir.mul(2.6).add(vec3(uTime.mul(0.035)));
        const base = warpedFbm3(cloudCoord, float(2.1));
        const detail = fbm3(worldDir.mul(6.5).add(vec3(uTime.mul(0.05))));
        const nebula = base.mul(0.80).add(detail.mul(0.20)).toVar();

        // Frame the title: keep the area straight ahead (screen-centre, where the
        // wordmark sits, worldDir.z ≈ -1) cleaner so bright pockets sit toward the
        // edges and FRAME the title instead of crossing it. Never fully zero so
        // the centre still has a hint of cloud.
        const frontFade = smoothstep(-1.0, -0.2, worldDir.z).mul(0.7).add(0.3);

        // Sparse highlight pockets only where FBM is high — soft edges via smoothstep.
        const nebulaMask = smoothstep(0.6, 0.9, nebula).mul(frontFade);
        // Hue of the pocket varies across the sky (cyan ↔ magenta) for a chromadelic feel.
        const hue = sin(worldDir.x.mul(2.3).add(worldDir.z.mul(1.7)).add(uTime.mul(0.05)))
            .mul(0.5).add(0.5);
        const highlight = mix(HI_CYAN, HI_MAGENTA, hue);
        const withClouds = mix(gradient, highlight, nebulaMask.mul(0.32));

        // Pulse: tiny additive on audio/combo events (caps low).
        const pulsed = withClouds.add(vec3(uPulse.mul(0.06)));

        // Procedural stars — only the top ~1% of texels above the horizon light up.
        const starUv = worldDir.xy.add(worldDir.zz.mul(0.5)).mul(90.0);
        const starNoise = valueNoise2(starUv);
        const starMask = smoothstep(0.986, 1.0, starNoise).mul(smoothstep(-0.2, 0.4, elevation));
        const stars = vec3(0.85, 0.92, 1.0).mul(starMask);

        return clamp(pulsed.add(stars), 0.0, 1.0).mul(uIntensity);
    })();

    const material = new THREE.MeshBasicNodeMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false, // the sky is the horizon — fog must not darken it
    });
    material.colorNode = colorNode;
    material.emissiveNode = vec3(0.0); // NOT bloom-eligible — keep the sky crisp

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -1000; // behind everything
    mesh.frustumCulled = false; // always render the sky

    return {
        mesh,
        uniforms: { uTime, uPulse, uIntensity },
        setIntensity(value) {
            uIntensity.value = Math.max(0, Math.min(1, value));
        },
        dispose() {
            geometry.dispose();
            material.dispose();
            mesh.removeFromParent();
        },
    };
}

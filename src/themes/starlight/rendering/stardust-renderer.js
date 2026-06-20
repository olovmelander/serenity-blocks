/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Starlight — Stardust Renderer
 *
 * Forked from electric-dreams-v3/rendering/fluid-particles-renderer.js. Renders
 * StardustSim's compute buffers as additive-blended camera-facing billboards —
 * positions + colors are read straight from the storage buffers (no CPU→GPU
 * transfer per frame). Starlight tweaks vs edv3:
 *   - per-particle TWINKLE (hashed phase/freq from instanceIndex) so the dust
 *     shimmers like fairy-light, under a slow global sky-breath envelope;
 *   - smaller, softer Gaussian motes (dust, not a fluid mass);
 *   - bloom-eligible emissive so the post pass (Phase 2) makes them glow.
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn,
    cameraProjectionMatrix,
    cameraViewMatrix,
    float,
    fract,
    instanceIndex,
    length,
    positionLocal,
    pow,
    sin,
    smoothstep,
    storage,
    uniform,
    uv,
    vec2,
    vec4,
} from 'three/tsl';

const BASE_MOTE_SIZE = 0.05; // world-space radius

export function createStardustRenderer(sim, options = {}) {
    const { count } = sim;
    const positionBuffer = sim.getPositionBuffer();
    const colorBuffer = sim.getColorBuffer();

    const geometry = new THREE.PlaneGeometry(1, 1);

    const uTime = uniform(0);
    const uSizeMul = uniform(options.sizeMul ?? 1.0);
    const uBrightness = uniform(options.brightness ?? 1.0);
    const uTwAmp = uniform(options.twinkleAmp ?? 0.8);

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    const positions = storage(positionBuffer, 'vec4', count);
    const colors = storage(colorBuffer, 'vec4', count);

    material.vertexNode = Fn(() => {
        const pdata = positions.element(instanceIndex).toVar();
        const cdata = colors.element(instanceIndex).toVar();
        const particlePos = pdata.xyz.toVar();
        const age = pdata.w.toVar();
        const energy = cdata.w.toVar();

        // Age bell-curve: fade in at birth, peak mid-life, fade at death.
        const ageFromMid = age.sub(0.5).mul(2.0);
        const sizePulse = float(1.0).sub(ageFromMid.mul(ageFromMid).mul(0.85));
        const size = float(BASE_MOTE_SIZE)
            .mul(uSizeMul)
            .mul(sizePulse)
            .mul(float(0.55).add(energy.mul(0.6)));

        const viewParticle = cameraViewMatrix.mul(vec4(particlePos, 1.0));
        const quadOffset = positionLocal.xy.mul(size);
        const viewPos = viewParticle.add(vec4(quadOffset.x, quadOffset.y, 0.0, 0.0));
        return cameraProjectionMatrix.mul(viewPos);
    })();

    const colorNode = Fn(() => {
        const cdata = colors.element(instanceIndex).toVar();
        const pdata = positions.element(instanceIndex).toVar();
        const baseColor = cdata.xyz.toVar();
        const energy = cdata.w.toVar();
        const age = pdata.w.toVar();

        // Soft radial disc.
        const uvc = uv().sub(vec2(0.5, 0.5));
        const r = length(uvc).mul(2.0);
        const disc = smoothstep(1.0, 0.0, r);
        const core = smoothstep(0.45, 0.0, r);

        // Per-particle twinkle (hashed phase/freq) under a slow sky-breath.
        const idx = float(instanceIndex);
        const phase = fract(sin(idx.mul(12.9898)).mul(43758.5453)).mul(6.2832);
        const freq = float(0.5).add(fract(sin(idx.mul(4.1414)).mul(27182.8)).mul(1.6));
        const tw = pow(sin(uTime.mul(freq).add(phase)).mul(0.5).add(0.5), float(2.0));
        const breath = float(0.9).add(float(0.1).mul(sin(uTime.mul(0.05))));

        // Age fade so respawns don't pop.
        const ageFromMid = age.sub(0.5).mul(2.0);
        const ageFade = float(1.0).sub(ageFromMid.mul(ageFromMid)).clamp(0.0, 1.0);

        const twinkleLum = float(0.35).add(uTwAmp.mul(tw).mul(0.65));
        const brightness = disc.mul(energy.mul(0.5).add(0.4))
            .add(core.mul(0.5))
            .mul(twinkleLum).mul(breath)
            .mul(ageFade)
            .mul(uBrightness);

        return vec4(baseColor.mul(brightness), disc.mul(ageFade).mul(0.9));
    })();

    material.colorNode = colorNode;
    material.emissiveNode = colorNode.rgb; // bloom samples this (Phase 2)
    material.userData.emitsBloom = true;

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5; // in front of the starfield canopy
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    return {
        mesh,
        material,
        uniforms: {
            uTime, uSizeMul, uBrightness, uTwAmp,
        },
        update(time) {
            uTime.value = time;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

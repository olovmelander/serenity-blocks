/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Starlight — Stardust Renderer
 *
 * Forked from murmuration/rendering/fluid-particles-renderer.js. Renders
 * StardustSim's motes as additive-blended camera-facing billboards. Native WebGPU
 * reads compute storage buffers; WebGL2 reads live instanced position/color
 * attributes. Starlight tweaks vs edv3:
 *   - per-particle TWINKLE (hashed phase/freq from instanceIndex) so the dust
 *     shimmers like fairy-light, under a slow global sky-breath envelope;
 *   - smaller, softer Gaussian motes (dust, not a fluid mass);
 *   - bloom-eligible emissive so the post pass (Phase 2) makes them glow.
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn,
    attribute,
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
    const useStorage = options.useStorage !== false;
    let positionAttribute = null;
    let colorAttribute = null;
    if (!useStorage) {
        positionAttribute = new THREE.InstancedBufferAttribute(sim.positionData, 4);
        colorAttribute = new THREE.InstancedBufferAttribute(sim.colorData, 4);
        positionAttribute.setUsage(THREE.DynamicDrawUsage);
        colorAttribute.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('aDustPosition', positionAttribute);
        geometry.setAttribute('aDustColor', colorAttribute);
    }

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

    const positions = useStorage ? storage(positionBuffer, 'vec4', count) : null;
    const colors = useStorage ? storage(colorBuffer, 'vec4', count) : null;
    const particlePosition = () => (useStorage
        ? positions.element(instanceIndex)
        : attribute('aDustPosition', 'vec4'));
    const particleColor = () => (useStorage
        ? colors.element(instanceIndex)
        : attribute('aDustColor', 'vec4'));

    material.vertexNode = Fn(() => {
        const pdata = particlePosition().toVar();
        const cdata = particleColor().toVar();
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
        const cdata = particleColor().toVar();
        const pdata = particlePosition().toVar();
        const baseColor = cdata.xyz.toVar();
        const energy = cdata.w.toVar();
        const age = pdata.w.toVar();

        // Soft radial disc.
        const uvc = uv().sub(vec2(0.5, 0.5));
        const r = length(uvc).mul(2.0);
        const disc = smoothstep(0.0, 1.0, r).oneMinus();
        const core = smoothstep(0.0, 0.45, r).oneMinus();

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
            if (positionAttribute) positionAttribute.needsUpdate = true;
            if (colorAttribute) colorAttribute.needsUpdate = true;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

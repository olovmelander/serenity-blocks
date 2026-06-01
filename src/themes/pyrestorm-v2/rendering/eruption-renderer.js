/* eslint-disable import/no-unresolved */
/**
 * Pyrestorm V2 — Eruption Renderer
 *
 * Additive camera-facing billboards reading position/velocity straight from the
 * compute storage buffers (no CPU→GPU transfer per frame). Particles are graded
 * by "heat" (height above the vent + remaining life) through the shared
 * heatRamp: white-hot at the base, cooling to orange→red and fading out as they
 * rise. That falloff is what makes the fountain read as a structured column
 * instead of the old saturated white sphere. Role (fountain / ember / bomb) is
 * recomputed from instance index to set base size.
 *
 * emissiveNode is set so Phase 6 MRT selective bloom catches the hot core.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    float,
    instanceIndex,
    length,
    oneMinus,
    positionLocal,
    smoothstep,
    step,
    storage,
    uniform,
    uv,
    vec2,
    vec4,
} from 'three/tsl';
import { heatRamp } from '../materials/tsl-fire-lib.js';

const VENT_Y = 155;

export function createEruptionRenderer(sim, options = {}) {
    const { count } = sim;
    const bombF = float(sim.bombCount);
    const emberF = float(sim.emberCount);

    const positions = storage(sim.getPositionBuffer(), 'vec4', count);

    const uSizeMul = uniform(options.sizeMul ?? 1.0);
    const uEmissiveMul = uniform(options.emissiveMul ?? 1.4);

    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
    });

    // Per-instance role masks (must match the sim's index partitioning).
    const idxF = float(instanceIndex);
    const bombMask = step(idxF, bombF);
    const emberMask = step(idxF, emberF).sub(bombMask);
    const fountainMask = float(1.0).sub(step(idxF, emberF));

    material.vertexNode = Fn(() => {
        const pdata = positions.element(instanceIndex).toVar();
        const ppos = pdata.xyz.toVar();
        const age = pdata.w.toVar();

        const sizeBase = fountainMask.mul(13.0).add(emberMask.mul(7.0)).add(bombMask.mul(32.0));
        // Bell-curve size over life: tiny at birth, peak mid, shrink at death.
        const pulse = smoothstep(0.0, 0.18, age).mul(oneMinus(smoothstep(0.55, 1.0, age)));
        const size = sizeBase.mul(uSizeMul).mul(pulse.mul(0.8).add(0.22));

        const viewParticle = cameraViewMatrix.mul(vec4(ppos, 1.0));
        const quadOffset = positionLocal.xy.mul(size);
        const viewPos = viewParticle.add(vec4(quadOffset.x, quadOffset.y, 0.0, 0.0));
        return cameraProjectionMatrix.mul(viewPos);
    })();

    const shade = Fn(() => {
        const pdata = positions.element(instanceIndex).toVar();
        const age = pdata.w.toVar();
        const py = pdata.y.toVar();

        const uvC = uv().sub(vec2(0.5, 0.5));
        const r = length(uvC).mul(2.0);
        const disc = smoothstep(1.0, 0.0, r);
        const core = smoothstep(0.5, 0.0, r);

        const heightHeat = smoothstep(950.0, float(VENT_Y), py);
        const ageHeat = oneMinus(age);
        const heat = clamp(heightHeat.mul(0.55).add(ageHeat.mul(0.6)), 0.0, 1.0).toVar();
        // Bombs stay hot/bright regardless of height.
        const heatBoosted = clamp(heat.add(bombMask.mul(0.3)), 0.0, 1.0);

        const color = heatRamp(heatBoosted);
        const fade = oneMinus(smoothstep(0.55, 1.0, age));
        // Tamed brightness so the additive stack doesn't saturate to a white
        // blob before selective bloom exists (Phase 6 will reintroduce HDR glow).
        const brightness = disc.mul(heat.mul(0.7).add(0.1)).mul(fade).add(core.mul(heat).mul(0.3));
        return vec4(color.mul(brightness).mul(0.6), disc.mul(fade).mul(0.7));
    })();

    material.colorNode = shade;
    material.emissiveNode = shade.rgb.mul(uEmissiveMul);
    material.userData.emitsBloom = true;

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    return {
        mesh,
        material,
        uniforms: { uSizeMul, uEmissiveMul },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

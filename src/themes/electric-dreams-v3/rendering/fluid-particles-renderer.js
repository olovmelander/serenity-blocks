/* eslint-disable import/no-unresolved */
/**
 * Electric Dreams V3 — Fluid Particles Renderer
 *
 * Renders the compute-driven particles as additive-blended billboards.
 * Each particle samples its position + color directly from the storage buffers
 * via TSL `storage().element()` — no CPU→GPU data transfer per frame.
 *
 * Visual approach:
 *   - InstancedMesh with a single quad (PlaneGeometry 1x1)
 *   - Vertex shader: reposition quad at particle world position, scaled by
 *     a per-particle base size + an age-driven size pulse
 *   - Fragment shader: radial alpha falloff (soft disc) + iridescent color mix
 *
 * Why billboards vs SSFR:
 *   SSFR (depth + thickness + bilateral filter + composite) is 4 separate
 *   passes and ~2ms of GPU work. Billboards with additive blending give us
 *   a visually rich "energetic fluid" look at ~0.5ms. We can upgrade to SSFR
 *   in a later phase if we want the smoother "translucent water" feel.
 *
 * Emissive handling:
 *   The material writes a non-zero emissive node so it's included in the MRT
 *   bloom pass. Bloom intensity scales with the per-particle energy value
 *   that the compute updates based on speed → fast-moving particles glow brighter.
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn,
    cameraProjectionMatrix,
    cameraViewMatrix,
    float,
    instanceIndex,
    length,
    mix,
    positionLocal,
    smoothstep,
    storage,
    uniform,
    uv,
    vec2,
    vec4,
} from 'three/tsl';
import { iridescentRamp } from '../materials/tsl-noise-lib.js';

const BASE_PARTICLE_SIZE = 0.06; // world-space radius

export function createFluidParticlesRenderer(sim, options = {}) {
    const { count } = sim;
    const positionBuffer = sim.getPositionBuffer();
    const colorBuffer = sim.getColorBuffer();

    // ─── Geometry: a single 1×1 quad, instanced N times ───
    // We use PlaneGeometry rather than BufferGeometry so we get UVs for free
    // (needed for the radial alpha falloff in the fragment stage).
    const geometry = new THREE.PlaneGeometry(1, 1);

    // ─── Uniforms ───
    const uTime = uniform(0);
    const uSizeMul = uniform(options.sizeMul ?? 1.0);
    const uEmissiveMul = uniform(options.emissiveMul ?? 1.0);

    // ─── Material ───
    // MeshBasicNodeMaterial: no lighting overhead. Fluid is self-illuminating.
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    // Vertex node: read particle position from storage, build a billboard.
    // Billboards face the camera by transforming the local quad corners
    // into camera-space and offsetting in clip-space.
    const positions = storage(positionBuffer, 'vec4', count);
    const colors = storage(colorBuffer, 'vec4', count);

    const vertexNode = Fn(() => {
        const pdata = positions.element(instanceIndex).toVar();
        const cdata = colors.element(instanceIndex).toVar();

        const particlePos = pdata.xyz.toVar();
        const age = pdata.w.toVar();
        const energy = cdata.w.toVar();

        // Per-particle size: base × global multiplier × age-pulse.
        // Particles "breathe" in size over their lifetime — small at birth,
        // peak at mid-life, fade at end.
        const ageFromMid = age.sub(0.5).mul(2.0); // -1..1
        const sizePulse = float(1.0).sub(ageFromMid.mul(ageFromMid).mul(0.7)); // bell curve
        const size = float(BASE_PARTICLE_SIZE)
            .mul(uSizeMul)
            .mul(sizePulse)
            .mul(float(0.6).add(energy.mul(0.6)));

        // Build the billboard: project the particle center to view space,
        // then offset by the (uv-0.5) × size in view-space XY. This makes the
        // quad always face the camera regardless of camera orientation.
        const viewParticle = cameraViewMatrix.mul(vec4(particlePos, 1.0));
        const quadOffset = positionLocal.xy.mul(size);
        const viewOffset = vec4(quadOffset.x, quadOffset.y, 0.0, 0.0);
        const viewPos = viewParticle.add(viewOffset);
        return cameraProjectionMatrix.mul(viewPos);
    })();

    // Fragment node: radial alpha falloff + iridescent color blend.
    const fragmentNode = Fn(() => {
        const cdata = colors.element(instanceIndex).toVar();
        const pdata = positions.element(instanceIndex).toVar();
        const baseColor = cdata.xyz.toVar();
        const energy = cdata.w.toVar();
        const age = pdata.w.toVar();

        // Radial mask: distance from quad center → smooth disc.
        const uvCentered = uv().sub(vec2(0.5, 0.5));
        const r = length(uvCentered).mul(2.0);
        const disc = smoothstep(1.0, 0.0, r);
        const core = smoothstep(0.6, 0.0, r); // brighter inner core

        // Iridescence: depth-of-age → 3-color palette ramp.
        // Adds visual variety without per-particle color storage cost.
        const iridT = age.mul(0.7).add(energy.mul(0.3));
        const iridColor = iridescentRamp(iridT);
        const color = mix(baseColor, iridColor, float(0.45));

        // Brightness: disc × energy × core boost
        const brightness = disc.mul(energy.mul(0.8).add(0.4)).add(core.mul(0.5));
        return vec4(color.mul(brightness), disc.mul(0.85));
    })();

    material.vertexNode = vertexNode;
    material.colorNode = fragmentNode;
    // Emissive node is what bloom samples in MRT mode. Match it to colorNode
    // intensity but scaled by emissive multiplier (quality-tier knob).
    material.emissiveNode = fragmentNode.rgb.mul(uEmissiveMul);
    material.userData.emitsBloom = true;

    // ─── Instanced mesh ───
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.frustumCulled = false; // particles can be anywhere; frustum test is wasted
    mesh.renderOrder = 5;

    // Disable instance matrix updates — we drive position from storage buffer
    // in the vertex shader, not from per-instance matrices.
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    return {
        mesh,
        material,
        uniforms: { uTime, uSizeMul, uEmissiveMul },
        update(delta, time) {
            uTime.value = time;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

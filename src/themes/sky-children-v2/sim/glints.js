/* eslint-disable import/no-unresolved */
/**
 * Sky Children V2 AAA — Drifting Light-Mote Glints
 *
 * A field of fine pollen / light motes drifting on the wind over the meadow,
 * catching the low golden-hour sun and twinkling — the look bible's "selective,
 * stable glitter/spark accents" (anchor #5), and the bit of life the disabled
 * legacy vegetation used to (badly) provide.
 *
 * Driven analytically from per-point attributes in the vertex shader (no compute):
 * a horizontal wind flow that WRAPS across the volume, a gentle bob, and a stable
 * twinkle (no random strobe). Wind speed + field density ramp with the shared
 * uGust, so the air comes alive on combos. Reads the orchestrator's shared
 * uniform block (uTime/uGust/uSunColor) — no per-frame JS update needed.
 *
 * Ported from himalayan-peak/sim/spindrift.js. See docs/SKY_CHILDREN_V2_AAA_PLAN.md §4.
 */
import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import {
    Fn,
    attribute,
    clamp,
    float,
    length,
    mod,
    positionLocal,
    positionView,
    sin,
    smoothstep,
    uv,
    vec3,
} from 'three/tsl';

const SPAN_X = 980; // horizontal wrap span

/**
 * @param {object} u    shared uniform block (uTime, uGust, uSunColor)
 * @param {object} opts { count }
 */
export function createGlints(u, opts = {}) {
    const count = Math.max(60, Math.floor(opts.count ?? 600));
    const positions = new Float32Array(count * 3);
    const rands = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
        positions[i * 3 + 0] = (Math.random() - 0.5) * SPAN_X;
        positions[i * 3 + 1] = 2 + Math.random() * 58; // low air over the meadow
        positions[i * 3 + 2] = -440 + Math.random() * 600; // -440 .. 160
        rands[i * 3 + 0] = Math.random();
        rands[i * 3 + 1] = Math.random();
        rands[i * 3 + 2] = Math.random();
        sizes[i] = 0.5 + Math.random() * 1.2;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aRand', new THREE.BufferAttribute(rands, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const material = new PointsNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    const aRand = attribute('aRand');
    const aSize = attribute('aSize');
    const phase = aRand.x.mul(6.2831);

    // Wind speed ramps with gust; the field also drifts a little on its own.
    const windSpeed = float(4.0).add(u.uGust.mul(34.0));

    material.positionNode = Fn(() => {
        const base = positionLocal.toVar();
        // Horizontal flow, wrapped across the span (continuous drift).
        const wx = mod(
            base.x.add(u.uTime.mul(windSpeed)).add(aRand.x.mul(SPAN_X)).add(SPAN_X * 0.5),
            float(SPAN_X),
        ).sub(SPAN_X * 0.5);
        const wy = base.y.add(sin(u.uTime.mul(0.5).add(phase)).mul(3.5))
            .add(sin(u.uTime.mul(0.21).add(phase.mul(1.7))).mul(2.2));
        const wz = base.z.add(sin(u.uTime.mul(0.32).add(phase.mul(1.3))).mul(6.0));
        return vec3(wx, wy, wz);
    })();

    // Warm motes catching the low sun; stable twinkle (gentle, never strobe).
    const twinkle = float(0.6).add(sin(u.uTime.mul(2.4).add(phase.mul(7.0))).mul(0.4));
    material.colorNode = vec3(1.0, 0.95, 0.82).mul(u.uSunColor).mul(twinkle);

    // Soft round sprite — in WebGPU PointsNodeMaterial, uv() gives the
    // per-fragment point sprite coordinate (whereas pointUV is buggy).
    const coord = uv().sub(0.5);
    const r = length(coord).mul(2.0);
    const mask = float(1.0).sub(smoothstep(float(0.15), float(1.0), r));

    // Fade far motes; ramp the whole field's presence with gust. Subtle at rest.
    const depthFade = clamp(float(1.0).add(positionView.z.mul(0.0016)), float(0.2), float(1.0));
    const fieldAlpha = float(0.12).add(u.uGust.mul(0.34));
    material.opacityNode = mask.mul(twinkle).mul(depthFade).mul(fieldAlpha);
    material.sizeNode = aSize.mul(float(1.0).add(u.uGust.mul(0.5)))
        .mul(float(300.0).div(positionView.z.negate()));
    // Subtle emissive (feeds bloom only when MRT selective bloom is enabled).
    material.emissiveNode = vec3(0.5, 0.47, 0.4).mul(mask).mul(0.3);
    material.userData.emitsBloom = true;

    const mesh = new THREE.Points(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;

    return {
        mesh,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

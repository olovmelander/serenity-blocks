/* eslint-disable import/no-unresolved */
/**
 * Himalayan Peak AAA — Spindrift / Blowing Snow
 *
 * A field of fine ice crystals catching the dawn light, drifting on the wind.
 * Driven analytically from per-point attributes in the vertex shader (no compute):
 * a horizontal wind flow that WRAPS across the volume, a gentle bob, and a twinkle.
 *
 * Wind speed scales with altitude — high motes streak fast like the jet-stream
 * spindrift blowing off the summits (the Everest-plume read), low motes drift
 * lazily in the valley air. Gust (from the AltitudeDirector) ramps the whole field.
 *
 * See docs/HIMALAYAN_PEAK_AAA_PLAN.md §3.2 / §3.1 (plume).
 */
import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import {
    Fn,
    attribute,
    clamp,
    float,
    mod,
    positionLocal,
    positionView,
    sin,
    smoothstep,
    uniform,
    vec3,
} from 'three/tsl';

const SPAN_X = 1700; // horizontal wrap span

export function createSpindrift(count = 4000) {
    const positions = new Float32Array(count * 3);
    const rands = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
        positions[i * 3 + 0] = (Math.random() - 0.5) * SPAN_X;
        positions[i * 3 + 1] = 60 + Math.random() * 320; // 60 .. 380
        positions[i * 3 + 2] = -700 + Math.random() * 740; // -700 .. 40
        rands[i * 3 + 0] = Math.random();
        rands[i * 3 + 1] = Math.random();
        rands[i * 3 + 2] = Math.random();
        sizes[i] = 1.4 + Math.random() * 2.6;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aRand', new THREE.BufferAttribute(rands, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const uTime = uniform(0);
    const uGust = uniform(0);
    const uWindDir = uniform(1); // -1 / +1
    const uTint = uniform(new THREE.Color(0xfdeedb));

    const material = new PointsNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    const aRand = attribute('aRand');
    const aSize = attribute('aSize');
    const phase = aRand.x.mul(6.2831);

    // Altitude → jet-stream factor (high motes streak fast).
    const altFactor = smoothstep(float(210.0), float(380.0), positionLocal.y);
    const windSpeed = float(5.0).add(uGust.mul(55.0)).mul(float(1.0).add(altFactor.mul(3.2))).mul(uWindDir);

    material.positionNode = Fn(() => {
        const base = positionLocal.toVar();
        // Horizontal flow, wrapped across the span (continuous river of snow).
        const wx = mod(
            base.x.add(uTime.mul(windSpeed)).add(aRand.x.mul(SPAN_X)).add(SPAN_X * 0.5),
            float(SPAN_X),
        ).sub(SPAN_X * 0.5);
        const wy = base.y.add(sin(uTime.mul(0.5).add(phase)).mul(7.0))
            .add(sin(uTime.mul(0.18).add(phase.mul(1.7))).mul(4.0));
        const wz = base.z.add(sin(uTime.mul(0.3).add(phase.mul(1.3))).mul(10.0));
        return vec3(wx, wy, wz);
    })();

    // Warm-white crystals catching the sun.
    const twinkle = float(0.7).add(sin(uTime.mul(3.0).add(phase.mul(9.0))).mul(0.3));
    material.colorNode = vec3(0.96, 0.97, 1.0).mul(uTint).mul(twinkle);

    // Tiny additive glints (no sprite-uv mask — Points carry no uv attribute,
    // and at this size soft squares read as sparkle just fine). Fade far motes;
    // ramp the whole field with gust.
    const depthFade = clamp(float(1.0).add(positionView.z.mul(0.0016)), float(0.25), float(1.0));
    const fieldAlpha = float(0.4).add(uGust.mul(0.5));
    material.opacityNode = twinkle.mul(depthFade).mul(fieldAlpha);
    material.sizeNode = aSize.mul(float(1.0).add(uGust.mul(0.4)))
        .mul(float(520.0).div(positionView.z.negate()));
    material.emissiveNode = vec3(0.5, 0.52, 0.6).mul(0.35);
    material.userData.emitsBloom = true;

    const mesh = new THREE.Points(geometry, material);
    mesh.frustumCulled = false;

    return {
        mesh,
        update(time, gust = 0, windDir = 1, tint = null) {
            uTime.value = time;
            uGust.value = gust;
            uWindDir.value = windDir;
            if (tint) uTint.value.copy(tint);
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

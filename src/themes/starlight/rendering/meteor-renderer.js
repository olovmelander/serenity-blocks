/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Starlight — Meteor Renderer
 *
 * Draws MeteorSystem's pool as velocity-stretched instanced billboards. The
 * per-instance InstancedBufferAttributes WRAP the system's Float32Arrays
 * directly (mutate in the system, flag needsUpdate here) — no per-frame copies.
 *
 * Each instance is a quad oriented in the SCREEN PLANE along the meteor's
 * projected travel direction, stretched to `len` (∝ speed), with a head→tail
 * heat-ramp gradient (white-blue core → gold → deep red → transparent) and a
 * bright head glow. Additive + bloom-eligible so the post pass sells the streak.
 *
 * Uses the proven InstancedBufferGeometry + TSL attribute() pattern (same as
 * deep-starfield) so it renders on both WebGPU and the WebGL2 fallback.
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    float,
    length,
    max,
    mix,
    positionLocal,
    pow,
    smoothstep,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

export function createMeteorRenderer(system, options = {}) {
    const count = system.max;

    const uIntensity = uniform(options.intensity ?? 1.0);
    const uWidth = uniform(options.width ?? 0.06);

    // Quad: x ∈ [-0.5, 0.5] (width axis), y ∈ [0, 1] (head→tail axis).
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, 0, 0,
        0.5, 0, 0,
        0.5, 1, 0,
        -0.5, 1, 0,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
        0, 0, 1, 0, 1, 1, 0, 1,
    ], 2));

    // Instanced attributes share the system's live arrays.
    const aHead = new THREE.InstancedBufferAttribute(system.head, 3);
    const aDir = new THREE.InstancedBufferAttribute(system.dir, 3);
    const aLen = new THREE.InstancedBufferAttribute(system.len, 1);
    const aAge = new THREE.InstancedBufferAttribute(system.age, 1);
    const aHeat = new THREE.InstancedBufferAttribute(system.heat, 1);
    aHead.setUsage(THREE.DynamicDrawUsage);
    aDir.setUsage(THREE.DynamicDrawUsage);
    aLen.setUsage(THREE.DynamicDrawUsage);
    aAge.setUsage(THREE.DynamicDrawUsage);
    aHeat.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aHead', aHead);
    geometry.setAttribute('aDir', aDir);
    geometry.setAttribute('aLen', aLen);
    geometry.setAttribute('aAge', aAge);
    geometry.setAttribute('aHeat', aHeat);
    geometry.instanceCount = count;

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    material.vertexNode = Fn(() => {
        const head = attribute('aHead', 'vec3');
        const dir = attribute('aDir', 'vec3');
        const len = attribute('aLen', 'float');

        const vHead = cameraViewMatrix.mul(vec4(head, 1.0)).toVar();
        const vDir = cameraViewMatrix.mul(vec4(dir, 0.0)).xyz.toVar();
        // Screen-plane travel direction (guard against head-on degenerate case).
        const m = max(length(vec2(vDir.x, vDir.y)), float(0.001));
        const travel2 = vec2(vDir.x, vDir.y).div(m);
        const tail2 = travel2.negate(); // tail trails behind the head
        const perp = vec2(tail2.y.negate(), tail2.x);

        // Collapse inactive meteors (len≈0) to zero area → invisible.
        const lenMask = smoothstep(0.0, 0.0001, len);
        const px = positionLocal.x;
        const py = positionLocal.y;
        const off = perp.mul(px.mul(uWidth).mul(lenMask)).add(tail2.mul(py.mul(len)));
        const vpos = vHead.add(vec4(off.x, off.y, 0.0, 0.0));
        return cameraProjectionMatrix.mul(vpos);
    })();

    const colorNode = Fn(() => {
        const age = attribute('aAge', 'float');
        const heat = attribute('aHeat', 'float');

        const v = uv();
        const along = v.y; // 0 head → 1 tail
        const across = abs(v.x.sub(0.5)).mul(2.0); // 0 center → 1 edge

        const widthFall = smoothstep(1.0, 0.0, across);
        const tailFall = pow(float(1.0).sub(along), float(1.4));
        const headGlow = smoothstep(0.16, 0.0, along).mul(widthFall);

        // Heat ramp head → tail.
        const cHead = vec3(0.92, 0.96, 1.1);
        const cMid = vec3(1.0, 0.82, 0.42);
        const cTail = vec3(0.7, 0.12, 0.05);
        const ramp = mix(
            mix(cHead, cMid, smoothstep(0.0, 0.4, along)),
            cTail,
            smoothstep(0.4, 1.0, along),
        );

        // Smooth fade-IN (ramp up over the first ~18% of life instead of popping
        // in) + fade-out, so a meteor never appears as a sudden bright slash that
        // flashes the whole screen through the additive + bloom path.
        const fadeIn = smoothstep(0.0, 0.18, age);
        const fadeOut = smoothstep(1.0, 0.55, age);
        const ageFade = fadeIn.mul(fadeOut);
        const heatBoost = float(0.5).add(heat.mul(0.7));

        const bright = widthFall.mul(tailFall).add(headGlow.mul(1.1))
            .mul(ageFade).mul(heatBoost)
            .mul(uIntensity)
            .clamp(0.0, 2.2); // cap HDR so additive+bloom can't blow out the frame
        const col = ramp.mul(bright);
        return vec4(col, bright.clamp(0.0, 1.0));
    })();

    material.colorNode = colorNode;
    material.emissiveNode = colorNode.rgb;
    material.userData.emitsBloom = true;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 6; // in front of stardust

    return {
        mesh,
        material,
        uniforms: { uIntensity, uWidth },
        // Flag the shared attributes for re-upload after the system mutated them.
        update() {
            aHead.needsUpdate = true;
            aDir.needsUpdate = true;
            aLen.needsUpdate = true;
            aAge.needsUpdate = true;
            aHeat.needsUpdate = true;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

/**
 * First Light — the motes: points of light rising through the whole depth of the world.
 *
 * One instanced quad per mote, placed entirely in the vertex stage from a static seed and the
 * rise clock (integrated on the CPU, so the pace follows the breath without the phase
 * jumping). A mote rises through the reference frame and the margin beyond it, so none pops in.
 * Near the eye a mote is large and soft (out of focus, a disc with a faint rim); far away it is a
 * point. Additive and premultiplied; a total light budget per tier keeps the field the same
 * brightness whatever the count.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    exp,
    float,
    fract,
    length,
    max,
    mix,
    mod,
    positionGeometry,
    sin,
    smoothstep,
    uv,
    varying,
    vec3,
    vec4,
} from 'three/tsl';
import { REF_CAMERA, buildMoteSeeds } from './intro-world-core.js';

const TAN_HALF = Math.tan((REF_CAMERA.fov * Math.PI) / 360);

/**
 * @param {object} u shared uniforms: rise, time, breath, aspect, moteGain
 * @param {{ count?: number }} [options]
 */
export function createMotes(u, { count = 1400 } = {}) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.getAttribute('position'));
    geometry.setAttribute('uv', quad.getAttribute('uv'));
    const seeds = buildMoteSeeds(count);
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geometry.instanceCount = count;

    const seed = attribute('aSeed', 'vec4');
    const { z } = seed;
    const hh = float(REF_CAMERA.z).sub(z).mul(TAN_HALF).toVar();
    const near = smoothstep(4.0, 18.0, z).toVar();
    const margin = float(2.0).add(near.mul(3.0));
    const span = hh.add(margin).mul(2.0);
    const speed = mix(float(0.18), float(0.62), fract(seed.w.mul(7.31))).mul(near.mul(1.4).add(1.0));
    const y = mod(seed.y.mul(span).add(speed.mul(u.rise)), span).sub(hh).sub(margin);
    const hw = hh.mul(max(u.aspect, 0.56)).mul(1.12);
    const x = seed.x.mul(hw).add(sin(u.time.mul(0.11).add(seed.w.mul(40.0))).mul(0.6));
    const center = vec3(x, y, z);

    // Size in world units: a point far away, a soft disc near the eye.
    const big = seed.w.mul(seed.w).mul(seed.w);
    const size = mix(float(0.05), float(0.16), big).mul(hh.mul(0.06).add(0.4)).add(near.mul(0.9));
    const view = cameraViewMatrix.mul(vec4(center, 1.0));
    const corner = positionGeometry.xy.mul(size);
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
    });
    material.name = 'FirstLightMotes';
    material.fog = false;
    material.vertexNode = cameraProjectionMatrix.mul(vec4(view.xyz.add(vec3(corner, 0.0)), 1.0));

    const vNear = varying(near, 'flMoteNear');
    const vSeed = varying(seed, 'flMoteSeed');
    const vEdge = varying(clamp(float(1.0).sub(y.add(hh).div(hh.mul(2.2))), 0.0, 1.0), 'flMoteLow');
    material.outputNode = Fn(() => {
        const r = length(uv().sub(0.5)).mul(2.0);
        const point = exp(r.mul(r).mul(-7.0));
        // Out of focus: a soft, flat-topped disc (no rim: a rim reads as a bubble).
        const disc = float(1.0).sub(smoothstep(0.35, 1.0, r)).mul(0.4);
        const shape = mix(point, disc, vNear);
        const s = vSeed;
        const tint = mix(
            mix(vec3(0.86, 0.92, 1.0), vec3(0.42, 0.34, 1.0), fract(s.w.mul(3.7))),
            vec3(0.3, 0.86, 1.0),
            fract(s.w.mul(11.3)).mul(0.6),
        );
        const twinkle = sin(u.time.mul(fract(s.w.mul(5.1)).mul(2.0).add(0.6)).add(s.x.mul(31.0))).mul(0.3).add(0.75);
        // Brighter low down, where they rise out of the light.
        const low = vEdge.mul(0.8).add(0.5);
        const gain = mix(float(0.85), float(0.05), vNear).mul(u.moteGain);
        const rgb = tint.mul(shape).mul(twinkle).mul(low).mul(u.breath.mul(0.4).add(0.8))
            .mul(gain);
        return vec4(max(rgb, vec3(0.0)), 0.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'FirstLightMotes';
    mesh.frustumCulled = false;
    mesh.renderOrder = 70;
    return {
        mesh,
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            quad.dispose();
            material.dispose();
        },
    };
}

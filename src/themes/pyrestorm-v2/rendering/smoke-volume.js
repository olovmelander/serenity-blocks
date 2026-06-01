/* eslint-disable import/no-unresolved */
/**
 * Pyrestorm V2 — Smoke Plume
 *
 * A churning smoke column rising from the crater. Camera-facing billboards
 * whose positions are computed entirely in the vertex shader from per-instance
 * index hashes + uTime (no CPU update loop, no compute pass). Each puff rises
 * from the vent, swirls, and expands as it climbs, then recycles.
 *
 * Normal-blended and dark — drawn AFTER the additive fire (higher renderOrder)
 * so it occludes/darkens the top of the fountain. That is the "dark smoke
 * shoulders" contrast that stops the eruption reading as a glowing white ball.
 * The base of each puff is lit warm by the lava below; it cools to ash as it
 * rises.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    cameraProjectionMatrix,
    cameraViewMatrix,
    cos,
    float,
    fract,
    instanceIndex,
    length,
    mix,
    oneMinus,
    positionLocal,
    sin,
    smoothstep,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { fbm3 } from '../materials/tsl-fire-lib.js';

const VENT_Y = 155;
const PLUME_HEIGHT = 1500;
const BASE_R = 70;
const SPREAD_R = 560;
const BASE_SIZE = 230;

const hash = (n) => fract(sin(n).mul(43758.5453));

export function createSmokePlume({ count = 90 } = {}) {
    const uTime = uniform(0);
    const uIntensity = uniform(0);
    const uSizeMul = uniform(1.0);

    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.NormalBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    // Per-instance loop progress (recomputed identically in vertex + fragment).
    const idxF = float(instanceIndex);
    const s1 = hash(idxF.mul(12.9898));
    const s2 = hash(idxF.mul(78.233));
    const s3 = hash(idxF.mul(39.425));
    const speed = float(0.045).add(s3.mul(0.04));
    const tProg = fract(uTime.mul(speed).add(s1));

    material.vertexNode = Fn(() => {
        const t = tProg.toVar();
        const y = float(VENT_Y).add(t.mul(PLUME_HEIGHT));
        const ang = s2.mul(6.2832).add(uTime.mul(0.05));
        const radial = float(BASE_R).add(t.mul(SPREAD_R)).mul(s1.mul(0.5).add(0.6));
        const center = vec3(cos(ang).mul(radial), y, sin(ang).mul(radial));

        const size = float(BASE_SIZE).mul(t.mul(1.6).add(0.5)).mul(uSizeMul);
        const viewParticle = cameraViewMatrix.mul(vec4(center, 1.0));
        const off = positionLocal.xy.mul(size);
        return cameraProjectionMatrix.mul(viewParticle.add(vec4(off.x, off.y, 0.0, 0.0)));
    })();

    const shade = Fn(() => {
        const t = tProg.toVar();
        const uvC = uv().sub(vec2(0.5, 0.5));
        const r = length(uvC).mul(2.0);
        const disc = smoothstep(1.0, 0.0, r);
        const puff = fbm3(vec3(uv().mul(3.2), s1.mul(10.0).add(uTime.mul(0.2))));
        const edge = disc.mul(puff.mul(0.6).add(0.45));

        const warm = vec3(0.6, 0.26, 0.08); // lit by lava at the base
        const dark = vec3(0.05, 0.04, 0.045); // cooled ash up high
        const color = mix(warm, dark, smoothstep(0.0, 0.4, t));

        const fade = smoothstep(0.0, 0.12, t).mul(oneMinus(smoothstep(0.6, 1.0, t)));
        const alpha = edge.mul(fade).mul(uIntensity.mul(0.35).add(0.5));
        return vec4(color, alpha);
    })();

    material.colorNode = shade;
    material.emissiveNode = vec3(0.0); // smoke does not bloom

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.frustumCulled = false;
    mesh.renderOrder = 12; // after the additive fire so it darkens the top
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    return {
        mesh,
        uniforms: { uTime, uIntensity, uSizeMul },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

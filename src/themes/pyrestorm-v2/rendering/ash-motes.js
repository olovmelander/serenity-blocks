/* eslint-disable import/no-unresolved */
/**
 * Pyrestorm V2 — Ash Motes
 *
 * Dark ash drifting down through the scene. Camera-facing billboards positioned
 * entirely in the vertex shader from per-instance hashes + uTime (fall loop +
 * sine drift) — no CPU loop. Soft round alpha (fixes the old theme's square
 * PointsMaterial sprites) and normal-blended dark so they read as flecks of
 * cooled ash, faintly lit warm near the ground.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    cameraProjectionMatrix,
    cameraViewMatrix,
    float,
    fract,
    instanceIndex,
    length,
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

const SPREAD = 2800;
const TOP_Y = 520;
const RANGE = 760; // vertical travel before recycling

const hash = (n) => fract(sin(n).mul(43758.5453));

export function createAshMotes({ count = 1500 } = {}) {
    const uTime = uniform(0);

    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.NormalBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    const idxF = float(instanceIndex);
    const s1 = hash(idxF.mul(12.9898));
    const s2 = hash(idxF.mul(78.233));
    const s3 = hash(idxF.mul(39.425));

    material.vertexNode = Fn(() => {
        const fallSpeed = s3.mul(30.0).add(15.0);
        const t = fract(uTime.mul(fallSpeed).div(RANGE).add(s1));
        const y = float(TOP_Y).sub(t.mul(RANGE));
        const driftX = sin(uTime.mul(0.5).add(s1.mul(6.2832))).mul(28.0);
        const driftZ = sin(uTime.mul(0.4).add(s2.mul(6.2832))).mul(28.0);
        const center = vec3(
            s1.sub(0.5).mul(SPREAD).add(driftX),
            y,
            s2.sub(0.5).mul(SPREAD).add(driftZ),
        );

        const size = s3.mul(8.0).add(5.0);
        const viewParticle = cameraViewMatrix.mul(vec4(center, 1.0));
        const off = positionLocal.xy.mul(size);
        return cameraProjectionMatrix.mul(viewParticle.add(vec4(off.x, off.y, 0.0, 0.0)));
    })();

    const shade = Fn(() => {
        const uvC = uv().sub(vec2(0.5, 0.5));
        const r = length(uvC).mul(2.0);
        const disc = smoothstep(1.0, 0.0, r);
        // Faintly warm where ash is near the molten ground.
        const lowWarm = oneMinus(s2).mul(0.12);
        const color = vec3(0.07, 0.05, 0.05).add(vec3(0.25, 0.08, 0.0).mul(lowWarm));
        return vec4(color, disc.mul(0.42));
    })();

    material.colorNode = shade;
    material.emissiveNode = vec3(0.0);

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.frustumCulled = false;
    mesh.renderOrder = 8;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    return {
        mesh,
        uniforms: { uTime },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

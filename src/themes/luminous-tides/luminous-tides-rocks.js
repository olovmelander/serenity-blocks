/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, cameraPosition, dot, exp, float, floor, fract, max, mix, normalWorld, normalize,
    positionWorld, sin, smoothstep, texture, vec3,
} from 'three/tsl';
import shapes from './luminous-tides-basalt.json';
import {
    BASALT, SURF, fromShore, sandHeight,
} from './luminous-tides-core.js';
import {
    crestOf, landLight, sandOf, shoreOf, skyBase, surfPhaseOf, swashOf,
} from './luminous-tides-tsl.js';

/** The tide-worn stones share one draw. The water itself hides their submerged faces. */
export function createRocks(U, noise) {
    const positions = [];
    const indices = [];
    BASALT.forEach(([a, s, radius, height, angle], i) => {
        const { x, z } = fromShore(a, s);
        const shape = shapes[i % shapes.length];
        const first = positions.length / 3;
        const c = Math.cos(angle) * (radius / 1000);
        const k = Math.sin(angle) * (radius / 1000);
        const yScale = height / 1000;
        const base = sandHeight(s);
        for (let j = 0; j < shape.positions.length; j += 3) {
            const px = shape.positions[j];
            const py = shape.positions[j + 1];
            const pz = shape.positions[j + 2];
            positions.push(x + c * px - k * pz, base + py * yScale, z + k * px + c * pz);
        }
        shape.indices.forEach((index) => indices.push(first + index));
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshBasicNodeMaterial({ fog: false });
    material.name = 'luminous-tides-basalt';
    material.colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const N = normalize(normalWorld).toVar();
        const V = normalize(cameraPosition.sub(P)).toVar();
        const sh = shoreOf(P.xz).toVar();
        const lift = P.y.sub(max(0, sandOf(sh.y))).toVar();
        const phase = surfPhaseOf(sh.x, float(0), U.time).toVar();
        const front = swashOf(crestOf(floor(phase)), fract(phase).mul(SURF.period));
        const lap = smoothstep(-0.45, 0.4, front.add(sh.y)).toVar();
        const grain = texture(noise, P.xz.mul(1.3).add(P.y.mul(0.8))).a.toVar();
        const high = lift.add(grain.sub(0.5).mul(0.046)).toVar();
        const wet = smoothstep(lap.mul(0.12).add(0.11), -0.015, high);
        const seam = sin(P.y.mul(26).add(P.x.mul(3)).add(grain.mul(1.7)));
        const albedo = vec3(0.22, 0.205, 0.23).mul(grain.mul(0.42).add(0.75)).mul(seam.mul(0.075).add(1));
        const stone = landLight(N, V, albedo, lift.max(0), sh.y.negate(), float(0.35), U);
        const rim = float(1).sub(max(dot(N, V), 0)).pow2();
        const mirror = skyBase(V.negate().reflect(N), U).mul(rim.mul(0.43).add(0.095));
        const edge = exp(abs(high.sub(lap.mul(0.035))).mul(-37)).mul(lap).mul(grain).mul(0.62);
        return mix(stone, stone.mul(0.48).add(mirror), wet).add(U.light.glow.mul(edge).mul(U.glowPower));
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = material.name;
    return mesh;
}

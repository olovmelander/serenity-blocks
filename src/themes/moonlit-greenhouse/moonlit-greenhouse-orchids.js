import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, clamp, dot, float, fract, fwidth, mix, normalWorldGeometry, normalize, positionGeometry,
    positionLocal, positionWorld, sin, smoothstep, vec3, vec4,
} from 'three/tsl';
import { ORCHID } from './moonlit-greenhouse-specimens.js';

function bytes(encoded) {
    return Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
}

// Epiphytes rooted in the bed fronts, a second flight higher in the hanging greenery.
// The miniature specimens further down the nave are shared instances of the same raceme.
const SPRAYS = [
    [-3.75, 0.95, -1.8, 0.32, 0.08, 1.40], [3.58, 1.16, -1.25, -0.43, -0.18, 1.45],
    [-3.82, 1.55, -5.7, -0.1, 0.22, 1.22], [3.85, 1.7, -7.5, 0.5, 0.11, 1.13],
    [-3.58, 3.96, -5.0, 0.1, -0.72, 0.98], [3.45, 4.55, -7.2, -0.36, -0.58, 1.14],
    [3.9, 0.85, -12.6, 0.45, -0.11, 1.22], [-3.86, 1.38, -15.2, -0.32, 0.42, 1.36],
    [-3.72, 0.9, -22.4, 0.8, -0.22, 1.32], [3.68, 3.0, -20.4, -0.28, 0.32, 1.23],
];

export function createOrchids({ tier, U }) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Int16Array(bytes(ORCHID.positions).buffer);
    const metres = Float32Array.from(positions, (p) => p / 10000);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(metres, 3));
    geometry.setAttribute('aPigment', new THREE.Uint8BufferAttribute(bytes(ORCHID.pigment), 4, true));
    geometry.setAttribute('aPetalUv', new THREE.Uint8BufferAttribute(bytes(ORCHID.petalUv), 2, true));
    geometry.setIndex(new THREE.Uint16BufferAttribute(new Uint16Array(bytes(ORCHID.index).buffer), 1));
    geometry.computeVertexNormals();
    const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
    material.name = 'moonlit-greenhouse-orchid';
    material.positionNode = Fn(() => {
        const p = positionLocal;
        const bend = positionGeometry.y.pow2().mul(U.gust.add(U.weather.w.mul(0.17)));
        const sway = sin(U.time.mul(0.56).add(p.z.mul(0.62))).mul(bend);
        return p.add(vec3(sway.mul(0.16), sway.mul(0.035), sway.mul(0.07)));
    })();
    material.colorNode = Fn(() => {
        const pigment = attribute('aPigment', 'vec4');
        const p = positionWorld;
        const n = normalize(normalWorldGeometry);
        const sky = abs(dot(n, U.moon)).mul(0.34).add(0.12).mul(U.moonLight);
        const lamps = U.night.lantern.mul(U.lanternGain).mul(clamp(n.y.mul(0.15).add(0.16), 0.03, 0.34));
        const curl = abs(dot(n, normalize(U.eye.sub(p))));
        const silk = U.night.moonlight.mul(float(1).sub(curl).mul(0.09)).mul(pigment.w);
        const cultivar = smoothstep(-0.58, 0.68, sin(p.z.mul(0.62).add(p.x.mul(0.47))));
        const dye = mix(vec3(0.94, 1.03, 0.95), vec3(1.05, 0.45, 0.79), cultivar);
        // Fine branching lines radiate from the throat, disappearing under a pixel in the far beds.
        const uv = attribute('aPetalUv', 'vec2');
        const lateral = abs(uv.x.mul(2).sub(1));
        const strand = lateral.mul(uv.y.mul(0.86).add(2.4)).sub(sin(uv.y.mul(3.5)).mul(0.26));
        const footprint = fwidth(strand).toVar();
        const ink = float(1).sub(smoothstep(0.021, footprint.add(0.075), abs(fract(strand.add(0.5)).sub(0.5))));
        const fade = float(1).sub(smoothstep(0.1, 0.59, footprint)).mul(float(1).sub(smoothstep(0.35, 0.96, uv.y)));
        const pattern = mix(vec3(1), vec3(0.82, 0.31, 0.54), ink.mul(fade).mul(0.70));
        const petals = pigment.xyz.mul(mix(vec3(1), dye, pigment.w)).mul(pattern);
        const lit = petals.mul(U.night.moonlight.mul(sky).add(lamps)).add(silk);
        return vec4(lit.mul(float(1).sub(U.hush.mul(0.6))), 1);
    })();
    const count = Math.min(SPRAYS.length, tier.palms);
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = 'moonlit-greenhouse-orchid-sprays';
    mesh.renderOrder = 5;
    const pose = new THREE.Object3D();
    for (let i = 0; i < count; i += 1) {
        const [x, y, z, yaw, roll, scale] = SPRAYS[i];
        pose.position.set(x, y, z);
        // Positive scale keeps the winding and lighting consistent on both banks.
        pose.rotation.set(0.1, yaw, (x > 0 ? 1.1 : -0.19) + roll, 'YXZ');
        pose.scale.setScalar(scale);
        pose.updateMatrix();
        mesh.setMatrixAt(i, pose.matrix);
    }
    mesh.computeBoundingSphere();
    return {
        mesh,
        dispose() {
            mesh.removeFromParent();
            mesh.dispose();
            geometry.dispose();
            material.dispose();
        },
    };
}

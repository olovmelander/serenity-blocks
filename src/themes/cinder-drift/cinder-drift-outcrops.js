import * as THREE from 'three/webgpu';
import {
    Fn, abs, cameraViewMatrix, clamp, dot, exp, float, fract, max, mix, normalFlat, normalize, positionWorld,
    smoothstep, uv, vec2, vec3,
} from 'three/tsl';
import basaltFan from './assets/basalt-fan.json';
import { cdAtmosphere, cdCurtain, cdGlowGain } from './cinder-drift-tsl.js';

/** Fractured fans of tilted columnar basalt below the two standing buttresses. */
export function createOutcrops(u) {
    const geometry = new THREE.BufferGeometryLoader().parse(basaltFan);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'CinderBasaltFan';
    material.fog = false;
    material.colorNode = Fn(() => {
        const p = positionWorld;
        const n = normalFlat.transformNormalByInverseViewMatrix(cameraViewMatrix).toVar();
        // Ash collects on broken ends. Narrow side faces carry iron scale and catch lake light.
        const stone = uv();
        const face = p.x.mul(n.z).sub(p.z.mul(n.x)).add(stone.y.mul(3.1));
        const s = u.noise(vec2(face.mul(0.62), stone.x.mul(0.35))).toVar();
        const flecks = u.noise(vec2(face.mul(3.2), stone.x.mul(3.8))).toVar();
        const stepEdge = fract(stone.x.mul(2.1).add(s.g.mul(0.40)).add(stone.y)).toVar();
        const fracture = smoothstep(0.025, 0.13, abs(stepEdge.sub(0.5)));
        const scar = smoothstep(0.58, 0.75, s.b.add(flecks.g.sub(0.5).mul(0.55)));
        const cap = smoothstep(0.23, 0.85, n.y);
        const albedo = mix(vec3(0.037, 0.043, 0.056), vec3(0.12, 0.143, 0.17), cap)
            .mul(s.r.mul(0.95).add(flecks.r.mul(0.76)).add(0.13)).mul(fracture.mul(0.53).add(0.47))
            .add(scar.mul(vec3(0.042, 0.027, 0.024)));
        const sky = max(dot(n, normalize(u.skyTop.sub(p))), 0).mul(1.45).add(cap.mul(0.55));
        const fall = max(dot(n, normalize(u.fallPos.sub(p))), 0).mul(u.fallGain);
        const lava = clamp(dot(n, vec3(-0.74, -0.42, 0.52)).mul(0.78).add(0.52), 0, 1)
            .mul(exp(max(p.y, 0).mul(-0.40))).mul(cdGlowGain(u));
        const light = u.cool.mul(sky.mul(1.12).add(0.17)).add(u.mid.mul(lava.mul(1.24).add(fall.mul(0.49))))
            .add(u.hot.mul(fall.mul(0.15)))
            .add(cdCurtain(u, p, n))
            .add(0.08);
        const toe = float(1).sub(smoothstep(-0.02, 0.22, p.y.add(s.g.sub(0.5).mul(0.17))));
        return cdAtmosphere(u, albedo.mul(light).add(u.deep.mul(toe.mul(0.30))), p);
    })();

    const sites = [
        // x, z, heading, scale: a full fan at the right shore and an oblique, half-buried one at left.
        [9.25, -13.9, -0.24, 0.89], [-14.2, -19.8, 2.52, 0.72],
    ];
    const mesh = new THREE.InstancedMesh(geometry, material, sites.length);
    mesh.name = 'CinderBasaltFans';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    const transform = new THREE.Object3D();
    sites.forEach(([x, z, yaw, size], i) => {
        transform.position.set(x, -0.10, z);
        transform.rotation.y = yaw;
        transform.scale.setScalar(size);
        transform.updateMatrix();
        mesh.setMatrixAt(i, transform.matrix);
    });
    return { mesh, geometry, material };
}

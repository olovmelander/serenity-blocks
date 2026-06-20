/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Winter Snow Field — WebGPU point-cloud visibility proof.
 *
 * Three r181's WebGPU backend renders `THREE.Points` as 1-pixel primitives:
 * point-sprite UV masks and `sizeNode` do not create textured flakes here.
 * This playground effect validates the corrected role for the winter compute
 * snow: a dense, moonlit fine-snow sheet. Crystal shapes stay in the existing
 * instanced close-flake layer, where quad UVs are real.
 */
import * as THREE from 'three/webgpu';
import {
    attribute,
    uniform,
    positionLocal,
    positionView,
    vec3,
    float,
    sin,
    mix,
} from 'three/tsl';

export const meta = {
    id: 'winter-snow-crystals',
    title: 'Winter Snow Field',
    description: 'Visible WebGPU point-snow sheet for the winter storm field.',
};

function createPointSnowMaterial() {
    const material = new THREE.PointsNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.NormalBlending;
    material.premultipliedAlpha = true;

    const uTime = uniform(0);
    const uStorm = uniform(0.45);

    const aDepth = attribute('depth');
    const aPhase = attribute('phase');
    const aWobbleSpeed = attribute('wobbleSpeed');
    const aSize = attribute('size');

    const wind = sin(positionLocal.y.mul(0.018).add(uTime.mul(1.4))).mul(44.0).mul(uStorm);
    const fall = uTime.mul(mix(float(22.0), float(70.0), aDepth)).negate();
    const pos = vec3(
        positionLocal.x.add(wind),
        positionLocal.y.add(fall).add(310.0).mod(620.0).sub(310.0),
        positionLocal.z.add(sin(uTime.mul(aWobbleSpeed).add(aPhase)).mul(20.0).mul(aDepth)),
    );
    material.positionNode = pos;

    const twinkle = float(0.82).add(sin(uTime.mul(3.0).add(aPhase.mul(11.0))).mul(0.18));
    const depthAlpha = float(0.2).add(aDepth.mul(0.32));
    const stormAlpha = float(1.0).add(uStorm.mul(0.28));
    const alpha = depthAlpha.mul(twinkle).mul(stormAlpha);
    const cold = mix(vec3(0.5, 0.62, 0.82), vec3(0.9, 0.96, 1.0), aDepth);

    material.colorNode = cold.mul(alpha);
    material.opacityNode = alpha;
    // Ignored for WebGPU `Points`, but kept so the same material is readable if
    // Three later routes point clouds through sprite expansion.
    material.sizeNode = aSize.mul(float(700.0).div(positionView.z.negate()));
    material.emissiveNode = vec3(0.0);

    return { material, uniforms: { uTime, uStorm } };
}

export function create({ scene, camera }) {
    scene.background = new THREE.Color(0x06101d);
    camera.position.set(0, 0, 520);
    camera.lookAt(0, 0, -300);

    const count = 9000;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const depths = new Float32Array(count);
    const phases = new Float32Array(count);
    const wobbleSpeeds = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
        const i3 = i * 3;
        const depth = Math.random();
        positions[i3] = (Math.random() - 0.5) * 1300;
        positions[i3 + 1] = (Math.random() - 0.5) * 720;
        positions[i3 + 2] = -120 - Math.random() * 920;
        depths[i] = depth;
        sizes[i] = 1 + Math.random() * 2.5;
        phases[i] = Math.random() * Math.PI * 2;
        wobbleSpeeds[i] = 0.8 + Math.random() * 1.8;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('depth', new THREE.BufferAttribute(depths, 1));
    geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute('wobbleSpeed', new THREE.BufferAttribute(wobbleSpeeds, 1));

    const { material, uniforms } = createPointSnowMaterial();
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    scene.add(points);

    return {
        cameraRadius: 520,
        camera(_time, activeCamera) {
            activeCamera.position.set(0, 0, 520);
            activeCamera.lookAt(0, 0, -300);
        },
        update(time) {
            uniforms.uTime.value = time;
            uniforms.uStorm.value = 0.45 + Math.sin(time * 0.4) * 0.18;
        },
        dispose() {
            scene.remove(points);
            geometry.dispose();
            material.dispose();
        },
    };
}

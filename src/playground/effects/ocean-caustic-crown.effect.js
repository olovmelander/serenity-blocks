/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
import * as THREE from 'three/webgpu';
import {
    abs,
    atan,
    cameraPosition,
    color,
    float,
    length,
    mix,
    mx_worley_noise_float as worleyNoise,
    normalWorld,
    pass,
    positionWorld,
    pow,
    renderOutput,
    sin,
    smoothstep,
    toneMapping,
    uniform,
    uv,
    vec3,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../../themes/shared/bloom-dispose.js';

export const meta = {
    id: 'ocean-caustic-crown',
    title: 'Ocean Caustic Crown',
    description: 'Phase-locked lock/combo hero beat: pearl seal, caustic crown, and bubble plume.',
};

const BUBBLE_COUNT = 22;
const CROWN_COUNT = 2;

function createSandMaterial(uTime) {
    const material = new THREE.MeshStandardNodeMaterial({
        roughness: 0.88,
        metalness: 0,
    });
    const p = positionWorld.xz;
    const causticA = worleyNoise(p.mul(0.7).add(vec3(uTime.mul(0.12), 0, 0).xz), 0.82);
    const causticB = worleyNoise(p.mul(0.93).sub(vec3(0, 0, uTime.mul(0.09)).xz), 0.72);
    const lace = pow(abs(causticA.sub(causticB)), float(2.4));
    const basin = smoothstep(float(0), float(8), length(p));
    const sand = mix(vec3(0.08, 0.16, 0.19), vec3(0.34, 0.29, 0.20), basin.mul(0.52));
    material.colorNode = sand.add(vec3(0.08, 0.42, 0.38).mul(lace.mul(0.24)));
    material.roughnessNode = mix(float(0.96), float(0.72), lace);
    material.emissiveNode = vec3(0);
    return material;
}

function createCrownMaterial(uTime, uPulse) {
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });

    const centered = uv().sub(0.5);
    const radius = length(centered).mul(2);
    const angle = atan(centered.y, centered.x);
    const ring = smoothstep(float(0.78), float(0.83), radius).mul(
        float(1).sub(smoothstep(float(0.97), float(1), radius)),
    );
    const core = smoothstep(float(0.88), float(0.925), radius).mul(
        float(1).sub(smoothstep(float(0.965), float(0.995), radius)),
    );
    const warpedAngle = angle.mul(11).add(
        sin(angle.mul(3).sub(uTime.mul(0.42))).mul(1.35),
    );
    const spokes = pow(abs(sin(warpedAngle.add(uTime.mul(0.55)))), float(13));
    const pearls = pow(abs(sin(angle.mul(5).sub(uTime.mul(1.15)))), float(24));
    const travelingWave = sin(radius.mul(38).sub(uTime.mul(4.2))).mul(0.5).add(0.5);
    const lace = ring.mul(spokes.mul(0.72).add(pearls.mul(0.34))).mul(uPulse);
    const body = ring.mul(travelingWave.mul(0.34).add(0.22)).mul(uPulse);
    const energy = body.add(core.mul(0.72)).add(lace.mul(0.68));
    const warmth = smoothstep(float(0.38), float(0.96), spokes.add(pearls.mul(0.45)));
    const crownColor = mix(vec3(0.04, 0.78, 0.88), vec3(1.0, 0.72, 0.28), warmth)
        .mul(energy.mul(0.62));

    material.colorNode = crownColor;
    material.opacityNode = energy.mul(0.74);
    material.emissiveNode = crownColor.mul(0.48);
    return material;
}

function createPearlMaterial(uTime, uPulse) {
    const material = new THREE.MeshPhysicalNodeMaterial({
        roughness: 0.16,
        metalness: 0.02,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        iridescence: 0.72,
        iridescenceIOR: 1.32,
        iridescenceThicknessRange: [180, 520],
    });
    const viewDirection = cameraPosition.sub(positionWorld).normalize();
    const fresnel = pow(float(1).sub(normalWorld.dot(viewDirection).max(0)), float(3));
    const shimmer = sin(uTime.mul(2.2)).mul(0.5).add(0.5);
    material.colorNode = mix(color(0x80ecff), color(0xffd58a), fresnel.mul(0.58));
    material.emissiveNode = mix(vec3(0.02, 0.22, 0.32), vec3(0.48, 0.28, 0.08), fresnel)
        .mul(uPulse.mul(float(0.62).add(shimmer.mul(0.22))));
    return material;
}

export function create({ scene, camera, renderer }) {
    scene.background = new THREE.Color(0x031827);
    scene.fog = new THREE.FogExp2(0x07334a, 0.026);

    camera.near = 0.1;
    camera.far = 90;
    camera.position.set(8.4, 6.8, 11.8);
    camera.lookAt(0, 0.1, 0);
    camera.updateProjectionMatrix();

    const uTime = uniform(0);
    const uPulse = uniform(1);

    const sandGeometry = new THREE.CircleGeometry(9.5, 128);
    sandGeometry.rotateX(-Math.PI / 2);
    const sandMaterial = createSandMaterial(uTime);
    const sand = new THREE.Mesh(sandGeometry, sandMaterial);
    sand.position.y = -0.08;
    scene.add(sand);

    const crownGeometry = new THREE.RingGeometry(0.78, 1, 160, 2);
    crownGeometry.rotateX(-Math.PI / 2);
    const crownMaterial = createCrownMaterial(uTime, uPulse);
    const crowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, CROWN_COUNT);
    crowns.frustumCulled = false;
    scene.add(crowns);

    const pearlGeometry = new THREE.SphereGeometry(0.46, 48, 32);
    const pearlMaterial = createPearlMaterial(uTime, uPulse);
    const pearl = new THREE.Mesh(pearlGeometry, pearlMaterial);
    pearl.position.y = 0.55;
    scene.add(pearl);

    const bubbleGeometry = new THREE.SphereGeometry(0.11, 12, 8);
    const bubbleMaterial = new THREE.MeshPhysicalNodeMaterial({
        color: 0x8cecff,
        transparent: true,
        opacity: 0.34,
        roughness: 0.08,
        metalness: 0,
        transmission: 0.18,
        thickness: 0.08,
        depthWrite: false,
    });
    const bubbles = new THREE.InstancedMesh(bubbleGeometry, bubbleMaterial, BUBBLE_COUNT);
    bubbles.frustumCulled = false;
    scene.add(bubbles);

    const ambient = new THREE.HemisphereLight(0x77d7e8, 0x03131f, 0.72);
    const key = new THREE.DirectionalLight(0xffddb0, 1.15);
    key.position.set(-4, 10, 5);
    const fill = new THREE.PointLight(0x12cfe0, 3.2, 18, 2);
    fill.position.set(0, 2.3, 0);
    scene.add(ambient, key, fill);

    const scenePass = pass(scene, camera);
    const sceneColor = scenePass.getTextureNode('output');
    const bloomNode = bloom(sceneColor, 0.14, 0.36, 0.72);
    const post = new THREE.PostProcessing(renderer);
    post.outputColorTransform = false;
    const graded = toneMapping(
        THREE.ACESFilmicToneMapping,
        0.68,
        sceneColor.add(bloomNode),
    ).mul(color(0.94, 1.0, 1.04));
    post.outputNode = renderOutput(graded, THREE.NoToneMapping);

    const dummy = new THREE.Object3D();
    const bubbleSeeds = Array.from({ length: BUBBLE_COUNT }, (_, i) => ({
        angle: i * 2.399963229728653,
        radius: 0.4 + ((i * 37) % 17) * 0.16,
        lift: ((i * 13) % 19) / 19,
        size: 0.5 + ((i * 11) % 9) / 11,
    }));

    const update = (time) => {
        uTime.value = time;
        const beat = (time % 3.2) / 3.2;
        const attack = Math.min(1, beat / 0.12);
        const release = Math.max(0, 1 - Math.max(0, beat - 0.18) / 0.82);
        const pulse = attack * release;
        uPulse.value = 0.28 + pulse * 0.92;
        pearl.scale.setScalar(0.86 + pulse * 0.34);
        pearl.position.y = 0.5 + Math.sin(time * 2.1) * 0.08;

        for (let i = 0; i < CROWN_COUNT; i += 1) {
            const phase = (beat + i * 0.16) % 1;
            const scale = 1.25 + phase * (6.2 + i * 0.52);
            dummy.position.set(0, 0.03 + i * 0.035, 0);
            dummy.rotation.set(0, i * 0.19 + time * (i % 2 ? -0.08 : 0.06), 0);
            dummy.scale.setScalar(scale);
            dummy.updateMatrix();
            crowns.setMatrixAt(i, dummy.matrix);
        }
        crowns.instanceMatrix.needsUpdate = true;

        bubbleSeeds.forEach((seed, i) => {
            const rise = (seed.lift + time * (0.11 + (i % 5) * 0.009)) % 1;
            const spiral = seed.angle + time * (0.38 + (i % 3) * 0.05) + rise * 1.7;
            const radius = seed.radius * (0.46 + rise * 0.54);
            dummy.position.set(
                Math.cos(spiral) * radius,
                0.22 + rise * 5.8,
                Math.sin(spiral) * radius,
            );
            dummy.rotation.set(0, spiral, 0);
            const bubbleScale = seed.size * (0.42 + rise * 0.76);
            dummy.scale.setScalar(bubbleScale);
            dummy.updateMatrix();
            bubbles.setMatrixAt(i, dummy.matrix);
        });
        bubbles.instanceMatrix.needsUpdate = true;
    };

    return {
        cameraRadius: 15,
        camera(_time, cam) {
            cam.position.set(8.4, 6.8, 11.8);
            cam.lookAt(0, 0.1, 0);
        },
        update,
        render: () => post.render(),
        renderAsync: async () => post.render(),
        dispose() {
            scene.remove(sand, crowns, pearl, bubbles, ambient, key, fill);
            sandGeometry.dispose();
            sandMaterial.dispose();
            crownGeometry.dispose();
            crownMaterial.dispose();
            pearlGeometry.dispose();
            pearlMaterial.dispose();
            bubbleGeometry.dispose();
            bubbleMaterial.dispose();
            disposeBloomNodeDeep(bloomNode);
            scenePass.dispose?.();
            post.dispose?.();
            scene.fog = null;
        },
    };
}

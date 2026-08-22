/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
import * as THREE from 'three/webgpu';
import {
    abs,
    attribute,
    color,
    float,
    length,
    mix,
    pass,
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
    id: 'ocean-surface-cathedral',
    title: 'Ocean Surface Cathedral',
    description: 'A brilliant water-ceiling aperture feeding one merged bundle of long god rays.',
};

const SHAFT_LAYOUT = [
    {
        x: -12.5, z: -16, topWidth: 2.0, bottomWidth: 7.8, tilt: 7.5, seed: 2.3,
    },
    {
        x: -6.5, z: -14, topWidth: 2.7, bottomWidth: 9.6, tilt: 3.0, seed: 7.1,
    },
    {
        x: -0.8, z: -17, topWidth: 2.2, bottomWidth: 8.4, tilt: -1.4, seed: 11.7,
    },
    {
        x: 5.8, z: -20, topWidth: 2.5, bottomWidth: 9.0, tilt: -5.5, seed: 17.3,
    },
    {
        x: 11.8, z: -23, topWidth: 1.8, bottomWidth: 7.0, tilt: -8.2, seed: 23.9,
    },
];

function createApertureMaterial(uTime) {
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });

    const centered = uv().sub(0.5);
    const radius = length(centered).mul(2.0);
    const rippleA = abs(sin(radius.mul(38.0).sub(uTime.mul(0.72))));
    const rippleB = abs(sin(centered.x.mul(31.0).add(centered.y.mul(19.0)).add(uTime.mul(0.46))));
    const brokenWater = pow(rippleA.mul(0.68).add(rippleB.mul(0.32)), float(7.0));
    const core = float(1.0).sub(smoothstep(float(0.0), float(0.46), radius));
    const body = float(1.0).sub(smoothstep(float(0.18), float(0.96), radius));
    const rim = smoothstep(float(0.38), float(0.72), radius).mul(
        float(1.0).sub(smoothstep(float(0.74), float(1.0), radius)),
    );
    const energy = body.mul(0.72)
        .add(core.mul(1.85))
        .add(rim.mul(brokenWater).mul(0.62));
    const apertureColor = mix(
        vec3(0.22, 0.92, 1.0),
        vec3(1.0, 0.94, 0.72),
        core.mul(0.82).add(brokenWater.mul(0.12)),
    ).mul(energy);

    material.colorNode = apertureColor;
    material.opacityNode = energy.mul(0.88);
    material.emissiveNode = apertureColor.mul(1.45);
    return material;
}

function createShaftGeometry() {
    const positions = [];
    const uvs = [];
    const seeds = [];

    SHAFT_LAYOUT.forEach((shaft) => {
        const topY = 28;
        const bottomY = -9;
        const bottomX = shaft.x + shaft.tilt;
        const vertices = [
            [shaft.x - shaft.topWidth, topY, shaft.z, 0, 1],
            [shaft.x + shaft.topWidth, topY, shaft.z, 1, 1],
            [bottomX + shaft.bottomWidth, bottomY, shaft.z + 5, 1, 0],
            [shaft.x - shaft.topWidth, topY, shaft.z, 0, 1],
            [bottomX + shaft.bottomWidth, bottomY, shaft.z + 5, 1, 0],
            [bottomX - shaft.bottomWidth, bottomY, shaft.z + 5, 0, 0],
        ];
        vertices.forEach(([x, y, z, u, v]) => {
            positions.push(x, y, z);
            uvs.push(u, v);
            seeds.push(shaft.seed);
        });
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
    geometry.computeVertexNormals();
    return geometry;
}

function createShaftMaterial(uTime) {
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });

    const localUv = uv();
    const seed = attribute('aSeed');
    const sideFade = smoothstep(float(0.0), float(0.2), localUv.x).mul(
        float(1.0).sub(smoothstep(float(0.8), float(1.0), localUv.x)),
    );
    const floorFade = smoothstep(float(0.0), float(0.16), localUv.y);
    const topWeight = mix(float(0.36), float(1.0), pow(localUv.y, float(0.58)));
    const longBand = sin(localUv.y.mul(24.0).add(seed).sub(uTime.mul(0.46))).mul(0.5).add(0.5);
    const fineBand = sin(localUv.x.mul(37.0).sub(seed.mul(1.7)).add(uTime.mul(0.31))).mul(0.5).add(0.5);
    const breakup = float(0.68).add(longBand.mul(0.2)).add(fineBand.mul(0.12));
    const ray = sideFade.mul(floorFade).mul(topWeight).mul(breakup);
    const warmth = pow(localUv.y, float(3.2)).mul(0.52);
    const shaftColor = mix(vec3(0.18, 0.78, 0.96), vec3(1.0, 0.86, 0.58), warmth);

    material.colorNode = shaftColor.mul(ray.mul(0.72));
    material.opacityNode = ray.mul(0.38);
    material.emissiveNode = shaftColor.mul(ray.mul(0.74));
    return material;
}

function createMonument(material, x, y, z, height, width, lean = 0) {
    const group = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.62, width, height, 7, 1), material);
    trunk.position.y = height * 0.5;
    trunk.rotation.z = lean;
    const cap = new THREE.Mesh(new THREE.IcosahedronGeometry(width * 1.35, 1), material);
    cap.scale.set(1.35, 0.42, 1.0);
    cap.position.set(-lean * height * 0.58, height * 0.96, 0);
    cap.rotation.set(0.12, 0.3, -lean * 0.5);
    group.add(trunk, cap);
    group.position.set(x, y, z);
    return group;
}

export function create({ scene, camera, renderer }) {
    scene.background = new THREE.Color(0x075477);
    scene.fog = new THREE.FogExp2(0x07506d, 0.012);

    camera.near = 0.1;
    camera.far = 180;
    camera.position.set(0, 4.8, 46);
    camera.lookAt(0, 10, -24);
    camera.updateProjectionMatrix();

    const uTime = uniform(0);

    const apertureGeometry = new THREE.CircleGeometry(15.5, 96);
    apertureGeometry.rotateX(Math.PI / 2);
    const apertureMaterial = createApertureMaterial(uTime);
    const aperture = new THREE.Mesh(apertureGeometry, apertureMaterial);
    aperture.position.set(-2.5, 29.4, -18);
    aperture.scale.set(1.42, 0.82, 1);
    aperture.renderOrder = -20;
    scene.add(aperture);

    const shaftGeometry = createShaftGeometry();
    const shaftMaterial = createShaftMaterial(uTime);
    const shafts = new THREE.Mesh(shaftGeometry, shaftMaterial);
    shafts.renderOrder = -12;
    scene.add(shafts);

    const floorGeometry = new THREE.PlaneGeometry(140, 130, 1, 1);
    floorGeometry.rotateX(-Math.PI / 2);
    const floorMaterial = new THREE.MeshStandardNodeMaterial({
        color: 0x2c7675,
        roughness: 0.96,
        metalness: 0,
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.position.set(0, -9.4, -22);
    scene.add(floor);

    const monumentMaterial = new THREE.MeshStandardNodeMaterial({
        color: 0x07343e,
        roughness: 0.94,
        metalness: 0,
    });
    const leftMonument = createMonument(monumentMaterial, -23, -9.2, -30, 24, 5.2, -0.08);
    const rightMonument = createMonument(monumentMaterial, 19, -9.2, -44, 34, 6.2, 0.035);
    scene.add(leftMonument, rightMonument);

    const coralMaterial = new THREE.MeshStandardNodeMaterial({
        color: 0xf07f87,
        emissive: 0x2e080e,
        emissiveIntensity: 0.24,
        roughness: 0.82,
    });
    const coralGeometry = new THREE.IcosahedronGeometry(1, 1);
    const corals = new THREE.InstancedMesh(coralGeometry, coralMaterial, 42);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 42; i += 1) {
        const side = i % 2 === 0 ? -1 : 1;
        const lane = (i * 17) % 21;
        dummy.position.set(side * (14 + lane * 0.72), -8.1 + ((i * 7) % 5) * 0.2, -18 - ((i * 13) % 34));
        dummy.rotation.set(i * 0.13, i * 1.91, i * 0.07);
        const scale = 0.65 + ((i * 11) % 9) * 0.16;
        dummy.scale.set(scale * 1.6, scale * 0.72, scale * 1.25);
        dummy.updateMatrix();
        corals.setMatrixAt(i, dummy.matrix);
    }
    corals.instanceMatrix.needsUpdate = true;
    scene.add(corals);

    const hemi = new THREE.HemisphereLight(0xbff8ff, 0x02151e, 1.55);
    const key = new THREE.DirectionalLight(0xfff3d0, 3.2);
    key.position.set(-4, 34, 4);
    scene.add(hemi, key);

    const scenePass = pass(scene, camera);
    const sceneColor = scenePass.getTextureNode('output');
    const bloomNode = bloom(sceneColor, 0.18, 0.42, 0.78);
    const post = new THREE.RenderPipeline(renderer);
    post.outputColorTransform = false;
    const graded = toneMapping(
        THREE.ACESFilmicToneMapping,
        0.82,
        sceneColor.add(bloomNode),
    ).mul(color(0.96, 1.01, 1.04));
    post.outputNode = renderOutput(graded, THREE.NoToneMapping);

    return {
        cameraRadius: 52,
        camera(_time, cam) {
            cam.position.set(0, 4.8, 46);
            cam.lookAt(0, 10, -24);
        },
        update(time) {
            uTime.value = time;
        },
        render: () => post.render(),
        renderAsync: async () => post.render(),
        dispose() {
            scene.remove(aperture, shafts, floor, leftMonument, rightMonument, corals, hemi, key);
            apertureGeometry.dispose();
            apertureMaterial.dispose();
            shaftGeometry.dispose();
            shaftMaterial.dispose();
            floorGeometry.dispose();
            floorMaterial.dispose();
            monumentMaterial.dispose();
            leftMonument.traverse((child) => child.geometry?.dispose?.());
            rightMonument.traverse((child) => child.geometry?.dispose?.());
            coralGeometry.dispose();
            coralMaterial.dispose();
            disposeBloomNodeDeep(bloomNode);
            scenePass.dispose?.();
            post.dispose?.();
            scene.fog = null;
        },
    };
}

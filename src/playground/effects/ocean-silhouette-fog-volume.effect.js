/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
import * as THREE from 'three/webgpu';
import {
    cameraPosition,
    clamp,
    color,
    float,
    fog,
    length,
    mix,
    normalWorld,
    pass,
    positionWorld,
    renderOutput,
    smoothstep,
    toneMapping,
    vec3,
    vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../../themes/shared/bloom-dispose.js';
import { tslAbzuGrade } from '../../themes/ocean/ocean-tsl-helpers.js';

export const meta = {
    id: 'ocean-silhouette-fog-volume',
    title: 'Ocean Silhouette Fog Volume',
    description: 'Analytic underwater fog zones with a clear pocket, silhouette hold, and cool far dissolve.',
};

function ellipsoidMask(center, radii, featherStart = 0.58) {
    const normalized = positionWorld.sub(center).div(radii);
    return float(1.0).sub(smoothstep(float(featherStart), float(1.0), length(normalized)));
}

function warmNearCoolFar(baseColor) {
    const viewDistance = length(cameraPosition.sub(positionWorld));
    const farWeight = smoothstep(float(56.0), float(184.0), viewDistance);
    const redAbsorption = mix(vec3(1.0), vec3(0.66, 0.86, 1.0), farWeight.mul(0.68));
    return baseColor.mul(redAbsorption);
}

function createRockMaterial(base, high) {
    const material = new THREE.MeshStandardNodeMaterial({
        roughness: 0.88,
        metalness: 0,
    });
    const up = normalWorld.y.mul(0.5).add(0.5);
    material.colorNode = warmNearCoolFar(mix(vec3(...base), vec3(...high), up));
    return material;
}

function createCoralMaterial(base, tips) {
    const material = new THREE.MeshStandardNodeMaterial({
        roughness: 0.76,
        metalness: 0,
    });
    const height = smoothstep(float(-8.0), float(4.0), positionWorld.y);
    const coralColor = mix(vec3(...base), vec3(...tips), height);
    material.colorNode = warmNearCoolFar(coralColor);
    material.emissiveNode = vec3(...tips).mul(height.mul(0.045));
    return material;
}

function addMonument(scene, material, x, z, height, radius, lean = 0) {
    const group = new THREE.Group();
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.68, radius, height, 7, 4),
        material,
    );
    trunk.position.y = height * 0.5;
    trunk.rotation.z = lean;
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(radius * 1.45, 1), material);
    crown.position.set(-lean * height * 0.5, height * 0.96, 0);
    crown.scale.set(1.55, 0.42, 1.05);
    crown.rotation.set(0.08, 0.32, -lean * 0.55);
    group.add(trunk, crown);
    group.position.set(x, -8.8, z);
    scene.add(group);
    return group;
}

function addChunkyCoralFamily(scene, material, x, z, scale = 1, branches = 7) {
    const group = new THREE.Group();
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 1), material);
    core.scale.set(1.35, 0.72, 1.15);
    core.position.y = 0.65;
    group.add(core);

    for (let i = 0; i < branches; i += 1) {
        const angle = (i / branches) * Math.PI * 2 + (i % 2) * 0.24;
        const height = 2.2 + (i % 3) * 0.75;
        const radius = 0.42 + (i % 2) * 0.12;
        const branch = new THREE.Mesh(
            new THREE.CylinderGeometry(radius * 0.58, radius, height, 7, 2),
            material,
        );
        branch.position.set(Math.cos(angle) * 1.0, 1.3 + height * 0.42, Math.sin(angle) * 0.82);
        branch.rotation.set(Math.sin(angle) * 0.24, angle, -Math.cos(angle) * 0.24);
        group.add(branch);

        const tip = new THREE.Mesh(new THREE.IcosahedronGeometry(radius * 1.18, 1), material);
        tip.position.set(
            Math.cos(angle) * 1.25,
            1.35 + height * 0.88,
            Math.sin(angle) * 1.02,
        );
        tip.scale.set(1.15, 0.72, 1.0);
        group.add(tip);
    }

    group.position.set(x, -8.6, z);
    group.scale.setScalar(scale);
    scene.add(group);
    return group;
}

export function create({ scene, camera, renderer }) {
    scene.background = new THREE.Color(0x075a76);

    camera.near = 0.1;
    camera.far = 240;
    camera.position.set(0, 7.5, 58);
    camera.lookAt(0, 8, -38);
    camera.updateProjectionMatrix();

    const viewDistance = length(cameraPosition.sub(positionWorld));
    const silhouetteHold = smoothstep(float(34.0), float(66.0), viewDistance).mul(0.105);
    const farDissolve = smoothstep(float(112.0), float(202.0), viewDistance).mul(0.72);
    const lowWater = float(1.0).sub(smoothstep(float(-10.0), float(34.0), positionWorld.y));

    const canyonVolume = ellipsoidMask(vec3(0, 5, -94), vec3(72, 34, 66), 0.46);
    const leftReefVolume = ellipsoidMask(vec3(-42, 0, -28), vec3(28, 20, 34), 0.52);
    const rightReefVolume = ellipsoidMask(vec3(46, 3, -48), vec3(34, 24, 42), 0.52);
    const localDensity = canyonVolume.mul(0.13)
        .add(leftReefVolume.mul(0.065))
        .add(rightReefVolume.mul(0.085));
    const fogFactor = clamp(
        silhouetteHold.add(farDissolve).add(localDensity.mul(lowWater.mul(0.72).add(0.28))),
        float(0.0),
        float(0.84),
    );
    const depthColor = mix(
        vec3(0.025, 0.34, 0.50),
        vec3(0.009, 0.14, 0.28),
        clamp(farDissolve.add(canyonVolume.mul(0.34)).add(lowWater.mul(0.16)), 0, 1),
    );
    scene.fogNode = fog(depthColor, fogFactor);

    const floorMaterial = createRockMaterial([0.22, 0.10, 0.075], [0.82, 0.50, 0.28]);
    const floorGeometry = new THREE.PlaneGeometry(220, 210, 1, 1);
    floorGeometry.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.position.set(0, -9, -48);
    scene.add(floor);

    const rockMaterial = createRockMaterial([0.008, 0.045, 0.08], [0.08, 0.21, 0.24]);
    const monuments = [
        addMonument(scene, rockMaterial, -28, 4, 24, 5.2, -0.07),
        addMonument(scene, rockMaterial, 24, -50, 34, 6.4, 0.035),
        addMonument(scene, rockMaterial, -8, -132, 47, 7.4, -0.025),
    ];

    const warmCoral = createCoralMaterial([0.58, 0.22, 0.18], [0.96, 0.58, 0.42]);
    const pinkCoral = createCoralMaterial([0.48, 0.18, 0.32], [0.92, 0.55, 0.67]);
    const corals = [
        addChunkyCoralFamily(scene, warmCoral, -22, -8, 1.65, 8),
        addChunkyCoralFamily(scene, pinkCoral, 25, -18, 1.85, 9),
        addChunkyCoralFamily(scene, pinkCoral, -38, -64, 1.35, 7),
        addChunkyCoralFamily(scene, warmCoral, 38, -78, 1.45, 8),
    ];

    const hemi = new THREE.HemisphereLight(0xc1f1f4, 0x49343a, 0.72);
    const sun = new THREE.DirectionalLight(0xffe5c2, 1.95);
    sun.position.set(-18, 52, 22);
    const warmFill = new THREE.PointLight(0xffbf9b, 1.6, 50, 2.0);
    warmFill.position.set(-20, 2, -2);
    scene.add(hemi, sun, warmFill);

    const scenePass = pass(scene, camera);
    const sceneColor = scenePass.getTextureNode('output');
    const bloomNode = bloom(sceneColor, 0.085, 0.36, 0.88);
    const post = new THREE.PostProcessing(renderer);
    post.outputColorTransform = false;
    const toneMapped = toneMapping(
        THREE.ACESFilmicToneMapping,
        0.86,
        sceneColor.add(bloomNode),
    ).rgb.mul(color(0.985, 1.005, 1.015));
    const graded = tslAbzuGrade(toneMapped, float(0.66), float(0.04));
    post.outputNode = renderOutput(vec4(graded, float(1.0)), THREE.NoToneMapping);

    return {
        cameraRadius: 64,
        camera(_time, cam) {
            cam.position.set(0, 7.5, 58);
            cam.lookAt(0, 8, -38);
        },
        render: () => post.render(),
        renderAsync: async () => post.render(),
        dispose() {
            scene.remove(floor, ...monuments, ...corals, hemi, sun, warmFill);
            floorGeometry.dispose();
            floorMaterial.dispose();
            rockMaterial.dispose();
            warmCoral.dispose();
            pinkCoral.dispose();
            monuments.forEach((root) => root.traverse((child) => child.geometry?.dispose?.()));
            corals.forEach((root) => root.traverse((child) => child.geometry?.dispose?.()));
            disposeBloomNodeDeep(bloomNode);
            scenePass.dispose?.();
            post.dispose?.();
            scene.fogNode = null;
        },
    };
}

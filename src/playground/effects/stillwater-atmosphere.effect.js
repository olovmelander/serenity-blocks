/**
 * Stillwater Wave 6 atmosphere pilot.
 *
 * Query contract:
 *   ?effect=stillwater-atmosphere&quality=High&soft=on&t=8
 *   ?effect=stillwater-atmosphere&quality=Low&soft=off&t=8
 */

import * as THREE from 'three/webgpu';
import {
    mix,
    positionWorld,
    smoothstep,
    vec3,
} from 'three/tsl';
import { getStillwaterQualityProfile } from '../../themes/stillwater/stillwater-quality.js';
import { createStillwaterAtmosphere } from '../../themes/stillwater/rendering/stillwater-atmosphere.js';

export const meta = {
    id: 'stillwater-atmosphere',
    title: 'Stillwater · Height Fog & Soft Motes',
    description: 'Analytic colored depth, bounded low mist, and one true depth-faded mote field.',
};

function readToggle(params, key, fallback = true) {
    if (!params?.has?.(key)) return fallback;
    return !['0', 'off', 'false', 'no'].includes(
        String(params.get(key)).toLowerCase(),
    );
}
function rendererCounters(renderer) {
    const render = renderer.info?.render || {};
    return {
        calls: render.drawCalls ?? render.calls ?? 0,
        triangles: render.triangles ?? 0,
        geometries: renderer.info?.memory?.geometries ?? 0,
        textures: renderer.info?.memory?.textures ?? 0,
        programs: renderer.info?.programs ? renderer.info.programs.length : null,
    };
}

export function create({
    scene,
    camera,
    renderer,
    params,
}) {
    const requestedQuality = params?.get?.('quality') || 'High';
    const qualityProfile = getStillwaterQualityProfile(requestedQuality);
    const softParticles = readToggle(params, 'soft', true);
    const mistEnabled = readToggle(params, 'mist', true);
    const reducedMotion = readToggle(params, 'motion', true) === false;
    const previous = {
        background: scene.background,
        fog: scene.fog,
        fogNode: scene.fogNode,
        fov: camera.fov,
        near: camera.near,
        far: camera.far,
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
    };
    const root = new THREE.Group();
    root.name = 'stillwater-atmosphere-pilot';
    const geometries = new Set();
    const materials = new Set();
    const ownGeometry = (geometry) => {
        geometries.add(geometry);
        return geometry;
    };
    const ownMaterial = (material) => {
        materials.add(material);
        return material;
    };

    scene.background = new THREE.Color(0x071713);
    scene.fog = null;

    const groundMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    groundMaterial.colorNode = vec3(0.055, 0.13, 0.105);
    const ground = new THREE.Mesh(
        ownGeometry(new THREE.PlaneGeometry(90, 105, 1, 1)),
        groundMaterial,
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.4, -19);
    root.add(ground);

    const waterMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial({
        transparent: true,
        opacity: 0.88,
    }));
    waterMaterial.colorNode = vec3(0.035, 0.13, 0.13);
    const water = new THREE.Mesh(
        ownGeometry(new THREE.PlaneGeometry(34, 31, 1, 1)),
        waterMaterial,
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -0.31, 3.8);
    root.add(water);

    const treeMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    const nearDepth = smoothstep(-62, 12, positionWorld.z);
    treeMaterial.colorNode = mix(
        vec3(0.23, 0.33, 0.29),
        vec3(0.025, 0.075, 0.06),
        nearDepth,
    );
    const trunkGeometry = ownGeometry(new THREE.CylinderGeometry(0.72, 1.5, 18, 7, 1));
    const treeCount = 22;
    const trees = new THREE.InstancedMesh(trunkGeometry, treeMaterial, treeCount);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const euler = new THREE.Euler();
    for (let index = 0; index < treeCount; index += 1) {
        const side = index % 2 === 0 ? -1 : 1;
        const lane = Math.floor(index / 2);
        const z = 10 - lane * 6.5;
        const x = side * (10.5 + (lane % 3) * 3.5);
        position.set(x, 8.2 + (lane % 2), z);
        quaternion.setFromEuler(euler.set(0, side * 0.08 + lane * 0.025, side * 0.025));
        scale.set(0.82 + (lane % 4) * 0.12, 1 + (lane % 3) * 0.08, 0.9);
        matrix.compose(position, quaternion, scale);
        trees.setMatrixAt(index, matrix);
    }
    trees.instanceMatrix.needsUpdate = true;
    trees.computeBoundingSphere();
    root.add(trees);

    const bankMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    bankMaterial.colorNode = mix(
        vec3(0.18, 0.29, 0.22),
        vec3(0.04, 0.11, 0.075),
        nearDepth,
    );
    const bankGeometry = ownGeometry(new THREE.IcosahedronGeometry(1, 2));
    const banks = new THREE.InstancedMesh(bankGeometry, bankMaterial, 8);
    const bankLayout = [
        [-15, 0.1, 7, 8, 1.8, 6],
        [15, 0.2, 5, 9, 2.2, 7],
        [-18, 1, -7, 11, 3.4, 8],
        [18, 1.2, -10, 12, 3.8, 9],
        [-21, 2.4, -25, 14, 5.2, 10],
        [20, 2.6, -30, 15, 5.5, 11],
        [-25, 4.5, -48, 18, 7.5, 13],
        [23, 4.8, -55, 19, 8, 14],
    ];
    bankLayout.forEach(([x, y, z, sx, sy, sz], index) => {
        position.set(x, y, z);
        quaternion.setFromEuler(euler.set(0, index * 0.31, 0));
        scale.set(sx, sy, sz);
        matrix.compose(position, quaternion, scale);
        banks.setMatrixAt(index, matrix);
    });
    banks.instanceMatrix.needsUpdate = true;
    banks.computeBoundingSphere();
    root.add(banks);

    // Near opaque stones deliberately intersect the mote volume. With `soft=off`
    // points cut against them; the default true depth fade feathers the contact.
    const stoneMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    stoneMaterial.colorNode = vec3(0.12, 0.19, 0.16);
    const stones = new THREE.InstancedMesh(
        ownGeometry(new THREE.DodecahedronGeometry(1, 1)),
        stoneMaterial,
        7,
    );
    for (let index = 0; index < 7; index += 1) {
        const side = index % 2 === 0 ? -1 : 1;
        position.set(side * (7 + index * 1.7), 0.3, 3 - index * 3.2);
        quaternion.setFromEuler(euler.set(index * 0.17, index * 0.41, index * 0.08));
        scale.set(1.2 + index * 0.16, 0.7 + index * 0.08, 1.4 + index * 0.12);
        matrix.compose(position, quaternion, scale);
        stones.setMatrixAt(index, matrix);
    }
    stones.instanceMatrix.needsUpdate = true;
    stones.computeBoundingSphere();
    root.add(stones);

    scene.add(root);

    const atmosphere = createStillwaterAtmosphere({
        scene,
        qualityProfile,
        seed: 61937,
        softParticles,
        mistEnabled,
        reducedMotion,
    });

    const diagnostics = {
        id: meta.id,
        wave: 6,
        backend: renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2',
        quality: qualityProfile.name,
        softParticles,
        mistEnabled,
        atmosphere: atmosphere.getDiagnostics(),
        negativeIntersectionControls: 7,
    };
    const debugApi = Object.freeze({
        getDiagnostics: () => diagnostics,
        getRendererCounters: () => rendererCounters(renderer),
        getResourceState: () => ({
            ...rendererCounters(renderer),
            atmosphere: atmosphere.getResourceState(),
            pilotGeometries: geometries.size,
            pilotMaterials: materials.size,
            rootObjects: root.children.length,
        }),
    });
    window.__STILLWATER_ATMOSPHERE__ = debugApi;

    return {
        ...debugApi,
        camera(_time, activeCamera) {
            activeCamera.position.set(0, 9.8, 31);
            activeCamera.lookAt(0, 4.4, -18);
            activeCamera.fov = 48;
            activeCamera.near = 0.1;
            activeCamera.far = 220;
            activeCamera.updateProjectionMatrix();
        },
        update(time) {
            atmosphere.update(time);
        },
        dispose() {
            if (window.__STILLWATER_ATMOSPHERE__ === debugApi) {
                delete window.__STILLWATER_ATMOSPHERE__;
            }
            atmosphere.dispose();
            scene.remove(root);
            geometries.forEach((geometry) => geometry.dispose());
            materials.forEach((material) => material.dispose());
            scene.background = previous.background;
            scene.fog = previous.fog;
            scene.fogNode = previous.fogNode;
            camera.fov = previous.fov;
            camera.near = previous.near;
            camera.far = previous.far;
            camera.position.copy(previous.position);
            camera.quaternion.copy(previous.quaternion);
            camera.updateProjectionMatrix();
        },
    };
}

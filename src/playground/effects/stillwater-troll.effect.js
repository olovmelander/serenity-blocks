/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
import * as THREE from 'three/webgpu';
import {
    float,
    mix,
    normalWorld,
    positionWorld,
    vec3,
} from 'three/tsl';

import { getStillwaterQualityProfile } from '../../themes/stillwater/stillwater-quality.js';
import { createStillwaterCharacters } from '../../themes/stillwater/rendering/stillwater-characters.js';

export const meta = {
    id: 'stillwater-troll',
    title: 'Stillwater Wave 5 — The Root Troll',
    description: 'Quantized real-asset LOD, grounded contact, moon rim, warm bounce, and a peripheral reveal path.',
};

function readQuality(params) {
    return getStillwaterQualityProfile(params?.get?.('quality') || 'High');
}

function readTrollCue(params) {
    const cue = String(params?.get?.('event') || 'lineClear').toLowerCase();
    if (cue === 'perfectclear' || cue === 'perfect-clear') return 'perfectClear';
    if (cue === 'combo10' || cue === 'delight') return 'combo10';
    if (cue === 'combo' || cue === 'combohigh' || cue === 'wary') return 'comboHigh';
    if (cue === 'harddrop' || cue === 'hard-drop') return 'hardDrop';
    if (cue === 'lock') return 'lock';
    return 'lineClear';
}

export function create({ scene, camera, params }) {
    const profile = readQuality(params);
    const trollCue = readTrollCue(params);
    const rawFxAge = params?.get?.('fxAge');
    const requestedFxAge = rawFxAge == null ? Number.NaN : Number(rawFxAge);
    const fxAge = THREE.MathUtils.clamp(
        Number.isFinite(requestedFxAge) ? requestedFxAge : 0.6,
        0,
        2.6,
    );
    const root = new THREE.Group();
    root.name = 'stillwater-troll-pilot';
    scene.add(root);

    const previous = {
        background: scene.background,
        fog: scene.fog,
        fov: camera.fov,
        near: camera.near,
        far: camera.far,
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
    };
    scene.background = new THREE.Color(0x020907);
    scene.fog = new THREE.FogExp2(0x0b211d, 0.016);

    const geometries = new Set();
    const materials = new Set();
    const ownGeometry = (geometry) => { geometries.add(geometry); return geometry; };
    const ownMaterial = (material) => { materials.add(material); return material; };

    const groundMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    const lift = normalWorld.y.mul(0.5).add(0.5);
    const groundVariation = positionWorld.x.mul(0.16).sin().mul(0.5).add(0.5);
    groundMaterial.colorNode = mix(
        vec3(0.008, 0.027, 0.016),
        vec3(0.047, 0.092, 0.045),
        lift.mul(0.62).add(groundVariation.mul(0.18)),
    );
    groundMaterial.roughnessNode = float(0.98);
    const ground = new THREE.Mesh(
        ownGeometry(new THREE.CircleGeometry(24, 64)),
        groundMaterial,
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(18, -0.04, -19);
    root.add(ground);

    const rootMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    rootMaterial.colorNode = mix(
        vec3(0.018, 0.035, 0.020),
        vec3(0.095, 0.115, 0.060),
        normalWorld.y.mul(0.5).add(0.5),
    );
    rootMaterial.roughnessNode = float(0.96);
    const rootTrunk = new THREE.Mesh(
        ownGeometry(new THREE.CylinderGeometry(1.2, 2.3, 13, 10, 4)),
        rootMaterial,
    );
    rootTrunk.position.set(23.8, 5.3, -21.2);
    rootTrunk.rotation.z = -0.16;
    root.add(rootTrunk);

    const buttressGeometry = ownGeometry(new THREE.ConeGeometry(1.4, 7.8, 8));
    const buttresses = new THREE.InstancedMesh(buttressGeometry, rootMaterial, 3);
    const transform = new THREE.Object3D();
    [
        [21.9, 0.8, -20.5, 0.8],
        [24.5, 0.7, -19.5, -0.45],
        [25.2, 0.65, -23.1, 0.2],
    ].forEach(([x, y, z, yaw], index) => {
        transform.position.set(x, y, z);
        transform.rotation.set(Math.PI / 2, yaw, 0.28);
        transform.scale.set(1, 1, 0.62);
        transform.updateMatrix();
        buttresses.setMatrixAt(index, transform.matrix);
    });
    buttresses.instanceMatrix.needsUpdate = true;
    root.add(buttresses);

    const hemisphere = new THREE.HemisphereLight(0x9ccfd0, 0x071713, 1.15);
    const moon = new THREE.DirectionalLight(0xbfe4df, 1.4);
    moon.position.set(-12, 28, 18);
    root.add(hemisphere, moon);

    const characters = createStillwaterCharacters({
        root,
        profile,
        reflectionLayer: 2,
        mode: 'troll',
    });
    characters.pulse(trollCue, 0.92);
    const primeFrames = Math.ceil(fxAge * 60);
    for (let index = 0; index < primeFrames; index += 1) {
        characters.update(index / 60, 1 / 60);
    }

    const debugApi = Object.freeze({
        getDiagnostics: characters.getDiagnostics,
        getResourceState: characters.getResourceState,
        isTargetReady: () => characters.getDiagnostics().targetReady,
        ready: characters.ready,
        pulse: characters.pulse,
        cue: trollCue,
    });
    window.__STILLWATER_TROLL__ = debugApi;

    return {
        ...debugApi,
        camera(_time, activeCamera) {
            activeCamera.position.set(6.2, 6.5, 5.8);
            activeCamera.lookAt(18.8, 3.2, -19.3);
            activeCamera.fov = 39;
            activeCamera.near = 0.1;
            activeCamera.far = 180;
            activeCamera.updateProjectionMatrix();
        },
        update(time, delta) {
            characters.update(time, delta);
        },
        dispose() {
            if (window.__STILLWATER_TROLL__ === debugApi) delete window.__STILLWATER_TROLL__;
            characters.dispose();
            scene.remove(root);
            geometries.forEach((geometry) => geometry.dispose());
            materials.forEach((material) => material.dispose());
            scene.background = previous.background;
            scene.fog = previous.fog;
            camera.fov = previous.fov;
            camera.near = previous.near;
            camera.far = previous.far;
            camera.position.copy(previous.position);
            camera.quaternion.copy(previous.quaternion);
            camera.updateProjectionMatrix();
        },
    };
}

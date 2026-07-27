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
    id: 'stillwater-spirit',
    title: 'Stillwater Wave 5 — The Watching Spirit',
    description: 'Layered ivory core, translucent body, quiet aura, and a three-strand flowing veil.',
};

function readQuality(params) {
    return getStillwaterQualityProfile(params?.get?.('quality') || 'High');
}

export function create({ scene, camera, params }) {
    const profile = readQuality(params);
    const root = new THREE.Group();
    root.name = 'stillwater-spirit-pilot';
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
    scene.background = new THREE.Color(0x020a08);
    scene.fog = new THREE.FogExp2(0x0b2520, 0.018);

    const geometries = new Set();
    const materials = new Set();
    const ownGeometry = (geometry) => { geometries.add(geometry); return geometry; };
    const ownMaterial = (material) => { materials.add(material); return material; };

    const groundMaterial = ownMaterial(new THREE.MeshStandardNodeMaterial());
    groundMaterial.colorNode = mix(
        vec3(0.012, 0.035, 0.023),
        vec3(0.055, 0.105, 0.068),
        normalWorld.y.mul(0.5).add(0.5),
    );
    groundMaterial.roughnessNode = float(0.96);
    const ground = new THREE.Mesh(
        ownGeometry(new THREE.CircleGeometry(22, 64)),
        groundMaterial,
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(-17, -0.05, -18);
    root.add(ground);

    const bankMaterial = ownMaterial(new THREE.MeshBasicNodeMaterial());
    const distanceBand = positionWorld.xz.sub(vec3(-17, 0, -18).xz).length();
    bankMaterial.colorNode = mix(
        vec3(0.008, 0.032, 0.027),
        vec3(0.035, 0.082, 0.052),
        distanceBand.div(18).clamp(),
    );
    const bank = new THREE.Mesh(
        ownGeometry(new THREE.RingGeometry(8, 22, 64)),
        bankMaterial,
    );
    bank.rotation.x = -Math.PI / 2;
    bank.position.set(-17, 0.01, -18);
    root.add(bank);

    root.add(
        new THREE.HemisphereLight(0x9ccfd0, 0x071713, 1.0),
        new THREE.DirectionalLight(0xbfe4df, 1.25),
    );
    root.children[root.children.length - 1].position.set(-12, 26, 14);

    const characters = createStillwaterCharacters({
        root,
        profile,
        reflectionLayer: 2,
        mode: 'spirit',
    });
    const event = String(params?.get?.('event') || 'respond');
    if (event !== 'idle') characters.pulse(event === 'respond' ? 'combo10' : event, 1);
    for (let index = 0; index < 72; index += 1) {
        characters.update(index / 60, 1 / 60);
    }

    const debugApi = Object.freeze({
        getDiagnostics: characters.getDiagnostics,
        getResourceState: characters.getResourceState,
        pulse: characters.pulse,
    });
    window.__STILLWATER_SPIRIT__ = debugApi;

    return {
        ...debugApi,
        camera(_time, activeCamera) {
            activeCamera.position.set(-4.7, 7.7, 10.8);
            activeCamera.lookAt(-17.4, 4.8, -18.3);
            activeCamera.fov = 41;
            activeCamera.near = 0.1;
            activeCamera.far = 180;
            activeCamera.updateProjectionMatrix();
        },
        update(time, delta) {
            characters.update(time, delta);
        },
        dispose() {
            if (window.__STILLWATER_SPIRIT__ === debugApi) delete window.__STILLWATER_SPIRIT__;
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

/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
import * as THREE from 'three/webgpu';
import {
    createAccretionDiskNodeMaterial,
    createBlackHoleCoreNodeMaterial,
    createEventHorizonNodeMaterial,
    createPhotonSphereNodeMaterial,
    createStarfieldNodeMaterial,
} from '../../themes/black-hole/black-hole-materials.js';
import { BlackHolePost } from '../../themes/black-hole/black-hole-post.js';

export const meta = {
    id: 'black-hole-performance',
    title: 'Black Hole Performance',
    description: 'Focused black-hole core, photon ring, layered disk, and starfield validation scene.',
};

const TAU = Math.PI * 2;

function mulberry32(seed) {
    let t = seed >>> 0;
    return () => {
        t += 0x6D2B79F5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

function setNodeUniform(material, name, value) {
    const node = material?.userData?.[name];
    if (node && 'value' in node) {
        node.value = value;
    }
}

function createStarfield(seed = 1337) {
    const random = mulberry32(seed);
    const starCount = 820;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);
    const twinkles = new Float32Array(starCount);

    const palette = [
        new THREE.Color(0xf0d6b3),
        new THREE.Color(0xd5a36d),
        new THREE.Color(0xb8a6d4),
        new THREE.Color(0x9fb8d6),
    ];

    for (let i = 0; i < starCount; i += 1) {
        const i3 = i * 3;
        const theta = random() * TAU;
        const phi = Math.acos(2 * random() - 1);
        const radius = 1800 + random() * 2600;
        const sinPhi = Math.sin(phi);

        positions[i3] = Math.cos(theta) * sinPhi * radius;
        positions[i3 + 1] = Math.sin(theta) * sinPhi * radius;
        positions[i3 + 2] = Math.cos(phi) * radius;

        const color = palette[Math.floor(random() * palette.length)];
        const gain = 0.58 + random() * 0.42;
        colors[i3] = Math.min(1, color.r * gain);
        colors[i3 + 1] = Math.min(1, color.g * gain);
        colors[i3 + 2] = Math.min(1, color.b * gain);

        const bright = random();
        sizes[i] = bright < 0.035 ? 4.2 + random() * 2.6 : 2.0 + random() * 1.6;
        twinkles[i] = bright < 0.08 ? 0.54 + random() * 0.2 : 0.35 + random() * 0.15;
    }

    const material = createStarfieldNodeMaterial({ isWebGPU: true });
    const sprite = new THREE.Sprite(material);
    sprite.count = starCount;
    sprite.geometry = sprite.geometry.clone();
    sprite.geometry.setAttribute('instancePosition', new THREE.InstancedBufferAttribute(positions, 3));
    sprite.geometry.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(colors, 3));
    sprite.geometry.setAttribute('instanceSize', new THREE.InstancedBufferAttribute(sizes, 1));
    sprite.geometry.setAttribute('instanceTwinkle', new THREE.InstancedBufferAttribute(twinkles, 1));
    sprite.frustumCulled = false;
    sprite.renderOrder = -20;
    return sprite;
}

export function create({ scene, camera, renderer }) {
    const previousBackground = scene.background;
    const previousSortObjects = renderer.sortObjects;
    renderer.sortObjects = false;
    scene.background = new THREE.Color(0x000005);

    const group = new THREE.Group();
    scene.add(group);

    const starfield = createStarfield(1337);
    group.add(starfield);

    const diskGeometry = new THREE.RingGeometry(140, 400, 32, 4);
    const diskMaterial = createAccretionDiskNodeMaterial({ noiseOctaves: 2 });
    const disk = new THREE.Mesh(diskGeometry, diskMaterial);
    disk.rotation.x = -Math.PI * 0.42;
    disk.renderOrder = 50;
    group.add(disk);

    const diskLayers = [];
    for (let i = 0; i < 1; i += 1) {
        const layerMaterial = createAccretionDiskNodeMaterial({ noiseOctaves: 2 });
        layerMaterial.blending = THREE.AdditiveBlending;
        layerMaterial.depthWrite = false;
        setNodeUniform(layerMaterial, 'uIntensity', 0.18 + i * 0.08);

        const layer = new THREE.Mesh(diskGeometry.clone(), layerMaterial);
        layer.rotation.x = -Math.PI * 0.42;
        layer.position.z = (i - 0.5) * 8;
        layer.scale.set(1.05 + i * 0.02, 1.05 + i * 0.02, 1);
        layer.renderOrder = 48 - i;
        diskLayers.push(layer);
        group.add(layer);
    }

    const coreGeometry = new THREE.PlaneGeometry(600, 600);
    const coreMaterial = createBlackHoleCoreNodeMaterial({ noiseOctaves: 2 });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    core.renderOrder = 100;
    group.add(core);

    const horizonGeometry = new THREE.SphereGeometry(120, 48, 32);
    const horizon = new THREE.Mesh(horizonGeometry, createEventHorizonNodeMaterial());
    horizon.renderOrder = 99;
    group.add(horizon);

    const photonGeometry = new THREE.RingGeometry(135, 175, 64);
    const photonMaterial = createPhotonSphereNodeMaterial();
    const photonRing = new THREE.Mesh(photonGeometry, photonMaterial);
    photonRing.renderOrder = 98;
    group.add(photonRing);

    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(2, 4, 6);
    group.add(key);

    camera.position.set(0, 118, 840);
    camera.lookAt(0, 0, 0);

    const post = new BlackHolePost(renderer, scene, camera, {
        useMRT: false,
        bloomStrength: 0.34,
        bloomRadius: 0.42,
        bloomThreshold: 0.3,
        bloomDownsample: 0.44,
        enableChromatic: false,
        chromaticStrength: 0.0,
        ditherStrength: 0.0,
    });
    post.setSize(window.innerWidth, window.innerHeight);

    return {
        cameraRadius: 850,
        camera(time, activeCamera) {
            activeCamera.position.set(Math.sin(time * 0.08) * 24, 118, 840);
            activeCamera.lookAt(0, 0, 0);
        },
        update(time) {
            setNodeUniform(coreMaterial, 'uTime', time);
            setNodeUniform(photonMaterial, 'uTime', time);
            setNodeUniform(diskMaterial, 'uTime', time);
            diskLayers.forEach((layer, index) => {
                setNodeUniform(layer.material, 'uTime', time + index * 0.18);
            });
            post.update({
                bloomStrength: 0.34,
                bloomRadius: 0.42,
                bloomDownsample: 0.44,
                chromaticStrength: 0.0,
            });
        },
        render() {
            post.render();
        },
        dispose() {
            renderer.sortObjects = previousSortObjects;
            scene.background = previousBackground;
            post.dispose();
            scene.remove(group);
            group.traverse((object) => {
                object.geometry?.dispose?.();
                if (Array.isArray(object.material)) {
                    object.material.forEach((material) => material.dispose?.());
                } else {
                    object.material?.dispose?.();
                }
            });
        },
    };
}

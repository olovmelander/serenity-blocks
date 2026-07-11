import * as THREE from 'three/webgpu';
import { pass, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import {
    createLunarHaloNodeMaterial,
    createMoonNodeMaterial,
} from '../../themes/wolfhour/wolfhour-materials.js';

export const meta = {
    id: 'wolfhour-lunar-sigil',
    title: 'Wolfhour - Lunar Sigil',
    description: 'Phase-locked lock/combo pulse, wolf-moon corona, and silver mountain silhouette.',
};

const clamp01 = (value) => Math.min(1, Math.max(0, value));

function seeded(seed) {
    let state = Math.abs(Math.floor(seed)) % 2147483647;
    if (state === 0) state = 1;
    return () => {
        state = (state * 16807) % 2147483647;
        return (state - 1) / 2147483646;
    };
}

function createRidgeGeometry(T, {
    width,
    floor,
    peak,
    steps,
    seed,
}) {
    const random = seeded(seed);
    const positions = [];
    const indices = [];
    const heights = [];

    for (let i = 0; i <= steps; i += 1) {
        const x = -width * 0.5 + (i / steps) * width;
        const broad = Math.sin((i / steps) * Math.PI) * peak;
        const crags = (random() - 0.5) * peak * 0.3
            + Math.sin(i * 1.73) * peak * 0.11
            + Math.sin(i * 0.41 + seed) * peak * 0.08;
        heights.push(floor + Math.max(16, broad + crags));
        positions.push(x, floor, 0, x, heights[i], 0);
        if (i < steps) {
            const base = i * 2;
            indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        }
    }

    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

function disposeTree(root) {
    root.traverse((object) => {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose?.());
        else object.material?.dispose?.();
    });
}

export function create({
    scene,
    camera,
    renderer,
    params,
}) {
    const previousBackground = scene.background;
    const previousToneMapping = renderer.toneMapping;
    const previousExposure = renderer.toneMappingExposure;
    scene.background = new THREE.Color(0x01020a);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1;

    camera.fov = 48;
    camera.near = 0.1;
    camera.far = 5000;
    camera.position.set(0, 38, 920);
    camera.lookAt(0, 12, -180);
    camera.updateProjectionMatrix();

    const group = new THREE.Group();
    scene.add(group);

    const starsGeometry = new THREE.BufferGeometry();
    const starCount = 1800;
    const starPositions = new Float32Array(starCount * 3);
    const random = seeded(73013);
    for (let i = 0; i < starCount; i += 1) {
        const i3 = i * 3;
        starPositions[i3] = (random() - 0.5) * 1900;
        starPositions[i3 + 1] = (random() - 0.36) * 1050;
        starPositions[i3 + 2] = -620 - random() * 850;
    }
    starsGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starsMaterial = new THREE.PointsNodeMaterial({
        color: new THREE.Color(0xb9c9e6),
        transparent: true,
        opacity: 0.72,
        size: 1.35,
        sizeAttenuation: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    const stars = new THREE.Points(starsGeometry, starsMaterial);
    group.add(stars);

    const moonTexture = new THREE.TextureLoader().load('./textures/2k_moon.jpg');
    moonTexture.colorSpace = THREE.SRGBColorSpace;
    moonTexture.anisotropy = Math.min(8, renderer.getMaxAnisotropy?.() || 1);

    const moonResult = createMoonNodeMaterial({ texture: moonTexture });
    const { uPulse: uLunarPulse } = moonResult.uniforms;
    const moon = new THREE.Mesh(new THREE.SphereGeometry(156, 64, 36), moonResult.material);
    moon.position.set(172, 132, -480);
    moon.rotation.y = -0.34;
    group.add(moon);

    const haloResult = createLunarHaloNodeMaterial();
    const {
        uTime,
        uProgress,
        uStrength,
        uCombo,
    } = haloResult.uniforms;
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(760, 760), haloResult.material);
    halo.position.set(172, 132, -500);
    group.add(halo);

    const ridgeConfigs = [
        {
            z: -400, y: -30, colorValue: 0x1a2238, width: 1750, floor: -230, peak: 300, steps: 74, seed: 19,
        },
        {
            z: -245, y: -90, colorValue: 0x0d1425, width: 1650, floor: -220, peak: 255, steps: 68, seed: 43,
        },
        {
            z: -90, y: -155, colorValue: 0x050812, width: 1550, floor: -210, peak: 205, steps: 62, seed: 71,
        },
    ];
    ridgeConfigs.forEach((config) => {
        const ridge = new THREE.Mesh(
            createRidgeGeometry(THREE, config),
            new THREE.MeshBasicNodeMaterial({
                color: new THREE.Color(config.colorValue),
                side: THREE.DoubleSide,
            }),
        );
        ridge.position.set(0, config.y, config.z);
        group.add(ridge);
    });

    const scenePass = pass(scene, camera);
    const sceneColor = scenePass.getTextureNode('output');
    const bloomNode = bloom(sceneColor, 0.32, 0.42, 0.76);
    const post = new THREE.PostProcessing(renderer);
    post.outputNode = vec4(sceneColor.rgb.add(bloomNode.rgb), sceneColor.a);
    post.needsUpdate = true;

    let eventName = (params.get('event') || 'lock').toLowerCase();
    let eventStart = performance.now() / 1000;
    const setEvent = (name, startTime = performance.now() / 1000) => {
        eventName = name;
        eventStart = startTime;
    };
    const onKey = (event) => {
        if (event.key === '0') setEvent('lock', performance.now() / 1000);
        else if (event.key === '3') setEvent('combo3', performance.now() / 1000);
        else if (event.key === '7') setEvent('combo7', performance.now() / 1000);
    };
    window.addEventListener('keydown', onKey);

    const diagnostics = {
        setEvent,
        snapshot: () => ({
            event: eventName,
            progress: uProgress.value,
            strength: uStrength.value,
            combo: uCombo.value,
            backend: renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2',
        }),
    };
    window.__WOLFHOUR_LUNAR_SIGIL__ = diagnostics;

    return {
        cameraRadius: 920,
        camera(time, activeCamera) {
            activeCamera.position.set(Math.sin(time * 0.09) * 7, 38 + Math.sin(time * 0.13) * 2, 920);
            activeCamera.lookAt(0, 12, -180);
        },
        update(time) {
            const fixedPreview = params.has('t');
            const localTime = fixedPreview ? time : Math.max(0, performance.now() / 1000 - eventStart);
            let comboCount = 0;
            if (eventName === 'combo7') comboCount = 7;
            else if (eventName === 'combo3') comboCount = 3;
            const duration = comboCount > 0 ? 1.9 : 1.25;
            const progress = clamp01(localTime / duration);
            const eventEnvelope = Math.sin(progress * Math.PI);
            const comboStrength = Math.min(0.62 + comboCount * 0.045, 1);
            const comboMix = Math.min(comboCount / 8, 1);

            uTime.value = time;
            uProgress.value = progress;
            uStrength.value = comboCount > 0 ? comboStrength : 1;
            uCombo.value = comboCount > 0 ? comboMix : 0.12;
            uLunarPulse.value = eventEnvelope
                * uStrength.value
                * (0.42 + uCombo.value * 0.45);
            moon.rotation.y = -0.34 + Math.sin(time * 0.05) * 0.025;
        },
        render() {
            post.render();
        },
        renderAsync() {
            post.render();
            return Promise.resolve();
        },
        resize(width, height) {
            scenePass.setSize(width, height);
        },
        dispose() {
            window.removeEventListener('keydown', onKey);
            if (window.__WOLFHOUR_LUNAR_SIGIL__ === diagnostics) {
                delete window.__WOLFHOUR_LUNAR_SIGIL__;
            }
            post.dispose();
            bloomNode.dispose?.();
            scenePass.dispose?.();
            scene.remove(group);
            disposeTree(group);
            moonTexture.dispose();
            scene.background = previousBackground;
            renderer.toneMapping = previousToneMapping;
            renderer.toneMappingExposure = previousExposure;
        },
    };
}

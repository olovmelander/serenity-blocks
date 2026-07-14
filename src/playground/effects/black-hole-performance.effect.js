/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
import * as THREE from 'three/webgpu';
import {
    createAccretionDiskNodeMaterial,
    createBlackHoleCoreNodeMaterial,
    createEventHorizonNodeMaterial,
    createLensedDiskArcNodeMaterial,
    createLockRippleNodeMaterial,
    createMatterStreamNodeMaterial,
    createPolarJetNodeMaterial,
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

function resolveComboTier(comboCount) {
    if (comboCount >= 8) return 4;
    if (comboCount >= 5) return 3;
    if (comboCount >= 3) return 2;
    if (comboCount > 0) return 1;
    return 0;
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

export function create({
    scene, camera, renderer, params,
}) {
    const previousBackground = scene.background;
    const previousSortObjects = renderer.sortObjects;
    renderer.sortObjects = false;
    scene.background = new THREE.Color(0x000005);

    const group = new THREE.Group();
    scene.add(group);

    // Seed is parameterized (?seed=) so replay scenarios are reproducible AND can be
    // varied deterministically; falls back to the canonical 1337 baseline seed.
    const seedParam = params.get('seed');
    const starfieldSeed = seedParam !== null && Number.isFinite(Number(seedParam))
        ? Number(seedParam) >>> 0
        : 1337;
    const starfield = createStarfield(starfieldSeed);
    group.add(starfield);

    // Replay scenarios: idle (default) | lineclear | lock | combo (?combo=N tiers).
    const eventMode = params.get('event') || 'idle';
    const comboCount = Number(params.get('combo') || (eventMode === 'combo' ? 8 : 0));
    const comboTier = resolveComboTier(comboCount);
    const eventEnergy = comboTier > 0 ? [0, 0.22, 0.46, 0.7, 1][comboTier] : 0;
    // A line clear is a moderate disk event: the accretion flow brightens and its
    // Doppler contrast lifts, but it does NOT summon the combo-only phenomena (secondary
    // rings, polar jet, caustic). This makes ?event=lineclear visibly distinct from idle,
    // from lock (localized ripple + matter stream), and from combo (full ladder).
    const lineClearActive = eventMode === 'lineclear';
    const lineClearEnergy = lineClearActive ? 0.42 : 0;

    const diskGeometry = new THREE.RingGeometry(140, 400, 96, 1);
    const diskMaterial = createAccretionDiskNodeMaterial({ noiseOctaves: 2 });
    const disk = new THREE.Mesh(diskGeometry, diskMaterial);
    disk.rotation.x = -Math.PI * 0.42;
    disk.renderOrder = 50;
    group.add(disk);

    const diskLayers = [];

    const lensedArcMaterial = createLensedDiskArcNodeMaterial();
    const lensedArc = new THREE.Mesh(new THREE.PlaneGeometry(760, 540), lensedArcMaterial);
    lensedArc.position.z = -12;
    lensedArc.renderOrder = 52;
    group.add(lensedArc);

    const polarJetMaterial = createPolarJetNodeMaterial();
    const polarJet = new THREE.Mesh(new THREE.PlaneGeometry(190, 760), polarJetMaterial);
    polarJet.position.z = -20;
    polarJet.renderOrder = 47;
    group.add(polarJet);

    const coreGeometry = new THREE.PlaneGeometry(600, 600);
    const coreMaterial = createBlackHoleCoreNodeMaterial({ noiseOctaves: 2 });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    core.renderOrder = 100;
    group.add(core);

    const horizonGeometry = new THREE.SphereGeometry(120, 48, 32);
    const horizon = new THREE.Mesh(horizonGeometry, createEventHorizonNodeMaterial());
    horizon.renderOrder = 99;
    group.add(horizon);

    const photonGeometry = new THREE.PlaneGeometry(620, 620);
    const photonMaterial = createPhotonSphereNodeMaterial();
    const photonRing = new THREE.Mesh(photonGeometry, photonMaterial);
    photonRing.renderOrder = 98;
    group.add(photonRing);

    const lockRippleMaterial = createLockRippleNodeMaterial();
    const lockRipple = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), lockRippleMaterial);
    lockRipple.position.set(-220, -95, 90);
    lockRipple.renderOrder = 120;
    group.add(lockRipple);

    const matterStreamMaterial = createMatterStreamNodeMaterial();
    const matterStream = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), matterStreamMaterial);
    const streamStart = new THREE.Vector2(lockRipple.position.x, lockRipple.position.y);
    const streamVector = new THREE.Vector2(-streamStart.x, -streamStart.y);
    matterStream.scale.set(streamVector.length(), 34, 1);
    matterStream.position.set(streamStart.x * 0.5, streamStart.y * 0.5, 82);
    matterStream.rotation.z = Math.atan2(streamVector.y, streamVector.x);
    matterStream.renderOrder = 119;
    group.add(matterStream);

    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(2, 4, 6);
    group.add(key);

    camera.position.set(0, 105, 1040);
    camera.lookAt(0, 0, 0);

    const post = new BlackHolePost(renderer, scene, camera, {
        useMRT: false,
        bloomStrength: 0.34,
        bloomRadius: 0.42,
        bloomThreshold: 0.3,
        bloomDownsample: 0.44,
        enableChromatic: false,
        enableLensing: true,
        lensCenter: new THREE.Vector2(0.5, 0.5),
        lensStrength: eventMode === 'lock' ? 0.026 : 0.016 + eventEnergy * 0.018,
        lensRadius: 0.36,
        lensInnerRadius: 0.105,
        chromaticStrength: 0.0,
        ditherStrength: 0.0,
    });
    post.setSize(window.innerWidth, window.innerHeight);

    return {
        cameraRadius: 1040,
        camera(time, activeCamera) {
            activeCamera.position.set(Math.sin(time * 0.08) * 18, 105, 1040);
            activeCamera.lookAt(0, 0, 0);
        },
        update(time) {
            const lockActive = eventMode === 'lock';
            const lockProgress = Number(params.get('lockProgress') || 0.52);
            setNodeUniform(coreMaterial, 'uTime', time);
            setNodeUniform(photonMaterial, 'uTime', time);
            setNodeUniform(photonMaterial, 'uIntensity', 0.58 + eventEnergy * 0.16 + lineClearEnergy * 0.12);
            setNodeUniform(photonMaterial, 'uEchoStrength', 0.075 + eventEnergy * 0.14);
            setNodeUniform(photonMaterial, 'uCausticStrength', comboTier >= 4 ? 0.82 : 0.0);
            setNodeUniform(diskMaterial, 'uTime', time);
            setNodeUniform(diskMaterial, 'uDopplerBoost', 0.92 + eventEnergy * 0.52 + lineClearEnergy * 0.4);
            setNodeUniform(diskMaterial, 'uEventEnergy', eventEnergy + lineClearEnergy * 0.5);
            setNodeUniform(diskMaterial, 'uCausticStrength', comboTier >= 4 ? 0.72 : 0.0);
            setNodeUniform(lensedArcMaterial, 'uTime', time);
            setNodeUniform(lensedArcMaterial, 'uIntensity', 0.45 + eventEnergy * 0.24 + lineClearEnergy * 0.14);
            setNodeUniform(lensedArcMaterial, 'uDopplerBoost', 0.9 + eventEnergy * 0.45 + lineClearEnergy * 0.35);
            setNodeUniform(lensedArcMaterial, 'uCausticStrength', comboTier >= 4 ? 0.78 : 0.0);
            setNodeUniform(polarJetMaterial, 'uTime', time);
            setNodeUniform(polarJetMaterial, 'uIntensity', comboTier >= 3 ? 0.18 + eventEnergy * 0.12 : 0.0);
            setNodeUniform(lockRippleMaterial, 'uProgress', lockProgress);
            setNodeUniform(lockRippleMaterial, 'uIntensity', lockActive ? 0.68 : 0.0);
            setNodeUniform(lockRippleMaterial, 'uCompression', lockActive ? Math.max(0, 1 - lockProgress * 2.5) : 0.0);
            setNodeUniform(matterStreamMaterial, 'uProgress', Math.min(1, lockProgress * 1.35));
            setNodeUniform(matterStreamMaterial, 'uIntensity', lockActive ? 0.74 : 0.0);
            diskLayers.forEach((layer, index) => {
                setNodeUniform(layer.material, 'uTime', time + index * 0.18);
            });
            post.update({
                bloomStrength: 0.2 + eventEnergy * 0.06,
                bloomRadius: 0.36,
                bloomDownsample: 0.44,
                chromaticStrength: 0.0,
                lensCenter: [0.5, 0.5],
                lensStrength: lockActive ? 0.026 : 0.016 + eventEnergy * 0.018,
                exposure: 0.96,
                saturation: 1.04,
                tintStrength: 0.12,
                ditherStrength: 0.0012,
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

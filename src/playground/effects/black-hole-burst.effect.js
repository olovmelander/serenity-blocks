/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
import * as THREE from 'three/webgpu';
import {
    BlackHoleBurstCompute,
    BlackHoleParticleCompute,
} from '../../themes/black-hole/black-hole-compute.js';
import {
    createBurstSparkNodeMaterial,
    createParticleNodeMaterial,
} from '../../themes/black-hole/black-hole-materials.js';
import { BlackHolePost } from '../../themes/black-hole/black-hole-post.js';

export const meta = {
    id: 'black-hole-burst',
    title: 'Black Hole Burst Sparks',
    description: 'Isolated combo burst-spark + ambient dust compute (scaled counts, depth-clamped size).',
};

const TAU = Math.PI * 2;
const DISK_TILT = Math.PI * 0.42;
const DISK_COS = Math.cos(DISK_TILT);
const DISK_SIN = Math.sin(DISK_TILT);

function mulberry32(seed) {
    let t = seed >>> 0;
    return () => {
        t += 0x6D2B79F5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

const HOT_COLORS = [
    new THREE.Color(0xffaa44),
    new THREE.Color(0xff6622),
    new THREE.Color(0x44aaff),
    new THREE.Color(0xaa66ff),
    new THREE.Color(0xffffff),
    new THREE.Color(0xff44aa),
];

const DUST_COLORS = [
    new THREE.Color(0xffc48a),
    new THREE.Color(0xffad74),
    new THREE.Color(0xf1b1ff),
    new THREE.Color(0x9bc7ff),
    new THREE.Color(0xff9fc8),
];

// Build the GPU burst-spark bank exactly as the theme's createBurstComputeBank does.
function buildBurstBank(count, random) {
    const angles = new Float32Array(count * 2);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const randoms = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
        angles[i * 2] = random() * TAU;
        angles[i * 2 + 1] = Math.acos(2 * random() - 1);
        randoms[i] = random();
        const c = HOT_COLORS[Math.floor(random() * HOT_COLORS.length)];
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
        sizes[i] = 5 + random() * 8;
    }

    const compute = new BlackHoleBurstCompute(count, { lifetimeSeconds: 12 });
    compute.setInitialState(angles, colors, sizes, randoms);
    compute.createComputeNode();

    const material = createBurstSparkNodeMaterial({ isWebGPU: true, burstCompute: compute });
    const sprite = new THREE.Sprite(material);
    sprite.count = count;
    sprite.geometry = sprite.geometry.clone();
    sprite.geometry.setAttribute(
        'instancePosition',
        new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3),
    );
    sprite.frustumCulled = false;
    sprite.renderOrder = 70;
    return { compute, material, sprite };
}

// Build the GPU ambient-dust system exactly as the theme's createParticleSystem does.
function buildAmbientDust(count, random) {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const lifetimes = new Float32Array(count);
    const randoms = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
        const i3 = i * 3;
        const angle = random() * TAU;
        const radius = 260 + random() * 360;
        const height = (random() - 0.5) * 70;
        const diskV = Math.sin(angle) * radius;
        positions[i3] = Math.cos(angle) * radius;
        positions[i3 + 1] = diskV * DISK_COS + height * DISK_SIN;
        positions[i3 + 2] = -diskV * DISK_SIN + height * DISK_COS;

        const orbitalSpeed = 0.28 + random() * 0.22;
        const diskVel = Math.cos(angle) * orbitalSpeed;
        velocities[i3] = -Math.sin(angle) * orbitalSpeed;
        velocities[i3 + 1] = diskVel * DISK_COS;
        velocities[i3 + 2] = -diskVel * DISK_SIN;

        const c = DUST_COLORS[Math.floor(random() * DUST_COLORS.length)];
        colors[i3] = c.r;
        colors[i3 + 1] = c.g;
        colors[i3 + 2] = c.b;
        sizes[i] = 2.2 + random() * 3.2;
        lifetimes[i] = 0.7 + random() * 0.3;
        randoms[i] = random();
    }

    const compute = new BlackHoleParticleCompute(count);
    compute.setInitialState(positions, velocities, colors, sizes, lifetimes, randoms);
    compute.createComputeNode();

    const material = createParticleNodeMaterial({ isWebGPU: true, particleCompute: compute });
    const sprite = new THREE.Sprite(material);
    sprite.count = count;
    sprite.geometry = sprite.geometry.clone();
    sprite.geometry.setAttribute(
        'instancePosition',
        new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3),
    );
    sprite.frustumCulled = false;
    sprite.renderOrder = 55;
    return { compute, material, sprite };
}

export function create({
    scene, camera, renderer, params,
}) {
    const previousBackground = scene.background;
    const previousSort = renderer.sortObjects;
    renderer.sortObjects = false;
    scene.background = new THREE.Color(0x000005);

    const random = mulberry32(Number(params.get('seed')) >>> 0 || 1337);
    // ?count= to stress a tier; defaults to the Extreme buffer size.
    const burstCount = Number(params.get('count')) || 8000;
    const dustCount = Number(params.get('dust')) || 2000;
    // ?combo= sets how large each triggered wave is (fraction of the buffer).
    const comboCount = Number(params.get('combo')) || 8;
    const perTrigger = Math.min(burstCount, Math.floor(burstCount * (0.05 + Math.min(comboCount, 12) * 0.02)));

    const group = new THREE.Group();
    scene.add(group);

    // A dim event-horizon disc so the burst has a silhouette to explode around.
    const horizon = new THREE.Mesh(
        new THREE.SphereGeometry(120, 32, 32),
        new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    horizon.renderOrder = 99;
    group.add(horizon);

    const burst = buildBurstBank(burstCount, random);
    const dust = buildAmbientDust(dustCount, random);
    group.add(burst.sprite);
    group.add(dust.sprite);

    if (burst.material.userData?.uBlackHolePos) burst.material.userData.uBlackHolePos.value.set(0, 0, 0);
    if (burst.material.userData?.uPulseTimer) burst.material.userData.uPulseTimer.value = -100;
    if (dust.material.userData?.uBlackHolePos) dust.material.userData.uBlackHolePos.value.set(0, 0, 0);

    camera.position.set(0, 105, 1040);
    camera.lookAt(0, 0, 0);

    const post = new BlackHolePost(renderer, scene, camera, {
        useMRT: false,
        bloomStrength: 0.32,
        bloomRadius: 0.5,
        bloomThreshold: 0.28,
        bloomDownsample: 0.5,
        enableChromatic: false,
        enableLensing: false,
        exposure: 0.98,
        saturation: 1.06,
        tintStrength: 0.12,
        ditherStrength: 0.0012,
    });
    post.setSize(window.innerWidth, window.innerHeight);

    // Fire the first wave promptly so a phase-locked ?t= capture lands mid-explosion, then
    // re-trigger on an interval so a live view shows repeated combo bursts.
    const triggerPeriod = 2.4;
    let nextTriggerAt = 0.15;

    return {
        cameraRadius: 1040,
        camera(time, activeCamera) {
            activeCamera.position.set(Math.sin(time * 0.06) * 24, 105, 1040);
            activeCamera.lookAt(0, 0, 0);
        },
        update(time, dt) {
            if (time >= nextTriggerAt) {
                burst.compute.activateParticles(perTrigger, time, random() * TAU);
                nextTriggerAt = time + triggerPeriod;
            }
            burst.compute.update(dt, { time, blackHolePos: new THREE.Vector3(0, 0, 0), burstFactor: 6 });
            renderer.compute(burst.compute.computeNode);

            dust.compute.update(dt, {
                time,
                blackHolePos: new THREE.Vector3(0, 0, 0),
                gravitySurge: 0,
                burstFactor: 0,
                burstPhase: false,
                comboScatterUntil: 0,
                activeCount: dustCount,
            });
            renderer.compute(dust.compute.computeNode);

            post.update({
                bloomStrength: 0.32,
                bloomRadius: 0.5,
                bloomDownsample: 0.5,
                exposure: 0.98,
                saturation: 1.06,
                tintStrength: 0.12,
                ditherStrength: 0.0012,
            });
        },
        render() {
            post.render();
        },
        dispose() {
            renderer.sortObjects = previousSort;
            scene.background = previousBackground;
            post.dispose();
            burst.compute.dispose();
            dust.compute.dispose();
            scene.remove(group);
            group.traverse((object) => {
                object.geometry?.dispose?.();
                if (Array.isArray(object.material)) {
                    object.material.forEach((m) => m.dispose?.());
                } else {
                    object.material?.dispose?.();
                }
            });
        },
    };
}

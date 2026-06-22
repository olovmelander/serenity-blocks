import * as THREE from 'three/webgpu';
import { LunaraReactionParticles } from '../../themes/lunara/lunara-reaction-particles.js';

export const meta = {
    id: 'lunara-reactions',
    title: 'Lunara - Reactions',
    description: 'Crystal fans, moon bursts, combo resonance, and pooled rings for Lunara gameplay events.',
};

function seeded(seed) {
    let state = seed % 2147483647;
    return () => {
        state = (state * 16807) % 2147483647;
        return (state - 1) / 2147483646;
    };
}

function disposeObject(object) {
    object.traverse?.((child) => {
        child.geometry?.dispose?.();
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose?.());
        else child.material?.dispose?.();
    });
}

function makeCrystalGeometry(T) {
    return new T.ConeGeometry(0.72, 5.2, 6, 1).toNonIndexed();
}

function terrainHeight(x, z) {
    return -4.2
        + Math.sin(x * 0.055) * 0.35
        + Math.cos(z * 0.047) * 0.22
        + Math.sin((x + z) * 0.018) * 0.3;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export function create({
    THREE: T = THREE,
    scene,
    camera,
    renderer,
    params,
}) {
    const objects = [];
    const add = (object) => {
        scene.add(object);
        objects.push(object);
        return object;
    };

    const previousBackground = scene.background;
    const previousFog = scene.fog;
    scene.background = new T.Color(0x050217);
    scene.fog = new T.FogExp2(0x130826, 0.0045);

    camera.fov = 55;
    camera.near = 0.1;
    camera.far = 4200;
    camera.position.set(0, 10, 66);
    camera.lookAt(0, 7, -170);
    camera.updateProjectionMatrix();

    add(new T.HemisphereLight(0x8d73ff, 0x160620, 0.74));
    const key = add(new T.DirectionalLight(0xe1c8ff, 1.7));
    key.position.set(-0.25, 0.74, 0.55);
    const rose = add(new T.PointLight(0xff72b8, 2.2, 220, 2));
    rose.position.set(36, 26, -90);

    const ground = add(new T.Mesh(
        new T.PlaneGeometry(920, 760, 36, 36),
        new T.MeshStandardNodeMaterial({
            color: new T.Color(0x211046),
            roughness: 0.82,
            metalness: 0.05,
        }),
    ));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -4.8, -115);

    const stream = add(new T.Mesh(
        new T.PlaneGeometry(20, 360, 3, 80),
        new T.MeshBasicNodeMaterial({
            color: new T.Color(0x6c5dff),
            transparent: true,
            opacity: 0.28,
            blending: T.AdditiveBlending,
            depthWrite: false,
            side: T.DoubleSide,
        }),
    ));
    stream.rotation.x = -Math.PI / 2;
    stream.rotation.z = 0.12;
    stream.position.set(0, -4.55, -112);

    const primaryMoon = add(new T.Mesh(
        new T.SphereGeometry(1, 48, 24),
        new T.MeshBasicNodeMaterial({ color: new T.Color(0x341071) }),
    ));
    primaryMoon.position.set(-360, 380, -1968);
    primaryMoon.scale.setScalar(210);

    const companionMoon = add(new T.Mesh(
        new T.SphereGeometry(1, 36, 18),
        new T.MeshBasicNodeMaterial({ color: new T.Color(0xbd235a) }),
    ));
    companionMoon.position.set(115, 340, -1908);
    companionMoon.scale.setScalar(97.5);

    const haloMat = new T.MeshBasicNodeMaterial({
        color: new T.Color(0x9d64ff),
        transparent: true,
        opacity: 0.13,
        blending: T.AdditiveBlending,
        depthWrite: false,
        side: T.DoubleSide,
    });
    const halo = add(new T.Mesh(new T.CircleGeometry(1, 96), haloMat));
    halo.position.copy(primaryMoon.position);
    halo.position.z -= 18;
    halo.scale.setScalar(510);

    const crystalMaterial = new T.MeshStandardNodeMaterial({
        color: new T.Color(0x7f52e8),
        roughness: 0.16,
        metalness: 0.08,
        emissive: new T.Color(0x8ff7ff),
        emissiveIntensity: 0.52,
        transparent: true,
        opacity: 0.86,
    });
    const crystalMesh = add(new T.InstancedMesh(makeCrystalGeometry(T), crystalMaterial, 54));
    const tmp = new T.Object3D();
    const rng = seeded(91817);
    for (let i = 0; i < 54; i += 1) {
        const side = i % 2 === 0 ? -1 : 1;
        const z = 30 - rng() ** 1.35 * 185;
        const x = side * (28 + rng() * (42 + Math.max(0, -z) * 0.42));
        const h = 2.8 + rng() * 8.6;
        tmp.position.set(x, terrainHeight(x, z) + h * 0.5, z);
        tmp.rotation.set((rng() - 0.5) * 0.26, rng() * Math.PI * 2, (rng() - 0.5) * 0.34);
        tmp.scale.set(0.9 + rng() * 1.8, h, 0.8 + rng() * 1.2);
        tmp.updateMatrix();
        crystalMesh.setMatrixAt(i, tmp.matrix);
    }
    crystalMesh.instanceMatrix.needsUpdate = true;

    const isWebGPU = renderer?.backend?.isWebGPUBackend === true;
    const reactions = new LunaraReactionParticles({
        scene,
        renderer,
        isWebGPU,
        useCompute: isWebGPU && (typeof renderer.compute === 'function' || typeof renderer.computeAsync === 'function'),
        quality: 'High',
        capacity: 900,
        heroCapacity: 96,
        ribbonCount: 10,
        terrainSampler: terrainHeight,
        getCamera: () => camera,
        getPrimaryMoonPosition: () => primaryMoon.position,
        getCompanionMoonPosition: () => companionMoon.position,
        primaryMoonRadius: 210,
        companionMoonRadius: 97.5,
    });
    reactions.init();
    window.__LUNARA_REACTIONS_DEBUG__ = reactions;

    let eventName = (params.get('event') || 'line4').toLowerCase();
    const fixedTimeValue = Number.parseFloat(params.get('t') ?? '');
    const hasFixedPreviewTime = params.has('t') && Number.isFinite(fixedTimeValue);
    let fired = false;
    let previewKey = '';

    const fire = (name = eventName) => {
        if (name === 'lock') {
            reactions.triggerPieceLock({
                piece: {
                    x: 4,
                    y: 16,
                    shape: [
                        [1, 1, 1],
                        [0, 1, 0],
                    ],
                },
            });
        } else if (name === 'line1') {
            reactions.triggerLineClear({ lineCount: 1 });
        } else if (name === 'line2') {
            reactions.triggerLineClear({ lineCount: 2 });
        } else if (name === 'line3') {
            reactions.triggerLineClear({ lineCount: 3 });
        } else if (name === 'line4' || name === 'tetris') {
            reactions.triggerLineClear({ lineCount: 4 });
        } else if (name === 'combo3') {
            reactions.triggerCombo({ comboCount: 3 });
        } else if (name === 'combo7') {
            reactions.triggerCombo({ comboCount: 7 });
        }
    };

    const onKey = (event) => {
        if (event.key === '0') eventName = 'lock';
        else if (event.key === '1') eventName = 'line1';
        else if (event.key === '2') eventName = 'line2';
        else if (event.key === '3') eventName = 'line3';
        else if (event.key === '4') eventName = 'line4';
        else if (event.key.toLowerCase() === 'c') eventName = 'combo3';
        else if (event.key === '7') eventName = 'combo7';
        else return;

        previewKey = '';
        if (!hasFixedPreviewTime) fire(eventName);
    };
    window.addEventListener('keydown', onKey);
    if (!hasFixedPreviewTime) {
        fire(eventName);
        fired = true;
    }

    const replayFixedPreview = (phaseSeconds) => {
        const phase = clamp(phaseSeconds, 0, 1.65);
        const nextPreviewKey = `${eventName}:${phase.toFixed(4)}`;
        if (previewKey === nextPreviewKey) {
            const uniforms = reactions.material?.userData?.uniforms;
            if (uniforms?.uTime) uniforms.uTime.value = phase;
            return;
        }
        previewKey = nextPreviewKey;
        reactions.clear({ resetRandom: true });
        fire(eventName);
        let elapsed = 0;
        while (elapsed < phase) {
            const step = Math.min(1 / 60, phase - elapsed);
            elapsed += step;
            reactions.update(step, elapsed);
        }
    };

    return {
        cameraRadius: 115,
        update(time, dt) {
            if (hasFixedPreviewTime) {
                replayFixedPreview(time);
            } else if (!fired) {
                fire(eventName);
                fired = true;
                reactions.update(dt || 1 / 60, time);
            } else {
                reactions.update(dt || 1 / 60, time);
            }
            halo.lookAt(camera.position);
            halo.scale.setScalar(510 + Math.sin(time * 1.4) * 12);
            primaryMoon.rotation.y = time * 0.035;
            companionMoon.rotation.y = -time * 0.05;
        },
        camera(time, cam) {
            cam.position.set(Math.sin(time * 0.1) * 2.2, 10 + Math.sin(time * 0.17) * 0.5, 66);
            cam.lookAt(Math.sin(time * 0.08) * 4, 7, -170);
        },
        dispose() {
            window.removeEventListener('keydown', onKey);
            if (window.__LUNARA_REACTIONS_DEBUG__ === reactions) {
                delete window.__LUNARA_REACTIONS_DEBUG__;
            }
            reactions.dispose();
            objects.forEach((object) => {
                scene.remove(object);
                disposeObject(object);
            });
            scene.background = previousBackground;
            scene.fog = previousFog;
        },
    };
}

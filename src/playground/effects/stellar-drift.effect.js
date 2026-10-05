/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
import * as THREE from 'three/webgpu';
import { StellarDriftAtmosphere } from '../../themes/stellar-drift/stellar-drift-atmosphere.js';
import { StellarDriftReactions } from '../../themes/stellar-drift/stellar-drift-reactions.js';
import { StellarDriftPost } from '../../themes/stellar-drift/stellar-drift-post.js';

export const meta = {
    id: 'stellar-drift',
    title: 'Stellar Drift — a deep orbital voyage',
    description: 'Sculpted planets, ice rings, layered cosmic dust and curving orbital celebrations.',
};

export function create({
    scene, camera, renderer, params, rng,
}) {
    const saved = {
        fov: camera.fov, far: camera.far, tone: renderer.toneMapping, exposure: renderer.toneMappingExposure,
    };
    const quality = params.get('quality') || 'High';
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.98;
    camera.far = 500;
    const atmosphere = new StellarDriftAtmosphere({
        scene, camera, quality, rng,
    }).build();
    // Replay the event RNG on seek, independently of the atmosphere's setup draws.
    const randomTape = [];
    let randomIndex = 0;
    const reactions = new StellarDriftReactions({
        quality,
        rng: () => {
            if (randomTape[randomIndex] === undefined) randomTape[randomIndex] = rng();
            return randomTape[randomIndex++];
        },
    });
    renderer.toneMapping = THREE.NoToneMapping;
    const post = new StellarDriftPost({
        renderer, scene, camera, quality,
    });
    post.setSize(window.innerWidth, window.innerHeight);
    const pointerMove = (event) => {
        if (event.pointerType !== 'touch') {
            atmosphere.setPointer(
                (event.clientX / window.innerWidth) * 2 - 1,
                1 - (event.clientY / window.innerHeight) * 2,
            );
        }
    };
    const pointerLeave = () => atmosphere.setPointer(0, 0);
    window.addEventListener('pointermove', pointerMove, { passive: true });
    document.addEventListener('pointerleave', pointerLeave);
    window.addEventListener('blur', pointerLeave);
    let overlay;
    if (params.get('board') === '1') {
        overlay = document.createElement('div');
        overlay.className = 'player-card';
        overlay.dataset.player = 'solo';
        overlay.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);'
            + 'width:calc(min(clamp(220px,22vw,300px),(100vh - 250px)/2) + 24px);'
            + 'height:calc(2 * min(clamp(220px,22vw,300px),(100vh - 250px)/2) + 24px);'
            + 'border:1px solid #bfeee840;border-radius:16px;background:#081721e8;pointer-events:none;z-index:3';
        document.body.appendChild(overlay);
        atmosphere.resize(window.innerWidth, window.innerHeight, overlay.getBoundingClientRect());
    }
    let currentTime = 0;
    let currentFrame = {};
    const update = (time, dt) => {
        reactions.update(dt);
        const frame = reactions.getFrame();
        currentTime = time;
        currentFrame = frame;
        atmosphere.update(time, dt, frame);
        post.update(frame);
    };
    let sought = null;
    const seek = (time) => {
        if (!Number.isFinite(time)) return;
        const target = Math.max(0, time);
        if (target === sought) return;
        reactions.reset();
        randomIndex = 0;
        const steps = Math.max(1, Math.ceil(target * 60));
        const dt = target / steps;
        const age = Number(params.get('eventAge') ?? 0.35);
        const eventTime = Math.max(0, target - (Number.isFinite(age) ? Math.max(0, age) : 0.35));
        let fired = false;
        for (let i = 1; i <= steps; i += 1) {
            const t = i * dt;
            if (!fired && t >= eventTime) {
                fired = true;
                const event = params.get('event');
                if (event === 'lock') reactions.onPieceLock();
                else if (event === 'combo') reactions.onCombo(Number(params.get('combo') || 5));
                else if (event === 'tetris' || event === 'clear') reactions.onLineClear(event === 'tetris' ? 4 : 1);
            }
            update(t, Math.max(0, dt));
        }
        sought = target;
    };
    window.__STELLAR_DRIFT_ATMOSPHERE__ = atmosphere;
    return {
        cameraRadius: 1,
        camera() {},
        seek,
        update(time, dt) { if (!params.has('t')) update(time, Math.min(0.05, Math.max(0, dt))); },
        render() { post.render(); },
        resize(width, height) {
            atmosphere.resize(width, height, overlay?.getBoundingClientRect());
            atmosphere.update(currentTime, 0, currentFrame);
            post.setSize(width, height);
        },
        getDiagnostics() {
            return {
                quality,
                ...post.getDiagnostics(),
                arcs: reactions.getFrame().arcs.filter((a) => a.active).length,
                comets: reactions.getFrame().comets.filter((c) => c.active).length,
                ...atmosphere.getDiagnostics(),
                backend: renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2',
            };
        },
        dispose() {
            window.removeEventListener('pointermove', pointerMove);
            document.removeEventListener('pointerleave', pointerLeave);
            window.removeEventListener('blur', pointerLeave);
            overlay?.remove();
            post.dispose();
            reactions.dispose();
            atmosphere.dispose();
            delete window.__STELLAR_DRIFT_ATMOSPHERE__;
            camera.fov = saved.fov; camera.far = saved.far; camera.updateProjectionMatrix();
            renderer.toneMapping = saved.tone; renderer.toneMappingExposure = saved.exposure;
        },
    };
}

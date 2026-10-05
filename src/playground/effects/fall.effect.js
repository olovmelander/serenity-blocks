import * as THREE from 'three/webgpu';
import { FallWorld } from '../../themes/fall/fall-world.js';
import { FallReactions } from '../../themes/fall/fall-reactions.js';
import { FallPost } from '../../themes/fall/fall-post.js';

export const meta = {
    id: 'fall',
    title: 'Fall — the amber glade',
    description: 'Sculpted autumn canopy, a winding woodland path, drifting leaves and harvest cascades.',
};

export function create({
    scene, camera, renderer, params, rng,
}) {
    const saved = {
        fov: camera.fov, far: camera.far, tone: renderer.toneMapping, exposure: renderer.toneMappingExposure,
    };
    const quality = params.get('quality') || 'High';
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    const world = new FallWorld({
        scene, camera, quality, rng,
    }).build();
    const randomTape = []; let randomIndex = 0;
    const reactions = new FallReactions({
        quality,
        rng: () => {
            if (randomTape[randomIndex] === undefined) randomTape[randomIndex] = rng();
            return randomTape[randomIndex++];
        },
    });
    const post = new FallPost({
        renderer, scene, camera, quality,
    });
    post.setSize(window.innerWidth, window.innerHeight);
    let overlay;
    if (params.get('board') === '1') {
        overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);'
            + 'width:min(260px,46vw);height:min(520px,68vh);border:1px solid #fed39650;'
            + 'border-radius:14px;background:#171523e8;pointer-events:none;z-index:3';
        document.body.appendChild(overlay);
    }
    const update = (time, dt) => {
        reactions.update(dt); const frame = reactions.getFrame();
        world.update(time, dt, frame); post.update(frame);
    };
    let sought = null;
    const seek = (time) => {
        if (!Number.isFinite(time) || time === sought) return;
        const target = Math.max(0, time); reactions.reset(); randomIndex = 0;
        const age = Number(params.get('eventAge') ?? 0.35);
        const eventTime = Math.max(0, target - (Number.isFinite(age) ? Math.max(0, age) : 0.35));
        const steps = Math.max(1, Math.ceil(target * 60)); const dt = target / steps;
        let fired = false;
        for (let i = 1; i <= steps; i += 1) {
            if (!fired && i * dt >= eventTime) {
                fired = true;
                const event = params.get('event');
                if (event === 'lock') reactions.onPieceLock();
                else if (event === 'combo') reactions.onCombo(Number(params.get('combo') || 6));
                else if (event === 'clear' || event === 'tetris') reactions.onLineClear(event === 'tetris' ? 4 : 1);
            }
            update(i * dt, dt);
        }
        sought = time;
    };
    return {
        cameraRadius: 1,
        camera() {},
        seek,
        update(time, dt) { if (!params.has('t')) update(time, Math.max(0, Math.min(0.05, dt))); },
        render() { post.render(); },
        resize(width, height) { world.prepareCamera(camera.aspect); post.setSize(width, height); },
        getDiagnostics() {
            return {
                ...world.getDiagnostics(),
                ...post.getDiagnostics(),
                activeBursts: reactions.getFrame().bursts.length,
            };
        },
        dispose() {
            overlay?.remove(); post.dispose(); reactions.dispose(); world.dispose();
            camera.fov = saved.fov; camera.far = saved.far; camera.updateProjectionMatrix();
            renderer.toneMapping = saved.tone; renderer.toneMappingExposure = saved.exposure;
        },
    };
}

/** The actual Chiral Gold sculpture, isolated for deterministic visual review. */
import * as THREE from 'three/webgpu';
import { createChiralGoldSculpture } from '../../themes/chiral-gold/chiral-gold-sculpture.js';
import { ChiralGoldPost } from '../../themes/chiral-gold/chiral-gold-post.js';

export const meta = {
    id: 'chiral-gold',
    title: 'Chiral Gold — intertwined gold sculpture',
    description: 'Oppositely handed polished gold ribbons, flowing fine filaments and amber reaction coronas.',
};

export function create({
    scene, camera, renderer, params, rng, sizes,
}) {
    const saved = {
        fov: camera.fov, near: camera.near, far: camera.far, background: scene.background,
    };
    camera.fov = 64;
    camera.near = 1;
    camera.far = 10000;
    camera.position.set(0, 0, 1520);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    scene.background = new THREE.Color(0x030201);
    const world = createChiralGoldSculpture({ scene, quality: params.get('quality') || 'High', random: rng });
    const post = params.get('noPost') === '1' ? null : new ChiralGoldPost(renderer, scene, camera, {
        useMRT: false,
        bloomStrength: 0.46,
        bloomRadius: 0.45,
        bloomThreshold: 0.76,
        exposure: 1.03,
        contrast: 1.0,
        saturation: 1.07,
        blackFloor: 0,
        vignetteDarkness: 0.28,
        vignetteOffset: 1.24,
        chromaticStrength: 0.0004,
        filmGrain: 0,
        ditherStrength: 0.001,
    });
    const number = (key, fallback = 0) => {
        const value = Number.parseFloat(params.get(key));
        return Number.isFinite(value) ? value : fallback;
    };
    const eventName = params.get('event');
    const eventAge = Math.max(0, number('eventAge', 0.4));
    const state = { energy: number('energy', 0.35), pulse: number('pulse', 0), beat: 0 };
    let eventFired = false;
    let overlay = null;
    if (params.get('board') === '1') {
        overlay = document.createElement('div');
        overlay.style.cssText = [
            'position:fixed', 'top:50%', 'left:50%', 'transform:translate(-50%,-50%)',
            'width:min(29vh,270px)', 'height:min(58vh,540px)', 'background:rgba(8,6,3,.80)',
            'border:1px solid rgba(228,181,77,.38)', 'border-radius:18px', 'pointer-events:none', 'z-index:4',
        ].join(';');
        document.body.appendChild(overlay);
    }
    const resize = (width, height) => {
        const w = width || sizes.width;
        const h = height || sizes.height;
        world.resize(w, h);
        camera.aspect = w / Math.max(1, h);
        camera.updateProjectionMatrix();
        post?.setSize(w, h);
    };
    resize(sizes.width, sizes.height);
    const step = (time, dt) => {
        world.update(time, dt, state);
        post?.update({ time, bloomBoost: state.pulse * 0.28 });
    };
    const trigger = () => {
        if (!eventName) return;
        const position = new THREE.Vector3(number('lockX', 0), number('lockY', -420), 0);
        world.trigger(
            eventName,
            number('strength', eventName === 'combo' ? 1.9 : 1),
            eventName === 'lock' || params.has('lockY') ? position : null,
        );
    };
    return {
        cameraRadius: 1520,
        camera(time, cam) {
            cam.position.set(Math.sin(time * 0.025) * 12, Math.sin(time * 0.023) * 8, 1520);
            cam.lookAt(0, 0, 0);
        },
        update(time, dt) {
            if (!eventFired && eventName) {
                trigger();
                eventFired = true;
            }
            step(time, dt);
        },
        seek(time) {
            world.resetReactions();
            step(Math.max(0, time - eventAge), 0);
            trigger();
            eventFired = true;
            const steps = Math.max(1, Math.round(eventAge * 60));
            const dt = eventAge / steps;
            for (let i = 1; i <= steps; i += 1) step(time - eventAge + i * dt, dt);
            step(time, 0);
        },
        render() {
            if (post) post.render();
            else renderer.render(scene, camera);
        },
        getDiagnostics: () => world.diagnostics(),
        resize,
        dispose() {
            overlay?.remove();
            post?.dispose();
            world.dispose();
            camera.fov = saved.fov;
            camera.near = saved.near;
            camera.far = saved.far;
            scene.background = saved.background;
            camera.updateProjectionMatrix();
        },
    };
}

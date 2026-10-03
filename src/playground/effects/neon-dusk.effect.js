/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Neon Dusk — the full world + post stack, mounted in isolation.
 *
 * Mounts the SAME NeonDuskWorld and NeonDuskPost the theme ships, with the theme's lens, camera
 * rig and composition solver, so composition and grade are judged exactly as they will look in
 * game.
 *
 * URL params:
 *   quality=High|Ultra|...   content + post tier (default High)
 *   board=0                  no mock board (default: a mock gameplay board + HUD, the solo
 *                            layout rules from public/styles/main.css; the composition solver
 *                            reads its rect exactly as in game). board=0 → the centred menu shot
 *   hud=0                    board without the HUD mock
 *   event=lock|clear|combo|tetris|levelUp  fire a gameplay event...
 *   eventAge=<s>             ...and show it <s> seconds later (combo=<n>, lines=<n>, piece=<T..>)
 *   parts=sky,mountains,...  draw only these parts (sky mountains floor fx)
 *   noPost=1                 raw scene (no bloom/grade)
 *   reflect=<scale> blur=<mip> msaa=<n> chroma=0 bloom=0 dust=<n>   A/B overrides
 *   pointerX / pointerY      hold a pointer-parallax offset (-1..1)
 */
import * as THREE from 'three/webgpu';
import { RIG } from '../../themes/neon-dusk/neon-dusk-tsl.js';
import { NeonDuskWorld, readBoardRect } from '../../themes/neon-dusk/neon-dusk-world.js';
import { NeonDuskPost, POST_LOOK } from '../../themes/neon-dusk/neon-dusk-post.js';

export const meta = {
    id: 'neon-dusk',
    title: 'Neon Dusk (full world)',
    description: 'The shipping world + post: the great sun sinking into a neon mountain pass over a glass floor.',
};

function num(params, key, fallback = 0) {
    const v = Number.parseFloat(params.get(key));
    return Number.isFinite(v) ? v : fallback;
}

/**
 * A stand-in for the real solo layout (public/styles/main.css): the board is
 * min(clamp(220px, 22vw, 300px), (100vh − 250px)/2) wide and twice as tall, the HUD sits right
 * of it. The board carries the real selector so readBoardRect() finds it.
 */
function mountBoardOverlay(withHud) {
    const root = document.createElement('div');
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5';
    const board = document.createElement('div');
    board.className = 'player-card';
    board.dataset.player = 'solo';
    board.style.cssText = [
        'position:absolute', 'left:50%', 'top:50%',
        'width:calc(min(clamp(220px, 22vw, 300px), (100vh - 250px) / 2) + 24px)',
        'height:calc(2 * min(clamp(220px, 22vw, 300px), (100vh - 250px) / 2) + 24px)',
        'transform:translate(-50%, -50%)', 'background:rgba(21,26,35,0.866)',
        'border:1px solid rgba(139,92,246,0.45)', 'border-radius:20px',
    ].join(';');
    root.append(board);
    if (withHud) {
        const hud = document.createElement('div');
        hud.className = 'single-player-stats-bar';
        hud.style.cssText = [
            'position:absolute', 'top:25%', 'height:50%',
            'left:calc(50% + min(clamp(220px, 22vw, 300px), (100vh - 250px) / 2) / 2 + 60px)',
            'width:min(clamp(120px, 12vw, 160px), 18vh)',
            'background:rgba(14,11,26,0.8)', 'border:1px solid rgba(150,110,255,0.25)', 'border-radius:10px',
        ].join(';');
        root.append(hud);
    }
    document.body.appendChild(root);
    return root;
}

export function create({
    scene, camera, renderer, params, rng,
}) {
    const quality = params.get('quality') || 'High';
    const saved = {
        fov: camera.fov, near: camera.near, far: camera.far, up: camera.up.clone(),
    };
    camera.near = RIG.near;
    camera.far = RIG.far;
    camera.up.set(0, 1, 0);
    camera.updateProjectionMatrix();

    const overrides = {};
    if (params.has('reflect')) overrides.reflection = num(params, 'reflect', 0.5);
    if (params.has('dust')) overrides.dust = num(params, 'dust', 180);
    if (params.has('blur')) overrides.reflectionBlur = num(params, 'blur', 1.6);
    const world = new NeonDuskWorld({
        scene, quality, random: rng || Math.random, overrides,
    }).build();
    world.bindCamera(camera);
    const partsParam = params.get('parts');
    if (partsParam) world.showOnlyParts(partsParam.split(',').map((p) => p.trim()));

    const usePost = params.get('noPost') !== '1';
    const look = { ...(POST_LOOK[quality] || POST_LOOK.High) };
    if (params.has('chroma')) look.chroma = params.get('chroma') !== '0';
    if (params.has('msaa')) look.msaa = num(params, 'msaa', look.msaa);
    if (params.has('bloom')) look.bloom = params.get('bloom') !== '0';
    const post = usePost ? new NeonDuskPost(renderer, scene, camera, { look }) : null;
    const overlay = params.get('board') === '0' ? null : mountBoardOverlay(params.get('hud') !== '0');

    const pointerX = num(params, 'pointerX');
    const pointerY = num(params, 'pointerY');
    const eventName = params.get('event');
    const eventAge = num(params, 'eventAge', 0.4);
    const fireEvent = () => {
        if (eventName === 'lock') {
            world.onPieceLock({
                type: params.get('piece') || 'T', x: num(params, 'x', 2), rotation: num(params, 'rot', 0),
            });
        } else if (eventName === 'combo') world.onCombo(num(params, 'combo', 4));
        else if (eventName === 'clear') world.onLineClear(num(params, 'lines', 2));
        else if (eventName === 'tetris') world.onLineClear(4);
        else if (eventName === 'levelUp') world.onLevelUp();
    };

    const size = new THREE.Vector2();
    const syncViewport = () => {
        const aspect = window.innerWidth / Math.max(1, window.innerHeight);
        world.setLayout(aspect, overlay ? readBoardRect() : null, { immediate: true });
        camera.fov = world.lens.vfov;
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
        renderer.getDrawingBufferSize(size);
        post?.setSize(window.innerWidth, window.innerHeight, size.x, size.y);
    };
    syncViewport();

    const sim = (time, delta) => ({
        time, delta, pointerX, pointerY,
    });
    const pushPost = (time) => {
        if (!post) return;
        post.update({ time, bloomBoost: Math.min(1, world.sunPulse), glitch: world.glitch });
    };
    const step = (time, dt) => {
        world.updateCamera(camera, sim(time, dt));
        world.update(sim(time, dt));
        pushPost(time);
    };
    // Seek: rebuild the event state at (t − age) so every capture of `t` is identical.
    const seekTo = (time) => {
        const t0 = Math.max(0, time - (eventName ? eventAge : 0));
        world.seek(t0);
        step(t0, 0);
        if (eventName) {
            fireEvent();
            const steps = Math.max(1, Math.round(eventAge * 60));
            const dt = eventAge / steps;
            for (let i = 1; i <= steps; i += 1) step(t0 + i * dt, dt);
        }
        step(time, 0);
    };

    return {
        cameraRadius: 1,
        camera(time, cam) {
            world.updateCamera(cam, sim(time, 0));
        },
        update(time, dt) {
            step(time, dt);
        },
        seek(time) {
            seekTo(time);
        },
        render() {
            if (post) post.render();
            else renderer.render(scene, camera);
        },
        resize() {
            syncViewport();
        },
        dispose() {
            overlay?.remove();
            post?.dispose();
            world.dispose();
            camera.layers.set(0);
            camera.fov = saved.fov;
            camera.near = saved.near;
            camera.far = saved.far;
            camera.up.copy(saved.up);
            camera.updateProjectionMatrix();
        },
    };
}

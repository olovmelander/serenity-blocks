/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Chromadelic Highway — the full world + post stack, mounted in isolation.
 *
 * Mounts the SAME ChromadelicWorld and ChromadelicHighwayPost the theme ships, with the theme's
 * camera rig and composition solver, so composition and grade are judged exactly as they will
 * look in game.
 *
 * URL params:
 *   quality=High|Ultra|...   content tier (default High)
 *   board=1                  overlay a mock gameplay board + HUD (the solo layout at 1080p rules);
 *                            the composition solver and the post's board veil read its rects
 *   hud=0                    with board=1: board only, no HUD mock
 *   pulse / ring / particle / ambient = 0..1   hold a reactive state
 *   event=lock|combo|clear|tetris|levelUp  fire a gameplay event...
 *   eventAge=<s>             ...and show it <s> seconds later (combo=<n>, lines=<n>, level=<n>)
 *   parts=sky,stars,...      draw only these parts (sky stars planets road rails rings streaks
 *                            motes meteors) for isolated iteration
 *   falseColor=1             post debug view: band the pre-tone-map max channel
 *   msaa=0|4                 override the scene-pass MSAA sample count
 *   noPost=1                 raw scene (no bloom/grade)
 *   place=<p>                pin the spectrum's level place (movement = floor; the road's drift,
 *                            t · 180 / 16200, still adds): 0 prism, 1 orchid, 2 ember, 3 triad,
 *                            4 chord, 5 tide
 *   ringForm=<name>          force every ring's form (tube double dashes beads hex hexDouble oct
 *                            octDashes octBeads prism hexPrism)
 *   airGain=<x>              the ring-air band gain (default 0.05)
 *   icon=1                   the theme-icon framing: the lens looks straight down the road at the
 *                            arches' vanishing point, closed to iconFov (default 40; iconYaw and
 *                            iconPitch in radians turn it). Compose for a small circle: capture a
 *                            square frame. window.__chromadelic.iconLens = { fov, yaw, pitch }
 *                            overrides them live for a contact sheet.
 */
import * as THREE from 'three/webgpu';
import { CAMERA_RIG, ChromadelicWorld } from '../../themes/chromadelic-highway/chromadelic-highway-world.js';
import { ChromadelicHighwayPost, POST_LOOK } from '../../themes/chromadelic-highway/chromadelic-highway-post.js';
import { readLayoutRects, restVerticalFov } from '../../themes/chromadelic-highway/chromadelic-highway-composition.js';

export const meta = {
    id: 'chromadelic-highway',
    title: 'Chromadelic Highway (full world)',
    description: 'The shipping world + post: rainbow road, neon arches, impostor planets, nebula sky.',
};

function num(params, key, fallback = 0) {
    const v = Number.parseFloat(params.get(key));
    return Number.isFinite(v) ? v : fallback;
}

/**
 * A stand-in for the real solo layout (public/styles/main.css): the board is
 * min(clamp(220px, 22vw, 300px), (100vh − 250px)/2) wide and twice as tall, the HUD sits right
 * of it. The elements carry the real class names so readLayoutRects() finds them.
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
    const world = new ChromadelicWorld({
        scene, quality, random: rng || Math.random, textureBase: './textures/', capture: true,
    }).build();

    const partsParam = params.get('parts');
    if (partsParam) world.showOnlyParts(partsParam.split(',').map((p) => p.trim()));
    const placeParam = params.get('place');
    const formParam = params.get('ringForm');
    if (placeParam !== null || formParam) {
        world.pinSpectrum(placeParam !== null ? num(params, 'place', 0) : null, { form: formParam || null });
    }
    if (params.get('airGain') !== null) world.shared.uAirGain.value = num(params, 'airGain', 0.05);
    // Agent probes: the live world (uniforms, events) without a reload.
    window.__chromadelic = { world };

    camera.near = 1;
    camera.far = 12000;

    const usePost = params.get('noPost') !== '1';
    // Same per-tier look as the shipping theme (POST_LOOK), so what is judged here is what ships.
    const look = POST_LOOK[quality] || POST_LOOK.High;
    const msaaParam = params.get('msaa');
    const post = usePost ? new ChromadelicHighwayPost(renderer, scene, camera, {
        look,
        samples: msaaParam !== null && Number.isFinite(Number(msaaParam)) ? Number(msaaParam) : look.msaa,
        aspect: window.innerWidth / Math.max(1, window.innerHeight),
        grain: false,
        falseColor: params.get('falseColor') === '1',
    }) : null;
    const overlay = params.get('board') === '1' ? mountBoardOverlay(params.get('hud') !== '0') : null;

    const held = {
        pulse: num(params, 'pulse'),
        ring: num(params, 'ring'),
        particle: num(params, 'particle'),
        ambient: num(params, 'ambient'),
    };
    const urlEvent = {
        name: params.get('event'),
        age: num(params, 'eventAge', 0.25),
        combo: num(params, 'combo', 4),
        lines: num(params, 'lines', 2),
        level: num(params, 'level', 2),
    };
    let ev = urlEvent;
    const fireEvent = () => {
        if (ev.name === 'lock') world.onPieceLock();
        else if (ev.name === 'combo') world.onCombo(ev.combo);
        else if (ev.name === 'clear') world.onLineClear(ev.lines);
        else if (ev.name === 'tetris') world.onLineClear(4);
        else if (ev.name === 'levelUp') world.onLevelUp(ev.level);
    };

    const size = new THREE.Vector2();
    const syncViewport = () => {
        const aspect = window.innerWidth / Math.max(1, window.innerHeight);
        camera.aspect = aspect;
        camera.fov = restVerticalFov(aspect);
        camera.updateProjectionMatrix();
        renderer.getDrawingBufferSize(size);
        world.setViewport(size.y, camera, size.x, window.innerHeight);
        const res = world.setLayout(aspect, readLayoutRects(), { width: window.innerWidth, height: window.innerHeight });
        post?.setSize(window.innerWidth, window.innerHeight, size.x, size.y);
        post?.setLayout(res.veil.board, res.veil.hud, 1);
    };
    syncViewport();

    const sim = (time, delta) => ({
        time, delta, pace: 1, ...held,
    });
    const pushPost = (time) => post?.update({ time, dip: world.fx.dip, bloomBoost: 0 });
    // The icon lens (icon=1), applied after the rig has placed the camera: straight down the road
    // at the rest focus (the arches' vanishing point), closed to iconFov, the breath and the bank
    // undone. The world sizes its pixel-scale uniforms from the lens, so they follow it.
    const iconLens = params.get('icon') === '1';
    const aimIcon = () => {
        if (!iconLens) return;
        const live = window.__chromadelic?.iconLens || {};
        camera.fov = Number.isFinite(live.fov) ? live.fov : num(params, 'iconFov', 40);
        camera.updateProjectionMatrix();
        camera.up.set(0, 1, 0);
        camera.lookAt(CAMERA_RIG.lookAt);
        camera.rotateY(Number.isFinite(live.yaw) ? live.yaw : num(params, 'iconYaw', 0));
        camera.rotateX(Number.isFinite(live.pitch) ? live.pitch : num(params, 'iconPitch', 0));
        camera.updateMatrixWorld();
        world.setViewport(size.y, camera, size.x, window.innerHeight);
    };
    // Seek: rebuild the event state at (t - age) so every capture of `t` is identical.
    const seekTo = (time) => {
        const eventName = ev.name;
        const eventAge = ev.age;
        // A replayed level-up must not carry its step into the next seek.
        world.resetProgress();
        world.seek(Math.max(0, time - (eventName ? eventAge : 0)));
        if (eventName) {
            fireEvent();
            // Step the closed-form clocks forward through the event (no randomness involved).
            const steps = Math.max(1, Math.round(eventAge * 60));
            const t0 = world.time;
            const dt = eventAge / steps;
            for (let i = 1; i <= steps; i++) {
                const st = t0 + i * dt;
                world.updateCamera(camera, sim(st, dt));
                aimIcon();
                world.update(sim(st, dt), camera);
            }
        }
        world.updateCamera(camera, sim(time, 0));
        aimIcon();
        world.update(sim(time, 0), camera);
        pushPost(time);
    };
    // Agent probes: replay any event at any age for a contact sheet, rendered in the same task
    // (`spec` = { name, age, combo, lines, level }; null = the URL's event). Returns the canvas.
    window.__chromadelic.seekEvent = (time, spec = null) => {
        ev = spec ? { ...urlEvent, ...spec } : urlEvent;
        seekTo(time);
        if (post) post.render();
        else renderer.render(scene, camera);
        return renderer.domElement;
    };

    return {
        cameraRadius: 1,
        camera(time, cam) {
            world.updateCamera(cam, { time, delta: 0 });
        },
        update(time, dt) {
            world.updateCamera(camera, sim(time, dt));
            aimIcon();
            world.update(sim(time, dt), camera);
            pushPost(time);
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
        getDiagnostics() {
            return { time: world.time, spectrum: world.getSpectrumDiagnostics() };
        },
        dispose() {
            if (window.__chromadelic?.world === world) delete window.__chromadelic;
            overlay?.remove();
            post?.dispose();
            world.dispose();
            camera.fov = saved.fov;
            camera.near = saved.near;
            camera.far = saved.far;
            camera.up.copy(saved.up);
            camera.updateProjectionMatrix();
        },
    };
}

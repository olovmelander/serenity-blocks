/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * First Light — the world behind the opening, the title and the main menu, mounted in isolation.
 *
 * Mounts the SAME IntroWorld and IntroWorldPost the intro renderer ships, with its camera rig,
 * so the opening, the title and the menu are judged exactly as the game shows them.
 *
 * URL params:
 *   phase=boot|open|title|menu   boot = the frame under the loading screen (no opening yet);
 *                                open = during the opening (opening=<seconds since it began>);
 *                                title (default) = the settled title; menu = behind the menu
 *   opening=<s>                  with phase=open: seconds since the opening began
 *   menu=<0..1>                  hold the title→menu blend
 *   begin=<s>                    seconds since the player began (the begin wave)
 *   quality=High|Medium|Low      content tier (default High)
 *   title=0                      hide the mock wordmark (shown by default)
 *   ui=1                         with phase=menu: overlay a mock of the menu (navigation, card)
 *   mode=<id>                    with phase=menu: the current mode (single, odyssey, ...)
 *   row=<0..7>                   with phase=menu: the current row, from the top of the list
 *   px=-1..1&py=-1..1            hold a pointer-parallax offset
 *   noPost=1                     raw scene (no bloom/grade)
 *   reduce=1                     reduced motion
 */
import * as THREE from 'three/webgpu';
import { IntroWorld, WORLD_TIERS } from '../../ui/intro-world/intro-world.js';
import { IntroWorldPost, POST_LOOK, WAVES_MAX } from '../../ui/intro-world/intro-world-post.js';

export const meta = {
    id: 'intro-world',
    title: 'First Light (opening + menu world)',
    description: 'The world behind the opening and the main menu: silk light, murmurations of light, the breath.',
};

function num(params, key, fallback = 0) {
    const v = Number.parseFloat(params.get(key));
    return Number.isFinite(v) ? v : fallback;
}

/** The wordmark where the intro puts it (public/styles/intro-animation.css). */
function mountTitle() {
    const root = document.createElement('div');
    root.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;'
        + 'pointer-events:none;z-index:5;flex-direction:column';
    const img = document.createElement('img');
    img.src = './assets/branding/serenity-blocks-logo.svg';
    img.style.cssText = 'width:min(520px,70vw,80svh);height:auto;display:block';
    const tag = document.createElement('div');
    tag.textContent = 'Stack · Breathe · Ascend';
    tag.style.cssText = 'margin-top:26px;color:#c8d6e6;font:10px "Space Mono",monospace;'
        + 'letter-spacing:.32em;text-transform:uppercase';
    root.append(img, tag);
    document.body.appendChild(root);
    return { root, img };
}

/** A stand-in for the main menu (the real layout's rects at 1707 x 1067). */
function mountMenu() {
    const root = document.createElement('div');
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5';
    const box = (x0, y0, x1, y1, css) => {
        const el = document.createElement('div');
        el.style.cssText = `position:absolute;left:${x0 * 100}%;top:${y0 * 100}%;width:${(x1 - x0) * 100}%;`
            + `height:${(y1 - y0) * 100}%;${css}`;
        root.appendChild(el);
        return el;
    };
    const logo = document.createElement('img');
    logo.src = './assets/branding/serenity-blocks-logo.svg';
    logo.style.cssText = 'position:absolute;left:5%;top:4.4%;width:min(265px,17vw)';
    root.appendChild(logo);
    box(0.05, 0.289, 0.272, 0.787, 'border-radius:14px;background:rgba(10,12,30,0.18)');
    box(0.413, 0.185, 0.87, 0.82, 'border-radius:28px;background:linear-gradient(180deg,'
        + 'rgba(27,23,60,0.88),rgba(12,10,30,0.93));border:1px solid rgba(255,246,233,0.1)');
    box(0.05, 0.918, 0.95, 0.972, 'border-radius:8px;background:rgba(255,246,233,0.03)');
    document.body.appendChild(root);
    return root;
}

export const MENU_RECTS = Object.freeze({
    nav: {
        x0: 0.0418, y0: 0.2758, x1: 0.2808, y1: 0.8006,
    },
    brand: {
        x0: 0.0418, y0: 0.0328, x1: 0.2808, y1: 0.1715,
    },
    stage: {
        x0: 0.4129, y0: 0.1842, x1: 0.8699, y1: 0.8196,
    },
    dock: {
        x0: 0.05, y0: 0.9178, x1: 0.9502, y1: 0.9722,
    },
});

/** The list's rows, top to bottom (their centres, screen fractions, at 1707 x 1067). */
const MENU_ROWS = [0.3533, 0.398, 0.443, 0.488, 0.533, 0.6131, 0.658, 0.7385];

/** The menu's layout as the intro measures it, for the current row. */
function menuLayout(params) {
    const y = MENU_ROWS[Math.max(0, Math.min(MENU_ROWS.length - 1, Math.round(num(params, 'row', 0))))];
    return {
        ...MENU_RECTS,
        row: {
            x0: 0.05, y0: y - 0.022, x1: 0.272, y1: y + 0.022,
        },
        mode: params.get('mode') || 'single',
        calm: [
            { ...MENU_RECTS.nav, level: 0.9 },
            { ...MENU_RECTS.stage, level: 0.8 },
            { ...MENU_RECTS.dock, level: 0.6 },
            { ...MENU_RECTS.brand, level: 0.7 },
        ],
    };
}

export function create({
    scene, camera, renderer, params,
}) {
    const quality = WORLD_TIERS[params.get('quality')] ? params.get('quality') : 'High';
    const saved = {
        fov: camera.fov, near: camera.near, far: camera.far, toneMapping: renderer.toneMapping,
    };
    renderer.toneMapping = THREE.NoToneMapping;
    const world = new IntroWorld({ quality }).build(scene);
    world.bindCamera(camera);
    world.setReducedMotion(params.get('reduce') === '1', true);
    world.setPointer(num(params, 'px'), num(params, 'py'));

    const phase = params.get('phase') || 'title';
    const menuHold = phase === 'menu' ? num(params, 'menu', 1) : num(params, 'menu', 0);
    const showTitle = params.get('title') !== '0' && phase !== 'menu' && phase !== 'boot';
    const title = showTitle ? mountTitle() : null;
    const ui = phase === 'menu' && params.get('ui') === '1' ? mountMenu() : null;
    if (phase === 'menu') world.setMenuLayout(menuLayout(params));

    const noPost = params.get('noPost') === '1';
    const post = noPost ? null : new IntroWorldPost(renderer, scene, camera, {
        look: POST_LOOK[WORLD_TIERS[quality].post],
    });

    const size = new THREE.Vector2(1, 1);
    const syncViewport = () => {
        renderer.getDrawingBufferSize(size);
        world.setViewport(window.innerWidth, window.innerHeight);
        post?.setSize(window.innerWidth, window.innerHeight, size.x, size.y);
        const r = title?.img.getBoundingClientRect();
        world.setTitleRect(r ? {
            x: r.left, y: r.top, width: r.width, height: r.height,
        } : null);
    };
    syncViewport();

    const pushPost = () => {
        if (!post) return;
        const s = world.getPostState();
        post.update(s);
        for (let i = 0; i < WAVES_MAX; i++) {
            const w = s.waves[i];
            post.setWave(i, w?.x ?? 0.5, w?.y ?? 0.5, w?.radius ?? 0, w?.strength ?? 0);
        }
        post.setCalmRects(s.calm);
    };

    const openingAt = num(params, 'opening', 2);
    const autoOpen = params.has('autoOpen') ? num(params, 'autoOpen', 2) : null;
    const beginAt = params.has('begin') ? num(params, 'begin', 0.4) : null;
    const seekTo = (time) => {
        let opening;
        if (phase === 'boot') opening = null;
        else if (phase === 'open') opening = Math.min(openingAt, time);
        else opening = 60;
        world.seek(time, { opening, menu: menuHold });
        if (beginAt !== null) {
            world.time = time - beginAt;
            world.pulseBegin();
            world.seek(time, { opening, menu: menuHold });
            world.beginWave.at = time - beginAt;
        }
        pushPost();
    };
    // The wordmark has no size until its image arrives.
    title?.img.addEventListener('load', () => {
        syncViewport();
        seekTo(world.time);
    });
    // A live run starts where the phase says.
    seekTo(phase === 'open' ? openingAt : 0);
    if (phase === 'open') {
        world.opening = { at: world.time - openingAt, seconds: world.opening?.seconds ?? 5.2 };
    }

    return {
        cameraRadius: 1,
        camera() {
            world.updateCamera();
        },
        update(time, dt) {
            // Live: watch the opening begin after `autoOpen` seconds on the boot frame.
            if (autoOpen !== null && !world.opened && world.time >= autoOpen) world.beginOpening();
            world.update(dt);
            pushPost();
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
            return {
                backend: renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2',
                calls: renderer.info?.render?.calls ?? null,
                triangles: renderer.info?.render?.triangles ?? null,
                ...world.getState(),
            };
        },
        dispose() {
            title?.root.remove();
            ui?.remove();
            post?.dispose();
            world.dispose();
            renderer.toneMapping = saved.toneMapping;
            camera.fov = saved.fov;
            camera.near = saved.near;
            camera.far = saved.far;
            camera.updateProjectionMatrix();
        },
    };
}

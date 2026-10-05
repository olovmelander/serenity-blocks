/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Astral Weave — the full world + post stack, mounted in isolation.
 *
 * Mounts the SAME AstralWeaveWorld and AstralWeavePost the theme ships, with the theme's camera
 * rig, so composition and grade are judged exactly as they will look in game.
 *
 * URL params:
 *   quality=High|Ultra|...   content tier (default High)
 *   board=1                  overlay a mock gameplay board + HUD (the solo layout rules); the loom
 *                            seats itself on its rects and the post's calm zones read them
 *   statsHud=0               with board=1: board only, no HUD mock
 *   stack=<n>                lay n rows of weft before the event (a stack n rows high)
 *   combo=<n>                hold a combo of n (the rosette's petals and its temperature)
 *   level=<n>                rest on level n's figure
 *   event=lock|drop|clear|tetris|tspin|perfect|levelUp   fire a gameplay event...
 *   eventAge=<s>             ...and show it <s> seconds later (lines=<n>, row=<r>, u=<0..1>)
 *   demo=1                   live only: play a looping gameplay script
 *   parts=sky,rosette,...    draw only these parts
 *   falseColor=1             post debug view: band the pre-tone-map max channel
 *   noPost=1                 raw scene (no bloom/grade)
 *   bloom=0|1                override the tier's bloom
 *   px=-1..1&py=-1..1        hold a pointer-parallax offset
 */
import * as THREE from 'three/webgpu';
import { AstralWeaveWorld } from '../../themes/astral-weave/astral-weave-world.js';
import { AstralWeavePost, POST_LOOK } from '../../themes/astral-weave/astral-weave-post.js';
import { REST_RIG, readLayoutRects } from '../../themes/astral-weave/astral-weave-composition.js';

export const meta = {
    id: 'astral-weave',
    title: 'Astral Weave (full world)',
    description: 'The Loom of Heaven: a string-art weave on a great hoop, shuttles, wefts and the crown star.',
};

function num(params, key, fallback = 0) {
    const v = Number.parseFloat(params.get(key));
    return Number.isFinite(v) ? v : fallback;
}

const BOARD_PX = 'min(clamp(220px, 22vw, 300px), (100vh - 250px) / 2)';

/** A stand-in for the real solo layout (public/styles/main.css) with the real class names. */
function mountBoardOverlay(withHud) {
    const root = document.createElement('div');
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5';
    const card = document.createElement('div');
    card.className = 'player-card';
    card.dataset.player = 'solo';
    card.style.cssText = [
        'position:absolute', 'left:50%', 'top:50%',
        `width:calc(${BOARD_PX} * 1.19)`,
        `height:calc(2 * ${BOARD_PX} + 158px)`,
        'transform:translate(-50%, -50%)', 'background:rgba(21,26,35,0.866)',
        'border:1px solid rgba(139,92,246,0.45)', 'border-radius:20px',
    ].join(';');
    const board = document.createElement('div');
    board.id = 'single-player-game-canvas';
    board.style.cssText = [
        'position:absolute', 'left:50%', 'bottom:24px', `width:calc(${BOARD_PX})`, `height:calc(2 * ${BOARD_PX})`,
        'transform:translateX(-50%)', 'border:1px solid rgba(255,255,255,0.08)',
    ].join(';');
    // A canvas child, so the real selector (`… canvas`, or the id itself) finds a rect either way.
    card.append(board);
    root.append(card);
    if (withHud) {
        const hud = document.createElement('div');
        hud.className = 'single-player-stats-bar';
        hud.style.cssText = [
            'position:absolute', 'top:25%', 'height:50%',
            'left:calc(50% + min(max(300px, min(35vw, 400px)), (100vh - 200px) / 2) / 2 + 60px)',
            'width:140px',
            'background:rgba(14,11,26,0.8)', 'border:1px solid rgba(150,110,255,0.25)', 'border-radius:10px',
        ].join(';');
        root.append(hud);
    }
    document.body.appendChild(root);
    return root;
}

/** A looping script of locks and clears for the live demo (seconds into the loop). */
const DEMO_LOOP = 26;
const DEMO_SCRIPT = [
    [0.6, 'lock', { rows: [19], u: 0.2 }], [1.5, 'lock', { rows: [19, 18], u: 0.75 }],
    [2.4, 'lock', { rows: [18, 17], u: 0.4, hardDrop: true }], [3.3, 'lock', { rows: [19], u: 0.55 }],
    [3.3, 'clear', { rows: [19], combo: 1 }], [4.3, 'lock', { rows: [19, 18], u: 0.3 }],
    [4.3, 'clear', { rows: [19], combo: 2 }], [5.4, 'lock', { rows: [19, 18, 17], u: 0.8, hardDrop: true }],
    [5.4, 'clear', { rows: [19, 18], combo: 3 }], [6.6, 'lock', { rows: [19], u: 0.1 }],
    [6.6, 'clear', { rows: [19], combo: 4 }], [7.8, 'lock', { rows: [19, 18], u: 0.6 }],
    [7.8, 'clear', { rows: [19], combo: 5 }], [9.2, 'lock', { rows: [19], u: 0.5 }],
    [10.2, 'lock', { rows: [19, 18], u: 0.15 }], [11.1, 'lock', { rows: [18, 17], u: 0.85 }],
    [12.0, 'lock', { rows: [17, 16], u: 0.35 }], [12.9, 'lock', { rows: [16, 15], u: 0.6, hardDrop: true }],
    [13.8, 'lock', { rows: [19, 18, 17, 16], u: 0.95, hardDrop: true }],
    [13.8, 'clear', { rows: [19, 18, 17, 16], lines: 4, combo: 1 }],
    [19.5, 'lock', { rows: [19], u: 0.45 }], [20.4, 'lock', { rows: [19, 18], u: 0.7 }],
    [21.3, 'lock', { rows: [18], u: 0.25, hardDrop: true }], [21.3, 'clear', { rows: [19], tspin: true, combo: 1 }],
    [23.0, 'lock', { rows: [19], u: 0.5 }],
];

export function create({
    scene, camera, renderer, params,
}) {
    const quality = params.get('quality') || 'High';
    const saved = {
        fov: camera.fov, near: camera.near, far: camera.far,
    };
    const world = new AstralWeaveWorld({
        scene, quality, capture: true, renderer,
    }).build();
    world.prepareCompute();
    const partsParam = params.get('parts');
    if (partsParam) world.showOnlyParts(partsParam.split(',').map((p) => p.trim()));

    camera.fov = REST_RIG.fov;
    camera.near = REST_RIG.near;
    camera.far = REST_RIG.far;

    const look = { ...(POST_LOOK[quality] || POST_LOOK.High) };
    if (params.has('bloom')) look.bloom = params.get('bloom') === '1';
    const post = params.get('noPost') === '1' ? null : new AstralWeavePost(renderer, scene, camera, {
        look,
        falseColor: params.get('falseColor') === '1',
    });
    const overlay = params.get('board') === '1' ? mountBoardOverlay(params.get('statsHud') !== '0') : null;

    const pointer = { x: num(params, 'px'), y: num(params, 'py') };
    const size = new THREE.Vector2(1, 1);
    const syncViewport = () => {
        const aspect = window.innerWidth / Math.max(1, window.innerHeight);
        camera.aspect = aspect;
        camera.fov = REST_RIG.fov;
        camera.updateProjectionMatrix();
        renderer.getDrawingBufferSize(size);
        world.setViewport(size.x, size.y, aspect);
        post?.setSize(window.innerWidth, window.innerHeight, size.x, size.y);
        const rects = overlay ? readLayoutRects() : null;
        world.setLayout(rects, aspect);
        post?.setCalmRects(rects ? [...rects.cards, rects.hud].filter(Boolean) : [], rects ? 1 : 0);
    };
    syncViewport();

    const sim = (time, delta) => ({
        time, delta, pointerX: pointer.x, pointerY: pointer.y,
    });
    const pushPost = () => {
        post?.update({ heart: world.getHeartScreen(), flash: world.flash, kick: world.kick });
    };
    const stepTo = (from, to, dt) => {
        const steps = Math.max(1, Math.round((to - from) / dt));
        const h = (to - from) / steps;
        for (let i = 1; i <= steps; i++) world.update(sim(from + i * h, h));
    };

    const eventName = params.get('event');
    const eventAge = num(params, 'eventAge', 0.5);
    const stack = Math.max(0, Math.min(20, Math.round(num(params, 'stack', 0))));
    const holdCombo = Math.max(0, Math.round(num(params, 'combo', 0)));
    const level = Math.max(1, Math.round(num(params, 'level', 1)));
    const fireEvent = () => {
        const row = Math.round(num(params, 'row', 19 - stack));
        const u = num(params, 'u', 0.3);
        const lines = Math.max(1, Math.min(4, Math.round(num(params, 'lines', 2))));
        const bottom = (n) => Array.from({ length: n }, (_, i) => 19 - i);
        if (eventName === 'lock') world.lock({ rows: [row, row - 1], u });
        else if (eventName === 'drop') world.lock({ rows: [row, row - 1], u, hardDrop: true });
        else if (eventName === 'clear') world.clear({ rows: bottom(lines), lines, combo: Math.max(1, holdCombo) });
        else if (eventName === 'tetris') world.clear({ rows: bottom(4), lines: 4, combo: Math.max(1, holdCombo) });
        else if (eventName === 'tspin') {
            world.clear({
                rows: bottom(2), lines: 2, tspin: true, combo: Math.max(1, holdCombo),
            });
        } else if (eventName === 'perfect') {
            world.clear({
                rows: bottom(4), lines: 4, perfect: true, combo: Math.max(1, holdCombo),
            });
        } else if (eventName === 'levelUp') world.levelUp(num(params, 'eventLevel', level + 1));
    };

    const seekTo = (time) => {
        const lead = (eventName ? eventAge : 0) + 14;
        const start = Math.max(0, time - lead);
        world.seek(start);
        if (level > 1) world.levelUp(level);
        for (let i = 0; i < stack; i++) world.lock({ rows: [19 - i], u: 0.15 + ((i * 0.37) % 0.7) });
        if (holdCombo > 0) world.setCombo(holdCombo);
        world.update(sim(start, 0));
        const eventTime = eventName ? time - eventAge : time;
        if (eventTime > start) stepTo(start, eventTime, 0.1);
        if (eventName) {
            fireEvent();
            stepTo(eventTime, time, 1 / 120);
        }
        world.updateCamera(camera, sim(time, 0));
        world.update(sim(time, 0));
        pushPost();
    };

    const demo = params.get('demo') === '1';
    let demoCursor = 0;
    let demoLoop = -1;
    const runDemo = (time) => {
        const loop = Math.floor(time / DEMO_LOOP);
        if (loop !== demoLoop) {
            demoLoop = loop;
            demoCursor = 0;
            world.resetSession();
        }
        const local = time - loop * DEMO_LOOP;
        while (demoCursor < DEMO_SCRIPT.length && DEMO_SCRIPT[demoCursor][0] <= local) {
            const [, verb, detail] = DEMO_SCRIPT[demoCursor];
            if (verb === 'lock') world.lock(detail);
            else world.clear(detail);
            demoCursor += 1;
        }
        // A chain that is not continued breaks on the next lock that clears nothing.
        if (local > 9 && local < 13.8 && world.combo > 0) world.setCombo(0);
        if (local > 23 && world.combo > 0) world.setCombo(0);
    };

    return {
        cameraRadius: 1,
        camera(time, cam) {
            world.updateCamera(cam, sim(time, 0));
        },
        update(time, dt) {
            if (demo) runDemo(time);
            world.updateCamera(camera, sim(time, dt));
            world.update(sim(time, dt));
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
                quality,
                backend: renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2',
                ...world.getState(),
            };
        },
        dispose() {
            overlay?.remove();
            post?.dispose();
            world.dispose();
            camera.fov = saved.fov;
            camera.near = saved.near;
            camera.far = saved.far;
            camera.updateProjectionMatrix();
        },
    };
}

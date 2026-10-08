/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Chromatic Impasto — the full world + post stack, mounted in isolation.
 *
 * Mounts the SAME ChromaticImpastoWorld and ChromaticImpastoPost the theme ships, with the theme's
 * camera rig, so composition and grade are judged exactly as they will look in game.
 *
 * URL params:
 *   quality=High|Ultra|...   content tier (default High)
 *   board=1                  overlay a mock gameplay board + HUD (the solo layout rules); events
 *                            aim at its rects and the post's calm zones read them
 *   statsHud=0               with board=1: board only, no HUD mock
 *   combo=<n>                hold a combo of n for comboHold seconds (default 3) before the shot
 *   level=<n>                rest on level n's period
 *   locks=<n>                before anything else, play n locks (the canvas holding their paint)
 *   event=lock|drop|clear|quad|tspin|perfect|levelUp|fresh   fire a gameplay event...
 *   eventAge=<s>             ...and show it <s> seconds later (lines=<n>, row=<r>, u=<0..1>,
 *                            color=<hex>)
 *   demo=1                   live only: play a looping gameplay script
 *   parts=canvas,droplets,...   draw only these parts
 *   falseColor=1             post debug view: band the pre-tone-map max channel
 *   noPost=1                 raw scene (no bloom/grade)
 *   bloom=0|1                override the tier's bloom
 *   px=-1..1&py=-1..1        hold a pointer-parallax offset
 *   reduce=1                 reduced motion
 *   seed=<n>                 another painting
 *   icon=1                   the theme-icon framing: a closer look at the paint round the board
 *                            (iconX, iconY, iconZoom; capture a square frame)
 */
import * as THREE from 'three/webgpu';
import { ChromaticImpastoWorld } from '../../themes/chromatic-impasto/chromatic-impasto-world.js';
import { ChromaticImpastoPost, POST_LOOK } from '../../themes/chromatic-impasto/chromatic-impasto-post.js';
import { readLayoutRects } from '../../themes/chromatic-impasto/chromatic-impasto-composition.js';
import { CHROMATIC_IMPASTO_TETROMINOS } from '../../themes/chromatic-impasto/chromatic-impasto-tetrominos.js';

export const meta = {
    id: 'chromatic-impasto',
    title: 'Chromatic Impasto (full world)',
    description: 'A canvas in thick oil under a raking lamp; the board is the brush.',
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

/** The game's piece colours (chromatic-impasto-tetrominos.js). */
const PIECE_COLORS = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'].map((k) => CHROMATIC_IMPASTO_TETROMINOS.colors[k]);

/** A looping script of locks and clears for the live demo (seconds into the loop). */
const DEMO_LOOP = 36;
const DEMO_SCRIPT = [
    [5.0, 'lock', { rows: [19], u: 0.2 }], [6.0, 'lock', { rows: [19, 18], u: 0.75 }],
    [7.0, 'lock', { rows: [18, 17], u: 0.4, hardDrop: true }], [8.0, 'lock', { rows: [17], u: 0.85 }],
    [9.0, 'lock', { rows: [19], u: 0.55 }],
    [9.0, 'clear', { rows: [19], lines: 1, combo: 1 }], [10.2, 'lock', { rows: [19, 18], u: 0.3 }],
    [10.2, 'clear', { rows: [19], lines: 1, combo: 2 }], [11.4, 'lock', { rows: [19, 18, 17], u: 0.8, hardDrop: true }],
    [11.4, 'clear', { rows: [19, 18], lines: 2, combo: 3 }], [12.6, 'lock', { rows: [19], u: 0.1 }],
    [12.6, 'clear', { rows: [19], lines: 1, combo: 4 }], [13.8, 'lock', { rows: [19, 18], u: 0.6 }],
    [13.8, 'clear', { rows: [19, 18, 17], lines: 3, combo: 5 }], [15.2, 'lock', { rows: [19], u: 0.5 }],
    [16.2, 'lock', { rows: [19, 18], u: 0.15 }], [17.2, 'lock', { rows: [18, 17], u: 0.85 }],
    [18.2, 'lock', { rows: [17, 16], u: 0.35 }], [19.2, 'lock', { rows: [16, 15], u: 0.6, hardDrop: true }],
    [20.2, 'lock', { rows: [15, 14], u: 0.9 }], [21.2, 'lock', { rows: [14, 13], u: 0.05 }],
    [22.2, 'lock', { rows: [19, 18, 17, 16], u: 0.95, hardDrop: true }],
    [22.2, 'clear', { rows: [19, 18, 17, 16], lines: 4, combo: 1 }],
    [28.0, 'lock', { rows: [19], u: 0.45 }], [29.0, 'lock', { rows: [19, 18], u: 0.7 }],
    [30.0, 'lock', { rows: [18], u: 0.25, hardDrop: true }],
    [30.0, 'clear', {
        rows: [19, 18], lines: 2, tspin: true, combo: 1,
    }],
    [32.0, 'lock', { rows: [19], u: 0.5 }],
];

export function create({
    scene, camera, renderer, params,
}) {
    const quality = params.get('quality') || 'High';
    const saved = {
        fov: camera.fov, near: camera.near, far: camera.far, toneMapping: renderer.toneMapping,
    };
    const world = new ChromaticImpastoWorld({
        scene, quality, capture: true, renderer, seed: Math.max(1, Math.round(num(params, 'seed', 1))),
    }).build();
    world.bindCamera(camera);
    world.setReducedMotion(params.get('reduce') === '1');
    const partsParam = params.get('parts');
    if (partsParam) world.showOnlyParts(partsParam.split(',').map((p) => p.trim()));

    const look = { ...(POST_LOOK[quality] || POST_LOOK.High) };
    if (params.has('bloom')) look.bloom = params.get('bloom') === '1';
    const noPost = params.get('noPost') === '1';
    const post = noPost ? null : new ChromaticImpastoPost(renderer, scene, camera, {
        look,
        falseColor: params.get('falseColor') === '1',
    });
    if (noPost) renderer.toneMapping = THREE.AgXToneMapping;
    const overlay = params.get('board') === '1' ? mountBoardOverlay(params.get('statsHud') !== '0') : null;

    const pointer = { x: num(params, 'px'), y: num(params, 'py') };
    const iconPose = params.get('icon') === '1';
    const size = new THREE.Vector2(1, 1);
    const syncViewport = () => {
        const aspect = window.innerWidth / Math.max(1, window.innerHeight);
        camera.aspect = aspect;
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
    const pushPost = (time) => {
        post?.update({ ...world.getPostState(), time });
    };
    const poseCamera = (cam, time, delta) => {
        world.updateCamera(cam, sim(time, delta));
        if (iconPose) {
            const zoom = num(params, 'iconZoom', 2.1);
            cam.position.set(num(params, 'iconX', -0.95), num(params, 'iconY', 0.1), cam.position.z / zoom);
            cam.up.set(0, 1, 0);
            cam.lookAt(cam.position.x, cam.position.y, 0);
            cam.updateMatrixWorld();
        }
    };
    const frame = (time, delta) => {
        poseCamera(camera, time, delta);
        world.update(sim(time, delta), camera);
    };
    const stepTo = (from, to, dt) => {
        const steps = Math.max(1, Math.round((to - from) / dt));
        const h = (to - from) / steps;
        for (let i = 1; i <= steps; i++) frame(from + i * h, h);
    };

    const eventName = params.get('event');
    const eventAge = num(params, 'eventAge', 0.4);
    const holdCombo = Math.max(0, Math.round(num(params, 'combo', 0)));
    const comboHold = Math.max(0, num(params, 'comboHold', 3));
    const level = Math.max(1, Math.round(num(params, 'level', 1)));
    const warmLocks = Math.max(0, Math.round(num(params, 'locks', 0)));
    const colorParam = params.get('color');
    const eventColor = colorParam ? `#${colorParam.replace('#', '')}` : PIECE_COLORS[5];
    const fireEvent = () => {
        const row = Math.round(num(params, 'row', 12));
        const u = num(params, 'u', 0.3);
        const lines = Math.max(1, Math.min(4, Math.round(num(params, 'lines', 2))));
        const bottom = (n) => Array.from({ length: n }, (_, i) => 19 - i);
        if (eventName === 'lock') world.onLock({ rows: [row, row - 1], u, color: eventColor });
        else if (eventName === 'drop') {
            world.onLock({
                rows: [row, row - 1], u, hardDrop: true, color: eventColor,
            });
        } else if (eventName === 'clear') world.onClear({ rows: bottom(lines), lines });
        else if (eventName === 'quad') world.onClear({ rows: bottom(4), lines: 4 });
        else if (eventName === 'tspin') world.onClear({ rows: bottom(2), lines: 2, tspin: true });
        else if (eventName === 'perfect') world.onClear({ rows: bottom(4), lines: 4, perfect: true });
        else if (eventName === 'levelUp') world.levelUp(num(params, 'eventLevel', level + 1));
        else if (eventName === 'fresh') world.freshCanvas();
    };

    let sought = null;
    const seekTo = (time) => {
        // The host seeks every frame while ?t= is set: the painting only needs laying once.
        if (sought === time) return;
        sought = time;
        const lead = (eventName ? eventAge : 0) + 1.5 + warmLocks * 0.5 + (holdCombo > 0 ? comboHold : 0);
        const start = Math.max(0, time - lead);
        world.seek(start);
        if (level > 1) world.levelUp(level, { silent: true });
        frame(start, 0);
        // Locks played before the event: the canvas holding their paint.
        let cursor = start;
        for (let i = 0; i < warmLocks; i++) {
            const at = start + 0.5 + i * 0.5;
            stepTo(cursor, at, 0.05);
            cursor = at;
            world.onLock({
                rows: [19 - (i % 9), 18 - (i % 9)],
                u: ((i * 0.37) % 1) * 0.9 + 0.05,
                color: PIECE_COLORS[i % PIECE_COLORS.length],
                hardDrop: i % 4 === 3,
            });
        }
        const eventTime = eventName ? time - eventAge : time;
        if (holdCombo > 0) {
            const from = Math.max(cursor, eventTime - comboHold);
            if (from > cursor) stepTo(cursor, from, 0.05);
            cursor = from;
            // The chain is built a link at a time over the first two thirds of the hold, as a
            // game builds it.
            const gap = holdCombo > 2 ? ((eventTime - from) * 0.66) / (holdCombo - 2) : 0;
            for (let n = 2; n <= holdCombo; n++) {
                world.onCombo(n);
                if (n < holdCombo && gap > 0) {
                    stepTo(cursor, cursor + gap, 1 / 30);
                    cursor += gap;
                }
            }
        }
        if (eventTime > cursor) stepTo(cursor, eventTime, 1 / 30);
        if (eventName) {
            fireEvent();
            stepTo(eventTime, time, 1 / 60);
        }
        frame(time, 0);
        pushPost(time);
    };

    const demo = params.get('demo') === '1';
    let demoCursor = 0;
    let demoLoop = -1;
    let demoPiece = 0;
    const runDemo = (time) => {
        const loop = Math.floor(time / DEMO_LOOP);
        if (loop !== demoLoop) {
            demoLoop = loop;
            demoCursor = 0;
            if (loop > 0) world.freshCanvas();
        }
        const local = time - loop * DEMO_LOOP;
        while (demoCursor < DEMO_SCRIPT.length && DEMO_SCRIPT[demoCursor][0] <= local) {
            const [, verb, detail] = DEMO_SCRIPT[demoCursor];
            if (verb === 'lock') {
                demoPiece += 1;
                world.onLock({ ...detail, color: PIECE_COLORS[demoPiece % PIECE_COLORS.length] });
            } else {
                world.onClear(detail);
                world.onCombo(detail.combo);
            }
            demoCursor += 1;
        }
        // A chain that is not continued breaks on the next lock that clears nothing.
        if (local > 15.2 && local < 22.2 && world.combo > 0) world.onCombo(0);
        if (local > 23.5 && local < 30 && world.combo > 0) world.onCombo(0);
        if (local > 32 && world.combo > 0) world.onCombo(0);
    };

    return {
        cameraRadius: 1,
        camera(time, cam) {
            poseCamera(cam, time, 0);
        },
        update(time, dt) {
            if (demo) runDemo(time);
            frame(time, dt);
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
            sought = null;
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
            overlay?.remove();
            post?.dispose();
            world.dispose();
            renderer.toneMapping = saved.toneMapping;
            camera.fov = saved.fov;
            camera.near = saved.near;
            camera.far = saved.far;
            camera.up.set(0, 1, 0);
            camera.updateProjectionMatrix();
        },
    };
}

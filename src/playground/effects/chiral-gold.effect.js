/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Chiral Gold — the full world + post stack, mounted in isolation.
 *
 * Mounts the SAME ChiralGoldWorld and ChiralGoldPost the theme ships, with the theme's camera
 * rig, so composition and grade are judged exactly as they will look in game.
 *
 * URL params:
 *   quality=High|Ultra|...   content tier (default High)
 *   board=1                  overlay a mock gameplay board + HUD (the solo layout rules); events
 *                            aim at its rects and the post's calm zones read them
 *   statsHud=0               with board=1: board only, no HUD mock
 *   combo=<n>                hold a chain of n (the hall's heat)
 *   level=<n>                rest in level n's alloy
 *   event=lock|drop|clear|quad|tspin|perfect|levelUp|break   fire a gameplay event...
 *   eventAge=<s>             ...and show it <s> seconds later (lines=<n>, row=<r>, u=<0..1>,
 *                            color=<hex>)
 *   demo=1                   live only: play a looping gameplay script
 *   parts=sky,water,...      draw only these parts
 *   falseColor=1             post debug view: band the pre-tone-map max channel
 *   noPost=1                 raw scene (no bloom/grade)
 *   bloom=0|1                override the tier's bloom
 *   msaa=<n>                 override the scene pass's samples
 *   px=-1..1&py=-1..1        hold a pointer-parallax offset
 *   icon=1                   the theme-icon framing: one tower, the ring's shoulder and their
 *                            reflection (compose for a small circle: capture a square frame)
 */
import * as THREE from 'three/webgpu';
import { ChiralGoldWorld } from '../../themes/chiral-gold/chiral-gold-world.js';
import { ChiralGoldPost, POST_LOOK } from '../../themes/chiral-gold/chiral-gold-post.js';
import { readLayoutRects } from '../../themes/chiral-gold/chiral-gold-composition.js';

export const meta = {
    id: 'chiral-gold',
    title: 'Chiral Gold (full world)',
    description: 'Two mirror-image towers of braided gold and a great ring, standing in black water.',
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

/** The game's piece colours (chiral-gold-tetrominos.js). */
const PIECE_COLORS = ['#FFF6D6', '#FFD700', '#FFAC33', '#FFC857', '#E67E22', '#D35400', '#F39C12'];

/** A looping script of locks and clears for the live demo (seconds into the loop). */
const DEMO_LOOP = 34;
const DEMO_SCRIPT = [
    [1.0, 'lock', { rows: [19], u: 0.2 }], [2.2, 'lock', { rows: [19, 18], u: 0.75 }],
    [3.3, 'lock', { rows: [18, 17], u: 0.4, hardDrop: true }], [4.4, 'lock', { rows: [19], u: 0.55 }],
    [4.4, 'clear', { rows: [19], lines: 1, combo: 1 }], [5.6, 'lock', { rows: [19, 18], u: 0.3 }],
    [5.6, 'clear', { rows: [19], lines: 1, combo: 2 }], [6.8, 'lock', { rows: [19, 18, 17], u: 0.8, hardDrop: true }],
    [6.8, 'clear', { rows: [19, 18], lines: 2, combo: 3 }], [8.0, 'lock', { rows: [19], u: 0.1 }],
    [8.0, 'clear', { rows: [19], lines: 1, combo: 4 }], [9.2, 'lock', { rows: [19, 18], u: 0.6 }],
    [9.2, 'clear', { rows: [19, 18, 17], lines: 3, combo: 5 }], [10.4, 'lock', { rows: [19], u: 0.45 }],
    [10.4, 'clear', { rows: [19], lines: 1, combo: 6 }], [11.8, 'lock', { rows: [19], u: 0.5 }],
    [12.8, 'lock', { rows: [19, 18], u: 0.15 }], [13.8, 'lock', { rows: [18, 17], u: 0.85 }],
    [14.8, 'lock', { rows: [17, 16], u: 0.35 }], [15.8, 'lock', { rows: [16, 15], u: 0.6, hardDrop: true }],
    [16.8, 'lock', { rows: [19, 18, 17, 16], u: 0.95, hardDrop: true }],
    [16.8, 'clear', { rows: [19, 18, 17, 16], lines: 4, combo: 1 }],
    [26.0, 'lock', { rows: [19], u: 0.45 }], [27.0, 'lock', { rows: [19, 18], u: 0.7 }],
    [28.0, 'lock', { rows: [18], u: 0.25, hardDrop: true }],
    [28.0, 'clear', {
        rows: [19, 18], lines: 2, tspin: true, combo: 1,
    }],
    [30.5, 'lock', { rows: [19], u: 0.5 }],
];

export function create({
    scene, camera, renderer, params,
}) {
    const quality = params.get('quality') || 'High';
    const saved = {
        fov: camera.fov, near: camera.near, far: camera.far, toneMapping: renderer.toneMapping, background: scene.background,
    };
    camera.near = 0.25;
    camera.far = 400;
    scene.background = new THREE.Color(0x000000);
    const world = new ChiralGoldWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    const partsParam = params.get('parts');
    if (partsParam) world.showOnlyParts(partsParam.split(',').map((p) => p.trim()));

    const look = { ...(POST_LOOK[quality] || POST_LOOK.High) };
    if (params.has('bloom')) look.bloom = params.get('bloom') === '1';
    if (params.has('msaa')) look.msaa = Math.max(0, Math.round(num(params, 'msaa')));
    const noPost = params.get('noPost') === '1';
    const post = noPost ? null : new ChiralGoldPost(renderer, scene, camera, {
        look,
        falseColor: params.get('falseColor') === '1',
    });
    if (noPost) renderer.toneMapping = THREE.AgXToneMapping;
    const overlay = params.get('board') === '1' ? mountBoardOverlay(params.get('statsHud') !== '0') : null;

    const pointer = { x: num(params, 'px'), y: num(params, 'py') };
    const iconPose = params.get('icon') === '1';
    if (iconPose) {
        // What is drawn against the board has no place in a picture without one, and at the size
        // of an icon the braid has to read alone: no wires, no beads.
        ['blades', 'tally'].forEach((name) => world.groups[name]?.forEach((object) => {
            object.visible = false;
        }));
        world.groups.towers.forEach((tower) => tower.children.forEach((child) => {
            if (/Wires|Beads/.test(child.name)) child.visible = false;
        }));
    }
    const size = new THREE.Vector2(1, 1);
    const syncViewport = () => {
        const aspect = window.innerWidth / Math.max(1, window.innerHeight);
        renderer.getDrawingBufferSize(size);
        world.setViewport(size.x, size.y, aspect, window.innerWidth, window.innerHeight);
        post?.setSize(window.innerWidth, window.innerHeight, size.x, size.y);
        const rects = overlay ? readLayoutRects() : null;
        world.setLayout(rects);
        post?.setCalmRects(rects ? [...rects.cards, rects.hud].filter(Boolean) : [], rects ? 1 : 0);
    };
    syncViewport();

    const sim = (time, delta) => ({
        time, delta, pointerX: pointer.x, pointerY: pointer.y,
    });
    const pushPost = (time) => {
        const state = world.getPostState();
        post?.update({ ...state, time, exposure: state.exposure });
    };
    const frame = (time, delta) => {
        world.updateCamera(camera, sim(time, delta));
        world.update(sim(time, delta));
        if (iconPose) {
            // One tower square on, the ring sweeping up behind it and both again in the water.
            const x = -world.place.helixX;
            camera.position.set(x + 0.5, 2.7, 9.6);
            camera.fov = 40;
            camera.updateProjectionMatrix();
            camera.lookAt(x + 0.35, 2.45, 0);
            camera.updateMatrixWorld();
        }
    };
    const stepTo = (from, to, dt) => {
        const steps = Math.max(1, Math.round((to - from) / dt));
        const h = (to - from) / steps;
        for (let i = 1; i <= steps; i++) frame(from + i * h, h);
    };

    const eventName = params.get('event');
    const eventAge = num(params, 'eventAge', 0.4);
    const holdCombo = Math.max(0, Math.round(num(params, 'combo', 0)));
    const level = Math.max(1, Math.round(num(params, 'level', 1)));
    const eventColor = params.get('color') ? `#${params.get('color').replace('#', '')}` : PIECE_COLORS[2];
    const fireEvent = () => {
        const row = Math.round(num(params, 'row', 14));
        const u = num(params, 'u', 0.3);
        const lines = Math.max(1, Math.min(4, Math.round(num(params, 'lines', 2))));
        const bottom = (n) => Array.from({ length: n }, (_, i) => 19 - i);
        const combo = Math.max(1, holdCombo);
        if (eventName === 'lock') world.onLock({ rows: [row, row - 1], u, color: eventColor });
        else if (eventName === 'drop') {
            world.onLock({
                rows: [row, row - 1], u, hardDrop: true, color: eventColor,
            });
        } else if (eventName === 'clear') world.onClear({ rows: bottom(lines), lines, combo });
        else if (eventName === 'quad') world.onClear({ rows: bottom(4), lines: 4, combo });
        else if (eventName === 'tspin') {
            world.onClear({
                rows: bottom(2), lines: 2, tspin: true, combo,
            });
        } else if (eventName === 'perfect') {
            world.onClear({
                rows: bottom(4), lines: 4, perfect: true, combo,
            });
        } else if (eventName === 'levelUp') world.levelUp(num(params, 'eventLevel', level + 1));
        else if (eventName === 'break') world.onCombo(0);
    };

    const seekTo = (time) => {
        const lead = (eventName ? eventAge : 0) + 8;
        const start = Math.max(0, time - lead);
        world.seek(start);
        if (level > 1) world.levelUp(level, { silent: true });
        if (holdCombo > 0) world.onCombo(holdCombo);
        frame(start, 0);
        const eventTime = eventName ? time - eventAge : time;
        if (eventTime > start) stepTo(start, eventTime, 0.1);
        if (eventName) {
            fireEvent();
            stepTo(eventTime, time, 1 / 120);
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
            world.onCombo(0);
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
        if (local > 11.8 && local < 16.8 && world.combo > 0) world.onCombo(0);
        if (local > 18 && local < 28 && world.combo > 0) world.onCombo(0);
        if (local > 30.5 && world.combo > 0) world.onCombo(0);
    };

    return {
        cameraRadius: 1,
        camera(time, cam) {
            world.updateCamera(cam, sim(time, 0));
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
            scene.background = saved.background;
            camera.fov = saved.fov;
            camera.near = saved.near;
            camera.far = saved.far;
            camera.layers.set(0);
            camera.updateProjectionMatrix();
        },
    };
}

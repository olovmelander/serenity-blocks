/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Serenity Warp — the full world + post stack, mounted in isolation.
 *
 * Mounts the SAME SerenityWarpWorld and SerenityWarpPost the theme ships, with the theme's
 * camera rig, so composition and grade are judged exactly as they will look in game.
 *
 * URL params:
 *   quality=High|Ultra|...   content tier (default High)
 *   board=1                  overlay a mock gameplay board + HUD (the solo layout rules); events
 *                            aim at its rects and the post's calm zones read them
 *   statsHud=0               with board=1: board only, no HUD mock
 *   combo=<n>                hold a combo of n (the warp)
 *   level=<n>                rest on level n's palette
 *   locks=<n>                before anything else, play n locks (the field holding their glass)
 *   event=lock|drop|clear|quad|tspin|perfect|levelUp   fire a gameplay event...
 *   eventAge=<s>             ...and show it <s> seconds later (lines=<n>, row=<r>, u=<0..1>,
 *                            color=<hex>, piece=I|O|T|S|Z|J|L, turns=<quarter turns>)
 *   demo=1                   live only: play a looping gameplay script
 *   parts=sky,glass,...      draw only these parts
 *   falseColor=1             post debug view: band the pre-tone-map max channel
 *   noPost=1                 raw scene (no bloom/grade)
 *   bloom=0|1                override the tier's bloom
 *   px=-1..1&py=-1..1        hold a pointer-parallax offset
 *   reduce=1                 reduced motion
 *   icon=1                   the theme-icon framing: the lens looks straight at the gate
 *                            (iconFov=34; iconYaw and iconPitch in radians, both 0, turn it)
 *                            (compose for a small circle: capture a square frame)
 */
import * as THREE from 'three/webgpu';
import { SerenityWarpWorld } from '../../themes/serenity-warp/serenity-warp-world.js';
import { SerenityWarpPost, POST_LOOK } from '../../themes/serenity-warp/serenity-warp-post.js';
import { readLayoutRects } from '../../themes/serenity-warp/serenity-warp-composition.js';
import { SHAPES, cellsFromMatrix } from '../../themes/serenity-warp/serenity-warp-core.js';
import { SERENITY_WARP_TETROMINOS } from '../../themes/serenity-warp/serenity-warp-tetrominos.js';

export const meta = {
    id: 'serenity-warp',
    title: 'Serenity Warp (full world)',
    description: 'A wormhole in a vortex of gas: the board sends pieces of stained glass spiralling into it.',
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

const KEYS = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
/** The game's piece colours (serenity-warp-tetrominos.js). */
const PIECE_COLORS = KEYS.map((k) => SERENITY_WARP_TETROMINOS.colors[k]);

/** A matrix turned a quarter clockwise. */
const turnCw = (m) => m[0].map((_, c) => m.map((row) => row[c]).reverse());

/** A shape's cells turned `turns` quarter turns clockwise (as the board turns them). */
function turned(key, turns = 0) {
    let m = SHAPES[key] || SHAPES.T;
    for (let i = 0; i < ((turns % 4) + 4) % 4; i++) m = turnCw(m);
    return cellsFromMatrix(m);
}

/** A looping script of locks and clears for the live demo (seconds into the loop). */
const DEMO_LOOP = 40;
const DEMO_SCRIPT = [
    [1.0, 'lock', { rows: [19], u: 0.2 }], [2.1, 'lock', { rows: [19, 18], u: 0.75 }],
    [3.2, 'lock', { rows: [14, 13], u: 0.4, hardDrop: true }], [4.3, 'lock', { rows: [9], u: 0.85 }],
    [5.4, 'lock', { rows: [19], u: 0.55 }],
    [5.4, 'clear', { rows: [19], lines: 1, combo: 1 }], [6.6, 'lock', { rows: [12, 11], u: 0.3 }],
    [6.6, 'clear', { rows: [19], lines: 1, combo: 2 }], [7.8, 'lock', { rows: [6, 5, 4], u: 0.8, hardDrop: true }],
    [7.8, 'clear', { rows: [19, 18], lines: 2, combo: 3 }], [9.0, 'lock', { rows: [16], u: 0.1 }],
    [9.0, 'clear', { rows: [19], lines: 1, combo: 4 }], [10.2, 'lock', { rows: [10, 9], u: 0.6 }],
    [10.2, 'clear', { rows: [19, 18, 17], lines: 3, combo: 5 }], [11.6, 'lock', { rows: [19], u: 0.5 }],
    [12.6, 'lock', { rows: [3, 2], u: 0.15 }], [13.6, 'lock', { rows: [18, 17], u: 0.85 }],
    [14.6, 'lock', { rows: [8, 7], u: 0.35 }], [15.6, 'lock', { rows: [16, 15], u: 0.6, hardDrop: true }],
    [16.6, 'lock', { rows: [11, 10], u: 0.9 }], [17.6, 'lock', { rows: [5, 4], u: 0.05 }],
    [18.6, 'lock', { rows: [19, 18, 17, 16], u: 0.95, hardDrop: true }],
    [18.6, 'clear', { rows: [19, 18, 17, 16], lines: 4, combo: 1 }],
    [28.0, 'lock', { rows: [19], u: 0.45 }], [29.0, 'lock', { rows: [13, 12], u: 0.7 }],
    [30.0, 'lock', { rows: [18], u: 0.25, hardDrop: true }],
    [30.0, 'clear', {
        rows: [19, 18], lines: 2, tspin: true, combo: 1,
    }],
    [32.0, 'lock', { rows: [7], u: 0.5 }],
];

export function create({
    scene, camera, renderer, params,
}) {
    const quality = params.get('quality') || 'High';
    const saved = {
        fov: camera.fov, near: camera.near, far: camera.far, toneMapping: renderer.toneMapping,
    };
    const world = new SerenityWarpWorld({
        scene, quality, capture: true, renderer,
    }).build();
    world.bindCamera(camera);
    world.setReducedMotion(params.get('reduce') === '1');
    const partsParam = params.get('parts');
    if (partsParam) world.showOnlyParts(partsParam.split(',').map((p) => p.trim()));

    const look = { ...(POST_LOOK[quality] || POST_LOOK.High) };
    if (params.has('bloom')) {
        look.bloom = params.get('bloom') === '1';
        // A tier that ships without bloom has no strength to turn on.
        if (look.bloom && !(look.bloomStrength > 0)) look.bloomStrength = POST_LOOK.Medium.bloomStrength;
    }
    const noPost = params.get('noPost') === '1';
    const post = noPost ? null : new SerenityWarpPost(renderer, scene, camera, {
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

    const sim = (time, delta, draw = true) => ({
        time, delta, pointerX: pointer.x, pointerY: pointer.y, draw,
    });
    const pushPost = (time) => {
        post?.update({ ...world.getPostState(), time });
    };
    const aimIcon = () => {
        if (!iconPose) return;
        // The icon lens looks straight at the gate, so the throat is the middle of the frame
        // (the world aims its events through the rig's own camera, so this is applied after).
        camera.fov = num(params, 'iconFov', 34);
        camera.updateProjectionMatrix();
        camera.up.set(0, 1, 0);
        camera.lookAt(camera.position.x, camera.position.y, camera.position.z - 10);
        camera.rotateY(num(params, 'iconYaw', 0));
        camera.rotateX(num(params, 'iconPitch', 0));
        camera.updateMatrixWorld();
        // Stars and the rim size themselves from the view's radians per pixel.
        world.u.pixelAngle.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, size.y);
    };
    const frame = (time, delta, draw = true) => {
        world.updateCamera(camera, sim(time, delta));
        aimIcon();
        world.update(sim(time, delta, draw), camera);
    };
    const stepTo = (from, to, dt) => {
        const steps = Math.max(1, Math.round((to - from) / dt));
        const h = (to - from) / steps;
        // Only the last frame of a replay is looked at: the others need not paint the sky.
        for (let i = 1; i <= steps; i++) frame(from + i * h, h, false);
    };

    const eventName = params.get('event');
    const eventAge = num(params, 'eventAge', 0.4);
    const holdCombo = Math.max(0, Math.round(num(params, 'combo', 0)));
    const level = Math.max(1, Math.round(num(params, 'level', 1)));
    const warmLocks = Math.max(0, Math.round(num(params, 'locks', 0)));
    const colorParam = params.get('color');
    const shapeParam = (params.get('piece') || 'T').toUpperCase();
    const eventKey = KEYS.includes(shapeParam) ? shapeParam : 'T';
    const eventColor = colorParam ? `#${colorParam.replace('#', '')}` : PIECE_COLORS[KEYS.indexOf(eventKey)];
    const fireEvent = () => {
        const row = Math.round(num(params, 'row', 9));
        const u = num(params, 'u', 0.3);
        const lines = Math.max(1, Math.min(4, Math.round(num(params, 'lines', 2))));
        const bottom = (n) => Array.from({ length: n }, (_, i) => 19 - i);
        const cells = turned(eventKey, Math.round(num(params, 'turns', 0)));
        if (eventName === 'lock') {
            world.onLock({
                rows: [row, row - 1], u, color: eventColor, cells,
            });
        } else if (eventName === 'drop') {
            world.onLock({
                rows: [row, row - 1], u, hardDrop: true, color: eventColor, cells,
            });
        } else if (eventName === 'clear') world.onClear({ rows: bottom(lines), lines });
        else if (eventName === 'quad') world.onClear({ rows: bottom(4), lines: 4 });
        else if (eventName === 'tspin') world.onClear({ rows: bottom(2), lines: 2, tspin: true });
        else if (eventName === 'perfect') world.onClear({ rows: bottom(4), lines: 4, perfect: true });
        else if (eventName === 'levelUp') world.levelUp(num(params, 'eventLevel', level + 1));
    };

    const lockAt = (i) => {
        const k = KEYS[i % KEYS.length];
        world.onLock({
            rows: [19 - ((i * 5) % 18), 18 - ((i * 5) % 18)],
            u: ((i * 0.37) % 1) * 0.9 + 0.05,
            color: PIECE_COLORS[i % PIECE_COLORS.length],
            cells: turned(k, i),
            hardDrop: i % 4 === 3,
        });
    };

    const seekTo = (time) => {
        const lead = (eventName ? eventAge : 0) + 9 + warmLocks * 0.6;
        const start = Math.max(0, time - lead);
        world.seek(start);
        if (level > 1) world.levelUp(level, { silent: true });
        if (holdCombo > 0) world.onCombo(holdCombo);
        frame(start, 0, false);
        // Locks played before the event: the field holding their glass.
        let cursor = start;
        const eventTime = eventName ? time - eventAge : time;
        for (let i = 0; i < warmLocks; i++) {
            // Never past the moment being shown (a seek close to zero has no room for the lead).
            const at = Math.min(eventTime, start + 0.5 + i * 0.6);
            stepTo(cursor, at, 0.1);
            cursor = at;
            lockAt(i);
        }
        if (eventTime > cursor) stepTo(cursor, eventTime, 0.1);
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
            world.resetSession();
        }
        const local = time - loop * DEMO_LOOP;
        while (demoCursor < DEMO_SCRIPT.length && DEMO_SCRIPT[demoCursor][0] <= local) {
            const [, verb, detail] = DEMO_SCRIPT[demoCursor];
            if (verb === 'lock') {
                demoPiece += 1;
                const k = KEYS[demoPiece % KEYS.length];
                world.onLock({
                    ...detail, color: PIECE_COLORS[demoPiece % PIECE_COLORS.length], cells: turned(k, demoPiece),
                });
            } else {
                world.onClear(detail);
                world.onCombo(detail.combo);
            }
            demoCursor += 1;
        }
        // A chain that is not continued breaks on the next lock that clears nothing.
        if (local > 11.6 && local < 18.6 && world.combo > 0) world.onCombo(0);
        if (local > 22 && local < 30 && world.combo > 0) world.onCombo(0);
        if (local > 32 && world.combo > 0) world.onCombo(0);
    };

    return {
        cameraRadius: 1,
        camera(time, cam) {
            world.updateCamera(cam, sim(time, 0));
        },
        update(time, dt) {
            if (demo) {
                // The script's events carry this frame's time, as the game's do.
                world.updateCamera(camera, sim(time, dt));
                runDemo(time);
            }
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
            camera.fov = saved.fov;
            camera.near = saved.near;
            camera.far = saved.far;
            camera.updateProjectionMatrix();
        },
    };
}

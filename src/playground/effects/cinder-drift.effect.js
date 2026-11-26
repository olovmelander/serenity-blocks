/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Cinder Drift — the full world + post stack, mounted in isolation.
 *
 * Mounts the SAME CinderDriftWorld and CinderDriftPost the theme ships, with the theme's camera rig,
 * so composition and grade are judged exactly as they will look in game.
 *
 * URL params:
 *   quality=High|Ultra|...   content tier (default High)
 *   board=1                  overlay a mock gameplay board + HUD (the solo layout rules); events
 *                            aim at its rects and the post's calm zones read them
 *   statsHud=0               with board=1: board only, no HUD mock
 *   combo=<n>                hold a combo of n (the chamber's pressure)
 *   level=<n>                level n's step on top of the clock's palette
 *   locks=<n>                before anything else, play n locks (pools already melted in the lake)
 *   event=lock|drop|clear|quad|twist|mini|cascade|b2b|perfect|crown|levelUp|gameOver
 *   eventAge=<s>             ...and show it <s> seconds later (lines=<n>, row=<r>, u=<0..1>,
 *                            color=<hex>, distance=<drop rows>, depth=<cascade wave>).
 *                            crown replays the perfect-clear callback 360 ms after its clear.
 *   demo=1                   live only: play a looping gameplay script
 *   parts=lake,columns,...   draw only these parts
 *   falseColor=1             post debug view: band the pre-tone-map max channel
 *   noPost=1                 raw scene (no bloom/grade)
 *   bloom=0|1                override the tier's bloom
 *   msaa=<n>                 override the scene pass's samples
 *   px=-1..1&py=-1..1        hold a pointer-parallax offset
 *   reduce=1                 reduced motion
 *   eye=x,y,z&aim=x,y,z      an inspection lens from eye toward aim, world metres (fov=<deg>,
 *                            default 40), in place of the camera rig: e.g. the right-hand cliff
 *                            close up, eye=14,4,-12&aim=24,6,-30&fov=50
 *   icon=1                   the theme-icon framing: a longer lens turned to the great fall
 *                            (compose for a small circle: capture a square frame)
 */
import * as THREE from 'three/webgpu';
import { CinderDriftWorld } from '../../themes/cinder-drift/cinder-drift-world.js';
import { CinderDriftPost, POST_LOOK } from '../../themes/cinder-drift/cinder-drift-post.js';
import { readLayoutRects } from '../../themes/cinder-drift/cinder-drift-composition.js';
import { CINDER_DRIFT_TETROMINOS } from '../../themes/cinder-drift/cinder-drift-tetrominos.js';
import { SHAPES } from '../../core/constants.js';
import { drawLandingShadowCanvas, drawPieceSolid, trimShape } from '../../rendering/canvas/canvas-drawing-utils.js';

export const meta = {
    id: 'cinder-drift',
    title: 'Cinder Drift (full world)',
    description: 'A magma chamber of columnar basalt and a lake of lava under a drifting crust; the board breaks it open.',
};

function num(params, key, fallback = 0) {
    const v = Number.parseFloat(params.get(key));
    return Number.isFinite(v) ? v : fallback;
}

/** The live solo markup and styles, populated with a static playfield. Only board previews load them. */
async function mountBoardOverlay(root, withHud) {
    const [page, tokens, solo] = await Promise.all([
        import('../../../index.html?raw'),
        import('../../../public/styles/keystone.css?raw'),
        import('../../../public/styles/keystone-solo.css?raw'),
    ]);
    if (!root.isConnected) return;
    const source = document.createElement('template');
    source.innerHTML = page.default;
    const stage = source.content.querySelector('.single-player-stage');
    stage.dataset.board = 'well';
    stage.style.display = 'flex';
    const styles = document.createElement('style');
    // Base layout declarations normally supplied by the full game's main.css and overlays.
    styles.textContent = `${tokens.default}
        #cinder-drift-theme .single-player-stage { --sb-board-fill:.85;--sb-board-floor:520px }
        @media (max-aspect-ratio:1/1) { #cinder-drift-theme .single-player-stage { --sb-board-fill:1 } }
        #cinder-drift-theme .player-next-pieces, #cinder-drift-theme .single-player-piece-previews,
        #cinder-drift-theme .single-player-stats-bar { display:flex }
        #cinder-drift-theme .single-player-piece-previews { justify-content:center }
        #cinder-drift-theme #phaser-game-container canvas { display:block;width:100%;height:100% }
        ${solo.default}`;
    if (!withHud) stage.querySelector('.single-player-stats-bar').remove();
    const board = document.createElement('canvas');
    board.width = 300;
    board.height = 600;
    stage.querySelector('#phaser-game-container').append(board);
    root.append(styles, stage);
    const paint = (context, key, x, y, size) => drawPieceSolid(context, trimShape(SHAPES[key]), x, y, size, {
        ...CINDER_DRIFT_TETROMINOS,
        color: CINDER_DRIFT_TETROMINOS.colors[key],
    });
    const ctx = board.getContext('2d');
    const pieces = [['I', 0, 19], ['O', 4, 18], ['L', 0, 17], ['J', 7, 18], ['T', 3, 4]];
    pieces.forEach(([key, x, y]) => paint(ctx, key, x * 30, y * 30, 30));
    drawLandingShadowCanvas(ctx, trimShape(SHAPES.T), 90, 16 * 30, 30, CINDER_DRIFT_TETROMINOS.colors.T);
    const queue = stage.querySelector('#next-queue-container');
    ['Z', 'S', 'O'].forEach((key, i) => {
        const preview = document.createElement('canvas');
        preview.className = i === 0 ? 'player-next-piece highlight' : 'player-next-piece';
        preview.width = 100;
        preview.height = 64;
        const shape = trimShape(SHAPES[key]);
        paint(preview.getContext('2d'), key, (100 - shape[0].length * 18) / 2, (64 - shape.length * 18) / 2, 18);
        queue.append(preview);
    });
}

function createOverlayRoot() {
    const root = document.createElement('div');
    root.id = 'cinder-drift-theme';
    root.className = 'active';
    root.setAttribute('aria-hidden', 'true');
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5';
    document.body.appendChild(root);
    return root;
}

/** The game's piece colours (cinder-drift-tetrominos.js). */
const PIECE_COLORS = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'].map((key) => CINDER_DRIFT_TETROMINOS.colors[key]);

/** A looping script of locks and clears for the live demo (seconds into the loop). */
const DEMO_LOOP = 40;
const DEMO_SCRIPT = [
    [1.0, 'lock', { rows: [19], u: 0.2 }], [2.1, 'lock', { rows: [19, 18], u: 0.75 }],
    [3.2, 'lock', { rows: [18, 17], u: 0.4, hardDrop: true }], [4.3, 'lock', { rows: [17], u: 0.85 }],
    [5.4, 'lock', { rows: [19], u: 0.55 }],
    [5.4, 'clear', { rows: [19], lines: 1, combo: 1 }], [6.6, 'lock', { rows: [19, 18], u: 0.3 }],
    [6.6, 'clear', { rows: [19], lines: 1, combo: 2 }], [7.8, 'lock', { rows: [19, 18, 17], u: 0.8, hardDrop: true }],
    [7.8, 'clear', { rows: [19, 18], lines: 2, combo: 3 }], [9.0, 'lock', { rows: [19], u: 0.1 }],
    [9.0, 'clear', { rows: [19], lines: 1, combo: 4 }], [10.2, 'lock', { rows: [19, 18], u: 0.6 }],
    [10.2, 'clear', { rows: [19, 18, 17], lines: 3, combo: 5 }], [11.6, 'lock', { rows: [19], u: 0.5 }],
    [12.6, 'lock', { rows: [19, 18], u: 0.15 }], [13.6, 'lock', { rows: [18, 17], u: 0.85 }],
    [14.6, 'lock', { rows: [17, 16], u: 0.35 }], [15.6, 'lock', { rows: [16, 15], u: 0.6, hardDrop: true }],
    [16.6, 'lock', { rows: [15, 14], u: 0.9 }], [17.6, 'lock', { rows: [14, 13], u: 0.05 }],
    [18.6, 'lock', { rows: [19, 18, 17, 16], u: 0.95, hardDrop: true }],
    [18.6, 'clear', { rows: [19, 18, 17, 16], lines: 4, combo: 1 }],
    [26.0, 'lock', { rows: [19], u: 0.45 }], [27.0, 'lock', { rows: [19, 18], u: 0.7 }],
    [28.0, 'lock', { rows: [18], u: 0.25, hardDrop: true }],
    [28.0, 'clear', {
        rows: [19, 18], lines: 2, twist: true, b2b: true, combo: 1,
    }],
    [30.0, 'lock', { rows: [19], u: 0.5 }],
    [32.4, 'lock', {
        rows: [19, 18, 17, 16], u: 0.77, hardDrop: true, distance: 17,
    }],
    [32.4, 'clear', {
        rows: [19, 18, 17, 16], lines: 4, combo: 1, perfect: true,
    }],
];

export function create({
    scene, camera, renderer, params,
}) {
    const quality = params.get('quality') || 'High';
    const saved = {
        fov: camera.fov, near: camera.near, far: camera.far, toneMapping: renderer.toneMapping,
    };
    const world = new CinderDriftWorld({
        scene, quality, capture: true, renderer,
    }).build();
    world.bindCamera(camera);
    world.setReducedMotion(params.get('reduce') === '1');
    const partsParam = params.get('parts');
    if (partsParam) world.showOnlyParts(partsParam.split(',').map((p) => p.trim()));

    const look = { ...(POST_LOOK[quality] || POST_LOOK.High) };
    if (params.has('bloom')) look.bloom = params.get('bloom') === '1';
    if (params.has('msaa')) look.msaa = Math.max(0, Math.round(num(params, 'msaa')));
    const noPost = params.get('noPost') === '1';
    const post = noPost ? null : new CinderDriftPost(renderer, scene, camera, {
        look,
        noise: world.u.noiseTex,
        falseColor: params.get('falseColor') === '1',
    });
    if (noPost) renderer.toneMapping = THREE.AgXToneMapping;
    const overlay = params.get('board') === '1' ? createOverlayRoot() : null;

    const pointer = { x: num(params, 'px'), y: num(params, 'py') };
    const iconPose = params.get('icon') === '1';
    const triple = (key) => (params.get(key) || '').split(',').map(Number);
    const lens = [...triple('eye'), ...triple('aim')];
    const inspect = params.has('eye') && params.has('aim') && lens.length === 6 && lens.every(Number.isFinite)
        ? { eye: lens.slice(0, 3), aim: lens.slice(3), fov: num(params, 'fov', 40) } : null;
    /** The inspection lens, over whatever the rig set. */
    const inspectLens = (cam) => {
        if (!inspect) return;
        cam.fov = inspect.fov;
        cam.position.set(...inspect.eye);
        cam.up.set(0, 1, 0);
        cam.lookAt(...inspect.aim);
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
    };
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
    const frame = (time, delta) => {
        world.updateCamera(camera, sim(time, delta));
        world.update(sim(time, delta), camera);
        if (iconPose) {
            camera.fov = num(params, 'iconFov', 46);
            camera.position.x += num(params, 'iconX', 0);
            camera.position.z += num(params, 'iconZ', 0);
            camera.rotateY(num(params, 'iconYaw', 0.2));
            camera.rotateX(num(params, 'iconPitch', 0.1));
            camera.updateProjectionMatrix();
            camera.updateMatrixWorld();
        }
        inspectLens(camera);
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
    const warmLocks = Math.max(0, Math.round(num(params, 'locks', 0)));
    const colorParam = params.get('color');
    const eventColor = colorParam ? `#${colorParam.replace('#', '')}` : PIECE_COLORS[2];
    const fireEvent = (eventTime) => {
        const row = Math.round(num(params, 'row', 12));
        const u = num(params, 'u', 0.3);
        const lines = Math.max(1, Math.min(4, Math.round(num(params, 'lines', 2))));
        const bottom = (n) => Array.from({ length: n }, (_, i) => 19 - i);
        if (eventName === 'lock') world.onLock({ rows: [row, row - 1], u, color: eventColor });
        else if (eventName === 'drop') {
            world.onLock({
                rows: [row, row - 1], u, hardDrop: true, distance: num(params, 'distance', 16), color: eventColor,
            });
        } else if (eventName === 'clear') world.onClear({ rows: bottom(lines), lines });
        else if (eventName === 'quad') world.onClear({ rows: bottom(4), lines: 4 });
        else if (eventName === 'twist') world.onClear({ rows: bottom(2), lines: 2, twist: true });
        else if (eventName === 'mini') world.onTwistMini();
        else if (eventName === 'cascade') {
            const cascade = num(params, 'depth', 3);
            world.onClear({ rows: bottom(lines), lines, cascade });
        } else if (eventName === 'b2b') {
            const count = params.has('lines') ? lines : 4;
            world.onClear({
                rows: bottom(count), lines: count, twist: count < 4, b2b: true,
            });
        } else if (eventName === 'perfect') {
            world.onClear({ rows: bottom(4), lines: 4, perfect: true });
        } else if (eventName === 'crown') {
            world.onClear({ rows: bottom(lines), lines });
            if (eventAge >= 0.36) {
                stepTo(eventTime, eventTime + 0.36, 1 / 120);
                world.onPerfectCrown();
                return eventTime + 0.36;
            }
        } else if (eventName === 'levelUp') world.levelUp(num(params, 'eventLevel', level + 1));
        else if (eventName === 'gameOver') world.resetSession({ cooling: true });
        return eventTime;
    };

    let captureTime = null;
    const seekTo = (time) => {
        captureTime = time;
        const lead = (eventName ? eventAge : 0) + 9 + warmLocks * 0.5;
        const start = Math.max(0, time - lead);
        world.seek(start);
        if (level > 1) world.levelUp(level, { silent: true });
        if (holdCombo > 0) world.onCombo(holdCombo);
        frame(start, 0);
        // Locks played before the event: their pools already drifting in the lake.
        let cursor = start;
        for (let i = 0; i < warmLocks; i++) {
            const at = start + 0.5 + i * 0.5;
            stepTo(cursor, at, 0.1);
            cursor = at;
            world.onLock({
                rows: [19 - (i % 9), 18 - (i % 9)],
                u: ((i * 0.37) % 1) * 0.9 + 0.05,
                color: PIECE_COLORS[i % PIECE_COLORS.length],
                hardDrop: i % 4 === 3,
            });
        }
        const eventTime = eventName ? time - eventAge : time;
        if (eventTime > cursor) stepTo(cursor, eventTime, 0.1);
        if (eventName) {
            const lastEventTime = fireEvent(eventTime);
            stepTo(lastEventTime, time, 1 / 120);
        }
        frame(time, 0);
        pushPost(time);
    };
    const boardReady = overlay && mountBoardOverlay(overlay, params.get('statsHud') !== '0').then(() => {
        if (!overlay.isConnected) return;
        syncViewport();
        if (captureTime !== null) seekTo(captureTime);
        overlay.dataset.ready = 'true';
    });

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
                world.onLock({ ...detail, color: PIECE_COLORS[demoPiece % PIECE_COLORS.length] });
            } else {
                world.onClear(detail);
                world.onCombo(detail.combo);
            }
            demoCursor += 1;
        }
        // A chain that is not continued breaks on the next lock that clears nothing.
        if (local > 11.6 && local < 18.6 && world.combo > 0) world.onCombo(0);
        if (local > 20 && local < 28 && world.combo > 0) world.onCombo(0);
        if (((local > 30 && local < 32.4) || local > 35) && world.combo > 0) world.onCombo(0);
    };

    const counters = { drawCalls: 0, triangles: 0 };
    const render = () => {
        if (post) post.render();
        else renderer.render(scene, camera);
        // three resets these on every RAF, including ticks skipped by the playground cap.
        counters.drawCalls = renderer.info.render.drawCalls;
        counters.triangles = renderer.info.render.triangles;
    };
    return {
        cameraRadius: 1,
        camera() { /* frame() positions the camera before every simulation step. */ },
        update(time, dt) {
            captureTime = null;
            if (demo) runDemo(time);
            frame(time, dt);
            pushPost(time);
        },
        seek(time) {
            // Keep the pinned image without replaying nine seconds of simulation on every redraw.
            if (time !== captureTime) seekTo(time);
        },
        render,
        async renderAsync() {
            await boardReady;
            render();
        },
        resize() {
            syncViewport();
            captureTime = null;
        },
        getRendererCounters: () => ({ ...counters }),
        getDiagnostics() {
            return {
                backend: renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2',
                calls: counters.drawCalls,
                triangles: counters.triangles,
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
            camera.layers.set(0);
            camera.updateProjectionMatrix();
        },
    };
}

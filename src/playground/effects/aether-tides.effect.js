/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Aether Tides — the full world + post stack, mounted in isolation.
 *
 * Mounts the SAME AetherTidesWorld and AetherTidesPost the theme ships, so composition and grade
 * are judged exactly as they will look in game.
 *
 * URL params:
 *   quality=High|Ultra|...   content tier (default High)
 *   board=1                  overlay a mock gameplay board + HUD (the solo layout rules); events
 *                            aim at its rects and the post's calm zones read them
 *   statsHud=0               with board=1: board only, no HUD mock
 *   combo=<n>                hold a combo of n (the maelstrom)
 *   level=<n>                rest on level n's palette
 *   locks=<n>                before anything else, play n locks (the sky holding their stars)
 *   event=lock|drop|clear|quad|tspin|perfect|levelUp|break   fire a gameplay event...
 *   eventAge=<s>             ...and show it <s> seconds later (lines=<n>, row=<r>, col=<c>,
 *                            color=<hex>, piece=I|O|T|S|Z|J|L)
 *   lead=<s>                 seconds of fluid replayed before the frame (default 10)
 *   demo=1                   live only: play a looping gameplay script
 *   parts=nebula,stars,...   draw only these parts
 *   falseColor=1             post debug view: band the pre-tone-map max channel
 *   noPost=1                 raw scene (no bloom/grade)
 *   bloom=0|1                override the tier's bloom
 *   px=-1..1&py=-1..1        hold a pointer-parallax offset
 *   reduce=1                 reduced motion
 *   noFluid=1                the fallback for a device without half-float render targets: no
 *                            solver, the resting nebula drawn as it stands
 *   P.<name>=<v> U.<name>=<v> F.<name>=<v>   hold a float uniform of the picture (P), the fluid
 *                            (U) or the resting nebula (F) at a value, for A/B captures
 *   icon=1                   the theme-icon framing: no board, and a lens (iconX, iconY in
 *                            tide units, iconZoom) on the picture; capture a square frame
 */
import * as THREE from 'three/webgpu';
import { AetherTidesWorld } from '../../themes/aether-tides/aether-tides-world.js';
import { AetherTidesPost, POST_LOOK } from '../../themes/aether-tides/aether-tides-post.js';
import { readLayoutRects } from '../../themes/aether-tides/aether-tides-composition.js';

export const meta = {
    id: 'aether-tides',
    title: 'Aether Tides (full world)',
    description: 'A nebula that is a real fluid: the board pours light into it, stirs it and sets it off.',
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

/** The game's piece colours (aether-tides-tetrominos.js), by shape. */
const PIECE_COLORS = {
    I: '#F5C542', J: '#FF7A3C', L: '#2CE0FF', O: '#8A5CFF', S: '#FF4D6D', T: '#3CE68C', Z: '#3A7BFF',
};
const PIECE_KEYS = Object.keys(PIECE_COLORS);

/** Occupied cells of each piece at rest, as [column, row] offsets (row grows downward). */
const PIECE_CELLS = {
    I: [[0, 0], [1, 0], [2, 0], [3, 0]],
    O: [[0, 0], [1, 0], [0, 1], [1, 1]],
    T: [[1, 0], [0, 1], [1, 1], [2, 1]],
    S: [[1, 0], [2, 0], [0, 1], [1, 1]],
    Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
    J: [[0, 0], [0, 1], [1, 1], [2, 1]],
    L: [[2, 0], [0, 1], [1, 1], [2, 1]],
};

/** A lock spec as the director would resolve it: the piece's cells on the visible board. */
function lockSpec(piece, column, row, hardDrop = false) {
    const key = PIECE_CELLS[piece] ? piece : 'T';
    const cells = PIECE_CELLS[key].map(([c, r]) => [
        Math.max(0, Math.min(9, column + c)), Math.max(0, Math.min(19, row + r - 1)),
    ]);
    const rows = [...new Set(cells.map((c) => c[1]))];
    const u = cells.reduce((sum, c) => sum + c[0] + 0.5, 0) / cells.length / 10;
    return {
        player: 0, cells, rows, u, hardDrop, color: PIECE_COLORS[key],
    };
}

/** A looping script of locks and clears for the live demo (seconds into the loop). */
const DEMO_LOOP = 38;
const DEMO_SCRIPT = [
    [1.0, 'lock', ['T', 1, 19]], [2.1, 'lock', ['L', 6, 19]],
    [3.2, 'lock', ['I', 3, 18, true]], [4.3, 'lock', ['S', 7, 17]],
    [5.4, 'lock', ['O', 4, 19]],
    [5.4, 'clear', { rows: [19], lines: 1, combo: 1 }], [6.6, 'lock', ['Z', 2, 19]],
    [6.6, 'clear', { rows: [19], lines: 1, combo: 2 }], [7.8, 'lock', ['J', 7, 19, true]],
    [7.8, 'clear', { rows: [19, 18], lines: 2, combo: 3 }], [9.0, 'lock', ['T', 0, 19]],
    [9.0, 'clear', { rows: [19], lines: 1, combo: 4 }], [10.2, 'lock', ['L', 5, 19]],
    [10.2, 'clear', { rows: [19, 18, 17], lines: 3, combo: 5 }], [11.6, 'lock', ['O', 4, 19]],
    [12.6, 'lock', ['S', 1, 19]], [13.6, 'lock', ['I', 6, 18]],
    [14.6, 'lock', ['Z', 3, 17]], [15.6, 'lock', ['T', 5, 16, true]],
    [16.6, 'lock', ['J', 7, 15]], [17.6, 'lock', ['L', 0, 14]],
    [18.6, 'lock', ['I', 9, 19, true]],
    [18.6, 'clear', { rows: [19, 18, 17, 16], lines: 4, combo: 1 }],
    [27.0, 'lock', ['O', 4, 19]], [28.0, 'lock', ['S', 6, 19]],
    [29.0, 'lock', ['T', 2, 18, true]],
    [29.0, 'clear', {
        rows: [19, 18], lines: 2, tspin: true, combo: 1,
    }],
    [31.0, 'lock', ['Z', 5, 19]], [33.0, 'lock', ['J', 1, 19]],
];

export function create({
    scene, camera, renderer, params,
}) {
    const quality = params.get('quality') || 'High';
    const saved = { toneMapping: renderer.toneMapping };
    const world = new AetherTidesWorld({
        scene, quality, capture: true, renderer, live: params.get('noFluid') === '1' ? false : undefined,
    }).build();
    world.setReducedMotion(params.get('reduce') === '1');
    const partsParam = params.get('parts');
    if (partsParam) world.showOnlyParts(partsParam.split(',').map((p) => p.trim()));

    const look = { ...(POST_LOOK[quality] || POST_LOOK.High) };
    if (params.has('bloom')) look.bloom = params.get('bloom') === '1';
    const noPost = params.get('noPost') === '1';
    const post = noPost ? null : new AetherTidesPost(renderer, scene, camera, {
        look,
        falseColor: params.get('falseColor') === '1',
    });
    if (noPost) renderer.toneMapping = THREE.AgXToneMapping;
    else renderer.toneMapping = THREE.NoToneMapping;
    const overlay = params.get('board') === '1' ? mountBoardOverlay(params.get('statsHud') !== '0') : null;

    const held = [];
    params.forEach((value, key) => {
        const match = /^([PUF]).(w+)$/.exec(key);
        const v = Number.parseFloat(value);
        if (!match || !Number.isFinite(v)) return;
        const group = { P: world.picture, U: world.tide, F: world.fieldUniforms }[match[1]];
        const target = group?.[match[2]];
        if (target && typeof target.value === 'number') held.push([target, v]);
        else console.warn(`[aether-tides] no float uniform ${key}`);
    });
    if (held.length) {
        world.tuning = () => {
            for (let i = 0; i < held.length; i++) held[i][0].value = held[i][1];
        };
        world.tuning();
    }
    if (params.get('icon') === '1') {
        world.picture.frame.value.set(num(params, 'iconX', 0), num(params, 'iconY', 0), num(params, 'iconZoom', 1));
    }
    const pointer = { x: num(params, 'px'), y: num(params, 'py') };
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
    const pieceParam = (params.get('piece') || 'T').toUpperCase();
    const colorParam = params.get('color');
    const fireEvent = () => {
        const row = Math.round(num(params, 'row', 14));
        const column = Math.round(num(params, 'col', 2));
        const lines = Math.max(1, Math.min(4, Math.round(num(params, 'lines', 2))));
        const bottom = (n) => Array.from({ length: n }, (_, i) => 19 - i);
        const spec = lockSpec(pieceParam, column, row, eventName === 'drop');
        if (colorParam) spec.color = `#${colorParam.replace('#', '')}`;
        if (eventName === 'lock' || eventName === 'drop') world.onLock(spec);
        else if (eventName === 'clear') world.onClear({ rows: bottom(lines), lines });
        else if (eventName === 'quad') world.onClear({ rows: bottom(4), lines: 4 });
        else if (eventName === 'tspin') world.onClear({ rows: bottom(2), lines: 2, tspin: true });
        else if (eventName === 'perfect') world.onClear({ rows: bottom(4), lines: 4, perfect: true });
        else if (eventName === 'levelUp') world.levelUp(num(params, 'eventLevel', level + 1));
        else if (eventName === 'break') world.onCombo(0);
    };

    const seekTo = (time) => {
        const lead = num(params, 'lead', 10) + (eventName ? eventAge : 0) + warmLocks * 0.5;
        const start = Math.max(0, time - lead);
        world.seek(start);
        if (level > 1) world.levelUp(level, { silent: true });
        if (holdCombo > 0) world.onCombo(holdCombo);
        frame(start, 0);
        // Locks played before the event: the sky holding their stars.
        let cursor = start;
        for (let i = 0; i < warmLocks; i++) {
            const at = start + 0.5 + i * 0.5;
            stepTo(cursor, at, 1 / 30);
            cursor = at;
            world.onLock(lockSpec(PIECE_KEYS[i % PIECE_KEYS.length], (i * 3) % 8, 19 - (i % 9), i % 4 === 3));
        }
        const eventTime = eventName ? time - eventAge : time;
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
            if (verb === 'lock') world.onLock(lockSpec(...detail));
            else {
                world.onClear(detail);
                world.onCombo(detail.combo);
            }
            demoCursor += 1;
        }
        // A chain that is not continued breaks on the next lock that clears nothing.
        if (local > 11.6 && local < 18.6 && world.combo > 0) world.onCombo(0);
        if (local > 20 && local < 29 && world.combo > 0) world.onCombo(0);
        if (local > 31 && world.combo > 0) world.onCombo(0);
    };

    return {
        cameraRadius: 1,
        camera() {},
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
        },
    };
}

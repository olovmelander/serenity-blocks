/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Moonlit Greenhouse — the full world + post stack, mounted in isolation.
 *
 * Mounts the SAME MoonlitGreenhouseWorld and MoonlitGreenhousePost the theme ships, with the
 * theme's camera rig, so composition and grade are judged exactly as they will look in game.
 *
 * URL params:
 *   quality=High|Ultra|...   content tier (default High)
 *   board=1                  overlay a mock gameplay board + HUD (the solo layout rules); events
 *                            aim at its rects and the post's calm zones read them
 *   statsHud=0               with board=1: board only, no HUD mock
 *   combo=<n>                hold a chain of n clears
 *   level=<n>                rest on level n (each level is one night further round the wheel)
 *   night=<place>            hold the night at a place on the wheel whatever the level and the
 *                            clock say: 0 silver moon, 1 lavender night, 2 jade dream, 3 harvest
 *                            moon, 4 rose nocturne, 5 blue hour; 2.5 is half-way from jade to harvest
 *   locks=<n>                before anything else, open n blooms in the garden
 *   event=lock|drop|clear|quad|tspin|perfect|levelUp|break   fire a gameplay event...
 *   eventAge=<s>             ...and show it <s> seconds later (lines=<n>, row=<r>, u=<0..1>,
 *                            color=<hex>, eventLevel=<n>)
 *   demo=1                   live only: play a looping gameplay script
 *   parts=glass,iron,...     draw only these parts (MOONLIT_GREENHOUSE_PARTS)
 *   falseColor=1             post debug view: band the pre-tone-map max channel
 *   noPost=1                 raw scene (no air, bloom or grade)
 *   bloom=0|1                override the tier's bloom
 *   px=-1..1&py=-1..1        hold a pointer-parallax offset
 *   reduce=1                 reduced motion
 *   seed=<n>                 the garden's seed (default 1861)
 *   P.<name>=<value>         override a number of the look (TUNE in moonlit-greenhouse-tsl.js)
 *   icon=1                   a tighter lens on the moon through the glass over the canal
 *                            (capture a square frame); iconFov, iconYaw, iconPitch adjust it
 */
import * as THREE from 'three/webgpu';
import { MoonlitGreenhouseWorld } from '../../themes/moonlit-greenhouse/moonlit-greenhouse-world.js';
import { MoonlitGreenhousePost, POST_LOOK } from '../../themes/moonlit-greenhouse/moonlit-greenhouse-post.js';
import { readLayoutRects } from '../../themes/moonlit-greenhouse/moonlit-greenhouse-composition.js';
import { MOONLIT_GREENHOUSE_TETROMINOS } from '../../themes/moonlit-greenhouse/moonlit-greenhouse-tetrominos.js';

export const meta = {
    id: 'moonlit-greenhouse',
    title: 'Moonlit Greenhouse (full world)',
    description: 'The night garden under glass: moonlight through the iron lattice, and the board makes it bloom.',
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

/** The game's piece colours (moonlit-greenhouse-tetrominos.js). */
const PIECE_COLORS = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'].map((k) => MOONLIT_GREENHOUSE_TETROMINOS.colors[k]);

/** A looping script of locks and clears for the live demo (seconds into the loop). */
const DEMO_LOOP = 40;
const DEMO_SCRIPT = [
    [1.0, 'lock', { rows: [19], u: 0.2 }], [2.1, 'lock', { rows: [19, 18], u: 0.75 }],
    [3.2, 'lock', { rows: [18, 17], u: 0.4, hardDrop: true }], [4.3, 'lock', { rows: [17], u: 0.85 }],
    [5.4, 'lock', { rows: [16], u: 0.1 }], [6.5, 'lock', { rows: [15, 14], u: 0.65 }],
    [7.6, 'lock', { rows: [19], u: 0.55 }], [7.6, 'clear', { rows: [19], lines: 1, combo: 1 }],
    [8.8, 'lock', { rows: [19, 18], u: 0.3 }], [8.8, 'clear', { rows: [19], lines: 1, combo: 2 }],
    [10.0, 'lock', { rows: [19, 18, 17], u: 0.8, hardDrop: true }],
    [10.0, 'clear', { rows: [19, 18], lines: 2, combo: 3 }],
    [11.2, 'lock', { rows: [19], u: 0.1 }], [11.2, 'clear', { rows: [19], lines: 1, combo: 4 }],
    [12.4, 'lock', { rows: [19, 18], u: 0.6 }], [12.4, 'clear', { rows: [19, 18, 17], lines: 3, combo: 5 }],
    [14.0, 'lock', { rows: [18, 17], u: 0.85 }], [15.2, 'lock', { rows: [17, 16], u: 0.35 }],
    [16.6, 'lock', { rows: [16, 15], u: 0.6, hardDrop: true }], [18.0, 'lock', { rows: [15, 14], u: 0.9 }],
    [19.4, 'lock', { rows: [14, 13], u: 0.05 }], [20.6, 'lock', { rows: [19], u: 0.45 }],
    [22.0, 'lock', { rows: [19, 18, 17, 16], u: 0.95, hardDrop: true }],
    [22.0, 'clear', { rows: [19, 18, 17, 16], lines: 4, combo: 1 }],
    [29.0, 'lock', { rows: [19], u: 0.45 }], [30.0, 'lock', { rows: [19, 18], u: 0.7 }],
    [31.0, 'lock', { rows: [18], u: 0.25, hardDrop: true }],
    [31.0, 'clear', {
        rows: [19, 18], lines: 2, tspin: true, combo: 1,
    }],
    [33.0, 'lock', { rows: [19], u: 0.5 }], [34.5, 'lock', { rows: [18], u: 0.15 }],
];

/** P.<name>=<value> → { name: value } (the look's numbers, TUNE). */
function tuneFrom(params) {
    const out = {};
    params.forEach((value, key) => {
        if (key.startsWith('P.')) out[key.slice(2)] = value;
    });
    return out;
}

export function create({
    scene, camera, renderer, params,
}) {
    const quality = params.get('quality') || 'High';
    const saved = {
        fov: camera.fov, near: camera.near, far: camera.far, toneMapping: renderer.toneMapping,
    };
    const world = new MoonlitGreenhouseWorld({
        scene,
        quality,
        capture: true,
        seed: Math.round(num(params, 'seed', 1861)),
        night: params.has('night') ? num(params, 'night', 0) : null,
        tune: tuneFrom(params),
    }).build();
    world.bindCamera(camera);
    world.setReducedMotion(params.get('reduce') === '1');
    const partsParam = params.get('parts');
    if (partsParam) world.showOnlyParts(partsParam.split(',').map((p) => p.trim()));

    const look = { ...(POST_LOOK[quality] || POST_LOOK.High) };
    if (params.has('bloom')) look.bloom = params.get('bloom') === '1';
    const noPost = params.get('noPost') === '1';
    const post = noPost ? null : new MoonlitGreenhousePost(renderer, scene, camera, {
        look,
        falseColor: params.get('falseColor') === '1',
        U: world.U,
        noise: world.noise,
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
        const rects = overlay ? readLayoutRects() : null;
        world.setLayout(rects, aspect);
        world.setViewport(size.x, size.y, aspect);
        post?.setSize(window.innerWidth, window.innerHeight, size.x, size.y);
        post?.setCalmRects(rects ? [...rects.cards, rects.hud].filter(Boolean) : [], rects ? 1 : 0);
    };
    syncViewport();

    const sim = (time, delta) => ({
        time, delta, pointerX: pointer.x, pointerY: pointer.y,
    });
    const pushPost = (time) => {
        post?.update({ ...world.getPostState(), time });
    };
    /** The theme's camera, or the icon's tighter lens. */
    const aim = (time, delta) => {
        world.updateCamera(camera, sim(time, delta));
        if (iconPose) {
            camera.fov = num(params, 'iconFov', 36);
            camera.rotateY(num(params, 'iconYaw', 0.32));
            camera.rotateX(num(params, 'iconPitch', 0.12));
            camera.updateProjectionMatrix();
            camera.updateMatrixWorld();
        }
    };
    const frame = (time, delta) => {
        aim(time, delta);
        world.update(sim(time, delta), camera);
    };
    const stepTo = (from, to, dt) => {
        const steps = Math.max(1, Math.round((to - from) / dt));
        const h = (to - from) / steps;
        for (let i = 1; i <= steps; i++) frame(from + i * h, h);
    };

    const eventName = params.get('event');
    const eventAge = num(params, 'eventAge', 0.6);
    const holdCombo = Math.max(0, Math.round(num(params, 'combo', 0)));
    const level = Math.max(1, Math.round(num(params, 'level', 1)));
    const warmLocks = Math.max(0, Math.round(num(params, 'locks', 0)));
    const colorParam = params.get('color');
    const eventColor = colorParam ? `#${colorParam.replace('#', '')}` : PIECE_COLORS[2];
    const fireEvent = () => {
        const row = Math.round(num(params, 'row', 16));
        const u = num(params, 'u', 0.2);
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
        else if (eventName === 'break') world.onCombo(0);
    };

    /** How long the world is played before a capture: the eased state settles. */
    const LEAD = 5;
    let sought = null;
    const seekTo = (time) => {
        // The playground seeks every frame while ?t= is pinned: replay once, then hold.
        if (sought === time) return;
        sought = time;
        const lead = (eventName ? eventAge : 0) + LEAD + warmLocks * 0.45 + (holdCombo ? 6 : 0);
        const start = Math.max(0, time - lead);
        world.seek(start);
        if (level > 1) world.levelUp(level, { silent: true });
        frame(start, 0);
        let cursor = start;
        if (holdCombo > 0) {
            // The chain is built a clear at a time, as play builds it.
            const settle = Math.min(1, lead * 0.2);
            stepTo(cursor, start + settle, 1 / 60);
            cursor = start + settle;
            for (let n = 1; n <= holdCombo; n += 1) world.onCombo(n);
        }
        const actions = [];
        const firstAct = eventName ? time - eventAge : time;
        const warmEnd = firstAct - 0.7;
        for (let i = 0; i < warmLocks; i++) {
            actions.push([warmEnd - (warmLocks - 1 - i) * 0.45, () => world.onLock({
                rows: [19 - ((i * 7) % 17), 18 - ((i * 7) % 17)],
                u: ((i * 0.37) % 1) * 0.9 + 0.05,
                color: PIECE_COLORS[i % PIECE_COLORS.length],
                hardDrop: i % 4 === 3,
            })]);
        }
        if (eventName) actions.push([time - eventAge, fireEvent]);
        actions.sort((a, b) => a[0] - b[0]);
        actions.forEach(([at, act]) => {
            if (at > cursor) {
                stepTo(cursor, at, 1 / 60);
                cursor = at;
            }
            act();
        });
        if (time > cursor) stepTo(cursor, time, 1 / 60);
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
                world.onLock({ ...detail, color: PIECE_COLORS[demoPiece % PIECE_COLORS.length] });
            } else {
                world.onClear(detail);
                world.onCombo(detail.combo);
            }
            demoCursor += 1;
        }
        // A chain that is not continued breaks on the next lock that clears nothing.
        if (local > 14 && local < 22 && world.combo > 0) world.onCombo(0);
        if (local > 23 && local < 31 && world.combo > 0) world.onCombo(0);
        if (local > 32 && world.combo > 0) world.onCombo(0);
    };

    return {
        cameraRadius: 1,
        camera(time) {
            aim(time, 0);
        },
        update(time, dt) {
            sought = null;
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
            camera.fov = saved.fov;
            camera.near = saved.near;
            camera.far = saved.far;
            camera.up.set(0, 1, 0);
            camera.updateProjectionMatrix();
        },
    };
}

/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sky Children (Irisfall) — the full world + post stack, mounted in isolation.
 *
 * Mounts the SAME SkyChildrenWorld and SkyChildrenPost the theme ships, with the theme's camera
 * rig, so composition and grade are judged exactly as they will look in game.
 *
 * URL params:
 *   quality=High|Ultra|...   content tier (default High)
 *   board=1                  overlay a mock gameplay card + HUD (the solo layout rules); the frame
 *                            is solved from their rects and the post's calm zones read them
 *   statsHud=0               with board=1: card only, no HUD mock
 *   players=2|4              with board=1: a row of mock cards (local multiplayer)
 *   hour=<place>             hold the light at a place on the wheel: 0 jade morning, 1 gilded
 *                            afternoon, 2 rose hour, 3 moonbow night, 4 pearl dawn (fractions blend)
 *   level=<n>                rest on level n (each level is one hour further round the wheel)
 *   combo=<n>                hold a chain of n (0..13): the bow painted stroke by stroke
 *   links=<letters>          the pieces whose locks made links 1..n (e.g. SJITZLO); trueBow=1
 *   linkAge=<s>              the last link of the chain was made <s> seconds before the frame
 *   held=<n>                 n pools holding colour before the event
 *   locks=<n>                n warm-up locks 0.45 s apart (every fourth a hard drop)
 *   event=lock|drop|clear|tspin|b2b|quad|perfect|levelUp|newRun|gameOver|break
 *   eventAge=<s>             …shown <s> seconds later (lines=<n>, row=<r>, u=<0..1>, color=<hex>,
 *                            shape=I..L, dropRows=<n>)
 *   parts=sky,isles,...      draw only these parts (sky, sea, cumulus, isles, falls, spray, pools, gliders, fx)
 *   noPost=1, bloom=0|1      raw scene / override the tier's bloom
 *   falseColor=1, values=1   post debug views (max channel bands / the value study)
 *   reduce=1, ripple=0       reduced motion / pieceLockRipple off
 *   px=-1..1&py=-1..1        hold a pointer-parallax offset
 *   seed=<n>                 world seed (default 33)
 *   P.<name>=<value>         override a number of the look (TUNE in sky-children-tsl.js)
 *   icon=1                   the icon lens (capture a square frame): iconFov, iconYaw, iconPitch
 */
import * as THREE from 'three/webgpu';
import { SkyChildrenWorld } from '../../themes/sky-children/sky-children-world.js';
import { POST_LOOK, SkyChildrenPost } from '../../themes/sky-children/sky-children-post.js';
import { readLayoutRects } from '../../themes/sky-children/sky-children-composition.js';
import { SKY_CHILDREN_TETROMINOS } from '../../themes/sky-children/sky-children-tetrominos.js';

export const meta = {
    id: 'sky-children',
    title: 'Sky Children (Irisfall)',
    description: 'Front-lit high country: travertine terraces, the falls into the Deep, the bow the chain paints.',
};

function num(params, key, fallback = 0) {
    const v = Number.parseFloat(params.get(key));
    return Number.isFinite(v) ? v : fallback;
}

const BOARD_PX = 'min(clamp(220px, 22vw, 300px), (100vh - 250px) / 2)';

/** A stand-in for the real solo layout (public/styles/main.css) with the real class names. */
function mountBoardOverlay(withHud, players) {
    const root = document.createElement('div');
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5';
    const portrait = window.innerWidth < window.innerHeight;
    const count = Math.max(1, players);
    const addCard = (left, width, height, id) => {
        const card = document.createElement('div');
        card.className = 'player-card';
        card.dataset.player = id;
        card.style.cssText = [
            'position:absolute', `left:${left}`, 'top:50%', `width:${width}`, `height:${height}`,
            'transform:translate(-50%, -50%)', 'background:rgba(21,26,35,0.866)',
            'border:1px solid rgba(139,92,246,0.45)', 'border-radius:20px',
        ].join(';');
        root.append(card);
    };
    if (portrait) {
        addCard('50%', '67.2vw', '70.8vh', 'solo');
    } else if (count === 1) {
        addCard('50%', `calc(${BOARD_PX} * 1.19)`, `calc(2 * ${BOARD_PX} + 158px)`, 'solo');
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
    } else {
        const w = Math.min(22, 80 / count);
        for (let i = 0; i < count; i++) {
            addCard(`${50 + (i - (count - 1) / 2) * (w + 2)}%`, `${w}vw`, '78vh', String(i + 1));
        }
    }
    document.body.appendChild(root);
    return root;
}

/** The game's piece colours (sky-children-tetrominos.js). */
const PIECES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
const COLOR_OF = (k) => SKY_CHILDREN_TETROMINOS.colors[k] || SKY_CHILDREN_TETROMINOS.colors.T;

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
    const world = new SkyChildrenWorld({
        scene,
        quality,
        capture: true,
        seed: Math.round(num(params, 'seed', 33)),
        hour: params.has('hour') ? num(params, 'hour', 0) : null,
        tune: tuneFrom(params),
    }).build();
    world.bindCamera(camera);
    world.setReducedMotion(params.get('reduce') === '1');
    const partsParam = params.get('parts');
    if (partsParam) world.showOnlyParts(partsParam.split(',').map((p) => p.trim()));

    const look = { ...(POST_LOOK[quality] || POST_LOOK.High) };
    if (params.has('bloom')) look.bloom = params.get('bloom') === '1';
    const noPost = params.get('noPost') === '1';
    const post = noPost ? null : new SkyChildrenPost(renderer, scene, camera, {
        look,
        falseColor: params.get('falseColor') === '1',
        values: params.get('values') === '1',
    });
    if (noPost) renderer.toneMapping = THREE.AgXToneMapping;
    const players = Math.max(1, Math.round(num(params, 'players', 1)));
    const overlay = params.get('board') === '1' ? mountBoardOverlay(params.get('statsHud') !== '0', players) : null;

    const pointer = { x: num(params, 'px'), y: num(params, 'py') };
    const iconPose = params.get('icon') === '1';
    const size = new THREE.Vector2(1, 1);
    const syncViewport = () => {
        const aspect = window.innerWidth / Math.max(1, window.innerHeight);
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
        renderer.getDrawingBufferSize(size);
        const rects = overlay ? readLayoutRects() : null;
        world.setViewport(size.x, size.y, aspect);
        world.setLayout(rects, aspect);
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
            camera.fov = num(params, 'iconFov', 30);
            camera.rotateY(num(params, 'iconYaw', 0.5));
            camera.rotateX(num(params, 'iconPitch', -0.05));
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
    const holdCombo = Math.max(0, Math.min(13, Math.round(num(params, 'combo', 0))));
    const level = Math.max(1, Math.round(num(params, 'level', 1)));
    const warmLocks = Math.max(0, Math.round(num(params, 'locks', 0)));
    const held = Math.max(0, Math.round(num(params, 'held', 0)));
    const linksParam = params.get('trueBow') === '1' ? 'SJITZLO' : (params.get('links') || '');
    const colorParam = params.get('color');
    const shapeParam = (params.get('shape') || 'T').toUpperCase();
    const eventColor = colorParam ? `#${colorParam.replace('#', '')}` : COLOR_OF(shapeParam);
    const silent = params.get('ripple') === '0';
    const lockOf = (i, extra = {}) => {
        const shape = PIECES[i % PIECES.length];
        return {
            rows: [19 - ((i * 7) % 17), 18 - ((i * 7) % 17)],
            u: ((i * 0.37) % 1) * 0.9 + 0.05,
            color: COLOR_OF(shape),
            shape,
            hardDrop: i % 4 === 3,
            silent,
            ...extra,
        };
    };
    const fireEvent = () => {
        const row = Math.round(num(params, 'row', 14));
        const u = num(params, 'u', 0.2);
        const lines = Math.max(1, Math.min(4, Math.round(num(params, 'lines', 2))));
        const bottom = (n) => Array.from({ length: n }, (_, i) => 19 - i);
        const combo = Math.max(1, holdCombo + 1);
        const lock = {
            rows: [row, row - 1], u, color: eventColor, shape: shapeParam, silent,
        };
        if (eventName === 'lock') world.onLock(lock);
        else if (eventName === 'drop') world.onLock({ ...lock, hardDrop: true, dropRows: Math.round(num(params, 'dropRows', 8)) });
        else if (eventName === 'clear') world.onClear({ rows: bottom(lines), lines, combo });
        else if (eventName === 'quad') world.onClear({ rows: bottom(4), lines: 4, combo });
        else if (eventName === 'tspin') {
            world.onClear({
                rows: bottom(2), lines: 2, tspin: true, combo,
            });
        } else if (eventName === 'b2b') {
            world.onClear({
                rows: bottom(2), lines: 2, b2b: true, combo,
            });
        } else if (eventName === 'perfect') {
            world.onClear({
                rows: bottom(4), lines: 4, perfect: true, combo,
            });
        } else if (eventName === 'levelUp') world.levelUp(num(params, 'eventLevel', level + 1));
        else if (eventName === 'newRun') world.resetSession();
        else if (eventName === 'gameOver') world.onGameOver();
        else if (eventName === 'break') world.onCombo(0);
    };

    /** How long the world is played before a capture: the eased state settles. */
    const LEAD = 5;
    let sought = null;
    const seekTo = (time) => {
        // The playground seeks every frame while ?t= is pinned: replay once, then hold.
        if (sought === time) return;
        sought = time;
        const lead = (eventName ? eventAge : 0) + LEAD + warmLocks * 0.45 + held * 0.2 + (holdCombo ? holdCombo * 1.1 + 2 : 0);
        const start = Math.max(0, time - lead);
        world.seek(start);
        if (level > 1) world.levelUp(level, { silent: true });
        frame(start, 0);
        let cursor = start;
        const actions = [];
        const firstAct = eventName ? time - eventAge : time;
        // Held pools: silent locks a while before everything else.
        for (let i = 0; i < held; i++) {
            actions.push([start + 0.1 + i * 0.2, () => world.onLock(lockOf(i, { silent: true, hardDrop: false }))]);
        }
        // The chain: one link a beat, each with the colour of the lock that made it (the last one
        // `linkAge` seconds before the frame when given, to catch a stroke being painted).
        const linkAge = params.has('linkAge') ? num(params, 'linkAge', 0.5) : null;
        for (let i = 0; i < holdCombo; i++) {
            // The fallback cycle repeats a piece within seven links (only trueBow=1 or links=
            // spelling all seven paints the true bow).
            const letter = (linksParam[i] || PIECES[(i * 3) % 6]).toUpperCase();
            const at = linkAge !== null && i === holdCombo - 1 ? time - linkAge : start + 0.4 + held * 0.2 + i * 1.1;
            actions.push([at, () => {
                world.noteLink?.(i + 1, COLOR_OF(letter), letter);
                world.onCombo(i + 1);
            }]);
        }
        const warmEnd = firstAct - 0.7;
        for (let i = 0; i < warmLocks; i++) {
            actions.push([warmEnd - (warmLocks - 1 - i) * 0.45, () => world.onLock(lockOf(i))]);
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

    return {
        cameraRadius: 1,
        camera(time) {
            aim(time, 0);
        },
        update(time, dt) {
            sought = null;
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

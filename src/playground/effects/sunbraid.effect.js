/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sunbraid — the full world + post stack, mounted in isolation.
 *
 * Mounts the SAME SunbraidWorld and SunbraidPost the theme ships, with the theme's camera rig, so
 * composition and grade are judged exactly as they will look in game.
 *
 * URL params:
 *   quality=High|Ultra|...   content tier (default High)
 *   board=1                  overlay a mock gameplay board + HUD (the solo layout rules)
 *   statsHud=0               with board=1: board only, no HUD mock
 *   braid=<degrees>          hold the braid at this phase (−90: the coral sun lowest; 0: on the right)
 *   parts=land,sky           draw only these parts
 *   falseColor=1             post debug view: band the pre-tone-map max channel
 *   noPost=1                 raw scene (no bloom/grade)
 *   bloom=0|1                override the tier's bloom
 *   msaa=<n>                 override the scene pass's samples
 *   px=-1..1&py=-1..1        hold a pointer-parallax offset
 *   reduce=1                 reduced motion
 *   look=x,y,z,fov           inspection lens: from the eye, look at a world point with this fov
 *   level=<n>                rest on level n (the braid wound on n − 1 sixths; the clock turns it too)
 *   event=lock|drop|clear|quad|tspin|perfect|levelUp|over|morning   fire a gameplay event...
 *   eventAge=<s>             ...and show it <s> seconds later (lines=<1..4>, turns=<1..3>)
 *   combo=<n>                hold a chain of n (the braid turns faster and opens wider)
 *   locks=<n>                before the event, play n locks
 *   eventLevel=<n>           the level an event=levelUp steps to (default level + 1)
 *   demo=1                   live: a looping gameplay script
 */
import * as THREE from 'three/webgpu';
import { SunbraidWorld } from '../../themes/sunbraid/sunbraid-world.js';
import { SunbraidPost, POST_LOOK } from '../../themes/sunbraid/sunbraid-post.js';
import { readLayoutRects } from '../../themes/sunbraid/sunbraid-composition.js';
import { DEG } from '../../themes/sunbraid/sunbraid-core.js';

/** A looping script for the live demo (seconds into the loop). */
const DEMO_LOOP = 40;
const DEMO_SCRIPT = [
    [1.0, 'lock'], [2.2, 'lock'], [3.4, 'drop'], [4.6, 'lock'],
    [5.8, 'lock'], [5.8, 'clear', { lines: 1, combo: 1 }],
    [7.0, 'lock'], [7.0, 'clear', { lines: 1, combo: 2 }],
    [8.2, 'drop'], [8.2, 'clear', { lines: 2, combo: 3 }],
    [9.4, 'lock'], [9.4, 'clear', { lines: 1, combo: 4 }],
    [10.6, 'lock'], [10.6, 'clear', { lines: 3, combo: 5 }],
    [12.0, 'lock'], [13.2, 'lock'], [14.4, 'lock'], [15.6, 'drop'],
    [17.0, 'drop'], [17.0, 'clear', { lines: 4, combo: 1 }],
    [24.0, 'lock'], [25.2, 'lock'],
    [26.4, 'lock'], [26.4, 'clear', { lines: 2, tspin: true, combo: 1 }],
    [30.0, 'lock'],
];

export const meta = {
    id: 'sunbraid',
    title: 'Sunbraid (full world)',
    description: 'A pale valley under a triple star of coloured suns: every tower throws a fan of coloured shadows.',
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

export function create({
    scene, camera, renderer, params,
}) {
    const quality = params.get('quality') || 'High';
    const saved = {
        fov: camera.fov, near: camera.near, far: camera.far, toneMapping: renderer.toneMapping,
    };
    let world = null;
    let disposed = false;
    let assets = 'loading';
    let settledFrames = 0;
    const overlay = params.get('board') === '1' ? mountBoardOverlay(params.get('statsHud') !== '0') : null;
    const look = { ...(POST_LOOK[quality] || POST_LOOK.High) };
    if (params.has('bloom')) look.bloom = params.get('bloom') === '1';
    const samples = params.has('msaa') ? Math.max(0, Math.round(num(params, 'msaa'))) : look.msaa;
    const noPost = params.get('noPost') === '1';
    if (noPost) renderer.toneMapping = THREE.AgXToneMapping;
    let post = null;
    const pointer = { x: num(params, 'px'), y: num(params, 'py') };
    const braidHold = params.has('braid') ? num(params, 'braid', 0) * DEG : null;
    const level = Math.max(1, Math.round(num(params, 'level', 1)));
    const eventName = params.get('event');
    const eventAge = num(params, 'eventAge', 0.6);
    const holdCombo = Math.max(0, Math.round(num(params, 'combo', 0)));
    const warmLocks = Math.max(0, Math.round(num(params, 'locks', 0)));
    const demo = params.get('demo') === '1';
    let demoCursor = 0;
    let demoLoop = -1;
    const lookAt = (params.get('look') || '').split(',').map(Number);
    const inspect = lookAt.length >= 3 && lookAt.slice(0, 3).every(Number.isFinite);
    const size = new THREE.Vector2(1, 1);
    let lastSeek = null;
    let simTime = 0;

    const syncViewport = () => {
        const aspect = window.innerWidth / Math.max(1, window.innerHeight);
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
        renderer.getDrawingBufferSize(size);
        if (!world) return;
        world.setViewport(size.x, size.y, aspect);
        post?.setSize(window.innerWidth, window.innerHeight, size.x, size.y);
        const rects = overlay ? readLayoutRects() : null;
        world.setLayout(rects, aspect);
        post?.setCalmRects(rects ? [...rects.cards, rects.hud].filter(Boolean) : [], rects ? 1 : 0);
    };

    const sim = (time, delta) => ({
        time, delta, pointerX: pointer.x, pointerY: pointer.y,
    });
    const frame = (time, delta) => {
        if (!world) return;
        world.updateCamera(camera, sim(time, delta));
        if (inspect) {
            camera.fov = Number.isFinite(lookAt[3]) ? lookAt[3] : 20;
            camera.lookAt(lookAt[0], lookAt[1], lookAt[2]);
            camera.updateProjectionMatrix();
            camera.updateMatrixWorld();
        }
        world.update(sim(time, delta), camera);
        post?.update({ ...world.getPostState(), time });
    };
    const fireEvent = () => {
        const lines = Math.max(1, Math.min(4, Math.round(num(params, 'lines', 2))));
        if (eventName === 'lock') world.onLock({ rows: [13, 12], u: 0.3 });
        else if (eventName === 'drop') world.onLock({ rows: [13, 12], u: 0.3, hardDrop: true });
        else if (eventName === 'clear') world.onClear({ lines, combo: Math.max(1, holdCombo) });
        else if (eventName === 'quad') world.onClear({ lines: 4, combo: Math.max(1, holdCombo) });
        else if (eventName === 'tspin') {
            const turns = Math.max(1, Math.min(3, Math.round(num(params, 'turns', 2))));
            world.onClear({ lines: turns, tspin: true });
        } else if (eventName === 'perfect') world.onClear({ lines: 4, perfect: true });
        else if (eventName === 'levelUp') world.levelUp(num(params, 'eventLevel', level + 1));
        else if (eventName === 'over') world.onGameOver();
        else if (eventName === 'morning') {
            world.onGameOver();
            world.onSessionStart();
        }
    };
    const stepTo = (from, to, dt) => {
        const steps = Math.max(1, Math.round((to - from) / dt));
        const h = (to - from) / steps;
        for (let i = 1; i <= steps; i++) frame(from + i * h, h);
    };
    const seekTo = (asked) => {
        lastSeek = asked;
        simTime = asked;
        if (!world) return;
        // Events fire inside a short replay before the asked frame (a chain needs time to build).
        const lead = (eventName ? eventAge : 0) + (holdCombo ? 5 : 0) + warmLocks * 0.6
            + (eventName === 'morning' ? 7 : 0) + 0.5;
        const time = Math.max(asked, lead);
        const start = time - lead;
        world.seek(start);
        if (level > 1) world.levelUp(level, { silent: true, time: start });
        frame(start, 0);
        let cursor = start;
        if (holdCombo) {
            for (let n = 1; n <= holdCombo; n++) {
                world.onClear({ lines: 1, combo: n });
                world.onCombo(n);
                const at = cursor + 5 / holdCombo;
                stepTo(cursor, at, 0.05);
                cursor = at;
            }
        }
        for (let i = 0; i < warmLocks; i++) {
            const at = cursor + 0.6;
            stepTo(cursor, at, 0.05);
            cursor = at;
            world.onLock({ rows: [19 - (i % 9)], u: ((i * 0.37) % 1) * 0.9 + 0.05, hardDrop: i % 4 === 3 });
        }
        const eventTime = eventName ? time - eventAge : time;
        if (eventTime > cursor) stepTo(cursor, eventTime, 0.05);
        if (eventName) {
            if (eventName === 'morning') {
                world.onGameOver();
                stepTo(eventTime, eventTime + 7, 0.05);
                world.onSessionStart();
                stepTo(eventTime + 7, time, 1 / 60);
            } else {
                fireEvent();
                stepTo(eventTime, time, 1 / 60);
            }
        }
        frame(time, 0);
    };
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
            if (verb === 'lock') world.onLock({ rows: [18], u: 0.4 });
            else if (verb === 'drop') world.onLock({ rows: [18], u: 0.6, hardDrop: true });
            else {
                world.onClear({ ...detail });
                world.onCombo(detail.combo);
            }
            demoCursor += 1;
        }
        if (local > 12.0 && local < 17 && world.combo > 0) world.onCombo(0);
        if (local > 20 && local < 26 && world.combo > 0) world.onCombo(0);
        if (local > 30 && world.combo > 0) world.onCombo(0);
    };

    SunbraidWorld.prepare(quality).then((prepared) => {
        if (disposed) return;
        world = new SunbraidWorld({
            scene,
            quality,
            capture: true,
            prepared,
            samples: noPost ? 0 : samples,
        }).build();
        world.bindCamera(camera);
        world.setReducedMotion(params.get('reduce') === '1');
        if (braidHold !== null) world.setCaptureOverrides({ phase: braidHold });
        const partsParam = params.get('parts');
        if (partsParam) world.showOnlyParts(partsParam.split(',').map((p) => p.trim()));
        if (!noPost) {
            post = new SunbraidPost(renderer, scene, camera, {
                look,
                samples,
                u: world.u,
                t: world.textures,
                falseColor: params.get('falseColor') === '1',
            });
        }
        world.setAirMarch(Boolean(post?.marches));
        syncViewport();
        seekTo(lastSeek ?? simTime);
        assets = 'ready';
    }).catch((error) => {
        assets = 'failed';
        console.error('[sunbraid effect] prepare failed:', error);
    });

    return {
        cameraRadius: 1,
        camera(time, cam) {
            world?.updateCamera(cam, sim(time, 0));
        },
        update(time, dt) {
            simTime = time;
            if (world && demo) runDemo(time);
            frame(time, dt);
        },
        seek(time) {
            demoLoop = -1;
            seekTo(time);
        },
        render() {
            if (!world) {
                renderer.render(scene, camera);
                return;
            }
            world.prerender(renderer, camera);
            if (post) post.render();
            else renderer.render(scene, camera);
            settledFrames += 1;
        },
        resize() {
            syncViewport();
            if (lastSeek !== null) seekTo(lastSeek);
        },
        getDiagnostics() {
            return {
                backend: renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2',
                assets,
                settledFrames,
                calls: renderer.info?.render?.calls ?? null,
                triangles: renderer.info?.render?.triangles ?? null,
                ...(world ? world.getState() : {}),
            };
        },
        dispose() {
            disposed = true;
            overlay?.remove();
            post?.dispose();
            world?.dispose();
            renderer.toneMapping = saved.toneMapping;
            camera.fov = saved.fov;
            camera.near = saved.near;
            camera.far = saved.far;
            camera.updateProjectionMatrix();
        },
    };
}

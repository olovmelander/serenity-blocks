/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Cosmic Noir — the full world + post stack, mounted in isolation.
 *
 * Mounts the SAME CosmicNoirWorld and CosmicNoirPost the theme ships, with the theme's camera rig,
 * so composition and the print's grade are judged exactly as they will look in game.
 *
 * URL params:
 *   quality=High|Ultra|...   content tier (default High)
 *   board=1                  overlay a mock gameplay board + HUD (the solo layout rules); events
 *                            aim at its rects and the post's calm zones read them
 *   statsHud=0               with board=1: board only, no HUD mock
 *   combo=<n>                hold a combo of n (the lighthouse spun up, the blinds open)
 *   level=<n>                rest n − 1 stocks along the line (the level's own reel)
 *   event=lock|drop|clear|quad|tspin|perfect|levelUp   fire a gameplay event...
 *   eventAge=<s>             ...and show it <s> seconds later (lines=<n>, row=<r>, u=<0..1>)
 *   demo=1                   live only: play a looping gameplay script
 *   parts=sky,smoke          draw only these parts (sky alone: the smoke switched off)
 *   falseColor=1             post debug view: band the pre-tone-map max channel
 *   noPost=1                 raw scene (no halation/grade)
 *   bloom=0|1                override the tier's halation
 *   grain=0                  no grain or dust (judge the grade itself)
 *   px=-1..1&py=-1..1        hold a pointer-parallax offset
 *   reduce=1                 reduced motion
 *   icon=1                   the theme-icon framing: the lens looks straight at the lantern
 *                            (iconFov=34; compose for a small circle: capture a square frame)
 *
 * Probes: window.__cosmicNoir = { world, post, seekEvent(t, { name, age, lines, combo, level }) }
 * replays any event at any age and renders it in the same task (contact sheets).
 */
import * as THREE from 'three/webgpu';
import { CosmicNoirWorld } from '../../themes/cosmic-noir/cosmic-noir-world.js';
import { CosmicNoirPost, POST_LOOK } from '../../themes/cosmic-noir/cosmic-noir-post.js';
import { readLayoutRects } from '../../themes/cosmic-noir/cosmic-noir-composition.js';
import { PULSAR } from '../../themes/cosmic-noir/cosmic-noir-core.js';

export const meta = {
    id: 'cosmic-noir',
    title: 'Cosmic Noir (full world)',
    description: 'Smoke in the searchlight: a pulsar in a shutter cage sweeps its beams through drifting smoke, printed in black and white.',
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
    const world = new CosmicNoirWorld({
        scene, quality, capture: true, renderer,
    }).build();
    world.bindCamera(camera);
    world.setReducedMotion(params.get('reduce') === '1');
    const partsParam = params.get('parts');
    if (partsParam) world.showOnlyParts(partsParam.split(',').map((p) => p.trim()));

    const look = { ...(POST_LOOK[quality] || POST_LOOK.High) };
    if (params.has('bloom')) {
        look.bloom = params.get('bloom') === '1';
        if (look.bloom && !(look.bloomStrength > 0)) look.bloomStrength = POST_LOOK.Medium.bloomStrength;
    }
    const noPost = params.get('noPost') === '1';
    const post = noPost ? null : new CosmicNoirPost(renderer, scene, camera, {
        look,
        falseColor: params.get('falseColor') === '1',
        grain: params.get('grain') !== '0',
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
        // The icon lens looks straight at the lantern.
        camera.fov = num(params, 'iconFov', 34);
        camera.updateProjectionMatrix();
        camera.up.set(0, 1, 0);
        camera.lookAt(0, 0, -PULSAR.depth);
        camera.updateMatrixWorld();
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
        // Only the last frame of a replay is looked at: the others need not paint the smoke.
        for (let i = 1; i <= steps; i++) frame(from + i * h, h, false);
    };

    const urlEvent = {
        name: params.get('event'),
        age: num(params, 'eventAge', 0.4),
        lines: Math.max(1, Math.min(4, Math.round(num(params, 'lines', 2)))),
        row: Math.round(num(params, 'row', 9)),
        u: num(params, 'u', 0.3),
        combo: Math.max(0, Math.round(num(params, 'combo', 0))),
        level: Math.max(1, Math.round(num(params, 'level', 1))),
    };
    let ev = urlEvent;
    const fireEvent = () => {
        const bottom = (n) => Array.from({ length: n }, (_, i) => 19 - i);
        const { name, row, u } = ev;
        if (name === 'lock') world.onLock({ rows: [row, row - 1], u });
        else if (name === 'drop') world.onLock({ rows: [row, row - 1], u, hardDrop: true });
        else if (name === 'clear') world.onClear({ rows: bottom(ev.lines), lines: ev.lines });
        else if (name === 'quad') world.onClear({ rows: bottom(4), lines: 4 });
        else if (name === 'tspin') world.onClear({ rows: bottom(2), lines: 2, tspin: true });
        else if (name === 'perfect') world.onClear({ rows: bottom(4), lines: 4, perfect: true });
        else if (name === 'levelUp') world.levelUp(ev.level + 1);
    };

    const seekTo = (time) => {
        const lead = ev.name ? ev.age : 0;
        const start = Math.max(0, time - lead);
        // The level's own reel (steps from home), no reel change.
        world.takeCarry({ level: ev.level, levelSteps: ev.level - 1 });
        world.seek(start);
        if (ev.combo > 0) world.onCombo(ev.combo);
        frame(start, 0, false);
        if (ev.name) {
            fireEvent();
            stepTo(start, time, 1 / 120);
        }
        frame(time, 0);
        pushPost(time);
    };
    /** Probes: replay any event at any age and render it now. Returns the canvas. */
    const seekEvent = (time, spec = null) => {
        ev = spec ? { ...urlEvent, ...spec } : urlEvent;
        seekTo(time);
        if (post) post.render();
        else renderer.render(scene, camera);
        return renderer.domElement;
    };
    /**
     * Probes: a contact sheet in the page. `tiles` = [{ t, ev?, label? } | t]; each tile is set,
     * left two frames to settle (the loop uploads its uniform arrays), re-rendered and copied in
     * the same task. The sheet is a fixed canvas over the page, for one screenshot.
     */
    const sheet = async (tilesIn, cols = 3) => {
        const tiles = tilesIn.map((x) => (typeof x === 'number' ? { t: x } : x));
        const src = renderer.domElement;
        const cw = Math.floor(1590 / cols);
        const ch = Math.round((cw * src.height) / src.width);
        let el = document.getElementById('__sheet');
        if (!el) {
            el = document.createElement('canvas');
            el.id = '__sheet';
            document.body.appendChild(el);
        }
        el.width = cw * cols;
        el.height = ch * Math.ceil(tiles.length / cols);
        el.style.cssText = `position:fixed;left:0;top:0;z-index:99999;background:#000;width:${el.width}px;height:${el.height}px`;
        const ctx = el.getContext('2d');
        const P = window.__PLAYGROUND__;
        for (let i = 0; i < tiles.length; i++) {
            const tile = tiles[i];
            const spec = tile.ev || { name: null };
            P?.setTime?.(tile.t);
            seekEvent(tile.t, spec);
            // The tiles are sequential: each settles two frames before it is copied.
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(() => r())); });
            ctx.drawImage(seekEvent(tile.t, spec), (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch);
            const d = world.getState();
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect((i % cols) * cw, Math.floor(i / cols) * ch, cw, 18);
            ctx.fillStyle = '#fff';
            ctx.font = '12px monospace';
            ctx.fillText(
                `${tile.label || `t=${tile.t}`} | ${d.stock} spin ${d.spinPhase.toFixed(2)} glare ${d.glare.toFixed(2)}`,
                (i % cols) * cw + 4,
                Math.floor(i / cols) * ch + 13,
            );
        }
        seekEvent(tiles[tiles.length - 1].t, { name: null });
        return [el.width, el.height];
    };
    window.__cosmicNoir = {
        world, post, seekEvent, sheet, clearSheet: () => document.getElementById('__sheet')?.remove(),
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
            if (verb === 'lock') world.onLock(detail);
            else {
                world.onClear(detail);
                world.onCombo(detail.combo);
            }
            demoCursor += 1;
        }
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
            if (window.__cosmicNoir?.world === world) delete window.__cosmicNoir;
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

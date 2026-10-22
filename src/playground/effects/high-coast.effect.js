/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * High Coast — the full world + post stack, mounted in isolation.
 *
 * Mounts the SAME HighCoastWorld and HighCoastPost the theme ships, with the theme's camera rig,
 * so composition and grade are judged exactly as they will look in game. The baked coast loads
 * asynchronously: `diagnostics().assets` is 'loading' until it is in, and `settledFrames` counts
 * the frames drawn since (captures wait for both).
 *
 * URL params:
 *   quality=High|Ultra|...   content tier (default High)
 *   board=1                  overlay a mock gameplay board + HUD (the solo layout rules)
 *   statsHud=0               with board=1: board only, no HUD mock
 *   level=<n>                level n's station of the day (the light also turns with the clock
 *                            alone, one station every 100 s of `t` and never resting, so t=10 is
 *                            already a little past the level's own station)
 *   hour=<place>             hold the light at a wheel place (0 golden hour, 1 sunset, 2 light
 *                            night, 3 dawn mist, 4 morning, 5 afternoon; fractions run the day
 *                            between them)
 *   parts=land,sea           draw only these parts
 *   falseColor=1             post debug view: band the pre-tone-map max channel
 *   noPost=1                 raw scene (no bloom/grade)
 *   bloom=0|1                override the tier's bloom
 *   msaa=<n>                 override the scene pass's samples (the theme's: 4 from High up, else
 *                            0, with FXAA on Medium and Low); the pine's needles follow it
 *   px=-1..1&py=-1..1        hold a pointer-parallax offset
 *   reduce=1                 reduced motion
 *   look=x,y,z,fov           inspection lens: from the eye, look at a world point with this fov
 *   event=lock|drop|clear|quad|tspin|perfect|levelUp|release|over   fire a gameplay event...
 *   eventAge=<s>             ...and show it <s> seconds later (u=<0..1> column, row=<0..19>,
 *                            lines=<1..4>, color=<hex>, peak=<n> for release)
 *   combo=<n>                hold a chain of n (each link lifts the land further)
 *   b2b=<0..4>               hold a back-to-back level (the lighthouse)
 *   lift=<m>                 before anything else, raise the land by this many metres
 *   locks=<n>                before the event, play n locks (and clears=<n> single-line clears)
 *   eventLevel=<n>           the level an event=levelUp steps to (default level + 1)
 *   demo=1                   live: a looping gameplay script
 */
import * as THREE from 'three/webgpu';
import { HighCoastWorld } from '../../themes/high-coast/high-coast-world.js';
import { HighCoastPost, POST_LOOK } from '../../themes/high-coast/high-coast-post.js';
import { readLayoutRects } from '../../themes/high-coast/high-coast-composition.js';
import { HIGH_COAST_TETROMINOS } from '../../themes/high-coast/high-coast-tetrominos.js';

/** The game's piece colours, and a ten-cell row of codes for synthetic clears. */
const PIECE_COLORS = Object.values(HIGH_COAST_TETROMINOS.colors).slice(0, 7);
const ROW_CODES = (k) => Array.from({ length: 10 }, (_, c) => (k * 3 + c * 2 + (c > 5 ? 1 : 0)) % 7);

/** A looping script for the live demo (seconds into the loop). */
const DEMO_LOOP = 40;
const DEMO_SCRIPT = [
    [1.0, 'lock', { rows: [19], u: 0.15 }], [2.2, 'lock', { rows: [18, 17], u: 0.82 }],
    [3.4, 'lock', {
        rows: [17], u: 0.35, hardDrop: true, distance: 14,
    }], [4.6, 'lock', { rows: [16], u: 0.66 }],
    [5.8, 'lock', { rows: [19], u: 0.5 }], [5.8, 'clear', { lines: 1, combo: 1 }],
    [7.0, 'lock', { rows: [19, 18], u: 0.25 }], [7.0, 'clear', { lines: 1, combo: 2 }],
    [8.2, 'lock', {
        rows: [19, 18], u: 0.75, hardDrop: true, distance: 10,
    }], [8.2, 'clear', { lines: 2, combo: 3 }],
    [9.4, 'lock', { rows: [19], u: 0.1 }], [9.4, 'clear', { lines: 1, combo: 4 }],
    [10.6, 'lock', { rows: [18], u: 0.9 }], [10.6, 'clear', { lines: 3, combo: 5 }],
    [12.0, 'lock', { rows: [17], u: 0.45 }], [13.2, 'lock', { rows: [16, 15], u: 0.6 }],
    [14.4, 'lock', { rows: [15], u: 0.2 }], [15.6, 'lock', {
        rows: [14], u: 0.8, hardDrop: true, distance: 16,
    }],
    [17.0, 'lock', {
        rows: [19, 18, 17, 16], u: 0.95, hardDrop: true, distance: 18,
    }], [17.0, 'clear', { lines: 4, combo: 1 }],
    [24.0, 'lock', { rows: [19], u: 0.3 }], [25.2, 'lock', { rows: [18], u: 0.7 }],
    [26.4, 'lock', { rows: [19, 18], u: 0.2, color: '#F59A2E' }], [26.4, 'clear', { lines: 2, tspin: true, combo: 1 }],
    [30.0, 'lock', { rows: [19], u: 0.55 }],
];

export const meta = {
    id: 'high-coast',
    title: 'High Coast (full world)',
    description: 'A granite summit over a pine archipelago; every clear lifts the land out of the sea.',
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
    const level = Math.max(1, Math.round(num(params, 'level', 1)));
    const hourHold = params.has('hour') ? num(params, 'hour', 0) : null;
    const eventName = params.get('event');
    const eventAge = num(params, 'eventAge', 0.6);
    const holdCombo = Math.max(0, Math.round(num(params, 'combo', 0)));
    const holdB2B = Math.max(0, Math.min(4, Math.round(num(params, 'b2b', 0))));
    const holdLift = Math.max(0, num(params, 'lift', 0));
    const warmLocks = Math.max(0, Math.round(num(params, 'locks', 0)));
    const warmClears = Math.max(0, Math.round(num(params, 'clears', 0)));
    const colorParam = params.get('color');
    const eventColor = colorParam ? `#${colorParam.replace('#', '')}` : PIECE_COLORS[0];
    const demo = params.get('demo') === '1';
    let demoCursor = 0;
    let demoLoop = -1;
    let demoPiece = 0;
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
        const row = num(params, 'row', 13);
        const u = num(params, 'u', 0.22);
        const lines = Math.max(1, Math.min(4, Math.round(num(params, 'lines', 2))));
        const codes = (n) => Array.from({ length: n }, (_, k) => ROW_CODES(k)).flat();
        if (eventName === 'lock') world.onLock({ rows: [row, row - 1], u, color: eventColor });
        else if (eventName === 'drop') {
            world.onLock({
                rows: [row, row - 1], u, hardDrop: true, distance: 16, color: eventColor,
            });
        } else if (eventName === 'clear') world.onClear({ lines, rowCodes: codes(lines), combo: Math.max(1, holdCombo) });
        else if (eventName === 'quad') world.onClear({ lines: 4, rowCodes: codes(4), combo: Math.max(1, holdCombo) });
        else if (eventName === 'tspin') {
            world.onClear({
                lines: 2, rowCodes: codes(2), tspin: true, u, color: PIECE_COLORS[1],
            });
        } else if (eventName === 'perfect') world.onClear({ lines: 4, perfect: true });
        else if (eventName === 'levelUp') world.levelUp(num(params, 'eventLevel', level + 1));
        else if (eventName === 'release') {
            const peak = Math.max(3, Math.round(num(params, 'peak', 6)));
            for (let n = 1; n <= peak; n++) world.onCombo(n);
            world.onCombo(0);
        } else if (eventName === 'over') world.onGameOver();
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
        // Events fire inside a short replay before the asked frame (a chain needs time to rise).
        const lead = (eventName ? eventAge : 0) + (holdCombo ? 6 : 0) + (holdLift ? 4 : 0) + (holdB2B ? 4 : 0) + warmLocks * 0.6 + 0.5;
        const time = Math.max(asked, lead);
        const start = time - lead;
        world.seek(start);
        if (level > 1) world.levelUp(level, { silent: true, time: start });
        if (holdB2B) world.onB2B(holdB2B);
        frame(start, 0);
        let cursor = start;
        if (holdLift) {
            world.liftAsk = Math.min(28, holdLift);
            world.drainSwell.hit(0.8, cursor);
            stepTo(cursor, cursor + 4, 0.05);
            cursor += 4;
        }
        if (holdCombo) {
            for (let n = 1; n <= holdCombo; n++) {
                world.onClear({ lines: 1, rowCodes: ROW_CODES(n), combo: n });
                world.onCombo(n);
                const at = cursor + 6 / holdCombo;
                stepTo(cursor, at, 0.05);
                cursor = at;
            }
        }
        for (let i = 0; i < warmLocks; i++) {
            const at = cursor + 0.6;
            stepTo(cursor, at, 0.05);
            cursor = at;
            world.onLock({
                rows: [19 - (i % 9)], u: ((i * 0.37) % 1) * 0.9 + 0.05, color: PIECE_COLORS[i % PIECE_COLORS.length], hardDrop: i % 4 === 3, distance: 12,
            });
            if (warmClears > 0 && i % Math.max(1, Math.floor(warmLocks / warmClears)) === 0) {
                world.onClear({ lines: 1, rowCodes: ROW_CODES(i), combo: 1 });
            }
        }
        const eventTime = eventName ? time - eventAge : time;
        if (eventTime > cursor) stepTo(cursor, eventTime, 0.05);
        if (eventName) {
            fireEvent();
            stepTo(eventTime, time, 1 / 60);
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
            if (verb === 'lock') {
                demoPiece += 1;
                world.onLock({ color: PIECE_COLORS[demoPiece % PIECE_COLORS.length], ...detail });
            } else {
                const base = demoPiece;
                world.onClear({ rowCodes: Array.from({ length: detail.lines }, (_, k) => ROW_CODES(k + base)).flat(), ...detail });
                world.onCombo(detail.combo);
            }
            demoCursor += 1;
        }
        if (local > 12.0 && local < 17 && world.combo > 0) world.onCombo(0);
        if (local > 20 && local < 26 && world.combo > 0) world.onCombo(0);
        if (local > 30 && world.combo > 0) world.onCombo(0);
    };

    HighCoastWorld.prepare(quality).then((prepared) => {
        if (disposed) return;
        world = new HighCoastWorld({
            scene, quality, capture: true, prepared, samples: noPost ? 0 : samples,
        }).build();
        world.bindCamera(camera);
        world.setReducedMotion(params.get('reduce') === '1');
        if (hourHold !== null) world.setCaptureOverrides({ hour: hourHold });
        const partsParam = params.get('parts');
        if (partsParam) world.showOnlyParts(partsParam.split(',').map((p) => p.trim()));
        if (!noPost) {
            post = new HighCoastPost(renderer, scene, camera, {
                look,
                samples,
                falseColor: params.get('falseColor') === '1',
            });
        }
        syncViewport();
        seekTo(lastSeek ?? simTime);
        assets = 'ready';
    }).catch((error) => {
        assets = 'failed';
        console.error('[high-coast effect] prepare failed:', error);
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
            world.prerender(renderer);
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

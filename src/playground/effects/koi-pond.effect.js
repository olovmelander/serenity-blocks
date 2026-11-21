/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Koi Pond — the full world + post stack, mounted in isolation.
 *
 * Mounts the SAME KoiPondWorld and KoiPondPost the theme ships, with the theme's camera rig, so
 * composition and grade are judged exactly as they will look in game.
 *
 * URL params:
 *   quality=High|Ultra|...   content tier (default High)
 *   board=1                  overlay a mock gameplay board + HUD (the solo layout rules); events
 *                            aim at its rects and the post's calm zones read them
 *   statsHud=0               with board=1: board only, no HUD mock
 *   combo=<n>                hold a chain of n clears
 *   level=<n>                rest on level n: its night on the wheel of six (koi-pond-moods.js). The
 *                            clock turns the same wheel, one night every 90 s: t=99 is the second night
 *                            at rest, t=135 half-way from the second to the third
 *   locks=<n>                before anything else, play n locks
 *   from=<s>                 replay every frame from <s> (instead of a fixed lead before t), so a
 *                            run of t= frames is one continuous take (the event, if any, still
 *                            fires at t - eventAge)
 *   event=lock|drop|clear|quad|twist|spin|b2b|cascade|combo|break|perfect|crown|levelUp|gameOver
 *                            perfect plays a quad and its delayed crown; crown plays the crown alone
 *   eventAge=<s>             ...and show it <s> seconds later (lines=<n>, row=<r>, u=<0..1>,
 *                            color=<hex>)
 *   demo=1                   live only: play a looping gameplay script
 *   parts=ground,koi,...     draw only these parts
 *   falseColor=1             post debug view: band the pre-tone-map max channel
 *   noPost=1                 raw scene (no bloom/grade)
 *   bloom=0|1                override the tier's bloom
 *   px=-1..1&py=-1..1        hold a pointer-parallax offset
 *   reduce=1                 reduced motion
 *   seed=<n>                 a different school of koi
 *   icon=1                   a tighter lens on one reach of the pond (capture a square frame);
 *                            iconFov, iconX, iconZ, iconYaw, iconPitch adjust it
 *   icon=2                   the theme icon: three koi posed nose to tail round a point (iconX,
 *                            iconZ), a lily lit beside them, seen from nearly overhead (iconFov)
 */
import * as THREE from 'three/webgpu';
import { KoiPondWorld } from '../../themes/koi-pond/koi-pond-world.js';
import { KoiPondPost, POST_LOOK } from '../../themes/koi-pond/koi-pond-post.js';
import { fallbackLayout, readLayoutRects } from '../../themes/koi-pond/koi-pond-composition.js';
import { KOI_POND_TETROMINOS } from '../../themes/koi-pond/koi-pond-tetrominos.js';
import { SHAPES } from '../../core/constants.js';
import { drawLandingShadowCanvas, drawPieceSolid, trimShape } from '../../rendering/canvas/canvas-drawing-utils.js';

export const meta = {
    id: 'koi-pond',
    title: 'Koi Pond (full world)',
    description: 'A moonlit pond seen from above: living koi, real ripples and caustics; the board plays the water.',
};

function num(params, key, fallback = 0) {
    const v = Number.parseFloat(params.get(key));
    return Number.isFinite(v) ? v : fallback;
}

/** The real solo well's dimensions and piece drawing, without starting a playable board. */
function mountBoardOverlay(withHud) {
    const root = document.createElement('div');
    root.className = 'single-player-stage';
    root.dataset.board = 'well';
    root.setAttribute('aria-hidden', 'true');
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;overflow:hidden';
    const card = document.createElement('div');
    card.id = 'single-player-card';
    card.className = 'player-card single-player-card';
    card.dataset.player = 'solo';
    const queue = document.createElement('div');
    queue.className = 'player-next-pieces';
    queue.style.cssText = 'display:flex;align-items:end;justify-content:center;gap:8px';
    const board = document.createElement('canvas');
    board.id = 'single-player-game-canvas';
    board.width = 360;
    board.height = 720;
    board.style.borderRadius = '0 0 10px 10px';
    board.style.background = 'linear-gradient(rgba(9,8,24,.3),rgba(9,8,24,.84) 16%,rgba(9,8,24,.9))';
    const wall = document.createElement('div');
    wall.id = 'single-player-border';
    wall.style.cssText = 'border:3px solid #72a69b;border-top:0;border-radius:0 0 13px 13px';
    wall.style.maskImage = 'linear-gradient(transparent,#000 24%)';
    const hud = document.createElement('div');
    hud.className = 'single-player-stats-bar';
    hud.style.cssText = 'border:1px solid #52605e;border-left:3px solid #e8c58b;border-radius:16px';
    hud.style.background = 'linear-gradient(160deg,rgba(24,39,42,.94),rgba(13,20,29,.94))';
    card.append(queue, board, wall);
    root.append(card);
    if (withHud) root.append(hud);
    document.body.appendChild(root);
    const ctx = board.getContext('2d');
    const paint = (context, key, x, y, size) => drawPieceSolid(context, trimShape(SHAPES[key]), x, y, size, {
        ...KOI_POND_TETROMINOS,
        color: KOI_POND_TETROMINOS.colors[key],
        effects: { ...KOI_POND_TETROMINOS.effects, pulse: false },
    });
    const pieces = [['I', 0, 19], ['S', 0, 17], ['O', 4, 18], ['J', 6, 18], ['T', 3, 3]];
    pieces.forEach(([key, x, y]) => paint(ctx, key, x * 36, y * 36, 36));
    drawLandingShadowCanvas(ctx, trimShape(SHAPES.T), 108, 16 * 36, 36, KOI_POND_TETROMINOS.colors.T);
    ['L', 'Z', 'O'].forEach((key, i) => {
        const preview = document.createElement('canvas');
        preview.className = 'player-next-piece';
        preview.width = 96;
        preview.height = 60;
        preview.style.cssText = 'width:auto;background:rgba(12,18,26,.86);border-radius:7px';
        preview.style.height = i ? '76%' : '95%';
        preview.style.border = `1px solid ${i ? '#435051' : '#a68960'}`;
        const shape = trimShape(SHAPES[key]);
        paint(preview.getContext('2d'), key, (96 - shape[0].length * 19) / 2, (60 - shape.length * 19) / 2, 19);
        queue.append(preview);
    });
    const place = (el, x, y, width, height) => Object.assign(el.style, {
        position: 'absolute',
        boxSizing: 'border-box',
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
    });
    return {
        remove: () => root.remove(),
        resize() {
            const w = window.innerWidth;
            const h = window.innerHeight;
            const layout = fallbackLayout(w, h);
            const c = layout.cards[0];
            const b = layout.boards[0];
            const rail = layout.hud;
            const bw = (b.x1 - b.x0) * w;
            const bh = (b.y1 - b.y0) * h;
            const by = (b.y0 - c.y0) * h;
            place(card, c.x0 * w, c.y0 * h, (c.x1 - c.x0) * w, (c.y1 - c.y0) * h);
            place(queue, 3, 0, bw, by - 10);
            place(board, 3, by, bw, bh);
            place(wall, 0, by, bw + 6, bh + 3);
            place(hud, rail.x0 * w, rail.y0 * h, (rail.x1 - rail.x0) * w, (rail.y1 - rail.y0) * h);
        },
    };
}

/** The game's piece colours (koi-pond-tetrominos.js). */
const PIECE_COLORS = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'].map((piece) => KOI_POND_TETROMINOS.colors[piece]);

/** A looping script of locks and clears for the live demo (seconds into the loop). */
const DEMO_LOOP = 36;
const DEMO_SCRIPT = [
    [1.0, 'lock', { rows: [19], u: 0.2 }], [2.1, 'lock', { rows: [19, 18], u: 0.75 }],
    [3.2, 'lock', { rows: [18, 17], u: 0.4, hardDrop: true }], [4.3, 'lock', { rows: [17], u: 0.85 }],
    [5.4, 'lock', { rows: [19], u: 0.55 }],
    [5.4, 'clear', { rows: [19], lines: 1, combo: 1 }], [6.6, 'lock', { rows: [19, 18], u: 0.3 }],
    [6.6, 'clear', { rows: [19], lines: 1, combo: 2 }], [7.8, 'lock', { rows: [19, 18, 17], u: 0.8, hardDrop: true }],
    [7.8, 'clear', { rows: [19, 18], lines: 2, combo: 3 }], [9.0, 'lock', { rows: [19], u: 0.1 }],
    [9.0, 'clear', { rows: [19], lines: 1, combo: 4 }], [10.2, 'lock', { rows: [19, 18], u: 0.6 }],
    [10.2, 'clear', { rows: [19, 18, 17], lines: 3, combo: 5 }], [11.4, 'lock', { rows: [19], u: 0.5 }],
    [11.4, 'clear', { rows: [19], lines: 1, combo: 6 }], [12.6, 'lock', { rows: [19, 18], u: 0.15 }],
    [12.6, 'clear', { rows: [19, 18], lines: 2, combo: 7 }], [13.8, 'lock', { rows: [18, 17], u: 0.85 }],
    [13.8, 'clear', { rows: [19], lines: 1, combo: 8 }], [15.0, 'lock', { rows: [17, 16], u: 0.35 }],
    [15.0, 'clear', { rows: [19, 18], lines: 2, combo: 9 }],
    [16.6, 'lock', { rows: [16, 15], u: 0.6, hardDrop: true }],
    [18.0, 'lock', { rows: [15, 14], u: 0.9 }], [19.4, 'lock', { rows: [14, 13], u: 0.05 }],
    [21.0, 'lock', { rows: [19, 18, 17, 16], u: 0.95, hardDrop: true }],
    [21.0, 'clear', { rows: [19, 18, 17, 16], lines: 4, combo: 1 }],
    [28.0, 'lock', { rows: [19], u: 0.45 }], [29.0, 'lock', { rows: [19, 18], u: 0.7 }],
    [30.0, 'lock', { rows: [18], u: 0.25, hardDrop: true }],
    [30.0, 'clear', {
        rows: [19, 18], lines: 2, twist: true, combo: 1,
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
    const world = new KoiPondWorld({
        scene, quality, capture: true, renderer, seed: Math.round(num(params, 'seed', 7411)),
    }).build();
    world.bindCamera(camera);
    world.setReducedMotion(params.get('reduce') === '1');
    const partsParam = params.get('parts');
    if (partsParam) world.showOnlyParts(partsParam.split(',').map((p) => p.trim()));

    const look = { ...(POST_LOOK[quality] || POST_LOOK.High) };
    if (params.has('bloom')) look.bloom = params.get('bloom') === '1';
    const noPost = params.get('noPost') === '1';
    const post = noPost ? null : new KoiPondPost(renderer, scene, camera, {
        look,
        falseColor: params.get('falseColor') === '1',
    });
    if (noPost) renderer.toneMapping = THREE.AgXToneMapping;
    const overlay = params.get('board') === '1' ? mountBoardOverlay(params.get('statsHud') !== '0') : null;

    const pointer = { x: num(params, 'px'), y: num(params, 'py') };
    const iconPose = params.get('icon') === '1';
    const iconStage = params.get('icon') === '2';
    // The icon is staged beside the lily nearest (iconX, iconZ): the koi circle just clear of it.
    const stage = { x: num(params, 'iconX', 3.1), z: num(params, 'iconZ', 0.5) };
    if (iconStage && world.flora.lilies.length) {
        const near = world.flora.lilies.reduce((best, at) => (Math.hypot(at.x - stage.x, at.z - stage.z)
            < Math.hypot(best.x - stage.x, best.z - stage.z) ? at : best));
        stage.x = near.x - Math.sign(near.x) * 1.22;
        stage.z = near.z + 0.42;
    }
    const size = new THREE.Vector2(1, 1);
    const syncViewport = () => {
        overlay?.resize();
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
    /** The theme's camera, or the icon's tighter lens on one reach of the pond. */
    const aim = (time, delta) => {
        world.updateCamera(camera, sim(time, delta));
        if (iconPose) {
            camera.fov = num(params, 'iconFov', 30);
            camera.position.x += num(params, 'iconX', -3.2);
            camera.position.z += num(params, 'iconZ', 0);
            camera.rotateY(num(params, 'iconYaw', 0.0));
            camera.rotateX(num(params, 'iconPitch', 0.0));
            camera.updateProjectionMatrix();
            camera.updateMatrixWorld();
        }
        if (iconStage) {
            // Nearly overhead, as a koi pond is drawn.
            camera.fov = num(params, 'iconFov', 18);
            const lean = Math.sign(stage.x) * 0.22;
            camera.position.set(stage.x + lean, 8.6, stage.z + 2.4);
            camera.up.set(0, 1, 0);
            camera.lookAt(stage.x + lean, 0, stage.z - 0.06);
            camera.updateProjectionMatrix();
            camera.updateMatrixWorld();
        }
    };
    /**
     * The icon's composition: the three most different koi posed nose to tail round the stage
     * point, everyone else moved out of the lens, the nearest lily open and alight.
     */
    const stageIcon = () => {
        const { school, lily, flora } = world;
        const picks = [];
        const wanted = ['kohaku', 'ogon', 'showa', 'sanke', 'platinum'];
        wanted.forEach((name) => {
            if (picks.length >= 3) return;
            const hit = school.fish.findIndex((f, i) => !picks.includes(i) && f.length > 0.85
                && ['kohaku', 'sanke', 'showa', 'tancho', 'ogon', 'platinum', 'asagi', 'benigoi', 'bekko'][f.variety] === name);
            if (hit >= 0) picks.push(hit);
        });
        for (let i = 0; picks.length < 3 && i < school.count; i++) if (!picks.includes(i)) picks.push(i);
        const radius = 0.72;
        for (let i = 0; i < school.count; i++) {
            const k = picks.indexOf(i);
            if (k >= 0) {
                const a = (k / picks.length) * Math.PI * 2 + 0.55;
                school.x[i] = stage.x + Math.cos(a) * radius;
                school.z[i] = stage.z + Math.sin(a) * radius;
                school.y[i] = -0.13;
                school.heading[i] = a + Math.PI / 2;
                school.curve[i] = 0.62;
                school.amp[i] = 0.9;
                school.phase[i] = 1.1 + k * 2.3;
                school.roll[i] = -0.1;
                school.pitch[i] = 0;
                school.flare[i] = 0.35;
            } else if (Math.hypot(school.x[i] - stage.x, school.z[i] - stage.z) < 2.7) {
                // Out of the lens, to the far side of the pond.
                school.x[i] = -stage.x;
                school.z[i] = stage.z + (i % 5) * 0.4 - 1;
            }
        }
        let nearest = -1;
        flora.lilies.forEach((at, i) => {
            if (nearest < 0 || Math.hypot(at.x - stage.x, at.z - stage.z)
                < Math.hypot(flora.lilies[nearest].x - stage.x, flora.lilies[nearest].z - stage.z)) nearest = i;
        });
        if (nearest >= 0) {
            lily.open[nearest] = 1;
            lily.heart[nearest] = 0.32;
            lily.until[nearest] = world.time + 100;
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
    const eventAge = Math.max(0, num(params, 'eventAge', 0.6));
    const holdCombo = Math.max(0, Math.round(num(params, 'combo', 0)));
    const level = Math.max(1, Math.round(num(params, 'level', 1)));
    const warmLocks = Math.max(0, Math.round(num(params, 'locks', 0)));
    const colorParam = params.get('color');
    const eventColor = colorParam ? `#${colorParam.replace('#', '')}` : PIECE_COLORS[3];
    const fireEvent = () => {
        const row = Math.round(num(params, 'row', 12));
        const u = num(params, 'u', 0.3);
        const lines = Math.max(1, Math.min(4, Math.round(num(params, 'lines', 2))));
        const bottom = (n) => Array.from({ length: n }, (_, i) => 19 - i);
        const lock = { rows: [row, row - 1], u, color: eventColor };
        const crown = () => world.onClear({ lines: 0, perfect: true, crown: true });
        if (eventName === 'lock') world.onLock(lock);
        else if (eventName === 'drop') {
            world.onLock({
                ...lock, hardDrop: true, distance: num(params, 'distance', 16),
            });
        } else if (eventName === 'clear') world.onClear({ rows: bottom(lines), lines });
        else if (eventName === 'quad') world.onClear({ rows: bottom(4), lines: 4 });
        else if (eventName === 'twist') world.onClear({ rows: bottom(lines), lines, twist: true });
        else if (eventName === 'spin') {
            world.onLock(lock);
            world.onClear({ lines: 0, twist: true });
        } else if (eventName === 'b2b') {
            world.onClear({
                rows: bottom(lines), lines, twist: lines < 4, b2b: true,
            });
        } else if (eventName === 'cascade') {
            world.onClear({ rows: bottom(lines), lines, cascade: Math.max(2, num(params, 'cascade', 3)) });
        } else if (eventName === 'combo') world.onCombo(holdCombo || 7);
        else if (eventName === 'break') {
            if (!world.combo) world.onCombo(7);
            world.onCombo(0);
        } else if (eventName === 'perfect') {
            world.onClear({ rows: bottom(4), lines: 4 });
            world.at(world.time + 0.36, crown);
        } else if (eventName === 'crown') crown();
        else if (eventName === 'levelUp') world.levelUp(num(params, 'eventLevel', level + 1));
        else if (eventName === 'gameOver') {
            world.resetSession();
            world.gameOver();
        }
    };

    // ?probe=1: read the wave simulation back after a seek (diagnostics().probe).
    let probe = null;
    const wantProbe = params.get('probe') === '1';
    const runProbe = () => {
        if (!wantProbe || !world.surface) return;
        world.surface.probe(renderer).then((result) => {
            probe = result;
        }).catch((error) => {
            probe = { error: String(error?.message || error) };
        });
    };

    /** How long the pond is played before a capture: the school spreads out, the water wakes. */
    const LEAD = 12;
    const fromTime = params.has('from') ? Math.max(0, num(params, 'from', 0)) : null;
    let sought = null;
    const seekTo = (time) => {
        // The playground seeks every frame while ?t= is pinned: replay once, then hold.
        if (sought === time) return;
        sought = time;
        const lead = (eventName ? eventAge : 0) + LEAD + warmLocks * 0.5 + (holdCombo ? 6 : 0);
        // (`from`: every frame replays from that moment, so a run of t= frames is one take.)
        const start = fromTime !== null && fromTime < time ? fromTime : Math.max(0, time - lead);
        world.seek(start);
        if (level > 1) world.levelUp(level, { silent: true });
        frame(start, 0);
        let cursor = start;
        const eventTime = eventName ? Math.max(start, time - eventAge) : time;
        if (holdCombo > 0 && eventName !== 'combo') {
            // A chain builds: one clear after another, not all at once.
            const settle = Math.min(4, eventTime - cursor);
            stepTo(cursor, start + settle, 1 / 60);
            cursor = start + settle;
            world.onCombo(holdCombo);
        }
        for (let i = 0; i < warmLocks; i++) {
            const at = Math.min(eventTime, cursor + 0.5);
            stepTo(cursor, at, 1 / 60);
            cursor = at;
            world.onLock({
                rows: [19 - (i % 9), 18 - (i % 9)],
                u: ((i * 0.37) % 1) * 0.9 + 0.05,
                color: PIECE_COLORS[i % PIECE_COLORS.length],
                hardDrop: i % 4 === 3,
            });
        }
        if (eventTime > cursor) stepTo(cursor, eventTime, 1 / 60);
        if (eventName) {
            fireEvent();
            stepTo(eventTime, time, 1 / 60);
        }
        if (iconStage) stageIcon();
        frame(time, 0);
        pushPost(time);
        runProbe();
    };

    const demo = params.get('demo') === '1';
    let liveEventFired = false;
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
        if (local > 16.6 && local < 21 && world.combo > 0) world.onCombo(0);
        if (local > 23 && local < 30 && world.combo > 0) world.onCombo(0);
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
            if (eventName && !liveEventFired) {
                liveEventFired = true;
                fireEvent();
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
                probe,
                ...world.getState(),
            };
        },
        dispose() {
            overlay?.remove();
            post?.dispose();
            world.dispose();
            renderer.toneMapping = saved.toneMapping;
            renderer.shadowMap.enabled = false;
            camera.fov = saved.fov;
            camera.near = saved.near;
            camera.far = saved.far;
            camera.updateProjectionMatrix();
        },
    };
}

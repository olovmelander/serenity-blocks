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
 *   level=<n>                rest on level n
 *   locks=<n>                before anything else, play n locks
 *   event=lock|drop|clear|quad|tspin|perfect|levelUp   fire a gameplay event...
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
import { readLayoutRects } from '../../themes/koi-pond/koi-pond-composition.js';

export const meta = {
    id: 'koi-pond',
    title: 'Koi Pond (full world)',
    description: 'A moonlit pond seen from above: living koi, real ripples and caustics; the board plays the water.',
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

/** The game's piece colours (koi-pond-tetrominos.js). */
const PIECE_COLORS = ['#ffc852', '#ffadd2', '#7dffb8', '#ff7b52', '#7b94ff', '#ffe48a', '#7eeeff'];

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
        rows: [19, 18], lines: 2, tspin: true, combo: 1,
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
        stage.x = near.x - Math.sign(near.x) * 0.98;
        stage.z = near.z + 0.32;
    }
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
            lily.heart[nearest] = 0.9;
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
    const eventAge = num(params, 'eventAge', 0.6);
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
    let sought = null;
    const seekTo = (time) => {
        // The playground seeks every frame while ?t= is pinned: replay once, then hold.
        if (sought === time) return;
        sought = time;
        const lead = (eventName ? eventAge : 0) + LEAD + warmLocks * 0.5 + (holdCombo ? 6 : 0);
        const start = Math.max(0, time - lead);
        world.seek(start);
        if (level > 1) world.levelUp(level, { silent: true });
        frame(start, 0);
        let cursor = start;
        if (holdCombo > 0) {
            // A chain builds: one clear after another, not all at once.
            const settle = Math.min(4, lead * 0.3);
            stepTo(cursor, start + settle, 1 / 60);
            cursor = start + settle;
            world.onCombo(holdCombo);
        }
        for (let i = 0; i < warmLocks; i++) {
            const at = cursor + 0.5;
            stepTo(cursor, at, 1 / 60);
            cursor = at;
            world.onLock({
                rows: [19 - (i % 9), 18 - (i % 9)],
                u: ((i * 0.37) % 1) * 0.9 + 0.05,
                color: PIECE_COLORS[i % PIECE_COLORS.length],
                hardDrop: i % 4 === 3,
            });
        }
        const eventTime = eventName ? time - eventAge : time;
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

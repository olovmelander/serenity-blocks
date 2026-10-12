/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Painted Ages — the shared landscape and post, with the game's real event director.
 *
 * URL params:
 *   quality=High|Ultra|Extreme|Medium|Low|Minimal   content tier (default High)
 *   level=3                 starting formation level (1–8)
 *   board=1                 mock gameplay card using the real selectors
 *   statsHud=0              omit the HUD from the mock board
 *   locks=0                 pre-play locks on alternating fronts
 *   deposits=0              prefill seeded mineral strata for a mid-session frame
 *   event=lock|drop|clear|quad|tspin|perfect|levelUp|release|b2b|gameOver
 *   eventAge=0.4            seconds after the event
 *   eventLevel=4            target level (default level + 1)
 *   lines=2                 cleared rows, 1–4
 *   row=9                   lowest visible piece/clear row
 *   u=0.3                   board column fraction
 *   piece=T                 I, O, T, S, Z, J or L
 *   turns=0                 clockwise quarter turns
 *   color=D8432C            optional piece colour override
 *   dist=14                 hard-drop distance in rows
 *   cascade=1               clear waves, 0.5 seconds apart (1–8)
 *   combo=0                 hold a chain; n − 1 zones become wet
 *   peak=6                  chain that breaks on event=release
 *   b2b=0                   hold the fold level (0–4)
 *   wet=0.8                 override wetness (0–1)
 *   sun=17                  override sun elevation (1–22 degrees)
 *   formation=3             override formation cast (1–6)
 *   view=shade|strata|full   terrain inspection view
 *   reduce=1                reduced motion
 *   parts=sky,land,water,air,steam,hoodoo   part filter
 *   noPost=1                show the raw scene through the renderer's tone map
 *   falseColor=1            inspect exposed radiance before tone mapping
 *   bloom=0                 override bloom
 *   px=0&py=0               held pointer coordinates (−1…1)
 *   icon=1                  square icon framing without a release bow
 *   iconFov=42              icon lens, degrees
 *   iconYaw=0               icon yaw offset, degrees
 *   iconPitch=-7            icon pitch, degrees
 *   demo=1                  live 40-second gameplay loop
 * Fixed time is supplied by the playground's shared t control.
 */
import * as THREE from 'three/webgpu';
import { PaintedAgesWorld } from '../../themes/painted-ages/painted-ages-world.js';
import { PaintedAgesPost, POST_LOOK } from '../../themes/painted-ages/painted-ages-post.js';
import { readLayoutRects, BOARD_GRID } from '../../themes/painted-ages/painted-ages-composition.js';
import { PaintedAgesDirector } from '../../themes/painted-ages/painted-ages-director.js';
import { SHAPES, SHAPE_KEYS } from '../../themes/painted-ages/painted-ages-core.js';
import { PAINTED_AGES_TETROMINOS } from '../../themes/painted-ages/painted-ages-tetrominos.js';

export const meta = {
    id: 'painted-ages',
    title: 'Painted Ages (full world)',
    description: 'Striped badlands in white morning light; cleared rows become the land’s mineral record.',
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

/** A matrix turned a quarter clockwise. */
const turnCw = (m) => m[0].map((_, c) => m.map((row) => row[c]).reverse());

/** A shape's matrix turned `turns` quarter turns clockwise (as the board turns them). */
function turned(key, turns = 0) {
    let m = SHAPES[key] || SHAPES.T;
    for (let i = 0; i < ((turns % 4) + 4) % 4; i++) m = turnCw(m);
    return m;
}

/**
 * The PIECE_LOCK piece the game would send for a shape whose lowest occupied row is `row` and
 * whose occupied cells centre on the column fraction `u` (board coordinates, hidden rows in).
 */
function boardPiece(key, {
    u = 0.3, row = 9, turns = 0, color = null,
} = {}) {
    const shape = turned(key, turns);
    let sum = 0;
    let count = 0;
    let lowest = 0;
    shape.forEach((cells, r) => cells.forEach((v, c) => {
        if (!v) return;
        sum += c + 0.5;
        count += 1;
        lowest = Math.max(lowest, r);
    }));
    const width = shape[0].length;
    const x = Math.max(0, Math.min(BOARD_GRID.columns - width, Math.round(u * BOARD_GRID.columns - sum / count)));
    const bottom = Math.max(lowest, Math.min(BOARD_GRID.rows - 1, Math.round(row)));
    const piece = {
        type: key, shapeKey: key, shape, x, y: bottom - lowest + BOARD_GRID.hiddenRows,
    };
    if (color) piece.color = color;
    return piece;
}

/** `n` cleared board rows (hidden rows in) whose lowest is the visible row `lowest`. */
const clearedRows = (n, lowest = BOARD_GRID.rows - 1) => Array.from(
    { length: n },
    (_, i) => Math.max(0, lowest - i) + BOARD_GRID.hiddenRows,
);

/** A deterministic pre-existing well, built through the same canonical lock snapshots as play. */
function primeClearRows(director, lines, lowest) {
    const pigments = ['T', 'L', 'J', 'S'];
    // Fill from the bottom upward: each shape's upper cells are covered by the next row's locks.
    // These synchronous snapshots coalesce into the final locking piece at the frame boundary.
    for (let row = 0; row < lines; row++) {
        const key = pigments[row];
        const columns = key === 'S' ? [0, 2, 4, 6, 7] : [0, 3, 6, 7];
        for (const x of columns) {
            const piece = boardPiece(key, { row: lowest - row });
            piece.x = x;
            director.onPieceLock({ piece });
        }
    }
}

/** A looping script for the live demo (seconds into the loop): locks, clears, a chain, four lines, a T-spin. */
const DEMO_LOOP = 40;
const DEMO_SCRIPT = [
    [1.0, 'lock', { u: 0.2, row: 19 }], [2.1, 'lock', { u: 0.75, row: 18 }],
    [3.2, 'drop', { u: 0.4, row: 14, dist: 12 }], [4.3, 'lock', { u: 0.85, row: 9 }],
    [5.4, 'clear', { u: 0.55, lines: 1 }], [6.6, 'clear', { u: 0.3, lines: 1 }],
    [7.8, 'clear', { u: 0.8, lines: 2 }], [9.0, 'clear', { u: 0.1, lines: 1 }],
    [10.2, 'clear', { u: 0.6, lines: 3 }], [11.6, 'lock', { u: 0.5, row: 19 }],
    [12.6, 'lock', { u: 0.15, row: 3 }], [13.6, 'lock', { u: 0.85, row: 17 }],
    [14.6, 'drop', { u: 0.35, row: 8, dist: 9 }], [15.6, 'lock', { u: 0.6, row: 16 }],
    [18.6, 'clear', { u: 0.95, lines: 4 }], [24.0, 'lock', { u: 0.45, row: 19 }],
    [26.0, 'clear', { u: 0.25, lines: 4, b2b: true }], [30.0, 'tspin', {
        u: 0.25, row: 18, lines: 2, b2b: true,
    }],
    [32.0, 'lock', { u: 0.5, row: 7 }], [34.0, 'lock', { u: 0.7, row: 12 }],
];

export function create({
    scene, camera, renderer, params,
}) {
    const quality = params.get('quality') || 'High';
    const saved = {
        fov: camera.fov, near: camera.near, far: camera.far, toneMapping: renderer.toneMapping,
    };
    const world = new PaintedAgesWorld({
        scene, quality, capture: true, renderer,
    }).build();
    world.bindCamera(camera);
    world.setReducedMotion(params.get('reduce') === '1');
    world.setCaptureOverrides({
        wet: params.has('wet') ? Math.max(0, Math.min(1, num(params, 'wet'))) : null,
        sun: params.has('sun') ? Math.max(1, Math.min(22, num(params, 'sun', 17))) : null,
        formation: params.has('formation') ? Math.max(1, Math.min(6, Math.round(num(params, 'formation', 3)))) : null,
        view: ['shade', 'strata', 'full'].includes(params.get('view')) ? params.get('view') : 'full',
    });
    const partsParam = params.get('parts');
    if (partsParam) world.showOnlyParts(partsParam.split(',').map((p) => p.trim()));

    const look = { ...(POST_LOOK[quality] || POST_LOOK.High) };
    if (params.has('bloom')) {
        look.bloom = params.get('bloom') === '1';
        // A tier that ships without bloom has no strength to turn on.
        if (look.bloom && !(look.bloomStrength > 0)) look.bloomStrength = POST_LOOK.Medium.bloomStrength;
    }
    const noPost = params.get('noPost') === '1';
    const post = noPost ? null : new PaintedAgesPost(renderer, scene, camera, {
        look,
        falseColor: params.get('falseColor') === '1',
    });
    if (noPost) renderer.toneMapping = THREE.AgXToneMapping;
    const overlay = params.get('board') === '1' ? mountBoardOverlay(params.get('statsHud') !== '0') : null;

    // Held state: a chain and a back-to-back run the director's own reports never drop below.
    const holdCombo = Math.max(0, Math.round(num(params, 'combo', 0)));
    const holdB2B = Math.max(0, Math.min(4, Math.round(num(params, 'b2b', 0))));
    const director = new PaintedAgesDirector({
        sink: {
            lock: (c) => world.onLock(c),
            clear: (c) => world.onClear(c),
            combo: (n) => world.onCombo(Math.max(n, holdCombo)),
            b2b: (level) => world.onB2B(Math.max(level, holdB2B)),
            levelUp: (lv) => world.levelUp(lv),
        },
    });
    director.configure({ enabled: true, lockRipple: true });

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
        director.setViewport(window.innerWidth, window.innerHeight);
        const rects = overlay ? readLayoutRects() : null;
        world.setLayout(rects, aspect);
        post?.setCalmRects(rects ? [...rects.cards, rects.hud].filter(Boolean) : [], rects ? 1 : 0);
    };
    syncViewport();

    const sim = (time, delta) => ({
        time, delta, pointerX: pointer.x, pointerY: pointer.y,
    });
    const pushPost = (time) => {
        if (!post) return;
        post.update(world.getPostState());
        post.update({ time });
    };
    const aimIcon = () => {
        if (!iconPose) return;
        // The icon keeps the diagonal ranks and their basin in a square lens.
        camera.fov = num(params, 'iconFov', 42);
        camera.updateProjectionMatrix();
        camera.up.set(0, 1, 0);
        camera.lookAt(camera.position.x, camera.position.y, camera.position.z - 10);
        camera.rotateY(num(params, 'iconYaw', 0) * (Math.PI / 180));
        camera.rotateX(num(params, 'iconPitch', -7) * (Math.PI / 180));
        camera.updateMatrixWorld();
        // Anti-aliasing widths size themselves from the view's radians per pixel.
        if (world.u.pixelAngle) {
            world.u.pixelAngle.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, size.y);
        }
    };
    const pendingWaves = [];
    let eventClock = 0;
    // One frame as the theme runs it: the camera, the gameplay staged since the last frame, the world.
    const frame = (time, delta) => {
        eventClock = time;
        world.updateCamera(camera, sim(time, delta));
        aimIcon();
        while (pendingWaves.length && pendingWaves[0].at <= time) {
            const wave = pendingWaves.shift();
            director.onCombo({ comboCount: wave.depth });
            director.onLineClear({ lineCount: 1, clearedRows: clearedRows(1, wave.row), cascadeCount: wave.depth });
        }
        director.flush();
        world.update(sim(time, delta), camera);
    };
    const stepTo = (from, to, dt) => {
        const steps = Math.max(1, Math.round((to - from) / dt));
        const h = (to - from) / steps;
        for (let i = 1; i <= steps; i++) frame(from + i * h, h);
    };

    const eventName = params.get('event');
    const eventAge = Math.max(0, num(params, 'eventAge', 0.4));
    const level = Math.max(1, Math.min(8, Math.round(num(params, 'level', 3))));
    const warmLocks = Math.max(0, Math.min(64, Math.round(num(params, 'locks', 0))));
    const deposits = Math.max(0, Math.min(512, Math.round(num(params, 'deposits', 0))));
    const colorParam = params.get('color');
    const shapeParam = (params.get('piece') || 'T').toUpperCase();
    const eventKey = SHAPE_KEYS.includes(shapeParam) ? shapeParam : 'T';
    const eventColor = colorParam ? `#${colorParam.replace('#', '')}` : PAINTED_AGES_TETROMINOS.colors[eventKey];

    /** What the game puts on the bus for one beat (the director stages it; the next frame flushes). */
    const play = (verb, detail = {}) => {
        const u = detail.u ?? 0.3;
        if (verb === 'lock' || verb === 'drop') {
            const key = detail.key || eventKey;
            const piece = boardPiece(key, {
                u, row: detail.row ?? 9, turns: detail.turns ?? 0, color: detail.color ?? null,
            });
            if (verb === 'drop') {
                const distance = Math.max(0, Math.round(detail.dist ?? 14));
                director.onHardDrop({
                    piece, startY: piece.y - distance, endY: piece.y, distance,
                });
            }
            director.onPieceLock({ piece });
            return;
        }
        if (verb === 'clear' || verb === 'tspin') {
            const lines = Math.max(1, Math.min(4, Math.round(detail.lines ?? 2)));
            const lowest = detail.row ?? (verb === 'tspin' ? 9 : BOARD_GRID.rows - 1);
            const key = verb === 'tspin' ? 'T' : (detail.key || 'I');
            // A fixed capture starts with a pre-existing well. Live demos keep their real
            // lock history, since injecting setup locks between clears would break a chain.
            if (detail.fixture) primeClearRows(director, lines, lowest);
            // The locking piece sits on the rows it clears.
            director.onPieceLock({
                piece: boardPiece(key, {
                    u, row: lowest, turns: verb === 'tspin' ? 2 : (detail.turns ?? 0), color: detail.color ?? null,
                }),
            });
            const waves = Math.max(1, Math.min(8, Math.round(detail.cascade ?? 1)));
            director.onLineClear({ lineCount: lines, clearedRows: clearedRows(lines, lowest), cascadeCount: 1 });
            if (verb === 'tspin') director.onTSpin({ lineCount: lines });
            if (detail.b2b) director.onB2B({ active: true });
            // Real cascade waves arrive on later ticks; staging them together loses their beds
            // because the director intentionally coalesces synchronous clears once per frame.
            for (let depth = 2; depth <= waves; depth++) {
                pendingWaves.push({ at: eventClock + (depth - 1) * 0.5, depth, row: lowest });
            }
            pendingWaves.sort((a, b) => a.at - b.at);
            return;
        }
        if (verb === 'perfect') {
            // A perfect clear arrives on a later frame of its own, with no rows.
            director.onPerfectClear({ depth: 1, perfectClearBonus: 3500 });
            return;
        }
        if (verb === 'levelUp') director.onLevelUp({ level: detail.level });
    };

    const fireEvent = () => {
        const u = num(params, 'u', 0.3);
        const lines = Math.max(1, Math.min(4, Math.round(num(params, 'lines', 2))));
        const turns = Math.round(num(params, 'turns', 0));
        if (eventName === 'lock' || eventName === 'drop') {
            play(eventName, {
                u, row: num(params, 'row', 9), turns, color: eventColor, dist: num(params, 'dist', 14),
            });
        } else if (eventName === 'clear') {
            play('clear', {
                u,
                lines,
                key: eventKey,
                turns,
                color: eventColor,
                fixture: true,
                row: num(params, 'row', BOARD_GRID.rows - 1),
                cascade: num(params, 'cascade', 1),
            });
        } else if (eventName === 'quad') {
            play('clear', {
                u,
                lines: 4,
                key: eventKey,
                turns,
                color: eventColor,
                fixture: true,
                row: num(params, 'row', BOARD_GRID.rows - 1),
            });
        } else if (eventName === 'tspin') {
            play('tspin', {
                u, lines, row: num(params, 'row', 9), fixture: true,
            });
        } else if (eventName === 'perfect') {
            play('perfect');
        } else if (eventName === 'levelUp') {
            play('levelUp', { level: Math.round(num(params, 'eventLevel', level + 1)) });
        } else if (eventName === 'release') {
            // The director infers the release on the breaking lock in this same frame.
            play('lock', { u, row: num(params, 'row', 9), color: eventColor });
        } else if (eventName === 'b2b') {
            director.onB2B({ active: true });
        } else if (eventName === 'gameOver') {
            // As the theme ends a run: tuff seal and low light.
            director.reset();
            world.onGameOver();
            world.resetSession();
        }
    };

    const lockAt = (i) => {
        const key = SHAPE_KEYS[i % SHAPE_KEYS.length];
        // Alternating the two fronts and the seven piece pigments.
        const u = i % 2 ? 0.62 + ((i * 0.13) % 0.3) : 0.08 + ((i * 0.17) % 0.3);
        play(i % 4 === 3 ? 'drop' : 'lock', {
            key, u, row: 19 - ((i * 5) % 16), turns: i, dist: 6 + (i % 9),
        });
    };

    const seekTo = (time) => {
        const releasePeak = Math.max(2, Math.min(255, Math.round(num(params, 'peak', 6))));
        const lead = (eventName ? eventAge : 0)
            + Math.max(9, eventName === 'release' ? releasePeak * 0.6 + 0.6 : 0) + warmLocks * 0.6;
        const start = Math.max(0, time - lead);
        director.reset();
        pendingWaves.length = 0;
        world.clearHistory();
        world.seek(start);
        world.prefillDeposits(deposits);
        if (level > 1) world.levelUp(level, { silent: true });
        if (holdCombo > 0) world.onCombo(holdCombo);
        if (holdB2B > 0) world.onB2B(holdB2B);
        frame(start, 0);
        // Locks played before the event: fans awaiting burial by new strata.
        let cursor = start;
        const eventTime = eventName ? Math.max(start, time - eventAge) : time;
        for (let i = 0; i < warmLocks; i++) {
            // Never past the moment being shown (a seek close to zero has no room for the lead).
            const at = Math.min(eventTime, start + 0.5 + i * 0.6);
            stepTo(cursor, at, 0.1);
            cursor = at;
            lockAt(i);
            frame(at, 0);
        }
        if (eventName === 'release') {
            // Build the real tracker through consecutive clearing locks. An explicit combo
            // report lasts only its frame; subsequent frames must keep rain at the same peak.
            const first = Math.max(cursor, eventTime - releasePeak * 0.6);
            for (let i = 0; i < releasePeak; i++) {
                const at = first + (eventTime - first) * (i / releasePeak);
                stepTo(cursor, at, 0.1);
                cursor = at;
                play('clear', { key: SHAPE_KEYS[i % SHAPE_KEYS.length], row: 19, lines: 1 });
                frame(at, 0);
            }
        }
        if (eventTime > cursor) stepTo(cursor, eventTime, 0.1);
        if (eventName) {
            fireEvent();
            // The frame the event lands on (the director flushes what it staged).
            frame(eventTime, 0);
            if (time > eventTime) stepTo(eventTime, time, 1 / 120);
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
            pendingWaves.length = 0;
            director.reset();
            world.resetSession();
        }
        const local = time - loop * DEMO_LOOP;
        while (demoCursor < DEMO_SCRIPT.length && DEMO_SCRIPT[demoCursor][0] <= local) {
            const [, verb, detail] = DEMO_SCRIPT[demoCursor];
            demoPiece += 1;
            play(verb, {
                ...detail, key: SHAPE_KEYS[demoPiece % SHAPE_KEYS.length], turns: demoPiece,
            });
            demoCursor += 1;
        }
    };

    // Live previews use the same initial state as a fixed-time capture.
    world.prefillDeposits(deposits);
    if (level > 1) world.levelUp(level, { silent: true });
    if (holdCombo > 0) world.onCombo(holdCombo);
    if (holdB2B > 0) world.onB2B(holdB2B);
    frame(0, 0);
    pushPost(0);

    return {
        cameraRadius: 1,
        camera(time, cam) {
            world.updateCamera(cam, sim(time, 0));
        },
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
                droppedEvents: director.droppedEvents,
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

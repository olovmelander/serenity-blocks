/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Thermal Bloom — the full world + post stack, mounted in isolation.
 *
 * Mounts the SAME ThermalBloomWorld and ThermalBloomPost the theme ships, with the theme's camera
 * rig, so composition and grade are judged exactly as they will look in game. Gameplay events go
 * through a real ThermalBloomDirector, fed the game's own bus payloads, so the world hears what
 * the theme's sink hands it.
 *
 * URL params:
 *   quality=High|Ultra|...   content tier (default High)
 *   level=<n>                rest on level n (default 1); its season is (n − 1) mod 6
 *   season=0..5              hold a season, whatever the level
 *   heat=0..1                hold the combo heat (the eye's width, the fingers' reach)
 *   breath=0..1              hold the basin's breath (steam density and wind)
 *   gust=0..1                hold a gust tear at that phase of its crossing
 *   board=1                  overlay a mock gameplay board + HUD (the solo layout rules); events
 *                            aim at its rects and the post's calm zones read them
 *   statsHud=0               with board=1: board only, no HUD mock
 *   hudSide=left             with board=1: the HUD mock left of the card (the mirror rule)
 *   locks=<n>                before anything else, play n locks (alternating sides and pieces)
 *   record=<n>               pre-fill n stripes of the stone record
 *   event=lock|drop|clear|quad|tspin|perfect|levelUp|release|b2b|gameOver   fire an event...
 *   eventAge=<s>             ...and show it <s> seconds later (default 0.4)
 *   eventLevel=<n>           levelUp: the new level (default level + 1)
 *   lines=<n>                clear/tspin: lines (1..4, default 2)
 *   row=<r>                  lock/drop/tspin: the piece's lowest row; clear: the lowest cleared
 *                            row (default 9 for a lock, the floor for a clear)
 *   u=<0..1>                 lock/drop/tspin: the piece's column as a fraction (default 0.3)
 *   piece=I|O|T|S|Z|J|L      lock/drop: the shape (default T); turns=<quarter turns>;
 *   color=<hex>              its colour (default the piece's own)
 *   dist=<rows>              drop: how far it fell (default 14)
 *   cascade=<waves>          clear: cascade waves (default 1)
 *   combo=<n>                hold a chain of n
 *   peak=<n>                 release: the chain that breaks (default 6)
 *   b2b=<0..3>               hold the Consort at that back-to-back level
 *   demo=1                   live only: play a looping gameplay script
 *   parts=sky,basin,...      draw only these parts
 *   falseColor=1             post debug view: band the exposed pre-tone-map max channel
 *   noPost=1                 raw scene (no bloom/grade)
 *   bloom=0|1                override the tier's bloom
 *   px=-1..1&py=-1..1        hold a pointer-parallax offset
 *   reduce=1                 reduced motion
 *   icon=1                   the theme-icon framing: a narrow lens on the Iris's eye and its steam
 *                            dome (iconFov=30; iconYaw and iconPitch, degrees, turn it from there)
 *                            (compose for a small circle: capture a square frame)
 */
import * as THREE from 'three/webgpu';
import { ThermalBloomWorld } from '../../themes/thermal-bloom/thermal-bloom-world.js';
import { ThermalBloomPost, POST_LOOK } from '../../themes/thermal-bloom/thermal-bloom-post.js';
import { readLayoutRects, BOARD_GRID } from '../../themes/thermal-bloom/thermal-bloom-composition.js';
import { ThermalBloomDirector } from '../../themes/thermal-bloom/thermal-bloom-director.js';
import { SHAPES, SHAPE_KEYS } from '../../themes/thermal-bloom/thermal-bloom-core.js';
import { THERMAL_BLOOM_TETROMINOS } from '../../themes/thermal-bloom/thermal-bloom-tetrominos.js';

export const meta = {
    id: 'thermal-bloom',
    title: 'Thermal Bloom (full world)',
    description: 'A steaming basin of living colour: the board spills, seals and erupts its springs.',
};

function num(params, key, fallback = 0) {
    const v = Number.parseFloat(params.get(key));
    return Number.isFinite(v) ? v : fallback;
}

/** A held value (season, heat, breath, gust) or null when the URL leaves it to the clock. */
function held(params, key) {
    if (!params.has(key)) return null;
    const v = Number.parseFloat(params.get(key));
    return Number.isFinite(v) ? v : null;
}

const BOARD_PX = 'min(clamp(220px, 22vw, 300px), (100vh - 250px) / 2)';

/** A stand-in for the real solo layout (public/styles/main.css) with the real class names. */
/** The stats bar's gap from the card's middle (the stylesheet's own formula). */
const HUD_GAP = 'min(max(300px, min(35vw, 400px)), (100vh - 200px) / 2) / 2 + 60px';

function mountBoardOverlay(withHud, hudLeft = false) {
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
            `${hudLeft ? 'right' : 'left'}:calc(50% + ${HUD_GAP})`,
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
    const world = new ThermalBloomWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setReducedMotion(params.get('reduce') === '1');
    const partsParam = params.get('parts');
    if (partsParam) world.showOnlyParts(partsParam.split(',').map((p) => p.trim()));

    const look = { ...(POST_LOOK[quality] || POST_LOOK.High) };
    if (params.has('bloom')) {
        look.bloom = params.get('bloom') === '1';
        // A tier that ships without bloom has no strength to turn on.
        if (look.bloom && !(look.bloomStrength > 0)) look.bloomStrength = POST_LOOK.Medium.bloomStrength;
    }
    const noPost = params.get('noPost') === '1';
    const post = noPost ? null : new ThermalBloomPost(renderer, scene, camera, {
        look,
        falseColor: params.get('falseColor') === '1',
    });
    if (noPost) renderer.toneMapping = THREE.AgXToneMapping;
    const overlay = params.get('board') === '1'
        ? mountBoardOverlay(params.get('statsHud') !== '0', params.get('hudSide') === 'left')
        : null;

    // Held state: a chain and a back-to-back run the director's own reports never drop below.
    const holdCombo = Math.max(0, Math.round(num(params, 'combo', 0)));
    const holdB2B = Math.max(0, Math.min(3, Math.round(num(params, 'b2b', 0))));
    const holds = {
        season: held(params, 'season'),
        heat: held(params, 'heat'),
        breath: held(params, 'breath'),
        gust: held(params, 'gust'),
    };
    const director = new ThermalBloomDirector({
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
    const aimTarget = new THREE.Vector3();
    const aimIcon = () => {
        if (!iconPose) return;
        // A narrow lens on the Iris's eye and the steam dome above it (the world aims its events
        // through the rig's own camera, so this is applied after).
        camera.fov = num(params, 'iconFov', 30);
        camera.updateProjectionMatrix();
        camera.up.set(0, 1, 0);
        const { eye } = world.plan;
        aimTarget.set(eye[0], eye[1] + 14, eye[2]);
        camera.lookAt(aimTarget);
        camera.rotateY(num(params, 'iconYaw', 0) * (Math.PI / 180));
        camera.rotateX(num(params, 'iconPitch', 0) * (Math.PI / 180));
        camera.updateMatrixWorld();
        // Anti-aliasing widths size themselves from the view's radians per pixel.
        world.u.pixelAngle.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, size.y);
    };
    // One frame as the theme runs it: the camera, the gameplay staged since the last frame, the world.
    const frame = (time, delta) => {
        world.updateCamera(camera, sim(time, delta));
        aimIcon();
        director.flush();
        world.update(sim(time, delta), camera);
    };
    const stepTo = (from, to, dt) => {
        const steps = Math.max(1, Math.round((to - from) / dt));
        const h = (to - from) / steps;
        for (let i = 1; i <= steps; i++) frame(from + i * h, h);
    };

    const eventName = params.get('event');
    const eventAge = num(params, 'eventAge', 0.4);
    const level = Math.max(1, Math.round(num(params, 'level', 1)));
    const warmLocks = Math.max(0, Math.round(num(params, 'locks', 0)));
    const recordStripes = Math.max(0, Math.round(num(params, 'record', 0)));
    const colorParam = params.get('color');
    const shapeParam = (params.get('piece') || 'T').toUpperCase();
    const eventKey = SHAPE_KEYS.includes(shapeParam) ? shapeParam : 'T';
    const eventColor = colorParam ? `#${colorParam.replace('#', '')}` : THERMAL_BLOOM_TETROMINOS.colors[eventKey];

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
            // The locking piece sits on the rows it clears.
            director.onPieceLock({ piece: boardPiece(key, { u, row: lowest, turns: verb === 'tspin' ? 2 : 0 }) });
            const waves = Math.max(1, Math.round(detail.cascade ?? 1));
            for (let wave = 1; wave <= waves; wave++) {
                if (wave > 1) director.onCombo({ comboCount: wave });
                director.onLineClear({
                    lineCount: wave === 1 ? lines : 1,
                    clearedRows: wave === 1 ? clearedRows(lines, lowest) : clearedRows(1, lowest),
                    cascadeCount: wave,
                });
                if (wave === 1 && verb === 'tspin') director.onTSpin({ lineCount: lines });
                if (wave === 1 && detail.b2b) director.onB2B({ active: true });
            }
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
                u, lines, row: num(params, 'row', BOARD_GRID.rows - 1), cascade: num(params, 'cascade', 1),
            });
        } else if (eventName === 'quad') {
            play('clear', { u, lines: 4, row: num(params, 'row', BOARD_GRID.rows - 1) });
        } else if (eventName === 'tspin') {
            play('tspin', { u, lines, row: num(params, 'row', 9) });
        } else if (eventName === 'perfect') {
            play('perfect');
        } else if (eventName === 'levelUp') {
            play('levelUp', { level: Math.round(num(params, 'eventLevel', level + 1)) });
        } else if (eventName === 'release') {
            // The chain breaks: the world hears combo(0) after the peak it was holding.
            world.onCombo(0);
        } else if (eventName === 'b2b') {
            world.onB2B(Math.max(1, holdB2B));
        } else if (eventName === 'gameOver') {
            // As the theme ends a run: the springs sigh, then a new session.
            director.reset();
            world.onGameOver();
            world.resetSession();
        }
    };

    const lockAt = (i) => {
        const key = SHAPE_KEYS[i % SHAPE_KEYS.length];
        // Alternating sides (the Iris's columns 0–4, the Stair's 5–9) and pieces.
        const u = i % 2 ? 0.62 + ((i * 0.13) % 0.3) : 0.08 + ((i * 0.17) % 0.3);
        play(i % 4 === 3 ? 'drop' : 'lock', {
            key, u, row: 19 - ((i * 5) % 16), turns: i, dist: 6 + (i % 9),
        });
    };

    const applyHolds = () => {
        Object.keys(holds).forEach((key) => {
            if (holds[key] !== null) world.hold(key, holds[key]);
        });
    };

    const seekTo = (time) => {
        const lead = (eventName ? eventAge : 0) + 9 + warmLocks * 0.6;
        const start = Math.max(0, time - lead);
        director.reset();
        world.seek(start);
        if (level > 1) world.levelUp(level, { silent: true });
        applyHolds();
        if (recordStripes > 0) world.primeRecord(recordStripes);
        if (holdCombo > 0) world.onCombo(holdCombo);
        if (holdB2B > 0) world.onB2B(holdB2B);
        frame(start, 0);
        // Locks played before the event: the sides holding their blooms.
        let cursor = start;
        const eventTime = eventName ? time - eventAge : time;
        for (let i = 0; i < warmLocks; i++) {
            // Never past the moment being shown (a seek close to zero has no room for the lead).
            const at = Math.min(eventTime, start + 0.5 + i * 0.6);
            stepTo(cursor, at, 0.1);
            cursor = at;
            lockAt(i);
            frame(at, 0);
        }
        if (eventName === 'release') {
            // The chain that breaks: built up to its peak a beat before the event.
            const peak = Math.max(2, Math.round(num(params, 'peak', 6)));
            const at = Math.max(cursor, eventTime - 0.6);
            stepTo(cursor, at, 0.1);
            cursor = at;
            world.onCombo(peak);
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
    applyHolds();
    if (level > 1) world.levelUp(level, { silent: true });

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

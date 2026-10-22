/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sunfall — the whole doline world and its post stack, mounted in the playground.
 *
 * Mounts the exact `SunfallWorld`, `SunfallDirector` and `SunfallPost` the theme ships, so
 * phase-locked captures (`?t=`), replayed gameplay (`?event=`) and the icon frame (`?icon=1`)
 * match the game. The world's authored assets load asynchronously: `diagnostics().assets`
 * reads `ready` once the world is drawn (wait for it, as well as `__PLAYGROUND_READY__`).
 */

import * as THREE from 'three/webgpu';
import { SunfallWorld } from '../../themes/sunfall/sunfall-world.js';
import { SunfallDirector } from '../../themes/sunfall/sunfall-director.js';
import { SunfallPost, resolveSunfallPostLook } from '../../themes/sunfall/sunfall-post.js';
import { resolveSunfallQuality } from '../../themes/sunfall/sunfall-quality.js';
import { PIECE_CODES, stationIndexForLevel } from '../../themes/sunfall/sunfall-core.js';
import { readBoardViewport } from '../../themes/sunfall/sunfall-composition.js';

export const meta = {
    id: 'sunfall',
    title: 'Sunfall (full world)',
    description:
        'Hang Sơn Đoòng doline: a column of daylight through a collapse skylight onto a jungle canopy, '
        + '110 m below the eye.',
};

const DEMO_LOOP = 38;
const DEMO_SCRIPT = [
    [1.0, 'lock', { code: 'I', u: 0.25, row: 16 }],
    [2.2, 'lock', { code: 'T', u: 0.55, row: 14 }],
    [3.4, 'drop', { code: 'S', u: 0.72, row: 15 }],
    [4.8, 'clear', { lines: 2, combo: 1, codes: ['T', 'S'] }],
    [6.4, 'clear', { lines: 1, combo: 2, codes: ['Z'] }],
    [8.0, 'clear', { lines: 2, combo: 4, codes: ['I', 'O'] }],
    [9.8, 'clear', { lines: 3, combo: 7, codes: ['L', 'J', 'I'] }],
    [13.5, 'release', { peak: 7 }],
    [16.5, 'quad', { b2b: 2 }],
    [23.0, 'tspin', { lines: 2, b2b: 3 }],
    [28.5, 'perfect', {}],
];

function num(params, key, fallback = 0) {
    const raw = params.get(key);
    if (raw === null || raw === '') return fallback;
    const v = Number.parseFloat(raw);
    return Number.isFinite(v) ? v : fallback;
}

const BOARD_PX = 'min(clamp(220px, 22vw, 300px), (100vh - 250px) / 2)';

function mountBoardOverlay(withHud) {
    const root = document.createElement('div');
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5';
    const card = document.createElement('div');
    card.className = 'player-card';
    card.dataset.player = 'solo';
    card.style.cssText = [
        'position:absolute',
        'left:50%',
        'top:50%',
        `width:calc(${BOARD_PX} * 1.19)`,
        `height:calc(2 * ${BOARD_PX} + 158px)`,
        'transform:translate(-50%, -50%)',
        'background:rgba(21,26,35,0.866)',
        'border:1px solid rgba(181,226,76,0.42)',
        'border-radius:20px',
    ].join(';');
    const board = document.createElement('div');
    board.id = 'single-player-game-canvas';
    board.style.cssText = [
        'position:absolute',
        'left:50%',
        'bottom:24px',
        `width:calc(${BOARD_PX})`,
        `height:calc(2 * ${BOARD_PX})`,
        'transform:translateX(-50%)',
        'border:1px solid rgba(255,255,255,0.08)',
    ].join(';');
    card.append(board);
    root.append(card);
    if (withHud) {
        const hud = document.createElement('div');
        hud.className = 'single-player-stats-bar';
        hud.style.cssText = [
            'position:absolute',
            'top:25%',
            'height:50%',
            'left:calc(50% + min(max(300px, min(35vw, 400px)), (100vh - 200px) / 2) / 2 + 60px)',
            'width:140px',
            'background:rgba(14,22,20,0.8)',
            'border:1px solid rgba(181,226,76,0.28)',
            'border-radius:10px',
        ].join(';');
        root.append(hud);
    }
    document.body.appendChild(root);
    return root;
}

export function create({
    scene,
    camera,
    renderer,
    params,
}) {
    const quality = params.get('quality') || 'High';
    const preset = resolveSunfallQuality(quality);
    const saved = {
        fov: camera.fov,
        near: camera.near,
        far: camera.far,
        toneMapping: renderer.toneMapping,
    };

    const overlay = params.get('board') === '1' ? mountBoardOverlay(params.get('statsHud') !== '0') : null;
    const look = { ...resolveSunfallPostLook(quality) };
    if (params.has('bloom')) look.bloom = params.get('bloom') === '1';
    const samples = params.has('msaa') ? Math.max(0, Math.round(num(params, 'msaa'))) : look.msaa;
    const noPost = params.get('noPost') === '1' || !preset.enablePost;
    if (noPost) renderer.toneMapping = THREE.AgXToneMapping;
    const partsParam = params.get('parts');
    const parts = partsParam ? partsParam.split(',').map((p) => p.trim()).filter(Boolean) : null;

    const level = Math.max(1, Math.round(num(params, 'level', 1)));
    const reduce = params.get('reduce') === '1';
    const director = new SunfallDirector({
        level,
        reducedMotion: reduce,
        maxNewGrowth: preset.newGrowthSlots || 36,
    });
    const applyOverrides = () => {
        if (params.has('station')) director.setStation(params.get('station'));
        if (params.has('weather')) director.setWeather(params.get('weather'));
        if (params.has('fringe')) director.setFringeDegrees(num(params, 'fringe', 0));
    };
    applyOverrides();

    const pointer = { x: num(params, 'px', 0), y: num(params, 'py', 0) };
    const lookVals = (params.get('look') || '').split(',').map(Number);
    const eyeVals = (params.get('eye') || '').split(',').map(Number);
    const hasLook = lookVals.length >= 3 && lookVals.slice(0, 3).every(Number.isFinite);
    const hasEye = eyeVals.length >= 3 && eyeVals.slice(0, 3).every(Number.isFinite);
    const isIcon = params.get('icon') === '1';

    let world = null;
    let post = null;
    let assets = 'loading';
    let disposed = false;
    let lastSeek = null;
    let settledFrames = 0;

    const applyCameraLens = () => {
        if (!world) return;
        if (isIcon) {
            // The icon: the oculus with its lianas over the gilded hole in the deck, the column and
            // the glowing pool, from a little way out over the void.
            camera.position.set(-60, -20, -150);
            camera.fov = 62;
            camera.lookAt(-170, 14, -395);
            camera.updateProjectionMatrix();
        } else if (hasLook || hasEye) {
            if (hasEye) camera.position.set(eyeVals[0], eyeVals[1], eyeVals[2]);
            if (hasLook) {
                if (Number.isFinite(lookVals[3])) camera.fov = lookVals[3];
                camera.lookAt(lookVals[0], lookVals[1], lookVals[2]);
            }
            camera.updateProjectionMatrix();
        }
        camera.updateMatrixWorld(true);
        world.u.eye.copy(camera.position);
    };

    const size = new THREE.Vector2(1, 1);
    const syncViewport = () => {
        const w = window.innerWidth || 1280;
        const h = Math.max(1, window.innerHeight || 720);
        world?.setAspect(w, h);
        applyCameraLens();
        renderer.getDrawingBufferSize(size);
        world?.setViewportHeight(size.y);
        if (overlay) world?.setBoardViewport(readBoardViewport(document));
        post?.setSize(w, h, size.x, size.y);
    };

    const eventName = params.get('event');
    const eventAge = num(params, 'eventAge', 0.7);
    const holdCombo = Math.max(0, Math.round(num(params, 'combo', 0)));
    const holdB2B = Math.max(0, Math.round(num(params, 'b2b', 0)));
    const warmLocks = Math.max(0, Math.round(num(params, 'locks', 0)));
    const warmClears = Math.max(0, Math.round(num(params, 'clears', 0)));
    const demo = params.get('demo') === '1';
    let demoCursor = 0;
    let demoLoop = -1;

    const fireEvent = () => {
        const u = num(params, 'u', 0.52);
        const row = num(params, 'row', 13);
        const code = (params.get('shape') || 'I').toUpperCase();
        const lines = Math.max(1, Math.min(4, Math.round(num(params, 'lines', 2))));
        if (eventName === 'lock') {
            director.onPieceLock({ code, u, row });
        } else if (eventName === 'drop') {
            director.onHardDrop({
                code, u, row, distance: 16,
            });
        } else if (eventName === 'clear') {
            director.onLineClear({
                lines, rows: [row, row + 1], codes: [code, 'T', 'S', 'Z'], b2b: holdB2B,
            });
        } else if (eventName === 'quad') {
            director.onLineClear({
                lines: 4, rows: [12, 13, 14, 15], codes: ['I', 'S', 'T', 'Z'], b2b: Math.max(1, holdB2B),
            });
        } else if (eventName === 'tspin') {
            director.onTSpin({ lines });
            director.onLineClear({
                lines, rows: [row, row + 1], codes: ['T', 'L', 'I'], b2b: Math.max(1, holdB2B),
            });
        } else if (eventName === 'perfect') {
            director.onPerfectClear();
        } else if (eventName === 'levelUp') {
            director.onLevelUp(num(params, 'eventLevel', level + 1));
        } else if (eventName === 'release') {
            const peak = Math.max(3, Math.round(num(params, 'peak', 6)));
            director.onCombo(peak);
            director.releaseCombo(peak);
        } else if (eventName === 'over') {
            director.onGameOver();
        } else if (eventName === 'morning') {
            director.resetSession();
        }
    };

    const stepDirector = (dt) => {
        const snap = director.step(dt);
        if (!world) return;
        world.setPointer(pointer.x, pointer.y);
        world.applySnapshot(snap);
        applyCameraLens();
        // What the game hands the post stack (sunfall-world.js `_post`), the icon a stop darker.
        const state = world.postState;
        post?.update({ ...state, exposure: isIcon ? 0.78 : state.exposure });
    };

    const seekTo = (targetTime) => {
        lastSeek = targetTime;
        director.resetSession();
        // A replay is not a session start: no Morning pulse unless that is the event asked for.
        director.morningPulse = 0;
        director.level = level;
        director.stationTarget = stationIndexForLevel(level);
        director.stationCurrent = director.stationTarget;
        applyOverrides();
        const lead = (eventName ? eventAge : 0) + (warmLocks + warmClears) * 0.45 + (holdCombo ? 1.2 : 0);
        director.time = Math.max(0, targetTime - lead);
        if (holdB2B > 0) director.setB2B(holdB2B);
        const advance = (seconds, stepDt = 1 / 30) => {
            const steps = Math.max(1, Math.ceil(seconds / stepDt));
            const dt = seconds / steps;
            for (let i = 0; i < steps; i += 1) stepDirector(dt);
        };
        for (let i = 0; i < warmLocks; i += 1) {
            director.onPieceLock({ code: PIECE_CODES[i % 7], u: ((i * 0.29) % 0.8) + 0.1, row: 8 + ((i * 3) % 11) });
            advance(0.45);
        }
        for (let i = 0; i < warmClears; i += 1) {
            director.onLineClear({
                lines: 1 + (i % 2), rows: [10 + (i % 8)], codes: [PIECE_CODES[i % 7], PIECE_CODES[(i + 2) % 7]],
            });
            advance(0.45);
        }
        if (holdCombo > 0) {
            director.onCombo(holdCombo);
            advance(1.2);
        }
        if (eventName) {
            fireEvent();
            advance(Math.max(0.016, eventAge), 1 / 60);
        } else {
            stepDirector(0);
        }
    };

    const runDemo = (time) => {
        const loop = Math.floor(time / DEMO_LOOP);
        if (loop !== demoLoop) {
            demoLoop = loop;
            demoCursor = 0;
            director.resetSession();
            applyOverrides();
        }
        const local = time - loop * DEMO_LOOP;
        while (demoCursor < DEMO_SCRIPT.length && DEMO_SCRIPT[demoCursor][0] <= local) {
            const [, verb, detail] = DEMO_SCRIPT[demoCursor];
            if (verb === 'lock') director.onPieceLock(detail);
            else if (verb === 'drop') director.onHardDrop(detail);
            else if (verb === 'clear') {
                director.onLineClear(detail);
                if (detail.combo) director.onCombo(detail.combo);
            } else if (verb === 'release') director.releaseCombo(detail.peak);
            else if (verb === 'quad') director.onLineClear({ lines: 4, b2b: detail.b2b });
            else if (verb === 'tspin') {
                director.onTSpin({ lines: detail.lines });
                director.onLineClear({ lines: detail.lines, b2b: detail.b2b });
            } else if (verb === 'perfect') director.onPerfectClear();
            demoCursor += 1;
        }
    };

    SunfallWorld.prepare().then((prepared) => {
        if (disposed) return;
        world = new SunfallWorld({
            scene, camera, quality, parts, assets: prepared,
        });
        if (hasLook || hasEye || isIcon) world.customCameraOverride = true;
        if (!noPost) {
            post = new SunfallPost(renderer, scene, camera, {
                look, samples, u: world.u, parts, falseColor: params.get('falseColor') === '1',
            });
        }
        syncViewport();
        seekTo(lastSeek ?? num(params, 't', 0));
        assets = 'ready';
    }).catch((error) => {
        assets = 'failed';
        console.error('[sunfall effect] prepare failed:', error);
    });

    return {
        cameraRadius: 1,
        camera() {
            applyCameraLens();
        },
        update(time, dt) {
            if (demo) runDemo(time);
            stepDirector(dt);
        },
        seek(time) {
            demoLoop = -1;
            seekTo(time);
        },
        render() {
            if (post) post.render();
            else renderer.render(scene, camera);
            if (world) settledFrames += 1;
        },
        resize() {
            syncViewport();
            if (lastSeek !== null && world) seekTo(lastSeek);
        },
        getDiagnostics() {
            const snap = director.getSnapshot();
            return {
                backend: renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2',
                quality: preset.tier,
                assets,
                settledFrames,
                calls: renderer.info?.render?.calls ?? null,
                triangles: renderer.info?.render?.triangles ?? null,
                station: snap.station.id,
                weather: snap.weather.id,
                fringeDegrees: snap.fringeDegrees,
                rainbowStrength: director.rainbowStrength,
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

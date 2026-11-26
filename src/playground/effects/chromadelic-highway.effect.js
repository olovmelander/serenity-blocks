/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Chromadelic Highway — the full world + post stack, mounted in isolation.
 *
 * Mounts the SAME ChromadelicWorld and ChromadelicHighwayPost the theme ships, with the theme's
 * camera rig and composition solver, so composition and grade are judged exactly as they will
 * look in game.
 *
 * URL params:
 *   quality=High|Ultra|...   content tier (default High)
 *   board=1                  overlay the solo well, themed pieces, queue and score ledger;
 *                            the composition solver and the post's board veil read its rects
 *   hud=0                    with board=1: board only, no score ledger
 *   pulse / ring / particle / ambient = 0..1   hold a reactive state
 *   event=lock|hardDrop|combo|chain|clear|quad|levelUp|twist|b2b|perfect|gameOver  fire an event...
 *   eventAge=<s>             ...and show it <s> seconds later (combo=<n>, lines=<n>, level=<n>)
 *   parts=sky,stars,...      draw only these parts (sky stars planets road rails pylons rings air
 *                            events streaks motes meteors) for isolated iteration
 *   falseColor=1             post debug view: band the pre-tone-map max channel
 *   msaa=0|4                 override the scene-pass MSAA sample count
 *   noPost=1                 raw scene (no bloom/grade)
 *   place=<p>                pin the spectrum's level place (0 prism, 1 orchid, 2 ember, 3 triad,
 *                            4 chord, 5 tide)
 *   sector=<name|0..4>       pin a cosmic voyage sector (velvet-rift, aurora-slipstream,
 *                            starlight-crossing, ion-corridor, nebula-heart)
 *   ringForm=<name>          force every ring's form (tube double dashes beads hex hexDouble oct
 *                            octDashes octBeads prism hexPrism)
 *   airGain=<x>              the ring-air band gain (default 0.068)
 *   icon=1                   the theme-icon framing: looks straight down the road at the arches
 */
import * as THREE from 'three/webgpu';
import { CAMERA_RIG, ChromadelicWorld } from '../../themes/chromadelic-highway/chromadelic-highway-world.js';
import { ChromadelicHighwayPost, POST_LOOK } from '../../themes/chromadelic-highway/chromadelic-highway-post.js';
import { readLayoutRects, restVerticalFov } from '../../themes/chromadelic-highway/chromadelic-highway-composition.js';
import { seededRandom } from '../../themes/chromadelic-highway/chromadelic-highway-planet-events.js';
import { CHROMADELIC_HIGHWAY_TETROMINOS } from '../../themes/chromadelic-highway/chromadelic-highway-tetrominos.js';
import { mountSoloWellPreview } from '../solo-well-preview.js';

export const meta = {
    id: 'chromadelic-highway',
    title: 'Chromadelic Highway (full world)',
    description: 'The shipping world + post: prism highway, 3D cantilever pylons, neon arches, planets, cosmic sectors.',
};

function num(params, key, fallback = 0) {
    const v = Number.parseFloat(params.get(key));
    return Number.isFinite(v) ? v : fallback;
}

export function create({
    scene, camera, renderer, params, rng, seed,
}) {
    const quality = params.get('quality') || 'High';
    const saved = {
        fov: camera.fov, near: camera.near, far: camera.far, up: camera.up.clone(),
    };
    const world = new ChromadelicWorld({
        scene, quality, random: rng || Math.random, textureBase: './textures/', capture: true,
    }).build();

    const partsParam = params.get('parts');
    if (partsParam) world.showOnlyParts(partsParam.split(',').map((p) => p.trim()));
    const placeParam = params.get('place');
    const formParam = params.get('ringForm');
    if (placeParam !== null || formParam) {
        world.pinSpectrum(placeParam !== null ? num(params, 'place', 0) : null, { form: formParam || null });
    }
    const sectorParam = params.get('sector');
    if (sectorParam !== null) {
        const asNum = Number(sectorParam);
        world.pinSector(Number.isFinite(asNum) && sectorParam.trim() !== '' ? asNum : sectorParam);
    }
    if (params.get('airGain') !== null) world.airGain = num(params, 'airGain', 0.068);
    window.__chromadelic = { world };

    camera.near = 1;
    camera.far = 12000;

    const usePost = params.get('noPost') !== '1';
    const look = POST_LOOK[quality] || POST_LOOK.High;
    const msaaParam = params.get('msaa');
    const post = usePost ? new ChromadelicHighwayPost(renderer, scene, camera, {
        look,
        samples: msaaParam !== null && Number.isFinite(Number(msaaParam)) ? Number(msaaParam) : look.msaa,
        aspect: window.innerWidth / Math.max(1, window.innerHeight),
        grain: false,
        falseColor: params.get('falseColor') === '1',
    }) : null;
    const overlay = params.get('board') === '1'
        ? mountSoloWellPreview(meta.id, CHROMADELIC_HIGHWAY_TETROMINOS, params.get('hud') !== '0') : null;
    world.setBoardActive(overlay ? 1 : 0);

    const held = {
        pulse: num(params, 'pulse'),
        ring: num(params, 'ring'),
        particle: num(params, 'particle'),
        ambient: num(params, 'ambient'),
    };
    const urlEvent = {
        name: params.get('event'),
        age: num(params, 'eventAge', 0.25),
        combo: num(params, 'combo', 4),
        lines: num(params, 'lines', 2),
        level: num(params, 'level', 2),
    };
    let ev = urlEvent;
    const fireEvent = () => {
        if (ev.name === 'lock') world.onPieceLock({ pieceType: 'Z' });
        else if (ev.name === 'hardDrop') {
            world.onHardDrop();
            world.onPieceLock({ pieceType: 'I' });
        } else if (ev.name === 'combo') world.onCombo(ev.combo);
        else if (ev.name === 'chain') world.onChain(ev.combo);
        else if (ev.name === 'clear') world.onLineClear(ev.lines);
        else if (ev.name === 'quad') world.onLineClear(4);
        else if (ev.name === 'levelUp') world.onLevelUp(ev.level);
        else if (ev.name === 'twist') world.onTwist(ev.lines);
        else if (ev.name === 'b2b') world.onB2B();
        else if (ev.name === 'perfect') world.onPerfectClear();
        else if (ev.name === 'gameOver') world.onGameOver();
    };

    const size = new THREE.Vector2();
    const syncViewport = () => {
        const aspect = window.innerWidth / Math.max(1, window.innerHeight);
        camera.aspect = aspect;
        camera.fov = restVerticalFov(aspect);
        camera.updateProjectionMatrix();
        renderer.getDrawingBufferSize(size);
        world.setViewport(size.y, camera, size.x, window.innerHeight);
        const res = world.setLayout(aspect, readLayoutRects(), { width: window.innerWidth, height: window.innerHeight });
        world.setBoardActive(res.veil.board ? 1 : 0);
        post?.setSize(window.innerWidth, window.innerHeight, size.x, size.y);
        post?.setLayout(res.veil.board, res.veil.hud, res.veil.board ? 1 : 0);
    };
    overlay?.querySelector('link')?.addEventListener('load', syncViewport, { once: true });
    syncViewport();

    const sim = (time, delta) => ({
        time, delta, pace: 1, ...held,
    });
    const pushPost = (time) => post?.update({
        time, dip: world.fx.dip, bloomBoost: 0, warpRush: world.fx.warpRush ?? 0,
    });
    const iconLens = params.get('icon') === '1';
    const aimIcon = () => {
        if (!iconLens) return;
        const live = window.__chromadelic?.iconLens || {};
        camera.fov = Number.isFinite(live.fov) ? live.fov : num(params, 'iconFov', 40);
        camera.updateProjectionMatrix();
        camera.up.set(0, 1, 0);
        camera.lookAt(CAMERA_RIG.lookAt);
        camera.rotateY(Number.isFinite(live.yaw) ? live.yaw : num(params, 'iconYaw', 0));
        camera.rotateX(Number.isFinite(live.pitch) ? live.pitch : num(params, 'iconPitch', 0));
        camera.updateMatrixWorld();
        world.setViewport(size.y, camera, size.x, window.innerHeight);
    };

    const seekTo = (time) => {
        const eventName = ev.name;
        const eventAge = ev.age;
        world.resetProgress();
        world.seek(Math.max(0, time - (eventName ? eventAge : 0)));
        if (eventName) {
            // Replaying a fixed frame must choose the same comet paths on every draw.
            world.random = seededRandom(seed);
            fireEvent();
            const steps = Math.max(1, Math.round(eventAge * 60));
            const t0 = world.time;
            const dt = eventAge / steps;
            for (let i = 1; i <= steps; i++) {
                const st = t0 + i * dt;
                world.updateCamera(camera, sim(st, dt));
                aimIcon();
                world.update(sim(st, dt), camera);
            }
        }
        world.updateCamera(camera, sim(time, 0));
        aimIcon();
        world.update(sim(time, 0), camera);
        pushPost(time);
    };

    window.__chromadelic.seekEvent = (time, spec = null) => {
        ev = spec ? { ...urlEvent, ...spec } : urlEvent;
        seekTo(time);
        if (post) post.render();
        else renderer.render(scene, camera);
        return renderer.domElement;
    };

    return {
        cameraRadius: 1,
        camera(time, cam) {
            world.updateCamera(cam, { time, delta: 0 });
        },
        update(time, dt) {
            world.updateCamera(camera, sim(time, dt));
            aimIcon();
            world.update(sim(time, dt), camera);
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
            return { time: world.time, spectrum: world.getSpectrumDiagnostics() };
        },
        dispose() {
            if (window.__chromadelic?.world === world) delete window.__chromadelic;
            overlay?.querySelector('link')?.removeEventListener('load', syncViewport);
            overlay?.remove();
            post?.dispose();
            world.dispose();
            camera.fov = saved.fov;
            camera.near = saved.near;
            camera.far = saved.far;
            camera.up.copy(saved.up);
            camera.updateProjectionMatrix();
        },
    };
}

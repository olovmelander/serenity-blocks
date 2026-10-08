/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Murmuration — the swarm, the sky and the post stack,
 * mounted in isolation with the theme's own camera and show.
 *
 * URL params:
 *   quality=High|Ultra|...   content tier (default High)
 *   board=1                  overlay a mock gameplay board; events start from its cells
 *   shape=<name>             hold a formation (heart, galaxy, torus, ...)
 *   combo=<n>                hold a combo of n (the gyre spins up, the swarm warms)
 *   level=<n>                rest on level n's palette
 *   event=lock|drop|clear|quad|tspin|perfect|levelUp|gameOver   fire a gameplay event...
 *   eventAge=<s>             ...and show it <s> seconds later (lines=<n>, row=<r>, u=<0..1>)
 *   demo=1                   live only: play a looping gameplay script
 *   noPost=1                 raw scene (no bloom/grade)
 *   px=-1..1&py=-1..1        hold a pointer-parallax offset
 *   twin=0                   one centred formation instead of the pair flanking the board
 *   icon=1                   the theme-icon framing (capture a square frame)
 *   tune=key:value,...       override look constants for an A/B capture: count, size, exposure,
 *                            aperture, maxBlur, stretch, span, ambient, gyre, turbulence, tiltX,
 *                            tiltY, bloom, bloomRadius, bloomThreshold, postExposure, saturation,
 *                            contrast, vignette, lead
 *
 * With ?t=<seconds> the simulation is replayed from its first frame in fixed steps, so a
 * capture of a given URL is the same picture every time.
 */
import * as THREE from 'three/webgpu';
import { createNebulaSky } from '../../themes/murmuration/rendering/nebula-volume.js';
import { createFluidParticlesRenderer } from '../../themes/murmuration/rendering/fluid-particles-renderer.js';
import { FluidParticleSim, getFluidBudget } from '../../themes/murmuration/sim/fluid-particles.js';
import { SwarmPostPipeline, getSwarmPostProfile } from '../../themes/murmuration/post/render-pipeline.js';
import { CameraDirector } from '../../themes/murmuration/composition/camera-director.js';
import { SwarmShow } from '../../themes/murmuration/composition/swarm-show.js';
import {
    BLOOM_REACTION, BOARD_HALO, NO_POST_EXPOSURE, QUALITY_PRESETS, SWARM_FOCAL,
    applyCrowding, applySwarmFrame, normalizeQuality, projectToPlane, shapeLayout, swarmFrame,
    swarmLook,
} from '../../themes/murmuration/composition/swarm-tiers.js';
import {
    FALLBACK_BOARD, boardPoint, readBoardRect,
} from '../../themes/murmuration/composition/board-layout.js';

export const meta = {
    id: 'murmuration',
    title: 'Murmuration (Murmuration) — full theme',
    description: 'A swarm of light riding a flow field through a dark nebula; the board plays it.',
};

const REST_FOV = 38;
const STEP = 1 / 60;
/** Seconds of flow replayed before a fixed-time capture. */
const LEAD = 30;

function num(params, key, fallback = 0) {
    const v = Number.parseFloat(params.get(key));
    return Number.isFinite(v) ? v : fallback;
}

/** `tune=size:0.8,bloom:0.4` → { size: 0.8, bloom: 0.4 } */
function readTune(params) {
    const out = {};
    (params.get('tune') || '').split(',').forEach((pair) => {
        const [key, raw] = pair.split(':');
        const value = Number.parseFloat(raw);
        if (key && Number.isFinite(value)) out[key.trim()] = value;
    });
    return out;
}

const BOARD_PX = 'min(clamp(220px, 22vw, 300px), (100vh - 250px) / 2)';

/** A stand-in for the solo layout: the dark card with the playfield seated at its foot. */
function mountBoardOverlay() {
    const root = document.createElement('div');
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5';
    const card = document.createElement('div');
    card.style.cssText = [
        'position:absolute', 'left:50%', 'top:50%',
        `width:calc(${BOARD_PX} * 1.19)`, `height:calc(2 * ${BOARD_PX} + 158px)`,
        'transform:translate(-50%, -50%)', 'background:rgba(21,26,35,0.866)',
        'border:1px solid rgba(139,92,246,0.45)', 'border-radius:20px',
    ].join(';');
    const mount = document.createElement('div');
    mount.id = 'phaser-game-container';
    mount.style.cssText = [
        'position:absolute', 'left:50%', 'bottom:24px', `width:calc(${BOARD_PX})`, `height:calc(2 * ${BOARD_PX})`,
        'transform:translateX(-50%)', 'border:1px solid rgba(255,255,255,0.08)',
    ].join(';');
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;height:100%;display:block';
    mount.append(canvas);
    card.append(mount);
    root.append(card);
    document.body.appendChild(root);
    return root;
}

/** A looping script of locks and clears for the live demo (seconds into the loop). */
const DEMO_LOOP = 34;
const DEMO_SCRIPT = [
    [1.0, 'lock', { rows: [19], u: 0.2 }], [2.1, 'lock', { rows: [19, 18], u: 0.75 }],
    [3.2, 'lock', { rows: [18, 17], u: 0.4, hardDrop: true }], [4.3, 'lock', { rows: [17], u: 0.85 }],
    [5.4, 'lock', { rows: [19], u: 0.55 }], [5.4, 'clear', { rows: [19], lines: 1, combo: 1 }],
    [6.6, 'lock', { rows: [19, 18], u: 0.3 }], [6.6, 'clear', { rows: [19], lines: 1, combo: 2 }],
    [7.8, 'lock', { rows: [19, 18, 17], u: 0.8, hardDrop: true }],
    [7.8, 'clear', { rows: [19, 18], lines: 2, combo: 3 }],
    [9.0, 'lock', { rows: [19], u: 0.1 }], [9.0, 'clear', { rows: [19], lines: 1, combo: 4 }],
    [10.2, 'lock', { rows: [19, 18], u: 0.6 }], [10.2, 'clear', { rows: [19, 18, 17], lines: 3, combo: 5 }],
    [11.6, 'lock', { rows: [19], u: 0.5 }], [11.6, 'combo', { combo: 0 }],
    [12.6, 'lock', { rows: [19, 18], u: 0.15 }], [13.6, 'lock', { rows: [18, 17], u: 0.85 }],
    [14.6, 'lock', { rows: [17, 16], u: 0.35 }], [15.6, 'lock', { rows: [16, 15], u: 0.6, hardDrop: true }],
    [16.6, 'lock', { rows: [15, 14], u: 0.9 }], [17.6, 'lock', { rows: [14, 13], u: 0.05 }],
    [18.6, 'lock', { rows: [19, 18, 17, 16], u: 0.95, hardDrop: true }],
    [18.6, 'clear', { rows: [19, 18, 17, 16], lines: 4, combo: 1 }],
    [24.5, 'combo', { combo: 0 }],
    [26.0, 'lock', { rows: [19], u: 0.45 }], [27.0, 'lock', { rows: [19, 18], u: 0.7 }],
    [28.0, 'lock', { rows: [18], u: 0.25, hardDrop: true }],
    [28.0, 'clear', {
        rows: [19, 18], lines: 2, tspin: true, combo: 1,
    }],
    [30.0, 'lock', { rows: [19], u: 0.5 }], [30.0, 'combo', { combo: 0 }],
];

export function create({
    scene, camera, renderer, params, rng, seed,
}) {
    const quality = normalizeQuality(params.get('quality') || 'High');
    const preset = QUALITY_PRESETS[quality];
    const native = renderer.backend?.isWebGPUBackend === true;
    const tune = readTune(params);
    const budget = getFluidBudget(quality, { native });
    if (tune.count > 0) budget.count = Math.round(tune.count);
    const lead = tune.lead ?? LEAD;
    const saved = {
        fov: camera.fov,
        near: camera.near,
        far: camera.far,
        fog: scene.fog,
        toneMapping: renderer.toneMapping,
        toneMappingExposure: renderer.toneMappingExposure,
    };
    const iconPose = params.get('icon') === '1';

    camera.fov = REST_FOV;
    camera.near = 0.1;
    camera.far = 400;
    camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    camera.updateProjectionMatrix();
    const cameraDirector = new CameraDirector(camera, new THREE.Vector3(0, 0, 0));
    cameraDirector._idlePhase = 0; // captures are phase-locked
    cameraDirector.snapToRest();
    cameraDirector.setPointer(num(params, 'px'), num(params, 'py'));

    const focal = new THREE.Vector3(SWARM_FOCAL.x, SWARM_FOCAL.y, SWARM_FOCAL.z);
    let frame = swarmFrame(camera, budget.focalRadius, focal, REST_FOV);
    const nebula = createNebulaSky({ detail: preset.skyDetail });
    const sim = new FluidParticleSim(budget.count, {
        cpu: !native,
        seed,
        focalPoint: focal,
        focalRadius: budget.focalRadius,
        gravityStrength: budget.gravityStrength,
        turbulence: 0.6,
        extent: frame.extent,
        ambientShare: tune.ambient,
        tiltX: tune.tiltX,
        tiltY: tune.tiltY,
    });
    applySwarmFrame(sim, frame);
    sim.createComputeNode();

    const look = swarmLook(quality, budget.count);
    if (tune.size > 0) look.sizeMul = tune.size;
    if (tune.exposure > 0) look.exposure = tune.exposure;
    const fluid = createFluidParticlesRenderer(sim, {
        sizeMul: look.sizeMul,
        emissiveMul: 1.0,
        exposure: look.exposure,
        aperture: tune.aperture ?? preset.aperture,
        maxBlur: tune.maxBlur ?? preset.maxBlur,
        stretch: tune.stretch ?? preset.stretch,
        paletteSpan: tune.span,
    });
    const setExposure = () => applyCrowding(fluid, look, frame.crowding);
    setExposure();
    scene.add(nebula.mesh, fluid.mesh);

    const usePost = preset.enablePost && params.get('noPost') !== '1';
    const profile = getSwarmPostProfile(quality);
    if (tune.bloom >= 0) profile.bloomStrength = tune.bloom;
    if (tune.bloomRadius >= 0) profile.bloomRadius = tune.bloomRadius;
    if (tune.bloomThreshold >= 0) profile.bloomThreshold = tune.bloomThreshold;
    if (tune.postExposure > 0) profile.exposure = tune.postExposure;
    if (tune.saturation > 0) profile.saturation = tune.saturation;
    if (tune.contrast > 0) profile.contrast = tune.contrast;
    if (tune.vignette >= 0) profile.vignetteDarkness = tune.vignette;
    const post = usePost
        ? new SwarmPostPipeline(renderer, scene, camera, { ...profile, useMRT: preset.useMRT && native })
        : null;
    post?.setProfile(profile);
    if (!post) { // as the theme does without post
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = NO_POST_EXPOSURE;
    }

    const overlay = params.get('board') === '1' ? mountBoardOverlay() : null;
    const screenPoint = { x: 0.5, y: 0.5 };
    const locate = (detail, row, u, out) => {
        if (detail?.screen) return projectToPlane(camera, detail.screen.x, detail.screen.y, focal.z, out);
        boardPoint(overlay ? readBoardRect(0) : null, u, row, screenPoint);
        return projectToPlane(camera, screenPoint.x, screenPoint.y, focal.z, out);
    };
    const show = new SwarmShow({
        sim, visual: fluid, sky: nebula, camera: cameraDirector, focal, random: rng, locate,
    });
    if (tune.gyre >= 0) show.baseGyre = tune.gyre;
    if (tune.turbulence >= 0) show.baseTurbulence = tune.turbulence;

    const size = new THREE.Vector2(1, 1);
    const halo = { center: new THREE.Vector2(0.5, 0.5), halfSize: new THREE.Vector2(0.1, 0.3) };
    const syncViewport = () => {
        camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
        camera.updateProjectionMatrix();
        frame = swarmFrame(camera, budget.focalRadius, focal, REST_FOV);
        applySwarmFrame(sim, frame);
        setExposure();
        renderer.getDrawingBufferSize(size);
        const board = overlay ? readBoardRect(0) : null;
        if (board && post) {
            halo.center.set((board.x0 + board.x1) * 0.5, (board.y0 + board.y1) * 0.5);
            halo.halfSize.set((board.x1 - board.x0) * 0.52, (board.y1 - board.y0) * 0.51);
            post.setBoardHalo({
                center: halo.center, halfSize: halo.halfSize, ...BOARD_HALO,
            });
        }
        const span = board || FALLBACK_BOARD;
        const half = new THREE.Vector3();
        const a = { x: 0, y: 0, z: 0 };
        const b = { x: 0, y: 0, z: 0 };
        projectToPlane(camera, span.x0, span.y0, focal.z, a);
        projectToPlane(camera, span.x1, span.y1, focal.z, b);
        half.set(Math.abs(b.x - a.x) * 0.5, Math.abs(b.y - a.y) * 0.5, 0.4);
        if (board) sim.setBoardZone({ halfExtents: half });
        sim.setShapeLayout(params.get('twin') === '0' ? {} : shapeLayout(frame, half.x * 1.3));
    };
    syncViewport();

    const dyn = {};
    const step = (time, dt) => {
        show.update(dt, time);
        cameraDirector.update(dt, show.fx);
        if (iconPose) {
            // In a square frame the swarm fits itself to a near-round ring; the icon lens
            // only tightens on it (iconX / iconY slide the framing, iconFov sets the lens).
            camera.fov = num(params, 'iconFov', 34);
            camera.position.x += num(params, 'iconX', 0);
            camera.position.y += num(params, 'iconY', 0);
            camera.lookAt(num(params, 'iconX', 0), num(params, 'iconY', 0), focal.z);
            camera.updateProjectionMatrix();
            camera.updateMatrixWorld();
        }
        fluid.setLens(camera, size.y, focal);
        sim.update(dt, time, show.simParams);
        if (sim.isCPU) sim.stepCPU();
        else if (dt > 0) renderer.compute(sim.computeNode);
        fluid.update(dt, time);
        nebula.uniforms.uTime.value = time;
        nebula.uniforms.uParallax.value.set(camera.position.x, camera.position.y - 0.4);
        if (post?.isEnabled()) {
            const { fx } = show;
            dyn.time = time;
            dyn.baseBloom = profile.bloomStrength;
            dyn.bloomBoost = fx.comboIntensity * BLOOM_REACTION.combo + fx.rewardPulse * BLOOM_REACTION.reward
                + fx.bloomPunch * BLOOM_REACTION.punch;
            dyn.baseChromatic = profile.chromaticStrength;
            dyn.chromaticBoost = fx.comboPulse * 0.002 + fx.chromaPunch;
            dyn.baseVignette = profile.vignetteDarkness;
            dyn.vignetteBoost = fx.vignettePunch;
            post.updateDynamic(dyn);
            post.uBoardHaloColor?.value.setRGB(show.haloTint[0] * 0.6, show.haloTint[1] * 0.6, show.haloTint[2] * 0.6);
        }
    };

    const eventName = params.get('event');
    const eventAge = num(params, 'eventAge', 0.4);
    const holdCombo = Math.max(0, Math.round(num(params, 'combo', 0)));
    const level = Math.max(1, Math.round(num(params, 'level', 1)));
    const holdShape = params.get('shape');
    const fireEvent = () => {
        const row = Math.round(num(params, 'row', 14));
        const u = num(params, 'u', 0.3);
        const lines = Math.max(1, Math.min(4, Math.round(num(params, 'lines', 2))));
        const bottom = (n) => Array.from({ length: n }, (_, i) => 19 - i);
        if (eventName === 'lock') show.lock({ rows: [row, row - 1], u });
        else if (eventName === 'drop') show.lock({ rows: [row, row - 1], u, hardDrop: true });
        else if (eventName === 'clear') show.clear({ rows: bottom(lines), lines });
        else if (eventName === 'quad') show.clear({ rows: bottom(4), lines: 4 });
        else if (eventName === 'tspin') {
            show.clear({
                rows: bottom(2), lines: 2, tspin: true, u,
            });
        } else if (eventName === 'perfect') show.clear({ rows: bottom(4), lines: 4, perfect: true });
        else if (eventName === 'levelUp') show.levelUp(num(params, 'eventLevel', level + 1));
        else if (eventName === 'gameOver') show.gameOver();
    };
    const applyHolds = () => {
        if (level > 1) show.levelUp(level, { silent: true });
        if (holdCombo > 0) show.combo(holdCombo);
        if (holdShape) show.requestShape(holdShape, {}, num(params, 'strength', 0.7), Infinity, 9);
    };

    let lastSeek = null;
    const seekTo = (time) => {
        if (time === lastSeek) return;
        lastSeek = time;
        sim.reset(seed);
        show.reset();
        cameraDirector._idlePhase = Math.max(0, time - lead - eventAge);
        cameraDirector.snapToRest();
        cameraDirector.setPointer(num(params, 'px'), num(params, 'py'));
        const start = Math.max(0, time - lead - (eventName ? eventAge : 0));
        const eventTime = eventName ? time - eventAge : time;
        show.update(0, start);
        applyHolds();
        let cursor = start;
        const stepTo = (to) => {
            const steps = Math.max(1, Math.round((to - cursor) / STEP));
            const h = (to - cursor) / steps;
            for (let i = 1; i <= steps; i += 1) step(cursor + i * h, h);
            cursor = to;
        };
        if (eventTime > cursor) stepTo(eventTime);
        if (eventName) {
            fireEvent();
            if (time > cursor) stepTo(time);
        }
        step(time, 0);
    };

    const demo = params.get('demo') === '1';
    let demoCursor = 0;
    let demoLoop = -1;
    const runDemo = (time) => {
        const loop = Math.floor(time / DEMO_LOOP);
        if (loop !== demoLoop) {
            demoLoop = loop;
            demoCursor = 0;
            show.resetSession();
        }
        const local = time - loop * DEMO_LOOP;
        while (demoCursor < DEMO_SCRIPT.length && DEMO_SCRIPT[demoCursor][0] <= local) {
            const [, verb, detail] = DEMO_SCRIPT[demoCursor];
            if (verb === 'lock') show.lock(detail);
            else if (verb === 'combo') show.combo(detail.combo);
            else {
                show.clear(detail);
                show.combo(detail.combo);
            }
            demoCursor += 1;
        }
    };

    let liveStarted = false;
    return {
        cameraRadius: 1,
        camera() { /* the director owns the camera; it is stepped in update/seek */ },
        update(time, dt) {
            if (!liveStarted) {
                liveStarted = true;
                show.update(0, time);
                applyHolds();
            }
            if (demo) runDemo(time);
            step(time, Number.isFinite(dt) ? dt : STEP);
        },
        seek(time) {
            seekTo(time);
        },
        render() {
            if (post?.isEnabled()) post.render();
            else renderer.render(scene, camera);
        },
        resize() {
            syncViewport();
        },
        fire(name, detail = {}) {
            if (name === 'lock') show.lock(detail);
            else if (name === 'clear') show.clear(detail);
            else if (name === 'combo') show.combo(detail.combo ?? 0);
            else if (name === 'levelUp') show.levelUp(detail.level ?? show.level + 1);
            else if (name === 'gameOver') show.gameOver();
            else if (name === 'gameStart') show.gameStart();
        },
        getDiagnostics() {
            return {
                backend: native ? 'WebGPU' : 'WebGL2',
                quality,
                count: sim.count,
                cpu: sim.isCPU,
                mrt: post?.mrtEnabled ?? false,
                crowding: frame.crowding,
                ...show.getState(),
            };
        },
        getActiveParticleCount() { return sim.count; },
        dispose() {
            overlay?.remove();
            scene.remove(nebula.mesh, fluid.mesh);
            show.dispose();
            post?.dispose();
            nebula.dispose();
            fluid.dispose();
            sim.dispose();
            scene.fog = saved.fog;
            renderer.toneMapping = saved.toneMapping;
            renderer.toneMappingExposure = saved.toneMappingExposure;
            camera.fov = saved.fov;
            camera.near = saved.near;
            camera.far = saved.far;
            camera.updateProjectionMatrix();
        },
    };
}

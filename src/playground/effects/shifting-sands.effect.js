/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Shifting Sands — the full world + post stack, mounted in isolation.
 *
 * Mounts the SAME ShiftingSandsWorld and ShiftingSandsPost the theme ships, with the theme's
 * camera rig and lens, so composition and grade are judged exactly as they will look in game.
 *
 * URL params:
 *   quality=High|Ultra|...   content tier (default High)
 *   board=1                  overlay a mock gameplay board + HUD (the solo layout rules); the
 *                            post's calm zones read its rects
 *   statsHud=0               with board=1: board only, no HUD mock
 *   event=lock|combo|clear|tetris|levelUp   fire a gameplay event...
 *   eventAge=<s>             ...and show it <s> seconds later (combo=<n>, lines=<n>, level=<n>)
 *   dusk=0..1                hold the level-progression dusk
 *   parts=dunes,sky,...      draw only these parts
 *   falseColor=1             post debug view: band the pre-tone-map max channel
 *   noPost=1                 raw scene (no bloom/grade)
 *   rays=<n>&bloom=0|1       override the tier's shaft taps / bloom
 *   px=-1..1&py=-1..1        hold a pointer-parallax offset
 *   icon=1                   the theme-icon framing (a tight lens on the suns and a breach held
 *                            in front of them; iconYaw / iconPitch / iconFov)
 *
 * The worm (it breaches anywhere in the erg; these hold it still for a look):
 *   breach=1                 ?t= counts from the idle worm breaking the sand (negative: its sign)
 *   cycle=<n>                ...of idle cycle n (default 0): each cycle draws its own site
 *   wormAz / wormDist / wormHeading / wormLeap / wormR
 *                            hold the idle breach at a site: azimuth and travel direction in
 *                            degrees (+ right of forward), distance, 0 hoop → 1 long leap, radius
 *   follow=1                 aim a tight lens at the live worm (followFov, default 15;
 *                            followSlot=1 for the summoned one; followFoot=up|down for one foot;
 *                            followLift=<units> raises the camera to look down into the wells)
 */
import * as THREE from 'three/webgpu';
import { ShiftingSandsWorld } from '../../themes/shifting-sands/shifting-sands-world.js';
import { ShiftingSandsPost, POST_LOOK } from '../../themes/shifting-sands/shifting-sands-post.js';
import { REST_RIG, readLayoutRects, restVerticalFov } from '../../themes/shifting-sands/shifting-sands-composition.js';

export const meta = {
    id: 'shifting-sands',
    title: 'Shifting Sands (full world)',
    description: 'Arrakis at the twin-sun dusk: the erg, the Sentinel, the worm, spice and sand.',
};

function num(params, key, fallback = 0) {
    const v = Number.parseFloat(params.get(key));
    return Number.isFinite(v) ? v : fallback;
}

/** A stand-in for the real solo layout (public/styles/main.css) with the real class names. */
function mountBoardOverlay(withHud) {
    const root = document.createElement('div');
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5';
    const board = document.createElement('div');
    board.className = 'player-card';
    board.dataset.player = 'solo';
    board.style.cssText = [
        'position:absolute', 'left:50%', 'top:50%',
        'width:calc(min(clamp(220px, 22vw, 300px), (100vh - 250px) / 2) * 1.19)',
        'height:calc(2 * min(clamp(220px, 22vw, 300px), (100vh - 250px) / 2) + 158px)',
        'transform:translate(-50%, -50%)', 'background:rgba(21,26,35,0.866)',
        'border:1px solid rgba(139,92,246,0.45)', 'border-radius:20px',
    ].join(';');
    root.append(board);
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
        fov: camera.fov, near: camera.near, far: camera.far,
    };
    const world = new ShiftingSandsWorld({ scene, quality, capture: true }).build();
    const iconPose = params.get('icon') === '1';
    const pinKeys = ['wormAz', 'wormDist', 'wormHeading', 'wormLeap', 'wormR'];
    if (pinKeys.some((key) => params.has(key)) || iconPose) {
        // The icon's breach: in front of the suns, crossing them.
        const pin = iconPose ? { az: -27, dist: 1350, heading: -118 } : {};
        pinKeys.forEach((key) => {
            if (params.has(key)) pin[key === 'wormR' ? 'R' : key.slice(4).toLowerCase()] = num(params, key);
        });
        world.director.setPinned(pin);
    }
    const partsParam = params.get('parts');
    if (partsParam) world.showOnlyParts(partsParam.split(',').map((p) => p.trim()));
    if (params.has('dusk')) {
        world.duskTarget = num(params, 'dusk');
        world.dusk = world.duskTarget;
    }

    camera.near = REST_RIG.near;
    camera.far = REST_RIG.far;

    const look = { ...(POST_LOOK[quality] || POST_LOOK.High) };
    // Debug overrides: rays=<taps>, bloom=0|1.
    if (params.has('rays')) look.rays = num(params, 'rays');
    if (params.has('bloom')) look.bloom = params.get('bloom') === '1';
    const usePost = params.get('noPost') !== '1';
    const post = usePost ? new ShiftingSandsPost(renderer, scene, camera, {
        look,
        shared: world.shared,
        grain: false,
        falseColor: params.get('falseColor') === '1',
    }) : null;
    const overlay = params.get('board') === '1' ? mountBoardOverlay(params.get('statsHud') !== '0') : null;

    const pointer = { x: num(params, 'px'), y: num(params, 'py') };
    const follow = params.get('follow') === '1';
    const followTarget = new THREE.Vector3();
    const placeCamera = (cam, s) => {
        world.updateCamera(cam, s);
        if (follow) {
            // A tight lens on the live worm (or one of its feet). The director is closed-form,
            // so asking it for this frame's worm early changes nothing.
            const { slots } = world.director.update(s.time);
            const want = params.has('followSlot') ? slots[num(params, 'followSlot')] : null;
            const br = (want || slots.find((slot) => slot.breach) || slots[0]).breach;
            if (!br) return;
            const foot = { up: br.up, down: br.down }[params.get('followFoot')];
            if (foot) followTarget.set(foot.x, foot.y + br.R * 0.6, foot.z);
            else followTarget.set(br.ox, br.oy + (br.b - br.k) * 0.42, br.oz);
            cam.position.y += num(params, 'followLift');
            cam.lookAt(followTarget);
            cam.updateMatrixWorld();
            return;
        }
        if (!iconPose) return;
        // A tight lens on the twin suns and the arch of the breach held in front of them.
        const pitch = THREE.MathUtils.degToRad(num(params, 'iconPitch', 1.5));
        cam.rotation.set(pitch, THREE.MathUtils.degToRad(num(params, 'iconYaw', 27)), 0);
        cam.updateMatrixWorld();
    };
    const eventName = params.get('event');
    const eventAge = num(params, 'eventAge', 0.5);
    const fireEvent = () => {
        if (eventName === 'lock') world.onPieceLock?.();
        else if (eventName === 'combo') world.onCombo?.(num(params, 'combo', 4));
        else if (eventName === 'clear') world.onLineClear?.(num(params, 'lines', 2));
        else if (eventName === 'tetris') world.onLineClear?.(4);
        else if (eventName === 'levelUp') world.onLevelUp?.(num(params, 'level', 2));
    };

    const size = new THREE.Vector2(1, 1);
    const syncViewport = () => {
        const aspect = window.innerWidth / Math.max(1, window.innerHeight);
        camera.aspect = aspect;
        camera.fov = iconPose ? num(params, 'iconFov', 26) : restVerticalFov(aspect);
        camera.updateProjectionMatrix();
        renderer.getDrawingBufferSize(size);
        world.setViewport(size.y, camera);
        if (follow) {
            // The world keeps the game's lens (the worm's range is what the player would see);
            // only pixel-sized content follows the tight one.
            camera.fov = num(params, 'followFov', 15);
            camera.updateProjectionMatrix();
            const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2;
            world.shared.uPxScale.value = Math.max(1, size.y) / (2 * Math.tan(halfFov));
        }
        post?.setSize(window.innerWidth, window.innerHeight, size.x, size.y);
        if (overlay) {
            const rects = readLayoutRects();
            const list = rects ? [...rects.cards, rects.hud].filter(Boolean) : [];
            post?.setCalmRects(list, rects ? 1 : 0);
            world.setKeepOutRects(list);
        }
    };
    syncViewport();

    const sim = (time, delta) => ({
        time, delta, pointerX: pointer.x, pointerY: pointer.y,
    });
    const pushPost = (time) => {
        const sun = world.getSunScreen();
        post?.update({
            time, sunUV: sun, sunVis: sun.visible, horizonY: sun.horizonY, flash: world.flash ?? 0,
        });
    };
    // breach=1: the clock starts when the idle worm of the chosen cycle breaks the sand.
    const clockOrigin = () => (params.get('breach') === '1'
        ? world.director.idleBreach(Math.max(0, Math.round(num(params, 'cycle', 0)))).t0
        : 0);
    const seekTo = (playgroundTime) => {
        const time = Math.max(0, playgroundTime + clockOrigin());
        world.seek(Math.max(0, time - (eventName ? eventAge : 0)));
        if (eventName) {
            fireEvent();
            const steps = Math.max(1, Math.round(eventAge * 60));
            const t0 = world.time;
            const dt = eventAge / steps;
            for (let i = 1; i <= steps; i++) {
                const st = t0 + i * dt;
                placeCamera(camera, sim(st, dt));
                world.update(sim(st, dt), camera);
            }
        }
        placeCamera(camera, sim(time, 0));
        world.update(sim(time, 0), camera);
        pushPost(time);
    };

    return {
        cameraRadius: 1,
        camera(playgroundTime, cam) {
            placeCamera(cam, sim(Math.max(0, playgroundTime + clockOrigin()), 0));
        },
        update(playgroundTime, dt) {
            const time = Math.max(0, playgroundTime + clockOrigin());
            placeCamera(camera, sim(time, dt));
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
        /** window.__PLAYGROUND__.diagnostics(): where and when the worms are (for timed captures). */
        getDiagnostics() {
            const describe = (br) => (br ? {
                az: br.az, dist: br.dist, t0: br.t0, tDown: br.tDown, duration: br.duration, R: br.R,
            } : null);
            const cycle = Math.max(0, Math.round(num(params, 'cycle', 0)));
            return {
                terrain: world.terrain?.stats ?? null,
                idle: describe(world.director.idleBreach(cycle)),
                live: world.director.state.slots.map((slot) => describe(slot.breach)),
            };
        },
        dispose() {
            overlay?.remove();
            post?.dispose();
            world.dispose();
            camera.fov = saved.fov;
            camera.near = saved.near;
            camera.far = saved.far;
            camera.updateProjectionMatrix();
        },
    };
}

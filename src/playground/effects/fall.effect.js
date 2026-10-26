import * as THREE from 'three/webgpu';
import { sceneSamples } from '../../themes/shared/scene-antialias.js';
import { loadFallAssets, disposeFallAssets } from '../../themes/fall/fall-assets.js';
import { FallWorld } from '../../themes/fall/fall-world.js';
import { FallReactions } from '../../themes/fall/fall-reactions.js';
import { FallPost } from '../../themes/fall/fall-post.js';

export const meta = {
    id: 'fall',
    title: 'Fall — the enchanted grove',
    description: 'Blender-grown maples, oak and birch under a low sun, with volumetric shafts and living leaves.',
};

export function create({
    scene, camera, renderer, params, rng,
}) {
    const saved = {
        fov: camera.fov,
        near: camera.near,
        far: camera.far,
        tone: renderer.toneMapping,
        exposure: renderer.toneMappingExposure,
        shadows: renderer.shadowMap.enabled,
    };
    const quality = params.get('quality') || 'High';
    // ?level=<n> sets the level the grove stands on: every level is one light on (quiet afternoon,
    // amber hour, rose dusk, blue mist, bright October, and round again). The clock turns the
    // lights too, so ?t= past 38 s shows one melting into the next (fall-moods.js).
    const rawLevel = Number(params.get('level') ?? 1);
    const level = Number.isFinite(rawLevel) ? Math.max(1, Math.round(rawLevel)) : 1;
    // ?msaa=<n> overrides the scene pass's samples (the theme's own: 4 from High up, else 0 + FXAA).
    const samples = params.has('msaa')
        ? Math.max(0, Math.round(Number(params.get('msaa')) || 0)) : sceneSamples(quality);
    // The red squirrel: ?squirrel=0 leaves it out; ?squirrelSeed=<n> gives it another day;
    // ?squirrelStart=ground starts it on the floor (else it comes down out of the maple's crown);
    // ?squirrelCam=<metres> follows it with the camera that far off, seen from the game's side;
    // ?squirrelOrbit=<degrees> swings that camera round it (about the world's up; 90 is its right
    // as the game sees it, 180 behind it) and ?squirrelTilt=<degrees> sets how far above it the camera
    // looks down from (else the game eye's own height).
    const squirrel = params.get('squirrel') !== '0';
    const squirrelSeed = Number(params.get('squirrelSeed') ?? 271);
    const squirrelStart = params.get('squirrelStart') === 'ground' ? 'ground' : 'crown';
    // ?squirrelPlan=snack,climb,peek: its routines, in that order, before it chooses for itself.
    const squirrelScript = (params.get('squirrelPlan') || '').split(',').map((bit) => bit.trim()).filter(Boolean);
    const followAt = Number(params.get('squirrelCam') ?? 0);
    const follow = Number.isFinite(followAt) && followAt > 0 ? followAt : 0;
    const followOrbit = THREE.MathUtils.degToRad(Number(params.get('squirrelOrbit') ?? 0) || 0);
    const followTiltAt = params.has('squirrelTilt') ? Number(params.get('squirrelTilt')) : NaN;
    const followTilt = Number.isFinite(followTiltAt) ? THREE.MathUtils.degToRad(followTiltAt) : null;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    let disposed = false;
    let world = null;
    let post = null;
    let assets = null;
    let pendingSeek = null;
    let sought = null;
    let overlay;
    const randomTape = [];
    let randomIndex = 0;
    const reactions = new FallReactions({
        quality,
        rng: () => {
            if (randomTape[randomIndex] === undefined) randomTape[randomIndex] = rng();
            randomIndex += 1;
            return randomTape[randomIndex - 1];
        },
    });
    if (params.get('board') === '1') {
        overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);'
            + 'width:24vw;height:84vh;border:1px solid #fed39650;'
            + 'border-radius:14px;background:#12171fd9;pointer-events:none;z-index:3';
        document.body.appendChild(overlay);
    }
    const ready = loadFallAssets().then((loaded) => {
        if (disposed) {
            disposeFallAssets(loaded);
            return;
        }
        assets = loaded;
        world = new FallWorld({
            scene,
            camera,
            quality,
            rng,
            assets,
            squirrel,
            squirrelSeed: Number.isFinite(squirrelSeed) ? squirrelSeed : 271,
            squirrelStart,
            squirrelScript,
        }).build();
        world.setLevel(level, { silent: true });
        post = new FallPost({
            renderer, scene, camera, quality, light: world.light, samples,
        });
        post.setSize(window.innerWidth, window.innerHeight);
    });
    const followEye = new THREE.Vector3();
    const followTarget = new THREE.Vector3();
    /** The close-up: the camera `follow` metres from the squirrel on the game eye's side of it. */
    const aimFollow = () => {
        const pose = world?.squirrelPose;
        if (!follow || !pose) return;
        followTarget.fromArray(pose.position).addScaledVector(new THREE.Vector3().fromArray(pose.normal), 0.25);
        world.prepareCamera(camera.aspect);
        followEye.copy(camera.position).sub(followTarget).normalize();
        const azimuth = Math.atan2(followEye.z, followEye.x) + followOrbit;
        const tilt = followTilt ?? Math.asin(THREE.MathUtils.clamp(followEye.y, -1, 1));
        followEye.set(Math.cos(azimuth) * Math.cos(tilt), Math.sin(tilt), Math.sin(azimuth) * Math.cos(tilt))
            .multiplyScalar(follow).add(followTarget);
        camera.position.copy(followEye);
        camera.lookAt(followTarget);
        camera.fov = 30;
        camera.updateProjectionMatrix();
    };
    const update = (time, dt) => {
        reactions.update(dt);
        const frame = reactions.getFrame();
        world?.update(time, dt, frame);
        post?.update(frame);
        aimFollow();
    };
    // ?event=lock|drop|clear|double|triple|tetris|combo|streak|spin|perfect|b2b|level, placed
    // with ?col=0..9 and ?row=0..19 (0 is the top visible row).
    const fire = (event) => {
        const column = Number(params.get('col') ?? 1);
        const row = Number(params.get('row') ?? 15) + 4;
        const piece = {
            shapeKey: 'T', x: column, y: row, shape: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
        };
        const lines = {
            clear: 1, double: 2, triple: 3, tetris: 4,
        }[event];
        if (event === 'lock') reactions.onPieceLock({ piece });
        else if (event === 'drop') {
            reactions.onHardDrop({ piece, distance: 16 });
            reactions.onPieceLock({ piece });
        } else if (lines) {
            reactions.onPieceLock({ piece });
            reactions.onLineClear(lines, { clearedRows: Array.from({ length: lines }, (_, i) => row + 1 - i) });
        } else if (event === 'combo') reactions.onCombo(Number(params.get('combo') || 6));
        else if (event === 'streak') {
            for (let i = 0; i < Number(params.get('combo') || 5); i += 1) {
                reactions.onPieceLock({ piece });
                reactions.onLineClear(1, { clearedRows: [row + 1] });
            }
        } else if (event === 'spin') reactions.onTSpin({ piece });
        else if (event === 'perfect') reactions.onPerfectClear();
        else if (event === 'b2b') reactions.onBackToBack();
        else if (event === 'over') {
            reactions.onGameOver();
            world?.onGameOver();
        } else if (event === 'level') {
            // As the theme does: the flourish, and the grove one light on.
            reactions.onLevelUp();
            world?.setLevel(world.level + 1);
        }
    };
    const seek = (time) => {
        if (!Number.isFinite(time)) return;
        if (!world) {
            pendingSeek = time;
            return;
        }
        if (time === sought) return;
        const target = Math.max(0, time);
        reactions.reset();
        world.resetEffects();
        // The replay begins on the level asked for; the clock turns the light from there.
        world.setLevel(level, { silent: true });
        randomIndex = 0;
        const age = Number(params.get('eventAge') ?? 0.35);
        // ?eventAt=<s> pins the event on the clock instead (so a run of seeks films one event).
        const at = Number(params.get('eventAt'));
        const eventTime = params.has('eventAt') && Number.isFinite(at) ? Math.max(0, at)
            : Math.max(0, target - (Number.isFinite(age) ? Math.max(0, age) : 0.35));
        const steps = Math.max(1, Math.ceil(target * 60));
        const dt = target / steps;
        let fired = false;
        for (let i = 1; i <= steps; i += 1) {
            if (!fired && i * dt >= eventTime) {
                fired = true;
                fire(params.get('event'));
            }
            update(i * dt, dt);
        }
        sought = time;
    };
    return {
        cameraRadius: 1,
        camera() {},
        seek,
        update(time, dt) {
            if (!params.has('t')) update(time, Math.max(0, Math.min(0.05, dt)));
        },
        render() {
            if (post) post.render();
        },
        async renderAsync() {
            await ready;
            if (disposed || !post) return;
            if (pendingSeek !== null) seek(pendingSeek);
            else update(0, 0);
            // A few frames let async pipelines land and the static shadow map settle.
            for (let i = 0; i < 4; i += 1) post.render();
        },
        resize(width, height) {
            world?.prepareCamera(camera.aspect);
            post?.setSize(width, height);
            aimFollow();
        },
        getDiagnostics() {
            return {
                ready: Boolean(world),
                ...(world?.getDiagnostics() || {}),
                ...(post?.getDiagnostics() || {}),
                activeEmitters: reactions.getFrame().emitters.length,
            };
        },
        dispose() {
            disposed = true;
            overlay?.remove();
            post?.dispose();
            reactions.dispose();
            world?.dispose();
            disposeFallAssets(assets);
            camera.fov = saved.fov;
            camera.near = saved.near;
            camera.far = saved.far;
            camera.updateProjectionMatrix();
            renderer.toneMapping = saved.tone;
            renderer.toneMappingExposure = saved.exposure;
            renderer.shadowMap.enabled = saved.shadows;
        },
    };
}

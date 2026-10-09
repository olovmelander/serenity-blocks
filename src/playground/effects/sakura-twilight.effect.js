import * as THREE from 'three/webgpu';
import { loadSakuraAssets, disposeSakuraAssets } from '../../themes/sakura-twilight/sakura-assets.js';
import { SakuraWorld } from '../../themes/sakura-twilight/sakura-world.js';
import { SakuraReactions } from '../../themes/sakura-twilight/sakura-reactions.js';
import { SakuraPost } from '../../themes/sakura-twilight/sakura-post.js';

export const meta = {
    id: 'sakura-twilight',
    title: 'Sakura Twilight — the moonlit garden',
    description: 'Blender-grown cherries over a mirror lake: a low moon, lantern light and living petals.',
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
    const reactions = new SakuraReactions({
        quality,
        rng: () => {
            if (randomTape[randomIndex] === undefined) randomTape[randomIndex] = rng();
            randomIndex += 1;
            return randomTape[randomIndex - 1];
        },
    });
    if (params.get('board') === '1') {
        overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;left:50%;top:51%;transform:translate(-50%,-50%);'
            + 'width:23vw;height:84vh;border:1px solid #ffc9d950;'
            + 'border-radius:14px;background:#140f1fd9;pointer-events:none;z-index:3';
        document.body.appendChild(overlay);
    }
    // ?icon=1 is the theme-icon framing: a long lens on the torii under the mountain, with
    // the moon brought round beside it. Wide framings read dark and off-centre at 80 px.
    const frameIcon = () => {
        if (params.get('icon') !== '1' || !world) return;
        camera.fov = 40;
        camera.position.set(5.1, 4.9, 12.5);
        camera.lookAt(-19.3, 11.6, -42.3);
        camera.updateProjectionMatrix();
        world.light.setMoon(-13.5, 17.5);
        world.stage.refresh();
    };
    const ready = loadSakuraAssets().then((loaded) => {
        if (disposed) {
            disposeSakuraAssets(loaded);
            return;
        }
        assets = loaded;
        world = new SakuraWorld({
            scene, camera, quality, rng, assets,
        }).build();
        post = new SakuraPost({
            renderer, scene, camera, quality, light: world.light, prime: () => world.primeShadows(renderer),
        });
        post.setSize(window.innerWidth, window.innerHeight);
        frameIcon();
    });
    // ?foxCam=<metres> is a lens that keeps that far from a fox (?foxWhich=0|1) and follows it:
    // round it from its front by ?foxCamYaw=<deg> (or `viewer`: the side the game sees it from),
    // with ?foxCamFov=<deg>. ?foxAct=<acts|hunt> stops that fox ?foxActAge seconds before the
    // frame and has it do them (Sit, LookAround, Stretch, Greet, CurlSleep…).
    const number = (name, fallback) => {
        const value = Number(params.get(name));
        return params.has(name) && Number.isFinite(value) ? value : fallback;
    };
    const foxCam = number('foxCam', 0);
    const foxWhich = number('foxWhich', 0) === 1 ? 1 : 0;
    const foxAct = (params.get('foxAct') || '').split(',').map((name) => name.trim()).filter(Boolean);
    const foxLook = new THREE.Vector3();
    const frameFox = () => {
        const fox = world?.foxes?.foxes[foxWhich];
        if (!(foxCam > 0) || !fox) return;
        const { pose } = fox.mind;
        const around = params.get('foxCamYaw') === 'viewer'
            ? Math.atan2(world.camera.position.x - pose.x, 16 - pose.z)
            : pose.heading + number('foxCamYaw', 40) * (Math.PI / 180);
        foxLook.set(pose.x, pose.y + pose.lift + 0.45, pose.z);
        camera.position.set(
            foxLook.x + Math.sin(around) * foxCam,
            foxLook.y + foxCam * 0.2 + 0.1,
            foxLook.z + Math.cos(around) * foxCam,
        );
        camera.fov = number('foxCamFov', 30);
        camera.up.set(0, 1, 0);
        camera.lookAt(foxLook);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
    };
    const update = (time, dt) => {
        reactions.update(dt);
        const frame = reactions.getFrame();
        world?.update(time, dt, frame);
        post?.update(frame);
        frameFox();
    };
    // ?event=lock|drop|clear|double|triple|tetris|combo|streak|spin|perfect|level|over,
    // placed with ?col=0..9 and ?row=0..19 (0 is the top visible row).
    const fire = (event) => {
        const column = Number(params.get('col') ?? 1);
        const row = Number(params.get('row') ?? 12) + 4;
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
        else if (event === 'level') reactions.onLevelUp();
        else if (event === 'over') reactions.onGameOver();
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
        randomIndex = 0;
        const age = Number(params.get('eventAge') ?? 0.35);
        const eventTime = Math.max(0, target - (Number.isFinite(age) ? Math.max(0, age) : 0.35));
        const steps = Math.max(1, Math.ceil(target * 60));
        const dt = target / steps;
        const actTime = foxAct.length ? Math.max(0, target - Math.max(0, number('foxActAge', 1))) : Infinity;
        let fired = false;
        let acted = false;
        for (let i = 1; i <= steps; i += 1) {
            if (!fired && i * dt >= eventTime) {
                fired = true;
                fire(params.get('event'));
            }
            if (!acted && i * dt >= actTime) {
                acted = true;
                const { foxes } = world;
                foxes.mind.rehearse(foxAct[0] === 'hunt' ? ['Listen', 'Pounce', 'Dig', 'Shake'] : foxAct, foxes.time, foxWhich);
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
            frameFox();
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
            frameIcon();
            frameFox();
        },
        getDiagnostics() {
            return {
                ready: Boolean(world),
                ...(world?.getDiagnostics() || {}),
                ...(post?.getDiagnostics() || {}),
                activeEmitters: reactions.getFrame().emitters.length,
                foxes: (world?.foxes?.foxes || []).map((fox) => ({
                    rigged: fox.rigged, mode: fox.mind.mode, clip: fox.mind.pose.clip, x: fox.mind.pose.x, z: fox.mind.pose.z,
                })),
            };
        },
        dispose() {
            disposed = true;
            overlay?.remove();
            post?.dispose();
            reactions.dispose();
            world?.dispose();
            disposeSakuraAssets(assets);
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

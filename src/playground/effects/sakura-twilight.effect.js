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
    const update = (time, dt) => {
        reactions.update(dt);
        const frame = reactions.getFrame();
        world?.update(time, dt, frame);
        post?.update(frame);
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
            frameIcon();
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

import * as THREE from 'three/webgpu';
import { disposeForestAssets, loadForestAssets } from '../../themes/forest/forest-assets.js';
import { ForestWorld } from '../../themes/forest/forest-world.js';
import { ForestReactions } from '../../themes/forest/forest-reactions.js';
import { forestGroundHeight } from '../../themes/forest/forest-terrain.js';
import { forestRidePoint } from '../../themes/forest/forest-plan.js';
import { ForestPost } from '../../themes/forest/forest-post.js';
import { seededRandom } from '../../utils/helpers.js';

export const meta = {
    id: 'forest',
    title: 'Forest — the firefly night',
    description: 'An old spruce wood under a full moon: moonbeams, mist, fireflies and waves of light.',
};

export function create({
    scene, camera, renderer, params,
}) {
    // The theme's own generator and default seed, so a capture shows the forest the game grows.
    const rawSeed = Number(params.get('seed') ?? 419);
    const rng = seededRandom(Number.isFinite(rawSeed) ? rawSeed : 419);
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
    const reactions = new ForestReactions({
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
            + 'width:23vw;height:84vh;border:1px solid #b9e9ff40;'
            + 'border-radius:14px;background:#0a1018d9;pointer-events:none;z-index:3';
        document.body.appendChild(overlay);
    }
    const aim = () => {
        if (!world) return;
        world.prepareCamera(camera.aspect);
        // ?icon=1 is the theme icon's lens: from a little way down the ride, low in the ferns, the
        // young spruce stand against the moon (the centre square of a 16:9 capture is the icon).
        if (params.get('icon') === '1') {
            const spot = forestRidePoint(30, 0.6);
            const eye = forestGroundHeight(spot.x, spot.z) + 1.3;
            const far = forestRidePoint(130, 0.6);
            camera.position.set(spot.x, eye, spot.z);
            camera.fov = 21;
            camera.lookAt(far.x, eye + 100 * Math.tan(THREE.MathUtils.degToRad(15.5)), far.z);
            camera.updateProjectionMatrix();
            world.stage.refresh();
            // At 80 px an icon needs deep silhouettes: thinner air and a darker print.
            world.light.uHaze.value = 0.0028;
            world.light.uHazeMoonAmount.value = 0.2;
            if (post) {
                post.exposure = 0.7;
                post.shaftGain = 0.2;
                post.bloomGain = 0.6;
            }
        }
    };
    const ready = loadForestAssets()
        .then((loaded) => {
            if (disposed) {
                disposeForestAssets(loaded);
                return;
            }
            assets = loaded;
            world = new ForestWorld({
                scene, camera, quality, rng, assets,
            }).build();
            aim();
            post = new ForestPost({
                renderer, scene, camera, quality, light: world.light,
            });
            post.setSize(window.innerWidth, window.innerHeight);
            aim();
        });
    const update = (time, dt) => {
        reactions.update(dt);
        const frame = reactions.getFrame();
        world?.update(time, dt, frame);
        post?.update(frame);
    };
    // ?event=lock|drop|clear|double|triple|quad|combo|streak|spin|perfect|level|over, placed
    // with ?col=0..9 and ?row=0..19 (0 is the top visible row).
    const fire = (event) => {
        const column = Number(params.get('col') ?? 1);
        const row = Number(params.get('row') ?? 15) + 4;
        const piece = {
            shapeKey: 'T', x: column, y: row, shape: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
        };
        const lines = {
            clear: 1, double: 2, triple: 3, quad: 4,
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
        // ?hold=1 keeps a combo alive by repeating the event every second up to the capture.
        const hold = params.get('hold') === '1';
        const steps = Math.max(1, Math.ceil(target * 60));
        const dt = target / steps;
        let next = eventTime;
        for (let i = 1; i <= steps; i += 1) {
            if (next !== null && i * dt >= next) {
                fire(params.get('event'));
                next = hold ? next + 1 : null;
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
            post?.render();
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
            aim();
            post?.setSize(width, height);
        },
        // Live poke for interactive sessions: window.__PLAYGROUND__ users can fire events.
        fire,
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
            disposeForestAssets(assets);
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

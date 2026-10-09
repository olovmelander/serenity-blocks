import * as THREE from 'three/webgpu';
import { disposeVerdantHillsAssets, loadVerdantHillsAssets } from '../../themes/verdant-hills/verdant-hills-assets.js';
import { VerdantHillsWorld } from '../../themes/verdant-hills/verdant-hills-world.js';
import { VerdantHillsReactions } from '../../themes/verdant-hills/verdant-hills-reactions.js';
import { VerdantHillsPost } from '../../themes/verdant-hills/verdant-hills-post.js';
import { seededRandom } from '../../utils/helpers.js';

export const meta = {
    id: 'verdant-hills',
    title: 'Verdant Hills — a windy day on the downs',
    description: 'Cumulus and their shadows over rolling green hills, a sea of grass, an old oak and seven kites.',
};

const SHAPES = {
    I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    O: [[1, 1], [1, 1]],
    T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
    S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
    J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
};
const BAG = ['T', 'O', 'Z', 'I', 'S', 'L', 'J'];

export function create({
    scene, camera, renderer, params,
}) {
    // The theme's own generator and default seed, so a capture shows the hills the game grows.
    const rawSeed = Number(params.get('seed') ?? 1107);
    const rng = seededRandom(Number.isFinite(rawSeed) ? rawSeed : 1107);
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
    const reactions = new VerdantHillsReactions({
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
            + 'width:23vw;height:84vh;border:1px solid #f4ffe650;'
            + 'border-radius:14px;background:#12171fd9;pointer-events:none;z-index:3';
        document.body.appendChild(overlay);
    }
    const knob = (key) => (params.has(key) && Number.isFinite(Number(params.get(key)))
        ? Number(params.get(key)) : null);
    const aim = () => {
        if (!world) return;
        world.prepareCamera(camera.aspect);
        // ?icon=1 is the theme icon's lens: from where the game looks, a long lens on the kites
        // over the valley under the old oak's leaves, without the swing's ropes across them (the
        // centre square of a 16:9 capture is the icon). Fly the kites with
        // ?event=double&kites=7&eventAge=2.6&t=16.
        const icon = params.get('icon') === '1';
        if (icon) {
            camera.lookAt(-23, 67.5, -75);
            camera.fov = 17;
        }
        // ?eye=x,y,z ?look=x,y,z ?fov= move the lens for a closer look at one part of the world.
        const read = (key) => (params.get(key) || '').split(',').map(Number);
        const eye = read('eye');
        const look = read('look');
        if (eye.length === 3 && eye.every(Number.isFinite)) camera.position.set(...eye);
        if (look.length === 3 && look.every(Number.isFinite)) camera.lookAt(...look);
        if (knob('fov') > 1) camera.fov = knob('fov');
        camera.updateProjectionMatrix();
        world.stage.refresh();
        // ?hide=Grass,Flower hides every object whose name contains one of the words.
        const hidden = (params.get('hide') || '').split(',').filter(Boolean);
        if (icon) hidden.push('swing');
        if (hidden.length) {
            world.group.traverse((object) => {
                if (hidden.some((word) => object.name.includes(word))) object.visible = false;
            });
        }
        // Tuning knobs: ?exposure= ?haze= ?cover= (share of the sky under cloud) ?clouds=x,y
        // (where the cloud field stands, in tiles).
        const { light } = world;
        if (knob('haze') !== null) light.uHaze.value = knob('haze');
        if (knob('cover') !== null) light.uCloudCover.value = knob('cover');
        // ?sky=sigma,veil,shade,soft,carve tunes the cumulus (blank entries keep their values).
        const sky = (params.get('sky') || '').split(',');
        const dials = [world.sky.uSigma, world.sky.uVeil, world.sky.uShade, light.uCloudSoft, light.uCloudCarve];
        dials.forEach((node, i) => {
            if (sky[i] !== undefined && sky[i] !== '' && Number.isFinite(Number(sky[i]))) node.value = Number(sky[i]);
        });
        if (post && knob('exposure') !== null) post.exposure = knob('exposure');
    };
    // ?bare=1 skips the asset pack: the land, the sky and the grass alone.
    const load = params.get('bare') === '1' ? Promise.resolve(null) : loadVerdantHillsAssets();
    // Milliseconds each stage of the start took, for the capture's diagnostics.
    const timing = {};
    const started = performance.now();
    const ready = load.then((loaded) => {
        if (disposed) {
            disposeVerdantHillsAssets(loaded);
            return;
        }
        assets = loaded;
        timing.assets = Math.round(performance.now() - started);
        const built = performance.now();
        world = new VerdantHillsWorld({
            scene, camera, quality, rng, assets,
        }).build();
        timing.world = Math.round(performance.now() - built);
        aim();
        post = new VerdantHillsPost({
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
    // ?event=lock|drop|clear|double|triple|quad|combo|streak|spin|perfect|level|over|festival,
    // placed with ?col=0..9 and ?row=0..19 (0 is the top visible row); ?piece=I|O|T|S|Z|J|L.
    let locks = 0;
    const fire = (event) => {
        const column = Number(params.get('col') ?? 1);
        const row = Number(params.get('row') ?? 15) + 4;
        const letter = (params.get('piece') || 'T').toUpperCase();
        const pieceOf = (shapeKey) => ({
            shapeKey, x: column, y: row, shape: SHAPES[shapeKey] || SHAPES.T,
        });
        const piece = pieceOf(SHAPES[letter] ? letter : 'T');
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
                reactions.onPieceLock({ piece: pieceOf(BAG[(locks + i) % BAG.length]) });
                reactions.onLineClear(1, { clearedRows: [row + 1] });
            }
            locks += Number(params.get('combo') || 5);
        } else if (event === 'festival') {
            // Lock one of each kind: the seventh kite completes the festival.
            BAG.forEach((shapeKey) => reactions.onPieceLock({ piece: pieceOf(shapeKey) }));
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
        world.rewind();
        // ?clouds=x,y places the cloud field (in tiles) before the replay lets it drift.
        const clouds = (params.get('clouds') || '').split(',').map(Number);
        if (clouds.length === 2 && clouds.every(Number.isFinite)) world.light.uCloudOffset.value.set(...clouds);
        randomIndex = 0;
        locks = 0;
        // ?kites=n puts n kites in the air before the capture's own event.
        const kites = Math.max(0, Math.min(7, Number(params.get('kites') || 0)));
        const age = Number(params.get('eventAge') ?? 0.35);
        const eventTime = Math.max(0, target - (Number.isFinite(age) ? Math.max(0, age) : 0.35));
        // ?hold=1 keeps a combo alive by repeating the event every second up to the capture.
        const hold = params.get('hold') === '1';
        const steps = Math.max(1, Math.ceil(target * 60));
        const dt = target / steps;
        let next = eventTime;
        let early = kites > 0 ? Math.max(0, eventTime - 5) : null;
        for (let i = 1; i <= steps; i += 1) {
            if (early !== null && i * dt >= early) {
                for (let n = 0; n < kites; n += 1) {
                    reactions.onPieceLock({
                        piece: {
                            shapeKey: BAG[n], x: 4, y: 20, shape: SHAPES[BAG[n]],
                        },
                    });
                }
                early = null;
            }
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
            if (post) post.render();
        },
        async renderAsync() {
            await ready;
            if (disposed || !post) return;
            const sought0 = performance.now();
            if (pendingSeek !== null) seek(pendingSeek);
            else update(0, 0);
            timing.seek = Math.round(performance.now() - sought0);
            // A few frames let async pipelines land and the static shadow map settle.
            const first = performance.now();
            if (pendingSeek === null) timing.seek = 0;
            for (let i = 0; i < 4; i += 1) {
                post.render();
                if (i === 0) timing.firstFrame = Math.round(performance.now() - first);
            }
            timing.frames = Math.round(performance.now() - first);
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
                timing,
            };
        },
        dispose() {
            disposed = true;
            overlay?.remove();
            post?.dispose();
            reactions.dispose();
            world?.dispose();
            disposeVerdantHillsAssets(assets);
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

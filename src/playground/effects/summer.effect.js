import * as THREE from 'three/webgpu';
import { disposeSummerAssets, loadSummerAssets } from '../../themes/summer/summer-assets.js';
import { SummerWorld } from '../../themes/summer/summer-world.js';
import { summerHourForLevel } from '../../themes/summer/summer-hours.js';
import { SummerReactions } from '../../themes/summer/summer-reactions.js';
import { SummerPost } from '../../themes/summer/summer-post.js';
import { seededRandom } from '../../utils/helpers.js';

export const meta = {
    id: 'summer',
    title: 'Summer — Midsummer\'s Eve by the lake',
    description: 'A flowering meadow, a maypole, a red cottage across a mirror lake and a sun that will not set.',
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
    // The theme's own generator and default seed, so a capture shows the meadow the game grows.
    const rawSeed = Number(params.get('seed') ?? 624);
    const rng = seededRandom(Number.isFinite(rawSeed) ? rawSeed : 624);
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
    const reactions = new SummerReactions({
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
            + 'width:23vw;height:84vh;border:1px solid #fff4d650;'
            + 'border-radius:14px;background:#12171fd9;pointer-events:none;z-index:3';
        document.body.appendChild(overlay);
    }
    const knob = (key) => (params.has(key) && Number.isFinite(Number(params.get(key)))
        ? Number(params.get(key)) : null);
    // ?hour=0..5 holds the night at one phase (0 evening, 1 rose hour, 2 white night, 3 dawn,
    // 4 morning); ?level=n starts at that level's hour instead, with the night still moving.
    if (knob('hour') !== null) reactions.pinHour(knob('hour'));
    const startLevel = () => {
        const level = knob('level');
        if (level !== null && reactions.setLevel(level)) reactions.hourTurn = summerHourForLevel(level);
    };
    startLevel();
    const aim = () => {
        if (!world) return;
        world.prepareCamera(camera.aspect);
        // ?icon=1 is the theme icon's lens: the maypole against the lake with the sun standing
        // in its wreath, from closer in along the same line of sight the game looks down (the
        // centre square of a 16:9 capture is the icon).
        if (params.get('icon') === '1') {
            const [, wreath] = world.homestead.bouquetAnchors().wreaths;
            const pole = world.homestead.places.maypole;
            camera.position.copy(wreath).addScaledVector(world.light.uSunDir.value, -9.5);
            if (pole) camera.lookAt(pole.x + 0.6, pole.y + 4.5, pole.z);
            camera.fov = 44;
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
        if (hidden.length) {
            world.group.traverse((object) => {
                if (hidden.some((word) => object.name.includes(word))) object.visible = false;
            });
        }
        // Tuning knobs: ?exposure= ?haze= ?rays= (shaft density) ?raymax=.
        if (knob('haze') !== null) world.light.hazeOverride = knob('haze');
        if (post) {
            if (knob('exposure') !== null) post.exposure = knob('exposure');
            if (post.godraysNode) {
                if (knob('rays') !== null) post.godraysNode.density.value = knob('rays');
                if (knob('raymax') !== null) post.godraysNode.maxDensity.value = knob('raymax');
            }
        }
    };
    const ready = loadSummerAssets().then((loaded) => {
        if (disposed) {
            disposeSummerAssets(loaded);
            return;
        }
        assets = loaded;
        world = new SummerWorld({
            scene, camera, quality, rng, assets,
        }).build();
        aim();
        post = new SummerPost({
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
    // ?event=lock|drop|clear|double|triple|quad|combo|streak|spin|perfect|level|over|bouquet,
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
        } else if (event === 'bouquet') {
            // Lock one of each kind: the seventh completes the bouquet.
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
        startLevel();
        world.resetEffects();
        randomIndex = 0;
        locks = 0;
        // ?picked=n pre-picks n kinds for the bouquet before the capture's own event.
        const picked = Math.max(0, Math.min(6, Number(params.get('picked') || 0)));
        const age = Number(params.get('eventAge') ?? 0.35);
        const eventTime = Math.max(0, target - (Number.isFinite(age) ? Math.max(0, age) : 0.35));
        // ?hold=1 keeps a combo alive by repeating the event every second up to the capture.
        const hold = params.get('hold') === '1';
        const steps = Math.max(1, Math.ceil(target * 60));
        const dt = target / steps;
        let next = eventTime;
        let early = picked > 0 ? Math.max(0, eventTime - 6) : null;
        for (let i = 1; i <= steps; i += 1) {
            if (early !== null && i * dt >= early) {
                for (let n = 0; n < picked; n += 1) {
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
                level: reactions.level,
                hour: Math.round(reactions.getFrame().hour * 1000) / 1000,
            };
        },
        dispose() {
            disposed = true;
            overlay?.remove();
            post?.dispose();
            reactions.dispose();
            world?.dispose();
            disposeSummerAssets(assets);
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

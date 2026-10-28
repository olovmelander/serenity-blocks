import * as THREE from 'three/webgpu';
import { sceneSamples } from '../../themes/shared/scene-antialias.js';
import { loadGoldenForestAssets, disposeGoldenForestAssets } from '../../themes/golden-forest/golden-forest-assets.js';
import { GoldenForestWorld } from '../../themes/golden-forest/golden-forest-world.js';
import { GoldenForestReactions } from '../../themes/golden-forest/golden-forest-reactions.js';
import { GoldenForestPost } from '../../themes/golden-forest/golden-forest-post.js';
import { seededRandom } from '../../utils/helpers.js';

export const meta = {
    id: 'golden-forest',
    title: 'Golden Forest — the lake at the golden hour',
    description: 'Blender-grown spruce and pine around a mirror lake: a low sun, shafts, fireflies and rings.',
};

export function create({
    scene, camera, renderer, params,
}) {
    // The theme's own generator and default seed, so a capture shows the forest the game grows.
    const rawSeed = Number(params.get('seed') ?? 271);
    const rng = seededRandom(Number.isFinite(rawSeed) ? rawSeed : 271);
    const saved = {
        fov: camera.fov,
        near: camera.near,
        far: camera.far,
        tone: renderer.toneMapping,
        exposure: renderer.toneMappingExposure,
        shadows: renderer.shadowMap.enabled,
    };
    const quality = params.get('quality') || 'High';
    // ?level=<n> sets the level the lake stands on: every level is one hour on (golden hour, ember
    // sunset, alpenglow, white night, morning gold, and round again). The clock turns the hours
    // too, so ?t= past 42 s shows one melting into the next (golden-forest-moods.js).
    const rawLevel = Number(params.get('level') ?? 1);
    const level = Number.isFinite(rawLevel) ? Math.max(1, Math.round(rawLevel)) : 1;
    // ?msaa=<n> overrides the scene pass's samples (the theme's own: 4 from High up, else 0 + FXAA).
    const samples = params.has('msaa')
        ? Math.max(0, Math.round(Number(params.get('msaa')) || 0)) : sceneSamples(quality);
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
    const reactions = new GoldenForestReactions({
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
            + 'width:23vw;height:84vh;border:1px solid #fed39650;'
            + 'border-radius:14px;background:#12171fd9;pointer-events:none;z-index:3';
        document.body.appendChild(overlay);
    }
    // ?icon=1 is the theme icon's lens: a long look at the sun on the treetops, the islet
    // and the sun's path on the water (the centre square of a 16:9 capture is the icon).
    const aim = () => {
        if (!world) return;
        world.prepareCamera(camera.aspect);
        if (params.get('icon') === '1') {
            camera.fov = 27;
            camera.lookAt(-23.4, 5.6, -46);
            camera.updateProjectionMatrix();
            world.stage.refresh();
            // At 80 px an icon needs deep silhouettes: thinner air and a darker print.
            world.light.uHaze.value = 0.0014;
            world.light.hazePin = 0.0014;
            if (post) {
                post.exposure = 0.74;
                post.godraysDensity = 0.09;
                if (post.godraysNode) post.godraysNode.density.value = 0.09;
            }
        }
    };
    const ready = loadGoldenForestAssets().then((loaded) => {
        if (disposed) {
            disposeGoldenForestAssets(loaded);
            return;
        }
        assets = loaded;
        world = new GoldenForestWorld({
            scene, camera, quality, rng, assets, samples,
        }).build();
        world.setLevel(level, { silent: true });
        aim();
        post = new GoldenForestPost({
            renderer, scene, camera, quality, light: world.light, samples,
        });
        post.setSize(window.innerWidth, window.innerHeight);
        aim();
    });
    // ?crane=k:12 (kettle bird 12) or s:0 (the skein's leader): a long lens from the eye kept on
    // that crane (?craneFov=<deg>, default 3). ?craneCam=k:12,<metres>,<deg round from its heading
    // toward its left>,<deg up>,<fov>: fly beside it. The birds are sized from the camera, so both
    // show real-size cranes.
    const craneParams = () => {
        const look = params.get('crane');
        const cam = params.get('craneCam');
        const spec = (cam || look || '').split(',');
        const [kind, index] = (spec[0] || '').split(':');
        if (!kind) return null;
        return {
            kettle: kind !== 's',
            index: Math.max(0, Math.round(Number(index) || 0)),
            cam: Boolean(cam),
            dist: Number(spec[1] ?? 9),
            round: THREE.MathUtils.degToRad(Number(spec[2] ?? 90)),
            up: THREE.MathUtils.degToRad(Number(spec[3] ?? -10)),
            fov: Number(cam ? spec[4] ?? 40 : params.get('craneFov') ?? 3),
        };
    };
    const craneLens = craneParams();
    const lens = (time) => {
        const sky = world?.birds?.sky;
        if (!craneLens || !sky) return;
        const startle = world.birds.uStartle.value;
        const at = (t) => sky.at(craneLens.kettle, craneLens.index, t, startle, [0, 0, 0]);
        const p = at(time);
        const q = at(time + 0.1);
        if (!p || !q) return;
        if (craneLens.cam) {
            const heading = Math.atan2(q[0] - p[0], q[2] - p[2]) + craneLens.round;
            const flat = Math.cos(craneLens.up) * craneLens.dist;
            const rise = Math.sin(craneLens.up) * craneLens.dist;
            camera.position.set(p[0] + Math.sin(heading) * flat, p[1] + rise, p[2] + Math.cos(heading) * flat);
        } else {
            world.prepareCamera(camera.aspect);
        }
        camera.fov = craneLens.fov;
        camera.lookAt(p[0], p[1], p[2]);
        camera.updateProjectionMatrix();
    };
    const update = (time, dt) => {
        lens(time);
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
        else if (event === 'level') {
            // As the theme does: the flourish, and the lake one hour on.
            reactions.onLevelUp();
            world?.setLevel(world.level + 1);
        } else if (event === 'over') reactions.onGameOver();
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
        // The replay begins on the level asked for; the clock turns the hour from there.
        world.setLevel(level, { silent: true });
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
            };
        },
        dispose() {
            disposed = true;
            overlay?.remove();
            post?.dispose();
            reactions.dispose();
            world?.dispose();
            disposeGoldenForestAssets(assets);
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

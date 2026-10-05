import * as THREE from 'three/webgpu';
import { disposeCrystalCaveAssets, loadCrystalCaveAssets } from '../../themes/crystal-cave/crystal-cave-assets.js';
import { CrystalCavePost } from '../../themes/crystal-cave/crystal-cave-post.js';
import { CrystalCaveReactions } from '../../themes/crystal-cave/crystal-cave-reactions.js';
import { CrystalCaveWorld } from '../../themes/crystal-cave/crystal-cave-world.js';

export const meta = {
    id: 'crystal-cave',
    title: 'Crystal Cave — the resonant hall',
    description: 'Traced crystals on baked rock; locks charge them, clears send a wave, chains link a lattice.',
};

const PIECES = ['T', 'O', 'Z', 'S', 'I', 'L', 'J'];
const VIEWS = {
    left: { fov: 30, eye: [-6, 3, 26], target: [-16, 2, -5] },
    right: { fov: 30, eye: [6, 3, 26], target: [17, 1, -8] },
    hall: { fov: 70, eye: [-4, 16, 8], target: [4, 2, -70] },
    deep: { fov: 50, eye: [0, 3, -20], target: [2, 4, -90] },
    icon: { fov: 37, eye: [0.5, 2.6, 6], target: [2, 5.2, -80] },
};

/**
 * Reproducible stills: `&t=12&event=lock|drop|clear|double|triple|quad|combo|spin|perfect|level|over`
 * with `&eventAge=<s>`, `&col=0..9&row=0..19`, `&piece=T`, `&combo=<n>`, `&board=1`, `&view=left|right|hall|deep`.
 */
export function create({
    scene, camera, renderer, params,
}) {
    const saved = {
        tone: renderer.toneMapping,
        exposure: renderer.toneMappingExposure,
        background: scene.background,
        fov: camera.fov,
        near: camera.near,
        far: camera.far,
    };
    const quality = params.get('quality') || 'High';
    scene.background = new THREE.Color(0x020308);
    let disposed = false;
    let assets = null;
    let world = null;
    let post = null;
    let overlay = null;
    let pendingSeek = null;
    let sought = null;
    let randomState = 1;
    const reactions = new CrystalCaveReactions({
        rng: () => {
            randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
            return randomState / 4294967296;
        },
    });
    if (params.get('board') === '1') {
        overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;left:50%;top:51%;transform:translate(-50%,-50%);'
            + 'width:23vw;height:84vh;border:1px solid #9be7ee40;'
            + 'border-radius:14px;background:#081220e0;pointer-events:none;z-index:3';
        document.body.appendChild(overlay);
    }
    // `&eye=x,y,z&aim=x,y,z&fov=n` frames a one-off lens without touching the table above.
    const triple = (name) => (params.get(name) || '').split(',').map(Number);
    const custom = params.has('eye') && params.has('aim') && [...triple('eye'), ...triple('aim')].every(Number.isFinite)
        ? { fov: Number(params.get('fov')) || 40, eye: triple('eye'), target: triple('aim') } : null;
    const view = custom || VIEWS[params.get('view')] || null;
    const applyView = () => {
        if (!view) return;
        camera.fov = view.fov;
        camera.position.set(...view.eye);
        camera.lookAt(...view.target);
        camera.updateProjectionMatrix();
    };

    const ready = loadCrystalCaveAssets().then((loaded) => {
        if (disposed) {
            disposeCrystalCaveAssets(loaded);
            return;
        }
        assets = loaded;
        world = new CrystalCaveWorld({
            scene, camera, assets, quality,
        });
        post = new CrystalCavePost({
            renderer, scene, camera, quality,
        });
        post.setSize(window.innerWidth, window.innerHeight);
        window.__CRYSTAL_CAVE_ART__ = { world, post, reactions };
    });

    const place = () => {
        const column = Number(params.get('col') ?? 2);
        const row = Number(params.get('row') ?? 15);
        const type = (params.get('piece') || 'T').toUpperCase();
        return {
            piece: {
                type, x: column, y: row + 4, shape: [[1, 1, 1], [0, 1, 0]],
            },
        };
    };
    const fire = (event) => {
        if (!event) return;
        const detail = place();
        const rows = (count) => ({
            lineCount: count,
            clearedRows: Array.from({ length: count }, (_, index) => Number(params.get('row') ?? 15) + 4 + index),
        });
        if (event === 'lock') reactions.onPieceLock(detail);
        if (event === 'drop') {
            reactions.onHardDrop({ distance: 17 });
            reactions.onPieceLock(detail);
        }
        if (event === 'clear') reactions.onLineClear(rows(1));
        if (event === 'double') reactions.onLineClear(rows(2));
        if (event === 'triple') reactions.onLineClear(rows(3));
        if (event === 'quad') reactions.onLineClear(rows(4));
        if (event === 'combo') {
            const count = Math.max(2, Number(params.get('combo') || 6));
            for (let step = 2; step <= count; step += 1) {
                reactions.onPieceLock({ piece: { ...detail.piece, type: PIECES[step % PIECES.length], x: (step * 3) % 9 } });
                reactions.onLineClear(rows(1 + (step % 2)));
                reactions.onCombo(step);
            }
        }
        if (event === 'spin') reactions.onTSpin(detail);
        if (event === 'perfect') reactions.onPerfectClear();
        if (event === 'level') reactions.onLevelUp();
        if (event === 'over') reactions.onGameOver();
    };
    const step = (time, dt) => {
        reactions.update(dt);
        world.update(time, dt, reactions);
        applyView();
        post.update(reactions.getFrame());
    };
    const seek = (time) => {
        if (!Number.isFinite(time)) return;
        if (!world) {
            pendingSeek = time;
            return;
        }
        if (time === sought) return;
        const target = Math.max(0, time);
        randomState = 1;
        reactions.reset();
        world.reset();
        const ageValue = Number(params.get('eventAge') ?? 0.4);
        const eventTime = Math.max(0, target - (Number.isFinite(ageValue) ? Math.max(0, ageValue) : 0.4));
        // Play a short game before the event so the shore has something growing on it.
        const prelude = Number(params.get('grown') ?? 0);
        const steps = Math.max(1, Math.ceil(target * 60));
        const dt = target / steps;
        let fired = false;
        let grown = 0;
        for (let index = 1; index <= steps; index += 1) {
            const now = index * dt;
            if (grown < prelude && now >= 0.5 + grown * 0.4 && now < eventTime - 2.5) {
                grown += 1;
                reactions.onLineClear({ lineCount: 1 });
                reactions.onPieceLock({});
                reactions.onPieceLock({});
            }
            if (!fired && now >= eventTime) {
                fired = true;
                fire(params.get('event'));
            }
            step(now, dt);
        }
        sought = time;
    };
    return {
        cameraRadius: 1,
        camera() {},
        seek,
        update(time, dt) {
            if (world && !params.has('t')) step(time, Math.max(0, Math.min(0.05, dt)));
        },
        render() {
            if (post) post.render();
        },
        async renderAsync() {
            await ready;
            if (disposed || !post) return;
            if (pendingSeek !== null) seek(pendingSeek);
            else step(0, 0);
            // A few frames let async pipelines land before the still is taken.
            for (let i = 0; i < 4; i += 1) post.render();
        },
        resize(width, height) {
            world?.prepareCamera(width / height);
            applyView();
            post?.setSize(width, height);
        },
        getDiagnostics() {
            return {
                ready: Boolean(world),
                ...(world?.getDiagnostics() || {}),
                ...(post?.getDiagnostics() || {}),
            };
        },
        dispose() {
            disposed = true;
            overlay?.remove();
            post?.dispose();
            reactions.dispose();
            world?.dispose();
            disposeCrystalCaveAssets(assets);
            camera.fov = saved.fov;
            camera.near = saved.near;
            camera.far = saved.far;
            camera.updateProjectionMatrix();
            renderer.toneMapping = saved.tone;
            renderer.toneMappingExposure = saved.exposure;
            scene.background = saved.background;
            delete window.__CRYSTAL_CAVE_ART__;
        },
    };
}

import * as THREE from 'three/webgpu';
import { CrystalCaveAtmosphere } from '../../themes/crystal-cave/crystal-cave-atmosphere.js';
import { CrystalCavePost } from '../../themes/crystal-cave/crystal-cave-post.js';
import { CrystalCaveReactions } from '../../themes/crystal-cave/crystal-cave-reactions.js';

export const meta = {
    id: 'crystal-cave',
    title: 'Crystal Cave — the resonant grotto',
    description: 'Opaline crystals, subterranean mirror water, mineral haze and prismatic resonance.',
};

export function create({
    scene, camera, renderer, params,
}) {
    const saved = { tone: renderer.toneMapping, exposure: renderer.toneMappingExposure, fog: scene.fog };
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    const quality = params.get('quality') || 'High';
    const atmosphere = new CrystalCaveAtmosphere({ scene, camera, quality });
    const reactions = new CrystalCaveReactions({
        scene,
        anchors: atmosphere.anchors,
        quality: atmosphere.quality.preset,
        uniforms: atmosphere.uniforms,
    });
    const post = new CrystalCavePost({
        scene, camera, renderer, quality,
    });
    post.setSize(window.innerWidth, window.innerHeight);
    let board = null;
    if (params.get('board') === '1') {
        board = document.createElement('div');
        board.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(27vw,280px);height:min(73vh,560px);border:1px solid #99dfe744;border-radius:16px;background:#091426eb;pointer-events:none;z-index:3';
        document.body.appendChild(board);
    }
    const update = (time, dt) => {
        reactions.update(dt, time);
        atmosphere.update(time, dt);
        post.update({ energy: atmosphere.uniforms.energy.value, resonance: atmosphere.uniforms.resonance.value });
    };
    let sought = null;
    const seek = (time) => {
        if (!Number.isFinite(time) || time === sought) return;
        sought = Math.max(0, time);
        reactions.reset();
        const ageValue = Number(params.get('eventAge') ?? 0.35);
        const age = Number.isFinite(ageValue) ? Math.max(0, ageValue) : 0.35;
        const eventTime = Math.max(0, sought - age);
        const steps = Math.max(1, Math.ceil(sought * 60));
        const dt = sought / steps;
        let fired = false;
        for (let i = 1; i <= steps; i += 1) {
            const t = dt * i;
            if (!fired && t >= eventTime) {
                fired = true;
                const event = params.get('event');
                if (event === 'lock') reactions.pieceLock();
                if (event === 'tetris' || event === 'clear') reactions.lineClear(event === 'tetris' ? 4 : 1);
                if (event === 'combo') reactions.combo(Number(params.get('combo') || 6));
            }
            update(t, dt);
        }
    };
    window.__CRYSTAL_CAVE_ART__ = { atmosphere, reactions, post };
    return {
        cameraRadius: 1,
        camera() {},
        seek,
        update(time, dt) { if (!params.has('t')) update(time, Math.min(0.05, Math.max(0, dt))); },
        render() { post.render(); },
        resize(width, height) { atmosphere.prepareCamera(width / height); post.setSize(width, height); },
        getDiagnostics() { return { quality, crystalCount: atmosphere.art.crystalCount, ...post.getDiagnostics() }; },
        dispose() {
            reactions.dispose(); post.dispose(); atmosphere.dispose(); board?.remove();
            renderer.toneMapping = saved.tone; renderer.toneMappingExposure = saved.exposure;
            scene.fog = saved.fog;
            delete window.__CRYSTAL_CAVE_ART__;
        },
    };
}

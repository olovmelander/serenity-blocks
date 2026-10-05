/**
 * Breathing worlds in the playground: the shipping host and world modules, driven by a
 * deterministic breath so `?t=` shots are phase-locked.
 *
 * URL parameters (all optional):
 *   world=<technique id>   which world (default deep-relaxation)
 *   breath=0..1            pin the lung fill instead of following the pattern
 *   pattern=5,2,7,2        seconds for inhale, hold, exhale, hold
 *   session=retention      session phase (stillness) to preview
 *   quality=High           render tier
 *   focus=0.14             hero height above screen centre
 *   reduce=1               reduced-motion behaviour
 */
import * as THREE from 'three/webgpu';
import { BreathWorldHost } from '../../ui/effects/breathing/stage/breath-world-host.js';
import { resolveBreath } from '../../ui/effects/breathing/breath-clock.js';

export const meta = {
    id: 'breathing',
    title: 'Breathing worlds',
    description: 'The twelve breathing worlds: ?world=<id>&breath=<0..1>',
};

export function create({
    scene, camera, renderer, params,
}) {
    const host = new BreathWorldHost({
        renderer, scene, camera, quality: params.get('quality') || 'High',
    });
    const number = (key, fallback) => {
        const value = Number(params.get(key) ?? fallback);
        return Number.isFinite(value) ? value : fallback;
    };
    const pattern = (params.get('pattern') || '5,2,7,2').split(',').map(Number);
    let pinned = params.has('breath')
        ? { breath: number('breath', 0.5), phase: number('phase', 0), progress: number('progress', 0.5) } : null;
    host.setReducedMotion(params.get('reduce') === '1');
    host.setSessionPhase(params.get('session'));
    host.setFocus(number('focus', 0.14));
    host.setWorld(params.get('world') || 'deep-relaxation');
    const drawingSize = new THREE.Vector2();
    const sync = () => {
        renderer.getDrawingBufferSize(drawingSize);
        host.setSize(window.innerWidth, window.innerHeight, drawingSize.y || window.innerHeight);
    };
    sync();
    const follow = (time) => host.setBreath(pinned || resolveBreath(pattern, time));
    // Contact sheets switch world and breath in one page; see docs/BREATHING_OVERHAUL_2026-10.md.
    window.__BREATH_LAB__ = {
        setWorld: (id) => host.setWorld(id),
        setBreath: (state) => { pinned = state; },
        setSession: (type) => host.setSessionPhase(type),
        setFocus: (focus) => host.setFocus(focus),
        host,
    };
    return {
        camera() { /* the host owns the lens */ },
        update(time, dt) {
            follow(time);
            host.step(dt);
        },
        seek(time) {
            follow(time);
            host.seek(time);
        },
        render() { host.render(); },
        resize() { sync(); },
        getDiagnostics: () => host.getDiagnostics(),
        dispose() {
            delete window.__BREATH_LAB__;
            host.dispose();
        },
    };
}

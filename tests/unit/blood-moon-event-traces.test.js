import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createEventTraces } from '../../src/playground/effects/blood-moon-event-traces.js';
import { create } from '../../src/playground/effects/blood-moon.effect.js';

describe('Blood Moon event filaments', () => {
    const layout = { horizon: 0.34 };
    const waterSite = { x: 0.18, y: 0.13 };
    let traces;
    const fire = (kind, payload = {}) => {
        traces.cue(kind, payload, layout, waterSite);
        traces.update(0, 1);
    };
    beforeEach(() => {
        traces = createEventTraces({
            aspect: uniform(1.6),
            viewport: uniform(new THREE.Vector2(1280, 800)),
            center: uniform(new THREE.Vector2(0.21, 0.72)),
            radius: uniform(0.16),
            shadow: uniform(new THREE.Vector2(0.6, -0.62)),
            volcanoAz: uniform(0.3),
            volcanoHeight: uniform(0.08),
            camRight: uniform(new THREE.Vector3(1, 0, 0)),
            camUp: uniform(new THREE.Vector3(0, 1, 0)),
            camFwd: uniform(new THREE.Vector3(0, 0, -1)),
            tanHalf: uniform(new THREE.Vector2(0.7, 0.45)),
        }, { sparks: 180 });
    });
    afterEach(() => {
        traces.object.material.dispose();
        traces.object.geometry.dispose();
    });

    it('gives every event a finite, distinct path and releases its draw after cooling', () => {
        const forms = [
            ['lock'], ['hardDrop'], ['clear', { lines: 1 }], ['clear', { lines: 2 }], ['clear', { lines: 3 }],
            ['combo', { comboCount: 5 }], ['quad'], ['twist'], ['levelUp'], ['b2b'], ['perfectClear'],
            ['garbage', { linesInserted: 3 }], ['counter', { linesCanceled: 3 }], ['gameOver'],
        ];
        const silhouettes = new Set();
        for (const [kind, payload] of forms) {
            traces.reset();
            fire(kind, payload);
            const { geometry } = traces.object;
            const positions = geometry.getAttribute('aTraceStart');
            expect(traces.object.visible).toBe(true);
            expect(geometry.instanceCount).toBeGreaterThan(0);
            const coordinates = [];
            for (let i = 0; i < geometry.instanceCount; i++) {
                coordinates.push(positions.getX(i), positions.getY(i), positions.getZ(i), positions.getW(i));
            }
            expect(coordinates.every(Number.isFinite)).toBe(true);
            silhouettes.add(coordinates.join(','));
            traces.update(5, 1);
            expect(geometry.instanceCount).toBe(0);
            expect(traces.object.visible).toBe(false);
        }
        expect(silhouettes.size).toBe(forms.length);
    });

    it('reserves the pearl rays on a saturated Minimal pool during a flurry of drops', () => {
        for (let i = 0; i < 12; i++) fire('hardDrop');
        expect(traces.count).toBe(36);
        fire('perfectClear');
        for (let i = 0; i < 16; i++) fire('hardDrop');
        expect(traces.count).toBe(36);
        traces.update(1.2, 1);
        expect(traces.count).toBe(19);
    });
});

it('replays the same water impact after another seek and clears it when motion is reduced', () => {
    vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(() => new THREE.Texture());
    vi.spyOn(THREE.ImageLoader.prototype, 'load').mockImplementation(() => {});
    vi.stubGlobal('window', {
        innerWidth: 1280, innerHeight: 800, addEventListener() {}, removeEventListener() {},
    });
    const scene = new THREE.Scene();
    const runtime = create({
        scene,
        camera: new THREE.PerspectiveCamera(),
        renderer: { toneMappingExposure: 1, toneMapping: THREE.NoToneMapping },
        params: new URLSearchParams('quality=Minimal&event=single&eventAge=.45&seed=52'),
        sizes: { width: 1280, height: 800 },
    });
    try {
        const { geometry } = scene.getObjectByName('blood-moon-event-filaments');
        const firstRow = () => Array.from(geometry.getAttribute('aTraceStart').data.array.slice(0, 16));
        runtime.seek(8);
        const before = firstRow();
        runtime.seek(60);
        runtime.seek(8);
        expect(firstRow()).toEqual(before);
        expect(geometry.instanceCount).toBe(2);
        runtime.setReducedMotion(true);
        runtime.seek(8);
        expect(geometry.instanceCount).toBe(0);
        expect(runtime.getDiagnostics().ripples).toBe(0);
    } finally {
        runtime.dispose();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    }
});

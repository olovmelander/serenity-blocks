import { existsSync } from 'node:fs';
import path from 'node:path';
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { BREATH_WORLDS } from '../../src/ui/effects/breathing/breath-catalogue.js';
import { BREATH_WORLD_BUILDERS } from '../../src/ui/effects/breathing/worlds/index.js';
import { BREATH_QUALITY, BreathWorldHost } from '../../src/ui/effects/breathing/stage/breath-world-host.js';
import { SESSION_WORLDS } from '../../src/ui/effects/breathwork-session-manager.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

/** The lightest tier draws without a post pipeline, so a stub renderer is enough to mount a world. */
function createHost(quality = 'Minimal') {
    const renderer = { render: vi.fn(), toneMapping: 0, toneMappingExposure: 1 };
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(20, 1, 0.1, 60);
    return {
        host: new BreathWorldHost({
            renderer, scene, camera, quality,
        }),
        renderer,
        scene,
        camera,
    };
}

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    vi.restoreAllMocks();
});

describe('breathing world registry', () => {
    it('has exactly one world, with artwork, for every catalogue id', () => {
        expect(Object.keys(BREATH_WORLD_BUILDERS).sort()).toEqual(BREATH_WORLDS.map((world) => world.id).sort());
        BREATH_WORLDS.forEach((world) => {
            expect(typeof BREATH_WORLD_BUILDERS[world.id]).toBe('function');
            expect(existsSync(path.join(ROOT, 'public', 'assets', 'breathing', `${world.id}.webp`)), `${world.id} poster`).toBe(true);
        });
    });

    it('sets every stage of every Hale session in a world that exists', () => {
        Object.entries(SESSION_WORLDS).forEach(([session, stages]) => {
            ['grounding', 'active', 'retention', 'recovery', 'integration'].forEach((stage) => {
                [stages[stage]].flat().forEach((id) => {
                    expect(BREATH_WORLD_BUILDERS[id], `${session}.${stage} → ${id}`).toBeTypeOf('function');
                });
            });
        });
    });
});

describe('breathing world host', () => {
    it.each(BREATH_WORLDS.map((world) => world.id))('builds and disposes %s', (id) => {
        const { host, scene, renderer, camera } = createHost();
        expect(host.setWorld(id)).toBe(id);
        const backdrop = host.root.children[0];
        expect(backdrop.material.colorNode).toBeTruthy();
        expect(backdrop.material.depthWrite).toBe(false);
        expect(backdrop.renderOrder).toBe(-1000);
        // Petals, shards and solids share geometry: spy on each distinct one once.
        const geometries = new Set();
        host.root.traverse((node) => { if (node.geometry) geometries.add(node.geometry); });
        const disposals = [...geometries].map((geometry) => vi.spyOn(geometry, 'dispose'));
        // One frame's worth of CPU work must run without a GPU.
        host.setSize(1280, 720);
        host.setBreath({ breath: 0.6, phase: 0, progress: 0.4 });
        host.step(1 / 60);
        host.render();
        expect(renderer.render).toHaveBeenCalledWith(scene, camera);
        host.dispose();
        expect(host.root.children).toHaveLength(0);
        expect(scene.children).not.toContain(host.root);
        expect(disposals.length).toBeGreaterThan(0);
        disposals.forEach((spy) => expect(spy).toHaveBeenCalled());
    });

    it('swaps worlds in place and falls back to the default for an unknown id', () => {
        const { host } = createHost();
        host.setWorld('coherence');
        const lotus = [...host.root.children];
        expect(host.setWorld('zen-garden')).toBe('zen-garden');
        lotus.forEach((object) => expect(host.root.children).not.toContain(object));
        expect(host.setWorld('zen-garden')).toBe('zen-garden');
        expect(host.setWorld('not-a-world')).toBe('deep-relaxation');
        host.dispose();
    });

    it('maps the z = 0 plane onto hero space at any aspect, with the hero above centre', () => {
        const { host, camera } = createHost();
        host.setFocus(0.2);
        host.setSize(1600, 900);
        expect(host.uniforms.ext.value.x).toBeCloseTo(16 / 9, 6);
        expect(host.uniforms.ext.value.y).toBe(1);
        expect(camera.position.y).toBeCloseTo(-0.2, 6);
        // Half the visible height at z = 0 equals the vertical extent.
        const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
        expect(halfHeight).toBeCloseTo(1, 6);
        host.setSize(390, 844);
        expect(host.uniforms.ext.value.x).toBe(1);
        expect(host.uniforms.ext.value.y).toBeCloseTo(844 / 390, 6);
        expect(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z).toBeCloseTo(844 / 390, 6);
        expect(camera.aspect).toBeCloseTo(390 / 844, 6);
        host.dispose();
    });

    it('freezes ambient time under reduced motion and slows it while a session holds still', () => {
        const { host } = createHost();
        host.setWorld('deep-relaxation');
        host.setBreath({ breath: 1 });
        host.step(1);
        expect(host.time).toBeCloseTo(1, 6);
        expect(host.breathIntegral).toBeCloseTo(1, 6);
        host.setReducedMotion(true);
        host.step(1);
        expect(host.time).toBeCloseTo(1, 6);
        host.setReducedMotion(false);
        host.setSessionPhase('retention');
        for (let i = 0; i < 600; i++) host.step(0.1);
        const before = host.time;
        host.step(1);
        expect(host.time - before).toBeCloseTo(0.3, 2);
        host.seek(12);
        expect(host.uniforms.time.value).toBe(12);
        host.dispose();
    });

    it('offers the same tier names as the game\'s effect quality setting', () => {
        expect(Object.keys(BREATH_QUALITY)).toEqual(['Extreme', 'Ultra', 'High', 'Medium', 'Low', 'Minimal']);
        // Phones run Low: a light post pipeline (quarter-resolution bloom and shafts) keeps the glow.
        expect(BREATH_QUALITY.Low.bloom).toBeGreaterThan(0);
        expect(BREATH_QUALITY.Low.shaftScale).toBeLessThanOrEqual(0.25);
        // Minimal skips the post chain entirely rather than paying for a zeroed one.
        expect(BREATH_QUALITY.Minimal.bloom).toBe(0);
        expect(BREATH_QUALITY.Minimal.shafts).toBe(0);
        expect(createHost('Minimal').host.pipeline).toBeNull();
        // Every tier draws the same artwork: only cost knobs differ.
        Object.values(BREATH_QUALITY).forEach((tier) => {
            expect(tier.detail).toBeGreaterThan(0);
            expect(tier.detail).toBeLessThanOrEqual(1);
        });
    });

    it('leans the camera in with the breath and keeps painted layers in step with meshes', () => {
        const { host, camera } = createHost();
        host.setWorld('deep-relaxation');
        host.setFocus(0.14);
        host.setSize(1600, 900);
        host.setBreath({ breath: 1, phase: 1, progress: 0.5 });
        host.seek(0);
        const zoom = host.uniforms.zoom.value;
        expect(zoom).toBeGreaterThan(1);
        expect(zoom).toBeLessThan(1.1);
        // The z = 0 plane must show hero point P at screen point (P - pan) * zoom.
        const pan = host.uniforms.pan.value;
        const point = new THREE.Vector3(0.4, 0.25, 0).project(camera);
        const ext = host.uniforms.ext.value;
        expect(point.x * ext.x).toBeCloseTo((0.4 - pan.x) * zoom, 5);
        expect(point.y * ext.y - 0.14).toBeCloseTo((0.25 - pan.y) * zoom, 5);
        // Reduced motion holds the lens still whatever the breath does.
        host.setReducedMotion(true);
        host.step(1 / 60);
        expect(host.uniforms.zoom.value).toBe(1);
        expect(host.uniforms.pan.value.length()).toBe(0);
        host.dispose();
    });
});

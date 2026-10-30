import { existsSync } from 'node:fs';
import path from 'node:path';
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { BREATH_WORLDS } from '../../src/ui/effects/breathing/breath-catalogue.js';
import { BREATH_WORLD_BUILDERS, BREATH_WORLD_MOODS } from '../../src/ui/effects/breathing/worlds/index.js';
import { BREATH_QUALITY, BreathWorldHost } from '../../src/ui/effects/breathing/stage/breath-world-host.js';
import { BreathworkSessionManager, SESSION_WORLDS } from '../../src/ui/effects/breathwork-session-manager.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

/** The lightest tier draws without a post pipeline, so a stub renderer is enough to mount a world. */
function createHost(quality = 'Minimal', pickMood = () => 0) {
    const renderer = { render: vi.fn(), toneMapping: 0, toneMappingExposure: 1 };
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(20, 1, 0.1, 60);
    return {
        host: new BreathWorldHost({
            renderer, scene, camera, quality, pickMood,
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
        // The manager makes its audio elements as it is built; only its session data is read here.
        vi.stubGlobal('Audio', class {
            pause() {}

            load() {}
        });
        const { SESSIONS } = new BreathworkSessionManager(null);
        vi.unstubAllGlobals();
        expect(Object.keys(SESSION_WORLDS).sort()).toEqual(Object.keys(SESSIONS).sort());
        Object.entries(SESSION_WORLDS).forEach(([session, stages]) => {
            // Every stage the session has (a hold, a recovery, Flow's rhythm kept on your own; the
            // short sessions have none of these) is set in a world of its own, not the arrival's.
            new Set(SESSIONS[session].phases.map((phase) => phase.type)).forEach((stage) => {
                expect(stages[stage], `${session}.${stage}`).toBeTruthy();
            });
            Object.entries(stages).forEach(([stage, ids]) => {
                [ids].flat().forEach((id) => {
                    expect(BREATH_WORLD_BUILDERS[id], `${session}.${stage} → ${id}`).toBeTypeOf('function');
                });
            });
        });
    });
});

describe('breathing world host', () => {
    it.each(BREATH_WORLDS.map((world) => world.id))('builds and disposes %s', (id) => {
        const {
            host, scene, renderer, camera,
        } = createHost();
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

    it.each(BREATH_WORLDS.map((world) => world.id))('builds %s again after leaving it, sharing nothing it disposed', (id) => {
        // Leaving a world disposes its geometry and materials. A second build that reused one of
        // them (three's shared Sprite geometry, a module-level buffer) would submit a destroyed
        // buffer and never draw: Heart Glow's halos did, on every return and mood change.
        const { host } = createHost();
        const parts = () => {
            const found = new Set();
            host.root.traverse((node) => {
                if (node.geometry) found.add(node.geometry);
                [node.material].flat().forEach((material) => material && found.add(material));
            });
            return found;
        };
        host.setWorld(id, { mood: 0, seed: 0.5 });
        const first = parts();
        // Another visit seed: the same world, rebuilt.
        host.setWorld(id, { mood: 0, seed: 0.25 });
        parts().forEach((part) => expect(first.has(part), `${id} reuses a disposed ${part.type}`).toBe(false));
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

describe('breathing world host, a world built ahead', () => {
    /**
     * A host whose renderer records each compileAsync and the target bound for it; every compile
     * stays pending until the test opens the gate.
     */
    function compilingHost(quality = 'High', pickMood = () => 0) {
        const made = createHost(quality, pickMood);
        const { renderer } = made;
        let target = null;
        let mrt = null;
        renderer.getRenderTarget = vi.fn(() => target);
        renderer.setRenderTarget = vi.fn((next) => { target = next; });
        renderer.getMRT = vi.fn(() => mrt);
        renderer.setMRT = vi.fn((next) => { mrt = next; });
        made.bound = () => target;
        let open;
        made.gate = new Promise((resolve) => { open = resolve; });
        made.open = () => open();
        made.compiles = [];
        renderer.compileAsync = vi.fn((object, camera, scene) => {
            made.compiles.push({
                object, camera, scene, target,
            });
            return made.gate;
        });
        return made;
    }

    it('builds the next world off screen, then adopts it as it is', () => {
        const { host, scene } = compilingHost();
        host.setWorld('zen-garden');
        const shown = [...host.root.children];
        const seed = host.uniforms.seed.value;
        expect(host.prepareWorld('calm-sleep')).toBe(true);
        expect(host.getDiagnostics().ahead).toBe('calm-sleep');
        // Nothing on screen changes: the same objects, the same visit seed, nothing new in the scene.
        expect(host.root.children).toHaveLength(shown.length);
        shown.forEach((object, index) => expect(host.root.children[index]).toBe(object));
        expect(host.uniforms.seed.value).toBe(seed);
        expect(host.worldId).toBe('zen-garden');
        const ahead = host.prepared.objects;
        ahead.forEach((object) => expect(scene.getObjectById(object.id)).toBeUndefined());
        // The stage change adopts those very objects: nothing is built again.
        expect(host.setWorld('calm-sleep')).toBe('calm-sleep');
        expect(host.root.children).toHaveLength(ahead.length);
        ahead.forEach((object, index) => expect(host.root.children[index]).toBe(object));
        expect(host.prepared).toBeNull();
        host.dispose();
    });

    it('keeps the mood and seed it picked ahead for the visit', () => {
        const picks = [];
        const { host } = compilingHost('High', (id, count) => {
            picks.push(id);
            return count - 1;
        });
        host.setWorld('zen-garden');
        host.prepareWorld('calm-sleep');
        const { mood, seed } = host.prepared;
        host.setWorld('calm-sleep');
        expect(host.mood).toBe(mood);
        expect(mood).toBe(BREATH_WORLD_MOODS['calm-sleep'].at(-1));
        expect(host.uniforms.seed.value).toBe(seed);
        expect(picks.filter((id) => id === 'calm-sleep')).toHaveLength(1);
        host.dispose();
    });

    it('builds nothing ahead for the world on screen, and drops what no longer comes next', () => {
        const { host } = compilingHost();
        host.setWorld('zen-garden');
        expect(host.prepareWorld('calm-sleep')).toBe(true);
        expect(host.prepareWorld('calm-sleep')).toBe(false);
        const stale = vi.spyOn(host.prepared.objects[0].geometry, 'dispose');
        expect(host.prepareWorld('zen-garden')).toBe(false);
        expect(host.prepared).toBeNull();
        expect(stale).toHaveBeenCalled();
        host.prepareWorld('calm-sleep');
        const replaced = vi.spyOn(host.prepared.objects[0].geometry, 'dispose');
        host.prepareWorld('ocean-breath');
        expect(replaced).toHaveBeenCalled();
        expect(host.prepared.worldId).toBe('ocean-breath');
        // A world asked for that is not the one built ahead is built as ever; the other one waits.
        host.setWorld('coherence');
        expect(host.prepared.worldId).toBe('ocean-breath');
        host.dispose();
    });

    it('compiles ahead in the scene pass\'s own context, and leaves the renderer as it was', async () => {
        const {
            host, renderer, camera, scene, compiles, bound, open,
        } = compilingHost();
        host.setWorld('zen-garden');
        await host.compilePrepared();
        expect(compiles).toHaveLength(0);
        expect(host.compilesAhead).toBe(true);
        host.prepareWorld('calm-sleep');
        const compiled = host.compilePrepared();
        expect(host.compilePrepared()).toBe(compiled);
        expect(compiles.length).toBeGreaterThan(0);
        const holder = host.prepared.holder;
        compiles.forEach((call) => {
            // Each object of the world built ahead, with the lights and caches of the real scene,
            // compiled with the scene pass's target bound...
            let inside = false;
            call.object.traverseAncestors((node) => { if (node === holder) inside = true; });
            expect(inside).toBe(true);
            expect(call.camera).toBe(camera);
            expect(call.scene).toBe(scene);
            expect(call.target).toBe(host.post.scenePass.renderTarget);
        });
        // ...and only for compileAsync's synchronous start: the renderer is left as it was.
        expect(bound()).toBeNull();
        open();
        await compiled;
        // Compiled, never drawn.
        expect(renderer.render).not.toHaveBeenCalled();
        host.dispose();
    });

    it('builds and compiles nothing ahead on the lightest tier (no scene pass to compile for)', async () => {
        const { host, compiles } = compilingHost('Minimal');
        host.setWorld('zen-garden');
        expect(host.compilesAhead).toBe(false);
        host.prepareWorld('calm-sleep');
        await host.compilePrepared();
        expect(compiles).toHaveLength(0);
        host.dispose();
    });

    it('lets a compile in flight finish before disposing what it drops', async () => {
        const { host, open } = compilingHost();
        host.setWorld('zen-garden');
        host.prepareWorld('calm-sleep');
        const compiled = host.compilePrepared();
        const dispose = vi.spyOn(host.prepared.objects[0].geometry, 'dispose');
        host.discardPrepared();
        expect(dispose).not.toHaveBeenCalled();
        open();
        await compiled;
        expect(dispose).toHaveBeenCalled();
        host.dispose();
    });

    it('lets a compile in flight finish before disposing an adopted world it leaves', async () => {
        const { host, open } = compilingHost();
        host.setWorld('zen-garden');
        host.prepareWorld('calm-sleep');
        const compiled = host.compilePrepared();
        host.setWorld('calm-sleep');
        const backdrop = host.root.children[0];
        const dispose = vi.spyOn(backdrop.geometry, 'dispose');
        host.setWorld('ocean-breath');
        // Off the screen at once; disposed only once the compile is done with it.
        expect(host.root.children).not.toContain(backdrop);
        expect(dispose).not.toHaveBeenCalled();
        open();
        await compiled;
        expect(dispose).toHaveBeenCalled();
        host.dispose();
    });

    it('disposes everything at once when it is disposed itself, compile or not (its renderer goes next)', () => {
        const { host } = compilingHost();
        host.setWorld('zen-garden');
        host.prepareWorld('calm-sleep');
        host.compilePrepared();
        const ahead = vi.spyOn(host.prepared.objects[0].geometry, 'dispose');
        host.dispose();
        expect(ahead).toHaveBeenCalled();
        expect(host.prepared).toBeNull();
    });

    it('carries on when compiling ahead fails: the world still shows, compiled as it draws', async () => {
        const { host, renderer } = compilingHost();
        host.setWorld('zen-garden');
        host.prepareWorld('calm-sleep');
        renderer.compileAsync = vi.fn(() => Promise.reject(new Error('no pipeline')));
        await host.compilePrepared();
        expect(console.warn).toHaveBeenCalled();
        expect(host.setWorld('calm-sleep')).toBe('calm-sleep');
        host.dispose();
    });
});

describe('breathing world moods', () => {
    const cases = BREATH_WORLDS.flatMap((world) => BREATH_WORLD_MOODS[world.id]
        .map((mood, index) => [world.id, mood.id, index]));

    it('gives every world named moods with ids of their own', () => {
        BREATH_WORLDS.forEach((world) => {
            const moods = BREATH_WORLD_MOODS[world.id];
            expect(moods.length, world.id).toBeGreaterThan(0);
            expect(new Set(moods.map((mood) => mood.id)).size, world.id).toBe(moods.length);
            moods.forEach((mood) => {
                expect(mood.id, world.id).toMatch(/^[a-z][a-z0-9-]*$/);
                expect(mood.name, world.id).toBeTruthy();
            });
        });
    });

    it.each(cases)('builds %s in its %s mood', (id, moodId, index) => {
        const { host } = createHost();
        host.setWorld(id, { mood: index, seed: 0.3 });
        expect(host.mood.id).toBe(moodId);
        expect(host.getDiagnostics().mood).toBe(moodId);
        host.setSize(1280, 720);
        host.setBreath({ breath: 0.6, phase: 0, progress: 0.4 });
        host.step(1 / 60);
        host.render();
        host.dispose();
        expect(host.root.children).toHaveLength(0);
    });

    it('keeps a world\'s mood and seed for the host\'s life, and pins a requested one', () => {
        const picks = [];
        const { host } = createHost('Minimal', (id, count) => {
            picks.push(id);
            return count - 1;
        });
        host.setWorld('zen-garden');
        const first = host.mood;
        const seed = host.uniforms.seed.value;
        host.setWorld('calm-sleep');
        host.setWorld('zen-garden');
        expect(host.mood).toBe(first);
        expect(host.uniforms.seed.value).toBe(seed);
        expect(picks.filter((id) => id === 'zen-garden')).toHaveLength(1);
        host.setWorld('zen-garden', { mood: 0, seed: 0.25 });
        expect(host.mood).toBe(BREATH_WORLD_MOODS['zen-garden'][0]);
        expect(host.uniforms.seed.value).toBe(0.25);
        // Asking again for what is on screen does not rebuild it.
        const backdrop = host.root.children[0];
        host.setWorld('zen-garden', { mood: 0, seed: 0.25 });
        expect(host.root.children[0]).toBe(backdrop);
        host.dispose();
    });

    it('lets events happen only while the world is free to move', () => {
        const { host } = createHost();
        host.setWorld('calm-sleep');
        host.seek(0);
        expect(host.uniforms.life.value).toBe(1);
        host.setSessionPhase('retention');
        host.seek(0);
        expect(host.uniforms.life.value).toBeCloseTo(0.25, 6);
        host.setSessionPhase(null);
        host.setReducedMotion(true);
        host.seek(0);
        expect(host.uniforms.life.value).toBe(0);
        // It eases back rather than switching on.
        host.setReducedMotion(false);
        host.step(0.1);
        expect(host.uniforms.life.value).toBeGreaterThan(0);
        expect(host.uniforms.life.value).toBeLessThan(0.2);
        host.dispose();
    });
});

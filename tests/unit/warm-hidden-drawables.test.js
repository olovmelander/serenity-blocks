/**
 * Reveal-for-precompile helper (investigation §10 / fix #6).
 *
 * Pooled gameplay FX parked at `visible = false` are skipped by three r181's
 * `_projectObject` AND by `compileAsync`, which shares that traversal — so their
 * WebGPU pipelines compile on the first gameplay frame that reveals them. That
 * was measured at 187.9ms / 171.3ms / 79.3ms in Stillwater, with zero longtasks
 * and zero `renderer.info.memory` delta.
 *
 * These tests pin the reveal contract against real three.js objects.
 */
import {
    describe, it, expect, vi,
} from 'vitest';
import * as THREE from 'three';
import {
    revealHiddenDrawables,
    waitForSubmittedGpuWork,
} from '../../src/themes/shared/warm-hidden-drawables.js';

function mesh(name, visible = false) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    m.name = name;
    m.visible = visible;
    return m;
}

describe('revealHiddenDrawables', () => {
    it('reveals a hidden mesh AND its hidden ancestors', () => {
        // _projectObject bails on the first invisible ancestor, so revealing
        // only the leaf would still compile nothing.
        const root = new THREE.Group();
        const mid = new THREE.Group();
        mid.visible = false;
        const leaf = mesh('fx');
        mid.add(leaf);
        root.add(mid);

        const r = revealHiddenDrawables([root]);

        expect(r.revealed).toBe(1);
        expect(leaf.visible).toBe(true);
        expect(mid.visible).toBe(true);
    });

    it('bumps a count-0 InstancedMesh to 1 so it actually draws', () => {
        // A count-0 InstancedMesh yields drawParams === null — it would be
        // revealed but still compile nothing. Stillwater's motes sit at count 0.
        const root = new THREE.Group();
        const inst = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial(), 8);
        inst.count = 0;
        inst.visible = false;
        root.add(inst);

        const r = revealHiddenDrawables([root]);
        expect(r.revealed).toBe(1);
        expect(inst.count).toBe(1);

        r.restore();
        expect(inst.count).toBe(0);
        expect(inst.visible).toBe(false);
    });

    it('leaves a non-zero instance count alone', () => {
        const root = new THREE.Group();
        const inst = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial(), 8);
        inst.count = 4;
        inst.visible = false;
        root.add(inst);

        revealHiddenDrawables([root]);
        expect(inst.count).toBe(4);
    });

    it('clears frustumCulled, because the warm render culls against a stale frustum', () => {
        const root = new THREE.Group();
        const m = mesh('fx');
        root.add(m);

        const r = revealHiddenDrawables([root]);
        expect(m.frustumCulled).toBe(false);

        r.restore();
        expect(m.frustumCulled).toBe(true);
    });

    it('restores an already-visible mesh to visible, not to hidden', () => {
        const root = new THREE.Group();
        const m = mesh('already-on', true);
        root.add(m);

        const r = revealHiddenDrawables([root]);
        r.restore();

        expect(m.visible).toBe(true);
    });

    it('skips and reports a drawable the camera cannot see', () => {
        // A warm on an unreachable layer compiles nothing — it must be loud,
        // not a silent no-op.
        const root = new THREE.Group();
        const m = mesh('off-layer');
        m.layers.set(3);
        root.add(m);
        const camera = new THREE.PerspectiveCamera();
        const onUnreachable = vi.fn();

        const r = revealHiddenDrawables([root], { camera, onUnreachable });

        expect(r.revealed).toBe(0);
        expect(r.skipped).toBe(1);
        expect(onUnreachable).toHaveBeenCalledTimes(1);
        expect(onUnreachable.mock.calls[0][1]).toBe('layers');
        expect(m.visible).toBe(false);
    });

    it('reveals drawables on a layer the camera does test', () => {
        const root = new THREE.Group();
        const m = mesh('on-layer');
        root.add(m);
        const camera = new THREE.PerspectiveCamera();

        expect(revealHiddenDrawables([root], { camera }).revealed).toBe(1);
    });

    it('restore() is idempotent', () => {
        const root = new THREE.Group();
        const m = mesh('fx');
        root.add(m);

        const r = revealHiddenDrawables([root]);
        r.restore();
        m.visible = true; // simulate a live event claiming it afterwards
        r.restore(); // must not rewind that

        expect(m.visible).toBe(true);
    });

    it('honours the limit bound', () => {
        const root = new THREE.Group();
        for (let i = 0; i < 10; i++) root.add(mesh(`fx${i}`));

        expect(revealHiddenDrawables([root], { limit: 3 }).revealed).toBe(3);
    });

    it('ignores non-drawables (groups, lights, cameras)', () => {
        const root = new THREE.Group();
        root.add(new THREE.Group(), new THREE.AmbientLight(), new THREE.PerspectiveCamera());

        expect(revealHiddenDrawables([root]).revealed).toBe(0);
    });

    it('tolerates empty, null and undefined roots', () => {
        for (const input of [undefined, null, [], [null], [{}]]) {
            const r = revealHiddenDrawables(input);
            expect(r.revealed).toBe(0);
            expect(() => r.restore()).not.toThrow();
        }
    });

    it('accepts a bare Object3D as well as an array', () => {
        const root = new THREE.Group();
        root.add(mesh('fx'));
        expect(revealHiddenDrawables(root).revealed).toBe(1);
    });
});

describe('waitForSubmittedGpuWork', () => {
    it('resolves true when the queue drains', async () => {
        const renderer = { backend: { device: { queue: { onSubmittedWorkDone: () => Promise.resolve() } } } };
        await expect(waitForSubmittedGpuWork(renderer)).resolves.toBe(true);
    });

    it('resolves false on a backend without the fence (WebGL)', async () => {
        await expect(waitForSubmittedGpuWork({ backend: {} })).resolves.toBe(false);
        await expect(waitForSubmittedGpuWork(null)).resolves.toBe(false);
    });

    it('resolves false rather than hanging when the queue never drains', async () => {
        const renderer = { backend: { device: { queue: { onSubmittedWorkDone: () => new Promise(() => {}) } } } };
        await expect(waitForSubmittedGpuWork(renderer, 10)).resolves.toBe(false);
    });

    it('resolves false when the device is lost mid-wait', async () => {
        const renderer = {
            backend: { device: { queue: { onSubmittedWorkDone: () => Promise.reject(new Error('device lost')) } } },
        };
        await expect(waitForSubmittedGpuWork(renderer)).resolves.toBe(false);
    });
});

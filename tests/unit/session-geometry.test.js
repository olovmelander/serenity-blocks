// @ts-check
import {
    describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { sessionGeometry } from '../../src/themes/shared/session-geometry.js';

function grid() {
    const geometry = new THREE.PlaneGeometry(4, 3, 6, 5);
    geometry.addGroup(0, 30, 0);
    geometry.setDrawRange(0, 60);
    geometry.computeBoundingSphere();
    geometry.name = 'grid';
    return { geometry, triangles: 60 };
}

describe('sessionGeometry', () => {
    it('builds once per scope and key, and hands each caller a geometry of its own over the same arrays', () => {
        const scope = {};
        const build = vi.fn(grid);
        const a = sessionGeometry(scope, 'k', build);
        const b = sessionGeometry(scope, 'k', build);
        expect(build).toHaveBeenCalledTimes(1);
        expect(b.triangles).toBe(60);
        expect(b.geometry).not.toBe(a.geometry);
        for (const name of Object.keys(a.geometry.attributes)) {
            expect(b.geometry.attributes[name]).not.toBe(a.geometry.attributes[name]);
            expect(b.geometry.attributes[name].array).toBe(a.geometry.attributes[name].array);
            expect(b.geometry.attributes[name].itemSize).toBe(a.geometry.attributes[name].itemSize);
        }
        expect(b.geometry.index.array).toBe(a.geometry.index.array);
        expect(b.geometry.groups).toEqual(a.geometry.groups);
        expect(b.geometry.drawRange).toEqual(a.geometry.drawRange);
        expect(b.geometry.boundingSphere.equals(a.geometry.boundingSphere)).toBe(true);
        expect(b.geometry.name).toBe('grid');
    });

    it('keeps scopes and keys apart', () => {
        const build = vi.fn(grid);
        sessionGeometry({}, 'k', build);
        sessionGeometry({}, 'k', build);
        const scope = {};
        sessionGeometry(scope, 'a', build);
        sessionGeometry(scope, 'b', build);
        sessionGeometry(null, 'n', build);
        sessionGeometry(null, 'n', build);
        expect(build).toHaveBeenCalledTimes(5);
    });

    it('lets one caller dispose its geometry without touching the next one', () => {
        const scope = {};
        const a = sessionGeometry(scope, 'd', grid);
        const disposed = vi.fn();
        a.geometry.addEventListener('dispose', disposed);
        a.geometry.dispose();
        const b = sessionGeometry(scope, 'd', grid);
        expect(disposed).toHaveBeenCalledTimes(1);
        expect(b.geometry.attributes.position.array.length).toBe(a.geometry.attributes.position.array.length);
    });
});

describe('Spring builds its land, river, pour and step face once a session', () => {
    it('gives a second world the same vertices without rebuilding them', async () => {
        const { SpringWorld } = await import('../../src/themes/spring/spring-world.js');
        const make = () => {
            const world = new SpringWorld({ scene: new THREE.Scene(), quality: 'High', prepared: SpringWorld.prepareSync('High') });
            world.build();
            return world;
        };
        const first = make();
        const second = make();
        for (const part of ['land', 'river']) {
            const [ma, mb] = [first.parts[part], second.parts[part]].map((p) => p.mesh || p.meshes?.[0]);
            expect(mb.geometry).not.toBe(ma.geometry);
            for (const name of Object.keys(ma.geometry.attributes)) {
                expect(mb.geometry.attributes[name].array).toBe(ma.geometry.attributes[name].array);
            }
        }
        first.dispose();
        expect(second.parts.land.mesh.geometry.attributes.position.count).toBeGreaterThan(0);
        second.dispose();
    }, 60_000);
});

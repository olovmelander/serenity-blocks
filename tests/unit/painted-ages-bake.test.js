/* eslint-disable max-classes-per-file -- each worker lifecycle needs its own isolated test fake */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { PORTRAIT_RIG } from '../../src/themes/painted-ages/painted-ages-core.js';
import {
    TERRAIN, bakeTerrain, bakeTerrainAsync, hogbackProfile, horizonVisibility, terrainHeight,
} from '../../src/themes/painted-ages/painted-ages-bake.js';

describe('Painted Ages geological bake', () => {
    it('bakes the same transferable buffers from the same seed', () => {
        const a = bakeTerrain({ vertices: 18000, bakeSize: 256 });
        const b = bakeTerrain({ vertices: 18000, bakeSize: 256 });
        expect(a.positions).toEqual(b.positions);
        expect(a.normals).toEqual(b.normals);
        expect(a.indices).toEqual(b.indices);
        expect(a.surface).toEqual(b.surface);
        expect(a.horizon).toEqual(b.horizon);
        expect(a.erosionField.values).toEqual(b.erosionField.values);
        expect(a.erosionField.values.some((depth) => depth < -25)).toBe(true);
        expect(a.positions.length / 3).toBeLessThanOrEqual(18000);
        expect(a.diagnostics.bakeMs).toBeGreaterThanOrEqual(0);
        // Timing is diagnostic only: CI and software rendering are not phone instruments.
        expect(a.diagnostics.seed).toBe(TERRAIN.seed);
        expect(terrainHeight(-330, -430, TERRAIN.seed + 13)).not.toBe(terrainHeight(-330, -430));
    }, 20000);

    it('uses a long dip slope and a scarp over three times as steep', () => {
        const e = 0.0001;
        const dip = (hogbackProfile(0.4 + e) - hogbackProfile(0.4 - e)) / (2 * e);
        const scarp = (hogbackProfile(0.9 + e) - hogbackProfile(0.9 - e)) / (2 * e);
        expect(dip).toBeGreaterThan(0);
        expect(scarp).toBeLessThan(0);
        expect(Math.abs(scarp / dip)).toBeGreaterThan(3);
        expect(hogbackProfile(TERRAIN.crest)).toBeCloseTo(1, 8);
        expect(hogbackProfile(-0.1)).toBeCloseTo(hogbackProfile(0.9), 8);
    });

    it('keeps the fronts at distinct depths above a low central wash', () => {
        const [left, right] = TERRAIN.fronts;
        expect(Math.abs(left.z - right.z)).toBeGreaterThan(200);
        expect(terrainHeight(left.x, left.z)).toBeGreaterThan(terrainHeight(0, left.z) + 50);
        expect(terrainHeight(right.x, right.z)).toBeGreaterThan(terrainHeight(0, right.z) + 50);
        expect(terrainHeight(0, -9700)).toBeGreaterThan(700);
    });

    it('makes forty downhill chutes grounded on the same surface as land', () => {
        const bake = bakeTerrain({ vertices: 18000 });
        expect(bake.chutes).toHaveLength(40);
        expect(new Set(bake.chutes.map(({ id }) => id)).size).toBe(40);
        expect(bake.chutes.filter(({ front }) => front === 0)).toHaveLength(20);
        for (const { points } of bake.chutes) {
            expect(points.length).toBeGreaterThanOrEqual(6);
            for (let j = 0; j < points.length; j += 3) {
                expect(points[j + 1]).toBeCloseTo(bake.heightAt(points[j], points[j + 2]) + 0.6, 3);
                if (j > 0) expect(points[j + 1]).toBeLessThan(points[j - 2] + 0.0001);
            }
        }
    });

    it('keeps desktop mineral runs on the first visible side of the terrain', () => {
        const camera = new PerspectiveCamera(42, 16 / 9, 0.5, 25000);
        camera.position.set(0, 140, 200);
        camera.rotation.set(-7 * (Math.PI / 180), 0, 0, 'YXZ');
        camera.updateMatrixWorld();
        const projected = new Vector3();
        for (const seed of [TERRAIN.seed, 0x5ed1]) {
            const bake = bakeTerrain({ vertices: 18000, seed });
            for (const { points, front } of bake.chutes) {
                expect(points.length).toBeGreaterThanOrEqual(36);
                let minimumClearance = Infinity;
                for (let i = 0; i < points.length; i += 3) {
                    const x = points[i];
                    const y = points[i + 1];
                    const z = points[i + 2];
                    // An independent one-metre ray check catches the old bug:
                    // safe screen coordinates can still lie behind a nearer ridge.
                    const steps = Math.ceil(Math.hypot(x, z - 200));
                    for (let j = 1; j <= steps; j++) {
                        const t = j / steps;
                        const clearance = 140 + (y - 140) * t - bake.heightAt(x * t, 200 + (z - 200) * t);
                        minimumClearance = Math.min(minimumClearance, clearance);
                    }
                    projected.set(x, y, z).project(camera);
                    const screenX = (projected.x + 1) / 2;
                    expect(front === 0 ? screenX < 0.32 : screenX > 0.72).toBe(true);
                    if (i > 0) expect(Math.hypot(x - points[i - 3], z - points[i - 1])).toBeLessThan(50.01);
                }
                expect(minimumClearance).toBeGreaterThan(0);
            }
        }
    }, 20000);

    it('provides continuous channel strips, finite upward normals, and valid triangles', () => {
        const bake = bakeTerrain({ vertices: 18000 });
        for (const path of bake.channels) {
            expect(path.length).toBe(65 * 3);
            for (let j = 3; j < path.length; j += 3) {
                expect(path[j + 2]).toBeGreaterThan(path[j - 1]);
                expect(Math.hypot(path[j] - path[j - 3], path[j + 2] - path[j - 1])).toBeLessThan(150);
            }
        }
        // The selected meltwater families share junctions, then split over gravel.
        for (const point of [0, 16, 32, 48, 56, 60, 64]) {
            const i = point * 3;
            expect(bake.channels[0][i]).toBeCloseTo(bake.channels[4][i], 4);
            expect(bake.channels[4][i]).toBeCloseTo(bake.channels[9][i], 4);
        }
        expect(Math.abs(bake.channels[0][8 * 3] - bake.channels[9][8 * 3])).toBeGreaterThan(40);
        for (let i = 0; i < bake.normals.length; i += 3) {
            const normal = bake.normals.subarray(i, i + 3);
            expect(Math.hypot(...normal)).toBeCloseTo(1, 5);
            expect(normal[1]).toBeGreaterThan(0);
        }
        expect(Math.max(...bake.indices)).toBeLessThan(bake.positions.length / 3);
        expect(bake.vents).toHaveLength(10);
    });

    it('cannot reduce shadow coverage when the sun is lowered', () => {
        const bake = bakeTerrain({ vertices: 18000 });
        for (const horizon of bake.horizon) {
            const low = horizonVisibility(horizon, 12 * (Math.PI / 180));
            const high = horizonVisibility(horizon, 22 * (Math.PI / 180));
            expect(low).toBeLessThanOrEqual(high);
            expect(low).toBeGreaterThanOrEqual(0);
            expect(high).toBeLessThanOrEqual(1);
        }
    });

    it('puts ten distinct downhill portrait runs below the card in the real camera projection', () => {
        const camera = new PerspectiveCamera(PORTRAIT_RIG.fov, 390 / 844, 0.5, 25000);
        camera.position.set(0, 140, 200);
        camera.rotation.set(PORTRAIT_RIG.pitch * (Math.PI / 180), -PORTRAIT_RIG.yaw * (Math.PI / 180), 0, 'YXZ');
        camera.updateMatrixWorld();
        const point = new Vector3();
        for (const seed of [TERRAIN.seed, 0x5ed1]) {
            const { portraitChutes } = bakeTerrain({ vertices: 18000, seed });
            expect(portraitChutes).toHaveLength(10);
            for (let column = 0; column < 10; column++) {
                const { points } = portraitChutes[column];
                expect(points.length).toBeGreaterThan(9);
                for (let i = 0; i < points.length; i += 3) {
                    point.fromArray(points, i).project(camera);
                    const screenY = (1 - point.y) / 2;
                    expect(screenY).toBeGreaterThan(0.86);
                    if (i === 0) expect((point.x + 1) / 2).toBeCloseTo(0.05 + 0.1 * column, 2);
                    // A physical basin may stop just short of the .975 target; the
                    // visible descent must still reach the bottom five percent.
                    if (i === points.length - 3) expect(screenY).toBeGreaterThan(0.95);
                    if (i > 0) expect(points[i + 1]).toBeLessThan(points[i - 2]);
                }
            }
        }
    }, 20000);
});

describe('Painted Ages terrain worker lifecycle', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('reattaches the ground sampler and terminates after transferred buffers arrive', async () => {
        let worker;
        const positions = new Float32Array([0, 20, -200]);
        class FakeWorker {
            constructor() { worker = this; this.terminate = vi.fn(); }

            postMessage() {
                queueMicrotask(() => this.onmessage({ data: { positions, diagnostics: { seed: TERRAIN.seed } } }));
            }
        }
        vi.stubGlobal('Worker', FakeWorker);
        const result = await bakeTerrainAsync({ vertices: 18000 });
        expect(result.positions).toBe(positions);
        expect(result.heightAt(-240, -350)).toBe(terrainHeight(-240, -350));
        expect(result.diagnostics.worker).toBe(true);
        expect(worker.terminate).toHaveBeenCalledOnce();
        expect(worker.onmessage).toBeNull();
        expect(worker.onerror).toBeNull();
    });

    it('cancels an in-flight build without a fallback bake or a remaining worker', async () => {
        let worker;
        class PendingWorker {
            constructor() { worker = this; this.terminate = vi.fn(); }

            postMessage() {}
        }
        vi.stubGlobal('Worker', PendingWorker);
        const controller = new AbortController();
        const pending = bakeTerrainAsync({}, { signal: controller.signal });
        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(worker.terminate).toHaveBeenCalledOnce();
        expect(worker.onmessage).toBeNull();
        expect(worker.onerror).toBeNull();
    });

    it('keeps the transferred erosion sampler after other seeds evict its cache entry', async () => {
        const field = {
            values: new Float32Array(4).fill(-20), size: 2, minX: -2200, minZ: -4300, step: 4500,
        };
        class ErodedWorker {
            terminate() {}

            postMessage({ seed }) {
                queueMicrotask(() => this.onmessage({ data: { erosionField: field, diagnostics: { seed } } }));
            }
        }
        vi.stubGlobal('Worker', ErodedWorker);
        const first = await bakeTerrainAsync({ seed: TERRAIN.seed });
        const height = first.heightAt(-330, -430);
        await Promise.all(Array.from({ length: 5 }, (_, i) => bakeTerrainAsync({ seed: TERRAIN.seed + i + 1 })));
        expect(first.erosionField).toBe(field);
        expect(first.heightAt(-330, -430)).toBe(height);
    });

    it('uses analytical ground and matching sites when the erosion worker fails', async () => {
        let worker;
        class BrokenWorker {
            constructor() { worker = this; this.terminate = vi.fn(); }

            postMessage() {
                queueMicrotask(() => this.onmessage({ data: { error: 'Worker unavailable' } }));
            }
        }
        vi.stubGlobal('Worker', BrokenWorker);
        // This seed already has normal eroded sites in the cache from the tests above.
        const fallback = await bakeTerrainAsync({ seed: TERRAIN.seed });
        expect(fallback.diagnostics.workerFallback).toBe('Worker unavailable');
        expect(fallback.erosionField.values).toEqual(new Float32Array(4));
        expect(fallback.diagnostics.vertices).toBeLessThanOrEqual(18000);
        for (const { points } of fallback.chutes) {
            for (let i = 0; i < points.length; i += 3) {
                expect(points[i + 1]).toBeCloseTo(fallback.heightAt(points[i], points[i + 2]) + 0.6, 3);
            }
        }
        expect(worker.terminate).toHaveBeenCalledOnce();
    }, 20000);
});

import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createEventThreads } from '../../src/themes/astral-weave/astral-weave-event-threads.js';
import { build } from './helpers/tsl-node-build.js';

function embroidery(quality = 'High') {
    return createEventThreads({
        uTime: uniform(0), uPxScale: uniform(1), uViewport: uniform(new THREE.Vector2(1280, 720)), uFade: uniform(1),
    }, quality);
}

describe('astral weave event embroidery', () => {
    it('builds the same pool on both renderers', () => {
        const threads = embroidery();
        threads.perfect(0);
        threads.update(0.8, false);
        for (const builder of [THREE.WGSLNodeBuilder, THREE.GLSLNodeBuilder]) {
            const result = build(builder, threads.mesh);
            expect(result.thrown).toBeUndefined();
            expect(result.heard).toEqual([]);
            expect(result.vertex).not.toMatch(/\b(?:NaN|Infinity)\b/);
        }
        threads.dispose();
    });

    it('keeps a rare crown visible through rapid locks on the smallest tier, then retires every stitch', () => {
        const threads = embroidery('Minimal');
        const { geometry } = threads.mesh;
        threads.perfect(10);
        threads.update(10, false);
        const oldCount = geometry.instanceCount;
        const attrs = geometry.getAttribute('aStitchPose').data.array;
        const crown = Array.from(attrs.slice(0, oldCount * 16));
        for (let i = 0; i < 70; i++) threads.lock(10.1, 0.3, 0, true);
        threads.update(10.3, true);
        expect(geometry.instanceCount).toBeGreaterThan(oldCount);
        expect(Array.from(attrs.slice(0, oldCount * 16))).toEqual(crown);
        expect(geometry.instanceCount).toBeLessThanOrEqual(attrs.length / 16);
        threads.update(16, false);
        expect(geometry.instanceCount).toBe(0);
        threads.combo(16, 4);
        threads.update(16.4, false);
        expect(geometry.instanceCount).toBeGreaterThan(0);
        threads.reset();
        expect(geometry.instanceCount).toBe(0);
        threads.dispose();
    });

    it('seats tall-screen ornaments in the uncovered strips above and below the board', () => {
        const threads = embroidery('Low');
        const aspect = 390 / 844;
        const loom = { cx: 0, cy: 0, radius: 0.45 };
        const card = {
            x0: 0.035, x1: 0.965, y0: 0.16, y1: 0.84,
        };
        threads.setLayout({ cards: [card], cardCount: 1, hud: null }, aspect, loom);
        threads.perfect(0);
        threads.update(1, false);
        const { geometry } = threads.mesh;
        const pose = geometry.getAttribute('aStitchPose');
        const upper = (0.5 - card.y0) / loom.radius;
        const lower = (0.5 - card.y1) / loom.radius;
        const centers = Array.from({ length: geometry.instanceCount }, (_, i) => pose.getY(i));
        expect(centers.filter((y) => y > upper).length).toBeGreaterThan(0);
        expect(centers.filter((y) => y < lower).length).toBeGreaterThan(0);
        expect(centers.every((y) => y > upper || y < lower)).toBe(true);
        threads.dispose();
    });

    it('sends a one-sided throw to the other flank when the preferred seat is entirely covered', () => {
        const threads = embroidery('Low');
        const card = {
            x0: 0.005, x1: 0.61, y0: 0, y1: 1,
        };
        threads.setLayout({ cards: [card], cardCount: 1, hud: null }, 1.2, { cx: 0, cy: 0, radius: 0.45 });
        threads.lock(0, 0.1, 0, false);
        threads.update(0.4, false);
        expect(threads.mesh.geometry.instanceCount).toBe(1);
        expect(threads.mesh.geometry.getAttribute('aStitchPose').getX(0)).toBeGreaterThan(0);
        threads.dispose();
    });

    it('draws five different milestone silhouettes from the same compact pool, then clears them', () => {
        const threads = embroidery('Minimal');
        const { geometry } = threads.mesh;
        const pose = geometry.getAttribute('aStitchPose');
        const silhouettes = new Set();
        for (const kind of ['goal', 'victory', 'round', 'topout', 'respawn']) {
            threads.milestone(0, kind);
            threads.update(0.8, false);
            expect(geometry.instanceCount).toBeGreaterThan(0);
            expect(geometry.instanceCount).toBeLessThanOrEqual(pose.count);
            const silhouette = Array.from({ length: geometry.instanceCount }, (_, i) => {
                const offset = i * pose.data.stride;
                // Position, curve and axes retain each silhouette even without its colour or light.
                return Array.from(pose.data.array.slice(offset, offset + 8));
            });
            silhouettes.add(JSON.stringify(silhouette));
            threads.update(5, false);
            expect(geometry.instanceCount).toBe(0);
            threads.reset();
        }
        expect(silhouettes.size).toBe(5);
        threads.dispose();
    });
});

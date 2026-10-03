/**
 * The summit birds (chapter 5): structure, staging, and the clearances the kettle was solved to.
 */
import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import {
    SUMMIT_BIRDS,
    createSummitBirds,
    resolveSummitBirdLanes,
} from './odyssey-summit-birds.js';
import { getOdysseyPathPointAt } from '../path-utils.js';
import { deriveOdysseyChapterPositions } from '../../../core/odyssey/data/odyssey-layout.js';
import { odysseyWorldHeight } from '../world/odyssey-world-height.js';

const CP = deriveOdysseyChapterPositions();

describe('odyssey summit birds', () => {
    it('is one opaque instanced draw, hidden until staged, and fog-exempt', () => {
        const birds = createSummitBirds();
        const { mesh } = birds;
        expect(mesh.name).toBe('odyssey-summit-birds');
        expect(mesh.visible).toBe(false);
        expect(mesh.geometry.instanceCount).toBe(SUMMIT_BIRDS.count);
        expect(mesh.geometry.getAttribute('aLane').count).toBe(SUMMIT_BIRDS.count);
        // ADR-0020: opaque, so revealing it can never change a blend state or a pipeline.
        expect(mesh.material.transparent).toBe(false);
        expect(mesh.material.depthWrite).toBe(true);
        expect(mesh.material.fog).toBe(false);
        expect(mesh.material.positionNode).toBeTruthy();
        // The vertex stage seats every bird; the template's bounds mean nothing.
        expect(mesh.frustumCulled).toBe(false);
        birds.dispose();
    });

    it('lives inside chapter 5 only: revealed by progress, gone before the sky darkens', () => {
        const birds = createSummitBirds();
        const [inFrom, inTo, outFrom, outTo] = SUMMIT_BIRDS.window;
        // The window sits inside chapter 5, after the 4->5 seam and before the stars come out.
        expect(inFrom).toBeGreaterThan(CP[4]);
        expect(outTo).toBeLessThan(CP[5] - 0.04);
        [[0.2, 0], [inFrom, 0], [inTo, 1], [0.55, 1], [outFrom, 1], [outTo, 0], [0.8, 0]].forEach(([p, want]) => {
            birds.update(12, p);
            expect(birds.uniforms.uReveal.value, `reveal @p=${p}`).toBeCloseTo(want, 6);
            expect(birds.mesh.visible, `visible @p=${p}`).toBe(want > 0.01);
        });
        // In between it is a ramp, not a switch.
        birds.update(12, (inFrom + inTo) / 2);
        expect(birds.uniforms.uReveal.value).toBeGreaterThan(0.2);
        expect(birds.uniforms.uReveal.value).toBeLessThan(0.8);
        birds.dispose();
    });

    it('flies the same flock every session, spread round the whole thermal', () => {
        const a = resolveSummitBirdLanes();
        const b = resolveSummitBirdLanes();
        expect(a).toEqual(b);
        expect(a).toHaveLength(SUMMIT_BIRDS.count);
        a.forEach((lane, i) => {
            expect(lane.radius).toBeGreaterThanOrEqual(SUMMIT_BIRDS.radius[0]);
            expect(lane.radius).toBeLessThanOrEqual(SUMMIT_BIRDS.radius[1]);
            expect(Math.abs(lane.height)).toBeLessThanOrEqual(SUMMIT_BIRDS.heightSpread);
            // One bird per slice of the circle (jittered inside it).
            expect(Math.floor(lane.phase * SUMMIT_BIRDS.count)).toBe(i);
        });
    });

    it('keeps the kettle clear of the mountain and of the rail while it is visible', () => {
        const [cx, cy, cz] = SUMMIT_BIRDS.centre;
        const lowest = cy - SUMMIT_BIRDS.heightSpread - 3; // the bob
        // Terrain under every lane, all the way round.
        const heights = [];
        for (let a = 0; a < 48; a += 1) {
            for (let lane = 0; lane < SUMMIT_BIRDS.radius.length; lane += 1) {
                const r = SUMMIT_BIRDS.radius[lane];
                heights.push(odysseyWorldHeight(
                    cx + (Math.cos((a * Math.PI) / 24) * r),
                    cz + (Math.sin((a * Math.PI) / 24) * r),
                ));
            }
        }
        const top = Math.max(...heights);
        expect(lowest - top, `kettle floor ${lowest} over terrain ${top.toFixed(0)}`).toBeGreaterThan(25);

        // The rail, across the window the flock is drawn in: no bird within 60 u of it.
        const reach = SUMMIT_BIRDS.radius[1];
        const [inFrom, , , outTo] = SUMMIT_BIRDS.window;
        const centre = new THREE.Vector3(cx, cy, cz);
        let nearest = Infinity;
        for (let p = inFrom; p <= outTo; p += 0.002) {
            const pt = getOdysseyPathPointAt(p);
            const horizontal = Math.max(0, Math.hypot(pt.x - centre.x, pt.z - centre.z) - reach);
            const vertical = Math.max(0, Math.abs(pt.y - centre.y) - SUMMIT_BIRDS.heightSpread - 3);
            nearest = Math.min(nearest, Math.hypot(horizontal, vertical));
        }
        expect(nearest, `nearest approach to the rail ${nearest.toFixed(0)} u`).toBeGreaterThan(60);
    });
});

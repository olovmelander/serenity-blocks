/**
 * The summit birds (the vultures' column beside the wall): structure, staging, and the clearances
 * the kettle was solved to.
 */
import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import {
    SUMMIT_BIRDS,
    createSummitBirds,
    resolveSummitBirdLanes,
    summitBirdPositionAt,
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

    it('is there from the shore to the top of the climb: revealed by progress, gone before the sky darkens', () => {
        const birds = createSummitBirds();
        const [inFrom, inTo, outFrom, outTo] = SUMMIT_BIRDS.window;
        // It comes in with the island itself (the breach: from the shore the column is a ring of
        // specks high on the massif) and goes before the stars come out.
        expect(inFrom).toBeGreaterThan(CP[2] - 0.015);
        expect(inTo).toBeLessThanOrEqual(CP[2]);
        expect(outTo).toBeLessThan(CP[5] - 0.04);
        [[0.1, 0], [inFrom, 0], [inTo, 1], [0.2, 1], [0.55, 1], [outFrom, 1], [outTo, 0], [0.8, 0]].forEach(([p, want]) => {
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
        // Every bird on its own lane of the leaning column, all round it.
        const lanes = resolveSummitBirdLanes();
        const [inFrom, , , outTo] = SUMMIT_BIRDS.window;
        const rail = [];
        for (let p = inFrom; p <= outTo; p += 0.001) rail.push(getOdysseyPathPointAt(p));
        let floor = Infinity;
        let nearest = Infinity;
        const at = new THREE.Vector3();
        lanes.forEach((lane) => {
            for (let t = 0; t < SUMMIT_BIRDS.lapSeconds * 1.3; t += 1) {
                const q = summitBirdPositionAt(lane, t);
                floor = Math.min(floor, q.y - odysseyWorldHeight(q.x, q.z));
                at.set(q.x, q.y, q.z);
                for (const pt of rail) nearest = Math.min(nearest, at.distanceTo(pt));
            }
        });
        expect(floor, `lowest bird ${floor.toFixed(0)} u over the terrain`).toBeGreaterThan(25);
        // The rail, across the window the flock is drawn in: no bird within 55 u of it.
        expect(nearest, `nearest approach to the rail ${nearest.toFixed(0)} u`).toBeGreaterThan(55);
    });
});

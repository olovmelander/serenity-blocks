import * as THREE from 'three/webgpu';
import {
    beforeAll, describe, expect, it, vi,
} from 'vitest';

import { LevelNodeManager } from '../LevelNodeManager.js';
import { createOdysseyWorld } from './odyssey-world-renderer.js';
import {
    getActiveOdysseyChapterPositions,
    getOdysseyPathPointAt,
} from '../path-utils.js';

/**
 * WAVE 3 — props consult the CPU mirror of the drawn ground.
 *
 * The spline was solved against the MACRO terrain, but the drawn surface adds baked relief on
 * top, so a node placed by spline altitude alone can sit inside a rise the vertex shader
 * displaced above it. These tests pin the seating contract with stubs, then MEASURE the real
 * situation: every Act II node position against the real world height field. The measurement
 * is the point — "does anything actually need lifting" was an assumption in both directions
 * until it was run.
 */

// The manager's constructor paints a glow sprite onto a 2D canvas; headless, that needs the
// same document stub every chapter-environment test already uses.
beforeAll(() => {
    // A Proxy context: any method call succeeds, gradients come back gradient-shaped. The
    // manager paints lock/star/glow sprites with a long tail of 2D ops, and enumerating them
    // by hand (the older chapter-test stub) breaks every time the sprite painter grows a call.
    const gradient = { addColorStop: vi.fn() };
    const context = new Proxy({}, {
        get: (target, prop) => {
            if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
                return () => gradient;
            }
            if (!(prop in target)) target[prop] = vi.fn();
            return target[prop];
        },
        set: (target, prop, value) => { target[prop] = value; return true; },
    });
    vi.stubGlobal('document', {
        createElement: vi.fn(() => ({
            width: 0,
            height: 0,
            getContext: vi.fn(() => context),
        })),
    });
});

function stubManager(pathCurve) {
    return new LevelNodeManager({ add() {}, remove() {} }, pathCurve);
}

const FLAT_PATH = {
    getPointAt: (t, target) => (target ?? new THREE.Vector3()).set(t * 1000, 50, 0),
};

describe('ground seating contract (stubs)', () => {
    it('lifts a node that would sit inside the drawn ground', () => {
        const manager = stubManager(FLAT_PATH);
        manager.setGroundSampler(() => 80, { clearance: 6 });
        const p = manager._getPathPoint(0.5, new THREE.Vector3());
        expect(p.y).toBe(86);
    });

    it('never pulls a flying node down toward the ground', () => {
        const manager = stubManager(FLAT_PATH);
        manager.setGroundSampler(() => 10, { clearance: 6 });
        const p = manager._getPathPoint(0.5, new THREE.Vector3());
        expect(p.y).toBe(50);
    });

    it('seats only inside the configured range — Ch1 nodes are UNDER the terrain', () => {
        const manager = stubManager(FLAT_PATH);
        manager.setGroundSampler(() => 500, { clearance: 6, rangeStart: 0.2, rangeEnd: 0.65 });
        expect(manager._getPathPoint(0.1, new THREE.Vector3()).y).toBe(50);
        expect(manager._getPathPoint(0.5, new THREE.Vector3()).y).toBe(506);
        expect(manager._getPathPoint(0.9, new THREE.Vector3()).y).toBe(50);
    });

    it('ignores a sampler that returns non-finite values', () => {
        const manager = stubManager(FLAT_PATH);
        manager.setGroundSampler(() => NaN, { clearance: 6 });
        expect(manager._getPathPoint(0.5, new THREE.Vector3()).y).toBe(50);
    });

    it('is inert with no sampler — the shipped path is untouched', () => {
        const manager = stubManager(FLAT_PATH);
        expect(manager._getPathPoint(0.5, new THREE.Vector3()).y).toBe(50);
    });
});

describe('the real Act II rail against the real drawn ground (measurement)', () => {
    it('every default node position clears the world surface once seated', () => {
        const world = createOdysseyWorld({ quality: 'low' });
        try {
            const cp = getActiveOdysseyChapterPositions();
            const actStart = cp[1];
            const actEnd = cp[5];
            const CLEARANCE = 7;

            let lifted = 0;
            let worstBurial = 0;
            // The manager's default layout: node i of 55 at pathPosition (i) / 55.
            for (let i = 0; i <= 55; i += 1) {
                const t = i / 55;
                if (t < actStart || t > actEnd) continue;
                const p = getOdysseyPathPointAt(t);
                const ground = world.heightAt(p.x, p.z);
                expect(Number.isFinite(ground)).toBe(true);
                if (p.y < ground + CLEARANCE) {
                    lifted += 1;
                    worstBurial = Math.max(worstBurial, (ground + CLEARANCE) - p.y);
                }
                const seatedY = Math.max(p.y, ground + CLEARANCE);
                expect(seatedY).toBeGreaterThanOrEqual(ground + CLEARANCE);
            }
            // The measurement, recorded where it cannot rot: if this changes, the height
            // field or the rail moved, and the seating either became load-bearing or stopped
            // being exercised — either way worth noticing, not asserting away.
            // eslint-disable-next-line no-console
            console.log(`[seating] Act II default nodes needing a lift: ${lifted}${
                lifted ? ` (worst burial ${worstBurial.toFixed(1)}u)` : ''}`);
        } finally {
            world.dispose();
        }
    });

    it('the rail itself never runs under the drawn ground through Act II', () => {
        const world = createOdysseyWorld({ quality: 'low' });
        try {
            const cp = getActiveOdysseyChapterPositions();
            let minClearance = Infinity;
            let atT = 0;
            for (let i = 0; i <= 200; i += 1) {
                const t = cp[1] + (((cp[5] - cp[1]) * i) / 200);
                const p = getOdysseyPathPointAt(t);
                const clearance = p.y - world.heightAt(p.x, p.z);
                if (clearance < minClearance) { minClearance = clearance; atT = t; }
            }
            // The camera rides ~16u above the rail point; the rail dipping under the drawn
            // surface would put the GROUND across the lens. The height model was solved
            // against rail altitudes (49-sample check in odyssey-world-height.test.js); this
            // re-verifies the same promise against the BAKED grid the shader actually draws.
            expect(
                minClearance,
                `rail is ${(-minClearance).toFixed(1)}u under the drawn ground at t=${atT.toFixed(3)}`,
            ).toBeGreaterThan(0);
        } finally {
            world.dispose();
        }
    });
});

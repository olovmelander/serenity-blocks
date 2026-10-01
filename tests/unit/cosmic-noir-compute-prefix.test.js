import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three';
import { CosmicNoirSparkCompute } from '../../src/themes/cosmic-noir/cosmic-noir-compute.js';
import CosmicNoirTheme from '../../src/themes/cosmic-noir/cosmic-noir-theme.js';

function pool(count = 4000, options = {}) {
    const compute = new CosmicNoirSparkCompute(count, { randomFn: () => 0.5, ...options });
    compute.createComputeNode();
    return compute;
}

function expectAllLiveSlotsCovered(compute, time) {
    for (let i = 0; i < compute.count; i++) {
        const birth = compute.lifeData[i * 4];
        const expires = birth + compute.lifeData[i * 4 + 2] + compute.lifeData[i * 4 + 3];
        if (birth > -1000 && expires > time) expect(i).toBeLessThan(compute.activeHighWaterMark);
    }
    expect(compute.computeNode.count).toBe(compute.activeHighWaterMark);
}

beforeEach(() => vi.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('Cosmic Noir compute active prefix', () => {
    it('clears fallback state across rebuilds and reports the new native draw count', () => {
        const theme = new CosmicNoirTheme();
        theme.unifiedSparkData = { activeEstimate: 4321, count: 8000 };
        theme.resetRuntimeReferences();
        expect(theme.unifiedSparkData).toBeNull();

        // Also cover a direct builder replacement, without a complete scene reset.
        theme.unifiedSparkData = { activeEstimate: 4321, count: 8000 };
        theme.isWebGPU = true;
        theme.flags.useCompute = true;
        theme.renderer = { compute: vi.fn() };
        theme.planetGroup = new THREE.Group();
        theme.createVoidSparks();
        expect(theme.unifiedSparkData).toBeNull();
        theme.baselineFrames = [16.7];
        theme.getPerformanceTargetDimensions = () => ({});
        expect(theme.getBaselineReport().activeEffects.voidSparkParticles).toBe(0);

        theme.sparkCompute.triggerBurst(0, 0.75);
        theme.time = 0.1;
        theme.updateScene(1 / 60);
        expect(theme.getBaselineReport().activeEffects).toMatchObject({
            voidSparkParticles: theme.sparkCompute.activeHighWaterMark,
            voidSparkCapacity: theme.sparkCompute.count,
        });
        theme.computeSparkPoints.geometry.dispose();
        theme.computeSparkPoints.material.dispose();
        theme.disposeComputeResources();
    });

    it('dispatches the activated prefix without reallocating or reducing its batch', () => {
        const compute = pool(26000);
        const node = compute.computeNode;
        const positions = compute.positionBuffer;
        compute.triggerBurst(0, 0.75);
        expect(compute.activeHighWaterMark).toBe(2080);
        expect(compute.computeNode.count).toBe(2080);
        expect(compute.count).toBe(26000);
        expect(compute.lifeData.filter((value, index) => index % 4 === 0 && value === 0)).toHaveLength(2080);
        compute.triggerBurst(1, 2.25);
        expect(compute.activeHighWaterMark).toBe(2080 + 6760);
        expect(compute.computeNode).toBe(node);
        expect(compute.positionBuffer).toBe(positions);
        expectAllLiveSlotsCovered(compute, 1);
    });

    it('preserves overlapping particles and future staggered births', () => {
        const compute = pool(4000, { maxDelay: 2, minLife: 3, maxLife: 3 });
        compute.triggerBurst(0, 0.75);
        const firstBirths = compute.lifeData.slice(0, 900 * 4);
        compute.triggerBurst(0.2, 0.75);
        expect(compute.activeHighWaterMark).toBe(1800);
        expect(compute.nextTriggerIndex).toBe(1800);
        expect(compute.lifeData.slice(0, 900 * 4)).toEqual(firstBirths);
        expect(compute.lifeData[3]).toBe(1); // The first batch has not spawned yet.
        expectAllLiveSlotsCovered(compute, 0.2);
    });

    it('retains the full pool when overlapping batches wrap', () => {
        const compute = pool();
        for (let i = 0; i < 5; i++) {
            compute.triggerBurst(i * 0.1, 0.75);
            expectAllLiveSlotsCovered(compute, i * 0.1);
        }
        expect(compute.nextTriggerIndex).toBe(500);
        expect(compute.activeHighWaterMark).toBe(4000);
        expect(compute.computeNode.count).toBe(4000);
        compute.triggerBurst(1, 2.25);
        expect(compute.activeHighWaterMark).toBe(4000);
        expectAllLiveSlotsCovered(compute, 1);
    });

    it('resets the prefix only beyond the longest possible delayed lifetime', () => {
        const compute = pool();
        compute.triggerBurst(0, 0.75);
        const expiry = compute.lastActiveUntil;
        compute.triggerBurst(expiry, 0.75);
        expect(compute.activeHighWaterMark).toBe(1800);
        const finalExpiry = compute.lastActiveUntil;
        compute.triggerBurst(finalExpiry + 0.001, 0.75);
        expect(compute.activeHighWaterMark).toBe(900);
        expect(compute.nextTriggerIndex).toBe(900);
        expectAllLiveSlotsCovered(compute, finalExpiry + 0.001);
    });

    it('updates the live draw range when a visible burst grows, and hides it when idle', () => {
        const theme = new CosmicNoirTheme();
        const compute = pool();
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4000 * 3), 3));
        geometry.setDrawRange(0, 0);
        const points = new THREE.Points(geometry, new THREE.PointsMaterial());
        points.visible = false;
        points.userData.computeBacked = true;
        theme.isWebGPU = true;
        theme.flags.useCompute = true;
        theme.sparkCompute = compute;
        theme.computeSparkPoints = points;
        theme.voidSparks = [points];
        theme.renderer = { compute: vi.fn() };
        theme.baselineFrames = [16.7];
        theme.getPerformanceTargetDimensions = () => ({});
        compute.triggerBurst(0, 0.75);
        theme.time = 0.1;
        theme.updateScene(1 / 60);
        expect(points.visible).toBe(true);
        expect(geometry.drawRange.count).toBe(900);
        compute.triggerBurst(0.2, 2.25);
        theme.time = 0.3;
        theme.updateScene(1 / 60);
        expect(geometry.drawRange.count).toBe(1940);
        expect(theme.getBaselineReport().activeEffects).toMatchObject({
            voidSparkParticles: 1940,
            voidSparkCapacity: 4000,
        });
        expect(theme.renderer.compute).toHaveBeenCalledTimes(2);
        theme.time = compute.lastActiveUntil + 0.01;
        theme.updateScene(1 / 60);
        expect(points.visible).toBe(false);
        expect(geometry.drawRange.count).toBe(0);
        expect(theme.getBaselineReport().activeEffects.voidSparkParticles).toBe(0);
        expect(theme.renderer.compute).toHaveBeenCalledTimes(2);
        compute.triggerBurst(theme.time, 0.75);
        theme.updateScene(1 / 60);
        expect(geometry.drawRange.count).toBe(900);
        geometry.dispose();
        points.material.dispose();
        compute.dispose();
    });
});

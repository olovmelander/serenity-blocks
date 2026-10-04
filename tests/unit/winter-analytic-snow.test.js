import {
    describe, expect, it, vi,
} from 'vitest';
import { createWinterAnalyticSnow } from '../../src/playground/effects/winter-wonderland.effect.js';

const BOX = {
    w: 4600, h: 2800, d: 3800, cx: 0, cy: 560, cz: -1000,
};

describe('Winter WebGL2 analytic snow', () => {
    it('keeps node flakes and escalates sideways wind, swirl and slower fall on storms', () => {
        const calm = createWinterAnalyticSnow(4200, BOX);
        const storm = createWinterAnalyticSnow(4200, BOX);
        calm.update(1, 1 / 60);
        storm.update(1, 1 / 60, { intensity: 1, gust: 1, vortex: 1 });

        expect(storm.points.geometry.getAttribute('position').count).toBe(4200);
        expect(storm.material.isNodeMaterial).toBe(true);
        expect(storm.uniforms.uWindOffset.value.x).toBeGreaterThan(calm.uniforms.uWindOffset.value.x);
        expect(storm.uniforms.uSwirl.value).toBeGreaterThan(calm.uniforms.uSwirl.value);
        expect(storm.uniforms.uFallDistance.value).toBeLessThan(calm.uniforms.uFallDistance.value);
        calm.dispose();
        storm.dispose();
    });

    it('keeps wind bounded and reverses gust direction without an event position jump', () => {
        const snow = createWinterAnalyticSnow(5, BOX);
        snow.update(1, 1 / 60, { intensity: 1, gustDir: -1 });
        const firstOffset = snow.uniforms.uWindOffset.value.x;
        snow.update(1, 0, { intensity: 0, gustDir: 1 });
        expect(firstOffset).toBeLessThan(0);
        expect(snow.uniforms.uWindOffset.value.x).toBe(firstOffset);

        for (let i = 0; i < 10000; i += 1) {
            snow.update(i, 1, { intensity: 1, gust: 1, gustDir: -1 });
        }
        expect(Math.abs(snow.uniforms.uWindOffset.value.x)).toBeLessThan(BOX.w);
        expect(Math.abs(snow.uniforms.uWindOffset.value.y)).toBeLessThan(BOX.d);
        snow.dispose();
    });

    it('releases its geometry and material with the scene effect', () => {
        const snow = createWinterAnalyticSnow(5, BOX);
        const geometryDisposed = vi.fn();
        const materialDisposed = vi.fn();
        snow.geometry.addEventListener('dispose', geometryDisposed);
        snow.material.addEventListener('dispose', materialDisposed);

        snow.dispose();

        expect(geometryDisposed).toHaveBeenCalledOnce();
        expect(materialDisposed).toHaveBeenCalledOnce();
    });
});

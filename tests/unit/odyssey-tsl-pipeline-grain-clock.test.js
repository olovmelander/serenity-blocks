/**
 * @fileoverview OdysseyTslPipeline — the grain's clock wraps on the CPU (audit 2026-10-23).
 * uTime feeds only the grain hash; fed the session time, its sin() argument went coarse in
 * fp32 after ten minutes. The wrap lives in the uniform's writers, not the shader: a mod() in
 * the graph changed the composite's text and cost an uncached pipeline compile at every reveal.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { OdysseyTslPipeline } from '../../src/rendering/odyssey/odyssey-post/odyssey-tsl-pipeline.js';

function make() {
    const renderer = { getPixelRatio: () => 1 };
    return new OdysseyTslPipeline(renderer, new THREE.Scene(), new THREE.PerspectiveCamera(), {});
}

describe('OdysseyTslPipeline grain clock', () => {
    it('keeps the clock inside 64 s however long the session runs', () => {
        const p = make();
        for (let i = 0; i < 70 * 60; i += 1) p.update(1 / 60, null);
        expect(p.uTime.value).toBeGreaterThanOrEqual(0);
        expect(p.uTime.value).toBeLessThan(64);
        expect(p.uTime.value).toBeCloseTo(70 - 64, 3);

        p.updateTime(600.5);
        expect(p.uTime.value).toBeCloseTo(600.5 % 64, 9);
        p.updateDynamic({ time: 3600.25 });
        expect(p.uTime.value).toBeCloseTo(3600.25 % 64, 9);
    });
});

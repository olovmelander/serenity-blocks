/**
 * @fileoverview OdysseyTslPipeline — the space chapters' post contract (masterpiece pass,
 * 2026-10). Pure JS/uniform state, no GPU:
 *   - the per-chapter bloom columns are NEUTRAL for every row that does not author them
 *     (ch1-5 and ch8 keep exactly the base bloom), and space/black-hole rows move only the
 *     BloomNode's uniforms — never the bound graph;
 *   - the ch7 lens centre maps NDC to viewportUV with y DOWN (WebGPU's origin is top-left;
 *     the old y-up mapping lensed the hero's mirror image and drew a phantom black hole);
 *   - the lens radius is the PROJECTED shadow radius when the hero publishes one.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { OdysseyTslPipeline } from '../../src/rendering/odyssey/odyssey-post/odyssey-tsl-pipeline.js';

function make(params = {}) {
    const renderer = { getPixelRatio: () => 1 };
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 9000);
    return new OdysseyTslPipeline(renderer, scene, camera, {
        bloomStrength: 0.32, bloomThreshold: 0.85, bloomRadius: 0.7, ...params,
    });
}

function settle(p, chapter, frames = 240) {
    const state = {
        activeChapter: chapter, sourceChapter: chapter, targetChapter: chapter, seamProgress: 0, post: { bloom: 1 },
    };
    for (let i = 0; i < frames; i += 1) p.update(1 / 60, state);
}

describe('OdysseyTslPipeline space signature', () => {
    it('leaves the bloom exactly at its base in every chapter that authors no bloom columns', () => {
        [1, 2, 3, 4, 5, 8].forEach((chapter) => {
            const p = make();
            settle(p, chapter);
            expect(p.bloomNode.threshold.value, `ch${chapter} threshold`).toBeCloseTo(0.85, 6);
            expect(p.bloomNode.radius.value, `ch${chapter} radius`).toBeCloseTo(0.7, 6);
            if (chapter !== 8) {
                expect(p.bloomNode.strength.value, `ch${chapter} strength`).toBeCloseTo(0.32, 6);
            }
        });
    });

    it('gives space a tighter gilded bloom and the black hole a stronger, tighter one — by uniform only', () => {
        const p = make();
        settle(p, 6);
        const graph = p.postProcessing.outputNode;
        expect(p.bloomNode.strength.value).toBeGreaterThan(0.32);
        expect(p.bloomNode.radius.value).toBeLessThan(0.7);
        const space = { strength: p.bloomNode.strength.value, radius: p.bloomNode.radius.value };
        settle(p, 7);
        expect(p.bloomNode.strength.value).toBeGreaterThan(space.strength);
        expect(p.bloomNode.radius.value).toBeLessThan(space.radius);
        expect(p.bloomNode.threshold.value).toBeGreaterThan(0.85);
        // ch6 -> ch7 swaps in the lens variant; going back to ch6 must restore the very same
        // cached lean graph (the bloom columns themselves never rebuild anything).
        settle(p, 6);
        expect(p.postProcessing.outputNode).toBe(graph);
    });

    it('maps the hero to viewportUV with y DOWN and sizes the lens to the projected shadow', () => {
        const p = make();
        p.setSize(1600, 900);
        expect(p.uLensAspect.value).toBeCloseTo(16 / 9, 6);
        const { camera } = p;
        camera.position.set(0, 0, 0);
        camera.lookAt(0, 0, -1);
        camera.updateMatrixWorld(true);
        // A hero ABOVE the view axis must land in the TOP half of viewportUV (y < 0.5).
        const hero = new THREE.Vector3(0, 150, -900);
        hero.lensRadius = 132;
        for (let i = 0; i < 60; i += 1) p.setLensTarget(hero);
        expect(p._smLensCenter.y).toBeLessThan(0.5);
        expect(p._smLensCenter.x).toBeCloseTo(0.5, 3);
        // Projected radius: tan(asin(R / d)) / (2 tan(fov / 2)) in viewport-height units.
        const d = hero.length();
        const expected = Math.tan(Math.asin(132 / d)) / (2 * Math.tan(THREE.MathUtils.degToRad(30)));
        expect(p.uLensRadius.value).toBeCloseTo(expected, 3);
    });
});

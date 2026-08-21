/**
 * @fileoverview OdysseyTslPipeline RCAS sharpen gate (three r185 SharpenNode; upgrade plan
 * §11 item 4). Pure node-graph construction — no GPU. Pins the JS-side contract:
 *   - amount 0 (scale >= 0.95, or ?odysseySharpen=0) binds the PLAIN cached variant (the
 *     very same node object as before the feature — full-res frames stay byte-identical);
 *   - amount > 0 binds sharpen(rtt(variant)) and flags needsUpdate (edge only);
 *   - amount changes within (0,1] are a uniform write, never a rebind;
 *   - one wrapper slot: a base-variant change while sharpened swaps it; dispose() frees it.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { OdysseyTslPipeline } from '../../src/rendering/odyssey/odyssey-post/odyssey-tsl-pipeline.js';

function make(params = {}) {
    const renderer = { getPixelRatio: () => 1 };
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    return new OdysseyTslPipeline(renderer, scene, camera, params);
}

describe('OdysseyTslPipeline sharpen gate', () => {
    it('binds the plain variant at full scale and the wrapper only under DRS', () => {
        const p = make();
        const base = p.postProcessing.outputNode;
        expect(p.getPerfState().sharpenActive).toBe(false);
        expect(p.postProcessing.outputColorTransform).toBe(true);
        p.setRenderScale(1);
        expect(p.postProcessing.outputNode).toBe(base);
        p.setRenderScale(0.95);
        expect(p.postProcessing.outputNode).toBe(base);
        p.postProcessing.needsUpdate = false;
        p.setRenderScale(0.8);
        const wrapped = p.postProcessing.outputNode;
        expect(wrapped).not.toBe(base);
        expect(wrapped.isSharpenNode).toBe(true);
        expect(wrapped.textureNode.isRTTNode).toBe(true);
        // the RTT holds the DISPLAY-encoded frame (sRGB, no tone mapping) so RCAS runs in
        // the perceptual domain and the canvas copy must not encode again
        const encoded = wrapped.textureNode.node;
        expect(encoded.isRenderOutputNode).toBe(true);
        expect(encoded.colorNode).toBe(base);
        expect(encoded.getToneMapping()).toBe(THREE.NoToneMapping);
        expect(encoded.outputColorSpace).toBe(THREE.SRGBColorSpace);
        expect(p.postProcessing.outputColorTransform).toBe(false);
        expect(p.postProcessing.needsUpdate).toBe(true);
        expect(p.getPerfState().sharpenAmount).toBeCloseTo(0.175, 5);
        expect(p.uSharpness.value).toBeCloseTo(-Math.log2(0.175), 5);
        // amount change within (0,1] is a uniform write, no rebind
        p.postProcessing.needsUpdate = false;
        p.setRenderScale(0.65);
        expect(p.postProcessing.outputNode).toBe(wrapped);
        expect(p.postProcessing.needsUpdate).toBe(false);
        expect(p.getPerfState().sharpenAmount).toBeCloseTo(0.35, 5);
        p.setRenderScale(0.5);
        expect(p.getPerfState().sharpenAmount).toBeCloseTo(0.35, 5);
        // back to full: plain variant rebinds; wrapper slot retained for reuse
        p.setRenderScale(1);
        expect(p.postProcessing.outputNode).toBe(base);
        expect(p.postProcessing.outputColorTransform).toBe(true);
        p.setRenderScale(0.7);
        expect(p.postProcessing.outputNode).toBe(wrapped);
        // base variant change while sharpened swaps the wrapper slot
        p._selectVariant(true, true);
        const wrapped2 = p.postProcessing.outputNode;
        expect(wrapped2).not.toBe(wrapped);
        expect(wrapped2.isSharpenNode).toBe(true);
        expect(wrapped2.textureNode.node.colorNode).toBe(p._outputVariants.get('1|1'));
        expect(p._activeVariantKey).toBe('1|1');
        p.dispose();
        expect(p._sharpenSlot).toBe(null);
    });

    it('opt-out keeps the plain variant regardless of scale', () => {
        const p = make({ sharpen: false });
        const base = p.postProcessing.outputNode;
        p.setRenderScale(0.65);
        expect(p.postProcessing.outputNode).toBe(base);
        expect(p.getPerfState().sharpenActive).toBe(false);
    });

    it('honours sharpenMaxAmount', () => {
        const p = make({ sharpenMaxAmount: 0.6 });
        p.setRenderScale(0.65);
        expect(p.getPerfState().sharpenAmount).toBeCloseTo(0.6, 5);
    });
});

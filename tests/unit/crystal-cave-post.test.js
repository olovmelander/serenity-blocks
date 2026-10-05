import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { CRYSTAL_CAVE_EXPOSURE, CrystalCavePost } from '../../src/themes/crystal-cave/crystal-cave-post.js';
import { QUALITY_PRESETS } from '../../src/themes/crystal-cave/crystal-cave-quality.js';

const posts = [];

function create(quality = 'High') {
    const renderer = {
        toneMapping: THREE.NoToneMapping,
        toneMappingExposure: 0.4,
        render: vi.fn(function render() {
            this.seen = { toneMapping: this.toneMapping, exposure: this.toneMappingExposure };
        }),
    };
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 300);
    const post = new CrystalCavePost({
        renderer, scene, camera, quality,
    });
    posts.push(post);
    return {
        post, renderer, scene, camera,
    };
}

afterEach(() => {
    posts.splice(0).forEach((post) => post.dispose());
});

describe('Crystal Cave post', () => {
    it.each(['Extreme', 'Ultra', 'High', 'Medium'])('builds one bloom pipeline without MRT at %s', (quality) => {
        const { post } = create(quality);
        expect(post.disabled).toBe(false);
        expect(post.useMRT).toBe(false);
        expect(post.pipeline).toBeInstanceOf(THREE.RenderPipeline);
        expect(post.pipeline.outputColorTransform).toBe(false);
        expect(post.bloomNode).not.toBeNull();
        expect(post.getDiagnostics()).toMatchObject({
            quality,
            disabled: false,
            resolutionScale: QUALITY_PRESETS[quality].bloomScale,
            exposure: CRYSTAL_CAVE_EXPOSURE,
            reaction: 0,
            bloomThreshold: 0.9,
        });
    });

    it.each(['Low', 'Minimal'])('allocates nothing at %s and draws the scene directly, tone mapped', (quality) => {
        const {
            post, renderer, scene, camera,
        } = create(quality);
        expect(post.disabled).toBe(true);
        expect(post.pipeline).toBeNull();
        expect(post.scenePass).toBeNull();
        expect(post.bloomNode).toBeNull();
        post.update({ energy: 1, resonance: 1 });
        post.render();
        expect(renderer.render).toHaveBeenCalledExactlyOnceWith(scene, camera);
        expect(renderer.seen.toneMapping).toBe(THREE.NeutralToneMapping);
        expect(renderer.seen.exposure).toBeCloseTo(post.getDiagnostics().exposure);
        // The renderer is handed back exactly as it was found.
        expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
        expect(renderer.toneMappingExposure).toBe(0.4);
        expect(post.getDiagnostics().bloomStrength).toBe(0);
    });

    it('restores the renderer even when a direct render throws', () => {
        const { post, renderer } = create('Low');
        renderer.render.mockImplementation(() => { throw new Error('lost'); });
        expect(() => post.render()).toThrow('lost');
        expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
        expect(renderer.toneMappingExposure).toBe(0.4);
    });

    it('lifts bloom and exposure a little with the cave\'s excitement and returns to rest', () => {
        const { post } = create('High');
        const rest = post.getDiagnostics();
        post.update({ energy: 1, resonance: 1 });
        const excited = post.getDiagnostics();
        expect(excited.reaction).toBe(1);
        expect(excited.bloomStrength).toBeGreaterThan(rest.bloomStrength);
        expect(excited.bloomStrength).toBeLessThan(0.6);
        expect(excited.exposure).toBeGreaterThan(rest.exposure);
        expect(excited.exposure).toBeLessThan(rest.exposure * 1.1);
        post.update({ energy: 0, resonance: 0 });
        expect(post.getDiagnostics()).toMatchObject({ reaction: 0, exposure: rest.exposure, bloomStrength: rest.bloomStrength });
    });

    it('dims with the cave at the end of a game', () => {
        const { post } = create('High');
        post.update({ energy: 0, resonance: 0, dim: 1 });
        expect(post.getDiagnostics().exposure).toBeCloseTo(CRYSTAL_CAVE_EXPOSURE * 0.75);
    });

    it.each([null, undefined, {}, { energy: NaN }, { energy: Infinity, resonance: -4 }, { energy: 'loud', dim: {} }])(
        'treats a malformed frame %j as a quiet cave',
        (frame) => {
            const { post } = create('Medium');
            expect(() => post.update(frame)).not.toThrow();
            const diagnostics = post.getDiagnostics();
            expect(diagnostics.reaction).toBe(0);
            expect(diagnostics.exposure).toBe(CRYSTAL_CAVE_EXPOSURE);
            expect(Number.isFinite(diagnostics.bloomStrength)).toBe(true);
        },
    );

    it('ignores nonsense sizes', () => {
        const { post } = create('High');
        post.setSize(1600, 900);
        expect(post.uAspect.value).toBeCloseTo(16 / 9);
        for (const [width, height] of [[0, 900], [1600, 0], [NaN, 900], [-4, 4], [Infinity, 1]]) post.setSize(width, height);
        expect(post.uAspect.value).toBeCloseTo(16 / 9);
    });

    it('disposes once and goes inert', () => {
        const { post, renderer } = create('High');
        const pipelineDispose = vi.spyOn(post.pipeline, 'dispose');
        post.dispose();
        post.dispose();
        expect(pipelineDispose).toHaveBeenCalledOnce();
        expect(post.pipeline).toBeNull();
        expect(post.renderer).toBeNull();
        expect(() => post.update({ energy: 1 })).not.toThrow();
        expect(() => post.render()).not.toThrow();
        expect(() => post.setSize(10, 10)).not.toThrow();
        expect(renderer.render).not.toHaveBeenCalled();
    });

    it('treats an unknown tier as High', () => {
        const { post } = create('Cinematic');
        expect(post.disabled).toBe(false);
        expect(post.resolutionScale).toBe(QUALITY_PRESETS.High.bloomScale);
    });
});

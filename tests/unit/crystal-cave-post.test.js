import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { CrystalCavePost } from '../../src/themes/crystal-cave/crystal-cave-post.js';

const instances = [];

function create(quality = 'High') {
    const renderer = {
        toneMapping: THREE.NoToneMapping,
        toneMappingExposure: 1.7,
        outputColorSpace: THREE.SRGBColorSpace,
        render: vi.fn(),
    };
    const post = new CrystalCavePost({
        renderer, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), quality,
    });
    instances.push(post);
    return { renderer, post };
}

afterEach(() => {
    instances.splice(0).forEach((post) => post.dispose());
});

describe('Crystal Cave bounded event grade', () => {
    it('makes a small lock response visible without changing exposure or the bloom threshold', () => {
        const { post } = create();
        post.update({ energy: 0.18, resonance: 0.1 });
        const diagnostics = post.getDiagnostics();
        expect(diagnostics.bloomStrength).toBeGreaterThan(0.25);
        expect(diagnostics.bloomStrength).toBeLessThan(0.34);
        expect(diagnostics.reaction).toBeGreaterThan(0);
        expect(diagnostics.exposure).toBe(0.95);
        expect(diagnostics.bloomThreshold).toBe(0.85);
    });

    it.each([
        null,
        {},
        { energy: Infinity, resonance: NaN },
        { energy: -100, resonance: -1 },
        { energy: '9', resonance: true },
        { energy: 1e12, resonance: 99 },
    ])('keeps invalid and extreme response %j finite and bounded', (frame) => {
        const { post } = create();
        post.update(frame);
        const diagnostics = post.getDiagnostics();
        expect(Number.isFinite(diagnostics.reaction)).toBe(true);
        expect(diagnostics.reaction).toBeGreaterThanOrEqual(0);
        expect(diagnostics.reaction).toBeLessThanOrEqual(1);
        expect(diagnostics.bloomStrength).toBeGreaterThanOrEqual(0.23);
        expect(diagnostics.bloomStrength).toBeLessThanOrEqual(0.34);
        expect(diagnostics.exposure).toBe(0.95);
    });

    it('returns to the original idle grade after a maximum combo', () => {
        const { post } = create();
        const idle = post.getDiagnostics();
        post.update({ energy: 1, resonance: 1 });
        expect(post.getDiagnostics().bloomStrength).toBeCloseTo(0.34);
        post.update({ energy: 0, resonance: 0 });
        expect(post.getDiagnostics()).toEqual(idle);
    });

    it.each(['Low', 'Minimal'])('keeps %s direct rendering independent of event intensity', (quality) => {
        const { renderer, post } = create(quality);
        post.update({ energy: 1, resonance: 1 });
        expect(post.pipeline).toBeNull();
        expect(post.scenePass).toBeNull();
        expect(post.bloomNode).toBeNull();
        renderer.render.mockImplementation(() => {
            expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
            expect(renderer.toneMappingExposure).toBe(0.95);
        });
        post.render();
        expect(renderer.render).toHaveBeenCalledExactlyOnceWith(post.scene, post.camera);
        expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
        expect(renderer.toneMappingExposure).toBe(1.7);
        expect(post.getDiagnostics().bloomStrength).toBe(0);
    });
});

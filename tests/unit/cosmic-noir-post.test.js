import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Scene } from 'three/webgpu';
import { CosmicNoirPost } from '../../src/themes/cosmic-noir/cosmic-noir-post.js';

describe('Cosmic Noir r186 bloom sizing', () => {
    it('preserves the bloom footprint when the adaptive scale changes', () => {
        const post = new CosmicNoirPost({}, new Scene(), new PerspectiveCamera(), {
            useMRT: false,
            bloomDownsample: 0.65,
        });
        try {
            post.bloomNode.setup({ getSharedContext: () => ({}) });
            // Exercise the real r186 BloomNode API, including physical target sizing.
            post.bloomNode.setSize(1280, 800);
            expect(post.bloomNode._renderTargetBright.width).toBe(416);
            expect(post.bloomNode._renderTargetBright.height).toBe(260);
            post.update({ bloomDownsample: 0.55 });
            post.bloomNode.setSize(1280, 800);
            expect(post.bloomNode._renderTargetBright.width).toBe(352);
            expect(post.bloomNode._renderTargetBright.height).toBe(220);
            expect(Object.hasOwn(post.bloomNode, 'setSize')).toBe(false);
        } finally {
            post.dispose();
        }
    });
});

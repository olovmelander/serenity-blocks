import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { sceneSamples } from '../../src/themes/shared/scene-antialias.js';
import { FallPost } from '../../src/themes/fall/fall-post.js';
import { ForestPost } from '../../src/themes/forest/forest-post.js';
import { GoldenForestPost } from '../../src/themes/golden-forest/golden-forest-post.js';
import { SakuraPost } from '../../src/themes/sakura-twilight/sakura-post.js';
import { SummerPost } from '../../src/themes/summer/summer-post.js';
import { VerdantHillsPost } from '../../src/themes/verdant-hills/verdant-hills-post.js';

const TIERS = ['Extreme', 'Ultra', 'High', 'Medium', 'Low', 'Minimal'];
const POSTS = {
    fall: FallPost,
    forest: ForestPost,
    'golden-forest': GoldenForestPost,
    'sakura-twilight': SakuraPost,
    summer: SummerPost,
    'verdant-hills': VerdantHillsPost,
};
const owned = [];

afterEach(() => {
    while (owned.length) owned.pop().dispose();
});

function fakeRenderer() {
    return {
        toneMapping: THREE.NoToneMapping,
        toneMappingExposure: 1,
        outputColorSpace: THREE.SRGBColorSpace,
        render: vi.fn(),
    };
}

/** The node a pipeline outputs, unwrapped from TSL's proxy: its class's type name. */
const nodeType = (node) => node?.constructor?.type ?? null;

describe('scene-pass antialiasing tiers', () => {
    it('multisamples the scene pass 4× from High up, and only with the game\'s antialiasing on', () => {
        expect(TIERS.map((tier) => sceneSamples(tier))).toEqual([4, 4, 4, 0, 0, 0]);
        expect(TIERS.map((tier) => sceneSamples(tier, false))).toEqual([0, 0, 0, 0, 0, 0]);
        // Anything that is not a tier name (an inherited key included) is single-sampled.
        expect(sceneSamples('Potato')).toBe(0);
        expect(sceneSamples('constructor')).toBe(0);
        expect(sceneSamples(undefined)).toBe(0);
    });
});

describe.each(Object.entries(POSTS))('%s lens antialiasing', (id, Post) => {
    const create = (quality, samples) => {
        const post = new Post({
            renderer: fakeRenderer(), scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), quality, samples,
        });
        owned.push(post);
        return post;
    };

    it.each(['Extreme', 'Ultra', 'High'])('draws a 4× MSAA scene pass at %s with no FXAA over it', (quality) => {
        const post = create(quality, sceneSamples(quality));
        expect(post.samples).toBe(4);
        expect(post.scenePass.options.samples).toBe(4);
        expect(nodeType(post.pipeline.outputNode)).not.toBe('FXAANode');
    });

    it('keeps FXAA on a single-sampled pass (Medium, or antialiasing off)', () => {
        for (const [quality, samples] of [['Medium', sceneSamples('Medium')], ['High', sceneSamples('High', false)]]) {
            const post = create(quality, samples);
            expect(post.samples, `${id} ${quality}`).toBe(0);
            expect(post.scenePass.options.samples).toBe(0);
            expect(nodeType(post.pipeline.outputNode)).toBe('FXAANode');
        }
    });

    it('builds no pass at Low and Minimal, whatever it is handed (the canvas draws them)', () => {
        for (const quality of ['Low', 'Minimal']) {
            const post = create(quality, 4);
            expect(post.disabled).toBe(true);
            expect(post.samples).toBe(0);
            expect(post.scenePass ?? null).toBeNull();
        }
    });
});

import {
    describe, expect, it, vi,
} from 'vitest';
import { loadDeepOceanMantas } from './deep-ocean-manta.js';

// A GLB that never lands: what the creatures draw before their model arrives is all there is.
vi.mock('./shared/odyssey-gltf-loader.js', () => ({
    loadOdysseyGltfCached: () => new Promise(() => {}),
}));
vi.mock('./shared/chapter-02-creature-assets.js', () => ({
    hasChapter2CreatureAssets: () => true,
    getChapter2CreatureAssetById: (id) => ({ id, url: `/${id}.glb` }),
}));

describe('the deep ocean\'s manta and whale', () => {
    it('draw their seats while the chapter is built, before their GLBs land', () => {
        // A random angle round the corridor each. Drawn when the GLB landed, it fell outside a
        // build whose randomness is seeded (the playground's captures), which then seated them
        // differently every time.
        const sample = vi.fn(() => ({ x: 0, y: 0, z: 0 }));
        loadDeepOceanMantas({ userData: {} }, {}, { ok: true, sample });
        expect(sample).toHaveBeenCalledTimes(2);
    });
});

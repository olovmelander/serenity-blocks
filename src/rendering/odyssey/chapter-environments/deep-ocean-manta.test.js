import {
    describe, expect, it, vi,
} from 'vitest';
import { loadDeepOceanMantas } from './deep-ocean-manta.js';

// A GLB that never lands: what the creatures draw before their model arrives is all there is.
vi.mock('./shared/odyssey-gltf-loader.js', () => ({
    loadOdysseyGltfCached: () => new Promise(() => {}),
}));
const requested = vi.hoisted(() => []);
vi.mock('./shared/chapter-02-creature-assets.js', () => ({
    hasChapter2CreatureAssets: () => true,
    getChapter2CreatureAssetById: (id) => {
        requested.push(id);
        return { id, url: `/${id}.glb` };
    },
}));

describe('the deep ocean diorama\'s GLB whale', () => {
    it('draws its seat while the chapter is built, before its GLB lands', () => {
        // A random angle round the corridor. Drawn when the GLB landed, it fell outside a build
        // whose randomness is seeded (the playground's captures), which then seated it
        // differently every time.
        const sample = vi.fn(() => ({ x: 0, y: 0, z: 0 }));
        loadDeepOceanMantas({ userData: {} }, {}, { ok: true, sample });
        expect(sample).toHaveBeenCalledTimes(1);
    });

    it('asks only for the humpback: the old hero-manta GLB is gone', () => {
        requested.length = 0;
        loadDeepOceanMantas({ userData: {} }, {}, { ok: false });
        expect(requested).toEqual(['humpback-swim']);
    });
});

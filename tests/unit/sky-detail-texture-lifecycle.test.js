import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { createSkyDetailTexture } from '../../src/themes/sky-children-v2/rendering/detail-texture.js';

const loader = vi.hoisted(() => ({ loads: [] }));
vi.mock('three', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        TextureLoader: class {
            load(url, success, progress, failure) { loader.loads.push({ url, success, failure }); }
        },
    };
});
beforeEach(() => {
    loader.loads.length = 0;
    vi.stubGlobal('document', {
        createElement: () => ({
            width: 0, height: 0, getContext: () => ({ fillRect: vi.fn() }),
        }),
    });
});
afterEach(() => vi.unstubAllGlobals());

describe('Sky Children WebGL2 asynchronous texture sizes', () => {
    it('releases placeholder GPU storage before replacing its image without retiring the live texture', () => {
        const texture = createSkyDetailTexture('grass.jpg');
        const placeholder = texture.image;
        const releasedImages = [];
        texture.addEventListener('dispose', () => releasedImages.push(texture.image));
        const loaded = { image: { width: 1024, height: 1024 }, dispose: vi.fn() };
        loader.loads[0].success(loaded);
        expect(releasedImages).toEqual([placeholder]);
        expect(texture.image).toBe(loaded.image);
        expect(texture.userData.lifecycleDisposed).toBe(false);
        expect(loaded.dispose).toHaveBeenCalledOnce();
        texture.dispose();
        expect(texture.userData.lifecycleDisposed).toBe(true);
    });

    it('rejects late image loads after the theme retires the texture', () => {
        const texture = createSkyDetailTexture('grass.jpg');
        const placeholder = texture.image;
        texture.dispose();
        const loaded = { image: { width: 1024, height: 1024 }, dispose: vi.fn() };
        loader.loads[0].success(loaded);
        expect(texture.image).toBe(placeholder);
        expect(texture.userData.lifecycleDisposed).toBe(true);
        expect(loaded.dispose).toHaveBeenCalledOnce();
    });
});

import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { createWinterSnowDetail } from '../../src/themes/winter/rendering/snow-detail.js';

const loads = vi.hoisted(() => []);
vi.mock('three', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        TextureLoader: class {
            load(url, callback) { loads.push({ url, callback }); }
        },
    };
});

beforeEach(() => {
    loads.length = 0;
    vi.stubGlobal('document', {
        createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillRect: vi.fn() }) }),
    });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('Winter snow image ownership', () => {
    it('releases the immutable placeholder allocation before publishing the full image', () => {
        const { diff } = createWinterSnowDetail();
        const releasedWidths = [];
        diff.addEventListener('dispose', () => { releasedWidths.push(diff.image.width); });
        const loaded = { image: { width: 1024, height: 1024 }, dispose: vi.fn() };

        loads[0].callback(loaded);

        expect(releasedWidths).toEqual([2]);
        expect(diff.image).toBe(loaded.image);
        expect(diff.userData.lifecycleDisposed).toBe(false);
        expect(loaded.dispose).toHaveBeenCalledOnce();
        diff.dispose();
        expect(diff.userData.lifecycleDisposed).toBe(true);
    });

    it('does not revive a released theme when an image finishes loading later', () => {
        const { nor } = createWinterSnowDetail();
        const placeholder = nor.image;
        nor.dispose();
        const loaded = { image: { width: 1024, height: 1024 }, dispose: vi.fn() };

        loads[1].callback(loaded);

        expect(nor.image).toBe(placeholder);
        expect(nor.userData.lifecycleDisposed).toBe(true);
        expect(loaded.dispose).toHaveBeenCalledOnce();
    });
});

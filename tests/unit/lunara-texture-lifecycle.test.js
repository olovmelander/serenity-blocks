import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three';
import {
    createLunaraDetailTextureSet, disposeLunaraDetailTextureSet,
} from '../../src/themes/lunara/lunara-assets.js';

let loads;
let textureSet;
beforeEach(() => {
    loads = [];
    vi.stubGlobal('document', {
        createElement: () => ({ width: 0, height: 0, getContext: () => null }),
    });
    vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation((url, success, _progress, fail) => {
        loads.push({ url, success, fail });
    });
    textureSet = createLunaraDetailTextureSet();
});
afterEach(() => {
    disposeLunaraDetailTextureSet(textureSet);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('Lunara detail texture replacement', () => {
    it('retires placeholder GPU storage before replacing image dimensions', () => {
        const texture = textureSet.ground.detail;
        const observed = [];
        texture.addEventListener('dispose', () => {
            observed.push({ width: texture.image.width, disposed: texture.userData.lifecycleDisposed });
        });
        const image = { width: 1024, height: 1024 };
        const loaded = new THREE.Texture(image);
        const disposeLoaded = vi.spyOn(loaded, 'dispose');
        loads[0].success(loaded);
        expect(observed).toEqual([{ width: 2, disposed: false }]);
        expect(textureSet.ground.detail).toBe(texture);
        expect(texture.image).toBe(image);
        expect(texture.userData.lifecycleDisposed).toBe(false);
        expect(texture.repeat.toArray()).toEqual([14, 14]);
        expect(disposeLoaded).toHaveBeenCalledOnce();
        texture.dispose();
        expect(texture.userData.lifecycleDisposed).toBe(true);
    });

    it('rejects late successful and failed loads after external disposal', () => {
        const texture = textureSet.ground.detail;
        const placeholder = texture.image;
        texture.dispose();
        const loaded = new THREE.Texture({ width: 1024, height: 1024 });
        const disposeLoaded = vi.spyOn(loaded, 'dispose');
        loads[0].success(loaded);
        loads[0].fail();
        expect(texture.image).toBe(placeholder);
        expect(texture.userData.lifecycleDisposed).toBe(true);
        expect(disposeLoaded).toHaveBeenCalledOnce();
    });
});

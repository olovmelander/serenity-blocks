/* eslint-disable max-classes-per-file */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

const state = vi.hoisted(() => ({ decoders: [] }));
vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
    GLTFLoader: class {
        setDRACOLoader() {}

        loadAsync() { return new Promise(() => {}); }
    },
}));
vi.mock('three/addons/loaders/DRACOLoader.js', () => ({
    DRACOLoader: class {
        constructor() {
            this.dispose = vi.fn();
            this.setDecoderPath = vi.fn();
            state.decoders.push(this);
        }
    },
}));

afterEach(() => {
    state.decoders.length = 0;
    vi.unstubAllEnvs();
    vi.resetModules();
});

describe('Koi Pond self-hosted Draco decoder', () => {
    it.each(['/', '/serenity-blocks/'])('loads the decoder beneath the configured %s base', async (base) => {
        vi.stubEnv('BASE_URL', base);
        const { createKoiPondForest } = await import('../../src/themes/koi-pond/rendering/koi-pond-forest.js');
        const forest = createKoiPondForest({
            scene: new THREE.Scene(), uTime: uniform(0), uMotion: uniform(0),
        });
        expect(state.decoders[0].setDecoderPath).toHaveBeenCalledWith(`${base}assets/vendor/draco/`);
        forest.dispose();
        expect(state.decoders[0].dispose).toHaveBeenCalledOnce();
    });

    it('ships the matching pinned wrapper, wasm and JavaScript fallback with the license', () => {
        for (const name of ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js']) {
            const bundled = readFileSync(new URL(`../../public/assets/vendor/draco/${name}`, import.meta.url));
            const pinned = readFileSync(new URL(`../../node_modules/three/examples/jsm/libs/draco/gltf/${name}`, import.meta.url));
            expect(bundled.equals(pinned)).toBe(true);
        }
        const wasm = readFileSync(new URL('../../public/assets/vendor/draco/draco_decoder.wasm', import.meta.url));
        expect([...wasm.subarray(0, 4)]).toEqual([0, 97, 115, 109]);
        const license = readFileSync(new URL('../../public/assets/vendor/draco/LICENSE', import.meta.url), 'utf8');
        expect(license).toContain('Apache License');
        expect(license).toContain('Version 2.0');
    });
});

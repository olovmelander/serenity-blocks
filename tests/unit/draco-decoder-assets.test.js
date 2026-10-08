import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The decoder files under public/assets/vendor/draco/ are still distributed. This pin used to
 * live in koi-pond-decoder-assets.test.js beside the first Koi Pond theme's loader test; that
 * theme (their only reader) is gone, the files are not.
 */
describe('self-hosted Draco decoder', () => {
    it('ships the matching pinned wrapper, wasm and JavaScript fallback with the license', () => {
        const packaged = '../../node_modules/three/examples/jsm/libs/draco/gltf';
        for (const name of ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js']) {
            const bundled = readFileSync(new URL(`../../public/assets/vendor/draco/${name}`, import.meta.url));
            const pinned = readFileSync(new URL(`${packaged}/${name}`, import.meta.url));
            expect(bundled.equals(pinned)).toBe(true);
        }
        const wasm = readFileSync(new URL('../../public/assets/vendor/draco/draco_decoder.wasm', import.meta.url));
        expect([...wasm.subarray(0, 4)]).toEqual([0, 97, 115, 109]);
        const license = readFileSync(new URL('../../public/assets/vendor/draco/LICENSE', import.meta.url), 'utf8');
        expect(license).toContain('Apache License');
        expect(license).toContain('Version 2.0');
    });
});

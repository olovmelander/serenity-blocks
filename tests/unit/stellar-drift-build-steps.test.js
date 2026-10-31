/**
 * Stellar Drift builds its first visit in steps (2026-10-31): the fBm's mip chain a row at a time
 * with the bit-identical rendering/half-float.js `halfBits`, and the world a few parts to a
 * breath. What is built must not change, however the slices fall.
 */
import {
    describe, expect, it, vi,
} from 'vitest';
import { createHash } from 'node:crypto';
import * as THREE from 'three/webgpu';
import { StellarDriftWorld } from '../../src/themes/stellar-drift/stellar-drift-world.js';
import {
    bakeFbm, createFbmTexture, createFbmTextureSteps,
} from '../../src/themes/stellar-drift/stellar-drift-tsl.js';

/** The fBm's mip chain as it was made before 2026-10-31 (three's toHalfFloat, value by value). */
function mipsBefore(field, size) {
    const mipmaps = [];
    let level = field;
    let w = size;
    for (;;) {
        const half = new Uint16Array(level.length);
        for (let i = 0; i < level.length; i++) half[i] = THREE.DataUtils.toHalfFloat(level[i]);
        mipmaps.push({ data: half, width: w, height: w });
        if (w === 1) break;
        const nw = w >> 1;
        const next = new Float32Array(nw * nw * 4);
        for (let y = 0; y < nw; y++) {
            for (let x = 0; x < nw; x++) {
                const a = (y * 2 * w + x * 2) * 4;
                const b2 = a + 4;
                const c2 = a + w * 4;
                const d2 = c2 + 4;
                const o = (y * nw + x) * 4;
                for (let c = 0; c < 4; c++) {
                    next[o + c] = (level[a + c] + level[b2 + c] + level[c2 + c] + level[d2 + c]) * 0.25;
                }
            }
        }
        level = next;
        w = nw;
    }
    return mipmaps;
}

/** Every array a world built, in scene order: names, geometry, instance matrices, textures. */
function fingerprint(world) {
    const hash = createHash('sha256');
    const bytes = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    world.root.traverse((o) => {
        hash.update(`${o.type}|${o.name}|${o.renderOrder}|${o.layers.mask}|`);
        if (o.geometry) {
            for (const [name, attribute] of Object.entries(o.geometry.attributes)) {
                hash.update(name);
                hash.update(bytes(attribute.isInterleavedBufferAttribute ? attribute.data.array : attribute.array));
            }
            if (o.geometry.index) hash.update(bytes(o.geometry.index.array));
        }
        if (o.isInstancedMesh) hash.update(bytes(o.instanceMatrix.array));
    });
    world.textures.forEach((t) => {
        if (t.image?.data) hash.update(bytes(t.image.data));
        (t.mipmaps || []).forEach((m) => hash.update(bytes(m.data)));
    });
    return hash.digest('hex');
}

/** Run steps on a clock that is always due, so every slice breathes; returns [steps, value]. */
function runEveryBreath(steps) {
    let t = 0;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => {
        t += 50;
        return t;
    });
    try {
        let count = 0;
        let next = steps.next();
        while (!next.done) {
            count += 1;
            next = steps.next();
        }
        return [count, next.value];
    } finally {
        now.mockRestore();
    }
}

describe('Stellar Drift first build in steps', () => {
    it('derives the fBm\'s mip chain bit for bit as before, at once or in slices, and once a field', () => {
        const size = 128;
        // Copies: fields of their own, so each chain is derived here and not taken from the cache.
        const whole = new Float32Array(bakeFbm(4242, size, 4));
        whole[3] = 1e6; // past the half floats' range: the same clamp
        whole[7] = Number.NaN;
        const parts = new Float32Array(whole);
        const want = mipsBefore(whole, size);
        const once = createFbmTexture(whole, size);
        const [count, sliced] = runEveryBreath(createFbmTextureSteps(parts, size));
        // A yield at every row of every level, converted and filtered.
        expect(count).toBeGreaterThan(2 * size);
        for (const tex of [once, sliced]) {
            expect(tex.mipmaps.map((m) => [m.width, m.height])).toEqual(want.map((m) => [m.width, m.height]));
            tex.mipmaps.forEach((m, i) => expect(m.data, `level ${i}`).toEqual(want[i].data));
        }
        // A second texture of a field shares the chain already derived, made at once.
        const [again, reused] = runEveryBreath(createFbmTextureSteps(parts, size));
        expect(again).toBe(0);
        reused.mipmaps.forEach((m, i) => expect(m.data).toBe(sliced.mipmaps[i].data));
        [once, sliced, reused].forEach((tex) => tex.dispose());
    });

    it('builds the same world a few parts to a step as its build() makes', () => {
        // The first world here of its tier: its fBm's chain is derived in the steps.
        const sliced = new StellarDriftWorld({ scene: new THREE.Scene(), quality: 'Extreme', capture: true });
        const [count, built] = runEveryBreath(sliced.buildSteps());
        expect(built).toBe(sliced);
        expect(count).toBeGreaterThan(100);
        const once = new StellarDriftWorld({ scene: new THREE.Scene(), quality: 'Extreme', capture: true }).build();
        expect(Object.keys(sliced.parts)).toEqual(Object.keys(once.parts));
        expect(fingerprint(sliced)).toBe(fingerprint(once));
        once.dispose();
        sliced.dispose();
    });
});

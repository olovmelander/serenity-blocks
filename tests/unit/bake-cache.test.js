import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import {
    bakeCacheStats, bakeOnce, derivedOnce, resetBakeCache,
} from '../../src/themes/shared/bake-cache.js';

afterEach(() => resetBakeCache());

describe('the shared bake cache', () => {
    it('bakes once per key and hands the same result back', () => {
        const make = vi.fn(() => new Float32Array(16));
        const a = bakeOnce('theme:noise:1:4', make);
        const b = bakeOnce('theme:noise:1:4', make);
        expect(b).toBe(a);
        expect(make).toHaveBeenCalledOnce();
        // Another argument is another bake.
        expect(bakeOnce('theme:noise:2:4', make)).not.toBe(a);
        expect(make).toHaveBeenCalledTimes(2);
        expect(bakeCacheStats()).toMatchObject({ entries: 2, bytes: 128 });
    });

    it('counts the bytes of arrays and objects of typed arrays', () => {
        bakeOnce('a', () => ({ data: new Uint8Array(10), mips: [new Uint16Array(4), new Uint16Array(2)] }));
        expect(bakeCacheStats().bytes).toBe(10 + 8 + 4);
    });

    it('lets the least recently used bakes go past its budget', () => {
        resetBakeCache({ budget: 300 });
        bakeOnce('a', () => new Uint8Array(100));
        bakeOnce('b', () => new Uint8Array(100));
        bakeOnce('a', () => new Uint8Array(100)); // a is now the most recent
        bakeOnce('c', () => new Uint8Array(150)); // over budget: b goes, a stays
        const remake = vi.fn(() => new Uint8Array(100));
        bakeOnce('a', remake);
        expect(remake).not.toHaveBeenCalled();
        bakeOnce('b', remake);
        expect(remake).toHaveBeenCalledOnce();
        expect(bakeCacheStats().bytes).toBeLessThanOrEqual(300);
    });

    it('keeps a single bake larger than the whole budget until the next one arrives', () => {
        resetBakeCache({ budget: 50 });
        const big = bakeOnce('big', () => new Uint8Array(80));
        expect(bakeOnce('big', () => new Uint8Array(80))).toBe(big);
        bakeOnce('next', () => new Uint8Array(10));
        expect(bakeCacheStats().entries).toBe(1);
    });

    it('derives from a cached bake once per source and tag', () => {
        const source = bakeOnce('field', () => new Float32Array(8));
        const make = vi.fn((field) => new Uint16Array(field.length));
        const mips = derivedOnce(source, 'half', make);
        expect(derivedOnce(source, 'half', make)).toBe(mips);
        expect(make).toHaveBeenCalledOnce();
        expect(make).toHaveBeenCalledWith(source);
        derivedOnce(source, 'bytes', make);
        derivedOnce(new Float32Array(8), 'half', make);
        expect(make).toHaveBeenCalledTimes(3);
    });
});

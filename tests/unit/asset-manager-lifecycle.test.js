import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { AssetManager } from '../../src/utils/asset-manager.js';

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

describe('asset cache lifecycle', () => {
    beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); });
    afterEach(() => { vi.restoreAllMocks(); });

    it('does not repopulate the cache when a load finishes after clear', async () => {
        const manager = new AssetManager();
        const request = deferred();
        vi.spyOn(manager, 'loadAsset').mockReturnValue(request.promise);
        const loading = manager.load('old.txt', 'text');
        manager.clear();
        request.resolve('old');
        await expect(loading).resolves.toBe('old');
        expect(manager.has('old.txt')).toBe(false);
        expect(manager.cacheOrder).toEqual([]);
        expect(manager.metadata.size).toBe(0);
    });

    it('keeps a replacement request tracked when an older cleared request finishes', async () => {
        const manager = new AssetManager();
        const first = deferred();
        const second = deferred();
        const loader = vi.spyOn(manager, 'loadAsset')
            .mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const old = manager.load('same.txt', 'text');
        manager.clear();
        const replacement = manager.load('same.txt', 'text');
        first.resolve('old');
        await old;
        const deduplicated = manager.load('same.txt', 'text');
        expect(loader).toHaveBeenCalledTimes(2);
        second.resolve('new');
        await expect(replacement).resolves.toBe('new');
        await expect(deduplicated).resolves.toBe('new');
        expect(manager.get('same.txt')).toBe('new');
        expect(manager.cacheOrder).toEqual(['same.txt']);
        expect(manager.loading.size).toBe(0);
    });

    it.each(['', 0, false, null])('removes a cached falsy value (%s) and its metadata', async (value) => {
        const manager = new AssetManager();
        vi.spyOn(manager, 'loadAsset').mockResolvedValue(value);
        await manager.load('empty.json', 'json');
        manager.remove('empty.json');
        expect(manager.has('empty.json')).toBe(false);
        expect(manager.metadata.size).toBe(0);
        expect(manager.cacheOrder).toEqual([]);
    });

    it('does not retain a load removed before it finishes', async () => {
        const manager = new AssetManager();
        const request = deferred();
        vi.spyOn(manager, 'loadAsset').mockReturnValue(request.promise);
        const loading = manager.load('removed.txt', 'text');
        manager.remove('removed.txt');
        request.resolve('old');
        await loading;
        expect(manager.has('removed.txt')).toBe(false);
        expect(manager.loading.size).toBe(0);
    });
});

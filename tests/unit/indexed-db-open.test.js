import { describe, expect, it, vi } from 'vitest';
import { openDatabaseOnce } from '../../src/utils/indexed-db-open.js';

/** An IndexedDB factory whose open requests the test answers by hand. */
function fakeFactory() {
    const requests = [];
    return {
        requests,
        open: vi.fn(() => {
            const db = { close: vi.fn(), onversionchange: null };
            const request = { result: db, error: null };
            requests.push(request);
            return request;
        }),
    };
}

const options = (indexedDB) => ({
    name: 'SerenityBlocksDB', version: 2, upgrade: vi.fn(), indexedDB,
});

describe('openDatabaseOnce (the high scores and the demos)', () => {
    it('opens one connection for callers arriving together, and none once it is open', async () => {
        const factory = fakeFactory();
        const owner = { db: null };
        const first = openDatabaseOnce(owner, options(factory));
        const second = openDatabaseOnce(owner, options(factory));
        factory.requests[0].onsuccess();
        await Promise.all([first, second]);
        expect(factory.open).toHaveBeenCalledOnce();
        await openDatabaseOnce(owner, options(factory));
        expect(factory.open).toHaveBeenCalledOnce();
        expect(owner.db).toBe(factory.requests[0].result);
    });

    it('closes for a newer version of the game in another tab, and opens again when needed', async () => {
        const factory = fakeFactory();
        const owner = { db: null };
        const opening = openDatabaseOnce(owner, options(factory));
        factory.requests[0].onsuccess();
        await opening;
        const db = owner.db;
        db.onversionchange();
        expect(db.close).toHaveBeenCalledOnce();
        expect(owner.db).toBeNull();
        const reopening = openDatabaseOnce(owner, options(factory));
        expect(factory.open).toHaveBeenCalledTimes(2);
        factory.requests[1].onsuccess();
        await reopening;
    });

    it('fails instead of waiting forever when another tab blocks it, and closes a late success', async () => {
        const factory = fakeFactory();
        const owner = { db: null };
        const opening = openDatabaseOnce(owner, options(factory));
        factory.requests[0].onblocked();
        await expect(opening).rejects.toThrow('blocked');
        factory.requests[0].onsuccess(); // the other tab let go afterwards
        expect(factory.requests[0].result.close).toHaveBeenCalledOnce();
        expect(owner.db).toBeNull();
        // The next caller tries again.
        const retry = openDatabaseOnce(owner, options(factory));
        factory.requests[1].onsuccess();
        await retry;
        expect(owner.db).toBe(factory.requests[1].result);
    });

    it('passes an open error on and lets the next caller try again', async () => {
        const factory = fakeFactory();
        const owner = { db: null };
        const opening = openDatabaseOnce(owner, options(factory));
        factory.requests[0].error = new Error('VersionError');
        factory.requests[0].onerror();
        await expect(opening).rejects.toThrow('VersionError');
        openDatabaseOnce(owner, options(factory));
        expect(factory.open).toHaveBeenCalledTimes(2);
    });
});

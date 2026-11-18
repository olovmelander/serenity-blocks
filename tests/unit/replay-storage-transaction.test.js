import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { DemoManager, MAX_STORED_DEMOS } from '../../src/core/demo/DemoManager.js';
import { setImmediate } from 'node:timers/promises';

function harness() {
    const request = {};
    const countRequest = {};
    const cursorRequest = {};
    const store = {
        add: vi.fn(() => request),
        delete: vi.fn(() => request),
        count: vi.fn(() => countRequest),
        openCursor: vi.fn(() => cursorRequest),
    };
    const transaction = { objectStore: () => store, error: null };
    const manager = new DemoManager();
    manager.db = { transaction: vi.fn(() => transaction) };
    return {
        manager, transaction, request, countRequest, cursorRequest,
    };
}

afterEach(() => vi.restoreAllMocks());

describe('replay storage durability', () => {
    it('returns a replay ID and starts pruning only after the save commits', async () => {
        const h = harness();
        const prune = vi.spyOn(h.manager, '_pruneOldDemos').mockResolvedValue();
        let settled = false;
        const pending = h.manager.saveDemo({ timestamp: 1, inputs: [] }).then((id) => { settled = true; return id; });
        h.request.result = 7;
        h.request.onsuccess();
        await Promise.resolve();
        expect(prune).not.toHaveBeenCalled();
        expect(settled).toBe(false);
        h.transaction.oncomplete();
        await expect(pending).resolves.toBe(7);
        expect(prune).toHaveBeenCalledOnce();
    });

    it('rejects a save that aborts after its add request succeeded', async () => {
        const h = harness();
        const prune = vi.spyOn(h.manager, '_pruneOldDemos').mockResolvedValue();
        const pending = h.manager.saveDemo({ timestamp: 1, inputs: [] });
        h.request.result = 7;
        h.request.onsuccess();
        h.transaction.error = new DOMException('Disk full', 'QuotaExceededError');
        h.transaction.onabort?.();
        await expect(pending).rejects.toMatchObject({ name: 'QuotaExceededError' });
        expect(prune).not.toHaveBeenCalled();
    });

    it('retains a successful save when a later best-effort prune fails', async () => {
        const h = harness();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(h.manager, '_pruneOldDemos').mockRejectedValue(new Error('Prune failed'));
        const pending = h.manager.saveDemo({ timestamp: 1, inputs: [] });
        h.request.result = 7;
        h.request.onsuccess();
        h.transaction.oncomplete?.();
        await expect(pending).resolves.toBe(7);
    });

    it('reports deletion only after the transaction commits', async () => {
        const h = harness();
        let settled = false;
        const pending = h.manager.deleteDemo(7).then(() => { settled = true; });
        h.request.onsuccess?.();
        await setImmediate();
        expect(settled).toBe(false);
        h.transaction.oncomplete();
        await expect(pending).resolves.toBeUndefined();
    });

    it('rejects a deletion that rolls back after its request succeeded', async () => {
        const h = harness();
        const pending = h.manager.deleteDemo(7);
        h.request.onsuccess?.();
        h.transaction.error = new Error('Deletion rolled back');
        h.transaction.onabort?.();
        await expect(pending).rejects.toThrow('Deletion rolled back');
    });

    it('waits for retention deletes to commit and reports an aborted prune', async () => {
        const h = harness();
        let settled = false;
        const pending = h.manager._pruneOldDemos().then(() => { settled = true; });
        h.countRequest.result = MAX_STORED_DEMOS + 1;
        h.countRequest.onsuccess();
        const cursor = { delete: vi.fn(), continue: vi.fn() };
        h.cursorRequest.result = cursor;
        h.cursorRequest.onsuccess();
        expect(cursor.delete).toHaveBeenCalledOnce();
        h.cursorRequest.result = null;
        h.cursorRequest.onsuccess();
        await setImmediate();
        expect(settled).toBe(false);
        h.transaction.error = new Error('Prune rolled back');
        h.transaction.onabort();
        await expect(pending).rejects.toThrow('Prune rolled back');
    });
});

/**
 * An in-memory replay database: one autoIncrement store keyed on `id`, its
 * timestamp index, and transactions that complete once their requests settle.
 */
function memoryReplayDb() {
    const rows = new Map();
    let nextId = 1;
    const put = (demo) => {
        const id = nextId;
        nextId += 1;
        rows.set(id, { ...structuredClone(demo), id });
        return id;
    };
    const transaction = () => {
        const tx = { error: null, oncomplete: null, onabort: null };
        let pending = 0;
        const settle = () => setTimeout(() => {
            if (pending > 0 || !tx.oncomplete) return;
            const complete = tx.oncomplete;
            tx.oncomplete = null;
            complete();
        }, 0);
        const request = (work) => {
            const req = { result: undefined, onsuccess: null, onerror: null };
            pending += 1;
            setTimeout(() => {
                req.result = work();
                req.onsuccess?.({ target: req });
                pending -= 1;
                settle();
            }, 0);
            return req;
        };
        const cursorOver = (keys) => {
            const req = { result: null, onsuccess: null, onerror: null };
            let position = 0;
            const step = () => {
                pending += 1;
                setTimeout(() => {
                    const key = keys[position];
                    position += 1;
                    req.result = key === undefined ? null : {
                        primaryKey: key,
                        value: rows.get(key),
                        delete: () => rows.delete(key),
                        continue: step,
                    };
                    req.onsuccess?.({ target: req });
                    pending -= 1;
                    settle();
                }, 0);
            };
            step();
            return req;
        };
        const keysBy = (field) => [...rows.keys()].sort((a, b) => (
            (field ? rows.get(a)[field] - rows.get(b)[field] : 0) || a - b
        ));
        tx.objectStore = () => ({
            add: (demo) => request(() => put(demo)),
            get: (id) => request(() => rows.get(id)),
            count: () => request(() => rows.size),
            openCursor: () => cursorOver(keysBy(null)),
            index: (field) => ({ openCursor: () => cursorOver(keysBy(field)) }),
        });
        return tx;
    };
    return { rows, put, transaction };
}

// Audit 2026-11-18 A18-PERS-2: re-importing a replay exported long ago.
describe('replay retention', () => {
    it('keeps an imported replay older than every stored one after the save that brought it in', async () => {
        const manager = new DemoManager();
        const db = memoryReplayDb();
        manager.db = db;
        const now = Date.parse('2026-11-18T12:00:00.000Z');
        for (let i = 0; i < MAX_STORED_DEMOS; i += 1) {
            db.put({
                version: '2.0', inputs: [], timestamp: now - (MAX_STORED_DEMOS - i) * 60_000, metadata: { finalScore: i },
            });
        }
        const exported = manager.exportToJSON({
            id: 7,
            version: '2.0',
            inputs: [{ f: 1, a: 'hardDrop' }],
            timestamp: now - 30 * 86_400_000,
            metadata: { finalScore: 99999 },
        });

        const id = await manager.saveDemo(manager.importFromJSON(exported));

        await expect(manager.loadDemo(id)).resolves.toMatchObject({ metadata: { finalScore: 99999 } });
        expect(db.rows.size).toBe(MAX_STORED_DEMOS);
        // The replay saved first makes room instead.
        expect(db.rows.has(1)).toBe(false);
    });
});

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
        index: vi.fn(() => ({ openCursor: vi.fn(() => cursorRequest) })),
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

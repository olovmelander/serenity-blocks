import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { DemoManager } from '../../src/core/demo/DemoManager.js';
import { HighScoreManager } from '../../src/ui/high-scores.js';
import { DemoBrowser } from '../../src/ui/demo-browser.js';

vi.mock('../../src/ui/intro-animation.js', () => ({ introAnimation: null }));

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function demoStore(records) {
    const request = {};
    let position = 0;
    const advance = () => queueMicrotask(() => {
        const record = records[position++];
        request.onsuccess({
            target: {
                result: record ? {
                    value: record, key: record.timestamp, primaryKey: record.id, continue: advance,
                } : null,
            },
        });
    });
    const manager = new DemoManager();
    manager.db = {
        transaction: () => ({
            objectStore: () => ({
                index: () => ({
                    openCursor: () => {
                        advance();
                        return request;
                    },
                }),
            }),
        }),
    };
    return manager;
}

function scoreStore({ failWrite = false } = {}) {
    const records = [];
    const store = {
        clear: vi.fn(),
        add: vi.fn((entry) => {
            if (failWrite) throw new DOMException('Record cannot be cloned', 'DataCloneError');
            records.push(entry);
        }),
    };
    const transaction = { objectStore: () => store, abort: vi.fn() };
    const manager = new HighScoreManager();
    manager.db = { transaction: vi.fn(() => transaction) };
    return {
        manager, transaction, store, records,
    };
}

describe('Replay menu payload ownership', () => {
    it('returns light cards by primary ID while full-list callers retain the recording API', async () => {
        const recording = {
            id: 7,
            timestamp: 123456,
            gameMode: 'single',
            metadata: { score: 42, level: 2, duration: 1000 },
            inputs: Array.from({ length: 1000 }, (_, frame) => ({ frame, action: 'left' })),
            checkpoints: [{ frame: 300, board: [[1, 2]] }],
        };
        const manager = demoStore([recording]);
        const cards = await manager.listDemos({ includeReplayData: false });
        expect(cards).toEqual([{
            id: 7, timestamp: 123456, gameMode: 'single', metadata: recording.metadata,
        }]);
        expect(cards[0]).not.toHaveProperty('inputs');
        expect(cards[0]).not.toHaveProperty('checkpoints');
        const full = await demoStore([recording]).listDemos();
        expect(full[0]).toEqual(recording);
    });

    it('loads only the requested recording when sharing a menu card', async () => {
        const full = { id: 7, inputs: [{ frame: 1 }] };
        const demoManager = { loadDemo: vi.fn(async () => full), exportToURL: vi.fn(async () => 'replay-url') };
        const writeText = vi.fn(async () => {});
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        vi.stubGlobal('alert', vi.fn());
        await DemoBrowser.prototype.shareDemo.call({ demoManager }, { id: 7, metadata: { score: 42 } });
        expect(demoManager.loadDemo).toHaveBeenCalledWith(7);
        expect(demoManager.exportToURL).toHaveBeenCalledWith(full);
        expect(writeText).toHaveBeenCalledWith('replay-url');
    });

    it('ignores a replay-menu load that finishes after close', async () => {
        let finish;
        const list = new Promise((resolve) => { finish = resolve; });
        const browser = Object.assign(Object.create(DemoBrowser.prototype), {
            refreshGeneration: 0,
            listContainer: { innerHTML: '', appendChild: vi.fn() },
            modal: { classList: { remove: vi.fn(), contains: vi.fn(() => true) } },
            demoManager: { listDemos: vi.fn(() => list) },
            createDemoCard: vi.fn(),
        });
        const pending = browser.refreshList();
        browser.hide();
        finish([{ id: 7, metadata: {} }]);
        await pending;
        expect(browser.demoManager.listDemos).toHaveBeenCalledWith({ includeReplayData: false });
        expect(browser.createDemoCard).not.toHaveBeenCalled();
        expect(browser.listContainer.appendChild).not.toHaveBeenCalled();
    });

    it('does not restart hidden list work after a delete finishes following close', async () => {
        let finish;
        const deletion = new Promise((resolve) => { finish = resolve; });
        let visible = true;
        const browser = Object.assign(Object.create(DemoBrowser.prototype), {
            refreshGeneration: 0,
            listContainer: { innerHTML: '', appendChild: vi.fn() },
            modal: {
                classList: {
                    contains: () => visible,
                    remove: () => { visible = false; },
                },
            },
            demoManager: { deleteDemo: vi.fn(() => deletion), listDemos: vi.fn() },
        });
        const pending = browser.deleteDemo(7);
        browser.hide();
        finish();
        await pending;
        expect(browser.demoManager.listDemos).not.toHaveBeenCalled();
        expect(browser.listContainer.innerHTML).toBe('');
    });
});

describe('Cloud high-score imports', () => {
    it('commits sorted, deduplicated and bounded results in one transaction', async () => {
        const h = scoreStore();
        h.manager.getTopScores = vi.fn(async () => [{
            id: 1, score: 500, lines: 2, level: 1, timestamp: 10,
        }]);
        const incoming = Array.from({ length: 105 }, (_, index) => ({
            score: index, lines: 1, level: 1, timestamp: index,
        }));
        incoming.push({
            score: 500, lines: 2, level: 1, timestamp: 10,
        });
        let settled = false;
        const pending = h.manager.importHighScores(incoming).then((count) => { settled = true; return count; });
        await Promise.resolve();
        expect(h.manager.db.transaction).toHaveBeenCalledTimes(1);
        expect(h.store.clear).toHaveBeenCalledTimes(1);
        expect(h.records).toHaveLength(100);
        expect(h.records[0].score).toBe(500);
        expect(h.records[1].score).toBe(104);
        expect(h.records.every((record) => !Object.hasOwn(record, 'id'))).toBe(true);
        expect(settled).toBe(false);
        h.transaction.oncomplete();
        await expect(pending).resolves.toBe(100);
    });

    it('aborts the replacement on a write failure and rejects transaction aborts', async () => {
        const h = scoreStore({ failWrite: true });
        await expect(h.manager.importHighScores([{ score: 1 }], { merge: false }))
            .rejects.toMatchObject({ name: 'DataCloneError' });
        expect(h.transaction.abort).toHaveBeenCalledTimes(1);
        const aborted = scoreStore();
        const pending = aborted.manager.importHighScores([], { merge: false });
        aborted.transaction.error = new Error('Disk full');
        aborted.transaction.onabort();
        await expect(pending).rejects.toThrow('Disk full');
    });
});

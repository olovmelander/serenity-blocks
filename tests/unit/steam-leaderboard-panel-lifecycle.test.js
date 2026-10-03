import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

const steam = vi.hoisted(() => ({
    getLeaderboard: vi.fn(),
    initComplete: true,
    isAvailable: vi.fn(),
    steamId: 'local-player',
    waitForInit: vi.fn(),
}));

vi.mock('../../src/core/steam/steam-service.js', () => ({ default: steam }));

import { SteamLeaderboardPanel } from '../../src/ui/components/steam-leaderboard-panel.js';

class Element {
    constructor(tagName = 'div') {
        this.tagName = tagName;
        this.children = [];
        this.dataset = {};
        this.style = {};
        this.className = '';
        this.textContent = '';
        this.listeners = new Map();
        this.classes = new Set();
        this.classList = {
            add: (...values) => values.forEach((value) => this.classes.add(value)),
            toggle: (value, enabled) => {
                if (enabled) this.classes.add(value);
                else this.classes.delete(value);
            },
        };
    }

    set innerHTML(value) {
        this.markup = value;
        this.children = [];
        if (value.includes('id="steam-leaderboard-updated"')) {
            const updated = new Element();
            updated.id = 'steam-leaderboard-updated';
            updated.textContent = '--';
            this.children.push(updated);
        }
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    addEventListener(type, handler) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(handler);
    }

    removeEventListener(type, handler) {
        this.listeners.get(type)?.delete(handler);
    }

    querySelector(selector) {
        return this.children.find((child) => `#${child.id}` === selector) || null;
    }

    querySelectorAll(selector) {
        const key = selector === '[data-board-id]' ? 'boardId' : 'viewId';
        return this.children.flatMap((child) => [
            ...(child.dataset[key] ? [child] : []),
            ...child.querySelectorAll(selector),
        ]);
    }
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

function createCache() {
    const data = new Map();
    return {
        data,
        get: vi.fn((key) => data.get(key) || null),
        set: vi.fn((key, value) => {
            data.set(key, { data: value, stale: false, ageMs: 0 });
        }),
    };
}

function createPanel(options = {}) {
    const cache = options.cache || createCache();
    const panel = new SteamLeaderboardPanel({
        boards: [
            { id: 'score', label: 'Score', name: 'score-board' },
            { id: 'lines', label: 'Lines', name: 'lines-board' },
        ],
        cache,
        ...options,
    });
    const container = new Element();
    panel.mount(container);
    return { cache, container, panel };
}

function response(name, extra = {}) {
    return {
        entries: [{ rank: 1, steamId: 'remote-player', name, score: 42 }],
        supported: true,
        ...extra,
    };
}

function textContent(element) {
    return [element?.textContent || '', ...(element?.children || []).map(textContent)].join(' ');
}

async function settle() {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

describe('Steam leaderboard request ownership', () => {
    beforeEach(() => {
        steam.getLeaderboard.mockReset();
        steam.isAvailable.mockReset().mockReturnValue(true);
        steam.waitForInit.mockReset().mockResolvedValue(undefined);
        steam.initComplete = true;
        steam.steamId = 'local-player';
        vi.stubGlobal('HTMLElement', Element);
        vi.stubGlobal('document', { createElement: (tagName) => new Element(tagName) });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('caches an older view under its captured key without replacing newer rows or status', async () => {
        const global = deferred();
        const friends = deferred();
        steam.getLeaderboard.mockImplementation((board, view) => (
            view === 'friends' ? friends.promise : global.promise
        ));
        const { cache, panel } = createPanel();
        await settle();
        panel._setView('friends');
        await settle();
        friends.resolve(response('friend', { notice: 'Friends notice' }));
        await settle();
        const currentRows = panel.listEl.children[0];
        const currentUpdated = panel.updatedEl.textContent;

        global.resolve(response('old global'));
        await settle();

        expect(steam.getLeaderboard.mock.calls).toEqual([
            ['score-board', 'global', 0, 10],
            ['score-board', 'friends', 0, 10],
        ]);
        expect(cache.data.get('score-board|global|0|10').data.entries[0].name).toBe('old global');
        expect(cache.data.get('score-board|friends|0|10').data.entries[0].name).toBe('friend');
        expect(panel.listEl.children[0]).toBe(currentRows);
        expect(textContent(panel.listEl)).toContain('friend');
        expect(textContent(panel.listEl)).not.toContain('old global');
        expect(panel.statusEl.textContent).toBe('');
        expect(panel.updatedEl.textContent).toBe(currentUpdated);
    });

    it('keeps the latest unavailable-board message when an old board completes', async () => {
        const score = deferred();
        const lines = deferred();
        steam.getLeaderboard.mockImplementation((board) => (
            board === 'lines-board' ? lines.promise : score.promise
        ));
        const { cache, panel } = createPanel();
        await settle();
        panel._setBoard('lines');
        await settle();
        lines.resolve({ supported: false, error: 'Missing lines API' });
        await settle();
        score.resolve(response('old score'));
        await settle();

        expect(panel.statusEl.textContent).toBe('Leaderboards unavailable (Steam API missing).');
        expect(panel.listEl.children).toHaveLength(0);
        expect(cache.data.get('lines-board|global|0|10').data.notice).toBe('Missing lines API');
        expect(cache.data.get('score-board|global|0|10').data.entries[0].name).toBe('old score');
    });

    it('retires old board and view loads while Steam initialization is pending', async () => {
        const init = deferred();
        let available = false;
        steam.isAvailable.mockImplementation(() => available);
        steam.initComplete = false;
        steam.waitForInit.mockReturnValue(init.promise);
        steam.getLeaderboard.mockResolvedValue(response('current'));
        const { cache, panel } = createPanel();
        panel._setBoard('lines');
        panel._setView('around_user');
        available = true;
        init.resolve();
        await settle();

        expect(steam.getLeaderboard).toHaveBeenCalledExactlyOnceWith('lines-board', 'around_user', 0, 10);
        expect(cache.set).toHaveBeenCalledOnce();
        expect(cache.set.mock.calls[0][0]).toBe('lines-board|around_user|0|10');
        expect(textContent(panel.listEl)).toContain('current');
    });

    it('shares one fetch and cache write across 30 repeated refreshes', async () => {
        const pending = deferred();
        steam.getLeaderboard.mockReturnValue(pending.promise);
        const { cache, panel } = createPanel();
        await settle();
        const render = vi.spyOn(panel, '_renderEntries');
        for (let i = 0; i < 30; i += 1) panel._load();
        await settle();
        expect(steam.getLeaderboard).toHaveBeenCalledOnce();
        pending.resolve(response('shared'));
        await settle();

        expect(cache.set).toHaveBeenCalledOnce();
        expect(render).toHaveBeenCalledOnce();
        expect(textContent(panel.listEl)).toContain('shared');
    });

    it('shares requests across panels while keeping each board presentation', async () => {
        const pending = deferred();
        steam.getLeaderboard.mockReturnValue(pending.promise);
        const cache = createCache();
        const first = createPanel({
            cache,
            boards: [{ id: 'score', name: 'score-board', currentScore: 100, formatScore: (score) => `A:${score}` }],
        });
        const second = createPanel({
            cache,
            boards: [{ id: 'score', name: 'score-board', currentScore: 200, formatScore: (score) => `B:${score}` }],
        });
        await settle();
        expect(steam.getLeaderboard).toHaveBeenCalledOnce();
        pending.resolve(response('shared'));
        await settle();

        expect(cache.set).toHaveBeenCalledOnce();
        expect(textContent(first.panel.listEl)).toContain('A:100');
        expect(textContent(first.panel.listEl)).toContain('A:42');
        expect(textContent(second.panel.listEl)).toContain('B:200');
        expect(textContent(second.panel.listEl)).toContain('B:42');
    });

    it('keeps distinct page sizes and views in separate requests', async () => {
        steam.getLeaderboard.mockImplementation(() => deferred().promise);
        const cache = createCache();
        createPanel({ cache });
        createPanel({ cache, pageSize: 8 });
        createPanel({ cache, views: [{ id: 'friends', label: 'Friends' }] });
        await settle();

        expect(steam.getLeaderboard.mock.calls).toEqual([
            ['score-board', 'global', 0, 10],
            ['score-board', 'global', 0, 8],
            ['score-board', 'friends', 0, 10],
        ]);
    });

    it('clears failed shared requests so the latest view can retry', async () => {
        const pending = deferred();
        steam.getLeaderboard.mockReturnValueOnce(pending.promise).mockResolvedValue(response('retry'));
        const { panel } = createPanel();
        await settle();
        pending.reject(new Error('Steam temporarily failed'));
        await settle();
        expect(panel.statusEl.textContent).toBe('Failed to refresh leaderboard.');
        await panel._load();

        expect(steam.getLeaderboard).toHaveBeenCalledTimes(2);
        expect(textContent(panel.listEl)).toContain('retry');
        expect(panel.statusEl.textContent).toBe('');
    });

    it('ignores a stale rejected request after another view succeeds', async () => {
        const old = deferred();
        steam.getLeaderboard.mockReturnValueOnce(old.promise).mockResolvedValue(response('friend'));
        const { panel } = createPanel();
        await settle();
        panel._setView('friends');
        await settle();
        old.reject(new Error('old view failed'));
        await settle();

        expect(panel.statusEl.textContent).toBe('');
        expect(textContent(panel.listEl)).toContain('friend');
        expect(console.warn).not.toHaveBeenCalled();
    });

    it('caches hidden completion without writes and displays it on reopening', async () => {
        const pending = deferred();
        steam.getLeaderboard.mockReturnValue(pending.promise);
        const { cache, panel } = createPanel();
        await settle();
        const render = vi.spyOn(panel, '_renderEntries');
        const status = panel.statusEl.textContent;
        panel.hide();
        pending.resolve(response('cached while hidden'));
        await settle();

        expect(cache.set).toHaveBeenCalledOnce();
        expect(render).not.toHaveBeenCalled();
        expect(panel.statusEl.textContent).toBe(status);
        panel.show();
        await settle();
        expect(render).toHaveBeenCalledOnce();
        expect(textContent(panel.listEl)).toContain('cached while hidden');
        expect(steam.getLeaderboard).toHaveBeenCalledOnce();
    });

    it('removes owned handlers on destroy and prevents late DOM updates', async () => {
        const pending = deferred();
        steam.getLeaderboard.mockReturnValue(pending.promise);
        const { container, panel } = createPanel();
        await settle();
        const oldList = panel.listEl;
        const oldStatus = panel.statusEl;
        const oldText = oldStatus.textContent;
        panel.destroy();
        expect(container.listeners.get('click').size).toBe(0);
        expect(panel.container).toBeNull();
        expect(panel.listEl).toBeNull();
        pending.resolve(response('retired'));
        await settle();

        expect(oldList.children).toHaveLength(0);
        expect(oldStatus.textContent).toBe(oldText);
        panel.mount(container);
        await settle();
        expect(container.listeners.get('click').size).toBe(1);
        expect(textContent(panel.listEl)).toContain('retired');
    });

    it('remounts without accumulating handlers or allowing old-host presentation', async () => {
        const pending = deferred();
        steam.getLeaderboard.mockReturnValue(pending.promise);
        const { container, panel } = createPanel();
        await settle();
        const oldList = panel.listEl;
        const nextContainer = new Element();
        panel.mount(nextContainer);
        await settle();
        pending.resolve(response('new host'));
        await settle();

        expect(container.listeners.get('click').size).toBe(0);
        expect(nextContainer.listeners.get('click').size).toBe(1);
        expect(oldList.children).toHaveLength(0);
        expect(textContent(panel.listEl)).toContain('new host');
        expect(steam.getLeaderboard).toHaveBeenCalledOnce();
    });

    it('uses fresh empty leaderboard results rather than refetching every reopen', async () => {
        steam.getLeaderboard.mockResolvedValue({ entries: [], supported: true });
        const { panel } = createPanel();
        await settle();
        panel.hide();
        panel.show();
        await settle();

        expect(steam.getLeaderboard).toHaveBeenCalledOnce();
        expect(textContent(panel.listEl)).toContain('No scores yet.');
        expect(panel.statusEl.textContent).toBe('');
    });

    it('handles Steam initialization rejection without updating a hidden panel', async () => {
        const init = deferred();
        steam.isAvailable.mockReturnValue(false);
        steam.initComplete = false;
        steam.waitForInit.mockReturnValue(init.promise);
        const { panel } = createPanel();
        const status = panel.statusEl.textContent;
        panel.hide();
        init.reject(new Error('init failed'));
        await settle();

        expect(panel.statusEl.textContent).toBe(status);
        expect(steam.getLeaderboard).not.toHaveBeenCalled();
        expect(console.warn).not.toHaveBeenCalled();
    });
});

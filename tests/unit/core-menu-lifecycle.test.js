import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { LobbyBrowser } from '../../src/ui/lobby-browser.js';
import { LobbyWaitingRoom } from '../../src/ui/lobby-waiting-room.js';
import { MultiplayerScoreboardOverlay } from '../../src/ui/multiplayer-scoreboard-overlay.js';

const subscriptions = vi.hoisted(() => new Set());
vi.mock('../../src/events/multiplayer-events.js', () => ({
    MULTIPLAYER_EVENTS: { PLAYER_LIST_CHANGED: 'players' },
    onMultiplayerEvent: vi.fn((type, handler) => {
        subscriptions.add(handler);
        return () => subscriptions.delete(handler);
    }),
}));
vi.mock('../../src/core/steam/steam-service.js', () => ({ default: {} }));
vi.mock('../../src/ui/components/player-card.js', () => ({ createPlayerCard: vi.fn() }));

function container() {
    const hidden = new Set(['hidden']);
    const list = { innerHTML: '', querySelectorAll: () => [] };
    const count = { textContent: '0' };
    return {
        classList: {
            add: (name) => hidden.add(name),
            remove: (name) => hidden.delete(name),
            contains: (name) => hidden.has(name),
        },
        remove: vi.fn(),
        querySelector: (selector) => (selector === '#lobby-list' ? list : count),
        list,
    };
}

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
    subscriptions.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function browserHarness() {
    vi.spyOn(LobbyBrowser.prototype, 'createUI').mockImplementation(function createUI() {
        this.container = container();
    });
    const pending = deferred();
    const steam = { getLobbies: vi.fn(() => pending.promise) };
    const browser = new LobbyBrowser(steam, vi.fn(), vi.fn());
    const render = vi.spyOn(browser, 'renderLobbies').mockImplementation(() => {});
    return { browser, pending, steam, render };
}

describe('lobby browser async ownership', () => {
    it.each(['hide', 'destroy'])('does not revive refresh work after %s during a Steam request', async (operation) => {
        const { browser, pending, steam, render } = browserHarness();
        const showing = browser.show();
        await Promise.resolve();
        expect(steam.getLobbies).toHaveBeenCalledOnce();
        browser[operation]();
        pending.resolve([{ id: 'stale' }]);
        await showing;
        await vi.advanceTimersByTimeAsync(10000);
        expect(render).not.toHaveBeenCalled();
        expect(browser.lobbies).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
        expect(steam.getLobbies).toHaveBeenCalledOnce();
    });

    it('shares one request across repeated refresh/show calls and owns one interval', async () => {
        const { browser, pending, steam } = browserHarness();
        const requests = [browser.show(), browser.show(), ...Array.from({ length: 30 }, () => browser.refresh())];
        await Promise.resolve();
        expect(steam.getLobbies).toHaveBeenCalledOnce();
        pending.resolve([]);
        await Promise.all(requests);
        expect(vi.getTimerCount()).toBe(1);
        browser.hide();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('serializes a fresh reopen request after retiring an old response', async () => {
        const { browser, pending, steam, render } = browserHarness();
        const firstShow = browser.show();
        await Promise.resolve();
        browser.hide();
        const replacement = deferred();
        steam.getLobbies.mockImplementationOnce(() => replacement.promise);
        const secondShow = browser.show();
        expect(steam.getLobbies).toHaveBeenCalledOnce();
        pending.resolve([{ id: 'old' }]);
        await vi.advanceTimersByTimeAsync(0);
        expect(steam.getLobbies).toHaveBeenCalledTimes(2);
        expect(render).not.toHaveBeenCalled();
        replacement.resolve([{ id: 'new' }]);
        await Promise.all([firstShow, secondShow]);
        expect(browser.lobbies).toEqual([{ id: 'new' }]);
        expect(render).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(1);
        browser.hide();
    });

    it('preserves existing rows for equivalent lobby data but updates rendered fields', () => {
        const { browser } = browserHarness();
        browser.renderLobbies.mockRestore();
        browser.escapeHtml = (text) => String(text ?? '');
        const setter = vi.fn();
        Object.defineProperty(browser.container.list, 'innerHTML', { set: setter });
        const lobby = { id: '123', name: 'Room', hostName: 'Host', players: 1, maxPlayers: 4 };
        browser.lobbies = [lobby];
        browser.renderLobbies();
        browser.lobbies = [{ ...lobby, unrelatedHeartbeat: 300 }];
        browser.renderLobbies();
        expect(setter).toHaveBeenCalledOnce();
        browser.lobbies[0].players = 4;
        browser.renderLobbies();
        expect(setter).toHaveBeenCalledTimes(2);
        expect(setter.mock.calls[1][0]).toContain('4/4');
        expect(setter.mock.calls[1][0]).toContain('disabled>Full');
    });
});

describe('waiting room timers and subscription ownership', () => {
    function waitingRoom() {
        vi.spyOn(LobbyWaitingRoom.prototype, 'createUI').mockImplementation(function createUI() {
            this.container = container();
            this.container.querySelector = () => null;
        });
        const room = new LobbyWaitingRoom({ chatHistory: [] }, vi.fn());
        vi.spyOn(room, 'updateUI').mockImplementation(() => {});
        return room;
    }

    it('repeated show owns one initial update, interval, and roster subscription', async () => {
        const room = waitingRoom();
        room.show();
        room.show();
        expect(subscriptions.size).toBe(1);
        expect(vi.getTimerCount()).toBe(2);
        await vi.advanceTimersByTimeAsync(50);
        expect(room.updateUI).toHaveBeenCalledOnce();
        room.hide();
        expect(subscriptions.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
        room.show();
        expect(subscriptions.size).toBe(1);
        room.destroy();
        expect(subscriptions.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(10000);
        expect(room.updateUI).toHaveBeenCalledOnce();
    });
});

describe('hidden multiplayer scoreboard workload', () => {
    it('defers sorting and row construction until shown, using the latest snapshot', () => {
        const root = container();
        const list = { innerHTML: '' };
        vi.spyOn(MultiplayerScoreboardOverlay.prototype, 'createUI').mockImplementation(function createUI() {
            this.container = root;
            this.listContainer = list;
        });
        const overlay = new MultiplayerScoreboardOverlay();
        overlay._escapeHtml = (text) => text;
        const compare = vi.spyOn(overlay, '_compare');
        const setter = vi.fn();
        Object.defineProperty(list, 'innerHTML', { set: setter });
        for (let score = 0; score < 40; score += 1) {
            overlay.updatePlayers([{ id: 'a', name: 'A', score }, { id: 'b', name: 'B', score: 50 }]);
        }
        expect(compare).not.toHaveBeenCalled();
        expect(setter).not.toHaveBeenCalled();
        overlay.show();
        expect(compare).toHaveBeenCalled();
        expect(setter).toHaveBeenCalledOnce();
        expect(setter.mock.calls[0][0]).toContain('39');
        expect(overlay.players.map((p) => p.id)).toEqual(['b', 'a']);
        overlay.hide();
        overlay.updatePlayers([{ id: 'a', name: 'A', score: 100 }]);
        expect(setter).toHaveBeenCalledOnce();
        overlay.toggle();
        expect(setter).toHaveBeenCalledTimes(2);
        expect(setter.mock.calls[1][0]).toContain('100');
        overlay.destroy();
        expect(overlay.listContainer).toBeNull();
    });
});

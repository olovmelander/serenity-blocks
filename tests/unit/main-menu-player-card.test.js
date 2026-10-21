import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { STEAM_EVENTS } from '../../src/core/steam/steam-config.js';
import { looseNode, looseWindow } from './helpers/loose-dom.js';

let body;
let startModal;

function stubPage(windowExtra = {}) {
    body = looseNode('body');
    startModal = looseNode('div');
    startModal.id = 'start-modal';
    startModal.classList.add('modal', 'visible');
    vi.stubGlobal('window', looseWindow(windowExtra));
    vi.stubGlobal('document', {
        body,
        createElement: (tag) => looseNode(tag),
        getElementById: (id) => (id === 'start-modal' ? startModal : null),
    });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    vi.stubGlobal('MutationObserver', class {
        observe() {}

        disconnect() {}
    });
    vi.stubGlobal('requestAnimationFrame', (callback) => { callback(); return 1; });
}

/** An Electron preload whose Steam answers with `status` (null: the call fails). */
function steamApi(status) {
    return {
        invoke: vi.fn(async (channel) => {
            if (channel === 'steam:getConnectionStatus') return status;
            if (channel === 'steam:getCapabilities') {
                return {
                    leaderboards: false, cloud: true, friends: true, achievements: true,
                };
            }
            if (channel === 'steam:getFriends') return [{ gameId: '480', inGame: true }];
            if (channel === 'steam:getAvatar') return 'data:image/png;base64,AAAA';
            return null;
        }),
        on: vi.fn(() => () => {}),
    };
}

async function load() {
    const { default: steamService } = await import('../../src/core/steam/steam-service.js');
    const module = await import('../../src/ui/components/main-menu-player-card.js');
    return { steamService, ...module };
}

beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('main menu player card', () => {
    it('stays out of a browser build, where there is no Steam client to show', async () => {
        stubPage();
        const { MainMenuPlayerCard, hasSteamClient, steamService } = await load();
        expect(hasSteamClient()).toBe(false);
        const card = new MainMenuPlayerCard();
        await card.initialize();
        // Steam settling later (a leaderboard asking for it) must not surface it either.
        await steamService.initialize();
        card.show();
        expect(card.element).toBeNull();
        expect(body.children).toHaveLength(0);
    });

    it('says what each connection state means, with a way to retry only when offline', async () => {
        stubPage();
        const { describeConnection } = await load();
        expect(describeConnection('connected')).toMatchObject({ status: 'Online', dot: 'online', retry: false });
        expect(describeConnection('partial')).toMatchObject({ status: 'Online', dot: 'online', retry: false });
        expect(describeConnection('connecting'))
            .toMatchObject({ status: 'Connecting', dot: 'connecting', retry: false });
        expect(describeConnection('no_steam'))
            .toMatchObject({ status: 'Offline', retry: true, title: 'Steam is not running' });
        expect(describeConnection('offline', { queuedActions: 2 }).title).toBe('Steam is offline · 2 waiting to sync');
    });

    it('reads Steam as it is when built, so it never waits on an event that already fired', async () => {
        stubPage({ electronAPI: steamApi({ initialized: false, pending: false }) });
        const { MainMenuPlayerCard, steamService } = await load();
        const settled = steamService.initialize();
        await vi.advanceTimersByTimeAsync(5000);
        await settled;
        expect(steamService.getConnectionState()).toBe('no_steam');

        const card = new MainMenuPlayerCard();
        await card.initialize();
        expect(body.children).toContain(card.element);
        expect(card.statusText.textContent).toBe('Offline');
        expect(card.retryButton.classList.contains('visible')).toBe(true);
        expect(card.element.classList.contains('visible')).toBe(true);
        expect(card.element.getAttribute('aria-disabled')).toBe('true');
    });

    it('moves from Connecting to Online with the name, friends and the Limited note', async () => {
        const api = steamApi({ initialized: false, pending: true, playerName: 'Player' });
        stubPage({ electronAPI: api });
        const { MainMenuPlayerCard, steamService } = await load();
        await steamService.initialize();
        const card = new MainMenuPlayerCard();
        await card.initialize();
        expect(card.statusText.textContent).toBe('Connecting');
        expect(card.retryButton.classList.contains('visible')).toBe(false);

        const online = {
            initialized: true, connected: true, pending: false, steamId: '7656', playerName: 'Melolo', appId: 480,
        };
        api.invoke.mockImplementation(async (channel) => {
            if (channel === 'steam:getConnectionStatus') return online;
            if (channel === 'steam:getCapabilities') {
                return {
                    leaderboards: false, cloud: true, friends: true, achievements: true,
                };
            }
            if (channel === 'steam:getFriends') return [{ gameId: '480', inGame: true }];
            return null;
        });
        await steamService._syncFromMainProcessStatus(online, { source: 'test' });
        await vi.advanceTimersByTimeAsync(0);

        expect(card.nameElement.textContent).toBe('Melolo');
        expect(card.statusText.textContent).toBe('Online');
        expect(card.statePill.textContent).toBe('Limited');
        expect(card.statePill.title).toContain('leaderboards');
        expect(card.friendsBadge.textContent).toBe('1 friend playing');
        expect(card.element.dataset.state).toBe('partial');
        expect(card.element.getAttribute('aria-disabled')).toBe('false');
        card.destroy();
    });

    it('belongs to the menu: it stays hidden while the start modal is away', async () => {
        stubPage({ electronAPI: steamApi({ initialized: false, pending: false }) });
        startModal.classList.remove('visible');
        const { MainMenuPlayerCard, steamService } = await load();
        const card = new MainMenuPlayerCard();
        await card.initialize();
        steamService.emit(STEAM_EVENTS.INIT_FAILED, { source: 'test' });
        expect(card.isVisible).toBe(false);
        expect(card.element.classList.contains('visible')).toBe(false);
        startModal.classList.add('visible');
        card.show();
        expect(card.element.classList.contains('visible')).toBe(true);
        card.hide();
        expect(card.element.classList.contains('visible')).toBe(false);
    });
});

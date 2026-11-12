import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { OnlineMultiplayerMode } from '../../src/core/game-modes/OnlineMultiplayerMode.js';

const mocks = vi.hoisted(() => ({ createNetwork: vi.fn(), ensureNotice: vi.fn(), seenNotice: vi.fn() }));
vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../src/ui/online-play-notice.js', async (importOriginal) => ({
    ...await importOriginal(),
    ensureOnlinePlayNotice: mocks.ensureNotice,
    hasSeenOnlinePlayNotice: mocks.seenNotice,
}));
vi.mock('../../src/rendering/phaser/board-juice.js', () => ({ BoardJuice: class BoardJuice {} }));
vi.mock('../../src/core/steam/steam-networking.js', () => ({
    SteamNetworking: class SteamNetworking {
        constructor() { return mocks.createNetwork(); }
    },
}));

let mode;

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mocks.createNetwork.mockReset();
    mocks.ensureNotice.mockReset().mockResolvedValue(true);
    mocks.seenNotice.mockReset().mockReturnValue(true);
    mode = Object.create(OnlineMultiplayerMode.prototype);
    mode.steamNetworking = null;
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function prepareActivationHooks() {
    const document = { getElementById: vi.fn(() => null), querySelector: vi.fn(() => null) };
    vi.stubGlobal('document', document);
    mode._cleanupGameRendering = vi.fn();
    mode._clearLobbyRichPresence = vi.fn();
    mode._cleanupEventListeners = vi.fn();
    mode.cleanupHandlers = [];
    mode.initializeLobbyUI = vi.fn();
    mode._ensureMatchResultsModal = vi.fn();
    mode.showLobbyBrowser = vi.fn().mockResolvedValue();
    return document;
}

describe('online networking initialization', () => {
    it.each(['reject', 'false'])('retries after init returns %s and retires the failed transport', async (failure) => {
        const failed = {
            init: failure === 'reject'
                ? vi.fn().mockRejectedValue(new Error('Steam is offline'))
                : vi.fn().mockResolvedValue(false),
            shutdown: vi.fn(),
        };
        const recovered = {
            init: vi.fn().mockResolvedValue(true), shutdown: vi.fn(), stopP2PPolling: vi.fn(),
        };
        mocks.createNetwork.mockReturnValueOnce(failed).mockReturnValueOnce(recovered);

        await expect(mode.initializeSteamNetworking()).rejects.toThrow();
        expect(failed.shutdown).toHaveBeenCalledOnce();
        expect(mode.steamNetworking).toBeNull();
        await mode.initializeSteamNetworking();
        expect(mode.steamNetworking).toBe(recovered);
        expect(recovered.init).toHaveBeenCalledOnce();
        expect(recovered.shutdown).not.toHaveBeenCalled();
        await mode.initializeSteamNetworking();
        expect(mocks.createNetwork).toHaveBeenCalledTimes(2);
    });

    it('coalesces concurrent starts and publishes the transport only after it is ready', async () => {
        let ready;
        const pending = new Promise((resolve) => { ready = resolve; });
        const network = {
            init: vi.fn().mockReturnValue(pending), shutdown: vi.fn(), stopP2PPolling: vi.fn(),
        };
        mocks.createNetwork.mockReturnValue(network);

        const first = mode.initializeSteamNetworking();
        const second = mode.initializeSteamNetworking();
        expect(mode.steamNetworking).toBeNull();
        expect(mocks.createNetwork).toHaveBeenCalledOnce();
        expect(network.init).toHaveBeenCalledOnce();
        ready(true);
        await Promise.all([first, second]);
        expect(mode.steamNetworking).toBe(network);
        expect(mode._steamNetworkingInit).toBeNull();
    });

    it.each([false, true])('fences a retired activation while init settles (reactivate: %s)', async (reactivate) => {
        prepareActivationHooks();
        let ready;
        const pending = new Promise((resolve) => { ready = resolve; });
        const network = {
            init: vi.fn().mockReturnValue(pending),
            shutdown: vi.fn(),
            stopP2PPolling: vi.fn(),
            startP2PPolling: vi.fn(),
        };
        mocks.createNetwork.mockReturnValue(network);

        const retired = mode.onActivate();
        await Promise.resolve();
        expect(network.init).toHaveBeenCalledOnce();
        await mode.onDeactivate();
        const replacement = reactivate ? mode.onActivate() : Promise.resolve();
        await Promise.resolve();
        ready(true);
        await Promise.all([retired, replacement]);

        expect(mocks.createNetwork).toHaveBeenCalledOnce();
        expect(network.stopP2PPolling).toHaveBeenCalledOnce();
        expect(network.startP2PPolling).toHaveBeenCalledTimes(reactivate ? 1 : 0);
        expect(mode.initializeLobbyUI).toHaveBeenCalledTimes(reactivate ? 1 : 0);
        expect(mode.showLobbyBrowser).toHaveBeenCalledTimes(reactivate ? 1 : 0);
        expect(mode.steamNetworking).toBe(network);
    });

    it('does not touch the DOM when deselected during the initial activation await', async () => {
        const document = prepareActivationHooks();
        const activation = mode.onActivate();
        await mode.onDeactivate();
        await activation;
        expect(document.getElementById).not.toHaveBeenCalled();
        expect(document.querySelector).not.toHaveBeenCalled();
        expect(mocks.createNetwork).not.toHaveBeenCalled();
        expect(mode.initializeLobbyUI).not.toHaveBeenCalled();
    });

    function readyNetwork() {
        const network = {
            init: vi.fn().mockResolvedValue(true),
            shutdown: vi.fn(),
            stopP2PPolling: vi.fn(),
            startP2PPolling: vi.fn(),
        };
        mocks.createNetwork.mockReturnValue(network);
        return network;
    }

    it('shows the match list only once the online notice has been read', async () => {
        prepareActivationHooks();
        readyNetwork();
        let read;
        mocks.ensureNotice.mockReturnValue(new Promise((resolve) => { read = resolve; }));
        mode.handleLobbyBrowserCancelled = vi.fn();

        const activation = mode.onActivate();
        await vi.waitFor(() => expect(mocks.ensureNotice).toHaveBeenCalledOnce());
        expect(mode.initializeLobbyUI).toHaveBeenCalledOnce();
        expect(mode.showLobbyBrowser).not.toHaveBeenCalled();

        read(true);
        await activation;
        expect(mode.showLobbyBrowser).toHaveBeenCalledOnce();
        expect(mode.handleLobbyBrowserCancelled).not.toHaveBeenCalled();
    });

    it('returns to the menu, with no match list, when the notice is backed out of', async () => {
        prepareActivationHooks();
        readyNetwork();
        mocks.ensureNotice.mockResolvedValue(false);
        mode.handleLobbyBrowserCancelled = vi.fn().mockResolvedValue();

        await mode.onActivate();

        expect(mode.handleLobbyBrowserCancelled).toHaveBeenCalledOnce();
        expect(mode.showLobbyBrowser).not.toHaveBeenCalled();
    });

    it('does nothing with a notice answered after the mode was left', async () => {
        prepareActivationHooks();
        readyNetwork();
        let read;
        mocks.ensureNotice.mockReturnValue(new Promise((resolve) => { read = resolve; }));
        mode.handleLobbyBrowserCancelled = vi.fn();

        const activation = mode.onActivate();
        await vi.waitFor(() => expect(mocks.ensureNotice).toHaveBeenCalledOnce());
        await mode.onDeactivate();
        read(false);
        await activation;

        expect(mode.showLobbyBrowser).not.toHaveBeenCalled();
        expect(mode.handleLobbyBrowserCancelled).not.toHaveBeenCalled();
    });

    it('has no notice in a test lobby without Steam, which connects to no other computer', async () => {
        prepareActivationHooks();
        readyNetwork().mockMode = true;
        mocks.seenNotice.mockReturnValue(false);

        await mode.onActivate();

        expect(mocks.ensureNotice).not.toHaveBeenCalled();
        expect(mode.showLobbyBrowser).toHaveBeenCalledOnce();
    });

    it('joins nothing, an invite included, before the notice has been read', async () => {
        mocks.seenNotice.mockReturnValue(false);
        mode.steamNetworking = { joinLobby: vi.fn(), leaveLobby: vi.fn() };
        mode.lobbyBrowser = { hide: vi.fn() };

        await mode.joinLobbyFromInvite('109775240000000001');
        await mode.handleJoinLobby('109775240000000001', { asSpectator: true });

        expect(mode.steamNetworking.joinLobby).not.toHaveBeenCalled();
        expect(mode.lobbyBrowser.hide).not.toHaveBeenCalled();
    });

    it('retires a cancelled failed initialization without showing a late error toast', async () => {
        prepareActivationHooks();
        const dispatchEvent = vi.fn();
        vi.stubGlobal('window', { dispatchEvent });
        let reject;
        const pending = new Promise((_resolve, onReject) => { reject = onReject; });
        const network = { init: vi.fn().mockReturnValue(pending), shutdown: vi.fn() };
        mocks.createNetwork.mockReturnValue(network);
        const activation = mode.onActivate();
        await Promise.resolve();
        await mode.onDeactivate();
        reject(new Error('Steam stopped during activation'));
        await activation;
        expect(network.shutdown).toHaveBeenCalledOnce();
        expect(mode.steamNetworking).toBeNull();
        expect(dispatchEvent).not.toHaveBeenCalled();
        expect(mode.initializeLobbyUI).not.toHaveBeenCalled();
    });
});

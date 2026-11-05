import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { OnlineMultiplayerMode } from '../../src/core/game-modes/OnlineMultiplayerMode.js';

const mocks = vi.hoisted(() => ({ createNetwork: vi.fn() }));
vi.mock('phaser', () => ({ default: {} }));
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

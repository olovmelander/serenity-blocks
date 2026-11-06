import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
    getFriends: vi.fn(),
    on: vi.fn(),
    consumePendingInvites: vi.fn(),
    showInvite: vi.fn(),
    onMultiplayerEvent: vi.fn(),
}));

vi.mock('../../src/core/steam/steam-service.js', () => ({ default: dependencies }));
vi.mock('../../src/ui/components/invite-toast.js', () => ({
    getInviteToastManager: () => ({ showInvite: dependencies.showInvite }),
}));
vi.mock('../../src/events/multiplayer-events.js', () => ({
    onMultiplayerEvent: dependencies.onMultiplayerEvent,
    MULTIPLAYER_EVENTS: { GAME_OVER: 'game-over' },
}));

import { GAME_MODES } from '../../src/core/constants.js';
import { SteamInviteManager } from '../../src/core/steam/steam-invite-manager.js';

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

describe('Steam invite manager lifecycle', () => {
    let manager;
    let gameModeManager;
    let steamUnsubscribe;
    let modeUnsubscribe;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('window', new EventTarget());
        steamUnsubscribe = vi.fn();
        modeUnsubscribe = vi.fn();
        dependencies.on.mockReturnValue(steamUnsubscribe);
        dependencies.consumePendingInvites.mockReturnValue([]);
        dependencies.getFriends.mockResolvedValue([{ steamId: 'friend', name: 'Player' }]);
        dependencies.onMultiplayerEvent.mockReturnValue(vi.fn());
        gameModeManager = {
            on: vi.fn(() => modeUnsubscribe),
            getCurrentMode: vi.fn(() => null),
            getCurrentModeId: vi.fn(() => GAME_MODES.SINGLE_PLAYER),
            activateMode: vi.fn().mockResolvedValue(),
            startCurrentMode: vi.fn().mockResolvedValue(),
        };
        manager = new SteamInviteManager(gameModeManager);
    });

    afterEach(() => {
        manager.destroy();
        vi.unstubAllGlobals();
    });

    it('does not display an invitation whose friend lookup finishes after destruction', async () => {
        const lookup = deferred();
        dependencies.getFriends.mockReturnValue(lookup.promise);
        const handling = manager._handleInvite({ lobbyId: 'lobby', friendSteamId: 'friend' });

        manager.destroy();
        lookup.resolve([{ steamId: 'friend', name: 'Player' }]);
        await handling;

        expect(dependencies.showInvite).not.toHaveBeenCalled();
        expect(gameModeManager.getCurrentMode).not.toHaveBeenCalled();
    });

    it('does not start a lobby when activation finishes after destruction', async () => {
        const activation = deferred();
        gameModeManager.activateMode.mockReturnValue(activation.promise);
        const joining = manager._joinLobby('lobby');
        expect(gameModeManager.activateMode).toHaveBeenCalledWith(GAME_MODES.ONLINE_MULTIPLAYER);

        manager.destroy();
        activation.resolve();
        await joining;

        expect(gameModeManager.startCurrentMode).not.toHaveBeenCalled();
    });

    it.each([false, true])('ignores a visible invite accepted after destruction (busy=%s)', async (busy) => {
        gameModeManager.getCurrentMode.mockReturnValue({ isRunning: busy });
        await manager._handleInvite({ lobbyId: 'lobby', friendSteamId: 'friend' });
        const invitation = dependencies.showInvite.mock.calls[0][0];

        manager.destroy();
        invitation.onAccept();
        await Promise.resolve();

        expect(manager.pendingInvites).toEqual([]);
        expect(manager.pendingInviteIds.size).toBe(0);
        expect(gameModeManager.activateMode).not.toHaveBeenCalled();
        expect(gameModeManager.startCurrentMode).not.toHaveBeenCalled();
    });

    it('ignores an invite delivered through an already-captured callback after destruction', async () => {
        const callback = dependencies.on.mock.calls[0][1];
        manager.destroy();
        callback({ lobbyId: 'lobby', friendSteamId: 'friend' });
        await Promise.resolve();
        await Promise.resolve();

        expect(dependencies.getFriends).not.toHaveBeenCalled();
        expect(dependencies.showInvite).not.toHaveBeenCalled();
    });

    it('still resolves a name and joins an invitation during its active lifetime', async () => {
        await manager._handleInvite({ lobbyId: 'lobby', friendSteamId: 'friend' });
        const invitation = dependencies.showInvite.mock.calls[0][0];
        expect(invitation.message).toBe('Invite from Player');
        invitation.onAccept();
        await Promise.resolve();

        expect(gameModeManager.activateMode).toHaveBeenCalledWith(GAME_MODES.ONLINE_MULTIPLAYER);
        expect(gameModeManager.startCurrentMode).toHaveBeenCalledWith({ lobbyId: 'lobby', invite: true });
    });

    it('still queues a busy invite and joins it when the match has stopped', async () => {
        gameModeManager.getCurrentMode.mockReturnValue({ isRunning: true });
        await manager._handleInvite({ lobbyId: 'lobby' });
        dependencies.showInvite.mock.calls[0][0].onAccept();
        expect(manager.pendingInviteIds.has('lobby')).toBe(true);

        gameModeManager.getCurrentMode.mockReturnValue(null);
        await manager._tryJoinPending('modeStopped');

        expect(manager.pendingInvites).toEqual([]);
        expect(gameModeManager.startCurrentMode).toHaveBeenCalledWith({ lobbyId: 'lobby', invite: true });
    });

    it('queues an accepted invite if a match began while the toast was visible', async () => {
        await manager._handleInvite({ lobbyId: 'lobby' });
        gameModeManager.getCurrentMode.mockReturnValue({ isRunning: true });

        dependencies.showInvite.mock.calls[0][0].onAccept();
        await Promise.resolve();

        expect(manager.pendingInviteIds.has('lobby')).toBe(true);
        expect(gameModeManager.activateMode).not.toHaveBeenCalled();
    });

    it('joins an accepted invite if the match ended while the toast was visible', async () => {
        gameModeManager.getCurrentMode.mockReturnValue({ isRunning: true });
        await manager._handleInvite({ lobbyId: 'lobby' });
        gameModeManager.getCurrentMode.mockReturnValue(null);

        dependencies.showInvite.mock.calls[0][0].onAccept();
        await Promise.resolve();

        expect(manager.pendingInvites).toEqual([]);
        expect(gameModeManager.startCurrentMode).toHaveBeenCalledWith({ lobbyId: 'lobby', invite: true });
    });

    it('unsubscribes only once when destroyed repeatedly', () => {
        manager.destroy();
        manager.destroy();

        expect(steamUnsubscribe).toHaveBeenCalledOnce();
        expect(modeUnsubscribe).toHaveBeenCalledOnce();
    });
});

/**
 * The transport's part in departures: every accepted packet is a sign of life, Steam's
 * own lobby and P2P callbacks report peers gone, and a peer that leaves says so first.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { SteamNetworking } from '../../src/core/steam/steam-networking.js';
import { PeerLiveness } from '../../src/core/network/peer-liveness.js';
import { MessageTypes } from '../../src/core/network/message-types.js';
import { lobbyMemberChange } from '../../electron/steam-peer-events.js';

afterEach(() => vi.restoreAllMocks());

function network({ isHost = false } = {}) {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const net = new SteamNetworking();
    net.mockMode = true;
    net.steamId = isHost ? 'H0' : 'P1';
    net.isHost = isHost;
    net.hostSteamId = 'H0';
    net.currentLobbyId = 'lobby-7';
    net.setNetworkImpairment({ enabled: false });
    return net;
}

describe('peer liveness', () => {
    it('counts silence from the last packet, and from the first question when never heard', () => {
        const liveness = new PeerLiveness();
        liveness.heard('P1', 1000);
        expect(liveness.silenceMs('P1', 4500)).toBe(3500);
        expect(liveness.silenceMs('P2', 4500)).toBe(0);
        expect(liveness.silenceMs('P2', 9500)).toBe(5000);
        liveness.forget('P1');
        expect(liveness.silenceMs('P1', 9500)).toBe(0);
    });

    it('notes every packet the transport accepts, and forgets a peer whose session is cleared', () => {
        const net = network({ isHost: true });
        net.lockProtocolSession();
        net.setNegotiatedProtocol('P1', net.getNegotiatedProtocolVersion());
        vi.spyOn(Date, 'now').mockReturnValue(50_000);
        net._processEnvelope({ msgType: MessageTypes.NET_PING, payload: { sentAt: 1 } }, 'P1');
        expect(net.peerSilenceMs('P1', 53_000)).toBe(3000);
        net.clearNegotiatedProtocol('P1');
        expect(net.peerSilenceMs('P1', 60_000)).toBe(0);
    });
});

describe("Steam's word on departures", () => {
    function listen(net) {
        const handlers = {};
        net._listenForSteamPeerEvents({ on: (channel, callback) => { handlers[channel] = callback; } });
        const gone = [];
        net.onPeerGone((steamId, reason) => gone.push([steamId, reason]));
        return { handlers, gone };
    }

    it('reports members of this lobby who left, dropped, or were kicked or banned', () => {
        const net = network({ isHost: true });
        const { handlers, gone } = listen(net);
        handlers['steam:lobbyMember']({ lobbyId: 'lobby-7', steamId: 'P1', change: 'left' });
        handlers['steam:lobbyMember']({ lobbyId: 'lobby-7', steamId: 'P2', change: 'disconnected' });
        handlers['steam:lobbyMember']({ lobbyId: 'lobby-7', steamId: 'P3', change: 'entered' });
        handlers['steam:lobbyMember']({ lobbyId: 'other', steamId: 'P4', change: 'left' });
        handlers['steam:lobbyMember']({ lobbyId: 'lobby-7', steamId: 'H0', change: 'left' }); // ourselves
        handlers['steam:p2pSessionFailed']({ steamId: 'P5', error: 4 });
        expect(gone).toEqual([['P1', 'lobby_left'], ['P2', 'lobby_disconnected'], ['P5', 'p2p_failed']]);
    });

    it('stops reporting to an unsubscribed listener', () => {
        const net = network({ isHost: true });
        const { handlers } = listen(net);
        const late = vi.fn();
        const off = net.onPeerGone(late);
        off();
        handlers['steam:lobbyMember']({ lobbyId: 'lobby-7', steamId: 'P1', change: 'kicked' });
        expect(late).not.toHaveBeenCalled();
    });

    it("reads Steam's member change as a number or as its name", () => {
        expect(lobbyMemberChange(1)).toBe('left');
        expect(lobbyMemberChange(2)).toBe('disconnected');
        expect(lobbyMemberChange('Banned')).toBe('banned');
        expect(lobbyMemberChange(9)).toBeNull();
        expect(lobbyMemberChange(null)).toBeNull();
    });
});

describe('the leave notice', () => {
    it('a peer tells the host before its session closes; a host or a peer not yet welcomed does not', () => {
        const peer = network();
        const sent = [];
        peer.broadcastChannel = { postMessage: (m) => sent.push([m.type, m.to]), close: () => {} };
        peer.leaveLobby(); // not welcomed: no session to say goodbye on
        expect(sent).toEqual([]);

        const welcomed = network();
        welcomed.broadcastChannel = { postMessage: (m) => sent.push([m.type, m.to]), close: () => {} };
        welcomed.sessionProtocolVersion = welcomed.getNegotiatedProtocolVersion();
        welcomed.leaveLobby();
        expect(sent).toEqual([[MessageTypes.LOBBY_PLAYER_LEFT, 'H0']]);
        expect(welcomed.currentLobbyId).toBeNull();
    });
});

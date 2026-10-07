/**
 * What a peer can make the others swallow (audit T12, T13): text is capped where it
 * enters, chat is rate-limited where it is relayed, every sender has a packet budget and
 * a size cap before anything is parsed, logical channels are a fixed set, and a host's
 * figures are bounded before they reach lifetime Steam stats.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { capPeerText, MAX_CHAT_CHARS, MAX_NAME_CHARS } from '../../src/core/network/peer-text.js';
import {
    INTAKE_BURST, INTAKE_PER_SECOND, MAX_PEER_PACKET_BYTES, PeerIntake,
} from '../../src/core/network/peer-intake.js';
import { CHAT_BURST, CHAT_REFILL_MS, handleFfaChat } from '../../src/core/multiplayer/ffa/chat-relay.js';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';
import { SteamNetworking } from '../../src/core/steam/steam-networking.js';
import { MessageTypes } from '../../src/core/network/message-types.js';
import { matchStatsForSteam } from '../../src/core/game-modes/online-steam-stats.js';

afterEach(() => vi.restoreAllMocks());

describe('peer text', () => {
    it('keeps a string, without control characters, at most so long', () => {
        expect(capPeerText('  Mika\u0000\u001b[31m  ', MAX_NAME_CHARS)).toBe('Mika[31m');
        expect(capPeerText('x'.repeat(50_000), MAX_NAME_CHARS)).toHaveLength(MAX_NAME_CHARS);
        expect(capPeerText({ toString: () => 'evil' }, 10)).toBe('');
        expect(capPeerText(null, 10)).toBe('');
    });

    it('caps a name on every roster add, host or peer', () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const state = Object.assign(Object.create(FFAGameStateP2P.prototype), {
            isHost: false, players: new Map(), network: {}, matchConfig: {},
        });
        state.addPlayer('P1', 'n'.repeat(60_000));
        state.addPlayer('P2', '');
        expect(state.players.get('P1').name).toHaveLength(MAX_NAME_CHARS);
        expect(state.players.get('P2').name).toBe('Player');
    });
});

describe('packet intake', () => {
    it('lets a burst through, then the per-second rate', () => {
        const intake = new PeerIntake();
        for (let i = 0; i < INTAKE_BURST; i += 1) expect(intake.admit('P1', 1000)).toBe(true);
        expect(intake.admit('P1', 1000)).toBe(false);
        expect(intake.admit('P2', 1000)).toBe(true); // a budget per sender
        expect(intake.admit('P1', 1000 + 1000 / INTAKE_PER_SECOND)).toBe(true);
        expect(intake.admit('P1', 1000 + 1000 / INTAKE_PER_SECOND)).toBe(false);
    });

    it('refuses a packet bigger than the sender\'s role ever sends, before parsing it', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const host = new SteamNetworking();
        host.isHost = true;
        const parse = vi.spyOn(host, '_parsePacketData');
        host.handleP2PPacket({ steamId: 'P1', data: 'x'.repeat(MAX_PEER_PACKET_BYTES + 1) });
        expect(parse).not.toHaveBeenCalled();
        expect(host.packetStats.intakeDrops).toBe(1);
    });

    it('drops a sender-chosen logical channel instead of growing the sequence map', () => {
        const peer = new SteamNetworking();
        peer.hostSteamId = 'H0';
        const envelope = (channel) => ({
            msgType: MessageTypes.NET_PONG,
            envelopeVersion: peer.envelopeVersion,
            protocolVersion: peer.getNegotiatedProtocolVersion(),
            channel,
            seq: 1,
            payload: {},
        });
        expect(peer._validateEnvelope(envelope(2), 'H0', 2)).toBe(true);
        expect(peer._validateEnvelope(envelope(77), 'H0', 77)).toBe(false);
        expect([...peer.recvSeqByPeer.keys()]).toEqual(['H0:2']);
    });

    it('logs a flood of rejected packets once per power of ten', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const net = new SteamNetworking();
        for (let i = 0; i < 1000; i += 1) net._rejectMessageRole('net:x', 'EVIL', 'role mismatch');
        expect(warn).toHaveBeenCalledTimes(4); // the 1st, 10th, 100th and 1000th
        expect(net.packetStats.roleValidationDropsByType['net:x']).toBe(1000);
    });
});

describe('chat relay', () => {
    function hostGame() {
        return {
            isHost: true,
            localPlayerId: 'H0',
            players: new Map([['P1', { steamId: 'P1', name: 'Mika', color: '#88aaff' }]]),
            spectators: new Set(),
            chatHistory: [],
            broadcastToPeers: vi.fn(),
        };
    }

    it('binds the author to the sender and caps the text it relays', () => {
        const game = hostGame();
        handleFfaChat(game, { from: 'P1', data: { playerName: 'Host', steamId: 'H0', message: 'y'.repeat(5000) } }, 0);
        const [, relayed, excluded] = game.broadcastToPeers.mock.calls[0];
        expect(relayed).toMatchObject({ steamId: 'P1', playerName: 'Mika', color: '#88aaff' });
        expect(relayed.message).toHaveLength(MAX_CHAT_CHARS);
        expect(excluded).toBe('P1');
    });

    it('rate-limits a sender, and refuses strangers and empty messages', () => {
        const game = hostGame();
        const say = (at) => handleFfaChat(game, { from: 'P1', data: { message: 'hi' } }, at);
        for (let i = 0; i < CHAT_BURST; i += 1) expect(say(0)).toBe(true);
        expect(say(0)).toBe(false);
        expect(say(CHAT_REFILL_MS)).toBe(true);
        expect(handleFfaChat(game, { from: 'STRANGER', data: { message: 'hi' } }, 0)).toBe(false);
        expect(handleFfaChat(game, { from: 'P1', data: { message: '\u0000 ' } }, 10_000)).toBe(false);
        expect(game.broadcastToPeers).toHaveBeenCalledTimes(CHAT_BURST + 1);
    });
});

describe('lifetime Steam stats from an online match', () => {
    it('bounds what the host reports', () => {
        expect(matchStatsForSteam(
            { frags: 999, lines: -40, score: 'lots', level: 3, placement: 1 },
            { players: 4, rounds: 2, localLines: 30, durationMs: -5 },
        )).toEqual({ kills: 6, lines: 0, score: 0, level: 3, minutes: 1, isWinner: true });
        expect(matchStatsForSteam(
            { frags: 2, lines: 400, score: 9000, level: 5, placement: 2 },
            { players: 4, rounds: 3, localLines: 120, durationMs: 7 * 60_000 },
        )).toEqual({ kills: 2, lines: 120, score: 9000, level: 5, minutes: 7, isWinner: false });
    });
});

/**
 * Online play through Steam's relays only (electron/steam-relay-transport.js), driven by a fake
 * koffi whose "Steam" keeps messages in a fake address space, and the wiring that makes a store
 * build play online that way or not at all (electron/steam-integration.js,
 * electron/steam-network-transport.js, electron/debug-flags.js, electron/p2p-session-gate.js).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    CONFIG_ICE_ENABLE, FLAG_RELAYED, ICE_DISABLE, IDENTITY_BYTES, INFO_LAYOUT, RELAY_CHANNEL, RELAY_FUNCTIONS,
    SESSION_STATE, decodeSteamIdentity, encodeSteamIdentity, openRelayTransport, steamApiLibraryPath,
} from '../../electron/steam-relay-transport.js';
import {
    RELAY_UNAVAILABLE_MESSAGE, describeNetworkTransport, lobbyAllowed,
} from '../../electron/steam-network-transport.js';
import { allowsDirectP2P } from '../../electron/debug-flags.js';
import { createP2PSessionGate } from '../../electron/p2p-session-gate.js';

const HOST = '76561198012345678';
const PLAYER = '76561198087654321';

/** A Steam that lives in JS: functions by their flat API name, memory by fake address. */
function fakeSteam({
    iceOk = true, interfaces = true, missing = null, sendResult = 1, acceptResult = true,
} = {}) {
    const calls = [];
    const memory = new Map();
    let nextAddress = 0x10000n;
    const allocate = (buffer) => {
        const address = nextAddress;
        nextAddress += 0x10000n;
        memory.set(address, buffer);
        return address;
    };
    const inbox = [];
    const released = [];
    const sessions = new Map();
    const idOf = (identity) => decodeSteamIdentity(Buffer.from(identity).subarray(0, 16));
    const impl = {
        SteamAPI_SteamNetworkingMessages_SteamAPI_v002: () => (interfaces ? 0x1000n : 0n),
        SteamAPI_SteamNetworkingUtils_SteamAPI_v004: () => (interfaces ? 0x2000n : 0n),
        SteamAPI_ISteamNetworkingUtils_SetGlobalConfigValueInt32: (self, value, data) => {
            calls.push(['config', self, value, data]);
            return iceOk;
        },
        SteamAPI_ISteamNetworkingUtils_InitRelayNetworkAccess: () => calls.push(['initRelay']),
        SteamAPI_ISteamNetworkingUtils_GetRelayNetworkStatus: () => 100,
        SteamAPI_ISteamNetworkingMessages_SendMessageToUser: (self, identity, data, size, flags, channel) => {
            calls.push(['send', idOf(identity), Buffer.from(data).toString(), size, flags, channel]);
            return sendResult;
        },
        SteamAPI_ISteamNetworkingMessages_ReceiveMessagesOnChannel: (self, channel, out, max) => {
            calls.push(['receive', channel, max]);
            const count = Math.min(inbox.length, max);
            for (let i = 0; i < count; i += 1) out.writeBigUInt64LE(inbox.shift(), i * 8);
            return count;
        },
        SteamAPI_ISteamNetworkingMessages_AcceptSessionWithUser: (self, identity) => {
            calls.push(['accept', idOf(identity)]);
            return acceptResult;
        },
        SteamAPI_ISteamNetworkingMessages_CloseSessionWithUser: (self, identity) => {
            calls.push(['close', idOf(identity)]);
            return true;
        },
        SteamAPI_ISteamNetworkingMessages_GetSessionConnectionInfo: (self, identity, info) => {
            const session = sessions.get(idOf(identity)) ?? { state: 0, flags: 0, address: [] };
            info.writeInt32LE(session.infoState ?? session.state, INFO_LAYOUT.state);
            info.writeInt32LE(session.flags, INFO_LAYOUT.flags);
            Buffer.from(session.address).copy(info, INFO_LAYOUT.address);
            return session.state;
        },
        SteamAPI_SteamNetworkingMessage_t_Release: (message) => released.push(message),
    };
    const koffi = {
        load(path) {
            calls.push(['load', path]);
            return {
                func(signature) {
                    const name = signature.match(/(SteamAPI_\w+)\(/)[1];
                    if (name === missing) throw new Error(`cannot find function ${name}`);
                    return (...args) => impl[name](...args);
                },
            };
        },
        view(address, length) {
            for (const [base, buffer] of memory) {
                if (address >= base && address < base + BigInt(buffer.length)) {
                    const at = buffer.byteOffset + Number(address - base);
                    return buffer.buffer.slice(at, at + length);
                }
            }
            throw new Error(`no memory at ${address}`);
        },
    };
    /** A SteamNetworkingMessage_t from `sender` holding `payload`, queued for the next read. */
    const deliver = (sender, payload, { identityType = 16 } = {}) => {
        const bytes = Buffer.from(payload);
        const data = allocate(bytes);
        const message = Buffer.alloc(216);
        message.writeBigUInt64LE(data, 0);
        message.writeInt32LE(bytes.length, 8);
        message.writeInt32LE(identityType, 16);
        message.writeInt32LE(8, 20);
        message.writeBigUInt64LE(BigInt(sender), 24);
        const address = allocate(message);
        inbox.push(address);
        return address;
    };
    return {
        koffi, calls, deliver, released, sessions,
    };
}

const open = (steam, options = {}) => openRelayTransport({
    koffi: steam.koffi,
    libraryPath: 'C:/game/steam_api64.dll',
    maxMessageBytes: 64,
    ...options,
});

describe('the relay transport (electron/steam-relay-transport.js)', () => {
    it('turns direct connections off for the whole process before anything else, then opens', () => {
        const steam = fakeSteam();
        const opened = open(steam);
        expect(opened.ok).toBe(true);
        expect(steam.calls[0]).toEqual(['load', 'C:/game/steam_api64.dll']);
        expect(steam.calls[1]).toEqual(['config', 0x2000n, CONFIG_ICE_ENABLE, ICE_DISABLE]);
        expect([CONFIG_ICE_ENABLE, ICE_DISABLE]).toEqual([104, 0]);
        expect(steam.calls[2]).toEqual(['initRelay']);
        expect(opened.transport.kind).toBe('relay');
    });

    it('does not open when Steam will not turn direct connections off', () => {
        const opened = open(fakeSteam({ iceOk: false }));
        expect(opened).toEqual({ ok: false, reason: 'Steam refused to turn off direct connections' });
    });

    it('does not open without koffi, a library, every function, or Steam\'s interfaces', () => {
        expect(openRelayTransport({ koffi: null, libraryPath: 'x' }).reason).toMatch(/koffi/);
        expect(openRelayTransport({ koffi: fakeSteam().koffi, libraryPath: null }).reason).toMatch(/no Steam API library/);
        const missing = open(fakeSteam({ missing: 'SteamAPI_ISteamNetworkingMessages_AcceptSessionWithUser' }));
        expect(missing.ok).toBe(false);
        expect(missing.reason).toMatch(/did not load: cannot find function/);
        expect(open(fakeSteam({ interfaces: false })).reason).toMatch(/not available/);
    });

    it('declares every function it calls from the flat Steam API', () => {
        for (const signature of Object.values(RELAY_FUNCTIONS)) expect(signature).toMatch(/[ *]SteamAPI_\w+\(/);
        expect(RELAY_FUNCTIONS.setGlobalInt32).toContain('SetGlobalConfigValueInt32');
        expect(RELAY_FUNCTIONS.messages).toContain('SteamNetworkingMessages_SteamAPI_v002');
    });

    it('encodes a SteamID identity as Valve lays it out (packed: type 16, size 8, id), 136 bytes', () => {
        const identity = encodeSteamIdentity(HOST);
        expect(identity.length).toBe(IDENTITY_BYTES);
        expect(identity.readInt32LE(0)).toBe(16);
        expect(identity.readInt32LE(4)).toBe(8);
        expect(identity.readBigUInt64LE(8)).toBe(BigInt(HOST));
        expect(identity.subarray(16).every((byte) => byte === 0)).toBe(true);
        expect(decodeSteamIdentity(identity)).toBe(HOST);
        const other = Buffer.from(identity);
        other.writeInt32LE(1, 0);
        expect(decodeSteamIdentity(other)).toBeNull();
    });

    it('sends on channel 0 with the legacy send type\'s flags, re-opening a broken session', () => {
        const steam = fakeSteam();
        const { transport } = open(steam);
        expect(transport.send(HOST, Buffer.from('hello'), 2)).toBe(1);
        expect(transport.send(HOST, new Uint8Array([104, 105]), 0)).toBe(1);
        transport.send(HOST, Buffer.from('a'), 1);
        transport.send(HOST, Buffer.from('b'), 3);
        transport.send(HOST, Buffer.from('c'));
        const sends = steam.calls.filter((call) => call[0] === 'send');
        expect(sends).toEqual([
            ['send', HOST, 'hello', 5, 9 | 32, RELAY_CHANNEL],
            ['send', HOST, 'hi', 2, 0 | 32, RELAY_CHANNEL],
            ['send', HOST, 'a', 1, 5 | 32, RELAY_CHANNEL],
            ['send', HOST, 'b', 1, 8 | 32, RELAY_CHANNEL],
            ['send', HOST, 'c', 1, 9 | 32, RELAY_CHANNEL],
        ]);
        expect(transport.send('not-an-id', Buffer.from('x'))).toBe(0);
        expect(transport.send('0', Buffer.from('x'))).toBe(0);
        expect(steam.calls.filter((call) => call[0] === 'send')).toHaveLength(5);
    });

    it('reads messages in order, copies them out of Steam\'s memory and releases every one', () => {
        const steam = fakeSteam();
        const { transport } = open(steam);
        const first = steam.deliver(HOST, 'one');
        const oversize = steam.deliver(HOST, 'x'.repeat(65));
        const stranger = steam.deliver(PLAYER, 'ip?', { identityType: 1 });
        const second = steam.deliver(PLAYER, 'two');
        expect(transport.peekSize()).toBe(3);
        const a = transport.next();
        expect(a.steamId).toBe(HOST);
        expect(a.data.toString()).toBe('one');
        expect(transport.next()).toMatchObject({ steamId: PLAYER });
        expect(transport.next()).toBeNull();
        expect(steam.released).toEqual([first, oversize, stranger, second]);
        expect(transport.counts()).toEqual({ received: 2, dropped: 2 });
        expect(steam.calls.filter((call) => call[0] === 'receive')[0]).toEqual(['receive', 0, 32]);
    });

    it('asks Steam to accept a session only for the player named', () => {
        const steam = fakeSteam();
        const { transport } = open(steam);
        expect(transport.acceptFrom(PLAYER)).toBe(true);
        expect(transport.acceptFrom(undefined)).toBe(false);
        expect(steam.calls.filter((call) => call[0] === 'accept')).toEqual([['accept', PLAYER]]);
        expect(transport.close(PLAYER)).toBe(true);
        expect(steam.calls.at(-1)).toEqual(['close', PLAYER]);
    });

    it('reads a session: its state, whether it is relayed, whether a peer address is known', () => {
        const steam = fakeSteam();
        const { transport } = open(steam);
        steam.sessions.set(HOST, { state: SESSION_STATE.connected, flags: FLAG_RELAYED, address: [] });
        steam.sessions.set(PLAYER, { state: SESSION_STATE.connected, flags: 0, address: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 192, 168, 1, 2] });
        expect(transport.session(HOST)).toEqual({
            state: SESSION_STATE.connected, relayed: true, addressKnown: false, layoutOk: true,
        });
        expect(transport.session(PLAYER)).toEqual({
            state: SESSION_STATE.connected, relayed: false, addressKnown: true, layoutOk: true,
        });
        // An info block whose own state disagrees is not trusted.
        steam.sessions.set(HOST, {
            state: SESSION_STATE.connected, infoState: 77, flags: 0, address: [],
        });
        expect(transport.session(HOST).layoutOk).toBe(false);
        expect(transport.session('7').state).toBe(SESSION_STATE.none);
    });

    it('names the relay network\'s status, and finds the Steam library per platform', () => {
        const { transport } = open(fakeSteam());
        expect(transport.relayNetworkStatus()).toBe('current');
        const slash = (...parts) => parts.join('/');
        expect(steamApiLibraryPath('sw', 'win32', slash)).toBe('sw/dist/win64/steam_api64.dll');
        expect(steamApiLibraryPath('sw', 'linux', slash)).toBe('sw/dist/linux64/libsteam_api.so');
        expect(steamApiLibraryPath('sw', 'darwin', slash)).toBe('sw/dist/osx/libsteam_api.dylib');
        expect(steamApiLibraryPath(null, 'win32', slash)).toBeNull();
        expect(steamApiLibraryPath('sw', 'aix', slash)).toBeNull();
    });
});

describe('online play goes through the relays or not at all', () => {
    it('describes each mode for the page, with a message only when online play is refused', () => {
        expect(describeNetworkTransport({ mode: 'relay', reason: 'x', relayNetwork: 'current' })).toEqual({
            mode: 'relay', relayOnly: true, reason: null, message: null, relayNetwork: 'current',
        });
        expect(describeNetworkTransport({ mode: 'unavailable', reason: 'koffi did not load' })).toEqual({
            mode: 'unavailable',
            relayOnly: false,
            reason: 'koffi did not load',
            message: RELAY_UNAVAILABLE_MESSAGE,
            relayNetwork: null,
        });
        expect(lobbyAllowed('relay')).toBe(true);
        expect(lobbyAllowed('direct')).toBe(true);
        expect(lobbyAllowed('unavailable')).toBe(false);
        expect(lobbyAllowed('none')).toBe(false);
    });

    it('allows direct connections only to a development run that asks, never to a store build', () => {
        const env = { SERENITY_ALLOW_DIRECT_P2P: '1' };
        expect(allowsDirectP2P({ env })).toBe(true);
        expect(allowsDirectP2P({ env, storeBuild: true })).toBe(false);
        expect(allowsDirectP2P({ env: {} })).toBe(false);
        expect(allowsDirectP2P()).toBe(false);
    });

    it('accepts a relayed session only from a lobby member the game\'s role allows', () => {
        const members = new Set([HOST, PLAYER]);
        const gate = createP2PSessionGate({ accept: () => {}, isMember: (id) => members.has(id) });
        gate.setPolicy({ isHost: false, hostSteamId: HOST });
        expect(gate.allowsSession(HOST)).toBe(true);
        expect(gate.allowsSession(PLAYER)).toBe(false);
        expect(gate.allowsSession('76561198000000001')).toBe(false);
        expect(gate.allowsSession(null)).toBe(false);
        gate.setPolicy({ isHost: true, hostSteamId: PLAYER });
        expect(gate.allowsSession(HOST)).toBe(true);
    });

    it('is wired so: the relay opens first, legacy requests are ignored, lobbies wait for it', () => {
        const source = readFileSync(join(process.cwd(), 'electron', 'steam-integration.js'), 'utf8');
        // the relay opens as soon as Steam is up, before any callback could accept a session
        expect(source.indexOf('startNetworkTransport(steamworksDir);'))
            .toBeLessThan(source.indexOf('registerSteamCallbacks();\n                return true;'));
        // a legacy (direct) session request is accepted only in direct mode
        expect(source).toMatch(/if \(networkMode !== 'direct'\) \{[\s\S]{0,400}return;\s*\}\s*p2pSessionGate\?\.onRequest\(remote\);/);
        // no lobby, and no packet, without the relay (or a development run's permission)
        expect(source.match(/if \(!lobbyAllowed\(networkMode\)\) throw new Error\(RELAY_UNAVAILABLE_MESSAGE\);/g)).toHaveLength(2);
        expect(source).toContain("if (!lobbyAllowed(networkMode)) return { sent: false, wireBytes: 0, refused: 'no-relay' };");
        // the direct fallback is decided by the store-build check
        expect(source).toContain('storeBuild: isStoreBuild({ isPackaged: app.isPackaged }),');
        // sessions are accepted only for members the gate allows
        expect(source).toContain('p2pSessionGate?.allowsSession(steamId) && relayTransport.acceptFrom(steamId)');
    });
});

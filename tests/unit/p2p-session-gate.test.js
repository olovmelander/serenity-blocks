import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
    P2P_SESSION_WAIT_MS, createP2PSessionGate, normalizeP2PPeerPolicy,
} from '../../electron/p2p-session-gate.js';

function setup(members = []) {
    const lobby = new Set(members);
    let t = 1000;
    const accept = vi.fn();
    const gate = createP2PSessionGate({ accept, isMember: (id) => lobby.has(id), now: () => t });
    return { gate, accept, lobby, advance: (ms) => { t += ms; } };
}

describe('P2P session gate (electron/p2p-session-gate.js)', () => {
    it('accepts a lobby member at once', () => {
        const { gate, accept } = setup(['111']);
        expect(gate.onRequest(111n)).toBe(true);
        expect(accept).toHaveBeenCalledWith('111');
    });

    it('never accepts someone outside the lobby, and forgets them after the wait', () => {
        const { gate, accept, advance } = setup(['111']);
        expect(gate.onRequest('999')).toBe(false);
        gate.onMembersChanged();
        advance(P2P_SESSION_WAIT_MS + 1);
        gate.onMembersChanged();
        expect(accept).not.toHaveBeenCalled();
        expect(gate.pendingCount).toBe(0);
    });

    it('accepts a request that arrived just before its sender was listed in the lobby', () => {
        const { gate, accept, lobby, advance } = setup([]);
        expect(gate.onRequest('222')).toBe(false);
        advance(2000);
        lobby.add('222');
        gate.onMembersChanged();
        expect(accept).toHaveBeenCalledWith('222');
        expect(gate.pendingCount).toBe(0);
    });

    it('drops every held request when the lobby is left', () => {
        const { gate, accept, lobby } = setup([]);
        gate.onRequest('333');
        gate.clear();
        lobby.add('333');
        gate.onMembersChanged();
        expect(accept).not.toHaveBeenCalled();
    });

    it('ignores an empty sender and survives a failing accept', () => {
        const accept = vi.fn(() => { throw new Error('boom'); });
        const log = vi.fn();
        const gate = createP2PSessionGate({ accept, isMember: () => true, log });
        expect(gate.onRequest(null)).toBe(false);
        expect(gate.onRequest('444')).toBe(true);
        expect(log).toHaveBeenCalledWith(expect.stringContaining('failed to accept'));
    });
});

describe('P2P session gate: a match is a star through its host', () => {
    const HOST = '76561198000000001';
    const ALICE = '76561198000000002';
    const BOB = '76561198000000003';

    it('a player accepts the host and refuses another member of the lobby', () => {
        const { gate, accept, advance } = setup([HOST, ALICE, BOB]);
        gate.setPolicy({ isHost: false, hostSteamId: HOST });

        expect(gate.onRequest(ALICE)).toBe(false);
        expect(gate.onRequest(HOST)).toBe(true);
        expect(accept.mock.calls).toEqual([[HOST]]);

        // The held request is dropped after the wait, never accepted.
        advance(P2P_SESSION_WAIT_MS + 1);
        gate.onMembersChanged();
        expect(accept).toHaveBeenCalledTimes(1);
        expect(gate.pendingCount).toBe(0);
    });

    it('a host accepts every member of its lobby, and still nobody outside it', () => {
        const { gate, accept } = setup([HOST, ALICE, BOB]);
        gate.setPolicy({ isHost: true, hostSteamId: HOST });
        expect(gate.onRequest(ALICE)).toBe(true);
        expect(gate.onRequest(BOB)).toBe(true);
        expect(gate.onRequest('76561198000000099')).toBe(false);
        expect(accept.mock.calls).toEqual([[ALICE], [BOB]]);
    });

    it('the allowed player follows a host change, and a held request from the new host is taken', () => {
        const { gate, accept } = setup([HOST, ALICE, BOB]);
        gate.setPolicy({ isHost: false, hostSteamId: HOST });
        expect(gate.onRequest(ALICE)).toBe(false);

        gate.setPolicy({ isHost: false, hostSteamId: ALICE });
        expect(accept.mock.calls).toEqual([[ALICE]]);
        // The old host is now only another member.
        expect(gate.onRequest(HOST)).toBe(false);
        expect(gate.onRequest(BOB)).toBe(false);
        expect(accept).toHaveBeenCalledTimes(1);
    });

    it('while the host looks gone mid-match, the member taking over is accepted, as before', () => {
        const { gate, accept } = setup([HOST, ALICE, BOB]);
        gate.setPolicy({ isHost: false, hostSteamId: HOST });
        expect(gate.onRequest(ALICE)).toBe(false); // the claim is a moment ahead of this player

        gate.setPolicy({ isHost: false, hostSteamId: HOST, hostSuspected: true });
        expect(accept.mock.calls).toEqual([[ALICE]]);
        expect(gate.onRequest(BOB)).toBe(true);
        expect(gate.onRequest('76561198000000099')).toBe(false); // never outside the lobby

        // The new host is followed: the handover is over.
        gate.setPolicy({ isHost: false, hostSteamId: ALICE, hostSuspected: false });
        expect(gate.allowsSend(BOB)).toBe(false);
        expect(gate.allowsSend(ALICE)).toBe(true);
    });

    it('a player sends to the host alone; a host, and a game with no role yet, to anyone', () => {
        const log = vi.fn();
        const gate = createP2PSessionGate({ accept: vi.fn(), isMember: () => true, log });
        expect(gate.allowsSend(ALICE)).toBe(true); // no role yet: as before

        gate.setPolicy({ isHost: false, hostSteamId: HOST });
        expect(gate.allowsSend(HOST)).toBe(true);
        expect(gate.allowsSend(BigInt(HOST))).toBe(true);
        expect(gate.allowsSend(ALICE)).toBe(false);
        expect(gate.allowsSend(ALICE)).toBe(false);
        expect(gate.allowsSend(null)).toBe(false);
        // One log line for the refused player, not one per packet.
        expect(log.mock.calls.filter(([line]) => line.includes('Refused to send'))).toHaveLength(1);

        gate.setPolicy({ isHost: false, hostSteamId: HOST, hostSuspected: true });
        expect(gate.allowsSend(ALICE)).toBe(true); // the one claim a player taking over sends

        gate.setPolicy({ isHost: true, hostSteamId: ALICE });
        expect(gate.allowsSend(BOB)).toBe(true);
    });

    it('reads a malformed role as a player with no host, and forgets the role with the lobby', () => {
        const { gate, accept } = setup([HOST, ALICE]);
        gate.setPolicy({ isHost: 'yes', hostSteamId: { toString: () => HOST }, hostSuspected: 1 });
        expect(gate.policy).toEqual({ isHost: false, hostSteamId: null, hostSuspected: false });
        expect(gate.onRequest(HOST)).toBe(false);
        expect(gate.allowsSend(HOST)).toBe(false);
        expect(accept).not.toHaveBeenCalled();

        expect(normalizeP2PPeerPolicy(null)).toBeNull();
        expect(normalizeP2PPeerPolicy('host')).toEqual({ isHost: false, hostSteamId: null, hostSuspected: false });
        expect(normalizeP2PPeerPolicy({ isHost: true, hostSteamId: BigInt(HOST) }))
            .toEqual({ isHost: true, hostSteamId: HOST, hostSuspected: false });

        gate.clear();
        expect(gate.policy).toBeNull();
        expect(gate.onRequest(ALICE)).toBe(true); // any lobby member, as before a role is set
    });
});

describe('P2P session gate wiring (electron/steam-integration.js)', () => {
    const read = (file) => readFileSync(new URL(`../../electron/${file}`, import.meta.url), 'utf8');
    const integration = read('steam-integration.js');
    const handler = (channel) => {
        const start = integration.indexOf(`ipcMain.handle('${channel}'`);
        expect(start, channel).toBeGreaterThan(-1);
        return integration.slice(start, integration.indexOf('ipcMain.handle(', start + 1));
    };

    it('a created lobby is hosted; a joined one talks to its owner until the game names its host', () => {
        const create = handler('steam:createLobby');
        expect(create.indexOf('p2pSessionGate?.clear();')).toBeGreaterThan(-1);
        expect(create.indexOf('p2pSessionGate?.setPolicy({ isHost: true, hostSteamId: steamSteamId });'))
            .toBeGreaterThan(create.indexOf('p2pSessionGate?.clear();'));
        const join = handler('steam:joinLobby');
        expect(join).toContain('ownerId = currentLobby?.getOwner?.()?.steamId64?.toString() ?? null;');
        expect(join.indexOf('p2pSessionGate?.setPolicy({ isHost: false, hostSteamId: ownerId });'))
            .toBeGreaterThan(join.indexOf('p2pSessionGate?.clear();'));
        expect(join.indexOf('p2pSessionGate?.clear();')).toBeGreaterThan(-1);
        expect(handler('steam:leaveLobby')).toContain('p2pSessionGate?.clear();');
    });

    it('nothing is sent to a player the gate does not allow', () => {
        const send = handler('steam:sendP2PPacket');
        const refuse = send.indexOf('if (p2pSessionGate && !p2pSessionGate.allowsSend(steamId)) {');
        expect(refuse).toBeGreaterThan(-1);
        expect(refuse).toBeLessThan(send.indexOf('networking.sendP2PPacket('));
    });

    it('the game\'s page can tell its role, in a lobby only, through every preload', () => {
        expect(handler('steam:setP2PPeerPolicy')).toMatch(
            /if \(!currentLobby \|\| !p2pSessionGate\) return false;\s*p2pSessionGate\.setPolicy\(/,
        );
        for (const file of ['preload.cjs', 'preload.mjs', 'main.js']) {
            expect(read(file), file).toContain("'steam:setP2PPeerPolicy'");
        }
    });
});

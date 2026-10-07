/**
 * @fileoverview Tests for FFAGameStateP2P._verifyHostReassignment — the guard
 * that decides whether a peer may repoint hostSteamId via a host-migration
 * message. The key property: a peer may NOT seize a live, healthy host. It may
 * name itself once the host is gone here (an election is on, or the host has been
 * quiet), and only if no candidate ranked before it is this peer; the current host
 * may hand off to anyone (network/host-migration.js).
 */

import { describe, it, expect } from 'vitest';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';
import { HOST_SUSPECT_MS, HostMigration } from '../../src/core/network/host-migration.js';

function verify(stub, sender, claimed) {
    return FFAGameStateP2P.prototype._verifyHostReassignment.call(stub, sender, claimed);
}

/** Local peer 'P_MID' in a roster of P_LOW < P_MID < P_TOP, under host 'HOST'. */
function makeStub({ election = false, hostQuietMs = 0, local = 'P_MID' } = {}) {
    const ids = ['HOST', 'P_LOW', 'P_MID', 'P_TOP'];
    const stub = {
        localPlayerId: local,
        isHost: false,
        players: new Map(ids.map((id) => [id, { steamId: id }])),
        network: { hostSteamId: 'HOST', peerSilenceMs: () => hostQuietMs },
    };
    stub.hostMigration = new HostMigration(stub);
    stub.hostMigration.isElectionInProgress = election;
    return stub;
}

describe('FFAGameStateP2P._verifyHostReassignment', () => {
    it('REJECTS a lowest-id peer trying to seize a live host (no election, host heard)', () => {
        expect(verify(makeStub({ election: false }), 'P_LOW', 'P_LOW')).toBe(false);
    });

    it('accepts a candidate ranked first naming itself during an active election', () => {
        expect(verify(makeStub({ election: true }), 'P_LOW', 'P_LOW')).toBe(true);
    });

    it('accepts it before this peer\'s own monitor fires, once the host has been quiet here too', () => {
        expect(verify(makeStub({ hostQuietMs: HOST_SUSPECT_MS - 1 }), 'P_LOW', 'P_LOW')).toBe(false);
        expect(verify(makeStub({ hostQuietMs: HOST_SUSPECT_MS }), 'P_LOW', 'P_LOW')).toBe(true);
    });

    it('accepts a planned handoff announced by the current host (no election needed)', () => {
        expect(verify(makeStub({ election: false }), 'HOST', 'P_LOW')).toBe(true);
    });

    it('rejects a candidate ranked after this peer: it follows us, not we it', () => {
        expect(verify(makeStub({ election: true }), 'P_TOP', 'P_TOP')).toBe(false);
    });

    it('rejects a sender who is not a present candidate', () => {
        const stub = makeStub({ election: true });
        expect(verify(stub, 'STRANGER', 'STRANGER')).toBe(false);
        stub.players.get('P_LOW').isDisconnected = true;
        expect(verify(stub, 'P_LOW', 'P_LOW')).toBe(false);
    });

    it('rejects a peer naming someone other than itself', () => {
        expect(verify(makeStub({ election: true }), 'P_LOW', 'SOMEONE_ELSE')).toBe(false);
    });

    it('rejects missing sender or claimed-host ids', () => {
        expect(verify(makeStub(), null, 'X')).toBe(false);
        expect(verify(makeStub(), 'X', null)).toBe(false);
    });
});

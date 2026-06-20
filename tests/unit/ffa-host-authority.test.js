/**
 * @fileoverview Tests for FFAGameStateP2P._verifyHostReassignment — the guard
 * that decides whether a peer may repoint hostSteamId via a host-migration
 * message. The key property: a peer may NOT seize a live, healthy host; it may
 * only assert authority during an active successor election (or the current host
 * may hand off). Tested directly on the prototype with a stub `this` to avoid
 * constructing the full networked instance (remediation review follow-up).
 */

import { describe, it, expect } from 'vitest';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';

function verify(stub, sender, claimed) {
    return FFAGameStateP2P.prototype._verifyHostReassignment.call(stub, sender, claimed);
}

function makeStub({ host = 'HOST', election = false, candidate = 'PEER_LOW' } = {}) {
    return {
        network: { hostSteamId: host },
        hostMigration: {
            isElectionInProgress: election,
            _getExpectedHostCandidateId: () => candidate,
        },
    };
}

describe('FFAGameStateP2P._verifyHostReassignment', () => {
    it('REJECTS a lowest-id peer trying to seize a live host (no election in progress)', () => {
        // This is the takeover hole the fix closes: without the election gate,
        // the expected candidate could repoint hostSteamId at any time.
        expect(verify(makeStub({ election: false, candidate: 'PEER_LOW' }), 'PEER_LOW', 'PEER_LOW')).toBe(false);
    });

    it('accepts the elected candidate naming itself during an active election', () => {
        expect(verify(makeStub({ election: true, candidate: 'PEER_LOW' }), 'PEER_LOW', 'PEER_LOW')).toBe(true);
    });

    it('accepts a planned handoff announced by the current host (no election needed)', () => {
        expect(verify(makeStub({ host: 'HOST', election: false }), 'HOST', 'PEER_LOW')).toBe(true);
    });

    it('rejects a non-candidate peer even during an election', () => {
        expect(verify(makeStub({ election: true, candidate: 'PEER_LOW' }), 'PEER_HIGH', 'PEER_HIGH')).toBe(false);
    });

    it('rejects a peer naming someone other than itself', () => {
        expect(verify(makeStub({ election: true, candidate: 'PEER_LOW' }), 'PEER_LOW', 'SOMEONE_ELSE')).toBe(false);
    });

    it('rejects missing sender or claimed-host ids', () => {
        expect(verify(makeStub(), null, 'X')).toBe(false);
        expect(verify(makeStub(), 'X', null)).toBe(false);
    });
});

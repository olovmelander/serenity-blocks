/**
 * Plan §1.2 — desync-detection backstop pinning tests.
 *
 * Regression this pins: both divergence branches in syncFromHost gate on
 * this._desyncCheckEnabled, which was NEVER initialized (setDesyncDetection had
 * zero callers) — the peer-local-sim safety net the constructor's own design
 * note calls load-bearing was silently dead, so a genuine sim divergence
 * produced a permanently drifted peer board.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';

function makePeerStub(overrides = {}) {
    return Object.assign(Object.create(FFAGameStateP2P.prototype), {
        isHost: false,
        localPlayerId: 'P1',
        inputSequence: 10,
        _desyncCheckEnabled: true,
        _peerLocalSimEnabled: true,
        _desyncCount: 0,
        _lastResyncAt: 0,
        players: new Map([
            ['P1', { gameState: { score: 100, lines: 2, isProcessingPhysics: false } }],
        ]),
        _requestResync: vi.fn(),
        _applySnapshotState: vi.fn(),
        ...overrides,
    });
}

// Host snapshot for the local player. Defaults simulate a TRUE divergence:
// host has caught up (lastInputSeq >= inputSequence) yet score/lines differ.
function hostSnapshot({ score = 0, lines = 0, lastInputSeq = 10 } = {}) {
    return { players: [{ steamId: 'P1', score, lines, lastInputSeq }] };
}

const sync = (stub, snap) => stub.syncFromHost(snap);

describe('desync detection backstop (peer-local-sim path)', () => {
    it('fires exactly one resync after 3 consecutive confirmed mismatches', () => {
        const stub = makePeerStub();
        sync(stub, hostSnapshot());
        sync(stub, hostSnapshot());
        expect(stub._requestResync).not.toHaveBeenCalled(); // < threshold
        sync(stub, hostSnapshot());
        expect(stub._requestResync).toHaveBeenCalledTimes(1);
        // Rate limit (3 s): further confirmed mismatches do NOT re-fire immediately.
        sync(stub, hostSnapshot());
        sync(stub, hostSnapshot());
        sync(stub, hostSnapshot());
        expect(stub._requestResync).toHaveBeenCalledTimes(1);
    });

    it('a transient mismatch (snapshot-adoption race) never triggers', () => {
        const stub = makePeerStub();
        sync(stub, hostSnapshot());
        sync(stub, hostSnapshot());
        sync(stub, hostSnapshot({ score: 100, lines: 2 })); // clean → counter resets
        sync(stub, hostSnapshot());
        sync(stub, hostSnapshot());
        expect(stub._requestResync).not.toHaveBeenCalled();
    });

    it('running ahead of the host (not caught up) is expected, not a desync', () => {
        const stub = makePeerStub();
        for (let i = 0; i < 5; i += 1) sync(stub, hostSnapshot({ lastInputSeq: 5 }));
        expect(stub._requestResync).not.toHaveBeenCalled();
        expect(stub._desyncCount).toBe(0);
    });

    it('mid-cascade (not settled) divergence does not count', () => {
        const stub = makePeerStub();
        stub.players.get('P1').gameState.isProcessingPhysics = true;
        for (let i = 0; i < 5; i += 1) sync(stub, hostSnapshot());
        expect(stub._requestResync).not.toHaveBeenCalled();
    });

    it('the un-initialized flag (the pre-fix regression state) silently disables the net', () => {
        const stub = makePeerStub({ _desyncCheckEnabled: undefined });
        for (let i = 0; i < 5; i += 1) sync(stub, hostSnapshot());
        expect(stub._requestResync).not.toHaveBeenCalled();
    });

    it('?desyncCheck=0 disables detection', () => {
        const stub = makePeerStub({ _desyncCheckEnabled: false });
        for (let i = 0; i < 5; i += 1) sync(stub, hostSnapshot());
        expect(stub._requestResync).not.toHaveBeenCalled();
    });

    it('snapshot adoption itself is unaffected by detection outcome', () => {
        const stub = makePeerStub();
        const snap = hostSnapshot();
        sync(stub, snap);
        expect(stub._applySnapshotState).toHaveBeenCalledWith(
            snap,
            { forceLocal: false, reconcileLocal: true },
        );
    });
});

describe('desync flag wiring (regression tripwire)', () => {
    it('the constructor initializes _desyncCheckEnabled from the desyncCheck flag, default ON', () => {
        const src = readFileSync(
            new URL('../../src/core/multiplayer/ffa-p2p-game-state.js', import.meta.url),
            'utf8',
        );
        // This exact line is what was missing pre-fix; its deletion re-kills the
        // safety net silently, so pin it at source level.
        expect(src).toMatch(/this\._desyncCheckEnabled = readNetFlag\('desyncCheck', true\);/);
    });
});

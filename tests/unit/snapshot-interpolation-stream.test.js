/**
 * A new host or a new lobby starts its snapshot count over. Those snapshots must start a
 * new stream, not be dropped as stale until the count passes the old match's.
 */
import { describe, expect, it } from 'vitest';
import { SnapshotInterpolator } from '../../src/core/network/snapshot-interpolation.js';

const snap = (snapshotSeq, x) => ({
    snapshotSeq,
    timestamp: snapshotSeq * 33,
    players: [{ steamId: 'A', grid: [], currentPiece: { type: 'T', x, y: 0, rotation: 0 } }],
});

describe('snapshot interpolation streams', () => {
    it('starts over when the count restarts far behind (new host or lobby)', () => {
        const interp = new SnapshotInterpolator({ interpolationDelay: 0 });
        for (let seq = 1000; seq < 1005; seq += 1) interp.addSnapshot(snap(seq, 1), { receivedAt: seq * 33 });
        interp.addSnapshot(snap(1, 7), { receivedAt: 50_000 });
        interp.addSnapshot(snap(2, 8), { receivedAt: 50_033 });

        expect(interp.playerBuffers.get('A').map((entry) => entry.data.currentPiece.x)).toEqual([7, 8]);
    });

    it('still drops a straggler from the same stream', () => {
        const interp = new SnapshotInterpolator({ interpolationDelay: 0 });
        interp.addSnapshot(snap(10, 1), { receivedAt: 330 });
        interp.addSnapshot(snap(9, 2), { receivedAt: 340 });
        expect(interp.playerBuffers.get('A')).toHaveLength(1);
        expect(interp.getStats('A').droppedSnapshots).toBe(1);
    });

    it('forgets everyone on reset', () => {
        const interp = new SnapshotInterpolator();
        interp.addSnapshot(snap(5, 1), { receivedAt: 1 });
        interp.reset();
        expect(interp.getInterpolatedState('A', 10)).toBeNull();
    });

    it('plays adaptively only when told the match runs on the fixed clock (audit N11)', () => {
        const interp = new SnapshotInterpolator({ interpolationDelay: 120, adaptive: true, minInterpolationDelay: 100 });
        interp.setAdaptive(false, 90);
        expect(interp.adaptive).toBe(false);
        expect(interp.getInterpolationDelay('A')).toBe(90);
        interp.setAdaptive(true);
        expect(interp.getInterpolationDelay('A')).toBe(100);
    });
});

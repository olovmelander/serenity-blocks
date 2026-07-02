import { describe, expect, it } from 'vitest';
import { SnapshotInterpolator } from '../../src/core/network/snapshot-interpolation.js';

function makeSnapshot({
    snapshotSeq,
    simTick,
    receivedAt,
    x,
    roundGeneration = 1,
}) {
    return {
        snapshotSeq,
        simTick,
        roundGeneration,
        timestamp: receivedAt,
        players: [{
            steamId: 'remote',
            currentPiece: {
                type: 'I',
                shape: [[1, 1, 1, 1]],
                x,
                y: 0,
                rotation: 0,
                color: '#00ffff',
            },
            grid: [],
        }],
    };
}

describe('SnapshotInterpolator', () => {
    it('can drive interpolation from simTick instead of jittery arrival spacing', () => {
        const interpolator = new SnapshotInterpolator({
            adaptive: true,
            interpolationDelay: 20,
            minInterpolationDelay: 20,
            maxInterpolationDelay: 100,
            jitterSafetyMultiplier: 0,
            simTickMs: 10,
        });

        interpolator.addSnapshot(makeSnapshot({
            snapshotSeq: 1, simTick: 100, receivedAt: 1000, x: 0,
        }), { receivedAt: 1000 });
        interpolator.addSnapshot(makeSnapshot({
            snapshotSeq: 2, simTick: 102, receivedAt: 1060, x: 2,
        }), { receivedAt: 1060 });
        interpolator.addSnapshot(makeSnapshot({
            snapshotSeq: 3, simTick: 104, receivedAt: 1080, x: 4,
        }), { receivedAt: 1080 });

        const rendered = interpolator.getInterpolatedState('remote', 1050);

        expect(rendered.currentPiece.x).toBeCloseTo(3, 5);
        expect(interpolator.getStats('remote').jitterMs).toBeGreaterThan(0);
    });

    it('raises adaptive delay when arrival jitter exceeds the host timeline gap', () => {
        const interpolator = new SnapshotInterpolator({
            adaptive: true,
            interpolationDelay: 20,
            minInterpolationDelay: 20,
            maxInterpolationDelay: 50,
            jitterSafetyMultiplier: 2,
            jitterEwmaAlpha: 1,
            simTickMs: 10,
        });

        interpolator.addSnapshot(makeSnapshot({
            snapshotSeq: 1, simTick: 0, receivedAt: 1000, x: 0,
        }), { receivedAt: 1000 });
        interpolator.addSnapshot(makeSnapshot({
            snapshotSeq: 2, simTick: 2, receivedAt: 1100, x: 2,
        }), { receivedAt: 1100 });

        const stats = interpolator.getStats('remote');
        expect(stats.jitterMs).toBeCloseTo(80, 5);
        expect(stats.interpolationDelay).toBe(50);
    });

    it('drops older sequence numbers without disturbing the accepted buffer', () => {
        const interpolator = new SnapshotInterpolator({
            adaptive: true,
            interpolationDelay: 20,
            minInterpolationDelay: 20,
            simTickMs: 10,
        });

        interpolator.addSnapshot(makeSnapshot({
            snapshotSeq: 2, simTick: 100, receivedAt: 1000, x: 2,
        }), { receivedAt: 1000 });
        interpolator.addSnapshot(makeSnapshot({
            snapshotSeq: 1, simTick: 101, receivedAt: 1010, x: 1,
        }), { receivedAt: 1010 });

        const stats = interpolator.getStats('remote');
        const rendered = interpolator.getInterpolatedState('remote', 1020);

        expect(stats.snapshots).toBe(1);
        expect(stats.droppedSnapshots).toBe(1);
        expect(stats.bufferSize).toBe(1);
        expect(rendered.currentPiece.x).toBe(2);
    });
});

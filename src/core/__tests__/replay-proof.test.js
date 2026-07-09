import { describe, expect, it } from 'vitest';
import { buildReplayProof } from '../anti-cheat/replay-proof.js';

describe('replay proof hardening', () => {
    const demo = {
        version: '1.0',
        gameMode: 'single-player',
        timestamp: 123,
        initialState: {
            seed: 42,
            level: 1,
            dropInterval: 1000,
            settings: { themeBasedTetrominos: false },
            rulesVersion: '1.0',
        },
        inputs: [
            { t: 10, a: 'move', d: 1 },
            { t: 30, a: 'rotate', d: 'right' },
        ],
        metadata: {
            finalScore: 100,
            linesCleared: 2,
            level: 1,
            duration: 5000,
        },
    };

    it('verifies demos with seed and monotonic input log', async () => {
        const proof = await buildReplayProof({
            demo,
            expectedScore: 100,
            expectedLines: 2,
            expectedLevel: 1,
            expectedDurationMs: 5000,
        });

        expect(proof.verified).toBe(true);
        expect(proof.seed).toBe(42);
        expect(proof.inputCount).toBe(2);
    });

    it('rejects demos with missing seed or non-monotonic inputs', async () => {
        const proof = await buildReplayProof({
            demo: {
                ...demo,
                initialState: { ...demo.initialState, seed: undefined },
                inputs: [
                    { t: 50, a: 'move', d: 1 },
                    { t: 20, a: 'rotate', d: 'right' },
                ],
            },
        });

        expect(proof.verified).toBe(false);
        expect(proof.issues).toContain('missing_seed');
        expect(proof.issues).toContain('input_order_mismatch');
    });
});

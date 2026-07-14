/**
 * Metamorphic determinism + purity property for the pure §5.2 resolveCascade
 * (remediation plan §3b.7 — the fast-check "metamorphic determinism" property
 * the plan calls for, applied to the resolver, which is deterministic by
 * design). Complements cascade-resolver-differential.test.js (resolver-vs-legacy
 * equivalence) with resolver-vs-ITSELF self-consistency over a fuzzed input
 * space.
 *
 * Two invariants, over bounded random boards (full rows + scattered blocks so
 * cascades actually fire):
 *  1. DETERMINISM — the same input resolved twice yields an identical result and
 *     an identical settled-board digest. A regression that leaks Math.random /
 *     Date.now / object-identity iteration order into the pure core (the exact
 *     classes the §3d fitness ratchet bans statically) fails here behaviourally.
 *  2. PURITY — the resolver owns working copies (clonePieces); the caller's
 *     lockedPieces array is never mutated.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { resolveCascade } from '../../src/core/cascade-resolver.js';
import { computeBoardDigest } from '../../src/core/demo/demo-state.js';
import { COLS, ROWS, HIDDEN_ROWS } from '../../src/core/constants.js';

const BOTTOM = ROWS + HIDDEN_ROWS - 1;

// Piece shapes mirror cascade-resolver-differential.test.js's factories.
const fullRow = (y, id) => ({
    pieceId: id, color: '#666', type: 'garbage', x: 0, y, shape: [Array(COLS).fill(1)],
});
const block = (x, y, id) => ({
    pieceId: id, color: '#888', type: 'block', x, y, shape: [[1]],
});

const rowArb = fc.integer({ min: HIDDEN_ROWS, max: BOTTOM });
const cellArb = fc.record({
    x: fc.integer({ min: 0, max: COLS - 1 }),
    y: fc.integer({ min: HIDDEN_ROWS, max: BOTTOM }),
});
const contextArb = fc.record({
    level: fc.integer({ min: 1, max: 20 }),
    lines: fc.integer({ min: 0, max: 300 }),
    linesUntilNextLevel: fc.integer({ min: 1, max: 15 }),
    b2bActive: fc.boolean(),
});

function buildPieces(fullRows, cells) {
    const pieces = [];
    fullRows.forEach((y, i) => pieces.push(fullRow(y, `row-${i}`)));
    cells.forEach((c, i) => pieces.push(block(c.x, c.y, `blk-${i}`)));
    return pieces;
}

function makeContext(c) {
    return {
        level: c.level,
        lines: c.lines,
        linesUntilNextLevel: c.linesUntilNextLevel,
        dropInterval: 800,
        disableLevelProgression: false,
        b2bActive: c.b2bActive,
        comboState: { lockFootprint: [], manualColumns: [] },
    };
}

describe('resolveCascade — metamorphic determinism & purity (plan §3b.7 / §5.2)', () => {
    it('resolves deterministically and never mutates its input', () => {
        fc.assert(
            fc.property(
                fc.uniqueArray(rowArb, { maxLength: 6 }),
                fc.array(cellArb, { maxLength: 24 }),
                contextArb,
                (fullRows, cells, ctxRaw) => {
                    const pieces = buildPieces(fullRows, cells);
                    const ctx = makeContext(ctxRaw);
                    const before = JSON.stringify(pieces);

                    const r1 = resolveCascade(pieces, ctx);
                    // PURITY: the caller's input is untouched.
                    expect(JSON.stringify(pieces)).toBe(before);

                    // DETERMINISM: identical input → identical result + digest.
                    const r2 = resolveCascade(pieces, ctx);
                    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
                    expect(computeBoardDigest(r1.boardAfter)).toBe(computeBoardDigest(r2.boardAfter));
                },
            ),
            { numRuns: 200 },
        );
    });
});

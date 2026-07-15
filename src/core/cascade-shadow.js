/**
 * §5.10 production differential (shadow mode) for the §5.2 resolver.
 *
 * When the `cascadeShadow` flag is on, every piece lock arms a sample (deep
 * clone of the resolver inputs) before legacy `processPhysics` runs, and
 * settles it when the legacy path completes: the pure `resolveCascade` is run
 * on the cloned inputs and its result is diffed against what legacy actually
 * wrote to gameState — board digest, score, lines/level/dropInterval, B2B,
 * hole-mask matrix (the plan's abort criterion), and lineClearCounts.
 *
 * A sample is DISCARDED (never counted clean or divergent) when the board was
 * mutated outside the lock path while physics ran — garbage insertion,
 * snapshot restore, or a game reset all bump `gameState.boardMutationEpoch`
 * (plan §5.10: "garbage insertion mutates the board outside the lock path").
 *
 * Read the soak tally via `getCascadeShadowStats()` (or the divergence logs,
 * capped at 5/session). The §5.10 legacy-deletion gate wants ≥50 clean
 * sessions before the resolver cutover.
 */
import { readFlag } from './flags.js';
import { resolveCascade } from './cascade-resolver.js';
import { computeBoardDigest } from './demo/demo-state.js';

// Extent guard for Infinity-mode boards: cloning + digesting thousands of
// pieces per lock is real per-lock cost; those samples are skipped and
// counted, not silently dropped (plan §5.10 wants Infinity handled by
// bounded digests — a later refinement).
const MAX_SHADOW_PIECES = 600;
const MAX_LOGGED_DIVERGENCES = 5;

const stats = {
    armed: 0, clean: 0, divergent: 0, discarded: 0, skipped: 0,
};
let loggedDivergences = 0;

/** @returns {boolean} whether shadow mode is enabled this session */
export function cascadeShadowEnabled() {
    return readFlag('cascadeShadow', false);
}

/** Soak tally — the §5.10 gate counts clean sessions from this. */
export function getCascadeShadowStats() {
    return { ...stats };
}

/** Test seam. */
export function resetCascadeShadowStats() {
    stats.armed = 0;
    stats.clean = 0;
    stats.divergent = 0;
    stats.discarded = 0;
    stats.skipped = 0;
    loggedDivergences = 0;
}

function clonePieces(pieces) {
    return pieces.map((p) => ({ ...p, shape: p.shape.map((row) => row.slice()) }));
}

/**
 * Snapshot the resolver inputs at the lock tap point, BEFORE legacy
 * processPhysics starts mutating. Returns null when the sample is skipped.
 * @param {Object} gameState
 * @returns {Object|null} an opaque sample for settleCascadeShadow
 */
export function armCascadeShadow(gameState) {
    if (!gameState || !Array.isArray(gameState.lockedPieces)) return null;
    if (gameState.lockedPieces.length > MAX_SHADOW_PIECES) {
        stats.skipped += 1;
        return null;
    }
    stats.armed += 1;
    return {
        pieces: clonePieces(gameState.lockedPieces),
        context: {
            boardHeight: gameState.boardGrid ? gameState.boardGrid.length : undefined,
            level: gameState.level,
            lines: gameState.lines,
            linesUntilNextLevel: gameState.linesUntilNextLevel,
            dropInterval: gameState.dropInterval,
            disableLevelProgression: gameState.disableLevelProgression,
            b2bActive: gameState.b2bActive,
            speedMultiplier: gameState.speedMultiplier,
            lastPlacedPieceX: Array.isArray(gameState.lastPlacedPieceX)
                ? gameState.lastPlacedPieceX.slice() : gameState.lastPlacedPieceX,
            comboState: gameState.comboState
                ? JSON.parse(JSON.stringify(gameState.comboState)) : undefined,
            comboMultiplierEnabled: gameState.comboMultiplierEnabled,
            comboMultiplier: gameState.comboMultiplier,
            comboCount: gameState.comboCount,
        },
        before: {
            score: gameState.score,
            epoch: gameState.boardMutationEpoch || 0,
            lineClearCounts: { ...(gameState.lineClearCounts || {}) },
        },
    };
}

/**
 * After legacy processPhysics completes: run the pure resolver on the armed
 * inputs and diff against what legacy wrote.
 * @param {Object|null} sample - from armCascadeShadow
 * @param {Object} gameState - the same state legacy just finished mutating
 * @returns {{status: 'skipped'|'discarded'|'divergent'|'clean', diffs?: Array}}
 */
export function settleCascadeShadow(sample, gameState) {
    if (!sample) return { status: 'skipped' };
    if (
        gameState.isGameOver
        || gameState.isStopped
        || (gameState.boardMutationEpoch || 0) !== sample.before.epoch
    ) {
        stats.discarded += 1;
        return { status: 'discarded' };
    }

    const diffs = [];
    const check = (field, expected, actual) => {
        if (expected !== actual) diffs.push({ field, expected, actual });
    };

    let result;
    try {
        result = resolveCascade(sample.pieces, sample.context);
    } catch (error) {
        diffs.push({ field: 'resolver-throw', expected: 'no throw', actual: String(error && error.message) });
    }

    if (result) {
        check('boardDigest', computeBoardDigest(result.boardAfter), computeBoardDigest(gameState.boardGrid));
        check('score', sample.before.score + result.scoreDelta, gameState.score);
        check('lines', result.linesAfter, gameState.lines);
        check('level', result.levelAfter, gameState.level);
        check('linesUntilNextLevel', result.linesUntilNextLevelAfter, gameState.linesUntilNextLevel);
        check('dropInterval', result.dropIntervalAfter, gameState.dropInterval);
        check('b2bActive', result.b2bActiveAfter, Boolean(gameState.b2bActive));
        check('pieceCount', result.lockedPiecesAfter.length, gameState.lockedPieces.length);
        if (gameState.comboState) {
            check('comboState.depth', result.comboStateAfter.depth, gameState.comboState.depth);
            check('comboState.complexity', result.comboStateAfter.complexity, gameState.comboState.complexity);
            check('comboState.sendForPerfectClear', Boolean(result.comboStateAfter.sendForPerfectClear), Boolean(gameState.comboState.sendForPerfectClear));
            // Hole-mask parity is the §5.2 abort criterion — competitive-visible
            // garbage fairness. Compared as the full matrix.
            check(
                'comboState.holeMask',
                JSON.stringify(result.comboStateAfter.holeMask ?? null),
                JSON.stringify(gameState.comboState.holeMask ?? null),
            );
        }
        Object.keys(result.lineClearCountsDelta).forEach((count) => {
            const expected = (sample.before.lineClearCounts[count] || 0) + result.lineClearCountsDelta[count];
            const actual = gameState.lineClearCounts && gameState.lineClearCounts[count];
            check(`lineClearCounts.${count}`, expected, actual);
        });
    }

    if (diffs.length > 0) {
        stats.divergent += 1;
        if (loggedDivergences < MAX_LOGGED_DIVERGENCES) {
            loggedDivergences += 1;
            console.error('[CascadeShadow] resolver DIVERGED from legacy processPhysics (plan §5.10)', diffs);
        }
        return { status: 'divergent', diffs };
    }
    stats.clean += 1;
    return { status: 'clean' };
}
